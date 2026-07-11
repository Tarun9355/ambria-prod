import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Tabs } from "../../components/ui";
import { supabase, fetchAll, updateRow } from "../../lib/supabase";
import { rowToItem, itemToRow, diffInventory } from "../../lib/inventory/adapter";
import { computePatternSizeCost, effectiveMarkup } from "../../lib/ims/flowerHelpers";
import { SETTINGS_DEFAULTS, INIT_TRUSS_INV } from "../../lib/ims/constants";
import { RC_CATS_DEFAULT } from "../../lib/studio/constants";
import InventoryTab from "./InventoryTab.jsx";
import DashboardTab from "./DashboardTab.jsx";
import AdminTab from "./AdminTab.jsx";
import SupplyTab from "./SupplyTab.jsx";
import PlanningTab from "./PlanningTab.jsx";
import FinanceTab from "./FinanceTab.jsx";
import CalendarTab from "./CalendarTab.jsx";
import FlowersTab from "./FlowersTab.jsx";
import EventsTab from "./EventsTab.jsx";
import ApprovalsTab from "./ApprovalsTab.jsx";
import { AMEND_SK, canApprove } from "../../lib/ims/amend";
import AppSwitcher from "../../components/AppSwitcher.jsx";
import { triggerLmsSync, fetchCachedContracts, fetchSeason, buildDateCategories } from "../../lib/ims/lms";
import { allocateForDate, buildEventAllocation, eoToFnList, expireStaleSoftHolds, appendTrussAudit, TRUSS_P3_BACKFILLED_SK } from "../../lib/ims/trussEngine";
import { ensureCdnLibs } from "../../lib/ims/pdf";
import { kvGet, reliableSave } from "../../lib/ims/kv";
import { rowToRcItem, rcItemToRow } from "../../lib/rateCard";

const LMS_STALE_MS = 30 * 60 * 1000; // re-sync in background only if cache older than 30 min
const BLOCKS_SK = "ambria-ims-blocks-v1"; // blocks document blob (faithful to reference Redis key)
const RC_SK = "ambria-ratecard-v4"; // Studio Rate Card blob — the live source the Studio app writes
const RC_SK_CATS = "ambria-rccats-v1"; // Rate Card *categories* — edited here in IMS as of Phase 3 (Studio's RateCard.jsx is now read-only)

// blocks `blocks` TABLE rows (row-per-item) → in-memory { [itemId]: [reservations] } shape.
const blocksRowsToMap = (rows) => Object.fromEntries((rows || []).map((r) => [r.item_id || r.id, Array.isArray(r.data) ? r.data : []]));

// Exact tab set + labels from the reference IMS app.
const TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
  { id: "events", label: "📋 Events" },
  { id: "inventory", label: "📦 Inventory" },
  { id: "calendar", label: "📅 Calendar" },
  { id: "planning", label: "🔧 Planning" },
  { id: "supply", label: "🛒 Supply" },
  { id: "flowers", label: "🌺 Flowers" },
  { id: "finance", label: "📊 Finance" },
  { id: "admin", label: "⚙️ Admin" },
];

// ── functions (events) row ⇄ object mapping. Events tab is a later phase; we load
// functions read-mostly so the Inventory Block dropdowns can reference them, and
// persist block writes back into the functions row's `data`. ──
const rowToFn = (row) => ({ ...(row.data || {}), id: row.id, name: row.name ?? row.data?.name, date: row.date ?? row.data?.date, items: row.data?.items || [] });
const fnToRow = (fn) => ({ id: fn.id, project_id: fn.projectId ?? fn.project_id ?? null, name: fn.name ?? null, date: fn.date ?? null, venue: fn.venue ?? null, status: fn.status ?? "pending", data: fn });

const rowToProject = (row) => ({ ...(row.data || {}), id: row.id, name: row.name ?? row.data?.name, status: row.status ?? row.data?.status, functions: row.data?.functions || [] });
const projectToRow = (p) => ({ id: p.id, name: p.name ?? null, client: p.client ?? null, venue: p.venue ?? null, status: p.status ?? "active", data: p });

const rowToVendor = (row) => ({ ...(row.data || {}), id: row.id, name: row.name ?? row.data?.name, type: row.type ?? row.data?.type, contact: row.contact ?? row.data?.contact, email: row.email ?? row.data?.email, bookings: row.data?.bookings || [], bills: row.data?.bills || [], ratings: row.data?.ratings || [] });
const vendorToRow = (v) => ({ id: v.id, name: v.name ?? null, type: v.type ?? null, contact: v.contact ?? null, email: v.email ?? null, data: v });

const rowToPurchase = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });
const purchaseToRow = (p) => ({ id: p.id, vendor_id: p.vendorSnapshot?.vendorId ?? null, amount: p.actualCost ?? p.estimatedCost ?? 0, status: p.status ?? "Pending", items: [], data: p });

const rowToBox = (row) => ({ ...(row.data || {}), id: row.id });
const boxToRow = (b) => ({ id: b.id, name: b.label ?? null, items: [], data: b });

const rowToOverhead = (row) => ({ ...(row.data || {}), id: row.id, amount: row.amount ?? row.data?.amount ?? 0, category: row.category ?? row.data?.category });
const overheadToRow = (o) => ({ id: o.id, name: o.description ?? null, amount: o.amount ?? 0, category: o.category ?? null, data: o });

const rowToSupervisor = (row) => ({ id: row.id, name: row.name, phone: row.phone, active: row.active });
const supervisorToRow = (s) => ({ id: s.id, name: s.name ?? null, phone: s.phone ?? null, active: s.active ?? true });

const rowToUser = (row) => ({ id: row.id, name: row.name, username: row.username, role: row.role, permissions: row.permissions || [], active: row.active ?? true, phone: row.phone, email: row.email, apps: row.apps ?? null, createdAt: row.created_at });
// Passwords live in Supabase Auth now — NEVER write a `password` column (it was dropped in migration
// 005). Sending it makes every users upsert fail ("Could not find the 'password' column"). Password
// changes go through the user-admin edge function instead.
const userToRow = (u) => ({ id: u.id, name: u.name ?? null, username: u.username ?? null, role: u.role ?? "Sales", permissions: u.permissions || [], active: u.active ?? true, phone: u.phone ?? null, email: u.email ?? null, apps: u.apps ?? null });

const rowToProd = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });
const prodToRow = (p) => ({ id: p.id, item_id: p.inventoryId ?? null, fn_id: p.functionId ?? null, status: p.status ?? "Requested", data: p });

// event_orders — read-mostly here (Truss uses it as a legacy fallback; Events tab is a
// later phase). Full object carried so the eventual Events build is forward-compatible.
const rowToEO = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });

// truss_allocations — keyed by date. The reference treats trussAlloc as an object
// { [date]: entry } where entry = { events, pool, stockSummary, ... }. The table has
// date / events / pool columns, so the non-events remainder of the entry rides in `pool`.
const rowToAlloc = (row) => ({ ...(row.pool || {}), date: row.date, events: row.events || [] });
const allocToRow = (date, entry) => {
  const { events, date: _d, ...rest } = entry || {};
  return { date, events: events || [], pool: rest };
};

export default function IMS() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Remember the last open IMS tab so toggling to Studio and back returns here (not Dashboard).
  const [tab, setTab] = useState(() => sessionStorage.getItem("ambria-ims-tab") || "dashboard");
  useEffect(() => { sessionStorage.setItem("ambria-ims-tab", tab); }, [tab]);

  const [items, setItems] = useState([]);
  const [functions, setFns] = useState([]);
  const [projects, setProjectsState] = useState([]);
  const [vendors, setVendorsState] = useState([]);
  const [purchase, setPurchaseState] = useState([]);
  const [boxes, setBoxesState] = useState([]);
  const [overheads, setOverheadsState] = useState([]);
  const [supervisors, setSupervisorsState] = useState([]);
  const [users, setUsersState] = useState([]);
  const [prodRequests, setProdRequestsState] = useState([]);
  const [eventOrders, setEventOrdersState] = useState([]);
  const [blocks, setBlocksState] = useState({});
  const [amendRequests, setAmendRequests] = useState([]);
  const [trussAlloc, setTrussAllocState] = useState({});
  const [trussInv, setTrussInvState] = useState(INIT_TRUSS_INV);
  const [categories, setCats] = useState([]);
  const [settings, setSettingsState] = useState(SETTINGS_DEFAULTS);
  const [studioRcItems, setStudioRcItems] = useState([]);
  const [studioRcCats, setStudioRcCats] = useState(RC_CATS_DEFAULT); // Studio's LIVE categories (RC_SK_CATS) — falls back to defaults until loaded
  // Rate Card → IMS migration Phase 1: per-sub-category scaling factor, IMS-owned (rate_card_categories table).
  const [rateCardCategories, setRateCardCategories] = useState([]);
  const [tier15LastSync, setTier15LastSync] = useState(null); // last recipe→Studio rate sync timestamp
  const [tier15Syncing, setTier15Syncing] = useState(false);
  const [lmsContracts, setLmsContracts] = useState([]);
  const [lmsSyncing, setLmsSyncing] = useState(false);
  // Season date-categories ({ "YYYY-MM-DD": "Heavy Saya"|... }) — auto-synced from the
  // season Edge Function (no manual button). Shape matches the reference studioLmsCache.
  const [studioLmsCache, setStudioLmsCache] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Derive cat labels / sub-cats / florals / raw items from the shared `rate_card` table — IMS's
  // own admin UI writes it now (Rate Card → IMS migration Phase 3), Studio just mirrors it live.
  // Powers Inventory categories, the Admin Sub-Categories viewer, Flowers → Recipes, and Events'
  // AI matching (rcItems).
  const studio = useMemo(() => {
    // Use Studio's LIVE categories (RC_SK_CATS) — NOT the hardcoded defaults — so categories the
    // team adds in Studio (e.g. Fabric, Birthday, Printing) flow through to IMS. Fall back to the
    // seed list only until the live blob loads.
    const liveCats = Array.isArray(studioRcCats) && studioRcCats.length ? studioRcCats : RC_CATS_DEFAULT;
    const catById = Object.fromEntries(liveCats.map((c) => [c.id, c.l]));
    // Ordered label list, de-duped, starting from the live category order.
    const labelOrder = [];
    const seenLabel = new Set();
    const pushLabel = (l) => { if (l && !seenLabel.has(l)) { seenLabel.add(l); labelOrder.push(l); } };
    liveCats.forEach((c) => pushLabel(c.l));
    const byCat = {};
    const flat = new Set();
    for (const it of studioRcItems) {
      // Map a rate-card item's category id → label. If the id isn't in the live cats yet
      // (orphan / freshly-added before the cats blob synced), surface it under its raw id so its
      // sub-cats are NEVER dropped — being dynamic means losing nothing.
      const label = catById[it.cat] || it.cat;
      if (!label) continue;
      pushLabel(label);
      if (!byCat[label]) byCat[label] = new Set();
      if (it.sub) { byCat[label].add(it.sub); flat.add(it.sub); }
    }
    const subcatsByCat = Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, [...v]]));
    const floralsItems = studioRcItems.filter((i) => i.cat === "florals").map((i) => ({ name: i.name, sub: i.sub, unit: i.unit, inhouseMode: i.inhouseMode }));
    const floralsSubcats = [...new Set(floralsItems.map((i) => i.sub).filter(Boolean))];
    // rcItems: the full raw item list — EventsTab's aiMatchEvent needs this (name → item lookup for
    // recipe-driven-floral detection), not just the derived subcat/label views above. This field was
    // missing before (Phase 4 of the Rate Card → IMS migration fixed it) — every `studio?.rcItems`
    // read was silently `[]`, so recipe-driven florals were never being skipped from inventory
    // matching as intended.
    return { subcats: [...flat], catLabels: labelOrder, subcatsByCat, floralsItems, floralsSubcats, rcItems: studioRcItems, loading: false };
  }, [studioRcItems, studioRcCats]);

  const itemsRef = useRef([]);
  const fnsRef = useRef([]);
  const vendorsRef = useRef([]);
  const purchaseRef = useRef([]);
  const boxesRef = useRef([]);
  const overheadsRef = useRef([]);
  const supervisorsRef = useRef([]);
  const usersRef = useRef([]);
  const prodRequestsRef = useRef([]);
  const eventOrdersRef = useRef([]);
  const blocksRef = useRef({});
  const projectsRef = useRef([]);
  const trussAllocRef = useRef({});
  const trussPromotedRef = useRef(new Set());
  const trussBackfilledRef = useRef(false);
  const settingsRef = useRef(SETTINGS_DEFAULTS);
  const studioRcItemsRef = useRef([]);
  useEffect(() => { studioRcItemsRef.current = studioRcItems; }, [studioRcItems]);
  const rateCardCategoriesRef = useRef([]);
  useEffect(() => { rateCardCategoriesRef.current = rateCardCategories; }, [rateCardCategories]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { fnsRef.current = functions; }, [functions]);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  useEffect(() => { boxesRef.current = boxes; }, [boxes]);
  useEffect(() => { overheadsRef.current = overheads; }, [overheads]);
  useEffect(() => { supervisorsRef.current = supervisors; }, [supervisors]);
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { prodRequestsRef.current = prodRequests; }, [prodRequests]);
  useEffect(() => { eventOrdersRef.current = eventOrders; }, [eventOrders]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { trussAllocRef.current = trussAlloc; }, [trussAlloc]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Apply settings-table rows → blocks blob, Studio rate-card mirror (RC_SK), settings object.
  // Shared by the initial load and the settings Realtime subscription so config syncs live.
  const applySettingsRows = useCallback((setRows) => {
    // blocks now come from the `blocks` TABLE (boot fetch + its own realtime), not this blob.
    // Rate-card ITEMS now live in the `rate_card` TABLE (read on load + via its own realtime), not
    // the RC_SK settings blob — so it's intentionally no longer read here.
    // Studio Rate Card *categories* — load the live list the team edits in Studio (adds like
    // Fabric / Birthday / Printing) so IMS sub-categories stay in sync instead of frozen on the seed.
    const rcCatsBlob = setRows.find((r) => r.key === RC_SK_CATS);
    if (rcCatsBlob?.value != null) { let c = rcCatsBlob.value; if (typeof c === "string") { try { c = JSON.parse(c); } catch { c = null; } } if (Array.isArray(c) && c.length) setStudioRcCats(c); }
    const settingsObj = { ...SETTINGS_DEFAULTS };
    for (const r of setRows) { if (!/^ambria-/.test(r.key)) settingsObj[r.key] = r.value; }
    settingsRef.current = settingsObj;
    setSettingsState(settingsObj);
  }, []);

  // ── Recipe → Studio rate sync (Tier 1.5) ───────────────────────────────────
  // For every Studio Florals rate-card item in a recipe-driven sub-category that has a matching
  // flower recipe, write `mandi cost × markup` per size into the rate card (S/M/B or Flat) and
  // flag it _imsDriven (locks the price in Studio). Items whose recipe was removed get unlocked.
  // This is the bridge that was specified in the UI but never implemented — without it, IMS-DRIVEN
  // items showed stale hand-entered prices instead of the recipe's computed rate.
  const syncRecipeRatesToStudio = useCallback(async ({ silent = true } = {}) => {
    const items = studioRcItemsRef.current || [];
    if (!items.length) return { updated: 0, cleared: 0 };
    const s = settingsRef.current || {};
    const patterns = s.flowerPatterns || [];
    const recipeSubs = s.flowerRecipeSubcats || [];
    const mandi = s.mandiCatalogue || [];
    const rateFor = (pat, markup, sizeKey) => {
      const sd = pat.sizes?.[sizeKey];
      const c = sd ? computePatternSizeCost(sd, mandi) : null;
      return c == null ? null : Math.round(c * markup);
    };
    // Full-artificial rate for a size: the recipe's totalPieces (whole arrangement) → kg via
    // artificialKgToPieces → × artificialMixRatePerKg → × the SAME markup as real. The Studio
    // blend then weights this by the artificial % (100 − realPct), so 100% artificial is no
    // longer ₹0 and a 30%-real mix charges 30% real + 70% of this artificial rate.
    const kgToPieces = Number(s.artificialKgToPieces) || 200;
    const artMixRate = Number(s.artificialMixRatePerKg) || 0;
    const artRateFor = (pat, markup, sizeKey) => {
      const sizes = pat.sizes || {};
      let pieces = Number(sizes[sizeKey]?.totalPieces) || 0;
      // Legacy alias: some recipes store the big-size pieces under "large" (big = 0).
      if (pieces <= 0 && sizeKey === "big") pieces = Number(sizes.large?.totalPieces) || 0;
      if (pieces <= 0 || artMixRate <= 0) return null;
      return Math.round((pieces / kgToPieces) * artMixRate * markup);
    };
    let updated = 0, cleared = 0;
    const next = items.map((it) => {
      if (String(it.cat || "").toLowerCase() !== "florals") return it;
      const inDrivenSub = recipeSubs.includes(String(it.sub || "").trim());
      const pat = inDrivenSub ? patterns.find((p) => (p.name || "").toLowerCase().trim() === (it.name || "").toLowerCase().trim()) : null;
      const hasRecipe = !!pat && Object.values(pat.sizes || {}).some((sd) => (sd?.flowers || []).length > 0);
      if (!hasRecipe) {
        if (it._imsDriven) { cleared++; const { _imsDriven, ...rest } = it; return rest; } // recipe gone → unlock
        return it;
      }
      const markup = effectiveMarkup(pat, s);
      const mode = pat.mode === "flat" ? "flat" : pat.mode === "smb" ? "smb" : (it.inhouseMode === "smb" ? "smb" : "flat");
      const draft = { ...it, _imsDriven: true, inhouseMode: mode };
      if (mode === "smb") {
        const sm = rateFor(pat, markup, "small"), md = rateFor(pat, markup, "medium"), bg = rateFor(pat, markup, "big");
        if (sm != null) draft.inhouseS = sm;
        if (md != null) draft.inhouseM = md;
        if (bg != null) draft.inhouseB = bg;
        const as = artRateFor(pat, markup, "small"), am = artRateFor(pat, markup, "medium"), ab = artRateFor(pat, markup, "big");
        if (as != null) draft.artificialS = as;
        if (am != null) draft.artificialM = am;
        if (ab != null) draft.artificialB = ab;
      } else {
        const flat = rateFor(pat, markup, "medium") ?? rateFor(pat, markup, "small") ?? rateFor(pat, markup, "big");
        if (flat != null) draft.inhouseFlat = flat;
        const aflat = artRateFor(pat, markup, "medium") ?? artRateFor(pat, markup, "small") ?? artRateFor(pat, markup, "big");
        if (aflat != null) draft.artificialFlat = aflat;
      }
      if (JSON.stringify(draft) !== JSON.stringify(it)) updated++;
      return draft;
    });
    if (!silent) setTier15Syncing(true);
    try {
      if (updated || cleared) {
        studioRcItemsRef.current = next;
        setStudioRcItems(next);
        // Row-level upsert to the shared `rate_card` TABLE (migrated off the RC_SK blob) — only the
        // items whose recipe-driven price actually changed, so nothing else is touched.
        const changedItems = next.filter((it, idx) => JSON.stringify(it) !== JSON.stringify(items[idx]));
        const rows = changedItems.map((it) => ({ id: it.id, name: it.name || "", cat: it.cat ?? null, sub: it.sub ?? null, unit: it.unit ?? null, inhouse_mode: it.inhouseMode ?? "flat", inhouse_flat: Number(it.inhouseFlat) || 0, inhouse_s: Number(it.inhouseS) || 0, inhouse_m: Number(it.inhouseM) || 0, inhouse_b: Number(it.inhouseB) || 0, out_s: Number(it.outS) || 0, out_m: Number(it.outM) || 0, out_b: Number(it.outB) || 0, zones: Array.isArray(it.zones) ? it.zones : [], floral_mode: it.floralMode ?? null, default_real_pct: it.defaultRealPct ?? null, data: it, updated_at: new Date().toISOString() }));
        if (rows.length) { const { error } = await supabase.from("rate_card").upsert(rows, { onConflict: "id" }); if (error) { if (!silent) setError(`Sync failed: ${error.message}`); return { error: error.message, updated, cleared }; } }
      }
      setTier15LastSync(Date.now());
      return { updated, cleared };
    } finally {
      if (!silent) setTier15Syncing(false);
    }
  }, []);

  // Rate Card → IMS migration Phase 1: update one sub-category's scaling factor. Optimistic local
  // update + row-level write to `rate_card_categories` (id = lower(trim(label)), the same join key
  // Studio/Deal Check sub-category matching already uses).
  const updateSubcatFactor = useCallback(async (id, factor) => {
    setRateCardCategories((prev) => prev.map((r) => (r.id === id ? { ...r, scaling_factor: factor } : r)));
    try {
      await updateRow("rate_card_categories", id, { scaling_factor: factor });
    } catch (e) {
      setError(`Failed to save scaling factor: ${e.message}`);
    }
  }, []);

  // Cost% for pricing a Deal Check card's shortfall (qty beyond what's free in stock) at
  // item.cost × this% instead of the rental rate — same optimistic-update/rollback pattern.
  const updateSubcatCostPercent = useCallback(async (id, pct) => {
    setRateCardCategories((prev) => prev.map((r) => (r.id === id ? { ...r, cost_percent: pct } : r)));
    try {
      await updateRow("rate_card_categories", id, { cost_percent: pct });
    } catch (e) {
      setError(`Failed to save cost%: ${e.message}`);
    }
  }, []);

  // Default floral pricing mode ('ratio'|'real'|'artificial') applied to every Florals item in this
  // sub-category that doesn't already have its own explicit per-item pin — see getFloralMode() in
  // src/lib/rateCard.js. Same optimistic-update/rollback pattern as the factor/cost%.
  const updateSubcatFloralMode = useCallback(async (id, mode) => {
    setRateCardCategories((prev) => prev.map((r) => (r.id === id ? { ...r, floral_mode: mode } : r)));
    try {
      await updateRow("rate_card_categories", id, { floral_mode: mode });
    } catch (e) {
      setError(`Failed to save floral mode: ${e.message}`);
    }
  }, []);

  // Hides every item in this sub-category from AI photo-tagging's vocabulary (both the client
  // aiTagImage tagger and the nightly batch-tagger Edge Function read this) — replaces the old
  // Rate-Card-only "not taggable in Pricing" flag for tagging purposes. Same optimistic pattern.
  const updateSubcatTagHidden = useCallback(async (id, hidden) => {
    setRateCardCategories((prev) => prev.map((r) => (r.id === id ? { ...r, tag_hidden: hidden } : r)));
    try {
      await updateRow("rate_card_categories", id, { tag_hidden: hidden });
    } catch (e) {
      setError(`Failed to save tagging flag: ${e.message}`);
    }
  }, []);

  // Add a sub-category IMS doesn't have yet (e.g. a new rate-card item with no inventory analog).
  // id is derived the same way as the Phase 1 seed — lower(trim(label)) — so it's usable as a join
  // key immediately. Plain insert (not upsert) so a name collision surfaces as an error instead of
  // silently overwriting an existing factor. categoryLabel is optional — set when added via the
  // "+ Add" button on a specific top-level-category heading, so the new row lands there instead
  // of "Other" (see category_label override, below).
  const addSubcat = useCallback(async (label, categoryLabel) => {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    const id = trimmed.toLowerCase();
    if (rateCardCategoriesRef.current.some((r) => r.id === id)) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    const row = { id, label: trimmed, scaling_factor: 1.0, source: "manual", sort_order: 0, category_label: categoryLabel || null };
    setRateCardCategories((prev) => [...prev, row]);
    try {
      const { error } = await supabase.from("rate_card_categories").insert(row);
      if (error) throw error;
    } catch (e) {
      setRateCardCategories((prev) => prev.filter((r) => r.id !== id));
      setError(`Failed to add sub-category: ${e.message}`);
    }
  }, []);

  // Manual override of which top-level category a sub-category is grouped under in the Sub-
  // Categories panel — wins over the live rate_card-item-derived grouping (subToCatLabel in
  // AdminSettingsTab.jsx) when set. Same optimistic-update/rollback pattern as the factor/cost%.
  const updateSubcatCategory = useCallback(async (id, categoryLabel) => {
    setRateCardCategories((prev) => prev.map((r) => (r.id === id ? { ...r, category_label: categoryLabel } : r)));
    try {
      await updateRow("rate_card_categories", id, { category_label: categoryLabel });
    } catch (e) {
      setError(`Failed to move sub-category: ${e.message}`);
    }
  }, []);

  // Bulk-create rate_card_categories rows for inventory sub-categories that don't have one yet.
  // Explicit action (a "Sync from Inventory" button in the Sub-Categories panel), never automatic
  // on load — same optimistic-update/rollback shape as addSubcat, just batched into one insert.
  const syncSubcatsFromInventory = useCallback(async (missing) => {
    const rows = (missing || []).filter((m) => m && m.id && m.label)
      .map((m) => ({ id: m.id, label: m.label, scaling_factor: 1.0, source: "inventory", sort_order: 0, category_label: m.cat || null }));
    if (!rows.length) return;
    setRateCardCategories((prev) => [...prev, ...rows]);
    try {
      const { error } = await supabase.from("rate_card_categories").insert(rows);
      if (error) throw error;
    } catch (e) {
      const ids = new Set(rows.map((r) => r.id));
      setRateCardCategories((prev) => prev.filter((r) => !ids.has(r.id)));
      setError(`Failed to sync sub-categories from inventory: ${e.message}`);
    }
  }, []);

  // Delete a sub-category row. The Sub-Categories panel itself blocks this call when live inventory
  // items still reference the sub-category (it checks before calling this) — this handler just
  // does the write + optimistic-update/rollback, same shape as everything else here.
  const deleteSubcat = useCallback(async (id) => {
    const prev = rateCardCategoriesRef.current;
    setRateCardCategories((p) => p.filter((r) => r.id !== id));
    try {
      const { error } = await supabase.from("rate_card_categories").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setRateCardCategories(prev);
      setError(`Failed to delete sub-category: ${e.message}`);
    }
  }, []);

  // Rename a sub-category. When the new label normalizes to a different id, the row's PK changes
  // too (id must stay lower(trim(label)) — the join key everything else matches on) — rolls back
  // on failure (e.g. the new name collides with an existing sub-category).
  const renameSubcat = useCallback(async (oldId, newLabel) => {
    const trimmed = (newLabel || "").trim();
    if (!trimmed) return;
    const newId = trimmed.toLowerCase();
    const prevRows = rateCardCategoriesRef.current;
    if (newId !== oldId && prevRows.some((r) => r.id === newId)) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    setRateCardCategories((prev) => prev.map((r) => (r.id === oldId ? { ...r, id: newId, label: trimmed } : r)));
    try {
      await updateRow("rate_card_categories", oldId, { id: newId, label: trimmed });
    } catch (e) {
      setRateCardCategories(prevRows);
      setError(`Failed to rename: ${e.message}`);
    }
  }, []);

  // Rate Card → IMS migration Phase 3: Rate Card admin authority moves from Studio to IMS. Same
  // shape and rollback-on-error behavior as Studio's own saveRC/saveRcCats (StudioApp.jsx) —
  // writing to the same `rate_card` table / `ambria-rccats-v1` settings key Studio already reads
  // via its existing realtime subscription, so Studio's RateCard.jsx needs no code change beyond
  // becoming read-only.
  const saveRateCardItems = useCallback(async (nextItems, deletedIds) => {
    const prev = studioRcItemsRef.current || [];
    const prevById = {}; prev.forEach((i) => { if (i && i.id) prevById[i.id] = i; });
    studioRcItemsRef.current = nextItems; setStudioRcItems(nextItems);
    const changed = (nextItems || []).filter((i) => i && i.id && JSON.stringify(prevById[i.id]) !== JSON.stringify(i));
    const dels = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];
    try {
      if (changed.length) {
        const rows = changed.map((i) => ({ ...rcItemToRow(i), updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("rate_card").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      for (const id of dels) { const { error } = await supabase.from("rate_card").delete().eq("id", id); if (error) throw error; }
    } catch (e) {
      studioRcItemsRef.current = prev; setStudioRcItems(prev);
      setError(`Rate card save failed: ${e.message}`);
    }
  }, []);

  const saveRateCardCats = useCallback(async (nextCats) => {
    const prev = studioRcCats;
    setStudioRcCats(nextCats);
    const r = await reliableSave(RC_SK_CATS, JSON.stringify(nextCats), "Categories");
    if (r && r.ok === false) { setStudioRcCats(prev); setError(`Failed to save categories: ${r.error}`); }
    return r;
  }, [studioRcCats]);

  // Auto-sync: reconcile Studio prices to the recipe whenever recipes / mandi / markup / driven-subs
  // change (debounced), and once after load — so Studio matches the recipe even with no button press.
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => { syncRecipeRatesToStudio({ silent: true }); }, 2500);
    return () => clearTimeout(t);
    // NOTE: studioRcItems is deliberately NOT a dependency. It used to be — but a Studio price edit
    // changes RC_SK → realtime updates studioRcItems → this effect fired → re-saved RC_SK → echoed
    // back to Studio and REVERTED the edit (feedback loop). Sync only on recipe/mandi/markup changes.
  }, [loading, settings.flowerPatterns, settings.mandiCatalogue, settings.defaultStudioMarkup, settings.flowerRecipeSubcats, syncRecipeRatesToStudio]);

  // ── Initial load + Realtime subscriptions ──
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [invRows, fnRows, projRows, venRows, poRows, boxRows, ohRows, supRows, userRows, prodRows, eoRows, allocRows, rcRows, trussRows, catRows, setRows, blockRows, rcCatRows] = await Promise.all([
          fetchAll("inventory"),
          fetchAll("functions").catch(() => []),
          fetchAll("projects").catch(() => []),
          fetchAll("vendors").catch(() => []),
          fetchAll("purchase_orders").catch(() => []),
          fetchAll("boxes").catch(() => []),
          fetchAll("overheads").catch(() => []),
          fetchAll("supervisors").catch(() => []),
          fetchAll("users").catch(() => []),
          fetchAll("production_requests").catch(() => []),
          fetchAll("event_orders").catch(() => []),
          fetchAll("truss_allocations").catch(() => []),
          fetchAll("rate_card").catch(() => []),
          fetchAll("truss_inventory").catch(() => []),
          fetchAll("categories").catch(() => []),
          fetchAll("settings").catch(() => []),
          fetchAll("blocks").catch(() => []),
          fetchAll("rate_card_categories").catch(() => []),
        ]);
        if (!active) return;
        { const bm = blocksRowsToMap(blockRows); blocksRef.current = bm; setBlocksState(bm); }
        const loadedItems = invRows.map(rowToItem);
        itemsRef.current = loadedItems; // keep the ref in lockstep from the very first paint
        setItems(loadedItems);
        setFns(fnRows.map(rowToFn));
        setProjectsState(projRows.map(rowToProject));
        setVendorsState(venRows.map(rowToVendor));
        setPurchaseState(poRows.map(rowToPurchase));
        setBoxesState(boxRows.map(rowToBox));
        setOverheadsState(ohRows.map(rowToOverhead));
        setSupervisorsState(supRows.map(rowToSupervisor));
        setUsersState(userRows.map(rowToUser));
        setProdRequestsState(prodRows.map(rowToProd));
        setEventOrdersState(eoRows.map(rowToEO));
        setTrussAllocState(Object.fromEntries(allocRows.map((r) => [r.date, rowToAlloc(r)])));
        const trussRow = trussRows.find((r) => r.key === "main") || trussRows[0];
        if (trussRow?.data) setTrussInvState(trussRow.data);
        setCats(catRows.map((c) => c.name).filter(Boolean));
        // blocks blob, Studio rate-card mirror, and the settings object — applied via the
        // shared helper (also used by the settings Realtime subscription below).
        applySettingsRows(setRows);
        // Rate card: read from the shared `rate_card` TABLE (migrated off the RC_SK blob).
        setStudioRcItems(rcRows.map(rowToRcItem).filter(Boolean));
        setRateCardCategories(rcCatRows);
        setLoading(false);
      } catch (e) {
        if (active) { setError(e.message || "Failed to load IMS data"); setLoading(false); }
      }
    })();

    const channel = supabase
      .channel("realtime:inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, (payload) => {
        // Reconcile against itemsRef (the synchronous source of truth shared with setInventory),
        // NOT React's possibly-batched `prev`, and update the ref synchronously. Otherwise a local
        // add reading a stale ref would clobber this echo with a plain snapshot — the just-added
        // item disappears and the "All (N)" count never moves. Keeping the ref in lockstep here
        // closes that race for the 40 concurrent ops users.
        const prev = itemsRef.current;
        let next;
        if (payload.eventType === "DELETE") {
          next = prev.filter((r) => r.id !== payload.old.id);
        } else {
          const item = rowToItem(payload.new);
          next = prev.some((r) => r.id === item.id) ? prev.map((r) => (r.id === item.id ? item : r)) : [...prev, item];
        }
        itemsRef.current = next;
        setItems(next);
      })
      .subscribe();

    // ── Realtime for the rest of the shared data — re-fetch the table and re-apply on any
    // change so Studio ⇄ IMS stay in sync live (no refresh needed). ──
    const extraChannels = [];
    const liveTable = (table, apply) => {
      const ch = supabase
        .channel(`realtime:${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, async () => {
          const rows = await fetchAll(table).catch(() => null);
          if (rows && active) apply(rows);
        })
        .subscribe();
      extraChannels.push(ch);
    };
    liveTable("settings", (rows) => applySettingsRows(rows));
    liveTable("rate_card", (rows) => setStudioRcItems(rows.map(rowToRcItem).filter(Boolean)));
    liveTable("rate_card_categories", (rows) => setRateCardCategories(rows));
    liveTable("blocks", (rows) => { const bm = blocksRowsToMap(rows); blocksRef.current = bm; setBlocksState(bm); });
    liveTable("event_orders", (rows) => setEventOrdersState(rows.map(rowToEO)));
    liveTable("functions", (rows) => setFns(rows.map(rowToFn)));
    liveTable("projects", (rows) => setProjectsState(rows.map(rowToProject)));
    liveTable("truss_allocations", (rows) => setTrussAllocState(Object.fromEntries(rows.map((r) => [r.date, rowToAlloc(r)]))));
    liveTable("truss_inventory", (rows) => { const tr = rows.find((r) => r.key === "main") || rows[0]; if (tr?.data) setTrussInvState(tr.data); });
    liveTable("categories", (rows) => setCats(rows.map((c) => c.name).filter(Boolean)));
    liveTable("supervisors", (rows) => setSupervisorsState(rows.map(rowToSupervisor)));
    liveTable("vendors", (rows) => setVendorsState(rows.map(rowToVendor)));
    liveTable("purchase_orders", (rows) => setPurchaseState(rows.map(rowToPurchase)));
    liveTable("production_requests", (rows) => setProdRequestsState(rows.map(rowToProd)));
    liveTable("users", (rows) => setUsersState(rows.map(rowToUser)));
    liveTable("boxes", (rows) => setBoxesState(rows.map(rowToBox)));
    liveTable("overheads", (rows) => setOverheadsState(rows.map(rowToOverhead)));

    return () => { active = false; supabase.removeChannel(channel); extraChannels.forEach((ch) => supabase.removeChannel(ch)); };
  }, []);

  // Refresh in-memory state from the Supabase cache (instant — no LMS pagination) + season.
  const loadLmsFromCache = useCallback(async () => {
    const { contracts, lastSync } = await fetchCachedContracts();
    setLmsContracts(contracts);
    const season = await fetchSeason();
    if (season) setStudioLmsCache({ dateCategories: buildDateCategories(season, contracts) });
    return lastSync;
  }, []);

  // Manual "🔄 Sync LMS": Edge Function paginates LMS server-side → DB, then re-read cache.
  const syncLms = useCallback(async () => {
    setLmsSyncing(true);
    try {
      await triggerLmsSync();
      await loadLmsFromCache();
    } catch (e) {
      setError(`LMS sync failed: ${e.message}`);
    } finally {
      setLmsSyncing(false);
    }
  }, [loadLmsFromCache]);

  // On mount: read the cache instantly; only kick a background server-side sync if stale.
  useEffect(() => {
    let active = true;
    (async () => {
      const lastSync = await loadLmsFromCache();
      if (active && Date.now() - lastSync > LMS_STALE_MS) syncLms();
    })();
    return () => { active = false; };
  }, [loadLmsFromCache, syncLms]);

  // Load the CDN libs (pdf.js / XLSX / JSZip) once — Events deck rendering needs window.pdfjsLib.
  useEffect(() => { ensureCdnLibs(); }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // §23 PHASE 3 ORCHESTRATOR — keep trussAlloc in sync with sold event orders.
  // Faithful to the reference: (1) promote soft→hard when an EO is sold, (2) sweep
  // expired soft holds every 5 min, (3) one-time backfill of already-sold EOs.
  // ══════════════════════════════════════════════════════════════════════════
  // ── Promote soft → hard when EO is sold/confirmed ──
  useEffect(() => {
    if (!user) return;
    if (!Array.isArray(eventOrders) || eventOrders.length === 0) return;
    if (!trussInv || !trussInv.pillars) return;
    const toPromote = eventOrders.filter((eo) => {
      if (!eo || !eo.id) return false;
      if (trussPromotedRef.current.has(eo.id)) return false;
      if (eo.status === "pending" || !eo.status) return false;
      return true;
    });
    if (toPromote.length === 0) return;
    let nextAlloc = { ...trussAllocRef.current };
    const datesToRecompute = new Set();
    toPromote.forEach((eo) => {
      trussPromotedRef.current.add(eo.id);
      const fnList = eoToFnList(eo);
      const fnsByDate = {};
      fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (!d) return; if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); });
      Object.entries(fnsByDate).forEach(([d, fns]) => {
        const eventEntry = buildEventAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns, trussInv);
        if (!eventEntry.trusses || eventEntry.trusses.length === 0) return;
        const dateEntry = nextAlloc[d] || { events: [] };
        const existingEvents = Array.isArray(dateEntry.events) ? [...dateEntry.events] : [];
        const filteredEvents = existingEvents.filter((ev) => {
          if (ev.state === "soft" && ev.clientId === eventEntry.clientId) return false;
          if (ev.state === "hard" && ev.eoId === eventEntry.eoId) return false;
          return true;
        });
        filteredEvents.push(eventEntry);
        nextAlloc[d] = { ...dateEntry, events: filteredEvents };
        datesToRecompute.add(d);
      });
    });
    datesToRecompute.forEach((d) => { nextAlloc = allocateForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "auto-promote-on-sold"); });
    if (datesToRecompute.size > 0) {
      setTrussAlloc(nextAlloc);
      datesToRecompute.forEach((d) => appendTrussAudit({ date: d, event: "promote-soft-to-hard", triggerEoIds: toPromote.map((e) => e.id), eventCount: nextAlloc[d]?.events?.length || 0, feasible: !!nextAlloc[d]?.stockSummary?.feasible }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventOrders, trussInv, user]);

  // ── Soft-hold expiry sweeper — runs every 5 min ──
  useEffect(() => {
    if (!user) return;
    const sweep = () => {
      const now = Date.now();
      let next = { ...trussAllocRef.current };
      const datesChanged = new Set();
      Object.keys(next).forEach((d) => {
        const fresh = expireStaleSoftHolds(next[d]?.events || [], now);
        if (fresh) { next[d] = { ...next[d], events: fresh }; datesChanged.add(d); }
      });
      if (datesChanged.size === 0) return;
      datesChanged.forEach((d) => { next = allocateForDate(next, d, next[d]?.events || [], trussInv, "soft-hold-expiry-sweep"); });
      setTrussAlloc(next);
      datesChanged.forEach((d) => appendTrussAudit({ date: d, event: "soft-hold-expired", eventCount: next[d]?.events?.length || 0 }));
    };
    sweep();
    const id = setInterval(sweep, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, trussInv]);

  // ── One-time backfill of already-sold EOs into truss allocation ──
  useEffect(() => {
    if (!user) return;
    if (trussBackfilledRef.current) return;
    if (!Array.isArray(eventOrders)) return;
    if (!trussInv || !trussInv.pillars) return;
    (async () => {
      try {
        const flag = await kvGet(TRUSS_P3_BACKFILLED_SK); // DB flag only — no localStorage
        const alreadyDone = flag === "1" || flag === '"1"';
        if (alreadyDone) { trussBackfilledRef.current = true; return; }
        const soldEos = eventOrders.filter((eo) => eo && eo.id && eo.status && eo.status !== "pending");
        const eosToBackfill = soldEos.filter((eo) => {
          const d = eo.date || eo.functionsDetail?.[0]?.date || "";
          if (!d) return false;
          return !(trussAllocRef.current[d]?.events || []).some((ev) => ev.eoId === eo.id);
        });
        if (eosToBackfill.length === 0) {
          await reliableSave(TRUSS_P3_BACKFILLED_SK, "1", "Phase 3 backfill flag");
          trussBackfilledRef.current = true;
          return;
        }
        let nextAlloc = { ...trussAllocRef.current };
        const datesChanged = new Set();
        eosToBackfill.forEach((eo) => {
          trussPromotedRef.current.add(eo.id);
          const fnList = eoToFnList(eo);
          const fnsByDate = {};
          fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (d) { if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); } });
          Object.entries(fnsByDate).forEach(([d, fns]) => {
            const eventEntry = buildEventAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns, trussInv);
            if (!eventEntry.trusses || eventEntry.trusses.length === 0) return;
            const dateEntry = nextAlloc[d] || { events: [] };
            const existingEvents = Array.isArray(dateEntry.events) ? [...dateEntry.events] : [];
            const filtered = existingEvents.filter((ev) => ev.eoId !== eventEntry.eoId);
            filtered.push(eventEntry);
            nextAlloc[d] = { ...dateEntry, events: filtered };
            datesChanged.add(d);
          });
        });
        datesChanged.forEach((d) => { nextAlloc = allocateForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "phase3-backfill"); });
        setTrussAlloc(nextAlloc);
        await reliableSave(TRUSS_P3_BACKFILLED_SK, "1", "Phase 3 backfill flag");
        trussBackfilledRef.current = true;
        await appendTrussAudit({ date: "ALL", event: "phase3-backfill", eventCount: eosToBackfill.length, datesAffected: datesChanged.size });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[tier23-p3] backfill FAILED", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventOrders, trussInv]);

  // Persist only the rows that actually changed (CLAUDE.md rule #1 — never re-save the whole table).
  const persistInventory = useCallback(async (prev, next, deletedIds) => {
    const { upserts, deletes } = diffInventory(prev, next, deletedIds, user?.name || null);
    for (const row of upserts) {
      const { error: e } = await supabase.from("inventory").upsert(row, { onConflict: "id" });
      if (e) setError(`Save failed: ${e.message}`);
    }
    for (const id of deletes) {
      const { error: e } = await supabase.from("inventory").delete().eq("id", id);
      if (e) setError(`Delete failed: ${e.message}`);
    }
  }, [user]);

  // Faithful `setInventory(updater, deletedIds)` contract used by InventoryTab —
  // computes next once (StrictMode-safe), updates state, persists the diff row-by-row.
  const setInventory = useCallback((updater, deletedIds = []) => {
    const prev = itemsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    itemsRef.current = next;
    setItems(next);
    persistInventory(prev, next, deletedIds);
  }, [persistInventory]);

  // functions writes (block reservations). Persist changed function rows to Supabase.
  const setFunctions = useCallback((updater) => {
    const prev = fnsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    fnsRef.current = next;
    setFns(next);
    const prevMap = new Map(prev.map((f) => [f.id, f]));
    (async () => {
      for (const fn of next) {
        const before = prevMap.get(fn.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(fn)) {
          const { error: e } = await supabase.from("functions").upsert(fnToRow(fn), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  const setVendors = useCallback((updater) => {
    const prev = vendorsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    vendorsRef.current = next;
    setVendorsState(next);
    const prevMap = new Map(prev.map((v) => [v.id, v]));
    (async () => {
      for (const v of next) {
        const before = prevMap.get(v.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(v)) {
          const { error: e } = await supabase.from("vendors").upsert(vendorToRow(v), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  const setPurchase = useCallback((updater) => {
    const prev = purchaseRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    purchaseRef.current = next;
    setPurchaseState(next);
    const prevMap = new Map(prev.map((p) => [p.id, p]));
    (async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await supabase.from("purchase_orders").upsert(purchaseToRow(p), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  const setBoxes = useCallback((updater) => {
    const prev = boxesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    boxesRef.current = next;
    setBoxesState(next);
    const prevMap = new Map(prev.map((b) => [b.id, b]));
    (async () => {
      for (const b of next) {
        const before = prevMap.get(b.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(b)) {
          const { error: e } = await supabase.from("boxes").upsert(boxToRow(b), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  const setOverheads = useCallback((updater) => {
    const prev = overheadsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    overheadsRef.current = next;
    setOverheadsState(next);
    const prevMap = new Map(prev.map((o) => [o.id, o]));
    (async () => {
      for (const o of next) {
        const before = prevMap.get(o.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(o)) {
          const { error: e } = await supabase.from("overheads").upsert(overheadToRow(o), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  // Settings are a key→value table; persist only the keys that changed.
  const setSettings = useCallback((updater) => {
    const prev = settingsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    settingsRef.current = next;
    setSettingsState(next);
    (async () => {
      for (const k of Object.keys(next)) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
          const { error: e } = await supabase.from("settings").upsert({ key: k, value: next[k] }, { onConflict: "key" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  const setSupervisors = useCallback((updater) => {
    const prev = supervisorsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    supervisorsRef.current = next;
    setSupervisorsState(next);
    const prevMap = new Map(prev.map((s) => [s.id, s]));
    const nextIds = new Set(next.map((s) => s.id));
    (async () => {
      for (const s of next) {
        const before = prevMap.get(s.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(s)) {
          const { error: e } = await supabase.from("supervisors").upsert(supervisorToRow(s), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await supabase.from("supervisors").delete().eq("id", id);
      }
    })();
  }, []);

  // Users — row-level diff persistence to the users table (incl. per-user apps + role/perms).
  const setUsers = useCallback((updater) => {
    const prev = usersRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    usersRef.current = next;
    setUsersState(next);
    const prevMap = new Map(prev.map((u) => [u.id, u]));
    const nextIds = new Set(next.map((u) => u.id));
    (async () => {
      for (const u of next) {
        const before = prevMap.get(u.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(u)) {
          const { error: e } = await supabase.from("users").upsert(userToRow(u), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await supabase.from("users").delete().eq("id", id);
      }
    })();
  }, []);

  // Pure INSERT for a brand-new user — never diffs/updates/deletes existing rows. Used by the
  // "Add User" flow so adding one user can't touch any other row in the table.
  const addUser = useCallback(async (newUser) => {
    const next = [...(usersRef.current || []), newUser];
    usersRef.current = next;
    setUsersState(next);
    const { error: e } = await supabase.from("users").insert(userToRow(newUser));
    if (e) setError(`Add user failed: ${e.message}`);
  }, []);

  // Production requests — full object stored in `data`; persist only changed/deleted rows.
  const setProdRequests = useCallback((updater) => {
    const prev = prodRequestsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    prodRequestsRef.current = next;
    setProdRequestsState(next);
    const prevMap = new Map(prev.map((p) => [p.id, p]));
    const nextIds = new Set(next.map((p) => p.id));
    (async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await supabase.from("production_requests").upsert(prodToRow(p), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await supabase.from("production_requests").delete().eq("id", id);
      }
    })();
  }, []);

  // event_orders — array of EO objects (.id). Row-level diff persistence; second arg is
  // deleted ids (faithful to the reference setEventOrders(v, del) contract).
  const setEventOrders = useCallback((updater, deletedIds = []) => {
    const prev = eventOrdersRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    eventOrdersRef.current = next;
    setEventOrdersState(next);
    const prevMap = new Map(prev.map((e) => [e.id, e]));
    const nextIds = new Set(next.map((e) => e.id));
    (async () => {
      for (const eo of next) {
        const before = prevMap.get(eo.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(eo)) {
          const { error: e } = await supabase.from("event_orders").upsert({ id: eo.id, client_name: eo.clientName ?? null, event_id: eo.eventId ?? null, fn_id: eo.fnId ?? null, status: eo.status ?? "pending", items: eo.items || [], manual_items: eo.manualItems || [], decisions: eo.decisions || {}, data: eo }, { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of [...deletedIds, ...[...prevMap.keys()].filter((id) => !nextIds.has(id))]) {
        await supabase.from("event_orders").delete().eq("id", id);
      }
    })();
  }, []);
  // saveEventOrders — the reference passed an explicit save callback; here it routes to
  // the same row-level persistence (setEventOrders already writes through).
  const saveEventOrders = useCallback((val, del = []) => { setEventOrders(val, del); }, [setEventOrders]);

  // blocks — migrated off the single BLOCKS_SK blob to the `blocks` TABLE, ROW-PER-ITEM
  // (id = itemId, data = that item's reservation array). Row-level diff so a stale session only
  // rewrites the items it actually changed — no whole-blob clobber. In-memory shape is unchanged
  // ({ [itemId]: [reservations] }), so every consumer stays the same.
  const persistBlocks = async (next, prev) => {
    const nextO = next || {}, prevO = prev || {};
    const upserts = [], deletes = [];
    for (const [itemId, arr] of Object.entries(nextO)) {
      if (JSON.stringify(prevO[itemId]) === JSON.stringify(arr)) continue; // unchanged → skip
      if (Array.isArray(arr) && arr.length) upserts.push({ id: itemId, item_id: itemId, data: arr });
      else deletes.push(itemId); // emptied → remove the row
    }
    for (const itemId of Object.keys(prevO)) if (!(itemId in nextO)) deletes.push(itemId); // item removed
    try {
      if (upserts.length) { const { error } = await supabase.from("blocks").upsert(upserts, { onConflict: "id" }); if (error) throw error; }
      for (const id of deletes) { const { error } = await supabase.from("blocks").delete().eq("id", id); if (error) throw error; }
    } catch (e) { setError(`Save failed: ${e?.message || e}`); }
  };
  const setBlocks = useCallback((updater) => {
    const prev = blocksRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    blocksRef.current = next;
    setBlocksState(next);
    persistBlocks(next, prev);
  }, []);
  const saveBlocks = useCallback((val) => {
    const prev = blocksRef.current;
    const next = typeof val === "function" ? val(prev) : val;
    blocksRef.current = next;
    setBlocksState(next);
    persistBlocks(next, prev);
  }, []);
  // Last-minute amendment requests — migrated off the AMEND_SK blob to the `amend_requests` TABLE.
  const amendReqRef = useRef([]);
  useEffect(() => { amendReqRef.current = amendRequests; }, [amendRequests]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const rows = await fetchAll("amend_requests"); if (!cancelled && Array.isArray(rows)) setAmendRequests(rows.map((r) => ({ ...(r.data || {}), id: r.id, status: r.status ?? r.data?.status }))); } catch { /* none yet */ }
    })();
    const ch = supabase.channel("realtime:amend_requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "amend_requests" }, async () => {
        const rows = await fetchAll("amend_requests").catch(() => null);
        if (rows) setAmendRequests(rows.map((r) => ({ ...(r.data || {}), id: r.id, status: r.status ?? r.data?.status })));
      }).subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // Row-level: upsert only changed requests + delete removed ones (never on-absence beyond removal).
  const saveAmendRequests = useCallback(async (next) => {
    const prev = amendReqRef.current || [];
    amendReqRef.current = next; setAmendRequests(next);
    const prevMap = new Map(prev.map((r) => [r.id, r]));
    const nextIds = new Set((next || []).map((r) => r.id));
    try {
      for (const req of (next || [])) {
        const before = prevMap.get(req.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(req)) {
          const { error } = await supabase.from("amend_requests").upsert({ id: req.id, status: req.status ?? null, data: req }, { onConflict: "id" });
          if (error) throw error;
        }
      }
      for (const id of [...prevMap.keys()].filter((id) => !nextIds.has(id))) await supabase.from("amend_requests").delete().eq("id", id);
    } catch (e) { setError(`Save failed: ${e?.message || e}`); }
  }, []);

  // projects — row-level diff persistence to the projects table.
  const setProjects = useCallback((updater) => {
    const prev = projectsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    projectsRef.current = next;
    setProjectsState(next);
    const prevMap = new Map(prev.map((p) => [p.id, p]));
    (async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await supabase.from("projects").upsert(projectToRow(p), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  // Truss allocations — object keyed by date. allocateForDate returns the whole map;
  // we persist only the dates whose entry actually changed (CLAUDE.md rule #1).
  const setTrussAlloc = useCallback((updater) => {
    const prev = trussAllocRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    trussAllocRef.current = next;
    setTrussAllocState(next);
    (async () => {
      for (const date of Object.keys(next)) {
        if (JSON.stringify(prev[date]) !== JSON.stringify(next[date])) {
          const { error: e } = await supabase.from("truss_allocations").upsert(allocToRow(date, next[date]), { onConflict: "date" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })();
  }, []);

  // Truss inventory is a single-row key-value (key='main', data JSONB).
  const setTrussInv = useCallback((updater) => {
    setTrussInvState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      supabase.from("truss_inventory").upsert({ key: "main", data: next }, { onConflict: "key" }).then(({ error: e }) => { if (e) setError(`Save failed: ${e.message}`); });
      return next;
    });
  }, []);

  const setCategories = useCallback((updater) => {
    setCats((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const handleLogout = () => { logout(); navigate("/login", { replace: true }); };

  // Role-based tab filtering (faithful to reference).
  const roleConfig = (settings?.roleTabs || {})[user?.role] || { tabs: TABS.map((t) => t.id) };
  const isAdmin = user?.role === "Admin" || user?.id === "u_admin";
  let allowedTabs = isAdmin ? TABS : TABS.filter((t) => (roleConfig.tabs || []).includes(t.id));
  // Department heads (+ Admin) get an Approvals tab for last-minute amendment requests.
  if (canApprove(user) && !allowedTabs.some((t) => t.id === "approvals")) {
    const pendN = (amendRequests || []).filter((r) => r.status === "pending").length;
    allowedTabs = [...allowedTabs, { id: "approvals", label: `✅ Approvals${pendN ? ` (${pendN})` : ""}` }];
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {error && (
        <div style={{ position: "fixed", top: 8, right: 8, zIndex: 99999, background: "#dc2626", color: "#fff", padding: "12px 14px", borderRadius: 8, fontSize: 13, maxWidth: 380, boxShadow: "0 6px 20px rgba(0,0,0,0.25)", border: "1px solid #991b1b" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>❌ {error}</div>
          <button onClick={() => setError("")} style={{ background: "#fff", color: "#dc2626", border: "none", padding: "5px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}
      <div className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">A</div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Ambria IMS</h1>
                <p className="text-xs text-gray-400">Inventory Management System</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AppSwitcher current="ims" />
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-sm font-bold">{(user?.name || "?")[0]}</div>
              <span className="text-sm text-gray-700 hidden sm:block">{user?.name} · {user?.role || "User"}</span>
              <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 ml-2 px-2 py-1 border rounded-lg">Logout</button>
            </div>
          </div>
          <div className="pb-3 overflow-x-auto">
            <Tabs tabs={allowedTabs} active={tab} onChange={setTab} />
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center text-gray-400 py-20"><div className="text-3xl mb-2">⏳</div>Loading Ambria IMS…</div>
        ) : tab === "dashboard" ? (
          <DashboardTab projects={projects} functions={functions} inventory={items} />
        ) : tab === "inventory" ? (
          <InventoryTab
            inventory={items} setInventory={setInventory}
            functions={functions} setFunctions={setFunctions}
            categories={categories} setCategories={setCategories}
            settings={settings} studio={studio}
          />
        ) : tab === "admin" ? (
          <AdminTab
            vendors={vendors} setVendors={setVendors} functions={functions}
            settings={settings} setSettings={setSettings}
            supervisors={supervisors} setSupervisors={setSupervisors} studio={studio}
            users={users} setUsers={setUsers} addUser={addUser} inventory={items} trussInv={trussInv}
            rateCardCategories={rateCardCategories} onUpdateSubcatFactor={updateSubcatFactor}
            onUpdateSubcatCostPercent={updateSubcatCostPercent}
            onAddSubcat={addSubcat} onRenameSubcat={renameSubcat} onUpdateSubcatCategory={updateSubcatCategory}
            onSyncSubcatsFromInventory={syncSubcatsFromInventory} onDeleteSubcat={deleteSubcat}
            onUpdateSubcatFloralMode={updateSubcatFloralMode} onUpdateSubcatTagHidden={updateSubcatTagHidden}
            rcItems={studioRcItems} rcCats={studioRcCats}
            onSaveRateCardItems={saveRateCardItems} onSaveRateCardCats={saveRateCardCats}
          />
        ) : tab === "supply" ? (
          <SupplyTab
            purchase={purchase} setPurchase={setPurchase}
            inventory={items} setInventory={setInventory}
            projects={projects} functions={functions}
            prodRequests={prodRequests} setProdRequests={setProdRequests}
            studio={studio} authUser={user} settings={settings}
          />
        ) : tab === "planning" ? (
          <PlanningTab
            projects={projects} functions={functions} setFunctions={setFunctions} inventory={items} setInventory={setInventory}
            vendors={vendors} setVendors={setVendors}
            settings={settings} setSettings={setSettings} boxes={boxes} setBoxes={setBoxes}
            trussInv={trussInv} setTrussInv={setTrussInv}
            trussAlloc={trussAlloc} setTrussAlloc={setTrussAlloc} eventOrders={eventOrders} setEventOrders={setEventOrders} blocks={blocks}
            studio={studio} authUser={user}
          />
        ) : tab === "finance" ? (
          <FinanceTab
            projects={projects} functions={functions} inventory={items} purchase={purchase}
            settings={settings} setSettings={setSettings}
            overheads={overheads} setOverheads={setOverheads} authUser={user}
          />
        ) : tab === "calendar" ? (
          <CalendarTab
            lmsContracts={lmsContracts} studioLmsCache={studioLmsCache}
            onSyncLms={syncLms} lmsSyncing={lmsSyncing} settings={settings} setSettings={setSettings}
          />
        ) : tab === "flowers" ? (
          <FlowersTab
            settings={settings} setSettings={setSettings}
            functions={functions} setFunctions={setFunctions}
            supervisors={supervisors} setSupervisors={setSupervisors}
            studio={studio} authUser={user}
            syncRecipeRatesToStudio={syncRecipeRatesToStudio} tier15LastSync={tier15LastSync} tier15Syncing={tier15Syncing}
          />
        ) : tab === "approvals" ? (
          <ApprovalsTab
            amendRequests={amendRequests} saveAmendRequests={saveAmendRequests}
            authUser={user} inventory={items}
            blocks={blocks} setBlocks={setBlocksState} saveBlocks={saveBlocks}
          />
        ) : tab === "events" ? (
          <EventsTab
            eventOrders={eventOrders} setEventOrders={setEventOrders}
            inventory={items} blocks={blocks} setBlocks={setBlocks}
            saveBlocks={saveBlocks} saveEventOrders={saveEventOrders}
            projects={projects} setProjects={setProjects}
            functions={functions} setFunctions={setFunctions}
            purchase={purchase} setPurchase={setPurchase}
            settings={settings} studio={studio}
            trussInv={trussInv} setTrussInv={setTrussInv}
          />
        ) : (
          <div className="text-center text-gray-400 py-20">
            <p className="text-2xl mb-2">{TABS.find((t) => t.id === tab)?.label}</p>
            <p className="text-sm">This tab is being rebuilt in a later phase.</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Tabs } from "../../components/ui";
import { supabase, fetchAll } from "../../lib/supabase";
import { rowToItem, itemToRow, diffInventory } from "../../lib/inventory/adapter";
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
import AppSwitcher from "../../components/AppSwitcher.jsx";
import { triggerLmsSync, fetchCachedContracts, fetchSeason, buildDateCategories } from "../../lib/ims/lms";
import { allocateForDate, buildEventAllocation, eoToFnList, expireStaleSoftHolds, appendTrussAudit, TRUSS_P3_BACKFILLED_SK } from "../../lib/ims/trussEngine";
import { ensureCdnLibs } from "../../lib/ims/pdf";
import { kvGet, reliableSave } from "../../lib/ims/kv";

const LMS_STALE_MS = 30 * 60 * 1000; // re-sync in background only if cache older than 30 min
const BLOCKS_SK = "ambria-ims-blocks-v1"; // blocks document blob (faithful to reference Redis key)

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
  const [tab, setTab] = useState("dashboard");

  const [items, setItems] = useState([]);
  const [functions, setFns] = useState([]);
  const [projects, setProjectsState] = useState([]);
  const [vendors, setVendorsState] = useState([]);
  const [purchase, setPurchaseState] = useState([]);
  const [boxes, setBoxesState] = useState([]);
  const [overheads, setOverheadsState] = useState([]);
  const [supervisors, setSupervisorsState] = useState([]);
  const [prodRequests, setProdRequestsState] = useState([]);
  const [eventOrders, setEventOrdersState] = useState([]);
  const [blocks, setBlocksState] = useState({});
  const [trussAlloc, setTrussAllocState] = useState({});
  const [trussInv, setTrussInvState] = useState(INIT_TRUSS_INV);
  const [categories, setCats] = useState([]);
  const [settings, setSettingsState] = useState(SETTINGS_DEFAULTS);
  const [studioRcItems, setStudioRcItems] = useState([]);
  const [lmsContracts, setLmsContracts] = useState([]);
  const [lmsSyncing, setLmsSyncing] = useState(false);
  // Season date-categories ({ "YYYY-MM-DD": "Heavy Saya"|... }) — auto-synced from the
  // season Edge Function (no manual button). Shape matches the reference studioLmsCache.
  const [studioLmsCache, setStudioLmsCache] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Studio cross-app sync: derive cat labels / sub-cats / florals from the shared
  // rate_card table (the Studio Rate Card). Powers Inventory categories, the Admin
  // Sub-Categories viewer, and Flowers → Recipes.
  const studio = useMemo(() => {
    const catById = Object.fromEntries(RC_CATS_DEFAULT.map((c) => [c.id, c.l]));
    const byCat = {};
    const flat = new Set();
    for (const it of studioRcItems) {
      const label = catById[it.cat] || it.cat;
      if (!label) continue;
      if (!byCat[label]) byCat[label] = new Set();
      if (it.sub) { byCat[label].add(it.sub); flat.add(it.sub); }
    }
    const subcatsByCat = Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, [...v]]));
    const floralsItems = studioRcItems.filter((i) => i.cat === "florals").map((i) => ({ name: i.name, sub: i.sub, unit: i.unit, inhouseMode: i.inhouseMode }));
    const floralsSubcats = [...new Set(floralsItems.map((i) => i.sub).filter(Boolean))];
    return { subcats: [...flat], catLabels: RC_CATS_DEFAULT.map((c) => c.l), subcatsByCat, floralsItems, floralsSubcats, loading: false };
  }, [studioRcItems]);

  const itemsRef = useRef([]);
  const fnsRef = useRef([]);
  const vendorsRef = useRef([]);
  const purchaseRef = useRef([]);
  const boxesRef = useRef([]);
  const overheadsRef = useRef([]);
  const supervisorsRef = useRef([]);
  const prodRequestsRef = useRef([]);
  const eventOrdersRef = useRef([]);
  const blocksRef = useRef({});
  const projectsRef = useRef([]);
  const trussAllocRef = useRef({});
  const trussPromotedRef = useRef(new Set());
  const trussBackfilledRef = useRef(false);
  const settingsRef = useRef(SETTINGS_DEFAULTS);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { fnsRef.current = functions; }, [functions]);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  useEffect(() => { boxesRef.current = boxes; }, [boxes]);
  useEffect(() => { overheadsRef.current = overheads; }, [overheads]);
  useEffect(() => { supervisorsRef.current = supervisors; }, [supervisors]);
  useEffect(() => { prodRequestsRef.current = prodRequests; }, [prodRequests]);
  useEffect(() => { eventOrdersRef.current = eventOrders; }, [eventOrders]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { trussAllocRef.current = trussAlloc; }, [trussAlloc]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Initial load + inventory Realtime subscription ──
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [invRows, fnRows, projRows, venRows, poRows, boxRows, ohRows, supRows, prodRows, eoRows, allocRows, rcRows, trussRows, catRows, setRows] = await Promise.all([
          fetchAll("inventory"),
          fetchAll("functions").catch(() => []),
          fetchAll("projects").catch(() => []),
          fetchAll("vendors").catch(() => []),
          fetchAll("purchase_orders").catch(() => []),
          fetchAll("boxes").catch(() => []),
          fetchAll("overheads").catch(() => []),
          fetchAll("supervisors").catch(() => []),
          fetchAll("production_requests").catch(() => []),
          fetchAll("event_orders").catch(() => []),
          fetchAll("truss_allocations").catch(() => []),
          fetchAll("rate_card").catch(() => []),
          fetchAll("truss_inventory").catch(() => []),
          fetchAll("categories").catch(() => []),
          fetchAll("settings").catch(() => []),
        ]);
        if (!active) return;
        setItems(invRows.map(rowToItem));
        setFns(fnRows.map(rowToFn));
        setProjectsState(projRows.map(rowToProject));
        setVendorsState(venRows.map(rowToVendor));
        setPurchaseState(poRows.map(rowToPurchase));
        setBoxesState(boxRows.map(rowToBox));
        setOverheadsState(ohRows.map(rowToOverhead));
        setSupervisorsState(supRows.map(rowToSupervisor));
        setProdRequestsState(prodRows.map(rowToProd));
        setEventOrdersState(eoRows.map(rowToEO));
        setTrussAllocState(Object.fromEntries(allocRows.map((r) => [r.date, rowToAlloc(r)])));
        // blocks document — stored as one JSON-string blob under BLOCKS_SK (settings table).
        const blocksRow = setRows.find((r) => r.key === BLOCKS_SK);
        if (blocksRow?.value) { try { setBlocksState(typeof blocksRow.value === "string" ? JSON.parse(blocksRow.value) : blocksRow.value); } catch { /* keep {} */ } }
        setStudioRcItems(rcRows.map((r) => ({ ...(r.data || {}), id: r.id })));
        const trussRow = trussRows.find((r) => r.key === "main") || trussRows[0];
        if (trussRow?.data) setTrussInvState(trussRow.data);
        setCats(catRows.map((c) => c.name).filter(Boolean));
        const settingsObj = { ...SETTINGS_DEFAULTS };
        // Skip internal KV blobs (truss overrides/simulations/audit, blocks) — those are
        // read directly via kvGet by their owners and shouldn't pollute the settings object.
        for (const r of setRows) { if (!/^ambria-/.test(r.key)) settingsObj[r.key] = r.value; }
        setSettingsState(settingsObj);
        setLoading(false);
      } catch (e) {
        if (active) { setError(e.message || "Failed to load IMS data"); setLoading(false); }
      }
    })();

    const channel = supabase
      .channel("realtime:inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, (payload) => {
        setItems((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== payload.old.id);
          const next = rowToItem(payload.new);
          if (prev.some((r) => r.id === next.id)) return prev.map((r) => (r.id === next.id ? next : r));
          return [...prev, next];
        });
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
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
        let alreadyDone = false;
        try { alreadyDone = localStorage.getItem(TRUSS_P3_BACKFILLED_SK) === "1"; } catch { /* ignore */ }
        if (!alreadyDone) { const redisFlag = await kvGet(TRUSS_P3_BACKFILLED_SK); alreadyDone = redisFlag === "1" || redisFlag === '"1"'; }
        if (alreadyDone) { trussBackfilledRef.current = true; return; }
        const soldEos = eventOrders.filter((eo) => eo && eo.id && eo.status && eo.status !== "pending");
        const eosToBackfill = soldEos.filter((eo) => {
          const d = eo.date || eo.functionsDetail?.[0]?.date || "";
          if (!d) return false;
          return !(trussAllocRef.current[d]?.events || []).some((ev) => ev.eoId === eo.id);
        });
        if (eosToBackfill.length === 0) {
          await reliableSave(TRUSS_P3_BACKFILLED_SK, "1", "Phase 3 backfill flag");
          try { localStorage.setItem(TRUSS_P3_BACKFILLED_SK, "1"); } catch { /* ignore */ }
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
        try { localStorage.setItem(TRUSS_P3_BACKFILLED_SK, "1"); } catch { /* ignore */ }
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

  // blocks — one document blob ({ [itemId]: [reservations] }); persisted whole under
  // BLOCKS_SK (faithful to the reference's single Redis blob).
  const persistBlocks = (next) => {
    reliableSave(BLOCKS_SK, JSON.stringify(next || {}), "Blocks").then((r) => { if (!r.ok && r.error) setError(`Save failed: ${r.error}`); });
  };
  const setBlocks = useCallback((updater) => {
    const prev = blocksRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    blocksRef.current = next;
    setBlocksState(next);
    persistBlocks(next);
  }, []);
  const saveBlocks = useCallback((val) => {
    const next = typeof val === "function" ? val(blocksRef.current) : val;
    blocksRef.current = next;
    setBlocksState(next);
    persistBlocks(next);
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
  const allowedTabs = isAdmin ? TABS : TABS.filter((t) => (roleConfig.tabs || []).includes(t.id));

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
            projects={projects} functions={functions} setFunctions={setFunctions} inventory={items}
            vendors={vendors} setVendors={setVendors}
            settings={settings} setSettings={setSettings} boxes={boxes} setBoxes={setBoxes}
            trussInv={trussInv} setTrussInv={setTrussInv}
            trussAlloc={trussAlloc} setTrussAlloc={setTrussAlloc} eventOrders={eventOrders}
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
            supervisors={supervisors} setSupervisors={setSupervisors}
            studio={studio} authUser={user}
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

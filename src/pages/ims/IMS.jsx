import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase, fetchAll, updateRow, deleteRow } from "../../lib/supabase";
import { rowToItem, itemToRow, diffInventory } from "../../lib/inventory/adapter";
import { computePatternSizeCost, effectiveMarkup, assembleMandiCatalogueFromRows, assembleFlowerPatternsFromRows } from "../../lib/ims/flowerHelpers";
import { assembleLabourTiersFromRows, assembleDihariSchemesFromRows, assembleDefaultWindowsByPhaseFromRows } from "../../lib/ims/labourTypes";
import { assembleVenueMinLabourFromRows, assembleVenueDumpingFromRows } from "../../lib/ims/venueLabourConfig";
import { assemblePrintMaterialsFromRows, assembleCarpetMaterialsFromRows, assemblePlatformRatesFromRows, assembleMaskingRatesFromRows, assembleTrussRatesFromRows } from "../../lib/studio/taxonomy";
import { createSettingsWriter } from "../../lib/ims/settingsWriter";
import { SETTINGS_DEFAULTS, INIT_TRUSS_INV, DEFAULT_ROLE_TABS, assembleHeavyElementRangesFromRows, assembleTrussLabourRangesFromRows, assembleFabricBangaliRangesFromRows } from "../../lib/ims/constants";
import SiteSupervisorTab from "./SiteSupervisorTab.jsx";
import { assembleAttendanceLocationsFromRows, assembleAttendanceTrainingByDeptFromRows } from "../../lib/ims/attendance";
import { assembleSynonymDictionaryFromRows } from "../../lib/studio/tagging/matcher";
import { assembleMarkedDatesFromRows } from "../../lib/inventory/helpers";
import { RC_CATS_DEFAULT } from "../../lib/studio/constants";
import InventoryTab from "./InventoryTab.jsx";
import AttendanceTab from "./AttendanceTab.jsx";
import DashboardTab from "./DashboardTab.jsx";
import AdminTab from "./AdminTab.jsx";
import SupplyTab from "./SupplyTab.jsx";
import PlanningTab from "./PlanningTab.jsx";
import FinanceTab from "./FinanceTab.jsx";
import CalendarTab from "./CalendarTab.jsx";
import FlowersTab from "./FlowersTab.jsx";
import ApprovalsTab from "./ApprovalsTab.jsx";
import { useEventOrderAutoConfirm } from "../../lib/ims/eventAutoConfirm";
import { AMEND_SK, canApprove } from "../../lib/ims/amend";
import { fetchMyLabourAccess, labourPunchDepts } from "../../lib/ims/labourAttendance";
import AppSwitcher from "../../components/AppSwitcher.jsx";
import PullToRefresh from "../../components/shared/PullToRefresh.jsx";
import { useSwipeDrawer } from "../../lib/useSwipeDrawer";
import { triggerLmsSync, fetchCachedContracts, fetchSeason, buildDateCategories, crossReferenceContracts } from "../../lib/ims/lms";
import { allocateForDate, buildEventAllocation, eoToFnList, appendTrussAudit, TRUSS_P3_BACKFILLED_SK } from "../../lib/ims/trussEngine";
import { allocatePlatformForDate, buildEventPlatformAllocation, appendPlatformAudit, PLATFORM_BACKFILLED_SK } from "../../lib/ims/platformEngine";
import { allocateBattaForDate, buildEventBattaAllocation, appendBattaAudit, BATTA_BACKFILLED_SK } from "../../lib/ims/battaEngine";
import { ensureCdnLibs } from "../../lib/ims/pdf";
import { kvGet, reliableSave } from "../../lib/ims/kv";
import { rowToRcItem, rcItemToRow } from "../../lib/rateCard";
import { registerFlushBeforeReload, unregisterFlushBeforeReload, flushBeforeReload } from "../../lib/pendingSaveRegistry";
import { reportSaveProblem, clearSaveProblem } from "../../lib/saveHealth";
import { writeWithRetry } from "../../lib/writeRetry";

const LMS_STALE_MS = 30 * 60 * 1000; // re-sync in background only if cache older than 30 min
// BLOCKS_SK / RC_SK removed 30 Jul 2026: both were unused here (declaration + comments only) and
// their blobs are gone — blocks live in the `blocks` table and rate-card items in `rate_card`.
// The comments below still name them when explaining that history, which is fine.
const RC_SK_CATS = "ambria-rccats-v1"; // Rate Card *categories* — edited here in IMS as of Phase 3 (Studio's RateCard.jsx is now read-only)

// blocks `blocks` TABLE rows (row-per-item) → in-memory { [itemId]: [reservations] } shape.
const blocksRowsToMap = (rows) => Object.fromEntries((rows || []).map((r) => [r.item_id || r.id, Array.isArray(r.data) ? r.data : []]));

// Exact tab set + labels from the reference IMS app.
const TABS = [
  { id: "dashboard", label: "📊 Dashboard" },
  { id: "attendance", label: "👥 Attendance" },
  { id: "inventory", label: "📦 Inventory" },
  { id: "calendar", label: "🗓️ Calendar" },
  { id: "planning", label: "📋 Planning" },
  { id: "supply", label: "🛒 Supply" },
  { id: "flowers", label: "🌺 Flowers" },
  { id: "finance", label: "💰 Finance" },
  { id: "admin", label: "⚙️ Admin" },
  { id: "site", label: "🦺 Site" },
];

// Vertical nav rail. Shared by the lg+ sidebar and the mobile drawer so the two can never
// drift — the drawer only differs in closing itself after a pick.
// Labels arrive as "📊 Dashboard" (and "✅ Approvals (3)" when there are pending ones), so the
// leading glyph is split off to sit in its own column: with the icons aligned, the rail can be
// read down the labels alone, which a strip of emoji-prefixed pills could not do.
// A tab may carry `children` (Attendance's sub-views): collapsed by default, shown indented under
// it while expanded[tab.id] is set (IMS.jsx owns that, so the rail and the phone drawer agree) or
// while one of them is the open view. Picking one calls onSub(tabId, childId). The parent row reads
// as current only while no child is open, so exactly one row in the rail is ever highlighted.
function IMSNav({ tabs, active, onChange, activeSub, onSub, expanded = {} }) {
  return (
    <nav className="flex flex-col gap-1">
      {tabs.map((t) => {
        const sp = t.label.indexOf(" ");
        const icon = sp > 0 ? t.label.slice(0, sp) : "•";
        const text = sp > 0 ? t.label.slice(sp + 1) : t.label;
        const hasKids = t.children?.length > 0;
        const on = active === t.id && !(hasKids && activeSub);
        const showKids = hasKids && (!!expanded[t.id] || (active === t.id && !!activeSub));
        return (
          <div key={t.id}>
          {navRow(t, icon, text, on, onChange, hasKids ? showKids : null)}
          {hasKids && showKids && (
            <div className="mt-0.5 mb-1 ml-5 pl-3 border-l border-gray-200 flex flex-col gap-0.5">
              {t.children.map((c) => {
                const con = active === t.id && activeSub === c.id;
                return (
                  <button key={c.id} onClick={() => onSub(t.id, c.id)} aria-current={con ? "page" : undefined}
                    className={"w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] truncate transition-colors " +
                      (con ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-gray-500 font-medium hover:bg-gray-50 hover:text-gray-900")}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
          </div>
        );
      })}
    </nav>
  );
}

// One top-level rail row (the key lives on the wrapper in IMSNav).
// `open` is null for a row with no sub-items, else whether they are showing (draws the chevron).
function navRow(t, icon, text, on, onChange, open) {
        return (
          /* The hover lifts and nudges right rather than only tinting: the rail is a column of
             identical rows, and a tint alone is easy to miss on the row the cursor is actually
             over. transition-all so the shadow and the nudge arrive together — `transition`
             alone animates neither transform nor box-shadow to the same curve here. */
          <button onClick={() => onChange(t.id)} aria-current={on ? "page" : undefined}
            className={"w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-all duration-150 " +
              (on
                ? "bg-indigo-50 text-indigo-700 font-semibold shadow-[0_1px_2px_rgba(79,70,229,0.14),0_4px_10px_-4px_rgba(79,70,229,0.3)]"
                : "text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900 hover:translate-x-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)]")}>
            <span aria-hidden="true" className="shrink-0 w-5 text-center text-base leading-none">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {open != null && (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                className={"shrink-0 text-gray-400 transition-transform duration-150 " + (open ? "rotate-90" : "")}>
                <path d="M5 3.5 L8.5 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        );
}

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

const rowToOverhead = (row) => ({ ...(row.data || {}), id: row.id, amount: row.amount ?? row.data?.amount ?? 0, category: row.category ?? row.data?.category });
const overheadToRow = (o) => ({ id: o.id, name: o.description ?? null, amount: o.amount ?? 0, category: o.category ?? null, data: o });

const rowToSupervisor = (row) => ({ id: row.id, name: row.name, phone: row.phone, active: row.active });
const supervisorToRow = (s) => ({ id: s.id, name: s.name ?? null, phone: s.phone ?? null, active: s.active ?? true });

const rowToUser = (row) => ({ id: row.id, name: row.name, username: row.username, role: row.role, permissions: row.permissions || [], active: row.active ?? true, phone: row.phone, email: row.email, apps: row.apps ?? null, departments: row.departments ?? null, tabOverride: row.tab_override ?? null, createdAt: row.created_at });
// ═══ A STABLE ORDER FOR THE USERS TABLE ═══
// fetchAll is a bare select("*") with no ORDER BY, so Postgres hands back rows in physical order.
// An UPDATE does not edit a row in place — it writes a NEW tuple, usually at the end of the table
// — so editing a user or changing their role sent them to the BOTTOM of the list the moment the
// realtime refetch landed. Nothing was wrong with the save; the list simply had no order to keep.
//
// Anyone just edited goes to the TOP, most recent first; everyone else stays alphabetical beneath
// them, because the rest of the table is read to find a person.
//
// Recency is tracked in the browser, not read from the row: `users` has created_at and no
// updated_at, so the database cannot answer "who changed last" without a migration and a trigger.
// The trade is that the order resets on reload — which is the right behaviour anyway. "Show me who
// I just touched" is about this sitting, not a property of the user that should outlive it.
//
// localeCompare rather than < so accented and non-ASCII names land where a reader expects, and the
// id as a tiebreak so two people sharing a name hold a fixed order instead of swapping on refetch.
const sortUsers = (list, recentIds = []) => {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    if (ra !== rb) return ra - rb;
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
      || String(a.id || "").localeCompare(String(b.id || ""));
  });
};
// Passwords live in Supabase Auth now — NEVER write a `password` column (it was dropped in migration
// 005). Sending it makes every users upsert fail ("Could not find the 'password' column"). Password
// changes go through the user-admin edge function instead.
const userToRow = (u) => ({ id: u.id, name: u.name ?? null, username: u.username ?? null, role: u.role ?? "Sales", permissions: u.permissions || [], active: u.active ?? true, phone: u.phone ?? null, email: u.email ?? null, apps: u.apps ?? null, departments: Array.isArray(u.departments) && u.departments.length ? u.departments : null, tab_override: (u.tabOverride && Object.keys(u.tabOverride).length) ? u.tabOverride : null });

const rowToProd = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });
const prodToRow = (p) => ({ id: p.id, item_id: p.inventoryId ?? null, fn_id: p.functionId ?? null, status: p.status ?? "Requested", data: p });

// event_orders — read-mostly here (Truss uses it as a legacy fallback; Events tab is a
// later phase). Full object carried so the eventual Events build is forward-compatible.
const rowToEO = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });

// truss_allocations — keyed by date. The reference treats trussAlloc as an object
// { [date]: entry } where entry = { events, pool, stockSummary, ... }. The table has
// date / events / pool columns, so the non-events remainder of the entry rides in `pool`.
// Soft-hold events are gone (a truss is reserved only when a deal is sold); one left in a row by the old
// feature is dropped here, and the next write of that date removes it from the row.
const rowToAlloc = (row) => ({ ...(row.pool || {}), date: row.date, events: (row.events || []).filter((ev) => ev?.state !== "soft") });
const allocToRow = (date, entry) => {
  const { events, date: _d, ...rest } = entry || {};
  return { date, events: events || [], pool: rest };
};

export default function IMS() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Remember the last open IMS tab so toggling to Studio and back returns here (not Dashboard).
  const [tab, setTab] = useState(() => {
    const isValidTab = (id) => id === "approvals" || TABS.some((t) => t.id === id);
    // A deep link (e.g. "🔗 Open IMS Inventory" in Build's Add Production/Buying Item modal, opened
    // as `#/ims?tab=inventory` in a new tab) wins over the remembered last tab — asking for a
    // SPECIFIC tab by URL is the whole point of a deep link, so it should not land on whatever this
    // browser tab last happened to have open instead. HashRouter puts the query string after the
    // hash too (`#/ims?tab=...`), not in location.search, so read it off location.hash directly.
    const urlTab = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab");
    if (urlTab && isValidTab(urlTab)) return urlTab;
    const saved = sessionStorage.getItem("ambria-ims-tab");
    // Guard against a stale value from a removed tab (e.g. the old "events" tab) — fall back to
    // dashboard instead of landing on the dead "this tab is being rebuilt" placeholder.
    // "approvals" is valid too even though it's added to the nav dynamically, not in TABS itself.
    return saved && isValidTab(saved) ? saved : "dashboard";
  });
  useEffect(() => { sessionStorage.setItem("ambria-ims-tab", tab); }, [tab]);
  // Attendance's open sub-view (null = the punch screen) — picked from the sidebar's Attendance
  // sub-items, so it lives here rather than inside AttendanceTab. Not persisted: a reload lands on
  // the punch screen, which is what most people opening Attendance came for.
  const [attView, setAttView] = useState(null);
  const [attOpen, setAttOpen] = useState(false);   // Attendance's sub-items showing in the rail
  // Labour-punch access granted to this user (Admin grants it). Loaded here because it decides
  // whether the sidebar shows "Labour Punch" at all. A failed load (table missing) = no rows.
  const [myLabourAccess, setMyLabourAccess] = useState([]);
  const reloadLabourAccess = useCallback(() => {
    if (!user?.id) return;
    fetchMyLabourAccess(user.id).then(setMyLabourAccess).catch(() => setMyLabourAccess([]));
  }, [user?.id]);
  useEffect(() => { reloadLabourAccess(); }, [reloadLabourAccess]);
  // Mobile nav drawer. Deliberately not persisted — a drawer that reopens itself on reload is
  // a drawer nobody asked for.
  const [navOpen, setNavOpen] = useState(false);
  // Phones: swipe left→right to open the drawer, right→left to close it (lib/useSwipeDrawer.js).
  useSwipeDrawer({ open: navOpen, onOpen: () => setNavOpen(true), onClose: () => setNavOpen(false) });
  // ── CALENDAR → PLANNING HAND-OFF ──
  // Clicking a Studio booking in the Calendar tab opens it in Planning → Dept Ops. Three things
  // have to line up: the top-level tab, Planning's own sub-tab, and the event Dept Ops selects.
  // The sub-tab goes through the sessionStorage key PlanningTab already initialises from — it
  // mounts fresh when the tab switches, so writing the key before setTab is what it reads. The
  // event id travels as state because it is a one-shot the receiver clears, not a preference
  // that should survive a reload.
  const [focusEventId, setFocusEventId] = useState(null);
  const [focusSearch, setFocusSearch] = useState("");
  // eoId may be null: an LMS lead that has never been matched to a Studio deal has no
  // event_order to select. Rather than refuse to navigate, Planning still opens and the client
  // name goes into its search box — so a deal filed under a slightly different name surfaces
  // immediately, and an empty list is itself the answer ("this lead isn't sold yet").
  const [focusLeadEntry, setFocusLeadEntry] = useState(null);
  const openEventInPlanning = (eoId, searchName = "", leadEntryNo = null) => {
    try { sessionStorage.setItem("ambria-ims-planning-sub", "deptops"); } catch { /* private mode */ }
    setFocusEventId(eoId || null);
    setFocusSearch(eoId ? "" : (searchName || ""));
    // Only meaningful when there is no deal yet — it is what lets "Build this deal in Studio"
    // open Studio on THIS contract rather than just a name search.
    setFocusLeadEntry(eoId ? null : (leadEntryNo || null));
    setTab("planning");
  };
  // Stable identity: Dept Ops lists this in an effect's deps, so an inline arrow here would
  // give it a new function every IMS render and re-run that effect on each one.
  const clearFocusEvent = useCallback(() => { setFocusEventId(null); setFocusSearch(""); setFocusLeadEntry(null); }, []);
  // The return leg. Dept Ops has no event picker of its own any more, so it needs a way back to
  // the Calendar, which is where events are chosen. Only shown when the tab is permitted.
  const goToCalendar = useCallback(() => setTab("calendar"), []);

  const [items, setItems] = useState([]);
  const [functions, setFns] = useState([]);
  const [projects, setProjectsState] = useState([]);
  const [vendors, setVendorsState] = useState([]);
  const [purchase, setPurchaseState] = useState([]);
  const [overheads, setOverheadsState] = useState([]);
  const [supervisors, setSupervisorsState] = useState([]);
  const [users, setUsersState] = useState([]);
  const [prodRequests, setProdRequestsState] = useState([]);
  const [eventOrders, setEventOrdersState] = useState([]);
  const [blocks, setBlocksState] = useState({});
  const [amendRequests, setAmendRequests] = useState([]);
  const [trussAlloc, setTrussAllocState] = useState({});
  const [platformAlloc, setPlatformAllocState] = useState({});
  const [battaAlloc, setBattaAllocState] = useState({});
  const [trussInv, setTrussInvState] = useState(INIT_TRUSS_INV);
  // True once the real truss_inventory row has actually landed (a successful fetch, even one that
  // genuinely found zero rows — a fresh install) OR a realtime update has delivered it. Guards
  // setTrussInv below from ever upserting the INIT_TRUSS_INV placeholder over real data: confirmed
  // live (owner report 2026-11-04) — `fetchAll("truss_inventory").catch(() => [])` silently
  // swallows a transient fetch failure into an empty array, `trussRow?.data` is then falsy so the
  // real row never replaces the placeholder, yet `loading` still flips to false (every OTHER table
  // loaded fine) with no visible error — so the WHOLE IMS UI looked normal while trussInv quietly
  // sat at empty defaults, and the very next Fabric Stock/Truss Config edit upserted that empty
  // placeholder straight over the real 9/24/14-row data.
  const trussInvLoadedRef = useRef(false);
  // Per-table "did the initial fetch ACTUALLY succeed" tracking, for tables whose writers could do
  // real damage on a failed-fetch-collapsed-to-empty state: blocks/truss_allocations/
  // platform_allocations/batta_allocations are each one row covering MANY events, so a write built
  // from an empty `prev` doesn't just skip rows it never saw (like every other row-level table in
  // this file already safely does) — it deletes every other event's data in that row. Also drives
  // the auto-confirm pipeline's own `ready` gate below (owner report 2026-11-05).
  const loadOkRef = useRef({});
  const markTableLoaded = (t) => { loadOkRef.current[t] = true; };
  const markTableFailed = (t, err) => { loadOkRef.current[t] = false; if (err) console.warn(`[IMS] ${t} fetch failed:`, err?.message || err); };
  const [categories, setCats] = useState([]);
  const [settings, setSettingsState] = useState(SETTINGS_DEFAULTS);
  // True once the real settings row(s) have loaded at least once — guards the LMS auto-category
  // sync below from ever persisting on top of the SETTINGS_DEFAULTS placeholder (a race would
  // otherwise be able to wipe an admin's real datePricing.categories/markedDates back to defaults).
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Mirrors settingsLoaded into a ref so setSettings (a useCallback that must stay referentially
  // stable) can read the latest value without it being a stale closure or a dep that re-creates
  // the callback on every load.
  const settingsLoadedRef = useRef(false);
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
  // Hidden run started by Studio's Deal Check "All departments PDF" (#/ims?pdfEvent=ID, in an invisible frame):
  // once the data is in, open that event in Planning → Dept Ops, which builds and downloads the PDF.
  const [autoPdfFor, setAutoPdfFor] = useState(() => {
    try { const m = /[?&]pdfEvent=([^&]+)/.exec(window.location.hash); return m && window.self !== window.top ? decodeURIComponent(m[1]) : null; } catch { return null; }
  });
  const autoPdfOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoPdfFor || loading || autoPdfOpenedRef.current) return;
    autoPdfOpenedRef.current = true;
    openEventInPlanning(autoPdfFor);
  }, [autoPdfFor, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const finishAutoPdf = useCallback(() => setAutoPdfFor(null), []);
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
      // Map a rate-card item's category id → label. An unresolved id means its OWN category row
      // was since deleted/renamed (or never existed) with these items never reassigned — there's
      // no real name left to show, so it pools under "Uncategorized" rather than leaking the raw
      // id (database-generated or a stale literal word like "truss"/"arches" from an old seed
      // taxonomy) into the category picker as its own permanent, always-empty-looking bucket. This
      // used to surface anything that wasn't an auto-generated "cat_xxxxx" id under itself
      // instead — confirmed live (2026-10-26): that's exactly why deleting one of these from the
      // Sub-Categories editor never actually got rid of it; the literal rate_card rows still
      // carrying that old cat value re-derive it fresh on every render regardless of what's in the
      // admin-managed category list. Pooling loses nothing — these items' sub-categories still
      // show, just grouped under Uncategorized instead of sprawled across N fake categories.
      const label = catById[it.cat] || "Uncategorized";
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
  const overheadsRef = useRef([]);
  const supervisorsRef = useRef([]);
  const usersRef = useRef([]);
  // Ids of users edited this session, most recent first — see sortUsers. A ref, not state, because
  // the realtime subscription's callback is created once and would otherwise close over an empty
  // array forever, sorting every refetch as though nothing had been touched.
  const recentUsersRef = useRef([]);
  const prodRequestsRef = useRef([]);
  const eventOrdersRef = useRef([]);
  const blocksRef = useRef({});
  const projectsRef = useRef([]);
  const trussAllocRef = useRef({});
  const trussPromotedRef = useRef(new Set());
  const trussBackfilledRef = useRef(false);
  const platformAllocRef = useRef({});
  const platformPromotedRef = useRef(new Set());
  const platformBackfilledRef = useRef(false);
  const battaAllocRef = useRef({});
  const battaPromotedRef = useRef(new Set());
  const battaBackfilledRef = useRef(false);
  const settingsRef = useRef(SETTINGS_DEFAULTS);
  // Mandi flower catalogue rows (migration 039) — read by applySettingsRows below so its own full
  // settingsObj rebuilds (triggered by ANY unrelated settings-table change) never lose the catalogue
  // this ref already holds.
  const mandiRowsRef = useRef([]);
  // Flower recipe pattern rows (migration 040) — same reasoning as mandiRowsRef above.
  const patternRowsRef = useRef([]);
  // Labour type rows (migration 041) — same reasoning, feeds THREE settings fields at once
  // (labourTiers/dihariSchemes/defaultWindowsByPhase).
  const labourTypeRowsRef = useRef([]);
  // Venue labour config rows (migration 042) — same reasoning, feeds venueMinLabour/venueDumping.
  const venueLabourRowsRef = useRef([]);
  // Rate-list rows (migration 043) — same reasoning, one ref per table (each feeds one settings field).
  const printMaterialRowsRef = useRef([]);
  const carpetMaterialRowsRef = useRef([]);
  const platformRateRowsRef = useRef([]);
  const maskingRateRowsRef = useRef([]);
  const trussRateRowsRef = useRef([]);
  // Manpower range-ladder rows (migration 044) — same reasoning.
  const heavyElementRangeRowsRef = useRef([]);
  const trussLabourRangeRowsRef = useRef([]);
  const fabricBangaliRangeRowsRef = useRef([]);
  // Attendance locations/training + synonym dictionary rows (migration 045) — same reasoning.
  const attendanceLocationRowsRef = useRef([]);
  const attendanceTrainingRowsRef = useRef([]);
  const synonymGroupRowsRef = useRef([]);
  // datePricing.markedDates rows (migration 046) — same reasoning, merged as a SUB-FIELD of
  // datePricing (not a whole top-level settings field) since categories/autoCategories/etc. stay
  // in the settings blob, protected by merge_settings_json.
  const markedDateRowsRef = useRef([]);
  // Every setX below updates React state synchronously, then persists to Supabase via a
  // fire-and-forget async IIFE that nothing awaits — a real bug, confirmed by direct DB
  // inspection: a sold deal's auto-confirm engine (executeConfirmBlocks → createProjectFromEO)
  // called setProjects(...) then setFunctions(...) back to back; the projects row landed but the
  // functions row never did, because whoever's IMS tab ran that auto-confirm navigated away
  // (Studio switcher, tab close, refresh) while the functions upsert loop was still mid-flight —
  // there was nothing tracking it, so nothing could wait for it. trackWrite lets every one of
  // these writers register its in-flight promise here; registerFlushBeforeReload (below) awaits
  // the lot before the shared Studio/IMS switcher — or IMS's own beforeunload/pagehide — lets a
  // navigation proceed. Doesn't guarantee a hard tab-close (browsers don't allow blocking that),
  // but closes the far more common gap: clicking "Studio" or reloading right after a write kicks
  // off, which is exactly what a background auto-confirm engine racing a human clicking around
  // looks like.
  const pendingWritesRef = useRef(new Set());
  const trackWrite = useCallback((p) => {
    pendingWritesRef.current.add(p);
    p.finally(() => pendingWritesRef.current.delete(p));
    return p;
  }, []);
  // Registers with the SAME registry Studio's build autosave already uses — so the shared
  // AppSwitcher (Studio ⇄ IMS) now awaits IMS's own pending writes too, not just Studio's, before
  // it navigates. Best-effort only, same as Studio's: can't guarantee a hard tab close, but covers
  // the actual trigger that produced the missing-functions-row bug — clicking "Studio" or
  // reloading right after the auto-confirm engine (or any setX above) kicks off its writes.
  useEffect(() => {
    const flush = async () => { await Promise.allSettled([...pendingWritesRef.current]); };
    registerFlushBeforeReload(flush);
    const onBeforeUnload = (e) => {
      if (pendingWritesRef.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onPageHide = () => { flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unregisterFlushBeforeReload(flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
  const studioRcItemsRef = useRef([]);
  useEffect(() => { studioRcItemsRef.current = studioRcItems; }, [studioRcItems]);
  const rateCardCategoriesRef = useRef([]);
  useEffect(() => { rateCardCategoriesRef.current = rateCardCategories; }, [rateCardCategories]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { fnsRef.current = functions; }, [functions]);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  useEffect(() => { overheadsRef.current = overheads; }, [overheads]);
  useEffect(() => { supervisorsRef.current = supervisors; }, [supervisors]);
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { prodRequestsRef.current = prodRequests; }, [prodRequests]);
  useEffect(() => { eventOrdersRef.current = eventOrders; }, [eventOrders]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { trussAllocRef.current = trussAlloc; }, [trussAlloc]);
  useEffect(() => { platformAllocRef.current = platformAlloc; }, [platformAlloc]);
  useEffect(() => { battaAllocRef.current = battaAlloc; }, [battaAlloc]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Settings are a key→value table; persist only the keys that changed. Declared here (rather
  // than near its other read/write siblings further down) so effects that run earlier in this
  // component — like the LMS/season sync — can depend on it without a temporal-dead-zone error.
  // Every write goes through one ordered, coalescing queue (lib/ims/settingsWriter.js): fast typing used
  // to fire overlapping upserts that could land out of order, leave an older keystroke in the database,
  // and have its realtime echo wind the field back under the person typing.
  // Discarding a failed settings write (SaveHealthBanner's Discard button) abandons the local edit
  // — the writer's own discardKey() stops it being treated as dirty, but the SCREEN still shows
  // that abandoned local value until something re-syncs it from the database. Re-running the same
  // apply the realtime subscription uses closes that gap. applySettingsRows is referenced here
  // before its own declaration below — safe, same as this file's many other forward references to
  // a stable useCallback (see the existing no-use-before-define warnings on setTrussAlloc etc.):
  // this closure only runs later, on a user's Discard click, by which point it's long since assigned.
  const refetchSettingsAfterDiscard = () => { fetchAll("settings").then((rows) => applySettingsRows(rows)).catch(() => {}); };

  // ── Phase 3: background recovery for a table that failed its INITIAL load ──
  // Previously the only way back from "truss_inventory/settings/blocks failed to load" was a full
  // page reload — these three are the tables a real past incident already hit, so they're worth an
  // in-place retry path: reported via saveHealth as `blocked:true` WITH a retry function (unlike most
  // blocked entries, which still need Reload), so the SAME manual-retry/one-shot-on-reconnect
  // mechanism this effort already built for write failures also recovers a failed load, without
  // throwing away whatever else on screen loaded fine. Each retry function re-reports itself on a
  // repeat failure (fresh error, same retry closure shape) — same idiom as mergeDatePricing's/
  // runMerge's own retry closures.
  // Every retry below short-circuits (before the fetch, after it, and on failure) the moment its
  // table is ALREADY marked loaded — nothing stops a manual Retry click, "Retry all", and the
  // one-shot reconnect retry from overlapping for the same table, and with no guard: (a) a LATE
  // failure from an older, slower attempt could run AFTER a different attempt already succeeded,
  // flipping a genuinely-loaded table's flag back to false and refusing every write again for no
  // reason; (b) worse, two overlapping SUCCESSFUL fetches could apply out of order — an older
  // snapshot landing after a newer one (or after realtime deltas that arrived in between) would
  // silently revert it, which for `blocks` (one row holds EVERY event's reservations on an item)
  // is exactly the data-loss class this whole effort exists to prevent. Checking the flag instead of
  // tracking request identity is sufficient here: once ANY attempt has genuinely loaded the table,
  // every other concurrent attempt backing off to {ok:true} is correct regardless of which one
  // "really" finished first.
  const reportSettingsLoadFailed = (err) => {
    reportSaveProblem("load:settings", {
      label: "Settings", error: err, blocked: true,
      retry: async () => {
        if (settingsLoadedRef.current) return { ok: true };
        const mark = settingsWriterRef.current?.mark();
        try {
          const rows = await fetchAll("settings");
          if (settingsLoadedRef.current) return { ok: true };
          applySettingsRows(rows, mark);
          setError((cur) => (cur?.startsWith("Settings failed to load") || cur?.startsWith("Settings haven't loaded yet") ? "" : cur));
          return { ok: true };
        } catch (e) {
          if (settingsLoadedRef.current) return { ok: true };
          markTableFailed("settings", e);
          reportSettingsLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  const reportTrussInvLoadFailed = (err) => {
    reportSaveProblem("load:truss_inventory", {
      label: "Truss/fabric inventory", error: err, blocked: true,
      retry: async () => {
        if (trussInvLoadedRef.current) return { ok: true };
        try {
          const rows = await fetchAll("truss_inventory");
          if (trussInvLoadedRef.current) return { ok: true };
          const row = rows.find((r) => r.key === "main") || rows[0];
          if (row?.data) setTrussInvState(row.data);
          trussInvLoadedRef.current = true;
          setError((cur) => (cur?.startsWith("Truss/fabric inventory failed to load") || cur?.startsWith("Truss/fabric inventory hasn't finished loading") ? "" : cur));
          return { ok: true };
        } catch (e) {
          if (trussInvLoadedRef.current) return { ok: true };
          console.warn("[IMS] truss_inventory retry failed:", e?.message || e);
          reportTrussInvLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  const reportBlocksLoadFailed = (err) => {
    reportSaveProblem("load:blocks", {
      label: "Block reservations", error: err, blocked: true,
      retry: async () => {
        if (loadOkRef.current.blocks === true) return { ok: true };
        try {
          const rows = await fetchAll("blocks");
          if (loadOkRef.current.blocks === true) return { ok: true };
          const bm = blocksRowsToMap(rows);
          blocksRef.current = bm; setBlocksState(bm);
          markTableLoaded("blocks");
          setError((cur) => (cur?.startsWith("Block reservations haven't loaded") ? "" : cur));
          return { ok: true };
        } catch (e) {
          if (loadOkRef.current.blocks === true) return { ok: true };
          markTableFailed("blocks", e);
          reportBlocksLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  // The three allocation tables share blocks' exact risk shape (one row per DATE holds every
  // event's allocation on it, not just the writer's own), so they get the identical background-
  // recovery treatment: same 3-point overlap guard, same apply-matches-the-realtime-handler shape.
  const makeAllocLoadReporter = (table, loadOkKey, label, setState) => {
    const report = (err) => {
      reportSaveProblem(`load:${table}`, {
        label, error: err, blocked: true,
        retry: async () => {
          if (loadOkRef.current[loadOkKey] === true) return { ok: true };
          try {
            const rows = await fetchAll(table);
            if (loadOkRef.current[loadOkKey] === true) return { ok: true };
            setState(Object.fromEntries(rows.map((r) => [r.date, rowToAlloc(r)])));
            markTableLoaded(loadOkKey);
            setError((cur) => (cur?.startsWith(`${label} haven't loaded`) ? "" : cur));
            return { ok: true };
          } catch (e) {
            if (loadOkRef.current[loadOkKey] === true) return { ok: true };
            markTableFailed(loadOkKey, e);
            report(e);
            return { ok: false };
          }
        },
      });
    };
    return report;
  };
  const reportTrussAllocLoadFailed = makeAllocLoadReporter("truss_allocations", "truss_allocations", "Truss allocations", setTrussAllocState);
  const reportPlatformAllocLoadFailed = makeAllocLoadReporter("platform_allocations", "platform_allocations", "Platform allocations", setPlatformAllocState);
  const reportBattaAllocLoadFailed = makeAllocLoadReporter("batta_allocations", "batta_allocations", "Batta allocations", setBattaAllocState);
  // inventory/functions/projects/purchase_orders/event_orders are plain row-level tables (Key
  // Architecture Rule #1 — row updates, never a merged whole-table write), so unlike
  // settings/blocks/the 3 allocation tables above they never needed a write-REFUSAL guard: a failed
  // load just means this tab's own in-memory list is empty/incomplete, not that a write here could
  // stomp some OTHER row's data. What they were missing is the other half — VISIBILITY and a way to
  // recover without a full reload — so this is the same blocked-report + 3-point-overlap-guard
  // retry shape as above, just over a plain array instead of a date-keyed object.
  // `ref` is each table's own xRef (fnsRef/projectsRef/purchaseRef/eventOrdersRef) — these are only
  // synced from state by a `useEffect(() => { xRef.current = x }, [x])` elsewhere in this file,
  // which runs AFTER commit, not synchronously with setState. A writer that diffs off the ref
  // (setFunctions/setProjects/setPurchase) or a realtime handler that merges off the ref
  // (event_orders' own channel) could fire in that gap and either diff against a stale/empty ref
  // (silently re-writing rows that already exist remotely) or merge a live update into a stale base
  // and have the retry's own (now out of date) snapshot overwrite it a moment later. Setting the ref
  // here too, synchronously with setState, closes that specific gap — same as inventory's own
  // itemsRef, which has always done this for exactly this reason.
  const makeListLoadReporter = (table, loadOkKey, label, setState, rowToX, ref) => {
    const report = (err) => {
      reportSaveProblem(`load:${table}`, {
        label, error: err, blocked: true,
        retry: async () => {
          if (loadOkRef.current[loadOkKey] === true) return { ok: true };
          try {
            const rows = await fetchAll(table);
            if (loadOkRef.current[loadOkKey] === true) return { ok: true };
            const mapped = rows.map(rowToX);
            if (ref) ref.current = mapped;
            setState(mapped);
            markTableLoaded(loadOkKey);
            return { ok: true };
          } catch (e) {
            if (loadOkRef.current[loadOkKey] === true) return { ok: true };
            markTableFailed(loadOkKey, e);
            report(e);
            return { ok: false };
          }
        },
      });
    };
    return report;
  };
  const reportFunctionsLoadFailed = makeListLoadReporter("functions", "functions", "Functions", setFns, rowToFn, fnsRef);
  const reportProjectsLoadFailed = makeListLoadReporter("projects", "projects", "Projects", setProjectsState, rowToProject, projectsRef);
  const reportPurchaseOrdersLoadFailed = makeListLoadReporter("purchase_orders", "purchase_orders", "Purchase orders", setPurchaseState, rowToPurchase, purchaseRef);
  const reportEventOrdersLoadFailed = makeListLoadReporter("event_orders", "event_orders", "Event orders", setEventOrdersState, rowToEO, eventOrdersRef);
  // inventory keeps its own version (not the factory above) only because itemsRef must stay in
  // lockstep synchronously — see the realtime inventory channel's own comment on why a plain
  // setState alone isn't enough for this one table.
  const reportInventoryLoadFailed = (err) => {
    reportSaveProblem("load:inventory", {
      label: "Inventory", error: err, blocked: true,
      retry: async () => {
        if (loadOkRef.current.inventory === true) return { ok: true };
        try {
          const rows = await fetchAll("inventory");
          if (loadOkRef.current.inventory === true) return { ok: true };
          const loadedItems = rows.map(rowToItem);
          itemsRef.current = loadedItems;
          setItems(loadedItems);
          markTableLoaded("inventory");
          // Recipe→rate_card sync was skipped (or ran against an empty inventory) the whole time
          // this table was down — see syncRecipeRatesToStudio's own guard. Catch it up now instead
          // of leaving rate_card wrong until the next unrelated recipe/mandi/markup edit.
          syncRecipeRatesToStudio({ silent: true });
          return { ok: true };
        } catch (e) {
          if (loadOkRef.current.inventory === true) return { ok: true };
          markTableFailed("inventory", e);
          reportInventoryLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  // mandi_flowers and flower_patterns feed syncRecipeRatesToStudio the same way inventory does
  // (mandiCatalogue/flowerPatterns, merged into settings via applyMandiRows/applyFlowerPatternRows,
  // which already set their own ref — mandiRowsRef/patternRowsRef — synchronously, so no extra ref
  // plumbing is needed here the way the plain-array list tables above needed). A failed fetch for
  // either used to silently collapse to `[]` (the old `.catch(() => [])` fallback): an empty
  // mandiCatalogue prices every mandi ingredient at ₹0, and an empty flowerPatterns makes every
  // `_imsDriven` item look like "its recipe was removed" and get unlocked — both get written
  // straight to the shared rate_card table. syncRecipeRatesToStudio's own guard (below) now refuses
  // to run at all unless both of these, and inventory, have genuinely loaded.
  const reportMandiLoadFailed = (err) => {
    reportSaveProblem("load:mandi_flowers", {
      label: "Mandi flower catalogue", error: err, blocked: true,
      retry: async () => {
        if (loadOkRef.current.mandi_flowers === true) return { ok: true };
        try {
          const rows = await fetchAll("mandi_flowers");
          if (loadOkRef.current.mandi_flowers === true) return { ok: true };
          applyMandiRows(rows);
          markTableLoaded("mandi_flowers");
          syncRecipeRatesToStudio({ silent: true });
          return { ok: true };
        } catch (e) {
          if (loadOkRef.current.mandi_flowers === true) return { ok: true };
          markTableFailed("mandi_flowers", e);
          reportMandiLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  const reportFlowerPatternsLoadFailed = (err) => {
    reportSaveProblem("load:flower_patterns", {
      label: "Flower recipe patterns", error: err, blocked: true,
      retry: async () => {
        if (loadOkRef.current.flower_patterns === true) return { ok: true };
        try {
          const rows = await fetchAll("flower_patterns");
          if (loadOkRef.current.flower_patterns === true) return { ok: true };
          applyFlowerPatternRows(rows);
          markTableLoaded("flower_patterns");
          syncRecipeRatesToStudio({ silent: true });
          return { ok: true };
        } catch (e) {
          if (loadOkRef.current.flower_patterns === true) return { ok: true };
          markTableFailed("flower_patterns", e);
          reportFlowerPatternsLoadFailed(e);
          return { ok: false };
        }
      },
    });
  };
  const settingsWriterRef = useRef(null);
  if (!settingsWriterRef.current) {
    settingsWriterRef.current = createSettingsWriter(
      // writeWithRetry absorbs a transient blip (a dropped packet, a momentary disconnect) with a
      // few fast, silent attempts BEFORE settingsWriter's own onError/dirty-tracking below ever sees
      // a failure — most flaky-network "failures" are exactly this, self-resolving within a second
      // or two, so without this every one of them would show a visible "Save failed" banner and
      // need a manual click (or a reconnect event) to clear, instead of just quietly succeeding.
      // report:false: settingsWriter's own onError already reports into saveHealth (with its own
      // retryKey-based Retry) once a write has ALSO exhausted writeWithRetry's attempts — reporting
      // here too would just duplicate the banner entry under a different id for the same failure.
      async (k, value) => {
        const res = await writeWithRetry(
          () => supabase.from("settings").upsert({ key: k, value }, { onConflict: "key" }),
          { target: `settings:${k}`, label: `Settings: ${k}`, report: false },
        );
        return res.ok ? null : res.error;
      },
      (k, e) => {
        setError(`Save failed: ${e.message || e}`);
        // Stays visible (SaveHealthBanner) until retried or discarded — unlike the setError banner
        // above, which the next unrelated error overwrites. Safe to retry via retryKey here
        // specifically because this onError only fires from writeOne's own failure path (an
        // enqueue()'d write), where latest[k] always holds the real pending value, never the
        // markWriting boolean sentinel an external (RPC-merge) write uses.
        reportSaveProblem(`settings:${k}`, {
          label: `Settings: ${k}`,
          error: e,
          retry: () => settingsWriterRef.current.retryKey(k),
          onDiscard: () => { settingsWriterRef.current.discardKey(k); refetchSettingsAfterDiscard(); },
        });
      },
      // onSaved: a LATER keystroke to the same key can succeed after an earlier one failed — without
      // this, "a save failed" (and the beforeunload warning) stuck around until someone clicked
      // Retry or the browser reconnected, even though the key's current value is actually saved.
      (k) => clearSaveProblem(`settings:${k}`),
    );
  }
  const setSettings = useCallback((updater) => {
    if (!settingsLoadedRef.current) {
      // The real settings row(s) never genuinely loaded this session — writing now would enqueue a
      // diff against SETTINGS_DEFAULTS and could persist that placeholder over real admin config
      // (role-access tabs, department toolkits, date-pricing overrides, …). Refuse instead of guessing.
      setError("Settings haven't loaded yet — reload the page before changing settings. Nothing was saved.");
      return;
    }
    const prev = settingsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    settingsRef.current = next;
    setSettingsState(next);
    const task = settingsWriterRef.current.enqueue(prev, next);
    if (task) trackWrite(task);
  }, [trackWrite]);

  // Apply settings-table rows → blocks blob, Studio rate-card mirror (RC_SK), settings object.
  // Shared by the initial load and the settings Realtime subscription so config syncs live.
  // fetchMark: settingsWriter.mark() taken when the fetch that produced setRows started (see isStaleFor).
  const applySettingsRows = useCallback((setRows, fetchMark) => {
    // blocks now come from the `blocks` TABLE (boot fetch + its own realtime), not this blob.
    // Rate-card ITEMS now live in the `rate_card` TABLE (read on load + via its own realtime), not
    // the RC_SK settings blob — so it's intentionally no longer read here.
    // Studio Rate Card *categories* — load the live list the team edits in Studio (adds like
    // Fabric / Birthday / Printing) so IMS sub-categories stay in sync instead of frozen on the seed.
    const rcCatsBlob = setRows.find((r) => r.key === RC_SK_CATS);
    if (rcCatsBlob?.value != null) { let c = rcCatsBlob.value; if (typeof c === "string") { try { c = JSON.parse(c); } catch { c = null; } } if (Array.isArray(c) && c.length) setStudioRcCats(c); }
    const settingsObj = { ...SETTINGS_DEFAULTS };
    // A key with a local edit still waiting to be written — or written since this fetch began — is newer
    // on screen than in these rows: they are an older echo, so the screen keeps its own value.
    const prevLocal = settingsRef.current || {};
    const writer = settingsWriterRef.current;
    for (const r of setRows) {
      if (/^ambria-/.test(r.key)) continue;
      const staleRow = writer && r.key in prevLocal && (fetchMark == null ? writer.isDirty(r.key) : writer.isStaleFor(r.key, fetchMark));
      settingsObj[r.key] = staleRow ? prevLocal[r.key] : r.value;
    }
    // Mandi flower catalogue comes from the `mandi_flowers` TABLE (migration 039), not a settings
    // row any more — re-applied here on every rebuild (this function also runs on every unrelated
    // settings-table change, via the live("settings", ...) subscription below) so it's never lost.
    settingsObj.mandiCatalogue = assembleMandiCatalogueFromRows(mandiRowsRef.current);
    // Same reasoning for flower recipe patterns — `flower_patterns` TABLE (migration 040).
    settingsObj.flowerPatterns = assembleFlowerPatternsFromRows(patternRowsRef.current);
    // Same reasoning for labour type config — `labour_types` TABLE (migration 041), one table
    // feeding three independently-keyed settings fields.
    settingsObj.labourTiers = assembleLabourTiersFromRows(labourTypeRowsRef.current);
    settingsObj.dihariSchemes = assembleDihariSchemesFromRows(labourTypeRowsRef.current);
    settingsObj.defaultWindowsByPhase = assembleDefaultWindowsByPhaseFromRows(labourTypeRowsRef.current);
    // Same reasoning for venue labour config — `venue_labour_config` TABLE (migration 042).
    settingsObj.venueMinLabour = assembleVenueMinLabourFromRows(venueLabourRowsRef.current);
    settingsObj.venueDumping = assembleVenueDumpingFromRows(venueLabourRowsRef.current);
    // Same reasoning for the five rate lists — each its own TABLE (migration 043).
    settingsObj.printMaterials = assemblePrintMaterialsFromRows(printMaterialRowsRef.current);
    settingsObj.carpetMaterials = assembleCarpetMaterialsFromRows(carpetMaterialRowsRef.current);
    settingsObj.platformRates = assemblePlatformRatesFromRows(platformRateRowsRef.current);
    settingsObj.maskingRates = assembleMaskingRatesFromRows(maskingRateRowsRef.current);
    settingsObj.trussRates = assembleTrussRatesFromRows(trussRateRowsRef.current);
    // Same reasoning for the manpower range ladders — each its own TABLE (migration 044).
    settingsObj.heavyElementRanges = assembleHeavyElementRangesFromRows(heavyElementRangeRowsRef.current);
    settingsObj.trussLabourRanges = assembleTrussLabourRangesFromRows(trussLabourRangeRowsRef.current);
    settingsObj.fabricBangaliRanges = assembleFabricBangaliRangesFromRows(fabricBangaliRangeRowsRef.current);
    // Same reasoning for attendance locations/training + the synonym dictionary (migration 045).
    settingsObj.attendanceLocations = assembleAttendanceLocationsFromRows(attendanceLocationRowsRef.current);
    settingsObj.attendanceTrainingByDept = assembleAttendanceTrainingByDeptFromRows(attendanceTrainingRowsRef.current);
    settingsObj.synonymDictionary = assembleSynonymDictionaryFromRows(synonymGroupRowsRef.current);
    // datePricing.markedDates is now the `date_pricing_overrides` TABLE (migration 046) — a sub-field
    // merge into whatever the generic loop above already set datePricing to (categories/
    // autoCategories/autoSyncPaused/autoSyncLockCode stay exactly as that settings key holds them;
    // see merge_settings_json's own comment on mergeDatePricing for why only markedDates moved).
    settingsObj.datePricing = { ...settingsObj.datePricing, markedDates: assembleMarkedDatesFromRows(markedDateRowsRef.current) };
    settingsRef.current = settingsObj;
    setSettingsState(settingsObj);
    settingsLoadedRef.current = true;
    setSettingsLoaded(true);
  }, []);

  // Mandi flower catalogue rows -> settings.mandiCatalogue. Called on boot and by the mandi_flowers
  // realtime subscription below; applySettingsRows also re-reads mandiRowsRef so a LATER unrelated
  // settings change can't silently drop the catalogue out of the merged settings object.
  const applyMandiRows = useCallback((rows) => {
    mandiRowsRef.current = rows;
    const mc = assembleMandiCatalogueFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), mandiCatalogue: mc };
    setSettingsState((prev) => ({ ...(prev || {}), mandiCatalogue: mc }));
  }, []);

  // Flower recipe pattern rows -> settings.flowerPatterns. Same reasoning/shape as applyMandiRows.
  const applyFlowerPatternRows = useCallback((rows) => {
    patternRowsRef.current = rows;
    const fp = assembleFlowerPatternsFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), flowerPatterns: fp };
    setSettingsState((prev) => ({ ...(prev || {}), flowerPatterns: fp }));
  }, []);

  // Labour type rows -> settings.labourTiers/dihariSchemes/defaultWindowsByPhase. Same
  // reasoning/shape as applyMandiRows, feeding three fields from one table.
  const applyLabourTypeRows = useCallback((rows) => {
    labourTypeRowsRef.current = rows;
    const patch = {
      labourTiers: assembleLabourTiersFromRows(rows),
      dihariSchemes: assembleDihariSchemesFromRows(rows),
      defaultWindowsByPhase: assembleDefaultWindowsByPhaseFromRows(rows),
    };
    settingsRef.current = { ...(settingsRef.current || {}), ...patch };
    setSettingsState((prev) => ({ ...(prev || {}), ...patch }));
  }, []);

  // Venue labour config rows -> settings.venueMinLabour/venueDumping. Same reasoning/shape.
  const applyVenueLabourRows = useCallback((rows) => {
    venueLabourRowsRef.current = rows;
    const patch = {
      venueMinLabour: assembleVenueMinLabourFromRows(rows),
      venueDumping: assembleVenueDumpingFromRows(rows),
    };
    settingsRef.current = { ...(settingsRef.current || {}), ...patch };
    setSettingsState((prev) => ({ ...(prev || {}), ...patch }));
  }, []);

  // Rate-list rows -> one settings field each. Same reasoning/shape as applyMandiRows, one table
  // per field this time instead of one table feeding several.
  const applyPrintMaterialRows = useCallback((rows) => {
    printMaterialRowsRef.current = rows;
    const v = assemblePrintMaterialsFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), printMaterials: v };
    setSettingsState((prev) => ({ ...(prev || {}), printMaterials: v }));
  }, []);
  const applyCarpetMaterialRows = useCallback((rows) => {
    carpetMaterialRowsRef.current = rows;
    const v = assembleCarpetMaterialsFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), carpetMaterials: v };
    setSettingsState((prev) => ({ ...(prev || {}), carpetMaterials: v }));
  }, []);
  const applyPlatformRateRows = useCallback((rows) => {
    platformRateRowsRef.current = rows;
    const v = assemblePlatformRatesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), platformRates: v };
    setSettingsState((prev) => ({ ...(prev || {}), platformRates: v }));
  }, []);
  const applyMaskingRateRows = useCallback((rows) => {
    maskingRateRowsRef.current = rows;
    const v = assembleMaskingRatesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), maskingRates: v };
    setSettingsState((prev) => ({ ...(prev || {}), maskingRates: v }));
  }, []);
  const applyTrussRateRows = useCallback((rows) => {
    trussRateRowsRef.current = rows;
    const v = assembleTrussRatesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), trussRates: v };
    setSettingsState((prev) => ({ ...(prev || {}), trussRates: v }));
  }, []);

  // Manpower range-ladder rows -> one settings field each. Same reasoning/shape.
  const applyHeavyElementRangeRows = useCallback((rows) => {
    heavyElementRangeRowsRef.current = rows;
    const v = assembleHeavyElementRangesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), heavyElementRanges: v };
    setSettingsState((prev) => ({ ...(prev || {}), heavyElementRanges: v }));
  }, []);
  const applyTrussLabourRangeRows = useCallback((rows) => {
    trussLabourRangeRowsRef.current = rows;
    const v = assembleTrussLabourRangesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), trussLabourRanges: v };
    setSettingsState((prev) => ({ ...(prev || {}), trussLabourRanges: v }));
  }, []);
  const applyFabricBangaliRangeRows = useCallback((rows) => {
    fabricBangaliRangeRowsRef.current = rows;
    const v = assembleFabricBangaliRangesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), fabricBangaliRanges: v };
    setSettingsState((prev) => ({ ...(prev || {}), fabricBangaliRanges: v }));
  }, []);

  // Attendance locations/training + synonym dictionary rows -> one settings field each.
  const applyAttendanceLocationRows = useCallback((rows) => {
    attendanceLocationRowsRef.current = rows;
    const v = assembleAttendanceLocationsFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), attendanceLocations: v };
    setSettingsState((prev) => ({ ...(prev || {}), attendanceLocations: v }));
  }, []);
  const applyAttendanceTrainingRows = useCallback((rows) => {
    attendanceTrainingRowsRef.current = rows;
    const v = assembleAttendanceTrainingByDeptFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), attendanceTrainingByDept: v };
    setSettingsState((prev) => ({ ...(prev || {}), attendanceTrainingByDept: v }));
  }, []);
  const applySynonymGroupRows = useCallback((rows) => {
    synonymGroupRowsRef.current = rows;
    const v = assembleSynonymDictionaryFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), synonymDictionary: v };
    setSettingsState((prev) => ({ ...(prev || {}), synonymDictionary: v }));
  }, []);

  // datePricing.markedDates rows -> a sub-field merge into settings.datePricing (not a whole
  // top-level field — see the comment on applySettingsRows' own markedDates line).
  const applyMarkedDateRows = useCallback((rows) => {
    markedDateRowsRef.current = rows;
    const markedDates = assembleMarkedDatesFromRows(rows);
    settingsRef.current = { ...(settingsRef.current || {}), datePricing: { ...(settingsRef.current || {}).datePricing, markedDates } };
    setSettingsState((prev) => ({ ...(prev || {}), datePricing: { ...(prev || {}).datePricing, markedDates } }));
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
    // computePatternSizeCost below prices every direct-inventory recipe ingredient off
    // itemsRef.current — if inventory itself failed to load (itemsRef.current == []), every such
    // ingredient prices at ₹0 and this would upsert those zeroed rates straight into the SHARED
    // rate_card table Studio's 8 salespeople quote off of. Inventory used to be the one fetch in the
    // mount-time Promise.all with no .catch, so its failure aborted the WHOLE load and this effect's
    // own `loading` guard meant this function could never even be reached in that case — now that
    // inventory fails independently (see reportInventoryLoadFailed), that protection is gone and
    // has to be made explicit here instead. The inventory background-recovery retry re-calls this
    // function once inventory actually loads, so a sync deferred by this guard isn't lost for good.
    // Same reasoning extends to mandi_flowers (mandiCatalogue) and flower_patterns (flowerPatterns)
    // — a failed fetch for either used to silently collapse to `[]`, which prices mandi ingredients
    // at ₹0 or wrongly "unlocks" every recipe-driven item, same destination (the shared rate_card
    // table). See reportMandiLoadFailed/reportFlowerPatternsLoadFailed for the matching recovery.
    // settingsLoadedRef, not loadOkRef.current.settings: a failed settings fetch leaves settingsRef
    // sitting at SETTINGS_DEFAULTS (flowerRecipeSubcats/defaultStudioMarkup/the artificial-mix rates
    // all read below), which would unlock every _imsDriven item outside the default sub-category and
    // re-price everything at the default 3x markup — same destination (rate_card) as the other two
    // checks. settingsLoadedRef (not markTableLoaded("settings"), which this table never calls) is
    // the flag the settings retry/realtime path itself already keeps correct — see its own comment
    // at autoConfirmReady below for why this ref is used instead of loadOkRef here.
    const missingLoad = [];
    if (loadOkRef.current.inventory !== true) missingLoad.push("inventory");
    if (loadOkRef.current.mandi_flowers !== true) missingLoad.push("mandi flower catalogue");
    if (loadOkRef.current.flower_patterns !== true) missingLoad.push("flower recipe patterns");
    if (!settingsLoadedRef.current) missingLoad.push("settings");
    if (missingLoad.length) return { error: `${missingLoad.join(", ")} hasn't loaded yet — recipe sync skipped to avoid writing wrong prices.`, updated: 0, cleared: 0 };
    const s = settingsRef.current || {};
    const patterns = s.flowerPatterns || [];
    const recipeSubs = s.flowerRecipeSubcats || [];
    const mandi = s.mandiCatalogue || [];
    const rateFor = (pat, markup, sizeKey) => {
      const sd = pat.sizes?.[sizeKey];
      const c = sd ? computePatternSizeCost(sd, mandi, itemsRef.current) : null;
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
        if (rows.length) {
          // One retryingUpsert per row (Promise.all, not a sequential loop — see persistBlocks' own
          // comment for why a sequential version of this exact shape let a stale write land after a
          // newer one), so each item's row gets its own target/supersession scope.
          const results = await Promise.all(rows.map((row) => retryingUpsert("rate_card", row)));
          const failed = results.find((r) => r.error);
          if (failed) { if (!silent) setError(`Sync failed: ${failed.error.message}`); return { error: failed.error.message, updated, cleared }; }
        }
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

  // Hides every item in this sub-category from AI photo-tagging's vocabulary (the client aiTagImage
  // tagger reads this) — replaces the old Rate-Card-only "not taggable in Pricing" flag for tagging
  // purposes. Same optimistic pattern.
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
      await deleteRow("rate_card_categories", id);
    } catch (e) {
      setRateCardCategories(prev);
      setError(`Failed to delete sub-category: ${e.message}`);
    }
  }, []);

  // Rename a sub-category. When the new label normalizes to a different id, the row's PK changes
  // too (id must stay lower(trim(label)) — the join key everything else matches on) — rolls back
  // on failure (e.g. the new name collides with an existing sub-category).
  //
  // The id is only HALF the story: inventory.subCat/subcategory, rate_card.sub, and a couple of
  // settings maps (labourTiers[type].subCatBatches, heavyElementRanges) all store this same name
  // as a plain string, matched case-insensitively — none of them reference the category row by a
  // stable foreign key. Left alone, renaming the row orphans every one of those the instant the
  // id changes (scaling factor/cost%/floral-mode/hidden-tag reset to default, AI-tagging vocabulary
  // drops the sub-category's items entirely, labour batching stops matching). So a real rename
  // (id actually changes) cascades a rename across all of them in the same action.
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
      return;
    }
    if (newId === oldId) return; // pure re-casing — every case-insensitive join key still matches

    setInventory((prev) => prev.map((it) => {
      const cur = String(it.subCat ?? it.subcategory ?? "").trim().toLowerCase();
      return cur === oldId ? { ...it, subCat: trimmed, subcategory: trimmed } : it;
    }));

    const nextRcItems = (studioRcItemsRef.current || []).map((it) => {
      const cur = String(it.sub || "").trim().toLowerCase();
      return cur === oldId ? { ...it, sub: trimmed } : it;
    });
    saveRateCardItems(nextRcItems);

    // labourTiers[type].subCatBatches is now a column on the `labour_types` TABLE (migration 041) —
    // row-level per affected type, not folded into the settings blob merge below.
    Object.entries(settings.labourTiers || {}).forEach(([type, cfg]) => {
      const batches = cfg?.subCatBatches;
      if (!batches) return;
      const matchKey = Object.keys(batches).find((k) => String(k).trim().toLowerCase() === oldId);
      if (matchKey && matchKey !== trimmed) {
        const nb = { ...batches };
        nb[trimmed] = nb[matchKey];
        delete nb[matchKey];
        writeWithRetry(() => supabase.from("labour_types").update({ sub_cat_batches: nb }).eq("type_name", type), { target: `labour_types:${type}`, retryable: false, report: false });
      }
    });
    // heavyElementRanges[].subCat is now the primary key of the `heavy_element_ranges` TABLE
    // (migration 044) — a rename is a row-level UPDATE of that key, not a settings blob merge.
    (settings.heavyElementRanges || []).forEach((her) => {
      if (String(her.subCat || "").trim().toLowerCase() === oldId && her.subCat !== trimmed) {
        writeWithRetry(() => supabase.from("heavy_element_ranges").update({ sub_cat: trimmed }).eq("sub_cat", her.subCat), { target: `heavy_element_ranges:${her.subCat}`, retryable: false, report: false });
      }
    });
    // Recipes (flowerPatterns) link to items by `.sub` (matchFlowerPattern). Rename it too so a
    // sub-category rename keeps the recipe↔item match intact — otherwise the recipe stops applying
    // to its items and every tagged photo using those items loses its recipe pricing. Row-level
    // (flower_patterns table, 040), not the settings blob the rest of this cascade used to share.
    writeWithRetry(() => supabase.from("flower_patterns").update({ sub: trimmed }).ilike("sub", oldId), { target: `flower_patterns:${oldId}`, retryable: false, report: false });
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
        // One retryingUpsert per row (Promise.all) — same reasoning as syncRecipeRatesToStudio above.
        const results = await Promise.all(rows.map((row) => retryingUpsert("rate_card", row)));
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
      }
      if (dels.length) {
        const results = await Promise.all(dels.map((id) => retryingDelete("rate_card", id)));
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
      }
    } catch (e) {
      studioRcItemsRef.current = prev; setStudioRcItems(prev);
      setError(`Rate card save failed: ${e.message}`);
      // Unlike the old single batched upsert (one PostgREST statement, genuinely all-or-nothing),
      // each row above is its own request — some can land while another fails, so rolling back ALL
      // local state to `prev` here can show a stale value for a row that actually DID save. Re-sync
      // from the table so local state reflects whatever actually persisted, not a blanket rollback.
      fetchAll("rate_card").then(
        (r) => { const items = r.map(rowToRcItem).filter(Boolean); studioRcItemsRef.current = items; setStudioRcItems(items); },
        () => {},
      );
    }
  }, []);

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
    // {rows, ok} wrapper for any fetch whose table backs a writer that could overwrite OTHER
    // events'/rows' data on a failed-fetch-collapsed-to-empty `prev` (see loadOkRef's own comment),
    // or whose load failure should get its own save-health banner entry instead of just a silent
    // markTableFailed. Deliberately does NOT call markTableLoaded/markTableFailed itself here —
    // that's deferred to a single block, once, only after the Promise.all has genuinely resolved
    // AND every setter below has run (see the block right before setLoading(false)) — marking
    // loadOkRef inline per-fetch instead would let an earlier, already-settled fetch's table look
    // "loaded" even on a run where some OTHER fetch in the batch still throws and the destructuring
    // below never runs at all, so none of these setters actually applied anything that run.
    const safeFetch = (t) => fetchAll(t).then((rows) => ({ rows, ok: true })).catch((e) => { console.warn(`[IMS] ${t} fetch failed:`, e?.message || e); return { rows: [], ok: false }; });
    (async () => {
      try {
        const [invFetch, fnFetch, projFetch, venRows, poFetch, ohRows, supRows, userRows, prodRows, eoFetch, allocFetch, platformAllocFetch, battaAllocFetch, rcRows, trussFetch, catRows, setRows, blockFetch, rcCatRows, mandiFetch, patternFetch, labourTypeRows, venueLabourRows, printMaterialRows, carpetMaterialRows, platformRateRows, maskingRateRows, trussRateRows, heavyElementRangeRows, trussLabourRangeRows, fabricBangaliRangeRows, attendanceLocationRows, attendanceTrainingRows, synonymGroupRows, markedDateRows] = await Promise.all([
          safeFetch("inventory"),
          safeFetch("functions"),
          safeFetch("projects"),
          fetchAll("vendors").catch(() => []),
          safeFetch("purchase_orders"),
          fetchAll("overheads").catch(() => []),
          fetchAll("supervisors").catch(() => []),
          fetchAll("users").catch(() => []),
          fetchAll("production_requests").catch(() => []),
          safeFetch("event_orders"),
          safeFetch("truss_allocations"),
          safeFetch("platform_allocations"),
          safeFetch("batta_allocations"),
          fetchAll("rate_card").catch(() => []),
          // {rows, ok} not a bare array — a real fetch failure (ok:false) must stay distinguishable
          // from a real, successful fetch that just found zero rows (a fresh install), so the code
          // below can refuse to treat a failure as "this venue genuinely has no truss_inventory yet"
          // (see trussInvLoadedRef's own comment for the incident this closes).
          fetchAll("truss_inventory").then((rows) => ({ rows, ok: true })).catch((e) => { console.warn("[IMS] truss_inventory fetch failed:", e?.message || e); return { rows: [], ok: false }; }),
          fetchAll("categories").catch(() => []),
          safeFetch("settings"),
          safeFetch("blocks"),
          fetchAll("rate_card_categories").catch(() => []),
          safeFetch("mandi_flowers"),
          safeFetch("flower_patterns"),
          fetchAll("labour_types").catch(() => []),
          fetchAll("venue_labour_config").catch(() => []),
          fetchAll("print_materials").catch(() => []),
          fetchAll("carpet_materials").catch(() => []),
          fetchAll("platform_rates").catch(() => []),
          fetchAll("masking_rates").catch(() => []),
          fetchAll("truss_rates").catch(() => []),
          fetchAll("heavy_element_ranges").catch(() => []),
          fetchAll("truss_labour_ranges").catch(() => []),
          fetchAll("fabric_bangali_ranges").catch(() => []),
          fetchAll("attendance_locations").catch(() => []),
          fetchAll("attendance_training").catch(() => []),
          fetchAll("synonym_groups").catch(() => []),
          fetchAll("date_pricing_overrides").catch(() => []),
        ]);
        if (!active) return;
        { const bm = blocksRowsToMap(blockFetch.rows); blocksRef.current = bm; setBlocksState(bm); }
        const loadedItems = invFetch.rows.map(rowToItem);
        itemsRef.current = loadedItems; // keep the ref in lockstep from the very first paint
        setItems(loadedItems);
        // fnsRef/projectsRef/purchaseRef/eventOrdersRef set in lockstep here too (not left to the
        // later `useEffect(() => { xRef.current = x }, [x])` sync alone) — same reasoning as
        // itemsRef/blocksRef above: the event_orders realtime channel (and functions/projects/
        // purchase_orders' own writers) read straight off these refs, and each of their own
        // subscriptions is already live by the time this async block resolves, so a change landing
        // in the gap before that reactive effect runs would otherwise merge into a stale ref.
        { const mapped = fnFetch.rows.map(rowToFn); fnsRef.current = mapped; setFns(mapped); }
        { const mapped = projFetch.rows.map(rowToProject); projectsRef.current = mapped; setProjectsState(mapped); }
        setVendorsState(venRows.map(rowToVendor));
        { const mapped = poFetch.rows.map(rowToPurchase); purchaseRef.current = mapped; setPurchaseState(mapped); }
        setOverheadsState(ohRows.map(rowToOverhead));
        setSupervisorsState(supRows.map(rowToSupervisor));
        setUsersState(sortUsers(userRows.map(rowToUser), recentUsersRef.current));
        setProdRequestsState(prodRows.map(rowToProd));
        { const mapped = eoFetch.rows.map(rowToEO); eventOrdersRef.current = mapped; setEventOrdersState(mapped); }
        setTrussAllocState(Object.fromEntries(allocFetch.rows.map((r) => [r.date, rowToAlloc(r)])));
        setPlatformAllocState(Object.fromEntries(platformAllocFetch.rows.map((r) => [r.date, rowToAlloc(r)])));
        setBattaAllocState(Object.fromEntries(battaAllocFetch.rows.map((r) => [r.date, rowToAlloc(r)])));
        const trussRow = trussFetch.rows.find((r) => r.key === "main") || trussFetch.rows[0];
        if (trussRow?.data) { setTrussInvState(trussRow.data); trussInvLoadedRef.current = true; clearSaveProblem("load:truss_inventory"); }
        else if (trussFetch.ok) {
          // A genuinely successful fetch that found no row at all — a fresh install with no
          // truss_inventory row yet. INIT_TRUSS_INV really is correct here, so it's safe to save.
          trussInvLoadedRef.current = true;
          clearSaveProblem("load:truss_inventory");
        } else {
          // The fetch itself failed — trussInv is still sitting at the INIT_TRUSS_INV placeholder,
          // not real data. Visible, not swallowed: see trussInvLoadedRef's own comment.
          setError("Truss/fabric inventory failed to load — Fabric Stock and Truss & Batta Config are read-only until you reload the page (editing now would save an empty placeholder over the real data).");
          reportTrussInvLoadFailed(new Error("Failed to load — Fabric Stock and Truss & Batta Config are read-only until this is retried or the page is reloaded."));
        }
        setCats(catRows.map((c) => c.name).filter(Boolean));
        // Mandi flower catalogue — the `mandi_flowers` TABLE (migration 039), not the
        // `mandiCatalogue` settings-blob key; merged into the same settings object everything else
        // reads, via its own fetch + realtime (see the effect below), same reasoning fixed_venues
        // (038) already uses in StudioApp.jsx. Populates mandiRowsRef BEFORE applySettingsRows runs,
        // so that rebuild's own re-merge (below) picks up the real catalogue, not an empty one.
        // {rows, ok}, not a bare array: syncRecipeRatesToStudio prices every mandi-ingredient recipe
        // off mandiCatalogue, so a failed fetch collapsing silently to [] (the old `.catch(() => [])`
        // fallback) would price those ingredients at ₹0 and write that straight to the shared
        // rate_card table, same class of bug inventory's own guard exists for below.
        applyMandiRows(mandiFetch.rows);
        // Flower recipe patterns — the `flower_patterns` TABLE (migration 040), same reasoning —
        // and the same ₹0/unlock risk: a failed fetch must not look like "this recipe has no
        // pattern", which syncRecipeRatesToStudio would otherwise read as "unlock this item".
        applyFlowerPatternRows(patternFetch.rows);
        // Labour type config — the `labour_types` TABLE (migration 041), same reasoning.
        applyLabourTypeRows(labourTypeRows);
        // Venue labour config — the `venue_labour_config` TABLE (migration 042), same reasoning.
        applyVenueLabourRows(venueLabourRows);
        // Rate lists — the five TABLEs (migration 043), same reasoning.
        applyPrintMaterialRows(printMaterialRows);
        applyCarpetMaterialRows(carpetMaterialRows);
        applyPlatformRateRows(platformRateRows);
        applyMaskingRateRows(maskingRateRows);
        applyTrussRateRows(trussRateRows);
        // Manpower range ladders — the three TABLEs (migration 044), same reasoning.
        applyHeavyElementRangeRows(heavyElementRangeRows);
        applyTrussLabourRangeRows(trussLabourRangeRows);
        applyFabricBangaliRangeRows(fabricBangaliRangeRows);
        // Attendance locations/training + synonym dictionary — the three TABLEs (migration 045).
        applyAttendanceLocationRows(attendanceLocationRows);
        applyAttendanceTrainingRows(attendanceTrainingRows);
        applySynonymGroupRows(synonymGroupRows);
        // datePricing.markedDates — the `date_pricing_overrides` TABLE (migration 046). Populates
        // markedDateRowsRef BEFORE applySettingsRows runs, same reasoning as every other ref above.
        applyMarkedDateRows(markedDateRows);
        // blocks blob, Studio rate-card mirror, and the settings object — applied via the
        // shared helper (also used by the settings Realtime subscription below). Skipped on a
        // genuine fetch failure: applySettingsRows unconditionally flips settingsLoaded true, and a
        // write made against that lying flag can overwrite real settings keys (role-access tabs,
        // department toolkits, date-pricing overrides, …) with SETTINGS_DEFAULTS. See setSettings'
        // own `!settingsLoaded` guard below.
        if (setRows.ok) { applySettingsRows(setRows.rows); clearSaveProblem("load:settings"); }
        else {
          setError("Settings failed to load — admin config (roles, department tools, date pricing, …) is read-only until you reload the page.");
          reportSettingsLoadFailed(new Error("Failed to load — admin config (roles, department tools, date pricing, …) is read-only until this is retried or the page is reloaded."));
        }
        // Rate card: read from the shared `rate_card` TABLE (migrated off the RC_SK blob).
        setStudioRcItems(rcRows.map(rowToRcItem).filter(Boolean));
        setRateCardCategories(rcCatRows);
        // Reaching here means the WHOLE Promise.all resolved and every setter above has actually
        // applied its result — only now is it true that each of these tables either genuinely
        // loaded or genuinely failed this session. See safeFetch's own comment for why this can't
        // be done inline per-fetch instead.
        for (const [t, f] of [["inventory", invFetch], ["functions", fnFetch], ["projects", projFetch], ["purchase_orders", poFetch], ["event_orders", eoFetch], ["truss_allocations", allocFetch], ["platform_allocations", platformAllocFetch], ["batta_allocations", battaAllocFetch], ["settings", setRows], ["blocks", blockFetch], ["mandi_flowers", mandiFetch], ["flower_patterns", patternFetch]]) {
          if (f.ok) markTableLoaded(t); else markTableFailed(t);
        }
        if (invFetch.ok) clearSaveProblem("load:inventory");
        else reportInventoryLoadFailed(new Error("Failed to load — the item list may be incomplete until this is retried or the page is reloaded."));
        if (mandiFetch.ok) clearSaveProblem("load:mandi_flowers");
        else reportMandiLoadFailed(new Error("Failed to load — Studio recipe pricing is skipped until this is retried or the page is reloaded."));
        if (patternFetch.ok) clearSaveProblem("load:flower_patterns");
        else reportFlowerPatternsLoadFailed(new Error("Failed to load — Studio recipe pricing is skipped until this is retried or the page is reloaded."));
        if (fnFetch.ok) clearSaveProblem("load:functions");
        else reportFunctionsLoadFailed(new Error("Failed to load — the functions list may be incomplete until this is retried or the page is reloaded."));
        if (projFetch.ok) clearSaveProblem("load:projects");
        else reportProjectsLoadFailed(new Error("Failed to load — the projects list may be incomplete until this is retried or the page is reloaded."));
        if (poFetch.ok) clearSaveProblem("load:purchase_orders");
        else reportPurchaseOrdersLoadFailed(new Error("Failed to load — the purchase orders list may be incomplete until this is retried or the page is reloaded."));
        if (eoFetch.ok) clearSaveProblem("load:event_orders");
        else reportEventOrdersLoadFailed(new Error("Failed to load — the event orders list may be incomplete until this is retried or the page is reloaded."));
        if (blockFetch.ok) clearSaveProblem("load:blocks");
        else reportBlocksLoadFailed(new Error("Failed to load — editing block reservations is refused until this is retried or the page is reloaded."));
        if (allocFetch.ok) clearSaveProblem("load:truss_allocations");
        else reportTrussAllocLoadFailed(new Error("Failed to load — editing truss allocations is refused until this is retried or the page is reloaded."));
        if (platformAllocFetch.ok) clearSaveProblem("load:platform_allocations");
        else reportPlatformAllocLoadFailed(new Error("Failed to load — editing platform allocations is refused until this is retried or the page is reloaded."));
        if (battaAllocFetch.ok) clearSaveProblem("load:batta_allocations");
        else reportBattaAllocLoadFailed(new Error("Failed to load — editing batta allocations is refused until this is retried or the page is reloaded."));
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
    // Every keystroke into a settings-backed field (e.g. a flower-recipe qty) writes immediately,
    // which fires this table's own postgres_changes event, which re-fetches here — so fast typing
    // can have several of these fetches in flight at once. Network completion order isn't the same
    // as request order, so an older fetch (still reflecting the pre-edit value) can resolve AFTER a
    // newer one and stomp the just-typed value for a moment, until the real latest fetch corrects
    // it back — the "value flickers to the old one, then snaps back" bug. Guard against it: only
    // ever apply the result of the most-recently-ISSUED fetch per table, discard a stale one that
    // resolves out of order.
    const extraChannels = [];
    const liveTableSeq = {};
    const liveTable = (table, apply) => {
      liveTableSeq[table] = 0;
      const ch = supabase
        .channel(`realtime:${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, async () => {
          const myReq = ++liveTableSeq[table];
          const fetchMark = settingsWriterRef.current.mark(); // for the settings table: see isStaleFor
          const rows = await fetchAll(table).catch(() => null);
          if (myReq !== liveTableSeq[table]) return; // a newer fetch has since been issued — stale, drop it
          if (rows && active) apply(rows, fetchMark);
        })
        .subscribe();
      extraChannels.push(ch);
    };
    liveTable("settings", (rows, fetchMark) => applySettingsRows(rows, fetchMark));
    liveTable("rate_card", (rows) => setStudioRcItems(rows.map(rowToRcItem).filter(Boolean)));
    liveTable("rate_card_categories", (rows) => setRateCardCategories(rows));
    liveTable("mandi_flowers", (rows) => applyMandiRows(rows));
    liveTable("flower_patterns", (rows) => applyFlowerPatternRows(rows));
    liveTable("labour_types", (rows) => applyLabourTypeRows(rows));
    liveTable("venue_labour_config", (rows) => applyVenueLabourRows(rows));
    liveTable("print_materials", (rows) => applyPrintMaterialRows(rows));
    liveTable("carpet_materials", (rows) => applyCarpetMaterialRows(rows));
    liveTable("platform_rates", (rows) => applyPlatformRateRows(rows));
    liveTable("masking_rates", (rows) => applyMaskingRateRows(rows));
    liveTable("truss_rates", (rows) => applyTrussRateRows(rows));
    liveTable("heavy_element_ranges", (rows) => applyHeavyElementRangeRows(rows));
    liveTable("truss_labour_ranges", (rows) => applyTrussLabourRangeRows(rows));
    liveTable("fabric_bangali_ranges", (rows) => applyFabricBangaliRangeRows(rows));
    liveTable("attendance_locations", (rows) => applyAttendanceLocationRows(rows));
    liveTable("attendance_training", (rows) => applyAttendanceTrainingRows(rows));
    liveTable("synonym_groups", (rows) => applySynonymGroupRows(rows));
    liveTable("date_pricing_overrides", (rows) => applyMarkedDateRows(rows));
    // blocks gets its own channel too, same reason as event_orders below: Build reconciles this
    // table's reservation rows on every qty-affecting edit to a sold deal (reconcileSoldInventoryBlocks
    // in StudioApp.jsx), so it changes constantly, and the table holds one row per inventory item
    // (600+ in this project) — re-fetching every row on every single-item change was adding real,
    // avoidable latency on top of the same problem event_orders had. Merge the one changed row from
    // the payload directly.
    const blocksChannel = supabase
      .channel("realtime:blocks")
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, (payload) => {
        const key = (payload.eventType === "DELETE" ? payload.old : payload.new)?.item_id ?? (payload.eventType === "DELETE" ? payload.old : payload.new)?.id;
        if (key == null) return;
        const next = { ...blocksRef.current };
        if (payload.eventType === "DELETE") delete next[key];
        else next[key] = Array.isArray(payload.new.data) ? payload.new.data : [];
        blocksRef.current = next;
        setBlocksState(next);
      })
      .subscribe();
    extraChannels.push(blocksChannel);
    // event_orders gets its own channel instead of liveTable's generic re-fetch-the-whole-table
    // handler: Build now pushes a fresh zone-layout snapshot into this table on every save
    // (persistBuildLayoutSnapshot), so this table changes far more often than the others liveTable
    // covers, and each row's `data` JSONB (full functionsDetail — zones/elements/manpower/etc. for
    // every function) is heavy. Re-fetching every row of the table on every single-row change was
    // the dominant source of the Build→IMS lag reported after that change. Merge the row straight
    // out of the realtime payload instead (same pattern as the `inventory` channel above) — no
    // extra round trip, independent of table size.
    const eoChannel = supabase
      .channel("realtime:event_orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_orders" }, (payload) => {
        const prev = eventOrdersRef.current;
        let next;
        if (payload.eventType === "DELETE") {
          next = prev.filter((r) => r.id !== payload.old.id);
        } else {
          const eo = rowToEO(payload.new);
          next = prev.some((r) => r.id === eo.id) ? prev.map((r) => (r.id === eo.id ? eo : r)) : [...prev, eo];
        }
        eventOrdersRef.current = next;
        setEventOrdersState(next);
      })
      .subscribe();
    extraChannels.push(eoChannel);
    liveTable("functions", (rows) => setFns(rows.map(rowToFn)));
    liveTable("projects", (rows) => setProjectsState(rows.map(rowToProject)));
    liveTable("truss_allocations", (rows) => setTrussAllocState(Object.fromEntries(rows.map((r) => [r.date, rowToAlloc(r)]))));
    liveTable("platform_allocations", (rows) => setPlatformAllocState(Object.fromEntries(rows.map((r) => [r.date, rowToAlloc(r)]))));
    liveTable("batta_allocations", (rows) => setBattaAllocState(Object.fromEntries(rows.map((r) => [r.date, rowToAlloc(r)]))));
    liveTable("truss_inventory", (rows) => { const tr = rows.find((r) => r.key === "main") || rows[0]; if (tr?.data) { setTrussInvState(tr.data); trussInvLoadedRef.current = true; } });
    liveTable("categories", (rows) => setCats(rows.map((c) => c.name).filter(Boolean)));
    liveTable("supervisors", (rows) => setSupervisorsState(rows.map(rowToSupervisor)));
    liveTable("vendors", (rows) => setVendorsState(rows.map(rowToVendor)));
    liveTable("purchase_orders", (rows) => setPurchaseState(rows.map(rowToPurchase)));
    liveTable("production_requests", (rows) => setProdRequestsState(rows.map(rowToProd)));
    liveTable("users", (rows) => setUsersState(sortUsers(rows.map(rowToUser), recentUsersRef.current)));
    liveTable("overheads", (rows) => setOverheadsState(rows.map(rowToOverhead)));

    return () => { active = false; supabase.removeChannel(channel); extraChannels.forEach((ch) => supabase.removeChannel(ch)); };
  }, []);

  // Refresh in-memory state from the Supabase cache (instant — no LMS pagination) + season.
  // Cross-references against Studio's own event_orders here — confirmed live (2026-10-25) this had
  // never actually run: `lms_contracts` rows are written server-side (supabase/functions/lms) with
  // matchedEoId/matchType hardcoded null and nothing else ever set them, so every LMS contract's
  // Calendar card showed unmatched regardless of whether a real Studio booking existed for it —
  // which is also why a booked deal doubled up as 4 calendar cards instead of 2 (see
  // CalendarTab.jsx's calEvents, which now skips a contract's own card once it's id-matched).
  const loadLmsFromCache = useCallback(async () => {
    const { contracts: rawContracts, lastSync } = await fetchCachedContracts();
    const contracts = crossReferenceContracts(rawContracts, eventOrdersRef.current);
    setLmsContracts(contracts);
    const season = await fetchSeason();
    if (season) setStudioLmsCache({ dateCategories: buildDateCategories(season, contracts) });
    return lastSync;
  }, []);

  // Keep Date Pricing's auto-synced categories in step with the calendar whenever LMS/season data
  // refreshes — manual overrides (datePricing.markedDates) still win via resolveDateCategory, this
  // is just the default. Split out from loadLmsFromCache and gated on `settingsLoaded` so it can
  // never race the real settings boot-load and persist SETTINGS_DEFAULTS on top of an admin's
  // actual saved categories/markedDates.
  // Owner ask (2026-10-11): this was re-firing invisibly — any ops person opening IMS could silently
  // flip a date's category (and so every live Studio quote on it) with zero visibility to sales.
  // datePricing.autoSyncPaused freezes autoCategories at whatever they currently are until someone
  // explicitly turns it back on (Admin → Settings → Date Pricing Config) — manual markedDates
  // overrides are untouched either way.
  //
  // Confirmed live (2026-10-25): "untouched either way" was not actually true. This effect fires on
  // every `studioLmsCache` refresh, independently in EVERY open IMS tab/session — including one that
  // hasn't yet caught up to a markedDates override another tab just set (realtime lag, or simply a
  // tab that loaded settings before the override existed). Going through setSettings spread the
  // WHOLE `s.datePricing` from THAT tab's own (possibly stale) local snapshot and upserted it as one
  // value — so a background tab's routine autoCategories refresh could silently overwrite someone
  // else's just-added Filler/King's override with its own outdated copy that never had it. Writing
  // through a server-side shallow JSONB merge (merge_settings_json) instead means this write can
  // PHYSICALLY only ever touch the `autoCategories` key inside datePricing — markedDates,
  // autoSyncPaused, autoSyncLockCode and categories are never part of the patch, so no snapshot
  // staleness in this effect can ever clobber them again, regardless of which tab's local state is
  // behind. Bypasses the generic setSettings/settingsWriter path on purpose for this one write —
  // going through it would still enqueue its own whole-object upsert from local state and reintroduce
  // the exact race this fixes.
  useEffect(() => {
    if (!settingsLoaded || !studioLmsCache?.dateCategories) return;
    const AUTO_CAT_MAP = { "Heavy Saya": "heavy_saya", "Saya": "competition", "Normal": "non_saya" };
    const autoCategories = {};
    Object.entries(studioLmsCache.dateCategories).forEach(([d, cat]) => { autoCategories[d] = AUTO_CAT_MAP[cat] || "non_saya"; });
    const s = settingsRef.current || {};
    if (s.datePricing?.autoSyncPaused) return; // paused — leave autoCategories exactly as-is
    if (JSON.stringify(s.datePricing?.autoCategories || {}) === JSON.stringify(autoCategories)) return; // no-op, skip the write
    const nextSettings = { ...s, datePricing: { ...s.datePricing, autoCategories } };
    settingsRef.current = nextSettings;
    setSettingsState(nextSettings);
    // markWriting/markSettled: see settingsWriter.js's own comment — this RPC bypasses enqueue, so
    // without these isDirty/isStaleFor can't tell a concurrent realtime echo (from ANY other settings
    // key changing) to prefer local state over a pre-commit read of this one.
    // Its own id, distinct from mergeDatePricing's (never a single shared "settings:datePricing" for
    // every sub-field) — otherwise an admin's still-failed lock-code/pause edit could be silently
    // cleared from the banner by THIS unrelated merge succeeding, or a second sub-field's failure
    // could silently replace the first one's reported problem (and its retry closure) in the store.
    const id = "settings:datePricing:autoCategories";
    const runMerge = () => {
      // Re-check the pause flag at RETRY time too (manual click, or the one-shot auto-retry on
      // reconnect) — not just the one checked above when this effect run started. Without this, an
      // admin who pauses auto-sync WHILE a failed sync is still pending could have that pause
      // defeated the moment connectivity returns, by a retry still carrying the pre-pause value.
      if (settingsRef.current?.datePricing?.autoSyncPaused) { clearSaveProblem(id); return Promise.resolve({ ok: true }); }
      settingsWriterRef.current.markWriting("datePricing");
      return supabase.rpc("merge_settings_json", { p_key: "datePricing", p_patch: { autoCategories } })
        .then(({ error }) => {
          settingsWriterRef.current.markSettled("datePricing", !error);
          if (error) {
            console.warn("[settings] autoCategories merge failed:", error.message);
            reportSaveProblem(id, {
              label: "Date pricing: auto-sync", error, retry: runMerge,
              onDiscard: () => { settingsWriterRef.current.discardKey("datePricing"); refetchSettingsAfterDiscard(); },
            });
            return { ok: false };
          }
          clearSaveProblem(id);
          return { ok: true };
        })
        .catch((e) => {
          settingsWriterRef.current.markSettled("datePricing", false);
          reportSaveProblem(id, {
            label: "Date pricing: auto-sync", error: e, retry: runMerge,
            onDiscard: () => { settingsWriterRef.current.discardKey("datePricing"); refetchSettingsAfterDiscard(); },
          });
          return { ok: false };
        });
    };
    runMerge();
  }, [studioLmsCache, settingsLoaded]);

  // Same reasoning as the autoCategories effect above, generalized: EVERY write to a sub-field of
  // datePricing (the multiplier inputs, pause/resume, the lock code, clearing overrides, the
  // Calendar's own per-date override picker) used to go through the generic setSettings — which
  // spreads THIS TAB's own local s.datePricing and upserts the WHOLE value. A tab whose local
  // categories (or any other sub-field) is even slightly stale — loaded before someone else's edit
  // landed, or missed a realtime update — silently re-saves its stale copy the next time it does ANY
  // unrelated datePricing action. Confirmed live (2026-10-26): an admin's own King's multiplier edit
  // (categories.heavy_saya.multiplier) kept reverting to the 1.4 default with no edit to that field
  // at all — some OTHER open tab/action was writing its own stale categories back on top.
  // mergeDatePricing patches ONLY the sub-field named, via the same server-side shallow JSONB merge
  // (merge_settings_json) as autoCategories, so a write here can PHYSICALLY only ever touch the keys
  // passed in patch — every sibling sub-field (including ones a stale tab doesn't know changed) is
  // left exactly as the database already has it, regardless of this tab's own staleness.
  const mergeDatePricing = useCallback((patch) => {
    if (!settingsLoadedRef.current) {
      // The server-side merge itself can only ever touch the keys named in `patch` — but callers
      // (DatePricingPanel's multiplier/pause/lock-code editors) build `patch` FROM the local
      // settings.datePricing snapshot, which is still SETTINGS_DEFAULTS if the real settings never
      // loaded. A multiplier edit, for example, rebuilds and merges the WHOLE categories sub-object
      // from that default baseline, resetting every other multiplier. Refuse instead of guessing.
      setError("Settings haven't loaded yet — reload the page before changing date pricing. Nothing was saved.");
      return { ok: false };
    }
    const s = settingsRef.current || {};
    const nextSettings = { ...s, datePricing: { ...s.datePricing, ...patch } };
    settingsRef.current = nextSettings;
    setSettingsState(nextSettings);
    // markWriting/markSettled: see settingsWriter.js's own comment — without this, a pause/lock-code
    // write here is invisible to isDirty/isStaleFor, so a realtime echo triggered by ANY unrelated
    // settings-table write elsewhere can silently revert it back to the pre-write value.
    // One id PER SUB-FIELD actually touched (never a single shared "settings:datePricing" for every
    // patch) — same reasoning as the autoCategories effect's own id above: a lock-code failure and a
    // pause failure are two independent problems, and either one succeeding must not silently clear
    // the other's still-unresolved banner entry.
    const id = `settings:datePricing:${Object.keys(patch).sort().join(",")}`;
    const onDiscard = () => { settingsWriterRef.current.discardKey("datePricing"); refetchSettingsAfterDiscard(); };
    settingsWriterRef.current.markWriting("datePricing");
    return supabase.rpc("merge_settings_json", { p_key: "datePricing", p_patch: patch })
      .then(({ error }) => {
        settingsWriterRef.current.markSettled("datePricing", !error);
        if (error) {
          console.warn("[settings] datePricing merge failed:", error.message);
          reportSaveProblem(id, { label: "Date pricing", error, retry: () => mergeDatePricing(patch), onDiscard });
          return { ok: false };
        }
        clearSaveProblem(id);
        return { ok: true };
      })
      .catch((e) => {
        settingsWriterRef.current.markSettled("datePricing", false);
        reportSaveProblem(id, { label: "Date pricing", error: e, retry: () => mergeDatePricing(patch), onDiscard });
        return { ok: false };
      });
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
  // §23 PHASE 3 ORCHESTRATOR — keep trussAlloc in sync with sold event orders:
  // (1) reserve (hard block) when an EO is sold, (2) one-time backfill of already-sold EOs.
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

  // ── One-time backfill of already-sold EOs into truss allocation ──
  useEffect(() => {
    if (!user) return;
    if (trussBackfilledRef.current) return;
    if (!Array.isArray(eventOrders)) return;
    if (!trussInv || !trussInv.pillars) return;
    // truss_allocations never genuinely loaded this session — setTrussAlloc below would silently
    // refuse to write (see its own guard), but this effect would still persist the "done" flag
    // right after, permanently skipping the real backfill on every future, successful load too.
    if (loadOkRef.current.truss_allocations !== true) return;
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

  // ══════════════════════════════════════════════════════════════════════════
  // PLATFORM BOOKING — same two-effect shape as the truss orchestrator above, targeting
  // platformEngine.js / platformAlloc / platform_allocations instead. See platformEngine.js's own
  // header comment for why this tracks sqft-by-material rather than per-size piece counts.
  // ══════════════════════════════════════════════════════════════════════════
  // ── Promote to a hard platform reservation when an EO is sold/confirmed ──
  useEffect(() => {
    if (!user) return;
    if (!Array.isArray(eventOrders) || eventOrders.length === 0) return;
    if (!trussInv || !trussInv.platforms) return;
    const toPromote = eventOrders.filter((eo) => {
      if (!eo || !eo.id) return false;
      if (platformPromotedRef.current.has(eo.id)) return false;
      if (eo.status === "pending" || !eo.status) return false;
      return true;
    });
    if (toPromote.length === 0) return;
    let nextAlloc = { ...platformAllocRef.current };
    const datesToRecompute = new Set();
    toPromote.forEach((eo) => {
      platformPromotedRef.current.add(eo.id);
      const fnList = eoToFnList(eo);
      const fnsByDate = {};
      fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (!d) return; if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); });
      Object.entries(fnsByDate).forEach(([d, fns]) => {
        const eventEntry = buildEventPlatformAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns);
        if (Object.keys(eventEntry.totalPlatformSqftByMaterial).length === 0) return; // no platform in this event
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
    datesToRecompute.forEach((d) => { nextAlloc = allocatePlatformForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "auto-promote-on-sold"); });
    if (datesToRecompute.size > 0) {
      setPlatformAlloc(nextAlloc);
      datesToRecompute.forEach((d) => appendPlatformAudit({ date: d, event: "promote-soft-to-hard", triggerEoIds: toPromote.map((e) => e.id), eventCount: nextAlloc[d]?.events?.length || 0, feasible: !!nextAlloc[d]?.stockSummary?.feasible }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventOrders, trussInv, user]);

  // ── One-time backfill of already-sold EOs into platform allocation ──
  useEffect(() => {
    if (!user) return;
    if (platformBackfilledRef.current) return;
    if (!Array.isArray(eventOrders)) return;
    if (!trussInv || !trussInv.platforms) return;
    // See the truss backfill effect's identical guard above: without this, a refused
    // setPlatformAlloc write would still get the "done" flag persisted right after it.
    if (loadOkRef.current.platform_allocations !== true) return;
    (async () => {
      try {
        const flag = await kvGet(PLATFORM_BACKFILLED_SK);
        const alreadyDone = flag === "1" || flag === '"1"';
        if (alreadyDone) { platformBackfilledRef.current = true; return; }
        const soldEos = eventOrders.filter((eo) => eo && eo.id && eo.status && eo.status !== "pending");
        const eosToBackfill = soldEos.filter((eo) => {
          const d = eo.date || eo.functionsDetail?.[0]?.date || "";
          if (!d) return false;
          return !(platformAllocRef.current[d]?.events || []).some((ev) => ev.eoId === eo.id);
        });
        if (eosToBackfill.length === 0) {
          await reliableSave(PLATFORM_BACKFILLED_SK, "1", "Platform alloc backfill flag");
          platformBackfilledRef.current = true;
          return;
        }
        let nextAlloc = { ...platformAllocRef.current };
        const datesChanged = new Set();
        eosToBackfill.forEach((eo) => {
          platformPromotedRef.current.add(eo.id);
          const fnList = eoToFnList(eo);
          const fnsByDate = {};
          fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (d) { if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); } });
          Object.entries(fnsByDate).forEach(([d, fns]) => {
            const eventEntry = buildEventPlatformAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns);
            if (Object.keys(eventEntry.totalPlatformSqftByMaterial).length === 0) return;
            const dateEntry = nextAlloc[d] || { events: [] };
            const existingEvents = Array.isArray(dateEntry.events) ? [...dateEntry.events] : [];
            const filtered = existingEvents.filter((ev) => ev.eoId !== eventEntry.eoId);
            filtered.push(eventEntry);
            nextAlloc[d] = { ...dateEntry, events: filtered };
            datesChanged.add(d);
          });
        });
        datesChanged.forEach((d) => { nextAlloc = allocatePlatformForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "platform-backfill"); });
        setPlatformAlloc(nextAlloc);
        await reliableSave(PLATFORM_BACKFILLED_SK, "1", "Platform alloc backfill flag");
        platformBackfilledRef.current = true;
        await appendPlatformAudit({ date: "ALL", event: "platform-backfill", eventCount: eosToBackfill.length, datesAffected: datesChanged.size });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[platform-alloc] backfill FAILED", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventOrders, trussInv]);

  // ══════════════════════════════════════════════════════════════════════════
  // BATTA BOOKING — same two-effect shape as the truss/platform orchestrators above, targeting
  // battaEngine.js / battaAlloc / batta_allocations instead.
  // ══════════════════════════════════════════════════════════════════════════
  // ── Promote to a hard batta reservation when an EO is sold/confirmed ──
  useEffect(() => {
    if (!user) return;
    if (!Array.isArray(eventOrders) || eventOrders.length === 0) return;
    if (!trussInv || !trussInv.batta) return;
    const toPromote = eventOrders.filter((eo) => {
      if (!eo || !eo.id) return false;
      if (battaPromotedRef.current.has(eo.id)) return false;
      if (eo.status === "pending" || !eo.status) return false;
      return true;
    });
    if (toPromote.length === 0) return;
    let nextAlloc = { ...battaAllocRef.current };
    const datesToRecompute = new Set();
    toPromote.forEach((eo) => {
      battaPromotedRef.current.add(eo.id);
      const fnList = eoToFnList(eo);
      const fnsByDate = {};
      fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (!d) return; if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); });
      Object.entries(fnsByDate).forEach(([d, fns]) => {
        const eventEntry = buildEventBattaAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns, trussInv);
        if (Object.keys(eventEntry.totalBattaRftByMaterial).length === 0) return; // no truss (so no batta) in this event
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
    datesToRecompute.forEach((d) => { nextAlloc = allocateBattaForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "auto-promote-on-sold"); });
    if (datesToRecompute.size > 0) {
      setBattaAlloc(nextAlloc);
      datesToRecompute.forEach((d) => appendBattaAudit({ date: d, event: "promote-soft-to-hard", triggerEoIds: toPromote.map((e) => e.id), eventCount: nextAlloc[d]?.events?.length || 0, feasible: !!nextAlloc[d]?.stockSummary?.feasible }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventOrders, trussInv, user]);

  // ── One-time backfill of already-sold EOs into batta allocation ──
  useEffect(() => {
    if (!user) return;
    if (battaBackfilledRef.current) return;
    if (!Array.isArray(eventOrders)) return;
    if (!trussInv || !trussInv.batta) return;
    // See the truss backfill effect's identical guard above: without this, a refused
    // setBattaAlloc write would still get the "done" flag persisted right after it.
    if (loadOkRef.current.batta_allocations !== true) return;
    (async () => {
      try {
        const flag = await kvGet(BATTA_BACKFILLED_SK);
        const alreadyDone = flag === "1" || flag === '"1"';
        if (alreadyDone) { battaBackfilledRef.current = true; return; }
        const soldEos = eventOrders.filter((eo) => eo && eo.id && eo.status && eo.status !== "pending");
        const eosToBackfill = soldEos.filter((eo) => {
          const d = eo.date || eo.functionsDetail?.[0]?.date || "";
          if (!d) return false;
          return !(battaAllocRef.current[d]?.events || []).some((ev) => ev.eoId === eo.id);
        });
        if (eosToBackfill.length === 0) {
          await reliableSave(BATTA_BACKFILLED_SK, "1", "Batta alloc backfill flag");
          battaBackfilledRef.current = true;
          return;
        }
        let nextAlloc = { ...battaAllocRef.current };
        const datesChanged = new Set();
        eosToBackfill.forEach((eo) => {
          battaPromotedRef.current.add(eo.id);
          const fnList = eoToFnList(eo);
          const fnsByDate = {};
          fnList.forEach((fn) => { const d = fn.date || eo.date || ""; if (d) { if (!fnsByDate[d]) fnsByDate[d] = []; fnsByDate[d].push(fn); } });
          Object.entries(fnsByDate).forEach(([d, fns]) => {
            const eventEntry = buildEventBattaAllocation({ eoId: eo.id, clientId: eo.clientId || "", clientName: eo.clientName || "", fnIdx: 0, state: "hard", expiry: null, heldBy: eo.salesperson || "—", createdAt: eo.createdAt || Date.now() }, fns, trussInv);
            if (Object.keys(eventEntry.totalBattaRftByMaterial).length === 0) return;
            const dateEntry = nextAlloc[d] || { events: [] };
            const existingEvents = Array.isArray(dateEntry.events) ? [...dateEntry.events] : [];
            const filtered = existingEvents.filter((ev) => ev.eoId !== eventEntry.eoId);
            filtered.push(eventEntry);
            nextAlloc[d] = { ...dateEntry, events: filtered };
            datesChanged.add(d);
          });
        });
        datesChanged.forEach((d) => { nextAlloc = allocateBattaForDate(nextAlloc, d, nextAlloc[d]?.events || [], trussInv, "batta-backfill"); });
        setBattaAlloc(nextAlloc);
        await reliableSave(BATTA_BACKFILLED_SK, "1", "Batta alloc backfill flag");
        battaBackfilledRef.current = true;
        await appendBattaAudit({ date: "ALL", event: "batta-backfill", eventCount: eosToBackfill.length, datesAffected: datesChanged.size });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[batta-alloc] backfill FAILED", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventOrders, trussInv]);

  // A few fast, silent attempts (writeWithRetry) absorb a transient blip before any of these
  // row-level writers' own setError ever surfaces a failure — each upsert/delete call below is
  // already naturally idempotent (resending the same final row/id twice is a no-op), so retrying
  // can't itself cause damage. retryable:false throughout, same reasoning as supabase.js's
  // upsertRow/updateRow/deleteRow: a LATER automatic retry (on reconnect, possibly minutes later)
  // could resend a stale snapshot over a newer change from another tab/user. Unlike updateRow's
  // PARTIAL patches, every write below sends the row's FULL current contents, so two overlapping
  // writes to the SAME id racing within one writer's own retry window is safe BY CONSTRUCTION FOR A
  // SINGLE WRITE — the older one being dropped as "superseded" is correct (the newer call's payload
  // already carries everything the older one did, from the same `next` snapshot it diffed against).
  // That guarantee does NOT automatically extend to a writer that fires several of these calls in a
  // SEQUENTIAL loop over multiple changed rows (persistBlocks fixed this with Promise.all — see its
  // own comment for the exact race): a slower-to-start-but-logically-older call could still reach a
  // LATER row in its own loop after a genuinely newer call already wrote that row, and "win" with a
  // stale snapshot, since supersession only tracks "which call claimed this row's generation most
  // recently," not which call is logically newer. The other sequential loops below (setFunctions,
  // setVendors, setPurchase, setOverheads, setSupervisors, setUsers, setProdRequests, setEventOrders,
  // setProjects) carry the same theoretical risk, narrower than blocks' (no single row here holds
  // more than one logical entity's data) — tracked as follow-up work, not fixed in this pass.
  const retryingUpsert = (table, row, onConflict = "id", opts = {}) => writeWithRetry(
    () => supabase.from(table).upsert(row, { onConflict }),
    { target: `${table}:${row[onConflict]}`, label: `${table} row`, retryable: false, ...opts },
  );
  const retryingDelete = (table, id, onConflict = "id", opts = {}) => writeWithRetry(
    () => supabase.from(table).delete().eq(onConflict, id),
    { target: `${table}:${id}`, label: `${table} row`, retryable: false, ...opts },
  );

  // Persist only the rows that actually changed (CLAUDE.md rule #1 — never re-save the whole table).
  const persistInventory = useCallback(async (prev, next, deletedIds) => {
    const { upserts, deletes } = diffInventory(prev, next, deletedIds, user?.name || null);
    for (const row of upserts) {
      const { error: e } = await retryingUpsert("inventory", row);
      if (e) setError(`Save failed: ${e.message}`);
    }
    for (const id of deletes) {
      const { error: e } = await retryingDelete("inventory", id);
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
    trackWrite(persistInventory(prev, next, deletedIds));
  }, [persistInventory, trackWrite]);

  // functions writes (block reservations). Persist changed function rows to Supabase.
  const setFunctions = useCallback((updater) => {
    const prev = fnsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    fnsRef.current = next;
    setFns(next);
    const prevMap = new Map(prev.map((f) => [f.id, f]));
    trackWrite((async () => {
      for (const fn of next) {
        const before = prevMap.get(fn.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(fn)) {
          // report:false on this first attempt — a 23503 here (checked below) is the NORMAL path
          // for a brand-new event (see comment below), not a real failure yet, so it must not flash
          // a save-health banner that the fallback then immediately clears a beat later. Any outcome
          // that ISN'T that expected race reports explicitly itself, right below. report:false also
          // disables writeWithRetry's own clear-on-success, so a genuine success here is cleared by
          // hand too — otherwise a PRIOR failed save of this same function (still listed, Discard
          // only) would wrongly keep showing "failed" after this attempt actually lands.
          const first = await retryingUpsert("functions", fnToRow(fn), "id", { report: false });
          let e = first.error;
          if (first.ok) clearSaveProblem(`write:functions:${fn.id}`);
          // functions.project_id → projects.id. A brand-new event (eventAutoConfirm) creates its
          // project and functions together, and the two saves run in parallel — the function row
          // could land first and hit the FK before its project existed ("functions_project_id_fkey").
          // So on that error: write the project (already in projectsRef, set just before) and retry.
          // If the project really is gone, save the function unlinked rather than not at all — its
          // projectId is still in the row's data blob. (23503 is one of defaultShouldAbort's
          // non-retryable codes, so retryingUpsert's own attempts never delay reaching this check.)
          if (e && e.code === "23503" && fn.projectId) {
            const proj = projectsRef.current.find((p) => p.id === fn.projectId);
            if (proj) {
              const pr = await retryingUpsert("projects", projectToRow(proj));
              if (!pr.error) ({ error: e } = await retryingUpsert("functions", fnToRow(fn)));
            } else {
              console.warn(`[ims] function ${fn.id}: project ${fn.projectId} not found — saving without the link`);
              ({ error: e } = await retryingUpsert("functions", { ...fnToRow(fn), project_id: null }));
            }
          } else if (e) {
            // The first attempt failed for a reason the fallback above never runs for (not a 23503
            // FK race, or no projectId to retry with) — this IS a terminal failure, so report it
            // explicitly since the first attempt's own report was suppressed.
            reportSaveProblem(`write:functions:${fn.id}`, { label: "functions row", error: e });
          }
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  const setVendors = useCallback((updater) => {
    const prev = vendorsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    vendorsRef.current = next;
    setVendorsState(next);
    const prevMap = new Map(prev.map((v) => [v.id, v]));
    trackWrite((async () => {
      for (const v of next) {
        const before = prevMap.get(v.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(v)) {
          const { error: e } = await retryingUpsert("vendors", vendorToRow(v));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  const setPurchase = useCallback((updater) => {
    const prev = purchaseRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    purchaseRef.current = next;
    setPurchaseState(next);
    const prevMap = new Map(prev.map((p) => [p.id, p]));
    trackWrite((async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await retryingUpsert("purchase_orders", purchaseToRow(p));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  const setOverheads = useCallback((updater) => {
    const prev = overheadsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    overheadsRef.current = next;
    setOverheadsState(next);
    const prevMap = new Map(prev.map((o) => [o.id, o]));
    trackWrite((async () => {
      for (const o of next) {
        const before = prevMap.get(o.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(o)) {
          const { error: e } = await retryingUpsert("overheads", overheadToRow(o));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  const setSupervisors = useCallback((updater) => {
    const prev = supervisorsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    supervisorsRef.current = next;
    setSupervisorsState(next);
    const prevMap = new Map(prev.map((s) => [s.id, s]));
    const nextIds = new Set(next.map((s) => s.id));
    trackWrite((async () => {
      for (const s of next) {
        const before = prevMap.get(s.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(s)) {
          const { error: e } = await retryingUpsert("supervisors", supervisorToRow(s));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await retryingDelete("supervisors", id);
      }
    })());
  }, [trackWrite]);

  // Users — row-level diff persistence to the users table (incl. per-user apps + role/perms).
  const setUsers = useCallback((updater) => {
    const prev = usersRef.current;
    const raw = typeof updater === "function" ? updater(prev) : updater;
    const prevMap = new Map(prev.map((u) => [u.id, u]));
    // Whoever actually changed goes to the front of the recency list. Compared against the previous
    // state rather than assumed, so re-saving with no edits doesn't reshuffle the table.
    const touched = raw
      .filter((u) => { const b = prevMap.get(u.id); return b && JSON.stringify(b) !== JSON.stringify(u); })
      .map((u) => u.id);
    if (touched.length) {
      recentUsersRef.current = [...touched, ...recentUsersRef.current.filter((id) => !touched.includes(id))];
    }
    // Sorted here as well as on the refetch. Without it the row settles into its new position a
    // moment AFTER you save, when the realtime echo lands — so it appears to move on its own.
    const next = sortUsers(raw, recentUsersRef.current);
    usersRef.current = next;
    setUsersState(next);
    const nextIds = new Set(next.map((u) => u.id));
    trackWrite((async () => {
      for (const u of next) {
        const before = prevMap.get(u.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(u)) {
          const { error: e } = await retryingUpsert("users", userToRow(u));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await retryingDelete("users", id);
      }
    })());
  }, [trackWrite]);

  // Pure INSERT for a brand-new user — never diffs/updates/deletes existing rows. Used by the
  // "Add User" flow so adding one user can't touch any other row in the table.
  const addUser = useCallback(async (newUser) => {
    // Sorted, so a new user appears in their alphabetical place rather than at the end and then
    // hopping once the refetch arrives.
    recentUsersRef.current = [newUser.id, ...recentUsersRef.current];
    const next = sortUsers([...(usersRef.current || []), newUser], recentUsersRef.current);
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
    trackWrite((async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await retryingUpsert("production_requests", prodToRow(p));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextIds.has(id)) await retryingDelete("production_requests", id);
      }
    })());
  }, [trackWrite]);

  // event_orders — array of EO objects (.id). Row-level diff persistence; second arg is
  // deleted ids (faithful to the reference setEventOrders(v, del) contract).
  const setEventOrders = useCallback((updater, deletedIds = []) => {
    const prev = eventOrdersRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    eventOrdersRef.current = next;
    setEventOrdersState(next);
    const prevMap = new Map(prev.map((e) => [e.id, e]));
    const nextIds = new Set(next.map((e) => e.id));
    trackWrite((async () => {
      for (const eo of next) {
        const before = prevMap.get(eo.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(eo)) {
          const { error: e } = await retryingUpsert("event_orders", { id: eo.id, client_name: eo.clientName ?? null, event_id: eo.eventId ?? null, fn_id: eo.fnId ?? null, status: eo.status ?? "pending", items: eo.items || [], manual_items: eo.manualItems || [], decisions: eo.decisions || {}, data: eo });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of [...deletedIds, ...[...prevMap.keys()].filter((id) => !nextIds.has(id))]) {
        await retryingDelete("event_orders", id);
      }
    })());
  }, [trackWrite]);
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
      // One retryingUpsert call per item (not a single batched upsert of the whole array) so each
      // item's row gets its own target/supersession scope — a blip retrying item A's row must never
      // be keyed together with item B's in the same batch. Started together (Promise.all), NOT in a
      // sequential loop: a sequential loop only claims item k's supersession generation once items
      // 0..k-1 have each finished their own round trip, so a SLOWER-to-start but logically OLDER
      // persistBlocks call (built from an earlier blocksRef snapshot) could reach item j's write
      // AFTER a genuinely newer call already wrote it there — and "win" with its own older,
      // narrower snapshot, since supersession only knows "which call claimed this item's generation
      // most recently," not which call was actually logically newer. Starting every item's write in
      // the same tick closes that window — confirmed by reproducing the race with a sequential loop
      // and verifying Promise.all does not exhibit it.
      const results = await Promise.all([
        ...upserts.map((row) => retryingUpsert("blocks", row)),
        ...deletes.map((id) => retryingDelete("blocks", id)),
      ]);
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
    } catch (e) { setError(`Save failed: ${e?.message || e}`); }
  };
  // A blocks row holds EVERY event's reservations on that one item — if the table's initial fetch
  // failed, blocksRef.current is sitting at {} (not "genuinely no reservations exist"), and writing
  // from that empty baseline would upsert just this session's own reservation over a row that, in
  // the database, still holds every other event's. Refuse instead of guessing, same as blocks' own
  // table-level reasoning above.
  const setBlocks = useCallback((updater) => {
    if (loadOkRef.current.blocks !== true) {
      setError("Block reservations haven't loaded — reload the page before changing them. Nothing was saved.");
      return;
    }
    const prev = blocksRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    blocksRef.current = next;
    setBlocksState(next);
    trackWrite(persistBlocks(next, prev));
  }, [trackWrite]);
  const saveBlocks = useCallback((val) => {
    if (loadOkRef.current.blocks !== true) {
      setError("Block reservations haven't loaded — reload the page before changing them. Nothing was saved.");
      return;
    }
    const prev = blocksRef.current;
    const next = typeof val === "function" ? val(prev) : val;
    blocksRef.current = next;
    setBlocksState(next);
    trackWrite(persistBlocks(next, prev));
  }, [trackWrite]);
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
  const saveAmendRequests = useCallback((next) => {
    const prev = amendReqRef.current || [];
    amendReqRef.current = next; setAmendRequests(next);
    const prevMap = new Map(prev.map((r) => [r.id, r]));
    const nextIds = new Set((next || []).map((r) => r.id));
    return trackWrite((async () => {
      try {
        for (const req of (next || [])) {
          const before = prevMap.get(req.id);
          if (!before || JSON.stringify(before) !== JSON.stringify(req)) {
            const { error } = await retryingUpsert("amend_requests", { id: req.id, status: req.status ?? null, data: req });
            if (error) throw error;
          }
        }
        for (const id of [...prevMap.keys()].filter((id) => !nextIds.has(id))) await retryingDelete("amend_requests", id);
      } catch (e) { setError(`Save failed: ${e?.message || e}`); }
    })());
  }, [trackWrite]);

  // projects — row-level diff persistence to the projects table.
  const setProjects = useCallback((updater) => {
    const prev = projectsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    projectsRef.current = next;
    setProjectsState(next);
    const prevMap = new Map(prev.map((p) => [p.id, p]));
    trackWrite((async () => {
      for (const p of next) {
        const before = prevMap.get(p.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(p)) {
          const { error: e } = await retryingUpsert("projects", projectToRow(p));
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  // Truss allocations — object keyed by date. allocateForDate returns the whole map;
  // we persist only the dates whose entry actually changed (CLAUDE.md rule #1).
  const setTrussAlloc = useCallback((updater) => {
    if (loadOkRef.current.truss_allocations !== true) {
      setError("Truss allocations haven't loaded — reload the page before changing them. Nothing was saved.");
      return;
    }
    const prev = trussAllocRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    trussAllocRef.current = next;
    setTrussAllocState(next);
    trackWrite((async () => {
      for (const date of Object.keys(next)) {
        if (JSON.stringify(prev[date]) !== JSON.stringify(next[date])) {
          const { error: e } = await retryingUpsert("truss_allocations", allocToRow(date, next[date]), "date");
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  // Platform allocations — same shape/persistence rule as setTrussAlloc above, targeting the
  // platform_allocations table (migration 052).
  const setPlatformAlloc = useCallback((updater) => {
    if (loadOkRef.current.platform_allocations !== true) {
      setError("Platform allocations haven't loaded — reload the page before changing them. Nothing was saved.");
      return;
    }
    const prev = platformAllocRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    platformAllocRef.current = next;
    setPlatformAllocState(next);
    trackWrite((async () => {
      for (const date of Object.keys(next)) {
        if (JSON.stringify(prev[date]) !== JSON.stringify(next[date])) {
          const { error: e } = await retryingUpsert("platform_allocations", allocToRow(date, next[date]), "date");
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  // Batta allocations — same shape/persistence rule as setTrussAlloc/setPlatformAlloc above,
  // targeting the batta_allocations table (migration 052).
  const setBattaAlloc = useCallback((updater) => {
    if (loadOkRef.current.batta_allocations !== true) {
      setError("Batta allocations haven't loaded — reload the page before changing them. Nothing was saved.");
      return;
    }
    const prev = battaAllocRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    battaAllocRef.current = next;
    setBattaAllocState(next);
    trackWrite((async () => {
      for (const date of Object.keys(next)) {
        if (JSON.stringify(prev[date]) !== JSON.stringify(next[date])) {
          const { error: e } = await retryingUpsert("batta_allocations", allocToRow(date, next[date]), "date");
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
    })());
  }, [trackWrite]);

  // Truss inventory is a single-row key-value (key='main', data JSONB).
  const setTrussInv = useCallback((updater) => {
    // Refuse to save before the real row has actually landed — see trussInvLoadedRef's own comment
    // for the incident this closes (an edit made while trussInv still held INIT_TRUSS_INV silently
    // upserted that empty placeholder over the real 9/24/14-row fabric stock).
    if (!trussInvLoadedRef.current) {
      setError("Truss/fabric inventory hasn't finished loading — this change was NOT saved, to avoid overwriting real data with an empty placeholder. Reload the page and try again.");
      return;
    }
    setTrussInvState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      trackWrite(retryingUpsert("truss_inventory", { key: "main", data: next }, "key").then(({ error: e }) => { if (e) setError(`Save failed: ${e.message}`); }));
      return next;
    });
  }, [trackWrite]);

  const setCategories = useCallback((updater) => {
    setCats((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  // Event Order auto-confirm engine — runs unconditionally regardless of which IMS tab is open
  // (formerly only ran while the now-removed "Events" tab happened to be mounted). See
  // src/lib/ims/eventAutoConfirm.js for what this does (matching, blocking, Project/Function
  // creation, auto-POs). Cancelling an event + releasing its held inventory now lives in the
  // Calendar tab instead of a dedicated Events screen.
  // Every table this pipeline reads or writes (matching, blocking inventory, Project/Function
  // creation, auto-POs) must have genuinely loaded this session — on a failed fetch the pipeline
  // would otherwise run unattended against an empty/placeholder snapshot and could, for example,
  // double-book inventory the real data already held reservations against.
  const autoConfirmReady = loadOkRef.current.inventory === true
    && loadOkRef.current.event_orders === true
    && loadOkRef.current.blocks === true
    && loadOkRef.current.functions === true
    && loadOkRef.current.projects === true
    && loadOkRef.current.purchase_orders === true
    // settingsLoadedRef, not loadOkRef.current.settings: settingsLoadedRef is also updated by a
    // later successful settings realtime refresh (applySettingsRows), so a one-time boot failure
    // that self-heals doesn't leave this pipeline permanently stuck off for the rest of the session
    // the way the table-level loadOkRef entries above (never retried this session) intentionally do.
    && settingsLoadedRef.current === true
    && trussInvLoadedRef.current === true;
  useEventOrderAutoConfirm({
    eventOrders, setEventOrders, inventory: items, blocks, setBlocks, saveBlocks, saveEventOrders,
    projects, setProjects, functions, setFunctions, purchase, setPurchase,
    settings, studio, trussInv, setTrussInv, ready: autoConfirmReady,
  });

  const handleLogout = async () => {
    // Same race Studio's own doLogout used to have: navigating away immediately can outrun any of
    // the setX writes above that are still mid-flight. Race against a timeout so a hung/slow write
    // never traps someone on the logout screen.
    await Promise.race([flushBeforeReload(), new Promise((r) => setTimeout(r, 2500))]);
    logout();
    navigate("/login", { replace: true });
  };

  // ── ACCOUNT BLOCK ──
  // Defined once, rendered at the foot of both the desktop rail and the mobile drawer. Written
  // as one value rather than copied into each, so the two can never drift — the same reason the
  // nav itself is a component instead of two lists.
  const accountBlock = (
    <div className="mt-3 pt-3">
      <div className="flex items-center gap-2.5 px-1 pb-2.5">
        <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-sm font-bold">{(user?.name || "?")[0]}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 truncate">{user?.name || "—"}</div>
          <div className="text-[11px] text-gray-400 truncate">{user?.role || "User"}</div>
        </div>
      </div>
      {/* Full width, and red only on hover: signing out is destructive enough to want a moment's
          thought, but it is not a warning sitting in the rail all day. */}
      <button onClick={handleLogout}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 transition-colors">
        <span aria-hidden="true" className="shrink-0 w-5 flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M6 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2H6M10 10.5 13 7.5 10 4.5M13 7.5H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        Log out
      </button>
    </div>
  );

  // Role-based tab filtering (faithful to reference).
  // A role with no Tab Access config saved yet (settings.roleTabs) falls back to DEFAULT_ROLE_TABS
  // (so a narrow role like Site Supervisor lands on its own tab out of the box, not the whole app),
  // else to every tab EXCEPT Site — a brand-new, never-configured role has no business on a
  // single-purpose cross-department screen just because nobody has set up its Tab Access yet.
  const roleConfig = (settings?.roleTabs || {})[user?.role] || DEFAULT_ROLE_TABS[user?.role] || { tabs: TABS.filter((t) => t.id !== "site").map((t) => t.id) };
  const isAdmin = user?.role === "Admin" || user?.id === "u_admin";
  // Dashboard is Admin-only, full stop — not something a per-role Tab Access config can grant.
  // It's a company-wide rollup (total stock, finance-adjacent numbers, every upcoming function),
  // not scoped to what a role is otherwise allowed to see, so it's excluded here rather than left
  // to whatever an admin happened to tick for that role in Admin → Users → Tab Access.
  //
  // Attendance is the opposite: every role gets it unconditionally, never gated by that same
  // config. It's how anyone punches in or out — the "test"/"sub admin"/etc. tab lists above were
  // all saved before this feature existed, so nobody had ticked it for any role, and without this
  // force-include every non-admin would be unable to reach Attendance at all until an admin went
  // and edited every single role by hand.
  let allowedTabs = isAdmin ? TABS : TABS.filter((t) => t.id !== "dashboard" && (t.id === "attendance" || (roleConfig.tabs || []).includes(t.id)));
  // Department heads (+ Admin) get an Approvals tab for last-minute amendment requests.
  // Dept Ops offers a "pick an event from the Calendar" button, but only to roles that actually
  // have the Calendar tab — otherwise it would send someone to a tab their permissions exclude.
  const canSeeCalendar = allowedTabs.some((t) => t.id === "calendar");
  if (canApprove(user) && !allowedTabs.some((t) => t.id === "approvals")) {
    const pendN = (amendRequests || []).filter((r) => r.status === "pending").length;
    allowedTabs = [...allowedTabs, { id: "approvals", label: `✅ Approvals${pendN ? ` (${pendN})` : ""}` }];
  }
  // The tab actually rendered. `tab` starts as "dashboard" on a fresh browser tab (and can be any
  // remembered/deep-linked id), and the body used to render it as-is — so a non-admin opening IMS
  // in a new tab landed on the admin Dashboard. Anything this user isn't allowed falls back to their
  // first allowed tab (Attendance for every non-admin, since it is always included above).
  const activeTab = allowedTabs.some((t) => t.id === tab) ? tab : (allowedTabs[0]?.id || "attendance");
  // Attendance's sub-items in the rail — only the ones this user can open. Same gates AttendanceTab
  // applies when it renders them: Labour Punch needs labour access (Admin always has it), the
  // rest are Admin-only.
  const attSubs = [
    labourPunchDepts(user, myLabourAccess).length > 0 && { id: "labour", label: "Labour Punch" },
    isAdmin && { id: "quiz", label: "Quiz Setup" },
    isAdmin && { id: "log", label: "Staff Log" },
    isAdmin && { id: "labourlog", label: "Labour Log" },
    isAdmin && { id: "location", label: "Manage Locations" },
  ].filter(Boolean);
  allowedTabs = allowedTabs.map((t) => (t.id === "attendance" && attSubs.length ? { ...t, children: attSubs } : t));
  // Rail: a top-level row clears any open Attendance sub-view (Attendance itself = the punch
  // screen); a sub-item opens Attendance on that view.
  // Sub-items start collapsed. Clicking Attendance opens the punch screen and its sub-items;
  // clicking it again while already on the punch screen folds them; any other tab folds them.
  const pickTab = (id) => {
    if (id === "attendance") setAttOpen((o) => (activeTab === "attendance" && !attView ? !o : true));
    else setAttOpen(false);
    setTab(id); setAttView(null);
  };
  const pickSub = (id, sub) => { setTab(id); setAttView(sub); setAttOpen(true); };
  const navSub = activeTab === "attendance" ? attView : null;
  const navExpanded = { attendance: attOpen };

  return (
    /* The page ground is what makes a white card a card. At bg-gray-50 (#F9FAFB) the ground and
       the cards sat at ~1.03:1 contrast — indistinguishable — so every card needed a drawn
       outline to exist at all. slate-100 roughly triples that separation, which lets the cards
       drop their rings and be told apart by fill and shadow instead of by a line.
       overflow-x-clip: on a phone, anything a few px too wide made the whole page pan sideways.
       clip, not hidden — hidden would make this a scroll container and unstick the sticky header. */
    <div className="min-h-screen bg-slate-100 font-sans overflow-x-clip">
      {/* Drag down at the top of the page to refresh — on phones, where the browser's own gesture is often missing. */}
      <PullToRefresh />
      {error && (
        <div style={{ position: "fixed", top: 8, right: 8, zIndex: 99999, background: "#dc2626", color: "#fff", padding: "12px 14px", borderRadius: 8, fontSize: 13, maxWidth: 380, boxShadow: "0 6px 20px rgba(0,0,0,0.25)", border: "1px solid #991b1b" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>❌ {error}</div>
          <button onClick={() => setError("")} style={{ background: "#fff", color: "#dc2626", border: "none", padding: "5px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}
      {/* No rule under the header. It is sticky, so content scrolls beneath it and something has
          to mark the edge — a soft shadow does that only when there is something behind it to
          cast onto, where a drawn line sat there permanently even with the page at the top. */}
      <div className="bg-white sticky top-0 z-40 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_-6px_rgba(16,24,40,0.12)]">
        <div className="w-full px-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3 py-2.5 sm:py-3">
            {/* Only route to the nav below lg, where the rail is not on screen. A drawn icon
                rather than the ☰ character, which renders at a different weight and baseline in
                every font — the same reason the close and chevron glyphs were replaced. */}
            <button onClick={() => setNavOpen(true)} aria-label="Open navigation"
              className="lg:hidden shrink-0 w-8 h-8 -ml-1.5 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition">
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
            {/* Logo and wordmark are one unit — gap-2.5, not the row's gap, so the switcher
                cannot look like it belongs to the name. */}
            <div className="flex items-center gap-2.5 min-w-0">
              {/* The app's own favicon mark, not a lettered placeholder. 48px favicon at 1x, the 180px
                  touch icon on retina phones so the mark stays sharp at 36px. Both live in public/,
                  so BASE_URL (/ambria-prod/) has to prefix them. */}
              <img src={`${import.meta.env.BASE_URL}favicon.png`} srcSet={`${import.meta.env.BASE_URL}favicon.png 1x, ${import.meta.env.BASE_URL}apple-touch-icon.png 2x`}
                alt="Ambria" width="36" height="36" decoding="async"
                className="shrink-0 w-9 h-9 rounded-xl object-cover shadow-[0_1px_2px_rgba(79,70,229,0.3),0_6px_16px_-8px_rgba(79,70,229,0.6)]" />
              <div className="min-w-0">
                {/* Smaller on a phone. At 18px it crowded the switcher off the row; the wordmark
                    does not need to be the largest thing on a 390px screen to be found. */}
                <h1 className="text-[15px] sm:text-lg font-bold text-gray-900 leading-tight tracking-tight truncate">Ambria IMS</h1>
                <p className="text-xs text-gray-400 hidden sm:block">Inventory Management System</p>
              </div>
            </div>
            {/* ml-auto, so Studio ⇄ IMS goes to the far right instead of trailing the wordmark.
                It still belongs to the app's identity rather than the account cluster — it says
                WHICH app you are in — but pinned right it reads as a switch rather than a suffix,
                and the row no longer has to fit everything into its left half. */}
            <div className="ml-auto shrink-0"><AppSwitcher current="ims" iconSize={12} /></div>
            {/* The account cluster moved to the foot of the nav rail — see `accountBlock`. Who
                you are and how to sign out belong with navigation, not beside the page title,
                and on a phone they were competing with it for the same row. */}
          </div>
        </div>
      </div>
      {/* ── NAV RAIL + CONTENT ──
          The tab strip became a vertical rail: at eight or nine entries a horizontal strip
          either wrapped to two rows or scrolled sideways, and in both cases you could not see
          the whole app at once. Same tabs, same ids, same role filtering — only the axis
          changed. Below lg the rail is off-screen and reachable from the ☰ in the header. */}
      <div className="flex">
        {/* top-[61px] is the sticky header's height: py-3 (24) + the 36px logo tile + 1px
            border. Anything taller in that row would push the rail's top out of line.
            The rail is a floating panel rather than a column with a rule down its edge: that
            border-r ran the full height of the page as one hard vertical line, which is the
            heaviest mark on the screen and sat right beside the lightest content. Padding on
            the aside and the elevation on the panel inside separate the two instead.
            Full height, so the panel reaches the bottom of the viewport rather than stopping
            under the last nav row. h resolves against the aside's CONTENT box, so py-4 is
            already subtracted — the panel ends at the fold, it does not overflow past it, and a
            role with enough tabs to exceed it scrolls inside the panel. */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-[61px] h-[calc(100vh-61px)] py-4 pl-4 pr-1">
          {/* Column, so the nav scrolls and the account block stays pinned to the foot rather
              than floating wherever the tab list happens to end. */}
          <div className="h-full flex flex-col bg-white rounded-2xl p-3 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)]">
            {/* overflow-x-hidden, or a horizontal scrollbar appears across the foot of the rail.
                  CSS computes the other axis to 'auto' the moment one axis is not 'visible', so
                  overflow-y-auto alone leaves overflow-x scrollable — and the rows nudge 2px
                  right on hover (hover:translate-x-0.5), which counts toward scrollable overflow.
                  Two pixels of transform were enough to put a full scrollbar on screen. */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <IMSNav tabs={allowedTabs} active={activeTab} onChange={pickTab} activeSub={navSub} onSub={pickSub} expanded={navExpanded} />
            </div>
            {accountBlock}
          </div>
        </aside>

        {/* Mobile drawer — same nav, same component, over a scrim. Always mounted so it can
            animate: the panel slides in from the left and the scrim fades, both on the same 300ms
            ease-out; closed, it ignores taps (pointer-events-none) and is inert, so nothing in it
            can take focus. -translate-x-[120%], not -full, so the panel's shadow is off screen too. */}
          <div inert={!navOpen} className={"lg:hidden fixed inset-0 z-50 flex " + (navOpen ? "" : "pointer-events-none")}>
            <div onClick={() => setNavOpen(false)}
              className={"absolute inset-0 bg-gray-900/40 transition-opacity duration-300 ease-out motion-reduce:transition-none " + (navOpen ? "opacity-100" : "opacity-0")} />
            {/* flex column, and the scroll moved onto the nav list inside — with overflow on the
                panel itself the account block scrolled away with the tabs instead of sitting at
                the foot of the drawer. */}
            {/* 208px, down from 240. The longest label here is "Approvals" — the drawer was sized
                for the desktop rail's content, not its own, and at 80vw it covered most of the
                page it is navigating. Narrower also leaves more of that page visible behind the
                scrim, which is what tells you the drawer is temporary. */}
            <div className={"relative w-52 max-w-[72vw] h-full bg-white rounded-r-2xl shadow-2xl py-4 px-2.5 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none will-change-transform "
              + (navOpen ? "translate-x-0" : "-translate-x-[120%]")}>
              <div className="flex items-center justify-between px-2 pb-2 mb-1">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Menu</span>
                <button onClick={() => setNavOpen(false)} aria-label="Close navigation" className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition">✕</button>
              </div>
              {/* overflow-x-hidden, or a horizontal scrollbar appears across the foot of the rail.
                  CSS computes the other axis to 'auto' the moment one axis is not 'visible', so
                  overflow-y-auto alone leaves overflow-x scrollable — and the rows nudge 2px
                  right on hover (hover:translate-x-0.5), which counts toward scrollable overflow.
                  Two pixels of transform were enough to put a full scrollbar on screen. */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                {/* Tapping Attendance keeps the drawer open — it unfolds its sub-items, and
                    closing on that tap hid them before they could be picked. */}
                <IMSNav tabs={allowedTabs} active={activeTab} onChange={(id) => { pickTab(id); if (!(id === "attendance" && attSubs.length)) setNavOpen(false); }} activeSub={navSub} onSub={(id, sub) => { pickSub(id, sub); setNavOpen(false); }} expanded={navExpanded} />
              </div>
              {accountBlock}
            </div>
          </div>

      <div className="flex-1 min-w-0 px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center text-gray-400 py-20"><div className="text-3xl mb-2">⏳</div>Loading Ambria IMS…</div>
        ) : activeTab === "dashboard" ? (
          <DashboardTab projects={projects} functions={functions} inventory={items} />
        ) : activeTab === "attendance" ? (
          <AttendanceTab authUser={user} settings={settings} setSettings={setSettings} users={users}
            view={attView} setView={setAttView} myLabourAccess={myLabourAccess} reloadLabourAccess={reloadLabourAccess} />
        ) : activeTab === "inventory" ? (
          <InventoryTab
            inventory={items} setInventory={setInventory}
            functions={functions} setFunctions={setFunctions}
            categories={categories} setCategories={setCategories}
            settings={settings} studio={studio}
            rateCardCategories={rateCardCategories} authUser={user}
            eventOrders={eventOrders}
            blocks={blocks} setBlocks={setBlocks} saveBlocks={saveBlocks}
          />
        ) : activeTab === "admin" ? (
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
            rcItems={studioRcItems} rcCats={studioRcCats} authUser={user} settingsLoaded={settingsLoaded}
          />
        ) : activeTab === "supply" ? (
          <SupplyTab
            purchase={purchase} setPurchase={setPurchase}
            inventory={items} setInventory={setInventory}
            projects={projects} functions={functions}
            prodRequests={prodRequests} setProdRequests={setProdRequests}
            studio={studio} authUser={user} settings={settings}
          />
        ) : activeTab === "planning" ? (
          <PlanningTab
            projects={projects} functions={functions} setFunctions={setFunctions} inventory={items} setInventory={setInventory}
            settings={settings} setSettings={setSettings}
            trussInv={trussInv} setTrussInv={setTrussInv}
            trussAlloc={trussAlloc} setTrussAlloc={setTrussAlloc} platformAlloc={platformAlloc} setPlatformAlloc={setPlatformAlloc} battaAlloc={battaAlloc} setBattaAlloc={setBattaAlloc} eventOrders={eventOrders} setEventOrders={setEventOrders} blocks={blocks}
            studio={studio} authUser={user} amendRequests={amendRequests}
            focusEventId={focusEventId} focusSearch={focusSearch} focusLeadEntry={focusLeadEntry} onFocusHandled={clearFocusEvent}
            autoPdfFor={autoPdfFor} onAutoPdfDone={finishAutoPdf}
            onGoToCalendar={canSeeCalendar ? goToCalendar : undefined}
            rateCardCategories={rateCardCategories} rcItems={studioRcItems} rcCats={studioRcCats}
            supervisors={supervisors}
          />
        ) : activeTab === "finance" ? (
          <FinanceTab
            projects={projects} functions={functions} inventory={items} purchase={purchase}
            settings={settings} setSettings={setSettings}
            overheads={overheads} setOverheads={setOverheads} authUser={user}
          />
        ) : activeTab === "calendar" ? (
          <CalendarTab
            lmsContracts={lmsContracts} studioLmsCache={studioLmsCache}
            onSyncLms={syncLms} lmsSyncing={lmsSyncing} settings={settings} setSettings={setSettings}
            mergeDatePricing={mergeDatePricing}
            eventOrders={eventOrders} setEventOrders={setEventOrders} saveEventOrders={saveEventOrders}
            blocks={blocks} setBlocks={setBlocks} saveBlocks={saveBlocks}
          />
        ) : activeTab === "flowers" ? (
          <FlowersTab
            settings={settings} setSettings={setSettings}
            functions={functions} setFunctions={setFunctions}
            supervisors={supervisors} setSupervisors={setSupervisors}
            studio={studio} authUser={user}
            syncRecipeRatesToStudio={syncRecipeRatesToStudio} tier15LastSync={tier15LastSync} tier15Syncing={tier15Syncing}
            inventory={items} rateCardCategories={rateCardCategories}
          />
        ) : activeTab === "approvals" ? (
          <ApprovalsTab
            amendRequests={amendRequests} saveAmendRequests={saveAmendRequests}
            authUser={user} inventory={items}
            blocks={blocks} setBlocks={setBlocksState} saveBlocks={saveBlocks}
          />
        ) : activeTab === "site" ? (
          <SiteSupervisorTab
            eventOrders={eventOrders} setEventOrders={setEventOrders}
            inventory={items} settings={settings}
            blocks={blocks} trussInv={trussInv} rateCardCategories={rateCardCategories}
            authUser={user}
          />
        ) : (
          <div className="text-center text-gray-400 py-20">
            <p className="text-2xl mb-2">{TABS.find((t) => t.id === tab)?.label}</p>
            <p className="text-sm">This tab is being rebuilt in a later phase.</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

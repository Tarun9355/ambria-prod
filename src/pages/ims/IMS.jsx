import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Tabs } from "../../components/ui";
import { supabase, fetchAll } from "../../lib/supabase";
import { rowToItem, itemToRow, diffInventory } from "../../lib/inventory/adapter";
import { SETTINGS_DEFAULTS } from "../../lib/ims/constants";
import { RC_CATS_DEFAULT } from "../../lib/studio/constants";
import InventoryTab from "./InventoryTab.jsx";
import DashboardTab from "./DashboardTab.jsx";
import AdminTab from "./AdminTab.jsx";
import SupplyTab from "./SupplyTab.jsx";
import PlanningTab from "./PlanningTab.jsx";
import FinanceTab from "./FinanceTab.jsx";
import CalendarTab from "./CalendarTab.jsx";
import FlowersTab from "./FlowersTab.jsx";
import { triggerLmsSync, fetchCachedContracts, fetchSeason, buildDateCategories } from "../../lib/ims/lms";

const LMS_STALE_MS = 30 * 60 * 1000; // re-sync in background only if cache older than 30 min

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

export default function IMS() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("dashboard");

  const [items, setItems] = useState([]);
  const [functions, setFns] = useState([]);
  const [projects, setProjects] = useState([]);
  const [vendors, setVendorsState] = useState([]);
  const [purchase, setPurchaseState] = useState([]);
  const [boxes, setBoxesState] = useState([]);
  const [overheads, setOverheadsState] = useState([]);
  const [supervisors, setSupervisorsState] = useState([]);
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
  const settingsRef = useRef(SETTINGS_DEFAULTS);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { fnsRef.current = functions; }, [functions]);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  useEffect(() => { boxesRef.current = boxes; }, [boxes]);
  useEffect(() => { overheadsRef.current = overheads; }, [overheads]);
  useEffect(() => { supervisorsRef.current = supervisors; }, [supervisors]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Initial load + inventory Realtime subscription ──
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [invRows, fnRows, projRows, venRows, poRows, boxRows, ohRows, supRows, rcRows, catRows, setRows] = await Promise.all([
          fetchAll("inventory"),
          fetchAll("functions").catch(() => []),
          fetchAll("projects").catch(() => []),
          fetchAll("vendors").catch(() => []),
          fetchAll("purchase_orders").catch(() => []),
          fetchAll("boxes").catch(() => []),
          fetchAll("overheads").catch(() => []),
          fetchAll("supervisors").catch(() => []),
          fetchAll("rate_card").catch(() => []),
          fetchAll("categories").catch(() => []),
          fetchAll("settings").catch(() => []),
        ]);
        if (!active) return;
        setItems(invRows.map(rowToItem));
        setFns(fnRows.map(rowToFn));
        setProjects(projRows.map(rowToProject));
        setVendorsState(venRows.map(rowToVendor));
        setPurchaseState(poRows.map(rowToPurchase));
        setBoxesState(boxRows.map(rowToBox));
        setOverheadsState(ohRows.map(rowToOverhead));
        setSupervisorsState(supRows.map(rowToSupervisor));
        setStudioRcItems(rcRows.map((r) => ({ ...(r.data || {}), id: r.id })));
        setCats(catRows.map((c) => c.name).filter(Boolean));
        const settingsObj = { ...SETTINGS_DEFAULTS };
        for (const r of setRows) settingsObj[r.key] = r.value;
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
            studio={studio} authUser={user} settings={settings}
          />
        ) : tab === "planning" ? (
          <PlanningTab
            projects={projects} functions={functions} inventory={items}
            settings={settings} boxes={boxes} setBoxes={setBoxes} authUser={user}
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

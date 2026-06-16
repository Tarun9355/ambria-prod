import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Tabs } from "../../components/ui";
import { supabase, fetchAll } from "../../lib/supabase";
import { rowToItem, itemToRow, diffInventory } from "../../lib/inventory/adapter";
import InventoryTab from "./InventoryTab.jsx";
import DashboardTab from "./DashboardTab.jsx";
import AdminTab from "./AdminTab.jsx";
import SupplyTab from "./SupplyTab.jsx";
import PlanningTab from "./PlanningTab.jsx";

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
  const [categories, setCats] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Studio cross-app sync (rate-card cats/subcats) arrives in a later phase. Stub for now —
  // InventoryTab degrades to INV_CATS + a flat (empty) sub-cat list.
  const studio = useMemo(() => ({ subcats: [], catLabels: [], subcatsByCat: {}, loading: false }), []);

  const itemsRef = useRef([]);
  const fnsRef = useRef([]);
  const vendorsRef = useRef([]);
  const purchaseRef = useRef([]);
  const boxesRef = useRef([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { fnsRef.current = functions; }, [functions]);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  useEffect(() => { boxesRef.current = boxes; }, [boxes]);

  // ── Initial load + inventory Realtime subscription ──
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [invRows, fnRows, projRows, venRows, poRows, boxRows, catRows, setRows] = await Promise.all([
          fetchAll("inventory"),
          fetchAll("functions").catch(() => []),
          fetchAll("projects").catch(() => []),
          fetchAll("vendors").catch(() => []),
          fetchAll("purchase_orders").catch(() => []),
          fetchAll("boxes").catch(() => []),
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
        setCats(catRows.map((c) => c.name).filter(Boolean));
        const settingsObj = {};
        for (const r of setRows) settingsObj[r.key] = r.value;
        setSettings(settingsObj);
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
          <AdminTab vendors={vendors} setVendors={setVendors} functions={functions} settings={settings} />
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

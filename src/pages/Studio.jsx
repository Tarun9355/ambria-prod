import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { supabase, fetchAll } from "../lib/supabase";
import { RC_D } from "../lib/studio/constants";
import RateCard from "./studio/RateCard.jsx";

// ── studio_events row ⇄ object adapter ──
const rowToEvent = (row) => ({ ...(row.data || {}), id: row.id, name: row.name ?? row.data?.name, client: row.client ?? row.data?.client, venue: row.venue ?? row.data?.venue, img: row.img ?? row.data?.img, functions: row.data?.functions || row.functions || [] });
const eventToRow = (e) => ({ id: e.id, name: e.name ?? null, client: e.client ?? null, venue: e.venue ?? null, img: e.img ?? null, functions: e.functions || [], data: e });

// ── rate_card row ⇄ rcItem adapter ──
const rowToRcItem = (row) => ({ ...(row.data || {}), id: row.id });
const rcItemToRow = (i) => ({ id: i.id, name: i.name ?? null, cat: i.cat ?? null, sub: i.sub ?? null, unit: i.unit ?? null, inhouse_mode: i.inhouseMode ?? "flat", inhouse_flat: i.inhouseFlat ?? 0, inhouse_s: i.inhouseS ?? 0, inhouse_m: i.inhouseM ?? 0, inhouse_b: i.inhouseB ?? 0, out_s: i.outS ?? 0, out_m: i.outM ?? 0, out_b: i.outB ?? 0, zones: i.zones || [], floral_mode: i.floralMode ?? null, default_real_pct: i.defaultRealPct ?? null, data: i });

const MANAGE_TABS = [
  { id: "library", label: "🖼️ Library" },
  { id: "pricing", label: "💲 Pricing" },
  { id: "settings", label: "⚙️ Settings" },
];

function Placeholder({ name, note }) {
  return (
    <div className="text-center text-gray-400 py-20">
      <p className="text-2xl mb-1">{name}</p>
      <p className="text-sm">{note || "This section of Studio is being rebuilt."}</p>
    </div>
  );
}

// Studio app shell — foundation. Live: event cards (studio_events) + create.
// The deal builder, Library, Pricing and Settings are large sub-apps rebuilt in
// subsequent Studio slices.
export default function Studio() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("studio"); // studio | manage
  const [manageTab, setManageTab] = useState("library");
  const [events, setEvents] = useState([]);
  const [rcItems, setRcItemsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const eventsRef = useRef([]);
  const rcRef = useRef([]);
  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { rcRef.current = rcItems; }, [rcItems]);

  // Rate Card: load from rate_card; seed RC_D into the table on first run (one-time).
  useEffect(() => {
    let active = true;
    fetchAll("rate_card").then(async (rows) => {
      if (!active) return;
      if (rows.length > 0) { setRcItemsState(rows.map(rowToRcItem)); return; }
      setRcItemsState(RC_D);
      for (let i = 0; i < RC_D.length; i += 100) {
        await supabase.from("rate_card").upsert(RC_D.slice(i, i + 100).map(rcItemToRow), { onConflict: "id" }).catch(() => {});
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const setRcItems = useCallback((updater) => {
    const prev = rcRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    rcRef.current = next;
    setRcItemsState(next);
    const prevMap = new Map(prev.map((i) => [i.id, i]));
    const nextIds = new Set(next.map((i) => i.id));
    (async () => {
      for (const i of next) {
        const before = prevMap.get(i.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(i)) {
          const { error: e } = await supabase.from("rate_card").upsert(rcItemToRow(i), { onConflict: "id" });
          if (e) setError(`Save failed: ${e.message}`);
        }
      }
      for (const id of prevMap.keys()) if (!nextIds.has(id)) await supabase.from("rate_card").delete().eq("id", id);
    })();
  }, []);

  useEffect(() => {
    let active = true;
    fetchAll("studio_events")
      .then((rows) => { if (active) { setEvents(rows.map(rowToEvent)); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    const channel = supabase
      .channel("realtime:studio_events")
      .on("postgres_changes", { event: "*", schema: "public", table: "studio_events" }, (payload) => {
        setEvents((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== payload.old.id);
          const next = rowToEvent(payload.new);
          return prev.some((r) => r.id === next.id) ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next];
        });
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const createEvent = useCallback(async () => {
    const id = "se_" + Date.now();
    const ev = { id, name: "New Event", client: "", venue: "", img: "", functions: [] };
    setEvents((prev) => [...prev, ev]);
    const { error: e } = await supabase.from("studio_events").upsert(eventToRow(ev), { onConflict: "id" });
    if (e) setError(`Save failed: ${e.message}`);
  }, []);

  const handleLogout = () => { logout(); navigate("/login", { replace: true }); };

  const filtered = events.filter((e) => {
    const q = search.trim().toLowerCase();
    return !q || [e.name, e.client, e.venue].filter(Boolean).some((v) => v.toLowerCase().includes(q));
  });

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {error && (
        <div style={{ position: "fixed", top: 8, right: 8, zIndex: 99999, background: "#dc2626", color: "#fff", padding: "12px 14px", borderRadius: 8, fontSize: 13, maxWidth: 380 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>❌ {error}</div>
          <button onClick={() => setError("")} style={{ background: "#fff", color: "#dc2626", border: "none", padding: "5px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}
      <div className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: "linear-gradient(135deg,#C9A96E,#8B7355)" }}>A</div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Ambria</h1>
                <p className="text-xs text-gray-400">Design Studio</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                <button onClick={() => setMode("studio")} className={"px-4 py-2 rounded-lg text-sm font-medium transition-all " + (mode === "studio" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>🎨 Studio</button>
                <button onClick={() => setMode("manage")} className={"px-4 py-2 rounded-lg text-sm font-medium transition-all " + (mode === "manage" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>🛠️ Manage</button>
              </div>
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-sm font-bold ml-2">{(user?.name || "?")[0]}</div>
              <span className="text-sm text-gray-700 hidden sm:block">{user?.name} · {user?.role || "User"}</span>
              <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 ml-2 px-2 py-1 border rounded-lg">Logout</button>
            </div>
          </div>
          {mode === "manage" && (
            <div className="pb-3 flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {MANAGE_TABS.map((t) => (
                <button key={t.id} onClick={() => setManageTab(t.id)} className={"px-4 py-2 rounded-lg text-sm font-medium transition-all " + (manageTab === t.id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>{t.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center text-gray-400 py-20"><div className="text-3xl mb-2">⏳</div>Loading Studio…</div>
        ) : mode === "studio" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search events..." className="border rounded-lg px-3 py-2 text-sm w-64" />
              <button onClick={createEvent} className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ New Event</button>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center text-gray-400 py-20">
                <p className="text-2xl mb-1">🎉 No events yet</p>
                <p className="text-sm">Click “+ New Event” to start a deal.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((e) => (
                  <div key={e.id} className="bg-white border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
                    {e.img
                      ? <img src={e.img} alt={e.name} className="w-full h-40 object-cover" />
                      : <div className="w-full h-40 bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center text-5xl">🎊</div>}
                    <div className="p-4">
                      <p className="font-bold text-gray-900">{e.name}</p>
                      <p className="text-sm text-gray-500">{e.client || "—"}{e.venue ? ` · ${e.venue}` : ""}</p>
                      <p className="text-xs text-gray-400 mt-1">{(e.functions || []).length} function(s)</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 text-center pt-4">The full deal builder (zones, elements, pricing, client presentation) is rebuilt in the next Studio slices.</p>
          </div>
        ) : manageTab === "library" ? (
          <Placeholder name="🖼️ Library" note="Photo library + AI tagging — rebuilt in a later Studio slice." />
        ) : manageTab === "pricing" ? (
          <RateCard rcItems={rcItems} setRcItems={setRcItems} />
        ) : (
          <Placeholder name="⚙️ Settings" note="Studio settings (venues, zones, tags, clients, calendar) — rebuilt in a later Studio slice." />
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { isLiveEventOrder } from "../../lib/ims/helpers";
import { catToDept as sharedCatToDept } from "../../lib/ims/deptClassify";
import { venueWithParent } from "../../lib/ims/fixedVenues";
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";
import SiteCrewPanel from "./SiteCrewPanel.jsx";

const PICK_KEY = "ambria-ims-site-event";
const SECTIONS = [
  { id: "receiving", label: "🚛 Receiving" },
  { id: "crew", label: "👷 Crew" },
];

// One page for the whole event, every department together — not the per-department tabs the rest
// of IMS uses. Built for the Site Supervisor role: a narrow login that only needs "what's arriving
// on each truck, right now" and "who's actually on site", not the dept-head planning screens.
export default function SiteSupervisorTab({ eventOrders, setEventOrders, inventory, settings, authUser }) {
  const [selId, setSelId] = useState(() => { try { return sessionStorage.getItem(PICK_KEY) || ""; } catch { return ""; } });
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("actual"); // "plan" | "actual"
  const [section, setSection] = useState("receiving");

  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);

  const fnDate = (eo) => {
    const dates = [eo?.date, ...((Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map((f) => f?.date))].filter(Boolean).map((d) => String(d).slice(0, 10));
    return dates.sort()[0] || "";
  };
  const events = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA");
    return (eventOrders || [])
      .filter(isLiveEventOrder)
      .map((eo) => ({ eo, d: fnDate(eo) }))
      .filter(({ d }) => !d || d >= weekAgo)
      .sort((a, b) => (a.d || "9999").localeCompare(b.d || "9999"))
      .map(({ eo, d }) => ({ eo, d, isToday: d === today }));
  }, [eventOrders]);
  const filtered = q.trim()
    ? events.filter(({ eo }) => [eo.clientName, eo.venue].some((v) => String(v || "").toLowerCase().includes(q.trim().toLowerCase())))
    : events;

  // Filtered through the same isLiveEventOrder test the picker list uses — a stale remembered id
  // (sessionStorage) for an event that's since gone pending/cancelled must not still open.
  const sel = (eventOrders || []).find((e) => e.id === selId && isLiveEventOrder(e)) || null;
  const pick = (id) => { setSelId(id); try { sessionStorage.setItem(PICK_KEY, id); } catch { /* private window — fine, just won't be remembered */ } };

  if (!sel) {
    return (
      <div className="space-y-3 max-w-xl">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search by client or venue…"
          className="w-full h-10 rounded-xl border border-gray-200 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
          {filtered.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No events found.</div>}
          {filtered.map(({ eo, d, isToday }) => (
            <button key={eo.id} onClick={() => pick(eo.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-gray-900 truncate">{eo.clientName || "Event"}</div>
                <div className="text-[11.5px] text-gray-400 truncate">{d || "no date"} · {venueWithParent(settings, eo.venue) || "—"}</div>
              </div>
              {isToday && <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">TODAY</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <button onClick={() => pick("")} className="shrink-0 w-8 h-8 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 flex items-center justify-center">‹</button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold text-gray-900 truncate">{sel.clientName || "Event"}</div>
            <div className="text-[12px] text-gray-500 mt-0.5">{fnDate(sel) || "no date"} · {venueWithParent(settings, sel.venue) || "—"}{sel.siteSupervisorName ? ` · Supervisor: ${sel.siteSupervisorName}` : ""}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <div className="inline-flex bg-gray-50 rounded-xl p-1 gap-0.5">
            <button onClick={() => setMode("plan")} aria-pressed={mode === "plan"}
              className={"h-8 px-3 rounded-lg text-[12.5px] font-semibold " + (mode === "plan" ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-white")}>📋 Planned</button>
            <button onClick={() => setMode("actual")} aria-pressed={mode === "actual"}
              className={"h-8 px-3 rounded-lg text-[12.5px] font-semibold " + (mode === "actual" ? "bg-amber-100 text-amber-700" : "text-gray-500 hover:bg-white")}>✅ Actual</button>
          </div>
          <span className="text-[11px] text-gray-400">{mode === "actual" ? "What's actually arrived & on site — editable" : "What the dept heads loaded & scheduled"}</span>
        </div>
      </div>

      <div className="flex gap-2">
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} aria-pressed={section === s.id}
            className={"h-9 px-3.5 rounded-xl text-[12.5px] font-semibold " + (section === s.id ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50")}>
            {s.label}
          </button>
        ))}
      </div>

      {section === "receiving" ? (
        <SiteReceivingPanel sel={sel} eventOrders={eventOrders} setEventOrders={setEventOrders} inventory={inventory} authUser={authUser} mode={mode} />
      ) : (
        <SiteCrewPanel sel={sel} setEventOrders={setEventOrders} settings={settings} inventory={inventory} authUser={authUser} catToDept={catToDept} mode={mode} />
      )}
    </div>
  );
}

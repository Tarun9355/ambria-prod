import { prodDeptToOpsDept } from "../../lib/ims/deptClassify";

// Planning → Dept Ops: the department's open production requests (Supply → Production), so the team
// sees what it has to make without opening Supply. Requests are tied to IMS functions, not Studio
// events, so the card lists all of a department's open requests; one whose function falls on a
// date of the open event is marked "This event's date" and listed first.
const STATUS_TONE = {
  Requested: "bg-gray-100 text-gray-700",
  Acknowledged: "bg-blue-100 text-blue-700",
  "In Progress": "bg-amber-100 text-amber-800",
  "Ready for Review": "bg-violet-100 text-violet-700",
  Confirmed: "bg-green-100 text-green-700",
};
const qtyOf = (r) => { const n = parseInt(r?.qty, 10); return n > 0 ? n : null; };

export default function ProductionRequestsCard({ prodRequests = [], functions = [], dept, eventDates, onZoom }) {
  const fnById = new Map((functions || []).map((f) => [f.id, f]));
  const dates = eventDates instanceof Set ? eventDates : new Set();
  const rows = (prodRequests || [])
    .filter((r) => r && r.status !== "Added to Inventory" && prodDeptToOpsDept(r.dept) === dept)
    .map((r) => {
      const fn = r.functionId ? fnById.get(r.functionId) : null;
      const fnDate = String(fn?.date || "").slice(0, 10);
      return { r, fn, fnDate, thisEvent: !!fnDate && dates.has(fnDate) };
    })
    .sort((a, b) => (b.thisEvent - a.thisEvent) || String(a.fnDate || "9999").localeCompare(String(b.fnDate || "9999")));
  if (rows.length === 0) return null;
  const pcs = rows.reduce((s, x) => s + (qtyOf(x.r) || 0), 0);

  return (
    <div className="bg-white/80 backdrop-blur border border-purple-200 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold text-gray-900">🏭 Production requests</h3>
        <span className="text-xs text-gray-500 tabular-nums">{rows.length} open · {pcs.toLocaleString("en-IN")} pcs</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ r, fn, fnDate, thisEvent }) => {
          const q = qtyOf(r);
          return (
            <div key={r.id} className="flex items-center gap-3 py-2.5">
              {r.refImg
                ? <button type="button" onClick={() => onZoom?.(r.refImg)} className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400" title="Enlarge">
                    <img src={r.refImg} alt="" className="w-11 h-11 rounded-lg object-cover border border-gray-200" />
                  </button>
                : <div className="shrink-0 w-11 h-11 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-base">🏭</div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-[13px] font-semibold text-gray-900" title={r.name}>{r.name || r.id}</span>
                  {thisEvent && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-600 text-white">This event's date</span>}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 truncate">
                  {fn ? `${fn.name || "Function"} · ${fnDate || "—"}` : r.buildType === "stock" ? "General stock" : "No function linked"}
                  {r.raisedBy ? ` · by ${r.raisedBy}` : ""}
                </div>
              </div>
              <span className={"shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full " + (STATUS_TONE[r.status] || STATUS_TONE.Requested)}>{r.status || "Requested"}</span>
              <span className="shrink-0 w-20 text-right tabular-nums">
                {q != null
                  ? <><span className="text-base font-extrabold text-gray-900">{q.toLocaleString("en-IN")}</span><span className="ml-0.5 text-[10px] text-gray-500">pcs</span></>
                  : <span className="text-xs font-bold text-amber-600">Qty not set</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

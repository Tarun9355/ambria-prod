import { useState } from "react";
import { mpDayWise, mpDayDihari } from "../../lib/ims/helpers";
import { poolLabourDept, poolLabourDeptLabel } from "../../lib/ims/deptClassify";
import {
  buildEventCrewByDept, applyDeptOpsPatch, actualCrewPatch, resetLinePatch,
  shiftCountPatch, addDihariPatch, removeDihariPatch,
} from "../../lib/ims/deptCrew";

const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
const phaseLbl = (d) => d.phase === "minusOne" ? "−1 setup" : d.phase === "dismantle" ? "+1 dismantle" : d.phase === "gap" ? "gap" : (d.date || "event");

// Every department's crew for this event, grouped by labour pool (Structure's shared pool, Floral
// on its own — see deptClassify.js's poolLabourDept) instead of behind a department tab: the whole
// point of this page is to show every department's manpower together, not one at a time.
// Headcount/dihari only, deliberately no ₹ — this is a narrow, single-purpose login (owner ask).
export default function SiteCrewPanel({ sel, setEventOrders, settings, inventory, authUser, catToDept, mode }) {
  const [openRow, setOpenRow] = useState(null); // `${dept}|${type}` with its day/shift editor open

  const flowerPatterns = Array.isArray(settings?.flowerPatterns) ? settings.flowerPatterns : [];
  const byDept = buildEventCrewByDept({ sel, settings, inventory, flowerPatterns, catToDept });
  if (byDept.length === 0) return <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No manpower plan synced for this event yet.</div>;

  const pools = new Map();
  byDept.forEach(({ dept, crew }) => {
    const pool = poolLabourDept(dept);
    if (!pools.has(pool)) pools.set(pool, []);
    crew.mpRows.forEach((r) => pools.get(pool).push({ dept, r, crew }));
  });

  const write = (dept, patch) => setEventOrders((prev) => prev.map((e) => (e.id === sel.id ? applyDeptOpsPatch(e, dept, patch, authUser?.name) : e)));

  return (
    <div className="space-y-4">
      {[...pools.entries()].map(([pool, rows]) => (
        <div key={pool} className="bg-white rounded-xl border border-gray-100 shadow-[0_2px_4px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="text-[13.5px] font-bold text-gray-900 flex items-center gap-1.5">{DEPT_ICON[pool] || ""} {pool}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{poolLabourDeptLabel(pool)}</div>
          </div>
          {rows.map(({ dept, r, crew }) => {
            const key = `${dept}|${r.type}`;
            const daywise = mpDayWise(r) && Array.isArray(r.schedule);
            const rate = Number(r.rate) || 0;
            const planDihari = daywise ? Math.round(r.schedule.reduce((s, d) => s + mpDayDihari(r, d, {}, {}, {}), 0)) : Number(r.sysCount) || 0;
            const actDihari = daywise ? Math.round(r.schedule.reduce((s, d) => s + mpDayDihari(r, d, crew.mpDay, crew.mpWin, crew.mpWinCount), 0)) : Number(r.count) || 0;
            const edited = actDihari !== planDihari;
            const open = openRow === key;
            return (
              <div key={key} className="px-4 py-3 border-b border-gray-100 last:border-b-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {r.type}
                      <span className="text-[9.5px] font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[dept] || ""} {dept}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">Planned {planDihari} {daywise ? "dihari" : "people"}</div>
                  </div>
                  {mode === "actual" && daywise ? (
                    <span className={"shrink-0 h-8 inline-flex items-center gap-2 rounded-lg px-2.5 " + (edited ? "bg-amber-50 ring-1 ring-amber-200" : "bg-gray-50 ring-1 ring-gray-200")}>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Dihari</span>
                      <span className={"text-sm font-bold tabular-nums " + (edited ? "text-amber-700" : "text-gray-800")}>{actDihari}</span>
                    </span>
                  ) : mode === "actual" ? (
                    <label className="shrink-0 h-8 inline-flex items-center gap-2 rounded-lg px-2.5 bg-gray-50 ring-1 ring-gray-200">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">People</span>
                      <input type="number" min="0" value={Number(r.count) || 0} onChange={(e) => write(dept, actualCrewPatch(crew, r, crew.mpRows.indexOf(r), e.target.value))}
                        className={"w-12 bg-transparent text-sm text-center font-bold tabular-nums focus:outline-none " + (edited ? "text-amber-700" : "text-gray-800")} />
                    </label>
                  ) : (
                    <div className="shrink-0 text-sm font-bold tabular-nums text-gray-900">{planDihari}</div>
                  )}
                </div>
                {mode === "actual" && (
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    {daywise && r.schedule.length > 0 && (
                      <button onClick={() => setOpenRow(open ? null : key)}
                        className={"h-8 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold " + (open ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50")}>
                        By day / shift
                      </button>
                    )}
                    {edited && (
                      <button onClick={() => write(dept, resetLinePatch(crew, r))} className="h-8 inline-flex items-center rounded-lg px-2.5 text-[11px] font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-100">
                        ↺ Back to plan
                      </button>
                    )}
                  </div>
                )}
                {mode === "actual" && open && daywise && r.schedule.length > 0 && (
                  <div className="mt-2.5 bg-gray-50 ring-1 ring-gray-200 rounded-lg p-2.5 space-y-1">
                    {r.schedule.map((d, di) => {
                      const winDefs = (crew.dihari[r.type] && Array.isArray(crew.dihari[r.type].windows)) ? crew.dihari[r.type].windows : [];
                      const ids = crew.effWinIds(r, d) || [];
                      const hasSlots = winDefs.length > 0 || ids.length > 0;
                      return (
                        <div key={di} className="flex items-start gap-2 flex-wrap text-[11px] py-1.5">
                          <span className="w-24 text-gray-600 font-medium pt-1">{phaseLbl(d)}</span>
                          {hasSlots ? (
                            <div className="flex items-center gap-1.5 flex-wrap flex-1">
                              {ids.map((id, si) => {
                                const wd = winDefs.find((w) => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`;
                                return (
                                  <span key={id} className="inline-flex items-center gap-1 ring-1 ring-gray-200 rounded-lg px-1.5 py-0.5 bg-white">
                                    <span className="text-gray-400">{lbl}</span>
                                    <input type="number" min="0" value={crew.effShift(r, d, id)} onChange={(e) => write(dept, shiftCountPatch(crew, r.type, d.date, id, e.target.value, ids))}
                                      className="w-11 border border-gray-200 rounded px-1 py-0.5 text-center" />
                                    {ids.length > 1 && <button onClick={() => write(dept, removeDihariPatch(crew, r.type, d.date, id, ids))} className="text-red-300 hover:text-red-500">×</button>}
                                  </span>
                                );
                              })}
                              <button onClick={() => write(dept, addDihariPatch(crew, r, d.date, ids))} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full px-2 py-0.5">+ dihari</button>
                            </div>
                          ) : (
                            <span className="flex-1 text-gray-400">no shifts set</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

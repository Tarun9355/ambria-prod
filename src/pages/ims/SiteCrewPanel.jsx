import { useState } from "react";
import { mpDayWise, mpDayDihari } from "../../lib/ims/helpers";
import { poolLabourDept, poolLabourDeptLabel } from "../../lib/ims/deptClassify";
import {
  buildEventCrewByDept, applyDeptOpsPatch, actualCrewPatch, resetLinePatch,
  shiftCountPatch, addDihariPatch, removeDihariPatch,
} from "../../lib/ims/deptCrew";
import { actualsLockState, patchTouchesActuals } from "../../lib/ims/actualsLock";

const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
const phaseLbl = (d) => d.phase === "minusOne" ? "−1 setup" : d.phase === "dismantle" ? "+1 dismantle" : d.phase === "gap" ? "gap" : (d.date || "event");
// A day pill's label — "Today" wins over everything else; a plain event day gets a short date
// ("4 Nov"), a setup/dismantle/gap day keeps its phase label (there's no single date that reads
// better than "+1 dismantle" for the day after the event).
const pillLbl = (d, isToday) => {
  if (isToday) return "Today";
  if (!d.phase || d.phase === "event") {
    try { return new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { return d.date || "Day"; }
  }
  return phaseLbl(d);
};
// Which schedule day a freshly-opened editor should land on — the day matching today, else the
// nearest day still ahead, else the last day (every day has already passed). Same "what matters
// right now" default the Planning tab's own function picker uses.
const defaultDayIdx = (schedule, today) => {
  const onToday = schedule.findIndex((d) => d.date === today);
  if (onToday >= 0) return onToday;
  const upcoming = schedule.findIndex((d) => d.date >= today);
  return upcoming >= 0 ? upcoming : Math.max(0, schedule.length - 1);
};

// Every department's crew for this event, each in its OWN card — Lighting's Electricians,
// Tenting's Painters/Truss Labour/Fabric Bangali, Transport's Drivers and Structure's own
// Carpenters are each that department's own crew, not pooled with anyone else's. The only thing
// that ever pools across departments is the shared "Labours" crew (deptClassify.js's
// poolLabourDept) — so only a Labours row gets a note naming who it's pooled with; every other
// row is unambiguously this card's own department.
// Headcount/dihari only, deliberately no ₹ — this is a narrow, single-purpose login (owner ask).
// Cards collapse to a one-line summary (one open at a time, like Receiving's trucks) — Structure
// alone can carry several crew types, and showing every row of every card open at once turned
// this into a long, hard-to-scan phone scroll.
export default function SiteCrewPanel({ sel, setEventOrders, settings, inventory, authUser, catToDept, mode }) {
  const [openDept, setOpenDept] = useState(null); // department name, or null = the first one
  const [openRow, setOpenRow] = useState(null); // `${dept}|${type}` with its day/shift editor open
  const [activeDay, setActiveDay] = useState({}); // `${dept}|${type}` -> schedule index showing
  const today = new Date().toLocaleDateString("en-CA");
  // Post-event actuals lock (lib/ims/actualsLock.js) — the same lock DepartmentOpsTab shows, since
  // this panel writes the exact same deptOps crew fields that screen does.
  const lock = actualsLockState(sel, settings);

  const flowerPatterns = Array.isArray(settings?.flowerPatterns) ? settings.flowerPatterns : [];
  const byDept = buildEventCrewByDept({ sel, settings, inventory, flowerPatterns, catToDept });
  if (byDept.length === 0) return <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No manpower plan synced for this event yet.</div>;

  // Every row's figures computed once up front — the collapsed header needs the same totals the
  // open rows show, not a second pass over the same math.
  const depts = byDept.map(({ dept, crew }) => {
    const rows = crew.mpRows.map((r) => {
      const daywise = mpDayWise(r) && Array.isArray(r.schedule);
      const planDihari = daywise ? Math.round(r.schedule.reduce((s, d) => s + mpDayDihari(r, d, {}, {}, {}), 0)) : Number(r.sysCount) || 0;
      const actDihari = daywise ? Math.round(r.schedule.reduce((s, d) => s + mpDayDihari(r, d, crew.mpDay, crew.mpWin, crew.mpWinCount), 0)) : Number(r.count) || 0;
      // Only the shared Labours crew is ever pooled across departments — note who with, right on
      // its own row, rather than implying the WHOLE department's crew is shared.
      const pooledWith = (r.type === "Labours" && poolLabourDept(dept) === dept && poolLabourDeptLabel(dept) !== dept) ? poolLabourDeptLabel(dept) : null;
      return { dept, r, crew, daywise, planDihari, actDihari, pooledWith, edited: actDihari !== planDihari };
    });
    return {
      dept, rows,
      planTotal: rows.reduce((s, x) => s + x.planDihari, 0),
      actTotal: rows.reduce((s, x) => s + x.actDihari, 0),
      anyEdited: rows.some((x) => x.edited),
    };
  });

  // Only gates WRITE controls — opening a department/row, the day pills and "By day / shift" stay
  // usable on a locked event, same as they already are in Planned mode.
  const canEdit = mode === "actual" && !lock.locked;

  const write = (dept, patch) => setEventOrders((prev) => prev.map((e) => {
    if (e.id !== sel.id) return e;
    // Checked against the freshest row, not the render-time `lock` — a realtime reopen landing
    // between render and this write must be honoured immediately.
    if (patchTouchesActuals(patch) && actualsLockState(e, settings).locked) return e;
    return applyDeptOpsPatch(e, dept, patch, authUser?.name);
  }));

  return (
    <div className="space-y-3">
      {lock.locked && (
        <div className="rounded-xl bg-gray-800 text-white px-4 py-2.5 text-xs font-semibold flex items-center gap-2">
          🔒 Actuals locked for this event — an admin can reopen it above to make changes.
        </div>
      )}
      {depts.map(({ dept, rows, planTotal, actTotal, anyEdited }, di) => {
        const open = openDept === dept || (openDept == null && di === 0);
        return (
          <div key={dept} className="bg-white rounded-xl border border-gray-100 shadow-[0_2px_4px_rgba(15,23,42,0.06)] overflow-hidden">
            <button onClick={() => setOpenDept(open ? "" : dept)} className="w-full text-left px-4 py-3 bg-gray-50 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-gray-900 flex items-center gap-1.5">{DEPT_ICON[dept] || ""} {dept}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 truncate">{rows.length} crew type{rows.length === 1 ? "" : "s"}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={"text-sm font-bold tabular-nums " + (mode === "actual" && anyEdited ? "text-amber-700" : "text-gray-900")}>
                  {mode === "actual" ? actTotal : planTotal} <span className="text-[10px] font-semibold text-gray-400">dihari</span>
                </div>
                {mode === "actual" && anyEdited && <div className="text-[10px] font-semibold text-amber-600">edited</div>}
              </div>
              <span className="shrink-0 text-gray-300 text-sm">{open ? "▾" : "▸"}</span>
            </button>
            {open && rows.map(({ r, crew, daywise, planDihari, actDihari, pooledWith, edited }) => {
              const key = `${dept}|${r.type}`;
              const rowOpen = openRow === key;
              return (
                <div key={key} className="px-4 py-3 border-t border-gray-100">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900">{r.type}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">Planned {planDihari} {daywise ? "dihari" : "people"}</div>
                      {pooledWith && <div className="mt-1 text-[10.5px] text-blue-600">Pooled crew — shared with {pooledWith}</div>}
                    </div>
                    {mode === "actual" && daywise ? (
                      <span className={"shrink-0 h-8 inline-flex items-center gap-2 rounded-lg px-2.5 " + (edited ? "bg-amber-50 ring-1 ring-amber-200" : "bg-gray-50 ring-1 ring-gray-200")}>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Dihari</span>
                        <span className={"text-sm font-bold tabular-nums " + (edited ? "text-amber-700" : "text-gray-800")}>{actDihari}</span>
                      </span>
                    ) : mode === "actual" && canEdit ? (
                      <label className="shrink-0 h-8 inline-flex items-center gap-2 rounded-lg px-2.5 bg-gray-50 ring-1 ring-gray-200">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">People</span>
                        <input type="number" min="0" value={Number(r.count) || 0} onChange={(e) => write(dept, actualCrewPatch(crew, r, crew.mpRows.indexOf(r), e.target.value))}
                          className={"w-12 bg-transparent text-sm text-center font-bold tabular-nums focus:outline-none " + (edited ? "text-amber-700" : "text-gray-800")} />
                      </label>
                    ) : mode === "actual" ? (
                      <label className="shrink-0 h-8 inline-flex items-center gap-2 rounded-lg px-2.5 bg-gray-50 ring-1 ring-gray-200">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">People</span>
                        <span className={"text-sm font-bold tabular-nums " + (edited ? "text-amber-700" : "text-gray-800")}>{Number(r.count) || 0}</span>
                      </label>
                    ) : (
                      <div className="shrink-0 text-sm font-bold tabular-nums text-gray-900">{planDihari}</div>
                    )}
                  </div>
                  {mode === "actual" && (
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      {daywise && r.schedule.length > 0 && (
                        <button onClick={() => setOpenRow(rowOpen ? null : key)}
                          className={"h-8 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold " + (rowOpen ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50")}>
                          By day / shift
                        </button>
                      )}
                      {edited && canEdit && (
                        <button onClick={() => write(dept, resetLinePatch(crew, r))} className="h-8 inline-flex items-center rounded-lg px-2.5 text-[11px] font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-100">
                          ↺ Back to plan
                        </button>
                      )}
                    </div>
                  )}
                  {mode === "actual" && rowOpen && daywise && r.schedule.length > 0 && (() => {
                    const dayIdx = activeDay[key] ?? defaultDayIdx(r.schedule, today);
                    const d = r.schedule[Math.min(dayIdx, r.schedule.length - 1)];
                    const winDefs = (crew.dihari[r.type] && Array.isArray(crew.dihari[r.type].windows)) ? crew.dihari[r.type].windows : [];
                    const ids = crew.effWinIds(r, d) || [];
                    const hasSlots = winDefs.length > 0 || ids.length > 0;
                    return (
                      <div className="mt-2.5 bg-gray-50 ring-1 ring-gray-200 rounded-lg p-2.5">
                        {/* One day at a time — tap a pill to switch. Opens on today's (or the
                            next upcoming) day, since "what's my crew right now" is the question
                            that gets asked, not "walk me through the whole event". */}
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5 mb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {r.schedule.map((sd, si) => {
                            const on = si === dayIdx;
                            return (
                              <button key={si} onClick={() => setActiveDay((a) => ({ ...a, [key]: si }))}
                                className={"shrink-0 h-7 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap " + (on ? "bg-blue-600 text-white" : "bg-white ring-1 ring-gray-200 text-gray-600")}>
                                {pillLbl(sd, sd.date === today)}
                              </button>
                            );
                          })}
                        </div>
                        {hasSlots ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            {ids.map((id, si) => {
                              const wd = winDefs.find((w) => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`;
                              return (
                                <span key={id} className="inline-flex items-center gap-1.5 ring-1 ring-gray-200 rounded-lg pl-2 pr-1 py-1 bg-white">
                                  <span className="text-[11px] text-gray-500">{lbl}</span>
                                  {canEdit ? (
                                    <>
                                      <input type="number" min="0" value={crew.effShift(r, d, id)} onChange={(e) => write(dept, shiftCountPatch(crew, r.type, d.date, id, e.target.value, ids))}
                                        className="w-10 h-7 border border-gray-200 rounded text-[13px] text-center font-semibold" />
                                      {ids.length > 1 && (
                                        <button onClick={() => write(dept, removeDihariPatch(crew, r.type, d.date, id, ids))} aria-label="Remove this shift"
                                          className="w-6 h-6 -mr-0.5 rounded flex items-center justify-center text-red-300 hover:text-red-500 hover:bg-red-50 text-sm">×</button>
                                      )}
                                    </>
                                  ) : (
                                    <span className="w-10 text-[13px] text-center font-semibold text-gray-800">{crew.effShift(r, d, id)}</span>
                                  )}
                                </span>
                              );
                            })}
                            {canEdit && <button onClick={() => write(dept, addDihariPatch(crew, r, d.date, ids))} className="h-7 inline-flex items-center text-[11px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full px-2.5">+ dihari</button>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400">no shifts set</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

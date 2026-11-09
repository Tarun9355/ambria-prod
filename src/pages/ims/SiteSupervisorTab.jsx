import { useEffect, useMemo, useRef, useState } from "react";
import { isLiveEventOrder } from "../../lib/ims/helpers";
import { catToDept as sharedCatToDept } from "../../lib/ims/deptClassify";
import { venueWithParent } from "../../lib/ims/fixedVenues";
import { actualsLockState, reopenActualsPatch, relockActualsPatch } from "../../lib/ims/actualsLock";
import { logWrite } from "../../lib/studio/userActions";
import { Modal } from "../../components/ui";
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";
import SiteCrewPanel from "./SiteCrewPanel.jsx";
import SitePdfButton from "./SitePdfButton.jsx";

const PICK_KEY = "ambria-ims-site-event";
const SECTIONS = [
  { id: "receiving", label: "🚛 Receiving" },
  { id: "crew", label: "👷 Crew" },
];
const fnDate = (eo) => {
  const dates = [eo?.date, ...((Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map((f) => f?.date))].filter(Boolean).map((d) => String(d).slice(0, 10));
  return dates.sort()[0] || "";
};

// One page for the whole event, every department together — not the per-department tabs the rest
// of IMS uses. Built for the Site Supervisor role: a narrow login that only needs "what's arriving
// on each truck, right now" and "who's actually on site", not the dept-head planning screens.
export default function SiteSupervisorTab({ eventOrders, setEventOrders, inventory, settings, blocks, trussInv, rateCardCategories, authUser }) {
  const [selId, setSelId] = useState(() => { try { return sessionStorage.getItem(PICK_KEY) || ""; } catch { return ""; } });
  const [mode, setMode] = useState("actual"); // "plan" | "actual"
  const [section, setSection] = useState("receiving");

  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);

  // Filtered through the same isLiveEventOrder test the picker uses — a stale remembered id
  // (sessionStorage) for an event that's since gone pending/cancelled must not still open.
  const sel = (eventOrders || []).find((e) => e.id === selId && isLiveEventOrder(e)) || null;
  const pick = (id) => { setSelId(id); try { sessionStorage.setItem(PICK_KEY, id); } catch { /* private window — fine, just won't be remembered */ } };
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const [reopenPrompt, setReopenPrompt] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const lock = sel ? actualsLockState(sel, settings) : { locked: false, reopened: false };
  const doReopenActuals = () => {
    if (!sel) return;
    setEventOrders((prev) => prev.map((e) => (e.id === sel.id ? { ...e, actualsLock: reopenActualsPatch(e, authUser, reopenReason) } : e)));
    logWrite(authUser, "actuals.reopen", { targetType: "event_order", targetId: sel.id, targetName: sel.clientName, ok: true, detail: { reason: reopenReason } });
    setReopenPrompt(false); setReopenReason("");
  };
  const doRelockActuals = () => {
    if (!sel) return;
    setEventOrders((prev) => prev.map((e) => (e.id === sel.id ? { ...e, actualsLock: relockActualsPatch(e, authUser) } : e)));
    logWrite(authUser, "actuals.relock", { targetType: "event_order", targetId: sel.id, targetName: sel.clientName, ok: true });
  };

  if (!sel) return <EventPicker eventOrders={eventOrders} settings={settings} onPick={pick} />;

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
          <span className="text-[11px] text-gray-400">{mode === "actual" ? (lock.locked ? "Locked — this event's actuals are final" : "What's actually arrived & on site — editable") : "What the dept heads loaded & scheduled"}</span>
        </div>

        {lock.locked && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full bg-gray-800 text-white">🔒 Actuals locked</span>
            {isAdmin && <button type="button" onClick={() => setReopenPrompt(true)} className="font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2">Reopen for editing</button>}
          </div>
        )}
        {lock.reopened && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              🔓 Reopened by {lock.reopenedBy} until {new Date(lock.reopenUntil).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </span>
            {isAdmin && <button type="button" onClick={doRelockActuals} className="font-semibold text-gray-600 hover:text-gray-900 underline underline-offset-2">Lock again</button>}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-gray-100">
          <SitePdfButton sel={sel} settings={settings} inventory={inventory} blocks={blocks} trussInv={trussInv}
            rateCardCategories={rateCardCategories} eventOrders={eventOrders} authUser={authUser} catToDept={catToDept} />
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
        <SiteReceivingPanel sel={sel} eventOrders={eventOrders} setEventOrders={setEventOrders} inventory={inventory} authUser={authUser} mode={mode} settings={settings} />
      ) : (
        <SiteCrewPanel sel={sel} setEventOrders={setEventOrders} settings={settings} inventory={inventory} authUser={authUser} catToDept={catToDept} mode={mode} />
      )}

      <Modal open={reopenPrompt} onClose={() => { setReopenPrompt(false); setReopenReason(""); }} title="Reopen actuals for editing">
        <p className="text-sm text-gray-600 mb-3">Opens receiving and on-site crew for this event back up for 24 hours. Say why — this is logged.</p>
        <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} autoFocus rows={3} placeholder="e.g. a truck's receiving got confirmed before everything was actually checked"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => { setReopenPrompt(false); setReopenReason(""); }} className="px-4 py-2 text-sm rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200">Cancel</button>
          <button onClick={doReopenActuals} disabled={!reopenReason.trim()} className="px-4 py-2 text-sm rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">Reopen</button>
        </div>
      </Modal>
    </div>
  );
}

// ── PICK AN EVENT: A MONTH, THEN ITS DAY'S EVENTS ──
// A supervisor thinks in dates ("what's on today, what's on tomorrow"), not an alphabetised list
// of every sold deal — the same reason DepartmentOpsTab.jsx's own "Pick an event to plan" grid
// exists. This is a trimmed copy of that same grid (no department filter, since this page isn't
// scoped to one), not a shared component: that one is woven into a much larger page (PDF export,
// the department picker above it) that this page doesn't have.
function EventPicker({ eventOrders, settings, onPick }) {
  const _now = new Date();
  const today = _now.toLocaleDateString("en-CA"); // local date, not UTC — a function can run past midnight IST
  const [q, setQ] = useState("");
  const [pickMonth, setPickMonth] = useState({ y: _now.getFullYear(), m: _now.getMonth() });
  const [pickDay, setPickDay] = useState(null);

  const venueOf = (eo) => venueWithParent(settings, eo?.functionsDetail?.[0]?.venue || eo?.venue || "");
  // The first function's date, else the event's own — only a fallback for an event with no
  // functionsDetail at all. Deliberately NOT the earliest of every function date: pickByDate below
  // already files an event under every one of its function dates on its own, so using anything
  // else here would just add a phantom extra day whenever eo.date is stale (the deal moved later
  // after this field was last set, which functionsDetail doesn't retroactively correct).
  const firstDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || "";
  const events = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return (eventOrders || [])
      .map((eo) => ({ eo, date: firstDate(eo) }))
      .filter(({ eo }) => isLiveEventOrder(eo))
      .filter(({ eo }) => !qq || (eo.clientName || "").toLowerCase().includes(qq) || (eo.functionsDetail?.[0]?.venue || eo.venue || "").toLowerCase().includes(qq));
  }, [eventOrders, q]);

  // Open on a month that actually has something — nearest upcoming, else the most recent past
  // one — once, so paging around afterwards is never undone from under the supervisor.
  const pickInitRef = useRef(false);
  useEffect(() => {
    if (pickInitRef.current || events.length === 0) return;
    pickInitRef.current = true;
    const dated = events.map((e) => e.date).filter(Boolean).sort();
    const target = dated.find((d) => d >= today) || dated[dated.length - 1];
    if (target) { const dt = new Date(target + "T00:00:00"); setPickMonth({ y: dt.getFullYear(), m: dt.getMonth() }); }
  }, [events, today]);

  // Typing a search term jumps the grid to its earliest match's month — otherwise a client whose
  // event falls in a month you aren't currently viewing would just show "0 events this month"
  // with no hint of where it actually is.
  useEffect(() => {
    if (!q.trim() || events.length === 0) return;
    const dated = events.map((e) => e.date).filter(Boolean).sort();
    if (!dated.length) return;
    const dt = new Date(dated[0] + "T00:00:00");
    setPickMonth((cur) => (cur.y === dt.getFullYear() && cur.m === dt.getMonth() ? cur : { y: dt.getFullYear(), m: dt.getMonth() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Events for the visible month, bucketed by date — an event sits on EVERY one of its function
  // dates (a wedding with a mehendi a month earlier is work on both days), not just the first.
  const pickByDate = useMemo(() => {
    const out = {};
    events.forEach(({ eo, date }) => {
      const dates = [...new Set([...(eo.functionsDetail || []).map((f) => String(f?.date || "").slice(0, 10)), date].filter(Boolean))];
      dates.forEach((d) => {
        const [y, m] = d.split("-").map(Number);
        if (y !== pickMonth.y || m !== pickMonth.m + 1) return;
        (out[d] = out[d] || []).push(eo);
      });
    });
    return out;
  }, [events, pickMonth]);

  const { y, m } = pickMonth;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const prev = () => { setPickDay(null); setPickMonth(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }); };
  const next = () => { setPickDay(null); setPickMonth(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }); };
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const monthTotal = Object.values(pickByDate).reduce((s, a) => s + a.length, 0);
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const mCells = [];
  for (let i = startDow; i > 0; i--) { const dt = new Date(y, m, 1 - i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
  for (let d = 1; d <= dim; d++) mCells.push({ d, ds: `${y}-${pad(m + 1)}-${pad(d)}`, out: false });
  for (let i = 1; mCells.length % 7 !== 0; i++) { const dt = new Date(y, m + 1, i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
  const dayLabel = pickDay ? new Date(pickDay + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";

  return (
    <div className="space-y-3 max-w-3xl">
      <input value={q} onChange={(e) => { setQ(e.target.value); setPickDay(null); }} placeholder="🔍 Search by client or venue…"
        className="w-full h-10 rounded-xl border border-gray-200 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Pick an event</div>
            <h3 className="mt-0.5 text-base font-bold text-gray-900 tracking-tight">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
            <div className="text-[11px] text-gray-500 mt-0.5">{monthTotal} event{monthTotal === 1 ? "" : "s"} this month</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setPickDay(null); setPickMonth({ y: _now.getFullYear(), m: _now.getMonth() }); }}
              className="px-3 h-9 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition">Today</button>
            <button onClick={prev} title="Previous month" aria-label="Previous month"
              className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3.5 L5 7 L9 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={next} title="Next month" aria-label="Next month"
              className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        {/* Phone: dates-only dot grid; tapping a highlighted date lists that day's events below,
            at full width — a name-chip grid is unreadable once a column is ~45px wide. */}
        <div className="sm:hidden">
          <div className="grid grid-cols-7 px-2">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 px-2 pb-3 gap-1">
            {mCells.map(({ d, ds, out }) => {
              const evs = out ? [] : (pickByDate[ds] || []);
              const isToday = ds === today;
              const on = pickDay === ds;
              return (
                <button key={ds} onClick={() => !out && evs.length && setPickDay(on ? null : ds)}
                  disabled={out || !evs.length}
                  aria-label={`${ds}${evs.length ? ` — ${evs.length} event(s)` : ""}`}
                  className={"h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors "
                    + (on ? "bg-blue-600"
                      : out ? "bg-transparent"
                      : evs.length ? "bg-blue-50 active:bg-blue-100"
                      : "bg-gray-50")}>
                  <span className={"text-[13px] tabular-nums leading-none "
                    + (on ? "text-white font-bold"
                      : out ? "text-gray-300 font-normal"
                      : evs.length ? "text-blue-800 font-bold"
                      : isToday ? "text-blue-600 font-bold" : "text-gray-600 font-medium")}>{d}</span>
                  <span className={"w-1.5 h-1.5 rounded-full " + (on ? "bg-white" : evs.length ? "bg-blue-500" : "bg-transparent")} />
                </button>
              );
            })}
          </div>
          {(() => {
            const dayEvs = pickDay ? (pickByDate[pickDay] || []) : [];
            if (!pickDay) return <div className="px-4 pb-5 pt-1 text-center text-xs text-gray-400">Tap a highlighted date to see its events.</div>;
            return (
              <div className="px-3 pb-4 pt-1">
                <div className="flex items-center justify-between gap-2 px-1 pb-3">
                  <span className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">Events on {dayLabel}</span>
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums">{dayEvs.length} event{dayEvs.length === 1 ? "" : "s"}</span>
                </div>
                <div className="space-y-2.5">
                  {dayEvs.map((eo) => (
                    <button key={eo.id} onClick={() => onPick(eo.id)}
                      className="w-full text-left rounded-xl bg-gray-50 ring-1 ring-gray-100 hover:bg-blue-50 hover:ring-blue-100 active:bg-blue-100 px-4 py-3.5 flex items-center gap-3.5 cursor-pointer transition-colors">
                      <span aria-hidden="true" className="shrink-0 w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-100" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900 leading-snug truncate">{eo.clientName || "Event"}</span>
                        <span className="mt-0.5 block text-xs text-gray-500 truncate">
                          {venueOf(eo) || "—"}{eo.functionsDetail?.[0]?.shift ? ` · ${eo.functionsDetail[0].shift}` : ""}
                        </span>
                        {eo.salesperson && <span className="block text-xs text-gray-400 truncate">Booked by {eo.salesperson}</span>}
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-gray-400">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Desktop: every date's own cell, with each event as its own clickable chip. */}
        <div className="hidden sm:grid grid-cols-7">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2.5">{d}</div>
          ))}
        </div>
        <div className="hidden sm:grid grid-cols-7 gap-px bg-gray-100">
          {cells.map((d, i) => {
            if (!d) return <div key={"e" + i} className="min-h-[84px] bg-gray-50/70" />;
            const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
            const evs = pickByDate[ds] || [];
            const isToday = ds === today;
            return (
              <div key={d} className={"min-h-[84px] p-1.5 bg-white " + (isToday ? "bg-blue-50/60" : "")}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={"tabular-nums leading-none " + (isToday ? "bg-blue-600 text-white text-[11px] font-bold rounded-full w-[20px] h-[20px] flex items-center justify-center" : "text-[12px] font-semibold text-gray-600")}>{d}</span>
                </div>
                <div className="space-y-1">
                  {evs.map((eo) => (
                    <button key={eo.id} onClick={() => onPick(eo.id)} title={`Open ${eo.clientName || "Event"}${eo.salesperson ? ` · booked by ${eo.salesperson}` : ""}`}
                      className="w-full text-left text-[11px] font-medium leading-tight pl-2 pr-1.5 py-1 rounded-md truncate border-l-[3px] border-blue-500 bg-blue-50/80 text-blue-900 hover:bg-blue-100 transition-colors">
                      {eo.clientName || "Event"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {monthTotal === 0 && <div className="px-4 py-3 text-center text-[11px] text-gray-400">No events this month — page to another month.</div>}
      </div>
    </div>
  );
}

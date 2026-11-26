import { useEffect, useMemo, useRef, useState } from "react";
import { isLiveEventOrder } from "../../lib/ims/helpers";
import { catToDept as sharedCatToDept } from "../../lib/ims/deptClassify";
import { venueWithParent, venueCalendarColor, VENUE_CALENDAR_LEGEND } from "../../lib/ims/fixedVenues";
import { actualsLockState, reopenActualsPatch, relockActualsPatch } from "../../lib/ims/actualsLock";
import { logWrite } from "../../lib/studio/userActions";
import { Modal } from "../../components/ui";
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";
import SiteCrewPanel from "./SiteCrewPanel.jsx";
import SitePdfButton from "./SitePdfButton.jsx";
import { addedSupervisorsOf, isMyEvent, fixedAtVenue, supervisorIdsOfUser } from "../../lib/ims/mySupervisorEvents";
import { useInhouseVenues } from "./SupervisorVenues.jsx";

const PICK_KEY = "ambria-ims-site-event";
const MY_ONLY_KEY = "ambria-ims-site-my-events";
const SECTIONS = [
  { id: "receiving", label: "🚛 Receiving" },
  { id: "crew", label: "👷 Crew" },
];
// "2026-11-03" → "3 Nov 2026" (the Planning header's way of saying when)
const prettyDate = (d) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return d || ""; const dt = new Date(d + "T00:00:00"); return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
const fnDate = (eo) => {
  const dates = [eo?.date, ...((Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map((f) => f?.date))].filter(Boolean).map((d) => String(d).slice(0, 10));
  return dates.sort()[0] || "";
};

// One page for the whole event, every department together — not the per-department tabs the rest
// of IMS uses. Built for the Site Supervisor role: a narrow login that only needs "what's arriving
// on each truck, right now" and "who's actually on site", not the dept-head planning screens.
export default function SiteSupervisorTab({ eventOrders, setEventOrders, inventory, settings, blocks, trussInv, rateCardCategories, authUser, supervisors = [], rcItems = [] }) {
  const [selId, setSelId] = useState(() => { try { return sessionStorage.getItem(PICK_KEY) || ""; } catch { return ""; } });
  // Was a Planned/Actual toggle — Actual already starts out showing exactly what was planned until
  // someone edits a figure, so a separate read-only "Planned" view never showed anything the Actual
  // one didn't (owner ask 2026-11-24: "since what is planned is already auto filled in the Actual we
  // dont need a planned and a actual different tabs"). Kept as a plain constant, not removed outright,
  // since both SiteReceivingPanel and SiteCrewPanel still branch on it internally.
  const mode = "actual";
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

  if (!sel) return <EventPicker eventOrders={eventOrders} settings={settings} onPick={pick} authUser={authUser} supervisors={supervisors} />;

  return (
    <div className="space-y-4 w-full min-w-0">
      {/* The Planning (Dept Ops) event header's look (owner ask 2026-11-25): a raised card, the name as the title, when and where
          in words ("3 Nov 2026 · Others"), who booked it on a quieter line, and the event's supervisors on their own line. */}
      <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <button onClick={() => pick("")} aria-label="Back to the calendar" title="Back to the calendar"
            className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] text-gray-500 hover:text-gray-900 flex items-center justify-center cursor-pointer transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3.5 L5 7 L9 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] sm:text-[20px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight sm:leading-snug truncate">{sel.clientName || "Event"}</div>
            <div className="mt-0.5 text-[13px] sm:text-sm font-medium text-gray-700 leading-snug truncate">
              {[prettyDate(fnDate(sel)) || "no date", venueWithParent(settings, sel.functionsDetail?.[0]?.venue || sel.venue) || ""].filter(Boolean).join(" · ")}
            </div>
            {sel.salesperson && <div className="text-[11.5px] sm:text-xs text-gray-400 leading-snug truncate">Booked by {sel.salesperson}</div>}
            {addedSupervisorsOf(sel).length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-xs min-w-0">
                <span className="text-gray-500 shrink-0">👷 Site Supervisor</span>
                <span className="font-medium text-gray-700 truncate">{addedSupervisorsOf(sel).map((s) => s.name).join(", ")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <span className="text-[11px] text-gray-400">{lock.locked ? "Locked — this event's actuals are final" : "What's actually arrived & on site — editable"}</span>
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

      {/* Receiving | Crew as the Planning header's view tags: the one you are on soft blue and ringed, the other plain */}
      <div className="flex gap-2">
        {SECTIONS.map((s) => {
          const on = section === s.id;
          return (
            <button key={s.id} onClick={() => setSection(s.id)} aria-pressed={on}
              className={"shrink-0 h-8 inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors "
                + (on ? "bg-blue-100 text-blue-700 ring-1 ring-blue-200 shadow-[0_4px_10px_-4px_rgba(37,99,235,0.45)]"
                  : "bg-white/70 text-gray-500 shadow-[0_1px_3px_rgba(15,23,42,0.1),0_4px_10px_-6px_rgba(15,23,42,0.25)] hover:bg-blue-50 hover:text-blue-700")}>
              {s.label}
            </button>
          );
        })}
      </div>

      {section === "receiving" ? (
        <SiteReceivingPanel sel={sel} eventOrders={eventOrders} setEventOrders={setEventOrders} inventory={inventory} authUser={authUser} mode={mode} settings={settings} trussInv={trussInv} blocks={blocks} rcItems={rcItems} rateCardCategories={rateCardCategories} />
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
function EventPicker({ eventOrders, settings, onPick, authUser, supervisors }) {
  const _now = new Date();
  const today = _now.toLocaleDateString("en-CA"); // local date, not UTC — a function can run past midnight IST
  const [q, setQ] = useState("");
  const [pickMonth, setPickMonth] = useState({ y: _now.getFullYear(), m: _now.getMonth() });
  const [pickDay, setPickDay] = useState(null);
  // "👷 My events" (owner ask 2026-11-25): only the functions at the venues this supervisor is fixed at (Admin → Settings → Supervisors)
  // and the events they were added on (Dept Ops header) - the same rule as Dept Ops' own My events (lib/ims/mySupervisorEvents).
  // Kept for the session (sessionStorage, like the picked event): opening an event and coming back keeps it on.
  const [myOnly, setMyOnlyRaw] = useState(() => { try { return sessionStorage.getItem(MY_ONLY_KEY) === "1"; } catch { return false; } });
  const setMyOnly = (fn) => setMyOnlyRaw((v) => { const nv = typeof fn === "function" ? fn(v) : fn; try { sessionStorage.setItem(MY_ONLY_KEY, nv ? "1" : "0"); } catch { /* private mode */ } return nv; });
  // The Planning calendar's venue colours and legend (owner ask 2026-11-25): each event coloured by THIS date's function's venue
  // (lib/ims/fixedVenues venueCalendarColor), and a legend that filters to one venue when tapped.
  const [venueFilter, setVenueFilter] = useState(null);
  const inhouseVenues = useInhouseVenues(myOnly);
  // who is fixed where comes from the database once My events is on - until it is in, the grid waits (with a note) rather than
  // flash "nothing at your venues"
  const venuesLoading = myOnly && !inhouseVenues.loaded;
  const venuePlaces = useMemo(() => [...inhouseVenues.properties, ...inhouseVenues.inhouse], [inhouseVenues.properties, inhouseVenues.inhouse]);
  const myIds = useMemo(() => supervisorIdsOfUser(authUser, supervisors), [authUser, supervisors]);
  const fnOn = (eo, d) => { const fns = Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []; return fns.find((f) => String(f?.date || "").slice(0, 10) === d) || fns[0] || null; };

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
        if (venueFilter && venueCalendarColor(settings, fnOn(eo, d)?.venue || eo.venue || "").code !== venueFilter) return;
        if (venuesLoading) return;
        if (myOnly && !isMyEvent(eo, authUser, supervisors)
          && !fixedAtVenue(authUser, fnOn(eo, d)?.venue || eo.venue || "", settings, venuePlaces, supervisors, inhouseVenues.inhouse)) return;
        (out[d] = out[d] || []).push(eo);
      });
    });
    return out;
  }, [events, pickMonth, myOnly, venuesLoading, venueFilter, authUser, supervisors, settings, venuePlaces, inhouseVenues.inhouse]);

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
    <div className="space-y-3 w-full min-w-0">
      <input value={q} onChange={(e) => { setQ(e.target.value); setPickDay(null); }} placeholder="🔍 Search by client or venue…"
        className="w-full h-10 rounded-xl border border-gray-200 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Pick an event</div>
            <h3 className="mt-0.5 text-base font-bold text-gray-900 tracking-tight">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
            <div className="text-[11px] text-gray-500 mt-0.5">{monthTotal} event{monthTotal === 1 ? "" : "s"} this month</div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button type="button" onClick={() => { setMyOnly((v) => !v); setPickDay(null); }} aria-pressed={myOnly}
              title={myOnly ? "Showing only the functions at your venues (and events you are the Site Supervisor of) - tap to show every event" : "Show only the functions at the venues you are fixed at (and events you are the Site Supervisor of)"}
              className={"px-3.5 h-9 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 "
                + (myOnly ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-900 text-white hover:bg-gray-700")}>
              <span aria-hidden="true">👷</span>{myOnly ? "My events ✓" : "My events"}
            </button>
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

        <div className="px-4 pb-2 flex items-center gap-x-3 gap-y-1 flex-wrap">
          {VENUE_CALENDAR_LEGEND.map((vc) => {
            const on = venueFilter === vc.code;
            return (
              <button key={vc.code} type="button" onClick={() => { setVenueFilter((f) => (f === vc.code ? null : vc.code)); setPickDay(null); }}
                title={on ? `Showing ${vc.label} only — click to show every venue` : `Show only ${vc.label} events`}
                className={"inline-flex items-center gap-1 text-[10.5px] rounded-full px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors "
                  + (on ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100")}>
                <span aria-hidden="true" className={`w-2 h-2 rounded-full ${vc.dot}`} />
                {vc.code} <span className={on ? "text-gray-300" : "text-gray-400"}>({vc.label})</span>
              </button>
            );
          })}
          {venueFilter && <button type="button" onClick={() => setVenueFilter(null)} className="text-[10.5px] font-semibold text-blue-600 hover:text-blue-800">Clear filter</button>}
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
                  {dayEvs.map((eo) => { const dayFn = fnOn(eo, pickDay); const vc = venueCalendarColor(settings, dayFn?.venue || eo.venue || ""); return (
                    <button key={eo.id} onClick={() => onPick(eo.id)}
                      className="w-full text-left rounded-xl bg-gray-50 ring-1 ring-gray-100 hover:bg-blue-50 hover:ring-blue-100 active:bg-blue-100 px-4 py-3.5 flex items-center gap-3.5 cursor-pointer transition-colors">
                      <span aria-hidden="true" className={`shrink-0 w-2 h-2 rounded-full ring-4 ring-opacity-30 ${vc.dot} ${vc.ring}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[15px] font-semibold text-gray-900 leading-snug truncate">{eo.clientName || "Event"}</span>
                          <span className={`shrink-0 text-[9.5px] font-bold px-1 rounded ${vc.bg} ${vc.text}`}>{vc.code}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 truncate">
                          {venueWithParent(settings, dayFn?.venue || eo.venue || "") || venueOf(eo) || "—"}{dayFn?.shift ? ` · ${dayFn.shift}` : ""}
                        </span>
                        {eo.salesperson && <span className="block text-xs text-gray-400 truncate">Booked by {eo.salesperson}</span>}
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-gray-400">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    </button>
                  ); })}
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
                  {evs.map((eo) => {
                    const dayFn = fnOn(eo, ds);
                    const vc = venueCalendarColor(settings, dayFn?.venue || eo.venue || "");
                    const shift = dayFn?.shift || eo.shift || "";
                    return (
                      <button key={eo.id} onClick={() => onPick(eo.id)} title={`Open ${eo.clientName || "Event"}${shift ? ` · ${shift}` : ""}${eo.salesperson ? ` · booked by ${eo.salesperson}` : ""} — ${vc.label}`}
                        className={`w-full text-left pl-2 pr-1.5 py-1 rounded-md border-l-[3px] ${vc.border} ${vc.bg} ${vc.text} hover:brightness-95 transition-colors`}>
                        <span className="flex items-center gap-1 text-[11px] font-medium leading-tight">
                          <span className="shrink-0 text-[9px] font-bold opacity-70">{vc.code}</span>
                          <span className="min-w-0 truncate">{eo.clientName || "Event"}</span>
                        </span>
                        {shift && <span className="block text-[9.5px] font-normal opacity-70 truncate leading-tight">{shift}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {monthTotal === 0 && (
          <div className="px-4 py-3 text-center text-[11px] text-gray-400">
            {venuesLoading ? "Loading your venues…" : venueFilter && !myOnly ? (
              <>No {VENUE_CALENDAR_LEGEND.find((v) => v.code === venueFilter)?.label || venueFilter} events this month — other venues may still have some.{" "}
                <button onClick={() => setVenueFilter(null)} className="font-semibold text-blue-600 hover:text-blue-800">Clear filter</button>
              </>
            ) : myOnly ? (
              <>
                {myIds.length === 0
                  ? "Your login is not on the Site Supervisor list (Admin → Settings → Supervisors) with this name / phone number - ask the admin to add you."
                  : "No functions at your venues this month, and none you are the Site Supervisor of - page to another month."}{" "}
                <button onClick={() => setMyOnly(false)} className="font-semibold text-blue-600 hover:text-blue-800">Show every event</button>
              </>
            ) : "No events this month — page to another month."}
          </div>
        )}
      </div>
    </div>
  );
}

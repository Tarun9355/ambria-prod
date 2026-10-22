import { useState, useEffect, useMemo, useRef } from "react";
import { latestPlanningInputStamp, planningNeedsSync } from "../../lib/studio/planningSync.js";

// "Sync planning" — shows only while some booked event's Dept Ops snapshot (past events too) is older than an
// IMS setting / inventory change that feeds it. Pressing it loads Studio in an invisible frame
// (#/studio?sweep=1) that runs Deal Check for each such event and writes the fresh snapshot back, so
// nobody has to open the deal; the planning below refreshes on its own through the live subscription.
// With an event open (`onlyOrder`) it is that event alone: the button says so, counts only it, and the
// hidden Studio syncs only that order — the rest wait until opened or until the button is used with none open.
// Syncing many events is mostly waiting (prices settling, writes landing), so the all-events run uses
// SHARDS hidden Studios side by side, each taking its own slice of the events (?shard=i&of=N); every one
// does exactly what a single run did, to a different set of orders.
const SHARDS = 3;
const SWEPT_KEY = "ambria-planning-swept-at-v2"; // v2: the first version also hid the past events a sweep used to skip
const readSwept = () => { try { return Number(localStorage.getItem(SWEPT_KEY)) || 0; } catch { return 0; } };
// Orders the last run found it could not sync (no client / not booked / no saved build), remembered as
// { orderId: deptSyncedAt } so they are not counted again until that order itself changes.
const SKIPPED_KEY = "ambria-planning-skipped-v1";
const readSkipped = () => { try { return JSON.parse(localStorage.getItem(SKIPPED_KEY) || "{}") || {}; } catch { return {}; } };

// force (with onlyOrder): offered even when the event is not stale — used where something the snapshot did not carry
// before (e.g. the Florals tab detail) has to be pulled in by running Deal Check for that one event again.
export default function PlanningSyncButton({ eventOrders, onlyOrder, force = false, label = "" }) {
  const onlyId = onlyOrder?.id || null;
  const [latest, setLatest] = useState(0);
  const [sweptAt, setSweptAt] = useState(readSwept);
  const [run, setRun] = useState(null); // null | { done, total, started }
  const [note, setNote] = useState("");

  // Newest planning input: read on open, every 5 minutes, and when the tab comes back into view.
  useEffect(() => {
    let alive = true;
    const load = () => latestPlanningInputStamp().then(v => { if (alive && v) setLatest(v); }).catch(() => {});
    load();
    const t = setInterval(load, 300000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const [skipped, setSkipped] = useState(readSkipped);
  const eventOrdersRef = useRef(eventOrders); eventOrdersRef.current = eventOrders;
  const needStale = useMemo(() => (eventOrders || []).filter(eo => (!onlyId || eo.id === onlyId) && planningNeedsSync(eo, latest, sweptAt) && skipped[eo.id] !== eo.deptSyncedAt).length, [eventOrders, latest, sweptAt, skipped, onlyId]);
  const need = force && onlyId ? 1 : needStale;

  // The event the running sync was started for: opening another event meanwhile must not change it.
  const runOnlyRef = useRef(null);
  const runShardsRef = useRef(1);
  const statsRef = useRef({}); // shard → { done, total, fin, skipped, error }
  const finish = (text, stamp = true) => {
    // a one-event run must not mark the other events as swept
    if (stamp && !runOnlyRef.current) { const now = Date.now(); try { localStorage.setItem(SWEPT_KEY, String(now)); } catch { /* private mode */ } setSweptAt(now); }
    setRun(null);
    setNote(text);
    setTimeout(() => setNote(""), stamp ? 6000 : 25000); // a failure stays long enough to read
  };

  // What the hidden Studio reports: ready (how many it will do) → progress → done.
  const heardRef = useRef(new Set());
  const waitingRef = useRef("");
  useEffect(() => {
    if (!run) return undefined;
    heardRef.current = new Set(); waitingRef.current = ""; statsRef.current = {};
    const sumStats = () => Object.values(statsRef.current).reduce((a, s) => ({ done: a.done + (s.done || 0), total: a.total + (s.total || 0) }), { done: 0, total: 0 });
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-planning-sweep") return;
      console.info("[planning-sync]", d);
      if (d.phase === "wait") { waitingRef.current = d.reason || ""; return; } // alive, not started yet
      const sh = Number(d.shard) || 0;
      heardRef.current.add(sh);
      if (d.phase === "ready" || d.phase === "progress") {
        statsRef.current[sh] = { ...statsRef.current[sh], done: d.phase === "ready" ? 0 : d.done, total: d.total };
        setRun(r => (r ? { ...r, ...sumStats(), started: true } : r));
      } else if (d.phase === "done") {
        statsRef.current[sh] = { done: d.done, total: d.total, fin: true, skipped: d.skipped, error: !!d.error };
        const all = Object.values(statsRef.current);
        if (all.length < runShardsRef.current || !all.every(s => s.fin)) { setRun(r => (r ? { ...r, ...sumStats(), started: true } : r)); return; } // other slices still running
        const { done } = sumStats();
        const skippedIds = all.some(s => Array.isArray(s.skipped)) ? all.flatMap(s => s.skipped || []) : null;
        if (skippedIds) {
          // a one-event run only knows about that event: keep what earlier runs remembered for the others
          const next = runOnlyRef.current ? { ...readSkipped() } : {};
          if (runOnlyRef.current) delete next[runOnlyRef.current];
          skippedIds.forEach(id => { const eo = (eventOrdersRef.current || []).find(e => e.id === id); if (eo) next[id] = eo.deptSyncedAt; });
          try { localStorage.setItem(SKIPPED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
          setSkipped(next);
        }
        finish(all.some(s => s.error) ? "Sync stopped early — try again" : done > 0 ? `Planning synced for ${done} event${done === 1 ? "" : "s"}` : runOnlyRef.current && skippedIds?.includes(runOnlyRef.current) ? "This event has nothing to sync from Studio" : "Planning is already up to date");
      }
    };
    window.addEventListener("message", onMsg);
    // Never hangs: no word at all in a minute (not signed in to Studio here, say) or a run past a
    // quarter of an hour ends the attempt.
    const quiet = setTimeout(() => { if (heardRef.current.size < runShardsRef.current) finish(waitingRef.current ? `Could not start — the hidden Studio is waiting: ${waitingRef.current}` : "Could not start — the hidden Studio never answered (open Studio once in this browser, then try again)", false); }, 60000);
    const cap = setTimeout(() => finish("Sync took too long — stopped", false), 900000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(quiet); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!run]);

  const frameUrl = (shard) => `${window.location.origin}${window.location.pathname}#/studio?sweep=1${runOnlyRef.current ? `&order=${encodeURIComponent(runOnlyRef.current)}${force ? "&force=1" : ""}` : `&shard=${shard}&of=${runShardsRef.current}`}`;
  if (!run && !need && !note) return null;
  return (
    <>
      {run && Array.from({ length: runShardsRef.current }, (_, i) => (
        <iframe key={i} title={`planning-sync-${i}`} src={frameUrl(i)} aria-hidden="true" tabIndex={-1} className="fixed top-0 -left-[20000px] w-[1400px] h-[900px] opacity-0 pointer-events-none" />
      ))}
      {run ? (
        <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border border-blue-200 bg-blue-50 text-blue-700">
          <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
          {runOnlyRef.current ? "Syncing this event…" : run.started && run.total ? `Syncing ${Math.min(run.done + 1, run.total)} of ${run.total}…` : "Syncing planning…"}
        </span>
      ) : need > 0 ? (
        <button onClick={() => { setNote(""); runOnlyRef.current = onlyId; runShardsRef.current = onlyId ? 1 : SHARDS; setRun({ done: 0, total: 0, started: false }); }}
          title={onlyId ? "IMS settings or inventory changed after this event was last synced from Deal Check. Runs Deal Check for this event only, in the background — you can keep working." : "IMS settings or inventory changed after these events were last synced from Deal Check. Runs Deal Check for each in the background — you can keep working."}
          className={(force ? "inline-flex" : "hidden sm:inline-flex") + " shrink-0 items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"}>
          {label ? label : onlyId ? "🔄 Sync this event" : `🔄 Sync planning · ${need} event${need === 1 ? "" : "s"}`}
        </button>
      ) : (
        <span className="hidden sm:inline-flex shrink-0 items-center ml-1 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-emerald-700">{note}</span>
      )}
    </>
  );
}

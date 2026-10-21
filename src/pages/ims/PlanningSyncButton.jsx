import { useState, useEffect, useMemo, useRef } from "react";
import { latestPlanningInputStamp, planningNeedsSync } from "../../lib/studio/planningSync.js";

// "Sync planning" — shows only while some booked, upcoming event's Dept Ops snapshot is older than an
// IMS setting / inventory change that feeds it. Pressing it loads Studio in an invisible frame
// (#/studio?sweep=1) that runs Deal Check for each such event and writes the fresh snapshot back, so
// nobody has to open the deal; the planning below refreshes on its own through the live subscription.
const SWEPT_KEY = "ambria-planning-swept-at";
const readSwept = () => { try { return Number(localStorage.getItem(SWEPT_KEY)) || 0; } catch { return 0; } };

export default function PlanningSyncButton({ eventOrders }) {
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

  const need = useMemo(() => (eventOrders || []).filter(eo => planningNeedsSync(eo, latest, sweptAt)).length, [eventOrders, latest, sweptAt]);

  const finish = (text, stamp = true) => {
    if (stamp) { const now = Date.now(); try { localStorage.setItem(SWEPT_KEY, String(now)); } catch { /* private mode */ } setSweptAt(now); }
    setRun(null);
    setNote(text);
    setTimeout(() => setNote(""), 6000);
  };

  // What the hidden Studio reports: ready (how many it will do) → progress → done.
  const heardRef = useRef(false);
  useEffect(() => {
    if (!run) return undefined;
    heardRef.current = false;
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-planning-sweep") return;
      heardRef.current = true;
      if (d.phase === "ready") setRun(r => (r ? { ...r, total: d.total, started: true } : r));
      else if (d.phase === "progress") setRun(r => (r ? { ...r, done: d.done, total: d.total, started: true } : r));
      else if (d.phase === "done") finish(d.error ? "Sync stopped early — try again" : d.done > 0 ? `Planning synced for ${d.done} event${d.done === 1 ? "" : "s"}` : "Planning is already up to date");
    };
    window.addEventListener("message", onMsg);
    // Never hangs: no word at all in a minute (not signed in to Studio here, say) or a run past a
    // quarter of an hour ends the attempt.
    const quiet = setTimeout(() => { if (!heardRef.current) finish("Could not start — open Studio once in this browser, then try again", false); }, 60000);
    const cap = setTimeout(() => finish("Sync took too long — stopped", false), 900000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(quiet); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!run]);

  const frameUrl = `${window.location.origin}${window.location.pathname}#/studio?sweep=1`;
  if (!run && !need && !note) return null;
  return (
    <>
      {run && <iframe title="planning-sync" src={frameUrl} aria-hidden="true" tabIndex={-1} className="fixed top-0 -left-[20000px] w-[1400px] h-[900px] opacity-0 pointer-events-none" />}
      {run ? (
        <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border border-blue-200 bg-blue-50 text-blue-700">
          <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
          {run.started && run.total ? `Syncing ${Math.min(run.done + 1, run.total)} of ${run.total}…` : "Syncing planning…"}
        </span>
      ) : need > 0 ? (
        <button onClick={() => { setNote(""); setRun({ done: 0, total: 0, started: false }); }}
          title="IMS settings or inventory changed after these events were last synced from Deal Check. Runs Deal Check for each in the background — you can keep working."
          className="hidden sm:inline-flex shrink-0 items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors">
          🔄 Sync planning · {need} event{need === 1 ? "" : "s"}
        </button>
      ) : (
        <span className="hidden sm:inline-flex shrink-0 items-center ml-1 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-emerald-700">{note}</span>
      )}
    </>
  );
}

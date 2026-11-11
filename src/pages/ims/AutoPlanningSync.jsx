import { useState, useEffect, useRef } from "react";
import { onPlanningInputChange } from "../../lib/planningInputBus";
import { affectedOrderIds } from "../../lib/ims/affectedOrders";
import { supabase } from "../../lib/supabase";
import { latestPlanningInputStamp, planningNeedsSync } from "../../lib/studio/planningSync.js";

// ── THE WHOLE "SYNC PLANNING" SWEEP, BY ITSELF (owner ask 2026-11-11) ──
// Every few minutes one open IMS screen - the first to take the lock - runs the same sweep "Sync planning · N events" runs (3
// hidden Studios side by side, #/studio?sweep=1&shard=i&of=3), so stale deals catch up without anyone pressing it. The button
// stays for doing it at once. The lock is a settings row ({ by, at }): a screen runs only when nobody took it in the last
// LOCK_MS, and checks after writing that the lock is still its own - forty open screens make one sweep, not forty. A visible tab
// only (a background tab's frames are slowed to a crawl). Can't write the lock (no access): it simply never auto-runs.
const SWEEP_LOCK_KEY = "planningSweepLock";
const LOCK_MS = 20 * 60 * 1000;
const SWEEP_CHECK_MS = 5 * 60 * 1000;
const SWEEP_SHARDS = 3;
const SWEEP_CAP_MS = 15 * 60 * 1000;
const myTab = `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
// The button's own memory (PlanningSyncButton): when a sweep last finished, and the deals it found it cannot sync (no saved build,
// not booked) - read and written the same way, so neither counts those deals again until they change.
const SWEPT_KEY = "ambria-planning-swept-at-v2";
const SKIPPED_KEY = "ambria-planning-skipped-v1";
const readSwept = () => { try { return Number(localStorage.getItem(SWEPT_KEY)) || 0; } catch { return 0; } };
const readSkipped = () => { try { return JSON.parse(localStorage.getItem(SKIPPED_KEY) || "{}") || {}; } catch { return {}; } };
const parseLock = (v) => { let x = v; for (let i = 0; i < 2; i++) { if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } } } return x && typeof x === "object" ? x : null; };
async function takeSweepLock() {
  const read = async () => { const { data, error } = await supabase.from("settings").select("value").eq("key", SWEEP_LOCK_KEY).maybeSingle(); if (error) throw error; return parseLock(data?.value); };
  const cur = await read();
  if (cur && cur.by !== myTab && Date.now() - Number(cur.at || 0) < LOCK_MS) return false;
  const { error } = await supabase.from("settings").upsert({ key: SWEEP_LOCK_KEY, value: JSON.stringify({ by: myTab, at: Date.now() }) }, { onConflict: "key" });
  if (error) return false;
  await new Promise((r) => setTimeout(r, 1500)); // another screen writing at the same moment: whoever's write landed last holds it
  const after = await read();
  return after?.by === myTab;
}

// ── PLANNING FOLLOWS EVERY CHANGE BY ITSELF (owner ask 2026-11-11) ──
// An inventory item, flower recipe, mandi flower or fixed venue saved in this tab (lib/planningInputBus) re-syncs, in the
// background, every booked deal that uses it - the same hidden Deal Check run as "Sync this event" (#/studio?sweep=1&order=…
// &force=1), one deal at a time, no button to press. A sold deal's agreed price is not touched by a sync (it only refreshes
// what Planning shows; the deal value stays until someone Applies a build change in Studio).
// Only this tab (where the edit was made) runs it - other open IMS screens get the rows by realtime and run nothing.
// A change touching more than MAX_AUTO deals (a bulk edit) is left to the "Sync planning" button, which already lists them.
const MAX_AUTO = 25;
const PER_DEAL_TIMEOUT = 120000;
const DEBOUNCE = 2500;

export default function AutoPlanningSync({ eventOrders, flowerPatterns }) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null); // { id, tag }
  const [note, setNote] = useState("");
  const pendingRef = useRef([]);
  const timerRef = useRef(null);
  const ordersRef = useRef(eventOrders); ordersRef.current = eventOrders;
  const patternsRef = useRef(flowerPatterns); patternsRef.current = flowerPatterns;
  const currentRef = useRef(null); currentRef.current = current;

  // Changes arriving together (one save writes several rows) settle into one look-up.
  useEffect(() => onPlanningInputChange((change) => {
    pendingRef.current.push(change);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const changes = pendingRef.current; pendingRef.current = [];
      let fixedVenues = [];
      const fvIds = changes.filter((c) => c.table === "fixed_venues").flatMap((c) => c.ids);
      if (fvIds.length) { try { const { data } = await supabase.from("fixed_venues").select("id,name").in("id", fvIds); fixedVenues = data || []; } catch { /* venue names unknown: those deals wait for the button */ } }
      const ids = affectedOrderIds({ changes, eventOrders: ordersRef.current, flowerPatterns: patternsRef.current, fixedVenues });
      if (!ids.length) return;
      if (ids.length > MAX_AUTO) { setNote(`${ids.length} events use this - press "Sync planning" to update them`); setTimeout(() => setNote(""), 12000); return; }
      setQueue((q) => [...q, ...ids.filter((id) => !q.includes(id) && currentRef.current?.id !== id)]);
    }, DEBOUNCE);
  }), []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // One deal at a time.
  useEffect(() => {
    if (current || !queue.length) return;
    const [id, ...rest] = queue;
    setQueue(rest);
    setCurrent({ id, tag: `auto-${id}-${Date.now()}` });
  }, [current, queue]);

  // The hidden Studio says "done" (or goes quiet past the timeout): next deal.
  useEffect(() => {
    if (!current) return undefined;
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-planning-sweep" || d.tag !== current.tag) return;
      if (d.phase === "done") setCurrent(null);
    };
    window.addEventListener("message", onMsg);
    const t = setTimeout(() => setCurrent(null), PER_DEAL_TIMEOUT);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(t); };
  }, [current]);

  // ── The whole sweep, every few minutes, by one screen ──
  const [sweep, setSweep] = useState(null); // { tag, done: {shard: bool}, count } while running
  const sweepRef = useRef(null); sweepRef.current = sweep;
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!alive || sweepRef.current || document.visibilityState !== "visible") return;
      try {
        const latest = await latestPlanningInputStamp();
        const sweptAt = readSwept(), skipped = readSkipped();
        const stale = (ordersRef.current || []).filter((eo) => planningNeedsSync(eo, latest, sweptAt) && skipped[eo.id] !== eo.deptSyncedAt).length;
        if (!stale || !alive || sweepRef.current) return;
        if (!(await takeSweepLock())) return;
        if (alive) setSweep({ tag: `autosweep-${Date.now()}`, done: {}, count: stale });
      } catch { /* the button still works */ }
    };
    const first = setTimeout(check, 20000); // let the page settle first
    const t = setInterval(check, SWEEP_CHECK_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!sweep) return undefined;
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-planning-sweep" || d.tag !== sweep.tag || d.phase !== "done") return;
      setSweep((s) => {
        if (!s || s.tag !== sweep.tag) return s;
        const done = { ...s.done, [Number(d.shard) || 0]: true };
        const skippedIds = [...(s.skippedIds || []), ...(Array.isArray(d.skipped) ? d.skipped : [])];
        if (Object.keys(done).length < SWEEP_SHARDS) return { ...s, done, skippedIds };
        // all slices finished: remember it as the button does (PlanningSyncButton.finish)
        try {
          localStorage.setItem(SWEPT_KEY, String(Date.now()));
          const next = {};
          skippedIds.forEach((id) => { const eo = (ordersRef.current || []).find((x) => x.id === id); if (eo) next[id] = eo.deptSyncedAt; });
          localStorage.setItem(SKIPPED_KEY, JSON.stringify(next));
        } catch { /* private mode */ }
        return null;
      });
    };
    window.addEventListener("message", onMsg);
    const cap = setTimeout(() => setSweep(null), SWEEP_CAP_MS);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep?.tag]);

  if (!current && !note && !sweep) return null;
  const left = queue.length + (current ? 1 : 0);
  return (
    <>
      {sweep && Array.from({ length: SWEEP_SHARDS }, (_, i) => (
        <iframe key={`${sweep.tag}-${i}`} title={`planning-auto-sweep-${i}`} aria-hidden="true" tabIndex={-1}
          src={`${window.location.origin}${window.location.pathname}#/studio?sweep=1&shard=${i}&of=${SWEEP_SHARDS}&tag=${encodeURIComponent(sweep.tag)}`}
          className="fixed top-0 -left-[20000px] w-[1400px] h-[900px] opacity-0 pointer-events-none" />
      ))}
      {current && (
        <iframe key={current.tag} title="planning-auto-sync" aria-hidden="true" tabIndex={-1}
          src={`${window.location.origin}${window.location.pathname}#/studio?sweep=1&order=${encodeURIComponent(current.id)}&force=1&tag=${encodeURIComponent(current.tag)}`}
          className="fixed top-0 -left-[20000px] w-[1400px] h-[900px] opacity-0 pointer-events-none" />
      )}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-blue-200 bg-white/95 px-3 py-2 text-xs font-semibold text-blue-700 shadow-md">
        {(current || sweep) && <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />}
        {current ? `Updating planning · ${left} event${left === 1 ? "" : "s"}` : sweep ? `Updating planning · ${sweep.count} event${sweep.count === 1 ? "" : "s"} in the background` : note}
      </div>
    </>
  );
}

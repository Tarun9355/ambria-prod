import { useState, useEffect, useRef } from "react";
import { onPlanningInputChange } from "../../lib/planningInputBus";
import { affectedOrderIds } from "../../lib/ims/affectedOrders";
import { supabase } from "../../lib/supabase";

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

  if (!current && !note) return null;
  const left = queue.length + (current ? 1 : 0);
  return (
    <>
      {current && (
        <iframe key={current.tag} title="planning-auto-sync" aria-hidden="true" tabIndex={-1}
          src={`${window.location.origin}${window.location.pathname}#/studio?sweep=1&order=${encodeURIComponent(current.id)}&force=1&tag=${encodeURIComponent(current.tag)}`}
          className="fixed top-0 -left-[20000px] w-[1400px] h-[900px] opacity-0 pointer-events-none" />
      )}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-blue-200 bg-white/95 px-3 py-2 text-xs font-semibold text-blue-700 shadow-md">
        {current && <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />}
        {current ? `Updating planning · ${left} event${left === 1 ? "" : "s"}` : note}
      </div>
    </>
  );
}

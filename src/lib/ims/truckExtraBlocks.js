// Items added on a truck that are not in the deal (IMS Dept Ops → Loading & dispatch → "Add an item not in this deal") are
// reserved in the stock ledger like any other hold (owner ask 2026-11-25), under their own source tag so Studio's reconcile
// leaves them alone (lib/studio/soldBlocksPlan classifyEntry: an unknown tag is "protected").
import { isLiveBlockStatus, blockEntryQty } from "./liveBlocks";

export const TRUCK_EXTRA_SRC = "ims-truck-extra";

// Every department's added items, per inventory id, summed over every truck and trip: Map<invId, qty>.
export function truckExtraQtyByItem(trucks, tripsOf) {
  const m = new Map();
  (trucks || []).forEach((t) => (tripsOf ? tripsOf(t) : t?.trips || []).forEach((tr) => Object.values(tr?.custom || {}).forEach((rows) => (Array.isArray(rows) ? rows : []).forEach((c) => {
    const q = Number(c?.qty) || 0;
    if (q <= 0 || !c?.invId) return;
    m.set(String(c.invId), (m.get(String(c.invId)) || 0) + q);
  }))));
  return m;
}

// The apply_block_ops ops that make the ledger match `want` (Map<invId, qty>) on each of `dates` for this event: an item whose
// TRUCK_EXTRA_SRC holds already equal the qty on every date (and on no other date) gets no op; otherwise its holds are replaced
// (remove that tag on every date, add the qty on each date) - or just removed when nothing of it is on a truck any more.
export function truckExtraBlockOps(blocks, eventId, dates, want) {
  if (!eventId || !Array.isArray(dates) || !dates.length) return [];
  const held = new Map();
  Object.entries(blocks || {}).forEach(([itemId, arr]) => (Array.isArray(arr) ? arr : []).forEach((b) => {
    if (b?.eventId !== eventId || b.source !== TRUCK_EXTRA_SRC || !isLiveBlockStatus(b)) return;
    const h = held.get(String(itemId)) || {};
    h[b.date] = (h[b.date] || 0) + blockEntryQty(b);
    held.set(String(itemId), h);
  }));
  const w = want instanceof Map ? want : new Map();
  const ids = [...new Set([...held.keys(), ...w.keys()])].sort();
  return ids.flatMap((id) => {
    const q = Number(w.get(id)) || 0, h = held.get(id) || {};
    const same = dates.every((dt) => (h[dt] || 0) === q) && Object.keys(h).every((dt) => dates.includes(dt));
    if (same) return [];
    return [{ item_id: id, event_id: eventId, remove: [{ source: TRUCK_EXTRA_SRC, date: null }], add: q > 0 ? dates.map((dt) => ({ date: dt, qty: q, status: "confirmed", source: TRUCK_EXTRA_SRC })) : [] }];
  });
}

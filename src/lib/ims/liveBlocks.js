// A `blocks` entry ({date, eventId, qty, ...}) should never count as held stock once the event_order
// it belongs to is cancelled — see the "Test 2" incident (2026-11-14): an event cancelled via a path
// that skipped (or raced with) CalendarTab.jsx's releaseBlocks left ~95 stale reservations sitting in
// `blocks` across many items/dates, read directly by Studio's availability picker as real competing
// demand, with no way left in the UI to re-trigger a release once status was already "cancelled".
//
// This is a READ-TIME backstop, not a replacement for releasing on cancel (CalendarTab.jsx) or for
// migration 065's trigger — it exists so that however an orphan gets created (a bypassed cancel flow,
// a race between two writers of the same item's `blocks` row, a direct DB edit, an LMS sync), it is
// harmless to every availability reader in the app, not just invisible in one screen's display label.
//
// Only "cancelled" is filtered — NOT lib/ims/helpers.js's DEAD_EVENT_STATUS (pending/cancelled/review).
// A pending or in-review order can still be a SOLD deal whose reconcile has already written a real
// hold (Studio's own confirm gate runs well before an order's own status catches up), so those must
// keep counting as real demand. Only "cancelled" ever means "this stock was never actually needed."
//
// NEVER pass a filtered result to a WRITER (setBlocks/saveBlocks/addBlock/releaseBlocks/
// planStudioBlocks/persistBlocks) — a writer that upserts a filtered copy back would silently strip
// the very entries this module exists to make harmless, for every OTHER (non-cancelled) reader too.
// This module is read-only, every time.
//
// KNOWN PRE-EXISTING GAP (regression review, 2026-11-14): a `blocks` entry's eventId is not always
// an event_orders id — InventoryTab.jsx's blockItem/submitBulk fall back to a `functions` row's own
// id when it has no eventOrderId link, and ApprovalsTab.jsx's applyBlocks falls back to a clientId or
// amend_requests id (same fallback scheme migration 057's own comment documents). This module only
// ever matches against event_orders, so an entry saved under one of those fallback ids is invisible
// to it either way — it was never covered by CalendarTab's own releaseBlocks(blocks, eoId) before
// this module existed, and isn't covered by migration 065's trigger now. Not fixed here: narrowing
// this is a separate change to those fallback-id writers themselves, not a read-time filter concern.

export const isCancelledEO = (eo) => eo?.status === "cancelled";

// eventOrders (array) -> Set of ids whose status is "cancelled".
export function cancelledEventIds(eventOrders) {
  const out = new Set();
  (eventOrders || []).forEach((eo) => { if (eo && isCancelledEO(eo)) out.add(eo.id); });
  return out;
}

// Every function below accepts either a Set already built by cancelledEventIds, or the raw
// eventOrders array itself (built fresh, once per call) — callers that already have the Set
// (e.g. memoized once per eventOrders identity) avoid rebuilding it on every item.
const toSet = (eventOrdersOrSet) => (eventOrdersOrSet instanceof Set ? eventOrdersOrSet : cancelledEventIds(eventOrdersOrSet));

// false for a null/undefined entry, or one whose eventId belongs to a cancelled event_orders row.
// An eventId matching nothing at all (a functions-table id, a client_ledger id, an amend_requests
// id — see migration 057's own fallback-id reasoning) is always kept: "unknown" is not "cancelled".
export function isLiveBlockEntry(b, eventOrdersOrSet) {
  if (!b) return false;
  const cancelled = toSet(eventOrdersOrSet);
  return !cancelled.has(b.eventId);
}

// { itemId: entries[] } -> the same shape with every cancelled-event entry removed. Returns the
// SAME object when nothing changed (no cancelled ids present among the entries), so a memoized
// caller/React re-render check sees no change either.
export function filterLiveBlocks(blocks, eventOrdersOrSet) {
  const cancelled = toSet(eventOrdersOrSet);
  if (!cancelled.size) return blocks || {};
  let changed = false;
  const out = {};
  for (const [itemId, arr] of Object.entries(blocks || {})) {
    const list = Array.isArray(arr) ? arr : [];
    const kept = list.filter((b) => !cancelled.has(b?.eventId));
    if (kept.length !== list.length) changed = true;
    out[itemId] = kept;
  }
  return changed ? out : (blocks || {});
}

// Studio's per-date availability shape, as fetchIMSData/loadAvailability resolves it:
// { inventory, blocksForDate: {itemId: totalQty}, blocksDetailForDate: {itemId: [{eventId, qty}]}, ... }
// Strips cancelled-event entries out of blocksDetailForDate and recomputes blocksForDate's totals
// from what's left (never merely subtracts — a total built from a stale sum would double-count any
// OTHER change made to the detail list the same pass). An item whose detail list empties entirely, or
// whose recomputed total is 0, loses its key — matching fetchIMSData's own convention of only ever
// carrying positive, non-empty entries. Tolerates a missing blocksDetailForDate (loadAvailability's
// early-return shape has none) and returns the SAME object when nothing changed.
// Bug 14 (2026-11-14 audit): Studio and IMS used to each maintain their OWN definition of "is this
// blocks entry live" — Studio counted only confirmed/final/held statuses, IMS's getAvailableQty
// counted everything NOT "released". An entry with an unrecognized or missing status was invisible
// to Studio but counted by IMS, so the two could disagree about the same reservation. One shared
// predicate, used by both from here on. Fails CLOSED (an unknown/missing status is treated as live),
// matching IMS's prior definition — a status this app doesn't recognize is far more likely to be an
// in-flight/legacy value than a signal that the stock was actually freed.
// Keep RELEASED_BLOCK_STATUSES in sync with block_entry_is_live() in migration 066 if/when it ships.
export const RELEASED_BLOCK_STATUSES = Object.freeze(["released", "cancelled"]);
export function isLiveBlockStatus(b) { return !!b && !RELEASED_BLOCK_STATUSES.includes(String(b.status ?? "")); }

// A blocks entry's qty, coerced the same way everywhere — a missing/non-numeric/non-positive qty
// counts as 0 rather than silently defaulting to 1 the way some older write-side code does (that
// default belongs at WRITE time, if anywhere; at READ time a qty-less entry holding nothing is the
// safer assumption). qtyToProduce is deliberately never counted here — units still to be produced
// are not units already held (see blockEntryQtyToProduce/heldForEventOnDate, below, for surfacing it).
export function blockEntryQty(b) { const n = Number(b?.qty); return Number.isFinite(n) && n > 0 ? n : 0; }

// A blocks entry's qtyToProduce, coerced the same way blockEntryQty is. Units flagged here were
// explicitly allowed past the real stock ceiling (apply_block_ops, migration 066's own allowOver
// handling) — not already-held stock, so a caller must never fold this into a "how much do we
// physically have" total; only ever show it alongside, as "N more still need producing."
export function blockEntryQtyToProduce(b) { const n = Number(b?.qtyToProduce); return Number.isFinite(n) && n > 0 ? n : 0; }

// Bug 10 (2026-11-14 audit) — qtyToProduce had no reader anywhere in the app. The one place ops
// needs to see it is right next to a function's own blocked qty (InventoryTab.jsx's "Blocked for
// Functions" list) — found by matching an entry's (eventId, date) against the function row already
// being shown, not by threading it through `functions.items` itself (a point-in-time snapshot taken
// once at auto-confirm time, never corrected again as a LATER writer — Studio's own reconcile
// relabelling/capping the hold, a re-block — changes the real `blocks` entries). Reading straight
// from live `blocks` here means the qty shown always reflects whatever is ACTUALLY reserved right
// now, regardless of which writer most recently touched it, same reasoning as heldOnDate above.
// `found` distinguishes "there is a live blocks record for this exact (eventId, date), trust its qty
// even if that's genuinely 0 (fully released)" from "no blocks entry at all matches this function —
// fall back to the function row's own static qty, the only information there is."
export function heldForEventOnDate(entries, eventId, date) {
  let qty = 0, qtyToProduce = 0, found = false;
  (entries || []).forEach((b) => {
    if (!b || b.eventId !== eventId || b.date !== date) return;
    found = true;
    if (!isLiveBlockStatus(b)) return;
    qty += blockEntryQty(b);
    qtyToProduce += blockEntryQtyToProduce(b);
  });
  return { qty, qtyToProduce, found };
}

// Sum of live-status, non-cancelled-event entries for one item's array, on one date. cancelledSet
// (optional — a Set, or the raw eventOrders array to build one from) applies the same cancelled-
// event exclusion isLiveBlockEntry/filterLiveBlocks already apply elsewhere in this file; omit it
// when the caller has already filtered cancelled events out upstream (e.g. via liveDateBlocks).
export function heldOnDate(entries, date, cancelledSet) {
  const cancelled = cancelledSet ? toSet(cancelledSet) : null;
  return (entries || []).reduce((sum, b) => {
    if (!b || b.date !== date || !isLiveBlockStatus(b)) return sum;
    if (cancelled && cancelled.has(b.eventId)) return sum;
    return sum + blockEntryQty(b);
  }, 0);
}

export function liveDateBlocks(res, eventOrdersOrSet) {
  if (!res || !res.blocksDetailForDate) return res;
  const cancelled = toSet(eventOrdersOrSet);
  if (!cancelled.size) return res;
  let changed = false;
  const nextDetail = {};
  const nextTotals = {};
  for (const [itemId, arr] of Object.entries(res.blocksDetailForDate || {})) {
    const list = Array.isArray(arr) ? arr : [];
    const kept = list.filter((b) => !cancelled.has(b?.eventId));
    if (kept.length !== list.length) changed = true;
    if (!kept.length) continue;
    nextDetail[itemId] = kept;
    const total = kept.reduce((s, b) => s + (Number(b?.qty) || 0), 0);
    if (total > 0) nextTotals[itemId] = total;
  }
  if (!changed) return res;
  return { ...res, blocksForDate: nextTotals, blocksDetailForDate: nextDetail };
}

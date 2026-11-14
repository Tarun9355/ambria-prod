// Live "soft-blocking" helpers — how much of an inventory item has already been
// committed to OTHER zones/functions/cards within the SAME event/deal, so search
// boxes can warn/disable before a salesperson oversells stock that's already fully
// used a few tabs over. Complements getStudioAvailable() (pricing.js), which only
// nets against OTHER events' blocks-table commitments — it has no idea about
// sibling zones in the current deal. Combine both: remaining = max(0, otherEventsAvailable - usedElsewhereInDeal).
//
// Pure, synchronous, no Supabase calls — operates only on already-in-memory arrays.

import { walkKitUnits } from "../ims/helpers";
import { cardIsFoc } from "./foc.js";

// A zone that is switched off in Build keeps its element list but is not part of the deal — it is not priced,
// not on the PDFs, so it must not hold stock either. (enabledEls missing/empty = nothing recorded yet: every
// zone counts, as before.)
const zoneIsOff = (fn, zk) => {
  const en = fn?.enabledEls;
  return !!en && typeof en === "object" && Object.keys(en).length > 0 && !en[zk];
};

// Build: sum qty already assigned to invId across all zones of all functions, scoped
// to targetDate (an item committed on a different calendar day doesn't starve this one —
// mirrors buildPlatformPlan's per-fnDate bucketing in this same lib).
// fns = collectAllFunctionData() output.
// exclude = { fnIdx, zoneKey, elIdx? } — omit elIdx to exclude the WHOLE zone (top-level
// "+Add element" boxes, since a zone's own rows are never "elsewhere"); supply elIdx to
// exclude only that one row (kit-component search — sibling rows in the same zone still count).
// targetVenue (optional) further scopes to functions at the SAME venue — two functions sharing a
// date but at genuinely different venues (Haldi at Roseate House Aerocity, Sangeet at a different
// venue entirely, same day) cannot physically share the same installed pieces, so without this they
// wrongly competed for one pool anyway, same as two unrelated clients' deals would. Confirmed live,
// 2026-11-02 (Sangeeta): a second same-day function at a different venue showed Ratten Chair almost
// entirely out of stock even though nothing else in the whole system was holding it. Omitted (the
// default) keeps every existing caller's exact old behavior — date-only scoping, as before.
export function qtyUsedElsewhereInBuild(invId, fns, imsInventory, exclude = {}, targetDate, targetVenue) {
  if (!invId) return 0;
  let used = 0;
  (fns || []).forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    if (targetVenue && (fn?.fnVenue || "") !== targetVenue) return;
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (zoneIsOff(fn, zk)) return;
      (elems || []).forEach((el, elIdx) => {
        const isExcluded = fnIdx === exclude.fnIdx && zk === exclude.zoneKey &&
          (exclude.elIdx == null || elIdx === exclude.elIdx);
        if (isExcluded) return;
        if (!el?.invId) return; // pattern-only / recipe rows never consume real stock
        if (el.foc) return; // left at the venue from a previous event — never competes for stock
        const elQty = Number(el.qty) || 0;
        if (elQty <= 0) return;
        // walkKitUnits (lib/ims/helpers.js) — same node-walker pricing/transport/reservation share —
        // visits el.invId itself (a plain item just matches directly, one visit) AND every
        // component recursively, so a component nested TWO levels down (a kit-inside-a-kit) is no
        // longer invisible to this check the way a one-level-only "el.kitOverrides || item.subItems"
        // scan used to leave it.
        const topItem = (imsInventory || []).find((i) => i.id === el.invId);
        if (!topItem) { if (el.invId === invId) used += elQty; return; }
        walkKitUnits(topItem, elQty, imsInventory, el.kitOverrides, (node, nodeQty) => { if (node?.id === invId) used += nodeQty; });
      });
    });
  });
  return used;
}

// Every row of the booking (on targetDate, and targetVenue when given — see qtyUsedElsewhereInBuild's
// own comment) that draws on each inventory id — its own qty, or via a kit's component — as one
// index: invId → [{ fnIdx, zk, elIdx, qty }], rows in booking order. Build asks this for every
// element card on every render, and walking the whole booking (with an inventory search per element)
// each time was the main cost of a keystroke; the index is built once per (function list, inventory,
// date, venue) and reused while those are the same objects.
const rowIndexCache = new WeakMap(); // fns → Map<imsInventory, Map<date, Map<venue, Map<invId, rows>>>>
function bookingRowIndex(fns, imsInventory, targetDate, targetVenue) {
  const key = fns || [];
  let byInv = rowIndexCache.get(key);
  if (!byInv) { byInv = new Map(); rowIndexCache.set(key, byInv); }
  let byDate = byInv.get(imsInventory);
  if (!byDate) { byDate = new Map(); byInv.set(imsInventory, byDate); }
  const dk = targetDate || "";
  let byVenue = byDate.get(dk);
  if (!byVenue) { byVenue = new Map(); byDate.set(dk, byVenue); }
  const vk = targetVenue || "";
  if (byVenue.has(vk)) return byVenue.get(vk);
  const invById = new Map((imsInventory || []).map((i) => [i.id, i]));
  const index = new Map();
  key.forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    if (targetVenue && (fn?.fnVenue || "") !== targetVenue) return;
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (zoneIsOff(fn, zk)) return;
      (elems || []).forEach((el, elIdx) => {
        if (!el?.invId) return;
        if (el.foc) return; // left at the venue from a previous event — never competes for stock
        const elQty = Number(el.qty) || 0;
        if (elQty <= 0) return;
        // walkKitUnits recurses through a nested kit-inside-a-kit — see qtyUsedElsewhereInBuild's own comment for why
        // the old one-level component scan could miss a component two levels down.
        const perId = new Map();
        const topItem = invById.get(el.invId);
        if (!topItem) perId.set(el.invId, elQty);
        else walkKitUnits(topItem, elQty, imsInventory, el.kitOverrides, (node, nodeQty) => { if (node?.id != null) perId.set(node.id, (perId.get(node.id) || 0) + nodeQty); });
        perId.forEach((qty, id) => {
          if (!(qty > 0)) return;
          if (!index.has(id)) index.set(id, []);
          index.get(id).push({ fnIdx, zk, elIdx, qty });
        });
      });
    });
  });
  byVenue.set(vk, index);
  return index;
}
function itemRowsFor(invId, fns, imsInventory, targetDate, targetVenue) {
  return (bookingRowIndex(fns, imsInventory, targetDate, targetVenue).get(invId) || []).map((r) => ({ ...r }));
}

// Build: full scarce-stock allocation for ONE item across the WHOLE booking (same date) — every
// row that draws on invId (its own qty, or via a kit's component) competes for the same
// otherEventsAvail units. Smallest-qty rows are granted stock FIRST, so one zone's bulk increase
// concentrates the shortfall on ITSELF instead of retroactively flagging every other zone's
// untouched, already-fine row as short too — subtracting each sibling's raw (possibly itself-
// short) qty double-counted the deficit (a zone with qty 2 against 1 available unit elsewhere
// looked short there AND made a completely separate 1-unit zone look short again, when only one
// unit total was ever actually missing). Returns the allocation for the ONE row identified by
// target = { fnIdx, zoneKey, elIdx } (a specific row, not a whole-zone exclusion — this is only
// ever called from getElPriceFromInventory's own per-row shortfall pricing). targetVenue (optional,
// trailing so every existing caller/test keeps its exact old date-only behavior) — see
// qtyUsedElsewhereInBuild's own comment for why two same-day functions at different venues must not
// share one pool.
export function allocateRowAvailability(invId, fns, imsInventory, target, targetDate, otherEventsAvail, targetVenue) {
  if (!invId) return { ownedQty: 0, shortQty: 0 };
  const rows = itemRowsFor(invId, fns, imsInventory, targetDate, targetVenue);
  // Array.prototype.sort is stable (spec-guaranteed) — ties keep their original relative order, so
  // the result doesn't reshuffle between renders just because two rows happen to match on qty.
  rows.sort((a, b) => a.qty - b.qty);
  let remaining = Math.max(0, Number(otherEventsAvail) || 0);
  let result = { ownedQty: 0, shortQty: 0 };
  for (const r of rows) {
    const owned = Math.min(r.qty, remaining);
    remaining -= owned;
    if (r.fnIdx === target.fnIdx && r.zk === target.zoneKey && r.elIdx === target.elIdx) {
      result = { ownedQty: owned, shortQty: r.qty - owned };
    }
  }
  return result;
}

// The most units ONE row can ask for without running short itself AND without taking stock from another row
// of the booking that draws on the same item: the pool left once every other row has its own quantity.
// (allocateRowAvailability serves the smallest rows first, so a bigger quantity here would quietly push a
// sibling row into shortage instead — that is the one thing this cap exists to prevent.) Used to stop a
// quantity being typed or stepped past what an item that can't be produced can supply. targetVenue —
// see allocateRowAvailability's own comment.
//
// crossFnSiblingsFree (optional, trailing, only meaningful alongside targetVenue — every existing caller
// omits it and keeps the exact old behaviour, every other row counts as competing demand regardless of
// which function it belongs to): when true, a row belonging to a DIFFERENT function (r.fnIdx !== target's)
// is excluded from othersQty entirely, instead of being subtracted. Once targetVenue is given, every row
// itemRowsFor returns is already same-date AND same-venue as the target — which is exactly this deal's own
// cross-function reuse rule (findCrossFnReuseSource, lib/studio/crossFnReuse.js: same calendar date, same
// venue, within this one deal = reuse-eligible). A sibling FUNCTION's units at that same date+venue were
// never really "someone else's" demand to subtract — they're this deal's own stock already standing there,
// reusable for this row too — so the correct ceiling simply never counts them, rather than subtracting them
// and crediting an equal amount back separately. Two earlier attempts at that subtract-then-credit-back
// shape (owner report 2026-11-10) were both caught on regression review before shipping: this function's own
// Math.max(0, ...) clamp below discards whatever went negative, so once siblings already used more than the
// naive pool, a bonus added back AFTER that clamp created headroom with no basis in physical stock — reachable
// by a brand-new row with no short/warning flag at all. Not subtracting those rows in the first place has no
// such clamp to go wrong in, needs no separate pool, and is immune to element render order. A row within the
// SAME function (a different zone/elIdx, same fnIdx) is NOT a cross-function sibling — it's still genuine,
// separate, simultaneous demand on this exact function's own build, so it keeps counting as before regardless
// of this flag.
export function maxQtyForRow(invId, fns, imsInventory, target, targetDate, otherEventsAvail, targetVenue, crossFnSiblingsFree) {
  const pool = Math.max(0, Math.floor(Number(otherEventsAvail) || 0));
  if (!invId) return pool;
  // targetVenue required here too (not just documented as a precondition) — without it, itemRowsFor
  // doesn't filter by venue at all, so a same-date row at a genuinely DIFFERENT venue would wrongly
  // be excluded as if it were a reuse-eligible sibling.
  const othersQty = itemRowsFor(invId, fns, imsInventory, targetDate, targetVenue)
    .filter((r) => !(r.fnIdx === target.fnIdx && r.zk === target.zoneKey && r.elIdx === target.elIdx))
    .filter((r) => !(crossFnSiblingsFree && targetVenue && r.fnIdx !== target.fnIdx))
    .reduce((s, r) => s + r.qty, 0);
  return Math.max(0, pool - othersQty);
}

// Deal Check + Build share one root cause here: once a SOLD deal's own reservation is written into
// the real `blocks` table (reconcileSoldInventoryBlocks, StudioApp.jsx, or IMS's own auto-confirm
// engine — eventAutoConfirm.js — which reserves a deal's very FIRST stock the moment it's sold), that
// same per-date block total feeds every OTHER availability check for this item/date too — so a
// booked deal's own held stock reads as competing demand from someone else, and previously-free
// stock starts showing "short" (and billing its shortfall at cost%, not the rental rate) the moment
// the deal itself gets booked. Nets this deal's own reservation out of the raw per-date block map
// before any getStudioAvailable() call, by reading the REAL per-event blocks detail
// ({ itemId: [{eventId, qty}, …] }, from fetchIMSData's blocksDetailForDate/blocksDetailByDate) and
// summing whatever belongs to THIS deal's own event_order id. An earlier version of this read a
// dcReservedInventory cache instead (a snapshot only reconcileSoldInventoryBlocks ever wrote) — that
// cache never got a first write at all for a deal whose only reservation came from IMS's auto-confirm
// and had never been edited in Build since booking, so it stayed permanently uncredited for its own
// stock. Reading the live blocks detail has no such dependency: correct the instant the reservation
// exists, regardless of which of the app's two reservation paths wrote it.
// eventOrderId: one id, or every live order of the deal (ownEventOrderIds) - a deal booked twice holds stock under both.
export function netOwnReservedBlocksLive(fnBlocks, itemId, blocksDetailForDate, eventOrderId) {
  const own = new Set((Array.isArray(eventOrderId) ? eventOrderId : [eventOrderId]).filter(Boolean));
  if (!own.size) return fnBlocks || {};
  const entries = blocksDetailForDate?.[itemId];
  if (!Array.isArray(entries) || !entries.length) return fnBlocks || {};
  const ownReserved = entries.filter((b) => b && own.has(b.eventId)).reduce((s, b) => s + (Number(b.qty) || 0), 0);
  if (ownReserved <= 0) return fnBlocks || {};
  return { ...(fnBlocks || {}), [itemId]: Math.max(0, ((fnBlocks || {})[itemId] || 0) - ownReserved) };
}

// Deal Check: same idea over dcCards[fnIdx][cardKey] (+ card.split[] variants) and dcManualItems,
// plus kit expansion via dcKitEdits overrides.
// exclude = { fnIdx, zoneKey?, cardKey?, manualId? } — zoneKey alone excludes the whole zone
// (manual-add box); cardKey/manualId excludes just that one row (kit-component search, swap grid).
export function qtyUsedElsewhereInDealCheck(imsId, fns, dcCards, dcManualItems, dcKitEdits, inventory, exclude = {}, targetDate) {
  if (!imsId) return 0;
  let used = 0;
  (fns || []).forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    Object.entries((dcCards || {})[fnIdx] || {}).forEach(([ck, card]) => {
      const excluded = fnIdx === exclude.fnIdx &&
        ((exclude.zoneKey != null && card?.zoneKey === exclude.zoneKey && exclude.cardKey == null) ||
         (exclude.cardKey != null && ck === exclude.cardKey));
      if (excluded) return;
      // FOC — resolved via the shared cardIsFoc (same helper StudioApp.jsx/DealCheckOverlay.jsx use,
      // fail-safe rcName check included). A FOC'd card never competes for stock with a different row's
      // own availability check.
      if (cardIsFoc(fn?.zoneElements, ck)) return;
      const splitArr = Array.isArray(card?.split) ? card.split : null;
      if (splitArr) {
        splitArr.forEach((s) => { if (s.imsId === imsId) used += Number(s.qty) || 0; });
        return;
      }
      if (!card?.imsId) return;
      const qty = Number(card.qty) || 1;
      if (card.imsId === imsId) { used += qty; return; }
      // kit sub-component coverage, recursing into kits-inside-kits
      const kitItem = (inventory || []).find((i) => i.id === card.imsId);
      if (kitItem && Array.isArray(kitItem.subItems) && kitItem.subItems.length) {
        const edited = dcKitEdits?.[fnIdx]?.[ck];
        const overrideSubItems = Array.isArray(edited) ? edited : undefined;
        walkKitUnits(kitItem, qty, inventory, overrideSubItems, (node, nodeQty) => {
          if (node?.id === imsId) used += nodeQty;
        });
      }
    });
    (dcManualItems || []).filter((mi) => mi.fnIdx === fnIdx).forEach((mi) => {
      const excluded = fnIdx === exclude.fnIdx &&
        ((exclude.zoneKey != null && mi.zoneKey === exclude.zoneKey && exclude.manualId == null) ||
         (exclude.manualId != null && mi.manualId === exclude.manualId));
      if (excluded) return;
      if (mi.imsId === imsId) used += Number(mi.qty) || 1;
    });
  });
  return used;
}

// Build: the parts of ONE kit row that are short on its date — every component at any depth, not the kit itself (the
// kit's own stock is the row's ordinary check). A kit whose own count is fine used to show nothing while a part inside
// it (a cushion cover, a pot) was booked out elsewhere, and the deal could still be marked Sold (owner ask 2026-10-31).
// availFor(part) = how many of that part are free for the date (other events' blocks, Fixed-Venue locks). With a target
// row, the part's free units are shared out across every row of the booking that uses it (allocateRowAvailability —
// a plain element, or another kit's part), so the same shortage is never counted against two rows. Without one, the
// row is judged alone. Returns [{ id, name, need, short }] for the short parts only.
// reusePool (optional, a mutable Map<invId, qty> from fnUnitQty of the deal's same-day / previous-day function at the venue): parts
// already standing there are not short - drawn down so two kits can't claim the same reused pieces.
export function kitPartShortfalls(kitItem, elQty, kitOverrides, fns, imsInventory, target, targetDate, availFor, reusePool, targetVenue) {
  if (!kitItem || !(Number(elQty) > 0) || typeof availFor !== "function") return [];
  const need = new Map();
  walkKitUnits(kitItem, Number(elQty), imsInventory, kitOverrides, (node, nodeQty) => {
    if (!node?.id || node.id === kitItem.id) return;
    const cur = need.get(node.id) || { item: node, qty: 0 };
    cur.qty += Number(nodeQty) || 0;
    need.set(node.id, cur);
  });
  const out = [];
  need.forEach(({ item, qty }, id) => {
    const avail = Math.max(0, Number(availFor(item)) || 0);
    let short = target
      ? allocateRowAvailability(id, fns, imsInventory, target, targetDate, avail, targetVenue).shortQty
      : Math.max(0, qty - avail);
    if (short > 0 && reusePool) { const take = Math.min(short, reusePool.get(id) || 0); if (take > 0) { reusePool.set(id, (reusePool.get(id) || 0) - take); short -= take; } }
    if (short > 0) out.push({ id, name: item.name || id, need: qty, short: Math.round(short * 100) / 100 });
  });
  return out;
}

// Every unit a function puts at the venue, kit parts included (a kit's own id and each part's, by qty) - the pool a same-day or
// next-day function of the deal can reuse. computeFnInvQty counts top-level items only, so a sofa inside Haldi's lounge kit was
// not there for Sangeet's same kit to reuse: the Sold check read the kit's parts out of stock (owner report 2026-11-01).
export function fnUnitQty(fnData, imsInventory) {
  const m = new Map();
  const add = (id, q) => { if (id && q > 0) m.set(id, (m.get(id) || 0) + q); };
  const en = fnData?.enabledEls || {};
  Object.entries(fnData?.zoneElements || {}).forEach(([zk, elems]) => {
    if (!en[zk] || !Array.isArray(elems)) return;
    elems.forEach((el) => {
      const q = Number(el?.qty) || 0;
      if (!el?.invId || !(q > 0)) return;
      if (el.foc) return; // left at the venue from a previous event — earns no reuse credit for a different function
      const item = (imsInventory || []).find((i) => i.id === el.invId);
      if (item && Array.isArray(item.subItems) && item.subItems.length) walkKitUnits(item, q, imsInventory, el.kitOverrides, (node, nq) => add(node?.id, Number(nq) || 0));
      else add(el.invId, q);
    });
  });
  return m;
}

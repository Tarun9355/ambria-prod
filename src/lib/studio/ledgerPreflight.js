// Pre-Sold ledger-shaped shortfall check (Phase 4, 2026-11-14 inventory-blocks audit, finding F4 /
// "bug 7"). Pure, no React, no Supabase — same reasoning as soldBlocksPlan.js for staying testable
// without the app around it.
import { reqByDateFrom } from "./soldBlocksPlan.js";
//
// WHY THIS EXISTS: Build's own live availability check (allocateRowAvailability/maxQtyForRow,
// dealAvailability.js, read by scanOutOfStockElements' pre-Sold OOS gate) credits cross-function reuse
// (findCrossFnReuseSource/crossFnBonus — same day OR the day before, same venue) when deciding whether
// ONE row is short. That credit is correct for PRICING (a reused item is billed once, not twice) — but
// the real `blocks` LEDGER a sold deal reserves (reqByDateFrom, soldBlocksPlan.js) has no such credit:
// it reserves the real max-per-venue, summed-across-venues total, same as what this deal's own build
// truly needs physically installed at once. Two same-day, same-venue functions each needing the FULL
// qty of an item (reuse-eligible with each other, so pricing credits both to zero) can each
// independently price as "fully covered" while the real ledger need (the MAX of the two, not zero)
// still exceeds what's left once another deal's own hold is netted out of real stock — exactly the gap
// apply_block_ops' own 'cap' mode exists to catch at WRITE time (migration 066), but only AFTER the
// deal is already marked Sold, surfaced as a shortfall the salesperson never saw coming. This re-derives
// the SAME real-ledger need reconcileSoldInventoryBlocks will go on to reserve — not the pricing-side
// credited view — so the pre-Sold gate can tell the salesperson BEFORE they confirm, not have the RPC
// quietly cap it after.
//
// SCOPE: deliberately plain-invId-only, same documented scope as scanOutOfStockElements itself
// (StudioApp.jsx: "Only plain invId elements are checked — a kit/pattern/mandi element never sets
// outOfStock at all; a kit is checked through its parts instead"). Kit components have their own
// separate, pricing-side-only check (kitPartShorts) and are NOT covered here. Deal Check's own manual
// items (dcManualItems) are also not covered — like the OOS gate itself, this reads Build's raw
// zoneElements only; Deal Check's AI card-matching hasn't run yet at pre-Sold time.
//
// fns: collectAllFunctionData() output. inventory: imsInventory. blocksDetailByDate:
// { [date]: { [itemId]: [{eventId, qty, status, ...}] } } — the SAME live, per-event detail
// allocateRowAvailability's own callers already read (liveDateBlocks's blocksDetailForDate).
// ownEventIds: every event_order id this deal itself holds (so its OWN existing reservation nets out,
// same as netOwnReservedBlocksLive elsewhere — a re-confirm of an already-sold deal must not see its
// own prior hold as competing demand).
//
// Three rules below exist ONLY to keep this gate from being STRICTER than what apply_block_ops' own
// 'cap'/'force' write will actually do (regression review, 2026-11-14 — a gate that over-blocks is as
// real a bug as one that under-catches, just the opposite direction):
//   - an item the reconcile marks allowOver (reconcileSoldInventoryBlocks' own rule: canBeMade===true,
//     or zero owned qty — made-to-order) never caps at the RPC; it's tracked as qtyToProduce instead.
//     Flagging it here would block a perfectly fine booking the RPC will happily accept.
//   - an inventory id the gate can't find (catalogue-deleted, migration 059) has no real owned qty to
//     check against — the RPC itself treats a missing row as never short (v_owned null → free =
//     requested), and the OOS gate already skips a deleted item the same way (no liveItem found).
//   - this deal's OWN existing hold on (date, item) is never let shrink the free pool below what it
//     already holds (the RPC's own v_free = greatest(owned - others, v_prior, 0), migration 066) — an
//     unrelated OTHER deal/force-block elsewhere must never make a re-confirm of THIS deal's own
//     unchanged qty suddenly read as short.
export function ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds }) {
  const reqByFnIdx = {};
  (fns || []).forEach((fn, i) => {
    const fnIdx = fn?.fnIdx ?? i;
    const byItem = {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (!enabledEls[zk] || !Array.isArray(elems)) return;
      elems.forEach((el) => {
        if (!el?.invId || el.foc) return; // FOC — left at the venue, never competes for stock
        const qty = Number(el.qty) || 0;
        if (qty <= 0) return;
        byItem[el.invId] = (byItem[el.invId] || 0) + qty;
      });
    });
    reqByFnIdx[fnIdx] = byItem;
  });
  const needByDate = reqByDateFrom(fns, reqByFnIdx);
  const ownIds = new Set((ownEventIds || []).filter(Boolean));
  const invById = new Map((inventory || []).map((i) => [i.id, i]));
  const out = [];
  Object.entries(needByDate).forEach(([date, byItem]) => {
    Object.entries(byItem).forEach(([itemId, need]) => {
      const item = invById.get(itemId);
      if (!item) return; // deleted/unknown item — nothing real to check against, same as the OOS gate
      if (item.canBeMade === true || !(Number(item.qty) > 0)) return; // allowOver — the RPC never caps this, it tracks qtyToProduce instead
      const owned = Math.max(0, (Number(item.qty) || 0) - (Number(item.blocked) || 0));
      const entries = blocksDetailByDate?.[date]?.[itemId] || [];
      const others = entries.filter((b) => b && !ownIds.has(b.eventId)).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      const ownHeld = entries.filter((b) => b && ownIds.has(b.eventId)).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      const free = Math.max(owned - others, ownHeld, 0);
      if (need <= free) return;
      out.push({ date, itemId, name: item.name || itemId, need, free, short: need - free });
    });
  });
  return out;
}

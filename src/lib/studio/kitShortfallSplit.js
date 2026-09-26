import { oosCostPctFor } from "../rateCard";

// Splits `qty` units of `item` (a plain item, or a kit — possibly containing another kit) into an
// "owned" portion, billed at its normal rental rate with every discount intact (Repeat/Fixed-Venue/
// cross-function-reuse/date-category — same as any plain item Build already prices this way), and a
// TRUE shortfall portion that must be freshly produced/bought, billed flat at cost x sub-category
// cost%, with none of those discounts (Owner ask: a fresh unit's price isn't about market/zone-reuse
// status, it's what it actually costs to make). Recurses into a kit's own components for exactly the
// shortfall share — the owned share already bills at the kit's full assembled rate via its own
// rentalRateFor, so recursing into ITS components too would double-price them.
//
// A kit's own fixed assembly charge (kitBase) has no stock of its own to be short of — it's a labor/
// markup line, not a truckable unit — so the shortfall share of it is priced flatly at the kit's own
// cost%, same treatment a leaf item's cost gets.
//
// cardKey is the Deal-Check per-instance kit-component override key; only meaningful at the outermost
// call (dcKitEdits only tracks the card the salesperson actually edited) — nested kit-inside-a-kit
// levels always price off their own live default recipe, same limitation effKitRental documents.
export function kitShortfallSplit(item, qty, cardKey, ctx) {
  const { inventoryCache, kitEditsFor, availFor, crossFnTake, costPctFor, repeatAdjustedRentalFn, rentalRateFor } = ctx;
  if (!item || !(Number(qty) > 0)) return { ownedCost: 0, shortCost: 0, ownedQty: 0, shortQty: 0 };
  const avail = availFor(item);
  const crossFn = crossFnTake(item.id, qty);
  const ownedQty = Math.min(qty, avail + crossFn);
  const shortQty = Math.max(0, qty - ownedQty);
  const baseRental = rentalRateFor(item, cardKey);
  const ownedCost = repeatAdjustedRentalFn(item, ownedQty, baseRental, crossFn);
  const isKit = Array.isArray(item.subItems) && item.subItems.length > 0;
  if (!isKit || shortQty <= 0) {
    const shortCost = shortQty * (Number(item.cost) || 0) * (oosCostPctFor(item, costPctFor) / 100);
    return { ownedCost, shortCost, ownedQty, shortQty };
  }
  const kitBaseCost = shortQty * (Number(item.kitBase) || 0) * (oosCostPctFor(item, costPctFor) / 100);
  const edited = kitEditsFor(cardKey);
  const comps = Array.isArray(edited) ? edited : item.subItems.map((s) => ({ itemId: s.itemId, qty: Number(s.qty) || 1 }));
  let compsCost = 0;
  comps.forEach((cp) => {
    const ci = (inventoryCache || []).find((x) => x.id === (cp.itemId ?? cp.id));
    if (!ci) return;
    const cq = (cp.qty == null ? 1 : (Number(cp.qty) || 0)) * shortQty;
    if (cq <= 0) return;
    const sub = kitShortfallSplit(ci, cq, null, ctx);
    compsCost += sub.ownedCost + sub.shortCost;
  });
  return { ownedCost, shortCost: kitBaseCost + compsCost, ownedQty, shortQty };
}

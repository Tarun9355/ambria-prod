import { innerDiscountFactor } from "./discounts.js";

// The Repeat / standing / reuse discount on one rental line, as pure functions so the Studio's guest
// price and Deal Check's rental cost run the same arithmetic and it can be tested without React.
//
// item.noRepeatDiscount (IMS → Inventory → "No repeat discount on this item") switches the item out of
// all of it: it is billed at its full rate whatever the zone, venue or function (the date's Filler /
// King's factor is not a Repeat discount and still applies, outside these functions).

// ── GUEST PRICE ─────────────────────────────────────────────────────────────────────────────────
// A flat `pct`% off the units that are reused: every unit of a Repeat zone, otherwise the units
// standing at the venue or already used in an earlier function (capped at qty). `dateFactor` is the
// date multiplier the caller multiplies onto the result afterwards; a date below 1 competes with the
// discount instead of stacking (innerDiscountFactor). `flaggedUnitRate` is the part of unitRate that
// belongs to kit components switched out of the discount — that part of every unit is never reduced.
export function guestRepeatLineCost({ qty, unitRate, flaggedUnitRate = 0, noDiscount = false, hidden = false, isRepeat = false, standingUnits = 0, crossFnReuseQty = 0, dateFactor = 1, pct = 25 }) {
  const full = qty * unitRate;
  if (noDiscount || hidden) return full;
  const flagged = Math.max(0, Math.min(unitRate, Number(flaggedUnitRate) || 0));
  const discountable = unitRate - flagged;
  const eachDiscounted = discountable * innerDiscountFactor(dateFactor, pct) + flagged;
  // Rounded to the rupee — a 25% cut rarely lands on a whole number otherwise.
  if (isRepeat) return Math.round(qty * eachDiscounted);
  const eligible = Math.min(qty, Math.max(0, standingUnits) + Math.max(0, crossFnReuseQty));
  if (eligible <= 0) return full;
  return Math.round(eligible * eachDiscounted + (qty - eligible) * unitRate);
}

// The part of a kit's unit price that belongs to components (at any depth) switched out of the
// discount — a switched-off component takes its whole subtree's price out. `priceFor(item, subOverrides)`
// is the item's own unit price (priceForInvItem), so the parts add up to exactly what the kit is priced at.
export function flaggedUnitRate(item, priceFor, inventory, overrideSubItems, _seen) {
  if (!item) return 0;
  if (item.noRepeatDiscount === true) return priceFor(item, overrideSubItems);
  const subs = Array.isArray(overrideSubItems) ? overrideSubItems : item.subItems;
  if (!Array.isArray(subs) || !subs.length) return 0;
  const seen = _seen ? new Set(_seen) : new Set();
  if (item.id) { if (seen.has(item.id)) return 0; seen.add(item.id); }
  return subs.reduce((sum, si) => {
    if (!si || si.patternId) return sum;
    const ci = (inventory || []).find((i) => i.id === si.itemId);
    if (!ci) return sum;
    return sum + flaggedUnitRate(ci, priceFor, inventory, Array.isArray(si.subOverrides) ? si.subOverrides : undefined, seen) * (Number(si.qty) || 0);
  }, 0);
}

// ── DEAL CHECK RENTAL (Ambria's own cost) ───────────────────────────────────────────────────────
// Units standing at a Fixed Venue take that venue's own % (discountPct), units reused from an earlier
// function take the sub-category's % (subcatPct), and in a Repeat zone everything else takes
// subcatPct too. dateMult (Filler / King's / Perfect) multiplies throughout; when it is below 1 it
// competes with each unit's discount instead of stacking. Units never get two of them.
export function dcRentalCost({ qty, baseRentalIn, dateMult = 1, hasItem = true, noDiscount = false, isRepeatZone = false, standingUnits = 0, freshUnits = qty, discountPct = 0, subcatPct = 0, crossFnReuseQty = 0 }) {
  const baseRental = baseRentalIn * dateMult;
  const full = qty * baseRental;
  if (!hasItem || noDiscount) return full;
  const disc = (pct) => innerDiscountFactor(dateMult, pct);
  const crossFnEligible = Math.max(0, Math.min(freshUnits, crossFnReuseQty));
  if (standingUnits > 0 || crossFnEligible > 0) {
    const trulyFresh = freshUnits - crossFnEligible;
    return standingUnits * baseRental * disc(discountPct) + crossFnEligible * baseRental * disc(subcatPct) + trulyFresh * baseRental;
  }
  if (!isRepeatZone) return full;
  return full * disc(subcatPct);
}

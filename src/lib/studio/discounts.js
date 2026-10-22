// A date can be cheaper (Filler ×0.75, or a last-minute booking) and an item can carry its own
// discount (Fixed-Venue standing stock, a Repeat zone, sub-category reuse). Owner rule: they do not
// stack — where more than one discount applies, only the BIGGEST one is taken (Filler 25% and a
// 50% Fixed-Venue discount is 50% off, not 62.5%; Filler 25% and a 10% one is 25%).
//
// Only a date multiplier BELOW 1 is a discount. King's (×1.2) and Perfect (×1) are market pricing,
// not a discount, so they still multiply on top of whatever discount the item has.

// The final factor on an item's undiscounted price, for units that carry a discount of `pct` %.
export function bestDiscountFactor(dateMult, pct) {
  const d = Number(dateMult) > 0 ? Number(dateMult) : 1;
  const item = 1 - (Number(pct) || 0) / 100;
  return d < 1 ? Math.min(d, item) : d * item;
}

// The same thing as the part still to be applied BEFORE the date multiplier is multiplied on
// afterwards (the guest price path multiplies the date factor on top of the line's own discount).
export function innerDiscountFactor(dateMult, pct) {
  const d = Number(dateMult) > 0 ? Number(dateMult) : 1;
  return bestDiscountFactor(d, pct) / d;
}

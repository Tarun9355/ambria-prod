// Which units a quantity can be fractional in. A count of things (pieces, sets, bundles, a "string" of lights,
// a setup, an event) is a whole number — there is no 3.5 WARM LED. Measures (sqft, rft, kg, metre) can be
// fractional. An unknown unit is left alone (decimals allowed) rather than blocking a legitimate quantity.
const WHOLE_UNITS = new Set([
  "piece", "pieces", "pc", "pcs", "set", "sets", "bundle", "bundles", "nos", "no", "unit", "units",
  "item", "items", "each", "pair", "pairs", "string", "strings", "setup", "setups", "event", "events", "trip", "trips",
]);

export const unitAllowsDecimal = (unit) => !WHOLE_UNITS.has(String(unit || "").trim().toLowerCase());

// A typed or stepped quantity, made valid for its unit: whole units are rounded to a whole number.
export const quantityForUnit = (unit, qty) => {
  const q = Number(qty) || 0;
  return unitAllowsDecimal(unit) ? q : Math.round(q);
};

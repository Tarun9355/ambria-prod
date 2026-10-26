// Print jobs (a zone's zc.prints — Flex / Vinyl / Sunboard… from Build's Print tile) have to be trucked like anything else, but they are
// not inventory items, so no sub-category capacity ever picked them up. Their load is their area: width x depth x quantity, summed.
// It is counted under the truck-capacity row named PRINT_TRUCK_SUB ("Print", in sqft per truck), exactly like Platform or Carpet; a deal
// with no such row set up in Manage > Transport trucks nothing for prints, as before. A print is made fresh for each event, so a repeat
// setup never waives it.
export const PRINT_TRUCK_SUB = "Print";

export function printSqftOf(cfg) {
  return (Array.isArray(cfg?.prints) ? cfg.prints : []).reduce((sum, p) => {
    const w = Number(p?.areaW) || 0, d = Number(p?.areaD) || 0;
    if (!(w > 0 && d > 0)) return sum;
    return sum + w * d * Math.max(1, Math.round(Number(p?.qty) || 1));
  }, 0);
}

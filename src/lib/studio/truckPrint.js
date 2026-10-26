// Print jobs (a zone's zc.prints — Flex / Vinyl / Sunboard… from Build's Print tile) have to be moved like anything else, but they are not
// inventory items, so no sub-category capacity ever picked them up. Two rules, both owner's:
//
//  1. A small print — one that costs less than SMALL_PRINT_LIMIT — does not fill a truck, so it is not counted by area. Instead the function is
//     charged one flat SMALL_PRINT_CHARGE for transport, however many small prints it has (they travel together).
//  2. Every other print is trucked by its area: width x depth x quantity, summed, under the truck-capacity row named PRINT_TRUCK_SUB
//     ("Print", sqft per truck, Manage > Transport — like Platform or Carpet). With no such row set up nothing is trucked for them.
//
// A print is made fresh for each event, so a repeat setup never waives either.

export const PRINT_TRUCK_SUB = "Print";
export const SMALL_PRINT_LIMIT = 2000;   // a print that costs less than this (₹) is "small"
export const SMALL_PRINT_CHARGE = 500;   // flat transport charge (₹) for a function that has any small print
export const SMALL_PRINT_LABEL = "Small prints (flat)";

const jobArea = (p) => {
  const w = Number(p?.areaW) || 0, d = Number(p?.areaD) || 0;
  return w > 0 && d > 0 ? w * d * Math.max(1, Math.round(Number(p?.qty) || 1)) : 0;
};

// What a print job costs (rate card of the print material x its area). A job with no material or no rate is worth ₹0, so it is small.
export function printJobPrice(p, printMaterials) {
  const m = (printMaterials || []).find((x) => x.id === p?.material);
  return jobArea(p) * (Number(m?.ratePerSqft) || 0);
}

// One zone's prints split into what is trucked by area and what is small. Jobs without a size carry nothing and count as neither.
export function splitPrints(cfg, printMaterials) {
  let bigSqft = 0, smallJobs = 0;
  (Array.isArray(cfg?.prints) ? cfg.prints : []).forEach((p) => {
    const a = jobArea(p);
    if (!(a > 0)) return;
    if (printJobPrice(p, printMaterials) < SMALL_PRINT_LIMIT) smallJobs += 1; else bigSqft += a;
  });
  return { bigSqft, smallJobs };
}

// The truck-by-area load of a zone's prints (the big ones only).
export const printSqftOf = (cfg, printMaterials) => splitPrints(cfg, printMaterials).bigSqft;

// A whole function: the flat charge (once, if any switched-on zone has a small print) and how many small jobs there are.
export function smallPrintFlat(zoneConfig, enabledEls, printMaterials) {
  let jobs = 0;
  Object.entries(zoneConfig || {}).forEach(([zk, cfg]) => {
    if (!cfg || !enabledEls?.[zk]) return;
    jobs += splitPrints(cfg, printMaterials).smallJobs;
  });
  return { jobs, charge: jobs > 0 ? SMALL_PRINT_CHARGE : 0 };
}

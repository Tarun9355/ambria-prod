// Print jobs (a zone's zc.prints — Flex / Vinyl / Sunboard… from Build's Print tile) have to be moved like anything else, but they are not
// inventory items, so no sub-category capacity ever picked them up. Two rules, both owner's:
//
//  1. A small print — one that costs less than SMALL_PRINT_LIMIT (and more than nothing) — does not fill a truck, so it is not counted by area. Instead the function is
//     charged one flat SMALL_PRINT_CHARGE for transport, however many small prints it has (they travel together).
//  2. Every other print is trucked by its area: width x depth x quantity, summed, under the truck-capacity row named PRINT_TRUCK_SUB
//     ("Print", sqft per truck, Manage > Transport — like Platform or Carpet). With no such row set up nothing is trucked for them.
//
// A print is physically made fresh for each event — both rules above used to hold regardless of
// Repeat because of that. Overridden by explicit owner request, 2026-11-13: a Repeat zone's print
// (or one at a Fixed Venue) now waives BOTH — the big-print truck line (StudioApp.jsx's truck-calc
// functions, gated on repeatCatFor(cfg,"print")/fvStruct) and this file's own small-print flat charge
// (printFlatForZone's callers now pass an `isZoneWaived(zk)` predicate, built from the same
// structDiscountFor(...).print check calcStructCost's own guest-facing print discount already uses —
// a PREDICATE over every zone, not just one flag, since this charge is per-function, carried by
// whichever zone has the first small print: a waived carrier must let the charge fall through to the
// next eligible zone rather than lose it entirely) — same treatment as truss/platform/elements, even
// though the physical reasoning for why it used to be exempt still holds.

export const PRINT_TRUCK_SUB = "Print";
export const SMALL_PRINT_LIMIT = 2000;   // a print that costs less than this (₹) is "small"
export const SMALL_PRINT_CHARGE = 400;   // flat transport charge (₹) for a function that has any small print
export const SMALL_PRINT_LABEL = "Small prints (flat)";

const jobArea = (p) => {
  const w = Number(p?.areaW) || 0, d = Number(p?.areaD) || 0;
  return w > 0 && d > 0 ? w * d * Math.max(1, Math.round(Number(p?.qty) || 1)) : 0;
};

// What a print job costs, in whole rupees (rate of the print material x its area). A job with no material or no rate is worth ₹0.
export function printJobPrice(p, printMaterials) {
  const m = (printMaterials || []).find((x) => x.id === p?.material);
  return Math.round(jobArea(p) * (Number(m?.ratePerSqft) || 0));
}

// One zone's prints split into what is trucked by area and what is small. Jobs without a size carry nothing and count as neither.
export function splitPrints(cfg, printMaterials) {
  let bigSqft = 0, smallJobs = 0;
  (Array.isArray(cfg?.prints) ? cfg.prints : []).forEach((p) => {
    const a = jobArea(p);
    if (!(a > 0)) return;
    const price = printJobPrice(p, printMaterials);
    // a print with no price (no material picked, or a material with no rate) is not billed, so it is not "small" either: it is trucked by area
    if (price > 0 && price < SMALL_PRINT_LIMIT) smallJobs += 1; else bigSqft += a;
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

// Which small print carries the function's flat charge on screen: the first one, going through the switched-on zones in order. The charge is
// once per function, so it is shown on that one job only. { zk, index } (index = the job's position in its zone's prints), or null.
// `isZoneWaived(zk)` (optional, owner correction 2026-11-13): a Repeat/Fixed-Venue zone's print
// transport is waived, but the charge itself is a PER-FUNCTION flat fee, not a per-zone one — it still
// has to land on whichever zone genuinely owes it. Picking the first small print regardless of waiver
// used to let a waived zone "carry" the charge and then zero it out via its own waiver check, losing
// the fee entirely even when a DIFFERENT, non-waived zone in the same function has its own small print
// that should still bring it. Skipping a waived zone here lets the charge fall through to the next
// eligible one instead of disappearing.
export function firstSmallPrint(zoneConfig, enabledEls, printMaterials, isZoneWaived) {
  for (const [zk, cfg] of Object.entries(zoneConfig || {})) {
    if (!cfg || !enabledEls?.[zk]) continue;
    if (isZoneWaived && isZoneWaived(zk)) continue;
    const jobs = Array.isArray(cfg.prints) ? cfg.prints : [];
    for (let index = 0; index < jobs.length; index++) {
      if (splitPrints({ prints: [jobs[index]] }, printMaterials).smallJobs > 0) return { zk, index };
    }
  }
  return null;
}

// The flat charge sits in ONE zone's Print cost: the one that carries the first small print (see firstSmallPrint), so the Print tile, the zone's total, the
// function's decor and every export count it exactly once. Returns the charge for that zone, 0 for every other zone. `isZoneWaived` — see firstSmallPrint.
export function printFlatForZone(zoneConfig, enabledEls, printMaterials, zk, isZoneWaived) {
  const first = firstSmallPrint(zoneConfig, enabledEls, printMaterials, isZoneWaived);
  return first && first.zk === zk ? SMALL_PRINT_CHARGE : 0;
}

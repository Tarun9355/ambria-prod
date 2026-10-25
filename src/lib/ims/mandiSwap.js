// A flower the mandi did not have, swapped on the Floral real-shopping list. The list keeps the original as a row
// marked `swappedTo` (bought qty 0) and the replacement as its own row marked `swapFor` (the qty actually bought).
// An arrangement that uses the original is then made with the replacement: the recipe line names the replacement
// only, in the replacement's unit, scaled by bought ÷ planned so each piece gets its share.

const key = (n) => String(n || "").trim().toLowerCase();

// One entry per swapped flower, keyed by the ORIGINAL flower's name (lower-cased):
// { name, unit, ratio } of the replacement. Only a complete pair counts — a replacement row whose original is not marked
// swapped-out is ignored. Planned qty 0 (an "extra" the plan never had) can't scale, so the ratio is 1.
export function buildEventSwap(mandiLines) {
  const lines = Array.isArray(mandiLines) ? mandiLines : [];
  const out = new Map();
  lines.forEach((r) => {
    if (!r?.swapFor) return;
    const orig = lines.find((x) => x && x.name === r.swapFor && x.swappedTo);
    if (!orig) return;
    const planned = Number(orig.projQty) || 0;
    const ratio = planned > 0 ? (Number(r.qty) || 0) / planned : 1;
    out.set(key(r.swapFor), { name: r.name, unit: r.unit || "", ratio });
  });
  return out;
}

// The recipe line for a flower this event swapped, or null when it was not swapped. qty is per piece, so it is kept to
// four decimals: when the units differ (595 pieces planned, 2 gatthar bought) the per-piece amount is tiny, and two
// decimals would round it to 0 and drop the flower from the recipe altogether.
export function swappedRecipeFlower(eventSwap, flowerName, baseQty) {
  const es = eventSwap && eventSwap.get(key(flowerName));
  if (!es) return null;
  return { name: es.name, qty: Math.round((Number(baseQty) || 0) * es.ratio * 10000) / 10000, unit: es.unit };
}

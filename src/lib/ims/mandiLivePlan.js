// The Floral mandi list's PLANNED side (projQty / projCost) always follows Deal Check's current plan.
//
// Once anyone logs real shopping on a function's tab, that tab's rows are saved and become the
// source of truth for what was BOUGHT (qty, price, swaps). They used to freeze the planned side
// too: a deal that grew after shopping started (owner report, 2026-11-20: a 144 sq ft Guldavari +
// Tussel element added later) kept showing "16 kg planned" while Deal Check — and the "how" box
// right under it — said 43.07 kg exact, 44 whole kg. The planned side is Deal Check's, never the
// shopper's, so it is re-read from the live plan every time; what was bought is never touched.
//
// Matched by flower name + colour (the same key the floralPlan builders aggregate on). When the
// colour changed in Deal Check after shopping began, the full key misses, so it falls back to the
// name alone, but only when the plan holds that flower in exactly one colour (otherwise which
// colour the row was would be a guess). A planned row the plan no longer holds at all is now
// unplanned (projQty 0, so it reads "extra"). Swap replacement rows (swapFor) are never planned.
// With no live plan to read (seed empty) the stored rows are returned exactly as they were.

const nameKey = (n) => String(n || "").trim().toLowerCase();
const colourOf = (r) => r?.colorVariant?.label || (Array.isArray(r?.colorPrefs) ? r.colorPrefs.map((p) => p.label).join("/") : "") || "";
export const mandiRowKey = (r) => `${nameKey(r?.name)}¦${colourOf(r)}`;

export function withLivePlan(storedRows, seedRows) {
  const stored = Array.isArray(storedRows) ? storedRows : [];
  const seed = Array.isArray(seedRows) ? seedRows : [];
  if (!seed.length) return stored;
  const byKey = new Map();
  const byName = new Map();
  seed.forEach((s) => {
    if (!byKey.has(mandiRowKey(s))) byKey.set(mandiRowKey(s), s);
    const n = nameKey(s.name);
    byName.set(n, byName.has(n) ? null : s); // null = more than one colour planned, no name-only match
  });
  return stored.map((r) => {
    if (!r || r.swapFor) return r;
    const exact = byKey.get(mandiRowKey(r));
    const s = exact || byName.get(nameKey(r.name)) || null;
    if (!s) return (Number(r.projQty) || 0) > 0 || (Number(r.projCost) || 0) > 0 ? { ...r, projQty: 0, projCost: 0 } : r;
    const next = { ...r, projQty: Number(s.projQty) || 0, projCost: Number(s.projCost) || 0 };
    // Colour follows Deal Check too (it did before this helper, for an exact match only).
    next.colorVariant = s.colorVariant || null;
    next.colorPrefs = s.colorPrefs || null;
    return next;
  });
}

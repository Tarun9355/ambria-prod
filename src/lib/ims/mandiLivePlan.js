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
// With no live plan to read (seed empty) the stored rows are returned as they were.
//
// A flower the plan has but the logged list does not (Deal Check grew, or a recipe swapped one
// flower for another, after shopping began — owner report 2026-11-20: a recipe moved from guldavari
// ladi to guldavari hanging and hanging never reached Planning) is ADDED, at qty 0 and marked
// `newInPlan`: it shows, with its planned qty, but counts as nothing bought until someone enters it.
// A planned row the shopper deliberately removed is kept in the stored list as a hidden marker
// (`dismissedFromPlan`, see dismissMarker) so it is not added straight back; markers never display
// and never count (qty 0). They live inside the tab's own rows so a function removal, which moves a
// tab's rows to a new index, moves them too.

const nameKey = (n) => String(n || "").trim().toLowerCase();
const colourOf = (r) => r?.colorVariant?.label || (Array.isArray(r?.colorPrefs) ? r.colorPrefs.map((p) => p.label).join("/") : "") || "";
export const mandiRowKey = (r) => `${nameKey(r?.name)}¦${colourOf(r)}`;

export const isDismissMarker = (r) => !!r?.dismissedFromPlan;

// The hidden marker left behind when a planned row is removed from the list on purpose.
export const dismissMarker = (r) => ({ name: r.name, unit: r.unit || "", colorVariant: r.colorVariant || null, colorPrefs: r.colorPrefs || null, dismissedFromPlan: true, qty: 0, price: 0, projQty: 0, projCost: 0 });

// opts.append (default true): add the plan's missing flowers. Off for the old flat "Already logged" list
// when per-function tabs exist — it is checked against the WHOLE-event plan, so appending would pull every
// other function's flowers into it as "New in the plan" too (test-agent finding R4, 2026-11-20).
export function withLivePlan(storedRows, seedRows, { append = true } = {}) {
  const all = Array.isArray(storedRows) ? storedRows : [];
  const stored = all.filter((r) => !isDismissMarker(r));
  const seed = Array.isArray(seedRows) ? seedRows : [];
  if (!seed.length) return stored.length === all.length ? all : stored;
  const dismissed = new Set(all.filter(isDismissMarker).map(mandiRowKey));
  const byKey = new Map();
  const byName = new Map();
  seed.forEach((s) => {
    if (!byKey.has(mandiRowKey(s))) byKey.set(mandiRowKey(s), s);
    const n = nameKey(s.name);
    byName.set(n, byName.has(n) ? null : s); // null = more than one colour planned, no name-only match
  });
  // Each planned row stands behind ONE logged row only (test-agent finding B1, 2026-11-20): two logged
  // lines of one flower — two vendors, two old colours, or a shopper's own extra line — used to each take
  // the full planned qty, doubling the tab's planned total. Exact name+colour matches claim first (in
  // list order), then a name-only fallback may take a plan row nobody claimed; a row left without one
  // is unplanned ("extra").
  const covered = new Set(); // seed rows some logged row already stands for
  const claim = stored.map((r) => {
    if (!r || r.swapFor) return null;
    const s = byKey.get(mandiRowKey(r));
    if (s && !covered.has(s)) { covered.add(s); return s; }
    return null;
  });
  stored.forEach((r, i) => {
    if (!r || r.swapFor || claim[i]) return;
    const s = byName.get(nameKey(r.name));
    if (s && !covered.has(s)) { covered.add(s); claim[i] = s; }
  });
  const refreshed = stored.map((r, i) => {
    if (!r || r.swapFor) return r;
    const s = claim[i];
    if (!s) return (Number(r.projQty) || 0) > 0 || (Number(r.projCost) || 0) > 0 ? { ...r, projQty: 0, projCost: 0 } : r;
    const next = { ...r, projQty: Number(s.projQty) || 0, projCost: Number(s.projCost) || 0 };
    // Colour follows Deal Check too (it did before this helper, for an exact match only).
    next.colorVariant = s.colorVariant || null;
    next.colorPrefs = s.colorPrefs || null;
    return next;
  });
  const added = (append ? seed : [])
    .filter((s) => !covered.has(s) && !dismissed.has(mandiRowKey(s)))
    .map((s) => ({ ...s, qty: 0, newInPlan: true }));
  return added.length ? [...refreshed, ...added] : refreshed;
}

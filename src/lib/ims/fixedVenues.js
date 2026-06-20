// Fixed-venue calc helpers (Phase 2).
// A fixed venue owns "standing" inventory (specific items permanently installed).
// Reused standing items generate NO build labour and bill at a discount; anything
// built beyond the standing qty, a swapped design, or any other venue → full.
import { heavyExtraLabour } from "./constants";

// Resolve the fixed-venue config for a venue name (case-insensitive). null if not fixed.
export function fixedVenueFor(settings, venueName) {
  if (!venueName) return null;
  return (settings?.fixedVenues || []).find(
    (v) => (v.name || "").toLowerCase() === String(venueName).toLowerCase()
  ) || null;
}

// Standing qty of a specific inventory item at a venue (0 if venue isn't fixed or item isn't standing).
export function standingQty(settings, venueName, invId) {
  if (!invId) return 0;
  const fv = fixedVenueFor(settings, venueName);
  if (!fv) return 0;
  const it = (fv.items || []).find((i) => i.invId === invId);
  return it ? Number(it.qty) || 0 : 0;
}

// Discount % for a standing item (per-item override → venue default → 0).
export function standingDiscountPct(settings, venueName, invId) {
  const fv = fixedVenueFor(settings, venueName);
  if (!fv) return 0;
  const it = (fv.items || []).find((i) => i.invId === invId);
  if (!it) return 0;
  return Number(it.discountPct ?? fv.discountPct ?? 0) || 0;
}

// Qty of an inventory line that is "built fresh" this event = total minus what's standing here.
export function builtQty(settings, venueName, invId, qty) {
  return Math.max(0, (Number(qty) || 0) - standingQty(settings, venueName, invId));
}

// Split a line's qty into { standingUnits, freshUnits } for rental pricing at a venue.
export function rentalSplit(settings, venueName, invId, qty) {
  const total = Number(qty) || 0;
  const sQty = standingQty(settings, venueName, invId);
  const standingUnits = Math.min(total, sQty);
  return { standingUnits, freshUnits: total - standingUnits, discountPct: standingDiscountPct(settings, venueName, invId) };
}

// Derived location split for an inventory item: each fixed venue that holds a
// standing qty of this item, plus the remainder at the item's base location.
// Single source of truth = the fixed-venue config (no separate per-item storage).
export function locationBreakdown(settings, item) {
  const total = Number(item?.qty ?? item?.qtyOwned) || 0;
  const out = [];
  let allocated = 0;
  (settings?.fixedVenues || []).forEach((v) => {
    const it = (v.items || []).find((i) => i.invId === item?.id);
    const want = it ? Number(it.qty) || 0 : 0;
    if (want <= 0) return;
    const q = Math.min(want, Math.max(0, total - allocated));
    if (q > 0) { out.push({ loc: v.name, qty: q, fixed: true }); allocated += q; }
  });
  const remainder = Math.max(0, total - allocated);
  if (remainder > 0 || out.length === 0) {
    out.push({ loc: item?.loc || item?.location || "—", qty: remainder, fixed: false });
  }
  return out;
}

// Heavy-element extra labour for a function, netting out standing inventory at fixed venues.
// Returns { total, breakdown: string[] }.
export function heavyElementExtraForFn(fn, settings, inventory) {
  const venueName = fn?.venue?.name || fn?.venue || "";
  const items = fn?.items || [];
  let total = 0;
  const breakdown = [];
  (settings?.heavyElementRanges || []).forEach((her) => {
    let count = 0;
    items.forEach((it) => {
      const inv = (inventory || []).find((i) => i.id === it.invId);
      if (inv?.subCat !== her.subCat) return;
      count += builtQty(settings, venueName, it.invId, it.qty); // only what's freshly built
    });
    const ex = heavyExtraLabour(her, count);
    if (ex > 0) { total += ex; breakdown.push(`${her.subCat}: ${count} → +${ex}`); }
  });
  return { total, breakdown };
}

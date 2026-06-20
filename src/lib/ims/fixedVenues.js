// Fixed-venue calc helpers (Phase 2).
// A fixed venue owns "standing" inventory (specific items permanently installed).
// Reused standing items generate NO build labour and bill at a discount; anything
// built beyond the standing qty, a swapped design, or any other venue → full.
import { heavyExtraLabour } from "./constants";

// Normalize a venue name for matching: lowercase, drop a leading "Ambria ", trim.
function normVenue(s) { return String(s || "").toLowerCase().replace(/^ambria\s+/, "").trim(); }

// Sub-venue → parent map (e.g. Aura → Exotica). Stored by Studio; may be a JSON string.
function parentMap(settings) {
  let p = settings?.venueParents || {};
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = {}; } }
  return p || {};
}

// Resolve the fixed-venue config for a venue name. Parent-aware: a function at a
// sub-venue (Aura) matches a fixed venue keyed by its parent (Exotica / "Ambria
// Exotica"), with "Ambria " prefix ignored. null if not a fixed venue.
export function fixedVenueFor(settings, venueName) {
  if (!venueName) return null;
  const fvs = settings?.fixedVenues || [];
  if (!fvs.length) return null;
  const parents = parentMap(settings);
  const cands = [venueName];
  if (parents[venueName]) cands.push(parents[venueName]);
  const candNorms = cands.map(normVenue);
  return fvs.find((v) => candNorms.includes(normVenue(v.name))) || null;
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

// Units of an item AVAILABLE to an event at `venueName` = total minus units that are
// standing (installed) at OTHER fixed venues. So another venue can't book a venue's
// fixed stock; only genuinely free units (e.g. at Production House) are offered.
export function availableAtVenue(settings, venueName, item) {
  const total = Number(item?.qty ?? item?.qtyOwned) || 0;
  const own = fixedVenueFor(settings, venueName); // parent-aware "this venue"
  let lockedElsewhere = 0;
  (settings?.fixedVenues || []).forEach((v) => {
    if (own && v === own) return; // own venue → its standing stock is available here
    const it = (v.items || []).find((i) => i.invId === item?.id);
    if (it) lockedElsewhere += Number(it.qty) || 0;
  });
  return Math.max(0, total - lockedElsewhere);
}

// Total standing PILLARS installed at a fixed venue (sum across sizes) — drives the
// pillar-count truss-labour table (reused installed pillars add no truss labour).
export function standingPillarCount(settings, venueName) {
  const fv = fixedVenueFor(settings, venueName);
  if (!fv?.truss?.pillars) return 0;
  return Object.values(fv.truss.pillars).reduce((s, q) => s + (Number(q) || 0), 0);
}

// True if this item is part of `venueName`'s own standing inventory.
export function isStandingAt(settings, venueName, invId) {
  return standingQty(settings, venueName, invId) > 0;
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

// Standing-qty reduction per sub-category for a Studio Deal Check function, using the
// matched cards (which carry the inventory id) — so a reused standing design is netted
// but a swapped design (different id) is not. cards = { cardKey: { imsId, qty } }.
export function standingReductionBySubcat(settings, venueName, cards, inventory) {
  const out = {};
  Object.values(cards || {}).forEach((c) => {
    if (!c?.imsId) return;
    const inv = (inventory || []).find((i) => i.id === c.imsId);
    const sub = inv?.subCat ?? inv?.subcategory;
    if (!sub) return;
    const red = Math.min(Number(c.qty) || 0, standingQty(settings, venueName, c.imsId));
    if (red > 0) out[sub] = (out[sub] || 0) + red;
  });
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

// Fixed-venue calc helpers (Phase 2).
// A fixed venue owns "standing" inventory (specific items permanently installed).
// Reused standing items generate NO build labour and bill at a discount; anything
// built beyond the standing qty, a swapped design, or any other venue → full.
import { heavyExtraLabour } from "./constants";

// Normalize a venue name for matching: lowercase, drop a leading "Ambria ", trim, and drop
// trailing punctuation. The trailing-punctuation strip closes a real, confusing bug: a deal's own
// venue field read "Pushpanjali." (a stray trailing period, however it got typed) while the Fixed
// Venue was configured as "Pushpanjali" — lowercase + trim alone still leave "pushpanjali." !==
// "pushpanjali", so fixedVenueFor never matched, and every standing-item discount for that venue
// silently priced at full rate no matter how many times the element was removed and re-added. There
// was no error or warning anywhere — a byte-for-byte (mod case) name match was the only thing
// standing between "configured correctly" and "silently does nothing," which is far too fragile for
// something an admin free-types into a venue-name field. Stripping trailing .,;: closes the specific
// case found; it does not make the match fuzzy in general (a genuinely different venue name still
// won't match), just tolerant of stray end-of-string punctuation.
function normVenue(s) { return String(s || "").toLowerCase().replace(/^ambria\s+/, "").trim().replace(/[.,;:]+$/, "").trim(); }

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

// Discount % for a standing item (per-item override → global sub-category default → 0). The
// per-venue "Default discount" this used to fall back to is gone (FixedVenuesEditor.jsx) — every
// standing item now defaults from settings.fixedVenueSubcatDiscount, the same table the item's
// own "% off" field defaults from, matched by ITS OWN sub-category. `inventory` is optional only
// so existing callers that never pass it keep working (they just lose the sub-category fallback,
// same as before this change existed).
export function standingDiscountPct(settings, venueName, invId, inventory) {
  const fv = fixedVenueFor(settings, venueName);
  if (!fv) return 0;
  const it = (fv.items || []).find((i) => i.invId === invId);
  if (!it) return 0;
  if (typeof it.discountPct === "number") return it.discountPct;
  const inv = (inventory || []).find((i) => i.id === invId);
  const key = String(inv?.subCat || inv?.subcategory || "").toLowerCase().trim();
  const sc = key ? Number((settings?.fixedVenueSubcatDiscount || {})[key]) : NaN;
  return Number.isFinite(sc) && sc > 0 ? sc : 0;
}

// Qty of an inventory line that is "built fresh" this event = total minus what's standing here.
export function builtQty(settings, venueName, invId, qty) {
  return Math.max(0, (Number(qty) || 0) - standingQty(settings, venueName, invId));
}

// Split a line's qty into { standingUnits, freshUnits } for rental pricing at a venue.
export function rentalSplit(settings, venueName, invId, qty, inventory) {
  const total = Number(qty) || 0;
  const sQty = standingQty(settings, venueName, invId);
  const standingUnits = Math.min(total, sQty);
  return { standingUnits, freshUnits: total - standingUnits, discountPct: standingDiscountPct(settings, venueName, invId, inventory) };
}

// Raw-cost discount amount for a kit element's `qty` units, checking the kit's OWN base AND every
// component (recursively) against the venue's standing inventory — mirrors priceForInvItem's own
// recursion (lib/ims/helpers.js) node-for-node, but accumulates a discount instead of a price. A
// kit can have some pieces registered standing at a venue and others not (e.g. the console table
// itself plus 2 of its 3 decor components, but not the 3rd) — each registered piece contributes its
// OWN raw rate × its OWN discountPct × however many of THAT piece are actually standing here, not
// one blanket rate applied to the kit's total. Works entirely in raw-cost terms (kitBase/price, no
// scaling factor) so the caller can subtract this straight off the already-scaled unitRate×qty
// total without touching the markup, same reasoning as the plain-item fix beside this.
export function kitStandingDiscountAmount(item, qty, inventory, overrideSubItems, settings, venueName, _seen) {
  if (!item || !(Number(qty) > 0)) return 0;
  const isKit = Array.isArray(item.subItems) && item.subItems.length > 0;
  const rawRate = isKit ? (Number(item.kitBase) || 0) : (Number(item.price) || 0);
  const { standingUnits, discountPct } = rentalSplit(settings, venueName, item.id, qty, inventory);
  let discount = standingUnits * rawRate * discountPct / 100;
  if (!isKit) return discount;
  const seen = _seen ? new Set(_seen) : new Set();
  if (item.id) { if (seen.has(item.id)) return discount; seen.add(item.id); } // cycle guard, same as priceForInvItem
  const subItems = Array.isArray(overrideSubItems) ? overrideSubItems : (Array.isArray(item.subItems) ? item.subItems : []);
  subItems.forEach((si) => {
    if (si.patternId) return; // flower-recipe add-on — never a standing physical item
    const ci = (inventory || []).find((i) => i.id === si.itemId);
    if (!ci) return;
    const subOv = Array.isArray(si.subOverrides) ? si.subOverrides : undefined;
    discount += kitStandingDiscountAmount(ci, qty * (Number(si.qty) || 0), inventory, subOv, settings, venueName, seen);
  });
  return discount;
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

// This venue's own configured discount % (0 if it isn't a Fixed Venue, or has none set). Exported
// so a caller can stamp it onto its own per-function data once (see buildCombinedCostSheetData),
// letting a later re-derivation (e.g. an on-screen cost-sheet quantity edit) use proratedVenueDiscount
// below without needing the fixedVenues settings blob at all.
export function fixedVenueDiscountPctFor(settings, venueName) {
  const fv = fixedVenueFor(settings, venueName);
  return Number(fv?.discountPct) || 0;
}

// Pure proration, no settings lookup: given a list of { grand, discountPct } (already resolved),
// discount THAT item's own share of revenueTotal by its own discountPct and sum. This is the actual
// math both fixedVenueDealDiscount below and a from-scratch caller (holding only pre-resolved data)
// can share.
export function proratedVenueDiscount(items, revenueTotal) {
  let total = 0;
  (items || []).forEach((it) => { total += Number(it?.grand) || 0; });
  let discount = 0;
  (items || []).forEach((it) => {
    const pct = Number(it?.discountPct) || 0;
    if (pct > 0 && total > 0) {
      const share = (Number(it?.grand) || 0) / total;
      discount += Math.round((Number(revenueTotal) || 0) * share * pct / 100);
    }
  });
  return discount;
}

// Fixed-venue discount on the deal amount — a % off THIS venue's own share of the deal, when a
// function's venue is one of the Fixed Venues configured with a discountPct (Admin → Settings →
// Fixed Venues). For a booking spanning several venues, only the discounted venue's own share of
// the revenue is discounted, prorated the same way venue commission already is (fnGrandByVenue ÷
// total) — so a negotiated lump-sum revenue still discounts correctly even though it isn't itself
// split per venue. fns: per-function data (each carrying its own fnVenue); calcFnGrand(fn) → that
// function's own pre-fee client-facing total; revenueTotal: the deal amount (system total or
// negotiated override) this discount is a % of.
export function fixedVenueDealDiscount(settings, fns, calcFnGrand, revenueTotal) {
  const items = (fns || []).map((fn) => {
    let g = 0; try { g = calcFnGrand(fn) || 0; } catch { g = 0; }
    return { grand: g, discountPct: fixedVenueDiscountPctFor(settings, fn?.fnVenue || "") };
  });
  return proratedVenueDiscount(items, revenueTotal);
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

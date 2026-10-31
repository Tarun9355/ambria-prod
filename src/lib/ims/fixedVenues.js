// Fixed-venue calc helpers (Phase 2).
// A fixed venue owns "standing" inventory (specific items permanently installed).
// Reused standing items generate NO build labour and bill at a discount; anything
// built beyond the standing qty, a swapped design, or any other venue → full.
import { heavyExtraLabour } from "./constants";
import { walkKitUnits, kitDescendantIds } from "./helpers";

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

// A standing item can carry TWO buckets of qty: `qty` (gets this venue's own discountPct) and
// `fullQty` (also physically standing — no rebuild labour either — but always bills at the item's
// full rental rate, never discounted). `fullQty` is opt-in: an item added before this existed, or
// never given one, has fullQty 0 and keeps its exact old behavior (100% of its qty discounted).
const discQtyOf = (it) => Number(it?.qty) || 0;
const fullQtyOf = (it) => Number(it?.fullQty) || 0;
const totalQtyOf = (it) => discQtyOf(it) + fullQtyOf(it);

// Shared by FixedVenuesEditor.jsx (the sole writer) and every loader that used to read this array
// out of the `fixedVenues` settings-blob row (IMS.jsx, StudioApp.jsx) — the `fixed_venues` TABLE
// (migration 038) is the source of truth now, one row per fixed venue. These two just translate
// between that row shape and the plain-object shape every function in this file already expects,
// so none of that matching/availability logic had to change.
export const genFixedVenueId = () => "fv_" + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);

export function rowToFixedVenue(r) {
  return {
    id: r.id, name: r.name, propertyId: r.property_id || null,
    minLabour: r.min_labour != null ? Number(r.min_labour) : null,
    fixedCrew: (r.fixed_crew && typeof r.fixed_crew === "object") ? r.fixed_crew : {},
    truss: (r.truss && typeof r.truss === "object") ? r.truss : {},
    items: Array.isArray(r.items) ? r.items : [],
  };
}

export function assembleFixedVenuesFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(rowToFixedVenue);
}

// Legacy-shaped partial patch (as every FixedVenuesEditor.jsx call site already builds it) -> the
// DB columns it actually touches, for a plain row-level UPDATE.
export function fixedVenuePatchToRow(patch) {
  const row = {};
  if ("name" in patch) row.name = patch.name;
  if ("propertyId" in patch) row.property_id = patch.propertyId;
  if ("minLabour" in patch) row.min_labour = patch.minLabour;
  if ("fixedCrew" in patch) row.fixed_crew = patch.fixedCrew;
  if ("truss" in patch) row.truss = patch.truss;
  if ("items" in patch) row.items = patch.items;
  return row;
}

// Sub-venue → parent map (e.g. Aura → Exotica). Stored by Studio; may be a JSON string.
function parentMap(settings) {
  let p = settings?.venueParents || {};
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = {}; } }
  return p || {};
}

// A function's venue with its property in front — "Valencia › Poolside" rather than a bare
// "Poolside", which says nothing about where the event is. A property, an outdoor venue, an unknown
// name, or a sub-venue whose own name already carries its property ("Aura Poolside") stays as it is.
export function venueWithParent(settings, venueName) {
  const name = String(venueName || "").trim();
  if (!name) return "";
  const parent = String(parentMap(settings)[name] || "").trim();
  if (!parent || ` ${normVenue(name)} `.includes(` ${normVenue(parent)} `)) return name;
  return `${parent} › ${name}`;
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

// Standing qty of a specific inventory item at a venue (0 if venue isn't fixed or item isn't standing)
// — BOTH buckets combined (qty + fullQty): either one means the unit is already installed, so
// neither needs rebuild labour. Use standingDiscQty below for just the discount-eligible bucket.
export function standingQty(settings, venueName, invId) {
  if (!invId) return 0;
  const fv = fixedVenueFor(settings, venueName);
  if (!fv) return 0;
  const it = (fv.items || []).find((i) => i.invId === invId);
  return it ? totalQtyOf(it) : 0;
}

// Just the discount-ELIGIBLE bucket of a standing item (its `fullQty` sibling always bills full
// rate — see rentalSplit). 0 if the venue/item isn't standing at all.
export function standingDiscQty(settings, venueName, invId) {
  if (!invId) return 0;
  const fv = fixedVenueFor(settings, venueName);
  if (!fv) return 0;
  const it = (fv.items || []).find((i) => i.invId === invId);
  return it ? discQtyOf(it) : 0;
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

// ── STANDING STOCK IS POOLED ACROSS A FUNCTION'S ELEMENTS ──
// A venue's standing qty (50 chairs installed) covers the WHOLE function, not each element on its
// own: 30 in one zone and 30 in another is 60 chairs, 10 more than stand there, so 10 are carried.
// Netting each element against the full 50 separately (as builtQty alone does) carried none.
// `pool` is one Map per function-level calculation (new Map()); it remembers how much of each
// item's standing qty is already spoken for, and the kit share of the element being walked.
//
// A kit standing at a venue is the WHOLE kit: its parts (pots, books, candles) stand with it, but
// the Fixed Venue list registers only the kit's own id, so per-node netting carried every part in
// full. kitBuiltQty is called for each node of one kit walk (top = the element's kit, topQty = its
// qty; walkKitUnits visits the kit first, then its parts): the kit draws its standing units, and a
// part of the kit's own recipe takes the kit's fresh share (fresh kits / kits). The kit itself, a
// part swapped in for this deal (not in the master recipe) and a plain item are netted by their
// own standing qty only; a part registered on its own is netted by that as well, the smaller
// figure wins.
export function kitBuiltQty(pool, settings, venueName, top, topQty, node, nodeQty, inventory) {
  const q = Number(nodeQty) || 0;
  const draw = (id, n) => {
    const left = pool.has(id) ? pool.get(id) : standingQty(settings, venueName, id);
    const used = Math.min(left, n);
    pool.set(id, left - used);
    return n - used;
  };
  if (!top || !node || node.id === top.id) {
    const fresh = draw(node?.id, q);
    if (top && node && (Number(topQty) || 0) > 0) pool.set("ratio|" + top.id, fresh / (Number(topQty) || 1));
    return fresh;
  }
  const ownFresh = standingQty(settings, venueName, node.id) > 0 ? draw(node.id, q) : q;
  if (!(standingQty(settings, venueName, top.id) > 0)) return ownFresh;
  if (!kitDescendantIds(top, inventory).has(node.id)) return ownFresh;
  const ratio = pool.has("ratio|" + top.id) ? pool.get("ratio|" + top.id) : 1;
  return Math.min(ownFresh, q * ratio);
}

// Split a line's qty into { standingUnits, discUnits, fullStandingUnits, freshUnits } for rental
// pricing at a venue. standingUnits (both buckets) stays for callers that only ever cared whether
// ANY of this item is standing; discUnits is the slice of it that actually gets discountPct,
// fullStandingUnits the slice that's standing (no rebuild labour) but bills at full rate.
export function rentalSplit(settings, venueName, invId, qty, inventory) {
  const total = Number(qty) || 0;
  const sQty = standingQty(settings, venueName, invId);
  const sDisc = standingDiscQty(settings, venueName, invId);
  const standingUnits = Math.min(total, sQty);
  const discUnits = Math.min(standingUnits, sDisc);
  const fullStandingUnits = standingUnits - discUnits;
  return { standingUnits, discUnits, fullStandingUnits, freshUnits: total - standingUnits, discountPct: standingDiscountPct(settings, venueName, invId, inventory) };
}

// Units of an item AVAILABLE to an event at `venueName` = total minus units that are
// standing (installed) at OTHER fixed venues. So another venue can't book a venue's
// fixed stock; only genuinely free units (e.g. at Production House) are offered.
//
// `reservedByVenue` (optional — see reservedByVenueToday below): { [normalizedVenueName]: qty }
// genuinely reserved at each OTHER fixed venue on the SPECIFIC date being checked. Owner ask: a
// Fixed Venue's entire standing allocation used to count as permanently locked regardless of
// whether that venue actually has anything using it that day — an outdoor deal needing 120 units
// with 300 total stock (200 configured across fixed venues, 100 in the general/outdoor pool) was
// told only 100 were available even when, say, Pushpanjali's 200-unit allocation had only 195
// genuinely reserved that date, leaving 5 sitting idle. When `reservedByVenue` is supplied, only the
// ACTUALLY-reserved portion of each other venue's standing qty counts as locked, so that real slack
// becomes available stock the outdoor event can draw from. Omitted → exact old behavior (the whole
// configured allocation stays locked), so every caller that hasn't been updated to pass it is
// unaffected.
export function availableAtVenue(settings, venueName, item, reservedByVenue) {
  const total = Number(item?.qty ?? item?.qtyOwned) || 0;
  const own = fixedVenueFor(settings, venueName); // parent-aware "this venue"
  let lockedElsewhere = 0;
  (settings?.fixedVenues || []).forEach((v) => {
    if (own && v === own) return; // own venue → its standing stock is available here
    const it = (v.items || []).find((i) => i.invId === item?.id);
    if (!it) return;
    const standing = totalQtyOf(it);
    lockedElsewhere += reservedByVenue ? Math.min(standing, Number(reservedByVenue[normVenue(v.name)]) || 0) : standing;
  });
  return Math.max(0, total - lockedElsewhere);
}

// Combines a "today's date-blocks" ceiling (getStudioAvailable/dcAvailable's own view — total minus
// what's actually reserved for this date) with availableAtVenue's own ceiling (total minus the
// Fixed-Venue lock) into the TRUE remaining stock.
//
// Every call site used to do Math.min(dateAvailable, availableAtVenue(...)) — which is wrong once
// BOTH reductions are real at the same time: item has 50 total, 40 locked as Fixed Venue standing
// stock, and a SOLD deal has already blocked 10 of the unlocked remainder for today. dateAvailable =
// 50-10 = 40; availableAtVenue = 50-40 = 10; Math.min(40,10) = 10 — the system reports 10 still free
// to a second outdoor deal, when the true remainder (50-40-10) is 0. Math.min picks whichever single
// reduction is bigger and ignores the other one entirely, because each ceiling was computed
// independently off the FULL total rather than off what the other reduction already used up.
// Recovering each ceiling's own reduction against the shared total and subtracting both together
// fixes this without touching getStudioAvailable/dcAvailable/availableAtVenue themselves (every
// existing caller of those three keeps working exactly as before — this only recombines their
// outputs at the handful of sites that compose them).
export function combineAvailability(total, dateAvailable, venueAvailable) {
  const t = Number(total) || 0;
  const blockedByDate = Math.max(0, t - (Number(dateAvailable) || 0));
  const lockedAtVenue = Math.max(0, t - (Number(venueAvailable) || 0));
  return Math.max(0, t - blockedByDate - lockedAtVenue);
}

// Resolves each of `item`'s block entries active on the checked date back to the venue of the
// event that reserved them (blocks carry only {eventId, qty} — the venue lives on the linked
// event_orders row), and sums genuinely-reserved qty per Fixed Venue. `blockEntriesForItem` is
// `dealCheckData.blocksDetailByDate[date][item.id]` (StudioApp.jsx's fetchIMSData); `eventOrders` is
// Studio's own already-loaded event_orders list — no extra fetch needed. A block whose event can't
// be resolved (deleted, or a manual/legacy entry with no matching order) contributes nothing rather
// than being guessed at.
export function reservedByVenueToday(blockEntriesForItem, eventOrders) {
  const out = {};
  if (!Array.isArray(blockEntriesForItem) || !blockEntriesForItem.length) return out;
  const eoById = new Map((eventOrders || []).map((e) => [e.id, e]));
  blockEntriesForItem.forEach((b) => {
    const venueName = eoById.get(b?.eventId)?.venue;
    if (!venueName) return;
    const key = normVenue(venueName);
    out[key] = (out[key] || 0) + (Number(b?.qty) || 0);
  });
  return out;
}

// The genuine cross-venue slack availableAtVenue's `reservedByVenue` param newly unlocks, broken out
// per venue for DISPLAY — "5 free at Pushpanjali, 15 free at Exotica" instead of a single opaque
// number. Own venue excluded (already counted as this venue's own available stock, not "elsewhere").
// Only venues with real slack (> 0) are returned.
export function venueSlackFor(settings, venueName, item, reservedByVenue) {
  const own = fixedVenueFor(settings, venueName);
  const out = [];
  (settings?.fixedVenues || []).forEach((v) => {
    if (own && v === own) return;
    const it = (v.items || []).find((i) => i.invId === item?.id);
    const standing = it ? totalQtyOf(it) : 0;
    if (standing <= 0) return;
    const reserved = Number((reservedByVenue || {})[normVenue(v.name)]) || 0;
    const slack = Math.max(0, standing - reserved);
    if (slack > 0) out.push({ name: v.name, slack });
  });
  return out;
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
    const want = it ? totalQtyOf(it) : 0;
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
    if (!inv) return;
    const qty = Number(c.qty) || 0;
    if (qty <= 0) return;
    // Walk into kit components (master component list — this call site has no per-card kit-edit
    // override to thread through, same approximation effKitRental(item, null, null) already makes
    // for cross-function aggregates). A kit's own standing-stock credit used to apply only under
    // the KIT's own sub-category, so a sub-category reached only via a kit's inner part — every
    // component carries its own category, same as everywhere else kits are costed — never got any
    // manpower-tier reduction for being a reused standing design.
    walkKitUnits(inv, qty, inventory, undefined, (node, nodeQty) => {
      const sub = node?.subCat ?? node?.subcategory;
      if (!sub) return;
      const red = Math.min(nodeQty, standingQty(settings, venueName, node.id));
      if (red > 0) out[sub] = (out[sub] || 0) + red;
    });
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

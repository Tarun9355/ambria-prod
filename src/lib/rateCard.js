// Shared Rate Card helpers — used by both Studio (src/pages/studio/StudioApp.jsx, RateCard.jsx)
// and IMS (Rate Card → IMS migration Phase 3: IMS now has its own admin UI writing to the same
// `rate_card` table / `ambria-rccats-v1` settings key). Kept here, not duplicated per-app, so a
// change to the row shape or floral-mode logic only needs to happen once.

// `rate_card` TABLE row ↔ in-memory item. Full item lives in `data` (JSONB); typed columns are
// mirrored for queries. Falls back to reading typed columns for legacy rows with no `data`.
export function rowToRcItem(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  if (d) return { zones: [], ...d, id: row.id };
  return { id: row.id, name: row.name, cat: row.cat, sub: row.sub, unit: row.unit, inhouseMode: row.inhouse_mode, inhouseFlat: row.inhouse_flat, inhouseS: row.inhouse_s, inhouseM: row.inhouse_m, inhouseB: row.inhouse_b, outS: row.out_s, outM: row.out_m, outB: row.out_b, zones: Array.isArray(row.zones) ? row.zones : [], floralMode: row.floral_mode, defaultRealPct: row.default_real_pct };
}

export function rcItemToRow(it) {
  return {
    id: it.id, name: it.name || "", cat: it.cat ?? null, sub: it.sub ?? null, unit: it.unit ?? null,
    inhouse_mode: it.inhouseMode ?? "flat", inhouse_flat: Number(it.inhouseFlat) || 0,
    inhouse_s: Number(it.inhouseS) || 0, inhouse_m: Number(it.inhouseM) || 0, inhouse_b: Number(it.inhouseB) || 0,
    out_s: Number(it.outS) || 0, out_m: Number(it.outM) || 0, out_b: Number(it.outB) || 0,
    zones: Array.isArray(it.zones) ? it.zones : [], floral_mode: it.floralMode ?? null,
    default_real_pct: it.defaultRealPct ?? null, data: it,
  };
}

// Does this item price by Small/Medium/Big instead of one flat rate?
export const rcIsSMB = (rc) => rc && ((rc.inhouseS || 0) > 0 || (rc.inhouseM || 0) > 0 || (rc.inhouseB || 0) > 0 || rc.inhouseMode === "smb");

// Effective real/artificial pricing mode for a floral item: explicit per-item override, else the
// item's sub-category default (rate_card_categories.floral_mode, IMS-owned — optional 2nd arg, a
// { [subKey]: mode } map), else inferred from whether an artificial rate is set at all, else the
// global ratio slider. subFloralModeByKey is optional and additive — omitting it (existing callers
// that don't pass it) reproduces the exact prior behavior.
export function getFloralMode(rc, subFloralModeByKey) {
  if (!rc || (rc.cat || "").toLowerCase() !== "florals") return "ratio";
  if (rc.floralMode === "real" || rc.floralMode === "artificial") return rc.floralMode;
  const subKey = String(rc.sub || rc.imsAlias || "").trim().toLowerCase();
  const subMode = subKey ? subFloralModeByKey?.[subKey] : undefined;
  if (subMode === "real" || subMode === "artificial") return subMode;
  if (rc.floralMode === "ratio") return rc.floralMode;
  const hasArt = (rc.artificialFlat || 0) > 0 || (rc.artificialS || 0) > 0 || (rc.artificialM || 0) > 0 || (rc.artificialB || 0) > 0;
  if (!hasArt) return "ratio";
  const dp = typeof rc.defaultRealPct === "number" ? rc.defaultRealPct : (rc.unit === "truss_sqft" ? 0 : 100);
  return dp >= 50 ? "real" : "artificial";
}

// "Priced at cost%" (unavailable-shortfall pricing, Production/Buying reference pricing) — an
// item-level override (IMS Inventory's "Out of Stock Cost %" field, item.oosCostPct) wins whenever
// it's been set for that specific item; otherwise falls back to whatever the caller's own
// sub-category-only lookup returns (rate_card_categories.cost_percent, IMS → Admin → Settings →
// Sub-Categories — several independent copies of that exact lookup exist across the app, this just
// adds the per-item override on top of whichever one the caller already has in scope).
export function oosCostPctFor(item, subCatCostPctFn, fnDate, asOfDate) {
  // "Can be made" (IMS Inventory's checkbox, item.canBeMade) gates whether a shortfall on this
  // item gets priced at cost% AT ALL. An item nobody can actually produce more of has no "cost to
  // produce a fresh unit" to charge — returning 0% here, not skipping the caller, means every
  // existing `Math.max(floor, cost * pct/100)` shortfall formula across the app (Build, Deal
  // Check's rollup/pills, kitShortfallSplit) automatically floors to the plain owned/rental rate
  // with no code change at each call site — see canFulfillShortfall below, the one place that
  // reads item.canBeMade, so every consumer (this pricing floor, Build/Deal Check's "out of stock"
  // flag, the availability picker) agrees on what it means.
  if (!canFulfillShortfall(item, fnDate, asOfDate)) return 0;
  const raw = item?.oosCostPct;
  const v = Number(raw);
  if (raw !== null && raw !== undefined && raw !== "" && isFinite(v) && v >= 0) return v;
  return subCatCostPctFn(item?.subCat || item?.subcategory);
}
// Minimum lead time (days) production needs to actually make a fresh unit in time for the event —
// owner ask: "Can be made" was being honoured right up to the day of the function, which isn't
// physically true. Fewer than this many days out, a shortfall is NOT fulfillable regardless of the
// item's own flag, same as item.canBeMade === false.
const PRODUCTION_LEAD_DAYS = 10;

// Days from `asOfDate` (local midnight) to fnDate (local midnight) — Infinity when there's no
// fnDate to gate on at all, so a caller with no function context in scope (a generic admin view,
// etc.) sees the exact same "always enough lead time" behavior this had before the date gate
// existed. `asOfDate` defaults to the real current date — the live, continuously-shrinking lead
// time a pre-Sold build (or a brand-new pick made right now) should always be judged against.
function daysUntilDate(fnDate, asOfDate) {
  if (!fnDate) return Infinity;
  const target = new Date(`${fnDate}T00:00:00`);
  if (isNaN(target.getTime())) return Infinity;
  let from = asOfDate ? new Date(`${asOfDate}T00:00:00`) : new Date();
  if (isNaN(from.getTime())) from = new Date();
  from.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - from.getTime()) / 86400000);
}

// Can this item's shortfall be fulfilled by production/purchase at all? ONLY an item whose IMS Inventory
// "Can be made in production" box is ticked (item.canBeMade === true) is ever produced — owner rule.
// An unticked item, and one nobody has ticked yet (the field missing), is never made: a shortfall is
// never priced as production (oosCostPctFor above returns 0%, flooring to the plain rate), callers show
// "Out of stock" instead of a cost% badge, and the availability picker refuses to let it be picked while
// it's short. (Before 2026-10-23 a missing field counted as ticked; every item in IMS now has the field
// set except a handful, so those are the only ones that changed.)
//
// `fnDate` (optional, "YYYY-MM-DD") is the function's own date — even an item flagged "Can be
// made" can't actually be produced with fewer than PRODUCTION_LEAD_DAYS days left before the
// event, so that's treated exactly like canBeMade === false from here down. Omitted (no function
// context available to the caller) means no date gate at all, same as before this existed.
//
// `asOfDate` (optional, "YYYY-MM-DD") is WHEN this commitment to make the item was actually made —
// owner ask: the clock should not keep running against an already-booked deal just because the
// calendar moved on with nobody touching it. For an element already sitting in a SOLD deal's
// build, that's the element's own `addedAt` (frozen at the moment it was added — markSold bulk-
// stamps everything present at sale time to the sold date, so pre-existing items read from that
// moment; anything added to the deal afterward carries its own later `addedAt` instead). Omitted
// (a pre-Sold build, or evaluating a brand-new pick that doesn't exist yet) means "right now" —
// exactly the live, continuously-shrinking countdown a non-final draft should be judged against.
export function canFulfillShortfall(item, fnDate, asOfDate) {
  if (item?.canBeMade !== true) return false;
  return daysUntilDate(fnDate, asOfDate) >= PRODUCTION_LEAD_DAYS;
}

// Is this inventory item's sub-category flagged tag_hidden (rate_card_categories.tag_hidden, set in
// IMS Admin → Settings → Sub-Categories)? Mirrors the exact matching convention already used by
// StudioApp.jsx's AI-tagging vocabulary filter (rcSubcatFactors rows keyed by lowercased sub-cat
// string) — reused here so manual "+Add element" searches respect the same hidden flag. This always
// hides the raw inventory item, with no recipe exemption — a hidden sub-category's item whose flower
// recipe still needs to be addable surfaces instead as a pattern-only element (see
// recipeOnlyPatterns in StudioApp.jsx), not by un-hiding the physical item itself.
export function isHiddenSubcat(item, rcSubcatFactors) {
  const subKey = String(item?.subCat || item?.subcategory || "").trim().toLowerCase();
  if (!subKey) return false;
  const row = (rcSubcatFactors || []).find((r) => r.id === subKey);
  return !!row?.tag_hidden;
}

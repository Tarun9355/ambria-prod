// ═══ Shared floral cost engine — the ONE implementation of "what does this function's ═══
// ═══ florals actually cost", used by both StudioApp.jsx's calcFnFloralSourcingCost     ═══
// ═══ (feeds the FUNCTIONS sidebar, Dept Income, truck loading) and DCFloralsTab.jsx's  ═══
// ═══ own Florals tab (the per-element/per-flower "how" breakdown).                    ═══
//
// Before this module existed, those were two ~350-line hand-rolled copies of the same
// per-element resolution (invId/patternId/Rate-Card identity, real/artificial blend %,
// the repeat-zone quantity cut, kit sub-item expansion, real_only/mapping flower types,
// manual swap overrides) that drifted apart repeatedly — confirmed live: Mehendi showing
// ₹1,887 on the sidebar and ₹298 on the Florals tab for the SAME function, because the
// sidebar's copy and the tab's copy had each picked up fixes the other one missed.
//
// What stays OUTSIDE this module, by design, not oversight: the two callers deliberately
// want different final NUMBERS from the same per-flower aggregate —
//   - calcFnFloralSourcingCost re-prices the real side at whole mandi-bundle quantities
//     (owner ask: P&L must cost what will actually be PAID at the mandi, not a fractional
//     estimate) — see buildMandiBreakdown below, which both callers can use for that.
//   - DCFloralsTab.jsx shows the exact fractional need, because its job is to explain the
//     derivation precisely, not to state a purchase order.
// That split is intentional product behaviour, not drift, so it is left to each caller.
//
// ═══ Cross-function FLOWER reuse (2026-10-19 redesign) ═══
// Previously: a zone auto-reused at a flat ×0.2 real / ×0.7 artificial quantity whenever a
// same-day/adjacent-day, same-venue sibling function ALSO had a zone of the same KEY enabled —
// regardless of what flowers that sibling's zone actually held. Confirmed live on Taj Test
// Client: Mehendi's "stage" zone (Marigold String / genda) got the cut because Get Together's
// and Cocktail's "stage" zones existed too — but those held completely different flowers
// (Flower Reet, Greens Reet). The zone NAME matched; nothing physical actually did.
//
// Owner's replacement rule: reuse is now about the FLOWER PALETTE actually selected in Build
// (fn.fnFlowerPalette — the same field the artificial-bunch Colour Split already reads), not a
// zone key —
//   - Eligibility is gated PER PRECEDING FUNCTION: the single chronologically NEAREST earlier
//     function at the same venue, within the existing day-adjacency window (same day, or
//     exactly the day before) — not a merged pool of every eligible sibling.
//   - For colours present in BOTH functions' own selected palettes, a flower that the EXACT
//     SAME species+colour was also used for in the preceding function is credited 70% of that
//     preceding function's own (raw, uncredited) quantity — real and artificial alike. A flower
//     whose colour isn't in the overlap, or that the preceding function never actually had, is
//     NOT credited even if the zone/function is otherwise eligible.
//   - A zone's own manual ✨Fresh/♻️Repeat toggle (unchanged control) bypasses the PALETTE
//     overlap requirement — the salesperson has already said "treat this as reused" — but the
//     credit is still looked up by actual species+colour match against the preceding function;
//     it can never invent a saving for a flower that function never had.

import { matchFlowerPattern, sizeClassToPatternKey, normalizeSizeClass } from "../ims/flowerHelpers";
import { repeatCatFor, parseFlowerPalette, fuzzyColourMatch } from "./pricing";
import { shiftToTiming } from "./manpowerCount";

// The one reuse rate — credited the same way against both real (fresh) quantity and
// artificial-bunch-equivalent quantity, per the owner's own call (no separate real/artificial
// rates the way the old zone-key system had).
export const FLOWER_REUSE_RATE = 0.7;

const TIMING_ORDER = { brunch: 0, lunch: 1, sundowner: 2, dinner: 3 };
// A sortable (date, time-of-day) key: whole days apart dominate (×10), same-day ordering
// (brunch < lunch < sundowner < dinner) breaks ties within one day.
function fnSortKey(f) {
  const t = Date.parse(f?.fnDate || "");
  if (!Number.isFinite(t)) return null;
  const dayIndex = Math.round(t / 86400000);
  const timing = TIMING_ORDER[shiftToTiming(f?.fnShift)] ?? 3;
  return dayIndex * 10 + timing;
}

/**
 * The single chronologically NEAREST earlier function at the same venue as `fn`, within the
 * existing reuse-eligible window (same calendar day, or exactly the day before) — or null if
 * none exists. Deliberately NOT a merged pool of every eligible sibling (unlike
 * findCrossFnReuseSource, still used by truss/transport/inventory-qty reuse) — the owner's own
 * call for flower-palette reuse specifically: a function only ever looks at the ONE function
 * immediately before it, never further back.
 */
export function findImmediatePrecedingFn(fn, allFns) {
  if (!fn?.fnVenue || !fn?.fnDate) return null;
  const venue = fn.fnVenue.toLowerCase().trim();
  const myKey = fnSortKey(fn);
  if (myKey == null) return null;
  const myDay = Math.floor(myKey / 10);
  let best = null, bestKey = -Infinity;
  (allFns || []).forEach((f) => {
    if (f === fn || f.fnIdx === fn.fnIdx || !f.fnVenue || !f.fnDate) return;
    if (f.fnVenue.toLowerCase().trim() !== venue) return;
    const k = fnSortKey(f);
    if (k == null || k >= myKey) return; // must be strictly chronologically before fn
    const fDay = Math.floor(k / 10);
    if (myDay - fDay > 1) return; // same day or exactly one day before, same as every other reuse rule
    if (k > bestKey) { bestKey = k; best = f; }
  });
  return best;
}

const fnPaletteColors = (fn) => parseFlowerPalette(fn?.fnFlowerPalette || "").map((c) => c.name);

/** Colours present in BOTH functions' own selected palettes (exact match, case-insensitive —
 * NOT fuzzy: "White" and "Off-White" are deliberately different swatches here, unlike matching
 * a flower's own name against a palette colour below, which does want substring leniency). */
function paletteOverlapColors(fn, precedingFn) {
  const mine = fnPaletteColors(fn), theirs = fnPaletteColors(precedingFn);
  if (!mine.length || !theirs.length) return [];
  const theirsNorm = new Set(theirs.map((c) => c.toLowerCase().trim()));
  return mine.filter((c) => theirsNorm.has(c.toLowerCase().trim()));
}

/** Highest-ratio colour in this function's own Flower Palette (fn.fnFlowerPalette — the same
 * field the artificial-bunch Colour Split already reads), or null if no palette is set. */
function dominantPaletteColor(fn) {
  const colors = parseFlowerPalette(fn?.fnFlowerPalette || "");
  if (!colors.length) return null;
  let best = colors[0];
  for (const c of colors) if (c.pct > best.pct) best = c;
  return best.name;
}

/**
 * A flower with no EXPLICIT colour pick (see resolvedFlowerColour below) still defaults to this
 * function's own dominant Flower Palette colour, when the flower actually comes in a colour
 * variant that matches it — owner ask (2026-10-20): a salesperson shouldn't have to open the 🎨
 * picker on every single flower for reuse (or correct mandi pricing) to work; the palette they
 * already picked should apply to every real flower by default, and the picker is then only for
 * the flowers that should deviate from it. Returns the same ranked-row shape a manual pick
 * stores (so it can stand in for one anywhere that reads it), or null if there's no palette, or
 * this flower has no colour variants at all, or none of them match the dominant colour.
 */
function defaultColorPref(fn, parent) {
  const variants = Array.isArray(parent?.colorVariants) ? parent.colorVariants : [];
  if (!variants.length) return null;
  const dominant = dominantPaletteColor(fn);
  if (!dominant) return null;
  const match = variants.find((v) => fuzzyColourMatch(dominant, v.name || ""));
  if (!match) return null;
  return [{ variantId: match.variantId, label: match.name || "", photoUrl: match.photoUrl || null, rate: Number(match.currentPrice) || 0 }];
}

/**
 * The ranked colour-preference rows actually in effect for this flower on this function: an
 * explicit pick — or an explicit Clear-all, stored as [] by the 🎨 picker — always wins; only
 * when the key has never been touched at all (colorPrefsForFn[parentId] is undefined) does the
 * palette default above apply. That distinction is what stops the default from silently
 * reasserting itself over a salesperson's deliberate "no colour" clear.
 */
export function effectiveColorPrefRows(colorPrefsForFn, parentId, fn, parent) {
  const explicit = colorPrefsForFn?.[parentId];
  if (explicit !== undefined) return explicit;
  return defaultColorPref(fn, parent) || [];
}

/**
 * What colour was this specific flower (by its resolved mandi parentId) actually SET to for
 * this function — an explicit per-flower colour-preference ranking (1st choice), a manual swap
 * override, or (new) the function's own Flower Palette default — never by matching the species'
 * own catalogue name against the function's free-text Flower Palette label. Those are two
 * different vocabularies (a palette label like "White" or "Rose Gold" vs a bare species name
 * like "Carnation Himachal" or "Banglore Daisy") that essentially never textually coincide —
 * confirmed on a real build where every recipe referenced a bare species id with no colour
 * variant at all, so the species-name match this replaced could never succeed regardless of how
 * well the two functions' palettes actually overlapped. Returns null when this flower has no
 * resolvable colour at all (no pick, no override, no matching palette default) — never assumed
 * to match anything in that case.
 */
function resolvedFlowerColour(parentId, colorPrefsForFn, overrideByParentId, fn, parent) {
  if (!parentId) return null;
  const prefArr = effectiveColorPrefRows(colorPrefsForFn, parentId, fn, parent);
  if (Array.isArray(prefArr) && prefArr.length > 0 && prefArr[0]?.label) return prefArr[0].label;
  const override = overrideByParentId?.get(parentId);
  if (override?.colorVariant?.label) return override.colorVariant.label;
  return null;
}

/**
 * The raw (uncredited — no repeat cut of any kind applied) per-flower need for one function,
 * keyed by the EXACT recipe ingredient id (`fl.flowerId`, a bare mandi-catalogue parent id or a
 * specific colour-variant id — "same species AND colour" per the owner's own call) rather than
 * the resolved/collapsed parentId computeFnFloralCost's own flowerAgg uses for display. Used
 * ONLY to look up "how much of this exact flower did the PRECEDING function actually need" when
 * costing a later function's own reuse credit — never shown directly, so it skips everything
 * cost/trace/swap-override/income does not need: no realCost, no artCost, no elementBreakdown.
 */
export function computeFnRawFlowerUsage(fn, opts) {
  const {
    flowerPatterns = [], mandiCatalogue = [], rcItems = [], rcFloralModeByKey = {},
    resolveMandiFlower, imsInventory = [], dcInventoryCache = [], floralRatio = 70,
    // This function's OWN colour preferences (opts.colorPrefsForFn is scoped to whichever `fn` is
    // actually passed in here by the caller — computeFnFloralCost re-scopes it to the PRECEDING
    // function's own slice before calling this, since the credit needs to know what colour THAT
    // function's own flowers were actually picked as, not the later function's).
    colorPrefsForFn = {},
  } = opts || {};
  const fnOverrides = fn?.floralOverrides || { rows: [] };
  const overrideByParentId = new Map();
  (fnOverrides.rows || []).forEach((r) => { if (r?.flowerId) overrideByParentId.set(r.flowerId, r); });
  const findInv = (id) => (!id ? null : (imsInventory.find((i) => i.id === id) || (dcInventoryCache || []).find((i) => i.id === id)));
  const sizeFromMode = (inhouseMode, elSize) => {
    if (inhouseMode === "smb") { const s = (elSize || "M").toUpperCase(); return s === "S" ? "small" : s === "B" ? "big" : "medium"; }
    return "medium";
  };
  const fnFloralRatio = typeof fn?.floralRatio === "number" ? fn.floralRatio : (typeof floralRatio === "number" ? floralRatio : 70);
  const resolveRealPct = (el, rc, invItem, elPattern) => {
    if (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) return el.realPct;
    const subKey = String((invItem && (invItem.subCat || invItem.subcategory)) || elPattern?.sub || rc?.sub || rc?.imsAlias || "").trim().toLowerCase();
    const subMode = subKey ? rcFloralModeByKey?.[subKey] : undefined;
    if (subMode === "real") return 100;
    if (subMode === "artificial") return 0;
    if (!invItem && !elPattern) {
      const mode = String(rc?.floralMode || "").toLowerCase();
      if (mode === "real") return 100;
      if (mode === "artificial") return 0;
      if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
    }
    return Math.max(0, Math.min(100, 100 - fnFloralRatio));
  };

  const usage = new Map(); // fl.flowerId -> { realQty, artUnits, parent, variant, colour }
  const add = (flowerId, realQty, artUnits, parent, variant) => {
    const prev = usage.get(flowerId) || { realQty: 0, artUnits: 0, parent: null, variant: null, colour: null };
    prev.realQty += realQty; prev.artUnits += artUnits;
    if (!prev.parent && parent) prev.parent = parent;
    if (!prev.variant && variant) prev.variant = variant;
    if (!prev.colour) prev.colour = resolvedFlowerColour(parent?.id || flowerId, colorPrefsForFn, overrideByParentId, fn, parent);
    usage.set(flowerId, prev);
  };

  Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
    if (!fn.enabledEls?.[zk]) return;
    const expandedElems = [];
    (elems || []).forEach((el) => {
      expandedElems.push(el);
      const kitInvItem = findInv(el.invId);
      if (kitInvItem && Array.isArray(kitInvItem.subItems) && kitInvItem.subItems.length > 0) {
        const outerQty = el.qty || 0;
        (kitInvItem.subItems || []).forEach((si) => {
          const siQty = (Number(si.qty) || 0) * outerQty;
          if (siQty <= 0) return;
          if (si.patternId) { expandedElems.push({ name: `${el.name || kitInvItem.name} · recipe`, patternId: si.patternId, qty: siQty, size: el.size }); return; }
          const ci = findInv(si.itemId);
          if (ci && String(ci.cat || ci.category || "").toLowerCase() === "florals") expandedElems.push({ name: ci.name, invId: ci.id, qty: siQty, size: el.size });
        });
      }
    });
    expandedElems.forEach((el) => {
      const elName = (el.name || "").toLowerCase().trim();
      const elQty = el.qty || 0;
      let rc = rcItems.find((i) => (i.name || "").toLowerCase().trim() === elName);
      if (!rc && elName.length >= 4) {
        rc = rcItems.find((i) => {
          if (String(i.cat || "").toLowerCase() !== "florals") return false;
          const n = (i.name || "").toLowerCase().trim();
          return n && n.length >= 4 && (elName.includes(n) || n.includes(elName));
        });
      }
      const elPattern = el.patternId ? flowerPatterns.find((p) => p.id === el.patternId) : null;
      const invItem = findInv(el.invId);
      const pattern = elPattern
        || (invItem ? matchFlowerPattern(invItem, flowerPatterns) : null)
        || matchFlowerPattern({ subcategory: rc?.sub, name: rc?.name || el.name }, flowerPatterns);
      if (!pattern) return;
      const realPct = resolveRealPct(el, rc, invItem, elPattern);
      const realFrac = realPct / 100, artFrac = 1 - realFrac;
      const sizeKey = invItem ? sizeClassToPatternKey(normalizeSizeClass(el.size || "B")) : sizeFromMode(pattern?.mode || rc?.inhouseMode, el.size);
      const sizes = pattern.sizes || {};
      let comp = sizes[sizeKey] || sizes.medium;
      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
      if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
      if (!comp || !Array.isArray(comp.flowers)) return;
      comp.flowers.forEach((fl) => {
        if (fl.invItemId) return; // a physical rented prop, never a flower-reuse candidate
        const resolved = resolveMandiFlower(fl.flowerId, mandiCatalogue);
        const parent = resolved?.parent || null;
        const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
        const effRealFrac = flowerType === "real_only" ? 1 : realFrac;
        const effArtFrac = flowerType === "real_only" ? 0 : artFrac;
        const realQty = (fl.qty || 0) * elQty * effRealFrac;
        const artUnits = (fl.qty || 0) * elQty * effArtFrac;
        add(fl.flowerId, realQty, artUnits, parent, resolved?.variant || null);
      });
    });
  });
  return usage;
}

/**
 * Computes the full per-element / per-flower floral cost breakdown for one function.
 *
 * @param {object} fn - the function (from collectAllFunctionData()) to cost.
 * @param {object[]} allFns - every function in the booking (collectAllFunctionData()'s own
 *   return) — needed to find the immediately preceding function for reuse crediting.
 * @param {object} opts
 * @param {object[]} opts.flowerPatterns
 * @param {object[]} opts.mandiCatalogue
 * @param {object} opts.mandiMults - season → multiplier
 * @param {object} opts.seasonMap - fnDate → season key
 * @param {number} opts.floralRatio - deal-wide default real % fallback
 * @param {object[]} opts.rcItems - Rate Card rows
 * @param {object} opts.rcFloralModeByKey - sub-category key → "real"|"artificial" override
 * @param {function} opts.resolveMandiFlower
 * @param {object[]} opts.imsInventory - boot-time IMS inventory snapshot
 * @param {object[]} opts.dcInventoryCache - Deal Check's freshly-fetched inventory cache
 * @param {object} [opts.colorPrefsForFn] - parentId → ranked colour preference rows, for `fn` itself
 * @param {object} [opts.colorPrefsByFnIdx] - fnIdx → colorPrefsForFn, for every OTHER function —
 *   needed to look up the PRECEDING function's own colour pick per flower when crediting reuse
 *   (see computeFnRawFlowerUsage's own `colour` field)
 * @param {number} [opts.artFlowerRatePerKg]
 * @param {number} [opts.artFlowerBunchesPerKg]
 * @param {number} [opts.artGreenRatePerKg]
 * @param {number} [opts.artGreenBunchesPerKg]
 * @param {function} [opts.resolveRcRate] - (rc, sizeUpper) => {realRate, artRate}; only the
 *   billed-income figure needs this — omit it (the tab does) and income stays {real:0, art:0}.
 * @param {boolean} [opts.ignoreRepeatCuts] - internal: compute the fully-fresh, uncredited need
 *   with no reuse applied at all. Used by this function itself when it needs a PRECEDING
 *   function's own raw usage to credit against — that function's displayed/billed figure should
 *   never recursively depend on what's bought it ITS OWN preceding function, since the physical
 *   quantity standing at its own event is the full need regardless of how it was sourced.
 */
export function computeFnFloralCost(fn, allFns, opts) {
  const {
    flowerPatterns = [], mandiCatalogue = [], mandiMults = {}, seasonMap = {},
    floralRatio = 70, rcItems = [], rcFloralModeByKey = {}, resolveMandiFlower,
    imsInventory = [], dcInventoryCache = [], colorPrefsForFn = {}, colorPrefsByFnIdx = {},
    artFlowerRatePerKg = 50, artFlowerBunchesPerKg = 16,
    artGreenRatePerKg = 40, artGreenBunchesPerKg = 23,
    resolveRcRate = null, ignoreRepeatCuts = false,
  } = opts || {};
  const artFlowerBPK = artFlowerBunchesPerKg || 16;
  const artGreenBPK = artGreenBunchesPerKg || 23;
  const flowerPerBunchRate = artFlowerRatePerKg / artFlowerBPK;
  const greenPerBunchRate = artGreenRatePerKg / artGreenBPK;
  const fnFloralRatio = typeof fn?.floralRatio === "number" ? fn.floralRatio : (typeof floralRatio === "number" ? floralRatio : 70);
  const sizeFromMode = (inhouseMode, elSize) => {
    if (inhouseMode === "smb") { const s = (elSize || "M").toUpperCase(); return s === "S" ? "small" : s === "B" ? "big" : "medium"; }
    return "medium";
  };
  // Build's own precedence: an element's OWN identity (invItem's sub-category, then its
  // recipe pattern's sub-category) decides the default real/artificial split; a Rate Card
  // row is only consulted when NEITHER identity exists, since a coincidental name-match
  // there is not what Build itself priced the element with.
  const resolveRealPct = (el, rc, invItem, elPattern) => {
    if (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) return el.realPct;
    const subKey = String((invItem && (invItem.subCat || invItem.subcategory)) || elPattern?.sub || rc?.sub || rc?.imsAlias || "").trim().toLowerCase();
    const subMode = subKey ? rcFloralModeByKey?.[subKey] : undefined;
    if (subMode === "real") return 100;
    if (subMode === "artificial") return 0;
    if (!invItem && !elPattern) {
      const mode = String(rc?.floralMode || "").toLowerCase();
      if (mode === "real") return 100;
      if (mode === "artificial") return 0;
      if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
    }
    return Math.max(0, Math.min(100, 100 - fnFloralRatio));
  };
  const findInv = (id) => !id ? null : (imsInventory.find(i => i.id === id) || (dcInventoryCache || []).find(i => i.id === id));

  // ── Cross-function flower-palette reuse: resolved ONCE per function, not per zone ──
  let precedingFn = null, overlapColors = [], precedingUsage = null;
  if (!ignoreRepeatCuts) {
    precedingFn = findImmediatePrecedingFn(fn, allFns || []);
    if (precedingFn) {
      overlapColors = paletteOverlapColors(fn, precedingFn);
      // The preceding function's OWN colour picks, not fn's — computeFnRawFlowerUsage resolves
      // each flower's `colour` field against whichever colorPrefsForFn it's handed.
      const precedingColorPrefs = colorPrefsByFnIdx?.[precedingFn.fnIdx] || {};
      precedingUsage = computeFnRawFlowerUsage(precedingFn, { ...opts, colorPrefsForFn: precedingColorPrefs });
    }
  }

  const flowerAgg = new Map();
  const elementBreakdown = [];
  const uncosted = [];
  let totalReal = 0, totalArtificial = 0, realIncome = 0, artIncome = 0, fixedExtras = 0;
  let artFlowerBunches = 0, artGreenBunches = 0, artFlowerBunchesFull = 0, artGreenBunchesFull = 0;

  const fnOverrides = fn?.floralOverrides || { rows: [] };
  const overrideByParentId = new Map();
  (fnOverrides.rows || []).forEach(r => { if (r?.flowerId) overrideByParentId.set(r.flowerId, r); });

  Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
    if (!fn.enabledEls?.[zk]) return;
    // The Elements chip, not the zone toggle alone (RC-30) — the flowers are elements. This
    // manual toggle bypasses the palette-overlap requirement below (the salesperson has
    // already declared the zone reused); it never bypasses the per-flower identity match,
    // which still only ever credits a flower the preceding function actually had.
    const manualRepeat = repeatCatFor(fn.zoneConfig?.[zk], "elements");
    const autoEligible = overlapColors.length > 0;
    const zoneRepeat = manualRepeat || autoEligible;
    const repeatLabel = manualRepeat ? "set to Repeat in Build"
      : autoEligible ? `carried over from ${precedingFn.fnType || "another function"} — shared palette colour${overlapColors.length > 1 ? "s" : ""}: ${overlapColors.join(", ")}`
      : null;

    // A kit's own subItems can carry floral content of their own — a flower-recipe add-on
    // (si.patternId, e.g. a floral topper baked into a stage kit) or a component item that is
    // itself categorized as florals. Neither ever reached this tab before: the loop below only
    // ever looked at the outer element's own invId/patternId/name, so a kit's floral pieces
    // were priced correctly (Build's getElPrice already folds kitFloralCompDelta/
    // attachedPatterns into the rental line) but never itemized here.
    const expandedElems = [];
    (elems || []).forEach(el => {
      expandedElems.push(el);
      const kitInvItem = findInv(el.invId);
      if (kitInvItem && Array.isArray(kitInvItem.subItems) && kitInvItem.subItems.length > 0) {
        const outerQty = el.qty || 0;
        (kitInvItem.subItems || []).forEach(si => {
          const siQty = (Number(si.qty) || 0) * outerQty;
          if (siQty <= 0) return;
          if (si.patternId) { expandedElems.push({ name: `${el.name || kitInvItem.name} · recipe`, patternId: si.patternId, qty: siQty, size: el.size, _kitParent: el.name || kitInvItem.name }); return; }
          const ci = findInv(si.itemId);
          if (ci && String(ci.cat || ci.category || "").toLowerCase() === "florals") expandedElems.push({ name: ci.name, invId: ci.id, qty: siQty, size: el.size, _kitParent: el.name || kitInvItem.name });
        });
      }
    });

    expandedElems.forEach(el => {
      const elName = (el.name || "").toLowerCase().trim();
      const elQty = el.qty || 0;
      // Both the exact match and the substring fallback are scoped to the Rate Card's OWN
      // florals category — an exact name coincidence with a lighting/furnishing/other Rate
      // Card row (e.g. a "Warm LED" or "Sethi Bolster" element) used to slip through here
      // un-scoped, dragging that non-floral element into this florals cost/income breakdown
      // (and, when resolveRcRate was supplied, into realIncome/artIncome too) purely because
      // its name happened to match SOME Rate Card row, in any category.
      let rc = rcItems.find(i => String(i.cat || "").toLowerCase() === "florals" && (i.name || "").toLowerCase().trim() === elName);
      // Both names need ≥4 chars before substring matching — a short name like "T" or "Pot"
      // can spuriously substring-match an unrelated florals Rate Card row otherwise.
      if (!rc && elName.length >= 4) {
        rc = rcItems.find(i => {
          if (String(i.cat || "").toLowerCase() !== "florals") return false;
          const n = (i.name || "").toLowerCase().trim();
          return n && n.length >= 4 && (elName.includes(n) || n.includes(elName));
        });
      }
      const elPattern = el.patternId ? flowerPatterns.find(p => p.id === el.patternId) : null;
      const invItem = findInv(el.invId);
      const invIsFloral = !!invItem && String(invItem.cat || invItem.category || "").toLowerCase() === "florals";
      let pattern = elPattern
        || (invItem ? matchFlowerPattern(invItem, flowerPatterns) : null)
        || matchFlowerPattern({ subcategory: rc?.sub, name: rc?.name || el.name }, flowerPatterns);
      // A real, resolvable IMS inventory item that is NOT in the florals category (lighting,
      // furnishing, etc.) — definitively not a floral element, skip it silently. This is the
      // other half of the same bug as the rc scoping above: el.invId resolving to a known,
      // non-floral item used to be treated as "identified" and fall through to the per-element
      // breakdown with hasPattern:false, surfacing a "⚠ No IMS pattern" warning on something
      // that was never a floral element in the first place (a lighting fixture, a cushion
      // cover, a bolster — none of these have or need a flower recipe).
      if (invItem && !invIsFloral) return;
      if (!rc && !elPattern && !invItem && !pattern) {
        uncosted.push({ name: el.name || "(unnamed)", zoneKey: zk, qty: elQty, reason: "No rate-card entry or recipe" });
        return;
      }
      const realPct = resolveRealPct(el, rc, invItem, elPattern);
      const realFrac = realPct / 100;
      const artFrac = 1 - realFrac;
      const sizeKey = invItem ? sizeClassToPatternKey(normalizeSizeClass(el.size || "B")) : sizeFromMode(pattern?.mode || rc?.inhouseMode, el.size);

      // Billed income split (real portion at the inhouse rate, artificial at the artificial
      // rate) — only computed when the caller supplies resolveRcRate (the sourcing-cost
      // rollup needs it for Dept Income; the Florals tab's own display does not).
      if (rc && resolveRcRate) {
        const szU = String(el.size || "").toUpperCase();
        const { realRate: rr, artRate: ar } = resolveRcRate(rc, szU);
        realIncome += elQty * realFrac * rr; artIncome += elQty * artFrac * ar;
      }

      const realLines = [];
      const invItemLines = [];
      let patternExtraCost = 0;
      if (!pattern) {
        // Floral by identity but nothing to price it by — recorded, not dropped, so the
        // money is traceable to "priced as plain rental elsewhere" instead of silently lost.
        elementBreakdown.push({ name: el.name, zoneKey: zk, qty: elQty, realPct, realCost: 0, artCost: 0, total: 0, hasPattern: false, realLines: [], size: sizeKey, artLines: [], artBunchesFlower: 0, artBunchesGreen: 0, artBunchesFlowerFull: 0, artBunchesGreenFull: 0, flowerPerBunchRate, greenPerBunchRate, isInvOnlyNoPattern: invIsFloral, repeatZone: zoneRepeat, repeatLabel });
        return;
      }
      const sizes = pattern.sizes || {};
      let comp = sizes[sizeKey] || sizes.medium;
      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
      if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
      if (comp) patternExtraCost = (Number(comp.extraCost) || 0) * elQty;
      if (patternExtraCost > 0) { fixedExtras += patternExtraCost; if (resolveRcRate) realIncome += patternExtraCost; }
      const season = seasonMap[fn.fnDate] || "non_saya";
      const seasonMult = mandiMults[season] || 1;
      // ── REAL SIDE ── one pass per recipe ingredient: fresh-flower qty/cost + the shared
      // flowerAgg (mandi shopping list) + inventory-sourced pieces (always full, no blend).
      if (comp && Array.isArray(comp.flowers)) {
        comp.flowers.forEach(fl => {
          if (fl.invItemId) {
            const item = findInv(fl.invItemId);
            const rawPrice = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
            const totalQty = (fl.qty || 0) * elQty;
            const lineCost = totalQty * rawPrice;
            invItemLines.push({ flowerId: fl.invItemId, name: item?.name || "Inventory item", perPattern: fl.qty || 0, qty: totalQty, unit: item?.unit || "pc", unitPrice: rawPrice, lineCost, realUnitsReplaced: 0, bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: 0, missingRatio: false, realOnly: true, invItem: true });
            return;
          }
          const resolved = resolveMandiFlower(fl.flowerId, mandiCatalogue);
          const parent = resolved?.parent || null;
          const parentId = parent?.id || fl.flowerId;
          const override = overrideByParentId.get(parentId);
          const prefArr = effectiveColorPrefRows(colorPrefsForFn, parentId, fn, parent);
          const prefRate = Array.isArray(prefArr) && prefArr.length > 0 ? Number(prefArr[0].rate) : 0;
          const variantRate = Number(override?.colorVariant?.rate) || 0;
          const basePrice = prefRate > 0 ? prefRate : variantRate > 0 ? variantRate : (Number(parent?.currentPrice) || 0);
          const unitPrice = (prefRate > 0 || variantRate > 0) ? basePrice : basePrice * seasonMult;
          const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          const effectiveRealFrac = flowerType === "real_only" ? 1 : realFrac;
          const totalFlowerQtyFull = (fl.qty || 0) * elQty * effectiveRealFrac;
          // Reuse credit: the manual toggle credits by SPECIES identity alone (fl.flowerId found
          // in the preceding function's own raw usage) — see this function's own top comment. The
          // automatic path additionally requires an explicit, MATCHING colour preference on this
          // exact flower in both functions (resolvedFlowerColour, Deal Check's own per-flower
          // colour picker) — never a match against the species' own catalogue name, which a real
          // build's recipes never carry any colour on at all (bare species ids throughout), so
          // that comparison could never succeed regardless of how well the two functions'
          // declared palettes overlapped.
          const pUsage = precedingUsage?.get(fl.flowerId) || null;
          const myColour = resolvedFlowerColour(parentId, colorPrefsForFn, overrideByParentId, fn, parent);
          const colorEligible = manualRepeat || (autoEligible && !!pUsage && !!myColour && !!pUsage.colour && fuzzyColourMatch(myColour, pUsage.colour));
          const reuseCredit = (colorEligible && pUsage) ? FLOWER_REUSE_RATE * pUsage.realQty : 0;
          const totalFlowerQty = Math.max(0, totalFlowerQtyFull - reuseCredit);
          const lineCost = totalFlowerQty * unitPrice;
          const displayName = parent?.name || fl.flowerId;
          realLines.push({ flowerId: parentId, name: displayName, perPattern: fl.qty || 0, qty: totalFlowerQty, qtyFull: totalFlowerQtyFull, reuseCredit, unit: parent?.unit || "kg", unitPrice, lineCost, realOnly: flowerType === "real_only", variantPicked: override?.colorVariant?.label || null });
          if (totalFlowerQty > 0 && parent) {
            // colorVariant/colorPrefs (distinct from realLines' own `variantPicked` display label
            // above): which colour IMS's mandi list should show a reference photo for — the ranked
            // preference's 1st choice if one was picked, else a legacy single colour-variant
            // override. colorPrefs carries the FULL ranked list (2nd/3rd choice) alongside it, so
            // IMS can say "if 1st choice isn't at the mandi today, here's the next one".
            const rowColorVariant = Array.isArray(prefArr) && prefArr.length > 0 ? prefArr[0] : (override?.colorVariant || null);
            const rowColorPrefs = Array.isArray(prefArr) && prefArr.length > 1 ? prefArr : null;
            const prev = flowerAgg.get(parentId) || { flowerId: parentId, name: displayName, totalQty: 0, totalQtyFull: 0, totalCost: 0, unit: parent?.unit || "kg", unitPrice, contributors: [], realOnly: flowerType === "real_only", flowerType, variantPicked: override?.colorVariant || null, colorVariant: null, colorPrefs: null };
            prev.totalQty += totalFlowerQty;
            prev.totalQtyFull += totalFlowerQtyFull;
            prev.totalCost += totalFlowerQty * unitPrice;
            prev.unitPrice = prev.totalQty > 0 ? prev.totalCost / prev.totalQty : unitPrice;
            prev.variantPicked = override?.colorVariant || prev.variantPicked;
            if (rowColorVariant && !prev.colorVariant) prev.colorVariant = rowColorVariant;
            if (rowColorPrefs && !prev.colorPrefs) prev.colorPrefs = rowColorPrefs;
            prev.contributors.push({ elName: el.name, zoneKey: zk, elQty, perPattern: fl.qty || 0, realFrac: effectiveRealFrac, contribution: totalFlowerQty, repeatZone: zoneRepeat, reuseCredit, repeatLabel, size: sizeKey, realOnly: flowerType === "real_only" });
            flowerAgg.set(parentId, prev);
          }
        });
      }
      // ── ARTIFICIAL SIDE ── a separate pass, gated on artFrac > 0: real_only flowers are
      // skipped (100% real regardless of the element's own blend), everything else converts
      // its replaced real-flower quantity into artificial bunches/cost.
      const artLines = [];
      let artBunchesFlowerFull = 0, artBunchesGreenFull = 0;
      if (artFrac > 0 && comp && Array.isArray(comp.flowers)) {
        comp.flowers.forEach(fl => {
          if (fl.invItemId) return; // physical prop — already counted on the real side, in full
          const resolved = resolveMandiFlower(fl.flowerId, mandiCatalogue);
          const parent = resolved?.parent || null;
          const parentId = parent?.id || fl.flowerId;
          const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          if (flowerType === "real_only") {
            artLines.push({ flowerId: parentId, name: parent?.name || fl.flowerId, realUnitsReplaced: 0, unit: parent?.unit || "?", bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: 0, lineCost: 0, missingRatio: false, realOnly: true });
            return;
          }
          const pUsage = precedingUsage?.get(fl.flowerId) || null;
          const myColour = resolvedFlowerColour(parentId, colorPrefsForFn, overrideByParentId, fn, parent);
          const colorEligible = manualRepeat || (autoEligible && !!pUsage && !!myColour && !!pUsage.colour && fuzzyColourMatch(myColour, pUsage.colour));
          const artReuseCredit = (colorEligible && pUsage) ? FLOWER_REUSE_RATE * pUsage.artUnits : 0;
          if (flowerType === "mapping") {
            const realUnitsReplacedFull = (fl.qty || 0) * elQty * artFrac;
            const realUnitsReplaced = Math.max(0, realUnitsReplacedFull - artReuseCredit);
            const mapCost = Number(parent?.artificialMapCost) || 0;
            const lineCost = realUnitsReplaced * mapCost;
            artLines.push({ flowerId: parentId, name: parent?.name || fl.flowerId, realUnitsReplaced, unit: parent?.unit || "?", bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: mapCost, lineCost, missingRatio: mapCost <= 0, realOnly: false, isMapped: true, mappedName: parent?.artificialMapName || null });
            return;
          }
          const bunchesPerUnit = Number(parent?.artificialBunchesPerUnit) || 0;
          const realUnitsReplacedFull = (fl.qty || 0) * elQty * artFrac;
          const realUnitsReplaced = Math.max(0, realUnitsReplacedFull - artReuseCredit);
          const bunches = realUnitsReplaced * bunchesPerUnit;
          const bunchesFull = realUnitsReplacedFull * bunchesPerUnit;
          const isGreen = flowerType === "green";
          if (isGreen) { artGreenBunches += bunches; artGreenBunchesFull += bunchesFull; artBunchesGreenFull += bunchesFull; }
          else { artFlowerBunches += bunches; artFlowerBunchesFull += bunchesFull; artBunchesFlowerFull += bunchesFull; }
          const perBunch = isGreen ? greenPerBunchRate : flowerPerBunchRate;
          artLines.push({ flowerId: parentId, name: parent?.name || fl.flowerId, realUnitsReplaced, unit: parent?.unit || "?", bunchesPerUnit, bunches, isGreen, perBunch, lineCost: bunches * perBunch, missingRatio: bunchesPerUnit <= 0, realOnly: false });
        });
      }
      // Inventory ingredients join the ARTIFICIAL total outside the artFrac gate — a
      // manufactured piece is never fresh, and it goes out whatever the blend says.
      artLines.push(...invItemLines);
      const realCost = realLines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + patternExtraCost;
      const artCost = artLines.reduce((s, l) => s + (l.lineCost || 0), 0);
      totalReal += realCost;
      totalArtificial += artCost;
      elementBreakdown.push({
        name: el.name, zoneKey: zk, qty: elQty, realPct, realCost, artCost, total: realCost + artCost,
        hasPattern: !!pattern, realLines, size: sizeKey, artLines,
        artBunchesFlower: artLines.filter(l => !l.isGreen).reduce((s, l) => s + (l.bunches || 0), 0),
        artBunchesGreen: artLines.filter(l => l.isGreen).reduce((s, l) => s + (l.bunches || 0), 0),
        artBunchesFlowerFull, artBunchesGreenFull,
        flowerPerBunchRate, greenPerBunchRate,
        isInvOnlyNoPattern: false,
        repeatZone: zoneRepeat, repeatLabel,
      });
    });
  });

  // Manual flower swaps (Deal Check's 🔄 swap button) — divert quantity from one flower's
  // aggregate to another's.
  (fnOverrides.rows || []).forEach(override => {
    if (!override?.swapTo) return;
    const fromAgg = flowerAgg.get(override.swapTo.fromParentId);
    if (!fromAgg) return;
    const swapQty = Number(override.swapTo.qty) || 0;
    const isSplit = !!override.swapTo.isSplit;
    if (swapQty <= 0) return;
    const effectiveFromRate = Number(fromAgg.unitPrice) || 0;
    if (isSplit) {
      fromAgg.totalQtyFull = Math.max(0, (fromAgg.totalQtyFull ?? fromAgg.totalQty) - swapQty);
      fromAgg.totalQty = Math.max(0, fromAgg.totalQty - swapQty);
      fromAgg.totalCost = Math.max(0, (fromAgg.totalCost ?? (fromAgg.totalQty + swapQty) * effectiveFromRate) - swapQty * effectiveFromRate);
      if (fromAgg.totalQty <= 0.0001) flowerAgg.delete(override.swapTo.fromParentId);
    } else {
      flowerAgg.delete(override.swapTo.fromParentId);
    }
    const targetParent = resolveMandiFlower(override.swapTo.toParentId, mandiCatalogue)?.parent;
    if (!targetParent) return;
    const targetId = targetParent.id;
    const targetRate = override.swapTo.toRate || targetParent.currentPrice || 0;
    const targetFlowerType = targetParent.flowerType || (targetParent.isGreen ? "green" : "flower");
    const newQty = swapQty;
    const existing = flowerAgg.get(targetId);
    if (existing) {
      existing.totalCost = (existing.totalCost ?? existing.totalQty * existing.unitPrice) + newQty * targetRate;
      existing.totalQty += newQty;
      existing.unitPrice = existing.totalQty > 0 ? existing.totalCost / existing.totalQty : targetRate;
      existing.totalQtyFull = (existing.totalQtyFull ?? existing.totalQty - newQty) + newQty;
      existing.contributors.push({ elName: "↪ swapped from " + (override.swapTo.fromName || ""), zoneKey: "—", elQty: 1, perPattern: newQty, realFrac: 1, contribution: newQty, size: "—", realOnly: targetFlowerType === "real_only", isSwap: true });
    } else {
      flowerAgg.set(targetId, {
        flowerId: targetId, name: targetParent.name, totalQty: newQty, totalQtyFull: newQty, totalCost: newQty * targetRate,
        unit: targetParent.unit || "kg", unitPrice: targetRate,
        contributors: [{ elName: "↪ swapped from " + (override.swapTo.fromName || ""), zoneKey: "—", elQty: 1, perPattern: newQty, realFrac: 1, contribution: newQty, size: "—", realOnly: targetFlowerType === "real_only", isSwap: true }],
        realOnly: targetFlowerType === "real_only", flowerType: targetFlowerType, variantPicked: null, _isSwapTarget: true,
      });
    }
    totalReal -= swapQty * effectiveFromRate;
    totalReal += newQty * targetRate;
  });

  return {
    elementBreakdown, flowerAgg, uncosted, fixedExtras,
    totalReal, totalArtificial, grandTotal: totalReal + totalArtificial,
    income: { real: realIncome, art: artIncome },
    artFlowerBunches, artGreenBunches, artFlowerBunchesFull, artGreenBunchesFull,
    precedingFn, overlapColors,
  };
}

/**
 * The mandi shopping list: flowerAgg's fractional per-flower need, rounded UP to whole
 * purchasable units (owner ask — P&L must cost what will actually be PAID at the mandi,
 * not a fractional estimate) with the rate rounded first so qty×rate always matches the
 * displayed cost exactly.
 */
export function buildMandiBreakdown(flowerAgg) {
  const fbreak = {};
  flowerAgg.forEach(v => {
    if (!(v.totalQty > 0)) return;
    const cost = v.totalCost != null ? v.totalCost : v.totalQty * v.unitPrice;
    if (!fbreak[v.name]) fbreak[v.name] = { name: v.name, qty: 0, cost: 0, unit: v.unit, colorVariant: v.colorVariant || null, colorPrefs: v.colorPrefs || null };
    fbreak[v.name].qty += v.totalQty; fbreak[v.name].cost += cost;
    // A same-name collision (two different flowerIds sharing one display name) must not let
    // whichever one happened to be processed FIRST permanently decide the colour for both —
    // the first one may have no colour picked at all while a later one does.
    if (v.colorVariant && !fbreak[v.name].colorVariant) fbreak[v.name].colorVariant = v.colorVariant;
    if (v.colorPrefs && !fbreak[v.name].colorPrefs) fbreak[v.name].colorPrefs = v.colorPrefs;
  });
  return Object.values(fbreak).map(f => {
    const rate = f.qty > 0 ? Math.round((f.cost / f.qty) * 100) / 100 : 0;
    const qty = Math.ceil(f.qty);
    return { ...f, qty, rate, cost: Math.round(qty * rate) };
  }).sort((a, b) => b.cost - a.cost);
}

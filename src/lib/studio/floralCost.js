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
// sidebar's copy and the tab's copy had each picked up fixes the other one missed (most
// recently: this exact Mehendi booking's automatic cross-function reuse cut applying in
// one and not the other). Extracting the shared half here means a fix to "how a floral
// element is costed" only has one place to land, and both screens inherit it together.
//
// What stays OUTSIDE this module, by design, not oversight: the two callers deliberately
// want different final NUMBERS from the same per-flower aggregate —
//   - calcFnFloralSourcingCost re-prices the real side at whole mandi-bundle quantities
//     (owner ask: P&L must cost what will actually be PAID at the mandi, not a fractional
//     estimate) — see buildMandiBreakdown below, which both callers can use for that.
//   - DCFloralsTab.jsx shows the exact fractional need, because its job is to explain the
//     derivation precisely, not to state a purchase order.
// That split is intentional product behaviour, not drift, so it is left to each caller.

import { matchFlowerPattern, sizeClassToPatternKey, normalizeSizeClass } from "../ims/flowerHelpers";
import { findCrossFnReuseSource } from "./crossFnReuse";
import { repeatCatFor } from "./pricing";

export const REPEAT_REAL_QTY_MULT = 0.2;
export const REPEAT_ART_QTY_MULT = 0.7;

/**
 * Computes the full per-element / per-flower floral cost breakdown for one function.
 *
 * @param {object} fn - the function (from collectAllFunctionData()) to cost.
 * @param {object[]} allFns - every function in the booking (collectAllFunctionData()'s own
 *   return) — needed for cross-function reuse detection.
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
 * @param {object} [opts.colorPrefsForFn] - parentId → ranked colour preference rows
 * @param {number} [opts.artFlowerRatePerKg]
 * @param {number} [opts.artFlowerBunchesPerKg]
 * @param {number} [opts.artGreenRatePerKg]
 * @param {number} [opts.artGreenBunchesPerKg]
 * @param {function} [opts.resolveRcRate] - (rc, sizeUpper) => {realRate, artRate}; only the
 *   billed-income figure needs this — omit it (the tab does) and income stays {real:0, art:0}.
 */
export function computeFnFloralCost(fn, allFns, opts) {
  const {
    flowerPatterns = [], mandiCatalogue = [], mandiMults = {}, seasonMap = {},
    floralRatio = 70, rcItems = [], rcFloralModeByKey = {}, resolveMandiFlower,
    imsInventory = [], dcInventoryCache = [], colorPrefsForFn = {},
    artFlowerRatePerKg = 50, artFlowerBunchesPerKg = 16,
    artGreenRatePerKg = 40, artGreenBunchesPerKg = 23,
    resolveRcRate = null,
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

  const flowerAgg = new Map();
  const elementBreakdown = [];
  const uncosted = [];
  let totalReal = 0, totalArtificial = 0, realIncome = 0, artIncome = 0, fixedExtras = 0;
  let artFlowerBunches = 0, artGreenBunches = 0, artFlowerBunchesFull = 0, artGreenBunchesFull = 0;

  const fnOverrides = fn?.floralOverrides || { rows: [] };
  const overrideByParentId = new Map();
  (fnOverrides.rows || []).forEach(r => { if (r?.flowerId) overrideByParentId.set(r.flowerId, r); });

  const crossFnPrevFnFloral = findCrossFnReuseSource(fn, allFns || []);
  Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
    if (!fn.enabledEls?.[zk]) return;
    // The Elements chip, not the zone toggle alone (RC-30) — the flowers are elements.
    const manualRepeat = repeatCatFor(fn.zoneConfig?.[zk], "elements");
    const crossFnRepeat = !manualRepeat && !!(crossFnPrevFnFloral?.enabledEls?.[zk] && crossFnPrevFnFloral?.zoneConfig?.[zk]);
    const zoneRepeat = manualRepeat || crossFnRepeat;
    const realQtyFrac = zoneRepeat ? REPEAT_REAL_QTY_MULT : 1;
    const artQtyFrac = zoneRepeat ? REPEAT_ART_QTY_MULT : 1;
    const repeatLabel = manualRepeat ? "set to Repeat in Build"
      : crossFnRepeat ? `carried over from ${crossFnPrevFnFloral.fnType || "another function"} (same venue, ${crossFnPrevFnFloral.fnDate === fn.fnDate ? "same day" : "day before"})`
      : null;

    // A kit's own subItems can carry floral content of their own — a flower-recipe add-on
    // (si.patternId) or a component item itself categorized as florals — neither of which
    // is visible from the outer element's own invId/patternId/name alone.
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
      let rc = rcItems.find(i => (i.name || "").toLowerCase().trim() === elName);
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
        elementBreakdown.push({ name: el.name, zoneKey: zk, qty: elQty, realPct, realCost: 0, artCost: 0, total: 0, hasPattern: false, realLines: [], size: sizeKey, artLines: [], artBunchesFlower: 0, artBunchesGreen: 0, artBunchesFlowerFull: 0, artBunchesGreenFull: 0, flowerPerBunchRate, greenPerBunchRate, isInvOnlyNoPattern: invIsFloral, repeatZone: zoneRepeat, repeatLabel, realQtyFrac, artQtyFrac });
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
          const prefArr = colorPrefsForFn?.[parentId];
          const prefRate = Array.isArray(prefArr) && prefArr.length > 0 ? Number(prefArr[0].rate) : 0;
          const variantRate = Number(override?.colorVariant?.rate) || 0;
          const basePrice = prefRate > 0 ? prefRate : variantRate > 0 ? variantRate : (Number(parent?.currentPrice) || 0);
          const unitPrice = (prefRate > 0 || variantRate > 0) ? basePrice : basePrice * seasonMult;
          const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          const effectiveRealFrac = flowerType === "real_only" ? 1 : realFrac;
          const totalFlowerQtyFull = (fl.qty || 0) * elQty * effectiveRealFrac;
          const totalFlowerQty = totalFlowerQtyFull * realQtyFrac;
          const lineCost = totalFlowerQty * unitPrice;
          const displayName = parent?.name || fl.flowerId;
          realLines.push({ flowerId: parentId, name: displayName, perPattern: fl.qty || 0, qty: totalFlowerQty, unit: parent?.unit || "kg", unitPrice, lineCost, realOnly: flowerType === "real_only", variantPicked: override?.colorVariant?.label || null });
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
            prev.contributors.push({ elName: el.name, zoneKey: zk, elQty, perPattern: fl.qty || 0, realFrac: effectiveRealFrac, contribution: totalFlowerQty, repeatZone: zoneRepeat, repeatQtyFrac: realQtyFrac, repeatLabel, size: sizeKey, realOnly: flowerType === "real_only" });
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
          if (flowerType === "mapping") {
            const realUnitsReplaced = (fl.qty || 0) * elQty * artFrac * artQtyFrac;
            const mapCost = Number(parent?.artificialMapCost) || 0;
            const lineCost = realUnitsReplaced * mapCost;
            artLines.push({ flowerId: parentId, name: parent?.name || fl.flowerId, realUnitsReplaced, unit: parent?.unit || "?", bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: mapCost, lineCost, missingRatio: mapCost <= 0, realOnly: false, isMapped: true, mappedName: parent?.artificialMapName || null });
            return;
          }
          const bunchesPerUnit = Number(parent?.artificialBunchesPerUnit) || 0;
          const realUnitsReplacedFull = (fl.qty || 0) * elQty * artFrac;
          const realUnitsReplaced = realUnitsReplacedFull * artQtyFrac;
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
        repeatZone: zoneRepeat, repeatLabel, realQtyFrac, artQtyFrac,
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
  });
  return Object.values(fbreak).map(f => {
    const rate = f.qty > 0 ? Math.round((f.cost / f.qty) * 100) / 100 : 0;
    const qty = Math.ceil(f.qty);
    return { ...f, qty, rate, cost: Math.round(qty * rate) };
  }).sort((a, b) => b.cost - a.cost);
}

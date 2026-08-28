// ═══════════════════════════════════════════════════════════════
// DEAL CHECK · FLORALS SUB-TAB — VERBATIM port of the reference
// `dcActiveTab === "florals"` body (ref ~14030–14657) plus the three
// floral modals it drives: 🎨 colour pick (dcColorModal), ⭐ colour
// preference (dcPrefModal), 🌸 artificial colour split (dcArtFlowerModal),
// and 🔄 swap (dcSwapModal). Modals are co-located here so the table
// buttons that open them work standalone. JSX/logic copied verbatim;
// inline styles preserved.
// ═══════════════════════════════════════════════════════════════
import { Fragment, useState } from "react";
import { matchFlowerPattern, sizeClassToPatternKey, normalizeSizeClass } from "../../../../lib/ims/flowerHelpers";

// ═══ THE FLORAL GROUND ═══
// Drop the artwork at src/assets/ambria-florals.(jpg|jpeg|png|webp) and this tab is drawn on it.
// import.meta.glob rather than a plain import, the same reason DealCheckOverlay and StudioSummary use
// it: a direct import of a file that is not there FAILS THE BUILD, so nobody could deploy until the
// asset existed. A glob resolves to {} and the tab simply renders on its plain ground.
//
// NOT named "*-bg.*" on purpose. StudioSummary globs `assets/*-bg.{png,jpg,jpeg,webp}` and reads the
// part before "-bg" as an EVENT TYPE for the deck renderer — a file called florals-bg.jpg would
// silently invent an event type called "florals". Same naming as ambria-estimate/ambria-panel.
const FLORAL_BG = Object.values(
  import.meta.glob("../../../../assets/ambria-florals.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" })
)[0] || null;

export default function DCFloralsTab({ ctx }) {
  const [artFlowerSearch, setArtFlowerSearch] = useState(""); // search-by-name for the artificial flower colour picker (long list)
  const {
    // chrome / theme
    border, textS, textP, isDark,
    // build / fn state
    activeFnIdx, collectAllFunctionData, rcItems,
    // deal check data + pricing
    dealCheckData, floralRatio, resolveMandiFlower, imsField, dcInventoryCache, rcFloralModeByKey,
    // floral state
    dcFloralCalcOpen, setDcFloralCalcOpen,
    dcArtFlowerAlloc, setDcArtFlowerAlloc, dcArtFlowerModal, setDcArtFlowerModal,
    dcFloralColorPrefs, setDcFloralColorPrefs,
    dcColorModal, setDcColorModal, dcPrefModal, setDcPrefModal,
    setFloralOverrides,
    // swap modal state
    dcSwapModal, setDcSwapModal, dcSwapSearch, setDcSwapSearch,
    dcSwapPicked, setDcSwapPicked, dcSwapMode, setDcSwapMode, dcSwapSplitQty, setDcSwapSplitQty,
  } = ctx;

  return (
    <>
      {/* ═══ INTERACTION LAYER ═══
          The Studio tree is inline styles, which cannot express :hover — so the hover states live in
          one scoped sheet keyed off `.dcf-` classes, the same approach Browse and Event Info use.
          !important is required on the card shadow because an inline style otherwise wins.
          Cards lift by a single pixel. Any more and a column of them bounces as the pointer crosses
          it; this is meant to say "this is a distinct block", not to animate. */}
      <style>{`
.dcf-card{transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease}
.dcf-card:hover{transform:translateY(-1px);
  box-shadow:0 2px 4px rgba(26,26,46,0.07), 0 16px 30px -18px rgba(26,26,46,0.45) !important}
.dcf-row{transition:background .14s ease}
.dcf-row:hover{background:rgba(236,72,153,0.05)}
/* The row buttons (🎨 swap, 🧮 how, Split Colors) carry their own colour inline, so hover shifts
   brightness rather than repainting them — one rule serves every tint. */
.dcf-btn{transition:filter .14s ease, transform .14s ease}
.dcf-btn:hover{filter:brightness(0.94);transform:translateY(-1px)}
.dcf-btn:active{transform:translateY(0)}
      `}</style>
      {(() => {
                  // ═══ FLORALS TAB BODY (Tier 1.6 Phase 2 · Deploy 2 §7.9.13) ═══
                  // Per-function flower breakdown:
                  //   1. Real flower mandi list — aggregated across all elements in the function
                  //   2. Artificial filler cost — blend (1 - realPct/100) × element rate
                  //   3. Per-element breakdown — what each element contributes
                  //   4. Grand total
                  const fnIdx = activeFnIdx || 0;
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  const activeFn = fns[fnIdx];
                  if (!activeFn) return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>No function selected.</div>;
                  const flowerPatterns = dealCheckData?.flowerPatterns || [];
                  const mandiCatalogue = dealCheckData?.mandiCatalogue || [];
                  const mandiMults = dealCheckData?.mandiPriceMultipliers || {};
                  const seasonMap = dealCheckData?.seasonMap || {};
                  const artRatePerKg = Number(dealCheckData?.artificialMixRatePerKg || 0);
                  const fnFloralRatio = (typeof activeFn.floralRatio === "number") ? activeFn.floralRatio : (typeof floralRatio === "number" ? floralRatio : 70);
                  const sizeFromMode = (inhouseMode, elSize) => {
                    if (inhouseMode === "smb") {
                      const s = (elSize || "M").toUpperCase();
                      if (s === "S") return "small";
                      if (s === "B") return "big";
                      return "medium";
                    }
                    return "medium";
                  };
                  const resolveRealPct = (el, rc) => {
                    if (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) return el.realPct;
                    const mode = String(rc?.floralMode||"").toLowerCase();
                    if (mode === "real") return 100;
                    if (mode === "artificial") return 0;
                    const subKey = String(rc?.sub || rc?.imsAlias || "").trim().toLowerCase();
                    const subMode = subKey ? rcFloralModeByKey?.[subKey] : undefined;
                    if (subMode === "real") return 100;
                    if (subMode === "artificial") return 0;
                    if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
                    return Math.max(0, Math.min(100, 100 - fnFloralRatio));
                  };
                  // Walk all floral elements in this function
                  const flowerAgg = new Map();  // parentId → { flowerId(=parentId), name, totalQty, unit, currentPrice, contributors[], realOnly }
                  const elementBreakdown = [];  // [{ name, zoneKey, qty, realPct, realCost, artCost, total }]
                  // Elements this tab could not price as flowers. They are still costed elsewhere
                  // (Inventory prices them as plain rental), so the money is not lost — it is in the
                  // wrong bucket. Listing them makes that visible instead of silent.
                  const uncosted = [];
                  let totalReal = 0, totalArtificial = 0;
                  // Tier 2.1 (25 May 2026) — per-row overrides from floralOverrides.rows.
                  // Map: parentId → { colorVariant?, splitFromOriginal? } for quick lookup during aggregation.
                  // Lets the iteration apply variant prices and split rows without rewriting the loop.
                  const fnOverrides = activeFn.floralOverrides || { note: "", rows: [] };
                  const overrideByParentId = new Map();
                  (fnOverrides.rows || []).forEach(r => { if (r?.flowerId) overrideByParentId.set(r.flowerId, r); });
                  Object.entries(activeFn.zoneElements || {}).forEach(([zk, elems]) => {
                    if (!activeFn.enabledEls?.[zk]) return;
                    (elems || []).forEach(el => {
                      const elName = (el.name || "").toLowerCase().trim();
                      const elQty = el.qty || 0;
                      let rc = rcItems.find(i => (i.name || "").toLowerCase().trim() === elName);
                      if (!rc && elName.length >= 4) {
                        // Same leniency the pattern lookup uses. Exact-only meant "Blue Pottery Pot
                        // Big" never found the "Blue Pottery Pot" row. Restricted to FLORALS rows so
                        // a loose substring cannot drag a lighting or structure element in here — but
                        // that guard alone wasn't enough: a short element name like "T" is a substring
                        // of nearly any florals product name ("Mari**g**old Ree**t**", "Table Runner"…),
                        // so it spuriously matched and pulled a plain non-floral inventory item into
                        // this tab. Both sides now need at least 4 characters before substring
                        // matching is attempted at all — short names must match exactly or not at all.
                        rc = rcItems.find(i => {
                          if (String(i.cat || "").toLowerCase() !== "florals") return false;
                          const n = (i.name || "").toLowerCase().trim();
                          return n && n.length >= 4 && (elName.includes(n) || n.includes(elName));
                        });
                      }
                      // el.patternId is what BUILD prices this element from (getElPriceFromPattern),
                      // and it is the authoritative signal that the element is floral. This tab used
                      // to decide purely from the rate-card category, so an element priced as flowers
                      // in the build but missing from the rate card vanished here entirely.
                      const elPattern = el.patternId ? (flowerPatterns || []).find(p => p.id === el.patternId) : null;
                      // el.invId is Build's THIRD identity source (getElPrice/getElPriceForFn check
                      // invId before patternId before falling back to the Rate Card by name — Rate
                      // Card is never even consulted for an invId element, "by design, not as a
                      // fallback"). This tab had no branch for it at all: an IMS-inventory-sourced
                      // floral element (the common case for a real physical product like "Flower
                      // Reet" — patternId is reserved for PURE recipe-only elements with no inventory
                      // backing) fell through to the name-based rc/pattern lookups below, which have
                      // no reason to agree with an unrelated Rate Card row's sub-category — so a
                      // genuinely-priced, genuinely-linked recipe showed "No IMS pattern found".
                      const invItem = el.invId ? (dcInventoryCache || []).find(i => i.id === el.invId) : null;
                      const invIsFloral = !!invItem && String(invItem.cat || invItem.category || "").toLowerCase() === "florals";
                      const isFloral = !!el.patternId || invIsFloral || String(rc?.cat || "").toLowerCase() === "florals";
                      if (!isFloral) return;                 // lighting, structure, furniture — not this tab's business
                      if (elQty <= 0) return;
                      // Floral, but nothing to price it by. Record rather than drop: the header used
                      // to read "1 ELEMENT" while others were silently on the floor.
                      if (!rc && !elPattern && !invItem) {
                        uncosted.push({ name: el.name || "(unnamed)", zoneKey: zk, qty: elQty, reason: "No rate-card entry or recipe" });
                        return;
                      }
                      const realPct = resolveRealPct(el, rc);
                      const realFrac = realPct / 100;
                      const artFrac = 1 - realFrac;
                      // Prefer the recipe the BUILD actually priced this element with, checked in
                      // Build's own priority order (invId, then patternId, then Rate Card by name).
                      // Re-deriving it a different way could land on a different recipe than the
                      // salesperson/Build actually used — or on none at all — so the two screens
                      // disagreed on the same element. matchFlowerPattern (flowerHelpers.js) is the
                      // SAME sub-category-first matcher Build itself prices from — for an invId
                      // element it's fed the real IMS inventory item (matching getElPriceFromInventory
                      // exactly); the Rate Card row is a coincidental name-match at best and was never
                      // the thing Build actually priced from. This used to be a hand-rolled name-only
                      // lookup (exact, then substring) against the Rate Card alone, which is exactly
                      // backwards from how recipes are organised: a recipe is created PER SUB-CATEGORY
                      // and applies to every differently-named product in it — a pure name comparison
                      // would never find it, and risks false positives on short/generic names besides.
                      let pattern = elPattern
                        || (invItem ? matchFlowerPattern(invItem, flowerPatterns) : null)
                        || matchFlowerPattern({ subcategory: rc?.sub, name: rc?.name || el.name }, flowerPatterns);
                      // Build sizes an invId floral element the same way regardless of any Rate Card
                      // "smb" mode (sizeClassToPatternKey/normalizeSizeClass, getElPriceFromInventory)
                      // — sizeFromMode below requires rc.inhouseMode==="smb" to honour el.size at all,
                      // which an invId element (no rc, or an unrelated coincidental rc match) would
                      // never have, silently always pricing it at "medium" regardless of the S/M/B
                      // toggle actually picked on Build.
                      const sizeKey = invItem
                        ? sizeClassToPatternKey(normalizeSizeClass(el.size || "B"))
                        : sizeFromMode(pattern?.mode || rc?.inhouseMode, el.size);
                      let realCostPerUnit = 0;
                      let realLines = [];
                      // ═══ INVENTORY INGREDIENTS ARE ARTIFICIAL ═══
                      // A recipe ingredient sourced from IMS inventory is a manufactured piece — it is
                      // never a fresh flower, so it belongs on the ARTIFICIAL side, not the real one.
                      // It used to be added to realCostPerUnit, which is how a 0%-real element ended
                      // up showing a Real figure.
                      // Collected here rather than inside the artificial block below, because that
                      // block is gated on artFrac > 0: at 100% real it never runs, and the piece is
                      // still physically going out. It is charged in FULL either way — the blend
                      // decides whether the FLOWERS are fresh, and has no bearing on a rented frame.
                      let invItemCost = 0;
                      const invItemLines = [];
                      // Fixed extra cost (pot/base/frame) per unit — a real cost regardless of the
                      // real/artificial split, added AFTER the flower lines below. calcFnFloralSourcingCost
                      // (the bottom-bar Florals rollup) already includes this; this tab's own Real Total
                      // didn't, so it ran lower than the rollup for any pattern with a nonzero extraCost.
                      let patternExtraCost = 0;
                      if (pattern) {
                        const sizes = pattern.sizes || {};
                        let comp = sizes[sizeKey] || sizes.medium;
                        if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
                        if (comp) patternExtraCost = (Number(comp.extraCost) || 0) * elQty;
                        if (comp && Array.isArray(comp.flowers)) {
                          const season = seasonMap[activeFn.fnDate] || "non_saya";
                          const seasonMult = mandiMults[season] || 1;
                          comp.flowers.forEach(fl => {
                            // A direct IMS Inventory ingredient — no mandi-flower counterpart at all
                            // (fl.flowerId is unset), so resolveMandiFlower(undefined, ...) would
                            // return null and this priced at ₹0 silently. It's a physical rented
                            // piece, always sourced the same way regardless of the real/artificial
                            // slider — same reasoning as real_only just below — so it counts in FULL
                            // here and the artificial loop skips it entirely (contributes nothing
                            // there), rather than being scaled by realFrac.
                            if (fl.invItemId) {
                              const item = (dcInventoryCache || []).find(i => i.id === fl.invItemId);
                              const rawPrice = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
                              const totalQty = (fl.qty || 0) * elQty;
                              const lineCost = totalQty * rawPrice;
                              // Held aside and added to the ARTIFICIAL total after that block — see
                              // the note where invItemCost is declared. Deliberately NOT added to
                              // realCostPerUnit or realLines: it is not a fresh flower.
                              invItemCost += lineCost;
                              invItemLines.push({
                                flowerId: fl.invItemId, name: item?.name || "Inventory item",
                                perPattern: fl.qty || 0, qty: totalQty, unit: item?.unit || "pc",
                                unitPrice: rawPrice, lineCost,
                                // No bunch maths: this has a price of its own, so it must not feed the
                                // bunches -> kg -> rate calculation the other artificial lines drive.
                                realUnitsReplaced: 0, bunchesPerUnit: 0, bunches: 0, isGreen: false,
                                perBunch: 0, missingRatio: false, realOnly: true, invItem: true,
                              });
                              return;
                            }
                            // Tier 2.1 — resolve via parent-with-variants helper. Recipe may reference
                            // a legacy variant ID (e.g. F002 "Rose White") OR a parent ID (e.g. F001 "Rose").
                            // Either way we collapse to the PARENT and use parent.currentPrice (= lowest
                            // variant) as the base. Salesperson can override price by picking a variant in 🎨.
                            const resolved = resolveMandiFlower(fl.flowerId, mandiCatalogue);
                            const parent = resolved?.parent || null;
                            const parentId = parent?.id || fl.flowerId;
                            const override = overrideByParentId.get(parentId);
                            // §26.12: Ranked preferences (1st choice) take priority for pricing
                            const _prefArr = dcFloralColorPrefs[fnIdx]?.[parentId];
                            const prefRate = Array.isArray(_prefArr) && _prefArr.length > 0 ? Number(_prefArr[0].rate) : 0;
                            // Legacy: old 🎨 single-pick colorVariant (backward compat)
                            const variantRate = Number(override?.colorVariant?.rate) || 0;
                            if (prefRate > 0) console.log("[pref-price]", parentId, "prefRate=", prefRate, "variantRate=", variantRate, "parent=", parent?.currentPrice);
                            const basePrice = prefRate > 0
                              ? prefRate
                              : variantRate > 0
                              ? variantRate
                              : (Number(parent?.currentPrice) || 0);
                            // Season multiplier applies only to default parent price, NOT to explicit color picks
                            const unitPrice = (prefRate > 0 || variantRate > 0) ? basePrice : basePrice * seasonMult;
                            // Tier 1.9b — real_only flowers always 100% real, ignore element's blend
                            const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
                            const effectiveRealFrac = flowerType === "real_only" ? 1 : realFrac;
                            const totalFlowerQty = (fl.qty || 0) * elQty * effectiveRealFrac;
                            const lineCost = totalFlowerQty * unitPrice;
                            realCostPerUnit += (fl.qty || 0) * unitPrice;
                            const displayName = parent?.name || fl.flowerId;
                            realLines.push({ flowerId: parentId, name: displayName, perPattern: fl.qty || 0, qty: totalFlowerQty, unit: parent?.unit || "kg", unitPrice, lineCost, realOnly: flowerType === "real_only", variantPicked: override?.colorVariant?.label || null });
                            // Aggregate — KEYED BY PARENT ID (collapses old per-colour rows into one parent row)
                            if (totalFlowerQty > 0) {
                              const prev = flowerAgg.get(parentId) || { flowerId: parentId, name: displayName, totalQty: 0, unit: parent?.unit || "kg", unitPrice, contributors: [], realOnly: flowerType === "real_only", flowerType, variantPicked: override?.colorVariant || null };
                              prev.totalQty += totalFlowerQty;
                              prev.unitPrice = unitPrice; // refresh in case variant override applies
                              prev.variantPicked = override?.colorVariant || prev.variantPicked;
                              prev.contributors.push({
                                elName: el.name, zoneKey: zk, elQty,
                                perPattern: fl.qty || 0, realFrac: effectiveRealFrac, contribution: totalFlowerQty,
                                size: sizeKey, realOnly: flowerType === "real_only"
                              });
                              flowerAgg.set(parentId, prev);
                            }
                          });
                        }
                      }
                      // Tier 1.9 (22 May 2026) — Artificial cost via real-to-bunch conversion.
                      // Iterate the recipe again to compute artificial bunches per real-flower line.
                      // Old formula (rental × artFrac) replaced entirely. No fallback for items without recipe.
                      const realCost = realLines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + patternExtraCost;
                      const artFlowerRatePerKg = Number(dealCheckData?.artificialFlowerRatePerKg ?? 50);
                      const artFlowerBunchesPerKg = Number(dealCheckData?.artificialFlowerBunchesPerKg ?? 16) || 16;
                      const artGreenRatePerKg = Number(dealCheckData?.artificialGreenRatePerKg ?? 40);
                      const artGreenBunchesPerKg = Number(dealCheckData?.artificialGreenBunchesPerKg ?? 23) || 23;
                      const flowerPerBunchRate = artFlowerRatePerKg / artFlowerBunchesPerKg;
                      const greenPerBunchRate = artGreenRatePerKg / artGreenBunchesPerKg;
                      let artCost = 0;
                      const artLines = []; // breakdown for "how" panel
                      let artBunchesFlower = 0, artBunchesGreen = 0;
                      if (artFrac > 0 && pattern) {
                        const sizes = pattern.sizes || {};
                        let comp = sizes[sizeKey] || sizes.medium;
                        if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
                        if (comp && Array.isArray(comp.flowers)) {
                          comp.flowers.forEach(fl => {
                            // Direct IMS Inventory ingredient — priced and collected in the real-side
                            // loop above (into invItemCost / invItemLines) and folded into this
                            // side's total after this block, so it lands here with its real cost
                            // whether or not artFrac happens to be above zero. Nothing to do here.
                            if (fl.invItemId) return;
                            // Tier 2.1 — resolve through parent (same as real-cost block above)
                            const resolved = resolveMandiFlower(fl.flowerId, mandiCatalogue);
                            const parent = resolved?.parent || null;
                            const parentId = parent?.id || fl.flowerId;
                            // Tier 1.9b — real_only flowers skip artificial contribution
                            const flowerType = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
                            if (flowerType === "real_only") {
                              artLines.push({
                                flowerId: parentId, name: parent?.name || fl.flowerId,
                                realUnitsReplaced: 0, unit: parent?.unit || "?",
                                bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: 0, lineCost: 0,
                                missingRatio: false, realOnly: true
                              });
                              return;
                            }
                            // IMS Mandi tab "Mapping" flowers — the artificial substitute is a SPECIFIC
                            // inventory item (picked in IMS), not a generic bunches-per-kg conversion.
                            // Mirrors calcFnFloralSourcingCost's own mapping branch (StudioApp.jsx) —
                            // this tab previously had no branch for it at all, so a mapped flower's
                            // artificial cost silently computed as ₹0 (bunchesPerUnit falls back to 0
                            // since mapping flowers never have one set in IMS).
                            if (flowerType === "mapping") {
                              const realUnitsReplaced = (fl.qty || 0) * elQty * artFrac;
                              const mapCost = Number(parent?.artificialMapCost) || 0;
                              const lineCost = realUnitsReplaced * mapCost;
                              artCost += lineCost;
                              artLines.push({
                                flowerId: parentId, name: parent?.name || fl.flowerId,
                                realUnitsReplaced, unit: parent?.unit || "?",
                                bunchesPerUnit: 0, bunches: 0, isGreen: false, perBunch: mapCost, lineCost,
                                missingRatio: mapCost <= 0, realOnly: false,
                                isMapped: true, mappedName: parent?.artificialMapName || null
                              });
                              return;
                            }
                            const bunchesPerUnit = Number(parent?.artificialBunchesPerUnit) || 0;
                            const realUnitsReplaced = (fl.qty || 0) * elQty * artFrac;
                            const bunches = realUnitsReplaced * bunchesPerUnit;
                            const isGreen = flowerType === "green";
                            const perBunch = isGreen ? greenPerBunchRate : flowerPerBunchRate;
                            const lineCost = bunches * perBunch;
                            if (isGreen) artBunchesGreen += bunches; else artBunchesFlower += bunches;
                            artCost += lineCost;
                            artLines.push({
                              flowerId: parentId, name: parent?.name || fl.flowerId,
                              realUnitsReplaced, unit: parent?.unit || "?",
                              bunchesPerUnit, bunches, isGreen, perBunch, lineCost,
                              missingRatio: bunchesPerUnit <= 0, realOnly: false
                            });
                          });
                        }
                      }
                      // Inventory ingredients join the ARTIFICIAL total here, outside the artFrac gate
                      // above — a manufactured piece is never fresh, and it goes out whatever the
                      // blend says. Charged in full: the blend governs flowers, not rented pieces.
                      artCost += invItemCost;
                      artLines.push(...invItemLines);
                      totalReal += realCost;
                      totalArtificial += artCost;
                      // A plain IMS inventory item with no flower recipe (invItem backs it, but no
                      // pattern matched) is a physical prop/holder, not a flower arrangement — its
                      // rental is already listed on the Inventory tab. Tagged so the per-element
                      // breakdown below can skip showing it a second time here (with a "no pattern"
                      // warning that's really just "this was never supposed to have one").
                      const isInvOnlyNoPattern = !!invItem && !pattern;
                      elementBreakdown.push({ name: el.name, zoneKey: zk, qty: elQty, realPct, realCost, artCost, total: realCost + artCost, hasPattern: !!pattern, realLines, size: sizeKey, artLines, artBunchesFlower, artBunchesGreen, flowerPerBunchRate, greenPerBunchRate, isInvOnlyNoPattern });
                    });
                  });
                  if (elementBreakdown.length === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>No floral elements in this function.</div>;
                  }
                  // ═══ Tier 2.1 — Apply swap/split overrides onto auto-aggregation ═══
                  // For each row in floralOverrides.rows where swap took place:
                  //   - Full swap: original parentId's qty diverted to swap target's parentId at swap target's rate
                  //   - Split: original keeps reduced qty, swap target gets the diverted portion
                  // colorVariant override is already applied during aggregation (price was overridden inline).
                  (fnOverrides.rows || []).forEach(override => {
                    if (!override?.swapTo) return; // not a swap row, ignore
                    const fromAgg = flowerAgg.get(override.swapTo.fromParentId);
                    if (!fromAgg) return;
                    const swapQty = Number(override.swapTo.qty) || 0;
                    const isSplit = !!override.swapTo.isSplit;
                    if (swapQty <= 0) return;
                    // Capture the EFFECTIVE from-rate (already reflects any colour-variant override)
                    // before we mutate the row, so totalReal delta accounting stays correct.
                    const effectiveFromRate = Number(fromAgg.unitPrice) || 0;
                    // Reduce original (split) or zero it out (full)
                    if (isSplit) {
                      fromAgg.totalQty = Math.max(0, fromAgg.totalQty - swapQty);
                      // Drop the row entirely if qty fell to 0
                      if (fromAgg.totalQty <= 0.0001) flowerAgg.delete(override.swapTo.fromParentId);
                    } else {
                      flowerAgg.delete(override.swapTo.fromParentId);
                    }
                    // Add/merge into swap target
                    const targetParent = resolveMandiFlower(override.swapTo.toParentId, mandiCatalogue)?.parent;
                    if (!targetParent) return;
                    const targetId = targetParent.id;
                    const targetRate = (override.swapTo.toRate || targetParent.currentPrice || 0);
                    const targetFlowerType = targetParent.flowerType || (targetParent.isGreen ? "green" : "flower");
                    const newQty = swapQty; // swap qty goes to target regardless of full/split
                    const existing = flowerAgg.get(targetId);
                    if (existing) {
                      existing.totalQty += newQty;
                      existing.contributors.push({
                        elName: "↪ swapped from " + (override.swapTo.fromName || ""), zoneKey: "—",
                        elQty: 1, perPattern: newQty, realFrac: 1, contribution: newQty,
                        size: "—", realOnly: targetFlowerType === "real_only", isSwap: true
                      });
                    } else {
                      flowerAgg.set(targetId, {
                        flowerId: targetId,
                        name: targetParent.name,
                        totalQty: newQty,
                        unit: targetParent.unit || "kg",
                        unitPrice: targetRate,
                        contributors: [{
                          elName: "↪ swapped from " + (override.swapTo.fromName || ""), zoneKey: "—",
                          elQty: 1, perPattern: newQty, realFrac: 1, contribution: newQty,
                          size: "—", realOnly: targetFlowerType === "real_only", isSwap: true
                        }],
                        realOnly: targetFlowerType === "real_only",
                        flowerType: targetFlowerType,
                        variantPicked: null,
                        _isSwapTarget: true
                      });
                    }
                    // Adjust totalReal: remove diverted qty at original effective rate, add at target rate
                    totalReal -= swapQty * effectiveFromRate;
                    totalReal += newQty * targetRate;
                  });
                  const sortedAgg = Array.from(flowerAgg.values()).sort((a,b) => b.totalQty - a.totalQty);
                  const grandTotal = totalReal + totalArtificial;
                  const overallRealPct = grandTotal > 0 ? Math.round((totalReal / grandTotal) * 100) : 0;
                  // §26 — Total artificial bunches for this function (sum of realUnitsReplaced across all art lines)
                  const totalArtBunches = elementBreakdown.reduce((sum, eb) =>
                    sum + eb.artLines.reduce((s, al) => s + (al.realOnly ? 0 : al.realUnitsReplaced || 0), 0), 0);
                  // Convert bunches → actual kg using IMS rates
                  const _bpkF = Number(dealCheckData?.artificialFlowerBunchesPerKg ?? 16) || 16;
                  const _bpkG = Number(dealCheckData?.artificialGreenBunchesPerKg ?? 23) || 23;
                  const _artBunchesF = elementBreakdown.reduce((s,e)=>s+(e.artBunchesFlower||0),0);
                  const _artBunchesG = elementBreakdown.reduce((s,e)=>s+(e.artBunchesGreen||0),0);
                  const totalArtKg = Math.round(((_artBunchesF / _bpkF) + (_artBunchesG / _bpkG)) * 100) / 100;
                  const fnArtAlloc = dcArtFlowerAlloc[fnIdx] || [];
                  const fnArtAllocTotal = fnArtAlloc.reduce((s, a) => s + (Number(a.qty) || 0), 0);
                  return (
                    // The artwork sits in a layer of its OWN rather than as a background on this
                    // column, for two reasons: a background-image on a container as tall as a
                    // four-function deal stretches the frame out of shape, and the cards below paint
                    // opaque grounds anyway — so the decoration is only ever seen in the padding and
                    // the gaps, which is exactly what a framed image wants. pointerEvents:none so it
                    // can never sit between a click and the table underneath it.
                    <div style={{position:"relative",
                      ...(FLORAL_BG ? {padding:16,borderRadius:16} : {})}}>
                      {FLORAL_BG && <div aria-hidden="true" style={{position:"absolute",inset:0,borderRadius:16,pointerEvents:"none",
                        backgroundImage:`url(${FLORAL_BG})`,backgroundSize:"cover",backgroundPosition:"center",backgroundRepeat:"no-repeat"}}/>}
                      {/* ── TWO COLUMNS ──
                          What you buy on the left (the split, the note to the purchase manager, and the
                          mandi list they shop from), what it is made of on the right (artificial
                          bunches and the per-element derivation). The mandi list is the working
                          document and the widest thing here, so it gets the room; the right column is
                          reference material read alongside it rather than scrolled past to reach it.
                          flexWrap, NOT a two-column grid: this overlay is opened on laptops and on
                          tablets, and inline styles cannot carry a media query. Wrapping gives the
                          same stacked layout below ~900px for free — the right column simply drops
                          under the left instead of crushing the table into an unreadable width. */}
                      <div style={{position:"relative",zIndex:1,display:"flex",flexWrap:"wrap",alignItems:"flex-start",gap:14}}>
                        <div style={{flex:"1 1 560px",minWidth:0,display:"flex",flexDirection:"column",gap:14}}>
                      {/* Header summary
                          The function name and date as an eyebrow, the total as the one large figure,
                          the real/artificial split as dotted legend entries, and the percentage as a
                          pill on the right.
                          The percentage was briefly a ring; the second reference shows a pill and the
                          pill is the better call anyway — a ring implies a target being filled, and
                          this number has no target. 100% real is not "complete", it is simply the
                          blend this deal happens to use.
                          EVERY VALUE IS THE ONE THAT WAS ALWAYS HERE — grandTotal, totalReal,
                          totalArtificial, overallRealPct. This is paint, not arithmetic. */}
                      <div className="dcf-card" style={{padding:"16px 18px",borderRadius:14,background:"linear-gradient(180deg,#FFF7FB 0%,#FFFFFF 100%)",border:`1px solid rgba(236,72,153,0.18)`,boxShadow:"0 1px 2px rgba(236,72,153,0.05), 0 8px 20px -14px rgba(236,72,153,0.35)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                          {/* Icon tile — the reference leads with one, and it gives the eyebrow and the
                              figure a left edge to sit against instead of floating on the card. */}
                          <div aria-hidden="true" style={{width:44,height:44,flexShrink:0,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,background:"rgba(236,72,153,0.10)",border:"1px solid rgba(236,72,153,0.18)"}}>🌸</div>
                          <div style={{minWidth:0,flex:"1 1 auto"}}>
                            <div style={{fontSize:12.5,color:"#1A1A2E",letterSpacing:0.7,textTransform:"uppercase",fontWeight:700}}>{activeFn.fnType || `Function ${fnIdx+1}`} · {activeFn.fnDate || "—"}</div>
                            {/* One baseline for the label, the figure and both legend entries, so the
                                row reads left to right as a sentence rather than as stacked blocks. */}
                            <div style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap",marginTop:2}}>
                              <span style={{fontSize:14,color:"#1A1A2E",fontWeight:600}}>Total Floral</span>
                              <span style={{fontSize:26,fontWeight:700,color:"#1A1A2E",lineHeight:1.2,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(grandTotal).toLocaleString("en-IN")}</span>
                              <span style={{fontSize:12.5,color:"#10B981",fontWeight:600,display:"inline-flex",alignItems:"center",gap:6}}>
                                <span style={{width:7,height:7,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>
                                Real ₹{Math.round(totalReal).toLocaleString("en-IN")}
                              </span>
                              <span style={{fontSize:12.5,color:"#EC4899",fontWeight:600,display:"inline-flex",alignItems:"center",gap:6}}>
                                <span style={{width:7,height:7,borderRadius:"50%",background:"#EC4899",display:"inline-block"}}/>
                                Artificial ₹{Math.round(totalArtificial).toLocaleString("en-IN")}
                              </span>
                            </div>
                          </div>
                          {/* The same sentence this always showed, set as a pill so it reads as a
                              standing fact about the deal rather than a line of running text. */}
                          <div style={{marginLeft:"auto",flexShrink:0,fontSize:12,fontWeight:600,color:"#1A1A2E",
                            padding:"7px 14px",borderRadius:999,background:"#FFFFFF",border:"1px solid rgba(236,72,153,0.22)",
                            boxShadow:"0 1px 2px rgba(236,72,153,0.06)",whiteSpace:"nowrap"}}>
                            {overallRealPct}% real / {100-overallRealPct}% artificial overall
                          </div>
                        </div>
                        {/* §26's colour-allocation strip USED to be repeated here as well as in the
                            Artificial Bunches card. Two strips, two "Split Colors" buttons, both
                            opening the same dcArtFlowerModal — and with the card now sitting in its
                            own column beside this header, the pair were on screen together. The card's
                            copy is the one kept: it is the richer of the two (its chips carry the
                            colour photo) and it sits with the kg and rate figures the split is made
                            against. Nothing is reachable only from here; the control, the modal and
                            the allocation are all unchanged. */}
                      </div>
                      {/* Tier 2.1 — 📝 Floral preference note (per function, inline always-visible textarea) */}
                      <div className="dcf-card" style={{padding:"14px 16px",borderRadius:14,background:"linear-gradient(180deg,#FBF8FF 0%,#FFFFFF 100%)",border:`1px solid rgba(192,132,252,0.20)`,boxShadow:"0 1px 2px rgba(147,51,234,0.04), 0 8px 20px -14px rgba(147,51,234,0.28)"}}>
                        <div style={{fontSize:12,color:"#9333EA",fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                          📝 Floral preference for {activeFn.fnType || `Function ${fnIdx+1}`}
                          {fnIdx !== activeFnIdx && <span style={{fontSize:10,padding:"1px 5px",borderRadius:3,background:"rgba(26, 26, 46,0.06)",color:"#1A1A2E",fontWeight:400,letterSpacing:0.3}}>read-only · switch pill to edit</span>}
                        </div>
                        {/* The pencil is a MARKER, not a control — the textarea has always been directly
                            editable and still is. It sits in the corner the reference puts it in, and is
                            pointer-events:none so it can never intercept a click meant for the field. */}
                        <div style={{position:"relative"}}>
                          <textarea
                            value={fnOverrides.note || ""}
                            placeholder="e.g. soft pastel tones, avoid bright reds, bride loves baby pink roses"
                            readOnly={fnIdx !== activeFnIdx}
                            onChange={e => {
                              if (fnIdx !== activeFnIdx) return;
                              const newNote = e.target.value;
                              setFloralOverrides(prev => ({ note: newNote, rows: Array.isArray(prev?.rows) ? prev.rows : [] }));
                            }}
                            rows={2}
                            style={{
                              width:"100%",
                              padding:"10px 34px 10px 12px",
                              fontSize:13,
                              color:"#1A1A2E",
                              // Was a dark fill (rgba(0,0,0,0.20)) left over from the overlay's dark
                              // era — on this light card it read as a hole punched in the sheet, and
                              // the placeholder was barely legible against it.
                              background:fnIdx===activeFnIdx?"#F6F5F8":"#F1F0F3",
                              border:`1px solid rgba(192,132,252,0.22)`,
                              borderRadius:9,
                              outline:"none",
                              resize:"vertical",
                              fontFamily:"inherit",
                              opacity:fnIdx===activeFnIdx?1:0.7,
                              boxSizing:"border-box"
                            }}
                          />
                          <span aria-hidden="true" style={{position:"absolute",top:10,right:11,fontSize:12,opacity:0.45,pointerEvents:"none"}}>✎</span>
                        </div>
                        <div style={{marginTop:6,fontSize:11.5,color:"#6B7280",fontStyle:"italic"}}>Purchase manager reads this when buying from mandi — colours, themes, must-haves/avoids.</div>
                      </div>
                      {/* Real flower mandi list */}
                      {sortedAgg.length > 0 && (
                        <div className="dcf-card" style={{padding:"16px 18px",borderRadius:14,background:"linear-gradient(180deg,#F6FDFA 0%,#FFFFFF 100%)",border:`1px solid rgba(16,185,129,0.20)`,boxShadow:"0 1px 2px rgba(16,185,129,0.04), 0 8px 20px -14px rgba(16,185,129,0.30)"}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#10B981",letterSpacing:0.6,textTransform:"uppercase",marginBottom:10}}>🌹 Real Flower Mandi List ({sortedAgg.length} flower{sortedAgg.length===1?"":"s"})</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                            {/* Column headers as quiet labels rather than body-weight text — the
                                reference sets them back so the flower names carry the row. */}
                            <thead><tr style={{borderBottom:`1px solid rgba(16,185,129,0.22)`}}>
                              <th style={{textAlign:"left",padding:"7px 4px",fontWeight:600,color:"#6B7280",letterSpacing:0.4}}>Flower</th>
                              <th style={{textAlign:"right",padding:"7px 4px",fontWeight:600,color:"#6B7280",letterSpacing:0.4}}>Qty</th>
                              <th style={{textAlign:"right",padding:"7px 4px",fontWeight:600,color:"#6B7280",letterSpacing:0.4}}>Rate</th>
                              <th style={{textAlign:"right",padding:"7px 4px",fontWeight:600,color:"#6B7280",letterSpacing:0.4}}>Total</th>
                              <th style={{width:140,textAlign:"center",padding:"7px 4px",fontWeight:600,color:"#6B7280",letterSpacing:0.4}}>Actions</th>
                            </tr></thead>
                            <tbody>
                              {sortedAgg.map(f => {
                                const fKey = `mandi:${f.flowerId||f.name}`;
                                const open = !!dcFloralCalcOpen[fKey];
                                return (
                                <Fragment key={f.flowerId||f.name}>
                                <tr className="dcf-row" style={{borderBottom:open?"none":`1px solid ${border}33`}}>
                                  <td style={{padding:"8px 4px",color:"#1A1A2E"}}>
                                    {/* Row marker, matching the reference. Decorative — the flower is
                                        still named in text right beside it. */}
                                    <span aria-hidden="true" style={{width:6,height:6,borderRadius:"50%",background:"#10B981",display:"inline-block",marginRight:8,verticalAlign:"middle"}}/>
                                    {f.name}
                                    {f.realOnly && <span title="Real Only — always 100% regardless of element blend" style={{marginLeft:6,fontSize:11,color:"#F59E0B"}}>🔒</span>}
                                    {f._isSwapTarget && (
                                      <span title="Swapped in from another flower" style={{marginLeft:6,fontSize:11,padding:"1px 6px",borderRadius:8,background:"rgba(251,191,36,0.18)",color:"#B45309",fontWeight:600}}>
                                        🔄 swap
                                      </span>
                                    )}
                                    {(dcFloralColorPrefs[fnIdx]?.[f.flowerId]||[]).length > 0 && (
                                      <div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>
                                        {(dcFloralColorPrefs[fnIdx][f.flowerId]).map((p,pi) => (
                                          <span key={p.variantId} style={{fontSize:10,padding:"1px 6px",borderRadius:6,fontWeight:600,
                                            background: pi===0?"rgba(192,132,252,0.20)":pi===1?"rgba(168,85,247,0.12)":"rgba(107,114,128,0.12)",
                                            color: pi===0?"#9333EA":pi===1?"#A855F7":"#9CA3AF"}}>
                                            {pi===0?`🎨 ${p.label} ₹${Math.round(p.rate)}`:pi===1?`2nd ${p.label}`:`3rd ${p.label}`}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{f.totalQty.toFixed(2)} {f.unit}</td>
                                  <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(f.unitPrice).toLocaleString("en-IN")}/{f.unit}</td>
                                  <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontVariantNumeric:"tabular-nums",fontWeight:600}}>₹{Math.round(f.totalQty * f.unitPrice).toLocaleString("en-IN")}</td>
                                  <td style={{padding:"6px 4px",textAlign:"right"}}>
                                    <div style={{display:"flex",gap:4,justifyContent:"flex-end",flexWrap:"wrap"}}>
                                      {fnIdx === activeFnIdx && (
                                        <>
                                          <button className="dcf-btn" onClick={()=>setDcPrefModal({ fnIdx, flowerId: f.flowerId, flowerName: f.name })}
                                            title="Pick colour + set preferences (top 3)"
                                            style={{fontSize:12,padding:"2px 6px",borderRadius:7,cursor:"pointer",
                                              border:(dcFloralColorPrefs[fnIdx]?.[f.flowerId]?.length>0)?"1px solid #C084FC":"1px solid rgba(192,132,252,0.40)",
                                              background:(dcFloralColorPrefs[fnIdx]?.[f.flowerId]?.length>0)?"rgba(192,132,252,0.20)":"rgba(192,132,252,0.06)",color:"#9333EA",fontWeight:500}}>
                                            🎨
                                          </button>
                                          <button className="dcf-btn" onClick={()=>setDcSwapModal({ fnIdx, parentId: f.flowerId, currentRow: f })}
                                            title="Swap flower"
                                            style={{fontSize:12,padding:"2px 6px",borderRadius:7,cursor:"pointer",
                                              border:"1px solid rgba(251,191,36,0.40)",
                                              background:"rgba(251,191,36,0.06)",color:"#B45309",fontWeight:500}}>
                                            🔄
                                          </button>
                                        </>
                                      )}
                                      <button className="dcf-btn" onClick={()=>setDcFloralCalcOpen(p=>({...p,[fKey]:!p[fKey]}))}
                                        style={{fontSize:12,padding:"2px 8px",borderRadius:7,cursor:"pointer",
                                          border:open?"1px solid #A78BFA":"1px solid rgba(167,139,250,0.40)",
                                          background:open?"rgba(124,58,237,0.20)":"rgba(124,58,237,0.08)",color:"#7C3AED",fontWeight:500}}>
                                        {open?"× hide":"🧮 how"}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {open && (
                                  <tr style={{borderBottom:`1px solid ${border}33`}}>
                                    <td colSpan={5} style={{padding:"4px 4px 10px"}}>
                                      <div style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                        <div style={{fontSize:11,color:"#7C3AED",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>How {f.totalQty.toFixed(2)} {f.unit} of {f.name} derived</div>
                                        {(!f.contributors || f.contributors.length === 0) ? (
                                          <div style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No element contributors recorded.</div>
                                        ) : (
                                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                                            <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                              <th style={{textAlign:"left",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>Element</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>El qty</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>×</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>per pattern</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>×</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>real %</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:"#1A1A2E",fontWeight:500}}>= contrib</th>
                                            </tr></thead>
                                            <tbody>
                                              {f.contributors.map((c, ci) => (
                                                <tr key={ci}>
                                                  <td style={{padding:"4px 4px",color:"#1A1A2E"}}>{c.elName}<span style={{color:"#1A1A2E",fontSize:11,marginLeft:4,textTransform:"capitalize"}}>({c.zoneKey})</span></td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{c.elQty}</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E"}}>×</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{c.perPattern} {f.unit}</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E"}}>×</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{Math.round(c.realFrac*100)}%</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{c.contribution.toFixed(2)} {f.unit}</td>
                                                </tr>
                                              ))}
                                              <tr style={{borderTop:`1px solid ${border}`}}>
                                                <td colSpan={6} style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E"}}>Sum:</td>
                                                <td style={{textAlign:"right",padding:"4px 4px",color:"#B45309",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{f.totalQty.toFixed(2)} {f.unit}</td>
                                              </tr>
                                              <tr>
                                                <td colSpan={6} style={{textAlign:"right",padding:"4px 4px",color:"#1A1A2E"}}>× ₹{Math.round(f.unitPrice)}/{f.unit} =</td>
                                                <td style={{textAlign:"right",padding:"4px 4px",color:"#10B981",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(f.totalQty * f.unitPrice).toLocaleString("en-IN")}</td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        )}
                                        <div style={{marginTop:8,paddingTop:6,borderTop:`1px dashed ${border}`,fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>Σ(element qty × per-pattern recipe × real %) summed across all elements using this flower</div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              );})}
                              <tr style={{borderTop:`1px solid rgba(16,185,129,0.22)`}}><td colSpan={3} style={{padding:"11px 4px 4px",textAlign:"right",color:"#1A1A2E",fontWeight:600}}>Real Total</td><td style={{padding:"11px 4px 4px",textAlign:"right",color:"#10B981",fontWeight:700,fontSize:14,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(totalReal).toLocaleString("en-IN")}</td><td></td></tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                        </div>{/* ── left column ends ── */}
                        <div style={{flex:"1 1 300px",minWidth:0,maxWidth:400,display:"flex",flexDirection:"column",gap:14}}>
                      {/* Artificial cost summary — Tier 1.9 bunch model */}
                      {(() => {
                        const totalArtBunchesFlower = elementBreakdown.reduce((s,e)=>s+(e.artBunchesFlower||0),0);
                        const totalArtBunchesGreen = elementBreakdown.reduce((s,e)=>s+(e.artBunchesGreen||0),0);
                        const flowerKg = totalArtBunchesFlower / (Number(dealCheckData?.artificialFlowerBunchesPerKg ?? 16) || 16);
                        const greenKg = totalArtBunchesGreen / (Number(dealCheckData?.artificialGreenBunchesPerKg ?? 23) || 23);
                        const flowerRate = Number(dealCheckData?.artificialFlowerRatePerKg ?? 50);
                        const greenRate = Number(dealCheckData?.artificialGreenRatePerKg ?? 40);
                        const flowerCost = flowerKg * flowerRate;
                        const greenCost = greenKg * greenRate;
                        const missingRatios = elementBreakdown.reduce((acc,e)=>{
                          (e.artLines||[]).forEach(al=>{ if(!al.realOnly && al.missingRatio && al.realUnitsReplaced > 0) acc.add(al.name); });
                          return acc;
                        }, new Set());
                        // IMS Mandi "Mapping" flowers (real flower → a specific artificial inventory
                        // item) — aggregate across elements, keyed by the mapped item so the same
                        // substitute used by several elements rolls into one row.
                        const mappedAgg = {};
                        elementBreakdown.forEach(e => (e.artLines||[]).forEach(al => {
                          if (!al.isMapped) return;
                          const key = al.mappedName || al.name;
                          if (!mappedAgg[key]) mappedAgg[key] = { mappedName: al.mappedName, realFlowerName: al.name, unit: al.unit, qty: 0, cost: 0 };
                          mappedAgg[key].qty += al.realUnitsReplaced;
                          mappedAgg[key].cost += al.lineCost;
                        }));
                        const mappedList = Object.values(mappedAgg);
                        return (
                          <div className="dcf-card" style={{padding:"14px 16px",borderRadius:14,background:"linear-gradient(180deg,#FFF7FB 0%,#FFFFFF 100%)",border:`1px solid rgba(236,72,153,0.20)`,boxShadow:"0 1px 2px rgba(236,72,153,0.05), 0 8px 20px -14px rgba(236,72,153,0.35)"}}>
                            <div style={{fontSize:13,fontWeight:700,color:"#EC4899",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>🌺 Artificial Bunches</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:13}}>
                              <div style={{padding:"8px 10px",borderRadius:7,background:"rgba(236,72,153,0.06)"}}>
                                <div style={{fontSize:12,color:"#EC4899",fontWeight:600,marginBottom:4}}>🌹 Flower bunches</div>
                                <div style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{totalArtBunchesFlower.toFixed(1)} bunches = <b>{flowerKg.toFixed(2)} kg</b></div>
                                <div style={{fontSize:11,color:"#1A1A2E",marginTop:2}}>× ₹{flowerRate}/kg = <span style={{color:"#EC4899",fontWeight:600}}>₹{Math.round(flowerCost).toLocaleString("en-IN")}</span></div>
                              </div>
                              <div style={{padding:"8px 10px",borderRadius:7,background:"rgba(16,185,129,0.06)"}}>
                                <div style={{fontSize:12,color:"#10B981",fontWeight:600,marginBottom:4}}>🌿 Green bunches</div>
                                <div style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{totalArtBunchesGreen.toFixed(1)} bunches = <b>{greenKg.toFixed(2)} kg</b></div>
                                <div style={{fontSize:11,color:"#1A1A2E",marginTop:2}}>× ₹{greenRate}/kg = <span style={{color:"#10B981",fontWeight:600}}>₹{Math.round(greenCost).toLocaleString("en-IN")}</span></div>
                              </div>
                            </div>
                            {mappedList.length > 0 && (
                              <div style={{marginTop:10,padding:"8px 10px",borderRadius:7,background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.2)"}}>
                                <div style={{fontSize:12,color:"#3B82F6",fontWeight:600,marginBottom:4}}>🔗 Mapped substitutes</div>
                                {mappedList.map((m, mi) => (
                                  <div key={mi} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"2px 0",color:"#1A1A2E"}}>
                                    <span>{m.realFlowerName} → {m.mappedName || "no item mapped"} × {m.qty.toFixed(1)} {m.unit}</span>
                                    <span style={{color:"#3B82F6",fontWeight:600}}>₹{Math.round(m.cost).toLocaleString("en-IN")}</span>
                                  </div>
                                ))}
                                {mappedList.some(m => !m.mappedName) && <div style={{fontSize:11,color:"#F59E0B",marginTop:2,fontStyle:"italic"}}>⚠ Some mapped flowers have no inventory item picked yet — set in IMS Mandi tab</div>}
                              </div>
                            )}
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:8,borderTop:`1px solid ${border}`}}>
                              <span style={{fontSize:13,color:"#1A1A2E",fontWeight:500}}>Total Artificial</span>
                              <span style={{color:"#EC4899",fontWeight:700,fontSize:15.5,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(totalArtificial).toLocaleString("en-IN")}</span>
                            </div>
                            {/* §26 — Artificial flower color split */}
                            <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed rgba(236,72,153,0.2)`,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:12,color:"#EC4899",fontWeight:700}}>🎨 Color Split</span>
                              {fnArtAlloc.length > 0 ? <>
                                {fnArtAlloc.map((a, ai) => <span key={ai} style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:600,display:"flex",alignItems:"center",gap:4}}>{a.photo&&<img src={a.photo} alt="" style={{width:14,height:14,borderRadius:3,objectFit:"cover"}}/>}{a.colour} {a.qty}kg</span>)}
                                {fnArtAllocTotal < totalArtKg && <span style={{fontSize:11,color:"#F59E0B",fontWeight:600}}>{Math.round((totalArtKg - fnArtAllocTotal) * 10) / 10}kg unassigned</span>}
                              </> : <span style={{fontSize:11,color:"#1A1A2E"}}>No split — any color</span>}
                              <button className="dcf-btn" onClick={() => setDcArtFlowerModal({ fnIdx, totalKg: totalArtKg })} style={{fontSize:11,padding:"4px 12px",borderRadius:6,border:`1px solid rgba(236,72,153,0.3)`,background:"rgba(236,72,153,0.10)",color:"#EC4899",fontWeight:700,cursor:"pointer",marginLeft:"auto"}}>🌸 Split Colors</button>
                            </div>
                            {missingRatios.size > 0 && (
                              <div style={{fontSize:11,color:"#F59E0B",marginTop:6,fontStyle:"italic"}}>⚠ Missing Art Bunches/Unit (or mapped item cost) on: {Array.from(missingRatios).join(", ")} — set in IMS Mandi tab</div>
                            )}
                          </div>
                        );
                      })()}
                      {/* ═══ DIRECT FROM INVENTORY ═══
                          Recipe ingredients sourced from an IMS inventory item rather than from the
                          mandi — realLines carries invItem:true on exactly those (set where
                          fl.invItemId is handled). They are already inside the Real total; this does
                          not add a cost, it names one that had nowhere to be read.
                          They behave differently from every other flower here and that is worth
                          seeing: a physical rented piece is sourced the same way whatever the
                          real/artificial slider says, so it counts in FULL and never appears in the
                          artificial split above.
                          Aggregated by item across every element, so one stand used by six elements
                          is one row rather than six. */}
                      {(() => {
                        const invAgg = {};
                        elementBreakdown.forEach(e => (e.artLines || []).forEach(rl => {
                          if (!rl.invItem) return;
                          const key = rl.flowerId || rl.name;
                          if (!invAgg[key]) invAgg[key] = { name: rl.name, unit: rl.unit, unitPrice: rl.unitPrice, qty: 0, cost: 0 };
                          invAgg[key].qty += rl.qty || 0;
                          invAgg[key].cost += rl.lineCost || 0;
                        }));
                        const invList = Object.values(invAgg);
                        if (invList.length === 0) return null;
                        const invTotal = invList.reduce((s, r) => s + r.cost, 0);
                        return (
                          <div className="dcf-card" style={{marginTop:14,padding:"14px 16px",borderRadius:14,background:"linear-gradient(180deg,#F5F9FF 0%,#FFFFFF 100%)",border:"1px solid rgba(59,130,246,0.22)",boxShadow:"0 1px 2px rgba(59,130,246,0.05), 0 8px 20px -14px rgba(59,130,246,0.35)"}}>
                            <div style={{fontSize:13,fontWeight:700,color:"#3B82F6",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>📦 Direct from Inventory</div>
                            {invList.map((r, ri) => (
                              <div key={ri} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#1A1A2E",padding:"3px 0"}}>
                                <span style={{fontWeight:600}}>{r.name}</span>
                                <span style={{opacity:0.7,fontVariantNumeric:"tabular-nums"}}>× {Math.round(r.qty * 100) / 100} {r.unit}</span>
                                {r.unitPrice > 0 && <span style={{opacity:0.7,fontSize:11.5}}>@ ₹{Math.round(r.unitPrice).toLocaleString("en-IN")}</span>}
                                <span style={{marginLeft:"auto",color:"#3B82F6",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(r.cost).toLocaleString("en-IN")}</span>
                              </div>
                            ))}
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:9,paddingTop:8,borderTop:`1px solid ${border}`}}>
                              <span style={{fontSize:13,color:"#1A1A2E",fontWeight:500}}>Total from Inventory</span>
                              <span style={{color:"#3B82F6",fontWeight:700,fontSize:15.5,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(invTotal).toLocaleString("en-IN")}</span>
                            </div>
                            {/* Said plainly, because the number above is ALREADY inside Artificial —
                                without this line the two totals look like they should add up and
                                do not. */}
                            <div style={{fontSize:11,color:"#1A1A2E",opacity:0.65,marginTop:6,fontStyle:"italic"}}>
                              Included in Total Artificial above — these are manufactured pieces charged in full, so the real/artificial blend does not scale them.
                            </div>
                          </div>
                        );
                      })()}
                      {/* Floral elements this tab could not price. They ARE costed — Inventory bills
                          them as plain rental — but not as flower recipes, so they never reach the
                          mandi list or the real/artificial split. Shown so the count above cannot
                          quietly disagree with the build. */}
                      {uncosted.length > 0 && (
                        <div className="dcf-card" style={{marginTop:14,padding:"12px 14px",borderRadius:14,border:"1px solid rgba(245,158,11,0.35)",background:"linear-gradient(180deg,#FFFBF2 0%,#FFFFFF 100%)",boxShadow:"0 1px 2px rgba(245,158,11,0.06), 0 8px 20px -14px rgba(245,158,11,0.4)"}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#F59E0B",marginBottom:6}}>
                            ⚠ {uncosted.length} element{uncosted.length===1?"":"s"} not costed as florals
                          </div>
                          {uncosted.map((u,ui)=>(
                            <div key={ui} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#1A1A2E",padding:"2px 0"}}>
                              <span style={{color:"#1A1A2E",fontWeight:600}}>{u.name}</span>
                              <span style={{opacity:0.7}}>{u.zoneKey} · ×{u.qty}</span>
                              <span style={{marginLeft:"auto",color:"#F59E0B"}}>{u.reason}</span>
                            </div>
                          ))}
                          <div style={{fontSize:12,color:"#1A1A2E",marginTop:6,fontStyle:"italic"}}>
                            Add these to the Rate Card under “florals” to price them from a flower recipe. Until then they bill as rental.
                          </div>
                        </div>
                      )}
                      {/* Per-element breakdown — merged by name (§26.19) */}
                      {(()=>{
                        // Merge same-name elements across zones
                        const merged = [];
                        const byName = {};
                        elementBreakdown.forEach((eb, ebi) => {
                          // Plain inventory props with no recipe live on the Inventory tab already —
                          // their cost is still folded into totalReal/totalArtificial above, just not
                          // shown again here as a "no pattern" row (there was never a pattern to have).
                          if (eb.isInvOnlyNoPattern) return;
                          if (!byName[eb.name]) { byName[eb.name] = { name: eb.name, zones: [], totalQty: 0, realPct: eb.realPct, realCost: 0, artCost: 0, total: 0, hasPattern: false, invCost: 0, entries: [] }; merged.push(byName[eb.name]); }
                          const g = byName[eb.name];
                          g.zones.push(eb.zoneKey);
                          g.totalQty += (eb.qty || 0);
                          g.realCost += (eb.realCost || 0);
                          // How much of this row's Real ₹ is a rented inventory piece rather than
                          // flowers. Carried so the Real column can say so — see the badge below.
                          g.invCost += (eb.artLines || []).reduce((s, rl) => s + (rl.invItem ? (rl.lineCost || 0) : 0), 0);
                          g.artCost += (eb.artCost || 0);
                          g.total += (eb.total || 0);
                          if (eb.hasPattern) g.hasPattern = true;
                          g.entries.push({ ...eb, _origIdx: ebi });
                        });
                        return (
                      <div className="dcf-card" style={{padding:"14px 16px",borderRadius:14,background:"#FFFFFF",border:`1px solid ${border}`,boxShadow:"0 1px 2px rgba(26,26,46,0.04), 0 8px 20px -14px rgba(26,26,46,0.30)"}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>📋 Per-Element Breakdown ({merged.length} element{merged.length===1?"":"s"}{merged.length !== elementBreakdown.length ? ` · ${elementBreakdown.length} rows` : ""})</div>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                          <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                            <th style={{textAlign:"left",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Element</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Qty</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Real %</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Real ₹</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Artif ₹</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:"#1A1A2E",letterSpacing:0.4}}>Total</th>
                            <th style={{width:60}}></th>
                          </tr></thead>
                          <tbody>
                            {merged.map((mg, mgi) => {
                              const eKey = `el:${mgi}`;
                              const open = !!dcFloralCalcOpen[eKey];
                              const zoneLabel = [...new Set(mg.zones)].join(", ");
                              return (
                              <Fragment key={mgi}>
                              <tr className="dcf-row" style={{borderBottom:open?"none":`1px solid ${border}33`}}>
                                <td style={{padding:"6px 4px",color:"#1A1A2E"}}>{mg.name}{!mg.hasPattern && <span title="No IMS pattern" style={{marginLeft:6,fontSize:11,color:"#F59E0B"}}>⚠</span>}{mg.zones.length > 1 && <div style={{fontSize:11,color:"#1A1A2E",marginTop:1}}>{zoneLabel}</div>}{mg.zones.length === 1 && <span style={{fontSize:11,color:"#1A1A2E",marginLeft:6}}>{zoneLabel}</span>}</td>
                                <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{mg.totalQty}</td>
                                <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{mg.realPct}%</td>
                                <td style={{padding:"6px 4px",color:"#10B981",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(mg.realCost).toLocaleString("en-IN")}</td>
                                {/* No badge on this figure. Inventory pieces are named in their own
                                    "Direct from Inventory" section above and marked in the "how"
                                    panel, so the point was already made twice; a third mark on every
                                    affected row was noise in a column of numbers.
                                    mg.invCost is still computed — the tooltip is gone, not the fact. */}
                                <td style={{padding:"6px 4px",color:"#EC4899",textAlign:"right",fontVariantNumeric:"tabular-nums"}}
                                  title={mg.invCost > 0 ? `Includes ₹${Math.round(mg.invCost).toLocaleString("en-IN")} of inventory pieces, charged in full` : undefined}>
                                  ₹{Math.round(mg.artCost).toLocaleString("en-IN")}
                                </td>
                                <td style={{padding:"6px 4px",color:"#1A1A2E",textAlign:"right",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(mg.total).toLocaleString("en-IN")}</td>
                                <td style={{padding:"6px 4px",textAlign:"right"}}>
                                  <button className="dcf-btn" onClick={()=>setDcFloralCalcOpen(p=>({...p,[eKey]:!p[eKey]}))}
                                    style={{fontSize:12,padding:"2px 8px",borderRadius:7,cursor:"pointer",
                                      border:open?"1px solid #A78BFA":"1px solid rgba(167,139,250,0.40)",
                                      background:open?"rgba(124,58,237,0.20)":"rgba(124,58,237,0.08)",color:"#7C3AED",fontWeight:500}}>
                                    {open?"× hide":"🧮 how"}
                                  </button>
                                </td>
                              </tr>
                              {open && mg.entries.map((eb, si) => (
                                <tr key={`sub-${si}`} style={{borderBottom:si===mg.entries.length-1?`1px solid ${border}33`:"none"}}>
                                  <td colSpan={7} style={{padding:"4px 4px 10px"}}>
                                    <div style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                      <div style={{fontSize:11,color:"#7C3AED",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>How ₹{Math.round(eb.total).toLocaleString("en-IN")} for {eb.name} · {eb.zoneKey} × {eb.qty} derived</div>

                                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:12}}>
                                        {/* Real side */}
                                        <div>
                                          <div style={{color:"#10B981",fontWeight:600,marginBottom:5}}>● Real flowers ({eb.realPct}% blend × {eb.qty} pattern{eb.qty===1?"":"s"}{(eb.realLines||[]).some(rl=>rl.realOnly&&!rl.invItem) ? " + 🔒 100% items":""})</div>
                                          {/* realLines is flowers only now — inventory ingredients are
                                              costed on the artificial side, so nothing needs filtering
                                              out of this table and its rows add up to its subtotal. */}
                                          {(()=>{ const mandiLines=(eb.realLines||[]);
                                                  const invLines=(eb.artLines||[]).filter(rl=>rl.invItem);
                                                  const invCost=invLines.reduce((s,rl)=>s+(rl.lineCost||0),0);
                                          return (
                                          (mandiLines.length === 0) ? (
                                            <div style={{color:"#1A1A2E",fontStyle:"italic"}}>
                                              {invLines.length > 0
                                                ? `No fresh flowers — ₹${Math.round(invCost).toLocaleString("en-IN")} of inventory pieces is costed as artificial.`
                                                : eb.hasPattern ? "Recipe has no flowers." : "No IMS pattern found — Real ₹0."}
                                            </div>
                                          ) : (
                                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                                              <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                <th style={{textAlign:"left",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Flower</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Per pattern</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Total qty</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Cost</th>
                                              </tr></thead>
                                              <tbody>
                                                {mandiLines.map((rl, ri) => (
                                                  <tr key={ri}>
                                                    <td style={{padding:"3px 2px",color:"#1A1A2E"}}>{rl.name}{rl.realOnly && <span title="Real Only — 100% always" style={{marginLeft:4,fontSize:11,color:"#F59E0B"}}>🔒</span>}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{rl.perPattern} {rl.unit}{rl.realOnly && <span style={{marginLeft:3,fontSize:10,color:"#F59E0B"}}>×100%</span>}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{rl.qty.toFixed(2)} {rl.unit}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#10B981",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(rl.lineCost).toLocaleString("en-IN")}</td>
                                                  </tr>
                                                ))}
                                                <tr style={{borderTop:`1px solid ${border}`}}>
                                                  <td colSpan={3} style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E"}}>Real subtotal:</td>
                                                  <td style={{textAlign:"right",padding:"3px 2px",color:"#10B981",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.realCost).toLocaleString("en-IN")}</td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          )); })()}
                                        </div>
                                        {/* Artificial side */}
                                        <div>
                                          <div style={{color:"#EC4899",fontWeight:600,marginBottom:5}}>● Artificial bunches ({100-eb.realPct}% × {eb.qty} pattern{eb.qty===1?"":"s"})</div>
                                          {eb.artCost <= 0 ? (
                                            <div style={{color:"#1A1A2E",fontStyle:"italic"}}>{(!eb.artLines || eb.artLines.length === 0) ? "No artificial (100% real, no recipe, or bunches/unit not set on flowers)." : "Set Art Bunches/Unit on flowers in IMS Mandi tab."}</div>
                                          ) : (
                                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                                              <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                <th style={{textAlign:"left",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Flower</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Real replaced</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Bunches</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontWeight:500}}>Cost</th>
                                              </tr></thead>
                                              <tbody>
                                                {/* invItem is checked BEFORE realOnly. Inventory lines
                                                    carry realOnly:true (they are never scaled by the
                                                    blend), and realOnly rows print "—" for cost — but
                                                    an inventory line DOES contribute to Art subtotal,
                                                    so printing "—" left the rows visibly short of the
                                                    total beneath them. It has no bunches and replaces
                                                    no real units, so those two columns stay blank. */}
                                                {(eb.artLines || []).map((al, ai) => (
                                                  <tr key={ai}>
                                                    <td style={{padding:"3px 2px",color:al.invItem?"#3B82F6":(al.realOnly?textS:"#000")}}>{al.name}<span style={{fontSize:11,marginLeft:4,color:al.invItem?"#3B82F6":(al.realOnly?"#F59E0B":(al.isGreen?"#10B981":"#EC4899"))}}>{al.invItem?"📦":(al.realOnly?"🔒":(al.isGreen?"🌿":"🌹"))}</span></td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{al.invItem ? <span style={{fontSize:11,fontStyle:"italic",color:textS}}>{al.qty} {al.unit}</span> : al.realOnly ? <span style={{fontSize:11,fontStyle:"italic"}}>skipped</span> : `${al.realUnitsReplaced.toFixed(2)} ${al.unit}`}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:al.realOnly?textS:(al.missingRatio?"#F59E0B":"#000"),fontVariantNumeric:"tabular-nums"}}>{al.realOnly ? "—" : (al.missingRatio?"⚠ ratio?":al.bunches.toFixed(1))}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:al.invItem?"#3B82F6":(al.realOnly?textS:(al.isGreen?"#10B981":"#EC4899")),fontVariantNumeric:"tabular-nums"}}>{al.invItem ? `₹${Math.round(al.lineCost).toLocaleString("en-IN")}` : al.realOnly ? "—" : `₹${Math.round(al.lineCost).toLocaleString("en-IN")}`}</td>
                                                  </tr>
                                                ))}
                                                <tr style={{borderTop:`1px solid ${border}`}}>
                                                  <td colSpan={3} style={{textAlign:"right",padding:"3px 2px",color:"#1A1A2E"}}>Art subtotal:</td>
                                                  <td style={{textAlign:"right",padding:"3px 2px",color:"#EC4899",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.artCost).toLocaleString("en-IN")}</td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          )}
                                          {eb.artCost > 0 && (
                                            <div style={{marginTop:5,fontSize:11,color:"#1A1A2E",fontStyle:"italic"}}>
                                              {eb.artBunchesFlower > 0 && <div>🌹 {eb.artBunchesFlower.toFixed(1)} flower bunches × ₹{eb.flowerPerBunchRate?.toFixed(2)}/bunch</div>}
                                              {eb.artBunchesGreen > 0 && <div>🌿 {eb.artBunchesGreen.toFixed(1)} green bunches × ₹{eb.greenPerBunchRate?.toFixed(2)}/bunch</div>}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div style={{marginTop:10,paddingTop:8,borderTop:`1px dashed ${border}`,display:"flex",justifyContent:"space-between",fontSize:13}}>
                                        <span style={{color:"#1A1A2E"}}>Total ({eb.zoneKey} × {eb.qty})</span>
                                        <span style={{color:"#B45309",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.total).toLocaleString("en-IN")}</span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              </Fragment>
                            );})}
                          </tbody>
                        </table>
                      </div>
                        );
                      })()}
                        </div>{/* ── right column ends ── */}
                      </div>{/* content layer */}
                    </div>
                  );
      })()}
      {/* ═══ §26.12 / Tier 2.1 — 🎨 Colour pick modal (legacy single-pick) ═══ */}
      {dcColorModal && (() => {
        const mandiCat = dealCheckData?.mandiCatalogue || [];
        const parent = resolveMandiFlower(dcColorModal.parentId, mandiCat)?.parent;
        if (!parent) {
          return (
            <div onClick={()=>setDcColorModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:"#FFFFFF",borderRadius:14,border:`1px solid ${border}`,color:"#1A1A2E",fontSize:13.5}}>Parent flower not found in mandi. <button className="dcf-btn" onClick={()=>setDcColorModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:13,cursor:"pointer"}}>Close</button></div>
            </div>
          );
        }
        const variants = Array.isArray(parent.colorVariants) ? parent.colorVariants : [];
        const currentVariantId = dcColorModal.currentRow?.variantPicked?.variantId || null;
        const applyVariant = (variant) => {
          // Update floralOverrides.rows: add or update the row for this parentId with colorVariant
          setFloralOverrides(prev => {
            const rows = Array.isArray(prev?.rows) ? [...prev.rows] : [];
            const idx = rows.findIndex(r => r?.flowerId === dcColorModal.parentId && !r?.swapTo);
            const newRow = idx >= 0 ? { ...rows[idx] } : { flowerId: dcColorModal.parentId, qty: dcColorModal.currentRow?.totalQty || 0 };
            if (variant) {
              newRow.colorVariant = {
                variantId: variant.variantId,
                label: variant.name || "",
                photoUrl: variant.photoUrl || null,
                rate: Number(variant.currentPrice) || 0
              };
            } else {
              delete newRow.colorVariant; // None / lowest
            }
            if (idx >= 0) rows[idx] = newRow; else rows.push(newRow);
            return { note: prev?.note || "", rows };
          });
          setDcColorModal(null);
        };
        return (
          <div onClick={()=>setDcColorModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{width:"min(640px, 100%)",maxHeight:"82vh",background:"#FFFFFF",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:14.5,fontWeight:700,color:"#1A1A2E",letterSpacing:0.2}}>🎨 Pick colour for {parent.name}</div>
                  <div style={{fontSize:12,color:"#1A1A2E",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{variants.length} variant{variants.length===1?"":"s"} available · pick affects pricing only</div>
                </div>
                <button className="dcf-btn" onClick={()=>setDcColorModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,cursor:"pointer",lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:"14px 18px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))",gap:10}}>
                {/* None / lowest (default) */}
                <div onClick={()=>applyVariant(null)}
                  style={{cursor:"pointer",padding:12,borderRadius:10,border:currentVariantId===null?"2px solid #C084FC":`1px solid ${border}`,background:currentVariantId===null?"rgba(192,132,252,0.12)":"rgba(26, 26, 46,0.03)",display:"flex",flexDirection:"column",gap:6,minHeight:120}}>
                  <div style={{width:"100%",height:50,borderRadius:6,background:"rgba(26, 26, 46,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#1A1A2E"}}>📊</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E"}}>None / lowest</div>
                  <div style={{fontSize:11,color:"#1A1A2E"}}>Uses ₹{Math.round(parent.currentPrice||0).toLocaleString("en-IN")} (lowest variant)</div>
                </div>
                {variants.length === 0 ? (
                  <div style={{gridColumn:"2 / -1",padding:30,textAlign:"center",color:"#1A1A2E",fontSize:13,fontStyle:"italic"}}>No colour variants set up for this flower in IMS yet.</div>
                ) : variants.map(v => {
                  const isSelected = currentVariantId === v.variantId;
                  return (
                    <div key={v.variantId} onClick={()=>applyVariant(v)}
                      style={{cursor:"pointer",padding:12,borderRadius:10,border:isSelected?"2px solid #C084FC":`1px solid ${border}`,background:isSelected?"rgba(192,132,252,0.12)":"rgba(26, 26, 46,0.03)",display:"flex",flexDirection:"column",gap:6,minHeight:120}}>
                      {v.photoUrl ? (
                        <img src={v.photoUrl} alt={v.name||""} style={{width:"100%",height:50,objectFit:"cover",borderRadius:6,background:"#1A1A2E"}} />
                      ) : (
                        <div style={{width:"100%",height:50,borderRadius:6,background:"rgba(26, 26, 46,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#1A1A2E"}}>🌸</div>
                      )}
                      <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",lineHeight:1.2}}>{v.name || "Unnamed"}</div>
                      <div style={{fontSize:12,color:"#9333EA",fontWeight:600}}>₹{Math.round(Number(v.currentPrice)||0).toLocaleString("en-IN")}/{parent.unit||"unit"}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"10px 18px",borderTop:`1px solid ${border}`,fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>Purchase manager may substitute on the day based on mandi availability — your pick is a preference, not a lock.</div>
            </div>
          </div>
        );
      })()}
      {/* ═══ §26.12 — ⭐ Flower Color Preference Modal (31 May 2026) ═══ */}
      {/* Salesperson ranks top 3 color preferences per flower for purchase manager */}
      {dcPrefModal && (() => {
        const mandiCat = dealCheckData?.mandiCatalogue || [];
        const parent = resolveMandiFlower(dcPrefModal.flowerId, mandiCat)?.parent;
        if (!parent) {
          return (
            <div onClick={()=>setDcPrefModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,color:"#1A1A2E",fontSize:13.5}}>Flower not found in mandi. <button className="dcf-btn" onClick={()=>setDcPrefModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:13,cursor:"pointer"}}>Close</button></div>
            </div>
          );
        }
        const variants = Array.isArray(parent.colorVariants) ? parent.colorVariants : [];
        const { fnIdx, flowerId } = dcPrefModal;
        const prefs = dcFloralColorPrefs[fnIdx]?.[flowerId] || [];
        const prefIds = new Set(prefs.map(p => p.variantId));
        const rankOf = (vid) => prefs.findIndex(p => p.variantId === vid);
        const togglePref = (v) => {
          const existing = rankOf(v.variantId);
          let next;
          if (existing >= 0) {
            next = prefs.filter(p => p.variantId !== v.variantId);
          } else {
            if (prefs.length >= 3) return; // max 3
            next = [...prefs, { variantId: v.variantId, label: v.name || "", photoUrl: v.photoUrl || null, rate: Number(v.currentPrice) || 0 }];
          }
          setDcFloralColorPrefs(prev => ({ ...prev, [fnIdx]: { ...(prev[fnIdx] || {}), [flowerId]: next } }));
        };
        const clearAll = () => {
          setDcFloralColorPrefs(prev => ({ ...prev, [fnIdx]: { ...(prev[fnIdx] || {}), [flowerId]: [] } }));
        };
        const rankLabels = ["1st choice", "2nd choice", "3rd choice"];
        const rankColors = ["#9333EA", "#A855F7", "#6B7280"];
        return (
          <div onClick={()=>setDcPrefModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{width:"min(640px, 100%)",maxHeight:"82vh",background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:14.5,fontWeight:700,color:"#1A1A2E"}}>🎨 Pick colours for {parent.name}</div>
                  <div style={{fontSize:12,color:"#1A1A2E",marginTop:2}}>Tap in order of preference (max 3). 1st choice = selected color + price.</div>
                </div>
                <button className="dcf-btn" onClick={()=>setDcPrefModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,cursor:"pointer"}}>✕</button>
              </div>
              {/* Current ranked preferences */}
              {prefs.length > 0 && (
                <div style={{padding:"10px 18px",borderBottom:`1px solid ${border}`,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  {prefs.map((p, i) => (
                    <div key={p.variantId} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:`1.5px solid ${rankColors[i]}`,background:`${rankColors[i]}15`}}>
                      <span style={{fontSize:13,fontWeight:700,color:rankColors[i]}}>{i+1}</span>
                      {p.photoUrl && <img src={p.photoUrl} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover"}}/>}
                      <span style={{fontSize:13,fontWeight:600,color:"#1A1A2E"}}>{p.label}</span>
                      <span style={{fontSize:11,color:"#1A1A2E"}}>₹{Math.round(p.rate)}</span>
                      <button className="dcf-btn" onClick={()=>togglePref({variantId:p.variantId})} style={{fontSize:12,color:"#EF4444",background:"none",border:"none",cursor:"pointer",padding:0,lineHeight:1}}>✕</button>
                    </div>
                  ))}
                  <button className="dcf-btn" onClick={clearAll} style={{fontSize:11,color:"#1A1A2E",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear all</button>
                </div>
              )}
              {/* Variant grid */}
              <div style={{padding:"14px 18px",overflowY:"auto",flex:1}}>
                {variants.length === 0 ? (
                  <div style={{padding:30,textAlign:"center",color:"#1A1A2E",fontSize:13,fontStyle:"italic"}}>No colour variants set up for {parent.name} in IMS Mandi yet.</div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:10}}>
                    {variants.map(v => {
                      const rank = rankOf(v.variantId);
                      const isSelected = rank >= 0;
                      const isFull = prefs.length >= 3 && !isSelected;
                      return (
                        <div key={v.variantId} onClick={() => !isFull && togglePref(v)}
                          style={{cursor:isFull?"not-allowed":"pointer",padding:10,borderRadius:10,
                            border:isSelected?`2px solid ${rankColors[rank]}`:`1px solid ${border}`,
                            background:isSelected?`${rankColors[rank]}12`:isDark?"rgba(26, 26, 46,0.03)":"#FAFAFA",
                            opacity:isFull?0.4:1,display:"flex",flexDirection:"column",gap:6,position:"relative"}}>
                          {isSelected && (
                            <div style={{position:"absolute",top:-6,right:-6,width:22,height:22,borderRadius:"50%",background:rankColors[rank],color:"#1A1A2E",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,0.3)"}}>{rank+1}</div>
                          )}
                          {v.photoUrl ? (
                            <img src={v.photoUrl} alt={v.name||""} style={{width:"100%",height:50,objectFit:"cover",borderRadius:6,background:isDark?"#1A1A2E":"#eee"}} />
                          ) : (
                            <div style={{width:"100%",height:50,borderRadius:6,background:isDark?"rgba(26, 26, 46,0.05)":"#eee",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#1A1A2E"}}>🌸</div>
                          )}
                          <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",lineHeight:1.2}}>{v.name || "Unnamed"}</div>
                          <div style={{fontSize:12,color:"#F59E0B",fontWeight:600}}>₹{Math.round(Number(v.currentPrice)||0).toLocaleString("en-IN")}/{parent.unit||"unit"}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,color:"#1A1A2E"}}>{prefs.length}/3 selected{prefs.length>0?` · Costing: ₹${Math.round(prefs[0].rate)}/${parent.unit||"unit"}`:""}</span>
                <button className="dcf-btn" onClick={()=>setDcPrefModal(null)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#9333EA",color:"#1A1A2E",fontSize:13.5,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ═══ §26 — 🌸 Artificial Flower Color Picker Modal (30 May 2026) ═══ */}
      {/* Salesperson splits total artificial Kg across colors from IMS inventory */}
      {dcArtFlowerModal && (() => {
        const { fnIdx, totalKg } = dcArtFlowerModal;
        const artItems = (dcInventoryCache || []).filter(it => {
          const sub = (imsField.subcategory(it) || "").toLowerCase().trim();
          return sub.startsWith("artificial flower");
        }).map(it => ({ ...it, _photo: imsField.photos(it)[0] || "", _stock: Math.max(0, (Number(it.qty)||0) - (Number(it.blocked)||0)) }));
        const stockOf = (itemId) => { const it = artItems.find(x => x.id === itemId); return it ? it._stock : Infinity; };
        const draft = dcArtFlowerAlloc[fnIdx] || [];
        const allocated = draft.reduce((s, a) => s + (Number(a.qty) || 0), 0);
        const remaining = Math.round((totalKg - allocated) * 100) / 100;
        const updateDraft = (next) => setDcArtFlowerAlloc(prev => ({ ...prev, [fnIdx]: next }));
        const addItem = (it) => {
          if (draft.some(a => a.itemId === it.id)) return;
          if (remaining <= 0) return;
          const maxAdd = Math.min(remaining, it._stock || 0);
          if (maxAdd <= 0) return;
          updateDraft([...draft, { itemId: it.id, name: it.name, colour: it.name, qty: Math.min(1, maxAdd), photo: it._photo || "" }]);
        };
        const setQty = (idx, val) => {
          const raw = Math.max(0, Number(val) || 0);
          const othersTotal = draft.reduce((s, a, i) => i === idx ? s : s + (Number(a.qty) || 0), 0);
          const maxByTotal = Math.round((totalKg - othersTotal) * 100) / 100;
          const maxByStock = stockOf(draft[idx]?.itemId);
          const clamped = Math.min(raw, maxByTotal, maxByStock);
          updateDraft(draft.map((a, i) => i === idx ? { ...a, qty: clamped } : a));
        };
        const rowMax = (idx) => {
          const othersTotal = draft.reduce((s, a, i) => i === idx ? s : s + (Number(a.qty) || 0), 0);
          return Math.min(Math.round((totalKg - othersTotal) * 100) / 100, stockOf(draft[idx]?.itemId));
        };
        const removeItem = (idx) => updateDraft(draft.filter((_, i) => i !== idx));
        const usedIds = new Set(draft.map(a => a.itemId));
        const available = artItems.filter(it => !usedIds.has(it.id) && (!artFlowerSearch.trim() || (it.name || "").toLowerCase().includes(artFlowerSearch.toLowerCase())));
        return (
          <div onClick={() => setDcArtFlowerModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e => e.stopPropagation()} style={{width:"min(680px, 100%)",maxHeight:"85vh",background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Header */}
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:15.5,fontWeight:700,color:"#1A1A2E"}}>🌸 Artificial Flower Color Split</div>
                  <div style={{fontSize:13,color:"#1A1A2E",marginTop:3}}>Total: <strong>{Math.round(totalKg * 10) / 10} kg</strong> · Allocated: <strong style={{color:remaining <= 0 ? "#10B981" : "#F59E0B"}}>{allocated} kg</strong> · Remaining: <strong>{remaining} kg</strong></div>
                </div>
                <button className="dcf-btn" onClick={() => setDcArtFlowerModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,cursor:"pointer"}}>✕</button>
              </div>
              {/* Current allocation */}
              <div style={{padding:"14px 20px",overflowY:"auto",flex:1}}>
                {draft.length > 0 && <div style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#1A1A2E",letterSpacing:0.5,textTransform:"uppercase",marginBottom:8}}>Current Allocation</div>
                  {draft.map((a, idx) => <div key={a.itemId} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:"rgba(236,72,153,0.06)",border:"1px solid rgba(236,72,153,0.2)",marginBottom:6}}>
                    {a.photo ? <img src={a.photo} alt="" style={{width:40,height:40,borderRadius:6,objectFit:"cover"}} /> : <div style={{width:40,height:40,borderRadius:6,background:"rgba(236,72,153,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🌸</div>}
                    <div style={{flex:1}}>
                      <div style={{fontSize:13.5,fontWeight:600,color:"#1A1A2E"}}>{a.colour || a.name}</div>
                      <div style={{fontSize:11,color:"#1A1A2E"}}>{a.name}</div>
                    </div>
                    <input type="number" value={a.qty} min={0} max={rowMax(idx)} step={0.5} onChange={e => setQty(idx, e.target.value)} style={{width:60,padding:"5px 6px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,fontWeight:700,textAlign:"center"}} />
                    <span style={{fontSize:12,color:"#1A1A2E"}}>kg</span>
                    <button className="dcf-btn" onClick={() => removeItem(idx)} style={{padding:"4px 8px",borderRadius:4,border:"none",background:"rgba(239,68,68,0.15)",color:"#EF4444",fontSize:13,cursor:"pointer",fontWeight:700}}>✕</button>
                  </div>)}
                </div>}
                {remaining > 0 && draft.length > 0 && <div style={{padding:"6px 12px",borderRadius:6,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",fontSize:12,color:"#F59E0B",fontWeight:600,marginBottom:16,textAlign:"center"}}>{remaining} kg unassigned — add more colors or increase quantities</div>}
                {/* Available colors from IMS */}
                <div style={{fontSize:12,fontWeight:700,color:"#1A1A2E",letterSpacing:0.5,textTransform:"uppercase",marginBottom:8}}>Available Colors {available.length === 0 && artItems.length === 0 ? "(none in IMS yet)" : `(${available.length})`}</div>
                {artItems.length > 6 && (
                  <input value={artFlowerSearch} onChange={e => setArtFlowerSearch(e.target.value)} placeholder="🔍 Search flower colour by name…"
                    style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:13.5,marginBottom:10}} />
                )}
                {artItems.length === 0 ? (
                  <div style={{padding:"30px 20px",textAlign:"center",color:"#1A1A2E",fontSize:13,borderRadius:10,border:`1px dashed ${border}`}}>No artificial flower items in IMS inventory yet. Add items with subcategory "Artificial Flowers" in IMS to see them here.</div>
                ) : available.length === 0 ? (
                  <div style={{padding:"16px 20px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>{artFlowerSearch.trim() ? `No colours match "${artFlowerSearch}".` : "All available colors are already added above."}</div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:10}}>
                    {available.map(it => {
                      const hasStock = (it._stock || 0) > 0;
                      return (
                        <div key={it.id} onClick={() => hasStock && addItem(it)} style={{cursor:hasStock?"pointer":"not-allowed",padding:10,borderRadius:10,border:`1px solid ${border}`,background:isDark?"rgba(26, 26, 46,0.03)":"#FAFAFA",opacity:hasStock?1:0.4,display:"flex",flexDirection:"column",gap:6}}>
                          {it._photo ? <img src={it._photo} alt="" style={{width:"100%",height:60,objectFit:"cover",borderRadius:6}} /> : <div style={{width:"100%",height:60,borderRadius:6,background:"rgba(236,72,153,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🌸</div>}
                          <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",lineHeight:1.2}}>{it.name}</div>
                          <div style={{fontSize:11,color:"#1A1A2E"}}>{it._stock || 0} kg stock</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Footer */}
              <div style={{padding:"12px 20px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <button className="dcf-btn" onClick={() => { updateDraft([]); }} style={{fontSize:13,color:"#1A1A2E",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear all</button>
                <button className="dcf-btn" onClick={() => setDcArtFlowerModal(null)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#EC4899",color:"#1A1A2E",fontSize:13.5,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ═══ Tier 2.1 — 🔄 Swap Modal (25 May 2026) ═══ */}
      {/* Lets sales replace one flower with another (same type only). Full = replace all qty, */}
      {/* Split = divert N units to swap target, original keeps the rest. Shows delta preview. */}
      {/* Local form state (dcSwapSearch / dcSwapPicked / dcSwapMode / dcSwapSplitQty) is lifted */}
      {/* to App scope and reset via useEffect on dcSwapModal change. */}
      {dcSwapModal && (() => {
        const mandiCat = dealCheckData?.mandiCatalogue || [];
        const fromParent = resolveMandiFlower(dcSwapModal.parentId, mandiCat)?.parent;
        if (!fromParent) {
          return (
            <div onClick={()=>setDcSwapModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:"#FFFFFF",borderRadius:14,border:`1px solid ${border}`,color:"#1A1A2E",fontSize:13.5}}>Flower not found in mandi. <button className="dcf-btn" onClick={()=>setDcSwapModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:13,cursor:"pointer"}}>Close</button></div>
            </div>
          );
        }
        const fromType = fromParent.flowerType || (fromParent.isGreen ? "green" : "flower");
        // Strict filter: only same flowerType. Locked decision §20.3 + user confirmation (25 May).
        // flower↔flower, green↔green, real_only↔real_only.
        const candidates = mandiCat.filter(p => {
          if (p.id === fromParent.id) return false; // can't swap to self
          const t = p.flowerType || (p.isGreen ? "green" : "flower");
          return t === fromType;
        });
        const totalQty = dcSwapModal.currentRow?.totalQty || 0;
        const fromRate = dcSwapModal.currentRow?.unitPrice || fromParent.currentPrice || 0;
        const filtered = !dcSwapSearch.trim() ? candidates : candidates.filter(p =>
          (p.name||"").toLowerCase().includes(dcSwapSearch.toLowerCase()) ||
          (p.colorVariants||[]).some(v => (v.name||"").toLowerCase().includes(dcSwapSearch.toLowerCase()))
        );
        const swapQty = dcSwapMode === "full" ? totalQty : Math.min(dcSwapSplitQty, totalQty);
        const remainingOriginalQty = dcSwapMode === "full" ? 0 : Math.max(0, totalQty - swapQty);
        const targetRate = dcSwapPicked ? (Number(dcSwapPicked.currentPrice) || 0) : 0;
        const rowDeltaBefore = totalQty * fromRate;
        const rowDeltaAfter = (remainingOriginalQty * fromRate) + (swapQty * targetRate);
        const rowDelta = rowDeltaAfter - rowDeltaBefore;
        const confirmSwap = () => {
          if (!dcSwapPicked || swapQty <= 0) return;
          setFloralOverrides(prev => {
            const rows = Array.isArray(prev?.rows) ? [...prev.rows] : [];
            // Append a swap row — applied during aggregation
            rows.push({
              flowerId: dcSwapPicked.id,
              qty: swapQty,
              swapTo: {
                fromParentId: fromParent.id,
                fromName: fromParent.name,
                toParentId: dcSwapPicked.id,
                toName: dcSwapPicked.name,
                toRate: targetRate,
                qty: swapQty,
                isSplit: dcSwapMode === "split",
                fromOriginalQty: totalQty // for trace
              }
            });
            return { note: prev?.note || "", rows };
          });
          setDcSwapModal(null);
        };
        return (
          <div onClick={()=>setDcSwapModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{width:"min(820px, 100%)",maxHeight:"88vh",background:"#FFFFFF",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:14.5,fontWeight:700,color:"#1A1A2E",letterSpacing:0.2}}>🔄 Swap {fromParent.name}</div>
                  <div style={{fontSize:12,color:"#1A1A2E",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{totalQty.toFixed(2)} {fromParent.unit||""} @ ₹{Math.round(fromRate)} · type-{fromType} · pick a replacement of same type</div>
                </div>
                <button className="dcf-btn" onClick={()=>setDcSwapModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,cursor:"pointer",lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:"12px 18px",borderBottom:`1px solid ${border}`,display:"flex",gap:10,alignItems:"center"}}>
                <input
                  type="text"
                  value={dcSwapSearch}
                  onChange={e=>setDcSwapSearch(e.target.value)}
                  placeholder={"Search " + fromType + " flowers..."}
                  style={{flex:1,padding:"7px 10px",fontSize:13,color:"#1A1A2E",background:"rgba(0,0,0,0.20)",border:`1px solid ${border}`,borderRadius:6,outline:"none"}}
                />
                <div style={{display:"flex",background:"rgba(26, 26, 46,0.06)",borderRadius:8,padding:3}}>
                  {["full","split"].map(m => (
                    <button className="dcf-btn" key={m} onClick={()=>setDcSwapMode(m)} style={{padding:"5px 12px",borderRadius:5,border:"none",cursor:"pointer",fontSize:13,fontWeight:dcSwapMode===m?700:500,background:dcSwapMode===m?"rgba(251,191,36,0.20)":"transparent",color:dcSwapMode===m?"#B45309":textS,letterSpacing:0.3,textTransform:"capitalize"}}>{m}</button>
                  ))}
                </div>
              </div>
              {dcSwapMode === "split" && (
                <div style={{padding:"10px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:13,color:"#1A1A2E"}}>Divert to swap:</div>
                  <input
                    type="number" min={0} max={totalQty} step={0.1}
                    value={dcSwapSplitQty}
                    onChange={e=>setDcSwapSplitQty(Math.max(0, Math.min(totalQty, Number(e.target.value)||0)))}
                    style={{width:90,padding:"5px 8px",fontSize:13,color:"#1A1A2E",background:"rgba(0,0,0,0.20)",border:`1px solid ${border}`,borderRadius:6,outline:"none",fontVariantNumeric:"tabular-nums"}}
                  />
                  <div style={{fontSize:13,color:"#1A1A2E"}}>{fromParent.unit||""}</div>
                  <div style={{fontSize:12,color:"#1A1A2E",marginLeft:"auto"}}>Keeps {remainingOriginalQty.toFixed(2)} {fromParent.unit||""} of original</div>
                </div>
              )}
              <div style={{padding:"14px 18px",overflowY:"auto",flex:1,display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(170px, 1fr))",gap:10}}>
                {filtered.length === 0 ? (
                  <div style={{gridColumn:"1 / -1",padding:30,textAlign:"center",color:"#1A1A2E",fontSize:13,fontStyle:"italic"}}>No matching {fromType} flowers in mandi.</div>
                ) : filtered.map(p => {
                  const isPicked = dcSwapPicked?.id === p.id;
                  const variantCount = (p.colorVariants||[]).length;
                  return (
                    <div key={p.id} onClick={()=>setDcSwapPicked(p)}
                      style={{cursor:"pointer",padding:12,borderRadius:10,border:isPicked?"2px solid #FBBF24":`1px solid ${border}`,background:isPicked?"rgba(251,191,36,0.10)":"rgba(26, 26, 46,0.03)",display:"flex",flexDirection:"column",gap:4}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",lineHeight:1.2}}>{p.name}</div>
                      <div style={{fontSize:11,color:"#1A1A2E"}}>{variantCount} colour{variantCount===1?"":"s"} · {p.unit||""}</div>
                      <div style={{fontSize:13,color:"#B45309",fontWeight:600,marginTop:2}}>₹{Math.round(Number(p.currentPrice)||0).toLocaleString("en-IN")}/{p.unit||"unit"}</div>
                    </div>
                  );
                })}
              </div>
              {/* Delta preview */}
              {dcSwapPicked && (
                <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,background:"rgba(251,191,36,0.04)"}}>
                  <div style={{fontSize:12,color:"#B45309",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:6}}>Preview · {dcSwapMode === "full" ? "Full replace" : "Split"}</div>
                  <div style={{fontSize:13,color:"#1A1A2E",lineHeight:1.7}}>
                    <div>Before: {totalQty.toFixed(2)} {fromParent.unit||""} {fromParent.name} × ₹{Math.round(fromRate)} = <span style={{color:"#1A1A2E",fontWeight:600}}>₹{Math.round(rowDeltaBefore).toLocaleString("en-IN")}</span></div>
                    {dcSwapMode === "full" ? (
                      <div>After: {swapQty.toFixed(2)} {dcSwapPicked.unit||""} {dcSwapPicked.name} × ₹{Math.round(targetRate)} = <span style={{color:"#1A1A2E",fontWeight:600}}>₹{Math.round(rowDeltaAfter).toLocaleString("en-IN")}</span></div>
                    ) : (
                      <>
                        <div>After (original): {remainingOriginalQty.toFixed(2)} {fromParent.unit||""} × ₹{Math.round(fromRate)} = ₹{Math.round(remainingOriginalQty * fromRate).toLocaleString("en-IN")}</div>
                        <div>After (swap): {swapQty.toFixed(2)} {dcSwapPicked.unit||""} {dcSwapPicked.name} × ₹{Math.round(targetRate)} = ₹{Math.round(swapQty * targetRate).toLocaleString("en-IN")}</div>
                        <div>Row total: <span style={{color:"#1A1A2E",fontWeight:600}}>₹{Math.round(rowDeltaAfter).toLocaleString("en-IN")}</span></div>
                      </>
                    )}
                    <div style={{marginTop:5,paddingTop:5,borderTop:`1px dashed ${border}`}}>
                      Row delta: <span style={{color:rowDelta >= 0 ? "#10B981" : "#EF4444",fontWeight:700}}>{rowDelta >= 0 ? "+" : ""}₹{Math.round(rowDelta).toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
              )}
              <div style={{padding:"10px 18px",borderTop:`1px solid ${border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button className="dcf-btn" onClick={()=>setDcSwapModal(null)} style={{padding:"7px 14px",borderRadius:7,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:13,cursor:"pointer",fontWeight:500}}>Cancel</button>
                <button className="dcf-btn" onClick={confirmSwap} disabled={!dcSwapPicked || swapQty <= 0}
                  style={{padding:"7px 14px",borderRadius:7,border:"none",background:(!dcSwapPicked || swapQty<=0)?"rgba(251,191,36,0.20)":"#B45309",color:(!dcSwapPicked || swapQty<=0)?textS:"#0F0F1A",fontSize:13,cursor:(!dcSwapPicked || swapQty<=0)?"not-allowed":"pointer",fontWeight:700,letterSpacing:0.3}}>Confirm swap</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

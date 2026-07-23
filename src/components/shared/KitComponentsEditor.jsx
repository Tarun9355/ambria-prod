import { useState, Fragment } from "react";
import { isHiddenSubcat } from "../../lib/rateCard";
import { studioUnitLabel, matchFlowerPattern, floralPatternUnitRates } from "../../lib/ims/flowerHelpers";
import { kitTotalFromInventory, itemDimsText, priceForInvItem } from "../../lib/ims/helpers";
import ItemHoverThumb from "./ItemHoverThumb";

// Shared "expand a kit element to its components, with editable per-instance counts" block —
// used by Library's Element Breakdown (ManageLibrary.jsx) and the Build page (StudioBuild.jsx) so
// a kit shows the same count-customizable breakdown Deal Check already has (DealCheckOverlay.jsx's
// "📦 Kit — blocks these together" block), scoped down to quantity editing only (no
// availability/swap-to-alternative — those depend on Deal Check's per-date booking context, which
// doesn't exist here).
//
// `overrides` (el.kitOverrides), when set, replaces the kit's own global `item.subItems` recipe for
// THIS element instance only — every other place that kit is used (its own Edit screen, other
// photos/zones) is unaffected. `onChange(nextOverrides)` persists the edit onto the element;
// `onChange(undefined)` resets back to the kit's live default recipe.
export default function KitComponentsEditor({ item, overrides, onChange, imsInventory, flowerPatterns, qtyMultiplier = 1, dealAwareness, rcSubcatFactors, rcFactorByKey, mandiCatalogue = [], studioMarkup = 3, elSize, floralRatio = 0, rcFloralModeByKey = {}, floralSettings = null, textP, textS, border, cardBg, accent, isDark, fmt }) {
  // rcFactorByKey = { subcatLower: scaling_factor } — the pricing multiplier map (priceForInvItem needs
  // this, NOT the rcSubcatFactors array which is for isHiddenSubcat). Fall back to {} so pricing is 1×.
  const _factorMap = (rcFactorByKey && typeof rcFactorByKey === "object" && !Array.isArray(rcFactorByKey)) ? rcFactorByKey : {};
  // Hover-to-zoom on a component thumbnail — same fixed-position enlarged-preview pattern as the
  // Element Breakdown's own thumbnail (ManageLibrary.jsx's elHoverImg), kept local to this component
  // since every caller renders its own independent instance.
  const [hoverImg, setHoverImg] = useState(null); // { idx, top, bottom, left }
  const [addSearch, setAddSearch] = useState("");
  if (!item) return null;
  // A component is either {itemId, qty} (a physical inventory item) or {patternId, qty} (a flower-
  // recipe add-on, qty in the recipe's own unit — priced separately via getElPriceFromInventory,
  // contributes ₹0 to the rental total below).
  const comps = Array.isArray(overrides) ? overrides : (Array.isArray(item.subItems) ? item.subItems.map(s => (s.patternId ? { patternId: s.patternId, qty: Number(s.qty) || 1 } : { itemId: s.itemId, qty: Number(s.qty) || 1 })) : []);
  const isEdited = Array.isArray(overrides);
  const kitBase = Number(item.kitBase) || 0;
  // Kit's own sub-category scaling factor — the same multiplier priceForInvItem applies to the whole
  // kit rental, so per-component "rental × multiplier" and the footer total reflect the real charge.
  const _fKey = String(item.subCat || item.subcategory || "").trim().toLowerCase();
  const _fRaw = _fKey ? _factorMap[_fKey] : undefined;
  const kitFactor = (typeof _fRaw === "number" && isFinite(_fRaw) && _fRaw > 0) ? _fRaw : 1;
  // Recipe (flower) Studio rate for a pattern at the element's size = real mandi cost × markup. Lets a
  // kit that includes a flower recipe show its flower cost here, priced the same way getElPriceFromInventory does.
  const _szKey = (() => { const s = String(elSize || "B").toUpperCase(); return (s === "S" || s === "SMALL") ? "small" : (s === "B" || s === "BIG" || s === "LARGE") ? "big" : "medium"; })();
  // Full artificial-rate settings (art flower/green ₹/kg, bunches/kg, markup) so artRate here matches
  // getElPriceFromInventory's blend byte-for-byte; falls back to just the markup when not provided.
  const _floralSettings = { ...(floralSettings || {}), defaultStudioMarkup: Number(studioMarkup) || (floralSettings?.defaultStudioMarkup) || 3 };
  const recipeRateFor = (pat, subKey) => {
    if (!pat) return 0;
    // Recipe Studio rate blended real/artificial by the global ratio — same as a standalone recipe
    // element (getElPrice). A sub-category floral_mode of real/artificial pins it to 100/0; else it
    // follows the deal's floralRatio. `extra` (pot/base) is added once, un-blended.
    const rates = floralPatternUnitRates(pat, _szKey, mandiCatalogue, _floralSettings, imsInventory);
    if (!rates) return 0;
    const sk = String(subKey || pat.sub || "").trim().toLowerCase();
    const subMode = sk ? rcFloralModeByKey[sk] : undefined;
    const realPct = subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, 100 - (Number(floralRatio) || 0)));
    return Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra;
  };
  // A PLAIN component (an ordinary {itemId,qty} entry, not a patternId add-on) can itself be a
  // floral item (e.g. a pot/planter whose own sub-category carries a flower recipe) — same as a
  // standalone floral element getElPriceFromInventory prices. Unlike a patternId add-on (always
  // priced separately, on top), this component's OWN rental already gets counted by
  // kitTotalFromInventory/priceForInvItem at a flat rate; `blendedUnit` recomputes it the real
  // way (recipe blend + extra + its own rental) so `subOverride.realPct` — this instance's own
  // override, defaulting to the sub-category's mode or the deal's global floralRatio — actually
  // changes its price, exactly like the top-level 🌐 Ratio / 🎯 100% controls do.
  const compFloralInfo = (cItem, override) => {
    if (!cItem) return null;
    const pat = matchFlowerPattern(cItem, flowerPatterns || []);
    if (!pat) return null;
    const rates = floralPatternUnitRates(pat, _szKey, mandiCatalogue, _floralSettings, imsInventory);
    if (!rates) return null;
    const sk = String(cItem.subCat || cItem.subcategory || pat.sub || "").trim().toLowerCase();
    const subMode = sk ? rcFloralModeByKey[sk] : undefined;
    const modeDefault = subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, 100 - (Number(floralRatio) || 0)));
    const realPct = (typeof override?.realPct === "number" && override.realPct >= 0 && override.realPct <= 100) ? override.realPct : modeDefault;
    const flatRental = priceForInvItem(cItem, _factorMap, imsInventory, Array.isArray(override?.subOverrides) ? override.subOverrides : undefined);
    const blendedUnit = Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra + flatRental;
    return { pattern: pat, realPct, modeDefault, blendedUnit, flatRental, patternSMB: pat.mode === "smb" };
  };
  // Delta between the blended price and the flat rental kitTotalFromInventory already counted for
  // any floral-matched plain component — folded into `flowerTotal` (below) rather than double-
  // counting, and a true no-op for the vast majority of components that aren't floral.
  const floralCompDelta = comps.reduce((s, c) => {
    if (c.patternId) return s;
    const cItem = (imsInventory || []).find(i => i.id === c.itemId);
    const info = cItem ? compFloralInfo(cItem, c) : null;
    if (!info) return s;
    return s + (info.blendedUnit - info.flatRental) * (Number(c.qty) || 0);
  }, 0);
  // Rental part, marked up by the kit's factor (matches priceForInvItem / getElPriceFromInventory).
  const rentalMarked = priceForInvItem(item, _factorMap, imsInventory, isEdited ? comps : undefined);
  const kitBaseMarked = Math.round(kitBase * kitFactor);        // the console's OWN charge (base × its factor)
  const itemsMarked = Math.max(0, rentalMarked - kitBaseMarked); // Σ components at their own multipliers
  // Flower recipe part = explicit patternId add-ons + a recipe matched to the kit's OWN sub-category
  // (same two sources getElPriceFromInventory sums), each at the recipe's Studio rate.
  const subCatPattern = matchFlowerPattern(item, flowerPatterns || []);
  const subCatRecipe = subCatPattern ? recipeRateFor(subCatPattern, item.subCat || item.subcategory) : 0;
  const flowerTotal = subCatRecipe + comps.reduce((s, c) => { if (!c.patternId) return s; const pat = (flowerPatterns || []).find(p => p.id === c.patternId); return s + recipeRateFor(pat, pat?.sub) * (Number(c.qty) || 0); }, 0) + floralCompDelta;
  const partsTotal = rentalMarked + flowerTotal;
  const setComps = (next) => onChange(next);
  const resetKit = () => onChange(undefined);
  return (
    <div style={{ marginTop: 6, marginBottom: 4, padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.05)", border: `1px solid rgba(99,102,241,0.25)` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#A5B4FC", letterSpacing: 0.3 }}>📦 Kit — includes:{isEdited && <span style={{ color: "#F59E0B", marginLeft: 5 }}>· edited</span>}</span>
        {isEdited && <span onClick={resetKit} style={{ fontSize: 9, color: textS, cursor: "pointer", textDecoration: "underline" }}>reset to default</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {kitBase > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ width: 22, height: 22, borderRadius: 4, background: isDark ? "rgba(99,102,241,0.14)" : "rgba(99,102,241,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>🧰</span>
            <span style={{ color: textP, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name} <span style={{ color: textS, fontSize: 9, fontStyle: "italic" }}>· this kit's own rental{kitFactor !== 1 ? ` (₹${kitBase.toLocaleString("en-IN")} × ${kitFactor})` : ""}</span></span>
            <span style={{ color: textS, whiteSpace: "nowrap", opacity: 0.85 }} title="the kit/console's own charge (× its sub-category multiplier), on top of the add-on items"><b style={{ color: "#A5B4FC" }}>₹{kitBaseMarked.toLocaleString("en-IN")}</b></span>
          </div>
        )}
        {comps.map((c, ci) => {
          if (c.patternId) {
            const pat = (flowerPatterns || []).find(p => p.id === c.patternId);
            const patQty = Number(c.qty) || 0;
            return (
              <div key={ci} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ width: 22, height: 22, borderRadius: 4, background: isDark ? "rgba(236,72,153,0.12)" : "rgba(236,72,153,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>🌸</span>
                <span style={{ color: pat ? textP : "#EF4444", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pat ? pat.name : `⚠ ${c.patternId} (recipe missing)`}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="per kit">
                  <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: Math.max(0, patQty - 1) } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>−</span>
                  <span style={{ color: textP, minWidth: 20, textAlign: "center" }}>{patQty}{studioUnitLabel(pat?.unit)}</span>
                  <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: patQty + 1 } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>+</span>
                </div>
                {qtyMultiplier > 1 && <span style={{ color: textS, fontSize: 10, whiteSpace: "nowrap" }}>× {qtyMultiplier} = <b style={{ color: textP }}>{patQty * qtyMultiplier}</b></span>}
                {(() => { const rr = recipeRateFor(pat, pat?.sub); return <span style={{ color: textS, whiteSpace: "nowrap", opacity: 0.85 }} title="recipe Studio rate (all-in)"><b style={{ color: "#EC4899" }}>🌸 ₹{(rr * patQty).toLocaleString("en-IN")}</b></span>; })()}
                <span onClick={() => setComps(comps.filter((_, i) => i !== ci))} style={{ color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 2px" }} title="Remove component">×</span>
              </div>
            );
          }
          const cItem = (imsInventory || []).find(i => i.id === c.itemId);
          const cItemIsKit = cItem && Array.isArray(cItem.subItems) && cItem.subItems.length > 0;
          const qtyEach = Number(c.qty) || 0;
          const cSrc = cItem?.img || cItem?.photoUrls?.[0];
          const cFloral = cItem ? compFloralInfo(cItem, c) : null;
          // Floral-matched component prices via the recipe blend (real/artificial ratio); everything
          // else keeps the plain rental × own sub-cat multiplier, honoring this instance's sub-kit edits.
          const cRate = cFloral ? cFloral.blendedUnit : (cItem ? priceForInvItem(cItem, _factorMap, imsInventory, Array.isArray(c.subOverrides) ? c.subOverrides : undefined) : 0);
          return (
            <Fragment key={ci}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <div style={{ position: "relative", flexShrink: 0 }}
                  onMouseEnter={(e) => {
                    if (!cSrc) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const POP = 164;
                    const openUp = window.innerHeight - r.bottom < POP + 8 && r.top > POP + 8;
                    setHoverImg({ idx: ci, openUp, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined, left: Math.min(r.left, window.innerWidth - 168) });
                  }}
                  onMouseLeave={() => setHoverImg(null)}>
                  {cSrc ? <img src={cSrc} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover", cursor: "zoom-in" }} /> : <span style={{ width: 22, height: 22, borderRadius: 4, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>📦</span>}
                  {hoverImg?.idx === ci && cSrc && (
                    <div style={{ position: "fixed", top: hoverImg.top, bottom: hoverImg.bottom, left: hoverImg.left, zIndex: 10000, width: 160, height: 160, borderRadius: 8, overflow: "hidden", border: `2px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                      <img src={cSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  )}
                </div>
                <span style={{ color: cItem ? textP : "#EF4444", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cItem ? cItem.name : `⚠ ${c.itemId} not in IMS`}</span>
                  {cItemIsKit && <span style={{ color: "#A5B4FC", fontWeight: 700, fontSize: 9 }}>📦</span>}
                  {cFloral && (
                    <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700 }}>
                      🌸
                      <button onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, realPct: undefined } : x))} title="Use this sub-category's default real/artificial ratio" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: typeof c.realPct !== "number" ? "#EC4899" : "rgba(236,72,153,0.12)", color: typeof c.realPct !== "number" ? "#fff" : "#EC4899" }}>🌐 Ratio</button>
                      <button onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, realPct: 100 } : x))} title="Price this component at 100% the recipe's Studio rate, overriding the sub-category's default" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: c.realPct === 100 ? "#EC4899" : "rgba(236,72,153,0.12)", color: c.realPct === 100 ? "#fff" : "#EC4899" }}>🎯 100%</button>
                      <input type="number" min="0" max="100" value={c.realPct ?? ""} placeholder={String(cFloral.modeDefault)} onChange={(e) => { const v = e.target.value; setComps(comps.map((x, i) => i === ci ? { ...x, realPct: v === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)) } : x)); }} title="Manually set the exact % real — overrides Ratio/100%" style={{ width: 38, padding: "1px 4px", borderRadius: 3, border: `1px solid ${border}`, background: cardBg, color: textP, fontSize: 9, textAlign: "center" }} />
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="per kit">
                  <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: Math.max(0, qtyEach - 1) } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>−</span>
                  <span style={{ color: textP, minWidth: 20, textAlign: "center" }}>×{qtyEach}</span>
                  <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: qtyEach + 1 } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>+</span>
                </div>
                {qtyMultiplier > 1 && <span style={{ color: textS, fontSize: 10, whiteSpace: "nowrap" }}>× {qtyMultiplier} = <b style={{ color: textP }}>{qtyEach * qtyMultiplier}</b></span>}
                {cItem && (() => { const marked = Math.round(cRate); return <span style={{ color: textS, whiteSpace: "nowrap", opacity: 0.85 }} title="client price (rental + margin, all-in)"><b style={{ color: "#A5B4FC" }}>₹{(marked * qtyEach).toLocaleString("en-IN")}</b></span>; })()}
                <span onClick={() => setComps(comps.filter((_, i) => i !== ci))} style={{ color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 2px" }} title="Remove component">×</span>
              </div>
              {/* Kit-inside-a-kit → fully editable, PER THIS PARENT INSTANCE. Edits are stored in this
                  component's `subOverrides`, so the master sub-kit and every other kit/photo using it
                  stay untouched. Recursively renders this same editor for the nested kit. */}
              {cItemIsKit && (
                <div style={{ marginLeft: 20, paddingLeft: 6, borderLeft: `2px solid rgba(99,102,241,0.25)` }}>
                  <KitComponentsEditor
                    item={cItem}
                    overrides={Array.isArray(c.subOverrides) ? c.subOverrides : undefined}
                    onChange={(nextSub) => setComps(comps.map((x, i) => {
                      if (i !== ci) return x;
                      if (nextSub === undefined) { const { subOverrides, ...rest } = x; return rest; } // reset → back to master sub-kit
                      return { ...x, subOverrides: nextSub };
                    }))}
                    imsInventory={imsInventory}
                    flowerPatterns={flowerPatterns}
                    qtyMultiplier={1}
                    rcSubcatFactors={rcSubcatFactors}
                    rcFactorByKey={rcFactorByKey}
                    mandiCatalogue={mandiCatalogue}
                    studioMarkup={studioMarkup}
                    elSize={elSize} floralRatio={floralRatio} rcFloralModeByKey={rcFloralModeByKey} floralSettings={floralSettings}
                    textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
        {subCatRecipe > 0 && subCatPattern && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ width: 22, height: 22, borderRadius: 4, background: isDark ? "rgba(236,72,153,0.12)" : "rgba(236,72,153,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>🌸</span>
            <span style={{ color: textP, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subCatPattern.name} <span style={{ color: "#EC4899", fontSize: 9, fontStyle: "italic" }}>· recipe (this kit's sub-category)</span></span>
            <span style={{ color: textS, whiteSpace: "nowrap", opacity: 0.85 }} title="recipe Studio rate (all-in)"><b style={{ color: "#EC4899" }}>🌸 ₹{subCatRecipe.toLocaleString("en-IN")}</b></span>
          </div>
        )}
      </div>
      <div style={{ marginTop: 5, position: "relative" }}>
        <input value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder="🔍 Search by name or sub-category to add…"
          style={{ width: "100%", fontSize: 10, padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textP }} />
        {addSearch.trim() && (() => {
          const tokens = addSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
          const matches = (imsInventory || []).filter((x) => x.id !== item.id && !comps.some((c) => c.itemId === x.id) && !isHiddenSubcat(x, rcSubcatFactors) && tokens.every((t) => (x.name + " " + (x.subCat || x.subcategory || "") + " " + (x.cat || x.category || "")).toLowerCase().includes(t))).slice(0, 40);
          return (
            <div style={{ position: "absolute", zIndex: 50, top: "100%", left: 0, right: 0, marginTop: 2, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
              {matches.length === 0 && <div style={{ padding: "6px 8px", fontSize: 10, color: textS }}>No matches</div>}
              {matches.map((x) => {
                const src = x.img || x.photoUrls?.[0];
                const remaining = dealAwareness?.getRemaining ? dealAwareness.getRemaining(x.id) : null;
                const isBlocked = remaining != null && remaining <= 0;
                return (
                  <div key={x.id} onClick={() => { if (isBlocked) return; setComps(comps.some((c) => c.itemId === x.id) ? comps : [...comps, { itemId: x.id, qty: 1 }]); setAddSearch(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", cursor: isBlocked ? "not-allowed" : "pointer", borderBottom: `1px solid ${border}`, opacity: isBlocked ? 0.45 : 1 }}>
                    <ItemHoverThumb src={src} size={22} rounded={4} name={x.name} sub={(x.subCat || x.subcategory) ? (x.subCat || x.subcategory) + " › " + (x.cat || x.category || "") : (x.cat || x.category || "")} dims={itemDimsText(x)} border={border} cardBg={cardBg} textP={textP} textS={textS} emptyBg={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: textP, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
                        {isBlocked && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700, flexShrink: 0 }}>🚫 fully used in this event</span>}
                        {!isBlocked && remaining != null && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700, flexShrink: 0 }}>{remaining} left for this event</span>}
                      </div>
                      <div style={{ fontSize: 9, color: textS }}>{(x.subCat || x.subcategory) ? (x.subCat || x.subcategory) + " › " : ""}{x.cat || x.category || ""}{itemDimsText(x) ? ` · 📐 ${itemDimsText(x)}` : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid rgba(99,102,241,0.2)`, display: "flex", justifyContent: "space-between", fontSize: 10 }}>
        <span style={{ color: textS }}>Kit total = items ₹{itemsMarked.toLocaleString("en-IN")}{kitBaseMarked > 0 ? ` + console ₹${kitBaseMarked.toLocaleString("en-IN")}` : ""}{flowerTotal > 0 ? ` + 🌸 recipe ₹${flowerTotal.toLocaleString("en-IN")}` : ""} = ₹{partsTotal.toLocaleString("en-IN")}{qtyMultiplier > 1 ? ` × ${qtyMultiplier}` : ""}</span>
        <span style={{ color: "#A5B4FC", fontWeight: 700 }}>{fmt ? fmt(partsTotal * qtyMultiplier) : `₹${(partsTotal * qtyMultiplier).toLocaleString("en-IN")}`}</span>
      </div>
    </div>
  );
}

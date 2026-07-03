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

export default function DCFloralsTab({ ctx }) {
  const [artFlowerSearch, setArtFlowerSearch] = useState(""); // search-by-name for the artificial flower colour picker (long list)
  const {
    // chrome / theme
    border, textS, textP, isDark,
    // build / fn state
    activeFnIdx, collectAllFunctionData, rcItems,
    // deal check data + pricing
    dealCheckData, floralRatio, resolveMandiFlower, imsField, dcInventoryCache,
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
                  if (!activeFn) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No function selected.</div>;
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
                    if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
                    return Math.max(0, Math.min(100, 100 - fnFloralRatio));
                  };
                  // Walk all floral elements in this function
                  const flowerAgg = new Map();  // parentId → { flowerId(=parentId), name, totalQty, unit, currentPrice, contributors[], realOnly }
                  const elementBreakdown = [];  // [{ name, zoneKey, qty, realPct, realCost, artCost, total }]
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
                      const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
                      if (!rc) return;
                      if (String(rc.cat||"").toLowerCase() !== "florals") return;
                      const elQty = el.qty || 0;
                      if (elQty <= 0) return;
                      const realPct = resolveRealPct(el, rc);
                      const realFrac = realPct / 100;
                      const artFrac = 1 - realFrac;
                      // Real cost from pattern recipe — lenient name match (exact then substring)
                      const targetName = (rc.name||"").toLowerCase().trim();
                      let pattern = flowerPatterns.find(p => (p.name||"").toLowerCase().trim() === targetName);
                      if (!pattern) {
                        pattern = flowerPatterns.find(p => {
                          const n = (p.name||"").toLowerCase().trim();
                          return n && (n.includes(targetName) || targetName.includes(n));
                        });
                      }
                      // eslint-disable-next-line no-console
                      if (!pattern) console.log("[deal-check florals] no pattern for", rc.name, "· available patterns:", flowerPatterns.map(p => p.name));
                      let realCostPerUnit = 0;
                      let realLines = [];
                      if (pattern) {
                        const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                        const sizes = pattern.sizes || {};
                        let comp = sizes[sizeKey] || sizes.medium;
                        if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
                        if (comp && Array.isArray(comp.flowers)) {
                          const season = seasonMap[activeFn.fnDate] || "non_saya";
                          const seasonMult = mandiMults[season] || 1;
                          comp.flowers.forEach(fl => {
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
                      const realCost = realLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
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
                        const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                        const sizes = pattern.sizes || {};
                        let comp = sizes[sizeKey] || sizes.medium;
                        if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
                        if (comp && Array.isArray(comp.flowers)) {
                          comp.flowers.forEach(fl => {
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
                      totalReal += realCost;
                      totalArtificial += artCost;
                      elementBreakdown.push({ name: el.name, zoneKey: zk, qty: elQty, realPct, realCost, artCost, total: realCost + artCost, hasPattern: !!pattern, realLines, size: sizeFromMode(rc.inhouseMode, el.size), artLines, artBunchesFlower, artBunchesGreen, flowerPerBunchRate, greenPerBunchRate });
                    });
                  });
                  if (elementBreakdown.length === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No floral elements in this function.</div>;
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
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {/* Header summary */}
                      <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(236,72,153,0.06)",border:`1px solid rgba(236,72,153,0.20)`}}>
                        <div style={{fontSize:11,color:textS,letterSpacing:0.6,textTransform:"uppercase",fontWeight:700,marginBottom:6}}>{activeFn.fnType || `Function ${fnIdx+1}`} · {activeFn.fnDate || "—"}</div>
                        <div style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap"}}>
                          <div><span style={{fontSize:11,color:textS}}>Total Floral </span><span style={{fontSize:22,fontWeight:700,color:"#fff"}}>₹{Math.round(grandTotal).toLocaleString("en-IN")}</span></div>
                          <div><span style={{fontSize:10,color:"#10B981",fontWeight:600}}>● Real ₹{Math.round(totalReal).toLocaleString("en-IN")}</span></div>
                          <div><span style={{fontSize:10,color:"#EC4899",fontWeight:600}}>● Artificial ₹{Math.round(totalArtificial).toLocaleString("en-IN")}</span></div>
                          <div style={{marginLeft:"auto",fontSize:10,color:textS}}>{overallRealPct}% real / {100-overallRealPct}% artificial overall</div>
                        </div>
                        {/* §26 — Artificial flower color allocation strip */}
                        {totalArtificial > 0 && <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid rgba(236,72,153,0.15)`,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,color:"#EC4899",fontWeight:700}}>🌸 Artificial {totalArtKg > 0 ? `${Math.round(totalArtKg * 10) / 10} kg` : `₹${Math.round(totalArtificial).toLocaleString("en-IN")}`}</span>
                          {fnArtAlloc.length > 0 ? <>
                            {fnArtAlloc.map((a, i) => <span key={i} style={{fontSize:9,padding:"3px 8px",borderRadius:6,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:600}}>{a.colour} {a.qty}kg</span>)}
                            {fnArtAllocTotal < totalArtKg && <span style={{fontSize:9,color:"#F59E0B",fontWeight:600}}>{Math.round((totalArtKg - fnArtAllocTotal) * 10) / 10}kg unassigned</span>}
                          </> : <span style={{fontSize:9,color:textS}}>No color split — any color</span>}
                          <button onClick={() => setDcArtFlowerModal({ fnIdx, totalKg: totalArtKg || 0 })} style={{fontSize:9,padding:"3px 10px",borderRadius:6,border:`1px solid rgba(236,72,153,0.3)`,background:"rgba(236,72,153,0.08)",color:"#EC4899",fontWeight:600,cursor:"pointer",marginLeft:"auto"}}>🎨 Split Colors</button>
                        </div>}
                      </div>
                      {/* Tier 2.1 — 📝 Floral preference note (per function, inline always-visible textarea) */}
                      <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(192,132,252,0.04)",border:`1px solid rgba(192,132,252,0.18)`}}>
                        <div style={{fontSize:10,color:"#C084FC",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                          📝 Floral preference for {activeFn.fnType || `Function ${fnIdx+1}`}
                          {fnIdx !== activeFnIdx && <span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(255,255,255,0.06)",color:textS,fontWeight:400,letterSpacing:0.3}}>read-only · switch pill to edit</span>}
                        </div>
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
                            padding:"7px 10px",
                            fontSize:11,
                            color:"#fff",
                            background:fnIdx===activeFnIdx?"rgba(0,0,0,0.20)":"rgba(0,0,0,0.10)",
                            border:`1px solid ${border}`,
                            borderRadius:6,
                            outline:"none",
                            resize:"vertical",
                            fontFamily:"inherit",
                            opacity:fnIdx===activeFnIdx?1:0.7,
                            boxSizing:"border-box"
                          }}
                        />
                        <div style={{marginTop:4,fontSize:9,color:textS,fontStyle:"italic"}}>Purchase manager reads this when buying from mandi — colours, themes, must-haves/avoids.</div>
                      </div>
                      {/* Real flower mandi list */}
                      {sortedAgg.length > 0 && (
                        <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(16,185,129,0.04)",border:`1px solid rgba(16,185,129,0.20)`}}>
                          <div style={{fontSize:11,fontWeight:700,color:"#10B981",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>🌹 Real Flower Mandi List ({sortedAgg.length} flower{sortedAgg.length===1?"":"s"})</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                              <th style={{textAlign:"left",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Flower</th>
                              <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Qty</th>
                              <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Rate</th>
                              <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Total</th>
                              <th style={{width:140,textAlign:"center",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Actions</th>
                            </tr></thead>
                            <tbody>
                              {sortedAgg.map(f => {
                                const fKey = `mandi:${f.flowerId||f.name}`;
                                const open = !!dcFloralCalcOpen[fKey];
                                return (
                                <Fragment key={f.flowerId||f.name}>
                                <tr style={{borderBottom:open?"none":`1px solid ${border}33`}}>
                                  <td style={{padding:"6px 4px",color:"#fff"}}>
                                    {f.name}
                                    {f.realOnly && <span title="Real Only — always 100% regardless of element blend" style={{marginLeft:6,fontSize:9,color:"#F59E0B"}}>🔒</span>}
                                    {f._isSwapTarget && (
                                      <span title="Swapped in from another flower" style={{marginLeft:6,fontSize:9,padding:"1px 6px",borderRadius:8,background:"rgba(251,191,36,0.18)",color:"#FBBF24",fontWeight:600}}>
                                        🔄 swap
                                      </span>
                                    )}
                                    {(dcFloralColorPrefs[fnIdx]?.[f.flowerId]||[]).length > 0 && (
                                      <div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>
                                        {(dcFloralColorPrefs[fnIdx][f.flowerId]).map((p,pi) => (
                                          <span key={p.variantId} style={{fontSize:8,padding:"1px 6px",borderRadius:6,fontWeight:600,
                                            background: pi===0?"rgba(192,132,252,0.20)":pi===1?"rgba(168,85,247,0.12)":"rgba(107,114,128,0.12)",
                                            color: pi===0?"#C084FC":pi===1?"#A855F7":"#9CA3AF"}}>
                                            {pi===0?`🎨 ${p.label} ₹${Math.round(p.rate)}`:pi===1?`2nd ${p.label}`:`3rd ${p.label}`}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{padding:"6px 4px",color:"#fff",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{f.totalQty.toFixed(2)} {f.unit}</td>
                                  <td style={{padding:"6px 4px",color:textS,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(f.unitPrice).toLocaleString("en-IN")}/{f.unit}</td>
                                  <td style={{padding:"6px 4px",color:"#fff",textAlign:"right",fontVariantNumeric:"tabular-nums",fontWeight:600}}>₹{Math.round(f.totalQty * f.unitPrice).toLocaleString("en-IN")}</td>
                                  <td style={{padding:"6px 4px",textAlign:"right"}}>
                                    <div style={{display:"flex",gap:4,justifyContent:"flex-end",flexWrap:"wrap"}}>
                                      {fnIdx === activeFnIdx && (
                                        <>
                                          <button onClick={()=>setDcPrefModal({ fnIdx, flowerId: f.flowerId, flowerName: f.name })}
                                            title="Pick colour + set preferences (top 3)"
                                            style={{fontSize:10,padding:"2px 6px",borderRadius:7,cursor:"pointer",
                                              border:(dcFloralColorPrefs[fnIdx]?.[f.flowerId]?.length>0)?"1px solid #C084FC":"1px solid rgba(192,132,252,0.40)",
                                              background:(dcFloralColorPrefs[fnIdx]?.[f.flowerId]?.length>0)?"rgba(192,132,252,0.20)":"rgba(192,132,252,0.06)",color:"#C084FC",fontWeight:500}}>
                                            🎨
                                          </button>
                                          <button onClick={()=>setDcSwapModal({ fnIdx, parentId: f.flowerId, currentRow: f })}
                                            title="Swap flower"
                                            style={{fontSize:10,padding:"2px 6px",borderRadius:7,cursor:"pointer",
                                              border:"1px solid rgba(251,191,36,0.40)",
                                              background:"rgba(251,191,36,0.06)",color:"#FBBF24",fontWeight:500}}>
                                            🔄
                                          </button>
                                        </>
                                      )}
                                      <button onClick={()=>setDcFloralCalcOpen(p=>({...p,[fKey]:!p[fKey]}))}
                                        style={{fontSize:10,padding:"2px 8px",borderRadius:7,cursor:"pointer",
                                          border:open?"1px solid #A78BFA":"1px solid rgba(167,139,250,0.40)",
                                          background:open?"rgba(124,58,237,0.20)":"rgba(124,58,237,0.08)",color:"#A78BFA",fontWeight:500}}>
                                        {open?"× hide":"🧮 how"}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {open && (
                                  <tr style={{borderBottom:`1px solid ${border}33`}}>
                                    <td colSpan={5} style={{padding:"4px 4px 10px"}}>
                                      <div style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                        <div style={{fontSize:9,color:"#A78BFA",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>How {f.totalQty.toFixed(2)} {f.unit} of {f.name} derived</div>
                                        {(!f.contributors || f.contributors.length === 0) ? (
                                          <div style={{fontSize:10,color:textS,fontStyle:"italic"}}>No element contributors recorded.</div>
                                        ) : (
                                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                                            <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                              <th style={{textAlign:"left",padding:"3px 4px 5px",color:textS,fontWeight:500}}>Element</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>El qty</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>×</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>per pattern</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>×</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>real %</th>
                                              <th style={{textAlign:"right",padding:"3px 4px 5px",color:textS,fontWeight:500}}>= contrib</th>
                                            </tr></thead>
                                            <tbody>
                                              {f.contributors.map((c, ci) => (
                                                <tr key={ci}>
                                                  <td style={{padding:"4px 4px",color:"#fff"}}>{c.elName}<span style={{color:textS,fontSize:9,marginLeft:4,textTransform:"capitalize"}}>({c.zoneKey})</span></td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#fff",fontVariantNumeric:"tabular-nums"}}>{c.elQty}</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:textS}}>×</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#fff",fontVariantNumeric:"tabular-nums"}}>{c.perPattern} {f.unit}</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:textS}}>×</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:textS,fontVariantNumeric:"tabular-nums"}}>{Math.round(c.realFrac*100)}%</td>
                                                  <td style={{textAlign:"right",padding:"4px 4px",color:"#fff",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{c.contribution.toFixed(2)} {f.unit}</td>
                                                </tr>
                                              ))}
                                              <tr style={{borderTop:`1px solid ${border}`}}>
                                                <td colSpan={6} style={{textAlign:"right",padding:"4px 4px",color:textS}}>Sum:</td>
                                                <td style={{textAlign:"right",padding:"4px 4px",color:"#FBBF24",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{f.totalQty.toFixed(2)} {f.unit}</td>
                                              </tr>
                                              <tr>
                                                <td colSpan={6} style={{textAlign:"right",padding:"4px 4px",color:textS}}>× ₹{Math.round(f.unitPrice)}/{f.unit} =</td>
                                                <td style={{textAlign:"right",padding:"4px 4px",color:"#10B981",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(f.totalQty * f.unitPrice).toLocaleString("en-IN")}</td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        )}
                                        <div style={{marginTop:8,paddingTop:6,borderTop:`1px dashed ${border}`,fontSize:10,color:textS,fontStyle:"italic"}}>Σ(element qty × per-pattern recipe × real %) summed across all elements using this flower</div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              );})}
                              <tr><td colSpan={3} style={{padding:"8px 4px",textAlign:"right",color:textS,fontWeight:600}}>Real Total</td><td style={{padding:"8px 4px",textAlign:"right",color:"#10B981",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(totalReal).toLocaleString("en-IN")}</td><td></td></tr>
                            </tbody>
                          </table>
                        </div>
                      )}
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
                        return (
                          <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(236,72,153,0.04)",border:`1px solid rgba(236,72,153,0.20)`}}>
                            <div style={{fontSize:11,fontWeight:700,color:"#EC4899",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>🌺 Artificial Bunches</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:11}}>
                              <div style={{padding:"8px 10px",borderRadius:7,background:"rgba(236,72,153,0.06)"}}>
                                <div style={{fontSize:10,color:"#EC4899",fontWeight:600,marginBottom:4}}>🌹 Flower bunches</div>
                                <div style={{color:"#fff",fontVariantNumeric:"tabular-nums"}}>{totalArtBunchesFlower.toFixed(1)} bunches = <b>{flowerKg.toFixed(2)} kg</b></div>
                                <div style={{fontSize:9,color:textS,marginTop:2}}>× ₹{flowerRate}/kg = <span style={{color:"#EC4899",fontWeight:600}}>₹{Math.round(flowerCost).toLocaleString("en-IN")}</span></div>
                              </div>
                              <div style={{padding:"8px 10px",borderRadius:7,background:"rgba(16,185,129,0.06)"}}>
                                <div style={{fontSize:10,color:"#10B981",fontWeight:600,marginBottom:4}}>🌿 Green bunches</div>
                                <div style={{color:"#fff",fontVariantNumeric:"tabular-nums"}}>{totalArtBunchesGreen.toFixed(1)} bunches = <b>{greenKg.toFixed(2)} kg</b></div>
                                <div style={{fontSize:9,color:textS,marginTop:2}}>× ₹{greenRate}/kg = <span style={{color:"#10B981",fontWeight:600}}>₹{Math.round(greenCost).toLocaleString("en-IN")}</span></div>
                              </div>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:8,borderTop:`1px solid ${border}`}}>
                              <span style={{fontSize:11,color:textS,fontWeight:500}}>Total Artificial</span>
                              <span style={{color:"#EC4899",fontWeight:700,fontSize:14,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(totalArtificial).toLocaleString("en-IN")}</span>
                            </div>
                            {/* §26 — Artificial flower color split */}
                            <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed rgba(236,72,153,0.2)`,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:10,color:"#EC4899",fontWeight:700}}>🎨 Color Split</span>
                              {fnArtAlloc.length > 0 ? <>
                                {fnArtAlloc.map((a, ai) => <span key={ai} style={{fontSize:9,padding:"3px 8px",borderRadius:6,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:600,display:"flex",alignItems:"center",gap:4}}>{a.photo&&<img src={a.photo} alt="" style={{width:14,height:14,borderRadius:3,objectFit:"cover"}}/>}{a.colour} {a.qty}kg</span>)}
                                {fnArtAllocTotal < totalArtKg && <span style={{fontSize:9,color:"#F59E0B",fontWeight:600}}>{Math.round((totalArtKg - fnArtAllocTotal) * 10) / 10}kg unassigned</span>}
                              </> : <span style={{fontSize:9,color:textS}}>No split — any color</span>}
                              <button onClick={() => setDcArtFlowerModal({ fnIdx, totalKg: totalArtKg })} style={{fontSize:9,padding:"4px 12px",borderRadius:6,border:`1px solid rgba(236,72,153,0.3)`,background:"rgba(236,72,153,0.10)",color:"#EC4899",fontWeight:700,cursor:"pointer",marginLeft:"auto"}}>🌸 Split Colors</button>
                            </div>
                            {missingRatios.size > 0 && (
                              <div style={{fontSize:9,color:"#F59E0B",marginTop:6,fontStyle:"italic"}}>⚠ Missing Art Bunches/Unit on: {Array.from(missingRatios).join(", ")} — set in IMS Mandi tab</div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Per-element breakdown — merged by name (§26.19) */}
                      {(()=>{
                        // Merge same-name elements across zones
                        const merged = [];
                        const byName = {};
                        elementBreakdown.forEach((eb, ebi) => {
                          if (!byName[eb.name]) { byName[eb.name] = { name: eb.name, zones: [], totalQty: 0, realPct: eb.realPct, realCost: 0, artCost: 0, total: 0, hasPattern: false, entries: [] }; merged.push(byName[eb.name]); }
                          const g = byName[eb.name];
                          g.zones.push(eb.zoneKey);
                          g.totalQty += (eb.qty || 0);
                          g.realCost += (eb.realCost || 0);
                          g.artCost += (eb.artCost || 0);
                          g.total += (eb.total || 0);
                          if (eb.hasPattern) g.hasPattern = true;
                          g.entries.push({ ...eb, _origIdx: ebi });
                        });
                        return (
                      <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(255,255,255,0.02)",border:`1px solid ${border}`}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#fff",letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>📋 Per-Element Breakdown ({merged.length} element{merged.length===1?"":"s"}{merged.length !== elementBreakdown.length ? ` · ${elementBreakdown.length} rows` : ""})</div>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                          <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                            <th style={{textAlign:"left",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Element</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Qty</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Real %</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Real ₹</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Artif ₹</th>
                            <th style={{textAlign:"right",padding:"6px 4px",fontWeight:600,color:textS,letterSpacing:0.4}}>Total</th>
                            <th style={{width:60}}></th>
                          </tr></thead>
                          <tbody>
                            {merged.map((mg, mgi) => {
                              const eKey = `el:${mgi}`;
                              const open = !!dcFloralCalcOpen[eKey];
                              const zoneLabel = [...new Set(mg.zones)].join(", ");
                              return (
                              <Fragment key={mgi}>
                              <tr style={{borderBottom:open?"none":`1px solid ${border}33`}}>
                                <td style={{padding:"6px 4px",color:"#fff"}}>{mg.name}{!mg.hasPattern && <span title="No IMS pattern" style={{marginLeft:6,fontSize:9,color:"#F59E0B"}}>⚠</span>}{mg.zones.length > 1 && <div style={{fontSize:9,color:textS,marginTop:1}}>{zoneLabel}</div>}{mg.zones.length === 1 && <span style={{fontSize:9,color:textS,marginLeft:6}}>{zoneLabel}</span>}</td>
                                <td style={{padding:"6px 4px",color:"#fff",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{mg.totalQty}</td>
                                <td style={{padding:"6px 4px",color:textS,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{mg.realPct}%</td>
                                <td style={{padding:"6px 4px",color:"#10B981",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(mg.realCost).toLocaleString("en-IN")}</td>
                                <td style={{padding:"6px 4px",color:"#EC4899",textAlign:"right",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(mg.artCost).toLocaleString("en-IN")}</td>
                                <td style={{padding:"6px 4px",color:"#fff",textAlign:"right",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(mg.total).toLocaleString("en-IN")}</td>
                                <td style={{padding:"6px 4px",textAlign:"right"}}>
                                  <button onClick={()=>setDcFloralCalcOpen(p=>({...p,[eKey]:!p[eKey]}))}
                                    style={{fontSize:10,padding:"2px 8px",borderRadius:7,cursor:"pointer",
                                      border:open?"1px solid #A78BFA":"1px solid rgba(167,139,250,0.40)",
                                      background:open?"rgba(124,58,237,0.20)":"rgba(124,58,237,0.08)",color:"#A78BFA",fontWeight:500}}>
                                    {open?"× hide":"🧮 how"}
                                  </button>
                                </td>
                              </tr>
                              {open && mg.entries.map((eb, si) => (
                                <tr key={`sub-${si}`} style={{borderBottom:si===mg.entries.length-1?`1px solid ${border}33`:"none"}}>
                                  <td colSpan={7} style={{padding:"4px 4px 10px"}}>
                                    <div style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                      <div style={{fontSize:9,color:"#A78BFA",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>How ₹{Math.round(eb.total).toLocaleString("en-IN")} for {eb.name} · {eb.zoneKey} × {eb.qty} derived</div>

                                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:10}}>
                                        {/* Real side */}
                                        <div>
                                          <div style={{color:"#10B981",fontWeight:600,marginBottom:5}}>● Real flowers ({eb.realPct}% blend × {eb.qty} pattern{eb.qty===1?"":"s"}{(eb.realLines||[]).some(rl=>rl.realOnly) ? " + 🔒 100% items":""})</div>
                                          {(!eb.realLines || eb.realLines.length === 0) ? (
                                            <div style={{color:textS,fontStyle:"italic"}}>{eb.hasPattern ? "Recipe has no flowers." : "No IMS pattern found — Real ₹0."}</div>
                                          ) : (
                                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                                              <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                <th style={{textAlign:"left",padding:"3px 2px",color:textS,fontWeight:500}}>Flower</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Per pattern</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Total qty</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Cost</th>
                                              </tr></thead>
                                              <tbody>
                                                {eb.realLines.map((rl, ri) => (
                                                  <tr key={ri}>
                                                    <td style={{padding:"3px 2px",color:"#fff"}}>{rl.name}{rl.realOnly && <span title="Real Only — 100% always" style={{marginLeft:4,fontSize:9,color:"#F59E0B"}}>🔒</span>}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:textS,fontVariantNumeric:"tabular-nums"}}>{rl.perPattern} {rl.unit}{rl.realOnly && <span style={{marginLeft:3,fontSize:8,color:"#F59E0B"}}>×100%</span>}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#fff",fontVariantNumeric:"tabular-nums"}}>{rl.qty.toFixed(2)} {rl.unit}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:"#10B981",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(rl.lineCost).toLocaleString("en-IN")}</td>
                                                  </tr>
                                                ))}
                                                <tr style={{borderTop:`1px solid ${border}`}}>
                                                  <td colSpan={3} style={{textAlign:"right",padding:"3px 2px",color:textS}}>Real subtotal:</td>
                                                  <td style={{textAlign:"right",padding:"3px 2px",color:"#10B981",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.realCost).toLocaleString("en-IN")}</td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                        {/* Artificial side */}
                                        <div>
                                          <div style={{color:"#EC4899",fontWeight:600,marginBottom:5}}>● Artificial bunches ({100-eb.realPct}% × {eb.qty} pattern{eb.qty===1?"":"s"})</div>
                                          {eb.artCost <= 0 ? (
                                            <div style={{color:textS,fontStyle:"italic"}}>{(!eb.artLines || eb.artLines.length === 0) ? "No artificial (100% real, no recipe, or bunches/unit not set on flowers)." : "Set Art Bunches/Unit on flowers in IMS Mandi tab."}</div>
                                          ) : (
                                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                                              <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                <th style={{textAlign:"left",padding:"3px 2px",color:textS,fontWeight:500}}>Flower</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Real replaced</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Bunches</th>
                                                <th style={{textAlign:"right",padding:"3px 2px",color:textS,fontWeight:500}}>Cost</th>
                                              </tr></thead>
                                              <tbody>
                                                {(eb.artLines || []).map((al, ai) => (
                                                  <tr key={ai}>
                                                    <td style={{padding:"3px 2px",color:al.realOnly?textS:"#fff"}}>{al.name}<span style={{fontSize:9,marginLeft:4,color:al.realOnly?"#F59E0B":(al.isGreen?"#10B981":"#EC4899")}}>{al.realOnly?"🔒":(al.isGreen?"🌿":"🌹")}</span></td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:textS,fontVariantNumeric:"tabular-nums"}}>{al.realOnly ? <span style={{fontSize:9,fontStyle:"italic"}}>skipped</span> : `${al.realUnitsReplaced.toFixed(2)} ${al.unit}`}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:al.realOnly?textS:(al.missingRatio?"#F59E0B":"#fff"),fontVariantNumeric:"tabular-nums"}}>{al.realOnly ? "—" : (al.missingRatio?"⚠ ratio?":al.bunches.toFixed(1))}</td>
                                                    <td style={{textAlign:"right",padding:"3px 2px",color:al.realOnly?textS:(al.isGreen?"#10B981":"#EC4899"),fontVariantNumeric:"tabular-nums"}}>{al.realOnly ? "—" : `₹${Math.round(al.lineCost).toLocaleString("en-IN")}`}</td>
                                                  </tr>
                                                ))}
                                                <tr style={{borderTop:`1px solid ${border}`}}>
                                                  <td colSpan={3} style={{textAlign:"right",padding:"3px 2px",color:textS}}>Art subtotal:</td>
                                                  <td style={{textAlign:"right",padding:"3px 2px",color:"#EC4899",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.artCost).toLocaleString("en-IN")}</td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          )}
                                          {eb.artCost > 0 && (
                                            <div style={{marginTop:5,fontSize:9,color:textS,fontStyle:"italic"}}>
                                              {eb.artBunchesFlower > 0 && <div>🌹 {eb.artBunchesFlower.toFixed(1)} flower bunches × ₹{eb.flowerPerBunchRate?.toFixed(2)}/bunch</div>}
                                              {eb.artBunchesGreen > 0 && <div>🌿 {eb.artBunchesGreen.toFixed(1)} green bunches × ₹{eb.greenPerBunchRate?.toFixed(2)}/bunch</div>}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div style={{marginTop:10,paddingTop:8,borderTop:`1px dashed ${border}`,display:"flex",justifyContent:"space-between",fontSize:11}}>
                                        <span style={{color:textS}}>Total ({eb.zoneKey} × {eb.qty})</span>
                                        <span style={{color:"#FBBF24",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>₹{Math.round(eb.total).toLocaleString("en-IN")}</span>
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
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:"#0F0F1A",borderRadius:14,border:`1px solid ${border}`,color:textS,fontSize:12}}>Parent flower not found in mandi. <button onClick={()=>setDcColorModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer"}}>Close</button></div>
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
            <div onClick={e=>e.stopPropagation()} style={{width:"min(640px, 100%)",maxHeight:"82vh",background:"#0F0F1A",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",letterSpacing:0.2}}>🎨 Pick colour for {parent.name}</div>
                  <div style={{fontSize:10,color:textS,letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{variants.length} variant{variants.length===1?"":"s"} available · pick affects pricing only</div>
                </div>
                <button onClick={()=>setDcColorModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer",lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:"14px 18px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))",gap:10}}>
                {/* None / lowest (default) */}
                <div onClick={()=>applyVariant(null)}
                  style={{cursor:"pointer",padding:12,borderRadius:10,border:currentVariantId===null?"2px solid #C084FC":`1px solid ${border}`,background:currentVariantId===null?"rgba(192,132,252,0.12)":"rgba(255,255,255,0.03)",display:"flex",flexDirection:"column",gap:6,minHeight:120}}>
                  <div style={{width:"100%",height:50,borderRadius:6,background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:textS}}>📊</div>
                  <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>None / lowest</div>
                  <div style={{fontSize:9,color:textS}}>Uses ₹{Math.round(parent.currentPrice||0).toLocaleString("en-IN")} (lowest variant)</div>
                </div>
                {variants.length === 0 ? (
                  <div style={{gridColumn:"2 / -1",padding:30,textAlign:"center",color:textS,fontSize:11,fontStyle:"italic"}}>No colour variants set up for this flower in IMS yet.</div>
                ) : variants.map(v => {
                  const isSelected = currentVariantId === v.variantId;
                  return (
                    <div key={v.variantId} onClick={()=>applyVariant(v)}
                      style={{cursor:"pointer",padding:12,borderRadius:10,border:isSelected?"2px solid #C084FC":`1px solid ${border}`,background:isSelected?"rgba(192,132,252,0.12)":"rgba(255,255,255,0.03)",display:"flex",flexDirection:"column",gap:6,minHeight:120}}>
                      {v.photoUrl ? (
                        <img src={v.photoUrl} alt={v.name||""} style={{width:"100%",height:50,objectFit:"cover",borderRadius:6,background:"#1A1A2E"}} />
                      ) : (
                        <div style={{width:"100%",height:50,borderRadius:6,background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:textS}}>🌸</div>
                      )}
                      <div style={{fontSize:11,fontWeight:600,color:"#fff",lineHeight:1.2}}>{v.name || "Unnamed"}</div>
                      <div style={{fontSize:10,color:"#C084FC",fontWeight:600}}>₹{Math.round(Number(v.currentPrice)||0).toLocaleString("en-IN")}/{parent.unit||"unit"}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"10px 18px",borderTop:`1px solid ${border}`,fontSize:10,color:textS,fontStyle:"italic"}}>Purchase manager may substitute on the day based on mandi availability — your pick is a preference, not a lock.</div>
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
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,color:textS,fontSize:12}}>Flower not found in mandi. <button onClick={()=>setDcPrefModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer"}}>Close</button></div>
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
        const rankColors = ["#C084FC", "#A855F7", "#6B7280"];
        return (
          <div onClick={()=>setDcPrefModal(null)} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div onClick={e=>e.stopPropagation()} style={{width:"min(640px, 100%)",maxHeight:"82vh",background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:textP}}>🎨 Pick colours for {parent.name}</div>
                  <div style={{fontSize:10,color:textS,marginTop:2}}>Tap in order of preference (max 3). 1st choice = selected color + price.</div>
                </div>
                <button onClick={()=>setDcPrefModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer"}}>✕</button>
              </div>
              {/* Current ranked preferences */}
              {prefs.length > 0 && (
                <div style={{padding:"10px 18px",borderBottom:`1px solid ${border}`,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  {prefs.map((p, i) => (
                    <div key={p.variantId} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:`1.5px solid ${rankColors[i]}`,background:`${rankColors[i]}15`}}>
                      <span style={{fontSize:11,fontWeight:700,color:rankColors[i]}}>{i+1}</span>
                      {p.photoUrl && <img src={p.photoUrl} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover"}}/>}
                      <span style={{fontSize:11,fontWeight:600,color:textP}}>{p.label}</span>
                      <span style={{fontSize:9,color:textS}}>₹{Math.round(p.rate)}</span>
                      <button onClick={()=>togglePref({variantId:p.variantId})} style={{fontSize:10,color:"#EF4444",background:"none",border:"none",cursor:"pointer",padding:0,lineHeight:1}}>✕</button>
                    </div>
                  ))}
                  <button onClick={clearAll} style={{fontSize:9,color:textS,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear all</button>
                </div>
              )}
              {/* Variant grid */}
              <div style={{padding:"14px 18px",overflowY:"auto",flex:1}}>
                {variants.length === 0 ? (
                  <div style={{padding:30,textAlign:"center",color:textS,fontSize:11,fontStyle:"italic"}}>No colour variants set up for {parent.name} in IMS Mandi yet.</div>
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
                            background:isSelected?`${rankColors[rank]}12`:isDark?"rgba(255,255,255,0.03)":"#FAFAFA",
                            opacity:isFull?0.4:1,display:"flex",flexDirection:"column",gap:6,position:"relative"}}>
                          {isSelected && (
                            <div style={{position:"absolute",top:-6,right:-6,width:22,height:22,borderRadius:"50%",background:rankColors[rank],color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,0.3)"}}>{rank+1}</div>
                          )}
                          {v.photoUrl ? (
                            <img src={v.photoUrl} alt={v.name||""} style={{width:"100%",height:50,objectFit:"cover",borderRadius:6,background:isDark?"#1A1A2E":"#eee"}} />
                          ) : (
                            <div style={{width:"100%",height:50,borderRadius:6,background:isDark?"rgba(255,255,255,0.05)":"#eee",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:textS}}>🌸</div>
                          )}
                          <div style={{fontSize:11,fontWeight:600,color:textP,lineHeight:1.2}}>{v.name || "Unnamed"}</div>
                          <div style={{fontSize:10,color:"#F59E0B",fontWeight:600}}>₹{Math.round(Number(v.currentPrice)||0).toLocaleString("en-IN")}/{parent.unit||"unit"}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:10,color:textS}}>{prefs.length}/3 selected{prefs.length>0?` · Costing: ₹${Math.round(prefs[0].rate)}/${parent.unit||"unit"}`:""}</span>
                <button onClick={()=>setDcPrefModal(null)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#C084FC",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Done</button>
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
                  <div style={{fontSize:14,fontWeight:700,color:textP}}>🌸 Artificial Flower Color Split</div>
                  <div style={{fontSize:11,color:textS,marginTop:3}}>Total: <strong>{Math.round(totalKg * 10) / 10} kg</strong> · Allocated: <strong style={{color:remaining <= 0 ? "#10B981" : "#F59E0B"}}>{allocated} kg</strong> · Remaining: <strong>{remaining} kg</strong></div>
                </div>
                <button onClick={() => setDcArtFlowerModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer"}}>✕</button>
              </div>
              {/* Current allocation */}
              <div style={{padding:"14px 20px",overflowY:"auto",flex:1}}>
                {draft.length > 0 && <div style={{marginBottom:16}}>
                  <div style={{fontSize:10,fontWeight:700,color:textS,letterSpacing:0.5,textTransform:"uppercase",marginBottom:8}}>Current Allocation</div>
                  {draft.map((a, idx) => <div key={a.itemId} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:"rgba(236,72,153,0.06)",border:"1px solid rgba(236,72,153,0.2)",marginBottom:6}}>
                    {a.photo ? <img src={a.photo} alt="" style={{width:40,height:40,borderRadius:6,objectFit:"cover"}} /> : <div style={{width:40,height:40,borderRadius:6,background:"rgba(236,72,153,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🌸</div>}
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP}}>{a.colour || a.name}</div>
                      <div style={{fontSize:9,color:textS}}>{a.name}</div>
                    </div>
                    <input type="number" value={a.qty} min={0} max={rowMax(idx)} step={0.5} onChange={e => setQty(idx, e.target.value)} style={{width:60,padding:"5px 6px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textP,fontSize:13,fontWeight:700,textAlign:"center"}} />
                    <span style={{fontSize:10,color:textS}}>kg</span>
                    <button onClick={() => removeItem(idx)} style={{padding:"4px 8px",borderRadius:4,border:"none",background:"rgba(239,68,68,0.15)",color:"#EF4444",fontSize:11,cursor:"pointer",fontWeight:700}}>✕</button>
                  </div>)}
                </div>}
                {remaining > 0 && draft.length > 0 && <div style={{padding:"6px 12px",borderRadius:6,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",fontSize:10,color:"#F59E0B",fontWeight:600,marginBottom:16,textAlign:"center"}}>{remaining} kg unassigned — add more colors or increase quantities</div>}
                {/* Available colors from IMS */}
                <div style={{fontSize:10,fontWeight:700,color:textS,letterSpacing:0.5,textTransform:"uppercase",marginBottom:8}}>Available Colors {available.length === 0 && artItems.length === 0 ? "(none in IMS yet)" : `(${available.length})`}</div>
                {artItems.length > 6 && (
                  <input value={artFlowerSearch} onChange={e => setArtFlowerSearch(e.target.value)} placeholder="🔍 Search flower colour by name…"
                    style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textP,fontSize:12,marginBottom:10}} />
                )}
                {artItems.length === 0 ? (
                  <div style={{padding:"30px 20px",textAlign:"center",color:textS,fontSize:11,borderRadius:10,border:`1px dashed ${border}`}}>No artificial flower items in IMS inventory yet. Add items with subcategory "Artificial Flowers" in IMS to see them here.</div>
                ) : available.length === 0 ? (
                  <div style={{padding:"16px 20px",textAlign:"center",color:textS,fontSize:11}}>{artFlowerSearch.trim() ? `No colours match "${artFlowerSearch}".` : "All available colors are already added above."}</div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:10}}>
                    {available.map(it => {
                      const hasStock = (it._stock || 0) > 0;
                      return (
                        <div key={it.id} onClick={() => hasStock && addItem(it)} style={{cursor:hasStock?"pointer":"not-allowed",padding:10,borderRadius:10,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.03)":"#FAFAFA",opacity:hasStock?1:0.4,display:"flex",flexDirection:"column",gap:6}}>
                          {it._photo ? <img src={it._photo} alt="" style={{width:"100%",height:60,objectFit:"cover",borderRadius:6}} /> : <div style={{width:"100%",height:60,borderRadius:6,background:"rgba(236,72,153,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🌸</div>}
                          <div style={{fontSize:11,fontWeight:600,color:textP,lineHeight:1.2}}>{it.name}</div>
                          <div style={{fontSize:9,color:textS}}>{it._stock || 0} kg stock</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Footer */}
              <div style={{padding:"12px 20px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <button onClick={() => { updateDraft([]); }} style={{fontSize:11,color:textS,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear all</button>
                <button onClick={() => setDcArtFlowerModal(null)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#EC4899",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Done</button>
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
              <div onClick={e=>e.stopPropagation()} style={{padding:30,background:"#0F0F1A",borderRadius:14,border:`1px solid ${border}`,color:textS,fontSize:12}}>Flower not found in mandi. <button onClick={()=>setDcSwapModal(null)} style={{marginLeft:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer"}}>Close</button></div>
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
            <div onClick={e=>e.stopPropagation()} style={{width:"min(820px, 100%)",maxHeight:"88vh",background:"#0F0F1A",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",letterSpacing:0.2}}>🔄 Swap {fromParent.name}</div>
                  <div style={{fontSize:10,color:textS,letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{totalQty.toFixed(2)} {fromParent.unit||""} @ ₹{Math.round(fromRate)} · type-{fromType} · pick a replacement of same type</div>
                </div>
                <button onClick={()=>setDcSwapModal(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer",lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:"12px 18px",borderBottom:`1px solid ${border}`,display:"flex",gap:10,alignItems:"center"}}>
                <input
                  type="text"
                  value={dcSwapSearch}
                  onChange={e=>setDcSwapSearch(e.target.value)}
                  placeholder={"Search " + fromType + " flowers..."}
                  style={{flex:1,padding:"7px 10px",fontSize:11,color:"#fff",background:"rgba(0,0,0,0.20)",border:`1px solid ${border}`,borderRadius:6,outline:"none"}}
                />
                <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:8,padding:3}}>
                  {["full","split"].map(m => (
                    <button key={m} onClick={()=>setDcSwapMode(m)} style={{padding:"5px 12px",borderRadius:5,border:"none",cursor:"pointer",fontSize:11,fontWeight:dcSwapMode===m?700:500,background:dcSwapMode===m?"rgba(251,191,36,0.20)":"transparent",color:dcSwapMode===m?"#FBBF24":textS,letterSpacing:0.3,textTransform:"capitalize"}}>{m}</button>
                  ))}
                </div>
              </div>
              {dcSwapMode === "split" && (
                <div style={{padding:"10px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:11,color:textS}}>Divert to swap:</div>
                  <input
                    type="number" min={0} max={totalQty} step={0.1}
                    value={dcSwapSplitQty}
                    onChange={e=>setDcSwapSplitQty(Math.max(0, Math.min(totalQty, Number(e.target.value)||0)))}
                    style={{width:90,padding:"5px 8px",fontSize:11,color:"#fff",background:"rgba(0,0,0,0.20)",border:`1px solid ${border}`,borderRadius:6,outline:"none",fontVariantNumeric:"tabular-nums"}}
                  />
                  <div style={{fontSize:11,color:"#fff"}}>{fromParent.unit||""}</div>
                  <div style={{fontSize:10,color:textS,marginLeft:"auto"}}>Keeps {remainingOriginalQty.toFixed(2)} {fromParent.unit||""} of original</div>
                </div>
              )}
              <div style={{padding:"14px 18px",overflowY:"auto",flex:1,display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(170px, 1fr))",gap:10}}>
                {filtered.length === 0 ? (
                  <div style={{gridColumn:"1 / -1",padding:30,textAlign:"center",color:textS,fontSize:11,fontStyle:"italic"}}>No matching {fromType} flowers in mandi.</div>
                ) : filtered.map(p => {
                  const isPicked = dcSwapPicked?.id === p.id;
                  const variantCount = (p.colorVariants||[]).length;
                  return (
                    <div key={p.id} onClick={()=>setDcSwapPicked(p)}
                      style={{cursor:"pointer",padding:12,borderRadius:10,border:isPicked?"2px solid #FBBF24":`1px solid ${border}`,background:isPicked?"rgba(251,191,36,0.10)":"rgba(255,255,255,0.03)",display:"flex",flexDirection:"column",gap:4}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#fff",lineHeight:1.2}}>{p.name}</div>
                      <div style={{fontSize:9,color:textS}}>{variantCount} colour{variantCount===1?"":"s"} · {p.unit||""}</div>
                      <div style={{fontSize:11,color:"#FBBF24",fontWeight:600,marginTop:2}}>₹{Math.round(Number(p.currentPrice)||0).toLocaleString("en-IN")}/{p.unit||"unit"}</div>
                    </div>
                  );
                })}
              </div>
              {/* Delta preview */}
              {dcSwapPicked && (
                <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,background:"rgba(251,191,36,0.04)"}}>
                  <div style={{fontSize:10,color:"#FBBF24",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:6}}>Preview · {dcSwapMode === "full" ? "Full replace" : "Split"}</div>
                  <div style={{fontSize:11,color:textS,lineHeight:1.7}}>
                    <div>Before: {totalQty.toFixed(2)} {fromParent.unit||""} {fromParent.name} × ₹{Math.round(fromRate)} = <span style={{color:"#fff",fontWeight:600}}>₹{Math.round(rowDeltaBefore).toLocaleString("en-IN")}</span></div>
                    {dcSwapMode === "full" ? (
                      <div>After: {swapQty.toFixed(2)} {dcSwapPicked.unit||""} {dcSwapPicked.name} × ₹{Math.round(targetRate)} = <span style={{color:"#fff",fontWeight:600}}>₹{Math.round(rowDeltaAfter).toLocaleString("en-IN")}</span></div>
                    ) : (
                      <>
                        <div>After (original): {remainingOriginalQty.toFixed(2)} {fromParent.unit||""} × ₹{Math.round(fromRate)} = ₹{Math.round(remainingOriginalQty * fromRate).toLocaleString("en-IN")}</div>
                        <div>After (swap): {swapQty.toFixed(2)} {dcSwapPicked.unit||""} {dcSwapPicked.name} × ₹{Math.round(targetRate)} = ₹{Math.round(swapQty * targetRate).toLocaleString("en-IN")}</div>
                        <div>Row total: <span style={{color:"#fff",fontWeight:600}}>₹{Math.round(rowDeltaAfter).toLocaleString("en-IN")}</span></div>
                      </>
                    )}
                    <div style={{marginTop:5,paddingTop:5,borderTop:`1px dashed ${border}`}}>
                      Row delta: <span style={{color:rowDelta >= 0 ? "#10B981" : "#EF4444",fontWeight:700}}>{rowDelta >= 0 ? "+" : ""}₹{Math.round(rowDelta).toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
              )}
              <div style={{padding:"10px 18px",borderTop:`1px solid ${border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setDcSwapModal(null)} style={{padding:"7px 14px",borderRadius:7,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer",fontWeight:500}}>Cancel</button>
                <button onClick={confirmSwap} disabled={!dcSwapPicked || swapQty <= 0}
                  style={{padding:"7px 14px",borderRadius:7,border:"none",background:(!dcSwapPicked || swapQty<=0)?"rgba(251,191,36,0.20)":"#FBBF24",color:(!dcSwapPicked || swapQty<=0)?textS:"#0F0F1A",fontSize:11,cursor:(!dcSwapPicked || swapQty<=0)?"not-allowed":"pointer",fontWeight:700,letterSpacing:0.3}}>Confirm swap</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

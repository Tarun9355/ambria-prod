import { Fragment, useState, useRef, useEffect, useMemo } from "react";
import { makeFilterUI } from "../../../components/studio/filterUI.jsx";
import { IconClipboard, IconPencil, IconRuler, IconBolt, IconWall, IconPlatform, IconCarpet, IconBulb, IconCheck,
  IconSearch, IconCamera, IconPrinter, IconNote, IconCalendar, IconFlower, IconFactory,
  IconCart, IconCopy, IconRepeat, IconAlert, IconPalette, IconChevron, IconSparkle,
  IconPlay, IconBox, IconSave, IconSliders, IconStar } from "../../../components/icons.jsx";
import {
  ZONE_TYPE_TO_AREA, getCat, taxOr, FUNCTIONS, venueTypeLabel,
  maskingOptions, PLAT_OPTS, defaultCarpetMatId, CARPET_OFF, TRUSS_MATERIALS, trussBaseArea, trussRateFor,
} from "../../../lib/studio/taxonomy";
import { paletteNames } from "../../../lib/studio/colours";
import { paletteSearch, paletteMatches } from "../../../components/studio/filterUI.jsx";
import { resolveTrussConfig } from "../../../lib/studio/pricing";
import { qtyUsedElsewhereInBuild } from "../../../lib/studio/dealAvailability";
import { isHiddenSubcat } from "../../../lib/rateCard";
import { fixedVenueFor } from "../../../lib/ims/fixedVenues";
import { itemImsSubcat, itemDimsText, priceForInvItem } from "../../../lib/ims/helpers";
import LazyYT from "../../../components/studio/LazyYT.jsx";
import KitComponentsEditor from "../../../components/shared/KitComponentsEditor";
import ItemHoverThumb from "../../../components/shared/ItemHoverThumb";
import InventoryItemPickerModal from "../../../components/shared/InventoryItemPickerModal";

// Temporary crowd-sourced library cleanup (Phase 1b). While true, anyone on the build screen
// can push a corrected element list back to the master library photo ("Save correction to
// master"). Flip to false (one-line deploy) once all photos are verified to remove the button.
const CORRECTION_MODE = true;


// ═══ TrussCard ═══
// The truss subsystem: type pills, dimensions, the span tip, truss type / material / drape
// density — and masking nested inside it, because masking panels attach to the truss.
// Module-scope so the icon components and maskingOptions / TRUSS_MATERIALS stay in scope.
// Compact page list: first, last, and a window around the current page. A library category can
// hold hundreds of photos, and 40 numbered buttons is not a pager.
// The four sections of a zone body, two per row. Order is the order of work: what goes in the
// zone, what holds it up, what it stands on, what gets printed.
const ZONE_SECTIONS = [
  { id: "elements", label: "Elements",        Icon: IconClipboard },
  { id: "truss",    label: "Truss & Masking", Icon: IconWall },
  { id: "platform", label: "Platform",        Icon: IconPlatform },
  { id: "print",    label: "Print",           Icon: IconPrinter },
];

function pageWindow(page, count, span = 1) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const keep = new Set([0, count - 1, page]);
  for (let d = 1; d <= span; d++) { keep.add(Math.max(0, page - d)); keep.add(Math.min(count - 1, page + d)); }
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}

// Copy of a truss row, carrying every field trussRowCost reads (see calcStructCost) and nothing
// else — the zone object also holds platform, carpet and element state that has no business on a
// truss row. `dims` and `mkWalls` are cloned, not shared, or editing the copy would reach back into
// the original. A fresh id keeps React keys distinct.
const cloneTrussRow = (src = {}) => ({
  id: "TR" + Date.now(),
  dims: { ...(src.dims || {}) },
  trT: src.trT,
  trussType: src.trussType,
  trussQty: src.trussQty || 1,
  trussFrontExt: src.trussFrontExt,
  trussFrontExtH: src.trussFrontExtH,
  trussBackDepth: src.trussBackDepth,
  trussMaterial: src.trussMaterial || "iron",
  drapeDensity: src.drapeDensity || "moderate",
  mkOn: !!src.mkOn,
  mkT: src.mkT || "",
  mkS: src.mkS,
  mkWalls: { ...(src.mkWalls || {}) },
  customCeilingItemId: src.customCeilingItemId || null,
  customMaskingItemId: src.customMaskingItemId || null,
});

// `nested` renders this same card as one of a zone's EXTRA truss structures: identical body, but
// titled "Truss N", carrying a remove control and no Add button of its own. Reusing the component
// rather than writing a cut-down row is what keeps an added truss genuinely equal to the first —
// front extension, the auto Box/Single-U line, custom ceiling and its own masking all included.
export function TrussCard({ S, customCeilingField, k, zc, zm, st, sZ, sD, fmt, showCosts, isDark, border, textP, textS, accent, customMaskingField, maskOpts = [], trussRates, nested = false, title, onRemove, rowIdx }) {
  // ═══ ONE SELECTED-STATE ═══ These three rows previously used a dark outline (material),
  // PINK (drape) and a borderless grey fill (masking). The borderless one was the real problem:
  // unselected options rendered as plain text and did not look clickable. `border` is never
  // "none" here, and the fill/tick match the filter pills used elsewhere in the app.
  const optPill = (sel) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999,
    fontSize: 11.5, fontWeight: sel ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap",
    lineHeight: 1.3, transition: "all 0.15s",
    background: sel ? (isDark ? "rgba(201,169,110,0.2)" : "#F6E7C8") : "transparent",
    color: sel ? (isDark ? "#D9BE86" : "#8A6A2F") : textS,
    border: `1px solid ${sel ? accent : border}`,
  });
  // Uppercase micro-caption, replacing "Truss Material:" sentence case with a colon.
  const rowCap = { fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: textS, minWidth: 62, flexShrink: 0 };
  return (
              /* Every truss is drawn the same — same border, same fill — so a second structure reads
                 as an equal of the first rather than a lesser sub-item. They stay visually separate
                 through spacing alone: 14px above a nested card clears the parent's masking block,
                 whose accent left-rule runs to its own bottom edge and would otherwise touch it.
                 box-sizing keeps the inner card inside the parent's padding instead of spilling
                 past its right edge. */
              <div style={{boxSizing:"border-box",width:"100%",
                border:`1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(26,26,46,0.08)"}`,
                borderRadius:10,padding:"10px 12px",marginTop:nested?14:0,marginBottom:nested?0:9,
                background:isDark?"rgba(255,255,255,0.015)":"#fff",
                fontSize:12.5}}>
                {/* Not gated on zm.defaultTruss any more — that flag is off for every zone created
                    from an area name, which left the card empty on the zones people actually build
                    in. It now only seeds which truss type is preselected. */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:600,color:textP}}><IconBolt size={12}/>{title||"Truss"}</span>
                    {/* How the rupees happen. Area and mode come from trussBaseArea — the same helper
                        trussRowCost charges on — and the rate from the live IMS truss rates for this
                        material + drape, so the caption cannot claim a different sum from the price.
                        Shows this ROW's base structure; front extension and a custom ceiling item are
                        priced on top and are visible in their own fields. */}
                    {showCosts&&(()=>{
                      const base=trussBaseArea(zc);
                      if(!base.area) return null;
                      const r=trussRateFor(base.mode==="box"?"box":"singleU",zc.trussMaterial,zc.drapeDensity,trussRates);
                      const qty=Math.max(1,zc.trussQty||1);
                      return <span style={{fontSize:10.5,color:textS,fontWeight:400}}>
                        {base.a}×{base.b} = {base.area} sqft × {fmt(r.rate)}/sqft{qty>1?` × ${qty}`:""}
                      </span>;
                    })()}
                  </div>
                  {/* The zone total belongs on the first card only — it already sums every row. */}
                  {nested
                    ? <span onClick={onRemove} title="Remove this truss" style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700,lineHeight:1}}>✕</span>
                    : showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.truss)}</span>}
                </div>
              <div style={{display:"flex",gap:8,marginBottom:6}}>
                {[["W","Width"],["L","Depth"],["H","Height"]].map(([d,label])=><div key={d} style={{flex:1}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Truss {label} (ft)</div>
                  <input type="number" value={zc.dims?.[d]||""} onChange={e=>sD(d,e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>)}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Truss Qty</div>
                  <input type="number" min={1} value={zc.trussQty||1} onChange={e=>sZ({trussQty:Math.max(1,parseInt(e.target.value)||1)})} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:11.5,color:textS,marginBottom:3}} title="Single-U extension on each front side, this many ft long. Priced as 2× Single U truss. Rare.">Front ext (ft/side)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExt||""} onChange={e=>sZ({trussFrontExt:Math.max(0,parseFloat(e.target.value)||0)})} placeholder="0" style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
                {zc.trT&&(Number(zc.trussFrontExt)||0)>0&&<div style={{flex:1}}><div style={{fontSize:11.5,color:textS,marginBottom:3}} title="Height of the front extension (can differ from box height). Defaults to box height.">Ext height (ft)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExtH||""} onChange={e=>sZ({trussFrontExtH:Math.max(0,parseFloat(e.target.value)||0)})} placeholder={String(zc.dims?.H||0)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
              </div>
              {/* §23 Phase 5 (28 May 2026) — Smart truss tip: add 1ft per pillar to physical span */}
              {(() => {
                const dims = zc.dims || {};
                const L = parseFloat(dims.L) || 0;
                const W = parseFloat(dims.W) || 0;
                if (L < 4 && W < 4) return null;  // no dims yet
                const span = Math.max(L, W);
                // Sweet spots for clean truss (using standard 15/12/10/8/5/4/3/2 beam stock + 1ft/pillar budget)
                // 2-pillar (span ≤ 30): 12, 17, 24, 27, 29, 32 → these give 0/1 joint, 0-gap
                // 3-pillar (31-60): 43, 47, 53, 57, 63 → 1-2 joints per segment
                // 4-pillar (61-90): 64, 74, 84 → 2 joints per segment
                const sweetSpots2 = [12, 17, 24, 27, 29, 32];
                const sweetSpots3 = [43, 47, 53, 57, 63];
                const sweetSpots4 = [64, 74, 84];
                const all = [...sweetSpots2, ...sweetSpots3, ...sweetSpots4];
                const isExact = all.includes(span);
                // Find nearest sweet spot within ±5ft
                let nearest = null;
                let nearestDist = 999;
                for (const s of all) {
                  const d = Math.abs(s - span);
                  if (d > 0 && d <= 5 && d < nearestDist) {
                    nearest = s;
                    nearestDist = d;
                  }
                }
                if (isExact) {
                  return <div style={{marginBottom:10,padding:"4px 8px",borderRadius:6,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",fontSize:11.5,color:"#15803D",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>✓</span><span>Smart truss: clean allocation (minimum joints).</span>
                  </div>;
                }
                if (nearest) {
                  return <div style={{marginBottom:10,padding:"4px 8px",borderRadius:6,background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.25)",fontSize:11.5,color:"#1E40AF",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{display:"flex",color:"#B45309"}}><IconBulb size={12}/></span><span>Tip: try <strong>{nearest}ft</strong> for cleanest truss (fewer joints, less ops effort).</span>
                  </div>;
                }
                return null;
              })()}
              {/* ── §23 Truss Type selector + Height-anchor validation ── */}
              {(()=>{
                const tr = resolveTrussConfig(zc);
                // Don't render anything when no truss intended (all blank)
                if (tr.source === "none") return null;
                // Validation error → inline red message (soft-block via Summary nav warning)
                if (tr.source === "invalid") {
                  return <div style={{marginBottom:10,padding:"8px 12px",borderRadius:8,background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.3)",fontSize:12,color:"#B91C1C",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>⚠️</span><span>{tr.error}</span>
                  </div>;
                }
                // 3-dim filled → auto-Full Box (read-only label, no choice)
                // All 3 dims filled ⇒ Full Box, with nothing to choose. The banner that said so was
                // a red-tinted restatement of the numbers directly above it, so it read as a warning
                // while carrying no action. Silent now; the 2-dim picker below still appears when
                // there IS a decision to make.
                if (tr.source === "auto-3dim") return null;
                // 2-dim → sales picks U or Half Box (default Half if not picked)
                const picked = zc.trussType;
                const opts = [
                  { id:"u_only",   label:"U Truss",       hint:"Cheapest — top + 2 sides only" },
                  { id:"half_box", label:"Half Box Truss", hint:"Middle — 3 sides (no back beam)" },
                ];
                return <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#FFFEF8",border:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:600,color:textS}}>Truss Type:</span>
                    {tr.source==="default-on-forget" && <span style={{fontSize:11,padding:"1px 6px",borderRadius:4,background:"rgba(217,119,6,0.12)",color:"#A16207",fontWeight:600}}>defaulted to Single U</span>}
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {opts.map(o=>{
                      const isOn = picked === o.id;
                      // When not picked, Single U (u_only) visually shows as the default (lighter highlight)
                      const isDefault = !picked && o.id === "u_only";
                      return <button key={o.id} onClick={()=>sZ({trussType:o.id})}
                        style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${isOn?textP:(isDefault?"rgba(217,119,6,0.4)":border)}`,background:isOn?"rgba(0,0,0,0.06)":(isDefault?"rgba(217,119,6,0.06)":"transparent"),color:isOn?textP:textS,fontSize:11.5,cursor:"pointer",fontWeight:isOn?700:(isDefault?600:400)}}
                        title={o.hint}>{o.label}</button>;
                    })}
                  </div>
                </div>;
              })()}
              {zc.trT && (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                  <span style={rowCap}>Material</span>
                  {TRUSS_MATERIALS.map(m=>{
                    const sel=(zc.trussMaterial|| "iron")===m.key;
                    return <span key={m.key} onClick={()=>sZ({trussMaterial:m.key})} style={optPill(sel)}>{sel&&<IconCheck size={9}/>}{m.label}</span>;
                  })}
                </div>
              )}
              {zc.trT && (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                  <span style={rowCap}>Drape</span>
                  {[{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o=>{
                    const sel=(zc.drapeDensity||"moderate")===o.v;
                    return <span key={o.v} onClick={()=>sZ({drapeDensity:o.v})} style={optPill(sel)}>{sel&&<IconCheck size={9}/>}{o.l}</span>;
                  })}
                  {/* Sits with Drape, not Material: it swaps the fabric ceiling drape for an
                      inventory item, so its cost comes out of the drape portion of the rate
                      (ceilingRatePerSqft), and it has nothing to do with the truss metal. */}
                  {zc.trT==="box" && customCeilingField(k, zc, false, rowIdx)}
                </div>
              )}
                {/* ═══ MASKING ═══ Nested inside Truss: masking panels attach to the truss, which is why
                    the original code grouped them. Sits after the truss's own controls so the card reads
                    "configure the truss → then what's masked onto it". */}
                <div style={{marginTop:10,marginLeft:12,paddingLeft:11,paddingBottom:2,borderLeft:`3px solid ${accent}33`}}>
                  <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:textS,marginBottom:5}}>Masking <span style={{fontWeight:500,letterSpacing:0,textTransform:"none",opacity:0.8}}>· on the truss</span></div>
                {(()=>{
                  const dL=zc.dims?.L||zc.dims?.S||0,dW=zc.dims?.W||zc.dims?.S||0,dH=zc.dims?.H||0;
                  const mw=zc.mkWalls||{};
                  const toggleWall=(wall)=>sZ({mkWalls:{...mw,[wall]:!mw[wall]},mkOn:true});
                  // §23 Phase 2.8 — config-aware walls (3 branches)
                  //   Full Box  → back/left/right toggleable (front always open)
                  //   Half Box  → back (L-span) + left/right (backDepth) all toggleable
                  //   U Truss   → back only (L-span). No left/right options.
                  const _trCfg = resolveTrussConfig(zc);
                  const _cfg = _trCfg?.config || (zc.trT==="box" ? "full_box" : "half_box");
                  const _spanL = _trCfg?.spanFt || dL || dW;
                  const _backDepth = zc.trussBackDepth || 4;
                  // §23 Phase 2.8 silent migration — set defaults once per zone.
                  // FIX A (26 May): For existing zones, force-tick left/right ON for Half Box
                  // and back ON for U Truss — overwriting prior `false` values. Runs once per
                  // zone, guarded by _mkWallsMigratedV28 flag. After migration, the user can
                  // untick freely; flag prevents re-migration.
                  if (zc.mkOn && !zc._mkWallsMigratedV28) {
                    const _nextMw = {...mw};
                    let _changed = false;
                    if (_cfg === "half_box") {
                      if (_nextMw.back  !== true) { _nextMw.back  = true; _changed = true; }
                      if (_nextMw.left  !== true) { _nextMw.left  = true; _changed = true; }
                      if (_nextMw.right !== true) { _nextMw.right = true; _changed = true; }
                    } else if (_cfg === "u_only") {
                      if (_nextMw.back !== true) { _nextMw.back = true; _changed = true; }
                    }
                    // Always mark migrated + record current config (even if no change needed)
                    setTimeout(() => sZ(_changed ? {mkWalls: _nextMw, _mkWallsMigratedV28: true, _lastMkCfg: _cfg} : {_mkWallsMigratedV28: true, _lastMkCfg: _cfg}), 0);
                  }
                  // §23 Phase 2.8 type-transition handler — if user adds/removes W dim and the truss
                  // config flips (half_box ↔ full_box, full_box → u_only, etc.), reset mkWalls per
                  // the new type's defaults. Half Box → Full Box: all OFF (opt-in). Anything → Half Box:
                  // all ON (default). Anything → U Truss: back ON, left/right cleared.
                  else if (zc.mkOn && zc._lastMkCfg && zc._lastMkCfg !== _cfg) {
                    let _resetMw;
                    if (_cfg === "full_box") {
                      // Opt-in per spec — start fully unchecked
                      _resetMw = {back: false, left: false, right: false};
                    } else if (_cfg === "half_box") {
                      _resetMw = {back: true, left: true, right: true};
                    } else if (_cfg === "u_only") {
                      _resetMw = {back: true};
                    } else {
                      _resetMw = mw;
                    }
                    setTimeout(() => sZ({mkWalls: _resetMw, _lastMkCfg: _cfg}), 0);
                  }
                  const walls = _cfg === "full_box" ? [
                    {id:"back",label:"Back",dim:`${dW}×${dH}`,sqft:dW*dH},
                    {id:"left",label:"Left",dim:`${dL}×${dH}`,sqft:dL*dH},
                    {id:"right",label:"Right",dim:`${dL}×${dH}`,sqft:dL*dH}
                  ] : _cfg === "half_box" ? [
                    {id:"back",label:"Back",dim:`${_spanL}×${dH}`,sqft:_spanL*dH},
                    {id:"left",label:"Left",dim:`${_backDepth}×${dH}`,sqft:_backDepth*dH},
                    {id:"right",label:"Right",dim:`${_backDepth}×${dH}`,sqft:_backDepth*dH}
                  ] : [
                    {id:"back",label:"Back",dim:`${_spanL}×${dH}`,sqft:_spanL*dH}
                  ];
                  return <div style={{padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:600,color:textP}}><IconWall size={12}/>Masking</span>
                      <div onClick={()=>sZ({mkOn:!zc.mkOn,mkWalls:zc.mkOn?{}:mw})} style={{width:30,height:16,borderRadius:8,background:zc.mkOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:zc.mkOn?16:2,transition:"left 0.2s"}}/></div>
                    </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.masking)}</span>}
                  </div>
                  {zc.mkOn&&<div style={{marginTop:4,paddingLeft:20}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                      {maskOpts.map(o=><button key={o.id} onClick={()=>sZ({mkT:o.id})} style={optPill(zc.mkT===o.id)}>{zc.mkT===o.id&&<IconCheck size={9}/>}{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                      {customMaskingField(k, zc, false, rowIdx)}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {walls.map(w=>{const on=mw[w.id];return <button key={w.id} onClick={()=>toggleWall(w.id)} style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${on?textP:border}`,fontSize:11.5,cursor:"pointer",fontWeight:on?600:400,background:on?"rgba(0,0,0,0.06)":"transparent",color:on?textP:textS}}>{on?"✓":""} {w.label} ({w.dim}){showCosts&&w.sqft>0?` = ${w.sqft} sqft`:""}</button>;})}
                    </div>
                  </div>}
                </div>;})()}
                </div>{/* /masking (nested in truss) */}

              </div>
  );
}

// ═══ TRUSS STACK ═══ The zone's own truss plus any extras, as SIBLING cards.
// The extras used to render inside the first card, which made every added truss a box within a box
// — inset by the first card's padding and wrapped by its border, so it read as a sub-item instead
// of another structure of equal standing. Rendering them here puts every truss at the same level.
//
// calcStructCost has always summed zc.extraTrussRows, and Deal Check, the truss engine and the
// stock reservation all read them — Build was simply the one place with no way to create one.
export function TrussStack({ S, customCeilingField, customMaskingField, k, zc, zm, st, sZ, sD, fmt, showCosts, isDark, border, textP, textS, accent, maskOpts, trussRates }) {
  const rows = zc.extraTrussRows || [];
  const write = (next) => sZ({ extraTrussRows: next });
  const shared = { S, customCeilingField, customMaskingField, k, zm, st, fmt, showCosts, isDark, border, textP, textS, accent, maskOpts, trussRates };
  return (<>
    <TrussCard {...shared} zc={zc} sZ={sZ} sD={sD} title={rows.length ? "Truss 1" : "Truss"} />
    {rows.map((row, ri) => {
      const setRow = (patch) => write(rows.map((x, i) => (i === ri ? { ...x, ...patch } : x)));
      // Same "3 dims ⇒ Box, 2 ⇒ Single U" rule the zone's own row applies.
      const setDim = (d, v) => { const cur = rows[ri] || {}; const dims = { ...(cur.dims || {}), [d]: parseFloat(v) || 0 };
        const n = [dims.W, dims.L, dims.H].filter((x) => (Number(x) || 0) > 0).length;
        write(rows.map((x, i) => (i === ri ? { ...x, dims, trT: n >= 3 ? "box" : n === 2 ? "singleU" : x.trT } : x))); };
      return <TrussCard key={row.id || ri} {...shared} zc={row} sZ={setRow} sD={setDim}
        nested title={`Truss ${ri + 2}`} rowIdx={ri} onRemove={() => write(rows.filter((_, i) => i !== ri))} />;
    })}
    {/* Adds a DUPLICATE, not a blank row: a zone with two trusses almost always has two of the same,
        so copying is the shorter path and clearing a field beats re-entering five. Copies the LAST
        truss, so repeated clicks give identical structures and editing Truss 2 before adding Truss 3
        carries forward rather than reverting to Truss 1. */}
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2, marginBottom: 9 }}>
      <button title="Adds a copy of the last truss — edit the copy as needed"
        onClick={() => write([...rows, cloneTrussRow(rows.length ? rows[rows.length - 1] : zc)])}
        style={{ fontSize: 10.5, fontWeight: 600, color: "#7C3AED", background: "transparent", border: "1px dashed #7C3AED80", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Truss</button>
    </div>
  </>);
}

// ═══ FloorCard ═══
// Platform and carpet. They share one set of floor dimensions (floorDims drives both areas),
// which is why they are one card rather than two.
// `nested` marks one of a zone's EXTRA platform footprints: same card, same colours, titled
// "Platform N" with a remove control in place of the cost, which the first card already totals
// across every footprint.
export function FloorCard({ S, zc, zm, st, sZ, sFD, fd, fmt, showCosts, isDark, border, textP, textS, imsCarpetMaterials, nested = false, title, onRemove }) {
  return (
              <div style={{boxSizing:"border-box",width:"100%",
                border:`1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(26,26,46,0.08)"}`,
                borderRadius:10,padding:"10px 12px",marginTop:nested?14:0,marginBottom:nested?0:9,
                background:isDark?"rgba(255,255,255,0.015)":"#fff",fontSize:12.5}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:nested?"2px 0 6px":"14px 0 6px"}}>
                <span style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:textS}}>{title||"Floor"}</span>
                {nested&&<span onClick={onRemove} title="Remove this platform" style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700,lineHeight:1}}>✕</span>}
              </div>
              <div style={{fontSize:12.5,marginBottom:6}}>
                {/* hasPlatform / hasCarpet no longer gate these rows — same reason as the truss row
                    above: they are off on every area-created zone, which emptied the card. */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:600,color:textP}}><IconPlatform size={12}/>Platform</span>
                    {PLAT_OPTS.map(o=><button key={o.id} onClick={()=>sZ({plH:zc.plH===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:11.5,cursor:"pointer",fontWeight:zc.plH===o.id?700:400,background:zc.plH===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.plH===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                  {/* st.platform / st.carpet are the zone's totals across every footprint, so they
                      belong on the first card only. */}
                  </div>{showCosts&&!nested&&<span style={{fontWeight:600,color:textP}}>{fmt(st.platform)}</span>}
                </div>
              </div>
              {/* Carpet sits with the floor dimensions, to the right of depth — it is priced on the
                  same area those two inputs define, so it belongs beside them rather than in a row
                  of its own above.
                  The options come from imsCarpetMaterials, NOT imsPrintMaterials. Carpet moved to
                  its own master list in IMS and platformRowCost prices against `carpetMaterials`;
                  this select was still reading the print list, so defaultCarpetMatId found no
                  "Carpet Old" there and fell through to "— None —" while pricing was quietly
                  charging the default anyway. Same list on both sides now, so the dropdown shows
                  the material actually being billed. Only the explicit CARPET_OFF sentinel means
                  no carpet — leaving it untouched has always meant Carpet Old. */}
              <div style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:96}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Floor Width (ft)</div>
                  <input type="number" value={fd.W||""} onChange={e=>sFD("W",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.W||"—"}/></div>
                <div style={{flex:1,minWidth:96}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Floor Depth (ft)</div>
                  <input type="number" value={fd.L||""} onChange={e=>sFD("L",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.L||"—"}/></div>
                <div style={{flex:1.5,minWidth:150}}>
                  <div style={{fontSize:11.5,color:textS,marginBottom:3,display:"inline-flex",alignItems:"center",gap:5}}><IconCarpet size={12}/>Carpet</div>
                  <select value={zc.cpT||defaultCarpetMatId(imsCarpetMaterials)||""} onChange={e=>sZ({cpT:e.target.value})}
                    style={{width:"100%",boxSizing:"border-box",fontSize:11.5,padding:"7px 8px",borderRadius:8,border:`1px solid ${border}`,background:"#fff",color:"#111827"}}>
                    {(imsCarpetMaterials||[]).map(m=><option key={m.id} value={m.id} style={{color:"#111827",background:"#fff"}}>{m.name}{showCosts?` · ₹${m.ratePerSqft}/sqft`:""}</option>)}
                    {/* "— None —" is no longer offered: every floor gets carpet. It is still rendered
                        for a zone already saved as CARPET_OFF, otherwise the select would fall back
                        to showing the first material while platformRowCost kept charging ₹0 for it —
                        a dropdown disagreeing with the bill. Pick any material there and the option
                        disappears for good. */}
                    {zc.cpT===CARPET_OFF&&<option value={CARPET_OFF} style={{color:"#111827",background:"#fff"}}>— None —</option>}
                  </select></div>
                {showCosts&&!nested&&<div style={{fontSize:11.5,color:textS,paddingBottom:8,whiteSpace:"nowrap"}}>Carpet <span style={{fontWeight:600,color:textP}}>{fmt(st.carpet)}</span></div>}
              </div>
              <div style={{fontSize:11.5,color:textS,lineHeight:1.3,marginBottom:4}}>{(fd.L||fd.W)?`${fd.L||0}×${fd.W||0} = ${(fd.L||0)*(fd.W||0)} sqft`:"Uses truss L×W if empty"}</div>

              </div>
  );
}

// ═══ FLOOR STACK ═══ The zone's own floor plus any extra platform footprints, as SIBLING cards —
// same reasoning as TrussStack: rendering the extras inside the first card made each one a box
// within a box, inset and wrapped by the first card's border.
//
// platformRowCost already runs per row over zc.extraPlatformRows and buildPlatformPlan draws one
// ops entry each, so the cost and the plan were ready long before there was a way to add one.
export function FloorStack({ S, zc, zm, st, sZ, sFD, fd, fmt, showCosts, isDark, border, textP, textS, imsCarpetMaterials }) {
  const rows = zc.extraPlatformRows || [];
  const write = (next) => sZ({ extraPlatformRows: next });
  const shared = { S, zm, st, fmt, showCosts, isDark, border, textP, textS, imsCarpetMaterials };
  return (<>
    <FloorCard {...shared} zc={zc} sZ={sZ} sFD={sFD} fd={fd} title={rows.length ? "Floor 1" : "Floor"} />
    {rows.map((row, ri) => {
      const setRow = (patch) => write(rows.map((x, i) => (i === ri ? { ...x, ...patch } : x)));
      const setFd = (d, v) => setRow({ floorDims: { ...(rows[ri]?.floorDims || {}), [d]: parseFloat(v) || 0 } });
      return <FloorCard key={row.id || ri} {...shared} zc={row} sZ={setRow} sFD={setFd} fd={row.floorDims || {}}
        nested title={`Platform ${ri + 2}`} onRemove={() => write(rows.filter((_, i) => i !== ri))} />;
    })}
    {/* A copy, like + Add Truss — a second footprint in a zone usually mirrors the first, and its own
        carpet can then be changed. Copies the LAST one so repeated adds stay consistent. */}
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2, marginBottom: 9 }}>
      <button title="Adds a copy of the last platform — edit the copy as needed"
        onClick={() => { const src = rows.length ? rows[rows.length - 1] : zc;
          write([...rows, { id: "PL" + Date.now(), plH: src.plH || "", floorDims: { ...(src.floorDims || {}) }, cpT: src.cpT || "" }]); }}
        style={{ fontSize: 10.5, fontWeight: 600, color: "#059669", background: "transparent", border: "1px dashed #05966980", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Platform</button>
    </div>
  </>);
}

export default function StudioBuild({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS: textSRaw, textP, cardBg, fmt, cat,
    // events / library / video sources
    events, libItems, sourceEvent, sourceVideo, ytVideoTags, allVideos,
    getFullCost, findTemplate, templates,
    // client / function meta
    clientName, clientDate, activeFnMeta, venue, fn, extraFunctions,
    studioFloralData, venueParents, loadAvailability, getStudioAvailable, activeBlocksForDate,
    activeFnIdx, collectAllFunctionData, rcSubcatFactors, rcFactorByKey, rcFloralModeByKey,
    // palette / colour catalogues
    imsPaletteCatalogue, imsColourCatalogue,
    // venues (for named-venue correction + the zone-photo Venue pill filter)
    allInhouseVenues = [], customOutdoor = [], allVenueData = {}, allOutdoorDB = [], leafInhouseVenues = [],
    // date demand
    dateTypes, clientLedger, activeClientId,
    // build canvas
    setShowCosts, grandTotal, totalCost, transportCalc,
    savedInsps, setStep, setPreviewImg,
    floralRatio, setFloralRatio,
    zoneKeys, customZones, setCustomZones, zoneLabelsD, zoneMeta,
    enabledEls, setEnabledEls, customMode, toggleEl,
    zoneElements, setZoneElements, zoneConfig, setZoneConfig, setActiveZones,
    calcElsCost, calcStructCost, calcPhotoCost, getElPrice, applyFloralRatio,
    elSelectedPhoto, selectElPhoto, setElSelectedPhoto, elNotes, setElNotes,
    setElGallery, setGalleryIdx,
    newCzSrc, setNewCzSrc,
    // uploads / ai
    zoneUploading, handleZoneUpload,
    zoneElSearch, setZoneElSearch, zonePrintSearch, setZonePrintSearch,
    // zone-photo filters
    zpFilterOpen, setZpFilterOpen, zpHasFilters, zpFilters, setZpFilters, zpToggleFilter, zpFilterPhoto, zpVenueMatch,
    // rate card — kept for legacy/AI-tagged elements without invId
    rcItems, rcCats, rcIsSMB, isSubTagHidden,
    // IMS inventory — "+Add element" sources from here now, not the Rate Card
    imsInventory,
    // Print material rates (IMS Admin → Settings → 🖨️ Print Materials)
    imsPrintMaterials,
    // Carpet material rates (IMS Admin → Settings → 🟫 Carpet Materials) — own master list
    imsCarpetMaterials,
    // Truss & masking rates (IMS Admin → Settings → 🏗️ Truss & Masking Rates) + bundled calcStructCost input
    imsTrussRates, imsMaskingRates, structRates,
    // Pure flower-recipe elements with no inventory backing (e.g. "Flower Garden") — addable
    // alongside inventory items in the "+Add element" search
    recipeOnlyPatterns,
    // taxonomy
    taxonomy,
    // paint / deal check
    dealCheckData, normalizePaintAllocation, paintPillLabel, isSubcatPaintable,
    PAINT_TOKENS_FALLBACK, maxRepaintCostInSubcat, imsDefaultPaintCost, setPaintPickerTarget,
    // custom items
    dcCustomItems, setDcCustomItems, setDcCustomModal,
    // video modal
    setVideoModal, setVideoPlaying,
    // misc
    showMsg, askConfirm, saveLib, authUser, logVerificationEvent,
    // point-lookup safety net (lazy library cache — see StudioApp.jsx)
    ensureLibItems,
  } = ctx;
  // Details & pricing are always shown now (the old global toggle is gone). Each zone is instead
  // independently collapsable via zoneCollapsed — collapsed = header + total only; expanded = full body.
  const showCosts = true;
  const [zoneCollapsed, setZoneCollapsed] = useState({});
  // Full-screen photo preview — { items: [{src, name}], idx }. Carries the zone's whole matched
  // set, not just the one photo, so you can step through them without closing and reopening.
  const [lightbox, setLightbox] = useState(null);
  // Wraps at both ends: the sets are small and a dead arrow on the last photo is just a puzzle.
  const lightboxStep = (d) => setLightbox(lb => (lb && lb.items?.length)
    ? { ...lb, idx: (lb.idx + d + lb.items.length) % lb.items.length } : lb);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight") { e.preventDefault(); lightboxStep(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); lightboxStep(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);
  // Filter chips read best alphabetised — one helper, applied to every filter list below.
  const azSort = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));
  // Default = collapsed: a zone is expanded ONLY when explicitly set to false.
  const isCollapsed = (k) => zoneCollapsed[k] !== false;
  // id → library item. The photo strip needs a master per tile (verified flag, filters), and doing
  // that as a linear find per tile is O(photos x library) every render.
  const libById = useMemo(() => new Map((libItems || []).map((i) => [i.id, i])), [libItems]);
  // Is this element a kit? One definition, shared by the grouping sort below and by each card's own
  // body, so the two can never disagree about which cards are kits.
  const elIsKit = (el) => {
    const inv = el?.invId ? (imsInventory || []).find(i => i.id === el.invId) : null;
    return !!(inv && Array.isArray(inv.subItems) && inv.subItems.length > 0);
  };
  // Plain cards first, kits after — stable within each group, so the order items were added still
  // holds inside a group. `idx` is the ORIGINAL array index and stays that way: it is what every qty
  // edit and delete writes through, so re-indexing here would point each edit at the wrong element.
  // `firstKit` marks the boundary card, which is pinned to column 1 so the kits start a fresh row.
  const groupedEls = (k) => {
    const rows = (zoneElements[k] || [])
      .map((el, idx) => ({ el, idx, isKit: elIsKit(el) }))
      .sort((a, b) => (a.isKit ? 1 : 0) - (b.isKit ? 1 : 0));
    const first = rows.findIndex((r) => r.isKit);
    return rows.map((r, i) => ({ ...r, firstKit: i === first }));
  };

  // Demand for the event date, derived once. The header chip and the date banner's tint both read
  // it, so they cannot drift apart. isLow is deliberately absent: a client should never be told the
  // date is quiet.
  const dateDemand = (() => {
    if (!clientDate) return null;
    const dt = dateTypes[clientDate];
    const booked = clientLedger.filter(c => c.eventDate === clientDate && c.status === "booked").length;
    const ongoing = clientLedger.filter(c => c.eventDate === clientDate && c.status === "ongoing" && c.id !== activeClientId).length;
    const isHigh = booked >= 2 || dt === "saya";
    return { dt, booked, ongoing, isHigh, isMod: !isHigh && booked === 1 };
  })();
  // Height of the sticky header plus a little air, so what we scroll to clears it.
  const SCROLL_OFFSET = 74;
  // Which zone just opened, if any. An effect (below) does the scrolling: it runs after React has
  // committed the newly revealed content, whereas requestAnimationFrame only guesses at that moment.
  const [scrollToZone, setScrollToZone] = useState(null);
  useEffect(() => {
    if (!scrollToZone || typeof document === "undefined") return;
    setScrollToZone(null);
    // The SECTION TILES, not the zone card. The card's header is already on screen — you just
    // clicked a chip in it — so scrolling there moves up, not down to the details. Custom zones have
    // no tiles, so they fall back to their card.
    const el = document.getElementById(`zone-sec-${scrollToZone}`) || document.getElementById(`zone-${scrollToZone}`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [scrollToZone]);
  const toggleZoneCollapse = (k) => {
    const opening = isCollapsed(k);          // collapsed now means this click opens it
    setZoneCollapsed((p) => ({ ...p, [k]: p[k] === false ? true : false }));
    if (opening) setScrollToZone(k);         // never on collapse — that would yank the page
  };
  // Which of the four zone sections is open, per zone. Undefined = none, so a zone body starts
  // as four tiles and nothing else. The element card's collapse reads this too, so the tile and
  // the card header can never disagree about whether the list is showing.
  const [zoneSection, setZoneSection] = useState({});
  const openZoneSection = (k, id) => setZoneSection((p) => ({ ...p, [k]: p[k] === id ? undefined : id }));
  const isElCardOpen = (k) => zoneSection[k] === "elements";
  const toggleElCard = (k) => openZoneSection(k, "elements");
  // A folded rail: a 38px strip on its own edge that brings the panel back. The label reads
  // vertically so the strip stays narrow.
  const railTab = (side, label, icon) => (
    <div className="rail-tab" onClick={()=>setRailsOpen(true)} title={`Show ${label}`}
      style={{width:38,flexShrink:0,position:"sticky",top:70,alignSelf:"flex-start",cursor:"pointer",
        display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"12px 0 14px",
        borderRadius:10,border:`1px solid ${border}`,background:cardBg}}>
      <span style={{display:"flex",color:accent}}>{icon}</span>
      <span style={{writingMode:"vertical-rl",textOrientation:"mixed",fontSize:9.5,fontWeight:700,
        letterSpacing:1,textTransform:"uppercase",color:textS,whiteSpace:"nowrap"}}>{label}</span>
      <span style={{display:"flex",color:textS,transform:side==="left"?"rotate(-90deg)":"rotate(90deg)"}}><IconChevron size={11}/></span>
    </div>
  );
  // Sub-label under each tile's title. Read straight off zoneConfig — no cost maths here, so it
  // cannot drift from the figures inside the panels.
  const zoneSectionSub = (k, id) => {
    const zc = zoneConfig[k] || {}, zm = zoneMeta[k] || {}, d = zc.dims || {}, fd = zc.floorDims || {};
    if (id === "elements") { const n = (zoneElements[k] || []).length; return n ? `${n} item${n === 1 ? "" : "s"}` : "No items yet"; }
    // Empty rather than "Not set" — the tile already reads as untouched, and the words added a
    // line of noise to every zone on first open. sectionTile skips the sub-label row when blank.
    if (id === "truss") return (d.W || d.L) ? `${d.W || "–"} × ${d.L || "–"} ft${zm.hasMasking && zc.mkT ? " · masking" : ""}` : "";
    // floorDims keys are W/L — `fd.D` never existed, so the depth always rendered as "–".
    if (id === "platform") return (fd.W || fd.L) ? `${fd.W || "–"} × ${fd.L || "–"} ft` : "";
    const n = (zc.prints || []).length; return n ? `${n} print${n === 1 ? "" : "s"}` : "None";
  };
  const sectionTile = (k, sec) => {
    const on = zoneSection[k] === sec.id;
    const sub = zoneSectionSub(k, sec.id);
    return <div key={sec.id} className="sec-tile" data-on={on?"1":"0"} onClick={()=>openZoneSection(k,sec.id)}
      style={{display:"flex",alignItems:"center",gap:9,padding:"11px 12px",borderRadius:10,cursor:"pointer",
        border:`1px solid ${on?accent:border}`,background:on?`${accent}12`:cardBg}}>
      <span style={{display:"flex",flexShrink:0,color:on?accent:textS}}><sec.Icon size={16}/></span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12.5,fontWeight:700,color:on?accent:textP}}>{sec.label}</div>
        {sub&&<div style={{fontSize:10.5,color:textS,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>}
      </div>
      <span style={{display:"flex",flexShrink:0,color:on?accent:textS,transform:on?"rotate(180deg)":"none",transition:"transform .18s ease"}}><IconChevron size={12}/></span>
    </div>;
  };
  // Ratio / 100% share one selected-state. `border` is never "none": an inactive pill has to
  // look clickable. Active is a tint, not a solid fill — these sit inside a dense row.
  const floralPill = (on) => ({
    padding: "2px 8px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontWeight: on ? 700 : 500,
    border: `1px solid ${on ? "#EC4899" : border}`,
    background: on ? (isDark ? "rgba(236,72,153,0.22)" : "rgba(236,72,153,0.12)") : "transparent",
    color: on ? (isDark ? "#F9A8D4" : "#BE185D") : textS,
    transition: "all 0.15s",
  });
  // Shown in the header while collapsed, so a closed card still says what is inside it.
  const elCardSummary = (k) => {
    const els = zoneElements[k] || [];
    if (!els.length) return null;
    const total = showCosts ? calcElsCost(els, true, zoneConfig[k]) : 0;
    return <span style={{fontSize:10.5,fontWeight:600,color:textS,display:"inline-flex",alignItems:"center",gap:6,marginLeft:2}}>
      <span>{els.length} item{els.length === 1 ? "" : "s"}</span>
      {showCosts && total > 0 && <span style={{color:textP,fontWeight:700}}>{fmt(total)}</span>}
    </span>;
  };
  const [notesOpen, setNotesOpen] = useState({}); // per-zone: reveal the client-note field (else a small icon)
  // Per-zone photo-strip scroll containers, keyed by zone key — lets us scroll a strip back to
  // the start after picking a photo (it gets pinned to the front, but the scroll position doesn't
  // otherwise follow it there).
  const stripRefs = useRef({});

  const getLibPhotosForZone = ctx.getLibPhotosForZone;
  // ═══ Zone-photo filter pills — shared style + venue-type-aware venue list ═══
  // ═══ SECONDARY TEXT COLOUR ═══
  // The theme's `textS` is #8b8fa3 — a pale lavender-grey measuring ~3.1:1 on the light card,
  // below WCAG AA. It's what made disabled zone names ("Stage", "Centre Lounge") look washed out.
  // Shadowing it here upgrades all 125 call sites on this page at once, with no churn: every
  // `color: textS` below now resolves to the AA-contrast value. `textSRaw` keeps the original
  // available should anything ever need the lighter tone.
  const textS = isDark ? "#A6ADC0" : "#5A6076";   // 6.4:1 on white

  // One definition of "what does this zone cost" — lifted verbatim out of the zone header so the
  // header and the live-pricing tile share it and cannot drift apart. Arithmetic is unchanged.
  const zoneTotal = (k) => calcElsCost(zoneElements[k],true,zoneConfig[k])+(zoneConfig[k]?calcStructCost(k,zoneConfig[k],structRates).total:0)+dcCustomItems.filter(c=>c.fnIdx===(activeFnIdx||0)&&c.zoneKey===k).reduce((acc,c)=>acc+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
  void textSRaw;

  // Photo-filter pill. Was 9px in a 2px-tall chip with `textS` (~3.1:1) when inactive — too small
  // to hit and too faint to read. One geometry, used by all 25 call sites on this page.
  const zpTextM = textS;
  const zpGold  = isDark ? "#D9BE86" : "#8A6A2F";
  // Panel / section / pill come from the shared module, so this panel is literally the same
  // component tree as the Browse filters — the two cannot drift apart.
  const { Panel: FPanel, Section: FSection, Pill: FPill, SearchBox: FSearchBox, ghostPill: fGhostPill, css: filterCSS } =
    makeFilterUI({ isDark, accent, textP, S });
  const zpPill = (active) => ({ display: "inline-flex", alignItems: "center", padding: "4px 11px", borderRadius: 999, fontSize: 10.5, lineHeight: 1.4, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s", background: active ? accent : "transparent", color: active ? (isDark ? "#1a1a2e" : "#fff") : zpTextM, border: `1px solid ${active ? accent : border}`, fontWeight: active ? 600 : 500 });
  const zpIndoorVenues = allInhouseVenues.filter(v => (allVenueData[v]?.type || "Outdoor") === "Indoor");
  const zpOutdoorVenues = [
    ...allInhouseVenues.filter(v => (allVenueData[v]?.type || "Outdoor") !== "Indoor"),
    ...(allOutdoorDB || []).map(v => v.name).filter(Boolean),
  ];
  const zpWantIndoor = (zpFilters.venueType || []).includes("Indoor");
  const zpWantOutdoor = (zpFilters.venueType || []).some(v => v === "Outdoor" || v === "Semi-Outdoor");
  const zpVenueChoices = zpWantIndoor && !zpWantOutdoor ? zpIndoorVenues
    : zpWantOutdoor && !zpWantIndoor ? zpOutdoorVenues
    : Array.from(new Set([...zpIndoorVenues, ...zpOutdoorVenues]));
  // "Correct photo tags" modal target — { libId, zoneKey, name, tags } (Phase 1b: full-tag correction)
  // Whole-build shortcut for the per-zone 🔍 photo filter — zpFilters/zpToggleFilter are already
  // shared app-wide state (every zone's own filter button reads/writes the exact same values), so
  // this only needs its own open/close flag; setting a value here instantly narrows every zone's
  // photo picker too, without forcing every zone's own panel open at the same time.
  // Which photo-filter groups are expanded. All closed by default — dumping six groups at once
  // (Color palette alone has ~40 options) pushed the build itself off the screen.
  const [zpOpen, setZpOpen] = useState({});
  const zpToggleOpen = (k) => setZpOpen(p => ({ ...p, [k]: !p[k] }));
  const [correctPhoto, setCorrectPhoto] = useState(null);
  const [corrVenueGrp, setCorrVenueGrp] = useState(""); // build correction modal: inhouse|outside venue group
  const [gridZones, setGridZones] = useState({}); // per-zone: show the photo picker as a wrapping grid vs horizontal strip
  const [phPage, setPhPage] = useState({});   // per-zone page index for the photo picker
  // Both side rails fold away together, from the one control in the Photo filters header.
  const [railsOpen, setRailsOpen] = useState(true);
  // Palette search in the photo-filter rail. Held here, not in the Section, so it survives the
  // panel re-rendering on every filter change.
  const [zpPaletteQ, setZpPaletteQ] = useState("");
  // Venue runs to 40+ names, which buried every group under it. Show a first screenful, put the
  // rest behind "See all", and give the group the same smart search the palette group has.
  const [zpVenueQ, setZpVenueQ] = useState("");
  const [zpVenueAll, setZpVenueAll] = useState(false);
  const ZP_VENUE_CAP = 8;
  const PH_COLS = 4;                          // always four across: a wider column means BIGGER
  const PH_PER_PAGE = railsOpen ? 4 : 8;      // photos, not more of them squeezed into a row
  const RAIL_W = 258;
  // A filter change re-orders the whole matched set, so "page 3" of the old list is meaningless.
  useEffect(() => { setPhPage({}); }, [zpFilters]);
  const phDot = (on) => ({ minWidth: 27, height: 27, padding: "0 7px", borderRadius: 8, cursor: "pointer",
    fontSize: 11.5, fontWeight: on ? 700 : 500, border: `1px solid ${on ? accent : border}`,
    background: on ? `${accent}18` : "transparent", color: on ? accent : textS });
  const phNav = (off) => ({ ...phDot(false), display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: off ? "default" : "pointer", opacity: off ? 0.35 : 1, color: off ? textS : textP });
  // One ref is enough: there is only ever one gesture in flight. It records which zone started it,
  // so a fast swipe cannot page a different zone's strip, and `swiped` suppresses the click that
  // a touchend would otherwise deliver to the tile under the finger.
  const phSwipe = useRef({ k: null, x: 0, y: 0, dx: 0, swiped: false });
  // Which slide animation each zone's grid is currently running. Alternates between …1 and …2 so
  // that paging twice the same way restarts the animation instead of leaving it finished.
  const [phAnim, setPhAnim] = useState({});
  const phGoTo = (k, next, page) => {
    if (next === page) return;
    const dir = next > page ? "L" : "R";                       // L: moving forward, content enters from the right
    setPhAnim(a => ({ ...a, [k]: `phIn${dir}${a[k] === `phIn${dir}1` ? 2 : 1}` }));
    setPhPage(p => ({ ...p, [k]: next }));
  };
  const phTurn = (k, dir, page, pageCount) => {
    phGoTo(k, Math.min(pageCount - 1, Math.max(0, page + dir)), page);
  };
  // Nothing is attached when there is only one page — grid view included.
  const phSwipeHandlers = (k, page, pageCount) => pageCount <= 1 ? {} : {
    onTouchStart: (e) => { const t = e.touches[0]; phSwipe.current = { k, x: t.clientX, y: t.clientY, dx: 0, swiped: false }; },
    onTouchEnd: (e) => {
      const st = phSwipe.current;
      if (st.k !== k) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - st.x, dy = t.clientY - st.y;
      // horizontal intent only, and far enough that a tap on a tile can never qualify
      const isSwipe = Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5;
      phSwipe.current = { k: null, x: 0, y: 0, dx: 0, swiped: isSwipe };
      if (isSwipe) { e.preventDefault(); phTurn(k, dx < 0 ? 1 : -1, page, pageCount); }
    },
    // trackpad two-finger swipe. Accumulated because one gesture arrives as many small deltas.
    onWheel: (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // vertical scrolling stays vertical
      const acc = (phSwipe.current.k === k ? phSwipe.current.dx : 0) + e.deltaX;
      if (Math.abs(acc) < 90) { phSwipe.current = { k, x: 0, y: 0, dx: acc, swiped: false }; return; }
      phSwipe.current = { k, x: 0, y: 0, dx: 0, swiped: false };
      phTurn(k, acc < 0 ? -1 : 1, page, pageCount);
    },
  };
  // The ▦ grid view scrolls inside itself, so after selecting — which moves the photo to the front —
  // that container has to be taken back to the top or the selection sits above the fold. In the
  // paginated strip scrollTop is always 0, so this does nothing there.
  const phScrollTop = (k) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`ph-grid-${k}`);
    if (!el || el.scrollTop === 0) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  // A swipe that paged leaves a click behind on some browsers; tiles check this before opening.
  const phSwipedJustNow = () => { const was = phSwipe.current.swiped; phSwipe.current.swiped = false; return was; };
  // Custom Ceiling / Custom Masking — { k: zoneKey, kind: "ceiling" | "masking" } or null
  const [customPicker, setCustomPicker] = useState(null);
  // `rowIdx` addresses an entry of zoneConfig[k].extraTrussRows; undefined means the zone's own
  // row 0. Without it these wrote straight to zoneConfig[k], so picking a Custom Ceiling on the
  // second truss silently set it on the first.
  const patchTrussRow = (k, rowIdx, patch) => setZoneConfig(p => {
    const zone = p[k] || {};
    if (rowIdx == null) return { ...p, [k]: { ...zone, ...patch } };
    const rows = [...(zone.extraTrussRows || [])];
    if (!rows[rowIdx]) return p;
    rows[rowIdx] = { ...rows[rowIdx], ...patch };
    return { ...p, [k]: { ...zone, extraTrussRows: rows } };
  });
  const customCeilingField = (k, zc, dense, rowIdx) => {
    const item = zc.customCeilingItemId ? (imsInventory || []).find(i => i.id === zc.customCeilingItemId) : null;
    const fs = dense ? 9 : 10;
    if (item) return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: fs, background: "rgba(124,58,237,0.12)", color: "#7C3AED", fontWeight: 600, marginLeft: 8 }}>
      <IconPlay size={12}/> {item.name}
      <span onClick={() => patchTrussRow(k, rowIdx, { customCeilingItemId: null })} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700 }}>×</span>
    </span>;
    return <button onClick={() => setCustomPicker({ k, kind: "ceiling", rowIdx })} style={{ padding: dense ? "2px 7px" : "3px 9px", borderRadius: 6, fontSize: fs, border: `1px dashed ${border}`, background: "transparent", color: textS, cursor: "pointer", marginLeft: 8 }}><IconPlay size={11}/> Custom Ceiling</button>;
  };
  const customMaskingField = (k, zc, dense, rowIdx) => {
    const item = zc.customMaskingItemId ? (imsInventory || []).find(i => i.id === zc.customMaskingItemId) : null;
    const fs = dense ? 9 : 10;
    if (item) return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 5, fontSize: fs, background: "rgba(124,58,237,0.12)", color: "#7C3AED", fontWeight: 600 }}>
      <IconCamera size={12}/> {item.name}
      <span onClick={() => patchTrussRow(k, rowIdx, { customMaskingItemId: null })} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700 }}>×</span>
    </span>;
    return <button onClick={() => setCustomPicker({ k, kind: "masking", rowIdx })} style={{ padding: dense ? "2px 7px" : "3px 9px", borderRadius: 5, fontSize: fs, border: `1px dashed ${border}`, background: "transparent", color: textS, cursor: "pointer" }}><IconCamera size={11}/> Custom Masking</button>;
  };
  // Fixed-venue "Repeat setup" — when the current function's venue is a fixed venue, each zone can be
  // marked ♻️ Repeat (reuse the standing setup → discounted rental, no build labour; venue's fixed crew
  // covers it) vs ✨ Fresh (default). Stored in zoneConfig[k].repeat so it flows to Deal Check.
  // Prefer dealCheckData (populated once Deal Check opens); fall back to the mount-loaded config so the
  // Repeat/Fresh chip shows in Build without needing to open Deal Check first.
  const _fvCfg = {
    fixedVenues: (dealCheckData?.fixedVenues && dealCheckData.fixedVenues.length) ? dealCheckData.fixedVenues : (studioFloralData?.fixedVenues || []),
    venueParents: dealCheckData?.venueParents || venueParents || {},
  };
  const fixedVenueHere = fixedVenueFor(_fvCfg, activeFnMeta?.venue || venue);

  // Live soft-blocking: how much of an inventory item is left for THIS event, after
  // netting out both other events' commitments (getStudioAvailable) and whatever
  // sibling zones/functions of this same deal have already used (qtyUsedElsewhereInBuild).
  // exclude={fnIdx,zoneKey} → whole-zone exclusion; add elIdx to exclude just one row.
  // Returns null when the item's stock isn't otherwise touched this deal (no badge needed) —
  // only surfaces a signal once some OTHER zone/function has actually drawn on it.
  const remainingForItem = (itemId, zoneKey, elIdx) => {
    const it = (imsInventory || []).find(i => i.id === itemId);
    if (!it) return null;
    const fns = collectAllFunctionData ? collectAllFunctionData() : [];
    const exclude = elIdx == null ? { fnIdx: activeFnIdx, zoneKey } : { fnIdx: activeFnIdx, zoneKey, elIdx };
    const usedElsewhere = qtyUsedElsewhereInBuild(itemId, fns, imsInventory, exclude, activeFnMeta?.date || clientDate);
    if (usedElsewhere <= 0) return null;
    const otherEventsAvail = getStudioAvailable(it, activeBlocksForDate);
    return Math.max(0, otherEventsAvail - usedElsewhere);
  };

  const isRepeat = (k) => !!(zoneConfig[k] && zoneConfig[k].repeat);
  const toggleRepeat = (k) => setZoneConfig(p => ({ ...p, [k]: { ...(p[k] || {}), repeat: !(p[k] && p[k].repeat) } }));

  // ── Scale By (Centre Pieces) ─────────────────────────────────────────────────────────────────
  // A single "set of N" multiplier for a zone: instead of hand-bumping each element (1 table, 6 chairs…),
  // the salesperson sets Scale By = N and every element count is rescaled proportionally. Because it
  // rewrites the actual element qtys, pricing, Deal Check and manpower all follow automatically. Stored
  // in zoneConfig[k].scale for the field value + proportional math.
  const zoneScaleVal = (k) => Math.max(1, Math.round(Number(zoneConfig[k]?.scale) || 1));
  const setZoneScale = (k, raw) => {
    const newS = Math.max(1, Math.round(Number(raw) || 1));
    const oldS = zoneScaleVal(k);
    setZoneElements(p => ({ ...p, [k]: (p[k] || []).map(e => {
      // Per-unit base: use the stored baseQty, else derive it from the current (possibly already-scaled)
      // qty. Effective qty = base × scale — always from a fixed base, so it never drifts across changes.
      const base = (e.baseQty != null && Number.isFinite(Number(e.baseQty)))
        ? Number(e.baseQty)
        : (oldS > 1 ? Math.round((Number(e.qty) || 0) / oldS) : (Number(e.qty) || 0));
      return { ...e, baseQty: base, qty: Math.max(0, Math.round(base * newS)) };
    }) }));
    setZoneConfig(p => ({ ...p, [k]: { ...(p[k] || {}), scale: newS } }));
  };

  // ── Per-element stock availability browser (Build) ───────────────────────────────────────────
  // A discreet 📦 on each element opens a modal listing that element's IMS sub-category items (alias-aware)
  // with the FREE count on the event date (owned − blocked). Picking one + Save pins it on the element
  // (deal-local) → Deal Check auto-match honors the pin. No costs shown — availability only.
  const [availModal, setAvailModal] = useState(null); // { zoneKey, idx, elName, subcat, loading, items, selectedId }
  // Hover-to-zoom on an element's thumbnail — same fixed-position enlarged-preview pattern as
  // ManageLibrary.jsx's elHoverImg. Keyed by "zoneKey:idx" since two near-duplicate element-list
  // blocks in this file can both be on screen at once.
  const [elThumbHover, setElThumbHover] = useState(null); // { key, top, bottom, left }
  // `onPick(pickedItemOrNull)`, when given, hands the picked item back to the CALLER instead of the
  // hardcoded zoneElements-by-index update below — lets a kit component row (KitComponentsEditor's
  // own 📦 icon) reuse this exact same modal/availability-lookup to swap ITS item, without a second
  // copy of the modal or the availability-fetch logic.
  const openAvailModal = async (zoneKey, idx, el, rc, onPick) => {
    // Inventory-sourced elements (el.invId) already know their exact real sub-category — no
    // Rate-Card→IMS alias lookup needed, unlike the legacy rc path below.
    const invItem = el?.invId ? (imsInventory || []).find(i => i.id === el.invId) : null;
    const subcat = (invItem ? (invItem.subCat || invItem.subcategory) : "") || (rc ? itemImsSubcat(rc) : "") || rc?.sub || "";
    const date = activeFnMeta?.date || clientDate || "";
    setAvailModal({ zoneKey, idx, elName: el?.name || "", subcat, date, loading: true, items: [], selectedId: el?.imsId || el?.invId || null, onPick: onPick || null });
    try {
      const { inventory, blocksForDate } = await loadAvailability(date);
      const target = String(subcat).toLowerCase().trim();
      const items = (inventory || [])
        .filter(it => String(it.subCat || it.subcategory || "").toLowerCase().trim() === target)
        .map(it => ({ id: it.id, name: it.name, photo: (Array.isArray(it.photoUrls) && it.photoUrls[0]) || it.img || "", free: getStudioAvailable(it, blocksForDate), price: priceForInvItem(it, rcFactorByKey, inventory), dims: itemDimsText(it) }))
        .sort((a, b) => b.free - a.free);
      setAvailModal(m => (m && m.zoneKey === zoneKey && m.idx === idx) ? { ...m, loading: false, items } : m);
    } catch { setAvailModal(m => m ? { ...m, loading: false } : m); }
  };
  const saveAvailPick = () => {
    if (!availModal) return;
    const { zoneKey, idx, selectedId, items, onPick } = availModal;
    const pick = (items || []).find(i => i.id === selectedId);
    if (onPick) { onPick(selectedId && pick ? pick : null); setAvailModal(null); return; }
    setZoneElements(p => {
      const elems = [...(p[zoneKey] || [])];
      if (!elems[idx]) return p;
      elems[idx] = (selectedId && pick)
        // Picking an item REPLACES this element with it — invId drives both the display name and
        // the price (getElPriceFromInventory), so name + rate follow the picked item. imsId keeps
        // the booking pin in sync.
        ? { ...elems[idx], invId: selectedId, name: pick.name || elems[idx].name, imsId: selectedId, imsName: pick.name || "", imsPhoto: pick.photo || "" }
        // Deselecting clears only the booking pin — the element keeps its current identity.
        : (() => { const e = { ...elems[idx] }; delete e.imsId; delete e.imsName; delete e.imsPhoto; return e; })();
      return { ...p, [zoneKey]: elems };
    });
    setAvailModal(null);
  };

  // The currently-selected photo per zone can be restored from a saved session and its id may not
  // be in the lazy library cache yet (used below for the "correct & save to master" lookup) —
  // prefetch on the off chance it's missing, so `libItems.find` doesn't silently come up empty.
  useEffect(() => {
    const ids = Object.values(elSelectedPhoto || {}).map(p => p?.eventId).filter(Boolean);
    if (ids.length) ensureLibItems?.(ids);
  }, [elSelectedPhoto, ensureLibItems]);

  // getLibPhotosForZone is async (server-queried zone match) now. Bridge it back to the synchronous
  // shape getMatchedPhotos renders inline: cache results per zone-area-set (bumped whenever the
  // active photo filters change), fetch on first read, return empty until it resolves. Zone key is
  // tier-agnostic (tier filtering happens after, below). Returns every photo tagged for the zone,
  // unranked — no source-video/palette scoring — so the strip shows the zone's full set.
  const [zoneMatchCache, setZoneMatchCache] = useState({});
  const zoneFetchInFlight = useRef(new Set());
  const [matchGen, setMatchGen] = useState(0);
  useEffect(() => { setMatchGen(g => g + 1); }, [zpHasFilters, JSON.stringify(zpFilters)]);
  // Which library "areas / zones" tags feed this zone. Static map first; custom or renamed zones
  // have no entry, so fall back to their display label — reverse-looked-up into the area-set that
  // contains it, else used as an area name of its own. One definition, three callers: the strip, the
  // prefetch effect, and the tag-correction save below.
  // A photo belongs to the zone it was tagged for — nowhere else. Two rules get it there:
  //
  // 1. A zone created from an area name (no ZONE_TYPE_TO_AREA entry — which is most of them) owns
  //    exactly its own name. This used to reverse-look-up the label into the synonym GROUP holding
  //    it, and ZONE_TYPE_TO_AREA.lounge is ["Lounge","Centre Lounge","Side Lounge","Open Lounges"],
  //    so all three lounge zones claimed all four names and a photo tagged only "Side Lounge"
  //    surfaced in every one of them.
  //
  // 2. A seed zone keeps its aliases, EXCEPT any that is another zone's own name. ZONE_TYPE_TO_AREA
  //    predates those zones existing separately: stage lists "Entertainment Stage", ceiling lists
  //    "Installations", tableDecor lists "Centre Pieces" — all now zones in their own right, so the
  //    parent was swallowing their photos. Aliases nobody else claims stay ("Entry Passage" /
  //    "Entry & Passage" are two spellings of one zone, not two zones).
  const areaNamesFor = (elKey) => {
    const label = (zoneLabelsD[elKey]?.label) || elKey || "";
    const raw = ZONE_TYPE_TO_AREA[elKey];
    const names = Array.isArray(raw) ? [...raw] : (raw ? [raw] : []);
    if (!names.length) return label ? [label] : [];
    const otherZoneLabels = new Set(
      Object.entries(zoneLabelsD).filter(([k]) => k !== elKey).map(([, v]) => v?.label).filter(Boolean)
    );
    const kept = names.filter((n) => n === label || !otherZoneLabels.has(n));
    return kept.length ? kept : names;   // never strip a zone down to nothing
  };
  const ensureZoneMatches = (areaNames) => {
    if (!areaNames.length) return;
    const cacheKey = `${matchGen}::${areaNames.join("|")}`;
    if (zoneFetchInFlight.current.has(cacheKey) || zoneMatchCache[cacheKey]) return;
    zoneFetchInFlight.current.add(cacheKey);
    getLibPhotosForZone(areaNames, zpHasFilters ? zpFilterPhoto : null)
      .then((result) => setZoneMatchCache((prev) => ({ ...prev, [cacheKey]: result })))
      .finally(() => zoneFetchInFlight.current.delete(cacheKey));
  };
  // Kick off the fetch for every currently-rendered zone (cheap no-op for already-cached/in-flight keys).
  useEffect(() => {
    const keys = [...zoneKeys, ...customZones.filter(cz => cz.sourceType).map(cz => cz.id)];
    keys.forEach((k) => {
      const czSrc = customZones.find(cz => cz.id === k);
      const srcType = czSrc?.sourceType || k;
      ensureZoneMatches(areaNamesFor(srcType));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKeys, customZones, matchGen]);

  const getMatchedPhotos = (elKey) => {
    const areaNames = areaNamesFor(elKey);
    const photos = [];
    const seen = new Set();

    // LIBRARY PHOTOS — every photo tagged for this zone, unranked. No source-video default, no
    // relevance scoring, no Silver/Gold split — the salesperson always picks manually from the
    // zone's full tagged set regardless of a photo's categoryTier tag.
    //
    // No cap. This used to stop at 50, which silently hid the rest of a zone's tagged photos: the
    // pager read "1–4 of 50" no matter how many the zone actually had. The strip is paginated four
    // at a time and only the visible page renders <img>, so the cost of a longer list is the array
    // itself, not the images. The DB query behind it already bounds the pool at 1000.
    if (areaNames.length) {
      // Async zone match (getLibPhotosForZone) — read from the cache populated by the effect above
      // (empty array until it resolves, same render cost as before once warm).
      const allMatches = zoneMatchCache[`${matchGen}::${areaNames.join("|")}`] || [];
      for (const img of allMatches) {
        if (!img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        photos.push({
          src: img.url, eventId: img.id, eventName: img.name || "Library",
          fn: "", space: "", mood: "", venue: "", video: "",
          tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
          isLibrary: true, elements: img.elements || [], dims: img.dims || {},
        });
      }
    }

    // 2. EVENT PHOTOS — only for zones with NO area mapping (untagged custom zones).
    // For mapped zones we deliberately stop at zone-tagged library photos above; event
    // photos aren't tagged per-zone, so padding with them re-introduces wrong-zone images.
    // Uncapped for the same reason as the library branch above — an unmapped custom zone should
    // show every event photo it has, not the first 50.
    if (!areaNames.length) {
      const catEvents = events.filter(ev => (ev.enabledEls || []).includes(elKey) || (ev.elements && ev.elements[elKey]));
      const sorted = catEvents.map(ev => {
        let relevance = 0;
        if (fn && ev.fn === fn) relevance += 4;
        if (venue && ev.venue === venue) relevance += 1;
        return { ev, relevance };
      }).sort((a, b) => b.relevance - a.relevance);
      for (const { ev } of sorted) {
        for (const p of (ev.photos || [])) {
          if (!seen.has(p)) {
            seen.add(p);
            photos.push({
              src: p, eventId: ev.id, eventName: ev.name,
              category: getCat(getFullCost(ev)).label,
              fn: ev.fn, space: ev.space, mood: ev.mood, venue: ev.venue, video: ev.video,
              tags: ev.tags || [],
              zones: ev.templateId?((findTemplate(ev.templateId,templates)||{}).zones||[]):(ev.zones||[]),
              itemGrades: ev.itemGrades || {}, itemQtys: ev.itemQtys || {}, enabledEls: ev.enabledEls || [],
            });
          }
        }
      }
    }

    // 3. NEVER EMPTY — only for unmapped zones. A mapped zone with no tagged photos shows
    // its empty state (prompting the team to tag/upload) rather than random library photos.
    // NOTE: `libItems` is a lazy cache (not the whole library) now, so this rare last-resort
    // filler draws from whatever's already been loaded this session rather than a true random
    // sample of the whole table — acceptable for an edge case (an unmapped custom zone with zero
    // zone-tagged matches at all).
    if (!areaNames.length && photos.length === 0) {
      for (const img of libItems.slice(0, 50)) {
        if (!img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        photos.push({
          src: img.url, eventId: img.id, eventName: img.name || "Library",
          fn: "", space: "", mood: "", venue: "", video: "",
          tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
          isLibrary: true, elements: img.elements || [], dims: img.dims || {},
        });
      }
    }

    return photos;
  };


  // ═══ PHOTO FILTER PANEL ═══ Built here so the render below stays a readable two-column
  // skeleton. Every group, option source and handler is unchanged from the inline version.
  const ZP_PANEL = (()=>{
      // ═══ PHOTO FILTERS ═══ Same six groups, same option sources, same handlers — but as
      // collapsible rows instead of a 2-column dump. The old grid was ~400px tall, left a dead
      // gap under "Design style" because Color palette is far taller, and pushed the build itself
      // below the fold. Closed rows still name what's selected, so nothing is hidden.
      // Venue leads — it is the first thing narrowed when hunting for a reference, and it matches
      // the Browse sidebar, which already opens with Venue. `last` is derived from the index below,
      // so the section divider follows the order rather than being pinned to a particular group.
      const groups = [
        { key:"venue",        cols:2, label:`Venue${zpWantIndoor&&!zpWantOutdoor?" — Indoor":zpWantOutdoor&&!zpWantIndoor?" — Outdoor":""}`, opts: zpVenueChoices, empty:"No venues configured yet" },
        { key:"eventType",    label:"Event type",    opts: taxOr(taxonomy.eventType, FUNCTIONS) },
        { key:"venueType",    label:"Venue type",    opts: taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]) },
        { key:"designStyle",  label:"Design style",  opts: taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]) },
        { key:"colorPalette", label:"Color palette", cols:1, opts: paletteNames(imsPaletteCatalogue, taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]) },
        { key:"timeSetting",  label:"Day / Night",   opts: taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"]) },
      ];
      const total = Object.values(zpFilters).flat().length;
      const clearAll = () => setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[]});
      return <FPanel title="Photo filters" total={total} onClear={clearAll} note="Applies to every zone"
        scroll="calc(100vh - 86px)"
        action={<span className="rail-btn" onClick={()=>setRailsOpen(false)} title="Fold both side panels away and widen the build"
          style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:9.5,fontWeight:700,letterSpacing:0.4,
            textTransform:"uppercase",color:textS,padding:"3px 7px",borderRadius:7,border:`1px solid ${border}`,whiteSpace:"nowrap"}}>
          <span style={{display:"inline-flex",transform:"rotate(90deg)"}}><IconChevron size={10}/></span>Hide
        </span>}>
        {groups.map((g,gi)=>{
          const sel=zpFilters[g.key]||[];
          // Groups with long values (palette, venue names) get fewer columns and left-aligned rows.
          const align = g.cols === 1 ? "start" : undefined;
          // Palette and Venue are the two long, hunt-through lists, so both get a search box. The
          // rest are 3–8 short values where one is just another thing in the way.
          // venueType sorts and renders by its display label, so "Both" reads "Indoor + Outdoor"
          // and sits between Indoor and Outdoor rather than ahead of them.
          const optLabel = g.key === "venueType" ? venueTypeLabel : (v) => v;
          const all = [...(g.opts || [])].sort((a, b) => String(optLabel(a)).localeCompare(String(optLabel(b))));
          const isPalette = g.key === "colorPalette";
          const isVenue = g.key === "venue";
          const searchable = isPalette || isVenue;
          const q = isVenue ? zpVenueQ : zpPaletteQ;
          const setQ = isVenue ? setZpVenueQ : setZpPaletteQ;
          const anchorsOf = (name) => (imsPaletteCatalogue||[]).find(p=>p.name===name)?.anchorColours;
          // paletteSearch is a generic token matcher with ranking (exact → prefix → word → rest);
          // only the anchor-colour lookup is palette-specific, so Venue reuses it without one.
          const matched = searchable ? paletteSearch(all, q, isPalette ? anchorsOf : undefined) : all;
          // Cap only while browsing — a search or an explicit "See all" shows every hit.
          const capped = isVenue && !zpVenueAll && !q.trim() && matched.length > ZP_VENUE_CAP;
          const shown = capped ? matched.slice(0, ZP_VENUE_CAP) : matched;
          // Never let the search OR the cap hide something that is actively filtering the photos.
          const selectedHidden = sel.filter(v => all.includes(v) && !shown.includes(v));
          const optPill = (v) => <FPill key={v} on={sel.includes(v)} align={align} onClick={()=>zpToggleFilter(g.key,v)}>{optLabel(v)}</FPill>;
          return <FSection key={g.key} id={g.key} label={g.label} count={sel.length} last={gi===groups.length-1}
            cols={g.cols || 3} open={!!zpOpen[g.key]} onToggle={()=>zpToggleOpen(g.key)}>
            {searchable&&<div style={{gridColumn:"1/-1"}}>
              <FSearchBox value={q} onChange={setQ} placeholder={isVenue?"Search venues…":"Search palettes…"}
                noun={isVenue?"venues":"palettes"} resultCount={matched.length} totalCount={all.length}/>
            </div>}
            <FPill on={sel.length===0} align={align} onClick={()=>setZpFilters(p=>({...p,[g.key]:[]}))}>All</FPill>
            {/* Colour-only hits are separated out — see the same split in Browse. Palette only:
                venues have no anchor colours, so every hit is a name match. */}
            {(isPalette?shown.filter(v=>paletteMatches(v,q)):shown).map(optPill)}
            {(()=>{if(!isPalette)return null;const byColour=shown.filter(v=>!paletteMatches(v,q));return byColour.length===0?null:<>
              <div style={{gridColumn:"1/-1",fontSize:9,color:zpTextM,marginTop:2}}>Contains this colour</div>
              {byColour.map(optPill)}
            </>;})()}
            {selectedHidden.length>0&&<div style={{gridColumn:"1/-1",fontSize:9,color:zpTextM,marginTop:2}}>{q.trim()?"Selected, outside this search":"Selected"}</div>}
            {selectedHidden.map(optPill)}
            {/* See all / Show fewer. Hidden while searching — the search already decides what shows. */}
            {isVenue&&!q.trim()&&(capped||zpVenueAll)&&matched.length>ZP_VENUE_CAP&&
              <div onClick={()=>setZpVenueAll(v=>!v)} role="button"
                style={{...fGhostPill,gridColumn:"1/-1",textAlign:"center"}}>
                {capped?`See all ${matched.length} venues`:"Show fewer"}
              </div>}
            {g.empty&&g.opts.length===0&&<span style={{gridColumn:"1/-1",fontSize:10,color:zpTextM}}>{g.empty}</span>}
          </FSection>;
        })}
      </FPanel>;
    })();

  // ═══ LIVE PRICING TILE ═══ Sticky right column. Every figure is read from the same source
  // the rest of the page uses — grandTotal / totalCost() / transportCalc / cat / zoneTotal —
  // so it is a view, never a second calculation. Hidden entirely when costs are hidden.
  const PRICING_TILE = showCosts && (()=>{
    const rule = isDark ? "rgba(255,255,255,0.07)" : "rgba(26,26,46,0.07)";
    const rows = [...zoneKeys, ...customZones.map(cz=>cz.id)]
      .filter(k=>enabledEls[k])
      .map(k=>{
        const cz = customZones.find(c=>c.id===k);
        return { k, label: (cz ? cz.name : (zoneLabelsD[k]||{}).label) || k, amt: zoneTotal(k) };
      })
      .sort((a,b)=>b.amt-a.amt);
    const zonesSum = rows.reduce((a,r)=>a+r.amt,0);
    const line = (label, value, opts={}) => (
      <div style={{display:"flex",alignItems:"baseline",gap:8,padding:"5px 0",fontSize:11.5,color:opts.strong?textP:textS}}>
        <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:opts.strong?600:400}}>{label}</span>
        <span style={{fontWeight:opts.strong?700:600,color:textP,fontVariantNumeric:"tabular-nums"}}>{value}</span>
      </div>
    );
    return (
      <div className="pt-card" style={{...S.card,padding:0,overflow:"hidden",boxShadow:isDark?"0 1px 2px rgba(0,0,0,0.45), 0 10px 26px -12px rgba(0,0,0,0.6)":"0 1px 2px rgba(26,26,46,0.06), 0 10px 26px -12px rgba(26,26,46,0.2)"}}>
        {/* Gilt rule, matching the Event Info sheet */}
        <div style={{height:3,background:`linear-gradient(90deg,${accent},${accent}66 42%,transparent)`}}/>
        <div style={{padding:"13px 15px",borderBottom:`1px solid ${rule}`}}>
          <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:textS}}>Live estimate</div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:5,flexWrap:"wrap"}}>
            <div style={{fontSize:23,fontWeight:700,color:textP,letterSpacing:-0.6,fontVariantNumeric:"tabular-nums"}}>{fmt(grandTotal)}</div>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:6,background:cat.bg,color:cat.color}}>{cat.label}</span>
          </div>
        </div>
        <div style={{padding:"9px 15px",borderBottom:`1px solid ${rule}`}}>
          {line("Décor", fmt(totalCost()))}
          {line("Transport", fmt(transportCalc.total))}
        </div>
        <div style={{padding:"11px 15px"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
            <span style={{fontSize:9.5,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:textS}}>By zone</span>
            {rows.length>0&&<span style={{marginLeft:"auto",fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:5,background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:zpGold,border:`1px solid ${accent}44`}}>{rows.length}</span>}
          </div>
          {rows.length===0
            ? <div style={{fontSize:11,color:textS,lineHeight:1.5,padding:"3px 0"}}>No zones switched on yet — turn one on below and its cost appears here.</div>
            : rows.map(r=>(
              <div key={r.k} className="pt-row" style={{display:"flex",alignItems:"baseline",gap:8,padding:"4px 6px",margin:"0 -6px",borderRadius:6,fontSize:11.5}}>
                <span style={{width:3,height:3,borderRadius:"50%",background:accent,flexShrink:0,marginBottom:2}}/>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:textS}}>{r.label}</span>
                <span style={{fontWeight:600,color:textP,fontVariantNumeric:"tabular-nums"}}>{fmt(r.amt)}</span>
              </div>
            ))}
          {/* Zones only ever sum to the décor side; transport is added on top, so a mismatch
              here is expected and shown rather than hidden. */}
          {rows.length>0&&<div style={{marginTop:7,paddingTop:7,borderTop:`1px solid ${rule}`}}>{line("Zones subtotal", fmt(zonesSum), {strong:true})}</div>}
        </div>
      </div>
    );
  })();
  // Wider than S.main's 1200px cap, which left ~350px of dead gutter either side on a desktop
  // monitor and pushed the filter rail far off the left edge. Matches the Browse page.
  return (
  <div style={{...S.main,maxWidth:1800}}>
    <style>{filterCSS + `
/* Element rows are very wide, so name-left / controls-right leaves a long void.
   A hover track lets the eye follow one row across it. */
/* ═══ RAIL TABS ═══ A folded rail, and the control that folds them. */
.rail-tab{transition:border-color .18s ease, background-color .18s ease, box-shadow .2s ease}
.rail-tab:hover{border-color:${accent} !important;background:${isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.06)"} !important;
  box-shadow:${isDark?"0 8px 18px -12px rgba(0,0,0,0.7)":"0 8px 18px -12px rgba(26,26,46,0.22)"}}
.rail-btn{transition:border-color .16s ease, color .16s ease, background-color .16s ease}
.rail-btn:hover{border-color:${accent} !important;color:${accent} !important;
  background:${isDark?"rgba(201,169,110,0.1)":"rgba(201,169,110,0.08)"} !important}
@media (prefers-reduced-motion: reduce){.rail-tab,.rail-btn{transition:none}}
/* ═══ SECTION TILES ═══ The four entry points into a zone body, all in one row. They share the
   build column with two 258px rails, so they fall back to 2×2 and then to a single column rather
   than squashing "Truss & Masking" into an ellipsis. */
.sec-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}
@media (max-width:1200px){.sec-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:700px){.sec-grid{grid-template-columns:minmax(0,1fr)}}
.sec-tile{transition:transform .14s ease, box-shadow .2s ease, border-color .18s ease}
.sec-tile:hover{transform:translateY(-2px);border-color:${accent} !important;
  box-shadow:${isDark?"0 10px 22px -12px rgba(0,0,0,0.7)":"0 10px 22px -12px rgba(26,26,46,0.22)"}}
.sec-tile[data-on="1"]{box-shadow:${isDark?"0 8px 18px -12px rgba(0,0,0,0.7)":"0 8px 18px -12px rgba(26,26,46,0.2)"}}
@media (prefers-reduced-motion: reduce){.sec-tile{transition:none}.sec-tile:hover{transform:none}}
/* ═══ ELEMENT CARD GRID ═══
   4 across with the side rails open, 6 with them folded. The count is set rather than derived from
   a minimum width, because auto-fill gave only 3 whenever the column sat just under the threshold for
   a 4th track. Cards fill their track exactly - no width cap - so a fixed count leaks no slack.
   align-items:stretch — every card in a row is the same height. This was start for a while,
   because a tall kit stretched the short card beside it into a mostly-empty box; grouping kits
   into their own rows removed that, so a row now only ever holds one kind of card.
   Every card takes one track. Cards are GROUPED — plain first, kits after — and the first kit is
   pinned to column 1 so the kits begin a fresh row: grouping alone still let one kit share the last
   plain row and set its height. Kits then stretch to their row height so they match each other, while
   plain cards keep their natural height (uniform already, via minHeight). */
.el-grid{display:grid;grid-template-columns:repeat(var(--el-cols,4),minmax(0,1fr));gap:16px;align-items:stretch}
/* The count comes from the rails; these only stop the cards getting too narrow to hold the
   S/M/B + Ratio row on smaller screens. */
@media (max-width:1200px){.el-grid{--el-cols:3 !important}}
@media (max-width:900px){.el-grid{--el-cols:2 !important}}
@media (max-width:620px){.el-grid{--el-cols:1 !important}}
/* ═══ ELEMENT CARD HOVER ═══
   Resting cards are flat outlines so the grid reads as one calm surface. Hover lifts exactly one
   card out of it: a two-layer shadow (a tight contact edge that keeps it attached to the page, plus
   a broad soft cast that does the lifting), the surface warmed a few percent toward the gold accent,
   and a gold spine that grows down the left edge. The spine is a ::before rather than a border so it
   can animate its own height without the 1px border reflowing the card's contents.
   background/border are inline styles on the card, hence !important on both. */
.el-row{position:relative;
  transition:transform .24s cubic-bezier(.22,.61,.36,1), box-shadow .28s ease, border-color .24s ease, background-color .24s ease}
.el-row::before{content:"";position:absolute;left:0;top:11px;bottom:11px;width:2px;border-radius:0 2px 2px 0;
  background:${accent};opacity:0;transform:scaleY(.35);transform-origin:center;pointer-events:none;
  transition:opacity .24s ease, transform .3s cubic-bezier(.22,.61,.36,1)}
.el-row:hover{transform:translateY(-3px);
  border-color:${isDark?"rgba(201,169,110,0.55)":"rgba(201,169,110,0.6)"} !important;
  background:${isDark?"rgba(201,169,110,0.05)":"rgba(201,169,110,0.045)"} !important;
  box-shadow:${isDark
    ? "0 1px 2px rgba(0,0,0,0.5), 0 16px 32px -14px rgba(0,0,0,0.75)"
    : "0 1px 2px rgba(26,26,46,0.06), 0 16px 32px -14px rgba(26,26,46,0.28)"}}
.el-row:hover::before{opacity:1;transform:scaleY(1)}
/* pressing a card settles it back onto the page rather than leaving it floating */
.el-row:active{transform:translateY(-1px);
  box-shadow:${isDark?"0 1px 2px rgba(0,0,0,0.5), 0 8px 18px -12px rgba(0,0,0,0.7)":"0 1px 2px rgba(26,26,46,0.06), 0 8px 18px -12px rgba(26,26,46,0.22)"}}
/* Zone rows are full-width with controls at the far right — a hover track ties the two ends. */
.zone-row{transition:border-color .15s ease, box-shadow .18s ease}
.zone-row:hover{border-color:${isDark?"rgba(201,169,110,0.45)":"rgba(201,169,110,0.5)"} !important;
  box-shadow:${isDark?"0 6px 18px -10px rgba(0,0,0,0.6)":"0 6px 18px -10px rgba(26,26,46,0.22)"}}
@media (prefers-reduced-motion: reduce){.zone-row{transition:none}}
/* ═══ ZONE INTERIOR HOVER ═══
   Element selectors, not classes: these controls are built inline all over the zone body, so
   scoping by tag under .zone-row reaches all of them at once. */
.zone-row button,.zone-row select,.zone-row input,.zone-row span[title],.zone-row img{
  transition:filter .15s ease, border-color .15s ease, box-shadow .16s ease, transform .13s ease}
/* every button lifts and darkens slightly, whatever its own background is */
.zone-row button:not(:disabled):hover{box-shadow:0 0 0 2px ${accent}66, 0 5px 12px -5px rgba(26,26,46,0.32) !important;transform:translateY(-1px);filter:brightness(1.03)}
.zone-row button:not(:disabled):active{transform:translateY(0) scale(0.98)}
.zone-row button:disabled{opacity:.55;cursor:not-allowed}
/* fields warm their border so it is obvious which one is under the cursor */
.zone-row select:hover,.zone-row input:hover:not(:disabled){border-color:${accent}88 !important}
.zone-row select:focus-visible,.zone-row input:focus-visible{outline:2px solid ${accent};outline-offset:1px}
/* the icon actions are <span title=…> with inline tints — an outline reads on any of them */
.zone-row span[title]:hover{box-shadow:0 0 0 2px ${accent}66 !important;border-radius:7px;filter:brightness(1.03)}
/* photo tiles */
.zone-row img:hover{filter:brightness(1.06)}
/* ═══ PHOTO TILES ═══ The whole tile responds: it lifts, the border warms, and the photo
   pushes in. The tile already clips overflow, so the zoom stays inside its rounded corners.
   A selected tile keeps its green border and check — only the elevation changes on hover. */
.ph-tile{transition:transform .18s ease, box-shadow .2s ease, border-color .2s ease}
.ph-tile:hover{transform:translateY(-3px);border-color:${accent} !important;
  box-shadow:${isDark?"0 16px 30px -12px rgba(0,0,0,0.75)":"0 16px 30px -12px rgba(26,26,46,0.32)"} !important}
/* The badge is a real control now: the photo itself selects, this opens the full preview. */
.ph-tile img{transition:transform .35s ease}
.ph-tile:hover img{transform:scale(1.06)}
/* the generic ring would double up on a tile that now has its own hover */
.ph-tile:hover{outline:none}
@media (prefers-reduced-motion: reduce){
  .ph-tile,.ph-tile img{transition:none}
  .ph-tile:hover,.ph-tile:hover img{transform:none}
}
/* ═══ "TAP TO SELECT" ═══ The caption is a separate click target from the image above it (select
   vs. preview), so it gets its own hover. [data-sel="0"] keeps it off already-selected tiles,
   whose green fill should not be replaced by a gold one. */
/* The caption is the click target — the image above it opens the preview instead — so it gets the
   hover. [data-sel="0"] keeps it off an already-selected card, whose green fill should not be
   replaced by a gold one. !important because the resting background is an inline style. */
.ph-sel{transition:background .15s ease}
.ph-sel[data-sel="0"]:hover{background:${isDark?"rgba(201,169,110,0.1)":"rgba(201,169,110,0.09)"} !important}
   so that paging twice the same way restarts the animation; a React key would remount the images. */
@keyframes phInL1{from{opacity:0;transform:translate3d(26px,0,0)}to{opacity:1;transform:none}}
@keyframes phInL2{from{opacity:0;transform:translate3d(26px,0,0)}to{opacity:1;transform:none}}
@keyframes phInR1{from{opacity:0;transform:translate3d(-26px,0,0)}to{opacity:1;transform:none}}
@keyframes phInR2{from{opacity:0;transform:translate3d(-26px,0,0)}to{opacity:1;transform:none}}
/* Pages 2+ are fetched on first visit, so an image can pop in mid-slide. Fade it instead. */
@keyframes phImgIn{from{opacity:0}to{opacity:1}}
.ph-img{animation:phImgIn .34s ease}
/* Pager buttons — the only controls on the page that had no feedback at all. */
.ph-pg{transition:background .16s ease, border-color .16s ease, color .16s ease, transform .12s ease}
.ph-pg:hover:not(:disabled){border-color:${accent} !important;color:${accent} !important;transform:translateY(-1px)}
.ph-pg:active:not(:disabled){transform:translateY(0) scale(0.94)}
.ph-pg:focus-visible{outline:2px solid ${accent};outline-offset:2px}
@media (prefers-reduced-motion: reduce){
  /* !important because the slide is set as an inline style, which a plain rule cannot override */
  .ph-grid{animation:none !important}
  .ph-img{animation:none}
  .ph-pg{transition:none}
  .ph-pg:hover:not(:disabled),.ph-pg:active:not(:disabled){transform:none}
  .ph-sel{transition:none}
}
/* the transition companion for the clickable-div ring (lost in an earlier bad edit) */
.zone-row div[style*="cursor:pointer"]{transition:box-shadow .15s ease}
/* ═══ LIVE ESTIMATE TILE ═══ Resting elevation + hover, matching the filter panel. */
.pt-card{transition:box-shadow .24s ease}
.pt-card:hover{box-shadow:${isDark?"0 2px 4px rgba(0,0,0,0.5), 0 18px 36px -14px rgba(0,0,0,0.7)":"0 2px 4px rgba(26,26,46,0.08), 0 18px 36px -14px rgba(26,26,46,0.28)"} !important}
/* per-zone rows get a track so a figure stays tied to its zone name */
.pt-row{transition:background .13s ease}
.pt-row:hover{background:${isDark?"rgba(201,169,110,0.10)":"rgba(201,169,110,0.12)"}}
@media (prefers-reduced-motion: reduce){.pt-card,.pt-row{transition:none}}
/* clickable inline-styled divs (wall chips, pickers) — same ring so nothing is left dead */
.zone-row div[style*="cursor:pointer"]:not([style*="padding:14px"]):hover{box-shadow:0 0 0 2px ${accent}55 !important;border-radius:7px}
undefined
@media (prefers-reduced-motion: reduce){
  .zone-row button,.zone-row select,.zone-row input,.zone-row span[title],.zone-row img{transition:none}
  .zone-row button:not(:disabled):hover,.zone-row button:not(:disabled):active{transform:none}
}
@media (prefers-reduced-motion: reduce){
  .el-row,.el-row::before{transition:none}
  .el-row:hover,.el-row:active{transform:none}
  /* the spine still appears, it just does not grow into place */
  .el-row:hover::before{transform:scaleY(1)}
}
` + `@media (prefers-reduced-motion: reduce){.sb-pill,.sb-head{transition:none}.sb-pill:hover{transform:none}}`}</style>
    {customPicker && (
      <InventoryItemPickerModal
        title={customPicker.kind === "ceiling" ? "Custom Ceiling — Fabric › Ceiling" : "Custom Masking — Fabric › Printed Walls"}
        icon={customPicker.kind === "ceiling" ? <IconPlay size={14}/> : <IconCamera size={14}/>}
        accent="#7C3AED"
        imsInventory={imsInventory}
        categoryMatch="fabric"
        subcatMatch={customPicker.kind === "ceiling" ? "ceiling" : "printed wall"}
        rcFactorByKey={rcFactorByKey}
        onSelect={(item) => { patchTrussRow(customPicker.k, customPicker.rowIdx, { [customPicker.kind === "ceiling" ? "customCeilingItemId" : "customMaskingItemId"]: item.id }); setCustomPicker(null); }}
        onClose={() => setCustomPicker(null)}
        isDark={isDark} border={border} textP={textP} textS={textS} cardBg={cardBg}
      />
    )}
    {/* Step header, left-aligned on the same axis as the content below. The row this replaced was
        a flex pair holding the title and a "Filter whole build" toggle; with the toggle gone it
        only ever had one child, so it is a plain block. */}
    <div style={{marginBottom:6}}>
      <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1.6,textTransform:"uppercase",color:accent,marginBottom:4}}>Step 3 of 4 · Décor Build</div>
      {/* Greets the client by name. Falls back to the old title when there is no name yet — a page
          heading reading "Welcome," with nothing after it would look broken. */}
      <div style={{fontSize:26,fontWeight:700,letterSpacing:-0.5,lineHeight:1.1}}>
        {clientName ? <>Welcome, {clientName}</> : "Build Your Decor"}
      </div>
    </div>
    {/* The date lives on this line, under the title. The day-note banner below is conditional, so
        this margin can no longer shrink assuming something always follows it. */}
    <div style={{fontSize:14,color:textS,marginBottom:24,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      {/* The name moved into the heading above, so it is not repeated here. */}
      <span>{activeFnMeta.venue || venue} · {activeFnMeta.type || fn}</span>
      {clientDate&&<span style={{opacity:0.45}}>·</span>}
      {clientDate&&<span style={{color:textP,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5}}>
        <IconCalendar size={13}/>
        {new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
      </span>}
      {dateDemand?.isHigh&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(239,68,68,0.1)",color:"#DC2626",fontWeight:600,display:"inline-flex",alignItems:"center"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:"#EF4444",marginRight:6}}/>High demand</span>}
      {dateDemand?.isMod&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(245,158,11,0.1)",color:"#B45309",fontWeight:600,display:"inline-flex",alignItems:"center"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:"#F59E0B",marginRight:6}}/>Moderate</span>}
      {extraFunctions.length > 0 && <span style={{padding:"2px 10px",borderRadius:8,fontSize:10,fontWeight:600,background:`${accent}20`,color:accent,letterSpacing:0.3}}>Function {activeFnIdx + 1} of {extraFunctions.length + 1}</span>}
    </div>
    {/* ═══ TWO-COLUMN SHELL ═══ Photo filters live permanently in a sticky left rail, exactly
        as on Browse — always visible, no toggle. ═══ */}
    <div style={{display:"flex",gap:railsOpen?22:12,alignItems:"flex-start"}}>
      {railsOpen
        ? <div style={{width:RAIL_W,flexShrink:0,position:"sticky",top:70,alignSelf:"flex-start"}}>{ZP_PANEL}</div>
        : railTab("left","Photo filters",<IconSliders size={14}/>)}
      <div style={{flex:1,minWidth:0}}>

    {/* Event Palette strip removed on request. The palette still comes from the selected
        video's tag via clientPalette / extraFunctions[].palette — there is simply no override
        control on Build any more. */}

    {/* ═══ DATE DEMAND BANNER ═══ */}
    {clientDate&&dateDemand&&(()=>{
      const { dt, booked, ongoing, isHigh } = dateDemand;   // one source, shared with the chip above
      const dtInfo=dt==='saya'?{bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.2)",label:"Saya Day"}:dt==='competition'?{bg:"rgba(100,100,100,0.08)",border:"rgba(100,100,100,0.2)",label:"Competition Day"}:null;
      if (!dtInfo && !booked && !ongoing) return null;   // nothing to report once the date moved up
      return <div style={{padding:"8px 14px",borderRadius:10,marginBottom:16,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",fontSize:12,background:isHigh?"rgba(239,68,68,0.08)":(dtInfo?dtInfo.bg:(isDark?"rgba(201,169,110,0.05)":"#FFFDF7")),border:`1px solid ${isHigh?"rgba(239,68,68,0.2)":(dtInfo?dtInfo.border:border)}`}}>
        {dtInfo&&<span style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:600,background:dtInfo.bg,color:dt==="saya"?"#EF4444":"#888"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:dt==="saya"?"#EF4444":"#666",marginRight:6,verticalAlign:"middle"}}/>{dtInfo.label}</span>}
        {booked>0&&<span style={{color:"#047857",fontWeight:600}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:"#10B981",marginRight:6,verticalAlign:"middle"}}/>{booked} booked</span>}
        {ongoing>0&&<span style={{color:"#B45309"}}><span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:"#F59E0B",marginRight:6,verticalAlign:"middle"}}/>{ongoing} ongoing</span>}
      </div>;
    })()}

    {/* ═══ SOURCE EVENT BANNER ═══ */}
    {sourceEvent&&<div style={{...S.card,marginBottom:14,overflow:"hidden"}}>
      <div style={{display:"flex",gap:0}}>
        <div style={{width:168,minHeight:108,flexShrink:0,position:"relative",background:sourceEvent.gradient,overflow:"hidden"}}>
          <LazyYT src={sourceEvent.video} gradient={sourceEvent.gradient} poster={sourceEvent.img||sourceEvent.photos?.[0]} style={{position:"absolute",inset:0}}/>
        </div>
        <div style={{flex:1,padding:"10px 14px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
            <div>
              <div style={{fontSize:9,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:3}}>Building from reference</div>
              <div style={{fontSize:14.5,fontWeight:700}}>{sourceEvent.name}</div>
              <div style={{fontSize:11,color:textS,marginTop:2}}>{sourceEvent.venue} · {sourceEvent.fn} · {sourceEvent.space}</div>
            </div>
            {showCosts&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:16,fontWeight:700,color:textP}}>{fmt(grandTotal)}</div>
              <div style={{fontSize:9,color:textS}}>{fmt(totalCost())} decor + {fmt(transportCalc.total)} transport</div>
              <span style={{fontSize:9.5,padding:"2px 8px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
            </div>}
          </div>
          <div style={{fontSize:11,color:textS,lineHeight:1.45,marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{sourceEvent.desc}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(sourceEvent.tags||[]).map((t,i)=><span key={i} style={{fontSize:9.5,padding:"2px 7px",borderRadius:8,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS,fontWeight:500}}>{t}</span>)}
          </div>
          {sourceEvent.photos?.length>0&&<div style={{display:"flex",gap:5,marginTop:7,overflowX:"auto"}}>
            {sourceEvent.photos.map((p,i)=><img key={i} src={p} alt="" loading="lazy" style={{width:54,height:36,objectFit:"cover",borderRadius:6,flexShrink:0,cursor:"pointer",border:`2px solid ${border}`}} onClick={()=>setPreviewImg(p)} onError={e=>{e.target.style.display="none"}}/>)}
          </div>}
        </div>
      </div>
    </div>}

    {/* ═══ SOURCE VIDEO BANNER ═══ */}
    {sourceVideo&&!sourceEvent&&(()=>{
      const vTag=ytVideoTags[sourceVideo.id]||{};
      const vid=allVideos.find(v=>v.id===sourceVideo.id);
      const ytWatchUrl=sourceVideo.id?`https://www.youtube.com/watch?v=${sourceVideo.id}`:"";
      const embedUrl=sourceVideo.id?`https://www.youtube.com/embed/${sourceVideo.id}`:null;
      return <div style={{...S.card,marginBottom:20,overflow:"hidden"}}>
        <div style={{display:"flex",gap:0}}>
          {vid?.thumb&&<div style={{width:220,minHeight:120,flexShrink:0,position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>{setVideoModal({name:sourceVideo.title||vid?.title||"Video",venue:venue||"",fn:fn||"",desc:"",video:embedUrl?`https://www.youtube.com/embed/${sourceVideo.id}`:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[vid?.thumb].filter(Boolean),tags:[]});setVideoPlaying(true);}}>
            <img src={vid.thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none"}}/>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.2)"}}>
              <div style={{width:48,height:34,borderRadius:8,background:"rgba(255,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 12px rgba(255,0,0,0.4)"}}><div style={{width:0,height:0,borderLeft:"12px solid #fff",borderTop:"7px solid transparent",borderBottom:"7px solid transparent",marginLeft:2}}/></div>
            </div>
          </div>}
          <div style={{flex:1,padding:"14px 18px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:10,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:4}}>Building from video</div>
                <div style={{fontSize:17,fontWeight:700}}>{sourceVideo.title||vid?.title||"Video"}</div>
              </div>
              {showCosts&&<div style={{textAlign:"right"}}>
                <div style={{fontSize:18,fontWeight:700,color:textP}}>{fmt(grandTotal)}</div>
                <span style={{fontSize:10,padding:"3px 10px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
              </div>}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
              {vTag.tier&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(148,163,184,0.2)",color:textP,fontWeight:600}}>{vTag.tier}</span>}
              {(vTag.colors||[]).map(c=><span key={c} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(249,115,22,0.12)",color:"#F97316",fontWeight:600}}>{c}</span>)}
              {(vTag.styles||[]).map(s=><span key={s} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(0,0,0,0.05)",color:"#888",fontWeight:600}}>{s}</span>)}
              {vTag.io&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(16,185,129,0.12)",color:"#10B981",fontWeight:600}}>{vTag.io}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
              <button onClick={()=>{setVideoModal({name:sourceVideo.title||vid?.title||"Video",venue:venue||"",fn:fn||"",desc:"",video:embedUrl?`https://www.youtube.com/embed/${sourceVideo.id}`:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[vid?.thumb].filter(Boolean),tags:[]});setVideoPlaying(true);}} style={{padding:"4px 14px",borderRadius:6,border:"none",background:"rgba(255,0,0,0.9)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>{"▶"} Play Video</button>
              {ytWatchUrl&&<button onClick={()=>{try{navigator.clipboard.writeText(ytWatchUrl);showMsg("✓ YouTube link copied!","green");}catch{}}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,fontWeight:600,cursor:"pointer"}}><IconCopy size={11}/> Copy Link</button>}
            </div>
          </div>
        </div>
      </div>;
    })()}      {savedInsps.length>0&&<div style={{background:"#FFF1F2",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{display:"flex",gap:4}}>{savedInsps.slice(0,5).map((s,i)=><div key={i} style={{width:32,height:32,borderRadius:6,background:s.gradient||"#EDE9FE"}}/>)}</div><div style={{fontSize:12,fontWeight:600,color:"#BE123C"}}>{savedInsps.length} inspirations</div></div></div>}




    {/* ═══ FLORAL RATIO CONTROL — art/real split is a design control, show it even when costs are hidden ═══ */}
    {<div style={{borderRadius:10,padding:"13px 18px",marginBottom:14,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F9F9F9",display:"flex",alignItems:"center",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <span style={{display:"flex",color:accent}}><IconFlower size={16}/></span>
        <span style={{fontSize:12.5,fontWeight:600,color:textP}}>Artificial</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={floralRatio} onChange={e=>setFloralRatio(parseInt(e.target.value))} style={{flex:1,accentColor:accent,cursor:"pointer",minWidth:80}}/>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <span style={{fontSize:17,fontWeight:700,color:textP,letterSpacing:-0.3,minWidth:44,textAlign:"right"}}>{floralRatio}%</span>
        <div style={{fontSize:10.5,color:textS,lineHeight:1.3}}>art<br/>/{100-floralRatio}% real</div>
      </div>
      <div style={{display:"flex",gap:3,flexShrink:0}}>
        {[0,50,70,100].map(v=><button key={v} onClick={()=>setFloralRatio(v)} style={{padding:"5px 11px",borderRadius:8,border:"none",fontSize:11,fontWeight:floralRatio===v?700:500,cursor:"pointer",background:floralRatio===v?"rgba(0,0,0,0.08)":"transparent",color:floralRatio===v?textP:textS}}>{v}%</button>)}
      </div>
    </div>}

    {/* ═══ ELEMENT CARDS ═══ One unified photo strip per zone (no Silver/Gold split). ═══ */}
    {[...zoneKeys, ...customZones.filter(cz=>cz.sourceType).map(cz=>cz.id)].sort((a,b)=>(enabledEls[a]?0:1)-(enabledEls[b]?0:1)).map(k=>{
      const czSrc=customZones.find(cz=>cz.id===k);
      const srcType=czSrc?.sourceType||k;
      const el=czSrc?{label:czSrc.name,icon:czSrc.icon||""}:zoneLabelsD[k];
      const isCentrepieceZone=/centre\s*piece|center\s*piece|centrepiece/i.test(el?.label||k||"");
      const isOn=enabledEls[k];const isCust=customMode[k];
      let matchedPhotos = getMatchedPhotos(srcType).filter(ph => {
        if (!zpHasFilters) return true;
        if (!ph.isLibrary || !ph.eventId) return true; // don't filter out event photos
        const li = libById.get(ph.eventId);
        if (!li) return true;
        return zpFilterPhoto(li);
      });
      // Venue ranks instead of filtering — picking one floats its photos to the front of the strip
      // and keeps the rest behind them, because there is rarely enough tagged per venue to build a
      // zone from on its own. Stable partition, so relevance order survives inside each group.
      // A photo earns the verified star only if someone confirmed it AND it actually carries
      // elements. A verified-but-empty photo prices to nothing, so badging it sent salespeople to
      // tiles that look trustworthy and then apply an empty zone. Same test drives the ordering
      // below, so the badge and the sort can never disagree.
      const phVerified = (ph) => {
        const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
        return !!li?._verified && (ph.elements || []).length > 0;
      };
      // Verified first, unverified after. Stable, so relevance order survives inside each half.
      const verifiedFirst = (arr) => {
        const yes = [], no = [];
        for (const ph of arr) (phVerified(ph) ? yes : no).push(ph);
        return [...yes, ...no];
      };
      // venuePrefCount feeds the caption below the strip header. Browse labels its venue split for a
      // reason — an unlabelled list that still shows other venues reads as the filter being broken —
      // and the strip needs the same explanation.
      let venuePrefCount = 0;
      if ((zpFilters.venue || []).length) {
        const atVenue = [], elsewhere = [];
        for (const ph of matchedPhotos) {
          const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
          (zpVenueMatch(li) ? atVenue : elsewhere).push(ph);
        }
        venuePrefCount = atVenue.length;
        // Verified-first runs INSIDE each venue group, so the venue you picked still leads the strip
        // and verification only decides the order within it. Sorting across both would undo it.
        matchedPhotos = [...verifiedFirst(atVenue), ...verifiedFirst(elsewhere)];
      } else {
        matchedPhotos = verifiedFirst(matchedPhotos);
      }
      // Pin the last-selected photo to the FRONT of the strip (and force it in even if relevance/
      // filters would drop it), so re-opening a saved session shows the saved pick first — no
      // scrolling left/right to hunt for it. Its saved elements & dims live in zoneElements/
      // zoneConfig and are already restored; keeping it first also stops an accidental click on a
      // different photo from resetting those edits.
      const selP = elSelectedPhoto[k];
      if (selP?.src) {
        const existing = matchedPhotos.find(ph => ph.src === selP.src);
        matchedPhotos = [existing || selP, ...matchedPhotos.filter(ph => ph.src !== selP.src)];
      }
      const isDuplicate=!!czSrc?.sourceType;
      return(<div key={k} id={`zone-${k}`} className="zone-row" style={{background:isOn?cardBg:isDark?"#12121F":"#FAFAFA",borderRadius:14,border:isOn?`2px solid ${isDuplicate?"#C9A96E":"#444"}`:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(26,26,46,0.09)"}`,marginBottom:10,overflow:"hidden"}}>
        {/* Only the Details chip collapses an open zone. The whole header used to do it, so any
            stray click — on the name, the summary text, the empty space — folded the zone away
            mid-edit. An OFF zone still switches on from anywhere in the row, since there is nothing
            to lose there and it makes the row an easy target. */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",cursor:isOn?"default":"pointer"}} onClick={()=>{ if(!isOn) toggleEl(k); }}>
          <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>{/* zone emoji removed — the label carries the row */}<div style={{fontSize:15,fontWeight:600,letterSpacing:-0.2,color:isOn?textP:textS}}>{el.label}</div>{/* Read-only summary — fills the dead space between the name and the controls so a collapsed
                row still says what is in the zone. Derived from existing state only. */}
            {(()=>{
              const n=(zoneElements[k]||[]).length;
              if(!isOn) return <span style={{fontSize:11,color:textS,fontWeight:400}}>Not included</span>;
              const bits=[n?`${n} element${n===1?"":"s"}`:"no elements yet"];
              if(zoneConfig[k]?.trT) bits.push("truss");
              if(zoneConfig[k]?.plH) bits.push("platform");
              return <span style={{fontSize:11,color:textS,fontWeight:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{bits.join(" · ")}</span>;
            })()}
            {/* No "Duplicate" chip — the name already says "Stage (2)", so the chip only repeated it. */}
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleZoneCollapse(k);}} title={isCollapsed(k)?"Show details & pricing":"Hide details & pricing"} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,fontWeight:600,color:isCollapsed(k)?textS:accent,padding:"3px 9px",borderRadius:9,border:`1px solid ${isCollapsed(k)?border:accent+"60"}`,background:isCollapsed(k)?"transparent":accent+"12",flexShrink:0,whiteSpace:"nowrap"}}><span style={{display:"inline-flex",transform:isCollapsed(k)?"rotate(-90deg)":"none",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span>Details</span>}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {isOn&&showCosts&&!isCollapsed(k)&&<div style={{fontSize:14,fontWeight:700,color:textP}}>{fmt(zoneTotal(k))}</div>}
            <span title="Add Production item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"production"});}} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#7E22CE",borderRadius:7,background:"rgba(168,85,247,0.10)"}}><IconFactory size={14}/></span>
            <span title="Add Buying item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"buying"});}} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#B45309",borderRadius:7,background:"rgba(245,158,11,0.12)"}}><IconCart size={14}/></span>
            {/* The per-zone "Duplicate this zone" copy button is gone — it crowded the row and the
                "+ Add Zone" box below covers the same need. Existing duplicates still render and
                still carry their ✕ so saved sessions can be cleaned up. */}
            {isDuplicate&&<span title={`Remove ${el.label}`} onClick={e=>{e.stopPropagation();askConfirm(`Remove ${el.label}?`,()=>{setCustomZones(p=>p.filter(z=>z.id!==k));setEnabledEls(p=>{const n={...p};delete n[k];return n;});setZoneElements(p=>{const n={...p};delete n[k];return n;});setZoneConfig(p=>{const n={...p};delete n[k];return n;});showMsg(`✓ ${el.label} removed`,"green");});}} style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700}}>✕</span>}
            {isOn&&isCentrepieceZone&&<span onClick={e=>e.stopPropagation()} title="Scale the whole set — multiplies every element count below (e.g. 10 tables → 10× tables, chairs, centre pieces…). Works even with pricing hidden." style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:10,background:isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.10)",border:`1px solid ${accent}40`}}>
              <span style={{fontSize:10,fontWeight:700,color:accent,letterSpacing:0.3}}>✕ Scale</span>
              <input type="number" min="1" step="1" value={zoneScaleVal(k)} onClick={e=>e.stopPropagation()} onChange={e=>setZoneScale(k, e.target.value)} onFocus={e=>e.target.select()} style={{width:40,padding:"2px 3px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:12,fontWeight:700,textAlign:"center",MozAppearance:"textfield"}} />
            </span>}
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleRepeat(k);}} title={isRepeat(k)?"Reusing an existing setup — discounted rental, no build labour":"New build this time — full rental + labour + transport"} style={{cursor:"pointer",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:10,border:`1px solid ${isRepeat(k)?"#059669":border}`,background:isRepeat(k)?"#05966918":"transparent",color:isRepeat(k)?"#059669":textS}}><span style={{display:"inline-flex",alignItems:"center",gap:5}}>{isRepeat(k)?<IconRepeat size={11}/>:<IconSparkle size={11}/>}{isRepeat(k)?"Repeat":"Fresh"}</span></span>}
            <div style={{width:44,height:26,borderRadius:13,background:isOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}} onClick={e=>{e.stopPropagation();toggleEl(k);}}><div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isOn?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/></div>
          </div>
        </div>
        {isOn&&<div style={{padding:"0 18px 16px"}}>
          {/* ═══ DYNAMIC PHOTO GALLERY — select a photo to load its pricing ═══ */}
          <div style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:600,color:textS,display:"flex",alignItems:"center",gap:6}}><IconCamera size={12}/>{el.label} — tap to apply pricing</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {elSelectedPhoto[k]&&<div style={{fontSize:10,color:"#059669",fontWeight:600}}>✓ {elSelectedPhoto[k].eventName}</div>}
                  <label style={{padding:"4px 12px",borderRadius:8,border:`1px solid ${accent}60`,background:zoneUploading===k?accent+"20":"transparent",color:zoneUploading===k?accent:accent,fontSize:10,fontWeight:600,cursor:zoneUploading?"wait":"pointer",display:"flex",alignItems:"center",gap:3}}>
                    {zoneUploading===k?"Uploading…":<><IconCamera size={11}/>Upload</>}
                    <input type="file" accept="image/*" style={{display:"none"}} disabled={!!zoneUploading} onChange={e=>{const f=e.target.files?.[0];if(f)handleZoneUpload(k,f);e.target.value="";}}/>
                  </label>
                  <button onClick={()=>setGridZones(g=>({...g,[k]:!g[k]}))} title={gridZones[k]?"Show as strip":"Show all in a grid"} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${gridZones[k]?accent:border}`,background:gridZones[k]?`${accent}15`:"transparent",color:gridZones[k]?accent:textS,fontSize:12,fontWeight:500,cursor:"pointer"}}>{gridZones[k]?"▭":"▦"}</button>
                  <button onClick={()=>setZpFilterOpen(!zpFilterOpen)} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${zpFilterOpen||zpHasFilters?accent:border}`,background:zpFilterOpen||zpHasFilters?`${accent}15`:"transparent",color:zpFilterOpen||zpHasFilters?accent:textS,fontSize:10,fontWeight:500,cursor:"pointer"}}><IconSearch size={11}/>{zpHasFilters?` (${Object.values(zpFilters).flat().length})`:""}</button>
                </div>
              </div>
              {/* Venue is a preference, not a filter — say so, or the other venues' photos further
                  along the strip look like the venue pick silently failed. */}
              {!!(zpFilters.venue||[]).length&&matchedPhotos.length>0&&<div style={{fontSize:10,color:textS,marginBottom:6,display:"flex",alignItems:"center",gap:5}}>
                <span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{venuePrefCount} at {zpFilters.venue.length===1?zpFilters.venue[0]:"selected venues"}</span>
                <span>shown first{matchedPhotos.length>venuePrefCount?`, then ${matchedPhotos.length-venuePrefCount} from other venues`:""}</span>
              </div>}
              {zpFilterOpen&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:10,marginBottom:8,borderRadius:10,border:`1px solid ${accent}30`,background:isDark?"rgba(201,169,110,0.03)":"rgba(201,169,110,0.05)"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Event type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,eventType:[]}))} style={zpPill(zpFilters.eventType.length===0)}>All</span>
                    {azSort(taxOr(taxonomy.eventType, FUNCTIONS)).map(v=><span key={v} onClick={()=>zpToggleFilter("eventType",v)} style={zpPill(zpFilters.eventType.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Venue type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,venueType:[]}))} style={zpPill(zpFilters.venueType.length===0)}>All</span>
                    {[...taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"])].sort((a,b)=>String(venueTypeLabel(a)).localeCompare(String(venueTypeLabel(b)))).map(v=><span key={v} onClick={()=>zpToggleFilter("venueType",v)} style={zpPill(zpFilters.venueType.includes(v))}>{venueTypeLabel(v)}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Design style</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,designStyle:[]}))} style={zpPill(zpFilters.designStyle.length===0)}>All</span>
                    {azSort(taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"])).map(v=><span key={v} onClick={()=>zpToggleFilter("designStyle",v)} style={zpPill(zpFilters.designStyle.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Color palette</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,colorPalette:[]}))} style={zpPill(zpFilters.colorPalette.length===0)}>All</span>
                    {azSort(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])).map(v=><span key={v} onClick={()=>zpToggleFilter("colorPalette",v)} style={zpPill(zpFilters.colorPalette.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Day / Night</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,timeSetting:[]}))} style={zpPill(zpFilters.timeSetting.length===0)}>All</span>
                    {azSort(taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"])).map(v=><span key={v} onClick={()=>zpToggleFilter("timeSetting",v)} style={zpPill(zpFilters.timeSetting.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>
                    Venue{zpWantIndoor&&!zpWantOutdoor?" — Indoor":zpWantOutdoor&&!zpWantIndoor?" — Outdoor":""}
                  </div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",maxHeight:110,overflowY:"auto"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,venue:[]}))} style={zpPill(zpFilters.venue.length===0)}>All</span>
                    {azSort(zpVenueChoices).map(v=><span key={v} onClick={()=>zpToggleFilter("venue",v)} style={zpPill(zpFilters.venue.includes(v))}>{v}</span>)}
                    {zpVenueChoices.length===0&&<span style={{fontSize:9,color:textS}}>No venues configured yet</span>}
                  </div>
                </div>
                {zpHasFilters&&<div style={{gridColumn:"1/-1",textAlign:"right"}}><span onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[]})} style={{fontSize:9,color:"#E11D48",cursor:"pointer"}}>Clear filters</span></div>}
              </div>}
              {matchedPhotos.length>0 ? (()=>{
                // Strip view shows PH_PER_PAGE at a time with a pager underneath, so each card is
                // large enough to judge a stage from. The ▦ grid toggle still shows everything.
                const paged = !gridZones[k];
                const pageCount = paged ? Math.max(1, Math.ceil(matchedPhotos.length / PH_PER_PAGE)) : 1;
                const page = Math.min(phPage[k] || 0, pageCount - 1);   // clamp: filters can shrink the list
                const start = paged ? page * PH_PER_PAGE : 0;
                const shown = paged ? matchedPhotos.slice(start, start + PH_PER_PAGE) : matchedPhotos;
                return (<>
              <div style={gridZones[k]?{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8,paddingBottom:6,maxHeight:560,overflowY:"auto"}:{display:"grid",gridTemplateColumns:`repeat(${PH_COLS},minmax(0,1fr))`,gap:12,paddingBottom:6,touchAction:"pan-y",animation:phAnim[k]?`${phAnim[k]} .3s cubic-bezier(.22,.61,.36,1)`:undefined}} className="ph-grid" id={`ph-grid-${k}`} {...phSwipeHandlers(k,page,pageCount)}>
              {shown.map((ph,pi)=>{
                const i = start + pi;   // absolute index: the lightbox browses the whole matched set
                const isSource = sourceEvent && ph.eventName === sourceEvent.name;
                const isSelected = elSelectedPhoto[k]?.src === ph.src;
                // Calculate cost: SAME formula as zone header — elements (with floralRatio) + current zone structure
                const photoFullCost = calcPhotoCost(k, ph);
                // Column layout so the caption below the photo can take every pixel the image does
                // not — see .ph-sel's flex:1. The tile is a grid item, so it already stretches to
                // the tallest card in the row; that slack now belongs to the select target instead
                // of being dead space.
                return (
                <div key={i} className="ph-tile" style={{flexShrink:0,width:"auto",minWidth:0,borderRadius:10,overflow:"hidden",
                  display:"flex",flexDirection:"column",
                  border:isSelected?`3px solid #059669`:isSource?`2px solid #C9A96E`:`2px solid ${border}`,
                  cursor:"pointer",position:"relative",background:isSelected?(isDark?"#0D2818":"#ECFDF5"):cardBg,
                  boxShadow:isSelected?"0 2px 12px rgba(5,150,105,0.2)":"none",
                  transition:"all 0.15s"}}>
                  {/* Opens on this photo but hands the lightbox the whole matched set, so the
                      arrows there walk the zone's photos rather than one image in isolation. */}
                  <div style={{position:"relative",cursor:"zoom-in"}} onClick={(e)=>{e.stopPropagation();if(phSwipedJustNow())return;setLightbox({idx:i,items:matchedPhotos.map(p=>({src:p.src,name:p.eventName}))});}}>
                    <img src={ph.src} alt={ph.eventName} loading="lazy" className="ph-img" style={{width:"100%",height:gridZones[k]?95:190,objectFit:"cover",display:"block",opacity:isSelected?1:0.85}} onError={e=>{e.target.style.display="none"}}/>
                    {showCosts&&!isCollapsed(k)&&photoFullCost>0&&<div style={{position:"absolute",bottom:6,right:6,background:isSelected?"#059669":"rgba(0,0,0,0.7)",color:"#fff",padding:gridZones[k]?"3px 7px":"3px 8px",borderRadius:gridZones[k]?5:6,fontSize:gridZones[k]?9:12.5,fontWeight:gridZones[k]?600:700}}>{fmt(photoFullCost)}</div>}
                    {(()=>{
                      // Verified only. An unverified photo shows nothing here, so the tick means
                      // something — same rule the Library grid uses, minus its AI/untagged states.
                      // phVerified also requires elements: a photo with 0 has no pricing to vouch for.
                      const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
                      if (!phVerified(ph)) return null;
                      const by = li._verifiedBy || "unknown";
                      const on = li._verifiedAt ? new Date(li._verifiedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : null;
                      // A filled star, not a tick. Same disc treatment as before — solid fill, white
                      // ring, drop shadow — because a flat badge vanishes over a photo, whether the
                      // stage behind it is lit pale or dark.
                      return <div title={`Verified by ${by}${on ? " on " + on : ""}`} style={{position:"absolute",top:6,right:6,width:21,height:21,borderRadius:11,
                        background:"#059669",border:"2px solid rgba(255,255,255,0.92)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",
                        boxShadow:"0 2px 7px rgba(0,0,0,0.4)"}}>
                        <IconStar size={11} filled/>
                      </div>;
                    })()}
                    {isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#059669",color:"#fff",width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>✓</div>}
                    {isSource&&!isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#0F0F1A",fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:4}}>SOURCE</div>}
                    {ph.isVideoDefault&&!isSelected&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#fff",fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:4}}>Default</div>}
                  </div>
                  {/* The whole strip under the photo selects, not just the two lines of text —
                      flex:1 claims the leftover height and the padding widens the target. */}
                  <div className="ph-sel" data-sel={isSelected?"1":"0"} title={isSelected?"Selected — this photo's pricing is applied to the zone":"Use this photo's pricing for the zone"} style={{flex:1,minHeight:52,padding:"11px 12px",cursor:"pointer",background:isSelected?(isDark?"#0D2818":"#ECFDF5"):"transparent"}} onClick={()=>{if(phSwipedJustNow())return;selectElPhoto(k,ph);phGoTo(k,0,page);phScrollTop(k);}}>
                    <div style={{fontSize:12,fontWeight:isSelected?700:600,color:isSelected?"#059669":textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ph.eventName}</div>
                    <div style={{fontSize:10.5,color:isSelected?"#059669":textS,marginTop:3}}>
                      {ph.isLibrary ? `${(ph.elements||[]).length} elements` : (ph.fn || "Event") + " · " + (ph.space || "")}
                    </div>
                    {isSelected&&<div style={{marginTop:5,fontSize:10.5,fontWeight:700,color:"#047857",display:"flex",alignItems:"center",gap:4}}>✓ Selected</div>}
                  </div>
                </div>);
              })}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6,flexWrap:"wrap"}}>
                {/* Pager on the left — only when there is more than one page to move between. */}
                {paged&&pageCount>1&&<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>phGoTo(k,Math.max(0,page-1),page)} disabled={page===0} title="Previous photos" className="ph-pg" style={phNav(page===0)}>
                    <span style={{display:"inline-flex",transform:"rotate(90deg)"}}><IconChevron size={13}/></span>
                  </button>
                  {pageWindow(page,pageCount).map((n,gi)=>n==="…"
                    ? <span key={`gap${gi}`} style={{fontSize:11,color:textS,padding:"0 2px"}}>…</span>
                    : <button key={n} onClick={()=>phGoTo(k,n,page)} className="ph-pg" style={phDot(n===page)}>{n+1}</button>)}
                  <button onClick={()=>phGoTo(k,Math.min(pageCount-1,page+1),page)} disabled={page===pageCount-1} title="More photos" className="ph-pg" style={phNav(page===pageCount-1)}>
                    <span style={{display:"inline-flex",transform:"rotate(-90deg)"}}><IconChevron size={13}/></span>
                  </button>
                  <span style={{fontSize:10.5,color:textS,marginLeft:4}}>{start+1}–{Math.min(start+PH_PER_PAGE,matchedPhotos.length)} of {matchedPhotos.length}</span>
                </div>}
                {/* Photo-level actions, moved up from the Element card header. Gated on the zone
                    having photos rather than on the panel being open: up here they are outside the
                    Elements panel, and vanishing with it would read as a bug. */}
                <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:"auto"}}>
                  {/* Permanent correction (Phase 1b) — push the corrected element list back to the
                      master library photo so the fix sticks for everyone. Visible for ANY selected
                      photo while CORRECTION_MODE is on, so it can be tagged whenever — if the photo
                      isn't a Library photo yet (fresh upload, event photo), save() below creates a
                      new Library entry for it instead of updating an existing one. */}
                  {CORRECTION_MODE && elSelectedPhoto[k]?.src && (()=>{
                    const selP = elSelectedPhoto[k];
                    const isLib = selP.isLibrary && selP.eventId;
                    const master = isLib ? libItems.find(i => i.id === selP.eventId) : null;
                    const verified = !!master?._verified;
                    return <button onClick={()=>{
                      if(!master){showMsg("Couldn't find the master photo for this image.","red");return;}
                      // Open the full tag-correction panel (tier/venue/event/style/palette/zone + elements) pre-filled from master.
                      const mv=master.tags?.venue||"";
                      setCorrVenueGrp(allInhouseVenues.includes(mv)?"inhouse":(mv?"outside":""));
                      setCorrectPhoto({ libId: selP.eventId, zoneKey:k, name: master.name||"", tags: JSON.parse(JSON.stringify(master.tags||{})) });
                    }} title="Correct this photo's tags + elements and save back to the shared library photo (permanent, for everyone)"
                      style={{...S.btn(false),display:"inline-flex",alignItems:"center",gap:5,fontSize:10,padding:"4px 10px",border:`1px solid ${verified?"#059669":"#7C3AED"}`,color:verified?"#059669":"#7C3AED",fontWeight:600}}>
                      <IconPencil size={11}/>{verified?"Correct & update master":"Correct & save to master"}
                    </button>;
                  })()}
                </div>
              </div>
              </>);
              })() : (
            <div style={{background:isDark?"rgba(201,169,110,0.06)":"#FFFBEB",borderRadius:10,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200}}><div style={{fontSize:12,fontWeight:600,color:"#B45309"}}>{zpHasFilters?`No ${el.label} photos match your filters`:`No ${el.label} photos yet`}</div>
              <div style={{fontSize:10.5,color:textS,marginTop:2,lineHeight:1.4}}>{zpHasFilters?"Your photo filters hid everything for this zone. Clear them to see all photos again.":"Upload a client photo or add Library photos to see options here."}</div></div>
              <div style={{display:"flex",gap:7,flexShrink:0,flexWrap:"wrap"}}>
                {zpHasFilters&&<button onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[]})} style={{padding:"6px 13px",borderRadius:8,border:`1px solid ${accent}`,background:"transparent",color:accent,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Clear filters</button>}
                <label style={{display:"inline-flex",alignItems:"center",gap:4,padding:"6px 14px",borderRadius:8,border:"none",background:accent,color:"#0F0F1A",fontSize:11,fontWeight:600,whiteSpace:"nowrap",cursor:zoneUploading?"wait":"pointer"}}>
                  {zoneUploading===k?"Uploading…":<><IconCamera size={12}/>Upload Client Photo</>}
                  <input type="file" accept="image/*" style={{display:"none"}} disabled={!!zoneUploading} onChange={e=>{const f=e.target.files?.[0];if(f)handleZoneUpload(k,f);e.target.value="";}}/>
                </label>
              </div>
            </div>
          )}
          </div>

          {/* ═══ AI INSPIRATION per element — HIDDEN pending search integration ═══ */}


          {/* ═══ ELEMENT CARD + ZONE STRUCTURE — hidden when the zone is collapsed ═══ */}
          {showCosts&&!isCollapsed(k)&&<Fragment>

          {/* ═══ FOUR SECTIONS ═══ Two per row. Details for one open below on click. ═══ */}
          <div className="sec-grid" id={`zone-sec-${k}`}>
            {ZONE_SECTIONS.map(sec=>sectionTile(k,sec))}
          </div>

          {/* ═══ ELEMENT CARD PRICING — from selected photo ═══ */}
          {zoneSection[k]==="elements"&&(zoneElements[k] ? (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div onClick={()=>toggleElCard(k)} title={isElCardOpen(k)?"Hide the element list":"Show the element list"} style={{fontSize:11,fontWeight:600,color:"#666",cursor:"pointer",display:"flex",alignItems:"center",gap:5,userSelect:"none"}}><span style={{display:"flex",color:"#999",transform:isElCardOpen(k)?"none":"rotate(-90deg)",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span><IconClipboard size={12}/><span style={{color:textP}}>Element card</span><span style={{color:textS,fontWeight:400}}>· {el.label}</span><span title={`Source library photo: ${elSelectedPhoto[k]?.eventName || "Library photo"}`} style={{fontSize:9.5,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",color:textS,opacity:0.75,background:isDark?"rgba(255,255,255,0.05)":"rgba(26,26,46,0.05)",padding:"1px 6px",borderRadius:4,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{elSelectedPhoto[k]?.eventName || "Library photo"}</span>{!isElCardOpen(k)&&elCardSummary(k)}</div>
                {/* Adding an element belongs beside the element list, not up on the photo pager.
                    Gated on the panel: adding to a collapsed list would look like nothing happened. */}
                {isElCardOpen(k)&&<div style={{position:"relative"}}>
                    <input value={zoneElSearch[k]||""} onChange={e=>setZoneElSearch(p=>({...p,[k]:e.target.value}))} placeholder="+ Add element..." style={{...S.input,fontSize:11.5,padding:"3px 8px",width:140,marginBottom:0}} onFocus={()=>setZoneElSearch(p=>({...p,[k]:""})) } />
                    {(zoneElSearch[k]||"").length>=1&&(()=>{
                      const q=(zoneElSearch[k]||"").toLowerCase();
                      // A kit's own components are already covered by that kit — don't offer adding
                      // one separately (would double the item and double its cost).
                      const kitCoveredIds=new Set((zoneElements[k]||[]).filter(el=>el.invId).flatMap(el=>{
                        const it=(imsInventory||[]).find(i=>i.id===el.invId);
                        const comps=Array.isArray(el.kitOverrides)?el.kitOverrides:(it?.subItems||[]);
                        return comps.map(c=>c.itemId);
                      }));
                      // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                      // (Rate Card is not consulted here — see getElPriceFromInventory /
                      // getElPriceFromPattern in StudioApp.jsx).
                      const invMatches=(imsInventory||[]).filter(it=>!(zoneElements[k]||[]).find(el=>el.invId===it.id)&&!kitCoveredIds.has(it.id)&&!isHiddenSubcat(it,rcSubcatFactors)&&(it.name.toLowerCase().includes(q)||(it.cat||"").toLowerCase().includes(q)||(it.subCat||it.subcategory||"").toLowerCase().includes(q))).slice(0,8);
                      const patMatches=(recipeOnlyPatterns||[]).filter(pt=>!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)&&pt.name.toLowerCase().includes(q)).slice(0,4);
                      const matches=[...invMatches.map(it=>({kind:"inv",it})),...patMatches.map(pt=>({kind:"pat",pt}))].slice(0,8);
                      return matches.length>0?<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:340,overflowY:"auto",width:320}}>
                        {matches.map(m=>{
                          if(m.kind==="pat"){ const pt=m.pt; return <div key={"pat:"+pt.id}
                            onClick={()=>{
                              if(!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:pt.name,qty:1,unit:pt.unit,size:"",patternId:pt.id}]}));}
                              setZoneElSearch(prev=>({...prev,[k]:""}));
                            }}
                            style={{padding:"8px 10px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontSize:22,opacity:0.5}}>🌺</span>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pt.name}</span>
                                <span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700,flexShrink:0}}>🌺 RECIPE</span>
                              </div>
                              <div style={{fontSize:11,color:textS,marginTop:2}}>{pt.sub?pt.sub+" › ":""}Flower recipe — no inventory item</div>
                            </div>
                          </div>; }
                          const it=m.it; const isKit=Array.isArray(it.subItems)&&it.subItems.length>0; const src=it.img||it.photoUrls?.[0];
                          const remaining=remainingForItem(it.id,k); const isBlocked=remaining!=null&&remaining<=0;
                          return <div key={"inv:"+it.id}
                            onClick={()=>{
                              if(isBlocked) return;
                              if(!(zoneElements[k]||[]).find(el=>el.invId===it.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:it.name,qty:1,unit:it.unit,size:"",invId:it.id}]}));}
                              setZoneElSearch(prev=>({...prev,[k]:""}));
                            }}
                            style={{padding:"8px 10px",fontSize:12,cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10,opacity:isBlocked?0.45:1}}>
                            <ItemHoverThumb src={src} size={56} name={it.name} sub={(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › "+(it.cat||""):it.cat} dims={itemDimsText(it)} border={border} cardBg={cardBg} textP={textP} textS={textS} emptyBg={isDark?"#1a1a2e":"#eee"} />
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</span>
                                {isKit&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700,flexShrink:0}}>KIT</span>}
                                {isBlocked&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>fully used in this event</span>}
                                {!isBlocked&&remaining!=null&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
                              </div>
                              <div style={{fontSize:11,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}{itemDimsText(it)?` · ${itemDimsText(it)}`:""}</div>
                            </div>
                          </div>;
                        })}
                      </div>:<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:11.5,color:textS,width:320}}>No matches</div>;
                    })()}
                </div>}
              </div>
              {isElCardOpen(k)&&<div style={{background:isDark?"#12121F":"#FAFAFA",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
                {(zoneElements[k]||[]).length===0&&<div style={{fontSize:11,color:textS,lineHeight:1.5,padding:"2px 0"}}>No elements on this photo yet — use <strong style={{color:textP,fontWeight:600}}>+ Add element…</strong> above, or pick a photo that has an element card.</div>}
              <div className="el-grid" style={{"--el-cols":railsOpen?4:6}}>
                {groupedEls(k).map(({ el, idx, isKit, firstKit }) => {
                  const priceInfo = getElPrice(el, zoneConfig[k], { checkAvailability: true });
                  const rc = priceInfo.rc;
                  const hasSizes = rcIsSMB(rc);
                  const isTrussSqft = rc && rc.unit === "truss_sqft";
                  const rawUp = priceInfo.unitPrice;
                  const adjUp = applyFloralRatio(rawUp, rc);
                  const lineTotal = isTrussSqft
                    ? applyFloralRatio(priceInfo.lineCost, rc)
                    : (el.qty||0) * adjUp;
                  const invItem = el.invId ? (imsInventory||[]).find(i=>i.id===el.invId) : null;
                  const thumbItem = invItem || (imsInventory||[]).find(i=>i.name===el.name);
                  const thumbSrc = thumbItem?.img || thumbItem?.photoUrls?.[0];
                  const thumbKey = `${k}:${idx}`;
                  const isUnavail = !!el.invId && typeof priceInfo.available==="number" && priceInfo.available<=0 && (el.qty||0)>0;
                  return (
                  <div key={idx} className="el-row" data-kit={isKit?"1":"0"} style={{display:"flex",flexDirection:"column",gap:6,padding:"9px 10px",borderRadius:12,border:`1px solid ${isDark?"rgba(255,255,255,0.09)":"rgba(26,26,46,0.10)"}`,background:cardBg,gridColumn:isKit?(firstKit?`1 / span ${railsOpen?2:3}`:`span ${railsOpen?2:3}`):"span 1",minHeight:isKit?undefined:98,justifyContent:isKit?"flex-start":"space-between"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                        <div style={{position:"relative",flexShrink:0}}
                          onMouseEnter={(e)=>{
                            if(!thumbSrc) return;
                            const r=e.currentTarget.getBoundingClientRect();
                            const POP=164;
                            const openUp=window.innerHeight-r.bottom<POP+8 && r.top>POP+8;
                            setElThumbHover({key:thumbKey,openUp,top:openUp?undefined:r.bottom+4,bottom:openUp?window.innerHeight-r.top+4:undefined,left:Math.min(r.left,window.innerWidth-168)});
                          }}
                          onMouseLeave={()=>setElThumbHover(null)}>
                          {thumbSrc ? <img src={thumbSrc} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover",cursor:"zoom-in"}}/> : <div style={{width:20,height:20,borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11.5}}><IconBox size={12}/></div>}
                          {elThumbHover?.key===thumbKey && thumbSrc && (
                            <div style={{position:"fixed",top:elThumbHover.top,bottom:elThumbHover.bottom,left:elThumbHover.left,zIndex:10000,width:160,height:160,borderRadius:8,overflow:"hidden",border:`2px solid ${border}`,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",pointerEvents:"none"}}>
                              <img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            </div>
                          )}
                        </div>
                        <span title={isUnavail?"Not available for this date — tap the stock icon to pick a different item":undefined} style={{fontSize:12,fontWeight:500,color:isUnavail?"#EF4444":(rc||el.invId||el.patternId)?textP:"#F59E0B",textDecoration:isUnavail?"line-through":"none",minWidth:0,whiteSpace:"normal",overflowWrap:"anywhere"}}>{invItem?.name || el.name}</span>
                        {showCosts&&<span title="Rate per unit" style={{flexShrink:0,fontSize:11,fontWeight:600,color:textS,whiteSpace:"nowrap"}}>{adjUp>0?`₹${adjUp.toLocaleString("en-IN")}/${isTrussSqft?"truss sqft":(invItem?.unit||rc?.unit||el.unit)}`:"₹0"}</span>}
                        {isKit&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700}}>KIT</span>}
                        {!rc&&!el.invId&&!el.patternId&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700}}>NEW</span>}
                        {el.invId&&priceInfo.warning&&<span title={priceInfo.warning} style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700}}>⚠ short</span>}
                        {(rc||el.invId)&&<span onClick={()=>openAvailModal(k, idx, el, rc)} title="Check stock availability & pick an item" style={{cursor:"pointer",fontSize:12,opacity:0.5,padding:"0 1px",lineHeight:1}}><IconBox size={12}/></span>}
                        {el.imsId&&<span onClick={()=>openAvailModal(k, idx, el, rc)} title={`Booking: ${(imsInventory||[]).find(i=>i.id===el.imsId)?.name||el.imsName||"selected item"} — tap to change`} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:2,fontSize:10.5,padding:"2px 7px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"#059669",fontWeight:700,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(imsInventory||[]).find(i=>i.id===el.imsId)?.name||el.imsName||"pinned"}</span>}
                        {showCosts&&rc&&(rc.cat||"").toLowerCase()==="florals"&&floralRatio>0&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(0,0,0,0.05)",color:"#888",fontWeight:700}}>{"🌸"} {100-floralRatio}% real</span>}
                        {isTrussSqft&&priceInfo.area>0&&<span style={{fontSize:11,padding:"2px 7px",borderRadius:3,background:"rgba(59,130,246,0.12)",color:"#3B82F6",fontWeight:600}}>{priceInfo.area} sqft</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2,flexWrap:"wrap"}}>
                        {hasSizes&&!priceInfo.isFloralBlend&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:11,fontWeight:(el.size||"M")===s?700:400,cursor:"pointer",background:(el.size||"M")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"M")===s?"#666":textS}}>{s}</button>)}
                        {priceInfo.isFloralBlend&&priceInfo.patternSMB&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:11,fontWeight:(el.size||"B")===s?700:400,cursor:"pointer",background:(el.size||"B")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"B")===s?"#666":textS}}>{s}</button>)}
                        {hasSizes&&!priceInfo.isFloralBlend&&<button onClick={()=>{const elems=[...(zoneElements[k]||[])];const used=new Set(elems.filter(e=>e.name===el.name).map(e=>e.size||"M"));const ns=["B","M","S"].find(s=>!used.has(s))||"B";elems.splice(idx+1,0,{...el,size:ns,qty:1});setZoneElements(p=>({...p,[k]:elems}));}} title="Split into another size (e.g. 3 Big + 2 Small)" style={{padding:"1px 6px",borderRadius:4,border:`1px dashed ${border}`,fontSize:11,fontWeight:600,cursor:"pointer",background:"transparent",color:accent}}>＋ size</button>}
                        {priceInfo.isFloralBlend&&<span style={{display:"flex",alignItems:"center",gap:3,fontSize:11,fontWeight:700}}>{"🌸"}<button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:typeof el.realPct==="number"?undefined:100};setZoneElements(p=>({...p,[k]:elems}));}} title={typeof el.realPct==="number"?"Priced at "+el.realPct+"% of the recipe's Studio rate — tap to go back to this sub-category's default ratio":"Using this sub-category's default real/artificial ratio — tap to price at 100% of the recipe's Studio rate"} style={floralPill(typeof el.realPct==="number")}>{typeof el.realPct==="number"?`${el.realPct}%`:"Ratio"}</button><input type="number" min="0" max="100" value={el.realPct??""} placeholder={String(priceInfo.realPct??"")} onChange={e=>{const v=e.target.value;const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:v===""?undefined:Math.max(0,Math.min(100,parseFloat(v)||0))};setZoneElements(p=>({...p,[k]:elems}));}} title="Manually set the exact % real — overrides Ratio/100%" style={{width:44,padding:"2px 6px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:11,textAlign:"center"}} /></span>}
                        {/* §23 Phase 2.9 → Paint Allocation Ops (05 Jun 2026) — item-level paintability */}
                        {(()=>{
                          // New rule: paintable iff sub-category has ≥1 IMS item with paintCost > 0
                          // Falls back to PAINT_TOKENS keyword match when IMS inventory not loaded
                          const imsInv = dealCheckData?.inventory || [];
                          const subcatCheck = rc ? isSubcatPaintable(rc.sub, imsInv) : false;
                          let isPaintable;
                          if (subcatCheck === null) {
                            // IMS not loaded — fall back to keyword match
                            const _cat = String(rc?.cat||"").toLowerCase();
                            const _sub = String(rc?.sub||"").toLowerCase();
                            isPaintable = rc && PAINT_TOKENS_FALLBACK.some(tok => _cat.includes(tok) || _sub.includes(tok));
                          } else {
                            isPaintable = subcatCheck;
                          }
                          if (!isPaintable) return null;
                          // Look up baseColour from IMS inventory (via dealCheckData if available)
                          const invItem = el.invId ? (dealCheckData?.inventory || []).find(i => i.id === el.invId) : (dealCheckData?.inventory || []).find(i => i.name === el.name);
                          const baseColour = invItem?.baseColour || "Ivory";
                          // §23 Phase 2.9d — multi-colour allocation aware
                          const allocs = normalizePaintAllocation(el, baseColour);
                          const isOverridden = allocs.length > 0;
                          const label = paintPillLabel(el, baseColour);
                          // Swatch colour: if 1 alloc, show that. If 2+, show first 2 split chip.
                          const firstColour = allocs[0]?.colour || baseColour;
                          const secondColour = allocs[1]?.colour;
                          const cObj1 = imsColourCatalogue.find(c => c.name === firstColour);
                          const cObj2 = secondColour ? imsColourCatalogue.find(c => c.name === secondColour) : null;
                          return (
                            <button onClick={()=>setPaintPickerTarget({zoneKey:k, elIdx:idx})}
                              title="Tap to allocate paint colours"
                              style={{
                                display:"flex",
                                alignItems:"center",
                                gap:4,
                                padding:"3px 8px 3px 6px",
                                borderRadius:6,
                                border: isOverridden ? "1.5px solid #EC4899" : `1.5px dashed ${isDark?"rgba(255,255,255,0.25)":"rgba(124,58,237,0.4)"}`,
                                background: isOverridden ? "rgba(236,72,153,0.10)" : (isDark?"rgba(124,58,237,0.08)":"rgba(124,58,237,0.05)"),
                                cursor:"pointer",
                                fontSize:11.5,
                                fontWeight:isOverridden?700:600,
                                color: isOverridden ? "#EC4899" : (isDark?"#C4B5FD":"#7c3aed")
                              }}>
                              <IconPalette size={12}/>
                              {/* Split-chip swatch when 2+ colours */}
                              {cObj2 ? (
                                <span style={{display:"inline-flex",width:14,height:10,borderRadius:2,overflow:"hidden",border:"1px solid rgba(0,0,0,0.15)"}}>
                                  <span style={{width:7,background:cObj1?.hex||"#F5F0E1"}} />
                                  <span style={{width:7,background:cObj2?.hex||"#ccc"}} />
                                </span>
                              ) : (
                                <span style={{width:10,height:10,borderRadius:2,border:"1px solid rgba(0,0,0,0.15)",background:cObj1?.hex||"#F5F0E1"}} />
                              )}
                              <span>{label}</span>
                              {isOverridden && <span style={{fontSize:10.5,padding:"1px 6px",borderRadius:3,background:"#EC4899",color:"#fff",fontWeight:700,marginLeft:2}}><IconPencil size={10}/></span>}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                      {isTrussSqft ? (
                        <div style={{fontSize:12,fontWeight:600,color:textS,padding:"3px 8px",borderRadius:6,background:isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)",minWidth:64,textAlign:"center"}}>{priceInfo.area>0?`× ${priceInfo.area} sqft`:"× — sqft"}</div>
                      ) : (
                        <>
                          <button onClick={()=>{
                            const elems=[...(zoneElements[k]||[])];
                            const nextQty = Math.max(0,(el.qty||0)-1);
                            // §23 Phase 2.9d — block qty reduction below paint allocation total
                            const invItem = el.invId ? (dealCheckData?.inventory || []).find(i => i.id === el.invId) : (dealCheckData?.inventory || []).find(i => i.name === el.name);
                            const baseColour = invItem?.baseColour || "Ivory";
                            const allocs = normalizePaintAllocation(el, baseColour);
                            const allocTotal = allocs.reduce((s,a) => s + a.qty, 0);
                            if (allocTotal > 0 && nextQty < allocTotal) {
                              showMsg(`Cannot reduce qty below ${allocTotal} — paint allocation is set. Open the paint picker to adjust the allocation first.`, "red");
                              return;
                            }
                            elems[idx]={...elems[idx],qty:nextQty};
                            setZoneElements(p=>({...p,[k]:elems}));
                          }} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>{"−"}</button>
                          <input type="number" min="0" value={el.qty||0} onChange={e=>{
                            const elems=[...(zoneElements[k]||[])];
                            const nextQty = Math.max(0,parseInt(e.target.value)||0);
                            // §23 Phase 2.9d — same guard for direct typing
                            const invItem = el.invId ? (dealCheckData?.inventory || []).find(i => i.id === el.invId) : (dealCheckData?.inventory || []).find(i => i.name === el.name);
                            const baseColour = invItem?.baseColour || "Ivory";
                            const allocs = normalizePaintAllocation(el, baseColour);
                            const allocTotal = allocs.reduce((s,a) => s + a.qty, 0);
                            if (allocTotal > 0 && nextQty < allocTotal) {
                              showMsg(`Cannot set qty below ${allocTotal} — paint allocation is set. Open the paint picker first.`, "red");
                              return;
                            }
                            elems[idx]={...elems[idx],qty:nextQty};
                            setZoneElements(p=>({...p,[k]:elems}));
                          }} onFocus={e=>e.target.select()} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:(el.qty||0)>0?textP:textS,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit",MozAppearance:"textfield"}}/>
                          <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:(el.qty||0)+1};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                        </>
                      )}
                      </div>
                      {showCosts?<div style={{fontSize:13,fontWeight:600,color:lineTotal>0?textP:textS,textAlign:"left",whiteSpace:"nowrap"}}>{lineTotal>0?fmt(lineTotal):"—"}</div>:<span/>}
                      <span onClick={()=>{const elems=(zoneElements[k]||[]).filter((_,i)=>i!==idx);setZoneElements(p=>({...p,[k]:elems}));}} style={{marginLeft:"auto",cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12.5}}>×</span>
                    </div>
                    </div>
                    {isTrussSqft&&priceInfo.warning&&<div style={{fontSize:11.5,color:"#F59E0B",marginTop:4,padding:"4px 6px",borderRadius:4,background:"rgba(245,158,11,0.08)"}}>{priceInfo.warning}</div>}
                    {isKit&&<KitComponentsEditor
                      item={invItem}
                      overrides={el.kitOverrides}
                      onChange={(next)=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],kitOverrides:next};setZoneElements(p=>({...p,[k]:elems}));}}
                      imsInventory={imsInventory}
                      flowerPatterns={(dealCheckData||studioFloralData)?.flowerPatterns||recipeOnlyPatterns}
                      qtyMultiplier={el.qty||1}
                      dealAwareness={{getRemaining:(itemId)=>remainingForItem(itemId,k,idx)}}
                      onCheckAvailability={(cItem,onPick)=>openAvailModal(null,null,{invId:cItem.id,name:cItem.name},null,onPick)}
                      rcSubcatFactors={rcSubcatFactors}
                      rcFactorByKey={rcFactorByKey}
                      mandiCatalogue={(dealCheckData||studioFloralData)?.mandiCatalogue||[]} studioMarkup={Number((dealCheckData||studioFloralData)?.defaultStudioMarkup)||3} elSize={el.size}
                      floralRatio={floralRatio} rcFloralModeByKey={rcFloralModeByKey} floralSettings={(dealCheckData||studioFloralData)||{}}
                      textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                    />}
                  </div>);
                })}
              </div>
                {(zoneElements[k]||[]).length>0&&showCosts&&<div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0 0",fontWeight:700,color:textP}}>{fmt(calcElsCost(zoneElements[k],true,zoneConfig[k]))}</div>}
              </div>}
            </div>
          ) : (
            <div style={{background:isDark?"rgba(255,255,255,0.03)":"#FAFAFB",border:`1px dashed ${border}`,borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <div style={{fontSize:12.5,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:7}}><IconCamera size={12}/>Select a photo above to load element pricing</div>
              <div style={{fontSize:11.5,color:textS,marginTop:3,lineHeight:1.4}}>Pick a library photo with an element card — items, quantities, and Rate Card pricing will load automatically</div>
            </div>
          ))}

          {/* Print — a print job (Flex/Vinyl/Sunboard etc.). Stored on zoneConfig[k].prints so it
              free-rides every existing zoneConfig save/load/copy path without needing its own
              persistence plumbing (mirrors Library's ManageLibrary.jsx). Linking a print row to an
              inventory element is optional, not required — a print isn't always for something
              already in Inventory (e.g. a custom banner/backdrop graphic). */}
          {zoneSection[k]==="print"&&<div style={{background:isDark?"#12121F":"#F9F9F6",borderRadius:10,padding:"9px 12px",marginBottom:10,border:`1px solid ${border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11.5,fontWeight:600,color:"#0369A1",display:"flex",alignItems:"center",gap:6}}><IconPrinter size={12}/>Print</div>
              <button onClick={()=>{
                const entry={id:"PR"+Date.now()+Math.floor(Math.random()*1000),material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,refImageUrl:"",invId:null};
                setZoneConfig(p=>({...p,[k]:{...(p[k]||{}),prints:[...((p[k]||{}).prints||[]),entry]}}));
              }} style={{padding:"4px 10px",borderRadius:8,border:"1px solid #0EA5E9",background:"rgba(14,165,233,0.14)",color:"#0EA5E9",fontSize:11.5,fontWeight:600,cursor:"pointer"}}>+ Add Print Row</button>
            </div>
            {(()=>{
              // Opens with one ready-to-edit blank row instead of a "no prints" empty state — purely
              // visual (not written to zoneConfig) until the user actually edits it, so leaving it
              // untouched never persists an empty row.
              const rows=((zoneConfig[k]||{}).prints||[]).length===0
                ? [{id:"__phantom__",material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,refImageUrl:"",invId:null}]
                : (zoneConfig[k]||{}).prints;
              return (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {rows.map((p,pi)=>{
                  const isPhantom=p.id==="__phantom__";
                  const invItem=p.invId?(imsInventory||[]).find(i=>i.id===p.invId):null;
                  const thumbSrc=invItem?.img||invItem?.photoUrls?.[0];
                  const mat=(imsPrintMaterials||[]).find(m=>m.id===p.material);
                  const sqft=(Number(p.areaW)||0)*(Number(p.areaD)||0);
                  const rate=mat?.ratePerSqft||0;
                  const cost=sqft*rate;
                  const setPrint=(patch)=>{
                    if(isPhantom){setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:[{...p,...patch,id:"PR"+Date.now()+Math.floor(Math.random()*1000)}]}}));return;}
                    setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:(prev[k]?.prints||[]).map((x,i)=>i===pi?{...x,...patch}:x)}}));
                  };
                  const removePrint=()=>setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:(prev[k]?.prints||[]).filter((_,i)=>i!==pi)}}));
                  const linkQ=zonePrintSearch[p.id]||"";
                  return <div key={p.id} style={{padding:"7px 9px",borderRadius:8,background:isDark?"rgba(14,165,233,0.06)":"rgba(14,165,233,0.05)",border:"1px solid rgba(14,165,233,0.25)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <select value={p.material||""} onChange={e=>setPrint({material:e.target.value})} style={{...S.select,fontSize:11.5,padding:"3px 6px",width:"auto"}}>
                        <option value="">Material…</option>
                        {(imsPrintMaterials||[]).map(m=><option key={m.id} value={m.id}>{m.name} (₹{m.ratePerSqft}/sqft)</option>)}
                      </select>
                      <input type="number" min="0" step="0.1" value={p.areaW||""} onChange={e=>setPrint({areaW:parseFloat(e.target.value)||0})} placeholder="W ft" style={{...S.input,fontSize:11.5,padding:"3px 6px",width:56,marginBottom:0,textAlign:"center"}} />
                      <span style={{fontSize:11.5,color:textS}}>×</span>
                      <input type="number" min="0" step="0.1" value={p.areaD||""} onChange={e=>setPrint({areaD:parseFloat(e.target.value)||0})} placeholder="D ft" style={{...S.input,fontSize:11.5,padding:"3px 6px",width:56,marginBottom:0,textAlign:"center"}} />
                      <span style={{fontSize:11.5,color:textS}}>ft = {sqft?sqft.toFixed(1):0} sqft</span>
                      {showCosts&&<span style={{fontSize:12,fontWeight:700,color:"#0EA5E9",marginLeft:"auto"}}>{rate>0?fmt(cost):"— pick material"}</span>}
                      {!isPhantom&&<span onClick={removePrint} style={{cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12.5}}>×</span>}
                    </div>
                    {/* Two OPTIONAL fields side by side — they were stacked full-width, making every print
                        row ~3 rows tall for fields most jobs leave blank. */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:7,alignItems:"start"}}>
                      <div>
                    <input value={p.refImageUrl||""} onChange={e=>setPrint({refImageUrl:e.target.value})} placeholder="Reference image URL (optional)" style={{...S.input,fontSize:11.5,padding:"3px 8px",marginTop:6,marginBottom:0,width:"100%"}} />
                    {p.refImageUrl&&<img src={p.refImageUrl} alt="" style={{marginTop:6,width:"100%",maxHeight:100,objectFit:"cover",borderRadius:6}} onError={e=>{e.target.style.display="none";}} />}
                      </div>
                      <div style={{position:"relative"}}>
                    {/* Optional link to an inventory element — for cross-reference only, never required */}
                    {p.invId ? (
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:20,height:20,borderRadius:4,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {thumbSrc?<img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{opacity:0.3,display:"flex"}}><IconBox size={12}/></span>}
                        </div>
                        <span style={{fontSize:11.5,color:invItem?textS:"#F59E0B",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{invItem?invItem.name:`⚠ ${p.invId} not in IMS`}</span>
                        <span onClick={()=>setPrint({invId:null})} style={{cursor:"pointer",color:textS,fontSize:11,textDecoration:"underline"}}>Unlink</span>
                      </div>
                    ) : (
                      <div>
                        <input value={linkQ} onChange={e=>setZonePrintSearch(prev=>({...prev,[p.id]:e.target.value}))} placeholder="Link to an inventory item (optional)" style={{...S.input,fontSize:11.5,padding:"3px 8px",width:"100%",marginBottom:0}} />
                        {linkQ.trim() && (()=>{
                          const tokens=linkQ.toLowerCase().trim().split(/\s+/).filter(Boolean);
                          const matches=(imsInventory||[]).filter(it=>tokens.every(t=>(it.name+" "+(it.subCat||it.subcategory||"")+" "+(it.cat||"")).toLowerCase().includes(t))).slice(0,40);
                          return <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:260,overflowY:"auto"}}>
                            {matches.length===0&&<div style={{padding:"8px 10px",fontSize:11.5,color:textS}}>No matches</div>}
                            {matches.map(it=>{
                              const src=it.img||it.photoUrls?.[0];
                              return <div key={it.id} onClick={()=>{
                                const toFt=(v,u)=>(Number(v)||0)*({Feet:1,Inches:1/12,Cm:1/30.48,Metre:3.28084}[u]||1);
                                const patch={invId:it.id};
                                if(!p.areaW&&!p.areaD){if(it.printW)patch.areaW=toFt(it.printW,it.printUnit);if(it.printL)patch.areaD=toFt(it.printL,it.printUnit);}
                                setPrint(patch);
                                setZonePrintSearch(prev=>({...prev,[p.id]:""}));
                              }} style={{padding:"8px 10px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:32,height:32,borderRadius:6,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{opacity:0.3,display:"flex"}}><IconBox size={15}/></span>}
                                </div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{it.name}</div>
                                  <div style={{fontSize:11,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}{it.printW?" · print area on file":""}</div>
                                </div>
                              </div>;
                            })}
                          </div>;
                        })()}
                      </div>
                    )}
                      </div>
                    </div>{/* /optional-fields grid */}
                  </div>;
                })}
                {showCosts&&((zoneConfig[k]||{}).prints||[]).length>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700,paddingTop:4}}>
                  <span style={{color:textP}}>Print Total</span>
                  <span style={{color:"#0EA5E9"}}>{fmt(((zoneConfig[k]||{}).prints||[]).reduce((sum,p)=>{const m=(imsPrintMaterials||[]).find(x=>x.id===p.material);const s=(Number(p.areaW)||0)*(Number(p.areaD)||0);return sum+s*(m?.ratePerSqft||0);},0))}</span>
                </div>}
              </div>
              );
            })()}
          </div>}

          {/* Zone structure — always visible, costs hidden behind toggle */}
          {/* No `zoneConfig[k] &&` guard: a zone that has never been touched has no config entry, and
              requiring one meant clicking Truss or Platform highlighted the tile and then rendered
              nothing at all. The form now opens blank on an empty object and the setters below
              create the entry on the first keystroke — calcStructCost already returns all-zero for
              an untouched config, and every field reads through `|| {}`. */}
          {(zoneSection[k]==="truss"||zoneSection[k]==="platform")&&(()=>{
            const zm=zoneMeta[k],zc=zoneConfig[k]||{},st=calcStructCost(k,zc,structRates);
            const dl={L:"Depth",W:"Width",H:"Height",S:"Size"};
            const sZ=u=>{setActiveZones([]);setZoneConfig(p=>({...p,[k]:{...p[k],...u}}));};
            const sD=(d,v)=>{setActiveZones([]);setZoneConfig(p=>{const cur=p[k]||{};const dims={...(cur.dims||{}),[d]:parseFloat(v)||0};
              // 3 dims filled ⇒ Box, exactly 2 ⇒ Single U — keep the toggle + pricing in sync with the dims.
              const n=[dims.W,dims.L,dims.H].filter(x=>(Number(x)||0)>0).length;const trT=n>=3?"box":n===2?"singleU":cur.trT;
              return {...p,[k]:{...cur,dims,trT}};});};
            const sFD=(d,v)=>{setActiveZones([]);setZoneConfig(p=>({...p,[k]:{...p[k],floorDims:{...(p[k]?.floorDims||{}),[d]:parseFloat(v)||0}}}));};
            const fd=zc.floorDims||{};
            return(<div style={{background:isDark?"#12121F":"#F9F9F6",borderRadius:10,padding:"10px 14px",marginBottom:10,border:`1px solid ${border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",minWidth:0}}>
                  <span style={{fontSize:12.5,fontWeight:700,color:textP,display:"inline-flex",alignItems:"center",gap:7}}><IconRuler size={13}/>Zone Structure</span>
                  {/* What adds up to the total on the right. Only the parts that cost something —
                      listing the zeros was what made the old chip row noise. calcStructCost returns
                      each of these separately and sums them into st.total, so the sum shown here is
                      the sum being charged, not a re-derivation. */}
                  {showCosts&&(()=>{
                    const parts=[["Truss",st.truss],["Masking",st.masking],["Platform",st.platform],["Carpet",st.carpet],
                      ["Arches",st.arches],["Pillars",st.pillars],["Glass",st.glass]].filter(([,v])=>(v||0)>0);
                    if(!parts.length) return null;
                    return <span style={{fontSize:10.5,color:textS,fontWeight:400}}>
                      {parts.map(([l,v])=>`${l} ${fmt(v)}`).join("  +  ")}
                    </span>;
                  })()}
                </div>
                {showCosts&&<div style={{fontSize:13,fontWeight:700,color:textP,flexShrink:0}}>{fmt(st.total)}</div>}
              </div>
              {/* The "Includes" summary chip row was removed — it restated the per-section costs the
                  cards below already show, and the panel header's own total covers the roll-up. */}
              {/* ── TRUSS (with masking nested inside it) → then the floor card ── */}
              
              {zoneSection[k]==="truss"&&<TrussStack S={S} customCeilingField={customCeilingField} k={k} zc={zc} zm={zm} st={st} sZ={sZ} sD={sD} fmt={fmt} showCosts={showCosts}
                isDark={isDark} border={border} textP={textP} textS={textS} accent={accent}
                customMaskingField={customMaskingField} maskOpts={maskingOptions(imsMaskingRates)} trussRates={imsTrussRates} />}
              {/* ── PLATFORM + CARPET → then floor dims ── */}
              {zoneSection[k]==="platform"&&<FloorStack S={S} zc={zc} zm={zm} st={st} sZ={sZ} sFD={sFD} fd={fd} fmt={fmt} showCosts={showCosts}
                isDark={isDark} border={border} textP={textP} textS={textS} imsCarpetMaterials={imsCarpetMaterials} />}
            </div>);
          })()}
          </Fragment>}

          {/* §26.13 — Production/Buying custom items in this zone */}
          {!isCollapsed(k) && dcCustomItems.filter(ci => ci.fnIdx === (activeFnIdx||0) && ci.zoneKey === k).length > 0 && (
            <div style={{marginTop:10,marginBottom:4}}>
              {dcCustomItems.filter(ci => ci.fnIdx === (activeFnIdx||0) && ci.zoneKey === k).map(ci => {
                const isP = ci.type === "production";
                const ciColor = isP ? "#A855F7" : "#F59E0B";
                const ciIcon = isP ? <IconFactory size={16}/> : <IconCart size={16}/>;
                const unitCost = ci.manualPrice || ci.refPrice || 0;
                return (
                  <div key={ci.id} style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${ciColor}30`,background:isDark?`${ciColor}08`:`${ciColor}06`,marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                    <span style={{display:"flex"}}>{ciIcon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12.5,fontWeight:600,color:textP}}>{ci.subCat} <span style={{fontSize:11,padding:"1px 6px",borderRadius:4,background:`${ciColor}15`,color:ciColor,fontWeight:700}}>{isP?"PRODUCTION":"BUYING"}</span></div>
                      <div style={{fontSize:11.5,color:textS,marginTop:2}}>× {ci.qty}{ci.dims.l?` · ${ci.dims.w}W × ${ci.dims.l}D × ${ci.dims.h}H ft`:""}{ci.notes?` · ${ci.notes}`:""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:700,color:ciColor}}>₹{Math.round(unitCost * (Number(ci.qty)||1)).toLocaleString("en-IN")}</div>
                      {ci.qty > 1 && <div style={{fontSize:11,color:textS}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {ci.qty}</div>}
                    </div>
                    <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))} style={{padding:"4px 8px",borderRadius:6,border:`1px solid #E11D4820`,background:"#E11D4810",color:"#E11D48",fontSize:12,cursor:"pointer",fontWeight:600}}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
          {/* ═══ CLIENT NOTES per element — hidden behind a small icon until opened (or if a note exists) ═══ */}
          {(notesOpen[k] || elNotes[k]) ? (
            <div style={{marginTop:10,background:elNotes[k]?(isDark?"rgba(201,169,110,0.06)":"#FFFDF7"):"transparent",borderRadius:10,padding:"10px 12px",border:`1px solid ${elNotes[k]?textP+"40":border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{display:"flex",color:textS}}><IconNote size={12}/></span>
                <span style={{fontSize:12,fontWeight:600,color:elNotes[k]?textP:textS}}>Client Notes</span>
                {elNotes[k]&&<span style={{fontSize:11,padding:"1px 6px",borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS}}>Will appear in PPT</span>}
                {!elNotes[k]&&<span onClick={()=>setNotesOpen(p=>({...p,[k]:false}))} title="Close" style={{marginLeft:"auto",cursor:"pointer",color:textS,fontSize:14,lineHeight:1}}>×</span>}
              </div>
              <textarea autoFocus={!!notesOpen[k]&&!elNotes[k]} value={elNotes[k]||""} onChange={e=>setElNotes(p=>({...p,[k]:e.target.value}))}
                placeholder={`e.g. "Remove couch from stage", "Use only white roses", "Client wants minimal lighting"...`}
                style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#12121F":"#fff",color:textP,fontSize:12.5,outline:"none",resize:"vertical",minHeight:36,maxHeight:100,boxSizing:"border-box",fontFamily:"inherit"}}/>
            </div>
          ) : (
            <div style={{marginTop:10}}>
              <span onClick={()=>setNotesOpen(p=>({...p,[k]:true}))} title="Add a client note (shows in the PPT)" style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:12,fontWeight:600,color:textS,padding:"4px 10px",borderRadius:8,border:`1px dashed ${border}`}}><IconNote size={11}/> Add note</span>
            </div>
          )}

        </div>}
      </div>);
    })}

    {/* ═══ CUSTOM ZONES (non-duplicates only — duplicates render in main loop above) ═══ */}
    {customZones.filter(cz=>!cz.sourceType).map(cz=>{
      const k=cz.id;const isOn=enabledEls[k];
      const czElCost=calcElsCost(zoneElements[k],true,zoneConfig[k]);
      const czStructCost=zoneConfig[k]?calcStructCost(k,zoneConfig[k],structRates).total:0;
      const czTotal=czElCost+czStructCost;
      return(<div key={k} id={`zone-${k}`} style={{background:isOn?cardBg:isDark?"#12121F":"#FAFAFA",borderRadius:16,border:isOn?`2px solid #444`:`2px solid ${border}`,marginBottom:14,overflow:"hidden"}}>
        {/* Same rule as the standard zone header above — Details is the only collapse control. */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",cursor:isOn?"default":"pointer"}} onClick={()=>{ if(!isOn) setEnabledEls(p=>({...p,[k]:!p[k]})); }}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:22,display:"flex",alignItems:"center"}}>{cz.icon||<IconBox size={20}/>}</span>
            <div style={{fontSize:15,fontWeight:600,color:isOn?textP:textS}}>{cz.name}</div>
            <span style={{fontSize:11,padding:"2px 8px",borderRadius:6,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS}}>Custom</span>
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleZoneCollapse(k);}} title={isCollapsed(k)?"Show details & pricing":"Hide details & pricing"} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11.5,fontWeight:600,color:isCollapsed(k)?textS:accent,padding:"3px 9px",borderRadius:9,border:`1px solid ${isCollapsed(k)?border:accent+"60"}`,background:isCollapsed(k)?"transparent":accent+"12",flexShrink:0,whiteSpace:"nowrap"}}><span style={{display:"inline-flex",transform:isCollapsed(k)?"rotate(-90deg)":"none",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span>Details</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {isOn&&showCosts&&<div style={{fontSize:14,fontWeight:700,color:textP}}>{fmt(czTotal)}</div>}
            <div style={{width:44,height:26,borderRadius:13,background:isOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}} onClick={e=>{e.stopPropagation();setEnabledEls(p=>({...p,[k]:!p[k]}));}}><div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isOn?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/></div>
            <span title={`Remove ${cz.name}`} onClick={e=>{e.stopPropagation();askConfirm(`Remove ${cz.name}?`,()=>{setCustomZones(p=>p.filter(z=>z.id!==k));setEnabledEls(p=>{const n={...p};delete n[k];return n;});setZoneElements(p=>{const n={...p};delete n[k];return n;});setZoneConfig(p=>{const n={...p};delete n[k];return n;});showMsg(`✓ ${cz.name} removed`,"green");});}} style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700}}>✕</span>
          </div>
        </div>
        {isOn&&!isCollapsed(k)&&<div style={{padding:"0 18px 16px"}}>
          {/* Element card — add items from Rate Card */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div onClick={()=>toggleElCard(k)} title={isElCardOpen(k)?"Hide the item list":"Show the item list"} style={{fontSize:11,fontWeight:600,color:"#666",cursor:"pointer",display:"flex",alignItems:"center",gap:5,userSelect:"none"}}>
                    <span style={{display:"flex",color:"#999",transform:isElCardOpen(k)?"none":"rotate(-90deg)",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span>
                    <IconClipboard size={12}/> Items — {cz.name}
                    {!isElCardOpen(k)&&elCardSummary(k)}
                  </div>
              {isElCardOpen(k)&&<div style={{position:"relative"}}>
                <input value={zoneElSearch[k]||""} onChange={e=>setZoneElSearch(p=>({...p,[k]:e.target.value}))} placeholder="+ Add element..." style={{...S.input,fontSize:10,padding:"3px 8px",width:140,marginBottom:0}} onFocus={()=>setZoneElSearch(p=>({...p,[k]:""})) } />
                {(zoneElSearch[k]||"").length>=1&&(()=>{
                  const q=(zoneElSearch[k]||"").toLowerCase();
                  // A kit's own components are already covered by that kit — don't offer adding
                  // one separately (would double the item and double its cost).
                  const kitCoveredIds=new Set((zoneElements[k]||[]).filter(el=>el.invId).flatMap(el=>{
                    const it=(imsInventory||[]).find(i=>i.id===el.invId);
                    const comps=Array.isArray(el.kitOverrides)?el.kitOverrides:(it?.subItems||[]);
                    return comps.map(c=>c.itemId);
                  }));
                  // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                  // (Rate Card is not consulted here — see getElPriceFromInventory /
                  // getElPriceFromPattern in StudioApp.jsx).
                  const invMatches=(imsInventory||[]).filter(it=>!(zoneElements[k]||[]).find(el=>el.invId===it.id)&&!kitCoveredIds.has(it.id)&&!isHiddenSubcat(it,rcSubcatFactors)&&(it.name.toLowerCase().includes(q)||(it.cat||"").toLowerCase().includes(q)||(it.subCat||it.subcategory||"").toLowerCase().includes(q))).slice(0,8);
                  const patMatches=(recipeOnlyPatterns||[]).filter(pt=>!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)&&pt.name.toLowerCase().includes(q)).slice(0,4);
                  const matches=[...invMatches.map(it=>({kind:"inv",it})),...patMatches.map(pt=>({kind:"pat",pt}))].slice(0,8);
                  return matches.length>0?<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:340,overflowY:"auto",width:320}}>
                    {matches.map(m=>{
                      if(m.kind==="pat"){ const pt=m.pt; return <div key={"pat:"+pt.id}
                        onClick={()=>{
                          if(!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:pt.name,qty:1,unit:pt.unit,size:"",patternId:pt.id}]}));}
                          setZoneElSearch(prev=>({...prev,[k]:""}));
                        }}
                        style={{padding:"8px 10px",fontSize:11,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <span style={{fontSize:22,opacity:0.5}}>🌺</span>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pt.name}</span>
                            <span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700,flexShrink:0}}>🌺 RECIPE</span>
                          </div>
                          <div style={{fontSize:9,color:textS,marginTop:2}}>{pt.sub?pt.sub+" › ":""}Flower recipe — no inventory item</div>
                        </div>
                      </div>; }
                      const it=m.it; const isKit=Array.isArray(it.subItems)&&it.subItems.length>0; const src=it.img||it.photoUrls?.[0];
                      const remaining=remainingForItem(it.id,k); const isBlocked=remaining!=null&&remaining<=0;
                      return <div key={"inv:"+it.id}
                        onClick={()=>{
                          if(isBlocked) return;
                          if(!(zoneElements[k]||[]).find(el=>el.invId===it.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:it.name,qty:1,unit:it.unit,size:"",invId:it.id}]}));}
                          setZoneElSearch(prev=>({...prev,[k]:""}));
                        }}
                        style={{padding:"8px 10px",fontSize:11,cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10,opacity:isBlocked?0.45:1}}>
                        <ItemHoverThumb src={src} size={56} name={it.name} sub={(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › "+(it.cat||""):it.cat} dims={itemDimsText(it)} border={border} cardBg={cardBg} textP={textP} textS={textS} emptyBg={isDark?"#1a1a2e":"#eee"} />
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</span>
                            {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700,flexShrink:0}}>KIT</span>}
                            {isBlocked&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>fully used in this event</span>}
                            {!isBlocked&&remaining!=null&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
                          </div>
                          <div style={{fontSize:9,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}</div>
                        </div>
                      </div>;
                    })}
                  </div>:<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:10,color:textS,width:320}}>No matches</div>;
                })()}
              </div>}
            </div>
            {isElCardOpen(k)&&(zoneElements[k]||[]).length>0&&<div style={{background:isDark?"#12121F":"#FAFAFA",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <div className="el-grid" style={{"--el-cols":railsOpen?4:6}}>
              {groupedEls(k).map(({ el, idx, isKit, firstKit }) => {
                const priceInfo = getElPrice(el, zoneConfig[k], { checkAvailability: true });
                const rc = priceInfo.rc;
                const hasSizes = rcIsSMB(rc);
                const isTrussSqft = rc && rc.unit === "truss_sqft";
                const rawUp = priceInfo.unitPrice;
                const adjUp = applyFloralRatio(rawUp, rc);
                const lineTotal = isTrussSqft
                  ? applyFloralRatio(priceInfo.lineCost, rc)
                  : (el.qty||0) * adjUp;
                const invItem = el.invId ? (imsInventory||[]).find(i=>i.id===el.invId) : null;
                const thumbItem = invItem || (imsInventory||[]).find(i=>i.name===el.name);
                const thumbSrc = thumbItem?.img || thumbItem?.photoUrls?.[0];
                const thumbKey = `${k}:${idx}`;
                const isUnavail = !!el.invId && typeof priceInfo.available==="number" && priceInfo.available<=0 && (el.qty||0)>0;
                return (
                  <div key={idx} className="el-row" data-kit={isKit?"1":"0"} style={{display:"flex",flexDirection:"column",gap:6,padding:"9px 10px",borderRadius:12,border:`1px solid ${isDark?"rgba(255,255,255,0.09)":"rgba(26,26,46,0.10)"}`,background:cardBg,gridColumn:isKit?(firstKit?`1 / span ${railsOpen?2:3}`:`span ${railsOpen?2:3}`):"span 1",minHeight:isKit?undefined:98,justifyContent:isKit?"flex-start":"space-between"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                      <div style={{position:"relative",flexShrink:0}}
                        onMouseEnter={(e)=>{
                          if(!thumbSrc) return;
                          const r=e.currentTarget.getBoundingClientRect();
                          const POP=164;
                          const openUp=window.innerHeight-r.bottom<POP+8 && r.top>POP+8;
                          setElThumbHover({key:thumbKey,openUp,top:openUp?undefined:r.bottom+4,bottom:openUp?window.innerHeight-r.top+4:undefined,left:Math.min(r.left,window.innerWidth-168)});
                        }}
                        onMouseLeave={()=>setElThumbHover(null)}>
                        {thumbSrc ? <img src={thumbSrc} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover",cursor:"zoom-in"}}/> : <div style={{width:20,height:20,borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}><IconBox size={11}/></div>}
                        {elThumbHover?.key===thumbKey && thumbSrc && (
                          <div style={{position:"fixed",top:elThumbHover.top,bottom:elThumbHover.bottom,left:elThumbHover.left,zIndex:10000,width:160,height:160,borderRadius:8,overflow:"hidden",border:`2px solid ${border}`,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",pointerEvents:"none"}}>
                            <img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          </div>
                        )}
                      </div>
                      <span title={isUnavail?"Not available for this date — tap the stock icon to pick a different item":undefined} style={{fontSize:12,fontWeight:500,color:isUnavail?"#EF4444":(rc||el.invId||el.patternId)?textP:"#F59E0B",textDecoration:isUnavail?"line-through":"none",minWidth:0,whiteSpace:"normal",overflowWrap:"anywhere"}}>{invItem?.name || el.name}</span>
                        {showCosts&&<span title="Rate per unit" style={{flexShrink:0,fontSize:10,fontWeight:600,color:textS,whiteSpace:"nowrap"}}>{adjUp>0?`₹${adjUp.toLocaleString("en-IN")}/${isTrussSqft?"truss sqft":(invItem?.unit||rc?.unit||el.unit)}`:"₹0"}</span>}
                      {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700}}>KIT</span>}
                      {!rc&&!el.invId&&!el.patternId&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700}}>NEW</span>}
                      {el.invId&&priceInfo.warning&&<span title={priceInfo.warning} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700}}>⚠ short</span>}
                      {(rc||el.invId)&&<span onClick={()=>openAvailModal(k, idx, el, rc)} title={isUnavail?"Not available for this date — tap to pick a different item":"Check stock availability & pick an item"} style={{cursor:"pointer",fontSize:isUnavail?13:11,opacity:isUnavail?1:0.5,padding:isUnavail?"1px 3px":"0 1px",borderRadius:4,background:isUnavail?"rgba(239,68,68,0.15)":"transparent",lineHeight:1}}>📦</span>}
                      {isTrussSqft&&priceInfo.area>0&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,0.12)",color:"#3B82F6",fontWeight:600}}>{priceInfo.area} sqft</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                      {hasSizes&&!priceInfo.isFloralBlend&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"M")===s?700:400,cursor:"pointer",background:(el.size||"M")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"M")===s?"#666":textS}}>{s}</button>)}
                      {priceInfo.isFloralBlend&&priceInfo.patternSMB&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"B")===s?700:400,cursor:"pointer",background:(el.size||"B")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"B")===s?"#666":textS}}>{s}</button>)}
                      {hasSizes&&!priceInfo.isFloralBlend&&<button onClick={()=>{const elems=[...(zoneElements[k]||[])];const used=new Set(elems.filter(e=>e.name===el.name).map(e=>e.size||"M"));const ns=["B","M","S"].find(s=>!used.has(s))||"B";elems.splice(idx+1,0,{...el,size:ns,qty:1});setZoneElements(p=>({...p,[k]:elems}));}} title="Split into another size (e.g. 3 Big + 2 Small)" style={{padding:"1px 6px",borderRadius:4,border:`1px dashed ${border}`,fontSize:9,fontWeight:600,cursor:"pointer",background:"transparent",color:accent}}>＋ size</button>}
                      {priceInfo.isFloralBlend&&<span style={{display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700}}>{"🌸"}<button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:typeof el.realPct==="number"?undefined:100};setZoneElements(p=>({...p,[k]:elems}));}} title={typeof el.realPct==="number"?"Priced at "+el.realPct+"% of the recipe's Studio rate — tap to go back to this sub-category's default ratio":"Using this sub-category's default real/artificial ratio — tap to price at 100% of the recipe's Studio rate"} style={floralPill(typeof el.realPct==="number")}>{typeof el.realPct==="number"?`${el.realPct}%`:"Ratio"}</button><input type="number" min="0" max="100" value={el.realPct??""} placeholder={String(priceInfo.realPct??"")} onChange={e=>{const v=e.target.value;const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:v===""?undefined:Math.max(0,Math.min(100,parseFloat(v)||0))};setZoneElements(p=>({...p,[k]:elems}));}} title="Manually set the exact % real — overrides Ratio/100%" style={{width:44,padding:"2px 6px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:11,textAlign:"center"}} /></span>}
                    </div>
                  </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                    {isTrussSqft ? (
                      <div style={{fontSize:11,fontWeight:600,color:textS,padding:"3px 8px",borderRadius:6,background:isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)",minWidth:64,textAlign:"center"}}>{priceInfo.area>0?`× ${priceInfo.area} sqft`:"× — sqft"}</div>
                    ) : (
                      <>
                        <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:Math.max(0,(el.qty||0)-1)};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>{"−"}</button>
                        <input type="number" min="0" value={el.qty||0} onChange={e=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:Math.max(0,parseInt(e.target.value)||0)};setZoneElements(p=>({...p,[k]:elems}));}} onFocus={e=>e.target.select()} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:(el.qty||0)>0?textP:textS,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit",MozAppearance:"textfield"}}/>
                        <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:(el.qty||0)+1};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                      </>
                    )}
                      </div>
                    {showCosts?<div style={{fontSize:13,fontWeight:600,color:lineTotal>0?textP:textS,textAlign:"left",whiteSpace:"nowrap"}}>{lineTotal>0?fmt(lineTotal):"—"}</div>:<span/>}
                    <span onClick={()=>{const elems=(zoneElements[k]||[]).filter((_,i)=>i!==idx);setZoneElements(p=>({...p,[k]:elems}));}} style={{marginLeft:"auto",cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12}}>×</span>
                  </div>
                  </div>
                  {isTrussSqft&&priceInfo.warning&&<div style={{fontSize:10,color:"#F59E0B",marginTop:4,padding:"4px 6px",borderRadius:4,background:"rgba(245,158,11,0.08)"}}>{priceInfo.warning}</div>}
                  {isKit&&<KitComponentsEditor
                    item={invItem}
                    overrides={el.kitOverrides}
                    onChange={(next)=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],kitOverrides:next};setZoneElements(p=>({...p,[k]:elems}));}}
                    imsInventory={imsInventory}
                    flowerPatterns={(dealCheckData||studioFloralData)?.flowerPatterns||recipeOnlyPatterns}
                    qtyMultiplier={el.qty||1}
                    dealAwareness={{getRemaining:(itemId)=>remainingForItem(itemId,k,idx)}}
                    onCheckAvailability={(cItem,onPick)=>openAvailModal(null,null,{invId:cItem.id,name:cItem.name},null,onPick)}
                    rcSubcatFactors={rcSubcatFactors}
                    rcFactorByKey={rcFactorByKey}
                    mandiCatalogue={(dealCheckData||studioFloralData)?.mandiCatalogue||[]} studioMarkup={Number((dealCheckData||studioFloralData)?.defaultStudioMarkup)||3} elSize={el.size}
                    floralRatio={floralRatio} rcFloralModeByKey={rcFloralModeByKey} floralSettings={(dealCheckData||studioFloralData)||{}}
                    textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                  />}
                </div>);
              })}
              </div>
              {showCosts&&<div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0 0",fontWeight:700,color:textP}}>Items: {fmt(czElCost)}</div>}
            </div>}
          </div>
          {/* Zone structure — FULL, same as standard zones */}
          {(()=>{
            const zc=zoneConfig[k]||{};
            const dims=zc.dims||{};
            const fd=zc.floorDims||{};
            const st=calcStructCost(k,zc,structRates);
            const sZ=u=>{setZoneConfig(p=>({...p,[k]:{...p[k],...u}}));};
            const sD=(d,v)=>{setZoneConfig(p=>{const cur=p[k]||{};const dims={...(cur.dims||{}),[d]:parseFloat(v)||0};
              // 3 dims filled ⇒ Box, exactly 2 ⇒ Single U — keep the toggle + pricing in sync with the dims.
              const n=[dims.W,dims.L,dims.H].filter(x=>(Number(x)||0)>0).length;const trT=n>=3?"box":n===2?"singleU":cur.trT;
              return {...p,[k]:{...cur,dims,trT}};});};
            const sFD=(d,v)=>{setZoneConfig(p=>({...p,[k]:{...p[k],floorDims:{...(p[k]?.floorDims||{}),[d]:parseFloat(v)||0}}}));};
            const mw={back:true,left:true,right:true};
            return <div style={{borderRadius:10,padding:"10px 14px",border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F9F9F9",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:textS}}><IconRuler size={11}/> Zone Structure</div>
                {showCosts&&st.total>0&&<div style={{fontWeight:600,color:textP}}>{fmt(st.total)}</div>}
              </div>
              {/* Truss type — Box vs Single U is set by how many dims are filled below (2 ⇒ Single
                  U, 3 ⇒ Box), so that choice is read-only here; "None" is the one real manual
                  action (turns truss off regardless of dims). */}
              <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
                {zc.trT&&<span style={{fontSize:10,fontWeight:600,color:textS}} title="Set by how many Truss dims are filled below — 2 dims = Single U, 3 dims = Box">{zc.trT==="box"?"Box Truss":"Single U Truss"}{showCosts?` · ₹${zc.trT==="box"?50:30}/sqft`:""}</span>}
                <button onClick={()=>sZ({trT:null})} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${!zc.trT?textP:border}`,background:!zc.trT?"rgba(0,0,0,0.06)":"transparent",color:!zc.trT?textP:textS,fontSize:10,cursor:"pointer",fontWeight:!zc.trT?600:400}}>None</button>
              </div>
              {/* Truss dims: L, W, H + Qty */}
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                {[["W","Width"],["L","Depth"],["H","Height"]].map(([d,label])=><div key={d} style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Truss {label} (ft)</div>
                  <input type="number" value={dims[d]||""} onChange={e=>sD(d,e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="0"/></div>)}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Truss Qty</div>
                  <input type="number" min={1} value={zc.trussQty||1} onChange={e=>sZ({trussQty:Math.max(1,parseInt(e.target.value)||1)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="1"/></div>}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}} title="Single-U extension on each front side, this many ft long. Priced as 2× Single U truss. Rare.">Front ext (ft/side)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExt||""} onChange={e=>sZ({trussFrontExt:Math.max(0,parseFloat(e.target.value)||0)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="0"/></div>}
                {zc.trT&&(Number(zc.trussFrontExt)||0)>0&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}} title="Height of the front extension (can differ from box height). Defaults to box height.">Ext height (ft)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExtH||""} onChange={e=>sZ({trussFrontExtH:Math.max(0,parseFloat(e.target.value)||0)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={String(zc.dims?.H||0)}/></div>}
              </div>
              {/* ── §23 Truss Type selector + Height-anchor validation (custom zone) ── */}
              {(()=>{
                const tr = resolveTrussConfig(zc);
                if (tr.source === "none") return null;
                if (tr.source === "invalid") {
                  return <div style={{marginBottom:8,padding:"6px 10px",borderRadius:8,background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.3)",fontSize:10,color:"#B91C1C",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>⚠️</span><span>{tr.error}</span>
                  </div>;
                }
                if (tr.source === "auto-3dim") {
                  return <div style={{marginBottom:8,padding:"5px 10px",borderRadius:8,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",fontSize:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{color:textS}}>Truss Type:</span>
                    <span style={{fontWeight:700,color:"#B91C1C"}}>Full Box <span style={{fontWeight:400,color:textS,fontSize:9}}>(auto · 3 dims)</span></span>
                  </div>;
                }
                const picked = zc.trussType;
                const opts = [
                  { id:"u_only",   label:"U Truss" },
                  { id:"half_box", label:"Half Box" },
                ];
                return <div style={{marginBottom:8,padding:"6px 10px",borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#FFFEF8",border:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:600,color:textS}}>Truss Type:</span>
                    {tr.source==="default-on-forget" && <span style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(217,119,6,0.12)",color:"#A16207",fontWeight:600}}>defaulted</span>}
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {opts.map(o=>{
                      const isOn = picked === o.id;
                      const isDefault = !picked && o.id === "half_box";
                      return <button key={o.id} onClick={()=>sZ({trussType:o.id})}
                        style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${isOn?textP:(isDefault?"rgba(217,119,6,0.4)":border)}`,background:isOn?"rgba(0,0,0,0.06)":(isDefault?"rgba(217,119,6,0.06)":"transparent"),color:isOn?textP:textS,fontSize:9,cursor:"pointer",fontWeight:isOn?700:(isDefault?600:400)}}>{o.label}</button>;
                    })}
                  </div>
                </div>;
              })()}
              {zc.trT && (
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap",fontSize:9}}>
                  <span style={{fontWeight:600,color:textS}}>Material:</span>
                  {TRUSS_MATERIALS.map(m=>{
                    const sel=(zc.trussMaterial|| "iron")===m.key;
                    return <span key={m.key} onClick={()=>sZ({trussMaterial:m.key})} style={{padding:"2px 7px",borderRadius:5,fontWeight:sel?700:400,cursor:"pointer",border:`1px solid ${sel?textP:border}`,background:sel?"rgba(0,0,0,0.06)":"transparent",color:sel?textP:textS}}>{m.label}</span>;
                  })}
                  {zc.trT==="box" && customCeilingField(k, zc, true)}
                </div>
              )}
              {zc.trT && (
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap",fontSize:9}}>
                  <span style={{fontWeight:600,color:textS}}>Density:</span>
                  {[{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o=>{
                    const sel=(zc.drapeDensity||"moderate")===o.v;
                    return <span key={o.v} onClick={()=>sZ({drapeDensity:o.v})} style={{padding:"2px 7px",borderRadius:5,fontWeight:sel?700:400,cursor:"pointer",border:`1px solid ${sel?"#EC4899":border}`,background:sel?"rgba(236,72,153,0.12)":"transparent",color:sel?"#9D174D":textS}}>{o.l}</span>;
                  })}
                </div>
              )}
              {showCosts&&st.truss>0&&<div style={{fontSize:10,color:textS,marginBottom:6}}>Truss: {fmt(st.truss)}</div>}
              {/* Masking */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}><span><IconWall size={11}/> Masking</span>
                  <div onClick={()=>sZ({mkOn:!zc.mkOn,mkWalls:zc.mkOn?{}:mw})} style={{width:30,height:16,borderRadius:8,background:zc.mkOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:zc.mkOn?16:2,transition:"left 0.2s"}}/></div>
                </div>{showCosts&&st.masking>0&&<span style={{fontWeight:600,fontSize:11,color:textP}}>{fmt(st.masking)}</span>}
              </div>
              {zc.mkOn&&<div style={{display:"flex",gap:4,marginBottom:6,paddingLeft:20,flexWrap:"wrap",alignItems:"center"}}>
                {maskingOptions(imsMaskingRates).map(o=><button key={o.id} onClick={()=>sZ({mkT:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.mkT===o.id?700:400,background:zc.mkT===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.mkT===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                {customMaskingField(k, zc, true)}
              </div>}
              {/* Platform */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,fontSize:11}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span><IconPlatform size={11}/> Platform</span>
                  {PLAT_OPTS.map(o=><button key={o.id} onClick={()=>sZ({plH:zc.plH===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.plH===o.id?700:400,background:zc.plH===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.plH===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                </div>{showCosts&&st.platform>0&&<span style={{fontWeight:600,color:textP}}>{fmt(st.platform)}</span>}
              </div>
              {/* Carpet */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,fontSize:11}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span><IconCarpet size={11}/> Carpet</span>
                  <select value={zc.cpT||defaultCarpetMatId(imsPrintMaterials)||""} onChange={e=>sZ({cpT:e.target.value})} style={{fontSize:10,padding:"2px 5px",borderRadius:5,border:`1px solid ${border}`,background:"#fff",color:"#111827"}}>
                    <option value={CARPET_OFF} style={{color:"#111827",background:"#fff"}}>— None —</option>
                    {(imsCarpetMaterials||[]).map(m=><option key={m.id} value={m.id} style={{color:"#111827",background:"#fff"}}>{m.name}{showCosts?` · ₹${m.ratePerSqft}/sqft`:""}</option>)}
                  </select>
                </div>{showCosts&&st.carpet>0&&<span style={{fontWeight:600,color:textP}}>{fmt(st.carpet)}</span>}
              </div>
              {/* Floor dims */}
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Floor Width (ft)</div>
                  <input type="number" value={fd.W||""} onChange={e=>sFD("W",e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={dims.W||"—"}/></div>
                <div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Floor Depth (ft)</div>
                  <input type="number" value={fd.L||""} onChange={e=>sFD("L",e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={dims.L||"—"}/></div>
                <div style={{flex:1,display:"flex",alignItems:"flex-end"}}><div style={{fontSize:9,color:textS}}>{(fd.L||fd.W)?`${fd.L||0}×${fd.W||0} = ${(fd.L||0)*(fd.W||0)} sqft`:"Uses truss L×W"}</div></div>
              </div>
            </div>;
          })()}
        </div>}
      </div>);
    })}

    {/* ═══ + ADD CUSTOM ZONE ═══ Pick a type to get a second Stage / Entry Passage / … that behaves
        like the original — photo strip, elements, truss, platform, pricing — which is what sourceType
        buys. Naming is automatic ("Stage (2)"), so the row is just the picker and the button; the old
        free-text name box read as a second, competing way to add a zone and only caused confusion. ═══ */}
    {(()=>{
      const srcLabel = newCzSrc ? (zoneLabelsD[newCzSrc]?.label || newCzSrc) : "";
      // Second copy is "(2)" — the seed zone itself is the implicit (1).
      const autoName = newCzSrc ? `${srcLabel} (${customZones.filter(cz=>cz.sourceType===newCzSrc).length+2})` : "";
      const addZone = () => {
        if (!newCzSrc) return;
        const id = "cz_"+Date.now();
        setCustomZones(p=>[...p,{id,name:autoName,sourceType:newCzSrc,icon:zoneLabelsD[newCzSrc]?.icon||""}]);
        setEnabledEls(p=>({...p,[id]:true}));
        setNewCzSrc("");
        showMsg(`✓ ${autoName} added`,"green");
        setTimeout(()=>document.getElementById(`zone-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"}),80);
      };
      return <div style={{borderRadius:12,border:`2px dashed ${border}`,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
        <select value={newCzSrc} onChange={e=>setNewCzSrc(e.target.value)} style={{width:190,padding:"8px 10px",borderRadius:9,border:`1px solid ${border}`,background:"#fff",color:"#111827",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>
          <option value="" style={{color:"#111827",background:"#fff"}}>Choose a zone…</option>
          {zoneKeys.map(zk=><option key={zk} value={zk} style={{color:"#111827",background:"#fff"}}>{zoneLabelsD[zk]?.label||zk}</option>)}
        </select>
        <button onClick={addZone} title={newCzSrc?`Adds "${autoName}" — same photos, elements and pricing as ${srcLabel}`:"Choose a zone first"} style={{...S.btn(!!newCzSrc),padding:"8px 16px",fontSize:11.5,opacity:newCzSrc?1:0.5,whiteSpace:"nowrap"}}>{newCzSrc?`+ Add ${autoName}`:"+ Add Zone"}</button>
      </div>;
    })()}

    {/* ═══ BUILD PAGE TOTAL — detailed breakdown ═══ */}
    {showCosts&&venue&&<div style={{background:"linear-gradient(135deg,#0F0F1A,#2d1b69)",borderRadius:16,padding:"20px 24px",color:"#fff",marginTop:24}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}><IconPlatform size={12}/> Decor (all zones)</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(totalCost())}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}>Transport ({transportCalc.trucks} trucks + genset)</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(transportCalc.total)}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:14,fontWeight:700,color:"#C9A96E"}}>Grand Total</span>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:28,fontWeight:700}}>{fmt(grandTotal)}</div>
          <span style={{fontSize:11,padding:"3px 12px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
        </div>
      </div>
    </div>}

    {/* ── §23 Soft truss validation summary (warns but doesn't block nav) ── */}
    {(()=>{
      const invalidZones = [];
      Object.entries(zoneConfig||{}).forEach(([zk,zc])=>{
        if (!enabledEls[zk]) return;
        const tr = resolveTrussConfig(zc);
        if (tr.source === "invalid") {
          const label = zoneMeta[zk]?.label || (customZones.find(cz=>cz.id===zk)?.name) || zk;
          invalidZones.push({ zk, label, error: tr.error });
        }
      });
      if (invalidZones.length === 0) return null;
      return <div style={{marginTop:20,padding:"12px 16px",borderRadius:10,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.25)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:16}}>⚠️</span>
          <span style={{fontSize:13,fontWeight:700,color:"#B91C1C"}}>Truss dimensions incomplete in {invalidZones.length} zone{invalidZones.length>1?"s":""}</span>
        </div>
        <div style={{fontSize:11,color:"#7F1D1D",lineHeight:1.5}}>
          {invalidZones.map(z => <div key={z.zk}>• <strong>{z.label}</strong>: {z.error}</div>)}
        </div>
        <div style={{fontSize:10,color:"#A16207",marginTop:6,fontStyle:"italic"}}>You can continue, but the cost preview won't include truss for these zones until dimensions are fixed.</div>
      </div>;
    })()}

    {/* ═══ CORRECT PHOTO TAGS → save to master (full tagging, mirrors the Library editor) ═══ */}
    {correctPhoto && (()=>{
      const master = libItems.find(i=>i.id===correctPhoto.libId);
      const taxLabel=(key)=>({eventType:"Event type",venueType:"Venue type",areasElements:"Areas / zones",colorPalette:"Palette",categoryTier:"Category tier",tier:"Tier",designStyle:"Design style",timeSetting:"Time / setting"}[key]||key);
      const toggle=(key,val)=>setCorrectPhoto(p=>{const cur=p.tags?.[key]||[];const next=cur.includes(val)?cur.filter(x=>x!==val):[...cur,val];return {...p,tags:{...p.tags,[key]:next}};});
      const isNewMaster=!correctPhoto.libId;
      const save=async ()=>{
        if(!isNewMaster && !master){showMsg("Photo not found.","red");setCorrectPhoto(null);return;}
        const zk=correctPhoto.zoneKey;
        const elems=JSON.parse(JSON.stringify(zoneElements[zk]||master?.elements||[]));
        // Save the FULL zone build spec — dimensions, truss, masking, plinth, carpet, prints,
        // materials, custom ceiling/masking items — everything the salesperson set on this zone, so
        // reselecting the photo restores it exactly. Deal-specific choices (repeat discount, quantity
        // scale) are dropped so the template doesn't force them onto future quotes.
        const liveCfg=zoneConfig[zk];
        const zoneCfgMap={...(master?.zoneConfigByType||{})};
        let libDims=master?.dims;
        if(liveCfg){
          const {repeat,scale,...rest}=liveCfg;
          zoneCfgMap[zk]=JSON.parse(JSON.stringify(rest));
          // Mirror the primary dims into the master's Library-shape dims too, so browse thumbnails,
          // the Library editor and buildZoneConfig's fallback all reflect the corrected measurements.
          const d=liveCfg.dims||{},fd=liveCfg.floorDims||{};
          libDims={...(master?.dims||{}),
            trussL:d.L||0,trussW:d.W||0,trussH:d.H||0,floorL:fd.L||0,floorW:fd.W||0,
            plH:liveCfg.plH||master?.dims?.plH||"",cpT:liveCfg.cpT??master?.dims?.cpT??null,
            mkT:liveCfg.mkT||master?.dims?.mkT||"",mkWalls:liveCfg.mkWalls||master?.dims?.mkWalls||{},
            trussFrontExt:liveCfg.trussFrontExt||0,trussFrontExtH:liveCfg.trussFrontExtH||0,
            trussMaterial:liveCfg.trussMaterial??master?.dims?.trussMaterial??null,
            drapeDensity:liveCfg.drapeDensity??master?.dims?.drapeDensity??null,
            customCeilingItemId:liveCfg.customCeilingItemId??null,customMaskingItemId:liveCfg.customMaskingItemId??null};
        }
        // Keep the original verifier's credit — a later editor's correction updates tags/elements
        // but shouldn't steal the "verified by" attribution from whoever verified it first.
        const wasVerified=!!master?._verified;
        const stamp=wasVerified?{_lastEditedBy:authUser?.name||"—",_lastEditedAt:Date.now()}:{_verifiedBy:authUser?.name||"—",_verifiedAt:Date.now()};
        if(isNewMaster){
          // This photo wasn't a Library photo yet (fresh upload / event photo) — create one now.
          const newId="LIB"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
          const created={id:newId,url:correctPhoto.draftSrc,name:correctPhoto.name||"Untitled",tags:correctPhoto.tags,elements:elems,dims:libDims,zoneConfigByType:zoneCfgMap,addedAt:Date.now(),source:"build",_verified:true,...stamp,_correctedOn:"build"};
          // No mergeLibItems first — it writes libItemsRef, which saveLib diffs against to work out
          // what changed, so pre-merging made it compare `created` to itself and skip the write.
          // saveLib does the merge itself. Same bug as the Build photo upload in StudioApp.
          await saveLib([created]);
          // Point this zone's selection at the new Library entry going forward (same src, now backed by a real row).
          setElSelectedPhoto(p=>({...p,[zk]:{...p[zk],isLibrary:true,eventId:newId}}));
          logVerificationEvent?.({photoId:newId,photoName:created.name,source:"build"});
          showMsg("✅ Saved as a new Library photo — thanks!","green");
        } else {
          const corrected={...master,name:correctPhoto.name||master.name,tags:correctPhoto.tags,elements:elems,dims:libDims,zoneConfigByType:zoneCfgMap,_verified:true,...stamp,_correctedOn:"build"};
          await saveLib(libItems.map(i=>i.id===correctPhoto.libId?corrected:i));
          // Only the first verification counts as a contribution — re-corrections of an already-
          // verified photo update _lastEditedBy above but don't log again.
          if(!wasVerified) logVerificationEvent?.({photoId:correctPhoto.libId,photoName:corrected.name,source:"build"});
          showMsg("✅ Correction saved to master — thanks!","green");
        }
        // The zone strips read a CACHED server query, not libItems, so the write alone changes
        // nothing on screen. Bumping matchGen invalidates every cached zone set and refetches —
        // the corrected photo leaves its old strip and appears in the newly tagged one, live.
        setMatchGen(g => g + 1);
        // Refetching is not enough on its own: the strip pins the SELECTED photo even when the zone
        // no longer returns it, and the photo being corrected is always this zone's selection. If its
        // new tags no longer cover this zone, release the selection so it can actually leave.
        // zoneElements / zoneConfig stay — the elements were built by hand and are not the photo's.
        {
          const czSrcZ = customZones.find(cz => cz.id === zk);
          const areas = areaNamesFor(czSrcZ?.sourceType || zk);
          const tagged = correctPhoto.tags?.areasElements || [];
          const stillInZone = areas.length ? tagged.some(a => areas.includes(a)) : true;
          if (!stillInZone) setElSelectedPhoto(p => { const n = { ...p }; delete n[zk]; return n; });
        }
        setCorrectPhoto(null);
      };
      return <div onClick={()=>setCorrectPhoto(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.6)",display:"flex",justifyContent:"center",alignItems:"flex-start",overflow:"auto",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:cardBg,borderRadius:16,width:"100%",maxWidth:620,maxHeight:"90vh",overflow:"auto",border:`1px solid ${border}`,padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:15,fontWeight:700,color:textP}}>{isNewMaster?"✏️ Save photo to Library — tags, elements & zone details":"✏️ Correct photo — tags, elements & zone details"}</div>
            <span onClick={()=>setCorrectPhoto(null)} style={{fontSize:18,cursor:"pointer",color:textS,fontWeight:700}}>✕</span>
          </div>
          <div style={{fontSize:11,color:textS,marginBottom:12}}>{isNewMaster?"This photo isn't in the shared Library yet — add tags below and it'll become a reusable Library photo for everyone.":"Fix any tags below — they save to the shared library photo for everyone (future quotes)."} Your <b>element edits, zone dimensions and all structure details</b> (truss, masking, plinth, carpet, prints, materials) from the build card above are saved too. Quotes already given keep their own numbers.</div>
          <div style={{display:"flex",gap:12,marginBottom:12}}>
            {(master?.url||correctPhoto.draftSrc)&&<img src={master?.url||correctPhoto.draftSrc} alt="" style={{width:120,height:84,objectFit:"cover",borderRadius:10,flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:9,color:textS,marginBottom:3}}>Name</div>
              <input value={correctPhoto.name} onChange={e=>setCorrectPhoto(p=>({...p,name:e.target.value}))} style={{...S.input,fontSize:13,fontWeight:600}}/>
              <div style={{fontSize:9,color:textS,marginTop:6}}>{(zoneElements[correctPhoto.zoneKey]||master?.elements||[]).length} elements{(()=>{const c=zoneConfig[correctPhoto.zoneKey];if(!c)return "";const d=c.dims||{};const hasDims=(d.L||d.W||d.H||d.S);const nPrints=(c.prints||[]).length;const bits=[];if(hasDims)bits.push(`dims ${d.L||0}×${d.W||0}${d.H?"×"+d.H:""}`);if(c.trT)bits.push(c.trT);if(nPrints)bits.push(`${nPrints} print${nPrints>1?"s":""}`);return bits.length?` · ${bits.join(" · ")}`:"";})()} <span style={{color:accent}}>(saved from your edits above)</span></div>
            </div>
          </div>
          {/* Specific named venue (2-level: Inhouse / Outside) */}
          {(()=>{
            const curVenue=correctPhoto.tags?.venue||"";
            const setV=(val)=>setCorrectPhoto(p=>({...p,tags:{...p.tags,venue:val||""}}));
            const pill=(on)=>({padding:"3px 10px",borderRadius:8,fontSize:10,cursor:"pointer",fontWeight:on?700:500,border:`1px solid ${on?accent:border}`,background:on?`${accent}18`:"transparent",color:on?accent:textS});
            return <div style={{marginBottom:10}}>
              <div style={{fontSize:10,color:textS,marginBottom:3,fontWeight:600}}>Venue (specific)</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
                <span onClick={()=>setCorrVenueGrp("inhouse")} style={pill(corrVenueGrp==="inhouse")}>Inhouse</span>
                <span onClick={()=>setCorrVenueGrp("outside")} style={pill(corrVenueGrp==="outside")}>Outside</span>
                {curVenue&&<span onClick={()=>setV("")} style={{padding:"3px 9px",borderRadius:8,fontSize:9,cursor:"pointer",color:"#E11D48",border:`1px dashed ${border}`}}>✕ {curVenue}</span>}
              </div>
              {corrVenueGrp==="inhouse"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {azSort(leafInhouseVenues).map(vn=>{const on=curVenue===vn;return <span key={vn} onClick={()=>setV(on?"":vn)} style={{...pill(on),fontSize:9,padding:"3px 8px"}}>{vn}</span>;})}
              </div>}
              {corrVenueGrp==="outside"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {[...customOutdoor].sort((a,b)=>String(a?.name).localeCompare(String(b?.name))).map(o=>{const on=curVenue===o.name;return <span key={o.name} onClick={()=>setV(on?"":o.name)} style={{...pill(on),fontSize:9,padding:"3px 8px"}}>{o.name}{o.empanelled?" ★":""}</span>;})}
              </div>}
            </div>;
          })()}
          {Object.keys(taxonomy).filter(key=>Array.isArray(taxonomy[key])).map(key=>{
            const vals=key==="colorPalette"&&imsPaletteCatalogue.length>0?imsPaletteCatalogue.map(p=>p.name):taxonomy[key];
            return <div key={key} style={{marginBottom:8}}>
              <div style={{fontSize:10,color:textS,marginBottom:3,fontWeight:600}}>{taxLabel(key)}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(key==="tier"?(vals||[]):azSort(vals||[])).map(v=>{const sel=(correctPhoto.tags?.[key]||[]).includes(v);return <span key={v} onClick={()=>toggle(key,v)} style={{padding:"3px 9px",fontSize:10,borderRadius:8,cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{v}</span>;})}
              </div>
            </div>;
          })}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <button onClick={()=>setCorrectPhoto(null)} style={{...S.btn(false),fontSize:12}}>Cancel</button>
            <button onClick={save} style={{...S.btn(true),fontSize:12,background:"#7C3AED"}}><IconSave size={12}/> Save to master</button>
          </div>
        </div>
      </div>;
    })()}

    <div style={{display:"flex",justifyContent:"space-between",marginTop:32}}><button onClick={()=>setStep(1)} style={S.btn(false)}>← Browse</button><button onClick={()=>setStep(3)} style={S.btn(true)}>Summary →</button></div>

    {/* ── Per-element stock availability modal — image + free count only, pick one to book ── */}
    {availModal && (
      <div onClick={()=>setAvailModal(null)} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:isDark?"#12121F":"#fff",borderRadius:16,border:`1px solid ${border}`,width:"min(900px,95vw)",maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:textP}}><IconBox size={14}/> Availability — {availModal.elName}</div>
              <div style={{fontSize:11,color:textS,marginTop:2,letterSpacing:0.3}}>{availModal.subcat||"—"} · free on {availModal.date||"event date"} · tap to pick</div>
            </div>
            <span onClick={()=>setAvailModal(null)} style={{cursor:"pointer",fontSize:22,color:textS,lineHeight:1}}>×</span>
          </div>
          <div style={{padding:16,overflowY:"auto",flex:1}}>
            {availModal.loading ? (
              <div style={{padding:"48px 0",textAlign:"center",color:textS,fontSize:13}}>Loading availability…</div>
            ) : (availModal.items.length===0 ? (
              <div style={{padding:"48px 0",textAlign:"center",color:textS,fontSize:13}}>No inventory found in “{availModal.subcat||"this sub-category"}”.</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                {availModal.items.map(it=>{
                  const sel = availModal.selectedId===it.id;
                  const out = it.free<=0;
                  return (
                    <div key={it.id} onClick={()=>setAvailModal(m=>({...m,selectedId: sel?null:it.id}))} style={{cursor:"pointer",borderRadius:12,overflow:"hidden",border:`2px solid ${sel?"#059669":border}`,background:isDark?"#0F0F1A":"#FAFAFA",position:"relative"}}>
                      {sel&&<span style={{position:"absolute",top:6,left:6,zIndex:2,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,background:"#059669",color:"#fff"}}>✓</span>}
                      <div title="Free on the event date" style={{position:"absolute",top:6,right:6,zIndex:2,fontSize:12,fontWeight:800,minWidth:22,textAlign:"center",padding:"2px 7px",borderRadius:8,background:out?"rgba(239,68,68,0.92)":"rgba(16,185,129,0.92)",color:"#fff"}}>{it.free}</div>
                      {it.photo ? <img src={it.photo} alt="" style={{width:"100%",height:120,objectFit:"cover",display:"block",opacity:out?0.5:1}}/> : <div style={{width:"100%",height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,background:isDark?"#1a1a2e":"#eee"}}><IconBox size={22}/></div>}
                      <div style={{padding:"8px 10px"}}>
                        <div style={{fontSize:11,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                        {it.dims && <div style={{fontSize:9,color:textS,marginTop:2}}><IconRuler size={9}/> {it.dims}</div>}
                        <div style={{fontSize:11,fontWeight:700,color:accent,marginTop:2}}>{fmt(Math.round(it.price))}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{padding:"12px 20px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:textS}}>{availModal.onPick ? "Pick an item to swap this kit component to." : (availModal.selectedId ? "This item will be booked in Deal Check for this element." : "Pick an item to book it — or clear the current pin.")}</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setAvailModal(null)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveAvailPick} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#059669",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ═══ FULL-SCREEN PHOTO LIGHTBOX — tap any zone photo; ‹ › or arrow keys walk the set ═══ */}
    {lightbox && (()=>{
      const items = lightbox.items || [];
      const cur = items[lightbox.idx] || {};
      const many = items.length > 1;
      const navBtn = (side) => ({
        position:"absolute", [side]:12, top:"50%", transform:"translateY(-50%)",
        width:46, height:46, borderRadius:"50%", border:"1px solid rgba(255,255,255,0.25)",
        background:"rgba(0,0,0,0.45)", color:"#fff", fontSize:24, lineHeight:1, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", userSelect:"none",
      });
      return (
      <div onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"zoom-out"}}>
        <span onClick={()=>setLightbox(null)} style={{position:"absolute",top:16,right:20,fontSize:30,lineHeight:1,color:"#fff",cursor:"pointer",fontWeight:300}}>×</span>
        {many&&<span title="Previous (←)" aria-label="Previous photo" onClick={e=>{e.stopPropagation();lightboxStep(-1);}} style={navBtn("left")}>{"‹"}</span>}
        {many&&<span title="Next (→)" aria-label="Next photo" onClick={e=>{e.stopPropagation();lightboxStep(1);}} style={navBtn("right")}>{"›"}</span>}
        <img src={cur.src} alt={cur.name||""} onClick={e=>e.stopPropagation()} style={{maxWidth:"88vw",maxHeight:"88vh",objectFit:"contain",borderRadius:8,boxShadow:"0 20px 60px rgba(0,0,0,0.6)",cursor:"default"}}/>
        <div style={{position:"absolute",bottom:18,left:0,right:0,textAlign:"center",color:"#fff",fontSize:13,fontWeight:600,textShadow:"0 1px 4px rgba(0,0,0,0.8)"}}>
          {cur.name||""}{many&&<span style={{marginLeft:10,fontWeight:400,opacity:0.75}}>{lightbox.idx+1} / {items.length}</span>}
        </div>
      </div>);
    })()}
      </div>{/* /right column */}
      {PRICING_TILE&&(railsOpen
        ? <div style={{width:RAIL_W,flexShrink:0,position:"sticky",top:70,alignSelf:"flex-start"}}>{PRICING_TILE}</div>
        : railTab("right","Live estimate",<IconBolt size={14}/>))}
    </div>{/* /two-column shell */}
  </div>
  );
}

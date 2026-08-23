import { Fragment, useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { makeFilterUI, useRailMaxHeight } from "../../../components/studio/filterUI.jsx";
import { IconClipboard, IconPencil, IconRuler, IconBolt, IconWall, IconPlatform, IconCarpet, IconBulb, IconCheck,
  IconSearch, IconCamera, IconPrinter, IconNote, IconCalendar, IconFlower, IconFactory,
  IconCart, IconCopy, IconRepeat, IconAlert, IconPalette, IconChevron, IconSparkle,
  IconPlay, IconBox, IconSave, IconSliders, IconStar } from "../../../components/icons.jsx";
import {
  ZONE_TYPE_TO_AREA, getCat, taxOr, FUNCTIONS, CATEGORIES, venueTypeLabel,
  maskingOptions, platformOptions, defaultCarpetMatId, CARPET_OFF, TRUSS_MATERIALS, trussBaseArea, trussRateFor,
  platformRowCost,
} from "../../../lib/studio/taxonomy";
import { paletteNames, addPaletteInline } from "../../../lib/studio/colours";
import PaletteQuickAdd from "../../../components/studio/PaletteQuickAdd.jsx";
import { trussRowCost } from "../../../lib/studio/pricing";
import { paletteSearch, paletteMatches } from "../../../components/studio/filterUI.jsx";
import { resolveTrussConfig } from "../../../lib/studio/pricing";
import { qtyUsedElsewhereInBuild } from "../../../lib/studio/dealAvailability";
import { isHiddenSubcat } from "../../../lib/rateCard";
import { groupIdsForZones } from "../../../lib/studio/zoneGroups";
import { CUSTOM_ZONE_TAG_PREFIX } from "../../../lib/studio/keys.js";
import { makeS } from "../../../lib/studio/styles";
import { WASH_BANDS, GRAIN_URL } from "../../../lib/studio/pageWash";

// ═══ THE PANEL SHELL ═══
// Browse's left column, brought to Build so the two steps of the same flow are one product. Every
// number here is shared with it deliberately: the same curve, the same photograph, the same
// variable name (--sb-pw) so the header's transparent window works on both without a second set of
// rules. Only one of the two views is ever mounted, so they cannot collide.
const BD_CURVE = "M0,0 H1 C1,0.18 0.875,0.28 0.86,0.46 C0.845,0.66 1,0.82 1,1 H0 Z";
const BD_EDGE  = "M1,0 C1,0.18 0.875,0.28 0.86,0.46 C0.845,0.66 1,0.82 1,1";
const PANEL_BG =
  Object.values(import.meta.glob("../../../assets/ambria-panel-browse.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" }))[0] ||
  Object.values(import.meta.glob("../../../assets/ambria-panel.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" }))[0] ||
  null;
const PANEL_INK = "#F5F1E7";
import { sizeClassToPatternKey, resolveSizeKey } from "../../../lib/ims/flowerHelpers";
import { fixedVenueFor } from "../../../lib/ims/fixedVenues";
import { itemDimsText } from "../../../lib/ims/helpers";
import LazyYT from "../../../components/studio/LazyYT.jsx";
import KitComponentsEditor from "../../../components/shared/KitComponentsEditor";
import ItemHoverThumb from "../../../components/shared/ItemHoverThumb";
import InventoryItemPickerModal from "../../../components/shared/InventoryItemPickerModal";

// Temporary crowd-sourced library cleanup (Phase 1b). While true, anyone on the build screen
// can push a corrected element list back to the master library photo ("Save correction to
// master"). Flip to false (one-line deploy) once all photos are verified to remove the button.
const CORRECTION_MODE = true;

// Stable empty set for zones with no grouping selection — a fresh `new Set()` per render would
// change identity every time and defeat any memo downstream of it.
const EMPTY_SET = new Set();


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
export function TrussCard({ S, customCeilingField, k, zc, zm, st, sZ, sD, fmt, showCosts, isDark, border, textP, textS, accent, customMaskingField, maskOpts = [], trussRates, structRates, nested = false, title, onRemove, rowIdx }) {
  // What THIS truss structure costs. Same function the cost engine sums over every row, so the
  // figure on the card and the figure in the bill cannot drift.
  const rowCost = trussRowCost(zc, structRates || { trussRates });
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
  const rowCap = { fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: textP, flexShrink: 0, marginRight: 2 };
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
                  {/* THIS structure's own cost, not st.truss. st.truss is the zone's total across
                      every row, so it could only be shown on the first card — which left every
                      added truss with no price against it. Each card states its own; the zone total
                      is in the zone header and the Live Estimate. */}
                  {/* The ✕ gets a slot of its own that is reserved on EVERY card, empty on the
                      first. Rendering it only where it exists let it push the price left on the
                      extra cards, so the figures sat at two different x positions down the stack
                      and stopped reading as a column. */}
                  <span style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    {showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(rowCost.truss)}</span>}
                    <span style={{width:14,display:"inline-flex",justifyContent:"center",flexShrink:0}}>
                      {nested&&<span onClick={onRemove} title="Remove this truss" style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700,lineHeight:1}}>✕</span>}
                    </span>
                  </span>
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
              {/* Material and Drape share a row: three short pills each left a long empty tail on
                  its own line, and stacking them pushed Masking and the truss dims further down.
                  Each group keeps its own wrap, so on a narrow card Drape drops below Material
                  intact rather than the pills interleaving. */}
              <div style={{display:"flex",alignItems:"center",gap:26,marginBottom:10,flexWrap:"wrap",rowGap:8}}>
                  {zc.trT && <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={rowCap}>Material</span>
                    {TRUSS_MATERIALS.map(m=>{
                      const sel=(zc.trussMaterial|| "iron")===m.key;
                      return <span key={m.key} onClick={()=>sZ({trussMaterial:m.key})} style={optPill(sel)}>{sel&&<IconCheck size={9}/>}{m.label}</span>;
                    })}
                  </div>}
                  {zc.trT && <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={rowCap}>Drape</span>
                    {[{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o=>{
                      const sel=(zc.drapeDensity||"moderate")===o.v;
                      return <span key={o.v} onClick={()=>sZ({drapeDensity:o.v})} style={optPill(sel)}>{sel&&<IconCheck size={9}/>}{o.l}</span>;
                    })}
                    {/* Sits with Drape, not Material: it swaps the fabric ceiling drape for an
                        inventory item, so its cost comes out of the drape portion of the rate
                        (ceilingRatePerSqft), and it has nothing to do with the truss metal. */}
                    {zc.trT==="box" && <span style={{display:"inline-flex",marginLeft:6}}>{customCeilingField(k, zc, false, rowIdx)}</span>}
                  </div>}
                  {/* Off is the common state, and it was costing a whole line for one switch. Only
                      the toggle comes up here; the wall and material options below need real width,
                      so they stay in the nested block and appear when masking is actually on. */}
                  <div style={{display:"flex",alignItems:"center",gap:8}} title="Masking panels attach to this truss">
                    <span style={rowCap}>Masking</span>
                    <span style={{display:"inline-flex",alignItems:"center",color:textS}}><IconWall size={12}/></span>
                    <div onClick={()=>sZ({mkOn:!zc.mkOn,mkWalls:zc.mkOn?{}:(zc.mkWalls||{})})} style={{width:30,height:16,borderRadius:8,background:zc.mkOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer",flexShrink:0}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:zc.mkOn?16:2,transition:"left 0.2s"}}/></div>
                    {showCosts&&zc.mkOn&&<span style={{fontWeight:600,color:textP,fontSize:11}}>{fmt(rowCost.masking)}</span>}
                  </div>
              </div>
                {/* ═══ MASKING ═══ Nested inside Truss: masking panels attach to the truss, which is why
                    the original code grouped them. Sits after the truss's own controls so the card reads
                    "configure the truss → then what's masked onto it". */}
                {zc.mkOn && <div style={{marginTop:10,marginLeft:"auto",width:"fit-content",maxWidth:"100%",paddingLeft:11,paddingBottom:2,borderLeft:`3px solid ${accent}33`}}>
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
                  {/* The toggle and its cost moved up to the Material / Drape row. */}
                  {zc.mkOn&&<div style={{paddingLeft:0}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                      {maskOpts.map(o=><button key={o.id} onClick={()=>sZ({mkT:o.id})} style={optPill(zc.mkT===o.id)}>{zc.mkT===o.id&&<IconCheck size={9}/>}{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                      {customMaskingField(k, zc, false, rowIdx)}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {walls.map(w=>{const on=mw[w.id];return <button key={w.id} onClick={()=>toggleWall(w.id)} style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${on?textP:border}`,fontSize:11.5,cursor:"pointer",fontWeight:on?600:400,background:on?"rgba(0,0,0,0.06)":"transparent",color:on?textP:textS}}>{on?"✓":""} {w.label} ({w.dim}){showCosts&&w.sqft>0?` = ${w.sqft} sqft`:""}</button>;})}
                    </div>
                  </div>}
                </div>;})()}
                </div>}{/* /masking (nested in truss) */}

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
export function TrussStack({ S, customCeilingField, customMaskingField, k, zc, zm, st, sZ, sD, fmt, showCosts, isDark, border, textP, textS, accent, maskOpts, trussRates, structRates }) {
  const rows = zc.extraTrussRows || [];
  const write = (next) => sZ({ extraTrussRows: next });
  const shared = { S, customCeilingField, customMaskingField, k, zm, st, fmt, showCosts, isDark, border, textP, textS, accent, maskOpts, trussRates, structRates };
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
export function FloorCard({ S, zc, zm, st, sZ, sFD, fd, fmt, showCosts, isDark, border, accent, textP, textS, imsCarpetMaterials, imsPlatformRates, nested = false, title, onRemove }) {
  // What THIS footprint costs, via the same function the cost engine sums over every row.
  //
  // Dims are read off zc, NOT off the `fd` prop, and that distinction is the whole thing: the prop
  // is `zc.floorDims || {}`, while the engine uses `zc.floorDims || zc.dims` — a zone with no floor
  // dims of its own is priced on its TRUSS dims (hence the "Uses truss L×W if empty" caption).
  // Taking the prop showed ₹0 on a floor that was being charged for. An extra platform gets no such
  // fallback, in the engine or here: its dims live on its own row.
  const rowDims = nested ? (zc.floorDims || {}) : (zc.floorDims || zc.dims || {});
  const rowCost = platformRowCost(
    { plH: zc.plH, floorDims: rowDims, cpT: zc.cpT },
    { platformRates: imsPlatformRates, carpetMaterials: imsCarpetMaterials },
  );
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
                    {/* ── A SEGMENTED CONTROL, BECAUSE IT IS A CHOICE ──
                        These were borderless buttons separated by nothing, differing only in font
                        weight and an 8%-black wash when picked. Nobody could tell they were pressable,
                        which of them was current, or that they were two options of one setting rather
                        than two labels — the report was exactly that.
                        Now they sit in one bordered track with the selected half filled and the word
                        "Height" in front of it, so the group says what it is before it is touched.
                        Both remain deselectable: pressing the current one clears the platform, which
                        is how a zone gets NO platform at all, and it is the only way to do it. */}
                    <span style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:textS,marginLeft:2}}>Height</span>
                    <span style={{display:"inline-flex",padding:2,borderRadius:999,border:`1px solid ${border}`,background:"rgba(26,26,46,0.03)",gap:2}}>
                      {platformOptions(imsPlatformRates).map(o=>{
                        // Neither button shows as picked until zc.plH is actually written — it used
                        // to show 1ft–3ft as pre-selected so the control never looked blank, but that
                        // pre-select used to get silently committed the moment a floor dimension was
                        // typed (see sFD above), billing a platform nobody had pressed a button for.
                        // A zone with no plH simply has no platform — that's a real, valid state now,
                        // not just an unanswered control.
                        const on = zc.plH === o.id;
                        return (
                          <button key={o.id} onClick={()=>sZ({plH:on?null:o.id})}
                            title={on?`${o.l} selected — press again for no platform`:`Set platform height to ${o.l}`}
                            style={{padding:"3px 10px",borderRadius:999,border:"none",fontSize:11.5,cursor:"pointer",
                              fontWeight:on?700:500,background:on?accent:"transparent",
                              color:on?"#1A1A2E":textS,whiteSpace:"nowrap",lineHeight:1.5,transition:"background .14s ease,color .14s ease"}}>
                            {o.l}{showCosts?` ₹${o.r}`:""}
                          </button>
                        );
                      })}
                    </span>
                  {/* THIS footprint's own cost, not st.platform. st.platform is the zone's total
                      across every footprint, so it could only be shown on the first card — which
                      left every added platform with no price against it at all, and made the first
                      card's figure look like it belonged to that card alone. Each card now states
                      what it costs; the zone total is in the zone header and the Live Estimate. */}
                  </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(rowCost.platform)}</span>}
                </div>
              </div>
              {/* Carpet sits with the floor dimensions, to the right of depth — it is priced on the
                  same area those two inputs define, so it belongs beside them rather than in a row
                  of its own above. The options come from imsCarpetMaterials, NOT imsPrintMaterials —
                  carpet has its own master list in IMS and platformRowCost prices against
                  `carpetMaterials`.
                  Shows "— None —" only for a floor nobody has measured yet — sFD (Floor Width/Depth's
                  onChange, above) defaults cpT to Carpet Old the moment a real dimension is typed, so
                  a floor that's plainly being sized for carpet doesn't sit silently unpriced just
                  because the team moved straight past the dropdown. Still fully overridable: pick a
                  different material, or "— None —" (writes the explicit CARPET_OFF sentinel), and
                  sFD never touches cpT again once it's set. carpetPricingFor prices an unset cpT the
                  same as CARPET_OFF (₹0) — see taxonomy.js. */}
              <div style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:96}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Floor Width (ft)</div>
                  <input type="number" value={fd.W||""} onChange={e=>sFD("W",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.W||"—"}/></div>
                <div style={{flex:1,minWidth:96}}><div style={{fontSize:11.5,color:textS,marginBottom:3}}>Floor Depth (ft)</div>
                  <input type="number" value={fd.L||""} onChange={e=>sFD("L",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.L||"—"}/></div>
                <div style={{flex:1.5,minWidth:150}}>
                  <div style={{fontSize:11.5,color:textS,marginBottom:3,display:"inline-flex",alignItems:"center",gap:5}}><IconCarpet size={12}/>Carpet</div>
                  <select value={zc.cpT||""} onChange={e=>sZ({cpT:e.target.value||CARPET_OFF})}
                    style={{width:"100%",boxSizing:"border-box",fontSize:11.5,padding:"7px 8px",borderRadius:8,border:`1px solid ${border}`,background:"#fff",color:"#111827"}}>
                    <option value="" style={{color:"#111827",background:"#fff"}}>— None —</option>
                    {(imsCarpetMaterials||[]).map(m=><option key={m.id} value={m.id} style={{color:"#111827",background:"#fff"}}>{m.name}{showCosts?` · ₹${m.ratePerSqft}/sqft`:""}</option>)}
                  </select></div>
                {showCosts&&<div style={{fontSize:11.5,color:textS,paddingBottom:8,whiteSpace:"nowrap"}}>Carpet <span style={{fontWeight:600,color:textP}}>{fmt(rowCost.carpet)}</span></div>}
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
export function FloorStack({ S, zc, zm, st, sZ, sFD, fd, fmt, showCosts, isDark, border, accent, textP, textS, imsCarpetMaterials, imsPlatformRates }) {
  const rows = zc.extraPlatformRows || [];
  const write = (next) => sZ({ extraPlatformRows: next });
  // accent rides in `shared`, so both the first floor and every added row get it from one place —
  // FloorCard needs it for the platform-height control's selected fill.
  const shared = { S, zm, st, fmt, showCosts, isDark, border, accent, textP, textS, imsCarpetMaterials, imsPlatformRates };
  return (<>
    <FloorCard {...shared} zc={zc} sZ={sZ} sFD={sFD} fd={fd} title={rows.length ? "Floor 1" : "Floor"} />
    {rows.map((row, ri) => {
      const setRow = (patch) => write(rows.map((x, i) => (i === ri ? { ...x, ...patch } : x)));
      // Same carpet default-on-first-dimension as the primary floor's sFD above — an extra
      // platform footprint gets it too, only while its own cpT is still unset.
      const setFd = (d, v) => setRow({ cpT: row.cpT || defaultCarpetMatId(imsCarpetMaterials), floorDims: { ...(rows[ri]?.floorDims || {}), [d]: parseFloat(v) || 0 } });
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
    clientName, clientDate, activeFnMeta, venue, fn, extraFunctions, setExtraFunctions,
    clientPalette, setClientPalette,
    studioFloralData, venueParents, loadAvailability, getStudioAvailable, activeBlocksForDate, openAvailModal,
    activeFnIdx, collectAllFunctionData, rcSubcatFactors, rcFactorByKey, rcFloralModeByKey,
    // palette / colour catalogues
    imsPaletteCatalogue, imsColourCatalogue, setImsPaletteCatalogue, savePaletteData,
    // venues (for named-venue correction + the zone-photo Venue pill filter)
    allInhouseVenues = [], customOutdoor = [], allVenueData = {}, allOutdoorDB = [], leafInhouseVenues = [],
    // zone photo groups (hand-picked leading photos, keyed by zone + function)
    zoneGroups = {}, writeZoneGroup,
    // date demand
    dateTypes, clientLedger, activeClientId,
    // build canvas
    setShowCosts, grandTotal, totalCost, transportCalc, pricingReady,
    savedInsps, setStep, setPreviewImg,
    floralRatio, setFloralRatio,
    zoneKeys, customZones, setCustomZones, zoneLabelsD, zoneMeta,
    enabledEls, setEnabledEls, customMode, toggleEl,
    zoneElements, setZoneElements, zoneConfig, setZoneConfig, setActiveZones,
    calcElsCost, calcStructCost, calcPhotoCost, getElPrice, applyFloralRatio,
    elSelectedPhoto, selectElPhoto, setElSelectedPhoto, elNotes, setElNotes,
    elMultiPhotos, isMultiPhotoZone, toggleMultiElPhoto,
    setElGallery, setGalleryIdx,
    newCzSrc, setNewCzSrc,
    // uploads / ai
    zoneUploading, handleZoneUpload,
    zoneElSearch, setZoneElSearch, zonePrintSearch, setZonePrintSearch,
    // zone-photo filters
    zpFilterOpen, setZpFilterOpen, zpHasFilters, zpFilters, setZpFilters, zpToggleFilter, zpFilterPhoto, zpVenueMatch, zpPaletteMatch,
    zpVenueTypeMatch, zpDesignStyleMatch, zpTimeSettingMatch, zpTierMatch,
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
    // Platform rates (IMS Admin → Settings → 🪵 Platform Rates)
    imsPlatformRates,
    // Genset count override, one per size — null means "follow the venue's own figure" for that
    // size. Stepped from the Build total's Genset rows; persisted with the rest of the session
    // snapshot.
    customGensets, setCustomGensets, genset62, setGenset62,
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
    favPhotos, saveFavPhotos,
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
  // The scroll-to-zone effect that lived here is gone with its only caller. It was local to this
  // file and nothing else referenced it, so it was dead once Details stopped scrolling.
  const toggleZoneCollapse = (k) => {
    // Expanding used to scroll the page to the zone. The zone header you just clicked is already
    // where you are looking, so the jump moved you away from it rather than towards it — it read
    // as the page navigating somewhere. Details now just opens in place.
    setZoneCollapsed((p) => ({ ...p, [k]: p[k] === false ? true : false }));
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
    <div className="rail-tab" onClick={()=>(side==="left"?setLeftRailOpen:setRightRailOpen)(true)} title={`Show ${label}`}
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
  // What this section actually costs — same calc functions the zone header/live total already use,
  // so a tile can never show a number the rest of the page disagrees with. Truss's tile absorbs
  // arches/pillars/glass too (structural extras with no tile of their own); Platform's absorbs
  // carpet (bundled with the floor it sits on) — between the two, every rupee calcStructCost
  // produces lands on exactly one tile.
  const sectionCost = (k, id) => {
    if (!showCosts) return 0;
    if (id === "elements") return calcElsCost(zoneElements[k], true, zoneConfig[k], {checkAvailability:true});
    const sc = zoneConfig[k] ? calcStructCost(k, zoneConfig[k], structRates) : null;
    if (id === "truss") return sc ? sc.truss + sc.masking + sc.arches + sc.pillars + sc.glass : 0;
    if (id === "platform") return sc ? sc.platform + sc.carpet : 0;
    return sc ? sc.print : 0; // calcStructCost's own print total — same figure zoneTotal() now folds in below
  };
  const sectionTile = (k, sec) => {
    const on = zoneSection[k] === sec.id;
    const sub = zoneSectionSub(k, sec.id);
    const cost = sectionCost(k, sec.id);
    return <div key={sec.id} className="sec-tile" data-on={on?"1":"0"} onClick={()=>openZoneSection(k,sec.id)}
      style={{display:"flex",alignItems:"center",gap:9,padding:"11px 12px",borderRadius:10,cursor:"pointer",
        border:`1px solid ${on?accent:border}`,background:on?`${accent}12`:cardBg}}>
      <span style={{display:"flex",flexShrink:0,color:on?accent:textS}}><sec.Icon size={16}/></span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12.5,fontWeight:700,color:on?accent:textP}}>{sec.label}</div>
        {sub&&<div style={{fontSize:10.5,color:textS,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>}
      </div>
      {cost>0&&<div style={{fontSize:11.5,fontWeight:700,color:on?accent:textP,flexShrink:0}}>{fmt(cost)}</div>}
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
    const total = showCosts ? calcElsCost(els, true, zoneConfig[k], {checkAvailability:true}) : 0;
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
  // header and the live-pricing tile share it and cannot drift apart. `{checkAvailability:true}`
  // matches StudioApp.jsx's totalCost() exactly (same call, same flag) — without it, a zone with an
  // item short in stock for this date priced HIGHER here (full rate) than in the Décor grand total
  // (shortfall-adjusted), so "By zone" + "Zones subtotal" quietly failed to add up to the number
  // above them. Same reasoning as calcFunctionCost's — this is what makes Build's own totals agree
  // with themselves, and with Summary/Deal Check's.
  const zoneTotal = (k) => calcElsCost(zoneElements[k],true,zoneConfig[k],{checkAvailability:true})+(zoneConfig[k]?calcStructCost(k,zoneConfig[k],structRates).total:0)+dcCustomItems.filter(c=>c.fnIdx===(activeFnIdx||0)&&c.zoneKey===k).reduce((acc,c)=>acc+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
  void textSRaw;

  // Photo-filter pill. Was 9px in a 2px-tall chip with `textS` (~3.1:1) when inactive — too small
  // to hit and too faint to read. One geometry, used by all 25 call sites on this page.
  // The filters now sit on the panel's ink rather than on the cream page, so they are asked for in
  // the DARK skin — exactly as Browse does it. makeFilterUI is already parameterised by isDark and
  // caches per (isDark, accent, textP), so this re-colours every pill, header, count chip and search
  // box WITHOUT touching a line of the filter markup below, and therefore without touching any
  // filter logic. Every one of these components is used only inside ZP_PANEL, which is what makes
  // the swap safe.
  // TWO sets, and they are not interchangeable. zpTextM/zpGold are read by zpPill and by the
  // per-zone filter popovers, which sit on the CREAM PAGE — dressing them for the dark panel makes
  // them near-invisible there. pTextM is the panel's own muted text, for the handful of labels
  // inside ZP_PANEL that don't come from the (already dark-skinned) filter kit.
  const zpTextM = textS;
  const zpGold  = isDark ? "#D9BE86" : "#8A6A2F";
  const pTextM  = "rgba(245,241,231,0.72)";
  const { Panel: FPanel, Section: FSection, Pill: FPill, SearchBox: FSearchBox, seeMorePill: fSeeMorePill, css: filterCSS } =
    makeFilterUI({ isDark: true, accent, textP: PANEL_INK, S: makeS(true) });
  // Panel-local tokens for the markup in THIS file that doesn't come from the kit — same values
  // Browse uses, so the two panels are one surface.
  const pBorder = "rgba(255,255,255,0.17)";
  const pCard   = "rgba(255,255,255,0.06)";
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
  // Ownership grouping (Inhouse/Outside) — the same Venue filter Browse has, layered on top of the
  // Indoor/Outdoor/Semi-Outdoor narrowing above. The two are unrelated axes: venueType describes the
  // function's physical setting (banquet vs lawn), this describes who owns the venue.
  const zpFilterVenuesByGroup = (list, group) => group === "inhouse" ? list.filter(v => allInhouseVenues.includes(v))
    : group === "outside" ? list.filter(v => !allInhouseVenues.includes(v))
    : list;
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
  // Name for the "Other" entry in the Add Zone picker. Local, not in ctx: it is transient text that
  // only this panel reads, and it is cleared the moment the zone is added or the picker changes.
  const [newCzOtherName, setNewCzOtherName] = useState("");
  const [phPage, setPhPage] = useState({});   // per-zone page index for the photo picker

  // ═══ ZONE PHOTO GROUPING ═══ tick photos in a zone's strip to pin them to the front of that
  // zone for the current function. Kept apart from elSelectedPhoto: that is the ONE photo whose
  // elements price the zone, and overloading the same click to also mean "put this in the group"
  // would make every grouping tick re-price the build.
  const [grpSel, setGrpSel] = useState({});   // { [zoneKey]: Set<libraryPhotoId> } — the TRUE current
  // membership once grid mode is on for a zone (pre-loaded from the saved group, see the grid-view
  // toggle below), not just a pending pick. Ticking/unticking IS the group now — no separate confirm.
  const grpSelFor = (k) => grpSel[k] || EMPTY_SET;
  // ── WHICH TICKS THE USER ACTUALLY ASKED FOR ──
  // Opening the grid, and picking a photo to build with, both pre-tick that photo — a convenience, so
  // whatever is driving the zone does not have to be re-found and re-ticked. But both of those also
  // SAVED it, which quietly pinned the photo into the zone's permanent group. That is how a photo
  // retagged to another zone kept appearing here: group membership is not derived from tags, so once
  // pinned it stays, and nobody ever chose to pin it.
  // These ids are ticked but NOT persisted. An explicit toggle promotes an id out of this set — at
  // that point the user has said something about it — and only then can it reach the saved group.
  const [grpAuto, setGrpAuto] = useState({});   // { [zoneKey]: Set<libraryPhotoId> }
  // { [zoneKey]: "saving" | "saved" | "error" } — feedback for the auto-save below, since there's no
  // button press to feel like confirmation anymore.
  const [grpSaveStatus, setGrpSaveStatus] = useState({});
  const grpSaveTimers = useRef({});   // { [zoneKey]: timeoutId } — debounces rapid tick/untick clicks
  // Groups are stored per AREA name, which is the vocabulary photos are tagged with and that
  // getLibPhotosForZone reads back. A zone maps to one or more area names; write to the first,
  // since the read unions across all of them. An unmapped custom zone falls back to its label.
  const groupAreaFor = (srcType, label) => areaNamesFor(srcType)[0] || label || srcType;
  // Debounced auto-save — fires ~700ms after the last tick/untick in a zone, so a quick run of
  // clicks collapses into one network round trip instead of one per click. Always REPLACES the
  // zone's saved list with exactly what's ticked (not an add/remove delta): grid mode pre-loads
  // ticks from the saved group before any click can happen, so the tick set is always the full
  // intended membership, and unticking a previously-saved photo removes it the same way ticking a
  // new one adds it — one gesture, no separate "unpin" action.
  const scheduleGroupSave = (zoneKey, srcType, label, idsSet) => {
    if (grpSaveTimers.current[zoneKey]) clearTimeout(grpSaveTimers.current[zoneKey]);
    grpSaveTimers.current[zoneKey] = setTimeout(async () => {
      const area = groupAreaFor(srcType, label);
      if (!area || !writeZoneGroup) return;
      setGrpSaveStatus(p => ({ ...p, [zoneKey]: "saving" }));
      try {
        await writeZoneGroup(area, groupFn, [...idsSet]);
        setGrpSaveStatus(p => ({ ...p, [zoneKey]: "saved" }));
        setPhPage(p => ({ ...p, [zoneKey]: 0 }));   // the order just changed — jump the pager back to page 1
      } catch (e) {
        setGrpSaveStatus(p => ({ ...p, [zoneKey]: "error" }));
        showMsg("Couldn't save the group: " + (e.message || "unknown"), "red");
      }
    }, 700);
  };
  // An explicit tick or untick. This is the only path that may write, and the id stops being "auto"
  // the moment it is touched here — the user has now said something about it either way.
  const toggleGrpPick = (k, id, srcType, label) => {
    let promoted = grpAuto[k];
    if (promoted && promoted.has(id)) {
      promoted = new Set(promoted); promoted.delete(id);
      setGrpAuto(p => ({ ...p, [k]: promoted }));
    }
    setGrpSel(prev => {
      const cur = new Set(prev[k] || []);
      cur.has(id) ? cur.delete(id) : cur.add(id);
      const auto = promoted;
      const toSave = (auto && auto.size) ? new Set([...cur].filter(x => !auto.has(x))) : cur;
      scheduleGroupSave(k, srcType, label, toSave);
      return { ...prev, [k]: cur };
    });
  };
  // Add-only, never removes — used when picking a photo for the actual build (not ticking the
  // checkbox) while grid mode is already open. It TICKS the photo so the grid reflects what the zone
  // is built from, but it no longer saves: choosing a photo to build with is not the same as asking
  // for it to be pinned into this zone forever, and conflating the two is what put a retagged photo
  // back in Centre Pieces. It joins grpAuto, so a later explicit tick elsewhere cannot carry it in.
  const ensureGrpPick = (k, id, srcType, label) => setGrpSel(prev => {   // eslint-disable-line no-unused-vars
    const cur = new Set(prev[k] || []);
    if (cur.has(id)) return prev;
    cur.add(id);
    setGrpAuto(p => { const a = new Set(p[k] || []); a.add(id); return { ...p, [k]: a }; });
    return { ...prev, [k]: cur };
  });
  // Hide the ticks locally WITHOUT touching the saved group — used when leaving grid view, where
  // the ticks just stop being visible/actionable, same as the group being untouched always meant.
  const hideGrpPick = (k) => { setGrpSel(prev => ({ ...prev, [k]: new Set() })); setGrpAuto(p => ({ ...p, [k]: new Set() })); };
  // Untick everything in this zone AND persist that — with the auto-save above, this empties the
  // saved group, same as unticking each photo individually would, just in one click.
  const clearGrpPick = (k, srcType, label) => setGrpSel(prev => {
    scheduleGroupSave(k, srcType, label, new Set());
    setGrpAuto(p => ({ ...p, [k]: new Set() }));   // nothing is ticked, so nothing is auto either
    return { ...prev, [k]: new Set() };
  });
  // Both side rails fold away together, from the one control in the Photo filters header.
  // Each rail folds on its own. One flag meant hiding the filters to widen the build also took the
  // running total off screen — the one thing you want kept while you widen it.
  // Open on a desktop, closed once the panel becomes an OVERLAY — an overlay that is up before you
  // ask for it hides the build you came to work on. 900 has to match the stylesheet's overlay
  // threshold exactly; the reasoning for that number is written there, beside the arithmetic it
  // comes out of. Read once at mount: this is a starting position, not a binding — once you have
  // opened or closed it, that choice stands.
  const [leftRailOpen, setLeftRailOpen] = useState(() => {
    try { return !window.matchMedia("(max-width: 900px)").matches; } catch { return true; }
  });
  // Live Estimate starts folded — the build opens with every zone off and the total at ₹0, so on
  // arrival the rail is a column of zeroes taking width from the zones. Its tab on the right edge
  // brings it back the moment there is a number worth watching.
  const [rightRailOpen, setRightRailOpen] = useState(false);
  // Element cards widen as each rail folds: 4 with both open, 6 with neither. A kit row spans
  // about half the grid, so it is derived rather than hardcoded against a fixed column count.
  // Four, whatever the rails are doing. It used to be 4 + one per folded rail, on the reasoning that
  // reclaimed width should buy more columns — but an element card holds a name, a rate, a unit, a
  // grade row, a stepper and a line total, and at five across those start truncating. The extra room
  // is better spent making four cards readable than fitting a fifth that isn't.
  const elCols = 4;
  const kitSpan = Math.ceil(elCols / 2);
  // Palette search in the photo-filter rail. Held here, not in the Section, so it survives the
  // panel re-rendering on every filter change.
  const [zpPaletteQ, setZpPaletteQ] = useState("");
  // Venue runs to 40+ names, which buried every group under it. Show a first screenful, put the
  // rest behind "See all", and give the group the same smart search the palette group has.
  const [zpVenueQ, setZpVenueQ] = useState("");
  const [zpVenueAll, setZpVenueAll] = useState(false);
  // Inhouse/Outside — same grouping chips as Browse's Venue filter, own state since it's a "narrow
  // the picker" convenience like the search box above, not a persisted zpFilters value.
  const [zpVenueGroup, setZpVenueGroup] = useState("all");
  const ZP_VENUE_CAP = 8;
  // Palette gets the same cap for the same reason — 33 entries pushed every group below it off the
  // rail. 12 is four rows at three columns, matching Browse.
  const [zpPaletteAll, setZpPaletteAll] = useState(false);
  const ZP_PALETTE_CAP = 12;
  // The in-zone panel repeats these same two lists and capped neither: palette ran seven rows deep
  // and venue sat in a 110px nested scrollbox, so the filter dwarfed the photos it filters. Same
  // caps as the rail, but its own expand state — it is a separate surface you open per zone.
  const [zpInlinePaletteAll, setZpInlinePaletteAll] = useState(false);
  const [zpInlineVenueAll, setZpInlineVenueAll] = useState(false);
  // Same reasoning, same smart search as the rail's Venue/Palette groups — own query state because
  // only one zone's popup is ever open at once, but it's still a separate surface from the rail.
  const [zpInlinePaletteQ, setZpInlinePaletteQ] = useState("");
  const [zpInlineVenueQ, setZpInlineVenueQ] = useState("");
  // Same Inhouse/Outside grouping as the rail's Venue group, own state — this popover is its own
  // surface (per-zone, one open at a time), same reasoning as zpInlineVenueQ above.
  const [zpInlineVenueGroup, setZpInlineVenueGroup] = useState("all");
  // Fabric Palette combobox (Deal Check's fabric colour input, not a photo filter) — collapsed to a
  // single trigger chip, same toggle-by-click-again model as the per-zone filter icon (no outside-
  // click handling needed): open shows a search box + dropdown, picking a value closes it.
  const [fabricPaletteOpen, setFabricPaletteOpen] = useState(false);
  const [fabricPaletteQ, setFabricPaletteQ] = useState("");
  const zpMorePill = () => ({ ...zpPill(false), borderStyle: "dashed", fontWeight: 700, color: accent });
  const PH_COLS = 4;                          // always four across: a wider column means BIGGER
  // One row, rails open or folded. Folding them used to add a second row of four, which is the
  // opposite of the point — the extra width is meant to make the same four photos bigger, not to
  // fit twice as many and push the zone's own controls off the bottom of the screen.
  const PH_PER_PAGE = 4;
  // ── THE ▦ GRID ──
  // Eight across, fixed. It was auto-fill/minmax(150px), which on a wide monitor packed ten or more
  // into a row and made every thumbnail smaller the bigger the screen got — the opposite of what
  // more room should buy. A fixed count means the photos GROW with the window.
  const PH_GRID_COLS = 8;
  const PH_GRID_PER_PAGE = 80;   // ten full rows
  const RAIL_W = 258;                         // still the RIGHT rail's width (the estimate tile)
  const RAIL_TOP = 70;                        // the rails' sticky offset — clears the page header
  const railRef = useRef(null);
  const railMaxH = useRailMaxHeight(railRef, RAIL_TOP);
  // ═══ THE REAL HEADER HEIGHT ═══
  // RAIL_TOP is a guess at it. On a multi-function deal the bar grows a second row of pills and on a
  // tablet it wraps the step nav, either of which makes the guess short — and the panel's first
  // control then lands on top of the navbar. Measured and observed instead, same as Browse.
  const [hdrH, setHdrH] = useState(RAIL_TOP);
  useEffect(() => {
    const el = document.querySelector(".sa-header");
    if (!el) return undefined;
    const read = () => setHdrH(el.getBoundingClientRect().height || RAIL_TOP);
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [RAIL_TOP]);
  // The header goes see-through across the panel's width while the panel is up, so the column reads
  // as one piece from the top of the screen. Same flag and same variable Browse uses — the header is
  // a sibling of this view, not an ancestor, so it travels on the root element. Removed on unmount,
  // so Summary never inherits a bar with a hole in it.
  useEffect(() => {
    const el = document.documentElement;
    if (leftRailOpen) el.setAttribute("data-sb-rail", "1");
    else el.removeAttribute("data-sb-rail");
    return () => el.removeAttribute("data-sb-rail");
  }, [leftRailOpen]);
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
      // Derived bases are NOT rounded. Rounding here made 5-at-scale-2 a base of 3, so going to
      // scale 3 gave 9 where 7 or 8 was owed — the error compounded every time the scale moved.
      // Only the qty the salesperson actually sees is a whole number.
      const base = (e.baseQty != null && Number.isFinite(Number(e.baseQty)))
        ? Number(e.baseQty)
        : (Number(e.qty) || 0) / oldS;
      return { ...e, baseQty: base, qty: Math.max(0, Math.round(base * newS)) };
    }) }));
    setZoneConfig(p => ({ ...p, [k]: { ...(p[k] || {}), scale: newS } }));
  };

  /**
   * An element with a hand-typed qty, and its per-set base kept in step.
   *
   * Every qty control has to go through this. Writing qty alone leaves baseQty describing the qty
   * the element had BEFORE the edit, and the next scale change recomputes from that stale base —
   * so a salesperson who scaled a zone to 2, then bumped an element from 10 to 12, watched the 12
   * turn into 15 rather than 18 the moment they touched the scale again. The edit was not adjusted,
   * it was discarded.
   *
   * The base is left fractional on purpose: 5 pieces across a set of 2 IS 2.5 per set, and forcing
   * it to a whole number is what made the qty drift on every subsequent change.
   */
  const applyQty = (k, el, nextQty) => {
    const s = zoneScaleVal(k);
    return { ...el, qty: nextQty, baseQty: s > 1 ? nextQty / s : nextQty };
  };

  // ── What is in the Scale box WHILE it is being typed in ──────────────────────────────────────
  // The box cannot be driven straight off the committed scale. That value is clamped to at least 1,
  // so clearing the field to type a new number put a 1 back under the cursor before the second
  // keystroke arrived — and every one of those keystrokes rewrote every element qty in the zone.
  // Typing 12 meant passing through 1, and backspacing meant watching the zone collapse to its base
  // counts. So the raw text lives here, per zone, and the scale is applied once on blur or Enter.
  const [scaleDraft, setScaleDraft] = useState({});
  const commitScale = (k) => {
    setScaleDraft(p => { const n = { ...p }; delete n[k]; return n; });
    const raw = scaleDraft[k];
    // Left empty, or scribbled over and abandoned — keep what the zone already had rather than
    // reading "" as 1 and silently unscaling the whole zone.
    if (raw === undefined || String(raw).trim() === "") return;
    setZoneScale(k, raw);
  };

  // ── Recalibrate — repair a zone whose baseQty drifted from a legacy corrupted save ────────────
  // Normally baseQty stays trustworthy forever (every qty edit and every scale change keeps it in
  // step). But a photo corrected to master WHILE a zone was mid-scale, before that save started
  // stripping baseQty, could bake a stale ratio (e.g. 0.5) straight into the library photo — and any
  // deal that had already loaded that photo before the fix shipped is still sitting on it in its own
  // saved snapshot. The symptom: Scale reads 20, an element shows 10, and every further scale edit
  // just multiplies the same wrong base (0.5×20=10 forever) because it's internally self-consistent.
  // The only real fix is to re-derive from the photo's own canonical recipe qty, not from anything
  // already sitting in this zone. Re-selecting the same photo does exactly that (see selectElPhoto)
  // but also wipes truss/platform/scale — this does the same recipe re-pull without losing either.
  const recalibrateZoneScale = (k) => {
    const photo = elSelectedPhoto[k];
    if (!photo?.isLibrary) return;
    const libImg = libItems.find(i => i.url === photo.src || i.id === photo.eventId);
    const rawEls = libImg?.elements || photo.elements || [];
    if (!rawEls.length) return;
    askConfirm(
      "Recalibrate this zone's quantities to the selected photo's recipe?",
      () => {
        const s = zoneScaleVal(k);
        setZoneElements(p => ({ ...p, [k]: JSON.parse(JSON.stringify(rawEls)).map(({ baseQty: _drop, ...e }) => {
          const base = Number(e.qty) || 0;
          return { ...e, baseQty: base, qty: Math.max(0, Math.round(base * s)) };
        }) }));
        showMsg("✓ Recalibrated to the photo's recipe", "green");
      },
      { yesLabel: "Recalibrate", note: "Any manual quantity edits or added items in this zone will be replaced by the photo's own element list, scaled ×" + zoneScaleVal(k) + "." }
    );
  };

  // ── Per-element stock availability browser (Build) ───────────────────────────────────────────
  // A discreet 📦 on each element opens a modal listing that element's IMS sub-category items (alias-aware)
  // with the FREE count on the event date (owned − blocked). Picking one + Save pins it on the element
  // (deal-local) → Deal Check auto-match honors the pin. No costs shown — availability only.
  // availModal/openAvailModal/saveAvailPick now live in ctx (StudioApp.jsx) — the Add Production/
  // Buying Item modal (StudioModals.jsx, a sibling view) needed the exact same picker rather than a
  // second copy, and the modal itself now renders in StudioModals.jsx alongside it.
  // Hover-to-zoom on an element's thumbnail — same fixed-position enlarged-preview pattern as
  // ManageLibrary.jsx's elHoverImg. Keyed by "zoneKey:idx" since two near-duplicate element-list
  // blocks in this file can both be on screen at once.
  const [elThumbHover, setElThumbHover] = useState(null); // { key, top, bottom, left }

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
  // Zone groups belong in here alongside the filters: they change what getLibPhotosForZone returns
  // AND the order it returns it in, and the cache key is the only thing that invalidates it. Without
  // this, regrouping a zone in Manage leaves an open Build page showing the old strip indefinitely.
  // Only the photo filters invalidate the cached pool. Zone groups deliberately don't: they change
  // the ORDER of an already-fetched pool, applied at read time, so bumping this for them would
  // re-query every zone on every pin — the same mistake keying the cache by function was.
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
    // A true custom ("Other") zone has no zoneLabelsD entry — it isn't part of the admin zone
    // taxonomy, just a per-deal zone the salesperson typed a name for, with no company-wide
    // agreement on what that name means. Matching it by NAME (like a standard zone) would let two
    // unrelated deals that both happen to name a zone e.g. "Selfie Booth" silently share photos —
    // matching it by the raw internal id (what this fell through to before) worked but meant no
    // amount of tagging could ever reach it, since nothing outside this deal's own customZones
    // array ever produces that id. Either way it needs its own channel, not areasElements: return a
    // CUSTOM_ZONE_TAG_PREFIX-marked id instead, which getLibPhotosForZone (StudioApp.jsx) reads as
    // "match tags.customZoneIds by this id", never as a literal areasElements string. (Duplicate
    // zones — the ones with `sourceType` — never hit this: the caller resolves them to their
    // source's standard zone key before calling areaNamesFor at all.)
    const customOther = customZones.find((cz) => cz.id === elKey && !cz.sourceType);
    if (customOther) return [CUSTOM_ZONE_TAG_PREFIX + customOther.id];
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
  const groupFn = activeFnMeta?.type || "";
  // The cached pool is function-agnostic on purpose. Keying it by function meant every switch
  // re-queried the server for every zone, which is what made switching crawl. The group order is
  // applied to the cached pool instead, below — pure array work, no request.
  const zoneCacheKey = (areaNames) => `${matchGen}::${areaNames.join("|")}`;
  // Float this zone's hand-picked group to the front, in the order it was arranged. Group members
  // that aren't zone-tagged are resolved from libById, which the app fills from the groups blob.
  const applyZoneGroupOrder = (list, areaNames) => {
    const ids = groupIdsForZones(zoneGroups, areaNames, groupFn);
    if (!ids.length) return list;
    const byId = new Map(list.map(li => [li.id, li]));
    const pinned = [];
    for (const id of ids) {
      const li = byId.get(id) || libById.get(id);
      // A photo the filters excluded stays excluded — a group must not smuggle one past them.
      if (li && (!zpHasFilters || zpFilterPhoto(li))) pinned.push({ ...li, _grouped: true });
    }
    if (!pinned.length) return list;
    const pinnedIds = new Set(pinned.map(li => li.id));
    return [...pinned, ...list.filter(li => !pinnedIds.has(li.id))];
  };
  const zoneMatchesFor = (areaNames) => applyZoneGroupOrder(zoneMatchCache[zoneCacheKey(areaNames)] || [], areaNames);
  const ensureZoneMatches = (areaNames) => {
    if (!areaNames.length) return;
    const cacheKey = zoneCacheKey(areaNames);
    if (zoneFetchInFlight.current.has(cacheKey) || zoneMatchCache[cacheKey]) return;
    zoneFetchInFlight.current.add(cacheKey);
    getLibPhotosForZone(areaNames, zpHasFilters ? zpFilterPhoto : null)
      .then((result) => setZoneMatchCache((prev) => ({ ...prev, [cacheKey]: result })))
      .finally(() => zoneFetchInFlight.current.delete(cacheKey));
  };
  // Kick off the fetch for every currently-rendered zone (cheap no-op for already-cached/in-flight keys).
  // Every custom zone now gets its own card (see the main zone-cards loop below) — "Other" zones
  // included, not just duplicates — so this has to prefetch for all of them, or a true custom
  // zone's photo strip would sit permanently empty: nothing else ever calls ensureZoneMatches.
  useEffect(() => {
    const keys = [...zoneKeys, ...customZones.map(cz => cz.id)];
    keys.forEach((k) => {
      const czSrc = customZones.find(cz => cz.id === k);
      const srcType = czSrc?.sourceType || k;
      ensureZoneMatches(areaNamesFor(srcType));
    });
    // groupFn is deliberately NOT a dep: the pool it fetches is function-agnostic, and the group
    // order is applied to it at read time. Adding it here re-queried every zone on every switch.
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
      const allMatches = zoneMatchesFor(areaNames);
      let groupRank = 0;
      for (const img of allMatches) {
        if (!img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        photos.push({
          // Rank within the hand-picked group. Carried per photo because the venue and verified
          // sorts below reshuffle the array, and the group's arranged order has to survive them.
          groupRank: img._grouped ? groupRank++ : Infinity,
          src: img.url, eventId: img.id, eventName: img.name || "Library",
          fn: "", space: "", mood: "", venue: "", video: "",
          tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
          isLibrary: true, elements: img.elements || [], dims: img.dims || {},
          grouped: !!img._grouped,
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
        { key:"venue",        cols:2, label:`Venue${zpVenueGroup==="inhouse"?" — Inhouse":zpVenueGroup==="outside"?" — Outside":""}${zpWantIndoor&&!zpWantOutdoor?" · Indoor":zpWantOutdoor&&!zpWantIndoor?" · Outdoor":""}`, opts: zpFilterVenuesByGroup(zpVenueChoices, zpVenueGroup), empty:"No venues configured yet" },
        { key:"eventType",    label:"Event type",    opts: taxOr(taxonomy.eventType, FUNCTIONS) },
        { key:"venueType",    label:"Venue type",    opts: taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]) },
        { key:"designStyle",  label:"Design style",  opts: taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]) },
        { key:"colorPalette", label:"Color palette", cols:3, opts: paletteNames(imsPaletteCatalogue, taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]) },
        { key:"timeSetting",  label:"Day / Night",   opts: taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"]) },
        // Tier ranks rather than hides — see zpTierMatch in StudioApp. Three short values, so it
        // takes the default column count and needs no search box.
        { key:"tier",         label:"Tier",          opts: taxOr(taxonomy.tier, CATEGORIES) },
      ];
      const total = Object.values(zpFilters).flat().length;
      const clearAll = () => setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[],tier:[]});
      {/* "Filters", not "Photo filters", and no "Applies to every zone" note. The panel is the only
          filter surface on the page and it sits under a heading that already says what it filters;
          the note was a caption on a caption, and at this width it crowded the row.
          No `action` either — Hide moved OUT of this header to the top of the rail, where Browse
          keeps it. It closes the whole panel, not the card it was sitting in, and a control belongs
          on the thing it acts on. */}
      return <FPanel title="Filters" total={total} onClear={clearAll}
        scroll={railMaxH}>
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
          // Cap only while browsing — a search or an explicit "See all" shows every hit. Both long
          // lists cap; the short groups (3–8 values) have nothing to hide.
          const cap = isVenue ? ZP_VENUE_CAP : isPalette ? ZP_PALETTE_CAP : 0;
          const seeAll = isVenue ? zpVenueAll : zpPaletteAll;
          const capped = !!cap && !seeAll && !q.trim() && matched.length > cap;
          const shown = capped ? matched.slice(0, cap) : matched;
          // Never let the search OR the cap hide something that is actively filtering the photos.
          const selectedHidden = sel.filter(v => all.includes(v) && !shown.includes(v));
          const optPill = (v) => <FPill key={v} on={sel.includes(v)} align={align} onClick={()=>zpToggleFilter(g.key,v)}>{optLabel(v)}</FPill>;
          return <FSection key={g.key} id={g.key} label={g.label} count={sel.length} last={gi===groups.length-1}
            cols={g.cols || 3} open={!!zpOpen[g.key]} onToggle={()=>zpToggleOpen(g.key)}>
            {/* Inhouse/Outside — narrows which venue names are offered below, same chips + same
                reset-on-switch behaviour as Browse's Venue filter (clears the name pick, the search
                and "see all" so nothing from the old group lingers hidden). */}
            {isVenue&&<div style={{gridColumn:"1/-1",display:"flex",gap:4,marginBottom:2}}>
              {["all","inhouse","outside"].map(gr=>
                <FPill key={gr} on={zpVenueGroup===gr} align={align} onClick={()=>{setZpVenueGroup(gr);setZpFilters(p=>({...p,venue:[]}));setZpVenueQ("");setZpVenueAll(false);}}>{gr==="all"?"All":gr==="inhouse"?"Inhouse":"Outside"}</FPill>
              )}
            </div>}
            {searchable&&<div style={{gridColumn:"1/-1"}}>
              <FSearchBox value={q} onChange={setQ} placeholder={isVenue?"Search venues…":"Search palettes…"}
                noun={isVenue?"venues":"palettes"} resultCount={matched.length} totalCount={all.length}/>
            </div>}
            <FPill on={sel.length===0} align={align} onClick={()=>setZpFilters(p=>({...p,[g.key]:[]}))}>All</FPill>
            {/* Colour-only hits are separated out — see the same split in Browse. Palette only:
                venues have no anchor colours, so every hit is a name match. */}
            {(isPalette?shown.filter(v=>paletteMatches(v,q)):shown).map(optPill)}
            {(()=>{if(!isPalette)return null;const byColour=shown.filter(v=>!paletteMatches(v,q));return byColour.length===0?null:<>
              <div style={{gridColumn:"1/-1",fontSize:9,color:pTextM,marginTop:2}}>Contains this colour</div>
              {byColour.map(optPill)}
            </>;})()}
            {selectedHidden.length>0&&<div style={{gridColumn:"1/-1",fontSize:9,color:pTextM,marginTop:2}}>{q.trim()?"Selected, outside this search":"Selected"}</div>}
            {selectedHidden.map(optPill)}
            {/* See all / Show fewer. Hidden while searching — the search already decides what shows. */}
            {searchable&&!q.trim()&&(capped||seeAll)&&matched.length>cap&&
              <div className="sb-pill sb-ghost" onClick={()=>(isVenue?setZpVenueAll:setZpPaletteAll)(v=>!v)} role="button"
                title={capped?`Show ${matched.length-cap} more`:`Show only the first ${cap}`}
                style={fSeeMorePill}>
                {capped?`See all ${matched.length} ${isVenue?"venues":"palettes"}`:"Show fewer"}
              </div>}
            {g.empty&&g.opts.length===0&&<span style={{gridColumn:"1/-1",fontSize:10,color:pTextM}}>{g.empty}</span>}
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
      });
    // Left in the order the zones are laid out below, NOT ranked by amount. Ranking meant the
    // estimate and the page disagreed about where a zone was, so checking a figure against its
    // zone was a hunt down a list that reshuffled itself whenever a price changed. The build order
    // is the order the salesperson is thinking in.
    const zonesSum = rows.reduce((a,r)=>a+r.amt,0);
    // While the rate tables are still arriving, EVERY figure on this card is a real sum over an
    // incomplete dataset — not just the headline. So the whole card goes to a skeleton rather than
    // showing some numbers and hiding others, which would be the most misleading of the three
    // options: a settled-looking zone list under a loading total reads as trustworthy.
    // A bar sized to the figure it replaces, so nothing moves when the real number lands.
    const bar = (w) => <span style={{display:"inline-block",width:w,height:10,borderRadius:5,background:isDark?"rgba(255,255,255,0.11)":"rgba(26,26,46,0.09)",animation:"pt-pulse 1.15s ease-in-out infinite"}}/>;
    const line = (label, value, opts={}) => (
      <div style={{display:"flex",alignItems:"baseline",gap:8,padding:"5px 0",fontSize:11.5,color:opts.strong?textP:textS}}>
        <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:opts.strong?600:400}}>{label}</span>
        <span style={{fontWeight:opts.strong?700:600,color:textP,fontVariantNumeric:"tabular-nums"}}>{pricingReady?value:bar(opts.strong?62:52)}</span>
      </div>
    );
    return (
      <div className="pt-card" style={{...S.card,padding:0,overflow:"hidden",boxShadow:isDark?"0 1px 2px rgba(0,0,0,0.45), 0 10px 26px -12px rgba(0,0,0,0.6)":"0 1px 2px rgba(26,26,46,0.06), 0 10px 26px -12px rgba(26,26,46,0.2)"}}>
        {/* Gilt rule, matching the Event Info sheet */}
        <div style={{height:3,background:`linear-gradient(90deg,${accent},${accent}66 42%,transparent)`}}/>
        <div style={{padding:"13px 15px",borderBottom:`1px solid ${rule}`}}>
          {/* Its own Hide, mirroring the filter panel's. Same markup and the same rail-btn class, so
              the two read as one control repeated rather than two different affordances. */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:textS}}>Live estimate</div>
            <span className="rail-btn" onClick={()=>setRightRailOpen(false)} title="Hide the estimate and widen the build"
              style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:9.5,fontWeight:700,letterSpacing:0.4,
                textTransform:"uppercase",color:textS,padding:"3px 7px",borderRadius:7,border:`1px solid ${border}`,whiteSpace:"nowrap"}}>
              Hide<span style={{display:"inline-flex",transform:"rotate(-90deg)"}}><IconChevron size={10}/></span>
            </span>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:5,flexWrap:"wrap",minHeight:29}}>
            {pricingReady
              ? <>
                  <div style={{fontSize:23,fontWeight:700,color:textP,letterSpacing:-0.6,fontVariantNumeric:"tabular-nums"}}>{fmt(grandTotal)}</div>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:6,background:cat.bg,color:cat.color}}>{cat.label}</span>
                </>
              /* The tier chip is held back with the number. It is derived from the total, so on seed
                 defaults it can read Platinum on a deal that is actually Gold — a wrong word is
                 stickier than a wrong figure. */
              : <>
                  <span style={{display:"inline-block",width:132,height:22,borderRadius:7,background:isDark?"rgba(255,255,255,0.11)":"rgba(26,26,46,0.09)",animation:"pt-pulse 1.15s ease-in-out infinite"}}/>
                  <span style={{fontSize:9.5,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",color:textS}}>Loading rates…</span>
                </>}
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
  // ═══ REFERENCE-BANNER UPLOAD ═══ Upload used to sit per zone, in the photo-strip header. It now
  // lives once, on the reference banner. handleZoneUpload and applyZoneUpload still key everything
  // off a zone, so a page-level control needs a target: default to the first switched-on zone, and
  // the review modal offers a picker to change it before applying. With no zone on there is nothing
  // to apply to, so the control says that instead of silently doing nothing.
  const uploadTargetZone = [...zoneKeys, ...customZones.map(cz => cz.id)].find(k => enabledEls[k]) || null;
  const uploadTargetLabel = uploadTargetZone
    ? (customZones.find(cz => cz.id === uploadTargetZone)?.name || zoneLabelsD[uploadTargetZone]?.label || uploadTargetZone)
    : "";
  const BANNER_UPLOAD = (
    <label className="zone-upload" data-busy={(zoneUploading || !uploadTargetZone) ? "1" : "0"}
      title={uploadTargetZone
        ? `Upload a client photo — goes to ${uploadTargetLabel}, changeable in the review step`
        : "Switch on a zone first — an upload has to land somewhere"}
      style={{padding:"6px 14px",borderRadius:8,
        // Filled once it can actually do something. As a faint outline on a faint background it read
        // as decoration; this is the one action on the banner, so it should look like one. The
        // no-zone state keeps the old ghost treatment — dimming a solid button just looks broken.
        border:uploadTargetZone?"none":`1px solid ${accent}60`,
        background:uploadTargetZone?(zoneUploading?accent+"CC":accent):"transparent",
        color:uploadTargetZone?(isDark?"#1a1a2e":"#fff"):accent,
        boxShadow:uploadTargetZone?`0 2px 8px -3px ${accent}`:"none",
        fontSize:10.5,fontWeight:700,opacity:uploadTargetZone?1:0.45,
        cursor:!uploadTargetZone?"not-allowed":zoneUploading?"wait":"pointer",
        display:"inline-flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
      {zoneUploading?"Uploading…":<><IconCamera size={11}/>Upload</>}
      <input type="file" accept="image/*" style={{display:"none"}} disabled={!!zoneUploading||!uploadTargetZone}
        onChange={e=>{const f=e.target.files?.[0];if(f&&uploadTargetZone)handleZoneUpload(uploadTargetZone,f);e.target.value="";}}/>
    </label>
  );
  // Wider than S.main's 1200px cap, which left ~350px of dead gutter either side on a desktop
  // monitor and pushed the filter rail far off the left edge. Matches the Browse page.
  return (
  <div className={leftRailOpen?"bd-view":"bd-view bd-folded"} style={{...S.main,maxWidth:1800}}>
    <style>{filterCSS + `
/* ═══════════ THE PANEL SHELL ═══════════
   Browse's ground and column, brought across so the two steps are one product. Every rule here is
   its counterpart with bd- names; the shared bits (--sb-pw, data-sb-rail) keep their Browse names
   on purpose, so the header needs one set of rules rather than two that can drift.
   ── THE PAGE WASH ── fixed, so it does not scroll its colour away and leave the lower half bare.
   z-index 0, NOT -1: negative would put it behind S.app's opaque background and be painted over. */
/* ── KEEP THIS LAYER ── A hidden tab has its compositing layers discarded, and coming back rebuilds
   them: here that means re-rasterising 80px-blurred blobs and a blend-mode stack, which shows as a
   flash on fast tab switching. translateZ(0) plus backface-visibility promotes the wash to a layer
   of its own and keeps it there; contain:paint stops its repaints escaping into the page. */
.bd-wash{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
    transform:translateZ(0);backface-visibility:hidden;contain:paint;
  background:${isDark ? "#0F0F1A" : "#FAF9F6"}}
/* EVERY sibling of the wash has to be lifted above it. A positioned layer at z-index 0 paints over
   the inline content of un-positioned blocks, and unlike Browse — where the whole page lives inside
   one .sb-layout — Build has real content outside its layout row: the step header, the title, the
   date line. Those were being painted over completely, which is a blank page with a pretty
   background on it. Excluding the three decoration layers so they keep their own z-indices (the
   shadow at 39 must stay under the panel, the gold edge at 51 above the header). */
.bd-view > *:not(.bd-wash):not(.bd-rail-shadow):not(.bd-rail-edge):not(.bd-scrim){position:relative;z-index:1}
/* Blend mode dropped in light mode — see the long note on .ei-wash span in StudioEventInfo. Same
   blobs, same near-white ground, same per-frame backdrop re-composite when they move. */
.bd-wash span{position:absolute;display:block;filter:blur(80px);
  mix-blend-mode:${isDark ? "multiply" : "normal"}}
.bd-wash-a{width:760px;height:700px;top:-190px;left:calc(var(--sb-pw) - 150px);
  border-radius:62% 38% 46% 54% / 54% 47% 53% 46%;
  background:radial-gradient(circle,rgba(201,169,110,0.38) 0%,rgba(201,169,110,0) 70%)}
.bd-wash-b{width:640px;height:700px;top:110px;right:-170px;
  border-radius:41% 59% 66% 34% / 38% 62% 38% 62%;
  background:radial-gradient(circle,rgba(214,158,140,0.32) 0%,rgba(214,158,140,0) 72%)}
.bd-wash-c{width:740px;height:660px;top:540px;left:calc(var(--sb-pw) + 12%);
  border-radius:55% 45% 33% 67% / 61% 39% 61% 39%;
  background:radial-gradient(circle,rgba(124,92,214,0.20) 0%,rgba(124,92,214,0) 74%)}
/* The strip under the bar had no blob and no band in it — the first thing the eye lands on was the
   only bare part of the page. Same drifting gradient the header carries, so they read as one. */
.bd-wash-top{position:absolute;top:0;left:0;right:0;height:330px;pointer-events:none;
  mix-blend-mode:multiply;filter:blur(34px);
  background:linear-gradient(100deg,rgba(124,92,214,0) 0%,rgba(201,169,110,0.22) 22%,
    rgba(214,158,140,0.17) 50%,rgba(124,92,214,0.19) 76%,rgba(124,92,214,0) 100%);
  background-size:230% 100%;animation:bdSheen 30s ease-in-out infinite alternate}
@keyframes bdSheen{from{background-position:0% 50%}to{background-position:100% 50%}}
/* Blurred hard, which is what turns five stroked paths into folds of light rather than five fat
   curves. An svg, not a span, so the blob rule above does not also catch it. */
.bd-bands{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:blur(24px)}
.bd-grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:${GRAIN_URL};background-size:220px 220px}
.bd-band{transform-box:view-box;transform-origin:center;will-change:transform}
.bd-band-0{animation:bdBand0 34s ease-in-out infinite alternate}
.bd-band-1{animation:bdBand1 45s ease-in-out infinite alternate}
.bd-band-2{animation:bdBand2 38s ease-in-out infinite alternate}
.bd-band-3{animation:bdBand3 53s ease-in-out infinite alternate}
.bd-band-4{animation:bdBand4 41s ease-in-out infinite alternate}
@keyframes bdBand0{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-72px,18px) scaleY(1.1)}}
@keyframes bdBand1{from{transform:translate(0,0) scaleY(1.06)}to{transform:translate(86px,-24px) scaleY(0.94)}}
@keyframes bdBand2{from{transform:translate(0,0) scaleY(0.96)}to{transform:translate(-94px,14px) scaleY(1.12)}}
@keyframes bdBand3{from{transform:translate(0,0) scaleY(1.08)}to{transform:translate(64px,-30px) scaleY(0.95)}}
@keyframes bdBand4{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-78px,22px) scaleY(1.09)}}
/* ── THE COLUMN ──
   --sb-pw is the one number: panel width AND content offset. It lives on :root because the header
   needs it too and the header is a sibling of this view, not a descendant. */
/* ── FLUID, NOT STEPPED ──
   --sb-pw used to be 392px with breakpoints stepping it to 300 and 322. Steps have CLIFFS: one pixel
   either side of a threshold gave completely different layouts, which is exactly how an iPad Pro at
   1194 ended up with the full desktop panel and a 490px work column while an iPad Air at 1180 was
   fine. clamp() removes the cliff — the panel is a share of the viewport, bounded at both ends, so
   every width in between gets something sensible without anyone having to have guessed that width.
     260px floor  — below this the filter pills stop fitting two to a row
     26vw         — the share; 310px on an 11" iPad, 374px at 1440, capped by the ceiling above that
     392px ceiling— what it was designed at; more would just be a wider photograph
   Only the OVERLAY decision keeps a breakpoint, because that is a change of behaviour rather than of
   size and there is no continuous version of it. */
:root{--sb-pw:clamp(260px, 26vw, 392px)}
.bd-view.bd-folded{--sb-pw:0px}
/* The estimate rail scales the same way, for the same reason. Inline width:258 is overridden here so
   there is one rule for it instead of a value repeated per breakpoint. */
.bd-rail-r{width:clamp(178px, 15vw, 258px) !important}
/* box-sizing explicitly: the width IS --sb-pw and the content is offset by --sb-pw, so the padding
   has to live inside that width. Left to content-box the horizontal padding makes the real panel
   wider than the offset and the curve sits on top of the first column of cards.
   Extra right padding because the curve eats that edge — a control under it would be unreachable. */
/* The rail itself does NOT scroll — overflow:hidden. Its job is the ground: the gradient, the
   photograph, the curve, all running the full height of the viewport and passing behind the bar.
   The SCROLLING happens in .bd-rail-scroll below, which starts beneath the header. */
.bd-rail-l{position:fixed !important;left:0;top:0;box-sizing:border-box;
  width:var(--sb-pw) !important;height:100vh;height:100svh !important;max-height:none !important;
  border-radius:0;clip-path:url(#bdBrandCurve);z-index:40;
  background:linear-gradient(160deg,#0F0F1A 0%,#191430 52%,#241a46 100%);
  padding:0;overflow:hidden;isolation:isolate}
/* ── WHY THE SCROLLER IS ITS OWN BOX ──
   The rail used to scroll itself, with padding-top clearing the header. Padding scrolls away with
   the content — so the moment you moved the panel, "YOUR EVENT" and Hide rode up INTO the header
   band. The bar is transparent over this column, so nothing hid them: they landed on top of the
   logo and the Studio/IMS chips.
   Absolutely positioned with top set to the measured header height, the scrollport simply BEGINS
   below the bar. Content cannot reach that band because the box it lives in does not extend into
   it — no padding to scroll away, and nothing to get the sums wrong.
   Horizontal padding moved here with it; the right side stays generous because the curve eats that
   edge and a control under it would be unreachable. */
/* overscroll-behavior:contain is the important one. Without it, reaching the end of the panel's
   scroll CHAINS the gesture to the page — so scrolling the filters up carried on into the document
   and took the whole screen with it, which on iOS the rubber-band then exaggerates. contain stops
   the scroll at this box's own ends.
   -webkit-overflow-scrolling:touch restores momentum inside the panel on iOS; without it a nested
   scrollport there feels stuck compared to the page. */
.bd-rail-scroll{position:absolute;left:0;right:0;bottom:0;z-index:2;
  overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
  scrollbar-width:none;
  padding:14px 68px 20px 22px;display:flex;flex-direction:column;gap:14px}
.bd-rail-scroll::-webkit-scrollbar{display:none}
.bd-rail-img{position:absolute;inset:-4%;z-index:0;background-size:cover;background-position:center}
.bd-rail-veil{position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(180deg,rgba(9,9,20,0.66) 0%,rgba(11,9,24,0.52) 42%,rgba(9,9,20,0.34) 72%,rgba(9,9,20,0.46) 100%)}
/* A lit edge down the left, so the panel catches light on one side instead of reading as a cut-out. */
.bd-rail-l::after{content:"";position:absolute;top:0;bottom:0;left:0;width:1px;z-index:3;
  pointer-events:none;background:linear-gradient(180deg,transparent,rgba(255,255,255,0.14) 22%,rgba(255,255,255,0.14) 78%,transparent)}
/* The cast shadow. Not box-shadow — the clip-path cuts that away with the shape, so it would trace
   a rectangle rather than the curve. The same path, filled once and blurred. */
/* z-index 0, not Browse's 39. Build's panel lives INSIDE .bd-layout, which the lift rule above puts
   at z-index 1 — so the shadow has to be below 1 to stay behind the panel and behind the content it
   bleeds onto. It still lands above the wash, which is also 0 but earlier in the DOM. */
.bd-rail-shadow{position:fixed;top:0;left:0;width:var(--sb-pw);height:100vh;height:100svh;z-index:0;
  pointer-events:none;filter:blur(24px);opacity:.55;transform:translateX(9px)}
.bd-rail-shadow svg{display:block;width:100%;height:100%}
/* The gold line on the seam. Above the header (50) so the bar's 3px overlap cannot bury it.
   vector-effect pins the stroke to screen pixels — without it, stretching a 1x1 box to the panel
   stretches the stroke into a wedge. overflow visible because the path sits ON x=1, so half the
   stroke falls outside the viewBox and would be clipped away down its whole length. */
.bd-rail-edge{position:fixed;top:0;left:0;width:var(--sb-pw);height:100vh;height:100svh;z-index:51;
  pointer-events:none;filter:drop-shadow(0 0 5px rgba(201,169,110,0.45)) drop-shadow(0 0 14px rgba(201,169,110,0.22))}
.bd-rail-edge svg{display:block;width:100%;height:100%;overflow:visible}
/* ── GLASS ──
   A light film, not a dark one: on near-black ink a darker card is a darker rectangle on a dark
   rectangle. Heavy blur so what shows through is colour and not detail, saturation past 100 so the
   candlelight stays warm, a diagonal sheen because a flat fill never looks like a pane, and a bright
   top edge over a dark cast to put it ABOVE the panel rather than in it. */
.bd-rail-l .sb-panel{backdrop-filter:blur(26px) saturate(165%);-webkit-backdrop-filter:blur(26px) saturate(165%);
  background-image:linear-gradient(147deg,rgba(255,255,255,0.11) 0%,rgba(255,255,255,0.025) 46%,rgba(255,255,255,0.06) 100%) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(255,255,255,0.05),
    0 2px 6px rgba(0,0,0,0.34), 0 22px 48px -16px rgba(0,0,0,0.8)}
.bd-rail-l .sb-panel::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:4;
  border-radius:inherit;
  background:radial-gradient(130% 62% at 0% 0%,rgba(201,169,110,0.15) 0%,rgba(201,169,110,0.04) 38%,transparent 68%)}
/* ── THE PANEL MUST NOT BE THE SHOCK ABSORBER ──
   The rail is a fixed-height flex column, and the filter card was its only child that could shrink:
   the event block and the reference card are both flex-shrink:0. So on a shorter window everything
   that did not fit came out of the filters, and they collapsed to a single VENUE row with a
   scrollbar — while the video above them kept every pixel.
   It no longer shrinks, and its inline max-height (set from the sticky-rail measurement, which
   stopped meaning anything once the rail became fixed and full-height) is dropped. The rail's own
   overflow-y handles the overflow, so there is ONE scrollbar for the column instead of a scrollport
   nested inside a scrollport. */
.bd-rail-l .sb-panel{max-height:none !important;flex:0 0 auto}
.bd-rail-l .sb-panel .sb-scroll{overflow:visible !important;max-height:none !important}
.bd-rail-l .sb-panel .sb-head{border-radius:8px}
.bd-rail-l .sb-panel .sb-scroll > div{border-bottom-color:rgba(255,255,255,0.13) !important}
.bd-rail-l .sb-rcard{backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);
  background:${pCard} !important;border:1px solid ${pBorder} !important;color:${PANEL_INK};
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 26px -12px rgba(0,0,0,0.7)}
/* ── THE HEADER, OVER THE PANEL ──
   Done in the header's OWN background rather than by blanking it and repainting with a pseudo —
   that leaves the bar with no background at all, and one thing going wrong drops the whole header
   onto the page. The var() fallback is the safety: if --sb-pw ever fails to resolve it reads 0px,
   both stops collapse to the left edge, and the bar paints solid across its full width.
   The cut starts 3px early because the panel's edge is a CURVE and this cut is a straight line — by
   the bottom of the bar the curve has drawn in to ~99.4%, and a cut at exactly --sb-pw left a strip
   of page showing between them. The overlap lands on panel ink, which is dark either way.
   background-origin AFTER the shorthand, because the shorthand resets it — and it must be
   border-box, or the 24px of header padding shifts the whole gradient and reopens the gap. */
:root[data-sb-rail="1"] .sa-sheen{left:var(--sb-pw,0px) !important}
:root[data-sb-rail="1"] .sa-fnrow{margin-left:var(--sb-pw,0px);flex-basis:calc(100% - var(--sb-pw,0px)) !important}
:root[data-sb-rail="1"] .sa-header{box-shadow:none !important;border-bottom-color:transparent !important;
  background:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--sb-pw,0px) - 3px),
    ${isDark?"#0A0A14":"#0A0619"} calc(var(--sb-pw,0px) - 3px),${isDark?"#07070D":"#130A2E"} 100%) !important;
  background-origin:border-box !important}
/* ── THE TITLE ──
   Same display serif as Event Info's and Browse's, so the four steps are set in one voice.
   !important because StudioApp sets font-family on the universal selector with !important.
   The rule beneath is Event Info's: a solid run, a diamond, then a fade, so it does not read as an
   underline that got cut off. */
.bd-hero-face{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif !important;font-style:italic}
.bd-title-rule{display:flex;align-items:center;gap:9px;margin-top:14px;width:100%;max-width:520px}
.bd-tr-seg{height:2.5px;border-radius:2px;width:80px;flex-shrink:0;background:${isDark?"#D9BE86":"#8A6A2F"}}
.bd-tr-dia{width:8px;height:8px;flex-shrink:0;transform:rotate(45deg);background:${isDark?"#D9BE86":"#8A6A2F"}}
.bd-tr-fade{height:2.5px;border-radius:2px;flex:1;
  background:linear-gradient(90deg,${isDark?"#D9BE86":"#8A6A2F"},${isDark?"#D9BE86":"#8A6A2F"}A6 58%,transparent)}
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
/* ══════════════ RESPONSIVE ══════════════
   Build is the tightest screen in Studio: a 392px fixed panel on the left and a 258px estimate rail
   on the right, either side of the zone column. That is 650px of furniture, which a desktop absorbs
   and nothing smaller can.
   The panel keeps its whole design at every size — curve, photograph, gold edge. What changes is
   whether it RESERVES space or OVERLAYS it, and that is the only honest lever: below about 840 there
   is not enough width for both a column of filters and a column of work.
   The desktop scrim never renders (display:none) — there is nothing behind the panel there. */
.bd-scrim{display:none}
/* ── THE ▦ GRID SIZES ITSELF ──
   A fixed 8 columns is the same trap as a fixed panel width: right at one screen size, wrong at
   every other, and it needed a breakpoint per size to paper over. auto-fill with a floor lets the
   column COUNT fall out of the width that is actually there — 8 across on a desktop, 6 on an 11"
   iPad, fewer on a narrow one — without anyone naming those widths.
   The floor protects the photograph: below about 112px a thumbnail is too small to judge a stage
   from, which is the whole point of the picker. */
.ph-grid-wide{grid-template-columns:repeat(auto-fill,minmax(112px,1fr)) !important}
/* Filter pills the same way. Two to a row needs ~112px each, and auto-fill drops to one by itself
   when the panel is at its 260px floor — which beats three columns of overlapping "Ring Ceremony". */
.bd-rail-l [id^="sb-sec-"]{grid-template-columns:repeat(auto-fill,minmax(112px,1fr)) !important}
/* Padding follows the panel: a share of its width rather than three hand-set values, so the gutter
   the curve needs stays proportional at every size. */
.bd-rail-scroll{padding:14px calc(var(--sb-pw) * 0.17 + 6px) 20px calc(var(--sb-pw) * 0.055 + 6px)}
/* ── THE ESTIMATE RAIL GOES FIRST ──
   Below this the zone column is the thing under pressure, and of the two rails the estimate is the
   one you read rather than work in. It unpins and stacks under the build, which hands its 208px
   back to the zones while the filter panel is still a column. */
@media (max-width:1080px){
  .bd-layout{flex-wrap:wrap}
  .bd-rail-r{width:100% !important;position:static !important;max-height:none !important;order:2}
}
/* ── PORTRAIT TABLET ──
   The panel stops reserving and starts overlaying: the zone column gets the full width, the panel
   gets its real width back, and only one of them is in front of you at a time — which is how they
   are used anyway. It also starts closed here (see the leftRailOpen initialiser).
   The right rail unpins and stacks: a sticky full-width block would otherwise pin itself over the
   zones as you scroll past. Its inline maxHeight goes with the sticky it was computed for. */
/* 900, and it is DERIVED rather than picked. The panel's clamp floors at 260, the gutter is 30, the
   estimate rail floors at 178 and a zone card needs about 420 to hold its four photo tiles and its
   controls: 260 + 30 + 420 + 178 + 22 of gaps = 910. So below roughly 900 the two cannot both have
   what they need, which is precisely the point at which reserving has to give way to overlaying.
   The old 840 was a guess, and between 840 and 900 it left the work column about 370px — narrower
   than the cards inside it. Change the clamp floors above and this number should move with them. */
@media (max-width:900px){
  /* Once it overlays, the panel is no longer competing for width, so it takes its own share of the
     viewport rather than a share of a layout it has left. min() keeps it on screen on a phone. */
  :root{--sb-pw:min(340px, 86vw)}
  .bd-layout{flex-direction:column;gap:16px !important;margin-left:0 !important}
  .bd-head{margin-left:0 !important}
  .bd-rail-r{width:100% !important;position:static !important;max-height:none !important}
  .bd-scrim{display:block;position:fixed;inset:0;z-index:38;
    background:rgba(6,6,14,0.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
  /* The STRIP still needs a count, because PH_PER_PAGE pages it four at a time — auto-fill here
     would put four items on two ragged rows. The ▦ grid above stays fluid. */
  .ph-grid:not(.ph-grid-wide){grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:10px !important}
  /* The zone header carries a name, a count, Details, Update master and six controls. It has to be
     allowed to wrap here or the controls run off the card. */
  .zone-head{flex-wrap:wrap;row-gap:8px}
}
/* ── PHONE ──
   One reference at a time in the strip. Everything else has already scaled itself by now. */
@media (max-width:620px){
  .ph-grid:not(.ph-grid-wide){grid-template-columns:minmax(0,1fr) !important}
}
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
/* Zone rows carry a lot of small controls — steppers, toggles, chips. Give them a tap target
   without redrawing the rows. Inputs go to 16px because anything smaller makes iOS Safari zoom
   the whole page on focus, which on this screen throws the layout completely. */
@media (pointer: coarse){
  .zone-row button,.sec-tile,.sb-pill{min-height:34px}
  .el-grid button{min-height:36px}
  input,select,textarea{font-size:16px}
}
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
/* ═══ GROUPING TICK ═══ It sits on top of a tile that is itself clickable for something else, so
   it needs its own hover as well as its own cursor — otherwise there is nothing to tell you the
   corner of the photo does a different thing from the middle of it. */
.ph-tick:hover{transform:scale(1.22);background:${accent} !important;border-color:#fff !important}
.ph-tile:hover .ph-tick{border-color:${accent} !important}
/* The star is a control, so it has to answer the cursor — otherwise it reads as a status dot and
   nobody discovers they can click it. */
.ph-star{transition:transform .14s ease, box-shadow .16s ease}
.ph-star:hover{transform:scale(1.18)}
.ph-star:active{transform:scale(1.02)}
@media (prefers-reduced-motion: reduce){
  .ph-tile,.ph-tile img{transition:none}
  .ph-tile:hover,.ph-tile:hover img{transform:none}
  .ph-tick{transition:none}
  .ph-tick:hover{transform:none}
  .ph-star{transition:none}
  .ph-star:hover,.ph-star:active{transform:none}
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
/* The estimate's loading bars, shown until every rate table has landed — see pricingReady in
   StudioApp. Opacity only, so it costs nothing to composite and cannot shift the layout it sits in.
   Held still under reduced-motion: the bar's shape already says "not a number yet", so the pulse is
   decoration rather than the message. */
@keyframes pt-pulse{0%,100%{opacity:1}50%{opacity:0.45}}
@media (prefers-reduced-motion: reduce){[style*="pt-pulse"]{animation:none !important}}
/* clickable inline-styled divs (wall chips, pickers) — same ring so nothing is left dead */
.zone-row div[style*="cursor:pointer"]:not([style*="padding:14px"]):hover{box-shadow:0 0 0 2px ${accent}55 !important;border-radius:7px}
/* ═══ ZONE UPLOAD ═══ It sits on its own strip now, outside .zone-row, so none of the rules above
   reach it — on its own against the page background it read as a static label. Fills in on hover
   and presses on click. Skipped mid-upload: the control is inert then, so it must not invite a
   second click. */
.zone-upload{transition:filter .15s ease,background .15s ease,border-color .15s ease,transform .12s ease,box-shadow .15s ease}
/* data-busy="0" is exactly the state where the button is a SOLID accent fill, so the old faint-tint
   hover would have washed it out. Brighten and lift instead. */
.zone-upload[data-busy="0"]:hover{filter:brightness(1.08);transform:translateY(-1px);
  box-shadow:0 5px 14px -4px ${isDark?"rgba(0,0,0,0.65)":"rgba(201,169,110,0.8)"} !important}
.zone-upload[data-busy="0"]:active{transform:translateY(0) scale(.98);box-shadow:none}
.zone-upload:focus-within{outline:2px solid ${accent};outline-offset:2px}
undefined
@media (prefers-reduced-motion: reduce){
  .zone-row button,.zone-row select,.zone-row input,.zone-row span[title],.zone-row img,.zone-upload{transition:none}
  .zone-row button:not(:disabled):hover,.zone-row button:not(:disabled):active{transform:none}
  .zone-upload:hover,.zone-upload:active{transform:none}
}
@media (prefers-reduced-motion: reduce){
  .el-row,.el-row::before{transition:none}
  .el-row:hover,.el-row:active{transform:none}
  /* the spine still appears, it just does not grow into place */
  .el-row:hover::before{transform:scaleY(1)}
}
` + `@media (prefers-reduced-motion: reduce){.sb-pill,.sb-head,.sb-search,.sb-rcard{transition:none}.sb-pill:hover,.sb-pill:active,.sb-rcard:hover{transform:none}}`}</style>
    {/* The page's own ground — see .bd-wash. Never receives a click. */}
    <div className="bd-wash" aria-hidden="true">
      <span className="bd-wash-a"/><span className="bd-wash-b"/><span className="bd-wash-c"/>
      <div className="bd-wash-top"/>
      <svg className="bd-bands" viewBox="0 0 1200 960" preserveAspectRatio="none" focusable="false">
        {WASH_BANDS.map((b,i)=>(
          <path key={i} className={"bd-band bd-band-" + i} d={b.d} fill="none" stroke={b.c}
            strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
        ))}
      </svg>
      <i className="bd-grain"/>
    </div>
    {/* The panel's cast shadow and its gold edge. Both live OUTSIDE the rail: the rail is clipped by
        the curve, so a shadow inside it would be cut away with the shape and the line would be
        sliced in half down its own middle. */}
    {/* Tablet and phone only (display:none above 840). Once the panel overlays the build, it needs
        a way out that is not the Hide button behind it, and the page behind needs to read as parked
        rather than as competing. */}
    {leftRailOpen && <div className="bd-scrim" onClick={()=>setLeftRailOpen(false)} aria-hidden="true"/>}
    {leftRailOpen && <div className="bd-rail-shadow" aria-hidden="true">
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" focusable="false"><path d={BD_CURVE} fill="#0B0B16"/></svg>
    </div>}
    {leftRailOpen && <div className="bd-rail-edge" aria-hidden="true">
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="bdEdgeGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C9A96E" stopOpacity="0.30"/>
            <stop offset="0.16" stopColor="#E4C88F" stopOpacity="0.80"/>
            <stop offset="0.44" stopColor="#F0DCAC" stopOpacity="1"/>
            <stop offset="0.72" stopColor="#D9BE86" stopOpacity="0.82"/>
            <stop offset="1" stopColor="#C9A96E" stopOpacity="0.26"/>
          </linearGradient>
        </defs>
        <path d={BD_EDGE} fill="none" stroke="url(#bdEdgeGold)" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
      </svg>
    </div>}
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
    {/* The event block that used to live here — greeting, venue, date, demand — has moved INTO the
        panel (see YOUR_EVENT, rendered at the top of the rail). It is what the panel is for: whose
        event this is. Out here it was a page heading pushing the zone list down, and it had to be
        offset past a fixed panel to be visible at all. */}
    {/* ═══ TWO-COLUMN SHELL ═══ Photo filters live permanently in a sticky left rail, exactly
        as on Browse — always visible, no toggle. ═══ */}
    {/* The content clears the fixed panel. --sb-pw is the one number: panel width and content
        offset. The offset is the panel width PLUS a gutter, not equal to it — the curve reaches the
        panel's full width at its top and bottom, so content starting exactly at --sb-pw touches it
        there. z-index 1 lifts the column above the fixed wash, which sits at 0. */}
    <div className="bd-layout" style={{display:"flex",gap:leftRailOpen||rightRailOpen?22:12,alignItems:"flex-start",
      marginLeft:leftRailOpen?"calc(var(--sb-pw) + 30px)":0,position:"relative",zIndex:1}}>
      {leftRailOpen
        ? <div ref={railRef} className="bd-rail bd-rail-l" style={{flexShrink:0,alignSelf:"flex-start"}}>
            {/* The curve and the photograph, exactly as Browse draws them. */}
            <svg width="0" height="0" style={{position:"absolute",pointerEvents:"none"}} aria-hidden="true" focusable="false">
              <defs><clipPath id="bdBrandCurve" clipPathUnits="objectBoundingBox"><path d={BD_CURVE}/></clipPath></defs>
            </svg>
            {PANEL_BG && <div className="bd-rail-img" style={{backgroundImage:`url(${PANEL_BG})`}} aria-hidden="true"/>}
            <div className="bd-rail-veil" aria-hidden="true"/>
            {/* top is the MEASURED header height, so the scrollport begins below the bar and its
                contents can never travel into it — see .bd-rail-scroll. */}
            <div className="bd-rail-scroll" style={{top:hdrH}}>
            {/* ═══ YOUR EVENT ═══
                Everything that used to be the page's own heading. Restacked as one fact per row:
                across the main column it was a single wrapping sentence, which at 300px would break
                in a different place every time a chip appeared or a date changed. Same values, same
                conditions — venue/type, date, guests, then the demand notes — only the arrangement
                differs.
                Hide shares the title's row rather than owning one above it: on its own it spent a
                whole 26px band on one small control and pushed everything below it down. It closes
                the panel, so it belongs on the panel — in the FLOW, not absolutely positioned (the
                rail's content starts where anything pinned there would, so an absolute one lands on
                top of the first block) and not up in the header band either, where the bar is only
                transparent and still swallows the click.
                alignItems:flex-start keeps it level with the eyebrow, not floating beside a 30px
                serif line. */}
            <div style={{flexShrink:0,paddingBottom:2}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,marginBottom:6}}>
                <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1.6,textTransform:"uppercase",color:accent,paddingTop:3}}>Your event</div>
                <button type="button" onClick={()=>setLeftRailOpen(false)}
                  title="Hide the filters and widen the build"
                  style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:8,flexShrink:0,
                    cursor:"pointer",whiteSpace:"nowrap",border:`1px solid ${pBorder}`,
                    background:"rgba(0,0,0,0.34)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",
                    color:pTextM,fontSize:10.5,fontWeight:600,letterSpacing:0.2}}>
                  {/* Rotated to point left — the direction the panel collapses in. */}
                  <span style={{display:"inline-flex",transform:"rotate(90deg)"}}><IconChevron size={10}/></span>Hide
                </button>
              </div>
              <div className="bd-hero-face" style={{fontSize:30,fontWeight:600,color:PANEL_INK,letterSpacing:-0.3,lineHeight:1.08,marginBottom:14}}>
                {clientName ? <>Welcome, {clientName}</> : "Build Your Decor"}
              </div>
              {(()=>{
                const row=(icon,text,tone)=>(
                  <div style={{display:"flex",alignItems:"center",gap:9,fontSize:12.5,lineHeight:1.35,color:tone||PANEL_INK}}>
                    <span style={{display:"inline-flex",flexShrink:0,color:tone||accent}}>{icon}</span>
                    <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{text}</span>
                  </div>
                );
                const dd = dateDemand;
                return <div style={{display:"flex",flexDirection:"column",gap:9}}>
                  {/* Venue/type and the date share a row — they are the two halves of "which event",
                      and stacked they spent two lines saying it. Wraps back to two on a narrow
                      panel rather than truncating either one.
                      No guest count: it is set on Event Info and not used anywhere in this step's
                      work, so in the panel it was a number with nothing to do. */}
                  <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",rowGap:9}}>
                    {row(<IconPalette size={14}/>, `${activeFnMeta.venue || venue} · ${activeFnMeta.type || fn}`)}
                    {clientDate && row(<IconCalendar size={14}/>, new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}))}
                  </div>
                  {dd?.isHigh && row(<IconAlert size={14}/>, "High demand", "#F87171")}
                  {dd?.isMod && row(<IconAlert size={14}/>, "Moderate demand", "#FBBF24")}
                  {(()=>{
                    if(!clientDate||!dd) return null;
                    const {dt,booked,ongoing}=dd;
                    const dtLabel=dt==="saya"?"Saya Day":dt==="competition"?"Competition Day":"";
                    return <>
                      {dtLabel && row(<IconAlert size={14}/>, dtLabel, dt==="saya"?"#F87171":pTextM)}
                      {booked>0 && row(<IconCheck size={14}/>, `${booked} booked`, "#34D399")}
                      {ongoing>0 && row(<IconRepeat size={14}/>, `${ongoing} ongoing`, "#FBBF24")}
                    </>;
                  })()}
                  {extraFunctions.length>0 && row(<IconSparkle size={14}/>, `Function ${activeFnIdx+1} of ${extraFunctions.length+1}`, accent)}
                </div>;
              })()}
            </div>
            {ZP_PANEL}
          {/* Reference banner — moved out of the main column into the rail, under the filters, so
              the zones start at the top of the page instead of below a full-width header. Restacked
              for the 258px column: media on top, details beneath. */}
    {/* ═══ SOURCE EVENT BANNER ═══ */}
    {sourceEvent&&<div className="sb-rcard" style={{...S.card,marginBottom:0,overflow:"hidden",flexShrink:0}}>
      <div style={{display:"flex",flexDirection:"column",gap:0}}>
        <div style={{width:"100%",height:140,flexShrink:0,position:"relative",background:sourceEvent.gradient,overflow:"hidden"}}>
          <LazyYT src={sourceEvent.video} gradient={sourceEvent.gradient} poster={sourceEvent.img||sourceEvent.photos?.[0]} title={sourceEvent.name} style={{position:"absolute",inset:0}}/>
        </div>
        <div style={{flex:1,padding:"10px 12px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:6,marginBottom:6}}>
            <div>
              <div style={{fontSize:9,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:3}}>Building from reference</div>
              {/* ONE line, ellipsised. These are raw YouTube titles — the one on screen runs to
                  fifteen words — and left to wrap they took three or four lines of panel to say
                  something the first few words already identify. nowrap rather than a 1-line clamp:
                  same result, and it does not depend on the -webkit-box display mode.
                  The full title is on the element, so hovering still gives you all of it. */}
              <div title={sourceEvent.name} style={{fontSize:12.5,fontWeight:700,lineHeight:1.4,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sourceEvent.name}</div>
              <div style={{fontSize:11,color:textS,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sourceEvent.venue} · {sourceEvent.fn} · {sourceEvent.space}</div>
            </div>
            {/* The running total lives in the Live Estimate rail, which is on screen the whole
                time — repeating it here just gave the same number two homes. Only the tier chip
                stays, since the rail states it once and this is where the reference is judged. */}
            {/* One row across the full width of the card, not a stacked column: the tier chip on the
                left and Upload hard against the right edge. flexBasis 100% is what drops it onto its
                own line — the parent wraps — so the two sit on the card's own axis rather than being
                squeezed into whatever the title left over.
                justifyContent follows the chip: with pricing hidden there is no chip, and
                space-between on a single child would park Upload at the LEFT. */}
            <div style={{display:"flex",alignItems:"center",gap:8,flexBasis:"100%",width:"100%",
              justifyContent:showCosts?"space-between":"flex-end"}}>
              {showCosts&&<span style={{fontSize:9.5,padding:"2px 8px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>}
              {BANNER_UPLOAD}
            </div>
          </div>
          {/* Description and tag chips dropped, matching the Browse cards. In a 258px rail they were
              three more stacked rows under a title that already names the reference, and they pushed
              the filters — the thing you actually work with — further down. The tags still live on
              the video and still drive the filters in the panel above. */}
          {sourceEvent.photos?.length>0&&<div style={{display:"flex",gap:5,marginTop:7,overflowX:"auto"}}>
            {sourceEvent.photos.map((p,i)=><img key={i} src={p} alt="" loading="lazy" style={{width:54,height:36,objectFit:"cover",borderRadius:6,flexShrink:0,cursor:"pointer",border:`2px solid ${border}`}} onClick={()=>setPreviewImg(p)} onError={e=>{e.target.style.display="none"}}/>)}
          </div>}
        </div>
      </div>
    </div>}
    {/* ═══ SOURCE VIDEO BANNER ═══ Rebuilt on LazyYT (the same component the reference banner above
        uses) instead of a hand-rolled thumbnail + Play/Copy buttons. The old version only showed a
        thumbnail at all when `vid?.thumb` happened to resolve (allVideos containing this id with a
        thumb field) — anything short of that (video not in allVideos yet, thumb missing) silently
        fell back to a bare text stack with no image area, which is what made this banner look broken
        next to the reference banner's version. LazyYT already handles its own poster/gradient
        fallback, click-to-play-inline, a fullscreen expand button and its own copy-link footer bar —
        reusing it gives this banner the same reliability, not just the same look. */}
    {sourceVideo&&!sourceEvent&&(()=>{
      const vTag=ytVideoTags[sourceVideo.id]||{};
      const vid=allVideos.find(v=>v.id===sourceVideo.id);
      const embedUrl=sourceVideo.id?`https://www.youtube.com/embed/${sourceVideo.id}`:null;
      const title=sourceVideo.title||vid?.title||"Video";
      // Mirrors the reference banner's subtitle line (venue · fn · space) with whatever the
      // video's own tags give us, instead of the old full tag-chip wall (tier + every color +
      // every style + io) that made this card read as a tagging summary rather than a source card.
      const subLine=[vTag.tier,vTag.io].filter(Boolean).join(" · ");
      return <div className="sb-rcard" style={{...S.card,marginBottom:0,overflow:"hidden",flexShrink:0}}>
        <div style={{display:"flex",flexDirection:"column",gap:0}}>
          <div style={{width:"100%",height:140,flexShrink:0,position:"relative",background:"linear-gradient(135deg,#1a1a2e,#C9A96E)",overflow:"hidden"}}>
            <LazyYT src={embedUrl} gradient="linear-gradient(135deg,#1a1a2e,#C9A96E)" poster={vid?.thumb} title={title} style={{position:"absolute",inset:0}}/>
          </div>
          <div style={{flex:1,padding:"10px 12px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:6,marginBottom:6}}>
              <div>
                <div style={{fontSize:9,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:3}}>Building from video</div>
                <div title={title} style={{fontSize:12.5,fontWeight:700,lineHeight:1.4,
                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
                {subLine&&<div style={{fontSize:11,color:textS,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{subLine}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexBasis:"100%",width:"100%",
                justifyContent:showCosts?"space-between":"flex-end"}}>
                {showCosts&&<span style={{fontSize:9.5,padding:"2px 8px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>}
                {BANNER_UPLOAD}
              </div>
            </div>
          </div>
        </div>
      </div>;
    })()}
            </div>{/* .bd-rail-scroll */}
          </div>
        : railTab("left","Photo filters",<IconSliders size={14}/>)}
      <div style={{flex:1,minWidth:0}}>

    {/* ═══ FABRIC PALETTE ═══ Brought back as a deliberately narrow control: this sets fn.fnPalette,
        which Deal Check's Truss tab (DCTrussTab.jsx) reads for its anchor colours when auto-filling
        masking/liza/curtain fabric allocation — production planning, not client-facing. It does
        NOT touch photo matching or filtering; that's the separate "Color palette" filter inside
        each zone's own Photo Filters. Was previously auto-only (from the selected video's tag,
        with no override) — this reintroduces a manual pick, per zone group's own function. */}
    {(()=>{
      const isPrimaryFn = activeFnIdx === 0;
      const current = isPrimaryFn ? (clientPalette || "Custom") : (extraFunctions[activeFnIdx - 1]?.palette || "Custom");
      const setPalette = (v) => {
        if (isPrimaryFn) setClientPalette(v);
        else setExtraFunctions(p => p.map((f, i) => i === activeFnIdx - 1 ? { ...f, palette: v } : f));
        setFabricPaletteQ(""); setFabricPaletteOpen(false);
      };
      const opts = azSort(paletteNames(imsPaletteCatalogue, taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]));
      const anchorsOf = (name) => (imsPaletteCatalogue||[]).find(p=>p.name===name)?.anchorColours;
      const matched = fabricPaletteQ.trim() ? paletteSearch(opts, fabricPaletteQ, anchorsOf) : opts;
      const optRow = (v, isCustom) => (
        <div key={v} onClick={()=>setPalette(v)} style={{padding:"5px 9px",borderRadius:6,cursor:"pointer",fontSize:11,
          fontWeight:current===v?700:isCustom?500:400,
          background:current===v?`${accent}18`:"transparent",
          color:current===v?accent:textP}}>{v}</div>
      );
      // Not covered by the isFnSwitching veil below (that wrapper starts further down, around the
      // element cards only) — without this a click landing here mid-switch set the palette on
      // whichever function the switch settles onto, not the one the user was actually looking at
      // when they clicked. Same reason for the Floral Ratio control just below.
      return <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:14,flexWrap:"wrap",
        opacity:ctx.isFnSwitching?0.45:undefined,pointerEvents:ctx.isFnSwitching?"none":undefined,transition:"opacity .15s ease"}}>
        <span style={{display:"flex",color:accent}}><IconPalette size={13}/></span>
        <span style={{fontSize:11.5,fontWeight:600,color:textP}}>Fabric Palette</span>
        <span title="Sets masking/drape colour allocation in Deal Check — doesn't affect the photo filters above" style={{fontSize:10,color:textS,cursor:"help"}}>ⓘ</span>
        <div style={{position:"relative"}}>
          <div onClick={()=>setFabricPaletteOpen(o=>!o)} title="Click to change"
            style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:8,
              border:`1px solid ${fabricPaletteOpen?accent:border}`,background:cardBg,cursor:"pointer",
              fontSize:11,fontWeight:600,color:current==="Custom"?textS:textP}}>
            {current}
            <span style={{display:"inline-flex",transform:fabricPaletteOpen?"rotate(180deg)":"none",transition:"transform .15s ease",color:textS}}><IconChevron size={10}/></span>
          </div>
          {fabricPaletteOpen&&<div style={{position:"absolute",top:"100%",left:0,zIndex:60,marginTop:4,width:230,
            background:cardBg,border:`1px solid ${border}`,borderRadius:9,boxShadow:"0 6px 20px rgba(0,0,0,0.22)",padding:8}}>
            <input autoFocus value={fabricPaletteQ} onChange={e=>setFabricPaletteQ(e.target.value)}
              placeholder="Search palettes…" style={{...S.input,fontSize:11,padding:"5px 8px",marginBottom:6,width:"100%"}}/>
            <div style={{maxHeight:220,overflowY:"auto"}}>
              {optRow("Custom", true)}
              {matched.map(v=>optRow(v))}
              {fabricPaletteQ.trim()&&matched.length===0&&<div style={{padding:"5px 9px",fontSize:10.5,color:textS}}>No matches</div>}
            </div>
          </div>}
        </div>
      </div>;
    })()}

    {/* The date-demand banner that stood here has moved up beside the date itself. */}


    {savedInsps.length>0&&<div style={{background:"#FFF1F2",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{display:"flex",gap:4}}>{savedInsps.slice(0,5).map((s,i)=><div key={i} style={{width:32,height:32,borderRadius:6,background:s.gradient||"#EDE9FE"}}/>)}</div><div style={{fontSize:12,fontWeight:600,color:"#BE123C"}}>{savedInsps.length} inspirations</div></div></div>}




    {/* ═══ FLORAL RATIO CONTROL — art/real split is a design control, show it even when costs are hidden ═══ */}
    {/* Not covered by the isFnSwitching veil below either — see the Fabric Palette comment above for why. */}
    {<div style={{borderRadius:10,padding:"13px 18px",marginBottom:14,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F9F9F9",display:"flex",alignItems:"center",gap:12,
      opacity:ctx.isFnSwitching?0.45:undefined,pointerEvents:ctx.isFnSwitching?"none":undefined,transition:"opacity .15s ease"}}>
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

    {/* While a function switch renders, the zones below still show the OLD function's build —
        React keeps the last committed UI on screen during a transition. Left unmarked that reads
        as the click having done nothing, which is what got the pills clicked again. The veil says
        the work is happening and blocks clicks that would otherwise land on the outgoing build. */}
    {ctx.isFnSwitching&&<div style={{position:"relative",zIndex:5,margin:"0 0 10px",padding:"10px 14px",borderRadius:12,border:`1px solid ${accent}55`,background:isDark?"rgba(201,169,110,0.10)":"rgba(201,169,110,0.14)",display:"flex",alignItems:"center",gap:10}}>
      <span style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${accent}44`,borderTopColor:accent,animation:"saRestoreSpin .6s linear infinite",flexShrink:0}}/>
      <span style={{fontSize:12,fontWeight:600,color:accent}}>Loading {activeFnMeta?.type || "function"}…</span>
    </div>}
    {/* ═══ ELEMENT CARDS ═══ One unified photo strip per zone (no Silver/Gold split). ═══ */}
    <div style={ctx.isFnSwitching?{opacity:0.45,pointerEvents:"none",transition:"opacity .15s ease"}:undefined}>
    {/* Every custom zone renders here now, "Other" ones included — not just duplicates of a
        standard zone. They used to get a separate, much simpler card (see git history) built before
        custom-zone photo tagging actually worked, so a photo gallery there would have shown nothing
        no matter what. Now that tagging resolves correctly (areaNamesFor / getLibPhotosForZone,
        StudioApp.jsx), there's no reason "Other" zones shouldn't get the exact same card everything
        else does — photo strip, Scale By, notes, paint allocation, all of it — instead of a second,
        drifting copy of the parts that were duplicated anyway (elements list, truss/platform). */}
    {[...zoneKeys, ...customZones.map(cz=>cz.id)].sort((a,b)=>(enabledEls[a]?0:1)-(enabledEls[b]?0:1)).map(k=>{
      const czSrc=customZones.find(cz=>cz.id===k);
      const srcType=czSrc?.sourceType||k;
      const el=czSrc?{label:czSrc.name,icon:czSrc.icon||""}:zoneLabelsD[k];
      const isOn=enabledEls[k];const isCust=customMode[k];
      // ── UPDATE MASTER — shared by the header button AND the per-tile one on the selected photo ──
      // Pulled out once so both call sites open the exact same panel on the exact same photo,
      // instead of two copies of "find the master, prefill correction" that could drift apart.
      const masterForSel = (() => {
        const selP = elSelectedPhoto[k];
        return (selP?.isLibrary && selP.eventId) ? libItems.find(i => i.id === selP.eventId) : null;
      })();
      const masterVerified = !!masterForSel?._verified;
      // masterForSel is a snapshot of THIS render's `libItems` — the lazy library cache can miss a
      // photo that only ever surfaced through the zone-strip's own server-side match query
      // (getLibPhotosForZone → zoneMatchCache), which never merges into libItems. Falling straight
      // through to "not in the library yet" on that cache miss used to silently fork a brand-new
      // duplicate master (the save path's isNewMaster branch) while the REAL master — still the one
      // every other zone/deal references by this exact id — never received the correction at all.
      // Fetching by id here first turns a cache miss into a bridge instead of a false "new photo".
      const openUpdateMaster = async () => {
        const selP = elSelectedPhoto[k];
        if (!selP?.src) return;
        const m = selP.isLibrary && selP.eventId ? (masterForSel || (await ensureLibItems([selP.eventId]))[0]) : null;
        if (!m) {
          setCorrVenueGrp("");
          setCorrectPhoto({ libId: null, zoneKey: k, name: selP.eventName || "", tags: {} });
          return;
        }
        const mv = m.tags?.venue || "";
        setCorrVenueGrp(allInhouseVenues.includes(mv) ? "inhouse" : (mv ? "outside" : ""));
        setCorrectPhoto({ libId: selP.eventId, zoneKey: k, name: m.name || "", tags: JSON.parse(JSON.stringify(m.tags || {})) });
      };
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
      // ═══ PREFERENCE RANKING ═══ Event type and colour palette are enforced as a hard filter
      // earlier (getMatchedPhotos / zpFilterPhoto) — every photo reaching this point already
      // matches both, or neither was picked, so there's nothing left to rank them by here. Venue,
      // venue type, design style and time/setting all rank instead of hiding: a photo's score is how
      // many of the ACTIVE preference dimensions it matches, highest score first; verified-first
      // still decides order within a tie, same as before. The counts feed the caption below — an
      // unlabelled list that still shows non-matches reads as the filter having quietly broken.
      const venueOn = !!(zpFilters.venue || []).length;
      const venueTypeOn = !!(zpFilters.venueType || []).length;
      const designStyleOn = !!(zpFilters.designStyle || []).length;
      const timeSettingOn = !!(zpFilters.timeSetting || []).length;
      const tierOn = !!(zpFilters.tier || []).length;
      const anyPrefOn = venueOn || venueTypeOn || designStyleOn || timeSettingOn || tierOn;
      let venuePrefCount = 0, venueTypePrefCount = 0, designStylePrefCount = 0, timeSettingPrefCount = 0, tierPrefCount = 0;
      if (anyPrefOn) {
        const byScore = new Map();
        for (const ph of matchedPhotos) {
          const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
          let score = 0;
          if (venueOn && zpVenueMatch(li)) { score++; venuePrefCount++; }
          if (venueTypeOn && zpVenueTypeMatch(li)) { score++; venueTypePrefCount++; }
          if (designStyleOn && zpDesignStyleMatch(li)) { score++; designStylePrefCount++; }
          if (timeSettingOn && zpTimeSettingMatch(li)) { score++; timeSettingPrefCount++; }
          if (tierOn && zpTierMatch(li)) { score++; tierPrefCount++; }
          if (!byScore.has(score)) byScore.set(score, []);
          byScore.get(score).push(ph);
        }
        // Verified-first runs INSIDE each score tier, so the preference still leads and verification
        // only decides the order within it. Sorting across tiers would undo the preference entirely.
        matchedPhotos = [...byScore.keys()].sort((a, b) => b - a).flatMap(s => verifiedFirst(byScore.get(s)));
      } else {
        matchedPhotos = verifiedFirst(matchedPhotos);
      }
      // The hand-picked group (Manage → Library → Grouping) outranks both venue and verified, so it
      // partitions last — someone chose these photos for this zone deliberately, which is a stronger
      // signal than any of the automatic ordering above. Re-sorted on groupRank because the sorts
      // above are stable only within their own buckets and would otherwise interleave the group.
      const groupedCount = matchedPhotos.reduce((n, ph) => n + (ph.grouped ? 1 : 0), 0);
      if (groupedCount) {
        const inGroup = [], rest = [];
        for (const ph of matchedPhotos) (ph.grouped ? inGroup : rest).push(ph);
        inGroup.sort((a, b) => (a.groupRank ?? Infinity) - (b.groupRank ?? Infinity));
        matchedPhotos = [...inGroup, ...rest];
      }
      // My own favourites (per salesperson — see saveFavPhotos) lead everything above except the
      // hand-picked group, which stays a stronger signal. Keyed by the photo's own id/src, never a
      // (photo, zone) pair, so re-tagging a photo to a different zone doesn't orphan its favourite —
      // it just keeps applying wherever the photo currently matches. Respects whatever the Photo
      // Filters already narrowed matchedPhotos to; it only reorders, it doesn't pull in anything
      // the filters excluded.
      const favKey = (ph) => ph.eventId || ph.src;
      const isMyFavPhoto = (ph) => !!favPhotos[favKey(ph)]?.[authUser?.id];
      if (matchedPhotos.some(isMyFavPhoto)) {
        const favd = [], rest = [];
        for (const ph of matchedPhotos) (isMyFavPhoto(ph) ? favd : rest).push(ph);
        matchedPhotos = [...favd, ...rest];
      }
      // Pin the last-selected photo to the FRONT of the strip (and force it in even if relevance/
      // filters would drop it), so re-opening a saved session shows the saved pick first — no
      // scrolling left/right to hunt for it. Its saved elements & dims live in zoneElements/
      // zoneConfig and are already restored; keeping it first also stops an accidental click on a
      // different photo from resetting those edits.
      // Grid view only skips this: with the whole set laid out at once, a selected tile jumping to
      // the front of the grid moved the very thing you just clicked out from under your cursor.
      // matchedPhotos is recomputed fresh every render, so toggling OFF grid view (back to the
      // strip) re-enters this branch on its own and pins the pick to the front right then — no
      // separate "reorder on view change" logic needed.
      const selP = elSelectedPhoto[k];
      if (selP?.src && !gridZones[k]) {
        const existing = matchedPhotos.find(ph => ph.src === selP.src);
        matchedPhotos = [existing || selP, ...matchedPhotos.filter(ph => ph.src !== selP.src)];
      }
      // The lightbox walks the set the photo you opened belongs to, not the whole zone. Stepping
      // out of a 5-photo group into the other 237 reads as the group having silently ended, and the
      // "1 / 242" counter says nothing about where in the group you are. Computed after every
      // reorder above (including the selected-photo pin), so a grouped photo moved to the front is
      // still counted as grouped rather than assumed to be at a fixed index.
      // With no group, everything lands in lbRest and this is the old whole-zone behaviour.
      const lbGrouped = matchedPhotos.filter(p => p.grouped);
      const lbRest = matchedPhotos.filter(p => !p.grouped);
      // Grouping selection for this zone, plus how much of it is already pinned — that decides
      // whether the bar offers to pin, to unpin, or both.
      // Grouping lives in the ▦ grid view only. The strip shows four large tiles at a time, which
      // is for judging one photo; picking a set to pin is a survey job, and that's what the grid is.
      // Keeping the ticks out of the strip also keeps its tiles free of a control that competes
      // with the click that actually selects a photo for pricing.
      // Grouping is on for every zone, Installations included. It was briefly off there, while the
      // multi-photo merge was on, because both showed as ticks and one zone offering two different
      // kinds of tick is genuinely confusing. With the merge now off (see isMultiPhotoZone in
      // StudioApp) there is only one kind left, and pinning is worth having everywhere: it reorders
      // the picker, it does not touch the build.
      const grpOn = !!gridZones[k];
      const grpPicked = grpOn ? grpSelFor(k) : EMPTY_SET;
      const grpArea = groupAreaFor(srcType, el.label);
      // The EXACT list for this function, not groupIdsFor's any-function fallback.
      const grpSaved = zoneGroups?.[grpArea]?.[groupFn] || [];
      const isDuplicate=!!czSrc?.sourceType;
      return(<div key={k} id={`zone-${k}`} className="zone-row" style={{background:isOn?cardBg:isDark?"#12121F":"#FAFAFA",borderRadius:14,border:isOn?`2px solid ${isDuplicate?"#C9A96E":"#444"}`:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(26,26,46,0.09)"}`,marginBottom:10,overflow:"hidden"}}>
        {/* Only the Details chip collapses an open zone. The whole header used to do it, so any
            stray click — on the name, the summary text, the empty space — folded the zone away
            mid-edit. An OFF zone still switches on from anywhere in the row, since there is nothing
            to lose there and it makes the row an easy target. */}
        <div className="zone-head" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",cursor:isOn?"default":"pointer"}} onClick={()=>{ if(!isOn) toggleEl(k); }}>
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
            {/* No "Duplicate" chip — the name already says "Stage (2)", so the chip only repeated it.
                A true custom ("Other") zone gets one, though — nothing else marks its name as
                salesperson-typed rather than an admin-curated zone type. */}
            {czSrc&&!czSrc.sourceType&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:6,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS,flexShrink:0}}>Custom</span>}
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleZoneCollapse(k);}} title={isCollapsed(k)?"Show details & pricing":"Hide details & pricing"} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,fontWeight:600,color:isCollapsed(k)?textS:accent,padding:"3px 9px",borderRadius:9,border:`1px solid ${isCollapsed(k)?border:accent+"60"}`,background:isCollapsed(k)?"transparent":accent+"12",flexShrink:0,whiteSpace:"nowrap"}}><span style={{display:"inline-flex",transform:isCollapsed(k)?"rotate(-90deg)":"none",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span>Details</span>}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {/* Zone total removed from the header. The Live Estimate rail already breaks the deal
                down BY ZONE and is on screen the whole time, so this was the same figure in two
                places — and it sat in the row of controls, where a number reads as another button. */}
            {/* Photo-strip controls. They live up here rather than in the strip's own header so the
                zone's whole control set sits in one row. stopPropagation because an OFF zone's
                header toggles the zone — but these only render when it is already on. */}
            {/* ── UPDATE MASTER ──
                Moved here from the far right under the photo strip, where it sat on its own away
                from every other control for this zone. It acts on the SELECTED photo, so it belongs
                with the rest of the zone's controls, immediately left of the grid toggle.
                Permanent correction (Phase 1b) — pushes the corrected tags + element list back to
                the master library photo so the fix sticks for everyone. Shown for ANY selected photo
                while CORRECTION_MODE is on: if the photo isn't a Library photo yet (fresh upload,
                event photo), the save path creates a new Library entry rather than updating one.
                stopPropagation because an OFF zone's header toggles the zone. */}
            {isOn&&CORRECTION_MODE&&elSelectedPhoto[k]?.src&&(
              <button onClick={e=>{e.stopPropagation();openUpdateMaster();}} title={masterForSel
                ? "Correct this photo's tags + elements and save back to the shared library photo (permanent, for everyone)"
                : "This photo isn't in the shared library yet — tag it and it will be added (permanent, for everyone)"}
                style={{...S.btn(false),display:"inline-flex",alignItems:"center",gap:5,fontSize:10,padding:"4px 10px",border:`1px solid ${masterVerified?"#059669":"#7C3AED"}`,color:masterVerified?"#059669":"#7C3AED",fontWeight:600}}>
                <IconPencil size={11}/>Update master
              </button>
            )}
            {/* Entering the grid pre-loads the ticks from whatever's already pinned, so tick/untick
                always acts on the FULL current membership, not a blank slate — ticking more adds,
                unticking a pinned one removes, both auto-saved. Leaving the grid hides the ticks, so
                drop the (already-saved) selection with them — nothing left to act on unseen. */}
            {isOn&&<button onClick={e=>{e.stopPropagation();setGridZones(g=>{
              const on=!g[k];
              if(on){
                // Whatever's actually driving this zone's build right now shouldn't have to be
                // re-found and re-ticked by hand — it starts TICKED. It does not start SAVED.
                // Opening a grid is not a request to pin anything, and it used to write: the tick set
                // was persisted here, so merely looking at a zone's photos pinned whatever was
                // selected into that zone's permanent group. Retag the photo afterwards and it kept
                // showing up, because group membership does not follow tags.
                // The auto-ticked ids go into grpAuto and are excluded from every save until the user
                // toggles one by hand.
                const initial=new Set(grpSaved);
                const auto=new Set();
                if(isMultiPhotoZone(el.label)){
                  (elMultiPhotos[k]||[]).forEach(p=>{ if(p?.eventId && !initial.has(p.eventId)){ initial.add(p.eventId); auto.add(p.eventId); } });
                } else {
                  const selP=elSelectedPhoto[k];
                  if(selP?.eventId && !initial.has(selP.eventId)){ initial.add(selP.eventId); auto.add(selP.eventId); }
                }
                setGrpSel(p=>({...p,[k]:initial}));
                setGrpAuto(p=>({...p,[k]:auto}));
              } else hideGrpPick(k);
              return {...g,[k]:on};
            });
            // Back to page 1. The two views hold different numbers per page (4 against 80), so a
            // carried-over index means "page 6" lands on a completely different stretch of the same
            // list depending on which view you were in when you set it.
            setPhPage(p=>({...p,[k]:0}));}} title={gridZones[k]?"Show as strip":"Show all in a grid — pick photos to pin here"} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${gridZones[k]?accent:border}`,background:gridZones[k]?`${accent}15`:"transparent",color:gridZones[k]?accent:textS,fontSize:12,fontWeight:500,cursor:"pointer"}}>{gridZones[k]?"▭":"▦"}</button>}
            {/* Clear every tick in this zone in one click — with the auto-save above, this also
                empties the saved group, same as unticking each photo would. */}
            {isOn&&grpOn&&grpPicked.size>0&&<button onClick={e=>{e.stopPropagation();clearGrpPick(k,srcType,el.label);}} title="Clear all ticked photos in this zone" style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:12,fontWeight:500,cursor:"pointer"}}>✕ Clear</button>}
            {/* Pinned-count chip. The only sign a zone is grouped during normal browsing, and the
                way in to editing it outside grid mode: clicking re-ticks every pinned photo, which
                opens the group bar and the ✕ Clear button above with it — one control empties the
                group, not two. Hidden when the zone has no group, so a strip nobody has curated
                stays exactly as clean as before. */}
            {isOn&&grpOn&&grpSaved.length>0&&<button onClick={e=>{e.stopPropagation();setGrpSel(p=>({...p,[k]:new Set(grpSaved)}));}} title={`${grpSaved.length} photo${grpSaved.length===1?"":"s"} pinned to the front of ${grpArea}${groupFn?` · ${groupFn}`:""} — click to edit the group`} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${accent}`,background:`${accent}18`,color:accent,fontSize:10,fontWeight:800,cursor:"pointer"}}>◆ {grpSaved.length}</button>}
            {isOn&&<button onClick={e=>{e.stopPropagation();setZpFilterOpen(o=>o===k?null:k);}} title="Filter this zone's photos" style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${zpFilterOpen===k||zpHasFilters?accent:border}`,background:zpFilterOpen===k||zpHasFilters?`${accent}15`:"transparent",color:zpFilterOpen===k||zpHasFilters?accent:textS,fontSize:10,fontWeight:500,cursor:"pointer"}}><IconSearch size={11}/>{zpHasFilters?` (${Object.values(zpFilters).flat().length})`:""}</button>}
            <span title="Add Production item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"production"});}} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#7E22CE",borderRadius:7,background:"rgba(168,85,247,0.10)"}}><IconFactory size={14}/></span>
            <span title="Add Buying item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"buying"});}} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#B45309",borderRadius:7,background:"rgba(245,158,11,0.12)"}}><IconCart size={14}/></span>
            {/* The per-zone "Duplicate this zone" copy button is gone — it crowded the row and the
                "+ Add Zone" box below covers the same need. Every custom zone (duplicate or a true
                "Other") still carries its own ✕ so it can be removed — a standard zone can't be
                deleted here at all, only switched off, since it isn't this deal's to remove. */}
            {czSrc&&<span title={`Remove ${el.label}`} onClick={e=>{e.stopPropagation();askConfirm(`Remove ${el.label}?`,()=>{setCustomZones(p=>p.filter(z=>z.id!==k));setEnabledEls(p=>{const n={...p};delete n[k];return n;});setZoneElements(p=>{const n={...p};delete n[k];return n;});setZoneConfig(p=>{const n={...p};delete n[k];return n;});showMsg(`✓ ${el.label} removed`,"green");});}} style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700}}>✕</span>}
            {/* Scale is available on every zone, not just centrepieces. The mechanism was never
                centrepiece-specific: it rewrites each element's qty from baseQty × scale, so
                pricing, Deal Check and manpower follow on their own. Ten identical entry arches
                or five matching lounges need it exactly as much as ten guest tables did. */}
            {isOn&&<span onClick={e=>e.stopPropagation()} title="Scale the whole zone — multiplies every element count below (e.g. set 10 and each element's quantity becomes 10×). Works even with pricing hidden." style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:10,background:isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.10)",border:`1px solid ${accent}40`}}>
              <span style={{fontSize:10,fontWeight:700,color:accent,letterSpacing:0.3}}>✕ Scale</span>
              <input type="number" min="1" step="1" value={scaleDraft[k] ?? String(zoneScaleVal(k))} onClick={e=>e.stopPropagation()} onChange={e=>{const v=e.target.value;setScaleDraft(p=>({...p,[k]:v}));}} onBlur={()=>commitScale(k)} onKeyDown={e=>{e.stopPropagation();if(e.key==="Enter")e.currentTarget.blur();if(e.key==="Escape"){setScaleDraft(p=>{const n={...p};delete n[k];return n;});e.currentTarget.blur();}}} onFocus={e=>e.target.select()} style={{width:52,padding:"2px 3px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:12,fontWeight:700,textAlign:"center",MozAppearance:"textfield"}} />
              {elSelectedPhoto[k]?.isLibrary&&<span onClick={e=>{e.stopPropagation();recalibrateZoneScale(k);}} title="Quantities look off for this scale? Re-derive them from the selected photo's recipe (fixes a stale count left over from an old save; discards manual qty edits in this zone)." style={{cursor:"pointer",color:accent,fontSize:11,padding:"1px 2px",lineHeight:1}}>↻</span>}
            </span>}
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleRepeat(k);}} title={isRepeat(k)?"Reusing an existing setup — discounted rental, no build labour":"New build this time — full rental + labour + transport"} style={{cursor:"pointer",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:10,border:`1px solid ${isRepeat(k)?"#059669":border}`,background:isRepeat(k)?"#05966918":"transparent",color:isRepeat(k)?"#059669":textS}}><span style={{display:"inline-flex",alignItems:"center",gap:5}}>{isRepeat(k)?<IconRepeat size={11}/>:<IconSparkle size={11}/>}{isRepeat(k)?"Repeat":"Fresh"}</span></span>}
            <div style={{width:44,height:26,borderRadius:13,background:isOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}} onClick={e=>{e.stopPropagation();toggleEl(k);}}><div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isOn?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/></div>
          </div>
        </div>
        {isOn&&<div style={{padding:"0 18px 16px"}}>
          {/* ═══ DYNAMIC PHOTO GALLERY — select a photo to load its pricing ═══ */}
          <div style={{marginBottom:12}}>
              {/* The strip's own header row is gone. It repeated the zone name already in the card
                  header, and its controls have moved up there; the selected photo is marked on the
                  tile itself, so the ✓ id was a second copy of that too. */}
              {/* ═══ GROUP BAR ═══ Appears the moment you tick a photo in this zone. Ticking IS the
                  group now — no confirm click; scheduleGroupSave auto-persists ~700ms after the last
                  tick, for the CURRENT function, which is why the status line names it — otherwise
                  the same tick means something different depending on which function tab you're on,
                  with nothing on screen saying so. */}
              {grpPicked.size>0&&<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8,padding:"8px 12px",borderRadius:10,border:`1.5px solid ${accent}`,background:isDark?"rgba(201,169,110,0.10)":"rgba(201,169,110,0.14)"}}>
                <span style={{fontSize:12,fontWeight:700,color:accent}}>{grpPicked.size} photo{grpPicked.size===1?"":"s"} pinned to the front of {grpArea}{groupFn?` · ${groupFn}`:" · every function"}</span>
                <span style={{fontSize:10.5,color:grpSaveStatus[k]==="error"?"#E11D48":textS}}>
                  {grpSaveStatus[k]==="saving"?"Saving…":grpSaveStatus[k]==="error"?"⚠ Couldn't save — will retry on the next tick":"✓ Saved"}
                </span>
              </div>}
              {/* Venue is a preference, not a filter — say so, or the other venues' photos further
                  along the strip look like the venue pick silently failed. */}
              {/* Strip only: in grid view the section headings say all of this, in place. */}
              {anyPrefOn&&matchedPhotos.length>0&&!gridZones[k]&&<div style={{fontSize:10,color:textS,marginBottom:6,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                {venueOn&&<span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{venuePrefCount} at {zpFilters.venue.length===1?zpFilters.venue[0]:"selected venues"}</span>}
                {venueTypeOn&&<span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{venueTypePrefCount} {zpFilters.venueType.length===1?zpFilters.venueType[0]:"selected venue types"}</span>}
                {designStyleOn&&<span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{designStylePrefCount} {zpFilters.designStyle.length===1?zpFilters.designStyle[0]:"selected styles"}</span>}
                {timeSettingOn&&<span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{timeSettingPrefCount} {zpFilters.timeSetting.length===1?zpFilters.timeSetting[0]:"selected times"}</span>}
                {tierOn&&<span style={{padding:"1px 6px",borderRadius:5,background:`${accent}18`,color:accent,fontWeight:700,fontSize:9}}>{tierPrefCount} {zpFilters.tier.length===1?zpFilters.tier[0]:"selected tiers"}</span>}
                <span>shown first, then the rest of this zone's {matchedPhotos.length} photo{matchedPhotos.length===1?"":"s"}</span>
              </div>}
              {zpFilterOpen===k&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:10,marginBottom:8,borderRadius:10,border:`1px solid ${accent}30`,background:isDark?"rgba(201,169,110,0.03)":"rgba(201,169,110,0.05)"}}>
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
                  {(()=>{
                    const all=azSort(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]));
                    const anchorsOf=(name)=>(imsPaletteCatalogue||[]).find(p=>p.name===name)?.anchorColours;
                    const matched=paletteSearch(all,zpInlinePaletteQ,anchorsOf);
                    const capped=!zpInlinePaletteAll&&!zpInlinePaletteQ.trim()&&matched.length>ZP_PALETTE_CAP;
                    const shown=capped?matched.slice(0,ZP_PALETTE_CAP):matched;
                    const sel=zpFilters.colorPalette||[];
                    const selectedHidden=sel.filter(v=>all.includes(v)&&!shown.includes(v));
                    const optPill=(v)=><span key={v} onClick={()=>zpToggleFilter("colorPalette",v)} style={zpPill(sel.includes(v))}>{v}</span>;
                    return <>
                      <div style={{marginBottom:5}}><FSearchBox value={zpInlinePaletteQ} onChange={setZpInlinePaletteQ} placeholder="Search palettes…" noun="palettes" resultCount={matched.length} totalCount={all.length}/></div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <span onClick={()=>setZpFilters(p=>({...p,colorPalette:[]}))} style={zpPill(sel.length===0)}>All</span>
                        {shown.filter(v=>paletteMatches(v,zpInlinePaletteQ)).map(optPill)}
                        {(()=>{const byColour=shown.filter(v=>!paletteMatches(v,zpInlinePaletteQ));return byColour.length===0?null:<>
                          <div style={{width:"100%",fontSize:9,color:textS,marginTop:2}}>Contains this colour</div>
                          {byColour.map(optPill)}
                        </>;})()}
                        {selectedHidden.length>0&&<div style={{width:"100%",fontSize:9,color:textS,marginTop:2}}>{zpInlinePaletteQ.trim()?"Selected, outside this search":"Selected"}</div>}
                        {selectedHidden.map(optPill)}
                        {!zpInlinePaletteQ.trim()&&(capped||zpInlinePaletteAll)&&matched.length>ZP_PALETTE_CAP&&<span onClick={()=>setZpInlinePaletteAll(v=>!v)} style={zpMorePill()}>{capped?`See all ${matched.length}`:"Show fewer"}</span>}
                      </div>
                    </>;
                  })()}
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Day / Night</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,timeSetting:[]}))} style={zpPill(zpFilters.timeSetting.length===0)}>All</span>
                    {azSort(taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"])).map(v=><span key={v} onClick={()=>zpToggleFilter("timeSetting",v)} style={zpPill(zpFilters.timeSetting.includes(v))}>{v}</span>)}
                  </div>
                </div>
                {/* Tier here too. This popover and the rail edit the SAME zpFilters, so leaving it out
                    of one would mean a tier picked in the rail was live but invisible — and unclearable
                    — from here. */}
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Tier</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,tier:[]}))} style={zpPill((zpFilters.tier||[]).length===0)}>All</span>
                    {azSort(taxOr(taxonomy.tier, CATEGORIES)).map(v=><span key={v} onClick={()=>zpToggleFilter("tier",v)} style={zpPill((zpFilters.tier||[]).includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>
                    Venue{zpInlineVenueGroup==="inhouse"?" — Inhouse":zpInlineVenueGroup==="outside"?" — Outside":""}{zpWantIndoor&&!zpWantOutdoor?" · Indoor":zpWantOutdoor&&!zpWantIndoor?" · Outdoor":""}
                  </div>
                  {(()=>{
                    const all=azSort(zpFilterVenuesByGroup(zpVenueChoices, zpInlineVenueGroup));
                    const matched=paletteSearch(all,zpInlineVenueQ);
                    const capped=!zpInlineVenueAll&&!zpInlineVenueQ.trim()&&matched.length>ZP_VENUE_CAP;
                    const shown=capped?matched.slice(0,ZP_VENUE_CAP):matched;
                    const sel=zpFilters.venue||[];
                    const selectedHidden=sel.filter(v=>all.includes(v)&&!shown.includes(v));
                    const optPill=(v)=><span key={v} onClick={()=>zpToggleFilter("venue",v)} style={zpPill(sel.includes(v))}>{v}</span>;
                    return <>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
                        {["all","inhouse","outside"].map(gr=>
                          <span key={gr} onClick={()=>{setZpInlineVenueGroup(gr);setZpFilters(p=>({...p,venue:[]}));setZpInlineVenueQ("");setZpInlineVenueAll(false);}} style={zpPill(zpInlineVenueGroup===gr)}>{gr==="all"?"All":gr==="inhouse"?"Inhouse":"Outside"}</span>
                        )}
                      </div>
                      {all.length>0&&<div style={{marginBottom:5,maxWidth:340}}><FSearchBox value={zpInlineVenueQ} onChange={setZpInlineVenueQ} placeholder="Search venues…" noun="venues" resultCount={matched.length} totalCount={all.length}/></div>}
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <span onClick={()=>setZpFilters(p=>({...p,venue:[]}))} style={zpPill(sel.length===0)}>All</span>
                        {shown.map(optPill)}
                        {selectedHidden.length>0&&<div style={{width:"100%",fontSize:9,color:textS,marginTop:2}}>{zpInlineVenueQ.trim()?"Selected, outside this search":"Selected"}</div>}
                        {selectedHidden.map(optPill)}
                        {!zpInlineVenueQ.trim()&&(capped||zpInlineVenueAll)&&matched.length>ZP_VENUE_CAP&&<span onClick={()=>setZpInlineVenueAll(v=>!v)} style={zpMorePill()}>{capped?`See all ${matched.length} venues`:"Show fewer"}</span>}
                        {all.length===0&&<span style={{fontSize:9,color:textS}}>No venues configured yet</span>}
                      </div>
                    </>;
                  })()}
                </div>
                {zpHasFilters&&<div style={{gridColumn:"1/-1",textAlign:"right"}}><span onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[],tier:[]})} style={{fontSize:9,color:"#E11D48",cursor:"pointer"}}>Clear filters</span></div>}
              </div>}
              {matchedPhotos.length>0 ? (()=>{
                // BOTH views page now. The strip shows PH_PER_PAGE at a time so each card is large
                // enough to judge a stage from; the ▦ grid used to show the whole matched set at
                // once, which on a zone with 778 photos is 778 thumbnails in one scroll region —
                // and a scroll INSIDE a page that also scrolls. It gets PH_GRID_PER_PAGE with the
                // same pager the strip already uses.
                const perPage = gridZones[k] ? PH_GRID_PER_PAGE : PH_PER_PAGE;
                const pageCount = Math.max(1, Math.ceil(matchedPhotos.length / perPage));
                const page = Math.min(phPage[k] || 0, pageCount - 1);   // clamp: filters can shrink the list
                const start = page * perPage;
                const shown = matchedPhotos.slice(start, start + perPage);
                // ═══ SECTION HEADINGS ═══ Browse splits its ranked list under headings for a
                // reason: unlabelled, a list that still shows other venues just looks like a broken
                // filter. Same three sections here, derived from the FINAL order so the pinned
                // group and the selected photo keep their places inside them.
                // Grid view only — the strip paginates four at a time, and a heading that appears
                // on whichever page its tier happens to start on explains nothing.
                const secOf = (ph) => {
                  const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
                  if ((venueOn && zpVenueMatch(li)) || (venueTypeOn && zpVenueTypeMatch(li)) || (designStyleOn && zpDesignStyleMatch(li)) || (timeSettingOn && zpTimeSettingMatch(li)) || (tierOn && zpTierMatch(li))) return 0;
                  return (li?.tags?.venue || ph.venue) ? 1 : 2;
                };
                const sectioned = gridZones[k] && anyPrefOn;
                const secs = [[], [], []];
                if (sectioned) shown.forEach((ph) => secs[secOf(ph)].push(ph));
                const prefLabel = [
                  venueOn && (zpFilters.venue.length === 1 ? zpFilters.venue[0] : "Selected venues"),
                  venueTypeOn && (zpFilters.venueType.length === 1 ? zpFilters.venueType[0] : "Selected venue types"),
                  designStyleOn && (zpFilters.designStyle.length === 1 ? zpFilters.designStyle[0] : "Selected styles"),
                  timeSettingOn && (zpFilters.timeSetting.length === 1 ? zpFilters.timeSetting[0] : "Selected times"),
                  tierOn && (zpFilters.tier.length === 1 ? zpFilters.tier[0] : "Selected tiers"),
                ].filter(Boolean).join(" · ") || "Selected";
                const SEC_META = [
                  [prefLabel, (n) => `${n} tagged here`],
                  ["More references", (n) => `${n} from other venues`],
                  ["Not tagged to a venue", (n) => `${n} — still usable, but nobody has said where they were shot`],
                ];
                // Headings ride in the same list as the photos, marked with __head, so one map
                // renders both and the grid lays them out together. `i = start + pi` is only a
                // React key now, so the extra entries shifting it is harmless.
                const firstSec = secs.findIndex(s => s.length);
                const renderList = sectioned
                  ? secs.flatMap((list, si) => list.length
                      ? [{ __head: si, __n: list.length, __first: si === firstSec }, ...list]
                      : [])
                  : shown;
                return (<>
              {/* No maxHeight/overflow on the grid any more: with a pager under it, an inner scroll
                  region is a second way to move through the same list, and the two disagree about
                  where you are. The pager is the one mechanism.
                  Swipe stays off in grid mode — the handlers preventDefault to page, which on a
                  block this tall fights the page's own vertical scroll. */}
              <div style={gridZones[k]?{display:"grid",gridTemplateColumns:`repeat(${PH_GRID_COLS},minmax(0,1fr))`,gap:8,paddingBottom:6}:{display:"grid",gridTemplateColumns:`repeat(${PH_COLS},minmax(0,1fr))`,gap:12,paddingBottom:6,touchAction:"pan-y",animation:phAnim[k]?`${phAnim[k]} .3s cubic-bezier(.22,.61,.36,1)`:undefined}} className={gridZones[k]?"ph-grid ph-grid-wide":"ph-grid"} id={`ph-grid-${k}`} {...(gridZones[k]?{}:phSwipeHandlers(k,page,pageCount))}>
              {renderList.map((ph,pi)=>{
                // A section heading: a full-width row inside the same grid, so the tiles either
                // side of it keep one consistent size.
                if (ph.__head !== undefined) return (
                  <div key={`sec${ph.__head}`} style={{gridColumn:"1/-1",margin:ph.__first?"0 0 2px":"14px 0 2px",paddingTop:ph.__first?0:12,borderTop:ph.__first?"none":`1px solid ${border}`,display:"flex",alignItems:"baseline",gap:8}}>
                    <span style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:textS}}>{SEC_META[ph.__head][0]}</span>
                    <span style={{fontSize:10,color:textS,fontWeight:400}}>{SEC_META[ph.__head][1](ph.__n)}</span>
                  </div>
                );
                const i = start + pi;   // absolute index across pages — keeps React keys unique
                const isSource = sourceEvent && ph.eventName === sourceEvent.name;
                const multiZone = isMultiPhotoZone(el.label);
                const isSelected = multiZone
                  ? (elMultiPhotos[k] || []).some(p => (p.eventId || p.src) === (ph.eventId || ph.src))
                  : elSelectedPhoto[k]?.src === ph.src;
                // Distinct from isSelected: for a multi-photo zone isSelected means "ticked in the
                // list", but Update master always acts on elSelectedPhoto[k] specifically (same
                // condition the header button gates on) — the two only ever coincide for a normal,
                // single-photo zone.
                const isMasterSel = elSelectedPhoto[k]?.src === ph.src;
                // For the zone's ACTIVE picture, show the zone's real live total (zoneTotal — the
                // same figure the header and "By zone" row use) instead of recomputing from the
                // photo's own stored baseline. calcPhotoCost prices only photo.elements + a bare
                // buildZoneConfig(photo.dims) — it never picks up a saved masking/carpet/print
                // config, an extra truss/platform row, or any hand-edit made to the zone after
                // selecting, so a selected photo with any of that silently badged LOWER than what
                // was actually charged. Every OTHER (unselected) tile keeps the preview-if-picked
                // number from calcPhotoCost — that "what would this cost instead" comparison is the
                // whole point of the strip. Left alone for multi-photo zones (Installations), where
                // several photos combine into one total and no single tile can claim it as its own.
                const photoFullCost = (isSelected && !multiZone) ? zoneTotal(k) : calcPhotoCost(k, ph);
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
                  {/* Opens on this photo and hands the lightbox its own set — the group if this is
                      a grouped photo, the rest of the zone otherwise — so the arrows stay inside
                      what you were looking at and the counter reads against it. */}
                  <div style={{position:"relative",cursor:"zoom-in"}} onClick={(e)=>{
                    e.stopPropagation();
                    if(phSwipedJustNow())return;
                    const set = ph.grouped ? lbGrouped : lbRest;
                    const at = set.indexOf(ph);
                    setLightbox({idx: at < 0 ? 0 : at, items: set.map(p=>({src:p.src,name:p.eventName}))});
                  }}>
                    <img src={ph.src} alt={ph.eventName} loading="lazy" className="ph-img" style={{width:"100%",height:gridZones[k]?95:190,objectFit:"cover",display:"block",opacity:isSelected?1:0.85}} onError={e=>{e.target.style.display="none"}}/>
                    {showCosts&&!isCollapsed(k)&&photoFullCost>0&&<div style={{position:"absolute",bottom:6,right:6,background:isSelected?"#059669":"rgba(0,0,0,0.7)",color:"#fff",padding:gridZones[k]?"3px 7px":"3px 8px",borderRadius:gridZones[k]?5:6,fontSize:gridZones[k]?9:12.5,fontWeight:gridZones[k]?600:700}}>{fmt(photoFullCost)}</div>}
                    {/* Favourite marker — bottom-right, a small dot, deliberately subtle (same
                        reasoning as Browse's tier-pill ring: this can be on screen in front of a
                        guest). Shown in both grid and strip view, ticked or not — it never competes
                        with the grouping tick (top-left) or the price badge (shares this corner, so
                        it shifts up when that's also showing). Keyed by the photo's own id/src, not
                        a (photo, zone) pair, so re-tagging this photo to a different zone later
                        doesn't lose the favourite — see FAV_PHOTO_SK. */}
                    {/* The bottom-right favourite dot is gone — the star top-right is the favourite
                        control now. Two controls for one act, in opposite corners of the same tile,
                        with the star already SHOWING the state the dot set, was the confusing bit. */}
                    {(()=>{
                      // ── ONE STAR, THREE STATES ──
                      //   gold  · favourited for this zone (yours — favourites are per salesperson)
                      //   green · has elements, so it carries pricing
                      //   white · no elements yet, nothing to price off it
                      // It used to appear ONLY on verified photos and be absent otherwise, which
                      // made "no badge" ambiguous: unverified, or unpriceable? Now every tile
                      // carries one and the colour says which. Favourite outranks the element
                      // state — it is the one a salesperson put there deliberately.
                      const li = ph.isLibrary && ph.eventId ? libById.get(ph.eventId) : null;
                      const nEls = (ph.elements || []).length;
                      // Exactly the key the favourite toggle below writes — any drift here and the
                      // star would disagree with the dot the salesperson just clicked.
                      const isFavS = !!favPhotos[ph.eventId || ph.src]?.[authUser?.id];
                      const st = isFavS
                        ? { bg:"#C9A96E", fg:"#1A1A2E", t:"Your favourite — click to remove. Favourites lead the strip." }
                        : nEls > 0
                          ? { bg:"#059669", fg:"#fff", t:`${nEls} element${nEls===1?"":"s"} — priced from this photo. Click to favourite it.` }
                          : { bg:"#FFFFFF", fg:"#6B7280", t:"No elements on this photo yet — nothing to price from it. Click to favourite it." };
                      // Verified is still worth saying, so it rides in the tooltip rather than
                      // taking the badge over.
                      const vBy = li?._verified ? ` · verified by ${li._verifiedBy || "unknown"}` : "";
                      // Solid fill, white ring, drop shadow — a flat badge vanishes over a photo,
                      // whether the stage behind it is lit pale or dark. The white state gets a
                      // darker ring instead, or it disappears against a bright frame.
                      // The star IS the favourite control now. stopPropagation because the tile
                      // itself selects the photo for pricing — a different act entirely, and one
                      // that would otherwise fire on every favourite.
                      return <div title={st.t + vBy} className="ph-star"
                        onClick={e=>{e.stopPropagation();saveFavPhotos({[ph.eventId||ph.src]:{[authUser?.id]:isFavS?null:true}});}}
                        style={{position:"absolute",top:6,right:6,width:21,height:21,borderRadius:11,zIndex:3,cursor:"pointer",
                        background:st.bg,border:`2px solid ${isFavS||nEls>0?"rgba(255,255,255,0.92)":"rgba(26,26,46,0.35)"}`,color:st.fg,display:"flex",alignItems:"center",justifyContent:"center",
                        boxShadow:isFavS?"0 0 0 2px rgba(201,169,110,0.45), 0 2px 7px rgba(0,0,0,0.4)":"0 2px 7px rgba(0,0,0,0.4)"}}>
                        <IconStar size={11} filled/>
                      </div>;
                    })()}
                    {/* ── Grouping tick ── Only library photos can be grouped: a group stores library
                        ids, and an event photo has none. stopPropagation because the tile itself
                        selects the photo for pricing, which is a different act entirely. */}
                    {grpOn&&ph.isLibrary&&ph.eventId&&(()=>{
                      const ticked=grpPicked.has(ph.eventId);
                      return <div title={ticked?"Untick — remove from this selection":"Tick to pin this photo to the front of the zone"}
                        className="ph-tick"
                        onClick={e=>{e.stopPropagation();toggleGrpPick(k,ph.eventId,srcType,el.label);}}
                        style={{position:"absolute",top:6,left:6,width:20,height:20,borderRadius:5,zIndex:2,
                          cursor:"pointer",
                          border:`2px solid ${ticked?accent:"rgba(255,255,255,0.85)"}`,
                          background:ticked?accent:"rgba(0,0,0,0.38)",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,
                          color:ticked?"#1a1a2e":"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.35)",
                          transition:"transform .12s ease, background .12s ease"}}>
                        {ticked?"✓":""}
                      </div>;
                    })()}
                    {/* Which photos are already pinned, shown only while a selection is open so the
                        strip stays clean during normal browsing. */}
                    {grpPicked.size>0&&ph.grouped&&<div title="Already pinned to the front of this zone" style={{position:"absolute",bottom:6,left:6,padding:"2px 7px",borderRadius:6,background:"rgba(201,169,110,0.95)",color:"#1a1a2e",fontSize:9,fontWeight:800}}>◆ pinned</div>}
                    {isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#059669",color:"#fff",width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>✓</div>}
                    {isSource&&!isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#0F0F1A",fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:4}}>SOURCE</div>}
                    {ph.isVideoDefault&&!isSelected&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#fff",fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:4}}>Default</div>}
                  </div>
                  {/* The whole strip under the photo selects, not just the two lines of text —
                      flex:1 claims the leftover height and the padding widens the target. */}
                  <div className="ph-sel" data-sel={isSelected?"1":"0"} title={multiZone?(isSelected?"Selected — untick to remove this photo's elements from the build":"Tick to add this photo's elements to the build"):(isSelected?"Selected — this photo's pricing is applied to the zone":"Use this photo's pricing for the zone")} style={{flex:1,minHeight:52,padding:"11px 12px",cursor:"pointer",background:isSelected?(isDark?"#0D2818":"#ECFDF5"):"transparent"}} onClick={()=>{
                    if(phSwipedJustNow())return;
                    // Grid view no longer pins the pick to the front (see matchedPhotos above), so
                    // jumping to page 0 here would strand you on a page that doesn't even show the
                    // photo you just clicked. Only the strip still pins-and-jumps; the grid leaves
                    // you exactly where you were.
                    if(multiZone){toggleMultiElPhoto(k,ph);}else{selectElPhoto(k,ph);if(!gridZones[k]){phGoTo(k,0,phPage[k]||0);phScrollTop(k);}}
                    // Same rule as opening the grid: whatever you actually pick to build with belongs
                    // in the group already, not just whatever happened to be ticked before. Add-only —
                    // never un-ticks anything the checkbox itself didn't touch.
                    if(grpOn&&ph.isLibrary&&ph.eventId)ensureGrpPick(k,ph.eventId,srcType,el.label);
                  }}>
                    {/* No filename. For a library photo eventName is whatever the file was called in
                        storage — "fnq8zuwlfxtductgq4ov" — which tells a salesperson nothing and reads
                        as a bug on screen. What is useful is what the photo CONTAINS, which is the
                        line below. The name stays in alt text for screen readers. */}
                    <div style={{fontSize:12,fontWeight:isSelected?700:600,color:isSelected?"#059669":textP,marginTop:1}}>
                      {ph.isLibrary ? `${(ph.elements||[]).length} elements` : (ph.fn || "Event") + " · " + (ph.space || "")}
                    </div>
                    {(isSelected||(CORRECTION_MODE&&isMasterSel))&&<div style={{marginTop:5,display:"flex",alignItems:"center",gap:6}}>
                      {isSelected&&<span style={{fontSize:10.5,fontWeight:700,color:"#047857",display:"flex",alignItems:"center",gap:4}}>✓ Selected</span>}
                      {/* Same action as the header's "Update master" — repeated right on the tile it
                          acts on. The header one scrolls out of view the moment a long grid (hundreds
                          of photos, paginated) puts any distance between you and the top of the card;
                          this copy stays exactly where your eyes already are. Icon-only — the labelled
                          button crowded the tile — and always-on rather than hover-only, so it still
                          works on touch. */}
                      {CORRECTION_MODE&&isMasterSel&&<button onClick={e=>{e.stopPropagation();openUpdateMaster();}}
                        title={masterForSel
                          ? "Update master — correct this photo's tags + elements and save back to the shared library photo (permanent, for everyone)"
                          : "Update master — this photo isn't in the shared library yet; tag it and it will be added (permanent, for everyone)"}
                        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:5,border:"none",background:masterVerified?"#059669":"#7C3AED",color:"#fff",cursor:"pointer",flexShrink:0}}>
                        <IconPencil size={9}/>
                      </button>}
                    </div>}
                  </div>
                </div>);
              })}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6,flexWrap:"wrap"}}>
                {/* Pager on the left — only when there is more than one page to move between. */}
                {pageCount>1&&<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>phGoTo(k,Math.max(0,page-1),page)} disabled={page===0} title="Previous photos" className="ph-pg" style={phNav(page===0)}>
                    <span style={{display:"inline-flex",transform:"rotate(90deg)"}}><IconChevron size={13}/></span>
                  </button>
                  {pageWindow(page,pageCount).map((n,gi)=>n==="…"
                    ? <span key={`gap${gi}`} style={{fontSize:11,color:textS,padding:"0 2px"}}>…</span>
                    : <button key={n} onClick={()=>phGoTo(k,n,page)} className="ph-pg" style={phDot(n===page)}>{n+1}</button>)}
                  <button onClick={()=>phGoTo(k,Math.min(pageCount-1,page+1),page)} disabled={page===pageCount-1} title="More photos" className="ph-pg" style={phNav(page===pageCount-1)}>
                    <span style={{display:"inline-flex",transform:"rotate(-90deg)"}}><IconChevron size={13}/></span>
                  </button>
                  <span style={{fontSize:10.5,color:textS,marginLeft:4}}>{start+1}–{Math.min(start+perPage,matchedPhotos.length)} of {matchedPhotos.length}</span>
                </div>}
                {/* Update master used to sit here, at the far right under the photo strip. It has
                    moved up into the zone's header row, beside the grid toggle — see there. */}
              </div>
              </>);
              })() : (
            <div style={{background:isDark?"rgba(201,169,110,0.06)":"#FFFBEB",borderRadius:10,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200}}><div style={{fontSize:12,fontWeight:600,color:"#B45309"}}>{zpHasFilters?`No ${el.label} photos match your filters`:`No ${el.label} photos yet`}</div>
              <div style={{fontSize:10.5,color:textS,marginTop:2,lineHeight:1.4}}>{zpHasFilters?"Your photo filters hid everything for this zone. Clear them to see all photos again.":"Upload a client photo or add Library photos to see options here."}</div></div>
              <div style={{display:"flex",gap:7,flexShrink:0,flexWrap:"wrap"}}>
                {zpHasFilters&&<button onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[],tier:[]})} style={{padding:"6px 13px",borderRadius:8,border:`1px solid ${accent}`,background:"transparent",color:accent,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Clear filters</button>}
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
                {(()=>{
                  // Combined-source label — Installations can have several photos feeding one
                  // Element card at once, so the badge names all of them instead of just one.
                  const multiCount = (elMultiPhotos[k] || []).length;
                  const sourceLabel = multiCount > 1
                    ? `${multiCount} photos selected`
                    : elSelectedPhoto[k]?.eventName || "Library photo";
                  return <div onClick={()=>toggleElCard(k)} title={isElCardOpen(k)?"Hide the element list":"Show the element list"} style={{fontSize:11,fontWeight:600,color:"#666",cursor:"pointer",display:"flex",alignItems:"center",gap:5,userSelect:"none"}}><span style={{display:"flex",color:"#999",transform:isElCardOpen(k)?"none":"rotate(-90deg)",transition:"transform 0.18s ease"}}><IconChevron size={11}/></span><IconClipboard size={12}/><span style={{color:textP}}>Element card</span><span style={{color:textS,fontWeight:400}}>· {el.label}</span><span title={multiCount>1?`Combined from: ${elMultiPhotos[k].map(p=>p.eventName).join(", ")}`:`Source library photo: ${sourceLabel}`} style={{fontSize:9.5,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",color:textS,opacity:0.75,background:isDark?"rgba(255,255,255,0.05)":"rgba(26,26,46,0.05)",padding:"1px 6px",borderRadius:4,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sourceLabel}</span>{!isElCardOpen(k)&&elCardSummary(k)}</div>;
                })()}
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
                          // Fully used elsewhere in this deal no longer blocks adding it — it still
                          // adds, and prices through the same short-stock logic zoneTotal already runs
                          // with checkAvailability:true (getElPriceFromInventory in StudioApp.jsx): the
                          // portion actually free in stock at rental, the rest at cost% (an admin-set
                          // % of the item's production cost, per sub-category). The badge stays as a
                          // heads-up, not a lock.
                          const remaining=remainingForItem(it.id,k); const isFullyUsed=remaining!=null&&remaining<=0;
                          return <div key={"inv:"+it.id}
                            onClick={()=>{
                              if(!(zoneElements[k]||[]).find(el=>el.invId===it.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:it.name,qty:1,unit:it.unit,size:"",invId:it.id}]}));}
                              setZoneElSearch(prev=>({...prev,[k]:""}));
                            }}
                            style={{padding:"8px 10px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                            <ItemHoverThumb src={src} size={56} name={it.name} sub={(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › "+(it.cat||""):it.cat} dims={itemDimsText(it)} border={border} cardBg={cardBg} textP={textP} textS={textS} emptyBg={isDark?"#1a1a2e":"#eee"} />
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</span>
                                {isKit&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700,flexShrink:0}}>KIT</span>}
                                {isFullyUsed&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>fully used — priced at cost%</span>}
                                {!isFullyUsed&&remaining!=null&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
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
              <div className="el-grid" style={{"--el-cols":elCols}}>
                {groupedEls(k).map(({ el, idx, isKit, firstKit }) => {
                  const priceInfo = getElPrice(el, zoneConfig[k], { checkAvailability: true, zoneKey: k, elIdx: idx });
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
                  // A pure flower-recipe element (patternId, no invId) has no IMS inventory row at
                  // all, so thumbItem is always empty for it — it fell back to the generic box icon
                  // regardless of whether IMS had a reference photo for this size. Recipes now carry
                  // one (AdminSettingsTab.jsx, Flowers → Recipes), keyed by size, so resolve it the
                  // same way Deal Check resolves a recipe size (sizeClassToPatternKey + resolveSizeKey
                  // — handles the "large"/"big" legacy alias) instead of guessing the shape.
                  const patternThumbSrc = (!thumbItem && el.patternId) ? (() => {
                    const patterns = (dealCheckData||studioFloralData)?.flowerPatterns || recipeOnlyPatterns || [];
                    const pat = patterns.find(pt => pt.id === el.patternId);
                    const sk = resolveSizeKey(pat?.sizes, sizeClassToPatternKey(el.size));
                    return sk ? pat.sizes[sk]?.img : null;
                  })() : null;
                  const thumbSrc = thumbItem?.img || thumbItem?.photoUrls?.[0] || patternThumbSrc;
                  const thumbKey = `${k}:${idx}`;
                  const isUnavail = !!el.invId && typeof priceInfo.available==="number" && priceInfo.available<=0 && (el.qty||0)>0;
                  return (
                  <div key={idx} className="el-row" data-kit={isKit?"1":"0"} style={{display:"flex",flexDirection:"column",gap:6,padding:"9px 10px",borderRadius:12,border:`1px solid ${isDark?"rgba(255,255,255,0.09)":"rgba(26,26,46,0.10)"}`,background:cardBg,gridColumn:isKit?(firstKit?`1 / span ${kitSpan}`:`span ${kitSpan}`):"span 1",minHeight:isKit?undefined:98,justifyContent:isKit?"flex-start":"space-between"}}>
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
                          {/* Portal straight to <body> — .el-row lifts on :hover via a CSS transform,
                              and a transformed ancestor turns position:fixed descendants into
                              position:absolute-relative-to-THAT-ancestor instead of the viewport, so
                              the getBoundingClientRect() coordinates below land in the wrong place
                              and the popup effectively never shows. Escaping the DOM subtree entirely
                              is the fix — the popup no longer has a transformed ancestor to inherit. */}
                          {elThumbHover?.key===thumbKey && thumbSrc && createPortal(
                            <div style={{position:"fixed",top:elThumbHover.top,bottom:elThumbHover.bottom,left:elThumbHover.left,zIndex:10000,width:160,height:160,borderRadius:8,overflow:"hidden",border:`2px solid ${border}`,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",pointerEvents:"none"}}>
                              <img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            </div>,
                            document.body
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
                        {hasSizes&&!priceInfo.isFloralBlend&&<button onClick={()=>{const elems=[...(zoneElements[k]||[])];const used=new Set(elems.filter(e=>e.name===el.name).map(e=>e.size||"M"));const ns=["B","M","S"].find(s=>!used.has(s))||"B";elems.splice(idx+1,0,applyQty(k,{...el,size:ns},1));setZoneElements(p=>({...p,[k]:elems}));}} title="Split into another size (e.g. 3 Big + 2 Small)" style={{padding:"1px 6px",borderRadius:4,border:`1px dashed ${border}`,fontSize:11,fontWeight:600,cursor:"pointer",background:"transparent",color:accent}}>＋ size</button>}
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
                            elems[idx]=applyQty(k,elems[idx],nextQty);
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
                            elems[idx]=applyQty(k,elems[idx],nextQty);
                            setZoneElements(p=>({...p,[k]:elems}));
                          }} onFocus={e=>e.target.select()} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:(el.qty||0)>0?textP:textS,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit",MozAppearance:"textfield"}}/>
                          <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]=applyQty(k,elems[idx],(el.qty||0)+1);setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
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
                {(zoneElements[k]||[]).length>0&&showCosts&&<div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0 0",fontWeight:700,color:textP}}>{fmt(calcElsCost(zoneElements[k],true,zoneConfig[k],{checkAvailability:true}))}</div>}
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
                const entry={id:"PR"+Date.now()+Math.floor(Math.random()*1000),material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,qty:1,refImageUrl:"",invId:null};
                setZoneConfig(p=>({...p,[k]:{...(p[k]||{}),prints:[...((p[k]||{}).prints||[]),entry]}}));
              }} style={{padding:"4px 10px",borderRadius:8,border:"1px solid #0EA5E9",background:"rgba(14,165,233,0.14)",color:"#0EA5E9",fontSize:11.5,fontWeight:600,cursor:"pointer"}}>+ Add Print Row</button>
            </div>
            {(()=>{
              // Opens with one ready-to-edit blank row instead of a "no prints" empty state — purely
              // visual (not written to zoneConfig) until the user actually edits it, so leaving it
              // untouched never persists an empty row.
              const rows=((zoneConfig[k]||{}).prints||[]).length===0
                ? [{id:"__phantom__",material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,qty:1,refImageUrl:"",invId:null}]
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
                  const qty=Math.max(1,Math.round(Number(p.qty)||1));
                  const cost=sqft*rate*qty;
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
                      <span style={{fontSize:11.5,color:textS}}>×</span>
                      <input type="number" min="1" step="1" value={p.qty??1} onChange={e=>setPrint({qty:Math.max(1,Math.round(parseFloat(e.target.value)||1))})} title="Qty — how many copies of this same print" style={{...S.input,fontSize:11.5,padding:"3px 6px",width:44,marginBottom:0,textAlign:"center"}} />
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
            // Typing a floor dimension no longer silently picks a PLATFORM HEIGHT for you — it used
            // to write a default height in here the moment ANY dimension was typed, which is how a
            // height ended up "chosen" (and billed) without either HEIGHT button ever being pressed.
            // plH now only ever comes from actually pressing one — see the segmented control below.
            //
            // CARPET is the opposite call, on purpose: the team reliably types floor dimensions and
            // then moves on without ever touching the Carpet dropdown, so a floor that's plainly
            // being measured for carpet was quietly pricing none at all. The moment a real floor
            // dimension is entered, default cpT to Carpet Old — but only while cpT is still unset, so
            // an explicit "— None —" pick (or any other material) is never overwritten.
            const sFD=(d,v)=>{setActiveZones([]);setZoneConfig(p=>{const cur=p[k]||{};return {...p,[k]:{...cur,cpT:cur.cpT||defaultCarpetMatId(imsCarpetMaterials),floorDims:{...(cur.floorDims||{}),[d]:parseFloat(v)||0}}};});};
            const fd=zc.floorDims||{};
            return(<div style={{background:isDark?"#12121F":"#F9F9F6",borderRadius:10,padding:"10px 14px",marginBottom:10,border:`1px solid ${border}`}}>
              {/* The "Zone Structure" header row is gone. Its label named a panel you had already
                  opened, and its Truss + Platform + Carpet breakdown and roll-up restated what the
                  truss and floor cards below print on their own headers. Same reason the "Includes"
                  chip row went earlier. */}
              {/* ── TRUSS (with masking nested inside it) → then the floor card ── */}
              
              {zoneSection[k]==="truss"&&<TrussStack S={S} customCeilingField={customCeilingField} k={k} zc={zc} zm={zm} st={st} sZ={sZ} sD={sD} fmt={fmt} showCosts={showCosts}
                isDark={isDark} border={border} textP={textP} textS={textS} accent={accent}
                customMaskingField={customMaskingField} maskOpts={maskingOptions(imsMaskingRates)} trussRates={imsTrussRates} structRates={structRates} />}
              {/* ── PLATFORM + CARPET → then floor dims ── */}
              {zoneSection[k]==="platform"&&<FloorStack S={S} zc={zc} zm={zm} st={st} sZ={sZ} sFD={sFD} fd={fd} fmt={fmt} showCosts={showCosts}
                isDark={isDark} border={border} accent={accent} textP={textP} textS={textS} imsCarpetMaterials={imsCarpetMaterials} imsPlatformRates={imsPlatformRates} />}
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

    </div>{/* end of the function-switch veil wrapper */}

    {/* ═══ + ADD CUSTOM ZONE ═══ Two things through one picker:
        - A zone TYPE gives you a second Stage / Entry Passage / … that behaves exactly like the
          original (photo strip, elements, truss, platform, pricing) AND starts from that zone's own
          tagged photo pool — that is what sourceType buys. Naming is automatic, "Stage (2)".
        - "Other" is for a zone the list does not cover (Gajra Counter, Artist Stage). It has no
          source type, so it starts with an empty photo strip of its own (nothing seeded from a
          standard zone) — but it's the same full card either way: photo gallery, elements, truss,
          platform, pricing, notes, all of it (see the main zone-cards loop above).
        The name box only appears for Other. Showing it always was the earlier design and it read as
        a second, competing way to add a zone. ═══ */}
    {(()=>{
      const OTHER = "__other__";
      const isOther = newCzSrc === OTHER;
      const srcLabel = (newCzSrc && !isOther) ? (zoneLabelsD[newCzSrc]?.label || newCzSrc) : "";
      // Second copy is "(2)" — the seed zone itself is the implicit (1).
      const autoName = srcLabel ? `${srcLabel} (${customZones.filter(cz=>cz.sourceType===newCzSrc).length+2})` : "";
      const otherName = newCzOtherName.trim();
      const canAdd = isOther ? !!otherName : !!newCzSrc;
      const addZone = () => {
        if (!canAdd) return;
        const id = "cz_"+Date.now();
        const name = isOther ? otherName : autoName;
        // Other → no sourceType, so it starts with no inherited photos/elements/pricing — its own
        // photo strip fills up only from what gets tagged into it from here on (see areaNamesFor /
        // CUSTOM_ZONE_TAG_PREFIX). It still renders in the same main zone-cards list as everything
        // else, full card included.
        setCustomZones(p=>[...p, isOther ? {id,name,icon:""} : {id,name,sourceType:newCzSrc,icon:zoneLabelsD[newCzSrc]?.icon||""}]);
        setEnabledEls(p=>({...p,[id]:true}));
        setNewCzSrc(""); setNewCzOtherName("");
        showMsg(`✓ ${name} added`,"green");
        setTimeout(()=>document.getElementById(`zone-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"}),80);
      };
      return <div style={{borderRadius:12,border:`2px dashed ${border}`,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
        <select value={newCzSrc} onChange={e=>{setNewCzSrc(e.target.value); if(e.target.value!==OTHER) setNewCzOtherName("");}} style={{width:190,padding:"8px 10px",borderRadius:9,border:`1px solid ${border}`,background:"#fff",color:"#111827",fontSize:12.5,fontWeight:600,cursor:"pointer",flexShrink:0}}>
          <option value="" style={{color:"#111827",background:"#fff"}}>Choose a zone…</option>
          {zoneKeys.map(zk=><option key={zk} value={zk} style={{color:"#111827",background:"#fff"}}>{zoneLabelsD[zk]?.label||zk}</option>)}
          <option value={OTHER} style={{color:"#111827",background:"#fff"}}>Other — type a name…</option>
        </select>
        {isOther&&<input autoFocus value={newCzOtherName} onChange={e=>setNewCzOtherName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addZone();}}
          placeholder="e.g. Gajra Counter, Artist Stage" style={{...S.input,flex:1,marginBottom:0,fontSize:12.5,minWidth:0}}/>}
        <button onClick={addZone}
          title={isOther?(otherName?`Adds "${otherName}" — a named zone with no photos or pricing of its own`:"Type a name first"):(newCzSrc?`Adds "${autoName}" — same photos, elements and pricing as ${srcLabel}`:"Choose a zone first")}
          style={{...S.btn(canAdd),padding:"8px 16px",fontSize:11.5,opacity:canAdd?1:0.5,whiteSpace:"nowrap",flexShrink:0}}>
          {isOther?(otherName?`+ Add ${otherName}`:"+ Add Zone"):(newCzSrc?`+ Add ${autoName}`:"+ Add Zone")}
        </button>
      </div>;
    })()}

    {/* ═══ BUILD PAGE TOTAL — detailed breakdown ═══ The genset selector needs to stay reachable
        (it's the one control here, not just a readout) regardless of the Live Estimate rail's
        state, so the panel itself no longer folds away with it. Its COSTS do — every ₹ figure
        (Decor, Transport, per-genset rate/cost, Grand Total) is the same numbers as the rail, so
        showing them with the rail closed would just be a second, unlabelled place pricing leaks
        to. Rail closed → this is a bare genset qty stepper; rail open → the full breakdown returns. */}
    {showCosts&&venue&&<div style={{background:"linear-gradient(135deg,#0F0F1A,#2d1b69)",borderRadius:16,padding:"20px 24px",color:"#fff",marginTop:24}}>
      {rightRailOpen&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}><IconPlatform size={12}/> Decor (all zones)</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(totalCost())}</span>
      </div>}
      {/* Trucks and genset are two different things bought from two different rates —
          transportCalc has always kept truckTotal and gensetCost apart, they were merely being
          summed here. Showing one figure meant a venue's genset charge was invisible. */}
      {rightRailOpen&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}>Transport ({transportCalc.trucks} truck{transportCalc.trucks===1?"":"s"})</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(transportCalc.truckTotal)}</span>
      </div>}
      {/* Genset count is adjustable here rather than only in Event Info's custom-venue block,
          which is where the override lived and where nobody looks once a build is underway.
          Each size supplies its own venue default (IMS Admin → Transport & Power — whole units
          now, not one fractional number); stepping either one writes its own override, which the
          session snapshot persists per function. Setting it back to the venue's own number clears
          the override, so the row stops being pinned and follows the venue again. */}
      {/* One row per genset size, each with its own count — an event often needs a big unit AND a
          smaller one, so a single "which size" toggle could never express that. */}
      {[
        { kva: "125", count: transportCalc.gensets, rate: transportCalc.gensetRate,
          set: (n) => setCustomGensets(n === transportCalc.venueGensets ? null : n),
          note: customGensets !== null ? `venue default ${transportCalc.venueGensets}` : "" },
        { kva: "62", count: transportCalc.genset62, rate: transportCalc.gensetRate62,
          set: (n) => setGenset62(n === transportCalc.venueGenset62 ? null : n),
          note: genset62 !== null ? `venue default ${transportCalc.venueGenset62}` : "" },
      ].map((g, gi) => (
        <div key={g.kva} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,
          ...(gi===1?{paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.1)"}:null)}}>
          <span style={{fontSize:12,color:"#a5b4fc",display:"inline-flex",alignItems:"center",gap:8}}>
            Genset {g.kva} KVA
            <span style={{display:"inline-flex",alignItems:"center",gap:2,background:"rgba(255,255,255,0.08)",borderRadius:8,padding:2}}>
              {[["−",-1],["+",1]].map(([sym,d],i)=>(
                <Fragment key={sym}>
                  {i===1&&<span style={{minWidth:16,textAlign:"center",fontSize:12,fontWeight:700,color:"#fff"}}>{g.count}</span>}
                  <button
                    onClick={()=>g.set(Math.max(0,(Number(g.count)||0)+d))}
                    disabled={d<0&&(Number(g.count)||0)<=0}
                    title={d<0?`One fewer ${g.kva} KVA genset`:`One more ${g.kva} KVA genset`}
                    style={{width:18,height:18,lineHeight:1,borderRadius:5,border:"none",cursor:"pointer",
                      background:"rgba(255,255,255,0.12)",color:"#fff",fontSize:12,fontWeight:700,
                      opacity:(d<0&&(Number(g.count)||0)<=0)?0.35:1}}>{sym}</button>
                </Fragment>
              ))}
            </span>
            {rightRailOpen&&g.rate>0&&<span style={{opacity:0.75}}>× {fmt(g.rate)}</span>}
            {g.note&&<span style={{fontSize:10,opacity:0.7}}>· {g.note}</span>}
          </span>
          {rightRailOpen&&<span style={{fontSize:14,fontWeight:600,opacity:(Number(g.count)||0)?1:0.45}}>{fmt((Number(g.count)||0)*g.rate)}</span>}
        </div>
      ))}
      {rightRailOpen&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:14,fontWeight:700,color:"#C9A96E"}}>Grand Total</span>
        {/* The page's OTHER grand total. Gated on pricingReady like the estimate tile — the same
            seed-default figure and the same tier chip derived from it, so fixing only one of the two
            would just move where you watch the price change. */}
        <div style={{textAlign:"right"}}>
          {pricingReady
            ? <>
                <div style={{fontSize:28,fontWeight:700}}>{fmt(grandTotal)}</div>
                <span style={{fontSize:11,padding:"3px 12px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
              </>
            : <>
                <div style={{width:150,height:26,borderRadius:8,marginLeft:"auto",background:isDark?"rgba(255,255,255,0.11)":"rgba(26,26,46,0.09)",animation:"pt-pulse 1.15s ease-in-out infinite"}}/>
                <span style={{fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",color:textS}}>Loading rates…</span>
              </>}
        </div>
      </div>}
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
        // baseQty is Scale By's own per-element bookkeeping (this zone's qty ÷ whatever scale was
        // live when this photo was corrected) — never the photo's real recipe quantity. Saving it
        // verbatim baked a stray scale ratio into the master; the next salesperson to pick this photo
        // fresh (scale back at 1) would have it silently resurface on their very first Scale edit,
        // multiplying against a base that had nothing to do with their build. Strip it at the source.
        const elems=JSON.parse(JSON.stringify(zoneElements[zk]||master?.elements||[])).map(({baseQty:_drop,...e})=>e);
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
          // Extra rows (Build's "+ Add Truss" / "+ Add Platform") only ever lived in zoneConfigByType,
          // in zoneConfig's OWN shape (dims:{L,W,H} / floorDims:{L,W}) — never mirrored into this
          // legacy `dims` object at all. ManageLibrary.jsx's Truss/Platform editor reads exclusively
          // from THIS shape (dims.trussRows/platformRows, Library's own trussL/trussW/floorL/floorW
          // naming — see buildZoneConfig's mapTrussRow/mapPlatformRow for the inverse), so a second
          // truss added in Build saved correctly to zoneConfigByType (Build itself shows it fine on
          // reselect) but was invisible from the Library editor: it simply had nowhere to land here.
          const rowToLibTruss=(row)=>({id:row.id,trussL:row.dims?.L||0,trussW:row.dims?.W||0,trussH:row.dims?.H||0,
            trussQty:row.trussQty||1,trussFrontExt:row.trussFrontExt||0,trussFrontExtH:row.trussFrontExtH||0,
            mkOn:!!row.mkOn,mkT:row.mkT||"",mkWalls:row.mkWalls||{},
            trussMaterial:row.trussMaterial??null,drapeDensity:row.drapeDensity??null,
            customCeilingItemId:row.customCeilingItemId??null,customMaskingItemId:row.customMaskingItemId??null});
          const rowToLibPlatform=(row)=>({id:row.id,plH:row.plH||"",floorL:row.floorDims?.L||0,floorW:row.floorDims?.W||0});
          libDims={...(master?.dims||{}),
            trussL:d.L||0,trussW:d.W||0,trussH:d.H||0,floorL:fd.L||0,floorW:fd.W||0,
            plH:liveCfg.plH||master?.dims?.plH||"",cpT:liveCfg.cpT??master?.dims?.cpT??null,
            mkT:liveCfg.mkT||master?.dims?.mkT||"",mkWalls:liveCfg.mkWalls||master?.dims?.mkWalls||{},
            trussFrontExt:liveCfg.trussFrontExt||0,trussFrontExtH:liveCfg.trussFrontExtH||0,
            trussMaterial:liveCfg.trussMaterial??master?.dims?.trussMaterial??null,
            drapeDensity:liveCfg.drapeDensity??master?.dims?.drapeDensity??null,
            customCeilingItemId:liveCfg.customCeilingItemId??null,customMaskingItemId:liveCfg.customMaskingItemId??null,
            trussRows:(liveCfg.extraTrussRows||[]).map(rowToLibTruss),
            platformRows:(liveCfg.extraPlatformRows||[]).map(rowToLibPlatform)};
        }
        // Keep the original verifier's credit — a later editor's correction updates tags/elements
        // but shouldn't steal the "verified by" attribution from whoever verified it first.
        const wasVerified=!!master?._verified;
        const stamp=wasVerified?{_lastEditedBy:authUser?.name||"—",_lastEditedAt:Date.now()}:{_verifiedBy:authUser?.name||"—",_verifiedAt:Date.now()};
        // A true custom ("Other") zone isn't in the taxonomy this chip editor offers below, so there
        // was no way to tag a photo as belonging to one — see the matching note on applyZoneUpload
        // (StudioApp.jsx) and on areaNamesFor above. This zone IS where the photo is being corrected
        // FOR, so include its id in the private customZoneIds channel, same as a fresh upload does —
        // by id, not name, so it can't collide with an unrelated deal's same-named zone.
        const czSrcThis = customZones.find(cz => cz.id === zk && !cz.sourceType);
        const tags = czSrcThis
          ? { ...correctPhoto.tags, customZoneIds: [...new Set([...(correctPhoto.tags?.customZoneIds || []), czSrcThis.id])] }
          : correctPhoto.tags;
        if(isNewMaster){
          // This photo wasn't a Library photo yet (fresh upload / event photo) — create one now.
          const newId="LIB"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
          const created={id:newId,url:correctPhoto.draftSrc,name:correctPhoto.name||"Untitled",tags,elements:elems,dims:libDims,zoneConfigByType:zoneCfgMap,addedAt:Date.now(),source:"build",_verified:true,...stamp,_correctedOn:"build"};
          // No mergeLibItems first — it writes libItemsRef, which saveLib diffs against to work out
          // what changed, so pre-merging made it compare `created` to itself and skip the write.
          // saveLib does the merge itself. Same bug as the Build photo upload in StudioApp.
          const res=await saveLib([created]);
          // saveLib swallows its own DB error (shows its own red toast) but used to leave it there —
          // callers kept going and showed their own "✅ saved" message regardless, so a failed write
          // looked identical to a successful one until the next refresh re-fetched the real (unsaved)
          // row. Bail out here instead: keep the modal open with the user's edits intact so they can
          // retry, and don't claim a save that didn't happen.
          if(!res?.ok) return;
          // Point this zone's selection at the new Library entry going forward (same src, now backed by a real row).
          setElSelectedPhoto(p=>({...p,[zk]:{...p[zk],isLibrary:true,eventId:newId}}));
          logVerificationEvent?.({photoId:newId,photoName:created.name,source:"build"});
          showMsg("✅ Saved as a new Library photo — thanks!","green");
        } else {
          const corrected={...master,name:correctPhoto.name||master.name,tags,elements:elems,dims:libDims,zoneConfigByType:zoneCfgMap,_verified:true,...stamp,_correctedOn:"build"};
          const res=await saveLib(libItems.map(i=>i.id===correctPhoto.libId?corrected:i));
          if(!res?.ok) return; // see comment above — don't claim success on a failed write
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
          // A true custom zone's own tag lives in customZoneIds, not areasElements — checked
          // directly by id rather than through areaNamesFor's marker (see areaNamesFor above).
          const stillInZone = (czSrcZ && !czSrcZ.sourceType)
            ? (tags?.customZoneIds || []).includes(czSrcZ.id)
            : (() => {
                const areas = areaNamesFor(czSrcZ?.sourceType || zk);
                const tagged = tags?.areasElements || [];
                return areas.length ? tagged.some(a => areas.includes(a)) : true;
              })();
          if (!stillInZone) {
            setElSelectedPhoto(p => { const n = { ...p }; delete n[zk]; return n; });
            // ── AND UNPIN IT, OR IT COMES STRAIGHT BACK ──
            // Releasing the selection and refetching is not enough. A zone's hand-picked GROUP is a
            // separate channel from its tags, and a group member is resolved from libById and floated
            // to the front whether or not the zone still returns it (see applyZoneGroupOrder). So a
            // photo retagged to another zone left the query, lost its selection — and then reappeared
            // first in the strip, pinned. That is the "it's still here" report.
            // Retagging a photo out of a zone is an explicit statement that it does not belong there,
            // which is exactly when stale curation should go. Only this photo is removed; the rest of
            // the zone's group is untouched.
            const area = groupAreaFor(czSrcZ?.sourceType || zk, czSrcZ?.label || zk);
            const savedIds = zoneGroups?.[area]?.[groupFn] || [];
            const pid = correctPhoto.libId || null;
            if (pid && savedIds.includes(pid) && writeZoneGroup) {
              writeZoneGroup(area, groupFn, savedIds.filter(id => id !== pid))
                .catch(() => showMsg("Photo retagged, but couldn't unpin it from this zone — untick it in the grid.", "red"));
            }
            // The ticks on screen are rebuilt from the saved group next time the grid opens; clear the
            // live set too so it does not keep showing a tick for a photo that just left.
            setGrpSel(p => { const cur = p[zk]; if (!cur || !cur.has(pid)) return p; const n = new Set(cur); n.delete(pid); return { ...p, [zk]: n }; });
          }
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
                {key==="colorPalette"&&setImsPaletteCatalogue&&<PaletteQuickAdd accent={accent} border={border} textS={textS}
                  onAdd={(name)=>{
                    const added=addPaletteInline(name,imsPaletteCatalogue,setImsPaletteCatalogue,savePaletteData);
                    if(!added)return;
                    const cur=correctPhoto.tags?.colorPalette||[];
                    if(!cur.includes(added))toggle("colorPalette",added);
                  }} />}
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

    {/* Per-element stock availability modal now renders in StudioModals.jsx — shared with the
        Add Production/Buying Item modal, which also triggers openAvailModal via ctx. */}

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
          {/* The caption carried the storage filename. Position is what a viewer actually wants here. */}
          {many&&<span style={{fontWeight:400,opacity:0.75}}>{lightbox.idx+1} / {items.length}</span>}
        </div>
      </div>);
    })()}
      </div>{/* /right column */}
      {PRICING_TILE&&(rightRailOpen
        ? <div className="bd-rail bd-rail-r" style={{width:RAIL_W,flexShrink:0,position:"sticky",top:RAIL_TOP,alignSelf:"flex-start"}}>{PRICING_TILE}</div>
        : railTab("right","Live estimate",<IconBolt size={14}/>))}
    </div>{/* /two-column shell */}
  </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEAL CHECK — MANPOWER SUB-TAB (Studio slice).
// VERBATIM port of the reference `dcActiveTab === "manpower"` body
// (reference App_latest.jsx ~14658–15619) plus the inline dcMpCalcOpen
// per-day calculation breakdown panel it drives (15416–15587).
// ═══════════════════════════════════════════════════════════════
import { useEffect } from "react";
import { CARD_SHADOW, CARD_BG, CARD_BORDER, HAIRLINE, TILE_BG, TILE_BORDER, CHIP_BG, INK, INK_2, INK_3, GOLD, GOLD_SOFT, NUM } from "../../../../lib/studio/dcTokens";
import { resolveTrussConfig } from "../../../../lib/studio/pricing";
import { heavyExtraLabour, eventTimingMultFor, EVENT_TIMINGS } from "../../../../lib/ims/constants";
import { standingReductionBySubcat, standingPillarCount, fixedVenueFor } from "../../../../lib/ims/fixedVenues";
import { itemImsSubcat, lookupBySubcat } from "../../../../lib/ims/helpers";
import { matchFlowerPattern } from "../../../../lib/ims/flowerHelpers";
import ManpowerFactorPills from "../../../../components/shared/ManpowerFactorPills.jsx";

// ═════════════════════════════════════════════════
// SURFACES
// Same opaque stack the Truss, Florals and Inventory tabs now use: white card
// → grey tile → chip, with three ink levels instead of one colour at three
// opacities. The frosted-white rows this tab used to have (rgba(255,255,255,
// 0.62) over a tinted day card) went muddy wherever two of them overlapped,
// and money on a translucent ground is the one thing on this screen that has
// to read first time.
// ═════════════════════════════════════════════════
// Surfaces, inks and the gold accent now live in one place — see dcTokens.js for
// why (this block and DealCheckOverlay's IV object had already drifted apart).

// ── ONE HUE PER PHASE ──
// A booking runs -1 day → event → gap → dismantle, and which phase a day is in
// changes how its crew was derived (MAX across upcoming ceremonies / from the
// build / carried forward / a % of the event peak). That is the single most
// useful thing to know about a day, so it gets colour: the same hue carries the
// day's icon tile, its left stripe and its phase chip, and nothing else on the
// card is coloured. You find the dismantle day by its colour, not by reading
// four date headers.
//
// Desaturated from the stock amber/indigo/slate/rose. Those four at full
// saturation were four loud accents stacked down the page, each shouting as
// loudly as the money. These carry the same four distinctions — you can still
// tell a dismantle day from an event day at a glance — at a saturation that
// belongs next to gold rather than competing with it.
const PHASE_ACCENT = {
  minusOne:  { ink: "#836523", tile: "#F7F1E0", stripe: "#C6A55E" },
  event:     { ink: "#3E3566", tile: "#EBE8F4", stripe: "#6F63A8" },
  gap:       { ink: "#5C5766", tile: "#EFEDF1", stripe: "#A9A3B5" },
  dismantle: { ink: "#8A4155", tile: "#F7EAEE", stripe: "#B87289" },
};
const accentFor = (phase) => PHASE_ACCENT[phase] || PHASE_ACCENT.gap;

// Hover, focus and the summary bar's column count cannot be expressed inline,
// which is why this tab carries a sheet at all. Prefixed .dcm- so it cannot
// collide with the .dct-/.dci-/.dc- rules the sibling tabs ship.
//
// ── WHY THE !important ──
// This codebase styles inline, and an inline declaration outranks a plain
// stylesheet rule. Every property below that also appears in an element's
// style={{...}} — background, border, box-shadow — therefore needs !important
// or the hover silently does nothing. That is not a hypothetical: written
// without it, the card lift and the row highlight both no-op'd here, because
// every card carries an inline boxShadow and every row an inline background.
// .dcm-btn deliberately uses filter instead, so one rule can hover both the
// grey switch pills and the amber reset button without either needing a
// colour of its own overridden.
const MP_CSS = `
.dcm-card{transition:box-shadow .16s ease,border-color .16s ease}
.dcm-card:hover{box-shadow:0 2px 4px rgba(36,30,53,.06),0 14px 30px -10px rgba(36,30,53,.14)!important;border-color:#DED7CB!important}
.dcm-hd{cursor:pointer;transition:background .14s ease}
.dcm-hd:hover{background:#FCFAF7}
.dcm-row{transition:background .14s ease,border-color .14s ease,box-shadow .16s ease}
.dcm-row:hover{background:#FFFFFF!important;border-color:#DED7CB!important;box-shadow:0 1px 2px rgba(36,30,53,.04),0 8px 18px -10px rgba(36,30,53,.16)!important}
.dcm-ghost{transition:background .14s ease,border-color .14s ease,color .14s ease}
.dcm-ghost:hover{background:#F2EDE5!important;border-color:#DED7CB!important;color:#241E35!important}
.dcm-btn{transition:filter .14s ease}
.dcm-btn:hover{filter:brightness(.965)}
.dcm-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1040px){.dcm-sum{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.dcm-sum{grid-template-columns:1fr}}
.dcm-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1500px){.dcm-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1150px){.dcm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:780px){.dcm-grid{grid-template-columns:1fr}}
`;

// ── A LABELLED FIGURE ──
// Four of these make the summary bar and they have to line up down the page, so
// the label/value/foot rhythm lives in one place rather than being retyped per
// tile with slightly different sizes each time.
function StatTile({ label, value, foot, tone }) {
  return (
    <div className="dcm-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:11,boxShadow:CARD_SHADOW,padding:"9px 13px",minWidth:0}}>
      <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
      <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:tone||INK,...NUM}}>{value}</div>
      {foot ? <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{foot}</div> : null}
    </div>
  );
}

// ── THE DERIVATION, IN A DIALOG ──
// The breakdown used to unfold inside the trade card. That was survivable while
// the cards were full-width rows, but at four to a row a derivation table has a
// quarter of the width and no way to be read. Making the card span the whole
// grid row instead worked, and left a hole in the row above it every time.
// A dialog gives the tables the width they need and leaves the grid alone.
//
// position:fixed escapes the day card's overflow:hidden (which is what keeps
// the phase stripe inside the radius) — fixed elements are not clipped by an
// ancestor's overflow. That only holds while no ancestor has transform, filter
// or will-change set, since those create a containing block; the hover rules in
// MP_CSS deliberately use box-shadow and brightness on the button only, so
// nothing on the card's ancestor chain does.
function CalcModal({ title, subtitle, onClose, children }) {
  // Escape closes, captured at the window so it works wherever focus sits.
  // stopPropagation because Deal Check's own overlay listens for Escape too and
  // would otherwise close the whole tab behind this dialog in one keypress.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{position:"fixed",inset:0,zIndex:10600,background:"rgba(16,18,28,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}
    >
      {/* stopPropagation so a click inside the dialog does not reach the
          backdrop's onClose — otherwise selecting text in a table shuts it. */}
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:16,boxShadow:"0 24px 64px rgba(16,18,28,0.30)",width:"min(900px,100%)",maxHeight:"84vh",display:"flex",flexDirection:"column",overflow:"hidden"}}
      >
        <div style={{display:"flex",alignItems:"flex-start",gap:12,padding:"15px 18px",borderBottom:`1px solid ${HAIRLINE}`,flexShrink:0}}>
          <div style={{flex:"1 1 auto",minWidth:0}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4}}>How this was derived</div>
            <div style={{fontSize:16,fontWeight:750,color:INK,letterSpacing:-0.3,lineHeight:1.2}}>{title}</div>
            {subtitle ? <div style={{fontSize:11.5,color:INK_3,marginTop:3,...NUM}}>{subtitle}</div> : null}
          </div>
          <button onClick={onClose} title="Close (Esc)" className="dcm-btn"
            style={{flexShrink:0,width:30,height:30,borderRadius:9,border:`1px solid ${CARD_BORDER}`,background:TILE_BG,color:INK_2,fontSize:14,lineHeight:1,cursor:"pointer"}}>✕</button>
        </div>
        {/* The body scrolls, not the page behind it, and the tables inside get
            their own horizontal scroll rather than being cut off. */}
        <div style={{padding:"14px 18px 18px",overflowY:"auto",overflowX:"auto"}}>{children}</div>
      </div>
    </div>
  );
}

export default function DCManpowerTab({ ctx }) {
  const {
    // chrome / theme
    border, textS,
    // build / fn state
    collectAllFunctionData, activeFnIdx, dcShowAllFns, dcCollapsedFnBlocks, setDcCollapsedFnBlocks,
    // settings + zone meta + rate card
    dealCheckData, zoneMeta, dcCards, dcInventoryCache,
    // pricing helpers (module-exposed via ctx)
    calcZoneTrussPreview,
    // manpower state
    dcMpOverrides, setDcMpOverrides,
    dcMpWinCount, setDcMpWinCount,
    dcMpIncludeMinusOne, setDcMpIncludeMinusOne,
    dcMpIncludeDismantle, setDcMpIncludeDismantle,
    dcMpCalcOpen, setDcMpCalcOpen,
    // auth — manpower planning now lives in IMS Dept Ops; salespeople get a read-only view here,
    // Admin can still edit (e.g. for a special case or troubleshooting)
    isAdmin,
  } = ctx;

  return (() => {
                  // ═══ MANPOWER TAB — Booking-level day-wise forecast (22 May 2026) ═══
                  // Replaces per-fn Flowerist/Electrician view with booking-level multi-day layout.
                  // - People count: per-ceremony Tier 1/2/3 mirror of IMS (calcTier1Flowerist@1701, calcTier2@1738, calcTier3@1756)
                  // - Cumulative MAX rule: labour only scales UP across booking days
                  // - Cost = people × ticked_windows × rate (sequential window count)
                  // - Day-wise window checkbox overrides stored in dcMpOverrides
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>No functions configured yet.</div>;

                  // ── Settings (IMS Redis) ──────────────────────────────────
                  const dihariSchemes = dealCheckData?.dihariSchemes || {};
                  const defaultWindowsByPhase = dealCheckData?.defaultWindowsByPhase || {};
                  const labourTiers = dealCheckData?.labourTiers || {};
                  const venueMinLabour = dealCheckData?.venueMinLabour || {};
                  const defaultMinLabour = dealCheckData?.defaultMinLabour || 4;
                  const eventTypeMultipliers = dealCheckData?.eventTypeMultipliers || { outdoor_budgeted:1.0 };
                  const eventTimingMultipliers = dealCheckData?.eventTimingMultipliers || {};
                  const sayaMultiplier = dealCheckData?.sayaMultiplier || 1.3;
                  const heavyElementRanges = dealCheckData?.heavyElementRanges || [];
                  const fabricBangaliRanges = dealCheckData?.fabricBangaliRanges || [];
                  const trussLabourRanges = dealCheckData?.trussLabourRanges || [];
                  // §23 Phase 2.6 — RFT divisor for Fabric Bangali side-wall calc
                  const fabricRftPerWorker = Number(dealCheckData?.fabricRftPerWorker) || 100;
                  const flowerPatternsMP = dealCheckData?.flowerPatterns || [];
                  const electricianProdMP = dealCheckData?.electricianProductivity || {};
                  const seasonMapMP = dealCheckData?.seasonMap || {};
                  // ── Vendor avg-rate lookup (22 May 2026) ─────────────
                  // For each labour type: avg of (vendor.storedRate.amount) where
                  // vendor.type==="Manpower Contractor", vendor.active, vendor.isFixed, vendor.labourType===type.
                  // Falls back to dihariSchemes[type].rate (house default) when no vendors match.
                  const vendorsMP = (dealCheckData?.vendors || []).filter(v => v && v.active && v.type === "Manpower Contractor" && v.isFixed && v.labourType && Number(v?.storedRate?.amount) > 0);
                  const rateByType = {};
                  const rateSourceByType = {};
                  Object.keys(dihariSchemes).forEach(type => {
                    const matches = vendorsMP.filter(v => v.labourType === type);
                    if (matches.length > 0) {
                      const sum = matches.reduce((s, v) => s + Number(v.storedRate.amount || 0), 0);
                      rateByType[type] = Math.round(sum / matches.length);
                      rateSourceByType[type] = { kind: "vendor_avg", count: matches.length, vendors: matches.map(v => v.name) };
                    } else {
                      rateByType[type] = Number(dihariSchemes[type]?.rate || 0);
                      rateSourceByType[type] = { kind: "house_default", count: 0 };
                    }
                  });

                  // ── Helpers ───────────────────────────────────────────────
                  const sizeFromMode = (inhouseMode, elSize) => {
                    if (inhouseMode === "smb") {
                      const s = (elSize || "M").toUpperCase();
                      if (s === "S") return "small";
                      if (s === "B") return "big";
                      return "medium";
                    }
                    return "medium";
                  };
                  const shiftToTiming = (shift) => {
                    const s = String(shift||"").toLowerCase();
                    if (s.includes("morning") || s.includes("brunch")) return "brunch";
                    if (s.includes("lunch")) return "lunch";
                    if (s.includes("sundowner")) return "sundowner";
                    if (s.includes("night")) return "dinner";
                    return "dinner";
                  };
                  // Walk all elements in a fn (mirror of existing flowerist code path)
                  const walkFnElements = (fn, cb) => {
                    Object.entries(fn.zoneElements || {}).forEach(([zk, elems]) => {
                      if (!fn.enabledEls?.[zk]) return;
                      (elems || []).forEach(el => {
                        // An element's identity for manpower purposes comes ONLY from live IMS —
                        // el.invId (Inventory, the normal path for anything added via "+ Add element"
                        // today) or el.patternId (a pure flower-recipe element, "Floating Floral" with
                        // no inventory row at all). No Rate-Card name-match fallback: Rate Card's own
                        // `.sub` is a separate, older vocabulary that doesn't track IMS's live
                        // Sub-Categories master, and a name coincidentally matching a Rate Card row
                        // used to silently override the element's real Inventory sub-category.
                        let rc = null;
                        if (el.invId) {
                          const invItem = (dcInventoryCache || []).find(i => i.id === el.invId);
                          if (invItem) rc = { name: invItem.name, cat: invItem.cat || invItem.category || "", sub: invItem.subCat || invItem.subcategory || "" };
                        }
                        if (!rc && el.patternId) rc = { name: el.name || "", cat: "florals", sub: "" };
                        if (!rc) return;
                        const qty = el.qty || 0;
                        if (qty <= 0) return;
                        cb({ el, rc, qty, zoneKey: zk });
                      });
                    });
                  };

                  // Fixed-venue "Repeat" model — MUST match DealCheckOverlay: drop repeat zones from the
                  // computation (reused = no build labour), then floor each type at the venue's fixed crew.
                  const _fvCfgAll = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                  // Repeat zones (ANY venue) drop out of the build-labour computation. The fixed-crew FLOOR
                  // below still only applies at configured fixed venues (fv truthy); non-fixed → computed only.
                  const freshFnMP = (fn) => {
                    const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
                    const repeatZk = Object.keys(zc).filter(zk => en[zk] && zc[zk]?.repeat);
                    if (!repeatZk.length) return fn;
                    const nen = { ...en }; repeatZk.forEach(zk => { nen[zk] = false; });
                    return { ...fn, enabledEls: nen };
                  };
                  const fixedCrewFloor = (fv, type) => { const c = fv.fixedCrew || {}; if (c[type] != null && c[type] !== "") return Number(c[type]) || 0; if (type === "Labours") return Number(fv.minLabour) || 0; return 0; };
                  // Usage-based labour floor — MUST match the project-total rollup (DealCheckOverlay):
                  // Labours = ceil(Σ sub-cat units ÷ per-unit) over FRESH zones (repeat excluded).
                  const _labBatches = {}; heavyElementRanges.forEach(her => { if (her && her.subCat && Number(her.perCount) > 0) _labBatches[her.subCat] = Number(her.perCount); });
                  const labourUsageMode = Object.keys(_labBatches).length > 0;
                  let labourUsageTotal = 0;
                  if (labourUsageMode) fns.forEach(fn => walkFnElements(freshFnMP(fn), ({ rc, qty }) => { const b = lookupBySubcat(_labBatches, itemImsSubcat(rc)); if (b) labourUsageTotal += (Number(qty) || 0) / b; }));

                  // ── People count per ceremony per labour type ─────────────
                  // Mirror of IMS App.jsx calcTier1Flowerist (line 1701). DO NOT diverge without IMS commit.
                  const calcPeopleFlowerists = (fn) => {
                    let total = 0;
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "florals") return;
                      // The element's own recipe first — that is what Build priced it with, and it
                      // resolves even when there is no rate-card row to match a name against.
                      // Beyond that, matchFlowerPattern (flowerHelpers.js) is the SAME sub-category-first
                      // matcher Build's own pricing and Deal Check's Florals tab already use — a recipe is
                      // created PER SUB-CATEGORY and applies to every differently-named product filed
                      // under it ("Flower Pot Small" → "Round Fibre Pot", "Terracotta Fibre Element", etc.),
                      // not to one product whose name happens to match. This used to be a hand-rolled
                      // exact-name-then-substring lookup against the item's OWN name, which could only ever
                      // find a pattern that happened to be named identically to the physical prop — every
                      // sub-category-linked recipe (the normal case) silently reported "no pattern" here
                      // while pricing and costing fine everywhere else.
                      let pattern = el.patternId ? flowerPatternsMP.find(p => p.id === el.patternId) : null;
                      if (!pattern) pattern = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, flowerPatternsMP);
                      if (!pattern) return;
                      const sizeKey = sizeFromMode(pattern?.mode || rc?.inhouseMode, el.size);
                      const sizes = pattern.sizes || {};
                      let comp = sizes[sizeKey] || sizes.medium;
                      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                      const upf = Number(comp?.unitsPerFlowerist || 0);
                      if (upf > 0) total += qty / upf; // fractional, ceil once below
                    });
                    return Math.ceil(total);
                  };
                  // Mirror of IMS calcTier1Electrician (line 1729).
                  const calcPeopleElectricians = (fn) => {
                    let total = 0;
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "lighting") return;
                      const sub = rc.sub || "";
                      const prod = electricianProdMP[sub];
                      if (!prod) return;
                      // Lighting, not florals — there is no recipe here, so the rate card's own mode
                      // is the only source for the size.
                      const sizeKey = sizeFromMode(rc?.inhouseMode, el.size);
                      const upe = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
                      if (upe > 0) total += qty / upe; // fractional, ceil once below
                    });
                    return Math.ceil(total);
                  };
                  // Mirror of IMS calcTier2 (line 1738). Tier 2 = sub-cat batches.
                  const calcPeopleTier2 = (fn, type) => {
                    const cfg = labourTiers[type] || { minimum:1, subCatBatches:{} };
                    const batches = cfg.subCatBatches || {};
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      // Case/whitespace-insensitive — an admin's config chip and an inventory item's
                      // own sub-category are independently typed strings (see lookupBySubcat).
                      if (lookupBySubcat(batches, sub) != null) subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    // Sum fractional need across sub-categories, THEN round up once.
                    let frac = 0;
                    Object.entries(subCounts).forEach(([sc, count]) => {
                      const b = lookupBySubcat(batches, sc) || 3;
                      frac += count / b;
                    });
                    return Math.max(cfg.minimum || 1, Math.ceil(frac));
                  };
                  // Mirror of IMS calcTier3 (line 1756). Tier 3 = venue + event + situational + heavy.
                  const calcPeopleTier3Labours = (fn) => {
                    const venueName = fn.fnVenue || "";
                    // No internal venue floor — the fixed-venue floor is applied uniformly for ALL types in
                    // peopleByFn (max(fixedCrew, computed)). Here we only compute the usage/heavy build need.
                    const venueMin = 0;
                    const dumpingLevel = (dealCheckData?.venueDumping || {})[venueName] || "nearby";
                    const dumpingMult = ({ nearby:1.0, medium:1.1, far:1.2 })[dumpingLevel] || 1.0;
                    const segment = "outdoor_budgeted"; // default (Studio has no segment field)
                    const eventMult = eventTypeMultipliers[segment] || 1;
                    const base = Math.ceil(venueMin * eventMult);
                    const dayPrior = dcMpIncludeMinusOne; // -1 day enabled = day-prior confirmed
                    let situationalMult = 1.0;
                    if (!dayPrior) {
                      const candidates = [dumpingMult];
                      const season = seasonMapMP[fn.fnDate||""];
                      if (season === "kings") candidates.push(sayaMultiplier);
                      const timingId = shiftToTiming(fn.fnShift);
                      candidates.push(eventTimingMultFor(eventTimingMultipliers, timingId, "Labours", 1.0));
                      situationalMult = Math.max(...candidates, 1.0);
                    }
                    const adjusted = Math.ceil(base * situationalMult);
                    // Heavy element add-ons
                    let heavyExtra = 0;
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    // Net fixed-venue standing inventory (by matched item id) — mirrors IMS.
                    const reduction = standingReductionBySubcat({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || "", (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                    heavyElementRanges.forEach(her => {
                      const count = Math.max(0, (lookupBySubcat(subCounts, her.subCat) || 0) - (lookupBySubcat(reduction, her.subCat) || 0));
                      heavyExtra += heavyExtraLabour(her, count);
                    });
                    // Usage-based floor (matches the rollup / quote): never fewer than 1 labour per N units.
                    return labourUsageMode ? Math.max(adjusted + heavyExtra, Math.ceil(labourUsageTotal)) : (adjusted + heavyExtra);
                  };
                  // §23 Phase 2.8 (26 May 2026) — Per-zone Fabric Bangali calculation
                  //   • Per-zone RFT ceil (each zone rounds independently, not summed)
                  //   • U Truss: only "back" checkbox = L-span (no left/right options)
                  //   • Half Box: back (L-span) + left (backDepth) + right (backDepth), all per-toggle
                  //   • Full Box: back (dL) + left (dW) + right (dW). NEVER front (audience-facing, always open)
                  //   • Wall Masking element-card branch deleted — fabric only ever comes from zone truss dims
                  //   • mkOn applies to all configs uniformly (was: half/u always-on under Phase 2.6 — reverted)
                  //   • Defaults set in normalizeMkWallsDefaults() applied silently on session load
                  // FINAL = Σ (zoneTop + ceil(zoneRft / fabricRftPerWorker)) over enabled zones with mkOn
                  // Multipliers (Heavy Saya × Premium × Day-Prior/Rush) deferred to Phase 2.7.
                  const calcPeopleFabricBangali = (fn) => {
                    let total = 0;
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    const engBackDepth = Number(dealCheckData?.trussInv?.settings?.defaultBackDepthFt) || 4;
                    Object.keys(zc).forEach(zk => {
                      if (!en[zk] || !zc[zk]) return;
                      const z = zc[zk];
                      if (!z.mkOn) return;
                      const cfg = resolveTrussConfig(z);
                      if (!cfg || !cfg.config) return;
                      const config = cfg.config;
                      const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0;
                      const dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
                      const mw = z.mkWalls || {};
                      const sideDepth = Number(z.trussBackDepth) || engBackDepth;

                      let zoneTop = 0;
                      let zoneRft = 0;

                      if (config === "full_box") {
                        // Top sqft per-zone range lookup
                        const topSqft = dL * dW;
                        if (topSqft > 0 && fabricBangaliRanges.length > 0) {
                          for (const r of fabricBangaliRanges) {
                            if (topSqft <= r.upTo) { zoneTop = r.labour || 0; break; }
                          }
                        }
                        // Side walls — back spans the WIDTH (dW), left/right span the DEPTH (dL). Never front.
                        if (mw.back  && dW > 0) zoneRft += dW;
                        if (mw.left  && dL > 0) zoneRft += dL;
                        if (mw.right && dL > 0) zoneRft += dL;
                      } else if (config === "half_box") {
                        // Half Box — back (L-span) + left/right (backDepth) per-toggle
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back  && spanL > 0)      zoneRft += spanL;
                        if (mw.left  && sideDepth > 0)  zoneRft += sideDepth;
                        if (mw.right && sideDepth > 0)  zoneRft += sideDepth;
                      } else if (config === "u_only") {
                        // U Truss — only "back" checkbox (L-span). No left/right.
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back && spanL > 0) zoneRft += spanL;
                      }

                      const zoneRftLabour = zoneRft > 0 ? Math.ceil(zoneRft / fabricRftPerWorker) : 0;
                      total += zoneTop + zoneRftLabour;
                    });

                    return total;
                  };
                  // Truss Labour — §23 Phase 2.5 rewire: count pillars from zone-derived Layer 1
                  // topology (matches what Deal Check Truss tab shows). The previous element-counting
                  // logic (Pillar/Column/Truss subcat scan) was never reaching zone-defined trusses
                  // because §23 stores truss as zone.trussType + zone.dims, not as Pillar elements.
                  const calcPeopleTrussLabour = (fn) => {
                    let pillars = 0;
                    // ── §23 Phase 2.5: zone-derived pillar count (Layer 1 truth) ──
                    const tInv = dealCheckData?.trussInv;
                    if (tInv) {
                      const zc = fn.zoneConfig || {};
                      const en = fn.enabledEls || {};
                      Object.keys(zc).forEach(zk => {
                        if (!en[zk] || !zc[zk]) return;
                        try {
                          const pv = calcZoneTrussPreview(zc[zk], tInv);
                          if (pv?.topology?.pillarCount) pillars += pv.topology.pillarCount;
                        } catch {}
                      });
                    }
                    // Net the venue's standing (installed) pillars — reused truss adds no labour.
                    pillars = Math.max(0, pillars - standingPillarCount({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || ""));
                    if (pillars <= 0 || trussLabourRanges.length === 0) return 0;
                    for (const r of trussLabourRanges) {
                      if (pillars <= r.upTo) return r.labour || 0;
                    }
                    return trussLabourRanges[trussLabourRanges.length-1]?.labour || 0;
                  };
                  // Default counts for types without IMS auto-compute
                  const calcPeopleDefault = (fn, type) => {
                    if (type === "Supervisors") return 1;
                    if (type === "Helpers") return 0;
                    if (type === "Drivers") return 0;
                    return 0;
                  };
                  // Dispatcher
                  const calcPeopleForType = (fn, type) => {
                    if (type === "Flowerists") return calcPeopleFlowerists(fn);
                    if (type === "Electricians") return calcPeopleElectricians(fn);
                    if (type === "Labours") return calcPeopleTier3Labours(fn);
                    if (type === "Fabric Bangali") return calcPeopleFabricBangali(fn);
                    if (type === "Truss Labour") return calcPeopleTrussLabour(fn);
                    const cfg = labourTiers[type];
                    if (cfg && cfg.tier === 2) return calcPeopleTier2(fn, type);
                    if (cfg && cfg.tier === 3) return calcPeopleTier3Labours(fn);
                    return calcPeopleDefault(fn, type);
                  };

                  // ── Trace helpers (22 May 2026 · breakdown UI) ─────────────
                  // Return calculation breakdown structures for the "how" toggle panel.
                  // Each returns { type:"element_table"|"formula_chain"|"subcat_table"|"range_lookup"|"default", ... }
                  // Aggregate identical elements (same name + size + productivity) ACROSS zones into one row —
                  // flowerists/electricians are fungible & the count is just Σ(qty÷productivity), so showing the
                  // same element once (with its combined qty) reads cleaner and doesn't change the total.
                  // (Fabric Bangali stays per-zone — its RFT ceils per zone, so it MUST NOT be combined.)
                  const traceFlowerists = (fn) => {
                    const agg = {};
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "florals") return;
                      const targetName = (rc.name||"").toLowerCase().trim();
                      // The element's own recipe first — that is what Build priced it with. Beyond
                      // that, matchFlowerPattern (flowerHelpers.js) is the SAME sub-category-first
                      // matcher Build's own pricing and Deal Check's Florals tab already use — see
                      // calcPeopleFlowerists above for the full explanation of why a name-only lookup
                      // silently missed every sub-category-linked recipe (the normal case).
                      let pattern = el.patternId ? flowerPatternsMP.find(p => p.id === el.patternId) : null;
                      if (!pattern) pattern = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, flowerPatternsMP);
                      if (!pattern) {
                        // el.invId-backed with no recipe = a plain inventory prop/holder, not a flower
                        // arrangement — it was never going to need a flowerist (calcPeopleFlowerists
                        // already excludes it from the real count above), and it's already counted in
                        // the sub-category labour planning below. Not worth a "no pattern" row here; a
                        // recipe-only element (el.patternId set but unresolved — e.g. a deleted recipe)
                        // has no invId and still surfaces, since that IS a real problem to flag.
                        if (el.invId) return;
                        const k = `${targetName}||nopattern`; if (!agg[k]) agg[k] = { name: rc.name, size: null, qty: 0, productivity: null, missing: "no pattern" }; agg[k].qty += qty; return;
                      }
                      const sizeKey = sizeFromMode(pattern?.mode || rc?.inhouseMode, el.size);
                      const sizes = pattern.sizes || {};
                      let comp = sizes[sizeKey] || sizes.medium;
                      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                      const upf = Number(comp?.unitsPerFlowerist || 0);
                      const k = `${targetName}|${sizeKey}|${upf}`;
                      if (!agg[k]) agg[k] = { name: rc.name, size: sizeKey, qty: 0, productivity: upf, missing: upf <= 0 ? "no productivity" : null };
                      agg[k].qty += qty;
                    });
                    let total = 0;
                    const items = Object.values(agg).map(r => { const need = r.productivity > 0 ? r.qty / r.productivity : 0; total += need; return { ...r, need: Math.round(need * 100) / 100 }; });
                    return { kind: "element_table", header: ["Floral element","Qty","Per flwr","Need"], items, total: Math.ceil(total), formula: "⌈Σ(qty ÷ productivity)⌉ — sum then round up (Tier 1)" };
                  };
                  const traceElectricians = (fn) => {
                    const agg = {};
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "lighting") return;
                      const sub = rc.sub || "";
                      const prod = electricianProdMP[sub];
                      if (!prod) { const k = `${(rc.name||"").toLowerCase().trim()}||noprod`; if (!agg[k]) agg[k] = { name: rc.name, size: null, qty: 0, productivity: null, missing: "no productivity" }; agg[k].qty += qty; return; }
                      // Lighting, not florals — no recipe, so the rate card's mode is the only source.
                      const sizeKey = sizeFromMode(rc?.inhouseMode, el.size);
                      const upe = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
                      const k = `${(rc.name||"").toLowerCase().trim()}|${sizeKey}|${upe}`;
                      if (!agg[k]) agg[k] = { name: rc.name, size: sizeKey, qty: 0, productivity: upe, missing: upe <= 0 ? "no productivity" : null };
                      agg[k].qty += qty;
                    });
                    let total = 0;
                    const items = Object.values(agg).map(r => { const need = r.productivity > 0 ? r.qty / r.productivity : 0; total += need; return { ...r, need: Math.round(need * 100) / 100 }; });
                    return { kind: "element_table", header: ["Lighting element","Qty","Per electr","Need"], items, total: Math.ceil(total), formula: "⌈Σ(qty ÷ productivity)⌉ — sum then round up (Tier 1)" };
                  };
                  const traceTier2 = (fn, type) => {
                    const cfg = labourTiers[type] || { minimum:1, subCatBatches:{} };
                    const batches = cfg.subCatBatches || {};
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      if (lookupBySubcat(batches, sub) != null) subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    const rows = []; let frac = 0;
                    Object.entries(subCounts).forEach(([sc, count]) => {
                      const b = lookupBySubcat(batches, sc) || 3;
                      const part = count / b;
                      rows.push({ sub: sc, count, batch: b, need: Math.round(part * 100) / 100 }); // fractional contribution
                      frac += part;
                    });
                    const sum = Math.ceil(frac);
                    const total = Math.max(cfg.minimum || 1, sum);
                    return { kind: "subcat_table", header: ["Sub-category","Count","Batch","Need"], rows, sum, frac: Math.round(frac * 100) / 100, minimum: cfg.minimum || 1, total, formula: "max(min, ⌈Σ(count ÷ batch)⌉) (Tier 2)" };
                  };
                  const traceTier3Labours = (fn) => {
                    // Labours are fungible: EVERY element's sub-category contributes (count ÷ its "1-per-N")
                    // — summed across ALL elements and rounded up ONCE (mirrors calcPeopleTier3Labours'
                    // labourUsageTotal). The venue-min (+ situational) acts as a FLOOR. The old trace only
                    // showed per-sub-category FLOORED heavy add-ons, so tiny quantities (e.g. 6 console tables
                    // at 1-per-20) vanished and it looked like only Stage counted — but the count already
                    // summed them. This table now shows the real derivation.
                    const venueName = fn.fnVenue || "—";
                    const _fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                    const _fv = fixedVenueFor(_fvCfg, venueName);
                    const venueMin = _fv ? (_fv.minLabour ?? defaultMinLabour) : 0; // min only for fixed venues
                    const dumpingLevel = (dealCheckData?.venueDumping || {})[venueName] || "nearby";
                    const dumpingMult = ({ nearby:1.0, medium:1.1, far:1.2 })[dumpingLevel] || 1.0;
                    const eventMult = eventTypeMultipliers["outdoor_budgeted"] || 1;
                    const base = Math.ceil(venueMin * eventMult);
                    const season = seasonMapMP[fn.fnDate||""];
                    const sayaMult = season === "kings" ? sayaMultiplier : 1.0;
                    const timingId = shiftToTiming(fn.fnShift);
                    const timingMult = eventTimingMultFor(eventTimingMultipliers, timingId, "Labours", 1.0);
                    const timingLabel = "⏰ " + (EVENT_TIMINGS.find(t => t.id === timingId)?.label || timingId);
                    let situationalMult = 1.0;
                    if (!dcMpIncludeMinusOne) {
                      situationalMult = Math.max(dumpingMult, sayaMult, timingMult, 1.0);
                    }
                    const adjusted = Math.ceil(base * situationalMult); // venue-min floor (with situational)
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => { const s = itemImsSubcat(rc); subCounts[s] = (subCounts[s] || 0) + qty; });
                    const reductionB = standingReductionBySubcat({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || "", (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                    const rows = []; let usageSum = 0, heavyFloor = 0;
                    heavyElementRanges.forEach(her => {
                      const per = Number(her.perCount) || 0; if (per <= 0) return;
                      const count = Math.max(0, (lookupBySubcat(subCounts, her.subCat) || 0) - (lookupBySubcat(reductionB, her.subCat) || 0));
                      if (count <= 0) return;
                      usageSum += count / per;
                      heavyFloor += heavyExtraLabour(her, count);
                      rows.push({ sub: her.subCat, count, batch: per, need: Math.round((count / per) * 100) / 100 });
                    });
                    rows.sort((a, b) => b.need - a.need);
                    const usageCeil = Math.ceil(usageSum);
                    const floorSide = adjusted + heavyFloor; // venue-min (situational) + per-sub-cat heavy floors
                    const total = Math.max(floorSide, usageCeil);
                    // Read-only trace for the shared ManpowerFactorPills breakdown (Deal Check → Dept
                    // Ops → old Manpower tab parity) — mirrors computeTier3Trace's shape.
                    const situational = {
                      venueName, venueMin, segment: "outdoor_budgeted", eventMult,
                      dayPrior: dcMpIncludeMinusOne, tentative: false,
                      dumpMult: dumpingMult, sayaMult, timingMult, timingLabel,
                      sitMax: situationalMult,
                      sitWinner: dcMpIncludeMinusOne ? "none (day-prior ✓)" : situationalMult===dumpingMult&&dumpingMult>1 ? "Dumping ×"+dumpingMult : situationalMult===sayaMult&&sayaMult>1 ? "Saya ×"+sayaMult : situationalMult===timingMult&&timingMult>1 ? timingLabel+" ×"+timingMult : "none",
                      heavyExtra: heavyFloor, heavyBreakdown: [], sameDayFns: [],
                    };
                    return { kind: "subcat_table", header: ["Sub-category","Count","1 per","Need"], rows, sum: usageCeil, frac: Math.round(usageSum * 100) / 100, minimum: floorSide, total, formula: "max(venue-min floor, ⌈Σ(count ÷ 1-per-N)⌉) — summed across ALL elements (Tier 3)", situational };
                  };
                  // §23 Phase 2.6 — trace mirrors new top+RFT logic
                  const traceFabricBangali = (fn) => {
                    // §23 Phase 2.8 — Per-zone breakdown: each zone shows its own top + RFT + ceiling.
                    // Wall Masking element-card branch removed (fabric only ever from zone truss).
                    const items = [];
                    let grandTotal = 0;
                    let grandRft = 0;
                    let grandTop = 0;
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    const engBackDepth = Number(dealCheckData?.trussInv?.settings?.defaultBackDepthFt) || 4;
                    Object.keys(zc).forEach(zk => {
                      if (!en[zk] || !zc[zk]) return;
                      const z = zc[zk];
                      if (!z.mkOn) return;
                      const cfg = resolveTrussConfig(z);
                      if (!cfg || !cfg.config) return;
                      const config = cfg.config;
                      const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0;
                      const dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
                      const mw = z.mkWalls || {};
                      const sideDepth = Number(z.trussBackDepth) || engBackDepth;
                      const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                      const cfgLabel = config === "u_only" ? "U Truss" : config === "half_box" ? "Half Box" : "Full Box";

                      let zoneTop = 0;
                      let zoneRft = 0;
                      const parts = []; // per-zone wall lines

                      if (config === "full_box") {
                        const topSqft = dL * dW;
                        if (topSqft > 0 && fabricBangaliRanges.length > 0) {
                          for (const r of fabricBangaliRanges) {
                            if (topSqft <= r.upTo) { zoneTop = r.labour || 0; break; }
                          }
                        }
                        parts.push({ kind: "top", label: `Top ${dL}×${dW} = ${topSqft} sqft → ${zoneTop} ppl`, workers: zoneTop });
                        if (mw.back  && dW > 0) { parts.push({ kind: "rft", label: `Back RFT: ${dW}`,  rft: dW }); zoneRft += dW; }
                        if (mw.left  && dL > 0) { parts.push({ kind: "rft", label: `Left RFT: ${dL}`,  rft: dL }); zoneRft += dL; }
                        if (mw.right && dL > 0) { parts.push({ kind: "rft", label: `Right RFT: ${dL}`, rft: dL }); zoneRft += dL; }
                      } else if (config === "half_box") {
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back  && spanL > 0)     { parts.push({ kind: "rft", label: `Back RFT: ${spanL} (L-span)`,  rft: spanL }); zoneRft += spanL; }
                        if (mw.left  && sideDepth > 0) { parts.push({ kind: "rft", label: `Left RFT: ${sideDepth} (backDepth)`,  rft: sideDepth }); zoneRft += sideDepth; }
                        if (mw.right && sideDepth > 0) { parts.push({ kind: "rft", label: `Right RFT: ${sideDepth} (backDepth)`, rft: sideDepth }); zoneRft += sideDepth; }
                      } else if (config === "u_only") {
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back && spanL > 0) { parts.push({ kind: "rft", label: `Back RFT: ${spanL} (L-span)`, rft: spanL }); zoneRft += spanL; }
                      }

                      // Skip zones with zero contribution (mkOn but no walls ticked)
                      if (zoneTop === 0 && zoneRft === 0) return;

                      const zoneRftLabour = zoneRft > 0 ? Math.ceil(zoneRft / fabricRftPerWorker) : 0;
                      const zoneTotal = zoneTop + zoneRftLabour;
                      grandTop += zoneTop;
                      grandRft += zoneRft;
                      grandTotal += zoneTotal;

                      items.push({
                        zoneHeader: `${zLabel} (${cfgLabel})`,
                        parts,
                        rftSum: zoneRft,
                        rftLabour: zoneRftLabour,
                        topLabour: zoneTop,
                        zoneTotal,
                        zoneSubLabel: zoneRft > 0
                          ? `Zone RFT: ${zoneRft} ÷ ${fabricRftPerWorker} → ${zoneRftLabour} ppl${zoneTop > 0 ? `   |   Top: ${zoneTop} ppl` : ""}`
                          : (zoneTop > 0 ? `Top: ${zoneTop} ppl` : ""),
                      });
                    });

                    const rangeLabel = `Per-zone: top sqft → range table | side RFT → ceil(zoneRft ÷ ${fabricRftPerWorker})`;
                    return {
                      kind: "range_lookup_per_zone",
                      items,
                      totalAmount: grandRft,
                      totalUnit: `RFT total across zones (each ceiled per-zone)`,
                      rangeLabel,
                      total: grandTotal,
                      topLabour: grandTop,
                      totalRft: grandRft,
                      formula: "Per-zone: top sqft → range table + ceil(zoneRft ÷ " + fabricRftPerWorker + "). Each zone calculated independently. (Multipliers TBD Phase 2.7)"
                    };
                  };
                  const traceTrussLabour = (fn) => {
                    const items = []; let pillars = 0;
                    // ── §23 Phase 2.5: zone-derived pillar count (Layer 1 truth) ──
                    const tInv = dealCheckData?.trussInv;
                    if (tInv) {
                      const zc = fn.zoneConfig || {};
                      const en = fn.enabledEls || {};
                      Object.keys(zc).forEach(zk => {
                        if (!en[zk] || !zc[zk]) return;
                        try {
                          const pv = calcZoneTrussPreview(zc[zk], tInv);
                          if (pv?.topology?.pillarCount) {
                            const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                            const cfg = pv.config === "u_only" ? "U Truss" : pv.config === "half_box" ? "Half Box" : "Full Box";
                            items.push({ name: `${zLabel} (${cfg})`, sub: "(zone-derived)", qty: pv.topology.pillarCount });
                            pillars += pv.topology.pillarCount;
                          }
                        } catch {}
                      });
                    }
                    let total = 0, rangeLabel = "—";
                    if (pillars > 0 && trussLabourRanges.length > 0) {
                      for (const r of trussLabourRanges) {
                        if (pillars <= r.upTo) { total = r.labour || 0; rangeLabel = `up to ${r.upTo} pillars`; break; }
                      }
                      if (total === 0) { const last = trussLabourRanges[trussLabourRanges.length-1]; total = last?.labour || 0; rangeLabel = `${last?.upTo}+ pillars`; }
                    }
                    return { kind: "range_lookup", items, totalAmount: pillars, totalUnit: "pillars", rangeLabel, total, formula: "Σ pillar count from §23 Layer 1 topology (zone-derived) → range table lookup" };
                  };
                  const traceForType = (fn, type) => {
                    if (type === "Flowerists") return traceFlowerists(fn);
                    if (type === "Electricians") return traceElectricians(fn);
                    if (type === "Labours") return traceTier3Labours(fn);
                    if (type === "Fabric Bangali") return traceFabricBangali(fn);
                    if (type === "Truss Labour") return traceTrussLabour(fn);
                    const cfg = labourTiers[type];
                    if (cfg && cfg.tier === 2) return traceTier2(fn, type);
                    if (cfg && cfg.tier === 3) return traceTier3Labours(fn);
                    return { kind: "default", note: `${type} count is a fixed default (no derivation)`, total: calcPeopleDefault(fn, type) };
                  };
                  const toggleCalcOpen = (date, type) => {
                    setDcMpCalcOpen(prev => ({ ...prev, [`${date}|${type}`]: !prev[`${date}|${type}`] }));
                  };

                  // ── Booking timeline ──────────────────────────────────────
                  const fnDates = fns.map(f => f.fnDate).filter(Boolean).sort();
                  if (fnDates.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>No function dates set.</div>;
                  const addDays = (isoDate, n) => {
                    const d = new Date(isoDate + "T00:00:00Z");
                    d.setUTCDate(d.getUTCDate() + n);
                    return d.toISOString().slice(0,10);
                  };
                  const earliest = fnDates[0];
                  const latest = fnDates[fnDates.length-1];
                  const dayList = [];
                  if (dcMpIncludeMinusOne) dayList.push({ date: addDays(earliest, -1), phase: "minusOne", fns: [] });
                  // Iterate days from earliest to latest, marking fn days as 'event' and in-between days as 'gap'
                  let cur = earliest;
                  while (cur <= latest) {
                    const fnsOnDay = fns.filter(f => f.fnDate === cur);
                    if (fnsOnDay.length > 0) dayList.push({ date: cur, phase: "event", fns: fnsOnDay });
                    else dayList.push({ date: cur, phase: "gap", fns: [] });
                    cur = addDays(cur, 1);
                  }
                  if (dcMpIncludeDismantle) {
                    // Every function whose immediate next calendar day ISN'T itself another function's
                    // day gets a real dismantle day right after it (dismantlingPct applied), not a flat
                    // carried-forward "gap" day — a 24/26/28 booking dismantles after EACH of 24 and 26,
                    // not just once at the very end. Back-to-back functions (next day IS an event, e.g.
                    // 24/25/26) never get one in between: the crew flows straight into the next setup.
                    // The last function's dismantle day (latest+1) falls outside the earliest..latest
                    // loop above, so it needs inserting rather than converting an existing gap entry.
                    const eventDates = new Set(dayList.filter(d => d.phase === "event").map(d => d.date));
                    dayList.filter(d => d.phase === "event").forEach(d => {
                      const nextDate = addDays(d.date, 1);
                      if (eventDates.has(nextDate)) return; // back-to-back — no dismantle day in between
                      const existing = dayList.find(x => x.date === nextDate);
                      if (existing) existing.phase = "dismantle";
                      else dayList.push({ date: nextDate, phase: "dismantle", fns: [] });
                    });
                    dayList.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
                  }

                  // ── People count per fn × labour type ─────────────────────
                  // For each labour type present in dihariSchemes, compute people count for each fn.
                  const labourTypes = Object.keys(dihariSchemes);
                  const peopleByFn = {}; // { [labourType]: { [fnIdx]: count } }
                  labourTypes.forEach(type => {
                    peopleByFn[type] = {};
                    fns.forEach((fn, fi) => {
                      const fv = fixedVenueFor(_fvCfgAll, fn.fnVenue || "");
                      const computed = calcPeopleForType(freshFnMP(fn), type) || 0;
                      peopleByFn[type][fi] = fv ? Math.max(fixedCrewFloor(fv, type), computed) : computed;
                    });
                  });

                  // ── Cumulative MAX per day per type ───────────────────────
                  // Rule: people only scale UP. On each day, count = MAX(yesterday's count, today's ceremony need).
                  // Setup (-1 day): count = max of ALL upcoming events' need (full crew comes early).
                  // Gap day: count = previous day's count (carry forward).
                  // Dismantle: count = previous day's count.
                  // Event day: count = MAX(yesterday, max of fns on this day).
                  const countByDay = {}; // { [date]: { [type]: count } }
                  let runningMax = {};
                  labourTypes.forEach(t => { runningMax[t] = 0; });
                  dayList.forEach(d => {
                    if (d.phase === "minusOne") {
                      // Setup day: full crew per type = MAX of all event days' needs
                      labourTypes.forEach(t => {
                        let mx = 0;
                        fns.forEach((fn, fi) => { if ((peopleByFn[t][fi]||0) > mx) mx = peopleByFn[t][fi]; });
                        runningMax[t] = Math.max(runningMax[t], mx);
                      });
                    } else if (d.phase === "event") {
                      labourTypes.forEach(t => {
                        let todaysNeed = 0;
                        d.fns.forEach(fn => {
                          const fi = fns.indexOf(fn);
                          if ((peopleByFn[t][fi]||0) > todaysNeed) todaysNeed = peopleByFn[t][fi];
                        });
                        runningMax[t] = Math.max(runningMax[t], todaysNeed);
                      });
                    } else if (d.phase === "dismantle") {
                      // Dismantle day: apply dismantlingPct per type from settings
                      labourTypes.forEach(t => {
                        const pct = (labourTiers[t]||{}).dismantlingPct;
                        if (typeof pct === "number") {
                          runningMax[t] = pct > 0 ? Math.ceil(runningMax[t] * pct / 100) : 0;
                        }
                        // else: no dismantlingPct set → carry forward full crew (backward compat)
                      });
                    } // gap: carry runningMax forward unchanged
                    countByDay[d.date] = { ...runningMax };
                  });

                  // ── Resolve windows for a day × type (overrides → defaults → empty) ──
                  const getWindowsForDayType = (dateISO, type, phase) => {
                    const overrideKey = `${dateISO}|${type}`;
                    if (dcMpOverrides[overrideKey]) return dcMpOverrides[overrideKey];
                    return (defaultWindowsByPhase[type] || {})[phase] || [];
                  };
                  const setWindowsForDayType = (dateISO, type, windowIds) => {
                    setDcMpOverrides(prev => ({ ...prev, [`${dateISO}|${type}`]: windowIds }));
                  };
                  const toggleWindow = (dateISO, type, winId, phase) => {
                    const cur = getWindowsForDayType(dateISO, type, phase);
                    const next = cur.includes(winId) ? cur.filter(x=>x!==winId) : [...cur, winId];
                    setWindowsForDayType(dateISO, type, next);
                    // Turning a window OFF clears any per-shift count so it doesn't linger; ON leaves it to default.
                    if (cur.includes(winId)) setWinCount(dateISO, type, winId, null);
                  };
                  // Per-shift (per-dihari) crew count: the ops manager can keep e.g. 2 flowerists in shift 1 but
                  // only 1 in shift 2. Default = the day's computed crew count. Stored in dcMpWinCount.
                  const winCountFor = (dateISO, type, winId, defPpl) => { const v = dcMpWinCount?.[type]?.[dateISO]?.[winId]; return (v != null && v !== "") ? (Number(v) || 0) : defPpl; };
                  const setWinCount = (dateISO, type, winId, val) => setDcMpWinCount(prev => {
                    const n = { ...(prev || {}) };
                    const byType = { ...(n[type] || {}) };
                    const byDate = { ...(byType[dateISO] || {}) };
                    if (val == null) delete byDate[winId]; else byDate[winId] = Math.max(0, Number(val) || 0);
                    if (Object.keys(byDate).length) byType[dateISO] = byDate; else delete byType[dateISO];
                    if (Object.keys(byType).length) n[type] = byType; else delete n[type];
                    return n;
                  });

                  // ── Compute booking-total cost (per-shift crew aware) ─────────
                  let bookingTotalCost = 0, bookingTotalDihari = 0;
                  const dayCosts = {}; // { [date]: { total, slots, byType: { [type]: { ppl, dihari, cost } } } }
                  dayList.forEach(d => {
                    const dayBreakdown = { total: 0, slots: 0, byType: {} };
                    labourTypes.forEach(t => {
                      const ppl = countByDay[d.date][t] || 0;
                      if (ppl <= 0) return;
                      const scheme = dihariSchemes[t] || { rate:0, windows:[] };
                      const wins = getWindowsForDayType(d.date, t, d.phase);
                      const dihari = wins.length;
                      const effRate = rateByType[t] || 0;
                      const slots = wins.reduce((s, id) => s + winCountFor(d.date, t, id, ppl), 0); // Σ per-shift crew
                      const cost = slots * effRate;
                      dayBreakdown.byType[t] = { ppl, dihari, cost, windowsTicked: wins };
                      dayBreakdown.total += cost;
                      dayBreakdown.slots += slots;
                    });
                    dayCosts[d.date] = dayBreakdown;
                    bookingTotalCost += dayBreakdown.total;
                    bookingTotalDihari += dayBreakdown.slots;
                  });

                  // ── Scope to the selected function unless "All functions" is on ──
                  // The cumulative MAX rule above still has to run over every day of the WHOLE
                  // booking — crew that arrives early for a later ceremony doesn't stop counting
                  // just because this screen is only showing one function — so nothing above this
                  // point is scoped. Only which day CARDS get rendered, and which total is shown
                  // in the header, are. This used to always render every function's day no matter
                  // which one was selected in the sidebar.
                  const selectedFn = fns[activeFnIdx || 0];
                  // Selecting a function means "this function's own manpower", not "this exact
                  // calendar date" — its dismantle day (the day right after its own event day, if the
                  // booking-wide dayList classified it as one) and, if this function is the FIRST one
                  // in the booking, the shared early-setup (-1) day both belong to it and must show
                  // here too, not just under "All functions".
                  const scopedDayList = dayList.filter(d => {
                    if (d.phase === "event") return d.fns.includes(selectedFn);
                    if (d.phase === "dismantle") return selectedFn && d.date === addDays(selectedFn.fnDate, 1);
                    if (d.phase === "minusOne") return selectedFn && selectedFn.fnDate === earliest;
                    return false;
                  });
                  const visibleDayList = dcShowAllFns ? dayList : (scopedDayList.length ? scopedDayList : dayList); // fallback avoids a blank screen
                  const visibleTotalCost = dcShowAllFns ? bookingTotalCost : visibleDayList.reduce((s, d) => s + (dayCosts[d.date]?.total || 0), 0);
                  const visibleTotalDihari = dcShowAllFns ? bookingTotalDihari : visibleDayList.reduce((s, d) => s + (dayCosts[d.date]?.slots || 0), 0);

                  // ── UI ─────────────────────────────────────────────────────
                  const fmtDateShort = (iso) => {
                    try {
                      const d = new Date(iso + "T00:00:00Z");
                      return d.toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short", timeZone:"UTC" });
                    } catch { return iso; }
                  };
                  const phaseEmoji = (p) => ({ minusOne:"⏮️", event:"🎉", gap:"⏸️", dismantle:"🧹" })[p] || "📅";
                  const phaseLabel = (p) => ({ minusOne:"-1 Day · Early Setup", event:"Function Day", gap:"In-between Day", dismantle:"Dismantle Day" })[p] || p;
                  const typeEmoji = (t) => ({
                    "Flowerists":"🌸", "Electricians":"⚡", "Labours":"🔨", "Carpenters":"🪚",
                    "Painters":"🎨", "Fabric Bangali":"🧵", "Truss Labour":"🏗️",
                    "Helpers":"🤝", "Supervisors":"👔", "Drivers":"🚛"
                  })[t] || "👷";
                  // A tint per trade, purely so the icon tiles are distinguishable down the column —
                  // eight identical grey squares are worse than no squares at all, because the eye
                  // reads them as a repeated bullet rather than as a marker for THIS row.
                  // Presentation only: nothing keys off these, and an unlisted trade falls back to
                  // slate rather than to nothing.
                  const typeTint = (t) => ({
                    "Flowerists":"236,72,153", "Electricians":"245,158,11", "Labours":"59,130,246",
                    "Carpenters":"120,113,108", "Painters":"239,68,68", "Fabric Bangali":"168,85,247",
                    "Truss Labour":"14,165,233", "Helpers":"16,185,129", "Supervisors":"139,92,246",
                    "Drivers":"249,115,22"
                  })[t] || "100,116,139";

                  if (labourTypes.length === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>
                      No labour types defined. Set them in IMS Settings → 💰 Dihari Timings.
                    </div>;
                  }

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{MP_CSS}</style>

                      {/* ── PAGE HEAD ──
                          The amber band that stood here carried the booking total, and it carried
                          it ABOVE every day card. On a five-day booking under "All functions"
                          that meant the one number people read out loud had scrolled off by the
                          time you had opened the day you came for. The total now sits in the
                          summary bar at the foot of the tab, directly under the days it is the
                          sum of, so the figure and its workings are on screen together.
                          What is left here is identity and the two switches that decide which
                          days get counted at all — which belong at the top, because they change
                          every number below them. */}
                      <div className="dcm-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,padding:"15px 17px",display:"flex",flexDirection:"column",gap:13}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:5}}>Manpower forecast</div>
                            <div style={{fontSize:19,fontWeight:750,color:INK,letterSpacing:-0.4,lineHeight:1.15}}>
                              {dcShowAllFns ? "Whole booking" : (selectedFn?.fnType || "Function")}
                            </div>
                          </div>
                          {/* Scope chips. Under "All functions" the ceremony count matters (it is
                              what the MAX rule maxes over); scoped to one function it is always 1,
                              so it is not shown. */}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                            {dcShowAllFns && (
                              <span style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:999,background:CHIP_BG,color:INK_2,whiteSpace:"nowrap",...NUM}}>
                                {fns.length} ceremon{fns.length===1?"y":"ies"}
                              </span>
                            )}
                            <span style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:999,background:CHIP_BG,color:INK_2,whiteSpace:"nowrap",...NUM}}>
                              {visibleDayList.length} day{visibleDayList.length===1?"":"s"} counted
                            </span>
                            <span title="Crew is not added up across ceremonies. Each type carries forward at the highest count any single upcoming ceremony needs, so the same people cover consecutive days." style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:999,background:"#E0E7FF",color:"#3730A3",whiteSpace:"nowrap",cursor:"help"}}>
                              cumulative MAX
                            </span>
                          </div>
                        </div>
                        {/* The switches read as controls now rather than as two bare checkboxes
                            floating in a tinted band — a pressed pill shows which days are in. */}
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",borderTop:`1px solid ${HAIRLINE}`,paddingTop:12}}>
                          <label className={isAdmin?"dcm-btn":undefined} style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12.5,fontWeight:600,padding:"6px 11px",borderRadius:9,cursor:isAdmin?"pointer":"default",border:`1px solid ${dcMpIncludeMinusOne?"#C7CDD6":CARD_BORDER}`,background:dcMpIncludeMinusOne?TILE_BG:CARD_BG,color:isAdmin?INK:INK_3,opacity:isAdmin?1:0.7}}>
                            <input type="checkbox" checked={dcMpIncludeMinusOne} disabled={!isAdmin} onChange={e=>setDcMpIncludeMinusOne(e.target.checked)} style={{margin:0,accentColor:"#F59E0B"}} />
                            ⏮️ −1 day early setup
                          </label>
                          <label className={isAdmin?"dcm-btn":undefined} style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12.5,fontWeight:600,padding:"6px 11px",borderRadius:9,cursor:isAdmin?"pointer":"default",border:`1px solid ${dcMpIncludeDismantle?"#C7CDD6":CARD_BORDER}`,background:dcMpIncludeDismantle?TILE_BG:CARD_BG,color:isAdmin?INK:INK_3,opacity:isAdmin?1:0.7}}>
                            <input type="checkbox" checked={dcMpIncludeDismantle} disabled={!isAdmin} onChange={e=>setDcMpIncludeDismantle(e.target.checked)} style={{margin:0,accentColor:"#F43F5E"}} />
                            🧹 Dismantle days
                          </label>
                          {!isAdmin && <span style={{fontSize:11.5,color:INK_3,fontStyle:"italic",alignSelf:"center"}}>Read-only — manpower planning lives in IMS → Dept Ops</span>}
                          {/* ═══ RESET TO DERIVED ═══
                              Window picks and per-window head counts are saved per client and
                              restored on load, and a stored count WINS over the derived one
                              (winCountFor returns it whenever present). So a number typed weeks ago
                              silently outranks today's derivation — including after the build, the
                              recipe or the element list has changed.
                              Regenerate used to be the way to clear that, and it is gone, so this is
                              the only path back to a clean derivation. Shown only when something is
                              actually pinned, so it is not noise on an untouched deal. */}
                          {isAdmin && (Object.keys(dcMpOverrides || {}).length > 0 || Object.keys(dcMpWinCount || {}).length > 0) && (
                            <button
                              onClick={() => {
                                const nWin = Object.keys(dcMpWinCount || {}).length;
                                const nWnd = Object.keys(dcMpOverrides || {}).length;
                                const bits = [];
                                if (nWnd) bits.push(`${nWnd} shift selection${nWnd === 1 ? "" : "s"}`);
                                if (nWin) bits.push(`${nWin} manual head count${nWin === 1 ? "" : "s"}`);
                                if (!window.confirm(`Reset manpower to the derived plan?\n\nDiscards ${bits.join(" and ")}.\nThe crew is recalculated from the build. This cannot be undone.`)) return;
                                setDcMpOverrides({});
                                setDcMpWinCount({});
                              }}
                              title="Discard saved shift picks and head counts, and recalculate from the build"
                              className="dcm-btn"
                              style={{marginLeft:"auto",padding:"6px 11px",borderRadius:9,border:`1px solid ${GOLD}44`,background:GOLD_SOFT,color:GOLD,fontSize:12.5,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                              ↺ Reset to derived
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Day rows */}
                      {visibleDayList.map((d, di) => {
                        const breakdown = dayCosts[d.date] || { total:0, byType:{} };
                        const fnsOnDay = d.fns || [];
                        // Collapsible so "All functions" doesn't force scrolling past every other
                        // day's crew breakdown to reach the one you actually want — expanded by
                        // default when scoped to one function (usually just its own day or two),
                        // collapsed by default under "All". Keyed by date, which is unique per day.
                        const blockKey = `manpower:${d.date}`;
                        const isOpen = dcCollapsedFnBlocks[blockKey] !== undefined ? dcCollapsedFnBlocks[blockKey] : !dcShowAllFns;
                        const toggleOpen = () => setDcCollapsedFnBlocks(prev => ({ ...prev, [blockKey]: !isOpen }));
                        const acc = accentFor(d.phase);
                        // What the collapsed header has to answer without being opened: how many
                        // trades, how many bodies, how many dihari, how much. All four come off
                        // data already computed above — countByDay for heads, breakdown.slots for
                        // dihari — so the summary cannot drift from the rows underneath it.
                        const dayTypes = labourTypes.filter(t => (countByDay[d.date]?.[t] || 0) > 0);
                        const dayHeads = dayTypes.reduce((n, t) => n + (countByDay[d.date][t] || 0), 0);
                        const daySlots = Number(breakdown.slots) || 0;
                        return (
                          <div key={di} className="dcm-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                            {/* The phase stripe. Full-bleed down the card's left edge, so scanning
                                a column of days you read the run of the booking — amber setup,
                                indigo ceremonies, rose dismantle — before any text. */}
                            <div aria-hidden="true" style={{width:4,flexShrink:0,background:acc.stripe}} />
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              {/* ── DAY HEADER ──
                                  One row, four fixed slots: mark, identity, money, chevron. The
                                  money stays hard right at every width because the identity column
                                  is the only one allowed to grow (minWidth:0 lets it shrink rather
                                  than shove the total off the card). */}
                              <div onClick={toggleOpen} className="dcm-hd" style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:isOpen?`1px solid ${HAIRLINE}`:"none"}}>
                                <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:acc.tile}}>{phaseEmoji(d.phase)}</span>
                                <div style={{flex:"1 1 auto",minWidth:0}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                    <span style={{fontSize:14.5,fontWeight:700,color:INK,letterSpacing:-0.25,...NUM}}>{fmtDateShort(d.date)}</span>
                                    <span style={{fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 8px",borderRadius:999,background:acc.tile,color:acc.ink,whiteSpace:"nowrap"}}>{phaseLabel(d.phase)}</span>
                                  </div>
                                  <div style={{fontSize:11.5,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                    {dayTypes.length > 0
                                      ? `${dayTypes.length} trade${dayTypes.length===1?"":"s"} · ${dayHeads} on site`
                                      : "No crew this day"}
                                    {fnsOnDay.length > 0 && ` · ${fnsOnDay.map(fn => `${fn.fnType||"?"}${fn.fnShift?` (${fn.fnShift})`:""}`).join(" · ")}`}
                                  </div>
                                </div>
                                <div style={{textAlign:"right",flexShrink:0}}>
                                  <div style={{fontSize:16,fontWeight:750,color:breakdown.total>0?INK:INK_3,letterSpacing:-0.35,...NUM}}>
                                    {breakdown.total > 0 ? `₹${Math.round(breakdown.total).toLocaleString("en-IN")}` : "—"}
                                  </div>
                                  {daySlots > 0 && <div style={{fontSize:11,color:INK_3,marginTop:2,...NUM}}>{daySlots} dihari</div>}
                                </div>
                                <span aria-hidden="true" style={{fontSize:11,color:INK_3,flexShrink:0,display:"inline-block",transform:isOpen?"rotate(90deg)":"none",transition:"transform 0.16s ease"}}>▸</span>
                              </div>
                            {/* ── TRADES, FOUR TO A ROW ──
                                Eight full-width rows made a day card a page of its own: 27 people
                                across 8 trades read as a list you scroll rather than a crew you
                                take in. Four to a row fits a whole day's trades in two lines.
                                Grid, not flex-wrap — with flex, a trailing card that is alone on
                                its line grows to fill it, so a day with 5 trades would show one
                                double-width card. Grid columns hold their width whatever the count.
                                overflowX:auto because the day card clips (overflow:hidden is what
                                keeps the phase stripe inside the 14px radius), and a truncated
                                derivation table is worse than no table — it looks complete. */}
                            {isOpen && <div className="dcm-grid" style={{padding:"12px 15px 14px",overflowX:"auto"}}>
                              {labourTypes.map(t => {
                                const ppl = countByDay[d.date][t] || 0;
                                if (ppl <= 0) return null;
                                const scheme = dihariSchemes[t] || { rate:0, windows:[] };
                                const wins = scheme.windows || [];
                                const ticked = getWindowsForDayType(d.date, t, d.phase);
                                const dihari = ticked.length;
                                const effRate = rateByType[t] || 0;
                                const src = rateSourceByType[t] || { kind:"house_default", count:0 };
                                const slots = ticked.reduce((s, id) => s + winCountFor(d.date, t, id, ppl), 0); // Σ per-shift crew
                                const uniform = ticked.every(id => winCountFor(d.date, t, id, ppl) === ppl);
                                const cost = slots * effRate;
                                // ── DERIVED, OR OVERRULED BY HAND ──
                                // A stored shift pick (dcMpOverrides["<date>|<type>"]) or a stored
                                // per-shift head count (dcMpWinCount[type][date][winId]) WINS over
                                // today's derivation — winCountFor returns a stored value whenever
                                // one is present. So a count typed weeks ago silently outranks a
                                // rebuilt element list or a changed recipe, and until now no row
                                // said which of the eight that applied to. These are exactly the
                                // rows "Reset to derived" in the head would clear.
                                const shiftPinned = !!dcMpOverrides?.[`${d.date}|${t}`];
                                const countPinned = Object.keys(dcMpWinCount?.[t]?.[d.date] || {}).length > 0;
                                const pinned = shiftPinned || countPinned;
                                // The derivation opens in a dialog (CalcModal) rather than inside
                                // the card, so the card keeps its column and the grid keeps its
                                // shape whether the breakdown is open or not.
                                const calcOpen = !!dcMpCalcOpen[`${d.date}|${t}`];
                                return (
                                  <div key={t} className="dcm-row" style={{display:"flex",flexDirection:"column",gap:11,padding:"14px 15px",borderRadius:13,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,minWidth:0}}>
                                    {/* ── MARK, IDENTITY, STATUS ──
                                        The emoji used to sit inline in front of the name at label
                                        size, so eight rows of glyphs ran into eight rows of text.
                                        In a tinted 34px tile it becomes the thing you find the card
                                        BY. flexShrink:0 so a long trade name can never squash it
                                        out of round now that the column is narrow — and the name
                                        itself ellipsises rather than wrapping the card taller than
                                        its three neighbours. */}
                                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                                      <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:34,height:34,borderRadius:10,flexShrink:0,fontSize:16,lineHeight:1,background:`rgba(${typeTint(t)},0.17)`,border:`1px solid rgba(${typeTint(t)},0.28)`}}>{typeEmoji(t)}</span>
                                      <div style={{flex:"1 1 auto",minWidth:0}}>
                                        <div title={t} style={{fontSize:13,color:INK,fontWeight:650,letterSpacing:-0.1,lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t}</div>
                                        {/* The rate source was a filled chip in a fourth colour.
                                            It is a footnote about where a number came from, not a
                                            state — so it reads as a footnote now: same quiet ink as
                                            the rate it annotates, separated by a middot, with the
                                            explanation on hover. The emoji went with it; at 9.5px
                                            it was a smudge, not an icon. */}
                                        <div title={pinned ? "Set by hand — will not follow changes to the build." : "Derived from the build, the recipe and the rate card — recalculates whenever they change."}
                                          style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginTop:3,cursor:"help"}}>
                                          <span style={{fontSize:11,color:INK_3,...NUM}}>{ppl} ppl @ ₹{effRate}/dihari</span>
                                          {src.kind === "vendor_avg" ? (
                                            <span title={`Avg of: ${(src.vendors||[]).join(", ")}`} style={{fontSize:10,color:INK_3,whiteSpace:"nowrap",cursor:"help"}}>· avg of {src.count} vendor{src.count===1?"":"s"}</span>
                                          ) : (
                                            <span style={{fontSize:10,color:INK_3,whiteSpace:"nowrap"}}>· house rate</span>
                                          )}
                                        </div>
                                      </div>
                                      {/* ── ONLY THE EXCEPTION GETS A BADGE ──
                                          "DERIVED" sat on almost every card, in green, at the top
                                          right — the most valuable corner on the card spent on the
                                          normal case. A badge that is always there marks nothing;
                                          it just adds a third accent competing with the money.
                                          Now silence means derived, and the badge appears only for
                                          a figure someone set by hand — which is the one thing on
                                          this card worth interrupting for, since it will NOT follow
                                          the build. Derived cards keep the tooltip on the meta line
                                          below, so the explanation is not lost with the badge. */}
                                      {pinned && (
                                        <span title="Head count or shift pick was set by hand and is stored with the deal — it will NOT follow changes to the build. 'Reset to derived' clears it."
                                          style={{flexShrink:0,display:"inline-flex",alignItems:"center",gap:5,fontSize:9,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 8px",borderRadius:999,whiteSpace:"nowrap",cursor:"help",marginTop:2,background:GOLD_SOFT,color:GOLD,border:`1px solid ${GOLD}33`}}>
                                          <span aria-hidden="true" style={{width:4,height:4,borderRadius:"50%",background:GOLD,display:"inline-block"}} />
                                          adjusted
                                        </span>
                                      )}
                                    </div>
                                    {/* ── THE MONEY ──
                                        The amount is the big thing and the arithmetic is its
                                        caption. It used to be a sentence ("3 dihari × 8 = ₹10,800")
                                        set in green, which buried the figure mid-phrase at a
                                        different x on every row. Green is gone too: it was on every
                                        priced row, so it marked nothing — a cost is not a success. */}
                                    <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                                      <span style={{fontSize:21,fontWeight:700,color:cost>0?INK:INK_3,letterSpacing:-0.7,lineHeight:1.05,...NUM}}>
                                        {cost > 0 ? `₹${Math.round(cost).toLocaleString("en-IN")}` : "—"}
                                      </span>
                                      <span style={{fontSize:10,color:INK_3,whiteSpace:"nowrap",letterSpacing:0.5,textTransform:"uppercase",fontWeight:600,...NUM}}>
                                        {cost > 0 ? (uniform ? `${dihari} dihari × ${ppl}` : `${slots} crew-shifts`) : "0 dihari"}
                                      </span>
                                    </div>
                                    {/* marginTop:auto pins the shift controls to the foot of the
                                        card. Grid rows stretch every card to the tallest in the
                                        row, so without this a trade with one shift leaves its
                                        pills stranded mid-card while its neighbour's sit low — the
                                        controls would land at a different height in each column. */}
                                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:"auto",paddingTop:2}}>
                                      {wins.map(w => {
                                        const on = ticked.includes(w.id);
                                        // ── OFF SHIFT ──
                                        // A shift not being used is the quietest thing on the card.
                                        // It was already a ghost button; it stays one, just on the
                                        // warm hairline so it recedes into the tile instead of
                                        // ruling a cool grey line across it.
                                        if (!on) return (
                                          <button key={w.id} onClick={isAdmin?(()=>toggleWindow(d.date, t, w.id, d.phase)):undefined}
                                            title={isAdmin?"Add this shift":undefined}
                                            className={isAdmin?"dcm-ghost":undefined}
                                            style={{ fontSize:11.5,padding:"3px 9px",borderRadius:999,cursor:isAdmin?"pointer":"default",border:`1px solid ${TILE_BORDER}`,background:"transparent",color:INK_3,fontWeight:500 }}>
                                            {w.label}
                                          </button>
                                        );
                                        // ── ON SHIFT ──
                                        // This was a saturated green capsule with green +/− controls,
                                        // and there are up to four of them per card. Eight cards of
                                        // that made green the loudest thing on the screen — louder
                                        // than every amount — for a state that is simply the norm.
                                        // Now the chosen shift reads as SELECTED the way a chip
                                        // does: solid surface, full-strength ink, a hairline. The
                                        // only colour is the gold tick, and the crew number is the
                                        // one figure allowed weight, because that is what people
                                        // actually change. Label toggle + per-shift stepper (− N +),
                                        // default = the day count.
                                        const wc = winCountFor(d.date, t, w.id, ppl);
                                        return (
                                          <span key={w.id} style={{display:"inline-flex",alignItems:"center",border:`1px solid ${CARD_BORDER}`,borderRadius:999,overflow:"hidden",background:CARD_BG,boxShadow:"0 1px 1px rgba(36,30,53,0.03)"}}>
                                            <button onClick={isAdmin?(()=>toggleWindow(d.date, t, w.id, d.phase)):undefined} title={isAdmin?"Remove this shift":undefined} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11.5,padding:"3px 7px 3px 9px",cursor:isAdmin?"pointer":"default",border:"none",background:"transparent",color:INK,fontWeight:600}}>
                                              <span aria-hidden="true" style={{color:GOLD,fontSize:10}}>✓</span>{w.label}
                                            </button>
                                            {isAdmin && <button onClick={()=>setWinCount(d.date, t, w.id, Math.max(0, wc-1))} title="One fewer this shift" style={{fontSize:13,width:19,cursor:"pointer",border:"none",borderLeft:`1px solid ${HAIRLINE}`,background:"transparent",color:INK_3,fontWeight:600,lineHeight:1.6}}>−</button>}
                                            <span title="Crew in this shift" style={{fontSize:11.5,minWidth:15,textAlign:"center",color:INK,fontWeight:700,...NUM}}>{wc}</span>
                                            {isAdmin && <button onClick={()=>setWinCount(d.date, t, w.id, wc+1)} title="One more this shift" style={{fontSize:13,width:19,cursor:"pointer",border:"none",borderRight:"none",borderLeft:`1px solid ${HAIRLINE}`,background:"transparent",color:INK_3,fontWeight:600,lineHeight:1.6}}>+</button>}
                                          </span>
                                        );
                                      })}
                                      {wins.length === 0 && <span style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No windows defined for this type</span>}
                                      {/* Opens the derivation dialog. No open/closed styling and no
                                          "× hide" label any more: the dialog's backdrop covers this
                                          button while it is up, so a pressed state nobody can see
                                          and a close affordance nobody can reach were both dead. */}
                                      <button onClick={()=>toggleCalcOpen(d.date, t)}
                                        title={`Show how ${ppl} ${t.toLowerCase()} was derived`}
                                        className="dcm-ghost"
                                        style={{
                                          marginLeft:"auto",fontSize:11.5,padding:"3px 9px",borderRadius:999,cursor:"pointer",
                                          border:`1px solid ${TILE_BORDER}`,background:"transparent",
                                          color:INK_3,fontWeight:600,whiteSpace:"nowrap"
                                        }}>
                                        🧮 how
                                      </button>
                                    </div>
                                    {/* Calculation breakdown — opens as a dialog so the tables get
                                        real width instead of a quarter of a card. */}
                                    {calcOpen && (
                                      <CalcModal
                                        title={`${typeEmoji(t)} ${t}`}
                                        subtitle={`${fmtDateShort(d.date)} · ${phaseLabel(d.phase)} · ${ppl} ppl @ ₹${effRate}/dihari${cost > 0 ? ` · ₹${Math.round(cost).toLocaleString("en-IN")}` : ""}`}
                                        onClose={() => toggleCalcOpen(d.date, t)}
                                      >
                                    {(() => {
                                      // For event days: trace each fn on this day. For other phases: explain carry-over.
                                      if (d.phase === "event" && d.fns.length > 0) {
                                        return (
                                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                                            {d.fns.map((cfn, cfi) => {
                                              const trace = traceForType(cfn, t);
                                              return (
                                                <div key={cfi} style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                                  <div style={{fontSize:11,color:"#7C3AED",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>
                                                    How {trace.total||0} {t.toLowerCase()} derived{d.fns.length > 1 ? ` · ${cfn.fnType || "fn "+(cfi+1)}` : ""}
                                                  </div>
                                                  {/* Element table (Flowerists/Electricians) */}
                                                  {trace.kind === "element_table" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No matching elements in this function.</div>
                                                    ) : (
                                                      <>
                                                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                                                          <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                            {trace.header.map((h,hi) => (
                                                              <th key={hi} style={{textAlign:hi===0?"left":"right",padding:"4px 4px 6px",color:"#1A1A2E",fontWeight:500}}>{h}</th>
                                                            ))}
                                                          </tr></thead>
                                                          <tbody>
                                                            {trace.items.map((it, ii) => (
                                                              <tr key={ii}>
                                                                <td style={{padding:"5px 4px",color:"#1A1A2E"}}>{it.name}{it.size?<span style={{color:"#1A1A2E",marginLeft:4,textTransform:"capitalize"}}>({it.size})</span>:null}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{it.qty}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{it.missing?"⚠ "+it.missing:"÷ "+it.productivity}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:it.missing?"#F59E0B":"#000",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{it.missing?"—":it.need}</td>
                                                              </tr>
                                                            ))}
                                                            <tr style={{borderTop:`1px solid ${border}`}}>
                                                              <td colSpan={3} style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E"}}>Sum:</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:GOLD,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{trace.total}</td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </>
                                                    )
                                                  )}
                                                  {/* Situational-multiplier pills (Tier 3 Labours only — venue-min floor side of the max()) */}
                                                  {trace.situational && (
                                                    <div style={{marginBottom:8}}>
                                                      {/* NOT dark any more. This shared component carries two
                                                          palettes and its own note says why: "Studio's Deal Check
                                                          is a dark-themed panel … flips the palette so pills don't
                                                          render as light boxes on a black background."
                                                          Deal Check is not that panel any more — it is a light
                                                          glass page now — so the dark palette was painting
                                                          text-gray-300 and bg-white/5 onto a near-white ground and
                                                          the whole breakdown came out washed to nothing.
                                                          The prop was right when it was written; the page changed
                                                          underneath it. */}
                                                      <ManpowerFactorPills mode="tier3" trace={trace.situational} qty={trace.total} label="Labours" />
                                                    </div>
                                                  )}
                                                  {/* Sub-cat table (Carpenters/Painters Tier 2) */}
                                                  {trace.kind === "subcat_table" && (
                                                    trace.rows.length === 0 ? (
                                                      <div style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No matching sub-cats; using minimum ({trace.minimum}).</div>
                                                    ) : (
                                                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                                                        <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                          {trace.header.map((h,hi) => (
                                                            <th key={hi} style={{textAlign:hi===0?"left":"right",padding:"4px 4px 6px",color:"#1A1A2E",fontWeight:500}}>{h}</th>
                                                          ))}
                                                        </tr></thead>
                                                        <tbody>
                                                          {trace.rows.map((r, ri) => (
                                                            <tr key={ri}>
                                                              <td style={{padding:"5px 4px",color:"#1A1A2E"}}>{r.sub}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{r.count}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>÷ {r.batch}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{r.need}</td>
                                                            </tr>
                                                          ))}
                                                          <tr style={{borderTop:`1px solid ${border}`}}>
                                                            <td colSpan={3} style={{textAlign:"right",padding:"5px 4px",color:"#1A1A2E"}}>Σ {trace.frac} → ⌈⌉ {trace.sum} · max(min {trace.minimum}):</td>
                                                            <td style={{textAlign:"right",padding:"5px 4px",color:GOLD,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{trace.total}</td>
                                                          </tr>
                                                        </tbody>
                                                      </table>
                                                    )
                                                  )}
                                                  {/* Formula chain (Tier 3 Labours) */}
                                                  {trace.kind === "formula_chain" && (
                                                    <div style={{display:"flex",flexDirection:"column",gap:5,fontSize:13}}>
                                                      {trace.steps.map((s, si) => (
                                                        <div key={si} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                                                          <span style={{color:"#1A1A2E"}}>{s.label}</span>
                                                          <span style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums",fontWeight:si===trace.steps.length-1?500:400}}>{s.value}</span>
                                                        </div>
                                                      ))}
                                                      <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                        <span style={{color:GOLD}}>Total</span>
                                                        <span style={{color:GOLD,fontVariantNumeric:"tabular-nums"}}>{trace.total}</span>
                                                      </div>
                                                    </div>
                                                  )}
                                                  {/* Range lookup (Fabric Bangali / Truss Labour) */}
                                                  {trace.kind === "range_lookup" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No {trace.totalUnit==="sqft"?"fabric/wall masking":"pillar/truss"} elements in this function.</div>
                                                    ) : (
                                                      <div style={{display:"flex",flexDirection:"column",gap:5,fontSize:13}}>
                                                        {trace.items.map((it, ii) => (
                                                          <div key={ii} style={{display:"flex",justifyContent:"space-between"}}>
                                                            <span style={{color:"#1A1A2E"}}>{it.name}{it.L?` (${it.L}×${it.W} ft)`:""}</span>
                                                            <span style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>{it.sqft||it.qty} {trace.totalUnit==="sqft"?"sqft":""}</span>
                                                          </div>
                                                        ))}
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:5,borderTop:`1px solid ${border}`}}>
                                                          <span style={{color:"#1A1A2E"}}>Total {trace.totalUnit}</span>
                                                          <span style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums",fontWeight:500}}>{trace.totalAmount} {trace.totalUnit}</span>
                                                        </div>
                                                        <div style={{display:"flex",justifyContent:"space-between"}}>
                                                          <span style={{color:"#1A1A2E"}}>Range lookup · "{trace.rangeLabel}"</span>
                                                          <span style={{color:"#1A1A2E",fontVariantNumeric:"tabular-nums"}}>→ {trace.total} ppl</span>
                                                        </div>
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                          <span style={{color:GOLD}}>Total</span>
                                                          <span style={{color:GOLD,fontVariantNumeric:"tabular-nums"}}>{trace.total}</span>
                                                        </div>
                                                      </div>
                                                    )
                                                  )}
                                                  {/* Per-zone Fabric Bangali (§23 Phase 2.8) — each zone shows its own RFT ceil */}
                                                  {trace.kind === "range_lookup_per_zone" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>No truss masking found in this function (no zone with mkOn + walls selected).</div>
                                                    ) : (
                                                      <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:13}}>
                                                        {trace.items.map((zone, zi) => (
                                                          <div key={zi} style={{padding:"6px 8px",background:"rgba(26, 26, 46,0.04)",borderRadius:6,border:`1px solid ${border}`}}>
                                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                                                              <span style={{color:"#1A1A2E",fontWeight:600}}>{zone.zoneHeader}</span>
                                                              <span style={{color:GOLD,fontVariantNumeric:"tabular-nums",fontWeight:600}}>→ {zone.zoneTotal} ppl</span>
                                                            </div>
                                                            <div style={{display:"flex",flexDirection:"column",gap:2,paddingLeft:8}}>
                                                              {zone.parts.map((p, pi) => (
                                                                <div key={pi} style={{fontSize:12,color:"#1A1A2E"}}>• {p.label}</div>
                                                              ))}
                                                            </div>
                                                            {zone.zoneSubLabel && (
                                                              <div style={{marginTop:4,paddingTop:4,borderTop:`1px dashed ${border}`,fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>{zone.zoneSubLabel}</div>
                                                            )}
                                                          </div>
                                                        ))}
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                          <span style={{color:GOLD}}>Grand Total</span>
                                                          <span style={{color:GOLD,fontVariantNumeric:"tabular-nums"}}>{trace.total} ppl</span>
                                                        </div>
                                                      </div>
                                                    )
                                                  )}
                                                  {/* Default (Supervisors etc.) */}
                                                  {trace.kind === "default" && (
                                                    <div style={{fontSize:13,color:"#1A1A2E",fontStyle:"italic"}}>{trace.note}</div>
                                                  )}
                                                  {trace.formula && (
                                                    <div style={{marginTop:8,paddingTop:6,borderTop:`1px dashed ${border}`,fontSize:12,color:"#1A1A2E",fontStyle:"italic"}}>{trace.formula}</div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      }
                                      // Non-event day (minusOne / gap / dismantle) — explain carry-over
                                      const ppl = countByDay[d.date][t] || 0;
                                      const dismPct = (labourTiers[t]||{}).dismantlingPct;
                                      const phaseNote = d.phase === "minusOne"
                                        ? "Setup day: hired in advance, count = MAX across upcoming ceremonies."
                                        : d.phase === "gap"
                                          ? "Gap day: count carried forward from previous day (no new hires)."
                                          : typeof dismPct === "number"
                                            ? `Dismantle day: ${dismPct}% of event-day crew. Event peak × ${dismPct}% = ${ppl} ${t.toLowerCase()}.`
                                            : "Dismantle day: count carried forward from final event day (no dismantling % set in Settings → Workforce).";
                                      return (
                                        <div style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7,fontSize:13,color:"#1A1A2E"}}>
                                          <div style={{fontSize:11,color:"#7C3AED",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:6}}>How {ppl} {t.toLowerCase()} on this day</div>
                                          <div style={{color:"#1A1A2E",fontStyle:"italic"}}>{phaseNote}</div>
                                          <div style={{marginTop:6}}>See trajectory footer for cumulative MAX progression.</div>
                                        </div>
                                      );
                                    })()}
                                      </CalcModal>
                                    )}
                                  </div>
                                );
                              })}
                              {Object.keys(breakdown.byType).length === 0 && (
                                <div style={{fontSize:12.5,color:INK_3,fontStyle:"italic",padding:"2px 0"}}>No manpower needed this day. (Untick all windows to model labour going home.)</div>
                              )}
                            </div>}
                            </div>
                          </div>
                        );
                      })}

                      {/* ── SUMMARY BAR ──
                          Where the booking total lives now. It sits under the day cards rather
                          than over them so the figure and the days it sums are on screen at the
                          same time, and it is four figures rather than one because the total on
                          its own does not tell you whether it is large for the right reason: a
                          five-day booking at ₹40k and a one-day booking at ₹40k are different
                          problems. Every value comes off the same dayCosts/countByDay the cards
                          above are drawn from, so the bar cannot disagree with them. */}
                      {(() => {
                        const peakHeads = visibleDayList.reduce((m, d) =>
                          Math.max(m, labourTypes.reduce((n, t) => n + (countByDay[d.date]?.[t] || 0), 0)), 0);
                        const perDay = visibleDayList.length ? visibleTotalCost / visibleDayList.length : 0;
                        return (
                          <div className="dcm-sum">
                            <StatTile
                              label={dcShowAllFns ? "Days counted" : "Days for this fn"}
                              value={visibleDayList.length}
                              foot={`of ${dayList.length} in booking`}
                            />
                            <StatTile
                              label="Peak on site"
                              value={peakHeads}
                              foot="most people on any one day"
                            />
                            <StatTile
                              label="Dihari"
                              value={visibleTotalDihari}
                              foot="crew × shifts billed"
                            />
                            <StatTile
                              label="Manpower total"
                              value={`₹${Math.round(visibleTotalCost).toLocaleString("en-IN")}`}
                              foot={visibleDayList.length ? `≈ ₹${Math.round(perDay).toLocaleString("en-IN")} / day` : null}
                              tone={GOLD}
                            />
                          </div>
                        );
                      })()}

                      {/* Hire trajectory footer */}
                      <div className="dcm-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,padding:"14px 16px"}}>
                        {/* Section eyebrow and its standfirst. Both were INK_3 — the label AND the
                            sentence explaining it set in the palette's quietest ink, which made an
                            entire section header disappear. The eyebrow now carries INK_2 at the
                            shared eyebrow scale, and the sentence under it is body copy at INK_2:
                            it is the only place the cumulative-MAX rule is actually explained, so
                            it is not a caption. */}
                        <div style={{fontSize:10,fontWeight:700,color:INK_2,letterSpacing:1,textTransform:"uppercase",marginBottom:5}}>📈 Hire trajectory · cumulative MAX</div>
                        <div style={{fontSize:12,lineHeight:1.5,color:INK_2,marginBottom:12,maxWidth:"68ch"}}>People hired per trade across booking days. Labour only scales UP — once hired, they stay.</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {labourTypes.map(t => {
                            const seq = dayList.map(d => countByDay[d.date][t] || 0);
                            const peak = Math.max(...seq, 0);
                            if (peak === 0) return null;
                            return (
                              <div key={t} className="dcm-row" style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:9,background:TILE_BG,border:`1px solid ${CARD_BORDER}`}}>
                                <span aria-hidden="true" style={{fontSize:13,flexShrink:0}}>{typeEmoji(t)}</span>
                                <span style={{flex:"0 0 auto",minWidth:126,fontSize:12.5,color:INK,fontWeight:650,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t}</span>
                                {/* The progression is the point of this footer, so the numbers are
                                    set as data — one glyph width each — and the day a trade steps
                                    up is visible as a change in the run rather than read out. */}
                                <span style={{flex:"1 1 auto",minWidth:0,fontSize:12,color:INK_2,fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",overflowX:"auto",whiteSpace:"nowrap",...NUM}}>{seq.join(" → ")}</span>
                                <span style={{flexShrink:0,fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:999,background:GOLD_SOFT,color:GOLD,border:`1px solid ${GOLD}22`,whiteSpace:"nowrap",...NUM}}>peak {peak}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
  })();
}

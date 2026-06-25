// Pure pricing / truss / fabric / carpet / platform engine (faithful to the
// reference Studio app). VERBATIM copies of the module-scope functions — only
// `export` added (plus cross-file imports). NO React, NO component state.
//
// resolveMandiFlower already lives in the shared IMS flower helpers — import +
// re-export it here so callers can use it from the studio pricing namespace.
import { resolveMandiFlower } from "../ims/flowerHelpers.js";
export { resolveMandiFlower };

// ═══ AREAS ↔ ZONES SYNC HELPERS ═══
export const AZ_SYNC_SK = "ambria-areas-zones-synced-v1";
// Normalize a label/name for fuzzy matching. "Entry Passage" ≈ "Entry & Passage" both → "entrypassage".
export const normAZ = (s) => (s == null ? "" : String(s)).toLowerCase().replace(/[^a-z0-9]/g, "");
// Find an existing zone that corresponds to an area tag (matches by ID or label).
export const findZoneForArea = (areaName, zoneMeta) => {
  const n = normAZ(areaName); if (!n) return null;
  for (const [zid, zm] of Object.entries(zoneMeta || {})) {
    if (normAZ(zid) === n || normAZ(zm?.label) === n) return zid;
  }
  return null;
};
// Find an existing area tag that corresponds to a zone (matches by ID or label).
export const findAreaForZone = (zid, zm, areasArr) => {
  const zn = normAZ(zid), ln = normAZ(zm?.label);
  return (areasArr || []).find(a => { const an = normAZ(a); return an === zn || an === ln; }) || null;
};
// Generate a unique, URL-safe zone ID from a label. Avoids collisions with existing zones.
export const makeZoneId = (label, existingMeta) => {
  let base = normAZ(label).slice(0, 24) || "zone";
  if (!existingMeta || !existingMeta[base]) return base;
  let i = 2; while (existingMeta[`${base}_${i}`]) i++; return `${base}_${i}`;
};
// Default config for a zone auto-created from an area tag (no structural features).
export const defaultZoneFromArea = (label) => ({
  label: label || "New Zone",
  dimFields: [],
  defaultTruss: null,
  hasPlatform: false,
  hasCarpet: false,
  hasMasking: false,
  icon: "🏷️",
});

// ─── §23 Layer 0 — Truss Config Resolver (Studio side, deterministic) ────────
// Input:  zoneConfig entry { dims:{L,W,H}, trussType?: "u_only"|"half_box"|"full_box"|null }
// Output: { config, source, error?, spanFt?, warning? }
//   config:  "u_only" | "half_box" | "full_box" | null
//   source:  "none" | "invalid" | "auto-3dim" | "sales-pick" | "default-on-forget"
//   error:   set when source === "invalid" — blocks save
//   spanFt:  the floor dim that becomes the beam length (2-dim case only)
//   warning: true when source === "default-on-forget" (Deal Check shows banner)
// Reference: SPEC_MASTER §23.4 + §23.7 Layer 0 pseudo-code.
export const resolveTrussConfig = (zc) => {
  if (!zc) return { config: null, source: "none" };
  const dims = zc.dims || {};
  // Treat 0 / null / undefined / "" as "blank"
  const isFilled = (v) => (typeof v === "number" ? v > 0 : (v != null && String(v).trim() !== "" && parseFloat(v) > 0));
  const L = parseFloat(dims.L) || 0;
  const W = parseFloat(dims.W) || 0;
  const H = parseFloat(dims.H) || 0;
  const hasL = isFilled(dims.L);
  const hasW = isFilled(dims.W);
  const hasH = isFilled(dims.H);

  // CASE 1 — All blank → no truss in zone (silent)
  if (!hasL && !hasW && !hasH) return { config: null, source: "none" };

  // CASE 2 — Height missing but L or W filled → validation error
  if (!hasH && (hasL || hasW)) {
    return { config: null, source: "invalid", error: "Truss Height is required" };
  }

  // CASE 3 — Only Height filled (no L or W) → validation error
  if (hasH && !hasL && !hasW) {
    return { config: null, source: "invalid", error: "Need Length or Width along with Height" };
  }

  // CASE 4 — All 3 filled → auto Full Box
  if (hasH && hasL && hasW) {
    return { config: "full_box", source: "auto-3dim" };
  }

  // CASE 5 — 2-dim truss (H + exactly one of L/W)
  const spanFt = hasL ? L : W;
  if (zc.trussType === "u_only" || zc.trussType === "half_box") {
    return { config: zc.trussType, source: "sales-pick", spanFt };
  }
  // Sales forgot to pick → default to half_box (engineering setting default)
  return { config: "half_box", source: "default-on-forget", spanFt, warning: true };
};

// ─── §23 Layer 1 — Topology Calculator (Studio side, deterministic) ──────────
// Input:  config + L/W/H + spanFt + optional backDepth + engineering settings
// Output: { pillars[], beams[], method, physicalL, physicalW, joints }
// Each pillar: { id, H }
// Each beam:   { side, lengthFt }
// Reference: SPEC_MASTER §23.7 Layer 1 + §23.4 (Method A vs B).
export const buildTopology = (config, L, W, H, spanFt, backDepth, engSettings) => {
  if (!config || !H || H <= 0) return null;
  const eng = engSettings || {};
  const maxSpan = eng.maxSpanFt || 30;
  const pillarWidth = eng.pillarWidthFt || 0.75;        // physical width (for maskingL etc.)
  const pillarBudget = eng.pillarBudgetFt || 0.75;      // §23 Phase 5 — math budget per pillar = physical width
                                                         // Allocator absorbs fractional budgets via Math.floor + 1ft tolerance.
  const depth = backDepth || eng.defaultBackDepthFt || 4;

  // §23 Phase 5 (28 May 2026) — Smart allocator: beam_total = span − pillarCount (1ft per pillar).
  // Pillar physical = 0.75ft → 0.25ft slack per pillar = engineering buffer for joint plates.
  // pillarCountForSpan: 2 corners + N middle pillars when span > maxSpan
  const pillarCountForSpan = (spanLen) => 2 + Math.max(0, Math.ceil(spanLen / maxSpan) - 1);
  // Split total beam length into per-segment lengths (one per pillar-gap)
  const splitBeamSegments = (totalBeamLen, segments) => {
    if (segments <= 0 || totalBeamLen <= 0) return [];
    const segLen = totalBeamLen / segments;
    return Array.from({ length: segments }, () => segLen);
  };

  if (config === "u_only") {
    // Method A: inside-out — beam length total = spanFt − totalPillars (each 1ft budget).
    const method = "A";
    const totalPillars = pillarCountForSpan(spanFt);
    const beamTotalLen = Math.max(0, spanFt - totalPillars * pillarBudget);
    const segLengths = splitBeamSegments(beamTotalLen, totalPillars - 1);
    const pillars = Array.from({ length: totalPillars }, (_, i) => {
      const id = i === 0 ? "P-left" : i === totalPillars - 1 ? "P-right" : `P-mid${i}`;
      return { id, H };
    });
    const beams = segLengths.map((len, i) => ({ side: segLengths.length === 1 ? "top" : `top-${i+1}`, lengthFt: len }));
    return {
      config, method, pillars, beams,
      physicalL: spanFt,                                  // Method A: external matches demand (cost-side)
      physicalW: 0,                                       // 1-D: no depth
      // §23 Phase 2.9e — masking outer (always span + 2×pillarWidth regardless of Method A/B)
      maskingL: spanFt + 2 * pillarWidth,
      maskingW: 0,
      pillarCount: pillars.length,
      beamCount: beams.length,
    };
  }

  if (config === "half_box") {
    // Method A: inside-out — front beam total follows spanFt − totalFrontPillars; sides are full depth.
    const method = "A";
    const totalFrontPillars = pillarCountForSpan(spanFt);
    const beamTotalLen = Math.max(0, spanFt - totalFrontPillars * pillarBudget);
    const segLengths = splitBeamSegments(beamTotalLen, totalFrontPillars - 1);
    // Front pillars: 2 corners + middle. Back pillars: 2 corners only (depth too small for mid).
    const frontPillars = Array.from({ length: totalFrontPillars }, (_, i) => {
      const id = i === 0 ? "P-frontL" : i === totalFrontPillars - 1 ? "P-frontR" : `P-frontMid${i}`;
      return { id, H };
    });
    const backPillars = [{ id: "P-backL", H }, { id: "P-backR", H }];
    const pillars = [...frontPillars, ...backPillars];
    const frontBeams = segLengths.map((len, i) => ({ side: segLengths.length === 1 ? "front" : `front-${i+1}`, lengthFt: len }));
    const beams = [
      ...frontBeams,
      { side: "left",  lengthFt: depth },
      { side: "right", lengthFt: depth },
      // back: SKIPPED per §23.4 Half Box definition
    ];
    return {
      config, method, pillars, beams,
      physicalL: spanFt,
      physicalW: depth + 2 * pillarWidth,
      // §23 Phase 2.9e — masking outer: L adds +1.5 (Method A interior beam), W already includes it
      maskingL: spanFt + 2 * pillarWidth,
      maskingW: depth + 2 * pillarWidth,
      pillarCount: pillars.length,
      frontPillarCount: frontPillars.length, // curtains only on front pillars
      beamCount: beams.length,
    };
  }

  if (config === "full_box") {
    // Method B: outside-out — both L and W axes get mid-pillars. Corners are shared.
    // For Method B with the new formula: still subtract pillars on each axis (smart truss).
    const method = "B";
    const lAxisPillars = pillarCountForSpan(L);
    const wAxisPillars = pillarCountForSpan(W);
    const lMidCount = lAxisPillars - 2;
    const wMidCount = wAxisPillars - 2;
    const lBeamTotal = Math.max(0, L - lAxisPillars * pillarBudget);
    const wBeamTotal = Math.max(0, W - wAxisPillars * pillarBudget);
    const lSegLens = splitBeamSegments(lBeamTotal, lAxisPillars - 1);
    const wSegLens = splitBeamSegments(wBeamTotal, wAxisPillars - 1);
    const pillars = [
      { id: "P-NW", H }, { id: "P-NE", H },
      { id: "P-SW", H }, { id: "P-SE", H },
      ...Array.from({ length: lMidCount }, (_, i) => ({ id: `P-N-mid${i+1}`, H })),
      ...Array.from({ length: lMidCount }, (_, i) => ({ id: `P-S-mid${i+1}`, H })),
      ...Array.from({ length: wMidCount }, (_, i) => ({ id: `P-W-mid${i+1}`, H })),
      ...Array.from({ length: wMidCount }, (_, i) => ({ id: `P-E-mid${i+1}`, H })),
    ];
    const beams = [
      ...lSegLens.map((len, i) => ({ side: lSegLens.length === 1 ? "front" : `front-${i+1}`, lengthFt: len })),
      ...lSegLens.map((len, i) => ({ side: lSegLens.length === 1 ? "back" : `back-${i+1}`, lengthFt: len })),
      ...wSegLens.map((len, i) => ({ side: wSegLens.length === 1 ? "left" : `left-${i+1}`, lengthFt: len })),
      ...wSegLens.map((len, i) => ({ side: wSegLens.length === 1 ? "right" : `right-${i+1}`, lengthFt: len })),
    ];
    return {
      config, method, pillars, beams,
      physicalL: L + 2 * pillarWidth,
      physicalW: W + 2 * pillarWidth,
      // §23 Phase 2.9e — masking outer = physical (Method B already outside-out, no extra +1.5 needed)
      maskingL: L + 2 * pillarWidth,
      maskingW: W + 2 * pillarWidth,
      pillarCount: pillars.length,
      beamCount: beams.length,
    };
  }

  return null;
};

// ─── §23 Phase 2 — Per-Zone Truss Cost Preview ────────────────────────────────
// Runs Layer 0 + Layer 1, then computes rentals from IMS trussInv rates.
// Returns: { config, source, topology, costs, batta, smartFlag, warnings[] }
//   costs: { uEquivalent, boxEquivalent, actual, pillarCost, beamCost, battaCost }
//   batta: { rftRequired, rftWithBuffer, bufferPct }
//   smartFlag: "green" (auto-3dim, fits cleanly) | "yellow" (default-on-forget or half_box) | "red" (invalid)
// Inputs:
//   zc: zoneConfig entry { dims:{L,W,H}, trussType }
//   trussInv: { pillars, beams, rates: {pillarRftRate, beamRftRate, battaRftRate, lizaKgRate}, batta:{bufferPct}, settings }
export const calcZoneTrussPreview = (zc, trussInv) => {
  const layer0 = resolveTrussConfig(zc);
  if (!layer0) return null;
  const out = { ...layer0, topology: null, costs: null, batta: null, smartFlag: "green", warnings: [] };
  if (layer0.source === "none") return out;
  if (layer0.source === "invalid") { out.smartFlag = "red"; out.warnings.push(layer0.error); return out; }

  if (!trussInv) { out.warnings.push("IMS truss inventory not loaded — cost preview unavailable"); return out; }
  const eng = trussInv.settings || {};
  const rates = trussInv.rates || {};
  const bufferPct = trussInv.batta?.bufferPct ?? 10;

  const L = parseFloat(zc.dims?.L) || 0;
  const W = parseFloat(zc.dims?.W) || 0;
  const H = parseFloat(zc.dims?.H) || 0;
  const spanFt = layer0.spanFt || (layer0.source === "auto-3dim" ? Math.max(L, W) : 0);
  const backDepth = zc.trussBackDepth || eng.defaultBackDepthFt || 4;
  const topology = buildTopology(layer0.config, L, W, H, spanFt, backDepth, eng);
  if (!topology) { out.warnings.push("Topology failed — check dimensions"); return out; }
  out.topology = topology;

  // ── Cost math ────────────────────────────────────────────────────────────
  const pillarRftRate = rates.pillarRftRate || 0;
  const beamRftRate   = rates.beamRftRate   || 0;
  const battaRftRate  = rates.battaRftRate  || 0;

  // Per-config piece-RFT sums
  const sumPillarRft = (pillars) => pillars.reduce((s, p) => s + (p.H || 0), 0);
  const sumBeamRft   = (beams)   => beams.reduce((s, b) => s + (b.lengthFt || 0), 0);

  // ── ACTUAL config cost ─────────────────────────────
  const actualPillarRft = sumPillarRft(topology.pillars);
  const actualBeamRft   = sumBeamRft(topology.beams);
  const actualPillarCost = actualPillarRft * pillarRftRate;
  const actualBeamCost   = actualBeamRft   * beamRftRate;

  // ── BATTA — wraps every pillar + every beam ─────────
  const battaRftRaw      = actualPillarRft + actualBeamRft;
  const battaRftWithBuf  = battaRftRaw * (1 + bufferPct / 100);
  const battaCost        = battaRftWithBuf * battaRftRate;

  // ── U-EQUIVALENT (for cost comparison; same dims as actual config) ───
  // Topology if treated as U-only (2 pillars + 1 top beam, span = max(L,W) for 3-dim, else spanFt)
  const uSpan = layer0.config === "u_only" ? spanFt
              : layer0.config === "half_box" ? spanFt
              : Math.max(L, W);
  const uTopo = buildTopology("u_only", L, W, H, uSpan, backDepth, eng);
  const uPillarRft = uTopo ? sumPillarRft(uTopo.pillars) : 0;
  const uBeamRft   = uTopo ? sumBeamRft(uTopo.beams)   : 0;
  const uEquivalent = uPillarRft * pillarRftRate + uBeamRft * beamRftRate;

  // ── BOX-EQUIVALENT (full perimeter) ─────────────────
  // For 2-dim cases, use a conservative box: span x backDepth
  const boxL = (L > 0 ? L : spanFt);
  const boxW = (W > 0 ? W : (layer0.config === "half_box" ? backDepth : backDepth));
  const boxTopo = buildTopology("full_box", boxL, boxW, H, Math.max(boxL, boxW), backDepth, eng);
  const boxPillarRft = boxTopo ? sumPillarRft(boxTopo.pillars) : 0;
  const boxBeamRft   = boxTopo ? sumBeamRft(boxTopo.beams)   : 0;
  const boxEquivalent = boxPillarRft * pillarRftRate + boxBeamRft * beamRftRate;

  // ── ACTUAL by config (hybrid pricing for half_box per §23.4) ───
  let actualTrussOnly;
  if (layer0.config === "u_only")        actualTrussOnly = actualPillarCost + actualBeamCost;
  else if (layer0.config === "full_box") actualTrussOnly = actualPillarCost + actualBeamCost;
  else /* half_box */ {
    // Hybrid: actual structure cost, OR (U + Box) / 2 per spec for explainability
    if ((eng.hybridPricingMethod || "simple_avg") === "simple_avg") {
      actualTrussOnly = (uEquivalent + boxEquivalent) / 2;
    } else {
      actualTrussOnly = actualPillarCost + actualBeamCost;
    }
  }

  const totalActual = actualTrussOnly + battaCost;

  out.costs = {
    uEquivalent: Math.round(uEquivalent),
    boxEquivalent: Math.round(boxEquivalent),
    actual: Math.round(totalActual),
    pillarCost: Math.round(actualPillarCost),
    beamCost: Math.round(actualBeamCost),
    battaCost: Math.round(battaCost),
    pillarRft: actualPillarRft,
    beamRft: actualBeamRft,
  };
  out.batta = {
    rftRequired: Math.round(battaRftRaw),
    rftWithBuffer: Math.round(battaRftWithBuf),
    bufferPct,
  };

  // ── Smart flag ─────────────────────────────────────
  if (layer0.source === "default-on-forget") {
    out.smartFlag = "yellow";
    out.warnings.push("Truss type not picked — defaulted to Half Box");
  } else if (layer0.config === "half_box") {
    out.smartFlag = "yellow";
  } else {
    out.smartFlag = "green";
  }

  // Rate-missing warning
  if (pillarRftRate === 0 || beamRftRate === 0) {
    out.warnings.push("Pillar/beam rental rates not set in IMS — costs shown as ₹0");
  }

  return out;
};

//   Full Box → CEILING DRAPE MODEL: kg = ceiling area × fabricFactors.kgPerSqft[density]
//     Density comes from selected photo's library tag (libItem.dims.drapeDensity = "minimum|moderate|dense")
// Curtains: count = pillarCount × curtainsPerPillar (default 4)
// Returns: {maskingPieces, lizaKg, lizaModel, curtainPieces, physL, physW, pillarCount, density}
export const calcZoneFabric = (zc, trussInv, drapeDensity) => {
  const preview = calcZoneTrussPreview(zc, trussInv);
  if (!preview || !preview.topology) {
    return { maskingPieces: 0, lizaKg: 0, lizaModel: "none", curtainPieces: 0, physL: 0, physW: 0, pillarCount: 0, density: drapeDensity||"moderate" };
  }
  const topo = preview.topology;
  const mkWalls = zc.mkWalls || {};
  // Wall masking RFT — uses MASKING outer dims (always span/L + 2×pillarWidth regardless of Method A/B).
  // Different from physicalL/W which is Method-A-interior for cost calc. Masking wraps the
  // outside of the truss so the pillars are inside the masking envelope.
  const maskL = topo.maskingL ?? topo.physicalL ?? 0;
  const maskW = topo.maskingW ?? topo.physicalW ?? 0;
  let rft = 0;
  if (mkWalls.back  && maskL > 0) rft += maskL;
  if (mkWalls.left  && maskW > 0) rft += maskW;
  if (mkWalls.right && maskW > 0) rft += maskW;
  const maskingPieces = rft > 0 ? Math.ceil(rft / 13) : 0;

  // Liza kg — depends on truss config (Tarun lock 26 May):
  //   U Truss + Half Box → WRAP only (top is open, no ceiling drape)
  //   Full Box → WRAP + CEILING DRAPE (both summed). kgPerRftWrap factor is identical across
  //   all 3 truss types — density factor applies only to the ceiling component of Full Box.
  const factors = trussInv?.fabricFactors || { kgPerRftWrap:0.3, kgPerSqftDense:0.08, kgPerSqftModerate:0.05, kgPerSqftMinimum:0.03 };
  const config = preview.config;       // u_only | half_box | full_box
  let lizaKg = 0;
  let lizaWrapKg = 0;
  let lizaCeilingKg = 0;
  let lizaModel = "none";
  let density = drapeDensity || "moderate";
  if (config === "u_only" || config === "half_box" || config === "full_box") {
    // ── Wrap component (all 3 types) ──
    const pillarRft = (preview.costs?.pillarRft) || 0;
    const beamRft   = (preview.costs?.beamRft)   || 0;
    const wrapRft   = pillarRft + beamRft;
    lizaWrapKg = Math.ceil(wrapRft * (factors.kgPerRftWrap || 0.3) * 100) / 100;
    lizaModel = "wrap";
  }
  if (config === "full_box") {
    // ── Ceiling drape component (Full Box only) ──
    const area = (topo.physicalL > 0 ? topo.physicalL : 0) * (topo.physicalW > 0 ? topo.physicalW : 0);
    const dKey = density === "dense" ? "kgPerSqftDense" : density === "minimum" ? "kgPerSqftMinimum" : "kgPerSqftModerate";
    lizaCeilingKg = Math.ceil(area * (factors[dKey] || 0.05) * 100) / 100;
    lizaModel = "wrap+ceiling";
  }
  lizaKg = Math.round((lizaWrapKg + lizaCeilingKg) * 100) / 100;

  // Velvet curtains — one set per pillar (default 4 curtains per pillar; configurable later)
  // Half Box: curtains only on front pillars (back pillars are against wall)
  const curtainsPerPillar = zc.curtainsPerPillar || 4;
  const pillarCount = topo.pillarCount || (topo.pillars||[]).length || 0;
  const curtainPillarCount = topo.frontPillarCount || pillarCount;
  const curtainPieces = curtainPillarCount * curtainsPerPillar;
  // FRONT EXTENSION (box only, rare): each side is a Single-U wing = 1 beam (extLen) + 1 NEW outer
  // pillar at height extH. The box's front-corner pillar is SHARED, so we don't re-count it (the
  // "−1 pillar per side" rule). Adds liza wrap fabric + the 2 new pillars to material counts.
  const extLen = Number(zc.trussFrontExt) || 0;
  let extPillars = 0, extCurtains = 0, extMaskingPieces = 0;
  if (extLen > 0) {
    const extH = Number(zc.trussFrontExtH) || (zc.dims?.H) || 0;
    const extWrapRft = (2 * extLen) + (2 * extH); // 2 side beams + 2 new pillars (shared excluded)
    const extWrapKg = Math.ceil(extWrapRft * (factors.kgPerRftWrap || 0.3) * 100) / 100;
    lizaWrapKg = Math.round((lizaWrapKg + extWrapKg) * 100) / 100;
    lizaKg = Math.round((lizaKg + extWrapKg) * 100) / 100;
    extPillars = 2; // 1 new pillar per side
    // Curtains: each of the 2 new pillars gets a curtain set (shared pillars already counted).
    extCurtains = extPillars * curtainsPerPillar;
    // Wall masking: when masking is on, each wing gets a masked wall (extLen wide → 13ft panels).
    if (zc.mkOn) extMaskingPieces = 2 * Math.max(1, Math.ceil(extLen / 13));
  }
  // Multiple identical trusses in one zone → all physical counts (fabric pieces, liza, curtains,
  // pillars) scale by quantity. Per-truss dimensions (maskL/W, physL/W) stay as a single truss.
  const qty = Math.max(1, zc.trussQty || 1);
  return {
    maskingPieces: (maskingPieces + extMaskingPieces) * qty,
    maskL,             // §23 Phase 2.9e — outer footprint used for masking RFT
    maskW,
    lizaKg: Math.round(lizaKg * qty * 100) / 100,            // total (wrap + ceiling)
    lizaWrapKg: Math.round(lizaWrapKg * qty * 100) / 100,    // wrap component (always present for any truss)
    lizaCeilingKg: Math.round(lizaCeilingKg * qty * 100) / 100, // ceiling component (Full Box only, else 0)
    lizaModel,         // "none" | "wrap" | "wrap+ceiling"
    curtainPieces: (curtainPieces + extCurtains) * qty,
    curtainPillarCount: (curtainPillarCount + extPillars) * qty,
    physL: topo.physicalL,
    physW: topo.physicalW,
    pillarCount: (pillarCount + extPillars) * qty,
    density
  };
};

// Cost calc for a single fabric allocation (one colour) given stock split.
// Returns: {reusedQty, freshQty, reusedCost, freshCost, total, shortQty}
// Two owned grades per colour, stored on the SAME row: OLD stock in `qtyField` (e.g. stockKg) and NEW
// stock in `qtyField+"New"` (e.g. stockKgNew). Consumption order: owned OLD first (depreciating,
// cheaper) → owned NEW (premium rate) → buy fresh (purchase × markup). Backward-compatible: a missing
// New field counts as 0, and an absent rentalRateNew falls back to the OLD rental rate.
export const calcFabricAllocCost = (qty, colour, stockArray, qtyField, rentalRate, purchasePrice, freshMarkupPct, rentalRateNew) => {
  if (!qty || qty <= 0) return { reusedQty:0, reusedOldQty:0, reusedNewQty:0, freshQty:0, reusedCost:0, freshCost:0, total:0, shortQty:0 };
  const newField = qtyField + "New";
  const rows = (stockArray||[]).filter(s => s && s.colour === colour);
  const oldAvail = rows.reduce((s,r)=>s+(Number(r[qtyField])||0),0);
  const newAvail = rows.reduce((s,r)=>s+(Number(r[newField])||0),0);
  const oldRate = Number(rentalRate)||0;
  const newRate = (rentalRateNew === undefined || rentalRateNew === null || rentalRateNew === "") ? oldRate : (Number(rentalRateNew)||0);
  const reusedOldQty = Math.min(qty, oldAvail);
  let rem = qty - reusedOldQty;
  const reusedNewQty = Math.min(rem, newAvail);
  rem -= reusedNewQty;
  const freshQty = Math.max(0, rem);
  const reusedCost = reusedOldQty * oldRate + reusedNewQty * newRate;
  const freshCost  = freshQty  * (Number(purchasePrice)||0) * ((Number(freshMarkupPct)||0)/100);
  return {
    reusedQty: reusedOldQty + reusedNewQty,
    reusedOldQty,
    reusedNewQty,
    freshQty,
    reusedCost: Math.round(reusedCost),
    freshCost:  Math.round(freshCost),
    total: Math.round(reusedCost + freshCost),
    shortQty: freshQty
  };
};

// Cost rollup across all colours in an allocation array. Returns totals + per-colour breakdown.
export const calcFabricAllocationTotal = (allocation, stockArray, qtyField, rentalRate, purchasePrice, freshMarkupPct, rentalRateNew) => {
  const allocs = Array.isArray(allocation) ? allocation : [];
  let total = 0, reusedCost = 0, freshCost = 0, totalShort = 0, reusedOldQty = 0, reusedNewQty = 0;
  const perColour = allocs.map(a => {
    const c = calcFabricAllocCost(a.qty, a.colour, stockArray, qtyField, rentalRate, purchasePrice, freshMarkupPct, rentalRateNew);
    total      += c.total;
    reusedCost += c.reusedCost;
    freshCost  += c.freshCost;
    totalShort += c.shortQty;
    reusedOldQty += c.reusedOldQty || 0;
    reusedNewQty += c.reusedNewQty || 0;
    return { colour: a.colour, qty: a.qty, ...c };
  });
  return { total, reusedCost, freshCost, totalShort, reusedOldQty, reusedNewQty, perColour };
};

// §23 Phase 2.9f (26 May 2026) — Auto-fill fabric allocation from function palette + IMS stock.
// Strategy: fuzzy-match palette anchor colour names against IMS stock-array colours.
// If matches found → pick the highest-stock matched colour, allocate full qty to it.
// If no fuzzy match → fall back to highest-stock colour overall (largest pool).
// Returns: [{qty, colour}] allocation array, or [] if no stock at all.
export const fuzzyColourMatch = (anchorName, stockColourName) => {
  if (!anchorName || !stockColourName) return false;
  const a = String(anchorName).toLowerCase().trim();
  const b = String(stockColourName).toLowerCase().trim();
  if (a === b) return true;
  // substring either direction (handles "Mocha" vs "Mocha Brown")
  if (a.includes(b) || b.includes(a)) return true;
  return false;
};
export const autoFillFabricAllocation = (totalQty, paletteAnchors, stockArray, qtyField) => {
  if (!totalQty || totalQty <= 0) return [];
  const stocks = Array.isArray(stockArray) ? stockArray.filter(s => s && s.colour) : [];
  if (stocks.length === 0) return []; // No colours configured at all
  const anchors = Array.isArray(paletteAnchors) ? paletteAnchors : [];
  // 1. Try anchors: for each anchor, find IMS colours fuzzy-matching it; pick highest-stock match across all anchors.
  let bestAnchorMatch = null;
  for (const a of anchors) {
    for (const s of stocks) {
      if (fuzzyColourMatch(a, s.colour)) {
        const stockVal = Number(s[qtyField]) || 0;
        if (!bestAnchorMatch || stockVal > bestAnchorMatch.stockVal) {
          bestAnchorMatch = { colour: s.colour, stockVal };
        }
      }
    }
  }
  if (bestAnchorMatch) {
    return [{ qty: totalQty, colour: bestAnchorMatch.colour }];
  }
  // 2. Fallback: pick the colour with highest stock overall (largest pool, minimizes shortfall risk)
  const bestOverall = stocks.reduce((best, s) => {
    const v = Number(s[qtyField]) || 0;
    return (!best || v > best.stockVal) ? { colour: s.colour, stockVal: v } : best;
  }, null);
  if (bestOverall) {
    return [{ qty: totalQty, colour: bestOverall.colour }];
  }
  return [];
};

// ═══ Fabric rental cost (Ops handoff 05 Jun 2026) ═══
// Total fabric rental cost for a zone — Liza + Wall Masking + Velvet Curtains.
// Each fabric: reused (full rental × qty) + fresh (purchase × markup% × qty). Batta is
// separate (already in truss structure cost) — fabric is an additional, distinct cost.
// Used by the Deal Check TRUSS chip rollup so fabric rental is charged to the deal.
export const calcZoneFabricCost = (zCfg, trussInv, paletteAnchors, density) => {
  if (!zCfg || !trussInv) return 0;
  const fab = calcZoneFabric(zCfg, trussInv, density || "moderate");
  const fmkup = trussInv.fabricFreshMarkup || { liza:40, masking:40, curtain:40 };
  const rates = trussInv.rates || {};
  let cost = 0;
  const addFab = (totalQty, stockArr, qtyField, allocField, rentalKey, purchaseKey, markupKey, rentalKeyNew) => {
    if (!totalQty || totalQty <= 0) return;
    const existing = zCfg[allocField];
    const allocs = (Array.isArray(existing) && existing.length > 0)
      ? existing
      : autoFillFabricAllocation(Math.ceil(totalQty), paletteAnchors || [], stockArr, qtyField);
    const totals = calcFabricAllocationTotal(allocs, stockArr, qtyField, rates[rentalKey], rates[purchaseKey], fmkup[markupKey], rates[rentalKeyNew]);
    cost += totals.total || 0;
  };
  addFab(fab.maskingPieces, trussInv.maskingStock, "stockPieces", "maskingAllocation", "maskingPieceRate", "maskingPiecePurchase", "masking", "maskingPieceRateNew");
  addFab(fab.lizaKg,        trussInv.lizaStock,    "stockKg",     "lizaAllocation",    "lizaKgRate",       "lizaKgPurchase",       "liza",    "lizaKgRateNew");
  addFab(fab.curtainPieces, trussInv.curtainStock, "stockPieces", "curtainAllocation", "curtainPieceRate", "curtainPiecePurchase", "curtain", "curtainPieceRateNew");
  return cost;
};

// ─── IMS field accessor shim (used by carpet cost) ───────────────────────────
const imsField = {
  category:    (i) => i?.category || i?.cat || "",
  subcategory: (i) => i?.subcategory || i?.subCat || "",
  rentalCost:  (i) => Number(i?.rentalCost ?? i?.price ?? 0) || 0,
  qtyOwned:    (i) => Number(i?.qtyOwned ?? i?.qty ?? 0) || 0,
  photos:      (i) => Array.isArray(i?.photoUrls) && i.photoUrls.length ? i.photoUrls : (i?.img ? [i.img] : []),
  dims:        (i) => i?.dims_LxWxH || null,
  sizeText:    (i) => i?.size || (() => { const d=i?.dims_LxWxH; return d ? [d.l,d.w,d.h].filter(Boolean).join(" × ")+(d.unit?" "+d.unit:"") : ""; })(),
};

// §26.18 — Carpet cost for a zone (salesperson picks a specific carpet item).
// Mirrors fabric: reused (owned sqft × rental rate) + fresh (shortfall sqft × purchase × markup%).
// Carpet sqft = zone floor area (L×W). rentalRate = item rental (₹/sqft); purchaseRate = item.cost (₹/sqft).
export const calcZoneCarpet = (zc, carpetItem, markupPct) => {
  const out = { needed: 0, reused: 0, fresh: 0, reusedCost: 0, freshCost: 0, cost: 0, rentalRate: 0, purchaseRate: 0 };
  if (!zc || !zc.cpT || !carpetItem) return out;
  const fd = zc.floorDims || zc.dims || {};
  const needed = Math.round((Number(fd.L) || 0) * (Number(fd.W) || 0));
  if (needed <= 0) return out;
  const owned = imsField.qtyOwned(carpetItem);
  const reused = Math.min(needed, owned);
  const fresh = Math.max(0, needed - owned);
  const rentalRate = imsField.rentalCost(carpetItem);
  const purchaseRate = Number(carpetItem.cost ?? carpetItem.purchaseCost ?? 0) || 0;
  const reusedCost = reused * rentalRate;
  const freshCost = fresh * purchaseRate * ((Number(markupPct) || 0) / 100);
  return { needed, reused, fresh, reusedCost, freshCost, cost: reusedCost + freshCost, rentalRate, purchaseRate };
};

// ═══ PLATFORM COMPOSITE HELPERS (Deploy 2 · §7.9 addendum) ═══
// Platform is structural (zoneConfig.plH = "4in" | "1ft"), not an RC element.
// Recipe: 1 fatta = 8'×4'; stands sit at every grid corner, shared between adjacent fattas.
// "4in" platform = fattas only (fatta itself is 4 inches tall, no stand needed).
// "1ft" platform = fattas + stands (height-adjustable stand handles 1ft–3ft).
// IMS items: TEN-00008 (Platform Fatta, 4×8 ft), TEN-00009 (Platform Stand, height-adjustable).
export const PLATFORM_FATTA_CODE = "TEN-00008";
export const PLATFORM_STAND_CODE = "TEN-00009";

// Compute fatta + stand counts for a platform of L×W ft.
// Tries both grid orientations, picks the one with FEWER stands (tie → fewer fattas).
// Returns null if dims invalid.
export function computePlatformComponents(L, W, plH) {
  const Lv = Number(L) || 0, Wv = Number(W) || 0;
  if (Lv <= 0 || Wv <= 0) return null;
  // Orientation A: fatta 8' along L, 4' along W
  const ma = Math.ceil(Lv / 8), na = Math.ceil(Wv / 4);
  // Orientation B: fatta 4' along L, 8' along W
  const mb = Math.ceil(Lv / 4), nb = Math.ceil(Wv / 8);
  const fA = ma * na, sA = (ma + 1) * (na + 1);
  const fB = mb * nb, sB = (mb + 1) * (nb + 1);
  let fattas, stands;
  if (sA < sB) { fattas = fA; stands = sA; }
  else if (sB < sA) { fattas = fB; stands = sB; }
  else { fattas = Math.min(fA, fB); stands = sA; }
  // 4-inch platform: fatta itself sits flush, no stands needed
  if (plH === "4in") stands = 0;
  return { fattas, stands };
}

// Find IMS inventory item by code (case-insensitive, trim).
export function findIMSByCode(inventory, code) {
  if (!Array.isArray(inventory) || !code) return null;
  const target = String(code).toUpperCase().trim();
  return inventory.find(i => String(i?.code || "").toUpperCase().trim() === target) || null;
}

// Returns total free for an item on a given date (inventory minus all-deal blocks for that date).
// Mirrors IMS getAvailableQty. blocksForDate is { [imsId]: totalBlockedQty }.
export function getStudioAvailable(item, blocksForDate) {
  if (!item) return 0;
  const blocked = (blocksForDate || {})[item.id] || 0;
  return Math.max(0, (Number(item.qty) || 0) - (Number(item.blocked) || 0) - blocked);
}

// Build per-zone platform allocation plan with within-deal sibling-aware tracking.
// Each zone's "free before / free after" reflects prior zones' draws on the same fnDate.
// fns = collectAllFunctionData() output; dealCheckData = {inventory, blocksByDate, ...}.
// TODO: cross-function same-(date,venue) reuse rule (mirrors IMS confirmBlocks Step 3) not applied here —
// for multi-fn deals at one venue, demand may display inflated. Acceptable for v1; revisit if real deals show this.
export function buildPlatformPlan(fns, dealCheckData) {
  if (!Array.isArray(fns) || !dealCheckData) return null;
  const inv = dealCheckData.inventory || [];
  const blocksByDate = dealCheckData.blocksByDate || {};
  const fattaItem = findIMSByCode(inv, PLATFORM_FATTA_CODE);
  const standItem = findIMSByCode(inv, PLATFORM_STAND_CODE);
  // Step 1: collect raw per-zone draws in render order (fnIdx asc → zoneKey iteration order)
  const zoneDraws = [];
  fns.forEach((fn, fnIdx) => {
    if (!fn || !fn.zoneConfig || !fn.enabledEls) return;
    const enabledKeys = Object.keys(fn.enabledEls).filter(k => fn.enabledEls[k]);
    enabledKeys.forEach(zoneKey => {
      const zc = fn.zoneConfig[zoneKey];
      if (!zc || !zc.plH) return;
      const fd = zc.floorDims || zc.dims || {};
      const L = Number(fd.L) || 0, W = Number(fd.W) || 0;
      if (L <= 0 || W <= 0) return;
      const comp = computePlatformComponents(L, W, zc.plH);
      if (!comp) return;
      zoneDraws.push({ fnIdx, zoneKey, plH: zc.plH, L, W, fattas: comp.fattas, stands: comp.stands, fnDate: fn.fnDate || "", fnVenue: fn.fnVenue || "" });
    });
  });
  // Step 2: assign free-before / free-after per zone, tracking running allocation per fnDate.
  const allocByDate = {};
  const perZone = {};
  zoneDraws.forEach(d => {
    const date = d.fnDate;
    const blocksOnDate = blocksByDate[date] || {};
    const fattaTotalFree = getStudioAvailable(fattaItem, blocksOnDate);
    const standTotalFree = getStudioAvailable(standItem, blocksOnDate);
    if (!allocByDate[date]) allocByDate[date] = { fattaAlloc: 0, standAlloc: 0 };
    const priorFatta = allocByDate[date].fattaAlloc;
    const priorStand = allocByDate[date].standAlloc;
    const freeBeforeFatta = fattaTotalFree - priorFatta;       // can be negative if prior zones overdrew
    const freeBeforeStand = standTotalFree - priorStand;
    const freeAfterFatta = fattaTotalFree - priorFatta - d.fattas;
    const freeAfterStand = standTotalFree - priorStand - d.stands;
    allocByDate[date].fattaAlloc += d.fattas;
    allocByDate[date].standAlloc += d.stands;
    perZone[`${d.fnIdx}|${d.zoneKey}`] = {
      ...d, fattaItem, standItem, fattaTotalFree, standTotalFree,
      freeBeforeFatta, freeBeforeStand, freeAfterFatta, freeAfterStand, priorFatta, priorStand
    };
  });
  return { fattaItem, standItem, perZone };
}

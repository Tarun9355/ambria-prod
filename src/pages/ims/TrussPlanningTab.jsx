import { useState, useEffect, useMemo } from "react";
import { allocateForDate, applyOverridesToEvents, expireStaleSimulations, isDeptHead, TRUSS_AUDIT_SK, TRUSS_OVERRIDES_SK, TRUSS_SIMULATIONS_SK } from "../../lib/ims/trussEngine";
import { kvGet, reliableSave } from "../../lib/ims/kv";
import { Modal } from "../../components/ui";

// ─── Layer 0 — Truss config resolver (mirror of Studio's resolveTrussConfig) ──
const resolveTrussConfig = (zc) => {
  if (!zc) return { config: null, source: "none" };
  const dims = zc.dims || {};
  const isFilled = (v) => (typeof v === "number" ? v > 0 : (v != null && String(v).trim() !== "" && parseFloat(v) > 0));
  const L = parseFloat(dims.L) || 0;
  const W = parseFloat(dims.W) || 0;
  const H = parseFloat(dims.H) || 0;
  const hasL = isFilled(dims.L);
  const hasW = isFilled(dims.W);
  const hasH = isFilled(dims.H);
  if (!hasL && !hasW && !hasH) return { config: null, source: "none" };
  if (!hasH && (hasL || hasW)) return { config: null, source: "invalid", error: "Truss Height is required" };
  if (hasH && !hasL && !hasW) return { config: null, source: "invalid", error: "Need Length or Width along with Height" };
  if (hasH && hasL && hasW) return { config: "full_box", source: "auto-3dim" };
  const spanFt = hasL ? L : W;
  if (zc.trussType === "u_only" || zc.trussType === "half_box") return { config: zc.trussType, source: "sales-pick", spanFt };
  return { config: "half_box", source: "default-on-forget", spanFt, warning: true };
};

// ─── Layer 1 — Topology Calculator (mirror of Studio's buildTopology) ────────
// §23 Phase 5 (28 May 2026) — Smart allocator update per Tarun's formula:
//   beam_total_per_axis = span − pillarCount   (pillar treated as 1ft for budget math)
//   beam_segments = pillarCount − 1            (one per pillar-gap)
//   physical pillar width remains 0.75ft → gives ~0.25ft slack per pillar (engineering buffer)
// This minimizes joints for sales-team-friendly entries: 32ft = 1 joint (15+15), 63ft = 2 joints (4× 15ft).
const buildTopology = (config, L, W, H, spanFt, backDepth, engSettings) => {
  if (!config || !H || H <= 0) return null;
  const eng = engSettings || {};
  const maxSpan = eng.maxSpanFt || 30;
  const pillarWidth = eng.pillarWidthFt || 0.75;        // physical width (for maskingL etc.)
  const pillarBudget = eng.pillarBudgetFt || 0.75;      // math budget per pillar = physical width (0.75ft)
                                                         // §23 Phase 5 (28 May 2026, Tarun lock): budget == physical.
                                                         // Allocator handles fractional budgets via Math.floor + 1ft gap tolerance.
  const depth = backDepth || eng.defaultBackDepthFt || 4;
  // pillarCountForSpan: 2 corners + N middle pillars when span > maxSpan
  const pillarCountForSpan = (spanLen) => 2 + Math.max(0, Math.ceil(spanLen / maxSpan) - 1);
  // Split total beam length into per-segment lengths (one per pillar-gap)
  const splitBeamSegments = (totalBeamLen, segments) => {
    if (segments <= 0 || totalBeamLen <= 0) return [];
    const segLen = totalBeamLen / segments;
    return Array.from({ length: segments }, () => segLen);
  };

  if (config === "u_only") {
    const totalPillars = pillarCountForSpan(spanFt);
    const beamTotalLen = Math.max(0, spanFt - totalPillars * pillarBudget);
    const segLengths = splitBeamSegments(beamTotalLen, totalPillars - 1);
    const pillars = Array.from({ length: totalPillars }, (_, i) => {
      const id = i === 0 ? "P-left" : i === totalPillars - 1 ? "P-right" : `P-mid${i}`;
      return { id, H };
    });
    const beams = segLengths.map((len, i) => ({ side: segLengths.length === 1 ? "top" : `top-${i+1}`, lengthFt: len }));
    return { config, method: "A", pillars, beams, physicalL: spanFt, physicalW: 0, maskingL: spanFt + 2 * pillarWidth, maskingW: 0, pillarCount: pillars.length, beamCount: beams.length };
  }
  if (config === "half_box") {
    const totalFrontPillars = pillarCountForSpan(spanFt);
    const beamTotalLen = Math.max(0, spanFt - totalFrontPillars * pillarBudget);
    const segLengths = splitBeamSegments(beamTotalLen, totalFrontPillars - 1);
    // Front pillars: 2 corners + middle. Back pillars: 2 corners only (depth is small, no mid).
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
    ];
    return { config, method: "A", pillars, beams, physicalL: spanFt, physicalW: depth + 2 * pillarWidth, maskingL: spanFt + 2 * pillarWidth, maskingW: depth + 2 * pillarWidth, pillarCount: pillars.length, beamCount: beams.length };
  }
  if (config === "full_box") {
    // Both L and W axes can have mid-pillars. Corners are shared.
    const lAxisPillars = pillarCountForSpan(L); // pillars in an L-direction row (N-side or S-side)
    const wAxisPillars = pillarCountForSpan(W); // pillars in a W-direction column (W-side or E-side)
    const lMidCount = lAxisPillars - 2;
    const wMidCount = wAxisPillars - 2;
    const lBeamTotal = Math.max(0, L - lAxisPillars * pillarBudget);
    const wBeamTotal = Math.max(0, W - wAxisPillars * pillarBudget);
    const lSegLens = splitBeamSegments(lBeamTotal, lAxisPillars - 1);
    const wSegLens = splitBeamSegments(wBeamTotal, wAxisPillars - 1);
    const pillars = [
      { id: "P-NW", H }, { id: "P-NE", H }, { id: "P-SW", H }, { id: "P-SE", H },
      ...Array.from({ length: lMidCount }, (_, i) => ({ id: `P-N-mid${i+1}`, H })),
      ...Array.from({ length: lMidCount }, (_, i) => ({ id: `P-S-mid${i+1}`, H })),
      ...Array.from({ length: wMidCount }, (_, i) => ({ id: `P-W-mid${i+1}`, H })),
      ...Array.from({ length: wMidCount }, (_, i) => ({ id: `P-E-mid${i+1}`, H })),
    ];
    // 4 sides × N segments per side
    const beams = [
      ...lSegLens.map((len, i) => ({ side: lSegLens.length === 1 ? "front" : `front-${i+1}`, lengthFt: len })),
      ...lSegLens.map((len, i) => ({ side: lSegLens.length === 1 ? "back" : `back-${i+1}`, lengthFt: len })),
      ...wSegLens.map((len, i) => ({ side: wSegLens.length === 1 ? "left" : `left-${i+1}`, lengthFt: len })),
      ...wSegLens.map((len, i) => ({ side: wSegLens.length === 1 ? "right" : `right-${i+1}`, lengthFt: len })),
    ];
    return { config, method: "B", pillars, beams, physicalL: L + 2 * pillarWidth, physicalW: W + 2 * pillarWidth, maskingL: L + 2 * pillarWidth, maskingW: W + 2 * pillarWidth, pillarCount: pillars.length, beamCount: beams.length };
  }
  return null;
};

// ─── Layer 2 — Pillar Height Resolver ────────────────────────────────────────
// Input:  H (ft), trussInv (for stock check)
// Output: { pieces:[{type,size,qty,position?}], joints, shortage:bool, reason? }
// Standard heights 10/12/15ft → single piece, 0 joints (R2).
// 17ft = 2ft beam (ground) + 15ft pillar (top), 1 joint.
// 18ft = 3ft beam (ground) + 15ft pillar (top), 1 joint.
// Non-standard heights → attempt 2-spacer combo; else SHORTAGE.
const resolvePillarHeight = (H, trussInv) => {
  if (!H || H <= 0) return { pieces: [], joints: 0, shortage: true, reason: "Invalid height" };
  const inv = trussInv || {};
  const pillarSizes = Object.keys(inv.pillars || {}).map(Number).sort((a,b) => b - a);   // desc
  const beamSizes   = Object.keys(inv.beams   || {}).map(Number).sort((a,b) => b - a);   // desc
  if (pillarSizes.length === 0) return { pieces: [], joints: 0, shortage: true, reason: "No pillar sizes defined" };

  // Standard: exact pillar size match → single piece
  if (pillarSizes.includes(H)) {
    return { pieces: [{ type: "pillar", size: H, qty: 1 }], joints: 0, shortage: false };
  }

  // Non-standard: need a top pillar (the tallest size ≤ H) + ground spacer(s)
  // R2: top piece MUST be a pillar (load-bearing 5-plate).
  // Try single-spacer first (1 joint), then 2-spacer (still 1 joint via spec; 2 beam pieces total but joints = top-to-spacer joint count).
  // Per §23.3 R2: max 2 beam pieces as ground spacers.
  for (const topPillar of pillarSizes) {
    if (topPillar >= H) continue;
    const gap = H - topPillar;
    // Single-spacer
    if (beamSizes.includes(gap)) {
      return {
        pieces: [
          { type: "beam",   size: gap,       qty: 1, position: "ground" },
          { type: "pillar", size: topPillar, qty: 1, position: "top" },
        ],
        joints: 1, shortage: false,
      };
    }
    // Two-spacer combo (still 1 effective joint per spec, but more pieces)
    for (let i = 0; i < beamSizes.length; i++) {
      for (let j = i; j < beamSizes.length; j++) {
        if (beamSizes[i] + beamSizes[j] === gap) {
          return {
            pieces: [
              { type: "beam",   size: beamSizes[i], qty: 1, position: "ground" },
              { type: "beam",   size: beamSizes[j], qty: 1, position: "ground" },
              { type: "pillar", size: topPillar,    qty: 1, position: "top" },
            ],
            joints: 1, shortage: false,
          };
        }
      }
    }
  }
  return { pieces: [], joints: 0, shortage: true, reason: `Cannot assemble ${H}ft pillar from available sizes` };
};

// ─── Layer 3 — Beam Segment Resolver (DP / subset-sum + tolerance ranking) ───
// Input:  targetLength (ft), trussInv
// Output: { pieces:[{type:"beam",size,qty}], joints, shortage:bool, gap?, cost? }
//
// §23 Phase 5 (28 May 2026) — Tolerance rule per Tarun:
//   1. combo_sum MUST be ≤ targetLength (never exceed — would push truss past requested span)
//   2. (targetLength − combo_sum) MUST be ≤ 1ft (no big visible gap)
//   3. Among valid combos: minimize joints (= pieces − 1)
//   4. Tie-break: smaller gap (closer to target)
//   5. Tie-break: prefer larger inventory pieces (better stock utilization)
//
// This enables the salesperson-friendly inflation rule (enter span + pillarCount):
//   24ft span (2 pillars) → 22ft beam → 12+10 (1 joint, 0 gap) ✓
//   32ft span (2 pillars) → 30ft beam → 15+15 (1 joint, 0 gap) ✓
//   63ft span (3 pillars) → 30ft per segment × 2 → 15+15 (1 joint each, 0 gap) ✓
const resolveBeamSegment = (targetLength, trussInv) => {
  if (!targetLength || targetLength <= 0) return { pieces: [], joints: 0, shortage: false, gap: 0 };
  const MAX_GAP = 1.0; // ft — no combo with a larger gap than this is considered valid
  const inv = trussInv || {};
  const beamSizes = Object.keys(inv.beams || {}).map(Number).filter(n => n > 0).sort((a,b) => b - a);   // desc, largest first
  if (beamSizes.length === 0) return { pieces: [], joints: 0, shortage: true, reason: "No beam sizes" };

  // Search ALL subset sums ≤ target. Allow combo_sum from (target − MAX_GAP) up to target (floor).
  // Floor target to integer since beam stock is integer-ft only.
  const targetFloor = Math.floor(targetLength + 1e-9); // tiny epsilon for float safety (e.g. 22.5 → 22)
  const minAcceptable = Math.max(0, Math.ceil(targetLength - MAX_GAP - 1e-9));

  const candidates = []; // [{ combo:[...], sum }]
  const MAX_DEPTH = 6;
  const search = (remainingBudget, combo, startIdx, currentSum) => {
    // Record any combo whose sum is in [minAcceptable, targetFloor]
    if (currentSum >= minAcceptable && currentSum <= targetFloor) {
      candidates.push({ combo: [...combo], sum: currentSum });
    }
    if (combo.length >= MAX_DEPTH) return;
    if (remainingBudget < beamSizes[beamSizes.length - 1]) return; // can't fit smallest piece
    for (let i = startIdx; i < beamSizes.length; i++) {
      if (beamSizes[i] <= remainingBudget) {
        combo.push(beamSizes[i]);
        search(remainingBudget - beamSizes[i], combo, i, currentSum + beamSizes[i]);
        combo.pop();
      }
    }
  };
  search(targetFloor, [], 0, 0);

  if (candidates.length === 0) {
    // Genuinely impossible (e.g. target < smallest beam). Degraded fallback: largest single under target.
    const fallback = beamSizes.find(s => s <= targetFloor);
    if (fallback) {
      return {
        pieces: [{ type: "beam", size: fallback, qty: 1 }],
        joints: 0, shortage: true,
        gap: targetLength - fallback,
        reason: `No combo within ${MAX_GAP}ft of ${targetLength}ft; closest under = ${fallback}ft`,
      };
    }
    return { pieces: [], joints: 0, shortage: true, reason: `No combo possible for ${targetLength}ft` };
  }

  // Rank candidates by: fewer joints → smaller gap → larger pieces (abundance)
  let best = null;
  for (const cand of candidates) {
    const joints = cand.combo.length - 1;
    const gap = targetLength - cand.sum;
    const sizeCounts = {};
    cand.combo.forEach(s => { sizeCounts[s] = (sizeCounts[s] || 0) + 1; });
    // Abundance score — log10 of min remaining stock across used sizes
    let abundance = Infinity;
    Object.entries(sizeCounts).forEach(([sz, qty]) => {
      const stock = inv.beams[sz]?.stock || 0;
      const ratio = Math.log10(Math.max(stock - qty + 1, 1));
      if (ratio < abundance) abundance = ratio;
    });
    if (!isFinite(abundance)) abundance = 0;
    // Composite cost (lower = better):
    //   joints dominate (weight 100, can't be beaten by gap or pieces)
    //   then gap (weight 10 per ft, so 0.5ft gap = 5 cost)
    //   then piece count (weight 1, penalizes more small pieces over fewer large)
    //   then abundance discount (weight 0.1, small influence)
    const cost = (100 * joints) + (10 * gap) + (1 * cand.combo.length) - (0.1 * abundance);
    if (!best || cost < best.cost) {
      best = { cost, joints, gap, sizeCounts, sum: cand.sum };
    }
  }

  const piecesArr = Object.entries(best.sizeCounts)
    .map(([sz, qty]) => ({ type: "beam", size: parseFloat(sz), qty }))
    .sort((a, b) => b.size - a.size);
  return {
    pieces: piecesArr,
    joints: best.joints,
    shortage: false,
    cost: best.cost,
    gap: best.gap,
    rounded: best.sum !== targetLength,
  };
};

// ─── §23 Phase 2 — Allocator (single-event, no multi-fn pool yet) ────────────
// Input:  zoneTopology (Layer 1 output) + trussInv
// Output: { trusses:[{trussId, zone, trussConfig, pillars:[], beamSegments:[], totals:{}, costBreakdown:{}}], totalCost, shortageBorne, shortageNotes }
// Phase 2 = single-event only. Phase 3 will add Layer 4 pool optimization.
const allocateTruss = (zoneId, topology, trussInv) => {
  if (!topology) return null;
  const inv = trussInv || {};
  const result = {
    trussId: `T-${zoneId}`,
    zone: zoneId,
    trussConfig: topology.config,
    method: topology.method,
    pillarCount: topology.pillarCount,
    pillars: [],
    beamSegments: [],
    totals: { pillarsUsed: {}, beamsUsed: {}, totalJoints: 0, physicalL: topology.physicalL, physicalW: topology.physicalW },
    shortage: false,
    shortageNotes: [],
  };

  // Resolve each pillar
  topology.pillars.forEach((p, idx) => {
    const r = resolvePillarHeight(p.H, inv);
    result.pillars.push({ id: p.id, H: p.H, pieces: r.pieces, joints: r.joints });
    result.totals.totalJoints += r.joints;
    if (r.shortage) { result.shortage = true; result.shortageNotes.push(`${p.id}: ${r.reason}`); }
    r.pieces.forEach(pc => {
      const key = `${pc.type}-${pc.size}`;
      if (pc.type === "pillar") result.totals.pillarsUsed[pc.size] = (result.totals.pillarsUsed[pc.size] || 0) + pc.qty;
      else                       result.totals.beamsUsed[pc.size]   = (result.totals.beamsUsed[pc.size]   || 0) + pc.qty;
    });
  });

  // Resolve each beam segment
  topology.beams.forEach(b => {
    const r = resolveBeamSegment(b.lengthFt, inv);
    result.beamSegments.push({ side: b.side, lengthFt: b.lengthFt, pieces: r.pieces, joints: r.joints });
    result.totals.totalJoints += r.joints;
    if (r.shortage) { result.shortage = true; result.shortageNotes.push(`Beam ${b.side} (${b.lengthFt}ft): ${r.reason}`); }
    r.pieces.forEach(pc => {
      result.totals.beamsUsed[pc.size] = (result.totals.beamsUsed[pc.size] || 0) + pc.qty;
    });
  });

  return result;
};

// ─── Layer 4.1 — Compute event totals from trusses array ────────────────────
const computeEventTrussTotals = (trusses) => {
  const totals = { pillars: {}, beams: {}, totalJoints: 0 };
  (trusses || []).forEach(t => {
    const alloc = t?.allocation;
    if (!alloc) return;
    Object.entries(alloc.totals?.pillarsUsed || {}).forEach(([sz, qty]) => {
      totals.pillars[sz] = (totals.pillars[sz] || 0) + qty;
    });
    Object.entries(alloc.totals?.beamsUsed || {}).forEach(([sz, qty]) => {
      totals.beams[sz] = (totals.beams[sz] || 0) + qty;
    });
    totals.totalJoints += (alloc.totals?.totalJoints || 0);
  });
  return totals;
};

// ─── Layer 4.2 — Build event allocation from EO (or soft-hold draft) ────────
// Iterates zones in the event, runs Layer 1+2+3 for each, returns event entry.
// Caller passes the dimensions/configs source (EO.functionsDetail OR draft from Studio).
const buildEventAllocation = (eventMeta, fnList, trussInv) => {
  const allTrusses = [];
  let anyShortage = false;
  const shortageNotes = [];

  (fnList || []).forEach((fn) => {
    const zones = fn?.zones || {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(zones).forEach(([zoneKey, zc]) => {
      if (!zc) return;
      // Skip zones that aren't enabled (no elements in them).
      // If enabledEls is missing entirely, default to "evaluate all zones with dims"
      // (back-compat with older EOs).
      if (enabledEls && Object.keys(enabledEls).length > 0 && !enabledEls[zoneKey]) return;
      const layer0 = resolveTrussConfig(zc);
      if (!layer0 || layer0.source === "none" || layer0.source === "invalid") return;
      const eng = trussInv?.settings || {};
      const L = parseFloat(zc.dims?.L) || 0;
      const W = parseFloat(zc.dims?.W) || 0;
      const H = parseFloat(zc.dims?.H) || 0;
      const spanFt = layer0.spanFt || (layer0.source === "auto-3dim" ? Math.max(L, W) : 0);
      const backDepth = zc.trussBackDepth || eng.defaultBackDepthFt || 4;
      const topology = buildTopology(layer0.config, L, W, H, spanFt, backDepth, eng);
      if (!topology) return;
      const alloc = allocateTruss(`${fn.fnIdx || 0}-${zoneKey}`, topology, trussInv);
      if (!alloc) return;
      if (alloc.shortage) {
        anyShortage = true;
        shortageNotes.push(`Fn${fn.fnIdx ?? 0} ${zoneKey}: ${alloc.shortageNotes.join("; ")}`);
      }
      allTrusses.push({
        fnIdx: fn.fnIdx ?? 0,
        zoneKey,
        trussConfig: layer0.config,
        allocation: alloc,
        shortage: !!alloc.shortage,
        // §2.5.1 corollary (28 May 2026) — carry the requirement forward so dept head
        // sees what salesperson committed (L×W×H, back depth, who picked the type)
        // alongside the derived pillar/beam bifurcation.
        requirement: {
          L,
          W,
          H,
          spanFt,
          backDepth,
          source: layer0.source,  // "sales-pick" | "auto-3dim" | "default-on-forget"
        },
      });
    });
  });

  const totals = computeEventTrussTotals(allTrusses);
  return {
    eoId: eventMeta.eoId,
    clientId: eventMeta.clientId,
    clientName: eventMeta.clientName,
    fnIdx: eventMeta.fnIdx ?? 0,
    state: eventMeta.state || "soft",
    expiry: eventMeta.expiry || null,
    heldBy: eventMeta.heldBy || "—",
    createdAt: eventMeta.createdAt || Date.now(),
    trusses: allTrusses,
    totalPillarsUsed: totals.pillars,
    totalBeamsUsed: totals.beams,
    shortageBorne: false,  // computed later by Layer 4 pool stage
    selfShortage: anyShortage,
    shortageNotes,
  };
};

// ─── Phase 4 — Compute simulator impact ─────────────────────────────────────
// Given simulator zones (manual L/W/H/config) + current stock pressure on date,
// returns traffic light status + piece breakdown + cost estimate.
//
// mode = "compound" → stack on top of other active drafts (stress test)
// mode = "independent" → ignore other drafts (compare alternatives)
const simulateImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
  if (!sim || !trussInv) return null;

  // Build a synthetic event from simulator zones
  const syntheticFns = [{
    fnIdx: 0,
    zones: {},
    enabledEls: {},
    date: sim.date,
  }];
  (sim.zones || []).forEach((z, idx) => {
    const zoneKey = `sim-${idx}`;
    syntheticFns[0].zones[zoneKey] = {
      dims: { L: z.L, W: z.W, H: z.H },
      trussType: z.config,
    };
    syntheticFns[0].enabledEls[zoneKey] = true;
  });
  const simEvent = buildEventAllocation({
    eoId: `sim-${sim.id || "preview"}`,
    clientId: `sim-${sim.id || "preview"}`,
    clientName: sim.label || "Simulation",
    fnIdx: 0,
    state: "soft",
    expiry: sim.expiresAt || (Date.now() + 48 * 60 * 60 * 1000),
    heldBy: sim.createdBy || "Simulator",
    createdAt: Date.now(),
  }, syntheticFns, trussInv);

  if (!simEvent.trusses || simEvent.trusses.length === 0) {
    return { status: "gray", reason: "No zones configured", pieces: { pillars: {}, beams: {} }, cost: 0, pressure: 0 };
  }

  // Determine baseline stock used by real allocations + (if compound) other drafts
  const realEvents = Array.isArray(dateAlloc?.events) ? dateAlloc.events : [];
  const usedP = {};
  const usedB = {};
  realEvents.forEach(ev => {
    Object.entries(ev.totalPillarsUsed || {}).forEach(([sz, q]) => { usedP[sz] = (usedP[sz] || 0) + q; });
    Object.entries(ev.totalBeamsUsed   || {}).forEach(([sz, q]) => { usedB[sz] = (usedB[sz] || 0) + q; });
  });
  if (sim.mode === "compound" && Array.isArray(otherDrafts)) {
    otherDrafts.forEach(draft => {
      Object.entries(draft.computed?.pillars || {}).forEach(([sz, q]) => { usedP[sz] = (usedP[sz] || 0) + q; });
      Object.entries(draft.computed?.beams   || {}).forEach(([sz, q]) => { usedB[sz] = (usedB[sz] || 0) + q; });
    });
  }

  const stockP = {};
  const stockB = {};
  Object.entries(trussInv.pillars || {}).forEach(([sz, p]) => { stockP[sz] = (Number(p?.stock) || 0) - (usedP[sz] || 0); });
  Object.entries(trussInv.beams   || {}).forEach(([sz, b]) => { stockB[sz] = (Number(b?.stock) || 0) - (usedB[sz] || 0); });

  // Check feasibility of this sim on top of usedP/usedB
  let shortageCount = 0;
  let maxPressure = 0;
  const demandP = simEvent.totalPillarsUsed || {};
  const demandB = simEvent.totalBeamsUsed || {};
  const overflow = { pillars: {}, beams: {} };
  Object.entries(demandP).forEach(([sz, q]) => {
    const remaining = stockP[sz] || 0;
    const totalStock = Number(trussInv.pillars?.[sz]?.stock) || 1;
    const pressure = ((usedP[sz] || 0) + q) / totalStock;
    if (pressure > maxPressure) maxPressure = pressure;
    if (q > remaining) { shortageCount += (q - remaining); overflow.pillars[sz] = q - remaining; }
  });
  Object.entries(demandB).forEach(([sz, q]) => {
    const remaining = stockB[sz] || 0;
    const totalStock = Number(trussInv.beams?.[sz]?.stock) || 1;
    const pressure = ((usedB[sz] || 0) + q) / totalStock;
    if (pressure > maxPressure) maxPressure = pressure;
    if (q > remaining) { shortageCount += (q - remaining); overflow.beams[sz] = q - remaining; }
  });

  let status, reason;
  if (shortageCount > 0) {
    status = "red";
    reason = `Shortage of ${shortageCount} piece(s) — rental needed`;
  } else if (maxPressure > 0.85) {
    status = "yellow";
    reason = `High stock pressure (${Math.round(maxPressure * 100)}% utilization)`;
  } else {
    status = "green";
    reason = `Available · ${Math.round(maxPressure * 100)}% utilization`;
  }

  // Cost estimate from rates (if available)
  const rates = trussInv.rates || {};
  const pillarRftRate = Number(rates.pillarRftRate) || 0;
  const beamRftRate   = Number(rates.beamRftRate)   || 0;
  let pillarRft = 0, beamRft = 0;
  Object.entries(demandP).forEach(([sz, q]) => { pillarRft += Number(sz) * q; });
  Object.entries(demandB).forEach(([sz, q]) => { beamRft   += Number(sz) * q; });
  const cost = Math.round(pillarRft * pillarRftRate + beamRft * beamRftRate);

  return {
    status,
    reason,
    pieces: { pillars: demandP, beams: demandB },
    overflow,
    cost,
    pressure: Math.round(maxPressure * 100),
    pillarRft,
    beamRft,
    totalJoints: simEvent.totalJoints || 0,
  };
};

export default function TrussPlanningTab({ trussAlloc, setTrussAlloc, trussInv, eventOrders, authUser }){
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [overrides, setOverrides] = useState({});
  const [simulations, setSimulations] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [expandedEvents, setExpandedEvents] = useState({});
  const [customizeTarget, setCustomizeTarget] = useState(null);  // {eoId, zoneKey, truss}
  const [showSimDialog, setShowSimDialog] = useState(false);
  const [showSimResult, setShowSimResult] = useState(null);  // simulation result preview
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const canEdit = isDeptHead(authUser);

  // Load overrides + simulations + audit log on mount
  useEffect(() => {
    (async () => {
      try {
        const v = await kvGet(TRUSS_OVERRIDES_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setOverrides(parsed);
      } catch {}
      try {
        const v = await kvGet(TRUSS_SIMULATIONS_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Auto-prune expired
          const cleaned = expireStaleSimulations(parsed, Date.now()) || parsed;
          setSimulations(cleaned);
        }
      } catch {}
      try {
        const v = await kvGet(TRUSS_AUDIT_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (Array.isArray(parsed)) setAuditLog(parsed.slice(-50).reverse()); // newest first
      } catch {}
    })();
  }, []);

  // Date entry & events
  const dateEntry = trussAlloc?.[selectedDate] || null;
  const dateEvents = useMemo(() => {
    const raw = Array.isArray(dateEntry?.events) ? dateEntry.events : [];
    return applyOverridesToEvents(raw, overrides);
  }, [dateEntry, overrides]);
  const stockSummary = dateEntry?.stockSummary || null;

  // Date navigation
  const shiftDay = (delta) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  // Active simulations for this date
  const dateSimulations = useMemo(() => {
    return Object.values(simulations).filter(s => s.date === selectedDate);
  }, [simulations, selectedDate]);

  // Stock pressure visual (per-size color bars)
  const stockBars = useMemo(() => {
    if (!trussInv) return { pillars: [], beams: [] };
    const buildBars = (kind) => {
      const items = trussInv[kind] || {};
      const used = (kind === "pillars") ? (stockSummary?.demandPillars || {}) : (stockSummary?.demandBeams || {});
      const soft = (kind === "pillars") ? (stockSummary?.softPillars || {}) : (stockSummary?.softBeams || {});
      const hard = (kind === "pillars") ? (stockSummary?.hardPillars || {}) : (stockSummary?.hardBeams || {});
      return Object.entries(items).map(([sz, item]) => {
        const total = Number(item?.stock) || 0;
        const usedQty = Number(used[sz]) || 0;
        const softQty = Number(soft[sz]) || 0;
        const hardQty = Number(hard[sz]) || 0;
        const available = Math.max(0, total - usedQty);
        const pct = total > 0 ? Math.round((usedQty / total) * 100) : 0;
        const color = pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green";
        return { size: sz, total, usedQty, softQty, hardQty, available, pct, color };
      }).sort((a, b) => Number(b.size) - Number(a.size));
    };
    return { pillars: buildBars("pillars"), beams: buildBars("beams") };
  }, [trussInv, stockSummary]);

  // Shortage events
  const shortageEvents = useMemo(() => dateEvents.filter(ev => ev.shortageBorne || ev.selfShortage), [dateEvents]);

  // Save handlers (writes to Redis + state)
  const saveOverrides = async (newOverrides) => {
    setOverrides(newOverrides);
    try { await reliableSave(TRUSS_OVERRIDES_SK, JSON.stringify(newOverrides), "Truss Overrides"); } catch {}
  };
  const saveSimulations = async (newSims) => {
    setSimulations(newSims);
    try { await reliableSave(TRUSS_SIMULATIONS_SK, JSON.stringify(newSims), "Truss Simulations"); } catch {}
  };

  const applyOverride = async (eoId, zoneKey, ovrData) => {
    const key = `${eoId}:${zoneKey}`;
    const next = { ...overrides, [key]: { ...ovrData, overrideBy: authUser?.name || "—", overrideAt: Date.now(), locked: true } };
    await saveOverrides(next);
    // Append audit log
    try {
      const existing = await kvGet(TRUSS_AUDIT_SK);
      const arr = existing ? (JSON.parse(existing) || []) : [];
      arr.push({ ts: Date.now(), date: selectedDate, event: "override-applied", eoId, zoneKey, by: authUser?.name || "—", reason: ovrData.reason || "" });
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      await reliableSave(TRUSS_AUDIT_SK, JSON.stringify(trimmed), "Truss audit (override)");
      setAuditLog(trimmed.slice(-50).reverse());
    } catch {}
    // Trigger Layer 4 re-cascade for this date — locked entries preserved automatically
    if (dateEntry && trussInv) {
      const recomputed = allocateForDate(trussAlloc, selectedDate, dateEntry.events, trussInv, `override-by-${authUser?.name || "—"}`);
      setTrussAlloc(recomputed);
    }
    setCustomizeTarget(null);
  };

  const removeOverride = async (key) => {
    if (!canEdit) return;
    if (!confirm("Remove this override? The truss will re-cascade with the auto-allocator.")) return;
    const next = { ...overrides };
    delete next[key];
    await saveOverrides(next);
    try {
      const existing = await kvGet(TRUSS_AUDIT_SK);
      const arr = existing ? (JSON.parse(existing) || []) : [];
      arr.push({ ts: Date.now(), date: selectedDate, event: "override-removed", key, by: authUser?.name || "—" });
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      await reliableSave(TRUSS_AUDIT_SK, JSON.stringify(trimmed), "Truss audit (override removed)");
      setAuditLog(trimmed.slice(-50).reverse());
    } catch {}
    if (dateEntry && trussInv) {
      const recomputed = allocateForDate(trussAlloc, selectedDate, dateEntry.events, trussInv, `override-removed-by-${authUser?.name || "—"}`);
      setTrussAlloc(recomputed);
    }
  };

  const saveSimulation = async (sim) => {
    const simId = sim.id || `sim-${Date.now().toString(36)}`;
    const next = { ...simulations, [simId]: { ...sim, id: simId, expiresAt: Date.now() + 48 * 60 * 60 * 1000 } };
    await saveSimulations(next);
    setShowSimResult(null);
    setShowSimDialog(false);
  };

  const discardSimulation = async (simId) => {
    const next = { ...simulations };
    delete next[simId];
    await saveSimulations(next);
  };

  const convertSimToDeal = async (sim) => {
    if (!canEdit) return;
    if (!trussInv) return;
    if (!confirm(`Convert "${sim.label}" to a soft-hold reservation? This will appear in Studio Deal Check too.`)) return;
    // Create a soft-hold event in trussAlloc with this client (sim becomes a real reservation)
    const syntheticFns = [{
      fnIdx: 0,
      date: sim.date,
      zones: {},
      enabledEls: {},
    }];
    (sim.zones || []).forEach((z, idx) => {
      const zoneKey = `sim-converted-${idx}`;
      syntheticFns[0].zones[zoneKey] = { dims: { L: z.L, W: z.W, H: z.H }, trussType: z.config };
      syntheticFns[0].enabledEls[zoneKey] = true;
    });
    const evEntry = buildEventAllocation({
      eoId: `sim-deal-${sim.id}`,
      clientId: `sim-deal-${sim.id}`,
      clientName: sim.label || "Converted Simulation",
      fnIdx: 0,
      state: "soft",
      expiry: Date.now() + 24 * 60 * 60 * 1000,
      heldBy: authUser?.name || sim.createdBy || "Dept Head",
      createdAt: Date.now(),
    }, syntheticFns, trussInv);
    if (!evEntry.trusses || evEntry.trusses.length === 0) { alert("Conversion failed: no valid trusses"); return; }
    let nextAlloc = { ...trussAlloc };
    const dateE = nextAlloc[sim.date] || { events: [] };
    const existingEvents = Array.isArray(dateE.events) ? [...dateE.events] : [];
    existingEvents.push(evEntry);
    nextAlloc[sim.date] = { ...dateE, events: existingEvents };
    nextAlloc = allocateForDate(nextAlloc, sim.date, existingEvents, trussInv, `sim-conversion-by-${authUser?.name || "—"}`);
    setTrussAlloc(nextAlloc);
    // Remove from drafts
    await discardSimulation(sim.id);
    alert("Converted to soft-hold reservation. Visible in Studio Deal Check.");
  };

  // Fmt helpers
  const fmtRs = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
  const fmtTs = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div className="space-y-5">
      {/* ───────────── 1. HEADER ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              🏗️ Truss Planning Dashboard
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {canEdit ? "Department head access · override + simulator enabled" : "Read-only view · override gated to dept heads"}
            </p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            Last cascade: {dateEntry?.lastCascadeAt ? fmtTs(dateEntry.lastCascadeAt) : "—"}
            {dateEntry?.lastCascadeBy ? ` · ${dateEntry.lastCascadeBy}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => shiftDay(-1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">◀ Prev</button>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium" />
          <button onClick={() => shiftDay(1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Next ▶</button>
          <button onClick={() => setSelectedDate(today)} className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg text-sm">Today</button>
          <div className="ml-auto text-sm text-gray-700">
            <strong>{dateEvents.length}</strong> event{dateEvents.length === 1 ? "" : "s"} ·{" "}
            <strong>{dateSimulations.length}</strong> draft{dateSimulations.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* ───────────── 2. STOCK STATUS BAR ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📊 Stock Availability — {selectedDate}</h3>
        {!trussInv ? (
          <p className="text-sm text-amber-700">Truss inventory not loaded. Visit Settings → Truss & Batta.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">PILLARS</p>
              <div className="space-y-1.5">
                {stockBars.pillars.map(bar => (
                  <div key={"p-"+bar.size} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-700 font-medium">{bar.size}ft</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                      <div className={`h-full ${bar.color === "red" ? "bg-red-500" : bar.color === "amber" ? "bg-amber-500" : bar.color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: bar.pct + "%" }}></div>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{bar.usedQty} / {bar.total} ({bar.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">BEAMS</p>
              <div className="space-y-1.5">
                {stockBars.beams.map(bar => (
                  <div key={"b-"+bar.size} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-700 font-medium">{bar.size}ft</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                      <div className={`h-full ${bar.color === "red" ? "bg-red-500" : bar.color === "amber" ? "bg-amber-500" : bar.color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: bar.pct + "%" }}></div>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{bar.usedQty} / {bar.total} ({bar.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ───────────── 3. SHORTAGE ALERTS ───────────── */}
      {shortageEvents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">⚠️ Shortage Alerts · {shortageEvents.length} event{shortageEvents.length === 1 ? "" : "s"}</h3>
          <div className="space-y-2">
            {shortageEvents.map(ev => (
              <div key={ev.eoId} className="bg-white rounded-lg p-3 border border-red-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{ev.clientName || "—"} ({ev.state})</p>
                    <p className="text-xs text-gray-600 mt-1">{ev.shortageNotes?.join(" · ") || "Pool shortage attributed (last-added)"}</p>
                  </div>
                  <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Rental required</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───────────── 4. FUNCTIONS LIST ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📋 Events on {selectedDate}</h3>
        {dateEvents.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No events on this date. Click "+ New Simulation" below to test stock availability for a hypothetical event.</p>
        ) : (
          <div className="space-y-2">
            {dateEvents.map(ev => {
              const isOpen = !!expandedEvents[ev.eoId];
              const stateColor = ev.state === "hard" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800";
              const stateLabel = ev.state === "hard" ? "🔒 SOLD" : "🕒 SOFT";
              const totalP = Object.values(ev.totalPillarsUsed || {}).reduce((s, n) => s + n, 0);
              const totalB = Object.values(ev.totalBeamsUsed || {}).reduce((s, n) => s + n, 0);
              return (
                <div key={ev.eoId} className={`rounded-lg border ${ev.shortageBorne ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
                  <button onClick={() => setExpandedEvents(s => ({ ...s, [ev.eoId]: !s[ev.eoId] }))} className="w-full p-3 text-left hover:bg-gray-50 flex items-center gap-3">
                    <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
                    <span className="flex-1">
                      <span className="font-semibold text-sm text-gray-900">{ev.clientName || "—"}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${stateColor}`}>{stateLabel}</span>
                      {ev.hasOverride && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800">📝 OVERRIDE</span>}
                      {ev.shortageBorne && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-200 text-red-900">⚠ SHORTAGE</span>}
                    </span>
                    <span className="text-xs text-gray-600">{ev.trusses?.length || 0} truss · {totalP}P+{totalB}B</span>
                    <span className="text-xs text-gray-500">by {ev.heldBy || "—"}</span>
                  </button>
                  {isOpen && (
                    <div className="p-3 border-t border-gray-200 space-y-2">
                      {(ev.trusses || []).map((t, ti) => {
                        const key = `${ev.eoId}:${t.zoneKey}`;
                        const isLocked = !!t.locked;
                        const tPillars = Object.entries(t.allocation?.totals?.pillarsUsed || {}).map(([s,q]) => `${q}× ${s}ft`).join(", ");
                        const tBeams = Object.entries(t.allocation?.totals?.beamsUsed || {}).map(([s,q]) => `${q}× ${s}ft`).join(", ");
                        // §2.5.1 corollary (28 May 2026) — show requirement (L×W×H + back depth + source)
                        // so dept head sees what salesperson committed alongside the derived pieces.
                        // For legacy trussAlloc entries (pre-28 May) missing `requirement`, derive
                        // from eventOrders[ev.eoId].functionsDetail[t.fnIdx].zones[t.zoneKey] on the fly.
                        let req = t.requirement;
                        if (!req && Array.isArray(eventOrders)) {
                          const legacyEo = eventOrders.find(e => e.id === ev.eoId);
                          if (legacyEo) {
                            const fnsDetail = Array.isArray(legacyEo.functionsDetail) ? legacyEo.functionsDetail : null;
                            const fnIdx = typeof t.fnIdx === "number" ? t.fnIdx : 0;
                            const fnDet = fnsDetail ? (fnsDetail.find(f => (typeof f.fnIdx === "number" ? f.fnIdx : 0) === fnIdx) || fnsDetail[0]) : null;
                            const legacyZones = fnDet?.zones || legacyEo.zones || {};
                            const zc = legacyZones[t.zoneKey];
                            if (zc) {
                              const L = parseFloat(zc.dims?.L) || 0;
                              const W = parseFloat(zc.dims?.W) || 0;
                              const H = parseFloat(zc.dims?.H) || 0;
                              // Mirror resolveTrussConfig logic for source inference
                              const isFilled = (v) => (typeof v === "number" ? v > 0 : (v != null && String(v).trim() !== "" && parseFloat(v) > 0));
                              const hasL = isFilled(zc.dims?.L), hasW = isFilled(zc.dims?.W), hasH = isFilled(zc.dims?.H);
                              let source = "unknown";
                              if (hasH && hasL && hasW) source = "auto-3dim";
                              else if (zc.trussType === "u_only" || zc.trussType === "half_box") source = "sales-pick";
                              else if (hasH && (hasL || hasW)) source = "default-on-forget";
                              const spanFt = hasL ? L : W;
                              const backDepth = parseFloat(zc.trussBackDepth) || 4;
                              req = { L, W, H, spanFt, backDepth, source };
                            }
                          }
                        }
                        let reqLine = null;
                        if (req) {
                          // §23 Phase 5 (28 May 2026 — Tarun lock) — compute ACTUAL physical width
                          // from the allocation, not the entered span. Format: "63ft → 62.25ft actual".
                          // For full_box: show L → L_actual × W → W_actual.
                          // For half_box / u_only: show span → span_actual.
                          const pillarWidth = 0.75; // physical per pillar (matches buildTopology)
                          // Sum allocated beam length on the L (front) axis from allocation.beamSegments
                          const beamSegs = t.allocation?.beamSegments || [];
                          const segLenSum = (filterFn) => beamSegs.filter(filterFn).reduce((s, b) => {
                            // beam pieces array: sum of size*qty
                            const len = (b.pieces || []).reduce((p, pc) => p + (pc.size * pc.qty), 0);
                            return s + len;
                          }, 0);
                          // Total pillar count for span direction (front axis)
                          const totalPillarCount = Object.values(t.allocation?.totals?.pillarsUsed || {}).reduce((s, q) => s + q, 0);
                          // Estimate front-axis pillar count: total minus back corners (for half_box only)
                          let frontPillars = totalPillarCount;
                          if (t.trussConfig === "half_box") frontPillars = Math.max(2, totalPillarCount - 2);
                          else if (t.trussConfig === "full_box") frontPillars = Math.ceil(totalPillarCount / 2); // rough estimate when L/W split unknown
                          // Compute physical L = front beam sum + frontPillars × 0.75
                          let frontBeamLen = 0;
                          if (t.trussConfig === "full_box") {
                            frontBeamLen = segLenSum(b => String(b.side || "").startsWith("front"));
                          } else {
                            frontBeamLen = segLenSum(b => String(b.side || "").startsWith("front") || b.side === "top" || String(b.side || "").startsWith("top"));
                          }
                          const physicalL = frontBeamLen + frontPillars * pillarWidth;
                          // For full_box: also compute physical W
                          let physicalW = 0;
                          if (t.trussConfig === "full_box") {
                            const sideBeamLen = segLenSum(b => String(b.side || "").startsWith("left"));
                            // W-axis pillars: 2 left-corners shared with L + W-mid count
                            // Quick estimate: pillarsUsed across all sizes ÷ axes (rough; not perfect but ok for display)
                            const wAxisPillars = Math.max(2, totalPillarCount - frontPillars - (frontPillars - 2)); // back row has same pillar count as front but no mid (for half_box doesn't apply)
                            // Simpler: count distinct W beams (1 per gap) + 2 corners
                            const wSegmentCount = beamSegs.filter(b => String(b.side || "").startsWith("left")).length;
                            const wPillarCount = wSegmentCount + 1; // gaps + 1 = pillars on that axis
                            physicalW = sideBeamLen + wPillarCount * pillarWidth;
                          }

                          const parts = [];
                          // Format: entered → actual
                          if (t.trussConfig === "full_box") {
                            if (req.L > 0) {
                              const pL = physicalL.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.L}ft L → ${pL}ft actual`);
                            }
                            if (req.W > 0) {
                              const pW = physicalW.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.W}ft W → ${pW}ft actual`);
                            }
                            if (req.H > 0) parts.push(`${req.H}ft H`);
                          } else {
                            if (req.spanFt > 0) {
                              const pL = physicalL.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.spanFt}ft span → ${pL}ft actual`);
                            }
                            if (req.H > 0) parts.push(`${req.H}ft H`);
                          }
                          // Back depth only meaningful for half_box / full_box
                          if (t.trussConfig !== "u_only" && req.backDepth > 0) {
                            parts.push(`back: ${req.backDepth}ft`);
                          }
                          // Pillar breakdown
                          let pillarLabel = "";
                          if (t.trussConfig === "u_only") {
                            const mid = Math.max(0, totalPillarCount - 2);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else if (t.trussConfig === "half_box") {
                            const mid = Math.max(0, totalPillarCount - 4);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else if (t.trussConfig === "full_box") {
                            const mid = Math.max(0, totalPillarCount - 4);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else {
                            pillarLabel = `${totalPillarCount} pillars`;
                          }
                          // Source
                          const sourceLabel = req.source === "sales-pick" ? "salesperson picked"
                                            : req.source === "auto-3dim" ? "auto (all 3 dims)"
                                            : req.source === "default-on-forget" ? "⚠ default (no pick)"
                                            : req.source === "unknown" ? "source unknown (legacy)"
                                            : req.source;
                          const sourceClass = req.source === "default-on-forget" ? "text-amber-700 font-medium"
                                            : req.source === "unknown" ? "text-gray-400 italic"
                                            : "text-gray-500";
                          reqLine = (
                            <p className="text-xs text-gray-700 mt-1">
                              <strong className="text-gray-600">Requirement:</strong> {parts.join(" · ")}
                              {" · "}
                              <span className="text-gray-600">{pillarLabel}</span>
                              {" · "}
                              <span className={sourceClass}>{sourceLabel}</span>
                            </p>
                          );
                        }
                        return (
                          <div key={ti} className={`rounded p-3 border ${isLocked ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-gray-50"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  Zone: <strong>{t.zoneKey}</strong> · <span className="text-xs text-gray-600">{t.trussConfig}</span>
                                  {isLocked && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-200 text-purple-900">🔒 LOCKED</span>}
                                </p>
                                {reqLine}
                                <p className="text-xs text-gray-600 mt-1">Pillars: {tPillars || "—"} · Beams: {tBeams || "—"}</p>
                                <p className="text-xs text-gray-600">Joints: {t.allocation?.totals?.totalJoints || 0}</p>
                                {t.override?.reason && <p className="text-xs italic text-purple-700 mt-1">Override reason: "{t.override.reason}" — by {t.override.overrideBy}</p>}
                              </div>
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => canEdit && setCustomizeTarget({ eoId: ev.eoId, zoneKey: t.zoneKey, truss: t })}
                                  disabled={!canEdit}
                                  className={`text-xs px-3 py-1 rounded ${canEdit ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
                                  title={canEdit ? "Customize this truss" : "Dept head only"}
                                >
                                  📝 Customize
                                </button>
                                {isLocked && canEdit && (
                                  <button onClick={() => removeOverride(key)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────── 5. SIMULATOR ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">🧪 What-If Simulator</h3>
          <button
            onClick={() => canEdit && setShowSimDialog(true)}
            disabled={!canEdit}
            className={`text-sm px-4 py-2 rounded-lg font-semibold ${canEdit ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
            title={canEdit ? "Create a new simulation" : "Dept head only"}
          >
            + New Simulation
          </button>
        </div>
        {dateSimulations.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No active drafts on this date. Simulations expire after 48 hours.</p>
        ) : (
          <div className="space-y-2">
            {dateSimulations.map(sim => {
              const computed = sim.computed || simulateImpact(sim, dateEntry, dateSimulations.filter(s => s.id !== sim.id), trussInv);
              const statusColor = computed?.status === "red" ? "bg-red-100 text-red-800" : computed?.status === "yellow" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
              const statusEmoji = computed?.status === "red" ? "🔴" : computed?.status === "yellow" ? "🟡" : "🟢";
              return (
                <div key={sim.id} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">✏️ {sim.label} <span className="text-xs text-gray-500">({sim.mode})</span></p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {(sim.zones || []).map(z => `${z.name || "zone"}: ${z.config} ${z.L||"—"}×${z.W||"—"}×${z.H||"—"}`).join(" · ")}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        By {sim.createdBy || "—"} · Expires {fmtTs(sim.expiresAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-1 rounded ${statusColor}`}>{statusEmoji} {computed?.reason || "—"}</span>
                      <span className="text-xs text-gray-600">{fmtRs(computed?.cost)} · {computed?.pressure}% stock</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {canEdit && (
                      <button onClick={() => convertSimToDeal(sim)} className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white">
                        ➜ Convert to Soft Hold
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => discardSimulation(sim.id)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">
                        Discard
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────── 6. CASCADE HISTORY ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <button onClick={() => setHistoryExpanded(s => !s)} className="w-full text-left flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">📜 Cascade History · {auditLog.length} entr{auditLog.length === 1 ? "y" : "ies"} (last 50)</h3>
          <span className="text-xs">{historyExpanded ? "▼" : "▶"}</span>
        </button>
        {historyExpanded && (
          <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
            {auditLog.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No audit entries yet.</p>
            ) : (
              auditLog.map((entry, idx) => (
                <div key={idx} className="text-xs flex items-start gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
                  <span className="text-gray-500 w-32 flex-shrink-0">{fmtTs(entry.ts)}</span>
                  <span className="text-gray-700 flex-1">
                    <strong>{entry.event}</strong>
                    {entry.date && entry.date !== "ALL" ? ` · ${entry.date}` : ""}
                    {entry.by ? ` · by ${entry.by}` : ""}
                    {entry.eventCount ? ` · ${entry.eventCount} events` : ""}
                    {entry.reason ? ` · "${entry.reason}"` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ───────────── CUSTOMIZE DIALOG ───────────── */}
      {customizeTarget && (
        <CustomizeDialog
          target={customizeTarget}
          onClose={() => setCustomizeTarget(null)}
          onSave={(ovrData) => applyOverride(customizeTarget.eoId, customizeTarget.zoneKey, ovrData)}
          trussInv={trussInv}
        />
      )}

      {/* ───────────── NEW SIMULATION DIALOG ───────────── */}
      {showSimDialog && (
        <NewSimulationDialog
          selectedDate={selectedDate}
          trussInv={trussInv}
          dateEntry={dateEntry}
          dateSimulations={dateSimulations}
          authUser={authUser}
          onClose={() => setShowSimDialog(false)}
          onSave={saveSimulation}
        />
      )}
    </div>
  );
}

// ─── Phase 4 — Customize Dialog (override modal) ────────────────────────────
function CustomizeDialog({ target, onClose, onSave, trussInv }){
  const t = target.truss;
  const [config, setConfig] = useState(t.trussConfig || "half_box");
  const [backDepth, setBackDepth] = useState(t.allocation?.totals?.physicalW || 4);
  const [reason, setReason] = useState("");

  const handleSave = () => {
    if (!reason.trim()) { alert("Please provide a reason for this override."); return; }
    onSave({
      customConfig: config,
      customBackDepth: Number(backDepth) || 4,
      reason: reason.trim(),
    });
  };

  return (
    <Modal open={true} onClose={onClose} title="📝 Customize Truss" wide>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-xs">
          <p className="text-gray-700"><strong>Event:</strong> {target.eoId}</p>
          <p className="text-gray-700"><strong>Zone:</strong> {target.zoneKey}</p>
          <p className="text-gray-700"><strong>Current config:</strong> {t.trussConfig}</p>
          <p className="text-gray-700"><strong>Current totals:</strong> {Object.values(t.allocation?.totals?.pillarsUsed || {}).reduce((s,n)=>s+n,0)} pillars + {Object.values(t.allocation?.totals?.beamsUsed || {}).reduce((s,n)=>s+n,0)} beams</p>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Force Configuration</label>
          <select value={config} onChange={e => setConfig(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="u_only">🟢 U Truss</option>
            <option value="half_box">🟡 Half Box Truss</option>
            <option value="full_box">🔴 Full Box</option>
          </select>
        </div>
        {config === "half_box" && (
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Back Depth: {backDepth} ft</label>
            <input type="range" min="3" max="6" step="0.5" value={backDepth} onChange={e => setBackDepth(e.target.value)} className="w-full" />
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Reason (required) <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Standalone setup, no plywood support; client wants exposed beams" rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"></textarea>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <strong>⚠️ Cascade impact:</strong> Saving this override will trigger a pool re-allocation for this date. Other events may be re-shuffled. Locked entries (already overridden) are preserved.
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">Save Override</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Phase 4 — New Simulation Dialog (what-if modal) ────────────────────────
function NewSimulationDialog({ selectedDate, trussInv, dateEntry, dateSimulations, authUser, onClose, onSave }){
  const [label, setLabel] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [mode, setMode] = useState("compound");
  const [zones, setZones] = useState([{ name: "Stage", config: "full_box", L: "", W: "", H: "" }]);
  const [previewResult, setPreviewResult] = useState(null);

  const addZone = () => setZones(s => [...s, { name: `Zone ${s.length + 1}`, config: "u_only", L: "", W: "", H: "" }]);
  const removeZone = (idx) => setZones(s => s.filter((_, i) => i !== idx));
  const updateZone = (idx, field, val) => setZones(s => s.map((z, i) => i === idx ? { ...z, [field]: val } : z));

  const handlePreview = () => {
    if (!label.trim()) { alert("Please provide a label."); return; }
    const validZones = zones.filter(z => z.H && (z.L || z.W));
    if (validZones.length === 0) { alert("At least one zone with H + L/W is required."); return; }
    const tempSim = {
      date: selectedDate,
      label: label.trim(),
      salesperson: salesperson.trim() || authUser?.name || "—",
      createdBy: authUser?.name || "—",
      mode,
      zones: validZones.map(z => ({
        name: z.name,
        config: z.config,
        L: Number(z.L) || 0,
        W: Number(z.W) || 0,
        H: Number(z.H) || 0,
      })),
    };
    const result = simulateImpact(tempSim, dateEntry, dateSimulations, trussInv);
    setPreviewResult({ sim: tempSim, computed: result });
  };

  const handleSave = () => {
    if (!previewResult) { alert("Please preview first."); return; }
    onSave({ ...previewResult.sim, computed: previewResult.computed });
  };

  const result = previewResult?.computed;
  const statusColor = result?.status === "red" ? "bg-red-100 text-red-800 border-red-300" : result?.status === "yellow" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-green-100 text-green-800 border-green-300";

  return (
    <Modal open={true} onClose={onClose} title="🧪 New Simulation" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Label *</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Sharma Wedding · Ashi" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Salesperson</label>
            <input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Ashi" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Mode</label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "compound"} onChange={() => setMode("compound")} /> Compound (stack on other drafts)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "independent"} onChange={() => setMode("independent")} /> Independent (alternative scenarios)</label>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-700">Zones</label>
            <button onClick={addZone} className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">+ Add Zone</button>
          </div>
          <div className="space-y-2">
            {zones.map((z, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                <input value={z.name} onChange={e => updateZone(idx, "name", e.target.value)} placeholder="Name" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <select value={z.config} onChange={e => updateZone(idx, "config", e.target.value)} className="col-span-3 px-2 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="u_only">U Truss</option>
                  <option value="half_box">Half Box</option>
                  <option value="full_box">Full Box</option>
                </select>
                <input type="number" value={z.L} onChange={e => updateZone(idx, "L", e.target.value)} placeholder="L" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.W} onChange={e => updateZone(idx, "W", e.target.value)} placeholder="W" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.H} onChange={e => updateZone(idx, "H", e.target.value)} placeholder="H" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                {zones.length > 1 && <button onClick={() => removeZone(idx)} className="col-span-1 text-red-600 hover:text-red-800 text-xs">×</button>}
              </div>
            ))}
          </div>
        </div>

        <button onClick={handlePreview} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          🔍 Check Availability
        </button>

        {result && (
          <div className={`border rounded-lg p-4 ${statusColor}`}>
            <p className="font-semibold mb-2">{result.status === "red" ? "🔴" : result.status === "yellow" ? "🟡" : "🟢"} {result.reason}</p>
            <div className="text-xs space-y-1">
              <p>Pillars needed: {Object.entries(result.pieces?.pillars || {}).map(([s, q]) => `${q}× ${s}ft`).join(", ") || "—"}</p>
              <p>Beams needed: {Object.entries(result.pieces?.beams || {}).map(([s, q]) => `${q}× ${s}ft`).join(", ") || "—"}</p>
              <p>Joints: {result.totalJoints || 0} · Pillar RFT: {result.pillarRft || 0} · Beam RFT: {result.beamRft || 0}</p>
              <p className="font-semibold mt-2">Cost estimate: ₹{Math.round(result.cost || 0).toLocaleString("en-IN")} · Stock pressure: {result.pressure || 0}%</p>
            </div>
            {Object.keys(result.overflow?.pillars || {}).length > 0 || Object.keys(result.overflow?.beams || {}).length > 0 ? (
              <div className="mt-2 pt-2 border-t border-red-300 text-xs">
                <strong>Overflow:</strong> {[...Object.entries(result.overflow.pillars || {}).map(([s,q]) => `${q}× ${s}ft pillar`), ...Object.entries(result.overflow.beams || {}).map(([s,q]) => `${q}× ${s}ft beam`)].join(", ")} needed via rental
              </div>
            ) : null}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={!previewResult} className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold ${previewResult ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}>Save Draft (48hr)</button>
        </div>
      </div>
    </Modal>
  );
}

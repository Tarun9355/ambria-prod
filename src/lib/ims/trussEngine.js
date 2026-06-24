import { kvGet, reliableSave } from "./kv";

// Tier 2.3 Phase 3 (26 May 2026) — audit log of every allocation/cascade/promotion/amend event.
// Append-only ring buffer, last 500 entries retained. See §23 Phase 3 SHIP LOG.
export const TRUSS_AUDIT_SK = "ambria-ims-truss-audit-v1";
// Tier 2.3 Phase 4 (26 May 2026) — department-head override layer + simulator drafts.
// Overrides: {"<eoId>:<zoneKey>": {customConfig, customBackDepth, reason, locked, overrideBy, overrideAt}}
// Simulations: {"<simId>": {date, label, zones[], mode, expiresAt, ...}} — 48hr TTL
export const TRUSS_OVERRIDES_SK    = "ambria-ims-truss-overrides-v1";
export const TRUSS_SIMULATIONS_SK  = "ambria-ims-truss-simulations-v1";

const computePoolFeasibility = (eventsForDate, trussInv) => {
  // Aggregate demand per size
  const demandPillars = {};
  const demandBeams = {};
  const softP = {}, hardP = {}, softB = {}, hardB = {};
  (eventsForDate || []).forEach(ev => {
    Object.entries(ev.totalPillarsUsed || {}).forEach(([sz, q]) => {
      demandPillars[sz] = (demandPillars[sz] || 0) + q;
      if (ev.state === "soft") softP[sz] = (softP[sz] || 0) + q;
      else hardP[sz] = (hardP[sz] || 0) + q;
    });
    Object.entries(ev.totalBeamsUsed || {}).forEach(([sz, q]) => {
      demandBeams[sz] = (demandBeams[sz] || 0) + q;
      if (ev.state === "soft") softB[sz] = (softB[sz] || 0) + q;
      else hardB[sz] = (hardB[sz] || 0) + q;
    });
  });

  const stockPillars = {};
  const stockBeams = {};
  Object.entries(trussInv?.pillars || {}).forEach(([sz, p]) => { stockPillars[sz] = Number(p?.stock) || 0; });
  Object.entries(trussInv?.beams   || {}).forEach(([sz, b]) => { stockBeams[sz]   = Number(b?.stock) || 0; });

  let feasible = true;
  const overflowPillars = {};
  const overflowBeams = {};
  Object.entries(demandPillars).forEach(([sz, q]) => {
    const stock = stockPillars[sz] || 0;
    if (q > stock) { feasible = false; overflowPillars[sz] = q - stock; }
  });
  Object.entries(demandBeams).forEach(([sz, q]) => {
    const stock = stockBeams[sz] || 0;
    if (q > stock) { feasible = false; overflowBeams[sz] = q - stock; }
  });

  // Sort events by createdAt ascending; last-added bears shortage
  const sorted = [...(eventsForDate || [])].sort((a, b) => {
    const ca = a.createdAt || 0, cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return (a.eoId || "").localeCompare(b.eoId || "");
  });
  // Clear shortageBorne on all
  sorted.forEach(ev => { ev.shortageBorne = false; });

  // If infeasible, walk events in REVERSE order, attributing shortage to last-first
  if (!feasible) {
    // Make a running stock pool
    const remainingP = { ...stockPillars };
    const remainingB = { ...stockBeams };
    // Subtract HARD events first (they have priority)
    sorted.filter(ev => ev.state === "hard").forEach(ev => {
      Object.entries(ev.totalPillarsUsed || {}).forEach(([sz, q]) => { remainingP[sz] = (remainingP[sz] || 0) - q; });
      Object.entries(ev.totalBeamsUsed || {}).forEach(([sz, q]) => { remainingB[sz] = (remainingB[sz] || 0) - q; });
    });
    // Now walk SOFT events in createdAt order — first ones fit, later ones bear shortage
    sorted.filter(ev => ev.state === "soft").forEach(ev => {
      let fits = true;
      Object.entries(ev.totalPillarsUsed || {}).forEach(([sz, q]) => { if ((remainingP[sz] || 0) < q) fits = false; });
      Object.entries(ev.totalBeamsUsed || {}).forEach(([sz, q]) => { if ((remainingB[sz] || 0) < q) fits = false; });
      if (fits) {
        Object.entries(ev.totalPillarsUsed || {}).forEach(([sz, q]) => { remainingP[sz] = (remainingP[sz] || 0) - q; });
        Object.entries(ev.totalBeamsUsed || {}).forEach(([sz, q]) => { remainingB[sz] = (remainingB[sz] || 0) - q; });
      } else {
        ev.shortageBorne = true;
      }
    });
    // If hard events themselves exceed stock, mark the LAST hard event
    let hardOverflow = false;
    Object.values(remainingP).forEach(v => { if (v < 0) hardOverflow = true; });
    Object.values(remainingB).forEach(v => { if (v < 0) hardOverflow = true; });
    if (hardOverflow) {
      const hardSorted = sorted.filter(ev => ev.state === "hard");
      if (hardSorted.length > 0) hardSorted[hardSorted.length - 1].shortageBorne = true;
    }
  }

  return {
    feasible,
    demandPillars,
    demandBeams,
    stockPillars,
    stockBeams,
    softPillars: softP,
    hardPillars: hardP,
    softBeams: softB,
    hardBeams: hardB,
    overflowPillars,
    overflowBeams,
  };
};

// ─── Layer 4.4 — allocateForDate: full multi-fn pool allocator ──────────────
// Inputs: existing TRUSS_ALLOC_SK blob, the date to recompute, eventsList for
// that date (each = {eoId, clientId, clientName, fnIdx, state, ...}), trussInv.
// Returns: updated allocation blob with the date freshly recomputed.
export const allocateForDate = (existingAlloc, date, eventsList, trussInv, trigger) => {
  const out = (existingAlloc && typeof existingAlloc === "object") ? { ...existingAlloc } : {};
  if (!date || !Array.isArray(eventsList) || eventsList.length === 0) {
    delete out[date];  // No events — clear the date entirely
    return out;
  }
  if (!trussInv) {
    // Inventory not loaded — preserve existing entry, log warning
    // eslint-disable-next-line no-console
    console.warn(`[tier23-p3] allocateForDate(${date}) skipped: trussInv not loaded`);
    return out;
  }
  const summary = computePoolFeasibility(eventsList, trussInv);
  out[date] = {
    lastCascadeAt: Date.now(),
    lastCascadeBy: trigger || "system",
    events: eventsList,
    stockSummary: {
      demandPillars: summary.demandPillars,
      demandBeams:   summary.demandBeams,
      softPillars:   summary.softPillars,
      hardPillars:   summary.hardPillars,
      softBeams:     summary.softBeams,
      hardBeams:     summary.hardBeams,
      stockPillars:  summary.stockPillars,
      stockBeams:    summary.stockBeams,
      overflowPillars: summary.overflowPillars,
      overflowBeams:   summary.overflowBeams,
      feasible:      summary.feasible,
    },
  };
  return out;
};

// ─── Phase 4 — Apply overrides to events before pool re-allocation ──────────
// Given a date's events + override map, mark matching truss entries as locked
// and apply their custom config. Returns mutated events with override info embedded.
export const applyOverridesToEvents = (eventsForDate, overrides) => {
  if (!Array.isArray(eventsForDate) || !overrides || typeof overrides !== "object") {
    return eventsForDate;
  }
  return eventsForDate.map(ev => {
    const trusses = (ev.trusses || []).map(t => {
      const key = `${ev.eoId}:${t.zoneKey}`;
      const ovr = overrides[key];
      if (!ovr) return t;
      // Override exists — mark locked + carry override data
      return {
        ...t,
        locked: true,
        override: {
          customConfig: ovr.customConfig || t.trussConfig,
          customBackDepth: ovr.customBackDepth || null,
          reason: ovr.reason || "",
          overrideBy: ovr.overrideBy || "",
          overrideAt: ovr.overrideAt || null,
        },
      };
    });
    const hasLocked = trusses.some(t => t.locked);
    return hasLocked ? { ...ev, trusses, hasOverride: true } : ev;
  });
};

// ─── Phase 4 — Expire stale simulator drafts (48hr TTL) ─────────────────────
export const expireStaleSimulations = (simulations, now) => {
  if (!simulations || typeof simulations !== "object") return null;
  const nowMs = now || Date.now();
  let changed = false;
  const kept = {};
  Object.entries(simulations).forEach(([id, sim]) => {
    const expMs = typeof sim?.expiresAt === "number" ? sim.expiresAt : Date.parse(sim?.expiresAt || "");
    if (!expMs || expMs <= nowMs) { changed = true; return; }
    kept[id] = sim;
  });
  return changed ? kept : null;
};

// ─── Phase 4 — Check if user is department-head (override+simulator authority) ─
export const isDeptHead = (authUser) => {
  if (!authUser) return false;
  if (authUser.role === "Admin") return true;
  const name = String(authUser.username || authUser.name || "").toLowerCase();
  return ["krati", "ajay", "himanshu", "anmol"].includes(name);
};

// ─── Layer 0 — Truss config resolver (mirror of Studio's resolveTrussConfig) ──
export const resolveTrussConfig = (zc) => {
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
  if (hasH && !hasL && !hasW) return { config: null, source: "invalid", error: "Need Width or Depth along with Height" };
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
export const buildTopology = (config, L, W, H, spanFt, backDepth, engSettings) => {
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
export const resolvePillarHeight = (H, trussInv) => {
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
export const resolveBeamSegment = (targetLength, trussInv) => {
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
export const allocateTruss = (zoneId, topology, trussInv) => {
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
export const computeEventTrussTotals = (trusses) => {
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
export const buildEventAllocation = (eventMeta, fnList, trussInv) => {
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
export const simulateImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
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

// ─── Phase 3 backfill flag storage key ───────────────────────────────────────
export const TRUSS_P3_BACKFILLED_SK = "ambria-ims-tier23-p3-backfilled-v1";

// ─── Layer 4.5 — Expire stale soft holds for a date ─────────────────────────
// Returns updated events array (or null if no changes).
export const expireStaleSoftHolds = (eventsForDate, now) => {
  if (!Array.isArray(eventsForDate)) return null;
  const nowMs = now || Date.now();
  let changed = false;
  const kept = eventsForDate.filter(ev => {
    if (ev.state !== "soft") return true;
    const expMs = typeof ev.expiry === "number" ? ev.expiry : Date.parse(ev.expiry || "");
    if (!expMs || expMs <= nowMs) { changed = true; return false; }
    return true;
  });
  return changed ? kept : null;
};

// ─── Layer 4.6 — Append audit log entry (last 500 retained) ─────────────────
export const appendTrussAudit = async (entry) => {
  try {
    const existing = await kvGet(TRUSS_AUDIT_SK);
    const arr = existing ? (JSON.parse(existing) || []) : [];
    arr.push({ ts: Date.now(), ...entry });
    const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
    await reliableSave(TRUSS_AUDIT_SK, JSON.stringify(trimmed), "Truss audit");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[tier23-p3] audit append failed:", e?.message || e);
  }
};

// ─── Layer 4.7 — Convert EO to truss allocator input format ─────────────────
// EO.functionsDetail[] carries {fnIdx, type, date, zones, enabledEls, ...}
// We need per-fn { fnIdx, zones, enabledEls } records.
export const eoToFnList = (eo) => {
  if (!eo) return [];
  const fnsDetail = Array.isArray(eo.functionsDetail) ? eo.functionsDetail : null;
  if (fnsDetail && fnsDetail.length > 0) {
    return fnsDetail.map(f => ({
      fnIdx: f.fnIdx ?? 0,
      date: f.date || eo.date || "",
      zones: f.zones || {},
      enabledEls: f.enabledEls || {},
    }));
  }
  // Legacy EO fallback — single function at top level
  return [{
    fnIdx: 0,
    date: eo.date || "",
    zones: eo.zones || {},
    enabledEls: eo.enabledEls || {},
  }];
};

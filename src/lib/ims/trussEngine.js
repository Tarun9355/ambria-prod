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

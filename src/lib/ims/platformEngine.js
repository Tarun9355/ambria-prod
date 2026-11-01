import { supabase } from "../supabase";
import { eoToFnList, isDeptHead, expireStaleSimulations } from "./trussEngine";

// Platform's date-aware booking, mirroring trussEngine.js's pool-feasibility/allocation layers
// (§23 Phase 3/4) but simplified to match how a platform is actually specified — there is no
// picker of named physical pieces (unlike pillars/beams): a zone just types a Height band, a
// floorDims L×W, and a quantity (StudioBuild.jsx's Platform/Carpet card), shared with Carpet.
// So booking tracks one aggregate SQFT pool per truss material (iron/pole/aluminium) instead of a
// per-size piece count — the same bulk-pool model trussInv.batta already uses for wrap fabric,
// not the discrete piece-resolution model pillars/beams need. Billing is untouched: this never
// feeds cost, same relationship Truss's own RFT billing has to its stock-feasibility dashboard.
export const PLATFORM_MATERIALS = ["iron", "pole", "aluminium"];

// Resolve which material's platforms[] array backs a given material's stock — independent
// per-material fallback to Iron, matching trussInvForMaterial's platforms resolution in pricing.js
// (duplicated here rather than cross-imported: lib/ims intentionally doesn't depend on lib/studio,
// same reason buildTopology itself is duplicated between trussEngine.js and pricing.js instead of
// shared — see this project's own established pattern).
const platformsForMaterial = (trussInv, material) => {
  const mat = String(material || "iron").toLowerCase();
  if (mat === "iron") return Array.isArray(trussInv?.platforms) ? trussInv.platforms : [];
  const m = trussInv?.materials?.[mat];
  if (Array.isArray(m?.platforms)) return m.platforms;
  return Array.isArray(trussInv?.platforms) ? trussInv.platforms : [];
};

export const platformStockSqft = (trussInv, material) => platformsForMaterial(trussInv, material)
  .reduce((s, r) => s + (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0), 0);

// Stock-weighted average ₹/sqft across a material's configured platform rows — Ambria's own internal
// cost rate, the same role the old Fatta/Stand inventory items' rentalCost played before Platform
// Config replaced them (2026-11-01 owner call: platform is no longer tracked via TEN-00008/TEN-00009
// at all — see DealCheckOverlay.jsx's Tenting rollup). A simple average because platform demand here
// is one aggregate sqft number per material (see this file's own header comment), not tied to any one
// named row, so there's no single row's rate to charge off directly.
export const platformAvgRatePerSqft = (trussInv, material) => {
  let sqftSum = 0, costSum = 0;
  platformsForMaterial(trussInv, material).forEach((r) => {
    const area = (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0);
    sqftSum += area;
    costSum += area * (Number(r.ratePerSqft) || 0);
  });
  return sqftSum > 0 ? costSum / sqftSum : 0;
};

// ─── Layer 4.2-equivalent — one event's platform sqft demand, by material ───────────────────
// Mirrors trussEngine.js's buildEventAllocation, but the "allocator" here is just arithmetic
// (sqft = L × W × qty) instead of a pillar/beam topology resolve — there's no structural layout to
// compute. A zone only counts if a Height band is actually picked (zc.plH): the same floorDims
// also drives Carpet, and a zone can have Carpet with no Platform at all.
export const buildEventPlatformAllocation = (eventMeta, fnList) => {
  const bySqft = {};
  (fnList || []).forEach((fn) => {
    const zones = fn?.zones || {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(zones).forEach(([zoneKey, zc]) => {
      if (!zc || !zc.plH) return; // no platform picked in this zone
      if (enabledEls && Object.keys(enabledEls).length > 0 && !enabledEls[zoneKey]) return;
      const L = parseFloat(zc.floorDims?.L) || 0;
      const W = parseFloat(zc.floorDims?.W) || 0;
      const qty = Math.max(1, parseInt(zc.plQty, 10) || 1);
      const sqft = L * W * qty;
      if (sqft <= 0) return;
      const mat = String(zc.trussMaterial || "iron").toLowerCase();
      bySqft[mat] = Math.round(((bySqft[mat] || 0) + sqft) * 100) / 100;
    });
  });
  return {
    eoId: eventMeta.eoId,
    clientId: eventMeta.clientId,
    clientName: eventMeta.clientName,
    fnIdx: eventMeta.fnIdx ?? 0,
    state: eventMeta.state || "soft",
    expiry: eventMeta.expiry || null,
    heldBy: eventMeta.heldBy || "—",
    createdAt: eventMeta.createdAt || Date.now(),
    totalPlatformSqftByMaterial: bySqft,
  };
};

// ─── Layer 4.3-equivalent — pool feasibility for one date ───────────────────────────────────
// Same soft/hard priority rule as trussEngine.js's computePoolFeasibility: hard (SOLD) events get
// stock first; soft (draft) events fill in createdAt order; whoever can't fit bears the shortage.
export const computePlatformPoolFeasibility = (eventsForDate, trussInv) => {
  const demand = {}, soft = {}, hard = {};
  (eventsForDate || []).forEach(ev => {
    Object.entries(ev.totalPlatformSqftByMaterial || {}).forEach(([mat, sqft]) => {
      demand[mat] = (demand[mat] || 0) + sqft;
      if (ev.state === "soft") soft[mat] = (soft[mat] || 0) + sqft;
      else hard[mat] = (hard[mat] || 0) + sqft;
    });
  });

  const stock = {};
  PLATFORM_MATERIALS.forEach(mat => { stock[mat] = Math.round(platformStockSqft(trussInv, mat) * 100) / 100; });
  Object.keys(demand).forEach(mat => { if (!(mat in stock)) stock[mat] = Math.round(platformStockSqft(trussInv, mat) * 100) / 100; });

  let feasible = true;
  const overflow = {};
  const EPS = 1e-6;
  Object.entries(demand).forEach(([mat, sqft]) => {
    const st = stock[mat] || 0;
    if (sqft > st + EPS) { feasible = false; overflow[mat] = Math.round((sqft - st) * 100) / 100; }
  });

  // Sort events by createdAt ascending (tie-break eoId); last-added bears shortage, same as truss.
  const sorted = [...(eventsForDate || [])].sort((a, b) => {
    const ca = a.createdAt || 0, cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return (a.eoId || "").localeCompare(b.eoId || "");
  });
  sorted.forEach(ev => { ev.shortageBorne = false; });

  if (!feasible) {
    const remaining = { ...stock };
    sorted.filter(ev => ev.state === "hard").forEach(ev => {
      Object.entries(ev.totalPlatformSqftByMaterial || {}).forEach(([mat, sqft]) => { remaining[mat] = (remaining[mat] || 0) - sqft; });
    });
    sorted.filter(ev => ev.state === "soft").forEach(ev => {
      let fits = true;
      Object.entries(ev.totalPlatformSqftByMaterial || {}).forEach(([mat, sqft]) => { if ((remaining[mat] || 0) < sqft - EPS) fits = false; });
      if (fits) {
        Object.entries(ev.totalPlatformSqftByMaterial || {}).forEach(([mat, sqft]) => { remaining[mat] = (remaining[mat] || 0) - sqft; });
      } else {
        ev.shortageBorne = true;
      }
    });
    let hardOverflow = false;
    Object.values(remaining).forEach(v => { if (v < -EPS) hardOverflow = true; });
    if (hardOverflow) {
      const hardSorted = sorted.filter(ev => ev.state === "hard");
      if (hardSorted.length > 0) hardSorted[hardSorted.length - 1].shortageBorne = true;
    }
  }

  return { feasible, demand, soft, hard, stock, overflow };
};

// ─── Layer 4.4-equivalent — allocateForDate: full multi-event pool allocator ────────────────
export const allocatePlatformForDate = (existingAlloc, date, eventsList, trussInv, trigger) => {
  const out = (existingAlloc && typeof existingAlloc === "object") ? { ...existingAlloc } : {};
  if (!date || !Array.isArray(eventsList) || eventsList.length === 0) {
    delete out[date];
    return out;
  }
  if (!trussInv) {
    // eslint-disable-next-line no-console
    console.warn(`[platform-alloc] allocatePlatformForDate(${date}) skipped: trussInv not loaded`);
    return out;
  }
  const summary = computePlatformPoolFeasibility(eventsList, trussInv);
  out[date] = {
    lastCascadeAt: Date.now(),
    lastCascadeBy: trigger || "system",
    events: eventsList,
    stockSummary: {
      demand: summary.demand,
      soft: summary.soft,
      hard: summary.hard,
      stock: summary.stock,
      overflow: summary.overflow,
      feasible: summary.feasible,
    },
  };
  return out;
};

// ─── Overrides — department-head manual correction of one event's platform sqft ─────────────
// Mirrors trussEngine.js's applyOverridesToEvents, but there's no "config" to override — just the
// computed sqft itself (e.g. ops improvised an extra platform on site beyond what Build recorded).
export const applyPlatformOverridesToEvents = (eventsForDate, overrides) => {
  if (!Array.isArray(eventsForDate) || !overrides || typeof overrides !== "object") return eventsForDate;
  return eventsForDate.map(ev => {
    const ovr = overrides[ev.eoId];
    if (!ovr) return ev;
    return {
      ...ev,
      totalPlatformSqftByMaterial: ovr.totalPlatformSqftByMaterial || ev.totalPlatformSqftByMaterial,
      hasOverride: true,
      override: { reason: ovr.reason || "", overrideBy: ovr.overrideBy || "", overrideAt: ovr.overrideAt || null },
    };
  });
};

// ─── Simulator — what-if impact of a hypothetical sqft demand on a date ──────────────────────
// Mirrors trussEngine.js's simulateImpact, but the input is directly {material, sqft} per row —
// there's no L/W/H/config to resolve into pieces first, since platform demand already IS a plain
// sqft number (see buildEventPlatformAllocation above). No cost estimate: platform billing is the
// zone's own Height-band rate x sqft in Studio Build, not a flat RFT x rate like truss, so there's
// no single rate to estimate cost from here — this stays booking-only, same as the rest of the file.
export const simulatePlatformImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
  if (!sim || !trussInv) return null;

  const demand = {};
  (sim.zones || []).forEach(z => {
    const mat = String(z.material || "iron").toLowerCase();
    const sqft = Number(z.sqft) || 0;
    if (sqft > 0) demand[mat] = Math.round(((demand[mat] || 0) + sqft) * 100) / 100;
  });
  if (Object.keys(demand).length === 0) {
    return { status: "gray", reason: "No platform sqft entered", demand: {}, overflow: {}, pressure: 0 };
  }

  const realEvents = Array.isArray(dateAlloc?.events) ? dateAlloc.events : [];
  const used = {};
  realEvents.forEach(ev => {
    Object.entries(ev.totalPlatformSqftByMaterial || {}).forEach(([mat, sqft]) => { used[mat] = (used[mat] || 0) + sqft; });
  });
  if (sim.mode === "compound" && Array.isArray(otherDrafts)) {
    otherDrafts.forEach(draft => {
      Object.entries(draft.computed?.demand || {}).forEach(([mat, sqft]) => { used[mat] = (used[mat] || 0) + sqft; });
    });
  }

  const stock = {};
  PLATFORM_MATERIALS.forEach(mat => { stock[mat] = platformStockSqft(trussInv, mat); });
  Object.keys(demand).forEach(mat => { if (!(mat in stock)) stock[mat] = platformStockSqft(trussInv, mat); });

  let shortageSqft = 0;
  let maxPressure = 0;
  const overflow = {};
  Object.entries(demand).forEach(([mat, sqft]) => {
    const totalStock = stock[mat] || 0;
    const remaining = totalStock - (used[mat] || 0);
    const pressure = totalStock > 0 ? ((used[mat] || 0) + sqft) / totalStock : 1;
    if (pressure > maxPressure) maxPressure = pressure;
    if (sqft > remaining) {
      const over = Math.round((sqft - remaining) * 100) / 100;
      shortageSqft += over;
      overflow[mat] = over;
    }
  });

  let status, reason;
  if (shortageSqft > 0) { status = "red"; reason = `Shortage of ${shortageSqft} sqft — rental needed`; }
  else if (maxPressure > 0.85) { status = "yellow"; reason = `High stock pressure (${Math.round(maxPressure * 100)}% utilization)`; }
  else { status = "green"; reason = `Available · ${Math.round(maxPressure * 100)}% utilization`; }

  return { status, reason, demand, overflow, pressure: Math.round(maxPressure * 100) };
};

export { isDeptHead, expireStaleSimulations };

// ─── Audit — one INSERT into the platform_audit TABLE (off the blob), mirrors appendTrussAudit ──
export const appendPlatformAudit = async (entry) => {
  try {
    await supabase.from("platform_audit").insert({ data: { ts: Date.now(), ...entry } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[platform-alloc] audit append failed:", e?.message || e);
  }
};

export { eoToFnList };

// ─── Backfill flag storage key — mirrors trussEngine.js's TRUSS_P3_BACKFILLED_SK ─────────────
export const PLATFORM_BACKFILLED_SK = "ambria-ims-platform-alloc-backfilled-v1";

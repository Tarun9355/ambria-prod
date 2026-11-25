import { isPlatformFoc } from "../studio/foc.js";
import { supabase } from "../supabase";
import { eoToFnList, isDeptHead, expireStaleSimulations } from "./trussEngine";

// Platform's date-aware booking, mirroring trussEngine.js's pool-feasibility/allocation layers
// (§23 Phase 3/4) but simplified to match how a platform is actually specified — there is no
// picker of named physical pieces (unlike pillars/beams): a zone just types a Height band, a
// floorDims L×W, and a quantity (StudioBuild.jsx's Platform/Carpet card), shared with Carpet.
//
// PLATFORM MATERIAL (Wood/Iron, each row's own `material` field in trussInv.platforms — Admin →
// Settings → Platform Config) is a completely separate axis from a zone's TRUSS material
// (iron/pole/aluminium). Confirmed bug this closes (found 2026-11-05): this used to reuse the
// truss-material taxonomy for platforms entirely — PLATFORM_MATERIALS was
// ["iron","pole","aluminium"], and the old platformsForMaterial read trussInv.materials[mat].platforms,
// a structure platforms never actually populate (every real platform row lives in the one flat
// trussInv.platforms array below, distinguished only by its own `material` text) — so every
// material bucket silently fell back to the SAME full array, showing identical totals for all three
// and pooling truss-material demand that was never a real, separate stock pool.
//
// Booking uses ONE COMBINED sqft pool (Wood + Iron summed) rather than splitting demand by
// platform material, because no zone-level control exists for "which platform material does this
// booking use" (owner decision, 2026-11-05) — see PLATFORM_POOL_KEY/platformEventSqft below.
// Admin Config and the stock dashboard still show Wood vs Iron SUPPLY separately for inventory
// purposes; only the booking/feasibility math is unified.
//
// Billing: platformAvgRatePerSqft (below) feeds Deal Check's rental cost/margin via
// buildPlatformPlan (pricing.js) and the Tenting rollup (DealCheckOverlay.jsx) — both now bill the
// stock-weighted BLENDED average across all platform stock, for the same no-per-booking-signal
// reason.
export const PLATFORM_MATERIALS = ["wood", "iron"];
// The single key every booking/feasibility structure uses now — kept as an object key (not a bare
// number) so the existing generic demand/stock/overflow machinery below, and every saved
// platform_allocations/platform_overrides/platform_simulations row, keeps working unchanged.
export const PLATFORM_POOL_KEY = "all";
export const PLATFORM_MATERIAL_LABEL = { wood: "Wood", iron: "Iron" };

// A platform row's own material, normalised. "iron" is the catch-all fallback for anything that
// isn't recognisably "wood" (missing/empty/typo'd/a metal name like "Steel") — matches the
// "iron" default every other material field in this app already uses, and production has exactly
// one Wood row against six metal ones.
export const platformMaterialOf = (row) => {
  const m = String(row?.material ?? "").trim().toLowerCase();
  return m.startsWith("wood") ? "wood" : "iron";
};

// Filters the one flat trussInv.platforms array by each row's OWN material — never reads
// trussInv.materials[x].platforms (that structure is for truss pillars/beams/rates, not platforms,
// and no material has ever populated it). Omit `material` for every row (used for the combined
// pool's stock total and the blended billing rate); passing a non-platform-material string (e.g.
// "pole") deliberately returns [] rather than silently falling back to the full array.
export const platformsForMaterial = (trussInv, material) => {
  const all = Array.isArray(trussInv?.platforms) ? trussInv.platforms : [];
  if (material == null || material === "") return all;
  const mat = String(material).trim().toLowerCase();
  if (!PLATFORM_MATERIALS.includes(mat)) return [];
  return all.filter((r) => platformMaterialOf(r) === mat);
};

export const platformStockSqft = (trussInv, material) => platformsForMaterial(trussInv, material)
  .reduce((s, r) => s + (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0), 0);

// The combined pool's total stock — Wood + Iron summed. Named separately from platformStockSqft
// (which can also do this via a no-argument call) so call sites reading "the one pool total" say so.
export const platformTotalStockSqft = (trussInv) => platformStockSqft(trussInv);

// Stock-weighted average ₹/sqft — Ambria's own internal cost rate, the same role the old
// Fatta/Stand inventory items' rentalCost played before Platform Config replaced them (2026-11-01
// owner call: platform is no longer tracked via TEN-00008/TEN-00009 at all — see DealCheckOverlay.jsx's
// Tenting rollup). Called with NO material (the billing/cost mode) this blends across every
// configured row regardless of Wood/Iron — there's no per-booking signal for which material a given
// zone's platform actually is, so every zone bills at the same blended rate. A specific material can
// still be asked for (kept for tests/future display), but nothing bills off it any more.
export const platformAvgRatePerSqft = (trussInv, material) => {
  let sqftSum = 0, costSum = 0;
  platformsForMaterial(trussInv, material).forEach((r) => {
    const area = (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0);
    sqftSum += area;
    costSum += area * (Number(r.ratePerSqft) || 0);
  });
  return sqftSum > 0 ? costSum / sqftSum : 0;
};

// Breaks a sqft need into the actual physical pieces a Tenting head would go pull off the rack
// (owner ask 2026-11-23: "we know the sqft needed, we know the sqft of each piece, so why not just
// show pieces"). Platform Config can hold SEVERAL distinct L×W/material rows at once — unlike a truss
// pillar/beam, which is a specific named size a zone's own height band resolves to directly, a
// platform floor is only ever specified as a plain sqft figure (this file's own header comment), so
// there is no single "the" piece size to divide by.
//
// sqftNeeds: one number (a single combined need), or an array — one entry per PHYSICAL FLOOR. Every
// floor is rounded up on ITS OWN (a piece can't be split across two different floors, regression
// review 2026-11-23 finding 2b: pooling every floor into one number before rounding undercounts —
// three 16-sqft floors against only a 32-sqft piece size need 3 pieces, not ceil(48/32)=2). Stock is
// still shared and drawn down ACROSS floors in this one call, in the order given — two floors can't
// both claim the same physical pieces.
//
// Within one floor: largest piece first (fewest pieces, fewest seams), FLOORED at every size except
// the floor's own final remainder (regression review finding 2a: ceiling at every step over-pulls a
// scarce large size when a smaller size could finish the job instead — 101 sqft against a 100-sqft
// and a 16-sqft size must round to one of each, not two of the 100). Once a floor's own remainder
// can't be fully met from any size's remaining real stock, it's still reported against the SMALLEST
// configured size (rounded up) so ops gets a concrete "go get N more of this size" number instead of
// the shortfall silently vanishing — whether that stock genuinely exists is a separate question this
// file's own feasibility check (computePlatformPoolFeasibility) already answers; this is a physical-
// pieces DISPLAY only and never changes what gets billed (platformAvgRatePerSqft's blended rate, and
// every real allocation/feasibility check in this file, are untouched).
//
// Returns [{ id, label, lengthFt, widthFt, material, sqftPerPiece, qty, overStock }], largest first,
// only for sizes actually used (qty > 0). `overStock` is how much of that row's OWN qty goes beyond
// what Config says is really in stock (matched by the row itself, not by `id` — two rows can share an
// id, or have none, regression review finding 2c).
const PIECE_EPS = 1e-6;
export const platformPiecesFor = (sqftNeeds, trussInv) => {
  const floors = (Array.isArray(sqftNeeds) ? sqftNeeds : [sqftNeeds])
    .map((n) => Math.max(0, Number(n) || 0))
    .filter((n) => n > PIECE_EPS);
  const sizes = platformsForMaterial(trussInv, null)
    .map((r, i) => ({ ...r, _row: i, sqftPerPiece: (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) }))
    .filter((r) => (Number(r.lengthFt) || 0) > 0 && (Number(r.widthFt) || 0) > 0 && r.sqftPerPiece > 0)
    .sort((a, b) => b.sqftPerPiece - a.sqftPerPiece);
  if (!floors.length || !sizes.length) return [];
  const labelOf = (r) => (r.label && String(r.label).trim()) || `${r.lengthFt}×${r.widthFt}ft`;
  const smallest = sizes[sizes.length - 1];
  // Real stock, shared and drawn down across every floor this call processes.
  const stockLeft = new Map(sizes.map((r) => [r._row, Math.max(0, Math.floor(Number(r.stock) || 0))]));
  const bySize = new Map(); // _row -> { id, label, …, qty, overStock }
  const entryFor = (r) => bySize.get(r._row) || bySize.set(r._row, { id: r.id, label: labelOf(r), lengthFt: r.lengthFt, widthFt: r.widthFt, material: platformMaterialOf(r), sqftPerPiece: r.sqftPerPiece, qty: 0 }).get(r._row);
  floors.forEach((need) => {
    let remaining = need;
    sizes.forEach((r) => {
      if (remaining <= PIECE_EPS) return;
      const avail = stockLeft.get(r._row) || 0;
      if (avail <= 0) return;
      // Floored, never the floor's full remaining need in one size — a smaller size afterward may
      // finish the job without wasting a scarce larger piece on a fraction it doesn't need.
      const want = Math.floor(remaining / r.sqftPerPiece + PIECE_EPS);
      const used = Math.min(avail, want);
      if (used <= 0) return;
      stockLeft.set(r._row, avail - used);
      entryFor(r).qty += used;
      remaining = Math.max(0, remaining - used * r.sqftPerPiece);
    });
    if (remaining > PIECE_EPS) {
      // This one floor's own final fraction, rounded up to ONE more piece of the smallest configured
      // size — never pooled with a different floor's own leftover fraction. Drawn from whatever real
      // stock of that size is still left; only the part still beyond that is flagged overStock.
      const extra = Math.ceil(remaining / smallest.sqftPerPiece - PIECE_EPS);
      const avail = stockLeft.get(smallest._row) || 0;
      const fromStock = Math.min(avail, extra);
      const over = extra - fromStock;
      stockLeft.set(smallest._row, avail - fromStock);
      const entry = entryFor(smallest);
      entry.qty += extra;
      if (over > 0) entry.overStock = (entry.overStock || 0) + over;
    }
  });
  return sizes.filter((r) => bySize.has(r._row)).map((r) => bySize.get(r._row));
};

// ─── Layer 4.2-equivalent — one event's platform sqft demand, combined pool ──────────────────
// Mirrors trussEngine.js's buildEventAllocation, but the "allocator" here is just arithmetic
// (sqft = L × W × qty) instead of a pillar/beam topology resolve — there's no structural layout to
// compute. A zone only counts if a Height band is actually picked (zc.plH): the same floorDims
// also drives Carpet, and a zone can have Carpet with no Platform at all.
//
// Counts the zone's own row AND every extraPlatformRows entry ("+ Add Platform" in Build) — each
// with its own plH/floorDims/plQty. Confirmed gap this closes (found 2026-11-05): this used to only
// read the zone's single scalar row, while billing (pricing.js's buildPlatformPlan,
// DealCheckOverlay.jsx's Tenting rollup) already counted extra rows — so a zone with more than one
// platform footprint was under-counted here, silently understating real demand.
//
// totalPlatformSqftByMaterial keeps its name/object shape for back-compat with saved
// platform_allocations/platform_overrides/platform_simulations rows, but only ever has ONE key now
// (PLATFORM_POOL_KEY) — see this file's header comment for why there's no real per-material demand
// signal. An OLD saved row with separate iron/pole/aluminium keys still sums correctly everywhere
// via platformEventSqft below, with no data migration needed.
export const buildEventPlatformAllocation = (eventMeta, fnList) => {
  let totalSqft = 0;
  (fnList || []).forEach((fn) => {
    const zones = fn?.zones || {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(zones).forEach(([zoneKey, zc]) => {
      if (!zc) return;
      if (enabledEls && Object.keys(enabledEls).length > 0 && !enabledEls[zoneKey]) return;
      const rows = [zc, ...(Array.isArray(zc.extraPlatformRows) ? zc.extraPlatformRows : [])];
      rows.forEach((row) => {
        if (!row?.plH || isPlatformFoc(row)) return; // no platform picked on this row / FOC: already laid at the venue
        const L = parseFloat(row.floorDims?.L) || 0;
        const W = parseFloat(row.floorDims?.W) || 0;
        const qty = Math.max(1, parseInt(row.plQty, 10) || 1);
        const sqft = L * W * qty;
        if (sqft > 0) totalSqft += sqft;
      });
    });
  });
  const bySqft = totalSqft > 0 ? { [PLATFORM_POOL_KEY]: Math.round(totalSqft * 100) / 100 } : {};
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

// Sums every key of a (possibly OLD-shaped, pre-2026-11-05) totalPlatformSqftByMaterial object into
// one combined-pool number — an old saved {iron, pole, aluminium} split folds into the pool exactly
// the same as a new {all} one, with no data migration needed anywhere this is used.
export const platformEventSqft = (ev) => Object.values(ev?.totalPlatformSqftByMaterial || {}).reduce((s, v) => s + (Number(v) || 0), 0);

// ─── Layer 4.3-equivalent — pool feasibility for one date ───────────────────────────────────
// Same soft/hard priority rule as trussEngine.js's computePoolFeasibility: hard (SOLD) events get
// stock first; soft (draft) events fill in createdAt order; whoever can't fit bears the shortage.
// Demand/stock/overflow stay keyed objects, with exactly one key (PLATFORM_POOL_KEY) — every event
// collapses through platformEventSqft first, so an OLD saved event's {iron, pole, aluminium} split
// sums into the SAME one pool rather than being checked as separate, independent stock buckets
// (which would have let two legacy-keyed events each pass a "fits" check against the full stock
// total instead of sharing it — a real overflow hidden by this file's OWN per-material isolation).
export const computePlatformPoolFeasibility = (eventsForDate, trussInv) => {
  const K = PLATFORM_POOL_KEY;
  const demand = {}, soft = {}, hard = {};
  (eventsForDate || []).forEach(ev => {
    const sqft = platformEventSqft(ev);
    if (sqft <= 0) return;
    demand[K] = (demand[K] || 0) + sqft;
    if (ev.state === "soft") soft[K] = (soft[K] || 0) + sqft;
    else hard[K] = (hard[K] || 0) + sqft;
  });

  const stock = { [K]: Math.round(platformTotalStockSqft(trussInv) * 100) / 100 };

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
    sorted.filter(ev => ev.state === "hard").forEach(ev => { remaining[K] = (remaining[K] || 0) - platformEventSqft(ev); });
    sorted.filter(ev => ev.state === "soft").forEach(ev => {
      const sqft = platformEventSqft(ev);
      if ((remaining[K] || 0) >= sqft - EPS) {
        remaining[K] = (remaining[K] || 0) - sqft;
      } else {
        ev.shortageBorne = true;
      }
    });
    // borne by the newest hard event that actually has platform here (not simply the newest hard event) - same rule as batta / truss
    if ((remaining[K] || 0) < -EPS) {
      const hardSorted = sorted.filter(ev => ev.state === "hard" && platformEventSqft(ev) > 0);
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
// Mirrors trussEngine.js's simulateImpact, but the input is directly {sqft} per row — there's no
// L/W/H/config to resolve into pieces first, since platform demand already IS a plain sqft number
// (see buildEventPlatformAllocation above). A row's `material` (if a stale caller still sends one)
// is ignored — there's one combined pool now, see this file's header comment. No cost estimate:
// platform billing is the zone's own Height-band rate x sqft in Studio Build, not a flat RFT x rate
// like truss, so there's no single rate to estimate cost from here — this stays booking-only, same
// as the rest of the file.
export const simulatePlatformImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
  if (!sim || !trussInv) return null;
  const K = PLATFORM_POOL_KEY;

  const demandSqft = Math.round((sim.zones || []).reduce((s, z) => s + (Number(z.sqft) || 0), 0) * 100) / 100;
  if (demandSqft <= 0) {
    return { status: "gray", reason: "No platform sqft entered", demand: {}, overflow: {}, pressure: 0 };
  }
  const demand = { [K]: demandSqft };

  const realEvents = Array.isArray(dateAlloc?.events) ? dateAlloc.events : [];
  let used = realEvents.reduce((s, ev) => s + platformEventSqft(ev), 0);
  if (sim.mode === "compound" && Array.isArray(otherDrafts)) {
    otherDrafts.forEach(draft => {
      used += Object.values(draft.computed?.demand || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    });
  }

  const totalStock = platformTotalStockSqft(trussInv);
  const remaining = totalStock - used;
  const pressure = totalStock > 0 ? (used + demandSqft) / totalStock : 1;
  let shortageSqft = 0;
  const overflow = {};
  if (demandSqft > remaining) {
    shortageSqft = Math.round((demandSqft - remaining) * 100) / 100;
    overflow[K] = shortageSqft;
  }
  const maxPressure = pressure;

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

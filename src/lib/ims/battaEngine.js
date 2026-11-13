import { supabase } from "../supabase";
import { eoToFnList, isDeptHead, expireStaleSimulations, resolveTrussConfig, buildTopology } from "./trussEngine";

// Batta's date-aware booking, same pool-feasibility/allocation shape as platformEngine.js (see its
// own header comment) — one aggregate RFT pool per truss material, not per-size piece counts,
// since batta is bulk wrap fabric cut to length on site, not discrete stock pieces. Demand per
// event is derived the same way calcZoneTrussPreview (pricing.js) computes it for a single zone —
// pillar RFT + beam RFT, +bufferPct — just grouped by material and summed across every zone in the
// event instead of returning one zone's own number. Billing is untouched by any of this.
export const BATTA_MATERIALS = ["iron", "pole", "aluminium"];

// Resolve which material's pillar/beam ENGINEERING SETTINGS (maxSpanFt, pillarWidthFt) and batta
// pool back a given material — independent per-field fallback to Iron, mirroring
// trussInvForMaterial's (pricing.js) and platformEngine.js's own fallback pattern. Duplicated
// rather than cross-imported for the same reason buildTopology itself is duplicated between
// trussEngine.js and pricing.js (lib/ims doesn't depend on lib/studio).
const engForMaterial = (trussInv, material) => {
  const mat = String(material || "iron").toLowerCase();
  if (mat === "iron") return trussInv?.settings || {};
  const m = trussInv?.materials?.[mat];
  return (m?.settings && Object.keys(m.settings).length > 0) ? m.settings : (trussInv?.settings || {});
};
const battaForMaterial = (trussInv, material) => {
  const mat = String(material || "iron").toLowerCase();
  if (mat === "iron") return trussInv?.batta || {};
  const m = trussInv?.materials?.[mat];
  return m?.batta != null ? m.batta : (trussInv?.batta || {});
};
export const battaStockRft = (trussInv, material) => Number(battaForMaterial(trussInv, material)?.stockRft) || 0;
const battaBufferPct = (trussInv, material) => {
  const b = battaForMaterial(trussInv, material);
  return b?.bufferPct != null ? Number(b.bufferPct) : 10;
};

// Sum of a buildTopology result's pillar heights + beam lengths — the same ideal (pre-stock-
// rounding) RFT total calcZoneTrussPreview bills batta off (actualPillarRft + actualBeamRft).
const topologyRft = (topology) => {
  if (!topology) return 0;
  const pillarRft = (topology.pillars || []).reduce((s, p) => s + (p.H || 0), 0);
  const beamRft = (topology.beams || []).reduce((s, b) => s + (b.lengthFt || 0), 0);
  return pillarRft + beamRft;
};

// ─── One event's batta RFT demand, by material (+ that material's own buffer%) ──────────────
export const buildEventBattaAllocation = (eventMeta, fnList, trussInv) => {
  const byRft = {};
  (fnList || []).forEach((fn) => {
    const zones = fn?.zones || {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(zones).forEach(([zoneKey, zc]) => {
      if (!zc) return;
      if (enabledEls && Object.keys(enabledEls).length > 0 && !enabledEls[zoneKey]) return;
      // Every truss structure in the zone (its own row, plus any "+ Add Truss" extras) — a zone with
      // 2+ truss structures used to only ever bill batta for the first one.
      [zc, ...(zc.extraTrussRows || [])].forEach((row) => {
        // Explicit 0 — a dims-only placeholder, no rental truss actually standing — same exclusion
        // every other consumer already makes (see trussEngine.js's matching guard).
        if (row.trussQty === 0) return;
        const layer0 = resolveTrussConfig(row);
        if (!layer0 || layer0.source === "none" || layer0.source === "invalid") return;
        const mat = String(row.trussMaterial || "iron").toLowerCase();
        const eng = engForMaterial(trussInv, mat);
        const L = parseFloat(row.dims?.L) || 0;
        const W = parseFloat(row.dims?.W) || 0;
        const H = parseFloat(row.dims?.H) || 0;
        const spanFt = layer0.spanFt || (layer0.source === "auto-3dim" ? Math.max(L, W) : 0);
        const backDepth = row.trussBackDepth || eng.defaultBackDepthFt || 4;
        const topology = buildTopology(layer0.config, L, W, H, spanFt, backDepth, eng, undefined, mat);
        // Scaled by THIS row's own Truss Qty — same floor convention as pricing.js's
        // scaleTrussPreview/trussRowCost. Without it, a Truss Qty above 1 under-reserved this zone's
        // real batta RFT demand by the same factor.
        const qty = Math.max(1, Number(row.trussQty) || 1);
        const rft = topologyRft(topology) * qty;
        if (rft <= 0) return;
        const withBuffer = rft * (1 + battaBufferPct(trussInv, mat) / 100);
        byRft[mat] = Math.round(((byRft[mat] || 0) + withBuffer) * 100) / 100;
      });
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
    totalBattaRftByMaterial: byRft,
  };
};

// ─── Pool feasibility for one date — same hard/soft priority rule as truss/platform ──────────
export const computeBattaPoolFeasibility = (eventsForDate, trussInv) => {
  const demand = {}, soft = {}, hard = {};
  (eventsForDate || []).forEach(ev => {
    Object.entries(ev.totalBattaRftByMaterial || {}).forEach(([mat, rft]) => {
      demand[mat] = (demand[mat] || 0) + rft;
      if (ev.state === "soft") soft[mat] = (soft[mat] || 0) + rft;
      else hard[mat] = (hard[mat] || 0) + rft;
    });
  });

  const stock = {};
  BATTA_MATERIALS.forEach(mat => { stock[mat] = battaStockRft(trussInv, mat); });
  Object.keys(demand).forEach(mat => { if (!(mat in stock)) stock[mat] = battaStockRft(trussInv, mat); });

  let feasible = true;
  const overflow = {};
  const EPS = 1e-6;
  Object.entries(demand).forEach(([mat, rft]) => {
    const st = stock[mat] || 0;
    if (rft > st + EPS) { feasible = false; overflow[mat] = Math.round((rft - st) * 100) / 100; }
  });

  const sorted = [...(eventsForDate || [])].sort((a, b) => {
    const ca = a.createdAt || 0, cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return (a.eoId || "").localeCompare(b.eoId || "");
  });
  sorted.forEach(ev => { ev.shortageBorne = false; });

  if (!feasible) {
    const remaining = { ...stock };
    sorted.filter(ev => ev.state === "hard").forEach(ev => {
      Object.entries(ev.totalBattaRftByMaterial || {}).forEach(([mat, rft]) => { remaining[mat] = (remaining[mat] || 0) - rft; });
    });
    sorted.filter(ev => ev.state === "soft").forEach(ev => {
      let fits = true;
      Object.entries(ev.totalBattaRftByMaterial || {}).forEach(([mat, rft]) => { if ((remaining[mat] || 0) < rft - EPS) fits = false; });
      if (fits) {
        Object.entries(ev.totalBattaRftByMaterial || {}).forEach(([mat, rft]) => { remaining[mat] = (remaining[mat] || 0) - rft; });
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

// ─── allocateForDate — full multi-event pool allocator ───────────────────────────────────────
export const allocateBattaForDate = (existingAlloc, date, eventsList, trussInv, trigger) => {
  const out = (existingAlloc && typeof existingAlloc === "object") ? { ...existingAlloc } : {};
  if (!date || !Array.isArray(eventsList) || eventsList.length === 0) {
    delete out[date];
    return out;
  }
  if (!trussInv) {
    // eslint-disable-next-line no-console
    console.warn(`[batta-alloc] allocateBattaForDate(${date}) skipped: trussInv not loaded`);
    return out;
  }
  const summary = computeBattaPoolFeasibility(eventsList, trussInv);
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

// ─── Overrides — department-head manual correction of one event's batta RFT ──────────────────
export const applyBattaOverridesToEvents = (eventsForDate, overrides) => {
  if (!Array.isArray(eventsForDate) || !overrides || typeof overrides !== "object") return eventsForDate;
  return eventsForDate.map(ev => {
    const ovr = overrides[ev.eoId];
    if (!ovr) return ev;
    return {
      ...ev,
      totalBattaRftByMaterial: ovr.totalBattaRftByMaterial || ev.totalBattaRftByMaterial,
      hasOverride: true,
      override: { reason: ovr.reason || "", overrideBy: ovr.overrideBy || "", overrideAt: ovr.overrideAt || null },
    };
  });
};

// ─── Simulator — what-if impact of a hypothetical RFT demand on a date ───────────────────────
export const simulateBattaImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
  if (!sim || !trussInv) return null;

  const demand = {};
  (sim.zones || []).forEach(z => {
    const mat = String(z.material || "iron").toLowerCase();
    const rft = Number(z.rft) || 0;
    if (rft > 0) demand[mat] = Math.round(((demand[mat] || 0) + rft) * 100) / 100;
  });
  if (Object.keys(demand).length === 0) {
    return { status: "gray", reason: "No batta RFT entered", demand: {}, overflow: {}, pressure: 0 };
  }

  const realEvents = Array.isArray(dateAlloc?.events) ? dateAlloc.events : [];
  const used = {};
  realEvents.forEach(ev => {
    Object.entries(ev.totalBattaRftByMaterial || {}).forEach(([mat, rft]) => { used[mat] = (used[mat] || 0) + rft; });
  });
  if (sim.mode === "compound" && Array.isArray(otherDrafts)) {
    otherDrafts.forEach(draft => {
      Object.entries(draft.computed?.demand || {}).forEach(([mat, rft]) => { used[mat] = (used[mat] || 0) + rft; });
    });
  }

  const stock = {};
  BATTA_MATERIALS.forEach(mat => { stock[mat] = battaStockRft(trussInv, mat); });
  Object.keys(demand).forEach(mat => { if (!(mat in stock)) stock[mat] = battaStockRft(trussInv, mat); });

  let shortageRft = 0;
  let maxPressure = 0;
  const overflow = {};
  Object.entries(demand).forEach(([mat, rft]) => {
    const totalStock = stock[mat] || 0;
    const remaining = totalStock - (used[mat] || 0);
    const pressure = totalStock > 0 ? ((used[mat] || 0) + rft) / totalStock : 1;
    if (pressure > maxPressure) maxPressure = pressure;
    if (rft > remaining) {
      const over = Math.round((rft - remaining) * 100) / 100;
      shortageRft += over;
      overflow[mat] = over;
    }
  });

  let status, reason;
  if (shortageRft > 0) { status = "red"; reason = `Shortage of ${shortageRft} RFT — rental needed`; }
  else if (maxPressure > 0.85) { status = "yellow"; reason = `High stock pressure (${Math.round(maxPressure * 100)}% utilization)`; }
  else { status = "green"; reason = `Available · ${Math.round(maxPressure * 100)}% utilization`; }

  return { status, reason, demand, overflow, pressure: Math.round(maxPressure * 100) };
};

// ─── Audit — one INSERT into the batta_audit TABLE (off the blob) ────────────────────────────
export const appendBattaAudit = async (entry) => {
  try {
    await supabase.from("batta_audit").insert({ data: { ts: Date.now(), ...entry } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[batta-alloc] audit append failed:", e?.message || e);
  }
};

export { eoToFnList, isDeptHead, expireStaleSimulations };

// ─── Backfill flag storage key — mirrors platformEngine.js's PLATFORM_BACKFILLED_SK ───────────
export const BATTA_BACKFILLED_SK = "ambria-ims-batta-alloc-backfilled-v1";

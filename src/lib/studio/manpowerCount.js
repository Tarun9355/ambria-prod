// ═══ Shared manpower headcount engine — the ONE implementation of "how many of this crew ═══
// ═══ type does this function need", used everywhere that number is computed:            ═══
//   - DCManpowerTab.jsx (Deal Check's own Manpower tab, salesperson-facing)
//   - DealCheckOverlay.jsx's calcPpl/calcPplRaw (the bottom-bar rollup + IMS Dept Ops sync)
//   - StudioApp.jsx's manpowerPlanForBooking (the booking-confirmation snapshot)
//
// These were three (really four, counting DCManpowerTab's own internal calcPeopleXxx vs
// calcPeopleForType split) hand-rolled copies of the same per-type dispatcher, each with
// comments reading "MUST match DCManpowerTab.calcPeopleXxx exactly" or "mirrors
// calcPplRaw" — a confirmed, repeatedly-drifting duplication. The exact bug that forced
// this extraction: the usage-mode Labours floor compared a function's own need against
// labourUsageTotal (the WHOLE BOOKING's combined usage) instead of that function's own
// share, inflating every function — even a 20-minute puja — to the entire event's crew
// count. The fix landed in one copy and not the other for weeks before being caught.
//
// What stays OUTSIDE this module: the "how was this derived" TRACE/explanation text.
// DCManpowerTab's own trace is a detailed, formula-level breakdown for the salesperson
// who built the deal; DealCheckOverlay's traceOf and StudioApp's manpowerPlanForBooking
// (consumed by IMS Dept Ops' plain-language "how" panels — the latter also snapshotted
// onto the event_order at booking confirmation) are each their own copy of a simplified,
// per-type breakdown for a dept head with no interest in formula notation — legitimately
// different presentations of the same number for different readers, not drift to fix. All
// three read the NUMBER from here, so it can never disagree between them even while the
// explanation stays tailored per audience/file.

import { matchFlowerPattern } from "../ims/flowerHelpers";
import { resolveTrussConfig, calcZoneTrussPreview } from "./pricing";
import { heavyExtraLabour, eventTimingMultFor } from "../ims/constants";
import { standingReductionBySubcat } from "../ims/fixedVenues";
import { itemImsSubcat, lookupBySubcat, walkKitUnits } from "../ims/helpers";

export const shiftToTiming = (shift) => {
  const s = String(shift || "").toLowerCase();
  if (s.includes("morning") || s.includes("brunch")) return "brunch";
  if (s.includes("lunch")) return "lunch";
  if (s.includes("sundowner")) return "sundowner";
  if (s.includes("night")) return "dinner";
  return "dinner";
};

export const sizeFromMode = (inhouseMode, elSize) => {
  if (inhouseMode === "smb") {
    const s = (elSize || "M").toUpperCase();
    if (s === "S") return "small";
    if (s === "B") return "big";
    return "medium";
  }
  return "medium";
};

// A King's-season date needs more crew per role, at that role's own configured pressure
// factor. Returns 1.0 outside a King's date, or for a type with no configured factor.
export const heavySayaMultFor = (fn, type, seasonMap, sitMults) => {
  if ((seasonMap || {})[fn?.fnDate || ""] !== "kings") return 1.0;
  const m = Number(((sitMults || {}).heavySaya || {})[type]);
  return m > 0 ? m : 1.0;
};

// An element's identity for manpower purposes comes ONLY from live IMS — el.invId
// (Inventory) or el.patternId (a pure flower-recipe element). No Rate-Card name-match
// fallback: Rate Card's own `.sub` is a separate, older vocabulary that doesn't track
// IMS's live Sub-Categories master. A kit's own sub-items each carry their OWN cat/sub
// (walkKitUnits visits the kit's own node plus every component), so a stage kit built
// from truss + fabric + lighting sub-parts feeds crew-hours into each of ITS OWN buckets
// instead of all landing under whatever the kit itself happens to be filed as.
export function walkFnElements(fn, dcInventoryCache, cb) {
  const en = fn?.enabledEls || {};
  const ze = fn?.zoneElements || {};
  Object.keys(en).forEach((zk) => {
    if (!en[zk]) return;
    (ze[zk] || []).forEach((el) => {
      const qty = el.qty || 0;
      if (qty <= 0) return;
      if (el.invId) {
        const invItem = (dcInventoryCache || []).find((i) => i.id === el.invId);
        if (invItem) {
          if (Array.isArray(invItem.subItems) && invItem.subItems.length > 0) {
            walkKitUnits(invItem, qty, dcInventoryCache, el.kitOverrides, (node, nodeQty) => {
              cb({ el, rc: { name: node.name, cat: node.cat || node.category || "", sub: node.subCat || node.subcategory || "" }, qty: nodeQty, zoneKey: zk });
            });
          } else {
            cb({ el, rc: { name: invItem.name, cat: invItem.cat || invItem.category || "", sub: invItem.subCat || invItem.subcategory || "" }, qty, zoneKey: zk });
          }
          return;
        }
      }
      if (el.patternId) cb({ el, rc: { name: el.name || "", cat: "florals", sub: "" }, qty, zoneKey: zk });
    });
  });
}

// Fractional need fungible across every matching element, ceiled ONCE at the end —
// ceiling per-element over-counts (each independently-rounded-up fraction adds its own
// slack instead of sharing it).
function peopleFlowerists(fn, ctx) {
  let total = 0;
  walkFnElements(fn, ctx.dcInventoryCache, ({ rc, el, qty }) => {
    if (String(rc.cat || "").toLowerCase() !== "florals") return;
    let pattern = el.patternId ? (ctx.flowerPatterns || []).find((p) => p.id === el.patternId) : null;
    if (!pattern) pattern = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, ctx.flowerPatterns || []);
    if (!pattern) return;
    const sz = pattern.sizes || {};
    const sk = sizeFromMode(pattern?.mode || rc.inhouseMode, el.size);
    let c = sz[sk] || sz.medium;
    if (!c && sk === "big" && sz.large) c = sz.large;
    const upf = Number(c?.unitsPerFlowerist || 0);
    if (upf > 0) total += qty / upf;
  });
  return Math.ceil(total);
}

function peopleElectricians(fn, ctx) {
  let total = 0;
  walkFnElements(fn, ctx.dcInventoryCache, ({ rc, el, qty }) => {
    if (String(rc.cat || "").toLowerCase() !== "lighting") return;
    const prod = (ctx.electricianProd || {})[rc.sub || ""];
    if (!prod) return;
    const sk = sizeFromMode(rc.inhouseMode, el.size);
    const upe = Number(prod.sizes?.[sk]) || Number(prod.sizes?.medium) || 0;
    if (upe > 0) total += qty / upe;
  });
  return Math.ceil(total);
}

function peopleTier2(fn, type, ctx) {
  const cfg = (ctx.labourTiers || {})[type] || { minimum: 1, subCatBatches: {} };
  const batches = cfg.subCatBatches || {};
  const subCounts = {};
  walkFnElements(fn, ctx.dcInventoryCache, ({ rc, qty }) => {
    const sub = itemImsSubcat(rc);
    if (lookupBySubcat(batches, sub) != null) subCounts[sub] = (subCounts[sub] || 0) + qty;
  });
  let need = 0;
  Object.entries(subCounts).forEach(([k, v]) => { need += v / (lookupBySubcat(batches, k) || 3); });
  return Math.max(cfg.minimum || 1, Math.ceil(need));
}

// Venue-min (+ situational multiplier) floor, plus a per-sub-category heavy-element
// add-on, plus a usage-based floor — never fewer than 1 labour per N units of THIS
// function's OWN elements (not the whole booking's combined usage; see this module's own
// top comment for the confirmed bug that fix replaced).
function peopleTier3Labours(fn, ctx) {
  const venueName = fn.fnVenue || "";
  const eventMult = (ctx.eventTypeMultipliers || {})["outdoor_budgeted"] || 1;
  const base = Math.ceil(0 * eventMult); // venue-min floor applied uniformly outside this engine, at fixed venues only
  let situationalMult = 1.0;
  if (!ctx.dcMpIncludeMinusOne) {
    const dumpingLevel = (ctx.venueDumping || {})[venueName] || "nearby";
    const dumpingMult = ({ nearby: 1.0, medium: 1.1, far: 1.2 })[dumpingLevel] || 1.0;
    const candidates = [dumpingMult, heavySayaMultFor(fn, "Labours", ctx.seasonMap, ctx.sitMults)];
    candidates.push(eventTimingMultFor(ctx.eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0));
    situationalMult = Math.min(ctx.situMultCap, Math.max(...candidates, 1.0));
  }
  const adjusted = Math.ceil(base * situationalMult);
  const subCounts = {};
  walkFnElements(fn, ctx.dcInventoryCache, ({ rc, qty }) => { subCounts[itemImsSubcat(rc)] = (subCounts[itemImsSubcat(rc)] || 0) + qty; });
  const fvCfg = { fixedVenues: ctx.fixedVenues || [], venueParents: ctx.venueParents || {} };
  const reduction = standingReductionBySubcat(fvCfg, venueName, ctx.cardsForFn, ctx.inventory || []);
  let heavyExtra = 0;
  (ctx.heavyElementRanges || []).forEach((her) => {
    const count = Math.max(0, (lookupBySubcat(subCounts, her.subCat) || 0) - (lookupBySubcat(reduction, her.subCat) || 0));
    heavyExtra += heavyExtraLabour(her, count);
  });
  let fnUsageTotal = 0;
  const labBatches = {};
  (ctx.heavyElementRanges || []).forEach((her) => { if (her?.subCat && Number(her.perCount) > 0) labBatches[her.subCat] = Number(her.perCount); });
  const labourUsageMode = Object.keys(labBatches).length > 0;
  if (labourUsageMode) Object.keys(subCounts).forEach((sub) => { const b = lookupBySubcat(labBatches, sub); if (b) fnUsageTotal += (subCounts[sub] || 0) / b; });
  return labourUsageMode ? Math.max(adjusted + heavyExtra, Math.ceil(fnUsageTotal)) : (adjusted + heavyExtra);
}

// Top sqft is a per-zone range-table lookup (a canopy is a physical panel, one zone's
// doesn't average against another's). Side-wall RFT (masking, opt-in per zone) + batta
// RFT (wraps every pillar/beam, ALWAYS, regardless of the optional masking toggle) are
// summed across every zone FIRST, then divided by fabricRftPerWorker and ceiled ONCE —
// ceiling each zone's own RFT independently throws away real leftover capacity.
function peopleFabricBangali(fn, ctx) {
  let topTotal = 0, rftTotal = 0;
  const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
  const engBackDepth = Number(ctx.trussInv?.settings?.defaultBackDepthFt) || 4;
  Object.keys(zc).forEach((zk) => {
    if (!en[zk] || !zc[zk]) return;
    const z = zc[zk];
    const cfg = resolveTrussConfig(z);
    if (!cfg || !cfg.config) return;
    const config = cfg.config;
    const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0, dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
    const mw = z.mkWalls || {}, sideDepth = Number(z.trussBackDepth) || engBackDepth;
    let zoneRft = 0;
    if (config === "full_box") {
      const topSqft = dL * dW;
      if (topSqft > 0 && (ctx.fabricBangaliRanges || []).length > 0) {
        for (const r of ctx.fabricBangaliRanges) { if (topSqft <= r.upTo) { topTotal += r.labour || 0; break; } }
      }
      if (z.mkOn) { if (mw.back && dW > 0) zoneRft += dW; if (mw.left && dL > 0) zoneRft += dL; if (mw.right && dL > 0) zoneRft += dL; }
    } else if (config === "half_box") {
      const spanL = cfg.spanFt || dL || dW;
      if (z.mkOn) { if (mw.back && spanL > 0) zoneRft += spanL; if (mw.left && sideDepth > 0) zoneRft += sideDepth; if (mw.right && sideDepth > 0) zoneRft += sideDepth; }
    } else if (config === "u_only") {
      const spanL = cfg.spanFt || dL || dW;
      if (z.mkOn && mw.back && spanL > 0) zoneRft += spanL;
    }
    if (ctx.trussInv) { try { const pv = calcZoneTrussPreview(z, ctx.trussInv); if (pv?.batta?.rftWithBuffer) zoneRft += pv.batta.rftWithBuffer; } catch { /* zone has no resolvable truss preview */ } }
    rftTotal += zoneRft;
  });
  return topTotal + (rftTotal > 0 ? Math.ceil(rftTotal / ctx.fabricRftPerWorker) : 0);
}

// Full zone-derived pillar count (Layer 1 topology), range-table lookup. No reduction for
// a Fixed Venue's standing pillar stock — "standing" means those pillars live in the
// venue's own godown, not that they're already erected; labour still has to put up every
// pillar the event needs, whether it's trucked in fresh or drawn from venue storage.
function peopleTrussLabour(fn, ctx) {
  let pillars = 0;
  if (ctx.trussInv) {
    const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
    Object.keys(zc).forEach((zk) => {
      if (!en[zk] || !zc[zk]) return;
      try { const pv = calcZoneTrussPreview(zc[zk], ctx.trussInv); if (pv?.topology?.pillarCount) pillars += pv.topology.pillarCount; } catch { /* zone has no resolvable truss preview */ }
    });
  }
  if (pillars <= 0 || !(ctx.trussLabourRanges || []).length) return 0;
  for (const r of ctx.trussLabourRanges) { if (pillars <= r.upTo) return r.labour || 0; }
  return ctx.trussLabourRanges[ctx.trussLabourRanges.length - 1]?.labour || 0;
}

function peopleDefault(type) {
  if (type === "Supervisors") return 1;
  return 0;
}

/**
 * The raw per-type headcount, with NO heavySaya multiplier applied yet (Labours/tier-3
 * folds its own situational multiplier in already; every other type's heavySaya wrap is
 * applied by computePeople below).
 */
export function computePeopleRaw(fn, type, ctx) {
  if (type === "Flowerists") return peopleFlowerists(fn, ctx);
  if (type === "Electricians") return peopleElectricians(fn, ctx);
  if (type === "Labours") return peopleTier3Labours(fn, ctx);
  if (type === "Fabric Bangali") return peopleFabricBangali(fn, ctx);
  if (type === "Truss Labour") return peopleTrussLabour(fn, ctx);
  const cfg = (ctx.labourTiers || {})[type];
  if (cfg && cfg.tier === 3) return peopleTier3Labours(fn, ctx);
  if (cfg && cfg.tier === 2) return peopleTier2(fn, type, ctx);
  return peopleDefault(type);
}

/**
 * The final headcount for one crew type on one function — what gets billed. Labours (and
 * anything configured as a generic tier-3 type, which already folds heavySaya internally)
 * and Supervisors/Drivers skip the wrap below so it isn't applied twice.
 *
 * @param {object} fn - the function (ideally already passed through freshFnForManpower —
 *   lib/studio/pricing.js — so repeat zones are already dropped; this engine does not
 *   apply that filtering itself).
 * @param {string} type - the crew type name (e.g. "Flowerists", "Labours", "Truss Labour",
 *   or any admin-configured tier-2/tier-3 type name).
 * @param {object} ctx
 * @param {object[]} ctx.dcInventoryCache
 * @param {object[]} ctx.flowerPatterns
 * @param {object} ctx.electricianProd - sub-category -> productivity config
 * @param {object} ctx.labourTiers - admin-configured tier-2/tier-3 types
 * @param {object} ctx.eventTypeMultipliers
 * @param {object} ctx.eventTimingMultipliers
 * @param {boolean} ctx.dcMpIncludeMinusOne
 * @param {object} ctx.seasonMap - fnDate -> season key
 * @param {object} ctx.sitMults - situational multiplier config (heavySaya, etc.)
 * @param {number} ctx.situMultCap
 * @param {object} ctx.venueDumping - venue name -> "nearby"|"medium"|"far"
 * @param {object[]} ctx.fixedVenues
 * @param {object} ctx.venueParents
 * @param {object[]} ctx.heavyElementRanges
 * @param {object} ctx.cardsForFn - this function's own dcCards entry, for standing-stock netting
 * @param {object[]} ctx.inventory
 * @param {object} ctx.trussInv
 * @param {object[]} ctx.fabricBangaliRanges
 * @param {number} ctx.fabricRftPerWorker
 * @param {object[]} ctx.trussLabourRanges
 */
export function computePeople(fn, type, ctx) {
  const raw = computePeopleRaw(fn, type, ctx);
  const cfg = (ctx.labourTiers || {})[type];
  const isTier3Labours = type === "Labours" || (cfg && cfg.tier === 3);
  if (isTier3Labours || type === "Supervisors" || type === "Drivers" || !(raw > 0)) return raw;
  const m = Math.min(ctx.situMultCap, heavySayaMultFor(fn, type, ctx.seasonMap, ctx.sitMults));
  return m > 1 ? Math.ceil(raw * m) : raw;
}

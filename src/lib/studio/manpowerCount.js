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
import { resolveTrussConfig, calcZoneTrussPreview, calcZoneFabric, scaleTrussPreview } from "./pricing";
import { heavyExtraLabour, eventTimingMultFor } from "../ims/constants";
import { standingReductionBySubcat } from "../ims/fixedVenues";
import { itemImsSubcat, lookupBySubcat, walkKitUnits } from "../ims/helpers";
import { resolveDateCategory } from "../inventory/helpers";
import { poolLabourDept, makeSubcatDept } from "../ims/deptClassify";
import { CARPET_OFF } from "./taxonomy";
import { floorSqftOf } from "./carpetPrefs";

// Tenting's own zone-driven quantities for the Labours usage split (Heavy Element Add-ons' "Truss",
// "Platform" and "Carpet" sub-categories — Truss/Platform 2026-10-28 owner ask, Carpet 2026-11-02
// owner report: it was missing from this table entirely). Unlike every other heavy sub-category,
// none of these three is ever a zone ELEMENT — walkFnElements can't find them — their quantity
// comes from the zone's own truss/platform/carpet config instead: Truss is the same pillar count
// already driving Truss Labour's own range-table lookup (calcZoneTrussPreview); Platform is the
// number of platform PIECES (Build's own "Platform Qty" per row), not sqft or a material count —
// unaffected by Platform's 2026-11-01 move off the Fatta/Stand inventory items onto Platform
// Config's ₹/sqft model (pricing.js's buildPlatformPlan), since this never counted fatta/stand
// pieces to begin with; Carpet is billed sqft (floorSqftOf — the same figure the carpet cost and
// stock checks use, so this can't disagree with either), on EVERY floor row whose cpT isn't the
// explicit OFF sentinel — not gated on plH like Platform's own count just below, since a floor can
// be carpeted with no platform under it at all. Shared by this engine's own usage floor (below) and
// DealCheckOverlay.jsx's per-function department split, so both always agree.
export function tentingZoneUsage(fn, ctx) {
  let truss = 0, platform = 0, carpet = 0;
  const zc = fn?.zoneConfig || {}, en = fn?.enabledEls || {};
  Object.keys(zc).forEach((zk) => {
    if (!en[zk] || !zc[zk]) return;
    const z = zc[zk];
    if (ctx?.trussInv) {
      // Every truss structure in the zone (its own row, plus any "+ Add Truss" extras) — a zone with
      // 2+ truss structures used to only ever count the first one's pillars here. Each scaled by its
      // OWN Truss Qty — without it, raising Truss Qty above 1 in Build never grew the Tenting crew
      // usage count this feeds (DCManpowerTab, DealCheckOverlay's calcPpl, and StudioApp's
      // booking-confirmation manpower snapshot all share this one engine).
      [z, ...(z.extraTrussRows || [])].forEach((row) => {
        try { const pv = scaleTrussPreview(calcZoneTrussPreview(row, ctx.trussInv), row?.trussQty); if (pv?.topology?.pillarCount) truss += pv.topology.pillarCount; } catch { /* zone has no resolvable truss preview */ }
      });
    }
    const rows = [{ plH: z.plH, floorDims: z.floorDims || {}, plQty: z.plQty, cpT: z.cpT }, ...(z.extraPlatformRows || [])];
    rows.forEach((row) => {
      if (row.cpT !== CARPET_OFF) {
        const area = floorSqftOf(row);
        if (area > 0) carpet += area;
      }
      if (!row.plH) return;
      const fd = row.floorDims || {};
      const L = Number(fd.L) || 0, W = Number(fd.W) || 0;
      if (L <= 0 || W <= 0) return;
      platform += Math.max(1, Math.round(Number(row.plQty) || 1));
    });
  });
  return { truss, platform, carpet };
}

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
// A date is King's when the legacy seasonMap says so OR the Calendar's own Date Pricing marks it
// 👑 King's (heavy_saya) — the seasonMap has been empty for months, so on its own this never fired.
export const heavySayaMultFor = (fn, type, seasonMap, sitMults, datePricing) => {
  const date = fn?.fnDate || "";
  const kings = (seasonMap || {})[date] === "kings" || (!!datePricing && !!date && resolveDateCategory(date, { datePricing }) === "heavy_saya");
  if (!kings) return 1.0;
  const m = Number(((sitMults || {}).heavySaya || {})[type]);
  return m > 0 ? m : 1.0;
};

// The situational crew multiplier for one type on one function: the largest of the King's-date
// factor, the shift-timing factor (lunch / brunch / sundowner) and — for Labours — the venue's
// dumping distance, capped (situationalMultiplierCap). Not stacked: the biggest pressure wins.
// A day-prior (−1) setup has no event shift, so timing and dumping skip it; a King's date still counts.
const TIMING_LABEL = { brunch: "Brunch shift", lunch: "Lunch shift", sundowner: "Sundowner shift", dinner: "Dinner shift", latenight: "Late-night shift" };
// The factors behind that multiplier, for the "how" shown to the department head:
// { mult, winner (label of the biggest factor, null when none is above 1), parts: [{ key, label, mult }], cap, capped }.
export function situationalFactorsFor(fn, type, ctx) {
  const cap = Number(ctx.situMultCap) || 1.8;
  if (type === "Labours" && ctx.dcMpIncludeMinusOne) return { mult: 1.0, winner: null, parts: [], cap, capped: false };
  const timingId = shiftToTiming(fn?.fnShift);
  const parts = [{ key: "kings", label: "King's date", mult: heavySayaMultFor(fn, type, ctx.seasonMap, ctx.sitMults, ctx.datePricing) }];
  if (!ctx.dcMpIncludeMinusOne) {
    parts.push({ key: "timing", label: TIMING_LABEL[timingId] || "Shift", mult: eventTimingMultFor(ctx.eventTimingMultipliers, timingId, type, 1.0) });
    if (type === "Labours") {
      const level = (ctx.venueDumping || {})[fn?.fnVenue || ""] || "nearby";
      parts.push({ key: "dumping", label: `Venue ${level}`, mult: ({ nearby: 1.0, medium: 1.1, far: 1.2 })[level] || 1.0 });
    }
  }
  const top = parts.reduce((a, p) => (p.mult > a.mult ? p : a), { mult: 1.0, label: null });
  return { mult: Math.min(cap, Math.max(1.0, top.mult)), winner: top.mult > 1 ? top.label : null, parts, cap, capped: top.mult > cap };
}
export const situationalMultFor = (fn, type, ctx) => situationalFactorsFor(fn, type, ctx).mult;

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
      if (el.foc) return; // left at the venue — no crew needed to move or install it
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
    const candidates = [dumpingMult, heavySayaMultFor(fn, "Labours", ctx.seasonMap, ctx.sitMults, ctx.datePricing)];
    candidates.push(eventTimingMultFor(ctx.eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0));
    situationalMult = Math.min(ctx.situMultCap, Math.max(...candidates, 1.0));
  }
  const adjusted = Math.ceil(base * situationalMult);
  const subCounts = {};
  walkFnElements(fn, ctx.dcInventoryCache, ({ rc, qty }) => { subCounts[itemImsSubcat(rc)] = (subCounts[itemImsSubcat(rc)] || 0) + qty; });
  // Truss pillar count / Platform piece count / Carpet sqft — never a zone element, so
  // walkFnElements above can never find them (see tentingZoneUsage's own comment). Added in here so
  // Tenting's own heavy footprint counts toward this function's usage floor, the same as every
  // other department's.
  const tentingUsage = tentingZoneUsage(fn, ctx);
  if (tentingUsage.truss > 0) subCounts["Truss"] = (subCounts["Truss"] || 0) + tentingUsage.truss;
  if (tentingUsage.platform > 0) subCounts["Platform"] = (subCounts["Platform"] || 0) + tentingUsage.platform;
  if (tentingUsage.carpet > 0) subCounts["Carpet"] = (subCounts["Carpet"] || 0) + tentingUsage.carpet;
  const fvCfg = { fixedVenues: ctx.fixedVenues || [], venueParents: ctx.venueParents || {} };
  const reduction = standingReductionBySubcat(fvCfg, venueName, ctx.cardsForFn, ctx.inventory || [], fn.zoneElements);
  let heavyExtra = 0;
  (ctx.heavyElementRanges || []).forEach((her) => {
    const count = Math.max(0, (lookupBySubcat(subCounts, her.subCat) || 0) - (lookupBySubcat(reduction, her.subCat) || 0));
    heavyExtra += heavyExtraLabour(her, count);
  });
  let fnUsageTotal = 0;
  const labBatches = {};
  (ctx.heavyElementRanges || []).forEach((her) => { if (her?.subCat && Number(her.perCount) > 0) labBatches[her.subCat] = Number(her.perCount); });
  const labourUsageMode = Object.keys(labBatches).length > 0;
  // Each pooled-crew BUCKET's own fractional usage is ceiled SEPARATELY, then summed — not every
  // department's fraction pooled into one total and ceiled once (that would under-count: a department
  // whose own share still needs a WHOLE person on site can't borrow headroom from a different real
  // crew's rounding — owner-reported 2026-10-30, back when Lighting and Structure were separate
  // crews). Which departments share a bucket is poolLabourDept's call (deptClassify.js) — originally
  // just Furniture->Structure/Fabric->Tenting, widened 2026-11-07 (owner decision) to every
  // non-Floral department -> Structure, since that crew is now genuinely one shared team on site, not
  // several specialist ones. Grouped the same way DealCheckOverlay.jsx's own per-function department
  // split already does (poolLabourDept(catToDept(sub))), so the two stay consistent instead of
  // silently disagreeing on the same function's total.
  if (labourUsageMode) {
    const byDept = {};
    // a sub-category's department: its admin map entry / keyword, else its category's (makeSubcatDept) - the same rule Deal
    // Check's split uses, so the two agree (a "Console Table" filed under Floral is Floral's, not the Structure catch-all)
    const subDept = makeSubcatDept(ctx.dcInventoryCache || ctx.inventory || [], ctx.categoryDepartments);
    Object.keys(subCounts).forEach((sub) => {
      const b = lookupBySubcat(labBatches, sub);
      if (!b) return;
      const dp = poolLabourDept(subDept(sub));
      byDept[dp] = (byDept[dp] || 0) + (subCounts[sub] || 0) / b;
    });
    fnUsageTotal = Object.values(byDept).reduce((s, v) => s + Math.ceil(v), 0);
  }
  return labourUsageMode ? Math.max(adjusted + heavyExtra, fnUsageTotal) : (adjusted + heavyExtra);
}

// Top sqft is a per-zone range-table lookup (a canopy is a physical panel, one zone's
// doesn't average against another's). Side-wall RFT (masking, opt-in per zone) is summed
// across every zone FIRST, then divided by fabricRftPerWorker and ceiled ONCE — ceiling each
// zone's own RFT independently throws away real leftover capacity. Truss batta (the wrap round
// every pillar/beam) is NOT counted: Fabric Bangali puts up the fabric only (owner, 2026-10-31).
// One zone's Fabric Bangali work: { config, topSqft, top (canopy labour), rft (running feet of fabric they hang), fabric
// (the zone carries Liza / velvet curtains) }, or null for a zone with no truss. Shared by the crew count below and Studio's
// "how" breakdown (StudioApp), so the two never disagree.
//  - full box: the canopy (top) by the range table, plus each masked wall;
//  - half box / U: each masked wall - and, when the truss carries Liza or velvet curtains, its back span (a half box's two
//    sides too), as that fabric is hung along it (owner report 2026-11-11: an Entertainment Stage U with Liza and curtains
//    but no masking counted no Fabric Bangali at all). A wall that is masked and draped counts once.
export function fabricBangaliZone(z, trussInv, ranges, engBackDepth = 4) {
  const cfg = z ? resolveTrussConfig(z) : null;
  if (!cfg || !cfg.config) return null;
  const config = cfg.config;
  const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0, dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
  const mw = z.mkWalls || {}, sideDepth = Number(z.trussBackDepth) || engBackDepth;
  const masked = (w) => !!(z.mkOn && mw[w]);
  let fabric = false;
  try { const f = calcZoneFabric(z, trussInv, z.drapeDensity); fabric = (Number(f?.lizaKg) || 0) > 0 || (Number(f?.curtainPieces) || 0) > 0; } catch { fabric = false; }
  const topSqft = dL * dW;
  let top = 0;
  // each wall that counts: { wall, ft, basis ("span" / "backDepth" / "W" / "L"), why ("masking" / "fabric") } - for the "how" lines
  const walls = [];
  const add = (wall, ft, basis, counts, maskedOnly = false) => {
    if (!(ft > 0)) return;
    if (masked(wall)) walls.push({ wall, ft, basis, why: "masking" });
    else if (counts && !maskedOnly) walls.push({ wall, ft, basis, why: "fabric" });
  };
  if (config === "full_box") {
    if (topSqft > 0) for (const r of (ranges || [])) { if (topSqft <= r.upTo) { top = r.labour || 0; break; } }
    add("back", dW, "W", false, true); add("left", dL, "L", false, true); add("right", dL, "L", false, true);
  } else if (config === "half_box") {
    const spanL = cfg.spanFt || dL || dW;
    add("back", spanL, "span", fabric); add("left", sideDepth, "backDepth", fabric); add("right", sideDepth, "backDepth", fabric);
  } else if (config === "u_only") {
    add("back", cfg.spanFt || dL || dW, "span", fabric);
  }
  const rft = walls.reduce((t, w) => t + w.ft, 0);
  return { config, spanFt: cfg.spanFt, topSqft, top, rft, fabric, walls };
}

function peopleFabricBangali(fn, ctx) {
  let topTotal = 0, rftTotal = 0;
  const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
  const engBackDepth = Number(ctx.trussInv?.settings?.defaultBackDepthFt) || 4;
  Object.keys(zc).forEach((zk) => {
    if (!en[zk] || !zc[zk]) return;
    const w = fabricBangaliZone(zc[zk], ctx.trussInv, ctx.fabricBangaliRanges, engBackDepth);
    if (!w) return;
    topTotal += w.top; rftTotal += w.rft;
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
      // Every truss structure in the zone, each scaled by its OWN Truss Qty — same reason as
      // tentingZoneUsage above.
      [zc[zk], ...(zc[zk].extraTrussRows || [])].forEach((row) => {
        try { const pv = scaleTrussPreview(calcZoneTrussPreview(row, ctx.trussInv), row?.trussQty); if (pv?.topology?.pillarCount) pillars += pv.topology.pillarCount; } catch { /* zone has no resolvable truss preview */ }
      });
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
 * The final headcount for one crew type on one function — what gets billed: the raw count times
 * the situational multiplier (situationalMultFor — King's date / shift timing / dumping, capped).
 * Supervisors and Drivers have no per-type factors and are returned as is. (Labours' own venue-min
 * floor is applied outside this engine and its multiplier here is on the usage-based count.)
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
  return raw;
  // Situational multiplier (King's date / shift timing / venue dumping) disabled 2026-10-27, owner
  // ask — Deal Check's manpower plan should come straight from Workforce's item-qty batch sizes,
  // rounded up (computePeopleRaw), while a Labours mismatch between Deal Check and the IMS Dept Ops
  // Manpower plan is being verified. situationalFactorsFor/heavySayaMultFor themselves are untouched
  // (still exported, still used by DCManpowerTab/DealCheckOverlay/StudioApp for the "how" trace text),
  // only THIS multiplication of the headcount is turned off. Restore by reverting to:
  // if (type === "Supervisors" || type === "Drivers" || !(raw > 0)) return raw;
  // const m = situationalMultFor(fn, type, ctx);
  // // 1e-9: 5 × 1.2 is 6.000000000000001 in floating point, and ceil would call that 7 people.
  // return m > 1 ? Math.ceil(raw * m - 1e-9) : raw;
}

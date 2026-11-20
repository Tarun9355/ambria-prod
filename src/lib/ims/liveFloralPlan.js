// IMS works out the Floral mandi plan ITSELF, live (owner ask, 2026-11-20: "IMS bhi live update
// hona chahiye").
//
// Until now the plan IMS showed (event_orders.floralPlan / floralDetail) was only ever written by
// Studio, and only while someone had Deal Check open for that deal. A recipe edited in IMS, or a
// deal edited in Build, did not reach the mandi list until the next Deal Check open — the reported
// case: a recipe moved from guldavari ladi to guldavari hanging and Planning kept showing ladi.
//
// This runs the SAME engine Deal Check runs (computeFnFloralCost + buildMandiBreakdown, from
// lib/studio/floralCost.js — never a copy) on the same inputs, read from what IMS already holds live:
//   - the deal's layout per function: event_orders.functionsDetail (Build pushes it on every save —
//     zones, elements, the real/artificial slider, the Flower Palette, overrides, colour picks)
//   - recipes + the mandi catalogue + season map + artificial settings: IMS `settings`
//   - the Rate Card and its sub-category floral modes: rate_card / rate_card_categories
//   - inventory (kits and their floral parts): the inventory table
// Every one of those has its own realtime channel in IMS, so a change to any of them re-runs this.
//
// Returns null when the deal's stored layout can't support a live plan (no function carries any
// zone elements — an order booked before functionsDetail carried them); callers then keep the
// plan Deal Check last pushed, exactly as before.

import { computeFnFloralCost, buildMandiBreakdown, mergeSwapRows } from "../studio/floralCost";
import { resolveMandiFlower } from "./flowerHelpers";

const rnd = (n, p = 100) => Math.round((Number(n) || 0) * p) / p;

// One functionsDetail entry → the function shape the engine reads (StudioApp's collectAllFunctionData).
export function fnFromDetail(f, i, defaultFloralRatio = 70) {
  if (!f || typeof f !== "object") return null;
  return {
    fnIdx: f.fnIdx ?? i,
    fnType: f.type || "",
    fnDate: f.date || "",
    fnVenue: f.venue || "",
    fnShift: f.shift || "",
    fnFlowerPalette: f.flowerPalette || "",
    floralRatio: typeof f.floralRatio === "number" ? f.floralRatio : defaultFloralRatio,
    floralOverrides: f.floralOverrides && typeof f.floralOverrides === "object"
      ? { note: f.floralOverrides.note || "", rows: Array.isArray(f.floralOverrides.rows) ? f.floralOverrides.rows : [] }
      : { note: "", rows: [] },
    zoneElements: f.elements && typeof f.elements === "object" ? f.elements : {},
    enabledEls: f.enabledEls && typeof f.enabledEls === "object" ? f.enabledEls : {},
    zoneConfig: f.zones && typeof f.zones === "object" ? f.zones : {},
  };
}

const hasElements = (fn) => Object.values(fn.zoneElements || {}).some((els) => Array.isArray(els) && els.length > 0);

// rcFloralModeByKey, built the way StudioApp builds it from rate_card_categories rows.
export function floralModesOf(rateCardCategories) {
  const m = {};
  (Array.isArray(rateCardCategories) ? rateCardCategories : []).forEach((r) => { if (r && r.id) m[r.id] = r.floral_mode ?? r.floralMode; });
  return m;
}

export function buildLiveFloralPlan(functionsDetail, { settings = {}, rcItems = [], rateCardCategories = [], inventory = [] } = {}) {
  const details = Array.isArray(functionsDetail) ? functionsDetail : [];
  const defaultRatio = typeof settings.floralRatio === "number" ? settings.floralRatio : 70;
  const fns = details.map((f, i) => fnFromDetail(f, i, defaultRatio)).filter(Boolean);
  if (!fns.length || !fns.some(hasElements)) return null;
  const colorPrefsByFnIdx = {};
  details.forEach((f, i) => { if (f && f.floralColorPrefs && typeof f.floralColorPrefs === "object") colorPrefsByFnIdx[f.fnIdx ?? i] = f.floralColorPrefs; });
  const base = {
    flowerPatterns: Array.isArray(settings.flowerPatterns) ? settings.flowerPatterns : [],
    mandiCatalogue: Array.isArray(settings.mandiCatalogue) ? settings.mandiCatalogue : [],
    mandiMults: (settings.mandiPriceMultipliers && typeof settings.mandiPriceMultipliers === "object") ? settings.mandiPriceMultipliers : { heavy_saya: 1.4, competition: 1.0, non_saya: 0.85 },
    seasonMap: (settings.seasonMap && typeof settings.seasonMap === "object") ? settings.seasonMap : {},
    floralRatio: defaultRatio,
    rcItems: Array.isArray(rcItems) ? rcItems : [],
    rcFloralModeByKey: floralModesOf(rateCardCategories),
    resolveMandiFlower,
    imsInventory: Array.isArray(inventory) ? inventory : [],
    dcInventoryCache: [],
    colorPrefsByFnIdx,
    artFlowerRatePerKg: Number(settings.artificialFlowerRatePerKg ?? 50),
    artFlowerBunchesPerKg: Number(settings.artificialFlowerBunchesPerKg ?? 16) || 16,
    artGreenRatePerKg: Number(settings.artificialGreenRatePerKg ?? 40),
    artGreenBunchesPerKg: Number(settings.artificialGreenBunchesPerKg ?? 23) || 23,
  };
  const byFn = [];
  const floralDetail = {};
  const agg = {};
  fns.forEach((fn) => {
    const r = computeFnFloralCost(fn, fns, { ...base, colorPrefsForFn: colorPrefsByFnIdx[fn.fnIdx] || {} });
    const flowers = buildMandiBreakdown(r.flowerAgg).filter((f) => (Number(f.qty) || 0) > 0);
    if (flowers.length) byFn.push({ fnIdx: fn.fnIdx, fnLabel: fn.fnType || `Function ${fn.fnIdx + 1}`, fnDate: fn.fnDate, fnVenue: fn.fnVenue, flowers });
    // The whole-event list, keyed by name + colour like Deal Check's own floralPlan builder.
    flowers.forEach((f) => {
      const colourKey = f.colorVariant?.label || (Array.isArray(f.colorPrefs) ? f.colorPrefs.map((p) => p.label).join("/") : "") || "";
      const key = colourKey ? `${f.name}¦${colourKey}` : f.name;
      if (!agg[key]) agg[key] = { name: f.name, qty: 0, cost: 0, unit: f.unit, colorVariant: f.colorVariant || null, colorPrefs: f.colorPrefs || null };
      agg[key].qty += f.qty; agg[key].cost += f.cost;
    });
    // The "how" lines per flower — the same fields StudioApp's calcFnFloralDetail pushes as floralDetail[fnIdx].mandi.
    const mandi = Array.from(mergeSwapRows(r.flowerAgg).values()).filter((f) => f.totalQty > 0).map((f) => ({
      name: f.name, unit: f.unit, need: rnd(f.totalQty), buyQty: Math.ceil(f.totalQty), rate: rnd(f.unitPrice),
      contributors: (f.contributors || []).map((c) => ({ el: c.elName, zone: c.zoneKey, elQty: c.elQty, per: rnd(c.perPattern, 1000), qty: rnd(c.contribution), size: c.size, realFrac: c.realFrac })),
    }));
    if (mandi.length) floralDetail[fn.fnIdx] = { fnType: fn.fnType, fnDate: fn.fnDate, mandi };
  });
  const flowers = Object.values(agg).map((f) => ({ ...f, rate: f.qty > 0 ? Math.round((f.cost / f.qty) * 100) / 100 : 0 })).sort((a, b) => b.cost - a.cost);
  return { byFn, flowers, floralDetail };
}

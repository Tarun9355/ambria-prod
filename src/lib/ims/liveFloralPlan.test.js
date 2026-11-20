import { describe, it, expect } from "vitest";
import { buildLiveFloralPlan, fnFromDetail, floralModesOf, mappedPiecesByItem } from "./liveFloralPlan";
import { mapPcsPerUnit, floralPatternUnitRates } from "./flowerHelpers";
import { computeFnFloralCost, buildMandiBreakdown } from "../studio/floralCost";
import { resolveMandiFlower } from "./flowerHelpers";
import { mandiHow } from "./floralHow";

// The reported deal, cut down: "Guldavari + Tussel SQFT" × 144 sq ft at the Vedi, Medium, 50% real.
// Recipe quantities are stored in the mandi unit (guldavari hanging: kg, 3 pcs per kg → 1.1 pcs =
// 0.3667 kg; Rajnitussle: piece).
const hanging = { id: "gh", name: "guldavari hanging", unit: "kg", flowerType: "flower", currentPrice: 250, gattharSize: 3, artificialBunchesPerUnit: 1 };
const ladi = { id: "gl", name: "guldavari ladi", unit: "kg", flowerType: "flower", currentPrice: 200, gattharSize: 5, artificialBunchesPerUnit: 1 };
const tussel = { id: "rt", name: "Rajnitussle", unit: "piece", flowerType: "flower", currentPrice: 40, artificialBunchesPerUnit: 1 };
const recipe = (flowerId) => ({ id: "FP1", name: "Guldavari + Tussel SQFT", mode: "smb", sub: "guldavari tussel sqft", sizes: {
  medium: { flowers: [{ flowerId, qty: 1.1 / 3 }, { flowerId: "rt", qty: 0.4 }] },
} });
const settingsWith = (flowerId) => ({ flowerPatterns: [recipe(flowerId)], mandiCatalogue: [hanging, ladi, tussel], seasonMap: {}, mandiPriceMultipliers: {} });
const detail = (over = {}) => ([{
  fnIdx: 0, type: "Wedding", date: "2026-12-05", venue: "Vedi Farm", shift: "dinner", flowerPalette: "", floralRatio: 50,
  zones: {}, enabledEls: { vedi: true },
  elements: { vedi: [{ name: "Guldavari + Tussel SQFT", patternId: "FP1", qty: 144, size: "M" }] },
  floralOverrides: { rows: [] }, floralColorPrefs: {},
  ...over,
}]);

describe("buildLiveFloralPlan — IMS runs Deal Check's own engine on the deal's stored layout", () => {
  it("the reported case: 0.3667 kg × 144 × 50% = 26.4 kg → 27 whole kg of guldavari hanging", () => {
    const live = buildLiveFloralPlan(detail(), { settings: settingsWith("gh") });
    expect(live.byFn).toHaveLength(1);
    const g = live.byFn[0].flowers.find(f => f.name === "guldavari hanging");
    expect(g.qty).toBe(27);
    expect(live.byFn[0].flowers.find(f => f.name === "Rajnitussle").qty).toBe(29); // 0.4 × 144 × 50% = 28.8
  });

  it("a recipe edit shows at once: switching the recipe's flower to ladi re-plans with ladi, no Deal Check involved", () => {
    const before = buildLiveFloralPlan(detail(), { settings: settingsWith("gh") });
    const after = buildLiveFloralPlan(detail(), { settings: settingsWith("gl") });
    expect(before.byFn[0].flowers.map(f => f.name)).toContain("guldavari hanging");
    expect(after.byFn[0].flowers.map(f => f.name)).toContain("guldavari ladi");
    expect(after.byFn[0].flowers.map(f => f.name)).not.toContain("guldavari hanging");
  });

  it("matches the engine run directly on the same function (no second pricing path)", () => {
    const s = settingsWith("gh");
    const live = buildLiveFloralPlan(detail(), { settings: s });
    const fn = fnFromDetail(detail()[0], 0);
    const direct = buildMandiBreakdown(computeFnFloralCost(fn, [fn], {
      flowerPatterns: s.flowerPatterns, mandiCatalogue: s.mandiCatalogue, mandiMults: {}, seasonMap: {}, floralRatio: 70,
      rcItems: [], rcFloralModeByKey: {}, resolveMandiFlower, imsInventory: [], dcInventoryCache: [], colorPrefsForFn: {}, colorPrefsByFnIdx: {},
    }).flowerAgg);
    expect(live.byFn[0].flowers).toEqual(direct);
  });

  it("feeds the 'how' box: per-pattern 0.367, × 144, × 50% real", () => {
    const live = buildLiveFloralPlan(detail(), { settings: settingsWith("gh") });
    const how = mandiHow(live.floralDetail, "guldavari hanging");
    expect(how.need).toBeCloseTo(26.4, 2);
    expect(how.groups[0].rows[0]).toMatchObject({ elQty: 144, per: 0.37, realFrac: 0.5 });
  });

  it("a Mapping flower's artificial part comes out as a mapped substitute, qty from Build, with the item's id", () => {
    const mappedLadi = { ...ladi, flowerType: "mapping", artificialMapItemId: "inv_art_ladi", artificialMapName: "Old name", artificialMapCost: 10 };
    const s = { ...settingsWith("gl"), mandiCatalogue: [hanging, mappedLadi, tussel] };
    const live = buildLiveFloralPlan(detail(), { settings: s });
    const m = live.floralDetail[0].art.mapped;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ mappedItemId: "inv_art_ladi", realFlowerName: "guldavari ladi", unit: "kg" });
    expect(m[0].qty).toBeCloseTo(26.4, 1); // 0.3667 × 144 × 50% artificial
    expect(m[0].cost).toBe(264); // × ₹10 saved when mapped — the rate Deal Check uses too
    const bigger = buildLiveFloralPlan(detail({ elements: { vedi: [{ name: "Guldavari + Tussel SQFT", patternId: "FP1", qty: 288, size: "M" }] } }), { settings: s });
    expect(bigger.floralDetail[0].art.mapped[0].qty).toBeCloseTo(52.8, 1); // Build's qty doubled → doubled at once
  });

  it("pieces per unit: 26.4 kg × 3 pcs/kg = 79.2 → 80 whole pieces to block and load; cost follows the pieces", () => {
    const mappedLadi = { ...ladi, flowerType: "mapping", artificialMapItemId: "inv_art_ladi", artificialMapCost: 10, artificialMapPcsPerUnit: 3 };
    const s = { ...settingsWith("gl"), mandiCatalogue: [hanging, mappedLadi, tussel] };
    const live = buildLiveFloralPlan(detail(), { settings: s });
    const m = live.floralDetail[0].art.mapped[0];
    expect(m.pcsExact).toBeCloseTo(79.2, 1);
    expect(m.pcs).toBe(80);
    expect(m.cost).toBe(792); // 79.2 pieces × ₹10 a piece
    const fn = fnFromDetail(detail()[0], 0);
    const eb = computeFnFloralCost(fn, [fn], { flowerPatterns: s.flowerPatterns, mandiCatalogue: s.mandiCatalogue, mandiMults: {}, seasonMap: {}, floralRatio: 70, rcItems: [], rcFloralModeByKey: {}, resolveMandiFlower, imsInventory: [], dcInventoryCache: [] }).elementBreakdown;
    expect(mappedPiecesByItem(eb)).toEqual({ inv_art_ladi: 80 }); // what Studio's reconcile reserves in `blocks`
  });

  it("pieces per unit unset = 1, exactly what pricing assumed before (no price moves on its own)", () => {
    expect(mapPcsPerUnit({})).toBe(1);
    expect(mapPcsPerUnit({ artificialMapPcsPerUnit: null })).toBe(1);
    expect(mapPcsPerUnit({ artificialMapPcsPerUnit: 0 })).toBe(1);
    expect(mapPcsPerUnit({ artificialMapPcsPerUnit: 2.5 })).toBe(2.5);
  });

  it("the guest-facing recipe rate multiplies a mapped item's price by its pieces per unit", () => {
    const mapped = (pcs) => ({ id: "gl", name: "guldavari ladi", unit: "kg", flowerType: "mapping", artificialMapItemId: "it1", ...(pcs ? { artificialMapPcsPerUnit: pcs } : {}) });
    const pattern = { id: "P", studioMarkup: 1, sizes: { medium: { flowers: [{ flowerId: "gl", qty: 2 }] } } };
    const inv = [{ id: "it1", price: 50 }];
    const st = { defaultStudioMarkup: 1 };
    expect(floralPatternUnitRates(pattern, "medium", [mapped()], st, inv).artRate).toBe(100); // 2 kg × 1 pc × ₹50
    expect(floralPatternUnitRates(pattern, "medium", [mapped(3)], st, inv).artRate).toBe(300); // 2 kg × 3 pcs × ₹50
  });

  it("maps a stored function the way the engine reads one", () => {
    const fn = fnFromDetail(detail()[0], 0);
    expect(fn).toMatchObject({ fnIdx: 0, fnType: "Wedding", fnDate: "2026-12-05", fnVenue: "Vedi Farm", fnShift: "dinner", floralRatio: 50, enabledEls: { vedi: true } });
    expect(fn.zoneElements.vedi).toHaveLength(1);
    expect(fnFromDetail({ fnIdx: 2 }, 2, 70).floralRatio).toBe(70);
  });

  it("returns null when the stored layout has no elements (an old booking) — the caller keeps Deal Check's plan", () => {
    expect(buildLiveFloralPlan(detail({ elements: {} }), { settings: settingsWith("gh") })).toBeNull();
    expect(buildLiveFloralPlan(undefined, {})).toBeNull();
  });

  it("reads each sub-category's floral mode from rate_card_categories rows", () => {
    expect(floralModesOf([{ id: "a", floral_mode: "real" }, { id: "b", floralMode: "artificial" }, null])).toEqual({ a: "real", b: "artificial" });
  });
});

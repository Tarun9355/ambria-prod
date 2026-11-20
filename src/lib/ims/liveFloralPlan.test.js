import { describe, it, expect } from "vitest";
import { buildLiveFloralPlan, fnFromDetail, floralModesOf } from "./liveFloralPlan";
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

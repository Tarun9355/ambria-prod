import { describe, it, expect } from "vitest";
import { buildLiveFloralPlan, mappedPiecesByItem, fnFromDetail } from "./liveFloralPlan";
import { computeFnFloralCost } from "../studio/floralCost";
import { resolveMandiFlower } from "./flowerHelpers";

// Adversarial checks on IMS's live floral plan (agent2, 2026-11-20).
const ladi = { id: "gl", name: "guldavari ladi", unit: "kg", flowerType: "flower", currentPrice: 200, artificialBunchesPerUnit: 1 };
const rose = { id: "ro", name: "rose", unit: "kg", flowerType: "flower", currentPrice: 300, artificialBunchesPerUnit: 1 };
const recipe = { id: "FP1", name: "Mix", sizes: { medium: { flowers: [{ flowerId: "gl", qty: 1 }, { flowerId: "ro", qty: 1 }] } } };
const fd = (over = {}) => ({
  fnIdx: 0, type: "Wedding", date: "2026-12-05", venue: "Vedi Farm", shift: "dinner", floralRatio: 50,
  zones: {}, enabledEls: { vedi: true },
  elements: { vedi: [{ name: "Mix", patternId: "FP1", qty: 10, size: "M" }] },
  ...over,
});

describe("buildLiveFloralPlan — fallback when IMS has not got the floral catalogue yet", () => {
  it("returns null (keep Deal Check's last plan) while recipes / mandi catalogue are not loaded, instead of an empty live plan", () => {
    // IMS loads settings, mandi_flowers and flower_patterns separately (IMS.jsx applyMandiRows /
    // applyFlowerPatternRows). Until they land, settings has no flowerPatterns / mandiCatalogue. The
    // layout has elements, so the run goes ahead and every element is "Recipe deleted": byFn = [].
    // DepartmentOpsTab then REPLACES fp.byFn with [] — every logged function tab's identity check
    // (ownsStoredEntry) fails and the logged shopping shows as "⚠️ Unmatched" orphan tabs, and the
    // Floral how-box / mapped stock rows vanish, until the catalogue arrives.
    const live = buildLiveFloralPlan([fd()], { settings: {} });
    expect(live).toBeNull();
  });
});

describe("mapped substitutes — two real flowers mapped to the same inventory item", () => {
  it("names every real flower the item stands in for (IMS shows 'ARTIFICIAL FOR …' from realFlowerName)", () => {
    const mLadi = { ...ladi, flowerType: "mapping", artificialMapItemId: "inv1", artificialMapCost: 5 };
    const mRose = { ...rose, flowerType: "mapping", artificialMapItemId: "inv1", artificialMapCost: 5 };
    const settings = { flowerPatterns: [recipe], mandiCatalogue: [mLadi, mRose], seasonMap: {}, mandiPriceMultipliers: {} };
    const live = buildLiveFloralPlan([fd()], { settings, rcItems: [{ id: "rc0", name: "unrelated" }], inventory: [{ id: "inv0", name: "unrelated" }] });
    const mapped = live.floralDetail[0].art.mapped;
    expect(mapped).toHaveLength(1);
    expect(mapped[0].pcs).toBe(10); // 1×10×50% + 1×10×50%
    // Aggregated by item id, but realFlowerName keeps only the first flower — "rose" is never named.
    const names = [mapped[0].realFlowerName, ...(mapped[0].realFlowerNames || [])].join(",");
    expect(names).toContain("rose");
  });

  it("IMS display and Studio reservation agree per function (same ceil)", () => {
    const mLadi = { ...ladi, flowerType: "mapping", artificialMapItemId: "inv1", artificialMapCost: 5, artificialMapPcsPerUnit: 1.3 };
    const settings = { flowerPatterns: [recipe], mandiCatalogue: [mLadi, rose], seasonMap: {}, mandiPriceMultipliers: {} };
    const live = buildLiveFloralPlan([fd()], { settings, rcItems: [{ id: "rc0", name: "unrelated" }], inventory: [{ id: "inv0", name: "unrelated" }] });
    const fn = fnFromDetail(fd(), 0);
    const eb = computeFnFloralCost(fn, [fn], { flowerPatterns: settings.flowerPatterns, mandiCatalogue: settings.mandiCatalogue, mandiMults: {}, seasonMap: {}, rcItems: [], rcFloralModeByKey: {}, resolveMandiFlower, imsInventory: [], dcInventoryCache: [] }).elementBreakdown;
    expect(mappedPiecesByItem(eb)).toEqual({ inv1: live.floralDetail[0].art.mapped[0].pcs }); // 6.5 → 7
  });
});

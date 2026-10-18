import { describe, it, expect } from "vitest";
import { computeFnFloralCost, buildMandiBreakdown, REPEAT_REAL_QTY_MULT, REPEAT_ART_QTY_MULT } from "./floralCost";
import { resolveMandiFlower } from "../ims/flowerHelpers";

// Minimal fixtures shared across tests. A pattern needs just enough shape for
// computePatternSizeCost-free pricing (this module prices flowers at mandiCatalogue's own
// currentPrice directly, not through the recipe's own cost helper).
const rose = { id: "f_rose", name: "Rose", currentPrice: 100, unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2 };
const genda = { id: "f_genda", name: "Genda", currentPrice: 50, unit: "kodi", flowerType: "real_only" };
const mandiCatalogue = [rose, genda];
const pattern = { id: "p1", sub: "Flower Bunch", name: "Flower Bunch", sizes: { medium: { flowers: [{ flowerId: "f_rose", qty: 2 }], extraCost: 0 } } };

const baseOpts = () => ({
  flowerPatterns: [pattern],
  mandiCatalogue,
  mandiMults: {},
  seasonMap: {},
  floralRatio: 70, // 70% artificial / 30% real by default (matches resolveRealPct's fallback)
  rcItems: [],
  rcFloralModeByKey: {},
  resolveMandiFlower,
  imsInventory: [],
  dcInventoryCache: [],
});

const fn = (over) => ({
  fnVenue: "Taj Vivanta", fnDate: "2026-10-19", fnIdx: 0,
  zoneElements: { stage: [{ name: "Flower Bunch", patternId: "p1", qty: 10 }] },
  enabledEls: { stage: true },
  zoneConfig: { stage: {} },
  floralOverrides: { rows: [] },
  ...over,
});

describe("computeFnFloralCost", () => {
  it("splits a plain element by real%/artificial% with no repeat cut", () => {
    const result = computeFnFloralCost(fn(), [fn()], baseOpts());
    // 10 qty × 2 rose/pattern = 20 rose needed. 30% real (floralRatio=70 → real=100-70=30).
    // Real: 20 × 0.3 = 6 kg × ₹100 = ₹600. Artificial: 20 × 0.7 × 2 bunches/unit × (50/16) = …
    expect(result.totalReal).toBeCloseTo(600, 5);
    expect(result.elementBreakdown).toHaveLength(1);
    expect(result.elementBreakdown[0].repeatZone).toBe(false);
  });

  it("cuts real qty ×0.2 and artificial ×0.7 when the zone is manually set to Repeat", () => {
    const repeatFn = fn({ zoneConfig: { stage: { repeat: true } } });
    const result = computeFnFloralCost(repeatFn, [repeatFn], baseOpts());
    expect(result.totalReal).toBeCloseTo(600 * REPEAT_REAL_QTY_MULT, 5);
    expect(result.elementBreakdown[0].repeatZone).toBe(true);
    expect(result.elementBreakdown[0].repeatLabel).toBe("set to Repeat in Build");
  });

  // Regression test for the live bug this module exists to fix: Mehendi (2026-10-19, Taj
  // Vivanta) shared its "stage" zone with Mata Ki Chowki — a same-day, same-venue sibling —
  // and should get the SAME automatic repeat-zone cut a manual toggle would give it, with NO
  // toggle set on Mehendi itself. Before the two engines were unified, one correctly detected
  // this cross-function reuse and the other didn't, showing ₹1,887 vs ₹298 for the same function.
  it("cuts qty automatically when a same-day, same-venue sibling already enabled this zone", () => {
    const mehendi = fn({ fnIdx: 1, fnType: "Mehendi" });
    const mataKiChowki = {
      fnIdx: 0, fnType: "Mata Ki Chowki", fnVenue: "Taj Vivanta", fnDate: "2026-10-19",
      zoneElements: { stage: [{ name: "Something", invId: "x", qty: 1 }] },
      enabledEls: { stage: true },
      zoneConfig: { stage: {} },
    };
    const result = computeFnFloralCost(mehendi, [mataKiChowki, mehendi], baseOpts());
    expect(result.elementBreakdown[0].repeatZone).toBe(true);
    expect(result.elementBreakdown[0].repeatLabel).toMatch(/carried over from Mata Ki Chowki/);
    expect(result.totalReal).toBeCloseTo(600 * REPEAT_REAL_QTY_MULT, 5);
  });

  it("does NOT apply the cross-function cut when no sibling shares the venue or an adjacent date", () => {
    const lonely = fn({ fnVenue: "Solo Venue" });
    const result = computeFnFloralCost(lonely, [lonely], baseOpts());
    expect(result.elementBreakdown[0].repeatZone).toBe(false);
    expect(result.totalReal).toBeCloseTo(600, 5);
  });

  it("keeps a real_only flower at 100% real regardless of the element's blend %, but still applies the repeat cut", () => {
    const gendaPattern = { id: "p2", sub: "Genda String", name: "Genda String", sizes: { medium: { flowers: [{ flowerId: "f_genda", qty: 1 }], extraCost: 0 } } };
    const gendaFn = fn({
      zoneConfig: { stage: { repeat: true } },
      zoneElements: { stage: [{ name: "Genda String", patternId: "p2", qty: 20 }] },
    });
    const result = computeFnFloralCost(gendaFn, [gendaFn], { ...baseOpts(), flowerPatterns: [pattern, gendaPattern] });
    // 20 qty × 1 genda/pattern = 20 kodi at 100% real (real_only) × 0.2 repeat cut = 4 kodi × ₹50 = ₹200.
    expect(result.totalReal).toBeCloseTo(200, 5);
    expect(result.totalArtificial).toBe(0);
  });

  it("charges an inventory-sourced recipe ingredient in full, on the artificial side, with no real/artificial blend applied", () => {
    const potPattern = { id: "p3", sub: "Potted", name: "Potted", sizes: { medium: { flowers: [{ invItemId: "inv1", qty: 1 }], extraCost: 0 } } };
    const invFn = fn({ zoneElements: { stage: [{ name: "Potted", patternId: "p3", qty: 5 }] } });
    const result = computeFnFloralCost(invFn, [invFn], {
      ...baseOpts(), flowerPatterns: [potPattern],
      imsInventory: [{ id: "inv1", name: "Pot", price: 20 }],
    });
    expect(result.totalReal).toBe(0);
    expect(result.totalArtificial).toBeCloseTo(5 * 20, 5); // 5 qty × 1 pot/pattern × ₹20, full price, no blend
  });

  it("expands a kit's floral sub-items into their own priced elements", () => {
    const kitFn = fn({ zoneElements: { stage: [{ name: "Stage Kit", invId: "kit1", qty: 2 }] } });
    const result = computeFnFloralCost(kitFn, [kitFn], {
      ...baseOpts(),
      imsInventory: [{ id: "kit1", name: "Stage Kit", cat: "structure", subItems: [{ itemId: "sub1", qty: 3 }] }, { id: "sub1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" }],
    });
    expect(result.elementBreakdown.some(eb => eb.name === "Round Fibre Pot")).toBe(true);
  });

  it("surfaces an unresolvable floral-looking element as uncosted instead of silently dropping it", () => {
    const mystery = fn({ zoneElements: { stage: [{ name: "Unknown Thing", qty: 1 }] } });
    const result = computeFnFloralCost(mystery, [mystery], baseOpts());
    expect(result.elementBreakdown).toHaveLength(0);
    expect(result.uncosted).toHaveLength(1);
  });

  it("computes billed income only when resolveRcRate is supplied", () => {
    const rc = { name: "Flower Bunch", cat: "florals", sub: "Flower Bunch" };
    const resolveRcRate = () => ({ realRate: 500, artRate: 300 });
    const withIncome = computeFnFloralCost(fn(), [fn()], { ...baseOpts(), rcItems: [rc], resolveRcRate });
    expect(withIncome.income.real).toBeCloseTo(10 * 0.3 * 500, 5);
    expect(withIncome.income.art).toBeCloseTo(10 * 0.7 * 300, 5);
    const withoutIncome = computeFnFloralCost(fn(), [fn()], { ...baseOpts(), rcItems: [rc] });
    expect(withoutIncome.income).toEqual({ real: 0, art: 0 });
  });
});

describe("buildMandiBreakdown", () => {
  it("rounds each flower's fractional need up to a whole purchasable unit, deriving cost from the rounded rate", () => {
    const flowerAgg = new Map([
      ["f_rose", { name: "Rose", totalQty: 5.3, totalCost: 530, unitPrice: 100, unit: "kg" }],
    ]);
    const [row] = buildMandiBreakdown(flowerAgg);
    expect(row.qty).toBe(6); // Math.ceil(5.3)
    expect(row.rate).toBe(100);
    expect(row.cost).toBe(600); // whole-unit qty × rate, not the fractional 530
  });

  it("skips flowers with nothing left to buy", () => {
    const flowerAgg = new Map([["f_rose", { name: "Rose", totalQty: 0, unitPrice: 100, unit: "kg" }]]);
    expect(buildMandiBreakdown(flowerAgg)).toHaveLength(0);
  });
});

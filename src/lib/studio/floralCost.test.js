import { describe, it, expect } from "vitest";
import { computeFnFloralCost, computeFnRawFlowerUsage, buildMandiBreakdown, findImmediatePrecedingFn, FLOWER_REUSE_RATE } from "./floralCost";
import { resolveMandiFlower } from "../ims/flowerHelpers";

// Minimal fixtures. `rose` carries two colour variants so species+colour matching can be
// tested precisely; `marigold` carries its OWN separate "White" variant — a different
// species, same colour — for the "same species AND colour must match" rule.
const rose = {
  id: "rose", name: "Rose", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2,
  colorVariants: [{ variantId: "rose_white", name: "White", currentPrice: 100 }, { variantId: "rose_maroon", name: "Maroon", currentPrice: 110 }],
};
const marigold = {
  id: "marigold", name: "Marigold", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 1,
  colorVariants: [{ variantId: "marigold_white", name: "White", currentPrice: 60 }],
};
const mandiCatalogue = [rose, marigold];

const patternFor = (id, flowerId, qty = 1, extra) => ({ id, sub: "Flower Bunch", sizes: { medium: { flowers: [{ flowerId, qty }], extraCost: 0, ...extra } } });
const pRoseWhite = patternFor("p_rose_white", "rose_white");
const pRoseMaroon = patternFor("p_rose_maroon", "rose_maroon");
const pMarigoldWhite = patternFor("p_marigold_white", "marigold_white");

const baseOpts = (patterns) => ({
  flowerPatterns: patterns, mandiCatalogue, mandiMults: {}, seasonMap: {},
  floralRatio: 70, rcItems: [], rcFloralModeByKey: {}, resolveMandiFlower,
  imsInventory: [], dcInventoryCache: [],
});

// realPct: 100 (pure real, no artificial split) keeps the arithmetic in this file focused on
// the reuse credit itself, matching the owner's own plain "bundles" examples.
const fn = (over) => ({
  fnVenue: "Taj Vivanta", fnDate: "2026-10-19", fnShift: "lunch", fnIdx: 0,
  fnFlowerPalette: "", zoneElements: {}, enabledEls: {}, zoneConfig: {},
  floralOverrides: { rows: [] },
  ...over,
});
const elWhite = (qty) => ({ name: "Rose White", patternId: "p_rose_white", qty, realPct: 100 });
const elMaroon = (qty) => ({ name: "Rose Maroon", patternId: "p_rose_maroon", qty, realPct: 100 });
const elMarigoldWhite = (qty) => ({ name: "Marigold White", patternId: "p_marigold_white", qty, realPct: 100 });

describe("findImmediatePrecedingFn", () => {
  it("picks the nearest earlier same-venue function within a day, not a merged pool", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch" });
    const f2 = fn({ fnIdx: 1, fnShift: "sundowner" });
    const f3 = fn({ fnIdx: 2, fnShift: "dinner" });
    expect(findImmediatePrecedingFn(f3, [f1, f2, f3])).toBe(f2); // nearest, not f1
    expect(findImmediatePrecedingFn(f2, [f1, f2, f3])).toBe(f1);
    expect(findImmediatePrecedingFn(f1, [f1, f2, f3])).toBe(null); // nothing before the first
  });

  it("ignores a different venue even on the same day", () => {
    const f1 = fn({ fnIdx: 0, fnVenue: "Leela", fnShift: "lunch" });
    const f2 = fn({ fnIdx: 1, fnVenue: "Taj Vivanta", fnShift: "dinner" });
    expect(findImmediatePrecedingFn(f2, [f1, f2])).toBe(null);
  });

  it("stops at a gap day", () => {
    const f1 = fn({ fnIdx: 0, fnDate: "2026-10-17" });
    const f2 = fn({ fnIdx: 1, fnDate: "2026-10-19" }); // 2 days later — outside the adjacency window
    expect(findImmediatePrecedingFn(f2, [f1, f2])).toBe(null);
  });
});

describe("computeFnFloralCost — palette-based flower reuse", () => {
  it("0 reuse when the two functions' palettes don't overlap at all", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elMaroon(20)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseMaroon, pRoseWhite]));
    expect(result.overlapColors).toEqual([]);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20); // full price, no credit
  });

  it("credits 70% of the preceding function's own quantity when palettes match (the owner's own example: 10 -> 20 drops to 13)", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(20)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseWhite]));
    const line = result.elementBreakdown[0].realLines[0];
    expect(line.qtyFull).toBe(20);
    expect(line.reuseCredit).toBeCloseTo(10 * FLOWER_REUSE_RATE, 5); // 7
    expect(line.qty).toBeCloseTo(13, 5);
  });

  it("a mixed palette only credits the overlapping colour, not the one the preceding function never had (the owner's own white+maroon example)", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White, Maroon", zoneElements: { stage: [elWhite(10), elMaroon(10)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseWhite, pRoseMaroon]));
    const [whiteLine, maroonLine] = result.elementBreakdown.map((eb) => eb.realLines[0]);
    expect(whiteLine.qty).toBeCloseTo(3, 5); // 10 - 0.7*10
    expect(maroonLine.qty).toBe(10); // no credit — f1 never had maroon
  });

  it("requires the SAME species, not just the same colour — a different flower in the same colour gets no credit", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } }); // Rose White
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elMarigoldWhite(10)] }, enabledEls: { stage: true } }); // Marigold White
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseWhite, pMarigoldWhite]));
    const line = result.elementBreakdown[0].realLines[0];
    expect(line.qty).toBe(10); // colour gate passes, but species differs -> no credit
  });

  it("a manual zone Repeat toggle bypasses the palette gate but still only credits an actual physical match", () => {
    // f2's palette (Maroon) never overlaps f1's (White) — without the toggle this is 0 reuse
    // (covered by the first test above). With the zone manually marked Repeat, f2 should still
    // get 0 credit here because f1 never actually had any Maroon flower at all.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elMaroon(10)] }, enabledEls: { stage: true }, zoneConfig: { stage: { repeat: true } } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseMaroon, pRoseWhite]));
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(10);
    expect(result.elementBreakdown[0].repeatZone).toBe(true); // flagged reused, even though nothing to credit
  });

  it("a manual zone Repeat toggle DOES credit a real physical overlap the palette fields alone wouldn't have declared", () => {
    // f1's own build actually includes some Maroon (qty 5) even though its DECLARED palette is
    // only White — e.g. a small uncatalogued accent. f2's palette is Maroon (no overlap with
    // f1's declared White palette), but its zone is manually marked Repeat.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)], entry: [elMaroon(5)] }, enabledEls: { stage: true, entry: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elMaroon(10)] }, enabledEls: { stage: true }, zoneConfig: { stage: { repeat: true } } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRoseMaroon, pRoseWhite]));
    expect(result.elementBreakdown[0].realLines[0].qty).toBeCloseTo(10 - 0.7 * 5, 5); // 6.5
  });

  it("no reuse at all with no identifiable preceding function, even with a matching palette", () => {
    const f2 = fn({ fnIdx: 0, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f2], baseOpts([pRoseWhite]));
    expect(result.precedingFn).toBe(null);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(10);
  });
});

describe("computeFnFloralCost — core per-element resolution (unaffected by the reuse redesign)", () => {
  const genda = { id: "genda", name: "Genda", currentPrice: 50, unit: "kodi", flowerType: "real_only" };
  const mapped = { id: "mapped_flower", name: "Mapped Flower", currentPrice: 0, unit: "kg", flowerType: "mapping", artificialMapCost: 30, artificialMapName: "Silk Substitute" };
  const pGenda = { id: "p_genda", sub: "Genda String", sizes: { medium: { flowers: [{ flowerId: "genda", qty: 1 }], extraCost: 0 } } };
  const pMapped = { id: "p_mapped", sub: "Mapped Bunch", sizes: { medium: { flowers: [{ flowerId: "mapped_flower", qty: 2 }], extraCost: 0 } } };
  const pPotted = { id: "p_potted", sub: "Potted", sizes: { medium: { flowers: [{ invItemId: "inv1", qty: 1 }], extraCost: 0 } } };

  it("keeps a real_only flower at 100% real regardless of the element's blend %", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Genda String", patternId: "p_genda", qty: 20 }] }, enabledEls: { stage: true } });
    const opts = { ...baseOpts([pGenda]), mandiCatalogue: [...mandiCatalogue, genda], floralRatio: 70 };
    const result = computeFnFloralCost(f, [f], opts);
    // 20 qty x 1 genda/pattern = 20 kodi, 100% real (real_only overrides the 30% blend) x ₹50.
    expect(result.totalReal).toBeCloseTo(20 * 50, 5);
    expect(result.totalArtificial).toBe(0);
  });

  it("prices a mapping flower's artificial side at its configured map cost, not a generic bunch conversion", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Mapped Bunch", patternId: "p_mapped", qty: 5, realPct: 0 }] }, enabledEls: { stage: true } });
    const opts = { ...baseOpts([pMapped]), mandiCatalogue: [...mandiCatalogue, mapped] };
    const result = computeFnFloralCost(f, [f], opts);
    // 5 qty x 2 per pattern x 100% artificial x ₹30 map cost.
    expect(result.totalArtificial).toBeCloseTo(5 * 2 * 30, 5);
  });

  it("charges an inventory-sourced recipe ingredient in full, on the artificial side, with no real/artificial blend applied", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Potted", patternId: "p_potted", qty: 5 }] }, enabledEls: { stage: true } });
    const opts = { ...baseOpts([pPotted]), imsInventory: [{ id: "inv1", name: "Pot", price: 20 }] };
    const result = computeFnFloralCost(f, [f], opts);
    expect(result.totalReal).toBe(0);
    expect(result.totalArtificial).toBeCloseTo(5 * 20, 5);
  });

  it("expands a kit's floral sub-items into their own priced elements", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Stage Kit", invId: "kit1", qty: 2 }] }, enabledEls: { stage: true } });
    const opts = {
      ...baseOpts([pRoseWhite]),
      imsInventory: [{ id: "kit1", name: "Stage Kit", cat: "structure", subItems: [{ itemId: "sub1", qty: 3 }] }, { id: "sub1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" }],
    };
    const result = computeFnFloralCost(f, [f], opts);
    expect(result.elementBreakdown.some((eb) => eb.name === "Round Fibre Pot")).toBe(true);
  });

  it("surfaces an unresolvable floral-looking element as uncosted instead of silently dropping it", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Unknown Thing", qty: 1 }] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f, [f], baseOpts([]));
    expect(result.elementBreakdown).toHaveLength(0);
    expect(result.uncosted).toHaveLength(1);
  });

  it("computes billed income only when resolveRcRate is supplied", () => {
    const rc = { name: "Rose White", cat: "florals", sub: "Flower Bunch" };
    const f = fn({ zoneElements: { stage: [elWhite(10)] }, enabledEls: { stage: true } });
    const resolveRcRate = () => ({ realRate: 500, artRate: 300 });
    const withIncome = computeFnFloralCost(f, [f], { ...baseOpts([pRoseWhite]), rcItems: [rc], resolveRcRate });
    expect(withIncome.income.real).toBeCloseTo(10 * 1 * 500, 5); // realPct:100 on elWhite -> realFrac 1
    const withoutIncome = computeFnFloralCost(f, [f], { ...baseOpts([pRoseWhite]), rcItems: [rc] });
    expect(withoutIncome.income).toEqual({ real: 0, art: 0 });
  });
});

describe("computeFnRawFlowerUsage", () => {
  it("aggregates raw (uncredited) real and artificial need per exact flower id, ignoring reuse entirely", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Rose White", patternId: "p_rose_white", qty: 10, realPct: 30 }] }, enabledEls: { stage: true } });
    const usage = computeFnRawFlowerUsage(f, baseOpts([pRoseWhite]));
    const u = usage.get("rose_white");
    expect(u.realQty).toBeCloseTo(10 * 0.3, 5);
    expect(u.artUnits).toBeCloseTo(10 * 0.7, 5);
  });
});

describe("buildMandiBreakdown", () => {
  it("rounds each flower's fractional need up to a whole purchasable unit, deriving cost from the rounded rate", () => {
    const flowerAgg = new Map([["rose", { name: "Rose", totalQty: 5.3, totalCost: 530, unitPrice: 100, unit: "kg" }]]);
    const [row] = buildMandiBreakdown(flowerAgg);
    expect(row.qty).toBe(6);
    expect(row.rate).toBe(100);
    expect(row.cost).toBe(600);
  });

  it("skips flowers with nothing left to buy", () => {
    const flowerAgg = new Map([["rose", { name: "Rose", totalQty: 0, unitPrice: 100, unit: "kg" }]]);
    expect(buildMandiBreakdown(flowerAgg)).toHaveLength(0);
  });
});

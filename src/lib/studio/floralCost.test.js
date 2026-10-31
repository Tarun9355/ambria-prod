import { describe, it, expect } from "vitest";
import { computeFnFloralCost, computeFnRawFlowerUsage, buildMandiBreakdown, mergeSwapRows, findImmediatePrecedingFn, FLOWER_REUSE_RATE } from "./floralCost";
import { resolveMandiFlower } from "../ims/flowerHelpers";

// Minimal fixtures. Recipes reference a bare SPECIES id only — exactly how real flower patterns
// are built (confirmed against a real production build: every pattern stores `flowerId` as the
// mandi catalogue's own PARENT id, never a colour-variant id). Colour is never part of the
// recipe; it only ever exists as a per-function, per-species preference (colorPrefsForFn /
// colorPrefsByFnIdx below), set through Deal Check's own colour picker — matching how this is
// actually recorded, and why the reuse credit now keys off that instead of the species' own name.
const rose = { id: "rose", name: "Rose", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2 };
const marigold = { id: "marigold", name: "Marigold", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 1 };
const mandiCatalogue = [rose, marigold];

const patternFor = (id, flowerId, qty = 1, extra) => ({ id, sub: "Flower Bunch", sizes: { medium: { flowers: [{ flowerId, qty }], extraCost: 0, ...extra } } });
const pRose = patternFor("p_rose", "rose");
const pMarigold = patternFor("p_marigold", "marigold");

// A single ranked colour pick, shaped the way Deal Check's own picker stores one (see
// DCFloralsTab.jsx's togglePref) — only `.label` is compared.
const pick = (label) => [{ label, rate: 100, variantId: `v_${label}` }];

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
const elRose = (qty) => ({ name: "Rose", patternId: "p_rose", qty, realPct: 100 });
const elMarigold = (qty) => ({ name: "Marigold", patternId: "p_marigold", qty, realPct: 100 });

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
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elRose(20)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRose]));
    expect(result.overlapColors).toEqual([]);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20); // full price, no credit
  });

  it("credits 70% of the preceding function's own quantity when palettes overlap AND both functions picked the same colour for this flower (the owner's own example: 10 -> 20 drops to 13)", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elRose(20)] }, enabledEls: { stage: true } });
    const opts = {
      ...baseOpts([pRose]),
      colorPrefsForFn: { rose: pick("White") }, // f2's own pick for Rose
      colorPrefsByFnIdx: { 0: { rose: pick("White") }, 1: { rose: pick("White") } },
    };
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    const line = result.elementBreakdown[0].realLines[0];
    expect(line.qtyFull).toBe(20);
    expect(line.reuseCredit).toBeCloseTo(10 * FLOWER_REUSE_RATE, 5); // 7
    expect(line.qty).toBeCloseTo(13, 5);
  });

  it("no credit at all when the palette overlaps but neither function has ever picked an explicit colour for this flower", () => {
    // This is the real-world default: recipes never carry colour, and a colour preference is
    // opt-in in Deal Check. Confirmed on a real build — every flower came back uncredited this
    // way until someone actually picks colours for it on both functions.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elRose(20)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRose]));
    expect(result.overlapColors).toEqual(["White"]); // the zone-level gate IS open...
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20); // ...but nobody said what colour Rose actually was
  });

  it("only credits the flower with an actual matching colour pick in both functions, not one the preceding function never had", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White, Maroon", zoneElements: { stage: [elRose(10), elMarigold(10)] }, enabledEls: { stage: true } });
    const opts = {
      ...baseOpts([pRose, pMarigold]),
      colorPrefsForFn: { rose: pick("White"), marigold: pick("Maroon") },
      colorPrefsByFnIdx: { 0: { rose: pick("White") }, 1: { rose: pick("White"), marigold: pick("Maroon") } },
    };
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    const [roseLine, marigoldLine] = result.elementBreakdown.map((eb) => eb.realLines[0]);
    expect(roseLine.qty).toBeCloseTo(3, 5); // 10 - 0.7*10
    expect(marigoldLine.qty).toBe(10); // no credit — f1 never had marigold at all
  });

  it("requires the SAME species, not just a matching colour pick — a different flower in the same colour gets no credit", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } }); // Rose, White
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elMarigold(10)] }, enabledEls: { stage: true } }); // Marigold, White
    const opts = {
      ...baseOpts([pRose, pMarigold]),
      colorPrefsForFn: { marigold: pick("White") },
      colorPrefsByFnIdx: { 0: { rose: pick("White") }, 1: { marigold: pick("White") } },
    };
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    const line = result.elementBreakdown[0].realLines[0];
    expect(line.qty).toBe(10); // colour matches, but species differs -> no credit
  });

  it("a manual zone Repeat toggle bypasses the palette AND colour-pick gate but still only credits an actual physical match", () => {
    // f2's palette (Maroon) never overlaps f1's (White), and neither has picked any explicit
    // colour — without the toggle this is 0 reuse. With the zone manually marked Repeat, f2
    // should still get 0 credit here because f1 never actually had Marigold at all.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elMarigold(10)] }, enabledEls: { stage: true }, zoneConfig: { stage: { repeat: true } } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRose, pMarigold]));
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(10);
    expect(result.elementBreakdown[0].repeatZone).toBe(true); // flagged reused, even though nothing to credit
  });

  it("a manual zone Repeat toggle DOES credit a real physical overlap the palette fields alone wouldn't have declared, with no colour pick needed", () => {
    // f1 built some Marigold (qty 5) in a different zone than its declared palette would suggest.
    // f2's declared palette (Maroon) never overlaps f1's (White), but its zone is manually marked
    // Repeat — the manual toggle finds the real species match without any colour pick at all.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)], entry: [elMarigold(5)] }, enabledEls: { stage: true, entry: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Maroon", zoneElements: { stage: [elMarigold(10)] }, enabledEls: { stage: true }, zoneConfig: { stage: { repeat: true } } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRose, pMarigold]));
    expect(result.elementBreakdown[0].realLines[0].qty).toBeCloseTo(10 - 0.7 * 5, 5); // 6.5
  });

  it("no reuse at all with no identifiable preceding function, even with a matching palette", () => {
    const f2 = fn({ fnIdx: 0, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f2], baseOpts([pRose]));
    expect(result.precedingFn).toBe(null);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(10);
  });
});

describe("computeFnFloralCost — colour defaults from a variant explicitly tagged with the Build's palette", () => {
  // Owner redesign (2026-10-25, final): briefly tried fuzzy-matching a variant's own NAME against
  // the Build's dominant colour (2026-10-20), then a single fixed tag on the PARENT flower instead
  // of its variants (same day) — both reverted. The flower's variants are genuinely different
  // physical colours (Rose comes in red/white/peach/yellow/…), so a single parent-level tag
  // couldn't represent that, and a name-match guess was unreliable. Settled design: each colour
  // VARIANT carries its own explicit "Palette" multi-select (IMS Admin → Mandi Catalogue, flowers
  // only) — a variant can belong to more than one Build palette colour.
  const roseV = {
    id: "roseV", name: "Rose", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2,
    colorVariants: [
      { variantId: "rv_white", name: "White", currentPrice: 120, palette: ["White"] },
      { variantId: "rv_maroon", name: "Maroon", currentPrice: 130, palette: ["Maroon"] },
    ],
  };
  const pRoseV = patternFor("p_roseV", "roseV");
  const optsV = (patterns) => ({ ...baseOpts(patterns), mandiCatalogue: [...mandiCatalogue, roseV] });

  it("credits reuse with NO explicit colour pick at all, purely from a variant tagged with the shared Build palette colour", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 20, realPct: 100 }] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], optsV([pRoseV])); // no colorPrefsForFn/colorPrefsByFnIdx at all
    const line = result.elementBreakdown[0].realLines[0];
    expect(line.qtyFull).toBe(20);
    expect(line.reuseCredit).toBeCloseTo(10 * FLOWER_REUSE_RATE, 5); // same 10 -> 7 credit as an explicit pick
    expect(line.qty).toBeCloseTo(13, 5);
  });

  it("a variant tagged with MULTIPLE palette colours matches on any of them", () => {
    const roseMulti = {
      id: "roseMulti", name: "Rose", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2,
      colorVariants: [{ variantId: "rv_blush", name: "Blush Peach", currentPrice: 120, palette: ["White", "Pastel"] }],
    };
    const pRoseMulti = patternFor("p_roseMulti", "roseMulti");
    const opts = { ...baseOpts([pRoseMulti]), mandiCatalogue: [...mandiCatalogue, roseMulti] };
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "Pastel", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseMulti", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "Pastel", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseMulti", qty: 20, realPct: 100 }] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    expect(result.elementBreakdown[0].realLines[0].reuseCredit).toBeCloseTo(10 * FLOWER_REUSE_RATE, 5);
  });

  it("an explicit Clear-all (stored as []) suppresses the palette default — nobody is assumed to have picked a colour", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 20, realPct: 100 }] }, enabledEls: { stage: true } });
    const opts = { ...optsV([pRoseV]), colorPrefsForFn: { roseV: [] }, colorPrefsByFnIdx: { 0: {}, 1: { roseV: [] } } };
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20); // explicitly cleared -> no credit, default does not reassert
  });

  it("an explicit pick for a DIFFERENT colour than the palette overrides the default entirely", () => {
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseV", qty: 20, realPct: 100 }] }, enabledEls: { stage: true } });
    // f2 explicitly picked Maroon for this flower, overriding the White palette default -> no match against f1's (defaulted) White.
    const opts = { ...optsV([pRoseV]), colorPrefsForFn: { roseV: pick("Maroon") }, colorPrefsByFnIdx: { 0: {}, 1: { roseV: pick("Maroon") } } };
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20);
  });

  it("no default at all when the flower has no colour variants set up in IMS Mandi, even with a matching palette", () => {
    // `rose` (unlike `roseV`) carries no colorVariants — the real-world case for a species IMS
    // hasn't photographed/priced by colour yet. The palette alone must never invent a colour.
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [elRose(20)] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], baseOpts([pRose]));
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20);
  });

  it("no default when a variant exists but isn't tagged with any palette colour at all", () => {
    const roseUntagged = {
      id: "roseUntagged", name: "Rose", unit: "kg", flowerType: "flower", artificialBunchesPerUnit: 2,
      colorVariants: [{ variantId: "rv_white", name: "White", currentPrice: 120 }], // no `.palette`
    };
    const pRoseUntagged = patternFor("p_roseUntagged", "roseUntagged");
    const opts = { ...baseOpts([pRoseUntagged]), mandiCatalogue: [...mandiCatalogue, roseUntagged] };
    const f1 = fn({ fnIdx: 0, fnShift: "lunch", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseUntagged", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const f2 = fn({ fnIdx: 1, fnShift: "dinner", fnFlowerPalette: "White", zoneElements: { stage: [{ name: "Rose", patternId: "p_roseUntagged", qty: 20, realPct: 100 }] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f2, [f1, f2], opts);
    expect(result.elementBreakdown[0].realLines[0].qty).toBe(20); // variant NAME is "White" but untagged -> no credit
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
      ...baseOpts([pRose]),
      imsInventory: [{ id: "kit1", name: "Stage Kit", cat: "structure", subItems: [{ itemId: "sub1", qty: 3 }] }, { id: "sub1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" }],
    };
    const result = computeFnFloralCost(f, [f], opts);
    expect(result.elementBreakdown.some((eb) => eb.name === "Round Fibre Pot")).toBe(true);
  });

  it("a kit's flower recipe follows the deal's EDITED parts, not only the master list", () => {
    // Master: 6 recipes per kit. The deal edited it to 10 — 2 kits must itemise 20, not 12.
    const kit = { id: "kit1", name: "Tree", cat: "tenting", subItems: [{ patternId: "p_rose", qty: 6 }] };
    const opts = { ...baseOpts([pRose]), imsInventory: [kit] };
    const qtyOf = (el) => computeFnFloralCost(fn({ zoneElements: { stage: [el] }, enabledEls: { stage: true } }), [], opts)
      .elementBreakdown.find((eb) => /recipe/.test(eb.name))?.qty;
    expect(qtyOf({ name: "Tree", invId: "kit1", qty: 2 })).toBe(12);
    expect(qtyOf({ name: "Tree", invId: "kit1", qty: 2, kitOverrides: [{ patternId: "p_rose", qty: 10 }] })).toBe(20);
  });

  it("surfaces an unresolvable floral-looking element as uncosted instead of silently dropping it", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Unknown Thing", qty: 1 }] }, enabledEls: { stage: true } });
    const result = computeFnFloralCost(f, [f], baseOpts([]));
    expect(result.elementBreakdown).toHaveLength(0);
    expect(result.uncosted).toHaveLength(1);
  });

  it("ignores a non-floral inventory element entirely, even when its name exactly matches a non-florals Rate Card row", () => {
    // "Warm LED" is a real, resolvable lighting fixture (el.invId -> a lighting-category
    // IMS item) that also happens to share its exact name with a Rate Card row filed under
    // "lighting", not "florals". Neither signal makes it a floral element — it must not show
    // up in elementBreakdown (with a bogus "no IMS pattern" warning) or in uncosted (it was
    // never floral to begin with), and it must not contribute to real/artificial income.
    const f = fn({ zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] }, enabledEls: { stage: true } });
    const rc = { name: "Warm LED", cat: "lighting", sub: "Fairy Lights" };
    const opts = { ...baseOpts([]), rcItems: [rc], imsInventory: [{ id: "led1", name: "Warm LED", cat: "lighting" }] };
    const result = computeFnFloralCost(f, [f], opts);
    expect(result.elementBreakdown).toHaveLength(0);
    expect(result.uncosted).toHaveLength(0);
    expect(result.totalReal).toBe(0);
    expect(result.totalArtificial).toBe(0);
  });

  it("computes billed income only when resolveRcRate is supplied", () => {
    const rc = { name: "Rose", cat: "florals", sub: "Flower Bunch" };
    const f = fn({ zoneElements: { stage: [elRose(10)] }, enabledEls: { stage: true } });
    const resolveRcRate = () => ({ realRate: 500, artRate: 300 });
    const withIncome = computeFnFloralCost(f, [f], { ...baseOpts([pRose]), rcItems: [rc], resolveRcRate });
    expect(withIncome.income.real).toBeCloseTo(10 * 1 * 500, 5); // realPct:100 on elRose -> realFrac 1
    const withoutIncome = computeFnFloralCost(f, [f], { ...baseOpts([pRose]), rcItems: [rc] });
    expect(withoutIncome.income).toEqual({ real: 0, art: 0 });
  });
});

describe("computeFnRawFlowerUsage", () => {
  it("aggregates raw (uncredited) real and artificial need per exact flower id, ignoring reuse entirely", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Rose", patternId: "p_rose", qty: 10, realPct: 30 }] }, enabledEls: { stage: true } });
    const usage = computeFnRawFlowerUsage(f, baseOpts([pRose]));
    const u = usage.get("rose");
    expect(u.realQty).toBeCloseTo(10 * 0.3, 5);
    expect(u.artUnits).toBeCloseTo(10 * 0.7, 5);
  });

  it("resolves each flower's colour from colorPrefsForFn, for the reuse credit to match against", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Rose", patternId: "p_rose", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const usage = computeFnRawFlowerUsage(f, { ...baseOpts([pRose]), colorPrefsForFn: { rose: pick("White") } });
    expect(usage.get("rose").colour).toBe("White");
  });

  it("colour is null when nobody picked one — never assumed", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Rose", patternId: "p_rose", qty: 10, realPct: 100 }] }, enabledEls: { stage: true } });
    const usage = computeFnRawFlowerUsage(f, baseOpts([pRose]));
    expect(usage.get("rose").colour).toBe(null);
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

// Cross-check for the Dept Ops Floral PDF (DepartmentOpsTab zoneDetailPages): when it has no Deal Check snapshot line it works a
// flower line out as recipe qty × piece qty × real share, with real-only flowers at full. These pin that Deal Check's own realLines
// are exactly that, so the PDF and Deal Check cannot drift apart (they did: 2.5 bundles printed where Deal Check said 0.75).
describe("real flower lines — the amount the Dept Ops PDF prints", () => {
  const carnation = { id: "carn", name: "carnation himachal", unit: "bundle", flowerType: "flower", artificialBunchesPerUnit: 4 };
  const fern = { id: "fern", name: "Fern", unit: "bundle", flowerType: "real_only" };
  const cat = [carnation, fern];
  const pot = { id: "p_pot", sub: "Flower Pot", mode: "smb", sizes: { big: { flowers: [{ flowerId: "carn", qty: 1.25 }, { flowerId: "fern", qty: 0.5 }], extraCost: 0 }, medium: { flowers: [{ flowerId: "carn", qty: 0.6 }], extraCost: 0 } } };
  const run = (el) => {
    const f = fn({ zoneElements: { btr: [el] }, enabledEls: { btr: true } });
    const r = computeFnFloralCost(f, [f], { ...baseOpts([pot]), mandiCatalogue: cat });
    const e = r.elementBreakdown.find((x) => x.zoneKey === "btr");
    return Object.fromEntries((e?.realLines || []).map((l) => [l.name, Math.round(l.qty * 100) / 100]));
  };
  it("Terracotta pot, 2 pieces at 30% real: carnation 1.25 × 2 × 0.3 = 0.75 (not 2.5)", () => {
    expect(run({ name: "Terracotta Fibre Pot", patternId: "p_pot", qty: 2, size: "B", realPct: 30 })["carnation himachal"]).toBe(0.75);
  });
  it("a real-only flower stays at its full amount whatever the mix", () => {
    expect(run({ name: "Terracotta Fibre Pot", patternId: "p_pot", qty: 2, size: "B", realPct: 30 }).Fern).toBe(1);
  });
  it("100% real is the whole recipe; 0% real has no real flower but the real-only one", () => {
    expect(run({ name: "Pot", patternId: "p_pot", qty: 2, size: "B", realPct: 100 })["carnation himachal"]).toBe(2.5);
    const art = run({ name: "Pot", patternId: "p_pot", qty: 2, size: "B", realPct: 0 });
    expect(art["carnation himachal"] || 0).toBe(0);
    expect(art.Fern).toBe(1);
  });
  it("the size is the element's own for an S/M/B recipe", () => {
    expect(run({ name: "Pot", patternId: "p_pot", qty: 2, size: "M", realPct: 100 })["carnation himachal"]).toBe(1.2);
  });
});

// Deal Check's mandi swap into a flower the list already has (Morya Patti → dandela, dandela already on the list):
// the swap shows as its own row at the swap's qty and rate, as the swap preview said; buying totals are unchanged.
describe("a swap into a flower already on the list stays its own row", () => {
  const morya = { id: "morya", name: "Morya Patti", unit: "bundle", flowerType: "green", currentPrice: 22 };
  const dandela = { id: "dandela", name: "dandela", unit: "bundle", flowerType: "green", currentPrice: 55 };
  const cat = [morya, dandela];
  const pMix = { id: "p_mix", sub: "Bunch", sizes: { medium: { flowers: [{ flowerId: "morya", qty: 18.75 }, { flowerId: "dandela", qty: 5 }], extraCost: 0 } } };
  const swap = { swapTo: { fromParentId: "morya", fromName: "Morya Patti", toParentId: "dandela", toName: "dandela", toRate: 50, qty: 18.75, isSplit: false } };
  const run = (rows) => {
    const f = fn({ zoneElements: { z: [{ name: "Bunch", patternId: "p_mix", qty: 1, realPct: 100 }] }, enabledEls: { z: true }, floralOverrides: { rows } });
    return computeFnFloralCost(f, [f], { ...baseOpts([pMix]), mandiCatalogue: cat });
  };
  it("dandela's own 5 @ ₹55 and the swap's 18.75 @ ₹50 are two rows (not 23.75 @ a blended ₹51)", () => {
    const { flowerAgg } = run([swap]);
    expect(flowerAgg.has("morya")).toBe(false);
    const own = flowerAgg.get("dandela"), sw = flowerAgg.get("dandela::swap");
    expect(own.totalQty).toBe(5);
    expect(own.unitPrice).toBe(55);
    expect(sw.totalQty).toBe(18.75);
    expect(sw.unitPrice).toBe(50);
    expect(sw.flowerId).toBe("dandela");
    expect(sw._isSwapTarget).toBe(true);
    expect(sw._swapFrom).toEqual(["morya"]);
  });
  it("the buying side still gets one dandela line with the same cost as before", () => {
    const { flowerAgg } = run([swap]);
    const merged = mergeSwapRows(flowerAgg).get("dandela");
    expect(merged.totalQty).toBe(23.75);
    expect(merged.totalCost).toBe(5 * 55 + 18.75 * 50);
    const mandi = buildMandiBreakdown(flowerAgg).find((m) => m.name === "dandela");
    expect(mandi.qty).toBe(24);
  });
  it("a swap into a flower NOT on the list is still the flower's only row", () => {
    const pOnly = { id: "p_only", sub: "Bunch", sizes: { medium: { flowers: [{ flowerId: "morya", qty: 10 }], extraCost: 0 } } };
    const f = fn({ zoneElements: { z: [{ name: "Bunch", patternId: "p_only", qty: 1, realPct: 100 }] }, enabledEls: { z: true }, floralOverrides: { rows: [{ swapTo: { ...swap.swapTo, qty: 10 } }] } });
    const { flowerAgg } = computeFnFloralCost(f, [f], { ...baseOpts([pOnly]), mandiCatalogue: cat });
    expect([...flowerAgg.keys()]).toEqual(["dandela"]);
    expect(flowerAgg.get("dandela").totalQty).toBe(10);
  });
});

describe("a swap between a piece flower and a bundle flower converts by pieces", () => {
  const guldavari = { id: "guld", name: "guldavari star", unit: "piece", flowerType: "flower", currentPrice: 3 };
  const talpalm = { id: "talp", name: "talpalm", unit: "bundle", gattharSize: 25, flowerType: "flower", currentPrice: 150 };
  const fernNoSize = { id: "fern", name: "fern", unit: "bundle", flowerType: "flower", currentPrice: 80 };
  const cat = [guldavari, talpalm, fernNoSize];
  const p = { id: "p_g", sub: "Bunch", sizes: { medium: { flowers: [{ flowerId: "guld", qty: 50 }], extraCost: 0 } } };
  const run = (to) => {
    const f = fn({ zoneElements: { z: [{ name: "Bunch", patternId: "p_g", qty: 1, realPct: 100 }] }, enabledEls: { z: true },
      floralOverrides: { rows: [{ swapTo: { fromParentId: "guld", fromName: "guldavari star", toParentId: to.id, toName: to.name, toRate: to.currentPrice, qty: 50, isSplit: false } }] } });
    return computeFnFloralCost(f, [f], { ...baseOpts([p]), mandiCatalogue: cat });
  };
  it("50 pieces → 2 bundles of a 25-pcs talpalm (not 50 bundles), priced per bundle", () => {
    const r = run(talpalm);
    expect(r.flowerAgg.get("talp").totalQty).toBe(2);
    expect(r.totalReal).toBeCloseTo(2 * 150);
  });
  it("no pcs per bundle set: the qty is left as it was", () => {
    expect(run(fernNoSize).flowerAgg.get("fern").totalQty).toBe(50);
  });
});

import { describe, it, expect } from "vitest";
import { walkKitFloralParts, kitFloralCompDelta } from "./flowerHelpers.js";

describe("walkKitFloralParts — floral content beneath a kit, at any nesting depth", () => {
  it("visits a one-level patternId recipe add-on, qty = kit qty × si.qty", () => {
    const kit = { id: "kit1", name: "Tree", subItems: [{ patternId: "p_rose", qty: 3 }] };
    const seen = [];
    walkKitFloralParts(kit, 2, [kit], null, (node) => seen.push(node));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ patternId: "p_rose", qty: 6, kitParent: "Tree" });
  });

  it("visits EVERY one-level component, florals-category or not — the walker itself does not filter by category; that decision belongs to each consumer (review finding, 2026-11-13, \"F3\": floralCost.js wants florals-category only, kitFloralCompDelta wants whatever its own matchFlowerPattern call succeeds on regardless of category, so the walker can't pre-decide)", () => {
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals" };
    const chandelier = { id: "ch1", name: "Chandelier", cat: "lighting" };
    const kit = { id: "kit1", name: "Tree", subItems: [{ itemId: "pot1", qty: 1 }, { itemId: "ch1", qty: 4 }] };
    const seen = [];
    walkKitFloralParts(kit, 1, [kit, pot, chandelier], null, (node) => seen.push(node));
    expect(seen).toHaveLength(2);
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "pot1", qty: 1, kitParent: "Tree" }),
      expect.objectContaining({ itemId: "ch1", qty: 4, kitParent: "Tree" }),
    ]));
  });

  it("recurses into a NESTED kit (a kit inside a kit) regardless of the nested kit's own category, and keeps the TOP-level kit's name as kitParent throughout (owner report, 2026-11-13: \"if a kit has another kit, the crawlers can miss them too\") — the nested kit itself is ALSO visited as a plain component node, same as any other", () => {
    const console_ = { id: "console1", name: "Console", cat: "structure", subItems: [{ patternId: "p_rose", qty: 4 }, { itemId: "pot1", qty: 1 }] };
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals" };
    const tree = { id: "kit1", name: "Tree", cat: "tenting", subItems: [{ itemId: "console1", qty: 2 }] };
    const seen = [];
    walkKitFloralParts(tree, 3, [tree, console_, pot], null, (node) => seen.push(node));
    // 3 Trees × 2 Consoles = 6 Consoles themselves; × 4 recipe units = 24; × 1 pot = 6
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "console1", qty: 6, kitParent: "Tree" }),
      expect.objectContaining({ patternId: "p_rose", qty: 24, kitParent: "Tree" }),
      expect.objectContaining({ itemId: "pot1", qty: 6, kitParent: "Tree" }),
    ]));
    expect(seen).toHaveLength(3);
  });

  it("goes arbitrarily deep (kit inside kit inside kit), not just 2 levels — every intermediate kit node is visited too, plus the recipe at the bottom", () => {
    const grandchild = { id: "gc1", name: "Grandchild", subItems: [{ patternId: "p_rose", qty: 1 }] };
    const child = { id: "c1", name: "Child", subItems: [{ itemId: "gc1", qty: 2 }] };
    const top = { id: "t1", name: "Top", subItems: [{ itemId: "c1", qty: 2 }] };
    const seen = [];
    walkKitFloralParts(top, 1, [top, child, grandchild], null, (node) => seen.push(node));
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "c1", qty: 2, kitParent: "Top" }),
      expect.objectContaining({ itemId: "gc1", qty: 4, kitParent: "Top" }),
      expect.objectContaining({ patternId: "p_rose", qty: 4, kitParent: "Top" }),
    ]));
    expect(seen).toHaveLength(3);
  });

  it("a cycle (a kit that loops back to an ancestor) does not infinite-loop", () => {
    const a = { id: "a1", name: "A", subItems: [{ itemId: "b1", qty: 1 }] };
    const b = { id: "b1", name: "B", subItems: [{ itemId: "a1", qty: 1 }] }; // B points back to A
    expect(() => walkKitFloralParts(a, 1, [a, b], null, () => {})).not.toThrow();
  });

  it("el.kitOverrides (the deal's own edit) replaces the master subItems, same as the un-nested case always honored", () => {
    const kit = { id: "kit1", name: "Tree", subItems: [{ patternId: "p_rose", qty: 6 }] };
    const seen = [];
    walkKitFloralParts(kit, 2, [kit], [{ patternId: "p_rose", qty: 10 }], (node) => seen.push(node));
    expect(seen[0].qty).toBe(20); // 2 × 10, not 2 × 6
  });

  it("a kit with no subItems at all, and no overrides either, visits nothing and does not throw", () => {
    expect(() => walkKitFloralParts(null, 1, [], null, () => { throw new Error("should not be called"); })).not.toThrow();
    expect(() => walkKitFloralParts({ id: "x", name: "X" }, 1, [], null, () => { throw new Error("should not be called"); })).not.toThrow();
  });

  it("a NESTED kit whose MASTER subItems is empty but whose subOverrides carries a live recipe is still walked — same nested-depth gap as the F1 top-level rule (review finding, 2026-11-13)", () => {
    const console_ = { id: "console1", name: "Console", subItems: [] }; // master has nothing
    const tree = { id: "kit1", name: "Tree", subItems: [{ itemId: "console1", qty: 2, subOverrides: [{ patternId: "p_rose", qty: 5 }] }] };
    const seen = [];
    walkKitFloralParts(tree, 2, [tree, console_], null, (node) => seen.push(node));
    // 2 Trees × 2 Consoles (visited as a plain node) + the override's own recipe: 2×2×5 = 20
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "console1", qty: 4, kitParent: "Tree" }),
      expect.objectContaining({ patternId: "p_rose", qty: 20, kitParent: "Tree" }),
    ]));
    expect(seen).toHaveLength(2);
  });

  it("a NULL item (a kit deleted from the catalogue) still walks when overrideSubItems is given — the deal's own edit of a since-deleted kit must still surface its recipe (review finding, 2026-11-13, \"F1\": this used to bail out immediately on a null item, regressing a 2026-11-12 fix that specifically required this to keep working)", () => {
    const seen = [];
    walkKitFloralParts(null, 2, [], [{ patternId: "p_rose", qty: 5 }], (node) => seen.push(node), "Tree (deleted)");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ patternId: "p_rose", qty: 10, kitParent: "Tree (deleted)" });
  });
});

describe("kitFloralCompDelta — a kit's own plain floral components, including a NESTED kit's", () => {
  const pRoseBunch = { id: "p_rose_bunch", sub: "Flower Bunch", sizes: { medium: { flowers: [{ flowerId: "rose", qty: 1 }], extraCost: 0 } } };
  const mandiCatalogue = [{ id: "rose", name: "Rose", unit: "kg", currentPrice: 100 }];
  const floralSettings = { mandiCatalogue, defaultStudioMarkup: 1, artificialFlowerRatePerKg: 50, artificialFlowerBunchesPerKg: 16, artificialGreenRatePerKg: 40, artificialGreenBunchesPerKg: 23 };

  it("prices a one-level floral component (matches the pre-existing, un-nested behavior)", () => {
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" };
    const delta = kitFloralCompDelta({
      comps: [{ itemId: "pot1", qty: 2 }], inventory: [pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: { "flower bunch": "real" }, floralRatio: 70,
    });
    expect(delta).toBeGreaterThan(0);
  });

  it("ignores a plain non-floral component and a patternId add-on (priced separately, not here)", () => {
    const chandelier = { id: "ch1", name: "Chandelier", cat: "lighting" };
    const delta = kitFloralCompDelta({
      comps: [{ itemId: "ch1", qty: 1 }, { patternId: "p_rose_bunch", qty: 1 }], inventory: [chandelier], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: {}, floralRatio: 70,
    });
    expect(delta).toBe(0);
  });

  it("also prices a NESTED kit's own floral component — a console inside Tree, with its own floral pot inside IT (owner report, 2026-11-13: nested-kit floral content missing from the guest's bill)", () => {
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" };
    const console_ = { id: "console1", name: "Console", cat: "structure", subItems: [{ itemId: "pot1", qty: 1 }] };
    const oneLevel = kitFloralCompDelta({
      comps: [{ itemId: "pot1", qty: 1 }], inventory: [pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: { "flower bunch": "real" }, floralRatio: 70,
    });
    const nested = kitFloralCompDelta({
      comps: [{ itemId: "console1", qty: 1 }], inventory: [console_, pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: { "flower bunch": "real" }, floralRatio: 70,
    });
    // The nested console's own pot prices the SAME as a direct one at the same qty - it was ₹0
    // before this fix (the console's own subItems were never walked at all).
    expect(nested).toBeCloseTo(oneLevel, 5);
    expect(nested).toBeGreaterThan(0);
  });

  it("a nested component's own realPct pin (set via the parent's subOverrides) is honoured, not dropped to the mode default (review finding, 2026-11-13, \"F3\": this used to pass undefined regardless of what the nested sub-item's own override said)", () => {
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" };
    const console_ = { id: "console1", name: "Console", cat: "structure", subItems: [{ itemId: "pot1", qty: 1 }] };
    // No rcFloralModeByKey entry for "flower bunch" here, so the mode default is globalReal =
    // 100 - floralRatio = 30% — distinct from the realPct: 100 pin used below, so a real
    // difference in the computed delta proves the pin was actually read, not ignored.
    const noOverride = kitFloralCompDelta({
      comps: [{ itemId: "console1", qty: 1 }], inventory: [console_, pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: {}, floralRatio: 70,
    });
    const withOverride = kitFloralCompDelta({
      comps: [{ itemId: "console1", qty: 1, subOverrides: [{ itemId: "pot1", qty: 1, realPct: 100 }] }],
      inventory: [console_, pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: {}, floralRatio: 70,
    });
    const direct100 = kitFloralCompDelta({
      comps: [{ itemId: "pot1", qty: 1, realPct: 100 }], inventory: [pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: {}, floralRatio: 70,
    });
    expect(withOverride).not.toBeCloseTo(noOverride, 2);
    expect(withOverride).toBeCloseTo(direct100, 5);
  });

  it("a nested kit whose master subItems is empty but whose subOverrides carries a floral component is still priced (same nested-depth gating fix as walkKitFloralParts, 2026-11-13)", () => {
    const pot = { id: "pot1", name: "Round Fibre Pot", cat: "florals", subCat: "Flower Bunch" };
    const console_ = { id: "console1", name: "Console", cat: "structure", subItems: [] }; // master has nothing
    const direct = kitFloralCompDelta({
      comps: [{ itemId: "pot1", qty: 1 }], inventory: [pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: { "flower bunch": "real" }, floralRatio: 70,
    });
    const viaOverride = kitFloralCompDelta({
      comps: [{ itemId: "console1", qty: 1, subOverrides: [{ itemId: "pot1", qty: 1 }] }],
      inventory: [console_, pot], flowerPatterns: [pRoseBunch],
      mandiCatalogue, floralSettings, rcFloralModeByKey: { "flower bunch": "real" }, floralRatio: 70,
    });
    expect(viaOverride).toBeCloseTo(direct, 5);
    expect(viaOverride).toBeGreaterThan(0);
  });
});

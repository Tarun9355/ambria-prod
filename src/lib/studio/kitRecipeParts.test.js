import { describe, it, expect } from "vitest";
import { kitRecipeParts } from "./kitRecipeParts.js";

const patterns = [
  { id: "FP2", name: "Flower Trail", unit: "rft", sizes: { B: { img: "trail.jpg" } } },
  { id: "FP9", name: "Flower Bunch", unit: "pc" },
];
// The Tree kit: a chandelier (inventory) plus two flower recipes.
const tree = [{ itemId: "I67B82CC6A8", qty: 4 }, { patternId: "FP2", qty: 6 }, { patternId: "FP9", qty: 15 }];

describe("kitRecipeParts — the flowers inside a kit, for the Dept PDF's kit page", () => {
  it("names each recipe with its quantity across all kits (2 kits: 12 rft of trail, 30 bunches)", () => {
    expect(kitRecipeParts(tree, patterns, 2)).toEqual([
      { name: "Flower Trail", qty: 12, uom: "rft", photo: "trail.jpg", patternId: "FP2" },
      { name: "Flower Bunch", qty: 30, uom: "pc", photo: "", patternId: "FP9" },
    ]);
  });
  it("leaves inventory parts out — they have their own component rows", () => {
    expect(kitRecipeParts([{ itemId: "I1", qty: 4 }], patterns, 2)).toEqual([]);
  });
  it("a recipe the pattern list no longer has still shows, by a generic name", () => {
    expect(kitRecipeParts([{ patternId: "GONE", qty: 3 }], patterns, 1)).toMatchObject([{ name: "Flower recipe", qty: 3 }]);
  });
  it("no kits, or no patterns list, or no parts: nothing and no crash", () => {
    expect(kitRecipeParts(tree, patterns, 0)).toEqual([]);
    expect(kitRecipeParts(tree, undefined, 1).map(r => r.name)).toEqual(["Flower recipe", "Flower recipe"]);
    expect(kitRecipeParts(undefined, patterns, 2)).toEqual([]);
  });
});

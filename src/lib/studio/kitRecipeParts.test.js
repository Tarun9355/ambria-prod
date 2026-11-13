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
  it("a recipe the LOADED pattern list no longer has is dropped — it was deleted from the Flower Patterns library (owner decision, 2026-11-12: deleted patterns are gone everywhere, not listed as a generic placeholder ops would still be told to pull flowers for)", () => {
    expect(kitRecipeParts([{ patternId: "GONE", qty: 3 }], patterns, 1)).toEqual([]);
  });
  it("no kits, or no parts: nothing and no crash", () => {
    expect(kitRecipeParts(tree, patterns, 0)).toEqual([]);
    expect(kitRecipeParts(undefined, patterns, 2)).toEqual([]);
  });
  it("patterns list not loaded yet (undefined, not just empty): still shows a generic placeholder rather than silently dropping the row while data catches up", () => {
    expect(kitRecipeParts(tree, undefined, 1).map(r => r.name)).toEqual(["Flower recipe", "Flower recipe"]);
  });

  it("finds a NESTED kit's own recipe too, when given the inventory list (owner report, 2026-11-13: \"if a kit has another kit, the crawlers can miss them too\") — and stays exactly as before when inventory is omitted", () => {
    const console_ = { id: "console1", subItems: [{ patternId: "FP9", qty: 3 }] };
    const treeWithNestedConsole = [{ itemId: "console1", qty: 2 }];
    // Omitted inventory: unchanged behaviour, the nested kit's own recipe is invisible (old gap).
    expect(kitRecipeParts(treeWithNestedConsole, patterns, 2)).toEqual([]);
    // With inventory: 2 Trees × 2 Consoles × 3 per-console = 12 bunches, found and named correctly.
    expect(kitRecipeParts(treeWithNestedConsole, patterns, 2, [console_])).toEqual([
      { name: "Flower Bunch", qty: 12, uom: "pc", photo: "", patternId: "FP9" },
    ]);
  });

  it("honours the deal's own edit of the NESTED kit's recipe (cp.subOverrides), not just its master subItems (review finding, 2026-11-13, \"F4\": this used to pass a bare undefined, ignoring a per-deal edit two levels down)", () => {
    const console_ = { id: "console1", subItems: [{ patternId: "FP9", qty: 3 }] }; // master: 3/console
    const editedConsole = [{ itemId: "console1", qty: 2, subOverrides: [{ patternId: "FP9", qty: 10 }] }]; // edited to 10/console
    // 1 Tree × 2 Consoles × 10 (edited, not the master's 3) = 20 bunches.
    expect(kitRecipeParts(editedConsole, patterns, 1, [console_])).toEqual([
      { name: "Flower Bunch", qty: 20, uom: "pc", photo: "", patternId: "FP9" },
    ]);
  });

  it("finds a nested kit's recipe via subOverrides even when the master subItems is empty — same nested-depth gap as F4, just with nothing at all on the master side (review finding, 2026-11-13)", () => {
    const emptyConsole = { id: "console1", subItems: [] };
    const editedEmptyConsole = [{ itemId: "console1", qty: 2, subOverrides: [{ patternId: "FP9", qty: 3 }] }];
    expect(kitRecipeParts(editedEmptyConsole, patterns, 2, [emptyConsole])).toEqual([
      { name: "Flower Bunch", qty: 12, uom: "pc", photo: "", patternId: "FP9" },
    ]);
  });
});

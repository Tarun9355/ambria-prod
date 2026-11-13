import { describe, it, expect } from "vitest";
import { realLineTaker, fullRecipeLines } from "./floralBook.js";
import { buildEventSwap } from "./mandiSwap.js";

const realZones = [
  { zone: "btr", el: "Terracotta Fibre Pot", lines: [{ name: "carnation himachal", qty: 0.75, unit: "bundle" }, { name: "gypso", qty: 0.6, unit: "bundle" }] },
  { zone: "btr", el: "Flower Bunch", lines: [{ name: "carnation himachal", qty: 0.045, unit: "bundle" }] },
  // the same arrangement on two rows of the zone (two Build rows) - summed into one card
  { zone: "stage", el: "Flower Bunch", lines: [{ name: "Morya Patti", qty: 0.6, unit: "bundle" }] },
  { zone: "stage", el: "flower bunch ", lines: [{ name: "Morya Patti", qty: 0.6, unit: "bundle" }, { name: "Fern", qty: 1, unit: "bundle" }] },
];

describe("realLineTaker — the Floral PDF prints Deal Check's real flower lines", () => {
  it("gives an arrangement exactly Deal Check's lines for its zone", () => {
    const t = realLineTaker(realZones, "btr", new Map());
    expect(t.has("Terracotta Fibre Pot")).toBe(true);
    expect(t.take("Terracotta Fibre Pot")).toEqual([{ name: "carnation himachal", qty: 0.75, unit: "bundle" }, { name: "gypso", qty: 0.6, unit: "bundle" }]);
    // another zone's rows never leak in
    expect(t.take("Flower Bunch")).toEqual([{ name: "carnation himachal", qty: 0.05, unit: "bundle" }]);
  });
  it("sums the rows of one arrangement in a zone, matched without case or spaces", () => {
    const t = realLineTaker(realZones, "stage", new Map());
    expect(t.take("Flower Bunch")).toEqual([{ name: "Morya Patti", qty: 1.2, unit: "bundle" }, { name: "Fern", qty: 1, unit: "bundle" }]);
  });
  it("hands the lines out once — a second card of the same name gets none, not a copy", () => {
    const t = realLineTaker(realZones, "stage", new Map());
    t.take("Flower Bunch");
    expect(t.has("Flower Bunch")).toBe(true);
    expect(t.take("Flower Bunch")).toEqual([]);
  });
  it("an arrangement the snapshot does not know is reported so the PDF can fall back", () => {
    const t = realLineTaker(realZones, "btr", new Map());
    expect(t.has("New Pot")).toBe(false);
  });
  it("no snapshot at all (older event) knows nothing", () => {
    expect(realLineTaker(undefined, "btr", new Map()).has("Terracotta Fibre Pot")).toBe(false);
  });
  it("applies this event's mandi swap: the replacement, scaled by bought ÷ planned", () => {
    const swap = buildEventSwap([
      { name: "gypso", swappedTo: "baby breath", projQty: 2, qty: 0 },
      { name: "baby breath", swapFor: "gypso", qty: 4, unit: "bunch" },
    ]);
    const t = realLineTaker(realZones, "btr", swap);
    expect(t.take("Terracotta Fibre Pot")).toEqual([{ name: "carnation himachal", qty: 0.75, unit: "bundle" }, { name: "baby breath", qty: 1.2, unit: "bunch" }]);
  });
});

describe("fullRecipeLines - the whole recipe on the card, each flower with its split", () => {
  const recipe = [
    { name: "Oasis", qty: 1, unit: "pc", full: true },
    { name: "Rose", qty: 1.25, unit: "bundle" },
    { name: "Gypsy", qty: 0.5, unit: "bunch" },
  ];
  it("a 100% artificial piece still lists every flower (Satyapal Rana, 20 Nov), tagged Artificial; Oasis whole", () => {
    expect(fullRecipeLines(recipe, 2, 0, [])).toEqual([
      { name: "Oasis", qty: 2, unit: "pc", tag: "" },
      { name: "Rose", qty: 2.5, unit: "bundle", tag: "Artificial" },
      { name: "Gypsy", qty: 1, unit: "bunch", tag: "Artificial" },
    ]);
  });
  it("a mixed piece: whole amount, real from Deal Check's line when it has one, else recipe × share", () => {
    const out = fullRecipeLines(recipe, 2, 0.3, [{ name: "rose", qty: 0.6, unit: "bundle" }, { name: "Moss", qty: 1, unit: "kg" }]);
    expect(out).toEqual([
      { name: "Oasis", qty: 2, unit: "pc", tag: "" },
      { name: "Rose", qty: 2.5, unit: "bundle", tag: "Real 0.6 · Artificial 1.75" },
      { name: "Gypsy", qty: 1, unit: "bunch", tag: "Real 0.3 · Artificial 0.7" },
      { name: "Moss", qty: 1, unit: "kg", tag: "Real" },
    ]);
  });
  it("all real: tagged Real; no mix on the piece: no tags at all", () => {
    expect(fullRecipeLines(recipe.slice(1, 2), 1, 1, null)[0].tag).toBe("Real");
    expect(fullRecipeLines(recipe.slice(1, 2), 1, 1, null, undefined, false)[0].tag).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { realLineTaker } from "./floralBook.js";
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

  it("a kit-sourced row (kitParent set) is matched by the KIT's own name, not the recipe's decorated label (bug fixed 2026-11-13: a kit's attached recipe never matched any card and had no fallback, so its real flowers never printed anywhere)", () => {
    const kitZones = [
      { zone: "btr", el: "Chandelier Tree Floral Recipe", kitParent: "Tree", lines: [{ name: "Morya Patti", qty: 10.5, unit: "bundle" }] },
    ];
    const t = realLineTaker(kitZones, "btr", new Map());
    expect(t.has("Tree")).toBe(true);
    expect(t.has("Chandelier Tree Floral Recipe")).toBe(false); // only the kit's own name resolves
    expect(t.take("Tree")).toEqual([{ name: "Morya Patti", qty: 10.5, unit: "bundle" }]);
  });
});

import { describe, it, expect } from "vitest";
import { normalizePaintAllocation, maxRepaintCostInSubcat, paintLinesFor, paintTotalFor } from "./paint.js";

// Test 2, Entry & Passage: Round Fibre Pot Medium ×4, Ivory → Red at ₹200 a unit = ₹800. That ₹800 sat on the
// cost sheet but not in the totals; both now read the same helper.
const inventory = [
  { name: "Round Fibre Pot Medium", baseColour: "Ivory", paintCost: 200, subCat: "pot" },
  { name: "Stand", baseColour: "Black", subCat: "pot", paintCost: 350 },
  { name: "Plain thing", subCat: "misc" },
];
const ctx = { inventory, defaultPaintCost: 400 };

describe("paint — which units are repainted", () => {
  it("one override repaints every unit, unless it is the base colour", () => {
    expect(normalizePaintAllocation({ qty: 4, paintOverride: "Red" }, "Ivory")).toEqual([{ qty: 4, colour: "Red" }]);
    expect(normalizePaintAllocation({ qty: 4, paintOverride: "Ivory" }, "Ivory")).toEqual([]);
    expect(normalizePaintAllocation({ qty: 4 }, "Ivory")).toEqual([]);
  });
  it("a multi-colour split repaints only the units given a non-base colour", () => {
    const el = { qty: 10, paintAllocation: [{ qty: 3, colour: "Red" }, { qty: 2, colour: "Ivory" }, { qty: 5, colour: "Gold" }] };
    expect(normalizePaintAllocation(el, "Ivory")).toEqual([{ qty: 3, colour: "Red" }, { qty: 5, colour: "Gold" }]);
  });
  it("no units, no paint", () => {
    expect(normalizePaintAllocation({ qty: 0, paintOverride: "Red" }, "Ivory")).toEqual([]);
    expect(normalizePaintAllocation(null, "Ivory")).toEqual([]);
  });
});

describe("paint — what it costs", () => {
  it("the Test 2 pot: 4 × ₹200 = ₹800", () => {
    const el = { name: "Round Fibre Pot Medium", qty: 4, paintOverride: "Red" };
    expect(paintLinesFor(el, ctx)).toEqual([{ colour: "Red", baseColour: "Ivory", qty: 4, rate: 200, total: 800 }]);
    expect(paintTotalFor(el, ctx)).toBe(800);
  });
  it("two colours: one line each, the total is their sum", () => {
    const el = { name: "Round Fibre Pot Medium", qty: 5, paintAllocation: [{ qty: 2, colour: "Red" }, { qty: 3, colour: "Gold" }] };
    expect(paintLinesFor(el, ctx).map(l => l.total)).toEqual([400, 600]);
    expect(paintTotalFor(el, ctx)).toBe(1000);
  });
  it("the item's own base colour decides what counts as a repaint", () => {
    expect(paintTotalFor({ name: "Stand", qty: 2, paintOverride: "Black" }, ctx)).toBe(0);
    expect(paintTotalFor({ name: "Stand", qty: 2, paintOverride: "Ivory" }, ctx)).toBe(700);
  });
  it("an item with no paint cost of its own takes the sub-category's highest, else the IMS default", () => {
    expect(maxRepaintCostInSubcat("pot", inventory, 400)).toBe(350);
    expect(maxRepaintCostInSubcat("none", inventory, 400)).toBe(400);
    expect(paintTotalFor({ name: "Unknown item", qty: 3, paintOverride: "Red" }, { ...ctx, rcSub: "pot" })).toBe(3 * 350);
    expect(paintTotalFor({ name: "Unknown item", qty: 3, paintOverride: "Red" }, ctx)).toBe(3 * 400);
  });
  it("an element that is not painted costs nothing", () => {
    expect(paintTotalFor({ name: "Round Fibre Pot Medium", qty: 4 }, ctx)).toBe(0);
    expect(paintTotalFor({ name: "Round Fibre Pot Medium", qty: 4 }, { inventory: [] })).toBe(0);
  });
});

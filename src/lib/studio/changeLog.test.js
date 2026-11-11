import { describe, it, expect } from "vitest";
import { pairSwaps, fnLabelOf } from "./changeLog";

const F = "Cocktail · 2026-11-12";
describe("pairSwaps - a switch reads as one change", () => {
  it("one out, one in of the same sub-category in the same function: swapped, from → to", () => {
    const out = pairSwaps([
      { name: "Round Fibre Podium", change: "removed", from: 8, to: 0, qty: 8, sub: "Podium", fn: F },
      { name: "Terracotta Fibre Podium", change: "added", from: 0, to: 4, qty: 4, sub: "podium ", fn: F, zones: ["Entry"] },
    ]);
    expect(out).toEqual([{ name: "Terracotta Fibre Podium", change: "swapped", fromName: "Round Fibre Podium", from: 8, to: 4, qty: 4, sub: "podium ", fn: F, zones: ["Entry"] }]);
  });
  it("an added item listed before the removed one pairs too", () => {
    const out = pairSwaps([
      { name: "New Vase", change: "added", from: 0, to: 2, sub: "Vase", fn: F },
      { name: "Old Vase", change: "removed", from: 3, to: 0, sub: "Vase", fn: F },
    ]);
    expect(out.map((x) => [x.change, x.fromName, x.name])).toEqual([["swapped", "Old Vase", "New Vase"]]);
  });
  it("different sub-category, different function, or a quantity change: left as they are", () => {
    const items = [
      { name: "Sofa A", change: "removed", from: 2, to: 0, sub: "Sofa", fn: F },
      { name: "Lamp B", change: "added", from: 0, to: 2, sub: "Lamp", fn: F },
      { name: "Sofa C", change: "added", from: 0, to: 1, sub: "Sofa", fn: "Haldi · 2026-11-11" },
      { name: "Pillar Candle", change: "qty_changed", from: 151, to: 157, sub: "Candle", fn: F },
    ];
    expect(pairSwaps(items).map((x) => x.change)).toEqual(["removed", "added", "added", "qty_changed"]);
  });
  it("two out and one in: one switch, the other stays removed", () => {
    const out = pairSwaps([
      { name: "Pot 1", change: "removed", from: 2, to: 0, sub: "Pot", fn: F },
      { name: "Pot 2", change: "removed", from: 3, to: 0, sub: "Pot", fn: F },
      { name: "Pot 3", change: "added", from: 0, to: 5, sub: "Pot", fn: F },
    ]);
    expect(out.map((x) => `${x.change}:${x.fromName || ""}>${x.name}`)).toEqual(["removed:>Pot 2", "swapped:Pot 1>Pot 3"]);
  });
  it("fnLabelOf", () => {
    expect(fnLabelOf({ fnType: "Cocktail", fnDate: "2026-11-12" })).toBe(F);
    expect(fnLabelOf({})).toBe("");
  });
});

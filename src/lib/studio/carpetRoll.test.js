import { describe, it, expect } from "vitest";
import { carpetLaidDims, platformRowCost } from "./taxonomy.js";
import { floorSqftOf } from "./carpetPrefs.js";

// Carpet on a 10 ft roll (owner ask 2026-11-18): the shorter side bills up to the next 10 ft
describe("carpet 10 ft roll", () => {
  it("rounds the shorter side up to the next 10 ft, the longer side stays", () => {
    expect(carpetLaidDims({ L: 24, W: 6 }).area).toBe(240);
    expect(carpetLaidDims({ L: 24, W: 12 }).area).toBe(480);
    expect(carpetLaidDims({ L: 24, W: 16 }).area).toBe(480);
    expect(carpetLaidDims({ L: 24, W: 20 }).area).toBe(480);
    expect(carpetLaidDims({ L: 6, W: 24 }).area).toBe(240); // either way round
    expect(carpetLaidDims({ L: 30, W: 25 }).area).toBe(900);
    expect(carpetLaidDims({ L: 24 }).area).toBe(0);
  });
  const rates = { carpetMaterials: [{ id: "old", name: "Carpet Old", ratePerSqft: 7 }, { id: "new", name: "Carpet New", ratePerSqft: 15 }], platformRates: [{ key: "1ft", rate: 30 }] };
  it("the bill uses it for every carpet", () => {
    expect(platformRowCost({ floorDims: { L: 24, W: 6 }, cpT: "old" }, rates).carpet).toBe(240 * 7);
    expect(platformRowCost({ floorDims: { L: 24, W: 20 }, cpT: "old" }, rates).carpet).toBe(480 * 7); // already on the roll
  });
  it("Carpet New: the roll rule first, then whole 1500 sqft rolls", () => {
    expect(platformRowCost({ floorDims: { L: 24, W: 6 }, cpT: "new" }, rates).carpet).toBe(1500 * 15);
  });
  it("stock / IMS read the same sqft (x Qty)", () => {
    expect(floorSqftOf({ floorDims: { L: 24, W: 6 }, plQty: 2 })).toBe(480);
  });
});

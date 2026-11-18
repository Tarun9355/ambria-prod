import { describe, it, expect } from "vitest";
import { carpetLaidDims, platformRowCost, carpetNewShares } from "./taxonomy.js";
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

// Carpet New rolls shared across a function's floors (owner ask 2026-11-18)
describe("Carpet New roll shared across floors", () => {
  const mats = [{ id: "old", name: "Carpet Old", ratePerSqft: 7 }, { id: "new", name: "Carpet New", ratePerSqft: 15 }];
  const zone = (L, W, extra) => ({ cpT: "new", floorDims: { L, W }, ...(extra ? { extraPlatformRows: extra } : {}) });
  it("the floor that opens a roll pays it; the next ones use what is left, then the next roll opens", () => {
    const zoneConfig = { stage: zone(50, 10), entry: zone(20, 10), lounge: zone(100, 10) }; // 500, 200, 1000 sqft
    const s = carpetNewShares({ zoneConfig, enabledEls: { stage: true, entry: true, lounge: true }, zoneOrder: ["stage", "entry", "lounge"], carpetMaterials: mats });
    expect(s["stage|0"]).toEqual({ need: 500, billed: 1500, leftBefore: 0, leftAfter: 1000 });
    expect(s["entry|0"]).toEqual({ need: 200, billed: 0, leftBefore: 1000, leftAfter: 800 });
    expect(s["lounge|0"]).toEqual({ need: 1000, billed: 1500, leftBefore: 800, leftAfter: 1300 }); // 800 left + a new roll
  });
  it("follows the zone order, skips switched-off zones and other carpets, and reaches extra floors", () => {
    const zoneConfig = { a: zone(50, 10, [{ cpT: "new", floorDims: { L: 10, W: 10 } }]), b: zone(20, 10), c: { cpT: "old", floorDims: { L: 10, W: 10 } } };
    const s = carpetNewShares({ zoneConfig, enabledEls: { a: true, b: false, c: true }, zoneOrder: ["a"], carpetMaterials: mats });
    expect(Object.keys(s)).toEqual(["a|0", "a|1"]);
    expect(s["a|1"].billed).toBe(0);
  });
  it("the bill reads the share: a floor inside a roll already opened costs nothing", () => {
    const zoneConfig = { stage: zone(50, 10), entry: zone(20, 10) };
    const carpetNewShare = carpetNewShares({ zoneConfig, enabledEls: { stage: true, entry: true }, zoneOrder: ["stage", "entry"], carpetMaterials: mats });
    const rates = { carpetMaterials: mats, carpetNewShare };
    expect(platformRowCost(zoneConfig.stage, rates, "stage|0").carpet).toBe(1500 * 15);
    expect(platformRowCost(zoneConfig.entry, rates, "entry|0").carpet).toBe(0);
    expect(platformRowCost(zoneConfig.entry, { carpetMaterials: mats }).carpet).toBe(1500 * 15); // without a share: a roll of its own
  });
  it("a roll is one material's: two Carpet New materials never share", () => {
    const m2 = [...mats, { id: "new2", name: "Carpet New Grey", ratePerSqft: 18 }];
    const zoneConfig = { stage: zone(50, 10), entry: { cpT: "new2", floorDims: { L: 20, W: 10 } } };
    const s = carpetNewShares({ zoneConfig, enabledEls: { stage: true, entry: true }, zoneOrder: ["stage", "entry"], carpetMaterials: m2 });
    expect(s["stage|0"].billed).toBe(1500);
    expect(s["entry|0"].billed).toBe(1500); // its own roll, not the Red one's leftover
  });
});

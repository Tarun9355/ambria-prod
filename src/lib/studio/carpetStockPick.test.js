import { describe, it, expect } from "vitest";
import { carpetTakesStockPick, carpetPricingFor } from "./taxonomy.js";
import { carpetFloorsOf } from "../ims/carpetPlan.js";

const mats = [
  { id: "m_old", name: "Carpet Old", ratePerSqft: 7 },
  { id: "m_new", name: "Carpet New", ratePerSqft: 15 },
  { id: "m_flex", name: "Flex", ratePerSqft: 20 },
];

describe("only Carpet Old takes stock preferences", () => {
  it("Old yes; New and Flex no", () => {
    expect(carpetTakesStockPick(carpetPricingFor("m_old", mats).label)).toBe(true);
    expect(carpetTakesStockPick(carpetPricingFor("m_new", mats).label)).toBe(false);
    expect(carpetTakesStockPick(carpetPricingFor("m_flex", mats).label)).toBe(false);
  });
  it("an unset material defaults to Carpet Old, and a legacy 'old' enum still counts", () => {
    expect(carpetTakesStockPick(carpetPricingFor(undefined, mats).label)).toBe(true);
    expect(carpetTakesStockPick(carpetPricingFor("old", mats).label)).toBe(true);
  });
  it("Planning leaves Flex and New floors out of the carpet decision", () => {
    const row = (cpT) => ({ cpT, floorDims: { L: 10, W: 10 } });
    const fns = [{ date: "2027-02-03", enabledEls: { a: true, b: true, c: true }, zones: { a: row("m_old"), b: row("m_flex"), c: row("m_new") } }];
    expect(carpetFloorsOf(fns, (_f, zk) => zk, mats).map((f) => f.zk)).toEqual(["a"]);
    // without materials (older callers) nothing changes
    expect(carpetFloorsOf(fns, (_f, zk) => zk)).toHaveLength(3);
  });
});

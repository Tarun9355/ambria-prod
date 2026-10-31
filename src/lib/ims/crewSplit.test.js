import { describe, it, expect } from "vitest";
import { splitCrewByDept } from "./crewSplit.js";

// The plan behind the screenshot: Structure 6 · Lighting 4 · Floral 3 · Tenting 1 (raw needs a little under those)
const plan = [
  { dept: "Structure", raw: 5.6 },
  { dept: "Lighting", raw: 3.7 },
  { dept: "Floral", raw: 2.4 },
  { dept: "Tenting", raw: 0.4 },
];
const total = (r) => r.reduce((s, x) => s + x.count, 0);

describe("splitCrewByDept — the day's labours line follows the crew a head sets", () => {
  it("adds up to exactly the crew set, for any number", () => {
    for (let n = 1; n <= 40; n++) expect(total(splitCrewByDept(plan, n))).toBe(n);
  });
  it("keeps the plan's proportions", () => {
    expect(splitCrewByDept(plan, 12)).toEqual([
      { dept: "Structure", count: 5 }, { dept: "Lighting", count: 4 }, { dept: "Floral", count: 2 }, { dept: "Tenting", count: 1 },
    ]);
    const big = Object.fromEntries(splitCrewByDept(plan, 24).map((x) => [x.dept, x.count]));
    expect(big.Structure).toBeGreaterThan(big.Lighting);
    expect(big.Lighting).toBeGreaterThan(big.Floral);
  });
  it("a small department with real work still gets a person", () => {
    const r = Object.fromEntries(splitCrewByDept(plan, 6).map((x) => [x.dept, x.count]));
    expect(r.Tenting).toBe(1);
    expect(total(splitCrewByDept(plan, 6))).toBe(6);
  });
  it("fewer people than departments: the biggest needs get them", () => {
    expect(splitCrewByDept(plan, 2)).toEqual([{ dept: "Structure", count: 1 }, { dept: "Lighting", count: 1 }]);
  });
  it("0 crew, or no plan, gives nothing", () => {
    expect(splitCrewByDept(plan, 0)).toEqual([]);
    expect(splitCrewByDept([], 5)).toEqual([]);
    expect(splitCrewByDept([{ dept: "Floral", raw: 0 }], 5)).toEqual([]);
  });
  it("one department takes the whole crew", () => {
    expect(splitCrewByDept([{ dept: "Floral", raw: 2 }], 7)).toEqual([{ dept: "Floral", count: 7 }]);
  });
});

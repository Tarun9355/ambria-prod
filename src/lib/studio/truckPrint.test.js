import { describe, it, expect } from "vitest";
import { printSqftOf, PRINT_TRUCK_SUB } from "./truckPrint.js";

describe("printSqftOf — the load of a zone's print jobs, in sqft", () => {
  it("width x depth x qty, summed over jobs", () => {
    expect(printSqftOf({ prints: [{ areaW: 10, areaD: 8, qty: 1 }, { areaW: 6, areaD: 4, qty: 3 }] })).toBe(80 + 72);
  });
  it("a missing or zero qty counts as one job, a fractional one rounds", () => {
    expect(printSqftOf({ prints: [{ areaW: 10, areaD: 10 }, { areaW: 5, areaD: 5, qty: 0 }, { areaW: 2, areaD: 5, qty: 2.4 }] })).toBe(100 + 25 + 20);
  });
  it("jobs without a size carry nothing; strings are read as numbers", () => {
    expect(printSqftOf({ prints: [{ areaW: 0, areaD: 9 }, { areaW: "x", areaD: 3 }, { areaW: "4", areaD: "5", qty: "2" }, null] })).toBe(40);
  });
  it("no prints, no config", () => {
    expect(printSqftOf({})).toBe(0);
    expect(printSqftOf(null)).toBe(0);
    expect(printSqftOf({ prints: "x" })).toBe(0);
  });
  it("is counted under the 'Print' truck-capacity row", () => { expect(PRINT_TRUCK_SUB).toBe("Print"); });
});

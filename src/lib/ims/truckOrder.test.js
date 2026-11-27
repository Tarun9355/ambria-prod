import { describe, it, expect } from "vitest";
import { truckOrderOf } from "./eventTrucks.js";

describe("truckOrderOf", () => {
  it("reads a decimal truck id", () => {
    expect(truckOrderOf("trk_1700000000000")).toBe(1700000000000);
  });
  it("reads a base-36 truck id (Date.now().toString(36) + random)", () => {
    const t = 1764200000000;
    expect(truckOrderOf("trk_" + t.toString(36) + "ab12")).toBe(t);
  });
  it("keeps the older truck first, whatever the id style", () => {
    const older = "trk_" + (1764200000000).toString(36) + "zz9";
    const newer = "trk_" + (1764200500000).toString(36) + "aa1";
    expect(truckOrderOf(older)).toBeLessThan(truckOrderOf(newer));
    expect(truckOrderOf("trk_1764100000000")).toBeLessThan(truckOrderOf(older));
  });
  it("does not throw on missing ids", () => {
    expect(truckOrderOf(undefined)).toBe(0);
    expect(truckOrderOf("")).toBe(0);
  });
});

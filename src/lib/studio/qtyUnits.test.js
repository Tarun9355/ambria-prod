import { describe, it, expect } from "vitest";
import { unitAllowsDecimal, quantityForUnit } from "./qtyUnits.js";

describe("unitAllowsDecimal — a count of things is whole, a measure may be fractional", () => {
  it("every unit IMS inventory and the rate card actually use", () => {
    // counts: whole
    ["Pieces", "Piece", "Set", "Sets", "Bundle", "pc", "string", "setup", "event"].forEach((u) => expect(unitAllowsDecimal(u)).toBe(false));
    // measures: decimals fine
    ["Rft", "Sqft", "Kg", "Metre", "rft", "sqft", "truss_sqft"].forEach((u) => expect(unitAllowsDecimal(u)).toBe(true));
  });
  it("case and spaces do not matter", () => {
    expect(unitAllowsDecimal("  PIECES ")).toBe(false);
    expect(unitAllowsDecimal(" Kg")).toBe(true);
  });
  it("an unknown or missing unit is not blocked", () => {
    expect(unitAllowsDecimal("")).toBe(true);
    expect(unitAllowsDecimal(undefined)).toBe(true);
    expect(unitAllowsDecimal("bolt")).toBe(true);
  });
});

describe("quantityForUnit", () => {
  it("WARM LED (Pieces): 3.5 becomes a whole number, a whole number is untouched", () => {
    expect(quantityForUnit("Pieces", 3.5)).toBe(4);
    expect(quantityForUnit("Pieces", 3.4)).toBe(3);
    expect(quantityForUnit("Pieces", 206)).toBe(206);
    expect(quantityForUnit("Piece", 0.4)).toBe(0);
  });
  it("a measure keeps its decimals", () => {
    expect(quantityForUnit("Kg", 2.75)).toBe(2.75);
    expect(quantityForUnit("rft", 12.5)).toBe(12.5);
  });
  it("junk is 0", () => {
    expect(quantityForUnit("Pieces", "abc")).toBe(0);
    expect(quantityForUnit("Kg", undefined)).toBe(0);
  });
});

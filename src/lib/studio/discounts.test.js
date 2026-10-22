import { describe, it, expect } from "vitest";
import { bestDiscountFactor, innerDiscountFactor } from "./discounts.js";

describe("only the biggest discount applies", () => {
  it("Filler 25% off and a 50% Fixed-Venue discount: 50% off, not stacked", () => {
    expect(bestDiscountFactor(0.75, 50)).toBeCloseTo(0.5, 10);
  });
  it("Filler 25% off and a smaller 10% discount: Filler's 25% wins", () => {
    expect(bestDiscountFactor(0.75, 10)).toBeCloseTo(0.75, 10);
  });
  it("equal discounts are one discount, not two", () => {
    expect(bestDiscountFactor(0.75, 25)).toBeCloseTo(0.75, 10);
  });
  it("a date discount with no item discount is just the date discount", () => {
    expect(bestDiscountFactor(0.75, 0)).toBeCloseTo(0.75, 10);
  });
  it("King's (a markup) and Perfect still multiply on top of the item discount", () => {
    expect(bestDiscountFactor(1.2, 25)).toBeCloseTo(0.9, 10);
    expect(bestDiscountFactor(1, 30)).toBeCloseTo(0.7, 10);
  });
  it("a bad date multiplier counts as 1", () => {
    expect(bestDiscountFactor(0, 20)).toBeCloseTo(0.8, 10);
  });
});

describe("innerDiscountFactor (the date multiplier is applied afterwards)", () => {
  const final = (d, pct) => innerDiscountFactor(d, pct) * d;
  it("always lands on the same final factor as bestDiscountFactor", () => {
    for (const d of [0.6, 0.75, 0.9, 1, 1.2]) for (const pct of [0, 10, 25, 50]) {
      expect(final(d, pct)).toBeCloseTo(bestDiscountFactor(d, pct), 10);
    }
  });
  it("is 1 (no extra discount) when the date discount is the bigger one", () => {
    expect(innerDiscountFactor(0.75, 25)).toBeCloseTo(1, 10);
    expect(innerDiscountFactor(0.7, 25)).toBeCloseTo(1, 10);
  });
});

import { describe, it, expect } from "vitest";
import { piecesPerUnit, convertFlowerQty } from "./flowerHelpers.js";

const guldavari = { name: "guldavari star", unit: "piece" };
const talpalm = { name: "talpalm", unit: "bundle", gattharSize: 25 };
const rose = { name: "Rose banglore", unit: "bundle", gattharSize: 20 };
const morya = { name: "Morya Patti", unit: "bundle", gattharSize: 50 };
const noSize = { name: "fern", unit: "bundle" };

describe("swap quantity — pieces ↔ bundles", () => {
  it("a piece flower is 1 piece; other units are their pcs per unit", () => {
    expect(piecesPerUnit(guldavari)).toBe(1);
    expect(piecesPerUnit(talpalm)).toBe(25);
    expect(piecesPerUnit(noSize)).toBe(0);
  });
  it("pieces → bundles", () => {
    expect(convertFlowerQty(50, guldavari, talpalm)).toEqual({ qty: 2, converted: true, same: false });
  });
  it("bundles → pieces", () => {
    expect(convertFlowerQty(2, talpalm, guldavari)).toEqual({ qty: 50, converted: true, same: false });
  });
  it("bundle → bundle keeps the qty (same unit, the sizes do not matter)", () => {
    expect(convertFlowerQty(18.75, morya, rose)).toEqual({ qty: 18.75, converted: true, same: true });
  });
  it("units differ but a pcs per unit is missing: qty unchanged, flagged as not converted", () => {
    expect(convertFlowerQty(50, guldavari, noSize)).toEqual({ qty: 50, converted: false, same: false });
  });
});

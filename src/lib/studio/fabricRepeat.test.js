import { describe, it, expect } from "vitest";
import { calcZoneFabricCost, fabricRepeatDiscount } from "./pricing.js";

// A 12×12×12 box truss: Liza (wrap + ceiling) and 4 curtains per pillar.
const trussInv = { rates: { lizaKgRate: 100, lizaKgRateNew: 150, curtainPieceRate: 200, maskingPieceRate: 50 } };
const row = { dims: { W: 12, L: 12, H: 12 }, trT: "box", trussQty: 1 };

describe("fabric Repeat is per part", () => {
  it("no flag, no discount", () => {
    expect(fabricRepeatDiscount(row, trussInv, "moderate", 3, 25)).toBe(0);
  });
  it("a flagged part loses pct of its own share only (× guest multiplier)", () => {
    const whole = calcZoneFabricCost(row, trussInv, [], "moderate");
    const noLiza = calcZoneFabricCost({ ...row, fabLiza: false }, trussInv, [], "moderate");
    const noCurtain = calcZoneFabricCost({ ...row, fabCurtain: false }, trussInv, [], "moderate");
    expect(whole).toBeGreaterThan(noLiza);
    expect(fabricRepeatDiscount({ ...row, fabLizaRep: true }, trussInv, "moderate", 3, 25)).toBe(Math.round((whole - noLiza) * 3 * 0.25));
    expect(fabricRepeatDiscount({ ...row, fabCurtainRep: true }, trussInv, "moderate", 3, 25)).toBe(Math.round((whole - noCurtain) * 3 * 0.25));
  });
  it("a part that is switched off, or a bare frame, has nothing to discount", () => {
    expect(fabricRepeatDiscount({ ...row, fabLiza: false, fabLizaRep: true }, trussInv, "moderate", 3, 25)).toBe(0);
    expect(fabricRepeatDiscount({ ...row, noFabric: true, fabLizaRep: true }, trussInv, "moderate", 3, 25)).toBe(0);
  });
});

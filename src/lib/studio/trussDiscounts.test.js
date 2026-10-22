import { describe, it, expect } from "vitest";
import { trussDiscountedCosts } from "./pricing.js";

// A truss whose pillars cost 1000 (400 of that is standing stock at the venue, 50% off), beams 500
// (200 standing, 20% off), batta 100; actual = the three added.
const costs = { pillarCost: 1000, beamCost: 500, battaCost: 100, actual: 1600 };
const detail = { pillarStandingCost: 400, beamStandingCost: 200, pillarPct: 50, beamPct: 20 };

describe("truss: venue standing discount and Repeat do not stack", () => {
  it("standing alone is exactly cost minus the standing %", () => {
    const r = trussDiscountedCosts(costs, detail, false);
    expect(r.pillarCost).toBe(800);   // 1000 - 400*50%
    expect(r.beamCost).toBe(460);     // 500 - 200*20%
    expect(r.battaCost).toBe(100);
    expect(r.actual).toBe(1600 - 200 - 40);
  });
  it("Repeat alone is a flat 30% off everything", () => {
    const r = trussDiscountedCosts(costs, null, true);
    expect(r).toEqual({ pillarCost: 700, beamCost: 350, battaCost: 70, actual: 1120 });
  });
  it("both: the standing part takes the bigger of its % and 30%, the rest takes 30%", () => {
    const r = trussDiscountedCosts(costs, detail, true);
    // pillars: 400 at 50% + 600 at 30% = 200 + 420 = 620 (not (1000-200)*0.7 = 560)
    expect(r.pillarCost).toBe(620);
    // beams: standing 20% < 30%, so Repeat's 30% wins everywhere: 500 * 0.7 = 350
    expect(r.beamCost).toBe(350);
    expect(r.battaCost).toBe(70);
    expect(r.actual).toBe(Math.round(1600 * 0.7 - 400 * (0.5 - 0.3)));
  });
  it("no truss at the venue and no Repeat changes nothing", () => {
    expect(trussDiscountedCosts(costs, null, false)).toEqual({ pillarCost: 1000, beamCost: 500, battaCost: 100, actual: 1600 });
  });
});

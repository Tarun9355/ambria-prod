import { describe, it, expect } from "vitest";
import { readTrussRate, applyTrussRate, rateLabel, isAdminUser, withRatesOf } from "./trussRates.js";

const ti = {
  rates: { lizaKgRate: 0, curtainPieceRate: 0, pillarRftRate: 20 },
  lizaStock: [{ colour: "Ivory", stockKg: 55 }],
  materials: { pole: { rates: { pillarRftRate: 12 }, pillars: [{ h: 8 }] } },
};

describe("truss / fabric rates", () => {
  it("reads Iron + fabric from rates, Pole / Aluminium from their own material", () => {
    expect(readTrussRate(ti, null, "pillarRftRate")).toBe(20);
    expect(readTrussRate(ti, "iron", "lizaKgRate")).toBe(0);
    expect(readTrussRate(ti, "pole", "pillarRftRate")).toBe(12);
    expect(readTrussRate(ti, "aluminium", "pillarRftRate")).toBe(0);
  });
  it("sets one rate and leaves everything else (stock, other rates, other materials) as it was", () => {
    const next = applyTrussRate(ti, "iron", "lizaKgRate", "167");
    expect(next.rates).toEqual({ lizaKgRate: 167, curtainPieceRate: 0, pillarRftRate: 20 });
    expect(next.lizaStock).toBe(ti.lizaStock);
    expect(next.materials).toBe(ti.materials);
    expect(ti.rates.lizaKgRate).toBe(0); // not mutated
    const pole = applyTrussRate(ti, "pole", "beamRftRate", 9);
    expect(pole.materials.pole).toEqual({ rates: { pillarRftRate: 12, beamRftRate: 9 }, pillars: [{ h: 8 }] });
    expect(pole.rates).toBe(ti.rates);
    expect(applyTrussRate(ti, null, "lizaKgRate", -5).rates.lizaKgRate).toBe(0);
  });
  it("labels name the fabric and, for truss, the material", () => {
    expect(rateLabel(null, "lizaKgRate")).toMatch(/^Liza Fabric · Old-stock/);
    expect(rateLabel("pole", "pillarRftRate")).toBe("Pole · Truss pillar rental (₹/RFT)");
  });
  it("only an Admin", () => {
    expect(isAdminUser({ role: "Admin" })).toBe(true);
    expect(isAdminUser({ id: "u_admin" })).toBe(true);
    expect(isAdminUser({ role: "Ops" })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });
});

describe("withRatesOf", () => {
  it("an old tab's stock edit keeps the database's rates, its own stock change goes through", () => {
    const stale = { rates: { lizaKgRate: 0 }, lizaStock: [{ colour: "Ivory", stockKg: 60 }], materials: { pole: { rates: { pillarRftRate: 1 }, pillars: [1] }, aluminium: { pillars: [2] } } };
    const fresh = { rates: { lizaKgRate: 167 }, lizaStock: [{ colour: "Ivory", stockKg: 55 }], materials: { pole: { rates: { pillarRftRate: 12 } } } };
    const out = withRatesOf(stale, fresh);
    expect(out.rates).toEqual({ lizaKgRate: 167 });
    expect(out.lizaStock[0].stockKg).toBe(60);
    expect(out.materials.pole).toEqual({ rates: { pillarRftRate: 12 }, pillars: [1] });
    expect(out.materials.aluminium).toEqual({ pillars: [2] });
    expect(withRatesOf(stale, null)).toBe(stale);
  });
  it("a material only the database has is kept whole; a stale tab's own material rates never win", () => {
    const fresh = { rates: { lizaKgRate: 167 }, materials: { pole: { rates: { pillarRftRate: 12 }, pillars: [3] } } };
    expect(withRatesOf({ rates: { lizaKgRate: 0 } }, fresh).materials).toEqual({ pole: { rates: { pillarRftRate: 12 }, pillars: [3] } });
    const out = withRatesOf({ materials: { aluminium: { rates: { pillarRftRate: 99 }, pillars: [1] } } }, { rates: {}, materials: { aluminium: { pillars: [1] } } });
    expect(out.materials.aluminium).toEqual({ pillars: [1] });
  });
});

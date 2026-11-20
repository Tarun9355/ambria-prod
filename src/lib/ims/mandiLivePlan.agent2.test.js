import { describe, it, expect } from "vitest";
import { withLivePlan, dismissMarker, mandiRowKey } from "./mandiLivePlan";

// Adversarial checks on the planned side of the Floral mandi list (agent2, 2026-11-20).
const red = { label: "Red" };
const pink = { label: "Pink" };
const white = { label: "White" };
const sumProj = (rows) => rows.reduce((s, r) => s + (Number(r.projQty) || 0), 0);
const sumProjCost = (rows) => rows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);

describe("withLivePlan — one planned flower must never be planned twice", () => {
  it("a shopper's extra row of the same flower (added from the catalogue, no colour) does not get the plan's qty a second time", () => {
    // Logged: the planned Rose (Red) bought at 10 kg, plus a manual extra Rose line (addMandi: projQty 0, no colour).
    const stored = [
      { name: "Rose", unit: "kg", colorVariant: red, projQty: 10, projCost: 1000, qty: 10, price: 100 },
      { name: "Rose", unit: "kg", projQty: 0, projCost: 0, qty: 3, price: 90 },
    ];
    const seed = [{ name: "Rose", unit: "kg", colorVariant: red, projQty: 10, projCost: 1000, qty: 10, price: 100 }];
    const out = withLivePlan(stored, seed);
    // The plan holds 10 kg / ₹1000 of Rose once. The name-only fallback hands the SAME seed row to the
    // manual extra row too (covered is never checked before reuse), so planned reads 20 kg / ₹2000 and
    // the extra line stops reading "extra" and is recoloured Red.
    expect(sumProj(out)).toBe(10);
    expect(sumProjCost(out)).toBe(1000);
    expect(out[1].projQty).toBe(0);
  });

  it("two logged colours of one flower, plan now holds it in a single colour: planned is not doubled", () => {
    // Shopping began with Rose in Red and Pink; Deal Check later changed the pick to White only.
    const stored = [
      { name: "Rose", unit: "kg", colorVariant: red, projQty: 6, projCost: 600, qty: 6, price: 100 },
      { name: "Rose", unit: "kg", colorVariant: pink, projQty: 4, projCost: 400, qty: 4, price: 100 },
    ];
    const seed = [{ name: "Rose", unit: "kg", colorVariant: white, projQty: 10, projCost: 1000, qty: 10, price: 100 }];
    const out = withLivePlan(stored, seed);
    // Both rows fall back to the one White seed by name: each gets projQty 10 and colour White,
    // so the tab plans 20 kg / ₹2000 and shows two identical "Rose · White" rows.
    expect(sumProj(out)).toBe(10);
    expect(sumProjCost(out)).toBe(1000);
    expect(new Set(out.map(mandiRowKey)).size).toBe(out.length);
  });

  it("an exact-key duplicate (same flower + colour logged on two lines, e.g. two vendors) is planned once", () => {
    const stored = [
      { name: "Marigold", unit: "kg", projQty: 20, projCost: 2000, qty: 12, price: 100 },
      { name: "Marigold", unit: "kg", projQty: 0, projCost: 0, qty: 8, price: 95 },
    ];
    const seed = [{ name: "Marigold", unit: "kg", projQty: 20, projCost: 2000, qty: 20, price: 100 }];
    const out = withLivePlan(stored, seed);
    expect(sumProj(out)).toBe(20);
  });
});

describe("withLivePlan — dismissed markers", () => {
  it("documents: a removed planned flower comes back as 'New in the plan' as soon as its colour pick changes", () => {
    const row = { name: "Rose", unit: "kg", colorVariant: red, projQty: 10, projCost: 1000, qty: 0, price: 100 };
    const stored = [dismissMarker(row)];
    const seed = [{ name: "Rose", unit: "kg", colorVariant: pink, projQty: 10, projCost: 1000, qty: 10, price: 100 }];
    const out = withLivePlan(stored, seed);
    // The marker is keyed on name + colour, so Red→Pink in Deal Check re-adds the flower the shopper removed.
    expect(out.filter((r) => r.newInPlan).map((r) => r.name)).toEqual(["Rose"]);
  });
});

import { describe, it, expect } from "vitest";
import { withLivePlan } from "./mandiLivePlan";

const seed = (name, projQty, projCost, colour) => ({ name, unit: "kg", projQty, projCost, qty: projQty, price: projQty ? projCost / projQty : 0, colorVariant: colour ? { label: colour } : null, colorPrefs: null });

describe("withLivePlan — the planned side follows Deal Check, what was bought never moves", () => {
  it("the reported case: logged at 16 kg planned, Deal Check now plans 44 — shows 44, bought qty/price untouched", () => {
    const stored = [{ name: "guldavari ladi", unit: "kg", projQty: 16, projCost: 1600, qty: 16, price: 100 }];
    const [r] = withLivePlan(stored, [seed("guldavari ladi", 44, 4400)]);
    expect(r.projQty).toBe(44);
    expect(r.projCost).toBe(4400);
    expect(r.qty).toBe(16);
    expect(r.price).toBe(100);
  });

  it("matches name + colour, so two colours of one flower each get their own plan", () => {
    const stored = [
      { name: "guldavari star", projQty: 5, projCost: 50, qty: 5, price: 10, colorVariant: { label: "yellow" } },
      { name: "guldavari star", projQty: 5, projCost: 50, qty: 5, price: 10, colorVariant: { label: "white" } },
    ];
    const out = withLivePlan(stored, [seed("guldavari star", 9, 90, "yellow"), seed("guldavari star", 3, 30, "white")]);
    expect(out.map(r => r.projQty)).toEqual([9, 3]);
  });

  it("colour changed in Deal Check after shopping: falls back to the name when the plan has only one colour, and takes the new colour", () => {
    const stored = [{ name: "rose", projQty: 2, projCost: 20, qty: 2, price: 10, colorVariant: { label: "red" } }];
    const [r] = withLivePlan(stored, [seed("rose", 6, 60, "pink")]);
    expect(r.projQty).toBe(6);
    expect(r.colorVariant).toEqual({ label: "pink" });
  });

  it("no name-only guess when the plan holds that flower in two colours", () => {
    const stored = [{ name: "rose", projQty: 2, projCost: 20, qty: 2, price: 10, colorVariant: { label: "red" } }];
    const [r] = withLivePlan(stored, [seed("rose", 6, 60, "pink"), seed("rose", 4, 40, "white")]);
    expect(r.projQty).toBe(0); // red is no longer planned at all
    expect(r.qty).toBe(2);
  });

  it("a flower Deal Check no longer plans becomes unplanned ('extra'); a manual extra stays as it was", () => {
    const extra = { name: "moss", projQty: 0, projCost: 0, qty: 1, price: 50 };
    const out = withLivePlan([{ name: "gypso", projQty: 10, projCost: 800, qty: 10, price: 80 }, extra], [seed("rose", 6, 60)]);
    expect(out[0]).toMatchObject({ projQty: 0, projCost: 0, qty: 10, price: 80 });
    expect(out[1]).toBe(extra);
  });

  it("swap replacement rows are never planned, and a swapped-out original keeps its swap marks", () => {
    const stored = [
      { name: "gypso", projQty: 10, projCost: 800, qty: 0, price: 80, swappedTo: "baby breath" },
      { name: "baby breath", projQty: 0, projCost: 0, qty: 8, price: 90, swapFor: "gypso" },
    ];
    const out = withLivePlan(stored, [seed("gypso", 12, 960), seed("baby breath", 3, 270)]);
    expect(out[0]).toMatchObject({ projQty: 12, qty: 0, swappedTo: "baby breath" });
    expect(out[1]).toBe(stored[1]);
  });

  it("no live plan to read: the stored rows come back exactly as they were", () => {
    const stored = [{ name: "gypso", projQty: 10, projCost: 800, qty: 10, price: 80 }];
    expect(withLivePlan(stored, [])).toBe(stored);
    expect(withLivePlan(stored, undefined)).toBe(stored);
  });
});

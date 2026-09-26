import { describe, it, expect } from "vitest";
import { kitShortfallSplit } from "./kitShortfallSplit";

// ctx mocks kept deliberately simple so each test isolates one piece of behavior:
// repeatAdjustedRentalFn just does qty*baseRental unless a test says otherwise (no hidden discount
// noise), crossFnTake defaults to "no credit available" so shortfall math is easy to hand-verify.
const baseCtx = (overrides = {}) => ({
  inventoryCache: [],
  kitEditsFor: () => undefined,
  availFor: () => 0,
  crossFnTake: () => 0,
  costPctFor: () => 50, // flat 50% cost-basis for shortfall, unless a test overrides it
  repeatAdjustedRentalFn: (item, qty, baseRental) => qty * baseRental,
  rentalRateFor: (item) => item.rate || 0,
  ...overrides,
});

describe("kitShortfallSplit — plain (non-kit) item", () => {
  const item = { id: "A", cost: 200, rate: 100 };

  it("fully available: all owned, no shortfall cost", () => {
    const ctx = baseCtx({ availFor: () => 20 });
    const r = kitShortfallSplit(item, 10, null, ctx);
    expect(r).toEqual({ ownedCost: 1000, shortCost: 0, ownedQty: 10, shortQty: 0 });
  });

  it("partially short: owned bills at rate, shortfall bills at cost x cost%", () => {
    const ctx = baseCtx({ availFor: () => 6 });
    const r = kitShortfallSplit(item, 10, null, ctx);
    // 6 owned @100 = 600; 4 short @ 200*50% = 400
    expect(r.ownedQty).toBe(6);
    expect(r.shortQty).toBe(4);
    expect(r.ownedCost).toBe(600);
    expect(r.shortCost).toBe(400);
  });

  it("cross-function reuse credit expands owned qty before shortfall is computed", () => {
    const ctx = baseCtx({ availFor: () => 6, crossFnTake: () => 3 });
    const r = kitShortfallSplit(item, 10, null, ctx);
    expect(r.ownedQty).toBe(9); // 6 stock + 3 cross-fn credit
    expect(r.shortQty).toBe(1);
    expect(r.shortCost).toBe(100); // 1 * 200 * 50%
  });

  it("a discount applied only inside repeatAdjustedRentalFn never touches the shortfall cost", () => {
    const ctx = baseCtx({
      availFor: () => 6,
      repeatAdjustedRentalFn: (item, qty, baseRental) => qty * baseRental * 0.7, // Repeat discount
    });
    const r = kitShortfallSplit(item, 10, null, ctx);
    expect(r.ownedCost).toBe(6 * 100 * 0.7); // 420 — discounted
    expect(r.shortCost).toBe(4 * 200 * 0.5); // 400 — undiscounted, cost-basis only
  });
});

describe("kitShortfallSplit — kit with components", () => {
  const compA = { id: "COMP_A", cost: 50, rate: 30 };
  const kit = { id: "KIT", cost: 500, kitBase: 100, rate: 200, subItems: [{ itemId: "COMP_A", qty: 2 }] };
  const inventoryCache = [kit, compA];

  it("kit's own stock fully covers demand: no component recursion at all", () => {
    const ctx = baseCtx({ inventoryCache, availFor: (it) => (it.id === "KIT" ? 10 : 0) });
    const r = kitShortfallSplit(kit, 5, null, ctx);
    expect(r.ownedQty).toBe(5);
    expect(r.shortQty).toBe(0);
    expect(r.ownedCost).toBe(5 * 200); // rentalRateFor(kit) x qty
    expect(r.shortCost).toBe(0);
  });

  it("kit is short: kitBase priced at cost%% for the short units, plus each component's own split", () => {
    // Kit: need 5, only 2 available -> 3 short. Component A: need 2*3=6 for those 3 kits, only 4 available.
    const ctx = baseCtx({
      inventoryCache,
      availFor: (it) => (it.id === "KIT" ? 2 : it.id === "COMP_A" ? 4 : 0),
    });
    const r = kitShortfallSplit(kit, 5, null, ctx);
    expect(r.ownedQty).toBe(2);
    expect(r.shortQty).toBe(3);
    expect(r.ownedCost).toBe(2 * 200); // 2 pre-built kits at full rate
    // kitBase share: 3 short kits x kitBase(100) x 50% = 150
    // component A: needs 6, 4 owned @30 = 120; 2 short @ 50*50% = 50 -> componentCost = 170
    // shortCost = 150 (kitBase) + 170 (component) = 320
    expect(r.shortCost).toBe(320);
  });

  it("kit-inside-a-kit recurses two levels deep for the shortfall portion", () => {
    const leaf = { id: "LEAF", cost: 10, rate: 5 };
    const innerKit = { id: "INNER", cost: 80, kitBase: 20, rate: 40, subItems: [{ itemId: "LEAF", qty: 3 }] };
    const outerKit = { id: "OUTER", cost: 300, kitBase: 50, rate: 150, subItems: [{ itemId: "INNER", qty: 1 }] };
    const inv = [outerKit, innerKit, leaf];
    // Outer: need 2, 0 available -> fully short (2). Inner: need 1*2=2, 0 available -> fully short (2).
    // Leaf: need 3*2=6, 0 available -> fully short (6).
    const ctx = baseCtx({ inventoryCache: inv, availFor: () => 0, costPctFor: () => 100 });
    const r = kitShortfallSplit(outerKit, 2, null, ctx);
    expect(r.ownedQty).toBe(0);
    expect(r.shortQty).toBe(2);
    // outer kitBase: 2 * 50 * 100% = 100
    // inner (as a component, qty=2): fully short too (own avail 0) ->
    //   inner kitBase: 2 * 20 * 100% = 40
    //   leaf (qty=6): fully short -> 6 * 10 * 100% = 60
    //   inner shortCost = 40 + 60 = 100; inner ownedCost = 0
    // outer shortCost = 100 (own kitBase) + 100 (inner's owned+short) = 200
    expect(r.shortCost).toBe(200);
  });

  it("an explicit Deal-Check component override replaces the kit's default recipe for the shortfall split", () => {
    const compB = { id: "COMP_B", cost: 90, rate: 60 };
    const inv = [kit, compA, compB];
    const ctx = baseCtx({
      inventoryCache: inv,
      kitEditsFor: (cardKey) => (cardKey === "card1" ? [{ itemId: "COMP_B", qty: 1 }] : undefined),
      availFor: (it) => (it.id === "KIT" ? 0 : it.id === "COMP_B" ? 0 : 999),
      costPctFor: () => 100,
    });
    const r = kitShortfallSplit(kit, 1, "card1", ctx);
    // Kit fully short (1 unit). kitBase: 1*100*100%=100. Component override says COMP_B qty 1 -> need 1, 0 avail -> short 1*90*100%=90.
    expect(r.shortCost).toBe(190);
  });
});

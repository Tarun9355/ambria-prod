import { describe, it, expect } from "vitest";
import { buildDealFabricPlan } from "./dealFabricPlan.js";

// Loose fabric (Build's own "+ Add loose fabric" rows, a salesperson-picked colour+qty with no
// truss geometry needed) drives every assertion here — it sidesteps calcZoneFabric's own truss-
// topology formula (covered by its own tests elsewhere: fabricRepeat.test.js, trussFoc.test.js,
// structCostLooseFabric.test.js) so this file can test the AGGREGATION layer (zone/repeat/FOC
// skipping, extraTrussRows, old/new tier split, colour folding) in isolation, deterministically.
const trussInv = { lizaStock: [{ colour: "Ivory", stockKg: 100 }], maskingStock: [], curtainStock: [{ colour: "Rani", stockKg: 50 }], rates: {} };

const fns = [{
  fnPalette: "Custom",
  zoneConfig: {
    stage: { looseFabric: [{ kind: "liza", colour: "Ivory", qty: 5 }] },
    entry: { looseFabric: [{ kind: "liza", colour: "Ivory", qty: 3 }] }, // same colour as stage - one folded row, qty 8
    bar: { repeat: true, looseFabric: [{ kind: "liza", colour: "Ivory", qty: 999 }] }, // ♻ Repeat zone - entirely skipped
    photobooth: { trussFoc: true, looseFabric: [{ kind: "liza", colour: "Ivory", qty: 999 }] }, // FOC row - entirely skipped
    sidelounge: {
      looseFabric: [{ kind: "curtain", colour: "Rani", qty: 2 }], // base row - Old tier
      extraTrussRows: [{ useNewFabric: true, looseFabric: [{ kind: "curtain", colour: "Rani", qty: 4 }] }], // extra row - New tier
    },
    welcomeporch: { looseFabric: [{ kind: "masking", colour: "Unicorn Pink", qty: 1 }] }, // a colour with no stock row at all
  },
  enabledEls: { stage: true, entry: true, bar: true, photobooth: true, sidelounge: true, welcomeporch: true },
}];

describe("buildDealFabricPlan", () => {
  it("no trussInv: the same empty plan as before this was extracted, no rows key", () => {
    expect(buildDealFabricPlan({ fns, trussInv: null, libItems: [], paletteCatalogue: [] })).toEqual({ liza: [], masking: [], curtain: [] });
  });

  it("folds two zones' same colour into one row, each kind kept separate", () => {
    const plan = buildDealFabricPlan({ fns, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.liza).toEqual([{ colour: "Ivory", qty: 8, qtyOld: 8, qtyNew: 0 }]);
  });

  it("a ♻ Repeat zone and an FOC row contribute nothing, however much loose fabric they carry", () => {
    const plan = buildDealFabricPlan({ fns, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.rows.some((r) => r.zk === "bar" || r.zk === "photobooth")).toBe(false);
    // 999 kg on each, skipped entirely - Ivory's whole total stays 8 (stage 5 + entry 3), not 1006
    expect(plan.liza[0].qty).toBe(8);
  });

  it("extraTrussRows is its own row, tagged by its OWN useNewFabric (old base + new extra, not merged into one tier)", () => {
    const plan = buildDealFabricPlan({ fns, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.curtain).toEqual([{ colour: "Rani", qty: 6, qtyOld: 2, qtyNew: 4 }]);
    const rows = plan.rows.filter((r) => r.zk === "sidelounge");
    expect(rows).toEqual([
      { fi: 0, zk: "sidelounge", ri: 0, kind: "curtain", colour: "Rani", qty: 2, tier: "old" },
      { fi: 0, zk: "sidelounge", ri: 1, kind: "curtain", colour: "Rani", qty: 4, tier: "new" },
    ]);
  });

  it("a colour with no stock row anywhere still aggregates normally (stock-row existence is a downstream concern, not this layer's)", () => {
    const plan = buildDealFabricPlan({ fns, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.masking).toEqual([{ colour: "Unicorn Pink", qty: 1, qtyOld: 1, qtyNew: 0 }]);
  });

  it("every contributing row is in `rows`, in zone order, nothing from a skipped zone", () => {
    const plan = buildDealFabricPlan({ fns, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.rows).toEqual([
      { fi: 0, zk: "stage", ri: 0, kind: "liza", colour: "Ivory", qty: 5, tier: "old" },
      { fi: 0, zk: "entry", ri: 0, kind: "liza", colour: "Ivory", qty: 3, tier: "old" },
      { fi: 0, zk: "sidelounge", ri: 0, kind: "curtain", colour: "Rani", qty: 2, tier: "old" },
      { fi: 0, zk: "sidelounge", ri: 1, kind: "curtain", colour: "Rani", qty: 4, tier: "new" },
      { fi: 0, zk: "welcomeporch", ri: 0, kind: "masking", colour: "Unicorn Pink", qty: 1, tier: "old" },
    ]);
  });

  it("a zone switched off in enabledEls contributes nothing", () => {
    const fns2 = [{ ...fns[0], enabledEls: { ...fns[0].enabledEls, stage: false } }];
    const plan = buildDealFabricPlan({ fns: fns2, trussInv, libItems: [], paletteCatalogue: [] });
    expect(plan.liza).toEqual([{ colour: "Ivory", qty: 3, qtyOld: 3, qtyNew: 0 }]); // only entry's 3 left
  });

  it("no functions at all: the empty plan, not a crash", () => {
    expect(buildDealFabricPlan({ fns: [], trussInv, libItems: [], paletteCatalogue: [] })).toEqual({ liza: [], masking: [], curtain: [], rows: [] });
  });
});

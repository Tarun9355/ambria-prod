import { describe, it, expect } from "vitest";
import {
  buildEventBattaAllocation,
  computeBattaPoolFeasibility,
  allocateBattaForDate,
  applyBattaOverridesToEvents,
  simulateBattaImpact,
} from "./battaEngine";

describe("buildEventBattaAllocation", () => {
  const meta = { eoId: "eo1", clientId: "c1", clientName: "Test Client", createdAt: 100 };
  const trussInv = { settings: { maxSpanFt: 30, pillarWidthFt: 0.75 }, batta: { stockRft: 1000, bufferPct: 10 } };

  it("computes pillar+beam RFT with the material's own buffer%, keyed by trussMaterial", () => {
    // u_only, span 20ft (<=30, no mid pillar): 2 pillars x H=10 + beam ~18.5ft => rft = 20+18.5=38.5
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 20, H: 10 }, trussType: "u_only", trussMaterial: "pole" },
    }, enabledEls: {} }];
    const out = buildEventBattaAllocation(meta, fnList, trussInv);
    expect(Object.keys(out.totalBattaRftByMaterial)).toEqual(["pole"]);
    expect(out.totalBattaRftByMaterial.pole).toBeGreaterThan(0);
  });

  it("defaults to iron when trussMaterial is unset", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 20, H: 10 }, trussType: "u_only" },
    }, enabledEls: {} }];
    const out = buildEventBattaAllocation(meta, fnList, trussInv);
    expect(Object.keys(out.totalBattaRftByMaterial)).toEqual(["iron"]);
  });

  it("returns no demand for a zone with no valid truss config", () => {
    const fnList = [{ fnIdx: 0, zones: { z1: { dims: {} } }, enabledEls: {} }];
    const out = buildEventBattaAllocation(meta, fnList, trussInv);
    expect(out.totalBattaRftByMaterial).toEqual({});
  });

  it("skips a zone disabled via enabledEls", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 20, H: 10 }, trussType: "u_only" },
      z2: { dims: { L: 20, H: 10 }, trussType: "u_only" },
    }, enabledEls: { z1: true } }];
    const out = buildEventBattaAllocation(meta, fnList, trussInv);
    const z1Only = out.totalBattaRftByMaterial.iron;
    const bothFn = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 20, H: 10 }, trussType: "u_only" },
      z2: { dims: { L: 20, H: 10 }, trussType: "u_only" },
    }, enabledEls: {} }];
    const outBoth = buildEventBattaAllocation(meta, bothFn, trussInv);
    expect(outBoth.totalBattaRftByMaterial.iron).toBeGreaterThan(z1Only);
  });
});

describe("computeBattaPoolFeasibility", () => {
  const trussInv = {
    batta: { stockRft: 200, bufferPct: 10 },
    materials: { pole: { batta: { stockRft: 50, bufferPct: 10 } } },
  };

  it("is feasible when demand fits within stock per material", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalBattaRftByMaterial: { iron: 150 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalBattaRftByMaterial: { pole: 30 } },
    ];
    const r = computeBattaPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(true);
    expect(r.stock.iron).toBe(200);
    expect(r.stock.pole).toBe(50);
  });

  it("gives hard events priority and marks the later soft event as bearing the shortage", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalBattaRftByMaterial: { iron: 180 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalBattaRftByMaterial: { iron: 50 } },
    ];
    const r = computeBattaPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(false);
    expect(r.overflow.iron).toBeCloseTo(30);
    expect(events.find(e => e.eoId === "e2").shortageBorne).toBe(true);
  });

  it("falls back to Iron's stock for aluminium (nothing configured of its own)", () => {
    const events = [{ eoId: "e1", state: "hard", createdAt: 1, totalBattaRftByMaterial: { aluminium: 100 } }];
    const r = computeBattaPoolFeasibility(events, trussInv);
    expect(r.stock.aluminium).toBe(200);
  });
});

describe("allocateBattaForDate", () => {
  const trussInv = { batta: { stockRft: 200, bufferPct: 10 } };

  it("writes a fresh entry for the date with the feasibility summary", () => {
    const events = [{ eoId: "e1", state: "hard", createdAt: 1, totalBattaRftByMaterial: { iron: 100 } }];
    const out = allocateBattaForDate({}, "2026-12-01", events, trussInv, "test");
    expect(out["2026-12-01"].events).toBe(events);
    expect(out["2026-12-01"].stockSummary.feasible).toBe(true);
  });

  it("deletes the date entry when the events list is empty", () => {
    const out = allocateBattaForDate({ "2026-12-01": { events: [] } }, "2026-12-01", [], trussInv);
    expect(out["2026-12-01"]).toBeUndefined();
  });
});

describe("applyBattaOverridesToEvents", () => {
  it("replaces totalBattaRftByMaterial for an overridden event", () => {
    const events = [{ eoId: "e1", totalBattaRftByMaterial: { iron: 50 } }];
    const overrides = { e1: { totalBattaRftByMaterial: { iron: 80 }, reason: "extra wrap used on site", overrideBy: "Krati" } };
    const out = applyBattaOverridesToEvents(events, overrides);
    expect(out[0].totalBattaRftByMaterial).toEqual({ iron: 80 });
    expect(out[0].hasOverride).toBe(true);
  });
});

describe("simulateBattaImpact", () => {
  const trussInv = { batta: { stockRft: 200, bufferPct: 10 } };

  it("returns green when the simulated RFT fits comfortably", () => {
    const r = simulateBattaImpact({ mode: "independent", zones: [{ material: "iron", rft: 50 }] }, null, [], trussInv);
    expect(r.status).toBe("green");
    expect(r.demand).toEqual({ iron: 50 });
  });

  it("returns red with an overflow figure when demand exceeds remaining stock", () => {
    const dateAlloc = { events: [{ totalBattaRftByMaterial: { iron: 180 } }] };
    const r = simulateBattaImpact({ mode: "independent", zones: [{ material: "iron", rft: 50 }] }, dateAlloc, [], trussInv);
    expect(r.status).toBe("red");
    expect(r.overflow.iron).toBeCloseTo(30);
  });
});

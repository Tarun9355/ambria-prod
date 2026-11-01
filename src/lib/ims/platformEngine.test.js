import { describe, it, expect } from "vitest";
import {
  buildEventPlatformAllocation,
  computePlatformPoolFeasibility,
  allocatePlatformForDate,
  applyPlatformOverridesToEvents,
  simulatePlatformImpact,
  platformAvgRatePerSqft,
} from "./platformEngine";

describe("buildEventPlatformAllocation", () => {
  const meta = { eoId: "eo1", clientId: "c1", clientName: "Test Client", createdAt: 100 };

  it("sums floorDims L×W×qty for a zone with a Height band picked, keyed by trussMaterial", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 10, W: 5 }, plQty: 2, trussMaterial: "pole" },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ pole: 100 }); // 10*5*2
    expect(out.eoId).toBe("eo1");
  });

  it("ignores a zone with no Height band picked (plH falsy), even with floorDims set", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: null, floorDims: { L: 10, W: 5 }, trussMaterial: "iron" },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({});
  });

  it("defaults to iron when trussMaterial is unset", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 4, W: 4 } },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ iron: 16 });
  });

  it("skips a zone disabled via enabledEls", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 10, W: 10 } },
      z2: { plH: "1ft", floorDims: { L: 5, W: 5 } },
    }, enabledEls: { z1: true } }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ iron: 100 });
  });

  it("sums multiple zones of the same material across functions", () => {
    const fnList = [
      { fnIdx: 0, zones: { z1: { plH: "1ft", floorDims: { L: 10, W: 10 }, trussMaterial: "aluminium" } }, enabledEls: {} },
      { fnIdx: 1, zones: { z1: { plH: "1ft", floorDims: { L: 5, W: 5 }, trussMaterial: "aluminium" } }, enabledEls: {} },
    ];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ aluminium: 125 });
  });
});

describe("computePlatformPoolFeasibility", () => {
  const trussInv = {
    platforms: [{ lengthFt: 8, widthFt: 4, stock: 10 }], // 320 sqft iron stock
    materials: { pole: { platforms: [{ lengthFt: 4, widthFt: 4, stock: 5 }] } }, // 80 sqft pole stock
  };

  it("is feasible when demand fits within stock per material", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { iron: 200 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalPlatformSqftByMaterial: { pole: 50 } },
    ];
    const r = computePlatformPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(true);
    expect(r.stock.iron).toBe(320);
    expect(r.stock.pole).toBe(80);
    expect(events.every(e => !e.shortageBorne)).toBe(true);
  });

  it("gives hard events priority and marks the later soft event as bearing the shortage", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { iron: 300 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalPlatformSqftByMaterial: { iron: 50 } },
    ];
    const r = computePlatformPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(false);
    expect(r.overflow.iron).toBeCloseTo(30);
    expect(events.find(e => e.eoId === "e1").shortageBorne).toBe(false);
    expect(events.find(e => e.eoId === "e2").shortageBorne).toBe(true);
  });

  it("falls back to Iron's stock for a material with nothing configured of its own", () => {
    const events = [{ eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { aluminium: 100 } }];
    const r = computePlatformPoolFeasibility(events, trussInv);
    expect(r.stock.aluminium).toBe(320); // inherits Iron's 320 sqft
    expect(r.feasible).toBe(true);
  });
});

describe("allocatePlatformForDate", () => {
  const trussInv = { platforms: [{ lengthFt: 8, widthFt: 4, stock: 10 }] };

  it("writes a fresh entry for the date with the feasibility summary", () => {
    const events = [{ eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { iron: 100 } }];
    const out = allocatePlatformForDate({}, "2026-12-01", events, trussInv, "test");
    expect(out["2026-12-01"].events).toBe(events);
    expect(out["2026-12-01"].stockSummary.feasible).toBe(true);
    expect(out["2026-12-01"].lastCascadeBy).toBe("test");
  });

  it("deletes the date entry when the events list is empty", () => {
    const existing = { "2026-12-01": { events: [] } };
    const out = allocatePlatformForDate(existing, "2026-12-01", [], trussInv);
    expect(out["2026-12-01"]).toBeUndefined();
  });

  it("leaves the existing entry untouched when trussInv is not loaded", () => {
    const existing = { "2026-12-01": { events: ["stale"] } };
    const out = allocatePlatformForDate(existing, "2026-12-01", [{ eoId: "e1" }], null);
    expect(out["2026-12-01"]).toEqual({ events: ["stale"] });
  });
});

describe("applyPlatformOverridesToEvents", () => {
  it("replaces totalPlatformSqftByMaterial for an overridden event and marks hasOverride", () => {
    const events = [{ eoId: "e1", totalPlatformSqftByMaterial: { iron: 50 } }];
    const overrides = { e1: { totalPlatformSqftByMaterial: { iron: 80 }, reason: "extra deck added on site", overrideBy: "Krati" } };
    const out = applyPlatformOverridesToEvents(events, overrides);
    expect(out[0].totalPlatformSqftByMaterial).toEqual({ iron: 80 });
    expect(out[0].hasOverride).toBe(true);
    expect(out[0].override.overrideBy).toBe("Krati");
  });

  it("leaves an event with no matching override unchanged", () => {
    const events = [{ eoId: "e1", totalPlatformSqftByMaterial: { iron: 50 } }];
    const out = applyPlatformOverridesToEvents(events, { e2: {} });
    expect(out[0]).toEqual(events[0]);
  });
});

describe("simulatePlatformImpact", () => {
  const trussInv = { platforms: [{ lengthFt: 10, widthFt: 10, stock: 2 }] }; // 200 sqft iron stock

  it("returns green when the simulated sqft fits comfortably", () => {
    const sim = { mode: "independent", zones: [{ material: "iron", sqft: 50 }] };
    const r = simulatePlatformImpact(sim, null, [], trussInv);
    expect(r.status).toBe("green");
    expect(r.demand).toEqual({ iron: 50 });
  });

  it("returns red with an overflow figure when demand exceeds remaining stock", () => {
    const dateAlloc = { events: [{ totalPlatformSqftByMaterial: { iron: 180 } }] };
    const sim = { mode: "independent", zones: [{ material: "iron", sqft: 50 }] };
    const r = simulatePlatformImpact(sim, dateAlloc, [], trussInv);
    expect(r.status).toBe("red");
    expect(r.overflow.iron).toBeCloseTo(30);
  });

  it("stacks onto other compound drafts when mode is compound", () => {
    const sim = { mode: "compound", zones: [{ material: "iron", sqft: 50 }] };
    const otherDrafts = [{ computed: { demand: { iron: 170 } } }];
    const r = simulatePlatformImpact(sim, null, otherDrafts, trussInv);
    expect(r.status).toBe("red");
    expect(r.overflow.iron).toBeCloseTo(20);
  });

  it("returns gray with no entered sqft", () => {
    const r = simulatePlatformImpact({ mode: "independent", zones: [] }, null, [], trussInv);
    expect(r.status).toBe("gray");
  });
});

describe("platformAvgRatePerSqft", () => {
  it("weights the average by each row's own stock sqft", () => {
    const trussInv = { platforms: [
      { lengthFt: 10, widthFt: 10, stock: 1, ratePerSqft: 10 }, // 100 sqft @ ₹10
      { lengthFt: 10, widthFt: 10, stock: 3, ratePerSqft: 20 }, // 300 sqft @ ₹20
    ] };
    // (100*10 + 300*20) / (100+300) = 7000/400 = 17.5
    expect(platformAvgRatePerSqft(trussInv, "iron")).toBeCloseTo(17.5);
  });

  it("returns 0 when the material has no configured rows", () => {
    expect(platformAvgRatePerSqft({ platforms: [] }, "iron")).toBe(0);
  });

  it("falls back to Iron's rows for a material with nothing of its own", () => {
    const trussInv = { platforms: [{ lengthFt: 5, widthFt: 5, stock: 2, ratePerSqft: 12 }] };
    expect(platformAvgRatePerSqft(trussInv, "pole")).toBeCloseTo(12);
  });
});

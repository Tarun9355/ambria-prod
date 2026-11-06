import { describe, it, expect } from "vitest";
import {
  buildEventPlatformAllocation,
  platformEventSqft,
  computePlatformPoolFeasibility,
  allocatePlatformForDate,
  applyPlatformOverridesToEvents,
  simulatePlatformImpact,
  platformAvgRatePerSqft,
  platformMaterialOf,
  platformStockSqft,
  platformTotalStockSqft,
  PLATFORM_POOL_KEY,
} from "./platformEngine";

describe("buildEventPlatformAllocation — one combined pool (owner decision, 2026-11-05)", () => {
  const meta = { eoId: "eo1", clientId: "c1", clientName: "Test Client", createdAt: 100 };

  it("sums floorDims L×W×qty for a zone with a Height band picked, into the single combined pool, ignoring trussMaterial", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 10, W: 5 }, plQty: 2, trussMaterial: "pole" },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ [PLATFORM_POOL_KEY]: 100 }); // 10*5*2
    expect(out.eoId).toBe("eo1");
  });

  it("ignores a zone with no Height band picked (plH falsy), even with floorDims set", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: null, floorDims: { L: 10, W: 5 }, trussMaterial: "iron" },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({});
  });

  it("pools demand regardless of trussMaterial (unset, iron, pole, aluminium all land in the same bucket)", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 4, W: 4 } },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ all: 16 });
  });

  it("skips a zone disabled via enabledEls", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { plH: "1ft", floorDims: { L: 10, W: 10 } },
      z2: { plH: "1ft", floorDims: { L: 5, W: 5 } },
    }, enabledEls: { z1: true } }];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ all: 100 });
  });

  it("sums multiple zones across functions into the one pool, regardless of each zone's trussMaterial", () => {
    const fnList = [
      { fnIdx: 0, zones: { z1: { plH: "1ft", floorDims: { L: 10, W: 10 }, trussMaterial: "aluminium" } }, enabledEls: {} },
      { fnIdx: 1, zones: { z1: { plH: "1ft", floorDims: { L: 5, W: 5 }, trussMaterial: "pole" } }, enabledEls: {} },
    ];
    const out = buildEventPlatformAllocation(meta, fnList);
    expect(out.totalPlatformSqftByMaterial).toEqual({ all: 125 });
  });

  it("counts extraPlatformRows too, each with its own plH/floorDims/plQty (confirmed gap closed 2026-11-05 — billing already counted these, demand didn't)", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: {
        plH: "1ft", floorDims: { L: 10, W: 5 }, plQty: 1,
        extraPlatformRows: [{ plH: "2ft", floorDims: { L: 4, W: 4 }, plQty: 2 }],
      },
    }, enabledEls: {} }];
    const out = buildEventPlatformAllocation(meta, fnList);
    // row 0: 10*5*1 = 50; extra row: 4*4*2 = 32; total 82
    expect(out.totalPlatformSqftByMaterial).toEqual({ all: 82 });
  });
});

describe("platformEventSqft — folds any shape of totalPlatformSqftByMaterial into one number", () => {
  it("sums a new single-key {all} entry", () => {
    expect(platformEventSqft({ totalPlatformSqftByMaterial: { all: 120 } })).toBe(120);
  });
  it("sums an OLD saved {iron, pole, aluminium} split — no data migration needed", () => {
    expect(platformEventSqft({ totalPlatformSqftByMaterial: { iron: 150, pole: 100 } })).toBe(250);
  });
  it("returns 0 for an event with no platform demand at all", () => {
    expect(platformEventSqft({ totalPlatformSqftByMaterial: {} })).toBe(0);
    expect(platformEventSqft({})).toBe(0);
  });
});

describe("computePlatformPoolFeasibility — one combined pool, not per-material isolation", () => {
  const trussInv = {
    platforms: [
      { lengthFt: 8, widthFt: 4, stock: 10, material: "Iron" }, // 320 sqft
      { lengthFt: 4, widthFt: 4, stock: 5, material: "Wood" },  // 80 sqft
    ],
  }; // 400 sqft combined

  it("is feasible when combined demand fits within combined stock", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { all: 200 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalPlatformSqftByMaterial: { all: 50 } },
    ];
    const r = computePlatformPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(true);
    expect(r.stock.all).toBe(400);
    expect(events.every(e => !e.shortageBorne)).toBe(true);
  });

  it("gives hard events priority and marks the later soft event as bearing the shortage", () => {
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { all: 380 } },
      { eoId: "e2", state: "soft", createdAt: 2, totalPlatformSqftByMaterial: { all: 50 } },
    ];
    const r = computePlatformPoolFeasibility(events, trussInv);
    expect(r.feasible).toBe(false);
    expect(r.overflow.all).toBeCloseTo(30);
    expect(events.find(e => e.eoId === "e1").shortageBorne).toBe(false);
    expect(events.find(e => e.eoId === "e2").shortageBorne).toBe(true);
  });

  it("ignores trussInv.materials[x].platforms entirely — that structure was never real for platforms", () => {
    const withBogusMaterials = { ...trussInv, materials: { pole: { platforms: [{ lengthFt: 100, widthFt: 100, stock: 50 }] } } };
    const r = computePlatformPoolFeasibility([], withBogusMaterials);
    expect(r.stock.all).toBe(400); // unaffected by the huge bogus pole.platforms row
  });

  it("an OLD saved event with multiple legacy keys ({iron, pole}) collapses to ONE number before any stock comparison, not checked as separate independent buckets", () => {
    // Regression for a subtlety the rewrite specifically avoids: naively iterating
    // Object.entries(ev.totalPlatformSqftByMaterial) per event would check {iron:200} and
    // {pole:100} independently against the SAME full stock total (400), both "fitting" on their
    // own even though together (plus the soft event) they overbook the one real pool.
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { iron: 200, pole: 100 } }, // legacy shape, 300 combined — fits alone
      { eoId: "e2", state: "soft", createdAt: 2, totalPlatformSqftByMaterial: { iron: 150 } }, // legacy shape, 150 — combined total 450 > 400
    ];
    const r = computePlatformPoolFeasibility(events, trussInv); // 400 sqft stock
    expect(r.demand.all).toBe(450);
    expect(r.feasible).toBe(false);
    expect(r.overflow.all).toBeCloseTo(50);
    expect(events.find(e => e.eoId === "e1").shortageBorne).toBe(false); // hard, fits alone (300 < 400)
    expect(events.find(e => e.eoId === "e2").shortageBorne).toBe(true); // soft, only 100 remains, needs 150
  });

  it("a pole-truss zone's demand and an iron-truss zone's demand share ONE pool — the bug this closes", () => {
    // Under the old per-truss-material isolation, "pole" demand and "iron" demand were each checked
    // against the SAME full stock total independently, so this combination used to pass as feasible
    // even though it genuinely overbooks the one physical pool.
    const events = [
      { eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { all: 200 } }, // was an "iron" zone
      { eoId: "e2", state: "hard", createdAt: 2, totalPlatformSqftByMaterial: { all: 200 } }, // was a "pole" zone
    ];
    const feasibleBoundary = computePlatformPoolFeasibility(events, trussInv);
    expect(feasibleBoundary.feasible).toBe(true); // exactly 400 of 400 — still fits

    const events2 = [...events, { eoId: "e3", state: "soft", createdAt: 3, totalPlatformSqftByMaterial: { all: 50 } }]; // was "aluminium"
    const r = computePlatformPoolFeasibility(events2, trussInv);
    expect(r.feasible).toBe(false);
    expect(r.overflow.all).toBeCloseTo(50);
    expect(events2.find(e => e.eoId === "e3").shortageBorne).toBe(true);
  });
});

describe("allocatePlatformForDate", () => {
  const trussInv = { platforms: [{ lengthFt: 8, widthFt: 4, stock: 10, material: "Iron" }] };

  it("writes a fresh entry for the date with the feasibility summary", () => {
    const events = [{ eoId: "e1", state: "hard", createdAt: 1, totalPlatformSqftByMaterial: { all: 100 } }];
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
    const events = [{ eoId: "e1", totalPlatformSqftByMaterial: { all: 50 } }];
    const overrides = { e1: { totalPlatformSqftByMaterial: { all: 80 }, reason: "extra deck added on site", overrideBy: "Krati" } };
    const out = applyPlatformOverridesToEvents(events, overrides);
    expect(out[0].totalPlatformSqftByMaterial).toEqual({ all: 80 });
    expect(out[0].hasOverride).toBe(true);
    expect(out[0].override.overrideBy).toBe("Krati");
  });

  it("leaves an event with no matching override unchanged", () => {
    const events = [{ eoId: "e1", totalPlatformSqftByMaterial: { all: 50 } }];
    const out = applyPlatformOverridesToEvents(events, { e2: {} });
    expect(out[0]).toEqual(events[0]);
  });

  it("an OLD saved override shape ({iron: 80}) still works — platformEventSqft sums whatever keys are there", () => {
    const events = [{ eoId: "e1", totalPlatformSqftByMaterial: { all: 50 } }];
    const overrides = { e1: { totalPlatformSqftByMaterial: { iron: 80 }, reason: "legacy override" } };
    const out = applyPlatformOverridesToEvents(events, overrides);
    expect(platformEventSqft(out[0])).toBe(80);
  });
});

describe("simulatePlatformImpact — single combined pool, material ignored", () => {
  const trussInv = { platforms: [{ lengthFt: 10, widthFt: 10, stock: 2, material: "Iron" }] }; // 200 sqft stock

  it("returns green when the simulated sqft fits comfortably", () => {
    const sim = { mode: "independent", zones: [{ sqft: 50 }] };
    const r = simulatePlatformImpact(sim, null, [], trussInv);
    expect(r.status).toBe("green");
    expect(r.demand).toEqual({ all: 50 });
  });

  it("ignores a stale `material` field on a sim row if one is still sent", () => {
    const sim = { mode: "independent", zones: [{ material: "pole", sqft: 50 }] };
    const r = simulatePlatformImpact(sim, null, [], trussInv);
    expect(r.demand).toEqual({ all: 50 });
  });

  it("returns red with an overflow figure when demand exceeds remaining stock", () => {
    const dateAlloc = { events: [{ totalPlatformSqftByMaterial: { all: 180 } }] };
    const sim = { mode: "independent", zones: [{ sqft: 50 }] };
    const r = simulatePlatformImpact(sim, dateAlloc, [], trussInv);
    expect(r.status).toBe("red");
    expect(r.overflow.all).toBeCloseTo(30);
  });

  it("stacks onto other compound drafts when mode is compound", () => {
    const sim = { mode: "compound", zones: [{ sqft: 50 }] };
    const otherDrafts = [{ computed: { demand: { all: 170 } } }];
    const r = simulatePlatformImpact(sim, null, otherDrafts, trussInv);
    expect(r.status).toBe("red");
    expect(r.overflow.all).toBeCloseTo(20);
  });

  it("returns gray with no entered sqft", () => {
    const r = simulatePlatformImpact({ mode: "independent", zones: [] }, null, [], trussInv);
    expect(r.status).toBe("gray");
  });
});

describe("platformMaterialOf — normalises a row's own material", () => {
  it("recognises Wood in any casing/padding/suffix", () => {
    expect(platformMaterialOf({ material: "Wood" })).toBe("wood");
    expect(platformMaterialOf({ material: "wood " })).toBe("wood");
    expect(platformMaterialOf({ material: "WOOD deck" })).toBe("wood");
  });
  it("falls back to iron for anything else — missing, empty, a metal name, typos", () => {
    expect(platformMaterialOf({ material: "Iron" })).toBe("iron");
    expect(platformMaterialOf({ material: "iron" })).toBe("iron");
    expect(platformMaterialOf({ material: "" })).toBe("iron");
    expect(platformMaterialOf({})).toBe("iron");
    expect(platformMaterialOf({ material: "Steel" })).toBe("iron");
  });
});

// Real production platform rows (read 2026-11-05 via a read-only audit_log query during this
// incident) — 7 rows, 6 metal (Iron/iron) totalling 12416 sqft, 1 Wood totalling 4800 sqft.
const PROD_PLATFORMS = [
  { id: "plat_mvp6ju3gyni", label: "Platform 8*4*4''", stock: 80, widthFt: 4, lengthFt: 8, material: "iron", ratePerSqft: 10, thicknessIn: 4 },
  { id: "plat_mvp6jxhd2hf", label: "Platform 8*4*3''", stock: 120, widthFt: 4, lengthFt: 8, material: "Iron", ratePerSqft: 10, thicknessIn: 3 },
  { id: "plat_mvp6oefi3ew", label: "Platform 6*4", stock: 18, widthFt: 4, lengthFt: 8, material: "iron", ratePerSqft: 10, thicknessIn: 4 },
  { id: "plat_mvp6of5x2ja", label: "Platform 4*4", stock: 4, widthFt: 4, lengthFt: 8, material: "Iron", ratePerSqft: 10, thicknessIn: 4 },
  { id: "plat_mvp6rio0sbl", label: "Platform 6*3", stock: 16, widthFt: 4, lengthFt: 8, material: "iron", ratePerSqft: 10, thicknessIn: 4 },
  { id: "plat_mvp6sebj2u1", label: "Platform 8*4*4''", stock: 150, widthFt: 4, lengthFt: 8, material: "Wood", ratePerSqft: 10, thicknessIn: 4 },
  { id: "plat_mvqjh1g1xe1", label: "Platform 8*4*2.5''", stock: 150, widthFt: 4, lengthFt: 8, material: "Iron", ratePerSqft: 10, thicknessIn: 2.5 },
];

describe("production fixture — regression lock for the 2026-11-05 Wood/Iron fix", () => {
  const trussInv = { platforms: PROD_PLATFORMS };

  it("splits real stock correctly into Iron and Wood", () => {
    expect(platformStockSqft(trussInv, "iron")).toBe(12416);
    expect(platformStockSqft(trussInv, "wood")).toBe(4800);
    expect(platformTotalStockSqft(trussInv)).toBe(17216);
  });

  it("no longer gives truss-material buckets the full total — the bug this closes", () => {
    expect(platformStockSqft(trussInv, "pole")).toBe(0);
    expect(platformStockSqft(trussInv, "aluminium")).toBe(0);
  });
});

describe("platformAvgRatePerSqft — blended billing (owner decision, 2026-11-05)", () => {
  it("blends across ALL rows (Wood + Iron) when no material is given — this is what billing uses now", () => {
    const trussInv = { platforms: [
      { lengthFt: 10, widthFt: 10, stock: 48, material: "Wood", ratePerSqft: 10 },  // 4800 sqft @ ₹10
      { lengthFt: 10, widthFt: 10, stock: 124.16, material: "Iron", ratePerSqft: 20 }, // 12416 sqft @ ₹20
    ] };
    // (4800*10 + 12416*20) / (4800+12416) = (48000+248320)/17216 ≈ 17.212
    expect(platformAvgRatePerSqft(trussInv)).toBeCloseTo(17.212, 2);
  });

  it("a specific material still returns just that bucket's own weighted rate", () => {
    const trussInv = { platforms: [
      { lengthFt: 10, widthFt: 10, stock: 1, material: "Wood", ratePerSqft: 10 },
      { lengthFt: 10, widthFt: 10, stock: 1, material: "Iron", ratePerSqft: 20 },
    ] };
    expect(platformAvgRatePerSqft(trussInv, "wood")).toBeCloseTo(10);
    expect(platformAvgRatePerSqft(trussInv, "iron")).toBeCloseTo(20);
  });

  it("returns 0 when there are no configured rows at all", () => {
    expect(platformAvgRatePerSqft({ platforms: [] })).toBe(0);
  });

  it("a truss-material string (e.g. 'pole') is not a platform material — returns 0, never falls back to the full array", () => {
    const trussInv = { platforms: [{ lengthFt: 5, widthFt: 5, stock: 2, material: "Iron", ratePerSqft: 12 }] };
    expect(platformAvgRatePerSqft(trussInv, "pole")).toBe(0);
  });
});

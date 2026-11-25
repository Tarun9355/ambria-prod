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
  platformPiecesFor,
  platformPullPlan,
  platformPullPlansByFn,
  platformFloorsFromParts,
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

describe("platformPiecesFor — sqft-only path (no floor dimensions known), back-compat wrapper over platformPullPlan (owner ask, 2026-11-23)", () => {
  it("one configured size: plain ceiling division", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPiecesFor(100, trussInv)).toEqual([{ id: "a", label: "8×4ft", lengthFt: 8, widthFt: 4, material: "wood", sqftPerPiece: 32, qty: 4 }]); // 100/32 -> 4 pieces
  });

  it("largest size first, draws down its own stock before moving to a smaller size", () => {
    const trussInv = { platforms: [
      { id: "big", lengthFt: 10, widthFt: 10, stock: 5, material: "Iron" }, // 100 sqft/pc, 500 sqft stock
      { id: "small", lengthFt: 4, widthFt: 4, stock: 50, material: "Iron" }, // 16 sqft/pc
    ] };
    const out = platformPiecesFor(560, trussInv); // 500 from 5 big + 60 from small (ceil(60/16)=4 -> 64)
    expect(out).toEqual([
      { id: "big", label: "10×10ft", lengthFt: 10, widthFt: 10, material: "iron", sqftPerPiece: 100, qty: 5 },
      { id: "small", label: "4×4ft", lengthFt: 4, widthFt: 4, material: "iron", sqftPerPiece: 16, qty: 4 },
    ]);
  });

  it("once every size's stock is exhausted, the remainder still reports against the smallest size, flagged overStock", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 2, material: "Wood" }] }; // 32 sqft/pc, 64 sqft stock
    const out = platformPiecesFor(100, trussInv); // 64 from stock + 36 remaining -> ceil(36/32)=2 more
    expect(out).toEqual([{ id: "a", label: "8×4ft", lengthFt: 8, widthFt: 4, material: "wood", sqftPerPiece: 32, qty: 4, overStock: 2 }]);
  });

  it("no configured sizes or zero/negative need: empty", () => {
    expect(platformPiecesFor(100, { platforms: [] })).toEqual([]);
    expect(platformPiecesFor(0, { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 10 }] })).toEqual([]);
  });

  it("a custom label overrides the dims-based default", () => {
    const trussInv = { platforms: [{ id: "a", label: "Big Wood Deck", lengthFt: 8, widthFt: 4, stock: 10, material: "Wood" }] };
    expect(platformPiecesFor(32, trussInv)[0].label).toBe("Big Wood Deck");
  });

  it("regression (2026-11-23 review, finding 2a): never rounds a scarce large size up when a smaller size can finish the job", () => {
    // 101 sqft against a 100-sqft size and a 16-sqft size: ceil-at-every-step used to reach for a
    // SECOND 100-sqft piece (200 sqft total) instead of one of each (116 sqft).
    const trussInv = { platforms: [
      { id: "big", lengthFt: 10, widthFt: 10, stock: 10, material: "Iron" },
      { id: "small", lengthFt: 4, widthFt: 4, stock: 50, material: "Iron" },
    ] };
    expect(platformPiecesFor(101, trussInv)).toEqual([
      { id: "big", label: "10×10ft", lengthFt: 10, widthFt: 10, material: "iron", sqftPerPiece: 100, qty: 1 },
      { id: "small", label: "4×4ft", lengthFt: 4, widthFt: 4, material: "iron", sqftPerPiece: 16, qty: 1 },
    ]);
  });

  it("regression (2026-11-23 review, finding 2b): each physical floor rounds up on its own — pooling before rounding undercounts", () => {
    // Three separate 16-sqft floors against only a 32-sqft piece size: each floor needs its OWN whole
    // piece (3 total) — a piece can't be split across two floors, even though pooling the sqft first
    // (48 sqft) and rounding once would read as only ceil(48/32) = 2.
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPiecesFor([16, 16, 16], trussInv)).toEqual([
      { id: "a", label: "8×4ft", lengthFt: 8, widthFt: 4, material: "wood", sqftPerPiece: 32, qty: 3 },
    ]);
  });

  it("stock is shared and drawn down ACROSS floors in one call, not re-offered fresh to each floor", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 2, material: "Wood" }] }; // 32 sqft/pc, 64 sqft stock
    // Three floors each needing exactly one piece: the first two come from real stock, the third is overStock.
    expect(platformPiecesFor([30, 30, 30], trussInv)).toEqual([
      { id: "a", label: "8×4ft", lengthFt: 8, widthFt: 4, material: "wood", sqftPerPiece: 32, qty: 3, overStock: 1 },
    ]);
  });
});

describe("platformFloorsFromParts — a DealCheckOverlay.jsx part -> floor dims (2026-11-25)", () => {
  it("uses the real numeric fields when present", () => {
    expect(platformFloorsFromParts([{ zone: "Stage", fn: "", floorL: 16, floorW: 24, copies: 1, qty: 384 }]))
      .toEqual([{ L: 16, W: 24, copies: 1, label: "Stage" }]);
  });

  it("falls back to parsing a legacy 'L × W ×copies' dims string (a part saved before this shipped)", () => {
    expect(platformFloorsFromParts([{ zone: "Stage", dims: "16 × 24 ×2", qty: 768 }]))
      .toEqual([{ L: 16, W: 24, copies: 2, label: "Stage" }]);
    expect(platformFloorsFromParts([{ zone: "Stage", dims: "16 × 24", qty: 384 }]))
      .toEqual([{ L: 16, W: 24, copies: 1, label: "Stage" }]);
  });

  it("falls back to sqft-only when dims can't be parsed, or disagree with the billed sqft", () => {
    expect(platformFloorsFromParts([{ zone: "Stage", dims: "huh", qty: 384 }])).toEqual([{ sqft: 384, label: "Stage" }]);
    expect(platformFloorsFromParts([{ zone: "Stage", dims: "16 × 24", qty: 500 }])).toEqual([{ sqft: 500, label: "Stage" }]);
  });
});

describe("platformPullPlan — real geometric tiling (owner report, 2026-11-25)", () => {
  it("tiles a floor exactly when its own L×W divides evenly by a configured size", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood", thicknessIn: 4 }] };
    const plan = platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(plan.pieces[0].qty).toBe(12);
    expect(plan.floors[0].fit).toBe("exact");
    expect(plan.floors[0].builtL).toBe(16);
    expect(plan.floors[0].builtW).toBe(24);
  });

  it("tries the floor rotated 90° too", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPullPlan([{ L: 4, W: 8 }], trussInv).floors[0].fit).toBe("exact");
    const plan = platformPullPlan([{ L: 24, W: 16 }], trussInv);
    expect(plan.floors[0].fit).toBe("exact");
    expect(plan.pieces[0].qty).toBe(12);
  });

  it("owner's example: a 10×10 floor can't be tiled by an 8×4 piece even though the sqft divides - flagged, never empty", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    const plan = platformPullPlan([{ L: 10, W: 10 }], trussInv);
    expect(plan.floors[0].fit).toBe("unresolved");
    expect(plan.floors[0].tilingUnresolved).toBe(true);
    expect(plan.flags.tilingUnresolved).toBe(true);
    expect(plan.pieces.reduce((s, p) => s + p.qty, 0)).toBe(4); // still a concrete pull list, never nothing
  });

  it("a mix of sizes can tile an otherwise-awkward floor exactly", () => {
    const trussInv = { platforms: [
      { id: "big", lengthFt: 8, widthFt: 4, stock: 10, material: "Iron" },
      { id: "mid", lengthFt: 2, widthFt: 4, stock: 10, material: "Iron" },
      { id: "small", lengthFt: 2, widthFt: 2, stock: 10, material: "Iron" },
    ] };
    const plan = platformPullPlan([{ L: 10, W: 10 }], trussInv);
    expect(plan.floors[0].fit).toBe("exact");
    expect(plan.pieces.reduce((s, p) => s + p.qty * p.sqftPerPiece, 0)).toBe(100);
  });

  it("builds up to PLATFORM_OVERSIZE_MAX_FT bigger per side rather than flagging unresolved, when that's enough", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    const plan = platformPullPlan([{ L: 7, W: 8 }], trussInv);
    expect(plan.floors[0].fit).toBe("oversize");
    expect(plan.floors[0].builtL).toBe(8);
    expect(plan.floors[0].builtW).toBe(8);
    expect(plan.pieces.reduce((s, p) => s + p.qty, 0)).toBe(2);
  });

  // Regression (Opus review, 2026-11-25): the copy fast path reused the PREVIOUS floor's layout
  // whenever a later floor happened to share its exact L×W, not just for genuine copies of ONE
  // floor - and reported the floor's own requested size as "built", not the oversize layout's real
  // built size. Two different zones (different labels) that happen to share an awkward size exposed
  // this: the second zone's note read "builds as 7 × 15 ft" (its own request) instead of the actual
  // 8 × 16 ft the reused layout was built at.
  it("a later floor sharing an earlier one's size (but a different zone) reports its OWN actual built size, not the earlier floor's request", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    const plan = platformPullPlan([{ L: 7, W: 15, label: "Stage" }, { L: 7, W: 15, label: "Dance Floor" }], trussInv);
    expect(plan.floors[0].fit).toBe("oversize");
    expect(plan.floors[1].fit).toBe("oversize");
    expect(plan.floors[1].builtL).toBe(plan.floors[0].builtL);
    expect(plan.floors[1].builtW).toBe(plan.floors[0].builtW);
    // Both must report the SAME real built size, bigger than what was asked for, never "builds as 7 x 15"
    expect(plan.floors[1].builtL * plan.floors[1].builtW).toBeGreaterThan(7 * 15);
  });
});

describe("platformPullPlan — thickness-safe grouping, fix #1 (owner report, 2026-11-25)", () => {
  it("avoids a scarce thickness when a plentiful one of the same footprint can cover the whole floor alone", () => {
    const trussInv = { platforms: [
      { id: "t4", lengthFt: 8, widthFt: 4, stock: 5, material: "Iron", thicknessIn: 4 },
      { id: "t25", lengthFt: 8, widthFt: 4, stock: 100, material: "Iron", thicknessIn: 2.5 },
    ] };
    const plan = platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(plan.pieces.find((p) => p.id === "t25")?.qty).toBe(12);
    expect(plan.pieces.find((p) => p.id === "t4")).toBeUndefined();
    expect(plan.floors[0].mixedThickness).toBe(false);
  });

  it("flags mixedThickness when neither thickness alone can cover the floor", () => {
    const trussInv = { platforms: [
      { id: "t4", lengthFt: 8, widthFt: 4, stock: 6, material: "Iron", thicknessIn: 4 },
      { id: "t25", lengthFt: 8, widthFt: 4, stock: 6, material: "Iron", thicknessIn: 2.5 },
    ] };
    const plan = platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(plan.pieces.reduce((s, p) => s + p.qty, 0)).toBe(12);
    expect(plan.floors[0].mixedThickness).toBe(true);
    expect(plan.flags.mixedThickness).toBe(true);
    expect(plan.floors[0].thicknessIn.slice().sort()).toEqual([2.5, 4]);
  });

  it("stays single-thickness (flagged overStock) even when short, rather than mixing for no gain", () => {
    const trussInv = { platforms: [
      { id: "t4", lengthFt: 8, widthFt: 4, stock: 2, material: "Iron", thicknessIn: 4 },
      { id: "t25", lengthFt: 8, widthFt: 4, stock: 2, material: "Iron", thicknessIn: 2.5 },
    ] };
    const plan = platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(plan.floors[0].mixedThickness).toBe(false);
    expect(plan.floors[0].overStock).toBeGreaterThan(0);
    expect(plan.flags.overStock).toBe(true);
  });

  it("the same fix applies on the sqft-only path too (no floor dims known)", () => {
    const trussInv = { platforms: [
      { id: "t4", lengthFt: 8, widthFt: 4, stock: 1, material: "Iron", thicknessIn: 4 },
      { id: "t25", lengthFt: 8, widthFt: 4, stock: 10, material: "Iron", thicknessIn: 2.5 },
    ] };
    const out = platformPiecesFor(100, trussInv);
    expect(out.find((p) => p.id === "t25")?.qty).toBe(4);
    expect(out.find((p) => p.id === "t4")).toBeUndefined();
  });

  it("two rows of the same footprint and thickness but different material are NOT flagged mixed", () => {
    const trussInv = { platforms: [
      { id: "wood", lengthFt: 8, widthFt: 4, stock: 6, material: "Wood", thicknessIn: 4 },
      { id: "iron", lengthFt: 8, widthFt: 4, stock: 6, material: "Iron", thicknessIn: 4 },
    ] };
    const plan = platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(plan.floors[0].mixedThickness).toBe(false);
    expect(plan.pieces).toHaveLength(2);
    expect(plan.pieces.every((p) => p.qty === 6)).toBe(true);
  });
});

describe("platformPullPlan / platformPiecesFor — best-fit remainder, fix #2 (owner report, 2026-11-25)", () => {
  it("never reaches for a size that has zero real stock when a covering combination exists elsewhere", () => {
    const trussInv = { platforms: [
      { id: "big", lengthFt: 8, widthFt: 4, stock: 10, material: "Iron" }, // 32 sqft
      { id: "mid", lengthFt: 4, widthFt: 4, stock: 10, material: "Iron" }, // 16 sqft
      { id: "zero", lengthFt: 2, widthFt: 2, stock: 0, material: "Iron" }, // 4 sqft, no stock
    ] };
    const out = platformPiecesFor(100, trussInv);
    expect(out.find((p) => p.id === "zero")).toBeUndefined();
    expect(out.find((p) => p.id === "big")?.qty).toBe(3);
    expect(out.find((p) => p.id === "mid")?.qty).toBe(1);
    expect(out.some((p) => p.overStock)).toBe(false);
  });

  it("the waste the owner reported (128 sqft pulled for a 100 sqft need) is unavoidable when truly no smaller size is configured", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPiecesFor(100, trussInv)).toEqual([
      { id: "a", label: "8×4ft", lengthFt: 8, widthFt: 4, material: "wood", sqftPerPiece: 32, qty: 4 },
    ]);
  });
});

describe("platformPullPlan — stock sharing across copies of the same floor", () => {
  it("shares one stock pool across every copy, each copy still rounding/tiling on its own", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 20, material: "Iron", thicknessIn: 4 }] };
    const plan = platformPullPlan([{ L: 16, W: 24, copies: 2 }], trussInv);
    expect(plan.floors).toHaveLength(2);
    expect(plan.pieces[0].qty).toBe(24);
    expect(plan.pieces[0].overStock).toBe(4);
    expect(plan.floors[0].fit).toBe("exact");
  });
});

describe("platformPullPlan / platformPiecesFor — back-compat and safety", () => {
  it("platformPiecesFor is exactly platformPullPlan(...).pieces", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPiecesFor([{ L: 16, W: 24 }], trussInv)).toEqual(platformPullPlan([{ L: 16, W: 24 }], trussInv).pieces);
  });

  it("accepts a mixed array of bare numbers and floor objects", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    const out = platformPiecesFor([100, { L: 16, W: 24 }], trussInv);
    expect(out.reduce((s, p) => s + p.qty, 0)).toBe(4 + 12); // 100 sqft alone against only a 32-sqft size needs 4, same unavoidable-waste case above
  });

  it("never mutates the trussInv it was given (billing/allocation must never see stale/altered stock)", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 20, material: "Iron", thicknessIn: 4 }] };
    const before = JSON.stringify(trussInv);
    platformPullPlan([{ L: 16, W: 24 }], trussInv);
    expect(JSON.stringify(trussInv)).toBe(before);
  });

  it("the real production fixture (PROD_PLATFORMS) tiles a clean 16×24 floor from one thickness group (it has three; the 4in group alone suffices)", () => {
    const plan = platformPullPlan([{ L: 16, W: 24 }], { platforms: PROD_PLATFORMS });
    expect(plan.floors[0].fit).toBe("exact");
    expect(plan.floors[0].mixedThickness).toBe(false);
  });

  it("30 awkward floors against a realistic multi-size config: never throws, always answers, stays fast", () => {
    const trussInv = { platforms: PROD_PLATFORMS };
    const floors = [];
    for (let i = 0; i < 30; i++) floors.push({ L: 13.5 + (i % 5), W: 17 + (i % 7) });
    const t0 = Date.now();
    const plan = platformPullPlan(floors, trussInv);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(plan.floors).toHaveLength(30);
    expect(plan.floors.every((f) => !!f.fit)).toBe(true);
  });
});

describe("platformPullPlan — per-piece byFn attribution (owner ask, 2026-11-26: Inventory Blocked splits Platform into one row per piece type, each tracking its own per-function share)", () => {
  it("a piece's byFn totals each function's own share of that piece type, pooled across one shared stock call", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood", thicknessIn: 4 }] };
    const parts = [
      { zone: "Haldi stage", fn: "Haldi", fnIdx: 0, floorL: 16, floorW: 24, copies: 1, qty: 384 },
      { zone: "Wedding stage", fn: "Wedding", fnIdx: 1, floorL: 20, floorW: 32, copies: 1, qty: 640 },
    ];
    const plan = platformPullPlan(platformFloorsFromParts(parts), trussInv);
    const piece = plan.pieces[0];
    expect(piece.qty).toBe(32);
    expect(piece.byFn).toEqual({ 0: 12, 1: 20 });
  });

  it("byFn totals still sum to the piece's own qty even when thickness ends up mixed across functions", () => {
    const trussInv = { platforms: [
      { id: "t4", lengthFt: 8, widthFt: 4, stock: 6, material: "Iron", thicknessIn: 4 },
      { id: "t25", lengthFt: 8, widthFt: 4, stock: 6, material: "Iron", thicknessIn: 2.5 },
    ] };
    const plan = platformPullPlan([{ L: 16, W: 24, copies: 1, label: "Stage", fnIdx: 0 }], trussInv);
    const sumByFn = plan.pieces.reduce((s, p) => s + (p.byFn?.[0] || 0), 0);
    const sumQty = plan.pieces.reduce((s, p) => s + p.qty, 0);
    expect(sumByFn).toBe(sumQty);
  });

  it("no byFn field at all when no floor carries an fnIdx (bare sqft calls, the back-compat path)", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood" }] };
    expect(platformPullPlan(100, trussInv).pieces[0].byFn).toBeUndefined();
  });
});

describe("platformPullPlansByFn — one plan per function (owner call, 2026-11-25: plan each function separately, not pooled)", () => {
  it("groups parts by fnIdx and plans each group independently", () => {
    const trussInv = { platforms: [{ id: "a", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood", thicknessIn: 4 }] };
    const parts = [
      { zone: "Haldi stage", fn: "Haldi", fnIdx: 0, floorL: 16, floorW: 24, copies: 1, qty: 384 },
      { zone: "Wedding stage", fn: "Wedding", fnIdx: 1, floorL: 20, floorW: 32, copies: 1, qty: 640 },
    ];
    const byFn = platformPullPlansByFn(parts, trussInv);
    expect(byFn).toHaveLength(2);
    expect(byFn.find((b) => b.fnIdx === 0).plan.pieces[0].qty).toBe(12); // 384/32
    expect(byFn.find((b) => b.fnIdx === 1).plan.pieces[0].qty).toBe(20); // 640/32
  });
});

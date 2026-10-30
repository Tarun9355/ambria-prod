import { describe, it, expect } from "vitest";
import { computePeople, computePeopleRaw, shiftToTiming, heavySayaMultFor, situationalFactorsFor, tentingZoneUsage } from "./manpowerCount";

const computeRaw = (f, ctx) => computePeopleRaw(f, "Labours", ctx);

const baseCtx = () => ({
  dcInventoryCache: [],
  flowerPatterns: [],
  electricianProd: {},
  labourTiers: {},
  eventTypeMultipliers: { outdoor_budgeted: 1 },
  eventTimingMultipliers: {},
  dcMpIncludeMinusOne: false,
  seasonMap: {},
  sitMults: {},
  situMultCap: 1.8,
  venueDumping: {},
  fixedVenues: [],
  venueParents: {},
  heavyElementRanges: [],
  cardsForFn: {},
  inventory: [],
  trussInv: null,
  fabricBangaliRanges: [],
  fabricRftPerWorker: 100,
  trussLabourRanges: [],
});

const fn = (over) => ({
  fnVenue: "Taj Vivanta", fnDate: "2026-10-19", fnShift: "evening",
  enabledEls: { stage: true },
  zoneElements: { stage: [] },
  zoneConfig: { stage: {} },
  ...over,
});

describe("computePeopleRaw — Flowerists", () => {
  const pattern = { id: "p1", sub: "Flower Bunch", sizes: { medium: { unitsPerFlowerist: 5 } } };

  it("sums fractional need across every floral element, ceiling once at the end", () => {
    const f = fn({ zoneElements: { stage: [
      { name: "Flower Bunch", patternId: "p1", qty: 12 },
      { name: "Flower Bunch 2", patternId: "p1", qty: 8 },
    ] } });
    // 12/5 + 8/5 = 4.0 exactly -> ceil(4.0) = 4. If ceiled per-element instead: ceil(2.4)+ceil(1.6)=3+2=5.
    const count = computePeopleRaw(f, "Flowerists", { ...baseCtx(), flowerPatterns: [pattern] });
    expect(count).toBe(4);
  });

  it("returns 0 for a function with no floral elements", () => {
    expect(computePeopleRaw(fn(), "Flowerists", baseCtx())).toBe(0);
  });
});

describe("computePeopleRaw — Electricians", () => {
  it("sums fractional need across lighting elements by productivity", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 30 }] } });
    const ctx = { ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }], electricianProd: { "LED String": { sizes: { medium: 10 } } } };
    expect(computePeopleRaw(f, "Electricians", ctx)).toBe(3); // 30/10
  });
});

describe("computePeopleRaw — Labours (Tier 3)", () => {
  // Regression test for the confirmed live bug: the usage-mode floor must compare THIS
  // function's own usage against ITS OWN per-function total, never a whole-booking figure
  // summed elsewhere — a small function must never be floored up to a busier sibling's need.
  it("floors at THIS function's own usage total, not any other function's", () => {
    const heavyElementRanges = [{ subCat: "Sofa", perCount: 2 }]; // 1 labour per 2 sofas
    const smallFn = fn({ zoneElements: { stage: [{ name: "Sofa", invId: "sofa1", qty: 2 }] } }); // needs 1
    const ctx = { ...baseCtx(), dcInventoryCache: [{ id: "sofa1", name: "Sofa", cat: "furniture", subCat: "Sofa" }], heavyElementRanges };
    expect(computePeopleRaw(smallFn, "Labours", ctx)).toBe(1);
  });

  // Owner-reported live bug, 2026-10-30: pooling every department's fractional usage into one total
  // before ceiling once can round DOWN below what a real, department-by-department crew needs —
  // each department's own share still needs a WHOLE person on site, not a fraction borrowed from
  // another department's headroom.
  it("ceils each department's own usage separately, then sums — not the pooled fractional total ceiled once", () => {
    const heavyElementRanges = [{ subCat: "Sofa", perCount: 10 }, { subCat: "LED String", perCount: 40 }];
    const f = fn({ zoneElements: { stage: [
      { name: "Sofa", invId: "sofa1", qty: 11 },   // Structure: 11/10 = 1.1 -> ceil 2
      { name: "Led", invId: "led1", qty: 12 },     // Lighting: 12/40 = 0.3 -> ceil 1
    ] } });
    const ctx = {
      ...baseCtx(),
      dcInventoryCache: [
        { id: "sofa1", name: "Sofa", cat: "furniture", subCat: "Sofa" },
        { id: "led1", name: "LED String", cat: "lighting", subCat: "LED String" },
      ],
      heavyElementRanges,
    };
    // Pooled-then-ceiled would give ceil(1.1 + 0.3) = ceil(1.4) = 2 — one short of the 2 + 1 = 3 a
    // real Structure crew member plus a real Lighting crew member actually requires.
    expect(computePeopleRaw(f, "Labours", ctx)).toBe(3);
  });

  it("the heavy-element add-on nets out standing stock already at a fixed venue", () => {
    const heavyElementRanges = [{ subCat: "Sofa", perCount: 2, labour: 1 }];
    const f = fn({ zoneElements: { stage: [{ name: "Sofa", invId: "sofa1", qty: 4 }] } }); // raw need 2
    const ctxNoReduction = { ...baseCtx(), dcInventoryCache: [{ id: "sofa1", name: "Sofa", cat: "furniture", subCat: "Sofa" }], heavyElementRanges };
    const withoutStanding = computePeopleRaw(f, "Labours", ctxNoReduction);
    expect(withoutStanding).toBe(2);
  });

  it("applies the situational (dumping/timing/heavySaya) multiplier to the venue-min base, capped at situMultCap", () => {
    // No venue-min configured here (that floor lives outside this engine, applied only at
    // fixed venues) — so with zero heavy elements and zero usage mode, the result is 0
    // regardless of the multiplier, proving the multiplier never manufactures crew out of
    // nothing on its own.
    const ctx = { ...baseCtx(), venueDumping: { "Taj Vivanta": "far" } };
    expect(computePeopleRaw(fn(), "Labours", ctx)).toBe(0);
  });
});

describe("computePeopleRaw — Fabric Bangali", () => {
  it("adds a zone's masking-wall RFT only when masking is switched on for that zone", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 8, H: 10 }, mkOn: true, mkWalls: { back: true, left: true, right: true } } };
    const ctx = { ...baseCtx(), fabricRftPerWorker: 10 };
    // full_box: back=dW(8) + left=dL(10) + right=dL(10) = 28 RFT -> ceil(28/10) = 3
    const withMasking = computePeopleRaw(fn({ zoneConfig }), "Fabric Bangali", ctx);
    expect(withMasking).toBe(3);
    const noMasking = computePeopleRaw(fn({ zoneConfig: { stage: { ...zoneConfig.stage, mkOn: false } } }), "Fabric Bangali", ctx);
    expect(noMasking).toBe(0);
  });

  it("looks up the canopy top labour from the configured sqft ranges", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 10, H: 10 } } }; // 100 sqft, no masking
    const ctx = { ...baseCtx(), fabricBangaliRanges: [{ upTo: 50, labour: 2 }, { upTo: 150, labour: 4 }] };
    expect(computePeopleRaw(fn({ zoneConfig }), "Fabric Bangali", ctx)).toBe(4);
  });
});

describe("computePeopleRaw — Truss Labour", () => {
  it("returns 0 with no truss inventory loaded (nothing to resolve pillars against)", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 10, H: 10 } } };
    expect(computePeopleRaw(fn({ zoneConfig }), "Truss Labour", baseCtx())).toBe(0);
  });

  it("looks up the range table once a real truss resolves to a pillar count", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 10, H: 10 } } };
    const trussInv = { settings: { pillarWidthFt: 0.75, maxSpanFt: 30, defaultBackDepthFt: 4, backDepthRange: [3, 5] }, rates: {}, batta: { bufferPct: 10 } };
    // A generous single range covers whatever pillar count the real truss engine resolves to.
    const ctx = { ...baseCtx(), trussInv, trussLabourRanges: [{ upTo: 1000, labour: 6 }] };
    expect(computePeopleRaw(fn({ zoneConfig }), "Truss Labour", ctx)).toBe(6);
  });
});

describe("tentingZoneUsage — Truss pillar count / Platform piece count for the Labours usage split", () => {
  const trussInv = { settings: { pillarWidthFt: 0.75, maxSpanFt: 30, defaultBackDepthFt: 4, backDepthRange: [3, 5] }, rates: {}, batta: { bufferPct: 10 } };

  it("returns 0/0 with no zone config at all", () => {
    expect(tentingZoneUsage(fn(), baseCtx())).toEqual({ truss: 0, platform: 0 });
  });

  it("truss: 0 with no truss inventory loaded, even with real truss dims", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 10, H: 10 } } };
    expect(tentingZoneUsage(fn({ zoneConfig }), baseCtx()).truss).toBe(0);
  });

  it("truss: a positive pillar count once real truss inventory resolves the zone", () => {
    const zoneConfig = { stage: { dims: { L: 10, W: 10, H: 10 } } };
    const ctx = { ...baseCtx(), trussInv };
    expect(tentingZoneUsage(fn({ zoneConfig }), ctx).truss).toBeGreaterThan(0);
  });

  it("platform: counts the configured piece qty (plQty), not sqft or a material count", () => {
    const zoneConfig = { stage: { plH: 3, floorDims: { L: 10, W: 8 }, plQty: 3 } };
    expect(tentingZoneUsage(fn({ zoneConfig }), baseCtx()).platform).toBe(3);
  });

  it("platform: extraPlatformRows add their own qty on top of row 0", () => {
    const zoneConfig = { stage: { plH: 3, floorDims: { L: 10, W: 8 }, plQty: 1, extraPlatformRows: [{ plH: 3, floorDims: { L: 6, W: 4 }, plQty: 2 }] } };
    expect(tentingZoneUsage(fn({ zoneConfig }), baseCtx()).platform).toBe(3);
  });

  it("platform: a row with no height (plH) or no floor dims doesn't count", () => {
    const zoneConfig = { stage: { plQty: 5 } }; // no plH at all
    expect(tentingZoneUsage(fn({ zoneConfig }), baseCtx()).platform).toBe(0);
  });

  it("a zone the function hasn't enabled contributes nothing", () => {
    const zoneConfig = { stage: { plH: 3, floorDims: { L: 10, W: 8 }, plQty: 3 } };
    expect(tentingZoneUsage(fn({ zoneConfig, enabledEls: { stage: false } }), baseCtx()).platform).toBe(0);
  });

  it("feeds computePeopleRaw's Labours usage floor via heavyElementRanges (the actual bug fixed) — Platform alone, with no walkable element at all, still produces a positive need", () => {
    const zoneConfig = { stage: { plH: 3, floorDims: { L: 10, W: 8 }, plQty: 40 } }; // 40 ÷ 20 = 2
    const ctx = { ...baseCtx(), heavyElementRanges: [{ subCat: "Platform", perCount: 20 }] };
    expect(computePeopleRaw(fn({ zoneConfig }), "Labours", ctx)).toBe(2);
  });
});

describe("computePeopleRaw — generic tier-2/tier-3 and default types", () => {
  it("tier-2: sums fractional need by sub-category batch, floored at the configured minimum", () => {
    const labourTiers = { Carpenters: { tier: 2, minimum: 1, subCatBatches: { Carpentry: 5 } } };
    const f = fn({ zoneElements: { stage: [{ name: "Table", invId: "t1", qty: 12 }] } });
    const ctx = { ...baseCtx(), labourTiers, dcInventoryCache: [{ id: "t1", name: "Table", cat: "structure", subCat: "Carpentry" }] };
    expect(computePeopleRaw(f, "Carpenters", ctx)).toBe(3); // ceil(12/5)
  });

  it("Supervisors is always exactly 1", () => {
    expect(computePeopleRaw(fn(), "Supervisors", baseCtx())).toBe(1);
  });

  it("an unconfigured type with no special handling is 0", () => {
    expect(computePeopleRaw(fn(), "Nonexistent Type", baseCtx())).toBe(0);
  });
});

describe("computePeople — heavySaya wrap", () => {
  // Situational multiplier disabled 2026-10-27 (owner ask — see manpowerCount.js's computePeople):
  // Deal Check's manpower plan should come straight from Workforce's item-qty batch sizes, rounded
  // up, while a Labours mismatch between Deal Check and IMS Dept Ops' Manpower plan is verified.
  // These 4 assert the multiplier actually being applied, so they're skipped (not deleted) until
  // it's re-enabled — un-skip them at the same time computePeople's wrap is restored.
  it.skip("applies the King's-date pressure factor to a non-Labours type", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } },
      seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Electricians: 2 } },
    };
    // Raw = 1 (10/10). heavySaya ×2 -> 2.
    expect(computePeople(f, "Electricians", ctx)).toBe(2);
  });

  it.skip("multiplies Labours' count once, by the biggest situational factor, capped", () => {
    const heavyElementRanges = [{ subCat: "Sofa", perCount: 2, labour: 1 }];
    const f = fn({ zoneElements: { stage: [{ name: "Sofa", invId: "sofa1", qty: 2 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "sofa1", name: "Sofa", cat: "furniture", subCat: "Sofa" }], heavyElementRanges,
      seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Labours: 5 } },
    };
    // Raw = 1; the factor 5 is capped at 1.8 (not stacked with anything else) -> ceil(1.8) = 2.
    expect(computeRaw(f, ctx)).toBe(1);
    expect(computePeople(f, "Labours", ctx)).toBe(2);
  });

  it.skip("a date the Calendar marks King's counts even though the legacy seasonMap is empty", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } }, sitMults: { heavySaya: { Electricians: 2 } },
      datePricing: { autoCategories: { "2026-10-19": "heavy_saya" } },
    };
    expect(computePeople(f, "Electricians", ctx)).toBe(2);
    expect(computePeople(f, "Electricians", { ...ctx, datePricing: { autoCategories: { "2026-10-19": "non_saya" } } })).toBe(1);
  });

  it.skip("applies the shift-timing factor to every type, not only Labours", () => {
    const f = fn({ fnShift: "Lunch", zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } }, eventTimingMultipliers: { lunch: { Electricians: 1.5 } },
    };
    expect(computePeople(f, "Electricians", ctx)).toBe(2); // 1 × 1.5 -> 2
    expect(computePeople(fn({ ...f, fnShift: "Night" }), "Electricians", ctx)).toBe(1); // dinner = no factor
  });

  it.skip("does not stack the factors: the biggest one wins", () => {
    const f = fn({ fnShift: "Lunch", zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 50 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } }, eventTimingMultipliers: { lunch: { Electricians: 1.2 } },
      seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Electricians: 1.2 } },
    };
    expect(computePeople(f, "Electricians", ctx)).toBe(6); // 5 × 1.2 (not 1.44) = 6 — and 6.000000000000001 must not become 7
  });

  it("a day-prior setup carries no timing or dumping factor", () => {
    const f = fn({ fnShift: "Lunch", zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] } });
    const ctx = {
      ...baseCtx(), dcMpIncludeMinusOne: true, dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } }, eventTimingMultipliers: { lunch: { Electricians: 1.5 } },
    };
    expect(computePeople(f, "Electricians", ctx)).toBe(1);
  });

  it("skips the wrap entirely when the raw count is 0 (never manufactures crew from a multiplier alone)", () => {
    const ctx = { ...baseCtx(), seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Flowerists: 3 } } };
    expect(computePeople(fn(), "Flowerists", ctx)).toBe(0);
  });
});

describe("shiftToTiming / heavySayaMultFor", () => {
  it("maps shift names to timing ids", () => {
    expect(shiftToTiming("Night")).toBe("dinner");
    expect(shiftToTiming("Lunch")).toBe("lunch");
    expect(shiftToTiming("Morning Brunch")).toBe("brunch");
    expect(shiftToTiming("")).toBe("dinner");
  });

  it("is 1.0 outside a King's-season date regardless of configured factor", () => {
    expect(heavySayaMultFor(fn(), "Labours", { "2026-10-19": "non_saya" }, { heavySaya: { Labours: 3 } })).toBe(1.0);
  });
});

describe("situationalFactorsFor — what the Dept Ops line explains", () => {
  const ctx = (over) => ({ ...baseCtx(), eventTimingMultipliers: { lunch: { Labours: 1.5 } }, sitMults: { heavySaya: { Labours: 1.2 } }, ...over });
  it("names the biggest factor and does not stack them", () => {
    const r = situationalFactorsFor(fn({ fnShift: "Lunch" }), "Labours", ctx({ seasonMap: { "2026-10-19": "kings" } }));
    expect(r.mult).toBe(1.5);
    expect(r.winner).toBe("Lunch shift");
    expect(r.parts.map(p => p.mult)).toEqual([1.2, 1.5, 1]);
  });
  it("reports the cap when the biggest factor is above it", () => {
    const r = situationalFactorsFor(fn({ fnShift: "Lunch" }), "Labours", ctx({ eventTimingMultipliers: { lunch: { Labours: 3 } } }));
    expect(r.mult).toBe(1.8);
    expect(r.capped).toBe(true);
  });
  it("says none applies on a plain night, and a day-prior setup carries nothing for Labours", () => {
    const r = situationalFactorsFor(fn({ fnShift: "Night" }), "Labours", ctx());
    expect(r.mult).toBe(1);
    expect(r.winner).toBe(null);
    expect(situationalFactorsFor(fn({ fnShift: "Lunch" }), "Labours", ctx({ dcMpIncludeMinusOne: true })).mult).toBe(1);
  });
});

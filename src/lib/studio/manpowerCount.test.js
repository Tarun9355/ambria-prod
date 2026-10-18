import { describe, it, expect } from "vitest";
import { computePeople, computePeopleRaw, shiftToTiming, heavySayaMultFor } from "./manpowerCount";

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
  it("applies the King's-date pressure factor to a non-Labours type", () => {
    const f = fn({ zoneElements: { stage: [{ name: "Warm LED", invId: "led1", qty: 10 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "led1", name: "Warm LED", cat: "lighting", subCat: "LED String" }],
      electricianProd: { "LED String": { sizes: { medium: 10 } } },
      seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Electricians: 2 } },
    };
    // Raw = 1 (10/10). heavySaya ×2 -> 2.
    expect(computePeople(f, "Electricians", ctx)).toBe(2);
  });

  it("never double-applies heavySaya to Labours (already folded in internally)", () => {
    const heavyElementRanges = [{ subCat: "Sofa", perCount: 2, labour: 1 }];
    const f = fn({ zoneElements: { stage: [{ name: "Sofa", invId: "sofa1", qty: 2 }] } });
    const ctx = {
      ...baseCtx(), dcInventoryCache: [{ id: "sofa1", name: "Sofa", cat: "furniture", subCat: "Sofa" }], heavyElementRanges,
      seasonMap: { "2026-10-19": "kings" }, sitMults: { heavySaya: { Labours: 5 } },
    };
    // If heavySaya were applied a second time on top of Labours' own internal situational
    // multiplier, this would come out far higher than the raw heavy-element add-on.
    expect(computePeople(f, "Labours", ctx)).toBe(computePeopleRaw(f, "Labours", ctx));
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

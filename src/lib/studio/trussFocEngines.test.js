import { describe, it, expect } from "vitest";
import { buildEventAllocation } from "../ims/trussEngine";
import { buildEventBattaAllocation } from "../ims/battaEngine";
import { computePeopleRaw, tentingZoneUsage, fabricBangaliZone } from "./manpowerCount";

// FOC truss (owner ask 2026-11-17): already standing at the venue, so IMS reserves no pillars / beams / batta for it and no
// truss or fabric crew is counted. A normal truss next to it is untouched.
const trussInv = {
  settings: { maxSpanFt: 30, pillarWidthFt: 0.75, defaultBackDepthFt: 4, backDepthRange: [3, 5] },
  pillars: { 10: { stock: 50 }, 14: { stock: 50 } }, beams: { 14: { stock: 50 } },
  rates: {}, batta: { stockRft: 1000, bufferPct: 10 },
};
const meta = { eoId: "eo1", clientId: "c1", clientName: "Test", createdAt: 1 };
const T = { dims: { L: 16, W: 16, H: 10 }, trT: "box" };
const U = { dims: { L: 20, H: 10 }, trussType: "u_only" };

describe("FOC truss — IMS truss stock (trussEngine)", () => {
  it("reserves nothing for a FOC truss", () => {
    const out = buildEventAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...T, trussFoc: true } }, enabledEls: {} }], trussInv);
    expect(out.trusses).toHaveLength(0);
    expect(out.totalPillarsUsed).toEqual({});
    expect(out.totalBeamsUsed).toEqual({});
  });
  it("a FOC extra truss leaves the zone's own truss reserved exactly as before", () => {
    const alone = buildEventAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...T } }, enabledEls: {} }], trussInv);
    const mixed = buildEventAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...T, extraTrussRows: [{ ...T, id: "TR2", trussFoc: true }] } }, enabledEls: {} }], trussInv);
    expect(alone.trusses.length).toBeGreaterThan(0);
    expect(mixed.totalPillarsUsed).toEqual(alone.totalPillarsUsed);
    expect(mixed.totalBeamsUsed).toEqual(alone.totalBeamsUsed);
  });
  it("a FOC zone truss with a normal extra truss reserves only the extra one", () => {
    const extraOnly = buildEventAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...T } }, enabledEls: {} }], trussInv);
    const mixed = buildEventAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...T, trussFoc: true, extraTrussRows: [{ ...T, id: "TR2" }] } }, enabledEls: {} }], trussInv);
    expect(mixed.totalPillarsUsed).toEqual(extraOnly.totalPillarsUsed);
  });
});

describe("FOC truss — batta (battaEngine)", () => {
  it("no batta for a FOC truss; a normal one still gets it", () => {
    expect(buildEventBattaAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...U, trussFoc: true } }, enabledEls: {} }], trussInv).totalBattaRftByMaterial).toEqual({});
    expect(buildEventBattaAllocation(meta, [{ fnIdx: 0, zones: { z1: { ...U } }, enabledEls: {} }], trussInv).totalBattaRftByMaterial.iron).toBeGreaterThan(0);
  });
});

describe("FOC truss — crew (manpowerCount)", () => {
  const baseCtx = () => ({
    dcInventoryCache: [], flowerPatterns: [], electricianProd: {}, labourTiers: {}, eventTypeMultipliers: { outdoor_budgeted: 1 },
    eventTimingMultipliers: {}, dcMpIncludeMinusOne: false, seasonMap: {}, trussInv, trussLabourRanges: [{ upTo: 1000, labour: 6 }],
  });
  const fn = (zoneConfig) => ({ fnVenue: "Taj Vivanta", fnDate: "2026-10-19", fnShift: "evening", enabledEls: { stage: true }, zoneElements: { stage: [] }, zoneConfig });
  it("no Truss Labour for a FOC truss", () => {
    expect(computePeopleRaw(fn({ stage: { ...T } }), "Truss Labour", baseCtx())).toBe(6);
    expect(computePeopleRaw(fn({ stage: { ...T, trussFoc: true } }), "Truss Labour", baseCtx())).toBe(0);
  });
  it("no truss pillars in the Labours usage split", () => {
    expect(tentingZoneUsage(fn({ stage: { ...T } }), baseCtx()).truss).toBeGreaterThan(0);
    expect(tentingZoneUsage(fn({ stage: { ...T, trussFoc: true } }), baseCtx()).truss).toBe(0);
  });
  it("a FOC truss leaves the zone's platform count alone", () => {
    const z = { ...T, trussFoc: true, plH: 3, floorDims: { L: 10, W: 8 }, plQty: 3 };
    expect(tentingZoneUsage(fn({ stage: z }), baseCtx()).platform).toBe(3);
  });
  it("no Fabric Bangali work on a FOC truss", () => {
    const ranges = [{ upTo: 100000, labour: 4 }];
    const live = fabricBangaliZone({ ...T, mkOn: true, mkT: "fabric", mkWalls: { back: true } }, trussInv, ranges);
    const foc = fabricBangaliZone({ ...T, mkOn: true, mkT: "fabric", mkWalls: { back: true }, trussFoc: true }, trussInv, ranges);
    expect(JSON.stringify(foc)).not.toBe(JSON.stringify(live));
    expect(Number(foc?.labour ?? foc?.count ?? foc?.people ?? 0)).toBe(0);
  });
});

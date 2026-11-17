import { describe, it, expect } from "vitest";
import { calcStructCost } from "../../pages/studio/StudioApp.jsx";
import { trussRowCost, calcZoneFabricCost, resolveTrussConfig, calcZoneTrussPreview } from "./pricing.js";
import { isTrussFoc, withoutTrussFoc, buildWithoutTrussFoc } from "./foc.js";

// "Already at the venue" is one event's fact: a master's saved build, picking that photo, or copying a build from another
// client must never carry it into a different deal.
describe("FOC truss never travels to another deal", () => {
  it("withoutTrussFoc drops the flag from the zone's own truss and every extra truss, nothing else", () => {
    const cfg = { trussFoc: true, dims: { L: 10 }, plH: "1ft", extraTrussRows: [{ id: "a", trussFoc: true, dims: { L: 5 } }, { id: "b" }] };
    const out = withoutTrussFoc(cfg);
    expect(out).toEqual({ dims: { L: 10 }, plH: "1ft", extraTrussRows: [{ id: "a", dims: { L: 5 } }, { id: "b" }] });
    expect(cfg.trussFoc).toBe(true); // the source deal is not touched
    expect(cfg.extraTrussRows[0].trussFoc).toBe(true);
    expect(withoutTrussFoc(null)).toBe(null);
  });
  it("buildWithoutTrussFoc cleans every zone of a build snapshot", () => {
    const b = { zoneElements: { s: [{ foc: true }] }, zoneConfig: { s: { trussFoc: true }, e: { extraTrussRows: [{ trussFoc: true }] } } };
    const out = buildWithoutTrussFoc(b);
    expect(isTrussFoc(out.zoneConfig.s)).toBe(false);
    expect(isTrussFoc(out.zoneConfig.e.extraTrussRows[0])).toBe(false);
    expect(out.zoneElements).toBe(b.zoneElements);
    expect(buildWithoutTrussFoc({})).toEqual({});
  });
});

// FOC on a truss (owner ask 2026-11-17): the whole truss setup - structure, drape / fabric, masking, loose fabric - is
// already at the venue. Billed nothing, and no truss for any engine (crew, truck, IMS reservation) to see.
const trussInv = { rates: { lizaKgRate: 100, lizaKgRateNew: 150, curtainPieceRate: 200, maskingPieceRate: 50 } };
const trussRates = [{ key: "box", rate: 20 }, { key: "singleU", rate: 15 }];
const rates = { trussInv, trussRates };
const truss = { dims: { W: 43, L: 12, H: 15 }, trT: "box", trussQty: 1, trussMaterial: "iron", mkOn: true, mkT: "fabric", mkWalls: { back: true },
  looseFabric: [{ kind: "liza", colour: "Ivory", qty: 20 }] };

describe("FOC truss", () => {
  it("is only the explicit trussFoc flag", () => {
    expect(isTrussFoc({ trussFoc: true })).toBe(true);
    expect(isTrussFoc({ foc: true })).toBe(false); // an element's FOC flag on the zone never frees its truss
    expect(isTrussFoc({})).toBe(false);
    expect(isTrussFoc(null)).toBe(false);
  });

  it("costs nothing - truss, masking, ceiling, fabric and loose fabric", () => {
    expect(trussRowCost({ ...truss, trussFoc: true }, rates)).toEqual({ truss: 0, masking: 0, ceiling: 0 });
    expect(calcZoneFabricCost(truss, trussInv, [], "moderate")).toBeGreaterThan(0); // the loose Liza alone bills
    expect(calcZoneFabricCost({ ...truss, trussFoc: true }, trussInv, [], "moderate")).toBe(0);
  });

  it("is no truss to the engines (crew, truck, IMS pillars / beams / batta all read this)", () => {
    expect(resolveTrussConfig(truss).source).not.toBe("none");
    expect(resolveTrussConfig({ ...truss, trussFoc: true }).source).toBe("none");
    expect(calcZoneTrussPreview({ ...truss, trussFoc: true }, trussInv)?.topology ?? null).toBe(null);
  });

  it("the zone's own truss (Truss 1) as FOC drops out of the zone's struct cost; a second, normal truss still bills", () => {
    const second = { ...truss, id: "TR2", looseFabric: [] };
    const both = calcStructCost("stage", { ...truss, extraTrussRows: [second] }, rates, false);
    const firstFoc = calcStructCost("stage", { ...truss, trussFoc: true, extraTrussRows: [second] }, rates, false);
    const secondOnly = calcStructCost("stage", { ...second, extraTrussRows: [] }, rates, false);
    expect(firstFoc.total).toBeLessThan(both.total);
    expect(firstFoc.truss).toBe(secondOnly.truss);
    expect(firstFoc.fabric).toBe(secondOnly.fabric);
    expect(firstFoc.masking).toBe(secondOnly.masking);
  });

  it("a FOC extra truss (Truss 2) leaves Truss 1 billed as before", () => {
    const alone = calcStructCost("stage", truss, rates, false);
    const withFoc = calcStructCost("stage", { ...truss, extraTrussRows: [{ ...truss, id: "TR2", trussFoc: true }] }, rates, false);
    expect(withFoc.total).toBe(alone.total);
  });

  it("with the Repeat discount on, a FOC truss still adds nothing and the normal truss keeps its discount", () => {
    const second = { ...truss, id: "TR2", looseFabric: [] };
    const disc = { truss: true, platform: false, print: false };
    const normalOnly = calcStructCost("stage", { ...second, extraTrussRows: [] }, rates, disc);
    const withFoc = calcStructCost("stage", { ...truss, trussFoc: true, extraTrussRows: [second] }, rates, disc);
    expect(withFoc.truss).toBe(normalOnly.truss);
    expect(withFoc.masking).toBe(normalOnly.masking);
    expect(withFoc.fabric).toBe(normalOnly.fabric);
    expect(Number.isFinite(withFoc.total)).toBe(true);
  });

  it("FOC on a 'Truss Qty 0' (dims-only) row also frees its fabric, which Qty 0 alone still bills", () => {
    const dimsOnly = { ...truss, trussQty: 0 };
    expect(calcStructCost("stage", dimsOnly, rates, false).fabric).toBeGreaterThan(0);
    expect(calcStructCost("stage", { ...dimsOnly, trussFoc: true }, rates, false).fabric).toBe(0);
  });

  it("every truss FOC: the zone's truss, masking and fabric are all 0 (no NaN)", () => {
    const r = calcStructCost("stage", { ...truss, trussFoc: true, extraTrussRows: [{ ...truss, id: "TR2", trussFoc: true }] }, rates, { truss: true });
    expect([r.truss, r.masking, r.fabric]).toEqual([0, 0, 0]);
    expect(r.total).toBe(0);
  });

  it("a FOC truss does not free the zone's platform", () => {
    const zone = { ...truss, trussFoc: true, plH: "1ft", floorDims: { L: 10, W: 10 } };
    const plRates = { ...rates, platformRates: [{ key: "1ft", rate: 30 }] };
    expect(calcStructCost("stage", zone, plRates, false).platform).toBe(calcStructCost("stage", { ...zone, trussFoc: undefined }, plRates, false).platform);
  });
});

import { describe, it, expect } from "vitest";
import { calcStructCost } from "../../pages/studio/StudioApp.jsx";
import { trussRowCost, calcZoneFabricCost, resolveTrussConfig, calcZoneTrussPreview } from "./pricing.js";
import { isTrussFoc } from "./foc.js";

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

  it("a FOC truss does not free the zone's platform", () => {
    const zone = { ...truss, trussFoc: true, plH: "1ft", floorDims: { L: 10, W: 10 } };
    const plRates = { ...rates, platformRates: [{ key: "1ft", rate: 30 }] };
    expect(calcStructCost("stage", zone, plRates, false).platform).toBe(calcStructCost("stage", { ...zone, trussFoc: undefined }, plRates, false).platform);
  });
});

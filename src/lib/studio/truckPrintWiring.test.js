import { describe, it, expect } from "vitest";
import { computeTruckItems } from "../../pages/studio/StudioApp.jsx";

// computeTruckItems(zoneElements, zoneConfig, enabledEls, rcItems, truckCap, imsInventory, flowerPatterns, trussInv, flowerMaterialQty, fvCfg, venueName, guestDiscountOn, reusePool)
const run = (zoneConfig, truckCap, enabledEls = { stage: true }, guestDiscountOn = false) =>
  computeTruckItems({}, zoneConfig, enabledEls, [], truckCap, [], [], null, null, {}, "V", guestDiscountOn, null);
const CAP = [{ item: "Print", perTruck: 1000, unit: "sqft" }, { item: "Platform", perTruck: 1000, unit: "sqft" }];
const prints = [{ areaW: 20, areaD: 10, qty: 1 }, { areaW: 10, areaD: 10, qty: 2 }]; // 200 + 200 = 400 sqft

describe("Build's truck count includes print jobs", () => {
  it("a zone with prints adds their area under the Print capacity row", () => {
    const r = run({ stage: { prints } }, CAP);
    const row = r.breakdown.find((b) => b.label === "Print");
    expect(row).toMatchObject({ qty: 400, perTruck: 1000, unit: "sqft" });
    expect(r.truckFraction).toBeCloseTo(0.4);
    expect(r.itemTrucks).toBe(1);
  });
  it("prints on several zones add up; 2500 sqft needs 3 trucks", () => {
    const big = [{ areaW: 50, areaD: 25, qty: 2 }]; // 2500
    const r = run({ stage: { prints: big }, entry: { prints: [] } }, CAP, { stage: true, entry: true });
    expect(r.itemTrucks).toBe(3);
  });
  it("no 'Print' capacity row set up: nothing is trucked for prints (as before)", () => {
    const r = run({ stage: { prints } }, [{ item: "Platform", perTruck: 1000, unit: "sqft" }]);
    expect(r.breakdown.find((b) => b.label === "Print")).toBeUndefined();
    expect(r.itemTrucks).toBe(0);
  });
  it("a capacity row with 0 per truck is ignored", () => {
    expect(run({ stage: { prints } }, [{ item: "Print", perTruck: 0, unit: "sqft" }]).itemTrucks).toBe(0);
  });
  it("a zone that is switched off carries no prints", () => {
    expect(run({ stage: { prints } }, CAP, { stage: false }).itemTrucks).toBe(0);
  });
  it("a repeat setup never waives a print (it is made fresh), even with the guest discount on", () => {
    const r = run({ stage: { prints, repeat: true, repeatTruss: true, repeatPlatform: true } }, CAP, { stage: true }, true);
    expect(r.breakdown.find((b) => b.label === "Print")?.qty).toBe(400);
  });
  it("prints and platform are separate rows", () => {
    const r = run({ stage: { prints, plH: 1, floorDims: { L: 20, W: 25 } } }, CAP);
    expect(r.breakdown.map((b) => b.label).sort()).toEqual(["Platform", "Print"]);
  });
});

// The two other places that total trucks live inside the app component (Build's guest total, and the per-function breakdown that Deal Check's
// Transport tab and IMS read), so they can't be called from a test. They must all count prints the same way as computeTruckItems above.
import { readFileSync } from "node:fs";
describe("every truck total counts prints", () => {
  it("computeTruckItems, transportCalc and calcFunctionBreakdown each add the Print area", () => {
    const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");
    expect(src.match(/printSqftOf\(cfg\)/g)?.length).toBe(3);
    expect(src.match(/addSub\(PRINT_TRUCK_SUB/g)?.length).toBe(3);
  });
});

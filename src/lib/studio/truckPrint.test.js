import { describe, it, expect } from "vitest";
import { printJobPrice, splitPrints, printSqftOf, smallPrintFlat, firstSmallPrint, PRINT_TRUCK_SUB, SMALL_PRINT_LIMIT, SMALL_PRINT_CHARGE } from "./truckPrint.js";

const MATS = [{ id: "vinyl", ratePerSqft: 200 }, { id: "sun", ratePerSqft: 75 }, { id: "free", ratePerSqft: 0 }];
const job = (material, areaW, areaD, qty) => ({ material, areaW, areaD, qty });

describe("the rules", () => {
  it("constants", () => { expect(PRINT_TRUCK_SUB).toBe("Print"); expect(SMALL_PRINT_LIMIT).toBe(2000); expect(SMALL_PRINT_CHARGE).toBe(400); });
});

describe("printJobPrice", () => {
  it("area x qty x the material's rate", () => {
    expect(printJobPrice(job("sun", 3, 2, 1), MATS)).toBe(450);          // the ₹450 sunboard print
    expect(printJobPrice(job("vinyl", 10, 20, 1), MATS)).toBe(40000);
    expect(printJobPrice(job("vinyl", 10, 10, 2), MATS)).toBe(40000);
  });
  it("no material, unknown material, no size: nothing (₹0)", () => {
    expect(printJobPrice(job("", 10, 10, 1), MATS)).toBe(0);
    expect(printJobPrice(job("zzz", 10, 10, 1), MATS)).toBe(0);
    expect(printJobPrice(job("vinyl", 0, 10, 1), MATS)).toBe(0);
  });
});

describe("splitPrints — small prints are not trucked by area", () => {
  it("under ₹2,000 is small; ₹2,000 exactly and over is trucked by area", () => {
    expect(splitPrints({ prints: [job("sun", 3, 2, 1)] }, MATS)).toEqual({ bigSqft: 0, smallJobs: 1 });          // 450
    expect(splitPrints({ prints: [job("vinyl", 10, 10, 1)] }, MATS)).toEqual({ bigSqft: 100, smallJobs: 0 });     // 20000
    expect(splitPrints({ prints: [job("vinyl", 5, 2, 1)] }, MATS)).toEqual({ bigSqft: 10, smallJobs: 0 });        // 2000 exactly
    expect(splitPrints({ prints: [job("vinyl", 3, 3, 1)] }, MATS)).toEqual({ bigSqft: 0, smallJobs: 1 });         // 1800
  });
  it("a mix splits", () => {
    expect(splitPrints({ prints: [job("sun", 3, 2, 1), job("vinyl", 10, 20, 1), job("vinyl", 2, 2, 1)] }, MATS)).toEqual({ bigSqft: 200, smallJobs: 2 });
  });
  it("jobs without a size count as neither; qty multiplies the area and the price", () => {
    expect(splitPrints({ prints: [job("vinyl", 0, 5, 1), job("vinyl", 3, 3, 2)] }, MATS)).toEqual({ bigSqft: 18, smallJobs: 0 }); // 3x3x2 = 18 sqft = 3600
    expect(splitPrints({ prints: [{ material: "vinyl", areaW: 3, areaD: 3 }] }, MATS)).toEqual({ bigSqft: 0, smallJobs: 1 });     // qty missing = 1 -> 1800
  });
  it("no prints, no config", () => {
    expect(splitPrints({}, MATS)).toEqual({ bigSqft: 0, smallJobs: 0 });
    expect(splitPrints(null, MATS)).toEqual({ bigSqft: 0, smallJobs: 0 });
  });
  it("an unpriced print (no material, a material with no rate, no rate list) is not small: it is trucked by area and earns no flat charge", () => {
    expect(splitPrints({ prints: [job("free", 50, 50, 1)] }, MATS)).toEqual({ bigSqft: 2500, smallJobs: 0 });
    expect(splitPrints({ prints: [job("", 10, 10, 1)] }, MATS)).toEqual({ bigSqft: 100, smallJobs: 0 });
    expect(splitPrints({ prints: [job("vinyl", 10, 10, 1)] }, undefined)).toEqual({ bigSqft: 100, smallJobs: 0 });
  });
  it("the price is compared in whole rupees", () => {
    expect(printJobPrice(job("odd", 2.5, 8, 1), [{ id: "odd", ratePerSqft: 99.99 }])).toBe(2000);                  // 1999.8 -> 2000: big
    expect(splitPrints({ prints: [job("odd", 2.5, 8, 1)] }, [{ id: "odd", ratePerSqft: 99.99 }])).toEqual({ bigSqft: 20, smallJobs: 0 });
  });
  it("printSqftOf is the trucked (big) part only", () => {
    expect(printSqftOf({ prints: [job("sun", 3, 2, 1), job("vinyl", 10, 20, 1)] }, MATS)).toBe(200);
  });
});

describe("smallPrintFlat — one flat charge per function", () => {
  const zones = { stage: { prints: [job("sun", 3, 2, 1), job("sun", 2, 2, 1)] }, entry: { prints: [job("sun", 1, 1, 1)] }, btr: { prints: [job("vinyl", 10, 20, 1)] } };
  it("any small print in a switched-on zone: ₹400, once, however many", () => {
    expect(smallPrintFlat(zones, { stage: true, entry: true, btr: true }, MATS)).toEqual({ jobs: 3, charge: 400 });
  });
  it("zones that are switched off do not count", () => {
    expect(smallPrintFlat(zones, { stage: false, entry: false, btr: true }, MATS)).toEqual({ jobs: 0, charge: 0 });
    expect(smallPrintFlat(zones, { stage: true }, MATS)).toEqual({ jobs: 2, charge: 400 });
  });
  it("only big prints: no charge", () => {
    expect(smallPrintFlat({ btr: zones.btr }, { btr: true }, MATS)).toEqual({ jobs: 0, charge: 0 });
  });
  it("nothing at all", () => {
    expect(smallPrintFlat({}, {}, MATS)).toEqual({ jobs: 0, charge: 0 });
    expect(smallPrintFlat(null, null, MATS)).toEqual({ jobs: 0, charge: 0 });
  });
});

describe("firstSmallPrint — the job that shows the flat charge", () => {
  const big = job("vinyl", 10, 20, 1), small = job("sun", 3, 2, 1);
  it("the first small job of the first switched-on zone", () => {
    expect(firstSmallPrint({ stage: { prints: [big, small, small] }, entry: { prints: [small] } }, { stage: true, entry: true }, MATS)).toEqual({ zk: "stage", index: 1 });
  });
  it("zones that are off are skipped; no small print: null", () => {
    expect(firstSmallPrint({ stage: { prints: [small] }, entry: { prints: [small] } }, { stage: false, entry: true }, MATS)).toEqual({ zk: "entry", index: 0 });
    expect(firstSmallPrint({ stage: { prints: [big] } }, { stage: true }, MATS)).toBe(null);
    expect(firstSmallPrint({}, {}, MATS)).toBe(null);
    expect(firstSmallPrint(null, null, MATS)).toBe(null);
  });
  it("agrees with smallPrintFlat about whether there is a charge", () => {
    const zc = { stage: { prints: [big] }, entry: { prints: [small] } };
    expect(!!firstSmallPrint(zc, { stage: true, entry: true }, MATS)).toBe(smallPrintFlat(zc, { stage: true, entry: true }, MATS).charge > 0);
  });
});

import { printFlatForZone } from "./truckPrint.js";
describe("printFlatForZone — the flat charge sits in one zone's Print cost", () => {
  const mats = [{ id: "sun", ratePerSqft: 75 }, { id: "vinyl", ratePerSqft: 200 }];
  const small = { prints: [{ material: "sun", areaW: 3, areaD: 2, qty: 1 }] };
  it("only the zone carrying the first small print gets the ₹400", () => {
    const cfg = { stage: small, entry: small };
    const on = { stage: true, entry: true };
    expect(printFlatForZone(cfg, on, mats, "stage")).toBe(400);
    expect(printFlatForZone(cfg, on, mats, "entry")).toBe(0);
  });
  it("a switched-off zone does not carry it; the next switched-on one does", () => {
    const cfg = { stage: small, entry: small };
    expect(printFlatForZone(cfg, { stage: false, entry: true }, mats, "stage")).toBe(0);
    expect(printFlatForZone(cfg, { stage: false, entry: true }, mats, "entry")).toBe(400);
  });
  it("no small print (or only big ones): nothing", () => {
    expect(printFlatForZone({ stage: { prints: [{ material: "vinyl", areaW: 20, areaD: 10, qty: 1 }] } }, { stage: true }, mats, "stage")).toBe(0);
    expect(printFlatForZone({}, {}, mats, "stage")).toBe(0);
  });
});

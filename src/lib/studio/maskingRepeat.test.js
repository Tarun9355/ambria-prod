import { describe, it, expect } from "vitest";
import { trussRowCost, maskingRepeatOn, maskingGuestCost, maskingAfterRepeat } from "./pricing.js";

// A 10×10×10 full box with all three walls masked in fabric at ₹10/sqft: 3 walls × 100 sqft × ₹10 = ₹3,000.
const rates = { maskingRates: [{ key: "fabric", name: "Fabric", ratePerSqft: 10 }], trussRates: [] };
const row = { dims: { L: 10, W: 10, H: 10 }, trT: "box", trussQty: 1, mkOn: true, mkT: "fabric", mkWalls: { back: true, left: true, right: true } };
const masking = trussRowCost(row, rates).masking;

describe("masking Repeat — which state a row is in", () => {
  it("the real masking price used below is what we think it is", () => {
    expect(masking).toBe(3000);
  });
  it("untouched: follows the zone's Truss & Masking Repeat chip, the way masking always did", () => {
    expect(maskingRepeatOn({ ...row }, true)).toBe(true);
    expect(maskingRepeatOn({ ...row }, false)).toBe(false);
  });
  it("marked Repeat on its own button: Repeat whatever the chip says", () => {
    expect(maskingRepeatOn({ ...row, mkRep: true }, false)).toBe(true);
    expect(maskingRepeatOn({ ...row, mkRep: true }, true)).toBe(true);
  });
  it("marked NOT Repeat: full price even when the zone's chip is on", () => {
    expect(maskingRepeatOn({ ...row, mkRep: false }, true)).toBe(false);
    expect(maskingRepeatOn({ ...row, mkRep: false }, false)).toBe(false);
  });
  it("no row, nothing", () => {
    expect(maskingRepeatOn(null, true)).toBe(false);
  });
});

describe("masking Repeat — the price", () => {
  it("a Repeat row takes the guest percentage off its masking only", () => {
    expect(maskingGuestCost(masking, { ...row, mkRep: true }, false, 25)).toBe(2250);
  });
  it("not Repeat: unchanged", () => {
    expect(maskingGuestCost(masking, { ...row }, false, 25)).toBe(3000);
    expect(maskingGuestCost(masking, { ...row, mkRep: false }, true, 25)).toBe(3000);
  });
  it("same figure the old group discount gave a zone whose chip was on (existing deals keep their price)", () => {
    [3000, 333, 1234, 987.5, 0].forEach((m) => {
      expect(maskingGuestCost(m, { ...row }, true, 25)).toBe(Math.round(m * (1 - 25 / 100)));
    });
  });
  it("the client-discount toggle off (pct 0) leaves the price alone even when marked Repeat", () => {
    expect(maskingGuestCost(masking, { ...row, mkRep: true }, true, 0)).toBe(3000);
  });
  it("rounds to the rupee, like the other structural lines", () => {
    expect(maskingGuestCost(333, { ...row, mkRep: true }, false, 25)).toBe(250);
  });
});

describe("masking Repeat — a zone with extra truss rows", () => {
  const extra = { ...row, dims: { L: 12, W: 12, H: 10 } };
  const m1 = trussRowCost(extra, rates).masking;
  it("each truss row is judged on its own", () => {
    const rows = [{ ...row, mkRep: true }, { ...extra }];
    expect(maskingAfterRepeat(rows, [masking, m1], false, 25)).toBe(Math.round(masking * 0.75) + m1);
  });
  it("the zone chip on, one row opted out", () => {
    const rows = [{ ...row }, { ...extra, mkRep: false }];
    expect(maskingAfterRepeat(rows, [masking, m1], true, 25)).toBe(Math.round(masking * 0.75) + m1);
  });
  it("everything off: the plain sum", () => {
    expect(maskingAfterRepeat([{ ...row }, { ...extra }], [masking, m1], false, 25)).toBe(masking + m1);
  });
  it("no rows, no masking", () => {
    expect(maskingAfterRepeat([], [], true, 25)).toBe(0);
  });
});

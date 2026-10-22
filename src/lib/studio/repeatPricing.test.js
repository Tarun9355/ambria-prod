import { describe, it, expect } from "vitest";
import { guestRepeatLineCost, flaggedUnitRate, dcRentalCost } from "./repeatPricing.js";
import { priceForInvItem } from "../ims/helpers.js";

// ── Guest price ─────────────────────────────────────────────────────────────────────────────────
// The caller (getElPrice) multiplies the date factor onto the line afterwards, so these helpers check
// both the line and line × date.
const base = { qty: 10, unitRate: 100 };

describe("guest price — Repeat / standing / reuse discount, switch OFF (normal)", () => {
  it("no discount source: full price", () => {
    expect(guestRepeatLineCost({ ...base })).toBe(1000);
  });
  it("a Repeat zone takes 25% off every unit", () => {
    expect(guestRepeatLineCost({ ...base, isRepeat: true })).toBe(750);
  });
  it("only the standing / reused units take the 25%", () => {
    expect(guestRepeatLineCost({ ...base, standingUnits: 4 })).toBe(900);                      // 4×75 + 6×100
    expect(guestRepeatLineCost({ ...base, standingUnits: 4, crossFnReuseQty: 3 })).toBe(825);  // 7×75 + 3×100
    expect(guestRepeatLineCost({ ...base, standingUnits: 40 })).toBe(750);                     // capped at qty
  });
  it("the client-discount toggle off hides every discount", () => {
    expect(guestRepeatLineCost({ ...base, isRepeat: true, hidden: true })).toBe(1000);
  });
});

describe("guest price — 'No repeat discount' ON for the item", () => {
  it("is billed in full whatever would have discounted it", () => {
    expect(guestRepeatLineCost({ ...base, noDiscount: true, isRepeat: true })).toBe(1000);
    expect(guestRepeatLineCost({ ...base, noDiscount: true, standingUnits: 10 })).toBe(1000);
    expect(guestRepeatLineCost({ ...base, noDiscount: true, crossFnReuseQty: 10 })).toBe(1000);
    expect(guestRepeatLineCost({ ...base, noDiscount: true, standingUnits: 4, crossFnReuseQty: 3, isRepeat: true })).toBe(1000);
  });
});

describe("guest price — with a date factor (multiplied on afterwards)", () => {
  const withDate = (o, d) => guestRepeatLineCost({ ...base, ...o, dateFactor: d }) * d;
  it("Filler ×0.75 and Repeat 25% are one discount, not two", () => {
    expect(withDate({ isRepeat: true }, 0.75)).toBeCloseTo(750, 5);   // not 562.5
  });
  it("a bigger Repeat discount than the date's wins; a bigger date discount wins over Repeat", () => {
    expect(withDate({ isRepeat: true }, 0.9)).toBeCloseTo(750, 0);    // 25% beats 10%
    expect(withDate({ isRepeat: true }, 0.6)).toBeCloseTo(600, 0);    // 40% beats 25%
  });
  it("King's (a markup) multiplies on top of the Repeat discount", () => {
    expect(withDate({ isRepeat: true }, 1.2)).toBeCloseTo(900, 5);
  });
  it("switch ON: only the date factor is left", () => {
    expect(withDate({ noDiscount: true, isRepeat: true }, 0.75)).toBeCloseTo(750, 5);
    expect(withDate({ noDiscount: true, isRepeat: true }, 1.2)).toBeCloseTo(1200, 5);
    expect(withDate({ noDiscount: true, isRepeat: true }, 0.9)).toBeCloseTo(900, 5);
  });
});

// ── A kit with a switched-off component ─────────────────────────────────────────────────────────
describe("guest price — kit whose component has 'No repeat discount' ON", () => {
  const inv = [
    { id: "K", name: "Kit", kitBase: 200, subItems: [{ itemId: "A", qty: 2 }, { itemId: "B", qty: 4 }] },
    { id: "A", name: "Candle", price: 100, noRepeatDiscount: true },
    { id: "B", name: "Pot", price: 50 },
  ];
  const priceFor = (it, ov) => priceForInvItem(it, {}, inv, ov);
  const kit = inv[0];
  it("the kit is priced as before (base + components)", () => {
    expect(priceFor(kit)).toBe(600);
  });
  it("the switched-off component's share is found, whole-kit or none otherwise", () => {
    expect(flaggedUnitRate(kit, priceFor, inv)).toBe(200);               // 2 candles × 100
    expect(flaggedUnitRate(inv[2], priceFor, inv)).toBe(0);              // plain item, switch off
    expect(flaggedUnitRate(inv[1], priceFor, inv)).toBe(100);            // the item itself, switch on
    expect(flaggedUnitRate({ ...kit, noRepeatDiscount: true }, priceFor, inv)).toBe(600); // whole kit switched off
  });
  it("in a Repeat zone only the rest of the kit is discounted", () => {
    const flagged = flaggedUnitRate(kit, priceFor, inv);
    expect(guestRepeatLineCost({ qty: 1, unitRate: 600, flaggedUnitRate: flagged, isRepeat: true })).toBe(500); // 400×0.75 + 200
    expect(guestRepeatLineCost({ qty: 2, unitRate: 600, flaggedUnitRate: flagged, isRepeat: true })).toBe(1000);
    expect(guestRepeatLineCost({ qty: 1, unitRate: 600, flaggedUnitRate: 600, isRepeat: true })).toBe(600);   // everything switched off
  });
  it("a component edited out of this element's own list is not counted", () => {
    expect(flaggedUnitRate(kit, priceFor, inv, [{ itemId: "B", qty: 4 }])).toBe(0);
  });
  it("a kit that contains itself does not loop", () => {
    const loop = [{ id: "L", kitBase: 10, subItems: [{ itemId: "L", qty: 1 }] }];
    expect(flaggedUnitRate(loop[0], (it) => priceForInvItem(it, {}, loop), loop)).toBe(0);
  });
});

// ── Deal Check rental cost ──────────────────────────────────────────────────────────────────────
describe("Deal Check rental — switch OFF (normal)", () => {
  it("no item: full price × date", () => {
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 0.75, hasItem: false })).toBe(750);
  });
  it("standing at the venue: Filler 25% and the venue's 50% are one discount (Pillar Candle, 23 Oct)", () => {
    expect(dcRentalCost({ qty: 28, baseRentalIn: 40, dateMult: 0.75, standingUnits: 28, freshUnits: 0, discountPct: 50 })).toBeCloseTo(560, 5);
  });
  it("a venue discount smaller than the date's does not stack either", () => {
    expect(dcRentalCost({ qty: 28, baseRentalIn: 40, dateMult: 0.75, standingUnits: 28, freshUnits: 0, discountPct: 20 })).toBeCloseTo(840, 5);
  });
  it("units reused from an earlier function: the sub-category's 50% vs Filler 25% (Taj Mehendi)", () => {
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 0.75, standingUnits: 0, freshUnits: 10, subcatPct: 50, crossFnReuseQty: 10 })).toBeCloseTo(500, 5);
  });
  it("partly standing: each unit gets one discount", () => {
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 0.75, standingUnits: 4, freshUnits: 6, discountPct: 50 })).toBeCloseTo(4 * 50 + 6 * 75, 5);
  });
  it("a Repeat zone: sub-category 30% beats Filler 25%, and nothing happens outside a Repeat zone", () => {
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 0.75, isRepeatZone: true, subcatPct: 30 })).toBeCloseTo(700, 5);
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 0.75, isRepeatZone: false, subcatPct: 30 })).toBeCloseTo(750, 5);
  });
  it("King's (a markup) multiplies on top of the venue discount", () => {
    expect(dcRentalCost({ qty: 10, baseRentalIn: 100, dateMult: 1.2, standingUnits: 10, freshUnits: 0, discountPct: 50 })).toBeCloseTo(600, 5);
  });
});

describe("Deal Check rental — 'No repeat discount' ON for the item", () => {
  const on = { noDiscount: true };
  it("only the date factor is left, whatever would have discounted it", () => {
    expect(dcRentalCost({ ...on, qty: 28, baseRentalIn: 40, dateMult: 0.75, standingUnits: 28, freshUnits: 0, discountPct: 50 })).toBeCloseTo(840, 5);
    expect(dcRentalCost({ ...on, qty: 10, baseRentalIn: 100, dateMult: 0.75, standingUnits: 0, freshUnits: 10, subcatPct: 50, crossFnReuseQty: 10 })).toBeCloseTo(750, 5);
    expect(dcRentalCost({ ...on, qty: 10, baseRentalIn: 100, dateMult: 0.75, isRepeatZone: true, subcatPct: 30 })).toBeCloseTo(750, 5);
    expect(dcRentalCost({ ...on, qty: 10, baseRentalIn: 100, dateMult: 1.2, standingUnits: 10, freshUnits: 0, discountPct: 50 })).toBeCloseTo(1200, 5);
    expect(dcRentalCost({ ...on, qty: 10, baseRentalIn: 100, dateMult: 1, isRepeatZone: true, subcatPct: 50 })).toBe(1000);
  });
});

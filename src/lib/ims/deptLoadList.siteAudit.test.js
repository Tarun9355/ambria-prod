import { describe, it, expect } from "vitest";
import { blockedGroupedFor, blockedNotInSnapshot, peakEventQty, tripChallanRows, truckKeyOf, loadSplitOf, standingPartsAtVenue } from "./deptLoadList.js";

// Site page audit 2026-11-27.
const catToDept = (c) => (/flor/i.test(c) ? "Floral" : /furn/i.test(c) ? "Furniture" : "Tenting");
const inventory = [{ id: "CH", name: "Gold Chair", cat: "Furniture", price: 50 }, { id: "PC", name: "Pillar Candle", cat: "Florals" }];

describe("site audit fixes", () => {
  it("a block on several dates counts its busiest date, not every date added up", () => {
    const arr = ["2026-12-01", "2026-12-02", "2026-12-03"].map((date) => ({ eventId: "e", date, qty: 10, status: "confirmed" }));
    expect(peakEventQty([...arr, { eventId: "e", date: "2026-12-02", qty: 2, status: "confirmed" }], "e")).toBe(12);
    const sel = { id: "e", deptInventory: { Floral: [{ name: "Artificial flowers", qty: 5 }] } };
    expect(blockedNotInSnapshot("Furniture", { sel, inventory, blocks: { CH: arr }, catToDept })[0].qty).toBe(10);
  });
  it("Platform and Batta carry their unit; a production row is not keyed as the rented item it is modelled on", () => {
    const sel = { id: "e", deptInventory: { Tenting: [{ name: "Platform", qty: 448 }, { name: "Batta", qty: 272 }], Furniture: [
      { name: "Gold Chair", imsId: "CH", qty: 50 }, { name: "Chairs", imsId: "CH", qty: 10, prodOrBuy: "production" }] } };
    const t = blockedGroupedFor("Tenting", { sel, inventory, blocks: {}, catToDept });
    expect(t.map((r) => r.qtyUnit)).toEqual(["sqft", "rft"]);
    const f = blockedGroupedFor("Furniture", { sel, inventory, blocks: {}, catToDept });
    const keys = f.map(truckKeyOf);
    expect(new Set(keys).size).toBe(2);
    expect(f.find((r) => r.prodOrBuy)).toMatchObject({ invId: null, refInvId: "CH" });
  });
  it("the challan prints a load key once even when two list rows share it", () => {
    const rows = [{ invId: "PC", name: "Pillar Candle" }, { invId: "PC", name: "Pillar Candle", fromKit: "Candle Wall" }];
    const out = tripChallanRows({ loads: { Floral: { "inv:PC": 30 } } }, () => rows);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(30);
  });
});

describe("Repeat floors of a Platform / carpet line", () => {
  const plat = { id: "P0", name: "Platform", qty: 448, qtyUnit: "sqft", sub: "platform structure", parts: [{ zone: "Stage", qty: 224, repeat: true }, { zone: "Lounge", qty: 224 }] };
  it("the Repeat floor is standing, the rest is loaded", () => {
    const { load, atVenue } = loadSplitOf([plat], () => ({ fixed: 0, repeat: false, foc: false, load: 448 }));
    expect(load[0].qty).toBe(224);
    expect(atVenue[0].a).toMatchObject({ repeatPart: 224, load: 224 });
  });
  it("every floor on Repeat: nothing to load", () => {
    const all = { ...plat, parts: plat.parts.map((p) => ({ ...p, repeat: true })) };
    expect(standingPartsAtVenue(all)).toMatchObject({ repeat: true, load: 0 });
    expect(standingPartsAtVenue({ ...plat, parts: [{ qty: 448 }] })).toBe(null);
  });
});

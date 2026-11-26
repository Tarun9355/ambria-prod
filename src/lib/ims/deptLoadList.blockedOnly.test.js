import { describe, it, expect } from "vitest";
import { blockedGroupedFor, blockedNotInSnapshot } from "./deptLoadList.js";

// Owner report 2026-11-26 (Neel Vashisht, 27 Nov): Floral items blocked for the event but missing from Deal Check's list were invisible.
const catToDept = (c) => (/flor/i.test(c) ? "Floral" : /furn/i.test(c) ? "Furniture" : "Structure");
const inventory = [
  { id: "POT", name: "China Fiber Pot", cat: "Florals", price: 100 },
  { id: "CAN", name: "Pillar Candle", cat: "Florals", price: 10 },
  { id: "KITPART", name: "Brass Bowl", cat: "Florals" },
  { id: "SOFA", name: "Sofa", cat: "Furniture" },
];
const sel = {
  id: "eo1",
  deptInventory: {
    Floral: [{ name: "Artificial flowers", qty: 88, total: 15330 }, { name: "Pillar Candle", imsId: "CAN", qty: 152, total: 1520 }],
    Furniture: [{ name: "Sofa set", isKit: true, imsId: "SOFA", components: [{ imsId: "KITPART", name: "Brass Bowl", qty: 2 }] }],
  },
};
const blocks = {
  POT: [{ eventId: "eo1", qty: 25, status: "confirmed", date: "2026-11-27" }],
  CAN: [{ eventId: "eo1", qty: 152, status: "confirmed", date: "2026-11-27" }],
  KITPART: [{ eventId: "eo1", qty: 2, status: "confirmed", date: "2026-11-27" }],
  SOFA: [{ eventId: "eo1", qty: 1, status: "confirmed", date: "2026-11-27" }],
};

describe("blocked for the event but not in Deal Check's list", () => {
  it("is listed with the department's snapshot rows, tagged, with no money", () => {
    const rows = blockedGroupedFor("Floral", { sel, inventory, blocks, catToDept });
    expect(rows.map((r) => r.name)).toEqual(["Artificial flowers", "Pillar Candle", "China Fiber Pot"]);
    expect(rows[2]).toMatchObject({ invId: "POT", qty: 25, total: 0, blockedOnly: true });
  });
  it("never repeats an item Deal Check lists anywhere (another department, a kit part, a mapped piece)", () => {
    expect(blockedNotInSnapshot("Floral", { sel, inventory, blocks, catToDept }).map((r) => r.invId)).toEqual(["POT"]);
    expect(blockedNotInSnapshot("Floral", { sel, inventory, blocks, catToDept, mappedStockRows: [{ invId: "POT" }] })).toEqual([]);
  });
  it("leaves other events, released and truck-added blocks out", () => {
    const b2 = { POT: [{ eventId: "eo2", qty: 5, status: "confirmed" }, { eventId: "eo1", qty: 3, status: "released" }, { eventId: "eo1", qty: 4, status: "confirmed", source: "ims-truck-extra" }] };
    const rows = blockedNotInSnapshot("Floral", { sel, inventory, blocks: b2, catToDept });
    expect(rows).toEqual([]);
  });
});

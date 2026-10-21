import { describe, it, expect } from "vitest";
import { kitBuiltQty } from "./fixedVenues.js";

// A console kit (8 standing at the venue) made of a pot + books; only the kit is registered.
const inv = [
  { id: "K", name: "Console", subItems: [{ itemId: "P", qty: 1 }, { itemId: "B", qty: 2 }] },
  { id: "P", name: "Pot" },
  { id: "B", name: "Books" },
  { id: "O", name: "Orange pot" },
  { id: "C", name: "Chair" },
];
const settings = { fixedVenues: [{ name: "Pushpanjali", items: [{ invId: "K", qty: 8 }, { invId: "C", qty: 50 }] }] };
const K = inv[0], C = inv[4];
// what walkKitUnits does: the kit first, then each part scaled by qty
const walk = (pool, top, topQty, venue = "Pushpanjali") => {
  const out = { kit: kitBuiltQty(pool, settings, venue, top, topQty, top, topQty, inv) };
  (top.subItems || []).forEach(si => {
    const node = inv.find(i => i.id === si.itemId);
    out[node.id] = kitBuiltQty(pool, settings, venue, top, topQty, node, topQty * si.qty, inv);
  });
  return out;
};

describe("standing stock at a fixed venue", () => {
  it("a standing kit stands whole: parts are netted with it", () => {
    expect(walk(new Map(), K, 5)).toEqual({ kit: 0, P: 0, B: 0 });
  });
  it("only kits beyond the standing qty are carried, parts follow", () => {
    expect(walk(new Map(), K, 10)).toEqual({ kit: 2, P: 2, B: 4 });
  });
  it("the standing qty is shared across a function's elements (50 stand, 30 + 30 asked)", () => {
    const pool = new Map();
    expect(kitBuiltQty(pool, settings, "Pushpanjali", C, 30, C, 30, inv)).toBe(0);
    expect(kitBuiltQty(pool, settings, "Pushpanjali", C, 30, C, 30, inv)).toBe(10); // 60 asked - 50 standing
  });
  it("50 stand: the 51st is carried", () => {
    expect(kitBuiltQty(new Map(), settings, "Pushpanjali", C, 51, C, 51, inv)).toBe(1);
    expect(kitBuiltQty(new Map(), settings, "Pushpanjali", C, 50, C, 50, inv)).toBe(0);
  });
  it("two console elements share the kit's standing qty and their parts follow", () => {
    const pool = new Map();
    expect(walk(pool, K, 6)).toEqual({ kit: 0, P: 0, B: 0 });   // 6 of 8
    expect(walk(pool, K, 6)).toEqual({ kit: 4, P: 4, B: 8 });   // only 2 left -> 4 carried
  });
  it("a part swapped in for this deal is not standing", () => {
    expect(kitBuiltQty(new Map(), settings, "Pushpanjali", K, 5, inv[3], 5, inv)).toBe(5);
  });
  it("nothing changes at a venue that is not fixed, or for an item that is not standing there", () => {
    expect(walk(new Map(), K, 5, "Elsewhere")).toEqual({ kit: 5, P: 5, B: 10 });
    const other = { id: "X", subItems: [] };
    expect(kitBuiltQty(new Map(), settings, "Pushpanjali", other, 3, other, 3, inv)).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { scopeLineToFn } from "./siteFunctionScope.js";

// Owner ask 2026-11-27: the Site page function-wise, like Planning (Amit Gulati: Sagan at Exotica 27 Nov, Wedding at Pushpanjali 28 Nov).
const fns = [
  { fnIdx: 0, type: "Sagan", venue: "Exotica", date: "2026-11-27", elements: { z: [{ invId: "CH", qty: 10 }, { name: "Lantern", qty: 4 }] } },
  { fnIdx: 1, type: "Wedding", venue: "Pushpanjali", date: "2026-11-28", elements: { z: [{ invId: "CH", qty: 6 }] } },
];
const ctx = (fi, extra = {}) => ({ fd: fns[fi], fi, inventory: [{ id: "CH", name: "Chair" }], blocks: {}, eventId: "e", ...extra });

describe("one function's share of a load line", () => {
  it("Deal Check's per-function record", () => {
    const row = { id: "r", invId: "CH", qty: 16, byFn: { 0: { qty: 10, rentalQty: 10 }, 1: { qty: 6, rentalQty: 6 } } };
    expect(scopeLineToFn(row, ctx(0)).qty).toBe(10);
    expect(scopeLineToFn(row, ctx(1)).qty).toBe(6);
  });
  it("a line filed for one function, and parts tagged by function", () => {
    expect(scopeLineToFn({ id: "t", name: "Truss beam 10ft", qty: 8, fnIdx: 1 }, ctx(0))).toBe(null);
    const plat = { id: "p", name: "Platform", qty: 300, parts: [{ fnIdx: 0, qty: 128 }, { fnIdx: 1, qty: 172 }] };
    expect(scopeLineToFn(plat, ctx(0))).toMatchObject({ qty: 128, parts: [{ fnIdx: 0, qty: 128 }] });
  });
  it("no per-function record: the function's zone lists, by id or name", () => {
    expect(scopeLineToFn({ id: "c", invId: "CH", qty: 16 }, ctx(1)).qty).toBe(6);
    expect(scopeLineToFn({ id: "l", name: "Lantern", qty: 4 }, ctx(0)).qty).toBe(4);
    expect(scopeLineToFn({ id: "l", name: "Lantern", qty: 4 }, ctx(1))).toBe(null);
  });
  it("blocked but not in Deal Check: its blocks on the function's date", () => {
    const blocks = { TK: [{ eventId: "e", date: "2026-11-27", qty: 3, status: "confirmed" }, { eventId: "e", date: "2026-11-28", qty: 5, status: "confirmed" }] };
    const row = { id: "blk:TK", invId: "TK", qty: 5, blockedOnly: true };
    expect(scopeLineToFn(row, ctx(0, { blocks })).qty).toBe(3);
    expect(scopeLineToFn(row, ctx(1, { blocks })).qty).toBe(5);
  });
  it("a fabric line: the function's share of the new fabric", () => {
    const g = { key: "liza", zones: [{ fi: 0, qty: 6 }, { fi: 1, qty: 12 }, { fi: 1, qty: 20, standing: true }] };
    expect(scopeLineToFn({ id: "fabric:liza:Ivory", qty: 18 }, ctx(0, { fabricGroups: [g] })).qty).toBe(6);
  });
});

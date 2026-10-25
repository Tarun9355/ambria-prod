import { describe, it, expect } from "vitest";
import { allocateRowAvailability, maxQtyForRow, qtyUsedElsewhereInBuild } from "./dealAvailability.js";

const inventory = [{ id: "pod", name: "Round Fibre Podium" }];
const fnWith = (rows) => [{ fnDate: "2026-10-15", zoneElements: Object.fromEntries(rows.map(([zk, qty]) => [zk, [{ invId: "pod", qty }]])) }];
const T = (zoneKey) => ({ fnIdx: 0, zoneKey, elIdx: 0 });

describe("maxQtyForRow — the most one row can ask for and still be fully covered", () => {
  it("the only row: the whole pool (1 free → can't go past 1)", () => {
    expect(maxQtyForRow("pod", fnWith([["stage", 1]]), inventory, T("stage"), "2026-10-15", 1)).toBe(1);
    expect(maxQtyForRow("pod", fnWith([["stage", 5]]), inventory, T("stage"), "2026-10-15", 1)).toBe(1);
  });
  it("nothing free: 0", () => {
    expect(maxQtyForRow("pod", fnWith([["stage", 5]]), inventory, T("stage"), "2026-10-15", 0)).toBe(0);
  });
  it("another zone already uses some of it: only the rest is left for this row", () => {
    expect(maxQtyForRow("pod", fnWith([["stage", 1], ["entry", 3]]), inventory, T("stage"), "2026-10-15", 4)).toBe(1);
  });
  it("a sibling that is already short leaves this row nothing to add", () => {
    // pool 5, the other zone already asks 9 (short): taking more here would only deepen that
    expect(maxQtyForRow("pod", fnWith([["stage", 2], ["entry", 9]]), inventory, T("stage"), "2026-10-15", 5)).toBe(0);
  });
  it("at the max nothing in the booking is short; one past it, something is", () => {
    for (const pool of [1, 3, 6, 10]) for (const sib of [1, 2, 4, 7]) {
      if (sib > pool) continue;
      const fnsAt = (q) => fnWith([["stage", q], ["entry", sib]]);
      const max = maxQtyForRow("pod", fnsAt(1), inventory, T("stage"), "2026-10-15", pool);
      const shortAt = (q) => allocateRowAvailability("pod", fnsAt(q), inventory, T("stage"), "2026-10-15", pool).shortQty
        + allocateRowAvailability("pod", fnsAt(q), inventory, T("entry"), "2026-10-15", pool).shortQty;
      expect(shortAt(max)).toBe(0);
      expect(shortAt(max + 1)).toBeGreaterThan(0);
    }
  });
  it("a row on another date does not count", () => {
    const fns = [{ fnDate: "2026-10-15", zoneElements: { stage: [{ invId: "pod", qty: 1 }] } }, { fnDate: "2026-11-01", zoneElements: { stage: [{ invId: "pod", qty: 8 }] } }];
    expect(maxQtyForRow("pod", fns, inventory, T("stage"), "2026-10-15", 3)).toBe(3);
  });
});

describe("a zone switched OFF in Build does not hold stock", () => {
  const fns = [{
    fnDate: "2026-10-15",
    enabledEls: { stage: true, entry: false },
    zoneElements: { stage: [{ invId: "pod", qty: 5 }], entry: [{ invId: "pod", qty: 21 }] },
  }];
  it("its quantity is not 'used elsewhere' for the zone that is on", () => {
    expect(qtyUsedElsewhereInBuild("pod", fns, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15")).toBe(0);
  });
  it("and does not shrink the ceiling: the whole pool is available to the zone that is on (227, not 206)", () => {
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15", 227)).toBe(227);
  });
  it("switch it back on and its 21 count again (227 → 206)", () => {
    const on = [{ ...fns[0], enabledEls: { stage: true, entry: true } }];
    expect(maxQtyForRow("pod", on, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15", 227)).toBe(206);
  });
  it("a booking that has recorded no enabled zones at all still counts every zone, as before", () => {
    const none = [{ fnDate: "2026-10-15", zoneElements: fns[0].zoneElements }];
    expect(maxQtyForRow("pod", none, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15", 227)).toBe(206);
  });
});

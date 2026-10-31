import { describe, it, expect } from "vitest";
import { allocateRowAvailability, maxQtyForRow, qtyUsedElsewhereInBuild, kitPartShortfalls } from "./dealAvailability.js";

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

// ── Randomised cross-check of the ceiling against the allocator it is meant to protect ──
// 3,000 random bookings: several functions on two dates, zones on/off, plain rows and kits holding the item.
// The contract: at the ceiling the row is fully covered AND no other row of the item is short (whenever the
// others fit in the pool to begin with); one unit past it, something in the booking is short.
describe("maxQtyForRow — randomised against allocateRowAvailability", () => {
  let seed = 12345;
  // mulberry32 — a small seeded generator with good low bits (a plain LCG mod n repeats badly)
  const rnd = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
  const inv = [{ id: "led", name: "LED" }, { id: "kit", name: "Kit", subItems: [{ itemId: "led", qty: 3 }] }];
  const build = () => {
    const fns = [];
    const nFns = 1 + rnd(3);
    for (let f = 0; f < nFns; f++) {
      const zones = ["stage", "entry", "lounge"].slice(0, 1 + rnd(3));
      const enabledEls = {}; const zoneElements = {};
      zones.forEach((z) => {
        enabledEls[z] = rnd(4) !== 0;                       // ~25% of zones are switched off
        zoneElements[z] = Array.from({ length: 1 + rnd(2) }, () => (rnd(3) === 0
          ? { invId: "kit", qty: 1 + rnd(4) } : { invId: "led", qty: rnd(40) }));
      });
      fns.push({ fnDate: rnd(2) ? "2027-01-03" : "2027-01-05", enabledEls, zoneElements });
    }
    return fns;
  };
  it("holds for 3,000 random bookings", () => {
    let checked = 0;
    for (let n = 0; n < 3000; n++) {
      const fns = build();
      const pool = rnd(120);
      // pick a plain-LED row on the target date that sits in an enabled zone
      const date = "2027-01-03";
      const cands = [];
      fns.forEach((fn, fnIdx) => { if (fn.fnDate !== date) return; Object.entries(fn.zoneElements).forEach(([zk, els]) => { if (!fn.enabledEls[zk]) return; els.forEach((el, elIdx) => { if (el.invId === "led") cands.push({ fnIdx, zoneKey: zk, elIdx }); }); }); });
      if (!cands.length) continue;
      const t = cands[rnd(cands.length)];
      const max = maxQtyForRow("led", fns, inv, t, date, pool);
      const withQty = (q) => fns.map((fn, i) => (i !== t.fnIdx ? fn : { ...fn, zoneElements: { ...fn.zoneElements, [t.zoneKey]: fn.zoneElements[t.zoneKey].map((el, j) => (j === t.elIdx ? { ...el, qty: q } : el)) } }));
      const totalShort = (f) => {
        let s = 0;
        f.forEach((fn, fnIdx) => { if (fn.fnDate !== date) return; Object.entries(fn.zoneElements).forEach(([zk, els]) => { if (!fn.enabledEls[zk]) return; els.forEach((el, elIdx) => { s += allocateRowAvailability("led", f, inv, { fnIdx, zoneKey: zk, elIdx }, date, pool).shortQty; }); }); });  // kit rows too: their LED units compete
        return s;
      };
      // the others must fit the pool for "no one is short at the ceiling" to be demanded
      const othersAlone = totalShort(withQty(0));
      if (othersAlone === 0) { expect(totalShort(withQty(max))).toBe(0); expect(totalShort(withQty(max + 1))).toBeGreaterThan(0); checked++; }
      else expect(max).toBe(0);   // someone is already short without this row: nothing may be added
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("kitPartShortfalls — a part inside a kit that is short on the date", () => {
  const inv = [
    { id: "kit", name: "Lounge Kit", subItems: [{ itemId: "cover", qty: 4 }, { itemId: "pot", qty: 1 }] },
    { id: "cover", name: "Cushion Cover" },
    { id: "pot", name: "Brass Pot" },
  ];
  const free = { kit: 9, cover: 10, pot: 9 };
  const availFor = (it) => free[it.id];
  const D = "2026-10-15";
  it("nothing short: nothing listed (and the kit itself is never listed)", () => {
    const fns = [{ fnDate: D, zoneElements: { lounge: [{ invId: "kit", qty: 2 }] } }];
    expect(kitPartShortfalls(inv[0], 2, undefined, fns, inv, T("lounge"), D, availFor)).toEqual([]);
  });
  it("3 kits need 12 covers, 10 free: covers 2 short", () => {
    const fns = [{ fnDate: D, zoneElements: { lounge: [{ invId: "kit", qty: 3 }] } }];
    expect(kitPartShortfalls(inv[0], 3, undefined, fns, inv, T("lounge"), D, availFor)).toEqual([{ id: "cover", name: "Cushion Cover", need: 12, short: 2 }]);
  });
  it("covers also used as their own element elsewhere in the booking compete for the same 10", () => {
    const fns = [{ fnDate: D, zoneElements: { lounge: [{ invId: "kit", qty: 2 }], stage: [{ invId: "cover", qty: 5 }] } }];
    // 5 (stage, smaller row first) + 8 (kit) against 10 free → the kit's row is 3 short
    expect(kitPartShortfalls(inv[0], 2, undefined, fns, inv, T("lounge"), D, availFor)).toEqual([{ id: "cover", name: "Cushion Cover", need: 8, short: 3 }]);
  });
  it("the kit's own edited parts are the ones checked", () => {
    const fns = [{ fnDate: D, zoneElements: { lounge: [{ invId: "kit", qty: 1, kitOverrides: [{ itemId: "pot", qty: 12 }] }] } }];
    expect(kitPartShortfalls(inv[0], 1, [{ itemId: "pot", qty: 12 }], fns, inv, T("lounge"), D, availFor)).toEqual([{ id: "pot", name: "Brass Pot", need: 12, short: 3 }]);
  });
  it("without a target row the kit is judged alone", () => {
    expect(kitPartShortfalls(inv[0], 3, undefined, [], inv, null, D, availFor)).toEqual([{ id: "cover", name: "Cushion Cover", need: 12, short: 2 }]);
  });
});

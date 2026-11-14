import { describe, it, expect } from "vitest";
import { allocateRowAvailability, maxQtyForRow, qtyUsedElsewhereInBuild, qtyUsedElsewhereInDealCheck, kitPartShortfalls, netOwnReservedBlocksLive } from "./dealAvailability.js";
import { walkKitUnits } from "../ims/helpers";

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

// Regression coverage (owner report 2026-11-10): a same-day, same-venue SIBLING FUNCTION's units
// are reuse-eligible (findCrossFnReuseSource's own rule — same calendar date, same venue, within
// this one deal) and must not count as competing demand against this row's ceiling, when the
// caller opts in via crossFnSiblingsFree. Two earlier attempts fixed this by subtracting the
// sibling then crediting an equal "bonus" back separately — both were caught by regression review:
// once siblings already used more than the naive pool, maxQtyForRow's own Math.max(0, ...) clamp
// discarded the negative, so the bonus added after that clamp created headroom with no basis in
// real stock (reachable by a brand-new row, with no short/warning flag at all). Simply never
// subtracting a cross-function sibling's row in the first place has no clamp to go wrong in.
describe("maxQtyForRow — crossFnSiblingsFree (cross-function reuse, same date + venue)", () => {
  // multi-function helper: each row is [fnIdx, venue, zoneKey, qty] on the one shared date.
  const multiFn = (rows, date = "2027-04-02") => {
    const byFn = new Map();
    rows.forEach(([fnIdx, venue, zk, qty]) => {
      if (!byFn.has(fnIdx)) byFn.set(fnIdx, { fnDate: date, fnVenue: venue, zoneElements: {} });
      const fn = byFn.get(fnIdx);
      fn.zoneElements[zk] = [...(fn.zoneElements[zk] || []), { invId: "pod", qty }];
    });
    return [...byFn.entries()].sort((a, b) => a[0] - b[0]).map(([, fn]) => fn);
  };

  it("without the flag, a same-day sibling FUNCTION still competes as before (unchanged default)", () => {
    // Mehendi (fnIdx 0) growing its own row; Wedding (fnIdx 1) already holds 10 of the pool of 12.
    const fns = multiFn([[0, "Aura", "btr", 1], [1, "Aura", "btr", 10]]);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "btr", elIdx: 0 }, "2027-04-02", 12, "Aura")).toBe(2);
  });

  it("with the flag, a same-day sibling FUNCTION's units don't count — the full pool is free", () => {
    const fns = multiFn([[0, "Aura", "btr", 1], [1, "Aura", "btr", 10]]);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "btr", elIdx: 0 }, "2027-04-02", 12, "Aura", true)).toBe(12);
  });

  it("the flag still only excludes OTHER FUNCTIONS — a sibling ROW of the SAME function keeps competing", () => {
    // Both rows are fnIdx 0 (two zones of the one function being priced) — genuinely simultaneous, separate demand.
    const fns = multiFn([[0, "Aura", "btr", 1], [0, "Aura", "entry", 10]]);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "btr", elIdx: 0 }, "2027-04-02", 12, "Aura", true)).toBe(2);
  });

  it("multiple same-day sibling functions are ALL excluded, however many there are — no separate merge/cap logic needed", () => {
    // Haldi(10) + Cocktail(10) + Wedding's own new row, pool only 10 — the old pool-based "bonus"
    // approach let this reach 20 (double-counting Haldi+Cocktail); this just never subtracts either.
    const fns = multiFn([[0, "Aura", "z", 10], [1, "Aura", "z", 10], [2, "Aura", "z", 0]]);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 2, zoneKey: "z", elIdx: 0 }, "2027-04-02", 10, "Aura", true)).toBe(10);
  });

  it("row order does not matter — same result whichever function is being priced", () => {
    const fns = multiFn([[0, "Aura", "z", 10], [1, "Aura", "z", 0]]);
    // Price fnIdx 1 (the brand-new row) first…
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 1, zoneKey: "z", elIdx: 0 }, "2027-04-02", 10, "Aura", true)).toBe(10);
    // …then fnIdx 0 (already holding 10) — neither reading starves the other, since nothing is drawn down.
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 0 }, "2027-04-02", 10, "Aura", true)).toBe(10);
  });

  it("a DIFFERENT venue's same-day function was never competing in the first place (itemRowsFor's own venue scope, unchanged by this flag)", () => {
    // targetVenue="Aura" already drops Restro's row before the new filter ever runs, so this result
    // (12 = nothing subtracted) is identical whether crossFnSiblingsFree is true or omitted — this
    // test exists to confirm the flag doesn't somehow widen or defeat the EXISTING venue scope.
    const fns = multiFn([[0, "Aura", "z", 1], [1, "Restro", "z", 10]]);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 0 }, "2027-04-02", 12, "Aura")).toBe(12);
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 0 }, "2027-04-02", 12, "Aura", true)).toBe(12);
  });

  it("the flag is a no-op without a venue (prevents a different-venue row being wrongly excluded)", () => {
    const fns = multiFn([[0, "Aura", "z", 1], [1, "Restro", "z", 10]]);
    // No targetVenue passed — crossFnSiblingsFree must not exclude Restro's row just because it's a different function.
    expect(maxQtyForRow("pod", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 0 }, "2027-04-02", 12, undefined, true)).toBe(2);
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

describe("qtyUsedElsewhereInDealCheck — a FOC'd card never competes for stock", () => {
  it("skips a card whose backlinked Build element is FOC, counts an ordinary card normally", () => {
    // cardKey's rcName must match the element's own name — same as production (buildElCardKey is
    // built from el.name at card-generation time) — the shared cardIsFoc's fail-safe check requires it.
    const fns = [{ fnDate: "2026-10-15", zoneElements: { stage: [{ name: "Round Fibre Podium", invId: "pod", qty: 20 }], entry: [{ name: "Round Fibre Podium", invId: "pod", qty: 21, foc: true }] } }];
    const dcCards = { 0: { "el::stage::Round Fibre Podium::0": { zoneKey: "stage", imsId: "pod", qty: 20 }, "el::entry::Round Fibre Podium::0": { zoneKey: "entry", imsId: "pod", qty: 21 } } };
    expect(qtyUsedElsewhereInDealCheck("pod", fns, dcCards, [], {}, inventory, {}, "2026-10-15")).toBe(20);
  });
});

describe("a FOC'd element never competes for stock", () => {
  const foc = [{
    fnDate: "2026-10-15",
    enabledEls: { stage: true, entry: true },
    zoneElements: { stage: [{ invId: "pod", qty: 5 }], entry: [{ invId: "pod", qty: 21, foc: true }] },
  }];
  it("does not count as 'used elsewhere'", () => {
    expect(qtyUsedElsewhereInBuild("pod", foc, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15")).toBe(0);
  });
  it("does not shrink the ceiling for a sibling row's own stock check", () => {
    expect(maxQtyForRow("pod", foc, inventory, { fnIdx: 0, zoneKey: "stage", elIdx: 0 }, "2026-10-15", 227)).toBe(227);
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

// ── The cached booking-row index gives exactly what the old per-call walk gave ──
describe("allocateRowAvailability — index matches the old per-call walk", () => {
  let seed = 777;
  const rnd = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
  const inv = [
    { id: "led", name: "LED" },
    { id: "kit", name: "Kit", subItems: [{ itemId: "led", qty: 3 }, { itemId: "pot", qty: 1 }] },
    { id: "big", name: "Kit of kits", subItems: [{ itemId: "kit", qty: 2 }, { itemId: "led", qty: 1 }] },
    { id: "pot", name: "Pot" },
  ];
  // the walk allocateRowAvailability used before the index (rows per call, in booking order)
  const oldRows = (invId, fns, date) => {
    const rows = [];
    fns.forEach((fn, fnIdx) => {
      if (date && (fn.fnDate || "") !== date) return;
      Object.entries(fn.zoneElements || {}).forEach(([zk, els]) => {
        const en = fn.enabledEls; if (en && Object.keys(en).length && !en[zk]) return;
        els.forEach((el, elIdx) => {
          if (!el?.invId) return;
          const q0 = Number(el.qty) || 0; let qty = 0;
          if (q0 > 0) { const top = inv.find((i) => i.id === el.invId); if (!top) { if (el.invId === invId) qty = q0; } else walkKitUnits(top, q0, inv, el.kitOverrides, (node, nq) => { if (node?.id === invId) qty += nq; }); }
          if (qty > 0) rows.push({ fnIdx, zk, elIdx, qty });
        });
      });
    });
    return rows;
  };
  const oldAlloc = (invId, fns, target, date, avail) => {
    const rows = oldRows(invId, fns, date).sort((a, b) => a.qty - b.qty);
    let remaining = Math.max(0, avail); let res = { ownedQty: 0, shortQty: 0 };
    for (const r of rows) { const owned = Math.min(r.qty, remaining); remaining -= owned; if (r.fnIdx === target.fnIdx && r.zk === target.zoneKey && r.elIdx === target.elIdx) res = { ownedQty: owned, shortQty: r.qty - owned }; }
    return res;
  };
  it("same allocation for 2,000 random bookings with nested kits and unknown items", () => {
    const ids = ["led", "kit", "big", "pot", "gone"];
    for (let n = 0; n < 2000; n++) {
      const fns = Array.from({ length: 1 + rnd(3) }, () => {
        const enabledEls = {}, zoneElements = {};
        ["stage", "entry"].forEach((z) => { enabledEls[z] = rnd(4) !== 0; zoneElements[z] = Array.from({ length: 1 + rnd(3) }, () => ({ invId: ids[rnd(ids.length)], qty: rnd(12) })); });
        return { fnDate: rnd(2) ? "d1" : "d2", enabledEls, zoneElements };
      });
      const fnIdx = rnd(fns.length), zoneKey = rnd(2) ? "stage" : "entry", elIdx = rnd(3);
      const id = ids[rnd(ids.length)], pool = rnd(60), date = rnd(3) ? "d1" : undefined;
      expect(allocateRowAvailability(id, fns, inv, { fnIdx, zoneKey, elIdx }, date, pool)).toEqual(oldAlloc(id, fns, { fnIdx, zoneKey, elIdx }, date, pool));
    }
  });
});

describe("netOwnReservedBlocksLive — source-agnostic by design (soldBlocksPlan's provenance tags change WHO can release a blocks entry, never whether availability math counts it)", () => {
  it("nets several of this event's own entries together regardless of source — a card-matched one, a Deal Check manual one, an IMS AI-matched one and an IMS ops manual Block all count toward the same deal's own stock", () => {
    const blocksDetail = {
      pod: [
        { eventId: "eo_1", qty: 2, source: "studio-incremental" },
        { eventId: "eo_1", qty: 1, source: "studio-manual" },
        { eventId: "eo_1", qty: 3, source: "ims-autoconfirm" },
        { eventId: "eo_1", qty: 4, source: "ims-manual" },
        { eventId: "eo_other", qty: 99, source: "studio-incremental" }, // a different deal — never counted
      ],
    };
    expect(netOwnReservedBlocksLive({ pod: 10 }, "pod", blocksDetail, "eo_1")).toEqual({ pod: 0 });
    expect(netOwnReservedBlocksLive({ pod: 20 }, "pod", blocksDetail, "eo_1")).toEqual({ pod: 10 }); // 20 - (2+1+3+4)
  });

  it("an untagged legacy entry (no source at all) is counted exactly the same as a tagged one", () => {
    const blocksDetail = { pod: [{ eventId: "eo_1", qty: 5 }] };
    expect(netOwnReservedBlocksLive({ pod: 10 }, "pod", blocksDetail, "eo_1")).toEqual({ pod: 5 });
  });
});

import { describe, it, expect } from "vitest";
import { carpetKey, freeForEvent, carpetFloorsOf, planCarpets, carpetStockFor } from "./carpetPlan.js";
import { CARPET_OFF } from "../studio/taxonomy.js";

const item = (id, name, qty, extra = {}) => ({ id, name, qty, blocked: 0, ...extra });
const A = item("A", "Maroon", 100), B = item("B", "Grey", 300), C = item("C", "Beige", 50);
const itemsById = { A, B, C };
const pref = (it) => ({ id: it.id, name: it.name, free: it.qty });

const layout = (zones) => [{ fnIdx: 0, date: "2027-01-03", type: "Wedding", venue: "Aura", enabledEls: { stage: true, entry: true }, zones }];

describe("freeForEvent", () => {
  it("owned minus what OTHER events hold that day, not this event's own hold", () => {
    const blocks = { A: [
      { date: "2027-01-03", eventId: "eo_other", qty: 30 },
      { date: "2027-01-03", eventId: "eo_me", qty: 80 },        // this event's own hold: not subtracted
      { date: "2027-01-04", eventId: "eo_other", qty: 50 },     // another day
      { date: "2027-01-03", eventId: "eo_x", qty: 10, status: "released" }, // released
    ] };
    expect(freeForEvent(A, blocks, "2027-01-03", "eo_me")).toBe(70);
  });
  it("never below zero; unknown item is null", () => {
    expect(freeForEvent(A, { A: [{ date: "d", eventId: "o", qty: 500 }] }, "d", "me")).toBe(0);
    expect(freeForEvent(undefined, {}, "d", "me")).toBeNull();
  });
});

describe("carpetFloorsOf", () => {
  it("lists a zone's floor and its extra platform floors, with area, key and preferences", () => {
    const f = carpetFloorsOf(layout({
      stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(A), pref(B)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100,
        extraPlatformRows: [{ cpT: "old", floorDims: { L: 5, W: 4 }, cpPrefs: [pref(C)], cpInvId: "C", cpInvName: "Beige", cpInvFree: 50 }] },
    }), (fn, zk) => "Stage");
    expect(f.map((x) => x.key)).toEqual([carpetKey(0, "stage", 0), carpetKey(0, "stage", 1)]);
    expect(f.map((x) => x.area)).toEqual([200, 20]);
    expect(f[0].prefs.map((p) => p.id)).toEqual(["A", "B"]);
    expect(f[1].zoneName).toBe("Stage (floor 2)");
    expect(f[0].date).toBe("2027-01-03");
  });
  it("skips carpet turned off, a floor with no size, and a switched-off zone", () => {
    const f = carpetFloorsOf(layout({
      stage: { cpT: CARPET_OFF, floorDims: { L: 20, W: 10 } },
      entry: { cpT: "old", floorDims: {} },
      gone: { cpT: "old", floorDims: { L: 5, W: 5 } },
    }).map((x) => ({ ...x, enabledEls: { stage: true, entry: true, gone: false } })));
    expect(f).toEqual([]);
  });
  it("an unset material still bills the default carpet, so the floor is planned (even with no preference yet)", () => {
    const f = carpetFloorsOf(layout({ stage: { floorDims: { L: 10, W: 10 } } }));
    expect(f).toHaveLength(1);
    expect(f[0].prefs).toEqual([]);
  });
  it("a floor saved with only the old single pick counts it as the one preference", () => {
    const f = carpetFloorsOf(layout({ stage: { cpT: "old", floorDims: { L: 10, W: 10 }, cpInvId: "B", cpInvName: "Grey", cpInvFree: 300 } }));
    expect(f[0].prefs.map((p) => p.id)).toEqual(["B"]);
  });
});

describe("planCarpets", () => {
  const floors = carpetFloorsOf(layout({
    stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(A), pref(B), pref(C)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
  }));
  const run = (blocks, choice) => planCarpets({ floors, itemsById, blocks, eventId: "eo_me", choice }).rows[0];

  it("shows each preference with what is free that day, and suggests the first that covers the floor (200 sqft)", () => {
    const r = run({}, {});
    expect(r.options.map((o) => [o.id, o.free, o.enough])).toEqual([["A", 100, false], ["B", 300, true], ["C", 50, false]]);
    expect(r.suggestedId).toBe("B"); // A has only 100
    expect(r.status).toBe("open");
    expect(r.options.find((o) => o.id === "A").short).toBe(100);
  });
  it("another event holding the 2nd choice that day moves the suggestion on", () => {
    const r = run({ B: [{ date: "2027-01-03", eventId: "eo_other", qty: 250 }] }, {});
    expect(r.options.find((o) => o.id === "B").free).toBe(50);
    expect(r.status).toBe("short");           // nothing covers 200
    expect(r.suggestedId).toBe("A");           // the one with most free (100)
  });
  it("the head's decision is kept and reported", () => {
    const r = run({}, { [floors[0].key]: { id: "B" } });
    expect(r.decidedId).toBe("B");
    expect(r.status).toBe("decided");
  });
  it("a decision for a carpet that is no longer one of the preferences is ignored", () => {
    const r = run({}, { [floors[0].key]: { id: "ZZ" } });
    expect(r.decidedId).toBeNull();
    expect(r.status).toBe("open");
  });
  it("a floor with no preferences is reported as such", () => {
    const f2 = carpetFloorsOf(layout({ stage: { cpT: "old", floorDims: { L: 10, W: 10 } } }));
    const r = planCarpets({ floors: f2, itemsById, blocks: {}, eventId: "e", choice: {} }).rows[0];
    expect(r.status).toBe("none");
    expect(r.suggestedId).toBeNull();
  });
  it("two floors deciding the same carpet are flagged when together they need more than is free", () => {
    const fl = carpetFloorsOf(layout({
      stage: { cpT: "old", floorDims: { L: 10, W: 10 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
      entry: { cpT: "old", floorDims: { L: 10, W: 6 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
    }));
    const choice = { [fl[0].key]: { id: "A" }, [fl[1].key]: { id: "A" } };
    const { over } = planCarpets({ floors: fl, itemsById, blocks: {}, eventId: "e", choice });
    expect(over.A).toEqual({ free: 100, committed: 160 });
  });
  it("no over-commit when it fits", () => {
    const fl = carpetFloorsOf(layout({
      stage: { cpT: "old", floorDims: { L: 10, W: 5 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
      entry: { cpT: "old", floorDims: { L: 10, W: 5 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
    }));
    const choice = { [fl[0].key]: { id: "A" }, [fl[1].key]: { id: "A" } };
    expect(planCarpets({ floors: fl, itemsById, blocks: {}, eventId: "e", choice }).over).toEqual({});
  });
});

describe("a carpet Planning picks by hand when none of sales' choices is available", () => {
  const D = item("D", "Teal", 400, { subCat: "carpet" });
  const E = item("E", "Cream", 120, { subCat: "carpet" });
  const wall = item("W", "Printed wall", 9, { subCat: "PRINTED WALLS" });
  const stock = { ...itemsById, D, E };
  const floors = carpetFloorsOf(layout({
    stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(A), pref(C)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
  }));
  const k = floors[0].key;
  const run = (choice, blocks = {}) => planCarpets({ floors, itemsById: stock, blocks, eventId: "eo_me", choice }).rows[0];

  it("a hand-picked carpet outside sales' choices is a valid decision, shown as the manual option", () => {
    const r = run({ [k]: { id: "D", name: "Teal", manual: true } });
    expect(r.decidedId).toBe("D");
    expect(r.status).toBe("decided");
    expect(r.manual).toMatchObject({ id: "D", free: 400, enough: true });
    expect(r.options.map((o) => o.id)).toEqual(["A", "C"]); // sales' choices are untouched
  });
  it("without the manual flag a carpet outside sales' choices is still ignored", () => {
    const r = run({ [k]: { id: "D", name: "Teal" } });
    expect(r.decidedId).toBeNull();
    expect(r.manual).toBeNull();
  });
  it("a hand pick that is already one of sales' choices is just that choice", () => {
    const r = run({ [k]: { id: "C", name: "Beige", manual: true } });
    expect(r.decidedId).toBe("C");
    expect(r.manual).toBeNull();
  });
  it("a floor sales picked nothing for is decided once Planning picks a carpet by hand", () => {
    const bare = carpetFloorsOf(layout({ stage: { cpT: "old", floorDims: { L: 20, W: 10 } } }));
    const k0 = bare[0].key;
    const none = planCarpets({ floors: bare, itemsById: stock, blocks: {}, eventId: "e", choice: {} }).rows[0];
    expect(none.status).toBe("none");
    const picked = planCarpets({ floors: bare, itemsById: stock, blocks: {}, eventId: "e", choice: { [k0]: { id: "D", name: "Teal", manual: true } } }).rows[0];
    expect(picked.status).toBe("decided");
    expect(picked.decidedId).toBe("D");
  });
  it("a hand pick for an item that no longer exists is ignored", () => {
    expect(run({ [k]: { id: "GONE", name: "x", manual: true } }).decidedId).toBeNull();
  });
  it("a hand-picked carpet counts toward over-commit like any other", () => {
    const two = carpetFloorsOf(layout({
      stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
      entry: { cpT: "old", floorDims: { L: 10, W: 10 }, cpPrefs: [pref(A)], cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 },
    }));
    const choice = { [two[0].key]: { id: "E", name: "Cream", manual: true }, [two[1].key]: { id: "E", name: "Cream", manual: true } };
    const { over } = planCarpets({ floors: two, itemsById: stock, blocks: {}, eventId: "e", choice });
    expect(over.E).toEqual({ free: 120, committed: 300 });
  });
  it("carpetStockFor lists every carpet with that day's free sqft, those that cover the floor first, and only carpets", () => {
    const asCarpet = (x) => ({ ...x, subCat: "carpet" });
    const list = carpetStockFor(floors[0], [asCarpet(A), asCarpet(B), asCarpet(C), D, E, wall], { B: [{ date: "2027-01-03", eventId: "eo_other", qty: 250 }] }, "eo_me");
    expect(list.find((o) => o.id === "W")).toBeUndefined();
    expect(list[0].id).toBe("D");                  // 400 covers the 200 sqft floor
    expect(list.find((o) => o.id === "B").free).toBe(50);   // another event holds 250 that day
    expect(list.find((o) => o.id === "B").enough).toBe(false);
    // everything that covers comes before everything that does not
    const firstShort = list.findIndex((o) => !o.enough);
    expect(list.slice(firstShort).every((o) => !o.enough)).toBe(true);
  });
});

describe("same venue, same date: a carpet already laid for another event is reusable", () => {
  const T = item("T", "Teal", 300, { subCat: "carpet" });
  const stock = { ...itemsById, T };
  const orders = [
    { id: "eo_other", clientName: "Mr. Sharma", venue: "Aura", functionsDetail: [{ date: "2027-01-03", venue: "Aura", type: "Haldi" }] },
    { id: "eo_far", clientName: "Ms. Bansal", venue: "Exotica", functionsDetail: [{ date: "2027-01-03", venue: "Exotica", type: "Wedding" }] },
  ];
  const floors = carpetFloorsOf(layout({ stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 } }));
  const run = (blocks, choice = {}) => planCarpets({ floors, itemsById: stock, blocks, eventId: "eo_me", choice, eventOrders: orders }).rows[0];

  it("another client's event holding the carpet at THIS venue that day does not make it short", () => {
    // 300 owned, another event at the same venue holds 250 that day: raw free 50, but it stays laid, so 200 sqft is covered
    const r = run({ T: [{ date: "2027-01-03", eventId: "eo_other", qty: 250 }] });
    const o = r.options[0];
    expect(o.free).toBe(50);
    expect(o.reuse).toMatchObject({ qty: 250, who: ["Mr. Sharma · Haldi"] });
    expect(o.enough).toBe(true);
    expect(o.short).toBe(0);
    expect(r.status).toBe("open");
  });
  it("the same hold by an event at a DIFFERENT venue is a real conflict and stays short", () => {
    const o = run({ T: [{ date: "2027-01-03", eventId: "eo_far", qty: 250 }] }).options[0];
    expect(o.reuse).toBeNull();
    expect(o.enough).toBe(false);
    expect(o.short).toBe(150);
  });
  it("reuse never promises more than the studio owns", () => {
    const o = run({ T: [{ date: "2027-01-03", eventId: "eo_other", qty: 900 }] }).options[0];
    expect(o.enough).toBe(true); // min(300 owned, 0 free + 900) = 300 >= 200
    const bigFloor = carpetFloorsOf(layout({ stage: { cpT: "old", floorDims: { L: 30, W: 20 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 } }));
    const r = planCarpets({ floors: bigFloor, itemsById: stock, blocks: { T: [{ date: "2027-01-03", eventId: "eo_other", qty: 900 }] }, eventId: "eo_me", choice: {}, eventOrders: orders }).rows[0];
    expect(r.options[0].short).toBe(300); // 600 sqft needed, only 300 exist
  });
  it("carpetStockFor carries the reuse too", () => {
    const list = carpetStockFor(floors[0], [{ ...T }], { T: [{ date: "2027-01-03", eventId: "eo_other", qty: 250 }] }, "eo_me", orders, floors, {});
    expect(list[0].enough).toBe(true);
    expect(list[0].reuse.qty).toBe(250);
  });

  describe("another function of the SAME event", () => {
    const two = carpetFloorsOf([
      { fnIdx: 0, date: "2027-01-03", type: "Haldi", venue: "Aura", enabledEls: { stage: true }, zones: { stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 } } },
      { fnIdx: 1, date: "2027-01-03", type: "Cocktail", venue: "Aura", enabledEls: { stage: true }, zones: { stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 } } },
    ]);
    const choice = { [two[0].key]: { id: "T" }, [two[1].key]: { id: "T" } };
    it("both functions use the same carpet at one venue on one date: shared, not over-committed", () => {
      const { rows, over } = planCarpets({ floors: two, itemsById: stock, blocks: {}, eventId: "e", choice, eventOrders: [] });
      expect(over).toEqual({});
      expect(rows[0].options[0].reuse.siblings).toEqual(["Cocktail · stage"]);
      expect(rows[1].options[0].reuse.siblings).toEqual(["Haldi · stage"]);
    });
    it("at different venues they add up (200 + 200 > 300)", () => {
      const apart = two.map((f, i) => (i === 1 ? { ...f, venue: "Exotica" } : f));
      const { over, rows } = planCarpets({ floors: apart, itemsById: stock, blocks: {}, eventId: "e", choice, eventOrders: [] });
      expect(over.T).toEqual({ free: 300, committed: 400 });
      expect(rows[0].options[0].reuse).toBeNull();
    });
    it("on different dates they do not compete at all", () => {
      const days = two.map((f, i) => (i === 1 ? { ...f, date: "2027-01-04" } : f));
      expect(planCarpets({ floors: days, itemsById: stock, blocks: {}, eventId: "e", choice, eventOrders: [] }).over).toEqual({});
    });
    it("two floors of ONE function at one venue still add up (they are different floors)", () => {
      const sameFn = carpetFloorsOf(layout({
        stage: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 },
        entry: { cpT: "old", floorDims: { L: 20, W: 10 }, cpPrefs: [pref(T)], cpInvId: "T", cpInvName: "Teal", cpInvFree: 300 },
      }));
      const ch = { [sameFn[0].key]: { id: "T" }, [sameFn[1].key]: { id: "T" } };
      const { over, rows } = planCarpets({ floors: sameFn, itemsById: stock, blocks: {}, eventId: "e", choice: ch, eventOrders: [] });
      expect(over.T).toEqual({ free: 300, committed: 400 });
      expect(rows[0].options[0].reuse).toBeNull();
    });
  });
});

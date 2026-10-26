import { describe, it, expect } from "vitest";
import { carpetKey, freeForEvent, carpetFloorsOf, planCarpets, carpetStockFor } from "./carpetPlan.js";
import { CARPET_OFF } from "../studio/taxonomy.js";

const item = (id, name, qty, extra = {}) => ({ id, name, qty, blocked: 0, ...extra });
const A = item("A", "Maroon", 100), B = item("B", "Grey", 300), C = item("C", "Beige", 50);
const itemsById = { A, B, C };
const pref = (it) => ({ id: it.id, name: it.name, free: it.qty });

const layout = (zones) => [{ fnIdx: 0, date: "2027-01-03", type: "Wedding", enabledEls: { stage: true, entry: true }, zones }];

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

import { describe, it, expect } from "vitest";
import { prefsOf, prefsPatch, clearPrefsPatch, prefsStatus, assignCarpets, carpetRemainingFor, CARPET_PREF_MAX } from "./carpetPrefs.js";

const A = { id: "A", name: "Maroon", free: 100 };
const B = { id: "B", name: "Grey", free: 300 };
const C = { id: "C", name: "Beige", free: 50 };

describe("prefsOf", () => {
  it("nothing picked is an empty list", () => {
    expect(prefsOf(undefined)).toEqual([]);
    expect(prefsOf({})).toEqual([]);
    expect(prefsOf({ cpPrefs: [] })).toEqual([]);
  });
  it("a floor saved before preferences existed has its single pick as the one preference", () => {
    expect(prefsOf({ cpInvId: "A", cpInvName: "Maroon", cpInvFree: 100 })).toEqual([A]);
  });
  it("a saved list comes back in rank order, at most three, no repeats", () => {
    const row = { cpPrefs: [A, B, C, { id: "D", name: "x", free: 1 }, A], cpInvId: "A" };
    expect(prefsOf(row).map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(CARPET_PREF_MAX).toBe(3);
  });
  it("an older writer that changed cpInvId alone: the new pick leads, the rest follow", () => {
    expect(prefsOf({ cpPrefs: [A, B], cpInvId: "B", cpInvName: "Grey", cpInvFree: 300 }).map((p) => p.id)).toEqual(["B", "A"]);
  });
  it("an older writer that cleared cpInvId alone: the stale list is ignored", () => {
    expect(prefsOf({ cpPrefs: [A, B], cpInvId: null })).toEqual([]);
  });
});

describe("prefsPatch", () => {
  it("fills 1st, 2nd, 3rd in order and mirrors the 1st into cpInvId", () => {
    let row = {};
    row = { ...row, ...prefsPatch(row, 0, A) };
    row = { ...row, ...prefsPatch(row, 1, B) };
    row = { ...row, ...prefsPatch(row, 2, C) };
    expect(row.cpPrefs.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(row.cpInvId).toBe("A");
    expect(row.cpInvName).toBe("Maroon");
    expect(row.cpInvFree).toBe(100);
    expect(prefsStatus(row)).toEqual({ count: 3, max: 3, complete: true });
  });
  it("clicking the 3rd slot while only one is picked puts it next in line (no gap)", () => {
    const row = prefsPatch({}, 0, A);
    const p = prefsPatch({ ...row }, 2, B);
    expect(p.cpPrefs.map((x) => x.id)).toEqual(["A", "B"]);
  });
  it("replacing the 1st choice changes the mirrored cpInvId", () => {
    const row = { cpPrefs: [A, B], cpInvId: "A" };
    const p = prefsPatch(row, 0, C);
    expect(p.cpPrefs.map((x) => x.id)).toEqual(["C", "B"]);
    expect(p.cpInvId).toBe("C");
  });
  it("picking a carpet that is already in another slot moves it (it is never listed twice)", () => {
    const row = { cpPrefs: [A, B, C], cpInvId: "A" };
    const p = prefsPatch(row, 0, C); // C was 3rd; it takes the 1st slot, replacing A
    expect(p.cpPrefs.map((x) => x.id)).toEqual(["C", "B"]);
    expect(p.cpInvId).toBe("C");
  });
  it("removing a slot closes the gap: the 2nd becomes the 1st", () => {
    const row = { cpPrefs: [A, B, C], cpInvId: "A" };
    const p = prefsPatch(row, 0, null);
    expect(p.cpPrefs.map((x) => x.id)).toEqual(["B", "C"]);
    expect(p.cpInvId).toBe("B");
    expect(p.cpInvFree).toBe(300);
  });
  it("removing the only preference clears the mirror too", () => {
    const p = prefsPatch({ cpPrefs: [A], cpInvId: "A" }, 0, null);
    expect(p).toEqual({ cpPrefs: [], cpInvId: null, cpInvName: "", cpInvFree: null });
    expect(clearPrefsPatch()).toEqual(p);
  });
  it("a pick without an id is ignored like a removal", () => {
    expect(prefsPatch({ cpPrefs: [A], cpInvId: "A" }, 0, {}).cpPrefs).toEqual([]);
  });
});

describe("assignCarpets — each floor takes its best preference with room", () => {
  it("one preference behaves exactly like the old single pick", () => {
    const floors = [
      { key: "stage", area: 80, prefs: [A] },
      { key: "entry", area: 60, prefs: [A] },
    ];
    const { assign, short } = assignCarpets(floors);
    expect(assign).toEqual({ stage: "A", entry: "A" });
    expect(short).toEqual({ entry: 40 }); // 100 free: 80 for the stage, 20 left for 60
  });
  it("when the 1st choice runs out the 2nd takes the floor, so nothing is short", () => {
    const floors = [
      { key: "stage", area: 80, prefs: [A, B] },
      { key: "entry", area: 60, prefs: [A, B] },
    ];
    const { assign, short } = assignCarpets(floors);
    expect(assign).toEqual({ stage: "A", entry: "B" });
    expect(short).toEqual({});
  });
  it("short only when no preference can cover it, by what the best one lacks", () => {
    const floors = [{ key: "stage", area: 400, prefs: [A, B, C] }];
    const { assign, short } = assignCarpets(floors);
    expect(assign.stage).toBe("B"); // 300 is the most any has
    expect(short.stage).toBe(100);
  });
  it("a preference with no known free figure can't be checked and is skipped", () => {
    const { assign, short } = assignCarpets([{ key: "a", area: 500, prefs: [{ id: "X", name: "?", free: null }] }]);
    expect(assign.a).toBe("X");
    expect(short).toEqual({});
  });
  it("a floor with no size or no preferences is left alone", () => {
    const r = assignCarpets([{ key: "a", area: 0, prefs: [A] }, { key: "b", area: 50, prefs: [] }]);
    expect(r.short).toEqual({});
    expect(r.assign.b).toBeNull();
  });
});

describe("carpetRemainingFor — how big can this floor be made", () => {
  it("the most any of its preferences has left after the other floors", () => {
    const floors = [
      { key: "stage", area: 80, prefs: [A, B] },
      { key: "entry", area: 60, prefs: [A, B] },
    ];
    // for 'entry': stage takes A(80) -> A has 20 left, B has 300; the most is 300
    expect(carpetRemainingFor(floors, "entry")).toBe(300);
    // for 'stage': entry takes A(60) -> A has 40 left, B 300
    expect(carpetRemainingFor(floors, "stage")).toBe(300);
  });
  it("with one preference it is what that carpet has left", () => {
    const floors = [{ key: "stage", area: 80, prefs: [A] }, { key: "entry", area: 60, prefs: [A] }];
    expect(carpetRemainingFor(floors, "entry")).toBe(20);
  });
  it("null when nothing is picked or nothing has a known figure", () => {
    expect(carpetRemainingFor([{ key: "a", area: 10, prefs: [] }], "a")).toBeNull();
    expect(carpetRemainingFor([{ key: "a", area: 10, prefs: [{ id: "X", free: null }] }], "a")).toBeNull();
    expect(carpetRemainingFor([], "zzz")).toBeNull();
  });
});

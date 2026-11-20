import { describe, it, expect } from "vitest";
import { assembleMandiCatalogueFromRows } from "./flowerHelpers";
import { shownValue } from "./draftValue";

// Owner report 2026-11-20 (Flowers section): typing in a row stops after a letter and the value appears later - the saved flower jumped
// to the bottom of the list on the realtime refetch (rows come back in physical order, an UPDATE moves a row to the end).
describe("the mandi catalogue keeps a fixed order", () => {
  const row = (id, name, extra = {}) => ({ id, name, flower_cat: "Rose", unit: "bundle", current_price: 10, ...extra });
  const ids = (rows) => assembleMandiCatalogueFromRows(rows).map((f) => f.id);
  it("orders by id whatever order the database returned the rows in", () => {
    expect(ids([row("F3", "c"), row("F1", "a"), row("F2", "b")])).toEqual(["F1", "F2", "F3"]);
    expect(ids([row("F2", "b"), row("F3", "c"), row("F1", "a")])).toEqual(["F1", "F2", "F3"]);
  });
  it("a row that was just edited (so the database now returns it LAST) stays where it was", () => {
    const before = ids([row("F1", "a"), row("F2", "b"), row("F3", "c")]);
    const afterEditOfF1 = ids([row("F2", "b"), row("F3", "c"), row("F1", "a2")]);
    expect(afterEditOfF1).toEqual(before);
  });
  it("renaming a flower does not move it (the order is by id, not by name)", () => {
    expect(ids([row("F1", "zzz"), row("F2", "aaa")])).toEqual(["F1", "F2"]);
  });
  it("ids with numbers (legacy ones) order naturally, ids made in the app by their base-36 timestamp", () => {
    expect(ids([row("M10", "x"), row("M2", "y"), row("M1", "z")])).toEqual(["M1", "M2", "M10"]);
    expect(ids([row("Fmabc1", "x"), row("Fmabb9", "y")])).toEqual(["Fmabb9", "Fmabc1"]);
  });
  it("does not mutate its input; empty / bad input gives []", () => {
    const input = [row("F2", "b"), row("F1", "a")];
    assembleMandiCatalogueFromRows(input);
    expect(input.map((r) => r.id)).toEqual(["F2", "F1"]);
    expect(assembleMandiCatalogueFromRows(null)).toEqual([]);
    expect(assembleMandiCatalogueFromRows(undefined)).toEqual([]);
  });
  it("keeps every field the editors read", () => {
    const [f] = assembleMandiCatalogueFromRows([row("F1", "Rose", { gatthar_size: 20, flower_type: "flower", markup: 30 })]);
    expect(f).toMatchObject({ id: "F1", name: "Rose", flowerCat: "Rose", unit: "bundle", gattharSize: 20, flowerType: "flower", markup: 30, currentPrice: 10 });
  });
});

describe("shownValue - what an input shows while its save is on the way", () => {
  it("shows the draft while being typed in, even an empty one", () => {
    expect(shownValue({ draft: "30", held: null, value: 10 })).toBe("30");
    expect(shownValue({ draft: "", held: { raw: "5", base: 10 }, value: 10 })).toBe("");
  });
  it("after leaving the field it keeps showing what was typed until the saved value arrives (not the old one flashing back)", () => {
    expect(shownValue({ draft: null, held: { raw: "300", base: 200 }, value: 200 })).toBe("300");
    expect(shownValue({ draft: null, held: { raw: "300", base: "200" }, value: 200 })).toBe("300"); // number vs string
  });
  it("while held, the committed text is shown even if an earlier save's echo changed the prop (two quick edits of one box)", () => {
    expect(shownValue({ draft: null, held: { raw: "55", base: "" }, value: "5" })).toBe("55");
  });
  it("once the hold is released (DraftInput: the prop reached the committed text, or 8 s) the prop is shown", () => {
    expect(shownValue({ draft: null, held: null, value: 300 })).toBe(300);
  });
  it("with nothing held it shows the prop, empty for null / undefined", () => {
    expect(shownValue({ draft: null, held: null, value: 12 })).toBe(12);
    expect(shownValue({ draft: null, held: null, value: null })).toBe("");
    expect(shownValue({ draft: undefined, held: undefined, value: undefined })).toBe("");
  });
});

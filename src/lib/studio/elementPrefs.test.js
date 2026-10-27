import { describe, it, expect } from "vitest";
import { itemTakesChoices, elementChoices, hasChoices, withChoices, withoutChoices, applyChoicePicks, ELEMENT_PREF_MAX } from "./elementPrefs.js";

const P = (id, free = 100) => ({ id, name: "n" + id, free });

describe("itemTakesChoices — overlays and cushion covers only", () => {
  it("every overlay", () => {
    expect(itemTakesChoices({ subCat: "OVERLAYS", name: "Table Top Green Patti" })).toBe(true);
    expect(itemTakesChoices({ subcategory: "overlays", name: "x" })).toBe(true);
  });
  it("cushion covers, in any case, but not inserts or made-to-order cushions", () => {
    expect(itemTakesChoices({ subCat: "Cushion", name: "Cushion Cover Sona Gold Print" })).toBe(true);
    expect(itemTakesChoices({ subCat: "Cushion", name: "cushion cover silver print" })).toBe(true);
    expect(itemTakesChoices({ subCat: "Cushion", name: "White Square Cushion Insert (approx 16x16 inch)" })).toBe(false);
    expect(itemTakesChoices({ subCat: "Cushion", name: "Custom Printed Cushions" })).toBe(false);
  });
  it("nothing else", () => {
    ["BOLSTER", "Runner", "PRINTED WALLS", "carpet", "", undefined].forEach((s) => expect(itemTakesChoices({ subCat: s, name: "Cushion Cover" })).toBe(false));
    expect(itemTakesChoices(null)).toBe(false);
    expect(itemTakesChoices(undefined)).toBe(false);
  });
});

describe("elementChoices", () => {
  it("an ordinary element has none", () => {
    expect(elementChoices({ invId: "A" })).toEqual([]);
    expect(hasChoices({ invId: "A" })).toBe(false);
    expect(elementChoices(null)).toEqual([]);
  });
  it("the list in rank order, up to four, no repeats", () => {
    const el = { invId: "A", prefs: [P("A"), P("B"), P("B"), P("C"), P("D"), P("E")] };
    expect(elementChoices(el).map((p) => p.id)).toEqual(["A", "B", "C", "D"]);
    expect(ELEMENT_PREF_MAX).toBe(4);
  });
  it("a single entry is not 'choices'", () => {
    expect(elementChoices({ invId: "A", prefs: [P("A")] })).toEqual([]);
  });
  it("stale: the element was swapped to another item through the ordinary picker, so the old list no longer applies", () => {
    expect(elementChoices({ invId: "Z", prefs: [P("A"), P("B")] })).toEqual([]);
    expect(elementChoices({ invId: null, prefs: [P("A"), P("B")] })).toEqual([]);
  });
  it("junk entries are skipped", () => {
    expect(elementChoices({ invId: "A", prefs: [P("A"), {}, null, P("B")] }).map((p) => p.id)).toEqual(["A", "B"]);
  });
});

describe("withChoices", () => {
  it("stores the picks as the element's choices and gives it a stable pid", () => {
    const n = withChoices({ invId: "A", name: "na", qty: 20 }, [P("A"), P("B"), P("C")], () => "pid1");
    expect(n.prefs.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(n.pid).toBe("pid1");
    expect(n.qty).toBe(20);
  });
  it("keeps the pid it already had (a decision made for it must keep finding it)", () => {
    const n = withChoices({ invId: "A", pid: "keep" }, [P("A"), P("B")], () => "new");
    expect(n.pid).toBe("keep");
  });
  it("fewer than two picks means no alternatives: the choices are dropped, the pid is left alone", () => {
    const had = withChoices({ invId: "A" }, [P("A"), P("B")], () => "p1");
    const n = withChoices(had, [P("A")]);
    expect("prefs" in n).toBe(false);
    expect(n.pid).toBe("p1");
  });
  it("picks whose first is not the element's own item are refused (the caller must apply the 1st pick first)", () => {
    const n = withChoices({ invId: "A" }, [P("B"), P("C")], () => "p");
    expect("prefs" in n).toBe(false);
  });
  it("caps at four and removes repeats and junk", () => {
    const n = withChoices({ invId: "A" }, [P("A"), P("A"), {}, P("B"), P("C"), P("D"), P("E")], () => "p");
    expect(n.prefs.map((p) => p.id)).toEqual(["A", "B", "C", "D"]);
  });
  it("never changes the element it was given", () => {
    const e = { invId: "A", qty: 5 };
    const copy = JSON.parse(JSON.stringify(e));
    withChoices(e, [P("A"), P("B")], () => "p");
    expect(e).toEqual(copy);
  });
  it("withoutChoices drops only the list", () => {
    const n = withoutChoices({ invId: "A", pid: "p1", prefs: [P("A"), P("B")], qty: 3 });
    expect(n).toEqual({ invId: "A", pid: "p1", qty: 3 });
  });
});

describe("applyChoicePicks — what saving the choices picker does", () => {
  const items = [{ id: "A", name: "na", free: 0, unit: "Pieces" }, { id: "B", name: "nb", free: 40, unit: "Pieces" }, { id: "C", name: "nc", free: 30, unit: "Pieces" }];
  const base = { invId: "A", name: "na", unit: "Pieces", qty: 20 };
  it("keeping the element's own item first: it only gains the choices", () => {
    const n = applyChoicePicks(base, [P("A"), P("B"), P("C")], items, () => "pid");
    expect(n.invId).toBe("A");
    expect(n.prefs.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(n.pid).toBe("pid");
    expect(n.qty).toBe(20);
  });
  it("another item first: the element is swapped to it (pinned, original remembered) and the choices follow", () => {
    const n = applyChoicePicks(base, [P("B"), P("C")], items, () => "pid");
    expect(n).toMatchObject({ invId: "B", name: "nb", imsId: "B", baseInvId: "A", swappedFrom: "A" });
    expect(n.prefs.map((p) => p.id)).toEqual(["B", "C"]);
  });
  it("one pick is an ordinary pick: no choices, and old ones are cleared", () => {
    const had = applyChoicePicks(base, [P("A"), P("B")], items, () => "pid");
    const n = applyChoicePicks(had, [P("A")], items);
    expect("prefs" in n).toBe(false);
    expect(n.invId).toBe("A");
    const swapped = applyChoicePicks(had, [P("C")], items);
    expect(swapped.invId).toBe("C");
    expect("prefs" in swapped).toBe(false);
  });
  it("no picks leaves the element alone", () => {
    expect(applyChoicePicks(base, [], items)).toBe(base);
  });
  it("re-saving keeps the pid so a decision made for the element still finds it", () => {
    const first = applyChoicePicks(base, [P("A"), P("B")], items, () => "pid1");
    const again = applyChoicePicks(first, [P("A"), P("C")], items, () => "other");
    expect(again.pid).toBe("pid1");
  });
});

import { partChoices, applyPartChoicePicks } from "./elementPrefs";
describe("choices for a part inside a kit", () => {
  const mk = () => "pNEW";
  it("picks become the part's choices; the 1st is its item and it gets a pid", () => {
    const part = applyPartChoicePicks({ itemId: "A", qty: 2 }, [P("B"), P("C")], mk);
    expect(part).toMatchObject({ itemId: "B", qty: 2, pid: "pNEW" });
    expect(partChoices(part).map((c) => c.id)).toEqual(["B", "C"]);
  });
  it("keeps an existing pid so a saved decision stays valid", () => {
    const part = applyPartChoicePicks({ itemId: "A", qty: 1, pid: "pOLD" }, [P("A"), P("D")], mk);
    expect(part.pid).toBe("pOLD");
  });
  it("one pick is an ordinary swap: no choices, item changed", () => {
    const part = applyPartChoicePicks({ itemId: "A", qty: 1, prefs: [P("A"), P("B")], pid: "pX" }, [P("C")], mk);
    expect(part.itemId).toBe("C");
    expect(part.prefs).toBeUndefined();
    expect(partChoices(part)).toEqual([]);
  });
  it("swapping the part's item by hand (prefs no longer led by it) drops the choices", () => {
    expect(partChoices({ itemId: "Z", prefs: [P("A"), P("B")] })).toEqual([]);
    expect(partChoices(null)).toEqual([]);
  });
  it("no picks: the part is returned as it is", () => {
    const part = { itemId: "A", qty: 1 };
    expect(applyPartChoicePicks(part, [], mk)).toBe(part);
  });
});

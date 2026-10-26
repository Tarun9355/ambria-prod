import { describe, it, expect } from "vitest";
import { elementAfterPick } from "./elementPick.js";

const el = (extra = {}) => ({ invId: "A", name: "Cover A", unit: "Pieces", qty: 20, ...extra });
const items = [
  { id: "A", name: "Cover A", free: 0, unit: "Pieces", photo: "a.jpg" },
  { id: "B", name: "Cover B", free: 50, unit: "Pieces", photo: "b.jpg" },
  { id: "C", name: "Cover C", free: 5, unit: "Sets", photo: "c.jpg" },
];

describe("elementAfterPick — the one rule for swapping an element's item (moved out of saveAvailPick, unchanged)", () => {
  it("picking another item swaps invId, name and the pinned stock item", () => {
    const n = elementAfterPick(el(), "B", items[1], items);
    expect(n).toMatchObject({ invId: "B", name: "Cover B", imsId: "B", imsName: "Cover B", imsPhoto: "b.jpg", unit: "Pieces", qty: 20 });
  });
  it("the original had nothing free: it is a swap, and the original is remembered", () => {
    const n = elementAfterPick(el(), "B", items[1], items);
    expect(n.swappedFrom).toBe("A");
    expect(n.baseInvId).toBe("A");
  });
  it("the original still had stock: a voluntary swap — baseInvId is kept, no swap marker", () => {
    const withStock = items.map((i) => (i.id === "A" ? { ...i, free: 30 } : i));
    const n = elementAfterPick(el(), "B", items[1], withStock);
    expect(n.swappedFrom).toBeUndefined();
    expect("swappedFrom" in n).toBe(false);
    expect(n.baseInvId).toBe("A");
  });
  it("the true original is kept across repeat swaps", () => {
    const first = elementAfterPick(el(), "B", items[1], items);
    const second = elementAfterPick(first, "C", items[2], items);
    expect(second.baseInvId).toBe("A");
    expect(second.swappedFrom).toBe("A");
  });
  it("picking the original back drops the swap marker", () => {
    const swapped = elementAfterPick(el(), "B", items[1], items);
    const back = elementAfterPick(swapped, "A", items[0], items);
    expect("swappedFrom" in back).toBe(false);
    expect("baseInvId" in back).toBe(false);
    expect(back.invId).toBe("A");
  });
  it("a unit change resets qty and baseQty to 1", () => {
    const n = elementAfterPick(el({ baseQty: 20 }), "C", items[2], items);
    expect(n).toMatchObject({ unit: "Sets", qty: 1, baseQty: 1 });
  });
  it("the same unit keeps the qty", () => {
    expect(elementAfterPick(el(), "B", items[1], items).qty).toBe(20);
  });
  it("clearing the pin removes the pin fields and the swap bookkeeping, but not the item", () => {
    const pinned = elementAfterPick(el(), "B", items[1], items);
    const cleared = elementAfterPick(pinned, null, null, items);
    expect(cleared).toMatchObject({ invId: "B", name: "Cover B" });
    ["imsId", "imsName", "imsPhoto", "swappedFrom", "baseInvId"].forEach((k) => expect(k in cleared).toBe(false));
  });
  it("swapping the element to another item drops its choices (they were for the first item)", () => {
    const withPrefs = el({ prefs: [{ id: "A", name: "Cover A", free: 9 }, { id: "B", name: "Cover B", free: 9 }], pid: "p1" });
    const n = elementAfterPick(withPrefs, "C", items[2], items);
    expect("prefs" in n).toBe(false);
    expect(n.pid).toBe("p1");
  });
  it("picking the same first item again keeps the choices", () => {
    const withPrefs = el({ prefs: [{ id: "A", name: "Cover A", free: 9 }, { id: "B", name: "Cover B", free: 9 }] });
    expect(elementAfterPick(withPrefs, "A", items[0], items).prefs).toHaveLength(2);
  });
  it("never changes the element it was given", () => {
    const e = el();
    const copy = JSON.parse(JSON.stringify(e));
    elementAfterPick(e, "B", items[1], items);
    expect(e).toEqual(copy);
  });
});

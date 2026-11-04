import { describe, it, expect } from "vitest";
import { kitVariants, hasKitChoice, elementWithKit, currentKitId, DEFAULT_KIT_ID } from "./kitVariants";
import { rowToItem, itemToRow } from "../inventory/adapter";

const consoleTbl = {
  id: "c1", kitName: "Classic",
  subItems: [{ itemId: "table", qty: 1 }, { itemId: "pot", qty: 3 }],
  altKits: [
    { id: "k2", name: "Royal", subItems: [{ itemId: "table", qty: 1 }, { itemId: "candle", qty: 6 }] },
    { id: "k3", name: "", subItems: [] }, // empty kit - not offered
  ],
};

describe("kitVariants", () => {
  it("lists the default kit first, then the kits with parts", () => {
    expect(kitVariants(consoleTbl).map((k) => [k.id, k.name])).toEqual([[DEFAULT_KIT_ID, "Classic"], ["k2", "Royal"]]);
  });
  it("is empty for an item that is not a kit, and one kit means no choice", () => {
    expect(kitVariants({ id: "x" })).toEqual([]);
    expect(hasKitChoice({ id: "x", subItems: [{ itemId: "a", qty: 1 }] })).toBe(false);
    expect(hasKitChoice(consoleTbl)).toBe(true);
  });
});

describe("elementWithKit", () => {
  const el = { invId: "c1", qty: 2, name: "Console", kitOverrides: [{ itemId: "pot", qty: 9 }] };
  it("replaces the parts with the chosen kit - not merged", () => {
    const next = elementWithKit(el, consoleTbl, "k2");
    expect(next.kitOverrides).toEqual([{ itemId: "table", qty: 1 }, { itemId: "candle", qty: 6 }]);
    expect(next.kitId).toBe("k2");
    expect(next.qty).toBe(2);
  });
  it("the default kit clears the parts list so the element follows the master", () => {
    const next = elementWithKit({ ...el, kitId: "k2" }, consoleTbl, DEFAULT_KIT_ID);
    expect(next.kitOverrides).toBeUndefined();
    expect(next.kitId).toBeUndefined();
  });
  it("does not touch the master kit", () => {
    const next = elementWithKit(el, consoleTbl, "k2");
    next.kitOverrides[1].qty = 99;
    expect(consoleTbl.altKits[0].subItems[1].qty).toBe(6);
  });
  it("an unknown kit leaves the element as it is", () => {
    expect(elementWithKit(el, consoleTbl, "nope")).toBe(el);
  });
});

describe("currentKitId", () => {
  it("reads the saved kit, the default, or a hand-edited list", () => {
    expect(currentKitId({ kitId: "k2", kitOverrides: [] }, consoleTbl)).toBe("k2");
    expect(currentKitId({}, consoleTbl)).toBe(DEFAULT_KIT_ID);
    expect(currentKitId({ kitOverrides: [{ itemId: "pot", qty: 1 }] }, consoleTbl)).toBeNull();
    // the parts list reset in the kit breakdown: back on Kit 1 even with the old kitId left behind
    expect(currentKitId({ kitId: "k2" }, consoleTbl)).toBe(DEFAULT_KIT_ID);
  });
});

describe("inventory row round-trip", () => {
  it("keeps the extra kits and the default kit's name in flags", () => {
    const item = { id: "c1", name: "Console", subItems: consoleTbl.subItems, altKits: consoleTbl.altKits.slice(0, 1), kitName: "Classic" };
    const back = rowToItem(itemToRow(item));
    expect(back.altKits).toEqual(item.altKits);
    expect(back.kitName).toBe("Classic");
  });
});

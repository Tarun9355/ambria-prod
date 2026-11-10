import { describe, it, expect } from "vitest";
import { kitVariants, hasKitChoice, elementWithKit, currentKitId, DEFAULT_KIT_ID, markKitCustom, syncElementKit, kitPool } from "./kitVariants";
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

describe("live kits - IMS edits reach elements on a picked kit", () => {
  const onRoyal = elementWithKit({ name: "Console", invId: "c1", qty: 2 }, consoleTbl, "k2");
  it("an untouched element on Kit 2 takes the kit's new parts", () => {
    const edited = { ...consoleTbl, altKits: [{ id: "k2", name: "Royal", subItems: [{ itemId: "table", qty: 1 }, { itemId: "candle", qty: 8 }, { itemId: "vase", qty: 1 }] }] };
    const r = syncElementKit(onRoyal, edited);
    expect(r.removed).toBe(false);
    expect(r.el.kitOverrides).toEqual([{ itemId: "table", qty: 1 }, { itemId: "candle", qty: 8 }, { itemId: "vase", qty: 1 }]);
    expect(r.el.kitId).toBe("k2");
    expect(syncElementKit(r.el, edited)).toBeNull(); // in line now - nothing more to do
  });
  it("nothing changes when the kit is as the element has it, on Kit 1, or with no item", () => {
    expect(syncElementKit(onRoyal, consoleTbl)).toBeNull();
    expect(syncElementKit({ name: "Console", invId: "c1" }, consoleTbl)).toBeNull();
    expect(syncElementKit(onRoyal, null)).toBeNull();
  });
  it("a kit picked before live kits (no kitLive) is left as it is - its parts may be hand edits", () => {
    const legacy = { name: "Console", invId: "c1", kitId: "k2", kitOverrides: [{ itemId: "pearl", qty: 4 }] };
    expect(syncElementKit(legacy, { ...consoleTbl, altKits: [] })).toBeNull();
    expect(syncElementKit(legacy, consoleTbl)).toBeNull();
    expect(elementWithKit(legacy, consoleTbl, "k2").kitLive).toBe(true); // picked again: live from then on
    expect(onRoyal.kitLive).toBe(true);
  });
  it("a kit removed in IMS puts the element back on Kit 1", () => {
    const r = syncElementKit(onRoyal, { ...consoleTbl, altKits: [] });
    expect(r.removed).toBe(true);
    expect(r.el.kitOverrides).toBeUndefined();
    expect(r.el.kitId).toBeUndefined();
    expect(r.el.qty).toBe(2);
  });
  it("a kit edited by hand on the deal is its own - IMS edits leave it", () => {
    const own = markKitCustom({ ...onRoyal, kitOverrides: [{ itemId: "table", qty: 1 }, { itemId: "pearl", qty: 4 }] });
    expect(own.kitCustom).toBe(true);
    expect(currentKitId(own, consoleTbl)).toBeNull(); // Build calls it "Edited kit"
    expect(syncElementKit(own, { ...consoleTbl, altKits: [] })).toBeNull();
  });
  it("a hand reset (no parts list) is Kit 1 again, and a Kit 1 element is never marked", () => {
    const reset = markKitCustom({ ...onRoyal, kitOverrides: undefined });
    expect(reset.kitId).toBeUndefined();
    expect(reset.kitCustom).toBeUndefined();
    expect(markKitCustom({ name: "x", kitOverrides: [{ itemId: "a", qty: 1 }] }).kitCustom).toBeUndefined();
  });
  it("picking a kit again clears the hand-edit mark", () => {
    const own = markKitCustom({ ...onRoyal, kitOverrides: [{ itemId: "pearl", qty: 4 }] });
    expect(elementWithKit(own, consoleTbl, "k2").kitCustom).toBeUndefined();
    expect(elementWithKit(own, consoleTbl, DEFAULT_KIT_ID).kitCustom).toBeUndefined();
  });
});

describe("kitPool - every kit of the sub-category", () => {
  const inv = [
    { ...consoleTbl, name: "Pillar Console", subCat: "Console Table" },
    { id: "c2", name: "Wooden Console", subCat: "console table ", subItems: [{ itemId: "pot", qty: 2 }], altKits: [{ id: "w2", name: "Kit 2", subItems: [{ itemId: "lamp", qty: 1 }] }] },
    { id: "c3", name: "Cane Console", subCat: "Console Table", subItems: [{ itemId: "pot", qty: 1 }] },
    { id: "c4", name: "Plain Console", subCat: "Console Table" }, // not a kit
    { id: "t1", name: "Ratten Coffee Table", subCat: "Coffee Table", subItems: [{ itemId: "tray", qty: 1 }] },
  ];
  it("the item's own kits first, then the other kit items' by name - no other sub-category, no non-kit", () => {
    expect(kitPool(inv[0], inv).map((p) => `${p.item.id}/${p.kit.id}`)).toEqual(["c1/default", "c1/k2", "c3/default", "c2/default", "c2/w2"]);
  });
  it("a Coffee Table sees only Coffee Table kits", () => {
    expect(kitPool(inv[4], inv).map((p) => p.item.id)).toEqual(["t1"]);
  });
  it("no sub-category: only its own kits", () => {
    expect(kitPool({ ...consoleTbl, subCat: "" }, inv).map((p) => p.item.id)).toEqual(["c1", "c1"]);
  });
});

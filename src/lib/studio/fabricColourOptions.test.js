import { describe, it, expect } from "vitest";
import { fabricColourOptions, dropRemovedFabricColours, fabricStockLoaded } from "./fabricColourOptions.js";

const inv = {
  lizaStock: [{ colour: "Ivory", stockKg: 40, stockKgNew: 56, photo: "ivory.jpg" }, { colour: "Magenta", stockKg: 0, stockKgNew: 0 }, { colour: "Maroon", stockKg: 10, stockKgNew: 0, hideInBuild: true }],
  maskingStock: [{ colour: "Ivory", stockPieces: 5, stockPiecesNew: 0 }, { colour: "Navy Blue", stockPieces: 0, stockPiecesNew: 3 }],
  curtainStock: [{ colour: "Ivory", stockPieces: 0, stockPiecesNew: 0 }, { colour: "Black", stockPieces: 5, stockPiecesNew: 0 }, { colour: "  ", stockPieces: 9 }],
};

describe("fabricColourOptions — only colours the fabric stock holds", () => {
  const m = fabricColourOptions(inv);
  it("lists a colour that has stock, with the fabrics it has stock in", () => {
    expect([...m.get("Ivory").in].sort()).toEqual(["liza", "masking"]); // none of it in Velvet
    expect(m.get("Ivory").photo).toBe("ivory.jpg");
    expect([...m.get("Navy Blue").in]).toEqual(["masking"]); // new stock alone counts
    expect([...m.get("Black").in]).toEqual(["curtain"]);
  });
  it("leaves out a colour with nothing in stock, one switched off for Build, and a blank name", () => {
    expect(m.has("Magenta")).toBe(false);
    expect(m.has("Maroon")).toBe(false);
    expect([...m.keys()].sort()).toEqual(["Black", "Ivory", "Navy Blue"]);
  });
  it("a colour already picked stays listed, but is not offered for a fabric that has none", () => {
    const k = fabricColourOptions(inv, ["Magenta", "Maroon"]);
    expect(k.has("Magenta")).toBe(true);
    expect(k.get("Magenta").in.size).toBe(0);
    expect(k.get("Maroon").in.size).toBe(0);
  });
  it("no stock at all: nothing", () => {
    expect(fabricColourOptions(null).size).toBe(0);
    expect(fabricColourOptions({}).size).toBe(0);
  });
});

describe("fabricColourOptions — one colour whatever its capitals", () => {
  const inv2 = { lizaStock: [{ colour: "Navy blue", stockKg: 40 }], maskingStock: [{ colour: "Navy Blue", stockPieces: 20, photo: "navy.jpg" }], curtainStock: [{ colour: " navy  blue ", stockPieces: 3 }] };
  it("Liza's 'Navy blue' and Wall Masking's 'Navy Blue' are one entry, offered for every fabric that has it", () => {
    const m = fabricColourOptions(inv2);
    expect(m.size).toBe(1);
    const e = [...m.values()][0];
    expect([...e.in].sort()).toEqual(["curtain", "liza", "masking"]);
    expect(e.photo).toBe("navy.jpg");
  });
  it("keeps the spelling already picked on the deal, so the pick stays ticked", () => {
    const m = fabricColourOptions(inv2, ["Navy Blue"]);
    expect([...m.keys()]).toEqual(["Navy Blue"]);
  });
});

describe("removed colours - picked on a deal, no stock row any more", () => {
  it("is still listed, flagged removed, so it can be un-picked", () => {
    const m = fabricColourOptions(inv, ["PASTELS", "Ivory"]);
    expect(m.get("PASTELS")).toMatchObject({ removed: true });
    expect(m.get("PASTELS").in.size).toBe(0);
    expect(m.get("Ivory").removed).toBeUndefined();
  });
  it("a colour that still has a row (no stock, or switched off) is not removed", () => {
    const m = fabricColourOptions(inv, ["Magenta", "Maroon"]);
    expect(m.get("Magenta").removed).toBeUndefined();
    expect(m.get("Maroon").removed).toBeUndefined();
  });
  it("dropRemovedFabricColours keeps every colour that has a row, whatever its capitals", () => {
    const out = dropRemovedFabricColours(inv, [{ name: "PASTELS", materials: null }, { name: "ivory", materials: ["liza"] }, { name: "Magenta", materials: null }]);
    expect(out).toEqual([{ name: "ivory", materials: ["liza"] }, { name: "Magenta", materials: null }]);
  });
  it("returns null when nothing is removed, the palette is empty, or the stock has not loaded", () => {
    expect(dropRemovedFabricColours(inv, [{ name: "Ivory", materials: null }])).toBeNull();
    expect(dropRemovedFabricColours(inv, [])).toBeNull();
    expect(dropRemovedFabricColours({}, [{ name: "PASTELS", materials: null }])).toBeNull();
    expect(dropRemovedFabricColours(null, [{ name: "PASTELS", materials: null }])).toBeNull();
    expect(fabricStockLoaded({ lizaStock: [] })).toBe(false);
  });
});

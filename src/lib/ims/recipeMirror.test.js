import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mirrorFlowerPick } from "./flowerHelpers";

// Owner ask 2026-11-20: name a flower once in a Small / Medium / Big recipe and it is in all three sizes, the numbers typed by hand.
const mandi = (id) => ({ id, source: "mandi" });
const mandiPatch = (id) => ({ flowerId: id, invItemId: undefined, gsSnap: undefined });
const pick = (sizes, over = {}) => mirrorFlowerPick({ sizes, mode: "smb", fromSize: "small", fromIndex: 0, fromPatch: mandiPatch("rose"), cand: mandi("rose"), ...over });
const ids = (sizes, name) => (sizes[name]?.flowers || []).map((r) => r.flowerId || r.invItemId || "");

describe("mirrorFlowerPick", () => {
  it("a new flower picked in Small is added to Medium and Big with quantity 0 (and the picking row is set as before)", () => {
    const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] }, big: { flowers: [] } });
    expect(out.small.flowers).toEqual([{ flowerId: "rose", invItemId: undefined, gsSnap: undefined, qty: 0 }]);
    expect(out.medium.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
    expect(out.big.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
  });
  it("works from any size, and creates a size the recipe does not have yet", () => {
    const out = pick({ small: { flowers: [] }, medium: { flowers: [{ flowerId: "", qty: 0 }] } }, { fromSize: "medium" });
    expect(ids(out, "medium")).toEqual(["rose"]);
    expect(ids(out, "small")).toEqual(["rose"]);
    expect(ids(out, "big")).toEqual(["rose"]);
    expect(out.big.flowers[0].qty).toBe(0);
  });
  it("a size that already has the flower is left exactly as it is (its numbers are not touched)", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "rose", qty: 7, unitLabel: "pcs" }] }, big: { flowers: [] } };
    const out = pick(sizes);
    expect(out.medium).toBe(sizes.medium);
    expect(out.medium.flowers[0].qty).toBe(7);
    expect(ids(out, "big")).toEqual(["rose"]);
  });
  it("an empty row (a '+ flower' nobody picked yet) in another size is filled, not left behind with a new row after it", () => {
    const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "lily", qty: 3 }, { flowerId: "", qty: 0 }] }, big: { flowers: [] } });
    expect(ids(out, "medium")).toEqual(["lily", "rose"]);
    expect(out.medium.flowers[0].qty).toBe(3);
  });
  it("CHANGING a flower switches the old one in the other sizes too, keeping their quantities", () => {
    const sizes = { small: { flowers: [{ flowerId: "rose", qty: 25 }] }, medium: { flowers: [{ flowerId: "rose", qty: 35, unitLabel: "pcs" }] }, big: { flowers: [{ flowerId: "lily", qty: 9 }, { flowerId: "rose", qty: 45 }] } };
    const out = pick(sizes, { fromPatch: mandiPatch("jasmine"), cand: mandi("jasmine") });
    expect(out.small.flowers[0].flowerId).toBe("jasmine");
    expect(out.medium.flowers).toEqual([{ flowerId: "jasmine", invItemId: undefined, gsSnap: undefined, qty: 35, unitLabel: "pcs" }]);
    expect(ids(out, "big")).toEqual(["lily", "jasmine"]);
    expect(out.big.flowers[1].qty).toBe(45);
  });
  it("picking the same flower again changes nothing in the other sizes", () => {
    const sizes = { small: { flowers: [{ flowerId: "rose", qty: 25 }] }, medium: { flowers: [{ flowerId: "rose", qty: 35 }] }, big: { flowers: [] } };
    const out = pick(sizes);
    expect(out.medium).toBe(sizes.medium);
    expect(out.big).toBe(sizes.big);
  });
  it("an inventory item (artificial included) is mirrored as an inventory row", () => {
    const out = mirrorFlowerPick({ sizes: { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] }, big: { flowers: [] } }, mode: "smb", fromSize: "small", fromIndex: 0,
      fromPatch: { invItemId: "inv9", flowerId: undefined, qty: 0, gsSnap: undefined }, cand: { id: "inv9", source: "inventory" } });
    expect(out.medium.flowers).toEqual([{ invItemId: "inv9", qty: 0 }]);
    expect(out.big.flowers).toEqual([{ invItemId: "inv9", qty: 0 }]);
  });
  it("a flat (one-size) recipe has no other size: only its own row is set", () => {
    const out = mirrorFlowerPick({ sizes: { medium: { flowers: [{ flowerId: "", qty: 0 }] } }, mode: "flat", fromSize: "medium", fromIndex: 0, fromPatch: mandiPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(out)).toEqual(["medium"]);
    expect(out.medium.flowers[0].flowerId).toBe("rose");
  });
  it("does not mutate its input; missing sizes / bad input do not throw", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] } };
    const copy = JSON.parse(JSON.stringify(sizes));
    pick(sizes);
    expect(sizes).toEqual(copy);
    expect(() => mirrorFlowerPick({ sizes: undefined, mode: "smb", fromSize: "small", fromIndex: 0, fromPatch: {}, cand: mandi("rose") })).not.toThrow();
    expect(() => mirrorFlowerPick({ sizes: {}, mode: "smb", fromSize: "small", fromIndex: 3, fromPatch: {}, cand: undefined })).not.toThrow();
  });
});

describe("recipe editor wiring", () => {
  const src = readFileSync(resolve(__dirname, "../../pages/ims/AdminSettingsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
  it("both pickers (mandi row and inventory row) go through pickFlower -> mirrorFlowerPick", () => {
    expect(src).toContain("const pickFlower = (cand, fromPatch) => mutatePattern(studioItem, (p) => ({ ...p, sizes: mirrorFlowerPick({ sizes: p.sizes, mode: p.mode, fromSize: sz, fromIndex: fi, fromPatch, cand }) }));");
    expect(src.split("onChange={(cand) => pickFlower(cand,").length - 1).toBe(2);
    expect(src).not.toContain("onChange={(cand) => setRow(cand.source");
  });
});

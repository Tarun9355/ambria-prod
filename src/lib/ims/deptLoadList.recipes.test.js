import { describe, it, expect } from "vitest";
import { blockedFlatFor } from "./deptLoadList.js";

// Owner reports 2026-11-27: a kit's flower recipes ("Flower Bunch filler", "Flower Trail Rft", "Chandelier Tree Floral Recipe") were
// listed as load / receiving lines - first under Tenting, then under Floral. They are made by the florists, never loaded or received.
const tree = { id: "Tree0", name: "Tree", isKit: true, qty: 4, total: 4000, components: [{ imsId: "POT", name: "Pot", qty: 4 }], recipeParts: [{ name: "Flower Trail Rft", qty: 24, uom: "rft" }] };
const sel = { id: "eo1", deptInventory: { Tenting: [tree] } };

describe("kit flower recipes are not load lines", () => {
  it("the kit's own department lists the kit and its inventory parts only", () => {
    expect(blockedFlatFor([tree], "Tenting", { sel }).map((r) => r.name)).toEqual(["Tree", "Pot"]);
  });
  it("Floral does not list another department's kit recipes", () => {
    expect(blockedFlatFor([{ id: "RB0", invId: "RB", name: "Rose Bowl", qty: 2 }], "Floral", { sel }).map((r) => r.name)).toEqual(["Rose Bowl"]);
  });
  it("a Floral kit's own recipes are not listed either", () => {
    const fk = { ...tree, id: "FK0", name: "Floral arch", components: [] };
    expect(blockedFlatFor([fk], "Floral", { sel: { id: "eo1", deptInventory: { Floral: [fk] } } }).map((r) => r.name)).toEqual(["Floral arch"]);
  });
});

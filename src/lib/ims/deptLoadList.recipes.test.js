import { describe, it, expect } from "vitest";
import { blockedFlatFor, otherDeptKitRecipes } from "./deptLoadList.js";

// Owner report 2026-11-27: a Tenting Tree kit's flower recipes ("Flower Bunch filler", "Flower Trail Rft") were listed under Tenting.
const tree = { id: "Tree0", name: "Tree", isKit: true, qty: 4, total: 4000, components: [], recipeParts: [{ name: "Flower Trail Rft", qty: 24, uom: "rft" }, { name: "Flower Bunch filler", qty: 60, uom: "pc" }] };
const sel = { id: "eo1", deptInventory: { Tenting: [tree], Floral: [{ name: "Rose Bowl", imsId: "RB", qty: 2 }] } };

describe("kit flower recipes are Floral's", () => {
  it("not in the kit's own department's list", () => {
    const flat = blockedFlatFor([tree], "Tenting", { sel });
    expect(flat.map((r) => r.name)).toEqual(["Tree"]);
  });
  it("in Floral's list, saying whose kit they are", () => {
    const flat = blockedFlatFor([{ id: "RB0", invId: "RB", name: "Rose Bowl", qty: 2 }], "Floral", { sel });
    expect(flat.map((r) => [r.name, r.qty, r.kitDept || ""])).toEqual([["Rose Bowl", 2, ""], ["Flower Trail Rft", 24, "Tenting"], ["Flower Bunch filler", 60, "Tenting"]]);
  });
  it("a Floral kit keeps its own recipes once (not twice)", () => {
    const fk = { ...tree, id: "FK0", name: "Floral arch" };
    const s2 = { id: "eo1", deptInventory: { Floral: [fk] } };
    expect(blockedFlatFor([fk], "Floral", { sel: s2 }).filter((r) => r.isRecipe)).toHaveLength(2);
    expect(otherDeptKitRecipes(s2)).toEqual([]);
  });
});

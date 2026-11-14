import { describe, it, expect } from "vitest";
import { fabricAnchorsForRow, resolveFabricAllocation } from "./pricing.js";

// Liza / velvet curtains split over several colours by a ratio picked on Build's Fabric card (owner ask 2026-11-14).
const stock = [{ colour: "Ivory", stockKg: 80 }, { colour: "Gold", stockKg: 50 }, { colour: "Black", stockKg: 30 }];

describe("fabric colour ratio on a truss row", () => {
  it("one colour picked: the plain name, as before", () => {
    expect(fabricAnchorsForRow({ lizaColour: "Ivory" }, "liza", ["Gold"])).toEqual(["Ivory"]);
  });
  it("nothing picked: the palette's colours", () => {
    expect(fabricAnchorsForRow({}, "liza", ["Gold", "Black"])).toEqual(["Gold", "Black"]);
  });
  it("a ratio: each colour gets its share of the whole kilos", () => {
    const a = fabricAnchorsForRow({ lizaColour: "Ivory:75, Gold:25" }, "liza", []);
    expect(resolveFabricAllocation(null, 8, a, stock, "stockKg")).toEqual([{ qty: 6, colour: "Ivory" }, { qty: 2, colour: "Gold" }]);
  });
  it("shares that do not divide go by largest remainder and still add up", () => {
    const a = fabricAnchorsForRow({ curtainColour: "Ivory:60, Gold:30, Black:10" }, "curtain", []);
    const out = resolveFabricAllocation(null, 7, a, stock, "stockKg");
    expect(out.reduce((t, x) => t + x.qty, 0)).toBe(7);
    expect(out.find((x) => x.colour === "Ivory").qty).toBeGreaterThanOrEqual(4);
  });
  it("a ratio wins over an allocation saved earlier in the same colours", () => {
    const a = fabricAnchorsForRow({ lizaColour: "Ivory:50, Gold:50" }, "liza", []);
    expect(resolveFabricAllocation([{ qty: 8, colour: "Ivory" }], 8, a, stock, "stockKg")).toEqual([{ qty: 4, colour: "Ivory" }, { qty: 4, colour: "Gold" }]);
  });
  it("masking keeps its single colour pick", () => {
    expect(fabricAnchorsForRow({ mkColour: "Black" }, "masking", [])).toEqual(["Black"]);
  });
});

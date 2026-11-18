import { describe, it, expect } from "vitest";
import { isFlowerPickChoice, isGreenMandi, mandiElUnitPrice, FLOWER_PICK_RATE_MULTIPLIER } from "./pricing";

// Build's "🌸 + Add flowers" (owner ask 2026-11-18): every mandi flower but the greens, billed at 2x the mandi rate.
describe("flower pick", () => {
  it("offers every flower except the greens", () => {
    expect(isFlowerPickChoice({ id: "a", name: "Rose", flowerType: "flower" })).toBe(true);
    expect(isFlowerPickChoice({ id: "b", name: "Orchid", flowerType: "real_only" })).toBe(true);
    expect(isFlowerPickChoice({ id: "c", name: "Mapped", flowerType: "mapping" })).toBe(true);
    // Jaimala / Loose Petals / any markup item: added on their own, never at 2x here as well
    expect(isFlowerPickChoice({ id: "d", name: "Jaimala", markup: 50 })).toBe(false);
    expect(isFlowerPickChoice({ id: "d2", name: "Jaimala pink", flowerCat: "Jaimala" })).toBe(false);
    expect(isFlowerPickChoice({ id: "d3", name: "Loose Petals", flowerCat: "Loose Flowers" })).toBe(false);
    expect(isFlowerPickChoice({ id: "d4", name: "Rose petals", flowerCat: "Loose Flowers" })).toBe(true);
    // by category only: a flower typed "green" in a flower category still shows
    expect(isFlowerPickChoice({ id: "e", name: "Ruscus", flowerType: "green", flowerCat: "Cut flower" })).toBe(true);
    expect(isFlowerPickChoice({ id: "f", name: "Fern", isGreen: true, flowerCat: "local flower" })).toBe(true);
    expect(isFlowerPickChoice({ id: "g", name: "Asparagus", flowerCat: "Greens" })).toBe(false);
    expect(isFlowerPickChoice({ id: "h", name: "Monstera", flowerCat: "Premium greens" })).toBe(false);
    for (const cat of ["Imported flower", "local flower", "drysticks", "Ladi Flower", "Loose Flowers", "Cut flower", "banglore daisy"])
      expect(isFlowerPickChoice({ id: cat, name: cat, flowerCat: cat })).toBe(true);
    expect(isFlowerPickChoice({ name: "no id" })).toBe(false);
    expect(isGreenMandi({ flowerCat: "Evergreen roses" })).toBe(false);
  });

  it("a picked flower bills 2x the mandi rate, ignoring the flower's own markup", () => {
    expect(FLOWER_PICK_RATE_MULTIPLIER).toBe(2);
    expect(mandiElUnitPrice({ flowerPick: true }, { markup: 0 }, 120)).toBe(240);
    expect(mandiElUnitPrice({ flowerPick: true }, { markup: 50 }, 120)).toBe(240);
  });

  it("any other direct mandi item keeps its own Markup %", () => {
    expect(mandiElUnitPrice({}, { markup: 50 }, 120)).toBe(180);
    expect(mandiElUnitPrice({}, { markup: null }, 120)).toBe(120);
    expect(mandiElUnitPrice(undefined, undefined, "x")).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { buildEventSwap, swappedRecipeFlower } from "./mandiSwap.js";

// Shapes copied from real saved events (Floral mandiLines).
const taj = [
  { name: "carnation himachal", unit: "bundle", projQty: 25, qty: 0, price: 440.4, swappedTo: "spray carnation" },
  { name: "spray carnation", unit: "bundle", projQty: 0, qty: 25, price: 600, swapFor: "carnation himachal" },
  { name: "gypso", unit: "bundle", projQty: 10, qty: 10, price: 80 },
];
const ashok = [
  { name: "guldavari star", unit: "piece", projQty: 595, qty: 0, price: "", swappedTo: "murga" },
  { name: "murga", unit: "gatthar", projQty: 0, qty: 2, price: "1000", swapFor: "guldavari star" },
];

describe("buildEventSwap", () => {
  it("pairs the swapped-out flower with its replacement", () => {
    const m = buildEventSwap(taj);
    expect(m.size).toBe(1);
    expect(m.get("carnation himachal")).toEqual({ name: "spray carnation", unit: "bundle", ratio: 1 });
  });
  it("ratio is bought ÷ planned", () => {
    const m = buildEventSwap([
      { name: "a", projQty: 20, qty: 0, swappedTo: "b" },
      { name: "b", unit: "bundle", projQty: 0, qty: 30, swapFor: "a" },
    ]);
    expect(m.get("a").ratio).toBe(1.5);
  });
  it("planned 0 can't scale, so the ratio is 1", () => {
    const m = buildEventSwap([
      { name: "a", projQty: 0, qty: 0, swappedTo: "b" },
      { name: "b", unit: "pc", projQty: 0, qty: 7, swapFor: "a" },
    ]);
    expect(m.get("a").ratio).toBe(1);
  });
  it("a replacement row whose original is not marked swapped-out is ignored", () => {
    expect(buildEventSwap([{ name: "a", projQty: 5, qty: 5 }, { name: "b", projQty: 0, qty: 3, swapFor: "a" }]).size).toBe(0);
  });
  it("an original marked swapped-out with no replacement row swaps nothing", () => {
    expect(buildEventSwap([{ name: "a", projQty: 5, qty: 0, swappedTo: "b" }]).size).toBe(0);
  });
  it("empty / junk input is an empty map", () => {
    expect(buildEventSwap(undefined).size).toBe(0);
    expect(buildEventSwap(null).size).toBe(0);
    expect(buildEventSwap([null, undefined, {}]).size).toBe(0);
  });
});

describe("swappedRecipeFlower — the recipe line the PDF prints", () => {
  const taj_ = buildEventSwap(taj);
  it("names only the replacement, with no 'for <original>' and no icon", () => {
    const r = swappedRecipeFlower(taj_, "carnation himachal", 3);
    expect(r).toEqual({ name: "spray carnation", qty: 3, unit: "bundle" });
    expect(r.name).not.toMatch(/for|🔁|himachal/i);
  });
  it("the flower name matches regardless of case and spaces", () => {
    expect(swappedRecipeFlower(taj_, "  Carnation Himachal ", 2)?.name).toBe("spray carnation");
  });
  it("a flower that was not swapped gives null (the caller prints it as usual)", () => {
    expect(swappedRecipeFlower(taj_, "gypso", 4)).toBeNull();
    expect(swappedRecipeFlower(new Map(), "gypso", 4)).toBeNull();
    expect(swappedRecipeFlower(undefined, "gypso", 4)).toBeNull();
  });
  it("scales the per-piece amount by bought ÷ planned", () => {
    const m = buildEventSwap([
      { name: "a", projQty: 20, qty: 0, swappedTo: "b" },
      { name: "b", unit: "bundle", projQty: 0, qty: 30, swapFor: "a" },
    ]);
    expect(swappedRecipeFlower(m, "a", 4).qty).toBe(6);
  });
  it("different units (595 pieces planned, 2 gatthar bought): a tiny per-piece amount is kept, not rounded to 0", () => {
    const m = buildEventSwap(ashok);
    const r = swappedRecipeFlower(m, "guldavari star", 1);
    expect(r.name).toBe("murga");
    expect(r.unit).toBe("gatthar");
    expect(r.qty).toBeGreaterThan(0);
    // and times a zone of 50 pieces it is a sensible figure the PDF can show
    expect(Math.round(r.qty * 50 * 100) / 100).toBeGreaterThan(0);
  });
  it("nothing bought of the replacement means none goes into the piece", () => {
    const m = buildEventSwap([
      { name: "a", projQty: 10, qty: 0, swappedTo: "b" },
      { name: "b", unit: "pc", projQty: 0, qty: 0, swapFor: "a" },
    ]);
    expect(swappedRecipeFlower(m, "a", 3).qty).toBe(0);
  });
});

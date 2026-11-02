import { describe, it, expect } from "vitest";
import { computePatternSizeCost, floralPatternUnitRates } from "./flowerHelpers";
import { effectiveColorPrefRows } from "../studio/floralCost";

// The price follows the colour (owner decision 2026-11-02): a function's Flower Palette picks the tagged colour variant, and the
// recipe's real side is priced at that variant's rate - the same rate Deal Check costs the flower at.
const rose = { id: "rose", name: "Rose", currentPrice: 30, flowerType: "flower",
  colorVariants: [{ variantId: "rose-w", name: "White", currentPrice: 40, palette: ["White"] }, { variantId: "rose-r", name: "Red", currentPrice: 25, palette: ["Red"] }] };
const mandi = [rose];
const size = { flowers: [{ flowerId: "rose", qty: 10 }] };
const pattern = { name: "Pot", sizes: { medium: size }, studioMarkup: 2 };
const rateFor = (palette, prefs = {}) => (fl, res) => {
  const rows = effectiveColorPrefRows(prefs, res?.parent?.id, { fnFlowerPalette: palette }, res?.parent);
  const r = rows?.length ? Number(rows[0].rate) || 0 : 0;
  return r > 0 ? r : null;
};

describe("recipe price follows the function's flower colour", () => {
  it("no palette, no hook: the base mandi rate", () => {
    expect(computePatternSizeCost(size, mandi, [])).toBe(300);
    expect(computePatternSizeCost(size, mandi, [], rateFor(""))).toBe(300);
  });
  it("a White palette prices the white variant, Red the red one", () => {
    expect(computePatternSizeCost(size, mandi, [], rateFor("White:100"))).toBe(400);
    expect(computePatternSizeCost(size, mandi, [], rateFor("Red:100"))).toBe(250);
    expect(floralPatternUnitRates(pattern, "medium", mandi, {}, [], {}, rateFor("White:100")).realRate).toBe(800);
  });
  it("an explicit 🎨 pick wins over the palette", () => {
    const prefs = { rose: [{ variantId: "rose-r", label: "Red", rate: 25 }] };
    expect(computePatternSizeCost(size, mandi, [], rateFor("White:100", prefs))).toBe(250);
  });
});

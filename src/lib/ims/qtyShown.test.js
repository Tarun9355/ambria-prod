import { describe, it, expect } from "vitest";
import { roundKg, qtyShown } from "./qtyShown";

describe("qtyShown - kilos read whole", () => {
  it("rounds kilos to whole, one decimal under a kilo", () => {
    expect(roundKg(61.09)).toBe(61);
    expect(roundKg(18.76)).toBe(19);
    expect(roundKg(0.44)).toBe(0.4);
    expect(roundKg(0)).toBe(0);
  });
  it("only kilos - other units keep their decimals", () => {
    expect(qtyShown(112.49, "kg")).toBe(112);
    expect(qtyShown(112.49, " KG ")).toBe(112);
    expect(qtyShown(0.75, "bundle")).toBe(0.75);
    expect(qtyShown(7.56, "")).toBe(7.56);
  });
});

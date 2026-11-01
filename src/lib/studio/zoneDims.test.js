import { describe, it, expect } from "vitest";
import { zoneDimLabel } from "./zoneDims";

describe("zoneDimLabel (RC-78)", () => {
  it("truss W × Depth × H in Build's order", () => {
    expect(zoneDimLabel({ dims: { W: 10, L: 12, H: 9 } })).toBe("10 × 12 × 9 ft");
  });
  it("an axis never typed shows — not 0", () => {
    expect(zoneDimLabel({ dims: { W: 40, H: 15 } })).toBe("40 × — × 15 ft");
  });
  it("first truss empty: an added truss's size", () => {
    expect(zoneDimLabel({ dims: {}, extraTrussRows: [{ dims: { W: 10, L: 10, H: 10 } }] })).toBe("10 × 10 × 10 ft");
  });
  it("no truss: the platform / carpet floor", () => {
    expect(zoneDimLabel({ floorDims: { L: 20, W: 12 } })).toBe("20 × 12 ft");
  });
  it("no size anywhere: nothing, never 0ft×0ft×0ft", () => {
    expect(zoneDimLabel({ dims: {} })).toBe("");
    expect(zoneDimLabel(null)).toBe("");
  });
});

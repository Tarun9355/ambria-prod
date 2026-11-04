import { describe, it, expect } from "vitest";
import { swapKitPart, kitComps } from "./kitPartSwap";

const inv = [
  { id: "console", subItems: [{ itemId: "table", qty: 1 }, { itemId: "pearl", qty: 4 }, { patternId: "pat1", qty: 2 }] },
  { id: "lounge", subItems: [{ itemId: "sofa", qty: 2 }, { itemId: "console", qty: 1 }] },
  { id: "table" }, { id: "pearl" }, { id: "pearl2" }, { id: "sofa" },
];
const get = (id) => inv.find((i) => i.id === id);

describe("swapKitPart", () => {
  it("swaps a top-level part and keeps its qty", () => {
    const next = swapKitPart(get("console"), undefined, "pearl", "pearl2", inv);
    expect(next).toEqual([{ itemId: "table", qty: 1 }, { itemId: "pearl2", qty: 4 }, { patternId: "pat1", qty: 2, realPct: undefined, size: undefined }]);
  });
  it("works on the element's own overrides", () => {
    const ov = [{ itemId: "pearl", qty: 6 }];
    expect(swapKitPart(get("console"), ov, "pearl", "pearl2", inv)).toEqual([{ itemId: "pearl2", qty: 6 }]);
  });
  it("swaps a part inside a nested kit through subOverrides", () => {
    const next = swapKitPart(get("lounge"), undefined, "pearl", "pearl2", inv);
    expect(next[0]).toEqual({ itemId: "sofa", qty: 2 });
    expect(next[1].itemId).toBe("console");
    expect(next[1].subOverrides.find((c) => c.itemId === "pearl2").qty).toBe(4);
  });
  it("drops the old item's named designs but keeps its pid", () => {
    const ov = [{ itemId: "pearl", qty: 2, pid: "p1", prefs: [{ id: "pearl" }, { id: "x" }] }];
    expect(swapKitPart(get("console"), ov, "pearl", "pearl2", inv)).toEqual([{ itemId: "pearl2", qty: 2, pid: "p1" }]);
  });
  it("returns null when the part is not in the kit", () => {
    expect(swapKitPart(get("console"), undefined, "sofa", "pearl2", inv)).toBeNull();
  });
  it("leaves the master recipe untouched", () => {
    swapKitPart(get("console"), undefined, "pearl", "pearl2", inv);
    expect(get("console").subItems[1].itemId).toBe("pearl");
    expect(kitComps(get("console")).length).toBe(3);
  });
});

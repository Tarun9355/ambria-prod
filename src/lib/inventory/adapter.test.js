import { describe, it, expect } from "vitest";
import { rowToItem, itemToRow } from "./adapter.js";

describe("inventory item: Repeat discount switch (canRepeat)", () => {
  it("is on unless switched off, and an off switch survives the round trip through the flags column", () => {
    expect(rowToItem({ id: "A", name: "x", flags: {} }).canRepeat).toBeUndefined(); // undefined = on
    const off = rowToItem({ id: "A", name: "x", flags: { canRepeat: false } });
    expect(off.canRepeat).toBe(false);
    expect(itemToRow(off).flags.canRepeat).toBe(false);
  });
});

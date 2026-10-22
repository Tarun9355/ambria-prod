import { describe, it, expect } from "vitest";
import { rowToItem, itemToRow } from "./adapter.js";

describe("inventory item: 'No repeat discount' switch (noRepeatDiscount)", () => {
  it("is off unless switched on, and an on switch survives the round trip through the flags column", () => {
    expect(rowToItem({ id: "A", name: "x", flags: {} }).noRepeatDiscount).toBeUndefined(); // undefined = off, the discount applies
    const on = rowToItem({ id: "A", name: "x", flags: { noRepeatDiscount: true } });
    expect(on.noRepeatDiscount).toBe(true);
    expect(itemToRow(on).flags.noRepeatDiscount).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { rowToItem, itemToRow, diffInventory } from "./adapter.js";

describe("inventory item: 'No repeat discount' switch (noRepeatDiscount)", () => {
  it("is off unless switched on, and an on switch survives the round trip through the flags column", () => {
    expect(rowToItem({ id: "A", name: "x", flags: {} }).noRepeatDiscount).toBeUndefined(); // undefined = off, the discount applies
    const on = rowToItem({ id: "A", name: "x", flags: { noRepeatDiscount: true } });
    expect(on.noRepeatDiscount).toBe(true);
    expect(itemToRow(on).flags.noRepeatDiscount).toBe(true);
  });
});

// `paintable` was missing from the flags round-trip entirely — unchecking it in IMS updated local
// state (so the checkbox visibly unchecked) but the Supabase row write never carried the field, and
// since itemToRow stripped it from BOTH sides of the diff identically, the write was skipped outright.
describe("inventory item: 'This item can be painted' switch (paintable)", () => {
  it("an explicit false survives the round trip through the flags column (not dropped as falsy)", () => {
    const item = rowToItem({ id: "A", name: "x", flags: { paintable: false } });
    expect(item.paintable).toBe(false);
    expect(itemToRow(item).flags.paintable).toBe(false);
  });
  it("an explicit true also survives the round trip", () => {
    const item = rowToItem({ id: "A", name: "x", flags: { paintable: true } });
    expect(item.paintable).toBe(true);
    expect(itemToRow(item).flags.paintable).toBe(true);
  });
  it("unset (legacy item) stays undefined — the UI's own default-detection still applies", () => {
    expect(rowToItem({ id: "A", name: "x", flags: {} }).paintable).toBeUndefined();
  });
  it("toggling paintable alone (nothing else changed) is recognised as a real change and gets upserted", () => {
    const before = { id: "A", name: "x", paintable: true };
    const after = { id: "A", name: "x", paintable: false };
    const { upserts } = diffInventory([before], [after]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].flags.paintable).toBe(false);
  });
});

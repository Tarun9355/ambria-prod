import { describe, it, expect } from "vitest";
import { needsCheck, changeKind, lastChangeAt, canCheckInventory } from "./inventoryReviews.js";

// IMS Inventory "New / edited" check list (owner ask 2026-11-17)
describe("inventory check list", () => {
  const added = { id: "A", createdAt: "2026-11-17T10:00:00Z", updatedAt: "2026-11-17T10:00:20Z" };
  const edited = { id: "B", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-18T09:00:00Z" };
  const old = { id: "C", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-10T09:00:00Z" };

  it("lists an item added or edited since it went live, never one untouched since before", () => {
    expect(needsCheck(added, {})).toBe(true);
    expect(needsCheck(edited, {})).toBe(true);
    expect(needsCheck(old, {})).toBe(false);
    expect(needsCheck({ id: "D" }, {})).toBe(false); // no timestamps at all
  });
  it("leaves the list once checked at its current version, and comes back when edited after the check", () => {
    const checked = { B: { reviewedVersion: "2026-11-18T09:00:00.000Z" } };
    expect(needsCheck(edited, checked)).toBe(false);
    expect(needsCheck({ ...edited, updatedAt: "2026-11-19T09:00:00Z" }, checked)).toBe(true);
  });
  it("says Added for a fresh item (a save in its first minute included), Edited otherwise", () => {
    expect(changeKind(added)).toBe("Added");
    expect(changeKind(edited)).toBe("Edited");
    expect(lastChangeAt(edited)).toBe(Date.parse("2026-11-18T09:00:00Z"));
  });
  it("only an Admin can mark checked", () => {
    expect(canCheckInventory({ role: "Admin" })).toBe(true);
    expect(canCheckInventory({ role: "Production" })).toBe(false);
    expect(canCheckInventory(null)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { needsCheck, changeKind, lastChangeAt, canCheckInventory } from "./inventoryReviews.js";

// IMS Inventory "New / edited" check list (owner ask 2026-11-17)
describe("inventory check list", () => {
  const added = { id: "A", createdAt: "2026-11-17T10:00:00Z", updatedAt: "2026-11-17T10:00:20Z" };
  const edited = { id: "B", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-11-18T09:00:00Z" };
  const old = { id: "C", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-10-01T09:00:00Z" }; // over 30 days before NOW
  const NOW = Date.parse("2026-11-18T12:00:00Z");

  it("lists an item added or edited in the last 30 days, never one untouched for longer", () => {
    expect(needsCheck(added, {}, NOW)).toBe(true);
    expect(needsCheck(edited, {}, NOW)).toBe(true);
    expect(needsCheck(old, {}, NOW)).toBe(false);
    expect(needsCheck({ id: "E", updatedAt: "2026-10-25T09:00:00Z" }, {}, NOW)).toBe(true); // 24 days back
    expect(needsCheck({ id: "D" }, {}, NOW)).toBe(false); // no timestamps at all
  });
  it("leaves the list once checked at its current version, and comes back when edited after the check", () => {
    const checked = { B: { reviewedVersion: "2026-11-18T09:00:00.000Z" } };
    expect(needsCheck(edited, checked, NOW)).toBe(false);
    expect(needsCheck({ ...edited, updatedAt: "2026-11-19T09:00:00Z" }, checked, NOW)).toBe(true);
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

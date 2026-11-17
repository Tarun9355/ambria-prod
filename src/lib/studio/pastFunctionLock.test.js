import { describe, it, expect } from "vitest";
import { isPastFunction, reducedItems, localToday } from "./pastFunctionLock.js";

// A booked deal's function that is over: add, never remove or reduce (owner ask 2026-11-17)
describe("past function lock", () => {
  it("a function is over the day after its date, not on it", () => {
    expect(isPastFunction("2026-11-16", "2026-11-17")).toBe(true);
    expect(isPastFunction("2026-11-17", "2026-11-17")).toBe(false);
    expect(isPastFunction("2026-11-18", "2026-11-17")).toBe(false);
    expect(isPastFunction("", "2026-11-17")).toBe(false);
    expect(localToday(new Date(2026, 10, 7))).toBe("2026-11-07");
  });
  const inv = [{ id: "K", name: "Console", subItems: [{ itemId: "P", qty: 2 }] }, { id: "P", name: "Pot" }, { id: "C", name: "Chair" }];
  const base = { stage: [{ invId: "C", qty: 10, name: "Chair" }], lounge: [{ invId: "K", qty: 3, name: "Console" }] };
  it("adding an item or raising a qty is fine", () => {
    expect(reducedItems(base, { ...base, stage: [{ invId: "C", qty: 12, name: "Chair" }] }, inv)).toEqual([]);
    expect(reducedItems(base, { ...base, entry: [{ name: "Custom arch", qty: 1 }] }, inv)).toEqual([]);
  });
  it("removing an item, lowering a qty or taking a part out of a kit is a reduction", () => {
    expect(reducedItems(base, { ...base, stage: [] }, inv)).toEqual([{ name: "Chair", from: 10, to: 0 }]);
    expect(reducedItems(base, { ...base, stage: [{ invId: "C", qty: 8, name: "Chair" }] }, inv)).toEqual([{ name: "Chair", from: 10, to: 8 }]);
    expect(reducedItems(base, { ...base, lounge: [{ invId: "K", qty: 3, name: "Console", kitOverrides: [{ itemId: "P", qty: 1 }] }] }, inv)).toEqual([{ name: "Pot", from: 6, to: 3 }]);
  });
  it("moving an item between zones is not a reduction (same total)", () => {
    expect(reducedItems(base, { lounge: base.lounge, entry: [{ invId: "C", qty: 10, name: "Chair" }] }, inv)).toEqual([]);
  });
});

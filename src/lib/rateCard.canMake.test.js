import { describe, it, expect } from "vitest";
import { canFulfillShortfall, oosCostPctFor } from "./rateCard.js";

// "Can be made in production" (IMS Inventory): only a TICKED item is ever produced, and even then only when the
// event is at least 10 days away. Dates are given explicitly (asOfDate) so the tests do not depend on today.
const AS_OF = "2026-10-23";
const ticked = { canBeMade: true, oosCostPct: 60, subCat: "led" };
const unticked = { canBeMade: false, oosCostPct: 60, subCat: "led" };
const neverSet = { oosCostPct: 60, subCat: "led" }; // nobody has ticked or unticked it
const subCatPct = () => 40;

describe("canFulfillShortfall — only a ticked item is made", () => {
  it("ticked, event 18 days away: can be made", () => {
    expect(canFulfillShortfall(ticked, "2026-11-10", AS_OF)).toBe(true);
  });
  it("ticked, exactly 10 days away: can be made; 9 days: cannot (not enough time)", () => {
    expect(canFulfillShortfall(ticked, "2026-11-02", AS_OF)).toBe(true);
    expect(canFulfillShortfall(ticked, "2026-11-01", AS_OF)).toBe(false);
  });
  it("unticked: never made, however far away the event is", () => {
    expect(canFulfillShortfall(unticked, "2027-03-01", AS_OF)).toBe(false);
    expect(canFulfillShortfall(unticked, "2026-11-10", AS_OF)).toBe(false);
  });
  it("never ticked (field missing): treated as not made", () => {
    expect(canFulfillShortfall(neverSet, "2027-03-01", AS_OF)).toBe(false);
    expect(canFulfillShortfall({}, "2027-03-01", AS_OF)).toBe(false);
    expect(canFulfillShortfall(null, "2027-03-01", AS_OF)).toBe(false);
  });
  it("no function date to judge by: the date gate is off, the tick still decides", () => {
    expect(canFulfillShortfall(ticked, undefined, AS_OF)).toBe(true);
    expect(canFulfillShortfall(unticked, undefined, AS_OF)).toBe(false);
    expect(canFulfillShortfall(neverSet, undefined, AS_OF)).toBe(false);
  });
  it("a sold deal is judged from the day the item was added, not from today", () => {
    expect(canFulfillShortfall(ticked, "2026-11-01", "2026-10-01")).toBe(true);   // added 31 days before the event
    expect(canFulfillShortfall(ticked, "2026-11-01", "2026-10-25")).toBe(false);  // added 7 days before
  });
});

describe("oosCostPctFor — a shortfall is priced as production only for a ticked item with time", () => {
  it("ticked + time: the item's own Out of Stock Cost %", () => {
    expect(oosCostPctFor(ticked, subCatPct, "2026-11-10", AS_OF)).toBe(60);
  });
  it("ticked, no own %: the sub-category's", () => {
    expect(oosCostPctFor({ canBeMade: true }, subCatPct, "2026-11-10", AS_OF)).toBe(40);
  });
  it("unticked, never ticked, or too close to the event: 0% (the plain rate is the floor)", () => {
    expect(oosCostPctFor(unticked, subCatPct, "2026-11-10", AS_OF)).toBe(0);
    expect(oosCostPctFor(neverSet, subCatPct, "2026-11-10", AS_OF)).toBe(0);
    expect(oosCostPctFor(ticked, subCatPct, "2026-10-28", AS_OF)).toBe(0);
  });
});

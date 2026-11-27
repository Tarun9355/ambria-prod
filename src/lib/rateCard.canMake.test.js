import { describe, it, expect } from "vitest";
import { canFulfillShortfall, oosCostPctFor } from "./rateCard.js";

// "Can be made in production" (IMS Inventory): only a TICKED item is ever produced - however close the event is
// (the old 10-day lead-time gate was removed, owner ask 2026-11-27).
const AS_OF = "2026-10-23";
const ticked = { canBeMade: true, oosCostPct: 60, subCat: "led" };
const unticked = { canBeMade: false, oosCostPct: 60, subCat: "led" };
const neverSet = { oosCostPct: 60, subCat: "led" }; // nobody has ticked or unticked it
const subCatPct = () => 40;

describe("canFulfillShortfall — only a ticked item is made", () => {
  it("ticked, event 18 days away: can be made", () => {
    expect(canFulfillShortfall(ticked, "2026-11-10", AS_OF)).toBe(true);
  });
  it("ticked, event close (9 days, 1 day, same day): still can be made - no lead-time gate", () => {
    expect(canFulfillShortfall(ticked, "2026-11-01", AS_OF)).toBe(true);
    expect(canFulfillShortfall(ticked, "2026-10-24", AS_OF)).toBe(true);
    expect(canFulfillShortfall(ticked, "2026-10-23", AS_OF)).toBe(true);
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
  it("when the item was added no longer matters", () => {
    expect(canFulfillShortfall(ticked, "2026-11-01", "2026-10-01")).toBe(true);
    expect(canFulfillShortfall(ticked, "2026-11-01", "2026-10-25")).toBe(true);
  });
});

describe("oosCostPctFor — a shortfall is priced as production only for a ticked item", () => {
  it("ticked + time: the item's own Out of Stock Cost %", () => {
    expect(oosCostPctFor(ticked, subCatPct, "2026-11-10", AS_OF)).toBe(60);
  });
  it("ticked, no own %: the sub-category's", () => {
    expect(oosCostPctFor({ canBeMade: true }, subCatPct, "2026-11-10", AS_OF)).toBe(40);
  });
  it("unticked or never ticked: 0% (the plain rate is the floor)", () => {
    expect(oosCostPctFor(unticked, subCatPct, "2026-11-10", AS_OF)).toBe(0);
    expect(oosCostPctFor(neverSet, subCatPct, "2026-11-10", AS_OF)).toBe(0);
  });
  it("ticked, event close: still priced at its cost %", () => {
    expect(oosCostPctFor(ticked, subCatPct, "2026-10-28", AS_OF)).toBe(60);
  });
});

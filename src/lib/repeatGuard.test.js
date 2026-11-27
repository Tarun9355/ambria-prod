import { describe, it, expect } from "vitest";
import { repeatBackedFns, repeatBackedOfEvent } from "./repeatGuard.js";
import { atVenueOfEvent } from "./ims/atVenue.js";

// Venue audit 2026-11-27: a Repeat counts only when a setup stood at the same venue just before.
describe("repeat guard", () => {
  it("an earlier function of the booking at the same venue (day before, or earlier the same day)", () => {
    const fns = [{ venue: "Pushpanjali", date: "2026-11-27", shift: "Night" }, { venue: "Pushpanjali", date: "2026-11-28", shift: "Lunch" }, { venue: "Pushpanjali", date: "2026-11-28", shift: "Night" }];
    expect([...repeatBackedFns(fns)]).toEqual([1, 2]);
  });
  it("a different venue the day before does not back it; another event at the venue does", () => {
    const fns = [{ venue: "Exotica", date: "2026-11-27" }, { venue: "Pushpanjali", date: "2026-11-28" }];
    expect(repeatBackedFns(fns).has(1)).toBe(false);
    expect(repeatBackedFns(fns, [{ venue: "Pushpanjali", date: "2026-11-27" }]).has(1)).toBe(true);
    expect(repeatBackedFns(fns, [{ venue: "Pushpanjali", date: "2026-11-25" }]).has(1)).toBe(false);
  });
  it("IMS loads an unbacked Repeat and reports it", () => {
    const sel = { id: "e1", functionsDetail: [
      { type: "Sagan", venue: "Exotica", date: "2026-11-27", elements: { z: [{ invId: "SOFA" }] } },
      { type: "Wedding", venue: "Pushpanjali", date: "2026-11-28", zones: { z: { repeat: true } }, elements: { z: [{ invId: "TBL", qty: 4 }] } },
    ] };
    const at = atVenueOfEvent(sel, {}, [], []);
    expect(at({ id: "r", invId: "TBL", qty: 4 })).toMatchObject({ repeat: false, load: 4 });
    expect(at.repeatWithoutSetup).toEqual([{ fi: 1, venue: "Pushpanjali", date: "2026-11-28" }]);
    // without the other events (older callers) the chip is trusted as before
    expect(atVenueOfEvent(sel, {}, [])({ id: "r", invId: "TBL", qty: 4 })).toMatchObject({ repeat: true, load: 0 });
    // another live event at Pushpanjali the day before backs it
    const others = [{ id: "e2", status: "confirmed", venue: "Pushpanjali", date: "2026-11-27" }];
    expect(repeatBackedOfEvent(sel, others).has(1)).toBe(true);
  });
});

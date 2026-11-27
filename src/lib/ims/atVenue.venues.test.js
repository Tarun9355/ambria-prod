import { describe, it, expect } from "vitest";
import { atVenueOfEvent, atVenueByRow } from "./atVenue";

// Venue audit 2026-11-27 (Amit Gulati: 27 Nov Exotica, 28 Nov Pushpanjali): a Fixed Venue's standing stock covers only its own venue's need.
const fv = { fixedVenues: [{ name: "Pushpanjali", items: [{ invId: "CH", qty: 20 }] }] };
const sel = { venue: "Exotica", functionsDetail: [
  { venue: "Exotica", date: "2026-11-27", elements: { z: [{ invId: "CH", qty: 10 }] } },
  { venue: "Pushpanjali", date: "2026-11-28", elements: { z: [{ invId: "CH", qty: 10 }] } },
] };

describe("standing stock at two venues", () => {
  const at = atVenueOfEvent(sel, fv, []);
  it("Pushpanjali's 20 standing chairs cover its own 10 - Exotica's 10 still load", () => {
    expect(at({ id: "r", invId: "CH", qty: 20 })).toEqual({ fixed: 10, repeat: false, load: 10 });
  });
  it("one function's view reads its own venue", () => {
    expect(at({ id: "r", invId: "CH", qty: 10, venue: "Exotica" })).toMatchObject({ fixed: 0, load: 10 });
    expect(at({ id: "r", invId: "CH", qty: 10, venue: "Pushpanjali" })).toMatchObject({ fixed: 10, load: 0 });
  });
  it("the row-by-row pool is seeded with the per-venue credit", () => {
    const m = atVenueByRow([{ id: "a", invId: "CH", qty: 20 }], at);
    expect(m.get("a")).toMatchObject({ fixed: 10, load: 10 });
  });
  it("standing stock smaller than the venue's need: only that much is credited", () => {
    const small = atVenueOfEvent(sel, { fixedVenues: [{ name: "Pushpanjali", items: [{ invId: "CH", qty: 4 }] }] }, []);
    expect(small({ id: "r", invId: "CH", qty: 20 })).toMatchObject({ fixed: 4, load: 16 });
  });
  it("kit parts count towards their venue's need too", () => {
    const inv = [{ id: "SET", name: "Sofa set", subItems: [{ itemId: "CH", qty: 2 }] }];
    const s2 = { functionsDetail: [
      { venue: "Exotica", elements: { z: [{ invId: "SET", qty: 3 }] } },
      { venue: "Pushpanjali", elements: { z: [{ invId: "CH", qty: 5 }] } },
    ] };
    expect(atVenueOfEvent(s2, fv, inv)({ id: "r", invId: "CH", qty: 11 })).toMatchObject({ fixed: 5, load: 6 });
  });
});

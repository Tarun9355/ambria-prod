import { describe, it, expect } from "vitest";
import { atVenueOfEvent } from "./atVenue";

// fixed venue "Pushpanjali" with 4 standing sofas (i1); a Repeat chair (i2); a fresh table (i3)
const fv = { fixedVenues: [{ name: "Pushpanjali", items: [{ invId: "i1", qty: 4 }] }] };
const sel = { venue: "Pushpanjali", functionsDetail: [
  { venue: "Pushpanjali", elements: { z1: [{ invId: "i1" }, { invId: "i2", repeatOverride: true }, { invId: "i3" }] } },
] };
const at = atVenueOfEvent(sel, fv, []);

describe("atVenueOfEvent - fixed / repeat items are at the venue, not loaded", () => {
  it("fixed: standing stock up to the qty; the rest loads", () => {
    expect(at({ id: "i1", invId: "i1", qty: 3 })).toEqual({ fixed: 3, repeat: false, load: 0 });
    expect(at({ id: "i1", invId: "i1", qty: 10 })).toEqual({ fixed: 4, repeat: false, load: 6 });
  });
  it("repeat: none of it loads", () => {
    expect(at({ id: "i2", invId: "i2", qty: 5 })).toMatchObject({ repeat: true, load: 0 });
  });
  it("a fresh item loads in full; FOC never loads", () => {
    expect(at({ id: "i3", invId: "i3", qty: 2 })).toEqual({ fixed: 0, repeat: false, load: 2 });
    expect(at({ id: "i3", invId: "i3", qty: 2, foc: true })).toMatchObject({ foc: true, load: 0 });
  });
  it("repeat only when every use repeats it: one function needing it fresh loads it", () => {
    const s2 = { venue: "X", functionsDetail: [{ elements: { a: [{ invId: "i2", repeatOverride: true }] } }, { elements: { b: [{ invId: "i2" }] } }] };
    expect(atVenueOfEvent(s2, {}, [])({ id: "i2", invId: "i2", qty: 3 })).toMatchObject({ repeat: false, load: 3 });
  });
  it("no event: nothing is at the venue", () => {
    expect(atVenueOfEvent(null, {}, [])({ id: "x", invId: "x", qty: 1 })).toEqual({ fixed: 0, repeat: false, load: 1 });
  });
});

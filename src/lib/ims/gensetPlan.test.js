import { describe, it, expect } from "vitest";
import { gensetsForFn, trVenueFor, totalKva } from "./gensetPlan";

const trVenues = [{ name: "Exotica", genset125: 2, genset62: 1 }, { name: "Pushpanjali", gensets: 1.5 }];

describe("Lighting book: the gensets a function runs on", () => {
  it("the deal's own synced plan wins", () => {
    expect(gensetsForFn({ venue: "Exotica", gensets: { kva125: 1, kva62: 0 } }, trVenues)).toEqual({ kva125: 1, kva62: 0, source: "deal" });
  });
  it("an older event falls back to its venue's standard, a sub-venue to its parent", () => {
    expect(gensetsForFn({ venue: "Exotica" }, trVenues)).toEqual({ kva125: 2, kva62: 1, source: "venue" });
    expect(gensetsForFn({ venue: "Exotica › Aura" }, trVenues)).toEqual({ kva125: 2, kva62: 1, source: "venue" });
    expect(gensetsForFn({ venue: "Pushpanjali" }, trVenues)).toEqual({ kva125: 1, kva62: 1, source: "venue" }); // legacy 1.5
  });
  it("nothing known: null", () => {
    expect(gensetsForFn({ venue: "Somewhere else" }, trVenues)).toBe(null);
    expect(trVenueFor(trVenues, "")).toBe(null);
  });
  it("total kVA", () => {
    expect(totalKva({ kva125: 2, kva62: 1 })).toBe(312.5);
    expect(totalKva(null)).toBe(0);
  });
});

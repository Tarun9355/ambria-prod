import { describe, it, expect } from "vitest";
import { trucksForFn, tripFnOf, fnLabelOf } from "./eventTrucks.js";

// Owner ask 2026-11-27: a truck says which function / venue it goes to; the Site page shows a function only its own trips.
const trucks = [
  { id: "t1", trips: [{ id: "a", fnIdx: 0 }, { id: "b", fnIdx: 1 }] },
  { id: "t2", trips: [{ id: "c" }] },
  { id: "t3", trips: [{ id: "d", fnIdx: 1 }] },
  { id: "t4", loads: { Floral: { "inv:X": 2 } } }, // a truck from before trips existed
];
describe("trip destination", () => {
  it("a function sees its own trips and the trips with no destination", () => {
    const out = trucksForFn(trucks, 0);
    expect(out.map((t) => [t.id, t.trips.map((x) => x.id)])).toEqual([["t1", ["a"]], ["t2", ["c"]], ["t4", ["t4_trip1"]]]);
  });
  it("All functions: every truck as it is", () => {
    expect(trucksForFn(trucks, "all")).toBe(trucks);
  });
  it("reads and labels the destination", () => {
    expect(tripFnOf({ fnIdx: 1 })).toBe(1);
    expect(tripFnOf({ fnIdx: null })).toBe(null);
    expect(fnLabelOf({ type: "Wedding", venue: "Pushpanjali", date: "2026-11-28T00:00" }, 1)).toBe("Wedding · Pushpanjali · 2026-11-28");
  });
});

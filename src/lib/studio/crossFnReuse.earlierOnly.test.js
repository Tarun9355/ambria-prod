import { describe, it, expect } from "vitest";
import { findCrossFnReuseSource } from "./crossFnReuse";

// Haldi (Morning) and Sangeet (Night) at one venue on one day, Wedding the next day (owner report 2026-11-21:
// the same-day rule ran both ways, so a zone both functions had was loaded by neither).
const zone = { enabledEls: { entry: true }, zoneConfig: { entry: { trT: "singleU" } }, zoneElements: { entry: [] } };
const haldi = { fnIdx: 0, fnType: "Haldi", fnShift: "Morning", fnDate: "2026-11-23", fnVenue: "Grand", ...zone };
const sangeet = { fnIdx: 1, fnType: "Sangeet", fnShift: "Night", fnDate: "2026-11-23", fnVenue: "Grand", ...zone };
const wedding = { fnIdx: 2, fnType: "Wedding", fnShift: "Sundowner", fnDate: "2026-11-24", fnVenue: "Grand", ...zone };
const fns = [haldi, sangeet, wedding];

describe("findCrossFnReuseSource earlierOnly", () => {
  it("the first function of the day has no source - it loads its own truss", () => {
    expect(findCrossFnReuseSource(haldi, fns, { earlierOnly: true })).toBeNull();
  });
  it("the later function of the day reuses the earlier one", () => {
    expect(findCrossFnReuseSource(sangeet, fns, { earlierOnly: true })?.fnType).toBe("Haldi");
  });
  it("the next day still reuses both of the day before", () => {
    expect(findCrossFnReuseSource(wedding, fns, { earlierOnly: true })?.fnType).toBe("Haldi + Sangeet");
  });
  it("same shift: the earlier function in the list is the source", () => {
    const a = { ...haldi }, b = { ...haldi, fnIdx: 1, fnType: "Mehndi" };
    expect(findCrossFnReuseSource(a, [a, b], { earlierOnly: true })).toBeNull();
    expect(findCrossFnReuseSource(b, [a, b], { earlierOnly: true })?.fnType).toBe("Haldi");
  });
  it("without the option the old two-way rule is unchanged", () => {
    expect(findCrossFnReuseSource(haldi, fns)?.fnType).toBe("Sangeet");
  });
});

import { describe, it, expect } from "vitest";
import { shortfallBreakdown, setAllocPart, shortfallLine, allocKeyOf } from "./shortfallAlloc";

describe("shortfallBreakdown - the LED example", () => {
  it("600 booked, 500 held: 100 short, nothing assumed made in-house", () => {
    expect(shortfallBreakdown({ booked: 600, short: 100 }, null)).toEqual({ booked: 600, inStock: 500, short: 100, make: 0, outsource: 0, buy: 0, unarranged: 100, trimmed: false });
  });
  it("100 outsourced: fully arranged, none counted as production", () => {
    const bd = shortfallBreakdown({ booked: 600, short: 100 }, { outsource: 100 });
    expect(bd).toMatchObject({ inStock: 500, make: 0, outsource: 100, buy: 0, unarranged: 0 });
    expect(bd.inStock + bd.make + bd.outsource + bd.buy + bd.unarranged).toBe(600);
  });
  it("a split: 30 made, 50 outsourced, 20 not arranged", () => {
    expect(shortfallBreakdown({ booked: 600, short: 100 }, { make: 30, outsource: 50 })).toMatchObject({ make: 30, outsource: 50, unarranged: 20 });
  });
  it("booking cut to 550 (50 short): a 100-unit split is cut back, never more than the shortage", () => {
    const bd = shortfallBreakdown({ booked: 550, short: 50 }, { make: 30, outsource: 70 });
    expect(bd).toMatchObject({ short: 50, make: 30, outsource: 20, unarranged: 0, trimmed: true });
  });
  it("booking cancelled / no shortage: nothing to arrange", () => {
    expect(shortfallBreakdown({ booked: 0, short: 100 }, { make: 100 })).toMatchObject({ booked: 0, short: 0, make: 0, unarranged: 0 });
    expect(shortfallBreakdown({ booked: 400, short: 0 }, { make: 10 })).toMatchObject({ inStock: 400, short: 0, make: 0 });
  });
});

describe("setAllocPart", () => {
  it("holds a part within what the others leave", () => {
    expect(setAllocPart({ make: 60 }, 100, "outsource", 80)).toEqual({ make: 60, outsource: 40 });
    expect(setAllocPart({ make: 60 }, 100, "make", 20)).toEqual({ make: 20 });
    expect(setAllocPart({}, 100, "buy", -5)).toEqual({ buy: 0 });
  });
});

describe("shortfallLine", () => {
  it("reads the split for the challan", () => {
    expect(shortfallLine(shortfallBreakdown({ booked: 600, short: 100 }, { outsource: 100 }))).toBe("600 = 500 in stock + 100 outsourced");
    expect(shortfallLine(shortfallBreakdown({ booked: 600, short: 100 }, { make: 30 }))).toBe("600 = 500 in stock + 30 our production + 70 not arranged");
    expect(shortfallLine(shortfallBreakdown({ booked: 10, short: 0 }, null))).toBe("");
  });
  it("keys by inventory id, else name", () => {
    expect(allocKeyOf({ invId: "I1", name: "LED" })).toBe("I1");
    expect(allocKeyOf({ name: " LED " })).toBe("LED");
  });
});

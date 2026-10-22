import { describe, it, expect, beforeEach } from "vitest";
import { setNonRepeatingItems, itemRepeats } from "./noRepeat.js";
import { computeFnInvQty } from "./crossFnReuse.js";
import { freshFnForManpower } from "./pricing.js";

const fn = {
  enabledEls: { stage: true, entry: true },
  zoneConfig: { stage: { repeat: true }, entry: { repeat: true, repeatCats: { truss: true } } },
  zoneElements: {
    stage: [{ invId: "CHAIR", qty: 10 }, { invId: "CANDLE", qty: 20 }],
    entry: [{ invId: "CANDLE", qty: 5 }],
  },
};

describe("an item that does not repeat", () => {
  beforeEach(() => setNonRepeatingItems([{ id: "CANDLE", canRepeat: false }, { id: "CHAIR" }]));

  it("only an item switched off is non-repeating", () => {
    expect(itemRepeats("CANDLE")).toBe(false);
    expect(itemRepeats("CHAIR")).toBe(true);
    expect(itemRepeats(undefined)).toBe(true);
    expect(itemRepeats("UNKNOWN")).toBe(true);
  });
  it("is left out of what an earlier function lends the next one", () => {
    expect(computeFnInvQty(fn)).toEqual({ CHAIR: 10 });
  });
  it("still counts for the build crew inside a Repeat zone, while the reused chairs do not", () => {
    const f = freshFnForManpower(fn);
    expect(f.zoneElements.stage).toEqual([{ invId: "CANDLE", qty: 20 }]);
    // the entry zone is repeated in full (elements and truss) except its candles, so it stays on for them
    expect(f.enabledEls.entry).toBe(true);
    expect(f.zoneElements.entry).toEqual([{ invId: "CANDLE", qty: 5 }]);
  });
  it("with nothing switched off a fully repeated zone drops out of the crew as before", () => {
    setNonRepeatingItems([]);
    const f = freshFnForManpower(fn);
    expect(f.enabledEls.entry).toBe(false);
    expect(f.enabledEls.stage).toBe(false);
  });
});

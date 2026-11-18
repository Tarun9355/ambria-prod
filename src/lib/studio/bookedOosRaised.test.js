import { describe, it, expect } from "vitest";
import { shortagesRaisedSince } from "./dealAvailability";

// A booked deal's out-of-stock gate stops only for a shortage its salesperson has just caused (owner ask 2026-11-18).
const inv = [
  { id: "candle", name: "Pillar Candle" },
  { id: "console", name: "Wooden Console", subItems: [{ itemId: "candle", qty: 6 }] },
  { id: "chair", name: "Chair" },
];
const fn = (els) => ({ fnIdx: 0, enabledEls: { a: true }, zoneElements: { a: els } });

describe("booked deal: shortages raised here", () => {
  const reserved = { 0: { candle: 30, console: 5, chair: 10 } };

  it("drops a shortage the deal already had (need within what it reserved)", () => {
    const flagged = [{ fnIdx: 0, invId: "candle", itemOut: true, shortParts: [] }];
    expect(shortagesRaisedSince(flagged, reserved, [fn([{ invId: "candle", qty: 30 }])], inv)).toEqual([]);
  });

  it("keeps it when the salesperson raised the qty", () => {
    const flagged = [{ fnIdx: 0, invId: "candle", itemOut: true, shortParts: [] }];
    expect(shortagesRaisedSince(flagged, reserved, [fn([{ invId: "candle", qty: 36 }])], inv)).toHaveLength(1);
  });

  it("keeps a newly added item", () => {
    const flagged = [{ fnIdx: 0, invId: "lamp", itemOut: true, shortParts: [] }];
    expect(shortagesRaisedSince(flagged, reserved, [fn([{ invId: "lamp", qty: 2 }])], inv)).toHaveLength(1);
  });

  it("a kit's short part: dropped while within the reservation, kept once more kits need more of it", () => {
    const flagged = [{ fnIdx: 0, invId: "console", itemOut: false, shortParts: [{ id: "candle", need: 30 }] }];
    expect(shortagesRaisedSince(flagged, reserved, [fn([{ invId: "console", qty: 5 }])], inv)).toEqual([]);
    expect(shortagesRaisedSince(flagged, reserved, [fn([{ invId: "console", qty: 6 }])], inv)).toHaveLength(1);
  });

  it("nothing reserved yet (or for that function): every shortage stops", () => {
    const flagged = [{ fnIdx: 1, invId: "chair", itemOut: true, shortParts: [] }];
    expect(shortagesRaisedSince(flagged, null, [], inv)).toHaveLength(1);
    expect(shortagesRaisedSince(flagged, {}, [], inv)).toHaveLength(1);
    expect(shortagesRaisedSince(flagged, reserved, [{ ...fn([{ invId: "chair", qty: 1 }]), fnIdx: 1 }], inv)).toHaveLength(1);
  });
});

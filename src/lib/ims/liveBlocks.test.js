import { describe, it, expect } from "vitest";
import { isCancelledEO, cancelledEventIds, isLiveBlockEntry, filterLiveBlocks, liveDateBlocks } from "./liveBlocks.js";

describe("isCancelledEO / cancelledEventIds", () => {
  it("only status === 'cancelled' counts, pending/confirming/review/null are left alone", () => {
    expect(isCancelledEO({ status: "cancelled" })).toBe(true);
    expect(isCancelledEO({ status: "pending" })).toBe(false);
    expect(isCancelledEO({ status: "confirming" })).toBe(false);
    expect(isCancelledEO({ status: "review" })).toBe(false);
    expect(isCancelledEO(null)).toBe(false);
    expect(isCancelledEO({})).toBe(false);
  });
  it("collects only cancelled ids", () => {
    const eos = [{ id: "a", status: "cancelled" }, { id: "b", status: "pending" }, { id: "c", status: "cancelled" }, null];
    expect(cancelledEventIds(eos)).toEqual(new Set(["a", "c"]));
  });
  it("an empty/missing eventOrders array changes nothing downstream", () => {
    expect(cancelledEventIds([]).size).toBe(0);
    expect(cancelledEventIds(undefined).size).toBe(0);
  });
});

describe("isLiveBlockEntry", () => {
  const eos = [{ id: "eo-cancelled", status: "cancelled" }, { id: "eo-live", status: "pending" }];
  it("false for a null entry", () => expect(isLiveBlockEntry(null, eos)).toBe(false));
  it("false for an entry whose eventId is cancelled", () => expect(isLiveBlockEntry({ eventId: "eo-cancelled", qty: 5 }, eos)).toBe(false));
  it("true for a live event's entry", () => expect(isLiveBlockEntry({ eventId: "eo-live", qty: 5 }, eos)).toBe(true));
  it("true for an unknown eventId (a functions/client_ledger/amend_requests fallback id, not cancelled)", () => {
    expect(isLiveBlockEntry({ eventId: "fn_123", qty: 5 }, eos)).toBe(true);
  });
  it("accepts a pre-built Set as well as the raw array", () => {
    expect(isLiveBlockEntry({ eventId: "eo-cancelled" }, cancelledEventIds(eos))).toBe(false);
  });
});

describe("filterLiveBlocks", () => {
  const eos = [{ id: "eo-cancelled", status: "cancelled" }];
  it("drops only entries whose eventId is cancelled, keeps everything else", () => {
    const blocks = {
      itemA: [{ eventId: "eo-cancelled", qty: 10 }, { eventId: "eo-live", qty: 3 }],
      itemB: [{ eventId: "eo-live", qty: 7 }],
    };
    expect(filterLiveBlocks(blocks, eos)).toEqual({ itemA: [{ eventId: "eo-live", qty: 3 }], itemB: [{ eventId: "eo-live", qty: 7 }] });
  });
  it("returns the SAME object reference when nothing was removed", () => {
    const blocks = { itemA: [{ eventId: "eo-live", qty: 3 }] };
    expect(filterLiveBlocks(blocks, eos)).toBe(blocks);
  });
  it("returns the same (or an empty) object, never throws, for null/undefined blocks", () => {
    expect(filterLiveBlocks(null, eos)).toEqual({});
    expect(filterLiveBlocks(undefined, eos)).toEqual({});
  });
  it("an empty eventOrders list changes nothing and returns the same reference", () => {
    const blocks = { itemA: [{ eventId: "eo-cancelled", qty: 10 }] };
    expect(filterLiveBlocks(blocks, [])).toBe(blocks);
  });
  it("applying it twice gives the same result as applying it once (idempotent)", () => {
    const blocks = { itemA: [{ eventId: "eo-cancelled", qty: 10 }, { eventId: "eo-live", qty: 3 }] };
    const once = filterLiveBlocks(blocks, eos);
    const twice = filterLiveBlocks(once, eos);
    expect(twice).toEqual(once);
  });
  it("does not mutate the input", () => {
    const blocks = { itemA: [{ eventId: "eo-cancelled", qty: 10 }] };
    const snapshot = JSON.parse(JSON.stringify(blocks));
    filterLiveBlocks(blocks, eos);
    expect(blocks).toEqual(snapshot);
  });
});

describe("liveDateBlocks", () => {
  const eos = [{ id: "eo-cancelled", status: "cancelled" }];
  it("strips cancelled entries from blocksDetailForDate and recomputes blocksForDate from what's left", () => {
    const res = {
      inventory: [{ id: "it1", qty: 12 }],
      blocksForDate: { it1: 19 },
      blocksDetailForDate: { it1: [{ eventId: "eo-cancelled", qty: 10 }, { eventId: "eo-live", qty: 9 }] },
    };
    const next = liveDateBlocks(res, eos);
    expect(next.blocksDetailForDate.it1).toEqual([{ eventId: "eo-live", qty: 9 }]);
    expect(next.blocksForDate.it1).toBe(9);
    expect(next.inventory).toBe(res.inventory); // untouched fields carried over as-is
  });
  it("drops the item's key entirely once every entry was cancelled", () => {
    const res = { blocksForDate: { it1: 10 }, blocksDetailForDate: { it1: [{ eventId: "eo-cancelled", qty: 10 }] } };
    const next = liveDateBlocks(res, eos);
    expect(next.blocksDetailForDate.it1).toBeUndefined();
    expect(next.blocksForDate.it1).toBeUndefined();
  });
  it("tolerates a missing blocksDetailForDate (loadAvailability's early-return shape) and returns the same object", () => {
    const res = { inventory: [] };
    expect(liveDateBlocks(res, eos)).toBe(res);
  });
  it("returns the same object when nothing needs stripping", () => {
    const res = { blocksForDate: { it1: 9 }, blocksDetailForDate: { it1: [{ eventId: "eo-live", qty: 9 }] } };
    expect(liveDateBlocks(res, eos)).toBe(res);
  });
  it("end-to-end: a cancelled order's hold no longer reduces what's free for the date", () => {
    const res = {
      blocksForDate: { it1: 10 },
      blocksDetailForDate: { it1: [{ eventId: "eo-cancelled", qty: 10 }] },
    };
    const next = liveDateBlocks(res, eos);
    const totalOwned = 12;
    const freeNow = totalOwned - (next.blocksForDate.it1 || 0);
    expect(freeNow).toBe(12); // was 2 before filtering (12 - 10)
  });
});

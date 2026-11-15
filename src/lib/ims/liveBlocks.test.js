import { describe, it, expect } from "vitest";
import { isCancelledEO, cancelledEventIds, isLiveBlockEntry, filterLiveBlocks, liveDateBlocks, isLiveBlockStatus, blockEntryQty, heldOnDate, blockEntryQtyToProduce, heldForEventOnDate } from "./liveBlocks.js";

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

describe("isLiveBlockStatus (bug 14 — one shared 'live' definition)", () => {
  it("undefined/empty/unrecognized statuses are live (fails closed)", () => {
    expect(isLiveBlockStatus({ status: undefined })).toBe(true);
    expect(isLiveBlockStatus({ status: "" })).toBe(true);
    expect(isLiveBlockStatus({ status: "held" })).toBe(true);
    expect(isLiveBlockStatus({ status: "confirmed" })).toBe(true);
    expect(isLiveBlockStatus({ status: "final" })).toBe(true);
    expect(isLiveBlockStatus({})).toBe(true);
  });
  it("released and cancelled are not live", () => {
    expect(isLiveBlockStatus({ status: "released" })).toBe(false);
    expect(isLiveBlockStatus({ status: "cancelled" })).toBe(false);
  });
  it("false for null/undefined", () => {
    expect(isLiveBlockStatus(null)).toBe(false);
    expect(isLiveBlockStatus(undefined)).toBe(false);
  });
});

describe("blockEntryQty", () => {
  it("a missing/non-numeric/non-positive qty counts as 0, never defaults to 1", () => {
    expect(blockEntryQty({})).toBe(0);
    expect(blockEntryQty({ qty: 0 })).toBe(0);
    expect(blockEntryQty({ qty: -5 })).toBe(0);
    expect(blockEntryQty({ qty: "not a number" })).toBe(0);
    expect(blockEntryQty(null)).toBe(0);
  });
  it("a positive numeric qty is returned as-is", () => {
    expect(blockEntryQty({ qty: 9 })).toBe(9);
  });
  it("qtyToProduce is never counted, only qty", () => {
    expect(blockEntryQty({ qty: 3, qtyToProduce: 50 })).toBe(3);
  });
});

describe("heldOnDate", () => {
  const entries = [
    { date: "2026-11-15", eventId: "eo_a", qty: 5, status: "confirmed" },
    { date: "2026-11-15", eventId: "eo_b", qty: 3, status: "released" },
    { date: "2026-11-16", eventId: "eo_a", qty: 9, status: "confirmed" },
    { date: "2026-11-15", eventId: "eo_c", qty: 2 },
  ];
  it("sums only live-status entries on the given date", () => {
    expect(heldOnDate(entries, "2026-11-15")).toBe(7); // eo_a(5) + eo_c(2), eo_b released, eo_a/9 is a different date
  });
  it("with a cancelled-events set, that event's entries are excluded too", () => {
    expect(heldOnDate(entries, "2026-11-15", new Set(["eo_a"]))).toBe(2);
  });
  it("accepts the raw eventOrders array in place of a pre-built Set", () => {
    expect(heldOnDate(entries, "2026-11-15", [{ id: "eo_a", status: "cancelled" }])).toBe(2);
  });
  it("empty/missing entries return 0", () => {
    expect(heldOnDate(undefined, "2026-11-15")).toBe(0);
    expect(heldOnDate([], "2026-11-15")).toBe(0);
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

describe("blockEntryQtyToProduce", () => {
  it("a missing/non-numeric/non-positive value counts as 0, mirroring blockEntryQty", () => {
    expect(blockEntryQtyToProduce({})).toBe(0);
    expect(blockEntryQtyToProduce({ qtyToProduce: 0 })).toBe(0);
    expect(blockEntryQtyToProduce({ qtyToProduce: -3 })).toBe(0);
    expect(blockEntryQtyToProduce({ qtyToProduce: "nope" })).toBe(0);
    expect(blockEntryQtyToProduce(null)).toBe(0);
  });
  it("a real positive value counts", () => expect(blockEntryQtyToProduce({ qtyToProduce: 4 })).toBe(4));
});

describe("heldForEventOnDate — bug 10/15 (2026-11-14): the live ledger, matched to one function's own (eventId, date)", () => {
  it("sums qty and qtyToProduce across every live entry matching this exact event+date", () => {
    const entries = [
      { eventId: "eo1", date: "2026-12-01", qty: 4, status: "confirmed" },
      { eventId: "eo1", date: "2026-12-01", qty: 2, qtyToProduce: 3, status: "confirmed", source: "ims-autoconfirm" },
      { eventId: "eo1", date: "2026-12-02", qty: 99, status: "confirmed" }, // different date — excluded
      { eventId: "eo2", date: "2026-12-01", qty: 99, status: "confirmed" }, // different event — excluded
    ];
    expect(heldForEventOnDate(entries, "eo1", "2026-12-01")).toEqual({ qty: 6, qtyToProduce: 3, found: true });
  });
  it("a released/cancelled-status entry still counts as `found` (there IS a live-ledger record), but contributes 0 qty — the caller must trust that 0, not fall back to a stale snapshot", () => {
    const entries = [{ eventId: "eo1", date: "2026-12-01", qty: 10, status: "released" }];
    expect(heldForEventOnDate(entries, "eo1", "2026-12-01")).toEqual({ qty: 0, qtyToProduce: 0, found: true });
  });
  it("found is false when nothing matches this (eventId, date) at all — the caller should fall back to the function row's own static qty", () => {
    expect(heldForEventOnDate([{ eventId: "other", date: "2026-12-01", qty: 5 }], "eo1", "2026-12-01")).toEqual({ qty: 0, qtyToProduce: 0, found: false });
    expect(heldForEventOnDate(undefined, "eo1", "2026-12-01")).toEqual({ qty: 0, qtyToProduce: 0, found: false });
  });
  it("an unrecognised status still fails closed (counts as live), matching isLiveBlockStatus elsewhere", () => {
    expect(heldForEventOnDate([{ eventId: "eo1", date: "d", qty: 5, status: "weird" }], "eo1", "d")).toEqual({ qty: 5, qtyToProduce: 0, found: true });
  });
});

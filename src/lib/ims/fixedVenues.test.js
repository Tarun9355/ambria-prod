import { describe, it, expect } from "vitest";
import { availableAtVenue, reservedByVenueToday, venueSlackFor } from "./fixedVenues";

// Confirmed live bug this covers: an item with 300 total stock, 200 of it configured as standing
// allocation across two Fixed Venues (Pushpanjali 150, Exotica 50), leaving a 100-unit outdoor pool.
// An outdoor deal needing 120 used to be told only 100 were available — availableAtVenue locked the
// WHOLE 200 regardless of whether Pushpanjali/Exotica actually had anything using it that date. The
// fix: when reservedByVenueToday can resolve genuine same-date usage (via the linked event_orders'
// own venue), only the ACTUALLY-reserved portion of each other venue's standing qty counts as locked.

const settings = {
  fixedVenues: [
    { name: "Pushpanjali", items: [{ invId: "ITEM_A", qty: 150 }] },
    { name: "Exotica", items: [{ invId: "ITEM_A", qty: 50 }] },
  ],
};
const item = { id: "ITEM_A", qty: 300 };

describe("availableAtVenue", () => {
  it("without reservedByVenue, locks the WHOLE standing allocation at every other fixed venue (old behavior, unchanged)", () => {
    expect(availableAtVenue(settings, "Some Outdoor Lawn", item)).toBe(100); // 300 - 150 - 50
  });

  it("with reservedByVenue, only the genuinely-reserved portion of each other venue's allocation is locked", () => {
    // Pushpanjali using 145 of its 150 (5 idle), Exotica using all 50 (0 idle) today.
    const reserved = { pushpanjali: 145, exotica: 50 };
    expect(availableAtVenue(settings, "Some Outdoor Lawn", item, reserved)).toBe(105); // 300 - 145 - 50
  });

  it("a venue's OWN standing stock is never locked, with or without reservedByVenue", () => {
    expect(availableAtVenue(settings, "Pushpanjali", item)).toBe(250); // only Exotica's 50 locked
    expect(availableAtVenue(settings, "Pushpanjali", item, { exotica: 10 })).toBe(290); // 300 - 10
  });

  it("an inflated reservedByVenue figure can't lock MORE than a venue's own configured allocation", () => {
    // A stale/bad reservation figure exceeding the venue's own standing qty must not lock more than
    // that venue actually has configured — the min(standing, reserved) ceiling still applies, so this
    // lands on the same 100 as if no reservedByVenue were supplied at all (fully-reserved either way).
    const reserved = { pushpanjali: 9999, exotica: 9999 };
    expect(availableAtVenue(settings, "Some Outdoor Lawn", item, reserved)).toBe(100);
  });
});

describe("reservedByVenueToday", () => {
  const eventOrders = [
    { id: "eo1", venue: "Pushpanjali" },
    { id: "eo2", venue: "Exotica" },
    { id: "eo3", venue: "Pushpanjali" },
  ];

  it("sums qty per venue by resolving each block's eventId through event_orders", () => {
    const blocks = [{ eventId: "eo1", qty: 100 }, { eventId: "eo3", qty: 45 }, { eventId: "eo2", qty: 50 }];
    expect(reservedByVenueToday(blocks, eventOrders)).toEqual({ pushpanjali: 145, exotica: 50 });
  });

  it("a block whose event can't be resolved contributes nothing, rather than being guessed at", () => {
    const blocks = [{ eventId: "eo1", qty: 100 }, { eventId: "does-not-exist", qty: 999 }];
    expect(reservedByVenueToday(blocks, eventOrders)).toEqual({ pushpanjali: 100 });
  });

  it("empty/missing input returns an empty breakdown", () => {
    expect(reservedByVenueToday(undefined, eventOrders)).toEqual({});
    expect(reservedByVenueToday([], eventOrders)).toEqual({});
  });
});

describe("venueSlackFor", () => {
  it("returns only venues with real (>0) idle standing stock, excluding the checked venue's own", () => {
    const reserved = { pushpanjali: 145, exotica: 50 };
    expect(venueSlackFor(settings, "Some Outdoor Lawn", item, reserved)).toEqual([{ name: "Pushpanjali", slack: 5 }]);
  });

  it("no reservedByVenue at all (nothing resolved today) means every other venue's full allocation reads as slack", () => {
    expect(venueSlackFor(settings, "Some Outdoor Lawn", item, {})).toEqual([
      { name: "Pushpanjali", slack: 150 },
      { name: "Exotica", slack: 50 },
    ]);
  });

  it("a fully-reserved venue contributes no slack", () => {
    const reserved = { pushpanjali: 150, exotica: 50 };
    expect(venueSlackFor(settings, "Some Outdoor Lawn", item, reserved)).toEqual([]);
  });
});

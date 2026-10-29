import { describe, it, expect } from "vitest";
import { availableAtVenue, reservedByVenueToday, venueSlackFor, combineAvailability, standingQty, standingDiscQty, rentalSplit } from "./fixedVenues";

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

describe("combineAvailability", () => {
  // The exact gap this closes: 50 total, 40 locked as Fixed Venue standing stock, 10 already
  // blocked today by a sold deal drawing on the unlocked remainder. Math.min(dateAvailable=40,
  // venueAvailable=10) used to report 10 still free; the true remainder is 50-40-10=0.
  it("composes a date-block reduction and a venue-lock reduction against the same total, instead of taking whichever single ceiling is smaller", () => {
    expect(combineAvailability(50, 40, 10)).toBe(0);
  });

  it("with no venue lock, matches the plain date-availability figure", () => {
    expect(combineAvailability(50, 35, 50)).toBe(35);
  });

  it("with no date block, matches the plain venue-availability figure", () => {
    expect(combineAvailability(50, 50, 10)).toBe(10);
  });

  it("never goes negative when both reductions overlap past zero", () => {
    expect(combineAvailability(50, 5, 5)).toBe(0);
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

// A standing item's two buckets (FixedVenuesEditor.jsx): `qty` gets the venue's own discountPct,
// `fullQty` is also physically standing (no rebuild labour) but always bills full rate. `fullQty`
// is opt-in — an item with none set keeps its exact pre-split behavior (100% of its qty discounted).
describe("standing item split — qty (discounted) + fullQty (full rate, still standing)", () => {
  const splitSettings = {
    fixedVenues: [
      { name: "Pushpanjali", items: [{ invId: "ITEM_B", qty: 6, fullQty: 4 }] },
      { name: "Legacy Venue", items: [{ invId: "ITEM_B", qty: 10 }] }, // no fullQty at all
    ],
  };

  it("standingQty is the TWO buckets combined — either one means no rebuild labour", () => {
    expect(standingQty(splitSettings, "Pushpanjali", "ITEM_B")).toBe(10);
    expect(standingQty(splitSettings, "Legacy Venue", "ITEM_B")).toBe(10);
  });

  it("standingDiscQty is only the discount-eligible bucket", () => {
    expect(standingDiscQty(splitSettings, "Pushpanjali", "ITEM_B")).toBe(6);
    expect(standingDiscQty(splitSettings, "Legacy Venue", "ITEM_B")).toBe(10); // no fullQty → all of it discounted, as before
  });

  it("rentalSplit divides a function's usage into discUnits, fullStandingUnits and freshUnits in that priority order", () => {
    // Uses 8 of the 10 standing (6 disc + 4 full, capped at 10 standing) — fills the 6-unit disc
    // bucket first, the remaining 2 fall into the full-rate standing bucket, 0 genuinely fresh.
    expect(rentalSplit(splitSettings, "Pushpanjali", "ITEM_B", 8)).toEqual({
      standingUnits: 8, discUnits: 6, fullStandingUnits: 2, freshUnits: 0, discountPct: 0,
    });
  });

  it("using MORE than the combined standing total spills into freshUnits, on top of a full disc+full split", () => {
    expect(rentalSplit(splitSettings, "Pushpanjali", "ITEM_B", 13)).toEqual({
      standingUnits: 10, discUnits: 6, fullStandingUnits: 4, freshUnits: 3, discountPct: 0,
    });
  });

  it("using fewer than the disc bucket never touches the full-rate bucket at all", () => {
    expect(rentalSplit(splitSettings, "Pushpanjali", "ITEM_B", 4)).toEqual({
      standingUnits: 4, discUnits: 4, fullStandingUnits: 0, freshUnits: 0, discountPct: 0,
    });
  });

  it("a legacy item with no fullQty set discounts its entire usage, exactly as before this split existed", () => {
    expect(rentalSplit(splitSettings, "Legacy Venue", "ITEM_B", 8)).toEqual({
      standingUnits: 8, discUnits: 8, fullStandingUnits: 0, freshUnits: 0, discountPct: 0,
    });
  });
});

import { describe, it, expect } from "vitest";
import { availableAtVenue, reservedByVenueToday, venueSlackFor, combineAvailability, standingQty, standingDiscQty, rentalSplit, venueWithParent, normalizedTrussCounts, standingPillarCount, fixedVenueOverlap, fixedVenueOverlapOnDate, standingReductionBySubcat } from "./fixedVenues";

describe("standingReductionBySubcat — a FOC'd card earns no standing-stock credit", () => {
  const fvSettings = { fixedVenues: [{ name: "Taj Vivanta", items: [{ invId: "pod1", qty: 10 }] }] };
  const inv = [{ id: "pod1", name: "Round Fibre Podium", subCat: "Podium" }];

  it("without zoneElements (pre-FOC callers), every card counts, same as before", () => {
    const cards = { "el::stage::Round Fibre Podium::0": { imsId: "pod1", qty: 5 } };
    expect(standingReductionBySubcat(fvSettings, "Taj Vivanta", cards, inv)).toEqual({ Podium: 5 });
  });

  it("with zoneElements, a card whose backlinked element is FOC contributes no reduction", () => {
    const cards = { "el::stage::Round Fibre Podium::0": { imsId: "pod1", qty: 5 } };
    const zoneElements = { stage: [{ name: "Round Fibre Podium", invId: "pod1", qty: 5, foc: true }] };
    expect(standingReductionBySubcat(fvSettings, "Taj Vivanta", cards, inv, zoneElements)).toEqual({});
  });

  it("with zoneElements, a non-FOC card still counts normally", () => {
    const cards = { "el::stage::Round Fibre Podium::0": { imsId: "pod1", qty: 5 } };
    const zoneElements = { stage: [{ name: "Round Fibre Podium", invId: "pod1", qty: 5 }] };
    expect(standingReductionBySubcat(fvSettings, "Taj Vivanta", cards, inv, zoneElements)).toEqual({ Podium: 5 });
  });
});

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

  it("overlap defaults to 0 — an un-updated caller gets byte-for-byte the same result as before", () => {
    expect(combineAvailability(50, 40, 10)).toBe(combineAvailability(50, 40, 10, 0));
  });

  it("an overlap that exceeds either ceiling is clamped to the old Math.min bound, never over-correcting", () => {
    expect(combineAvailability(50, 40, 10, 999)).toBe(10); // min(dateAvailable, venueAvailable)
  });

  it("a negative overlap is clamped to 0", () => {
    expect(combineAvailability(50, 40, 10, -5)).toBe(0);
  });

  it("the corrected result is always between the uncorrected figure and min(dateAvailable, venueAvailable)", () => {
    for (const [t, d, v, o] of [[24, 16, 8, 8], [24, 8, 8, 16], [50, 40, 10, 25], [100, 0, 0, 50]]) {
      const corrected = combineAvailability(t, d, v, o);
      const uncorrected = combineAvailability(t, d, v);
      expect(corrected).toBeGreaterThanOrEqual(uncorrected);
      expect(corrected).toBeLessThanOrEqual(Math.min(d, v));
    }
  });
});

// Confirmed live bug (owner report, 2026-11-11): client "Rakesh", venue "Emerald Green" (not itself
// a Fixed Venue), item with 24 total — 8 standing at Pushpanjali, 8 at Exotica, 8 in the general
// pool. Pushpanjali's own event used its own 8 standing units that date, which wrote an ordinary
// block row — ON TOP of availableAtVenue already locking Pushpanjali's and Exotica's WHOLE
// allocations away from Emerald Green regardless of use. Without the overlap correction, that
// double-counts those units and reports 0 free even though the 8 pool units are genuinely open.
describe("fixedVenueOverlap / fixedVenueOverlapOnDate — the Rakesh/Emerald Green double-count", () => {
  const rk = {
    fixedVenues: [
      { name: "Pushpanjali", items: [{ invId: "IWCT", qty: 8 }] },
      { name: "Exotica", items: [{ invId: "IWCT", qty: 8 }] },
    ],
  };
  const rkItem = { id: "IWCT", qty: 24 };
  const orders = [
    { id: "eoP", venue: "Pushpanjali" },
    { id: "eoE", venue: "Exotica" },
    { id: "eoL", venue: "Some Lawn" },
    { id: "eoOwnP", venue: "Pushpanjali" },
  ];

  it("Pushpanjali using its own 8 standing units: plain-mode availability at Emerald Green is 8, not 0", () => {
    const entries = [{ eventId: "eoP", qty: 8 }];
    const overlap = fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, entries, orders);
    expect(overlap).toBe(8);
    const dateAvailable = 24 - 8; // blockedByDate = 8
    const venueAvailable = availableAtVenue(rk, "Emerald Green", rkItem); // 24 - 8 - 8 = 8 (both WHOLE allocations locked)
    expect(combineAvailability(24, dateAvailable, venueAvailable, overlap)).toBe(8);
    // Without the fix (overlap omitted), this is the confirmed bug — reports 0.
    expect(combineAvailability(24, dateAvailable, venueAvailable)).toBe(0);
  });

  it("both Fixed Venues in use on the same date: still correctly reports the 8-unit pool", () => {
    const entries = [{ eventId: "eoP", qty: 8 }, { eventId: "eoE", qty: 8 }];
    const overlap = fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, entries, orders);
    expect(overlap).toBe(16);
    expect(combineAvailability(24, 24 - 16, availableAtVenue(rk, "Emerald Green", rkItem), overlap)).toBe(8);
  });

  it("slack mode: idle standing stock at Exotica becomes real slack once Pushpanjali's own usage is netted out", () => {
    const entries = [{ eventId: "eoP", qty: 8 }];
    const rbv = reservedByVenueToday(entries, orders); // { pushpanjali: 8 }
    const venueAvailable = availableAtVenue(rk, "Emerald Green", rkItem, rbv); // 24 - min(8,8) - min(8,0) = 16
    const overlap = fixedVenueOverlap(rk, "Emerald Green", rkItem, rbv);
    expect(overlap).toBe(8);
    expect(combineAvailability(24, 24 - 8, venueAvailable, overlap)).toBe(16); // collapses to dateAvailable
  });

  it("usage at a venue that ISN'T a Fixed Venue still comes off the pool normally (not folded into the overlap)", () => {
    const entries = [{ eventId: "eoL", qty: 5 }, { eventId: "eoP", qty: 8 }];
    const overlap = fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, entries, orders);
    expect(overlap).toBe(8); // only Pushpanjali's own usage, never the plain-lawn usage
    expect(combineAvailability(24, 24 - 13, availableAtVenue(rk, "Emerald Green", rkItem), overlap)).toBe(3); // 8 pool - 5 lawn
  });

  it("a Fixed Venue using MORE than its own standing stock: the overlap is capped at what it actually has standing", () => {
    const entries = [{ eventId: "eoP", qty: 12 }]; // Pushpanjali drawing 4 extra from the pool
    const overlap = fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, entries, orders);
    expect(overlap).toBe(8); // capped at Pushpanjali's own 8 standing, not the full 12 blocked
    expect(combineAvailability(24, 24 - 12, availableAtVenue(rk, "Emerald Green", rkItem), overlap)).toBe(4); // 8 pool - 4 drawn from it
  });

  it("the current deal's OWN block is excluded, so it never over-reports the venue it's already using as idle", () => {
    const entries = [{ eventId: "eoOwnP", qty: 8 }];
    const overlap = fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, entries, orders, { excludeEventIds: ["eoOwnP"] });
    expect(overlap).toBe(0); // excluded — this is the deal's OWN usage, not "someone else's genuine demand"
    const dateAvailable = 24; // same reasoning — the deal's own block is netted out of dateAvailable upstream too
    expect(combineAvailability(24, dateAvailable, availableAtVenue(rk, "Emerald Green", rkItem), overlap)).toBe(8); // not 16
  });

  it("no blocks at all, or an item with no standing stock anywhere, short-circuits to 0 with no eventOrders lookup needed", () => {
    expect(fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, [], orders)).toBe(0);
    expect(fixedVenueOverlapOnDate(rk, "Emerald Green", rkItem, undefined, orders)).toBe(0);
    expect(fixedVenueOverlapOnDate(rk, "Emerald Green", { id: "NO_STANDING", qty: 10 }, [{ eventId: "eoP", qty: 5 }], orders)).toBe(0);
  });

  it("an inflated reservedByVenue can't push the overlap past what's actually configured standing", () => {
    const bigItem = { id: "ITEM_A", qty: 300 };
    const settings300 = {
      fixedVenues: [
        { name: "Pushpanjali", items: [{ invId: "ITEM_A", qty: 150 }] },
        { name: "Exotica", items: [{ invId: "ITEM_A", qty: 50 }] },
      ],
    };
    expect(fixedVenueOverlap(settings300, "Some Outdoor Lawn", bigItem, { pushpanjali: 9999, exotica: 9999 })).toBe(200);
  });

  it("in slack mode, the overlap exactly equals availableAtVenue's own lockedElsewhere, by construction", () => {
    const bigItem = { id: "ITEM_A", qty: 300 };
    const settings300 = {
      fixedVenues: [
        { name: "Pushpanjali", items: [{ invId: "ITEM_A", qty: 150 }] },
        { name: "Exotica", items: [{ invId: "ITEM_A", qty: 50 }] },
      ],
    };
    for (const rbv of [{ pushpanjali: 145, exotica: 50 }, {}, { exotica: 10 }]) {
      const lockedElsewhere = 300 - availableAtVenue(settings300, "Pushpanjali", bigItem, rbv);
      expect(fixedVenueOverlap(settings300, "Pushpanjali", bigItem, rbv)).toBe(lockedElsewhere);
    }
  });

  it("standing allocations that together exceed the item's total still can't push availability below 0", () => {
    const overAllocated = { fixedVenues: [
      { name: "A", items: [{ invId: "X", qty: 20 }] },
      { name: "B", items: [{ invId: "X", qty: 20 }] },
    ] };
    const xItem = { id: "X", qty: 24 };
    const entries = [{ eventId: "eoA", qty: 20 }];
    const orders2 = [{ id: "eoA", venue: "A" }];
    const overlap = fixedVenueOverlapOnDate(overAllocated, "Emerald Green", xItem, entries, orders2);
    expect(overlap).toBe(20);
    const dateAvailable = 24 - 20;
    const venueAvailable = availableAtVenue(overAllocated, "Emerald Green", xItem); // 24-20-20 clamped to 0
    expect(combineAvailability(24, dateAvailable, venueAvailable, overlap)).toBe(0);
  });
});

describe("reservedByVenueToday — opts", () => {
  it("excludeEventIds drops the listed events from the breakdown", () => {
    const eventOrders = [{ id: "eo1", venue: "Pushpanjali" }, { id: "eo2", venue: "Pushpanjali" }];
    const blocks = [{ eventId: "eo1", qty: 10 }, { eventId: "eo2", qty: 5 }];
    expect(reservedByVenueToday(blocks, eventOrders, { excludeEventIds: ["eo1"] })).toEqual({ pushpanjali: 5 });
  });

  it("opts.date resolves a per-function venue over the event's own top-level venue", () => {
    const eventOrders = [{ id: "eo1", venue: "Pushpanjali", functionsDetail: [{ date: "2026-11-15", venue: "Exotica" }] }];
    const blocks = [{ eventId: "eo1", qty: 10 }];
    expect(reservedByVenueToday(blocks, eventOrders, { date: "2026-11-15" })).toEqual({ exotica: 10 });
    expect(reservedByVenueToday(blocks, eventOrders)).toEqual({ pushpanjali: 10 }); // unchanged without opts.date
  });

  it("opts.settings groups a sub-venue under its parent Fixed Venue", () => {
    const eventOrders = [{ id: "eo1", venue: "Aura" }];
    const blocks = [{ eventId: "eo1", qty: 10 }];
    const settingsWithParent = { fixedVenues: [{ name: "Exotica", items: [] }], venueParents: { Aura: "Exotica" } };
    expect(reservedByVenueToday(blocks, eventOrders, { settings: settingsWithParent })).toEqual({ exotica: 10 });
    expect(reservedByVenueToday(blocks, eventOrders)).toEqual({ aura: 10 }); // unchanged without opts.settings
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

describe("venueWithParent — a sub-venue is shown with its property", () => {
  const s = { venueParents: { Poolside: "Valencia", Aura: "Exotica", "Aura Poolside": "Aura", Exotica: "Exotica", "Laura Hall": "Aura", Farm: "Farm" } };
  it("puts the property in front of a sub-venue", () => {
    expect(venueWithParent(s, "Poolside")).toBe("Valencia › Poolside");
    expect(venueWithParent(s, "Aura")).toBe("Exotica › Aura");
  });
  it("leaves a property, an outdoor venue and an unknown name alone", () => {
    expect(venueWithParent(s, "Exotica")).toBe("Exotica");
    expect(venueWithParent(s, "Farm")).toBe("Farm");
    expect(venueWithParent(s, "Somewhere New")).toBe("Somewhere New");
    expect(venueWithParent(s, "")).toBe("");
  });
  it("does not repeat a property the name already carries — whole words only", () => {
    expect(venueWithParent(s, "Aura Poolside")).toBe("Aura Poolside");
    expect(venueWithParent(s, "Laura Hall")).toBe("Aura › Laura Hall");
  });
  it("reads the map when it is stored as a JSON string", () => {
    expect(venueWithParent({ venueParents: JSON.stringify(s.venueParents) }, "Poolside")).toBe("Valencia › Poolside");
  });
});

// A fixed venue's standing pillars/beams are tracked per truss material (Iron/Pole/Aluminium) now,
// but every venue configured before this split existed still has the OLD flat shape ({size: qty})
// saved — normalizedTrussCounts must read that as entirely Iron, never drop it.
describe("normalizedTrussCounts — reads both the legacy flat shape and the new material-split shape", () => {
  it("a legacy flat {size: qty} bucket is attributed entirely to Iron", () => {
    expect(normalizedTrussCounts({ "15": 29, "12": 14 })).toEqual({
      iron: { "15": 29, "12": 14 }, pole: {}, aluminium: {},
    });
  });
  it("an already material-split bucket is read as-is, missing materials defaulting to empty", () => {
    expect(normalizedTrussCounts({ iron: { "15": 10 }, pole: { "12": 5 } })).toEqual({
      iron: { "15": 10 }, pole: { "12": 5 }, aluminium: {},
    });
  });
  it("empty/missing input reads as every material empty", () => {
    expect(normalizedTrussCounts(null)).toEqual({ iron: {}, pole: {}, aluminium: {} });
    expect(normalizedTrussCounts({})).toEqual({ iron: {}, pole: {}, aluminium: {} });
  });
});

describe("standingPillarCount — sums across every material, both legacy and material-split data", () => {
  it("sums a legacy flat venue's pillar counts (all Iron)", () => {
    const settings = { fixedVenues: [{ name: "Aura", truss: { pillars: { "15": 29, "12": 14, "10": 0, "8": 0 } } }] };
    expect(standingPillarCount(settings, "Aura")).toBe(43);
  });
  it("sums a material-split venue's pillar counts across Iron + Pole + Aluminium", () => {
    const settings = { fixedVenues: [{ name: "Aura", truss: { pillars: { iron: { "15": 29, "12": 14 }, pole: { "12": 5 }, aluminium: { "10": 2 } } } }] };
    expect(standingPillarCount(settings, "Aura")).toBe(50);
  });
  it("a venue with no truss config at all has 0 standing pillars", () => {
    expect(standingPillarCount({ fixedVenues: [{ name: "Aura" }] }, "Aura")).toBe(0);
  });
});

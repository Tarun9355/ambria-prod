import { describe, it, expect } from "vitest";
import { shiftGroupOf, combinedFixedVenueRequirement, effectiveBlockedTotal, collapseVenueShift, collapsedDealShiftFor, blockEntriesWithVenueShift, sharingFreeZone, getSharingAwareAvailable } from "./fixedVenueSharing.js";

describe("shiftGroupOf", () => {
  it("classifies day shifts", () => {
    expect(shiftGroupOf("Morning")).toBe("day");
    expect(shiftGroupOf("lunch")).toBe("day");
    expect(shiftGroupOf("Brunch")).toBe("day");
  });
  it("classifies night shifts", () => {
    expect(shiftGroupOf("Dinner")).toBe("night");
    expect(shiftGroupOf("night")).toBe("night");
    expect(shiftGroupOf("Late Night")).toBe("night");
  });
  it("treats sundowner/evening/unknown/blank as unsafe (null)", () => {
    expect(shiftGroupOf("Sundowner")).toBeNull();
    expect(shiftGroupOf("Evening")).toBeNull();
    expect(shiftGroupOf("")).toBeNull();
    expect(shiftGroupOf(undefined)).toBeNull();
    expect(shiftGroupOf("Something Else")).toBeNull();
  });
});

describe("combinedFixedVenueRequirement", () => {
  it("fully shares when both sides fit within standing qty", () => {
    expect(combinedFixedVenueRequirement(12, 12, 12)).toBe(12);
    expect(combinedFixedVenueRequirement(10, 10, 12)).toBe(10);
  });
  it("only shares up to the standing qty, sums the rest", () => {
    // day 12, night 20, standing 12: 12 units reused, the other 8 of night's 20 still needed separately
    expect(combinedFixedVenueRequirement(12, 20, 12)).toBe(20);
  });
  it("caps reuse below standing qty when standing is the smallest value", () => {
    // day 10, night 10, standing 5: only 5 reused, 15 total needed
    expect(combinedFixedVenueRequirement(10, 10, 5)).toBe(15);
  });
  it("one-sided group just sums (nothing to pair against)", () => {
    expect(combinedFixedVenueRequirement(20, 0, 12)).toBe(20);
    expect(combinedFixedVenueRequirement(0, 0, 12)).toBe(0);
  });
});

describe("effectiveBlockedTotal", () => {
  // ownedQty is now a plain 4th argument — the item's own total owned quantity (owner clarification,
  // 2026-11-15, 2nd report: "Arch panel small" got zero credit because it had never been separately
  // registered at Pushpanjali's own standing-inventory list; the cap is the item's own `qty`, not a
  // per-venue registration, so settings here no longer need a per-item `items` list at all).
  const settings = { fixedVenues: [{ id: "fv_push", name: "Pushpanjali" }] };

  it("the reported Pushpanjali scenario: lunch 12 + dinner 12, owned 12 -> one 12-unit block", () => {
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" },
    ];
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 12)).toBe(12);
  });

  it("a different Fixed Venue property never shares with Pushpanjali's own demand", () => {
    const settings2 = {
      fixedVenues: [
        { id: "fv_push", name: "Pushpanjali" },
        { id: "fv_emerald", name: "Emerald Green" },
      ],
    };
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" },
      { qty: 20, venueName: "Emerald Green", shift: "Dinner" },
    ];
    // Pushpanjali combines to 12 (fully shared), Emerald Green has no opposite-shift partner there -> 20 in full
    expect(effectiveBlockedTotal(entries, settings2, "ITEM1", 12)).toBe(32);
  });

  it("same shift at two different sub-venues of the same property still sums (no reuse)", () => {
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Morning" },
      { qty: 8, venueName: "Pushpanjali", shift: "Morning" },
    ];
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 12)).toBe(20);
  });

  it("an unsafe shift (Sundowner) never shares, even with an otherwise-compatible opposite", () => {
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Sundowner" },
    ];
    // Sundowner's 12 is "other" -> always added in full; Lunch alone (no night partner) also adds in full
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 12)).toBe(24);
  });

  it("an outdoor (non-Fixed-Venue) booking always sums in full, regardless of shift", () => {
    const entries = [
      { qty: 10, venueName: "Client's Own Lawn", shift: "Lunch" },
      { qty: 7, venueName: "Client's Own Lawn", shift: "Dinner" },
    ];
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 12)).toBe(17);
  });

  it("an item owned 0 units gets no credit", () => {
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" },
    ];
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 0)).toBe(24);
  });

  it("a sub-venue resolves to its parent property via fixedVenueFor/venueParents", () => {
    const settingsP = {
      fixedVenues: [{ id: "fv_exotica", name: "Exotica" }],
      venueParents: { Aura: "Exotica" },
    };
    const entries = [
      { qty: 12, venueName: "Aura", shift: "Lunch" },
      { qty: 12, venueName: "Exotica", shift: "Dinner" },
    ];
    expect(effectiveBlockedTotal(entries, settingsP, "ITEM1", 12)).toBe(12);
  });

  it("the RAKESH/NP Singh/Sahej Singh scenario reproduces the real 7-unit shortfall, not -19", () => {
    const settings2 = {
      fixedVenues: [
        { id: "fv_push", name: "Pushpanjali" },
        { id: "fv_emerald", name: "Emerald Green" },
      ],
    };
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" }, // NP Singh
      { qty: 20, venueName: "Emerald Green", shift: "Dinner" }, // RAKESH
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" }, // Sahej Singh
    ];
    const total = effectiveBlockedTotal(entries, settings2, "ITEM1", 25); // item owned 25 total
    expect(total).toBe(32); // Pushpanjali combines to 12, Emerald Green's 20 stands alone
    expect(25 - total).toBe(-7); // owned 25 -> genuinely short by 7, not -19
  });

  it("two DIFFERENT properties each running their own day/night pair for the same item never double-dip the same owned-qty cap (each property's own credit is bounded by its own min(day,night), so the cross-property SUM still reflects the true simultaneous peak)", () => {
    const settings2 = {
      fixedVenues: [
        { id: "fv_a", name: "Property A" },
        { id: "fv_b", name: "Property B" },
      ],
    };
    const entries = [
      { qty: 2, venueName: "Property A", shift: "Lunch" },
      { qty: 4, venueName: "Property A", shift: "Dinner" },
      { qty: 2, venueName: "Property B", shift: "Lunch" },
      { qty: 4, venueName: "Property B", shift: "Dinner" },
    ];
    const total = effectiveBlockedTotal(entries, settings2, "ITEM1", 4); // 4 owned total
    // A combines to 4 (max(2,4)), B combines to 4 too — summed, not shared across properties, since
    // the two properties' dinners genuinely happen at the same time and each needs its own 4.
    expect(total).toBe(8);
    expect(4 - total).toBe(-4); // correctly a real shortfall of 4, never silently hidden by the cap
  });

  it("multiple same-group entries at a property combine correctly against the opposite group (order independent)", () => {
    // night 12 + night 12 (two separate night functions, same property) = 24; day 12 added later
    const night1 = [{ qty: 12, venueName: "Pushpanjali", shift: "Dinner" }];
    const night2 = [{ qty: 12, venueName: "Pushpanjali", shift: "Dinner" }];
    const day1 = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(effectiveBlockedTotal([...night1, ...night2, ...day1], settings, "ITEM1", 12)).toBe(24);
  });

  it("legacy settings without a stable .id on fixedVenues entries still group correctly (regression review finding 7)", () => {
    const settingsNoId = {
      fixedVenues: [
        { name: "Pushpanjali" }, // no .id at all
      ],
    };
    const entries = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" },
    ];
    expect(effectiveBlockedTotal(entries, settingsNoId, "ITEM1", 12)).toBe(12);
  });

  it("a deal that is ITSELF at the property in both shift groups (pre-collapsed via collapseVenueShift) never looks free to share with someone else (regression review finding 2: the overbook repro)", () => {
    // E1: one deal with a Haldi (Lunch) and a Sangeet (Dinner), both at Pushpanjali, both needing 12 —
    // its own within-deal reuse already collapses this to ONE block of 12, but that 12 is needed
    // in BOTH windows by E1 itself, so it must NOT also look like a free day-only slot for E2's own
    // separate Dinner function to share.
    const e1Collapsed = collapseVenueShift([
      { venueName: "Pushpanjali", shift: "Lunch" },
      { venueName: "Pushpanjali", shift: "Dinner" },
    ]);
    expect(e1Collapsed).toEqual({ venueName: "Pushpanjali", shift: "" }); // mixed groups -> "other", not day or night
    const entries = [
      { qty: 12, venueName: e1Collapsed.venueName, shift: e1Collapsed.shift }, // E1, pre-collapsed
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" }, // E2, Dinner only
    ];
    // E1's 12 lands in "other" (always full, never shared) + E2's 12 is alone in "night" (no day
    // partner to share with) -> 12 + 12 = 24, the correct real total, not 12 (which the pre-fix
    // "pick whichever function set the max" classification would have wrongly produced).
    expect(effectiveBlockedTotal(entries, settings, "ITEM1", 12)).toBe(24);
  });
});

describe("sharingFreeZone — admission-time marginal credit (regression review, 2026-11-15, finding 4)", () => {
  const settings = { fixedVenues: [{ id: "fv_push", name: "Pushpanjali" }] };

  it("a new Dinner request fully pairs with an existing Lunch hold -> free zone covers it entirely", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12)).toBe(12);
  });

  it("a new request bigger than the opposite group's existing hold only gets a partial free zone", () => {
    const others = [{ qty: 5, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12)).toBe(5);
  });

  it("capped at owned qty even if the opposite group's existing hold is bigger", () => {
    const others = [{ qty: 20, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12)).toBe(12); // owned-qty cap
  });

  it("an existing SAME-group hold reduces the free zone (it's already competing with the new request too)", () => {
    const others = [
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" }, // opposite
      { qty: 8, venueName: "Pushpanjali", shift: "Dinner" }, // same group as the new request
    ];
    // free zone = min(opposite=12, owned=12) - same=8 = 4
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12)).toBe(4);
  });

  it("no opposite-group demand at all -> no free zone", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Dinner" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12)).toBe(0);
  });

  it("an unsafe own shift (Sundowner) never gets a free zone", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Sundowner", 12)).toBe(0);
  });

  it("a different Fixed Venue property never credits against Pushpanjali's own demand", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Emerald Green", "Dinner", 12)).toBe(0);
  });

  it("an outdoor own venue never gets a free zone", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Client's Own Lawn", "Dinner", 12)).toBe(0);
  });

  it("an item owned 0 units never gets a free zone, however big the opposite-group hold is", () => {
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    expect(sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 0)).toBe(0);
  });

  it("reproduces the real NP/RAKESH/Sahej scenario end to end (owned 12)", () => {
    // Sahej's own new Dinner request of 12, with NP's existing Lunch 12 as the only other entry.
    const others = [{ qty: 12, venueName: "Pushpanjali", shift: "Lunch" }];
    const othersTotal = effectiveBlockedTotal(others, settings, "ITEM1", 12); // 12 (NP alone, no partner yet)
    const freeZone = sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 12); // 12
    const effectiveOthers = Math.max(0, othersTotal - freeZone);
    const owned = 12;
    const free = Math.max(owned - effectiveOthers, 0);
    expect(free).toBeGreaterThanOrEqual(12); // Sahej's own 12 is fully grantable, not short
  });

  it("the live-reported Arch panel small scenario: 2 owned by Lunch, 4 by Dinner, 4 owned total -> fully shares, nothing short", () => {
    // Owner report, 2026-11-15: this item was never separately registered at Pushpanjali's own
    // standing-inventory list, so it got ZERO credit under the old per-venue-registration design
    // (2 + 4 summed to 6 against 4 owned, a false "0 available"). The cap is now the item's own
    // owned qty, so it needs no registration at all.
    const others = [{ qty: 2, venueName: "Pushpanjali", shift: "Lunch" }];
    const othersTotal = effectiveBlockedTotal(others, settings, "ITEM1", 4);
    const freeZone = sharingFreeZone(others, settings, "ITEM1", "Pushpanjali", "Dinner", 4);
    const effectiveOthers = Math.max(0, othersTotal - freeZone);
    const owned = 4;
    const free = Math.max(owned - effectiveOthers, 0);
    expect(free).toBeGreaterThanOrEqual(4); // the new 4-unit Dinner request is fully grantable
  });
});

describe("getSharingAwareAvailable — Build's own live availability (regression review, 2026-11-15, round 2, finding H1)", () => {
  const settings = { fixedVenues: [{ id: "fv_push", name: "Pushpanjali" }] };
  const eventOrders = [
    { id: "eo_np", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Lunch" }] },
  ];

  it("Sahej's own new Dinner request at Pushpanjali is fully available against NP's existing Lunch hold", () => {
    const item = { id: "ITEM1", qty: 12, blocked: 0 };
    const blocksDetailForDate = { ITEM1: [{ eventId: "eo_np", qty: 12, status: "confirmed" }] };
    const avail = getSharingAwareAvailable(item, blocksDetailForDate, eventOrders, settings, "2027-05-01", "Pushpanjali", "Dinner", []);
    expect(avail).toBe(12);
  });

  it("without a shift (no credit eligible), still strictly improves on a flat sum when OTHER entries already share", () => {
    const item = { id: "ITEM1", qty: 25, blocked: 0 };
    const eventOrdersTwo = [
      { id: "eo_np", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Lunch" }] },
      { id: "eo_sahej", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Dinner" }] },
    ];
    const blocksDetailForDate = { ITEM1: [
      { eventId: "eo_np", qty: 12, status: "confirmed" },
      { eventId: "eo_sahej", qty: 12, status: "confirmed" },
    ] };
    // RAKESH's own request at a DIFFERENT, unrelated venue — no shift credit for him, but the flat
    // sum (24) would have wrongly shown only 1 free; the grouped total (12, NP+Sahej fully shared)
    // correctly shows 13 free.
    const avail = getSharingAwareAvailable(item, blocksDetailForDate, eventOrdersTwo, settings, "2027-05-01", "Emerald Green", "Dinner", []);
    expect(avail).toBe(13);
  });

  it("excludes this deal's own holds via excludeEventIds", () => {
    const item = { id: "ITEM1", qty: 12, blocked: 0 };
    const blocksDetailForDate = { ITEM1: [{ eventId: "eo_mine", qty: 12, status: "confirmed" }] };
    const avail = getSharingAwareAvailable(item, blocksDetailForDate, eventOrders, settings, "2027-05-01", "Pushpanjali", "Dinner", ["eo_mine"]);
    expect(avail).toBe(12);
  });

  it("null item returns 0, not a throw", () => {
    expect(getSharingAwareAvailable(null, {}, [], {}, "2027-05-01", "", "", [])).toBe(0);
  });
});

describe("collapsedDealShiftFor — per-deal-per-date collapse (regression review, 2026-11-15, round 3, finding H2)", () => {
  it("a single function on the date passes through", () => {
    const fns = [{ fnVenue: "Pushpanjali", fnShift: "Dinner", fnDate: "2027-05-01" }];
    expect(collapsedDealShiftFor(fns, "2027-05-01")).toEqual({ venueName: "Pushpanjali", shift: "Dinner" });
  });

  it("a Lunch function and a Night function on the SAME date, same property -> collapses to unshared, regardless of which item either uses", () => {
    const fns = [
      { fnVenue: "Pushpanjali", fnShift: "Lunch", fnDate: "2027-05-01" },
      { fnVenue: "Pushpanjali", fnShift: "Night", fnDate: "2027-05-01" },
    ];
    expect(collapsedDealShiftFor(fns, "2027-05-01")).toEqual({ venueName: "Pushpanjali", shift: "" });
  });

  it("a function on a DIFFERENT date is excluded from the collapse", () => {
    const fns = [
      { fnVenue: "Pushpanjali", fnShift: "Lunch", fnDate: "2027-05-01" },
      { fnVenue: "Pushpanjali", fnShift: "Night", fnDate: "2027-05-02" },
    ];
    expect(collapsedDealShiftFor(fns, "2027-05-01")).toEqual({ venueName: "Pushpanjali", shift: "Lunch" });
  });

  it("tolerates object-shaped venue (IMS functions rows) and date/venue/shift field-name variants", () => {
    const fns = [{ venue: { type: "fixed", name: "Pushpanjali" }, shift: "Dinner", date: "2027-05-01" }];
    expect(collapsedDealShiftFor(fns, "2027-05-01")).toEqual({ venueName: "Pushpanjali", shift: "Dinner" });
  });

  it("no functions on the date -> no venue, no credit", () => {
    expect(collapsedDealShiftFor([{ fnVenue: "Pushpanjali", fnShift: "Lunch", fnDate: "2027-05-02" }], "2027-05-01")).toEqual({ venueName: null, shift: "" });
  });
});

describe("collapseVenueShift", () => {
  it("a single pair passes through unchanged", () => {
    expect(collapseVenueShift([{ venueName: "Pushpanjali", shift: "Lunch" }])).toEqual({ venueName: "Pushpanjali", shift: "Lunch" });
  });
  it("same venue, same shift group across multiple pairs -> that pair", () => {
    expect(collapseVenueShift([{ venueName: "Pushpanjali", shift: "Morning" }, { venueName: "Pushpanjali", shift: "Lunch" }]))
      .toEqual({ venueName: "Pushpanjali", shift: "Lunch" });
  });
  it("same venue, mixed shift groups -> that venue, unshared ('other')", () => {
    expect(collapseVenueShift([{ venueName: "Pushpanjali", shift: "Lunch" }, { venueName: "Pushpanjali", shift: "Dinner" }]))
      .toEqual({ venueName: "Pushpanjali", shift: "" });
  });
  it("different venues -> no venue at all (outdoor bucket, never shared)", () => {
    expect(collapseVenueShift([{ venueName: "Pushpanjali", shift: "Lunch" }, { venueName: "Emerald Green", shift: "Lunch" }]))
      .toEqual({ venueName: null, shift: "" });
  });
  it("empty input -> no venue", () => {
    expect(collapseVenueShift([])).toEqual({ venueName: null, shift: "" });
  });
});

describe("blockEntriesWithVenueShift", () => {
  const eventOrders = [
    { id: "eo_a", venue: "Pushpanjali", shift: "Lunch", functionsDetail: [{ date: "2026-11-15", venue: "Pushpanjali", shift: "Lunch" }] },
    { id: "eo_b", venue: "Pushpanjali", shift: "Dinner", functionsDetail: [{ date: "2026-11-15", venue: "Pushpanjali", shift: "Dinner" }] },
    { id: "eo_c", status: "cancelled", venue: "Pushpanjali", shift: "Lunch", functionsDetail: [{ date: "2026-11-15", venue: "Pushpanjali", shift: "Lunch" }] },
    {
      id: "eo_mixed", venue: "Pushpanjali", functionsDetail: [
        { date: "2026-11-15", venue: "Pushpanjali", shift: "Lunch" },
        { date: "2026-11-15", venue: "Pushpanjali", shift: "Dinner" },
      ],
    },
  ];
  it("resolves venue/shift per entry from functionsDetail", () => {
    const entries = [
      { eventId: "eo_a", date: "2026-11-15", qty: 12, status: "confirmed" },
      { eventId: "eo_b", date: "2026-11-15", qty: 12, status: "confirmed" },
    ];
    expect(blockEntriesWithVenueShift(entries, eventOrders, "2026-11-15")).toEqual([
      { qty: 12, venueName: "Pushpanjali", shift: "Lunch" },
      { qty: 12, venueName: "Pushpanjali", shift: "Dinner" },
    ]);
  });
  it("excludes the caller's own event ids", () => {
    const entries = [{ eventId: "eo_a", date: "2026-11-15", qty: 12, status: "confirmed" }];
    expect(blockEntriesWithVenueShift(entries, eventOrders, "2026-11-15", ["eo_a"])).toEqual([]);
  });
  it("a cancelled event's hold never counts (and doesn't error resolving venue/shift)", () => {
    const entries = [{ eventId: "eo_c", date: "2026-11-15", qty: 12, status: "confirmed" }];
    expect(blockEntriesWithVenueShift(entries, eventOrders, "2026-11-15")).toEqual([]);
  });
  it("an event with more than one matching function that date collapses conservatively", () => {
    const entries = [{ eventId: "eo_mixed", date: "2026-11-15", qty: 12, status: "confirmed" }];
    expect(blockEntriesWithVenueShift(entries, eventOrders, "2026-11-15")).toEqual([
      { qty: 12, venueName: "Pushpanjali", shift: "" },
    ]);
  });
  it("released/non-live entries are skipped", () => {
    const entries = [{ eventId: "eo_a", date: "2026-11-15", qty: 12, status: "released" }];
    expect(blockEntriesWithVenueShift(entries, eventOrders, "2026-11-15")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { ledgerPreflightShortfalls } from "./ledgerPreflight.js";

const inv = (id, qty, blocked = 0, name) => ({ id, qty, blocked, name: name || id });
const fn = (fnIdx, fnDate, fnVenue, zones) => ({ fnIdx, fnDate, fnVenue, enabledEls: Object.fromEntries(Object.keys(zones).map((z) => [z, true])), zoneElements: zones });
const row = (invId, qty, extra = {}) => ({ invId, qty, ...extra });

describe("ledgerPreflightShortfalls — same-venue reuse-eligible pair masked by pricing credit", () => {
  it("two same-day, same-venue functions each needing the full item: real ledger need is the max, not zero, and a shortfall against another deal's hold is now caught", () => {
    const fns = [
      fn(0, "2027-05-01", "Aura", { z: [row("chair", 10)] }),
      fn(1, "2027-05-01", "Aura", { z: [row("chair", 10)] }),
    ];
    const inventory = [inv("chair", 10)];
    // another deal already holds 8 on this date
    const blocksDetailByDate = { "2027-05-01": { chair: [{ eventId: "eo_other", qty: 8, status: "confirmed" }] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"] });
    expect(out).toEqual([{ date: "2027-05-01", itemId: "chair", name: "chair", need: 10, free: 2, short: 8 }]);
  });

  it("nothing flagged when the pool genuinely covers the real (maxed) need", () => {
    const fns = [
      fn(0, "2027-05-01", "Aura", { z: [row("chair", 10)] }),
      fn(1, "2027-05-01", "Aura", { z: [row("chair", 10)] }),
    ];
    const inventory = [inv("chair", 10)];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });
});

describe("ledgerPreflightShortfalls — different venues sum instead of collapsing to a max", () => {
  it("same date, two different venues: combined need can exceed the pool even though no single venue alone does", () => {
    const fns = [
      fn(0, "2027-05-01", "Aura", { z: [row("chair", 8)] }),
      fn(1, "2027-05-01", "Restro", { z: [row("chair", 8)] }),
    ];
    const inventory = [inv("chair", 12)];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([{ date: "2027-05-01", itemId: "chair", name: "chair", need: 16, free: 12, short: 4 }]);
  });
});

describe("ledgerPreflightShortfalls — own reservation nets out", () => {
  it("a re-confirm of an already-sold deal does not see its own prior hold as competing demand", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("chair", 10)] })];
    const inventory = [inv("chair", 10)];
    const blocksDetailByDate = { "2027-05-01": { chair: [{ eventId: "eo_mine", qty: 10, status: "confirmed" }] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"] });
    expect(out).toEqual([]);
  });
});

describe("ledgerPreflightShortfalls — exclusions", () => {
  it("a FOC element never competes for stock", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("chair", 10, { foc: true })] })];
    const inventory = [inv("chair", 0)];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });

  it("a disabled zone never competes for stock", () => {
    const fns = [{ fnIdx: 0, fnDate: "2027-05-01", fnVenue: "Aura", enabledEls: { z: false }, zoneElements: { z: [row("chair", 10)] } }];
    const inventory = [inv("chair", 0)];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });

  it("a pattern/mandi element (no invId) is never flagged here", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [{ patternId: "p1", qty: 10 }] })];
    const out = ledgerPreflightShortfalls({ fns, inventory: [], blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });
});

// Second regression review, 2026-11-14: the gate must never be STRICTER than apply_block_ops' own
// write — three cases where the first version over-blocked a booking the RPC would have accepted.
describe("ledgerPreflightShortfalls — never stricter than apply_block_ops itself (findings A/B/C)", () => {
  it("A: a canBeMade item is never flagged — the RPC tracks it as qtyToProduce, never caps it", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("chair", 15)] })];
    const inventory = [{ id: "chair", qty: 10, blocked: 0, name: "chair", canBeMade: true }];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });

  it("A: a zero-owned (made-to-order) item is never flagged either, canBeMade or not", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("chair", 15)] })];
    const inventory = [inv("chair", 0)];
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });

  it("B: an invId not in inventory (catalogue-deleted) is never flagged — nothing real to check", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("ghost-item", 10)] })];
    const out = ledgerPreflightShortfalls({ fns, inventory: [], blocksDetailByDate: {}, ownEventIds: [] });
    expect(out).toEqual([]);
  });

  it("C: this deal's own existing hold floors the free pool — an unrelated force-block elsewhere must not shrink it", () => {
    const fns = [fn(0, "2027-05-01", "Aura", { z: [row("chair", 10)] })]; // unchanged from what's already held
    const inventory = [inv("chair", 10)];
    // own hold is 10, but a DIFFERENT event force-blocked 4 past real capacity (owned-others would be negative)
    const blocksDetailByDate = { "2027-05-01": { chair: [{ eventId: "eo_mine", qty: 10, status: "confirmed" }, { eventId: "eo_force", qty: 4, status: "confirmed" }] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"] });
    expect(out).toEqual([]);
  });
});

// Regression review, 2026-11-15, finding 4: with eventOrders/settings passed, this gate must use the
// SAME Fixed Venue shift-pair sharing rule apply_block_ops' own write (migration 067) applies — or a
// Sold confirm gets wrongly blocked for a booking the RPC would actually grant in full.
describe("ledgerPreflightShortfalls — Fixed Venue shift-pair sharing parity with apply_block_ops (finding 4)", () => {
  const settings = { fixedVenues: [{ id: "fv_push", name: "Pushpanjali", items: [{ invId: "chair", qty: 12 }] }] };
  const eventOrders = [
    { id: "eo_np", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Lunch" }] },
  ];

  it("a day-shift hold at the SAME Fixed Venue is credited, not flagged as competing demand", () => {
    // This deal's own Dinner function at Pushpanjali needs 12; another deal (eo_np) already holds
    // 12 there for Lunch — without the sharing rule this reads as 12 need vs 0 free (short 12); with
    // it, the two share the same 12 standing units and nothing is short. fnShift must be set on this
    // deal's OWN function too — the free zone only ever applies when THIS deal's own shift is a safe,
    // recognized pairing (see sharingFreeZone's own header).
    const fns = [{ ...fn(0, "2027-05-01", "Pushpanjali", { z: [row("chair", 12)] }), fnShift: "Dinner" }];
    const inventory = [inv("chair", 12)];
    const blocksDetailByDate = { "2027-05-01": { chair: [{ eventId: "eo_np", qty: 12, status: "confirmed" }] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"], eventOrders, settings });
    expect(out).toEqual([]);
  });

  it("without eventOrders/settings (omitted), the exact same scenario still flags short — old behavior preserved for every existing caller", () => {
    const fns = [{ ...fn(0, "2027-05-01", "Pushpanjali", { z: [row("chair", 12)] }), fnShift: "Dinner" }];
    const inventory = [inv("chair", 12)];
    const blocksDetailByDate = { "2027-05-01": { chair: [{ eventId: "eo_np", qty: 12, status: "confirmed" }] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"] });
    expect(out).toEqual([{ date: "2027-05-01", itemId: "chair", name: "chair", need: 12, free: 0, short: 12 }]);
  });

  it("the day group is already over standing qty, but this deal's own Dinner still costs nothing extra (finding M3: the free zone is unconditional slack, not netted into an already-negative pool)", () => {
    const eventOrdersTwoLunch = [
      { id: "eo_np", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Lunch" }] },
      { id: "eo_other_lunch", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Morning" }] },
    ];
    const fns = [{ ...fn(0, "2027-05-01", "Pushpanjali", { z: [row("chair", 12)] }), fnShift: "Dinner" }]; // this deal's own Dinner need
    const inventory = [inv("chair", 12)];
    const blocksDetailByDate = { "2027-05-01": { chair: [
      { eventId: "eo_np", qty: 12, status: "confirmed" },
      { eventId: "eo_other_lunch", qty: 6, status: "confirmed" },
    ] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"], eventOrders: eventOrdersTwoLunch, settings });
    // others: day total 12+6=18 (same group, sums — two Lunch/Morning functions can't share with each
    // other), night total 0, standing 12 -> othersTotal = 18+0-min(18,0,12) = 18 (already over the 12
    // owned — the OTHER deals' own over-commitment, not this one's doing). Free zone (own = night):
    // min(opposite=18, standing=12) - same(0) = 12 — fully unconditional, so free =
    // max(max(12-18,0)+12, 0, 0) = 12. need 12 <= free 12 -> nothing short. (The old, wrong formula —
    // owned - (othersTotal - freeZone) = 12 - 6 = 6 — would have wrongly flagged this deal's own
    // Dinner as short 6, blaming it for a shortfall that's entirely the OTHER two Lunch-side deals'
    // own over-commitment, which this Dinner function never touches.)
    expect(out).toEqual([]);
  });

  it("this deal's own Dinner request bigger than the free zone is short only for the genuine excess", () => {
    const eventOrdersTwoLunch = [
      { id: "eo_np", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Lunch" }] },
      { id: "eo_other_lunch", venue: "Pushpanjali", functionsDetail: [{ date: "2027-05-01", venue: "Pushpanjali", shift: "Morning" }] },
    ];
    const fns = [{ ...fn(0, "2027-05-01", "Pushpanjali", { z: [row("chair", 20)] }), fnShift: "Dinner" }]; // needs 20, not 12
    const inventory = [inv("chair", 12)];
    const blocksDetailByDate = { "2027-05-01": { chair: [
      { eventId: "eo_np", qty: 12, status: "confirmed" },
      { eventId: "eo_other_lunch", qty: 6, status: "confirmed" },
    ] } };
    const out = ledgerPreflightShortfalls({ fns, inventory, blocksDetailByDate, ownEventIds: ["eo_mine"], eventOrders: eventOrdersTwoLunch, settings });
    // Same othersTotal (18) and free zone (12) as above; free = max(max(12-18,0)+12,0,0) = 12.
    // need 20 > free 12 -> short 8 (the genuine amount beyond what the free zone covers).
    expect(out).toEqual([{ date: "2027-05-01", itemId: "chair", name: "chair", need: 20, free: 12, short: 8 }]);
  });
});

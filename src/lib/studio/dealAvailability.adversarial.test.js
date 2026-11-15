// Adversarial test matrix for inventory blocking/availability, designed by an Opus planning pass
// (2026-11-15) hunting for failure/crack points in the logic this session's rounds of fixes touched.
// Section A = single-dimension baselines (must pass). Section B = combination cases most likely to
// expose a real crack. Section C = regressions for bugs already fixed this session this run must
// still confirm fixed. Every expected value here was independently re-derived from the CURRENT code
// (not copied from the design agent's predictions) by tracing the actual exported functions.
import { describe, it, expect } from "vitest";
import {
  zoneIsOff,
  qtyUsedElsewhereInBuild,
  allocateRowAvailability,
  maxQtyForRow,
  netOwnReservedBlocksLive,
  kitPartShortfalls,
  fnUnitQty,
} from "./dealAvailability.js";
import { walkKitUnits } from "../ims/helpers.js";
import { venueKey, fnVenueKey } from "../venueKey.js";
import { combineAvailability, fixedVenueFor } from "../ims/fixedVenues.js";
import {
  combinedFixedVenueRequirement,
  shiftGroupOf,
  collapseVenueShift,
  getSharingAwareAvailable,
} from "../ims/fixedVenueSharing.js";
import { reqByDateFrom, planStudioBlocks, planToOps } from "./soldBlocksPlan.js";
import { computeFnInvQty } from "./crossFnReuse.js";

const inv = (over) => ({ id: "I", name: "Item", qty: 10, subCat: "Pot", ...over });

describe("A. Single-dimension baselines", () => {
  it("A1 zoneIsOff truth table", () => {
    expect(zoneIsOff({ enabledEls: undefined }, "stage")).toBe(false);
    expect(zoneIsOff({ enabledEls: {} }, "stage")).toBe(false);
    expect(zoneIsOff({ enabledEls: { stage: true } }, "stage")).toBe(false);
    expect(zoneIsOff({ enabledEls: { entry: true } }, "stage")).toBe(true);
    expect(zoneIsOff({ enabledEls: { stage: false, entry: true } }, "stage")).toBe(true);
  });

  it("A2 walkKitUnits node quantities", () => {
    const P = { id: "P" };
    const visits = [];
    const visit = (node, qty) => visits.push([node.id, qty]);

    // Plain item
    visits.length = 0;
    walkKitUnits(P, 3, [P], undefined, visit);
    expect(visits).toEqual([["P", 3]]);

    // Kit K{P x2}, qty 3 -> K 3, P 6
    const K = { id: "K", subItems: [{ itemId: "P", qty: 2 }] };
    visits.length = 0;
    walkKitUnits(K, 3, [K, P], undefined, visit);
    expect(visits).toEqual([["K", 3], ["P", 6]]);

    // Nested: O{P x1, N x2}, N{P x3}, O qty 2 -> O2, P2, N4, P12 (P total 14)
    const N = { id: "N", subItems: [{ itemId: "P", qty: 3 }] };
    const O = { id: "O", subItems: [{ itemId: "P", qty: 1 }, { itemId: "N", qty: 2 }] };
    visits.length = 0;
    walkKitUnits(O, 2, [O, N, P], undefined, visit);
    expect(visits).toEqual([["O", 2], ["P", 2], ["N", 4], ["P", 12]]);
    const pTotal = visits.filter((v) => v[0] === "P").reduce((s, v) => s + v[1], 0);
    expect(pTotal).toBe(14);

    // Fractional per-kit qty: K2{P x 15/11}, qty 11 -> P exactly 15
    const K2 = { id: "K2", subItems: [{ itemId: "P", qty: 15 / 11 }] };
    visits.length = 0;
    walkKitUnits(K2, 11, [K2, P], undefined, visit);
    expect(visits[1][1]).toBe(15);

    // Same per-kit qty, qty 7 -> P 9.545455 (rounded to 6dp per round6)
    visits.length = 0;
    walkKitUnits(K2, 7, [K2, P], undefined, visit);
    expect(visits[1][1]).toBeCloseTo(9.545455, 6);

    // subOverrides replaces N's recipe for that parent only
    const P2 = { id: "P2" };
    const Ooverride = { id: "O2", subItems: [{ itemId: "N", qty: 1, subOverrides: [{ itemId: "P2", qty: 5 }] }] };
    visits.length = 0;
    walkKitUnits(Ooverride, 1, [Ooverride, N, P, P2], undefined, visit);
    expect(visits).toEqual([["O2", 1], ["N", 1], ["P2", 5]]);

    // patternId component never visited
    const Krecipe = { id: "K3", subItems: [{ patternId: "pat1", itemId: "P", qty: 2 }] };
    visits.length = 0;
    walkKitUnits(Krecipe, 1, [Krecipe, P], undefined, visit);
    expect(visits).toEqual([["K3", 1]]);
  });

  it("A3 qtyUsedElsewhereInBuild scoping", () => {
    const CHAIR = { id: "CHAIR" };
    const D = "2026-12-10";
    const fns = [
      { fnIdx: 0, fnDate: D, fnVenue: "Pushpanjali", enabledEls: { stage: true }, zoneElements: { stage: [{ invId: "CHAIR", qty: 10 }, { invId: "CHAIR", qty: 4, foc: true }] } },
      { fnIdx: 1, fnDate: D, fnVenue: "Exotica", enabledEls: { lawn: true }, zoneElements: { lawn: [{ invId: "CHAIR", qty: 6 }] } },
      { fnIdx: 2, fnDate: "2026-12-11", fnVenue: "Pushpanjali", enabledEls: { stage: true }, zoneElements: { stage: [{ invId: "CHAIR", qty: 8 }] } },
    ];
    const inventory = [CHAIR];
    expect(qtyUsedElsewhereInBuild("CHAIR", fns, inventory, {}, D)).toBe(16);
    expect(qtyUsedElsewhereInBuild("CHAIR", fns, inventory, {}, D, "Pushpanjali")).toBe(10);
    expect(qtyUsedElsewhereInBuild("CHAIR", fns, inventory, { fnIdx: 0, zoneKey: "stage" }, D)).toBe(6);
    const fnsStageOff = [{ ...fns[0], enabledEls: { lawn: true } }, fns[1], fns[2]];
    expect(qtyUsedElsewhereInBuild("CHAIR", fnsStageOff, inventory, {}, D)).toBe(6);
  });

  it("A4 allocateRowAvailability, smallest first", () => {
    const D = "2026-12-10", V = "Pushpanjali";
    const fns = [{ fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: { A: true, B: true }, zoneElements: { A: [{ invId: "I", qty: 2 }], B: [{ invId: "I", qty: 1 }] } }];
    const inventory = [{ id: "I" }];
    expect(allocateRowAvailability("I", fns, inventory, { fnIdx: 0, zoneKey: "B", elIdx: 0 }, D, 1, V)).toEqual({ ownedQty: 1, shortQty: 0 });
    expect(allocateRowAvailability("I", fns, inventory, { fnIdx: 0, zoneKey: "A", elIdx: 0 }, D, 1, V)).toEqual({ ownedQty: 0, shortQty: 2 });

    const fns2 = [{ fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: { A: true, B: true }, zoneElements: { A: [{ invId: "I", qty: 3 }], B: [{ invId: "I", qty: 3 }] } }];
    expect(allocateRowAvailability("I", fns2, inventory, { fnIdx: 0, zoneKey: "A", elIdx: 0 }, D, 4, V)).toEqual({ ownedQty: 3, shortQty: 0 });
    expect(allocateRowAvailability("I", fns2, inventory, { fnIdx: 0, zoneKey: "B", elIdx: 0 }, D, 4, V)).toEqual({ ownedQty: 1, shortQty: 2 });
  });

  it("A5 maxQtyForRow", () => {
    const D = "2026-12-10", V = "Pushpanjali", W = "Exotica";
    const fns = [
      { fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: { A: true }, zoneElements: { A: [{ invId: "I", qty: 3 }] } },
      { fnIdx: 1, fnDate: D, fnVenue: V, enabledEls: { B: true }, zoneElements: { B: [{ invId: "I", qty: 5 }] } },
    ];
    const inventory = [{ id: "I" }];
    expect(maxQtyForRow("I", fns, inventory, { fnIdx: 1, zoneKey: "B", elIdx: 0 }, D, 10, V, false)).toBe(7);
    expect(maxQtyForRow("I", fns, inventory, { fnIdx: 1, zoneKey: "B", elIdx: 0 }, D, 10, V, true)).toBe(10);
    const fnsOtherVenue = [fns[0], { ...fns[1], fnVenue: W }];
    expect(maxQtyForRow("I", fnsOtherVenue, inventory, { fnIdx: 1, zoneKey: "B", elIdx: 0 }, D, 10, W, false)).toBe(7);
    expect(maxQtyForRow("I", fnsOtherVenue, inventory, { fnIdx: 1, zoneKey: "B", elIdx: 0 }, D, 10, W, true)).toBe(7);
  });

  it("A6 reqByDateFrom", () => {
    const D = "2026-12-10";
    const fns1 = [{ fnIdx: 0, fnDate: D, fnVenue: "P" }, { fnIdx: 1, fnDate: D, fnVenue: "P" }];
    expect(reqByDateFrom(fns1, { 0: { I: 10 }, 1: { I: 12 } })).toEqual({ [D]: { I: 12 } });

    const fns2 = [{ fnIdx: 0, fnDate: D, fnVenue: "P" }, { fnIdx: 1, fnDate: D, fnVenue: "Q" }];
    expect(reqByDateFrom(fns2, { 0: { I: 10 }, 1: { I: 12 } })).toEqual({ [D]: { I: 22 } });

    const fns3 = [{ fnIdx: 0, fnDate: D, fnVenue: "P" }, { fnIdx: 1, fnDate: D, fnVenue: "" }];
    expect(reqByDateFrom(fns3, { 0: { I: 10 }, 1: { I: 12 } })).toEqual({ [D]: { I: 12 } });

    const fns4 = [{ fnIdx: 0, fnDate: "", fnVenue: "P" }];
    expect(reqByDateFrom(fns4, { 0: { I: 10 } })).toEqual({});
  });

  it("A7 netOwnReservedBlocksLive", () => {
    const fnBlocks = { I: 12 };
    const detail = { I: [{ eventId: "Y", qty: 8 }, { eventId: "Z", qty: 4 }] };
    expect(netOwnReservedBlocksLive(fnBlocks, "I", detail, "Y")).toEqual({ I: 4 });
    expect(netOwnReservedBlocksLive(fnBlocks, "I", detail, ["Y", "Y2"])).toEqual({ I: 4 });
    expect(netOwnReservedBlocksLive(fnBlocks, "I", detail, null)).toBe(fnBlocks); // returned by reference
  });

  it("A8 combineAvailability, Emerald Green example", () => {
    expect(combineAvailability(24, 16, 8, 8)).toBe(8);
    expect(combineAvailability(50, 40, 10)).toBe(0);
  });

  it("A9 sharing primitives", () => {
    expect(combinedFixedVenueRequirement(12, 12, 25)).toBe(12);
    expect(combinedFixedVenueRequirement(2, 4, 4)).toBe(4);
    expect(combinedFixedVenueRequirement(10, 20, 10)).toBe(20);
    expect(combinedFixedVenueRequirement(10, 10, 6)).toBe(14);
    expect(shiftGroupOf("Sundowner")).toBe(null);
    expect(shiftGroupOf("Evening")).toBe(null);
    expect(shiftGroupOf("")).toBe(null);
    expect(shiftGroupOf(" LUNCH ")).toBe("day");
    expect(shiftGroupOf("Late Night")).toBe("night");
  });

  it("A10 collapseVenueShift", () => {
    expect(collapseVenueShift([{ venueName: "P", shift: "Lunch" }, { venueName: "P", shift: "Dinner" }])).toEqual({ venueName: "P", shift: "" });
    expect(collapseVenueShift([{ venueName: "P", shift: "Lunch" }, { venueName: "P", shift: "Brunch" }])).toEqual({ venueName: "P", shift: "Brunch" });
    expect(collapseVenueShift([{ venueName: "P", shift: "Lunch" }, { venueName: "P", shift: "Sundowner" }])).toEqual({ venueName: "P", shift: "" });
    expect(collapseVenueShift([{ venueName: "P", shift: "Lunch" }, { venueName: "E", shift: "Lunch" }])).toEqual({ venueName: null, shift: "" });
  });

  it("A11 kitPartShortfalls reusePool drawdown", () => {
    const D = "2026-12-10", V = "Pushpanjali";
    const P = { id: "P", name: "Pot" };
    const KA = { id: "KA", subItems: [{ itemId: "P", qty: 4 }] };
    const KB = { id: "KB", subItems: [{ itemId: "P", qty: 4 }] };
    const fns = [{ fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: {}, zoneElements: {} }];
    const inventory = [KA, KB, P];
    const availFor = () => 0;
    const reusePool = new Map([["P", 4]]);
    const a = kitPartShortfalls(KA, 1, undefined, fns, inventory, null, D, availFor, reusePool, V);
    expect(a).toEqual([]);
    const b = kitPartShortfalls(KB, 1, undefined, fns, inventory, null, D, availFor, reusePool, V);
    expect(b).toEqual([{ id: "P", name: "Pot", need: 4, short: 4 }]);
  });

  it("A12 fnUnitQty", () => {
    const fnData = {
      enabledEls: { z: true },
      zoneElements: { z: [{ invId: "KIT", qty: 2, subItems: undefined }, { invId: "CHAIR", qty: 5, foc: true }] },
    };
    const KIT = { id: "KIT", subItems: [{ itemId: "P", qty: 3 }] };
    const P = { id: "P" };
    const inventory = [KIT, P, { id: "CHAIR" }];
    const m = fnUnitQty(fnData, inventory);
    expect(Object.fromEntries(m)).toEqual({ KIT: 2, P: 6 });
    const mEmpty = fnUnitQty({ enabledEls: {}, zoneElements: { z: [{ invId: "KIT", qty: 2 }] } }, inventory);
    expect(mEmpty.size).toBe(0);
  });
});

describe("B. Combination cases", () => {
  it("B3 dateless extra function vanishes from its own allocation", () => {
    const D = "2026-12-10";
    const fns = [
      { fnIdx: 0, fnDate: D, fnVenue: "Pushpanjali", enabledEls: { stage: true }, zoneElements: { stage: [{ invId: "SOFA", qty: 4 }] } },
      { fnIdx: 1, fnDate: "", fnVenue: "", enabledEls: { lounge: true }, zoneElements: { lounge: [{ invId: "SOFA", qty: 5 }] } },
    ];
    const inventory = [{ id: "SOFA" }];
    // allocateRowAvailability is called by callers with targetDate resolved to the row's OWN fnDate
    // (fn1.fnDate === ""). The function itself does date filtering inside itemRowsFor via targetDate,
    // so calling with targetDate="" reproduces exactly what a caller passing the row's raw fnDate does.
    const result = allocateRowAvailability("SOFA", fns, inventory, { fnIdx: 1, zoneKey: "lounge", elIdx: 0 }, "", 20, "Pushpanjali");
    // competingRows/itemRowsFor filters by (fn.fnDate || "") === targetDate("") -> only fn1 (fnDate "")
    // matches; fn0 (fnDate D) is excluded. So the row's own qty (5) competes against pool 20 alone.
    expect(result).toEqual({ ownedQty: 5, shortQty: 0 });
    // Confirms the matrix's own expectation ONLY when the caller resolves targetDate the same way the
    // row itself does (""), not when it passes clientDate (D) instead, which is the actual bug: calling
    // with the resolved clientDate date instead of the row's real "" fnDate drops the row from
    // itemRowsFor's date filter entirely, since fn1.fnDate ("") !== D.
    const resultWrongDate = allocateRowAvailability("SOFA", fns, inventory, { fnIdx: 1, zoneKey: "lounge", elIdx: 0 }, D, 20, "Pushpanjali");
    expect(resultWrongDate).toEqual({ ownedQty: 0, shortQty: 0 }); // target row is invisible to its own date bucket -> CONFIRMED BUG
  });

  it("B4 plain-row reuse pool is now kit-aware when inventory is passed (fixed, bug 5)", () => {
    const SOFA = { id: "SOFA" };
    const LOUNGE = { id: "LOUNGE", subItems: [{ itemId: "SOFA", qty: 4 }] };
    const fn0 = { fnIdx: 0, fnVenue: "Pushpanjali", fnDate: "2026-12-10", enabledEls: { lounge: true }, zoneElements: { lounge: [{ invId: "LOUNGE", qty: 1 }] } };
    const inventory = [LOUNGE, SOFA];
    // FIXED: computeFnInvQty now walks kit components via walkKitUnits when given the inventory list —
    // the nested SOFA now earns real reuse credit for a sibling function, not just the kit's own id.
    const pool = computeFnInvQty(fn0, inventory);
    expect(pool).toEqual({ LOUNGE: 1, SOFA: 4 });
    // Omitting inventory (every caller this fix didn't reach, if any) keeps the exact old top-level-only
    // behavior — a strict-superset change, never less credit than before.
    const poolNoInv = computeFnInvQty(fn0);
    expect(poolNoInv).toEqual({ LOUNGE: 1 });
    expect(poolNoInv.SOFA).toBeUndefined();
  });

  it("B6 same deal, Lunch at sub-venue vs Dinner at parent — no sharing credit despite same property (current behavior, SPEC)", () => {
    const settings = { fixedVenues: [{ id: "fv1", name: "Exotica", items: [] }], venueParents: { Aura: "Exotica" } };
    const item = inv({ qty: 10 });
    const D = "2026-12-10";
    const eventOrders = [];
    const blocksDetailForDate = {}; // no other entries; only this deal's own two functions hold it
    // fn0 at Aura Lunch holds 10, fn1 at Exotica Dinner needs 10 - test getSharingAwareAvailable for fn1
    // as a THIRD PARTY would see it (no exclude), i.e. "how much is free for someone else" is not what
    // we're testing; we're testing whether fn1's OWN perspective gets credit. Since there are no
    // competing blocks at all here (only the deal's own, not in blocksDetailForDate), the real bug
    // surfaces in reqByDateFrom / ledger preflight (ledger-side), not in getSharingAwareAvailable
    // directly (which only sees blocks, not sibling in-memory functions of the SAME deal). Confirmed by
    // fixedVenueFor itself: Aura and Exotica resolve to the SAME fixed venue object.
    expect(fixedVenueFor(settings, "Aura")).toBe(fixedVenueFor(settings, "Exotica"));
    // reqByDateFrom (the ledger) sums per raw venue string, NOT per resolved Fixed Venue property -
    // this is the actual B6 crack: Aura and Exotica are the same property but different venueKey() strings.
    const fns = [{ fnIdx: 0, fnDate: D, fnVenue: "Aura" }, { fnIdx: 1, fnDate: D, fnVenue: "Exotica" }];
    const req = reqByDateFrom(fns, { 0: { I: 10 }, 1: { I: 10 } });
    expect(req).toEqual({ [D]: { I: 20 } }); // CONFIRMED: ledger treats Aura and Exotica as two separate 10-unit demands, summing to 20, not 10
    void item; void eventOrders; void blocksDetailForDate; void getSharingAwareAvailable;
  });

  it("B9 enabledEls={} (nothing recorded) counts every zone, same-venue and different-venue", () => {
    const D = "2026-12-10";
    const CHAIR = { id: "CHAIR" };
    const fnsDiffVenue = [
      { fnIdx: 0, fnDate: D, fnVenue: "Pushpanjali", enabledEls: {}, zoneElements: { stage: [{ invId: "CHAIR", qty: 30 }] } },
      { fnIdx: 1, fnDate: D, fnVenue: "Emerald Green", enabledEls: { lawn: true }, zoneElements: { lawn: [{ invId: "CHAIR", qty: 30 }] } },
    ];
    const inventory = [CHAIR];
    const used = qtyUsedElsewhereInBuild("CHAIR", fnsDiffVenue, inventory, { fnIdx: 1, zoneKey: "lawn", elIdx: 0 }, D);
    expect(used).toBe(30); // fn0's zone counts despite enabledEls={} (zoneIsOff treats {} as "every zone on")

    const fnsSameVenue = [
      { fnIdx: 0, fnDate: D, fnVenue: "Pushpanjali", enabledEls: {}, zoneElements: { stage: [{ invId: "CHAIR", qty: 30 }] } },
      { fnIdx: 1, fnDate: D, fnVenue: "Pushpanjali", enabledEls: { lawn: true }, zoneElements: { lawn: [{ invId: "CHAIR", qty: 30 }] } },
    ];
    const maxQty = maxQtyForRow("CHAIR", fnsSameVenue, inventory, { fnIdx: 1, zoneKey: "lawn", elIdx: 0 }, D, 40, "Pushpanjali", true);
    // crossFnSiblingsFree=true excludes same-venue sibling function rows entirely -> fn0's 30 does NOT
    // count against fn1's ceiling (reuse-eligible). But computeFnInvQty's own reuse-POOL for fn0's reuse
    // CREDIT (a separate codepath, B4-adjacent) requires enabledEls to be real {zoneKey:true} entries -
    // fn0's enabledEls={} makes computeFnInvQty(fn0) return {} (zero reuse credit pool), a DIFFERENT
    // inconsistency from zoneIsOff's own "every zone on" rule.
    expect(maxQty).toBe(40);
    const reusePoolFromFn0 = computeFnInvQty(fnsSameVenue[0]);
    expect(reusePoolFromFn0).toEqual({}); // CONFIRMED: fn0's own enabledEls={} zeroes its reuse-credit pool even though zoneIsOff treats its zone as on
  });

  it("B12 capped-over hold now re-plans into a real reservation once stock frees up (fixed, bug 3)", () => {
    const now = 123;
    const rowsById = new Map([["I", [{ date: "2026-12-10", eventId: "Y", qty: 5, qtyToProduce: 3, status: "confirmed", source: "studio-incremental" }]]]);
    const cardReq = { "2026-12-10": { I: 8 } };
    const processedDates = new Set(["2026-12-10"]);
    const liveDates = new Set(["2026-12-10"]);
    const plan = planStudioBlocks({ eventId: "Y", rowsById, cardReq, manualReq: {}, focReq: {}, processedDates, liveDates, legacyScopeIds: new Set(["I"]), manualReady: true, freezeCard: false, now });
    expect(plan.changedIds).toEqual(["I"]); // planStudioBlocks DOES detect a change (qtyToProduce dropped from the object)
    const ops = planToOps({ eventId: "Y", rowsById, plan, allowOver: () => true });
    // FIXED: groupBlocksByKey now tracks qtyToProduce separately from the composite total, and
    // planToOps no longer treats a group as "unchanged" just because the composite qty+qtyToProduce
    // total matches — a cur group carrying any qtyToProduce portion is always re-sent, so the RPC gets
    // a chance to re-check current real availability and convert the hold into a real reservation.
    expect(ops).toEqual([{
      item_id: "I", event_id: "Y",
      remove: [{ source: "studio-incremental", date: "2026-12-10" }],
      add: [{ date: "2026-12-10", qty: 8, status: "confirmed", source: "studio-incremental", allowOver: true }],
    }]);
  });

  it("B13 fractional kit parts no longer produce a phantom near-zero shortfall (fixed, bug 4)", () => {
    const D = "2026-12-10", V = "Pushpanjali";
    const P = { id: "P", name: "Pot", canBeMade: false };
    const KA = { id: "KA", subItems: [{ itemId: "P", qty: 1 / 7 }] };
    const KB = { id: "KB", subItems: [{ itemId: "P", qty: 20 / 7 }] };
    const fns = [{ fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: { z: true }, zoneElements: { z: [{ invId: "KA", qty: 8 }, { invId: "KB", qty: 1 }] } }];
    const inventory = [KA, KB, P];
    const result = allocateRowAvailability("P", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 1 }, D, 4, V);
    // KA's P draw = round6(8 * 1/7) = 1.142857; KB's = round6(1 * 20/7) = 2.857143; combined = 4.0000 in
    // walkKitUnits' OWN round6 rounding. allocateRowAvailability now rounds `remaining`/the shortfall to
    // the same 6dp tolerance, so the residue that used to survive plain float subtraction is gone.
    expect(result.ownedQty).toBeCloseTo(2.857143, 5);
    expect(result.shortQty).toBe(0); // FIXED: exactly 0, not a ~1e-15 phantom residue

    // kitPartShortfalls' own `short > 0` push condition now tests the ALREADY-rounded value, so a true
    // zero shortfall never appears in the short-parts list at all (not just a 0 displayed alongside it).
    const availFor = () => 4;
    const parts = kitPartShortfalls(KB, 1, undefined, fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 1 }, D, availFor, null, V);
    expect(parts).toEqual([]); // FIXED: no true shortfall -> no entry at all
  });

  it("B17 shift-sharing cap uses GROSS owned qty while the base ceiling nets item.blocked (current behavior, SPEC)", () => {
    const settings = { fixedVenues: [{ id: "fv1", name: "Pushpanjali", items: [] }] };
    const item = { id: "I", qty: 10, blocked: 6 };
    const eventOrders = [{ id: "EO_A", status: "booked", venue: "Pushpanjali", functionsDetail: [{ fnIdx: 0, date: "2026-12-10", venue: "Pushpanjali", shift: "Lunch" }] }];
    const blocksDetailForDate = { I: [{ eventId: "EO_A", qty: 10, status: "confirmed" }] };
    const avail = getSharingAwareAvailable(item, blocksDetailForDate, eventOrders, settings, "2026-12-10", "Pushpanjali", "Dinner", ["EO_Y"]);
    // Net owned (qty - blocked) = 4, but the sharing cap/freeZone math uses the GROSS qty (10) as
    // `standing`, so freeZone = min(opposite=10, standing=10) - same(0) = 10, giving avail = max(4-10,0)+10 = 10.
    expect(avail).toBe(10); // CONFIRMED (documenting current behavior, not asserting it's correct): over-grants by 6 relative to the physically net 4 units
  });

  it("B22 one venue typed two ways — venueKey itself stays raw-string, but the ledger now collapses them (fixed, bug 6)", () => {
    // venueKey() is deliberately UNCHANGED — it answers a different question ("are these two function
    // rows describing the same physical place, by raw string?") for the bug-8-hardened per-venue
    // allocation code (competingRows/maxQtyForRow), which this fix does not touch.
    expect(venueKey("Pushpanjali")).not.toBe(venueKey("Ambria Pushpanjali."));
    // fixedVenues.js's normVenue DOES strip "Ambria " and trailing punctuation, so the Fixed-Venue
    // config layer resolves both to the same property...
    const settings = { fixedVenues: [{ id: "fv1", name: "Pushpanjali", items: [] }] };
    expect(fixedVenueFor(settings, "Pushpanjali")).toBe(fixedVenueFor(settings, "Ambria Pushpanjali."));
    // ...and now the plain ledger layer (reqByDateFrom) reuses that SAME normVenue, so two functions of
    // one deal typed with the two spellings collapse into the same venue bucket (max, not summed).
    const D = "2026-12-10";
    const fns = [{ fnIdx: 0, fnDate: D, fnVenue: "Pushpanjali" }, { fnIdx: 1, fnDate: D, fnVenue: "Ambria Pushpanjali." }];
    const req = reqByDateFrom(fns, { 0: { I: 10 }, 1: { I: 10 } });
    expect(req).toEqual({ [D]: { I: 10 } }); // FIXED: same property -> max(10,10)=10, no longer summed to 20
  });

  it("B23 kit cycle (A contains B, B contains A) now visits each node exactly once (fixed, bug 7)", () => {
    const visits = [];
    const A = { id: "A", subItems: [{ itemId: "B", qty: 1 }] };
    const B = { id: "B", subItems: [{ itemId: "A", qty: 2 }] };
    walkKitUnits(A, 1, [A, B], undefined, (node, qty) => visits.push([node.id, qty]));
    // FIXED: the cycle guard now checks BEFORE visit() fires for a node, not just before recursing into
    // its children — A's second (cyclic) encounter is skipped entirely instead of being visited once
    // more before the guard catches it a loop later. The top-level call is unaffected (A's own first
    // visit still always fires, per the function's own doc comment).
    expect(visits).toEqual([["A", 1], ["B", 1]]);
    const aTotal = visits.filter((v) => v[0] === "A").reduce((s, v) => s + v[1], 0);
    expect(aTotal).toBe(1); // a naive summing caller now reserves exactly 1 unit of A, not 2 or 3
  });

  it("B24 duplicate catalog rows for the same physical item stay fully separate", () => {
    const D = "2026-12-10", V = "Pushpanjali";
    const S1 = { id: "S1", name: "Ivory 2 Seater Sofa", qty: 3 };
    const S2 = { id: "S2", name: "Ivory 2 Seater Sofa", qty: 3 };
    const fns = [
      { fnIdx: 0, fnDate: D, fnVenue: V, enabledEls: { p: true }, zoneElements: { p: [{ invId: "S1", qty: 3 }] } },
      { fnIdx: 1, fnDate: D, fnVenue: V, enabledEls: { s: true }, zoneElements: { s: [{ invId: "S2", qty: 3 }] } },
    ];
    const inventory = [S1, S2];
    // Nothing in qtyUsedElsewhereInBuild treats S1/S2 as interchangeable (no name-based matching) - each
    // function's own row is judged purely against its own id's blocks, so no reuse credit is shared
    // between the two "same" sofas even though they're the identical physical item line split in two.
    const usedS1 = qtyUsedElsewhereInBuild("S1", fns, inventory, { fnIdx: 0, zoneKey: "p", elIdx: 0 }, D);
    const usedS2 = qtyUsedElsewhereInBuild("S2", fns, inventory, { fnIdx: 1, zoneKey: "s", elIdx: 0 }, D);
    expect(usedS1).toBe(0); // fn1's S2 use is invisible to S1's own tally
    expect(usedS2).toBe(0); // and vice versa -- CONFIRMED: duplicate catalog rows are never reconciled by this layer
  });
});

describe("C. Regressions for bugs already fixed this session (must stay passing)", () => {
  it("C1 picker-equivalent usage uses zoneIsOff, not a bare enabledEls check", () => {
    const D = "2026-12-10";
    const fn = { fnIdx: 0, fnDate: D, fnVenue: "P", enabledEls: undefined, zoneElements: { stage: [{ invId: "CHAIR", qty: 4 }] } };
    const used = qtyUsedElsewhereInBuild("CHAIR", [fn], [{ id: "CHAIR" }], { fnIdx: 0, zoneKey: "other", elIdx: 0 }, D);
    expect(used).toBe(4); // enabledEls undefined (nothing recorded) still counts the zone, per zoneIsOff
  });

  it("C2 FOC rows are skipped from usage tallies", () => {
    const D = "2026-12-10";
    const fn = { fnIdx: 0, fnDate: D, fnVenue: "P", enabledEls: undefined, zoneElements: { stage: [{ invId: "CHAIR", qty: 4, foc: true }] } };
    const used = qtyUsedElsewhereInBuild("CHAIR", [fn], [{ id: "CHAIR" }], { fnIdx: 0, zoneKey: "other", elIdx: 0 }, D);
    expect(used).toBe(0);
  });

  it("C17 nested grandchild is visible to qtyUsedElsewhereInBuild", () => {
    const D = "2026-12-10";
    const P = { id: "P" };
    const N = { id: "N", subItems: [{ itemId: "P", qty: 3 }] };
    const O = { id: "O", subItems: [{ itemId: "N", qty: 2 }] };
    const fn = { fnIdx: 0, fnDate: D, fnVenue: "V", enabledEls: { z: true }, zoneElements: { z: [{ invId: "O", qty: 2 }] } };
    const used = qtyUsedElsewhereInBuild("P", [fn], [O, N, P], { fnIdx: 1, zoneKey: "other", elIdx: 0 }, D);
    expect(used).toBe(12); // O qty2 -> N qty4 -> P qty12
  });

  it("C18/C22 different venues same day do not share one pool (bug 8)", () => {
    const D = "2026-12-10";
    const fns = [
      { fnIdx: 0, fnDate: D, fnVenue: "VenueA", enabledEls: { z: true }, zoneElements: { z: [{ invId: "I", qty: 12 }] } },
      { fnIdx: 1, fnDate: D, fnVenue: "VenueB", enabledEls: { z: true }, zoneElements: { z: [{ invId: "I", qty: 12 }] } },
    ];
    const inventory = [{ id: "I" }];
    const req = reqByDateFrom(fns, { 0: { I: 12 }, 1: { I: 12 } });
    expect(req).toEqual({ [D]: { I: 24 } }); // ledger demands BOTH venues' full 12, not a collapsed max of 12
    const resultA = allocateRowAvailability("I", fns, inventory, { fnIdx: 0, zoneKey: "z", elIdx: 0 }, D, 12, "VenueA");
    expect(resultA.shortQty).toBe(0); // VenueA's own row is unaffected by VenueB's demand (different venue)
  });

  it("C19 findCrossFnReuseSource / computeFnInvQty merge same-venue same-day pool across siblings", () => {
    // Not directly findCrossFnReuseSource (needs allFns with Date-parseable dates and venue match) -
    // test the simpler computeFnInvQty building block two sibling functions' pools combine from.
    const fn0 = { fnVenue: "P", fnDate: "2026-12-10", enabledEls: { a: true }, zoneElements: { a: [{ invId: "SOFA", qty: 4 }] } };
    const fn1 = { fnVenue: "P", fnDate: "2026-12-10", enabledEls: { b: true }, zoneElements: { b: [{ invId: "SOFA", qty: 2 }] } };
    const pool0 = computeFnInvQty(fn0), pool1 = computeFnInvQty(fn1);
    expect((pool0.SOFA || 0) + (pool1.SOFA || 0)).toBe(6);
  });

  it("C20 Emerald Green overlap worked example", () => {
    expect(combineAvailability(24, 16, 8, 8)).toBe(8);
  });

  it("C21 blank extra-function venue buckets with the main function (fnVenueKey)", () => {
    const fns = [{ fnIdx: 0, fnVenue: "Pushpanjali" }, { fnIdx: 1, fnVenue: "" }];
    expect(fnVenueKey(fns[1], fns)).toBe(fnVenueKey(fns[0], fns));
    const req = reqByDateFrom([{ ...fns[0], fnDate: "2026-12-10" }, { ...fns[1], fnDate: "2026-12-10" }], { 0: { I: 10 }, 1: { I: 12 } });
    expect(req).toEqual({ "2026-12-10": { I: 12 } }); // max(10,12), not summed -- blank venue shares the main venue's bucket
  });

  it("C24 kit-part split sums exactly (allocateSplit-equivalent whole+frac check, via walkKitUnits)", () => {
    // allocateSplit itself lives in StudioApp.jsx (EXTRACT) -- this confirms the downstream consumer
    // (walkKitUnits) handles a fractional split allocation's own per-kit qty correctly, which is the
    // part reachable from this lib.
    const total = 7 / 3, n = 2;
    const whole = Math.floor(total), frac = total - whole;
    const base = Math.floor(whole / n), remainder = whole - base * n;
    const allocX = base + (remainder > 0 ? 1 : 0) + frac, allocY = base; // mirrors allocateSplit's own whole+frac-to-first-id shape
    expect(allocX + allocY).toBeCloseTo(total, 10);
    const K = { id: "K" };
    const visits = [];
    walkKitUnits(K, allocX, [K], undefined, (n, q) => visits.push(q));
    walkKitUnits(K, allocY, [K], undefined, (n, q) => visits.push(q));
    const sum = visits.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(total, 6);
  });
});

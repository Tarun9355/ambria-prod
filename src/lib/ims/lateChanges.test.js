import { describe, it, expect } from "vitest";
import { lateChangesOf, lateChargesByDept } from "./lateChanges.js";

// Owner ask 2026-11-27, revised 2026-11-28: Planning's "Changed in the 48 hours before the event" section AND
// Deal Check's P&L tab (deptActual) read the SAME figure, via lateChangesOf / lateChargesByDept.
const sel = { id: "e1", functionsDetail: [{ date: "2026-11-28" }, { date: "2026-11-27" }] }; // first day 27 Nov
const at = (iso) => Date.parse(iso);
const inventory = [
  { id: "T1", name: "Iron Wooden Cocktail Table", price: 400, img: "t.jpg" },
  { id: "C7", name: "Ivory Couple Couch 07", price: 960 },
  { id: "CH", name: "Chair", price: 50 },
  { id: "SK", name: "Stage Kit", price: 5000, kitBase: 2000, subItems: [{ itemId: "P1", qty: 2 }] },
  { id: "P1", name: "Pillar", price: 1500 },
];
const log = (over) => ({ eventOrderId: "e1", department: "Furniture", status: "logged", requestedBy: "Tarun", ...over });

describe("changes in the 48 hours before the event - peak minus now", () => {
  it("a removal inside the window costs its rental (rate x qty held)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:09:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4, to: 0 }] })] });
    expect(r.charges).toEqual([{ kind: "removed", name: "Iron Wooden Cocktail Table", fn: "", qty: 4, from: 4, to: 0, rate: 400, total: 1600, photo: "t.jpg", at: at("2026-11-26T16:09:00"), by: "Tarun", swappedFor: "" }]);
    expect(r.swaps.size).toBe(0);
  });

  it("the window starts 48 hours before the first function's day - older changes are not late", () => {
    const old = log({ requestedAt: at("2026-11-24T23:59:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4 }] });
    const edge = log({ requestedAt: at("2026-11-25T00:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "removed", from: 1 }] });
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [old, edge] });
    expect(r.charges.map((x) => x.name)).toEqual(["Ivory Couple Couch 07"]);
  });

  it("a real swap (change:\"swapped\") is tagged and billed; a later, UNTAGGED add+remove of the same count is NOT inferred as a second swap (regression review, 2026-11-28, finding #4)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "swapped", fromName: "Royal Couch 03" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "added" }, { name: "Grey Couch", change: "removed", from: 1 }] }),
    ] });
    // The only real swap tag is the first row's - it's never overwritten by the second row, because the
    // second row's bare add+remove carries no "swapped" tag of its own and is no longer inferred as one.
    expect(r.swaps.get("Ivory Couple Couch 07")).toMatchObject({ fromName: "Royal Couch 03", by: "Tarun" });
    // Grey Couch bills as a plain removal, not "swapped for Ivory Couple Couch 07" - the two items in that
    // second row have no actual relationship. Ivory Couple Couch 07's own "added" entry bills nothing (an
    // addition alone is never charged).
    expect(r.charges).toEqual([{ kind: "removed", name: "Grey Couch", fn: "", qty: 1, from: 1, to: 0, rate: 0, total: 0, photo: "", at: at("2026-11-26T12:00:00"), by: "Tarun", swappedFor: "" }]);
  });

  it("another department, another event, a not-logged row or no dates: nothing", () => {
    const items = [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4 }];
    const t = at("2026-11-26T16:00:00");
    expect(lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: t, items, department: "Floral" }), log({ requestedAt: t, items, eventOrderId: "e2" }), log({ requestedAt: t, items, status: "pending" })] }).charges).toEqual([]);
    expect(lateChangesOf({ sel: { id: "e1" }, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: t, items })] }).charges).toEqual([]);
  });

  it("an item with no rate set costs nothing (shown as -)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [{ name: "Unknown Prop", change: "removed", from: 2 }] })] });
    expect(r.charges[0]).toMatchObject({ rate: 0, total: 0, qty: 2 });
  });

  it("a quantity cut inside the window bills the cut portion, not the whole item (owner ask 2026-11-28)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [{ name: "Chair", change: "qty_changed", from: 100, to: 60, fn: "Cocktail" }] })] });
    expect(r.charges).toEqual([{ kind: "cut", name: "Chair", fn: "Cocktail", qty: 40, from: 100, to: 60, rate: 50, total: 2000, photo: "", at: at("2026-11-26T16:00:00"), by: "Tarun", swappedFor: "" }]);
  });

  it("a cut later fully restored bills nothing", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Chair", change: "qty_changed", from: 100, to: 60, fn: "Cocktail" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Chair", change: "qty_changed", from: 60, to: 100, fn: "Cocktail" }] }),
    ] });
    expect(r.charges).toEqual([]);
  });

  it("two cuts in a row: billed qty is peak minus now, dated by the newer reducing log", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Chair", change: "qty_changed", from: 100, to: 80, fn: "Cocktail" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Chair", change: "qty_changed", from: 80, to: 60, fn: "Cocktail" }] }),
    ] });
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({ qty: 40, at: at("2026-11-26T12:00:00") });
  });

  it("a partial put-back bills only the net reduction, labelled 'cut' since some is still in the plan", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Chair", change: "removed", from: 4, to: 0, fn: "Cocktail" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Chair", change: "added", from: 0, to: 2, fn: "Cocktail" }] }),
    ] });
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({ kind: "cut", qty: 2 });
  });

  it("a swap (pairSwaps' own shape) bills the swapped-OUT item on top of the swapped-in one (owner ask 2026-11-28)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "swapped", fromName: "Iron Wooden Cocktail Table", from: 4, to: 4, qty: 4, fn: "Cocktail" }] })] });
    expect(r.charges).toEqual([{ kind: "swapped", name: "Iron Wooden Cocktail Table", fn: "Cocktail", qty: 4, from: 4, to: 0, rate: 400, total: 1600, photo: "t.jpg", at: at("2026-11-26T16:00:00"), by: "Tarun", swappedFor: "Ivory Couple Couch 07" }]);
    expect(r.swaps.get("Ivory Couple Couch 07")).toMatchObject({ fromName: "Iron Wooden Cocktail Table" });
  });

  it("a swap-out is cancelled only by that SAME item coming back in the SAME function", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "swapped", fromName: "Iron Wooden Cocktail Table", from: 4, to: 4, fn: "Cocktail" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "added", from: 0, to: 4, fn: "Cocktail" }] }),
    ] });
    expect(r.charges).toEqual([]);
  });

  it("a swap-out is NOT cancelled by an unrelated add of the same item in a DIFFERENT function", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "swapped", fromName: "Iron Wooden Cocktail Table", from: 4, to: 4, fn: "Cocktail" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "added", from: 0, to: 2, fn: "Wedding" }] }),
    ] });
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({ name: "Iron Wooden Cocktail Table", total: 1600 });
  });

  it("a removed or cut kit prices at its own kitBase, since its parts are logged and billed on their own lines", () => {
    const removedKit = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [
      { name: "Stage Kit", change: "removed", from: 1, to: 0, fn: "Cocktail" },
      { name: "Pillar", change: "removed", from: 2, to: 0, fn: "Cocktail" },
    ] })] });
    expect(removedKit.charges.map((c) => c.total).sort((a, b) => a - b)).toEqual([2000, 3000]);

    const cutKit = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [{ name: "Stage Kit", change: "qty_changed", from: 3, to: 1, fn: "Cocktail" }] })] });
    expect(cutKit.charges[0].total).toBe(2 * 2000);
  });

  it("a stock-recount request, and a kitOf cross-department copy of a part, are both skipped - never billed", () => {
    const recount = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), requestedBy: "System (stock re-count)", items: [{ name: "Pillar (part of Stage Kit)", change: "qty_changed", from: 2, to: 2, fn: "Cocktail" }] })] });
    expect(recount.charges).toEqual([]);
    const kitOfLine = lateChangesOf({ sel, dept: "Floral", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), department: "Floral", items: [{ name: "Pillar (in Stage Kit)", change: "removed", from: 2, to: 0, fn: "Cocktail", kitOf: "Stage Kit" }] })] });
    expect(kitOfLine.charges).toEqual([]);
  });

  it("an added item and a removed item in the SAME request, with no \"swapped\" tag of their own, are two independent changes, not an inferred swap (regression review, 2026-11-28, finding #4 - every 'logged' request is already pairSwaps-processed at write time, so a real swap always already carries change:\"swapped\"; a bare add+remove with no such tag is exactly the pair pairSwaps itself declined to merge, e.g. different sub-categories)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [
      { name: "Ivory Couple Couch 07", change: "added", from: 0, to: 1, fn: "Cocktail" },
      { name: "Iron Wooden Cocktail Table", change: "removed", from: 4, to: 0, fn: "Cocktail" },
      { name: "Chair", change: "qty_changed", from: 10, to: 6, fn: "Cocktail" },
    ] })] });
    const byName = Object.fromEntries(r.charges.map((c) => [c.name, c]));
    expect(byName["Iron Wooden Cocktail Table"]).toMatchObject({ kind: "removed", total: 1600, swappedFor: "" });
    expect(byName["Ivory Couple Couch 07"]).toBeUndefined(); // an addition alone is never billed
    expect(byName["Chair"]).toMatchObject({ kind: "cut", total: 200 });
  });
});

describe("lateChargesByDept - per-department totals for Deal Check's P&L", () => {
  it("no event id, or no logged rows for this event: nothing", () => {
    expect(lateChargesByDept({ sel: { functionsDetail: sel.functionsDetail }, depts: ["Furniture"], amendRequests: [], inventory })).toEqual({});
    expect(lateChargesByDept({ sel, depts: ["Furniture"], amendRequests: [], inventory })).toEqual({});
  });
  it("one entry per department that has a charge; a department with none is absent", () => {
    const reqs = [
      log({ requestedAt: Date.parse("2026-11-26T16:00:00"), department: "Furniture", items: [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4, to: 0 }] }),
      log({ requestedAt: Date.parse("2026-11-26T16:00:00"), department: "Floral", items: [{ name: "Chair", change: "qty_changed", from: 10, to: 6 }] }),
    ];
    const byDept = lateChargesByDept({ sel, depts: ["Furniture", "Floral", "Structure"], amendRequests: reqs, inventory });
    expect(byDept.Furniture.total).toBe(1600);
    expect(byDept.Floral.total).toBe(200);
    expect(byDept.Structure).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { planFabricAutoPOs, duePOsForCredit, stuckCrediting, fabricPoId, isFabricAutoPO, fabricPOTarget } from "./fabricAutoPurchase.js";
import { fabricDemandByDate, fabricStockIndex, colourKey } from "./fabricShortfall.js";

const today = "2026-12-01";
const trussInv = { lizaStock: [{ colour: "Rose Gold dark", stockKg: 100, stockKgNew: 0 }] };
const need = {
  eo1: { liza: [{ colour: "Rose Gold dark", qty: 90, qtyOld: 90, qtyNew: 0 }] },
  eo2: { liza: [{ colour: "Rose Gold dark", qty: 80, qtyOld: 80, qtyNew: 0 }] },
};
const eventOrders = [
  { id: "eo1", clientName: "Amit", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] },
  { id: "eo2", clientName: "Priya", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] },
];
const needOf = (eo) => need[eo.id] || {};
const planOnce = (purchase, eo = eventOrders, no = needOf) => {
  const { demand } = fabricDemandByDate({ eventOrders: eo, needOf: no, today });
  return planFabricAutoPOs({ demand, stockIdx: fabricStockIndex(trussInv), purchase, eventOrders: eo, today });
};

describe("planFabricAutoPOs — raise/resize/cancel, idempotent, never double-books cover", () => {
  it("raises exactly one PO for the real combined shortfall (170 needed, 100 in stock -> 70 short)", () => {
    const { creates, updates } = planOnce([]);
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(creates[0]).toMatchObject({ id: fabricPoId("liza", colourKey("Rose Gold dark"), "old", "2026-12-05"), qty: 70, status: "Open" });
    expect(isFabricAutoPO(creates[0])).toBe(true);
  });
  it("re-running with that same PO already Open changes nothing (idempotent, no duplicate)", () => {
    const po = planOnce([]).creates[0];
    expect(planOnce([po])).toEqual({ creates: [], updates: [] });
  });
  it("a later date's demand is covered by an earlier date's already-raised PO (no second PO needed)", () => {
    const eo = [
      { id: "eoA", clientName: "A", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] },
      { id: "eoB", clientName: "B", status: "blocked", functionsDetail: [{ date: "2026-12-10" }] },
    ];
    const n = { eoA: { liza: [{ colour: "Rose Gold dark", qty: 90, qtyOld: 90, qtyNew: 0 }] }, eoB: { liza: [{ colour: "Rose Gold dark", qty: 30, qtyOld: 30, qtyNew: 0 }] } };
    const stockIdx = fabricStockIndex({ lizaStock: [{ colour: "Rose Gold dark", stockKg: 50, stockKgNew: 0 }] }); // short 40 on the 5th
    const { demand } = fabricDemandByDate({ eventOrders: eo, needOf: (x) => n[x.id] || {}, today });
    const { creates } = planFabricAutoPOs({ demand, stockIdx, purchase: [], eventOrders: eo, today });
    expect(creates).toHaveLength(1); // the 40kg bought for the 5th already covers the 10th's 30kg need
    expect(creates[0].fabric.needDate).toBe("2026-12-05");
    expect(creates[0].qty).toBe(40);
  });
  it("splits a tier-mixed demand into a separate New and Old PO", () => {
    const eo = [{ id: "eoT", clientName: "T", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const n = { eoT: { liza: [{ colour: "Tealish", qty: 20, qtyOld: 8, qtyNew: 12 }] } };
    const stockIdx = fabricStockIndex({ lizaStock: [{ colour: "Tealish", stockKg: 5, stockKgNew: 8 }] });
    const { demand } = fabricDemandByDate({ eventOrders: eo, needOf: (x) => n[x.id] || {}, today });
    const { creates } = planFabricAutoPOs({ demand, stockIdx, purchase: [], eventOrders: eo, today });
    expect(Object.fromEntries(creates.map((c) => [c.fabric.tier, c.qty]))).toEqual({ new: 4, old: 3 });
  });
  it("resizes an Open PO up when demand grows, and cancels it (system) when the need drops to 0", () => {
    const po = planOnce([]).creates[0];
    const grown = { eo1: need.eo1, eo2: { liza: [{ colour: "Rose Gold dark", qty: 120, qtyOld: 120, qtyNew: 0 }] } };
    const up = planOnce([po], eventOrders, (eo) => grown[eo.id] || {});
    expect(up.updates[0]).toMatchObject({ qty: 110 });

    const cancelledOrders = [eventOrders[0], { ...eventOrders[1], status: "cancelled" }];
    const down = planOnce([po], cancelledOrders);
    expect(down.updates[0]).toMatchObject({ status: "Cancelled", cancelled: { by: "system" } });
  });
  it("reopens a SYSTEM-cancelled PO when the need returns, under the same id", () => {
    const po = planOnce([]).creates[0];
    const systemCancelled = { ...po, status: "Cancelled", cancelled: { at: Date.now(), by: "system", reason: "need gone" } };
    const r = planOnce([systemCancelled]);
    expect(r.creates).toHaveLength(0);
    expect(r.updates[0]).toMatchObject({ id: po.id, status: "Open" });
  });
  it("NEVER reopens or recreates a PO a PERSON cancelled, even once the need returns", () => {
    const po = planOnce([]).creates[0];
    const personCancelled = { ...po, status: "Cancelled", cancelled: { at: Date.now(), by: "Tarun", reason: "not needed" } };
    const r = planOnce([personCancelled]);
    expect(r.creates).toHaveLength(0);
    expect(r.updates).toHaveLength(0);
  });
  it("never resizes, cancels, or double-raises a billed PO, and its billed qty still counts as real cover", () => {
    const po = planOnce([]).creates[0];
    const billed = { ...po, billed: { actualQty: 70, actualCost: 12000, vendor: "ABC Textiles", by: "Tarun", at: Date.now() } };
    const grown = { eo1: need.eo1, eo2: { liza: [{ colour: "Rose Gold dark", qty: 200, qtyOld: 200, qtyNew: 0 }] } };
    const r = planOnce([billed], eventOrders, (eo) => grown[eo.id] || {});
    expect([...r.creates, ...r.updates].find((p) => p.id === billed.id)).toBeUndefined();
  });
  // Regression, 2026-11-28, critical finding #2a: fabricDemandByDate is forward-looking-only (same as Dept
  // Ops' own display), so a single-day event drops OUT of demand entirely the moment its date is no longer
  // "today or later", and a multi-day event drops out the moment its FIRST day does (eoDate is the first
  // function only) - well before the credit pass (gated on the LAST function date) is due to run. The old
  // cancel-sweep treated "not in demand" as "need gone" and cancelled every auto-PO the day after its
  // event, before it could ever be credited. These two tests pin the fix directly at the planner level (the
  // hook's own snapshot-ordering half of the same finding, #2b - crediting before planning in the SAME
  // pass off a freshly-folded list rather than the stale pre-credit snapshot - lives entirely in
  // useFabricAutoPurchase's `runPass` and isn't unit-testable here: no Supabase/React harness in this
  // sandbox; verified by direct code reading instead).
  it("does NOT cancel an Open PO just because its (still-live) event's date has already passed", () => {
    const po = planOnce([]).creates[0]; // Open PO backing eo1+eo2, both due 2026-12-05
    const laterToday = "2026-12-06"; // the day after - both events have now dropped out of forward demand
    const { demand } = fabricDemandByDate({ eventOrders, needOf, today: laterToday });
    const { creates, updates } = planFabricAutoPOs({ demand, stockIdx: fabricStockIndex(trussInv), purchase: [po], eventOrders, today: laterToday });
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(0); // left exactly as-is - duePOsForCredit (tested below) is what acts on it now
  });
  it("DOES cancel it once its backing events are actually dead (cancelled/un-booked), not merely past their date", () => {
    const po = planOnce([]).creates[0];
    const deadEvents = eventOrders.map((eo) => ({ ...eo, status: "cancelled" }));
    const laterToday = "2026-12-06";
    const { demand } = fabricDemandByDate({ eventOrders: deadEvents, needOf, today: laterToday });
    const { updates } = planFabricAutoPOs({ demand, stockIdx: fabricStockIndex(trussInv), purchase: [po], eventOrders: deadEvents, today: laterToday });
    expect(updates[0]).toMatchObject({ status: "Cancelled", cancelled: { by: "system" } });
  });
  it("a multi-day event's PO survives untouched every day between its first and last date, not just the day right after its first", () => {
    const multiDay = [{ id: "eoM", clientName: "Multi", status: "blocked", functionsDetail: [{ date: "2026-12-05" }, { date: "2026-12-07" }] }];
    const n = { eoM: { liza: [{ colour: "Rose Gold dark", qty: 90, qtyOld: 90, qtyNew: 0 }] } };
    const noOf = (eo) => n[eo.id] || {};
    const { demand: demandAtRaise } = fabricDemandByDate({ eventOrders: multiDay, needOf: noOf, today: "2026-12-01" });
    const poM = planFabricAutoPOs({ demand: demandAtRaise, stockIdx: fabricStockIndex(trussInv), purchase: [], eventOrders: multiDay, needOf: noOf, today: "2026-12-01" }).creates[0];
    for (const d of ["2026-12-05", "2026-12-06", "2026-12-07"]) { // first day, a day in the middle (already out of demand), and the last day
      const { demand } = fabricDemandByDate({ eventOrders: multiDay, needOf: noOf, today: d });
      const { updates } = planFabricAutoPOs({ demand, stockIdx: fabricStockIndex(trussInv), purchase: [poM], eventOrders: multiDay, needOf: noOf, today: d });
      expect(updates, `must stay untouched on ${d}`).toHaveLength(0);
    }
  });
  // Regression, 2026-11-28, round-2 finding #2: round 1's first fix for critical finding #2 checked only
  // "is any backing event still live", with no check on whether that event is still on the SAME date or
  // still needs the SAME colour. That over-protected a stale PO in exactly these three ways - each one left
  // the old slot sitting Open forever, later credited as phantom stock nobody bought.
  it("cancels a stale PO when its sole event's DATE MOVES away from the PO's needDate", () => {
    const eo = [{ id: "eoD", clientName: "D", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const n = { eoD: { liza: [{ colour: "Dated Red", qty: 50, qtyOld: 50, qtyNew: 0 }] } };
    const noOf = (x) => n[x.id] || {};
    const stockIdx = fabricStockIndex({});
    const { demand: d1 } = fabricDemandByDate({ eventOrders: eo, needOf: noOf, today: "2026-12-01" });
    const po = planFabricAutoPOs({ demand: d1, stockIdx, purchase: [], eventOrders: eo, needOf: noOf, today: "2026-12-01" }).creates[0];
    const moved = [{ ...eo[0], functionsDetail: [{ date: "2026-12-20" }] }]; // same event, same colour, NEW date
    const { demand: d2 } = fabricDemandByDate({ eventOrders: moved, needOf: noOf, today: "2026-12-06" });
    const r = planFabricAutoPOs({ demand: d2, stockIdx, purchase: [po], eventOrders: moved, needOf: noOf, today: "2026-12-06" });
    expect(r.updates.find((u) => u.id === po.id)).toMatchObject({ status: "Cancelled", cancelled: { by: "system" } });
    expect(r.creates).toHaveLength(1); // a fresh PO for the new date instead
    expect(r.creates[0]).toMatchObject({ fabric: { needDate: "2026-12-20" } });
  });
  it("cancels a stale PO when the deal's picked COLOUR CHANGES, even though the event stays on the same date", () => {
    const eo = [{ id: "eoC", clientName: "C", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const stockIdx = fabricStockIndex({});
    const noOfScarlet = (x) => (x.id === "eoC" ? { liza: [{ colour: "Scarlet", qty: 40, qtyOld: 40, qtyNew: 0 }] } : {});
    const { demand: d1 } = fabricDemandByDate({ eventOrders: eo, needOf: noOfScarlet, today: "2026-12-01" });
    const po = planFabricAutoPOs({ demand: d1, stockIdx, purchase: [], eventOrders: eo, needOf: noOfScarlet, today: "2026-12-01" }).creates[0];
    const noOfCobalt = (x) => (x.id === "eoC" ? { liza: [{ colour: "Cobalt", qty: 40, qtyOld: 40, qtyNew: 0 }] } : {}); // same event, same date, different colour
    const { demand: d2 } = fabricDemandByDate({ eventOrders: eo, needOf: noOfCobalt, today: "2026-12-06" });
    const r = planFabricAutoPOs({ demand: d2, stockIdx, purchase: [po], eventOrders: eo, needOf: noOfCobalt, today: "2026-12-06" });
    expect(r.updates.find((u) => u.id === po.id)).toMatchObject({ status: "Cancelled", cancelled: { by: "system" } });
  });
  it("cancels a stale PO when the fabric is REMOVED from the deal entirely", () => {
    const eo = [{ id: "eoR", clientName: "R", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const stockIdx = fabricStockIndex({});
    const noOfWith = (x) => (x.id === "eoR" ? { liza: [{ colour: "Removable Green", qty: 25, qtyOld: 25, qtyNew: 0 }] } : {});
    const { demand: d1 } = fabricDemandByDate({ eventOrders: eo, needOf: noOfWith, today: "2026-12-01" });
    const po = planFabricAutoPOs({ demand: d1, stockIdx, purchase: [], eventOrders: eo, needOf: noOfWith, today: "2026-12-01" }).creates[0];
    const noOfWithout = () => ({}); // the liza element was deleted from Build
    const { demand: d2 } = fabricDemandByDate({ eventOrders: eo, needOf: noOfWithout, today: "2026-12-06" });
    const r = planFabricAutoPOs({ demand: d2, stockIdx, purchase: [po], eventOrders: eo, needOf: noOfWithout, today: "2026-12-06" });
    expect(r.updates.find((u) => u.id === po.id)).toMatchObject({ status: "Cancelled", cancelled: { by: "system" } });
  });
  it("a CREDITED id is permanently retired - never recreated, even once demand for that exact slot returns", () => {
    const eo = [{ id: "eoK", clientName: "K", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const stockIdx = fabricStockIndex({});
    const noOf = (x) => (x.id === "eoK" ? { liza: [{ colour: "Kept Gold", qty: 30, qtyOld: 30, qtyNew: 0 }] } : {});
    const { demand: d1 } = fabricDemandByDate({ eventOrders: eo, needOf: noOf, today: "2026-12-01" });
    const rawPo = planFabricAutoPOs({ demand: d1, stockIdx, purchase: [], eventOrders: eo, needOf: noOf, today: "2026-12-01" }).creates[0];
    const credited = { ...rawPo, status: "Credited", credited: { at: Date.now(), qty: 30, tier: "old" } };
    const eo2 = [{ id: "eoK2", clientName: "K2", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] }];
    const noOf2 = (x) => (x.id === "eoK2" ? { liza: [{ colour: "Kept Gold", qty: 30, qtyOld: 30, qtyNew: 0 }] } : {});
    const { demand: d2 } = fabricDemandByDate({ eventOrders: eo2, needOf: noOf2, today: "2026-12-01" });
    const r = planFabricAutoPOs({ demand: d2, stockIdx, purchase: [credited], eventOrders: eo2, needOf: noOf2, today: "2026-12-01" });
    expect(r.creates.find((c) => c.id === credited.id)).toBeUndefined();
    expect(r.updates.find((u) => u.id === credited.id)).toBeUndefined();
  });
  // Regression, 2026-11-28, round-2 finding #4: an Open, not-yet-credited PO whose OWN needDate has already
  // passed used to count as NO cover at all for a later event needing the same colour - creating a duplicate
  // PO in the handoff window right before the first one actually gets credited.
  it("an already-raised, past-due, not-yet-credited PO counts as cover for a LATER event needing the same colour (no duplicate)", () => {
    const earlyEo = { id: "eoE", clientName: "E", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] };
    const laterEo = { id: "eoL", clientName: "L", status: "blocked", functionsDetail: [{ date: "2026-12-15" }] };
    const stockIdx = fabricStockIndex({}); // zero stock
    const noOfEarly = (x) => (x.id === "eoE" ? { liza: [{ colour: "Handoff Blue", qty: 40, qtyOld: 40, qtyNew: 0 }] } : {});
    const { demand: d1 } = fabricDemandByDate({ eventOrders: [earlyEo], needOf: noOfEarly, today: "2026-12-01" });
    const earlyPo = planFabricAutoPOs({ demand: d1, stockIdx, purchase: [], eventOrders: [earlyEo], needOf: noOfEarly, today: "2026-12-01" }).creates[0];
    expect(earlyPo.qty).toBe(40);
    // today is now the day after - earlyEo's date has fallen out of forward demand (not yet credited), and
    // laterEo needs 20kg of the SAME colour on a future date. Both events must be passed together, same as
    // the real app always does (this is per (eventOrders, needOf), not per-entry).
    const noOfLater = (x) => (x.id === "eoE" ? noOfEarly(x) : x.id === "eoL" ? { liza: [{ colour: "Handoff Blue", qty: 20, qtyOld: 20, qtyNew: 0 }] } : {});
    const { demand: d2 } = fabricDemandByDate({ eventOrders: [earlyEo, laterEo], needOf: noOfLater, today: "2026-12-06" });
    const r = planFabricAutoPOs({ demand: d2, stockIdx, purchase: [earlyPo], eventOrders: [earlyEo, laterEo], needOf: noOfLater, today: "2026-12-06" });
    expect(r.creates).toHaveLength(0);
    expect(r.updates).toHaveLength(0);
  });
});

describe("duePOsForCredit — only once the event is genuinely over", () => {
  const po = planOnce([]).creates[0];
  it("not due while the event is still in the future", () => {
    expect(duePOsForCredit({ purchase: [po], eventOrders, today: "2026-12-01" })).toHaveLength(0);
  });
  it("due once today is after the event's date", () => {
    expect(duePOsForCredit({ purchase: [po], eventOrders, today: "2026-12-06" })).toHaveLength(1);
  });
  it("a multi-day event waits for its LAST day, not its first", () => {
    const soloPO = { ...po, events: [{ eoId: "eo1", client: "Amit", date: "2026-12-05", qty: 70 }] };
    const multiDay = [{ id: "eo1", clientName: "Amit", status: "blocked", functionsDetail: [{ date: "2026-12-05" }, { date: "2026-12-06" }] }];
    expect(duePOsForCredit({ purchase: [soloPO], eventOrders: multiDay, today: "2026-12-06" })).toHaveLength(0);
    expect(duePOsForCredit({ purchase: [soloPO], eventOrders: multiDay, today: "2026-12-07" })).toHaveLength(1);
  });
  it("a cancelled event never triggers a credit, even past its old date - but a still-live co-event on the same PO can", () => {
    const oneCancelled = [{ ...eventOrders[0], status: "cancelled" }, eventOrders[1]];
    expect(duePOsForCredit({ purchase: [po], eventOrders: oneCancelled, today: "2026-12-06" })).toHaveLength(1); // via eo2
    const bothCancelled = [{ ...eventOrders[0], status: "cancelled" }, { ...eventOrders[1], status: "cancelled" }];
    expect(duePOsForCredit({ purchase: [po], eventOrders: bothCancelled, today: "2026-12-06" })).toHaveLength(0);
  });
  // Regression, 2026-11-28, finding #4: a billed PO (real money already spent and logged) must reach stock
  // even if its originating event later dies - otherwise that fabric never lands in trussInv and the next
  // deal needing the same colour gets bought again from scratch.
  it("a BILLED PO is due immediately, even once every one of its backing events is dead", () => {
    const billed = { ...po, billed: { actualQty: 70, actualCost: 12000, vendor: "ABC Textiles", by: "Tarun", at: Date.now() } };
    const bothCancelled = eventOrders.map((eo) => ({ ...eo, status: "cancelled" }));
    expect(duePOsForCredit({ purchase: [billed], eventOrders: bothCancelled, today: "2026-12-01" })).toHaveLength(1);
    // an UNBILLED PO in the exact same situation still correctly waits for a live, past-due event
    expect(duePOsForCredit({ purchase: [po], eventOrders: bothCancelled, today: "2026-12-01" })).toHaveLength(0);
  });
  // Regression, 2026-11-28, round-2 finding #3: round 1's first fix made ANY billed PO due the instant it
  // was billed, even for a live event weeks away - that caused the planner to raise a fresh PO under the
  // same deterministic id (the real one no longer looked Open) and overwrite the billed/credited row.
  it("a BILLED PO does NOT credit early while its event is still live and in the future - only once dead, or once genuinely past-due", () => {
    const billed = { ...po, billed: { actualQty: 70, actualCost: 12000, vendor: "ABC Textiles", by: "Tarun", at: Date.now() } };
    expect(duePOsForCredit({ purchase: [billed], eventOrders, today: "2026-12-02" })).toHaveLength(0); // event is 3 days out, still live - wait like an unbilled PO
    expect(duePOsForCredit({ purchase: [billed], eventOrders, today: "2026-12-06" })).toHaveLength(1); // now genuinely past-due, same as an unbilled PO would be
  });
});

describe("fabricPoId — collision-free even when two different colours slug down to the same thing", () => {
  it("\"Off White\" and \"Off-White\" (same slug once punctuation is stripped) get DIFFERENT ids", () => {
    const idA = fabricPoId("liza", colourKey("Off White"), "old", "2026-12-05");
    const idB = fabricPoId("liza", colourKey("Off-White"), "old", "2026-12-05");
    expect(idA).not.toBe(idB);
  });
  it("the same colour always resolves to the same id (still deterministic)", () => {
    expect(fabricPoId("liza", colourKey("Rose Gold dark"), "old", "2026-12-05")).toBe(fabricPoId("liza", colourKey("Rose Gold dark"), "old", "2026-12-05"));
  });
});

describe("stuckCrediting — a tab that closed mid-write", () => {
  it("picks up a PO stuck in Crediting past the threshold, ignores a fresh claim", () => {
    const stuck = { requestType: "fabric-auto", id: "a", status: "Crediting", creditingAt: Date.now() - 20 * 60 * 1000 };
    const fresh = { requestType: "fabric-auto", id: "b", status: "Crediting", creditingAt: Date.now() - 60 * 1000 };
    const r = stuckCrediting([stuck, fresh]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("a");
  });
});

describe("fabricPOTarget — new auto-PO shape and legacy executeFabricBlocks shape", () => {
  it("reads the new shape's own fabric block", () => {
    const po = planOnce([]).creates[0];
    expect(fabricPOTarget(po)).toMatchObject({ kind: "liza", colour: "Rose Gold dark", tier: "old", stockKey: "lizaStock", qtyField: "stockKg" });
  });
  it("reads a legacy functionAllocation row as tier old (it only ever decremented the Old field)", () => {
    const legacy = { functionAllocation: { eoId: "eoX", fabricType: "masking", colour: "Ivory", freshCost: 500 } };
    expect(fabricPOTarget(legacy)).toMatchObject({ kind: "masking", colour: "Ivory", tier: "old", stockKey: "maskingStock", qtyField: "stockPieces" });
  });
});

import { describe, it, expect } from "vitest";
import { TRUCK_EXTRA_SRC, truckExtraQtyByItem, truckExtraBlockOps } from "./truckExtraBlocks";

const trips = (t) => t.trips;
const truck = (custom) => ({ id: "t1", trips: [{ id: "tr1", custom }] });

describe("truckExtraQtyByItem", () => {
  it("sums one item over trucks, trips and departments; skips zero qty and rows with no item", () => {
    const trucks = [
      { id: "a", trips: [{ custom: { Furniture: [{ invId: "i1", qty: 2 }, { invId: "i2", qty: 0 }] } }, { custom: { Furniture: [{ invId: "i1", qty: 3 }] } }] },
      { id: "b", trips: [{ custom: { Tenting: [{ invId: "i1", qty: 1 }, { name: "no id", qty: 5 }] } }] },
    ];
    expect([...truckExtraQtyByItem(trucks, trips)]).toEqual([["i1", 6]]);
  });
});

describe("truckExtraBlockOps", () => {
  const dates = ["2026-12-01", "2026-12-02"];
  it("blocks a newly added item on every event date", () => {
    expect(truckExtraBlockOps({}, "E1", dates, new Map([["i1", 4]]))).toEqual([{
      item_id: "i1", event_id: "E1", remove: [{ source: TRUCK_EXTRA_SRC, date: null }],
      add: dates.map((d) => ({ date: d, qty: 4, status: "confirmed", source: TRUCK_EXTRA_SRC })),
    }]);
  });
  it("does nothing when the ledger already holds exactly that", () => {
    const blocks = { i1: dates.map((d) => ({ eventId: "E1", date: d, qty: 4, source: TRUCK_EXTRA_SRC, status: "confirmed" })) };
    expect(truckExtraBlockOps(blocks, "E1", dates, new Map([["i1", 4]]))).toEqual([]);
  });
  it("replaces the hold when the qty on the trucks changes", () => {
    const blocks = { i1: dates.map((d) => ({ eventId: "E1", date: d, qty: 4, source: TRUCK_EXTRA_SRC })) };
    const ops = truckExtraBlockOps(blocks, "E1", dates, new Map([["i1", 6]]));
    expect(ops).toHaveLength(1);
    expect(ops[0].add.map((a) => a.qty)).toEqual([6, 6]);
  });
  it("releases the hold when the item is off every truck", () => {
    const blocks = { i1: [{ eventId: "E1", date: dates[0], qty: 4, source: TRUCK_EXTRA_SRC }] };
    expect(truckExtraBlockOps(blocks, "E1", dates, new Map())).toEqual([{ item_id: "i1", event_id: "E1", remove: [{ source: TRUCK_EXTRA_SRC, date: null }], add: [] }]);
  });
  it("never touches the deal's own holds or another event's", () => {
    const blocks = { i1: [
      { eventId: "E1", date: dates[0], qty: 10, source: "studio-incremental" },
      { eventId: "E2", date: dates[0], qty: 3, source: TRUCK_EXTRA_SRC },
    ] };
    expect(truckExtraBlockOps(blocks, "E1", dates, new Map())).toEqual([]);
  });
  it("re-blocks when an event date moved (a hold left on an old date)", () => {
    const blocks = { i1: [{ eventId: "E1", date: "2026-11-30", qty: 2, source: TRUCK_EXTRA_SRC }, ...dates.map((d) => ({ eventId: "E1", date: d, qty: 2, source: TRUCK_EXTRA_SRC }))] };
    expect(truckExtraBlockOps(blocks, "E1", dates, new Map([["i1", 2]]))).toHaveLength(1);
  });
  it("no event dates: nothing to write", () => {
    expect(truckExtraBlockOps({}, "E1", [], new Map([["i1", 1]]))).toEqual([]);
  });
});

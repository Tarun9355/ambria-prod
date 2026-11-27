import { describe, it, expect } from "vitest";
import { TRUCK_EXTRA_SRC, TRUCK_EXTRA_ZONE, truckExtraQtyByItem, truckExtraBlockOps, truckExtraRowsOf, truckExtraElements, withTruckExtraZone, truckExtraFnIdx } from "./truckExtraBlocks";
import { walkFnElements } from "../studio/manpowerCount";
import { tripsOf } from "./eventTrucks";

describe("truckExtraRowsOf (Deal Check's 'Added on trucks' rows and its internal cost)", () => {
  const inv = [{ id: "i1", name: "Cocktail Chair", price: 1250, img: "p.jpg" }, { id: "i2", name: "Buffee Table", rentalCost: 2000 }];
  it("prices each row at the item's rent and names its truck / trip; skips qty 0 and a null truck", () => {
    const trucks = [
      null,
      { id: "T1", vehicle: "DL1", driver: "Maanik", custom: { Furniture: [{ id: "a", invId: "i1", qty: 2 }, { id: "z", invId: "i2", qty: 0 }] } }, // legacy one-trip shape
      { id: "T2", vehicle: "DL2", trips: [{ id: "r1", status: "dispatched", custom: { Furniture: [{ id: "b", invId: "i2", qty: 1 }] } }, { id: "r2", custom: { Tenting: [{ id: "c", invId: "gone", name: "Old item", qty: 3 }] } }] },
    ];
    const rows = truckExtraRowsOf(trucks, inv, tripsOf);
    expect(rows.map(r => [r.name, r.qty, r.total, r.where])).toEqual([
      ["Cocktail Chair", 2, 2500, "DL1 · Maanik"],
      ["Buffee Table", 1, 2000, "DL2 · Trip 1"],
      ["Old item", 3, 0, "DL2 · Trip 2"],
    ]);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(4500);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });
  it("no trucks: nothing", () => { expect(truckExtraRowsOf(undefined, inv, tripsOf)).toEqual([]); });
  it("a virtual (trussInv-backed) row still shows up — visible, just priced at ₹0 when no trussInv config is handed in — with its own stored name/photo standing in for the missing inventory row", () => {
    const trucks = [{ id: "T1", vehicle: "DL1", trips: [{ id: "r1", custom: { Tenting: [{ id: "v", invId: "truss:pillars:iron:8", name: "Truss Pillar 8ft", img: "pillar.jpg", qty: 2 }] } }] }];
    const rows = truckExtraRowsOf(trucks, inv, tripsOf);
    expect(rows).toEqual([{ key: "T1|r1|v", name: "Truss Pillar 8ft", sub: "", dept: "Tenting", qty: 2, rate: 0, total: 0, photo: "pillar.jpg", where: "DL1", status: "loading" }]);
  });

  describe("virtual rows priced off trussInv's own config rate (RC-238)", () => {
    const trussInv = {
      rates: { pillarRftRate: 20, beamRftRate: 15, battaRftRate: 7, lizaKgRate: 250, maskingPieceRate: 150, curtainPieceRate: 300 },
      materials: { pole: { pillars: { 8: { stock: 5 } }, rates: { pillarRftRate: 25 } } },
      platforms: [{ id: "p1", label: "8x4", lengthFt: 8, widthFt: 4, material: "wood", stock: 10, ratePerSqft: 10 }],
    };
    it("truss pillar/beam — per-RFT rate × the piece's own size", () => {
      const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [
        { id: "a", invId: "truss:pillars:iron:8", name: "Pillar 8ft", qty: 2, virtual: true },
        { id: "b", invId: "truss:beams:iron:4", name: "Beam 4ft", qty: 3, virtual: true },
      ] } }] }];
      const rows = truckExtraRowsOf(trucks, inv, tripsOf, trussInv);
      expect(rows.map(r => [r.name, r.rate, r.total])).toEqual([["Pillar 8ft", 160, 320], ["Beam 4ft", 60, 180]]);
    });
    it("a material with its own override rate (Pole) prices off ITS rate, not iron's", () => {
      const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [{ id: "a", invId: "truss:pillars:pole:8", name: "Pillar 8ft · Pole", qty: 1, virtual: true }] } }] }];
      const rows = truckExtraRowsOf(trucks, inv, tripsOf, trussInv);
      expect(rows[0].rate).toBe(200); // 8 × 25 (Pole's own override), not 8 × 20 (iron's)
    });
    it("a platform piece — its OWN ratePerSqft × its own L×W, not the blended average", () => {
      const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [{ id: "a", invId: "platform:p1", name: "8x4 · Wood", qty: 3, virtual: true }] } }] }];
      const rows = truckExtraRowsOf(trucks, inv, tripsOf, trussInv);
      expect(rows[0]).toMatchObject({ rate: 320, total: 960 }); // 10 ₹/sqft × 8 × 4 = 320/piece
    });
    it("fabric colours — liza by kg, curtain/masking by piece", () => {
      const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Fabric: [
        { id: "a", invId: "fabric:lizaStock:ivory", name: "Liza - Ivory", qty: 12, virtual: true },
        { id: "b", invId: "fabric:curtainStock:gold", name: "Curtains - Gold", qty: 4, virtual: true },
        { id: "c", invId: "fabric:maskingStock:white", name: "Masking - White", qty: 6, virtual: true },
      ] } }] }];
      const rows = truckExtraRowsOf(trucks, inv, tripsOf, trussInv);
      expect(rows.map(r => [r.name, r.rate, r.total])).toEqual([
        ["Liza - Ivory", 250, 3000], ["Curtains - Gold", 300, 1200], ["Masking - White", 150, 900],
      ]);
    });
    it("an unresolvable platform id (row deleted since) prices at ₹0, never throws", () => {
      const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [{ id: "a", invId: "platform:gone", name: "Old size", qty: 2, virtual: true }] } }] }];
      expect(truckExtraRowsOf(trucks, inv, tripsOf, trussInv)[0].rate).toBe(0);
    });
  });
});

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
  it("never includes a virtual (trussInv-backed) row — it has no real inventory id to reserve stock against", () => {
    const trucks = [{ id: "a", trips: [{ custom: { Tenting: [
      { invId: "i1", qty: 2 },
      { invId: "truss:pillars:iron:8", qty: 5, virtual: true },
      { invId: "platform:plat_1", qty: 1, virtual: true },
    ] } }] }];
    expect([...truckExtraQtyByItem(trucks, trips)]).toEqual([["i1", 2]]);
  });
  it("the id-prefix guard catches a synthetic id even without the virtual flag set (defense in depth)", () => {
    const trucks = [{ id: "a", trips: [{ custom: { Fabric: [{ invId: "fabric:lizaStock:ivory", qty: 9 }] } }] }];
    expect([...truckExtraQtyByItem(trucks, trips)]).toEqual([]);
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

describe("truck extras in the crew count (truckExtraElements + withTruckExtraZone)", () => {
  const trucks = [{ id: "T1", trips: [{ id: "a", custom: { Furniture: [{ id: "x", invId: "i1", qty: 4 }] } }, { id: "b", custom: { Furniture: [{ id: "y", invId: "i1", qty: 2 }], Lighting: [{ id: "z", invId: "i2", qty: 3 }] } }] }];
  const inv = [{ id: "i1", name: "Chair", cat: "Furniture", subCat: "Chairs" }, { id: "i2", name: "Par Light", cat: "Lighting", subCat: "Par" }];
  it("one element per item, qty summed over trucks and trips", () => {
    expect(truckExtraElements(trucks, tripsOf)).toEqual([{ id: "truckx:i1", invId: "i1", qty: 6 }, { id: "truckx:i2", invId: "i2", qty: 3 }]);
  });
  it("adds an always-on zone the crew walker reads, leaves the function itself untouched, keeps its source and never adds twice", () => {
    const fn = { fnVenue: "V", enabledEls: { z1: true }, zoneElements: { z1: [{ invId: "i1", qty: 1 }] } };
    const els = truckExtraElements(trucks, tripsOf);
    const out = withTruckExtraZone(fn, els, fn);
    expect(fn.enabledEls[TRUCK_EXTRA_ZONE]).toBeUndefined();
    expect(out.__mpSrc).toBe(fn);
    expect(Object.keys(out)).not.toContain("__mpSrc"); // non-enumerable: JSON / spreads never carry it
    expect(withTruckExtraZone(out, els, fn)).toBe(out);
    const seen = [];
    walkFnElements(out, inv, ({ rc, qty, zoneKey }) => seen.push([rc.sub, qty, zoneKey]));
    expect(seen).toEqual([["Chairs", 1, "z1"], ["Chairs", 6, TRUCK_EXTRA_ZONE], ["Par", 3, TRUCK_EXTRA_ZONE]]);
  });
  it("no items on trucks: the function as is", () => {
    const fn = { enabledEls: {} };
    expect(withTruckExtraZone(fn, [], fn)).toBe(fn);
    expect(withTruckExtraZone(fn, undefined, fn)).toBe(fn);
  });
});

describe("truckExtraFnIdx (which function's crew takes the truck items)", () => {
  it("the earliest-dated function, whatever its place in the Build", () => {
    expect(truckExtraFnIdx([{ fnDate: "2026-12-03" }, { fnDate: "2026-12-01" }, { fnDate: "2026-12-02" }])).toBe(1);
  });
  it("an undated function never wins over a dated one; all undated or none → the first", () => {
    expect(truckExtraFnIdx([{}, { fnDate: "2026-12-05" }])).toBe(1);
    expect(truckExtraFnIdx([{}, {}])).toBe(0);
    expect(truckExtraFnIdx([])).toBe(0);
  });
});

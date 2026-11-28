import { describe, it, expect } from "vitest";
import { FABRIC_TYPES, colourKey, eoDate, eoLastDate, isFabricDemandEvent, fabricStockIndex, sameDayReservedOf, eventFabricRows, upcomingEventShortfalls, fabricDemandByDate, tierDeficits, receiveFabricIntoStock } from "./fabricShortfall.js";

const today = "2026-12-01";
const trussInv = {
  lizaStock: [
    { colour: "Rose Gold dark", stockKg: 100, stockKgNew: 0 },
    { colour: "Ivory", stockKg: 10, stockKgNew: 5 },
  ],
};
const need = {
  eo1: { liza: [{ colour: "Rose Gold dark", qty: 90, qtyOld: 90, qtyNew: 0 }] },
  eo2: { liza: [{ colour: "Rose Gold dark", qty: 80, qtyOld: 80, qtyNew: 0 }] },
  eo3: { liza: [{ colour: "Rose Gold dark", qty: 5, qtyOld: 5, qtyNew: 0 }] },
  eo4: { liza: [{ colour: "Rose Gold dark", qty: 5, qtyOld: 5, qtyNew: 0 }] },
};
const eventOrders = [
  { id: "eo1", clientName: "Amit", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] },
  { id: "eo2", clientName: "Priya", status: "blocked", functionsDetail: [{ date: "2026-12-05" }] },
  { id: "eo3", clientName: "Old", status: "blocked", functionsDetail: [{ date: "2026-11-01" }] }, // past - excluded from upcoming/demand
  { id: "eo4", clientName: "Dead", status: "cancelled", functionsDetail: [{ date: "2026-12-10" }] }, // cancelled - excluded
];
const needOf = (eo) => need[eo.id] || {};

describe("fabricStockIndex — stock summed by normalised colour", () => {
  it("sums old+new per colour, keyed by colourKey not the exact string", () => {
    const idx = fabricStockIndex(trussInv);
    expect(idx.liza.get(colourKey("Rose Gold dark"))).toMatchObject({ old: 100, new: 0 });
    expect(idx.liza.get(colourKey("Ivory"))).toMatchObject({ old: 10, new: 5 });
    expect(idx.masking.size).toBe(0);
  });
  it("hiddenInBuild is true only when every row of that colour is hidden", () => {
    const idx = fabricStockIndex({ lizaStock: [{ colour: "X", stockKg: 1, hideInBuild: true }, { colour: "X", stockKg: 1 }] });
    expect(idx.liza.get("x").hiddenInBuild).toBe(false);
    const idx2 = fabricStockIndex({ lizaStock: [{ colour: "X", stockKg: 1, hideInBuild: true }] });
    expect(idx2.liza.get("x").hiddenInBuild).toBe(true);
  });
});

describe("eventFabricRows / upcomingEventShortfalls — same-day contention nets correctly per event", () => {
  const idx = fabricStockIndex(trussInv);
  it("each of two same-day events sees the stock net of the OTHER one's own need (not pooled)", () => {
    const rowsAmit = eventFabricRows({ eo: eventOrders[0], eventOrders, needOf, stockIdx: idx });
    expect(rowsAmit[0].rows[0]).toMatchObject({ otherDay: 80, avail: 20, short: 70 });
    const rowsPriya = eventFabricRows({ eo: eventOrders[1], eventOrders, needOf, stockIdx: idx });
    expect(rowsPriya[0].rows[0]).toMatchObject({ otherDay: 90, avail: 10, short: 70 });
  });
  it("upcomingEventShortfalls lists both events' own (per-event) shortfall, past/cancelled excluded", () => {
    const up = upcomingEventShortfalls({ eventOrders, needOf, stockIdx: idx, today });
    expect(up).toHaveLength(2);
    expect(up.every((r) => r.short === 70 && r.contended)).toBe(true);
  });
});

describe("fabricDemandByDate — aggregated across events, by date (what the buy planner walks)", () => {
  it("pools same-day demand into one Q/QO/QN entry, excludes past and dead orders", () => {
    const { demand, unassigned } = fabricDemandByDate({ eventOrders, needOf, today });
    expect(unassigned).toHaveLength(0);
    const rgd = demand.get("liza|" + colourKey("Rose Gold dark"));
    const d5 = rgd.byDate.get("2026-12-05");
    expect(d5).toMatchObject({ Q: 170, QO: 170, QN: 0 });
    expect(d5.events).toHaveLength(2);
    expect(demand.has("liza|" + colourKey("Old"))).toBe(false); // eo3's date is in the past
  });
  it("an unassigned (no colour picked) row goes to `unassigned`, never the buyable demand map", () => {
    const { demand, unassigned } = fabricDemandByDate({
      eventOrders: [{ id: "x", clientName: "X", status: "blocked", functionsDetail: [{ date: "2026-12-09" }] }],
      needOf: () => ({ liza: [{ colour: "", qty: 5, qtyOld: 5, qtyNew: 0 }] }),
      today,
    });
    expect(demand.size).toBe(0);
    expect(unassigned).toHaveLength(1);
  });
  it("untiered qty (no qtyOld/qtyNew split recorded) folds entirely into QO", () => {
    const { demand } = fabricDemandByDate({
      eventOrders: [{ id: "x", clientName: "X", status: "blocked", functionsDetail: [{ date: "2026-12-09" }] }],
      needOf: () => ({ liza: [{ colour: "Black", qty: 12 }] }), // no qtyOld/qtyNew at all
      today,
    });
    const d = demand.get("liza|black").byDate.get("2026-12-09");
    expect(d).toMatchObject({ Q: 12, QO: 12, QN: 0 });
  });
});

describe("tierDeficits — tier-aware shortfall, with spare New able to stand in for Old (never the reverse)", () => {
  it("combined stock covers everything: no deficit either tier", () => {
    expect(tierDeficits({ Q: 25, QO: 5, QN: 20 }, { old: 10, new: 20 })).toEqual({ needNew: 0, needOld: 0 });
  });
  it("New demand exceeds New stock even though Old is empty: needOld AND needNew both nonzero, summing to the combined deficit", () => {
    const t = tierDeficits({ Q: 20, QO: 8, QN: 12 }, { old: 5, new: 8 });
    expect(t).toEqual({ needNew: 4, needOld: 3 });
    expect(t.needNew + t.needOld).toBe(Math.max(0, 20 - (5 + 8)));
  });
  it("spare New stock (after covering its own tier) can stand in for Old demand", () => {
    expect(tierDeficits({ Q: 15, QO: 10, QN: 5 }, { old: 0, new: 20 })).toEqual({ needNew: 0, needOld: 0 });
  });
  it("Old demand alone, New stock irrelevant to it beyond its own spare", () => {
    expect(tierDeficits({ Q: 15, QO: 15, QN: 0 }, { old: 10, new: 0 })).toEqual({ needNew: 0, needOld: 5 });
  });
});

describe("receiveFabricIntoStock — pure stock credit", () => {
  it("adds to the matching colour's tier field without mutating the input", () => {
    const next = receiveFabricIntoStock(trussInv, { stockKey: "lizaStock", qtyField: "stockKg", colour: "Rose Gold dark", tier: "old", qty: 70 });
    expect(next.lizaStock.find((r) => r.colour === "Rose Gold dark").stockKg).toBe(170);
    expect(trussInv.lizaStock.find((r) => r.colour === "Rose Gold dark").stockKg).toBe(100);
  });
  it("appends a new row when the colour has none yet", () => {
    const next = receiveFabricIntoStock(trussInv, { stockKey: "lizaStock", qtyField: "stockKg", colour: "Emerald Green", tier: "new", qty: 12 });
    const row = next.lizaStock.find((r) => r.colour === "Emerald Green");
    expect(row).toMatchObject({ stockKg: 0, stockKgNew: 12 });
  });
  it("matches an existing row by colourKey, not exact spelling", () => {
    const next = receiveFabricIntoStock(trussInv, { stockKey: "lizaStock", qtyField: "stockKg", colour: "rose gold DARK", tier: "old", qty: 1 });
    expect(next.lizaStock).toHaveLength(2); // no duplicate row created
  });
});

describe("eoDate / eoLastDate / isFabricDemandEvent", () => {
  it("eoLastDate is the LATEST function date, not the first", () => {
    expect(eoLastDate({ functionsDetail: [{ date: "2026-12-05" }, { date: "2026-12-06" }] })).toBe("2026-12-06");
  });
  it("excludes a cancelled order, a past-dated order, and one with no fabric data at all", () => {
    expect(isFabricDemandEvent(eventOrders[3], today)).toBe(false);
    expect(isFabricDemandEvent(eventOrders[2], today)).toBe(false);
    expect(isFabricDemandEvent({ status: "blocked", functionsDetail: [{ date: "2026-12-20" }] }, today)).toBe(true);
    expect(isFabricDemandEvent({ status: "blocked" }, today)).toBe(false); // no date at all
  });
  it("a statusless order is not excluded by the status check alone (matches the old upcomingFabricShort quirk)", () => {
    expect(isFabricDemandEvent({ functionsDetail: [{ date: "2026-12-20" }] }, today)).toBe(true);
  });
});

describe("FABRIC_TYPES — the one shared list, same order Dept Ops has always shown", () => {
  it("is liza, masking, curtain in that order", () => {
    expect(FABRIC_TYPES.map((f) => f.key)).toEqual(["liza", "masking", "curtain"]);
  });
});

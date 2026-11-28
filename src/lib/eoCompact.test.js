import { describe, it, expect } from "vitest";
import { compactEoData, expandEoData } from "./eoCompact.js";

// A deal shaped like Deal Check writes it: a shared Labours crew whose whole schedule (with each day's trace and its per-function
// columns) is copied into every department, plus a department-only crew, a row-level trace and a tier2 trace whose byFn carries rows.
const traceOf = (fn, n) => ({
  kind: "labours", result: n, need: n, rows: [{ label: `${fn} items`, num: n }],
  usageRows: Array.from({ length: 20 }, (_, i) => ({ sub: `Item ${i}`, qty: i + 1, usage: (i + 1) * 0.5 })),
});
const weddingT = traceOf("Wedding", 12);
const haldiT = traceOf("Haldi", 8);
const dayTrace = { ...weddingT, byFn: [{ fn: "Wedding", shift: "Dinner", result: 12, trace: weddingT }, { fn: "Haldi", shift: "Lunch", result: 8, trace: haldiT }] };
const labourSchedule = [
  { date: "2026-12-04", phase: "minusOne", count: 12, windows: 1, windowIds: ["w1"], winCount: null, trace: dayTrace, drivenBy: "Wedding" },
  { date: "2026-12-05", phase: "event", count: 12, windows: 2, windowIds: ["w1", "w2"], winCount: { w2: 6 }, trace: dayTrace, drivenBy: "Wedding" },
  { date: "2026-12-06", phase: "dismantle", count: 6, windows: 1, windowIds: ["w1"], winCount: null, trace: null, drivenBy: null },
];
const labourRow = (dept, share) => ({ type: "Labours", cost: 9000, count: null, rate: 750, basis: "", shared: true, trace: weddingT,
  splitInfo: { total: 18000, byUsage: true }, schedule: labourSchedule.map((s) => ({ ...s, share, shareByDept: { Floral: 0.5, Tenting: 0.5 } })) });
const tier2 = { kind: "tier2", result: 2, rows: [{ label: "Chandelier", num: 2 }], byFn: [{ fn: "Wedding", shift: "", result: 2, rows: [{ label: "Chandelier", num: 2 }] }] };
const order = () => ({
  id: "eo_1", status: "blocked", clientName: "Test client", functionsDetail: [{ fnIdx: 0, type: "Wedding", date: "2026-12-05" }],
  manpowerDetail: {
    Floral: [labourRow("Floral", 0.5), { type: "Florist", cost: 4000, count: 2, rate: 2000, basis: "2 per stage", shared: false, trace: tier2, schedule: [{ date: "2026-12-05", phase: "event", count: 2, trace: tier2 }] }],
    Tenting: [labourRow("Tenting", 0.5)],
    Lighting: [],
  },
  deptOps: { Floral: { realMandi: 5000 } },
  trucks: [],
});

const size = (x) => JSON.stringify(x).length;

describe("compactEoData / expandEoData", () => {
  it("round-trips byte for byte", () => {
    const o = order();
    expect(JSON.stringify(expandEoData(compactEoData(o)))).toBe(JSON.stringify(o));
    expect(expandEoData(compactEoData(o))).toEqual(o);
  });

  it("stores each trace once - the written order is much smaller", () => {
    const o = order();
    const c = compactEoData(o);
    expect(size(c)).toBeLessThan(size(o) * 0.6);
    // weddingT, haldiT, dayTrace (with its byFn), tier2 - four distinct traces however many places hold them
    expect(Object.keys(c.mpTraces)).toHaveLength(4);
    expect(JSON.stringify(c.manpowerDetail)).not.toContain("usageRows");
  });

  it("an order saved the old way reads exactly as it is", () => {
    const o = order();
    expect(JSON.stringify(expandEoData(o))).toBe(JSON.stringify(o));
  });

  it("after expanding, one trace is one object wherever it appears (memory holds it once)", () => {
    for (const e of [expandEoData(compactEoData(order())), expandEoData(order())]) {
      const floralDay = e.manpowerDetail.Floral[0].schedule[1].trace;
      const tentingDay = e.manpowerDetail.Tenting[0].schedule[1].trace;
      const setupDay = e.manpowerDetail.Floral[0].schedule[0].trace;
      expect(floralDay).toBe(tentingDay);
      expect(floralDay).toBe(setupDay);
      expect(floralDay.byFn[0].trace).toBe(e.manpowerDetail.Floral[0].trace);
    }
  });

  it("compacting twice, or a compacted order, gives the same result", () => {
    const c = compactEoData(order());
    expect(compactEoData(c)).toEqual(c);
  });

  it("a fresh manpowerDetail laid over a compacted row (Deal Check's sync) never keeps the stale table", () => {
    const row = compactEoData(order());
    const fresh = { Floral: [{ type: "Florist", cost: 1, count: 1, rate: 1, trace: { kind: "x", result: 1 }, schedule: [] }] };
    const written = compactEoData({ ...row, manpowerDetail: fresh, deptSyncedAt: 5 });
    expect(Object.keys(written.mpTraces)).toHaveLength(1);
    expect(expandEoData(written).manpowerDetail).toEqual(fresh);
    expect(expandEoData(written).deptSyncedAt).toBe(5);
  });

  it("a stub laid over a compacted row (IMS's dataless-order save) still expands to the full deal", () => {
    const row = compactEoData(order());
    const written = compactEoData({ ...row, status: "blocked", blockedAt: 9 });
    const e = expandEoData(written);
    expect(e.manpowerDetail).toEqual(order().manpowerDetail);
    expect(e.blockedAt).toBe(9);
  });

  it("leaves everything else alone", () => {
    expect(compactEoData(null)).toBe(null);
    expect(expandEoData(undefined)).toBe(undefined);
    const plain = { id: "eo_2", status: "pending", clientName: "x" };
    expect(compactEoData(plain)).toBe(plain);
    expect(expandEoData(plain)).toBe(plain);
    const noTraces = { id: "eo_3", manpowerDetail: { Floral: [{ type: "Florist", cost: 1, schedule: [{ date: "d", count: 1 }] }] } };
    expect(compactEoData(noTraces)).toEqual(noTraces);
    expect(compactEoData(noTraces).mpTraces).toBeUndefined();
    const c = compactEoData(order());
    expect(c.deptOps).toEqual({ Floral: { realMandi: 5000 } });
  });

  it("a dangling reference reads as no trace instead of throwing", () => {
    const c = compactEoData(order());
    const broken = { ...c, mpTraces: {} };
    const e = expandEoData(broken);
    expect(e.manpowerDetail.Floral[0].trace).toBe(null);
    expect(e.mpTraces).toBeUndefined();
  });

  it("key order is kept, so signatures over manpowerDetail do not change", () => {
    const o = order();
    const e = expandEoData(compactEoData(o));
    expect(Object.keys(e)).toEqual(Object.keys(o));
    expect(Object.keys(e.manpowerDetail.Floral[0].schedule[1])).toEqual(Object.keys(o.manpowerDetail.Floral[0].schedule[1]));
  });
});

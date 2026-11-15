import { describe, it, expect } from "vitest";
import { stampDeptChanges, eventChanges, itemsSummary, agoText, CHANGE_WINDOW_MS, dedupeChangeLogs } from "./recentChanges.js";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const H = 3600 * 1000;

describe("stampDeptChanges", () => {
  it("stamps the block each saved key belongs to", () => {
    const c = stampDeptChanges({}, { mandiLines: [], expenses: [] }, NOW, "Sudhir");
    expect(c).toEqual({ actuals: { at: NOW, by: "Sudhir" } });
  });
  it("an overlay / cushion choice is the Fabric plan; a movement is the on-site routing", () => {
    expect(stampDeptChanges({}, { itemChoice: {}, movements: [] }, NOW, "X")).toEqual({ fabreq: { at: NOW, by: "X" }, route: { at: NOW, by: "X" } });
  });
  it("keeps other blocks' stamps and ignores bookkeeping keys", () => {
    const c = stampDeptChanges({ truss: { at: 1, by: "A" } }, { mpDay: {}, updatedAt: NOW }, NOW, "B");
    expect(c).toEqual({ truss: { at: 1, by: "A" }, mp: { at: NOW, by: "B" } });
  });
});

describe("eventChanges", () => {
  const eo = { id: "e1", deptOps: { Floral: { changes: { actuals: { at: NOW - 2 * H, by: "Sudhir" }, mp: { at: NOW - 60 * H, by: "Old" } } } } };
  const reqs = [
    { eventOrderId: "e1", status: "logged", department: "Floral", requestedAt: NOW - 1 * H, requestedBy: "Anmol", items: [{ name: "Round Table", change: "added", to: 2 }] },
    { eventOrderId: "e1", status: "pending", department: "Floral", requestedAt: NOW - 1 * H, items: [] },
    { eventOrderId: "e2", status: "logged", department: "Floral", requestedAt: NOW - 1 * H, items: [] },
    { eventOrderId: "e1", status: "logged", department: "Lighting", requestedAt: NOW - CHANGE_WINDOW_MS - H, items: [] },
  ];
  it("inventory logs and Dept Ops stamps of this event inside 48 h, newest first", () => {
    const out = eventChanges(eo, reqs, NOW);
    expect(out.map((c) => [c.dept, c.section, c.by])).toEqual([["Floral", "inv", "Anmol"], ["Floral", "actuals", "Sudhir"]]);
    expect(out[0].text).toBe("+2 Round Table");
    expect(out[0].names).toEqual(["Round Table"]);
  });
  it("the same change logged again and again is one line, with how many times", () => {
    const again = [1, 2, 3].map((h) => ({ eventOrderId: "e1", status: "logged", department: "Furniture", requestedAt: NOW - h * H, requestedBy: "P", items: [{ name: "Chair", change: "added", to: 4 }] }));
    const out = eventChanges({ id: "e1" }, again, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ times: 3, at: NOW - 1 * H, text: "+4 Chair" });
  });
  it("nothing recent, nothing", () => {
    expect(eventChanges({ id: "x" }, reqs, NOW)).toEqual([]);
  });
});

describe("itemsSummary / agoText", () => {
  it("names a swap, a qty change and an extra count", () => {
    const s = itemsSummary([
      { name: "Beige Couch", change: "swapped", fromName: "Ivory Couch" },
      { name: "Chair", change: "changed", from: 10, to: 12 },
      { name: "Lamp", change: "removed", from: 1 },
      { name: "Rug", change: "added", to: 1 },
    ]);
    expect(s).toBe("Ivory Couch → Beige Couch, Chair 10 → 12, −1 Lamp +1 more");
  });
  it("reads Studio's qty_changed as a change, not a bare count", () => {
    expect(itemsSummary([{ name: "Coffee Table", change: "qty_changed", from: 5, to: 6, qty: 6 }])).toBe("Coffee Table 5 → 6");
  });
  it("hands the inventory entry its items, for the log-style list", () => {
    const items = [{ name: "Round Table", change: "added", to: 2 }];
    const out = eventChanges({ id: "e1" }, [{ eventOrderId: "e1", status: "logged", requestedAt: NOW - H, requestedBy: "Ritika", department: "Floral", items }], NOW);
    expect(out[0].items).toEqual(items);
  });
  it("reads as a person would say it", () => {
    expect(agoText(NOW - 20 * 60000, NOW)).toBe("20 min ago");
    expect(agoText(NOW - 3 * H, NOW)).toBe("3 hrs ago");
    expect(agoText(NOW - 1 * H, NOW)).toBe("1 hr ago");
    expect(agoText(NOW - 30 * H, NOW)).toBe("30 hrs ago");
  });
});

describe("the same change in another order is one entry", () => {
  const sw = { name: "Iron Wooden Cocktail Table", fromName: "Fabric Cocktail Table", change: "swapped", from: 4, to: 4 };
  const tk = { name: "Takhat", change: "removed", from: 4 };
  const bt = { name: "Buffee Table", change: "removed", from: 8 };
  const rows = [
    { id: "a", eventOrderId: "e1", status: "logged", department: "Furniture", requestedBy: "Tarun", requestedAt: NOW - 1 * H, items: [sw, tk, bt] },
    { id: "b", eventOrderId: "e1", status: "logged", department: "Furniture", requestedBy: "Tarun", requestedAt: NOW - 3 * H, items: [bt, sw, tk] },
    { id: "c", eventOrderId: "e1", status: "logged", department: "Furniture", requestedBy: "salim", requestedAt: NOW - 5 * H, items: [{ ...sw, name: "Fabric Cocktail Table", fromName: "Iron Wooden Cocktail Table" }] },
  ];
  it("the 48 h list", () => {
    const out = eventChanges({ id: "e1" }, rows, NOW);
    expect(out.map(c => c.times)).toEqual([2, 1]);
  });
  it("the Activity log", () => {
    const out = dedupeChangeLogs(rows);
    expect(out.map(r => [r.id, r.times])).toEqual([["a", 2], ["c", 1]]);
  });
});

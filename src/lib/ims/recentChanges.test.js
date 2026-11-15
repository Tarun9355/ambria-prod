import { describe, it, expect } from "vitest";
import { stampDeptChanges, eventChanges, itemsSummary, agoText, CHANGE_WINDOW_MS } from "./recentChanges.js";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const H = 3600 * 1000;

describe("stampDeptChanges", () => {
  it("stamps the block each saved key belongs to", () => {
    const c = stampDeptChanges({}, { mandiLines: [], expenses: [] }, NOW, "Sudhir");
    expect(c).toEqual({ actuals: { at: NOW, by: "Sudhir" } });
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
  it("reads as a person would say it", () => {
    expect(agoText(NOW - 20 * 60000, NOW)).toBe("20 min ago");
    expect(agoText(NOW - 3 * H, NOW)).toBe("3 hrs ago");
    expect(agoText(NOW - 1 * H, NOW)).toBe("1 hr ago");
    expect(agoText(NOW - 30 * H, NOW)).toBe("yesterday");
  });
});

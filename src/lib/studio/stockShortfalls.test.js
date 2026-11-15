import { describe, it, expect, afterEach } from "vitest";
import { reportStockShortfall, clearStockShortfall, dismissStockShortfall, getStockShortfalls } from "./stockShortfalls.js";

afterEach(() => { getStockShortfalls().forEach((s) => clearStockShortfall(s.eventId)); });

describe("stockShortfalls store", () => {
  it("reports a new shortfall", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "chair", name: "Chair", date: "2027-01-01", requested: 10, granted: 2, short: 8 }] });
    const snap = getStockShortfalls();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ eventId: "eo1", clientId: "c1", clientName: "Rao" });
    expect(snap[0].items).toHaveLength(1);
  });

  it("replaces (not appends) a second report for the same eventId", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "chair", name: "Chair", date: "2027-01-01", requested: 10, granted: 2, short: 8 }] });
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "sofa", name: "Sofa", date: "2027-01-01", requested: 4, granted: 4, short: 0 }] });
    const snap = getStockShortfalls();
    expect(snap).toHaveLength(1);
    expect(snap[0].items[0].itemId).toBe("sofa");
  });

  it("ignores an empty items array", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [] });
    expect(getStockShortfalls()).toHaveLength(0);
  });

  it("clearStockShortfall removes it", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "chair", name: "Chair", date: "2027-01-01", requested: 10, granted: 2, short: 8 }] });
    clearStockShortfall("eo1");
    expect(getStockShortfalls()).toHaveLength(0);
  });

  it("dismissStockShortfall is the same action as clear", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "chair", name: "Chair", date: "2027-01-01", requested: 10, granted: 2, short: 8 }] });
    dismissStockShortfall("eo1");
    expect(getStockShortfalls()).toHaveLength(0);
  });

  it("two different events are tracked independently", () => {
    reportStockShortfall("eo1", { clientId: "c1", clientName: "Rao", items: [{ itemId: "chair", name: "Chair", date: "2027-01-01", requested: 10, granted: 2, short: 8 }] });
    reportStockShortfall("eo2", { clientId: "c2", clientName: "Loveleen", items: [{ itemId: "sofa", name: "Sofa", date: "2027-01-02", requested: 4, granted: 1, short: 3 }] });
    expect(getStockShortfalls().map((s) => s.eventId).sort()).toEqual(["eo1", "eo2"]);
  });
});

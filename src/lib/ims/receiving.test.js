import { describe, it, expect } from "vitest";
import { truckReceiptStatus, confirmTruckPatch, setItemReceiptPatch, clearItemReceiptPatch, receivingOf } from "./receiving";

const lines = [
  { dept: "Furniture", key: "inv:a", planned: 12, extra: 0 },
  { dept: "Tenting", key: "inv:b", planned: 10, extra: 0 },
];

describe("truckReceiptStatus", () => {
  it("is pending with no receipt at all", () => {
    expect(truckReceiptStatus(lines, undefined)).toBe("pending");
  });

  it("is confirmed once the truck is confirmed with no flagged/short lines", () => {
    expect(truckReceiptStatus(lines, { confirmedAt: 123, items: {} })).toBe("confirmed");
  });

  it("is issue when any line is flagged, even if the truck was confirmed", () => {
    const r = { confirmedAt: 123, items: { Furniture: { "inv:a": { got: 12, flag: "damaged" } } } };
    expect(truckReceiptStatus(lines, r)).toBe("issue");
  });

  it("is issue when a line's actual qty is short of planned+extra, even with no flag set", () => {
    const r = { confirmedAt: 123, items: { Tenting: { "inv:b": { got: 8, flag: null } } } };
    expect(truckReceiptStatus(lines, r)).toBe("issue");
  });

  it("is pending (not confirmed) when items were logged but the truck was never confirmed", () => {
    const r = { items: { Furniture: { "inv:a": { got: 12 } } } };
    expect(truckReceiptStatus(lines, r)).toBe("pending");
  });
});

describe("patch builders", () => {
  it("confirmTruckPatch stamps confirmedAt/confirmedBy for just that truck", () => {
    const eo = { receiving: { trucks: { t1: {} }, transfers: {} } };
    const next = confirmTruckPatch(eo, "t1", "Ajay");
    expect(next.trucks.t1.confirmedBy).toBe("Ajay");
    expect(next.trucks.t1.confirmedAt).toBeTypeOf("number");
  });

  it("setItemReceiptPatch records a flagged short delivery without touching other lines", () => {
    const eo = { receiving: { trucks: { t1: { confirmedAt: 1, items: { Furniture: { "inv:a": { got: 12 } } } } }, transfers: {} } };
    const next = setItemReceiptPatch(eo, "t1", "Tenting", "inv:b", { got: 8, flag: "short", note: "2 beams missing" }, "Ajay");
    expect(next.trucks.t1.items.Tenting["inv:b"]).toMatchObject({ got: 8, flag: "short", note: "2 beams missing", by: "Ajay" });
    expect(next.trucks.t1.items.Furniture["inv:a"]).toEqual({ got: 12 }); // untouched
  });

  it("clearItemReceiptPatch removes exactly one line's receipt", () => {
    const eo = { receiving: { trucks: { t1: { items: { Furniture: { "inv:a": { got: 12, flag: "damaged" } } } } }, transfers: {} } };
    const next = clearItemReceiptPatch(eo, "t1", "Furniture", "inv:a", "Ajay");
    expect(next.trucks.t1.items.Furniture["inv:a"]).toBeUndefined();
  });

  it("receivingOf never returns null/undefined, even with no receiving field yet", () => {
    expect(receivingOf({})).toEqual({ trucks: {}, transfers: {} });
  });
});

import { describe, it, expect } from "vitest";
import { lateChangesOf } from "./lateChanges.js";

// Owner ask 2026-11-27: Planning's "Changed in the 48 hours before the event" section.
const sel = { id: "e1", functionsDetail: [{ date: "2026-11-28" }, { date: "2026-11-27" }] }; // first day 27 Nov
const at = (iso) => Date.parse(iso);
const inventory = [{ id: "T1", name: "Iron Wooden Cocktail Table", price: 400, img: "t.jpg" }, { id: "C7", name: "Ivory Couple Couch 07", price: 960 }];
const log = (over) => ({ eventOrderId: "e1", department: "Furniture", status: "logged", requestedBy: "Tarun", ...over });

describe("changes in the 48 hours before the event", () => {
  it("a removal inside the window costs its rental (rate x qty held)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:09:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4, to: 0 }] })] });
    expect(r.removed).toEqual([{ name: "Iron Wooden Cocktail Table", qty: 4, at: at("2026-11-26T16:09:00"), by: "Tarun", rate: 400, total: 1600, photo: "t.jpg" }]);
    expect(r.swaps.size).toBe(0);
  });
  it("the window starts 48 hours before the first function's day - older changes are not late", () => {
    const old = log({ requestedAt: at("2026-11-24T23:59:00"), items: [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4 }] });
    const edge = log({ requestedAt: at("2026-11-25T00:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "removed", from: 1 }] });
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [old, edge] });
    expect(r.removed.map((x) => x.name)).toEqual(["Ivory Couple Couch 07"]);
  });
  it("a switch (recorded as one, or one out + one in) is a swap, newest first; its removed half is not a removal", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [
      log({ requestedAt: at("2026-11-26T10:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "swapped", fromName: "Royal Couch 03" }] }),
      log({ requestedAt: at("2026-11-26T12:00:00"), items: [{ name: "Ivory Couple Couch 07", change: "added" }, { name: "Grey Couch", change: "removed", from: 1 }] }),
    ] });
    expect(r.swaps.get("Ivory Couple Couch 07")).toMatchObject({ fromName: "Grey Couch", by: "Tarun" });
    expect(r.removed).toEqual([]);
  });
  it("another department, another event, a not-logged row or no dates: nothing", () => {
    const items = [{ name: "Iron Wooden Cocktail Table", change: "removed", from: 4 }];
    const t = at("2026-11-26T16:00:00");
    expect(lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: t, items, department: "Floral" }), log({ requestedAt: t, items, eventOrderId: "e2" }), log({ requestedAt: t, items, status: "pending" })] }).removed).toEqual([]);
    expect(lateChangesOf({ sel: { id: "e1" }, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: t, items })] }).removed).toEqual([]);
  });
  it("an item with no rate set costs nothing (shown as -)", () => {
    const r = lateChangesOf({ sel, dept: "Furniture", inventory, amendRequests: [log({ requestedAt: at("2026-11-26T16:00:00"), items: [{ name: "Unknown Prop", change: "removed", from: 2 }] })] });
    expect(r.removed[0]).toMatchObject({ rate: 0, total: 0, qty: 2 });
  });
});

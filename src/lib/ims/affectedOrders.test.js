import { describe, it, expect } from "vitest";
import { affectedOrderIds } from "./affectedOrders";

const orders = [
  { id: "E1", deptSyncedAt: 1, venue: "Exotica", functionsDetail: [{ venue: "Exotica", elements: { stage: [{ invId: "LED1", qty: 40 }] } }] },
  { id: "E2", deptSyncedAt: 1, functionsDetail: [{ venue: "Pushpanjali", elements: { entry: [{ invId: "CON1", kitOverrides: [{ itemId: "POT9", qty: 2 }] }, { patternId: "PAT1" }] } }] },
  { id: "E3", deptSyncedAt: 1, functionsDetail: [{ venue: "MKT", elements: { bar: [{ invId: "LED10" }] } }] },
  { id: "E4", functionsDetail: [{ venue: "Exotica", elements: { stage: [{ invId: "LED1" }] } }] }, // never synced to Planning
];
const patterns = [{ id: "PAT1", sizes: { medium: { flowers: [{ mandiId: "F001", qty: 10 }] } } }, { id: "PAT2", sizes: { big: { flowers: [{ mandiId: "F002" }] } } }];
const venues = [{ id: "fv1", name: "Exotica" }];

describe("affectedOrderIds - only the booked deals that use what changed re-sync", () => {
  it("an inventory item: the deals naming it, at any depth (a kit part too) - not a look-alike id", () => {
    expect(affectedOrderIds({ changes: [{ table: "inventory", ids: ["LED1"] }], eventOrders: orders })).toEqual(["E1"]);
    expect(affectedOrderIds({ changes: [{ table: "inventory", ids: ["POT9"] }], eventOrders: orders })).toEqual(["E2"]);
  });
  it("a recipe, and a mandi flower through the recipes holding it", () => {
    expect(affectedOrderIds({ changes: [{ table: "flower_patterns", ids: ["PAT1"] }], eventOrders: orders })).toEqual(["E2"]);
    expect(affectedOrderIds({ changes: [{ table: "mandi_flowers", ids: ["F001"] }], eventOrders: orders, flowerPatterns: patterns })).toEqual(["E2"]);
    expect(affectedOrderIds({ changes: [{ table: "mandi_flowers", ids: ["F002"] }], eventOrders: orders, flowerPatterns: patterns })).toEqual([]);
  });
  it("a fixed venue: the deals at that venue", () => {
    expect(affectedOrderIds({ changes: [{ table: "fixed_venues", ids: ["fv1"] }], eventOrders: orders, fixedVenues: venues })).toEqual(["E1"]);
  });
  it("a deal never synced to Planning, an unused id and no change: nothing", () => {
    expect(affectedOrderIds({ changes: [{ table: "inventory", ids: ["NOPE"] }], eventOrders: orders })).toEqual([]);
    expect(affectedOrderIds({ changes: [], eventOrders: orders })).toEqual([]);
  });
});

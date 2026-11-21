import { describe, it, expect } from "vitest";
import { parseTransport, patchFromArgs, mergeTransport, renameTruckCapItem } from "./transportBlob";

const saved = {
  venues: [{ id: "V1", name: "Vedi", rate: 9000 }],
  truckCap: [{ id: "TC1", item: "Flower Pots", perTruck: 50, unit: "pc" }],
  floralPerTruck: 50000,
  bufferTiers: [{ id: "BT1", label: "Below ₹1L", minBudget: 0, maxBudget: 100000, bufferTrucks: 0 }],
  gensetRate: 28000, gensetRate62: 18000, gensetCostRate: 0, gensetCostRate62: 0,
};

describe("transport blob — a save changes only what it was asked to", () => {
  it("a truck-capacity edit leaves a venue rate saved elsewhere in the meantime alone", () => {
    const fresh = { ...saved, venues: [{ id: "V1", name: "Vedi", rate: 12000 }] }; // Studio changed the rate
    const myCap = [{ id: "TC1", item: "Flower Pots", perTruck: 60, unit: "pc" }];  // IMS edits a capacity
    const out = mergeTransport(fresh, patchFromArgs(null, myCap));
    expect(out.venues[0].rate).toBe(12000);
    expect(out.truckCap[0].perTruck).toBe(60);
    expect(out.bufferTiers).toBe(fresh.bufferTiers);
  });

  it("only the arguments given become the patch; a genset rate of 0 is a real value", () => {
    expect(patchFromArgs(null, null, undefined, null)).toEqual({});
    expect(patchFromArgs(null, null, undefined, null, 0)).toEqual({ gensetRate: 0 });
    expect(Object.keys(patchFromArgs(null, null, undefined, saved.bufferTiers))).toEqual(["bufferTiers"]);
  });

  it("reads the row as stored (a JSON string), an object, or double-encoded; anything else is null", () => {
    expect(parseTransport(JSON.stringify(saved)).truckCap).toHaveLength(1);
    expect(parseTransport(JSON.stringify(JSON.stringify(saved))).gensetRate).toBe(28000);
    expect(parseTransport(saved)).toBe(saved);
    expect(parseTransport("not json")).toBeNull();
    expect(parseTransport(null)).toBeNull();
    expect(parseTransport("[1,2]")).toBeNull();
  });

  it("a renamed sub-category keeps its truck capacity under the new name", () => {
    const out = renameTruckCapItem(saved, "flower pots", "Flower Pot Large");
    expect(out.truckCap[0]).toMatchObject({ item: "Flower Pot Large", perTruck: 50 });
    expect(out.venues).toBe(saved.venues);
    expect(renameTruckCapItem(saved, "Not There", "X")).toBeNull();
    expect(renameTruckCapItem(null, "a", "b")).toBeNull();
  });
});

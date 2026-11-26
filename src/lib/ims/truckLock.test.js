import { describe, it, expect } from "vitest";
import { truckLoadedOf, truckDetailsLocked } from "./truckLock";

const T = (trips, d = { vehicle: "DL1LAR6893", driver: "Vijay" }) => ({ id: "t1", ...d, trips });
describe("a truck's vehicle / driver are fixed once it is loaded", () => {
  it("nothing on it and still loading: editable", () => {
    expect(truckDetailsLocked(T([{ status: "loading", loads: {}, extra: {}, custom: {} }]))).toBe(false);
    expect(truckDetailsLocked(T([{ status: "loading", loads: { Furniture: { "inv:a": 0 } } }]))).toBe(false);
  });
  it("an item loaded, an extra, an item added on the truck, or a trip gone: locked", () => {
    expect(truckDetailsLocked(T([{ status: "loading", loads: { Structure: { "inv:a": 1 } } }]))).toBe(true);
    expect(truckDetailsLocked(T([{ status: "loading", extra: { Floral: { "inv:b": 2 } } }]))).toBe(true);
    expect(truckDetailsLocked(T([{ status: "loading", custom: { Structure: [{ invId: "x", qty: 1 }] } }]))).toBe(true);
    expect(truckDetailsLocked(T([{ status: "dispatched" }, { status: "loading" }]))).toBe(true);
  });
  it("a legacy one-trip truck (no trips array) reads its own loads", () => {
    expect(truckLoadedOf({ status: "loading", loads: { Fabric: { k: 3 } } })).toBe(true);
    expect(truckLoadedOf({ status: "loading" })).toBe(false);
  });
  it("details not filled yet: never locked (they still have to be entered)", () => {
    expect(truckDetailsLocked(T([{ status: "dispatched" }], { vehicle: "", driver: "Vijay" }))).toBe(false);
    expect(truckDetailsLocked(null)).toBe(false);
  });
});

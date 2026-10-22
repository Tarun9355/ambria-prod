import { describe, it, expect } from "vitest";
import { orderZoneKeys } from "./zoneOrder.js";

const admin = ["bar", "btr", "entry", "stage", "photo"];

describe("zone order = the Build page's order", () => {
  it("follows Admin → Zone Types when nothing was dragged", () => {
    expect(orderZoneKeys(["stage", "bar", "entry"], { adminOrder: admin })).toEqual(["bar", "entry", "stage"]);
  });
  it("a hand-dragged order comes first, in the order dragged, then the rest in admin order", () => {
    expect(orderZoneKeys(["bar", "btr", "entry", "stage", "photo"], { adminOrder: admin, dragged: ["stage", "photo"] }))
      .toEqual(["stage", "photo", "bar", "btr", "entry"]);
  });
  it("a partial dragged list is safe: zones not in it keep their admin position behind it", () => {
    expect(orderZoneKeys(["bar", "entry", "stage"], { adminOrder: admin, dragged: ["entry"] })).toEqual(["entry", "bar", "stage"]);
  });
  it("custom zones sit after the admin zones, in the order they were added; unknown keys last", () => {
    expect(orderZoneKeys(["cz_2", "mystery", "bar", "cz_1"], { adminOrder: admin, customKeys: ["cz_1", "cz_2"] }))
      .toEqual(["bar", "cz_1", "cz_2", "mystery"]);
  });
  it("unknown keys keep the order they came in, and the input is not changed", () => {
    const input = ["x", "bar", "y"];
    expect(orderZoneKeys(input, { adminOrder: admin })).toEqual(["bar", "x", "y"]);
    expect(input).toEqual(["x", "bar", "y"]);
  });
  it("a dragged custom zone goes first too", () => {
    expect(orderZoneKeys(["bar", "cz_1"], { adminOrder: admin, customKeys: ["cz_1"], dragged: ["cz_1"] })).toEqual(["cz_1", "bar"]);
  });
});

import { describe, it, expect } from "vitest";
import { tripChallanRows, truckKeyOf } from "./deptLoadList";

describe("tripChallanRows - a trip's combined challan rows, as Planning matches them", () => {
  it("each department's flat list against the trip's loads / extra by truck key; items added on the truck by department", () => {
    const flat = { Furniture: [{ id: "a", invId: "CH", name: "Chair" }, { id: "b", invId: "VS", name: "Vase", kitOf: "Table" }], Fabric: [] };
    const trip = { loads: { Furniture: { "inv:CH": 4, "inv:VS@table": 2 } }, extra: { Furniture: { "inv:CH": 1 } }, custom: { Fabric: [{ invId: "CC", name: "Cushion Cover", qty: 17 }] } };
    const rows = tripChallanRows(trip, (d) => flat[d]);
    expect(rows.map((r) => [r.dept, r.name, r.qty, r.extra, r.added])).toEqual([
      ["Furniture", "Chair", 4, 1, false], ["Furniture", "Vase", 2, 0, false], ["Fabric", "Cushion Cover", 17, 0, true],
    ]);
    expect(truckKeyOf({ invId: "VS", kitOf: "Table" })).toBe("inv:VS@table");
    expect(tripChallanRows(null, () => [])).toEqual([]);
  });
});

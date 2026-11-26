import { describe, it, expect } from "vitest";
import { fabricNeedOf, makeFabricNeedCache } from "./fabricNeed";

describe("fabricNeedOf - an event's fabric per colour, as the Fabric block reads it", () => {
  it("from the groups (priced lines + the record), not a colour the record no longer backs with a fabric", () => {
    const eo = { id: "E1", fabricPlan: { liza: [{ colour: "Maroon", qty: 15, qtyOld: 15 }], curtain: [{ colour: "Ivory", qty: 2 }] },
      deptInventory: { Fabric: [{ id: "f1", name: "Liza Fabric (Old)", sub: "kg · stage", qty: 15, total: 4500 }] } };
    const n = fabricNeedOf(eo, { trussInv: {} });
    expect(n.liza).toEqual([{ colour: "Maroon", qty: 15, qtyOld: 15, qtyNew: 0 }]);
    expect(n.curtain).toEqual([]); // no velvet in the event's fabric any more: nothing asked of stock
  });
  it("no layout and no fabric lines: the stored plan is all there is", () => {
    const eo = { id: "E2", fabricPlan: { liza: [{ colour: "Ivory", qty: 2 }] } };
    expect(fabricNeedOf(eo, {}).liza).toEqual([{ colour: "Ivory", qty: 2 }]);
  });
  it("nothing at all: empty for every fabric; the cache answers the same object twice", () => {
    expect(fabricNeedOf(null)).toEqual({ liza: [], curtain: [], masking: [] });
    const get = makeFabricNeedCache({});
    const eo = { id: "E3" };
    expect(get(eo)).toBe(get(eo));
  });
});

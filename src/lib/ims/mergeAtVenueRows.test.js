// "Already at the venue" shows one row per item (owner report 2026-11-27: Mattress four times, Pillar Candle twice on the Site page).
import { describe, it, expect } from "vitest";
import { mergeAtVenueRows } from "./deptLoadList";

const rep = { repeat: true, foc: false, fixed: 0, load: 0 };
describe("mergeAtVenueRows", () => {
  it("the same item in several kits is one row with the pieces added up", () => {
    const out = mergeAtVenueRows([
      { dept: "Fabric", key: "inv:m1@lounge a", label: "Mattress", photo: "m.jpg", qty: 4, a: rep },
      { dept: "Fabric", key: "inv:m1@lounge b", label: "Mattress", photo: "m.jpg", qty: 4, a: rep },
      { dept: "Fabric", key: "inv:m1@lounge c", label: "Mattress", photo: "", qty: 4, a: rep },
      { dept: "Floral", key: "inv:c9@stage", label: "Pillar Candle", photo: "c.jpg", qty: 12, a: rep },
      { dept: "Floral", key: "inv:c9@entry", label: "Pillar Candle", photo: "c.jpg", qty: 12, a: rep },
    ]);
    expect(out.map((r) => [r.label, r.qty])).toEqual([["Mattress", 12], ["Pillar Candle", 24]]);
    expect(new Set(out.map((r) => r.dept + r.key)).size).toBe(out.length); // unique React keys
  });
  it("fixed stock adds up its standing and loaded parts", () => {
    const out = mergeAtVenueRows([
      { dept: "Fabric", key: "inv:cc@a", label: "Cushion cover", qty: 4, a: { repeat: false, foc: false, fixed: 4, load: 0 } },
      { dept: "Fabric", key: "inv:cc@b", label: "Cushion cover", qty: 5, a: { repeat: false, foc: false, fixed: 3, load: 2 } },
    ]);
    expect(out).toHaveLength(1);
    expect([out[0].qty, out[0].a.fixed, out[0].a.load]).toEqual([9, 7, 2]);
  });
  it("kept apart: different departments, Repeat vs Fixed vs FOC, different items, name keys with an @ in the photo URL", () => {
    const out = mergeAtVenueRows([
      { dept: "Fabric", key: "inv:x@k1", qty: 1, a: rep },
      { dept: "Furniture", key: "inv:x@k2", qty: 1, a: rep },
      { dept: "Fabric", key: "inv:x@k3", qty: 1, a: { fixed: 1, load: 0 } },
      { dept: "Fabric", key: "inv:x@k4", qty: 1, a: { foc: true, fixed: 0, load: 0 } },
      { dept: "Fabric", key: "inv:y@k1", qty: 1, a: rep },
      { dept: "Fabric", key: "nm:liza|https://a/b@1.jpg", qty: 2, a: rep },
      { dept: "Fabric", key: "nm:liza|https://a/b@2.jpg", qty: 3, a: rep },
    ]);
    expect(out).toHaveLength(7);
  });
  it("does not change the rows it was given", () => {
    const rows = [{ dept: "D", key: "inv:a@k1", qty: 1, a: { ...rep } }, { dept: "D", key: "inv:a@k2", qty: 2, a: { ...rep } }];
    mergeAtVenueRows(rows);
    expect(rows[0].qty).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { foldFabricLines, fabricStandingOf } from "./fabricGroups.js";

// Owner ask 2026-11-26: the site / ops see only the extra fabric to bring; what the Repeat zones already have standing is apart.
const flat = [{ id: "a", name: "Liza Fabric (Old)", qty: 20 }, { id: "b", name: "Chair", qty: 4, invId: "c1" }];
const liza = (over = {}) => ({ key: "liza", label: "Liza Fabric", unit: "kg", qty: 33.58, amount: 0, colours: [],
  zones: [{ qty: 21.5, standing: false, colours: [] }, { qty: 12.08, standing: true, colours: [{ colour: "Ivory", qty: 12.08, photo: "p.jpg" }] }], ...over });

describe("Repeat zones' fabric", () => {
  it("no colour picked: the line to load leaves the Repeat zones out", () => {
    const out = foldFabricLines(flat, [liza()]);
    expect(out.map((l) => [l.name, l.qty])).toEqual([["Liza Fabric", 21.5], ["Chair", 4]]);
  });
  it("every zone on Repeat: nothing to load for that fabric", () => {
    const g = liza({ qty: 12.08, zones: [{ qty: 12.08, standing: true, colours: [] }] });
    expect(foldFabricLines(flat, [g]).map((l) => l.name)).toEqual(["Chair"]);
  });
  it("colour lines are unchanged (they already count new fabric only)", () => {
    const g = liza({ colours: [{ colour: "Gold", qty: 22 }] });
    expect(foldFabricLines(flat, [g]).map((l) => [l.name, l.qty])).toEqual([["Liza Fabric - Gold", 22], ["Chair", 4]]);
  });
  it("the no-colour line's money follows its quantity", () => {
    const out = foldFabricLines(flat, [liza({ amount: 3358 })]);
    expect(out[0].total).toBe(2150);
  });
  it("standing amount is the zone's own figure, split over its colours", () => {
    const g = liza({ zones: [{ qty: 20.3, standing: true, colours: [{ colour: "Ivory", qty: 25 }] }] });
    expect(fabricStandingOf([g])[0].qty).toBe(20.3);
    const two = liza({ zones: [{ qty: 10, standing: true, colours: [{ colour: "Ivory", qty: 6 }, { colour: "Gold", qty: 6 }] }] });
    expect(fabricStandingOf([two]).map((s) => s.qty)).toEqual([5, 5]);
  });
  it("lists what stands at the venue, by colour", () => {
    expect(fabricStandingOf([liza()])).toEqual([{ key: "liza", label: "Liza Fabric - Ivory", colour: "Ivory", qty: 12.08, unit: "kg", photo: "p.jpg" }]);
    expect(fabricStandingOf([liza({ zones: [{ qty: 3, standing: true, colours: [] }] })])[0]).toMatchObject({ label: "Liza Fabric", qty: 3 });
    expect(fabricStandingOf([])).toEqual([]);
  });
});

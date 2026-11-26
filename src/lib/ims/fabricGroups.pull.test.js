import { describe, it, expect } from "vitest";
import { buildFabricGroups } from "./fabricGroups.js";

// Owner report 2026-11-26 (Rajiv Tangri): the card said 16 kg while its colours, each rounded up, were Maroon 10 + Ivory 8 = 18 kg.
describe("fabric: what is pulled", () => {
  const entries = [
    { fi: 0, zk: "photobooth", zLabel: "Photo", fab: { lizaKg: 6.15 }, row: {} },
    { fi: 0, zk: "stage", zLabel: "Stage", fab: { lizaKg: 10.1 }, row: {} },
  ];
  const fabricPlan = { liza: [{ colour: "Maroon", qty: 10 }, { colour: "Ivory", qty: 8 }] };
  it("the whole event's card adds the colours up (each already rounded up)", () => {
    const g = buildFabricGroups({ entries, fabricPlan }).groups.find((x) => x.key === "liza");
    expect(g.qty).toBe(16.25);
    expect(g.pullQty).toBe(18);
  });
  it("one function's view keeps the zones' own figure", () => {
    const g = buildFabricGroups({ entries, fabricPlan, onlyFi: 0 }).groups.find((x) => x.key === "liza");
    expect(g.pullQty).toBe(null);
  });
});

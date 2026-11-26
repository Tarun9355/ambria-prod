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
  it("one function's view: the zones' own figure (new fabric)", () => {
    const g = buildFabricGroups({ entries, fabricPlan, onlyFi: 0 }).groups.find((x) => x.key === "liza");
    expect(g.pullQty).toBe(16.25);
    expect(g.roundedUp).toBe(false);
  });
  // QA re-test: Stage 10.1 kg new + Lounge 20 kg on Repeat
  const mixed = [
    { fi: 0, zk: "stage", zLabel: "Stage", fab: { lizaKg: 10.1 }, row: {} },
    { fi: 0, zk: "lounge", zLabel: "Lounge", fab: { lizaKg: 20 }, row: {}, repeat: true },
  ];
  it("Repeat zones: the card is the new fabric only, whether or not a colour is picked", () => {
    const withCol = buildFabricGroups({ entries: mixed, fabricPlan: { liza: [{ colour: "Maroon", qty: 11 }] } }).groups[0];
    expect([withCol.qty, withCol.freshQty, withCol.standingQty, withCol.pullQty]).toEqual([30.1, 10.1, 20, 11]);
    const noCol = buildFabricGroups({ entries: mixed }).groups[0];
    expect(noCol.pullQty).toBe(10.1);
  });
  it("the new fabric's colour is not guessed onto a Repeat zone", () => {
    const g = buildFabricGroups({ entries: mixed, fabricPlan: { liza: [{ colour: "Maroon", qty: 11 }] } }).groups[0];
    expect(g.zones.find((z) => z.zoneKey === "lounge").colours).toEqual([]);
    expect(g.zones.find((z) => z.zoneKey === "stage").colours.map((c) => c.colour)).toEqual(["Maroon"]);
  });
});

import { describe, it, expect } from "vitest";
import { buildFabricGroups } from "./fabricGroups";

// Build's "Loose fabric" rows on a truss (row.looseFabric) reach the Setup Book / Fabric block with the formula fabric.
const entry = (over = {}) => ({ fi: 0, zk: "stage", ri: 0, zLabel: "Stage", fnLabel: "Wedding", photo: "", repeat: false, row: { looseFabric: [], ...over.row }, fab: { lizaKg: 0, curtainPieces: 0, maskingPieces: 0, ...over.fab } });
const liza = (g) => g.groups.find((x) => x.key === "liza");

describe("fabric groups count Build's loose fabric", () => {
  it("a zone with only loose Liza is listed, in the loose colour", () => {
    const g = buildFabricGroups({ entries: [entry({ row: { looseFabric: [{ kind: "liza", colour: "Maroon", qty: 6 }] } })] });
    expect(liza(g).zones).toHaveLength(1);
    expect(liza(g).zones[0].qty).toBe(6);
    expect(liza(g).zones[0].colours).toEqual([expect.objectContaining({ colour: "Maroon", qty: 6 })]);
  });
  it("formula and loose add up; another fabric's loose row is not counted", () => {
    const g = buildFabricGroups({ entries: [entry({ fab: { lizaKg: 10 }, row: { lizaAllocation: [{ colour: "Ivory", qty: 10 }], looseFabric: [{ kind: "liza", colour: "Maroon", qty: 4 }, { kind: "masking", colour: "Black", qty: 2 }] } })] });
    expect(liza(g).zones[0].qty).toBe(14);
    expect(liza(g).zones[0].colours.map((c) => c.colour).sort()).toEqual(["Ivory", "Maroon"]);
  });
  it("Deal Check's record already holds the loose part: not counted twice", () => {
    const fabricPlan = { liza: [{ colour: "Maroon", qty: 6 }], rows: [{ kind: "liza", fi: 0, zk: "stage", ri: 0, colour: "Maroon", qty: 6 }] };
    const g = buildFabricGroups({ entries: [entry({ row: { looseFabric: [{ kind: "liza", colour: "Maroon", qty: 6 }] } })], fabricPlan });
    expect(liza(g).zones[0].colours).toEqual([expect.objectContaining({ colour: "Maroon", qty: 6 })]);
  });
  it("no fabric at all: nothing listed", () => {
    expect(liza(buildFabricGroups({ entries: [entry()] }))?.zones || []).toHaveLength(0);
  });
});

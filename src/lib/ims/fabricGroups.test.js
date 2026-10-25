import { describe, it, expect } from "vitest";
import { buildFabricGroups, isFabricLine } from "./fabricGroups.js";

// bhaskar-test, Function 1: the lines Deal Check priced, the event's own zone layout, the colour allocation.
const lines = [
  { id: "a", name: "Cushion Cover Black Shimmer", qty: 3, total: 180, sub: "Cushion" },
  { id: "b", name: "Liza Fabric (Old)", qty: 13.67, total: 2283, sub: "kg · stage" },
  { id: "c", name: "Velvet Curtains (Old)", qty: 22, total: 3300, sub: "pc · stage" },
  { id: "d", name: "Liza Fabric (Old)", qty: 12.74, total: 2127, sub: "kg · entry" },
  { id: "e", name: "Velvet Curtains (Old)", qty: 20, total: 3000, sub: "pc · entry" },
  { id: "f", name: "Wall Masking (Old)", qty: 3, total: 1500, sub: "pc · photobooth" },
  { id: "g", name: "Liza Fabric (Old)", qty: 5.42, total: 905, sub: "kg · photobooth" },
  { id: "h", name: "Velvet Curtains (Old)", qty: 16, total: 2400, sub: "pc · photobooth" },
];
const entry = (zk, zLabel, fab, row = {}) => ({ fi: 0, zk, zLabel, fnLabel: "Wedding", photo: `${zk}.jpg`, fab, row });
const entries = [
  entry("stage", "Stage", { lizaKg: 13.67, lizaWrapKg: 3.5, lizaCeilingKg: 10.17, density: "moderate", curtainPieces: 22, curtainPillarCount: 11, maskingPieces: 0 }),
  entry("entry", "Entry", { lizaKg: 12.74, lizaWrapKg: 2.17, lizaCeilingKg: 10.57, density: "moderate", curtainPieces: 20, curtainPillarCount: 5, maskingPieces: 0 }),
  entry("photobooth", "Photobooth", { lizaKg: 5.42, lizaWrapKg: 5.42, lizaCeilingKg: 0, curtainPieces: 16, curtainPillarCount: 4, maskingPieces: 3 }, { mkWalls: { back: true, left: true } }),
];
const fabricPlan = { liza: [{ colour: "Ivory", qty: 35, qtyOld: 35, qtyNew: 0 }], curtain: [{ colour: "Ivory", qty: 58, qtyOld: 58, qtyNew: 0 }], masking: [{ colour: "Ivory", qty: 3, qtyOld: 3, qtyNew: 0 }] };
const stock = { lizaStock: [{ colour: "Ivory", photo: "ivory-liza.jpg" }], curtainStock: [{ colour: "Ivory", photo: "ivory-velvet.jpg" }], maskingStock: [{ colour: "Ivory", hex: "#f5f0e1" }] };

describe("buildFabricGroups — three fabrics, not a row per zone", () => {
  const { groups, groupedLineIds } = buildFabricGroups({ entries, lines, fabricPlan, stock });
  it("exactly three groups: Liza, Velvet, Wall Masking", () => {
    expect(groups.map((g) => g.label)).toEqual(["Liza Fabric", "Velvet Curtains", "Wall Masking"]);
  });
  it("each group carries the total across zones", () => {
    expect(groups[0].qty).toBe(31.83);
    expect(groups[0].unit).toBe("kg");
    expect(groups[1].qty).toBe(58);
    expect(groups[2].qty).toBe(3);
  });
  it("the colour's own stock photo is the group's image (the Ivory Liza fabric)", () => {
    expect(groups[0].photo).toBe("ivory-liza.jpg");
    expect(groups[1].photo).toBe("ivory-velvet.jpg");
    expect(groups[2].photo).toBe("");
    expect(groups[2].hex).toBe("#f5f0e1");
    expect(groups[0].colourText).toBe("Ivory 35 kg");
  });
  it("zone-wise breakdown, biggest first, each with its zone photo, qty and money", () => {
    expect(groups[0].zones.map((z) => [z.name, z.qty, z.amount, z.photo])).toEqual([
      ["Stage", 13.67, 2283, "stage.jpg"], ["Entry", 12.74, 2127, "entry.jpg"], ["Photobooth", 5.42, 905, "photobooth.jpg"],
    ]);
    expect(groups[1].zones.map((z) => [z.name, z.qty])).toEqual([["Stage", 22], ["Entry", 20], ["Photobooth", 16]]);
  });
  it("says how the fabric is applied in each zone", () => {
    const [stage, entryZ, booth] = groups[0].zones;
    expect(stage.application).toBe("Wrap 3.5 kg + ceiling 10.17 kg (moderate)");
    expect(entryZ.application).toBe("Wrap 2.17 kg + ceiling 10.57 kg (moderate)");
    expect(booth.application).toBe("Wrap 5.42 kg around the truss (no ceiling)");
    expect(groups[1].zones[1].application).toBe("5 pillars × 4 curtains");
    expect(groups[2].zones[0].application).toBe("Back + left walls · 13 ft panels");
  });
  it("the individual fabric lines are folded away; other lines (cushions) are not", () => {
    expect([...groupedLineIds].sort()).toEqual(["b", "c", "d", "e", "f", "g", "h"]);
    expect(isFabricLine(lines[0])).toBe(false);
  });
});

describe("buildFabricGroups — edge cases", () => {
  it("an event whose layout has not synced falls back to the priced lines", () => {
    const { groups } = buildFabricGroups({ entries: [], lines, fabricPlan, stock });
    expect(groups.map((g) => g.qty)).toEqual([31.83, 58, 3]);
    expect(groups[0].zones.map((z) => z.name)).toEqual(["Stage", "Entry", "Photobooth"]);
    expect(groups[0].zones[0].application).toBe("");
  });
  it("two colours show as two allocations, the larger first", () => {
    const plan = { liza: [{ colour: "White", qty: 10, qtyOld: 10, qtyNew: 0 }, { colour: "Ivory", qty: 25, qtyOld: 20, qtyNew: 5 }] };
    const { groups } = buildFabricGroups({ entries, lines, fabricPlan: plan, stock });
    expect(groups[0].colours.map((c) => [c.colour, c.qty])).toEqual([["Ivory", 25], ["White", 10]]);
    expect(groups[0].colours[0]).toMatchObject({ qtyOld: 20, qtyNew: 5 });
    expect(groups[0].photo).toBe("ivory-liza.jpg");
  });
  it("no colour picked yet: still a group, with a plain note", () => {
    const { groups } = buildFabricGroups({ entries, lines, fabricPlan: null, stock });
    expect(groups[0].colours).toEqual([]);
    expect(groups[0].colourText).toBe("No colour picked yet");
  });
  it("a fabric the event does not use gets no group", () => {
    const onlyLiza = lines.filter((l) => !/Velvet|Masking/.test(l.name));
    const e = entries.map((x) => ({ ...x, fab: { ...x.fab, curtainPieces: 0, maskingPieces: 0 } }));
    expect(buildFabricGroups({ entries: e, lines: onlyLiza, fabricPlan, stock }).groups.map((g) => g.key)).toEqual(["liza"]);
  });
  it("no fabric lines, no entries: nothing", () => {
    expect(buildFabricGroups({}).groups).toEqual([]);
  });
  it("two trusses in one zone add up; several functions are labelled", () => {
    const two = [entry("stage", "Stage", { lizaKg: 5 }), entry("stage", "Stage", { lizaKg: 3 }), { ...entry("stage", "Stage", { lizaKg: 4 }), fi: 1, fnLabel: "Mehendi" }];
    const g = buildFabricGroups({ entries: two, lines: [], multiFn: true }).groups[0];
    expect(g.qty).toBe(12);
    expect(g.zones.map((z) => [z.fnLabel, z.qty])).toEqual([["Wedding", 8], ["Mehendi", 4]]);
  });
});

describe("buildFabricGroups — a zone shared by two functions splits its money, it does not repeat it", () => {
  // The priced lines name a zone, not a function: "stage 13.67 kg · ₹2,283" is Wedding's stage 10.27 kg + Mehendi's 3.4 kg.
  const mk = (fi, fnLabel, zk, zLabel, kg) => ({ fi, zk, zLabel, fnLabel, photo: "", fab: { lizaKg: kg, lizaWrapKg: kg, lizaCeilingKg: 0 }, row: {} });
  const entries2 = [mk(0, "Wedding", "stage", "Stage", 10.27), mk(2, "Mehendi", "stage", "Stage", 3.4), mk(1, "Cocktail", "entry", "Entry", 11.72), mk(2, "Mehendi", "entry", "Entry", 1.02)];
  const lines2 = [
    { id: "s", name: "Liza Fabric (Old)", qty: 13.67, total: 2283, sub: "kg · stage" },
    { id: "e", name: "Liza Fabric (Old)", qty: 12.74, total: 2127, sub: "kg · entry" },
  ];
  it("the zones add back up to the lines' total (₹4,410), not double it", () => {
    const g = buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true }).groups[0];
    expect(g.amount).toBe(4410);
    expect(g.zones.reduce((s, z) => s + z.amount, 0)).toBeGreaterThanOrEqual(4409);
    expect(g.zones.reduce((s, z) => s + z.amount, 0)).toBeLessThanOrEqual(4411);
  });
  it("each function's stage takes its share of the stage line (Wedding 10.27 of 13.67 kg)", () => {
    const g = buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true }).groups[0];
    const wed = g.zones.find((z) => z.fnLabel === "Wedding" && z.zoneKey === "stage");
    const meh = g.zones.find((z) => z.fnLabel === "Mehendi" && z.zoneKey === "stage");
    expect(wed.amount).toBe(Math.round(2283 * 10.27 / 13.67));
    expect(meh.amount).toBe(Math.round(2283 * 3.4 / 13.67));
    expect(wed.amount).not.toBe(2283);
  });
  it("looking at one function shows only its zones, with its own total and share of the money", () => {
    const g = buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true, onlyFi: 2 }).groups[0];
    expect(g.zones.map((z) => [z.name, z.qty])).toEqual([["Stage", 3.4], ["Entry", 1.02]]);
    expect(g.qty).toBe(4.42);
    expect(g.amount).toBe(Math.round(2283 * 3.4 / 13.67 + 2127 * 1.02 / 12.74));
  });
  it("the folded-away lines are the same whichever function is shown", () => {
    const all = buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true }).groupedLineIds;
    const one = buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true, onlyFi: 1 }).groupedLineIds;
    expect([...one].sort()).toEqual([...all].sort());
  });
  it("a function that does not use the fabric shows no group", () => {
    expect(buildFabricGroups({ entries: entries2, lines: lines2, multiFn: true, onlyFi: 7 }).groups).toEqual([]);
  });
});

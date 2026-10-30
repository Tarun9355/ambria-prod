import { describe, it, expect } from "vitest";
import { buildFabricGroups, isFabricLine, trussDimsText } from "./fabricGroups.js";

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

describe("trussDimsText — the truss row's dimensions in words", () => {
  it("a single U: width x height", () => { expect(trussDimsText({ trT: "singleU", dims: { W: 16, H: 12 } })).toBe("16 × 12 ft U truss"); });
  it("a box: length x width x height, with the material", () => {
    expect(trussDimsText({ trT: "box", dims: { L: 20, W: 16, H: 12 }, trussMaterial: "iron" })).toBe("20 × 16 × 12 ft box truss · Iron");
  });
  it("a box missing a dimension is a single U, as it is billed", () => { expect(trussDimsText({ trT: "box", dims: { W: 16, H: 12 } })).toBe("16 × 12 ft U truss"); });
  it("nothing to say when there are no dimensions", () => { expect(trussDimsText({ trT: "singleU", dims: {} })).toBe(""); expect(trussDimsText(null)).toBe(""); });
});

describe("buildFabricGroups — each zone's truss dimensions and fabric colour", () => {
  const row = (extra = {}) => ({ trT: "singleU", dims: { W: 16, H: 12 }, ...extra });
  const mk = (zk, zLabel, kg, r, fi = 0, ri = 0) => ({ fi, ri, zk, zLabel, fnLabel: "Wedding", photo: "", fab: { lizaKg: kg, lizaWrapKg: kg, lizaCeilingKg: 0 }, row: r });
  const stockC = { lizaStock: [{ colour: "Ivory", photo: "ivory.jpg" }, { colour: "Rani", photo: "rani.jpg" }] };
  it("a zone carries its truss dimensions", () => {
    const g = buildFabricGroups({ entries: [mk("stage", "Stage", 5, row())], lines: [], stock: stockC }).groups[0];
    expect(g.zones[0].dims).toBe("16 × 12 ft U truss");
  });
  it("the colour comes from the row's own allocation, with the colour's stock photo", () => {
    const r = row({ lizaAllocation: [{ colour: "Ivory", qty: 3 }, { colour: "rani", qty: 2 }] });
    const z = buildFabricGroups({ entries: [mk("stage", "Stage", 5, r)], lines: [], stock: stockC }).groups[0].zones[0];
    expect(z.colours.map((c) => [c.colour, c.qty, c.photo])).toEqual([["Ivory", 3, "ivory.jpg"], ["rani", 2, "rani.jpg"]]);
  });
  it("else from what Deal Check recorded for that row at sync (fabricPlan.rows), matched by function, zone and truss row", () => {
    const plan = { liza: [{ colour: "Ivory", qty: 4 }, { colour: "Rani", qty: 6 }], rows: [
      { fi: 0, zk: "stage", ri: 0, kind: "liza", colour: "Ivory", qty: 4 }, { fi: 0, zk: "entry", ri: 0, kind: "liza", colour: "Rani", qty: 6 }, { fi: 0, zk: "stage", ri: 0, kind: "curtain", colour: "Rani", qty: 1 } ] };
    const g = buildFabricGroups({ entries: [mk("stage", "Stage", 4, row()), mk("entry", "Entry", 6, row())], lines: [], fabricPlan: plan, stock: stockC }).groups[0];
    expect(g.zones.find((z) => z.name === "Stage").colours.map((c) => c.colour)).toEqual(["Ivory"]);
    expect(g.zones.find((z) => z.name === "Entry").colours.map((c) => [c.colour, c.photo])).toEqual([["Rani", "rani.jpg"]]);
  });
  it("what Deal Check recorded wins over a colour still saved on the row (the palette overruled it)", () => {
    const r = row({ lizaAllocation: [{ colour: "Rani", qty: 5 }] });
    const plan = { liza: [{ colour: "Ivory", qty: 5 }], rows: [{ fi: 0, zk: "stage", ri: 0, kind: "liza", colour: "Ivory", qty: 5 }] };
    const z = buildFabricGroups({ entries: [mk("stage", "Stage", 5, r)], lines: [], fabricPlan: plan, stock: stockC }).groups[0].zones[0];
    expect(z.colours.map((c) => c.colour)).toEqual(["Ivory"]);
  });
  it("an event synced before the colours were recorded: one colour for the fabric is every zone's colour; several are left unsaid", () => {
    const one = buildFabricGroups({ entries: [mk("stage", "Stage", 5, row())], lines: [], fabricPlan: { liza: [{ colour: "Ivory", qty: 5 }] }, stock: stockC }).groups[0];
    expect(one.zones[0].colours.map((c) => c.colour)).toEqual(["Ivory"]);
    const many = buildFabricGroups({ entries: [mk("stage", "Stage", 5, row())], lines: [], fabricPlan: { liza: [{ colour: "Ivory", qty: 3 }, { colour: "Rani", qty: 2 }] }, stock: stockC }).groups[0];
    expect(many.zones[0].colours).toEqual([]);
  });
  it("two trusses in one zone: both dimensions, colours added together", () => {
    const entries3 = [mk("stage", "Stage", 3, row({ lizaAllocation: [{ colour: "Ivory", qty: 3 }] })), mk("stage", "Stage", 2, row({ dims: { W: 8, H: 10 }, lizaAllocation: [{ colour: "Ivory", qty: 2 }] }), 0, 1)];
    const z = buildFabricGroups({ entries: entries3, lines: [], stock: stockC }).groups[0].zones[0];
    expect(z.dims).toBe("16 × 12 ft U truss + 8 × 10 ft U truss");
    expect(z.colours.map((c) => [c.colour, c.qty])).toEqual([["Ivory", 5]]);
  });
});

import { foldFabricLines } from "./fabricGroups.js";
describe("foldFabricLines — one load line per fabric colour, not one per zone", () => {
  const flat = [
    { id: "x1", name: "Cushion Cover Black Shimmer", qty: 3, sub: "Cushion" },
    ...lines.filter((l) => /^(Liza|Velvet|Wall)/.test(l.name)),
    { id: "x2", name: "Chair", qty: 4, sub: "chair" },
  ];
  const plan = { liza: [{ colour: "Ivory", qty: 20 }, { colour: "Rani", qty: 15 }], curtain: [{ colour: "Ivory", qty: 58 }], masking: [] };
  const st = { lizaStock: [{ colour: "Ivory", photo: "ivory.jpg" }, { colour: "Rani", photo: "rani.jpg" }], curtainStock: [{ colour: "Ivory", photo: "iv2.jpg" }] };
  const { groups } = buildFabricGroups({ entries, lines, fabricPlan: plan, stock: st });
  const out = foldFabricLines(flat, groups);
  it("the per-zone fabric lines are gone, the others keep their order", () => {
    expect(out.some((l) => /\(Old\)/.test(l.name))).toBe(false);
    expect(out[0].id).toBe("x1");
    expect(out[out.length - 1].id).toBe("x2");
  });
  it("a line per colour with its quantity, unit and photo", () => {
    const l = out.filter((x) => /^Liza Fabric - /.test(x.name));
    expect(l.map((x) => [x.name, x.qty, x.qtyUnit, x.photo])).toEqual([["Liza Fabric - Ivory", 20, "kg", "ivory.jpg"], ["Liza Fabric - Rani", 15, "kg", "rani.jpg"]]);
    expect(out.find((x) => x.name === "Velvet Curtains - Ivory")).toMatchObject({ qty: 58, photo: "iv2.jpg" });
  });
  it("no colour picked: one line for the fabric", () => {
    const g2 = buildFabricGroups({ entries, lines, fabricPlan: null, stock: st }).groups;
    const o2 = foldFabricLines(flat, g2);
    expect(o2.filter((x) => x.name === "Liza Fabric")).toHaveLength(1);
    expect(o2.find((x) => x.name === "Wall Masking").qty).toBe(3);
  });
  it("each line has its own key, so zones no longer share one load", () => {
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length);
  });
  it("nothing to fold: the list is returned as it is", () => {
    const plain = [{ id: "a", name: "Chair", qty: 1 }];
    expect(foldFabricLines(plain, groups)).toBe(plain);
  });
});

describe("buildFabricGroups — colours worked out live from the function's Fabric Palette", () => {
  const mk = (zk, zLabel, kg, row = {}, over = {}) => ({ fi: 0, ri: 0, zk, zLabel, fnLabel: "Wedding", photo: "", fab: { lizaKg: kg, lizaWrapKg: kg, lizaCeilingKg: 0, curtainPieces: 4 }, row, ...over });
  const stock = { lizaStock: [{ colour: "Ivory", stockKg: 40, photo: "iv.jpg" }, { colour: "Rose Gold dark", stockKg: 100 }], curtainStock: [{ colour: "Ivory", stockPieces: 80 }, { colour: "Rose Gold", stockPieces: 3, photo: "rg.jpg" }] };
  const stalePlan = { liza: [{ colour: "Rose Gold dark", qty: 81 }], curtain: [] };
  const build = (palette, entries2, extra = {}) => buildFabricGroups({ entries: entries2, lines: [], fabricPlan: stalePlan, stock, fnPalettes: palette === null ? null : { 0: palette }, ...extra }).groups;
  it("Liza follows the palette (Ivory) whatever Deal Check last recorded, a saved Rose Gold dark is ignored", () => {
    const g = build("Ivory, Rose Gold:C", [mk("stage", "Stage", 10.2, { lizaAllocation: [{ colour: "Rose Gold dark", qty: 11 }] }), mk("entry", "Entry", 5.5)]);
    const liza = g.find((x) => x.key === "liza");
    expect(liza.colours.map((c) => [c.colour, c.qty, c.photo])).toEqual([["Ivory", 17, "iv.jpg"]]); // ceil(10.2) + ceil(5.5)
    expect(liza.zones.find((z) => z.name === "Stage").colours.map((c) => c.colour)).toEqual(["Ivory"]);
  });
  it("changing the palette changes the colours at once (Rose Gold for Velvet only)", () => {
    const e = [mk("stage", "Stage", 10)];
    expect(build("Ivory, Rose Gold:C", e).find((x) => x.key === "curtain").colours.map((c) => c.colour)).toEqual(["Ivory"]); // Ivory has more stock than Rose Gold
    expect(build("Rose Gold:C", e).find((x) => x.key === "curtain").colours.map((c) => c.colour)).toEqual(["Rose Gold"]);
  });
  it("Old and New stock rows are split by the row's own tier", () => {
    const g = build("Ivory", [mk("stage", "Stage", 10, { useNewFabric: true }), mk("entry", "Entry", 5)]).find((x) => x.key === "liza");
    expect(g.colours[0]).toMatchObject({ colour: "Ivory", qty: 15, qtyOld: 5, qtyNew: 10 });
  });
  it("a repeat zone takes no new fabric, so adds no colour", () => {
    const g = build("Ivory", [mk("stage", "Stage", 10), mk("entry", "Entry", 5, {}, { repeat: true })]).find((x) => x.key === "liza");
    expect(g.colours[0].qty).toBe(10);
    expect(g.zones.find((z) => z.name === "Entry").qty).toBe(5); // its quantity is still listed
  });
  it("a repeat zone still shows the colour its standing fabric is in, marked standing", () => {
    const g = build("Ivory", [mk("stage", "Stage", 10), mk("entry", "Entry", 5, {}, { repeat: true })]).find((x) => x.key === "liza");
    const entry = g.zones.find((z) => z.name === "Entry");
    expect(entry.colours.map((c) => c.colour)).toEqual(["Ivory"]);
    expect(entry.standing).toBe(true);
    expect(g.zones.find((z) => z.name === "Stage").standing).toBe(false);
    expect(g.standingOnly).toBe(false);
  });
  it("every zone on Repeat (Karan Bansal, Aura): each zone keeps its palette colour, and the fabric says standing, not 'No colour picked'", () => {
    const e = [mk("bar", "Bar", 6, {}, { repeat: true }), mk("entry", "Entry", 5, {}, { repeat: true })];
    const g = build("Ivory:L, Rose Gold:C", e);
    const liza = g.find((x) => x.key === "liza"), curtain = g.find((x) => x.key === "curtain");
    expect(liza.colours).toEqual([]); // nothing new to pull
    expect(liza.standingOnly).toBe(true);
    expect(liza.zones.every((z) => z.colours.map((c) => c.colour).join() === "Ivory")).toBe(true);
    expect(liza.colourText).toBe("♻ Repeat · standing Ivory");
    expect(curtain.zones[0].colours.map((c) => c.colour)).toEqual(["Rose Gold"]);
  });
  it("no palette entry for the function: what Deal Check recorded is kept", () => {
    const g = build(null, [mk("stage", "Stage", 10)]).find((x) => x.key === "liza");
    expect(g.colours.map((c) => c.colour)).toEqual(["Rose Gold dark"]);
  });
});

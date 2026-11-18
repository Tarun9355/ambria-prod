import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// FOC at the end of the book, department by department (owner ask 2026-11-18): FOC elements, FOC truss, FOC platform + carpet.
const inventory = [
  { id: "ch", name: "Chivari Chair", cat: "Furniture", unit: "Piece" },
  { id: "ln", name: "Crystal Lantern", cat: "Lighting", unit: "Piece" },
  { id: "tb", name: "Round Table", cat: "Furniture", unit: "Piece" },
];
const deptOf = (cat) => ({ Furniture: "Furniture", Lighting: "Lighting" }[cat] || "Tenting");
const fn = {
  type: "Wedding", date: "2026-12-01", venue: "",
  enabledEls: { stage: true, lounge: true },
  elements: {
    stage: [{ name: "Chivari Chair", invId: "ch", qty: 40, foc: true }, { name: "Round Table", invId: "tb", qty: 4 }],
    lounge: [{ name: "Crystal Lantern", invId: "ln", qty: 6, foc: true }],
  },
  zones: {
    stage: { trT: "box", dims: { L: 20, W: 12, H: 10 }, trussFoc: true, plH: "1ft", floorDims: { L: 20, W: 10 }, platformFoc: true },
    lounge: { plH: "4in", floorDims: { L: 10, W: 10 } },
  },
};
const ctx = (dept, combined) => [{
  dept, sel: { id: "e1", clientName: "Test", date: "2026-12-01", functionsDetail: [fn], deptInventory: {} },
  inventory, blocks: {}, settings: {}, trussInv: {}, catToDept: deptOf, authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
}, {}, {}, { combined }];

const focPart = (html) => html.slice(html.indexOf("FOC · "), html.indexOf("<footer"));

describe("Dept Book FOC section", () => {
  it("the all-departments book ends with every department's FOC, after everything else", () => {
    const html = buildDeptBookHtml(...ctx("Furniture", true));
    const foc = focPart(html);
    expect(html.indexOf("FOC · ")).toBeGreaterThan(0);
    expect(html.indexOf("FOC · ")).toBeLessThan(html.indexOf("<footer"));
    expect(foc).toContain("FOC · Furniture");
    expect(foc).toContain("FOC · Lighting");
    expect(foc).toContain("FOC · Tenting");
    expect(foc).toContain("Chivari Chair");
    expect(foc).toContain("Crystal Lantern");
    expect(foc).toContain("Platform + carpet");
    expect(foc).toContain("Truss");
    expect(foc).not.toContain("Round Table"); // not FOC
  });

  it("a department's own book shows only its own FOC", () => {
    const foc = focPart(buildDeptBookHtml(...ctx("Lighting", false)));
    expect(foc).toContain("Crystal Lantern");
    expect(foc).not.toContain("Chivari Chair");
    expect(foc).not.toContain("Platform + carpet");
  });

  it("nothing FOC, no section", () => {
    const plain = { ...fn, elements: { stage: [{ name: "Round Table", invId: "tb", qty: 4 }] }, zones: { lounge: { plH: "4in", floorDims: { L: 10, W: 10 } } } };
    const c = ctx("Furniture", true);
    c[0].sel.functionsDetail = [plain];
    expect(buildDeptBookHtml(...c)).not.toContain("FOC · ");
  });

  it("a FOC item known only by name is listed too, and an empty FOC floor is not", () => {
    const c = ctx("Furniture", true);
    c[0].sel.functionsDetail = [{
      ...fn,
      elements: { stage: [{ name: "Round Table", qty: 2, foc: true }] }, // no invId - matched by name
      zones: { stage: { platformFoc: true }, lounge: { plH: "4in", floorDims: { L: 10, W: 10 }, platformFoc: true, cpT: "__off__" } },
    }];
    const foc = focPart(buildDeptBookHtml(...c));
    expect(foc).toContain("FOC · Furniture");
    expect(foc).toContain("Round Table");
    expect(foc).not.toContain("Platform + carpet"); // stage: FOC but no floor; lounge: carpet off
    expect(foc).toContain("Platform"); // lounge's sized platform, no carpet
  });

  it("the Hindi book says it in Hindi", () => {
    const c = ctx("Tenting", false);
    c[3].lang = "hi";
    const html = buildDeptBookHtml(...c);
    expect(html).toContain("फ्री (FOC)");
  });
});

import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// The shared Fabric & Tenting book (owner ask 2026-11-11): one book, both departments' items and title.
const inventory = [
  { id: "f1", name: "Ivory Liza Drape", category: "Fabric" },
  { id: "t1", name: "Hexa Truss Pillar", category: "Tenting" },
  { id: "s1", name: "Gold Console", category: "Furniture" },
];
const catToDept = (c) => ({ Fabric: "Fabric", Tenting: "Tenting", Furniture: "Structure" })[c] || "";
const row = (inv, d) => ({ id: d + ":" + inv.id, invId: inv.id, name: inv.name, qty: 2, unit: 0, total: 0, sub: "" });
const sel = {
  id: "e1", clientName: "Test", date: "2026-12-01",
  functionsDetail: [{ fnType: "Wedding", date: "2026-12-01", venue: "", zones: ["stage"], elements: { stage: [
    { name: "Ivory Liza Drape", invId: "f1", qty: 2 }, { name: "Hexa Truss Pillar", invId: "t1", qty: 2 }, { name: "Gold Console", invId: "s1", qty: 2 },
  ] } }],
  deptInventory: { Fabric: [{ name: "Ivory Liza Drape", imsId: "f1", qty: 2 }], Tenting: [{ name: "Hexa Truss Pillar", imsId: "t1", qty: 2 }], Structure: [{ name: "Gold Console", imsId: "s1", qty: 2 }] },
};
const empty = () => ({ rows: [] });
const ctx = (dept, items) => ({
  dept, sel, inventory, blocks: {}, settings: {}, trussInv: {}, catToDept, authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: items, blockedItems: items, trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: empty, elementPlanOf: empty,
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
});

describe("shared Fabric & Tenting book", () => {
  it("carries both departments' items and the joint title; a single book keeps only its own", () => {
    const both = [row(inventory[0], "Fabric"), row(inventory[1], "Tenting")];
    const html = buildDeptBookHtml(ctx("Fabric", both), {}, {}, { depts: ["Fabric", "Tenting"] });
    expect(html).toContain("Fabric &amp; Tenting");
    expect(html).toContain("Ivory Liza Drape");
    expect(html).toContain("Hexa Truss Pillar");
    expect(html).not.toContain("Gold Console");
    const one = buildDeptBookHtml(ctx("Fabric", [both[0]]), {}, {}, {});
    expect(one).toContain("Ivory Liza Drape");
    expect(one).not.toContain("Hexa Truss Pillar");
  });
});

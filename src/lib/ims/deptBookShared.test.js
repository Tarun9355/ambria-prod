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
  it("fabric and truss totals are not 'Also on site' cards - the zone pages and the loading list carry them", () => {
    const lines = [
      { id: "Fabric:l", name: "Liza Fabric (Old)", qty: 29.88, sub: "" },
      { id: "Tenting:t", name: "Truss pillar 12ft", qty: 8, sub: "truss structure" },
      { id: "Tenting:b", name: "Batta", qty: 514, sub: "truss structure" },
      { id: "Tenting:p", name: "Platform", qty: 1600, sub: "platform structure (blended Wood+Iron rate)" },
      { id: "Tenting:c", name: "Brown Beige Rug Carpet", qty: 1600, qtyUnit: "sqft", parts: [{ zone: "Stage", qty: 800 }], sub: "carpet" },
    ];
    const html = buildDeptBookHtml(ctx("Tenting", lines), {}, {}, { depts: ["Fabric", "Tenting"] });
    expect(html).not.toContain("Also on site");
    expect(html).toContain("Truss pillar 12ft"); // still in the loading list
  });
  it("kilos in the loading list print whole (61.09 kg -> 61), other quantities as they are", () => {
    const lines = [
      { id: "Floral:a", name: "Artificial flowers", qty: 61.09, qtyUnit: "kg", sub: "Artificial Flowers" },
      { id: "Floral:b", name: "Rose bundle", qty: 2.5, sub: "" },
    ];
    const html = buildDeptBookHtml(ctx("Floral", lines), {}, {}, {});
    expect(html).toContain(">61</td>");
    expect(html).not.toContain("61.09");
    expect(html).toContain(">2.5</td>");
  });
});

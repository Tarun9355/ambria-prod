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

describe("book: masking says which walls, and non-fabric masking prints too (owner report 2026-11-13)", () => {
  it("fabric masking names its walls; an Acrylic wall gets its own Masking chip", () => {
    const zc = { mkOn: true, mkT: "fabric", mkWalls: { back: true, right: true }, mkWallMat: { right: { matKey: "acrylic" } } };
    const sel2 = { ...sel, functionsDetail: [{ ...sel.functionsDetail[0], zones: { stage: zc } }] };
    const c = { ...ctx("Tenting", [row(inventory[0], "Fabric")]), sel: sel2, fabricEntriesOf: () => [{ fi: 0, ri: 0, zk: "stage", zLabel: "Stage", fab: { maskingPieces: 2 }, row: zc }] };
    const html = buildDeptBookHtml(c, {}, {}, { depts: ["Fabric", "Tenting"] });
    expect(html).toContain("Back wall");
    expect(html).toContain("Acrylic · Right wall");
    expect(html).not.toContain("Back wall + Right wall");
  });
});

describe("book: masking edge cases priced the same way", () => {
  const bookFor = (zc) => {
    const sel2 = { ...sel, functionsDetail: [{ ...sel.functionsDetail[0], zones: { stage: zc } }] };
    const inv2 = [...inventory, { id: "p1", name: "Printed Floral Panel", category: "Fabric" }];
    return buildDeptBookHtml({ ...ctx("Tenting", [row(inventory[0], "Fabric")]), sel: sel2, inventory: inv2 }, {}, {}, { depts: ["Fabric", "Tenting"] });
  };
  it("a custom panel for the whole truss prints by name even with masking switched off (it is still priced)", () => {
    expect(bookFor({ mkOn: false, customMaskingItemId: "p1", mkT: "", mkWalls: {} })).toContain("Printed Floral Panel");
  });
  it("a 'No fabric' truss still prints its Acrylic masking, but no fabric walls", () => {
    const html = bookFor({ mkOn: true, noFabric: true, mkT: "acrylic", mkWalls: { back: true } });
    expect(html).toContain("Acrylic · Back wall");
  });
});

describe("book: flower cards in the combined book (owner report 2026-11-14)", () => {
  const inv2 = [...inventory, { id: "foam", name: "floral foam", category: "Florals", unit: "pc" }];
  const pats = [{ id: "p1", name: "Flower Reet", sub: "Reet", sizes: { medium: { flowers: [{ invItemId: "foam", qty: 1 }] } } }];
  const selF = {
    ...sel,
    functionsDetail: [{ fnType: "Wedding", date: "2026-12-01", venue: "", zones: ["stage"], elements: { stage: [{ name: "Flower Reet", patternId: "p1", qty: 3, realPct: 0 }] } }],
    floralPlan: { artificial: { flowerBunches: 10, greenBunches: 8 } },
    floralDetail: [{ realZones: [{ zone: "stage", el: "Flower Reet", lines: [{ name: "floral foam", qty: 3, unit: "pc" }] }],
      artZones: [{ zone: "stage", el: "Flower Reet", flower: 10, green: 8, qty: 3, realPct: 0 }] }],
  };
  const book = (d, opts) => buildDeptBookHtml({ ...ctx(d, []), sel: selF, inventory: inv2, flowerPatterns: pats, floralModeBySub: new Map() }, {}, {}, opts);
  it("the combined book prints a 100% artificial piece's card with its bunches, not a bare floral-foam card", () => {
    const html = book("Floral", { combined: true });
    expect(html).toContain("Artificial flowers");
    expect(html).toContain("Artificial 100%");
  });
  it("a Tenting-only book carries no flower card", () => {
    const html = book("Tenting", {});
    expect(html).not.toContain("Artificial flowers");
    expect(html).not.toContain("floral foam");
  });
});

describe("book: the combined book carries no kit cards (owner ask 2026-11-14)", () => {
  const inv3 = [...inventory, { id: "k1", name: "Wooden Console", category: "Florals", subItems: [{ itemId: "f1", qty: 2 }] }];
  const selK = {
    ...sel,
    functionsDetail: [{ fnType: "Wedding", date: "2026-12-01", venue: "", zones: ["stage"], elements: { stage: [{ name: "Wooden Console", invId: "k1", qty: 1 }] } }],
    floralPlan: { artificial: { flowerBunches: 9, greenBunches: 7 } },
    floralDetail: [{ realZones: [{ zone: "stage", el: "Chandelier Recipe", kitParent: "Wooden Console", lines: [{ name: "floral foam", qty: 2, unit: "pc" }] }],
      artZones: [{ zone: "stage", el: "Chandelier Recipe", kitParent: "Wooden Console", flower: 9, green: 7, qty: 1 }] }],
  };
  it("no 📦 kit card, and its recipe's bunches / foam do not come back as a loose card", () => {
    const html = buildDeptBookHtml({ ...ctx("Floral", []), sel: selK, inventory: inv3, floralModeBySub: new Map() }, {}, {}, { combined: true });
    expect(html).not.toContain("📦");
    expect(html).not.toContain("Chandelier Recipe");
    expect(html).not.toContain("floral foam");
  });
});

describe("book: a recipe renamed since Deal Check ran prints one card, not two (owner report 2026-11-14)", () => {
  const inv2 = [...inventory, { id: "foam", name: "floral foam", category: "Florals", unit: "pc" }];
  const pats = [{ id: "p1", name: "Flower Trail Rft", sub: "Trail", sizes: { medium: { flowers: [{ invItemId: "foam", qty: 3 }] } } }];
  const selR = {
    ...sel,
    functionsDetail: [{ fnType: "Party", date: "2026-12-01", venue: "", zones: ["stage"], elements: { stage: [{ name: "Flower Trail", patternId: "p1", qty: 9, realPct: 35 }] } }],
    floralPlan: { artificial: { flowerBunches: 43, greenBunches: 64 } },
    floralDetail: [{ realZones: [{ zone: "stage", el: "Flower Trail", lines: [{ name: "floral foam", qty: 27, unit: "pc" }] }],
      artZones: [{ zone: "stage", el: "Flower Trail", flower: 43, green: 64, qty: 9, realPct: 35 }] }],
  };
  it("the old name's bunches and lines land on the renamed piece's card", () => {
    const html = buildDeptBookHtml({ ...ctx("Floral", []), sel: selR, inventory: inv2, flowerPatterns: pats, floralModeBySub: new Map() }, {}, {}, { combined: true });
    expect(html).toContain("Flower Trail Rft");
    expect(html.split("43").length - 1).toBe(1); // the bunches once, on the one card
    expect(html).not.toMatch(/🌸 Flower Trail</);
  });
});

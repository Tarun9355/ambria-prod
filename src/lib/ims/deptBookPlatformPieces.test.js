import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// "Platform pieces to pull" (owner report 2026-11-25): the same engine Dept Ops' own on-screen
// "To pull from stock" breakdown uses now also reaches the PDF, reading the held Platform line's own
// `parts` (as DealCheckOverlay.jsx pushes them, floorL/floorW/copies included) straight off
// sel.deptInventory.Tenting — the same data both a single-department and the combined book carry.
const inventory = [];
const catToDept = () => "";
const empty = () => ({ rows: [] });
const baseCtx = (dept, parts, trussInv) => ({
  dept, inventory, blocks: {}, settings: {}, trussInv, catToDept, authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: empty, elementPlanOf: empty,
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
  sel: {
    id: "e1", clientName: "Test", date: "2026-12-01",
    functionsDetail: [{ fnType: "Wedding", date: "2026-12-01", venue: "", zones: {} }],
    deptInventory: {
      Tenting: [{ name: "Platform", photo: "", qty: parts.reduce((s, p) => s + p.qty, 0), sub: "platform structure (blended Wood+Iron rate)", fnIdx: 0, parts }],
    },
  },
});

const PLATFORM_8X4 = { id: "a", label: "Platform 8x4", lengthFt: 8, widthFt: 4, stock: 100, material: "Wood", thicknessIn: 4, ratePerSqft: 10 };

describe("deptBookHtml — Platform pieces to pull", () => {
  it("the Tenting book lists the piece and its qty", () => {
    const parts = [{ zone: "Stage", fn: "Wedding", fnIdx: 0, dims: "16 × 24", floorL: 16, floorW: 24, copies: 1, qty: 384 }];
    const html = buildDeptBookHtml(baseCtx("Tenting", parts, { platforms: [PLATFORM_8X4] }));
    expect(html).toContain("Platform pieces to pull");
    expect(html).toContain("Platform 8x4");
    expect(html).toMatch(/<td class="n b">12<\/td>/);
  });

  it("a department book with no Tenting in it never shows the section", () => {
    const parts = [{ zone: "Stage", fn: "Wedding", fnIdx: 0, dims: "16 × 24", floorL: 16, floorW: 24, copies: 1, qty: 384 }];
    const html = buildDeptBookHtml(baseCtx("Floral", parts, { platforms: [PLATFORM_8X4] }));
    expect(html).not.toContain("Platform pieces to pull");
  });

  it("a floor the stocked sizes can't tile evenly prints the 'doesn't fit' note, not just a silent sqft answer", () => {
    const parts = [{ zone: "Stage", fn: "Wedding", fnIdx: 0, dims: "10 × 10", floorL: 10, floorW: 10, copies: 1, qty: 100 }];
    const html = buildDeptBookHtml(baseCtx("Tenting", parts, { platforms: [PLATFORM_8X4] }));
    expect(html).toContain("Platform pieces to pull");
    expect(html).toContain("The stocked sizes do not fit this floor evenly — check on site");
  });

  it("Hindi book carries the Hindi heading", () => {
    const parts = [{ zone: "Stage", fn: "Wedding", fnIdx: 0, dims: "16 × 24", floorL: 16, floorW: 24, copies: 1, qty: 384 }];
    const html = buildDeptBookHtml(baseCtx("Tenting", parts, { platforms: [PLATFORM_8X4] }), {}, {}, { lang: "hi" });
    expect(html).toContain("प्लेटफ़ॉर्म — कौन से पीस निकालें");
  });
});

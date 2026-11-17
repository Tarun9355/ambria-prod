import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// The function's venue layout (uploaded in Studio's Build, functionsDetail[].layoutUrl) prints on a full page right after the
// cover, in every department's book (owner ask 2026-11-17).
const sel = (fns) => ({ id: "e1", clientName: "Test", date: "2026-12-01", functionsDetail: fns, deptInventory: {} });
const ctx = (fns) => ({
  dept: "Floral", sel: sel(fns), inventory: [], blocks: {}, settings: {}, trussInv: {}, catToDept: () => "", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
});
const URL1 = "https://example.com/layout-one.png";

describe("Dept Book layout page", () => {
  it("prints the layout on its own page right after the cover", () => {
    const html = buildDeptBookHtml(ctx([{ type: "Wedding", date: "2026-12-01", venue: "", zones: {}, elements: {}, layoutUrl: URL1 }]));
    const cover = html.indexOf("</header>");
    const lay = html.indexOf('class="lay"');
    expect(lay).toBeGreaterThan(cover);
    expect(html.slice(cover, lay)).not.toContain("<section data-block data-page class=\"zp\"><div class=\"pc tl\"></div><div class=\"pc tr\"></div>\n        <div class=\"zh\"");
    expect(html).toContain("layout-one.png");
  });
  it("no layout, no page", () => {
    const html = buildDeptBookHtml(ctx([{ type: "Wedding", date: "2026-12-01", venue: "", zones: {}, elements: {} }]));
    expect(html).not.toContain('class="lay"');
  });
  it("one page per function that has a layout, titled with the function", () => {
    const html = buildDeptBookHtml(ctx([
      { type: "Haldi", date: "2026-12-01", zones: {}, elements: {}, layoutUrl: URL1 },
      { type: "Wedding", date: "2026-12-02", zones: {}, elements: {} },
      { type: "Reception", date: "2026-12-03", zones: {}, elements: {}, layoutUrl: "https://example.com/layout-three.png" },
    ]));
    expect(html.split('class="lay"').length - 1).toBe(2);
    expect(html).toContain("Haldi");
    expect(html).toContain("Reception");
  });
});

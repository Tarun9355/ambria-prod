import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// The site supervisor fixed at the event's venue, with their number, bottom right of the cover's event card (owner ask 2026-11-18).
const ctx = (sups) => ({
  dept: "Tenting", sel: { id: "e1", clientName: "Test", date: "2026-12-01", functionsDetail: [{ type: "Wedding", date: "2026-12-01", venue: "Aura", zones: {}, elements: {} }], deptInventory: {} },
  inventory: [], blocks: {}, settings: {}, trussInv: {}, catToDept: () => "", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [], siteSupervisors: sups,
});

describe("Dept Book cover: site supervisor", () => {
  it("names the supervisor and number inside the event card", () => {
    const html = buildDeptBookHtml(ctx([{ name: "Raja", phone: "7607225147" }]), {}, {}, {});
    const card = html.slice(html.indexOf('<div class="cv-card has-sup">'), html.indexOf('<div class="cv-bottom">'));
    expect(card).toContain('class="cv-sup"');
    expect(card).toContain("Site supervisor");
    expect(card).toContain("Raja<span>7607225147</span>");
  });
  it("no supervisor fixed at the venue: no block, card as before", () => {
    const html = buildDeptBookHtml(ctx([]), {}, {}, {});
    expect(html).not.toContain('class="cv-sup"');
    expect(html).toContain('<div class="cv-card">');
  });
  it("Hindi book", () => {
    const html = buildDeptBookHtml(ctx([{ name: "Raja", phone: "1" }]), {}, {}, { lang: "hi" });
    expect(html).toContain("साइट सुपरवाइज़र");
  });
});

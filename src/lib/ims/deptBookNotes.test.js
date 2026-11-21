import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// Build's zone notes reach the Setup Book in full (owner ask 2026-11-21): a long note was clipped at 8 lines, and a zone with
// nothing but a note got no page at all.
const inventory = [{ id: "i1", name: "Wooden Console", cat: "Furniture", qty: 10 }];
const ctxOf = (fn) => ({
  dept: "Furniture", sel: { id: "e1", clientName: "Test", date: "2026-12-05", functionsDetail: [fn], deptInventory: {} },
  inventory, blocks: {}, settings: {}, trussInv: null, catToDept: () => "Furniture", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
});
const fnWith = (zones, elements, notes) => ({ type: "Wedding", date: "2026-12-05", venue: "", enabledEls: Object.fromEntries(Object.keys(zones).map(k => [k, true])), elements, zones, notes });

describe("Setup Book: Build's zone notes", () => {
  it("prints a long note whole — no clipping height on the note box", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}: keep the backdrop 2 ft off the wall`).join("\n");
    const html = buildDeptBookHtml(ctxOf(fnWith({ stage: {} }, { stage: [{ invId: "i1", name: "Wooden Console", qty: 2 }] }, { stage: lines })));
    expect(html).toContain("Line 14: keep the backdrop 2 ft off the wall");
    const box = html.slice(html.indexOf('<div class="znote"'), html.indexOf('<div class="znote"') + 40);
    expect(box).toBe('<div class="znote"><b>📝 Note</b><span>Lin'.slice(0, 40));
  });

  it("a zone with nothing but a note still gets its page, with the note", () => {
    const html = buildDeptBookHtml(ctxOf(fnWith({ stage: {}, lounge: {} }, { stage: [{ invId: "i1", name: "Wooden Console", qty: 2 }] }, { lounge: "Client will bring their own sofas — leave space" })));
    expect(html).toContain("Client will bring their own sofas — leave space");
  });
});

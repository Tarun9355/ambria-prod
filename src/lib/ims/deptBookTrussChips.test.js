import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// A zone with a "+ Add Truss" extra: each truss's own type / size / material prints above its plan on the Truss layouts
// page (owner ask 2026-11-21) — the zone's chips only summed them up as "Box +1 more". A one-truss zone stays as before.
const trussInv = { pillars: { 8: 40, 12: 20 }, beams: { 12: 40, 10: 20, 4: 20 } };
const main = { trT: "box", dims: { L: 28, W: 12, H: 8 }, trussMaterial: "Aluminium", drapeDensity: "dense" };
const extra = { trT: "box", dims: { L: 22, W: 12, H: 8 }, trussMaterial: "Iron", drapeDensity: "moderate" };
const zone = { ...main, extraTrussRows: [extra] };
const fn = { type: "Wedding", date: "2026-12-05", venue: "", enabledEls: { entry: true }, elements: {}, zones: { entry: zone } };
const topo = (L) => ({ pillars: [{ H: 8 }, { H: 8 }, { H: 8 }, { H: 8 }], beams: [{ lengthFt: 12 }, { lengthFt: L - 12 }, { lengthFt: 12 }, { lengthFt: L - 12 }, { lengthFt: 12 }, { lengthFt: 12 }] });
const ctxOf = (rows) => ({
  dept: "Tenting", sel: { id: "e1", clientName: "Test", date: "2026-12-05", functionsDetail: [fn], deptInventory: {} },
  inventory: [], blocks: {}, settings: {}, trussInv, catToDept: () => "Tenting", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => rows.map(([row, ri, L]) => ({ row, fi: 0, zk: "entry", ri, key: `0|entry|${ri}`, pv: { topology: topo(L), batta: { rftWithBuffer: 100, bufferPct: 10 } } })),
  fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
});

describe("Truss layouts page: each truss of a multi-truss zone carries its own chips", () => {
  it("prints the second truss's own type, size and material above its plan", () => {
    const html = buildDeptBookHtml(ctxOf([[zone, 0, 28], [extra, 1, 22]]));
    const strips = html.split('class="tp-b tp-bt').slice(1).map(s => s.slice(0, 600));
    expect(strips).toHaveLength(2);
    expect(strips[0]).toContain("Aluminium");
    expect(strips[0]).toContain("L 28 × W 12 × H 8 ft");
    expect(strips[1]).toContain("Iron");
    expect(strips[1]).toContain("L 22 × W 12 × H 8 ft");
    // type and size are separate chips
    expect(strips[1]).toMatch(/Truss<\/i>Box Iron<\/span>/);
    expect(strips[1]).toMatch(/Size<\/i>L 22 × W 12 × H 8 ft<\/span>/);
    expect(html).not.toContain("Truss #2");
    // the zone's line no longer repeats the trusses (each has its own line now)
    const page = html.slice(html.indexOf('class="lay-h"'));
    expect(page.slice(0, page.indexOf('tp-bt'))).not.toContain("+1 more");
    // the zone's function in brackets after its name
    expect(page).toContain('<em class="tp-fn">(Wedding)</em>');
  });
  it("a truss masked in Acrylic names it (and its wall) on that truss's own line only", () => {
    const acrylic = { ...extra, mkOn: true, mkT: "acrylic", mkWalls: { back: true } };
    const z2 = { ...main, extraTrussRows: [acrylic] };
    const f2 = { ...fn, zones: { entry: z2 } };
    const html = buildDeptBookHtml({ ...ctxOf([[z2, 0, 28], [acrylic, 1, 22]]), sel: { id: "e1", clientName: "T", date: "2026-12-05", deptInventory: {}, functionsDetail: [f2] } });
    const strips = html.split('class="tp-b tp-bt').slice(1).map(s => s.slice(0, 900));
    expect(strips[0]).not.toContain("Acrylic");
    expect(strips[1]).toContain("Acrylic");
    expect(strips[1]).toContain("Back wall");
  });

  it("an FOC truss elsewhere in the zone keeps its 'already at the venue' note on the zone line", () => {
    const focRow = { ...extra, trussFoc: true };
    const z3 = { ...main, extraTrussRows: [extra, focRow] };
    const f3 = { ...fn, zones: { entry: z3 } };
    const html = buildDeptBookHtml({ ...ctxOf([[z3, 0, 28], [extra, 1, 22]]), sel: { id: "e1", clientName: "T", date: "2026-12-05", deptInventory: {}, functionsDetail: [f3] } });
    const page = html.slice(html.indexOf('class="lay-h"'));
    expect(page.slice(0, page.indexOf('tp-bt'))).toContain("FOC");
  });

  it("a zone with one truss keeps just the zone's chips", () => {
    const single = { ...main };
    const html = buildDeptBookHtml({ ...ctxOf([[single, 0, 28]]), sel: { id: "e1", clientName: "T", date: "2026-12-05", deptInventory: {}, functionsDetail: [{ ...fn, zones: { entry: single } }] } });
    expect(html).not.toContain('class="tp-b tp-bt');
    // its size sits in its Truss chip beside the drawing
    const page = html.slice(html.indexOf('class="lay-h"'));
    expect(page).toMatch(/Size<\/i>[^<]*ft<\/span>/);
    expect(page).not.toMatch(/Truss<\/i>[^<]*·[^<]*ft/);
  });
});

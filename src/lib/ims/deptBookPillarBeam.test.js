import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// A pillar made up with a beam at the ground (resolvePillarHeight: 14 ft = 12 ft pillar + 2 ft beam) lists that piece as a
// beam on the zone's truss card (owner ask 2026-11-18) - "2 × 2 ft (Beam)" under Pillars, so the crew loads a beam for it.
const trussInv = { pillars: { 12: 20 }, beams: { 12: 20, 2: 20 } };
const fn = { type: "Engagement", date: "2026-11-19", venue: "", enabledEls: { stage: true }, elements: {}, zones: { stage: { trT: "singleU", dims: { L: 27.5, W: 12, H: 14 } } } };
const ctx = {
  dept: "Tenting", sel: { id: "e1", clientName: "Test", date: "2026-11-19", functionsDetail: [fn], deptInventory: {} },
  inventory: [], blocks: {}, settings: {}, trussInv, catToDept: () => "Tenting", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [{
    row: fn.zones.stage, fi: 0, zk: "stage", ri: 0, key: "0|stage|0",
    pv: { topology: { pillars: [{ H: 14 }, { H: 14 }, { H: 12 }, { H: 12 }], beams: [{ lengthFt: 12 }, { lengthFt: 12 }, { lengthFt: 2 }] }, batta: { rftWithBuffer: 59, bufferPct: 10 } },
  }],
  fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
};

const cardOf = (html, title) => {
  const i = html.indexOf(`🏛️ ${title}`);
  return i < 0 ? "" : html.slice(i, html.indexOf('<div class="ztk-c">', i + 1) > 0 ? html.indexOf('<div class="ztk-c">', i + 1) : i + 800);
};

describe("Dept Book truss card: a beam used as a pillar", () => {
  it("lists the ground spacer under Pillars as a beam", () => {
    const html = buildDeptBookHtml(ctx);
    const pillars = cardOf(html, "Pillars");
    expect(pillars).toContain("× 12 ft</span>");
    expect(pillars).toContain("× 2 ft (Beam)");
    expect(pillars).not.toContain("× 12 ft (Beam)");
  });
  it("the Beams card itself does not mark its own pieces", () => {
    const html = buildDeptBookHtml(ctx);
    const i = html.indexOf("🔗 ");
    expect(i).toBeGreaterThan(0);
    expect(html.slice(i, i + 600)).not.toContain("(Beam)");
  });
});

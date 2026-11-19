import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";
import { validDecision, carpetKey } from "./carpetPlan";
import { CARPET_OFF } from "../studio/taxonomy";

// The IMS Dept Ops download no longer stops on "Carpet not selected" (owner 2026-11-19, commit c90df4ad): the book is built whether or not
// Planning decided each carpet floor. These prove the book itself copes with an UNDECIDED floor: it shows sales' 1st-ranked pick (or the
// material and sqft when sales ranked nothing, or no card when there is no carpet), and never throws.

const inventory = [
  { id: "c1", name: "Maroon Carpet", category: "Carpet", subCat: "Carpet", qty: 5000 },
  { id: "c2", name: "Grey Carpet", category: "Carpet", subCat: "Carpet", qty: 5000 },
  { id: "c3", name: "Cream Carpet", category: "Carpet", subCat: "Carpet", qty: 5000 },
];
const floorZone = (o = {}) => ({ floorDims: { L: 20, W: 20 }, plH: "4in", cpT: "old", ...o });
const prefs3 = [{ id: "c1", name: "Maroon Carpet" }, { id: "c2", name: "Grey Carpet" }, { id: "c3", name: "Cream Carpet" }];

const ctxOf = ({ zones, deptOps, dept = "Tenting", date = "2026-12-01", settings = {}, extra = {} }) => {
  const fn = { type: "Wedding", date, venue: "", enabledEls: Object.fromEntries(Object.keys(zones).map((k) => [k, true])), elements: {}, zones };
  return {
    dept, sel: { id: "e1", clientName: "Test", date, functionsDetail: [fn], deptInventory: {}, ...(deptOps !== undefined ? { deptOps } : {}) },
    inventory, blocks: {}, settings, trussInv: {}, catToDept: () => "Tenting", authUser: { name: "x" },
    flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
    blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
    trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}),
    // the book must not need the plan: if it called these they would throw
    carpetPlanOf: () => { throw new Error("carpetPlanOf must not be needed to build the book"); },
    elementPlanOf: () => ({ rows: [] }),
    zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
    ...extra,
  };
};
const build = (c, opts = {}) => buildDeptBookHtml(c, {}, {}, opts);
// one carpet card per match; count occurrences of a carpet name as a card title
const count = (html, s) => html.split(s).length - 1;

describe("Dept Book with NO carpet decision (the IMS download no longer waits for one)", () => {
  it("three ranked picks, no decision at all (deptOps absent): only the 1st choice is printed, labelled as sales' 1st choice", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) } }));
    expect(html).toContain("Maroon Carpet");
    expect(html).not.toContain("Grey Carpet");
    expect(html).not.toContain("Cream Carpet");
    expect(html).toContain("1st choice");
    expect(html).not.toContain("To use");
  });
  it.each([
    ["deptOps.Tenting without carpetChoice", { Tenting: {} }],
    ["carpetChoice = {}", { Tenting: { carpetChoice: {} } }],
    ["carpetChoice = null", { Tenting: { carpetChoice: null } }],
    ["deptOps = null", null],
    ["an empty decision entry", { Tenting: { carpetChoice: { "0|stage|0": {} } } }],
    ["a decision with no id and not 'other'", { Tenting: { carpetChoice: { "0|stage|0": { date: "2026-12-01" } } } }],
    ["a decision whose date no longer matches the function (stale)", { Tenting: { carpetChoice: { "0|stage|0": { id: "c2", date: "2026-11-01" } } } }],
    ["a decision whose function type no longer matches", { Tenting: { carpetChoice: { "0|stage|0": { id: "c2", fnType: "Reception" } } } }],
  ])("%s: counts as undecided - 1st choice shown, no throw", (_n, deptOps) => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) }, deptOps }));
    expect(html).toContain("Maroon Carpet");
    expect(html).not.toContain("Grey Carpet");
    expect(html).toContain("1st choice");
  });
  it("the same book WITH a decision for the 2nd choice prints that one as 'To use' (the decided path is unchanged)", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) }, deptOps: { Tenting: { carpetChoice: { "0|stage|0": { id: "c2", date: "2026-12-01" } } } } }));
    expect(html).toContain("Grey Carpet");
    expect(html).not.toContain("Maroon Carpet");
    expect(html).toContain("To use");
  });
  it("Deal Check's own run (dealCheckMode) ignores even a made decision - it lists what sales asked for", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) }, deptOps: { Tenting: { carpetChoice: { "0|stage|0": { id: "c2", date: "2026-12-01" } } } }, extra: { dealCheckMode: true } }));
    expect(html).toContain("Maroon Carpet");
    expect(html).not.toContain("Grey Carpet");
  });
  it("no stock pick ranked, material is Carpet Old: still a card with the material and the sqft, not an error", () => {
    const html = build(ctxOf({ zones: { stage: floorZone() }, settings: { carpetMaterials: [{ id: "old", name: "Carpet Old", ratePerSqft: 7 }] } }));
    expect(html).toContain("Carpet Old");
    expect(html).toContain("400");
    expect(html).toContain("To lay");
  });
  it("sales picked a non-stock material (Flex): the material card shows, no stock pick expected", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpT: "flex" }) }, settings: { carpetMaterials: [{ id: "flex", name: "Flex", ratePerSqft: 9 }] } }));
    expect(html).toContain("Flex");
    expect(html).toContain("To lay");
  });
  it("carpet switched off (None): no carpet card, no throw", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ cpT: CARPET_OFF, cpPrefs: prefs3, cpInvId: "c1" }) } }));
    expect(html).not.toContain("Maroon Carpet");
    expect(html).not.toContain("To lay");
  });
  it("a floor with no size has no carpet to lay: no card, no throw", () => {
    const html = build(ctxOf({ zones: { stage: floorZone({ floorDims: {}, cpPrefs: prefs3, cpInvId: "c1" }) } }));
    expect(html).not.toContain("Maroon Carpet");
  });
  it("a zone with no carpet fields at all builds", () => {
    expect(() => build(ctxOf({ zones: { stage: { dims: { L: 10, W: 10, H: 10 } } } }))).not.toThrow();
  });
  it("an extra platform floor with no decision shows its own 1st choice (floor 2), the same carpet merges into one card", () => {
    const z = floorZone({ cpPrefs: [prefs3[0]], cpInvId: "c1", extraPlatformRows: [floorZone({ cpPrefs: [prefs3[0], prefs3[1]], cpInvId: "c1" })] });
    const html = build(ctxOf({ zones: { stage: z } }));
    expect(html).toContain("Maroon Carpet");
    expect(html).not.toContain("Grey Carpet");
    expect(count(html, "Maroon Carpet")).toBe(1); // one card for the same carpet on two floors
    expect(html).toContain("800"); // 400 + 400 sqft added up
  });
  it("floor 1 decided, floor 2 undecided: each prints its own state", () => {
    const z = floorZone({ cpPrefs: prefs3, cpInvId: "c1", extraPlatformRows: [floorZone({ cpPrefs: [prefs3[2], prefs3[0]], cpInvId: "c3" })] });
    const html = build(ctxOf({ zones: { stage: z }, deptOps: { Tenting: { carpetChoice: { "0|stage|0": { id: "c2", date: "2026-12-01" } } } } }));
    expect(html).toContain("Grey Carpet"); // floor 1: decided
    expect(html).toContain("Cream Carpet"); // floor 2: 1st choice
    expect(html).not.toContain("Maroon Carpet");
  });
  it("'arranged separately' decision prints its card (decided path); an undecided floor next to it still prints", () => {
    const z = floorZone({ cpPrefs: prefs3, cpInvId: "c1", extraPlatformRows: [floorZone({ cpPrefs: prefs3, cpInvId: "c1" })] });
    const html = build(ctxOf({ zones: { stage: z }, deptOps: { Tenting: { carpetChoice: { "0|stage|0": { other: true, date: "2026-12-01" } } } } }));
    expect(html).toContain("Carpet arranged separately");
    expect(html).toContain("Maroon Carpet");
  });
  it("the all-departments (combined) book and the shared Fabric & Tenting book build with an undecided carpet too", () => {
    const c = ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) } });
    expect(build(c, { combined: true })).toContain("Maroon Carpet");
    expect(build(c, { depts: ["Fabric", "Tenting"] })).toContain("Maroon Carpet");
  });
  it("the Fabric-only book carries no carpet card at all", () => {
    const html = build(ctxOf({ dept: "Fabric", zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) } }));
    expect(html).not.toContain("Maroon Carpet");
  });
  it("a Hindi book builds with an undecided carpet", () => {
    expect(() => build(ctxOf({ zones: { stage: floorZone({ cpPrefs: prefs3, cpInvId: "c1" }) } }), { lang: "hi" })).not.toThrow();
  });
});

describe("validDecision / carpetKey: missing decisions are null, never a throw", () => {
  const floor = { date: "2026-12-01", fnLabel: "Wedding" };
  it("returns null for undefined / null / {} / id-less entries", () => {
    for (const e of [undefined, null, {}, { date: "2026-12-01" }, { id: "" }, { id: null, other: false }]) expect(validDecision(e, floor)).toBeNull();
  });
  it("a decision with id or other applies; a different date or function type drops it; no date on either side keeps it", () => {
    expect(validDecision({ id: "c1" }, floor)).toEqual({ id: "c1" });
    expect(validDecision({ other: true }, floor)).toEqual({ other: true });
    expect(validDecision({ id: "c1", date: "2026-12-02" }, floor)).toBeNull();
    expect(validDecision({ id: "c1", fnType: "Reception" }, floor)).toBeNull();
    expect(validDecision({ id: "c1", date: "2026-12-01", fnType: "Wedding" }, floor)).not.toBeNull();
    expect(validDecision({ id: "c1", date: "2026-12-01" }, {})).not.toBeNull();
    expect(validDecision({ id: "c1" }, undefined)).not.toBeNull();
  });
  it("carpetKey is fn|zone|floor", () => {
    expect(carpetKey(0, "stage", 1)).toBe("0|stage|1");
  });
});

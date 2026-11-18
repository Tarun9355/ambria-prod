import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDeptBookHtml } from "./deptBookHtml";
import { resolvePillarHeight, resolveBeamSegment } from "./trussEngine";
import { uiHindi } from "./uiHindi";

// More cases for the pillar-made-up-with-a-ground-beam tag (owner ask 2026-11-18): the Dept Book's Pillars card lists the ground
// spacer as "n × L ft (Beam)", apart from same-length pillars, and IMS Planning's truss editor groups the same way.

// ── Dept Book ────────────────────────────────────────────────────────────────
const fnOf = (zones) => ({ type: "Engagement", date: "2026-11-19", venue: "", enabledEls: Object.fromEntries(Object.keys(zones).map(k => [k, true])), elements: {}, zones });
const ctxOf = ({ trussInv, plan, zones, deptOps, lang }) => {
  const fn = fnOf(zones);
  return {
    dept: "Tenting", sel: { id: "e1", clientName: "Test", date: "2026-11-19", functionsDetail: [fn], deptInventory: {}, ...(deptOps ? { deptOps } : {}) },
    inventory: [], blocks: {}, settings: {}, trussInv, catToDept: () => "Tenting", authUser: { name: "x" },
    flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
    blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
    trussPlanOf: () => plan.map(p => ({ row: zones[p.zk], fi: 0, zk: p.zk, ri: p.ri || 0, key: `0|${p.zk}|${p.ri || 0}`, pv: p.pv })),
    fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
    zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [],
    _lang: lang,
  };
};
const build = (c) => buildDeptBookHtml(c, {}, {}, c._lang ? { lang: c._lang } : {});
const pvOf = (pillarHs, beamLens = [12]) => ({ topology: { pillars: pillarHs.map(H => ({ H })), beams: beamLens.map(lengthFt => ({ lengthFt })) }, batta: { rftWithBuffer: 0, bufferPct: 10 } });
const zone = { trT: "singleU", dims: { L: 27.5, W: 12, H: 14 } };

// every truss card on the book, as { icon, count, lines: ["n × L ft ...", ...] }
const cards = (html) => html.split('<div class="ztk-c">').slice(1).map(chunk => {
  const head = /<div class="ztk-h"><span>(\S+)[^<]*<\/span>(?:<b>([^<]*)<\/b>)?/.exec(chunk);
  const lines = [...chunk.matchAll(/<div class="ztk-l(?: ztk-miss)?"><b>([^<]*)<\/b><span>([^<]*)<\/span><\/div>/g)].map(m => `${m[1]} ${m[2]}`);
  return { icon: head?.[1], count: head?.[2] != null ? Number(head[2]) : null, lines };
});
const pillarCards = (html) => cards(html).filter(c => c.icon === "🏛️");
const beamCards = (html) => cards(html).filter(c => c.icon === "🔗");

describe("Dept Book: pillar made up with ground beams", () => {
  // pillars 10/12, beams 2/3/12: 12 exact, 14 = 12+2, 15 = 12+3, 10 exact, 16 = 12+2+2 (two spacers), 9 can't be made
  const trussInv = { pillars: { 10: 20, 12: 20 }, beams: { 12: 20, 3: 20, 2: 20 } };
  it("sanity: the resolver builds 16 ft as a 12 ft pillar + two 2 ft ground beams", () => {
    const r = resolvePillarHeight(16, trussInv);
    expect(r.pieces.filter(p => p.type === "beam").map(p => p.size)).toEqual([2, 2]);
    expect(r.pieces.find(p => p.type === "pillar").size).toBe(12);
  });

  it("several heights in one zone: exact, single-spacer, two-spacer and missing, grouped by kind", () => {
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([12, 14, 14, 15, 10, 16, 9]) }] });
    const [p] = pillarCards(build(c));
    expect(p.lines).toEqual([
      "5 × 12 ft",          // 12 + (14,14,15,16 tops)
      "1 × 10 ft",
      "1 × 3 ft (Beam)",    // 15's spacer
      "4 × 2 ft (Beam)",    // 14 ×2 + 16's two spacers
      "1 × 9 ft ⚠ not in stock",
    ]);
    // the card's count still includes every ground beam (and the missing one, as before)
    expect(p.count).toBe(5 + 1 + 1 + 4 + 1);
  });

  it("a height that cannot be made is a missing row with no Beam tag", () => {
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([9, 9]) }] });
    const [p] = pillarCards(build(c));
    expect(p.lines).toEqual(["2 × 9 ft ⚠ not in stock"]);
  });

  it("a real 2 ft pillar in stock and a 2 ft ground beam are separate rows, pillar first", () => {
    const inv = { pillars: { 2: 10, 12: 10 }, beams: { 2: 10, 12: 10 } };
    const c = ctxOf({ trussInv: inv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([2, 2, 14]) }] });
    const [p] = pillarCards(build(c));
    expect(p.lines).toEqual(["1 × 12 ft", "2 × 2 ft", "1 × 2 ft (Beam)"]);
    expect(p.count).toBe(4);
  });

  it("the Beams card never carries the tag, even when it holds a 2 ft beam", () => {
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([14, 14], [14]) }] });
    const html = build(c);
    const [b] = beamCards(html);
    expect(b.lines.join("|")).not.toContain("Beam");
    expect(resolveBeamSegment(14, trussInv).pieces.length).toBeGreaterThan(0);
  });

  it("several truss rows and zones each get their own grouping", () => {
    const zones = { stage: zone, entrance: zone };
    const c = ctxOf({ trussInv, zones, plan: [
      { zk: "stage", pv: pvOf([14, 14]) },
      { zk: "stage", ri: 1, pv: pvOf([12, 12]) },
      { zk: "entrance", pv: pvOf([15, 16]) },
    ] });
    const html = build(c);
    const ps = pillarCards(html).map(p => p.lines);
    expect(ps).toHaveLength(3);
    expect(ps).toContainEqual(["2 × 12 ft", "2 × 2 ft (Beam)"]);
    expect(ps).toContainEqual(["2 × 12 ft"]);
    expect(ps).toContainEqual(["2 × 12 ft", "1 × 3 ft (Beam)", "2 × 2 ft (Beam)"]);
  });

  it("the Hindi book shows the Hindi word for the tag", () => {
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([14, 14, 12]) }], lang: "hi" });
    const html = build(c);
    const [p] = pillarCards(html);
    expect(p.lines.some(l => l.includes("(बीम)") && l.startsWith("2 × 2 ft"))).toBe(true);
    expect(p.lines.join("|")).not.toContain("(Beam)");
  });

  it("an edited plan: beam-flagged and same-length pillar groups both show, and the count is their sum", () => {
    const deptOps = { Tenting: { trussPlan: { "0|stage|0": { pillars: [{ len: 12, n: 4 }, { len: 2, n: 1 }, { len: 2, n: 3, beam: true }] } } } };
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([14, 14]) }], deptOps });
    const [p] = pillarCards(build(c));
    expect(p.lines).toEqual(["4 × 12 ft", "1 × 2 ft", "3 × 2 ft (Beam)"]);
    expect(p.count).toBe(8);
  });

  it("an old edited plan saved before the tag (merged groups, no flag) still prints, untagged", () => {
    const deptOps = { Tenting: { trussPlan: { "0|stage|0": { pillars: [{ len: 12, n: 2 }, { len: 2, n: 2 }] } } } };
    const c = ctxOf({ trussInv, zones: { stage: zone }, plan: [{ zk: "stage", pv: pvOf([14, 14]) }], deptOps });
    const [p] = pillarCards(build(c));
    expect(p.lines).toEqual(["2 × 12 ft", "2 × 2 ft"]);
  });
});

// ── IMS Planning truss editor (DepartmentOpsTab.jsx) — the shipped lines, sliced out of the file ──
const opsSrc = readFileSync(resolve(__dirname, "../../pages/ims/DepartmentOpsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
const lineOf = (startsWith) => {
  const i = opsSrc.indexOf(startsWith);
  if (i < 0) throw new Error(`not found in DepartmentOpsTab.jsx: ${startsWith}`);
  return opsSrc.slice(i, opsSrc.indexOf("\n", i));
};
const realGroupsSrc = lineOf("const realGroupsOf = (arr, resolver, markBeams = false) =>");
const setGSrc = lineOf("const setG = (i, patch) =>");
const rftSrc = lineOf("const rftOfG = (gs) =>");
const countSrc = lineOf("const countOfG = (gs) =>");
// eslint-disable-next-line no-new-func
const planningGroups = (matInv) => new Function("matInv", `${realGroupsSrc}\nreturn realGroupsOf;`)(matInv);
// eslint-disable-next-line no-new-func
const makeSetG = (saveEd, groups, field = "pillars") => new Function("saveEd", "groups", "field", `${setGSrc}\nreturn setG;`)(saveEd, groups, field);
// eslint-disable-next-line no-new-func
const { rftOfG, countOfG } = new Function(`${rftSrc}\n${countSrc}\nreturn { rftOfG, countOfG };`)();

describe("IMS Planning truss editor: pillar groups", () => {
  const inv = { pillars: { 10: 20, 12: 20 }, beams: { 12: 20, 3: 20, 2: 20 } };
  const pillarsOf = (Hs, i = inv) => planningGroups(i)(Hs.map(H => ({ H })), (p, m) => resolvePillarHeight(p.H, m), true);

  it("groups exact, one-spacer and two-spacer pillars like the PDF, beams tagged", () => {
    expect(pillarsOf([12, 14, 14, 15, 10, 16])).toEqual([
      { len: 12, n: 5 }, { len: 10, n: 1 }, { len: 3, n: 1, beam: true }, { len: 2, n: 4, beam: true },
    ]);
  });

  it("a height that cannot be made gives no row (it is listed under the tiles instead)", () => {
    expect(pillarsOf([9])).toEqual([]);
  });

  it("a real 2 ft pillar and a 2 ft ground beam stay apart, pillar first", () => {
    const i2 = { pillars: { 2: 5, 12: 5 }, beams: { 2: 5 } };
    expect(pillarsOf([2, 14], i2)).toEqual([{ len: 12, n: 1 }, { len: 2, n: 1 }, { len: 2, n: 1, beam: true }]);
  });

  it("the beams list (markBeams off) is never tagged", () => {
    const g = planningGroups(inv)([{ lengthFt: 14 }, { lengthFt: 2 }], (b, m) => resolveBeamSegment(b.lengthFt, m));
    expect(g.some(x => x.beam)).toBe(false);
  });

  it("editing a beam row keeps beam: true in what is saved; editing a pillar row does not add it", () => {
    const groups = pillarsOf([14, 14, 12]); // [{12,3},{2,2,beam}]
    let saved = null;
    const setG = makeSetG((patch) => { saved = patch; }, groups);
    setG(1, { n: 3 });
    expect(saved.pillars).toEqual([{ len: 12, n: 3 }, { len: 2, n: 3, beam: true }]);
    setG(0, { len: 15 });
    expect(saved.pillars[0]).toEqual({ len: 15, n: 3 });
    expect(saved.pillars[1]).toEqual({ len: 2, n: 2, beam: true });
  });

  it("pillar RFT and piece count of the groups still include the ground beams (matches the engine's ideal pillar RFT)", () => {
    const Hs = [14, 14, 16, 12];
    const groups = pillarsOf(Hs);
    expect(rftOfG(groups)).toBe(Hs.reduce((a, h) => a + h, 0)); // = calcZoneTrussPreview's costs.pillarRft (sum of p.H)
    expect(countOfG(groups)).toBe(4 + 2 + 2); // 4 top pillars + 4 ground beams
  });
});

describe("Hindi screen text of the Planning 'Beam' tag", () => {
  it("uiHindi turns the tag into Devanagari", () => {
    expect(uiHindi("Beam")).toBe("बीम");
  });
});

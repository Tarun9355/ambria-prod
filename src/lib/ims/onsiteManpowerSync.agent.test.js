import { describe, it, expect } from "vitest";
import {
  buildDeptCrew, setMpPatch, addMpPatch, removeMpPatch, actualCrewPatch, resetLinePatch, mpDayPatch, resetMpDayPatch,
  shiftCountPatch, shiftSplitPatch, addDihariPatch, removeDihariPatch, applyDeptOpsPatch, eventLabourTotalDeptOps,
} from "./deptCrew";
import { stampDeptChanges, eventChanges, sectionOfKey, SECTION_LABEL, CHANGE_WINDOW_MS } from "./recentChanges";
import { catToDept } from "./deptClassify";

// Owner ask 2026-11-20 (commit abcefdb5): the Site-Supervisor-view-only role edits the crew in the Department Head's own
// "Manpower plan" panel (setMpPatch / addMpPatch / removeMpPatch / mpDayPatch / resetMpDayPatch / shift + split + dihari patches)
// instead of the old "On-site crew" card (actualCrewPatch / resetLinePatch). Both screens must read and write the same
// deptOps[dept] fields, and every write must be stamped into deptOps[dept].changes (stampDeptChanges) for the activity log.
const D1 = "2026-12-04", D2 = "2026-12-05";
const baseSel = (deptOps = {}) => ({
  id: "E1",
  functionsDetail: [{ date: D1, shift: "evening", type: "Wedding" }, { date: D2, shift: "evening", type: "Reception" }],
  manpowerDetail: {
    Floral: [
      { type: "Flowerists", count: 3, rate: 600, cost: 1800, shared: false, schedule: null },
      { type: "Labours", count: 4, rate: 500, cost: 4000, shared: false, schedule: [
        { date: D1, phase: "event", count: 4, windows: 1, windowIds: ["w1"] },
        { date: D2, phase: "event", count: 4, windows: 1, windowIds: ["w1"] },
      ] },
    ],
    Lighting: [{ type: "Electricians", count: 2, rate: 1000, cost: 2000, shared: false, schedule: null }],
  },
  deptOps,
});
const settings = { dihariSchemes: { Labours: { rate: 500, windows: [{ id: "w1", label: "9 AM - 6 PM" }, { id: "w2", label: "6 PM - 2 AM" }] } } };
const build = (sel, dept = "Floral") => buildDeptCrew({ sel, dept, settings, inventory: [], flowerPatterns: [], catToDept: (c) => catToDept(c, {}) });
const rowOf = (crew, type) => { const r = crew.mpRows.find((x) => x.type === type); return { r, i: crew.mpRows.indexOf(r) }; };
// DepartmentOpsTab.writeDept, line for line: merge the patch, stamp updatedAt/By and the changes section(s)
const writeDept = (eo, dept, patch, by, at = Date.now()) => {
  const ops = { ...(eo.deptOps || {}) };
  ops[dept] = { ...(ops[dept] || {}), ...patch, updatedAt: at, updatedBy: by, changes: stampDeptChanges(ops[dept]?.changes, patch, at, by) };
  return { ...eo, deptOps: ops };
};

describe("both-ways data sharing: Manpower plan panel <-> old On-site crew card read and write the same deptOps fields", () => {
  it("a plain head-count row: setMpPatch(count) and actualCrewPatch write the same field with the same value", () => {
    const crew = build(baseSel());
    const { r, i } = rowOf(crew, "Flowerists");
    const viaPlan = setMpPatch(crew, i, "count", "5"); // the panel's onChange hands the raw string
    const viaOnsite = actualCrewPatch(crew, r, i, "5"); // the card coerces to a number
    expect(Object.keys(viaPlan)).toEqual(["mpOverrides"]);
    expect(Object.keys(viaOnsite)).toEqual(["mpOverrides"]);
    expect(Number(viaPlan.mpOverrides.Flowerists.count)).toBe(5);
    expect(viaOnsite.mpOverrides.Flowerists.count).toBe(5);
  });
  it("supervisor edits in the Manpower plan -> a Department Head view (rebuild) and the On-site crew card show the same count and cost", () => {
    const sel0 = baseSel();
    const crew0 = build(sel0);
    const { i } = rowOf(crew0, "Flowerists");
    const sel1 = writeDept(sel0, "Floral", setMpPatch(crew0, i, "count", "5"), "Raja");
    const dhView = build(sel1), onsiteView = build(sel1);
    expect(Number(rowOf(dhView, "Flowerists").r.count)).toBe(5);
    expect(Number(rowOf(onsiteView, "Flowerists").r.count)).toBe(5); // the card's "People" box reads Number(r.count)
    expect(dhView.mpCost).toBe(onsiteView.mpCost);
    expect(dhView.mpCost).toBe(Math.round(1800 * (5 / 3)) + 4000); // 3000 + 4000
    expect(dhView.mpEdited).toBe(true);
  });
  it("...and the other way: the old card's People edit shows in the Manpower plan row, and stamps the same section", () => {
    const sel0 = baseSel();
    const crew0 = build(sel0);
    const { r, i } = rowOf(crew0, "Flowerists");
    const sel1 = writeDept(sel0, "Floral", actualCrewPatch(crew0, r, i, 7), "Sunil");
    expect(Number(rowOf(build(sel1), "Flowerists").r.count)).toBe(7);
    expect(sel1.deptOps.Floral.changes.mp.by).toBe("Sunil");
    expect(sel1.deptOps.Floral.changes.oscrew).toBeUndefined(); // there is no 'oscrew' stamp: ONSITE_SECTIONS lists it, no save key maps to it
  });
  it("rate edit: only the Manpower plan has the box; the new rate costs the same in both views", () => {
    const sel0 = baseSel();
    const crew0 = build(sel0);
    const { i } = rowOf(crew0, "Flowerists");
    const sel1 = writeDept(sel0, "Floral", setMpPatch(crew0, i, "rate", "700"), "Raja");
    const c = build(sel1);
    expect(rowOf(c, "Flowerists").r.rate).toBe("700");
    expect(c.lineCost(rowOf(c, "Flowerists").r)).toBe(Math.round(1800 * (700 / 600))); // 2100
  });
  it("day-wise row: the card's single People value (actualCrewPatch) is every day in the panel; a per-day edit then shows as the card's dihari", () => {
    const sel0 = baseSel();
    const crew0 = build(sel0);
    const { r, i } = rowOf(crew0, "Labours");
    expect(crew0.lineCost(r)).toBe(4000); // 4 crew x 1 shift x 2 days x 500
    const sel1 = writeDept(sel0, "Floral", actualCrewPatch(crew0, r, i, 6), "Sunil");
    const c1 = build(sel1); const r1 = rowOf(c1, "Labours").r;
    r1.schedule.forEach((d) => expect(Math.round(c1.effDay(r1, d))).toBe(6)); // what the panel's day boxes show
    expect(c1.lineCost(r1)).toBe(6000); // 6 x 2 days x 500
    expect(Math.round(c1.lineCost(r1) / Number(r1.rate))).toBe(12); // the card's "Dihari" pill
    // a supervisor then edits ONE day in the Manpower plan (mpDayPatch, canManpower)
    const sel2 = writeDept(sel1, "Floral", mpDayPatch(c1, "Labours", D2, "2"), "Raja");
    const c2 = build(sel2); const r2 = rowOf(c2, "Labours").r;
    expect(Math.round(c2.effDay(r2, r2.schedule[0]))).toBe(6);
    expect(Math.round(c2.effDay(r2, r2.schedule[1]))).toBe(2);
    expect(c2.lineCost(r2)).toBe(4000); // (6 + 2) x 500
    expect(Math.round(c2.lineCost(r2) / Number(r2.rate))).toBe(8); // card dihari agrees
  });
  it("resetMpDayPatch (the panel's ↺) restores the system plan for that day, so mpDay edits made on the card disappear from both", () => {
    const sel0 = baseSel({ Floral: { mpDay: { Labours: { [D1]: 9, [D2]: 9 } } } });
    const c0 = build(sel0);
    expect(c0.lineCost(rowOf(c0, "Labours").r)).toBe(9000);
    const sel1 = writeDept(sel0, "Floral", resetMpDayPatch(c0, "Labours", D1), "Raja");
    const c1 = build(sel1);
    expect(sel1.deptOps.Floral.mpDay.Labours[D1]).toBeUndefined();
    expect(sel1.deptOps.Floral.mpDay.Labours[D2]).toBe(9);
    expect(c1.lineCost(rowOf(c1, "Labours").r)).toBe(4 * 500 + 9 * 500);
    expect(sel1.deptOps.Floral.changes.mp.by).toBe("Raja");
  });
  it("the old card's ↺ Back to plan (resetLinePatch) clears what the Manpower plan set, for that crew type only", () => {
    const sel0 = baseSel();
    const c0 = build(sel0);
    const sel1 = writeDept(writeDept(sel0, "Floral", setMpPatch(c0, rowOf(c0, "Flowerists").i, "count", "9"), "Raja"), "Floral", setMpPatch(build(sel0), rowOf(c0, "Labours").i, "rate", "800"), "Raja");
    const c1 = build(sel1);
    expect(c1.mpEdited).toBe(true);
    const sel2 = writeDept(sel1, "Floral", resetLinePatch(c1, rowOf(c1, "Flowerists").r), "Sunil");
    const c2 = build(sel2);
    expect(Number(rowOf(c2, "Flowerists").r.count)).toBe(3);
    expect(rowOf(c2, "Labours").r.rate).toBe("800"); // untouched
  });
  it("+ Add crew type / x remove (a department whose snapshot has no Labours row): the added row is shared by both views and its count edit lands in mpExtra", () => {
    const sel0 = baseSel();
    const c0 = build(sel0, "Lighting");
    const sel1 = writeDept(sel0, "Lighting", addMpPatch(c0), "Raja");
    const c1 = build(sel1, "Lighting");
    const added = c1.mpRows.find((x) => x._addedExtra);
    expect(added).toBeTruthy();
    const sel2 = writeDept(sel1, "Lighting", setMpPatch(c1, c1.mpRows.indexOf(added), "count", "2"), "Raja");
    const c2 = build(sel2, "Lighting");
    expect(Number(c2.mpRows.find((x) => x._addedExtra).count)).toBe(2);
    const sel3 = writeDept(sel2, "Lighting", removeMpPatch(c2, c2.mpRows.find((x) => x._addedExtra)), "Raja");
    expect(build(sel3, "Lighting").mpRows.some((x) => x._addedExtra)).toBe(false);
    expect(sel3.deptOps.Lighting.changes.mp.by).toBe("Raja");
  });
  it("RISK (pre-existing): '+ Add crew type' always adds type 'Labours'; where the snapshot already has a Labours row (Floral, Structure) the new mpExtra entry is filtered out of mpRows - nothing appears, yet a Manpower plan change is stamped", () => {
    const sel0 = baseSel();
    const sel1 = writeDept(sel0, "Floral", addMpPatch(build(sel0)), "Raja");
    expect(sel1.deptOps.Floral.mpExtra).toHaveLength(1);
    expect(build(sel1).mpRows.some((x) => x._addedExtra)).toBe(false);
    expect(build(sel1).mpEdited).toBe(true);
    expect(sel1.deptOps.Floral.changes.mp.by).toBe("Raja");
  });
  it("another department's deptOps are never touched by a supervisor's write", () => {
    const sel0 = baseSel({ Structure: { mpOverrides: { Carpenters: { count: 9 } }, updatedBy: "Ajay" } });
    const c0 = build(sel0);
    const sel1 = writeDept(sel0, "Floral", setMpPatch(c0, rowOf(c0, "Flowerists").i, "count", "5"), "Raja");
    expect(sel1.deptOps.Structure).toEqual(sel0.deptOps.Structure);
  });
});

describe("activity log: stampDeptChanges + eventChanges for the Manpower plan", () => {
  const AT = 1_800_000_000_000;
  it("every Manpower save key is the 'mp' section, labelled 'Manpower plan'", () => {
    for (const k of ["mp", "mpOverrides", "mpExtra", "mpDay", "mpWin", "mpWinCount", "mpWinBasis"]) {
      expect(sectionOfKey(k), k).toBe("mp");
      expect(stampDeptChanges(undefined, { [k]: 1 }, AT, "Raja"), k).toEqual({ mp: { at: AT, by: "Raja" } });
    }
    expect(SECTION_LABEL.mp).toBe("Manpower plan");
  });
  it("bookkeeping keys are never a change (mpSeen, updatedAt, updatedBy, changes, seen, changesSeen)", () => {
    for (const k of ["mpSeen", "updatedAt", "updatedBy", "changes", "seen", "changesSeen"]) expect(stampDeptChanges({ actuals: { at: 1, by: "x" } }, { [k]: 1 }, AT, "Raja"), k).toEqual({ actuals: { at: 1, by: "x" } });
    expect(stampDeptChanges(undefined, { mpSeen: { sig: "a" }, mpDay: {} }, AT, "Raja")).toEqual({ mp: { at: AT, by: "Raja" } }); // a real key next to a bookkeeping one still stamps
  });
  it("a missing editor name is stamped '—', never undefined", () => {
    expect(stampDeptChanges(undefined, { mpDay: {} }, AT, undefined).mp.by).toBe("—");
    expect(stampDeptChanges(undefined, { mpDay: {} }, AT, "").mp.by).toBe("—");
  });
  it("a later save overwrites the stamp (newest editor / time); other sections keep theirs", () => {
    const first = stampDeptChanges({ truck: { at: 5, by: "T" } }, { mpOverrides: {} }, AT, "Raja");
    const second = stampDeptChanges(first, { mpDay: {} }, AT + 1000, "Sunil");
    expect(second).toEqual({ truck: { at: 5, by: "T" }, mp: { at: AT + 1000, by: "Sunil" } });
  });
  // every key EVERY patch builder the Manpower plan panel calls can write must land in the Manpower plan section
  const crew = build(baseSel({ Floral: { mpWinCount: { Labours: { [D1]: { w1: 2 } } }, mpWinSplit: { Labours: { [D1]: { w1: { vendor: 1 } } } } } }));
  const lab = rowOf(crew, "Labours"), flo = rowOf(crew, "Flowerists");
  const builders = {
    setMpPatch: () => setMpPatch(crew, flo.i, "count", 4),
    addMpPatch: () => addMpPatch(crew),
    removeMpPatch: () => { const c = build(writeDept(baseSel(), "Lighting", addMpPatch(build(baseSel(), "Lighting")), "x"), "Lighting"); return removeMpPatch(c, c.mpRows.find((x) => x._addedExtra)); },
    actualCrewPatch: () => actualCrewPatch(crew, lab.r, lab.i, 3),
    resetLinePatch: () => resetLinePatch(crew, lab.r),
    mpDayPatch: () => mpDayPatch(crew, "Labours", D1, 3),
    resetMpDayPatch: () => resetMpDayPatch(crew, "Labours", D1),
    shiftCountPatch: () => shiftCountPatch(crew, "Labours", D1, "w1", "3", ["w1"]),
    addDihariPatch: () => addDihariPatch(crew, lab.r, D1, ["w1"]),
    removeDihariPatch: () => removeDihariPatch(crew, "Labours", D1, "w1", ["w1", "w2"]),
    shiftSplitPatch: () => shiftSplitPatch(crew, "Labours", D1, "w1", { vendor: 1, vendorName: "Sharma Tent House" }),
  };
  Object.entries(builders).forEach(([name, make]) => {
    it(`${name}: every key it writes (but mpWinSplit, see the BUG test) is stamped as the Manpower plan`, () => {
      const patch = make();
      expect(patch).toBeTruthy();
      const noSplit = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "mpWinSplit"));
      if (!Object.keys(noSplit).length) return; // shiftSplitPatch writes mpWinSplit alone - covered by the BUG test
      expect(Object.keys(stampDeptChanges(undefined, noSplit, AT, "Raja"))).toEqual(["mp"]);
      Object.keys(noSplit).forEach((k) => expect(sectionOfKey(k), `${name} writes '${k}'`).toBe("mp"));
    });
  });
  it("BUG: mpWinSplit (the in-house / vendor split of a shift, written by shiftSplitPatch, resetLinePatch, resetMpDayPatch, removeDihariPatch) is missing from recentChanges KEY_SECTION: a vendor-split edit is stamped as the generic 'Plan' (no Manpower plan badge) and a reset / remove-shift is stamped BOTH 'mp' AND a spurious 'plan'", () => {
    const writers = Object.entries(builders).filter(([, make]) => "mpWinSplit" in make()).map(([n]) => n);
    expect(writers.sort()).toEqual(["removeDihariPatch", "resetLinePatch", "resetMpDayPatch", "shiftSplitPatch"]);
    expect(sectionOfKey("mpWinSplit")).toBe("mp");
    writers.forEach((n) => expect(Object.keys(stampDeptChanges(undefined, builders[n](), AT, "Raja")), n).toEqual(["mp"]));
  });

  it("eventChanges: a Manpower edit by the supervisor is listed for that department inside 48 h, by the editor, newest first, then ages out", () => {
    let eo = baseSel();
    eo = writeDept(eo, "Floral", mpDayPatch(build(eo), "Labours", D1, 3), "Raja", AT - 3 * 3600 * 1000);
    eo = writeDept(eo, "Structure", { mpOverrides: { Carpenters: { count: 3 } } }, "Ajay", AT - 60 * 1000);
    const list = eventChanges(eo, [], AT);
    expect(list.map((c) => [c.dept, c.section, c.label, c.by])).toEqual([
      ["Structure", "mp", "Manpower plan", "Ajay"],
      ["Floral", "mp", "Manpower plan", "Raja"],
    ]);
    expect(eventChanges(eo, [], AT + CHANGE_WINDOW_MS - 3 * 3600 * 1000 + 1000).map((c) => c.by)).toEqual(["Ajay"]); // Raja's is now just over 48 h
    expect(eventChanges(eo, [], AT + CHANGE_WINDOW_MS + 3600 * 1000)).toEqual([]);
  });
  it("a Department Head who downloaded the book (changesSeen) no longer sees it; an admin / the supervisor (no key) still does; a later edit shows again", () => {
    let eo = writeDept(baseSel(), "Floral", mpDayPatch(build(baseSel()), "Labours", D1, 3), "Raja", AT - 1000);
    eo = { ...eo, deptOps: { ...eo.deptOps, Floral: { ...eo.deptOps.Floral, changesSeen: { head1: AT } } } };
    expect(eventChanges(eo, [], AT + 10, undefined, "head1")).toEqual([]);
    expect(eventChanges(eo, [], AT + 10, undefined, "")).toHaveLength(1);
    expect(eventChanges(eo, [], AT + 10, undefined, "head2")).toHaveLength(1);
    eo = writeDept(eo, "Floral", { mpOverrides: {} }, "Raja", AT + 5);
    expect(eventChanges(eo, [], AT + 10, undefined, "head1")).toHaveLength(1);
  });
  it("the same section edited again and again is one line (times counts repeats of the same stamp only when entries repeat)", () => {
    let eo = baseSel();
    for (let n = 0; n < 3; n++) eo = writeDept(eo, "Floral", { mpOverrides: { x: n } }, "Raja", AT - 1000 * (3 - n));
    expect(eventChanges(eo, [], AT)).toHaveLength(1); // one section per department, so the stamp itself is already one entry
  });
});

describe("RISK: writes that bypass writeDept's stamp (never reach the activity log / the Department Head's 48 h list)", () => {
  it("applyDeptOpsPatch (the Site tab's SiteCrewPanel write) merges crew edits into the same deptOps fields but stamps NO changes section", () => {
    const sel0 = baseSel();
    const c0 = build(sel0);
    const eo = applyDeptOpsPatch(sel0, "Floral", setMpPatch(c0, rowOf(c0, "Flowerists").i, "count", "6"), "Raja");
    expect(Number(rowOf(build(eo), "Flowerists").r.count)).toBe(6); // shared data: yes
    expect(eo.deptOps.Floral.updatedBy).toBe("Raja");
    expect(eo.deptOps.Floral.changes).toBeUndefined(); // activity log: no
    expect(eventChanges(eo, [], Date.now())).toEqual([]);
  });
  it("eventLabourTotalDeptOps (the On-site crew card's event-wide Labours total) stamps updatedBy but no changes section", () => {
    const sel0 = baseSel();
    const ops = eventLabourTotalDeptOps(sel0, 20, "Sunil");
    expect(ops.Floral.updatedBy).toBe("Sunil");
    expect(ops.Floral.changes).toBeUndefined();
  });
});

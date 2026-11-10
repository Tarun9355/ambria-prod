import { describe, it, expect } from "vitest";
import { buildDeptCrew, actualCrewPatch, resetLinePatch, setMpPatch, mpDayPatch, eventLabourInfo, eventLabourTotalDeptOps, applyDeptOpsPatch, DEPT_MP } from "./deptCrew";
import { catToDept } from "./deptClassify";

// These fixtures mirror what DepartmentOpsTab.jsx has always built mpRows from (Studio's
// manpowerDetail snapshot + a department's own deptOps edits) — the point of this suite is to
// pin the numbers so the extraction into this file can never silently drift from what the
// Planning and on-site crew panels showed before it existed.

const baseSel = (overrides) => ({
  functionsDetail: [{ date: "2026-12-04", shift: "evening", type: "Wedding" }],
  manpowerDetail: {
    Structure: [
      { type: "Labours", count: 6, rate: 1700, cost: 10200, shared: true, splitInfo: { byUsage: false, directTotal: 1, deptDirect: 1 }, schedule: [{ date: "2026-12-04", phase: "event", count: 6, windows: 1, windowIds: ["w1"] }] },
      { type: "Carpenters", count: 2, rate: 800, cost: 1600, shared: false, schedule: null },
    ],
    Floral: [
      { type: "Flowerists", count: 3, rate: 600, cost: 1800, shared: false, schedule: null },
    ],
  },
  deptOps: {},
  ...overrides,
});

const ctx = (sel, dept) => buildDeptCrew({ sel, dept, settings: {}, inventory: [], flowerPatterns: [], catToDept: (c) => catToDept(c, {}) });

describe("buildDeptCrew", () => {
  it("builds one row per snapshot crew type, with planned cost as the system baseline", () => {
    const crew = ctx(baseSel(), "Structure");
    expect(crew.mpRows.map(r => r.type)).toEqual(["Labours", "Carpenters"]);
    expect(crew.mpPlannedCost).toBe(10200 + 1600);
    expect(crew.mpCost).toBe(crew.mpPlannedCost); // unedited — actual equals planned
    expect(crew.mpEdited).toBe(false);
  });

  it("a department with no row for a crew type in the snapshot shows none (not the global defaults)", () => {
    // Tenting has no manpowerDetail entry in this fixture at all.
    const crew = ctx(baseSel(), "Tenting");
    expect(crew.mpRows).toEqual([]);
  });

  // Regression: buildDeptCrew's return object must carry every name DepartmentOpsTab.jsx destructures
  // from it (src/pages/ims/DepartmentOpsTab.jsx's `const { ... } = crew;` line) — a name missing here
  // silently resolves to `undefined` in the component (no lint/build error), which is exactly how
  // `mpDetailRaw` went missing and broke the "crew plan changed" alert + wrote bad mpSeen data.
  it("returns mpDetailRaw (the raw, un-slot-defaulted manpowerDetail[dept] array)", () => {
    const sel = baseSel();
    const crew = ctx(sel, "Structure");
    expect(crew.mpDetailRaw).toBe(sel.manpowerDetail.Structure);
  });

  it("DEPT_MP keeps Labours only under Floral and Structure (2026-11-07 pooling)", () => {
    expect(DEPT_MP.Tenting).not.toContain("Labours");
    expect(DEPT_MP.Lighting).not.toContain("Labours");
    expect(DEPT_MP.Structure).toContain("Labours");
    expect(DEPT_MP.Floral).toContain("Labours");
  });
});

describe("actualCrewPatch + applyDeptOpsPatch — the on-site 'actual held' write path", () => {
  it("a non-daywise row (Carpenters, no schedule) writes straight to mpOverrides.count", () => {
    const sel = baseSel();
    const crew = ctx(sel, "Structure");
    const row = crew.mpRows.find(r => r.type === "Carpenters");
    const i = crew.mpRows.indexOf(row);
    const patch = actualCrewPatch(crew, row, i, "5");
    expect(patch).toEqual({ mpOverrides: { Carpenters: { count: 5 } } });
    const eo2 = applyDeptOpsPatch(sel, "Structure", patch, "Ajay");
    expect(eo2.deptOps.Structure.mpOverrides.Carpenters.count).toBe(5);
    expect(eo2.deptOps.Structure.updatedBy).toBe("Ajay");
  });

  it("a daywise shared row (Labours, has a schedule) sets every scheduled day's mpDay and clears any per-shift override", () => {
    const sel = baseSel({ deptOps: { Structure: { mpWinCount: { Labours: { "2026-12-04": { w1: 9 } } } } } });
    const crew = ctx(sel, "Structure");
    const row = crew.mpRows.find(r => r.type === "Labours");
    const i = crew.mpRows.indexOf(row);
    const patch = actualCrewPatch(crew, row, i, "4");
    expect(patch.mpDay).toEqual({ Labours: { "2026-12-04": 4 } });
    expect(patch.mpWinCount).toEqual({}); // the per-shift override is dropped, same as before extraction
  });

  it("resetLinePatch drops every edit for that crew type only", () => {
    const sel = baseSel({ deptOps: { Structure: { mpOverrides: { Carpenters: { count: 5 }, Labours: { rate: 2000 } }, mpDay: { Labours: { "2026-12-04": 4 } } } } });
    const crew = ctx(sel, "Structure");
    const row = crew.mpRows.find(r => r.type === "Labours");
    const patch = resetLinePatch(crew, row);
    expect(patch.mpOverrides.Labours).toBeUndefined();
    expect(patch.mpOverrides.Carpenters).toEqual({ count: 5 }); // untouched
    expect(patch.mpDay.Labours).toBeUndefined();
  });
});

describe("setMpPatch — planning-side count/rate edits", () => {
  it("edits mpOverrides for a snapshot row", () => {
    const sel = baseSel();
    const crew = ctx(sel, "Floral");
    const row = crew.mpRows.find(r => r.type === "Flowerists");
    const i = crew.mpRows.indexOf(row);
    expect(setMpPatch(crew, i, "rate", 650)).toEqual({ mpOverrides: { Flowerists: { rate: 650 } } });
  });
});

describe("eventLabourInfo / eventLabourTotalDeptOps — the whole-event labour total", () => {
  it("reports the event-wide dihari total across every department carrying a Labours row", () => {
    const sel = baseSel();
    const { eventLabourDihari, anyLabours } = eventLabourInfo(sel);
    expect(anyLabours).toBe(true);
    expect(eventLabourDihari).toBe(6); // Structure's Labours schedule: count 6 × 1 window
  });

  it("re-splits every department's Labours day proportionally to a new event total", () => {
    const sel = baseSel();
    const ops = eventLabourTotalDeptOps(sel, 3, "Ajay"); // 6 -> 3 is a 0.5 ratio
    expect(ops.Structure.mpDay.Labours["2026-12-04"]).toBe(3);
    expect(ops.Structure.updatedBy).toBe("Ajay");
  });
});

import { describe, it, expect } from "vitest";
import { fnSnapHasData, sessionHasData, autoSaveWouldDestroy, snapshotContentEqual, findLatestBuild, sessionToRows, suspiciousDuplicateFnIdxs, duplicateSourceVideoFnIdxs, mergeLmsFunctions, sessionHasFnBeyond } from "./sessionData";

const withVideo = { sourceVideo: { id: "vid_1", title: "Poolside Haldi" } };
const withZones = { zoneElements: { stage: ["truss"] } };
const empty = { elSelectedPhoto: {}, zoneElements: {}, enabledEls: {} };

describe("fnSnapHasData", () => {
  it("counts a chosen reference video, photo, zone or enabled element as data", () => {
    expect(fnSnapHasData(withVideo)).toBe(true);
    expect(fnSnapHasData(withZones)).toBe(true);
    expect(fnSnapHasData({ elSelectedPhoto: { stage: { src: "x" } } })).toBe(true);
    expect(fnSnapHasData({ enabledEls: { stage: true } })).toBe(true);
    expect(fnSnapHasData({ sourceEventId: "evt_2" })).toBe(true);
  });

  it("treats an all-empty snapshot as no data", () => {
    expect(fnSnapHasData(empty)).toBe(false);
    expect(fnSnapHasData({})).toBe(false);
    expect(fnSnapHasData(null)).toBe(false);
    // enabledEls present but every zone switched off is still nothing built.
    expect(fnSnapHasData({ enabledEls: { stage: false, entry: false } })).toBe(false);
  });

  // Confirmed real incident: a zone that exists as a KEY (every zone type the app knows about
  // renders a toggle row for) with an EMPTY array as its value — every zone toggled off — used to
  // satisfy `Object.keys(zoneElements).length > 0` and read as "has data" from key presence alone,
  // not actual content. That let a genuinely empty build bypass autoSaveWouldDestroy's guard and
  // silently bury a real ₹6L+ session under a cascade of empty auto-saves.
  it("does not count zone keys with empty arrays as data", () => {
    expect(fnSnapHasData({ zoneElements: { stage: [], entry: [], vedi: [] } })).toBe(false);
    expect(fnSnapHasData({ zoneElements: { stage: [], entry: ["truss"] } })).toBe(true);
  });
});

describe("sessionHasData", () => {
  it("finds data in any function, not just the first", () => {
    expect(sessionHasData({ fnSnapshots: { 0: empty, 1: withVideo } })).toBe(true);
  });

  it("falls back to the flat fields for legacy sessions with no fnSnapshots", () => {
    expect(sessionHasData({ sourceVideoId: "vid_9" })).toBe(true);
  });

  it("is false when every function is empty", () => {
    expect(sessionHasData({ fnSnapshots: { 0: empty, 1: {} } })).toBe(false);
  });
});

// The disappearing-session bug: the rolling auto-draft is replaced in place, so an autosave that
// captures an empty build wipes the card out of Browse's banner.
describe("autoSaveWouldDestroy", () => {
  it("blocks an empty auto-save from replacing a draft that holds work", () => {
    const prev = { auto: true, fnSnapshots: { 0: withVideo } };
    const next = { fnSnapshots: { 0: empty } };
    expect(autoSaveWouldDestroy(next, prev, true)).toBe(true);
  });

  it("allows an auto-save that carries work of its own", () => {
    const prev = { auto: true, fnSnapshots: { 0: withVideo } };
    const next = { fnSnapshots: { 0: withZones } };
    expect(autoSaveWouldDestroy(next, prev, false === true)).toBe(false);
    expect(autoSaveWouldDestroy(next, prev, true)).toBe(false);
  });

  it("allows an empty auto-save when the draft it replaces was empty too", () => {
    const prev = { auto: true, fnSnapshots: { 0: empty } };
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, prev, true)).toBe(false);
  });

  it("never blocks a manual save — the user asked for it", () => {
    const prev = { auto: true, fnSnapshots: { 0: withVideo } };
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, prev, false)).toBe(false);
  });

  // Prepending is not harmless: the empty save still becomes the newest build, the one every screen
  // opens. Confirmed incident (Hanumat, 30 Oct): a restored manual save was buried by empty auto-saves.
  it("blocks an empty auto-save from landing above a manual save that holds work", () => {
    const prev = { auto: false, fnSnapshots: { 0: withVideo } };
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, prev, true)).toBe(true);
  });
  it("blocks a Rs 0 auto-save above someone else's priced manual save", () => {
    const prev = { auto: false, savedBy: "salim", total: 245529, fnSnapshots: { 0: withZones } };
    expect(autoSaveWouldDestroy({ total: 0, fnSnapshots: { 0: { zoneElements: { stage: [] } } } }, prev, true)).toBe(true);
  });
  it("still lets an auto-save with real work land above a manual save", () => {
    const prev = { auto: false, total: 245529, fnSnapshots: { 0: withZones } };
    expect(autoSaveWouldDestroy({ total: 250000, fnSnapshots: { 0: withZones } }, prev, true)).toBe(false);
  });

  it("does not block on the very first save, with nothing to replace", () => {
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, null, true)).toBe(false);
  });

  // Second, independent signal on top of the structural check above — confirmed real incident:
  // a snapshot can retain empty-array zone keys (see fnSnapHasData's own regression test) that
  // pass the structural "has data" check purely on shape, even though nothing was actually built.
  // A real priced draft dropping to zero/unknown is destructive on its own regardless of what the
  // structural check concludes, so a similar future shape gap can't repeat this loss of a real
  // ₹6L+ build to a null-total auto-save.
  it("blocks a real priced draft from being replaced by a zero/null-total auto-save, even if next looks structurally non-empty", () => {
    const prev = { auto: true, total: 622162, fnSnapshots: { 0: withVideo } };
    const nextZero = { total: 0, fnSnapshots: { 0: { zoneElements: { stage: [], entry: [] } } } };
    const nextNull = { total: null, fnSnapshots: { 0: { zoneElements: { stage: [], entry: [] } } } };
    expect(autoSaveWouldDestroy(nextZero, prev, true)).toBe(true);
    expect(autoSaveWouldDestroy(nextNull, prev, true)).toBe(true);
  });

  it("does not block when the previous draft itself had no real total to lose", () => {
    const prev = { auto: true, total: 0, fnSnapshots: { 0: withVideo } };
    const next = { total: null, fnSnapshots: { 0: withZones } };
    expect(autoSaveWouldDestroy(next, prev, true)).toBe(false);
  });
});

// The duplicate-on-Load bug: re-hydrating state from a resumed session looks like an edit to the
// auto-save effect (new object references), so its first auto-save must be told apart from a real
// change before the new-visit boundary is allowed to fork a second, identical entry.
describe("snapshotContentEqual", () => {
  it("treats two snapshots with the same build content as equal, ignoring save metadata", () => {
    const a = { id: "SES_1", savedAt: 100, savedBy: "Tarun", auto: true, fnSnapshots: { 0: withVideo }, total: 500 };
    const b = { id: "SES_2", savedAt: 200, savedBy: "Tarun", auto: true, fnSnapshots: { 0: withVideo }, total: 500 };
    expect(snapshotContentEqual(a, b)).toBe(true);
  });

  it("is false when the build content actually differs", () => {
    const a = { id: "SES_1", fnSnapshots: { 0: withVideo } };
    const b = { id: "SES_2", fnSnapshots: { 0: withZones } };
    expect(snapshotContentEqual(a, b)).toBe(false);
  });

  it("is false when either side is missing", () => {
    expect(snapshotContentEqual(null, { fnSnapshots: {} })).toBe(false);
    expect(snapshotContentEqual({ fnSnapshots: {} }, null)).toBe(false);
  });

  it("ignores nested object key order (a rebuild via a different code path, same content)", () => {
    const a = { fnSnapshots: { 0: { zoneElements: { stage: ["truss"], entry: ["arch"] } } } };
    const b = { fnSnapshots: { 0: { zoneElements: { entry: ["arch"], stage: ["truss"] } } } };
    expect(snapshotContentEqual(a, b)).toBe(true);
  });

  it("ignores sourceVideo/sourceEvent fields other than id — loadClientSession re-derives them live, so a since-updated title/tag isn't a real edit", () => {
    const a = { fnSnapshots: { 0: { sourceVideo: { id: "vid_1", title: "Old Title", tags: { mood: "romantic" } } } } };
    const b = { fnSnapshots: { 0: { sourceVideo: { id: "vid_1", title: "New Title (retagged)", tags: { mood: "romantic", venue: "outdoor" } } } } };
    expect(snapshotContentEqual(a, b)).toBe(true);
  });

  it("still catches a genuine video swap even though only the id differs", () => {
    const a = { fnSnapshots: { 0: { sourceVideo: { id: "vid_1", title: "X", tags: {} } } } };
    const b = { fnSnapshots: { 0: { sourceVideo: { id: "vid_2", title: "X", tags: {} } } } };
    expect(snapshotContentEqual(a, b)).toBe(false);
  });
});

describe("findLatestBuild", () => {
  const emptyDraft = (id) => ({ id, _fnRows: [{ fn_idx: 0, has_data: false }] });
  const built = (id, fnIdx = 0) => ({ id, _fnRows: [{ fn_idx: fnIdx, has_data: true }] });

  it("skips the empty auto-saves at the top and returns the first real build", () => {
    // The whole point: sessions are newest-first and the newest is usually an empty tick.
    const r = findLatestBuild([emptyDraft("s3"), emptyDraft("s2"), built("s1")]);
    expect(r.session.id).toBe("s1");
    expect(r.fnIdx).toBe(0);
  });

  it("returns null when nothing was ever built", () => {
    expect(findLatestBuild([emptyDraft("s2"), emptyDraft("s1")])).toBe(null);
    expect(findLatestBuild([])).toBe(null);
    expect(findLatestBuild(null)).toBe(null);
  });

  it("prefers the function asked for, but only when that function has its own build", () => {
    const s = { id: "s1", _fnRows: [{ fn_idx: 0, has_data: true }, { fn_idx: 2, has_data: true }] };
    expect(findLatestBuild([s], 2).fnIdx).toBe(2);
    expect(findLatestBuild([s], 0).fnIdx).toBe(0);
    // Fn1 has nothing here — landing there would restore an empty canvas over a real build.
    expect(findLatestBuild([s], 1).fnIdx).toBe(0);
  });

  it("falls back to fnSnapshots for a session that never came from the table", () => {
    const s = { id: "s1", fnSnapshots: { 0: { enabledEls: {} }, 1: { zoneElements: { stage: ["truss"] } } } };
    const r = findLatestBuild([s]);
    expect(r.session.id).toBe("s1");
    expect(r.fnIdx).toBe(1);
  });

  it("reads a pre-fnSnapshots session's flat build as Function 1's", () => {
    expect(findLatestBuild([{ id: "s1", enabledEls: { stage: true } }]).fnIdx).toBe(0);
  });

  it("does not count a reference video on its own as a build", () => {
    // fnSnapHasBuild deliberately excludes the video: it rides along to every function.
    expect(findLatestBuild([{ id: "s1", fnSnapshots: { 0: { sourceVideo: { id: "v1" } } } }])).toBe(null);
  });
});

// The disappearing-custom-item bug: dcCustomItems is one FLAT array across every function
// (disambiguated by its own .fnIdx), but studio_sessions stores one row PER function with no column
// of its own for it — so it has to ride inside each row's `build` blob, filtered to that row's
// function, or it has nowhere to be written at all and is silently dropped on the next reload.
describe("sessionToRows — custom items", () => {
  const item = (fnIdx, id) => ({ id, fnIdx, type: "production", qty: 1, finalPrice: 7000 });

  it("puts each custom item on its own function's row, not every row", () => {
    const s = { id: "SES_1", savedAt: 1, fnSnapshots: { 0: withZones, 1: withZones }, customItems: [item(0, "a"), item(1, "b")] };
    const rows = sessionToRows("client_1", s);
    const row0 = rows.find((r) => r.fn_idx === 0);
    const row1 = rows.find((r) => r.fn_idx === 1);
    expect(row0.build.customItems).toEqual([item(0, "a")]);
    expect(row1.build.customItems).toEqual([item(1, "b")]);
  });

  it("leaves a row's build untouched when that function has no custom items", () => {
    const s = { id: "SES_1", savedAt: 1, fnSnapshots: { 0: withZones }, customItems: [] };
    const rows = sessionToRows("client_1", s);
    expect(rows[0].build).toEqual(withZones);
  });

  it("still writes a build row for a function with a custom item but no snapshot of its own", () => {
    const s = { id: "SES_1", savedAt: 1, fnSnapshots: { 0: withZones }, customItems: [item(0, "a")] };
    const rows = sessionToRows("client_1", s);
    expect(rows[0].build.customItems).toEqual([item(0, "a")]);
    // The function's real build content is still there alongside it, not replaced.
    expect(rows[0].build.zoneElements).toEqual(withZones.zoneElements);
  });

  it("does not choke on a session with no customItems field at all (pre-fix sessions)", () => {
    const s = { id: "SES_1", savedAt: 1, fnSnapshots: { 0: withZones } };
    expect(() => sessionToRows("client_1", s)).not.toThrow();
    expect(sessionToRows("client_1", s)[0].build).toEqual(withZones);
  });
});

// Confirmed incident: client Sangeeta, 2026-11-03 — Wedding's entire zones/elements ended up saved
// under Sangeet's fnIdx (a different, genuinely distinct function) and kept re-saving that way for
// ~90 minutes because nothing checked for it before writing.
describe("suspiciousDuplicateFnIdxs", () => {
  const fn = (fnIdx, zoneElements) => ({ fnIdx, zoneConfig: { stage: {} }, zoneElements, enabledEls: { stage: true } });

  it("flags the non-active side when two different functions are byte-identical", () => {
    const allFns = [fn(0, { stage: ["chair"] }), fn(1, { stage: ["truss"] }), fn(2, { stage: ["truss"] })];
    expect(suspiciousDuplicateFnIdxs(allFns, 1)).toEqual(new Set([2]));
  });

  it("distrusts both sides when neither is the active function", () => {
    const allFns = [fn(0, { stage: ["chair"] }), fn(1, { stage: ["truss"] }), fn(2, { stage: ["truss"] })];
    expect(suspiciousDuplicateFnIdxs(allFns, 0)).toEqual(new Set([1, 2]));
  });

  it("does not flag genuinely distinct functions", () => {
    const allFns = [fn(0, { stage: ["chair"] }), fn(1, { stage: ["truss"] })];
    expect(suspiciousDuplicateFnIdxs(allFns, 0).size).toBe(0);
  });

  it("does not flag two functions that are both simply blank", () => {
    const blank = (fnIdx) => ({ fnIdx, zoneConfig: {}, zoneElements: {}, enabledEls: {} });
    expect(suspiciousDuplicateFnIdxs([blank(0), blank(1)], 0).size).toBe(0);
  });

  it("handles no collision, no functions, and a missing activeFnIdx without throwing", () => {
    expect(suspiciousDuplicateFnIdxs([], 0).size).toBe(0);
    expect(suspiciousDuplicateFnIdxs(null, 0).size).toBe(0);
    expect(suspiciousDuplicateFnIdxs([fn(0, { stage: ["chair"] })], undefined).size).toBe(0);
  });
});

describe("duplicateSourceVideoFnIdxs — early-warning only, never a write-refusal (Sahiba, 2026-11-13: a function matched a sibling's content without ever becoming byte-identical, so suspiciousDuplicateFnIdxs above never caught it)", () => {
  const withVid = (fnIdx, id) => ({ fnIdx, sourceVideo: id ? { id } : null });

  it("flags a pair sharing the same non-empty sourceVideo id, even with otherwise-distinct content (the exact gap suspiciousDuplicateFnIdxs leaves open)", () => {
    expect(duplicateSourceVideoFnIdxs([withVid(0, "v1"), withVid(1, "v2"), withVid(2, "v1")])).toEqual([[0, 2]]);
  });

  it("does not flag two functions that both simply have no sourceVideo yet", () => {
    expect(duplicateSourceVideoFnIdxs([withVid(0, null), withVid(1, null)])).toEqual([]);
  });

  it("does not flag genuinely distinct videos", () => {
    expect(duplicateSourceVideoFnIdxs([withVid(0, "v1"), withVid(1, "v2")])).toEqual([]);
  });

  it("flags every pair when 3+ functions share one video, and handles empty/null input without throwing", () => {
    expect(duplicateSourceVideoFnIdxs([withVid(0, "v1"), withVid(1, "v1"), withVid(2, "v1")]))
      .toEqual([[0, 1], [0, 2], [1, 2]]);
    expect(duplicateSourceVideoFnIdxs([])).toEqual([]);
    expect(duplicateSourceVideoFnIdxs(null)).toEqual([]);
  });
});

import { restoreTarget } from "./sessionData";
describe("restoreTarget — a refresh brings back the real build, not an empty draft on top of it", () => {
  const built = { id: "B", savedAt: 1, fnSnapshots: { 0: { zoneElements: { stage: [{ name: "x" }] }, enabledEls: { stage: true } } } };
  const blank = { id: "E", savedAt: 2, auto: true, fnSnapshots: { 0: { zoneElements: {}, enabledEls: {} } } };
  it("skips a newer empty auto-draft and restores the build under it", () => {
    expect(restoreTarget([blank, blank, built], 0)).toMatchObject({ session: built, fnIdx: 0 });
  });
  it("the newest session when it has a build", () => {
    expect(restoreTarget([built, blank], 0).session).toBe(built);
  });
  it("lands on the function that was open when it has a build, else the one that does", () => {
    const two = { id: "T", fnSnapshots: { 0: { zoneElements: {}, enabledEls: {} }, 1: { zoneElements: { stage: [{ name: "x" }] }, enabledEls: {} } } };
    expect(restoreTarget([two], 1).fnIdx).toBe(1);
    expect(restoreTarget([two], 0).fnIdx).toBe(1);
  });
  it("nothing built anywhere: the newest session as it is, on the open function; no sessions: none", () => {
    expect(restoreTarget([blank], 2)).toEqual({ session: blank, fnIdx: 2 });
    expect(restoreTarget([], 0)).toEqual({ session: null, fnIdx: 0 });
    expect(restoreTarget(undefined, 0)).toEqual({ session: null, fnIdx: 0 });
  });
});

describe("mergeLmsFunctions — an LMS load adds what LMS has that Studio doesn't, never reorders what's already there (owner report 2026-11-04, lead #00342 'Kamal')", () => {
  it("the incident itself: Studio restored 2 functions, LMS now reports 3 — only the genuinely new one (Wedding) is appended", () => {
    const restored = [{ type: "Engagement", date: "2026-11-30", shift: "Dinner" }, { type: "Haldi", date: "2026-12-01", shift: "Lunch" }];
    const lms = [
      { type: "Wedding", date: "2026-12-01", venue: "Sunday Resort", shift: "Dinner", pax: "250" },
      { type: "Haldi", date: "2026-12-01", venue: "Sunday Resort", shift: "Lunch", pax: "150" },
      { type: "Engagement", date: "2026-11-30", venue: "Sunday Resort", shift: "Dinner", pax: "100" },
    ];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.blocked).toBeNull();
    expect(r.dateConflicts).toEqual([]);
    expect(r.toAppend).toEqual([{ type: "Wedding", date: "2026-12-01", venue: "Sunday Resort", venueOther: "", shift: "Dinner", pax: "250", palette: "Custom", flowerPalette: "" }]);
    expect(r.unmatchedRestoredCount).toBe(0);
  });
  it("running the merge again on the already-merged list is a no-op", () => {
    const restored = [{ type: "Engagement", date: "2026-11-30", shift: "Dinner" }, { type: "Haldi", date: "2026-12-01", shift: "Lunch" }, { type: "Wedding", date: "2026-12-01", shift: "Dinner" }];
    const lms = [
      { type: "Wedding", date: "2026-12-01", shift: "Dinner" },
      { type: "Haldi", date: "2026-12-01", shift: "Lunch" },
      { type: "Engagement", date: "2026-11-30", shift: "Dinner" },
    ];
    expect(mergeLmsFunctions(restored, lms, { landingFnIdx: 0 }).toAppend).toEqual([]);
  });
  it("case and whitespace differences in type still match", () => {
    const restored = [{ type: " haldi ", date: "2026-12-01", shift: "" }];
    const lms = [{ type: "HALDI", date: "2026-12-01" }];
    expect(mergeLmsFunctions(restored, lms, { landingFnIdx: 0 }).toAppend).toEqual([]);
  });
  it("same type, different date: flagged, nothing touched on either side", () => {
    const restored = [{ type: "Haldi", date: "2026-12-01", shift: "Lunch" }];
    const lms = [{ type: "Haldi", date: "2026-12-02", shift: "Lunch" }];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.toAppend).toEqual([]);
    expect(r.dateConflicts).toHaveLength(1);
    expect(r.dateConflicts[0]).toMatchObject({ restoredIdx: 0 });
  });
  it("two LMS functions share a type+date (Wedding Lunch and Wedding Dinner): the matching shift wins the match, the other is appended", () => {
    const restored = [{ type: "Wedding", date: "2026-12-01", shift: "Lunch" }];
    const lms = [{ type: "Wedding", date: "2026-12-01", shift: "Dinner" }, { type: "Wedding", date: "2026-12-01", shift: "Lunch" }];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.toAppend).toEqual([expect.objectContaining({ type: "Wedding", date: "2026-12-01", shift: "Dinner" })]);
  });
  it("an empty LMS entry (no type, no date) is ignored — never matched, never appended", () => {
    const r = mergeLmsFunctions([{ type: "Haldi", date: "2026-12-01" }], [{ type: "", date: "" }], { landingFnIdx: 0 });
    expect(r.toAppend).toEqual([]);
  });
  it("an orphan build whose OWN stamped identity matches the appended function is adopted; a mismatched or stamp-less orphan is evicted", () => {
    const restored = [{ type: "Haldi", date: "2026-12-01", shift: "" }];
    const lms = [{ type: "Haldi", date: "2026-12-01" }, { type: "Wedding", date: "2026-12-02" }, { type: "Sangeet", date: "2026-12-03" }];
    const r = mergeLmsFunctions(restored, lms, {
      landingFnIdx: 0,
      occupiedBuildIdxs: [1, 2],
      buildStamps: { 1: { fnType: "Wedding", fnDate: "2026-12-02" }, 2: { fnType: "Something Else", fnDate: "2026-12-09" } },
    });
    expect(r.toAppend.map((t) => t.type)).toEqual(["Wedding", "Sangeet"]);
    expect(r.adoptedIdxs).toEqual([1]); // index 1 = Wedding, stamp matches
    expect(r.evictIdxs).toEqual([2]);   // index 2 = Sangeet, stamp says a different function
  });
  it("LMS reporting a duplicate of an already-restored function is dropped at the source — no ghost tab gets appended at all (Vipin Sohlet incident, 2026-11-25)", () => {
    // Ring Ceremony is already restored at index 0 (alive, real). LMS reports it TWICE (a
    // duplicate row on LMS's own side) — Pass 1 matches the restored slot to one of the two
    // identical LMS rows; the other, with nowhere left to match, used to fall through to append
    // with the SAME type+date+shift as the function that's already restored, creating a second,
    // identically-labelled, selectable function tab. A leftover build happened to carry that same
    // stamp too, and got adopted into it — ~15 minutes of real edits (a Wisteria Hanging element
    // among them) landed on that duplicate tab instead of the real function before anyone noticed.
    // The fix drops the exact-duplicate LMS row before it ever becomes an appended function at all.
    const restored = [{ type: "Ring Ceremony", date: "2026-11-26", shift: "Morning" }];
    const lms = [{ type: "Ring Ceremony", date: "2026-11-26", shift: "Morning" }, { type: "Ring Ceremony", date: "2026-11-26", shift: "Morning" }];
    const r = mergeLmsFunctions(restored, lms, {
      landingFnIdx: 0,
      occupiedBuildIdxs: [1],
      buildStamps: { 1: { fnType: "Ring Ceremony", fnDate: "2026-11-26" } }, // duplicates restored[0]'s own stamp
    });
    expect(r.toAppend).toEqual([]);
    expect(r.adoptedIdxs).toEqual([]);
    expect(r.evictIdxs).toEqual([]);
  });
  it("the duplicate is still caught when Studio's restored shift disagrees with (or is blank against) LMS's own shift for both copies — matching is LMS-row-to-LMS-row, not against Studio's shift", () => {
    // Studio's Shift field only offers Morning/Lunch/Sundowner/Night; LMS's own vocabulary is
    // breakfast/lunch/evening/dinner — the two routinely disagree or one side is blank. An earlier
    // version of this fix compared the appended entry's identity only against `restored`'s own
    // shift, which missed this: both LMS copies agreed with EACH OTHER (both "Dinner") even though
    // neither matched Studio's own "" (blank, never synced back) or "Night" (typed independently).
    for (const studioShift of ["", "Night"]) {
      const restored = [{ type: "Ring Ceremony", date: "2026-11-26", shift: studioShift }];
      const lms = [{ type: "Ring Ceremony", date: "2026-11-26", shift: "Dinner", venue: "Sunday Resort" }, { type: "Ring Ceremony", date: "2026-11-26", shift: "Dinner", venue: "Sunday Resort" }];
      const r = mergeLmsFunctions(restored, lms, {
        landingFnIdx: 0,
        occupiedBuildIdxs: [1],
        buildStamps: { 1: { fnType: "Ring Ceremony", fnDate: "2026-11-26" } },
      });
      expect(r.toAppend).toEqual([]);
      expect(r.adoptedIdxs).toEqual([]);
      expect(r.evictIdxs).toEqual([]);
    }
  });
  it("two REAL same-type/date/shift functions at DIFFERENT venues (two family Haldis one morning) are never collapsed into one — venueOTHER is part of the LMS-to-LMS duplicate key", () => {
    // Real shape, not raw venue text: resolveVenue (StudioApp.jsx) turns any venue outside the
    // known in-house list into the literal sentinel venue:"Others", with the actual typed text
    // living in venueOther instead — both private-home Haldis below arrive as venue:"Others",
    // identical, and only venueOther differs. Keying on venue alone (an earlier version of this
    // fix did) would make the two collide and wrongly collapse into one (regression review: caught
    // against the REAL shape the app actually sends, not a shape no caller produces).
    const restored = [{ type: "Haldi", date: "2026-12-01", shift: "Lunch" }];
    const lms = [
      { type: "Haldi", date: "2026-12-01", shift: "Lunch", venue: "Others", venueOther: "Bride's home" },
      { type: "Haldi", date: "2026-12-01", shift: "Lunch", venue: "Others", venueOther: "Groom's home" },
    ];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.toAppend.map((t) => t.venueOther)).toEqual(["Groom's home"]);
    expect(r.droppedDuplicates).toEqual([]);
  });
  it("several date-less/type-less LMS rows never collide with each other via a shared null identity (regression caught before this shipped)", () => {
    // identityOfLms deliberately returns null for a row with no type or no date (an early LMS lead
    // with nothing typed yet). A Set that ever added that null would make EVERY other null-identity
    // row read as "already matched" and silently drop all of them, one step removed from the
    // original incident's shape. Two genuinely distinct blank-date functions must both survive.
    const restored = [{ type: "Wedding", date: "", shift: "" }];
    const lms = [{ type: "Wedding", date: "" }, { type: "Haldi", date: "" }];
    const r = mergeLmsFunctions(restored, lms, {
      landingFnIdx: 0,
      occupiedBuildIdxs: [1],
      buildStamps: { 1: { fnType: "Haldi", fnDate: "" } },
    });
    expect(r.toAppend.map((t) => t.type)).toEqual(["Haldi"]);
    expect(r.adoptedIdxs).toEqual([1]);
    expect(r.evictIdxs).toEqual([]);
  });
  it("LMS reporting the SAME brand-new function twice (nothing restored matches either copy) still produces only ONE appended tab, not two", () => {
    // Neither copy matches anything restored (so Pass 1 never records either one), but they're
    // identical to EACH OTHER — the same incident shape one step removed: both would otherwise
    // become two indistinguishable ghost tabs for a function that doesn't exist in Studio at all
    // yet, rather than one duplicated across two already-restored/appended slots.
    const restored = [{ type: "Wedding", date: "2026-12-01", shift: "" }];
    const lms = [{ type: "Haldi", date: "2026-12-02", shift: "Lunch" }, { type: "Haldi", date: "2026-12-02", shift: "Lunch" }];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.toAppend.map((t) => t.type)).toEqual(["Haldi"]);
    expect(r.droppedDuplicates.map((d) => d.type)).toEqual(["Haldi"]);
  });
  it("a duplicate combined with a moved date doesn't slip past Pass 2's date-conflict handling into an extra appended tab", () => {
    // Pass 2 consumes ONE of two identical "moved date" copies as a date conflict (flagged, nothing
    // touched); the second, identical LMS row must still be recognised as a duplicate of the one
    // Pass 2 just consumed, not appended as its own new function.
    const restored = [{ type: "Ring Ceremony", date: "2026-11-26", shift: "Morning" }];
    const lms = [
      { type: "Ring Ceremony", date: "2026-11-27", shift: "Morning" },
      { type: "Ring Ceremony", date: "2026-11-27", shift: "Morning" },
    ];
    const r = mergeLmsFunctions(restored, lms, { landingFnIdx: 0 });
    expect(r.dateConflicts).toHaveLength(1);
    expect(r.toAppend).toEqual([]);
  });
  it("a genuinely different sibling function (same type+date, different shift) is never treated as a duplicate — its orphan build is still adopted, not evicted", () => {
    // A Wedding Dinner sitting being added alongside an already-restored Wedding Lunch sitting.
    // The orphan's own saved stamp never carries shift (only fnType/fnDate), so the shift-aware
    // duplicate check must key off the APPENDED ENTRY's identity, not the orphan's stamp — keying
    // off the stamp would make this indistinguishable from the real duplicate case above and wrongly
    // evict a real, still-needed function's build (regression caught before this shipped).
    const restored = [{ type: "Wedding", date: "2026-12-01", shift: "Lunch" }];
    const lms = [{ type: "Wedding", date: "2026-12-01", shift: "Lunch" }, { type: "Wedding", date: "2026-12-01", shift: "Dinner" }];
    const r = mergeLmsFunctions(restored, lms, {
      landingFnIdx: 0,
      occupiedBuildIdxs: [1],
      buildStamps: { 1: { fnType: "Wedding", fnDate: "2026-12-01" } }, // the Dinner sitting's own real, removed build
    });
    expect(r.toAppend.map((t) => `${t.type}-${t.shift}`)).toEqual(["Wedding-Dinner"]);
    expect(r.adoptedIdxs).toEqual([1]);
    expect(r.evictIdxs).toEqual([]);
  });
  it("a function with no date yet can still have its orphan build reattached (date-less early LMS lead)", () => {
    const restored = [{ type: "Haldi", date: "2026-12-01", shift: "" }];
    const lms = [{ type: "Haldi", date: "2026-12-01" }, { type: "Mehendi", date: "" }];
    const r = mergeLmsFunctions(restored, lms, {
      landingFnIdx: 0,
      occupiedBuildIdxs: [1],
      buildStamps: { 1: { fnType: "Mehendi", fnDate: "" } },
    });
    expect(r.toAppend.map((t) => t.type)).toEqual(["Mehendi"]);
    expect(r.adoptedIdxs).toEqual([1]);
    expect(r.evictIdxs).toEqual([]);
  });
  it("landing on an index beyond what's restored (viewing an orphan) blocks the merge entirely", () => {
    const r = mergeLmsFunctions([{ type: "Haldi", date: "2026-12-01" }], [{ type: "Wedding", date: "2026-12-02" }], { landingFnIdx: 3 });
    expect(r.blocked).toBe("landing");
    expect(r.toAppend).toEqual([]);
  });
  it("several appended functions sort by date, then shift — never by LMS's own row order", () => {
    const lms = [
      { type: "Sangeet", date: "2026-12-03", shift: "Dinner" },
      { type: "Haldi", date: "2026-12-01", shift: "Dinner" },
      { type: "Haldi", date: "2026-12-01", shift: "Lunch" },
    ];
    const r = mergeLmsFunctions([{ type: "", date: "", shift: "" }], lms, { landingFnIdx: 0 });
    expect(r.toAppend.map((t) => `${t.type}-${t.shift}`)).toEqual(["Haldi-Lunch", "Haldi-Dinner", "Sangeet-Dinner"]);
  });
});

// Owner report 2026-11-28: copy a function in, delete Function 1, keep working, save - the deleted function came back.
// A rolling autosave that collapses into the SAME session id upserts only the functions still present; the removed
// function's old row is never deleted. This replays that against a table keyed by row id.
describe("a removed function's row left behind by an in-place autosave", () => {
  const upsert = (table, rows) => { rows.forEach((r) => { table[r.id] = r; }); return table; };
  const wedding = { zoneElements: { stage: ["truss"] }, fnType: "Wedding", fnDate: "2026-12-05" };
  const copied = { zoneElements: { stage: ["arch"] }, fnType: "Reception", fnDate: "2026-12-06" };
  const copiedWithWork = { zoneElements: { stage: ["arch", "drape", "chandelier"] }, fnType: "Reception", fnDate: "2026-12-06" };

  it("reusing the session id keeps the deleted function's row in that session", () => {
    const before = { id: "SES_A", savedAt: 1, savedActiveFnIdx: 0, fnSnapshots: { 0: wedding, 1: copied } };
    const table = upsert({}, sessionToRows("c1", before));
    // Function 1 deleted: the copy is now index 0; the collapsed save keeps id SES_A
    const after = { id: "SES_A", savedAt: 2, savedActiveFnIdx: 0, fnSnapshots: { 0: copiedWithWork } };
    upsert(table, sessionToRows("c1", after));
    const rowsOfA = Object.values(table).filter((r) => r.session_id === "SES_A").sort((a, b) => a.fn_idx - b.fn_idx);
    expect(rowsOfA.map((r) => r.fn_idx)).toEqual([0, 1]);           // index 1 is still there...
    expect(rowsOfA[1].build.zoneElements).toEqual(copied.zoneElements); // ...holding the copy's OLD build
    expect(rowsOfA[1].saved_at).toBe(1);
  });

  it("sessionHasFnBeyond spots it, so that save starts a new session instead", () => {
    const prevFromRows = { _fnRows: [{ fn_idx: 0, has_data: true }, { fn_idx: 1, has_data: true }] };
    expect(sessionHasFnBeyond(prevFromRows, 1)).toBe(true);   // the deal has 1 function now
    expect(sessionHasFnBeyond(prevFromRows, 2)).toBe(false);  // nothing removed
    expect(sessionHasFnBeyond({ fnSnapshots: { 0: wedding, 1: copied } }, 1)).toBe(true);
    expect(sessionHasFnBeyond({ fnSnapshots: { 0: wedding } }, 1)).toBe(false);
    // a held-back function (duplicate guard) sits INSIDE the range - still collapses, as before
    expect(sessionHasFnBeyond({ fnSnapshots: { 0: wedding, 1: copied } }, 3)).toBe(false);
    expect(sessionHasFnBeyond(null, 1)).toBe(false);
  });

  it("a fresh session id carries only the functions the deal has now", () => {
    const table = upsert({}, sessionToRows("c1", { id: "SES_A", savedAt: 1, fnSnapshots: { 0: wedding, 1: copied } }));
    upsert(table, sessionToRows("c1", { id: "SES_B", savedAt: 2, fnSnapshots: { 0: copiedWithWork } }));
    const rowsOfB = Object.values(table).filter((r) => r.session_id === "SES_B");
    expect(rowsOfB.map((r) => r.fn_idx)).toEqual([0]);
    expect(rowsOfB[0].build.zoneElements).toEqual(copiedWithWork.zoneElements);
  });
});

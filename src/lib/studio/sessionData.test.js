import { describe, it, expect } from "vitest";
import { fnSnapHasData, sessionHasData, autoSaveWouldDestroy, snapshotContentEqual, findLatestBuild } from "./sessionData";

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

  it("does not block when the leading session is a manual save (it is prepended, not replaced)", () => {
    const prev = { auto: false, fnSnapshots: { 0: withVideo } };
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, prev, true)).toBe(false);
  });

  it("does not block on the very first save, with nothing to replace", () => {
    expect(autoSaveWouldDestroy({ fnSnapshots: {} }, null, true)).toBe(false);
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

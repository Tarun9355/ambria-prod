import { describe, it, expect } from "vitest";
import { fnSnapHasData, sessionHasData, autoSaveWouldDestroy } from "./sessionData";

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

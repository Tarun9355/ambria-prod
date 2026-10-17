import { describe, it, expect } from "vitest";
import { repeatCatsOn, freshFnForManpower } from "./pricing.js";

// RC-30 — a per-category Repeat chip has to reach crew and trucks, not only the rent.
const fnWith = (zoneConfig) => ({
  enabledEls: { btr: true, stage: true },
  zoneElements: { btr: [{ invId: "a", qty: 2 }], stage: [{ invId: "b", qty: 1 }] },
  zoneConfig: { btr: { trT: "box", ...zoneConfig }, stage: { trT: "box" } },
});

describe("repeatCatsOn", () => {
  it("is empty for a fresh zone", () => {
    expect(repeatCatsOn({})).toEqual([]);
  });
  it("is every category for a zone on Repeat", () => {
    expect(repeatCatsOn({ repeat: true })).toEqual(["elements", "truss", "platform"]);
  });
  it("follows a chip flipped away from the zone toggle", () => {
    expect(repeatCatsOn({ repeatCats: { truss: true } })).toEqual(["truss"]);
    expect(repeatCatsOn({ repeat: true, repeatCats: { platform: false } })).toEqual(["elements", "truss"]);
  });
});

describe("freshFnForManpower", () => {
  it("leaves a function with nothing on Repeat untouched", () => {
    const fn = fnWith({});
    expect(freshFnForManpower(fn)).toBe(fn);
  });
  it("switches a whole Repeat zone off, as before", () => {
    const out = freshFnForManpower(fnWith({ repeat: true }));
    expect(out.enabledEls).toEqual({ btr: false, stage: true });
  });
  it("Truss & Masking chip alone: drops the truss config, keeps the elements", () => {
    const out = freshFnForManpower(fnWith({ repeatCats: { truss: true } }));
    expect(out.enabledEls.btr).toBe(true);
    expect(out.zoneConfig.btr).toBeUndefined();
    expect(out.zoneConfig.stage).toBeDefined();
    expect(out.zoneElements.btr).toHaveLength(1);
  });
  it("Elements chip alone: empties the element list, keeps the truss", () => {
    const out = freshFnForManpower(fnWith({ repeatCats: { elements: true } }));
    expect(out.enabledEls.btr).toBe(true);
    expect(out.zoneElements.btr).toEqual([]);
    expect(out.zoneElements.stage).toHaveLength(1);
    expect(out.zoneConfig.btr).toBeDefined();
  });
  it("zone on Repeat with Elements flipped back to Fresh still crews the elements", () => {
    const out = freshFnForManpower(fnWith({ repeat: true, repeatCats: { elements: false } }));
    expect(out.enabledEls.btr).toBe(true);
    expect(out.zoneElements.btr).toHaveLength(1);
    expect(out.zoneConfig.btr).toBeUndefined();
  });
  it("Platform chip alone changes no crew", () => {
    const fn = fnWith({ repeatCats: { platform: true } });
    expect(freshFnForManpower(fn)).toBe(fn);
  });
});

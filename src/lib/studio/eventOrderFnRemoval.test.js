import { describe, it, expect } from "vitest";
import { removeFnFromEventOrderData } from "./eventOrderFnRemoval.js";

const fn = (fnIdx, type, date, venue, extra = {}) => ({ fnIdx, type, date, venue, ...extra });

describe("removeFnFromEventOrderData — delete last", () => {
  it("drops the last entry, no renumbering needed", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")] };
    const r = removeFnFromEventOrderData(data, 1, { type: "Wedding", date: "2026-11-16", venue: "Aura" });
    expect(r.refused).toBe(false);
    expect(r.changed).toBe(true);
    expect(r.next.functionsDetail.map((f) => f.fnIdx)).toEqual([0]);
    expect(r.next.functionsDetail[0].type).toBe("Haldi");
    expect(r.next.date).toBe("2026-11-15");
  });
});

describe("removeFnFromEventOrderData — delete middle", () => {
  it("drops the target and renumbers every survivor above it, preserving each survivor's own content", () => {
    const data = { functionsDetail: [
      fn(0, "Haldi", "2026-11-15", "Aura"),
      fn(1, "Mehendi", "2026-11-16", "Aura"),
      fn(2, "Wedding", "2026-11-17", "Aura", { venue: "Aura", notes: "wedding-specific" }),
    ] };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16", venue: "Aura" });
    expect(r.refused).toBe(false);
    expect(r.next.functionsDetail.map((f) => f.fnIdx)).toEqual([0, 1]);
    const wedding = r.next.functionsDetail.find((f) => f.type === "Wedding");
    expect(wedding.fnIdx).toBe(1);
    expect(wedding.notes).toBe("wedding-specific"); // Wedding's OWN content, not Mehendi's
    expect(wedding.date).toBe("2026-11-17"); // Wedding's own date, never Mehendi's stale one
  });
});

describe("removeFnFromEventOrderData — delete first", () => {
  it("drops fnIdx 0 and shifts every other entry down by one", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15", venue: "Aura" });
    expect(r.next.functionsDetail.map((f) => f.fnIdx)).toEqual([0]);
    expect(r.next.functionsDetail[0].type).toBe("Wedding");
    expect(r.next.date).toBe("2026-11-16");
  });
});

describe("removeFnFromEventOrderData — fnIdx fallback", () => {
  it("entries with no fnIdx at all fall back to raw array position, same as persistDeptSnapshot's own withLayout", () => {
    const data = { functionsDetail: [{ type: "Haldi", date: "2026-11-15" }, { type: "Wedding", date: "2026-11-16" }] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.refused).toBe(false);
    expect(r.next.functionsDetail).toHaveLength(1);
    expect(r.next.functionsDetail[0].type).toBe("Wedding");
    expect(r.next.functionsDetail[0].fnIdx).toBe(0);
  });
});

describe("removeFnFromEventOrderData — guards", () => {
  it("refuses when two entries share the same fnIdx (already-corrupted row)", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(0, "Wedding", "2026-11-16", "Aura")] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.refused).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(data); // untouched
  });

  it("identity mismatch (both type and date differ from what's at removedIdx) is refused", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")] };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-99", venue: "Aura" });
    expect(r.refused).toBe(true);
    expect(r.changed).toBe(false);
  });

  it("only one of type/date matching (a legitimate rename not yet synced) is allowed", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")] };
    // date matches, type was renamed in Studio but hasn't synced to the server row yet
    const r = removeFnFromEventOrderData(data, 1, { type: "Reception", date: "2026-11-16", venue: "Aura" });
    expect(r.refused).toBe(false);
    expect(r.changed).toBe(true);
  });

  it("removedIdx beyond the array, nothing above it either: a no-op, not a refusal (a function added after the sale, never booked)", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura")] };
    const r = removeFnFromEventOrderData(data, 1, { type: "Wedding", date: "2026-11-16" });
    expect(r.refused).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(data);
  });

  it("a gap in numbering (nothing at removedIdx, something above it) is refused", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(2, "Wedding", "2026-11-17", "Aura")] };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16" });
    expect(r.refused).toBe(true);
    expect(r.changed).toBe(false);
  });

  it("a gap elsewhere in the numbering (entries at 0 and 2, nothing at 1, removedIdx=0) is ALSO refused — target exists at removedIdx so the earlier gap check alone would miss this", () => {
    const data = { functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(2, "Wedding", "2026-11-17", "Aura")] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.refused).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(data);
  });

  it("no functionsDetail at all: a no-op, not a refusal", () => {
    const r = removeFnFromEventOrderData({}, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.refused).toBe(false);
    expect(r.changed).toBe(false);
  });
});

describe("removeFnFromEventOrderData — deptOps carpet/fabric choices reindexed alongside functionsDetail", () => {
  it("carpetChoice and itemChoice keys shift down past the removed index, untouched keys left alone", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Mehendi", "2026-11-16", "Aura"), fn(2, "Wedding", "2026-11-17", "Aura")],
      deptOps: {
        Tenting: { carpetChoice: { "0|bar": "red", "1|bar": "blue", "2|stage": "gold" } },
        Fabric: { itemChoice: { "1|sofa": "velvet" } },
      },
    };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16" });
    expect(r.next.deptOps.Tenting.carpetChoice).toEqual({ "0|bar": "red", "1|stage": "gold" });
    expect(r.next.deptOps.Fabric.itemChoice).toEqual({});
  });

  it("deptOps untouched (same reference) when nothing in it needed to move", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")],
      deptOps: { Tenting: { carpetChoice: { "0|bar": "red" } } },
    };
    const r = removeFnFromEventOrderData(data, 1, { type: "Wedding", date: "2026-11-16" });
    expect(r.next.deptOps).toBe(data.deptOps);
  });

  it("trussPlan and trussFabric (dept head's own truss edits) reindex the same way as carpetChoice — a HIGH-severity regression found by independent review: left untouched, a survivor silently inherited a different function's pillar/beam/batta edits", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Mehendi", "2026-11-16", "Aura"), fn(2, "Sangeet", "2026-11-16", "Aura")],
      deptOps: {
        Tenting: {
          trussPlan: { "1|stage|0": { pillars: [{ len: 10, n: 2 }] }, "2|stage|0": { pillars: [{ len: 12, n: 4 }] } },
          trussFabric: { "1|stage|0|liza": [{ colour: "Red", qty: 5 }], "2|stage|0|liza": [{ colour: "Blue", qty: 8 }] },
        },
      },
    };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16", venue: "Aura" });
    expect(r.refused).toBe(false);
    // Sangeet's own edits (previously keyed "2|...") now sit at "1|..." — Sangeet's own numbers, not Mehendi's
    expect(r.next.deptOps.Tenting.trussPlan).toEqual({ "1|stage|0": { pillars: [{ len: 12, n: 4 }] } });
    expect(r.next.deptOps.Tenting.trussFabric).toEqual({ "1|stage|0|liza": [{ colour: "Blue", qty: 8 }] });
  });

  it("mandiLinesByFn: the removed function's own logged real spend is ARCHIVED (never dropped), survivors reindex, meta reindexes alongside", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Mehendi", "2026-11-16", "Aura"), fn(2, "Sangeet", "2026-11-16", "Aura")],
      deptOps: {
        Floral: {
          mandiLinesByFn: { 1: [{ name: "Rose", qty: 10, price: 50 }], 2: [{ name: "Marigold", qty: 20, price: 10 }] },
          mandiLinesByFnMeta: { 1: { date: "2026-11-16", venue: "Aura", label: "Mehendi" }, 2: { date: "2026-11-16", venue: "Aura", label: "Sangeet" } },
        },
      },
    };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16", venue: "Aura" });
    expect(r.refused).toBe(false);
    expect(r.next.deptOps.Floral.mandiLinesByFn).toEqual({ 1: [{ name: "Marigold", qty: 20, price: 10 }] });
    expect(r.next.deptOps.Floral.mandiLinesByFnMeta).toEqual({ 1: { date: "2026-11-16", venue: "Aura", label: "Sangeet" } });
    expect(r.next.deptOps.Floral.mandiLinesArchived).toEqual([
      { fnIdx: 1, meta: { date: "2026-11-16", venue: "Aura", label: "Mehendi" }, rows: [{ name: "Rose", qty: 10, price: 50 }], archivedAt: expect.any(Number) },
    ]);
  });

  it("mandiLinesByFn: removing a function with NOTHING logged doesn't create an archive entry at all", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Mehendi", "2026-11-16", "Aura")],
      deptOps: { Floral: { mandiLinesByFn: { 0: [{ name: "Rose", qty: 10, price: 50 }] } } },
    };
    const r = removeFnFromEventOrderData(data, 1, { type: "Mehendi", date: "2026-11-16" });
    expect(r.next.deptOps.Floral.mandiLinesByFn).toEqual({ 0: [{ name: "Rose", qty: 10, price: 50 }] });
    expect(r.next.deptOps.Floral.mandiLinesArchived).toBeUndefined();
  });
});

describe("removeFnFromEventOrderData — date and functions recomputed, changed:false when nothing moves", () => {
  it("data.date becomes the earliest surviving function's own date", () => {
    const data = { date: "2026-11-15", functionsDetail: [fn(0, "Haldi", "2026-11-15", "Aura"), fn(1, "Wedding", "2026-11-16", "Aura")] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.next.date).toBe("2026-11-16");
  });

  it("data.functions (type list) is recomputed when it was an array", () => {
    const data = { functions: ["Haldi", "Wedding"], functionsDetail: [fn(0, "Haldi", "2026-11-15"), fn(1, "Wedding", "2026-11-16")] };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.next.functions).toEqual(["Wedding"]);
  });

  it("an unrelated deptOps field (e.g. a different department's own data) is left exactly as it was", () => {
    const data = {
      functionsDetail: [fn(0, "Haldi", "2026-11-15"), fn(1, "Wedding", "2026-11-16")],
      deptOps: { Floral: { mandiLines: [{ name: "Rose", qty: 5 }] } },
    };
    const r = removeFnFromEventOrderData(data, 0, { type: "Haldi", date: "2026-11-15" });
    expect(r.next.deptOps.Floral).toBe(data.deptOps.Floral);
  });
});

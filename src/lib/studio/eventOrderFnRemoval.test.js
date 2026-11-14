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

import { describe, it, expect } from "vitest";
import { hardEntryUnchanged, stableStringify } from "./allocPromote";

const entry = {
  eoId: "EO1", clientId: "C1", state: "hard", createdAt: 123,
  trusses: [{ type: "pillar", qty: 4, size: { h: 10, w: 2 } }],
  totalPlatformSqftByMaterial: { wood: 100, steel: 20 },
};
// What the same entry looks like after a save → JSONB → load round trip: keys reordered.
const fromDb = {
  totalPlatformSqftByMaterial: { steel: 20, wood: 100 }, state: "hard",
  trusses: [{ size: { w: 2, h: 10 }, qty: 4, type: "pillar" }],
  clientId: "C1", eoId: "EO1", createdAt: 999,
};

describe("hardEntryUnchanged", () => {
  it("matches an identical booking even after JSONB reorders its keys", () => {
    expect(hardEntryUnchanged([fromDb], entry)).toBe(true);
  });
  it("ignores createdAt (it can fall back to Date.now())", () => {
    expect(hardEntryUnchanged([{ ...entry, createdAt: 1 }], entry)).toBe(true);
  });
  it("tolerates allocator bookkeeping the builder doesn't produce", () => {
    expect(hardEntryUnchanged([{ ...fromDb, assignedBy: "x" }], entry)).toBe(true);
  });
  it("re-promotes when the booking really changed", () => {
    expect(hardEntryUnchanged([{ ...fromDb, trusses: [{ type: "pillar", qty: 6, size: { h: 10, w: 2 } }] }], entry)).toBe(false);
  });
  it("re-promotes when the EO isn't booked on that date yet", () => {
    expect(hardEntryUnchanged([], entry)).toBe(false);
    expect(hardEntryUnchanged([{ ...fromDb, eoId: "EO2" }], entry)).toBe(false);
  });
  it("re-promotes when a soft hold for the same client is still there", () => {
    expect(hardEntryUnchanged([fromDb, { state: "soft", clientId: "C1" }], entry)).toBe(false);
  });
});

describe("stableStringify", () => {
  it("drops undefined keys like a JSON round trip does", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify(JSON.parse(JSON.stringify({ a: 1, b: undefined }))));
  });
});

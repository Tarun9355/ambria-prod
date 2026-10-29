import { describe, it, expect } from "vitest";
import { withKitEdit, syncKitOverridesToBuild } from "./dealCheckSync.js";
import { sessionToRows } from "./sessionData.js";

// "Ajay swapped items in the Tansol kit; after reopening the deal the old items were back."
const OLD = [{ itemId: "chair-old", qty: 4 }, { itemId: "table-old", qty: 1 }];
const NEW = [{ itemId: "chair-new", qty: 4 }, { itemId: "table-new", qty: 1 }];
const CK = "el::stage::Tansol Kit::0";
const parsed = { kind: "el", zoneKey: "stage", idx: 0, rcName: "Tansol Kit" };
const ze = (kitOverrides) => ({ stage: [{ invId: "tansol", name: "Tansol Kit", qty: 2, ...(kitOverrides ? { kitOverrides } : {}) }] });

describe("a kit swap made in Build survives saving and reopening", () => {
  it("Build's own save keeps the swapped parts in the session rows", () => {
    const snap = { id: "SES_1", savedAt: 1, savedBy: "Ajay", fnSnapshots: { 0: { zoneElements: ze(NEW), enabledEls: { stage: true }, zoneConfig: {} } }, savedActiveFnIdx: 0 };
    const rows = sessionToRows("CLI_1", snap);
    expect(rows).toHaveLength(1);
    expect(rows[0].build.zoneElements.stage[0].kitOverrides).toEqual(NEW);
  });
});

describe("Deal Check's own copy of a kit's parts (dcKitEdits)", () => {
  it("withKitEdit sets one card's parts and leaves the others alone", () => {
    const before = { 0: { other: OLD }, 1: { x: NEW } };
    const after = withKitEdit(before, 0, CK, NEW);
    expect(after[0]).toEqual({ other: OLD, [CK]: NEW });
    expect(after[1]).toEqual({ x: NEW });
    expect(before[0][CK]).toBeUndefined(); // not mutated
  });
  it("a reset (no parts) is stored as null, the 'back to the kit's default' marker; a missing base is fine", () => {
    expect(withKitEdit(undefined, 0, CK, undefined)).toEqual({ 0: { [CK]: null } });
    expect(withKitEdit([], 2, CK, NEW)).toEqual({ 2: { [CK]: NEW } });
  });
  it("THE BUG: a stale copy of the old parts, restored from the database, replaces Build's newer swap when Deal Check syncs", () => {
    const stale = syncKitOverridesToBuild(ze(NEW), parsed, OLD, CK);
    expect(stale.stage[0].kitOverrides).toEqual(OLD); // the swap is undone - this is what Ajay saw
  });
  it("THE FIX: once Build's swap has been written into that copy (persistDcKitEditsNow), the sync keeps the swapped parts", () => {
    const saved = withKitEdit({ 0: { [CK]: OLD } }, 0, CK, NEW)[0][CK];
    const out = syncKitOverridesToBuild(ze(NEW), parsed, saved, CK);
    expect(out.stage[0].kitOverrides).toEqual(NEW);
  });
  it("a deal Deal Check never touched (no copy at all) leaves Build's parts exactly as they are", () => {
    const z = ze(NEW);
    expect(syncKitOverridesToBuild(z, parsed, undefined, CK)).toBe(z);
  });
});

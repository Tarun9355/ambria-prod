import { describe, it, expect } from "vitest";
import {
  syncSwapToBuild, syncKitOverridesToBuild, syncManualItemToBuild,
  syncSplitToBuild, revertSplitToSingle, reconcileDealCheckIntoBuild,
} from "./dealCheckSync";

// Mirrors StudioApp.jsx's real parseCardKey (el::zoneKey::rcName::idx) closely enough for these
// tests — the module never imports the real one to stay dependency-free, so a card's cardKey is
// parsed by the caller (DealCheckOverlay.jsx uses the ctx-provided one) and passed in already-
// parsed for the single-function tests below.
function parseCardKey(key) {
  const parts = key.split("::");
  if (parts[0] === "el" && parts.length === 4) return { kind: "el", zoneKey: parts[1], rcName: parts[2], idx: Number(parts[3]) || 0 };
  if (parts[0] === "fl") return { kind: "fl", zoneKey: parts[1], rcName: parts[2], idx: Number(parts[3]) || 0 };
  return null;
}

describe("syncSwapToBuild", () => {
  it("updates the element's invId/name at the card's own index", () => {
    const ze = { stage: [{ name: "Old Sofa", invId: "OLD", qty: 2 }] };
    const parsed = { kind: "el", zoneKey: "stage", idx: 0 };
    const next = syncSwapToBuild(ze, parsed, { imsId: "NEW", name: "New Sofa" });
    expect(next.stage[0]).toMatchObject({ invId: "NEW", imsId: "NEW", name: "New Sofa" });
    expect(next).not.toBe(ze);
  });

  it("is a no-op (same reference) when the item already matches", () => {
    const ze = { stage: [{ name: "Sofa", invId: "X", qty: 1 }] };
    const next = syncSwapToBuild(ze, { kind: "el", zoneKey: "stage", idx: 0 }, { imsId: "X", name: "Sofa" });
    expect(next).toBe(ze);
  });

  it("excludes floral (fl) cards and a missing target", () => {
    const ze = { stage: [{ name: "Reet", invId: "X" }] };
    expect(syncSwapToBuild(ze, { kind: "fl", zoneKey: "stage", idx: 0 }, { imsId: "Y" })).toBe(ze);
    expect(syncSwapToBuild(ze, { kind: "el", zoneKey: "missing", idx: 0 }, { imsId: "Y" })).toBe(ze);
    expect(syncSwapToBuild(ze, { kind: "el", zoneKey: "stage", idx: 5 }, { imsId: "Y" })).toBe(ze);
  });
});

describe("syncKitOverridesToBuild", () => {
  const parsed = { kind: "el", zoneKey: "stage", idx: 0 };

  it("sets kitOverrides and is a no-op when unchanged", () => {
    const ze = { stage: [{ name: "Console", invId: "K1" }] };
    const comps = [{ itemId: "C1", qty: 2 }];
    const next = syncKitOverridesToBuild(ze, parsed, comps);
    expect(next.stage[0].kitOverrides).toEqual(comps);
    expect(syncKitOverridesToBuild(next, parsed, comps)).toBe(next);
  });

  it("resets to default (drops the field) when comps is empty/undefined", () => {
    const ze = { stage: [{ name: "Console", invId: "K1", kitOverrides: [{ itemId: "C1", qty: 2 }] }] };
    const next = syncKitOverridesToBuild(ze, parsed, undefined);
    expect(next.stage[0].kitOverrides).toBeUndefined();
    expect(syncKitOverridesToBuild(next, parsed, undefined)).toBe(next);
  });
});

describe("syncManualItemToBuild", () => {
  it("appends a new element tagged with _dcManualId", () => {
    const ze = { entry: [] };
    const mi = { manualId: "m1", imsId: "I1", qty: 3 };
    const next = syncManualItemToBuild(ze, "entry", mi, { name: "Extra Chair" });
    expect(next.entry).toHaveLength(1);
    expect(next.entry[0]).toMatchObject({ invId: "I1", qty: 3, name: "Extra Chair", _dcManualId: "m1" });
  });

  it("updates the existing entry in place on re-sync, no-op if unchanged", () => {
    const ze = { entry: [{ invId: "I1", imsId: "I1", name: "Extra Chair", qty: 3, _dcManualId: "m1" }] };
    const same = syncManualItemToBuild(ze, "entry", { manualId: "m1", imsId: "I1", qty: 3 }, { name: "Extra Chair" });
    expect(same).toBe(ze);
    const changed = syncManualItemToBuild(ze, "entry", { manualId: "m1", imsId: "I1", qty: 5 }, { name: "Extra Chair" });
    expect(changed.entry[0].qty).toBe(5);
    expect(changed.entry).toHaveLength(1);
  });
});

describe("split lifecycle", () => {
  const parsed = { kind: "el", zoneKey: "stage", idx: 0 };
  const inventoryCache = [{ id: "A", name: "Arch A" }, { id: "B", name: "Arch B" }];

  it("first split replaces the one entry with N, tagged with the group id", () => {
    const ze = { stage: [{ name: "Arch", invId: "A", qty: 18 }] };
    const next = syncSplitToBuild(ze, parsed, [{ imsId: "A", qty: 9 }, { imsId: "B", qty: 9 }], "g1", inventoryCache);
    expect(next.stage).toHaveLength(2);
    expect(next.stage.every((e) => e._dcSplitGroup === "g1")).toBe(true);
    expect(next.stage.map((e) => e.qty)).toEqual([9, 9]);
  });

  it("re-sync finds members by group id, not position, and is a no-op when unchanged", () => {
    const split1 = syncSplitToBuild({ stage: [{ name: "Arch", invId: "A", qty: 18 }] }, parsed, [{ imsId: "A", qty: 9 }, { imsId: "B", qty: 9 }], "g1", inventoryCache);
    const unchanged = syncSplitToBuild(split1, parsed, [{ imsId: "A", qty: 9 }, { imsId: "B", qty: 9 }], "g1", inventoryCache);
    expect(unchanged).toBe(split1);
    const resplit = syncSplitToBuild(split1, parsed, [{ imsId: "A", qty: 6 }, { imsId: "B", qty: 6 }, { imsId: "A", qty: 6 }], "g1", inventoryCache);
    expect(resplit.stage).toHaveLength(3);
    expect(resplit.stage.reduce((s, e) => s + e.qty, 0)).toBe(18);
  });

  it("reverts to a single element carrying the card's own (pre-split) identity", () => {
    const split1 = syncSplitToBuild({ stage: [{ name: "Arch", invId: "A", qty: 18 }] }, parsed, [{ imsId: "A", qty: 9 }, { imsId: "B", qty: 9 }], "g1", inventoryCache);
    const reverted = revertSplitToSingle(split1, "stage", "g1", { imsId: "A", name: "Arch A" });
    expect(reverted.stage).toHaveLength(1);
    expect(reverted.stage[0]).toMatchObject({ invId: "A", qty: 18 });
    expect(reverted.stage[0]._dcSplitGroup).toBeUndefined();
  });

  it("does nothing when no member of the group exists", () => {
    const ze = { stage: [{ name: "Arch", invId: "A", qty: 18 }] };
    expect(revertSplitToSingle(ze, "stage", "ghost", null)).toBe(ze);
  });
});

describe("reconcileDealCheckIntoBuild", () => {
  it("returns the exact same zoneElements reference when nothing needs to change", () => {
    const ze = { stage: [{ name: "Sofa", invId: "X", qty: 1 }] };
    const cards = { "el::stage::Sofa::0": { imsId: "X", imsName: "Sofa" } };
    const next = reconcileDealCheckIntoBuild(ze, cards, {}, [], [], parseCardKey);
    expect(next).toBe(ze);
  });

  it("applies a swap and never touches fl:: (floral) cards", () => {
    const ze = { stage: [{ name: "Sofa", invId: "OLD", qty: 1 }] };
    const cards = {
      "el::stage::Sofa::0": { imsId: "NEW", imsName: "New Sofa" },
      "fl::stage::Reet::1::stand": { imsId: "SHOULD_NOT_APPLY" },
    };
    const next = reconcileDealCheckIntoBuild(ze, cards, {}, [], [{ id: "NEW", name: "New Sofa" }], parseCardKey);
    expect(next.stage[0].invId).toBe("NEW");
  });

  it("adds and then removes a manual item across two reconcile passes", () => {
    const ze = { entry: [] };
    const manualItems = [{ manualId: "m1", imsId: "I1", qty: 2, zoneKey: "entry" }];
    const withItem = reconcileDealCheckIntoBuild(ze, {}, {}, manualItems, [{ id: "I1", name: "Chair" }], parseCardKey);
    expect(withItem.entry).toHaveLength(1);
    const withoutItem = reconcileDealCheckIntoBuild(withItem, {}, {}, [], [], parseCardKey);
    expect(withoutItem.entry).toHaveLength(0);
  });

  it("never throws — a malformed parseCardKey leaves zoneElements untouched", () => {
    const ze = { stage: [{ name: "Sofa", invId: "X" }] };
    const throwingParser = () => { throw new Error("boom"); };
    const next = reconcileDealCheckIntoBuild(ze, { "el::stage::Sofa::0": { imsId: "Y" } }, {}, [], [], throwingParser);
    expect(next).toBe(ze);
  });
});

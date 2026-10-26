import { describe, it, expect } from "vitest";
import { syncSwapToBuild, syncSplitToBuild } from "./dealCheckSync.js";

const parsed = { kind: "el", zoneKey: "stage", idx: 0 };
describe("Deal Check sync and overlay / cushion-cover choices", () => {
  it("a swap drops the element's choices (they were for its first item) but keeps its pid", () => {
    const ze = { stage: [{ invId: "A", name: "a", qty: 5, pid: "p1", prefs: [{ id: "A", name: "a", free: 9 }, { id: "B", name: "b", free: 9 }], _dcSyncedCardKey: "k" }] };
    const out = syncSwapToBuild(ze, parsed, { imsId: "C", name: "c" }, "k");
    expect(out.stage[0].invId).toBe("C");
    expect("prefs" in out.stage[0]).toBe(false);
    expect(out.stage[0].pid).toBe("p1");
  });
  it("split lines are separate elements: no choices, no pid", () => {
    const ze = { stage: [{ invId: "A", name: "a", qty: 10, pid: "p1", prefs: [{ id: "A", name: "a", free: 9 }, { id: "B", name: "b", free: 9 }], _dcSyncedCardKey: "k" }] };
    const out = syncSplitToBuild(ze, parsed, [{ imsId: "A", qty: 5 }, { imsId: "B", qty: 5 }], "g1", [{ id: "A", name: "a" }, { id: "B", name: "b" }], "k");
    expect(out.stage.length).toBe(2);
    out.stage.forEach((e) => { expect("prefs" in e).toBe(false); expect("pid" in e).toBe(false); });
  });
});

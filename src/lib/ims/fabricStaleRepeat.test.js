// Every zone set to ♻ Repeat AFTER the last Deal Check sync (no live palette): the old sync's colours must not be pulled or loaded
// while the same pieces are listed as standing at the venue (independent test report 2026-11-27).
import { describe, it, expect } from "vitest";
import { buildFabricGroups, foldFabricLines, fabricStandingOf } from "./fabricGroups.js";

const zone = (zk, zLabel, pcs, repeat) => ({ fi: 0, ri: 0, zk, zLabel, fnLabel: "Wedding", photo: "", repeat, fab: { maskingPieces: pcs }, row: {} });
const plan = { masking: [{ colour: "Maroon", qty: 7 }], rows: [] }; // recorded before the zones went to Repeat
const lines = [{ id: "m1", name: "Wall Masking (Old)", qty: 7, total: 700, sub: "pcs · side" }];

describe("stale Deal Check plan, every zone on Repeat", () => {
  const groups = buildFabricGroups({ entries: [zone("side", "Side", 3, true), zone("entry", "Entry", 2, true), zone("photo", "Photo", 2, true)], lines, fabricPlan: plan }).groups;
  const g = groups.find((x) => x.key === "masking");
  it("nothing to pull and no colours to pull", () => {
    expect(g.standingOnly).toBe(true);
    expect(g.colours).toEqual([]);
    expect(g.pullQty).toBe(0);
    expect(g.colourText.startsWith("♻ Repeat · standing")).toBe(true);
  });
  it("the load list loads none of it; the venue list has all 7", () => {
    const folded = foldFabricLines(lines, groups);
    expect(folded.filter((l) => String(l.name).startsWith("Wall Masking"))).toEqual([]);
    expect(fabricStandingOf(groups).reduce((s, x) => s + x.qty, 0)).toBe(7);
  });
  it("a fabric with a zone still to be built keeps the sync's colours", () => {
    const g2 = buildFabricGroups({ entries: [zone("side", "Side", 3, true), zone("entry", "Entry", 4, false)], lines, fabricPlan: plan }).groups.find((x) => x.key === "masking");
    expect(g2.colours.map((c) => c.colour)).toEqual(["Maroon"]);
  });
});

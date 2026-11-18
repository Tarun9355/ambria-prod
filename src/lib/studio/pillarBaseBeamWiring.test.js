import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLANNING_SNAPSHOT_VERSION } from "./planningSync.js";

// A beam set at the ground under a pillar (resolvePillarHeight: 14 ft = 12 ft pillar + 2 ft beam) is named a beam in Deal
// Check's Tenting lines and its truss tab, not a "Truss pillar 2ft" (owner report 2026-11-18).
const read = (p) => readFileSync(resolve(__dirname, p), "utf8");

describe("ground beam under a pillar - Deal Check wiring", () => {
  it("Tenting lines: a ground beam joins its size's one 'Truss beam Nft' line (owner ask: one line per beam size, 8 + 1 = 9)", () => {
    const src = read("../../pages/studio/dealcheck/DealCheckOverlay.jsx");
    expect(src).toMatch(/const m = pc\.type === "beam" \? smap : pmap;/);
    expect(src).not.toContain("(pillar base)`");
    expect(src).toMatch(/const nb = bmap\[ft\] \|\| 0, ns = smap\[ft\] \|\| 0, n = nb \+ ns;/);
  });
  it("truss tab: the ground beams are shown apart as '(beam)', still inside the pillar total", () => {
    const src = read("../../pages/studio/dealcheck/tabs/DCTrussTab.jsx");
    expect(src).toMatch(/if \(pc\.type === "beam"\) realPillarBaseCounts\[pc\.size\]/);
    expect(src).toContain("(beam)`");
  });
  it("planning snapshot bumped so IMS rebuilds the Tenting lines", () => {
    expect(PLANNING_SNAPSHOT_VERSION).toBeGreaterThanOrEqual(28);
  });
});

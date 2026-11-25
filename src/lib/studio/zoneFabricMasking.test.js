import { describe, it, expect } from "vitest";
import { calcZoneFabric } from "./pricing";

// Wall masking pieces (13 ft panels) for a Full Box run along the walls Build prices: the back wall is the truss's WIDTH, the
// sides its DEPTH (owner check 2026-11-21: a 29.5 ft wide, 5.5 ft deep stage got 1 back-wall piece instead of 3).
const trussInv = { pillars: { 8: 40, 12: 40, 14: 20 }, beams: { 12: 80, 10: 40, 8: 40, 6: 40, 4: 40 }, settings: { maxSpanFt: 30, pillarWidthFt: 0.75 } };
const box = (walls) => ({ trT: "box", dims: { W: 29.5, L: 5.5, H: 14 }, mkOn: true, mkT: "fabric", mkWalls: walls });

describe("calcZoneFabric wall masking", () => {
  it("a Full Box's back wall runs its width", () => {
    expect(calcZoneFabric(box({ back: true }), trussInv, "dense").maskingPieces).toBe(3); // ~29 ft / 13 → 3
  });
  it("a Full Box's side walls run its depth", () => {
    expect(calcZoneFabric(box({ left: true, right: true }), trussInv, "dense").maskingPieces).toBe(1); // 2 × ~6.5 ft = 13 → 1
  });
  it("a U truss's back wall is still its span", () => {
    expect(calcZoneFabric({ trT: "singleU", dims: { W: 30, H: 12 }, mkOn: true, mkT: "fabric", mkWalls: { back: true } }, trussInv, "dense").maskingPieces).toBe(3);
  });
});

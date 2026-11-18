import { describe, it, expect } from "vitest";
import { trussPieceLines } from "./trussLines";

// One line per stock item and size: a beam under a pillar joins the same size's "Truss beam" line (owner ask 2026-11-18).
describe("truss Tenting lines", () => {
  const PILLAR = 20, BEAM = 15; // ₹ per running ft

  it("the owner's case: 8 ground beams + 1 beam segment of 2 ft are one 'Truss beam 2ft' line of 9", () => {
    const lines = trussPieceLines({ pillars: { 12: 22 }, beams: { 2: 1, 10: 15 }, bases: { 2: 8 } }, PILLAR, BEAM);
    const b2 = lines.filter((l) => l.name === "Truss beam 2ft");
    expect(b2).toHaveLength(1);
    expect(b2[0].qty).toBe(9);
    expect(lines.some((l) => /pillar base/i.test(l.name))).toBe(false);
    expect(lines.some((l) => l.name === "Truss pillar 2ft")).toBe(false);
  });

  it("each piece keeps the rate it is billed at: total = 8 × ₹40 (pillar rate) + 1 × ₹30 (beam rate), unit their average", () => {
    const [b2] = trussPieceLines({ beams: { 2: 1 }, bases: { 2: 8 } }, PILLAR, BEAM);
    expect(b2.total).toBe(8 * 40 + 1 * 30);
    expect(b2.unit).toBe(Math.round(350 / 9));
  });

  it("bases only (no segment of that size) still make a beam line, at the pillar rate", () => {
    expect(trussPieceLines({ bases: { 3: 2 } }, PILLAR, BEAM)).toEqual([{ name: "Truss beam 3ft", qty: 2, unit: 60, total: 120 }]);
  });

  it("pillars stay their own lines; nothing for a size with no pieces", () => {
    const lines = trussPieceLines({ pillars: { 12: 4, 15: 0 }, beams: { 10: 0 } }, PILLAR, BEAM);
    expect(lines).toEqual([{ name: "Truss pillar 12ft", qty: 4, unit: 240, total: 960 }]);
  });

  it("no rates (nothing billed) still lists the pieces at ₹0", () => {
    expect(trussPieceLines({ beams: { 2: 1 }, bases: { 2: 1 } })).toEqual([{ name: "Truss beam 2ft", qty: 2, unit: 0, total: 0 }]);
  });
});

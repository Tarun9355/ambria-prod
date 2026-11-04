import { describe, it, expect } from "vitest";
import { snapRowDimsForProduction, trussRowCost, calcZoneTrussPreview, calcZoneFabric, buildTopology } from "./pricing";

// §23 Phase 7 (2026-11-04, owner-confirmed worked examples): the sales team pads a zone's entered
// width/depth themselves by a round 1ft per pillar (easy mental math) BEFORE typing it — a true
// 50ft span gets typed as 53ft, 50 + 3 pillars. The engine subtracts that same 1ft/pillar back out
// to find the real beam budget, resolves it against actual beam stock (which may build slightly
// short of the budget — only certain piece combinations exist), then adds back EVERY pillar's real
// 9-inch (0.75ft) physical width — including middle ones — to report the true footprint. Two
// different numbers for the same pillar, deliberately: 1ft for the team's mental math, 0.75ft for
// the real footprint. Masking adds a further 2×0.75ft on top of that footprint (owner decision,
// 2026-11-04 — fabric is presumed to wrap past the two outer corner faces regardless of how many
// middle pillars exist). Supersedes §23 Phase 6 (2026-11-03), which used the entered span as the
// beam total directly with no deduction at all — that was wrong on its own worked examples.
const realStock = { beams: { 15: { stock: 40 }, 12: { stock: 90 }, 10: { stock: 85 }, 8: { stock: 8 }, 5: { stock: 20 }, 4: { stock: 20 }, 3: { stock: 40 }, 2: { stock: 30 } } };
const eng = { maxSpanFt: 30, pillarWidthFt: 0.75 };

describe("buildTopology — 1ft/pillar budget, stock-resolved beams, footprint = built + 0.75ft × every pillar", () => {
  it("14ft (no middle pillar): budget 12ft, resolves to one clean 12ft beam, footprint 13.5ft", () => {
    const topo = buildTopology("u_only", 0, 14, 10, 14, 0, eng, realStock);
    expect(topo.pillarCount).toBe(2);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([12]);
    expect(topo.physicalL).toBe(13.5);
    expect(topo.stockResolved).toBe(true);
  });

  it("20ft (no middle pillar): budget 18ft, resolves exactly (15+3), footprint 19.5ft", () => {
    const topo = buildTopology("u_only", 0, 20, 10, 20, 0, eng, realStock);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([18]);
    expect(topo.physicalL).toBe(19.5);
  });

  it("48ft (1 middle pillar): budget 45ft over 2 segments can't build exactly — 22.5ft target resolves to 12+10=22ft each, footprint 46.25ft (46'3\")", () => {
    const topo = buildTopology("u_only", 0, 48, 10, 48, 0, eng, realStock);
    expect(topo.pillarCount).toBe(3); // 2 corners + 1 mid, span > maxSpan
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([22.5, 22.5]); // the budget target — what every re-resolving consumer calls resolveBeamSegment on
    expect(topo.physicalL).toBe(46.25);
  });

  it("with no stock to check against, physical falls back to the theoretical budget target", () => {
    const topo = buildTopology("u_only", 0, 48, 10, 48, 0, eng);
    expect(topo.physicalL).toBe(47.25); // 45 (budget, unresolved) + 3×0.75
    expect(topo.stockResolved).toBe(false);
  });

  it("half_box: the front axis goes through the same pipeline; the depth (side) axis is untouched", () => {
    const topo = buildTopology("half_box", 0, 48, 10, 48, 4, eng, realStock);
    const frontBeams = topo.beams.filter((b) => b.side.startsWith("front"));
    expect(frontBeams.map((b) => b.lengthFt)).toEqual([22.5, 22.5]);
    expect(topo.physicalL).toBe(46.25);
    expect(topo.physicalW).toBe(4 + 2 * 0.75); // depth isn't padded by sales — unchanged
  });

  it("full_box: BOTH axes run the pipeline independently, each off its own span/pillar count", () => {
    const topo = buildTopology("full_box", 14, 48, 10, null, 0, eng, realStock);
    const frontBeams = topo.beams.filter((b) => b.side.startsWith("front"));
    const leftBeams = topo.beams.filter((b) => b.side.startsWith("left"));
    expect(frontBeams.map((b) => b.lengthFt)).toEqual([12]);
    expect(leftBeams.map((b) => b.lengthFt)).toEqual([22.5, 22.5]);
    expect(topo.physicalL).toBe(13.5);
    expect(topo.physicalW).toBe(46.25);
    expect(topo.pillarCount).toBe(6); // 4 corners + 1 mid on each of the 2 W-axis sides
  });

  it("masking adds a further 2×pillarWidth on top of the true footprint (owner decision, 2026-11-04)", () => {
    const topo = buildTopology("u_only", 0, 48, 10, 48, 0, eng, realStock);
    expect(topo.maskingL).toBe(46.25 + 2 * 0.75);
  });
});

const trussInv = { settings: { maxSpanFt: 1000 }, beams: { 10: { stock: 100 } } };

describe("snapRowDimsForProduction — DISABLED (owner decision, 2026-11-04)", () => {
  it("always returns the exact same row, unchanged — no snapping, regardless of stock", () => {
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    expect(snapRowDimsForProduction(row, trussInv)).toBe(row);
    expect(snapRowDimsForProduction(row, { settings: {}, beams: {} })).toBe(row);
    expect(snapRowDimsForProduction(row)).toBe(row);
  });

  it("does nothing to a row with no dims at all", () => {
    const row = { trussMaterial: "iron" };
    expect(snapRowDimsForProduction(row, trussInv)).toBe(row);
  });
});

describe("trussRowCost / calcZoneTrussPreview — price off the raw entered span, no snapping", () => {
  it("trussRowCost prices the Single U area off the raw W whether or not trussInv stock is given", () => {
    // W=23,H=10 area = 230 sqft × default singleU rate 30 = 6900, unaffected by stock now.
    const row = { dims: { W: 23, H: 10 }, trT: "singleU", trussMaterial: "iron", trussQty: 1 };
    const withoutStock = trussRowCost(row, {});
    const withStock = trussRowCost(row, { trussInv });
    expect(withoutStock.truss).toBe(6900);
    expect(withStock.truss).toBe(6900);
  });

  it("calcZoneTrussPreview's topology uses the raw entered span for pillar/beam math, resolved against real stock for the footprint", () => {
    const row = { dims: { W: 23, H: 10 }, trussMaterial: "iron", trussType: "u_only" };
    const preview = calcZoneTrussPreview(row, trussInv);
    expect(preview.spanFt).toBe(23); // never snapped
    // 23ft, 2 pillars (span < maxSpanFt:1000): budget 21, one segment of 21 — this stock only has
    // 10ft beams, and no exact 21 is possible (10 is 11 short, 20 is 1 short — exactly at the 1ft
    // tolerance edge, so 20 is the best available): built 20, physical 20 + 2×0.75 = 21.5.
    expect(preview.topology.beams.map((b) => b.lengthFt)).toEqual([21]);
    expect(preview.topology.physicalL).toBe(21.5);
  });
});

import { resolveFabricAllocation } from "./pricing.js";
describe("resolveFabricAllocation — the Fabric Palette decides over a leftover saved colour", () => {
  const stock = [{ colour: "Ivory", stockKg: 40 }, { colour: "Rose Gold dark", stockKg: 100 }, { colour: "Yellow", stockKg: 38 }];
  it("a saved colour that the palette's anchors allow is kept as saved", () => {
    const saved = [{ colour: "Ivory", qty: 30 }];
    expect(resolveFabricAllocation(saved, 84, ["Ivory", "Yellow"], stock, "stockKg")).toBe(saved);
  });
  it("a saved colour that no anchor allows is a leftover from an earlier palette: auto-fill from the palette instead", () => {
    const saved = [{ colour: "Rose Gold dark", qty: 81 }];
    expect(resolveFabricAllocation(saved, 84, ["Ivory"], stock, "stockKg")).toEqual([{ qty: 84, colour: "Ivory" }]);
  });
  it("a saved allocation with one colour outside the palette is dropped whole", () => {
    const saved = [{ colour: "Ivory", qty: 40 }, { colour: "Rose Gold dark", qty: 44 }];
    expect(resolveFabricAllocation(saved, 84, ["Ivory"], stock, "stockKg")).toEqual([{ qty: 84, colour: "Ivory" }]);
  });
  it("with no palette picked a saved colour stands", () => {
    const saved = [{ colour: "Rose Gold dark", qty: 81 }];
    expect(resolveFabricAllocation(saved, 84, [], stock, "stockKg")).toBe(saved);
  });
  it("nothing saved: the plain auto-fill (palette match, else highest stock)", () => {
    expect(resolveFabricAllocation(undefined, 10, ["Yellow"], stock, "stockKg")).toEqual([{ qty: 10, colour: "Yellow" }]);
    expect(resolveFabricAllocation([], 10, [], stock, "stockKg")).toEqual([{ qty: 10, colour: "Rose Gold dark" }]);
  });
  it("matching is the same loose matcher as auto-fill (Rose Gold covers Rose Gold dark)", () => {
    const saved = [{ colour: "Rose Gold dark", qty: 5 }];
    expect(resolveFabricAllocation(saved, 5, ["Rose Gold"], stock, "stockKg")).toBe(saved);
  });
});

import { anchorsForPaletteByMaterial } from "./pricing.js";
describe("the palette 'Ivory, Rose Gold (curtain only)' end to end", () => {
  const palette = "Ivory, Rose Gold:C";
  const liza = [{ colour: "Ivory", stockKg: 40 }, { colour: "Rose Gold dark", stockKg: 100 }];
  const curtain = [{ colour: "Ivory", stockPieces: 80 }, { colour: "Rose Gold", stockPieces: 3 }];
  it("Liza is Ivory even with Rose Gold dark still saved on the row", () => {
    const a = resolveFabricAllocation([{ colour: "Rose Gold dark", qty: 81 }], 84, anchorsForPaletteByMaterial([], palette, "liza"), liza, "stockKg");
    expect(a).toEqual([{ qty: 84, colour: "Ivory" }]);
  });
  it("Velvet curtains may use Rose Gold, and a saved Rose Gold stands", () => {
    const saved = [{ colour: "Rose Gold", qty: 44 }];
    expect(resolveFabricAllocation(saved, 56, anchorsForPaletteByMaterial([], palette, "curtain"), curtain, "stockPieces")).toBe(saved);
  });
});

describe("trussRowCost — a custom ceiling is charged even with Truss Qty 0", () => {
  const panel = { id: "C1", name: "Wave ceiling Pattern Passage", subCat: "Ceiling", price: 4000 };
  const rates = { imsInventory: [panel], rcFactorByKey: { ceiling: 1.5 } };
  it("Truss Qty 0, no dims, custom ceiling picked: the panel is priced (one, at its rental × factor)", () => {
    const r = trussRowCost({ dims: {}, trT: "box", trussQty: 0, customCeilingItemId: "C1" }, rates);
    expect(r.ceiling).toBe(6000);
    expect(r.truss).toBe(6000);
    expect(r.masking).toBe(0);
  });
  it("uses the count picked with it", () => {
    expect(trussRowCost({ dims: {}, trussQty: 0, customCeilingItemId: "C1", customCeilingQty: 3 }, rates).ceiling).toBe(18000);
  });
  it("Truss Qty 0 and no custom ceiling is still nothing", () => {
    expect(trussRowCost({ dims: { W: 10, L: 10, H: 10 }, trussQty: 0 }, rates)).toEqual({ truss: 0, masking: 0, ceiling: 0 });
  });
});

describe("calcZoneFabric — Wall Masking fabric only for walls masked in fabric (RC-79 / PDF-16)", () => {
  const trussInv = { settings: { pillarWidthFt: 0.75, maxSpanFt: 30, defaultBackDepthFt: 4, backDepthRange: [3, 5] }, rates: {}, batta: { bufferPct: 10 } };
  const zone = (over) => ({ dims: { W: 10, L: 10, H: 10 }, trT: "box", mkWalls: { back: true, left: true, right: true }, ...over });
  it("masking on in fabric: the walls count", () => {
    expect(calcZoneFabric(zone({ mkOn: true, mkT: "fabric" }), trussInv).maskingPieces).toBeGreaterThan(0);
  });
  it("masking switched off: no Wall Masking, even with the walls still ticked", () => {
    expect(calcZoneFabric(zone({ mkOn: false, mkT: "fabric" }), trussInv).maskingPieces).toBe(0);
  });
  it("Acrylic / Flex masking is not fabric stock", () => {
    expect(calcZoneFabric(zone({ mkOn: true, mkT: "acrylic" }), trussInv).maskingPieces).toBe(0);
    expect(calcZoneFabric(zone({ mkOn: true, mkT: "flex" }), trussInv).maskingPieces).toBe(0);
  });
  it("per-wall material: only the fabric walls count", () => {
    const all = calcZoneFabric(zone({ mkOn: true, mkT: "fabric" }), trussInv).maskingPieces;
    const mixed = calcZoneFabric(zone({ mkOn: true, mkT: "fabric", mkWallMat: { back: { matKey: "acrylic" } } }), trussInv).maskingPieces;
    expect(mixed).toBeLessThan(all);
    expect(mixed).toBeGreaterThan(0);
  });
});

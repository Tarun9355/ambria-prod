import { describe, it, expect } from "vitest";
import { snapRowDimsForProduction, trussRowCost, calcZoneTrussPreview, calcZoneFabric, buildTopology } from "./pricing";

// §23 Phase 6 (2026-11-03, owner convention): the sales team now pads a zone's entered
// width/depth themselves, by the pillar count, BEFORE typing it (e.g. a true 50ft span gets typed
// as 53ft — 50 + 3 pillars), so the engine must NOT also subtract a pillar budget from whatever is
// entered — that would double-count the padding and order beams shorter than intended. Confirmed
// incident this closes: a 43×43 full-box entry used to show a 44.5×44.5 "Physical Footprint" for
// an unrelated reason (fixed 2026-11-01), but the underlying pillar-subtraction formula itself
// stayed in place until today, when it was found to conflict with the team's own padding practice.
describe("buildTopology — the entered span IS the beam total, no pillar deduction", () => {
  it("u_only: a 32ft span splits into exactly 2×16ft beams, not 2×14.875ft", () => {
    const topo = buildTopology("u_only", 0, 32, 10, 32, 0, { maxSpanFt: 30 });
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([16, 16]);
    expect(topo.pillarCount).toBe(3); // 2 corners + 1 mid, span > maxSpan
    expect(topo.physicalL).toBe(32); // the entered span, unchanged
  });

  it("half_box: the front span is not reduced by the pillar count either", () => {
    const topo = buildTopology("half_box", 0, 32, 10, 32, 4, { maxSpanFt: 30 });
    const frontBeams = topo.beams.filter((b) => b.side.startsWith("front"));
    expect(frontBeams.map((b) => b.lengthFt)).toEqual([16, 16]);
    expect(topo.physicalL).toBe(32);
  });

  it("full_box: BOTH axes use their own entered span directly, independently", () => {
    const topo = buildTopology("full_box", 32, 50, 10, null, 0, { maxSpanFt: 30 });
    // L=32 → 2 segments of 16ft; W=50 → 3 pillars (2 corner + 1 mid for span>maxSpan twice-over is
    // still just ceil(50/30)=2 → 3 pillars), 2 segments of 25ft.
    const frontBeams = topo.beams.filter((b) => b.side.startsWith("front"));
    const leftBeams = topo.beams.filter((b) => b.side.startsWith("left"));
    expect(frontBeams.map((b) => b.lengthFt)).toEqual([16, 16]);
    expect(leftBeams.map((b) => b.lengthFt)).toEqual([25, 25]);
    expect(topo.physicalL).toBe(32);
    expect(topo.physicalW).toBe(50);
  });

  it("masking dims are untouched by this — still span + 2×pillarWidth, a real physical fabric-wrap addition", () => {
    const topo = buildTopology("u_only", 0, 32, 10, 32, 0, { maxSpanFt: 30, pillarWidthFt: 0.75 });
    expect(topo.maskingL).toBe(32 + 2 * 0.75);
  });
});

// Isolated from real IMS stock numbers on purpose: maxSpanFt huge (always 2 pillars, 1 segment)
// turns "how many joints does this span need" into "can one or two 10ft beams reach this length,
// within resolveBeamSegment's own 1ft gap tolerance" — hand-verifiable, unlike real mixed stock
// (15/12/10/8/5/4/3/2ft) where working out the expected answer by hand is itself error-prone.
// The real engine (resolveBeamSegment, lib/ims/trussEngine.js) is exercised as-is; only the inputs
// are simplified. §23 Phase 6 (2026-11-03): segment length = span itself — no pillar-width
// deduction (the entered span already has room for its own pillars built in; see pricing.js's
// buildTopology/pickCleanSpan for why).
const trussInv = { settings: { maxSpanFt: 1000 }, beams: { 10: { stock: 100 } } };

describe("snapRowDimsForProduction — Deal Check Truss tab's minimum-joints dimension snap", () => {
  it("snaps down to the nearest span that actually resolves cleanly, when the entered one doesn't", () => {
    // 23ft: no combo of 10ft beams lands within 1ft of 23 (10 is 13 short, 20 is 3 short) —
    // unbuildable without a visible gap. 21ft: two 10ft beams (sum 20) land within the 1ft
    // tolerance — the nearest clean span, 2ft into the window.
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped.dims.L).toBe(21);
  });

  it("never grows a span, and never shrinks past the 5ft window", () => {
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped.dims.L).toBeLessThanOrEqual(23);
    expect(snapped.dims.L).toBeGreaterThanOrEqual(18); // 23 - 5
  });

  it("leaves an already-clean span untouched, returning the SAME object (no needless clone)", () => {
    // 20ft: exactly two 10ft beams, 0 gap — already as clean as this stock gets.
    const row = { dims: { L: 20, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped).toBe(row); // reference equality — nothing needed to change
    expect(snapped.dims.L).toBe(20);
  });

  it("only touches L/W — H, trussQty, material and everything else pass through untouched", () => {
    const row = { dims: { L: 23, W: 8, H: 12 }, trussMaterial: "iron", trussQty: 2, mkOn: true, drapeDensity: "dense" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped.dims.H).toBe(12);
    expect(snapped.trussQty).toBe(2);
    expect(snapped.mkOn).toBe(true);
    expect(snapped.drapeDensity).toBe("dense");
  });

  it("with no beam stock configured at all, returns the row unchanged rather than guessing", () => {
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, { settings: {}, beams: {} });
    expect(snapped).toBe(row);
  });

  it("does nothing to a row with no dims at all", () => {
    const row = { trussMaterial: "iron" };
    expect(snapRowDimsForProduction(row, trussInv)).toBe(row);
  });
});

// Owner ask (2026-10-22): the snap above is no longer a Deal-Check-only reference — trussRowCost
// (Build/Summary/export billing) and calcZoneTrussPreview (Deal Check's own cost rollup, manpower
// counting, the standing-venue discount, fabric qty) both apply it internally now, so every one of
// those reads the SAME real, minimum-joints structure instead of the raw typed span.
describe("trussRowCost / calcZoneTrussPreview — bill off the snapped span, not the raw one", () => {
  it("trussRowCost prices the Single U area off the snapped W, once real trussInv stock is given", () => {
    // W=23,H=10 unsnapped area = 230 sqft × default singleU rate 30 = 6900. Same stock/tolerance as
    // the snap tests above: 23 → 21 (two 10ft beams resolve the 21ft segment within 1ft gap).
    // Snapped area = 21×10 = 210 sqft × 30 = 6300 — strictly less, never more.
    const row = { dims: { W: 23, H: 10 }, trT: "singleU", trussMaterial: "iron", trussQty: 1 };
    const unsnapped = trussRowCost(row, {}); // no trussInv — no stock to snap against, prices raw
    const snapped = trussRowCost(row, { trussInv });
    expect(unsnapped.truss).toBe(6900);
    expect(snapped.truss).toBe(6300);
    expect(snapped.truss).toBeLessThan(unsnapped.truss);
  });

  it("calcZoneTrussPreview's topology already reflects the snap — calling it with the raw row or a pre-snapped row gives the same beams/pillars", () => {
    const row = { dims: { W: 23, H: 10 }, trussMaterial: "iron" };
    const previewRaw = calcZoneTrussPreview(row, trussInv);
    const previewPreSnapped = calcZoneTrussPreview(snapRowDimsForProduction(row, trussInv), trussInv);
    expect(previewRaw.topology.beams).toEqual(previewPreSnapped.topology.beams);
    expect(previewRaw.topology.pillars).toEqual(previewPreSnapped.topology.pillars);
    // And it's strictly the smaller, cleaner span — not the raw 23ft segment.
    expect(previewRaw.spanFt).toBe(21);
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

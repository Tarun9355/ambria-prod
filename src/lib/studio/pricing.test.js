import { describe, it, expect } from "vitest";
import { snapRowDimsForProduction, trussRowCost, calcZoneTrussPreview } from "./pricing";

// Isolated from real IMS stock numbers on purpose: maxSpanFt huge (always 2 pillars, 1 segment)
// turns "how many joints does this span need" into "can one or two 10ft beams reach this length,
// within resolveBeamSegment's own 1ft gap tolerance" — hand-verifiable, unlike real mixed stock
// (15/12/10/8/5/4/3/2ft) where working out the expected answer by hand is itself error-prone.
// pillarWidthFt is left at its real default (0.75ft, same as IMS Admin's own default) rather than
// zeroed out — snapRowDimsForProduction reads it the same `|| 0.75` way buildTopology always has,
// so an explicit 0 would silently fall back to 0.75 anyway, same as it does everywhere else in
// this truss engine. The real engine (resolveBeamSegment, lib/ims/trussEngine.js) is exercised
// as-is; only the inputs are simplified. (segment length = span − 2×0.75 = span − 1.5.)
const trussInv = { settings: { maxSpanFt: 1000 }, beams: { 10: { stock: 100 } } };

describe("snapRowDimsForProduction — Deal Check Truss tab's minimum-joints dimension snap", () => {
  it("snaps down to the nearest span that actually resolves cleanly, when the entered one doesn't", () => {
    // 23ft → segment 21.5ft: no combo of 10ft beams lands within 1ft of 21.5 (10 is 11.5 short,
    // 20 is 1.5 short) — unbuildable without a visible gap. 22.5ft → segment 21ft: two 10ft beams
    // (sum 20) land within the 1ft tolerance — the nearest clean span, half a foot into the window.
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped.dims.L).toBe(22.5);
  });

  it("never grows a span, and never shrinks past the 5ft window", () => {
    const row = { dims: { L: 23, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped.dims.L).toBeLessThanOrEqual(23);
    expect(snapped.dims.L).toBeGreaterThanOrEqual(18); // 23 - 5
  });

  it("leaves an already-clean span untouched, returning the SAME object (no needless clone)", () => {
    // 21.5ft → segment 20ft: exactly two 10ft beams, 0 gap — already as clean as this stock gets.
    const row = { dims: { L: 21.5, W: 8, H: 10 }, trussMaterial: "iron" };
    const snapped = snapRowDimsForProduction(row, trussInv);
    expect(snapped).toBe(row); // reference equality — nothing needed to change
    expect(snapped.dims.L).toBe(21.5);
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
    // the snap tests above: 23 → 22.5 (two 10ft beams resolve the 21ft segment within 1ft gap).
    // Snapped area = 22.5×10 = 225 sqft × 30 = 6750 — strictly less, never more.
    const row = { dims: { W: 23, H: 10 }, trT: "singleU", trussMaterial: "iron", trussQty: 1 };
    const unsnapped = trussRowCost(row, {}); // no trussInv — no stock to snap against, prices raw
    const snapped = trussRowCost(row, { trussInv });
    expect(unsnapped.truss).toBe(6900);
    expect(snapped.truss).toBe(6750);
    expect(snapped.truss).toBeLessThan(unsnapped.truss);
  });

  it("calcZoneTrussPreview's topology already reflects the snap — calling it with the raw row or a pre-snapped row gives the same beams/pillars", () => {
    const row = { dims: { W: 23, H: 10 }, trussMaterial: "iron" };
    const previewRaw = calcZoneTrussPreview(row, trussInv);
    const previewPreSnapped = calcZoneTrussPreview(snapRowDimsForProduction(row, trussInv), trussInv);
    expect(previewRaw.topology.beams).toEqual(previewPreSnapped.topology.beams);
    expect(previewRaw.topology.pillars).toEqual(previewPreSnapped.topology.pillars);
    // And it's strictly the smaller, cleaner span — not the raw 23ft segment.
    expect(previewRaw.spanFt).toBe(22.5);
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

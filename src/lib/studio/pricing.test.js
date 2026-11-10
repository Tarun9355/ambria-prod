import { describe, it, expect } from "vitest";
import { snapRowDimsForProduction, trussRowCost, calcZoneTrussPreview, calcZoneFabric, buildTopology, pillarCountForSpan, pillarCountForSpanRaw, nearestCleanSpans, buildPlatformPlan, trussInvForMaterial, zoneTrussStandingDiscountDetail, platformStandingDiscount } from "./pricing";

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

  it("31ft typed (a true ~29ft span padded by 2 pillars) does NOT gain a spurious middle pillar just for crossing maxSpanFt on the padded number (owner decision, 2026-11-04)", () => {
    const topo = buildTopology("u_only", 0, 31, 10, 31, 0, eng, realStock);
    expect(topo.pillarCount).toBe(2); // raw span/maxSpan math alone would wrongly say 3
  });

  it("62ft typed still gets its genuinely-needed middle pillar — the true-span estimate doesn't under-count a real long span", () => {
    const topo = buildTopology("u_only", 0, 62, 10, 62, 0, eng, realStock);
    expect(topo.pillarCount).toBe(3);
  });

  it("pillarCountForSpan is a closed-form, not an oscillating iteration — spans just above a threshold (33, 64, 95ft) settle deterministically, not depending on an iteration cap's parity", () => {
    expect(pillarCountForSpan(33, 30)).toBe(3);
    expect(pillarCountForSpan(64, 30)).toBe(4);
    expect(pillarCountForSpan(95, 30)).toBe(5);
  });
});

describe("buildTopology — pole uses the raw span (no 1ft/pillar padding), owner decision 2026-11-05", () => {
  const poleEng = { maxSpanFt: 15, pillarWidthFt: 0.3 };

  it("owner's worked example, no stock: 16x16x10 box splits every 16ft side into 2x8ft beams, 3 pillar positions per side, 8 distinct pillars total", () => {
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined, "pole");
    expect(topo.pillarCount).toBe(8);
    expect(topo.pillars.every((p) => p.H === 10)).toBe(true);
    expect(topo.beamCount).toBe(8);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
    expect(topo.beams.map((b) => b.side)).toEqual([
      "front-1", "front-2", "back-1", "back-2", "left-1", "left-2", "right-1", "right-2",
    ]);
    const pillarIds = topo.pillars.map((p) => p.id);
    expect(pillarIds).toEqual(expect.arrayContaining(["P-N-mid1", "P-S-mid1", "P-W-mid1", "P-E-mid1"]));
    expect(topo.physicalL).toBeCloseTo(16 + 3 * 0.3);
    expect(topo.physicalW).toBeCloseTo(16 + 3 * 0.3);
    expect(topo.stockResolved).toBe(false);
  });

  it("same example, with pole stock: resolves cleanly off real 8ft beams", () => {
    const poleStock = { beams: { 8: { stock: 20 } } };
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, poleStock, "pole");
    expect(topo.stockResolved).toBe(true);
    expect(topo.physicalL).toBeCloseTo(16 + 3 * 0.3);
  });

  it("control — the SAME dims with iron or aluminium (material omitted or non-pole) keep the padded convention: 2 pillars, one 14ft beam per side", () => {
    const ironTopo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined, "iron");
    const alumTopo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined, "aluminium");
    [ironTopo, alumTopo].forEach((topo) => {
      expect(topo.pillarCount).toBe(4); // 4 corners only, no mids
      expect(topo.beams.map((b) => b.lengthFt)).toEqual([14, 14, 14, 14]);
    });
  });

  it("material omitted entirely behaves exactly like iron (back-compat)", () => {
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined);
    expect(topo.pillarCount).toBe(4);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([14, 14, 14, 14]);
  });

  it("u_only pole, 14ft: fits in one maxSpan-15 gap, no mid pillar, beam is the raw 14ft (not 12ft)", () => {
    const topo = buildTopology("u_only", 0, 14, 10, 14, 0, poleEng, realStock, "pole");
    expect(topo.pillarCount).toBe(2);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([14]);
  });

  it("pillarCountForSpanRaw: smallest N with span/(N-1) <= maxSpan, no padding term", () => {
    expect(pillarCountForSpanRaw(16, 15)).toBe(3);
    expect(pillarCountForSpanRaw(15, 15)).toBe(2);
    expect(pillarCountForSpanRaw(30, 15)).toBe(3);
    expect(pillarCountForSpanRaw(31, 15)).toBe(4);
    expect(pillarCountForSpanRaw(0, 15)).toBe(2);
  });

  it("integration through calcZoneTrussPreview: a pole zone's live cost preview uses the unpadded topology and pole's own rates/stock", () => {
    const zc = { dims: { L: 16, W: 16, H: 10 }, trussMaterial: "pole" };
    const trussInv = {
      settings: { maxSpanFt: 30, pillarWidthFt: 0.75 },
      pillars: { 10: { stock: 50 } }, beams: { 14: { stock: 50 } },
      rates: { pillarRftRate: 20, beamRftRate: 15, battaRftRate: 7 },
      batta: { bufferPct: 10 },
      materials: {
        pole: {
          pillars: { 10: { stock: 50 } }, beams: { 8: { stock: 50 } },
          settings: { maxSpanFt: 15, pillarWidthFt: 0.3 },
          rates: { pillarRftRate: 10, beamRftRate: 8 },
        },
      },
    };
    const out = calcZoneTrussPreview(zc, trussInv);
    expect(out.topology.pillarCount).toBe(8);
    expect(out.topology.beams.map((b) => b.lengthFt)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);

    const ironOut = calcZoneTrussPreview({ ...zc, trussMaterial: "iron" }, trussInv);
    expect(ironOut.topology.pillarCount).toBe(4);
    expect(ironOut.topology.beams.map((b) => b.lengthFt)).toEqual([14, 14, 14, 14]);
  });
});

describe("nearestCleanSpans — the smart dim tip (owner ask, 2026-11-04, replaces the removed +1ft/pillar hint)", () => {
  const realStockWithPillars = { ...realStock, pillars: { 10: { stock: 20 }, 12: { stock: 20 } } };
  it("16ft typed (owner's own worked example): budget 14ft isn't in stock — suggests 14ft (12ft beam) down and 17ft (15ft beam) up", () => {
    const tip = nearestCleanSpans(16, 10, { ...eng, trussInv: realStockWithPillars });
    expect(tip.pillarCount).toBe(2);
    expect(tip.down).toEqual({ span: 14, budget: 12 });
    expect(tip.up).toEqual({ span: 17, budget: 15 });
  });
  it("already clean (14ft → 12ft budget, exactly in stock): no tip", () => {
    expect(nearestCleanSpans(14, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
  });
  it("a span needing a middle pillar (2+ gaps) doesn't get a single-beam tip", () => {
    expect(nearestCleanSpans(33, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
  });
  it("pillars for this height can't be assembled from stock at all — no beam choice fixes that, so no tip", () => {
    const noPillars = { ...realStock, pillars: {} };
    expect(nearestCleanSpans(16, 10, { ...eng, trussInv: noPillars })).toBeNull();
  });
  it("budget below every stock size: only an upward suggestion", () => {
    const tip = nearestCleanSpans(3, 10, { ...eng, trussInv: realStockWithPillars }); // budget = 3-2 = 1
    expect(tip.down).toBeNull();
    expect(tip.up).toEqual({ span: 4, budget: 2 });
  });
  it("a single beam up to 1ft short of budget is ALREADY clean (resolveBeamSegment's own tolerance) — no false 'needs a joint', even though the budget isn't an exact stock size", () => {
    // 13ft → budget 11 → resolveBeamSegment picks one 10ft beam (0 joints, 1ft gap) over any 2-piece
    // combo, since joints (weight 100) dominates gap (weight 10) in its own cost ranking.
    expect(nearestCleanSpans(13, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
    // 15ft → budget 13 → one 12ft beam, 0 joints, 1ft gap.
    expect(nearestCleanSpans(15, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
    // 17.5ft → budget 15.5 → one 15ft beam, 0 joints, 0.5ft gap.
    expect(nearestCleanSpans(17.5, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
    // 18ft → budget 16 → one 15ft beam, 0 joints, 1ft gap (beats 12+4, which would be a joint).
    expect(nearestCleanSpans(18, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
  });
  it("a bigger nudge than ~6ft stops suggesting rather than jumping to a wildly different span", () => {
    // 31ft → budget 29 — nothing in stock within 6ft either direction (largest stock size is 15ft).
    expect(nearestCleanSpans(31, 10, { ...eng, trussInv: realStockWithPillars })).toBeNull();
  });
  it("Full Box needs 2 units of the same beam size (front+back / left+right reuse one segment length) — 1 unit in stock is not enough, so it keeps looking", () => {
    const tightStock = { pillars: { 10: { stock: 5 } }, beams: { 7: { stock: 1 }, 5: { stock: 20 } } };
    // typed 9 → budget 7 — exactly matches the 7ft size.
    expect(nearestCleanSpans(9, 10, { ...eng, trussInv: tightStock, piecesNeeded: 1 })).toBeNull(); // 1 unit is enough for a single-row axis
    const tip = nearestCleanSpans(9, 10, { ...eng, trussInv: tightStock, piecesNeeded: 2 }); // Full Box: needs 2
    expect(tip.down).toEqual({ span: 7, budget: 5 }); // the 7ft size only has 1 unit — not enough — falls back to 5ft (20 in stock)
    expect(tip.up).toBeNull();
  });
  it("no beam stock at all: no tip (nothing to suggest)", () => {
    expect(nearestCleanSpans(16, 10, { ...eng, trussInv: { pillars: { 10: { stock: 5 } } } })).toBeNull();
  });
  it("pole (owner decision, 2026-11-05): no padding — budget IS the raw typed span, not span-2", () => {
    const poleStock = { pillars: { 10: { stock: 5 } }, beams: { 15: { stock: 5 }, 12: { stock: 5 } } };
    const tip = nearestCleanSpans(14, 10, { maxSpanFt: 15, trussInv: poleStock, material: "pole" });
    expect(tip).toEqual({ pillarCount: 2, down: { span: 12, budget: 12 }, up: { span: 15, budget: 15 } });
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

describe("buildPlatformPlan — platform material (Wood/Iron) is independent of truss material (owner decision, 2026-11-05)", () => {
  // Blended rate: (100*10 + 300*20) / 400 = 17.5 — same math platformEngine.test.js locks in directly.
  const platformTrussInv = {
    platforms: [
      { lengthFt: 10, widthFt: 10, stock: 1, material: "Wood", ratePerSqft: 10 },
      { lengthFt: 10, widthFt: 10, stock: 3, material: "Iron", ratePerSqft: 20 },
    ],
  };
  const fn = (trussMaterial) => ({
    zoneConfig: { stage: { plH: "1ft", floorDims: { L: 10, W: 2 }, plQty: 1, trussMaterial } },
    enabledEls: { stage: true },
  });

  it("a pole-truss zone and an iron-truss zone get the IDENTICAL blended rate — truss material has no bearing on platform billing", () => {
    const polePlan = buildPlatformPlan([fn("pole")], { trussInv: platformTrussInv });
    const ironPlan = buildPlatformPlan([fn("iron")], { trussInv: platformTrussInv });
    expect(polePlan.perZone["0|stage"].rate).toBeCloseTo(17.5);
    expect(ironPlan.perZone["0|stage"].rate).toBeCloseTo(17.5);
    expect(polePlan.perZone["0|stage"].rate).toBe(ironPlan.perZone["0|stage"].rate);
  });

  it("perZone entries no longer carry a `material` field — it was never real for platforms", () => {
    const plan = buildPlatformPlan([fn("pole")], { trussInv: platformTrussInv });
    expect(plan.perZone["0|stage"].material).toBeUndefined();
  });

  it("cost is sqft × the blended rate", () => {
    const plan = buildPlatformPlan([fn("iron")], { trussInv: platformTrussInv });
    const entry = plan.perZone["0|stage"];
    expect(entry.sqft).toBe(20); // 10*2*1
    expect(entry.cost).toBe(Math.round(20 * 17.5));
  });

  it("an extra platform row keys as `${fn}|${zone}|${rowIdx}`, not the row-0 key", () => {
    const fnWithExtra = {
      zoneConfig: { stage: { plH: "1ft", floorDims: { L: 10, W: 2 }, plQty: 1, extraPlatformRows: [{ plH: "2ft", floorDims: { L: 5, W: 5 }, plQty: 1 }] } },
      enabledEls: { stage: true },
    };
    const plan = buildPlatformPlan([fnWithExtra], { trussInv: platformTrussInv });
    expect(plan.perZone["0|stage"]).toBeDefined();
    expect(plan.perZone["0|stage|1"]).toBeDefined();
    expect(plan.perZone["0|stage|1"].sqft).toBe(25); // 5*5*1
  });

  it("trussInv.materials.pole.platforms, even if set, does not change the blended rate — platforms are never resolved per truss-material", () => {
    const withBogusMaterials = { ...platformTrussInv, materials: { pole: { platforms: [{ lengthFt: 100, widthFt: 100, stock: 50, ratePerSqft: 999 }] } } };
    const plan = buildPlatformPlan([fn("pole")], { trussInv: withBogusMaterials });
    expect(plan.perZone["0|stage"].rate).toBeCloseTo(17.5); // unaffected by the bogus 999 rate under materials.pole
  });
});

describe("trussInvForMaterial — no longer resolves platforms per truss-material (owner decision, 2026-11-05)", () => {
  it("platforms pass through unchanged for every material — pole/aluminium never read trussInv.materials[x].platforms", () => {
    const base = {
      platforms: [{ id: "p1", material: "Wood" }],
      materials: { pole: { pillars: { 10: { stock: 5 } }, platforms: [{ id: "bogus", material: "Iron" }] } },
    };
    expect(trussInvForMaterial(base, "pole").platforms).toBe(base.platforms);
    expect(trussInvForMaterial(base, "iron").platforms).toBe(base.platforms);
  });
});

// A fixed venue's standing pillars/beams are now tracked per truss material (Iron/Pole/Aluminium —
// see fixedVenues.js's normalizedTrussCounts). zoneTrussStandingDiscountDetail must only discount a
// zone against the slice of standing stock that matches ITS OWN truss material — an Iron zone must
// never draw down a venue's Pole allocation, or vice versa.
describe("zoneTrussStandingDiscountDetail — matches a zone's OWN truss material against the venue's standing count for that material", () => {
  const trussInv = {
    settings: { maxSpanFt: 30, pillarWidthFt: 0.75 },
    pillars: { 10: { stock: 50 } }, beams: { 12: { stock: 50 } },
    rates: { pillarRftRate: 20, beamRftRate: 15, battaRftRate: 7 },
    batta: { bufferPct: 10 },
    materials: {
      pole: {
        pillars: { 10: { stock: 50 } }, beams: { 8: { stock: 50 } },
        settings: { maxSpanFt: 15, pillarWidthFt: 0.3 },
        rates: { pillarRftRate: 10, beamRftRate: 8 },
      },
    },
  };
  const zcIron = { dims: { L: 14, W: 14, H: 10 }, trT: "u_only", trussQty: 1, trussMaterial: "iron" };
  const zcPole = { ...zcIron, trussMaterial: "pole" };

  it("an Iron-material zone draws against the venue's Iron standing pillars, not its (larger) Pole bucket", () => {
    const venueTruss = { pillars: { iron: { 10: 10 }, pole: { 10: 2 } }, beams: {}, pillarDiscountPct: 50, beamDiscountPct: 0 };
    const preview = calcZoneTrussPreview(zcIron, trussInv);
    const detail = zoneTrussStandingDiscountDetail(zcIron, trussInv, venueTruss);
    expect(detail.pillar).toBe(Math.round(Math.min(preview.costs.pillarRft, 10 * 10) * trussInv.rates.pillarRftRate * 0.5));
  });

  it("a Pole-material zone draws against the venue's (smaller) Pole standing pillars, valued at Pole's OWN rate — never Iron's bucket or Iron's rate", () => {
    const venueTruss = { pillars: { iron: { 10: 10 }, pole: { 10: 2 } }, beams: {}, pillarDiscountPct: 50, beamDiscountPct: 0 };
    const preview = calcZoneTrussPreview(zcPole, trussInv);
    const detail = zoneTrussStandingDiscountDetail(zcPole, trussInv, venueTruss);
    const poleRate = trussInv.materials.pole.rates.pillarRftRate; // 10 — half Iron's 20
    const ifWronglyUsedIronBucketAndRate = Math.round(Math.min(preview.costs.pillarRft, 10 * 10) * trussInv.rates.pillarRftRate * 0.5);
    expect(detail.pillar).toBe(Math.round(Math.min(preview.costs.pillarRft, 2 * 10) * poleRate * 0.5));
    expect(detail.pillar).toBeLessThan(ifWronglyUsedIronBucketAndRate);
  });

  it("an unrecognized trussMaterial value falls back to Iron, matching calcZoneTrussPreview's own fallback — not silently 0", () => {
    const venueTruss = { pillars: { iron: { 10: 10 } }, beams: {}, pillarDiscountPct: 50, beamDiscountPct: 0 };
    const zcWeird = { ...zcIron, trussMaterial: "titanium" };
    const preview = calcZoneTrussPreview(zcWeird, trussInv); // also falls back to iron internally
    const detail = zoneTrussStandingDiscountDetail(zcWeird, trussInv, venueTruss);
    expect(detail.pillar).toBe(Math.round(Math.min(preview.costs.pillarRft, 10 * 10) * trussInv.rates.pillarRftRate * 0.5));
  });

  it("a legacy (pre-material-split) flat venueTruss.pillars is read entirely as Iron — an Iron zone sees it, a Pole zone does not", () => {
    const venueTruss = { pillars: { 10: 10 }, beams: {}, pillarDiscountPct: 50, beamDiscountPct: 0 };
    expect(zoneTrussStandingDiscountDetail(zcIron, trussInv, venueTruss).pillar).toBeGreaterThan(0);
    expect(zoneTrussStandingDiscountDetail(zcPole, trussInv, venueTruss).pillar).toBe(0);
  });
});

describe("platformStandingDiscount — fixed-venue standing platform sqft discount (flat pool, no material split)", () => {
  it("discounts only the overlap between sqft needed and sqft standing, at the configured %", () => {
    expect(platformStandingDiscount(900, 25, { platformSqft: 500, platformDiscountPct: 25 })).toBe(3125); // 500 × 25 × 0.25
  });
  it("caps at what's actually needed — more standing than needed doesn't over-discount", () => {
    expect(platformStandingDiscount(200, 25, { platformSqft: 500, platformDiscountPct: 25 })).toBe(1250); // 200 × 25 × 0.25
  });
  it("0 with no venue config, no standing sqft, or no discount %", () => {
    expect(platformStandingDiscount(900, 25, null)).toBe(0);
    expect(platformStandingDiscount(900, 25, { platformSqft: 0, platformDiscountPct: 25 })).toBe(0);
    expect(platformStandingDiscount(900, 25, { platformSqft: 500, platformDiscountPct: 0 })).toBe(0);
  });
  it("0 when nothing is actually needed or the rate itself is 0", () => {
    expect(platformStandingDiscount(0, 25, { platformSqft: 500, platformDiscountPct: 25 })).toBe(0);
    expect(platformStandingDiscount(900, 0, { platformSqft: 500, platformDiscountPct: 25 })).toBe(0);
  });
  it("a stray >100% (the admin % input has no hard ceiling) is clamped to 100, never discounting more than the sqft actually cost", () => {
    expect(platformStandingDiscount(900, 25, { platformSqft: 500, platformDiscountPct: 150 }))
      .toBe(platformStandingDiscount(900, 25, { platformSqft: 500, platformDiscountPct: 100 }));
  });
});

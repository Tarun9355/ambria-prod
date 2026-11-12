import { describe, it, expect } from "vitest";
import { buildTopology, buildEventAllocation, pillarCountForSpanRaw, materialHasSpanPadding, reservedTrussStockOnDate, skeletonMaterialKey } from "./trussEngine";

// §23 Phase 7 mirror — this file's buildTopology must never drift from pricing.js's own copy
// (pricing.test.js has the full Phase 7 padded-span suite; these three cases are repeated here just
// to confirm the two copies agree, not to re-litigate the whole spec).
const eng = { maxSpanFt: 30, pillarWidthFt: 0.75 };
const realStock = { beams: { 15: { stock: 40 }, 12: { stock: 90 }, 10: { stock: 85 }, 8: { stock: 8 } } };

describe("trussEngine buildTopology — mirrors pricing.js (padded convention, unchanged)", () => {
  it("14ft (no middle pillar): budget 12ft, resolves to one clean 12ft beam, footprint 13.5ft", () => {
    const topo = buildTopology("u_only", 0, 14, 10, 14, 0, eng, realStock);
    expect(topo.pillarCount).toBe(2);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([12]);
    expect(topo.physicalL).toBe(13.5);
  });

  it("material omitted entirely behaves exactly like iron (back-compat)", () => {
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, { maxSpanFt: 15, pillarWidthFt: 0.3 }, undefined);
    expect(topo.pillarCount).toBe(4);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([14, 14, 14, 14]);
  });
});

describe("trussEngine buildTopology — pole uses the raw span (no 1ft/pillar padding), owner decision 2026-11-05", () => {
  const poleEng = { maxSpanFt: 15, pillarWidthFt: 0.3 };

  it("owner's worked example: 16x16x10 box splits every 16ft side into 2x8ft beams, 8 perimeter pillars + 1 shared center post (cross-bracing, 2026-11-12 — see pricing.test.js's mirrored case for the full rationale)", () => {
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined, "pole");
    expect(topo.pillarCount).toBe(9);
    expect(topo.beamCount).toBe(12);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
    expect(topo.pillars.filter((p) => p.interior).map((p) => p.id)).toEqual(["P-center"]);
  });

  it("control — the SAME dims with iron keep the padded convention: 4 pillars, 14ft beams", () => {
    const topo = buildTopology("full_box", 16, 16, 10, 16, 0, poleEng, undefined, "iron");
    expect(topo.pillarCount).toBe(4);
    expect(topo.beams.map((b) => b.lengthFt)).toEqual([14, 14, 14, 14]);
  });

  it("pillarCountForSpanRaw / materialHasSpanPadding", () => {
    expect(pillarCountForSpanRaw(16, 15)).toBe(3);
    expect(pillarCountForSpanRaw(15, 15)).toBe(2);
    expect(materialHasSpanPadding("pole")).toBe(false);
    expect(materialHasSpanPadding("POLE")).toBe(false); // case-insensitive
    expect(materialHasSpanPadding("iron")).toBe(true);
    expect(materialHasSpanPadding("aluminium")).toBe(true);
    expect(materialHasSpanPadding(undefined)).toBe(true); // back-compat default
  });
});

describe("buildEventAllocation — per-material resolution (bug found + fixed 2026-11-05)", () => {
  // Before the fix, a Pole/Aluminium zone's production allocation always read the top-level (Iron)
  // settings and stock, never trussInv.materials[mat] — so a pole zone's beams resolved against
  // IRON's stock (14ft pieces here), not pole's own (8ft pieces). This locks in that it now doesn't.
  const trussInv = {
    settings: { maxSpanFt: 30, pillarWidthFt: 0.75 },
    pillars: { 14: { stock: 50 } }, beams: { 14: { stock: 50 } }, // Iron stock — deliberately NOT what pole needs
    materials: {
      pole: {
        pillars: { 10: { stock: 50 } }, beams: { 8: { stock: 50 } },
        settings: { maxSpanFt: 15, pillarWidthFt: 0.3 },
      },
    },
  };
  const meta = { eoId: "eo1", clientId: "c1", clientName: "Test" };

  it("a pole zone resolves against pole's OWN stock/settings, not Iron's", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 16, W: 16, H: 10 }, trussMaterial: "pole" },
    }, enabledEls: {} }];
    const out = buildEventAllocation(meta, fnList, trussInv);
    expect(out.trusses[0].trussMaterial).toBe("pole");
    expect(out.trusses[0].allocation.pillarCount).toBe(9); // 8 perimeter + 1 shared center post (cross-bracing)
    expect(out.totalBeamsUsed).toEqual({ 8: 12 }); // pole's 8ft stock — NOT Iron's 14ft
    expect(out.totalPillarsUsed).toEqual({ 10: 9 }); // pole's 10ft stock
    expect(out.selfShortage).toBe(false);
  });

  it("an iron zone (no trussMaterial) is unaffected — still resolves against the top-level stock", () => {
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 16, W: 16, H: 10 } },
    }, enabledEls: {} }];
    const out = buildEventAllocation(meta, fnList, trussInv);
    expect(out.trusses[0].trussMaterial).toBe("iron");
    expect(out.trusses[0].allocation.pillarCount).toBe(4);
    expect(out.totalBeamsUsed).toEqual({ 14: 4 });
  });

  it("regression: a pole zone whose pole stock lacks a size reports a genuine shortage, not a false match off Iron's stock", () => {
    // thinPoleInv's pole has NO beams at all (only a 10ft pillar) — this zone should shortage on
    // beams specifically, and totalBeamsUsed must never show Iron's 14ft size as if it were used.
    const thinPoleInv = {
      settings: { maxSpanFt: 30, pillarWidthFt: 0.75 },
      pillars: { 14: { stock: 50 } }, beams: { 14: { stock: 50 } },
      materials: { pole: { pillars: { 10: { stock: 50 } }, beams: {}, settings: { maxSpanFt: 15, pillarWidthFt: 0.3 } } },
    };
    const fnList = [{ fnIdx: 0, zones: {
      z1: { dims: { L: 16, W: 16, H: 10 }, trussMaterial: "pole" },
    }, enabledEls: {} }];
    const out = buildEventAllocation(meta, fnList, thinPoleInv);
    expect(out.trusses[0].shortage).toBe(true);
    expect(out.totalBeamsUsed[14]).toBeUndefined(); // never falls back to Iron's 14ft stock
  });
});

describe("skeletonMaterialKey — which pool a truss material's pieces actually come from", () => {
  it("iron is always its own pool", () => {
    expect(skeletonMaterialKey({}, "iron")).toBe("iron");
    expect(skeletonMaterialKey(null, undefined)).toBe("iron"); // missing material defaults to iron
  });
  it("a material with a real configured skeleton gets its own pool", () => {
    const trussInv = { materials: { pole: { pillars: { 10: { stock: 5 } } } } };
    expect(skeletonMaterialKey(trussInv, "pole")).toBe("pole");
  });
  it("a material with no skeleton configured yet falls back to iron — it was resolved against Iron's stock", () => {
    expect(skeletonMaterialKey({ materials: {} }, "pole")).toBe("iron");
    expect(skeletonMaterialKey({ materials: { pole: { pillars: {} } } }, "pole")).toBe("iron");
  });
});

describe("reservedTrussStockOnDate — Build's truss tip reading real per-date commitments (owner ask, 2026-11-11)", () => {
  // Shape matches a real studioFloralData.trussAlloc[date].events entry (buildEventAllocation's own
  // output): { clientId, eoId, trusses: [{ trussMaterial, allocation: { totals: { pillarsUsed, beamsUsed } } }] }.
  const ev = (clientId, eoId, trusses) => ({ clientId, eoId, trusses });
  const truss = (trussMaterial, pillarsUsed, beamsUsed) => ({ trussMaterial, allocation: { totals: { pillarsUsed, beamsUsed } } });

  it("sums pillars/beams across every OTHER event's trusses, keyed by material", () => {
    const dateEntry = { events: [
      ev("CLI_A", "eo_a", [truss("iron", { 10: 2 }, { 12: 1 })]),
      ev("CLI_B", "eo_b", [truss("iron", { 10: 1 }, { 15: 1 })]),
    ] };
    const out = reservedTrussStockOnDate(dateEntry, { trussInv: {} });
    expect(out.iron.pillars).toEqual({ 10: 3 });
    expect(out.iron.beams).toEqual({ 12: 1, 15: 1 });
  });
  it("excludes the caller's own client — a build must never read as shorted by its own demand", () => {
    const dateEntry = { events: [
      ev("CLI_SELF", "eo_self", [truss("iron", { 10: 5 }, { 12: 5 })]),
      ev("CLI_OTHER", "eo_other", [truss("iron", { 10: 1 }, { 12: 1 })]),
    ] };
    const out = reservedTrussStockOnDate(dateEntry, { excludeClientId: "CLI_SELF", trussInv: {} });
    expect(out.iron.pillars).toEqual({ 10: 1 });
    expect(out.iron.beams).toEqual({ 12: 1 });
  });
  it("excludes the self-check sentinel event regardless of client id", () => {
    const dateEntry = { events: [ev(null, "__self_check__", [truss("iron", { 10: 9 }, {})])] };
    expect(reservedTrussStockOnDate(dateEntry, { trussInv: {} })).toEqual({});
  });
  it("keeps Iron and a properly-configured Pole pool separate", () => {
    const trussInv = { materials: { pole: { pillars: { 8: { stock: 5 } } } } };
    const dateEntry = { events: [
      ev("CLI_A", "eo_a", [truss("iron", { 10: 2 }, {}), truss("pole", { 8: 3 }, {})]),
    ] };
    const out = reservedTrussStockOnDate(dateEntry, { trussInv });
    expect(out.iron.pillars).toEqual({ 10: 2 });
    expect(out.pole.pillars).toEqual({ 8: 3 });
  });
  it("folds an unconfigured Pole's reservation into Iron's pool — it really was built from Iron's stock", () => {
    const dateEntry = { events: [ev("CLI_A", "eo_a", [truss("pole", { 10: 2 }, {})])] };
    const out = reservedTrussStockOnDate(dateEntry, { trussInv: { materials: {} } }); // pole has no skeleton
    expect(out.iron.pillars).toEqual({ 10: 2 });
    expect(out.pole).toBeUndefined();
  });
  it("a truss row with no trussMaterial at all (older data) counts as iron", () => {
    const dateEntry = { events: [ev("CLI_A", "eo_a", [truss(undefined, { 10: 1 }, {})])] };
    expect(reservedTrussStockOnDate(dateEntry, { trussInv: {} }).iron.pillars).toEqual({ 10: 1 });
  });
  it("no date entry at all: empty, no throw", () => {
    expect(reservedTrussStockOnDate(undefined, { trussInv: {} })).toEqual({});
    expect(reservedTrussStockOnDate(null, {})).toEqual({});
  });
});

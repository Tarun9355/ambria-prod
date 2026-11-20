import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  assembleMandiCatalogueFromRows, assembleFlowerPatternsFromRows, matchFlowerPattern, floralPatternUnitRates,
  computePatternSizeCost, resolveSizeKey, mirrorFlowerPick,
} from "./flowerHelpers";

const SRC = resolve(__dirname, "../..");
const read = (rel) => readFileSync(resolve(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const admin = read("pages/ims/AdminSettingsTab.jsx");

// ───────────────────────────── B. ordering consumers ─────────────────────────────
describe("B. id ordering - comparator properties", () => {
  const prow = (id, name = "n", sub = "S") => ({ id, name, flat_or_smb: "smb", sub, unit: "pc", sizes: {} });
  const mrow = (id, name = "n") => ({ id, name, unit: "bundle", current_price: 1 });
  it("rows with a missing / null / numeric id do not throw and sort first / consistently", () => {
    expect(() => assembleMandiCatalogueFromRows([mrow(null), mrow(undefined), mrow("F1"), mrow(5)])).not.toThrow();
    expect(() => assembleFlowerPatternsFromRows([prow(null), prow("FP1"), prow(7)])).not.toThrow();
    expect(assembleMandiCatalogueFromRows([mrow("F1"), mrow(null)]).map((f) => f.id)).toEqual([null, "F1"]);
  });
  it("is a pure sort of a copy: same set of rows out as in, whatever the order", () => {
    const rows = ["F10", "F2", "F1", "Fb", "FB", "Fa"].map((id) => mrow(id));
    const out = assembleMandiCatalogueFromRows(rows).map((f) => f.id);
    expect(out.slice().sort()).toEqual(rows.map((r) => r.id).sort());
    expect(out.indexOf("F1")).toBeLessThan(out.indexOf("F2"));
    expect(out.indexOf("F2")).toBeLessThan(out.indexOf("F10"));
  });
  it("is independent of the order the rows came back in (a total order for distinct ids)", () => {
    const ids = ["F1", "F2", "F10", "Fmabc1", "Fmabb9", "Flx9a", "Flx10", "Fa", "FA", "F9x"];
    const base = assembleMandiCatalogueFromRows(ids.map((i) => mrow(i))).map((f) => f.id);
    for (let k = 0; k < 25; k++) {
      const shuffled = ids.slice().sort(() => Math.random() - 0.5);
      expect(assembleMandiCatalogueFromRows(shuffled.map((i) => mrow(i))).map((f) => f.id)).toEqual(base);
    }
  });
  it("LIMITATION: ids that the numeric collation calls equal ('F01' and 'F1') keep whatever order the database gave - still physical order for that pair (unreachable with timestamp ids)", () => {
    expect(assembleMandiCatalogueFromRows([mrow("F1"), mrow("F01")]).map((f) => f.id)).toEqual(["F1", "F01"]);
    expect(assembleMandiCatalogueFromRows([mrow("F01"), mrow("F1")]).map((f) => f.id)).toEqual(["F01", "F1"]);
  });
  it("a base-36 id is NOT strictly creation order under numeric collation ('F9x' sorts before 'F10..'), but it is fixed - recorded", () => {
    expect(assembleMandiCatalogueFromRows([mrow("F10"), mrow("F9x")]).map((f) => f.id)).toEqual(["F9x", "F10"]);
  });
});

describe("B. RISK - an order change can change WHICH recipe / flower a lookup returns (and so a price)", () => {
  const prow = (id, sub, name, qty) => ({ id, name, flat_or_smb: "smb", sub, unit: "pc", sizes: { medium: { flowers: [{ flowerId: "rose", qty }], totalPieces: 0 } } });
  const mandi = [{ id: "rose", name: "Rose", unit: "piece", gattharSize: null, currentPrice: 10, colorVariants: [] }];
  // the DB hands back the recipe that was edited most recently LAST (physical order); creation order is the id order
  const dbOrder = [prow("FP2", "Flower Pot Small", "Pot B", 9), prow("FP1", "Flower Pot Small", "Pot A", 1)];
  const item = { name: "Round Fibre Pot", subcategory: "Flower Pot Small" };
  const rate = (pats) => floralPatternUnitRates(matchFlowerPattern(item, pats), "medium", mandi, { defaultStudioMarkup: 3 }, []).realRate;

  it("two recipes under one sub-category are possible: the Recipes panel groups many recipes per sub and '+ Add Item' adds more", () => {
    expect(admin).toContain("const sub = (p.sub || \"\").trim() || \"(uncategorized)\";");
    expect(admin).toContain("(groupedBySub[sub] = groupedBySub[sub] || []).push(p);");
    expect(admin).toContain("const fresh = { id: genFlowerPatternId(), name: nm, mode: \"flat\", sub,");
  });
  it("matchFlowerPattern returns the FIRST same-sub recipe, so the id sort can pick a different recipe than the old physical order did", () => {
    const old = dbOrder.map((r) => ({ id: r.id, name: r.name, sub: r.sub, mode: "smb", sizes: r.sizes }));
    const sorted = assembleFlowerPatternsFromRows(dbOrder);
    expect(matchFlowerPattern(item, old).id).toBe("FP2");
    expect(matchFlowerPattern(item, sorted).id).toBe("FP1");
    expect(rate(old)).not.toBe(rate(sorted)); // 9 * 10 * 3 = 270 vs 1 * 10 * 3 = 30
    expect([rate(old), rate(sorted)]).toEqual([270, 30]);
  });
  it("the by-sub fallback is only used when an element carries no patternId (every pricing caller tries el.patternId first)", () => {
    const f = read("lib/studio/floralCost.js");
    expect(f).toContain("el.patternId ? flowerPatterns.find((p) => p.id === el.patternId) : null");
    expect(f).toContain("matchFlowerPattern(invItem, flowerPatterns)");
  });
  it("RISK: by-NAME lookups on the catalogue (DepartmentOpsTab: mandiCatalogue.find(c => c.name === ...)) also depend on the order when two flowers share a name", () => {
    const rows = [{ id: "F2", name: "Rose", current_price: 50 }, { id: "F1", name: "Rose", current_price: 20 }];
    const oldFirst = rows.map((r) => ({ id: r.id, name: r.name })).find((c) => c.name === "Rose").id;
    const newFirst = assembleMandiCatalogueFromRows(rows).find((c) => c.name === "Rose").id;
    expect(oldFirst).toBe("F2");
    expect(newFirst).toBe("F1");
    expect(read("pages/ims/DepartmentOpsTab.jsx")).toContain("mandiCatalogue.find(c => c.name === toName)");
  });
});

describe("B. every route from the tables into settings goes through the sorted assemblers", () => {
  const walk = (dir, out = []) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
  };
  const files = walk(SRC);
  it("rowToMandiFlower / rowToFlowerPattern (unsorted single-row converters) are used only inside flowerHelpers.js (plus the deleted-item restore, which converts ONE audit-log row, not a list)", () => {
    const offenders = files.filter((f) => !f.endsWith("flowerHelpers.js") && !f.endsWith("deletedCatalogue.js")).filter((f) => /\browToMandiFlower\(|\browToFlowerPattern\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("every file that reads the mandi_flowers / flower_patterns tables into a list uses the assemblers", () => {
    const readers = files.filter((f) => /fetchAll\(\s*["'](mandi_flowers|flower_patterns)["']/.test(readFileSync(f, "utf8")) || /safeFetch\(\s*["'](mandi_flowers|flower_patterns)["']/.test(readFileSync(f, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    for (const f of readers) {
      const s = readFileSync(f, "utf8");
      expect(/assembleMandiCatalogueFromRows|assembleFlowerPatternsFromRows|applyMandiRows|applyFlowerPatternRows/.test(s), f).toBe(true);
    }
  });
  it("IMS realtime + boot and both Studio fetch sites call the assemblers", () => {
    const ims = read("pages/ims/IMS.jsx"), st = read("pages/studio/StudioApp.jsx");
    expect(ims).toContain("const mc = assembleMandiCatalogueFromRows(rows);");
    expect(ims).toContain("const fp = assembleFlowerPatternsFromRows(rows);");
    expect(ims).toContain("settingsObj.mandiCatalogue = assembleMandiCatalogueFromRows(mandiRowsRef.current);");
    expect(ims).toContain("settingsObj.flowerPatterns = assembleFlowerPatternsFromRows(patternRowsRef.current);");
    expect((st.match(/assembleFlowerPatternsFromRows\(patternRows\)/g) || []).length).toBe(2);
    expect((st.match(/assembleMandiCatalogueFromRows\(mandiRows\)/g) || []).length).toBe(2);
  });
});

// ───────────────────────────── C. mirrorFlowerPick edges ─────────────────────────────
const mandi = (id) => ({ id, source: "mandi" });
const inv = (id) => ({ id, source: "inventory" });
const mPatch = (id) => ({ flowerId: id, invItemId: undefined, gsSnap: undefined });
const iPatch = (id) => ({ invItemId: id, flowerId: undefined });
const pick = (sizes, over = {}) => mirrorFlowerPick({ sizes, mode: "smb", fromSize: "small", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose"), ...over });
const keys = (sizes, n) => (sizes[n]?.flowers || []).map((r) => r.invItemId ? "i:" + r.invItemId : r.flowerId ? "f:" + r.flowerId : "");
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

describe("C. mirrorFlowerPick edge cases", () => {
  const empty = () => ({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] }, big: { flowers: [] } });

  it("does not mutate a deeply frozen input", () => {
    const sizes = deepFreeze({ small: { flowers: [{ flowerId: "a", qty: 2 }], totalPieces: 5 }, medium: { flowers: [{ flowerId: "a", qty: 3 }] }, big: { flowers: [] } });
    expect(() => pick(sizes, { cand: mandi("rose") })).not.toThrow();
    expect(() => pick(sizes, { cand: inv("art1"), fromPatch: iPatch("art1") })).not.toThrow();
  });
  it("picking the SAME flower the row already has is a no-op for the other sizes (the picking row still gets the patch)", () => {
    const sizes = { small: { flowers: [{ flowerId: "rose", qty: 4 }] }, medium: { flowers: [{ flowerId: "lily", qty: 2 }] }, big: { flowers: [] } };
    const out = pick(sizes);
    expect(out.medium).toBe(sizes.medium);
    expect(out.big).toBe(sizes.big);
    expect(out.small.flowers[0]).toMatchObject({ flowerId: "rose", qty: 4 });
  });
  it("an inventory cand whose id string equals a mandi flower id in the other size is NOT treated as already present (keys are namespaced)", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "X1", qty: 3 }] }, big: { flowers: [] } };
    const out = pick(sizes, { cand: inv("X1"), fromPatch: iPatch("X1") });
    expect(keys(out, "medium")).toEqual(["f:X1", "i:X1"]);
    expect(out.medium.flowers[1]).toEqual({ invItemId: "X1", qty: 0 });
  });
  it("and the other way round: a mandi cand 'X1' with an inventory row 'X1' in the other size adds the mandi row", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ invItemId: "X1", qty: 3 }] }, big: { flowers: [] } };
    const out = pick(sizes, { cand: mandi("X1"), fromPatch: mPatch("X1") });
    expect(keys(out, "medium")).toEqual(["i:X1", "f:X1"]);
  });
  it("a size already holding the flower TWICE is untouched", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "rose", qty: 1 }, { flowerId: "rose", qty: 2 }] }, big: { flowers: [] } };
    expect(pick(sizes).medium).toBe(sizes.medium);
  });
  it("the OLD flower present twice in the other size: only the first is switched, the second stays (and keeps its qty)", () => {
    const sizes = { small: { flowers: [{ flowerId: "old", qty: 1 }] }, medium: { flowers: [{ flowerId: "old", qty: 5 }, { flowerId: "old", qty: 6 }] }, big: { flowers: [] } };
    const out = pick(sizes);
    expect(out.medium.flowers.map((r) => [r.flowerId, r.qty])).toEqual([["rose", 5], ["old", 6]]);
  });
  it("the old flower references a DELETED flower: still switched like any other id", () => {
    const sizes = { small: { flowers: [{ flowerId: "deleted-1", qty: 2 }] }, medium: { flowers: [{ flowerId: "deleted-1", qty: 8 }] }, big: { flowers: [] } };
    const out = pick(sizes);
    expect(out.medium.flowers).toEqual([{ flowerId: "rose", invItemId: undefined, gsSnap: undefined, qty: 8 }]);
  });
  it("empty-row detection: flowerId '' / undefined / null with invItemId undefined / '' all count as empty and get filled", () => {
    for (const blank of [{ flowerId: "", qty: 0 }, { qty: 0 }, { flowerId: null, invItemId: null, qty: 0 }, { flowerId: "", invItemId: "", qty: 0 }]) {
      const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "keep", qty: 1 }, blank] }, big: { flowers: [] } });
      expect(keys(out, "medium")).toEqual(["f:keep", "f:rose"]);
    }
  });
  it("an empty row is filled in place (position kept), with qty reset to 0 even if it had a stray qty", () => {
    const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [{ flowerId: "", qty: 9 }, { flowerId: "z", qty: 1 }] }, big: { flowers: [] } });
    expect(out.medium.flowers[0]).toMatchObject({ flowerId: "rose", qty: 0 });
    expect(out.medium.flowers).toHaveLength(2);
  });
  it("totalPieces / img / unitsPerFlowerist / extraCost and every other field of the other size survive", () => {
    const med = { flowers: [], totalPieces: 33, img: "u.jpg", unitsPerFlowerist: 4, extraCost: 120, note: "x" };
    const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }], img: "s.jpg", totalPieces: 9, extraCost: 5 }, medium: med, big: { flowers: [] } });
    expect(out.medium).toMatchObject({ totalPieces: 33, img: "u.jpg", unitsPerFlowerist: 4, extraCost: 120, note: "x" });
    expect(out.small).toMatchObject({ img: "s.jpg", totalPieces: 9, extraCost: 5 });
    expect(out.medium.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
  });
  it("the switched row keeps its other fields (qty, unitLabel, gsSnap is reset)", () => {
    const out = pick({ small: { flowers: [{ flowerId: "old", qty: 1 }] }, medium: { flowers: [{ flowerId: "old", qty: 5, unitLabel: "bunch", gsSnap: 12 }] }, big: { flowers: [] } });
    expect(out.medium.flowers[0]).toMatchObject({ flowerId: "rose", qty: 5, unitLabel: "bunch" });
    expect(out.medium.flowers[0].gsSnap).toBeUndefined();
  });
  it("mode missing / 'flat' with a one-size recipe mirrors nothing; undefined mode with all three keys present mirrors into all of them", () => {
    const flat = { medium: { flowers: [{ flowerId: "", qty: 0 }] } };
    const out = mirrorFlowerPick({ sizes: flat, mode: "flat", fromSize: "medium", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(out)).toEqual(["medium"]);
    const out2 = mirrorFlowerPick({ sizes: flat, mode: undefined, fromSize: "medium", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(out2)).toEqual(["medium"]);
  });
  it("RISK: a recipe whose mode says 'flat' but whose sizes still hold small/big (data the editor hides) is mirrored into them", () => {
    const sizes = { small: { flowers: [] }, medium: { flowers: [{ flowerId: "", qty: 0 }] }, big: { flowers: [] } };
    const out = mirrorFlowerPick({ sizes, mode: "flat", fromSize: "medium", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    // the brief says "flat recipes mirror nothing"; the code decides by the KEYS present, not by `mode`
    expect(keys(out, "small")).toEqual(["f:rose"]);
    expect(keys(out, "big")).toEqual(["f:rose"]);
    // the editor's FLAT button drops small/big when they have flowers, so only an empty-but-present key can exist; harmless in practice
    expect(admin).toContain("else np.sizes = { medium: p.sizes?.medium || { flowers: [], totalPieces: 0 } };");
  });
  it("smb with sizes lacking every key creates all three (picking size gets its row only if fromIndex exists)", () => {
    const out = mirrorFlowerPick({ sizes: {}, mode: "smb", fromSize: "small", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(out).sort()).toEqual(["big", "medium", "small"]);
    expect(out.medium.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
    expect(out.big.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
    // INCONSISTENCY (unreachable from the UI, a row has to be on screen to be picked): fromIndex past the end -> the picking size
    // gets NO row while the other sizes do
    expect(out.small.flowers).toEqual([]);
  });
  it("fromIndex beyond the rows: the picking size is unchanged, the other sizes still get the flower", () => {
    const sizes = { small: { flowers: [{ flowerId: "a", qty: 1 }] }, medium: { flowers: [] }, big: { flowers: [] } };
    const out = pick(sizes, { fromIndex: 5 });
    expect(out.small.flowers).toEqual([{ flowerId: "a", qty: 1 }]);
    expect(keys(out, "medium")).toEqual(["f:rose"]);
  });
  it("sizes not an object (null / string / undefined) does not throw; non-object size values fall back to an empty size", () => {
    for (const bad of [null, undefined, "x", 5]) expect(() => pick(bad)).not.toThrow();
    const out = pick({ small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: null, big: undefined });
    expect(keys(out, "medium")).toEqual(["f:rose"]);
    expect(keys(out, "big")).toEqual(["f:rose"]);
  });
  it("cand without an id: only the picking row's patch is applied, nothing is mirrored", () => {
    const sizes = empty();
    const out = pick(sizes, { cand: { source: "mandi" }, fromPatch: { flowerId: "" } });
    expect(out.medium).toBe(sizes.medium);
    expect(out.big).toBe(sizes.big);
  });
  it("fromSize 'big' / 'medium' work symmetrically", () => {
    for (const fromSize of ["small", "medium", "big"]) {
      const sizes = { small: { flowers: [] }, medium: { flowers: [] }, big: { flowers: [] }, [fromSize]: { flowers: [{ flowerId: "", qty: 0 }] } };
      const out = pick(sizes, { fromSize });
      for (const n of ["small", "medium", "big"]) expect(keys(out, n)).toEqual(["f:rose"]);
    }
  });
  it("mandi -> inventory change: the picking row is reset to qty 0 but the switched mirror row keeps its mandi-unit qty (now read as an inventory-unit qty) - RISK", () => {
    const sizes = { small: { flowers: [{ flowerId: "rose", qty: 0.5 }] }, medium: { flowers: [{ flowerId: "rose", qty: 0.25 }] }, big: { flowers: [] } };
    const out = pick(sizes, { cand: inv("art-rose"), fromPatch: { invItemId: "art-rose", flowerId: undefined, qty: 0, gsSnap: undefined } });
    expect(out.small.flowers[0].qty).toBe(0);
    expect(out.medium.flowers[0]).toMatchObject({ invItemId: "art-rose", qty: 0.25 }); // not reset like the picking row
  });
});

describe("C. AdminSettingsTab wiring of pickFlower", () => {
  const area = admin.slice(admin.indexOf("const renderSizeColumn = ("), admin.indexOf("const renderSizeColumn = (") + 20000);
  it("both FlowerPicker onChange handlers go through pickFlower with the same patch the old setRow call applied", () => {
    expect(area).toContain('onChange={(cand) => pickFlower(cand, cand.source === "inventory" ? { invItemId: cand.id, flowerId: undefined } : { flowerId: cand.id, invItemId: undefined })} />');
    expect(area).toContain('onChange={(cand) => pickFlower(cand, cand.source === "inventory" ? { invItemId: cand.id, flowerId: undefined, qty: 0, gsSnap: undefined } : { flowerId: cand.id, invItemId: undefined, gsSnap: undefined })} />');
    expect(area).not.toMatch(/FlowerPicker[^]*?onChange=\{\(cand\) => setRow\(/);
  });
  it("pickFlower hands the FRESHEST pattern's sizes and mode to mirrorFlowerPick (not the render-time copy)", () => {
    expect(area).toContain("mutatePattern(studioItem, (p) => ({ ...p, sizes: mirrorFlowerPick({ sizes: p.sizes, mode: p.mode, fromSize: sz, fromIndex: fi, fromPatch, cand }) }))");
  });
  it("one write for all sizes: the whole recipe row (sizes included) goes out in a single updateRow", () => {
    const mp = admin.slice(admin.indexOf("const mutatePattern = (studioItem, mutator) => {"), admin.indexOf("const renderSizeColumn = ("));
    expect((mp.match(/updateRow\("flower_patterns"/g) || []).length).toBe(1);
  });
  it("the picking size result equals the old setRow result when p.sizes[sz] is the render-time sizeData (all of totalPieces / img / unitsPerFlowerist / extraCost kept)", () => {
    const sizeData = { flowers: [{ flowerId: "a", qty: 3, unitLabel: "pcs" }, { flowerId: "", qty: 0 }], totalPieces: 40, img: "i.jpg", unitsPerFlowerist: 6, extraCost: 99 };
    const p = { id: "FP1", mode: "smb", sizes: { small: sizeData, medium: { flowers: [] }, big: { flowers: [] } } };
    const patch = mPatch("rose");
    const oldSizes = { ...p.sizes, small: { ...sizeData, flowers: sizeData.flowers.map((x, i) => (i === 1 ? { ...x, ...patch } : x)) } };
    const out = mirrorFlowerPick({ sizes: p.sizes, mode: p.mode, fromSize: "small", fromIndex: 1, fromPatch: patch, cand: mandi("rose") });
    expect(out.small).toEqual(oldSizes.small);
  });
  it("the fresh-recipe template (mutatePattern's emptyTemplate) gives valid sizes for smb and for flat", () => {
    const tpl = (m) => (m === "smb" ? ["small", "medium", "big"] : ["medium"]).reduce((a, k) => ({ ...a, [k]: { flowers: [], totalPieces: 0 } }), {});
    const smb = mirrorFlowerPick({ sizes: tpl("smb"), mode: "smb", fromSize: "small", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(smb).sort()).toEqual(["big", "medium", "small"]);
    expect(smb.medium.totalPieces).toBe(0);
    const flat = mirrorFlowerPick({ sizes: tpl("flat"), mode: "flat", fromSize: "medium", fromIndex: 0, fromPatch: mPatch("rose"), cand: mandi("rose") });
    expect(Object.keys(flat)).toEqual(["medium"]);
  });
  it("RISK: legacy 'large' key - a mirrored empty 'big' now exists and wins over it in resolveSizeKey, hiding the legacy big recipe", () => {
    const sizes = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] }, large: { flowers: [{ flowerId: "tulip", qty: 4 }] } };
    expect(resolveSizeKey(sizes, "big")).toBe("large");
    const out = pick(sizes);
    expect(resolveSizeKey(out, "big")).toBe("big"); // and its only row has qty 0
    expect(out.big.flowers).toEqual([{ flowerId: "rose", qty: 0 }]);
  });
});

describe("C. RISK - mirrored qty-0 rows turn a 'no recipe' size into a ₹0 size for the rate-card sync", () => {
  // IMS.jsx syncRecipeRatesToStudio.rateFor: c == null ? null : Math.round(c * markup); `if (md != null) draft.inhouseM = md`
  it("fixed: the sync's rateFor gives no rate (never ₹0) for a size whose rows have no quantity yet", () => {
    const ims = read("pages/ims/IMS.jsx");
    expect(ims).toContain("if (!sd || !(Array.isArray(sd.flowers) && sd.flowers.some((f) => (Number(f?.qty) || 0) > 0))) return null;");
    expect(ims).toContain("const c = computePatternSizeCost(sd, mandi, itemsRef.current);");
    expect(ims).toContain("return c == null ? null : Math.round(c * markup);");
    expect(ims).toContain("if (md != null) draft.inhouseM = md;");
    expect(ims).toContain("if (bg != null) draft.inhouseB = bg;");
  });
  it("an empty size has no cost (null -> the Studio rate is left alone); the same size after a mirrored pick costs 0 (-> inhouseM / inhouseB are overwritten with 0)", () => {
    const mandiCat = [{ id: "rose", currentPrice: 10, unit: "piece", colorVariants: [] }];
    const before = { small: { flowers: [{ flowerId: "", qty: 0 }] }, medium: { flowers: [] }, big: { flowers: [] } };
    expect(computePatternSizeCost(before.medium, mandiCat, [])).toBeNull();
    const after = pick(before);
    expect(computePatternSizeCost(after.medium, mandiCat, [])).toBe(0);
    expect(computePatternSizeCost(after.big, mandiCat, [])).toBe(0);
    const rateFor = (sd, markup) => { const c = sd ? computePatternSizeCost(sd, mandiCat, []) : null; return c == null ? null : Math.round(c * markup); };
    expect(rateFor(before.medium, 3)).toBeNull();
    expect(rateFor(after.medium, 3)).toBe(0);
  });
});

// ───────────────────────────── D. recipe-box conversions (real source) ─────────────────────────────
describe("D. recipe box conversions, taken from the real source", () => {
  const grab = (re, what) => { const m = admin.match(re); if (!m) throw new Error("source changed: " + what); return m[1]; };
  const fmtN = new Function(`return ${grab(/const fmtN = (\(n\) => [^;\n]+);/, "fmtN")};`)();
  const piecesBody = grab(/onCommit=\{\(raw\) => \{ (const p = parseFloat\(raw\) \|\| 0; const div = flower\?\.unit === "piece" \? 1 : \(liveGS > 0 \? liveGS : effGS\); setQty\(div > 0 \? p \/ div : 0\);) \}\}/, "pieces onCommit");
  const unitBody = grab(/onCommit=\{\(raw\) => \{ (const n = parseFloat\(raw\) \|\| 0; setQty\(n > 0 \? 1 \/ n : 0\);) \}\}/, "1 unit -> N onCommit");
  const qtyBody = grab(/onCommit=\{\(raw\) => setRow\(\{ qty: (parseFloat\(raw\) \|\| 0) \}\)\}/, "qty onCommit");
  const optBody = grab(/unitsPerFlowerist \?\? ""\}\n\s+onCommit=\{\(raw\) => \{ (const v = raw === "" \? undefined : \(parseFloat\(raw\) \|\| 0\);)/, "unitsPerFlowerist onCommit");
  const extraBody = grab(/value=\{sizeData\.extraCost \?\? ""\} onCommit=\{\(raw\) => \{ (const v = raw === "" \? undefined : \(parseFloat\(raw\) \|\| 0\);)/, "extraCost onCommit");
  const markupBody = grab(/studioMarkup \?\? ""\}\n\s+onCommit=\{\(raw\) => \{ (const v = raw === "" \? undefined : \(parseFloat\(raw\) \|\| 0\);)/, "markup onCommit");
  const setQtyLine = grab(/(const setQty = \(newStored\) => setRow\(\{ qty: newStored, gsSnap: [^;]+\}\);)/, "setQty");
  const effGSLine = grab(/(const effGS = flower\?\.unit === "piece" \? 1 : \(fl\.gsSnap != null \? \(Number\(fl\.gsSnap\) \|\| 0\) : liveGS\);)/, "effGS");

  const stored = (body, raw, effGS = 12) => { let out; new Function("raw", "effGS", "setQty", `${body}`)(raw, effGS, (q) => { out = q; }); return out; };
  // the pieces box now divides by the pcs/unit the row is stamped with (live, else the snapshot): here live = snapshot
  const piecesToQty = (raw, effGS) => { let out; new Function("raw", "effGS", "setQty", "flower", "liveGS", piecesBody)(raw, effGS, (q) => { out = q; }, { unit: "bundle" }, effGS); return out; };
  const nToQty = (raw) => stored(unitBody, raw);
  const qtyOf = (raw) => new Function("raw", `return ${qtyBody};`)(raw);
  const opt = (body, raw) => new Function("raw", `${body} return v;`)(raw);

  const raws = ["", "0", "1.", "1.5", "abc", "-3", ".5", "1e2", " 7", "7 "];
  it("qty box: raw -> number (blank / 0 / junk -> 0, '1.' -> 1, '1.5' -> 1.5)", () => {
    expect(raws.map(qtyOf)).toEqual([0, 0, 1, 1.5, 0, -3, 0.5, 100, 7, 7]);
  });
  it("pieces box: raw -> stored qty = pieces / effGS", () => {
    expect(raws.map((r) => piecesToQty(r, 12))).toEqual([0, 0, 1 / 12, 1.5 / 12, 0, -3 / 12, 0.5 / 12, 100 / 12, 7 / 12, 7 / 12]);
    expect(piecesToQty("5", 0)).toBe(0); // variable flower (effGS 0) never divides by zero
  });
  it("'1 unit -> N' box: raw -> stored qty = 1 / N (blank / 0 / junk / negative -> 0)", () => {
    expect(raws.map(nToQty)).toEqual([0, 0, 1, 1 / 1.5, 0, 0, 1 / 0.5, 1 / 100, 1 / 7, 1 / 7]);
  });
  it("units per flowerist / extra cost / markup: blank means UNSET (undefined), '0' and junk mean 0", () => {
    for (const body of [optBody, extraBody, markupBody]) {
      expect(raws.map((r) => opt(body, r))).toEqual([undefined, 0, 1, 1.5, 0, -3, 0.5, 100, 7, 7]);
    }
  });
  it("RISK (pre-existing, unchanged by the commits): the boxes accept NEGATIVE numbers (min=0 only greys the spinner) and store them", () => {
    expect(qtyOf("-3")).toBe(-3);
    expect(opt(extraBody, "-3")).toBe(-3);
    expect(opt(optBody, "-3")).toBe(-3);
    expect(piecesToQty("-3", 12)).toBeLessThan(0);
    // ... and a negative stored qty is then SHOWN as an empty pieces box (fmtN hides n <= 0) while it still subtracts from the cost
    expect(fmtN(piecesToQty("-3", 12) * 12)).toBe("");
  });
  it("fmtN: 0 / negative -> '', integer -> plain, fraction -> one decimal", () => {
    expect([fmtN(0), fmtN(-2), fmtN(35), fmtN(2.5), fmtN(7.25)]).toEqual(["", "", "35", "2.5", "7.3"]);
  });

  // what the pieces box shows once its own save has come back: qty was stored as p / gs, the box shows fmtN(qty * gs)
  const shownAfterSave = (typed, gs) => fmtN((piecesToQty(String(typed), gs) || 0) * gs);
  it("whole numbers of pieces come back as typed for the common gatthar sizes (1, 2, 5, 10, 12, 20, 24)", () => {
    for (const gs of [1, 2, 5, 10, 12, 20, 24]) for (let p = 1; p <= 500; p++) expect(shownAfterSave(p, gs), `gs ${gs} p ${p}`).toBe(String(p));
  });
  it("RISK (pre-existing): a typed whole number can come back as 'x.0' because qty * gs picks up float noise (7 pieces with 25 / 50 / 100 per unit, 29 with 7, ...)", () => {
    expect(shownAfterSave(7, 25)).toBe("7.0");
    expect(shownAfterSave(7, 50)).toBe("7.0");
    expect(shownAfterSave(7, 100)).toBe("7.0");
    expect(shownAfterSave(29, 7)).toBe("29.0");
    expect(shownAfterSave(31, 15)).toBe("31.0");
    // the stored value itself is right to within 1e-12 - only the readout is noisy
    expect(Math.abs((7 / 25) * 25 - 7)).toBeLessThan(1e-12);
  });
  it("RISK (pre-existing): a typed fraction of a piece is rounded to one decimal in the box (7.25 -> '7.3'), the stored qty keeps it", () => {
    expect(shownAfterSave(7.25, 12)).toBe("7.3");
  });
  it("'1 unit -> N' also comes back as 'N.0' for some N (49, 93, 98, 99, 103, ...)", () => {
    const back = (n) => fmtN(1 / nToQty(String(n)));
    expect(back(4)).toBe("4");
    for (const n of [49, 93, 98, 99, 103]) expect(back(n)).toBe(n + ".0");
    const bad = []; for (let n = 1; n <= 300; n++) if (back(n) !== String(n)) bad.push(n);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.length).toBeLessThan(40);
  });

  // The pieces box divides by effGS (the row's frozen snapshot) but setQty then stamps the LIVE pcs/unit as the new snapshot.
  // When the catalogue's pcs/unit was corrected after the row was last typed, what was typed comes back as a different number.
  it("fixed (was pre-existing): with gsSnap 12 and the live catalogue now saying 20, typing 24 pieces is saved as qty 2 with gsSnap 20 and the box then shows 40", () => {
    const flower = { unit: "bundle", gattharSize: 20 };
    const liveGS = 20;
    const snap = 12;
    const fl = { qty: 1, gsSnap: snap };
    const effGS = new Function("flower", "fl", "liveGS", `${effGSLine} return effGS;`)(flower, fl, liveGS);
    expect(effGS).toBe(12);
    let patch;
    const setQty = new Function("setRow", "flower", "liveGS", `${setQtyLine} return setQty;`)((p) => { patch = p; }, flower, liveGS);
    new Function("raw", "effGS", "setQty", "flower", "liveGS", piecesBody)("24", effGS, setQty, flower, liveGS);
    expect(patch).toEqual({ qty: 1.2, gsSnap: 20 }); // 24 pieces / 20 per bundle
    const effAfter = new Function("flower", "fl", "liveGS", `${effGSLine} return effGS;`)(flower, { ...fl, ...patch }, liveGS);
    expect(fmtN((patch.qty || 0) * effAfter)).toBe("24"); // currently "40"
  });
});

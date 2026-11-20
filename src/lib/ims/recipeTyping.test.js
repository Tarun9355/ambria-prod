import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assembleFlowerPatternsFromRows } from "./flowerHelpers";

// Owner report 2026-11-20 (Flowers -> Recipes): typing in a recipe box was lost or came back late. Every keystroke wrote the whole recipe
// row to the database and the box showed the database's answer - so a character typed before the answer arrived was overwritten, and a
// "1." or a "0" (parseFloat -> 1 / 0 -> the box re-rendered without the dot / empty) could not be typed at all. The boxes now keep
// their own draft while being typed in and save once typing pauses (DraftInput), and the recipes keep a fixed order.
describe("flower recipes keep a fixed order", () => {
  const row = (id, name) => ({ id, name, flat_or_smb: "smb", sub: "Pot", unit: "pc", sizes: {} });
  const ids = (rows) => assembleFlowerPatternsFromRows(rows).map((p) => p.id);
  it("by id, whatever order the database returned them in; an edited recipe (returned last) stays put", () => {
    expect(ids([row("FP3", "c"), row("FP1", "a"), row("FP2", "b")])).toEqual(["FP1", "FP2", "FP3"]);
    expect(ids([row("FP2", "b"), row("FP3", "c"), row("FP1", "a2")])).toEqual(["FP1", "FP2", "FP3"]);
  });
  it("timestamp ids order by time, a rename does not move a recipe, input is not mutated, bad input is []", () => {
    expect(ids([row("FP1763600000000123", "x"), row("FP1763500000000999", "y")])).toEqual(["FP1763500000000999", "FP1763600000000123"]);
    expect(ids([row("FP1", "zzz"), row("FP2", "aaa")])).toEqual(["FP1", "FP2"]);
    const input = [row("FP2", "b"), row("FP1", "a")];
    assembleFlowerPatternsFromRows(input);
    expect(input.map((r) => r.id)).toEqual(["FP2", "FP1"]);
    expect(assembleFlowerPatternsFromRows(null)).toEqual([]);
  });
});

describe("the recipe editor's number boxes are draft inputs", () => {
  const src = readFileSync(resolve(__dirname, "../../pages/ims/AdminSettingsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
  const area = src.slice(src.indexOf("const mutatePattern = (studioItem, mutator) => {"), src.indexOf("const mutatePattern = (studioItem, mutator) => {") + 40000);
  it("qty, pieces, '1 unit -> N', units per flowerist, extra cost and markup commit through DraftInput onCommit", () => {
    for (const marker of [
      'value={fl.qty || ""} placeholder="qty"', 'value={fmtN(pieces)} placeholder="pcs"', 'value={fmtN(patternsPerUnit)} placeholder="N"',
      'value={sizeData.unitsPerFlowerist ?? ""}', 'value={sizeData.extraCost ?? ""}', 'value={pat?.studioMarkup ?? ""}',
    ]) {
      const i = area.indexOf(marker);
      expect(i, marker).toBeGreaterThan(0);
      const tag = area.slice(area.lastIndexOf("<", i), i + 260);
      expect(tag.startsWith("<DraftInput"), marker).toBe(true);
      expect(tag).toContain("onCommit=");
      expect(tag).not.toContain("onChange=");
    }
  });
  it("the conversions are unchanged: raw text -> number (blank means unset for the optional ones)", () => {
    expect(area).toContain("onCommit={(raw) => setRow({ qty: parseFloat(raw) || 0 })}");
    expect(area).toContain("const p = parseFloat(raw) || 0; const div = flower?.unit === \"piece\" ? 1 : (liveGS > 0 ? liveGS : effGS); setQty(div > 0 ? p / div : 0);");
    expect(area).toContain("const n = parseFloat(raw) || 0; setQty(n > 0 ? 1 / n : 0);");
    expect(area).toContain('const v = raw === "" ? undefined : (parseFloat(raw) || 0); mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, unitsPerFlowerist: v } } }));');
    expect(area).toContain('extraCost: v } } }));');
    expect(area).toContain("if (v === undefined) delete np.studioMarkup; else np.studioMarkup = v;");
  });
});

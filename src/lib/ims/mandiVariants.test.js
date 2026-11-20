import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { saveVariantsFresh, variantDisplayPhoto } from "./mandiVariants";

// Owner report 2026-11-20: mandi flower photos put in disappear a while later. The audit log showed only color_variants rewrites -
// every variant edit wrote the whole list back from the screen's copy, so a copy that had not received a new photo wrote it away.
const v = (id, extra = {}) => ({ variantId: id, name: id, photoUrl: null, currentPrice: 10, ...extra });

describe("saveVariantsFresh", () => {
  it("a price edit made from a stale screen copy keeps the photo someone else just added (the list is read fresh first)", async () => {
    const stored = [v("a", { photoUrl: "https://x/a.jpg" }), v("b")];   // in the database now
    const screen = [v("a"), v("b")];                                     // this screen has not received the photo yet
    const write = vi.fn(async () => ({}));
    await saveVariantsFresh({ flowerId: "F1", fallback: screen, readFresh: async () => stored, write,
      change: (list) => list.map((cv) => (cv.variantId === "b" ? { ...cv, currentPrice: 25 } : cv)) });
    const [, patch] = write.mock.calls[0];
    expect(patch.color_variants[0].photoUrl).toBe("https://x/a.jpg");
    expect(patch.color_variants[1].currentPrice).toBe(25);
  });
  it("the flower's own price is recalculated from the fresh list when asked", async () => {
    const write = vi.fn(async () => ({}));
    await saveVariantsFresh({ flowerId: "F1", fallback: [], readFresh: async () => [v("a", { currentPrice: 30 }), v("b", { currentPrice: 12 })], write,
      change: (l) => l, parentPrice: (l) => Math.min(...l.map((x) => x.currentPrice)) });
    expect(write.mock.calls[0][1]).toEqual({ color_variants: expect.any(Array), current_price: 12 });
  });
  it("no current_price in the patch for an edit that cannot change it (name, palette, photo)", async () => {
    const write = vi.fn(async () => ({}));
    await saveVariantsFresh({ flowerId: "F1", fallback: [], readFresh: async () => [v("a")], write, change: (l) => l });
    expect(Object.keys(write.mock.calls[0][1])).toEqual(["color_variants"]);
  });
  it("if the fresh read fails the screen's copy is used (the edit is not lost)", async () => {
    const write = vi.fn(async () => ({}));
    await saveVariantsFresh({ flowerId: "F1", fallback: [v("a")], readFresh: async () => { throw new Error("timeout"); }, write,
      change: (l) => [...l, v("new")] });
    expect(write.mock.calls[0][1].color_variants.map((x) => x.variantId)).toEqual(["a", "new"]);
  });
  it("a missing / bad stored list is treated as the screen's copy, then empty", async () => {
    const write = vi.fn(async () => ({}));
    await saveVariantsFresh({ flowerId: "F1", fallback: undefined, readFresh: async () => null, write, change: (l) => l });
    expect(write.mock.calls[0][1].color_variants).toEqual([]);
  });
  it("writes to the flower it was asked about, and passes the write's result / error back", async () => {
    const write = vi.fn(async () => { throw new Error("rls"); });
    await expect(saveVariantsFresh({ flowerId: "F9", fallback: [], readFresh: async () => [], write, change: (l) => l })).rejects.toThrow("rls");
    expect(write.mock.calls[0][0]).toBe("F9");
  });
});

describe("variantDisplayPhoto", () => {
  it("cheapest variant's photo, else any variant's, else the flower's own, else none", () => {
    expect(variantDisplayPhoto(v("a", { photoUrl: "c" }), [v("b", { photoUrl: "b" })], "p")).toBe("c");
    expect(variantDisplayPhoto(v("a"), [v("a"), v("b", { photoUrl: "b" })], "p")).toBe("b");
    expect(variantDisplayPhoto(v("a"), [v("a")], "p")).toBe("p");
    expect(variantDisplayPhoto(null, null, null)).toBe(null);
  });
});

describe("AdminSettingsTab wiring", () => {
  const src = readFileSync(resolve(__dirname, "../../pages/ims/AdminSettingsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
  it("no variant write builds its list from the screen copy any more; every one goes through saveVariants", () => {
    expect(src).not.toMatch(/color_variants: \(p\.colorVariants/);
    expect(src).not.toMatch(/color_variants: newVariants/);
    expect(src).not.toMatch(/color_variants: \[\.\.\.\(p\.colorVariants/);
    expect(src.split("saveVariants((list) =>").length - 1).toBe(6);
    expect(src).toContain('readFresh: async (id) => { const { data, error } = await supabase.from("mandi_flowers").select("color_variants").eq("id", id).single(); if (error) throw error; return data?.color_variants; },');
  });
  it("price edits and deletes recalculate the flower's price; the rest do not", () => {
    expect(src.split("cv), true);").length - 1).toBe(1);
    expect(src).toContain("saveVariants((list) => { const rest = list.filter((cv) => cv.variantId !== v.variantId); return rest.length ? rest : list; }, true);");
  });
  it("the photo column falls back to any variant's photo", () => {
    expect(src).toContain("const displayUrl = hasVariants ? variantDisplayPhoto(cheapestVariant, variants, p.photoUrl) : (p.photoUrl || null);");
  });
});

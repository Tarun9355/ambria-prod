import { describe, it, expect } from "vitest";
import { searchScore, smartFilter } from "./itemSearch.js";

const inv = [
  { name: "Tassel Chandelier - Pink", cat: "Lighting", subCat: "Chandeliers" },
  { name: "RM LED", cat: "Lighting", subCat: "LED" },
  { name: "Crystal Chandelier Gold", cat: "Lighting", subCat: "Chandeliers" },
  { name: "Pink Rose Wall", cat: "Backdrops", subCat: "Floral Walls" },
];
const f = (it) => [it.name, it.cat, it.subCat];
const names = (q) => smartFilter(inv, q, f).map((x) => x.name);

describe("smart item search", () => {
  it("finds words in any order", () => {
    expect(names("pink tassel chandelier")[0]).toBe("Tassel Chandelier - Pink");
  });
  it("tolerates typos and plurals", () => {
    expect(names("pink tassle chandlier")[0]).toBe("Tassel Chandelier - Pink");
    expect(names("tassel chandeliers")[0]).toBe("Tassel Chandelier - Pink");
  });
  it("every word must match — extra words narrow the list", () => {
    expect(names("pink")).toEqual(expect.arrayContaining(["Tassel Chandelier - Pink", "Pink Rose Wall"]));
    expect(names("pink chandelier")).toEqual(["Tassel Chandelier - Pink"]);
  });
  it("still matches category / sub-category and partial words", () => {
    expect(names("chand")).toEqual(expect.arrayContaining(["Tassel Chandelier - Pink", "Crystal Chandelier Gold"]));
    expect(names("led")).toContain("RM LED");
  });
  it("ignores punctuation and run-together words", () => {
    expect(names("pink-tassel")).toContain("Tassel Chandelier - Pink");
    expect(names("roseWall")).toContain("Pink Rose Wall");
  });
  it("name hits rank above category-only hits", () => {
    expect(names("lighting")).toEqual(["Tassel Chandelier - Pink", "RM LED", "Crystal Chandelier Gold"]); // all category-only, kept
    expect(searchScore("rm", "RM LED")).toBeGreaterThan(searchScore("rm", "Something", "RM category"));
  });
  it("short words don't fuzzy-match nonsense", () => {
    expect(names("xyz")).toEqual([]);
    expect(names("rmx")).toEqual([]);
  });
});

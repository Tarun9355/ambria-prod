// Tests for the extracted matcher core (spec §9-A / §12.1). Covers the three scoring tiers,
// the synonym dictionary, keyword/stopword handling, and the STRUCT_KW / STRUCTURAL_CATS guards.
import { describe, it, expect } from "vitest";
import {
  createMatcher, normalize, buildSynonymOf,
  STRUCT_KW, STRUCTURAL_CATS, MATCH,
} from "./matcher.js";

// keyOf for a pool of plain { name } catalog rows.
const byName = (c) => c.name;
const pool = (...names) => names.map((name) => ({ name }));

describe("normalize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalize("  Iron 3D  Arch!! ")).toBe("iron 3d arch");
    expect(normalize("Crystal—Chandelier (Big)")).toBe("crystalchandelier big");
  });
  it("is null/undefined safe", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("buildSynonymOf", () => {
  it("maps every word in a group to the group's first word", () => {
    const s = buildSynonymOf([{ words: ["Jali", "Lattice", "Mesh"] }]);
    expect(s["lattice"]).toBe("jali");
    expect(s["mesh"]).toBe("jali");
    expect(s["jali"]).toBe("jali");
  });
  it("ignores groups with fewer than 2 words and non-arrays", () => {
    expect(buildSynonymOf([{ words: ["solo"] }])).toEqual({});
    expect(buildSynonymOf(null)).toEqual({});
    expect(buildSynonymOf([{}])).toEqual({});
  });
});

describe("createMatcher.bestOf — tier 1: exact", () => {
  const { bestOf } = createMatcher([]);
  it("normalized string equality scores 100", () => {
    const r = bestOf("Iron Jali", pool("iron  jali!", "Chandelier"), byName);
    expect(r).toMatchObject({ method: "exact", score: MATCH.EXACT_SCORE });
    expect(r.item.name).toBe("iron  jali!");
  });
});

describe("createMatcher.bestOf — tier 2: substring", () => {
  const { bestOf } = createMatcher([]);
  it("catalog name contained in a wordy AI name scores 90", () => {
    const r = bestOf("Tall Golden Crystal Chandelier with drops", pool("Crystal Chandelier"), byName);
    expect(r).toMatchObject({ method: "substring", score: MATCH.SUBSTRING_SCORE });
  });
  it("works in the other direction too (AI name contained in catalog name)", () => {
    const r = bestOf("Chandelier", pool("Big Crystal Chandelier Deluxe"), byName);
    expect(r.method).toBe("substring");
  });
});

describe("createMatcher.bestOf — tier 3: keyword overlap", () => {
  const { bestOf } = createMatcher([]);
  it("returns null when overlap is below OVERLAP_MIN", () => {
    // 'Wooden Console Table' vs 'Fairy String Lights' share no identifying keyword.
    expect(bestOf("Wooden Console Table", pool("Fairy String Lights"), byName)).toBeNull();
  });
  it("scores by overlap / smaller-keyword-count (verbose AI name not penalized)", () => {
    // AI (verbose, 5 kw): 'Mandap made from Wooden material' → [mandap,made,from,wooden,material]
    // catalog (concise, 2 kw): 'Wooden Mandap'. Neither is a contiguous substring of the other,
    // so this hits the overlap tier. Both catalog kw match → 2 / min(5,2)=2 → 100 (verbosity
    // doesn't drag the score down, because the denominator is the SMALLER keyword count).
    const r = bestOf("Mandap made from Wooden material", pool("Wooden Mandap"), byName);
    expect(r.method).toBe("overlap");
    expect(r.score).toBe(100);
  });
  it("picks the highest-scoring candidate (overlap tier, no substring/stopword interference)", () => {
    // 'Mandap with Carved Frame' → [mandap,carved,frame]. 'Carved Mandap' overlaps 2/2=100;
    // 'Wooden Frame' overlaps only 'frame' → 1/2=50. Highest wins even when listed second.
    const r = bestOf("Mandap with Carved Frame", pool("Wooden Frame", "Carved Mandap", "Fairy Lights"), byName);
    expect(r.item.name).toBe("Carved Mandap");
    expect(r.method).toBe("overlap");
  });
});

describe("createMatcher — synonyms change what matches", () => {
  it("teaches an equivalence so overlap fires where it otherwise wouldn't", () => {
    const dict = [{ words: ["jali", "lattice"] }];
    const withSyn = createMatcher(dict).bestOf("Decorative Lattice Panel Screen", pool("Iron Jali"), byName);
    // 'lattice' canonicalizes to 'jali', so it overlaps 'Iron Jali'.
    expect(withSyn?.method).toBe("overlap");
    // Without the synonym, 'lattice' != 'jali' → no shared identifying keyword.
    const noSyn = createMatcher([]).bestOf("Decorative Lattice Panel Screen", pool("Iron Jali"), byName);
    expect(noSyn).toBeNull();
  });
});

describe("stopwords", () => {
  it("colour/size/filler words don't create false matches", () => {
    const { bestOf } = createMatcher([]);
    // Only shared words are stopwords (gold, wedding, premium, large) → no real overlap.
    const r = bestOf("Gold Premium Wedding Uplights", pool("Large Gold Wedding Sofa"), byName);
    expect(r).toBeNull();
  });
});

describe("STRUCT_KW / STRUCTURAL_CATS guards", () => {
  it("matches raw scaffold/masking names", () => {
    ["Box Truss", "U Truss", "Wall Mask", "Platform", "Red Carpet", "Genset", "Acrylic Panel"]
      .forEach((n) => expect(STRUCT_KW.test(n)).toBe(true));
  });
  it("does NOT match decorative structure items that should be tagged", () => {
    ["Iron Jali", "Wooden 3D Arch", "Flower Wall"].forEach((n) => expect(STRUCT_KW.test(n)).toBe(false));
  });
  it("STRUCTURAL_CATS holds the mixed categories", () => {
    expect(STRUCTURAL_CATS.has("structure")).toBe(true);
    expect(STRUCTURAL_CATS.has("tenting")).toBe(true);
    expect(STRUCTURAL_CATS.has("lighting")).toBe(false);
  });
});

describe("MATCH thresholds are the documented tuning knobs", () => {
  it("holds the 40/65/90/100 values", () => {
    expect(MATCH.EXACT_SCORE).toBe(100);
    expect(MATCH.SUBSTRING_SCORE).toBe(90);
    expect(MATCH.OVERLAP_MIN).toBe(40);
    expect(MATCH.LOW_CONFIDENCE_BELOW).toBe(65);
  });
});

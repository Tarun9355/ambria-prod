// AI-tagging matcher core — the single source of truth for element-name → inventory matching.
//
// Used by the in-app Studio tagger (src/pages/studio/StudioApp.jsx → aiTagImage). This logic once
// existed as two hand-synced copies (client JS + a nightly batch-tagger Edge Function) that had
// drifted apart — see AI_TAGGING_SPEC.md §9-A. The nightly batch tagger has since been removed, so
// the client is the only consumer; this module keeps the scoring/thresholds in one testable place
// (spec §12.1) rather than inline in a 6k-line component.
//
// Pure, dependency-free (no React, no DOM) so it can be unit-tested in isolation.

// Raw scaffold/masking stock captured via the "dims" fields, never tagged as its own element.
// Matched by NAME (not category) so genuine decorative structure items (Arch/Panel/Jali) filed
// under the same category still get tagged. Keep in sync with the STRUCTURES prompt rule.
export const STRUCT_KW =
  /\b(box truss|single u truss|u truss|truss|carpet|wall mask|fabric mask|masking|flex print|vinyl print|acrylic panel|genset|platform|riser|flooring)\b/i;

// Top-level categories that hold BOTH raw scaffold and real structural decor items.
export const STRUCTURAL_CATS = new Set(["structure", "tenting"]);

// Match-tier scores + review thresholds. Named so the 40/65/90/100 tuning knobs live in one place.
export const MATCH = {
  EXACT_SCORE: 100,
  SUBSTRING_SCORE: 90,
  OVERLAP_MIN: 40, // below this, no match at all
  LOW_CONFIDENCE_BELOW: 65, // overlap matches below this get flagged ❓ VERIFY for a human
};

// Generic words that inflate keyword-overlap scores between UNRELATED items (colors/sizes/filler
// adjectives shared across many catalog names) — excluded so overlap only counts words that
// actually identify what the thing IS.
export const STOP_WORDS = new Set([
  "the", "a", "an", "of", "for", "with", "and", "in", "on", "to", "custom", "special", "premium",
  "standard", "basic", "indian", "wedding", "event", "decor", "decorative", "piece", "item", "set",
  "style", "design", "type", "look", "variant", "large", "small", "big", "mini", "tall", "short",
  "medium", "huge", "giant", "tiny", "gold", "golden", "white", "silver", "black", "red", "pink",
  "green", "blue", "ivory", "cream", "rose", "peach", "purple", "yellow", "orange", "maroon", "copper",
]);

// Lowercase, strip punctuation, collapse whitespace.
export function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// AI Synonym Dictionary (IMS Admin → Settings → 🔤 AI Synonyms) — ops-editable groups of words that
// mean the same physical thing (e.g. "Jali"/"Lattice"/"Mesh"/"Screen"). Maps every word in a group
// to that group's first word, so synonym-equivalent words normalize to the same token before
// keyword-overlap scoring — letting ops teach the matcher new equivalences without a code change.
export function buildSynonymOf(synonymDictionary) {
  const synonymOf = {};
  (Array.isArray(synonymDictionary) ? synonymDictionary : []).forEach((g) => {
    const words = Array.isArray(g?.words) ? g.words : [];
    if (words.length < 2) return;
    const canon = normalize(words[0]);
    words.forEach((w) => { synonymOf[normalize(w)] = canon; });
  });
  return synonymOf;
}

/**
 * Build the matcher bound to a given synonym dictionary. Returns:
 *   - keywords(s): tokenize a name into scoring keywords (stopword-stripped, synonym-canonicalized)
 *   - bestOf(name, pool, keyOf): best candidate in `pool` for `name`, or null
 *
 * bestOf tiers, in order:
 *   1. exact     (normalized string equality)            → score 100
 *   2. substring (either direction contains the other)   → score 90, short-circuits
 *   3. overlap   ≥ OVERLAP_MIN% of the SMALLER keyword count → score = that percentage
 *
 * The SMALLER keyword count is the denominator on purpose: a short precise catalog name
 * ("iron Jali", 2 kw) fully contained in a wordy AI description shouldn't be penalized for the
 * AI's verbosity. Returns { item, method, score } so callers can flag weak overlap-only matches.
 */
export function createMatcher(synonymDictionary) {
  const synonymOf = buildSynonymOf(synonymDictionary);
  const canonWord = (w) => synonymOf[w] || w;
  const keywords = (s) =>
    normalize(s).split(" ").filter((w) => !STOP_WORDS.has(w) && w.length > 1).map(canonWord);

  const bestOf = (name, pool, keyOf) => {
    const nameNorm = normalize(name);
    const exact = pool.find((c) => normalize(keyOf(c)) === nameNorm);
    if (exact) return { item: exact, method: "exact", score: MATCH.EXACT_SCORE };

    const nameKw = keywords(name);
    let bestScore = 0, best = null;
    for (const c of pool) {
      const cNorm = normalize(keyOf(c));
      if (nameNorm.includes(cNorm) || cNorm.includes(nameNorm)) {
        return { item: c, method: "substring", score: MATCH.SUBSTRING_SCORE }; // near-certain, stop here
      }
      const cKw = keywords(keyOf(c));
      const overlap = nameKw.filter((w) => cKw.some((cw) => cw.includes(w) || w.includes(cw))).length;
      const score = overlap > 0 ? (overlap / Math.min(nameKw.length, cKw.length)) * 100 : 0;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= MATCH.OVERLAP_MIN ? { item: best, method: "overlap", score: bestScore } : null;
  };

  return { synonymOf, keywords, bestOf };
}

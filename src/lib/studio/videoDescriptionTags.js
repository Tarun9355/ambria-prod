// Deterministic taxonomy-tag extraction for YouTube videos — replaces the old LLM-based
// video tagger. Ambria writes video descriptions with explicit labeled lines (e.g.
// "Venue: Ambria Restro", "Package Category: Silver"), so pulling tags out of them is a plain
// parsing problem, not an inference one: read the labeled value, match it to the closest
// taxonomy entry. No AI call, no cost, no latency, fully deterministic.
//
// If a description doesn't carry a given label (older uploads, manual imports, human typos),
// that field is simply left unmatched — someone tags it manually. There is no AI fallback.

// Pulls the text after "Label:" on whatever line contains it (tolerant of a leading emoji/icon
// before the label, since that's how the team's description template renders each line).
export function extractLabeledValue(desc, label) {
  const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
  for (const line of (desc || "").split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

// Matches a raw labeled value (e.g. "White And sage green") to the closest entry in a
// taxonomy list (e.g. ["White & Green", "Red & Gold", ...]). Tries exact match, then
// substring containment, then word-overlap scoring. Returns "" if nothing matches well enough
// — callers should leave the field untouched rather than write a garbage value.
export function bestTaxMatch(raw, list) {
  const value = (raw || "").trim();
  if (!value || !list?.length) return "";
  const lower = value.toLowerCase();
  const exact = list.find(v => v.trim().toLowerCase() === lower);
  if (exact) return exact;
  const contains = list.find(v => {
    const vl = v.toLowerCase();
    return lower.includes(vl) || vl.includes(lower);
  });
  if (contains) return contains;
  const words = s => s.toLowerCase().replace(/[&/]/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1);
  const rawWords = words(value);
  if (!rawWords.length) return "";
  let best = "", bestScore = 0;
  for (const v of list) {
    const score = words(v).filter(w => rawWords.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

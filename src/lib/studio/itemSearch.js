// Smart search for Build's "add element" boxes. The old match was one plain substring test of the
// whole typed phrase, so "pink tassel chandelier" missed "Tassel Chandelier - Pink" (word order),
// "Pink Tassle Chandlier" (spelling) and "Pink Tassel Chandeliers" (plural) alike.
//
// Rules:
//  - every typed word has to be found somewhere in the item's name, category or sub-category, in
//    any order — so adding a word only ever narrows the list;
//  - a word matches the start of a word, any part of a word (3+ letters), or a word one typo away
//    (two typos for 7+ letters) — "chandlier", "tassle", "chandeliers" all still find the item;
//  - spaces and punctuation don't matter ("pink-tassel", "pinktassel" both work).
// searchScore returns null for no match, else a number — higher sorts first. Name hits beat
// category hits, whole/prefix hits beat partial ones, and those beat typo matches.

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// True when a and b are at most `max` typos apart — insert, delete, replace, or swap two
// neighbouring letters ("tassle" ↔ "tassel"). Words here are short, so a full table is fine.
const within = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= max;
};

const typosAllowed = (t) => (t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0);

// How well one typed word matches one field's words: 4 whole word, 3 word start, 2 inside a word,
// 1 typo, 0 none.
const tokenScore = (t, words, squashed) => {
  let best = 0;
  for (const w of words) {
    if (w === t) return 4;
    if (w.startsWith(t)) best = Math.max(best, 3);
    else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 2);
    else if (best < 1) {
      const k = typosAllowed(t);
      // also against the word's own start, so a typo'd prefix ("chandl") still finds "chandelier"
      if (k && (within(t, w, k) || (w.length > t.length && within(t, w.slice(0, t.length), k)))) best = 1;
    }
  }
  if (!best && t.length >= 3 && squashed.includes(t)) best = 2; // "pinktassel" typed as one word
  return best;
};

export function searchScore(query, name, ...extra) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const n = norm(name);
  const fields = [n, ...extra.map(norm)].map((f) => ({ words: f.split(" ").filter(Boolean), squashed: f.replace(/ /g, "") }));
  // The whole query typed run-together ("pinktassel") against the name with its spaces taken out.
  const qSquashed = tokens.join("");
  let score = 0;
  for (const t of tokens) {
    let best = 0;
    fields.forEach((f, i) => {
      const s = tokenScore(t, f.words, f.squashed);
      // name hits weigh more than category / sub-category hits
      if (s) best = Math.max(best, i === 0 ? s * 3 : s);
    });
    if (!best) {
      if (tokens.length === 1 || !fields[0].squashed.includes(qSquashed)) return null;
      best = 6;
    }
    score += best;
  }
  if (n.startsWith(tokens.join(" "))) score += 20;
  else if (n.includes(tokens.join(" "))) score += 10;
  return score;
}

// Filter + rank a list. `fieldsOf(item)` returns [name, ...otherFields].
export function smartFilter(list, query, fieldsOf) {
  const out = [];
  for (const it of list || []) {
    const s = searchScore(query, ...fieldsOf(it));
    if (s != null) out.push({ it, s });
  }
  return out.sort((a, b) => b.s - a.s).map((x) => x.it);
}

// Smart search for Dismantle → "Add a site" (owner ask 2026-11-25): type a guest's name or a venue (or a date) and the list keeps
// only what matches, best match first. Forgiving by design - case, spaces, punctuation ("Ajay Pandey / Pragya"), word order,
// a missing letter or one wrong letter ("aditiya", "valencai") all still find it. Pure, so it is tested on its own.

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// lower case, accents off, anything that is not a letter or digit becomes a space, spaces collapsed
export const normSearch = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();

// at most one edit (a letter added, dropped, changed, or two side by side swapped) between a and b
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true; j++;
  }
  return true;
}

// how well one typed word fits one field's words (0 = not at all). Whole word > word start > inside a word > one typo.
function tokenScore(tok, words, joined) {
  let best = 0;
  // a short number ("20", "3") is a day or a month: only a whole word, so "20" is not the start of "2026"
  if (/^\d{1,3}$/.test(tok)) return words.includes(tok) ? 100 : 0;
  for (const w of words) {
    if (w === tok) best = Math.max(best, 100);
    else if (w.startsWith(tok)) best = Math.max(best, 80);
    else if (tok.length >= 3 && w.includes(tok)) best = Math.max(best, 55);
    else if (tok.length >= 4 && (withinOneEdit(tok, w) || withinOneEdit(tok, w.slice(0, tok.length)))) best = Math.max(best, 40);
  }
  // typed with the space left out ("ajaypandey") or across two words
  if (!best && tok.length >= 3 && joined.replace(/ /g, "").includes(tok)) best = 45;
  return best;
}

// options: [{ e (the event order), d (its date "YYYY-MM-DD"), off (days from this event) }]. venueOf(e) gives the venue line.
// Empty query: the list as it came (nearest dates first). Otherwise every typed word has to match the name, the venue or the
// date; the name counts for more than the venue, the venue more than the date; ties keep the original (nearest-date) order.
export function rankSites(options, query, venueOf = () => "") {
  const list = Array.isArray(options) ? options : [];
  const q = normSearch(query);
  if (!q) return list;
  const toks = q.split(" ").filter(Boolean);
  const scored = [];
  list.forEach((o, idx) => {
    const name = normSearch(o?.e?.clientName);
    const venue = normSearch(venueOf(o?.e));
    const d = String(o?.d || "");
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    const date = dm ? normSearch(`${d} ${+dm[3]} ${MON[+dm[2] - 1] || ""} ${dm[3]}/${dm[2]} ${+dm[3]}/${+dm[2]}`) : normSearch(d);
    const nameW = name.split(" "), venueW = venue.split(" "), dateW = date.split(" ");
    let total = 0;
    for (const t of toks) {
      const s = Math.max(tokenScore(t, nameW, name) * 1.0, tokenScore(t, venueW, venue) * 0.8, tokenScore(t, dateW, date) * 0.6);
      if (!s) return; // every word has to land somewhere
      total += s;
    }
    if (name.startsWith(q)) total += 60; // the whole query starts the name: the one most likely meant
    else if (name.includes(q)) total += 25;
    scored.push({ o, total, idx });
  });
  return scored.sort((a, b) => b.total - a.total || a.idx - b.idx).map((x) => x.o);
}

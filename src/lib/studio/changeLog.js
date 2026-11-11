// The sold-deal change log (amend_requests "logged", read in IMS → Planning → Activity log): what changed, in words a department
// head can act on. Each item: { name, change, from, to, qty, fn, zones, sub, fromName? }
//   added        - not there before (from 0)            "Terracotta Fibre Pot ×4"
//   removed      - gone (to 0)                         "Round Fibre Podium ×8"
//   qty_changed  - same item, new count                "Pillar Candle 151 → 157"
//   swapped      - one item out and another of the SAME sub-category in, in the same function: a switch, not two unrelated
//                  changes (owner ask 2026-11-11: "agar switch kra toh kis se kra")  "Round Fibre Podium → Terracotta Fibre Pot"
// `qty` stays the final count (to, else from) so an entry read by an older screen still says something sensible.

const key = (s) => String(s || "").trim().toLowerCase();

// Pairs removed + added items of one function that share a sub-category into "swapped" items - in the order they come, one to one.
export function pairSwaps(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [], usedRemoved = new Set();
  const removedBy = new Map(); // fn|sub -> [index]
  list.forEach((it, i) => {
    if (it?.change !== "removed" || !key(it.sub)) return;
    const k = `${it.fn || ""}|${key(it.sub)}`;
    (removedBy.get(k) || removedBy.set(k, []).get(k)).push(i);
  });
  list.forEach((it, i) => {
    if (!it) return;
    if (it.change === "added" && key(it.sub)) {
      const pool = removedBy.get(`${it.fn || ""}|${key(it.sub)}`) || [];
      const ri = pool.find((j) => !usedRemoved.has(j));
      if (ri != null) {
        usedRemoved.add(ri);
        const was = list[ri];
        out.push({ ...it, change: "swapped", fromName: was.name, from: was.from, to: it.to, qty: it.to, zones: it.zones?.length ? it.zones : was.zones });
        return;
      }
    }
    if (it.change === "removed" && usedRemoved.has(i)) return;
    out.push(it);
  });
  // a removed item matched to an added one that came before it in the list was skipped above only if already used - drop it now
  return out.filter((it, i) => !(it.change === "removed" && list.indexOf(it) >= 0 && usedRemoved.has(list.indexOf(it))));
}

// "Cocktail · 2026-11-12"
export const fnLabelOf = (fn) => [fn?.fnType || fn?.type || "", fn?.fnDate || fn?.date || ""].filter(Boolean).join(" · ");

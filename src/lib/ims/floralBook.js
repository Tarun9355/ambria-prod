import { swappedRecipeFlower } from "./mandiSwap.js";

// The Dept Ops Floral PDF's real flower lines per arrangement, taken from Deal Check's own snapshot
// (floralDetail[fn].realZones: [{ zone, el, kitParent, lines: [{ name, qty, unit }] }]) so a line in
// the book is the number Deal Check shows. One taker per zone page: take(name) hands an arrangement
// every row of that name in the zone (or of that KIT's own name, when the row came from a kit's
// attached recipe/component — kitParent, not el, is the key then), summed per flower, with this
// event's mandi swaps (made in IMS) applied - and only once, so a second card of the same name gets
// nothing rather than a second copy.
// has(name) says whether the snapshot knows that arrangement at all; when it does not (added after
// Deal Check last ran) the PDF works the lines out from the recipe instead.
const key = (n) => String(n || "").trim().toLowerCase();

export function realLineTaker(realZones, zoneKey, eventSwap) {
  const left = new Map();
  // Keyed by the KIT's own name (z.kitParent) when a kit is involved, same as the artificial-
  // bunch side's own cross-bracing fix — a kit's attached recipe is recorded under its own
  // decorated name ("Chandelier Tree Floral Recipe"), never the kit's name ("Tree"), so matching
  // by z.el alone meant it could never match the kit's own card on the zone page (nothing ever
  // calls .take() with the recipe's own name — only with the page's item names, e.g. "Tree") and
  // had no leftover-flush fallback either, so it was silently dropped from every PDF entirely
  // (owner report, 2026-11-13: Chandelier Tree Floral Recipe's real flowers never printed anywhere).
  (Array.isArray(realZones) ? realZones : []).filter((z) => z && z.zone === zoneKey).forEach((z) => {
    const k = key(z.kitParent || z.el);
    left.set(k, [...(left.get(k) || []), z]);
  });
  const known = new Set(left.keys());
  return {
    has: (name) => known.has(key(name)),
    take: (name) => {
      const k = key(name), list = left.get(k) || [];
      left.delete(k);
      const sum = new Map();
      list.forEach((z) => (z.lines || []).forEach((l) => {
        const qty = Number(l.qty) || 0;
        const sw = swappedRecipeFlower(eventSwap, l.name, qty) || { name: l.name, qty, unit: l.unit || "" };
        const sk = key(sw.name) + "|" + sw.unit;
        const prev = sum.get(sk);
        if (prev) prev.qty += sw.qty; else sum.set(sk, { ...sw });
      }));
      return [...sum.values()].map((l) => ({ ...l, qty: Math.round(l.qty * 100) / 100 })).filter((l) => l.qty > 0);
    },
  };
}

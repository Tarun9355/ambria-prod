import { swappedRecipeFlower } from "./mandiSwap.js";

// The Dept Ops Floral PDF's real flower lines per arrangement, taken from Deal Check's own snapshot
// (floralDetail[fn].realZones: [{ zone, el, lines: [{ name, qty, unit }] }]) so a line in the book is
// the number Deal Check shows. One taker per zone page: take(name) hands an arrangement every row of
// that name in the zone, summed per flower, with this event's mandi swaps (made in IMS) applied - and
// only once, so a second card of the same name gets nothing rather than a second copy.
// has(name) says whether the snapshot knows that arrangement at all; when it does not (added after
// Deal Check last ran) the PDF works the lines out from the recipe instead.
const key = (n) => String(n || "").trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// An arrangement's FULL recipe for its card (owner report 2026-11-13: a 100% artificial piece showed only its Oasis - the card
// listed the real share alone, which is 0 there, so every flower dropped out). Each recipe flower at its whole amount for the
// card's qty, with its split as a tag: "Real 0.75 · Artificial 1.75", or just "Artificial" / "Real" when it is all one.
//   recipe: per-piece lines [{ name, qty, unit, full }] (full = an inventory ingredient or a real-only flower: whole, no split)
//   snapReal: Deal Check's real lines for the card (realLineTaker.take) or null - the real amount is taken from it when it names
//     the flower, so the real figure stays the one Deal Check and the mandi list have; else recipe × realShare.
//   Snapshot lines the recipe does not name (added since) follow as they are, as real.
export function fullRecipeLines(recipe, pieces, realShare, snapReal, words = { real: "Real", art: "Artificial" }, mixed = true) {
  const share = Math.min(1, Math.max(0, Number.isFinite(Number(realShare)) ? Number(realShare) : 1));
  const snap = new Map((Array.isArray(snapReal) ? snapReal : []).map((l) => [key(l.name) + "|" + (l.unit || ""), l]));
  const out = [];
  (Array.isArray(recipe) ? recipe : []).forEach((f) => {
    const total = r2((Number(f.qty) || 0) * (Number(pieces) || 0));
    const sk = key(f.name) + "|" + (f.unit || "");
    const fromSnap = snap.get(sk);
    snap.delete(sk);
    if (!(total > 0)) return;
    if (f.full || !mixed) { out.push({ name: f.name, qty: total, unit: f.unit || "", tag: "" }); return; }
    const real = fromSnap ? r2(fromSnap.qty) : r2(total * share);
    const art = r2(total * (1 - share));
    const tag = real <= 0 ? words.art : art <= 0 ? words.real : `${words.real} ${real} · ${words.art} ${art}`;
    out.push({ name: f.name, qty: total, unit: f.unit || "", tag });
  });
  snap.forEach((l) => { if (Number(l.qty) > 0) out.push({ name: l.name, qty: r2(l.qty), unit: l.unit || "", tag: mixed ? words.real : "" }); });
  return out;
}

export function realLineTaker(realZones, zoneKey, eventSwap) {
  const left = new Map();
  (Array.isArray(realZones) ? realZones : []).filter((z) => z && z.zone === zoneKey).forEach((z) => {
    const k = key(z.el);
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

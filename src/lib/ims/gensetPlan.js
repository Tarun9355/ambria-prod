// The gensets a function runs on, for the Lighting Setup Book's Power page (owner ask 2026-11-03: the first thing in the
// Lighting book is which gensets and how big). Studio sends each function's own plan in functionsDetail[].gensets
// ({ kva125, kva62 } - the venue's counts, or the deal's override of them, exactly what Deal Check prices); an event
// synced before that existed falls back to the venue's standard counts from Admin → Transport (source "venue").
import { resolveVenueGensets } from "../studio/taxonomy";

const norm = (s) => String(s || "").toLowerCase().trim();

/** The transport venue a function's venue name stands for: by its own name, else its parent ("Exotica › Aura" → Exotica). */
export function trVenueFor(trVenues, venueName) {
  const list = Array.isArray(trVenues) ? trVenues : [];
  const vn = norm(venueName);
  if (!vn) return null;
  const direct = list.find((v) => norm(v?.name) === vn);
  if (direct) return direct;
  const parent = norm(String(venueName).split(/\s*[›>]\s*/)[0]);
  return parent && parent !== vn ? list.find((v) => norm(v?.name) === parent) || null : null;
}

/** { kva125, kva62, source: "deal" | "venue" } for one function, or null when nothing is known. */
export function gensetsForFn(fn, trVenues) {
  const g = fn?.gensets;
  if (g && (typeof g.kva125 === "number" || typeof g.kva62 === "number")) {
    return { kva125: Math.max(0, Number(g.kva125) || 0), kva62: Math.max(0, Number(g.kva62) || 0), source: "deal" };
  }
  const v = trVenueFor(trVenues, fn?.venue);
  if (!v) return null;
  const r = resolveVenueGensets(v);
  return { kva125: r.genset125, kva62: r.genset62, source: "venue" };
}

/** Total capacity in kVA. */
export const totalKva = (g) => (g ? (Number(g.kva125) || 0) * 125 + (Number(g.kva62) || 0) * 62.5 : 0);

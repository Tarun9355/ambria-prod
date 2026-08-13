// ═══ DETAIL CROPS FROM A REFERENCE PHOTOGRAPH ═══
//
// A zone card shows the photograph whole, and beside it two or three close details taken FROM THAT
// SAME PHOTOGRAPH — the florals, the structure, a tablescape — the way a designer pins a swatch
// beside a wide shot.
//
// They have to be produced here rather than asked for:
//   · Supabase's transform endpoint resizes and centre-crops, and takes no crop OFFSET, so it cannot
//     cut three different regions out of one image.
//   · Gamma fetches images by URL, so a canvas data URI is no use to it — a crop has to be hosted
//     before it can appear in a deck.
//
// So each crop is cut on a canvas, given a soft pastel wash, and uploaded through the `upload` Edge
// Function, which returns a public URL. The key is derived from the source and the region, so the
// same photograph re-used on a later deck resolves to the file already uploaded rather than a new
// one (the function answers duplicate:true and hands back the same URL).

import { isInventoryPhoto } from "./thumb";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Stable, filesystem-safe id for a source+region, so repeat generations reuse the same upload. */
function keyFor(url, tag) {
  let h = 0;
  const s = String(url);
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return `d${(h >>> 0).toString(36)}-${tag}`;
}

/**
 * Three regions worth cutting out of a décor photograph, as fractions of the frame.
 *
 * Deliberately not a grid: décor photographs put the structure high and centre, the florals and
 * tablescape lower and to the sides, so thirds-of-the-frame produces one dull crop of the middle.
 * These overlap and sit at different scales, which is what makes them read as details rather than
 * as the same picture three times.
 */
const REGIONS = [
  { tag: "a", x: 0.04, y: 0.30, w: 0.40, h: 0.52 },   // lower left — florals, props
  { tag: "b", x: 0.32, y: 0.06, w: 0.36, h: 0.48 },   // upper centre — structure, canopy
  { tag: "c", x: 0.58, y: 0.34, w: 0.38, h: 0.50 },   // lower right — table, seating
];

/**
 * A soft pastel wash: pull the saturation back, lift the blacks, warm it very slightly.
 *
 * The point is that a detail sitting beside its own full photograph should read as a study of it,
 * not compete with it. Kept gentle — heavy filtering on real décor work looks like a filter, which
 * is the opposite of expensive.
 */
function pastel(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = Math.min(255, (r * 0.62 + lum * 0.38) * 0.94 + 22);
    d[i + 1] = Math.min(255, (g * 0.62 + lum * 0.38) * 0.94 + 20);
    d[i + 2] = Math.min(255, (b * 0.62 + lum * 0.38) * 0.94 + 16);
  }
  ctx.putImageData(img, 0, 0);
}

async function uploadBlob(blob, name) {
  const fd = new FormData();
  fd.append("file", blob, `${name}.jpg`);
  fd.append("folder", "deck-details");
  fd.append("name", name);
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: fd,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.url) throw new Error(data.error || `upload HTTP ${resp.status}`);
  return data.url;
}

/**
 * Up to `count` hosted detail crops of one photograph, best-effort.
 *
 * Returns [] on any failure — a tainted canvas, a blocked upload, an image that will not load. The
 * zone card then simply shows the photograph on its own, which is the previous behaviour rather
 * than a broken deck.
 *
 * @param {string} srcUrl  a Supabase Storage URL (CORS-open, so the canvas is readable)
 * @param {number} [count=3]
 * @returns {Promise<string[]>} public URLs
 */
export async function detailShots(srcUrl, count = 3) {
  if (!srcUrl || typeof document === "undefined") return [];
  // A crop is uploaded to media/deck-details/, so its URL passes isInventoryPhoto by construction —
  // cropping a warehouse product shot would launder it straight past the guard the deck relies on.
  // Checked at the SOURCE so the client's "no inventory pictures" rule cannot be lost by a caller.
  if (isInventoryPhoto(srcUrl)) return [];
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = srcUrl;
    });

    const out = [];
    for (const r of REGIONS.slice(0, count)) {
      const sw = Math.round(img.naturalWidth * r.w);
      const sh = Math.round(img.naturalHeight * r.h);
      if (sw < 200 || sh < 200) continue;                 // too small to be worth showing
      const cv = document.createElement("canvas");
      cv.width = 900; cv.height = Math.round(900 * (sh / sw));
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, Math.round(img.naturalWidth * r.x), Math.round(img.naturalHeight * r.y),
        sw, sh, 0, 0, cv.width, cv.height);
      pastel(ctx, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.88));
      if (!blob) continue;
      out.push(await uploadBlob(blob, keyFor(srcUrl, r.tag)));
    }
    return out;
  } catch {
    return [];
  }
}

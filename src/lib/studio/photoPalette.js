// ═══ THE COLOUR STORY, READ OFF THE PHOTOGRAPHS ═══
//
// The deck's palette slide is built from the palette chosen in Build. Most deals never choose one —
// the field defaults to the string "Custom", which resolves to no colour at all — so the slide was
// simply skipped, and the deck a client saw had no colour story in it.
//
// Rather than leave it out, the colours are taken from the references the deal is actually built
// on. That is also the more honest slide: it shows the colours of the décor being proposed rather
// than a palette name someone picked from a dropdown and never looked at again.
//
// Sampling happens on a canvas, so the images must be CORS-open — Supabase Storage serves
// Access-Control-Allow-Origin: *, which is why a crop can be read back at all (see detailShots).

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * The pixel maths, kept apart from the canvas so it can be tested without a browser.
 *
 * Feeds on RGBA byte arrays exactly as getImageData hands them over; call it once per photograph
 * with the shared `bins` map so colours are counted across the whole set rather than per picture.
 */
export function countPixels(data, bins) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 244 || max < 26) continue;                    // blown highlight or shadow
    if (max - min < 26) continue;                           // grey: no colour to report
    const key = `${(r / 43) | 0}-${(g / 43) | 0}-${(b / 43) | 0}`;
    const cur = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    bins.set(key, cur);
  }
  return bins;
}

/** Rank the counted bins into at most `count` distinct swatches, lightest first. */
export function rankBins(bins, count = 5, minPixels = 24) {
  const ranked = [...bins.values()]
    .filter((c) => c.n > minPixels)                          // a stray dozen pixels is not a colour
    .sort((a, b) => b.n - a.n)
    .map((c) => ({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }));

  const picked = [];
  for (const c of ranked) {
    // Far enough from everything already chosen to read as a different colour on the slide.
    const clash = picked.some((p) => (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2 < 3600);
    if (clash) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }
  // Lightest first, which is how a designer lays swatches out — pale ground through to the accent.
  return picked
    .sort((a, b) => (b.r + b.g + b.b) - (a.r + a.g + a.b))
    .map((c) => hex2(c.r) + hex2(c.g) + hex2(c.b));
}

/** Load an image for reading pixels, or null if it will not load / cannot be read. */
function load(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}


/**
 * Up to `count` colours that characterise a set of photographs, brightest-first.
 *
 * Pixels are bucketed coarsely (a 6-level cube, 216 bins) and the fullest bins win. Two filters do
 * the real work:
 *
 *   · Near-white, near-black and washed-out greys are dropped. Décor photography is mostly drape,
 *     ceiling and shadow, so an unfiltered count returns white, off-white and grey every time —
 *     technically the dominant colours, and useless as a palette.
 *   · Winners must differ from each other. Without that, five bins of the same marigold come back
 *     as five swatches, which looks like a bug even though the count is correct.
 *
 * @param {string[]} urls   photographs to read (a handful is plenty)
 * @param {number} [count=5]
 * @returns {Promise<string[]>} hex strings WITHOUT the leading #, matching what the deck expects
 */
export async function paletteFromPhotos(urls, count = 5) {
  if (typeof document === "undefined") return [];
  const list = (urls || []).filter(Boolean).slice(0, 4);
  if (!list.length) return [];

  const bins = new Map();                                  // bucket key → { n, r, g, b }
  for (const url of list) {
    const img = await load(url);
    if (!img) continue;
    try {
      // 120px wide is enough: this is about which colours are present and in what proportion, and a
      // full-size read of four photographs is megabytes of pixels for an answer that does not change.
      const w = 120, h = Math.max(1, Math.round(120 * (img.naturalHeight / img.naturalWidth || 0.66)));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      countPixels(ctx.getImageData(0, 0, w, h).data, bins);
    } catch { /* tainted canvas — that photo simply does not contribute */ }
  }

  return rankBins(bins, count);
}

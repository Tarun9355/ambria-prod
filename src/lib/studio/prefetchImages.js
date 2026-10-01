// ═══ PARALLEL IMAGE PREFETCH ═══
// Warms the browser's HTTP cache for a list of image URLs, several at a time, so that when the
// <img> tags for them render (or scroll into view, for loading="lazy" ones) they come straight from
// cache instead of starting a download only at that moment — which is what made grids "pop in".
//
// Bounded concurrency rather than firing all at once: a 200-photo zone grid would otherwise queue
// 200 requests ahead of the images actually on screen. Each URL is fetched at most once per page
// load (the Set below), so calling this again on every render or every modal open costs nothing.

const seen = new Set();

// The Availability picker's thumbnail size (CSS px, fed to thumbUrl). Shared so the prefetch in
// openAvailModal and the <img> in StudioModals ask for the byte-identical URL — a different size
// would be a different URL, and the prefetch would warm a cache entry nothing ever reads.
export const AVAIL_THUMB = 180;

/**
 * @param {string[]} urls       image URLs (falsy / duplicate entries are skipped)
 * @param {object}   [opts]
 * @param {number}   [opts.concurrency=6] how many downloads run in parallel
 */
export function prefetchImages(urls, { concurrency = 6 } = {}) {
  const queue = [];
  for (const u of urls || []) {
    if (!u || typeof u !== "string" || seen.has(u)) continue;
    seen.add(u);
    queue.push(u);
  }
  if (!queue.length) return;
  let i = 0;
  const next = () => {
    if (i >= queue.length) return;
    const url = queue[i++];
    const img = new Image();
    img.decoding = "async";
    img.onload = img.onerror = next;   // a broken image just frees its slot for the next one
    img.src = url;
  };
  for (let n = 0; n < Math.min(concurrency, queue.length); n++) next();
}

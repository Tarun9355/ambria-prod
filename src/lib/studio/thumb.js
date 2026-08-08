// ═══ THUMBNAIL URLs ═══
//
// Inventory photos are stored at full camera resolution — measured across a sample of six, they
// average ~2 MB and run to 4 MB. Deal Check renders them at 16–54px, and a card lists ~11
// alternatives, so a single function was pulling tens of megabytes of multi-megapixel JPEG to draw
// thumbnails the size of a fingernail. Decoding that is what made scrolling stutter.
//
// Supabase Storage can resize on the fly: swapping /object/public/ for /render/image/public/ and
// asking for a width returns a scaled copy. Same six images: 13.4 MB → 291 KB, a 47× reduction.
//
// Only Supabase Storage URLs are rewritten. Anything else — a Cloudinary leftover, a YouTube
// thumbnail, a data: URI, a blob: preview mid-upload — is returned untouched, because guessing at
// a transform endpoint that does not exist would replace a working image with a broken one.

const SB_PUBLIC = "/storage/v1/object/public/";
const SB_RENDER = "/storage/v1/render/image/public/";

/**
 * A resized copy of a Supabase Storage image, or the original URL if it is not one.
 * @param {string} url    source image url
 * @param {number} width  target width in CSS px — pass the rendered size, not the natural size
 * @param {number} [quality=60]
 */
export function thumbUrl(url, width, quality = 60) {
  if (typeof url !== "string" || !url) return url;
  if (!url.includes(SB_PUBLIC)) return url;              // not Supabase Storage — leave it alone
  if (url.includes("/render/image/")) return url;         // already a transform
  // Retina: ask for twice the CSS width so the thumbnail is not soft on a HiDPI screen. Still
  // ~50x smaller than the original at these sizes.
  const w = Math.max(32, Math.round((Number(width) || 64) * 2));
  const [base, query] = url.split("?");
  const rendered = base.replace(SB_PUBLIC, SB_RENDER);
  // Preserve any existing query (a signed token, say) rather than dropping it.
  return `${rendered}?${query ? query + "&" : ""}width=${w}&quality=${quality}`;
}

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
 * A deck-ready copy of a Supabase Storage image: cropped to a fixed aspect ratio at presentation
 * resolution. Returns the original URL untouched if it is not Supabase Storage.
 *
 * Gamma lays out whatever shape it is handed. Zone photos are raw camera uploads in whatever
 * orientation the phone was held, so a deck mixing portrait and landscape gets cards where the image
 * sits inset with white margins instead of filling the frame — the "flat images" complaint. Feeding
 * every photo at ONE ratio lets Gamma place them edge to edge, and makes the deck read as a designed
 * set rather than a folder of snapshots.
 *
 * This crops and scales only. Supabase's transform endpoint has no colour or contrast controls, so
 * a dull photo stays dull — that would need an image pipeline that can actually enhance.
 *
 * @param {string} url          source image url
 * @param {number} [width=1600]
 * @param {number} [height=900] 16:9 by default — full-bleed on a 16x9 card
 * @param {number} [quality=85] higher than thumbUrl's 60: this is projected, not a fingernail
 */
export function deckImageUrl(url, width = 1600, height = 900, quality = 85) {
  if (typeof url !== "string" || !url) return url;
  if (!url.includes(SB_PUBLIC)) return url;
  if (url.includes("/render/image/")) return url;
  const [base, query] = url.split("?");
  const rendered = base.replace(SB_PUBLIC, SB_RENDER);
  return `${rendered}?${query ? query + "&" : ""}width=${width}&height=${height}&resize=cover&quality=${quality}`;
}

/**
 * A square, resized copy of a Supabase Storage image, or the original URL if it is not one.
 *
 * BOTH width and height must be sent, with resize=cover. Passing `width` alone does NOT scale
 * proportionally — it sets the width and leaves the height untouched, so a 899×1599 photo came
 * back 80×1599 and rendered into a square box as a stretched vertical sliver. cover crops to the
 * centre instead, which is what an `object-cover` thumbnail wants anyway.
 *
 * @param {string} url    source image url
 * @param {number} size   rendered box size in CSS px (these thumbnails are square)
 * @param {number} [quality=60]
 */
export function thumbUrl(url, size, quality = 60) {
  if (typeof url !== "string" || !url) return url;
  if (!url.includes(SB_PUBLIC)) return url;              // not Supabase Storage — leave it alone
  if (url.includes("/render/image/")) return url;         // already a transform
  // Retina: ask for twice the CSS size so it is not soft on a HiDPI screen. Still ~100x smaller
  // than the original — the 899×1599 case goes 293 KB → 2 KB.
  const px = Math.max(32, Math.round((Number(size) || 64) * 2));
  const [base, query] = url.split("?");
  const rendered = base.replace(SB_PUBLIC, SB_RENDER);
  // Preserve any existing query (a signed token, say) rather than dropping it.
  return `${rendered}?${query ? query + "&" : ""}width=${px}&height=${px}&resize=cover&quality=${quality}`;
}

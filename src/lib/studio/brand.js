// ══ THE BRAND MARK, AND HOW TO CROP IT ══
//
// Shared because the crop is MEASURED DATA, not styling. It was declared inside StudioApp, and the
// moment a second header wanted the wordmark the choice was to copy six numbers or to move them
// here. Copied numbers drift: re-export the logo with different padding and one header silently
// starts cropping into the letters while the other still looks right, with nothing to say why.
//
// A glob rather than a plain import, same as the views that used to declare their own: if the file
// is not there the glob resolves to {} and LOGO_ASSET is null, so callers fall back to a lettermark
// and the build still runs. An import of a missing asset fails the build outright.

export const LOGO_ASSET = Object.values(
  import.meta.glob("../../assets/ambria-logo.{svg,png,webp,jpg,jpeg}", { eager: true, query: "?url", import: "default" })
)[0] || null;

// MEASURED opaque bounds of ambria-logo.png — the artwork is 4258×2838 but the mark itself is only
// 2530×733 at (869,1045): roughly 37% of the canvas is transparent padding above and below, and 20%
// either side. Dropped into a header row as-is, the visible wordmark comes out about a third the
// height of the space it occupies, which is why hand-tuned negative margins kept appearing next to
// it. These numbers crop that padding by measurement instead, so the lockup is sized by the one
// number that actually matters: how tall the wordmark should be.
export const LOGO_BOX = { w: 4258, h: 2838, x: 869, y: 1045, cw: 2530, ch: 733 };

/**
 * Styles for a wordmark cropped to its own ink, at a given mark height in px.
 * Returns { box, img } — spread onto a wrapper and the <img> inside it.
 * @param {number} markH how tall the visible wordmark should be
 */
export const logoCrop = (markH) => {
  const k = markH / LOGO_BOX.ch;
  return {
    box: { position: "relative", width: Math.round(LOGO_BOX.cw * k), height: markH, overflow: "hidden", flexShrink: 0 },
    img: { position: "absolute", left: -LOGO_BOX.x * k, top: -LOGO_BOX.y * k,
      width: LOGO_BOX.w * k, height: LOGO_BOX.h * k, maxWidth: "none", display: "block" },
  };
};

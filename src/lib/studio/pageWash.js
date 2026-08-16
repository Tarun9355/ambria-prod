// ═══ THE STUDIO PAGE GROUND ═══
//
// The warm surface Event Info and Browse are both drawn on: soft colour bands sweeping across a
// cream field. It lives here rather than in either view because both need the SAME ground — two
// copies of it drifted apart the moment one page was retuned, and a shared background that differs
// between two steps of one flow is worse than no background at all.
//
// Purely presentational. No React, no state.

/**
 * One long wave: alternating half-period cubics, each a smooth crest or trough, so the curve stays
 * continuous rather than showing a corner at every join.
 */
export const ripplePath = (y, amp, period, width) => {
  const half = period / 2;
  let d = `M0 ${y}`;
  for (let x = 0, up = true; x < width; x += half, up = !up) {
    const cy = up ? y - amp : y + amp;
    d += ` C${(x + half / 3).toFixed(1)} ${cy} ${(x + (half * 2) / 3).toFixed(1)} ${cy} ${(x + half).toFixed(1)} ${y}`;
  }
  return d;
};

/**
 * Broad soft bands, not drawn lines — each is the same wave carrying a 100-odd unit stroke, so it
 * reads as a ribbon of colour rather than a contour. Long periods (800–1300 against a 1200 canvas)
 * keep them to roughly one lazy swell across the page instead of a ripple pattern; a short period
 * at this width is what makes it look like corrugation.
 *
 * Drawn 1800 wide against a 1200 canvas — the bands drift horizontally, and the overhang is what
 * keeps a swept end from wandering into frame.
 */
export const WASH_BANDS = [
  { y: 110, amp: 44, period:  920, w: 132, c: "#C9A96E", o: 0.40 },
  { y: 296, amp: 62, period: 1180, w: 104, c: "#D69E8C", o: 0.34 },
  { y: 470, amp: 38, period:  800, w: 150, c: "#C9A96E", o: 0.27 },
  { y: 654, amp: 68, period: 1320, w: 118, c: "#7C5CD6", o: 0.24 },
  { y: 836, amp: 46, period:  880, w: 140, c: "#C9A96E", o: 0.33 },
].map((b) => ({ ...b, d: ripplePath(b.y - 60, b.amp, b.period, 1800) }));

/**
 * The grain tile — a 220px turbulence square, tiled. This is what stops the bands reading as clean
 * airbrush and pushes the surface toward chalk. Tiled from a small data URI rather than run as a
 * full-page feTurbulence filter, so it costs one small paint instead of filtering the viewport.
 */
export const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.28'/%3E%3C/svg%3E\")";

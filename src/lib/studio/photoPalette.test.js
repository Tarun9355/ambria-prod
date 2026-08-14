import { describe, it, expect } from "vitest";
import { countPixels, rankBins } from "./photoPalette";
import { nearestColourName } from "./colours";

/** RGBA bytes: `n` pixels of one colour. */
const px = (r, g, b, n) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; }
  return a;
};
const join = (...arrs) => {
  const out = new Uint8ClampedArray(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

describe("paletteFromPhotos pixel maths", () => {
  it("ignores what décor photography is mostly made of — white, black and grey", () => {
    // The realistic case: a room shot that is overwhelmingly drape and shadow, with the actual
    // décor colours in the minority. Counting honestly returns white; the palette must not.
    const data = join(
      px(252, 250, 248, 4000),   // blown white drape
      px(10, 10, 12, 3000),      // shadow
      px(150, 152, 150, 2000),   // flat grey
      px(196, 122, 60, 400),     // marigold
      px(70, 110, 120, 300),     // teal
    );
    const hexes = rankBins(countPixels(data, new Map()), 5);
    expect(hexes).toHaveLength(2);
    expect(hexes.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining([expect.stringMatching(/^c47a3c$/i), expect.stringMatching(/^466e78$/i)]),
    );
  });

  it("does not return the same colour five times", () => {
    // Five bins of near-identical marigold plus one blue. Without the distinctness rule this comes
    // back as five swatches of the same colour, which reads as a bug even though the count is right.
    const data = join(
      px(200, 124, 60, 900), px(203, 127, 62, 800), px(198, 122, 58, 700),
      px(201, 125, 61, 600), px(199, 123, 59, 500),
      px(60, 90, 170, 400),
    );
    const hexes = rankBins(countPixels(data, new Map()), 5);
    expect(hexes).toHaveLength(2);
  });

  it("counts across photographs rather than per photograph", () => {
    const bins = new Map();
    countPixels(px(196, 122, 60, 300), bins);
    countPixels(px(70, 110, 120, 300), bins);
    expect(rankBins(bins, 5)).toHaveLength(2);
  });

  it("drops a colour that is only a handful of stray pixels", () => {
    const data = join(px(196, 122, 60, 500), px(20, 200, 40, 6));
    expect(rankBins(countPixels(data, new Map()), 5)).toHaveLength(1);
  });

  it("orders swatches lightest first", () => {
    const data = join(px(240, 210, 180, 500), px(120, 60, 40, 500));
    const [first, second] = rankBins(countPixels(data, new Map()), 5);
    const sum = (h) => parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16);
    expect(sum(first)).toBeGreaterThan(sum(second));
  });

  it("gives a sampled colour a name a client can read", () => {
    // The point of the naming pass: a palette slide captioned #9CAF88 tells nobody anything.
    // "Sage" and "Sage Green" are the same hex in the map, and either is a fine caption — what
    // matters is that it comes back as a name rather than as the number.
    expect(nearestColourName("9cae87", [])).toMatch(/^Sage/);
    expect(nearestColourName("fffff0", [])).toBe("Ivory");
    // A house colour Ambria has named itself wins over the built-in map.
    expect(nearestColourName("9cae87", [{ name: "Ambria Olive", hex: "#9CAF88" }])).toBe("Ambria Olive");
  });
});

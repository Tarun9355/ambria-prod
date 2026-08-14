// Smart swatch: resolve a colour NAME → hex so the team doesn't have to know hex codes. Order:
// a manual override (row.hex) → the colour catalogue → a curated decor-colour map → a CSS colour name
// (spaces removed, e.g. "sky blue" → "skyblue") → grey. Keeps blue-collar data entry correct-by-default.
// Shared by AdminSettingsTab.jsx (colour-catalogue editing) and StudioSummary.jsx (moodboard swatches).
export const DECOR_COLOURS = {
  "ivory": "#FFFFF0", "off-white": "#FAF9F6", "offwhite": "#FAF9F6", "white": "#FFFFFF", "cream": "#FFFDD0", "beige": "#F5F5DC",
  "rose gold": "#B76E79", "rosegold": "#B76E79", "gold": "#D4AF37", "silver": "#C0C0C0", "maroon": "#800000", "burgundy": "#800020",
  "wine": "#722F37", "red": "#D32F2F", "rani": "#E3006D", "pink": "#FF69B4", "magenta": "#FF00FF", "fuchsia": "#C154C1",
  "orange": "#FFA500", "rust orange": "#B7410E", "rust": "#B7410E", "peach": "#FFCBA4", "coral": "#FF7F50",
  "yellow": "#FFD54F", "mustard": "#E1AD01", "black": "#111111", "brown": "#8B5A2B", "tan": "#D2B48C", "charcoal": "#36454F",
  "grey": "#9E9E9E", "gray": "#9E9E9E", "purple": "#800080", "lilac": "#C8A2C8", "lavender": "#B57EDC",
  "light blue": "#ADD8E6", "sky blue": "#87CEEB", "blue": "#1976D2", "navy": "#000080", "teal": "#008080", "turquoise": "#40E0D0",
  "green": "#2E7D32", "sage green": "#9CAF88", "sage": "#9CAF88", "olive": "#808000", "mint": "#98D8A0",
};

/**
 * The closest NAME we have for a hex — "Blush", "Sage", "Ivory" — searching the catalogue first.
 *
 * Colours sampled off a photograph arrive as raw hex, and a palette slide captioned #C4A882 tells a
 * client nothing. Distance is measured in plain RGB: it is not perceptually uniform, but for
 * picking the nearest of forty well-spread decor colours the difference never shows, and the
 * alternative is a Lab conversion nobody can check by eye.
 *
 * The catalogue wins over the built-in map, so a house colour Ambria has named itself is the name
 * that comes back.
 */
export const nearestColourName = (hex, colourCatalogue) => {
  const rgb = (h) => {
    const m = String(h || "").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  };
  const target = rgb(hex);
  if (!target) return "";
  const pool = [
    ...(colourCatalogue || []).filter((c) => c?.name && /^#?[0-9a-fA-F]{6}$/.test(String(c.hex || "").replace("#", "")))
      .map((c) => ({ name: c.name, rgb: rgb(c.hex) })),
    ...Object.entries(DECOR_COLOURS).map(([name, h]) => ({ name, rgb: rgb(h) })),
  ].filter((c) => c.rgb);
  let best = "", bestD = Infinity;
  for (const c of pool) {
    const d = (c.rgb[0] - target[0]) ** 2 + (c.rgb[1] - target[1]) ** 2 + (c.rgb[2] - target[2]) ** 2;
    if (d < bestD) { bestD = d; best = c.name; }
  }
  // Title Case, since these become slide captions and the built-in map is keyed in lower case.
  return best.replace(/\b\w/g, (ch) => ch.toUpperCase());
};

export const cssColourToHex = (name) => {
  try {
    const spaceless = String(name || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!spaceless) return null;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillStyle = spaceless; const a = ctx.fillStyle;
    ctx.fillStyle = "#fff"; ctx.fillStyle = spaceless; const b = ctx.fillStyle;
    return a === b ? a : null; // invalid names leave the base value unchanged in both passes
  } catch { return null; }
};

export const swatchHexFor = (name, colourCatalogue, override) => {
  if (override && /^#/.test(override)) return override;
  const key = String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return "#cccccc";
  const cat = (colourCatalogue || []).find((c) => String(c.name || "").trim().replace(/\s+/g, " ").toLowerCase() === key);
  if (cat?.hex && /^#/.test(cat.hex)) return cat.hex;
  if (DECOR_COLOURS[key]) return DECOR_COLOURS[key];
  const css = cssColourToHex(key);
  return css || "#cccccc";
};

// ═══ PALETTE NAMES ═══ Single source for "which palettes does the catalogue actually offer".
//
// Every caller used to gate on `imsPaletteCatalogue.length > 0` and fall back to the taxonomy list
// only when the catalogue was completely empty. One click of "+ Add Palette" in Manage → Library
// writes `{name:"New Palette", anchorColours:[]}` straight to the DB, and that single placeholder
// was enough to make the catalogue "non-empty" — which suppressed all 13 taxonomy palettes and left
// the Browse/Build filters showing nothing but "All" and "New Palette".
//
// A row counts as a real palette only if it has been named. An untouched "New Palette" with no
// anchor colours is the editor's placeholder, not a choice anyone made, so it never counts. Rename
// it (or give it colours) and it starts counting like any other.
export const isPlaceholderPalette = (p) => {
  const name = String(p?.name || "").trim();
  if (!name) return true;
  return name.toLowerCase() === "new palette" && !(p?.anchorColours || []).length;
};

// Palette names are typed by hand and the live catalogue shows it — 11 of 33 carry a trailing or
// doubled space ("Gold ", "Ivory &  Rose Gold"), and "Brown " / "Brown" exist as two separate
// entries. Comparing raw strings means "Brown " and "Brown" are different palettes: two identical
// pills in the filter, each matching a different half of the photos. Normalise for every
// comparison and for what gets displayed.
export const normPaletteName = (s) => String(s || "").replace(/\s+/g, " ").trim();
export const samePalette = (a, b) => normPaletteName(a).toLowerCase() === normPaletteName(b).toLowerCase();
// True when `name` is in `list`, ignoring case and stray whitespace on either side.
export const paletteInList = (list, name) => (list || []).some((x) => samePalette(x, name));

export const paletteNames = (paletteCatalogue, taxonomyPalettes, fallback = []) => {
  // Trim on the way out and drop case/whitespace duplicates, keeping first seen.
  const dedupe = (arr) => {
    const seen = new Set(), out = [];
    for (const raw of arr) {
      const name = normPaletteName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  };
  const real = dedupe((paletteCatalogue || []).filter((p) => !isPlaceholderPalette(p)).map((p) => p.name));
  if (real.length) return real;
  const tax = dedupe((taxonomyPalettes || []).filter(Boolean));
  return tax.length ? tax : dedupe(fallback);
};

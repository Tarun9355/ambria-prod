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

export const paletteNames = (paletteCatalogue, taxonomyPalettes, fallback = []) => {
  const real = (paletteCatalogue || []).filter((p) => !isPlaceholderPalette(p)).map((p) => p.name);
  if (real.length) return real;
  const tax = (taxonomyPalettes || []).filter(Boolean);
  return tax.length ? tax : fallback;
};

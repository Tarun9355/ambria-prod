// Flower recipe/cost helpers (faithful to the reference IMS app).

// Resolve a requested recipe size against a pattern's sizes object (with legacy aliases).
export const resolveSizeKey = (sizesObj, requestedSize) => {
  if (!sizesObj) return null;
  if (sizesObj[requestedSize]) return requestedSize;
  if (requestedSize === "large" && sizesObj.big) return "big"; // legacy alias
  if (requestedSize === "big" && sizesObj.large) return "large"; // pre-migration safety
  if (sizesObj.medium) return "medium";
  const keys = Object.keys(sizesObj);
  return keys.length ? keys[0] : null;
};

// Normalize a size-class string to S / B / M.
export const normalizeSizeClass = (raw) => {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "S" || s === "SMALL") return "S";
  if (s === "B" || s === "BIG" || s === "LARGE") return "B";
  return "M";
};

// Map a size-class to the recipe-pattern size key.
export const sizeClassToPatternKey = (sc) => {
  const c = normalizeSizeClass(sc);
  return c === "S" ? "small" : c === "B" ? "big" : "medium";
};

// Resolve a flower id (parent or colour-variant) against the mandi catalogue.
export const resolveMandiFlower = (id, mandi) => {
  if (!id) return null;
  const list = mandi || [];
  const parent = list.find((f) => f?.id === id);
  if (parent) return { parent, variant: null, price: Number(parent.currentPrice) || 0 };
  for (const p of list) {
    const v = (p?.colorVariants || []).find((cv) => cv?.variantId === id);
    if (v) return { parent: p, variant: v, price: Number(p.currentPrice) || 0 };
  }
  return null;
};

// Σ(qty × mandi price) for one recipe size. null when empty.
export const computePatternSizeCost = (sizeData, mandiCatalogue) => {
  if (!sizeData?.flowers?.length) return null;
  let total = 0;
  for (const fl of sizeData.flowers) {
    const res = resolveMandiFlower(fl?.flowerId, mandiCatalogue);
    const price = res ? res.price : 0;
    total += (Number(fl?.qty) || 0) * price;
  }
  return total;
};

// pattern override > global default > 3 (hard floor).
export const effectiveMarkup = (pat, settings) => {
  const perPat = Number(pat?.studioMarkup);
  if (perPat > 0) return perPat;
  const globalDef = Number(settings?.defaultStudioMarkup);
  if (globalDef > 0) return globalDef;
  return 3;
};

// Matches an item's name to a flower recipe pattern — same bidirectional-substring convention as
// StudioApp.jsx's floralArtUnitRate/patternExtra (exact lowercase-trim match first, else either
// name containing the other). Size is resolved separately (resolveSizeKey/sizeClassToPatternKey
// above) — a pattern can have 3 sizes; the caller's own size selection picks which one.
export const matchFlowerPattern = (name, flowerPatterns) => {
  const tn = String(name || "").toLowerCase().trim();
  if (!tn) return null;
  const patterns = flowerPatterns || [];
  let pattern = patterns.find((p) => String(p?.name || "").toLowerCase().trim() === tn);
  if (!pattern) pattern = patterns.find((p) => { const n = String(p?.name || "").toLowerCase().trim(); return n && (tn.includes(n) || n.includes(tn)); });
  return pattern || null;
};

// Real (Studio rate) + artificial unit rates for a matched pattern at a resolved size key.
// realRate mirrors the Recipe editor's own "Studio rate" readout (computePatternSizeCost ×
// effectiveMarkup). artRate mirrors StudioApp.jsx's floralArtUnitRate formula byte-for-byte
// (bunches × mix-rate × markup) — that existing function uses settings.defaultStudioMarkup
// directly rather than effectiveMarkup's per-pattern override, so this preserves the same
// asymmetry rather than "fixing" a formula used elsewhere. `extra` (pot/base) is returned
// separately, uncombined — callers blend realRate/artRate by real% first, then add extra once,
// matching getElPrice's existing composition order (extra is never itself blended).
export const floralPatternUnitRates = (pattern, sizeKey, mandiCatalogue, settings) => {
  if (!pattern) return null;
  const sizes = pattern.sizes || {};
  const sizeData = sizes[resolveSizeKey(sizes, sizeKey)];
  if (!sizeData) return null;
  const markup = effectiveMarkup(pattern, settings);
  const realRate = Math.round((computePatternSizeCost(sizeData, mandiCatalogue) || 0) * markup);
  const afRate = Number(settings?.artificialFlowerRatePerKg ?? 50);
  const afBPK = Number(settings?.artificialFlowerBunchesPerKg ?? 16) || 16;
  const agRate = Number(settings?.artificialGreenRatePerKg ?? 40);
  const agBPK = Number(settings?.artificialGreenBunchesPerKg ?? 23) || 23;
  const artMarkup = Number(settings?.defaultStudioMarkup ?? 3) || 3;
  let artCost = 0;
  (sizeData.flowers || []).forEach((fl) => {
    const parent = resolveMandiFlower(fl?.flowerId, mandiCatalogue)?.parent || null;
    const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
    if (ft === "real_only") return;
    const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
    artCost += (Number(fl?.qty) || 0) * bpu * (ft === "green" ? agRate / agBPK : afRate / afBPK);
  });
  const artRate = Math.round(artCost * artMarkup);
  return { realRate, artRate, extra: Number(sizeData.extraCost) || 0 };
};

const RC_UNIT_LABELS = {
  sqft: "/sqft", truss_sqft: "/truss sqft", rft: "/RFT", pc: "/pc", setup: "/setup",
  trip: "/trip", event: "/event", string: "/string", included: "Included", multiplier: "× mult",
};
export const studioUnitLabel = (unitId) => RC_UNIT_LABELS[String(unitId || "").toLowerCase()] || (unitId ? `/${unitId}` : "");

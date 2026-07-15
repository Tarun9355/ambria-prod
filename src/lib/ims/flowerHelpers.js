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

// Σ(qty × mandi price) for one recipe size, plus Σ(qty × IMS rental) for any inventory-sourced
// ingredient rows ({invItemId, qty} — added via the "Artificial included?" toggle). null when empty.
export const computePatternSizeCost = (sizeData, mandiCatalogue, inventory) => {
  if (!sizeData?.flowers?.length) return null;
  let total = 0;
  for (const fl of sizeData.flowers) {
    if (fl?.invItemId) {
      const item = (inventory || []).find((i) => i.id === fl.invItemId);
      const price = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
      total += (Number(fl?.qty) || 0) * price;
      continue;
    }
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

// Matches an INVENTORY ITEM to a flower recipe pattern. A pattern is created per SUB-CATEGORY
// (AdminSettingsTab.jsx's Recipes panel stamps `pattern.sub` from the Rate Card item it was
// provisioned from — e.g. "Flower Pot Small" applies to every differently-named physical item in
// that sub-category: "Round Fibre Pot", "Terracotta Fibre Element", etc., NOT just an item whose
// own product name happens to match). Match by sub-category first; fall back to an exact name
// match only for the case where the pattern's name literally equals the item's own name (legacy
// patterns with no `.sub`, or a pattern named after one specific product). Deliberately no
// substring fallback — that matched "Blue Pottery Pot"/"Blue Pottery Pot Big" only by coincidence
// and produces wrong matches for every other sub-category (confirmed bug: "Round Fibre Pot" under
// sub-category "Flower Pot Small" needs the sub-category join, not a name-text relationship).
// Squeeze internal whitespace (not just trim) before comparing — a manual-entry doubled space
// ("Flower Pot  Small") renders identically to the clean label but compares as a different string,
// the exact bug already found/fixed for the Inventory tab's sub-category chips.
const squeezeKey = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export const matchFlowerPattern = (item, flowerPatterns) => {
  const patterns = flowerPatterns || [];
  const itemSub = squeezeKey(item?.subcategory || item?.subCat);
  if (itemSub) {
    const bySub = patterns.find((p) => squeezeKey(p?.sub) === itemSub);
    if (bySub) return bySub;
  }
  const tn = squeezeKey(item?.name);
  if (!tn) return null;
  return patterns.find((p) => squeezeKey(p?.name) === tn) || null;
};

// Real (Studio rate) + artificial unit rates for a matched pattern at a resolved size key.
// realRate mirrors the Recipe editor's own "Studio rate" readout (computePatternSizeCost ×
// effectiveMarkup). artRate mirrors StudioApp.jsx's floralArtUnitRate formula byte-for-byte
// (bunches × mix-rate × markup) — that existing function uses settings.defaultStudioMarkup
// directly rather than effectiveMarkup's per-pattern override, so this preserves the same
// asymmetry rather than "fixing" a formula used elsewhere. `extra` (pot/base) is returned
// separately, uncombined — callers blend realRate/artRate by real% first, then add extra once,
// matching getElPrice's existing composition order (extra is never itself blended).
export const floralPatternUnitRates = (pattern, sizeKey, mandiCatalogue, settings, inventory) => {
  if (!pattern) return null;
  const sizes = pattern.sizes || {};
  const sizeData = sizes[resolveSizeKey(sizes, sizeKey)];
  if (!sizeData) return null;
  const markup = effectiveMarkup(pattern, settings);
  const realRate = Math.round((computePatternSizeCost(sizeData, mandiCatalogue, inventory) || 0) * markup);
  const afRate = Number(settings?.artificialFlowerRatePerKg ?? 50);
  const afBPK = Number(settings?.artificialFlowerBunchesPerKg ?? 16) || 16;
  const agRate = Number(settings?.artificialGreenRatePerKg ?? 40);
  const agBPK = Number(settings?.artificialGreenBunchesPerKg ?? 23) || 23;
  const artMarkup = Number(settings?.defaultStudioMarkup ?? 3) || 3;
  let artCost = 0;
  (sizeData.flowers || []).forEach((fl) => {
    if (fl?.invItemId) return; // inventory-sourced ingredient — already priced directly, not a bunches-per-kg estimate
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

// Flower recipe/cost helpers (faithful to the reference IMS app).

// Shared by every mandi-catalogue consumer: FlowerMandiTab.jsx, AdminSettingsTab.jsx, IMS.jsx, and
// StudioApp.jsx's two independent settings-fetch sites. The `mandi_flowers` TABLE (migration 039) is
// the source of truth now, one row per flower — these translate between that row shape and the
// plain-object array every function in this file already expects (resolveMandiFlower,
// computePatternSizeCost, …), so none of that cost-calc logic had to change.
export const genMandiFlowerId = () => "F" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function rowToMandiFlower(r) {
  return {
    id: r.id, name: r.name, flowerCat: r.flower_cat || "Other", unit: r.unit || "bundle",
    gattharSize: r.gatthar_size != null ? Number(r.gatthar_size) : null,
    flowerType: r.flower_type || null, isGreen: !!r.is_green,
    artificialBunchesPerUnit: r.artificial_bunches_per_unit != null ? Number(r.artificial_bunches_per_unit) : null,
    artificialMapItemId: r.artificial_map_item_id || null,
    artificialMapName: r.artificial_map_name || null,
    artificialMapPrice: r.artificial_map_price != null ? Number(r.artificial_map_price) : null,
    artificialMapCost: r.artificial_map_cost != null ? Number(r.artificial_map_cost) : null,
    markup: r.markup != null ? Number(r.markup) : null,
    currentPrice: Number(r.current_price) || 0,
    priceHistory: Array.isArray(r.price_history) ? r.price_history : [],
    photoUrl: r.photo_url || null,
    colorVariants: Array.isArray(r.color_variants) ? r.color_variants : [],
  };
}

export function assembleMandiCatalogueFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(rowToMandiFlower);
}

// Legacy-shaped partial patch (as every mandi-catalogue editor call site already builds it) -> the
// DB columns it actually touches, for a plain row-level UPDATE.
export function mandiFlowerPatchToRow(patch) {
  const row = {};
  if ("name" in patch) row.name = patch.name;
  if ("flowerCat" in patch) row.flower_cat = patch.flowerCat;
  if ("unit" in patch) row.unit = patch.unit;
  if ("gattharSize" in patch) row.gatthar_size = patch.gattharSize;
  if ("flowerType" in patch) row.flower_type = patch.flowerType;
  if ("isGreen" in patch) row.is_green = patch.isGreen;
  if ("artificialBunchesPerUnit" in patch) row.artificial_bunches_per_unit = patch.artificialBunchesPerUnit;
  if ("artificialMapItemId" in patch) row.artificial_map_item_id = patch.artificialMapItemId;
  if ("artificialMapName" in patch) row.artificial_map_name = patch.artificialMapName;
  if ("artificialMapPrice" in patch) row.artificial_map_price = patch.artificialMapPrice;
  if ("artificialMapCost" in patch) row.artificial_map_cost = patch.artificialMapCost;
  if ("markup" in patch) row.markup = patch.markup;
  if ("currentPrice" in patch) row.current_price = patch.currentPrice;
  if ("priceHistory" in patch) row.price_history = patch.priceHistory;
  if ("photoUrl" in patch) row.photo_url = patch.photoUrl;
  if ("colorVariants" in patch) row.color_variants = patch.colorVariants;
  return row;
}

// Row shape for a brand-new flower insert (name, flowerCat, unit, gattharSize, flowerType, isGreen,
// artificialBunchesPerUnit, currentPrice, priceHistory, colorVariants — whichever the caller sets).
export function mandiFlowerToRow(f) {
  return {
    id: f.id, name: f.name, flower_cat: f.flowerCat || "Other", unit: f.unit || "bundle",
    gatthar_size: f.gattharSize ?? null, flower_type: f.flowerType ?? null, is_green: !!f.isGreen,
    artificial_bunches_per_unit: f.artificialBunchesPerUnit ?? null,
    current_price: Number(f.currentPrice) || 0, price_history: f.priceHistory || [],
    color_variants: f.colorVariants || [],
  };
}

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

// Σ(qty × mandi price) for one recipe size, plus Σ(qty × RAW IMS rental — no sub-category scaling
// factor) for any inventory-sourced ingredient rows ({invItemId, qty} — added via the "Artificial
// included?" toggle, or picked directly as the recipe's own ingredient with no mandi-flower
// counterpart). null when empty.
//
// Deliberately NOT priceForInvItem here: the recipe already has its OWN markup control (the
// pattern's "Markup" field, applied once by the caller via effectiveMarkup) — running the raw rate
// through the item's sub-category scaling_factor here as well would stack two independent markups
// on the same rupee. A rate_card_categories factor is the general Studio-wide multiplier for
// pricing an item on its own; a recipe ingredient is priced by the RECIPE's rules instead, which is
// why this reads item.price/rentalCost raw rather than calling priceForInvItem.
// flowerRate (optional): (recipe flower row, resolved mandi flower) → the rate to use instead of the base mandi price, or null.
// Studio passes the function's chosen colour (its 🎨 pick, else the Flower Palette's tagged variant - lib/studio/floralCost's
// effectiveColorPrefRows), so the price follows the same colour Deal Check costs the flower at.
export const computePatternSizeCost = (sizeData, mandiCatalogue, inventory, flowerRate) => {
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
    const chosen = flowerRate ? Number(flowerRate(fl, res)) || 0 : 0;
    const price = chosen > 0 ? chosen : (res ? res.price : 0);
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

// Shared by AdminSettingsTab.jsx's Recipes panel (the sole writer), IMS.jsx, and StudioApp.jsx's
// two independent settings-fetch sites. The `flower_patterns` TABLE (migration 040) is the source
// of truth now, one row per recipe — these translate between that row shape and the plain-object
// array every function in this file already expects (matchFlowerPattern, computePatternSizeCost,
// effectiveMarkup, …), so none of that cost-calc/matching logic had to change. The JS field is
// called `mode`/`studioMarkup`; the DB columns (named back in 001) are `flat_or_smb`/`markup`.
export const genFlowerPatternId = () => "FP" + Date.now() + Math.floor(Math.random() * 1000);

export function rowToFlowerPattern(r) {
  return {
    id: r.id, name: r.name, mode: r.flat_or_smb === "smb" ? "smb" : "flat",
    sub: r.sub || "", unit: r.unit || "pc", unitBasis: "per piece",
    artificialIncluded: !!r.artificial_included,
    ...(r.markup != null ? { studioMarkup: Number(r.markup) } : {}),
    sizes: (r.sizes && typeof r.sizes === "object") ? r.sizes : {},
  };
}

export function assembleFlowerPatternsFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(rowToFlowerPattern);
}

// Full-object -> row, for writing back whatever a recipe-editing mutator function produced (it
// always returns a complete pattern object, never a sparse patch).
export function flowerPatternToRow(p) {
  return {
    id: p.id, name: p.name, flat_or_smb: p.mode === "smb" ? "smb" : "flat",
    sub: p.sub || null, unit: p.unit || "pc",
    artificial_included: !!p.artificialIncluded,
    markup: p.studioMarkup ?? null,
    sizes: p.sizes || {},
  };
}

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
// flowerRate (optional): as computePatternSizeCost's - the colour chosen for the function prices its real flowers.
export const floralPatternUnitRates = (pattern, sizeKey, mandiCatalogue, settings, inventory, rcFactorByKey, flowerRate) => {
  if (!pattern) return null;
  const sizes = pattern.sizes || {};
  const sizeData = sizes[resolveSizeKey(sizes, sizeKey)];
  if (!sizeData) return null;
  const markup = effectiveMarkup(pattern, settings);
  const realRate = Math.round((computePatternSizeCost(sizeData, mandiCatalogue, inventory, flowerRate) || 0) * markup);
  const afRate = Number(settings?.artificialFlowerRatePerKg ?? 50);
  const afBPK = Number(settings?.artificialFlowerBunchesPerKg ?? 16) || 16;
  const agRate = Number(settings?.artificialGreenRatePerKg ?? 40);
  const agBPK = Number(settings?.artificialGreenBunchesPerKg ?? 23) || 23;
  const artMarkup = Number(settings?.defaultStudioMarkup ?? 3) || 3;
  let artCost = 0, mappedFinal = 0, invItemCost = 0;
  (sizeData.flowers || []).forEach((fl) => {
    if (fl?.invItemId) {
      // A direct IMS Inventory ingredient (the "Artificial included?" toggle, or picked directly as
      // the recipe's own ingredient with no mandi-flower counterpart) has no "real flower" side to
      // speak of — it's a physical rented piece, always sourced from inventory regardless of the
      // slider. Priced RAW (no rate_card_categories scaling factor — see computePatternSizeCost's
      // comment: the recipe's OWN markup field owns this ingredient's pricing, not the general
      // Studio inventory-pricing rules) and marked up by that SAME pattern markup realRate uses
      // (tracked separately so it isn't also run through artMarkup), so its contribution lands on
      // BOTH sides of the blend at the identical value — `realPct/100×X + (100-realPct)/100×X = X`
      // for any realPct, i.e. invariant to the slider instead of vanishing to ₹0 at 0% real.
      const item = (inventory || []).find((i) => i.id === fl.invItemId);
      const rawPrice = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
      invItemCost += (Number(fl?.qty) || 0) * rawPrice;
      return;
    }
    const res = resolveMandiFlower(fl?.flowerId, mandiCatalogue);
    const parent = res?.parent || null;
    const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
    if (ft === "real_only") {
      // No artificial substitute exists for this flower at all — it's bought at mandi rate
      // regardless of the element's real/artificial slider. computePatternSizeCost already counts
      // it on the real side (qty × mandi price); folding the SAME amount into invItemCost (marked
      // up by this SAME pattern markup, not artMarkup) lands it identically on both sides of the
      // blend — invariant to the slider — instead of scaling down to ₹0 as real% drops, which is
      // what returning here with no contribution used to do.
      const chosen = flowerRate ? Number(flowerRate(fl, res)) || 0 : 0;
      invItemCost += (Number(fl?.qty) || 0) * (chosen > 0 ? chosen : (res?.price || 0));
      return;
    }
    if (ft === "mapping") {
      // Artificial version is a SPECIFIC inventory item — priced off its own RAW rate (not the
      // rate_card_categories scaling factor priceForInvItem would apply — that's the general
      // Studio inventory-pricing rule, and this ingredient is priced by the RECIPE's rules instead,
      // same reasoning as the invItemId/real_only branches above) times whichever markup is higher:
      // this recipe's own (`markup`) or the global Default Studio Markup (`artMarkup`) — so a mapped
      // substitute can never undercut either configured markup, only exceed one of them. Falls back
      // to the one-time artificialMapPrice/Cost snapshot only if the mapped item can no longer be
      // found (e.g. deleted from inventory since).
      const invItem = (inventory || []).find((i) => i.id === parent?.artificialMapItemId);
      const rawRate = invItem ? (Number(invItem.price ?? invItem.rentalCost) || 0) : (Number(parent?.artificialMapPrice) || Number(parent?.artificialMapCost) || 0);
      mappedFinal += (Number(fl?.qty) || 0) * rawRate * Math.max(markup, artMarkup);
      return;
    }
    const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
    artCost += (Number(fl?.qty) || 0) * bpu * (ft === "green" ? agRate / agBPK : afRate / afBPK);
  });
  const artRate = Math.round(artCost * artMarkup) + Math.round(mappedFinal) + Math.round(invItemCost * markup);
  return { realRate, artRate, extra: Number(sizeData.extraCost) || 0 };
};

// ─── Floral content beneath a kit, at ANY nesting depth ───────────────────────────────────────
// Every consumer that needs "what floral stuff is inside this kit" — Build's own guest price
// (kitFloralCompDelta/attachedPatterns), the mandi list/actuals engine (floralCost.js), the Dept
// PDF's recipe listing (kitRecipeParts.js), Deal Check's own cost rollup — used to walk a kit's
// subItems ONE level only, each with its own independent, duplicated loop. A kit nested inside
// another kit (si.itemId resolving to a SECOND kit, which has its OWN attached recipe or its own
// florals-category component) was invisible to every one of them: not priced on the guest's bill,
// not in the mandi list, not in the Dept PDF — silently missing at every single consumer, because
// none of them ever checked whether a sub-item was itself a kit worth recursing into (owner report,
// 2026-11-13: "a lot of the times kits own items get missed by the crawl... if a kit has another
// kit, the crawlers can miss them too").
//
// This is the ONE walk now — every consumer above calls this instead of re-deriving its own copy.
// Mirrors walkKitUnits's own recursion/cycle-guard shape (lib/ims/helpers.js) but, unlike that one
// (which deliberately SKIPS patternId recipe add-ons — it's for physical/truckable items only),
// this one is specifically FOR floral content: it visits every patternId recipe add-on AND every
// florals-category physical component, at any depth, and ALSO recurses into a non-floral-category
// sub-item if THAT sub-item is itself a kit (its own category is irrelevant — only whether it has
// subItems of its own to walk).
//
// visit(node) is called once per sub-item found: { patternId, qty, size, kitParent, raw } for a
// recipe add-on, or { itemId, item, qty, size, kitParent, raw } for ANY physical component — every
// one of them, not just florals-category ones (review finding, 2026-11-13, "F3": the two existing
// consumers disagree on which categories count — floralCost.js wants florals-category components
// only, kitFloralCompDelta wants whatever its own matchFlowerPattern call succeeds on regardless of
// category — so the walker hands back every component and leaves that decision to each consumer,
// exactly like each one's own pre-existing one-level code already did). `qty` is already multiplied
// by every ancestor kit's own qty. `kitParent` is always the TOP-LEVEL kit's own name (or id, when
// unnamed), not the immediate nested parent — the thing every fold-back consumer (a zone page's own
// card, Deal Check's per-element row) actually keys on, since a nested sub-kit never gets its own
// separate row to fold into.
//
// `item` may be null (review finding, 2026-11-13, "F1": a kit deleted from the catalogue — migration
// 059 — whose per-deal edit, `overrideSubItems`, still carries a live recipe; `findInv`-style
// lookups that don't consult the deleted-catalogue snapshot resolve such a kit to nothing, but the
// override itself is real and must still be walked) — only `overrideSubItems` being a non-empty
// array can supply subItems in that case, since there is no `item.subItems` to fall back to and no
// `item.name`/`item.id` for the cycle guard or a default kitParent; the caller is expected to pass
// an explicit `_kitParent` (e.g. the zone element's own name) in that situation.
export function walkKitFloralParts(item, qty, allInventory, overrideSubItems, visit, _kitParent, _seen) {
  if (!(Number(qty) > 0)) return;
  const subItems = Array.isArray(overrideSubItems) ? overrideSubItems : (item && Array.isArray(item.subItems) ? item.subItems : []);
  if (!subItems.length) return;
  const seen = _seen ? new Set(_seen) : new Set();
  if (item?.id) { if (seen.has(item.id)) return; seen.add(item.id); } // cycle guard, same as walkKitUnits
  const kitParent = _kitParent || item?.name || item?.id;
  subItems.forEach((si) => {
    const siQty = qty * (Number(si.qty) || 0);
    if (siQty <= 0) return;
    if (si.patternId) { visit({ patternId: si.patternId, qty: siQty, size: si.size, kitParent, raw: si }); return; }
    const ci = (allInventory || []).find((i) => i.id === si.itemId);
    if (!ci) return;
    visit({ itemId: ci.id, item: ci, qty: siQty, size: si.size, kitParent, raw: si });
    // Recurse regardless of THIS node's own category — a non-floral kit (e.g. a console nested
    // inside Tree) can still carry its own attached recipe or its own floral component deeper in.
    // Gate on EITHER the master's own subItems OR the deal's subOverrides for this nested kit —
    // not subItems alone (review finding, 2026-11-13: a nested kit whose MASTER subItems is empty
    // but whose per-deal subOverrides carries a live recipe used to be silently skipped; same shape
    // as the 2026-11-12 top-level rule, just not applied at nested depth until now).
    const subOv = Array.isArray(si.subOverrides) ? si.subOverrides : undefined;
    if (subOv?.length || (Array.isArray(ci.subItems) && ci.subItems.length > 0)) {
      walkKitFloralParts(ci, siQty, allInventory, subOv, visit, kitParent, seen);
    }
  });
}

// A kit's PLAIN components ({itemId,qty} — not patternId add-ons) can themselves be floral items
// whose own sub-category carries a flower recipe. priceForInvItem counts only their FLAT RENTAL, so
// the recipe money has to be added on top of the kit's price. This returns exactly that top-up.
//
// Shared deliberately: KitComponentsEditor's footer and getElPriceFromInventory (the price actually
// charged) each used to compute this independently, and only the footer had it — so a kit header
// billed roughly half of what its own breakdown showed. One implementation, one number.
//
// The flat rental cancels out algebraically and is NOT looked up here: the editor's per-unit figure
// is `blend + extra + flatRental` and the delta is that minus `flatRental`, leaving just the recipe
// part. Don't "fix" this by adding a rental lookup — that double-counts.
//
// `comps` only walks ONE level in by itself — nested-kit recursion (walkKitFloralParts, above) is
// applied here too now, so a component that is itself a kit with its own floral component inside
// contributes its own top-up as well, not just comps' own direct entries.
export const kitFloralCompDelta = ({ comps, inventory, flowerPatterns, mandiCatalogue, floralSettings, rcFloralModeByKey, floralRatio, elSize, rcFactorByKey }) => {
  if (!Array.isArray(comps) || comps.length === 0) return 0;
  const modes = rcFloralModeByKey || {};
  const globalReal = Math.max(0, Math.min(100, 100 - (Number(floralRatio) || 0)));
  const priceComponent = (cItem, size, realPctOverride, qty) => {
    const pat = matchFlowerPattern(cItem, flowerPatterns || []);
    if (!pat) return 0;                // not a floral component — the overwhelming majority
    // A component may pin its own size; with none it inherits the element's, and a missing size
    // means "big" — the same fallback every other kit-pricing call site uses.
    const rates = floralPatternUnitRates(pat, sizeClassToPatternKey(size || elSize || "B"), mandiCatalogue || [], floralSettings || {}, inventory, rcFactorByKey);
    if (!rates) return 0;
    const sk = String(cItem.subCat || cItem.subcategory || pat.sub || "").trim().toLowerCase();
    const subMode = sk ? modes[sk] : undefined;
    const modeDefault = subMode === "real" ? 100 : subMode === "artificial" ? 0 : globalReal;
    const realPct = (typeof realPctOverride === "number" && realPctOverride >= 0 && realPctOverride <= 100) ? realPctOverride : modeDefault;
    const recipeMoney = Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra;
    return recipeMoney * (Number(qty) || 0);
  };
  const direct = comps.reduce((sum, c) => {
    if (!c || c.patternId) return sum;   // recipe add-ons are priced separately, on top
    const cItem = (inventory || []).find((i) => i.id === c.itemId);
    if (!cItem) return sum;
    return sum + priceComponent(cItem, c.size, c.realPct, c.qty);
  }, 0);
  // A NESTED kit's own floral component, any depth down — comps' own direct loop above only ever
  // sees comps' immediate entries, so a kit-inside-a-kit's own floral part needed its own walk.
  let nested = 0;
  comps.forEach((c) => {
    if (!c || c.patternId || !c.itemId) return;
    const cItem = (inventory || []).find((i) => i.id === c.itemId);
    if (!cItem) return;
    const subOv = Array.isArray(c.subOverrides) ? c.subOverrides : undefined;
    // Gate on EITHER the master's own subItems OR the deal's subOverrides (same nested-depth fix as
    // walkKitFloralParts' own recursion gate above — a nested kit with empty master subItems but a
    // live subOverrides edit must still be walked).
    if (!subOv?.length && (!Array.isArray(cItem.subItems) || !cItem.subItems.length)) return;
    walkKitFloralParts(cItem, Number(c.qty) || 0, inventory, subOv, (node) => {
      // node.raw is the SUB-ITEM's own entry at whichever depth it was found — its own realPct
      // pin (set via subOverrides) must be honoured the same way the direct loop honours c.realPct
      // above, not dropped (review finding, 2026-11-13, "F3": this used to pass undefined, always
      // falling back to the mode default regardless of a nested per-instance override).
      if (node.itemId) nested += priceComponent(node.item, node.size, node.raw?.realPct, node.qty);
      // node.patternId (a nested recipe add-on) is priced by attachedPatterns' own recursive walk,
      // not here — kitFloralCompDelta is specifically the "plain floral component" top-up.
    });
  });
  return direct + nested;
};

const RC_UNIT_LABELS = {
  sqft: "/sqft", truss_sqft: "/truss sqft", rft: "/RFT", pc: "/pc", setup: "/setup",
  trip: "/trip", event: "/event", string: "/string", included: "Included", multiplier: "× mult",
};
export const studioUnitLabel = (unitId) => RC_UNIT_LABELS[String(unitId || "").toLowerCase()] || (unitId ? `/${unitId}` : "");

// ── PIECES ↔ BUNDLES ON A SWAP ──
// How many pieces one unit of a mandi flower is: a "piece" flower is 1, any other unit (bundle, gatthar, kodi…) is its
// gattharSize ("pcs per unit" in IMS → Mandi). 0 when not set - such a quantity cannot be turned into pieces.
export const piecesPerUnit = (f) => (String(f?.unit || "").trim().toLowerCase() === "piece" ? 1 : Math.max(0, Number(f?.gattharSize) || 0));

// A quantity of one flower as the same number of PIECES of another: 50 pieces of guldavari star → talpalm at 25 pcs per
// bundle = 2 bundles. Same unit: unchanged. Different units with either pcs-per-unit unknown: unchanged, converted false -
// the caller says so rather than pass a piece count off as bundles.
export function convertFlowerQty(qty, from, to) {
  const q = Number(qty) || 0;
  const fu = String(from?.unit || "").trim().toLowerCase(), tu = String(to?.unit || "").trim().toLowerCase();
  if (!fu || !tu || fu === tu) return { qty: q, converted: true, same: true };
  const pf = piecesPerUnit(from), pt = piecesPerUnit(to);
  if (!(pf > 0) || !(pt > 0)) return { qty: q, converted: false, same: false };
  return { qty: Math.round((q * pf / pt) * 10000) / 10000, converted: true, same: false };
}

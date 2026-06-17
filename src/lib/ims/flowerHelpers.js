// Flower recipe/cost helpers (faithful to the reference IMS app).

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

const RC_UNIT_LABELS = {
  sqft: "/sqft", truss_sqft: "/truss sqft", rft: "/RFT", pc: "/pc", setup: "/setup",
  trip: "/trip", event: "/event", string: "/string", included: "Included", multiplier: "× mult",
};
export const studioUnitLabel = (unitId) => RC_UNIT_LABELS[String(unitId || "").toLowerCase()] || (unitId ? `/${unitId}` : "");

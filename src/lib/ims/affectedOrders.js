// Which booked deals a change to some planning input touches (lib/planningInputBus): the ones whose saved data names one of the
// changed rows. A deal's event order carries every id it uses - an element's invId / patternId / mandiId, a kit part's itemId,
// Planning's own rows (imsId) - so a text search of the order for the id finds it, at any depth.
//   inventory      -> orders naming the item id;
//   flower_patterns-> orders naming the recipe id;
//   mandi_flowers  -> orders naming the flower id, and orders naming any recipe that has the flower in it;
//   fixed_venues   -> orders at that venue (by its name, any function's venue).
// Only orders already synced to Planning (deptSyncedAt) - a deal never synced has no Planning snapshot to bring up to date.
export function affectedOrderIds({ changes = [], eventOrders = [], flowerPatterns = [], fixedVenues = [] }) {
  const want = new Set(), venueNames = new Set();
  const add = (id) => { if (id != null && id !== "") want.add(String(id)); };
  changes.forEach(({ table, ids = [] }) => {
    if (table === "inventory" || table === "flower_patterns") ids.forEach(add);
    else if (table === "mandi_flowers") {
      ids.forEach(add);
      const quoted = ids.map((id) => `"${id}"`);
      (flowerPatterns || []).forEach((p) => { const s = JSON.stringify(p?.sizes || {}); if (quoted.some((q) => s.includes(q))) add(p.id); });
    } else if (table === "fixed_venues") {
      ids.forEach((id) => { const v = (fixedVenues || []).find((x) => String(x?.id) === String(id)); const n = String(v?.name || "").trim().toLowerCase(); if (n) venueNames.add(n); });
    }
  });
  if (!want.size && !venueNames.size) return [];
  const quotedIds = [...want].map((id) => `"${id}"`);
  const venuesOf = (eo) => [eo?.venue, ...((Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map((f) => f?.venue || f?.fnVenue))]
    .map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  return (eventOrders || [])
    .filter((eo) => eo?.id && eo.deptSyncedAt)
    .filter((eo) => {
      if (venueNames.size && venuesOf(eo).some((v) => venueNames.has(v))) return true;
      if (!quotedIds.length) return false;
      const text = JSON.stringify(eo);
      return quotedIds.some((q) => text.includes(q));
    })
    .map((eo) => eo.id);
}

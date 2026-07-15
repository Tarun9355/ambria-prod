// Live "soft-blocking" helpers — how much of an inventory item has already been
// committed to OTHER zones/functions/cards within the SAME event/deal, so search
// boxes can warn/disable before a salesperson oversells stock that's already fully
// used a few tabs over. Complements getStudioAvailable() (pricing.js), which only
// nets against OTHER events' blocks-table commitments — it has no idea about
// sibling zones in the current deal. Combine both: remaining = max(0, otherEventsAvailable - usedElsewhereInDeal).
//
// Pure, synchronous, no Supabase calls — operates only on already-in-memory arrays.

// Build: sum qty already assigned to invId across all zones of all functions, scoped
// to targetDate (an item committed on a different calendar day doesn't starve this one —
// mirrors buildPlatformPlan's per-fnDate bucketing in this same lib).
// fns = collectAllFunctionData() output.
// exclude = { fnIdx, zoneKey, elIdx? } — omit elIdx to exclude the WHOLE zone (top-level
// "+Add element" boxes, since a zone's own rows are never "elsewhere"); supply elIdx to
// exclude only that one row (kit-component search — sibling rows in the same zone still count).
export function qtyUsedElsewhereInBuild(invId, fns, imsInventory, exclude = {}, targetDate) {
  if (!invId) return 0;
  let used = 0;
  (fns || []).forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      (elems || []).forEach((el, elIdx) => {
        const isExcluded = fnIdx === exclude.fnIdx && zk === exclude.zoneKey &&
          (exclude.elIdx == null || elIdx === exclude.elIdx);
        if (isExcluded) return;
        if (!el?.invId) return; // pattern-only / recipe rows never consume real stock
        const elQty = Number(el.qty) || 0;
        if (el.invId === invId) { used += elQty; return; }
        // kit sub-component coverage, qty-aware (comp.qty × the kit instance's own qty)
        const kitItem = (imsInventory || []).find((i) => i.id === el.invId);
        const comps = Array.isArray(el.kitOverrides) ? el.kitOverrides : (kitItem?.subItems || []);
        (comps || []).forEach((c) => { if (c.itemId === invId) used += (Number(c.qty) || 0) * elQty; });
      });
    });
  });
  return used;
}

// Deal Check: same idea over dcCards[fnIdx][cardKey] (+ card.split[] variants) and dcManualItems,
// plus kit expansion via dcKitEdits overrides.
// exclude = { fnIdx, zoneKey?, cardKey?, manualId? } — zoneKey alone excludes the whole zone
// (manual-add box); cardKey/manualId excludes just that one row (kit-component search, swap grid).
export function qtyUsedElsewhereInDealCheck(imsId, fns, dcCards, dcManualItems, dcKitEdits, inventory, exclude = {}, targetDate) {
  if (!imsId) return 0;
  let used = 0;
  (fns || []).forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    Object.entries((dcCards || {})[fnIdx] || {}).forEach(([ck, card]) => {
      const excluded = fnIdx === exclude.fnIdx &&
        ((exclude.zoneKey != null && card?.zoneKey === exclude.zoneKey && exclude.cardKey == null) ||
         (exclude.cardKey != null && ck === exclude.cardKey));
      if (excluded) return;
      const splitArr = Array.isArray(card?.split) ? card.split : null;
      if (splitArr) {
        splitArr.forEach((s) => { if (s.imsId === imsId) used += Number(s.qty) || 0; });
        return;
      }
      if (!card?.imsId) return;
      const qty = Number(card.qty) || 1;
      if (card.imsId === imsId) { used += qty; return; }
      // kit sub-component coverage
      const kitItem = (inventory || []).find((i) => i.id === card.imsId);
      if (kitItem && Array.isArray(kitItem.subItems) && kitItem.subItems.length) {
        const edited = dcKitEdits?.[fnIdx]?.[ck];
        const comps = Array.isArray(edited) ? edited : kitItem.subItems.map((s) => ({ itemId: s.itemId, qty: Number(s.qty) || 1 }));
        comps.forEach((c) => { if (c.itemId === imsId) used += (Number(c.qty) || 0) * qty; });
      }
    });
    (dcManualItems || []).filter((mi) => mi.fnIdx === fnIdx).forEach((mi) => {
      const excluded = fnIdx === exclude.fnIdx &&
        ((exclude.zoneKey != null && mi.zoneKey === exclude.zoneKey && exclude.manualId == null) ||
         (exclude.manualId != null && mi.manualId === exclude.manualId));
      if (excluded) return;
      if (mi.imsId === imsId) used += Number(mi.qty) || 1;
    });
  });
  return used;
}

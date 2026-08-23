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

// Build: full scarce-stock allocation for ONE item across the WHOLE booking (same date) — every
// row that draws on invId (its own qty, or via a kit's component) competes for the same
// otherEventsAvail units. Smallest-qty rows are granted stock FIRST, so one zone's bulk increase
// concentrates the shortfall on ITSELF instead of retroactively flagging every other zone's
// untouched, already-fine row as short too — subtracting each sibling's raw (possibly itself-
// short) qty double-counted the deficit (a zone with qty 2 against 1 available unit elsewhere
// looked short there AND made a completely separate 1-unit zone look short again, when only one
// unit total was ever actually missing). Returns the allocation for the ONE row identified by
// target = { fnIdx, zoneKey, elIdx } (a specific row, not a whole-zone exclusion — this is only
// ever called from getElPriceFromInventory's own per-row shortfall pricing).
export function allocateRowAvailability(invId, fns, imsInventory, target, targetDate, otherEventsAvail) {
  if (!invId) return { ownedQty: 0, shortQty: 0 };
  const rows = [];
  (fns || []).forEach((fn, fnIdx) => {
    if (targetDate && (fn?.fnDate || "") !== targetDate) return;
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      (elems || []).forEach((el, elIdx) => {
        if (!el?.invId) return;
        let qty = 0;
        if (el.invId === invId) {
          qty = Number(el.qty) || 0;
        } else {
          const kitItem = (imsInventory || []).find((i) => i.id === el.invId);
          const comps = Array.isArray(el.kitOverrides) ? el.kitOverrides : (kitItem?.subItems || []);
          const compQtyEach = (comps || []).reduce((s, c) => s + (c.itemId === invId ? (Number(c.qty) || 0) : 0), 0);
          qty = compQtyEach * (Number(el.qty) || 0);
        }
        if (qty > 0) rows.push({ fnIdx, zk, elIdx, qty });
      });
    });
  });
  // Array.prototype.sort is stable (spec-guaranteed) — ties keep their original relative order, so
  // the result doesn't reshuffle between renders just because two rows happen to match on qty.
  rows.sort((a, b) => a.qty - b.qty);
  let remaining = Math.max(0, Number(otherEventsAvail) || 0);
  let result = { ownedQty: 0, shortQty: 0 };
  for (const r of rows) {
    const owned = Math.min(r.qty, remaining);
    remaining -= owned;
    if (r.fnIdx === target.fnIdx && r.zk === target.zoneKey && r.elIdx === target.elIdx) {
      result = { ownedQty: owned, shortQty: r.qty - owned };
    }
  }
  return result;
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

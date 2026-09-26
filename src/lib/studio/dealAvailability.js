// Live "soft-blocking" helpers — how much of an inventory item has already been
// committed to OTHER zones/functions/cards within the SAME event/deal, so search
// boxes can warn/disable before a salesperson oversells stock that's already fully
// used a few tabs over. Complements getStudioAvailable() (pricing.js), which only
// nets against OTHER events' blocks-table commitments — it has no idea about
// sibling zones in the current deal. Combine both: remaining = max(0, otherEventsAvailable - usedElsewhereInDeal).
//
// Pure, synchronous, no Supabase calls — operates only on already-in-memory arrays.

import { walkKitUnits } from "../ims/helpers";

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
        if (elQty <= 0) return;
        // walkKitUnits (lib/ims/helpers.js) — same node-walker pricing/transport/reservation share —
        // visits el.invId itself (a plain item just matches directly, one visit) AND every
        // component recursively, so a component nested TWO levels down (a kit-inside-a-kit) is no
        // longer invisible to this check the way a one-level-only "el.kitOverrides || item.subItems"
        // scan used to leave it.
        const topItem = (imsInventory || []).find((i) => i.id === el.invId);
        if (!topItem) { if (el.invId === invId) used += elQty; return; }
        walkKitUnits(topItem, elQty, imsInventory, el.kitOverrides, (node, nodeQty) => { if (node?.id === invId) used += nodeQty; });
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
        const elQty = Number(el.qty) || 0;
        let qty = 0;
        if (elQty > 0) {
          // walkKitUnits recurses through a nested kit-inside-a-kit — see qtyUsedElsewhereInBuild's
          // own comment for why the old one-level component scan could miss a component two levels
          // down.
          const topItem = (imsInventory || []).find((i) => i.id === el.invId);
          if (!topItem) { if (el.invId === invId) qty = elQty; }
          else walkKitUnits(topItem, elQty, imsInventory, el.kitOverrides, (node, nodeQty) => { if (node?.id === invId) qty += nodeQty; });
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

// Deal Check + Build share one root cause here: once a SOLD deal's own reservation is written into
// the real `blocks` table (reconcileSoldInventoryBlocks, StudioApp.jsx), that same per-date block
// total feeds every OTHER availability check for this item/date too — so a booked deal's own held
// stock reads as competing demand from someone else, and previously-free stock starts showing
// "short" (and billing its shortfall at cost%, not the rental rate) the moment the deal itself gets
// booked. Nets this deal's own last-synced reservation (dcReservedInventory, kept in sync by
// reconcileSoldInventoryBlocks after every real write) out of the raw per-date block map before any
// getStudioAvailable() call. Mirrors StudioApp.jsx's getElPriceFromInventory, which already applies
// this fix for Build's own live availability check — DealCheckOverlay never had its own copy, so
// every getStudioAvailable() call there double-counted a sold deal's own stock against itself.
export function netOwnReservedBlocks(fnBlocks, itemId, dcReservedInventory, fnIdx) {
  const ownReserved = dcReservedInventory?.[fnIdx]?.[itemId] || 0;
  if (ownReserved <= 0) return fnBlocks || {};
  return { ...(fnBlocks || {}), [itemId]: Math.max(0, ((fnBlocks || {})[itemId] || 0) - ownReserved) };
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
      // kit sub-component coverage, recursing into kits-inside-kits
      const kitItem = (inventory || []).find((i) => i.id === card.imsId);
      if (kitItem && Array.isArray(kitItem.subItems) && kitItem.subItems.length) {
        const edited = dcKitEdits?.[fnIdx]?.[ck];
        const overrideSubItems = Array.isArray(edited) ? edited : undefined;
        walkKitUnits(kitItem, qty, inventory, overrideSubItems, (node, nodeQty) => {
          if (node?.id === imsId) used += nodeQty;
        });
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

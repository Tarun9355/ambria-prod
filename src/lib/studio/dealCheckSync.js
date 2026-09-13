// ═══ Sync Deal Check's own edits back into Build — ONGOING deals only ═══
//
// Deal Check (DealCheckOverlay.jsx) keeps its own parallel state — dcCards, dcKitEdits,
// dcManualItems — generated FROM Build's zoneElements by runDealCheckGenerate (StudioApp.jsx).
// Nothing ever wrote back the other way: swap a card's item, edit a kit's components, or add a
// manual item in Deal Check, and Build kept showing whatever was there before. While a deal is
// still being planned (not booked/sold), the two screens are meant to describe the same thing, so
// this module is the write-back half of that relationship.
//
// Once a deal is booked/sold, none of this must run — Build freezes as "what was sold to the
// guest", and Deal Check edits from that point flow through reconcileSoldInventoryBlocks (real
// inventory reservation + a Dept Ops notification) instead. The caller (DealCheckOverlay.jsx's
// sync effect) is responsible for gating on `!isSold`; nothing here checks it itself.
//
// Every function below is pure and defensive: given a zoneElements object, return either the
// EXACT SAME reference (nothing needed to change) or a new one with one delta applied. Returning
// the same reference on a no-op is not a style nicety — it is what lets the caller's effect tell
// "nothing changed" apart from "something changed" without a deep-equality pass, so the sync
// effect doesn't refire itself or fight a change the user is mid-typing.

function cloneZone(zoneElements, zoneKey, nextArr) {
  return { ...zoneElements, [zoneKey]: nextArr };
}

/** A fresh, sufficiently-unique id for a new split — persists on the card for its whole lifetime
 * (created once, reused across every re-sync/revert of that same split; a revert followed by a
 * brand new split on the same card can safely reuse a stale id too — see syncSplitToBuild, it
 * falls back to the card's own idx when no zoneElements entry currently carries the id). */
export function newSplitGroupId() {
  return "dcsplit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// A plain 1:1 swap — the card now points at a different single item. Mirrors saveAvailPick's own
// write (StudioApp.jsx) exactly, so a synced swap is indistinguishable from one made in Build.
export function syncSwapToBuild(zoneElements, parsed, pick) {
  if (!parsed || parsed.kind !== "el" || !pick?.imsId) return zoneElements;
  const arr = zoneElements[parsed.zoneKey];
  const el = Array.isArray(arr) ? arr[parsed.idx] : null;
  if (!el || el.invId === pick.imsId) return zoneElements;
  const nextArr = arr.slice();
  nextArr[parsed.idx] = {
    ...el, invId: pick.imsId, imsId: pick.imsId,
    name: pick.name || el.name, imsName: pick.name || "", imsPhoto: pick.photo || "",
  };
  return cloneZone(zoneElements, parsed.zoneKey, nextArr);
}

// dcKitEdits[fnIdx][cardKey] and el.kitOverrides are the same shape ({itemId,qty}[] /
// {patternId,qty}[]) — a direct copy. `comps` undefined/empty resets the element back to the
// kit's own default recipe, matching Deal Check's own "reset to default" action.
export function syncKitOverridesToBuild(zoneElements, parsed, comps) {
  if (!parsed || parsed.kind !== "el") return zoneElements;
  const arr = zoneElements[parsed.zoneKey];
  const el = Array.isArray(arr) ? arr[parsed.idx] : null;
  if (!el) return zoneElements;
  const has = Array.isArray(el.kitOverrides);
  const wantsReset = !Array.isArray(comps) || comps.length === 0;
  if (wantsReset && !has) return zoneElements;
  if (!wantsReset && has && JSON.stringify(el.kitOverrides) === JSON.stringify(comps)) return zoneElements;
  const nextArr = arr.slice();
  if (wantsReset) {
    const { kitOverrides, ...rest } = el; // eslint-disable-line no-unused-vars
    nextArr[parsed.idx] = rest;
  } else {
    nextArr[parsed.idx] = { ...el, kitOverrides: comps };
  }
  return cloneZone(zoneElements, parsed.zoneKey, nextArr);
}

// A manual item is OWNED by Deal Check — it has no independent life in Build, so this both
// creates it there (tagged _dcManualId for idempotent re-sync) and keeps it updated.
export function syncManualItemToBuild(zoneElements, zoneKey, manualItem, pickItem) {
  const arr = zoneElements[zoneKey] || [];
  const existingIdx = arr.findIndex((e) => e && e._dcManualId === manualItem.manualId);
  const desired = {
    invId: manualItem.imsId, imsId: manualItem.imsId,
    name: pickItem?.name || "Custom item", imsName: pickItem?.name || "",
    qty: Number(manualItem.qty) || 1, size: "",
    _dcManualId: manualItem.manualId,
  };
  if (existingIdx === -1) return cloneZone(zoneElements, zoneKey, [...arr, desired]);
  const current = arr[existingIdx];
  if (current.invId === desired.invId && current.qty === desired.qty && current.name === desired.name) return zoneElements;
  const nextArr = arr.slice();
  nextArr[existingIdx] = { ...current, ...desired };
  return cloneZone(zoneElements, zoneKey, nextArr);
}

// Removes every zoneElements entry (any zone) tagged with a manualId Deal Check no longer lists —
// i.e. the user deleted that manual block. A swapped/split element is never touched this way: it
// pre-existed as a real Build element, so removing its Deal Check CARD only means "stop tracking
// its sourcing here," not "delete the design."
function removeStaleManualEntries(zoneElements, keepManualIds) {
  let ze = zoneElements;
  Object.keys(ze).forEach((zk) => {
    const arr = ze[zk];
    if (!Array.isArray(arr)) return;
    const filtered = arr.filter((e) => !e?._dcManualId || keepManualIds.has(e._dcManualId));
    if (filtered.length !== arr.length) ze = cloneZone(ze, zk, filtered);
  });
  return ze;
}

// Split lifecycle. `groupId` is generated once (newSplitGroupId, above) when a card's split is
// first created and stored on the card itself (dcCards[..][cardKey].splitGroupId) — every
// zoneElements entry a given split produces carries the SAME groupId as `_dcSplitGroup`, which is
// how a later re-sync finds them all by scanning the zone's array instead of trusting a position
// that an earlier split (which changes array length) may already have shifted.
export function syncSplitToBuild(zoneElements, parsed, splitAlloc, groupId, inventoryCache) {
  if (!parsed || parsed.kind !== "el" || !groupId || !Array.isArray(splitAlloc) || splitAlloc.length < 2) return zoneElements;
  const arr = zoneElements[parsed.zoneKey];
  if (!Array.isArray(arr)) return zoneElements;
  const memberIdxs = [];
  arr.forEach((e, i) => { if (e && e._dcSplitGroup === groupId) memberIdxs.push(i); });
  const base = memberIdxs.length ? arr[memberIdxs[0]] : arr[parsed.idx];
  if (!base) return zoneElements;
  // Unchanged? Compare the existing group's members (or the single original) against the desired
  // allocation before touching anything.
  const nameFor = (imsId) => (inventoryCache || []).find((i) => i.id === imsId)?.name || base.name;
  const desired = splitAlloc.map((a) => ({ invId: a.imsId, qty: Number(a.qty) || 0 }));
  const currentMembers = memberIdxs.map((i) => ({ invId: arr[i].invId, qty: arr[i].qty }));
  if (currentMembers.length === desired.length && currentMembers.every((m, i) => m.invId === desired[i].invId && m.qty === desired[i].qty)) {
    return zoneElements;
  }
  const nextEntries = splitAlloc.map((a) => {
    const nm = nameFor(a.imsId);
    return { ...base, invId: a.imsId, imsId: a.imsId, name: nm, imsName: nm, qty: Number(a.qty) || 0, _dcSplitGroup: groupId };
  });
  let nextArr;
  if (memberIdxs.length) {
    nextArr = arr.filter((_, i) => !memberIdxs.includes(i));
    nextArr.splice(memberIdxs[0], 0, ...nextEntries);
  } else {
    nextArr = arr.slice();
    nextArr.splice(parsed.idx, 1, ...nextEntries);
  }
  return cloneZone(zoneElements, parsed.zoneKey, nextArr);
}

// Collapses every entry tagged with `groupId` back into ONE element (summed qty, `_dcSplitGroup`
// dropped) — Deal Check's "use single item" action. `identity` ({imsId,name}), when given, is the
// card's own pre-split item — "use single item" means go back to being THAT item, not whichever
// split line happened to occupy the first position. Applying it here, in the same step as the
// collapse, avoids a second lookup by the card's now-stale original array index.
export function revertSplitToSingle(zoneElements, zoneKey, groupId, identity) {
  const arr = zoneElements[zoneKey];
  if (!Array.isArray(arr)) return zoneElements;
  const memberIdxs = [];
  arr.forEach((e, i) => { if (e && e._dcSplitGroup === groupId) memberIdxs.push(i); });
  if (!memberIdxs.length) return zoneElements;
  const members = memberIdxs.map((i) => arr[i]);
  const totalQty = members.reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const { _dcSplitGroup, ...collapsedBase } = members[0]; // eslint-disable-line no-unused-vars
  const finalInvId = identity?.imsId || collapsedBase.invId;
  const finalName = identity?.name || collapsedBase.name;
  const collapsed = { ...collapsedBase, invId: finalInvId, imsId: finalInvId, name: finalName, imsName: finalName, qty: totalQty };
  const nextArr = arr.filter((_, i) => !memberIdxs.includes(i));
  nextArr.splice(memberIdxs[0], 0, collapsed);
  return cloneZone(zoneElements, zoneKey, nextArr);
}

/**
 * The entry point: reconciles one function's dcCards/dcKitEdits/dcManualItems into its
 * zoneElements. Returns `zoneElements` UNCHANGED (same reference) if nothing needed to move.
 * Never throws — any internal error is logged and the input is returned untouched, so a bug in
 * here can never leave a build half-applied.
 *
 * @param {object} zoneElements  this function's current zoneElements ({zoneKey: el[]})
 * @param {object} cardsForFn    dcCards[fnIdx] ({cardKey: card})
 * @param {object} kitEditsForFn dcKitEdits[fnIdx] ({cardKey: comps[]})
 * @param {Array}  manualItemsForFn  dcManualItems filtered to this fnIdx
 * @param {Array}  inventoryCache  dcInventoryCache — only needed to name a split's new entries
 * @param {Function} parseCardKey  the same parser DealCheckOverlay.jsx already uses (ctx-provided)
 */
export function reconcileDealCheckIntoBuild(zoneElements, cardsForFn, kitEditsForFn, manualItemsForFn, inventoryCache, parseCardKey) {
  try {
    let ze = zoneElements || {};
    const cards = cardsForFn || {};
    // Group el-kind cards by zone, processed within a zone from the highest idx down: a split
    // splices (changing that zone's array length from its position onward), so working
    // high-to-low means a lower idx this same pass still needs to read is never invalidated by an
    // earlier (in processing order) splice at a higher one. fl:: (floral hard-prop) cards are
    // excluded outright — Build's floral elements carry no per-prop-type invId field to sync into.
    const byZone = {};
    Object.keys(cards).forEach((cardKey) => {
      const parsed = parseCardKey(cardKey);
      if (!parsed || parsed.kind !== "el") return;
      (byZone[parsed.zoneKey] || (byZone[parsed.zoneKey] = [])).push({ cardKey, parsed, card: cards[cardKey] });
    });
    Object.values(byZone).forEach((list) => {
      list.sort((a, b) => b.parsed.idx - a.parsed.idx);
      list.forEach(({ cardKey, parsed, card }) => {
        if (!card) return;
        const splitArr = Array.isArray(card.split) ? card.split.filter((s) => s && s.imsId && (Number(s.qty) || 0) > 0) : [];
        if (splitArr.length >= 2 && card.splitGroupId) {
          ze = syncSplitToBuild(ze, parsed, splitArr, card.splitGroupId, inventoryCache);
        } else if (card.splitGroupId) {
          // Had a split at some point but no longer does — reverted via "use single item", or
          // dropped below 2 valid allocations. Collapse whatever entries still carry that group
          // id back into the card's own (pre-split) item in one step — see revertSplitToSingle's
          // own comment on why identity correction happens there, not via a second, idx-based swap.
          ze = revertSplitToSingle(ze, parsed.zoneKey, card.splitGroupId, card.imsId ? { imsId: card.imsId, name: card.imsName } : null);
        } else if (card.imsId) {
          ze = syncSwapToBuild(ze, parsed, { imsId: card.imsId, name: card.imsName });
          ze = syncKitOverridesToBuild(ze, parsed, kitEditsForFn?.[cardKey]);
        }
      });
    });
    (manualItemsForFn || []).forEach((mi) => {
      const pickItem = (inventoryCache || []).find((i) => i.id === mi.imsId);
      ze = syncManualItemToBuild(ze, mi.zoneKey, mi, pickItem);
    });
    ze = removeStaleManualEntries(ze, new Set((manualItemsForFn || []).map((mi) => mi.manualId)));
    return ze;
  } catch (err) {
    console.error("[dealCheckSync] reconcile failed — Build left untouched:", err);
    return zoneElements;
  }
}

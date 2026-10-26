// What happens to a Build element when an item is picked for it in the availability picker. Moved out of StudioApp's saveAvailPick
// unchanged, so the single pick and the new "choices" pick (several designs in order) share ONE rule for swapping an element's item.
//
//   el          the element ({ invId, name, unit, qty, baseInvId, swappedFrom, imsId… })
//   selectedId  the picked item's id (falsy = the pin is being cleared)
//   pick        the picked item as the picker lists it ({ id, name, photo, unit, free… })
//   items       the picker's whole list (to see whether the element's ORIGINAL item had anything free)
export function elementAfterPick(el, selectedId, pick, items) {
  // Swap marker (owner ask): the element's ORIGINAL item — the one it came with, kept across repeat swaps — had nothing free, so this is a
  // like-for-like swap within the same sub-category (the picker only ever lists that sub-category). Build shows its price in orange.
  // Picking the original back, or picking while the original is still free, drops it.
  //
  // baseInvId (not just swappedFrom||invId) tracks the TRUE original stably across a VOLUNTARY swap too — one made while the original still
  // had stock (e.g. swapping on purpose to claim a cross-function reuse discount), which never sets swappedFrom on its own. It is captured
  // once (on the first-ever pick through this picker) and carried forward untouched on every later pick, so later swaps always check the
  // REAL original's own availability, not an intermediate stand-in's.
  const baseInvId = el.baseInvId || el.invId;
  const orig = (items || []).find((i) => i.id === baseInvId);
  const backToOriginal = !!selectedId && selectedId === baseInvId;
  const isSwap = !!(selectedId && pick && baseInvId && !backToOriginal && orig && orig.free <= 0);
  // The picked item's own unit was never carried over once: the element kept whatever unit/qty the PREVIOUS item needed. Harmless within the
  // same unit, silently wrong across a unit change (a 20kg fabric swapped for a 1-piece item kept reading "need 20"). When the unit genuinely
  // changes, qty/baseQty reset to 1.
  const newUnit = pick?.unit || el.unit;
  const unitChanged = selectedId && pick && newUnit !== el.unit;
  const next = (selectedId && pick)
    ? {
        ...el, invId: selectedId, name: pick.name || el.name, imsId: selectedId, imsName: pick.name || "", imsPhoto: pick.photo || "",
        unit: newUnit,
        ...(unitChanged ? { qty: 1, baseQty: 1 } : null),
        ...(backToOriginal
          ? { swappedFrom: undefined, baseInvId: undefined }
          : { baseInvId, swappedFrom: isSwap ? baseInvId : el.swappedFrom }),
      }
    : (() => { const e = { ...el }; delete e.imsId; delete e.imsName; delete e.imsPhoto; delete e.swappedFrom; delete e.baseInvId; return e; })();
  if (!next.swappedFrom) delete next.swappedFrom;
  if (!next.baseInvId) delete next.baseInvId;
  // Choices (overlays / cushion covers, lib/studio/elementPrefs.js) belong to the item they started from: swapping the element to another item
  // is a fresh decision, and the old list must not come back to life if the first item is picked again later.
  if (Array.isArray(next.prefs) && String(next.prefs[0]?.id) !== String(next.invId)) delete next.prefs;
  return next;
}

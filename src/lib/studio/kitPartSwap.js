// Swap one part inside a kit element for another inventory item - the pre-Sold gate's Fix for a short kit part (Pearl Mala inside a
// Console): the gate opens the picker on the PART, and the pick lands in the element's own kitOverrides, exactly as Build's kit
// breakdown 📦 does it, at whatever depth the part sits (a nested kit's subOverrides). The kit's master recipe is never touched.

// The comps list a kit uses for one instance: its own overrides, else the master recipe in the same shape KitComponentsEditor builds.
export function kitComps(item, overrides) {
  if (Array.isArray(overrides)) return overrides;
  return Array.isArray(item?.subItems)
    ? item.subItems.map((s) => (s.patternId ? { patternId: s.patternId, qty: Number(s.qty) || 1, realPct: s.realPct, size: s.size } : { itemId: s.itemId, qty: Number(s.qty) || 1 }))
    : [];
}

// Next overrides with every comp of `partId` turned into `newId`, or null when the part is not in this kit.
export function swapKitPart(kitItem, overrides, partId, newId, allInventory, _seen) {
  if (!kitItem || !partId || !newId) return null;
  const seen = new Set(_seen || []);
  if (kitItem.id) { if (seen.has(kitItem.id)) return null; seen.add(kitItem.id); }
  let hit = false;
  const next = kitComps(kitItem, overrides).map((c) => {
    if (c.patternId) return c;
    if (c.itemId === partId) { hit = true; const { subOverrides: _drop, ...rest } = c; return { ...rest, itemId: newId }; }
    const sub = (allInventory || []).find((i) => i.id === c.itemId);
    if (!(Array.isArray(sub?.subItems) && sub.subItems.length)) return c;
    const subNext = swapKitPart(sub, Array.isArray(c.subOverrides) ? c.subOverrides : undefined, partId, newId, allInventory, seen);
    if (!subNext) return c;
    hit = true;
    return { ...c, subOverrides: subNext };
  });
  return hit ? next : null;
}

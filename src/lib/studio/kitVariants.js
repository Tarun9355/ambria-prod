// More than one kit for the same inventory item (owner ask: a Console Table or a Coffee Table dressed four different ways). The item's
// own subItems stay its default kit - "Kit 1", what every element starts with and what the item is priced and blocked at - and the
// other kits ride on the item as altKits: [{ id, name, subItems }] (the inventory row's flags JSONB, lib/inventory/adapter.js).
// Build's Exchange Kit loads a kit into one element's kitOverrides, the per-element parts list Build, Deal Check, the blocks and
// IMS already follow, so the whole kit is replaced in one go and the master kits are never touched. An item with one kit has no
// altKits and works exactly as before.

export const DEFAULT_KIT_ID = "default";

// A kit's parts in the shape a kit instance uses (KitComponentsEditor / kitOverrides).
export function normKitParts(subItems) {
  return (Array.isArray(subItems) ? subItems : [])
    .filter((s) => s && (s.itemId || s.patternId))
    .map((s) => (s.patternId
      ? { patternId: s.patternId, qty: Number(s.qty) || 1, ...(s.realPct != null ? { realPct: s.realPct } : {}), ...(s.size ? { size: s.size } : {}) }
      : { itemId: s.itemId, qty: Number(s.qty) || 1 }));
}

// Every kit of an item, the default first: [{ id, name, subItems }]. Empty for an item that is not a kit.
export function kitVariants(item) {
  if (!item || !(Array.isArray(item.subItems) && item.subItems.length)) return [];
  const alts = (Array.isArray(item.altKits) ? item.altKits : [])
    .filter((k) => k && k.id && k.id !== DEFAULT_KIT_ID && normKitParts(k.subItems).length)
    .map((k, i) => ({ id: String(k.id), name: String(k.name || "").trim() || `Kit ${i + 2}`, subItems: k.subItems }));
  return [{ id: DEFAULT_KIT_ID, name: String(item.kitName || "").trim() || "Kit 1", subItems: item.subItems }, ...alts];
}

// Whether Build offers Exchange Kit for this item: only when there is a second kit to switch to.
export function hasKitChoice(item) {
  return kitVariants(item).length > 1;
}

// The element with the chosen kit in place of whatever parts it had - never merged with them. The default kit clears the overrides,
// so the element follows the master recipe again (later edits to Kit 1 in IMS reach it, as they always did).
export function elementWithKit(el, item, kitId) {
  const kit = kitVariants(item).find((k) => k.id === kitId);
  if (!el || !kit) return el;
  const { kitOverrides: _ov, kitId: _id, ...rest } = el;
  if (kit.id === DEFAULT_KIT_ID) return rest;
  return { ...rest, kitOverrides: normKitParts(kit.subItems), kitId: kit.id };
}

// The kit an element is on: its saved kitId while that kit still exists, the default when it has no parts list of its own, else null
// (a parts list edited by hand, or a kit since removed in IMS).
export function currentKitId(el, item) {
  const kits = kitVariants(item);
  if (!kits.length || !el) return null;
  // No parts list of its own means the master (a reset in the kit breakdown clears the list, not the kitId).
  if (!Array.isArray(el.kitOverrides)) return DEFAULT_KIT_ID;
  return el.kitId && kits.some((k) => k.id === el.kitId) ? el.kitId : null;
}

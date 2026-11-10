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
  const { kitOverrides: _ov, kitId: _id, kitCustom: _c, kitLive: _l, ...rest } = el;
  if (kit.id === DEFAULT_KIT_ID) return rest;
  // kitLive: the parts follow the kit in IMS from now on (syncElementKit)
  return { ...rest, kitOverrides: normKitParts(kit.subItems), kitId: kit.id, kitLive: true };
}

// The kit an element is on: its saved kitId while that kit still exists, the default when it has no parts list of its own, else null
// (a parts list edited by hand, or a kit since removed in IMS).
export function currentKitId(el, item) {
  const kits = kitVariants(item);
  if (!kits.length || !el) return null;
  // No parts list of its own means the master (a reset in the kit breakdown clears the list, not the kitId).
  if (!Array.isArray(el.kitOverrides)) return DEFAULT_KIT_ID;
  if (el.kitCustom) return null;
  return el.kitId && kits.some((k) => k.id === el.kitId) ? el.kitId : null;
}

// ── Live kits (owner ask 2026-11-10) ──────────────────────────────────────────────────────────────────────────────────────────
// A kit picked in Build follows IMS: when its parts are edited in IMS → Inventory, every unsold deal on that kit takes the new
// parts. A deal that changed a kit's parts by hand (the 📦 breakdown, the Sold gate's Fix, Deal Check's kit editor) keeps its own
// list - kitCustom marks it. Kit 1 never needed this: an element on it has no parts list of its own and reads the master live.

// The element marked as holding its own, hand-edited parts list. A list put back to empty (a reset) is the default kit again.
export function markKitCustom(el) {
  if (!el) return el;
  if (!Array.isArray(el.kitOverrides)) { const { kitId: _k, kitCustom: _c, kitLive: _l, ...rest } = el; return rest; }
  if (!el.kitId) return el;
  const { kitLive: _l, ...rest } = el;
  return { ...rest, kitCustom: true };
}

// The element brought in line with its kit in IMS, or null when nothing changes:
// - on a kit other than Kit 1 picked since live kits (kitLive), not edited by hand since: its parts become the kit's current parts;
// - that kit since removed in IMS: back on Kit 1 (removed: the kit's name is lost with it, so the caller says "a kit was removed").
// A kit picked before live kits has no kitLive: whether its parts were edited by hand cannot be told, so it is left as it is until
// the kit is picked again. Returns { el, removed }.
export function syncElementKit(el, item) {
  if (!el || !item || el.kitLive !== true || !el.kitId || el.kitId === DEFAULT_KIT_ID || el.kitCustom || !Array.isArray(el.kitOverrides)) return null;
  const kits = kitVariants(item);
  if (!kits.length) return null; // the item is not a kit any more - leave the element as it is
  const kit = kits.find((k) => k.id === el.kitId);
  if (!kit) { const { kitOverrides: _o, kitId: _k, kitCustom: _c, kitLive: _l, ...rest } = el; return { el: rest, removed: true }; }
  const parts = normKitParts(kit.subItems);
  if (JSON.stringify(parts) === JSON.stringify(el.kitOverrides)) return null;
  return { el: { ...el, kitOverrides: parts }, removed: false };
}

// The kits Build's Exchange Kit offers for an element: every kit of every kit item in the same sub-category (one Console Table can
// be swapped for any Console Table's kit), the element's own item first, then the others by name. [{ item, kit }].
const subCatKey = (it) => String(it?.subCat || it?.subcategory || "").trim().toLowerCase();
export function kitPool(item, inventory) {
  if (!item) return [];
  const own = kitVariants(item).map((kit) => ({ item, kit }));
  const sc = subCatKey(item);
  if (!sc) return own;
  const others = (inventory || [])
    .filter((it) => it && it.id !== item.id && subCatKey(it) === sc && kitVariants(it).length)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .flatMap((it) => kitVariants(it).map((kit) => ({ item: it, kit })));
  return [...own, ...others];
}

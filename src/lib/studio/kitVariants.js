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
// `source` is the item the kit belongs to - another item of the sub-category (Iron Console's kit on a Wooden Console). The element
// stays its own item (owner ask 2026-11-11: Exchange Kit swaps the parts, never the console); only its parts become that kit's, and
// kitFrom names where they came from so live updates follow that kit.
export function elementWithKit(el, item, kitId, source) {
  const src = source || item;
  const kit = kitVariants(src).find((k) => k.id === kitId);
  if (!el || !kit) return el;
  const { kitOverrides: _ov, kitId: _id, kitCustom: _c, kitLive: _l, kitFrom: _f, ...rest } = el;
  const own = !item || !src || src.id === item.id;
  if (own && kit.id === DEFAULT_KIT_ID) return rest;
  // kitLive: the parts follow the kit in IMS from now on (syncElementKit)
  return { ...rest, kitOverrides: normKitParts(kit.subItems), kitId: kit.id, ...(own ? null : { kitFrom: src.id }), kitLive: true };
}

// The kit an element is on: its saved kitId while that kit still exists, the default when it has no parts list of its own, else null
// (a parts list edited by hand, or a kit since removed in IMS). Its own item's kits only - a kit from another item is currentKit's.
export function currentKitId(el, item) {
  const kits = kitVariants(item);
  if (!kits.length || !el) return null;
  // No parts list of its own means the master (a reset in the kit breakdown clears the list, not the kitId).
  if (!Array.isArray(el.kitOverrides)) return DEFAULT_KIT_ID;
  if (el.kitCustom || el.kitFrom) return null;
  return el.kitId && kits.some((k) => k.id === el.kitId) ? el.kitId : null;
}

// The kit an element is on, wherever it came from: { item (the kit's own item), kit } or null for an edited / removed kit.
// lookup(id) finds an inventory item.
export function currentKit(el, item, lookup) {
  if (!el || !item) return null;
  if (!el.kitFrom || el.kitFrom === item.id) {
    const id = currentKitId(el, item);
    const kit = id ? kitVariants(item).find((k) => k.id === id) : null;
    return kit ? { item, kit } : null;
  }
  if (el.kitCustom || !Array.isArray(el.kitOverrides)) return null;
  const src = typeof lookup === "function" ? lookup(el.kitFrom) : null;
  const kit = src ? kitVariants(src).find((k) => k.id === el.kitId) : null;
  return kit ? { item: src, kit } : null;
}

// ── Live kits (owner ask 2026-11-10) ──────────────────────────────────────────────────────────────────────────────────────────
// A kit picked in Build follows IMS: when its parts are edited in IMS → Inventory, every unsold deal on that kit takes the new
// parts. A deal that changed a kit's parts by hand (the 📦 breakdown, the Sold gate's Fix, Deal Check's kit editor) keeps its own
// list - kitCustom marks it. Kit 1 never needed this: an element on it has no parts list of its own and reads the master live.

// The element marked as holding its own, hand-edited parts list. A list put back to empty (a reset) is the default kit again.
export function markKitCustom(el) {
  if (!el) return el;
  if (!Array.isArray(el.kitOverrides)) { const { kitId: _k, kitCustom: _c, kitLive: _l, kitFrom: _f, ...rest } = el; return rest; }
  if (!el.kitId) return el;
  const { kitLive: _l, ...rest } = el;
  return { ...rest, kitCustom: true };
}

// The element brought in line with its kit in IMS, or null when nothing changes:
// - on a kit other than Kit 1 picked since live kits (kitLive), not edited by hand since: its parts become the kit's current parts;
// - that kit since removed in IMS: back on Kit 1 (removed: the kit's name is lost with it, so the caller says "a kit was removed").
// A kit picked before live kits has no kitLive: whether its parts were edited by hand cannot be told, so it is left as it is until
// the kit is picked again. A kit taken from another item (kitFrom) follows that item's kit; lookup(id) finds it.
// Returns { el, removed }.
export function syncElementKit(el, item, lookup) {
  if (!el || !item || el.kitLive !== true || !el.kitId || el.kitCustom || !Array.isArray(el.kitOverrides)) return null;
  const fromOther = !!el.kitFrom && el.kitFrom !== item.id;
  if (!fromOther && el.kitId === DEFAULT_KIT_ID) return null;
  const src = fromOther ? (typeof lookup === "function" ? lookup(el.kitFrom) : undefined) : item;
  if (fromOther && src === undefined && typeof lookup !== "function") return null; // nothing to look it up in
  const kits = kitVariants(src);
  if (!fromOther && !kits.length) return null; // the item is not a kit any more - leave the element as it is
  const kit = kits.find((k) => k.id === el.kitId);
  if (!kit) { const { kitOverrides: _o, kitId: _k, kitCustom: _c, kitLive: _l, kitFrom: _f, ...rest } = el; return { el: rest, removed: true }; }
  const parts = normKitParts(kit.subItems);
  if (JSON.stringify(parts) === JSON.stringify(el.kitOverrides)) return null;
  return { el: { ...el, kitOverrides: parts }, removed: false };
}

// The kit of the sub-category a parts list is exactly - a picked kit, not a hand edit - so the kit breakdown can name it ("Iron
// Console · Kit 1") instead of calling it "edited". { item, kit, label } or null. label leaves out the item when it is the element's own.
export function matchKit(parts, item, inventory) {
  if (!Array.isArray(parts) || !item) return null;
  const sig = JSON.stringify(normKitParts(parts));
  const hit = kitPool(item, inventory).find((p) => JSON.stringify(normKitParts(p.kit.subItems)) === sig);
  return hit ? { ...hit, label: hit.item.id === item.id ? hit.kit.name : `${hit.item.name} · ${hit.kit.name}` } : null;
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

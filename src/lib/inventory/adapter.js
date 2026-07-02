// ─── Inventory adapter ────────────────────────────────────────────────────────
// The reference IMS app stored each item as a rich "superset" object (dual field
// names: cat/category, subCat/subcategory, type/tier, qty/qtyOwned, price/rentalCost,
// loc/location, plus dims_LxWxH, printable_LxW, size, subItems, source, and assorted
// `_`-prefixed migration flags). Our Supabase `inventory` table uses discrete
// snake_case columns. This module maps between the two so the InventoryTab component
// can stay a faithful copy while persistence stays relational + row-level.

const num = (v) => Number(v) || 0;

// Keys we map to dedicated columns; everything else `_`-prefixed (+ a few extras) is
// stashed in the `flags` JSONB so no superset data is lost on round-trip.
const FLAG_EXTRAS = ["source", "usageChargePct", "tier", "kitBase"];

// DB row (snake_case) → component item (camelCase superset).
export function rowToItem(row) {
  if (!row) return null;
  const dims = row.dims || {};
  const flags = row.flags || {};
  const item = {
    id: row.id,
    code: row.code || "",
    name: row.name || "",
    cat: row.cat || "", category: row.cat || "",
    subCat: row.sub_cat || "", subcategory: row.sub_cat || "",
    itemClass: row.item_class || "discrete",
    type: row.type || "Budgeted", tier: row.type || "Budgeted",
    unit: row.unit || "Piece",
    qty: row.qty || 0, qtyOwned: row.qty || 0,
    blocked: row.blocked || 0,
    price: row.price || 0, rentalCost: row.price || 0,
    cost: row.cost || 0,
    breakagePct: row.breakage_pct || 0,
    loc: row.location || "", location: row.location || "",
    img: row.img || "",
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    dims_LxWxH: dims.lxwxh || null,
    printable_LxW: dims.printable || null,
    size: dims.size || "",
    baseColour: row.base_colour || "",
    paintCost: row.paint_cost || 0,
    subItems: Array.isArray(row.sub_items) ? row.sub_items : [],
    notes: row.notes || "",
  };
  // Restore extras + `_`-prefixed migration flags from the flags JSONB.
  for (const [k, v] of Object.entries(flags)) {
    if (v === undefined || v === null) continue;
    item[k] = v;
  }
  return item;
}

// Component item (camelCase superset) → DB row (snake_case columns).
export function itemToRow(item, updatedBy = null) {
  const flags = {};
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith("_") && v !== undefined) flags[k] = v;
  }
  for (const k of FLAG_EXTRAS) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== "") flags[k] = item[k];
  }
  return {
    id: item.id,
    code: item.code || null,
    name: item.name || "",
    cat: item.cat ?? item.category ?? null,
    sub_cat: item.subCat ?? item.subcategory ?? null,
    item_class: item.itemClass || "discrete",
    type: item.type ?? item.tier ?? "Budgeted",
    unit: item.unit || "Piece",
    qty: num(item.qty ?? item.qtyOwned),
    blocked: num(item.blocked),
    price: num(item.price ?? item.rentalCost),
    cost: num(item.cost),
    breakage_pct: num(item.breakagePct),
    location: item.loc ?? item.location ?? null,
    img: item.img || null,
    photo_urls: Array.isArray(item.photoUrls) ? item.photoUrls : item.img ? [item.img] : [],
    dims: {
      lxwxh: item.dims_LxWxH || null,
      printable: item.printable_LxW || null,
      size: item.size || "",
    },
    base_colour: item.baseColour || null,
    paint_cost: num(item.paintCost),
    is_kit: Array.isArray(item.subItems) && item.subItems.length > 0,
    sub_items: Array.isArray(item.subItems) ? item.subItems : [],
    notes: item.notes || null,
    flags,
    updated_by: updatedBy,
  };
}

// Diff two item arrays into the row-level Supabase ops needed to reconcile them.
// Honors CLAUDE.md rule #1 (never save the whole table) — we write only changed rows.
export function diffInventory(prev, next, deletedIds = [], updatedBy = null) {
  const prevMap = new Map(prev.map((i) => [i.id, i]));
  const nextMap = new Map(next.map((i) => [i.id, i]));
  const upserts = [];
  for (const it of next) {
    const before = prevMap.get(it.id);
    const row = itemToRow(it, updatedBy);
    if (!before) { upserts.push(row); continue; }
    const beforeRow = itemToRow(before, updatedBy);
    if (JSON.stringify(beforeRow) !== JSON.stringify(row)) upserts.push(row);
  }
  const deletes = new Set(deletedIds || []);
  for (const id of prevMap.keys()) if (!nextMap.has(id)) deletes.add(id);
  // Never delete something still present in the next state.
  const realDeletes = [...deletes].filter((id) => !nextMap.has(id));
  return { upserts, deletes: realDeletes };
}

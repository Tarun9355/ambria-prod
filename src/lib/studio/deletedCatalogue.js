// A catalogue row deleted in IMS (inventory item, flower recipe, carpet/print material, platform
// height) no longer resolves anywhere live — but migration 059's `deleted_catalogue` snapshot table
// keeps its last known shape around, so a Studio quote that already referenced it can keep pricing
// at that frozen rate instead of silently dropping to ₹0 (owner decision: keep the price, warn in
// Build, never block the IMS-side delete). Pure data-shaping only — no React, no Supabase calls; the
// caller fetches `deleted_catalogue` rows itself (via fetchAll) and hands them to
// assembleDeletedCatalogue.
//
// Live data always wins: every helper here only ever fills a gap a live lookup already missed, so a
// re-added id (same id reused for a new row) resolves to the live one again with no special casing.

import { rowToItem } from "../inventory/adapter";
import { rowToFlowerPattern } from "../ims/flowerHelpers";
import { walkKitUnits } from "../ims/helpers";
import { assembleCarpetMaterialsFromRows, assemblePrintMaterialsFromRows, assemblePlatformRatesFromRows } from "./taxonomy";

export const DELETED_CATALOGUE_TABLE = "deleted_catalogue";

export const EMPTY_DELETED_CATALOGUE = Object.freeze({
  inventoryById: new Map(),
  patternsById: new Map(),
  carpetMaterials: [],
  printMaterials: [],
  platformRates: [],
});

// `row.data` is `to_jsonb(old)` from whichever source table — the exact same raw-row shape each
// table's own live loader already translates (rowToItem/rowToFlowerPattern/assemble*FromRows), so
// those are reused verbatim rather than re-deriving a second, divergent translation here.
// Stamped fields use `catalogueDeleted`/`catalogueDeletedAt` — deliberately NOT an underscore-
// prefixed key (itemToRow copies `_*` keys into a `flags` bucket on save, which these entries are
// never saved through, but colliding with that convention would be confusing) and not a bare
// `deleted` (too generic, too easy to collide with some other flag down the line).
export function assembleDeletedCatalogue(rows) {
  const inventoryById = new Map();
  const patternsById = new Map();
  const carpetMaterials = [];
  const printMaterials = [];
  const platformRates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.data || !row.source_table) continue;
    const deletedAt = row.deleted_at || null;
    switch (row.source_table) {
      case "inventory": {
        const item = rowToItem(row.data);
        if (!item?.id) break;
        item.catalogueDeleted = true;
        item.catalogueDeletedAt = deletedAt;
        inventoryById.set(item.id, item);
        break;
      }
      case "flower_patterns": {
        const pattern = rowToFlowerPattern(row.data);
        if (!pattern?.id) break;
        pattern.catalogueDeleted = true;
        pattern.catalogueDeletedAt = deletedAt;
        patternsById.set(pattern.id, pattern);
        break;
      }
      case "carpet_materials": {
        const [mat] = assembleCarpetMaterialsFromRows([row.data]);
        if (!mat?.id) break;
        mat.catalogueDeleted = true;
        mat.catalogueDeletedAt = deletedAt;
        carpetMaterials.push(mat);
        break;
      }
      case "print_materials": {
        const [mat] = assemblePrintMaterialsFromRows([row.data]);
        if (!mat?.id) break;
        mat.catalogueDeleted = true;
        mat.catalogueDeletedAt = deletedAt;
        printMaterials.push(mat);
        break;
      }
      case "platform_rates": {
        const [rate] = assemblePlatformRatesFromRows([row.data]);
        if (!rate?.key) break;
        rate.catalogueDeleted = true;
        rate.catalogueDeletedAt = deletedAt;
        platformRates.push(rate);
        break;
      }
      default:
        break; // unrecognized source_table — skip rather than throw
    }
  }
  return { inventoryById, patternsById, carpetMaterials, printMaterials, platformRates };
}

// A live rate-list array (carpet/print/platform) plus the deleted snapshot's own list for the same
// kind, live entries winning on a shared id. `idKey` is "id" for carpet/print, "key" for platform.
export function withDeletedRates(live, deletedList, idKey) {
  const liveArr = Array.isArray(live) ? live : [];
  const extra = Array.isArray(deletedList) ? deletedList : [];
  return [...liveArr, ...extra.filter((d) => !liveArr.some((l) => l[idKey] === d[idKey]))];
}

// Same idea for inventory, where the deleted side is a Map (assembleDeletedCatalogue's shape) and
// the live side is the plain imsInventory array. For PRICE-LOOKUP-BY-ID ONLY — never iterate the
// result for a picker/search/kitPool, or a deleted item would reappear as pickable.
export function withDeletedInventory(live, inventoryById) {
  const liveArr = Array.isArray(live) ? live : [];
  const extra = inventoryById instanceof Map ? [...inventoryById.values()] : [];
  return [...liveArr, ...extra.filter((d) => !liveArr.some((l) => l.id === d.id))];
}

// Every deleted part beneath a kit element: a nested component (at any depth) whose snapshot carries
// catalogueDeleted. `invForPricing` must be the merged (live + deleted) inventory list —
// walkKitUnits needs to find a deleted nested component by id to keep walking past it at all.
// The recipe branch below (si.patternId) is now permanently a no-op: `patternLookup` (StudioApp.jsx's
// patternById) is live-only since a deleted flower pattern is gone everywhere (owner decision,
// 2026-11-12), so it never returns a catalogueDeleted-flagged pattern anymore — kept rather than
// stripped out since callers still pass a real `patternLookup` function here.
export function deletedKitParts(item, invForPricing, overrideSubItems, patternLookup) {
  const names = new Set();
  if (!item) return [];
  if (Array.isArray(item.subItems) && item.subItems.length > 0) {
    walkKitUnits(item, 1, invForPricing, overrideSubItems, (node) => {
      if (node.id !== item.id && node.catalogueDeleted) names.add(node.name || node.id);
    });
  }
  const subItems = Array.isArray(overrideSubItems) ? overrideSubItems : (Array.isArray(item.subItems) ? item.subItems : []);
  subItems.forEach((si) => {
    if (!si?.patternId || typeof patternLookup !== "function") return;
    const pattern = patternLookup(si.patternId);
    if (pattern?.catalogueDeleted) names.add(`${pattern.name || si.patternId} (recipe)`);
  });
  return [...names];
}

export function catalogueDeletedLabel(info) {
  if (!info) return "";
  if (info.self) return "⚠ deleted";
  const n = info.parts.length;
  return `⚠ ${n} part${n === 1 ? "" : "s"} deleted`;
}

const fmtDeletedDate = (d) => {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
};

// A longer hover-title, clear on three things: what's deleted, that the price is frozen/last-known
// (not live), and that the salesperson should swap it out when convenient. `rateText` (optional) is
// the card's own already-computed effective rate/unit label — never re-derived here.
export function catalogueDeletedTitle(info, { rateText } = {}) {
  if (!info) return "";
  const dateStr = fmtDeletedDate(info.deletedAt);
  const asOf = dateStr ? ` (deleted ${dateStr})` : "";
  const rateClause = rateText
    ? ` It is still priced at its last known rate: ${rateText}.`
    : " It is still priced at its last known rate, not a live one.";
  if (info.kind === "recipe" && info.self) {
    return `The flower recipe "${info.name}" was deleted from IMS${asOf}.${rateClause} Swap it for a current recipe when convenient.`;
  }
  if (info.kind === "kit" && !info.self) {
    const list = info.parts.join(", ");
    const noun = info.parts.length === 1 ? "part" : "parts";
    return `This kit still includes ${info.parts.length} ${noun} deleted from IMS: ${list}.${rateClause} Swap ${info.parts.length === 1 ? "it" : "them"} out when convenient.`;
  }
  if (info.kind === "structural" && info.self) {
    return `"${info.name}" was deleted from its IMS rate list${asOf}.${rateClause} Pick a current option when convenient.`;
  }
  // inventory-self (default) — a plain item or a kit whose OWN row was deleted
  return `"${info.name}" was deleted from IMS Inventory${asOf}.${rateClause} Swap it for a current item when convenient.`;
}

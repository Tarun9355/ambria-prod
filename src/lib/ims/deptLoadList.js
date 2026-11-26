// ── WHAT A DEPARTMENT LOADS ON TRUCKS ── (moved out of DepartmentOpsTab.jsx 2026-11-26 so the Site page reads the SAME list)
// Planning (Dept Ops) builds each department's to-load list from Deal Check's department snapshot (deptInventory[dept]): a kit as
// its shell plus the parts that are this department's, a kit's flower recipe parts, Floral's artificial items mapped for mandi
// flowers (worked out live), Fabric folded to one line per fabric colour, and less what already stands at the venue (fixed /
// Repeat / FOC). Truck loads are keyed by truckKeyOf. The Site page's Receiving used to work "need" out on its own from Studio's
// functions list, and disagreed with Planning in many ways (owner's QA audit 2026-11-26: summed functions where Planning loads
// the peak, kits within kits, platform/carpet/print lines missing, mapped items "need 0", a kit part counted twice...). Both now
// call these functions, so the two cannot drift apart again.
import { isLiveBlockStatus, blockEntryQty } from "./liveBlocks";
import { TRUCK_EXTRA_SRC } from "./truckExtraBlocks";
import { fnFromDetail } from "./liveFloralPlan";
import { reqByDateFrom } from "../studio/soldBlocksPlan";
import { buildFabricGroups, foldFabricLines } from "./fabricGroups";

// A load line's truck key: "inv:<id>" (a kit part "inv:<id>@<kit name>"), else "nm:<name>" (with "|<photo>" when it has one, so two
// colours of one material never share a load).
export const truckKeyOf = (it) => it.invId ? "inv:" + it.invId + (it.kitOf ? "@" + String(it.kitOf).toLowerCase() : "") : "nm:" + String(it.name || "").trim().toLowerCase() + (it.photo ? "|" + it.photo : "");

// Mapping flowers' artificial items, whole event, one row each: Floral's Inventory blocked list and truck list show them — stock to
// pull and load, at no extra ₹ here (their cost is already inside the artificial total), so stockOnly like the artificial rows.
// Pieces are counted the way Studio's reconcile RESERVES them (reqByDateFrom, lib/studio/soldBlocksPlan): functions on the same date
// at the same venue share one set (max), different venues / dates add up — the peak date is the row's qty.
export function mappedStockRowsOf(liveFloral, sel, inventory) {
  const byItem = new Map();
  const reqByFnIdx = {};
  Object.entries(liveFloral?.floralDetail || {}).forEach(([fnKey, fd]) => (fd?.art?.mapped || []).forEach((m) => {
    if (!m.mappedItemId || !(m.pcs > 0)) return;
    const cur = byItem.get(m.mappedItemId) || { pcs: 0, pcsExact: 0, cost: 0, forNames: new Set() };
    cur.pcs += m.pcs; cur.pcsExact += Number(m.pcsExact) || m.pcs; cur.cost += Number(m.cost) || 0;
    String(m.realFlowerName || "").split(", ").forEach(n => n && cur.forNames.add(n));
    byItem.set(m.mappedItemId, cur);
    const slot = reqByFnIdx[fnKey] || (reqByFnIdx[fnKey] = {});
    slot[m.mappedItemId] = (slot[m.mappedItemId] || 0) + m.pcs;
  }));
  const fnsForReq = (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).map((f, i) => fnFromDetail(f, i)).filter(Boolean);
  const byDate = reqByDateFrom(fnsForReq, reqByFnIdx);
  const peak = {};
  Object.values(byDate).forEach((slot) => Object.entries(slot).forEach(([id, q]) => { peak[id] = Math.max(peak[id] || 0, q); }));
  const out = [];
  byItem.forEach((v, id) => {
    const item = (inventory || []).find(i => String(i.id) === String(id));
    if (!item) return;
    const qty = peak[id] > 0 ? peak[id] : v.pcs; // a function with no date can't be bucketed — its own count stands
    out.push({ id: "mapped:" + id, invId: id, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, rentalQty: qty, unit: 0, total: 0, sub: item.subCat || item.subcategory || "", qtyUnit: "", stockOnly: true, mappedFor: [...v.forNames].filter(Boolean).join(", "),
      // shown on the row for reference but NOT in total/unit, so the blocked total never counts it — it is already inside Floral's artificial total
      infoRate: v.pcsExact > 0 ? Math.round((v.cost / v.pcsExact) * 100) / 100 : 0, infoTotal: Math.round(v.cost) });
  });
  return out;
}

// A kit's row carries ALL of its parts, but each part belongs to a department of its own (and Deal Check already files it there as a
// `fromKit` row). So a department's kit lists only the parts that are that department's: a part whose department cannot be told stays,
// and so does one no other department holds as its own row (never lost from every list).
export function kitPartOfDeptOf({ sel, inventory, catToDept }) {
  return (cp, kitName, d0) => {
    const ci = cp?.imsId ? (inventory || []).find(i => String(i.id) === String(cp.imsId)) : null;
    const d = catToDept((ci && (ci.cat || ci.category)) || cp?.sub || "");
    if (!d || d === d0) return true;
    const kn = String(kitName || "").trim().toLowerCase(), pn = String(cp?.name || "").trim().toLowerCase();
    const heldElsewhere = (Array.isArray(sel?.deptInventory?.[d]) ? sel.deptInventory[d] : []).some(r => String(r?.fromKit || "").trim().toLowerCase() === kn
      && ((cp?.imsId && r?.imsId && String(r.imsId) === String(cp.imsId)) || String(r?.name || "").trim().toLowerCase() === pn));
    return !heldElsewhere;
  };
}

// GROUPED view (kit as one line + its components): Deal Check's snapshot when synced, else the event's live blocks in the ledger.
export function blockedGroupedFor(d, { sel, inventory, blocks, catToDept, mappedStockRows = [], swaps = new Map() }) {
  if (!sel) return [];
  const kitPartOfDept = kitPartOfDeptOf({ sel, inventory, catToDept });
  const snapD = (sel?.deptInventory && Array.isArray(sel.deptInventory[d])) ? sel.deptInventory[d] : null;
  if (snapD && snapD.length) {
    // fromKit carried through from the snapshot: Deal Check splits a kit's parts across departments by each part's own category, so a
    // row can be a component of a kit owned by another department. It is the only record of that parent.
    const rows = snapD.map((x, i) => ({ id: x.name + i, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, rentalQty: x.rentalQty != null ? x.rentalQty : (x.qty || 0), byFn: x.byFn || null, calc: x.calc || null, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, fromKit: x.fromKit || null, components: Array.isArray(x.components) ? x.components.filter(cp => kitPartOfDept(cp, x.name, d)) : null, kitPartsTotal: Array.isArray(x.components) ? x.components.reduce((t, c) => t + (Number(c.total) || 0), 0) : 0, recipeParts: Array.isArray(x.recipeParts) ? x.recipeParts : null, shortQty: x.shortQty || 0, shortCost: x.shortCost || 0, outOfStock: !!x.outOfStock, prodOrBuy: x.prodOrBuy || null, isSwapped: swaps.has(x.name), swappedFrom: swaps.get(x.name)?.swappedFrom || null, qtyUnit: x.qtyUnit || "", parts: Array.isArray(x.parts) ? x.parts : null, foc: !!x.foc }));
    // Short items first, then Production/Buying, then everything else, FOC last. Stable within each group.
    const rank = (it) => (it.foc ? 3 : it.shortQty > 0 ? 0 : it.prodOrBuy ? 1 : 2);
    const sorted = rows.sort((a, b) => rank(a) - rank(b));
    if (d !== "Floral" || !mappedStockRows.length) return sorted;
    // The same item already on the list in its own right is ONE row: qty to load = both together, while ₹ stays the item's own line.
    const standalone = [];
    let merged = sorted;
    mappedStockRows.forEach((m) => {
      const k = merged.findIndex((r) => r.invId && String(r.invId) === String(m.invId) && !r.isKit && !r.fromKit && !r.stockOnly && !r.mappedPart);
      if (k < 0) { standalone.push(m); return; }
      const r = merged[k];
      const own = Number(r.rentalQty ?? r.qty) || 0;
      merged = merged.map((x, j) => j !== k ? x : { ...r, qty: (Number(r.qty) || 0) + m.qty, rentalQty: own + m.qty, billQty: own, mappedFor: m.mappedFor, mappedPart: { qty: m.qty, infoRate: m.infoRate, infoTotal: m.infoTotal, mappedFor: m.mappedFor } });
    });
    if (!standalone.length) return merged;
    // Right under the "Artificial flowers / greens" rows; at the end when this event has no such row.
    const isArtRow = (it) => /^artificial (flowers|greens)$/i.test(String(it.name || "").trim());
    let at = -1;
    merged.forEach((it, i) => { if (isArtRow(it)) at = i; });
    if (at < 0) return [...merged, ...standalone];
    return [...merged.slice(0, at + 1), ...standalone, ...merged.slice(at + 1)];
  }
  const out = [];
  Object.entries(blocks || {}).forEach(([itemId, arr]) => {
    // an item added on a truck (not in the deal) has its own block (TRUCK_EXTRA_SRC) and its own section - not counted here twice
    const qty = (arr || []).filter(b => b.eventId === sel.id && isLiveBlockStatus(b) && b.source !== TRUCK_EXTRA_SRC).reduce((s, b) => s + blockEntryQty(b), 0);
    if (qty <= 0) return;
    const item = (inventory || []).find(i => String(i.id) === String(itemId));
    if (!item) return;
    if (catToDept(item.cat || item.category) !== d) return;
    const unit = Number(item.price ?? item.rentalCost) || 0;
    // A Mapping flower's artificial item reserved by Studio's reconcile: stock only, its ₹ is already inside Floral's artificial total.
    const mappedRow = d === "Floral" ? mappedStockRows.find(r => String(r.invId) === String(itemId)) : null;
    if (mappedRow) { out.push({ ...mappedRow, qty, rentalQty: qty }); return; }
    out.push({ id: itemId, invId: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, unit, total: unit * qty, sub: item.subCat || item.subcategory || "" });
  });
  return out.sort((a, b) => b.total - a.total);
}

// FLAT view — kits expanded into the kit shell + each component as its own physical row (and a kit's flower recipe parts), and for
// Fabric the per-zone Liza / Velvet / Masking lines folded to one load line per fabric colour. What Loading & dispatch, Receiving and
// Dismantle read. fabricEntriesOf / fabricPalettesOf come from makeEventPlans (lib/ims/eventPlans).
export function blockedFlatFor(grouped, d, { sel, trussInv, fabricEntriesOf, fabricPalettesOf }) {
  const out = [];
  grouped.forEach(it => {
    const hasComponents = it.isKit && Array.isArray(it.components) && it.components.length;
    const hasRecipeParts = it.isKit && Array.isArray(it.recipeParts) && it.recipeParts.length;
    if (hasComponents || hasRecipeParts) {
      const partsSum = it.kitPartsTotal != null ? it.kitPartsTotal : (it.components || []).reduce((s, c) => s + (Number(c.total) || 0), 0);
      out.push({ ...it, isKit: false, components: null, recipeParts: null, total: Math.max(0, (Number(it.total) || 0) - partsSum) }); // kit shell (its own base value)
      (it.components || []).forEach((cp, ci) => out.push({ id: it.id + "__c" + ci, invId: cp.imsId || null, name: cp.name, photo: cp.photo || "", qty: Number(cp.qty) || 0, unit: cp.unit || 0, total: Number(cp.total) || 0, sub: cp.sub || "", kitOf: it.name }));
      // A kit's flower RECIPE parts are not inventory — no imsId, no money — but are their own load rows.
      (it.recipeParts || []).forEach((rp, ri) => out.push({ id: it.id + "__r" + ri, invId: null, name: rp.name, photo: rp.photo || "", qty: Number(rp.qty) || 0, qtyUnit: rp.uom || "", unit: 0, total: 0, sub: "", kitOf: it.name, isRecipe: true, stockOnly: true }));
    } else out.push(it);
  });
  if (d === "Fabric" && sel) {
    try {
      const g = buildFabricGroups({ entries: fabricEntriesOf ? fabricEntriesOf() : [], lines: grouped, fabricPlan: sel?.fabricPlan, stock: trussInv, multiFn: false, fnPalettes: fabricPalettesOf ? fabricPalettesOf() : null }).groups;
      return foldFabricLines(out, g);
    } catch { return out; }
  }
  return out;
}

// What actually goes on a truck from a flat list: each line at the qty still to load (less fixed / Repeat / FOC, lib/ims/atVenue);
// lines with nothing to load are the "at the venue" list.
export function loadSplitOf(flat, atVenueOf) {
  const load = [], atVenue = [];
  (flat || []).forEach((it) => {
    const a = atVenueOf(it);
    if (a.repeat || a.fixed > 0 || a.foc) atVenue.push({ it, a });
    const q = a.load === (Number(it.qty) || 0) ? it : { ...it, qty: a.load, fullQty: it.qty };
    if ((Number(q.qty) || 0) > 0) load.push(q);
  });
  return { load, atVenue };
}

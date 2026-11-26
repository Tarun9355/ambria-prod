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
import { atVenueByRow } from "./atVenue";

// One id -> item index per inventory list (the list is replaced, never mutated, when it changes), so looking items up row by row
// is not a scan of 600+ items each time (owner's QA audit 2026-11-26: the Site page did that for every row).
const invIndex = new WeakMap();
const itemById = (inventory, id) => {
  if (!Array.isArray(inventory) || id == null) return null;
  let m = invIndex.get(inventory);
  if (!m) { m = new Map(inventory.filter(Boolean).map((i) => [String(i.id), i])); invIndex.set(inventory, m); }
  return m.get(String(id)) || null;
};

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
    const item = itemById(inventory, id);
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
    const ci = cp?.imsId ? itemById(inventory, cp.imsId) : null;
    const d = catToDept((ci && (ci.cat || ci.category)) || cp?.sub || "");
    if (!d || d === d0) return true;
    const kn = String(kitName || "").trim().toLowerCase(), pn = String(cp?.name || "").trim().toLowerCase();
    const heldElsewhere = (Array.isArray(sel?.deptInventory?.[d]) ? sel.deptInventory[d] : []).some(r => String(r?.fromKit || "").trim().toLowerCase() === kn
      && ((cp?.imsId && r?.imsId && String(r.imsId) === String(cp.imsId)) || String(r?.name || "").trim().toLowerCase() === pn));
    return !heldElsewhere;
  };
}

// Items reserved for THIS event in the blocks ledger (live, not added on a truck) that Deal Check's snapshot does not list anywhere -
// in any department, as a kit part or a mapped piece. Owner report 2026-11-26 (Neel Vashisht, 27 Nov): 45 Floral items were blocked
// but Planning showed only the two artificial rows Deal Check sent, so the rest were invisible. Listed as `blockedOnly` rows with no
// money (Deal Check never priced them), so nothing reserved is hidden.
export function blockedNotInSnapshot(d, { sel, inventory, blocks, catToDept, mappedStockRows = [] }) {
  if (!sel || !blocks) return [];
  const known = new Set();
  Object.values(sel?.deptInventory || {}).forEach((rows) => (Array.isArray(rows) ? rows : []).forEach((x) => {
    if (x?.imsId) known.add(String(x.imsId));
    (Array.isArray(x?.components) ? x.components : []).forEach((c) => { if (c?.imsId) known.add(String(c.imsId)); });
    (Array.isArray(x?.parts) ? x.parts : []).forEach((c) => { if (c?.imsId) known.add(String(c.imsId)); });
  }));
  (mappedStockRows || []).forEach((m) => { if (m?.invId) known.add(String(m.invId)); });
  const out = [];
  Object.entries(blocks || {}).forEach(([itemId, arr]) => {
    if (known.has(String(itemId))) return;
    const qty = (arr || []).filter((b) => b.eventId === sel.id && isLiveBlockStatus(b) && b.source !== TRUCK_EXTRA_SRC).reduce((s, b) => s + blockEntryQty(b), 0);
    if (qty <= 0) return;
    const item = itemById(inventory, itemId);
    if (!item || catToDept(item.cat || item.category) !== d) return;
    out.push({ id: "blk:" + itemId, invId: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, rentalQty: qty, unit: 0, total: 0,
      sub: item.subCat || item.subcategory || "", blockedOnly: true });
  });
  return out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

// GROUPED view (kit as one line + its components): Deal Check's snapshot when synced, else the event's live blocks in the ledger.
export function blockedGroupedFor(d, opts) {
  const base = blockedGroupedForSnap(d, opts);
  const snapD = opts?.sel?.deptInventory && Array.isArray(opts.sel.deptInventory[d]) ? opts.sel.deptInventory[d] : null;
  // only when the list came from Deal Check's snapshot - without one the list already is the event's blocks
  if (!(snapD && snapD.length)) return base;
  const extra = blockedNotInSnapshot(d, opts || {});
  return extra.length ? [...base, ...extra] : base;
}

function blockedGroupedForSnap(d, { sel, inventory, blocks, catToDept, mappedStockRows = [], swaps = new Map() }) {
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
    const item = itemById(inventory, itemId);
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
      // A kit's flower RECIPE parts are not inventory — no imsId, no money — but are their own load rows: Floral's, whichever department
      // the kit is (owner report 2026-11-27: "Flower Bunch filler" / "Flower Trail" of a Tenting Tree listed under Tenting on the Site page -
      // the floral team makes and brings them). Another department's kit's recipes are added to Floral's list below.
      if (d === "Floral") (it.recipeParts || []).forEach((rp, ri) => out.push({ id: it.id + "__r" + ri, invId: null, name: rp.name, photo: rp.photo || "", qty: Number(rp.qty) || 0, qtyUnit: rp.uom || "", unit: 0, total: 0, sub: "", kitOf: it.name, isRecipe: true, stockOnly: true }));
    } else out.push(it);
  });
  if (d === "Floral" && sel) out.push(...otherDeptKitRecipes(sel));
  if (d === "Fabric" && sel) {
    try {
      const g = buildFabricGroups({ entries: fabricEntriesOf ? fabricEntriesOf() : [], lines: grouped, fabricPlan: sel?.fabricPlan, stock: trussInv, multiFn: false, fnPalettes: fabricPalettesOf ? fabricPalettesOf() : null }).groups;
      return foldFabricLines(out, g);
    } catch { return out; }
  }
  return out;
}

// The flower recipe parts of kits filed under OTHER departments (a Tenting Tree's Flower Trail), as Floral load rows - from Deal Check's
// snapshot, the same rows each kit carries. kitDept says whose kit it is.
export function otherDeptKitRecipes(sel) {
  const out = [];
  Object.entries(sel?.deptInventory || {}).forEach(([dd, rows]) => {
    if (dd === "Floral" || !Array.isArray(rows)) return;
    rows.forEach((x, i) => {
      if (!x?.isKit || !Array.isArray(x.recipeParts)) return;
      x.recipeParts.forEach((rp, ri) => {
        if (!(Number(rp?.qty) > 0)) return;
        out.push({ id: `kr:${dd}:${x.name}${i}__r${ri}`, invId: null, name: rp.name, photo: rp.photo || "", qty: Number(rp.qty) || 0, qtyUnit: rp.uom || "", unit: 0, total: 0, sub: "",
          kitOf: x.name, kitDept: dd, isRecipe: true, stockOnly: true });
      });
    });
  });
  return out;
}

// What actually goes on a truck from a flat list: each line at the qty still to load (less fixed / Repeat / FOC, lib/ims/atVenue);
// lines with nothing to load are the "at the venue" list.
export function loadSplitOf(flat, atVenueOf) {
  const load = [], atVenue = [];
  const byRow = atVenueByRow(flat, atVenueOf); // standing stock taken off once per item across its rows
  (flat || []).forEach((it) => {
    const a = byRow.get(it.id) || atVenueOf(it);
    if (a.repeat || a.fixed > 0 || a.foc) atVenue.push({ it, a });
    const q = a.load === (Number(it.qty) || 0) ? it : { ...it, qty: a.load, fullQty: it.qty };
    if ((Number(q.qty) || 0) > 0) load.push(q);
  });
  return { load, atVenue };
}

// The "Already at the venue" list, one row per item (owner report 2026-11-27: the Site page showed "Mattress · all 4 stay from
// before" four times and "Pillar Candle" twice). The flat list has a row per kit an item is part of - its truck key carries the kit
// ("inv:<id>@<kit>") because each kit's pieces are loaded and received apart - but nothing is loaded or received here, so the
// same item in one department, standing the same way (♻ Repeat / 📌 Fixed / 🎁 FOC), is one row with the kits' pieces added up.
// rows: [{ dept, key, label, photo, qty, unit, a: { repeat, foc, fixed, load } }], in order; the first row of an item keeps its place.
export function mergeAtVenueRows(rows) {
  const out = [], byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const a = r.a || {};
    const how = a.foc ? "foc" : a.repeat ? "repeat" : "fixed";
    // only an inventory key carries a kit ("@kit"); a name key ends in the photo's URL, which is left whole
    const item = String(r.key || "").startsWith("inv:") ? String(r.key).replace(/@.*$/, "") : String(r.key || "");
    const k = `${r.dept}|${how}|${item}`;
    const cur = byKey.get(k);
    if (!cur) {
      const row = { ...r, key: `${item}#${how}`, a: { ...a } };
      byKey.set(k, row);
      out.push(row);
      return;
    }
    cur.qty = Math.round(((Number(cur.qty) || 0) + (Number(r.qty) || 0)) * 100) / 100;
    cur.a.fixed = (Number(cur.a.fixed) || 0) + (Number(a.fixed) || 0);
    cur.a.load = (Number(cur.a.load) || 0) + (Number(a.load) || 0);
    if (!cur.photo && r.photo) cur.photo = r.photo;
  });
  return out;
}

// ── THE EVENT'S TRUCKS, WITH TRUCKS FROM BEFORE THEY WERE SHARED FOLDED IN ── (moved out of DepartmentOpsTab.jsx 2026-11-26)
// Trucks saved before they were shared lived in each department's own deptOps; any such row not yet folded into the event's own
// shared list (sel.trucks) is backfilled, matched by vehicle number - on every read, since a department only starts writing to a
// shared truck once it has been through the shared screen itself (owner report 2026-11-23: Furniture's "DL1LAJ1250" was shared
// while Structure's old row for the same vehicle stayed invisible). A legacy row only fills a department's loads while that
// department is ABSENT from the shared truck (on every trip); a row with no vehicle surfaces as its own truck. The Site page reads
// this too (owner's QA audit 2026-11-26: it only saw the shared list, so such a department's items read "Not loaded").
// flatItemsOf(d): that department's flat list (blockedFlatFor), whose ids the legacy rows' "inv:<id>" keys name.
export function mergeLegacyTrucks(sel, flatItemsOf) {
  const itemsByDept = new Map();
  const itemsOf = (d) => { if (!itemsByDept.has(d)) itemsByDept.set(d, flatItemsOf(d) || []); return itemsByDept.get(d); };
  const legacyByPlate = new Map(); // vehicle number (trimmed, lowercase) -> { ...truck fields, byDept }
  const noPlate = [];
  Object.entries(sel?.deptOps || {}).forEach(([d, od]) => {
    (Array.isArray(od?.trucks) ? od.trucks : []).forEach(t => {
      const items = itemsOf(d), ld = {};
      Object.entries(t.items || {}).forEach(([k, q]) => { const it = items.find(x => "inv:" + x.id === k); if (it && Number(q) > 0) ld[truckKeyOf(it)] = Number(q); });
      const plateKey = String(t.vehicle || "").trim().toLowerCase();
      if (!plateKey) { noPlate.push({ id: t.id, vehicle: "", driver: t.driver || "", phone: t.phone || "", status: t.status || "loading", loads: { [d]: ld } }); return; }
      if (!legacyByPlate.has(plateKey)) legacyByPlate.set(plateKey, { id: t.id, vehicle: t.vehicle || "", driver: t.driver || "", phone: t.phone || "", status: t.status || "loading", byDept: {} });
      legacyByPlate.get(plateKey).byDept[d] = ld;
    });
  });
  const usedPlates = new Set();
  const base = (Array.isArray(sel?.trucks) ? sel.trucks : []).map(t => {
    const plateKey = String(t.vehicle || "").trim().toLowerCase();
    const legacy = plateKey ? legacyByPlate.get(plateKey) : null;
    if (!legacy) return t;
    usedPlates.add(plateKey);
    // Already split into trips - a still-missing department folds onto trip 1; one present on ANY trip is left alone.
    if (Array.isArray(t.trips) && t.trips.length) {
      const missing = {};
      let changed = false;
      Object.entries(legacy.byDept).forEach(([d, ld]) => { if (!t.trips.some(tr => tr.loads?.[d])) { missing[d] = ld; changed = true; } });
      if (!changed) return t;
      return { ...t, trips: t.trips.map((tr, i) => i === 0 ? { ...tr, loads: { ...(tr.loads || {}), ...missing } } : tr) };
    }
    let loads = t.loads || {}, changed = false;
    Object.entries(legacy.byDept).forEach(([d, ld]) => { if (!loads[d]) { loads = { ...loads, [d]: ld }; changed = true; } });
    return changed ? { ...t, loads } : t;
  });
  legacyByPlate.forEach((legacy, plateKey) => { if (!usedPlates.has(plateKey)) base.push({ id: legacy.id, vehicle: legacy.vehicle, driver: legacy.driver, phone: legacy.phone, status: legacy.status, loads: legacy.byDept }); });
  return [...base, ...noPlate];
}

// What rides on ONE trip, every department together - a combined challan's rows, matched the way Planning's own challan matches them
// (each department's flat list against that trip's loads / extra by truck key; items added on the truck by department alone).
// Used by the Site page's per-truck challan (owner's QA audit 2026-11-26: a supervisor had no challan on the Site page).
export function tripChallanRows(trip, flatItemsOf) {
  const out = [];
  if (!trip) return out;
  Object.keys(trip.loads || {}).forEach((d) => {
    const mine = trip.loads?.[d] || {}, mineX = trip.extra?.[d] || {};
    (flatItemsOf(d) || []).forEach((it) => {
      const k = truckKeyOf(it);
      const q = Number(mine[k]) || 0, x = Number(mineX[k]) || 0;
      if (q <= 0 && x <= 0) return;
      out.push({ dept: d, key: k, name: it.name || "", sub: it.sub || "", qty: q, extra: x, added: false });
    });
  });
  Object.keys(trip.custom || {}).forEach((d) => {
    (trip.custom[d] || []).forEach((c) => {
      if (!(Number(c?.qty) > 0)) return;
      out.push({ dept: d, key: c.invId ? "inv:" + c.invId : "", name: c.name || "", sub: c.sub || "", qty: Number(c.qty), extra: 0, added: true });
    });
  });
  return out;
}


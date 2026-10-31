// Choices for overlays and cushion covers. Like a carpet floor, such an element can name up to ELEMENT_PREF_MAX designs in order of preference
// (1st choice, 2nd choice…), each of which must be able to supply the element's WHOLE quantity; Planning then decides which one is used
// from what is free on the day.
//
// Stored on the element ({ invId, name, qty, … }):
//   prefs  [{ id, name, free }]   rank order; prefs[0] is the element's own item (invId) — kept in step by whoever writes it
//   pid    a stable id given to the element when it first gets choices, so a decision Planning saves for it still finds it after
//          other elements of the zone are added, removed or re-ordered
// Prices, stock ceilings, Deal Check cards and stock holds all keep reading invId, i.e. the 1st choice, exactly as before.

import { elementAfterPick } from "./elementPick.js";

export const ELEMENT_PREF_MAX = 3;
export const ELEMENT_PREF_LABELS = ["1st choice", "2nd choice", "3rd choice"];

const norm = (v) => String(v || "").trim().toLowerCase();

// Which inventory items can carry choices: every overlay, and the cushion COVERS (the sub-category also holds inserts and made-to-order
// cushions, which are not designs to choose between).
export function itemTakesChoices(item) {
  if (!item) return false;
  const sub = norm(item.subCat || item.subcategory);
  if (sub === "overlays") return true;
  if (sub === "cushion") return /cover/i.test(String(item.name || ""));
  return false;
}

const clean = (p) => {
  if (!p || !p.id) return null;
  const free = p.free === null || p.free === undefined || p.free === "" ? null : (Number(p.free) || 0);
  return { id: String(p.id), name: String(p.name || ""), free };
};

// The element's choices in rank order — empty unless it really has alternatives. They count only while the 1st is still the element's own
// item: anyone who swaps the element to another item through the ordinary picker has made a new decision, and the old list no longer applies.
export function elementChoices(el) {
  if (!el || !Array.isArray(el.prefs) || !el.invId) return [];
  const seen = new Set();
  const list = el.prefs.map(clean).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).slice(0, ELEMENT_PREF_MAX);
  if (list.length < 2 || list[0].id !== String(el.invId)) return [];
  return list;
}

export const hasChoices = (el) => elementChoices(el).length >= 2;

// The element with these picks as its choices. `el` must already be an element whose own item (invId) is picks[0] — the caller applies that
// first (elementAfterPick). Fewer than two picks means no alternatives: the choices are dropped. makeId is injectable for tests.
export function withChoices(el, picks, makeId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)) {
  const seen = new Set();
  const list = (Array.isArray(picks) ? picks : []).map(clean).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).slice(0, ELEMENT_PREF_MAX);
  const next = { ...el };
  if (list.length < 2 || list[0].id !== String(el?.invId)) { delete next.prefs; return next; }
  next.prefs = list;
  if (!next.pid) next.pid = makeId();
  return next;
}

// Drop the choices (the element keeps its own item and its pid).
export function withoutChoices(el) { const next = { ...el }; delete next.prefs; return next; }

// What saving the choices picker does to an element: the 1st pick becomes the element's own item (the same swap rule as the ordinary picker),
// and the picks become its choices. `items` is the picker's list. One pick only = an ordinary pick, no alternatives.
export function applyChoicePicks(el, picks, items, makeId) {
  const list = Array.isArray(picks) ? picks.filter((p) => p && p.id) : [];
  if (!el || !list.length) return el;
  const all = Array.isArray(items) ? items : [];
  let e = el;
  if (String(e.invId) !== String(list[0].id)) e = elementAfterPick(e, list[0].id, all.find((i) => i.id === list[0].id), all);
  return withChoices(e, list, makeId);
}

// ── CHOICES FOR A PART INSIDE A KIT ──
// A kit element lists its parts ({ itemId, qty }, in el.kitOverrides once edited); a part that is an overlay or a cushion cover can name up to three designs
// the same way an element can. The part's own item (itemId) is the 1st choice - what is priced and held - and `prefs` / `pid` sit on the part.
export function partChoices(part) {
  return elementChoices(part ? { invId: part.itemId, prefs: part.prefs } : null);
}

// What saving the choices picker does to a kit part: the 1st pick becomes the part's item, the picks become its choices (fewer than two = none, the
// part keeps its pid so a decision saved for it stays valid).
export function applyPartChoicePicks(part, picks, makeId) {
  const list = Array.isArray(picks) ? picks.filter((p) => p && p.id) : [];
  if (!part || !list.length) return part;
  const next = { ...part, itemId: list[0].id };
  const w = withChoices({ invId: list[0].id, pid: part.pid }, list, makeId);
  if (w.prefs) { next.prefs = w.prefs; next.pid = w.pid; } else { delete next.prefs; }
  return next;
}

// ── SAVE TO ALL ──
// "overlay" or "cushion cover" for an item that takes choices, else null. Save to all only ever crosses between elements of the same kind.
export function choiceKind(item) {
  if (!itemTakesChoices(item)) return null;
  return norm(item.subCat || item.subcategory) === "overlays" ? "overlay" : "cushion cover";
}

// The choices picker's "Save to all": the same picks, in the same order, on every element of that kind in the given zones (the function's
// switched-on zones) — like Save to all on a carpet. Each element keeps its own qty; the 1st pick becomes its item, as a single Save does.
// Kit parts are left alone (they are set per kit). Returns { next, count } — next is a new zoneElements map; zones it does not touch are reused.
export function applyChoicesToAll(zoneElements, zoneKeys, picks, items, inventory, kind, makeId) {
  const byId = new Map((Array.isArray(inventory) ? inventory : []).map((i) => [String(i.id), i]));
  const next = { ...(zoneElements || {}) };
  let count = 0;
  if (!kind || !(Array.isArray(picks) && picks.some((p) => p && p.id))) return { next, count };
  (Array.isArray(zoneKeys) ? zoneKeys : []).forEach((k) => {
    const els = next[k];
    if (!Array.isArray(els)) return;
    let changed = false;
    const out = els.map((el) => {
      if (!el?.invId || choiceKind(byId.get(String(el.invId))) !== kind) return el;
      changed = true; count++;
      return applyChoicePicks(el, picks, items, makeId);
    });
    if (changed) next[k] = out;
  });
  return { next, count };
}

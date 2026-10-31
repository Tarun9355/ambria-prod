// Planning's carpet plan. Sales ranks up to three stock carpets per floor (lib/studio/carpetPrefs); here the Tenting
// head sees each floor's three with what is actually free on the event date, and decides which one is laid.
// The decision is IMS-owned (deptOps.Tenting.carpetChoice[key]) so every Studio sync leaves it alone.

import { prefsOf, floorSqftOf } from "../studio/carpetPrefs.js";
import { CARPET_OFF, carpetPricingFor, carpetTakesStockPick } from "../studio/taxonomy.js";
import { sameVenueHolds, reuseAwareAvail } from "../studio/carpetReuse.js";

const norm = (v) => String(v || "").trim().toLowerCase();

// One id per carpet floor of the event: function, zone, and which floor in the zone (0 = the zone's own floor, then its extra platforms).
export const carpetKey = (fi, zk, ri) => `${fi}|${zk}|${ri}`;

// Sqft of this carpet free for THIS event on that date: what is owned, less what other events hold that day. The event's own
// holds are not taken off — they are what this decision is about.
export function freeForEvent(item, blocks, date, eventId) {
  if (!item) return null;
  const arr = (blocks || {})[item.id] || [];
  const other = arr
    .filter((b) => b && b.date === date && b.status !== "released" && b.eventId !== eventId)
    .reduce((s, b) => s + (Number(b.qty) || 1), 0);
  return Math.max(0, (Number(item.qty) || 0) - (Number(item.blocked) || 0) - other);
}

// Every carpet floor of the event, from its saved layout (functionsDetail): zones that are switched on, with carpet on and a size.
// With carpetMaterials, a floor whose material is not a stock carpet (Carpet New, Flex) is left out - nothing to pick from stock.
export function carpetFloorsOf(functionsDetail, zoneLabelOf, carpetMaterials) {
  const out = [];
  (Array.isArray(functionsDetail) ? functionsDetail : []).forEach((fn, i) => {
    const fi = fn?.fnIdx ?? i;
    const en = fn?.enabledEls || {};
    Object.entries(fn?.zones || {}).forEach(([zk, zc]) => {
      if (!zc || !en[zk]) return; // the same rule Build uses: only a zone that is switched on has a floor to plan
      [zc, ...(Array.isArray(zc.extraPlatformRows) ? zc.extraPlatformRows : [])].forEach((row, ri) => {
        // carpet explicitly turned off = nothing to plan; an unset material still bills the default carpet, so it is planned
        if (!row || row.cpT === CARPET_OFF) return;
        if (carpetMaterials && !carpetTakesStockPick(carpetPricingFor(row.cpT, carpetMaterials).label)) return;
        const fd = row.floorDims || {};
        const qty = Math.max(1, Math.round(Number(row.plQty) || 1));
        const area = floorSqftOf(row);
        if (!(area > 0)) return;
        out.push({
          key: carpetKey(fi, zk, ri), fi, zk, ri, date: fn?.date || "", venue: fn?.venue || "",
          zoneName: (typeof zoneLabelOf === "function" ? zoneLabelOf(fn, zk) : zk) + (ri > 0 ? ` (floor ${ri + 1})` : ""),
          fnLabel: fn?.type || fn?.name || "", area, dims: `${Number(fd.L) || Number(fd.S) || 0} x ${Number(fd.W) || Number(fd.S) || 0} ft${qty > 1 ? ` × ${qty}` : ""}`, prefs: prefsOf(row),
        });
      });
    });
  });
  return out;
}

// A saved decision still applies to this floor? Decisions are keyed by function number, zone and floor, so deleting a function in Studio
// would shift the numbers under a saved decision. A decision made through the plan also carries the date and function type it was made
// for; if either no longer matches the floor it is ignored (the floor needs deciding again) rather than landing on the wrong floor.
export function validDecision(entry, floor) {
  if (!entry || !entry.id && !entry.other) return null;
  if (entry.date && floor?.date && entry.date !== floor.date) return null;
  if (entry.fnType && floor?.fnLabel && entry.fnType !== floor.fnLabel) return null;
  return entry;
}

// Floors of OTHER functions of this event, at the same venue and date, that use this carpet (their decision, else their 1st choice) — it
// stays laid between them, so it is reusable, not a conflict. Same function = a different floor of the same setup, never a sibling.
export function siblingFloorsUsing(floor, id, floors, choice) {
  const v = norm(floor.venue);
  if (!v || !floor.date) return [];
  const out = [];
  (floors || []).forEach((g) => {
    if (!g || g.key === floor.key || g.fi === floor.fi || g.date !== floor.date || norm(g.venue) !== v) return;
    const used = validDecision(choice?.[g.key], g)?.id || g.prefs[0]?.id;
    if (used === id) out.push(`${g.fnLabel || `Function ${(g.fi ?? 0) + 1}`} · ${g.zoneName}`);
  });
  return [...new Set(out)];
};

// One carpet as the plan shows it on a given day: its free sqft, what is already laid at this venue that day for another event (it stays
// down, so it counts as usable), whether that covers the floor, and by how much it falls short.
const optionFor = (id, name, item, fallbackFree, blocks, date, eventId, area, rank, extra = {}) => {
  const free = item ? freeForEvent(item, blocks, date, eventId) : (fallbackFree ?? null);
  const known = free !== null && free !== undefined;
  const holds = item && extra.eventOrders ? sameVenueHolds((blocks || {})[item.id], extra.eventOrders, extra.venue, date, eventId) : { qty: 0, who: [] };
  const siblings = extra.siblings || [];
  const a = known ? reuseAwareAvail(free, holds.qty, item?.qty, area) : null;
  const enough = !!a && a.short === 0;
  // Another event's hold at this venue adds to what can be used, so it is always worth showing. Another function of the SAME deal using
  // it adds nothing (that deal's own use is never taken off free), so it is only a pointer — shown when the carpet covers the floor
  // anyway, never beside a SHORT.
  const reuse = holds.qty > 0 || (siblings.length && enough) ? { qty: holds.qty, who: holds.who.map((w) => w.name), siblings } : null;
  return { id, name: item?.name || name, rank, free, known, reuse, enough, short: known ? a.short : null, item };
};

// Every carpet in stock with what is free for this floor's date, those that cover it first — what Planning picks from when none of
// sales' choices is available that day. itemsById is the whole inventory; only the carpet sub-category is offered.
export function carpetStockFor(floor, items, blocks, eventId, eventOrders, floors, choice) {
  const out = (items || [])
    .filter((it) => it && String(it.subCat || it.subcategory || "").trim().toLowerCase() === "carpet")
    .map((it) => optionFor(it.id, it.name, it, null, blocks, floor.date, eventId, floor.area, null, { eventOrders, venue: floor.venue, siblings: siblingFloorsUsing(floor, it.id, floors, choice) }));
  return out.sort((a, b) => (Number(b.enough) - Number(a.enough)) || ((b.free ?? -1) - (a.free ?? -1)) || String(a.name).localeCompare(String(b.name)));
}

// The plan: for each floor, its preferences with free sqft on the day, which one is suggested (the highest-ranked that covers the
// whole floor, else the one with most free), and which is decided. A decision for a carpet that is no longer one of the floor's
// preferences is ignored — the preferences changed under it.
// itemsById: { [id]: inventory item }, choice: { [key]: { id } }
export function planCarpets({ floors, itemsById, blocks, eventId, choice, eventOrders }) {
  const rows = (floors || []).map((f) => {
    const ex = (id) => ({ eventOrders, venue: f.venue, siblings: siblingFloorsUsing(f, id, floors, choice) });
    const options = f.prefs.map((p, rank) => optionFor(p.id, p.name, itemsById?.[p.id], p.free, blocks, f.date, eventId, f.area, rank, ex(p.id)));
    const firstEnough = options.find((o) => o.enough);
    const best = options.filter((o) => o.known).sort((a, b) => b.free - a.free || a.rank - b.rank)[0];
    const suggestedId = (firstEnough || best || options[0])?.id || null;
    // A decision is for one of sales' choices, or — when none of them was available that day — a carpet Planning picked by hand
    // (choice.manual). A hand pick that is also one of sales' choices is just that choice.
    const picked = validDecision(choice?.[f.key], f);
    const pickedId = picked?.id;
    // "Arranged separately": none of the stock carpets can be used (every one is short, or the floor is bigger than anything owned), so the
    // carpet is bought or hired outside stock. It still counts as decided, so the floor never blocks the PDF with nothing to choose.
    const other = !!picked?.other;
    const inOptions = !other && !!pickedId && options.some((o) => o.id === pickedId);
    // A hand pick is decided even if the item has since left the inventory list (or it has not loaded yet): it keeps its name and shows no stock.
    const manual = !other && picked?.manual && pickedId && !inOptions
      ? optionFor(pickedId, picked.name, itemsById?.[pickedId], null, blocks, f.date, eventId, f.area, null, ex(pickedId)) : null;
    // ── SALES' 1ST CHOICE IS THE DEFAULT ── (owner ask) Until Planning decides, the 1st choice counts as chosen — it is also
    // what the deal is priced on and holds. Not when it is short that day: a default that cannot be laid would read "decided" over
    // a real gap, so that row stays open for Planning. Stock not known yet is not a gap, so it defaults.
    const first = options[0];
    // "no decision" means no decision that APPLIES — one saved for a design that is no longer a choice (and not a hand pick) is
    // ignored above, and the default steps in for it just the same.
    const byDefault = !other && !inOptions && !manual && !!first && (first.enough || !first.known);
    const decidedId = inOptions ? pickedId : manual ? pickedId : byDefault ? first.id : null;
    return {
      ...f, options, manual, other, suggestedId, decidedId, byDefault,
      // decided wins: a floor sales picked nothing for is still decided once Planning picks a carpet by hand (or arranges one separately)
      status: decidedId || other ? "decided" : !options.length ? "none" : firstEnough || !options.some((o) => o.known) ? "open" : "short",
    };
  });
  // Floors that decide the same carpet draw on one stock — but only on the SAME DATE, and at one venue the functions share what is laid
  // (the largest counts), while floors of one function, or at different venues, add up. Flagged when together they need more than is
  // available that day.
  const groups = {};
  rows.forEach((r) => {
    if (!r.decidedId) return;
    const o = [...r.options, r.manual].filter(Boolean).find((x) => x.id === r.decidedId);
    if (!o?.known) return;
    const g = (groups[`${r.decidedId}|${r.date}`] ||= { id: r.decidedId, date: r.date, avail: reuseAwareAvail(o.free, o.reuse?.qty || 0, o.item?.qty, 0).avail, venues: {} });
    // functions with no venue recorded cannot be said to share one: each stands alone
    const vk = norm(r.venue) || `fn:${r.fi}`;
    const fns = (g.venues[vk] ||= {});
    fns[r.fi] = (fns[r.fi] || 0) + r.area;
  });
  const over = {};
  Object.values(groups).forEach((g) => {
    const committed = Object.values(g.venues).reduce((sum, fns) => sum + Math.max(...Object.values(fns)), 0);
    if (committed > g.avail && !over[g.id]) over[g.id] = { free: g.avail, committed, date: g.date };
  });
  return { rows, over };
}

// What the Inventory blocked list says about the carpet lines. Deal Check files each floor's carpet under the carpet IT picked (sales' pick), with the floors
// that make up the line in `parts` ({ zone, fn, dims, qty }); once Planning decides a floor the card says which carpet is really laid. `rows` are the list's
// lines, `planRows` come from planCarpets, `onlyFn` (a function's type) limits the parts to one function's. Returns Map<line id, { name, photo, notes }> -
// `name` and `photo` only when every floor of the line was decided, by Planning, to the same other carpet; else the decisions are told in notes. Floors left
// on sales' 1st choice by default say nothing; floors still to decide are counted.
// The plan floor a line's part (one zone's floor of that carpet) stands for: same zone and floor number, same sqft, same function.
const carpetSplit = (text, re) => { const m = String(text || "").match(re); return { base: norm(m ? m[1] : text), n: m && m[2] ? Number(m[2]) : 1 }; };
const floorMatcher = (planRows) => (part) => {
  const z = carpetSplit(part.zone, /^(.*?)(?: · floor (\d+))?$/);
  return (planRows || []).find((r) => {
    const pz = carpetSplit(r.zoneName, /^(.*?)(?: \(floor (\d+)\))?$/);
    return pz.base === z.base && pz.n === z.n && Math.round(Number(r.area) || 0) === Math.round(Number(part.qty) || 0) && (!part.fn || norm(part.fn) === norm(r.fnLabel));
  }) || null;
};

// The preference side of the carpet lines: what sales ranked for a floor ("Preference: 1 A · 2 B"), or - in red - that sales named none. A floor has a
// preference once it has two or more ranked carpets; one pick (or none) is nothing to choose between. Counted in sqft, per line. Lines with no matching
// floor are left alone.
export function carpetPrefNotesForRows(rows, planRows, onlyFn = "") {
  const out = new Map();
  const floorFor = floorMatcher(planRows);
  (rows || []).forEach((line) => {
    if (!line || !Array.isArray(line.parts) || !line.parts.length || !/carpet/i.test(String(line.sub || ""))) return;
    const prefs = new Set();
    let missing = 0, matched = 0;
    line.parts.filter((p) => !onlyFn || !p.fn || norm(p.fn) === norm(onlyFn)).forEach((p) => {
      const r = floorFor(p);
      if (!r) return;
      matched += 1;
      if (Array.isArray(r.prefs) && r.prefs.length >= 2) prefs.add("Preference: " + r.prefs.map((x, i) => `${i + 1} ${x.name}`).join(" · "));
      else missing += Math.round(Number(p.qty) || 0);
    });
    if (!matched) return;
    const notes = [...prefs].map((text) => ({ text, tone: "pref" }));
    if (missing) notes.push({ text: `${missing} sqft not selected preference`, tone: "missing" });
    if (notes.length) out.set(line.id, { notes });
  });
  return out;
}

export function carpetNotesForRows(rows, planRows, onlyFn = "") {
  const out = new Map();
  const floorFor = floorMatcher(planRows);
  const photoOf = (it) => (Array.isArray(it?.photoUrls) && it.photoUrls[0]) || it?.img || "";
  (rows || []).forEach((line) => {
    if (!line || !Array.isArray(line.parts) || !line.parts.length || !/carpet/i.test(String(line.sub || ""))) return;
    const parts = line.parts.filter((p) => !onlyFn || !p.fn || norm(p.fn) === norm(onlyFn));
    const decided = new Map(); // carpet name -> { sqft, photo, id }
    let same = 0, other = 0, waiting = 0, matched = 0, otherName = "";
    parts.forEach((p) => {
      const r = floorFor(p);
      if (!r) return;
      matched += 1;
      const sq = Math.round(Number(p.qty) || 0);
      if (r.other) { other += sq; return; }
      if (r.decidedId && !r.byDefault) {
        const dec = [...(r.options || []), r.manual].filter(Boolean).find((o) => String(o.id) === String(r.decidedId));
        if (String(r.decidedId) === String(line.invId)) { same += sq; return; }
        const cur = decided.get(String(r.decidedId)) || { sqft: 0, name: dec?.name || "carpet", photo: photoOf(dec?.item) };
        cur.sqft += sq; decided.set(String(r.decidedId), cur); otherName = cur.name;
        return;
      }
      if (!r.decidedId) waiting += sq;
    });
    if (!matched) return;
    const notes = [];
    decided.forEach((d) => notes.push({ text: `${d.sqft} sqft laid with ${d.name} (chosen in Planning, Deal Check had ${line.name})`, tone: "ok" }));
    if (same) notes.push({ text: `${same} sqft confirmed in Planning`, tone: "ok" });
    if (other) notes.push({ text: `${other} sqft arranged separately - not from stock`, tone: "ok" });
    if (waiting) notes.push({ text: `${waiting} sqft not decided yet - sales' 1st choice holds`, tone: "wait" });
    if (!notes.length) return;
    const allMoved = decided.size === 1 && !same && !other && !waiting && matched === parts.length;
    const only = allMoved ? [...decided.values()][0] : null;
    out.set(line.id, { ...(only ? { name: only.name, photo: only.photo } : {}), notes: only ? [{ text: `Chosen in Planning - Deal Check had ${line.name}`, tone: "ok" }] : notes });
  });
  return out;
}

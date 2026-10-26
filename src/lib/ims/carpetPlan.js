// Planning's carpet plan. Sales ranks up to three stock carpets per floor (lib/studio/carpetPrefs); here the Tenting
// head sees each floor's three with what is actually free on the event date, and decides which one is laid.
// The decision is IMS-owned (deptOps.Tenting.carpetChoice[key]) so every Studio sync leaves it alone.

import { prefsOf } from "../studio/carpetPrefs.js";
import { CARPET_OFF } from "../studio/taxonomy.js";
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
export function carpetFloorsOf(functionsDetail, zoneLabelOf) {
  const out = [];
  (Array.isArray(functionsDetail) ? functionsDetail : []).forEach((fn, i) => {
    const fi = fn?.fnIdx ?? i;
    const en = fn?.enabledEls || {};
    Object.entries(fn?.zones || {}).forEach(([zk, zc]) => {
      if (!zc || en[zk] === false) return;
      [zc, ...(Array.isArray(zc.extraPlatformRows) ? zc.extraPlatformRows : [])].forEach((row, ri) => {
        // carpet explicitly turned off = nothing to plan; an unset material still bills the default carpet, so it is planned
        if (!row || row.cpT === CARPET_OFF) return;
        const fd = row.floorDims || {};
        const area = (Number(fd.L) || 0) * (Number(fd.W) || 0);
        if (!(area > 0)) return;
        out.push({
          key: carpetKey(fi, zk, ri), fi, zk, ri, date: fn?.date || "", venue: fn?.venue || "",
          zoneName: (typeof zoneLabelOf === "function" ? zoneLabelOf(fn, zk) : zk) + (ri > 0 ? ` (floor ${ri + 1})` : ""),
          fnLabel: fn?.type || fn?.name || "", area, dims: `${Number(fd.L) || 0} x ${Number(fd.W) || 0} ft`, prefs: prefsOf(row),
        });
      });
    });
  });
  return out;
}

// Floors of OTHER functions of this event, at the same venue and date, that use this carpet (their decision, else their 1st choice) — it
// stays laid between them, so it is reusable, not a conflict. Same function = a different floor of the same setup, never a sibling.
export function siblingFloorsUsing(floor, id, floors, choice) {
  const v = norm(floor.venue);
  if (!v || !floor.date) return [];
  const out = [];
  (floors || []).forEach((g) => {
    if (!g || g.key === floor.key || g.fi === floor.fi || g.date !== floor.date || norm(g.venue) !== v) return;
    const used = choice?.[g.key]?.id || g.prefs[0]?.id;
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
  const reuse = holds.qty > 0 || siblings.length ? { qty: holds.qty, who: holds.who.map((w) => w.name), siblings } : null;
  const a = known ? reuseAwareAvail(free, reuse?.qty || 0, item?.qty, area) : null;
  return { id, name: item?.name || name, rank, free, known, reuse, enough: known && a.short === 0, short: known ? a.short : null, item };
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
    const picked = choice?.[f.key];
    const pickedId = picked?.id;
    const inOptions = !!pickedId && options.some((o) => o.id === pickedId);
    const manual = picked?.manual && pickedId && !inOptions && itemsById?.[pickedId]
      ? optionFor(pickedId, picked.name, itemsById[pickedId], null, blocks, f.date, eventId, f.area, null, ex(pickedId)) : null;
    const decidedId = inOptions ? pickedId : manual ? pickedId : null;
    return {
      ...f, options, manual, suggestedId, decidedId,
      // decided wins: a floor sales picked nothing for is still decided once Planning picks a carpet by hand
      status: decidedId ? "decided" : !options.length ? "none" : firstEnough || !options.some((o) => o.known) ? "open" : "short",
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
    const g = (groups[`${r.decidedId}|${r.date}`] ||= { id: r.decidedId, avail: reuseAwareAvail(o.free, o.reuse?.qty || 0, o.item?.qty, 0).avail, venues: {} });
    const vk = norm(r.venue);
    const fns = (g.venues[vk] ||= {});
    fns[r.fi] = (fns[r.fi] || 0) + r.area;
  });
  const over = {};
  Object.values(groups).forEach((g) => {
    const committed = Object.values(g.venues).reduce((sum, fns) => sum + Math.max(...Object.values(fns)), 0);
    if (committed > g.avail && !over[g.id]) over[g.id] = { free: g.avail, committed };
  });
  return { rows, over };
}

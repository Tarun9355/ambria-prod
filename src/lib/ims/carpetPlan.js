// Planning's carpet plan. Sales ranks up to three stock carpets per floor (lib/studio/carpetPrefs); here the Tenting
// head sees each floor's three with what is actually free on the event date, and decides which one is laid.
// The decision is IMS-owned (deptOps.Tenting.carpetChoice[key]) so every Studio sync leaves it alone.

import { prefsOf } from "../studio/carpetPrefs.js";
import { CARPET_OFF } from "../studio/taxonomy.js";

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
          key: carpetKey(fi, zk, ri), fi, zk, ri, date: fn?.date || "",
          zoneName: (typeof zoneLabelOf === "function" ? zoneLabelOf(fn, zk) : zk) + (ri > 0 ? ` (floor ${ri + 1})` : ""),
          fnLabel: fn?.type || fn?.name || "", area, dims: `${Number(fd.L) || 0} x ${Number(fd.W) || 0} ft`, prefs: prefsOf(row),
        });
      });
    });
  });
  return out;
}

// The plan: for each floor, its preferences with free sqft on the day, which one is suggested (the highest-ranked that covers the
// whole floor, else the one with most free), and which is decided. A decision for a carpet that is no longer one of the floor's
// preferences is ignored — the preferences changed under it.
// itemsById: { [id]: inventory item }, choice: { [key]: { id } }
export function planCarpets({ floors, itemsById, blocks, eventId, choice }) {
  const rows = (floors || []).map((f) => {
    const options = f.prefs.map((p, rank) => {
      const item = itemsById?.[p.id];
      const free = item ? freeForEvent(item, blocks, f.date, eventId) : (p.free ?? null);
      return { id: p.id, name: item?.name || p.name, rank, free, known: free !== null && free !== undefined, enough: free !== null && free !== undefined && free >= f.area, short: free !== null && free !== undefined ? Math.max(0, f.area - free) : null, item };
    });
    const firstEnough = options.find((o) => o.enough);
    const best = options.filter((o) => o.known).sort((a, b) => b.free - a.free || a.rank - b.rank)[0];
    const suggestedId = (firstEnough || best || options[0])?.id || null;
    const pickedId = choice?.[f.key]?.id;
    const decidedId = pickedId && options.some((o) => o.id === pickedId) ? pickedId : null;
    return {
      ...f, options, suggestedId, decidedId,
      status: !options.length ? "none" : decidedId ? "decided" : firstEnough || !options.some((o) => o.known) ? "open" : "short",
    };
  });
  // two floors deciding the same carpet draw on one stock: flag it when together they need more than is free
  const committed = {};
  rows.forEach((r) => { if (r.decidedId) committed[r.decidedId] = (committed[r.decidedId] || 0) + r.area; });
  const over = {};
  rows.forEach((r) => {
    if (!r.decidedId) return;
    const o = r.options.find((x) => x.id === r.decidedId);
    if (o?.known && committed[r.decidedId] > o.free) over[r.decidedId] = { free: o.free, committed: committed[r.decidedId] };
  });
  return { rows, over };
}

// Planning → Dept Ops → 🎨 Paint (owner ask 2026-11-01): every item on an event that is repainted, and in which colours.
//
// Paint is not a department of its own anywhere else - Deal Check files an item under the department that owns it, and
// the paint rides on the build: each zone element's paintAllocation ([{ qty, colour }]) or the older single paintOverride.
// So this reads the event's own layout (functionsDetail), not a department snapshot. A colour equal to the item's base
// colour (Ivory when unset) is no repaint - the same rule Studio prices paint by (lib/studio/paint.js).

import { normalizePaintAllocation, paintTotalFor, paintColoursOf } from "../studio/paint.js";

const nameKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const prettyZone = (zk) => String(zk || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// functionsDetail: the event order's functions. inventory: IMS items (id, name, baseColour, photoUrls / img).
// zoneLabel(fn, zk): the zone's display name (defaults to the zone's own name, else its key).
// defaultPaintCost: the per-piece repaint rate for an item with none of its own (IMS settings.defaultPaintCostPerItem, 400).
// Each row's `cost` is what the repaint adds to the bill, by Studio's own rule (paintTotalFor: the item's paint cost, else
// the highest in its sub-category, else the default), so it matches the paint in the deal's total.
// Returns { fns: [{ fi, label, date, rows }], colours: [{ colour, qty }], pieces, items }:
//   rows    - one per item per zone: { key, invId, name, photo, baseColour, qty, colours: [{ colour, qty }], painted, zk, zone }
//   colours - every colour over the event, most pieces first; a multi-colour piece ("Gold + Maroon") counts in each
//             of its colours (the paint to mix), while its item row keeps the combination as one entry
//   pieces  - pieces to paint over the event (a multi-colour piece once); items - how many rows; cost - the paint over the event
export function paintWorkOf({ functionsDetail = [], inventory = [], zoneLabel = null, defaultPaintCost = 400 } = {}) {
  const byId = new Map(), byName = new Map();
  (inventory || []).forEach((i) => {
    if (!i) return;
    if (i.id != null) byId.set(String(i.id), i);
    if (i.name) byName.set(nameKey(i.name), i);
  });
  const fnsIn = (Array.isArray(functionsDetail) ? functionsDetail : []).filter(Boolean);
  const allColours = new Map();
  let pieces = 0;
  const fns = [];
  fnsIn.forEach((fn, fi) => {
    const rows = new Map();
    Object.entries(fn.elements || {}).forEach(([zk, els]) => {
      if (fn.enabledEls && fn.enabledEls[zk] === false) return; // a zone switched off in Build is not built
      (Array.isArray(els) ? els : []).forEach((el) => {
        const id = el?.invId || el?.imsId;
        const inv = (id != null && byId.get(String(id))) || byName.get(nameKey(el?.name)) || null;
        const baseColour = String(inv?.baseColour || "Ivory");
        const allocs = normalizePaintAllocation(el, baseColour);
        if (!allocs.length) return;
        const name = inv?.name || String(el?.name || "").trim() || "Item";
        // the same item twice in one zone is one row: it is painted together
        const key = `${fi}|${zk}|${inv ? "i:" + inv.id : "n:" + nameKey(name)}`;
        const row = rows.get(key) || {
          key, invId: inv?.id ?? null, name, baseColour, qty: 0, cost: 0, colours: new Map(), zk,
          photo: (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || inv?.img || el?.photo || el?.img || "",
          zone: (zoneLabel && zoneLabel(fn, zk)) || fn.zoneNames?.[zk] || prettyZone(zk),
        };
        row.qty += Number(el?.qty) || 0;
        row.cost += paintTotalFor(el, { inventory, defaultPaintCost });
        allocs.forEach((a) => {
          const ck = nameKey(a.colour);
          const c = row.colours.get(ck) || { colour: a.colour, qty: 0 };
          c.qty += a.qty;
          row.colours.set(ck, c);
          pieces += a.qty;
          paintColoursOf(a.colour).forEach((one) => {
            const k1 = nameKey(one);
            const t = allColours.get(k1) || { colour: one, qty: 0 };
            t.qty += a.qty;
            allColours.set(k1, t);
          });
        });
        rows.set(key, row);
      });
    });
    if (!rows.size) return;
    const list = [...rows.values()].map((r) => {
      const colours = [...r.colours.values()].sort((a, b) => b.qty - a.qty);
      return { ...r, colours, painted: colours.reduce((s, c) => s + c.qty, 0) };
    }).sort((a, b) => a.zone.localeCompare(b.zone) || b.painted - a.painted);
    fns.push({ fi: fn.fnIdx ?? fi, label: fn.type || `Function ${fi + 1}`, date: fn.date || "", rows: list });
  });
  const colours = [...allColours.values()].sort((a, b) => b.qty - a.qty);
  return {
    fns, colours,
    pieces,
    cost: fns.reduce((s, f) => s + f.rows.reduce((t, r) => t + r.cost, 0), 0),
    items: fns.reduce((s, f) => s + f.rows.length, 0),
  };
}

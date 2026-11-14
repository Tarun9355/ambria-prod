// Paint: what an element costs to repaint in another colour. The rule lives here, once, so that the zone
// totals (Build, Summary, Live Estimate) and the cost sheet's "Paint:" lines can never disagree again — they
// used to: the cost sheet listed paint inside a zone but the totals left it out (₹800 on Test 2).

// An element's colour allocation: [{ qty, colour }] for the units that are repainted (a colour other than the
// item's base colour). Either an explicit multi-colour split (el.paintAllocation) or one override for all units.
export function normalizePaintAllocation(el, baseColour) {
  if (!el) return [];
  const totalQty = Number(el.qty) || 0;
  if (totalQty <= 0) return [];
  if (Array.isArray(el.paintAllocation) && el.paintAllocation.length > 0) {
    return el.paintAllocation
      .filter(a => a && Number(a.qty) > 0 && a.colour && a.colour !== baseColour)
      .map(a => ({ qty: Number(a.qty), colour: String(a.colour) }));
  }
  if (el.paintOverride && el.paintOverride !== baseColour) {
    return [{ qty: totalQty, colour: String(el.paintOverride) }];
  }
  return [];
}

// A multi-colour piece (owner ask 2026-11-14 — e.g. one J Arch in Gold and Maroon) is one allocation row whose colour
// joins its colours with " + " ("Gold + Maroon"), so every place that prints a colour name shows it as it is.
export const PAINT_SEP = " + ";
export const paintColoursOf = (colour) => String(colour || "").split("+").map(s => s.trim()).filter(Boolean);
export const joinPaintColours = (colours) => [...new Set((colours || []).map(c => String(c || "").trim()).filter(Boolean))].join(PAINT_SEP);
// Colours actually painted on each piece of a row: every colour but the item's base colour (it is already that
// colour), at least 1. Each colour is charged — 2 colours = 2 × the paint cost per piece.
export const paintCoatsOf = (colour, baseColour) => {
  const cs = paintColoursOf(colour);
  return Math.max(1, cs.filter(c => c !== (baseColour || "Ivory")).length);
};

// The highest repaint cost among the items of a sub-category — the rate used when the element's own item
// carries none. `fallback` when the sub-category has no paint cost at all.
export function maxRepaintCostInSubcat(rcSub, imsInventory, fallback) {
  if (!imsInventory || imsInventory.length === 0 || !rcSub) return fallback;
  const target = String(rcSub).toLowerCase().trim();
  let mx = 0;
  imsInventory.forEach(item => {
    const sub = String(item.subcategory || item.subCat || item.sub || "").toLowerCase().trim();
    if (sub === target) {
      const pc = Number(item.paintCost || 0);
      if (pc > mx) mx = pc;
    }
  });
  return mx > 0 ? mx : fallback;
}

// The paint lines for one element: one per colour it is repainted in — { colour, baseColour, qty, coats, rate, total }.
// rate = the item's own paint cost, else the sub-category's highest, else the IMS default (400); a multi-colour
// row is charged once per painted colour (coats).
// Not scaled by the guest price level or the date category: paint is charged at its plain rate, as the cost
// sheet has always shown it.
export function paintLinesFor(el, { rcSub, inventory, defaultPaintCost } = {}) {
  if (el?.foc) return []; // left at the venue, not repainted for this event
  if (!(Number(el?.qty) > 0)) return [];
  const inv = Array.isArray(inventory) ? inventory : [];
  const invItem = (el.invId != null && inv.find(i => String(i.id) === String(el.invId))) || inv.find(i => i.name === el.name);
  const baseColour = invItem?.baseColour || "Ivory";
  // An element added from Inventory has no rate-card row (rcSub empty) — its own Inventory sub-category is the one
  // to take the highest from, the same fallback Build's paint pill uses; it used to drop straight to the default.
  const sub = rcSub || invItem?.subCat || invItem?.subcategory || "";
  const rate = Number(invItem?.paintCost) > 0 ? Number(invItem.paintCost) : maxRepaintCostInSubcat(sub, inv, defaultPaintCost ?? 400);
  return normalizePaintAllocation(el, baseColour)
    .map(a => { const coats = paintCoatsOf(a.colour, baseColour); return { colour: a.colour, baseColour, qty: a.qty, coats, rate, total: rate * a.qty * coats }; })
    .filter(l => l.total > 0);
}

export const paintTotalFor = (el, ctx) => paintLinesFor(el, ctx).reduce((s, l) => s + l.total, 0);

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

// The paint lines for one element: one per colour it is repainted in — { colour, baseColour, qty, rate, total }.
// rate = the item's own paint cost, else the sub-category's highest, else the IMS default (400).
// Not scaled by the guest price level or the date category: paint is charged at its plain rate, as the cost
// sheet has always shown it.
export function paintLinesFor(el, { rcSub, inventory, defaultPaintCost } = {}) {
  if (!(Number(el?.qty) > 0)) return [];
  const inv = Array.isArray(inventory) ? inventory : [];
  const invItem = inv.find(i => i.name === el.name);
  const baseColour = invItem?.baseColour || "Ivory";
  const rate = invItem?.paintCost ? invItem.paintCost : maxRepaintCostInSubcat(rcSub, inv, defaultPaintCost ?? 400);
  return normalizePaintAllocation(el, baseColour)
    .map(a => ({ colour: a.colour, baseColour, qty: a.qty, rate, total: rate * a.qty }))
    .filter(l => l.total > 0);
}

export const paintTotalFor = (el, ctx) => paintLinesFor(el, ctx).reduce((s, l) => s + l.total, 0);

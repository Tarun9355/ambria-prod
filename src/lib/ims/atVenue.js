// ── ALREADY AT THE VENUE: FIXED, REPEAT OR FOC ── (owner ask 2026-11-11; shared with the Site page 2026-11-26)
// Fixed: standing stock of the item at the event's fixed venue (Settings → Fixed Venues) - the most standing at any of its
// functions' venues, up to the qty. Repeat: the item set to Repeat in Build (an element's ♻ Repeat) - it stays from before.
// FOC: left at the venue from a previous event. None of them is loaded: Truck planning lists them apart, no challan carries
// them, and the Site page's Receiving shows them as at the venue rather than short. An item only partly standing loads the rest.
// Returns (item { id, invId, qty, foc }) → { fixed, repeat, foc, load }.
import { standingQty } from "./fixedVenues";

export function atVenueOfEvent(sel, fvSettings, inventory) {
  const fnsV = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
  const venues = [...new Set([sel?.venue, ...fnsV.map(f => f?.venue)].filter(Boolean))];
  // Repeat only when EVERY use of the item is set to Repeat - one function repeating it while another needs it fresh still loads it.
  const repeatIds = new Set(), freshIds = new Set();
  // the venues of the functions that use each item - only their standing stock counts for it (two functions at two venues)
  const venuesOfItem = new Map();
  fnsV.forEach(f => Object.values(f?.elements || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(el => {
    const id = el?.invId || el?.imsId;
    if (!id) return;
    // A FOC'd instance of this item must not count as "fresh" here — it has its own, separate
    // blockedItems row (never merged with a non-FOC row of the same id, see the merge key fix
    // above) and is never loaded regardless. Folding it into freshIds would wrongly force a
    // DIFFERENT, Repeat-marked instance of the same item id to lose its "already standing, don't
    // load" status, since repeat only holds when EVERY use resolves non-fresh.
    if (el?.foc) return;
    (el?.repeatOverride === true ? repeatIds : freshIds).add(String(id));
    const v = f?.venue || sel?.venue;
    if (v) (venuesOfItem.get(String(id)) || venuesOfItem.set(String(id), new Set()).get(String(id))).add(v);
    // a kit's parts (their own lines in the blocked list) go with the kit: repeated with it, or fresh with it
    const kitItem = (inventory || []).find(i => String(i.id) === String(id));
    const parts = Array.isArray(el?.kitOverrides) ? el.kitOverrides : (Array.isArray(kitItem?.subItems) ? kitItem.subItems : []);
    parts.forEach(p => { if (p?.itemId) (el?.repeatOverride === true ? repeatIds : freshIds).add(String(p.itemId)); });
  })));
  const memo = new Map();
  return (it) => {
    if (!it) return { fixed: 0, repeat: false, load: 0 };
    // FOC — left at the venue from a previous event (dcCostRollup's own FOC branch tags the row,
    // DealCheckOverlay.jsx): never loaded, same as Fixed/Repeat, but its own distinct reason so the
    // "leave at venue" badge below can say so rather than claiming it's standing stock or reused.
    if (it.foc) return { fixed: 0, repeat: false, foc: true, load: 0 };
    // keyed by the qty too: the same line can be read at the whole event's qty and at one function's
    const mk = `${it.id}|${it.invId}|${it.qty}`;
    if (memo.has(mk)) return memo.get(mk);
    const qty = Number(it.qty) || 0;
    // a kit part is not an element of its own: it falls back to every venue of the event
    const vs = it.invId ? [...(venuesOfItem.get(String(it.invId)) || venues)] : [];
    const fixed = it.invId ? Math.min(qty, Math.max(0, ...vs.map(v => standingQty(fvSettings, v, it.invId)))) : 0;
    const repeat = !!it.invId && repeatIds.has(String(it.invId)) && !freshIds.has(String(it.invId));
    const r = { fixed, repeat, load: repeat ? 0 : Math.max(0, qty - fixed) };
    memo.set(mk, r);
    return r;
  };
}

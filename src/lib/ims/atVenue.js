// ── ALREADY AT THE VENUE: FIXED, REPEAT OR FOC ── (owner ask 2026-11-11; shared with the Site page 2026-11-26)
// Fixed: standing stock of the item at the event's fixed venue (Settings → Fixed Venues) - the most standing at any of its
// functions' venues, up to the qty. Repeat: the item set to Repeat in Build (an element's ♻ Repeat) - it stays from before.
// FOC: left at the venue from a previous event. None of them is loaded: Truck planning lists them apart, no challan carries
// them, and the Site page's Receiving shows them as at the venue rather than short. An item only partly standing loads the rest.
// Returns (item { id, invId, qty, foc }) → { fixed, repeat, foc, load }.
import { standingQty } from "./fixedVenues";
import { repeatCatFor } from "../studio/pricing.js";

export function atVenueOfEvent(sel, fvSettings, inventory) {
  const fnsV = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
  const venues = [...new Set([sel?.venue, ...fnsV.map(f => f?.venue)].filter(Boolean))];
  // Repeat only when EVERY use of the item is set to Repeat - one function repeating it while another needs it fresh still loads it.
  const repeatIds = new Set(), freshIds = new Set();
  // the venues of the functions that use each item - only their standing stock counts for it (two functions at two venues)
  const venuesOfItem = new Map();
  // How many of each item each venue needs: item -> venue -> the most any one function there uses (the same pieces serve that venue's
  // functions). Venue audit 2026-11-27: a Fixed Venue's standing stock was taken off the WHOLE event's quantity, so 20 chairs standing at
  // Pushpanjali (needing 10) cancelled Exotica's 10 too and nothing loaded. Standing stock now covers only its own venue's need.
  const needAt = new Map();
  const addNeed = (id, v, fi, q) => {
    if (!id || !v || !(q > 0)) return;
    const k = String(id), vk = String(v).trim().toLowerCase();
    const byV = needAt.get(k) || needAt.set(k, new Map()).get(k);
    const byF = byV.get(vk) || byV.set(vk, { venue: v, fns: new Map() }).get(vk);
    byF.fns.set(fi, (byF.fns.get(fi) || 0) + q);
  };
  // An element repeats by its own ♻ chip (el.repeatOverride) or, with no chip of its own, by its zone's Repeat (the zone toggle or its
  // Elements chip - repeatCatFor), the same rule Deal Check prices and trucks by. Reading only the element's own chip missed a whole
  // zone set to Repeat (owner check 2026-11-26).
  fnsV.forEach((f, fi) => Object.entries(f?.elements || {}).forEach(([zk, list]) => (Array.isArray(list) ? list : []).forEach(el => {
    const isRepeat = typeof el?.repeatOverride === "boolean" ? el.repeatOverride : repeatCatFor(f?.zones?.[zk], "elements");
    const id = el?.invId || el?.imsId;
    if (!id) return;
    // A FOC'd instance of this item must not count as "fresh" here — it has its own, separate
    // blockedItems row (never merged with a non-FOC row of the same id, see the merge key fix
    // above) and is never loaded regardless. Folding it into freshIds would wrongly force a
    // DIFFERENT, Repeat-marked instance of the same item id to lose its "already standing, don't
    // load" status, since repeat only holds when EVERY use resolves non-fresh.
    if (el?.foc) return;
    (isRepeat ? repeatIds : freshIds).add(String(id));
    const v = f?.venue || sel?.venue;
    if (v) (venuesOfItem.get(String(id)) || venuesOfItem.set(String(id), new Set()).get(String(id))).add(v);
    const elQty = Number(el?.qty) || 1;
    addNeed(id, v, fi, elQty);
    // a kit's parts (their own lines in the blocked list) go with the kit: repeated with it, or fresh with it
    const kitItem = (inventory || []).find(i => String(i.id) === String(id));
    const parts = Array.isArray(el?.kitOverrides) ? el.kitOverrides : (Array.isArray(kitItem?.subItems) ? kitItem.subItems : []);
    parts.forEach(p => {
      if (!p?.itemId) return;
      (isRepeat ? repeatIds : freshIds).add(String(p.itemId));
      if (v) (venuesOfItem.get(String(p.itemId)) || venuesOfItem.set(String(p.itemId), new Set()).get(String(p.itemId))).add(v);
      addNeed(p.itemId, v, fi, elQty * (Number(p.qty) || 1));
    });
  })));
  const memo = new Map();
  return (it) => {
    if (!it) return { fixed: 0, repeat: false, load: 0 };
    // FOC — left at the venue from a previous event (dcCostRollup's own FOC branch tags the row,
    // DealCheckOverlay.jsx): never loaded, same as Fixed/Repeat, but its own distinct reason so the
    // "leave at venue" badge below can say so rather than claiming it's standing stock or reused.
    if (it.foc) return { fixed: 0, repeat: false, foc: true, load: 0 };
    // keyed by the qty too: the same line can be read at the whole event's qty and at one function's
    const mk = `${it.id}|${it.invId}|${it.qty}|${it.venue || ""}`;
    if (memo.has(mk)) return memo.get(mk);
    const qty = Number(it.qty) || 0;
    // a kit part is not an element of its own: it falls back to every venue of the event
    const vs = it.invId ? [...(venuesOfItem.get(String(it.invId)) || venues)] : [];
    let fixed = 0;
    if (it.invId && it.venue) {
      // one function's line (Planning's one-function view passes its venue): that venue's standing stock only
      fixed = Math.min(qty, standingQty(fvSettings, it.venue, it.invId));
    } else if (it.invId) {
      const byV = needAt.get(String(it.invId));
      if (byV && byV.size > 1) {
        // used at several venues: each venue's standing stock covers that venue's own need, never another venue's
        let credit = 0;
        byV.forEach(({ venue, fns }) => { credit += Math.min(Math.max(0, ...fns.values()), standingQty(fvSettings, venue, it.invId)); });
        fixed = Math.min(qty, credit);
      } else {
        fixed = Math.min(qty, Math.max(0, ...vs.map(v => standingQty(fvSettings, v, it.invId))));
      }
    }
    const repeat = !!it.invId && repeatIds.has(String(it.invId)) && !freshIds.has(String(it.invId));
    const r = { fixed, repeat, load: repeat ? 0 : Math.max(0, qty - fixed) };
    memo.set(mk, r);
    return r;
  };
}

// The same, over a whole list of load rows at once: an item standing at the venue is taken off ONCE across its rows (owner's QA
// audit 2026-11-26: 10 standing pieces of an item used as a kit part ×10 and loose ×10 were taken off each row, so neither loaded).
// Rows are served in list order, each taking what is still standing. Returns Map(row.id -> { fixed, repeat, foc, load }).
export function atVenueByRow(rows, atVenueOf) {
  const left = new Map();
  const out = new Map();
  (rows || []).forEach((it) => {
    if (!it) return;
    const a = atVenueOf(it);
    if (!it.invId || a.repeat || a.foc || !(a.fixed > 0)) { out.set(it.id, a); return; }
    const id = String(it.invId);
    if (!left.has(id)) left.set(id, atVenueOf({ id: "__standing:" + id, invId: it.invId, qty: 1e9 }).fixed || 0);
    const qty = Number(it.qty) || 0;
    const fixed = Math.min(qty, left.get(id));
    left.set(id, left.get(id) - fixed);
    out.set(it.id, { ...a, fixed, load: Math.max(0, qty - fixed) });
  });
  return out;
}


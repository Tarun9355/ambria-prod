// Cross-function reuse: two functions of the SAME deal, same venue, on the same day or the next —
// e.g. a Sundowner Cocktail followed the next night by the Wedding. The ONE shared definition of
// "is there a reuse-eligible sibling function" — Build's guest-facing element discount, Build's
// guest-facing transport waiver, Ambria's own internal-cost truck/truss carryover
// (calcFunctionBreakdown), and Deal Check's own cost-basis discounts (inventory rental, truss,
// florals) all read this, so none of them can drift into a different definition of "consecutive at
// the same venue". Moved out of StudioApp.jsx (where it originated) so DealCheckOverlay.jsx can
// import it too without a circular import back into StudioApp.jsx.

// The immediately-preceding function (by date), same venue string (case/trim-insensitive), on the
// SAME calendar date or exactly the NEXT one — no gap day between them — or null if there isn't
// one. `allFns` is collectAllFunctionData()'s own return.
//
// Calendar-date adjacency, not a fixed hour count: this used to map each shift to a made-up
// representative hour (Sundowner ~5pm, Night ~7pm, etc) and require the two functions to land
// within a literal 24h of each other. That silently failed this mechanism's own flagship example —
// "a Sundowner Cocktail followed the next night by the Wedding" — because 5pm one day to 7pm the
// next is 26 hours, over the 24h cutoff, so the two were never recognized as consecutive at all.
// What "immediately preceding, still reusable" actually means physically is "no empty day in
// between" — which calendar dates answer directly, with no guessing at clock times a shift name
// doesn't actually carry.
export function findCrossFnReuseSource(fnData, allFns) {
  if (!fnData?.fnVenue || !fnData?.fnDate) return null;
  const sorted = [...(allFns || [])].sort((a, b) => (a.fnDate || "9999-12-31").localeCompare(b.fnDate || "9999-12-31"));
  const myPos = sorted.findIndex(f => f.fnIdx === fnData.fnIdx);
  const prev = myPos > 0 ? sorted[myPos - 1] : null;
  if (!prev || !prev.fnVenue || !prev.fnDate) return null;
  if (prev.fnVenue.toLowerCase().trim() !== fnData.fnVenue.toLowerCase().trim()) return null;
  const t1 = Date.parse(prev.fnDate), t2 = Date.parse(fnData.fnDate);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  const dayDiff = Math.round((t2 - t1) / (24 * 60 * 60 * 1000));
  if (dayDiff < 0 || dayDiff > 1) return null;
  return prev;
}

// Per-invId qty a function used, top-level elements only (no kit-component walk — the
// cross-function reuse discount, guest-facing or Deal-Check-internal, is scoped to plain rental
// items). Sibling to computeFnSubQty (StudioApp.jsx), at item identity instead of
// truck-capacity-subcategory granularity.
export function computeFnInvQty(fnData) {
  const m = {};
  const fZoneElements = fnData?.zoneElements || {};
  const fEnabledEls = fnData?.enabledEls || {};
  Object.entries(fZoneElements).forEach(([zk, elems]) => {
    if (!fEnabledEls[zk] || !elems) return;
    elems.forEach(el => { if (el.invId) m[el.invId] = (m[el.invId] || 0) + (Number(el.qty) || 0); });
  });
  return m;
}

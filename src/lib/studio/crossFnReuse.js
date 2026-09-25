// Cross-function reuse: two functions of the SAME deal, same venue, within 24h of each other —
// e.g. a Sundowner Cocktail followed the next night by the Wedding. The ONE shared definition of
// "is there a reuse-eligible sibling function" — Build's guest-facing element discount, Build's
// guest-facing transport waiver, Ambria's own internal-cost truck/truss carryover
// (calcFunctionBreakdown), and Deal Check's own cost-basis discounts (inventory rental, truss,
// florals) all read this, so none of them can drift into a different definition of "within 24h at
// the same venue". Moved out of StudioApp.jsx (where it originated) so DealCheckOverlay.jsx can
// import it too without a circular import back into StudioApp.jsx.

// fnDate alone has no time-of-day, so a shift is mapped to a representative hour purely to compare
// two functions' rough elapsed time; it is never shown to anyone or used for any other purpose.
const SHIFT_HOUR = { Morning: 10, Lunch: 13, Sundowner: 17, Night: 19 };
function fnTimestamp(fnData) {
  if (!fnData?.fnDate) return null;
  const hour = SHIFT_HOUR[fnData.fnShift] ?? 12;
  const t = new Date(`${fnData.fnDate}T${String(hour).padStart(2, "0")}:00:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

// The immediately-preceding function (by date), same venue string (case/trim-insensitive), within
// 24h of this one — or null if there isn't one. `allFns` is collectAllFunctionData()'s own return.
export function findCrossFnReuseSource(fnData, allFns) {
  if (!fnData?.fnVenue) return null;
  const sorted = [...(allFns || [])].sort((a, b) => (a.fnDate || "9999-12-31").localeCompare(b.fnDate || "9999-12-31"));
  const myPos = sorted.findIndex(f => f.fnIdx === fnData.fnIdx);
  const prev = myPos > 0 ? sorted[myPos - 1] : null;
  if (!prev || !prev.fnVenue) return null;
  if (prev.fnVenue.toLowerCase().trim() !== fnData.fnVenue.toLowerCase().trim()) return null;
  const tMe = fnTimestamp(fnData), tPrev = fnTimestamp(prev);
  if (tMe == null || tPrev == null) return null;
  if (Math.abs(tMe - tPrev) > 24 * 60 * 60 * 1000) return null;
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

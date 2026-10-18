// Cross-function reuse: two functions of the SAME deal, same venue, on the same day or the next —
// e.g. a Sundowner Cocktail followed the next night by the Wedding. The ONE shared definition of
// "is there a reuse-eligible sibling function" — Build's guest-facing element discount, Build's
// guest-facing transport waiver, Ambria's own internal-cost truck/truss carryover
// (calcFunctionBreakdown), and Deal Check's own cost-basis discounts (inventory rental, truss,
// florals) all read this, so none of them can drift into a different definition of "consecutive at
// the same venue". Moved out of StudioApp.jsx (where it originated) so DealCheckOverlay.jsx can
// import it too without a circular import back into StudioApp.jsx.

// Every sibling function at the same venue (case/trim-insensitive) that's reuse-eligible for
// fnData — on the SAME calendar date, or exactly the day before — merged into ONE synthetic
// function-shaped object, or null if there isn't one. `allFns` is collectAllFunctionData()'s own
// return. Callers all just read zoneElements/enabledEls/zoneConfig off whatever this returns
// (computeFnInvQty, computeFnSubQty, or a direct zoneConfig/enabledEls check for a given zone), so
// a merged object drops straight in with no caller changes needed.
//
// Calendar-date adjacency, not a fixed hour count: this used to map each shift to a made-up
// representative hour (Sundowner ~5pm, Night ~7pm, etc) and require the two functions to land
// within a literal 24h of each other. That silently failed this mechanism's own flagship example —
// "a Sundowner Cocktail followed the next night by the Wedding" — because 5pm one day to 7pm the
// next is 26 hours, over the 24h cutoff, so the two were never recognized as consecutive at all.
// What "immediately preceding, still reusable" actually means physically is "no empty day in
// between" — which calendar dates answer directly, with no guessing at clock times a shift name
// doesn't actually carry.
//
// Merged, not "nearest only": owner-reported — a 3-function booking (Haldi + Cocktail both on day
// 1, Wedding on day 2, all the same venue) still showed zero reuse credit for Warm LED between
// Cocktail and Wedding. The OLD code picked a single "immediately preceding" function by date-sort
// position — with two functions sharing day 1, whichever of Haldi/Cocktail didn't land in that one
// slot (an accident of array order, not physical reality) was invisible to reuse entirely, even
// though both functions' setups are equally still standing at the venue for Wedding to draw on.
export function findCrossFnReuseSource(fnData, allFns) {
  if (!fnData?.fnVenue || !fnData?.fnDate) return null;
  const venue = fnData.fnVenue.toLowerCase().trim();
  const myDate = Date.parse(fnData.fnDate);
  if (!Number.isFinite(myDate)) return null;
  const eligible = (allFns || []).filter(f => {
    if (f === fnData || f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return false;
    if (f.fnVenue.toLowerCase().trim() !== venue) return false;
    const t = Date.parse(f.fnDate);
    if (!Number.isFinite(t)) return false;
    const dayDiff = Math.round((myDate - t) / (24 * 60 * 60 * 1000));
    return dayDiff === 0 || dayDiff === 1; // same calendar date, or exactly the day before
  });
  if (!eligible.length) return null;
  if (eligible.length === 1) return eligible[0]; // no merge needed — identical to the old behaviour
  const zoneElements = {}, enabledEls = {}, zoneConfig = {};
  eligible.forEach(f => {
    Object.entries(f.zoneElements || {}).forEach(([zk, elems]) => {
      if (!f.enabledEls?.[zk] || !Array.isArray(elems)) return;
      zoneElements[zk] = [...(zoneElements[zk] || []), ...elems];
      enabledEls[zk] = true;
      if (f.zoneConfig?.[zk] && !zoneConfig[zk]) zoneConfig[zk] = f.zoneConfig[zk];
    });
  });
  return { fnVenue: fnData.fnVenue, fnDate: fnData.fnDate, fnIdx: -1, fnType: eligible.map(f => f.fnType || "").filter(Boolean).join(" + "), zoneElements, enabledEls, zoneConfig };
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

// Build's orange "already used in another function" marker. Unlike findCrossFnReuseSource (which only
// looks BACK at the one immediately-preceding function, because a discount can only be claimed once),
// this looks both ways at EVERY sibling function of the deal at the same venue on the same or next
// calendar date — same adjacency rule as above — so the shared item is flagged in both functions.
// Returns { [invId]: [label, ...] } with each sibling's type/date as the label, or {} when none.
export function findSiblingFnInvUse(fnData, allFns) {
  const out = {};
  if (!fnData?.fnVenue || !fnData?.fnDate) return out;
  const venue = fnData.fnVenue.toLowerCase().trim();
  const t = Date.parse(fnData.fnDate);
  if (!Number.isFinite(t)) return out;
  (allFns || []).forEach(f => {
    if (f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return;
    if (f.fnVenue.toLowerCase().trim() !== venue) return;
    const t2 = Date.parse(f.fnDate);
    if (!Number.isFinite(t2) || Math.abs(Math.round((t2 - t) / (24 * 60 * 60 * 1000))) > 1) return;
    const label = f.fnType || `Function ${f.fnIdx + 1}`;
    Object.entries(computeFnInvQty(f)).forEach(([invId, q]) => {
      if (!(q > 0)) return;
      (out[invId] ||= []).includes(label) || out[invId].push(label);
    });
  });
  return out;
}

// Build's orange "📦 could reuse a sibling function's item" marker — a step EARLIER than
// findSiblingFnInvUse above. That one flags an item already matching exactly; this one flags a
// DIFFERENT item that could be SWAPPED to the one a sibling function (same venue, same/next calendar
// day — identical adjacency rule) is using from the SAME sub-category, so the salesperson sees the
// discount opportunity before taking it, not just confirmation after. Once the swap happens, the
// element's invId matches exactly and findSiblingFnInvUse's own orange rate takes over — this map
// naturally stops flagging it (the opportunity is gone, already taken), so the two markers never
// fight: at most one is ever shown for the same element at a time.
// Returns { [subcatKey]: [{invId, name, label}, …] } — deduped by invId within each sub-category.
export function findSiblingFnSubcatOpportunity(fnData, allFns, imsInventory) {
  const out = {};
  if (!fnData?.fnVenue || !fnData?.fnDate) return out;
  const venue = fnData.fnVenue.toLowerCase().trim();
  const t = Date.parse(fnData.fnDate);
  if (!Number.isFinite(t)) return out;
  const invById = new Map((imsInventory || []).map(i => [i.id, i]));
  (allFns || []).forEach(f => {
    if (f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return;
    if (f.fnVenue.toLowerCase().trim() !== venue) return;
    const t2 = Date.parse(f.fnDate);
    if (!Number.isFinite(t2) || Math.abs(Math.round((t2 - t) / (24 * 60 * 60 * 1000))) > 1) return;
    const label = f.fnType || `Function ${f.fnIdx + 1}`;
    Object.entries(computeFnInvQty(f)).forEach(([invId, q]) => {
      if (!(q > 0)) return;
      const item = invById.get(invId);
      const subcat = String(item?.subCat || item?.subcategory || "").trim().toLowerCase();
      if (!subcat) return;
      const bucket = (out[subcat] ||= []);
      if (!bucket.some(e => e.invId === invId)) bucket.push({ invId, name: item?.name || invId, label });
    });
  });
  return out;
}

// Connected groups of functions at the same venue with no gap day anywhere along the chain —
// same pairwise adjacency rule as findCrossFnReuseSource above (same calendar date, or exactly
// the day before/after), but as a full graph instead of "this one function's eligible siblings":
// three same-day functions at one venue all land in ONE group together, not three separate
// pairwise pools.
//
// Dept Ops' "Inventory blocked" qty needs this instead of findCrossFnReuseSource's own per-function
// pool for a different reason than pricing does: pricing legitimately charges each function's own
// card at its own discount, so a chain of independent pairwise credits is fine there. But the
// PHYSICAL peak — how many of an item are ever on site at once — is the single largest ask any one
// function in the whole connected group makes, not a sum of pairwise "already used by my immediate
// neighbour" credits. With only two functions those give the same answer; with three or more
// sharing a day, each function's own pool (built from every OTHER sibling's need, per
// findCrossFnReuseSource) double- and triple-counts the same physical units as reusable from
// multiple directions at once, so every function nets its own need down toward zero even though
// nothing is actually overbought — the group's one true peak is the fix, computed once here instead
// of trusting that chain's output as a stand-in for it.
//
// Returns a plain array, positionally indexed to match `allFns` (callers already loop it as
// `fns.forEach((fn, fi) => …)` with `fi` as the shared index into byFn/deptInv/etc.) — groups[i] is
// an arbitrary but stable id shared by every function in the same connected component.
export function groupConsecutiveFns(allFns) {
  const fns = allFns || [];
  const parent = fns.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < fns.length; i++) {
    const fi = fns[i];
    if (!fi?.fnVenue || !fi?.fnDate) continue;
    const vi = fi.fnVenue.toLowerCase().trim();
    const ti = Date.parse(fi.fnDate);
    if (!Number.isFinite(ti)) continue;
    for (let j = i + 1; j < fns.length; j++) {
      const fj = fns[j];
      if (!fj?.fnVenue || !fj?.fnDate || fj.fnVenue.toLowerCase().trim() !== vi) continue;
      const tj = Date.parse(fj.fnDate);
      if (!Number.isFinite(tj)) continue;
      if (Math.abs(Math.round((tj - ti) / (24 * 60 * 60 * 1000))) <= 1) union(i, j);
    }
  }
  return fns.map((_, i) => find(i));
}

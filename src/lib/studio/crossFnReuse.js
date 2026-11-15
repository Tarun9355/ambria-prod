import { venueKey } from "../venueKey.js";
import { walkKitUnits } from "../ims/helpers.js";

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
  const venue = venueKey(fnData.fnVenue);
  const myDate = Date.parse(fnData.fnDate);
  if (!Number.isFinite(myDate)) return null;
  const eligible = (allFns || []).filter(f => {
    if (f === fnData || f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return false;
    if (venueKey(f.fnVenue) !== venue) return false;
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

// Per-invId qty a function used — top-level elements, AND (when imsInventory is given) every
// component a kit element draws, recursively, via the SAME walkKitUnits node-walker
// priceForInvItem/transport/reservation already share. Sibling to computeFnSubQty (StudioApp.jsx),
// at item identity instead of truck-capacity-subcategory granularity.
// `imsInventory` is optional and trailing — a caller that omits it keeps the exact old top-level-only
// behavior (walkKitUnits can't find a kit's own subItems without the inventory list to resolve
// component ids against, so a kit element just falls through to the plain top-level add below,
// identical to before this parameter existed). Passing it is a strict superset: a kit element (e.g.
// a lounge kit with 4 sofas inside) now ALSO credits its components, which previously earned a
// sibling function ZERO reuse credit even though the sofas are standing there just as much as a
// plain top-level sofa row would be (bug 5, 2026-11-15 adversarial matrix — computeFnInvQty was the
// one reuse-pool builder in the app that stayed top-level-only after fnUnitQty, dealAvailability.js,
// was made kit-aware for the exact same reason).
//
// KNOWN RESIDUAL RISK (regression review, 2026-11-15, round 4 — deliberately NOT fixed here, same
// "left for a dedicated future pass" posture allocateRowAvailability's own header comment already
// takes for this exact category of problem): every existing consumer draws this pool with a flat
// `pool.get(invId)`/`pool.set(invId, …)` take, with no idea that a kit's OWN id (e.g. "LOUNGE") and
// its components' ids (e.g. "SOFA") can now BOTH be present at once, representing the SAME physical
// stock from two different granularities. If the function CONSUMING this pool has both an element
// using the exact same kit AND a separate plain element for one of that kit's own components (e.g. a
// LOUNGE kit element plus standalone extra sofas, in the same reuse-eligible window), each can
// independently draw full credit from this one pool — double-crediting the same physical units. The
// bug this fix targets (a plain component row earning ZERO credit for a kit-nested sibling item) does
// not trigger this — it only arises in that narrower combined case. Fully closing it needs a shared,
// kit-aware take helper at every consumption site (StudioApp.jsx's reusePool/pricingPool/
// transportPool/clientTruckPool, DealCheckOverlay.jsx's _crossFnTake*), which is a wider change than
// this fix's scope; flagged here rather than silently shipped.
export function computeFnInvQty(fnData, imsInventory) {
  const m = {};
  const fZoneElements = fnData?.zoneElements || {};
  const fEnabledEls = fnData?.enabledEls || {};
  Object.entries(fZoneElements).forEach(([zk, elems]) => {
    if (!fEnabledEls[zk] || !elems) return;
    elems.forEach(el => {
      if (!el.invId || el.foc) return; // FOC earns no reuse credit for a different function
      const q = Number(el.qty) || 0;
      if (!(q > 0)) return;
      const item = (imsInventory || []).find(i => i.id === el.invId);
      if (item && Array.isArray(item.subItems) && item.subItems.length) {
        walkKitUnits(item, q, imsInventory, el.kitOverrides, (node, nodeQty) => { if (node?.id) m[node.id] = (m[node.id] || 0) + (Number(nodeQty) || 0); });
      } else {
        m[el.invId] = (m[el.invId] || 0) + q;
      }
    });
  });
  return m;
}

// Build's orange "already used in another function" marker. Unlike findCrossFnReuseSource (which only
// looks BACK at the one immediately-preceding function, because a discount can only be claimed once),
// this looks both ways at EVERY sibling function of the deal at the same venue on the same or next
// calendar date — same adjacency rule as above — so the shared item is flagged in both functions.
// Returns { [invId]: [label, ...] } with each sibling's type/date as the label, or {} when none.
export function findSiblingFnInvUse(fnData, allFns, imsInventory) {
  const out = {};
  if (!fnData?.fnVenue || !fnData?.fnDate) return out;
  const venue = venueKey(fnData.fnVenue);
  const t = Date.parse(fnData.fnDate);
  if (!Number.isFinite(t)) return out;
  (allFns || []).forEach(f => {
    if (f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return;
    if (venueKey(f.fnVenue) !== venue) return;
    const t2 = Date.parse(f.fnDate);
    if (!Number.isFinite(t2) || Math.abs(Math.round((t2 - t) / (24 * 60 * 60 * 1000))) > 1) return;
    const label = f.fnType || `Function ${f.fnIdx + 1}`;
    Object.entries(computeFnInvQty(f, imsInventory)).forEach(([invId, q]) => {
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
  const venue = venueKey(fnData.fnVenue);
  const t = Date.parse(fnData.fnDate);
  if (!Number.isFinite(t)) return out;
  const invById = new Map((imsInventory || []).map(i => [i.id, i]));
  (allFns || []).forEach(f => {
    if (f.fnIdx === fnData.fnIdx || !f.fnVenue || !f.fnDate) return;
    if (venueKey(f.fnVenue) !== venue) return;
    const t2 = Date.parse(f.fnDate);
    if (!Number.isFinite(t2) || Math.abs(Math.round((t2 - t) / (24 * 60 * 60 * 1000))) > 1) return;
    const label = f.fnType || `Function ${f.fnIdx + 1}`;
    Object.entries(computeFnInvQty(f, imsInventory)).forEach(([invId, q]) => {
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
    const vi = venueKey(fi.fnVenue);
    const ti = Date.parse(fi.fnDate);
    if (!Number.isFinite(ti)) continue;
    for (let j = i + 1; j < fns.length; j++) {
      const fj = fns[j];
      if (!fj?.fnVenue || !fj?.fnDate || venueKey(fj.fnVenue) !== vi) continue;
      const tj = Date.parse(fj.fnDate);
      if (!Number.isFinite(tj)) continue;
      if (Math.abs(Math.round((tj - ti) / (24 * 60 * 60 * 1000))) <= 1) union(i, j);
    }
  }
  return fns.map((_, i) => find(i));
}

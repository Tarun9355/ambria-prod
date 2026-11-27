// ═══ Event-wide truck/receiving helpers ═══
// `event_orders.data.trucks` is shared by every department on an event (truck.loads[dept] = {
// itemKey: qty }, truck.extra[dept] = { itemKey: qty } for overload/spares) — see
// DepartmentOpsTab.jsx's own "ONE SET OF TRUCKS FOR THE WHOLE EVENT" comment for the full history.
// DepartmentOpsTab.jsx reads this re-keyed down to ONE department's slice (the `trucks` memo there).
// This file instead reads it across EVERY department at once, for the Site Supervisor page, which
// needs a truck's whole manifest (every department's items riding on it), not one department's view.
//
// A truck can make more than one trip (owner ask, 2026-11-23) - loads/extra/custom/status now live
// per trip (`truck.trips[]`), not on the truck itself. tripsOf() is the ONE place that reads a
// truck's trips, shared by this file and DepartmentOpsTab.jsx so there is never a second, divergent
// idea of what a truck's trips are.
//
// It works directly off the stored load keys rather than re-deriving each department's flat item
// list (DepartmentOpsTab.jsx's own `flatDeptItems`/`kitPartOfDept`, which needs that department's
// Deal Check snapshot, fabric grouping, etc.) — a load key already carries enough to look the item
// up in the global inventory list ("inv:<id>", optionally "@<kitname>" for a kit component) or, for
// an item with no inventory id at all (e.g. a folded fabric-colour group, "nm:<name>"), to fall
// back to a readable version of the key's own text. That keeps this file simple and dept-agnostic,
// at the cost of a plainer label for the rare "nm:" item (no photo, title-cased key text).
export const TRUCK_STATUS = ["loading", "dispatched", "at-site", "returned"];
export const TRUCK_STATUS_LABEL = { loading: "Loading", dispatched: "Dispatched", "at-site": "At site", returned: "Returned" };

const titleCase = (s) => String(s || "").replace(/_+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

// A truck saved before trips existed has no `trips` array at all - treated as exactly ONE trip,
// built from its own (now legacy) top-level loads/extra/custom/status, so nothing already loaded or
// dispatched ever needs re-entering. Never mutates `t`; always returns a fresh array.
export function tripsOf(t) {
  if (Array.isArray(t?.trips) && t.trips.length) return t.trips;
  return [{ id: (t?.id || "trip") + "_trip1", status: t?.status || "loading", loads: t?.loads || {}, extra: t?.extra || {}, custom: t?.custom || {} }];
}

// Where a trip goes: one function of the booking (trip.fnIdx = its index in functionsDetail), or not set (null - every function).
// Owner ask 2026-11-27 (Amit Gulati, Exotica 27 Nov + Pushpanjali 28 Nov): a truck must say which venue it is for, so each site sees
// only its own trucks arriving.
export const tripFnOf = (trip) => (trip && trip.fnIdx != null && Number.isFinite(Number(trip.fnIdx)) ? Number(trip.fnIdx) : null);
export const fnLabelOf = (fd, i) => [fd?.type || `Function ${i + 1}`, fd?.venue, String(fd?.date || "").slice(0, 10)].filter(Boolean).join(" · ");
// The event's trucks with only the trips that go to function `fi` (or have no destination set); a truck with none left is dropped.
export function trucksForFn(trucks, fi) {
  if (fi == null || fi === "all") return trucks || [];
  return (trucks || []).map((t) => {
    const trips = tripsOf(t).filter((tr) => tripFnOf(tr) == null || tripFnOf(tr) === fi);
    return trips.length ? { ...t, trips } : null;
  }).filter(Boolean);
}

// A stored load key ("inv:<id>", "inv:<id>@<kitname>", "nm:<name>", or "nm:<name>|<photo>" for an
// item with no inventory id but its own reference photo - Carpet New's colour photo, say, which the
// key carries precisely so two differently-coloured floors of the same material name never share
// one load) → a display label + photo.
export function labelForLoadKey(key, inventory) {
  const k = String(key || "");
  if (k.startsWith("inv:")) {
    const invId = k.slice(4).split("@")[0];
    const item = (inventory || []).find((i) => String(i.id) === invId);
    if (item) return { label: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", invId };
    return { label: invId, photo: "", invId };
  }
  if (k.startsWith("nm:")) {
    const rest = k.slice(3);
    const sep = rest.indexOf("|");
    const name = sep === -1 ? rest : rest.slice(0, sep);
    const photo = sep === -1 ? "" : rest.slice(sep + 1);
    return { label: titleCase(name), photo, invId: null };
  }
  return { label: k, photo: "", invId: null };
}

// Every truck on the event, each carrying every department's load lines together (tagged by
// department) — what the Site Supervisor needs to see "what's on THIS truck", instead of
// DepartmentOpsTab.jsx's one-department-at-a-time `trucks` memo. Trucks with nothing loaded on
// them yet are still included (status is still worth showing), with an empty `lines` array.
// Summed across EVERY trip (a Receiving supervisor confirms what's physically on the truck when it
// arrives, whichever trip brought it - trip-by-trip detail belongs to Dept Ops' own loading screen).
export function truckManifest(sel, inventory) {
  const trucks = Array.isArray(sel?.trucks) ? sel.trucks : [];
  return trucks.map((t) => {
    const totals = new Map(); // `${dept}|${key}` -> { dept, key, planned, extra }
    tripsOf(t).forEach((trip) => {
      // a trip still "Loading" has not left: its pieces are on the truck but not on their way (Receiving shows them apart)
      const stillLoading = (trip?.status || "loading") === "loading";
      // a trip marked At site / Returned has reached the site; Dispatched is still on its way
      const reached = trip?.status === "at-site" || trip?.status === "returned";
      const depts = new Set([...Object.keys(trip.loads || {}), ...Object.keys(trip.extra || {}), ...Object.keys(trip.custom || {})]);
      depts.forEach((dept) => {
        const items = trip.loads?.[dept] || {};
        const extras = trip.extra?.[dept] || {};
        const keys = new Set([...Object.keys(items), ...Object.keys(extras)]);
        keys.forEach((key) => {
          const n = Number(items[key]) || 0;
          const extraN = Number(extras[key]) || 0;
          if (n <= 0 && extraN <= 0) return; // a spares-only line (extra > 0, no regular load) still counts
          const id = dept + "|" + key;
          const cur = totals.get(id) || { dept, key, planned: 0, extra: 0 };
          cur.planned += n; cur.extra += extraN;
          if (stillLoading) cur.loadingQty = (cur.loadingQty || 0) + n + extraN;
          if (reached) cur.arrivedQty = (cur.arrivedQty || 0) + n + extraN;
          totals.set(id, cur);
        });
        // Custom items (DepartmentOpsTab.jsx's addTripCustomItem — a department's own inventory pick,
        // never matched to a Build/Deal Check row, so never keyed into loads/extra at all) used to be
        // invisible here entirely: a truck loaded ONLY with custom items showed nothing on Site, with
        // nothing in the loading screen itself ever hinting why (owner report 2026-11-24 — the actual
        // cause behind "a loaded truck shows nothing in Receiving", not a missing dispatch status).
        (Array.isArray(trip.custom?.[dept]) ? trip.custom[dept] : []).forEach((row) => {
          const q = Number(row?.qty) || 0;
          if (q <= 0 || !row?.invId) return;
          const key = "inv:" + row.invId;
          const id = dept + "|" + key;
          const cur = totals.get(id) || { dept, key, planned: 0, extra: 0 };
          cur.planned += q;
          cur.customQty = (cur.customQty || 0) + q; // added on the truck, not in the deal - Receiving says so instead of "need 0"
          // A virtual (trussInv-backed, not a real inventory row — truss pillars/beams, platform
          // pieces, fabric colours; DepartmentOpsTab.jsx's "Add an item not in this deal") row's
          // invId never resolves in `inventory` below, and labelForLoadKey's own fallback for an
          // unresolved "inv:" key is the raw id itself — a supervisor here would see literally
          // "truss:pillars:iron:8" with no photo (regression review, 2026-11-26). Stash the row's
          // own name/photo so the final label below can use it instead, never overwritten by a
          // later row sharing this id (same item, several trips) that happens to carry neither.
          if (row.name) cur.customLabel = cur.customLabel || row.name;
          if (row.img) cur.customPhoto = cur.customPhoto || row.img;
          if (stillLoading) cur.loadingQty = (cur.loadingQty || 0) + q;
          if (reached) cur.arrivedQty = (cur.arrivedQty || 0) + q;
          totals.set(id, cur);
        });
      });
    });
    const lines = [...totals.values()].map((v) => {
      const resolved = labelForLoadKey(v.key, inventory);
      // labelForLoadKey's own fallback for an "inv:" key with no matching inventory row is the raw
      // id itself — true for a virtual (trussInv-backed) custom item, which has no inventory row by
      // design. Use its own stored name/photo (stashed above) instead, when there is one.
      const useCustom = resolved.invId && !(inventory || []).some((i) => String(i.id) === String(resolved.invId)) && v.customLabel;
      return useCustom ? { ...v, ...resolved, label: v.customLabel, photo: v.customPhoto || "" } : { ...v, ...resolved };
    });
    return { truck: t, lines };
  });
}

// True when this event's trucks still live only in each department's OWN legacy `deptOps[d].trucks`
// (pre-dates the shared `event_orders.data.trucks` list) and have never been re-saved into it.
// `truckManifest` can't show these: the legacy format keys items by a department's own snapshot
// position, not the canonical "inv:<id>"/"nm:<name>" key, and re-deriving that needs each
// department's full flat item list (kit components, Deal Check snapshot, fabric grouping) — the
// exact per-department logic this file was written to avoid duplicating. Rather than guess at a
// label from a key that may not even be an inventory id, the Receiving panel shows an honest
// "not migrated yet" note when this is true, instead of a silent (and wrong) "nothing loaded".
export function hasUnmigratedLegacyTrucks(sel) {
  if (Array.isArray(sel?.trucks) && sel.trucks.length) return false;
  return Object.values(sel?.deptOps || {}).some((od) => Array.isArray(od?.trucks) && od.trucks.length > 0);
}

// Items other events routed to THIS event for same-day reuse — arrivals that never ride on one
// of THIS event's own trucks, so the Receiving view needs them as their own list. Pure over
// eventOrders + the target event's id, same scan DepartmentOpsTab.jsx's own `incomingTransfers`
// memo does (every OTHER event's deptOps movements, filtered to transfers addressed here).
export function incomingTransfersFor(eventOrders, selId) {
  if (!selId) return [];
  const out = [];
  (eventOrders || []).forEach((eo) => {
    if (eo.id === selId) return;
    Object.entries(eo.deptOps || {}).forEach(([dp, od]) => {
      (Array.isArray(od?.movements) ? od.movements : []).forEach((m) => {
        if (m.type === "transfer" && m.toEventId === selId) out.push({ ...m, fromEvent: eo.clientName || "Event", fromDept: dp });
      });
    });
  });
  return out;
}

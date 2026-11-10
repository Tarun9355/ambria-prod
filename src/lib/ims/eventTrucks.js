// ═══ Event-wide truck/receiving helpers ═══
// `event_orders.data.trucks` is shared by every department on an event (truck.loads[dept] = {
// itemKey: qty }, truck.extra[dept] = { itemKey: qty } for overload/spares) — see
// DepartmentOpsTab.jsx's own "ONE SET OF TRUCKS FOR THE WHOLE EVENT" comment for the full history.
// DepartmentOpsTab.jsx reads this re-keyed down to ONE department's slice (the `trucks` memo there).
// This file instead reads it across EVERY department at once, for the Site Supervisor page, which
// needs a truck's whole manifest (every department's items riding on it), not one department's view.
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

// A stored load key ("inv:<id>", "inv:<id>@<kitname>", or "nm:<name>") → a display label + photo.
export function labelForLoadKey(key, inventory) {
  const k = String(key || "");
  if (k.startsWith("inv:")) {
    const invId = k.slice(4).split("@")[0];
    const item = (inventory || []).find((i) => String(i.id) === invId);
    if (item) return { label: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", invId };
    return { label: invId, photo: "", invId };
  }
  if (k.startsWith("nm:")) return { label: titleCase(k.slice(3)), photo: "", invId: null };
  return { label: k, photo: "", invId: null };
}

// Every truck on the event, each carrying every department's load lines together (tagged by
// department) — what the Site Supervisor needs to see "what's on THIS truck", instead of
// DepartmentOpsTab.jsx's one-department-at-a-time `trucks` memo. Trucks with nothing loaded on
// them yet are still included (status is still worth showing), with an empty `lines` array.
export function truckManifest(sel, inventory) {
  const trucks = Array.isArray(sel?.trucks) ? sel.trucks : [];
  return trucks.map((t) => {
    const lines = [];
    const depts = new Set([...Object.keys(t.loads || {}), ...Object.keys(t.extra || {})]);
    depts.forEach((dept) => {
      const items = t.loads?.[dept] || {};
      const extras = t.extra?.[dept] || {};
      const keys = new Set([...Object.keys(items), ...Object.keys(extras)]);
      keys.forEach((key) => {
        const n = Number(items[key]) || 0;
        const extraN = Number(extras[key]) || 0;
        if (n <= 0 && extraN <= 0) return; // a spares-only line (extra > 0, no regular load) still counts
        const { label, photo } = labelForLoadKey(key, inventory);
        lines.push({ dept, key, label, photo, planned: n, extra: extraN });
      });
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

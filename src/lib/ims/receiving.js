// ═══ Site-supervisor receiving confirmations ═══
// What the dept heads loaded (truck.loads / truck.extra, in event_orders.data.trucks) is the PLAN.
// This is the separate record of what the on-site supervisor actually found on arrival — never
// written by a dept head, read by them only as a heads-up. Lives at `event_orders.data.receiving`
// (a sibling of `trucks`/`deptOps`, not nested inside a truck) so:
//   - a truck that gets deleted/re-keyed by a dept head doesn't silently take someone's confirmed
//     receipt with it (the receipt just becomes orphaned — the UI can note that, never discards it)
//   - a transfer arrival (which has no truck at all) can be confirmed through the exact same shape
//
// Shape:
//   eo.receiving = {
//     trucks: { [truckId]: { confirmedAt, confirmedBy, note,
//       items: { [dept]: { [loadKey]: { got, flag, note, at, by } } } } },
//     transfers: { [movementId]: { got, flag, note, at, by } },
//     updatedAt, updatedBy,
//   }
// `got` is the actual qty found; null/absent means "as planned" (never typed over). `flag` is one
// of FLAG_REASONS' keys, or null/absent for no issue reported on that line.
export const FLAG_REASONS = [
  { key: "damaged", label: "Damaged" },
  { key: "wrong", label: "Wrong item" },
  { key: "short", label: "Short count" },
  { key: "missing", label: "Missing" },
];

const emptyReceiving = () => ({ trucks: {}, transfers: {} });
export const receivingOf = (eo) => (eo?.receiving && typeof eo.receiving === "object") ? eo.receiving : emptyReceiving();

// A single line's receipt, given the truck's receiving record (may be undefined) — never null, so
// callers can read `.got`/`.flag` straight off it.
export function lineReceipt(truckReceiving, dept, key) {
  return (truckReceiving?.items?.[dept]?.[key]) || {};
}

// Whether a truck's manifest matches what was actually logged as received: "pending" (nothing
// logged yet), "issue" (any line flagged, or short of planned+extra), or "confirmed". Computed
// fresh from the lines + the receipt every time, never stored — a stored status could fall out of
// sync with the lines backing it; a computed one can't.
export function truckReceiptStatus(lines, truckReceiving) {
  if (!truckReceiving || (!truckReceiving.confirmedAt && !Object.keys(truckReceiving.items || {}).length)) return "pending";
  const hasIssue = (lines || []).some((ln) => {
    const r = lineReceipt(truckReceiving, ln.dept, ln.key);
    if (r.flag) return true;
    if (r.got != null && Number(r.got) < (Number(ln.planned) || 0) + (Number(ln.extra) || 0)) return true;
    return false;
  });
  if (hasIssue) return "issue";
  return truckReceiving.confirmedAt ? "confirmed" : "pending";
}

// ── PATCH BUILDERS — each returns the new `receiving` object to write at `eo.receiving` ──
export function confirmTruckPatch(eo, truckId, userName) {
  const r = receivingOf(eo);
  const trucks = { ...r.trucks, [truckId]: { ...(r.trucks[truckId] || {}), confirmedAt: Date.now(), confirmedBy: userName || "—" } };
  return { ...r, trucks, updatedAt: Date.now(), updatedBy: userName || "—" };
}

export function setItemReceiptPatch(eo, truckId, dept, key, { got, flag, note } = {}, userName) {
  const r = receivingOf(eo);
  const cur = r.trucks[truckId] || {};
  const items = { ...(cur.items || {}) };
  const deptItems = { ...(items[dept] || {}) };
  deptItems[key] = { got: got != null ? Number(got) : null, flag: flag || null, note: note || "", at: Date.now(), by: userName || "—" };
  items[dept] = deptItems;
  const trucks = { ...r.trucks, [truckId]: { ...cur, items } };
  return { ...r, trucks, updatedAt: Date.now(), updatedBy: userName || "—" };
}

export function clearItemReceiptPatch(eo, truckId, dept, key, userName) {
  const r = receivingOf(eo);
  const cur = r.trucks[truckId]; if (!cur) return r;
  const deptItems = { ...(cur.items?.[dept] || {}) };
  delete deptItems[key];
  const items = { ...(cur.items || {}), [dept]: deptItems };
  const trucks = { ...r.trucks, [truckId]: { ...cur, items } };
  return { ...r, trucks, updatedAt: Date.now(), updatedBy: userName || "—" };
}

export function setTransferReceiptPatch(eo, movementId, { got, flag, note } = {}, userName) {
  const r = receivingOf(eo);
  const transfers = { ...r.transfers, [movementId]: { got: got != null ? Number(got) : null, flag: flag || null, note: note || "", at: Date.now(), by: userName || "—" } };
  return { ...r, transfers, updatedAt: Date.now(), updatedBy: userName || "—" };
}

// ── CHANGED IN THE 48 HOURS BEFORE THE EVENT ── (owner ask 2026-11-27) for Planning's Inventory blocked: the items a department's
// change log (Studio's Sold-deal edits, amendRequests) swapped in or took out from 48 hours before the event's first day.
//  - swaps: Map(item name -> { fromName, at, by }) - the newest switch of each item; such a line is listed in its own section, not in the
//    Inventory blocked list, and its rental stays in the blocked total;
//  - removed: [{ name, qty, at, by, rate, total, photo }] - taken out this late still costs its rental (rate x qty held), shown in the section
//    and added to the Inventory blocked tile.
// A log row before switches were recorded as one ("swapped") reads one item out and one in as a switch.
export function lateChangesOf({ sel, dept, amendRequests, inventory, hours = 48 }) {
  const out = { swaps: new Map(), removed: [] };
  if (!sel) return out;
  const dates = [...(Array.isArray(sel.functionsDetail) ? sel.functionsDetail : []).map((f) => String(f?.date || "").slice(0, 10)), String(sel.date || "").slice(0, 10)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dates.length) return out;
  const from = Date.parse(dates[0] + "T00:00:00") - hours * 3600 * 1000;
  const invByName = new Map((inventory || []).map((x) => [String(x?.name || "").trim().toLowerCase(), x]));
  (amendRequests || [])
    .filter((r) => r && r.eventOrderId === sel.id && r.department === dept && r.status === "logged" && Number(r.requestedAt) >= from)
    .sort((a, b) => (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0))
    .forEach((r) => {
      const items = Array.isArray(r.items) ? r.items : [];
      const by = r.requestedBy || "", at = Number(r.requestedAt) || 0;
      items.filter((it) => it?.change === "swapped").forEach((it) => { if (!out.swaps.has(it.name)) out.swaps.set(it.name, { fromName: it.fromName || "", at, by }); });
      const added = items.filter((it) => it?.change === "added"), removed = items.filter((it) => it?.change === "removed");
      if (added.length === 1 && removed.length === 1) {
        if (!out.swaps.has(added[0].name)) out.swaps.set(added[0].name, { fromName: removed[0].name || "", at, by });
        return;
      }
      removed.forEach((it) => {
        const qty = Number(it.from ?? it.qty) || 0;
        const item = invByName.get(String(it.name || "").trim().toLowerCase());
        const rate = Number(item?.price ?? item?.rentalCost) || 0;
        out.removed.push({ name: it.name, qty, at, by, rate, total: Math.round(rate * qty), photo: item ? (item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "") : "" });
      });
    });
  return out;
}

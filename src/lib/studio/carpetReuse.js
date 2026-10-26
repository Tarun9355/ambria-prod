// Same-day carpet reuse. A carpet laid for one event at a venue stays down for another event at the SAME venue on the SAME date, so
// that second event is not competing for it: the picker marks it orange ("in use here — stays laid") instead of SHORT. Two sources:
//   - another EVENT (another client, or the same client's other booking) holding the carpet that day, found from the stock holds;
//   - another FUNCTION of the same deal at the same venue and date, found from that function's own carpet picks.
// The match is the same one cross-function reuse uses: venue name equal (case and spaces ignored), date equal.
import { prefsOf } from "./carpetPrefs.js";
import { CARPET_OFF } from "./taxonomy.js";

const norm = (v) => String(v || "").trim().toLowerCase();

// Holds on one carpet for `date` by OTHER events whose venue that day is `venue`. entries: [{ eventId, qty, date?, status? }] (a
// date's own list, or an item's all-dates list — entries for another date are skipped when they carry one). An event whose order is
// not known can't be placed at a venue and counts for nothing.
export function sameVenueHolds(entries, eventOrders, venue, date, selfEventId) {
  const v = norm(venue);
  const out = { qty: 0, who: [] };
  if (!v) return out;
  const byId = new Map((eventOrders || []).map((e) => [e?.id, e]));
  (entries || []).forEach((b) => {
    if (!b || b.eventId === selfEventId || b.status === "released") return;
    if (date && b.date && b.date !== date) return;
    const eo = byId.get(b.eventId);
    if (!eo) return;
    const fn = (Array.isArray(eo.functionsDetail) ? eo.functionsDetail : []).find((f) => f && f.date === date);
    if (norm(fn?.venue || eo.venue) !== v) return;
    const q = Number(b.qty) || 0;
    if (!(q > 0)) return;
    out.qty += q;
    out.who.push({ eventId: b.eventId, qty: q, name: [eo.clientName || eo.client_name || "Another event", fn?.type].filter(Boolean).join(" · ") });
  });
  return out;
}

// Other functions of THIS deal (not `thisFn`) at the same venue and date whose own carpet pick (1st choice) is `itemId` — as
// "Haldi · stage". Shape of allFns / thisFn: collectAllFunctionData() — { fnIdx, fnType, fnVenue, fnDate, zoneConfig, enabledEls }.
export function siblingCarpetUse(allFns, thisFn, itemId) {
  const v = norm(thisFn?.fnVenue);
  const d = thisFn?.fnDate;
  if (!v || !d || !itemId) return [];
  const out = [];
  (allFns || []).forEach((f) => {
    if (!f || f === thisFn || f.fnIdx === thisFn.fnIdx) return;
    if (norm(f.fnVenue) !== v || f.fnDate !== d) return;
    Object.entries(f.zoneConfig || {}).forEach(([zk, zc]) => {
      if (!zc || !f.enabledEls?.[zk]) return;
      [zc, ...(Array.isArray(zc.extraPlatformRows) ? zc.extraPlatformRows : [])].forEach((row) => {
        if (!row || row.cpT === CARPET_OFF) return;
        if (prefsOf(row)[0]?.id === itemId) out.push(`${f.fnType || `Function ${(f.fnIdx ?? 0) + 1}`} · ${zk}`);
      });
    });
  });
  return [...new Set(out)];
}

// What a carpet can give a floor of `need` sqft: its free stock plus what is already laid at this venue that day (capped at what
// the studio owns). Returns { avail, short }.
export function reuseAwareAvail(free, reuseQty, total, need) {
  const f = Number(free) || 0;
  const cap = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : Infinity;
  const avail = Math.min(cap, f + (Number(reuseQty) || 0));
  return { avail, short: Math.max(0, (Number(need) || 0) - avail) };
}

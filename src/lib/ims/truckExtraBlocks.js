// Items added on a truck that are not in the deal (IMS Dept Ops → Loading & dispatch → "Add an item not in this deal") are
// reserved in the stock ledger like any other hold (owner ask 2026-11-25), under their own source tag so Studio's reconcile
// leaves them alone (lib/studio/soldBlocksPlan classifyEntry: an unknown tag is "protected").
import { isLiveBlockStatus, blockEntryQty } from "./liveBlocks";
import { trussInvForMaterialIms } from "./trussEngine";
import { virtualPlatformItems } from "./platformEngine";

export const TRUCK_EXTRA_SRC = "ims-truck-extra";

// Every department's added items, per inventory id, summed over every truck and trip: Map<invId, qty>.
// A `virtual` row (trussInv-backed — truss pillars/beams, platform pieces, fabric colours; "Add an
// item not in this deal", IMS Dept Ops → Loading & dispatch) has no real inventory id at all, so it
// must never reach this Map — it feeds apply_block_ops (truckExtraBlockOps, DepartmentOpsTab.jsx),
// which would otherwise write a synthetic id like "truss:pillars:iron:8" into the shared `blocks`
// stock ledger as a brand-new item, with stock lookup finding nothing to check it against and the
// RPC granting any quantity unconditionally (regression review, 2026-11-26). The id-prefix check is
// a second, independent guard (not the primary one — that's the `virtual` flag) in case a future
// custom-row writer ever forgets to set it: these three prefixes are reserved for virtual items
// alone (see deptInventoryBySub, DepartmentOpsTab.jsx) and a real inventory id is never shaped like
// one (confirmed: real ids are "I" + 10 alphanumerics, no colon).
export const isVirtualId = (id) => /^(truss|platform|fabric):/.test(String(id || ""));
export function truckExtraQtyByItem(trucks, tripsOf) {
  const m = new Map();
  (trucks || []).forEach((t) => (tripsOf ? tripsOf(t) : t?.trips || []).forEach((tr) => Object.values(tr?.custom || {}).forEach((rows) => (Array.isArray(rows) ? rows : []).forEach((c) => {
    const q = Number(c?.qty) || 0;
    if (q <= 0 || !c?.invId || c?.virtual || isVirtualId(c.invId)) return;
    m.set(String(c.invId), (m.get(String(c.invId)) || 0) + q);
  }))));
  return m;
}

// A virtual (trussInv-backed) row's own per-piece rate — there is no `inventory` row to read price/
// rentalCost off, but Admin → Settings → Truss & Batta Config / Platform Config / Fabric Stock &
// Pricing DOES price these, so "no inventory match" must not mean "no rate" (QA report RC-238,
// Truck_Extras_Downstream_Gaps.md: "config me rate exist karta hai, UI derivation break hai"). Parses
// the same synthetic id scheme deptInventoryBySub (DepartmentOpsTab.jsx) builds these ids from.
// Returns 0 (never throws) for anything it doesn't recognise or can't resolve — the ₹0/"—" display
// this replaces was already the safe fallback, so an unresolvable id is no worse off than before.
const virtualTruckExtraRate = (invId, trussInv) => {
  if (!trussInv) return 0;
  const id = String(invId || "");
  const trussM = id.match(/^truss:(pillars|beams):([^:]+):(\d+(?:\.\d+)?)$/);
  if (trussM) {
    const [, kind, mat, sizeStr] = trussM;
    const rates = trussInvForMaterialIms(trussInv, mat)?.rates || {};
    const perRft = Number(kind === "pillars" ? rates.pillarRftRate : rates.beamRftRate) || 0;
    return perRft * (Number(sizeStr) || 0);
  }
  if (id.startsWith("platform:")) {
    const p = virtualPlatformItems(trussInv).find((r) => r.id === id);
    return p ? (Number(p.ratePerSqft) || 0) * p.lengthFt * p.widthFt : 0;
  }
  const fabM = id.match(/^fabric:(lizaStock|curtainStock|maskingStock):/);
  if (fabM) {
    const rates = trussInv.rates || {};
    // lizaKg's own qty is already in kg (the rate is ₹/kg, so rate×qty is right as-is); curtain/
    // masking qty is in pieces (₹/piece) — same unit the rest of this row's `qty` is already in.
    return Number(fabM[1] === "lizaStock" ? rates.lizaKgRate : fabM[1] === "curtainStock" ? rates.curtainPieceRate : rates.maskingPieceRate) || 0;
  }
  return 0;
};

// Every row added on a truck, for showing and costing (Studio's Deal Check): one per row as added, with its inventory item's
// photo and rent (price ?? rentalCost, as the rest of the app reads it). Rows with no qty are left out. A virtual
// (trussInv-backed, no real inventory row) row still shows up here — visible rather than hidden, same reasoning as
// DepartmentOpsTab.jsx's own truckExtraRows — priced off trussInv's own config rate (virtualTruckExtraRate above) when
// `trussInv` is handed in, else ₹0, with its own stored name/photo (`c.name`/`c.img`, stashed at add-time) standing in
// for the missing inventory lookup. `trussInv` is optional so an existing caller that has no reason to price these
// (there is none left, but keeps this additive) still works unchanged.
export function truckExtraRowsOf(trucks, inventory, tripsOf, trussInv) {
  const out = [];
  (Array.isArray(trucks) ? trucks : []).forEach((t) => {
    if (!t) return;
    const trips = tripsOf ? tripsOf(t) : t.trips || [];
    trips.forEach((tr, tri) => Object.entries(tr?.custom || {}).forEach(([d, rows]) => (Array.isArray(rows) ? rows : []).forEach((c) => {
      const q = Number(c?.qty) || 0;
      if (q <= 0) return;
      const inv = (inventory || []).find((x) => String(x.id) === String(c.invId));
      const rate = inv ? (Number(inv.price ?? inv.rentalCost) || 0) : (c?.virtual || isVirtualId(c?.invId) ? virtualTruckExtraRate(c.invId, trussInv) : 0);
      out.push({
        key: `${t.id}|${tr.id}|${c.id}`, name: inv?.name || c.name, sub: c.sub || inv?.subCat || "", dept: d, qty: q, rate, total: Math.round(rate * q),
        photo: inv?.img || (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || c.img || "",
        where: [t.vehicle || "Truck", trips.length > 1 ? `Trip ${tri + 1}` : "", t.driver || ""].filter(Boolean).join(" · "), status: tr.status || "loading",
      });
    })));
  });
  return out;
}

// Those same items need hands to load, carry and set up (owner ask 2026-11-25), so the crew count reads them too: as one extra,
// always-on zone of plain inventory elements on the event's FIRST function (a truck goes with the setup; the items are not tied
// to any one function). The zone has no zoneConfig (no truss / fabric / platform), so only the per-item rules count it -
// Labours by sub-category, Electricians for lighting, Flowerists for florals - exactly as if the item were in the Build.
// Only the crew engine is handed this zone; rent stays in Deal Check's truckExtrasCost, never in the client's price.
export const TRUCK_EXTRA_ZONE = "__truckExtras";

export function truckExtraElements(trucks, tripsOf) {
  return [...truckExtraQtyByItem(trucks, tripsOf)].map(([invId, qty]) => ({ id: `truckx:${invId}`, invId, qty }));
}

// Which function carries them: the earliest-dated one (the setup goes first), not just the first in Build order - functions can be
// reordered or dated out of order. A function with no date never wins over a dated one; all undated → the first.
export function truckExtraFnIdx(fns) {
  let best = 0, bestDate = null;
  (fns || []).forEach((fn, i) => { const d = String(fn?.fnDate || ""); if (d && (bestDate == null || d < bestDate)) { best = i; bestDate = d; } });
  return best;
}

// `fn` with the zone added (a copy; `fn` itself untouched). `src` is the deal's own function object the copy stands for, kept on
// a non-enumerable __mpSrc so a caller that finds a function by identity (fns.indexOf) still can. Adding twice is a no-op.
export function withTruckExtraZone(fn, els, src) {
  if (!fn || !Array.isArray(els) || !els.length || fn.enabledEls?.[TRUCK_EXTRA_ZONE]) return fn;
  const out = { ...fn, enabledEls: { ...(fn.enabledEls || {}), [TRUCK_EXTRA_ZONE]: true }, zoneElements: { ...(fn.zoneElements || {}), [TRUCK_EXTRA_ZONE]: els } };
  Object.defineProperty(out, "__mpSrc", { value: src || fn.__mpSrc || fn, enumerable: false });
  return out;
}

// The apply_block_ops ops that make the ledger match `want` (Map<invId, qty>) on each of `dates` for this event: an item whose
// TRUCK_EXTRA_SRC holds already equal the qty on every date (and on no other date) gets no op; otherwise its holds are replaced
// (remove that tag on every date, add the qty on each date) - or just removed when nothing of it is on a truck any more.
export function truckExtraBlockOps(blocks, eventId, dates, want) {
  if (!eventId || !Array.isArray(dates) || !dates.length) return [];
  const held = new Map();
  Object.entries(blocks || {}).forEach(([itemId, arr]) => (Array.isArray(arr) ? arr : []).forEach((b) => {
    if (b?.eventId !== eventId || b.source !== TRUCK_EXTRA_SRC || !isLiveBlockStatus(b)) return;
    const h = held.get(String(itemId)) || {};
    h[b.date] = (h[b.date] || 0) + blockEntryQty(b);
    held.set(String(itemId), h);
  }));
  const w = want instanceof Map ? want : new Map();
  const ids = [...new Set([...held.keys(), ...w.keys()])].sort();
  return ids.flatMap((id) => {
    const q = Number(w.get(id)) || 0, h = held.get(id) || {};
    const same = dates.every((dt) => (h[dt] || 0) === q) && Object.keys(h).every((dt) => dates.includes(dt));
    if (same) return [];
    return [{ item_id: id, event_id: eventId, remove: [{ source: TRUCK_EXTRA_SRC, date: null }], add: q > 0 ? dates.map((dt) => ({ date: dt, qty: q, status: "confirmed", source: TRUCK_EXTRA_SRC })) : [] }];
  });
}

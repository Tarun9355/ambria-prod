// Fabric shortfalls → purchase orders, fully automatic (owner decision, 2026-11-28): no one raises a PO
// by hand and no one clicks "add to stock" — the system does both. A PO is created the moment a sold
// deal's fabric need genuinely exceeds what's on the shelf (lib/ims/fabricShortfall.js does that maths),
// and the quantity is credited back into trussInv the moment the function it was for has actually
// happened (by then, ops must have sourced it somehow to run the event). This file is the pure planner
// (testable with no React/Supabase) plus the `useFabricAutoPurchase` hook that runs it.
//
// Why this runs in IMS and not Studio: Studio only ever has ONE deal open and never notices a date
// passing on its own. IMS already hosts the unattended event-order pipeline (useEventOrderAutoConfirm)
// and has every input the shortfall maths needs (every event, the live stock, settings). Replaces the
// old executeFabricBlocks (eventAutoConfirm.js), which used to decrement stock the moment a deal was
// confirmed and never gave it back - this new design never touches stock at PO-creation time, only at
// credit time, and only once.
//
// Coverage gap, same as the rest of this app's "automatic while a tab happens to be open" model (the
// planning sweep, auto-confirm): nothing here runs unless at least one IMS tab is open. A deal sold at
// midnight gets its PO the next time anyone opens IMS, not instantly.
import { useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { takeSettingsLock } from "./settingsLock.js";
import { makeFabricNeedCache } from "./fabricNeed.js";
import { FABRIC_TYPES, colourKey, fabricDemandByDate, fabricStockIndex, tierDeficits, receiveFabricIntoStock, eoDate, eoLastDate } from "./fabricShortfall.js";
import { isLiveEventOrder } from "./helpers.js";
import { isPastFunction, localToday } from "../studio/pastFunctionLock.js";
import { logWrite } from "../studio/userActions";

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
// Short, stable hash of the FULL colourKey (not just its slug) - two different colours that slug down to
// the same thing ("Off White" vs "Off-White": same colourKey minus the hyphen once punctuation is
// stripped) used to collide onto one PO id and fight over its qty forever (regression review, 2026-11-28).
// Hashing the pre-slug string keeps them apart even when their human-readable slugs collide.
const hashOf = (s) => { let h = 0; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// Deterministic id: exactly one row ever exists for one (fabric, colour, tier, date-needed) - re-running
// the planner, or forty open IMS tabs running it at once, rewrites the SAME row instead of duplicating it.
export const fabricPoId = (kind, ck, tier, needDate) => `PO_FABAUTO_${kind}_${slug(ck)}-${hashOf(ck)}_${tier}_${needDate}`;
export const fabricPoNumber = (kind, ck, tier, needDate) => `PO-FAB-${String(needDate).replace(/-/g, "")}-${kind[0].toUpperCase()}${tier[0].toUpperCase()}-${slug(ck).slice(0, 8)}${hashOf(ck).slice(0, 4)}`;

// Is this purchase_orders row one of ours (vs a normal manual request, or a legacy executeFabricBlocks
// "fabric-shortfall" row - those stay in the ordinary manual Purchase list untouched, Stage 7).
export const isFabricAutoPO = (p) => p?.requestType === "fabric-auto";

// What stock row/tier a fabric PO (auto or legacy) actually targets - used both by the credit step and by
// Supply's display. Legacy executeFabricBlocks rows only ever decremented the Old field, so they read as
// tier "old" here; they are never counted as cover (Stage 7) and never auto-credited.
export function fabricPOTarget(p) {
  if (p?.fabric?.kind) {
    const ft = FABRIC_TYPES.find((f) => f.key === p.fabric.kind);
    return { kind: p.fabric.kind, colour: p.fabric.colour, colourKey: p.fabric.colourKey || colourKey(p.fabric.colour), tier: p.fabric.tier || "old", stockKey: p.fabric.stockKey || ft?.stockKey, qtyField: p.fabric.qtyField || ft?.qtyField, unit: p.fabric.unit || ft?.unit, needDate: p.fabric.needDate || null };
  }
  const fa = p?.functionAllocation;
  if (fa?.fabricType && fa?.colour) {
    const ft = FABRIC_TYPES.find((f) => f.key === fa.fabricType);
    return { kind: fa.fabricType, colour: fa.colour, colourKey: colourKey(fa.colour), tier: "old", stockKey: ft?.stockKey, qtyField: ft?.qtyField, unit: ft?.unit, needDate: null };
  }
  return null;
}

const fabricLabel = (kind) => FABRIC_TYPES.find((f) => f.key === kind)?.label || kind;
const fabricUnit = (kind) => FABRIC_TYPES.find((f) => f.key === kind)?.unit || "pcs";

// Dept Ops' per-event "Fabric to buy" card needs to show "to buy" against the SAME effective stock the
// planner itself buys against - not just the raw shelf. The planner's own date-walk (planFabricAutoPOs,
// cumOld/cumNew below) treats an earlier-needDate Open/Crediting PO for the same (kind, colour, tier) as
// stock that will genuinely be there "very soon" (it's either already raised for an earlier date, or about
// to be credited any pass now) - so a later date's own real shortfall is smaller than raw stock alone would
// suggest. Before this, the card's own "to buy" figure was worked out against raw stock only, disagreeing
// with what the planner actually raises for a later date whenever an earlier date's PO already covers part
// of it (regression review follow-up, 2026-11-28, finding #1: event A needs 10 on Dec 1, event B needs 30
// on Dec 5, stock 0 - the planner correctly raises A for 10 and B for only 20, but the card said "30 to buy"
// next to "PO raised · 20 pcs", inviting ops to manually over-buy the apparent gap). Returns a NEW stockIdx
// (same Map-per-kind shape fabricStockIndex produces) with every qualifying earlier PO's qty folded into the
// matching tier's field - `tierDeficits` then does the same cross-tier substitution (spare New standing in
// for an Old need) it always does, with no special-casing needed here. Never mutates its input.
export function fabricEffectiveStockIndex(stockIdx, purchase, beforeDate) {
  if (!beforeDate || !Array.isArray(purchase) || !purchase.length) return stockIdx;
  let touched = false;
  const out = {};
  FABRIC_TYPES.forEach((ft) => { out[ft.key] = new Map(stockIdx?.[ft.key] || []); });
  purchase.forEach((p) => {
    if (!isFabricAutoPO(p) || (p.status !== "Open" && p.status !== "Crediting")) return;
    const f = p.fabric;
    if (!f?.kind || !out[f.kind] || !f.needDate || !(f.needDate < beforeDate)) return;
    const ck = f.colourKey || colourKey(f.colour);
    const cur = out[f.kind].get(ck) || { name: f.colour || ck, old: 0, new: 0, hiddenInBuild: false, photo: "", hex: "" };
    const next = { ...cur };
    // A billed PO's cover is frozen at what was actually bought (billed.actualQty), not the original plan
    // (planFabricAutoPOs/the credit step both already key off this same figure - matching it here keeps
    // this card agreeing with what the planner/credit step actually do, same fix as fabricPOStatusFor's
    // own sum below).
    const coverQty = Number(p.billed ? (p.billed.actualQty ?? p.qty) : p.qty) || 0;
    if (f.tier === "new") next.new += coverQty; else next.old += coverQty;
    out[f.kind].set(ck, next);
    touched = true;
  });
  return touched ? out : stockIdx;
}

// Read-only: what (if anything) has already happened for one (fabric, colour, tier, needDate) slot, for
// Dept Ops' per-event "Fabric to buy" card to show next to its own live shortfall line - "has this already
// been turned into a PO, or is ops about to buy it a second time?". Never writes anything.
// A PO still "Open" but with `billed` set is money already spent (frozen against the planner's own
// resize/cancel, see runPass) - shown as "billed" rather than "raised" so ops doesn't think it's still
// just a plan. A system-cancelled PO (the planner's own release, not a person's) is treated as absent here,
// the same way the planner itself treats it as free to recreate - fall through to the "covered" check.
// `need`: this slot's own tier-aware shortfall BEFORE folding in earlier-PO cover (the caller already has
// this - it's exactly what fabricEffectiveStockIndex's own "to buy" figure is netting AGAINST). Used only to
// make "covered" quantity-aware: an earlier PO existing is not the same as it being ENOUGH (regression
// review follow-up, finding #2 - a 10-piece earlier PO used to read "covered" even when this slot needed
// 30). Omit `need` (or pass 0) to keep the old existence-only behaviour for any other caller.
export function fabricPOStatusFor({ purchase, kind, colour, tier, needDate, need = 0 }) {
  const ck = colourKey(colour);
  const id = fabricPoId(kind, ck, tier, needDate);
  const po = (purchase || []).find((p) => isFabricAutoPO(p) && p.id === id);
  if (po) {
    if (po.status === "Cancelled" && po.cancelled?.by !== "system") return { state: "cancelled", po };
    if (po.status === "Crediting") return { state: "crediting", po };
    if (po.status === "Credited") return { state: "credited", po };
    if (po.status === "Open") return { state: po.billed ? "billed" : "raised", po };
    // system-cancelled, or anything else unexpected - treated as absent, same as the planner's own rule
  }
  // "covered": no PO of its own, but every earlier-needDate PO for the SAME kind+colour+tier, SUMMED (not
  // just the latest one's existence), adds up to at least this slot's own need - that fabric will genuinely
  // be on the shelf by this slot's own date. Tier-exact only: cross-tier substitution is `tierDeficits`' own
  // job inside fabricEffectiveStockIndex's consumer, already folded into `need` before this is ever called -
  // matching cross-tier here too would double-count the same New stock a second time.
  let sum = 0, latest = null;
  (purchase || []).forEach((p) => {
    if (!isFabricAutoPO(p) || (p.status !== "Open" && p.status !== "Crediting")) return;
    const f = p.fabric;
    if (!f || f.kind !== kind || (f.colourKey || colourKey(f.colour)) !== ck || f.tier !== tier) return;
    const d = f.needDate;
    if (!d || !(d < needDate)) return;
    sum += Number(p.billed ? (p.billed.actualQty ?? p.qty) : p.qty) || 0;
    if (!latest || d > latest.fabric.needDate) latest = p;
  });
  if (latest && sum >= (Number(need) || 0)) return { state: "covered", po: latest };
  return { state: "none", po: null };
}

// Every fabric-auto PO already linked to this event (via its own events[].eoId - the events that drove its
// creation), excluding a system-cancelled one (same "treated as gone" rule as fabricPOStatusFor), oldest
// need-date first. For a "Purchases for this event" list of POs a per-event card's own current lines don't
// already cover (e.g. a Credited PO from a date that's since fallen out of forward demand).
export function fabricPOsOfEvent(purchase, eoId) {
  return (purchase || [])
    .filter((p) => isFabricAutoPO(p) && !(p.status === "Cancelled" && p.cancelled?.by === "system") && Array.isArray(p.events) && p.events.some((e) => e?.eoId === eoId))
    .sort((a, b) => String(a.fabric?.needDate || "").localeCompare(String(b.fabric?.needDate || "")));
}

function poCreate({ kind, colour, ck, tier, needDate, qty, dayDemand, today }) {
  const ft = FABRIC_TYPES.find((f) => f.key === kind);
  const events = (dayDemand.events || []).map((e) => ({ eoId: e.eoId, client: e.client, date: e.date, qty: round(tier === "new" ? e.qtyNew : e.qtyOld) }));
  const who = events.map((e) => `${e.client} (${e.date})`).join(", ") || "a sold deal";
  return {
    id: fabricPoId(kind, ck, tier, needDate),
    poNumber: fabricPoNumber(kind, ck, tier, needDate),
    requestType: "fabric-auto", source: "fabric-auto", buildType: "fabric-auto",
    fabric: { kind, colour, colourKey: ck, tier, stockKey: ft?.stockKey, qtyField: ft?.qtyField, unit: ft?.unit, needDate },
    events,
    item: `${fabricLabel(kind)} · ${colour} (${tier === "new" ? "New" : "Old"})`,
    qty: round(qty), unit: fabricUnit(kind) === "kg" ? "Kg" : "Piece", cat: "Fabric",
    reason: `Auto: fabric shortfall for ${who}`,
    requestedBy: "System (fabric auto-PO)", date: today,
    status: "Open",
    history: [{ at: Date.now(), action: "raised", qty: round(qty) }],
  };
}
// Each carries `_priorStatus` - the status the planner read `existing` as having, NOT part of the PO's real
// schema. It's how the hook's write step (runPass/applyPlannerUpdate) does a conditional "only write if the
// row is still what I read it as" update, so a person cancelling or billing this exact row in another tab
// between the planner's (possibly lock-delayed) read and this write can't be silently clobbered back to a
// stale state (regression review, 2026-11-28). Stripped before anything is ever persisted or stored locally.
const poResize = (existing, need, dayDemand) => ({
  ...existing, qty: round(need),
  events: (dayDemand.events || []).map((e) => ({ eoId: e.eoId, client: e.client, date: e.date, qty: round(existing.fabric?.tier === "new" ? e.qtyNew : e.qtyOld) })),
  history: [...(existing.history || []), { at: Date.now(), action: "resized", qty: round(need) }],
  _priorStatus: "Open",
});
const poCancel = (existing, by, reason) => ({ ...existing, status: "Cancelled", cancelled: { at: Date.now(), by, reason }, history: [...(existing.history || []), { at: Date.now(), action: "cancelled", by, reason }], _priorStatus: "Open" });
const poReopen = (existing, need, dayDemand) => ({
  ...existing, status: "Open", cancelled: null, qty: round(need),
  events: (dayDemand.events || []).map((e) => ({ eoId: e.eoId, client: e.client, date: e.date, qty: round(existing.fabric?.tier === "new" ? e.qtyNew : e.qtyOld) })),
  history: [...(existing.history || []), { at: Date.now(), action: "reopened", qty: round(need) }],
  _priorStatus: "Cancelled",
});

// A PO's demand can legitimately vanish from `demand` (fabricDemandByDate is forward-looking-only, same as
// Dept Ops' display) well before the PO is actually due to be credited - a single-day event's date simply
// being "today or earlier" drops it from demand the instant that day starts, and a multi-day event drops
// EVERY one of its dates the moment its FIRST day passes (fabricShortfall.js's eoDate is the first function
// only). Treating "not in forward demand" as "need gone" would cancel every auto-PO the day after its
// event, before the credit pass (gated on the LAST function date) ever gets a chance to run - regression
// review, 2026-11-28, critical finding #2. So the cancel-sweep below uses this separate, more lenient check
// instead: an existing Open PO's backing deal is still "pending, not gone" only when BOTH (a) its own
// needDate has already passed (that's the ONLY reason it's allowed to be missing from forward demand - it
// fell out purely because time passed, not because anything about the deal actually changed) AND (b) at
// least one of its recorded events is still a live order whose CURRENT date (eoDate, which can move) still
// equals that same needDate - AND (c), when `needOf` is available, that event's CURRENT (date-independent)
// fabric need still actually includes this exact colour. Round 1's first attempt at this fix checked only
// "is any event still live", with no date or colour check at all - that over-protected a PO whose event got
// its date MOVED, its picked colour CHANGED, or the fabric REMOVED from the deal entirely: the stale PO for
// the old slot never got cancelled, and later got credited as phantom stock nobody bought (regression
// review, 2026-11-28, round-2 finding #2). Checking the date alone (criterion b) catches "date moved" (the
// event no longer sits on this needDate at all) but NOT "colour changed" or "fabric removed" - the event can
// still be live and on the exact same date while no longer needing THIS colour, since `demand` (forward-
// looking, date-filtered) has already dropped this past date entirely and can't tell us that on its own.
// `needOf` (makeFabricNeedCache, date-independent - it reflects Build's CURRENT layout whatever the date)
// is what actually answers "does this event still need this colour at all" - checked only when the caller
// has it to hand (the planner's own cancel-sweep always does; a bare date-only check is used as a fallback
// otherwise, better than nothing but not a complete fix on its own).
const stillPendingAnyEvent = (po, eoById, today, needOf) => {
  const needDate = po.fabric?.needDate;
  if (!needDate || !(needDate < today)) return false;
  const events = Array.isArray(po.events) ? po.events : [];
  if (!events.length) return false;
  const kind = po.fabric?.kind, ck = po.fabric?.colourKey;
  return events.some((e) => {
    const eo = eoById.get(e.eoId);
    if (!eo || !isLiveEventOrder(eo) || eoDate(eo) !== needDate) return false;
    if (!needOf) return true;
    const rows = needOf(eo)?.[kind] || [];
    return rows.some((r) => colourKey(r.colour) === ck && (Number(r.qty) || 0) > 0);
  });
};

// The planner: walks each fabric × colour's dates in order, working out the real tier-aware shortfall per
// date (a purchase for an earlier date already covers a later one - `cum*` below). Pure - takes the
// current demand/stock/PO snapshot, returns what to create/update; writes nothing itself.
//  - A PO with `billed` set (money already spent, logged by a person) is frozen: never resized or
//    cancelled by this planner, whatever the current need says - its own qty still counts as real cover.
//  - A PO a PERSON cancelled (cancelled.by !== "system") is never reopened or recreated, even if the need
//    comes back - its deterministic id stays retired; the planner simply never raises that exact
//    (fabric,colour,tier,date) slot again. A system-cancelled one (need genuinely went to 0) reopens the
//    moment the need returns, since nothing but the planner's own math put it there.
//  - A CREDITED PO's id is likewise retired forever (same treatment as a person's cancel) - round 1's fix
//    only tracked Open/Cancelled statuses here, so a later demand spike for the exact same (fabric, colour,
//    tier, date) slot fell through to the "nothing exists under this id" branch and silently created a
//    BRAND NEW row under the SAME deterministic id, which setPurchase's byId.set(id, ...) would then
//    overwrite the already-credited row with - wiping its vendor/cost/credited record (regression review,
//    2026-11-28, round-2 finding #3). Its real stock is already reflected in `stockIdx` itself, so it needs
//    no cover bookkeeping here - just permanent protection from being recreated.
export function planFabricAutoPOs({ demand, stockIdx, purchase, eventOrders, needOf, today }) {
  const eoById = new Map((eventOrders || []).map((eo) => [eo.id, eo]));
  const openByKey = new Map();
  const cancelledSystemByKey = new Map();
  const personCancelledIds = new Set(); // protected, forever - never reopened or recreated under this same id
  const creditedIds = new Set(); // likewise protected, forever - see header note above
  (purchase || []).forEach((p) => {
    if (!isFabricAutoPO(p)) return;
    if (p.status === "Open" || p.status === "Crediting") openByKey.set(p.id, p);
    else if (p.status === "Credited") creditedIds.add(p.id);
    else if (p.status === "Cancelled" && p.cancelled?.by === "system") cancelledSystemByKey.set(p.id, p);
    else if (p.status === "Cancelled") personCancelledIds.add(p.id);
  });

  const creates = [], updates = [];
  const touchedIds = new Set();

  // An Open/Crediting PO whose OWN needDate has already passed has fallen out of `demand` (which is
  // forward-looking-only) purely because time passed, not because anyone stopped needing it - it's about
  // to be credited any pass now, so a LATER date needing the same colour should already be able to count on
  // it the same way it counts on a future-dated Open PO (round-2 finding #4a). Seeded once per (kind,
  // colourKey) before walking that colour's dates below, split by tier - but ONLY for a PO that will
  // actually SURVIVE this same pass's cancel-sweep (stillPendingAnyEvent, below): a past-due PO whose
  // backing deal moved/changed/died is about to be CANCELLED, not credited, so it provides no real cover at
  // all - counting it anyway was its own bug (caught while writing this fix's own regression test: a
  // deal whose date moved away would otherwise "cover" its own replacement PO on the new date with a
  // purchase that was never actually going to happen).
  const pastDueCoverByKey = new Map();
  openByKey.forEach((po) => {
    const needDate = po.fabric?.needDate;
    if (!needDate || !(needDate < today)) return;
    if (!stillPendingAnyEvent(po, eoById, today, needOf)) return;
    const k = `${po.fabric.kind}|${po.fabric.colourKey}`;
    const cur = pastDueCoverByKey.get(k) || { old: 0, new: 0 };
    if (po.fabric.tier === "new") cur.new += Number(po.qty) || 0; else cur.old += Number(po.qty) || 0;
    pastDueCoverByKey.set(k, cur);
  });

  (demand || new Map()).forEach((entry) => {
    const { kind, colour } = entry;
    const ck = colourKey(colour);
    const stock = stockIdx?.[kind]?.get(ck) || { old: 0, new: 0 };
    const dates = [...entry.byDate.keys()].sort();
    const pastCover = pastDueCoverByKey.get(`${kind}|${ck}`) || { old: 0, new: 0 };
    let cumOld = pastCover.old, cumNew = pastCover.new; // past-due, not-yet-credited POs count as stock "very soon" to be real, same as strictly-earlier forward dates do
    dates.forEach((D) => {
      const dayDemand = entry.byDate.get(D);
      const { needNew, needOld } = tierDeficits(dayDemand, { old: stock.old + cumOld, new: stock.new + cumNew });
      [["new", needNew], ["old", needOld]].forEach(([tier, need]) => {
        const id = fabricPoId(kind, ck, tier, D);
        touchedIds.add(id);
        const existing = openByKey.get(id);
        let coverQty = 0;
        if (existing?.billed) {
          coverQty = Number(existing.billed.actualQty ?? existing.qty) || 0; // frozen - real money already spent
        } else if (need > 0) {
          if (existing) {
            if (existing.status === "Open" && round(existing.qty) !== round(need)) updates.push(poResize(existing, need, dayDemand));
            // status "Crediting": a credit for this exact PO is already in flight - never resize it mid-write
            coverQty = need;
          } else if (personCancelledIds.has(id) || creditedIds.has(id)) {
            // a person cancelled this exact (fabric,colour,tier,date) slot, or it's already Credited -
            // either way permanently retired, never recreated. A person-cancelled slot is NOT assumed
            // bought (no cover); a credited one needs none either - its stock already lives in `stockIdx`.
          } else {
            const reopenable = cancelledSystemByKey.get(id);
            if (reopenable) updates.push(poReopen(reopenable, need, dayDemand));
            else creates.push(poCreate({ kind, colour, ck, tier, needDate: D, qty: need, dayDemand, today }));
            coverQty = need;
          }
        } else if (existing && existing.status === "Open") {
          updates.push(poCancel(existing, "system", "need gone"));
        }
        if (tier === "new") cumNew += coverQty; else cumOld += coverQty;
      });
    });
  });
  // An Open auto PO whose (fabric, colour) has no demand left ANYWHERE (not just qty 0 on its own date -
  // the colour dropped off the deal entirely) is cancelled - but only once its backing deal is genuinely
  // gone (cancelled/un-booked), not merely because its date has already passed the forward-looking demand
  // window (see stillPendingAnyEvent's own comment above - that's the exact bug this finding fixed).
  openByKey.forEach((po, id) => {
    if (po.status !== "Open" || po.billed || touchedIds.has(id)) return;
    if (stillPendingAnyEvent(po, eoById, today, needOf)) return; // still waiting on its own credit pass, not stale
    updates.push(poCancel(po, "system", "need gone"));
  });

  return { creates, updates };
}

// A PO is due for crediting once the LAST function of at least one of its (still live) events is over -
// multi-day events wait for the whole thing to finish, not just the day the fabric was tagged to.
// A BILLED PO (a person logged real vendor/cost/qty - money genuinely already spent) is due EARLY, bypassing
// the live-event wait, ONLY once NONE of its backing events is live any more: the escape hatch is for "the
// deal died after I already paid for this, credit it anyway since the fabric is real," not "credit it the
// instant someone logs a bill, regardless of timing." Round 1's first attempt made ANY billed PO due
// instantly, even for a live event weeks away - in that window the still-forward-demanded date made the
// planner raise a FRESH PO under the same deterministic id (the real one no longer looked Open), and
// setPurchase then overwrote the Credited/billed row with that fresh Open one, wiping vendor/cost/invoice -
// and because of the `fabricCredits[id]` marker already set, the real purchased stock then never got
// (re-)credited when the slot's need legitimately returned (regression review, 2026-11-28, round-2 finding
// #3). While any backing event is still live, a billed PO now waits exactly like an unbilled one.
export function duePOsForCredit({ purchase, eventOrders, today = localToday() }) {
  const byId = new Map((eventOrders || []).map((eo) => [eo.id, eo]));
  return (purchase || []).filter((p) => isFabricAutoPO(p) && p.status === "Open").filter((p) => {
    const events = Array.isArray(p.events) ? p.events : [];
    const anyLive = events.some((e) => { const eo = byId.get(e.eoId); return eo && isLiveEventOrder(eo); });
    if (p.billed && !anyLive) return true; // every backing event is gone since billing - the fabric is real, credit it regardless of date
    return events.some((e) => {
      const eo = byId.get(e.eoId);
      if (!eo || !isLiveEventOrder(eo)) return false; // cancelled/un-booked since - the cancel pass above handles this, not a credit
      return isPastFunction(eoLastDate(eo), today);
    });
  });
}

// A PO stuck in "Crediting" (a tab closed mid-write) for longer than this is picked back up on the next pass.
const STUCK_MS = 10 * 60 * 1000;
export function stuckCrediting(purchase, now = Date.now()) {
  return (purchase || []).filter((p) => isFabricAutoPO(p) && p.status === "Crediting" && now - Number(p.creditingAt || 0) > STUCK_MS);
}

// ─── The hook — call once, unconditionally, in IMS.jsx right after useEventOrderAutoConfirm ───
const LOCK_KEY = "fabricAutoPoLock";
const LOCK_MS = 3 * 60 * 1000;
const CHECK_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 5000;
const myTab = `fabtab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

// Returns the PO's new in-memory shape on any state change (claimed/reverted/credited), or null if the
// claim itself failed (another tab got there first - nothing changed, caller folds in nothing for this id).
async function creditOnePO(po, { applyTrussInvNow, setPurchase }) {
  // Claim first, server-side - only the tab whose write lands continues. Mirrors the exact claim idiom
  // useEventOrderAutoConfirm uses for its own "confirming" status (eventAutoConfirm.js). `purchase_orders`
  // has no `creditingAt` COLUMN (only `id/vendor_id/amount/status/items/data`) - a raw update naming one
  // is rejected by PostgREST and the claim silently never lands (regression review, 2026-11-28, critical
  // finding #1). The claim itself only ever needs the `status` column (that's what the WHERE races on);
  // `creditingAt` is written straight after, through the normal app-level setPurchase path, which lands it
  // inside `data` the same way every other PO field already gets there (IMS.jsx's purchaseToRow/rowToPurchase).
  // `.select("id, data")` - not just "id" - so the claim hands back the row's FRESHEST committed `data`,
  // not the copy captured at the top of this whole scan pass. A person can log a bill in the window between
  // that snapshot and this claim landing (the lock wait alone can take seconds); crediting off the stale
  // snapshot would silently drop that bill and credit the planned qty instead of what was actually bought
  // (regression review, 2026-11-28, round-2 finding #5).
  const { data: claimedRows, error: claimErr } = await supabase.from("purchase_orders").update({ status: "Crediting" }).eq("id", po.id).eq("status", "Open").select("id, data");
  if (claimErr || !claimedRows || !claimedRows.length) return null;
  const freshData = claimedRows[0]?.data || po;
  const creditingAt = Date.now();
  const claimedPo = { ...freshData, id: po.id, status: "Crediting", creditingAt };
  setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? claimedPo : p)));

  const target = fabricPOTarget(claimedPo);
  if (!target?.stockKey) {
    await supabase.from("purchase_orders").update({ status: "Open" }).eq("id", po.id);
    const reverted = { ...claimedPo, status: "Open" };
    setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? reverted : p)));
    return reverted;
  }
  const qty = round(claimedPo.billed?.actualQty ?? claimedPo.qty);
  // The marker lands in the SAME JSONB write as the quantity change (applyTrussInvNow/IMS.jsx), so the
  // two can never land separately - a retry of this exact write (stuck-recovery, or two tabs racing past
  // the claim somehow) sees its own marker already there and changes nothing a second time.
  const ok = await applyTrussInvNow((fresh) => {
    if (fresh?.fabricCredits?.[po.id]) return fresh;
    const next = receiveFabricIntoStock(fresh, { stockKey: target.stockKey, qtyField: target.qtyField, colour: target.colour, tier: target.tier, qty });
    return { ...next, fabricCredits: { ...(fresh?.fabricCredits || {}), [po.id]: { at: Date.now(), qty, tier: target.tier, stockKey: target.stockKey, colour: target.colour } } };
  });
  if (!ok) {
    await supabase.from("purchase_orders").update({ status: "Open" }).eq("id", po.id);
    const reverted = { ...claimedPo, status: "Open" };
    setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? reverted : p)));
    return reverted;
  }
  await supabase.from("purchase_orders").update({ status: "Credited" }).eq("id", po.id);
  const credited = { ...claimedPo, status: "Credited", credited: { at: Date.now(), qty, tier: target.tier }, history: [...(claimedPo.history || []), { at: Date.now(), action: "credited", qty }] };
  setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? credited : p)));
  logWrite({ name: "System (fabric auto-PO)" }, "purchase.fabric_credited", { targetType: "purchase_orders", targetId: po.id, targetName: credited.item, ok: true, detail: { qty, tier: target.tier } });
  return credited;
}

// Same return convention as creditOnePO - the PO's new shape, or null if nothing changed for it.
async function recoverStuck(po, trussInv, setPurchase) {
  const marker = trussInv?.fabricCredits?.[po.id];
  if (marker) {
    // The stock write already landed before the tab that started it closed - just finish the PO's status.
    const { data: landed } = await supabase.from("purchase_orders").update({ status: "Credited" }).eq("id", po.id).eq("status", "Crediting").select("id");
    if (!landed || !landed.length) return null;
    const credited = { ...po, status: "Credited", credited: { at: marker.at, qty: marker.qty, tier: marker.tier }, history: [...(po.history || []), { at: Date.now(), action: "credited", qty: marker.qty }] };
    setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? credited : p)));
    return credited;
  }
  // Nothing landed - release the claim so the next pass (this tab or another) retries it properly.
  const { data: landed } = await supabase.from("purchase_orders").update({ status: "Open" }).eq("id", po.id).eq("status", "Crediting").select("id");
  if (!landed || !landed.length) return null;
  const reopened = { ...po, status: "Open" };
  setPurchase((prev) => (prev || []).map((p) => (p.id === po.id ? reopened : p)));
  return reopened;
}

// Applies ONE planner resize/cancel/reopen update, conditionally: only if the row's status is STILL what
// the planner read it as (`_priorStatus`) when it decided what to do with it. The planner's own snapshot of
// `purchase` can be seconds to a couple minutes stale by the time this write actually lands (it's read
// before taking the settings-lock, which can itself block for a while under contention) - without this
// check, a person cancelling or billing this exact PO in another tab in that window gets silently
// overwritten back to whatever the planner assumed, re-breaking the very protection the person-cancel/
// billed-freeze rules exist for (regression review, 2026-11-28, finding #3). A lost race is not an error -
// it means someone else's write is the truth now, so this update is simply dropped; the next pass
// recomputes fresh against whatever's actually there.
async function applyPlannerUpdate(p, setPurchase) {
  const { _priorStatus, ...clean } = p;
  // A resize/cancel/reopen is only ever built against a PO the planner read as UNBILLED at the time (a
  // billed one is frozen before any of these three helpers get called at all - see planFabricAutoPOs) - so
  // this also guards against a person billing this exact row in the window between that read and this write
  // landing. Without it, the status check alone still passes (billing doesn't change status), and this
  // write's stale pre-bill `data` would silently overwrite and lose their bill (regression review,
  // 2026-11-28, round-2 finding #5).
  const { data: landed, error } = await supabase.from("purchase_orders").update({ status: clean.status, data: clean }).eq("id", clean.id).eq("status", _priorStatus).is("data->billed", null).select("id");
  if (error || !landed || !landed.length) return null;
  setPurchase((prev) => (prev || []).map((x) => (x.id === clean.id ? clean : x)));
  return clean;
}

// Minimum gap between this tab's own lock ATTEMPTS (not a cooldown on how often real work can happen -
// just on how often we go ask for the lock at all). Before this, the data-change effect's 5s debounce let
// every open IMS tab re-take the settings lock (a `settings` upsert, which every OTHER open tab's realtime
// subscription then re-fetches the WHOLE settings table for) on every minor edit anywhere in the app - far
// more often than the original ~5-minute planning-sweep cadence this was modelled on (regression review,
// 2026-11-28, finding #6). The 5-minute timer below is unaffected (its own gap is already well past this).
const LOCK_ATTEMPT_MIN_GAP_MS = 60 * 1000;

export function useFabricAutoPurchase({ eventOrders, inventory, settings, trussInv, purchase, setPurchase, applyTrussInvNow, ready = true }) {
  const runningRef = useRef(false);
  const lastAttemptRef = useRef(0);
  const latestRef = useRef({});
  latestRef.current = { eventOrders, inventory, settings, trussInv, purchase };

  const runPass = async () => {
    if (runningRef.current || !ready) return;
    const now = Date.now();
    if (now - lastAttemptRef.current < LOCK_ATTEMPT_MIN_GAP_MS) return;
    lastAttemptRef.current = now;
    const { eventOrders, inventory, settings, trussInv, purchase } = latestRef.current;
    if (!Array.isArray(eventOrders) || !trussInv) return;
    runningRef.current = true;
    try {
      if (!(await takeSettingsLock(LOCK_KEY, LOCK_MS, myTab))) return;
      const today = localToday();

      // ── 1. CREDIT PASS first - anything due, or stuck mid-credit, before raising/resizing anything else.
      // Folded into a LOCAL snapshot (`live`) as we go, so step 2 plans off what THIS pass actually did, not
      // the stale pre-pass `purchase` closure - without this, a PO credited a moment ago in step 1 could
      // still read as its old "Open" self in step 2 and get wrongly system-cancelled right back
      // (regression review, 2026-11-28, critical finding #2b: the planner's own cancel-sweep would then
      // overwrite the credit that just landed). ──
      const live = new Map((purchase || []).map((p) => [p.id, p]));
      // Folded the SAME way as the purchase-list snapshot just below, but for the STOCK side: a credit this
      // pass just made isn't necessarily in `trussInv` yet (that's a separate prop, and realtime hasn't
      // necessarily delivered the write back to this tab), so step 2's demand/cover maths must see it
      // applied locally too - otherwise a later event needing the same colour could get its own duplicate PO
      // raised in the exact window between "this PO's date passed" and "this PO actually credited"
      // (regression review, 2026-11-28, round-2 finding #4b - the comment this replaces was wrong: a credit
      // did NOT already count in `trussInv` at this point in the pass).
      let liveTrussInv = trussInv;
      for (const po of stuckCrediting(purchase)) {
        const r = await recoverStuck(po, trussInv, setPurchase);
        if (r) live.set(r.id, r);
      }
      const afterStuck = [...live.values()];
      for (const po of duePOsForCredit({ purchase: afterStuck, eventOrders, today })) {
        const r = await creditOnePO(po, { applyTrussInvNow, setPurchase });
        if (r) {
          live.set(r.id, r);
          if (r.status === "Credited") {
            const target = fabricPOTarget(r);
            if (target?.stockKey) liveTrussInv = receiveFabricIntoStock(liveTrussInv, { stockKey: target.stockKey, qtyField: target.qtyField, colour: target.colour, tier: target.tier, qty: round(r.billed?.actualQty ?? r.qty) });
          }
        }
      }
      const livePurchase = [...live.values()];

      // ── 2. RAISE / RESIZE / CANCEL, off demand and the JUST-FOLDED purchase + stock snapshots above (a
      // credit made in step 1 already shows as "Credited" in `livePurchase` and its qty is already reflected
      // in `liveTrussInv`, so the cancel-sweep correctly leaves it alone and nothing downstream double- or
      // under-counts it). A separate, same-pass safety net (planFabricAutoPOs' own pastDueCoverByKey) also
      // counts any STILL-OPEN, past-due PO as cover for a later date even before it's actually credited - the
      // two together close the gap a later event's demand used to fall into (round-2 finding #4a/#4b). ──
      const needOf = makeFabricNeedCache({ inventory, eventOrders, settings, trussInv: liveTrussInv });
      const { demand } = fabricDemandByDate({ eventOrders, needOf, today });
      const stockIdx = fabricStockIndex(liveTrussInv);
      const { creates, updates } = planFabricAutoPOs({ demand, stockIdx, purchase: livePurchase, eventOrders, needOf, today });
      if (creates.length) {
        setPurchase((prev) => {
          const byId = new Map((prev || []).map((p) => [p.id, p]));
          creates.forEach((p) => byId.set(p.id, p));
          return [...byId.values()];
        });
        creates.forEach((p) => logWrite({ name: "System (fabric auto-PO)" }, "purchase.fabric_raised", { targetType: "purchase_orders", targetId: p.id, targetName: p.item, ok: true, detail: { qty: p.qty } }));
      }
      // Resize/cancel/reopen go through the conditional (status-guarded) write, not a blind bulk setPurchase
      // - see applyPlannerUpdate's own header for why (finding #3: a stale planner snapshot must never
      // clobber a person's concurrent Cancel/Bill on the same row).
      for (const p of updates) {
        const applied = await applyPlannerUpdate(p, setPurchase);
        if (applied) logWrite({ name: "System (fabric auto-PO)" }, "purchase.fabric_updated", { targetType: "purchase_orders", targetId: applied.id, targetName: applied.item, ok: true, detail: { status: applied.status, qty: applied.qty } });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[fabric-auto-po] pass failed", e);
    } finally {
      runningRef.current = false;
    }
  };

  // On data change, debounced so a burst of realtime rows (several events arriving together) settles first.
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(runPass, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventOrders, trussInv, purchase, ready]);

  // On a timer too - this is the ONLY thing that notices a date has rolled past midnight with nobody
  // having touched any data (same pattern AutoPlanningSync.jsx uses for its own background sweep).
  useEffect(() => {
    if (!ready) return undefined;
    const first = setTimeout(runPass, 20000);
    const iv = setInterval(runPass, CHECK_MS);
    return () => { clearTimeout(first); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

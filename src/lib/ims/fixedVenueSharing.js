// Fixed-venue same-day session sharing (owner ask, 2026-11-15): two different deals at the SAME
// Fixed Venue PROPERTY, on the SAME date, can reuse the same physical standing units instead of each
// booking its own — but only when their shifts genuinely can't be happening at once. Example: a
// morning function needs 10 of an item, a dinner function the same day needs the same 10 — that's
// ONE block of 10 for the whole day, not 20, because the item sits idle between the two and gets
// moved. Scope is the whole property (fixedVenueFor's parent), not the exact sub-venue/hall — an item
// can move from one hall to another during the day→night gap, just never between two halls running
// AT THE SAME TIME.
//
// Only a day-ish <-> night-ish pairing is trusted (SHIFT_START_HOUR, dihariWindows.js/deptCrew.js,
// notes Dinner and Night share the same start hour, and Sundowner runs into Dinner) — Sundowner,
// Evening, and any unrecognized/blank shift are NOT a safe pairing with anything: their full demand
// always counts, shared with nothing. Night/Latenight both pair with the day group exactly like
// Dinner does (same reasoning the owner gave for Dinner — a late-running function still leaves the
// whole day free beforehand). Two functions in the SAME shift group never share either (physically
// simultaneous demand), whatever venue they're at within the property.
//
// Capped at the property's own registered standing qty for the item — reuse can only ever be as big
// as what's actually standing there; demand beyond that still has to be trucked in separately for
// each shift, same as a non-Fixed-Venue booking would.
import { fixedVenueFor, standingQty } from "./fixedVenues.js";
import { isCancelledEO, isLiveBlockStatus } from "./liveBlocks.js";

const DAY_SHIFTS = new Set(["brunch", "morning", "lunch"]);
const NIGHT_SHIFTS = new Set(["dinner", "night", "latenight", "late night"]);

// "day" | "night" | null (not a safe pairing — Sundowner/Evening/unknown/blank).
export function shiftGroupOf(shift) {
  const s = String(shift || "").trim().toLowerCase();
  if (DAY_SHIFTS.has(s)) return "day";
  if (NIGHT_SHIFTS.has(s)) return "night";
  return null;
}

// Same-group demand always sums (physically simultaneous, never reusable). Cross-group demand reuses
// the same units up to whichever side is smaller, capped at what's actually standing at the property.
export function combinedFixedVenueRequirement(dayTotal, nightTotal, standing) {
  const d = Math.max(0, Number(dayTotal) || 0);
  const n = Math.max(0, Number(nightTotal) || 0);
  const s = Math.max(0, Number(standing) || 0);
  return d + n - Math.min(d, n, s);
}

// Collapses every {venueName, shift} pair belonging to ONE deal's own functions (for one item, one
// date) into a single representative pair for effectiveBlockedTotal — credit-eligible ONLY when they
// all agree on exactly one venue AND one safe shift group. A deal spanning more than one venue, or
// more than one shift group (even its OWN day function + its OWN night function — it already needs
// its units in BOTH windows and has nothing left over to share with anyone else), falls back to
// `shift: ""` (the "other"/unshared bucket within that venue, or the outdoor bucket if the venue
// itself was ambiguous too) — safe default, never an overbook risk. (Regression review, 2026-11-15:
// collapsing to "whichever of the deal's own functions happened to set the max qty" let a deal that
// was ALREADY using an item in both windows also look free for a completely different deal to share
// with — a real overbook, not just a display quirk.)
export function collapseVenueShift(pairs) {
  const venues = new Set();
  const groups = new Set();
  let anyShift = "";
  (pairs || []).forEach(({ venueName, shift }) => {
    venues.add(venueName || "");
    groups.add(shiftGroupOf(shift));
    anyShift = shift;
  });
  if (venues.size !== 1) return { venueName: null, shift: "" };
  const soleVenue = [...venues][0] || null;
  if (groups.size !== 1 || [...groups][0] == null) return { venueName: soleVenue, shift: "" };
  return { venueName: soleVenue, shift: anyShift };
}

// Collapses THIS deal's own functions (any shape carrying fnVenue/venue + fnShift/shift + fnDate/date
// — collectAllFunctionData() output in Studio, or `functions` rows in IMS) on ONE date to a single
// representative {venueName, shift}, gathered across EVERY function of the deal that date regardless
// of which item it uses — same per-EVENT (not per-item) ambiguity rule event_fn_venue_shift (migration
// 067) and ledgerPreflightShortfalls' own ownVenueShiftByDate already apply. Studio's own Build/Deal
// Check availability checks must use THIS, not a single function's own raw shift, when asking
// getSharingAwareAvailable whether THIS deal's demand is credit-eligible — asking per-function there
// disagreed with the database and the pre-Sold gate, which always decide once per deal per date
// (round 3 regression review, 2026-11-15, finding H2: a deal with a Lunch function and a separate
// Night function at the same Fixed Venue showed a clean Build card, then got blocked at Sold).
export function collapsedDealShiftFor(fns, date) {
  const pairs = (fns || [])
    .filter((fn) => (fn?.fnDate ?? fn?.date) === date)
    .map((fn) => {
      const venueRaw = fn?.fnVenue ?? fn?.venue;
      return { venueName: typeof venueRaw === "string" ? venueRaw : (venueRaw?.name || ""), shift: fn?.fnShift ?? fn?.shift ?? "" };
    });
  return collapseVenueShift(pairs);
}

// Shared classification step: buckets entries into { outdoor, byProperty } — byProperty keyed by the
// actual fixedVenueFor() object reference, not an id, since a legacy/transitional settings shape (the
// old settings-blob `fixedVenues` copy, read only until the `fixed_venues` TABLE's own fetch lands)
// can lack a stable `.id` on some entries; fixedVenueFor always returns the SAME element of this ONE
// settings object for equivalent venue names within a single call, so the object reference itself is
// already a correct, id-independent grouping key.
function classify(entries, settings, invId) {
  let outdoor = 0;
  const byProperty = new Map(); // fv object -> { day, night, other, standing }
  (entries || []).forEach((e) => {
    const qty = Number(e?.qty) || 0;
    if (qty <= 0) return;
    const fv = fixedVenueFor(settings, e?.venueName);
    if (!fv) { outdoor += qty; return; }
    const group = shiftGroupOf(e?.shift);
    const bucket = byProperty.get(fv) || { day: 0, night: 0, other: 0, standing: standingQty(settings, fv.name, invId) };
    if (group === "day") bucket.day += qty;
    else if (group === "night") bucket.night += qty;
    else bucket.other += qty;
    byProperty.set(fv, bucket);
  });
  return { outdoor, byProperty };
}

// entries: [{ qty, venueName, shift }] — one per competing deal/function already drawing on this one
// item on this one date (a deal spanning more than one of its OWN functions that day must already be
// pre-collapsed via collapseVenueShift above before being passed in here — this function only ever
// combines ACROSS different deals/events). The TOTAL truly blocked across everyone — correct for
// DISPLAY (the Inventory tab's "Blocked on date"/"Available on date") where every entry, including
// the one being looked at, is already in the list. NOT the right tool for an admission-time "does
// THIS NEW specific request fit" check — see sharingFreeZone below for that (regression review,
// 2026-11-15, finding 4: the two questions are different sums).
// settings: the IMS settings blob with `.fixedVenues` assembled (assembleFixedVenuesFromRows) and
// `.venueParents` (sub-venue → parent map), i.e. what fixedVenueFor/standingQty already expect.
// invId: the inventory item these entries are all for (standingQty needs it per property).
export function effectiveBlockedTotal(entries, settings, invId) {
  const { outdoor, byProperty } = classify(entries, settings, invId);
  let total = outdoor;
  byProperty.forEach((b) => { total += combinedFixedVenueRequirement(b.day, b.night, b.standing) + b.other; });
  return total;
}

// The admission-time question effectiveBlockedTotal alone can't answer: given everyone ELSE's
// existing demand (`otherEntries`), how much of a NEW request — at `ownVenueName`, shift `ownShift` —
// is already "free" (costs no additional headroom) because it pairs with existing opposite-group
// demand at the SAME Fixed Venue property? Not simply `effectiveBlockedTotal(otherEntries) -
// effectiveBlockedTotal(otherEntries + the new request)`, because combinedFixedVenueRequirement is
// PIECEWISE LINEAR in the new request's own size: the first `min(opposite, standing) - same` units
// cost nothing (fully absorbed into the existing opposite-group commitment, capped at what's actually
// standing there), and every unit beyond that costs exactly 1 unit of headroom, same as an unshared
// item would. This free zone is what both apply_block_ops (migration 067) and
// ledgerPreflightShortfalls subtract from `effectiveBlockedTotal(otherEntries, ...)` before comparing
// to owned stock — see either file's own header for the worked example this derivation comes from
// (regression review, 2026-11-15, finding 4: NP's existing Lunch hold must make Sahej's NEW Dinner
// request cost nothing, not just reduce the on-screen total after the fact).
// Returns 0 (no special treatment — same as "other"/outdoor) when ownShift isn't a safe day/night
// pairing, ownVenueName doesn't resolve to a Fixed Venue, or that property doesn't hold this item.
export function sharingFreeZone(otherEntries, settings, invId, ownVenueName, ownShift) {
  const ownGroup = shiftGroupOf(ownShift);
  if (!ownGroup) return 0;
  const fv = fixedVenueFor(settings, ownVenueName);
  if (!fv) return 0;
  const standing = standingQty(settings, fv.name, invId);
  if (standing <= 0) return 0;
  const { byProperty } = classify(otherEntries, settings, invId);
  const bucket = byProperty.get(fv) || { day: 0, night: 0 };
  const same = ownGroup === "day" ? bucket.day : bucket.night;
  const opposite = ownGroup === "day" ? bucket.night : bucket.day;
  return Math.max(0, Math.min(opposite, standing) - same);
}

// Resolves raw `blocks` entries for one item ({date, eventId, qty, status, ...}) on one date into the
// {qty, venueName, shift} shape effectiveBlockedTotal needs — mirrors reservedByVenueToday's own
// per-function venue resolution (lib/ims/fixedVenues.js) exactly, with shift added, and collapses an
// event with MORE THAN ONE matching function that date via collapseVenueShift (same conservative rule
// InventoryTab.jsx applies to a deal's own `functions` rows). Used by ledgerPreflightShortfalls (the
// pre-Sold gate) so it never ends up STRICTER than apply_block_ops' own write-time check for this
// exact sharing case.
// excludeEventIds: this deal's own holds — never counted as someone else's competing demand.
// Tolerates two input shapes: raw per-item `blocks` entries spanning every date (each carries its
// own `.date`, filtered here against `date`) AND an already date-scoped list such as
// blocksDetailByDate[date][itemId] (lib/studio/ledgerPreflight.js's own caller) whose entries are
// documented ({eventId, qty, ...}, liveBlocks.js) with no `.date` field at all, having already been
// bucketed by date one level up — an entry with no `.date` property is trusted as already-scoped
// rather than dropped (dropping it here silently zeroed every entry for that caller).
export function blockEntriesWithVenueShift(blockEntriesForItem, eventOrders, date, excludeEventIds) {
  const out = [];
  if (!Array.isArray(blockEntriesForItem) || !blockEntriesForItem.length) return out;
  const exclude = new Set((excludeEventIds || []).filter(Boolean));
  const eoById = new Map((eventOrders || []).map((e) => [e.id, e]));
  blockEntriesForItem.forEach((b) => {
    if (!b || !isLiveBlockStatus(b)) return;
    if (b.date != null && b.date !== date) return;
    if (b.eventId && exclude.has(b.eventId)) return;
    const qty = Number(b.qty) || 0;
    if (qty <= 0) return;
    const eo = eoById.get(b.eventId);
    if (eo && isCancelledEO(eo)) return; // a cancelled event's hold is never real competing demand (see lib/ims/liveBlocks.js)
    if (!eo) { out.push({ qty, venueName: null, shift: "" }); return; } // unresolvable event id — keep counting it (fails toward the old, safe flat sum), just can't classify it
    const fd = Array.isArray(eo.functionsDetail) ? eo.functionsDetail : null;
    const matches = fd ? fd.filter((f) => (f?.date || f?.fnDate) === date) : [];
    let venueName, shift;
    if (matches.length === 0) { venueName = eo.venue; shift = eo.shift; }
    else if (matches.length === 1) { venueName = matches[0].venue || matches[0].fnVenue || eo.venue; shift = matches[0].shift ?? eo.shift; }
    else {
      const collapsed = collapseVenueShift(matches.map((f) => ({ venueName: f.venue || f.fnVenue || "", shift: f.shift })));
      venueName = collapsed.venueName;
      shift = collapsed.shift;
    }
    out.push({ qty, venueName, shift });
  });
  return out;
}

// Studio Build's own live availability question, answered the same sharing-aware way the write-time
// RPC (migration 067) and the pre-Sold ledger gate (ledgerPreflightShortfalls) already answer it —
// without this, Build's own OOS gate and typed-quantity ceiling stayed a flat sum even after both of
// those were fixed, so the owner's own ask couldn't actually be built or sold in Studio (regression
// review, 2026-11-15, round 2, finding H1). Mirrors getStudioAvailable's (item, blocksForDate)
// signature but takes the raw per-event detail plus the context needed to classify it, so it can
// apply BOTH credits instead of neither:
//   - effectiveBlockedTotal always replaces a flat sum of blocksDetailForDate with the correctly-
//     grouped total — a strict improvement regardless of whether `ownVenueName`/`ownShift` are known,
//     since it corrects for OTHER deals' own day/night sharing even when THIS call has no shift to
//     offer of its own.
//   - sharingFreeZone's marginal credit additionally applies when `ownVenueName`/`ownShift` resolve to
//     a safe day/night pairing at a standing Fixed Venue property — the SAME unconditional-slack
//     formula (`max(owned - othersTotal, 0) + freeZone`, never `owned - (othersTotal - freeZone)` —
//     see either file's own header for why those differ) both the RPC and the ledger gate use.
// blocksDetailForDate: { [itemId]: [{eventId, qty, status, ...}] } for `date`. excludeEventIds: this
// deal's own holds (never counted as competing demand) — pass the same ownIds every existing
// getStudioAvailable caller already nets out via netOwnReservedBlocksLive, but here as ids to exclude
// rather than a pre-netted flat number, since this function needs the raw per-event detail anyway.
export function getSharingAwareAvailable(item, blocksDetailForDate, eventOrders, settings, date, ownVenueName, ownShift, excludeEventIds) {
  if (!item) return 0;
  const owned = Math.max(0, (Number(item.qty) || 0) - (Number(item.blocked) || 0));
  const entries = blockEntriesWithVenueShift(blocksDetailForDate?.[item?.id] || [], eventOrders, date, excludeEventIds);
  const othersTotal = effectiveBlockedTotal(entries, settings, item?.id);
  const freeZone = sharingFreeZone(entries, settings, item?.id, ownVenueName, ownShift);
  return Math.max(Math.max(owned - othersTotal, 0) + freeZone, 0);
}

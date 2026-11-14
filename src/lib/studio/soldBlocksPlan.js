// Studio's sold-deal `blocks` reconcile, as pure functions (lib/studio/soldBlocksPlan.js) — no React,
// no Supabase, so the planning logic can be tested and reasoned about without the app around it.
//
// ── WHY THIS EXISTS ──
// The `blocks` table (one row per inventory item id, `data` = an array of {date, eventId, qty, status,
// createdAt, source?}) is the single authoritative stock-reservation ledger, read by every availability
// check. FOUR different writers can add an entry for the same event: Studio's own card-matched build
// (reconcileSoldInventoryBlocks, StudioApp.jsx — the only writer this module plans for), IMS's one-time
// auto-confirm AI matching (eventAutoConfirm.js's executeConfirmBlocks), IMS ops' own manual "Block"/
// "Bulk Block" action (InventoryTab.jsx — a deliberate human decision), and an approved amend request
// (ApprovalsTab.jsx). Studio's reconcile must be able to release ITS OWN stale reservations (an item
// dropped from the build must not hold stock forever) WITHOUT EVER touching the other three — it has no
// visibility into IMS's own AI matching or a human ops call, and wrongly releasing either would silently
// un-reserve stock someone is still actually counting on.
//
// ── THE INVARIANT ──
// Studio's reconcile may create, update or release a blocks entry only when entry.eventId === eo.id AND
// entry.source is a tag Studio itself owns ("studio-incremental" for card-matched items, "studio-manual"
// for Deal Check manual items, once wired up — see manualReady below). There is one compatibility
// exception, ADOPTION: an untagged legacy entry, or one tagged "ims-autoconfirm", is replaced by a
// Studio-owned entry only when Studio itself has a POSITIVE need for the same item on the same date — it
// is never dropped just because Studio's current need is zero (that would be exactly the old attempt's
// mistake: treating "not in Studio's build" as "safe to release" for something Studio never put there in
// the first place). An untagged/ims-autoconfirm entry on a DEAD date (no live function of this deal uses
// that date at all) is released, same as today's existing "function moved date" cleanup. Any other source
// ("ims-manual", "amend", anything unrecognised) is never touched, full stop.
//
// ── THE ONE EXCEPTION: FOC ──
// FOC ("free of cost" — an element left at the venue from a previous event, see lib/studio/foc.js) is a
// second, POSITIVE signal, not a zero-requirement release: the salesperson explicitly said "don't block
// this item for this event", for this exact (event, date, item). focReq carries that signal the same
// shape as cardReq ({ [date]: { [itemId]: qty } }). It only matters for an ADOPTABLE entry (untagged
// legacy, or ims-autoconfirm) — a "card"/"manual" entry already gets released by manage() the ordinary
// way whenever cardReq's own want for it drops to 0, FOC or not. An adoptable entry is released on FOC
// only when cardReq has NO positive need for the same (date, item) — a non-FOC need on the same date from
// a different function still adopts/resizes it as before, since two functions can share one date's
// physical reservation.

export const SRC_STUDIO_CARD = "studio-incremental";
export const SRC_STUDIO_MANUAL = "studio-manual";
export const SRC_IMS_AUTOCONFIRM = "ims-autoconfirm";

// Which of the four categories a single blocks-array entry falls into, for THIS event. "foreign" (a
// different event entirely) and "protected" (ims-manual / amend / any other unrecognised tag) are never
// touched by anything below. "card"/"manual" are entries Studio itself previously wrote and fully owns.
// "adoptable" is untagged legacy data or an ims-autoconfirm entry — handled by the compatibility rule above.
export function classifyEntry(b, eventId) {
  if (!b || b.eventId !== eventId) return "foreign";
  const s = b.source;
  if (s === SRC_STUDIO_CARD) return "card";
  if (s === SRC_STUDIO_MANUAL) return "manual";
  if (s === undefined || s === null || s === "" || s === SRC_IMS_AUTOCONFIRM) return "adoptable";
  return "protected";
}

// { [date]: { [itemId]: qty } } — the larger of what any one function sharing a date needs (same rule
// the existing reconcile's own reqByDate already used: two functions on one day reuse the same physical
// pieces set up once, so the true reservation is the max, not each function's own number added together).
// Only positive quantities are kept.
export function reqByDateFrom(fns, reqByFnIdx) {
  const out = {};
  (fns || []).forEach((fn, i) => {
    const fnIdx = fn?.fnIdx ?? i;
    const date = fn?.fnDate || "";
    if (!date) return;
    const slot = out[date] || (out[date] = {});
    Object.entries(reqByFnIdx?.[fnIdx] || {}).forEach(([id, q]) => {
      const n = Number(q) || 0;
      if (n > 0) slot[id] = Math.max(slot[id] || 0, n);
    });
  });
  return out;
}

// Every item id that has at least one entry of the given owned class ("card"/"manual") for this event —
// used to widen the functions.items resync scope safely: only by items Studio can PROVE it owns a
// reservation for, never by every invId a functions row happens to list (that was the earlier, reverted
// attempt's mistake).
export function ownedIds(rowsById, eventId, cls) {
  const s = new Set();
  rowsById.forEach((arr, id) => {
    if ((arr || []).some((b) => classifyEntry(b, eventId) === cls)) s.add(id);
  });
  return s;
}

// The actual plan: given every item's CURRENT blocks array (rowsById) and what Studio's build currently
// needs (cardReq, manualReq — both { [date]: { [itemId]: qty } }, dates already limited to what this run
// processed), work out the next array per item and which items actually changed.
//
// processedDates: dates of the functions THIS run processed (fnsToProcess) — the only dates whose
//   requirement this run has fresh information about.
// liveDates: every date ANY live function of this deal currently has (a superset of processedDates) —
//   used only to tell "a function on this date exists but wasn't part of this run, leave its entries
//   alone" apart from "no function of the deal uses this date at all any more, release it".
// legacyScopeIds: item ids this run's requirement OR the old dcReservedInventory cache mentions — kept
//   only to scope the dead-date release of ADOPTABLE entries to roughly what today's code already covers
//   (a brand new, never-before-seen item on a dead date is left alone rather than guessed about).
// manualReady: false until Deal Check's manual-items state is confirmed loaded for this client (manual
//   entries are left completely alone until then — never guessed at from a possibly-incomplete list).
// freezeCard: an empty-build safety guard — if the build currently resolves to ZERO card requirements at
//   all, but this event still holds Studio-owned ("card") reservations on a date this run processed, do
//   NOT release them. A genuinely emptied build is rare and should be confirmed by a human, not by a
//   possibly-transient glitch (a stale card list, a mid-edit autosave) wiping every reservation at once.
export function planStudioBlocks({ eventId, rowsById, cardReq, manualReq, focReq, processedDates, liveDates, legacyScopeIds, manualReady, freezeCard, now }) {
  const allIds = new Set(rowsById.keys());
  Object.values(cardReq || {}).forEach((m) => Object.keys(m).forEach((id) => allIds.add(id)));
  if (manualReady) Object.values(manualReq || {}).forEach((m) => Object.keys(m).forEach((id) => allIds.add(id)));

  const nextById = new Map();
  const changedIds = [];
  const log = { released: [], added: [], adopted: [] };

  const manage = (id, next, byDate, req, src) => {
    const dates = new Set(Object.keys(byDate));
    processedDates.forEach((d) => { if ((req[d]?.[id] || 0) > 0) dates.add(d); });
    dates.forEach((d) => {
      const existing = byDate[d] || [];
      if (!processedDates.has(d)) {
        // A function on this date exists but this run didn't process it (a partial run) — never
        // touch it; releasing it here would wrongly wipe a sibling function's still-valid reservation.
        if (liveDates.has(d)) { next.push(...existing); return; }
        existing.forEach((b) => log.released.push({ id, date: d, qty: b.qty, source: src }));
        return;
      }
      const want = req[d]?.[id] || 0;
      if (want <= 0) {
        existing.forEach((b) => log.released.push({ id, date: d, qty: b.qty, source: src }));
        return;
      }
      // Already exactly right — keep the existing entry (and its original createdAt) rather than
      // rewriting it on every run for no reason.
      if (existing.length === 1 && Number(existing[0].qty) === want && existing[0].status !== "released") {
        next.push(existing[0]);
        return;
      }
      next.push({ date: d, eventId, qty: want, status: "confirmed", createdAt: now, source: src });
      log.added.push({ id, date: d, qty: want, source: src });
    });
  };

  for (const id of allIds) {
    const cur = rowsById.get(id) || [];
    const next = [];
    const cardByDate = {};
    const manualByDate = {};

    for (const b of cur) {
      const k = classifyEntry(b, eventId);
      if (k === "foreign" || k === "protected") { next.push(b); continue; }
      if (k === "card") { (cardByDate[b.date] ||= []).push(b); continue; }
      if (k === "manual") { (manualByDate[b.date] ||= []).push(b); continue; }
      // adoptable (untagged legacy, or ims-autoconfirm)
      if (freezeCard) { next.push(b); continue; }
      // wantCard OR a now-owned manual need (manualReady — never guessed at from a possibly-incomplete
      // list, same posture as manage()'s own manualReady branch below): an IMS auto-confirm hold for a
      // Deal Check manual item (tagged "ims-autoconfirm" before Studio's own reconcile ever ran for
      // this deal, or legacy/untagged) adopts into a Studio-owned "studio-manual" entry the same way an
      // adoptable card entry already does, once Studio can prove the same need exists in its own data.
      const wantCard = processedDates.has(b.date) && (cardReq[b.date]?.[id] || 0) > 0;
      const wantManual = manualReady && processedDates.has(b.date) && (manualReq?.[b.date]?.[id] || 0) > 0;
      if (wantCard || wantManual) { log.adopted.push({ id, date: b.date, qty: b.qty, source: b.source ?? null }); continue; }
      const wantFoc = processedDates.has(b.date) && (focReq?.[b.date]?.[id] || 0) > 0;
      if (wantFoc) { log.released.push({ id, date: b.date, qty: b.qty, source: b.source ?? null, reason: "foc" }); continue; }
      if (!liveDates.has(b.date) && legacyScopeIds.has(id)) {
        log.released.push({ id, date: b.date, qty: b.qty, source: b.source ?? null });
        continue;
      }
      // NEVER released just for a zero requirement — Studio never owned this reservation to begin with.
      next.push(b);
    }

    if (freezeCard) {
      Object.values(cardByDate).forEach((arr) => next.push(...arr));
    } else {
      manage(id, next, cardByDate, cardReq, SRC_STUDIO_CARD);
    }
    if (manualReady) {
      manage(id, next, manualByDate, manualReq, SRC_STUDIO_MANUAL);
    } else {
      Object.values(manualByDate).forEach((arr) => next.push(...arr));
    }

    const canon = (arr) => arr.map((b) => JSON.stringify(b)).sort().join("\n");
    if (canon(cur) !== canon(next)) {
      changedIds.push(id);
      nextById.set(id, next);
    }
  }

  return { nextById, changedIds, log };
}

// Turns planStudioBlocks' own in-memory decision into the write ops apply_block_ops (bug 4's locked
// RPC, supabase/migrations/066_blocks_write_rpc.sql) actually understands — the plan itself only ever
// computed WHAT this event's `blocks` array should look like; this is the one place that turns that
// into HOW to get there without clobbering anything another writer did in the meantime (the RPC
// re-reads under its own lock, so what matters is "remove exactly these (source,date) groups of MY
// event, add exactly these" — never "replace the whole array", which is what the plain upsert this
// RPC replaces used to do).
//
// For each changed item, this event's own entries (cur = what rowsById had, next = what the plan
// decided) are grouped by (source, date) — foreign/protected entries never appear in either group
// (planStudioBlocks passes those through unchanged, so they cancel out identically and are never
// touched) — and diffed group-by-group: a group only in `cur` becomes a `remove`; a group only in
// `next`, or present in both with a different qty/status, becomes a `remove` + `add` (sent with no
// `createdAt`, so the RPC keeps the old one on an unchanged re-send). A group that adopts from one
// source to another (e.g. an "ims-autoconfirm" entry becoming "studio-incremental") falls straight out
// of this same per-key diff — its old key vanishes (→ remove) and a new key appears (→ add) — no
// separate "adoption" case is needed. `allowOver(itemId, date, source)` lets the caller (Studio's own
// reconcile) decide, per item/date, whether an over-commit becomes a tracked qtyToProduce (bug 10) or
// is simply dropped by the RPC's own 'cap' handling — every existing caller that omits it gets `false`
// everywhere, i.e. never over-commits, same as today's behaviour.
function groupBlocksByKey(entries, eventId) {
  const m = new Map();
  (entries || []).forEach((b) => {
    if (!b || b.eventId !== eventId) return;
    const key = (b.source ?? "") + "|" + (b.date ?? "");
    const qty = (Number(b.qty) || 0) + (Number(b.qtyToProduce) || 0);
    const existing = m.get(key);
    if (existing) { existing.qty += qty; return; }
    m.set(key, { source: b.source, date: b.date, qty, status: b.status });
  });
  return m;
}

export function planToOps({ eventId, rowsById, plan, allowOver = () => false }) {
  const ops = [];
  (plan?.changedIds || []).forEach((id) => {
    const curByKey = groupBlocksByKey(rowsById.get(id), eventId);
    const nextByKey = groupBlocksByKey(plan.nextById.get(id), eventId);
    const remove = [];
    const add = [];
    const allKeys = new Set([...curByKey.keys(), ...nextByKey.keys()]);
    allKeys.forEach((key) => {
      const c = curByKey.get(key);
      const n = nextByKey.get(key);
      if (c && n && c.qty === n.qty && (c.status || "confirmed") === (n.status || "confirmed")) return; // unchanged
      const [source, date] = key.includes("|") ? [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)] : ["", key];
      // Always remove this exact (source, date) group when we're about to add it back — not only
      // when `c` (this run's own, possibly-stale read) happened to have seen it (regression review,
      // 2026-11-14: a retry after a lost response, or a second concurrent reconcile that read before
      // either wrote, would otherwise send an ADD with no matching remove — the RPC has nothing to
      // replace, so it appends a SECOND entry for the same group instead of replacing the first one
      // it already wrote, double-counting this group's own qty from then on). A remove that matches
      // nothing (the group genuinely wasn't there) is a harmless no-op inside the RPC.
      if (c || n) remove.push({ source, date });
      if (n) add.push({ date: n.date, qty: n.qty, status: n.status || "confirmed", source: n.source, allowOver: !!allowOver(id, n.date, n.source) });
    });
    if (!remove.length && !add.length) return;
    ops.push({ item_id: id, event_id: eventId, remove, add });
  });
  return ops;
}

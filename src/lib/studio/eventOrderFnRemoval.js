// ═══ Reindex event_orders.functionsDetail on a Studio-side function removal ═══
// Studio's removeFunction (StudioEventInfo.jsx) already reindexes its OWN in-memory/ledger state
// (fnBuilds, Deal Check's per-function fields — see dealCheckReindex.js) the moment a function is
// deleted, but the IMS-FACING copy of the function list — event_orders.data.functionsDetail — only
// ever got PATCHED by persistDeptSnapshot/persistBuildLayoutSnapshot's own `withLayout`, which maps
// over the EXISTING server array and never removes an entry with no live match. A deleted
// function's old entry sat there forever, so every IMS PDF/display reading functionsDetail kept
// showing it (owner report, 2026-11-14).
//
// Worse than a leftover trailing entry when the deleted function wasn't the LAST one:
// functionsDetail is keyed by array POSITION (fnIdx, falling back to raw array index when absent —
// see k() below), so deleting a MIDDLE or FIRST function leaves every surviving function above it
// still stamped with its OLD, now-wrong position. persistDeptSnapshot's own "REFUSE TO STAMP A
// DIFFERENT FUNCTION'S IDENTITY" guard (the Sangeeta-incident fix, StudioApp.jsx) then actively
// MISFIRES: it sees the surviving function's real type+date already sitting at the OLD (not-yet-
// shifted) slot and refuses to update it, so the deleted function's stale name/date is what keeps
// showing. pushEventOrderPlan's own matchesOtherInExisting guard does the same, but worse — it
// doesn't refuse, it actively stamps the deleted function's old type/date/venue onto the survivor's
// fresh row (fixed separately, see StudioApp.jsx's own comment on that guard).
//
// This is the one place that reindexes functionsDetail itself — called from a SINGLE writer
// (StudioApp.jsx's reindexEventOrderForRemoval) that fires synchronously off Studio's own explicit
// "Remove function" action, never inferred from the live function list simply being short
// (allFnsLoaded's own comment: a function can be transiently absent mid-load/client-switch for
// reasons that have nothing to do with a deliberate removal — inferring deletion from that would be
// actively destructive).
//
// removedIdentity: { type, date, venue } as Studio's OWN removeFunction captured it BEFORE any of
// its own state setters ran — the function's real identity at the moment of deletion, used ONLY to
// confirm the server's own entry at removedIdx is (or was) genuinely the SAME function before
// touching it, never to invent a replacement value for anything.

import { reindexCompositeKeyObject, reindexFnIdxObject, ZONE_PIPE_KEY } from "./dealCheckReindex.js";

// A function's own position key: its stamped fnIdx when present, else its raw array index — the
// exact same fallback persistDeptSnapshot's own withLayout already uses ("an older order whose
// functions were written without one is matched by position").
const k = (f, i) => (Number.isInteger(f?.fnIdx) ? f.fnIdx : i);

// data: one event_order row's own `.data` object (NOT the whole row). Returns
// { next, changed, refused, reason } — `next` is `data` itself (same reference) whenever nothing
// should be written; the caller writes `next` only when `changed` is true, and should surface a
// REFUSED removal to a human (reindexEventOrderForRemoval does this via a red showMsg) rather than
// silently doing nothing — a refusal means the server's own functionsDetail doesn't match what
// Studio expected to find there, which is exactly the kind of mismatch Apply Changes (a full,
// trusted rebuild from Studio's live function list) can repair by hand.
export function removeFnFromEventOrderData(data, removedIdx, removedIdentity) {
  const fns = Array.isArray(data?.functionsDetail) ? data.functionsDetail : [];
  if (!fns.length) return { next: data, changed: false, refused: false, reason: "no functionsDetail" };

  const keyed = fns.map((f, i) => ({ f, k: k(f, i) }));

  // Two entries sharing one position key is the Sangeeta-class corruption this whole file exists to
  // guard against elsewhere — refuse to touch an already-inconsistent row rather than guess which
  // one is real.
  const keyCounts = new Map();
  keyed.forEach(({ k: ki }) => keyCounts.set(ki, (keyCounts.get(ki) || 0) + 1));
  if ([...keyCounts.values()].some((c) => c > 1)) {
    return { next: data, changed: false, refused: true, reason: "duplicate fnIdx in functionsDetail" };
  }

  const target = keyed.find((e) => e.k === removedIdx);
  const anyAbove = keyed.some((e) => e.k > removedIdx);
  if (!target) {
    // Nothing at this position at all. If nothing above it either, this is a function Studio added
    // AFTER the sale and never reached this row to begin with — nothing to remove here, not an
    // error. If something ABOVE removedIdx exists with nothing AT it, the numbering is already
    // inconsistent (a gap) — refuse rather than guess which surviving entry should shift.
    if (anyAbove) return { next: data, changed: false, refused: true, reason: "gap in fnIdx numbering at removedIdx" };
    return { next: data, changed: false, refused: false, reason: "no entry at removedIdx — nothing booked here yet" };
  }
  // A gap ANYWHERE ELSE in the numbering (e.g. entries at 0 and 2, nothing at 1, removedIdx=0) isn't
  // caught by the check above — target exists at removedIdx, so that branch never runs — and would
  // otherwise produce a self-inconsistent result: the survivor at k=2 shifts its STAMPED fnIdx down to
  // 1, but its real ARRAY POSITION stays 0, so fnIdx and position disagree for every reader that
  // doesn't consistently prefer the stamped field (confirmed by independent review, 2026-11-14 —
  // found by construction, not yet seen live). Refuse on any non-contiguous numbering, full stop,
  // same "don't touch an already-inconsistent row" philosophy as the duplicate-key check above.
  const sortedKeys = keyed.map((e) => e.k).sort((a, b) => a - b);
  const contiguous = sortedKeys.every((ki, i) => ki === i);
  if (!contiguous) return { next: data, changed: false, refused: true, reason: "non-contiguous fnIdx numbering" };

  // Identity check: an entry recording BOTH its own type and date must match the removal's own
  // identity on at least one of them, or this isn't genuinely the function Studio just deleted —
  // same reasoning as persistDeptSnapshot's own belongsToAnother guard. An entry missing one of
  // type/date (or a removal with no identity captured at all) skips this check and trusts the index,
  // same as every other reindex in this codebase already does.
  const ri = removedIdentity || {};
  if (target.f?.type && target.f?.date) {
    const typeMatch = !!ri.type && target.f.type === ri.type;
    const dateMatch = !!ri.date && target.f.date === ri.date;
    if (!typeMatch && !dateMatch) return { next: data, changed: false, refused: true, reason: "identity mismatch at removedIdx" };
  }

  const survivors = keyed
    .filter((e) => e.k !== removedIdx)
    .map((e) => ({ ...e.f, fnIdx: e.k > removedIdx ? e.k - 1 : e.k }))
    .sort((a, b) => a.fnIdx - b.fnIdx);

  const firstDate = survivors.map((f) => f?.date).filter(Boolean).sort()[0] || null;
  const nextFunctions = Array.isArray(data.functions) ? survivors.map((f) => f?.type).filter(Boolean) : data.functions;

  // trussPlan ("${fi}|${zk}|${ri}") and trussFabric ("${fi}|${zk}|${ri}|${part}" — built by appending
  // "|${part}" to trussPlan's own key, so it carries the same leading fnIdx segment) are the dept
  // head's OWN edits (footprint sizes, pillar/beam groups, batta, fabric colour) — IMS-owned, kept
  // across every Studio sync, exactly like carpetChoice/itemChoice above. Confirmed HIGH-severity
  // regression (2026-11-14, independent review of this file's first version): left unreindexed here,
  // every survivor above the removed index inherited a DIFFERENT function's truss/fabric edits the
  // moment this write landed — deleting function 2 of 5 silently moved function 3's pillar/beam/batta
  // overrides onto function 2's own new slot, function 4's onto 3's, and so on.
  const reindexChoice = (choiceMap) => reindexCompositeKeyObject(choiceMap, removedIdx, ZONE_PIPE_KEY.parseIdx, ZONE_PIPE_KEY.rebuildKey);
  // Floral's per-function mandi shopping log (deptOps.Floral.mandiLinesByFn/mandiLinesByFnMeta, plain
  // {[fnIdx]: value} objects — see DepartmentOpsTab.jsx's own deriveMandiView) needs the same shift —
  // but the removed function's own entry, if it ever logged real shopping, is ARCHIVED here rather
  // than dropped, same "keep real spend, archived and flagged" decision deriveMandiView's own
  // overwrite-protection already applies to a reused key. Without this, efb19ad7's own identity check
  // (date+venue+label) would correctly flag the shifted survivor's entry as "Unmatched" once reached —
  // safe, nothing is lost or misattributed — but reindexing at the source means it's never even
  // flagged: the survivor's own entry (if any) simply stays its own, cleanly, with no reconciliation
  // step needed.
  const reindexMandiByFn = (byFn) => {
    if (!byFn || typeof byFn !== "object") return { next: byFn, removedRows: null };
    const next = {};
    let removedRows = null;
    Object.entries(byFn).forEach(([key, v]) => {
      const i = Number(key);
      if (!Number.isInteger(i)) { next[key] = v; return; } // not an fnIdx-shaped key — leave untouched
      if (i === removedIdx) { if (Array.isArray(v) && v.length) removedRows = v; return; }
      next[i > removedIdx ? i - 1 : i] = v;
    });
    return { next, removedRows };
  };
  const deptOps = (data.deptOps && typeof data.deptOps === "object") ? data.deptOps : null;
  let nextDeptOps = data.deptOps;
  if (deptOps) {
    const patched = { ...deptOps };
    let deptOpsChanged = false;
    let nextTenting = deptOps.Tenting;
    if (deptOps.Tenting?.carpetChoice) {
      const nextChoice = reindexChoice(deptOps.Tenting.carpetChoice);
      if (JSON.stringify(nextChoice) !== JSON.stringify(deptOps.Tenting.carpetChoice)) { nextTenting = { ...nextTenting, carpetChoice: nextChoice }; deptOpsChanged = true; }
    }
    if (deptOps.Tenting?.trussPlan) {
      const nextPlan = reindexChoice(deptOps.Tenting.trussPlan);
      if (JSON.stringify(nextPlan) !== JSON.stringify(deptOps.Tenting.trussPlan)) { nextTenting = { ...nextTenting, trussPlan: nextPlan }; deptOpsChanged = true; }
    }
    if (deptOps.Tenting?.trussFabric) {
      const nextFab = reindexChoice(deptOps.Tenting.trussFabric);
      if (JSON.stringify(nextFab) !== JSON.stringify(deptOps.Tenting.trussFabric)) { nextTenting = { ...nextTenting, trussFabric: nextFab }; deptOpsChanged = true; }
    }
    if (nextTenting !== deptOps.Tenting) patched.Tenting = nextTenting;
    if (deptOps.Fabric?.itemChoice) {
      const nextChoice = reindexChoice(deptOps.Fabric.itemChoice);
      if (JSON.stringify(nextChoice) !== JSON.stringify(deptOps.Fabric.itemChoice)) { patched.Fabric = { ...deptOps.Fabric, itemChoice: nextChoice }; deptOpsChanged = true; }
    }
    if (deptOps.Floral?.mandiLinesByFn) {
      const { next: nextByFn, removedRows } = reindexMandiByFn(deptOps.Floral.mandiLinesByFn);
      const byFnChanged = JSON.stringify(nextByFn) !== JSON.stringify(deptOps.Floral.mandiLinesByFn);
      if (byFnChanged || removedRows) {
        const nextMeta = reindexFnIdxObject(deptOps.Floral.mandiLinesByFnMeta, removedIdx);
        const nextArchived = removedRows
          ? [...(Array.isArray(deptOps.Floral.mandiLinesArchived) ? deptOps.Floral.mandiLinesArchived : []),
             { fnIdx: removedIdx, meta: deptOps.Floral.mandiLinesByFnMeta?.[removedIdx] || null, rows: removedRows, archivedAt: Date.now() }]
          : deptOps.Floral.mandiLinesArchived;
        patched.Floral = { ...deptOps.Floral, mandiLinesByFn: nextByFn, mandiLinesByFnMeta: nextMeta, ...(removedRows ? { mandiLinesArchived: nextArchived } : {}) };
        deptOpsChanged = true;
      }
    }
    if (deptOpsChanged) nextDeptOps = patched;
  }

  const next = {
    ...data,
    functionsDetail: survivors,
    ...(firstDate ? { date: firstDate } : {}),
    ...(nextFunctions !== data.functions ? { functions: nextFunctions } : {}),
    ...(nextDeptOps !== data.deptOps ? { deptOps: nextDeptOps } : {}),
  };
  const changed = JSON.stringify(next) !== JSON.stringify(data);
  return { next, changed, refused: false, reason: null };
}

// ═══ "DOES THIS SESSION ACTUALLY HOLD A BUILD?" ═══
//
// Browse's session banner lists a saved session only when the snapshot behind it has real build
// data, and the rolling auto-draft is written back over itself every few seconds. Those two facts
// together mean an autosave that captures an EMPTY build erases the card the salesperson was about
// to click — the work is still in the ledger's older entries, but the row they were looking at is
// gone until they happen to touch the build again.
//
// The test lives here, out of the component, so the save path and the banner cannot disagree about
// what "has data" means, and so it can be tested directly.

/** One function's snapshot. */
export function fnSnapHasData(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (Object.keys(snap.elSelectedPhoto || {}).length > 0) return true;
  if (Object.keys(snap.zoneElements || {}).length > 0) return true;
  if (Object.values(snap.enabledEls || {}).some((v) => v)) return true;
  if (snap.sourceVideo?.id || snap.sourceVideoId) return true;
  if (snap.sourceEvent?.id || snap.sourceEventId) return true;
  return false;
}

/**
 * A whole session — any function carrying data, or the legacy flat fields for sessions written
 * before fnSnapshots existed.
 */
export function sessionHasData(session) {
  if (!session || typeof session !== "object") return false;
  const snaps = session.fnSnapshots;
  if (snaps && typeof snaps === "object" && Object.keys(snaps).length > 0) {
    if (Object.values(snaps).some(fnSnapHasData)) return true;
  }
  return fnSnapHasData(session);
}

/**
 * May this auto-save overwrite the rolling draft it is about to replace?
 *
 * Only the AUTO path replaces in place, and only an empty snapshot landing on a draft that holds
 * work is destructive — every other combination is a normal update. A manual save always writes.
 *
 * @param {object} next      the snapshot about to be written
 * @param {object|null} prev the session it would replace (the leading rolling draft), or null
 * @param {boolean} isAuto   true for the background save, false for a manual Save Draft
 */
export function autoSaveWouldDestroy(next, prev, isAuto) {
  if (!isAuto) return false;
  if (!prev || !prev.auto) return false;          // nothing being replaced in place
  if (sessionHasData(next)) return false;         // the new snapshot carries work of its own
  return sessionHasData(prev);                    // destructive only if the old one did
}

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
 * One function's snapshot, but only counting what was actually BUILT on it.
 *
 * fnSnapHasData above counts a picked reference video as data, and for its job — "would this
 * auto-save destroy work?" — that is right: a video someone chose is worth not throwing away.
 * It is the wrong test for "does this function have a build", because the reference is not
 * per-function in practice. Pick a video while standing on Wedding and it is still the reference
 * when you switch to Sangeet, so every function's snapshot carries it — and every function then
 * looked like it held a build. That is one build appearing on all three pills, with the same title
 * and, through the carried price, the same figure.
 *
 * Elements, zones and photos are the things you can only put on a function by working on THAT
 * function, so they are what "has a build" means. No reference clause, deliberately.
 */
export function fnSnapHasBuild(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (Object.keys(snap.elSelectedPhoto || {}).length > 0) return true;
  if (Object.keys(snap.zoneElements || {}).length > 0) return true;
  if (Object.values(snap.enabledEls || {}).some((v) => v)) return true;
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

// Object-key order is not semantically meaningful for these snapshots (zoneConfig/zoneElements/
// enabledEls/elTiers/fnSnapshots are all keyed lookups, not ordered lists), but plain JSON.stringify
// IS order-sensitive. Round-tripping through React state — load populates state from the saved
// object, a setter rebuilds it via spread/fromEntries, the next save re-serialises it — can reorder
// those keys without changing a single value, which made a straight stringify comparison see two
// identical builds as "different". Sorting keys (arrays keep their order — position there IS
// meaningful) makes the comparison care about content, not incidental rebuild order.
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null"; // undefined stringifies to `undefined` (not valid JSON) — normalise it
}

// `sourceVideo`/`sourceEvent` are NOT restored verbatim from the saved snapshot — loadClientSession
// re-derives each one from the LIVE library (`allVideos`/`events`/`ytVideoTags`) so a since-updated
// title, photo or AI tag comes along for the ride. That's the right behaviour for the build itself,
// but it means the very next auto-save can re-capture a `sourceVideo`/`sourceEvent` whose peripheral
// content (tags, title, photos) has quietly drifted since the original save — through no edit by the
// salesperson at all. Reducing each to just its id keeps the comparison about "is this the same
// reference", not "does every denormalised field of it still match byte-for-byte".
function normalizeSourceRef(v) {
  if (!v || typeof v !== "object") return v ?? null;
  return v.id ? { id: v.id } : null;
}
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = (k === "sourceVideo" || k === "sourceEvent") ? normalizeSourceRef(value[k]) : stripVolatile(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Do two session snapshots hold the same build, ignoring save metadata (id/savedAt/savedBy/auto)?
 *
 * Loading a client re-populates every piece of build state from the resumed session — that's a
 * batch of setState calls, and several of the auto-save effect's dependencies (zoneElements,
 * zoneConfig, etc.) are freshly-cloned objects, so React sees them as "changed" even though the
 * content is identical to what was just loaded. Left unchecked, the very first auto-save after a
 * Load would treat that mechanical re-hydration as a real edit and fork a duplicate of the session
 * that was only just resumed. Comparing content lets the save path tell "the load re-set state"
 * apart from "the salesperson actually changed something" before deciding whether to fork.
 *
 * @param {object|null} a
 * @param {object|null} b
 */
export function snapshotContentEqual(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  // _fnRows is the studio_sessions rows a session was rebuilt from, not content — a freshly-built
  // snapshot has none and a session loaded from the table always does, so leaving it in would make
  // every comparison unequal and the load-echo no-op below would never fire again.
  const strip = (s) => {
    const { id, savedAt, savedBy, auto, _fnRows, ...rest } = s; // eslint-disable-line no-unused-vars
    return rest;
  };
  return stableStringify(stripVolatile(strip(a))) === stableStringify(stripVolatile(strip(b)));
}

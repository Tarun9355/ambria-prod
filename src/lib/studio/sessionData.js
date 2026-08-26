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
 * The newest session that actually CARRIES a build, and which function holds it.
 *
 * "Where I left off" is not the newest session. Auto-save mints one on a timer whether or not
 * anything was built, so the top of the list is routinely an empty draft — landing on it restores a
 * blank canvas over the work someone came back for. This walks down until it finds a session with a
 * real build and reports the function index to land on.
 *
 * `sessions` must be newest-first, which is the order rowsToSessions returns.
 *
 * Table rows win wherever they exist: `has_data` was computed once, at save time, by fnSnapHasBuild
 * below — so the two can never answer differently. The fnSnapshots and flat-session branches are
 * for sessions that never came from the table.
 *
 * Lives here rather than in either caller because BOTH the Event Info "Continue" button and the LMS
 * lead loader ask this question, and two copies of it would drift the first time one was tuned.
 *
 * @param {Array} sessions     the client's sessions, newest first
 * @param {number} preferFnIdx land on this function if it has a build of its own; else whichever does
 * @returns {{session: object, fnIdx: number}|null}
 */
export function findLatestBuild(sessions, preferFnIdx = 0) {
  if (!Array.isArray(sessions)) return null;
  for (const s of sessions) {
    if (!s) continue;
    const rows = Array.isArray(s._fnRows) ? s._fnRows.filter((r) => r && r.has_data) : null;
    if (rows && rows.length) {
      // Landing on a function this session holds nothing for would restore an empty canvas over a
      // real build, so the preference only applies when that function has one.
      const own = rows.find((r) => r.fn_idx === preferFnIdx) || rows[0];
      return { session: s, fnIdx: own.fn_idx };
    }
    const snaps = (s.fnSnapshots && typeof s.fnSnapshots === "object") ? s.fnSnapshots : null;
    if (snaps && Object.keys(snaps).length) {
      const idx = Object.keys(snaps)
        .filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
        .find((i) => fnSnapHasBuild(snaps[i] ?? snaps[String(i)]));
      if (idx != null) return { session: s, fnIdx: idx };
    } else if (fnSnapHasBuild(s)) {
      return { session: s, fnIdx: 0 };   // written before fnSnapshots existed — its build is Fn1's
    }
  }
  return null;
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

/**
 * One studio_sessions row per FUNCTION of a saved session — the shape the table stores.
 *
 * Moved here from StudioApp.jsx so it is importable. It was module-scope there and pure, but
 * private, which meant the one-off backfill that finishes the client_ledger→studio_sessions
 * migration had no way to build rows except by copying it — and a copy of a row-shape function
 * is exactly the thing that drifts and writes subtly wrong rows.
 */
export function sessionToRows(clientId, s) {
  if (!s || !s.id || !clientId) return [];
  const snaps = (s.fnSnapshots && typeof s.fnSnapshots === "object") ? s.fnSnapshots : {};
  const keys = Object.keys(snaps).filter((k) => /^\d+$/.test(k));
  // A session written before fnSnapshots existed carries its build in flat fields, and those belong
  // to Fn1 — the same reading Browse has always given them.
  const idxs = keys.length ? keys.map(Number).sort((a, b) => a - b) : [0];
  return idxs.map((i) => {
    const build = snaps[i] || snaps[String(i)] || null;
    const b = build || s;
    const isActive = keys.length ? s.savedActiveFnIdx === i : true;
    // BUILT on, not merely referenced from. A picked video rides along to every function, so the
    // looser test marked all of them as holding a build and one build showed up on every pill.
    const built = fnSnapHasBuild(b);
    const own = s.fnTotals && (s.fnTotals[i] || s.fnTotals[String(i)]);
    // A price only belongs to a function that HAS a build. Carried forward onto an empty one it was
    // a figure for something that is not there — which is how a ₹0 Wedding showed ₹6,90,091.
    const ownTotal = built && own && Number(own.total) > 0 ? Number(own.total) : null;
    return {
      id: `${s.id}:${i}`,
      session_id: s.id,
      client_id: clientId,
      fn_idx: i,
      saved_at: Number(s.savedAt) || 0,
      saved_by: s.savedBy || null,
      auto: !!s.auto,
      is_active_fn: !!isActive,
      has_data: built,
      fn_label: s.fn || null,
      event_date: s.eventDate || null,
      venue: s.venue || null,
      source_video_id: b?.sourceVideo?.id || b?.sourceVideoId || null,
      source_video_title: b?.sourceVideo?.title || b?.sourceVideoTitle || null,
      source_event_id: b?.sourceEvent?.id || b?.sourceEventId || null,
      source_event_name: b?.sourceEvent?.name || b?.sourceEventName || null,
      // The figure for THIS function: its own, else the session-level one but ONLY when the session
      // says that is where the number came from. Another function's price is not a fallback.
      total: ownTotal != null ? ownTotal : (built && isActive && Number(s.total) > 0 ? Number(s.total) : null),
      tier: ownTotal != null ? (own.tier || null) : (built && isActive ? (s.tier || null) : null),
      decor_total: isActive && s.decorTotal != null ? Number(s.decorTotal) : null,
      transport_total: isActive && s.transportTotal != null ? Number(s.transportTotal) : null,
      build: build || null,
    };
  });
}

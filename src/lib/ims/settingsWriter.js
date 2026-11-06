// Writes to the `settings` table, one key per row.
//
// Typing into a settings-backed field (a flower's name or price, a recipe quantity…) changes that
// whole key on every keystroke, and the key can be large (the mandi catalogue is every flower with its
// variants and price history). Done naively — one fire-and-forget upsert per keystroke — the upserts
// overlap and can land out of order, so the database ends up holding an older keystroke's value, and
// the realtime echo of that older row then wound the field back under the person typing ("it will not
// let me type properly").
//
// This writer fixes the ordering:
//   · one queue — writes land in the order they were made, never overlapping;
//   · coalescing — when several edits to a key pile up behind a write in flight, only the newest value
//     is sent, once;
//   · isDirty(key) — true from the moment a local edit is made until the newest value has been written,
//     so the realtime echo (which can only be older than the screen in that window) is ignored for that
//     key instead of replacing what was just typed;
//   · mark() / isStaleFor(key, mark) — the same protection for a refetch that was already on its way:
//     a fetch of the table started BEFORE a key's newest write landed returns the value from before that
//     write, and can arrive AFTER the key stopped being dirty. Take mark() when the fetch starts; a
//     key is stale for that fetch if it is dirty or was written since the mark.
export function createSettingsWriter(writeFn, onError, onSaved) {
  const latest = {};
  const settledAt = {};   // key → value of `clock` when its newest write last finished
  let clock = 0;
  let chain = Promise.resolve();

  // One key's write attempt, using whatever is CURRENTLY in `latest[k]` at the moment it actually
  // runs (not whatever it was when queued) — so a retry naturally picks up a newer edit for free.
  const writeOne = async (k) => {
    if (!(k in latest)) return { ok: true }; // nothing pending for this key any more
    const value = latest[k];
    const sig = JSON.stringify(value);
    let err = null;
    try { err = await writeFn(k, value); } catch (e) { err = e; }
    if (err) {
      if (onError) onError(k, err);
      // Leave latest[k]/settledAt[k] exactly as they were — the write never actually landed, so
      // this key MUST stay dirty until a retry succeeds. This used to unconditionally settle here
      // even on failure, which made isDirty/isStaleFor falsely report "not dirty" for a key whose
      // write never landed — the next realtime echo or refetch would then silently revert the
      // screen back to the stale database value, with no trace anything failed.
      return { ok: false, error: err };
    }
    // Clean only if nothing newer arrived while this write was in flight.
    settledAt[k] = ++clock;
    if (JSON.stringify(latest[k]) === sig) {
      delete latest[k];
      // Tells the caller this key is now genuinely clean, specifically so a PRIOR failure's
      // reported save problem can be cleared once a later write of the same key succeeds — without
      // this, a failed keystroke followed by a successful one left "a save failed" on screen
      // (and beforeunload still warning) until someone clicked Retry or the browser reconnected.
      if (onSaved) onSaved(k);
    }
    return { ok: true };
  };

  const enqueue = (prev, next) => {
    const changed = Object.keys(next).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
    if (!changed.length) return null;
    changed.forEach((k) => { latest[k] = next[k]; });
    const task = chain.then(async () => {
      for (const k of changed) await writeOne(k);
    });
    chain = task.catch(() => {});
    return task;
  };

  // Re-attempt key's write, through the SAME ordered queue (so it can never land out of order
  // against a newer edit already queued ahead of it). Resolves {ok:true} as a no-op if the key
  // isn't dirty any more — e.g. a later edit already wrote it, or another retry already succeeded.
  const retryKey = (key) => {
    const task = chain.then(() => writeOne(key));
    chain = task.catch(() => {});
    return task;
  };

  const isDirty = (key) => key in latest;
  // For a write that bypasses enqueue entirely — a key saved via its own server-side merge RPC
  // (mergeDatePricing's merge_settings_json call) rather than a whole-value upsert through writeFn.
  // Without this, isDirty/isStaleFor have no idea that key is mid-write: a realtime echo from ANY
  // OTHER settings key changing (the subscription fires on the whole table) can fetchAll() and read
  // that key's row from just before the RPC committed, then applySettingsRows happily overwrites the
  // just-written local value with that stale read — since, as far as the writer's bookkeeping is
  // concerned, nothing about that key was ever in flight. Confirmed live (2026-11-01): this silently
  // reverted a freshly-set Date Pricing auto-sync pause + lock code back to off/blank. markWriting
  // before the RPC call and markSettled in its .finally close the same window enqueue already closes
  // for every other key.
  // Counted, not boolean — two overlapping external writes to the same key (e.g. setting the lock
  // code then immediately pausing, before the first RPC has returned) must keep isDirty true until
  // BOTH settle, or the first one finishing would clear it while the second is still in flight.
  const pendingExternal = {};
  const markWriting = (key) => { pendingExternal[key] = (pendingExternal[key] || 0) + 1; latest[key] = true; };
  // ok=false: the external write (the RPC call between markWriting and this) failed — leave
  // pendingExternal/latest exactly as markWriting left them, so the key stays dirty until a
  // successful markSettled(key, true) call, same reasoning as writeOne's own failure path above.
  // Deliberately does NOT call onError/report anything itself: unlike writeOne, there is no single
  // generic way to retry an external write (retryKey would resend `latest[key]`'s `true` sentinel
  // as if it were the real value) — the caller around markWriting/the RPC call owns the context
  // needed to retry correctly, and is responsible for its own error reporting.
  const markSettled = (key, ok = true) => {
    // The counter must always decrement — this call is markWriting's matching close regardless of
    // outcome. Only the settle/clear is conditional: skipping the decrement on failure left it
    // stuck above zero forever, so a later SUCCESSFUL markSettled(key, true) could never bring it
    // back to 0 and delete latest[key] — the key stayed permanently dirty for the rest of the
    // session (confirmed: markWriting → markSettled(false) → markWriting → markSettled(true) left
    // isDirty() true even after the successful retry).
    pendingExternal[key] = Math.max(0, (pendingExternal[key] || 0) - 1);
    if (!ok) return; // latest[key] stays set — the key stays dirty until a later successful write
    settledAt[key] = ++clock;
    if (!pendingExternal[key]) delete latest[key];
  };
  // Gives up on a key's failed write instead of retrying it — "Discard" in the save-health banner.
  // Without this, discarding only removed the on-screen banner entry while leaving the key dirty
  // forever: every realtime echo/refetch of that key would keep being ignored for the rest of the
  // session (treating stale local state as newer than the database), and the NEXT local edit to the
  // key would upsert that same stale value over whatever anyone else had since saved. Bumping
  // settledAt here (not just deleting latest/pendingExternal) means a refetch issued after this
  // point is trusted again, same as a genuinely successful write would leave things.
  const discardKey = (key) => { delete latest[key]; delete pendingExternal[key]; settledAt[key] = ++clock; };
  return {
    enqueue, isDirty,
    mark: () => clock,
    isStaleFor: (key, mark) => isDirty(key) || (settledAt[key] || 0) > mark,
    markWriting, markSettled,
    // Only safe to call for a key whose pending value came from enqueue() (a real value in
    // latest[key]) — never for a key currently mid-markWriting/markSettled (latest[key] === true).
    retryKey,
    discardKey,
  };
}

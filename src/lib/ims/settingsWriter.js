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
export function createSettingsWriter(writeFn, onError) {
  const latest = {};
  const settledAt = {};   // key → value of `clock` when its newest write last finished
  let clock = 0;
  let chain = Promise.resolve();

  const enqueue = (prev, next) => {
    const changed = Object.keys(next).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
    if (!changed.length) return null;
    changed.forEach((k) => { latest[k] = next[k]; });
    const task = chain.then(async () => {
      for (const k of changed) {
        if (!(k in latest)) continue; // a later task already wrote the newest value of this key
        const value = latest[k];
        const sig = JSON.stringify(value);
        let err = null;
        try { err = await writeFn(k, value); } catch (e) { err = e; }
        if (err && onError) onError(k, err);
        // Clean only if nothing newer arrived while this write was in flight.
        settledAt[k] = ++clock;
        if (JSON.stringify(latest[k]) === sig) delete latest[k];
      }
    });
    chain = task.catch(() => {});
    return task;
  };

  const isDirty = (key) => key in latest;
  return {
    enqueue, isDirty,
    mark: () => clock,
    isStaleFor: (key, mark) => isDirty(key) || (settledAt[key] || 0) > mark,
  };
}

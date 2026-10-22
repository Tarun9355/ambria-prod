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
//     key instead of replacing what was just typed.
export function createSettingsWriter(writeFn, onError) {
  const latest = {};
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
        if (JSON.stringify(latest[k]) === sig) delete latest[k];
      }
    });
    chain = task.catch(() => {});
    return task;
  };

  return { enqueue, isDirty: (key) => key in latest };
}

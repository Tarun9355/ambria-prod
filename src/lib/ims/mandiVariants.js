// A flower's colour variants live in ONE jsonb column (mandi_flowers.color_variants). Every variant edit used to write the whole list
// back from the copy on this screen - so an edit made from a copy that had not yet received someone's new variant photo (or price, or
// name) wrote the list without it, and the photo "disappeared a while later" (owner report 2026-11-20: the audit log shows bursts of
// color_variants rewrites, several a second). The list is now read fresh from the database right before each write and the one change
// is applied to that, so an edit only ever changes what it is about. The screen's copy is used only if that read fails.
//   readFresh(id) -> the row's color_variants as stored now; write(id, patch) -> the save; change(list) -> the new list;
//   parentPrice(list) -> the flower's current_price from its variants (when the edit can change it).
// Saves of the same flower from this tab are queued one after another (a photo upload finishing while a rename saves both read the
// same list otherwise, and the second write dropped the first one's change). Across tabs / people a few-ms window remains.
const queues = new Map();
export function saveVariantsFresh(args) {
  const key = String(args?.flowerId ?? "");
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => saveOnce(args));
  queues.set(key, run);
  run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => {});
  return run;
}
async function saveOnce({ flowerId, fallback, change, readFresh, write, parentPrice }) {
  let fresh = null;
  try { fresh = await readFresh(flowerId); } catch { fresh = null; }
  const base = Array.isArray(fresh) ? fresh : (Array.isArray(fallback) ? fallback : []);
  const next = change(base);
  const patch = { color_variants: next };
  if (parentPrice) patch.current_price = parentPrice(next);
  return write(flowerId, patch);
}

// The photo shown for a flower that has variants: its cheapest variant's, else any variant's that has one, else the flower's own.
// (It showed only the cheapest variant's - a price edit that made a variant without a photo the cheapest blanked the column.)
export function variantDisplayPhoto(cheapest, variants, parentPhoto) {
  return cheapest?.photoUrl || (Array.isArray(variants) ? variants.find((v) => v?.photoUrl)?.photoUrl : null) || parentPhoto || null;
}

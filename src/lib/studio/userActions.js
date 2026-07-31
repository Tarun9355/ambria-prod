// User action log (migration 024) — who opened which video/photo, who tagged what, and whether the
// save actually landed.
//
// Two rules this file exists to enforce:
//
//  1. LOGGING MUST NEVER BREAK THE THING IT IS LOGGING. Every call is fire-and-forget and every
//     failure is swallowed. A logging outage must not stop someone tagging a video — the log is a
//     record of work, not part of it.
//  2. IT MUST RECORD FAILURES. A save that fails leaves nothing in the database by definition, so
//     the app is the only place that can report "she tried to tag this and it did not save".
//     That is the difference between "who dropped the data" and "who was working at the time".
import { supabase } from "../supabase";

// Clicks arrive in bursts (scrolling a grid, opening five photos in a row). Batch them on a short
// timer so a browsing session is a handful of requests rather than one per click.
let queue = [];
let timer = null;
const FLUSH_MS = 4000;
const MAX_BATCH = 40;

const flush = async () => {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  try {
    await supabase.from("user_actions").insert(batch);
  } catch {
    // Dropped on purpose. Retrying risks an unbounded queue in a tab that has lost connectivity,
    // and a missing click line is not worth degrading the app over.
  }
};

const enqueue = (row) => {
  queue.push(row);
  if (queue.length >= MAX_BATCH) { flush(); return; }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
};

// Writes (tags, verifies, deletes) go immediately — they are the rows that matter after an
// incident, and waiting 4s risks losing them if the tab closes.
const sendNow = async (row) => {
  try { await supabase.from("user_actions").insert([row]); } catch { /* see rule 1 */ }
};

// EVERY key is emitted on EVERY row, explicit nulls included. This is not tidiness: PostgREST
// rejects a batched insert whose objects have differing key sets ("All object keys must match"),
// so omitting a null here would fail the whole batch the first time a click and a tag were queued
// together. Do not "clean up" by dropping empty fields.
const build = (user, action, opts = {}) => ({
  user_name: user?.name || "Unknown",
  user_id: user?.id || null,
  action,
  target_type: opts.targetType ?? null,
  target_id: opts.targetId ?? null,
  // Trimmed: titles can be long and the column is for reading the log at a glance.
  target_name: opts.targetName ? String(opts.targetName).slice(0, 200) : null,
  ok: opts.ok ?? null,
  error: opts.error ? String(opts.error).slice(0, 500) : null,
  detail: opts.detail ?? null,
});

/** A click / an open — no write happened, so `ok` stays null. Batched. */
export function logView(user, action, opts) { enqueue(build(user, action, opts)); }

/** A write attempt. Pass ok:false with the error when it failed — that is the point of this log. */
export function logWrite(user, action, opts) {
  const row = build(user, action, opts);
  // Failures jump the queue along with successes; both are sent immediately.
  sendNow(row);
}

/** Flush pending views when the tab is hidden or closing, so the last few clicks are not lost.
 *  Not sendBeacon: it cannot set the apikey/Authorization headers PostgREST requires, so the
 *  request would 401. A plain flush usually completes; if the tab dies first we lose a click line,
 *  which is an acceptable trade (rule 1). Writes never rely on this — they send immediately. */
export function installActionLogFlush() {
  if (typeof window === "undefined") return () => {};
  const onHide = () => { if (queue.length) flush(); };
  const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVis);
  };
}

/** Convenience wrappers so call sites read as intent, not plumbing. */
export const logVideoOpen   = (u, v)            => logView(u, "video.open",  { targetType: "video", targetId: v?.id, targetName: v?.title });
export const logPhotoOpen   = (u, p)            => logView(u, "photo.open",  { targetType: "photo", targetId: p?.id, targetName: p?.name });
export const logVideoTag    = (u, v, res, det)  => logWrite(u, "video.tag",  { targetType: "video", targetId: v?.id, targetName: v?.title, ok: !!res?.ok, error: res?.error, detail: det });
export const logPhotoTag    = (u, p, res, det)  => logWrite(u, "photo.tag",  { targetType: "photo", targetId: p?.id, targetName: p?.name,  ok: !!res?.ok, error: res?.error, detail: det });
export const logVideoVerify = (u, v, verified, res) => logWrite(u, "video.verify", { targetType: "video", targetId: v?.id, targetName: v?.title, ok: !!res?.ok, error: res?.error, detail: { verified } });
export const logVideoHide   = (u, v, hidden, res)   => logWrite(u, "video.hide",   { targetType: "video", targetId: v?.id, targetName: v?.title, ok: !!res?.ok, error: res?.error, detail: { hidden } });
/** Bulk actions: the single clicks with the biggest blast radius. Always record the count. */
export const logBulk = (u, what, count, res, det) => logWrite(u, `bulk.${what}`, { ok: res?.ok !== false, error: res?.error, detail: { count, ...(det || {}) } });

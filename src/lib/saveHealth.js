import { useEffect, useState } from "react";

// Shared store for write failures that need to stay VISIBLE until resolved, across both Studio and
// IMS. A toast that fades after a few seconds — or a console.warn nobody is looking at — is exactly
// how a failed write turns into silently lost data: the user keeps working, assumes it saved, and
// only finds out later (if ever) that it didn't. This is the other half of the fix started by
// settingsWriter.js's own comment: a failed write there used to still mark its key "settled", so the
// next realtime echo or refetch silently reverted the screen back to the stale database value with
// no trace anything failed. Fixing that bookkeeping only matters if the failure is then actually
// SHOWN somewhere — that's this store plus SaveHealthBanner.jsx.
//
// Retry policy (owner decision, 2026-11-05): manual retry, plus exactly ONE automatic retry attempt
// per problem when the browser regains connectivity (the `online` event) — not a background retry
// loop or polling. A reconnect that still can't reach the server just leaves the same problem
// reported; the user, or the next reconnect, tries again.

const problems = new Map(); // id -> {id, label, error, retry, blocked, ts}
const listeners = new Set();

const snapshot = () => Array.from(problems.values()).sort((a, b) => a.ts - b.ts);
const notify = () => { const snap = snapshot(); listeners.forEach((fn) => fn(snap)); };

/**
 * Report (or update) a save problem. Calling this again with the same `id` refreshes its message
 * and timestamp — used when a retried write fails again.
 * @param {string} id - stable identity for this problem. MUST be unique per actual piece of data at
 *   risk, not shared by several independent writes (e.g. `settings:datePricing:autoCategories` vs.
 *   `settings:datePricing:categories` — never one shared `settings:datePricing` for every sub-field)
 *   — otherwise an unrelated write's success clears a DIFFERENT, still-failed write's banner entry,
 *   or a second failure silently replaces the first one's (and its retry closure) in the Map.
 * @param {{label?: string, error?: Error|string, retry?: () => Promise<{ok:boolean}|void>|void, onDiscard?: () => void, blocked?: boolean}} info
 *   `retry` is omitted for a problem nothing can usefully re-attempt (the caller has no safe way to
 *   resend it) — the banner then shows it with a Discard button but no Retry. `onDiscard` runs when
 *   the user discards instead of retrying — e.g. releasing a writer's internal "this key is still
 *   dirty" bookkeeping, so a discarded failure doesn't keep ignoring every later remote update of
 *   that key for the rest of the session. `blocked: true` marks a load-failure-style refusal (see
 *   kv.js's kvLoadFailed / IMS.jsx's loadOkRef) that genuinely needs a page reload, not a retry.
 */
export const reportSaveProblem = (id, { label, error, retry, onDiscard, blocked = false } = {}) => {
  const message = error instanceof Error ? error.message : (error != null ? String(error) : "Save failed");
  problems.set(id, { id, label: label || id, error: message, retry, onDiscard, blocked, ts: Date.now() });
  notify();
};

export const clearSaveProblem = (id) => {
  if (problems.delete(id)) notify();
};

// Discard in the banner: runs the problem's own cleanup (if any) before dropping it, so discarding
// doesn't just hide the failure while leaving whatever caused it (e.g. a writer's dirty bookkeeping
// for that key) stuck in a failed state forever.
export const discardSaveProblem = (id) => {
  const p = problems.get(id);
  try { p?.onDiscard?.(); } catch { /* the problem is being discarded regardless — still clear it below */ }
  clearSaveProblem(id);
};

export const getSaveProblems = () => snapshot();

export const subscribeSaveProblems = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const hasUnsavedFailures = () => problems.size > 0;

// Runs a problem's own retry() and clears it on success. Safe to call even if the problem has no
// retry (no-ops) or was already cleared by something else in the meantime.
export const retrySaveProblem = async (id) => {
  const p = problems.get(id);
  if (!p || !p.retry) return;
  try {
    const result = await p.retry();
    if (!result || result.ok !== false) clearSaveProblem(id);
    // A falsy `ok` on the result means the retry itself already re-reported a fresh failure (the
    // writer's own onError path does this) — nothing further to do here.
  } catch {
    /* leave it reported; the retry implementation is responsible for re-reporting its own error */
  }
};

// No `!p.blocked` filter: retrySaveProblem already no-ops a problem with no `retry` function (the
// common case for a blocked entry, which still needs a page reload), so including blocked entries
// here is harmless for those — and lets a blocked entry that DOES carry a retry (a load failure with
// its own in-place background-recovery attempt) also get this same one-shot-per-reconnect try,
// instead of being silently excluded from the one mechanism this effort already built for it.
export const retryAllSaveProblems = () => { snapshot().forEach((p) => retrySaveProblem(p.id)); };

// For SaveHealthBanner.jsx (or any other consumer) to render the live list.
export const useSaveProblems = () => {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    // A problem can be reported/cleared between the useState initializer above (render) and this
    // effect running (commit) — re-sync once on mount so that window isn't silently missed, then
    // subscribe for everything after.
    setSnap(snapshot());
    return subscribeSaveProblems(setSnap);
  }, []);
  return snap;
};

if (typeof window !== "undefined") {
  // Exactly one attempt per problem per reconnect — see this file's own comment on retry policy.
  window.addEventListener("online", retryAllSaveProblems);
  // A "blocked" entry (failed load) has nothing of this tab's to lose on a reload, so it doesn't
  // need to hold up navigation — only an unretried FAILED WRITE does.
  window.addEventListener("beforeunload", (e) => {
    if (!snapshot().some((p) => !p.blocked)) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

import { reportSaveProblem, clearSaveProblem } from "./saveHealth";

// Retries a WRITE that failed on a flaky connection, on top of Phase 0 (load guards) and Phase 1
// (failures stay visible instead of silently reverting). Unlike retryingFetch.js (which only ever
// retries READS, automatically, underneath the Supabase client), this is for a write the CALLER
// explicitly opts into retrying — because only the caller knows whether that specific write is safe
// to repeat.
//
// Safe to wrap: `.upsert(row, {onConflict: "id"})`, `.update(...).eq("id", id)`,
// `.delete().eq("id", id)` — re-applying the same final state twice is a no-op the second time.
// NEVER wrap: a bare `.insert()` (a lost response after a successful insert would duplicate the
// row), an append-only audit write, the auto-confirm engine's own compare-and-set claim, or any RPC
// that isn't provably idempotent. When in doubt, don't wrap it here.
//
// Supersession is what makes retrying safe to add at all: a naive "keep retrying in the background"
// could let a STALE attempt (an old value, delayed by a slow/flaky connection) finally succeed AFTER
// a newer edit to the same thing already went out — silently reverting that newer edit. Every retry
// checks whether a NEWER writeWithRetry call for the same `target` has started since this one began,
// and drops itself instead of ever writing a stale value over a fresher one.

const generation = new Map(); // target -> integer, bumped each time writeWithRetry starts for it

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitteredDelay = (attempt, baseDelayMs) => baseDelayMs * 2 ** attempt * (0.5 + Math.random() * 0.5);

// Postgres/PostgREST error CODES (not HTTP status) for failures a retry cannot fix — retrying an
// unchanged payload against the same constraint or permission error just wastes time and delays the
// real error reaching the user. Anything else (network errors, 5xx, timeouts, an error with no
// `code` at all) is treated as retryable, erring toward availability.
export const defaultShouldAbort = (error) => {
  const code = error?.code;
  if (!code) return false;
  if (/^23/.test(code)) return true; // integrity constraint violation (not-null/check/FK/unique)
  if (code === "42501") return true; // insufficient_privilege (RLS denial)
  if (code === "PGRST116") return true; // no row matched a .single()/.maybeSingle() expectation
  return false;
};

/**
 * @param {() => Promise<{data?: any, error?: any}>} factory - performs ONE write attempt. Called
 *   fresh on every retry (never a single promise reused across attempts) so it can re-read whatever
 *   value it should currently be sending — the same reasoning settingsWriter's retryKey uses.
 * @param {{target: string, label?: string, attempts?: number, baseDelayMs?: number,
 *   shouldAbort?: (error: any) => boolean, report?: boolean, retryable?: boolean}} opts
 *   `target` (required): identifies WHAT this writes, shared by anything that could race to write
 *   the same thing (e.g. `functions:${id}`, `settings:${key}`) — this is what supersession keys on.
 *   `report` (default true): on final failure, surface it via saveHealth.
 *   `retryable` (default true): whether the reported failure gets a Retry action at all (manual
 *   click, or the automatic one-shot attempt on reconnect). Set false for a write whose `factory`
 *   closes over a value computed from a point-in-time read (a read-merge-write, or a value seeded
 *   from a default) rather than re-reading fresh at retry time — resending that captured value much
 *   later, possibly after someone else has since changed the same data, can silently overwrite their
 *   change with this stale one. `report:true, retryable:false` still shows the failure with a
 *   Discard button, just no Retry.
 * @returns {Promise<{ok: boolean, data?: any, error?: any, superseded?: boolean}>}
 */
export async function writeWithRetry(factory, opts) {
  const { target, label, attempts = 4, baseDelayMs = 400, shouldAbort = defaultShouldAbort, report = true, retryable = true } = opts || {};
  if (!target) throw new Error("writeWithRetry: `target` is required (supersession has nothing to key on without it)");
  const myGen = (generation.get(target) || 0) + 1;
  generation.set(target, myGen);
  const isSuperseded = () => generation.get(target) !== myGen;
  const problemId = `write:${target}`;

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isSuperseded()) return { ok: false, superseded: true };
    let data, error;
    try { ({ data, error } = await factory()); } catch (e) { error = e; }
    if (!error) {
      // Still check supersession here: the attempt itself was already in flight and can't be
      // un-sent, but a late success from a now-superseded (older) call must not clear whatever
      // problem a NEWER call for the same target has since reported — otherwise the banner for the
      // newer failure silently disappears while the database actually holds this older value.
      if (report && !isSuperseded()) clearSaveProblem(problemId);
      return { ok: true, data };
    }
    lastError = error;
    if (shouldAbort(error) || attempt === attempts - 1) break;
    await sleep(jitteredDelay(attempt, baseDelayMs));
  }
  if (isSuperseded()) return { ok: false, superseded: true };
  if (report) {
    reportSaveProblem(problemId, {
      label: label || target,
      error: lastError,
      // Bound to the generation this failure was reported under — without this, retrying an OLD
      // banner entry (manually, or via retryAllSaveProblems firing every reported problem on
      // reconnect) would call writeWithRetry fresh and claim the NEWEST generation for itself,
      // superseding a genuinely newer write that might still be mid-retry and silently winning
      // with stale data.
      retry: retryable ? () => (generation.get(target) === myGen ? writeWithRetry(factory, opts) : { ok: false, superseded: true }) : undefined,
    });
  }
  return { ok: false, error: lastError };
}

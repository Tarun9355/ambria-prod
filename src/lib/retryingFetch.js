// Wraps the Supabase client's own `fetch` so a flaky-network READ (GET/HEAD against PostgREST,
// `/rest/v1/`) gets a couple of extra chances before surfacing as a failure to the caller — part of
// the fix for the failure class behind the truss_inventory / settings / platform-config incidents
// (a transient network blip collapsed by a caller's own `.catch(() => [])` into "this table has no
// data," which a later write then persisted over real data). postgrest-js already retries a THROWN
// network error itself with its own backoff before it reaches this wrapper (see the catch below) —
// what this adds on top is a per-attempt timeout for a plain HANG, which postgrest-js has none of
// at all, and a retry for 429/500/502/504 responses, which postgrest-js's own built-in retry does
// not cover (it only retries 503/520). See kv.js's `kvLoadFailed`/IMS.jsx's `loadOkRef` for the
// OTHER half of this fix — those still apply even after this: a read that exhausts every retry
// still has to be treated as a genuine failure, not quietly swallowed.
//
// Writes (POST/PATCH/DELETE/PUT) are NEVER retried here — blindly retrying a write that may have
// already landed risks double-applying it or racing a newer write. That's Phase 2's
// `writeWithRetry`, which carries its own per-target supersession so a late retry can never
// overwrite a newer edit to the same thing. This file only ever touches reads.
//
// Scope is deliberately narrow: only `/rest/v1/` GET/HEAD (PostgREST table reads — an RPC call is a
// POST by default, so it's already excluded as a "write" above regardless of whether it mutates
// anything) — never `/auth/v1/` (session refresh must not be delayed/duplicated by this), never
// `/storage/v1/` or `/functions/v1/`. The `keepaliveUpsert`/`keepaliveRpc` helpers in supabase.js
// call the global `fetch` directly and never go through the Supabase client, so they are untouched
// by this wrapper regardless.

const RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
const PER_ATTEMPT_TIMEOUT_MS = 20000;
// Status codes worth retrying — transient/server-side. An ordinary 4xx (bad request, RLS-denied,
// not found, …) means "this exact request is wrong," so retrying it verbatim would just waste time
// and delay the real error reaching the user. 429 (rate-limited) is the one 4xx worth a retry.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitteredDelay = (attempt) => BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random() * 0.5);

const isRetryableRead = (input, init) => {
  const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const url = typeof input === "string" ? input : input?.url || "";
  return /\/rest\/v1\//.test(url);
};

/**
 * Returns a `fetch`-compatible function for Supabase's `global.fetch` client option.
 * @param {typeof fetch} baseFetch - real fetch to wrap (injectable for tests).
 */
export const makeRetryingFetch = (baseFetch = fetch) => async (input, init) => {
  if (!isRetryableRead(input, init)) return baseFetch(input, init);

  let lastErr;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (init?.signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" }); // cancelled during our own backoff wait
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), PER_ATTEMPT_TIMEOUT_MS);
    const onCallerAbort = () => timeoutController.abort();
    init?.signal?.addEventListener?.("abort", onCallerAbort);
    const isLastAttempt = attempt === RETRY_ATTEMPTS - 1;
    try {
      const res = await baseFetch(input, { ...init, signal: timeoutController.signal });
      if (RETRYABLE_STATUS.has(res.status) && !isLastAttempt) {
        try { await res.body?.cancel(); } catch { /* best-effort — we're discarding this response anyway */ }
        await sleep(jitteredDelay(attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // The caller's OWN signal (not our timeout) asked for this — honor the cancel, don't retry.
      if (init?.signal?.aborted) throw e;
      // supabase-js's underlying postgrest-js client already retries a THROWN network error (DNS
      // failure, connection refused, offline, …) itself, with its own backoff, before this wrapper
      // ever sees it fail for good — retrying it again here would just stack a second multiplying
      // backoff on top for no benefit. Only retry ourselves when OUR OWN per-attempt timeout is what
      // fired (`timeoutController.signal.aborted`) — a hang that postgrest-js has no timeout for at
      // all — or, below, on a retryable HTTP status postgrest-js doesn't already cover.
      if (timeoutController.signal.aborted && !isLastAttempt) { await sleep(jitteredDelay(attempt)); continue; }
      throw e;
    } finally {
      clearTimeout(timeout);
      init?.signal?.removeEventListener?.("abort", onCallerAbort);
    }
  }
  throw lastErr;
};

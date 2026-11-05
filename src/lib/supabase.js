import { createClient } from "@supabase/supabase-js";
import { makeRetryingFetch } from "./retryingFetch.js";
import { writeWithRetry } from "./writeRetry.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

// A flaky-network READ (GET against /rest/v1/) gets a few quick retries before it ever reaches a
// caller's own `.catch(() => [])` — the transient blip behind the truss_inventory/settings/
// platform-config data-loss incidents. Writes are untouched; see retryingFetch.js's own comment.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: makeRetryingFetch() },
});

// Mirrors the current session's access token in memory so keepaliveUpsert/keepaliveRpc (below) can
// read it synchronously at pagehide/beforeunload time, with no await standing between the unload
// event and the fetch call. Hydrated once on load and kept current via onAuthStateChange.
let cachedAccessToken = null;
supabase.auth.getSession().then(({ data }) => { cachedAccessToken = data?.session?.access_token || null; });
supabase.auth.onAuthStateChange((_event, session) => { cachedAccessToken = session?.access_token || null; });

// ─── Helpers ───────────────────────────────────────────

/** Fetch all rows from a table */
// Paged, because a single select is silently capped at the project's max-rows (1000 by default):
// with 1060 rows in `inventory`, the last 60 never reached the app — missing from the Inventory
// tab and unmatchable on the Dept Ops PDF.
// The first request is the same plain select as before, so every small table (most of them, and
// the key-value ones like `settings` / `truss_inventory` that have no `id` column) behaves exactly
// as it did. Only a table that fills that first page is re-read in ordered pages — ordered by id
// so no row is skipped or repeated between requests.
const PAGE = 1000;
export const fetchAll = async (table) => {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  if (!data || data.length < PAGE) return data || [];
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: pageErr } = await supabase.from(table).select("*").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (pageErr) { console.warn(`[fetchAll] paging ${table} failed, keeping the first ${data.length} rows:`, pageErr.message); return data; }
    rows.push(...(page || []));
    if (!page || page.length < PAGE) break;
  }
  return rows;
};

/** Fetch a single row by ID */
export const fetchById = async (table, id) => {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
};

// upsertRow/updateRow/deleteRow all absorb a transient blip with a few fast, silent attempts
// (writeWithRetry) before throwing — each is naturally idempotent (resending the same upsert/
// update/delete twice lands the same final state), so a retry can't itself cause damage. Always
// `retryable:false`: `row`/`changes` is a snapshot of whatever the caller had at CALL time, not
// re-read fresh — callers throughout the app pass a partial patch built from local state (e.g. one
// typed field), and automatically resending that same stale snapshot much later (a reconnect event,
// possibly minutes afterward) could silently overwrite a DIFFERENT, newer change to the same row
// made by someone else (a different tab, a different user) in between. Generation-based
// supersession only protects against a race within THIS browser tab, not across tabs/users, so a
// delayed automatic retry here needs the same caution kv.js's read-merge-write writes already use.
//
// `target` is scoped per ROW (table:id), not per field — two rapid edits to DIFFERENT fields of the
// SAME row (e.g. two keystrokes in two different inline inputs within a couple of seconds) share one
// generation, so if the first one's own internal retry is still running when the second starts, the
// first is treated as superseded and dropped rather than retried further — it does NOT get a
// saveHealth entry of its own (the "superseded" case below throws a clear, non-misleading message,
// but most existing callers of these two helpers already end in `.catch(() => {})` and lose it
// silently, same as any OTHER failure these always had, before or after this change). Scoping per
// FIELD SET instead would be unsafe the other direction (two overlapping-but-different field sets
// would stop superseding each other at all, letting a stale retry of the narrower set land after a
// newer, wider one and revert part of it) — so this is accepted as a known, narrow limitation rather
// than "fixed" with a shape that trades one race for a worse one. Scoping is genuinely safe at the
// granularity used throughout this app: exactly one changed row, in the narrow handful of seconds a
// transient blip's own retry window can last.
const rowTarget = (table, id) => `${table}:${id}`;

const throwWriteError = (res) => {
  if (res.superseded) throw new Error("A more recent edit to the same item has already gone out — this save was dropped.");
  if (res.error instanceof Error) throw res.error;
  // Preserve PostgREST's own error shape (code/details/hint) on the thrown Error, not just its
  // message — supabase-js resolves `error` as a plain object, not an Error instance, so without this
  // any caller checking e.g. `e.code === "23505"` would silently stop seeing it after this change.
  throw Object.assign(new Error(res.error?.message || String(res.error || "Write failed")), {
    code: res.error?.code, details: res.error?.details, hint: res.error?.hint,
  });
};

/** Upsert (insert or update) a row */
export const upsertRow = async (table, row) => {
  const res = await writeWithRetry(
    () => supabase.from(table).upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" }).select().single(),
    { target: rowTarget(table, row.id), label: `${table} row`, retryable: false },
  );
  if (!res.ok) throwWriteError(res);
  return res.data;
};

/** Update specific fields on a row */
export const updateRow = async (table, id, changes) => {
  const res = await writeWithRetry(
    () => supabase.from(table).update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
    { target: rowTarget(table, id), label: `${table} row`, retryable: false },
  );
  if (!res.ok) throwWriteError(res);
  return res.data;
};

/** Delete a row by ID */
export const deleteRow = async (table, id) => {
  const res = await writeWithRetry(
    () => supabase.from(table).delete().eq("id", id),
    { target: rowTarget(table, id), label: `${table} row`, retryable: false },
  );
  if (!res.ok) throwWriteError(res);
};

// Last-ditch save for the exact moment the page is unloading (pagehide/beforeunload) — a normal
// supabase-js request is a plain fetch under the hood, and browsers are free to kill an in-flight
// request the instant the page starts tearing down, before it reaches the server. `keepalive: true`
// is the browser's own guarantee that a small POST like this is still delivered even after the page
// is gone — the purpose-built fix for this, vs. hoping a regular request survives.
// Same REST semantics `.upsert(rows, {onConflict:"id"})` uses under the hood (the on_conflict query
// param + Prefer: resolution=merge-duplicates). `apikey` identifies the project (always the anon
// key); `Authorization` carries the signed-in user's own JWT via cachedAccessToken so this still
// writes under their real session post-RLS-cutover — not the anon key, which no longer has table
// access on its own. Subject to the browser's keepalive payload cap (~64KB across all in-flight
// keepalive requests) — best-effort on top of the normal save attempt that already fires alongside
// it, not a replacement for it.
export const keepaliveUpsert = async (table, rows) => {
  if (!rows || !rows.length) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${cachedAccessToken || supabaseAnonKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch { /* best-effort — the page is already unloading */ }
};

// Same keepalive guarantee as keepaliveUpsert, but for a Postgres FUNCTION call instead of a plain
// table upsert — PostgREST exposes every function at /rest/v1/rpc/<name>, so this is just that same
// POST shape with the RPC's own named params as the body. Needed for merge_client_ledger_rows
// (migration 034): a plain table upsert REPLACES the `data` jsonb column outright, which would wipe
// a client's Deal Check draft (dcDraft/dcCards/…) the moment that client was lazy-loaded partially —
// the RPC does a shallow merge instead, same as the non-keepalive save path uses via supabase.rpc().
export const keepaliveRpc = async (fnName, params) => {
  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${cachedAccessToken || supabaseAnonKey}`,
      },
      body: JSON.stringify(params || {}),
    });
  } catch { /* best-effort — the page is already unloading */ }
};

/** Subscribe to real-time changes on a table */
// One channel PER CALLER, not per table. supabase.channel(name) returns the EXISTING channel when
// the name matches, and postgres_changes callbacks cannot be added to a channel that has already
// subscribed — so a second component watching the same table used to throw
// "cannot add `postgres_changes` callbacks for realtime:realtime:<table> after `subscribe()`"
// and take the whole screen down. Two components legitimately watch `library` (StudioApp's row
// cache and Manage's chip counts), so the name has to be unique. Callers already removeChannel on
// cleanup, so these do not accumulate.
let channelSeq = 0;
export const subscribeTable = (table, callback) => {
  return supabase
    .channel(`realtime:${table}:${++channelSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, callback)
    .subscribe();
};

/** Subscribe to changes on a specific row */
export const subscribeRow = (table, id, callback) => {
  return supabase
    .channel(`realtime:${table}:${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter: `id=eq.${id}` }, callback)
    .subscribe();
};

/**
 * Claim presence on a client's deal — peek who's already there and, only if nobody (including this
 * SAME user from another device/tab) is, mark this one present too, as ONE operation (peek-then-
 * separately-track would let two opens in the same instant both see "nobody here" and both
 * proceed). One device at a time PER PERSON, not just "no two different people" — the same user's
 * own second tab/device is exactly as able to end up holding stale/aliased in-memory state as a
 * different person's would (see suspiciousDuplicateFnIdxs, lib/studio/sessionData.js, the fix for
 * the symptom when two concurrent editors — same person or different — already got one; this is
 * the fix for not starting a second one in the first place).
 *
 * Realtime Presence, not a DB lock row on purpose — a crashed tab or dropped connection drops off
 * this channel automatically within seconds, so there is no stale lock to find and clear by hand
 * the way a lock row would need.
 *
 * Resolves with `{ channel, others, selfElsewhere }` once the channel's initial presence state
 * lands (the same subscribe round-trip subscribeTable/subscribeRow already cost, nothing new):
 *   - `others`: every DIFFERENT user (key !== me.id) already tracked on this deal right now.
 *   - `selfElsewhere`: true when `me.id`'s OWN key is already tracked — i.e. this same person has
 *     this deal open on another device/tab already (not this one, which hasn't tracked yet).
 *   - `channel`: already tracking `me` (so the NEXT caller, anyone's, sees this tab) only when
 *     BOTH `others` is empty AND `selfElsewhere` is false; left as a bare, untracked subscriber
 *     otherwise — the caller must not call `.track()` on it themselves in that case, just
 *     `supabase.removeChannel(channel)` it and block.
 *
 * Cleanup when this user navigates away: `supabase.removeChannel(channel)`, same as
 * subscribeTable/subscribeRow.
 *
 * FAILS OPEN, never silently stuck: if the channel never reaches SUBSCRIBED (a dropped
 * connection, a Realtime hiccup, an auth blip) the "sync" event this resolves on would otherwise
 * never fire — a secondary safety feature has no business freezing the actual Load click with no
 * feedback forever. A subscribe-status callback resolves immediately on an error/timeout status,
 * and a 5s backstop resolves it regardless if even that never arrives, both with
 * `{others: [], selfElsewhere: false}` — i.e. let the open proceed rather than hang. Logged, not
 * silent, so a real outage is still visible.
 *
 * @param {string} clientId
 * @param {{id:string, name?:string}} me
 * @returns {Promise<{channel: object, others: Array<{userId:string, userName:string, since:number}>, selfElsewhere: boolean}>}
 */
export const claimDealPresence = (clientId, me) => new Promise((resolve) => {
  const channel = supabase.channel(`realtime:presence:client:${clientId}`, { config: { presence: { key: me.id } } });
  let settled = false;
  let backstop;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(backstop);
    resolve({ channel, ...result });
  };
  backstop = setTimeout(() => {
    console.warn(`[claimDealPresence] Presence check for client ${clientId} never synced — letting the open proceed rather than block on it.`);
    settle({ others: [], selfElsewhere: false });
  }, 5000);
  channel
    .on("presence", { event: "sync" }, async () => {
      if (settled) return;
      const state = channel.presenceState();
      const others = Object.entries(state)
        .filter(([key]) => key !== me.id)
        .map(([, metas]) => metas[0])
        .filter(Boolean);
      const selfElsewhere = Array.isArray(state[me.id]) && state[me.id].length > 0;
      if (!others.length && !selfElsewhere) {
        try { await channel.track({ userId: me.id, userName: me.name || "Someone", since: Date.now() }); } catch { /* best-effort */ }
      }
      settle({ others, selfElsewhere });
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn(`[claimDealPresence] Presence channel for client ${clientId} failed to subscribe (${status}) — letting the open proceed rather than block on it.`);
        settle({ others: [], selfElsewhere: false });
      }
    });
});

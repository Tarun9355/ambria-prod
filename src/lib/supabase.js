import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

/** Upsert (insert or update) a row */
export const upsertRow = async (table, row) => {
  const { data, error } = await supabase
    .from(table)
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Update specific fields on a row */
export const updateRow = async (table, id, changes) => {
  const { data, error } = await supabase
    .from(table)
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Delete a row by ID */
export const deleteRow = async (table, id) => {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
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
 * Claim presence on a client's deal — peek who's already there and, only if nobody is, mark this
 * user as present too, as ONE operation (peek-then-separately-track would let two people clicking
 * Load in the same instant both see "nobody here" and both proceed). Confirmed race-condition risk
 * this closes: two users editing the same deal's build at once is exactly how one function's
 * content ended up saved under a different function's slot (Sangeeta, 2026-11-03 — see
 * suspiciousDuplicateFnIdxs, lib/studio/sessionData.js, the fix for the symptom; this is the fix
 * for not starting a second concurrent editor in the first place).
 *
 * Realtime Presence, not a DB lock row on purpose — a crashed tab or dropped connection drops off
 * this channel automatically within seconds, so there is no stale lock to find and clear by hand
 * the way a lock row would need.
 *
 * Resolves with `{ channel, others }` once the channel's initial presence state lands (the same
 * subscribe round-trip subscribeTable/subscribeRow already cost, nothing new):
 *   - `others`: every OTHER user (key !== me.id) already tracked on this deal right now.
 *   - `channel`: already tracking `me` (so the NEXT caller sees this tab) when `others` is empty;
 *     left as a bare, untracked subscriber when `others` is non-empty — the caller must not call
 *     `.track()` on it themselves in that case, just `supabase.removeChannel(channel)` it and block.
 *
 * Cleanup when this user navigates away: `supabase.removeChannel(channel)`, same as
 * subscribeTable/subscribeRow.
 *
 * FAILS OPEN, never silently stuck: if the channel never reaches SUBSCRIBED (a dropped
 * connection, a Realtime hiccup, an auth blip) the "sync" event this resolves on would otherwise
 * never fire — a secondary safety feature has no business freezing the actual Load click with no
 * feedback forever. A subscribe-status callback resolves immediately on an error/timeout status,
 * and a 5s backstop resolves it regardless if even that never arrives, both with `others: []` —
 * i.e. let the open proceed rather than hang. Logged, not silent, so a real outage is still visible.
 *
 * @param {string} clientId
 * @param {{id:string, name?:string}} me
 * @returns {Promise<{channel: object, others: Array<{userId:string, userName:string, since:number}>}>}
 */
export const claimDealPresence = (clientId, me) => new Promise((resolve) => {
  const channel = supabase.channel(`realtime:presence:client:${clientId}`, { config: { presence: { key: me.id } } });
  let settled = false;
  let backstop;
  const settle = (others) => {
    if (settled) return;
    settled = true;
    clearTimeout(backstop);
    resolve({ channel, others });
  };
  backstop = setTimeout(() => {
    console.warn(`[claimDealPresence] Presence check for client ${clientId} never synced — letting the open proceed rather than block on it.`);
    settle([]);
  }, 5000);
  channel
    .on("presence", { event: "sync" }, async () => {
      if (settled) return;
      const state = channel.presenceState();
      const others = Object.entries(state)
        .filter(([key]) => key !== me.id)
        .map(([, metas]) => metas[0])
        .filter(Boolean);
      if (!others.length) {
        try { await channel.track({ userId: me.id, userName: me.name || "Someone", since: Date.now() }); } catch { /* best-effort */ }
      }
      settle(others);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn(`[claimDealPresence] Presence channel for client ${clientId} failed to subscribe (${status}) — letting the open proceed rather than block on it.`);
        settle([]);
      }
    });
});

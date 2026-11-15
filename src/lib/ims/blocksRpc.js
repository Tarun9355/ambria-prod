// The ONLY sanctioned way to write to the `blocks` table from here on (bug 4, 2026-11-14 inventory-
// blocks audit) — see supabase/migrations/066_blocks_write_rpc.sql for the locked, availability-
// checking Postgres function this calls. Every former writer (Studio's reconcile, IMS's manual Block/
// Bulk Block, IMS's auto-confirm, an approved amend) is migrated to go through this module instead of
// its own hand-rolled read-modify-write upsert — a plain `.from("blocks").upsert(...)` has no row lock
// and no availability check, which is exactly the class of bug this whole phase exists to close off.
//
// This module does no business-logic deciding (which items/dates/quantities to reserve, what counts
// as "allowed to overbook") — that's each caller's own job, same as before. It only wraps the RPC call
// itself and the small amount of bookkeeping every caller needs around it (merging the RPC's returned
// rows back into local state, reading off which items came back short).

export const BLOCKS_RPC = "apply_block_ops";

// ops: [{ item_id, event_id, remove: [{source, date}], add: [{date, qty, status?, source?, ...}] }]
// onShort: "reject" (default — write nothing at all if anything would be short), "cap" (grant what
//   fits, report the rest), or "force" (write exactly what was asked, report what would have been
//   short) — see the migration's own header for the full semantics of each.
// Returns { ok, applied, items, rows, error }. An empty/no-op `ops` array short-circuits without a
// network call: { ok:true, applied:false, items:[], rows:[] }.
export async function applyBlockOps(client, ops, { onShort = "reject" } = {}) {
  const list = Array.isArray(ops) ? ops.filter((o) => o && o.item_id && o.event_id) : [];
  if (!list.length) return { ok: true, applied: false, items: [], rows: [] };
  const { data, error } = await client.rpc(BLOCKS_RPC, { p_ops: list, p_on_short: onShort });
  if (error) return { ok: false, applied: false, items: [], rows: [], error };
  return { ok: !!data?.ok, applied: !!data?.applied, items: Array.isArray(data?.items) ? data.items : [], rows: Array.isArray(data?.rows) ? data.rows : [] };
}

// A local { [itemId]: entries[] } blocks map, with the RPC's own returned `rows` ({item_id, data})
// applied on top — the RPC's result is the new authoritative content for exactly the items it
// touched; every item NOT in `rows` (nothing changed for it, or the call didn't touch it) is left
// exactly as it was in `blocksMap`. Returns the SAME object when `rows` is empty.
export function mergeBlockRows(blocksMap, rows) {
  if (!Array.isArray(rows) || !rows.length) return blocksMap || {};
  const next = { ...(blocksMap || {}) };
  rows.forEach((r) => { if (r?.item_id) next[r.item_id] = Array.isArray(r.data) ? r.data : []; });
  return next;
}

// Every (item, date) the RPC couldn't fully grant — applyBlockOps's own result.items, filtered to
// just the short ones. Empty array when nothing was short (including when onShort:"reject" refused
// the whole call — in that case `items` itself still carries the would-be shortfalls for display).
export function shortfallsOf(result) {
  return (result?.items || []).filter((i) => i && Number(i.short) > 0);
}

// One "add" entry, in the shape apply_block_ops expects — a small convenience for the common case
// of a caller building a single op with no removes (a brand-new hold, nothing superseded).
export function appendOp({ itemId, eventId, date, qty, source, status = "confirmed", allowOver = false, extra }) {
  return { item_id: itemId, event_id: eventId, remove: [], add: [{ date, qty, status, source, allowOver, ...(extra ? { extra } : {}) }] };
}

-- ═══ ORPHANED BLOCKS ON EVENT-ORDER DELETE ═══
-- `blocks` holds one row per inventory item, `data` a JSON array of {date, eventId, qty, ...}
-- reservation entries. src/pages/studio/StudioApp.jsx's saveEventOrders can hard-DELETE an
-- `event_orders` row (a function/deal removed from Studio) but never touches that event's own
-- entries in `blocks` — they're left behind forever, permanently reserving real stock against an
-- eventId nothing will ever match again. The picker correctly refuses to pretend an unresolvable
-- eventId is "nobody's" (shows "Unknown event" rather than silently crediting the stock back), so
-- the practical effect is: every such deletion quietly and permanently shrinks that item's real
-- availability, with no error and no visible owner — confirmed live (STR-00059 "moulding bar", 12
-- total pieces, a single stale entry alone claiming 32 units on 2026-11-24 for event eo_mqutqqss,
-- which no longer exists in event_orders at all).
--
-- Two parts: (a) a one-time backfill that strips every CURRENTLY orphaned entry across the whole
-- table (fixes every case like this that already exists, not just the one reported), and (b) a
-- trigger so a FUTURE event_orders delete can never create a new one.

-- ── a) Backfill: drop every blocks entry whose eventId matches NOTHING live ──
-- Not just event_orders — every known id scheme a real writer can put in `eventId`:
--   - src/pages/ims/ApprovalsTab.jsx's applyBlocks: `req.eventOrderId || req.clientId || req.id` — a
--     defensive fallback for a malformed amend request missing its real event_orders id, so a handful
--     of real, still-valid entries could carry a client_ledger id or an amend_requests id instead.
--   - src/pages/ims/InventoryTab.jsx's blockItem/submitBulk: `fn.eventOrderId || fn.id` (fn a row from
--     the IMS `functions` table) — same reasoning, a legacy function row missing its own eventOrderId
--     link falls back to its own functions.id.
-- An entry only counts as orphaned (and gets dropped) if its eventId matches NONE of these four
-- tables — checking event_orders alone would risk wrongly releasing one of those fallback-shaped but
-- still-live reservations.
-- Guarded by jsonb_typeof — a row that predates any write (DEFAULT '{}', never an array) is left
-- alone rather than erroring on jsonb_array_elements.
--
-- Run the dry-run SELECT below FIRST and read every row it returns before running the UPDATE — it
-- catches anything from an even older id scheme (pre-dating any writer currently in the codebase)
-- that no amount of code-reading can rule out:
--
-- select b.id as item_id, e->>'eventId' as event_id, e->>'date' as date, e->>'qty' as qty,
--        e->>'source' as source, e->>'status' as status
-- from public.blocks b, jsonb_array_elements(b.data) e
-- where jsonb_typeof(b.data) = 'array'
--   and not exists (select 1 from public.event_orders eo where eo.id = e->>'eventId')
--   and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eventId')
--   and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eventId')
--   and not exists (select 1 from public.functions f where f.id = e->>'eventId')
-- order by 2, 3;
update public.blocks
set data = coalesce((
  select jsonb_agg(e)
  from jsonb_array_elements(data) e
  where exists (select 1 from public.event_orders eo where eo.id = e->>'eventId')
     or exists (select 1 from public.client_ledger cl where cl.id = e->>'eventId')
     or exists (select 1 from public.amend_requests ar where ar.id = e->>'eventId')
     or exists (select 1 from public.functions f where f.id = e->>'eventId')
), '[]'::jsonb)
where jsonb_typeof(data) = 'array'
  and exists (
    select 1 from jsonb_array_elements(data) e
    where not exists (select 1 from public.event_orders eo where eo.id = e->>'eventId')
      and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eventId')
      and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eventId')
      and not exists (select 1 from public.functions f where f.id = e->>'eventId')
  );

-- ── b) Going forward: an AFTER DELETE trigger releases that event's entries from every blocks row ──
-- Catches every deletion path (not just StudioApp.jsx's saveEventOrders — any future one too),
-- since it runs in the database itself rather than relying on whichever app code happens to delete
-- the row remembering to clean up after itself.
create or replace function public.release_blocks_for_deleted_event()
returns trigger
language plpgsql
as $$
begin
  update public.blocks
  set data = coalesce((
    select jsonb_agg(e)
    from jsonb_array_elements(data) e
    where e->>'eventId' is distinct from old.id
  ), '[]'::jsonb)
  where jsonb_typeof(data) = 'array'
    and exists (select 1 from jsonb_array_elements(data) e where e->>'eventId' = old.id);
  return old;
end;
$$;

drop trigger if exists trg_release_blocks_on_event_order_delete on public.event_orders;
create trigger trg_release_blocks_on_event_order_delete
after delete on public.event_orders
for each row
execute function public.release_blocks_for_deleted_event();

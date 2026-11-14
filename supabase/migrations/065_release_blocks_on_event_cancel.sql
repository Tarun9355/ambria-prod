-- ═══ ORPHANED BLOCKS ON EVENT-ORDER CANCEL ═══
-- Sibling of 057 (which covers a DELETEd event_orders row) — this covers the other way an event
-- stops needing its held stock: status flips to 'cancelled' without its `blocks` entries ever being
-- released. The app's own release path (src/pages/ims/CalendarTab.jsx's cancelStudioEvent) does call
-- releaseBlocks + save `blocks` when a human clicks "✕ Cancel" — but that is two separate,
-- non-atomic saves (status, then blocks, as of this migration's date — previously blocks first), so
-- a failed/raced second write, a direct DB edit of status, or an LMS sync overwriting status can all
-- leave a cancelled event's reservation sitting in `blocks` forever, with no UI path left to release
-- it once status already reads "cancelled" (the Cancel button itself is gated on status !=
-- 'cancelled'). Confirmed live, 2026-11-14 ("Test 2" and several other cancelled test deals —
-- eo_mvazcpms, eo_mv9it2wz, eo_mvkpbka7, eo_mugq6lsj, eo_mvazaan3, eo_mvlxyix6, eo_mvm9g3ep — were
-- still holding ~95 reservations across ~40 inventory items, read as real competing stock by
-- Studio's own availability picker).
--
-- A read-time filter (src/lib/ims/liveBlocks.js) now makes every app-side reader of `blocks` treat a
-- cancelled event's entries as not-there regardless of whether this release ever runs — so this
-- migration is a belt-and-braces backstop, not the only thing standing between a cancelled deal and
-- a wrongly-reduced availability count. It still matters for: anything reading `blocks` outside that
-- app code (a SQL report, a future script), and for keeping the table itself from growing forever
-- with reservations nothing will ever need again (Studio's own reconcile carries a "foreign" entry
-- forward untouched indefinitely — it is never the one to clean this up).
--
-- Two parts, same shape as 057: (a) a one-time backfill for every CURRENTLY orphaned entry, and
-- (b) a trigger so a FUTURE cancel (through any path, not just the Cancel button) releases it too.

-- ── a) Backfill: drop every blocks entry whose eventId belongs to an event_orders row that is
--      status = 'cancelled'. Only event_orders carries a cancellable status — the other fallback id
--      schemes an entry's eventId can hold (client_ledger, amend_requests, functions — see 057's own
--      comment) have no "cancelled" concept of their own and are left alone here.
--
-- Run this dry-run SELECT first and read every row before running the UPDATE:
--
-- select b.id as item_id, e->>'eventId' as event_id, eo.client_name, e->>'date' as date,
--        e->>'qty' as qty, e->>'source' as source
-- from public.blocks b, jsonb_array_elements(b.data) e
-- join public.event_orders eo on eo.id = e->>'eventId'
-- where jsonb_typeof(b.data) = 'array'
--   and eo.status = 'cancelled'
-- order by 2, 4;
update public.blocks
set data = coalesce((
  select jsonb_agg(e)
  from jsonb_array_elements(data) e
  left join public.event_orders eo on eo.id = e->>'eventId'
  where eo.status is distinct from 'cancelled'
), '[]'::jsonb)
where jsonb_typeof(data) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(data) e
    join public.event_orders eo on eo.id = e->>'eventId'
    where eo.status = 'cancelled'
  );

-- ── b) Going forward: an AFTER UPDATE OF status trigger releases that event's entries the moment
--      status becomes 'cancelled', in the SAME transaction as the status change — covers the Cancel
--      button, a direct DB edit, an LMS sync overwrite, and any future code path alike, instead of
--      relying on app code to remember to clean up after itself.
create or replace function public.release_blocks_for_cancelled_event()
returns trigger
language plpgsql
as $$
begin
  update public.blocks
  set data = coalesce((
    select jsonb_agg(e)
    from jsonb_array_elements(data) e
    where e->>'eventId' is distinct from new.id
  ), '[]'::jsonb)
  where jsonb_typeof(data) = 'array'
    and exists (select 1 from jsonb_array_elements(data) e where e->>'eventId' = new.id);
  return new;
end;
$$;

drop trigger if exists trg_release_blocks_on_event_order_cancel on public.event_orders;
create trigger trg_release_blocks_on_event_order_cancel
after update of status on public.event_orders
for each row
when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
execute function public.release_blocks_for_cancelled_event();

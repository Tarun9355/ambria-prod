-- ═══ ORPHANED TRUSS/PLATFORM/BATTA ALLOCATIONS ON EVENT-ORDER DELETE ═══
-- Same bug shape as 057 (blocks), different tables. `truss_allocations`/`platform_allocations`/
-- `batta_allocations` hold ONE ROW PER DATE: `events` a JSON array of {eoId, clientId, state, ...qty}
-- reservation entries, `pool` a snapshot (stockSummary, lastCascadeAt/By) computed alongside them.
--
-- IMS's promote effects (src/pages/ims/IMS.jsx ~1833/1937/2039) write a `state:"hard"` entry for
-- every non-pending event order's demand on a date. Their only cleanup is "replace MY OWN eoId's
-- entry on the dates I currently have" (~1856-1860) — once that event_orders row is hard-deleted
-- (StudioApp.jsx's saveEventOrders / IMS.jsx's own delete path), that effect never runs for it again,
-- so its entries sit there forever, exactly like the blocks bug. The real damage: Studio's own
-- pre-"mark Sold" gate (scanTrussStockShortage, StudioApp.jsx ~6276-6322) sums every OTHER event's
-- entries on the date and HARD-BLOCKS marking a deal Sold (~9638-9639, ~9725-9726) — a salesperson can
-- be wrongly refused Sold status today because of phantom demand from a deleted deal. IMS's own
-- Structure Planning tab also still lists/counts the dead client.
--
-- Two parts, same shape as 057: (a) a one-time backfill, (b) a trigger so a future delete can't
-- recreate this gap. Three structural differences from 057 that change the SQL (see each part's own
-- comment for why): the array column is `events`, not `data`, keyed by `eoId` not `eventId`; a
-- "soft" entry (a provisional/simulated hold, never actually saved by current code but real legacy
-- rows may still carry one — e.g. a removed Studio feature that wrote `eoId: "soft-"+clientId`) must
-- NEVER be touched, since it isn't tied to any event_orders id at all and every reader already treats
-- it as a different lifecycle; and `pool.stockSummary` can go stale once an entry is stripped.
--
-- ── BEFORE RUNNING ANYTHING: back these up ──
-- truss_allocations is covered by 037's audit_log trigger (old/new values saved automatically).
-- platform_allocations and batta_allocations are NOT — export dry-run query #1 below to CSV first.
--
-- ── Dry-run #1: every entry this migration will strip (export to CSV before running part (a)) ──
-- select 'truss' as domain, a.date, e->>'eoId' as eo_id, e->>'clientId' as client_id,
--        e->>'clientName' as client_name, e->>'state' as state, e->>'heldBy' as held_by,
--        e->>'createdAt' as created_at_ms,
--        jsonb_build_object('pillars', e->'totalPillarsUsed', 'beams', e->'totalBeamsUsed') as demand,
--        e as full_entry
-- from public.truss_allocations a, jsonb_array_elements(a.events) e
-- where jsonb_typeof(a.events) = 'array'
--   and coalesce(e->>'state', '') <> 'soft'
--   and coalesce(e->>'eoId', '') <> ''
--   and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--   and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--   and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--   and not exists (select 1 from public.functions f where f.id = e->>'eoId')
-- union all
-- select 'platform', a.date, e->>'eoId', e->>'clientId', e->>'clientName', e->>'state', e->>'heldBy',
--        e->>'createdAt', e->'totalPlatformSqftByMaterial', e
-- from public.platform_allocations a, jsonb_array_elements(a.events) e
-- where jsonb_typeof(a.events) = 'array'
--   and coalesce(e->>'state', '') <> 'soft'
--   and coalesce(e->>'eoId', '') <> ''
--   and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--   and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--   and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--   and not exists (select 1 from public.functions f where f.id = e->>'eoId')
-- union all
-- select 'batta', a.date, e->>'eoId', e->>'clientId', e->>'clientName', e->>'state', e->>'heldBy',
--        e->>'createdAt', e->'totalBattaRftByMaterial', e
-- from public.batta_allocations a, jsonb_array_elements(a.events) e
-- where jsonb_typeof(a.events) = 'array'
--   and coalesce(e->>'state', '') <> 'soft'
--   and coalesce(e->>'eoId', '') <> ''
--   and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--   and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--   and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--   and not exists (select 1 from public.functions f where f.id = e->>'eoId')
-- order by eo_id, domain, date;
--
-- ── Dry-run #2: dates whose pool/stockSummary will be reset to '{}' (no non-soft entry survives) ──
-- select 'truss' as domain, a.date, jsonb_array_length(a.events) as entries_now
-- from public.truss_allocations a
-- where jsonb_typeof(a.events) = 'array'
--   and exists (select 1 from jsonb_array_elements(a.events) e
--               where coalesce(e->>'state','') <> 'soft' and coalesce(e->>'eoId','') <> ''
--                 and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                 and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                 and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                 and not exists (select 1 from public.functions f where f.id = e->>'eoId'))
--   and not exists (select 1 from jsonb_array_elements(a.events) e
--                   where coalesce(e->>'state','') <> 'soft'
--                     and (coalesce(e->>'eoId','') = ''
--                       or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                       or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                       or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                       or exists (select 1 from public.functions f where f.id = e->>'eoId')))
-- union all
-- select 'platform', a.date, jsonb_array_length(a.events)
-- from public.platform_allocations a
-- where jsonb_typeof(a.events) = 'array'
--   and exists (select 1 from jsonb_array_elements(a.events) e
--               where coalesce(e->>'state','') <> 'soft' and coalesce(e->>'eoId','') <> ''
--                 and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                 and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                 and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                 and not exists (select 1 from public.functions f where f.id = e->>'eoId'))
--   and not exists (select 1 from jsonb_array_elements(a.events) e
--                   where coalesce(e->>'state','') <> 'soft'
--                     and (coalesce(e->>'eoId','') = ''
--                       or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                       or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                       or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                       or exists (select 1 from public.functions f where f.id = e->>'eoId')))
-- union all
-- select 'batta', a.date, jsonb_array_length(a.events)
-- from public.batta_allocations a
-- where jsonb_typeof(a.events) = 'array'
--   and exists (select 1 from jsonb_array_elements(a.events) e
--               where coalesce(e->>'state','') <> 'soft' and coalesce(e->>'eoId','') <> ''
--                 and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                 and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                 and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                 and not exists (select 1 from public.functions f where f.id = e->>'eoId'))
--   and not exists (select 1 from jsonb_array_elements(a.events) e
--                   where coalesce(e->>'state','') <> 'soft'
--                     and (coalesce(e->>'eoId','') = ''
--                       or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
--                       or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
--                       or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
--                       or exists (select 1 from public.functions f where f.id = e->>'eoId')));
--
-- ── Dry-run #3: entries deliberately left alone, for a look only (not acted on by this migration) ──
-- select 'truss' as domain, count(*) filter (where coalesce(e->>'eoId','') = '' and coalesce(e->>'state','') <> 'soft') as null_eoid_nonsoft,
--        count(*) filter (where e->>'state' = 'soft') as soft_entries
-- from public.truss_allocations a, jsonb_array_elements(a.events) e where jsonb_typeof(a.events) = 'array'
-- union all
-- select 'platform', count(*) filter (where coalesce(e->>'eoId','') = '' and coalesce(e->>'state','') <> 'soft'),
--        count(*) filter (where e->>'state' = 'soft')
-- from public.platform_allocations a, jsonb_array_elements(a.events) e where jsonb_typeof(a.events) = 'array'
-- union all
-- select 'batta', count(*) filter (where coalesce(e->>'eoId','') = '' and coalesce(e->>'state','') <> 'soft'),
--        count(*) filter (where e->>'state' = 'soft')
-- from public.batta_allocations a, jsonb_array_elements(a.events) e where jsonb_typeof(a.events) = 'array';
--
-- ── Dry-run #4: sanity-check against the 3 ids already confirmed deleted via 057's own investigation ──
-- select id from public.event_orders where id in ('eo_mqrz0x64','eo_mqutqqss','eo_msa2gjln'); -- expect 0 rows
--
-- ── Dry-run #5: are these tables actually on supabase_realtime? (052's own comment only claims it) ──
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime'
--   and tablename in ('truss_allocations','platform_allocations','batta_allocations');

-- ── a) Backfill: drop every non-soft entry whose eoId matches NOTHING live, per table ──
-- Checked against the same four tables as 057 (event_orders, client_ledger, amend_requests,
-- functions) even though the only CURRENT writer (IMS's promote effects) ever puts a real
-- event_orders.id in eoId — matching 057's own discipline costs nothing (it only ever KEEPS more
-- entries, never fewer) and guards against any pre-repo data from the old blob-based system.
-- A SOFT entry (state:'soft') is never touched — it was never tied to a real event_orders id at all
-- (legacy examples used "soft-"+clientId), and every reader already treats it under different rules.
-- A non-soft entry with a missing/empty eoId is also left alone (can't prove it's orphaned) — it
-- shows up in dry-run #3 for a manual look, unlike 057 which had no such case to worry about.
-- `pool` (the stockSummary snapshot) is reset to '{}' only when NO non-soft entry survives on that
-- date — matching what allocateForDate itself means by "a date with no allocation" (it deletes the
-- date's row entirely in that case). A date that still has other live entries keeps its stockSummary
-- as-is until IMS next recomputes it: trussPromotedRef/platformPromotedRef/battaPromotedRef are
-- per-mount Sets, so every non-pending event order still active on that date gets re-promoted (and
-- that date's stockSummary recomputed and saved) on the very next IMS page load — a self-heal that
-- only fails to reach a date where NONE of the surviving entries belongs to a still-active event order
-- on it, which is the mixed-date case this migration deliberately leaves slightly stale (an overcount,
-- the safe direction, not an undercount).
update public.truss_allocations a
set events = coalesce((
      select jsonb_agg(e)
      from jsonb_array_elements(a.events) e
      where coalesce(e->>'state', '') = 'soft'
         or coalesce(e->>'eoId', '') = ''
         or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
         or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
         or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
         or exists (select 1 from public.functions f where f.id = e->>'eoId')
    ), '[]'::jsonb),
    pool = case when exists (
             select 1 from jsonb_array_elements(a.events) e
             where coalesce(e->>'state', '') <> 'soft'
               and (coalesce(e->>'eoId', '') = ''
                 or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
                 or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
                 or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
                 or exists (select 1 from public.functions f where f.id = e->>'eoId'))
           ) then a.pool else '{}'::jsonb end
where jsonb_typeof(a.events) = 'array'
  and exists (
    select 1 from jsonb_array_elements(a.events) e
    where coalesce(e->>'state', '') <> 'soft'
      and coalesce(e->>'eoId', '') <> ''
      and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
      and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
      and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
      and not exists (select 1 from public.functions f where f.id = e->>'eoId')
  );

update public.platform_allocations a
set events = coalesce((
      select jsonb_agg(e)
      from jsonb_array_elements(a.events) e
      where coalesce(e->>'state', '') = 'soft'
         or coalesce(e->>'eoId', '') = ''
         or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
         or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
         or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
         or exists (select 1 from public.functions f where f.id = e->>'eoId')
    ), '[]'::jsonb),
    pool = case when exists (
             select 1 from jsonb_array_elements(a.events) e
             where coalesce(e->>'state', '') <> 'soft'
               and (coalesce(e->>'eoId', '') = ''
                 or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
                 or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
                 or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
                 or exists (select 1 from public.functions f where f.id = e->>'eoId'))
           ) then a.pool else '{}'::jsonb end
where jsonb_typeof(a.events) = 'array'
  and exists (
    select 1 from jsonb_array_elements(a.events) e
    where coalesce(e->>'state', '') <> 'soft'
      and coalesce(e->>'eoId', '') <> ''
      and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
      and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
      and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
      and not exists (select 1 from public.functions f where f.id = e->>'eoId')
  );

update public.batta_allocations a
set events = coalesce((
      select jsonb_agg(e)
      from jsonb_array_elements(a.events) e
      where coalesce(e->>'state', '') = 'soft'
         or coalesce(e->>'eoId', '') = ''
         or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
         or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
         or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
         or exists (select 1 from public.functions f where f.id = e->>'eoId')
    ), '[]'::jsonb),
    pool = case when exists (
             select 1 from jsonb_array_elements(a.events) e
             where coalesce(e->>'state', '') <> 'soft'
               and (coalesce(e->>'eoId', '') = ''
                 or exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
                 or exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
                 or exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
                 or exists (select 1 from public.functions f where f.id = e->>'eoId'))
           ) then a.pool else '{}'::jsonb end
where jsonb_typeof(a.events) = 'array'
  and exists (
    select 1 from jsonb_array_elements(a.events) e
    where coalesce(e->>'state', '') <> 'soft'
      and coalesce(e->>'eoId', '') <> ''
      and not exists (select 1 from public.event_orders eo where eo.id = e->>'eoId')
      and not exists (select 1 from public.client_ledger cl where cl.id = e->>'eoId')
      and not exists (select 1 from public.amend_requests ar where ar.id = e->>'eoId')
      and not exists (select 1 from public.functions f where f.id = e->>'eoId')
  );

-- ── b) Going forward: an AFTER DELETE trigger releases all three tables' entries at once ──
-- One function/trigger covering all three (not three separate ones, and not folded into 057's own
-- release_blocks_for_deleted_event): one event_orders delete releases truss+platform+batta together
-- in the same transaction (a date can never end up released in truss but not batta), the entry shape
-- and rules are identical across the three, and keeping this separate from 057's function means
-- either one can be changed or dropped independently later without touching the other.
create or replace function public.release_structure_allocations_for_deleted_event()
returns trigger
language plpgsql
as $$
begin
  update public.truss_allocations
  set events = coalesce((
        select jsonb_agg(e) from jsonb_array_elements(events) e
        where e->>'eoId' is distinct from old.id
           or coalesce(e->>'state', '') = 'soft'
      ), '[]'::jsonb),
      pool = case when exists (
               select 1 from jsonb_array_elements(events) e
               where coalesce(e->>'state', '') <> 'soft'
                 and e->>'eoId' is distinct from old.id
             ) then pool else '{}'::jsonb end
  where jsonb_typeof(events) = 'array'
    and exists (select 1 from jsonb_array_elements(events) e
                where e->>'eoId' = old.id and coalesce(e->>'state', '') <> 'soft');

  update public.platform_allocations
  set events = coalesce((
        select jsonb_agg(e) from jsonb_array_elements(events) e
        where e->>'eoId' is distinct from old.id
           or coalesce(e->>'state', '') = 'soft'
      ), '[]'::jsonb),
      pool = case when exists (
               select 1 from jsonb_array_elements(events) e
               where coalesce(e->>'state', '') <> 'soft'
                 and e->>'eoId' is distinct from old.id
             ) then pool else '{}'::jsonb end
  where jsonb_typeof(events) = 'array'
    and exists (select 1 from jsonb_array_elements(events) e
                where e->>'eoId' = old.id and coalesce(e->>'state', '') <> 'soft');

  update public.batta_allocations
  set events = coalesce((
        select jsonb_agg(e) from jsonb_array_elements(events) e
        where e->>'eoId' is distinct from old.id
           or coalesce(e->>'state', '') = 'soft'
      ), '[]'::jsonb),
      pool = case when exists (
               select 1 from jsonb_array_elements(events) e
               where coalesce(e->>'state', '') <> 'soft'
                 and e->>'eoId' is distinct from old.id
             ) then pool else '{}'::jsonb end
  where jsonb_typeof(events) = 'array'
    and exists (select 1 from jsonb_array_elements(events) e
                where e->>'eoId' = old.id and coalesce(e->>'state', '') <> 'soft');

  return old;
end;
$$;

drop trigger if exists trg_release_structure_allocs_on_event_order_delete on public.event_orders;
create trigger trg_release_structure_allocs_on_event_order_delete
after delete on public.event_orders
for each row
execute function public.release_structure_allocations_for_deleted_event();

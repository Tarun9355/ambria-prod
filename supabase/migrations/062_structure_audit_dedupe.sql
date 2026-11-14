-- truss_audit / platform_audit / batta_audit: drop the 'promote-soft-to-hard' repeats IMS wrote on
-- every page load (bug fixed in IMS.jsx via lib/ims/allocPromote.js). Keeps every other event
-- (overrides, backfills, ...) and the NEWEST promote row per date — the only one that says anything.
--
-- Done as keep → truncate → re-insert rather than DELETE: a DELETE over 558 MB timed out in the SQL
-- editor and, even when it finishes, leaves the space allocated until a VACUUM FULL. TRUNCATE gives
-- the disk back immediately. Runs once from pg_cron (no HTTP timeout) and unschedules itself.
-- The id sequence is NOT reset, so ids keep increasing and the app's "newest 50" read is unchanged.

create or replace function public.dedupe_structure_audit()
returns void
language plpgsql
as $$
declare
  t text;
begin
  foreach t in array array['truss_audit', 'platform_audit', 'batta_audit'] loop
    execute format($f$
      create temp table _keep on commit drop as
        select * from public.%1$I
         where data ->> 'event' is distinct from 'promote-soft-to-hard'
            or id in (select max(id) from public.%1$I
                       where data ->> 'event' = 'promote-soft-to-hard'
                       group by data ->> 'date');
      truncate public.%1$I;
      insert into public.%1$I select * from _keep;
      drop table _keep;
    $f$, t);
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('dedupe-structure-audit');
exception when others then null;
end $$;
select cron.schedule('dedupe-structure-audit', '* * * * *',
  $$select public.dedupe_structure_audit(); select cron.unschedule('dedupe-structure-audit');$$);

-- Check (after a minute or two):
--   select pg_size_pretty(pg_total_relation_size('public.truss_audit'))    as truss,
--          pg_size_pretty(pg_total_relation_size('public.platform_audit')) as platform,
--          pg_size_pretty(pg_total_relation_size('public.batta_audit'))    as batta;

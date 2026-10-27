-- Venue Labour Config: one row per venue name, consolidating TWO settings keys that were both
-- independently keyed by the same real-world entity — a venue name — into one table (CLAUDE.md
-- rule 1: row-level updates only).
--
-- `venueMinLabour` (a crew-count floor per venue) and `venueDumping` (dumping-point distance ->
-- labour multiplier) are edited on two different admin screens (Venue Min Labour, Venue Dumping)
-- but describe the same venues. venueMinLabour's own per-venue `dumpingLevel` sub-field was already
-- dead — nothing ever read it; every live dumping-level lookup (manpowerCount.js) goes through the
-- separate venueDumping map instead — so this migration drops that redundant copy entirely and
-- makes `dumping_level` the one authoritative column.
--
-- Matched by plain venue NAME (as both settings keys always were), not a foreign key to `venues.id`
-- — admin-typed venue names here have never been guaranteed to match the venues catalogue exactly
-- (the merge list in AdminSettingsTab.jsx already unions venueParents + venueMinLabour +
-- venueDumping keys for this reason), so a strict FK would risk rejecting legitimate rows.
create table if not exists public.venue_labour_config (
  venue_name     text primary key,
  min_labour     integer,
  dumping_level  text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

drop trigger if exists set_timestamp on public.venue_labour_config;
create trigger set_timestamp before update on public.venue_labour_config
  for each row execute function update_timestamp();

do $$
declare rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class
  where relname = 'rate_card' and relnamespace = 'public'::regnamespace;
  if rls_on then
    execute 'alter table public.venue_labour_config enable row level security';
    execute 'drop policy if exists ambria_authenticated_all on public.venue_labour_config';
    execute 'create policy ambria_authenticated_all on public.venue_labour_config for all to authenticated using (true) with check (true)';
  end if;
end $$;

alter table public.venue_labour_config enable row level security;
drop policy if exists ambria_anon_all on public.venue_labour_config;
create policy ambria_anon_all on public.venue_labour_config for all to anon, authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.venue_labour_config;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

drop trigger if exists audit_row_change_trg on public.venue_labour_config;
create trigger audit_row_change_trg after insert or update or delete on public.venue_labour_config
  for each row execute function public.audit_row_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the two settings rows — one-time, idempotent (ON CONFLICT merges whichever aspect
-- that pass provides, same layering approach as 041's labour_types backfill).
-- ═══════════════════════════════════════════════════════════════════════════
with vml_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'venueMinLabour'
)
insert into public.venue_labour_config (venue_name, min_labour)
select
  kv.key,
  case when jsonb_typeof(kv.value) = 'object' then nullif(kv.value->>'min', '')::int
       when jsonb_typeof(kv.value) = 'number' then kv.value::text::int
       else null end
from vml_raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> ''
on conflict (venue_name) do update set min_labour = excluded.min_labour;

with vd_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'venueDumping'
)
insert into public.venue_labour_config (venue_name, dumping_level)
select kv.key, kv.value #>> '{}'
from vd_raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> ''
on conflict (venue_name) do update set dumping_level = excluded.dumping_level;

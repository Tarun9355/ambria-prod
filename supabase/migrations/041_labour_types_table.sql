-- Labour Types: one row per manpower type (Flowerists, Electricians, Labours, …), consolidating
-- THREE settings keys that were all independently keyed by the same real-world entity — a labour
-- type — into one table (CLAUDE.md rule 1: row-level updates only).
--
-- `labourTiers` (tier/minimum/dismantlingPct/subCatBatches), `dihariSchemes` (rate/windows), and
-- `defaultWindowsByPhase` (minusOne/event/dismantle pre-ticks) are edited on two different admin
-- screens (Labour Tiers, Dihari Timings) but describe the SAME ~10 entities — and the three keys
-- don't even share an identical set of type names (dihariSchemes/defaultWindowsByPhase also have
-- "Helpers"/"Drivers", which labourTiers doesn't). One row per type, nullable per column, is a
-- cleaner model than three separately-shaped blobs that have to be cross-referenced by name anyway.
--
-- Lower contention than venues/fixedVenues/mandi_flowers/flower_patterns (one admin, ~10 entries,
-- infrequent edits) but the same shape of risk: two admins editing two different labour types in
-- two open tabs could still silently drop one edit the moment both whole-object saves land.
--
-- `tier` stays TEXT (not numeric) — it's polymorphic in the app: 1/2/3, or "fixed"/"pillar-range"/
-- "sqft-range". `sub_cat_batches`/`dihari_windows`/`default_windows` stay JSONB — nested data
-- scoped to that one type, not flat fields shared across rows.
create table if not exists public.labour_types (
  type_name        text primary key,
  tier             text,
  minimum          integer,
  dismantling_pct  integer,
  sub_cat_batches  jsonb,
  dihari_rate      numeric,
  dihari_windows   jsonb,
  default_windows  jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

drop trigger if exists set_timestamp on public.labour_types;
create trigger set_timestamp before update on public.labour_types
  for each row execute function update_timestamp();

do $$
declare rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class
  where relname = 'rate_card' and relnamespace = 'public'::regnamespace;
  if rls_on then
    execute 'alter table public.labour_types enable row level security';
    execute 'drop policy if exists ambria_authenticated_all on public.labour_types';
    execute 'create policy ambria_authenticated_all on public.labour_types for all to authenticated using (true) with check (true)';
  end if;
end $$;

alter table public.labour_types enable row level security;
drop policy if exists ambria_anon_all on public.labour_types;
create policy ambria_anon_all on public.labour_types for all to anon, authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.labour_types;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Wire up the same generic audit trigger every other table got in 037, so edits to labour config
-- get the same before/new row trail as everything else. Also closes a gap: fixed_venues (038) was
-- created AFTER 037's one-time table list ran, so it never got this trigger either — caught here
-- since this migration already needs the same wiring for its own new table.
drop trigger if exists audit_row_change_trg on public.labour_types;
create trigger audit_row_change_trg after insert or update or delete on public.labour_types
  for each row execute function public.audit_row_change();

drop trigger if exists audit_row_change_trg on public.fixed_venues;
create trigger audit_row_change_trg after insert or update or delete on public.fixed_venues
  for each row execute function public.audit_row_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the three settings rows — one-time, idempotent (ON CONFLICT merges whichever
-- aspect that pass provides, so running all three inserts safely layers tier config, dihari
-- config, and default-window config onto the same row regardless of insert order).
-- ═══════════════════════════════════════════════════════════════════════════
with lt_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'labourTiers'
)
insert into public.labour_types (type_name, tier, minimum, dismantling_pct, sub_cat_batches)
select
  kv.key, kv.value->>'tier', nullif(kv.value->>'minimum', '')::int,
  nullif(kv.value->>'dismantlingPct', '')::int, kv.value->'subCatBatches'
from lt_raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> ''
on conflict (type_name) do update set
  tier = excluded.tier, minimum = excluded.minimum,
  dismantling_pct = excluded.dismantling_pct, sub_cat_batches = excluded.sub_cat_batches;

with ds_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'dihariSchemes'
)
insert into public.labour_types (type_name, dihari_rate, dihari_windows)
select kv.key, nullif(kv.value->>'rate', '')::numeric, coalesce(kv.value->'windows', '[]'::jsonb)
from ds_raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> ''
on conflict (type_name) do update set
  dihari_rate = excluded.dihari_rate, dihari_windows = excluded.dihari_windows;

with dw_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'defaultWindowsByPhase'
)
insert into public.labour_types (type_name, default_windows)
select kv.key, kv.value
from dw_raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> ''
on conflict (type_name) do update set default_windows = excluded.default_windows;

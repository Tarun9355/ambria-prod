-- Manpower Range Ladders: heavyElementRanges (keyed by sub-category), trussLabourRanges and
-- fabricBangaliRanges (ordered pillar/sqft threshold bands) — three settings keys replaced with
-- three small tables (CLAUDE.md rule 1: row-level updates only). Done for completeness ("zero
-- blobs") rather than risk reduction — one admin, 3-6 rows each, infrequent edits.
--
-- heavyElementRanges is genuinely keyed by a real entity (a sub-category name) — `heavy_element_ranges`
-- uses sub_cat as its primary key. `legacy_ranges` preserves the OLD {ranges:[{upTo,extra}]} shape
-- heavyExtraLabour() (lib/ims/constants.js) still supports reading, for any row that predates the
-- {freeUpTo,perCount} model and was never re-saved since (the admin UI only ever writes the new
-- shape now, stripping the old one the moment a row is touched — see AdminSettingsTab.jsx's own
-- `delete cur.ranges` cleanup — so this column exists purely for backfill fidelity, not for new
-- writes to ever use).
--
-- trussLabourRanges/fabricBangaliRanges are ordered threshold ladders, not independent entities —
-- but each band's own `upTo` value is already a stable, naturally-unique identity (bands are always
-- read back sorted by up_to ascending to reconstruct the array), so one row per band still works
-- cleanly as a primary key.
create table if not exists public.heavy_element_ranges (
  sub_cat        text primary key,
  free_up_to     integer,
  per_count      integer,
  legacy_ranges  jsonb,
  updated_at     timestamptz default now()
);
create table if not exists public.truss_labour_ranges (
  up_to       integer primary key,
  labour      integer,
  label       text,
  updated_at  timestamptz default now()
);
create table if not exists public.fabric_bangali_ranges (
  up_to       integer primary key,
  labour      integer,
  label       text,
  updated_at  timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['heavy_element_ranges', 'truss_labour_ranges', 'fabric_bangali_ranges'] loop
    execute format('drop trigger if exists set_timestamp on public.%I', t);
    execute format('create trigger set_timestamp before update on public.%I for each row execute function update_timestamp()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists ambria_anon_all on public.%I', t);
    execute format('create policy ambria_anon_all on public.%I for all to anon, authenticated using (true) with check (true)', t);

    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;

    execute format('drop trigger if exists audit_row_change_trg on public.%I', t);
    execute format('create trigger audit_row_change_trg after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the three settings rows — one-time, idempotent (ON CONFLICT DO NOTHING).
-- ═══════════════════════════════════════════════════════════════════════════
with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'heavyElementRanges')
insert into public.heavy_element_ranges (sub_cat, free_up_to, per_count, legacy_ranges)
select p->>'subCat', nullif(p->>'freeUpTo', '')::int, nullif(p->>'perCount', '')::int, p->'ranges'
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'subCat', '') <> '' on conflict (sub_cat) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'trussLabourRanges')
insert into public.truss_labour_ranges (up_to, labour, label)
select nullif(p->>'upTo', '')::int, nullif(p->>'labour', '')::int, p->>'label'
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'upTo', '') <> '' on conflict (up_to) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'fabricBangaliRanges')
insert into public.fabric_bangali_ranges (up_to, labour, label)
select nullif(p->>'upTo', '')::int, nullif(p->>'labour', '')::int, p->>'label'
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'upTo', '') <> '' on conflict (up_to) do nothing;

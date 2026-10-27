-- Rate Lists: print materials, carpet materials, platform heights, masking types, and truss
-- shape/material/density rates — five settings keys, each a genuinely distinct list an admin
-- manages (different departments own print vs carpet vs platform vs masking), replaced with five
-- small tables (CLAUDE.md rule 1: row-level updates only).
--
-- Lower contention than venues/fixedVenues/mandi_flowers/flower_patterns (one admin, 2-20 rows
-- each, infrequent edits), done here for completeness ("zero blobs" rather than risk reduction).
--
-- print_materials / carpet_materials / platform_rates / masking_rates are free-form lists, keyed by
-- a stable id/key the admin's own rows generate — items can be added and removed.
--
-- truss_rates is structurally different: a FIXED 18-row grid (2 shapes x 3 materials x 3 drape
-- densities), seeded by code (taxonomy.js's TRUSS_SHAPES/TRUSS_MATERIALS/DRAPE_DENSITIES) and never
-- added to or removed from — only a cell's own rate is ever edited. Its primary key is the
-- (shape, material, density) composite itself, not a generated id.
create table if not exists public.print_materials (
  id             text primary key,
  name           text not null,
  rate_per_sqft  numeric not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create table if not exists public.carpet_materials (
  id             text primary key,
  name           text not null,
  rate_per_sqft  numeric not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create table if not exists public.platform_rates (
  key            text primary key,
  name           text not null,
  rate_per_sqft  numeric not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create table if not exists public.masking_rates (
  key            text primary key,
  name           text not null,
  rate_per_sqft  numeric not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create table if not exists public.truss_rates (
  shape                    text not null,
  material                 text not null,
  density                  text not null,
  rate_per_sqft            numeric not null default 0,
  ceiling_rate_per_sqft    numeric not null default 0,
  oversize_threshold_sqft  integer,
  oversize_rate_per_sqft   numeric,
  updated_at               timestamptz default now(),
  primary key (shape, material, density)
);

do $$
declare t text;
begin
  foreach t in array array['print_materials', 'carpet_materials', 'platform_rates', 'masking_rates', 'truss_rates'] loop
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
-- BACKFILL from the five settings rows — one-time, idempotent (ON CONFLICT DO NOTHING).
-- ═══════════════════════════════════════════════════════════════════════════
with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'printMaterials')
insert into public.print_materials (id, name, rate_per_sqft)
select p->>'id', p->>'name', coalesce(nullif(p->>'ratePerSqft', '')::numeric, 0)
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'id', '') <> '' on conflict (id) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'carpetMaterials')
insert into public.carpet_materials (id, name, rate_per_sqft)
select p->>'id', p->>'name', coalesce(nullif(p->>'ratePerSqft', '')::numeric, 0)
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'id', '') <> '' on conflict (id) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'platformRates')
insert into public.platform_rates (key, name, rate_per_sqft)
select p->>'key', p->>'name', coalesce(nullif(p->>'ratePerSqft', '')::numeric, 0)
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'key', '') <> '' on conflict (key) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'maskingRates')
insert into public.masking_rates (key, name, rate_per_sqft)
select p->>'key', p->>'name', coalesce(nullif(p->>'ratePerSqft', '')::numeric, 0)
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'key', '') <> '' on conflict (key) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'trussRates')
insert into public.truss_rates (shape, material, density, rate_per_sqft, ceiling_rate_per_sqft, oversize_threshold_sqft, oversize_rate_per_sqft)
select p->>'shape', p->>'material', p->>'density',
  coalesce(nullif(p->>'ratePerSqft', '')::numeric, 0), coalesce(nullif(p->>'ceilingRatePerSqft', '')::numeric, 0),
  nullif(p->>'oversizeThresholdSqft', '')::int, nullif(p->>'oversizeRatePerSqft', '')::numeric
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'shape', '') <> '' on conflict (shape, material, density) do nothing;

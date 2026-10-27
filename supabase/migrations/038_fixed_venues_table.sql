-- Fixed Venues (standing inventory per in-house property): one row per fixed venue, replacing the
-- single `fixedVenues` row in the key-value `settings` table (CLAUDE.md rule 1: row-level updates
-- only, no fetch-whole-blob-modify-save-whole).
--
-- WHY: unlike most `settings` rows (one independent field each, already safe — see
-- lib/ims/settingsWriter.js), `fixedVenues` held EVERY fixed venue's ENTIRE standing-inventory
-- config as one JSON array under that single key. Two admins editing two DIFFERENT fixed venues in
-- two open tabs at the same time could each compute their own next array from their own locally-held
-- copy and overwrite the other's edit the moment both saves landed — the same failure shape that hit
-- the venues catalogue (036), just narrower in scope (only this one key, not every settings field).
-- One row per fixed venue closes it completely: two admins editing different venues now touch
-- different rows, and even the same venue's edits become real per-row UPDATEs instead of a
-- read-the-whole-array-modify-save-the-whole-array round trip.
--
-- `items` (standing inventory list), `fixed_crew` (per-labour-type counts), and `truss` (pillars/
-- beams qty) stay JSONB on the row — each is nested data scoped entirely to its OWN venue, not flat
-- fields shared across rows, so this isn't the blob pattern rule 1 warns about (same reasoning
-- truss_inventory's own `data` column already uses).
create table if not exists public.fixed_venues (
  id          text primary key,
  name        text not null,
  property_id text references public.venues(id) on delete set null,
  min_labour  integer,
  fixed_crew  jsonb not null default '{}'::jsonb,
  truss       jsonb not null default '{}'::jsonb,
  items       jsonb not null default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists fixed_venues_property_id_idx on public.fixed_venues (property_id);

drop trigger if exists set_timestamp on public.fixed_venues;
create trigger set_timestamp before update on public.fixed_venues
  for each row execute function update_timestamp();

-- Mirror rate_card's RLS posture exactly — introspect and match rather than guessing, same pattern
-- every prior table migration in this repo uses.
do $$
declare rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class
  where relname = 'rate_card' and relnamespace = 'public'::regnamespace;
  if rls_on then
    execute 'alter table public.fixed_venues enable row level security';
    execute 'drop policy if exists ambria_authenticated_all on public.fixed_venues';
    execute 'create policy ambria_authenticated_all on public.fixed_venues for all to authenticated using (true) with check (true)';
  end if;
end $$;

-- The app has no forced Supabase Auth login (see 019) — same anon policy every other table here uses.
alter table public.fixed_venues enable row level security;
drop policy if exists ambria_anon_all on public.fixed_venues;
create policy ambria_anon_all on public.fixed_venues for all to anon, authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.fixed_venues;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the `fixedVenues` settings row — one-time, idempotent (ON CONFLICT DO NOTHING, safe
-- to re-run). Same JSONB-string unwrap migration 036 needed: `value` holds a JSON-encoded STRING,
-- not a native JSONB array (the app always JSON.stringify()s before upserting a settings row).
-- ═══════════════════════════════════════════════════════════════════════════
with fv_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'fixedVenues'
)
insert into public.fixed_venues (id, name, property_id, min_labour, fixed_crew, truss, items)
select
  coalesce(nullif(fv->>'id', ''), 'fv_' || md5(coalesce(fv->>'name', '') || fv::text)),
  fv->>'name',
  nullif(fv->>'propertyId', ''),
  nullif(fv->>'minLabour', '')::int,
  coalesce(fv->'fixedCrew', '{}'::jsonb),
  coalesce(fv->'truss', '{}'::jsonb),
  coalesce(fv->'items', '[]'::jsonb)
from fv_raw
cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as fv
where coalesce(fv->>'name', '') <> ''
on conflict (id) do nothing;

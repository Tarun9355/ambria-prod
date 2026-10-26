-- Venues: one row per venue (in-house property, in-house sub-venue, or outdoor venue), replacing
-- the single `ambria-v13-venues` settings blob (CLAUDE.md rule 1: row-level updates only, no
-- fetch-whole-blob-modify-save-whole).
--
-- WHY: two independent editors (VenuesEditor.jsx, FixedVenuesEditor.jsx) each fetched that one
-- JSONB row into local state and saved the WHOLE thing back on any edit. A stale tab's own copy —
-- captured before a newer field existed, or before another tab's edit landed — silently overwrote
-- that newer data the next time it saved anything at all, even something unrelated. Confirmed live
-- twice: a property ("Restro") vanished from the list entirely once, and property-level
-- commission % + outdoor venue type/commission were lost a second time (2026-10-26). A
-- server-side merge RPC (see 035) patches ONE key at a time but can't fix this — the two editors
-- still each hold a whole-array copy that can go stale relative to the other. Only real row-level
-- storage closes the bug class.
--
-- `kind` discriminates the three venue roles the old blob kept in separate arrays:
--   'property' — an in-house property (Pushpanjali, Exotica, Manaktala...). Old blob id: "prop_...".
--   'subvenue' — a room/hall inside a property (Aura, Poolside...). Old blob id: "iv_...".
--               property_id points at its parent property's row.
--   'outdoor'  — an outside venue Ambria has worked at or is empanelled with. No property_id.
--
-- `id` is kept IDENTICAL to the old blob's own id strings for properties and sub-venues, so every
-- existing reference by id (settings.fixedVenues[].propertyId, in particular) keeps resolving
-- without its own migration. Outdoor venues never had an id in the blob (matched by name instead);
-- backfilled here as a stable hash of the name.
create table if not exists public.venues (
  id              text primary key,
  kind            text not null check (kind in ('property','subvenue','outdoor')),
  name            text not null,
  property_id     text references public.venues(id) on delete set null,
  manager         text,
  icon            text,
  label           text,
  description     text,
  venue_type      text,      -- Indoor / Outdoor / Semi-Outdoor / Both — subvenue + outdoor
  base_price      numeric,   -- subvenue only
  empanelled      boolean,   -- outdoor only
  commission_pct  numeric,   -- property + outdoor — % of the deal amount Deal Check sets aside
  sort_order      integer not null default 0,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists venues_kind_idx on public.venues (kind);
create index if not exists venues_property_id_idx on public.venues (property_id);

drop trigger if exists set_timestamp on public.venues;
create trigger set_timestamp before update on public.venues
  for each row execute function update_timestamp();

-- Mirror rate_card's RLS posture exactly — introspect and match rather than guessing, same pattern
-- every prior table migration in this repo uses.
do $$
declare rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class
  where relname = 'rate_card' and relnamespace = 'public'::regnamespace;
  if rls_on then
    execute 'alter table public.venues enable row level security';
    execute 'drop policy if exists ambria_authenticated_all on public.venues';
    execute 'create policy ambria_authenticated_all on public.venues for all to authenticated using (true) with check (true)';
  end if;
end $$;

-- The app has no forced Supabase Auth login (see 019) — same anon policy every other table here uses.
alter table public.venues enable row level security;
drop policy if exists ambria_anon_all on public.venues;
create policy ambria_anon_all on public.venues for all to anon, authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.venues;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the ambria-v13-venues settings row — one-time, idempotent (ON CONFLICT DO NOTHING
-- throughout, so this is safe to re-run and can never overwrite a row the app has since written).
--
-- `value` is stored as a JSON-encoded STRING inside the jsonb column (the app always writes
-- JSON.stringify(...) into it, never a native object) — confirmed live: jsonb_typeof(value) =
-- 'string'. `value -> 'properties'` on a jsonb STRING returns null (-> only descends into an
-- object/array), which is why a first run of this backfill inserted zero rows. `#>> '{}'` unwraps
-- the string's actual text content, which is itself valid JSON, so casting that back to ::jsonb
-- gives the real object this file's -> lookups need.
-- ═══════════════════════════════════════════════════════════════════════════

with venues_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'ambria-v13-venues'
)
insert into public.venues (id, kind, name, manager, icon, commission_pct)
select
  p->>'id', 'property', p->>'name', p->>'manager', p->>'icon',
  nullif(p->>'commissionPct', '')::numeric
from venues_raw
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v->'properties') = 'array' then v->'properties' else '[]'::jsonb end
) as p
where p->>'id' is not null
on conflict (id) do nothing;

with venues_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'ambria-v13-venues'
)
insert into public.venues (id, kind, name, property_id, manager, icon, label, description, venue_type, base_price)
select
  sv->>'id', 'subvenue', sv->>'name', sv->>'propertyId', sv->>'manager', sv->>'icon',
  sv->>'label', sv->>'desc', sv->>'type', nullif(sv->>'base', '')::numeric
from venues_raw
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v->'inhouse') = 'array' then v->'inhouse' else '[]'::jsonb end
) as sv
where sv->>'id' is not null
on conflict (id) do nothing;

with venues_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'ambria-v13-venues'
)
insert into public.venues (id, kind, name, venue_type, empanelled, commission_pct)
select
  'od_' || md5(coalesce(o->>'name', '')), 'outdoor', o->>'name', o->>'type',
  coalesce((o->>'empanelled')::boolean, false), nullif(o->>'commissionPct', '')::numeric
from venues_raw
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v->'outdoor') = 'array' then v->'outdoor' else '[]'::jsonb end
) as o
where coalesce(o->>'name', '') <> ''
on conflict (id) do nothing;

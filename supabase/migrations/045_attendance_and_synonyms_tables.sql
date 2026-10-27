-- Attendance Locations, Attendance Quiz Training (by department), and the AI Synonym Dictionary —
-- three settings keys replaced with three small tables (CLAUDE.md rule 1: row-level updates only).
-- Each is genuinely keyed by a real entity (a punch-in location, a department, a synonym group) an
-- admin manages independently — done for completeness ("zero blobs") rather than risk reduction
-- (one admin, a handful of rows each, infrequent edits).
--
-- `questions`/`words` stay JSONB — a department's quiz question list / a synonym group's word list
-- is nested data scoped entirely to that one row, not flat fields shared across rows.
create table if not exists public.attendance_locations (
  id          text primary key,
  name        text not null,
  lat         numeric,
  lng         numeric,
  updated_at  timestamptz default now()
);
create table if not exists public.attendance_training (
  dept        text primary key,
  video_url   text,
  questions   jsonb not null default '[]'::jsonb,
  updated_at  timestamptz default now()
);
create table if not exists public.synonym_groups (
  id          text primary key,
  words       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['attendance_locations', 'attendance_training', 'synonym_groups'] loop
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
with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'attendanceLocations')
insert into public.attendance_locations (id, name, lat, lng)
select p->>'id', p->>'name', nullif(p->>'lat', '')::numeric, nullif(p->>'lng', '')::numeric
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'id', '') <> '' on conflict (id) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'attendanceTrainingByDept')
insert into public.attendance_training (dept, video_url, questions)
select kv.key, kv.value->>'videoUrl', coalesce(kv.value->'questions', '[]'::jsonb)
from raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> '' on conflict (dept) do nothing;

with raw as (select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'synonymDictionary')
insert into public.synonym_groups (id, words)
select p->>'id', coalesce(p->'words', '[]'::jsonb)
from raw cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'id', '') <> '' on conflict (id) do nothing;

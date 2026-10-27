-- Flower Recipe Patterns: one row per recipe (flowerPatterns), replacing the single
-- `flowerPatterns` row in the key-value `settings` table (CLAUDE.md rule 1: row-level updates
-- only). `flower_patterns` (migration 001) already exists for exactly this purpose — it was just
-- never wired up; the app used the settings blob instead, so this table sat empty from day one.
-- This migration brings its schema up to the blob's actual current shape and backfills it.
--
-- WHY migrate this one: same risk shape as venues/fixedVenues/mandi_flowers (036/038/039) — many
-- independent recipes under ONE settings key, each tied to its own rate-card item/sub-category and
-- editable by whichever department head manages that item. Two edits to two different recipes in
-- two open tabs at the same time could silently drop one the moment both saves land.
--
-- `sizes` stays JSONB (small/medium/big -> {flowers, totalPieces, img}) — nested data scoped
-- entirely to that one recipe, not flat fields shared across rows. `dihari`/`visual_count` (001)
-- were never populated by any shipped feature — dropped. The JS field is called `mode`, not
-- `flat_or_smb`, and `studioMarkup`, not `markup` — translated at the app layer (lib/ims/
-- flowerHelpers.js), the column names stay as 001 defined them. `unitBasis` is written by the app
-- but always the same hardcoded "per piece" and never read back anywhere — not persisted here.
--
-- RLS, the realtime publication, the updated_at trigger, and the audit_log trigger (037) were all
-- already set up for this table back in 001/037 — nothing to add here.
alter table public.flower_patterns drop column if exists dihari;
alter table public.flower_patterns drop column if exists visual_count;
alter table public.flower_patterns
  add column if not exists sub text,
  add column if not exists unit text,
  add column if not exists artificial_included boolean default false;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the `flowerPatterns` settings row — one-time, idempotent (ON CONFLICT DO NOTHING,
-- safe to re-run). Same JSONB-string unwrap every prior blob migration needed: `value` holds a
-- JSON-encoded STRING, not a native JSONB array (the app always JSON.stringify()s before upserting).
-- ═══════════════════════════════════════════════════════════════════════════
with fp_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'flowerPatterns'
)
insert into public.flower_patterns (id, name, flat_or_smb, sub, unit, artificial_included, markup, sizes)
select
  p->>'id', p->>'name', coalesce(p->>'mode', 'flat'), p->>'sub', p->>'unit',
  coalesce((p->>'artificialIncluded')::boolean, false),
  nullif(p->>'studioMarkup', '')::numeric,
  coalesce(p->'sizes', '{}'::jsonb)
from fp_raw
cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as p
where coalesce(p->>'id', '') <> '' and coalesce(p->>'name', '') <> ''
on conflict (id) do nothing;

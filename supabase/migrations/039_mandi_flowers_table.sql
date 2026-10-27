-- Mandi Flower Catalogue: one row per real flower, replacing the single `mandiCatalogue` row in the
-- key-value `settings` table (CLAUDE.md rule 1: row-level updates only, no fetch-whole-blob-modify-
-- save-whole). `mandi_flowers` (migration 001) already exists for exactly this purpose — it was
-- just never wired up; the app used the settings blob instead, so this table sat empty from day
-- one. This migration brings its schema up to the blob's actual current shape and backfills it.
--
-- WHY migrate this one: same risk shape as venues/fixedVenues (036/038) — ~140 independent flowers
-- under ONE settings key, each with its own price + colour variants, edited routinely (price
-- updates are a day-to-day task, not an occasional admin tweak) by more than one person (Floral
-- Head / Purchase Manager both touch pricing). Two people updating two different flowers' prices in
-- two open tabs at the same time could silently drop one edit the moment both saves land.
--
-- `pcs_per_unit` is exactly the field the app calls `gattharSize` ("how many pieces per unit"),
-- renamed to match. `preferences` was never used by any shipped feature — dropped. `color_variants`
-- stays JSONB — each flower's own list of colour variants (name/photo/price/price history/palette
-- tags) is nested data scoped entirely to that one flower, not flat fields shared across rows, same
-- reasoning truss_inventory's own `data` column already uses.
--
-- RLS, the realtime publication, the updated_at trigger, and the audit_log trigger (037) were all
-- already set up for this table back in 001/037 — nothing to add here.
alter table public.mandi_flowers rename column pcs_per_unit to gatthar_size;
alter table public.mandi_flowers drop column if exists preferences;
alter table public.mandi_flowers
  add column if not exists flower_type text,
  add column if not exists is_green boolean default false,
  add column if not exists artificial_bunches_per_unit numeric,
  add column if not exists artificial_map_item_id text,
  add column if not exists artificial_map_name text,
  add column if not exists artificial_map_price numeric,
  add column if not exists artificial_map_cost numeric,
  add column if not exists markup numeric;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from the `mandiCatalogue` settings row — one-time, idempotent (ON CONFLICT DO NOTHING,
-- safe to re-run). Same JSONB-string unwrap every prior blob migration needed: `value` holds a
-- JSON-encoded STRING, not a native JSONB array (the app always JSON.stringify()s before upserting).
-- ═══════════════════════════════════════════════════════════════════════════
with mc_raw as (
  select (s.value #>> '{}')::jsonb as v from public.settings s where s.key = 'mandiCatalogue'
)
insert into public.mandi_flowers (
  id, name, flower_cat, unit, gatthar_size, flower_type, is_green, artificial_bunches_per_unit,
  artificial_map_item_id, artificial_map_name, artificial_map_price, artificial_map_cost, markup,
  current_price, price_history, photo_url, color_variants
)
select
  f->>'id', f->>'name', f->>'flowerCat', coalesce(f->>'unit', 'bundle'),
  nullif(f->>'gattharSize', '')::int,
  f->>'flowerType',
  coalesce((f->>'isGreen')::boolean, false),
  nullif(f->>'artificialBunchesPerUnit', '')::numeric,
  nullif(f->>'artificialMapItemId', ''),
  nullif(f->>'artificialMapName', ''),
  nullif(f->>'artificialMapPrice', '')::numeric,
  nullif(f->>'artificialMapCost', '')::numeric,
  nullif(f->>'markup', '')::numeric,
  coalesce(nullif(f->>'currentPrice', '')::numeric, 0),
  coalesce(f->'priceHistory', '[]'::jsonb),
  nullif(f->>'photoUrl', ''),
  coalesce(f->'colorVariants', '[]'::jsonb)
from mc_raw
cross join lateral jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) as f
where coalesce(f->>'id', '') <> '' and coalesce(f->>'name', '') <> ''
on conflict (id) do nothing;

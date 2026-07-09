-- ─── Rate Card → IMS migration, Phase 1: per-sub-category scaling factor ──────────────────────
-- `rate_card_categories` was created in 001 as one-row-per-TOP-LEVEL-CATEGORY (id/label/icon/
-- sort_order/subs-as-JSONB-array) but has 0 rows and 0 code references — confirmed dead via a
-- live audit query before this migration was written. The scaling-factor requirement is one
-- factor per SUB-category (103 of them), not per top-level category (11), so this redefines the
-- table as one row per sub-category instead of altering it in place. Safe because it's empty and
-- unused; CLAUDE.md's "no JSON blobs for flat data, row-level updates only" rule is exactly why
-- this isn't done as a JSONB array-of-objects on the old shape.
--
-- `id` is the lowercased/trimmed sub-category label — this MUST match the join key Studio/IMS
-- already use for sub-category matching (`itemImsSubcat()` in src/lib/ims/helpers.js, and
-- `filterImsBySubcategory` in StudioApp.jsx both compare `String(x).toLowerCase().trim()`).
-- Seeded from a live-data audit: 74 sub-categories that exist in `inventory.sub_cat` today, plus
-- 29 rate-card-only sub-categories with no physical inventory row (labour/commercial/size-variant
-- items — Printing, Flower Pattern recipes, Carpet, Coffee Table Floral size variants, etc.).
--
-- Known data-hygiene notes for whoever sets factors (not fixed here — flagged for manual review):
--   • 3 items (Scrolls, BOLSTER, ROUND TABLE OVERLAYS) sit under an orphan category id
--     ("cat_uzqdy") in `rate_card` — a pre-existing data issue, unrelated to this migration.
--   • Near-duplicate naming across rate-card vs. inventory that looks like the same real-world
--     category under different names — NOT auto-merged, review before setting factors:
--       "Glass Panel 2D" (rate-card-only)  vs.  "3D Glass Panel" (inventory)
--       "3D candle Walls" (rate-card-only) vs.  "Candle walls" / "Candle Walls 2D" (inventory)
--       "Takhat" (rate-card-only)          vs.  "Table Takhat" (inventory)

-- Data hygiene: the Phase 0 audit found `rate_card.sub` values with leading/trailing whitespace
-- (e.g. "Tenting Accessories ") that don't match the clean `inventory.sub_cat` string, causing
-- Deal Check matching (and, going forward, this migration's scaling-factor join) to silently miss
-- a real match. Fix at the source rather than working around it downstream.
UPDATE rate_card SET sub = trim(sub) WHERE sub IS NOT NULL AND sub <> trim(sub);

DROP TABLE IF EXISTS rate_card_categories;

CREATE TABLE rate_card_categories (
  id TEXT PRIMARY KEY,              -- lower(trim(label)) — the exact sub-category join key
  label TEXT NOT NULL,              -- display label, original casing
  scaling_factor NUMERIC NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'inventory',   -- 'inventory' | 'rate_card_only' (data provenance, informational)
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Mirror rate_card's current RLS posture exactly (don't assume 005_auth_rls.sql has run in this
-- environment — introspect and match rather than guessing, so this table is never more or less
-- locked down than its closest analog).
DO $$
DECLARE rls_on boolean;
BEGIN
  SELECT relrowsecurity INTO rls_on FROM pg_class
  WHERE relname = 'rate_card' AND relnamespace = 'public'::regnamespace;
  IF rls_on THEN
    EXECUTE 'ALTER TABLE public.rate_card_categories ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS ambria_authenticated_all ON public.rate_card_categories';
    EXECUTE 'CREATE POLICY ambria_authenticated_all ON public.rate_card_categories FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE rate_card_categories;

-- ── Seed: 74 sub-categories from live `inventory.sub_cat` ──
INSERT INTO rate_card_categories (id, label, scaling_factor, source, sort_order) VALUES
  (lower(trim('3D Glass Panel')), '3D Glass Panel', 1.0, 'inventory', 0),
  (lower(trim('Arch')), 'Arch', 1.0, 'inventory', 0),
  (lower(trim('Artificial Flower')), 'Artificial Flower', 1.0, 'inventory', 0),
  (lower(trim('Banjara Floral Accessory')), 'Banjara Floral Accessory', 1.0, 'inventory', 0),
  (lower(trim('BAR')), 'BAR', 1.0, 'inventory', 0),
  (lower(trim('bar chairs')), 'bar chairs', 1.0, 'inventory', 0),
  (lower(trim('Birthday Arch')), 'Birthday Arch', 1.0, 'inventory', 0),
  (lower(trim('Blue Pottery')), 'Blue Pottery', 1.0, 'inventory', 0),
  (lower(trim('Booster Cover')), 'Booster Cover', 1.0, 'inventory', 0),
  (lower(trim('Bow Tie')), 'Bow Tie', 1.0, 'inventory', 0),
  (lower(trim('BTR')), 'BTR', 1.0, 'inventory', 0),
  (lower(trim('Candle Stick + Stand')), 'Candle Stick + Stand', 1.0, 'inventory', 0),
  (lower(trim('Candle walls')), 'Candle walls', 1.0, 'inventory', 0),
  (lower(trim('Candle Walls 2D')), 'Candle Walls 2D', 1.0, 'inventory', 0),
  (lower(trim('Chair')), 'Chair', 1.0, 'inventory', 0),
  (lower(trim('Chandelier')), 'Chandelier', 1.0, 'inventory', 0),
  (lower(trim('Cocktail Table')), 'Cocktail Table', 1.0, 'inventory', 0),
  (lower(trim('Coffee Table')), 'Coffee Table', 1.0, 'inventory', 0),
  (lower(trim('Console Table')), 'Console Table', 1.0, 'inventory', 0),
  (lower(trim('couple couch')), 'couple couch', 1.0, 'inventory', 0),
  (lower(trim('Cushion')), 'Cushion', 1.0, 'inventory', 0),
  (lower(trim('Electrical Accessories')), 'Electrical Accessories', 1.0, 'inventory', 0),
  (lower(trim('Fairy Lights')), 'Fairy Lights', 1.0, 'inventory', 0),
  (lower(trim('Flood Light')), 'Flood Light', 1.0, 'inventory', 0),
  (lower(trim('Flower Pot Large')), 'Flower Pot Large', 1.0, 'inventory', 0),
  (lower(trim('Flower Pot Medium')), 'Flower Pot Medium', 1.0, 'inventory', 0),
  (lower(trim('Flower Pot Small')), 'Flower Pot Small', 1.0, 'inventory', 0),
  (lower(trim('Food Canopy')), 'Food Canopy', 1.0, 'inventory', 0),
  (lower(trim('Gate')), 'Gate', 1.0, 'inventory', 0),
  (lower(trim('Glass Floral Accessory')), 'Glass Floral Accessory', 1.0, 'inventory', 0),
  (lower(trim('Hanging Lights')), 'Hanging Lights', 1.0, 'inventory', 0),
  (lower(trim('Hanging Pattern')), 'Hanging Pattern', 1.0, 'inventory', 0),
  (lower(trim('Installations')), 'Installations', 1.0, 'inventory', 0),
  (lower(trim('Iron Arches')), 'Iron Arches', 1.0, 'inventory', 0),
  (lower(trim('Lamps')), 'Lamps', 1.0, 'inventory', 0),
  (lower(trim('LED Light')), 'LED Light', 1.0, 'inventory', 0),
  (lower(trim('Mannequin')), 'Mannequin', 1.0, 'inventory', 0),
  (lower(trim('MDF Jaali 2D')), 'MDF Jaali 2D', 1.0, 'inventory', 0),
  (lower(trim('MDF jaali 3D')), 'MDF jaali 3D', 1.0, 'inventory', 0),
  (lower(trim('Mehandi Prop & Accessories')), 'Mehandi Prop & Accessories', 1.0, 'inventory', 0),
  (lower(trim('Metal Accessory')), 'Metal Accessory', 1.0, 'inventory', 0),
  (lower(trim('Neon light')), 'Neon light', 1.0, 'inventory', 0),
  (lower(trim('Pedestals')), 'Pedestals', 1.0, 'inventory', 0),
  (lower(trim('Piller')), 'Piller', 1.0, 'inventory', 0),
  (lower(trim('Pipe Length lights')), 'Pipe Length lights', 1.0, 'inventory', 0),
  (lower(trim('Platform')), 'Platform', 1.0, 'inventory', 0),
  (lower(trim('Props Glass')), 'Props Glass', 1.0, 'inventory', 0),
  (lower(trim('Props Iron')), 'Props Iron', 1.0, 'inventory', 0),
  (lower(trim('Props Plastic')), 'Props Plastic', 1.0, 'inventory', 0),
  (lower(trim('Props Wooden')), 'Props Wooden', 1.0, 'inventory', 0),
  (lower(trim('Round Table')), 'Round Table', 1.0, 'inventory', 0),
  (lower(trim('Runner')), 'Runner', 1.0, 'inventory', 0),
  (lower(trim('Self Standing Big Pot')), 'Self Standing Big Pot', 1.0, 'inventory', 0),
  (lower(trim('Sethi')), 'Sethi', 1.0, 'inventory', 0),
  (lower(trim('Sofa')), 'Sofa', 1.0, 'inventory', 0),
  (lower(trim('Spot light')), 'Spot light', 1.0, 'inventory', 0),
  (lower(trim('Stage')), 'Stage', 1.0, 'inventory', 0),
  (lower(trim('Table Takhat')), 'Table Takhat', 1.0, 'inventory', 0),
  (lower(trim('Table Top')), 'Table Top', 1.0, 'inventory', 0),
  (lower(trim('Tenting Accessories')), 'Tenting Accessories', 1.0, 'inventory', 0),
  (lower(trim('Tools')), 'Tools', 1.0, 'inventory', 0),
  (lower(trim('Tree')), 'Tree', 1.0, 'inventory', 0),
  (lower(trim('Truss')), 'Truss', 1.0, 'inventory', 0),
  (lower(trim('Urli')), 'Urli', 1.0, 'inventory', 0),
  (lower(trim('vedi')), 'vedi', 1.0, 'inventory', 0),
  (lower(trim('vedi chair')), 'vedi chair', 1.0, 'inventory', 0),
  (lower(trim('Velvet')), 'Velvet', 1.0, 'inventory', 0),
  (lower(trim('Wall Hanging')), 'Wall Hanging', 1.0, 'inventory', 0),
  (lower(trim('Wooden 2 D Pannel')), 'Wooden 2 D Pannel', 1.0, 'inventory', 0),
  (lower(trim('Wooden 2D Arch')), 'Wooden 2D Arch', 1.0, 'inventory', 0),
  (lower(trim('Wooden 3D Arch')), 'Wooden 3D Arch', 1.0, 'inventory', 0),
  (lower(trim('Wooden 3D Pannel')), 'Wooden 3D Pannel', 1.0, 'inventory', 0),
  (lower(trim('Wrought iron 2D Arch')), 'Wrought iron 2D Arch', 1.0, 'inventory', 0),
  (lower(trim('Wrought iron 3D Panel')), 'Wrought iron 3D Panel', 1.0, 'inventory', 0)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: 29 rate-card-only sub-categories (no physical inventory row today) ──
INSERT INTO rate_card_categories (id, label, scaling_factor, source, sort_order) VALUES
  (lower(trim('Rope light')), 'Rope light', 1.0, 'rate_card_only', 0),
  (lower(trim('Rug carpet')), 'Rug carpet', 1.0, 'rate_card_only', 0),
  (lower(trim('Wooden Accessory')), 'Wooden Accessory', 1.0, 'rate_card_only', 0),
  (lower(trim('Cocktail Banjara Accessories')), 'Cocktail Banjara Accessories', 1.0, 'rate_card_only', 0),
  (lower(trim('chowki')), 'chowki', 1.0, 'rate_card_only', 0),
  (lower(trim('Glass Panel 2D')), 'Glass Panel 2D', 1.0, 'rate_card_only', 0),
  (lower(trim('Coffee Table Florals ( Medium )')), 'Coffee Table Florals ( Medium )', 1.0, 'rate_card_only', 0),
  (lower(trim('Glass Table')), 'Glass Table', 1.0, 'rate_card_only', 0),
  (lower(trim('3D candle Walls')), '3D candle Walls', 1.0, 'rate_card_only', 0),
  (lower(trim('Takhat')), 'Takhat', 1.0, 'rate_card_only', 0),
  (lower(trim('Scrolls')), 'Scrolls', 1.0, 'rate_card_only', 0),   -- orphan category (cat_uzqdy) — see note above
  (lower(trim('Pole Pipes')), 'Pole Pipes', 1.0, 'rate_card_only', 0),
  (lower(trim('Coffee Table Floral ( Small )')), 'Coffee Table Floral ( Small )', 1.0, 'rate_card_only', 0),
  (lower(trim('mattress')), 'mattress', 1.0, 'rate_card_only', 0),
  (lower(trim('Pre Fabricated Ceiling')), 'Pre Fabricated Ceiling', 1.0, 'rate_card_only', 0),
  (lower(trim('Bulb Stand')), 'Bulb Stand', 1.0, 'rate_card_only', 0),
  (lower(trim('Centre piece small')), 'Centre piece small', 1.0, 'rate_card_only', 0),
  (lower(trim('Buffet Table')), 'Buffet Table', 1.0, 'rate_card_only', 0),
  (lower(trim('Bulb Wall')), 'Bulb Wall', 1.0, 'rate_card_only', 0),
  (lower(trim('Glass Panel 3D')), 'Glass Panel 3D', 1.0, 'rate_card_only', 0),
  (lower(trim('Printing')), 'Printing', 1.0, 'rate_card_only', 0),
  (lower(trim('Flower Pattern')), 'Flower Pattern', 1.0, 'rate_card_only', 0),
  (lower(trim('Coffee Table Floral ( Large )')), 'Coffee Table Floral ( Large )', 1.0, 'rate_card_only', 0),
  (lower(trim('BOLSTER')), 'BOLSTER', 1.0, 'rate_card_only', 0),      -- orphan category (cat_uzqdy) — see note above
  (lower(trim('Wedding Banjara Accessories')), 'Wedding Banjara Accessories', 1.0, 'rate_card_only', 0),
  (lower(trim('Carpet')), 'Carpet', 1.0, 'rate_card_only', 0),
  (lower(trim('Jewellery')), 'Jewellery', 1.0, 'rate_card_only', 0),
  (lower(trim('OVERLAYS')), 'OVERLAYS', 1.0, 'rate_card_only', 0),    -- orphan category (cat_uzqdy) — see note above
  (lower(trim('Centre Piece (medium)')), 'Centre Piece (medium)', 1.0, 'rate_card_only', 0)
ON CONFLICT (id) DO NOTHING;

-- ─── Rate Card → IMS migration, follow-up: per-sub-category floral pricing mode default ─────────
-- The Rate Card admin panel already lets an admin pin an individual Florals item to "100% Real" or
-- "100% Artificial" (floral_mode column, unchanged) instead of the global real/artificial ratio
-- slider. Nothing enforces that items sharing a sub-category agree on this, and setting it one item
-- at a time doesn't scale. This column is a sub-category-level DEFAULT: 'ratio' (the default) means
-- "no override — behave exactly as before"; 'real'/'artificial' applies to every item in the
-- sub-category that doesn't already have its own explicit per-item pin. Same loose-typing
-- convention as scaling_factor/cost_percent — no CHECK constraint.
ALTER TABLE rate_card_categories
  ADD COLUMN IF NOT EXISTS floral_mode TEXT DEFAULT 'ratio';

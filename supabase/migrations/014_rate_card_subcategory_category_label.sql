-- ─── Rate Card → IMS migration, follow-up: manual top-level-category override per sub-category ──
-- The Sub-Categories panel groups rows by top-level category derived live from `rate_card` items
-- (join by sub/imsAlias — see AdminSettingsTab.jsx's subToCatLabel). That derivation has no
-- write path: a sub-category with no matching rate_card item (or a newly-added one) always lands
-- in "Other" with no way to move it. This column is an explicit override — when set, it wins over
-- the derived grouping; when null, grouping falls back to the existing derivation unchanged.
ALTER TABLE rate_card_categories
  ADD COLUMN IF NOT EXISTS category_label TEXT;

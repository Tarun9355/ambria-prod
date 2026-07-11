-- ─── Rate Card → IMS migration, follow-up: per-sub-category "hidden from AI tagging" flag ────────
-- AI photo-tagging (client aiTagImage + the nightly batch-tagger Edge Function) is moving its
-- element vocabulary/matching from Rate Card items to live IMS inventory items. The old "not
-- taggable in Pricing" flag (settings blob 'ambria-tag-hidden-subs-v1', keyed "cat::sub" against
-- Rate Card's own cat/sub id strings) doesn't carry over cleanly — inventory's cat/subCat casing
-- differs, and this table's id (lower(trim(label))) is already the canonical sub-category join key
-- used everywhere else this session. This column replaces that mechanism for AI tagging purposes;
-- the old settings blob is left alone (unread by anything after this).
ALTER TABLE rate_card_categories
  ADD COLUMN IF NOT EXISTS tag_hidden BOOLEAN NOT NULL DEFAULT false;

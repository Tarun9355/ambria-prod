-- Typed mirror column for Build's "Correct & update master" full zone-build-spec save
-- (dimensions, truss, masking, plinth, carpet, custom ceiling/masking items). Previously this
-- only lived inside the `data` JSONB catch-all, which the zone-photo-matching queries
-- (fetchZoneLibraryPhotos / fetchRecentLibraryPhotos) never select for payload-size reasons —
-- so a corrected zone spec silently never made it back to Build when the photo was reselected,
-- even though it really was saved to `data`. Same "typed mirror + JSONB fallback" pattern as
-- status/tag_source/tagged_at (migration 008).
ALTER TABLE public.library
  ADD COLUMN IF NOT EXISTS zone_config_by_type JSONB DEFAULT '{}'::jsonb;

-- Backfill existing rows from the full-fidelity `data` blob where present.
UPDATE public.library
SET zone_config_by_type = COALESCE(data->'zoneConfigByType', '{}'::jsonb)
WHERE zone_config_by_type IS NULL OR zone_config_by_type = '{}'::jsonb;

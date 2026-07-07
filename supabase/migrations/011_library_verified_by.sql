-- Studio Library: surface who verified a photo as queryable typed columns. The app already
-- stamps `_verifiedBy`/`_verifiedAt` on every Save & Verify (ManageLibrary.jsx, StudioBuild.jsx)
-- but only inside the `data` JSONB blob — the paginated grid query only selects light columns,
-- not `data`, so verifier identity was invisible there. Mirrors the status/tag_source/tagged_at
-- pattern from migration 008.
ALTER TABLE public.library
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Backfill from whatever's already recorded in `data` for existing verified rows.
-- `_verifiedAt` is a JS Date.now() millisecond epoch stored as a JSONB number.
UPDATE public.library
SET verified_by = data->>'_verifiedBy'
WHERE verified_by IS NULL AND status = 'verified' AND data->>'_verifiedBy' IS NOT NULL;

UPDATE public.library
SET verified_at = to_timestamp((data->>'_verifiedAt')::bigint / 1000.0)
WHERE verified_at IS NULL AND status = 'verified' AND data->>'_verifiedAt' ~ '^[0-9]+$';

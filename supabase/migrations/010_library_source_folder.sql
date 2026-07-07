-- Studio Library: track which Cloudinary top-level folder each photo came from, so the
-- salesperson-facing library can exclude asset/prop/texture folders (e.g. "inventory") that
-- were never meant for browsing — only "ambria", "client-uploads", "inhouse venues", and
-- "Outside Venues" should ever surface in the Studio Library UI or the nightly tagger.
ALTER TABLE public.library
  ADD COLUMN IF NOT EXISTS source_folder TEXT;

CREATE INDEX IF NOT EXISTS idx_library_source_folder ON public.library (source_folder);

-- Backfill from the existing Cloudinary URL: the first path segment after "/upload/vNNN/"
-- is the top-level folder (e.g. "ambria", "inhouse venues", "inventory", ...).
UPDATE public.library
SET source_folder = split_part(
  replace(regexp_replace(url, '^.*/upload/(v[0-9]+/)?', ''), '%20', ' '),
  '/', 1
)
WHERE source_folder IS NULL AND url IS NOT NULL;

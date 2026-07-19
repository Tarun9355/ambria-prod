-- One-time backfill for the new photo_corrections table (017). Run once, after 017.
--
-- 1) Migrate every entry from the old JSON-blob log (settings key 'ambria-correction-log-v1').
--    That key stores a JSON-encoded STRING (kv.js always JSON.stringify's before saving into the
--    jsonb `value` column), so it needs unwrapping with `#>>'{}'` before it can be parsed as an array.
INSERT INTO public.photo_corrections (photo_id, photo_name, user_name, user_id, source, kind, created_at)
SELECT
  entry->>'photoId',
  entry->>'photoName',
  entry->>'user',
  NULLIF(entry->>'userId', ''),
  COALESCE(entry->>'source', 'build'),
  COALESCE(entry->>'kind', 'photo'),
  to_timestamp((entry->>'ts')::bigint / 1000.0)
FROM public.settings s,
     LATERAL jsonb_array_elements((s.value #>> '{}')::jsonb) AS entry
WHERE s.key = 'ambria-correction-log-v1'
  AND entry->>'photoId' IS NOT NULL
  AND entry->>'ts' ~ '^[0-9]+$';

-- 2) Reconstruct one entry for every verified photo the blob has NO record of at all (any user) —
--    the blob's read-modify-write race (see 017) silently dropped these entirely. Credit goes to
--    whoever `library.verified_by` says verified it — that column is a real per-row field on the
--    library table, written in the same upsert as the photo save, so it was never subject to the
--    blob's race.
INSERT INTO public.photo_corrections (photo_id, photo_name, user_name, user_id, source, kind, created_at)
SELECT l.id, l.name, l.verified_by, NULL, 'backfill', 'photo', COALESCE(l.verified_at, now())
FROM public.library l
WHERE l.status = 'verified'
  AND l.verified_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.photo_corrections pc WHERE pc.photo_id = l.id);

-- One-time cleanup: photo_corrections previously logged an entry on EVERY save, including edits
-- to an already-verified photo/video (fixed in the app now — logCorrection only fires on first
-- verification). This retroactively removes those extra "edit" rows: for each (photo_id, kind),
-- keep only the earliest-logged row (the actual first verification) and delete the rest.
DELETE FROM public.photo_corrections a
USING public.photo_corrections b
WHERE a.photo_id = b.photo_id
  AND a.kind = b.kind
  AND (a.created_at, a.id) > (b.created_at, b.id);

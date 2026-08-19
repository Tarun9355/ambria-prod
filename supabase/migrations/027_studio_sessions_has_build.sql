-- Recompute studio_sessions.has_data with the stricter rule, and drop the prices that rule invalidates.
--
-- WHY: 026 filled has_data with the same test the app used (fnSnapHasData), which counts a picked
-- reference video as data. That is correct for the question fnSnapHasData exists to answer — "would
-- this auto-save destroy work?" — and wrong for "does this function have a build". The reference is
-- not per-function in practice: pick a video on Wedding and it is still the reference on Sangeet and
-- Haldi, so every function's snapshot carries it and every row claimed to hold a build. On screen
-- that is one build showing up on all three pills with the same title, and — because a price was
-- carried onto any function whose snapshot merely existed — the same figure too. A ₹0 Wedding read
-- ₹6,90,091.
--
-- Elements, zones and photos can only be put on a function by working on that function, so they are
-- what has_data now means here. The app writes the same test (fnSnapHasBuild) from this release on;
-- this brings the rows 026 backfilled into line with it.
--
-- Rows are not deleted — a function with no build keeps its row and its snapshot, it simply stops
-- claiming to be something Browse can offer as a build to resume.

UPDATE public.studio_sessions SET
  has_data = (
    COALESCE(jsonb_typeof(build->'elSelectedPhoto'),'null') = 'object'
      AND build->'elSelectedPhoto' <> '{}'::jsonb
    OR COALESCE(jsonb_typeof(build->'zoneElements'),'null') = 'object'
      AND build->'zoneElements' <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(
        CASE WHEN jsonb_typeof(build->'enabledEls') = 'object'
             THEN build->'enabledEls' ELSE '{}'::jsonb END
      ) AS e(k,v)
      WHERE v = 'true'::jsonb
    )
  );

-- A price on a function with no build describes something that is not there. Cleared rather than
-- left to be printed on a card. The figure is recomputed and rewritten the moment that function is
-- actually built on and saved.
UPDATE public.studio_sessions
SET total = NULL, tier = NULL, decor_total = NULL, transport_total = NULL
WHERE has_data = false
  AND (total IS NOT NULL OR tier IS NOT NULL OR decor_total IS NOT NULL OR transport_total IS NOT NULL);

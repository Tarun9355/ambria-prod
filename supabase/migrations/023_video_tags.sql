-- Video tags: one row per video, replacing the `ambria-yt-tags-v1` settings blob.
--
-- WHY: 428 tag records lived in a single JSONB cell, so every save rewrote all 428. On 30 Jul 2026
-- one failed read during a single-video edit was treated as "no tags exist" and the save replaced
-- the whole map — 249 human verifications lost, recovered only by a full database rollback. A blob
-- makes CLAUDE.md's rule 1 (row-level updates) impossible by construction: one row per video means
-- a bad write costs one video, not the library.
--
-- SHAPE: derived from the live data, not guessed. Scalars that Manage/Browse filter on become real
-- columns; the three genuinely-nested arrays stay JSONB, which is what rule 3 permits.
--   colors/styles      100% present, max 5 entries
--   palette/venue      100%
--   tier/timeSetting/io ~57%
--   fn                  58%, max 7 entries
--   _verified*          58% (249 verified)
--   venueCustom/_lastEdited*  ~2%
-- zone_photos and linked_events appear in NO current record, but the app reads tag.zonePhotos and
-- tag.linkedEvents — so they are here, or those saves would silently lose data.
--
-- TIMESTAMPS: the *_at fields are epoch milliseconds in the app (new Date(t._savedAt)). Kept as
-- BIGINT rather than converted to timestamptz so the adapter is a pass-through and no consumer
-- changes. `updated_at` is separate: ours, for realtime/ordering.

CREATE TABLE IF NOT EXISTS public.video_tags (
  video_id        TEXT PRIMARY KEY,
  venue           TEXT,
  venue_custom    BOOLEAN,
  palette         TEXT,
  tier            TEXT,
  time_setting    TEXT,
  io              TEXT,
  fn              JSONB   DEFAULT '[]'::jsonb,
  styles          JSONB   DEFAULT '[]'::jsonb,
  colors          JSONB   DEFAULT '[]'::jsonb,
  zone_photos     JSONB   DEFAULT '{}'::jsonb,
  linked_events   JSONB   DEFAULT '[]'::jsonb,
  ai_tagged       BOOLEAN DEFAULT false,
  verified        BOOLEAN DEFAULT false,
  verified_by     TEXT,
  verified_at     BIGINT,
  saved_by        TEXT,
  saved_at        BIGINT,
  last_edited_by  TEXT,
  last_edited_at  BIGINT,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Manage's folder counts and Browse's filters key off these.
CREATE INDEX IF NOT EXISTS video_tags_verified_idx ON public.video_tags (verified);
CREATE INDEX IF NOT EXISTS video_tags_venue_idx    ON public.video_tags (venue);
CREATE INDEX IF NOT EXISTS video_tags_updated_idx  ON public.video_tags (updated_at DESC);

-- The app talks to Supabase with the plain anon key (no forced Supabase Auth login — see CLAUDE.md
-- and the reasoning in 019), so `TO authenticated` alone would lock the app out of its own data.
ALTER TABLE public.video_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.video_tags;
CREATE POLICY ambria_anon_all ON public.video_tags FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Live tab-to-tab sync, the same reason YT_TAG_SK was added to the settings realtime allowlist.
-- Guarded: re-running the migration must not error if it is already a member.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.video_tags;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;   -- publication absent on some local setups
END $$;

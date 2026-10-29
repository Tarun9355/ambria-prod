-- Video master build — lets a salesperson save the WHOLE current function's build (every zone,
-- element, selected photo, quantity, palette) back onto the video it was built from, so the next
-- person who hits "Customize" on that video gets this exact look pre-loaded instead of a bare
-- venue/fn placeholder with nothing turned on.
--
-- Distinct from zone_photos (one representative photo per zone, used only for Browse's rough price
-- estimate) — master_build is a full build snapshot, same shape snapshotBuildState/restoreBuildState
-- already use for "Copy build from client". Any salesperson can overwrite it (full overwrite, no
-- merge) — same self-serve trust level as the existing per-photo "Update master" correction flow, so
-- a master stays fresh through normal usage rather than needing a periodic admin pass.
--
-- canva_* columns hold a video-level Canva deck (separate from a deal's own per-client deck, which
-- is cached in localStorage since it's ephemeral to that one deal) — shared, so it has to live here
-- instead. canva_deck_sig is a fingerprint of the master build the deck was last generated from, so
-- "View Deck" can tell when the deck is of an older version of the master, same idea as Summary's
-- own deckSigOf/deckStale.
ALTER TABLE public.video_tags
  ADD COLUMN IF NOT EXISTS master_build    JSONB,
  ADD COLUMN IF NOT EXISTS master_build_by TEXT,
  ADD COLUMN IF NOT EXISTS master_build_at BIGINT,
  ADD COLUMN IF NOT EXISTS canva_edit_url  TEXT,
  ADD COLUMN IF NOT EXISTS canva_design_id TEXT,
  ADD COLUMN IF NOT EXISTS canva_deck_sig  TEXT;

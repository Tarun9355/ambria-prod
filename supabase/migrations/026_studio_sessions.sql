-- Studio sessions: one row per SAVE per FUNCTION, replacing the `sessions` array nested inside
-- client_ledger.data.
--
-- WHY: a deal's entire save history lived in one JSONB cell on the client row, and every autosave
-- (every 15s) rewrote the whole cell. That is CLAUDE.md rule 1 broken by construction — the same
-- reason video tags were moved out of their blob in 023 — and it is where a run of Browse bugs came
-- from, all of them the same bug wearing different clothes:
--
--   * ONE total for a MULTI-FUNCTION deal. `total`/`tier` were written at the session level from
--     whichever function happened to be on screen, so a card badged Fn2 printed Fn1's price. Adding
--     savedActiveFnIdx let the UI notice, but it could then only hide the figure, not find the right
--     one — so cards went blank instead of wrong. A later `fnTotals` map patched a price back in.
--     Here `total` is a column on the function's own row and the question does not arise.
--   * WHICH FUNCTION a saved build belongs to had to be GUESSED, by scanning fnSnapshots for a key
--     that "has data" (fnSnapHasData). fn_idx is a column.
--   * The reference video was read from session-level flat fields that the rolling autosave nulls
--     whenever the active function has none, so a card flipped to "no longer in library" a second
--     after appearing. source_video_id sits on the row it describes.
--   * "Is the open video already saved?" needed the whole history scanned client-side, and was asked
--     of only the newest session, so a saved build was announced as unsaved. It is now one indexed
--     query per (client, function).
--
-- SHAPE: derived from the snapshot saveSession actually writes, not guessed. The scalars Browse
-- lists, sorts and filters on become real columns; the build itself (zoneConfig, zoneElements,
-- enabledEls, elTiers, elNotes, elSelectedPhoto, moods, palettes, customItems) stays JSONB in
-- `build` — those are keyed lookups and nested config, which is exactly what rule 3 permits.
--
-- GRANULARITY: one row per (session_id, fn_idx). A single Save Draft writes as many rows as the deal
-- has functions with work in them; session_id groups them so "one save" is still a thing you can ask
-- about. This is what "function specific" means here — Browse no longer derives a function from the
-- data, it queries for one.
--
-- TIMESTAMPS: saved_at is epoch milliseconds, matching the app (new Date(s.savedAt)) and the same
-- choice 023 made — BIGINT so the adapter stays a pass-through. `updated_at` is separate: ours, for
-- realtime and ordering.
--
-- NOTHING IS DROPPED. client_ledger.data.sessions stays exactly as it is: the app keeps writing it
-- as a mirror for one release and reads it as a fallback, the same two-step 023 used, so this is
-- reversible without data loss.

CREATE TABLE IF NOT EXISTS public.studio_sessions (
  -- session_id || ':' || fn_idx. Deterministic, so a re-run of the backfill and a re-save from the
  -- app both land on the same row instead of duplicating it.
  id                 TEXT PRIMARY KEY,
  -- Groups the per-function rows written by one save.
  session_id         TEXT NOT NULL,
  client_id          TEXT NOT NULL,
  fn_idx             INTEGER NOT NULL,

  saved_at           BIGINT NOT NULL,
  saved_by           TEXT,
  -- true for the rolling background draft, false for a deliberate Save Draft. The app collapses
  -- consecutive auto-drafts in place rather than keeping every 15s tick.
  auto               BOOLEAN DEFAULT false,
  -- Was this the function on screen when the save fired? Only bookkeeping now that every function
  -- carries its own figures — kept because it says which build the salesperson was actually looking
  -- at, which nothing else records.
  is_active_fn       BOOLEAN DEFAULT false,
  -- Cheap enough to compute on write, and it is the one thing Browse filters every row on: a
  -- function with no build is not offered as something to resume.
  has_data           BOOLEAN DEFAULT false,

  fn_label           TEXT,
  event_date         TEXT,
  venue              TEXT,

  source_video_id    TEXT,
  source_video_title TEXT,
  source_event_id    TEXT,
  source_event_name  TEXT,

  total              NUMERIC,
  tier               TEXT,
  decor_total        NUMERIC,
  transport_total    NUMERIC,

  build              JSONB DEFAULT '{}'::jsonb,
  updated_at         TIMESTAMPTZ DEFAULT now(),

  UNIQUE (session_id, fn_idx)
);

-- Browse's only query: this client's saved work for this function, newest first.
CREATE INDEX IF NOT EXISTS studio_sessions_client_fn_idx
  ON public.studio_sessions (client_id, fn_idx, saved_at DESC);
-- "Is the video I have open already saved for this function?"
CREATE INDEX IF NOT EXISTS studio_sessions_video_idx
  ON public.studio_sessions (client_id, fn_idx, source_video_id);
CREATE INDEX IF NOT EXISTS studio_sessions_session_idx
  ON public.studio_sessions (session_id);

-- Keep updated_at honest, via the trigger function 001 already defines.
DROP TRIGGER IF EXISTS set_timestamp ON public.studio_sessions;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.studio_sessions
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- The app talks to Supabase with the plain anon key (no forced Supabase Auth login — see CLAUDE.md
-- and the reasoning in 019), so `TO authenticated` alone would lock the app out of its own data.
ALTER TABLE public.studio_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.studio_sessions;
CREATE POLICY ambria_anon_all ON public.studio_sessions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Live tab-to-tab sync, same as 023. Guarded: re-running must not error if already a member.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_sessions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;   -- publication absent on some local setups
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL
-- ═══════════════════════════════════════════════════════════════════════════
-- Two passes, because the history holds two shapes. Sessions written since fnSnapshots exists carry
-- a map of per-function builds; older ones carry the build in flat fields and belong to Fn1.
-- ON CONFLICT DO NOTHING throughout, so this is safe to re-run and can never overwrite a row the
-- app has since written.

-- ── Pass 1: sessions with fnSnapshots — one row per function present in the map ──
INSERT INTO public.studio_sessions (
  id, session_id, client_id, fn_idx,
  saved_at, saved_by, auto, is_active_fn, has_data,
  fn_label, event_date, venue,
  source_video_id, source_video_title, source_event_id, source_event_name,
  total, tier, decor_total, transport_total, build
)
SELECT
  COALESCE(s.value->>'id', c.id || '_' || s.ord::text) || ':' || f.key,
  COALESCE(s.value->>'id', c.id || '_' || s.ord::text),
  c.id,
  f.key::int,
  COALESCE(NULLIF(s.value->>'savedAt','')::bigint, 0),
  s.value->>'savedBy',
  COALESCE((s.value->>'auto')::boolean, false),
  (s.value->>'savedActiveFnIdx') IS NOT NULL AND (s.value->>'savedActiveFnIdx') = f.key,
  -- Same test as fnSnapHasData: a photo, a zone element, an enabled element, or a reference.
  (
    COALESCE(jsonb_typeof(f.value->'elSelectedPhoto'),'null') = 'object'
      AND f.value->'elSelectedPhoto' <> '{}'::jsonb
    OR COALESCE(jsonb_typeof(f.value->'zoneElements'),'null') = 'object'
      AND f.value->'zoneElements' <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(
        CASE WHEN jsonb_typeof(f.value->'enabledEls') = 'object'
             THEN f.value->'enabledEls' ELSE '{}'::jsonb END
      ) AS e(k,v)
      WHERE v = 'true'::jsonb
    )
    OR COALESCE(f.value->'sourceVideo'->>'id', f.value->>'sourceVideoId') IS NOT NULL
    OR COALESCE(f.value->'sourceEvent'->>'id', f.value->>'sourceEventId') IS NOT NULL
  ),
  s.value->>'fn',
  s.value->>'eventDate',
  s.value->>'venue',
  COALESCE(f.value->'sourceVideo'->>'id',   f.value->>'sourceVideoId'),
  COALESCE(f.value->'sourceVideo'->>'title', f.value->>'sourceVideoTitle'),
  COALESCE(f.value->'sourceEvent'->>'id',   f.value->>'sourceEventId'),
  COALESCE(f.value->'sourceEvent'->>'name', f.value->>'sourceEventName'),
  -- The figure for THIS function: its own fnTotals entry, else the session-level total but only
  -- when the session says that total was taken from this function. Never another function's number.
  COALESCE(
    NULLIF(s.value->'fnTotals'->f.key->>'total','')::numeric,
    CASE WHEN (s.value->>'savedActiveFnIdx') = f.key
         THEN NULLIF(s.value->>'total','')::numeric END
  ),
  COALESCE(
    s.value->'fnTotals'->f.key->>'tier',
    CASE WHEN (s.value->>'savedActiveFnIdx') = f.key
         THEN s.value->>'tier' END
  ),
  CASE WHEN (s.value->>'savedActiveFnIdx') = f.key
       THEN NULLIF(s.value->>'decorTotal','')::numeric END,
  CASE WHEN (s.value->>'savedActiveFnIdx') = f.key
       THEN NULLIF(s.value->>'transportTotal','')::numeric END,
  f.value
FROM public.client_ledger c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.data->'sessions') = 'array'
       THEN c.data->'sessions' ELSE '[]'::jsonb END
) WITH ORDINALITY AS s(value, ord)
CROSS JOIN LATERAL jsonb_each(
  CASE WHEN jsonb_typeof(s.value->'fnSnapshots') = 'object'
       THEN s.value->'fnSnapshots' ELSE '{}'::jsonb END
) AS f(key, value)
WHERE f.key ~ '^[0-9]+$'
ON CONFLICT (id) DO NOTHING;

-- ── Pass 2: legacy sessions with no fnSnapshots — flat fields, they belong to Fn1 ──
INSERT INTO public.studio_sessions (
  id, session_id, client_id, fn_idx,
  saved_at, saved_by, auto, is_active_fn, has_data,
  fn_label, event_date, venue,
  source_video_id, source_video_title, source_event_id, source_event_name,
  total, tier, decor_total, transport_total, build
)
SELECT
  COALESCE(s.value->>'id', c.id || '_' || s.ord::text) || ':0',
  COALESCE(s.value->>'id', c.id || '_' || s.ord::text),
  c.id,
  0,
  COALESCE(NULLIF(s.value->>'savedAt','')::bigint, 0),
  s.value->>'savedBy',
  COALESCE((s.value->>'auto')::boolean, false),
  true,
  (
    COALESCE(jsonb_typeof(s.value->'elSelectedPhoto'),'null') = 'object'
      AND s.value->'elSelectedPhoto' <> '{}'::jsonb
    OR COALESCE(jsonb_typeof(s.value->'zoneElements'),'null') = 'object'
      AND s.value->'zoneElements' <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(
        CASE WHEN jsonb_typeof(s.value->'enabledEls') = 'object'
             THEN s.value->'enabledEls' ELSE '{}'::jsonb END
      ) AS e(k,v)
      WHERE v = 'true'::jsonb
    )
    OR s.value->>'sourceVideoId' IS NOT NULL
    OR s.value->>'sourceEventId' IS NOT NULL
  ),
  s.value->>'fn',
  s.value->>'eventDate',
  s.value->>'venue',
  s.value->>'sourceVideoId',
  s.value->>'sourceVideoTitle',
  s.value->>'sourceEventId',
  s.value->>'sourceEventName',
  NULLIF(s.value->>'total','')::numeric,
  s.value->>'tier',
  NULLIF(s.value->>'decorTotal','')::numeric,
  NULLIF(s.value->>'transportTotal','')::numeric,
  s.value
FROM public.client_ledger c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.data->'sessions') = 'array'
       THEN c.data->'sessions' ELSE '[]'::jsonb END
) WITH ORDINALITY AS s(value, ord)
WHERE jsonb_typeof(s.value->'fnSnapshots') IS DISTINCT FROM 'object'
   OR s.value->'fnSnapshots' = '{}'::jsonb
ON CONFLICT (id) DO NOTHING;

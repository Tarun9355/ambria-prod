-- ═══ ATTENDANCE ═══
-- One row per punch EVENT, not one row per user per day. A day can hold more than one in/out pair
-- (a lunch break, stepping out for a delivery), and an append-only event log sidesteps the same
-- update-conflict class of bug the studio_sessions saga was built around: nothing here is ever
-- edited after it's written, only inserted, so there is no "last write wins" race between two
-- devices punching the same row.
--
-- "Today's status" and "is this the day's first punch-in" are both derived by querying this table
-- for (user_id, date) rather than kept in a separate mutable status column — the query is cheap
-- (indexed below) and a derived fact can't drift from the events it's derived from.
--
-- `date` is the WORK day the punch belongs to (client-computed, business-local, 'YYYY-MM-DD') —
-- stored redundantly alongside `at` (the real timestamp) purely so the app never has to fetch a
-- user's whole history to answer "what happened today", the mistake CONTEXT.md's session-storage
-- saga documents (studio_sessions grew to 22k+ rows because nothing scoped the read). A punch
-- query here is always WHERE user_id = ? AND date = ?, never a plain select *.
CREATE TABLE IF NOT EXISTS public.attendance (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES public.users(id),
  -- Denormalized so a future admin report reads without a join — the same habit studio_sessions
  -- uses for fn_label/event_date/venue.
  user_name     TEXT,
  type          TEXT NOT NULL CHECK (type IN ('in', 'out')),
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  date          TEXT NOT NULL,
  photo         TEXT,
  -- Did the on-device face check pass? (src/lib/faceCheck.js) Not a liveness/anti-spoof guarantee,
  -- just "a face was found in the frame" — see that file's own header for what it does not catch.
  verified      BOOLEAN NOT NULL DEFAULT false,
  -- Set on every punch-in (the training-video gate runs each time). Null on a punch-out.
  quiz_passed   BOOLEAN,
  quiz_answers  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- The only query this table serves: one user's punches on one work day, in order.
CREATE INDEX IF NOT EXISTS attendance_user_date_idx
  ON public.attendance (user_id, date, at);

-- Same anon-key access as every other table (see 026_studio_sessions.sql and CLAUDE.md) — the app
-- has no forced Supabase Auth login, so restricting this to `authenticated` would lock it out of
-- its own data.
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.attendance;
CREATE POLICY ambria_anon_all ON public.attendance
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Guarded: re-running must not error if already a member (same idiom as every prior migration
-- that adds a table to realtime).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;   -- publication absent on some local setups
END $$;

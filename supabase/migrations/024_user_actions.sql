-- User action log: who opened which video/photo, who tagged what, and whether the save actually
-- landed. Answers "kisne kya kiya, kab, aur hua ya nahi".
--
-- Deliberately NOT the same thing as audit_log (001, still unused): that one is for row-level
-- before/after diffs written by DB triggers. This one records USER INTENT from the app — including
-- actions that touch no row at all (opening a photo) and, crucially, saves that FAILED. A failed
-- save leaves no trace in the database by definition, so only the app can report it.
--
-- ok = null  -> not a write (a click / an open)
-- ok = true  -> the write succeeded
-- ok = false -> the user tried and it did not save; `error` says why

CREATE TABLE IF NOT EXISTS public.user_actions (
  id           BIGSERIAL PRIMARY KEY,
  user_name    TEXT,
  user_id      TEXT,
  action       TEXT NOT NULL,   -- 'video.open' | 'video.tag' | 'video.verify' | 'photo.open' | 'photo.tag' | 'bulk.*'
  target_type  TEXT,            -- 'video' | 'photo' | null
  target_id    TEXT,
  target_name  TEXT,            -- title/filename, denormalised so the log reads without joins
  ok           BOOLEAN,
  error        TEXT,
  detail       JSONB,           -- changed fields, counts for bulk actions, etc.
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- The log is read newest-first, and filtered by person, by target, or by "show me the failures".
CREATE INDEX IF NOT EXISTS user_actions_created_idx ON public.user_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS user_actions_user_idx    ON public.user_actions (user_name, created_at DESC);
CREATE INDEX IF NOT EXISTS user_actions_target_idx  ON public.user_actions (target_id, created_at DESC);
-- Partial index: failures are rare and are the rows you go looking for after something goes wrong.
CREATE INDEX IF NOT EXISTS user_actions_failed_idx  ON public.user_actions (created_at DESC) WHERE ok = false;

-- Anon, for the same reason as every other table here: the app has no Supabase Auth login (019).
ALTER TABLE public.user_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.user_actions;
CREATE POLICY ambria_anon_all ON public.user_actions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

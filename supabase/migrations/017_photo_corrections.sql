-- Contribution log, take 2. The old log lived as a single JSON array under one `settings` row
-- (key "ambria-correction-log-v1"), appended by read-whole-array → push → write-whole-array-back.
-- That's a lost-update race: when two people saved corrections close together, whoever's browser
-- held the slightly-older array would win the write and silently erase the other person's entry.
-- Same shape as tag_corrections (006) — one row per event, plain INSERT, no read-modify-write.

CREATE TABLE IF NOT EXISTS public.photo_corrections (
  id BIGSERIAL PRIMARY KEY,
  photo_id TEXT NOT NULL,
  photo_name TEXT,
  user_name TEXT,
  user_id TEXT,
  source TEXT,
  kind TEXT DEFAULT 'photo',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_corrections_created_idx ON public.photo_corrections (created_at DESC);
CREATE INDEX IF NOT EXISTS photo_corrections_photo_idx ON public.photo_corrections (photo_id);

ALTER TABLE public.photo_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_authenticated_all ON public.photo_corrections;
CREATE POLICY ambria_authenticated_all ON public.photo_corrections FOR ALL TO authenticated USING (true) WITH CHECK (true);

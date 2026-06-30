-- Part C — per-field tag corrections: every time a reviewer changes an AI-suggested tag, we record
-- the before/after so future tagging can "learn from these". RLS-enabled (new tables get no policy
-- automatically now that 005 locked the schema), Phase-1 model: any logged-in staff can read/write.

CREATE TABLE IF NOT EXISTS public.tag_corrections (
  id BIGSERIAL PRIMARY KEY,
  photo_id TEXT NOT NULL,
  field TEXT NOT NULL,
  ai_value TEXT,
  corrected_value TEXT,
  corrected_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tag_corrections_created_idx ON public.tag_corrections (created_at DESC);

ALTER TABLE public.tag_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_authenticated_all ON public.tag_corrections;
CREATE POLICY ambria_authenticated_all ON public.tag_corrections FOR ALL TO authenticated USING (true) WITH CHECK (true);

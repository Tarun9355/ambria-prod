-- Part B — log of each nightly batch-tagger attempt. Written by the edge function (service role,
-- bypasses RLS); readable by logged-in staff. RLS-enabled like every other table.

CREATE TABLE IF NOT EXISTS public.batch_tag_log (
  id BIGSERIAL PRIMARY KEY,
  photo_id TEXT,
  success BOOLEAN,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batch_tag_log_created_idx ON public.batch_tag_log (created_at DESC);

ALTER TABLE public.batch_tag_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_authenticated_all ON public.batch_tag_log;
CREATE POLICY ambria_authenticated_all ON public.batch_tag_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

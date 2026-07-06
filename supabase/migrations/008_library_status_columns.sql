-- Library server-side pagination: typed status/tag-source/tagged-at mirrors of the
-- data JSONB fields (_verified, tagSource, _aiTaggedAt/_verifiedAt), so status-chip
-- counts and cursor pagination don't need to unpack JSONB on every query.
ALTER TABLE public.library
  ADD COLUMN IF NOT EXISTS status TEXT,       -- 'verified' | 'review' | 'untagged'
  ADD COLUMN IF NOT EXISTS tag_source TEXT,   -- 'nightly' | 'manual' | NULL
  ADD COLUMN IF NOT EXISTS tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_library_status_tagged ON public.library (status, tagged_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_library_tag_source ON public.library (tag_source);
CREATE INDEX IF NOT EXISTS idx_library_created ON public.library (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_library_tags_gin ON public.library USING GIN (tags);

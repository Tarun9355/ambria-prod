-- ═══ LMS CONTRACT CACHE (Phase 7.1) ═══
-- Server-side cache of LMS/ERP contracts so the browser never paginates the LMS API
-- on load. The `lms` Edge Function (op=sync) paginates server-side and upserts here;
-- the app reads this table for an instant Calendar.

CREATE TABLE IF NOT EXISTS lms_contracts (
  id TEXT PRIMARY KEY,          -- "<dept>-<entryNo>"
  dept TEXT,                    -- 'venue' | 'decor'
  entry_no TEXT,
  guest_name TEXT,
  data JSONB NOT NULL DEFAULT '{}',  -- full grouped contract (header + functions[])
  synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_contracts_synced ON lms_contracts (synced_at);

-- Realtime so an in-progress sync streams contracts to open Calendars.
ALTER PUBLICATION supabase_realtime ADD TABLE lms_contracts;

-- ═══ LMS DECOR LEAD CACHE (Phase 7.2) ═══
-- Separate from lms_contracts on purpose: this holds pre-contract decor ENQUIRIES
-- (LMS "get_decor_information_list", dh_/dhd_ fields) — a different list, and a
-- different numbering sequence, than decor CONTRACTS. Kept in its own table so these
-- leads never get pulled into the IMS Calendar's season/demand math (which counts
-- lms_contracts functions as booked events). The `lms` Edge Function (op=sync) upserts
-- here; Studio's Event Info guest search reads it for decor-department results.

CREATE TABLE IF NOT EXISTS lms_decor_leads (
  id TEXT PRIMARY KEY,          -- lead entry_no (e.g. "01239")
  entry_no TEXT,
  guest_name TEXT,
  data JSONB NOT NULL DEFAULT '{}',  -- grouped lead (header + functions[]), same shape as lms_contracts.data
  synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_decor_leads_synced ON lms_decor_leads (synced_at);

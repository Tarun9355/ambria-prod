-- Canva OAuth token storage — a single row holding the access/refresh token for the ONE shared
-- Canva account that authorizes Ambria's integration (see supabase/functions/canva).
--
-- Unlike most tables here, this one gets NO client-facing policy at all. Every other public table
-- was opened to any authenticated (logged-in) staff session by migration 005's blanket
-- `ambria_authenticated_all` policy — fine for business data, but wrong for an OAuth token: any
-- staff member's browser session could then read the Canva refresh token straight out of the
-- table via the Supabase JS client. RLS is enabled with ZERO policies, so only the edge function's
-- service-role key (which always bypasses RLS) can read or write it — never the client.
CREATE TABLE IF NOT EXISTS canva_integration (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.canva_integration ENABLE ROW LEVEL SECURITY;

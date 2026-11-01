-- Platform and Batta get the same date-aware booking depth Truss pillars/beams already have
-- (truss_allocations / truss_overrides / truss_simulations / truss_audit, see 001_initial_schema.sql
-- and trussEngine.js's Layer 4 comments) — one allocation table per date (events[] + pool snapshot),
-- an overrides table (department-head force-a-different-config per event), a simulations table
-- (48hr draft what-if scenarios), and an append-only audit log. Mirrors those four tables' exact
-- column shapes so the same read/write/realtime code paths work unchanged against the new names.
--
-- This is step 1 (data model) of moving truss/platform/batta booking off the generic `inventory`
-- table and onto their own date-aware pools, same as truss already is.

CREATE TABLE IF NOT EXISTS platform_allocations (
  date TEXT PRIMARY KEY,
  events JSONB DEFAULT '[]',
  pool JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_overrides (
  id TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_simulations (
  id TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id BIGSERIAL PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batta_allocations (
  date TEXT PRIMARY KEY,
  events JSONB DEFAULT '[]',
  pool JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batta_overrides (
  id TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batta_simulations (
  id TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batta_audit (
  id BIGSERIAL PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at, same trigger function 001_initial_schema.sql already defined.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'platform_allocations','platform_overrides','platform_simulations',
    'batta_allocations','batta_overrides','batta_simulations'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_timestamp ON %I', t);
    EXECUTE format('CREATE TRIGGER set_timestamp BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_timestamp()', t);
  END LOOP;
END $$;

-- RLS: current convention since 048_require_login_rls.sql — every table gets RLS on plus a single
-- `ambria_authenticated_all` policy (logged-in Supabase Auth session only, no more open anon access).
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'platform_allocations','platform_overrides','platform_simulations','platform_audit',
    'batta_allocations','batta_overrides','batta_simulations','batta_audit'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ambria_authenticated_all ON public.%I', t);
    EXECUTE format('CREATE POLICY ambria_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Realtime — same publication truss_allocations/truss_inventory already ride on (049's add-table
-- pattern: safe to run more than once, no-ops if already published).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_allocations;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_overrides;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_simulations;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.batta_allocations;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.batta_overrides;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.batta_simulations;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;

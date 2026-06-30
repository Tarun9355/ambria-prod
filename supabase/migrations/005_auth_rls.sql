-- ─── Auth migration · Part 2 of 2 (THE CUTOVER — reversible) ─────────────────────────────────────
-- Locks every public table so ONLY logged-in (Supabase-authenticated) staff can read/write. The
-- public anon key — which is baked into the website's JavaScript — can no longer touch any data.
--
-- ‼️ PRECONDITIONS (do not run until all are true):
--   • 004 has run, scripts/create-auth-users.mjs has run, every active user has a non-null auth_id.
--   • The dual-mode-login app build is deployed and staff have logged in via Supabase Auth at least
--     once (so they hold a live session). Verify with:  SELECT count(*) FROM users WHERE active AND auth_id IS NULL;  -- expect 0
--
-- ROLLBACK (instant, if any screen breaks): re-run with the DISABLE block at the bottom uncommented,
-- or per-table:  ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
--
-- Phase 1 model: any authenticated staff member has full access (the app UI controls what each role
-- sees). This closes the PUBLIC hole. Per-role table restrictions can be layered on later (Phase 2).

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ambria_authenticated_all ON public.%I', t);
    -- authenticated → full access; anon (the public website key) → no policy → denied.
    EXECUTE format('CREATE POLICY ambria_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Passwords now live in Supabase Auth (hashed). Remove the world-readable plaintext column.
-- (Only after confirming logins work via Supabase Auth — comment this out on a first cautious run.)
ALTER TABLE public.users DROP COLUMN IF EXISTS password;

-- ─── ROLLBACK (uncomment everything below and run to fully revert to today's open state) ───
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--   END LOOP;
-- END $$;

-- ─── Auth migration · Part 1 of 2 (SAFE — no behaviour change) ───────────────────────────────────
-- Adds the link column between the existing `users` profile rows and Supabase Auth accounts.
-- Running this changes nothing about how the app works today; it just prepares for Part 2.
--
-- Run order:
--   1. THIS file (004) in the Supabase SQL editor.
--   2. node scripts/create-auth-users.mjs   (creates auth accounts + fills auth_id)
--   3. Deploy the app (dual-mode login) and have staff log out/in once; verify everything works.
--   4. THEN 005_auth_rls.sql to enable RLS (the only protective, and reversible, switch).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_id uuid;

-- One auth account per profile; fast lookup on login (users WHERE auth_id = auth.uid()).
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_key ON public.users (auth_id) WHERE auth_id IS NOT NULL;

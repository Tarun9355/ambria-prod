-- THE CUTOVER (Step 5 of RUNBOOK_AUTH_RLS.md, done for real this time): stop the public anon key —
-- baked into the website's JS bundle, extractable by anyone who opens dev tools — from reading or
-- writing ANY table. From here on, only a real, logged-in Supabase Auth session (the `authenticated`
-- role) can reach the database at all.
--
-- Preconditions (verify before running — see the verification query handed over alongside this
-- file): every active staff account has `users.auth_id` set (real Supabase Auth account exists) and
-- has signed in at least once since the dual-mode login build shipped. The app's own login path
-- (src/lib/auth.js, this same change) no longer has a legacy fallback — Supabase Auth is the only
-- way in — so any account failing that precondition is locked out of login itself, not just data,
-- until an admin resets its password via Admin → Users.
--
-- Rollback (instant, if anything breaks): re-run with `TO anon, authenticated` restored on any
-- affected policy, e.g.:
--   drop policy ambria_authenticated_all on public.<table>;
--   create policy ambria_anon_all on public.<table> for all to anon, authenticated using (true) with check (true);

-- ═══ 1) Every table currently carrying the anon-open policy → authenticated-only ═══
-- Looping over pg_policies (not a hardcoded table list) so this can't miss a table and can't touch
-- canva_integration (022_canva_integration.sql) — RLS-on-zero-policies there is deliberate
-- (OAuth token storage, service-role-only) and has no ambria_anon_all policy to match.
do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'ambria_anon_all' loop
    execute format('drop policy ambria_anon_all on public.%I', t);
    execute format('create policy ambria_authenticated_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ═══ 2) RPC functions granted directly to anon (bypassable even with table RLS locked, since the
-- EXECUTE grant is a separate permission from the row-level policy) ═══
revoke execute on function public.recent_studio_sessions(int) from anon;
revoke execute on function public.merge_client_ledger_rows(jsonb) from anon;
revoke execute on function public.merge_settings_json(text, jsonb) from anon;

-- ═══ 3) client_ledger_light view — the one genuine bypass risk in this cutover ═══
-- A plain view runs with the privileges of its OWNER by default (the migration role, which bypasses
-- RLS entirely), not the querying role — so granting it to anon would keep every client's ledger
-- data readable through the view even after client_ledger itself is locked down. security_invoker
-- makes it run as the CALLER instead, so it's subject to client_ledger's own RLS like any other
-- query — and the grant is narrowed to match.
alter view public.client_ledger_light set (security_invoker = true);
revoke select on public.client_ledger_light from anon;
grant select on public.client_ledger_light to authenticated;

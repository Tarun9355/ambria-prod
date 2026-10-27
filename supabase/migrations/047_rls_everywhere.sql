-- Close the remaining RLS gap: an audit (user-run query against pg_class/pg_policies) found 40
-- public tables with RLS still OFF — everything from before migration 036's venues_table started
-- the current practice of giving every NEW table RLS + the standard ambria_anon_all policy. These
-- 40 are mostly tables from the original schema (005_auth_rls.sql once tried to lock them to
-- `authenticated`-only, but the app talks to Supabase with the plain anon key and no forced login —
-- see 019_photo_corrections_anon_policy.sql — so that lockdown was never load-bearing and these
-- tables have been running fully open ever since).
--
-- This does not change access at all — every one of these is already reachable with the anon key
-- today, open or not, because RLS-off means PostgREST serves rows with no row filter regardless of
-- role. Turning RLS on + granting anon/authenticated `USING (true) WITH CHECK (true)` keeps that
-- exact same behavior, it just does it through an explicit policy instead of no RLS at all — closing
-- the "RLS disabled in public" finding Supabase's own security advisor flags for each of these, and
-- matching every table migrated since 036.
--
-- canva_integration is deliberately excluded — see 022_canva_integration.sql: RLS enabled with ZERO
-- policies on purpose (OAuth tokens, service-role-only), not an oversight.
do $$
declare
  t text;
  tables text[] := array[
    'amend_requests', 'audit_log', 'backup_rama_sessions_20261022', 'batch_tag_log', 'blocks',
    'categories', 'client_ledger', 'client_ledger_backup_20261024', 'client_ledger_bak_20260826',
    'dc_photo_knowledge', 'event_orders', 'flower_patterns', 'functions', 'inventory', 'library',
    'lms_contracts', 'lms_decor_leads', 'mandi_flowers', 'overheads', 'production_requests',
    'projects', 'purchase_orders', 'rate_card', 'rate_card_categories', 'settings',
    'settings_backup_20oct', 'soft_holds', 'studio_events', 'studio_sessions_backup_20261024',
    'studio_sessions_bak_20260826', 'supervisors', 'tag_corrections', 'templates',
    'truss_allocations', 'truss_audit', 'truss_inventory', 'truss_overrides', 'truss_simulations',
    'users', 'vendors'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists ambria_anon_all on public.%I', t);
    execute format('create policy ambria_anon_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

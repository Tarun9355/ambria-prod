-- ═══ LMS LEAD → CONTRACT AUTO-RELINK, MOVED SERVER-SIDE ═══
-- Both the LMS sync (lms_contracts/lms_decor_leads) and the lead->contract relink correction used to
-- be entirely client-triggered — the relink in particular ran only inside an open, focused Studio
-- browser tab (60-90s after load, every 30 min, throttled via localStorage). A real booked deal
-- ("Sangeeta") sat with a stale LMS lead number for days because nobody's tab happened to sit open
-- long enough after her contract synced — the matching logic itself was confirmed correct (see
-- src/lib/studio/lmsRelink.js), this was purely an availability gap.
--
-- pg_cron and pg_net are already enabled on this project (migration 031's attendance auto-close).
-- This migration schedules BOTH the LMS sync and the relink pass server-side, independent of any
-- browser tab:
--   - lms-sync:   hourly at :05  -> POST {op:"sync"} to the existing `lms` Edge Function
--   - lms-relink: hourly at :15 (10 min after the sync, every time) -> POST to the new `lms-relink`
--                 Edge Function, which reads client_ledger/event_orders/lms_contracts/lms_decor_leads
--                 and writes corrections via the compare-and-set RPCs below.
--
-- Relink runs ONCE per sync, not twice (e.g. also at :45), on purpose: the canary's
-- knownMissingVerifiedIds persistence (lms_relink_runs.newly_missing_verified_ids) means a run against
-- the SAME un-refreshed LMS data as the run before it would treat that run's own trip as "already
-- known" and stop protecting against it — a second run between syncs would silently run fresh
-- phone+date relinks against data already known to be incomplete.
--
-- The browser-triggered syncs in StudioApp.jsx/IMS.jsx are left as-is (harmless, keep the Calendar
-- fresh on demand); the browser-side RELINK effect is deleted entirely (see StudioApp.jsx) — the
-- compare-and-set RPCs make a double-write harmless, but keeping two independent canary memories
-- (one per browser's localStorage, one here) would make the canary's trip behavior inconsistent.

-- ── a) Run-log table: observability + the canary's persisted "already seen missing" state ──
-- Server-side cron has no console to tail, so every run's full result is written here instead of
-- just console.log. `newly_missing_verified_ids` on the latest run that reached planning doubles as
-- next run's `knownMissingVerifiedIds` — no separate state table needed.
create table if not exists public.lms_relink_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',   -- running | ok | partial | tripped | error
  trip_reason text,
  error text,
  lms_synced_at timestamptz,
  clients_scanned int,
  decor_contracts int,
  decor_leads int,
  event_orders_scanned int,
  relinked jsonb,
  reapplied jsonb,
  verified jsonb,
  cas_missed jsonb,
  eo_patched jsonb,
  eo_missed jsonb,
  skipped jsonb,
  eo_skipped jsonb,
  errors jsonb,
  withheld jsonb,
  newly_missing_verified_ids jsonb
);

create index if not exists idx_lms_relink_runs_started on public.lms_relink_runs (started_at desc);

alter table public.lms_relink_runs enable row level security;
-- No policies — only service_role (which bypasses RLS) and the SQL editor (as postgres) ever touch
-- this table. anon/authenticated get nothing, same posture as canva_integration's own run-state table.
revoke all on public.lms_relink_runs from anon, authenticated;
grant select, insert, update, delete on public.lms_relink_runs to service_role;
grant usage, select on sequence public.lms_relink_runs_id_seq to service_role;

-- Prune old run rows daily — this is a log, not a ledger.
do $$
begin
  perform cron.unschedule('lms-relink-runs-prune');
exception
  when others then null;
end $$;
select cron.schedule('lms-relink-runs-prune', '30 3 * * *',
  $$delete from public.lms_relink_runs where started_at < now() - interval '60 days'$$);

-- ── b) service_role needs to call the existing compare-and-set RPCs (migration 055) ──
-- Supabase's default privileges likely already grant this, but an explicit grant costs nothing and
-- removes the doubt. anon never needed these (055 just never revoked it — tightened here to match
-- 048's posture on every other RPC; harmless since these are security invoker and RLS already blocks
-- anon, but explicit is better than implicit).
grant execute on function public.patch_client_ledger_lms(text, text, jsonb) to service_role;
grant execute on function public.patch_event_order_lms(text, text, jsonb) to service_role;
revoke execute on function public.patch_client_ledger_lms(text, text, jsonb) from anon;
revoke execute on function public.patch_event_order_lms(text, text, jsonb) from anon;

-- ── c) Trigger functions: read secrets from Vault, POST to the Edge Functions via pg_net ──
-- Run as the calling role (security invoker, the default) — cron and the SQL editor both run as
-- `postgres`, which can read Vault. Not callable by anon/authenticated: these fire HTTP requests
-- using secrets this project doesn't want any login-gated client able to trigger at will.
create or replace function public.trigger_lms_relink()
returns bigint
language plpgsql
as $$
declare
  v_url text;
  v_anon text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ambria_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'ambria_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lms_relink_cron_secret';
  if v_url is null then raise exception 'vault secret ambria_project_url is not set'; end if;
  if v_anon is null then raise exception 'vault secret ambria_anon_key is not set'; end if;
  if v_secret is null then raise exception 'vault secret lms_relink_cron_secret is not set'; end if;

  select net.http_post(
    url := v_url || '/functions/v1/lms-relink',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'apikey', v_anon,
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.trigger_lms_sync()
returns bigint
language plpgsql
as $$
declare
  v_url text;
  v_anon text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ambria_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'ambria_anon_key';
  if v_url is null then raise exception 'vault secret ambria_project_url is not set'; end if;
  if v_anon is null then raise exception 'vault secret ambria_anon_key is not set'; end if;

  select net.http_post(
    url := v_url || '/functions/v1/lms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'apikey', v_anon
    ),
    body := '{"op":"sync"}'::jsonb,
    timeout_milliseconds := 300000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.trigger_lms_relink() from public, anon, authenticated;
revoke execute on function public.trigger_lms_sync() from public, anon, authenticated;

-- ── d) Schedules — guarded unschedule-then-schedule so re-running this migration is safe ──
do $$
begin
  perform cron.unschedule('lms-sync');
exception
  when others then null;
end $$;
select cron.schedule('lms-sync', '5 * * * *', 'select public.trigger_lms_sync();');

do $$
begin
  perform cron.unschedule('lms-relink');
exception
  when others then null;
end $$;
select cron.schedule('lms-relink', '15 * * * *', 'select public.trigger_lms_relink();');

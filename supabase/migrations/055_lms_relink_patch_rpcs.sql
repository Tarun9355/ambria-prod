-- ═══ LMS LEAD → CONTRACT AUTO-RELINK: compare-and-set patch RPCs ═══
-- A Studio deal's client_ledger.lmsLeadId (carried onto event_orders.data.lmsLeadId on push) is set
-- once, when someone loads the deal from an LMS decor LEAD — but LMS assigns a DIFFERENT entry
-- number once that lead converts into a signed decor CONTRACT, and nothing ever re-syncs the id.
-- Ambria Ops' expense system (src/lib/ims/opsExpenses.js) is keyed by the CONTRACT number, so a deal
-- still holding its lead-stage id never surfaces its real on-site expenses in IMS Dept Ops' Actuals
-- tab — confirmed live for a real booked deal ("Sangeeta": client_ledger held lead #01488, Ambria Ops
-- only knew it as contract #00477).
--
-- src/lib/studio/lmsRelink.js finds these corrections (matched on phone + function date, never on
-- name alone) and writes them back from Studio, the only place client_ledger lives. Two tabs can
-- independently detect the same correction (this check runs on an interval, in every open tab), so
-- the write must be compare-and-set, not a blind update: each patch only applies if the row's
-- lmsLeadId still equals what the planner read it as (p_expect) — if another tab already wrote it
-- first, this one finds nothing to do and returns false, and the realtime echo carries the new value
-- to it instead of two tabs racing to write the same correction twice.
--
-- security invoker (the default — not specified here) means these run as the calling authenticated
-- user, subject to the same RLS as a normal UPDATE (047/048's ambria_authenticated_all: full access,
-- login-gated). Granted to `authenticated` only, matching 048's tightening of every other RPC here
-- (merge_client_ledger_rows/merge_settings_json) — anon gets nothing.

create or replace function public.patch_client_ledger_lms(p_id text, p_expect text, p_patch jsonb)
returns boolean
language plpgsql
as $$
declare v_rows integer;
begin
  update public.client_ledger
  set data = coalesce(data, '{}'::jsonb) || p_patch,
      updated_at = now()
  where id = p_id
    and (data->>'lmsLeadId') is not distinct from p_expect;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.patch_event_order_lms(p_id text, p_expect text, p_patch jsonb)
returns boolean
language plpgsql
as $$
declare v_rows integer;
begin
  update public.event_orders
  set data = coalesce(data, '{}'::jsonb) || p_patch,
      updated_at = now()
  where id = p_id
    and (data->>'lmsLeadId') is not distinct from p_expect;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.patch_client_ledger_lms(text, text, jsonb) to authenticated;
grant execute on function public.patch_event_order_lms(text, text, jsonb) to authenticated;

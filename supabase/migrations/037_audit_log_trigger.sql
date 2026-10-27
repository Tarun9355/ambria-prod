-- Wire up the audit_log table (001) that has existed since the very first migration but was never
-- actually populated by anything — a DB trigger writing it was always the intent (see 024's own
-- comment: "that one is for row-level before/after diffs written by DB triggers"), it just never got
-- built. This is exactly the capability that would have let the venues commission/outdoor-type data
-- (036) be recovered instead of needing to be re-entered by hand: a row-level before/after trail,
-- independent of whatever the app's own current-state tables say right now.
--
-- One generic trigger function, attached to every table in this app that holds current-state
-- business data. Deliberately NOT attached to tables that are already an append-only log of events
-- rather than current state (audit_log itself, user_actions, batch_tag_log, tag_corrections,
-- photo_corrections, studio_sessions) — overwriting a log row isn't the failure mode this protects
-- against, and auditing a log of audits is just noise.
--
-- No user attribution: this app has no Supabase Auth session (019), every request uses the same
-- anon key, so there is no per-request identity a DB trigger can read. user_name is left NULL here;
-- attributing a change to a person would need the app itself to pass who's acting on every write,
-- which it does not do today. The old_data/new_data/when trail is the win — recoverability doesn't
-- need who, only what and when.
create or replace function public.audit_row_change()
returns trigger as $$
declare
  rid text;
begin
  rid := coalesce(
    (to_jsonb(coalesce(new, old)) ->> 'id'),
    (to_jsonb(coalesce(new, old)) ->> 'key'),
    (to_jsonb(coalesce(new, old)) ->> 'date')
  );
  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (
    TG_TABLE_NAME,
    rid,
    TG_OP,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$ language plpgsql;

do $$
declare
  t text;
  tables text[] := array[
    'inventory', 'mandi_flowers', 'flower_patterns', 'projects', 'functions', 'event_orders',
    'users', 'vendors', 'purchase_orders', 'supervisors', 'production_requests', 'overheads',
    'categories', 'settings', 'blocks', 'truss_inventory', 'truss_allocations', 'boxes',
    'studio_events', 'rate_card', 'rate_card_categories', 'library', 'templates', 'client_ledger',
    'venues', 'labours', 'labour_attendance', 'labour_punch_access', 'attendance',
    'lms_contracts', 'lms_decor_leads', 'canva_integration', 'video_tags'
  ];
begin
  foreach t in array tables loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('drop trigger if exists audit_row_change_trg on public.%I', t);
      execute format(
        'create trigger audit_row_change_trg after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
        t
      );
    end if;
  end loop;
end $$;

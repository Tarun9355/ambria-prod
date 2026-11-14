-- audit_log grew to ~8.4 GB (of an 11 GB disk) because 037's trigger writes the FULL old row AND
-- the FULL new row as JSONB on every single UPDATE, and nothing ever deleted anything. Tables with
-- big JSONB documents (client_ledger deal blobs, *_allocations, ...) are re-saved constantly, so
-- each small save copied the whole document twice into audit_log.
--
-- Nothing in the app reads audit_log (it's a manual recovery trail queried from the SQL editor).
--
--   a) UPDATE now stores only the columns that actually changed (old value in old_data, new value in
--      new_data) instead of the whole row. INSERT and DELETE still store the full row — the
--      recovery-critical case (a deleted row must be restorable in full).
--   b) An UPDATE where nothing but updated_at changed (a no-op re-save) writes nothing at all.
--   c) History is NOT deleted by age. The only pruning rule (owner's call): a deal that was SOLD
--      (client_ledger.status = 'booked') more than 30 days ago keeps just its last 5 saved sessions
--      (studio_sessions) and its last 5 audit_log entries; everything older for that deal goes.
--      Unsold deals, recently sold deals and every other table keep their full history.
--      The sold build itself is safe regardless — it is pinned in client_ledger.data.finalSession.

-- ── a + b) diff-only audit trigger ───────────────────────────────────────────────────────────
create or replace function public.audit_row_change()
returns trigger as $$
declare
  rid    text;
  old_j  jsonb;
  new_j  jsonb;
  old_d  jsonb;
  new_d  jsonb;
begin
  old_j := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j := case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) end;

  rid := coalesce(
    coalesce(new_j, old_j) ->> 'id',
    coalesce(new_j, old_j) ->> 'key',
    coalesce(new_j, old_j) ->> 'date'
  );

  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(n.key, old_j -> n.key),
           jsonb_object_agg(n.key, n.value)
      into old_d, new_d
      from jsonb_each(new_j) n
     where n.value is distinct from old_j -> n.key
       and n.key not in ('updated_at', 'synced_at');

    -- Nothing but a timestamp changed: not worth a row.
    if new_d is null then
      return new;
    end if;
  else
    old_d := old_j;
    new_d := new_j;
  end if;

  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (TG_TABLE_NAME, rid, TG_OP, old_d, new_d);

  return coalesce(new, old);
end;
$$ language plpgsql;

-- lms_contracts / lms_decor_leads are a MIRROR of the external LMS, re-pulled wholesale by every
-- sync (each sync re-upserts every contract with a fresh synced_at). Their source of truth is the
-- LMS itself and they can always be re-synced, so a row-level trail of them is pure cost: ~1.9 GB
-- of audit_log (1.1M rows) was nothing but these. Stop auditing them.
drop trigger if exists audit_row_change_trg on public.lms_contracts;
drop trigger if exists audit_row_change_trg on public.lms_decor_leads;

-- One-time compaction of EXISTING history (the trigger change above only affects new rows): turn
-- each old full-copy UPDATE entry into the same changed-columns-only shape, in place. No history is
-- lost — every value that changed is still there, old and new. An entry where nothing but a
-- timestamp changed carries no information and is removed. Works in id batches so no single
-- statement runs long; returns the last id it handled (null when there's nothing left).
create or replace function public.compact_audit_log(after_id bigint default 0, batch int default 20000)
returns bigint
language plpgsql
as $$
declare
  last_id bigint;
begin
  select max(id) into last_id
    from (select id from public.audit_log where id > after_id order by id limit batch) b;
  if last_id is null then
    return null;
  end if;

  with d as (
    select a.id,
           jsonb_object_agg(k.key, a.old_data -> k.key) filter (where k.key is not null) as o,
           jsonb_object_agg(k.key, k.value)             filter (where k.key is not null) as n
      from public.audit_log a
      left join lateral (
        select e.key, e.value from jsonb_each(a.new_data) e
         where e.value is distinct from a.old_data -> e.key
           and e.key not in ('updated_at', 'synced_at')
      ) k on true
     where a.id > after_id and a.id <= last_id
       and a.action = 'UPDATE' and a.old_data is not null and a.new_data is not null
     group by a.id
  ),
  gone as (
    delete from public.audit_log a using d where a.id = d.id and d.n is null returning 1
  )
  update public.audit_log a
     set old_data = d.o, new_data = d.n
    from d
   where a.id = d.id and d.n is not null;

  return last_id;
end;
$$;

-- Lookups by (table, row) newest-first — what the prune below and any manual recovery query do.
create index if not exists audit_log_table_row_idx on public.audit_log (table_name, row_id, created_at desc);

-- ── c) sold-deal pruning ─────────────────────────────────────────────────────────────────────
-- bookedAt is epoch ms inside client_ledger.data (set by Studio when the deal is marked booked).
create or replace function public.prune_sold_deal_history(keep_n int default 5, sold_days int default 30)
returns table (sessions_deleted bigint, audit_deleted bigint)
language plpgsql
as $$
declare
  s_del bigint := 0;
  a_del bigint := 0;
begin
  create temp table _old_sold on commit drop as
    select id
      from public.client_ledger
     where status = 'booked'
       and (data ->> 'bookedAt') ~ '^\d+$'
       and to_timestamp((data ->> 'bookedAt')::bigint / 1000.0) < now() - make_interval(days => sold_days);

  -- studio_sessions: one "session" = all rows sharing a session_id; keep the newest keep_n per deal.
  with ranked as (
    select client_id, session_id,
           row_number() over (partition by client_id order by max(saved_at) desc) as rn
      from public.studio_sessions
     where client_id in (select id from _old_sold)
     group by client_id, session_id
  )
  delete from public.studio_sessions s
   using ranked r
   where r.client_id = s.client_id and r.session_id = s.session_id and r.rn > keep_n;
  get diagnostics s_del = row_count;

  -- audit_log: the deal's own row history; keep the newest keep_n entries.
  with ranked as (
    select id, row_number() over (partition by row_id order by created_at desc, id desc) as rn
      from public.audit_log
     where table_name = 'client_ledger'
       and row_id in (select id from _old_sold)
  )
  delete from public.audit_log a
   using ranked r
   where a.id = r.id and r.rn > keep_n;
  get diagnostics a_del = row_count;

  return query select s_del, a_del;
end;
$$;

do $$
begin
  perform cron.unschedule('audit-log-prune');          -- an earlier draft of this file scheduled this
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('prune-sold-deal-history');
exception when others then null;
end $$;
select cron.schedule('prune-sold-deal-history', '45 3 * * *',
  $$select public.prune_sold_deal_history()$$);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL STEPS — run in the SQL editor after the above, one at a time, at a quiet hour.
--
-- 1) First pass of the sold-deal rule (the cron then keeps it up daily):
--      select * from public.prune_sold_deal_history();
--
-- 1b) LMS mirror history (re-syncable from the LMS, ~1.9 GB) — owner's call, needs a yes first:
--      delete from public.audit_log where table_name in ('lms_contracts', 'lms_decor_leads');
--
-- 1c) Compact the rest to changed-columns-only. Start at 0, then re-run with the number each call
--     returns, until it returns null:
--      select public.compact_audit_log(0);
--      select public.compact_audit_log(<returned id>);   -- repeat
--
-- 2) truss_audit / platform_audit / batta_audit: IMS re-wrote one 'promote-soft-to-hard' row per
--    date on EVERY page load (bug fixed in IMS.jsx / lib/ims/allocPromote.js). Those repeats carry
--    no information — keep only the newest one per date; overrides and backfill rows are untouched:
--      delete from public.truss_audit t using (
--        select id, row_number() over (partition by data->>'date' order by id desc) rn
--          from public.truss_audit where data->>'event' = 'promote-soft-to-hard') x
--       where t.id = x.id and x.rn > 1;
--    (same statement with platform_audit and batta_audit)
--
-- 3) DELETE does not give disk back by itself — rewrite the tables (locks each while it runs):
--      vacuum full public.audit_log;
--      vacuum full public.studio_sessions;
--      vacuum full public.truss_audit;
--      vacuum full public.platform_audit;
--      vacuum full public.batta_audit;
-- ─────────────────────────────────────────────────────────────────────────────────────────────

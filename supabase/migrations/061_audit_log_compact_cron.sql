-- Run 060's compact_audit_log() in the background instead of by hand. From the SQL editor even one
-- 100k-row call hit the dashboard's upstream timeout (client_ledger audit rows are ~45 KB each, so a
-- batch rewrites a lot of JSONB). pg_cron has no such HTTP timeout: every minute this does small
-- batches for ~45 s, saves where it got to, and unschedules itself once the whole table is done.
-- Each run is its own transaction, so a failed run loses nothing but that minute's batch.

create table if not exists public.audit_compact_progress (
  id      int primary key default 1 check (id = 1),
  last_id bigint not null default 0,
  done    boolean not null default false,
  updated_at timestamptz default now()
);
insert into public.audit_compact_progress (id) values (1) on conflict (id) do nothing;
revoke all on public.audit_compact_progress from anon, authenticated;

create or replace function public.compact_audit_log_step()
returns void
language plpgsql
as $$
declare
  cur     bigint;
  nxt     bigint;
  started timestamptz := clock_timestamp();
begin
  select last_id into cur from public.audit_compact_progress where id = 1 and not done;
  if cur is null then
    return;
  end if;

  loop
    nxt := public.compact_audit_log(cur, 2000);
    if nxt is null then
      update public.audit_compact_progress set done = true, updated_at = now() where id = 1;
      perform cron.unschedule('compact-audit-log');
      -- Hand the space back automatically: VACUUM FULL locks audit_log (every audited save waits),
      -- so it runs at 03:00 IST. It must be a cron command of its own (VACUUM can't run inside a
      -- function/transaction). A second job removes both once a vacuum run has succeeded — and does
      -- nothing before that, so it can't cancel the vacuum if this finishes late in the evening.
      perform cron.schedule('vacuum-audit-log', '30 21 * * *', 'vacuum full public.audit_log');
      perform cron.schedule('vacuum-audit-log-cleanup', '0 23 * * *', $c$
        do $d$ begin
          if exists (select 1 from cron.job_run_details d join cron.job j using (jobid)
                      where j.jobname = 'vacuum-audit-log' and d.status = 'succeeded') then
            execute 'alter role postgres reset statement_timeout';
            perform cron.unschedule('vacuum-audit-log');
            perform cron.unschedule('vacuum-audit-log-cleanup');
          end if;
        end $d$;
      $c$);
      return;
    end if;
    cur := nxt;
    update public.audit_compact_progress set last_id = cur, updated_at = now() where id = 1;
    exit when clock_timestamp() > started + interval '45 seconds';
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('compact-audit-log');
exception when others then null;
end $$;
select cron.schedule('compact-audit-log', '* * * * *', $$select public.compact_audit_log_step()$$);

-- NOTE (applied by hand 2026-11-13): pg_cron jobs inherit the server's default 2-min
-- statement_timeout, which a VACUUM FULL of the multi-GB audit_log can't finish inside. So, for the
-- one night it runs:  alter role postgres set statement_timeout = 0;
-- and the cleanup job above resets it once a vacuum run has succeeded. (The dashboard SQL editor
-- sets its own 58 s per session, so it is unaffected either way.)

-- Progress (run any time):
--   select p.*, (select max(id) from public.audit_log) as max_id from public.audit_compact_progress p;
-- done = true  → finished; then  vacuum full public.audit_log;  to hand the space back.

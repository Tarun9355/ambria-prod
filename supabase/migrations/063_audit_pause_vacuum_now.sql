-- Run the audit_log VACUUM FULL at night (03:00 IST) without blocking saves.
--
-- VACUUM FULL holds an exclusive lock on audit_log for its whole run, and every audited table's
-- trigger (037/060) INSERTs into audit_log — so during the vacuum every save would queue behind it
-- and fail at the app roles' 8 s lock/statement timeout. A one-row `audit_pause` flag makes the
-- trigger skip writing while it's set: saves go through normally, only that window's row history
-- isn't recorded.
--
-- Fully automatic once run (all times IST):
--   02:55  audit-pause-start  sets the pause flag
--   03:00  vacuum-audit-log   VACUUM FULL (postgres role's statement_timeout lifted — pg_cron
--                             otherwise inherits the server's 2-min default, which killed a run)
--   every 5 min  vacuum-audit-log-cleanup:
--          vacuum SUCCEEDED → un-pause, reset the timeout, remove all three jobs (done for good)
--          vacuum FAILED after the pause was set → un-pause only; auditing resumes for the day and
--          the whole thing retries the next night.
-- So auditing is never left paused through a working day.

create table if not exists public.audit_pause (
  id        int primary key default 1 check (id = 1),
  paused_at timestamptz not null default now()
);
-- The trigger runs as the calling app role, so it must be able to READ the flag — but never set or
-- clear it (that would let any client switch auditing off). RLS with a read-only policy; the cron
-- jobs run as postgres, the table owner, which RLS doesn't apply to.
alter table public.audit_pause enable row level security;
drop policy if exists audit_pause_read on public.audit_pause;
create policy audit_pause_read on public.audit_pause for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.audit_pause from anon, authenticated;
grant select on public.audit_pause to anon, authenticated;

-- Same as 060's diff-only trigger, plus the pause check at the top.
create or replace function public.audit_row_change()
returns trigger as $$
declare
  rid    text;
  old_j  jsonb;
  new_j  jsonb;
  old_d  jsonb;
  new_d  jsonb;
begin
  if exists (select 1 from public.audit_pause) then
    return coalesce(new, old);
  end if;

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

alter role postgres set statement_timeout = 0;

-- Not paused during the day — the 02:55 job sets it. (Also clears it if an earlier draft of this
-- file, which paused immediately, was already run.)
delete from public.audit_pause;

do $$
begin
  perform cron.unschedule('audit-pause-start');
exception when others then null;
end $$;
select cron.schedule('audit-pause-start', '25 21 * * *',
  $$insert into public.audit_pause (id, paused_at) values (1, now())
      on conflict (id) do update set paused_at = now()$$);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'vacuum-audit-log'),
  schedule := '30 21 * * *');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'vacuum-audit-log-cleanup'),
  schedule := '*/5 * * * *',
  command := $c$
    do $d$
    declare
      p timestamptz := (select paused_at from public.audit_pause);
    begin
      if exists (select 1 from cron.job_run_details d join cron.job j using (jobid)
                  where j.jobname = 'vacuum-audit-log' and d.status = 'succeeded') then
        delete from public.audit_pause;
        execute 'alter role postgres reset statement_timeout';
        perform cron.unschedule('audit-pause-start');
        perform cron.unschedule('vacuum-audit-log');
        perform cron.unschedule('vacuum-audit-log-cleanup');
      elsif p is not null and exists (
              select 1 from cron.job_run_details d join cron.job j using (jobid)
               where j.jobname = 'vacuum-audit-log' and d.status = 'failed' and d.start_time > p) then
        delete from public.audit_pause;
      end if;
    end $d$;
  $c$);

-- Check (next morning):
--   select (select count(*) from public.audit_pause) as paused,
--          (select string_agg(jobname, ', ') from cron.job
--            where jobname in ('audit-pause-start','vacuum-audit-log','vacuum-audit-log-cleanup')) as jobs_left,
--          pg_size_pretty(pg_database_size(current_database())) as db_size;
-- Done when paused = 0 and jobs_left is null.

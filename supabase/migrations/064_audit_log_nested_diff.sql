-- 060's diff is per COLUMN. client_ledger and event_orders keep the whole deal in one JSONB column
-- (`data`, `items`, ...), so any small edit still counted as "data changed" and stored the whole
-- ~45 KB document twice. After 060/061 those two were still 2.7 GB + 1.55 GB of the 5.5 GB audit_log.
--
-- This diffs INSIDE JSON objects, recursively: only the leaf keys that actually changed are stored
-- (old value in old_data, new value in new_data, at the same nested path). Arrays and scalars are
-- compared as a whole. A key that was added/removed shows as JSON null on the side where it was
-- absent. Nothing that changed is lost — it's the same history, without the unchanged bulk.
--
--   a) jsonb_diff_pair(old, new) → [old_part, new_part], or NULL when equal.
--   b) The audit trigger uses it for every UPDATE (keeps 063's pause check).
--   c) Existing UPDATE rows are re-compacted the same way, in the background, ONLY between
--      00:30 and 05:30 IST (the daytime run in 061 used up the disk-IO burst budget and slowed the
--      app). When it finishes it arms the same night-time pause + VACUUM FULL + cleanup chain as
--      063, so disk space comes back automatically the next 03:00 IST.

-- ── a) recursive JSON diff ──────────────────────────────────────────────────────────────────
create or replace function public.jsonb_diff_pair(o jsonb, n jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  k  text;
  d  jsonb;
  od jsonb := '{}'::jsonb;
  nd jsonb := '{}'::jsonb;
begin
  if o is not distinct from n then
    return null;
  end if;
  if jsonb_typeof(o) = 'object' and jsonb_typeof(n) = 'object' then
    for k in select jsonb_object_keys(o) union select jsonb_object_keys(n) loop
      d := public.jsonb_diff_pair(o -> k, n -> k);
      if d is not null then
        od := od || jsonb_build_object(k, d -> 0);
        nd := nd || jsonb_build_object(k, d -> 1);
      end if;
    end loop;
    return jsonb_build_array(od, nd);
  end if;
  return jsonb_build_array(o, n);
end;
$$;

-- ── b) trigger ───────────────────────────────────────────────────────────────────────────────
create or replace function public.audit_row_change()
returns trigger as $$
declare
  rid    text;
  old_j  jsonb;
  new_j  jsonb;
  d      jsonb;
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
    d := public.jsonb_diff_pair(old_j - 'updated_at' - 'synced_at',
                                new_j - 'updated_at' - 'synced_at');
    if d is null then
      return new;   -- nothing but a timestamp changed
    end if;
    old_d := d -> 0;
    new_d := d -> 1;
  else
    old_d := old_j;
    new_d := new_j;
  end if;

  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (TG_TABLE_NAME, rid, TG_OP, old_d, new_d);

  return coalesce(new, old);
end;
$$ language plpgsql;

-- ── c) re-compact existing history ───────────────────────────────────────────────────────────
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
           public.jsonb_diff_pair(a.old_data - 'updated_at' - 'synced_at',
                                  a.new_data - 'updated_at' - 'synced_at') as p
      from public.audit_log a
     where a.id > after_id and a.id <= last_id
       and a.action = 'UPDATE' and a.old_data is not null and a.new_data is not null
  ),
  gone as (
    delete from public.audit_log a using d where a.id = d.id and d.p is null returning 1
  )
  update public.audit_log a
     set old_data = d.p -> 0, new_data = d.p -> 1
    from d
   where a.id = d.id and d.p is not null
     and (a.old_data is distinct from d.p -> 0 or a.new_data is distinct from d.p -> 1);

  return last_id;
end;
$$;

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

      -- Arm 063's night chain: pause 02:55 IST, VACUUM FULL 03:00 IST, cleanup every 5 min.
      execute 'alter role postgres set statement_timeout = 0';
      perform cron.schedule('audit-pause-start', '25 21 * * *',
        $j$insert into public.audit_pause (id, paused_at) values (1, now())
             on conflict (id) do update set paused_at = now()$j$);
      perform cron.schedule('vacuum-audit-log', '30 21 * * *', 'vacuum full public.audit_log');
      perform cron.schedule('vacuum-audit-log-cleanup', '*/5 * * * *', $c$
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
      return;
    end if;
    cur := nxt;
    update public.audit_compact_progress set last_id = cur, updated_at = now() where id = 1;
    exit when clock_timestamp() > started + interval '45 seconds';
  end loop;
end;
$$;

-- Start over from the first row with the deeper diff.
update public.audit_compact_progress set last_id = 0, done = false, updated_at = now() where id = 1;

do $$
begin
  perform cron.unschedule('compact-audit-log');
exception when others then null;
end $$;
-- Every minute from 19:00 to 23:59 UTC = 00:30 to 05:29 IST only.
select cron.schedule('compact-audit-log', '* 19-23 * * *', $$select public.compact_audit_log_step()$$);

-- Check (mornings):
--   select p.done, p.last_id, (select max(id) from public.audit_log) as max_id,
--          (select string_agg(jobname, ', ') from cron.job
--            where jobname in ('compact-audit-log','audit-pause-start','vacuum-audit-log','vacuum-audit-log-cleanup')) as jobs,
--          pg_size_pretty(pg_database_size(current_database())) as db_size
--     from public.audit_compact_progress p;
-- Finished when done = true and jobs is null.

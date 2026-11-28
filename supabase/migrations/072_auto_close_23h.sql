-- Auto-close threshold raised from 18 hours to 23 hours (owner ask 2026-11-28).
-- 18h was closing crews who worked a genuine long day (set-up on an event night, breakdown the
-- morning after) as system-forced outs; 23h keeps the "never-punched-out" safety net but lets
-- real shifts land honestly. 18→23 only — still shorter than 24h so a next-day in can't
-- accidentally come BEFORE the auto-out and reverse the row order.
--
-- Staff + Labour: both functions are CREATE OR REPLACE from migrations 031 / 033, same body
-- except for the hours interval. Cron schedule stays at every 30 minutes (fine-grained against
-- a 23h threshold, light on the database).

CREATE OR REPLACE FUNCTION public.auto_close_stale_punches()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  closed_count int;
BEGIN
  WITH last_punch AS (
    SELECT DISTINCT ON (user_id, date) id, user_id, user_name, date, at, type
    FROM public.attendance
    ORDER BY user_id, date, at DESC
  ),
  to_close AS (
    SELECT * FROM last_punch
    WHERE type = 'in' AND at < now() - interval '23 hours'
  ),
  inserted AS (
    INSERT INTO public.attendance (id, user_id, user_name, type, at, date, photo, verified, quiz_passed, quiz_answers, auto_closed)
    SELECT
      'autoclose_' || id, user_id, user_name, 'out', at + interval '23 hours', date,
      NULL, false, NULL, NULL, true
    FROM to_close
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM inserted;

  RETURN closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_close_stale_labour_punches()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  closed_count int;
BEGIN
  WITH last_punch AS (
    SELECT DISTINCT ON (labour_id, date) id, labour_id, labour_name, department, date, at, type
    FROM public.labour_attendance
    ORDER BY labour_id, date, at DESC
  ),
  to_close AS (
    SELECT * FROM last_punch WHERE type = 'in' AND at < now() - interval '23 hours'
  ),
  inserted AS (
    INSERT INTO public.labour_attendance (id, labour_id, labour_name, department, type, at, date, verified, auto_closed)
    SELECT 'autoclose_' || id, labour_id, labour_name, department, 'out', at + interval '23 hours', date, false, true
    FROM to_close
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM inserted;
  RETURN closed_count;
END;
$$;

-- ═══ AUTO-CLOSE A FORGOTTEN PUNCH-OUT ═══
-- If someone punches in and never punches out, they'd otherwise show "still in" forever — this
-- runs on a schedule (via pg_cron, below) and closes any punch-in older than 18 hours with a
-- synthetic punch-out, so a forgotten tap doesn't quietly distort everyone's hours and status
-- indefinitely. Pure SQL, not an Edge Function: the whole rule ("is the latest punch an 'in'
-- older than 18h") is answerable from the table itself, so there's nothing an Edge Function would
-- add except an HTTP hop. pg_cron and pg_net are already enabled on this project (left over from
-- the removed nightly batch-tagger — see supabase/config.toml's note on that).

-- Distinguishes a system-forced close from a real punch-out everywhere the app reads this table
-- (Today's list, My Attendance's day detail, the admin staff log) — it should never look like the
-- person actually walked up and tapped out.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.auto_close_stale_punches()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  closed_count int;
BEGIN
  -- `date` on the synthetic row matches the ORIGINAL punch-in's date, not whatever calendar day
  -- 18 hours later lands on — the day's punch list is grouped by this field, and a mismatched
  -- date would show that day as still "never punched out" while a stray 'out' with no 'in'
  -- appeared on the next one. `at` stays the real timestamp, so hours-worked math (which sums
  -- real in→out durations) still reports the true ~18h span honestly.
  WITH last_punch AS (
    SELECT DISTINCT ON (user_id, date) id, user_id, user_name, date, at, type
    FROM public.attendance
    ORDER BY user_id, date, at DESC
  ),
  to_close AS (
    SELECT * FROM last_punch
    WHERE type = 'in' AND at < now() - interval '18 hours'
  ),
  inserted AS (
    INSERT INTO public.attendance (id, user_id, user_name, type, at, date, photo, verified, quiz_passed, quiz_answers, auto_closed)
    SELECT
      'autoclose_' || id, user_id, user_name, 'out', at + interval '18 hours', date,
      NULL, false, NULL, NULL, true
    FROM to_close
    -- Idempotent: a re-run (e.g. two overlapping cron ticks) can't double-close the same punch.
    -- The WHERE above already excludes it too, once its own 'out' becomes the latest row, but
    -- this is the backstop for the brief window before that's true.
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM inserted;

  RETURN closed_count;
END;
$$;

-- Anon/authenticated never need to call this directly (only pg_cron does, as the table owner) —
-- no grant to anon/authenticated, unlike the rest of this file's tables.

-- Every 30 minutes: fine-grained enough against an 18-hour threshold, and light on the database.
-- Guarded unschedule-then-schedule so re-running this migration doesn't create a second job.
DO $$
BEGIN
  PERFORM cron.unschedule('attendance-auto-close');
EXCEPTION
  WHEN OTHERS THEN NULL; -- no such job yet on a first run
END $$;

SELECT cron.schedule('attendance-auto-close', '*/30 * * * *', 'SELECT public.auto_close_stale_punches();');

-- ═══ LABOUR (GROUP) PUNCH ═══
-- Labours don't log in. A supervisor/guard who has been given access punches them in and out from
-- their own phone — one photo per labour, then the punch is saved (no briefing video / quiz).
--
-- Kept OUT of `attendance` on purpose: that table's user_id is a NOT NULL FK to users, and
-- auto_close_stale_punches() groups by user_id — a labour row there would either need a fake user
-- or a NULL user_id that the auto-close would lump every labour into. Three small tables instead:
--
--   labours              — the roster (name, phone, department). Soft-deleted via `active`.
--   labour_attendance    — append-only punch events, same shape as `attendance` + who punched.
--   labour_punch_access  — which user may punch which department's labours. Granted by
--                          Admin only, from Attendance → Labour Punch.

CREATE TABLE IF NOT EXISTS public.labours (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  department  TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT REFERENCES public.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labours_dept_idx ON public.labours (department, active);

CREATE TABLE IF NOT EXISTS public.labour_attendance (
  id               TEXT PRIMARY KEY,
  labour_id        TEXT NOT NULL REFERENCES public.labours(id),
  labour_name      TEXT,            -- denormalized, same habit as attendance.user_name
  department       TEXT,
  type             TEXT NOT NULL CHECK (type IN ('in', 'out')),
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  date             TEXT NOT NULL,   -- business-local work day (todayStr), like attendance.date
  photo            TEXT,
  verified         BOOLEAN NOT NULL DEFAULT false,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  location_name    TEXT,
  punched_by       TEXT REFERENCES public.users(id),
  punched_by_name  TEXT,
  auto_closed      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labour_attendance_labour_date_idx ON public.labour_attendance (labour_id, date, at);
CREATE INDEX IF NOT EXISTS labour_attendance_date_dept_idx ON public.labour_attendance (date, department);

CREATE TABLE IF NOT EXISTS public.labour_punch_access (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES public.users(id),
  department  TEXT NOT NULL,
  granted_by  TEXT REFERENCES public.users(id),
  granted_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, department)
);

-- Same open policy every other app table uses (the app talks to Supabase with the anon key only).
ALTER TABLE public.labours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.labours;
CREATE POLICY ambria_anon_all ON public.labours FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.labour_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.labour_attendance;
CREATE POLICY ambria_anon_all ON public.labour_attendance FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.labour_punch_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ambria_anon_all ON public.labour_punch_access;
CREATE POLICY ambria_anon_all ON public.labour_punch_access FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.labours;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.labour_attendance;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.labour_punch_access;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;

-- Forgotten punch-outs close themselves after 18h — the same rule (and the same cron cadence)
-- 031_attendance_auto_close.sql applies to staff, so a labour left "in" doesn't stay in forever.
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
    SELECT * FROM last_punch WHERE type = 'in' AND at < now() - interval '18 hours'
  ),
  inserted AS (
    INSERT INTO public.labour_attendance (id, labour_id, labour_name, department, type, at, date, verified, auto_closed)
    SELECT 'autoclose_' || id, labour_id, labour_name, department, 'out', at + interval '18 hours', date, false, true
    FROM to_close
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM inserted;
  RETURN closed_count;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('labour-attendance-auto-close');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('labour-attendance-auto-close', '*/30 * * * *', 'SELECT public.auto_close_stale_labour_punches();');

-- Make the API (PostgREST) pick up the new tables immediately — without this the app can keep
-- saying "Could not find the table … in the schema cache" for a while after they exist.
NOTIFY pgrst, 'reload schema';

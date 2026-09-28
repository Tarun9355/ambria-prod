-- ═══ PUNCH LOCATION ═══
-- Where a punch actually happened. `location_name` is resolved client-side against
-- settings.attendanceLocations (an admin-editable list of {name, lat, lng} — see
-- AttendanceTab.jsx's "📍 Manage Locations" panel) — within PUNCH_LOCATION_RADIUS_M (lib/ims/
-- attendance.js — 300m as of this writing, changed once after this migration shipped) of a named
-- location, that location's name is stored; otherwise `location_name` stays NULL ("Unknown
-- location" in the UI) but `lat`/`lng` are still saved, so an out-of-range punch is never silently
-- unlogged. The radius itself is client-side only — nothing here to re-run when it changes.
--
-- Known locations are settings, not a table: there's no per-row relationship to query, just an
-- admin-edited list read whole every time, the same shape attendanceTrainingByDept already uses.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location_name TEXT;

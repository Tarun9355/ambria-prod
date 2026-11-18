-- Site supervisors fixed at venues (owner ask 2026-11-18): Admin → Settings → 👷 Supervisors lets each supervisor be fixed at one
-- or more Ambria properties (Manaktala, Exotica, Pushpanjali…). Stored as the properties' ids from the `venues` table (kind
-- 'property'), so a renamed property stays linked. A proper column on the supervisor's own row, not a settings blob.

ALTER TABLE public.supervisors ADD COLUMN IF NOT EXISTS fixed_venues TEXT[] NOT NULL DEFAULT '{}';

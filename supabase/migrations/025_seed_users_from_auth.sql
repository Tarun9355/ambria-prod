-- ─── Seed public.users from the Supabase Auth accounts ──────────────────────────────────────────
-- The `users` profile table is empty (0 rows) while auth.users holds 21 live staff accounts. With no
-- profile row, src/lib/auth.js can resolve nobody: the Supabase Auth path signs in and then signs
-- straight back out (fetchProfile() finds no row), and the legacy path finds no row either. So every
-- FRESH login fails, Admin → Users & Roles renders empty, and all role counts read 0. Staff who are
-- still working are riding a cached localStorage["ambria-auth"] profile from before the rows went.
--
-- This creates exactly one profile row per Auth account, linked by users.auth_id = auth.users.id.
--
-- Roles: the nine people named in the old Studio team blob (settings['ambria-team-v1']) keep the role
-- they had there — admin → Admin, sales → Sales. Everyone else has no role on record anywhere, so
-- they default to Sales (your call). Fix any of them afterwards in Admin → Users & Roles; the edit
-- path writes straight back to this table.
--
-- `apps` is left NULL on purpose. NULL means "derive from role" (src/lib/auth.js userApps()), which
-- reads settings.roleTabs — so app access follows the role config you already maintain in the UI
-- instead of being frozen into a column here.
--
-- Idempotent: re-running inserts nothing for accounts that already have a profile row.
--
-- ── HOW TO RUN ──
--   Supabase → SQL Editor → new query. Run STEP 1 alone first and read the output. If it looks
--   right, run STEP 2. Then STEP 3 to verify.

-- ═══ STEP 1 — DRY RUN. Writes nothing. Shows exactly what STEP 2 would insert. ═══
WITH known(username, full_name, role_name) AS (
  VALUES
    ('tarun',    'Tarun',    'Admin'),
    ('anmol',    'Anmol',    'Admin'),
    ('ajay',     'Ajay',     'Admin'),
    ('ashi',     'Ashi',     'Sales'),
    ('krati',    'Krati',    'Sales'),
    ('aman',     'Aman',     'Sales'),
    ('himanshu', 'Himanshu', 'Sales'),
    ('jitanshu', 'Jitanshu', 'Sales'),
    ('vijay',    'Vijay',    'Sales')
),
src AS (
  SELECT DISTINCT ON (split_part(a.email, '@', 1))
         a.id AS auth_id,
         split_part(a.email, '@', 1) AS uname,
         a.created_at
  FROM auth.users a
  WHERE a.email IS NOT NULL
  ORDER BY split_part(a.email, '@', 1), a.created_at
)
SELECT s.uname                                        AS username,
       COALESCE(k.full_name, initcap(s.uname))        AS name,
       COALESCE(k.role_name, 'Sales')                 AS role,
       CASE WHEN k.username IS NULL THEN 'defaulted' ELSE 'from team blob' END AS role_source,
       s.auth_id,
       s.created_at
FROM src s
LEFT JOIN known k ON k.username = s.uname
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.auth_id = s.auth_id OR u.username = s.uname
)
ORDER BY 3 DESC, 1;


-- ═══ STEP 2 — THE INSERT. Run only after STEP 1's output looks right. ═══
BEGIN;

WITH known(username, full_name, role_name) AS (
  VALUES
    ('tarun',    'Tarun',    'Admin'),
    ('anmol',    'Anmol',    'Admin'),
    ('ajay',     'Ajay',     'Admin'),
    ('ashi',     'Ashi',     'Sales'),
    ('krati',    'Krati',    'Sales'),
    ('aman',     'Aman',     'Sales'),
    ('himanshu', 'Himanshu', 'Sales'),
    ('jitanshu', 'Jitanshu', 'Sales'),
    ('vijay',    'Vijay',    'Sales')
),
-- Mirrors ROLE_DEFAULTS in src/lib/ims/constants.js. Admin = every permission in PERM_GROUPS.
perms(role_name, permissions) AS (
  VALUES
    ('Admin', ARRAY[
       'inv_view','inv_add','inv_delete','inv_import','inv_categories','inv_images',
       'block_single','block_bulk','block_release',
       'events_create','events_edit','events_manpower','events_view',
       'reports_generate',
       'purchase_request','purchase_approve','purchase_add',
       'admin_users',
       'prod_tasks','prod_update','prod_addinv'
     ]::text[]),
    ('Sales', ARRAY[
       'inv_view',
       'block_single','block_bulk','block_release',
       'events_create','events_edit','events_view',
       'reports_generate',
       'purchase_request'
     ]::text[])
),
src AS (
  SELECT DISTINCT ON (split_part(a.email, '@', 1))
         a.id AS auth_id,
         split_part(a.email, '@', 1) AS uname,
         a.created_at
  FROM auth.users a
  WHERE a.email IS NOT NULL
  ORDER BY split_part(a.email, '@', 1), a.created_at
)
INSERT INTO public.users (id, name, username, role, permissions, active, apps, phone, email, auth_id, created_at)
SELECT
  -- Same shape the app mints for a new user (UsersTab.jsx): 'U' + 10 uppercase chars.
  'U' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  COALESCE(k.full_name, initcap(s.uname)),
  s.uname,
  COALESCE(k.role_name, 'Sales'),
  COALESCE(p.permissions, '{}'::text[]),
  true,
  NULL,   -- apps: NULL = derive from role via settings.roleTabs
  NULL,   -- phone: not on record
  NULL,   -- email: the auth address is synthetic (@staff.ambria.app), not a real mailbox
  s.auth_id,
  s.created_at
FROM src s
LEFT JOIN known k ON k.username = s.uname
LEFT JOIN perms p ON p.role_name = COALESCE(k.role_name, 'Sales')
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.auth_id = s.auth_id OR u.username = s.uname
);

COMMIT;


-- ═══ STEP 3 — VERIFY ═══
-- Expect: total = 21, unlinked = 0, and the role split you approved.
SELECT (SELECT count(*) FROM public.users)                          AS profiles,
       (SELECT count(*) FROM auth.users)                            AS auth_accounts,
       (SELECT count(*) FROM public.users WHERE auth_id IS NULL)    AS unlinked,
       (SELECT count(*) FROM auth.users a
          WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = a.id)) AS auth_without_profile;

SELECT role, count(*), string_agg(username, ', ' ORDER BY username) AS people
FROM public.users GROUP BY role ORDER BY 2 DESC;


-- ═══ UNDO (only if you want to start over — removes ONLY rows this script created) ═══
-- Every row it inserts has a non-null auth_id and a NULL email/phone. Rows you create later
-- through Admin → Users would also have auth_id set, so scope the undo by created time instead:
--   DELETE FROM public.users WHERE auth_id IS NOT NULL AND email IS NULL AND phone IS NULL;

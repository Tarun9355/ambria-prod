-- Per-user department access (Furniture/Floral/Structure/Tenting/Transport/Lighting/Fabric).
-- Optional, same convention as apps (003_user_apps.sql): NULL/empty until set, and the client
-- (userDepartments in src/lib/ims/deptClassify.js) falls back to inferring one department from
-- the role name (e.g. "Dept Head - Lighting" -> Lighting), same as Dept Ops already did before
-- this column existed. Set this explicitly only to grant a user MORE than their role's one
-- inferred department, or to scope a role that doesn't name a department.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS departments text[] DEFAULT NULL;

-- Example: grant a user both Lighting and Fabric
--   UPDATE public.users SET departments = ARRAY['Lighting','Fabric'] WHERE username = 'someuser';

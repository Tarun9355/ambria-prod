-- Per-user app access (Studio / IMS). Optional: until set, app access is derived
-- from role (Admin → both, Sales → studio, others → ims) by the client.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS apps text[] DEFAULT NULL;

-- Example: grant a user both apps
--   UPDATE public.users SET apps = ARRAY['studio','ims'] WHERE username = 'tarun';

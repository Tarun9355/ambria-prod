-- photo_corrections (017) was locked to `TO authenticated` only, copying the tag_corrections
-- pattern — but unlike tag_corrections/library/settings, that restriction is actually being
-- enforced here, and the app talks to Supabase with the plain anon key (no forced Supabase Auth
-- login — see CLAUDE.md). Match the access level every other table this feature touches already
-- has, so the anon key can read back what it just wrote.
DROP POLICY IF EXISTS ambria_authenticated_all ON public.photo_corrections;
CREATE POLICY ambria_anon_all ON public.photo_corrections FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

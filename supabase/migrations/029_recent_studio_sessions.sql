-- ═══ RECENT STUDIO SESSIONS (per-client, capped) ═══
-- loadSessionRows() used to `select *` the WHOLE studio_sessions table, unconditionally, on
-- every app mount — harmless while the table was small, but studio_sessions never deletes rows
-- (a deliberate tradeoff — see StudioApp.jsx's saveSession comment on the collapse-destroys-work
-- incident), so it only ever grows. At 87 clients it had already reached 22,329 rows (~256
-- sessions per client) and was the single slowest thing a fresh page load waited on — even
-- though the app only ever KEEPS the most recent SESSION_KEEP (10) sessions per client anyway
-- (rowsToSessions caps it client-side, AFTER downloading everything). This does that same
-- capping server-side, so a normal page load only ever transfers what it was always going to
-- keep, not the client's entire history. The full history remains in the table either way
-- (nothing here deletes anything) — it's just no longer downloaded on every load; a direct SQL
-- query is still the way to reach an older row, same as the "pratik test" recovery this followed.
--
-- Keeps whole SESSIONS (every one of a session's fn_idx rows travels together), ranked by that
-- session's own most recent saved_at across its rows — matching rowsToSessions's own semantics
-- (newest session first, by its latest-saved row) so the app sees exactly the same shape it
-- always has, just without the extra 22,000+ rows it was throwing away client-side.
create or replace function public.recent_studio_sessions(keep_per_client int default 10)
returns setof public.studio_sessions
language sql
stable
as $$
  select s.*
  from public.studio_sessions s
  join (
    select client_id, session_id,
           row_number() over (partition by client_id order by max(saved_at) desc) as rn
    from public.studio_sessions
    group by client_id, session_id
  ) ranked
    on ranked.client_id = s.client_id and ranked.session_id = s.session_id
  where ranked.rn <= keep_per_client
  order by s.client_id, s.session_id, s.fn_idx;
$$;

-- Same anon-key access as the table itself (see 026_studio_sessions.sql) — the app has no forced
-- Supabase Auth login, so restricting this to `authenticated` would lock it out of its own data.
grant execute on function public.recent_studio_sessions(int) to anon, authenticated;

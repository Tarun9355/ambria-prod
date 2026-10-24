-- ═══ CLIENT_LEDGER BOOT-LOAD WEIGHT ═══
-- loadClientRows() does `select *` on EVERY mount, unconditionally, for every client that has ever
-- existed — the same pattern 029's comment already flagged for studio_sessions, here one table over.
-- At 192 clients the table is 13MB; six keys inside `data` account for over half of that, and they're
-- all Deal Check's own draft state (or, for finalSession, a frozen COPY of data that already lives
-- permanently in studio_sessions since migration 026):
--
--   dcDraft              3.39 MB across 69 of 192 clients (36% — everyone else pays for data they
--   dcCards              3.00 MB   don't have, every single load)
--   dcZoneState          83 KB
--   dcKitEdits           31 KB
--   dcReservedInventory  31 KB
--   finalSession         999 KB across all 192 — a booking-time snapshot, already duplicated in
--                         studio_sessions (c.sessions?.[0] frozen at the moment of booking)
--
-- None of these six are needed to list/search clients, open Build, or resume a session — only Deal
-- Check itself reads dcDraft/dcCards/dcZoneState/dcKitEdits/dcReservedInventory, and only a booked
-- deal's own locked-in figures read finalSession. Both are fetched lazily now, once, when a client
-- actually becomes the active one (see loadClientSession in StudioApp.jsx) — everything else about a
-- client keeps working exactly as it always has, since by the time anything reads these fields the
-- lazy fetch has already merged them into the in-memory client object.
create or replace view public.client_ledger_light as
select
  id, name, phone, email, status, budget, created_by, updated_at,
  (data - 'dcDraft' - 'dcCards' - 'dcZoneState' - 'dcKitEdits' - 'dcReservedInventory' - 'finalSession') as data
from public.client_ledger;

grant select on public.client_ledger_light to anon, authenticated;

-- ═══ THE SAFETY NET THAT MAKES LAZY LOADING SAFE ═══
-- Every existing save path (doSaveClient in StudioEventInfo.jsx, Browse's booking/un-booking, Deal
-- Check's own autosave, and others) builds its write by spreading the CURRENT in-memory client object
-- and changing only the fields it owns — relying on every other field riding across untouched. That
-- was always true before, because every client's `data` was fully loaded at boot. It stops being true
-- the moment loadClientRows() starts reading from client_ledger_light instead: a client whose
-- dcDraft/dcCards were never lazy-fetched (because Deal Check was never opened for them this session)
-- has no copy of those keys in memory at all, so a plain `.upsert()` of that client's row would
-- overwrite `data` with a value that's missing them — silently deleting a real Deal Check draft the
-- very next time someone renames that client or edits their event date.
--
-- This function is the fix: every client_ledger write goes through it instead of a bare upsert, and
-- it merges the incoming `data` into whatever's already on the row (shallow, top-level) rather than
-- replacing it outright. A key the caller's payload doesn't mention — because it was never loaded —
-- survives. A key the payload DOES mention (a real edit) still overwrites its own value normally.
create or replace function public.merge_client_ledger_rows(p_rows jsonb)
returns void
language plpgsql
as $$
declare r jsonb;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.client_ledger (id, name, phone, email, status, budget, created_by, data, updated_at)
    values (
      r->>'id', r->>'name', r->>'phone', r->>'email', r->>'status',
      nullif(r->>'budget', '')::numeric, r->>'created_by',
      coalesce(r->'data', '{}'::jsonb),
      coalesce((r->>'updated_at')::timestamptz, now())
    )
    on conflict (id) do update set
      name       = excluded.name,
      phone      = excluded.phone,
      email      = excluded.email,
      status     = excluded.status,
      budget     = excluded.budget,
      created_by = excluded.created_by,
      data       = coalesce(public.client_ledger.data, '{}'::jsonb) || excluded.data,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

grant execute on function public.merge_client_ledger_rows(jsonb) to anon, authenticated;

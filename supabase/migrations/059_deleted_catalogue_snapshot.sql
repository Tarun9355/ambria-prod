-- ═══ DELETED-CATALOGUE SNAPSHOT: KEEP LAST PRICE, WARN IN BUILD, NEVER BLOCK THE DELETE ═══
-- Deleting a catalogue row in IMS — an inventory item, a flower recipe, a carpet/print material, a
-- platform height — silently prices any LIVE Studio quote still referencing it at ₹0. Confirmed
-- real: a salesperson's Build card for a now-deleted inventory item reads getElPriceFromInventory's
-- `if (!item) return { unitPrice: 0, ... }` (StudioApp.jsx), same shape for a deleted flower_patterns
-- row through getElPriceFromPattern, and same for carpet/print/platform through carpetPricingFor/
-- the print lookup/platformRateFor (lib/studio/taxonomy.js) once the id no longer resolves anywhere.
-- AdminSettingsTab.jsx's own carpet/print/platform delete-confirm dialogs currently CLAIM otherwise
-- ("Zones already using this carpet keep their current price — it just stops being offered.") — that
-- claim is false today; this migration (plus the Studio-side changes alongside it) makes it true.
--
-- The repo owner was asked directly and chose: keep the last known price, show a ⚠ warning in
-- Studio Build, never block the deletion itself. (Deal Check — Ambria's own internal cost side — is
-- explicitly out of scope; a client-facing quote is the thing that must never silently read ₹0.)
--
-- Why a trigger, not an app-level check (same reasoning as 057/058): it catches every deletion path,
-- including a direct delete from the Supabase SQL editor, not just whichever IMS tab's confirm
-- dialog happens to run today.
--
-- Why NOT soft-delete (the alternative considered and rejected): (1) it can't recover quotes already
-- broken by a PAST deletion — those rows are already gone, a soft-delete flag going forward does
-- nothing for them; this migration's backfill (part a) fixes those retroactively, which soft-delete
-- never could. (2) the blast radius of filtering a soft-deleted row out of every "pick a new item"
-- list across Studio/IMS (~18 files: pickers, search boxes, kit editors, recipe editors, choices
-- lists…) is large and easy to get subtly wrong — missing even one leaves a "deleted" item still
-- pickable. A snapshot table consulted only as a FALLBACK (live rows always win) is a much smaller,
-- additive surface.
--
-- Deliberately NOT attached to `mandi_flowers` or `masking_rates` — their "cost drops when the row
-- is deleted" behavior is already deliberate/honest (a mandi flower's price is always "today's
-- market price", never a frozen historical one; masking was never reported as a real bug) and is
-- explicitly out of scope for this fix.
--
-- ── Dry-run: every row this migration's backfill (part a, below) will recover from audit_log ──
-- select distinct on (a.table_name, a.row_id)
--        a.table_name, a.row_id, a.old_data->>'name', a.created_at
-- from public.audit_log a
-- where a.action = 'DELETE'
--   and a.table_name in ('inventory','flower_patterns','carpet_materials','print_materials','platform_rates')
--   and a.old_data is not null
--   and coalesce(a.row_id, '') <> ''
--   and not (a.table_name = 'inventory' and exists (select 1 from public.inventory t where t.id = a.row_id))
--   and not (a.table_name = 'flower_patterns' and exists (select 1 from public.flower_patterns t where t.id = a.row_id))
--   and not (a.table_name = 'carpet_materials' and exists (select 1 from public.carpet_materials t where t.id = a.row_id))
--   and not (a.table_name = 'print_materials' and exists (select 1 from public.print_materials t where t.id = a.row_id))
--   and not (a.table_name = 'platform_rates' and exists (select 1 from public.platform_rates t where t.key = a.row_id))
-- order by a.table_name, a.row_id, a.created_at desc;

-- ═══ Table: one row per deleted catalogue row, across all five tables ═══
create table if not exists public.deleted_catalogue (
  id             text primary key,       -- source_table || ':' || item_id (fetchAll sorts by id past 1000 rows)
  source_table   text not null,          -- inventory | flower_patterns | carpet_materials | print_materials | platform_rates
  item_id        text not null,          -- old.id, or old.key for platform_rates specifically
  name           text,                   -- copied from the row, for SQL readability only
  data           jsonb not null,         -- to_jsonb(old) — the full row, as it was the moment it was deleted
  deleted_at     timestamptz not null default now(),
  unique (source_table, item_id)
);

-- ── Trigger function: snapshot the deleted row before it's gone ──
-- Not security definer — runs as whatever role performed the delete, same as every other trigger
-- function in this app (audit_row_change above included).
create or replace function public.snapshot_deleted_catalogue_row()
returns trigger
language plpgsql
as $$
declare
  rid text;
  rname text;
begin
  rid := coalesce(to_jsonb(old) ->> 'id', to_jsonb(old) ->> 'key');
  rname := to_jsonb(old) ->> 'name';
  insert into public.deleted_catalogue (id, source_table, item_id, name, data, deleted_at)
  values (TG_TABLE_NAME || ':' || rid, TG_TABLE_NAME, rid, rname, to_jsonb(old), now())
  on conflict (id) do update
    set name = excluded.name, data = excluded.data, deleted_at = excluded.deleted_at;
  return old;
end;
$$;

-- One trigger per table, same function — idempotent (drop-then-create, matching 057/058's pattern).
-- Note: TRUNCATE fires no row-level trigger at all (a Postgres limitation, not a gap in this
-- migration) — acceptable, nobody truncates these tables.
do $$
declare t text;
begin
  foreach t in array array['inventory', 'flower_patterns', 'carpet_materials', 'print_materials', 'platform_rates'] loop
    execute format('drop trigger if exists snapshot_deleted_catalogue_trg on public.%I', t);
    execute format(
      'create trigger snapshot_deleted_catalogue_trg after delete on public.%I for each row execute function public.snapshot_deleted_catalogue_row()',
      t
    );
  end loop;
end $$;

-- RLS — same `ambria_authenticated_all` convention as every table since 048.
alter table public.deleted_catalogue enable row level security;
drop policy if exists ambria_authenticated_all on public.deleted_catalogue;
create policy ambria_authenticated_all on public.deleted_catalogue for all to authenticated using (true) with check (true);

-- Realtime — same idempotent add-to-publication pattern as 052.
do $$
begin
  alter publication supabase_realtime add table public.deleted_catalogue;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- No audit_log trigger on this table: it IS a log itself (same reasoning 037 used to leave
-- audit_log, user_actions, batch_tag_log, etc. out of its own tables[] array) — this migration
-- simply never adds `deleted_catalogue` to that array, which is sufficient; 037's trigger is only
-- ever attached to a table explicitly listed there.

-- ═══ a) Backfill: recover every already-broken quote's last known rate from audit_log ═══
-- Run the dry-run SELECT above first. This INSERT re-derives the exact same rows (same filter,
-- same "exclude anything live again" guard per table) and feeds them into deleted_catalogue.
-- ON CONFLICT DO NOTHING — safe to re-run; a real future deletion's own trigger-written row (more
-- current than anything audit_log can offer) is never overwritten by this backfill.
--
-- Coverage limits, stated honestly: inventory/flower_patterns are recoverable back to whenever
-- migration 037 (audit_log) first ran, since both were already real tables with an audit trigger
-- from that point on. carpet_materials/print_materials/platform_rates are recoverable only back to
-- migration 043 (when they became real tables with their own audit trigger) — any deletion before
-- that, from the old settings-blob era, left no audit_log row at all and cannot be recovered by
-- this or any other migration.
insert into public.deleted_catalogue (id, source_table, item_id, name, data, deleted_at)
select distinct on (a.table_name, a.row_id)
       a.table_name || ':' || a.row_id, a.table_name, a.row_id, a.old_data->>'name', a.old_data, a.created_at
from public.audit_log a
where a.action = 'DELETE'
  and a.table_name in ('inventory','flower_patterns','carpet_materials','print_materials','platform_rates')
  and a.old_data is not null
  and coalesce(a.row_id, '') <> ''
  and not (a.table_name = 'inventory' and exists (select 1 from public.inventory t where t.id = a.row_id))
  and not (a.table_name = 'flower_patterns' and exists (select 1 from public.flower_patterns t where t.id = a.row_id))
  and not (a.table_name = 'carpet_materials' and exists (select 1 from public.carpet_materials t where t.id = a.row_id))
  and not (a.table_name = 'print_materials' and exists (select 1 from public.print_materials t where t.id = a.row_id))
  and not (a.table_name = 'platform_rates' and exists (select 1 from public.platform_rates t where t.key = a.row_id))
order by a.table_name, a.row_id, a.created_at desc
on conflict (id) do nothing;

-- 051: every inventory item starts with "Can be made in production" and "Paintable" OFF (owner ask 2026-10-31).
-- Many items were marked as makeable or paintable by default (a new item's production box came pre-ticked, and an item
-- with no paint flag was treated as paintable because of its category), so items that cannot be made or painted could
-- be booked against production or offered for paint. Department heads now turn each flag on, item by item, in
-- IMS -> Inventory -> edit item.
--
-- Both flags live in inventory.flags (jsonb): canBeMade, paintable. Only those two keys are written - every other flag
-- and column is left as it is.
--
-- The values before this change are kept in inventory_flags_backup_051, so a department head's earlier choices can be
-- looked up (or restored) later. Safe to run more than once: the backup is taken only the first time.

create table if not exists public.inventory_flags_backup_051 (
  id          text primary key,
  can_be_made jsonb,
  paintable   jsonb,
  backed_up_at timestamptz not null default now()
);
alter table public.inventory_flags_backup_051 enable row level security;

insert into public.inventory_flags_backup_051 (id, can_be_made, paintable)
select id::text, flags -> 'canBeMade', flags -> 'paintable'
from public.inventory
on conflict (id) do nothing;

update public.inventory
set flags = coalesce(flags, '{}'::jsonb) || '{"canBeMade": false, "paintable": false}'::jsonb
where coalesce(flags -> 'canBeMade', 'null'::jsonb) <> 'false'::jsonb
   or coalesce(flags -> 'paintable', 'null'::jsonb) <> 'false'::jsonb;

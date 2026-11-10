-- Per-user tab/sub-tab/Edit-Delete override (IMS → Admin → Users & Roles → Edit User → Permissions
-- → "Override for this user"). Layered on top of a role's own settings.roleTabs config
-- (lib/ims/tabAccess.js) — a key present here overrides that one field for just this one person;
-- an absent key inherits the role's value, same as the pre-existing `permissions` column already
-- works for the flat Actions list.
--
-- Safe to run more than once.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tab_override JSONB;

-- Safe shallow-merge write for the `settings` table's JSONB `value` column, keyed by `key`.
-- Used first by IMS.jsx's LMS auto-category sync (datePricing.autoCategories) so that write can
-- ONLY ever touch the keys named in p_patch — never the rest of whatever's stored under that
-- settings key (datePricing.markedDates, autoSyncPaused, autoSyncLockCode, categories, etc.) —
-- regardless of how stale the writing tab's own local snapshot of the row is. The plain
-- `.upsert({key, value})` every other settings write still uses replaces the WHOLE value, which is
-- exactly what let a background tab's routine auto-sync silently wipe a manually-set date-pricing
-- override set moments earlier in a different tab (confirmed live, 2026-10-25).
create or replace function merge_settings_json(p_key text, p_patch jsonb)
returns void
language sql
as $$
  insert into settings (key, value)
  values (p_key, p_patch)
  on conflict (key) do update
  set value = coalesce(settings.value, '{}'::jsonb) || excluded.value;
$$;

grant execute on function merge_settings_json(text, jsonb) to anon, authenticated;

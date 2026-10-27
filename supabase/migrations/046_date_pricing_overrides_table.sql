-- Date Pricing Overrides: one row per manually-marked calendar date, carved out of
-- datePricing.markedDates — a sub-field of the single `datePricing` settings key — into its own
-- table (CLAUDE.md rule 1: row-level updates only).
--
-- UNLIKE every other migration in this series, datePricing's whole-blob-clobber risk was already
-- closed — not by a table, but by a server-side shallow JSONB merge RPC (merge_settings_json,
-- IMS.jsx's mergeDatePricing), shipped to fix a confirmed live bug (a King's-date multiplier
-- silently reverting because one stale tab's routine autoCategories refresh re-saved its own
-- outdated copy of the WHOLE datePricing object, markedDates included). That RPC already makes a
-- write here "PHYSICALLY only ever touch the key(s) named in the patch" — see IMS.jsx's own
-- extensive comment on mergeDatePricing for the full story.
--
-- This migration is owner-requested structural completeness on top of that, not a risk fix:
-- markedDates is an unbounded, ever-growing date -> category map (one entry per date anyone has
-- ever manually overridden), which is a genuine case for a real table even though nothing was
-- actually broken. `categories`/`autoCategories`/`autoSyncPaused`/`autoSyncLockCode` stay exactly
-- where they are, under the `datePricing` settings key, protected by merge_settings_json as before —
-- they're tightly-coupled structural config (3 fixed category slots, a sync flag, a lock code), not
-- "many independent entities," so they're not a good fit for a table the way markedDates is.
create table if not exists public.date_pricing_overrides (
  date_str    text primary key,
  category    text not null,
  updated_at  timestamptz default now()
);

drop trigger if exists set_timestamp on public.date_pricing_overrides;
create trigger set_timestamp before update on public.date_pricing_overrides
  for each row execute function update_timestamp();

alter table public.date_pricing_overrides enable row level security;
drop policy if exists ambria_anon_all on public.date_pricing_overrides;
create policy ambria_anon_all on public.date_pricing_overrides for all to anon, authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.date_pricing_overrides;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

drop trigger if exists audit_row_change_trg on public.date_pricing_overrides;
create trigger audit_row_change_trg after insert or update or delete on public.date_pricing_overrides
  for each row execute function public.audit_row_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL from datePricing.markedDates — one-time, idempotent (ON CONFLICT DO NOTHING). Same
-- JSONB-string unwrap every prior blob migration needed, plus one more unwrap: datePricing itself
-- is a nested object inside the unwrapped settings value, and markedDates is nested inside THAT.
-- ═══════════════════════════════════════════════════════════════════════════
with raw as (
  select (s.value #>> '{}')::jsonb -> 'markedDates' as v from public.settings s where s.key = 'datePricing'
)
insert into public.date_pricing_overrides (date_str, category)
select kv.key, kv.value #>> '{}'
from raw, jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as kv
where kv.key <> '' and coalesce(kv.value #>> '{}', '') <> ''
on conflict (date_str) do nothing;

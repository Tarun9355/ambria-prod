# SQL & Ops to run (Ambria rebuild)

Collected commands to run in the **Supabase SQL Editor** (and CLI) — batched so you can
run them in one sitting. Items are ordered; safe to re-run (idempotent).

> Status legend: ⬜ = pending you to run · ✅ = confirmed already run

---

## 1. Base schema (migration 001) — ✅ already run
`supabase/migrations/001_initial_schema.sql` (25 tables). Confirmed live (inventory,
users, vendors, etc. all responding).

## 2. Admin seed (tarun) — ✅ already run
```sql
insert into public.users (id, name, username, password, role, active)
values ('u_admin','Tarun','tarun','ambria@admin','Admin',true)
on conflict (id) do update set name=excluded.name, username=excluded.username,
  password=excluded.password, role=excluded.role, active=excluded.active;
```

## 3. LMS contract cache (migration 002) — ✅ done (verified: table live + contracts synced)
Enables instant Calendar loads (server-side LMS sync → table).
```sql
CREATE TABLE IF NOT EXISTS lms_contracts (
  id TEXT PRIMARY KEY,
  dept TEXT,
  entry_no TEXT,
  guest_name TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lms_contracts_synced ON lms_contracts (synced_at);
ALTER PUBLICATION supabase_realtime ADD TABLE lms_contracts;
```

## 4. LMS decor lead cache (migration 009) — ⬜ pending
Fixes Studio's Event Info guest search missing fresh decor LEADS (pre-contract enquiries).
Decor leads live in a different LMS list (and numbering sequence) than decor contracts —
this table is kept separate so leads never get counted into the Calendar's season/demand math.
```sql
CREATE TABLE IF NOT EXISTS lms_decor_leads (
  id TEXT PRIMARY KEY,
  entry_no TEXT,
  guest_name TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lms_decor_leads_synced ON lms_decor_leads (synced_at);
```
Then redeploy the `lms` Edge Function (op=sync now also paginates decor leads into this table)
and run a manual "🔄 Refresh" in Studio's Event Info (or wait for the 30-min auto pre-warm).

---

## Edge Functions (CLI)
- `lms` — ✅ deployed (verified live) — ⬜ needs redeploy for migration 003 (decor lead sync)
- `season` — ✅ deployed + `SEASON_EXPORT_KEY` set (verified live)
- `anthropic` — ⬜ NOT deployed. Needed for ALL AI features: Inventory photo-scan, Production
  finished-vs-reference photo comparison, and **Events → AI Scan** (Claude Vision deck → decor
  element extraction → inventory auto-match). These paths fail gracefully until it's deployed:
```bash
supabase functions deploy anthropic
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

> Note: Events also renders PPT/PDF decks to slides client-side via pdf.js (loaded from CDN at
> runtime, like the reference) — no install or SQL needed. No new tables for Phase 10/11; the
> `event_orders`, `truss_allocations`, `production_requests`, `blocks` tables are all in
> migration 001. Truss override/simulation/audit + the blocks document live as JSON blobs in
> the existing `settings` table (faithful to the reference's Redis-blob model).

## Per-user app access (migration 003) — ⬜ optional
Adds a `users.apps text[]` column so a user can be granted Studio, IMS, or both. The
in-app header switcher + route gating work WITHOUT this (access is derived from role:
Admin → both, Sales → studio, ops → ims). Run only when you want explicit per-user control:
```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS apps text[] DEFAULT NULL;
-- grant a specific user both apps:
UPDATE public.users SET apps = ARRAY['studio','ims'] WHERE username = 'tarun';
```

## Studio Rate Card seed — ✅ done (155 items; superseded, see below)
`rate_card` auto-seeds on first boot if empty (`RC_D` in `src/lib/studio/constants.js`), which also
populates IMS → Admin → Sub-Categories and Flowers → Recipes. **Ownership has since moved to IMS**
(Rate Card → IMS migration, see `RATE_CARD_MIGRATION_PLAN.md`) — item/category pricing is now edited
in **IMS → Admin → Settings → 💰 Rate Card / 📂 Sub-Categories**, not Studio's Pricing page (now
read-only).

## Rate Card → IMS migration, Phase 1 (migration 012) — ✅ done
`supabase/migrations/012_rate_card_subcategory_scaling.sql` — redefines the (previously dead)
`rate_card_categories` table as one row per sub-category with a `scaling_factor` column (103 rows
seeded), and trims whitespace drift on `rate_card.sub`. Confirmed run and working.

---

## Library → row-per-photo table migration — ⬜ RUN AFTER restoring the 29-Jun backup
The Studio library moved off the `ambria-library-v2` settings blob (whole-array saves caused mass
data loss) to the row-per-photo `library` table. The table + realtime already exist (migration 001);
this only adds a `data` JSONB catch-all for fields without typed columns (_verified, _aiTagged,
lightCount, unrecognized, etc.). Run this ONCE in the SQL editor, then tell Claude to run the backfill.
```sql
ALTER TABLE public.library ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
```
Then: (1) Claude backfills `library` rows from the restored blob, (2) Claude merges the branch to
deploy the app, (3) redeploy the tagger: `supabase functions deploy batch-tagger`.

---

## Library status/tag-source/tagged-at columns (migration 008) — ⬜ RUN THEN TELL CLAUDE TO BACKFILL
Server-side pagination for the Library browse page needs to filter/sort by verified status,
nightly-vs-manual tag source, and tagging timestamp WITHOUT unpacking the `data` JSONB blob on
every query. Adds three typed mirror columns + indexes. Run this ONCE in the SQL editor, then
tell Claude to backfill existing rows from `data`.
```sql
ALTER TABLE public.library
  ADD COLUMN IF NOT EXISTS status TEXT,       -- 'verified' | 'review' | 'untagged'
  ADD COLUMN IF NOT EXISTS tag_source TEXT,   -- 'nightly' | 'manual' | NULL
  ADD COLUMN IF NOT EXISTS tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_library_status_tagged ON public.library (status, tagged_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_library_tag_source ON public.library (tag_source);
CREATE INDEX IF NOT EXISTS idx_library_created ON public.library (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_library_tags_gin ON public.library USING GIN (tags);
```
After running: (1) Claude backfills `status`/`tag_source`/`tagged_at` for existing rows from
`data`, (2) redeploy the tagger so nightly runs keep the columns in sync:
`supabase functions deploy batch-tagger`.

---

## Appended automatically as the build proceeds
(New tables/migrations for later phases are added below as they're created.)

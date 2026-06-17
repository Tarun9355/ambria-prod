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

---

## Edge Functions (CLI)
- `lms` — ✅ deployed (verified live)
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

## Studio Rate Card seed — ⬜ (no SQL — just open the app once)
`rate_card` is empty in the DB. Open **Studio → Manage → Pricing** once; the app
auto-seeds the 60 rate items, which also populates IMS → Admin → Sub-Categories and
Flowers → Recipes.

---

## Appended automatically as the build proceeds
(New tables/migrations for later phases are added below as they're created.)

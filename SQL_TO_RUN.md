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

## 3. LMS contract cache (migration 002) — ⬜ RUN THIS
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

## Edge Functions to deploy (CLI) — ⬜
From project root, once `supabase login` + `supabase link --project-ref taalribntdkowoqltvqw` are done:
```bash
supabase functions deploy lms       # LMS proxy + server-side sync (no secret needed)
supabase functions deploy season    # season categories proxy
supabase functions deploy anthropic # AI photo-scan / element-match proxy
# secrets:
supabase secrets set SEASON_EXPORT_KEY=<your season export key>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

---

## Appended automatically as the build proceeds
(New tables/migrations for later phases are added below as they're created.)

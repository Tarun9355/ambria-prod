# Securing the database — Supabase Auth + RLS (runbook)

**Goal:** stop the public anon key (baked into the website JS) from being able to read/write the
database. We move logins to Supabase Auth (hashed passwords, real per-user sessions), then turn on
Row Level Security so only logged-in staff can reach any table.

**Safety model:** every step before Step 5 is non-disruptive. The app ships with **dual-mode login**
(tries Supabase Auth, falls back to the old check) so nothing breaks while you migrate. Step 5 (RLS)
is the only protective change, and it is **instantly reversible** (disable RLS).

Do the steps in order. Don't skip the verification queries.

---

### Step 0 — one-time: get the service-role key (kept off the website)
Supabase → Project Settings → API → copy **`service_role`** key. Add to your local `.env.local`:
```
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # NEVER commit this; never put it in the app/client
```

### Step 1 — add the link column (safe, no behaviour change)
Supabase → SQL Editor → run **`supabase/migrations/004_auth_add_authid.sql`**.

### Step 2 — create the auth accounts (safe; preserves current passwords)
From the project folder:
```
node scripts/create-auth-users.mjs
```
It creates one Supabase Auth account per staff member using their existing password and links it
(`users.auth_id`). Re-runnable. Confirm the summary shows 0 failed.

**Verify:** Supabase → SQL Editor:
```sql
SELECT count(*) FROM users WHERE active AND auth_id IS NULL;   -- expect 0
```
If not 0, those users have no password on record — set one in Admin → Users and re-run Step 2.

### Step 3 — deploy the app (already built: dual-mode login)
This is already in the codebase. With RLS still OFF, both new (Supabase Auth) and old logins work, so
this deploy changes nothing visible.

### Step 4 — everyone logs in once + verify (still no RLS)
Ask all staff to **log out and log back in** (this gives them a real Supabase session). Spot-check a
few roles (Sales / ops / Admin): open the app, load Events/Inventory/Planning, save something. All
should work exactly as before. **Do not proceed until this is confirmed** — RLS off means there's no
risk yet, so take your time here.

### Step 5 — THE CUTOVER: enable RLS (protective + reversible)
Re-confirm the verify query from Step 2 returns 0, then run **`supabase/migrations/005_auth_rls.sql`**.
This locks every table to logged-in staff and drops the plaintext `password` column.

**Immediately test:** an already-logged-in staff member should keep working; open the site in a
private window with no login — it should NOT be able to load any data.

> Cautious option: on a first run, comment out the `DROP COLUMN ... password` line in 005, verify
> logins/app for a day, then run that one line separately.

### Rollback (if any screen breaks after Step 5)
Run the ROLLBACK block at the bottom of `005_auth_rls.sql` (disables RLS on all tables) — access
returns to today's state instantly. Then tell me what broke and we fix the policy.

---

## What this gives you (Phase 1)
- The **public internet can no longer read or write** your database via the website key. ✅
- Passwords are **hashed by Supabase**, not plaintext in a readable table. ✅
- Any **logged-in** staff member can still technically reach any table via the API (the app UI gates
  what each role sees). Tightening that to per-role (e.g. Sales can't read finance) is **Phase 2** —
  a follow-up once Phase 1 is stable.

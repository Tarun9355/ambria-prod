// ─── One-time migration: create a Supabase Auth account for every staff member ───────────────────
//
// Reads the existing `users` table and, for each active user, creates a Supabase Auth account using
// the SAME password they have today (so nobody has to reset), then links it back via users.auth_id.
// Idempotent: re-running skips users that already have an auth_id, and reuses an existing auth account
// if one already exists for that email.
//
// REQUIRES THE SERVICE-ROLE KEY (admin privileges). NEVER commit it or put it in the client bundle.
// Add it to .env.local as SUPABASE_SERVICE_ROLE_KEY=... (Supabase → Project Settings → API → service_role).
//
// Run AFTER migration 002 (adds the auth_id column), BEFORE enabling RLS (003):
//   node scripts/create-auth-users.mjs
//
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Settings → API → service_role).");
  process.exit(1);
}

// Service-role client bypasses RLS — required to read passwords and call the admin API.
const admin = createClient(env.VITE_SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// MUST match usernameToEmail() in src/lib/auth.js.
const usernameToEmail = (u) => `${String(u || "").trim().toLowerCase()}@staff.ambria.app`;

const { data: users, error } = await admin.from("users").select("id, username, password, active, auth_id");
if (error) { console.error("Could not read users:", error.message); process.exit(1); }

let created = 0, linked = 0, skipped = 0, failed = 0;
for (const u of users) {
  if (!u.username) { console.warn(`- skip ${u.id}: no username`); skipped++; continue; }
  if (u.auth_id) { skipped++; continue; } // already migrated
  if (!u.password) { console.warn(`- skip ${u.username}: no password on record (set one, then re-run)`); skipped++; continue; }
  const email = usernameToEmail(u.username);

  // Create the auth account (pre-confirmed so no email is sent / required).
  let authId = null;
  const { data: made, error: cErr } = await admin.auth.admin.createUser({
    email, password: u.password, email_confirm: true,
    user_metadata: { username: u.username, app_user_id: u.id },
  });
  if (made?.user?.id) { authId = made.user.id; created++; }
  else if (cErr && /already.*registered|exists/i.test(cErr.message)) {
    // Account already exists (re-run / partial prior run) — find it and link.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const found = (list?.users || []).find((x) => (x.email || "").toLowerCase() === email);
    if (found) { authId = found.id; }
  }
  if (!authId) { console.error(`✗ ${u.username}: ${cErr?.message || "could not create/find auth user"}`); failed++; continue; }

  const { error: uErr } = await admin.from("users").update({ auth_id: authId }).eq("id", u.id);
  if (uErr) { console.error(`✗ ${u.username}: linked auth but failed to set auth_id — ${uErr.message}`); failed++; continue; }
  linked++;
  console.log(`✓ ${u.username} → ${email}`);
}

console.log(`\nDone. created ${created} · linked ${linked} · skipped ${skipped} · failed ${failed}`);
console.log("Next: have everyone log out & back in once (establishes their Supabase session), verify the app works, THEN run migration 003 to enable RLS.");
if (failed) process.exit(1);

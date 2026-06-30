// Supabase Edge Function — admin-only user management against Supabase Auth.
//
// Why this exists: passwords now live in Supabase Auth (hashed), and setting/creating them needs the
// SERVICE-ROLE key, which must never be in the browser. The client calls this function with the
// signed-in admin's access token; the function verifies the caller is an Admin, then uses the
// service role to create accounts / set passwords / delete users, keeping the `users` profile row in
// sync. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the Edge runtime.
//
// Deploy:  supabase functions deploy user-admin
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// MUST match usernameToEmail() in src/lib/auth.js and scripts/create-auth-users.mjs.
const usernameToEmail = (u: string) => `${String(u || "").trim().toLowerCase()}@staff.ambria.app`;
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Edge function not configured" }, 500);
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Verify the caller is a signed-in Admin ──
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Not authenticated" }, 401);
  const { data: { user } = {}, error: authErr } = await svc.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "Not authenticated" }, 401);
  const { data: caller } = await svc.from("users").select("role").eq("auth_id", user.id).maybeSingle();
  if (!caller || String(caller.role || "").toLowerCase() !== "admin") return json({ error: "Admins only" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { action } = body || {};

  try {
    // ── Set (or, for not-yet-migrated users, create) a password ──
    if (action === "setPassword") {
      const { userId, password } = body;
      if (!userId || !password) return json({ error: "userId and password required" }, 400);
      const { data: prof } = await svc.from("users").select("id, username, auth_id").eq("id", userId).maybeSingle();
      if (!prof) return json({ error: "User not found" }, 404);
      if (prof.auth_id) {
        const { error } = await svc.auth.admin.updateUserById(prof.auth_id, { password });
        if (error) return json({ error: error.message }, 400);
      } else {
        const { data: made, error } = await svc.auth.admin.createUser({
          email: usernameToEmail(prof.username), password, email_confirm: true,
          user_metadata: { username: prof.username, app_user_id: prof.id },
        });
        if (error || !made?.user) return json({ error: error?.message || "create failed" }, 400);
        await svc.from("users").update({ auth_id: made.user.id }).eq("id", userId);
      }
      return json({ ok: true });
    }

    // ── Create a brand-new user (auth account + profile row) ──
    if (action === "createUser") {
      const u = body.user || {};
      const password = body.password;
      if (!u.username || !password || !u.id) return json({ error: "user.id, user.username and password required" }, 400);
      const { data: made, error } = await svc.auth.admin.createUser({
        email: usernameToEmail(u.username), password, email_confirm: true,
        user_metadata: { username: u.username, app_user_id: u.id },
      });
      if (error || !made?.user) return json({ error: error?.message || "create failed" }, 400);
      const row = {
        id: u.id, name: u.name ?? null, username: u.username, role: u.role ?? "Sales",
        permissions: u.permissions || [], active: u.active ?? true, phone: u.phone ?? null,
        email: u.email ?? null, apps: u.apps ?? null, auth_id: made.user.id,
      };
      const { error: insErr } = await svc.from("users").insert(row);
      if (insErr) { await svc.auth.admin.deleteUser(made.user.id); return json({ error: insErr.message }, 400); }
      return json({ ok: true, user: row });
    }

    // ── Delete a user (auth account + profile row) ──
    if (action === "deleteUser") {
      const { userId } = body;
      if (!userId) return json({ error: "userId required" }, 400);
      const { data: prof } = await svc.from("users").select("auth_id").eq("id", userId).maybeSingle();
      if (prof?.auth_id) await svc.auth.admin.deleteUser(prof.auth_id);
      await svc.from("users").delete().eq("id", userId);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

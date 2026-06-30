import { supabase } from "./supabase";

const STORAGE_KEY = "ambria-auth";

// Staff log in with a username; Supabase Auth needs an email, so we map each username to a stable
// synthetic address. The account-creation script (scripts/create-auth-users.mjs) uses the SAME rule,
// so the two always agree. Not a real mailbox — no mail is ever sent (accounts are pre-confirmed).
export const usernameToEmail = (u) => `${String(u || "").trim().toLowerCase()}@staff.ambria.app`;

// Resolve the profile row (role, apps, name, U#### id, …) for the currently signed-in Supabase user.
// Linked via users.auth_id = auth.uid(). Returns the row WITHOUT the password column.
export async function fetchProfile() {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("*").eq("auth_id", user.id).maybeSingle();
  if (!data) return null;
  const { password: _pw, ...safe } = data;
  return safe;
}

/**
 * Authenticate a staff member.
 *
 * Dual-mode for a zero-downtime migration:
 *   1. Try Supabase Auth (the secure target — hashed passwords, real per-user JWT, RLS).
 *   2. If that fails (account not migrated yet, or RLS not yet enabled), fall back to the legacy
 *      `users`-table check so nobody is locked out mid-rollout.
 * Once every account is migrated and RLS is enabled, the legacy path simply stops working (the anon
 * key can no longer read `users`) and only Supabase Auth succeeds — the intended end state.
 */
export async function login(username, password) {
  // 1) Supabase Auth path
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (!error) {
      const profile = await fetchProfile();
      if (profile && profile.active !== false) { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); return profile; }
      await supabase.auth.signOut(); // signed in but no/inactive profile → don't leave a half-session
    }
  } catch { /* fall through to legacy */ }

  // 2) Legacy fallback (works only while RLS is still OFF; removed after cutover)
  const { data, error } = await supabase
    .from("users").select("*").eq("username", username).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!data || data.password !== password) throw new Error("Invalid username or password");
  const { password: _pw, ...safeUser } = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUser));
  return safeUser;
}

export async function logout() {
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
  localStorage.removeItem(STORAGE_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Which apps a user may access. Resolution order:
 *   1. Explicit per-user `apps` array (Admin → Users add/edit form) — wins if set.
 *   2. Per-role config `roleTabs[role]` (Admin → Users → Tab Access):
 *        IMS  if roleTabs[role].tabs is non-empty;
 *        Studio if roleTabs[role].studio.enabled.
 *      Legacy roles (no `.studio`/`.tabs` key) fall back to the role-name default.
 *   3. Role-name default: Admin → both · Sales → studio · everyone else (ops) → ims.
 */
export function userApps(user, roleTabs = {}) {
  if (!user) return [];
  if (Array.isArray(user.apps) && user.apps.length) {
    return user.apps.filter((a) => a === "studio" || a === "ims");
  }
  const role = user.role || "";
  if (role.toLowerCase() === "admin" || user.id === "u_admin") return ["studio", "ims"];
  const rc = roleTabs?.[role];
  // IMS: explicit tabs list if present, else role-name default (ops roles get IMS).
  const hasIms = rc && "tabs" in rc ? (rc.tabs || []).length > 0 : role !== "Sales";
  // Studio: granted if the role has any Studio tab configured (legacy .enabled also honored),
  // else role-name default (Sales gets Studio).
  const hasStudio = rc && rc.studio ? ((rc.studio.tabs || []).length > 0 || !!rc.studio.enabled) : role === "Sales";
  const apps = [];
  if (hasStudio) apps.push("studio");
  if (hasIms) apps.push("ims");
  return apps.length ? apps : ["ims"];
}

/** Where a given user (or none) should land — their preferred app, gated by access. */
export function landingPath(user, roleTabs = {}) {
  if (!user) return "/login";
  const apps = userApps(user, roleTabs);
  const pref = (user.role || "") === "Sales" ? "studio" : "ims";
  if (apps.includes(pref)) return "/" + pref;
  return "/" + (apps[0] || "ims");
}

import { supabase } from "./supabase";

const STORAGE_KEY = "ambria-auth";

// Staff log in with a username; Supabase Auth needs an email, so we map each username to a stable
// synthetic address. The account-creation script (scripts/create-auth-users.mjs) uses the SAME rule,
// so the two always agree. Not a real mailbox — no mail is ever sent (accounts are pre-confirmed).
export const usernameToEmail = (u) => `${String(u || "").trim().toLowerCase()}@staff.ambria.app`;

// A user row with no explicit `username` column set (legacy/never-edited accounts) logs in with
// this derived-from-name value instead — UsersTab.jsx's add/reset flows and this module's own
// self-service password change must resolve the SAME username for the SAME person, or one half
// builds the wrong synthetic email and "Current password is incorrect" fires for a correct password.
export const deriveUsername = (name) => (name || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

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
 * Authenticate a staff member via Supabase Auth — hashed password, real per-user JWT, subject to
 * RLS on every subsequent request. The old dual-mode fallback (a plaintext check against
 * `users.password`) is gone for good: that column was dropped in migration 005, so the fallback was
 * already dead code, not a live second path — removed here instead of left as a trap.
 */
export async function login(username, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) throw new Error("Invalid username or password");
  const profile = await fetchProfile();
  if (!profile || profile.active === false) {
    await supabase.auth.signOut(); // signed in but no/inactive profile → don't leave a half-session
    throw new Error("Invalid username or password");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

/**
 * Self-service password change for the CURRENTLY signed-in user — no admin/service-role call
 * needed (unlike Admin's "Reset Password" on another user's row, which goes through the
 * user-admin edge function): Supabase Auth's updateUser works directly off the live session.
 * Re-authenticates with the current password first purely as an in-app guard (an unlocked,
 * still-logged-in device left unattended shouldn't let anyone walking up change the password
 * with no check at all) — the API itself doesn't require this step.
 *
 * Reads the email straight off the live Supabase session (auth.getUser()) rather than
 * rebuilding it from the profile's username/name — review finding, 2026-11-13: rebuilding it
 * would silently reauth against a DIFFERENT account if users.username ever drifted from what's
 * actually on record in Supabase Auth (a manual DB edit, or a legacy row's username getting
 * filled in later from its name). The live session's own email can never drift from itself.
 */
export async function changeOwnPassword(currentPassword, newPassword) {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("No active session — log out and back in, then retry.");
  const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthErr) throw new Error("Current password is incorrect");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message || "Could not update password");
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

// Refresh the cached profile in place — used when a realtime update to the signed-in user's OWN
// row (role, apps, departments, permissions changed by an admin elsewhere) should stick across a
// reload without them having to log out and back in. See AuthContext's own-row subscription.
export function cacheUser(user) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); } catch { /* ignore */ }
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
  if (apps.length) return apps;
  // Nothing resolved — fall back to the role's NATURAL app, not a hard "ims".
  // (A Sales user must never get bounced into IMS-only; that left them stuck on a
  // section they can't use instead of opening Studio.)
  return role === "Sales" ? ["studio"] : ["ims"];
}

/** Where a given user (or none) should land — their preferred app, gated by access. */
export function landingPath(user, roleTabs = {}) {
  if (!user) return "/login";
  const apps = userApps(user, roleTabs);
  const pref = (user.role || "") === "Sales" ? "studio" : "ims";
  if (apps.includes(pref)) return "/" + pref;
  return "/" + (apps[0] || "ims");
}

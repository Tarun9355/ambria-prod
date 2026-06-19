import { supabase } from "./supabase";

const STORAGE_KEY = "ambria-auth";

/**
 * Authenticate against the `users` table.
 *
 * ⚠️ MVP-only: passwords are stored in plaintext and compared client-side.
 * The anon key can read the whole `users` table (no RLS). Replace with
 * Supabase Auth or hashed passwords + RLS before production.
 */
export async function login(username, password) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.password !== password) {
    throw new Error("Invalid username or password");
  }

  // Never persist the password in localStorage.
  const { password: _pw, ...safeUser } = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUser));
  return safeUser;
}

export function logout() {
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
  // Studio: explicit studio.enabled if configured, else role-name default (Sales gets Studio).
  const hasStudio = rc && rc.studio ? !!rc.studio.enabled : role === "Sales";
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

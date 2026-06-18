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
 * Which apps a user may access. Source of truth is the per-user `apps` array
 * (e.g. ["studio","ims"]), editable in Admin → Users. Until that's set we derive
 * a sensible default from role so existing users keep working:
 *   Admin → both · Sales → studio · everyone else (ops) → ims.
 */
export function userApps(user) {
  if (!user) return [];
  if (Array.isArray(user.apps) && user.apps.length) {
    return user.apps.filter((a) => a === "studio" || a === "ims");
  }
  if (user.role === "Admin" || user.id === "u_admin") return ["studio", "ims"];
  if (user.role === "Sales") return ["studio"];
  return ["ims"];
}

/** Where a given user (or none) should land — their preferred app, gated by access. */
export function landingPath(user) {
  if (!user) return "/login";
  const apps = userApps(user);
  const pref = user.role === "Sales" ? "studio" : "ims";
  if (apps.includes(pref)) return "/" + pref;
  return "/" + (apps[0] || "ims");
}

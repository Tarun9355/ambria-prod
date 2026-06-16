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

/** Where a given user (or none) should land. Sales → Studio, everyone else → IMS. */
export function landingPath(user) {
  if (!user) return "/login";
  return user.role === "Sales" ? "/studio" : "/ims";
}

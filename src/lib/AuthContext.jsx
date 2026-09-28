import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getStoredUser, login as doLogin, logout as doLogout, fetchProfile } from "./auth";
import { supabase } from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start from the cached profile (instant, no login flash). The Supabase session is then validated
  // below: a live session refreshes the profile; signing out clears it. During the migration a cached
  // legacy user (no Supabase session) still works because RLS is off until cutover.
  const [user, setUser] = useState(() => getStoredUser());

  useEffect(() => {
    let active = true;
    // Rehydrate from a live Supabase session on load (post-migration source of truth).
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data?.session) {
        const profile = await fetchProfile();
        if (active && profile) setUser(profile);
        return;
      }
      // No live Supabase session — still on the legacy cached-login path (see login() in auth.js),
      // which has nothing that re-derives this profile on its own. A cached id from before some
      // past `users` change (a reseed, an id scheme migration, the row itself being removed) would
      // otherwise sit unnoticed in localStorage indefinitely — fine for reads, since nothing here
      // enforces referential integrity, but a hard failure the moment it hits something that does
      // (a foreign key, e.g. attendance.user_id). Confirm it's still a real, active row and drop
      // the session if not, rather than let every write from a dead-end id fail one at a time.
      const cached = getStoredUser();
      if (!cached?.id) return;
      const { data: row } = await supabase.from("users").select("id, active").eq("id", cached.id).maybeSingle();
      if (active && (!row || row.active === false)) { await doLogout(); setUser(null); }
    });
    // React to auth changes (token refresh, sign-out, sign-in from another tab).
    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (!active) return;
      if (event === "SIGNED_OUT") { setUser(null); return; }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        const profile = await fetchProfile();
        if (active && profile) setUser(profile);
      }
    });
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);
  // Per-role access config (settings.roleTabs) — drives the cross-app switcher + route
  // gating so app visibility is role-driven. Loaded once when a user is present.
  const [roleTabs, setRoleTabs] = useState({});

  useEffect(() => {
    if (!user) { setRoleTabs({}); return; }
    let active = true;
    supabase.from("settings").select("value").eq("key", "roleTabs").maybeSingle().then(({ data }) => {
      if (!active) return;
      let v = data?.value;
      if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
      if (v && typeof v === "object") setRoleTabs(v);
    });
    return () => { active = false; };
  }, [user]);

  const login = useCallback(async (username, password) => {
    const account = await doLogin(username, password);
    setUser(account);
    return account;
  }, []);

  const logout = useCallback(async () => {
    await doLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, roleTabs, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

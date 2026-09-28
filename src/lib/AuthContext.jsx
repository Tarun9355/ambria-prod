import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getStoredUser, login as doLogin, logout as doLogout, fetchProfile, cacheUser } from "./auth";
import { supabase, subscribeRow } from "./supabase";

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
      if (!active || !data?.session) return;
      const profile = await fetchProfile();
      if (active && profile) setUser(profile);
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
  // Live-follow the signed-in user's OWN row, so an admin editing their role/apps/departments/
  // permissions elsewhere (Users & Roles) takes effect in THIS open tab immediately — without it,
  // a cached profile only refreshes on an explicit logout + login (via a real Supabase Auth session
  // rehydrating above), and a legacy (not-yet-migrated) account has no session to trigger that at
  // all, so it would otherwise keep whatever access it had at the moment they first logged in,
  // however out of date, until they thought to log out and back in themselves.
  useEffect(() => {
    if (!user?.id) return;
    const channel = subscribeRow("users", user.id, (payload) => {
      if (payload.eventType === "DELETE") return; // handled next time an auth check actually runs
      const row = payload.new;
      if (!row) return;
      const { password: _pw, ...safe } = row;
      setUser((prev) => {
        if (!prev || prev.id !== safe.id) return prev;
        const merged = { ...prev, ...safe };
        cacheUser(merged);
        return merged;
      });
    });
    return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
  }, [user?.id]);

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

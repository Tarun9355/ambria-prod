import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getStoredUser, login as doLogin, logout as doLogout, fetchProfile, cacheUser } from "./auth";
import { supabase, subscribeRow } from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start from the cached profile (instant, no login flash) — but it is provisional. Migration 048
  // (2026-10-27) cut the anon key off from reading ANY table: only a live Supabase Auth session
  // (the `authenticated` role) can read data now, and a row-security filter doesn't throw when it
  // blocks a read — it just returns zero rows. So a browser tab left open from before that cutover
  // (cached profile, dead/no Supabase session) used to "still work" per the old comment here; now it
  // renders the whole app normally — sidebar, tabs, everything — while every fetchAll(...) in
  // IMS.jsx/StudioApp.jsx silently comes back empty, with no error anywhere. The fix: no live
  // session means logged out, full stop — no legacy fallback left to trust.
  const [user, setUser] = useState(() => getStoredUser());

  useEffect(() => {
    let active = true;
    // Rehydrate from a live Supabase session on load (the only source of truth now).
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data?.session) {
        const profile = await fetchProfile();
        if (active && profile) setUser(profile);
        return;
      }
      // No live Supabase session — the cached profile (if any) can't actually read the database
      // post-048, so it is not a valid login anymore. Drop it and send them back to a real login
      // instead of silently rendering an app that will fetch nothing.
      if (getStoredUser()) { await doLogout(); }
      if (active) setUser(null);
    });
    // React to auth changes (token refresh, sign-out, sign-in from another tab).
    // ── NEVER AWAIT SUPABASE INSIDE THIS CALLBACK ──
    // supabase-js awaits these callbacks while it is still initialising the session, and every
    // other call (auth.getUser, and each DB query, which first asks auth for its token) waits for
    // that initialisation to finish. Awaiting fetchProfile() here therefore waited on itself: in a
    // fresh tab whose stored token had expired, the start-up refresh fired TOKEN_REFRESHED, this
    // callback blocked on getUser(), and every query in the app queued behind it — "Loading
    // Ambria IMS…" forever until a reload (by then the token was fresh, so no event fired). The
    // profile fetch is pushed out of the callback with setTimeout, as Supabase's docs prescribe.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "SIGNED_OUT") { setUser(null); return; }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setTimeout(async () => {
          const profile = await fetchProfile();
          if (active && profile) setUser(profile);
        }, 0);
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

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getStoredUser, login as doLogin, logout as doLogout } from "./auth";
import { supabase } from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
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

  const logout = useCallback(() => {
    doLogout();
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

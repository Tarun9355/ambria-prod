import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { landingPath, userApps } from "./lib/auth";
import { useVersionCheck } from "./lib/useVersionCheck";
import { flushBeforeReload } from "./lib/pendingSaveRegistry";
import { canvaHandleOAuthRedirect } from "./lib/canva";
import Login from "./pages/Login.jsx";
import Studio from "./pages/Studio.jsx";
import IMS from "./pages/ims/IMS.jsx";

// Canva's OAuth redirect lands back on the site's bare base URL with ?code=&state= — BEFORE the
// HashRouter's own #/... fragment, so it's readable/strippable here regardless of which route (or
// login state) the tab was on. One-time per redirect; the admin who clicked "Connect" in IMS →
// Admin → Settings sees the result here, then the app renders normally.
function CanvaOAuthBanner() {
  const [msg, setMsg] = useState(null); // {text, color} | null
  useEffect(() => {
    let cancelled = false;
    canvaHandleOAuthRedirect((text, color) => { if (!cancelled) setMsg({ text, color }); }).then((wasCallback) => {
      if (wasCallback) window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    });
    return () => { cancelled = true; };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] rounded-full text-white text-sm px-4 py-2 shadow-xl"
      style={{ background: msg.color === "red" ? "#DC2626" : msg.color === "green" ? "#059669" : "#374151" }}>
      {msg.text}
    </div>
  );
}

// One-click "a newer build is live" banner — so the team never has to hard-refresh manually.
function UpdateBanner() {
  const updateReady = useVersionCheck();
  const [updating, setUpdating] = useState(false);
  if (!updateReady) return null;
  // This banner sits above the router (it has to — it's shown regardless of which page is open),
  // so it can't reach into Studio's own save function directly. It used to just reload immediately:
  // Studio's autosave IS wired to fire on pagehide, but pagehide firing doesn't mean its network
  // write actually finishes — a reload can and does cancel a fetch that's still in flight, which is
  // exactly how clicking Update mid-edit lost work. flushBeforeReload asks whichever page is mounted
  // (via a small registry — see lib/pendingSaveRegistry.js) to save and AWAITS that landing before
  // reloading. A hard 4s cap means a slow network never turns "Update now" into "stuck now" — this
  // is best-effort insurance on top of autosave, not the only thing standing between the user and
  // losing work.
  const onUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    await Promise.race([
      flushBeforeReload(),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    // NOT window.location.reload(). GitHub Pages serves index.html with a ten-minute max-age, and a
    // plain reload is allowed to satisfy itself from that cache — so "Update now" could hand back the
    // very build it was offering to replace, the check would fire again, and the banner would
    // reappear. An update button that does not update is worse than no button.
    // The version check itself never had this problem because it fetches with cache:"no-store"; only
    // the reload did. A changing query string makes the document URL one the cache has never seen, so
    // the fresh index.html — and with it the new hashed bundle — is guaranteed. HashRouter reads the
    // fragment and ignores the query, so the route survives, and re-using the same key means these
    // never accumulate.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", Date.now().toString(36));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-full bg-gray-900 text-white text-sm px-4 py-2 shadow-xl">
      <span>A new version of Ambria is available.</span>
      <button
        onClick={onUpdate}
        disabled={updating}
        className="rounded-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-70 px-3 py-1 font-semibold transition"
      >
        {updating ? "Saving…" : "Update now"}
      </button>
    </div>
  );
}

function Protected({ app, children }) {
  const { user, roleTabs } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Gate by app access (role-driven, per-user override) — a user without this app is bounced.
  if (app && !userApps(user, roleTabs).includes(app)) return <Navigate to={landingPath(user, roleTabs)} replace />;
  return children;
}

export default function App() {
  const { user, roleTabs } = useAuth();
  // Stop the mouse wheel from changing a focused <input type="number"> — a browser default where
  // scrolling over a focused number field silently increments/decrements it. Blurring on wheel lets
  // the page scroll normally while the value stays put; manual typing and the ± steppers still work.
  // Global (document-level) so it covers every number field in Studio + IMS.
  useEffect(() => {
    const onWheel = (e) => {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT" && el.type === "number" && el === e.target) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to={landingPath(user, roleTabs)} replace /> : <Login />} />
        <Route path="/" element={<Navigate to={landingPath(user, roleTabs)} replace />} />
        <Route path="/studio" element={<Protected app="studio"><Studio /></Protected>} />
        <Route path="/ims" element={<Protected app="ims"><IMS /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateBanner />
      <CanvaOAuthBanner />
    </>
  );
}

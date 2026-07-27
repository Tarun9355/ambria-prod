import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { landingPath, userApps } from "./lib/auth";
import { useVersionCheck } from "./lib/useVersionCheck";
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
  if (!updateReady) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-full bg-gray-900 text-white text-sm px-4 py-2 shadow-xl">
      <span>A new version of Ambria is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-full bg-indigo-500 hover:bg-indigo-400 px-3 py-1 font-semibold transition"
      >
        Update now
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

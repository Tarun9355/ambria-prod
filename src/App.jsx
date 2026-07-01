import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { landingPath, userApps } from "./lib/auth";
import { useVersionCheck } from "./lib/useVersionCheck";
import Login from "./pages/Login.jsx";
import Studio from "./pages/Studio.jsx";
import IMS from "./pages/ims/IMS.jsx";

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
    </>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { landingPath, userApps } from "./lib/auth";
import Login from "./pages/Login.jsx";
import Studio from "./pages/Studio.jsx";
import IMS from "./pages/ims/IMS.jsx";

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
    <Routes>
      <Route path="/login" element={user ? <Navigate to={landingPath(user, roleTabs)} replace /> : <Login />} />
      <Route path="/" element={<Navigate to={landingPath(user, roleTabs)} replace />} />
      <Route path="/studio" element={<Protected app="studio"><Studio /></Protected>} />
      <Route path="/ims" element={<Protected app="ims"><IMS /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { landingPath, userApps } from "./lib/auth";
import Login from "./pages/Login.jsx";
import Studio from "./pages/Studio.jsx";
import IMS from "./pages/ims/IMS.jsx";

function Protected({ app, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Gate by per-user app access — a user without this app is bounced to their landing app.
  if (app && !userApps(user).includes(app)) return <Navigate to={landingPath(user)} replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={landingPath(user)} replace /> : <Login />} />
      <Route path="/" element={<Navigate to={landingPath(user)} replace />} />
      <Route path="/studio" element={<Protected app="studio"><Studio /></Protected>} />
      <Route path="/ims" element={<Protected app="ims"><IMS /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

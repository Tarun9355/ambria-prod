import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { userApps } from "../lib/auth";

// Cross-app header toggle. Only renders for users granted BOTH apps; one click
// navigates between Studio and IMS (same SPA, HashRouter). `current` is the active app id.
export default function AppSwitcher({ current }) {
  const { user, roleTabs } = useAuth();
  const navigate = useNavigate();
  const apps = userApps(user, roleTabs);
  if (apps.length < 2) return null;
  const tabs = [
    { id: "studio", to: "/studio", label: "🎨 Studio" },
    { id: "ims", to: "/ims", label: "🛠️ IMS" },
  ].filter((t) => apps.includes(t.id));
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => navigate(t.to)}
          className={"px-3 py-1.5 rounded-md text-xs font-semibold transition-all " + (current === t.id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-800")}
          title={current === t.id ? `You're in ${t.label}` : `Switch to ${t.label}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

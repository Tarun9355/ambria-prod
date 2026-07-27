import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { userApps } from "../lib/auth";
import { IconPalette, IconBox } from "./icons";

// Cross-app header toggle. Only renders for users granted BOTH apps; one click
// navigates between Studio and IMS (same SPA, HashRouter). `current` is the active app id.
//
// `tone` picks the palette: "light" for the white IMS header (the default, unchanged),
// "dark" for Studio's gradient header — where the old light-grey chip looked pasted on.
export default function AppSwitcher({ current, tone = "light" }) {
  const { user, roleTabs } = useAuth();
  const navigate = useNavigate();
  const apps = userApps(user, roleTabs);
  if (apps.length < 2) return null;
  const tabs = [
    { id: "studio", to: "/studio", label: "Studio", Icon: IconPalette },
    { id: "ims", to: "/ims", label: "IMS", Icon: IconBox },
  ].filter((t) => apps.includes(t.id));

  const dark = tone === "dark";
  const wrap = dark
    ? "flex gap-1 rounded-[10px] p-[3px] bg-white/[0.06]"
    : "flex gap-1 bg-gray-100 rounded-lg p-1";
  const chip = (active) =>
    "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all " +
    (dark ? "px-3 py-[6px] text-xs " : "px-3 py-1.5 text-xs ") +
    (active
      ? dark
        ? "bg-[#C9A96E22] text-[#C9A96E]"
        : "bg-white shadow text-gray-900"
      : dark
        ? "text-gray-400 hover:text-white"
        : "text-gray-500 hover:text-gray-800");

  return (
    <div className={wrap}>
      {tabs.map(({ id, to, label, Icon }) => {
        const active = current === id;
        return (
          <button
            key={id}
            onClick={() => navigate(to)}
            className={chip(active)}
            title={active ? `You're in ${label}` : `Switch to ${label}`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

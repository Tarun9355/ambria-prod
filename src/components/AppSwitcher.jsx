import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { userApps } from "../lib/auth";
import { flushBeforeReload } from "../lib/pendingSaveRegistry";
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
            onClick={async () => {
              // A plain navigate(to) unmounts Studio immediately — React Router swaps the route
              // synchronously, and Studio's own autosave becomes a fire-and-forget call from that
              // unmount's cleanup: nothing here waited for its write to actually reach the server.
              // A user who bounced straight back to Studio (or just refreshed) could beat that write,
              // re-fetch the client from the DB before it landed, and see their own edit vanish — the
              // exact "made changes, switched to IMS and back, changes gone" report this fixes.
              // flushBeforeReload already exists for this precise problem (built for the "new version
              // available" banner's reload) — reusing it here just makes it fire on an in-app route
              // switch too, not only a hard reload. Best-effort, capped, so a slow/broken save can
              // never turn a tab switch into a hang.
              await Promise.race([flushBeforeReload(), new Promise((resolve) => setTimeout(resolve, 2500))]);
              navigate(to);
            }}
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

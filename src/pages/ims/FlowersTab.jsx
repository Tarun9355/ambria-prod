import { useState } from "react";
import { Tabs } from "../../components/ui";
import AdminSettingsTab from "./AdminSettingsTab.jsx";

// Faithful to the reference FlowersTab wrapper (Mandi / Recipes / Function Planning /
// Transfers). Mandi + Recipes render AdminSettingsTab via the `mode` prop (Mandi is LIVE;
// Recipes lands in keystone slice 3). Planning/Transfers come in a later Flowers slice.
function Placeholder({ name, note }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">Being rebuilt in a later slice{note ? ` (${note})` : ""}.</p>
    </div>
  );
}

export default function FlowersTab({ settings, setSettings, supervisors, setSupervisors, studio, authUser }) {
  const allTabs = [
    { id: "mandi", label: "🌸 Mandi Prices" },
    { id: "recipes", label: "🌺 Recipes" },
    { id: "planning", label: "📋 Function Planning" },
    { id: "transfers", label: "🔄 Transfers" },
  ];
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.flowers ? allTabs : allTabs.filter((t) => roleConfig.subTabs.flowers.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "mandi");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "mandi" && <AdminSettingsTab mode="mandi" settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} />}
      {sub === "recipes" && <AdminSettingsTab mode="patterns" settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} />}
      {sub === "planning" && <Placeholder name="📋 Function Planning" note="Flowers planning slice" />}
      {sub === "transfers" && <Placeholder name="🔄 Transfers" note="Flowers transfers slice" />}
    </div>
  );
}

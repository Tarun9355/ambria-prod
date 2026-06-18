import { useState } from "react";
import { Tabs } from "../../components/ui";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import FlowerMandiTab from "./FlowerMandiTab.jsx";

// Faithful to the reference FlowersTab wrapper (Mandi / Recipes / Function Planning /
// Transfers). Mandi + Recipes render AdminSettingsTab via the `mode` prop. Planning/Transfers
// render FlowerMandiTab via the `mode` prop.
export default function FlowersTab({ settings, setSettings, supervisors, setSupervisors, studio, authUser, functions, setFunctions }) {
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
      {sub === "planning" && <FlowerMandiTab mode="planning" settings={settings} setSettings={setSettings} functions={functions} setFunctions={setFunctions} />}
      {sub === "transfers" && <FlowerMandiTab mode="transfers" settings={settings} setSettings={setSettings} functions={functions} setFunctions={setFunctions} />}
    </div>
  );
}

import { useState } from "react";
import { Tabs } from "../../components/ui";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import FlowerMandiTab from "./FlowerMandiTab.jsx";
import { hasTabPerm, userSubTabs } from "../../lib/ims/tabAccess";

// Faithful to the reference FlowersTab wrapper (Mandi / Recipes / Transfers). Mandi + Recipes
// render AdminSettingsTab via the `mode` prop. Transfers renders FlowerMandiTab via the `mode` prop.
export default function FlowersTab({ settings, setSettings, supervisors, setSupervisors, studio, authUser, functions, setFunctions, syncRecipeRatesToStudio, tier15LastSync, tier15Syncing, inventory = [], rateCardCategories = [], settingsLoaded }) {
  const allTabs = [
    { id: "mandi", label: "🌸 Mandi Prices" },
    { id: "recipes", label: "🌺 Recipes" },
    { id: "transfers", label: "🔄 Transfers" },
  ];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // the user's own Tab Access override (Admin → Users → Edit) on top of the role - userSubTabs (lib/ims/tabAccess); it read the role only
  const subsOn = userSubTabs(authUser, settings, "ims", "flowers");
  const allowed = isAdmin || !subsOn ? allTabs : allTabs.filter((t) => subsOn.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "mandi");
  // Edit Access/per-user override, Admin → Users & Roles — computed once, passed to every sub-tab.
  const canEditFlowers = hasTabPerm(authUser, settings, "ims", "flowers", "edit");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "mandi" && <AdminSettingsTab mode="mandi" settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} inventory={inventory} rateCardCategories={rateCardCategories} canEdit={canEditFlowers} settingsLoaded={settingsLoaded} />}
      {sub === "recipes" && <AdminSettingsTab mode="patterns" settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} syncRecipeRatesToStudio={syncRecipeRatesToStudio} tier15LastSync={tier15LastSync} tier15Syncing={tier15Syncing} inventory={inventory} rateCardCategories={rateCardCategories} canEdit={canEditFlowers} settingsLoaded={settingsLoaded} />}
      {sub === "transfers" && <FlowerMandiTab mode="transfers" settings={settings} setSettings={setSettings} functions={functions} setFunctions={setFunctions} canEdit={canEditFlowers} />}
    </div>
  );
}

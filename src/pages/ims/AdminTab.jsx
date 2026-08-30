import { useState } from "react";
import { Tabs } from "../../components/ui";
import VendorsTab from "./VendorsTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import UsersTab from "./UsersTab.jsx";

// Faithful to the reference AdminTabWrapper (sub-tabs: Users / Vendors / Settings).
export default function AdminTab({ users, setUsers, addUser, vendors, setVendors, functions, settings, setSettings, supervisors, setSupervisors, studio, inventory, trussInv, rateCardCategories, onUpdateSubcatFactor, onUpdateSubcatCostPercent, onAddSubcat, onRenameSubcat, onUpdateSubcatCategory, onSyncSubcatsFromInventory, onDeleteSubcat, onUpdateSubcatFloralMode, onUpdateSubcatTagHidden, rcItems, rcCats, authUser }) {
  const allTabs = [
    { id: "users", label: "👤 Users & Roles" },
    { id: "vendors", label: "🏢 Vendors" },
    { id: "settings", label: "⚙️ Settings" },
  ];
  // Same role-gating every other IMS tab wrapper does (PlanningTab.jsx, SupplyTab.jsx, ...) — this
  // one just never had it: Admin's own sub-tabs were shown to anyone with Admin access regardless
  // of what the role editor had recorded for them.
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.admin ? allTabs : allTabs.filter((t) => roleConfig.subTabs.admin.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  // "vendors" was always the default landing sub-tab regardless of order — keep that for any role
  // that still has it (unrestricted roles, i.e. almost everyone), only redirecting away from it for
  // a role deliberately restricted to not include it.
  const [sub, setSub] = useState(() => (tabs.some((t) => t.id === "vendors") ? "vendors" : (tabs[0]?.id || "vendors")));
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "users" && <UsersTab users={users} setUsers={setUsers} addUser={addUser} settings={settings} setSettings={setSettings} />}
      {sub === "vendors" && <VendorsTab vendors={vendors} setVendors={setVendors} functions={functions} settings={settings} />}
      {sub === "settings" && <AdminSettingsTab settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} inventory={inventory} trussInv={trussInv} rateCardCategories={rateCardCategories} onUpdateSubcatFactor={onUpdateSubcatFactor} onUpdateSubcatCostPercent={onUpdateSubcatCostPercent} onAddSubcat={onAddSubcat} onRenameSubcat={onRenameSubcat} onUpdateSubcatCategory={onUpdateSubcatCategory} onSyncSubcatsFromInventory={onSyncSubcatsFromInventory} onDeleteSubcat={onDeleteSubcat} onUpdateSubcatFloralMode={onUpdateSubcatFloralMode} onUpdateSubcatTagHidden={onUpdateSubcatTagHidden} rcItems={rcItems} rcCats={rcCats} authUser={authUser} />}
    </div>
  );
}

import { useState } from "react";
import { Tabs } from "../../components/ui";
import VendorsTab from "./VendorsTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import UsersTab from "./UsersTab.jsx";

// Faithful to the reference AdminTabWrapper (sub-tabs: Users / Vendors / Settings).
export default function AdminTab({ users, setUsers, addUser, vendors, setVendors, functions, settings, setSettings, supervisors, setSupervisors, studio, inventory, trussInv, rateCardCategories, onUpdateSubcatFactor, onUpdateSubcatCostPercent, onAddSubcat, onRenameSubcat, onUpdateSubcatCategory, onSyncSubcatsFromInventory, rcItems, rcCats, onSaveRateCardItems, onSaveRateCardCats }) {
  const [sub, setSub] = useState("vendors");
  const tabs = [
    { id: "users", label: "👤 Users & Roles" },
    { id: "vendors", label: "🏢 Vendors" },
    { id: "settings", label: "⚙️ Settings" },
  ];
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "users" && <UsersTab users={users} setUsers={setUsers} addUser={addUser} settings={settings} setSettings={setSettings} />}
      {sub === "vendors" && <VendorsTab vendors={vendors} setVendors={setVendors} functions={functions} settings={settings} />}
      {sub === "settings" && <AdminSettingsTab settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} inventory={inventory} trussInv={trussInv} rateCardCategories={rateCardCategories} onUpdateSubcatFactor={onUpdateSubcatFactor} onUpdateSubcatCostPercent={onUpdateSubcatCostPercent} onAddSubcat={onAddSubcat} onRenameSubcat={onRenameSubcat} onUpdateSubcatCategory={onUpdateSubcatCategory} onSyncSubcatsFromInventory={onSyncSubcatsFromInventory} rcItems={rcItems} rcCats={rcCats} onSaveRateCardItems={onSaveRateCardItems} onSaveRateCardCats={onSaveRateCardCats} />}
    </div>
  );
}

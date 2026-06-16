import { useState } from "react";
import { Tabs } from "../../components/ui";
import VendorsTab from "./VendorsTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";

// Faithful to the reference AdminTabWrapper (sub-tabs: Users / Vendors / Settings).
// Users is rebuilt in a later phase; Vendors + Settings are live.
function Placeholder({ name }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">This section is being rebuilt in a later phase.</p>
    </div>
  );
}

export default function AdminTab({ vendors, setVendors, functions, settings, setSettings, supervisors, setSupervisors, studio }) {
  const [sub, setSub] = useState("vendors");
  const tabs = [
    { id: "users", label: "👤 Users & Roles" },
    { id: "vendors", label: "🏢 Vendors" },
    { id: "settings", label: "⚙️ Settings" },
  ];
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "users" && <Placeholder name="👤 Users & Roles" />}
      {sub === "vendors" && <VendorsTab vendors={vendors} setVendors={setVendors} functions={functions} settings={settings} />}
      {sub === "settings" && <AdminSettingsTab settings={settings} setSettings={setSettings} supervisors={supervisors} setSupervisors={setSupervisors} studio={studio} />}
    </div>
  );
}

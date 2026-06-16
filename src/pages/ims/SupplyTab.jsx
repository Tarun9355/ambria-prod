import { useState } from "react";
import { Tabs } from "../../components/ui";
import PurchaseTab from "./PurchaseTab.jsx";

// Faithful to the reference SupplyTab wrapper (sub-tabs: Purchase / Production).
// Production is rebuilt in a later sub-phase (large + AI image comparison).
function Placeholder({ name }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">This section is being rebuilt in a later phase.</p>
    </div>
  );
}

export default function SupplyTab({ purchase, setPurchase, inventory, setInventory, projects, functions, studio, authUser, settings }) {
  const allTabs = [{ id: "purchase", label: "🛒 Purchase" }, { id: "production", label: "🏭 Production" }];
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.supply ? allTabs : allTabs.filter((t) => roleConfig.subTabs.supply.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "purchase");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "purchase" && <PurchaseTab purchase={purchase} setPurchase={setPurchase} inventory={inventory} setInventory={setInventory} projects={projects} functions={functions} studio={studio} />}
      {sub === "production" && <Placeholder name="🏭 Production" />}
    </div>
  );
}

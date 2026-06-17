import { useState } from "react";
import { Tabs } from "../../components/ui";
import PurchaseTab from "./PurchaseTab.jsx";
import ProductionTab from "./ProductionTab.jsx";

// Faithful to the reference SupplyTab wrapper (sub-tabs: Purchase / Production).
export default function SupplyTab({ purchase, setPurchase, inventory, setInventory, projects, functions, prodRequests, setProdRequests, studio, authUser, settings }) {
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
      {sub === "production" && <ProductionTab prodRequests={prodRequests} setProdRequests={setProdRequests} inventory={inventory} setInventory={setInventory} projects={projects} functions={functions} purchase={purchase} setPurchase={setPurchase} />}
    </div>
  );
}

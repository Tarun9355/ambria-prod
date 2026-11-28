import { userSubTabs } from "../../lib/ims/tabAccess";
import { useState } from "react";
import { Tabs } from "../../components/ui";
import PurchaseTab from "./PurchaseTab.jsx";
import ProductionTab from "./ProductionTab.jsx";

// Faithful to the reference SupplyTab wrapper (sub-tabs: Purchase / Production).
export default function SupplyTab({ purchase, setPurchase, inventory, setInventory, projects, functions, prodRequests, setProdRequests, studio, authUser, settings, trussInv }) {
  const allTabs = [{ id: "purchase", label: "🛒 Purchase" }, { id: "production", label: "🏭 Production" }];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // the user's own Tab Access override (Admin → Users → Edit) on top of the role - userSubTabs (lib/ims/tabAccess); it read the role only
  const subsOn = userSubTabs(authUser, settings, "ims", "supply");
  const allowed = isAdmin || !subsOn ? allTabs : allTabs.filter((t) => subsOn.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "purchase");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "purchase" && <PurchaseTab purchase={purchase} setPurchase={setPurchase} inventory={inventory} setInventory={setInventory} projects={projects} functions={functions} studio={studio} trussInv={trussInv} />}
      {sub === "production" && <ProductionTab prodRequests={prodRequests} setProdRequests={setProdRequests} inventory={inventory} setInventory={setInventory} projects={projects} functions={functions} purchase={purchase} setPurchase={setPurchase} authUser={authUser} />}
    </div>
  );
}

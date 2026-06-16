import { useState } from "react";
import { Tabs } from "../../components/ui";
import PLTab from "./PLTab.jsx";
import CompanyPLTab from "./CompanyPLTab.jsx";
import OverheadsTab from "./OverheadsTab.jsx";

// Faithful to the reference FinanceTab wrapper (Event P&L / Company P&L / Overheads).
export default function FinanceTab({ projects, functions, inventory, purchase, settings, setSettings, overheads, setOverheads, authUser }) {
  const allTabs = [{ id: "pl", label: "📊 Event P&L" }, { id: "company_pl", label: "📊 Company P&L" }, { id: "overheads", label: "🏢 Overheads" }];
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.finance ? allTabs : allTabs.filter((t) => roleConfig.subTabs.finance.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "pl");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "pl" && <PLTab projects={projects} functions={functions} inventory={inventory} purchase={purchase} settings={settings} setSettings={setSettings} />}
      {sub === "company_pl" && <CompanyPLTab projects={projects} functions={functions} inventory={inventory} purchase={purchase} overheads={overheads} settings={settings} />}
      {sub === "overheads" && <OverheadsTab overheads={overheads} setOverheads={setOverheads} />}
    </div>
  );
}

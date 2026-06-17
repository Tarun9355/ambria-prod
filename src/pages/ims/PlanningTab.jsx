import { useState } from "react";
import { Tabs } from "../../components/ui";
import PaintPlanningTab from "./PaintPlanningTab.jsx";
import BoxesTab from "./BoxesTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import ManpowerTab from "./ManpowerTab.jsx";

// Faithful to the reference PlanningTab wrapper (sub-tabs: Manpower / Truss / Paint /
// Boxes / Truss&Batta / Fabric Stock). Truss (allocation engine) is a later sub-phase.
// Manpower / Paint / Boxes / Truss&Batta / Fabric Stock are live.
function Placeholder({ name, note }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">This section is being rebuilt in a later phase{note ? ` (${note})` : ""}.</p>
    </div>
  );
}

export default function PlanningTab({ projects, functions, setFunctions, inventory, vendors, setVendors, settings, setSettings, boxes, setBoxes, trussInv, setTrussInv, studio, authUser }) {
  const allTabs = [
    { id: "manpower", label: "👷 Manpower" },
    { id: "truss", label: "🏗️ Truss" },
    { id: "paint", label: "🎨 Paint" },
    { id: "boxes", label: "📫 Boxes & Challans" },
    { id: "trussbatta", label: "🏗️ Truss & Batta Config" },
    { id: "fabricstock", label: "🧵 Fabric Stock" },
  ];
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.planning ? allTabs : allTabs.filter((t) => roleConfig.subTabs.planning.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(tabs[0]?.id || "manpower");
  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={sub} onChange={setSub} />
      {sub === "manpower" && <ManpowerTab projects={projects} functions={functions} setFunctions={setFunctions} settings={settings} setSettings={setSettings} vendors={vendors} setVendors={setVendors} inventory={inventory} />}
      {sub === "truss" && <Placeholder name="🏗️ Truss" note="Phase 6" />}
      {sub === "paint" && <PaintPlanningTab projects={projects} functions={functions} inventory={inventory} settings={settings} />}
      {sub === "boxes" && <BoxesTab boxes={boxes} setBoxes={setBoxes} functions={functions} projects={projects} />}
      {sub === "trussbatta" && <AdminSettingsTab mode="trussbatta" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} />}
      {sub === "fabricstock" && <AdminSettingsTab mode="fabricstock" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} />}
    </div>
  );
}

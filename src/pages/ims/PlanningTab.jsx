import { useState, useEffect } from "react";
import { Tabs } from "../../components/ui";
import PaintPlanningTab from "./PaintPlanningTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import TrussPlanningTab from "./TrussPlanningTab.jsx";
import DepartmentOpsTab from "./DepartmentOpsTab.jsx";

// Faithful to the reference PlanningTab wrapper (sub-tabs: Truss / Paint / Truss&Batta /
// Fabric Stock). Manpower and Boxes & Challans were decommissioned — no longer needed.
function Placeholder({ name, note }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">This section is being rebuilt in a later phase{note ? ` (${note})` : ""}.</p>
    </div>
  );
}

export default function PlanningTab({ projects, functions, setFunctions, inventory, setInventory, settings, setSettings, trussInv, setTrussInv, trussAlloc, setTrussAlloc, eventOrders, setEventOrders, blocks, studio, authUser, amendRequests, focusEventId, focusSearch, focusLeadEntry, onFocusHandled, onGoToCalendar }) {
  const allTabs = [
    { id: "deptops", label: "🏦 Dept Ops" },
    { id: "truss", label: "🏗️ Truss" },
    { id: "paint", label: "🎨 Paint" },
    { id: "trussbatta", label: "🏗️ Truss & Batta Config" },
    { id: "fabricstock", label: "🧵 Fabric Stock" },
  ];
  const roleConfig = (settings?.roleTabs || {})[authUser?.role];
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const allowed = isAdmin || !roleConfig?.subTabs?.planning ? allTabs : allTabs.filter((t) => roleConfig.subTabs.planning.includes(t.id));
  const tabs = allowed.length > 0 ? allowed : allTabs;
  const [sub, setSub] = useState(() => { const saved = sessionStorage.getItem("ambria-ims-planning-sub"); return tabs.some((t) => t.id === saved) ? saved : (tabs[0]?.id || "deptops"); });
  useEffect(() => { sessionStorage.setItem("ambria-ims-planning-sub", sub); }, [sub]);
  // ── ONE ROW FOR BOTH PICKERS ON A PHONE ──
  // Dept Ops portals its department dropdown into this slot, so the section picker and the
  // department picker are real siblings in one flex row and centre on the same line. They used
  // to be separate blocks, with the department one dragged up by a hand-tuned negative margin
  // that never quite matched and left it sitting a few pixels low.
  const [pickerSlot, setPickerSlot] = useState(null);
  return (
    // `relative isolate` so the glow layer's -z-10 stays inside this page's own stacking context:
    // it paints behind the Planning content only, never over the nav rail or the header.
    <div className="relative isolate space-y-4">
      {/* ── THE GROUND FOR THE GLASS ──
          Frosted cards need something behind them to frost. On flat slate a translucent card
          just looks faded, so this lays three large, heavily blurred colour fields behind the
          page. They are soft-edged circles, not a filled box, so the layer has no visible
          boundary; overflow-hidden keeps them from adding a sideways scroll. */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-4 sm:-inset-6 -z-10 overflow-hidden">
        {/* Kept to one hue at low strength — three saturated fields read as decoration and
            fought the blue accents on the cards. This is just enough for the glass to register. */}
        <div className="absolute -top-20 -left-24 w-80 h-80 rounded-full bg-blue-200/30 blur-3xl" />
        <div className="absolute top-72 -right-28 w-80 h-80 rounded-full bg-blue-100/40 blur-3xl" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1"><Tabs tabs={tabs} active={sub} onChange={setSub} /></div>
        <div ref={setPickerSlot} className="sm:hidden shrink-0 empty:hidden" />
      </div>
      {sub === "deptops" && <DepartmentOpsTab pickerSlot={pickerSlot} eventOrders={eventOrders} setEventOrders={setEventOrders} inventory={inventory} setInventory={setInventory} blocks={blocks} settings={settings} setSettings={setSettings} trussInv={trussInv} setTrussInv={setTrussInv} authUser={authUser} amendRequests={amendRequests} focusEventId={focusEventId} focusSearch={focusSearch} focusLeadEntry={focusLeadEntry} onFocusHandled={onFocusHandled} onGoToCalendar={onGoToCalendar} />}
      {sub === "truss" && <TrussPlanningTab trussAlloc={trussAlloc} setTrussAlloc={setTrussAlloc} trussInv={trussInv} eventOrders={eventOrders} authUser={authUser} />}
      {sub === "paint" && <PaintPlanningTab projects={projects} functions={functions} inventory={inventory} settings={settings} />}
      {sub === "trussbatta" && <AdminSettingsTab mode="trussbatta" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} />}
      {sub === "fabricstock" && <AdminSettingsTab mode="fabricstock" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} />}
    </div>
  );
}

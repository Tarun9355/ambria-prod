import { useState, useEffect } from "react";
import { Tabs } from "../../components/ui";
import PaintPlanningTab from "./PaintPlanningTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import StructurePlanningTab from "./StructurePlanningTab.jsx";
import DepartmentOpsTab from "./DepartmentOpsTab.jsx";
import { hasTabPerm } from "../../lib/ims/tabAccess";

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

export default function PlanningTab({ prodRequests, projects, functions, setFunctions, inventory, setInventory, settings, setSettings, trussInv, setTrussInv, trussAlloc, setTrussAlloc, platformAlloc, setPlatformAlloc, battaAlloc, setBattaAlloc, eventOrders, setEventOrders, blocks, studio, authUser, amendRequests, focusEventId, focusSearch, focusLeadEntry, onFocusHandled, onGoToCalendar, autoPdfFor, onAutoPdfDone, rateCardCategories, rcItems, rcCats, supervisors }) {
  // KEEP IN SYNC: RoleAccessModal.jsx's IMS_SUBTABS.planning mirrors this list by hand (role-based
  // tab access has no shared source of truth with the real tab bars) — add/remove/rename a tab
  // here and update that list in the same change.
  const allTabs = [
    { id: "deptops", label: "🏦 Dept Ops" },
    { id: "structure", label: "🏗️ Truss/Platform/Batta" },
    { id: "paint", label: "🎨 Paint" },
    { id: "trussbatta", label: "🏗️ Truss & Batta Config" },
    { id: "platformconfig", label: "🛏️ Platform Config" },
    { id: "fabricstock", label: "🧵 Fabric Stock" },
    { id: "truck", label: "🚚 Truck" },
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
  // Edit Access/per-user override, Admin → Users & Roles — computed once here and passed down, so
  // every Planning sub-tab (including the Truss/Platform/Batta, Truss & Batta Config, Platform
  // Config, Fabric Stock and Truck screens, none of which had any edit gate before this) reads the
  // same answer. Dept Ops computes its own copy internally instead (it already has its own
  // authUser/settings and its own, more specific events_manpower gate to reconcile this against).
  const canEditPlanning = hasTabPerm(authUser, settings, "ims", "planning", "edit");
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
      {sub === "deptops" && <DepartmentOpsTab pickerSlot={pickerSlot} prodRequests={prodRequests} functions={functions} eventOrders={eventOrders} setEventOrders={setEventOrders} inventory={inventory} setInventory={setInventory} blocks={blocks} settings={settings} setSettings={setSettings} trussInv={trussInv} setTrussInv={setTrussInv} authUser={authUser} amendRequests={amendRequests} focusEventId={focusEventId} focusSearch={focusSearch} focusLeadEntry={focusLeadEntry} onFocusHandled={onFocusHandled} onGoToCalendar={onGoToCalendar} autoPdfFor={autoPdfFor} onAutoPdfDone={onAutoPdfDone} supervisors={supervisors} rateCardCategories={rateCardCategories} />}
      {sub === "structure" && <StructurePlanningTab trussAlloc={trussAlloc} setTrussAlloc={setTrussAlloc} platformAlloc={platformAlloc} setPlatformAlloc={setPlatformAlloc} battaAlloc={battaAlloc} setBattaAlloc={setBattaAlloc} trussInv={trussInv} eventOrders={eventOrders} authUser={authUser} canEditPlanning={canEditPlanning} />}
      {sub === "paint" && <PaintPlanningTab projects={projects} functions={functions} inventory={inventory} settings={settings} />}
      {sub === "trussbatta" && <AdminSettingsTab mode="trussbatta" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} canEdit={canEditPlanning} />}
      {sub === "platformconfig" && <AdminSettingsTab mode="platformconfig" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} canEdit={canEditPlanning} />}
      {sub === "fabricstock" && <AdminSettingsTab mode="fabricstock" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} canEdit={canEditPlanning} />}
      {sub === "truck" && <AdminSettingsTab mode="truck" settings={settings} setSettings={setSettings} studio={studio} trussInv={trussInv} setTrussInv={setTrussInv} rateCardCategories={rateCardCategories} rcItems={rcItems} rcCats={rcCats} inventory={inventory} canEdit={canEditPlanning} />}
    </div>
  );
}

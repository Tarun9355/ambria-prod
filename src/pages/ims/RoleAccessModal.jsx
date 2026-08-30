import { useState } from "react";

// ═══ ROLE ACCESS — dedicated modal, replacing the inline panel that used to expand below the
// role card grid (UsersTab.jsx). Mirrors the REAL tab → sub-tab (→ sub-sub-tab, for Admin →
// Settings → Master Data) structure of both apps, grouped by app, instead of a flat checkbox
// list — see the approved mockup this was built from.
//
// Data shape is UNCHANGED from before this file existed: settings.roleTabs[role] = { tabs,
// subTabs: {[parentId]: string[]}, studio: { tabs, subTabs } }. Every level here — including the
// two new ones (Settings' 8 panels, Master Data's 7 children) — is just another key in the SAME
// subTabs map, the same way "planning"/"supply"/etc. always have been. No new fields, no
// migration: a role saved by the OLD editor reads back exactly as it did before, and restricting
// something new only ever ADDS a key to subTabs, never touches an unrelated one.
//
// "Restriction is opt-in": an absent/empty subTabs[parent] means every child is visible (the
// pre-existing rule, kept exactly) — the segmented "All sub-tabs / Custom" control is a clearer
// way to work with that same rule, not a new rule. "All sub-tabs" clears the restriction outright;
// "Custom" seeds the full child list as explicitly-checked so the first click un-checks one
// instead of the old model's first click keeping ONLY that one (same underlying array, more
// intuitive edit).

// ── IMS structure (verified against the real components, not the drifted copy the old inline
// editor carried — e.g. Planning was missing "Dept Ops", Flowers had a phantom "Function
// Planning" nobody's FlowersTab.jsx has ever had) ──
const IMS_TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
  { id: "inventory", label: "📦 Inventory" },
  { id: "calendar", label: "📅 Calendar" },
  { id: "planning", label: "🔧 Planning" },
  { id: "supply", label: "🛒 Supply" },
  { id: "flowers", label: "🌺 Flowers" },
  { id: "finance", label: "📊 Finance" },
  { id: "admin", label: "⚙️ Admin" },
];
const IMS_SUBTABS = {
  planning: [
    { id: "deptops", label: "🏦 Dept Ops" },
    { id: "truss", label: "🏗️ Truss" },
    { id: "paint", label: "🎨 Paint" },
    { id: "trussbatta", label: "🏗️ Truss & Batta Config" },
    { id: "fabricstock", label: "🧵 Fabric Stock" },
  ],
  supply: [
    { id: "purchase", label: "🛒 Purchase" },
    { id: "production", label: "🏭 Production" },
  ],
  flowers: [
    { id: "mandi", label: "🌸 Mandi Prices" },
    { id: "recipes", label: "🌺 Recipes" },
    { id: "transfers", label: "🔄 Transfers" },
  ],
  finance: [
    { id: "pl", label: "📊 Event P&L" },
    { id: "company_pl", label: "📊 Company P&L" },
    { id: "overheads", label: "🏢 Overheads" },
  ],
};
// Admin is the one branch that goes deeper than every other tab — Settings has 8 panels of its
// own, and one of those (Master Data) has 7 children of its own again. Admin's own flat layer
// (Users & Roles / Vendors / Settings) is hand-assembled below rather than mapped from a list,
// since Settings is the only one of the three that itself branches further; the two deeper
// layers are their own constants below, read via subTabs.settings and subTabs.masterdata — same
// map, two more keys.
const SETTINGS_PANELS = [
  { id: "labourtiers", label: "👷 Workforce" },
  { id: "venuemin", label: "🏛️ Fixed Venues" },
  { id: "venuedumping", label: "🚛 Venue Dumping" },
  { id: "dihari", label: "💰 Dihari Timings" },
  { id: "supervisors", label: "👷 Supervisors" },
  { id: "synonyms", label: "🔤 AI Synonyms" },
  { id: "masterdata", label: "🗂️ Master Data" },
  { id: "canva", label: "🎨 Canva" },
];
const MASTER_DATA_CHILDREN = [
  { id: "subcats", label: "📂 Sub-Categories" },
  { id: "venues", label: "🌆 Venues" },
  { id: "printmaterials", label: "🖨️ Print Materials" },
  { id: "carpetmaterials", label: "🟫 Carpet & Platform" },
  { id: "structurerates", label: "🏗️ Truss & Masking" },
  { id: "transport", label: "🚛 Transport & Power" },
  { id: "departments", label: "🏦 Departments" },
];
// ── Studio structure — Design Studio's sub-tabs already matched reality; Library and Settings
// did not (Library was missing the always-on "Palettes" note, Settings carried four sub-tabs —
// Venues/Calendar/Departments/Transport — that don't correspond to any real view in
// ManageSettings.jsx). Corrected to the 4 real settingsView values. ──
const STUDIO_TABS = [
  { id: "design", label: "🎨 Design Studio" },
  { id: "library", label: "📚 Library & Content" },
  { id: "settings", label: "⚙️ Settings" },
];
const STUDIO_SUBTABS = {
  design: [
    { id: "dealcheck", label: "Deal Check" },
    { id: "viewpricing", label: "View Pricing & Costs" },
    { id: "export", label: "Export PDF/PPT" },
  ],
  library: [
    { id: "images", label: "Images" },
    { id: "videos", label: "Videos" },
    { id: "corrections", label: "Contributions" },
  ],
  settings: [
    { id: "clients", label: "Clients" },
    { id: "zones", label: "Zones" },
    { id: "tags", label: "Tags" },
    { id: "priority", label: "Photo Priority" },
  ],
};

// ═══ A toggle switch ═══
function Toggle({ on, onClick, size = "md", color = "indigo" }) {
  const track = size === "sm" ? "w-7 h-4" : "w-9 h-5";
  const knob = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  const onBg = color === "amber" ? "bg-amber-600" : "bg-indigo-600";
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`relative rounded-full flex-shrink-0 transition-colors ${track} ${on ? onBg : "bg-gray-200"}`}>
      <span className={`absolute top-0.5 left-0.5 bg-white rounded-full shadow transition-transform ${knob} ${on ? (size === "sm" ? "translate-x-3" : "translate-x-4") : ""}`} />
    </button>
  );
}

// ═══ One toggleable row — a top-level tab, or one of Admin's deeper levels. If `subs` is given,
// it can expand to show them (flat pills, or — for the one row that needs it — a further nested
// <SectionRow> passed as `extra`). ═══
function SectionRow({ icon, label, on, onToggle, color = "indigo", subs, rcSubs, onSetAll, onSetCustom, onToggleSub, note, extra, dense }) {
  const [open, setOpen] = useState(false);
  const hasSubs = Array.isArray(subs) && subs.length > 0;
  // Admin has no flat pills of its own — its children (Users & Roles / Vendors / Settings) are
  // nested SectionRows passed as `extra`, not a `subs` list. A row can expand on either: flat
  // pills, a nested row, or (Settings' case) both together.
  const hasChildren = hasSubs || !!extra;
  const restricted = Array.isArray(rcSubs) && rcSubs.length > 0;
  const tint = color === "amber" ? "bg-amber-50" : "bg-indigo-50";
  const text = color === "amber" ? "text-amber-900" : "text-indigo-900";
  const accentText = color === "amber" ? "text-amber-500" : "text-indigo-400";
  const pad = dense ? "px-2.5 py-1.5" : "px-3 py-2";
  return (
    <div className={`border rounded-lg overflow-hidden ${color === "amber" ? "border-amber-100" : "border-indigo-100"}`}>
      <div className={`flex items-center justify-between gap-2.5 ${pad} ${hasChildren && on ? "cursor-pointer" : ""} ${on ? tint : "bg-gray-50"}`}
        onClick={() => { if (hasChildren && on) setOpen((v) => !v); }}>
        <div className="flex items-center gap-2.5">
          <Toggle on={on} onClick={onToggle} size={dense ? "sm" : "md"} color={color} />
          <span className={dense ? "text-xs" : "text-sm"} style={{ opacity: on ? 1 : 0.55 }}>{icon}</span>
          <span className={`${dense ? "text-xs" : "text-sm"} font-semibold ${on ? text : "text-gray-400"}`}>{label}</span>
        </div>
        {hasChildren && on && (
          <div className="flex items-center gap-2">
            {!open && hasSubs && <span className={`text-[10px] ${accentText}`}>{restricted ? `custom · ${rcSubs.length} of ${subs.length} shown` : `${subs.length} sub-tab${subs.length === 1 ? "" : "s"} · all visible`}</span>}
            <span className={`text-xs ${accentText}`}>{open ? "▾" : "▸"}</span>
          </div>
        )}
      </div>
      {hasChildren && on && open && (
        <div className={`bg-white border-t ${color === "amber" ? "border-amber-100" : "border-indigo-100"} space-y-2`} style={{ padding: dense ? "8px 10px 10px 26px" : "12px 14px 14px 44px" }}>
          {note && <div className="text-[10.5px] text-gray-400">{note}</div>}
          {hasSubs && (
            <>
              <div className="inline-flex rounded-md overflow-hidden border border-gray-200 text-[11px] font-semibold">
                <button type="button" onClick={onSetAll} className={`px-2.5 py-1 ${!restricted ? (color === "amber" ? "bg-amber-600 text-white" : "bg-indigo-600 text-white") : "bg-white text-gray-400"}`}>All sub-tabs</button>
                <button type="button" onClick={() => onSetCustom(subs.map((s) => s.id))} className={`px-2.5 py-1 ${restricted ? (color === "amber" ? "bg-amber-600 text-white" : "bg-indigo-600 text-white") : "bg-white text-gray-400"}`}>Custom</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {subs.map((s) => {
                  const checked = !restricted || rcSubs.includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => onToggleSub(s.id)}
                      className={`inline-flex items-center gap-1 rounded-full font-semibold ${dense ? "text-[10.5px] px-2 py-0.5" : "text-[11.5px] px-2.5 py-1"} ${checked ? (color === "amber" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800") : "bg-gray-100 text-gray-400"}`}>
                      {checked ? "✓ " : ""}{s.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {extra}
        </div>
      )}
    </div>
  );
}

export default function RoleAccessModal({ role, settings, setSettings, onClose }) {
  const rc = (settings?.roleTabs || {})[role] || {};
  const rcSt = rc.studio || {};

  const patchRole = (updater) => setSettings((s) => {
    const all = { ...(s.roleTabs || {}) };
    all[role] = updater(all[role] || { tabs: [], subTabs: {} });
    return { ...s, roleTabs: all };
  });
  const toggleTab = (app, tabId) => { if (role === "Admin") return; patchRole((cur) => {
    if (app === "studio") { const st = cur.studio || { tabs: [], subTabs: {} }; const has = (st.tabs || []).includes(tabId); return { ...cur, studio: { ...st, tabs: has ? st.tabs.filter((t) => t !== tabId) : [...(st.tabs || []), tabId] } }; }
    const has = (cur.tabs || []).includes(tabId); return { ...cur, tabs: has ? cur.tabs.filter((t) => t !== tabId) : [...(cur.tabs || []), tabId] };
  }); };
  const toggleSub = (app, parent, subId) => { if (role === "Admin") return; patchRole((cur) => {
    const base = app === "studio" ? (cur.studio || { tabs: [], subTabs: {} }) : cur;
    const curSubs = base.subTabs?.[parent] || []; const has = curSubs.includes(subId);
    const next = has ? curSubs.filter((x) => x !== subId) : [...curSubs, subId];
    const subTabs = { ...(base.subTabs || {}) }; if (next.length) subTabs[parent] = next; else delete subTabs[parent];
    return app === "studio" ? { ...cur, studio: { ...base, subTabs } } : { ...cur, subTabs };
  }); };
  const setSubAll = (app, parent) => { if (role === "Admin") return; patchRole((cur) => {
    const base = app === "studio" ? (cur.studio || { tabs: [], subTabs: {} }) : cur;
    const subTabs = { ...(base.subTabs || {}) }; delete subTabs[parent];
    return app === "studio" ? { ...cur, studio: { ...base, subTabs } } : { ...cur, subTabs };
  }); };
  const setSubCustom = (app, parent, allIds) => { if (role === "Admin") return; patchRole((cur) => {
    const base = app === "studio" ? (cur.studio || { tabs: [], subTabs: {} }) : cur;
    const subTabs = { ...(base.subTabs || {}), [parent]: [...allIds] };
    return app === "studio" ? { ...cur, studio: { ...base, subTabs } } : { ...cur, subTabs };
  }); };

  const isAdminRole = role === "Admin";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-5 overflow-y-auto" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Edit Access</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5">{role}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg border text-gray-400 hover:text-gray-600 hover:bg-gray-50">✕</button>
        </div>

        {isAdminRole ? (
          <div className="p-6 space-y-5">
            <div className="p-3.5 bg-gray-50 border rounded-xl flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-base flex-shrink-0">🔒</div>
              <div>
                <div className="text-sm font-bold text-gray-900">Admin always has full access</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">Every tab and sub-tab in both IMS and Studio is granted and can't be restricted. This view is read-only.</div>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">IMS · all tabs</div>
              <div className="grid grid-cols-4 gap-2">
                {IMS_TABS.map((t) => <div key={t.id} className="flex items-center gap-2 border rounded-lg px-2.5 py-2 bg-gray-50"><span className="text-xs opacity-60">{t.label.split(" ")[0]}</span><span className="text-xs text-gray-600 font-medium">{t.label.split(" ").slice(1).join(" ")}</span></div>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Studio · all areas</div>
              <div className="grid grid-cols-3 gap-2">
                {STUDIO_TABS.map((t) => <div key={t.id} className="flex items-center gap-2 border rounded-lg px-2.5 py-2 bg-gray-50"><span className="text-xs opacity-60">{t.label.split(" ")[0]}</span><span className="text-xs text-gray-600 font-medium">{t.label.split(" ").slice(1).join(" ")}</span></div>)}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto p-6 space-y-6">

            {/* ═══ IMS ═══ */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs">🛠️</span>
                <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">IMS</span>
                <div className="flex-1 h-px bg-indigo-50" />
              </div>
              <div className="space-y-2">
                {IMS_TABS.map((t) => {
                  const on = (rc.tabs || []).includes(t.id);
                  if (t.id === "admin") return null; // rendered separately below (full-depth tree)
                  const subs = IMS_SUBTABS[t.id];
                  return (
                    <SectionRow key={t.id} icon={t.label.split(" ")[0]} label={t.label.replace(/^\S+\s/, "")}
                      on={on} onToggle={() => toggleTab("ims", t.id)}
                      subs={subs} rcSubs={rc.subTabs?.[t.id]}
                      onSetAll={() => setSubAll("ims", t.id)} onSetCustom={(ids) => setSubCustom("ims", t.id, ids)}
                      onToggleSub={(id) => toggleSub("ims", t.id, id)} />
                  );
                })}

                {/* Admin — the one branch with real depth beyond one layer of sub-tabs */}
                {(() => {
                  const on = (rc.tabs || []).includes("admin");
                  const rcAdmin = rc.subTabs?.admin || [];
                  const adminRestricted = rcAdmin.length > 0;
                  const settingsOn = !adminRestricted || rcAdmin.includes("settings");
                  const rcSettings = rc.subTabs?.settings || [];
                  const settingsRestricted = rcSettings.length > 0;
                  const settingsHas = (id) => !settingsRestricted || rcSettings.includes(id);
                  const masterdataOn = settingsHas("masterdata");
                  return (
                    <SectionRow icon="⚙️" label="Admin" on={on} onToggle={() => toggleTab("ims", "admin")} color="indigo"
                      subs={null} note={null}
                      extra={
                        <div className="space-y-1.5 mt-1">
                          <SectionRow dense icon="👤" label="Users & Roles" color="indigo"
                            on={!adminRestricted || rcAdmin.includes("users")} onToggle={() => toggleSub("ims", "admin", "users")} />
                          <SectionRow dense icon="🏢" label="Vendors" color="indigo"
                            on={!adminRestricted || rcAdmin.includes("vendors")} onToggle={() => toggleSub("ims", "admin", "vendors")} />
                          <SectionRow dense icon="⚙️" label="Settings" color="indigo"
                            on={settingsOn} onToggle={() => toggleSub("ims", "admin", "settings")}
                            note={'Every panel below is visible by default, same "all sub-tabs" rule as elsewhere.'}
                            subs={SETTINGS_PANELS.filter((p) => p.id !== "masterdata")}
                            rcSubs={settingsRestricted ? rcSettings.filter((id) => id !== "masterdata") : undefined}
                            onSetAll={() => setSubAll("ims", "settings")}
                            onSetCustom={(ids) => setSubCustom("ims", "settings", [...ids, "masterdata"])}
                            onToggleSub={(id) => toggleSub("ims", "settings", id)}
                            extra={
                              <SectionRow dense icon="🗂️" label="Master Data" color="indigo"
                                on={masterdataOn} onToggle={() => toggleSub("ims", "settings", "masterdata")}
                                subs={MASTER_DATA_CHILDREN} rcSubs={rc.subTabs?.masterdata}
                                onSetAll={() => setSubAll("ims", "masterdata")}
                                onSetCustom={(ids) => setSubCustom("ims", "masterdata", ids)}
                                onToggleSub={(id) => toggleSub("ims", "masterdata", id)} />
                            } />
                        </div>
                      } />
                  );
                })()}
              </div>
              <div className="text-[10.5px] text-gray-300 italic mt-2 pl-0.5">
                ✅ Approvals isn't listed here — it's granted automatically to whoever's eligible to approve, not something this screen controls.
              </div>
            </div>

            {/* ═══ STUDIO ═══ */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs">🎨</span>
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Studio</span>
                <div className="flex-1 h-px bg-amber-50" />
              </div>
              <div className="space-y-2">
                {STUDIO_TABS.map((t) => {
                  const on = (rcSt.tabs || []).includes(t.id);
                  const subs = STUDIO_SUBTABS[t.id];
                  const note = t.id === "design" ? "The deal builder itself (Event Info → Browse → Build → Summary) comes with this grant as one unit." : null;
                  const lockedNote = t.id === "library" ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 rounded-lg border border-dashed border-gray-200 mt-1">
                      <span className="text-xs text-gray-400">🔒</span>
                      <span className="text-[11px] text-gray-400">Palettes — always visible with Library access, can't be restricted</span>
                    </div>
                  ) : null;
                  return (
                    <SectionRow key={t.id} icon={t.label.split(" ")[0]} label={t.label.replace(/^\S+\s/, "")} color="amber"
                      on={on} onToggle={() => toggleTab("studio", t.id)}
                      subs={subs} rcSubs={rcSt.subTabs?.[t.id]} note={note} extra={lockedNote}
                      onSetAll={() => setSubAll("studio", t.id)} onSetCustom={(ids) => setSubCustom("studio", t.id, ids)}
                      onToggleSub={(id) => toggleSub("studio", t.id, id)} />
                  );
                })}
              </div>
            </div>

          </div>
        )}

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">{isAdminRole ? "Close" : "Done"}</button>
        </div>
      </div>
    </div>
  );
}

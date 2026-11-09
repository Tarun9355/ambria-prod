import { DEFAULT_ROLE_TABS } from "./constants";

// ═══ IMS/Studio tab structure + per-tab access — single source of truth ═══
// Moved out of RoleAccessModal.jsx (which used to define IMS_TABS/STUDIO_TABS etc. locally) so
// UsersTab.jsx's per-user override screen can read the exact same tab/sub-tab tree instead of
// growing its own drifted copy — the same failure mode RoleAccessModal.jsx's own history comment
// describes (Planning missing "Dept Ops", Flowers with a phantom sub-tab) happening one layer up.
//
// Two independent things live on `settings.roleTabs[role]` / a user's own `tabOverride`:
//   - Whether a tab/sub-tab is VISIBLE AT ALL (tabs/subTabs — unchanged, pre-existing).
//   - For tabs that declare a `ved` capability below, whether this role/user can EDIT and DELETE
//     within it (ved — new). There is no separate "view" flag: a tab's own on/off switch IS its
//     View permission, so Edit/Delete simply can't be true while the tab itself is off.
// `ved` capability per tab: `true` = View + Edit + Delete, `"ve"` = View + Edit only (no delete
// concept in that screen yet), `false`/absent = no Edit/Delete distinction at all — the existing
// single on/off switch is the whole story (Admin's own nested Users/Vendors/Settings tree already
// has its own finer structure and isn't touched by this).

export const IMS_TABS = [
  { id: "dashboard", label: "📊 Dashboard" },
  { id: "attendance", label: "👥 Attendance" },
  { id: "inventory", label: "📦 Inventory", ved: true },
  { id: "calendar", label: "🗓️ Calendar", ved: "ve" },
  { id: "planning", label: "📋 Planning", ved: "ve" },
  { id: "supply", label: "🛒 Supply", ved: true },
  { id: "flowers", label: "🌺 Flowers", ved: "ve" },
  { id: "finance", label: "💰 Finance", ved: "ve" },
  { id: "admin", label: "⚙️ Admin" },
  { id: "site", label: "🦺 Site", ved: true },
];
export const IMS_SUBTABS = {
  planning: [
    { id: "deptops", label: "🏦 Dept Ops" },
    { id: "structure", label: "🏗️ Truss/Platform/Batta" },
    { id: "paint", label: "🎨 Paint" },
    { id: "trussbatta", label: "🏗️ Truss & Batta Config" },
    { id: "platformconfig", label: "🛏️ Platform Config" },
    { id: "fabricstock", label: "🧵 Fabric Stock" },
    { id: "truck", label: "🚚 Truck" },
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
export const SETTINGS_PANELS = [
  { id: "labourtiers", label: "👷 Workforce" },
  { id: "venuemin", label: "🏛️ Fixed Venues" },
  { id: "venuedumping", label: "🚛 Venue Dumping" },
  { id: "dihari", label: "💰 Dihari Timings" },
  { id: "supervisors", label: "👷 Supervisors" },
  { id: "synonyms", label: "🔤 AI Synonyms" },
  { id: "masterdata", label: "🗂️ Master Data" },
  { id: "canva", label: "🎨 Canva" },
];
export const MASTER_DATA_CHILDREN = [
  { id: "subcats", label: "📂 Sub-Categories" },
  { id: "venues", label: "🌆 Venues" },
  { id: "printmaterials", label: "🖨️ Print Materials" },
  { id: "carpetmaterials", label: "🟫 Carpet & Platform" },
  { id: "structurerates", label: "🏗️ Truss & Masking" },
  { id: "transport", label: "🚛 Transport & Power" },
  { id: "departments", label: "🏦 Departments" },
];
export const STUDIO_TABS = [
  { id: "design", label: "🎨 Design Studio", ved: true },
  { id: "library", label: "📚 Library & Content", ved: true },
  { id: "settings", label: "⚙️ Settings", ved: "ve" },
];
export const STUDIO_SUBTABS = {
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

// IMS tab ids a role sees before anyone has ever opened Edit Access for it — the same "every tab
// except Site" fallback IMS.jsx's own roleConfig uses, so a brand-new role doesn't read as
// "everything off" here while the app itself already grants it most of IMS.
const defaultImsTabIds = () => IMS_TABS.filter((t) => t.id !== "site").map((t) => t.id);

// The role's own resolved tab config — mirrors IMS.jsx's `roleConfig` (line ~2660) and
// StudioApp.jsx's `studioCfg` (line ~2687) EXACTLY, including their fallback chains, so a role this
// screen has never been opened for shows the access that role ACTUALLY already has in the app,
// not an "everything off" picture that doesn't match reality.
function resolvedRoleConfig(role, settings, app) {
  if (app === "studio") return settings?.roleTabs?.[role]?.studio || { tabs: ["design"], subTabs: {} };
  return settings?.roleTabs?.[role] || DEFAULT_ROLE_TABS[role] || { tabs: defaultImsTabIds() };
}

// ── ROLE-level reads (settings.roleTabs[role]) ──
export function roleTabOn(role, settings, app, tabId) {
  if (role === "Admin") return true;
  // Attendance is forced on for every role, Dashboard is Admin-only — both hardcoded in IMS.jsx,
  // never part of any role's own Tab Access config (RoleAccessModal.jsx hides both rows for the
  // same reason: there is nothing for a role to configure here).
  if (app === "ims" && tabId === "attendance") return true;
  if (app === "ims" && tabId === "dashboard") return false;
  return (resolvedRoleConfig(role, settings, app).tabs || []).includes(tabId);
}
// Edit/Delete default TRUE when never configured — "restriction is opt-in", the same rule the
// existing sub-tab visibility already follows (an absent/empty subTabs[parent] means every child
// is visible). Shipping this feature must not silently take away access nobody ever restricted.
export function roleTabVed(role, settings, app, tabId) {
  if (role === "Admin") return { edit: true, del: true };
  const v = (resolvedRoleConfig(role, settings, app).ved || {})[tabId] || {};
  return { edit: v.edit !== false, del: v.del !== false };
}
// null = unrestricted (every child visible); else the explicit array of visible child ids.
export function roleSubTabs(role, settings, app, parentId) {
  if (role === "Admin") return null;
  const list = resolvedRoleConfig(role, settings, app).subTabs?.[parentId];
  return Array.isArray(list) && list.length ? list : null;
}

// ── USER-level effective reads (role default, with this one user's own tabOverride on top) ──
// user.tabOverride = { ims: { tabs: {[tabId]: bool}, ved: {[tabId]: {edit?, del?}}, subTabs:
// {[parentId]: string[]} }, studio: {...same shape...} } — any key PRESENT overrides that one
// field; an absent key means "inherit from the role", exactly like settings.rolePerms already
// works for the flat Actions permissions.
//
// `user` here is sometimes the camelCase `rowToUser()` object (the Admin → Users list) and
// sometimes the raw Supabase row `useAuth()`/`fetchProfile()` hand back for the LOGGED-IN user
// (snake_case `tab_override`, never remapped) — every real enforcement call site passes the
// latter. Reading both spellings here, once, is simpler and safer than fixing every caller.
const ovOf = (user) => user?.tabOverride ?? user?.tab_override ?? null;
export function userTabOn(user, settings, app, tabId) {
  if (user?.role === "Admin" || user?.id === "u_admin") return true;
  const ov = ovOf(user)?.[app]?.tabs;
  if (ov && Object.prototype.hasOwnProperty.call(ov, tabId)) return !!ov[tabId];
  return roleTabOn(user?.role, settings, app, tabId);
}
export function userTabVed(user, settings, app, tabId) {
  if (user?.role === "Admin" || user?.id === "u_admin") return { edit: true, del: true };
  const base = roleTabVed(user?.role, settings, app, tabId);
  const v = ovOf(user)?.[app]?.ved?.[tabId];
  if (!v) return base;
  return { edit: v.edit != null ? v.edit : base.edit, del: v.del != null ? v.del : base.del };
}
// A user-level override needs a THIRD state an empty array can't represent on its own: "inherit
// the role" (key absent), "explicitly show every sub-tab regardless of what the role restricts"
// (the sentinel string "ALL"), and "explicitly show only these" (an array — which CAN legitimately
// be empty, meaning this one person sees none of this tab's sub-tabs at all). Collapsing "explicit
// all" onto a bare `[]` meant un-checking a restricted role's very last visible sub-tab silently
// re-granted every other one — confirmed bug, fixed by giving "all" its own sentinel instead of
// overloading the empty array.
export function userSubTabs(user, settings, app, parentId) {
  if (user?.role === "Admin" || user?.id === "u_admin") return null;
  const ov = ovOf(user)?.[app]?.subTabs;
  if (ov && Object.prototype.hasOwnProperty.call(ov, parentId)) {
    const v = ov[parentId];
    return v === "ALL" ? null : (Array.isArray(v) ? v : null);
  }
  return roleSubTabs(user?.role, settings, app, parentId);
}
// Which of this one tab's fields (on/edit/del) differ from what the role alone would give —
// drives the "customized for this user" badges in the Edit User override tree.
export function userTabCustom(user, app, tabId) {
  const ov = ovOf(user)?.[app] || {};
  return {
    on: !!(ov.tabs && Object.prototype.hasOwnProperty.call(ov.tabs, tabId)),
    edit: !!(ov.ved?.[tabId] && ov.ved[tabId].edit != null),
    del: !!(ov.ved?.[tabId] && ov.ved[tabId].del != null),
    subTabs: !!(ov.subTabs && Object.prototype.hasOwnProperty.call(ov.subTabs, tabId)),
  };
}
export function userHasAnyOverride(user) {
  const t = ovOf(user);
  if (!t) return false;
  return ["ims", "studio"].some((app) => {
    const a = t[app];
    return a && ((a.tabs && Object.keys(a.tabs).length) || (a.ved && Object.keys(a.ved).length) || (a.subTabs && Object.keys(a.subTabs).length));
  });
}

// ── The one enforcement check a gated control calls ──
// action: "view" (is the tab/sub-tab visible), "edit" or "del" (only meaningful on a tab whose
// IMS_TABS/STUDIO_TABS entry declares that capability — a tab with no `ved` has no edit/del
// concept, so this returns true for those the same way "the tab is on" always has).
export function hasTabPerm(user, settings, app, tabId, action = "view") {
  if (user?.role === "Admin" || user?.id === "u_admin") return true;
  if (!userTabOn(user, settings, app, tabId)) return false;
  if (action === "view") return true;
  return !!userTabVed(user, settings, app, tabId)[action];
}

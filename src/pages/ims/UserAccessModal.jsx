import { PERM_GROUPS, PERM_LABELS, PERM_UNWIRED, effectiveRolePerms } from "../../lib/ims/constants";
import { IMS_TABS, IMS_SUBTABS, STUDIO_TABS, STUDIO_SUBTABS, roleTabOn, roleTabVed, roleSubTabs, userTabOn, userTabVed, userSubTabs, userTabCustom, userHasAnyOverride } from "../../lib/ims/tabAccess";
import { SectionRow } from "./RoleAccessModal.jsx";

// ═══ PER-USER ACCESS OVERRIDE — dedicated modal, same chrome/tree as RoleAccessModal but scoped to
// ONE user's form.tabOverride/form.permissions, layered on top of their role's own Edit Access
// config (settings.roleTabs/rolePerms) instead of replacing it. Pulled out of Edit User's own inline
// "▸ Override for this user" panel (owner ask, 2026-11-16) so a per-user exception gets the same
// full-size, dedicated-modal treatment the role screen already has, via a "🔐 Change Perms" button,
// instead of being cramped into Edit User's own right-hand column.
//
// Mirrors RoleAccessModal's own self-contained pattern: every mutator here is defined locally off
// the `form`/`setForm`/`settings` props, the same way RoleAccessModal defines its own off
// `role`/`settings`/`setSettings` — kept as two separate small functions rather than one shared one
// since a role's mutators write straight to settings.roleTabs while a user's write to
// form.tabOverride (a layer ON TOP of that), different enough shapes that sharing one function would
// need an app/role-vs-user branch on every call.

export default function UserAccessModal({ form, setForm, settings, onClose }) {
  const roleDefaultPerms = effectiveRolePerms(form.role, settings);
  const permsOverridden = JSON.stringify([...(form.permissions || [])].sort()) !== JSON.stringify([...roleDefaultPerms].sort());
  const anyOverridden = permsOverridden || userHasAnyOverride(form);

  const patchUserOverride = (app, updater) => setForm((f) => {
    const cur = f.tabOverride || {};
    const appCur = cur[app] || {};
    return { ...f, tabOverride: { ...cur, [app]: updater(appCur) } };
  });
  const userToggleTab = (app, tabId) => patchUserOverride(app, (appCur) => {
    const next = !userTabOn(form, settings, app, tabId);
    const tabs = { ...(appCur.tabs || {}) };
    if (next === roleTabOn(form.role, settings, app, tabId)) delete tabs[tabId]; else tabs[tabId] = next;
    return { ...appCur, tabs };
  });
  const userResetTab = (app, tabId) => patchUserOverride(app, (appCur) => {
    const tabs = { ...(appCur.tabs || {}) }; delete tabs[tabId];
    const ved = { ...(appCur.ved || {}) }; delete ved[tabId];
    const subTabs = { ...(appCur.subTabs || {}) }; delete subTabs[tabId];
    return { ...appCur, tabs, ved, subTabs };
  });
  const userToggleVed = (app, tabId, field) => patchUserOverride(app, (appCur) => {
    const cur = userTabVed(form, settings, app, tabId);
    const next = !cur[field];
    const roleVal = roleTabVed(form.role, settings, app, tabId)[field];
    const entry = { ...((appCur.ved || {})[tabId] || {}) };
    if (next === roleVal) delete entry[field]; else entry[field] = next;
    const ved = { ...(appCur.ved || {}) };
    if (Object.keys(entry).length) ved[tabId] = entry; else delete ved[tabId];
    return { ...appCur, ved };
  });
  const userSetSubAll = (app, parent) => patchUserOverride(app, (appCur) => {
    const subTabs = { ...(appCur.subTabs || {}) };
    if (roleSubTabs(form.role, settings, app, parent) === null) delete subTabs[parent];
    else subTabs[parent] = "ALL";
    return { ...appCur, subTabs };
  });
  const userSetSubCustom = (app, parent, allIds) => patchUserOverride(app, (appCur) => {
    const subTabs = { ...(appCur.subTabs || {}), [parent]: [...allIds] };
    return { ...appCur, subTabs };
  });
  const userToggleSub = (app, parent, subId, allIds) => patchUserOverride(app, (appCur) => {
    const effective = userSubTabs(form, settings, app, parent); // null = every child currently shown
    const curList = effective || allIds;
    const has = curList.includes(subId);
    const subTabs = { ...(appCur.subTabs || {}), [parent]: has ? curList.filter((x) => x !== subId) : [...curList, subId] };
    return { ...appCur, subTabs };
  });
  const togglePerm = (p) => setForm((f) => ({ ...f, permissions: (f.permissions || []).includes(p) ? (f.permissions || []).filter((x) => x !== p) : [...(f.permissions || []), p] }));
  const resetPermsToRoleDefault = () => setForm((f) => ({ ...f, permissions: [...effectiveRolePerms(f.role, settings)] }));

  // z-[60], not z-50 — this is reachable from INSIDE the Edit User modal (also z-50, components/ui's
  // Modal), which isn't a portal: with equal z-index, Edit User's later DOM position painted over
  // this one, so clicking "🔐 Change Perms" silently did nothing visible (regression review,
  // 2026-11-16). RoleAccessModal has the exact same latent reachability via Edit User's own "Edit
  // this role's defaults" link and gets the same bump for the same reason.
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-5 overflow-y-auto" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Edit Access</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5">{form.name || "This user"}</div>
            <div className={`text-[11px] mt-0.5 ${anyOverridden ? "text-amber-700 font-semibold" : "text-gray-400"}`}>
              {anyOverridden ? `⚠ Customized — differs from ${form.role}'s role default` : `Inheriting ${form.role}'s role default — nothing customized yet`}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg border text-gray-400 hover:text-gray-600 hover:bg-gray-50">✕</button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">

          {/* ═══ IMS ═══ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-xs">🛠️</span>
              <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">IMS</span>
              <div className="flex-1 h-px bg-indigo-50" />
              {userHasAnyOverride(form) && (
                <button type="button" onClick={() => setForm((f) => ({ ...f, tabOverride: {} }))} className="text-[11px] text-rose-600 hover:underline shrink-0">↺ Reset all tab access</button>
              )}
            </div>
            <div className="space-y-2">
              {IMS_TABS.filter((t) => t.id !== "dashboard" && t.id !== "attendance").map((t) => {
                if (t.id === "admin") {
                  const adminCustom = userTabCustom(form, "ims", "admin").on;
                  return (
                    <div key={t.id} className="relative">
                      <SectionRow icon="⚙️" label="Admin" color="indigo"
                        on={userTabOn(form, settings, "ims", "admin")} onToggle={() => userToggleTab("ims", "admin")}
                        extra={<div className="text-[10.5px] text-gray-400">Admin's own Users &amp; Roles / Vendors / Settings tree follows the role only — no per-user override yet.</div>} />
                      {adminCustom && (
                        <button type="button" onClick={() => userResetTab("ims", "admin")} title="Reset this tab to the role default"
                          className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center shadow">↺</button>
                      )}
                    </div>
                  );
                }
                const subs = IMS_SUBTABS[t.id];
                const custom = userTabCustom(form, "ims", t.id);
                return (
                  <div key={t.id} className="relative">
                    <SectionRow icon={t.label.split(" ")[0]} label={t.label.replace(/^\S+\s/, "")} color="indigo"
                      on={userTabOn(form, settings, "ims", t.id)} onToggle={() => userToggleTab("ims", t.id)}
                      subs={subs} rcSubs={userSubTabs(form, settings, "ims", t.id)}
                      onSetAll={() => userSetSubAll("ims", t.id)} onSetCustom={(ids) => userSetSubCustom("ims", t.id, ids)}
                      onToggleSub={(id) => userToggleSub("ims", t.id, id, (subs || []).map((s) => s.id))} allowEmptySubs
                      ved={t.ved} vedState={userTabVed(form, settings, "ims", t.id)} onToggleVed={(f) => userToggleVed("ims", t.id, f)}
                      vedCustom={{ edit: custom.edit, del: custom.del }} />
                    {(custom.on || custom.edit || custom.del || custom.subTabs) && (
                      <button type="button" onClick={() => userResetTab("ims", t.id)} title="Reset this tab to the role default"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center shadow">↺</button>
                    )}
                  </div>
                );
              })}
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
                const subs = STUDIO_SUBTABS[t.id];
                const custom = userTabCustom(form, "studio", t.id);
                return (
                  <div key={t.id} className="relative">
                    <SectionRow icon={t.label.split(" ")[0]} label={t.label.replace(/^\S+\s/, "")} color="amber"
                      on={userTabOn(form, settings, "studio", t.id)} onToggle={() => userToggleTab("studio", t.id)}
                      subs={subs} rcSubs={userSubTabs(form, settings, "studio", t.id)}
                      onSetAll={() => userSetSubAll("studio", t.id)} onSetCustom={(ids) => userSetSubCustom("studio", t.id, ids)}
                      onToggleSub={(id) => userToggleSub("studio", t.id, id, (subs || []).map((s) => s.id))} allowEmptySubs
                      ved={t.ved} vedState={userTabVed(form, settings, "studio", t.id)} onToggleVed={(f) => userToggleVed("studio", t.id, f)}
                      vedCustom={{ edit: custom.edit, del: custom.del }} />
                    {(custom.on || custom.edit || custom.del || custom.subTabs) && (
                      <button type="button" onClick={() => userResetTab("studio", t.id)} title="Reset this tab to the role default"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center shadow">↺</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ ACTIONS ═══ */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-xs">⚡</span>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">Actions</span>
              <div className="flex-1 h-px bg-emerald-50" />
              {permsOverridden && <button type="button" onClick={resetPermsToRoleDefault} className="text-[11px] text-rose-600 hover:underline shrink-0">↺ Reset</button>}
            </div>
            <div className="space-y-2.5">
              {Object.entries(PERM_GROUPS).map(([group, perms]) => (
                <div key={group} className="border border-emerald-100 rounded-lg px-3 py-2.5 bg-emerald-50/40">
                  <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide mb-1.5">{group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {perms.map((p) => {
                      const on = (form.permissions || []).includes(p);
                      const unwired = PERM_UNWIRED.has(p);
                      return (
                        <button key={p} type="button" onClick={() => togglePerm(p)}
                          title={unwired ? "Not yet wired to any control in the app — safe to set, just has no effect yet" : undefined}
                          className={`inline-flex items-center gap-1 rounded-full font-semibold text-[11.5px] px-2.5 py-1 ${on ? "bg-emerald-100 text-emerald-800" : "bg-white text-gray-400 border border-gray-200"}`}>
                          {on ? "✓ " : ""}{PERM_LABELS[p] || p}{unwired ? " ⚪" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Done</button>
        </div>
      </div>
    </div>
  );
}

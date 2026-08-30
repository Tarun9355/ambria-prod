import { useState } from "react";
import { Badge, Modal } from "../../components/ui";
import { ROLES, ROLE_DEFAULTS, PERM_LABELS, PERM_GROUPS } from "../../lib/ims/constants";
import { callUserAdmin } from "../../lib/userAdmin";
import { DEPTS, userDepartments } from "../../lib/ims/deptClassify";
import RoleAccessModal from "./RoleAccessModal.jsx";

// App-access default derived from role (the one addition to the reference).
const defaultApps = (role) => role === "Admin" ? ["studio","ims"] : role === "Sales" ? ["studio"] : ["ims"];
// Department default derived from role — same inference Dept Ops has always used (a role name
// containing one of the 7 departments implies that one), just surfaced here so it's editable
// instead of only ever guessed at read time. userDepartments returns null when unrestricted
// (most roles); the form field itself always wants a real array to render checkboxes against.
const defaultDepartments = (role) => userDepartments({ role }) || [];

export default function UsersTab({ users, setUsers, addUser, settings, setSettings }){
  const [modal, setModal]=useState(false);
  const [editUser, setEditUser]=useState(null);
  const [form, setForm]=useState({ name:"", email:"", phone:"", role:"Sales", permissions:ROLE_DEFAULTS.Sales, active:true, password:"", departments:defaultDepartments("Sales") });
  const [credsShown, setCredsShown]=useState(null);
  const [resetFor, setResetFor]=useState(null);
  const [resetPw, setResetPw]=useState("");
  const [showPw, setShowPw]=useState(false);
  const [roleEditor, setRoleEditor]=useState(null); // role name being edited
  const [newRoleName, setNewRoleName]=useState("");
  const [renameRole, setRenameRole]=useState(null); // {old, draft}

  // Dynamic roles from settings (fallback to hardcoded ROLES)
  const dynamicRoles = Array.isArray(settings?.rolesList) ? settings.rolesList : ROLES;
  const roleCounts=dynamicRoles.reduce((acc,r)=>({ ...acc, [r]:users.filter(u=>u.role===r).length }),{});

  // Derive username from display name: lowercase, spaces → _, strip non-alphanumerics
  const deriveUsername = (name) => (name||"").trim().toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");

  // Generate a readable password: "{NamePrefix}-{4 chars}". E.g. "Ashi-7K42"
  // Mix of digits + uppercase letters (no ambiguous chars like 0/O/1/I/l).
  const generatePassword = (nameSeed) => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1/l
    const prefix = (nameSeed||"User").trim().replace(/\s+.*$/,"").slice(0,5) || "User";
    let suffix = "";
    for (let i=0; i<4; i++) suffix += chars[Math.floor(Math.random()*chars.length)];
    return `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()}-${suffix}`;
  };

  function openAdd(){ setEditUser(null); setForm({ name:"", email:"", phone:"", role:"Sales", permissions:[...(ROLE_DEFAULTS.Sales||[])], active:true, password:"", apps:defaultApps("Sales"), departments:defaultDepartments("Sales") }); setShowPw(false); setModal(true); }
  function openEdit(u){ setEditUser(u); setForm({ ...u, permissions:[...(u.permissions||[])], password:"", apps:u.apps || defaultApps(u.role), departments:[...(u.departments || defaultDepartments(u.role))] }); setShowPw(false); setModal(true); }
  function setRole(role){ setForm(f=>({...f, role, permissions:[...(ROLE_DEFAULTS[role]||[])], apps:defaultApps(role), departments:defaultDepartments(role)})); }
  function togglePerm(p){ setForm(f=>({ ...f, permissions:(f.permissions||[]).includes(p)?(f.permissions||[]).filter(x=>x!==p):[...(f.permissions||[]),p] })); }
  function toggleApp(a){ setForm(f=>{ const cur=f.apps || defaultApps(f.role); return { ...f, apps:cur.includes(a)?cur.filter(x=>x!==a):[...cur,a] }; }); }
  function toggleDept(d){ setForm(f=>{ const cur=f.departments || []; return { ...f, departments:cur.includes(d)?cur.filter(x=>x!==d):[...cur,d] }; }); }

  const [busy, setBusy] = useState(false);
  async function save(){
    if(!form.name || !form.name.trim()){ alert("Name is required"); return; }
    const username = deriveUsername(form.name);
    if(!username){ alert("Name must contain at least one letter or digit"); return; }
    if(editUser){
      // Edit path: profile fields only (password has its own flow). Writes non-password columns.
      const { password, ...rest } = form;
      setUsers(prev=>prev.map(u=>u.id===editUser.id?{...u, ...rest, username: editUser.username || username}:u));
      setModal(false);
      return;
    }
    // Add path: must have password
    if(!form.password || !form.password.trim()){ alert("Password is required"); return; }
    // Username uniqueness check
    if(users.some(u => (u.username||"") === username)){
      alert(`Username "${username}" already exists. Choose a different name.`);
      return;
    }
    const mint = () => "U" + (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const taken = new Set((users || []).map(u => String(u.id)));
    let newId = mint(); while (taken.has(newId)) newId = mint();
    // Create the Supabase Auth account + profile row server-side (service role, admin-gated).
    // The new row arrives via realtime; we just confirm the credentials.
    const profile = { id: newId, name: form.name.trim(), username, role: form.role, permissions: form.permissions || [], apps: form.apps || defaultApps(form.role), departments: form.departments || defaultDepartments(form.role), phone: form.phone || "", email: form.email || "", active: form.active ?? true };
    setBusy(true);
    try { await callUserAdmin("createUser", { user: profile, password: form.password.trim() }); }
    catch(e){ setBusy(false); alert("Create user failed: " + e.message); return; }
    setBusy(false);
    setModal(false);
    setCredsShown({ name: form.name.trim(), username, password: form.password.trim(), isReset: false });
  }
  function toggleActive(id){ setUsers(prev=>prev.map(u=>u.id===id?{...u,active:!u.active}:u)); }
  async function deleteUser(id){
    const u = users.find(x=>x.id===id);
    if(!window.confirm(`Delete user "${u?.name || u?.username || "this user"}"?\n\nThis cannot be undone.`)) return;
    try { await callUserAdmin("deleteUser", { userId: id }); }
    catch(e){ alert("Delete failed: " + e.message); }
  }

  // Reset Password flow — sets the password in Supabase Auth (creates the account if the user hasn't
  // been migrated yet), via the admin-gated edge function.
  function openReset(u){ setResetFor(u); setResetPw(""); }
  async function confirmReset(){
    if(!resetPw || !resetPw.trim()){ alert("Enter a new password"); return; }
    const newPw = resetPw.trim();
    const u = resetFor;
    setBusy(true);
    try { await callUserAdmin("setPassword", { userId: u.id, password: newPw }); }
    catch(e){ setBusy(false); alert("Reset failed: " + e.message); return; }
    setBusy(false);
    setResetFor(null);
    setResetPw("");
    setCredsShown({ name: u.name, username: u.username || deriveUsername(u.name), password: newPw, isReset: true });
  }
  function copy(text){
    try{ navigator.clipboard.writeText(text); }catch{}
  }

  return (
    <div className="space-y-4">
      {/* Role Summary — each card opens a dedicated Edit Access modal instead of expanding inline
          below the grid (the old inline panel got bulky once Admin's real depth — Settings, then
          Master Data inside it — needed room too). */}
      <div className="grid grid-cols-4 gap-3">
        {dynamicRoles.map(r=>(
          <div key={r} className="bg-white border rounded-xl p-4 text-center relative group hover:border-indigo-300 transition-all">
            {r !== "Admin" && <button onClick={(e)=>{e.stopPropagation(); if(!window.confirm(`Delete role "${r}"? ${roleCounts[r]||0} users will need reassignment.`)) return; setSettings(s=>({...s, rolesList:(s.rolesList||ROLES).filter(x=>x!==r)})); if(roleEditor===r) setRoleEditor(null);}} className="absolute top-1 right-2 text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">✕</button>}
            <p className="text-2xl font-bold text-indigo-700">{roleCounts[r]||0}</p>
            {renameRole?.old === r ? (
              <div className="flex items-center gap-1 mt-1">
                <input value={renameRole.draft} onChange={e=>setRenameRole({...renameRole, draft:e.target.value})} className="border rounded px-2 py-0.5 text-xs w-full" autoFocus onKeyDown={e=>{if(e.key==="Enter"&&renameRole.draft.trim()){const old=renameRole.old,nw=renameRole.draft.trim(); setSettings(s=>{const rt={...(s.roleTabs||{})}; rt[nw]=rt[old]; delete rt[old]; return {...s,rolesList:(s.rolesList||ROLES).map(x=>x===old?nw:x),roleTabs:rt};}); setUsers(prev=>prev.map(u=>u.role===old?{...u,role:nw}:u)); setRenameRole(null); if(roleEditor===old) setRoleEditor(nw);}}} />
                <button onClick={()=>setRenameRole(null)} className="text-xs text-gray-400">✕</button>
              </div>
            ) : (
              <p className="text-xs text-gray-500 mt-1 cursor-pointer" onDoubleClick={()=>{if(r!=="Admin")setRenameRole({old:r,draft:r});}}>{r}</p>
            )}
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t">
              <button onClick={()=>setRoleEditor(r)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100">
                🔐 Manage Access
              </button>
            </div>
          </div>
        ))}
        <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400" onClick={()=>{const name=window.prompt("New role name:");if(name&&name.trim()&&!dynamicRoles.includes(name.trim())){setSettings(s=>({...s,rolesList:[...(s.rolesList||ROLES),name.trim()],roleTabs:{...(s.roleTabs||{}), [name.trim()]:{tabs:["dashboard"],subTabs:{}}}}));}}}>
          <p className="text-2xl text-indigo-300">+</p>
          <p className="text-xs text-indigo-400 mt-1">Create role</p>
        </div>
      </div>

      {roleEditor && <RoleAccessModal key={roleEditor} role={roleEditor} settings={settings} setSettings={setSettings} onClose={()=>setRoleEditor(null)} />}

      <div className="flex justify-end">
        <button onClick={openAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ Add User</button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              {["Name","Role","Email / Phone","Permissions","Status","Actions"].map(h=>(
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u=>(
              <tr key={u.id} className={"border-t "+(u.active?"":"opacity-50")}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.id}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge color={u.role==="Admin"?"red":u.role==="Sales"?"blue":u.role==="Production"?"amber":"green"}>{u.role}</Badge>
                  <div className="flex gap-1 mt-1">
                    {(u.apps || defaultApps(u.role)).map(a=>(
                      <span key={a} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{a==="studio"?"🎨":"🛠️"}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-gray-600">{u.email}</p>
                  <p className="text-xs text-gray-400">{u.phone}</p>
                </td>
                <td className="px-4 py-3"><span className="text-xs text-gray-500">{u.permissions.length} permissions</span></td>
                <td className="px-4 py-3"><Badge color={u.active?"green":"gray"}>{u.active?"Active":"Inactive"}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={()=>openEdit(u)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    <button onClick={()=>openReset(u)} className="text-xs text-amber-700 hover:underline px-1.5 py-0.5 bg-amber-50 rounded">🔑 Reset PW</button>
                    <button onClick={()=>toggleActive(u.id)} className="text-xs text-amber-600 hover:underline">{u.active?"Deactivate":"Activate"}</button>
                    <button onClick={()=>deleteUser(u.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={()=>setModal(false)} title={editUser?"Edit User":"Add User"} wide>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            {[["Full Name","name"],["Email","email"],["Phone","phone"]].map(([l,k])=>(
              <div key={k}><label className="text-xs text-gray-500">{l}</label>
                <input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
            ))}
            {/* Password section (only required for new users — edits use the Reset PW row button) */}
            {!editUser && (
              <div className="bg-amber-50 border-l-4 border-amber-400 rounded p-3">
                <div className="text-xs font-medium text-amber-800 mb-1.5">🔑 Password <span className="text-amber-600">(shown once — copy after save)</span></div>
                <div className="flex gap-1.5 items-center">
                  <input type={showPw?"text":"password"} value={form.password} placeholder="Type or generate"
                    onChange={e=>setForm({...form,password:e.target.value})}
                    className="flex-1 border border-amber-300 rounded px-2 py-1.5 text-sm font-mono bg-white text-amber-900" />
                  <button type="button" onClick={()=>setShowPw(s=>!s)} title={showPw?"Hide":"Show"}
                    className="px-2 py-1.5 border border-amber-300 rounded text-xs bg-white text-amber-700 hover:bg-amber-100">{showPw?"🙈":"👁"}</button>
                  <button type="button" onClick={()=>setForm(f=>({...f,password:generatePassword(f.name)}))}
                    className="px-2 py-1.5 border border-amber-300 rounded text-xs bg-white text-amber-700 hover:bg-amber-100">🎲 Generate</button>
                </div>
                <p className="text-[10px] text-amber-700 mt-1.5">Login username will be: <span className="font-mono font-semibold">{deriveUsername(form.name) || "—"}</span></p>
              </div>
            )}
            {editUser && (
              <div className="bg-gray-50 rounded p-2.5 text-xs text-gray-600">
                <span className="font-medium">Login username:</span> <span className="font-mono">{editUser.username || deriveUsername(editUser.name)}</span><br/>
                <span className="text-gray-500">To change password, close this and click "🔑 Reset PW" on the row.</span>
              </div>
            )}
            <div><label className="text-xs text-gray-500">Role</label>
              <select value={form.role} onChange={e=>setRole(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                {dynamicRoles.map(r=><option key={r}>{r}</option>)}
              </select></div>
            {/* App access — Studio / IMS (the one addition to the reference) */}
            <div><label className="text-xs text-gray-500">App access</label>
              <div className="flex gap-2 mt-1">
                {[["studio","🎨 Studio"],["ims","🛠️ IMS"]].map(([id,label])=>{
                  const apps = form.apps || defaultApps(form.role);
                  const on = apps.includes(id);
                  return (
                    <button key={id} type="button" onClick={()=>toggleApp(id)}
                      className={"px-3 py-1.5 rounded-full text-xs font-medium border transition-all "+(on?"bg-indigo-100 border-indigo-300 text-indigo-700":"bg-gray-50 border-gray-200 text-gray-400")}>
                      {on?"✓ ":""}{label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Department access — which of the 7 ops departments this user's data views (Inventory,
                Production, Dept Ops) are scoped to. Empty = unrestricted (sees every department),
                the same as every user before this field existed. Pre-ticked from the role name
                (setRole/openEdit's defaultDepartments) but freely editable — this is the "explicitly
                assign a user multiple departments" path. */}
            <div>
              <label className="text-xs text-gray-500">Department access <span className="text-gray-400">(none ticked = sees every department)</span></label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {DEPTS.map((d) => {
                  const on = (form.departments || []).includes(d);
                  return (
                    <button key={d} type="button" onClick={()=>toggleDept(d)}
                      className={"px-3 py-1.5 rounded-full text-xs font-medium border transition-all "+(on?"bg-emerald-100 border-emerald-300 text-emerald-700":"bg-gray-50 border-gray-200 text-gray-400")}>
                      {on?"✓ ":""}{d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-500 mb-2">Role Presets:</p>
              <div className="flex gap-2 flex-wrap">
                {dynamicRoles.map(r=>(
                  <button key={r} onClick={()=>setRole(r)}
                    className="text-xs border rounded-lg px-2 py-1 hover:bg-indigo-50 hover:border-indigo-300">{r} defaults</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Permissions ({(form.permissions||[]).length} enabled)</p>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {Object.entries(PERM_GROUPS).map(([group, perms])=>(
                <div key={group} className="border rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">{group}</p>
                  <div className="space-y-1">
                    {perms.map(p=>(
                      <label key={p} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={(form.permissions||[]).includes(p)} onChange={()=>togglePerm(p)} className="rounded" />
                        <span className="text-xs text-gray-600">{PERM_LABELS[p]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
          <button onClick={()=>setModal(false)} className="px-4 py-2 border rounded-lg text-sm text-gray-600">Cancel</button>
          <button onClick={save} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Save User</button>
        </div>
      </Modal>

      {/* Post-save / post-reset credential confirmation — shown ONCE */}
      <Modal open={!!credsShown} onClose={()=>setCredsShown(null)} title={credsShown?.isReset ? "🔑 Password Reset" : "✓ User Created"}>
        {credsShown && (
          <div>
            <div className="text-sm font-medium text-green-700 mb-1">
              {credsShown.isReset ? "Password reset for " : "User created · "}<span className="text-gray-900">{credsShown.name}</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">Share these credentials with the team member. Closing this dialog means the password is gone — only a reset will work after.</p>

            <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-center mb-2">
              <span className="text-xs text-gray-500">Username</span>
              <span className="font-mono text-sm bg-gray-100 px-2.5 py-1.5 rounded">{credsShown.username}</span>
              <button onClick={()=>copy(credsShown.username)} className="px-2.5 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">📋 Copy</button>
            </div>
            <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-center mb-4">
              <span className="text-xs text-gray-500">Password</span>
              <span className="font-mono text-sm bg-gray-100 px-2.5 py-1.5 rounded">{credsShown.password}</span>
              <button onClick={()=>copy(credsShown.password)} className="px-2.5 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">📋 Copy</button>
            </div>

            <div className="bg-amber-50 text-amber-800 text-xs p-2.5 rounded mb-4">
              ⚠️ Once you close this, the password is not shown again. To restore access if lost: <strong>Reset Password</strong> from the user row.
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={()=>{ copy(`Username: ${credsShown.username}\nPassword: ${credsShown.password}`); setCredsShown(null); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">📋 Copy both & close</button>
              <button onClick={()=>setCredsShown(null)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs">Done</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reset Password mini-modal */}
      <Modal open={!!resetFor} onClose={()=>{setResetFor(null);setResetPw("");}} title="🔑 Reset Password">
        {resetFor && (
          <div>
            <div className="text-sm text-gray-700 mb-1">Resetting password for <span className="font-medium">{resetFor.name}</span> (@{resetFor.username||deriveUsername(resetFor.name)})</div>
            <p className="text-xs text-gray-500 mb-4">The current password will be replaced. Once saved, the new password is shown once for you to share.</p>

            <label className="text-xs text-gray-500">New Password</label>
            <div className="flex gap-1.5 items-center mt-1 mb-4">
              <input type="text" value={resetPw} onChange={e=>setResetPw(e.target.value)} placeholder="Type or generate"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm font-mono" />
              <button type="button" onClick={()=>setResetPw(generatePassword(resetFor.name))}
                className="px-3 py-2 border border-gray-300 rounded text-xs hover:bg-gray-50">🎲 Generate</button>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={()=>{setResetFor(null);setResetPw("");}} className="px-4 py-2 border border-gray-300 rounded-lg text-xs text-gray-700">Cancel</button>
              <button onClick={confirmReset} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs">Confirm Reset</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, subscribeTable } from "../../lib/supabase";
import { uploadToStorage, compressPunchPhoto, STORAGE_FOLDERS } from "../../lib/storage";
import { todayStr, getCurrentCoords, resolvePunchLocation, reverseGeocode, punchLocationLabel } from "../../lib/ims/attendance";
import {
  labourPunchDepts, labourManageDepts, fetchLabours, insertLabour, deactivateLabour, newLabourId,
  fetchDayLabourPunches, insertLabourPunch, newLabourPunchId, lastPunchByLabour,
  fetchLabourAccessForDepts, grantLabourAccess, revokeLabourAccess, DEPT_ICON,
} from "../../lib/ims/labourAttendance";
import LabourPunchCamera from "./LabourPunchCamera.jsx";
import { SelectPopover } from "./AttendanceAdminLog.jsx";
import { phone10 } from "../../lib/ims/helpers";
import { IconUsers, IconSearch, IconPlusCircle, IconTrash, IconPin, IconLock, IconX } from "../../components/icons.jsx";

// ═══ LABOUR PUNCH ═══ (Attendance → Labour Punch)
// One person with access — a guard, a site supervisor — punches a department's labours in and out
// from their own phone: pick the labour, take their photo, done (no briefing video or quiz; that is
// the staff flow). Who may do this is decided per department by Admin only,
// in the "Who can punch" card at the bottom. See lib/ims/labourAttendance.js for the rules.

const deptOptions = (depts) => depts.map((d) => ({ value: d, label: `${DEPT_ICON[d] || ""} ${d}` }));
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const COORDS_MAX_AGE_MS = 2 * 60 * 1000;

export default function LabourPunchPanel({ authUser, users, settings, myAccess, onAccessChanged }) {
  const punchDepts = useMemo(() => labourPunchDepts(authUser, myAccess), [authUser, myAccess]);
  const manageDepts = useMemo(() => labourManageDepts(authUser), [authUser]);
  // With access to more than one department the default is "All departments": a guard at the gate
  // punches whoever walks in, whichever department they work for, from one list.
  const ALL_DEPTS = "__all";
  const defaultDept = punchDepts.length > 1 ? ALL_DEPTS : punchDepts[0] || "";
  const [dept, setDept] = useState(() => defaultDept);
  useEffect(() => {
    if (dept === ALL_DEPTS ? punchDepts.length < 2 : !punchDepts.includes(dept)) setDept(defaultDept);
  }, [punchDepts, dept, defaultDept]);
  const isAllDepts = dept === ALL_DEPTS;
  const [addDept, setAddDept] = useState("");   // the new labour's department while viewing All
  const targetDept = isAllDepts ? (punchDepts.includes(addDept) ? addDept : punchDepts[0] || "") : dept;

  const [labours, setLabours] = useState([]);
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [camera, setCamera] = useState(null);   // { labour, type } | null
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");        // last saved punch, shown briefly
  const today = todayStr();
  const deptKey = punchDepts.join("|");

  // Roster + today's punches for every department this user can punch, loaded once; the chips
  // only filter what is already here.
  useEffect(() => {
    if (!punchDepts.length) { setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    Promise.all([fetchLabours(punchDepts), fetchDayLabourPunches(today, punchDepts)])
      .then(([ls, ps]) => { if (active) { setLabours(ls); setPunches(ps); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load labours"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line -- keyed on the department set, not the array identity
  }, [deptKey, today]);

  // Live: another guard punching the same department, or someone adding a labour, shows up here.
  useEffect(() => {
    if (!punchDepts.length) return undefined;
    const mine = new Set(punchDepts);
    const chP = subscribeTable("labour_attendance", ({ eventType, new: row }) => {
      if (eventType !== "INSERT" || !row || row.date !== today || !mine.has(row.department)) return;
      setPunches((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
    });
    const chL = subscribeTable("labours", ({ eventType, new: row }) => {
      if (!row || !mine.has(row.department)) return;
      setLabours((prev) => {
        const rest = prev.filter((l) => l.id !== row.id);
        if (eventType === "DELETE" || row.active === false) return rest;
        return [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
      });
    });
    return () => { supabase.removeChannel(chP); supabase.removeChannel(chL); };
    // eslint-disable-next-line -- see above
  }, [deptKey, today]);

  // One position, refreshed at most every 2 minutes — a guard punching twenty labours at the gate
  // shouldn't wait on GPS twenty times.
  const coordsRef = useRef({ at: 0, value: null });
  const getCoords = async () => {
    const c = coordsRef.current;
    if (c.value && Date.now() - c.at < COORDS_MAX_AGE_MS) return c.value;
    const value = await getCurrentCoords();
    coordsRef.current = { at: Date.now(), value };
    return value;
  };
  useEffect(() => { getCoords(); }, []); // eslint-disable-line -- warm once on open

  const last = useMemo(() => lastPunchByLabour(punches), [punches]);
  const deptLabours = isAllDepts ? labours : labours.filter((l) => l.department === dept);
  const shown = q.trim()
    ? deptLabours.filter((l) => `${l.name} ${l.phone || ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : deptLabours;
  const counts = deptLabours.reduce((acc, l) => {
    const p = last[l.id];
    if (p?.type === "in") acc.in++; else if (p) acc.out++;
    return acc;
  }, { in: 0, out: 0 });

  async function savePunch(file) {
    const { labour, type } = camera;
    setSaving(true);
    try {
      const coords = await getCoords();
      const lat = coords?.lat ?? null, lng = coords?.lng ?? null;
      let locationName = resolvePunchLocation(settings?.attendanceLocations, lat, lng)?.name || null;
      if (!locationName && lat != null && lng != null) locationName = await reverseGeocode(lat, lng);
      const photo = await uploadToStorage(await compressPunchPhoto(file), STORAGE_FOLDERS.ATTENDANCE);
      const saved = await insertLabourPunch({
        id: newLabourPunchId(),
        labour_id: labour.id,
        labour_name: labour.name,
        department: labour.department,
        type,
        at: new Date().toISOString(),
        date: today,
        photo,
        verified: true, // only reached after the face check passed (or failed open — see faceCheck.js)
        lat, lng, location_name: locationName,
        punched_by: authUser.id,
        punched_by_name: authUser.name || authUser.username || "",
      });
      setPunches((prev) => (prev.some((p) => p.id === saved.id) ? prev : [...prev, saved]));
      setFlash(`${labour.name} punched ${type === "in" ? "in" : "out"} at ${fmtTime(saved.at)}`);
      setTimeout(() => setFlash(""), 3000);
      setCamera(null);
    } catch (e) {
      setError(e.message || "Couldn't save the punch");
      setCamera(null);
    } finally {
      setSaving(false);
    }
  }

  // ── Add labour ──
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  async function addLabour() {
    const name = newName.trim();
    if (!name || !targetDept) return;
    // Optional, but if given it must be a full 10-digit mobile (input already strips to digits).
    if (newPhone && newPhone.length !== 10) { setError("Phone number must be 10 digits"); return; }
    try {
      const row = await insertLabour({ id: newLabourId(), name, phone: newPhone.trim() || null, department: targetDept, active: true, created_by: authUser.id });
      setLabours((prev) => [...prev.filter((l) => l.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(""); setNewPhone(""); setAdding(false);
    } catch (e) { setError(e.message || "Couldn't add the labour"); }
  }
  async function removeLabour(l) {
    if (!window.confirm(`Remove ${l.name} from ${l.department}? Their past punches stay in the log.`)) return;
    try {
      await deactivateLabour(l.id);
      setLabours((prev) => prev.filter((x) => x.id !== l.id));
    } catch (e) { setError(e.message || "Couldn't remove the labour"); }
  }

  if (!punchDepts.length) {
    return (
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-8 text-center text-gray-500">
        <div className="flex justify-center mb-2 text-gray-300"><IconLock size={28} /></div>
        You don't have labour punch access. Ask Admin to give it to you.
      </div>
    );
  }

  return (
    // Side by side from lg up when the access card is shown (Admin), two equal columns; one
    // column (stacked) on phones and for a guard, who only sees the list.
    <div className={manageDepts.length > 0 ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" : "space-y-4"}>
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
            <IconUsers size={15} /> Labour Punch
          </div>
          <div className="text-xs font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>

        {punchDepts.length > 1 && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Department</span>
            <SelectPopover align="left" size="sm" value={dept} onChange={setDept} options={[{ value: ALL_DEPTS, label: "All departments" }, ...deptOptions(punchDepts)]} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-xl bg-green-50 px-3 py-2"><div className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">In now</div><div className="text-xl font-bold text-gray-900">{counts.in}</div></div>
          <div className="rounded-xl bg-gray-50 px-3 py-2"><div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Out</div><div className="text-xl font-bold text-gray-900">{counts.out}</div></div>
        </div>

        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconSearch size={14} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search labour…"
              className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <button onClick={() => setAdding((a) => !a)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition">
            <IconPlusCircle size={15} /> Add
          </button>
        </div>

        {adding && (
          <div className="mt-3 rounded-xl bg-gray-50 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
            {isAllDepts && <SelectPopover align="left" size="sm" value={targetDept} onChange={setAddDept} options={deptOptions(punchDepts)} />}
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLabour()}
              placeholder={`Name (${targetDept})`} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <input value={newPhone} onChange={(e) => setNewPhone(phone10(e.target.value))} onKeyDown={(e) => e.key === "Enter" && addLabour()}
              placeholder="Phone (10 digits)" inputMode="numeric" maxLength={10} className="sm:w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <button onClick={addLabour} disabled={!newName.trim() || (newPhone.length > 0 && newPhone.length !== 10)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition">Save</button>
          </div>
        )}

        {flash && <div className="mt-3 text-sm font-medium text-green-700 bg-green-50 rounded-lg px-3 py-2">✓ {flash}</div>}
        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-600"><IconX size={14} /></button>
          </div>
        )}

        <div className="mt-4 divide-y divide-gray-100">
          {loading ? (
            <div className="text-center text-gray-400 py-8 text-sm">Loading labours…</div>
          ) : shown.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">
              {deptLabours.length ? "No labour matches that search." : (isAllDepts ? "No labours yet — tap Add to put the first one in." : `No labours in ${dept} yet — tap Add to put the first one in.`)}
            </div>
          ) : shown.map((l) => {
            const p = last[l.id];
            const isIn = p?.type === "in";
            return (
              <div key={l.id} className="flex items-center gap-2.5 sm:gap-3 py-3">
                {p?.photo
                  ? <img src={p.photo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-gray-200" />
                  : <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center font-bold shrink-0">{l.name.slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">{l.name}{l.phone ? <span className="font-normal text-gray-400"> · {l.phone}</span> : null}{isAllDepts ? <span className="ml-1.5 align-middle text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{DEPT_ICON[l.department] || ""} {l.department}</span> : null}</div>
                  <div className={"text-xs truncate flex items-center gap-1 " + (isIn ? "text-green-600" : p ? (p.auto_closed ? "text-amber-600" : "text-gray-500") : "text-gray-400")}>
                    {!p ? "Not punched in today"
                      : isIn ? <>In since {fmtTime(p.at)} <span className="text-gray-400 inline-flex items-center gap-0.5"><IconPin size={10} />{punchLocationLabel(p)}</span></>
                      : `${p.auto_closed ? "Auto punched out" : "Out"} at ${fmtTime(p.at)}`}
                  </div>
                </div>
                <button onClick={() => setCamera({ labour: l, type: isIn ? "out" : "in" })}
                  className={"shrink-0 px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold text-white whitespace-nowrap transition " + (isIn ? "bg-gray-800 hover:bg-gray-900" : "bg-green-600 hover:bg-green-700")}>
                  {isIn ? "Punch Out" : "Punch In"}
                </button>
                {manageDepts.includes(l.department) && (
                  <button onClick={() => removeLabour(l)} title={`Remove ${l.name}`}
                    className="shrink-0 w-8 h-8 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition">
                    <IconTrash size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {manageDepts.length > 0 && (
        <LabourAccessCard authUser={authUser} users={users} manageDepts={manageDepts} onChanged={onAccessChanged} />
      )}

      {camera && (
        <LabourPunchCamera labour={camera.labour} type={camera.type} busy={saving}
          onCaptured={savePunch} onCancel={() => { if (!saving) setCamera(null); }} />
      )}
    </div>
  );
}

// ── Who can punch (Admin only) ──
// Admin grants a user access to one or more departments; everyone else, department heads included,
// punches only the departments granted to them here.
function LabourAccessCard({ authUser, users, manageDepts, onChanged }) {
  const ALL = "__all";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [qFocus, setQFocus] = useState(false);   // suggestions show only while the search box is in use
  // "All departments" by default: a guard at the gate usually punches every department's labours,
  // whatever department they themselves belong to — one grant covers all of them.
  const [pickDept, setPickDept] = useState(manageDepts.length > 1 ? ALL : manageDepts[0]);
  const isAll = pickDept === ALL;
  const key = manageDepts.join("|");

  useEffect(() => {
    let active = true;
    fetchLabourAccessForDepts(manageDepts)
      .then((r) => { if (active) { setRows(r); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load access"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line -- keyed on the department set
  }, [key]);

  const byId = useMemo(() => new Map((users || []).map((u) => [u.id, u])), [users]);
  const nameOf = (id) => byId.get(id)?.name || byId.get(id)?.username || id;
  // user_id → the departments they can punch (only the ones this card manages)
  const deptsByUser = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id).push(r); });
    return m;
  }, [rows]);
  const hasAll = (uid) => (deptsByUser.get(uid) || []).length >= manageDepts.length;
  const already = new Set(isAll ? [...deptsByUser.keys()].filter(hasAll) : rows.filter((r) => r.department === pickDept).map((r) => r.user_id));
  const matches = q.trim()
    ? (users || []).filter((u) => u.active !== false && u.id !== authUser.id && !already.has(u.id)
        && `${u.name || ""} ${u.username || ""} ${u.role || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  async function grant(u) {
    try {
      const have = new Set((deptsByUser.get(u.id) || []).map((r) => r.department));
      const targets = isAll ? manageDepts.filter((d) => !have.has(d)) : [pickDept];
      const added = [];
      for (const d of targets) added.push(await grantLabourAccess({ userId: u.id, department: d, grantedBy: authUser.id }));
      const ids = new Set(added.map((r) => r.id));
      setRows((prev) => [...prev.filter((r) => !ids.has(r.id)), ...added]);
      setQ("");
      onChanged?.();
    } catch (e) { setError(e.message || "Couldn't give access"); }
  }
  async function revoke(list) {
    try {
      for (const r of list) await revokeLabourAccess(r.id);
      const ids = new Set(list.map((r) => r.id));
      setRows((prev) => prev.filter((x) => !ids.has(x.id)));
      onChanged?.();
    } catch (e) { setError(e.message || "Couldn't remove access"); }
  }

  const deptRows = rows.filter((r) => r.department === pickDept);
  const userGroups = [...deptsByUser.entries()].map(([uid, list]) => ({ uid, list })).sort((a, b) => nameOf(a.uid).localeCompare(nameOf(b.uid)));

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
        <IconLock size={14} /> Who can punch labours
      </div>

      {manageDepts.length > 1 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Department</span>
          <SelectPopover align="left" size="sm" value={pickDept} onChange={setPickDept}
            options={[{ value: ALL, label: "All departments" }, ...deptOptions(manageDepts)]} />
        </div>
      )}

      <div className="relative mt-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setQFocus(true)} onBlur={() => setQFocus(false)}
          placeholder={isAll ? "Search user to give access to all departments…" : "Search user to give access…"}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        {qFocus && matches.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg ring-1 ring-gray-200 overflow-hidden">
            {matches.map((u) => (
              <button key={u.id} onMouseDown={(e) => e.preventDefault()} onClick={() => grant(u)} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800 truncate">{u.name || u.username}</span>
                <span className="text-xs text-gray-400 shrink-0">{u.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      <div className="mt-3 divide-y divide-gray-100">
        {loading ? <div className="text-sm text-gray-400 py-3">Loading…</div>
          : isAll ? (
            userGroups.length === 0
              ? <div className="text-sm text-gray-400 py-3">Nobody has labour punch access yet.</div>
              : userGroups.map(({ uid, list }) => (
                <div key={uid} className="flex items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{nameOf(uid)}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {list.length >= manageDepts.length
                        ? <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">All departments</span>
                        : list.map((r) => <span key={r.id} className="text-[11px] text-gray-600 bg-gray-100 rounded-full px-2 py-0.5">{DEPT_ICON[r.department] || ""} {r.department}</span>)}
                    </div>
                  </div>
                  <button onClick={() => revoke(list)} title="Remove all of this user's labour punch access"
                    className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition">Remove</button>
                </div>
              ))
          ) : deptRows.length === 0
            ? <div className="text-sm text-gray-400 py-3">Nobody has {pickDept} access yet.</div>
            : deptRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{nameOf(r.user_id)}</div>
                  <div className="text-xs text-gray-400 truncate">{r.department}{r.granted_by ? ` · given by ${nameOf(r.granted_by)}` : ""}</div>
                </div>
                <button onClick={() => revoke([r])} className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition">Remove</button>
              </div>
            ))}
      </div>
    </div>
  );
}

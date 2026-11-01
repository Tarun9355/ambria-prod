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
import { IconUsers, IconSearch, IconPlusCircle, IconTrash, IconPin, IconLock, IconX, IconCheck, IconPlay, IconStop } from "../../components/icons.jsx";

// ═══ LABOUR PUNCH ═══ (Attendance → Labour Punch)
// One person with access — a guard, a site supervisor — punches a department's labours in and out
// from their own phone: pick the labour, take their photo, done (no briefing video or quiz; that is
// the staff flow). Who may do this is decided per department by Admin only,
// in the "Who can punch" card at the bottom. See lib/ims/labourAttendance.js for the rules.

const deptOptions = (depts) => depts.map((d) => ({ value: d, label: `${DEPT_ICON[d] || ""} ${d}` }));
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const COORDS_MAX_AGE_MS = 2 * 60 * 1000;

// The Attendance tab's shared look (see AttendanceTab.jsx) — cards, buttons and inputs.
const CARD = "rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm";
const BTN_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors " + BTN_FOCUS;
const BTN_SECONDARY = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors " + BTN_FOCUS;
const INPUT = "h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

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
  const [error, setError] = useState("");        // a failed add / remove / save, dismissable
  const [loadError, setLoadError] = useState(""); // the roster itself didn't load — shown in the list, with a retry
  const [reload, setReload] = useState(0);
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
      .then(([ls, ps]) => { if (active) { setLabours(ls); setPunches(ps); setLoadError(""); } })
      .catch((e) => { if (active) setLoadError(e.message || "Couldn't load labours"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line -- keyed on the department set, not the array identity
  }, [deptKey, today, reload]);

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
      <section aria-label="Labour punch" className={CARD + " px-6 py-12 text-center"}>
        <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconLock size={18} /></div>
        <p className="mt-3 text-sm font-medium text-gray-700">You don't have labour punch access</p>
        <p className="mt-1 text-xs text-gray-500">Ask Admin to give it to you.</p>
      </section>
    );
  }

  const notIn = Math.max(0, deptLabours.length - counts.in - counts.out);
  const searching = q.trim().length > 0;

  return (
    // Side by side from lg up when the access card is shown (Admin), two equal columns; one
    // column (stacked) on phones and for a guard, who only sees the list.
    <div className={manageDepts.length > 0 ? "grid grid-cols-1 lg:grid-cols-2 gap-5 items-start" : "space-y-5"}>
      <section aria-label="Labour punch" className={CARD}>
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <IconUsers size={15} /> Labour Punch
            {!loading && deptLabours.length > 0 && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{deptLabours.length}</span>}
          </h2>
          <time dateTime={today} className="text-sm text-gray-500">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </time>
        </div>

        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {punchDepts.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-500">Department</span>
              <SelectPopover align="left" size="sm" value={dept} onChange={setDept} options={[{ value: ALL_DEPTS, label: "All departments" }, ...deptOptions(punchDepts)]} />
            </div>
          )}

          {/* Where the department stands right now, from each labour's latest punch today. */}
          <dl className="grid grid-cols-3 rounded-xl bg-gray-50 ring-1 ring-gray-100 divide-x divide-gray-100">
            {[["In now", counts.in, "bg-green-500"], ["Out", counts.out, "bg-gray-400"], ["Not in yet", notIn, "bg-amber-500"]].map(([k, v, dot]) => (
              <div key={k} className="px-3 sm:px-4 py-2.5 min-w-0">
                <dt className="flex items-center gap-1.5 text-xs text-gray-500 truncate"><span aria-hidden="true" className={"w-1.5 h-1.5 shrink-0 rounded-full " + dot} />{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-gray-900 tabular-nums leading-tight">
                  {loading ? <span className="inline-block w-6 h-4 rounded bg-gray-200 motion-safe:animate-pulse align-middle" /> : v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><IconSearch size={15} /></span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" aria-label="Search labours"
                className={INPUT + " w-full pl-9"} />
            </div>
            <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={BTN_SECONDARY + " shrink-0"}>
              {adding ? <><IconX size={15} /> Cancel</> : <><IconPlusCircle size={15} /> Add</>}
            </button>
          </div>

          {adding && (
            <div className="rounded-xl bg-gray-50 ring-1 ring-gray-100 p-3.5">
              <p className="text-xs font-semibold text-gray-900">New labour</p>
              <div className="mt-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                {isAllDepts && <SelectPopover align="left" size="sm" value={targetDept} onChange={setAddDept} options={deptOptions(punchDepts)} />}
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLabour()}
                  placeholder={`Name (${targetDept})`} aria-label="Name" className={INPUT + " flex-1 min-w-0"} />
                <input value={newPhone} onChange={(e) => setNewPhone(phone10(e.target.value))} onKeyDown={(e) => e.key === "Enter" && addLabour()}
                  placeholder="Phone (10 digits)" aria-label="Phone (optional, 10 digits)" inputMode="numeric" maxLength={10} className={INPUT + " sm:w-40 tabular-nums"} />
                <button onClick={addLabour} disabled={!newName.trim() || (newPhone.length > 0 && newPhone.length !== 10)} className={BTN_PRIMARY}>Save</button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {newPhone.length > 0 && newPhone.length !== 10 ? `Phone needs 10 digits — ${newPhone.length} so far.` : "Phone is optional."}
              </p>
            </div>
          )}

          {flash && (
            <div role="status" className="flex items-center gap-2 rounded-xl bg-green-50 ring-1 ring-green-200 px-3 py-2 text-sm font-medium text-green-800">
              <IconCheck size={15} /> {flash}
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-red-50 ring-1 ring-red-200 pl-3 pr-1 py-1 text-sm text-red-700">
              <span className="py-1">{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss"
                className="shrink-0 w-8 h-8 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-100 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                <IconX size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100">
          {loading ? (
            <ul aria-busy="true" aria-label="Loading labours" className="divide-y divide-gray-100">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3 w-32 rounded bg-gray-100 motion-safe:animate-pulse" />
                    <span className="block h-2.5 w-24 rounded bg-gray-100 motion-safe:animate-pulse" />
                  </span>
                  <span className="w-24 h-10 shrink-0 rounded-xl bg-gray-100 motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          ) : loadError ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-red-600">{loadError}</p>
              <button onClick={() => setReload((n) => n + 1)}
                className="mt-2 h-8 px-3 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">Try again</button>
            </div>
          ) : shown.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center">
                {deptLabours.length && searching ? <IconSearch size={18} /> : <IconUsers size={18} />}
              </div>
              {deptLabours.length ? (
                <>
                  <p className="mt-3 text-sm font-medium text-gray-700">No labour matches that search</p>
                  <p className="mt-1 text-xs text-gray-500">Check the spelling, or search by phone number.</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm font-medium text-gray-700">{isAllDepts ? "No labours yet" : `No labours in ${dept} yet`}</p>
                  <p className="mt-1 text-xs text-gray-500">Tap Add to put the first one in.</p>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {shown.map((l) => {
                const p = last[l.id];
                const isIn = p?.type === "in";
                return (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-3">
                    {/* Their latest punch photo, so the guard can match the face; an initial before the first punch. */}
                    <span className="relative shrink-0">
                      {p?.photo
                        ? <img src={p.photo} alt="" className="w-10 h-10 rounded-full object-cover ring-1 ring-gray-200" />
                        : <span className="w-10 h-10 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-semibold">{l.name.slice(0, 1).toUpperCase()}</span>}
                      {isIn && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {l.name}{l.phone ? <span className="font-normal text-gray-500 tabular-nums"> · {l.phone}</span> : null}
                        </span>
                        {isAllDepts && <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{DEPT_ICON[l.department] || ""} {l.department}</span>}
                      </div>
                      <div className={"mt-0.5 flex items-center gap-1 text-xs min-w-0 " + (isIn ? "text-green-700" : p?.auto_closed ? "text-amber-700" : "text-gray-500")}>
                        {!p ? "Not punched in today"
                          : isIn ? (
                            <>
                              <span className="shrink-0">In since <time dateTime={p.at} className="tabular-nums">{fmtTime(p.at)}</time></span>
                              <span className="inline-flex items-center gap-0.5 min-w-0 text-gray-500"><span className="shrink-0"><IconPin size={11} /></span><span className="truncate">{punchLocationLabel(p)}</span></span>
                            </>
                          )
                          : <span className="truncate">{p.auto_closed ? "Auto punched out" : "Out"} at <time dateTime={p.at} className="tabular-nums">{fmtTime(p.at)}</time></span>}
                      </div>
                    </div>
                    <button onClick={() => setCamera({ labour: l, type: isIn ? "out" : "in" })} aria-label={`${isIn ? "Punch out" : "Punch in"} ${l.name}`}
                      className={"shrink-0 inline-flex items-center justify-center gap-1.5 h-10 px-3 sm:px-4 rounded-xl text-sm font-semibold text-white whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 "
                        + (isIn ? "bg-gray-900 hover:bg-gray-800 focus-visible:ring-gray-900" : "bg-green-600 hover:bg-green-700 focus-visible:ring-green-600")}>
                      <span className="hidden sm:inline-flex">{isIn ? <IconStop size={14} /> : <IconPlay size={14} />}</span>
                      {isIn ? "Punch Out" : "Punch In"}
                    </button>
                    {manageDepts.includes(l.department) && (
                      <button onClick={() => removeLabour(l)} title={`Remove ${l.name}`} aria-label={`Remove ${l.name}`}
                        className="shrink-0 -mr-2 w-10 h-10 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                        <IconTrash size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

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
  const [error, setError] = useState("");         // a failed grant / revoke
  const [loadError, setLoadError] = useState(""); // the list itself didn't load — shown in place, with a retry
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState("");
  const [qFocus, setQFocus] = useState(false);   // suggestions show only while the search box is in use
  // "All departments" by default: a guard at the gate usually punches every department's labours,
  // whatever department they themselves belong to — one grant covers all of them.
  const [pickDept, setPickDept] = useState(manageDepts.length > 1 ? ALL : manageDepts[0]);
  const isAll = pickDept === ALL;
  const key = manageDepts.join("|");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchLabourAccessForDepts(manageDepts)
      .then((r) => { if (active) { setRows(r); setLoadError(""); } })
      .catch((e) => { if (active) setLoadError(e.message || "Couldn't load access"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line -- keyed on the department set
  }, [key, reload]);

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
  const listCount = isAll ? userGroups.length : deptRows.length;
  const avatar = (uid) => (
    <span aria-hidden="true" className="w-8 h-8 shrink-0 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-semibold">
      {String(nameOf(uid)).slice(0, 1).toUpperCase()}
    </span>
  );
  const removeBtn = "shrink-0 -mr-2 inline-flex items-center justify-center h-10 sm:h-8 px-3 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-colors";

  return (
    <section aria-label="Who can punch labours" className={CARD}>
      <div className="px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <IconLock size={15} /> Who can punch labours
          {!loading && !loadError && listCount > 0 && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{listCount}</span>}
        </h2>
        <p className="mt-1 text-xs text-gray-500">Only the people here can punch a department's labours in and out.</p>
      </div>

      <div className="border-t border-gray-100 px-5 py-4 space-y-3">
        {manageDepts.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500">Department</span>
            <SelectPopover align="left" size="sm" value={pickDept} onChange={setPickDept}
              options={[{ value: ALL, label: "All departments" }, ...deptOptions(manageDepts)]} />
          </div>
        )}

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><IconSearch size={15} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setQFocus(true)} onBlur={() => setQFocus(false)}
            placeholder={isAll ? "Search user to give access to all departments…" : "Search user to give access…"}
            aria-label={isAll ? "Search user to give access to all departments" : `Search user to give ${pickDept} access`}
            className={INPUT + " w-full pl-9"} />
          {qFocus && q.trim() && (
            <div className="absolute z-20 left-0 right-0 mt-1.5 bg-white rounded-xl shadow-lg ring-1 ring-gray-200 p-1.5">
              {matches.length > 0 ? matches.map((u) => (
                <button key={u.id} onMouseDown={(e) => e.preventDefault()} onClick={() => grant(u)}
                  className="w-full min-h-10 text-left px-3 py-2 rounded-lg text-sm hover:bg-blue-50 focus-visible:outline-none focus-visible:bg-blue-50 transition-colors flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 truncate">{u.name || u.username}</span>
                  <span className="text-xs text-gray-500 shrink-0">{u.role}</span>
                </button>
              )) : (
                <p className="px-3 py-2 text-xs text-gray-500">No one else matches — they may already have this access.</p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-red-50 ring-1 ring-red-200 pl-3 pr-1 py-1 text-sm text-red-700">
            <span className="py-1">{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss"
              className="shrink-0 w-8 h-8 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-100 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <IconX size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100">
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-6 text-sm text-gray-500">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" />
            Loading access…
          </div>
        ) : loadError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-red-600">{loadError}</p>
            <button onClick={() => setReload((n) => n + 1)}
              className="mt-2 h-8 px-3 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">Try again</button>
          </div>
        ) : listCount === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconLock size={18} /></div>
            <p className="mt-3 text-sm font-medium text-gray-700">{isAll ? "Nobody has labour punch access yet" : `Nobody has ${pickDept} access yet`}</p>
            <p className="mt-1 text-xs text-gray-500">Search for a user above to give them access.</p>
          </div>
        ) : isAll ? (
          <ul className="divide-y divide-gray-100">
            {userGroups.map(({ uid, list }) => (
              <li key={uid} className="flex items-start gap-3 px-5 py-3">
                {avatar(uid)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">{nameOf(uid)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {list.length >= manageDepts.length
                      ? <span className="rounded-md bg-blue-50 ring-1 ring-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">All departments</span>
                      : list.map((r) => <span key={r.id} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{DEPT_ICON[r.department] || ""} {r.department}</span>)}
                  </div>
                </div>
                <button onClick={() => revoke(list)} title="Remove all of this user's labour punch access"
                  aria-label={`Remove all of ${nameOf(uid)}'s labour punch access`} className={removeBtn}>Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-gray-100">
            {deptRows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                {avatar(r.user_id)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">{nameOf(r.user_id)}</div>
                  <div className="text-xs text-gray-500 truncate">{r.department}{r.granted_by ? ` · given by ${nameOf(r.granted_by)}` : ""}</div>
                </div>
                <button onClick={() => revoke([r])} aria-label={`Remove ${nameOf(r.user_id)}'s ${r.department} access`} className={removeBtn}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

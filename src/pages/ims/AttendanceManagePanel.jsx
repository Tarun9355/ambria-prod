import { useEffect, useMemo, useState } from "react";
import { supabase, subscribeTable } from "../../lib/supabase";
import { useConfirm } from "../../components/ui";
import { ROLES } from "../../lib/ims/constants";
import { callUserAdmin } from "../../lib/userAdmin";
import { deriveUsername } from "../../lib/auth";
import { LABOUR_DEPTS, DEPT_ICON, fetchAllActiveLabours, insertLabour, updateLabour, deactivateLabour, newLabourId } from "../../lib/ims/labourAttendance";
import { ATTENDANCE_QUIZ_DEPTS } from "../../lib/ims/attendance";
import { buildPeople, filterPeople, peopleStats, isFieldRole } from "../../lib/ims/peopleDirectory";
import { generatePassword, latinName } from "../../lib/ims/staffImport";
import LabourImportModal from "./LabourImportModal.jsx";
import { IconSearch, IconPlusCircle, IconTrash, IconX, IconCheck, IconUsers } from "../../components/icons.jsx";

// ═══ ATTENDANCE → MANAGE PEOPLE ═══ (Admin)
// Owner ask 2026-11-28: everyone in one place - staff (users: log in and punch themselves) and labours (the roster a
// supervisor punches) - with add, edit and remove, plus a sheet import. Department chips with counts, search, and two
// "needs a look" filters (no phone, a phone shared by two people). The list logic is lib/ims/peopleDirectory.js.
// Writes: a labour through labourAttendance (insert / update / soft-remove - past punches stay readable); a staff member's
// details through IMS's own setUsers, a new staff login and a removal through the admin-gated user-admin function, exactly as
// IMS → Admin → Users & Roles does.

const CARD = "rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors " + FOCUS;
const BTN_SECONDARY = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors " + FOCUS;
const INPUT = "h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";
const CHIP = (on) => "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors " + FOCUS + " " + (on ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50");
const initials = (n) => latinName(n).split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const phoneOk = (p) => !p || /^\d{10}$/.test(p);

function DeptPicker({ value, onChange, multi }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LABOUR_DEPTS.map((d) => {
        const on = multi ? value.includes(d) : value === d;
        return (
          <button key={d} type="button" aria-pressed={on} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== d) : [...value, d]) : d)}
            className={CHIP(on)}>{DEPT_ICON[d] || ""} {d}</button>
        );
      })}
    </div>
  );
}

export default function AttendanceManagePanel({ authUser, users, setUsers, settings }) {
  const [labours, setLabours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState("all");
  const [dept, setDept] = useState("all");
  const [flag, setFlag] = useState("");
  const [q, setQ] = useState("");
  const [editKey, setEditKey] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(null);   // null | "labour" | "staff"
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creds, setCreds] = useState(null);     // a just-made staff login, shown once
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [confirm, confirmDialog] = useConfirm();
  const PAGE_SIZE = 20;

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchAllActiveLabours()
      .then((rows) => { if (live) { setLabours(rows); setLoadError(""); } })
      .catch((e) => { if (live) setLoadError(e?.message || "Couldn't load the labour list"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reload]);
  useEffect(() => {
    const ch = subscribeTable("labours", ({ eventType, new: row, old }) => {
      setLabours((prev) => {
        const id = row?.id || old?.id;
        const rest = prev.filter((l) => l.id !== id);
        if (eventType === "DELETE" || !row || row.active === false) return rest;
        return [...rest, row];
      });
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);

  const people = useMemo(() => buildPeople(users, labours), [users, labours]);
  const stats = useMemo(() => peopleStats(people), [people]);
  const kindPeople = useMemo(() => filterPeople(people, { kind }), [people, kind]);
  const kindStats = useMemo(() => peopleStats(kindPeople), [kindPeople]);
  const shown = useMemo(() => filterPeople(people, { kind, dept, flag, q }), [people, kind, dept, flag, q]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageSlice = useMemo(() => shown.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE), [shown, curPage]);
  // any filter/search change resets to page 1 so the user lands on results, not an empty tail
  useEffect(() => { setPage(1); }, [kind, dept, flag, q]);
  // heads, supervisors and labour only - the same roles this list shows (isFieldRole)
  const roles = (Array.isArray(settings?.rolesList) ? settings.rolesList : ROLES).filter((r) => r !== "Admin" && isFieldRole(r));

  const startEdit = (p) => {
    setError(""); setAdding(null); setEditKey(p.key);
    setDraft(p.kind === "labour" ? { name: p.name, phone: p.phone, dept: p.depts[0] || "" } : { name: p.name, phone: p.phone, depts: [...p.depts], role: p.role, active: p.active });
  };
  const cancelEdit = () => { setEditKey(null); setDraft(null); setError(""); };

  const saveEdit = async (p) => {
    const name = draft.name.trim();
    if (!name) { setError("Name can't be empty"); return; }
    if (!phoneOk(draft.phone)) { setError("Phone must be 10 digits"); return; }
    setBusy(true); setError("");
    try {
      if (p.kind === "labour") {
        if (!draft.dept) { setError("Pick a department"); setBusy(false); return; }
        const row = await updateLabour(p.id, { name, phone: draft.phone || null, department: draft.dept });
        setLabours((prev) => prev.map((l) => (l.id === row.id ? row : l)));
      } else {
        setUsers((prev) => prev.map((u) => (u.id === p.id ? { ...u, name, phone: draft.phone || "", departments: draft.depts.length ? draft.depts : null, ...(p.isAdmin ? {} : { role: draft.role, active: draft.active }) } : u)));
      }
      cancelEdit();
    } catch (e) { setError(e?.message || "Couldn't save"); }
    setBusy(false);
  };

  const remove = async (p) => {
    const ok = await confirm(p.kind === "labour"
      ? { title: `Remove ${p.name}?`, body: `${p.name} comes off the ${p.depts[0] || ""} labour list. Their past punches stay in Labour Log.`, confirmLabel: "Remove" }
      : { title: `Delete ${p.name}'s login?`, body: "They can no longer log in or punch. Their past attendance stays in Staff Log. This can't be undone.", confirmLabel: "Delete login" });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      if (p.kind === "labour") { await deactivateLabour(p.id); setLabours((prev) => prev.filter((l) => l.id !== p.id)); }
      else await callUserAdmin("deleteUser", { userId: p.id });
      if (editKey === p.key) cancelEdit();
    } catch (e) { setError(e?.message || "Couldn't remove"); }
    setBusy(false);
  };

  const openAdd = (k) => {
    setError(""); cancelEdit(); setAdding(k);
    const defRole = roles.includes("Labour") ? "Labour" : roles.includes("Site Supervisor") ? "Site Supervisor" : roles[0] || "Sales";
    setForm(k === "labour" ? { name: "", phone: "", dept: dept !== "all" && dept !== "none" ? dept : "" } : { name: "", phone: "", depts: dept !== "all" && dept !== "none" ? [dept] : [], role: defRole });
  };
  const saveAdd = async () => {
    const name = form.name.trim();
    if (!name) { setError("Enter a name"); return; }
    if (!phoneOk(form.phone)) { setError("Phone must be 10 digits"); return; }
    setBusy(true); setError("");
    try {
      if (adding === "labour") {
        if (!form.dept) { setError("Pick a department"); setBusy(false); return; }
        const row = await insertLabour({ id: newLabourId(), name, phone: form.phone || null, department: form.dept, active: true, created_by: authUser?.id || null });
        setLabours((prev) => [...prev.filter((l) => l.id !== row.id), row]);
      } else {
        const stem = deriveUsername(latinName(name)) || "staff";
        const taken = new Set((users || []).map((u) => String(u.username || "").toLowerCase()));
        let username = stem, n = 2; while (taken.has(username)) username = stem + n++;
        const ids = new Set((users || []).map((u) => String(u.id)));
        const mint = () => "U" + (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
        let id = mint(); while (ids.has(id)) id = mint();
        const password = generatePassword(name);
        await callUserAdmin("createUser", { user: { id, name, username, role: form.role, permissions: [], apps: form.role === "Sales" ? ["studio"] : ["ims"], departments: form.depts.length ? form.depts : null, phone: form.phone || "", email: "", active: true, tabOverride: null }, password });
        setCreds({ name, username, password });
      }
      setAdding(null); setForm(null);
    } catch (e) { setError(e?.message || "Couldn't add"); }
    setBusy(false);
  };

  const deptChips = [["all", "All", kindStats.total], ...LABOUR_DEPTS.map((d) => [d, `${DEPT_ICON[d] || ""} ${d}`, kindStats.byDept[d] || 0]).filter(([, , n]) => n > 0), ...(kindStats.none ? [["none", "No department", kindStats.none]] : [])];

  return (
    <div className="space-y-4">
      {/* Head: totals and the two adds */}
      <section className={CARD + " p-5"}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><IconUsers size={17} /> Manage people</h2>
            <p className="mt-1 text-sm text-gray-500">Department heads, supervisors and labours. Staff log in and punch themselves; labours are punched by a supervisor.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openAdd("labour")} className={BTN_PRIMARY}><IconPlusCircle size={15} /> Add labour</button>
            <button onClick={() => openAdd("staff")} className={BTN_SECONDARY}><IconPlusCircle size={15} /> Add staff</button>
            <button onClick={() => setImporting(true)} className={BTN_SECONDARY}>Import sheet</button>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          {[["Everyone", stats.total], ["Staff", stats.staff], ["Labour", stats.labour]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-gray-500">{k}</dt>
              <dd className="mt-0.5 text-xl font-semibold text-gray-900 tabular-nums">{loading && k !== "Staff" ? <span className="inline-block w-8 h-5 rounded bg-gray-200 motion-safe:animate-pulse align-middle" /> : v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {creds && (
        <div role="status" className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 p-4 text-sm text-emerald-900 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-semibold">Login made for {creds.name}</span>
          <span>Username <span className="font-mono font-semibold">{creds.username}</span></span>
          <span>Password <span className="font-mono font-semibold">{creds.password}</span></span>
          <span className="text-xs text-emerald-700">Note it down - it is shown only now.</span>
          <button onClick={() => setCreds(null)} aria-label="Close" className={"ml-auto h-8 w-8 rounded-lg flex items-center justify-center hover:bg-emerald-100 " + FOCUS}><IconX size={14} /></button>
        </div>
      )}

      {/* Add form */}
      {adding && form && (
        <section className={CARD + " p-5 space-y-3"}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{adding === "labour" ? "New labour" : "New staff login"}</h3>
            <button onClick={() => { setAdding(null); setForm(null); setError(""); }} aria-label="Cancel" className={"h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 " + FOCUS}><IconX size={15} /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" aria-label="Name" className={INPUT} />
            <input value={form.phone} inputMode="numeric" onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone (10 digits, optional)" aria-label="Phone" className={INPUT} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">{adding === "labour" ? "Department" : "Departments"}</p>
            {adding === "labour"
              ? <DeptPicker value={form.dept} onChange={(d) => setForm({ ...form, dept: d })} />
              : <DeptPicker multi value={form.depts} onChange={(d) => setForm({ ...form, depts: d })} />}
          </div>
          {adding === "staff" && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500">Role (what they see after logging in)</p>
              <div className="flex flex-wrap gap-1.5">{roles.map((r) => <button key={r} type="button" aria-pressed={form.role === r} onClick={() => setForm({ ...form, role: r })} className={CHIP(form.role === r)}>{r}</button>)}</div>
              <p className="mt-2 text-xs text-gray-500">A username and password are made for them and shown once.</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button onClick={saveAdd} disabled={busy} className={BTN_PRIMARY}><IconCheck size={15} /> {busy ? "Adding…" : adding === "labour" ? "Add labour" : "Make login"}</button>
          </div>
        </section>
      )}

      {/* Filters + list */}
      <section className={CARD}>
        <div className="p-5 space-y-3 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Who">
              {[["all", "Everyone"], ["staff", "Staff"], ["labour", "Labour"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setDept("all"); }}
                  className={"h-8 px-3.5 rounded-lg text-sm font-semibold transition-colors " + FOCUS + " " + (kind === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>{l}</button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[12rem]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><IconSearch size={15} /></span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, username or role…" aria-label="Search people" className={INPUT + " w-full pl-9"} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {deptChips.map(([k, l, n]) => <button key={k} aria-pressed={dept === k} onClick={() => setDept(k)} className={CHIP(dept === k)}>{l}<span className={dept === k ? "text-white/70" : "text-gray-400"}>{n}</span></button>)}
          </div>
        </div>

        {error && !adding && <p role="alert" className="px-5 pt-3 text-sm text-red-600">{error}</p>}
        {loadError && (
          <div className="px-5 py-4 text-sm text-red-600 flex items-center gap-3">The labour list didn't load. <button onClick={() => setReload((r) => r + 1)} className="font-semibold underline">Try again</button></div>
        )}

        {loading && !shown.length ? (
          <ul className="divide-y divide-gray-100">{[0, 1, 2, 3].map((i) => <li key={i} className="flex items-center gap-3 px-5 py-3"><span className="w-9 h-9 rounded-full bg-gray-100 motion-safe:animate-pulse" /><span className="h-4 w-40 rounded bg-gray-100 motion-safe:animate-pulse" /></li>)}</ul>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">{q || flag || dept !== "all" ? "Nobody matches these filters." : "Nobody here yet - add someone or import a sheet."}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pageSlice.map((p) => (
              <li key={p.key} className="hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3 px-5 py-3">
                  <span aria-hidden="true" className={"w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold " + (p.kind === "staff" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800")}>{initials(p.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={"font-medium truncate " + (p.active ? "text-gray-900" : "text-gray-400 line-through")}>{p.name}</span>
                      <span className={"rounded-md px-1.5 py-0.5 text-[11px] font-semibold " + (p.kind === "staff" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-800")}>{p.kind === "staff" ? (p.role || "Staff") : "Labour"}</span>
                      {!p.active && <span className="text-[11px] font-medium text-gray-400">Inactive</span>}
                      {/* Punch-in briefing is scoped to ONE quiz-dept per user (attendance.js:
                          attendanceQuizDept). A staff member with no dept, >1 dept, or a dept
                          outside the quiz list is silently exempt from every briefing — admin needs
                          to see who's being skipped, so their row carries a small amber chip. */}
                      {p.kind === "staff" && !p.isAdmin && p.active && (() => {
                        const qDepts = (p.depts || []).filter((d) => ATTENDANCE_QUIZ_DEPTS.includes(d));
                        if (qDepts.length === 1) return null;
                        const why = !p.depts?.length ? "no department set"
                          : qDepts.length === 0 ? `dept${p.depts.length > 1 ? "s" : ""} outside the quiz list`
                          : `${p.depts.length} depts — needs exactly one quiz dept`;
                        return (
                          <span title={`No punch-in briefing runs for this user — ${why}.`}
                            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 ring-1 ring-amber-200">⚠ No briefing</span>
                        );
                      })()}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500 truncate">
                      {p.depts.length ? p.depts.map((d) => `${DEPT_ICON[d] || ""} ${d}`).join(" · ") : "No department"}
                      {" · "}{p.phone ? <span className="tabular-nums">{p.phone}</span> : <span className="text-amber-700">no phone</span>}
                      {p.username ? <span className="font-mono"> · {p.username}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => startEdit(p)} className={"h-9 px-3 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 " + FOCUS}>Edit</button>
                    {!p.isAdmin && p.id !== authUser?.id && (
                      <button onClick={() => remove(p)} disabled={busy} aria-label={`Remove ${p.name}`} title={p.kind === "labour" ? "Remove from the labour list" : "Delete this login"} className={"h-9 w-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 " + FOCUS}><IconTrash size={15} /></button>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {loading && kind !== "staff" && <li className="px-5 py-3 text-sm text-gray-500" aria-live="polite">Loading labours…</li>}
          </ul>
        )}
        {shown.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50/60">
            <span className="text-xs text-gray-500 tabular-nums">Showing {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, shown.length)} of {shown.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage === 1} className={"h-8 px-3 rounded-lg text-xs font-semibold bg-white ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50 " + FOCUS}>Prev</button>
              <span className="px-2 text-xs text-gray-600 tabular-nums">Page {curPage} / {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={curPage === pageCount} className={"h-8 px-3 rounded-lg text-xs font-semibold bg-white ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50 " + FOCUS}>Next</button>
            </div>
          </div>
        )}
      </section>

      {importing && <LabourImportModal open authUser={authUser} onClose={() => setImporting(false)} onDone={() => setReload((r) => r + 1)} />}
      {editKey && draft && (() => {
        const p = people.find((x) => x.key === editKey);
        if (!p) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-label={`Edit ${p.name}`} onClick={(e) => { if (e.target === e.currentTarget && !busy) cancelEdit(); }}>
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-gray-200/70">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Edit {p.kind === "staff" ? (p.role || "staff") : "labour"} · {p.name}</h3>
                <button onClick={cancelEdit} disabled={busy} aria-label="Close" className={"h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 " + FOCUS}><IconX size={15} /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" className={INPUT} />
                  <input value={draft.phone} inputMode="numeric" onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone (10 digits)" aria-label="Phone" className={INPUT} />
                </div>
                {p.kind === "labour"
                  ? <DeptPicker value={draft.dept} onChange={(d) => setDraft({ ...draft, dept: d })} />
                  : <DeptPicker multi value={draft.depts} onChange={(d) => setDraft({ ...draft, depts: d })} />}
                {p.kind === "staff" && !p.isAdmin && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {roles.map((r) => <button key={r} type="button" aria-pressed={draft.role === r} onClick={() => setDraft({ ...draft, role: r })} className={CHIP(draft.role === r)}>{r}</button>)}
                    <label className="ml-2 inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Can log in</label>
                  </div>
                )}
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              </div>
              <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
                <button onClick={() => saveEdit(p)} disabled={busy} className={BTN_PRIMARY}><IconCheck size={15} /> {busy ? "Saving…" : "Save"}</button>
                <button onClick={cancelEdit} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      {confirmDialog}
    </div>
  );
}

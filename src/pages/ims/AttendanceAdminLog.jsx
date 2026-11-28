import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, useConfirm } from "../../components/ui";
import { fetchRangePunches, todayStr, punchLabel, punchLocationLabel, updatePunchRow, deletePunchRow } from "../../lib/ims/attendance";
import { DEPTS as BUILD_DEPTS, userDepartments } from "../../lib/ims/deptClassify";
import { ATTENDANCE_ONLY_DEPTS } from "../../lib/ims/staffImport";
// Attendance groups by the build departments plus the attendance-only ones (ADD - owner ask 2026-11-28).
const DEPTS = [...BUILD_DEPTS, ...ATTENDANCE_ONLY_DEPTS];
import { IconPin, IconCalendar, IconChevron, IconCheck, IconSearch, IconUsers, IconCamera, IconX } from "../../components/icons.jsx";
import AttendanceMonthLog from "./AttendanceMonthLog.jsx";

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const pad2 = (n) => String(n).padStart(2, "0");

// One ring + fill pair per department — a small coloured dot in the section header does the work
// an emoji used to, without smuggling in another type system. Kept subtle (100-level fills, 700-
// level text) so section headers sit as rhythm, not as competing content.
const DEPT_SWATCH = {
  Furniture:  { dot: "bg-blue-400",     chip: "bg-blue-50 text-blue-700" },
  Floral:     { dot: "bg-rose-400",     chip: "bg-rose-50 text-rose-700" },
  Structure:  { dot: "bg-stone-500",    chip: "bg-stone-100 text-stone-700" },
  Tenting:    { dot: "bg-emerald-500",  chip: "bg-emerald-50 text-emerald-700" },
  Transport:  { dot: "bg-violet-500",   chip: "bg-violet-50 text-violet-700" },
  Lighting:   { dot: "bg-amber-500",    chip: "bg-amber-50 text-amber-800" },
  Fabric:     { dot: "bg-indigo-500",   chip: "bg-indigo-50 text-indigo-700" },
  ADD:        { dot: "bg-teal-500",     chip: "bg-teal-50 text-teal-700" },
  Admin:      { dot: "bg-gray-900",     chip: "bg-gray-900 text-white" },
  Unassigned: { dot: "bg-gray-300",     chip: "bg-gray-100 text-gray-600" },
};
const deptSwatch = (d) => DEPT_SWATCH[d] || DEPT_SWATCH.Unassigned;

// Shared look for the small square prev / next buttons in this log's date and month steppers —
// 40px on phones (a comfortable tap), 32px from sm up where a mouse is the norm.
const NAV_BTN = "w-10 h-10 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500";

// A small dropdown calendar in the app's own blue theme, standing in for the browser's native
// <input type="date"> popup — that one renders in the OS's own font/colours and looks like a
// different application dropped onto the page next to everything this admin log already styles.
// Its trigger is a borderless button meant to sit inside a stepper group (‹ date ›) — here and in
// LabourAdminLog — so it carries no border of its own. Esc or a click outside closes it.
export function DatePickerPopover({ value, max, onChange }) {
  const [open, setOpen] = useState(false);
  const sel = new Date(value + "T00:00:00");
  const [viewYear, setViewYear] = useState(sel.getFullYear());
  const [viewMonth, setViewMonth] = useState(sel.getMonth() + 1); // 1-12
  const boxRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const d = new Date(value + "T00:00:00");
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  function shiftMonth(delta) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setViewMonth(m); setViewYear(y);
  }

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthLabel = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const navBtn = "w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors";

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" ref={triggerRef} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-10 sm:h-8 px-2.5 rounded-lg text-sm font-semibold text-gray-800 tabular-nums hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">
        <span className="text-gray-500" aria-hidden="true"><IconCalendar size={14} /></span>
        <time dateTime={value}>{new Date(value + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</time>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a date"
          className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white rounded-2xl shadow-lg ring-1 ring-gray-200 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className={navBtn}><span className="rotate-90" aria-hidden="true"><IconChevron size={16} /></span></button>
            <div className="text-sm font-semibold text-gray-900" aria-live="polite">{monthLabel}</div>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className={navBtn}><span className="-rotate-90" aria-hidden="true"><IconChevron size={16} /></span></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-500 mb-1" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={"b" + i} />;
              const dateStr = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
              const isSelected = dateStr === value;
              const isToday = dateStr === todayStr();
              const disabled = max && dateStr > max;
              return (
                <button type="button" key={d} disabled={disabled} onClick={() => { onChange(dateStr); setOpen(false); }}
                  aria-label={`${d} ${monthLabel}${isToday ? " (today)" : ""}`} aria-pressed={isSelected}
                  className={"aspect-square rounded-lg text-xs tabular-nums flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 "
                    + (isSelected ? "bg-blue-600 text-white font-semibold"
                      : disabled ? "text-gray-300 cursor-not-allowed"
                      : isToday ? "ring-1 ring-blue-500 text-blue-700 font-semibold hover:bg-blue-50"
                      : "text-gray-800 hover:bg-gray-100")}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => { onChange(todayStr()); setOpen(false); }}
              className="w-full h-9 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">
              Jump to today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// A dropdown list in the app's own style, standing in for a native <select> the same way
// DatePickerPopover stands in for <input type="date"> — the OS renders a select's own option
// list outside any CSS this app controls, so a real dropdown built from divs is the only way to
// keep it looking like the rest of this page rather than a bare system menu. The "md" trigger
// matches this app's 40px text inputs so it sits flush beside a search box; "sm" is the compact
// variant for inline filters (Labour Punch). Esc or a click outside closes it.
export function SelectPopover({ value, options, onChange, align = "right", size = "md" }) {
  const sm = size === "sm";   // compact variant for inline filters (Labour Punch)
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const triggerRef = useRef(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" ref={triggerRef} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={"flex items-center justify-between bg-white border border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:border-blue-500 transition-colors "
          + (sm ? "gap-1.5 h-10 sm:h-8 rounded-lg px-2.5 text-xs font-medium min-w-28" : "gap-2 h-10 rounded-xl px-3 text-sm min-w-37.5")}>
        <span className="truncate">{current?.label || "All"}</span>
        <span className={"shrink-0 text-gray-500 transition-transform duration-200 " + (open ? "rotate-180" : "")} aria-hidden="true"><IconChevron size={sm ? 14 : 15} /></span>
      </button>
      {open && (
        <div role="listbox" className={"absolute z-30 top-full mt-2 bg-white rounded-xl shadow-lg ring-1 ring-gray-200 p-1.5 max-h-72 overflow-y-auto " + (sm ? "w-44 " : "w-52 ") + (align === "left" ? "left-0" : "right-0")}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button type="button" role="option" aria-selected={selected} key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                className={"w-full flex items-center justify-between gap-2 text-left rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 " + (sm ? "px-2.5 py-1.5 text-xs " : "px-3 py-2 text-sm ")
                  + (selected ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-700 hover:bg-gray-100")}>
                <span className="truncate">{o.label}</span>
                {selected && <span className="shrink-0" aria-hidden="true"><IconCheck size={sm ? 13 : 14} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: one day's punches across EVERY staff member — "who came in when, who
// left when" — with each punch's photo. A single day rather than a whole-month
// grid across everyone: that question is naturally a day-by-day one, and a
// month-wide table for 40+ people would be unreadable rather than useful.
// (The Monthly toggle swaps in per-person month totals instead — see
// AttendanceMonthLog.jsx — never a 40-person day grid.)
//
// Layout: one card — a header (title, the day / filter it's showing, Daily /
// Monthly), a toolbar (date or month stepper, name search, department), then
// the day's totals strip and the punches grouped by department.
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceAdminLog({ users, authUser }) {
  // Non-Admin manager (dept head / supervisor) is scoped to their own departments: only those
  // users' rows, only those depts in the filter. Admin keeps the full "all departments" view.
  const isAdminUser = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const myDepts = isAdminUser ? null : userDepartments(authUser);
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);      // bumped by "Try again" after a failed load
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  // Clicking a stat tile narrows the list to that type — "in" shows only punch-ins, "out" shows
  // only punch-outs, "all" (Staff tile or re-click) resets. Owner ask 2026-11-28: "clickable bna do".
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewing, setViewing] = useState(null); // the punch row whose photo is open big
  // Admin-only override (owner ask 2026-11-28: "admin ke pass option dedo overwrite krne ka punch
  // in punch out and delete krne ka records"). Non-admins never see the controls.
  const [editing, setEditing] = useState(null); // the punch row open in the edit modal
  const [editTime, setEditTime] = useState("");  // "HH:MM" draft from the time input
  const [editType, setEditType] = useState("in");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmPunch, confirmPunchDialog] = useConfirm();
  const openEdit = (p) => {
    const d = new Date(p.at);
    const hh = String(d.getHours()).padStart(2, "0"); const mm = String(d.getMinutes()).padStart(2, "0");
    setEditTime(`${hh}:${mm}`); setEditType(p.type || "in"); setEditError(""); setEditing(p);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const m = /^(\d{1,2}):(\d{2})$/.exec(editTime);
    if (!m) { setEditError("Enter a time as HH:MM (24-hour)."); return; }
    const hh = Number(m[1]), mm = Number(m[2]);
    if (hh > 23 || mm > 59) { setEditError("That time isn't valid."); return; }
    const next = new Date(editing.at); next.setHours(hh, mm, 0, 0);
    setEditBusy(true); setEditError("");
    try {
      const updated = await updatePunchRow(editing.id, { type: editType, at: next.toISOString() });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditing(null);
    } catch (e) { setEditError(e?.message || "Couldn't save the change."); }
    setEditBusy(false);
  };
  const deletePunch = async (p) => {
    const ok = await confirmPunch({
      title: "Delete this punch?",
      body: `${punchLabel(p)} at ${fmtTime(p.at)} for ${p.user_name || "this user"}. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePunchRow(p.id);
      setRows((prev) => prev.filter((r) => r.id !== p.id));
    } catch (e) { setError(e?.message || "Couldn't delete that punch."); }
  };

  // user_id -> department(s), from the real roster (IMS -> Admin -> Users & Roles), not guessed
  // from the attendance rows themselves — a punch row has no department of its own.
  const deptByUserId = useMemo(() => {
    const map = {};
    (users || []).forEach((u) => { map[u.id] = userDepartments(u); });
    return map;
  }, [users]);

  // Admin's own punches get their own group rather than landing in "Unassigned" alongside roles
  // that genuinely have no department (Sales, a role with no dept in its name, …) — an admin
  // punching in isn't a data gap the way an unclassified staff member's row is. Same isAdmin
  // convention used everywhere else in this app (role === "Admin" or the legacy u_admin id).
  const isAdminByUserId = useMemo(() => {
    const map = {};
    (users || []).forEach((u) => { map[u.id] = u.role === "Admin" || u.id === "u_admin"; });
    return map;
  }, [users]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchRangePunches(date, date)
      .then((data) => { if (active) { setRows(data); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load attendance"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date, reload]);

  // The shared Modal has no Esc handling of its own; the photo preview should close on Esc like
  // every other popover in this log.
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e) => { if (e.key === "Escape") setViewing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  // Daily (one day's punches) or Monthly (per-person totals + Excel export, AttendanceMonthLog).
  const [view, setView] = useState("day");
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 }));
  const isCurMonth = ym.y === new Date().getFullYear() && ym.m === new Date().getMonth() + 1;
  function shiftMonth(delta) {
    setYm(({ y, m }) => { let nm = m + delta, ny = y; if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; } return { y: ny, m: nm }; });
  }

  function shiftDay(delta) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }

  const term = search.trim().toLowerCase();
  const isFiltered = !!term || dept !== "all" || typeFilter !== "all";
  // Dept-manager scope first, so search / dept chip only ever narrow from an already-filtered set.
  const scoped = !myDepts ? rows : rows.filter((r) => (deptByUserId[r.user_id] || []).some((d) => myDepts.includes(d)));
  const searched = term ? scoped.filter((r) => (r.user_name || "").toLowerCase().includes(term)) : scoped;
  const deptFiltered = dept === "all" ? searched
    : dept === "Admin" ? searched.filter((r) => isAdminByUserId[r.user_id])
    : searched.filter((r) => (deptByUserId[r.user_id] || []).includes(dept));
  // typeFilter applies LAST so the stat tiles' own counts stay honest against the dept/search
  // narrowed set — "6 staff, 10 punch-ins" is for whatever dept the user picked, then clicking
  // Punch-ins drops the list to just those 10 rows (headline numbers don't flinch mid-click).
  const filtered = typeFilter === "in" ? deptFiltered.filter((r) => r.type === "in")
    : typeFilter === "out" ? deptFiltered.filter((r) => r.type !== "in")
    : deptFiltered;

  // Grouped by department only in the "all" view — a specific department's own filter above
  // already narrows the flat list to just that one, so a repeated section header would be noise.
  // Admin gets its own group (checked first, before department at all — an admin's own row never
  // also gets filed under a department). A row with no roster match at all (deleted user, or a
  // non-admin role with no department — Sales, …) falls into "Unassigned" rather than being
  // silently dropped from the log.
  const groups = dept !== "all" ? null : (() => {
    const byDept = {};
    DEPTS.forEach((d) => { byDept[d] = []; });
    byDept.Admin = [];
    byDept.Unassigned = [];
    filtered.forEach((r) => {
      if (isAdminByUserId[r.user_id]) { byDept.Admin.push(r); return; }
      const ds = deptByUserId[r.user_id];
      if (Array.isArray(ds) && ds.length) ds.forEach((d) => byDept[d]?.push(r));
      else byDept.Unassigned.push(r);
    });
    return Object.entries(byDept).filter(([, list]) => list.length);
  })();

  // The day at a glance, over whatever the search / department filter currently shows. Numbers
  // come from deptFiltered (not filtered) so the headline counts stay honest while the row list
  // below is narrowed to the active type. Each tile is a toggle: click once to narrow to that
  // type, click again (or click Staff) to clear.
  const dayStats = [
    { label: "Staff",       value: new Set(deptFiltered.map((r) => r.user_id)).size, dot: "bg-gray-400",    hint: "unique people", type: "all" },
    { label: "Punch-ins",   value: deptFiltered.filter((r) => r.type === "in").length, dot: "bg-emerald-500", hint: "in today",     type: "in" },
    { label: "Punch-outs",  value: deptFiltered.filter((r) => r.type !== "in").length, dot: "bg-amber-500",   hint: "out today",   type: "out" },
  ];

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const monthLabel = new Date(ym.y, ym.m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // Row microinteraction: the whole row runs in a `group`, so the avatar's ring strengthens and the
  // time scrubs forward a touch on hover. Keeps the hover signal precise — not a full card lift,
  // not a swap, just enough to signal "this row is pickable" where a photo exists.
  const renderRow = (p) => {
    const statusTone = p.type === "in"
      ? "bg-emerald-50 ring-emerald-200 text-emerald-800"
      : p.auto_closed
        ? "bg-amber-50 ring-amber-200 text-amber-800"
        : "bg-gray-50 ring-gray-200 text-gray-700";
    const statusDot = p.type === "in" ? "bg-emerald-500" : p.auto_closed ? "bg-amber-500" : "bg-gray-400";
    const statusLabel = p.type === "in" ? "In" : p.auto_closed ? "Auto out" : "Out";
    return (
      <li key={p.id} className="group relative flex items-center gap-3 px-5 py-3 hover:bg-gray-50/70 transition-colors">
        {/* A thin left-edge accent appears on hover — subtle, 2px, in the status hue. Status in the
            row is already told by the pill; the accent just gives the eye a seam to follow when
            scanning a long list. 0 at rest so it never adds visual weight to the untouched state. */}
        <span aria-hidden="true" className={"absolute left-0 top-2 bottom-2 w-0.5 rounded-r transition-opacity duration-150 opacity-0 group-hover:opacity-100 "
          + (p.type === "in" ? "bg-emerald-500" : p.auto_closed ? "bg-amber-500" : "bg-gray-400")} />
        {p.photo ? (
          <button type="button" onClick={() => setViewing(p)} aria-label={`View punch photo: ${p.user_name || "unnamed"}`} title="View photo"
            className="relative w-11 h-11 shrink-0 rounded-xl overflow-hidden bg-gray-100 ring-1 ring-gray-200 group-hover:ring-2 group-hover:ring-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-shadow">
            <img src={p.photo} alt="" className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
            {/* Tiny status dot sits on the avatar's bottom-right corner — doubles the pill's cue
                into the one element the eye lands on first, with a white ring so it reads on any
                photo background. Keeps "who's currently in" readable even in a dense list. */}
            <span aria-hidden="true" className={"absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white " + statusDot} />
          </button>
        ) : (
          <div title="No photo" className="relative w-11 h-11 shrink-0 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center">
            <IconCamera size={16} /><span className="sr-only">No photo</span>
            <span aria-hidden="true" className={"absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white " + statusDot} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-gray-900 truncate">{p.user_name || "—"}</span>
            <span className={"inline-flex items-center gap-1.5 shrink-0 rounded-full ring-1 px-2 py-0.5 text-[11px] font-semibold " + statusTone}>
              <span className={"w-1.5 h-1.5 rounded-full " + statusDot} aria-hidden="true" />{statusLabel}
            </span>
            {p.type === "in" && p.quiz_passed === false && (
              <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[11px] font-semibold bg-red-50 ring-red-200 text-red-700">
                <IconX size={10} /> Quiz failed
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 min-w-0">
            <IconPin size={11} /><span className="truncate">{punchLocationLabel(p)}</span>
          </div>
          {p.type === "in" && p.quiz_passed === false && (
            <span className="sm:hidden mt-1 inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[11px] font-semibold bg-red-50 ring-red-200 text-red-700">Quiz failed</span>
          )}
        </div>
        <time dateTime={p.at} className="shrink-0 text-sm font-semibold text-gray-800 tabular-nums tracking-tight">{fmtTime(p.at)}</time>
        {isAdminUser && (
          <div className="shrink-0 flex items-center gap-1 ml-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={() => openEdit(p)} aria-label="Edit this punch" title="Edit punch"
              className="w-8 h-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
            <button type="button" onClick={() => deletePunch(p)} aria-label="Delete this punch" title="Delete punch"
              className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Staff attendance log" className="rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
      {/* ── HEADER ── title, what's being shown, Daily / Monthly. */}
      <div className="flex items-start justify-between flex-wrap gap-3 px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><IconUsers size={15} /> Staff attendance log</h3>
          <p className="mt-0.5 text-xs text-gray-500" aria-live="polite">{view === "day" ? dateLabel : `${monthLabel} · every active staff member, punched or not`}</p>
        </div>
        <div className="flex rounded-xl bg-gray-100 p-1" role="group" aria-label="View">
          {[["day", "Daily"], ["month", "Monthly"]].map(([v, l]) => (
            <button type="button" key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={"h-8 px-3 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 "
                + (view === v ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70" : "text-gray-600 hover:text-gray-900")}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── TOOLBAR ── day / month stepper, name search, department. */}
      <div className="border-t border-gray-100 px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
        {view === "day" ? (
          <div className="flex items-center justify-between sm:justify-start gap-1 rounded-xl bg-gray-50 ring-1 ring-gray-200/70 p-1">
            <button type="button" onClick={() => shiftDay(-1)} aria-label="Previous day" title="Previous day" className={NAV_BTN}>
              <span className="rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
            </button>
            <DatePickerPopover value={date} max={today} onChange={setDate} />
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shiftDay(1)} disabled={date >= today} aria-label="Next day" title="Next day" className={NAV_BTN}>
                <span className="-rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
              </button>
              {date !== today && (
                <button type="button" onClick={() => setDate(today)}
                  className="h-10 sm:h-8 px-2.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">Today</button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between sm:justify-start gap-1 rounded-xl bg-gray-50 ring-1 ring-gray-200/70 p-1">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" title="Previous month" className={NAV_BTN}>
              <span className="rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
            </button>
            <span className="px-2.5 text-sm font-semibold text-gray-800 tabular-nums">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shiftMonth(1)} disabled={isCurMonth} aria-label="Next month" title="Next month" className={NAV_BTN}>
                <span className="-rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
              </button>
              {!isCurMonth && (
                <button type="button" onClick={() => setYm({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 })}
                  className="h-10 sm:h-8 px-2.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">This month</button>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true"><IconSearch size={15} /></span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" aria-label="Search staff by name"
              className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500" />
          </div>
          <SelectPopover value={dept} onChange={setDept}
            options={[
              { value: "all", label: myDepts ? (myDepts.length === 1 ? myDepts[0] : "My departments") : "All departments" },
              ...(myDepts ? DEPTS.filter((d) => myDepts.includes(d)) : DEPTS).map((d) => ({ value: d, label: d })),
              ...(myDepts ? [] : [{ value: "Admin", label: "Admin" }]),
            ]} />
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="border-t border-gray-100">
        {view === "month" ? (
          <AttendanceMonthLog users={users} ym={ym} search={search} dept={dept} deptByUserId={deptByUserId} isAdminByUserId={isAdminByUserId} scopeDepts={myDepts} />
        ) : loading ? (
          <div aria-busy="true" aria-label="Loading punches">
            <div className="px-5 pt-4">
              <div className="h-16 rounded-xl bg-gray-50 ring-1 ring-gray-100 motion-safe:animate-pulse" />
            </div>
            <ul className="mt-2 divide-y divide-gray-100">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-11 h-11 rounded-xl bg-gray-100 motion-safe:animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-36 max-w-full rounded bg-gray-100 motion-safe:animate-pulse" />
                    <div className="h-2.5 w-48 max-w-full rounded bg-gray-100 motion-safe:animate-pulse" />
                  </div>
                  <div className="h-3 w-12 rounded bg-gray-100 motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center" role="alert">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)}
              className="mt-3 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Try again</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconCalendar size={18} /></div>
            <p className="mt-3 text-sm font-medium text-gray-700">{isFiltered ? "No punches match that filter" : "No punches on this day"}</p>
            <p className="mt-1 text-xs text-gray-500">
              {isFiltered ? "Try another name or department." : date === today ? "Punches show up here as staff punch in and out." : "Nobody punched in or out that day."}
            </p>
            {isFiltered && (
              <button type="button" onClick={() => { setSearch(""); setDept("all"); setTypeFilter("all"); }}
                className="mt-4 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                <IconX size={14} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mx-5 mt-4 grid grid-cols-3 rounded-xl ring-1 ring-gray-100 divide-x divide-gray-100 overflow-hidden" role="group" aria-label="Narrow by punch type">
              {dayStats.map((s) => {
                const active = typeFilter === s.type || (s.type === "all" && typeFilter === "all");
                return (
                  <button type="button" key={s.label}
                    onClick={() => setTypeFilter((cur) => (cur === s.type ? "all" : s.type))}
                    aria-pressed={active}
                    className={"group text-left px-4 py-3 min-w-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset "
                      + (active ? "bg-white shadow-[inset_0_-2px_0_rgba(37,99,235,0.6)]" : "bg-gray-50/80 hover:bg-white")}>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider truncate">
                      <span className={"w-1.5 h-1.5 rounded-full " + s.dot} aria-hidden="true" />{s.label}
                    </span>
                    <span className="block mt-1 text-2xl font-semibold text-gray-900 tabular-nums leading-none tracking-tight">{s.value}</span>
                    <span className="block mt-1 text-[11px] text-gray-500 truncate">{active && s.type !== "all" ? "showing these" : s.hint}</span>
                  </button>
                );
              })}
            </div>
            {groups ? (
              <div className="mt-4 pb-2">
                {groups.map(([d, list]) => {
                  const sw = deptSwatch(d);
                  const inCount = list.filter((r) => r.type === "in").length;
                  return (
                  <section key={d} aria-label={d}>
                    <h4 className="flex items-center gap-2.5 px-5 py-2.5 bg-gray-50/70 border-y border-gray-100 text-xs font-semibold text-gray-700">
                      <span aria-hidden="true" className={"w-2 h-2 rounded-full " + sw.dot} />
                      <span className="tracking-tight">{d}</span>
                      <span className={"rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " + sw.chip}>{list.length}</span>
                      {inCount > 0 && inCount < list.length && (
                        <span className="text-[11px] font-medium text-gray-500 tabular-nums">· {inCount} in</span>
                      )}
                    </h4>
                    <ul className="divide-y divide-gray-100">{list.map(renderRow)}</ul>
                  </section>
                  );
                })}
              </div>
            ) : (
              <ul className="mt-4 mb-2 border-t border-gray-100 divide-y divide-gray-100">
                {filtered.map(renderRow)}
              </ul>
            )}
          </>
        )}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.user_name || "Punch photo"}>
        {viewing && (
          <div>
            <img src={viewing.photo} alt={`${viewing.user_name || "Staff"} — ${punchLabel(viewing)} photo`} className="w-full rounded-xl ring-1 ring-gray-200 bg-gray-100" />
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-900">{punchLabel(viewing)}</span>
              <time dateTime={viewing.at} className="text-sm font-medium text-gray-700 tabular-nums">{fmtTime(viewing.at)}</time>
            </div>
            <p className="mt-1 text-xs text-gray-500 flex items-center gap-1 min-w-0"><IconPin size={11} /><span className="truncate">{punchLocationLabel(viewing)}</span></p>
            {viewing.type === "in" && viewing.quiz_passed != null && (
              <p className="mt-3">
                {viewing.quiz_passed ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-green-50 ring-green-200 text-green-800"><IconCheck size={12} /> Briefing quiz passed</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-red-50 ring-red-200 text-red-700"><IconX size={12} /> Briefing quiz not passed</span>
                )}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Admin-only edit modal: change the type (in/out) and the time for a punch. Date is fixed
          to the row's own date — a punch was never supposed to move between days, and letting it
          would leave the day grouping lying. Delete has its own confirm (useConfirm above). */}
      <Modal open={!!editing} onClose={() => (editBusy ? null : setEditing(null))} title={editing ? `Edit ${editing.user_name || "punch"}` : ""}>
        {editing && (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1.5">Type</div>
              <div className="inline-flex rounded-xl bg-gray-100 p-1">
                {[["in", "Punch In"], ["out", "Punch Out"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setEditType(v)} aria-pressed={editType === v}
                    className={"h-9 px-4 rounded-lg text-xs font-semibold transition-colors "
                      + (editType === v ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70" : "text-gray-600 hover:text-gray-900")}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="edit-time" className="block text-xs font-semibold text-gray-700 mb-1.5">Time (24-hour)</label>
              <input id="edit-time" type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                className="w-full h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500" />
              <p className="mt-1 text-xs text-gray-500">Date stays the same ({new Date(editing.at + "").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}).</p>
            </div>
            {editError && <p role="alert" className="text-xs text-red-600">{editError}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} disabled={editBusy}
                className="h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={editBusy}
                className="h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-wait">
                {editBusy ? "Saving…" : "Save change"}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {confirmPunchDialog}
    </section>
  );
}

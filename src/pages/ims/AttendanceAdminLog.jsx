import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../components/ui";
import { fetchRangePunches, todayStr, punchLabel, punchLocationLabel } from "../../lib/ims/attendance";
import { DEPTS, userDepartments } from "../../lib/ims/deptClassify";
import { IconPin, IconCalendar } from "../../components/icons.jsx";

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const pad2 = (n) => String(n).padStart(2, "0");

// A small dropdown calendar in the app's own blue theme, standing in for the browser's native
// <input type="date"> popup — that one renders in the OS's own font/colours and looks like a
// different application dropped onto the page next to everything this admin log already styles.
export function DatePickerPopover({ value, max, onChange }) {
  const [open, setOpen] = useState(false);
  const sel = new Date(value + "T00:00:00");
  const [viewYear, setViewYear] = useState(sel.getFullYear());
  const [viewMonth, setViewMonth] = useState(sel.getMonth() + 1); // 1-12
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const d = new Date(value + "T00:00:00");
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
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

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={() => setOpen((o) => !o)}
        className="text-sm font-semibold text-gray-700 px-2 py-1 rounded-lg hover:bg-white transition">
        {new Date(value + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
      </button>
      {open && (
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-2xl shadow-xl ring-1 ring-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => shiftMonth(-1)} className="text-gray-400 hover:text-gray-700 px-2 text-lg leading-none">‹</button>
            <div className="text-sm font-bold text-gray-800">{monthLabel}</div>
            <button onClick={() => shiftMonth(1)} className="text-gray-400 hover:text-gray-700 px-2 text-lg leading-none">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-400 uppercase mb-1">
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
                <button key={d} disabled={disabled} onClick={() => { onChange(dateStr); setOpen(false); }}
                  className={"aspect-square rounded-lg text-xs flex items-center justify-center transition "
                    + (isSelected ? "bg-blue-600 text-white font-bold"
                      : disabled ? "text-gray-300 cursor-not-allowed"
                      : isToday ? "ring-1 ring-blue-300 text-gray-700 hover:bg-blue-50"
                      : "text-gray-700 hover:bg-blue-50")}>
                  {d}
                </button>
              );
            })}
          </div>
          <button onClick={() => { onChange(todayStr()); setOpen(false); }}
            className="w-full mt-2 pt-2 border-t text-xs font-semibold text-blue-600 hover:text-blue-700 text-center">
            Jump to today
          </button>
        </div>
      )}
    </div>
  );
}

// A dropdown list in the app's own style, standing in for a native <select> the same way
// DatePickerPopover stands in for <input type="date"> — the OS renders a select's own option
// list outside any CSS this app controls, so a real dropdown built from divs is the only way to
// keep it looking like the rest of this page rather than a bare system menu.
export function SelectPopover({ value, options, onChange, align = "right", size = "md" }) {
  const sm = size === "sm";   // compact variant for inline filters (Labour Punch)
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={() => setOpen((o) => !o)}
        className={"flex items-center border border-gray-200 text-gray-700 hover:border-gray-300 transition justify-between "
          + (sm ? "gap-1.5 rounded-lg px-2.5 py-1 text-xs min-w-28" : "gap-2 rounded-xl px-3 py-2 text-sm min-w-37.5")}>
        {current?.label || "All"}
        <span className={"text-gray-400 text-[10px] transition-transform " + (open ? "rotate-180" : "")}>▾</span>
      </button>
      {open && (
        <div className={"absolute z-20 top-full mt-2 bg-white rounded-xl shadow-xl ring-1 ring-gray-200 p-1.5 max-h-72 overflow-y-auto " + (sm ? "w-40 " : "w-48 ") + (align === "left" ? "left-0" : "right-0")}>
          {options.map((o) => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={"w-full text-left rounded-lg transition " + (sm ? "px-2.5 py-1 text-xs " : "px-3 py-1.5 text-sm ")
                + (o.value === value ? "bg-blue-600 text-white font-semibold" : "text-gray-700 hover:bg-blue-50")}>
              {o.label}
            </button>
          ))}
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
// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceAdminLog({ users }) {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const [viewing, setViewing] = useState(null); // the punch row whose photo is open big

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
  }, [date]);

  function shiftDay(delta) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }

  const term = search.trim().toLowerCase();
  const searched = term ? rows.filter((r) => (r.user_name || "").toLowerCase().includes(term)) : rows;
  const filtered = dept === "all" ? searched
    : dept === "Admin" ? searched.filter((r) => isAdminByUserId[r.user_id])
    : searched.filter((r) => (deptByUserId[r.user_id] || []).includes(dept));

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

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const renderRow = (p) => (
    <div key={p.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gray-50 transition">
      <button onClick={() => p.photo && setViewing(p)} title={p.photo ? "View photo" : "No photo"}
        className={"w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center ring-1 ring-gray-100 "
          + (p.photo ? "hover:ring-blue-300 cursor-pointer transition" : "cursor-default")}>
        {p.photo ? <img src={p.photo} alt="" className="w-full h-full object-cover" /> : <span className="text-gray-300 text-xs">—</span>}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 truncate">{p.user_name || "—"}</span>
          <span className={"text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0 "
            + (p.type === "in" ? "bg-green-100 text-green-700"
              : p.auto_closed ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600")}>
            {p.type === "in" ? "In" : p.auto_closed ? "Auto out" : "Out"}
          </span>
          {p.type === "in" && p.quiz_passed === false && (
            <span className="text-[10px] font-semibold text-red-500 flex-shrink-0">Quiz failed</span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 truncate flex items-center gap-1"><IconPin size={11} /> {punchLocationLabel(p)}</div>
      </div>
      <div className="text-sm font-medium text-gray-500 flex-shrink-0">{fmtTime(p.at)}</div>
    </div>
  );

  return (
    <div className="mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h3 className="text-lg font-bold text-gray-900">Staff Attendance Log</h3>
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl ring-1 ring-gray-100 p-1">
          <button onClick={() => shiftDay(-1)} title="Previous day"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition text-lg leading-none">‹</button>
          <DatePickerPopover value={date} max={today} onChange={setDate} />
          <button onClick={() => shiftDay(1)} disabled={date >= today} title="Next day"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">›</button>
          {date !== today && (
            <button onClick={() => setDate(today)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2">Today</button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">{dateLabel}</p>

      <div className="flex gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        <SelectPopover value={dept} onChange={setDept}
          options={[{ value: "all", label: "All departments" }, ...DEPTS.map((d) => ({ value: d, label: d })), { value: "Admin", label: "Admin" }]} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-10">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10">
          <div className="flex justify-center mb-2 text-gray-300"><IconCalendar size={26} /></div>
          <p className="text-sm text-gray-400">No punches match {term || dept !== "all" ? "that filter" : "on this day"} yet.</p>
        </div>
      ) : groups ? (
        <div className="space-y-5">
          {groups.map(([d, list]) => (
            <div key={d}>
              <div className="flex items-center gap-2 mb-1 px-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{d}</span>
                <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{list.length}</span>
              </div>
              <div>{list.map(renderRow)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {filtered.map(renderRow)}
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.user_name || "Punch photo"}>
        {viewing && (
          <div className="text-center">
            <img src={viewing.photo} alt="" className="w-full rounded-xl mb-3" />
            <p className="text-sm text-gray-600">{punchLabel(viewing)} at {fmtTime(viewing.at)}</p>
            <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1"><IconPin size={11} /> {punchLocationLabel(viewing)}</p>
            {viewing.type === "in" && viewing.quiz_passed != null && (
              <p className="text-xs text-gray-400 mt-1">Briefing quiz: {viewing.quiz_passed ? "passed" : "not passed"}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { Modal, useConfirm } from "../../components/ui";
import { todayStr, dayHours, daySummary, punchLocationLabel } from "../../lib/ims/attendance";
import { loadExcelJS, downloadWorkbook, styleHeader } from "../../lib/excel";
import { LABOUR_DEPTS, DEPT_ICON, fetchLabourPunchesRange, fetchAllActiveLabours, displayName, updateLabourPunchRow, deleteLabourPunchRow } from "../../lib/ims/labourAttendance";
import { userDepartments } from "../../lib/ims/deptClassify";
import { DatePickerPopover, SelectPopover } from "./AttendanceAdminLog.jsx";
import { IconPin, IconCalendar, IconUsers, IconExcelMark, IconChevron, IconSearch } from "../../components/icons.jsx";

// ═══ ADMIN: LABOUR LOG ═══ (Attendance → Labour Log)
// Everything the Labour Punch screen records, across every department, for Admin:
//   Day   — one row per labour: each punch's photo (tap to enlarge), time, place and who punched
//           them, hours worked, plus the roster's labours who never punched that day.
//   Month — per labour: days present, hours, and days left open (no punch-out).
// Hours use the same in→out pairing as staff attendance (dayHours) — an unmatched 'in' adds nothing.
// Styled to match the redesigned punch screen (AttendanceTab.jsx): one white card, a header with
// the Day / Month switch and date stepper, the filters, a stat strip, then the list or table.

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const fmtHours = (h) => (h > 0 ? `${h.toFixed(1)}h` : "—");
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDay = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

// Full literal class strings (not assembled) so Tailwind's build can see every one.
const navBtn = "w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500";
const thHead = "py-2.5 text-xs font-medium text-gray-500";

const Spinner = () => <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" />;

function EmptyState({ icon, title, hint }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center">{icon}</div>
      <p className="mt-3 text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export default function LabourAdminLog({ authUser }) {
  // Dept-manager scope: non-Admin heads/supervisors see only their own dept labours. Admin passes
  // null and sees every labour and every punch. Used both in the `keep` filter below and to narrow
  // the dept dropdown on screen so "All departments" means "all of mine".
  const isAdminUser = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const myDepts = isAdminUser ? null : userDepartments(authUser);
  const today = todayStr();
  const [view, setView] = useState("day");   // "day" | "month"
  const [date, setDate] = useState(today);
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 }));
  const [dept, setDept] = useState("all");
  const [search, setSearch] = useState("");
  // Stat tiles double as a filter — Present (all), Still in (last punch still "in"), Not punched
  // (no punch for the day at all). Owner ask 2026-11-28: "labour wale mai bhi clickable krdo".
  const [typeFilter, setTypeFilter] = useState("all");
  // Admin-only overrides on a single punch row — owner ask 2026-11-28: edit the time/type or
  // delete a stray record, same affordance as Staff Log.
  const [editing, setEditing] = useState(null); // the punch row open in the edit modal
  const [editTime, setEditTime] = useState("");
  const [editType, setEditType] = useState("in");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmPunch, confirmPunchDialog] = useConfirm();
  const [rows, setRows] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);         // bumped by "Try again" to re-run the load
  const [viewing, setViewing] = useState(null);   // the punch whose photo is open big
  const [openId, setOpenId] = useState(null);      // month row expanded to its day-by-day in/out
  const [exporting, setExporting] = useState(false);

  const range = view === "day"
    ? [date, date]
    : [`${ym.y}-${pad2(ym.m)}-01`, `${ym.y}-${pad2(ym.m)}-${pad2(new Date(ym.y, ym.m, 0).getDate())}`];

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetchLabourPunchesRange(range[0], range[1]), fetchAllActiveLabours()])
      .then(([ps, ls]) => { if (active) { setRows(ps); setRoster(ls); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load the labour log"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line -- keyed on the range strings (and the retry counter)
  }, [range[0], range[1], reload]);

  const term = search.trim().toLowerCase();
  const inMyScope = (d) => !myDepts || myDepts.includes(d);
  const keep = (name, d) => inMyScope(d) && (dept === "all" || d === dept) && (!term || (name || "").toLowerCase().includes(term));
  const filtered = !!term || dept !== "all";

  // labour_id → { name, department, punches[] } for the loaded range, oldest-first punches.
  const byLabour = useMemo(() => {
    const m = new Map();
    rows.forEach((p) => {
      if (!m.has(p.labour_id)) m.set(p.labour_id, { id: p.labour_id, name: p.labour_name || "—", department: p.department, punches: [] });
      m.get(p.labour_id).punches.push(p);
    });
    return m;
  }, [rows]);
  const labours = [...byLabour.values()].filter((l) => keep(l.name, l.department)).sort((a, b) => a.name.localeCompare(b.name));
  const notPunched = view === "day" ? roster.filter((l) => !byLabour.has(l.id) && keep(l.name, l.department)) : [];

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
      const updated = await updateLabourPunchRow(editing.id, { type: editType, at: next.toISOString() });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditing(null);
    } catch (e) { setEditError(e?.message || "Couldn't save the change."); }
    setEditBusy(false);
  };
  const deletePunch = async (p) => {
    const ok = await confirmPunch({
      title: "Delete this punch?",
      body: `${p.type === "in" ? "Punch in" : "Punch out"} at ${fmtTime(p.at)} for ${displayName(p.labour_name) || "this labour"}. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLabourPunchRow(p.id);
      setRows((prev) => prev.filter((r) => r.id !== p.id));
    } catch (e) { setError(e?.message || "Couldn't delete that punch."); }
  };

  function shiftDay(delta) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }
  function shiftMonth(delta) {
    setYm(({ y, m }) => { let nm = m + delta, ny = y; if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; } return { y: ny, m: nm }; });
  }
  const isCurMonth = ym.y === new Date().getFullYear() && ym.m === new Date().getMonth() + 1;
  const atLatest = view === "day" ? date >= today : isCurMonth;
  function jumpToToday() {
    if (view === "day") setDate(today);
    else setYm({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
  }

  // Day stats
  const dayStats = labours.reduce((acc, l) => {
    acc.present++;
    if (l.punches[l.punches.length - 1]?.type === "in") acc.stillIn++;
    acc.hours += dayHours(l.punches);
    return acc;
  }, { present: 0, stillIn: 0, hours: 0 });

  // Month rows — every roster labour too, punched or not, so the month reads as a complete list
  // for payment (same as the staff month log).
  const monthBase = view !== "month" ? [] : [
    ...labours,
    ...roster.filter((l) => !byLabour.has(l.id) && keep(l.name, l.department)).map((l) => ({ id: l.id, name: l.name, department: l.department, punches: [] })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const monthRows = monthBase.map((l) => {
    const byDate = {};
    l.punches.forEach((p) => { (byDate[p.date] ||= []).push(p); });
    const days = Object.values(byDate);
    return {
      ...l,
      byDate,
      daysPresent: days.filter((ps) => ps.some((p) => p.type === "in")).length,
      hours: days.reduce((s, ps) => s + dayHours(ps), 0),
      // openDays = labour truly has no closing punch (last event is "in"); autoClosedDays = cron
       // closed them. Kept apart so payroll can tell "forgot to punch out" from "auto-closed".
       openDays: days.filter((ps) => ps[ps.length - 1]?.type === "in").length,
       autoClosedDays: days.filter((ps) => ps.some((p) => p.auto_closed)).length,
    };
  });

  // Month → Excel: what is on screen (search + department), same four sheets as the staff month log
  // (Summary, Daily grid, Day-wise in/out, every Punch with its photo link) plus who punched them.
  async function exportExcel() {
    setExporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = "Ambria IMS";
      const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
      const r1 = (h) => Math.round(h * 10) / 10;

      const s1 = wb.addWorksheet("Summary");
      s1.columns = [
        { header: "Labour", key: "name", width: 24 }, { header: "Department", key: "dept", width: 14 },
        { header: "Days present", key: "days", width: 13 }, { header: "Total hours", key: "hours", width: 12 },
        { header: "Days without punch-out", key: "open", width: 22 },
      ];
      monthRows.forEach((r) => s1.addRow({ name: r.name, dept: r.department, days: r.daysPresent, hours: r1(r.hours), open: r.openDays }));
      s1.addRow({ name: `Total (${monthRows.length})`, days: monthRows.reduce((s, r) => s + r.daysPresent, 0), hours: r1(monthRows.reduce((s, r) => s + r.hours, 0)), open: monthRows.reduce((s, r) => s + r.openDays, 0) }).font = { bold: true };
      styleHeader(s1);

      const s2 = wb.addWorksheet("Daily");
      const dayCols = Array.from({ length: daysInMonth }, (_, i) => ({
        key: `${ym.y}-${pad2(ym.m)}-${pad2(i + 1)}`,
        header: new Date(ym.y, ym.m - 1, i + 1).toLocaleDateString("en-IN", { day: "numeric", weekday: "short" }),
        width: 24,
      }));
      s2.columns = [{ header: "Labour", key: "name", width: 24 }, { header: "Department", key: "dept", width: 14 }, ...dayCols, { header: "Total h", key: "total", width: 10 }];
      monthRows.forEach((r) => {
        const row = { name: r.name, dept: r.department, total: r1(r.hours) };
        dayCols.forEach(({ key }) => {
          const ps = r.byDate[key];
          if (!ps?.length) return;
          const d = daySummary(ps);
          row[key] = d.open ? `${fmtTime(d.inAt)}–… (no out)` : `${fmtTime(d.inAt)}–${fmtTime(d.outAt)}${d.auto ? " (auto)" : ""} · ${r1(d.hours)}h`;
        });
        s2.addRow(row);
      });
      styleHeader(s2);
      s2.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

      const s3 = wb.addWorksheet("Day-wise");
      s3.columns = [
        { header: "Date", key: "date", width: 12 }, { header: "Labour", key: "name", width: 22 }, { header: "Department", key: "dept", width: 14 },
        { header: "Punch in", key: "in", width: 11 }, { header: "Punch out", key: "out", width: 11 }, { header: "Hours", key: "hours", width: 8 },
        { header: "Punched by", key: "by", width: 20 }, { header: "Note", key: "note", width: 18 },
      ];
      Object.keys(Object.assign({}, ...monthRows.map((r) => r.byDate))).sort().forEach((date) => {
        monthRows.forEach((r) => {
          const ps = r.byDate[date];
          if (!ps?.length) return;
          const d = daySummary(ps);
          s3.addRow({
            date, name: r.name, dept: r.department, in: d.inAt ? fmtTime(d.inAt) : "", out: d.outAt ? fmtTime(d.outAt) : "", hours: r1(d.hours),
            by: [...new Set(ps.map((p) => p.punched_by_name).filter(Boolean))].join(", "),
            note: d.open ? "No punch-out" : d.auto ? "Auto punched out" : "",
          });
        });
      });
      styleHeader(s3);

      const s4 = wb.addWorksheet("Punches");
      s4.columns = [
        { header: "Date", key: "date", width: 12 }, { header: "Labour", key: "name", width: 22 }, { header: "Department", key: "dept", width: 14 },
        { header: "Punch", key: "type", width: 16 }, { header: "Time", key: "time", width: 10 }, { header: "Location", key: "loc", width: 28 },
        { header: "Punched by", key: "by", width: 20 }, { header: "Photo", key: "photo", width: 14 },
      ];
      const ids = new Set(monthRows.map((r) => r.id));
      rows.filter((p) => ids.has(p.labour_id)).forEach((p) => {
        const row = s4.addRow({
          date: p.date, name: p.labour_name || "—", dept: p.department,
          type: p.type === "in" ? "Punched in" : p.auto_closed ? "Auto punched out" : "Punched out",
          time: fmtTime(p.at), loc: punchLocationLabel(p), by: p.punched_by_name || "",
        });
        if (p.photo) { const c = row.getCell("photo"); c.value = { text: "View photo", hyperlink: p.photo }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
      });
      styleHeader(s4);

      const deptPart = dept === "all" ? "" : `_${dept.replace(/[^a-zA-Z0-9]+/g, "_")}`;
      await downloadWorkbook(wb, `Ambria_Labour_Attendance_${ym.y}-${pad2(ym.m)}${deptPart}.xlsx`);
    } catch (e) {
      setError(e.message || "Couldn't export");
    } finally {
      setExporting(false);
    }
  }

  // A punch's photo tile: ring + caption coloured by kind (green in, red out, amber auto-closed out).
  // Tap opens the photo big; a punch with no photo is a disabled tile (auto punch-outs have none).
  const thumb = (p) => {
    const kind = p.type === "in" ? "Punched in" : p.auto_closed ? "Auto punched out" : "Punched out";
    return (
      <div key={p.id} className="group relative shrink-0">
        <button type="button" onClick={() => p.photo && setViewing(p)} disabled={!p.photo}
          aria-label={`${kind} at ${fmtTime(p.at)}${p.photo ? " — view photo" : " — no photo"}`} title={p.photo ? "View photo" : "No photo"}
          className={"relative w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center ring-2 transition-shadow focus-visible:outline-none focus-visible:ring-blue-500 "
            + (p.type === "in" ? "ring-green-200 " : p.auto_closed ? "ring-amber-200 " : "ring-red-200 ")
            + (p.photo ? "hover:ring-blue-400 cursor-pointer" : "cursor-default")}>
          {p.photo
            ? <img src={p.photo} alt="" loading="lazy" className="w-full h-full object-cover" />
            : <span className="text-[10px] font-medium text-gray-500 -mt-3">{p.auto_closed ? "auto" : "—"}</span>}
          <span className={"absolute bottom-0 inset-x-0 text-[10px] font-semibold text-white text-center leading-tight py-0.5 tabular-nums "
            + (p.type === "in" ? "bg-green-600/90" : p.auto_closed ? "bg-amber-600/90" : "bg-red-600/90")}>
            {p.type === "in" ? "IN" : "OUT"} <time dateTime={p.at}>{fmtTime(p.at)}</time>
          </span>
        </button>
        {/* Admin-only edit + delete per punch entry — always visible (owner ask 2026-11-28:
            "delete har ek entry ke aage hoga"), stacked on top-right of the thumb. The red trash
            is the primary affordance; the pencil sits above it for a quick time/type correction. */}
        {isAdminUser && (
          <div className="absolute -top-2 -right-2 flex flex-col gap-1">
            <button type="button" onClick={() => openEdit(p)} aria-label="Edit this punch" title="Edit punch"
              className="w-6 h-6 rounded-full bg-white text-gray-700 ring-1 ring-gray-200 shadow-sm hover:text-gray-900 hover:bg-gray-100 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
            <button type="button" onClick={() => deletePunch(p)} aria-label="Delete this punch" title="Delete punch"
              className="w-6 h-6 rounded-full bg-white text-red-600 ring-1 ring-red-200 shadow-sm hover:text-red-700 hover:bg-red-50 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
            </button>
          </div>
        )}
      </div>
    );
  };

  const deptOptions = [
    { value: "all", label: myDepts ? (myDepts.length === 1 ? myDepts[0] : "My departments") : "All departments" },
    ...(myDepts ? LABOUR_DEPTS.filter((d) => myDepts.includes(d)) : LABOUR_DEPTS).map((d) => ({ value: d, label: `${DEPT_ICON[d] || ""} ${d}` })),
  ];
  const monthLabel = new Date(ym.y, ym.m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const prevLabel = view === "day" ? "Previous day" : "Previous month";
  const nextLabel = view === "day" ? "Next day" : "Next month";

  return (
    <section aria-label="Labour log" className="mt-3 rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm">
      {/* ── HEADER ── title + what's showing; the Day / Month switch and the date / month stepper. */}
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <IconUsers size={15} /> Labour Log
          </h3>
          <p className="mt-0.5 text-xs text-gray-500" aria-live="polite">
            {view === "day" ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Days present and hours per labour this month"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl bg-gray-100 p-1" role="group" aria-label="Range">
            {[["day", "Day"], ["month", "Month"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={"h-8 px-3.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 "
                  + (view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => (view === "day" ? shiftDay(-1) : shiftMonth(-1))} aria-label={prevLabel} title={prevLabel} className={navBtn}>
              <span className="rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
            </button>
            {view === "day"
              ? <DatePickerPopover value={date} max={today} onChange={setDate} />
              : <span className="px-2 text-sm font-semibold text-gray-900 whitespace-nowrap" aria-live="polite">{monthLabel}</span>}
            <button type="button" onClick={() => (view === "day" ? shiftDay(1) : shiftMonth(1))} disabled={atLatest} aria-label={nextLabel} title={nextLabel} className={navBtn}>
              <span className="-rotate-90" aria-hidden="true"><IconChevron size={16} /></span>
            </button>
            {!atLatest && (
              <button type="button" onClick={jumpToToday}
                className="h-10 sm:h-8 px-2.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">
                {view === "day" ? "Today" : "This month"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── FILTERS ── search + department side by side, the same pairing the Staff Log uses. */}
      <div className="border-t border-gray-100 px-5 py-4 flex gap-2">
        <div className="relative flex-1 min-w-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"><IconSearch size={15} /></span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labour…" aria-label="Search labour by name"
            className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500" />
        </div>
        <SelectPopover value={dept} onChange={setDept} options={deptOptions} />
      </div>

      {loading ? (
        <div className="border-t border-gray-100 py-12 flex items-center justify-center gap-2 text-sm text-gray-500" aria-live="polite">
          <Spinner /> Loading the labour log…
        </div>
      ) : error ? (
        <div className="border-t border-gray-100 py-10 text-center" role="alert">
          <p className="text-sm text-red-600">{error}</p>
          <button type="button" onClick={() => setReload((n) => n + 1)}
            className="mt-3 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            Try again
          </button>
        </div>
      ) : view === "day" ? (
        <>
          {/* ── DAY STATS ── each tile a toggle: click once to narrow the list to that cohort,
              click again (or click Present) to clear. Total hours stays non-filtering — it's a
              reading, not a cohort. Semantic dots match the rest of the attendance UI. */}
          <div className="mx-5 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl bg-gray-100 ring-1 ring-gray-100 overflow-hidden" role="group" aria-label="Narrow by cohort">
            {[
              { label: "Present",     value: dayStats.present,            dot: "bg-gray-400",   type: "all" },
              { label: "Still in",    value: dayStats.stillIn,            dot: "bg-emerald-500", type: "stillIn" },
              { label: "Not punched", value: notPunched.length,           dot: "bg-amber-500",  type: "notPunched" },
              { label: "Total hours", value: dayStats.hours.toFixed(1),   dot: "bg-blue-500",   type: null },
            ].map((s) => {
              const active = s.type != null && typeFilter === s.type;
              const clickable = s.type != null;
              const Tag = clickable ? "button" : "div";
              return (
                <Tag key={s.label} {...(clickable ? { type: "button", onClick: () => setTypeFilter((cur) => (cur === s.type ? "all" : s.type)), "aria-pressed": active } : {})}
                  className={"text-left px-4 py-2.5 min-w-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset "
                    + (active ? "bg-white shadow-[inset_0_-2px_0_rgba(37,99,235,0.6)]" : "bg-gray-50" + (clickable ? " hover:bg-white cursor-pointer" : ""))}>
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 truncate">
                    <span className={"w-1.5 h-1.5 rounded-full " + s.dot} aria-hidden="true" />{s.label}
                  </span>
                  <span className="block text-lg font-semibold text-gray-900 tabular-nums leading-tight">{s.value}</span>
                </Tag>
              );
            })}
          </div>

          {/* ── WHO PUNCHED ── list narrows to whichever cohort tile the admin picked. */}
          {typeFilter === "notPunched" ? (
            <div className="border-t border-gray-100">
              {notPunched.length === 0 ? (
                <EmptyState icon={<IconCalendar size={18} />} title="Everyone punched" hint="Nobody is missing from today's roster." />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {notPunched.map((l) => (
                    <li key={l.id} className="px-5 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{displayName(l.name)}</div>
                        <div className="mt-0.5 text-xs text-gray-500 truncate">{DEPT_ICON[l.department] || ""} {l.department}</div>
                      </div>
                      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-amber-50 ring-amber-200 text-amber-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />Not punched
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
          <div className="border-t border-gray-100">
            {(() => {
              const shownLabours = typeFilter === "stillIn"
                ? labours.filter((l) => l.punches[l.punches.length - 1]?.type === "in")
                : labours;
              if (shownLabours.length === 0) return (
                <EmptyState icon={<IconCalendar size={18} />}
                  title={filtered ? "No labour punches match that filter" : typeFilter === "stillIn" ? "Nobody is still in" : "No labour punches on this day"}
                  hint={filtered ? "Try another name or department." : typeFilter === "stillIn" ? "Everyone who punched in has also punched out." : "Punches made from the Labour Punch screen show up here."} />
              );
              return (
              <ul className="divide-y divide-gray-100">
                {shownLabours.map((l) => {
                  const last = l.punches[l.punches.length - 1];
                  const by = [...new Set(l.punches.map((p) => p.punched_by_name).filter(Boolean))];
                  return (
                    <li key={l.id} className="group/row px-5 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{displayName(l.name)}</div>
                          <div className="mt-0.5 text-xs text-gray-500 truncate">{DEPT_ICON[l.department] || ""} {l.department}{by.length ? ` · punched by ${by.join(", ")}` : ""}</div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {last?.type === "in" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-green-50 ring-green-200 text-green-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-600" aria-hidden="true" />Still in
                            </span>
                          ) : last?.auto_closed ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-amber-50 ring-amber-200 text-amber-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />Auto out
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-0.5 text-xs font-medium bg-gray-100 ring-gray-200 text-gray-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" aria-hidden="true" />Out
                            </span>
                          )}
                          <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmtHours(dayHours(l.punches))}</span>
                        </div>
                      </div>
                      {/* p-1 keeps the tiles' rings from being clipped by the scroller */}
                      <div className="flex gap-2 mt-2 -mx-1 p-1 overflow-x-auto">{l.punches.map(thumb)}</div>
                      <div className="mt-1.5 text-xs text-gray-500 truncate flex items-center gap-1"><span className="shrink-0" aria-hidden="true"><IconPin size={12} /></span> {punchLocationLabel(l.punches[0])}</div>
                    </li>
                  );
                })}
              </ul>
              );
            })()}
          </div>
          )}
        </>
      ) : monthRows.length === 0 ? (
        <div className="border-t border-gray-100">
          <EmptyState icon={<IconUsers size={18} />}
            title={filtered ? "No labours match that filter" : "No labours on the roster"}
            hint={filtered ? "Try another name or department." : "Labours added on the Labour Punch screen show up here."} />
        </div>
      ) : (
        <>
          {/* ── MONTH ── count + export, then one row per labour (tap to see each day's in / out). */}
          <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 min-w-0">
              <span className="tabular-nums">{monthRows.length}</span> labour{monthRows.length === 1 ? "" : "s"} · tap a name for in/out times
            </p>
            <button type="button" onClick={exportExcel} disabled={exporting}
              className="shrink-0 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-green-50 hover:ring-green-300 hover:text-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {exporting ? <Spinner /> : <IconExcelMark size={15} />} {exporting ? "Exporting…" : "Export to Excel"}
            </button>
          </div>
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th scope="col" className={thHead + " pl-5 pr-3"}>Labour</th>
                  <th scope="col" className={thHead + " pr-3 hidden sm:table-cell"}>Department</th>
                  <th scope="col" className={thHead + " pr-3 text-right"}>Days</th>
                  <th scope="col" className={thHead + " pr-3 text-right"}>Hours</th>
                  <th scope="col" className={thHead + " pr-5 text-right"} title="Days with no punch-out (left open or auto-closed)">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {monthRows.map((r) => {
                  const isOpen = openId === r.id;
                  const dates = Object.keys(r.byDate).sort();
                  const toggle = () => dates.length && setOpenId(isOpen ? null : r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={toggle}
                        className={"hover:bg-gray-50 transition-colors " + (dates.length ? "cursor-pointer " : "") + (isOpen ? "bg-gray-50" : "")}>
                        <td className="py-2.5 pl-5 pr-3">
                          {dates.length > 0 ? (
                            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-expanded={isOpen}
                              aria-label={`${r.name} — ${isOpen ? "hide" : "show"} day-by-day in/out`}
                              className="-ml-1 flex items-center gap-1.5 min-h-10 sm:min-h-0 rounded-md px-1 text-left font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                              <span className={"text-gray-400 transition-transform duration-200 " + (isOpen ? "" : "-rotate-90")} aria-hidden="true"><IconChevron size={14} /></span>
                              {r.name}
                            </button>
                          ) : (
                            <span className="pl-5 font-medium text-gray-500">{r.name}</span>
                          )}
                          <div className="sm:hidden pl-5 text-xs text-gray-500 truncate">{DEPT_ICON[r.department] || ""} {r.department}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600 hidden sm:table-cell whitespace-nowrap">{DEPT_ICON[r.department] || ""} {r.department}</td>
                        <td className={"py-2.5 pr-3 text-right tabular-nums " + (r.daysPresent ? "font-semibold text-gray-900" : "text-gray-500")}>{r.daysPresent}</td>
                        <td className={"py-2.5 pr-3 text-right tabular-nums whitespace-nowrap " + (r.hours > 0 ? "text-gray-800" : "text-gray-500")}>{fmtHours(r.hours)}</td>
                        <td className={"py-2.5 pr-5 text-right tabular-nums " + (r.openDays ? "text-amber-700 font-semibold" : "text-gray-500")}>{r.openDays || "—"}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="px-5 pt-1 pb-3">
                            <div className="rounded-xl bg-white ring-1 ring-gray-200/70 px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 text-xs">
                              <div className="font-medium text-gray-500">Day</div>
                              <div className="font-medium text-gray-500 text-right">In</div>
                              <div className="font-medium text-gray-500 text-right">Out</div>
                              <div className="font-medium text-gray-500 text-right">Hours</div>
                              {dates.map((date) => {
                                const d = daySummary(r.byDate[date]);
                                return (
                                  <Fragment key={date}>
                                    <time dateTime={date} className="text-gray-800 truncate">{fmtDay(date)}</time>
                                    <div className="text-right text-green-700 font-semibold tabular-nums whitespace-nowrap">{d.inAt ? <time dateTime={d.inAt}>{fmtTime(d.inAt)}</time> : "—"}</div>
                                    <div className={"text-right font-semibold tabular-nums whitespace-nowrap " + (d.open || d.auto ? "text-amber-700" : "text-red-600")}>
                                      {d.open ? "no out" : <><time dateTime={d.outAt}>{fmtTime(d.outAt)}</time>{d.auto ? " auto" : ""}</>}
                                    </div>
                                    <div className="text-right text-gray-800 tabular-nums">{fmtHours(d.hours)}</div>
                                  </Fragment>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold text-gray-900">
                  <td className="py-3 pl-5 pr-3"><span className="tabular-nums">{monthRows.length}</span> labour{monthRows.length === 1 ? "" : "s"}</td>
                  <td className="py-3 pr-3 hidden sm:table-cell" />
                  <td className="py-3 pr-3 text-right tabular-nums">{monthRows.reduce((s, r) => s + r.daysPresent, 0)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">{fmtHours(monthRows.reduce((s, r) => s + r.hours, 0))}</td>
                  <td className="py-3 pr-5 text-right tabular-nums">{monthRows.reduce((s, r) => s + r.openDays, 0) || "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={displayName(viewing?.labour_name) || "Punch photo"}>
        {viewing && (
          <div className="text-center">
            <img src={viewing.photo} alt={`${viewing.labour_name || "Labour"} — ${viewing.type === "in" ? "punch-in" : "punch-out"} photo`} className="w-full rounded-xl mb-3" />
            <p className="text-sm text-gray-700">
              {viewing.type === "in" ? "Punched in" : "Punched out"} at <time dateTime={viewing.at} className="font-semibold text-gray-900 tabular-nums">{fmtTime(viewing.at)}</time> · {viewing.department}
            </p>
            <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1"><span className="shrink-0" aria-hidden="true"><IconPin size={12} /></span> {punchLocationLabel(viewing)}</p>
            {viewing.punched_by_name && <p className="text-xs text-gray-500 mt-1">Punched by {viewing.punched_by_name}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => (editBusy ? null : setEditing(null))} title={editing ? `Edit ${displayName(editing.labour_name) || "punch"}` : ""}>
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
              <label htmlFor="edit-labour-time" className="block text-xs font-semibold text-gray-700 mb-1.5">Time (24-hour)</label>
              <input id="edit-labour-time" type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
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

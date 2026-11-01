import { Fragment, useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import { todayStr, dayHours, daySummary, punchLocationLabel } from "../../lib/ims/attendance";
import { loadExcelJS, downloadWorkbook, styleHeader } from "../../lib/excel";
import { LABOUR_DEPTS, DEPT_ICON, fetchLabourPunchesRange, fetchAllActiveLabours } from "../../lib/ims/labourAttendance";
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

export default function LabourAdminLog() {
  const today = todayStr();
  const [view, setView] = useState("day");   // "day" | "month"
  const [date, setDate] = useState(today);
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 }));
  const [dept, setDept] = useState("all");
  const [search, setSearch] = useState("");
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
  const keep = (name, d) => (dept === "all" || d === dept) && (!term || (name || "").toLowerCase().includes(term));
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
      openDays: days.filter((ps) => ps[ps.length - 1]?.type === "in" || ps.some((p) => p.auto_closed)).length,
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
      <button key={p.id} type="button" onClick={() => p.photo && setViewing(p)} disabled={!p.photo}
        aria-label={`${kind} at ${fmtTime(p.at)}${p.photo ? " — view photo" : " — no photo"}`} title={p.photo ? "View photo" : "No photo"}
        className={"relative w-14 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center ring-2 transition-shadow focus-visible:outline-none focus-visible:ring-blue-500 "
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
    );
  };

  const deptOptions = [{ value: "all", label: "All departments" }, ...LABOUR_DEPTS.map((d) => ({ value: d, label: `${DEPT_ICON[d] || ""} ${d}` }))];
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
          {/* ── DAY STATS ── (gap-px over a grey fill draws the dividers in both the 2×2 phone and 1×4 desktop layouts) */}
          <dl className="mx-5 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl bg-gray-100 ring-1 ring-gray-100 overflow-hidden">
            {[["Present", dayStats.present], ["Still in", dayStats.stillIn], ["Not punched", notPunched.length], ["Total hours", dayStats.hours.toFixed(1)]].map(([k, v]) => (
              <div key={k} className="bg-gray-50 px-4 py-2.5 min-w-0">
                <dt className="text-xs text-gray-500 truncate">{k}</dt>
                <dd className="text-lg font-semibold text-gray-900 tabular-nums leading-tight">{v}</dd>
              </div>
            ))}
          </dl>

          {/* ── WHO PUNCHED ── */}
          <div className="border-t border-gray-100">
            {labours.length === 0 ? (
              <EmptyState icon={<IconCalendar size={18} />}
                title={filtered ? "No labour punches match that filter" : "No labour punches on this day"}
                hint={filtered ? "Try another name or department." : "Punches made from the Labour Punch screen show up here."} />
            ) : (
              <ul className="divide-y divide-gray-100">
                {labours.map((l) => {
                  const last = l.punches[l.punches.length - 1];
                  const by = [...new Set(l.punches.map((p) => p.punched_by_name).filter(Boolean))];
                  return (
                    <li key={l.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{l.name}</div>
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
            )}
          </div>

          {/* ── NOT PUNCHED ── roster labours (of the filtered set) with no punch this day. */}
          {notPunched.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
                Not punched
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{notPunched.length}</span>
              </h4>
              <ul className="flex flex-wrap gap-1.5">
                {notPunched.map((l) => (
                  <li key={l.id} className="text-xs text-gray-700 bg-gray-50 ring-1 ring-gray-200 rounded-full px-2.5 py-1">{l.name} <span className="text-gray-500">· {l.department}</span></li>
                ))}
              </ul>
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

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.labour_name || "Punch photo"}>
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
    </section>
  );
}

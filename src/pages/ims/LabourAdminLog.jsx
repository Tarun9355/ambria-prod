import { Fragment, useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import { todayStr, dayHours, daySummary, punchLocationLabel } from "../../lib/ims/attendance";
import { loadExcelJS, downloadWorkbook, styleHeader } from "../../lib/excel";
import { LABOUR_DEPTS, DEPT_ICON, fetchLabourPunchesRange, fetchAllActiveLabours } from "../../lib/ims/labourAttendance";
import { DatePickerPopover, SelectPopover } from "./AttendanceAdminLog.jsx";
import { IconPin, IconCalendar, IconUsers, IconExcelMark } from "../../components/icons.jsx";

// ═══ ADMIN: LABOUR LOG ═══ (Attendance → Labour Log)
// Everything the Labour Punch screen records, across every department, for Admin:
//   Day   — one card per labour: each punch's photo (tap to enlarge), time, place and who punched
//           them, hours worked, plus the roster's labours who never punched that day.
//   Month — per labour: days present, hours, and days left open (no punch-out).
// Hours use the same in→out pairing as staff attendance (dayHours) — an unmatched 'in' adds nothing.

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const fmtHours = (h) => (h > 0 ? `${h.toFixed(1)}h` : "—");
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDay = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
// Full literal class strings (not assembled) so Tailwind's build can see every one.
const STAT_STYLES = {
  green: { box: "bg-green-50", label: "text-green-700" },
  blue: { box: "bg-blue-50", label: "text-blue-700" },
  amber: { box: "bg-amber-50", label: "text-amber-700" },
  gray: { box: "bg-gray-50", label: "text-gray-500" },
};

function Stat({ tone, label, value }) {
  return (
    <div className={"rounded-xl px-3 py-2 " + STAT_STYLES[tone].box}>
      <div className={"text-[10px] font-semibold uppercase tracking-wide " + STAT_STYLES[tone].label}>{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
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
    // eslint-disable-next-line -- keyed on the range strings
  }, [range[0], range[1]]);

  const term = search.trim().toLowerCase();
  const keep = (name, d) => (dept === "all" || d === dept) && (!term || (name || "").toLowerCase().includes(term));

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

  const thumb = (p) => (
    <button key={p.id} onClick={() => p.photo && setViewing(p)} title={p.photo ? "View photo" : "No photo"}
      className={"relative w-12 h-12 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center ring-2 "
        + (p.type === "in" ? "ring-green-200" : p.auto_closed ? "ring-amber-200" : "ring-red-200")
        + (p.photo ? " hover:ring-blue-400 cursor-pointer transition" : " cursor-default")}>
      {p.photo ? <img src={p.photo} alt="" loading="lazy" className="w-full h-full object-cover" /> : <span className="text-gray-300 text-[10px]">{p.auto_closed ? "auto" : "—"}</span>}
      <span className={"absolute bottom-0 inset-x-0 text-[9px] font-bold text-white text-center leading-tight py-0.5 "
        + (p.type === "in" ? "bg-green-600/85" : p.auto_closed ? "bg-amber-500/85" : "bg-red-500/85")}>
        {p.type === "in" ? "IN" : "OUT"} {fmtTime(p.at)}
      </span>
    </button>
  );

  return (
    <div className="mt-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><IconUsers size={18} /> Labour Log</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-xl p-1">
            {[["day", "Day"], ["month", "Month"]].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)}
                className={"px-3 py-1 rounded-lg text-xs font-semibold transition " + (view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-gray-50 rounded-xl ring-1 ring-gray-100 p-1">
            <button onClick={() => (view === "day" ? shiftDay(-1) : shiftMonth(-1))} title="Previous"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition text-lg leading-none">‹</button>
            {view === "day"
              ? <DatePickerPopover value={date} max={today} onChange={setDate} />
              : <span className="text-sm font-semibold text-gray-700 px-2">{new Date(ym.y, ym.m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>}
            <button onClick={() => (view === "day" ? shiftDay(1) : shiftMonth(1))} disabled={view === "day" ? date >= today : isCurMonth} title="Next"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">›</button>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        {view === "day" ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Days present and hours per labour this month"}
      </p>

      {/* Search + department side by side, the same pairing the Staff Log uses. */}
      <div className="flex gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labour…"
          className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        <SelectPopover value={dept} onChange={setDept}
          options={[{ value: "all", label: "All departments" }, ...LABOUR_DEPTS.map((d) => ({ value: d, label: `${DEPT_ICON[d] || ""} ${d}` }))]} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-10">{error}</p>
      ) : view === "day" ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <Stat tone="green" label="Present" value={dayStats.present} />
            <Stat tone="blue" label="Still in" value={dayStats.stillIn} />
            <Stat tone="amber" label="Not punched" value={notPunched.length} />
            <Stat tone="gray" label="Total hours" value={dayStats.hours.toFixed(1)} />
          </div>
          {labours.length === 0 ? (
            <div className="text-center py-8">
              <div className="flex justify-center mb-2 text-gray-300"><IconCalendar size={26} /></div>
              <p className="text-sm text-gray-400">No labour punches {term || dept !== "all" ? "match that filter" : "on this day"}.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {labours.map((l) => {
                const last = l.punches[l.punches.length - 1];
                const by = [...new Set(l.punches.map((p) => p.punched_by_name).filter(Boolean))];
                return (
                  <div key={l.id} className="rounded-xl ring-1 ring-gray-100 p-3 hover:bg-gray-50 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{l.name}</div>
                        <div className="text-xs text-gray-400 truncate">{DEPT_ICON[l.department] || ""} {l.department}{by.length ? ` · punched by ${by.join(", ")}` : ""}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={"text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-block "
                          + (last?.type === "in" ? "bg-green-100 text-green-700" : last?.auto_closed ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>
                          {last?.type === "in" ? "Still in" : last?.auto_closed ? "Auto out" : "Out"}
                        </div>
                        <div className="text-sm font-bold text-gray-800 mt-0.5">{fmtHours(dayHours(l.punches))}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2 overflow-x-auto pb-1">{l.punches.map(thumb)}</div>
                    <div className="text-xs text-gray-400 mt-1 truncate flex items-center gap-1"><IconPin size={11} /> {punchLocationLabel(l.punches[0])}</div>
                  </div>
                );
              })}
            </div>
          )}
          {notPunched.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Not punched</span>
                <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{notPunched.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {notPunched.map((l) => (
                  <span key={l.id} className="text-xs text-gray-500 bg-gray-50 ring-1 ring-gray-100 rounded-full px-2.5 py-1">{l.name} · {l.department}</span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : monthRows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No labours {term || dept !== "all" ? "match that filter" : "on the roster"}.</p>
      ) : (
        <>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs text-gray-400">{monthRows.length} labour{monthRows.length === 1 ? "" : "s"} · tap a name for in/out times</p>
          <button onClick={exportExcel} disabled={exporting}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-white ring-1 ring-gray-200 hover:ring-green-400 hover:text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
            <IconExcelMark size={15} /> {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 pr-3">Labour</th>
                <th className="py-2 pr-3">Department</th>
                <th className="py-2 pr-3 text-right">Days</th>
                <th className="py-2 pr-3 text-right">Hours</th>
                <th className="py-2 text-right" title="Days with no punch-out (left open or auto-closed)">Open</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => {
                const isOpen = openId === r.id;
                const dates = Object.keys(r.byDate).sort();
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => dates.length && setOpenId(isOpen ? null : r.id)}
                      className={"border-b border-gray-50 hover:bg-gray-50 " + (r.daysPresent ? "cursor-pointer" : "text-gray-400")}>
                      <td className={"py-2 pr-3 font-semibold " + (r.daysPresent ? "text-gray-800" : "")}>
                        {dates.length > 0 && <span className={"inline-block w-3 text-gray-400 text-[10px] transition-transform " + (isOpen ? "rotate-90" : "")}>▸</span>}
                        {r.name}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{DEPT_ICON[r.department] || ""} {r.department}</td>
                      <td className={"py-2 pr-3 text-right font-semibold " + (r.daysPresent ? "text-gray-800" : "")}>{r.daysPresent}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{fmtHours(r.hours)}</td>
                      <td className={"py-2 text-right " + (r.openDays ? "text-amber-600 font-semibold" : "text-gray-300")}>{r.openDays || "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1 text-xs">
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px]">Day</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">In</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">Out</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">Hours</div>
                            {dates.map((date) => {
                              const d = daySummary(r.byDate[date]);
                              return (
                                <Fragment key={date}>
                                  <div className="text-gray-700">{fmtDay(date)}</div>
                                  <div className="text-right text-green-700 font-semibold tabular-nums">{d.inAt ? fmtTime(d.inAt) : "—"}</div>
                                  <div className={"text-right font-semibold tabular-nums " + (d.open || d.auto ? "text-amber-600" : "text-red-600")}>
                                    {d.open ? "no out" : `${fmtTime(d.outAt)}${d.auto ? " auto" : ""}`}
                                  </div>
                                  <div className="text-right text-gray-700 tabular-nums">{fmtHours(d.hours)}</div>
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
              <tr className="text-gray-900 font-bold">
                <td className="pt-3 pr-3" colSpan={2}>{monthRows.length} labour{monthRows.length === 1 ? "" : "s"}</td>
                <td className="pt-3 pr-3 text-right">{monthRows.reduce((s, r) => s + r.daysPresent, 0)}</td>
                <td className="pt-3 pr-3 text-right">{fmtHours(monthRows.reduce((s, r) => s + r.hours, 0))}</td>
                <td className="pt-3 text-right">{monthRows.reduce((s, r) => s + r.openDays, 0) || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.labour_name || "Punch photo"}>
        {viewing && (
          <div className="text-center">
            <img src={viewing.photo} alt="" className="w-full rounded-xl mb-3" />
            <p className="text-sm text-gray-600">{viewing.type === "in" ? "Punched in" : "Punched out"} at {fmtTime(viewing.at)} · {viewing.department}</p>
            <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1"><IconPin size={11} /> {punchLocationLabel(viewing)}</p>
            {viewing.punched_by_name && <p className="text-xs text-gray-400 mt-1">Punched by {viewing.punched_by_name}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

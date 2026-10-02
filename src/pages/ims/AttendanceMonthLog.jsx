import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchRangePunches, dayHours, daySummary, punchLocationLabel, punchLabel } from "../../lib/ims/attendance";
import { loadExcelJS, downloadWorkbook, styleHeader } from "../../lib/excel";
import { IconExcelMark } from "../../components/icons.jsx";

// ═══ ADMIN: STAFF ATTENDANCE — MONTH ═══ (Attendance → Staff Log → Month)
// One row per staff member for the month: days present, hours, and days left open (no punch-out
// or auto-closed). Every active user is listed, punched or not, so the month reads as a complete
// roster for payroll rather than only the people who showed up. "Export to Excel" writes what is
// on screen (same search + department filter) as three sheets: Summary, a day-by-day Daily grid,
// and every Punch with its photo link.

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const fmtHours = (h) => (h > 0 ? `${h.toFixed(1)}h` : "—");
const round1 = (h) => Math.round(h * 10) / 10;
const fmtDay = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function AttendanceMonthLog({ users, ym, search, dept, deptByUserId, isAdminByUserId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [openId, setOpenId] = useState(null);   // staff row expanded to its day-by-day in/out times
  const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
  const from = `${ym.y}-${pad2(ym.m)}-01`;
  const to = `${ym.y}-${pad2(ym.m)}-${pad2(daysInMonth)}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchRangePunches(from, to)
      // fetchRangePunches is newest-first (the day log wants that); hours pairing needs oldest-first.
      .then((data) => { if (active) { setRows([...data].sort((a, b) => new Date(a.at) - new Date(b.at))); setError(""); } })
      .catch((e) => { if (active) setError(e.message || "Couldn't load attendance"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const deptLabel = (id) => (isAdminByUserId[id] ? "Admin" : (deptByUserId[id] || []).join(", ") || "Unassigned");

  const staff = useMemo(() => {
    const byUser = new Map();
    // Every active user first, so a zero-day month still shows them.
    (users || []).filter((u) => u.active !== false).forEach((u) => byUser.set(u.id, { id: u.id, name: u.name || u.username || "—", punches: [] }));
    rows.forEach((p) => {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, { id: p.user_id, name: p.user_name || "—", punches: [] });
      byUser.get(p.user_id).punches.push(p);
    });
    return [...byUser.values()].map((u) => {
      const byDate = {};
      u.punches.forEach((p) => { (byDate[p.date] ||= []).push(p); });
      const days = Object.values(byDate);
      return {
        ...u,
        byDate,
        daysPresent: days.filter((ps) => ps.some((p) => p.type === "in")).length,
        hours: days.reduce((s, ps) => s + dayHours(ps), 0),
        openDays: days.filter((ps) => ps[ps.length - 1]?.type === "in" || ps.some((p) => p.auto_closed)).length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [users, rows]);

  const term = search.trim().toLowerCase();
  const shown = staff.filter((u) => {
    if (term && !u.name.toLowerCase().includes(term)) return false;
    if (dept === "all") return true;
    if (dept === "Admin") return !!isAdminByUserId[u.id];
    return (deptByUserId[u.id] || []).includes(dept);
  });

  async function exportExcel() {
    setExporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = "Ambria IMS";

      // 1 — Summary
      const s1 = wb.addWorksheet("Summary");
      s1.columns = [
        { header: "Name", key: "name", width: 26 },
        { header: "Department", key: "dept", width: 20 },
        { header: "Days present", key: "days", width: 14 },
        { header: "Total hours", key: "hours", width: 13 },
        { header: "Days without punch-out", key: "open", width: 22 },
      ];
      shown.forEach((u) => s1.addRow({ name: u.name, dept: deptLabel(u.id), days: u.daysPresent, hours: round1(u.hours), open: u.openDays }));
      const tot = s1.addRow({ name: `Total (${shown.length})`, days: shown.reduce((s, u) => s + u.daysPresent, 0), hours: round1(shown.reduce((s, u) => s + u.hours, 0)), open: shown.reduce((s, u) => s + u.openDays, 0) });
      tot.font = { bold: true };
      styleHeader(s1);

      // 2 — Daily grid: each day's "in–out · hours" ("in–… no out" while open, "(auto)" when the
      // 18h auto-close ended it); blank = absent.
      const s2 = wb.addWorksheet("Daily");
      const dayCols = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(ym.y, ym.m - 1, i + 1);
        return { key: `${ym.y}-${pad2(ym.m)}-${pad2(i + 1)}`, header: d.toLocaleDateString("en-IN", { day: "numeric", weekday: "short" }), width: 24 };
      });
      s2.columns = [{ header: "Name", key: "name", width: 26 }, { header: "Department", key: "dept", width: 18 }, ...dayCols, { header: "Total h", key: "total", width: 10 }];
      shown.forEach((u) => {
        const r = { name: u.name, dept: deptLabel(u.id), total: round1(u.hours) };
        dayCols.forEach(({ key }) => {
          const ps = u.byDate[key];
          if (!ps?.length) return;
          const d = daySummary(ps);
          r[key] = d.open
            ? `${fmtTime(d.inAt)}–… (no out)`
            : `${fmtTime(d.inAt)}–${fmtTime(d.outAt)}${d.auto ? " (auto)" : ""} · ${round1(d.hours)}h`;
        });
        s2.addRow(r);
      });
      styleHeader(s2);
      s2.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

      // 2b — Day-wise: one row per person per day worked, with punch-in / punch-out times.
      const s2b = wb.addWorksheet("Day-wise");
      s2b.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Name", key: "name", width: 24 },
        { header: "Department", key: "dept", width: 18 },
        { header: "Punch in", key: "in", width: 11 },
        { header: "Punch out", key: "out", width: 11 },
        { header: "Hours", key: "hours", width: 8 },
        { header: "Note", key: "note", width: 20 },
      ];
      Object.keys(Object.assign({}, ...shown.map((u) => u.byDate))).sort().forEach((date) => {
        shown.forEach((u) => {
          const ps = u.byDate[date];
          if (!ps?.length) return;
          const d = daySummary(ps);
          s2b.addRow({ date, name: u.name, dept: deptLabel(u.id), in: fmtTime(d.inAt), out: d.outAt ? fmtTime(d.outAt) : "", hours: round1(d.hours), note: d.open ? "No punch-out" : d.auto ? "Auto punched out" : "" });
        });
      });
      styleHeader(s2b);

      // 3 — Every punch
      const s3 = wb.addWorksheet("Punches");
      s3.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Name", key: "name", width: 24 },
        { header: "Department", key: "dept", width: 18 },
        { header: "Punch", key: "type", width: 16 },
        { header: "Time", key: "time", width: 10 },
        { header: "Location", key: "loc", width: 28 },
        { header: "Photo", key: "photo", width: 14 },
      ];
      const ids = new Set(shown.map((u) => u.id));
      rows.filter((p) => ids.has(p.user_id)).forEach((p) => {
        const r = s3.addRow({ date: p.date, name: p.user_name || "—", dept: deptLabel(p.user_id), type: punchLabel(p), time: fmtTime(p.at), loc: punchLocationLabel(p) });
        if (p.photo) { const c = r.getCell("photo"); c.value = { text: "View photo", hyperlink: p.photo }; c.font = { color: { argb: "FF2563EB" }, underline: true }; }
      });
      styleHeader(s3);

      const deptPart = dept === "all" ? "" : `_${dept.replace(/[^a-zA-Z0-9]+/g, "_")}`;
      await downloadWorkbook(wb, `Ambria_Staff_Attendance_${ym.y}-${pad2(ym.m)}${deptPart}.xlsx`);
    } catch (e) {
      setError(e.message || "Couldn't export");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">Loading…</p>;
  if (error) return <p className="text-sm text-red-600 text-center py-10">{error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-gray-400">{shown.length} staff · {rows.length} punch{rows.length === 1 ? "" : "es"} this month · tap a name for in/out times</p>
        <button onClick={exportExcel} disabled={exporting || shown.length === 0}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-white ring-1 ring-gray-200 hover:ring-green-400 hover:text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
          <IconExcelMark size={15} /> {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No staff match that filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Department</th>
                <th className="py-2 pr-3 text-right">Days</th>
                <th className="py-2 pr-3 text-right">Hours</th>
                <th className="py-2 text-right" title="Days with no punch-out (left open or auto-closed)">Open</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const open = openId === u.id;
                const dates = Object.keys(u.byDate).sort();
                return (
                  <Fragment key={u.id}>
                    <tr onClick={() => dates.length && setOpenId(open ? null : u.id)}
                      className={"border-b border-gray-50 hover:bg-gray-50 " + (u.daysPresent ? "cursor-pointer" : "text-gray-400")}>
                      <td className={"py-2 pr-3 font-semibold " + (u.daysPresent ? "text-gray-800" : "")}>
                        {dates.length > 0 && <span className={"inline-block w-3 text-gray-400 text-[10px] transition-transform " + (open ? "rotate-90" : "")}>▸</span>}
                        {u.name}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{deptLabel(u.id)}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{u.daysPresent}</td>
                      <td className="py-2 pr-3 text-right">{fmtHours(u.hours)}</td>
                      <td className={"py-2 text-right " + (u.openDays ? "text-amber-600 font-semibold" : "text-gray-300")}>{u.openDays || "—"}</td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1 text-xs">
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px]">Day</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">In</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">Out</div>
                            <div className="font-bold text-gray-400 uppercase tracking-wide text-[10px] text-right">Hours</div>
                            {dates.map((date) => {
                              const d = daySummary(u.byDate[date]);
                              return (
                                <Fragment key={date}>
                                  <div className="text-gray-700">{fmtDay(date)}</div>
                                  <div className="text-right text-green-700 font-semibold tabular-nums">{fmtTime(d.inAt) || "—"}</div>
                                  <div className={"text-right font-semibold tabular-nums " + (d.open ? "text-amber-600" : d.auto ? "text-amber-600" : "text-red-600")}>
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
                <td className="pt-3 pr-3" colSpan={2}>{shown.length} staff</td>
                <td className="pt-3 pr-3 text-right">{shown.reduce((s, u) => s + u.daysPresent, 0)}</td>
                <td className="pt-3 pr-3 text-right">{fmtHours(shown.reduce((s, u) => s + u.hours, 0))}</td>
                <td className="pt-3 text-right">{shown.reduce((s, u) => s + u.openDays, 0) || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

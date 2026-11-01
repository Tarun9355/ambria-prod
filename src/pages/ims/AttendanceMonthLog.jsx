import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchRangePunches, dayHours, daySummary, punchLocationLabel, punchLabel } from "../../lib/ims/attendance";
import { loadExcelJS, downloadWorkbook, styleHeader } from "../../lib/excel";
import { IconExcelMark, IconChevron, IconUsers, IconX } from "../../components/icons.jsx";

// ═══ ADMIN: STAFF ATTENDANCE — MONTH ═══ (Attendance → Staff Log → Month)
// One row per staff member for the month: days present, hours, and days left open (no punch-out
// or auto-closed). Every active user is listed, punched or not, so the month reads as a complete
// roster for payroll rather than only the people who showed up. "Export to Excel" writes what is
// on screen (same search + department filter) as three sheets: Summary, a day-by-day Daily grid,
// and every Punch with its photo link.
//
// Rendered inside AttendanceAdminLog's card body (that card owns the month stepper, search and
// department filter), so this draws no card of its own: a totals strip, the export action, then
// the staff table. On phones the Department column folds under each name so the table fits.

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const fmtHours = (h) => (h > 0 ? `${h.toFixed(1)}h` : "—");
const round1 = (h) => Math.round(h * 10) / 10;
const fmtDay = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function AttendanceMonthLog({ users, ym, search, dept, deptByUserId, isAdminByUserId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);         // bumped by "Try again" after a failed load
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(""); // shown beside the button; the table stays up
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
  }, [from, to, reload]);

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
    setExportError("");
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
      setExportError(e.message || "Couldn't export");
    } finally {
      setExporting(false);
    }
  }


  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading the month">
        <div className="mx-5 mt-4 h-16 rounded-xl bg-gray-50 ring-1 ring-gray-100 motion-safe:animate-pulse" />
        <ul className="mt-4 border-t border-gray-100 divide-y divide-gray-100">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="h-3 w-40 max-w-full rounded bg-gray-100 motion-safe:animate-pulse" />
              <div className="h-3 w-20 rounded bg-gray-100 motion-safe:animate-pulse" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-5 py-10 text-center" role="alert">
        <p className="text-sm text-red-600">{error}</p>
        <button type="button" onClick={() => setReload((n) => n + 1)}
          className="mt-3 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Try again</button>
      </div>
    );
  }

  const totDays = shown.reduce((s, u) => s + u.daysPresent, 0);
  const totHours = shown.reduce((s, u) => s + u.hours, 0);
  const totOpen = shown.reduce((s, u) => s + u.openDays, 0);
  const th = "py-2.5 text-xs font-medium text-gray-500";

  return (
    <div className="pb-2">
      {/* Month totals over what's shown (same search + department filter as the table). */}
      <dl className="mx-5 mt-4 grid grid-cols-3 rounded-xl bg-gray-50 ring-1 ring-gray-100 divide-x divide-gray-100">
        {[["Days present", totDays], ["Hours", round1(totHours).toFixed(1)], ["No punch-out", totOpen]].map(([k, v]) => (
          <div key={k} className="px-3 py-2.5 min-w-0">
            <dt className="text-xs text-gray-500 truncate">{k}</dt>
            <dd className="text-lg font-semibold text-gray-900 tabular-nums leading-tight">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 mt-4 mb-3">
        <p className="text-xs text-gray-500 tabular-nums">
          {shown.length} staff · {rows.length} punch{rows.length === 1 ? "" : "es"} this month
          {shown.some((u) => u.daysPresent) && <span className="hidden sm:inline"> · select a name for in/out times</span>}
        </p>
        <button type="button" onClick={exportExcel} disabled={exporting || shown.length === 0}
          className="shrink-0 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-white ring-1 ring-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {exporting
            ? <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" />
            : <IconExcelMark size={15} />}
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>
      {exportError && <p className="px-5 -mt-1 mb-3 text-xs text-red-600" role="alert">{exportError}</p>}

      {shown.length === 0 ? (
        <div className="px-5 py-12 text-center border-t border-gray-100">
          <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center"><IconUsers size={18} /></div>
          <p className="mt-3 text-sm font-medium text-gray-700">No staff match that filter</p>
          <p className="mt-1 text-xs text-gray-500">Try another name or department.</p>
        </div>
      ) : (
        // Scrolls inside the card, never the page, if a long name or department ever outgrows it.
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 border-y border-gray-100">
                <th scope="col" className={th + " pl-5 pr-3"}>Name</th>
                <th scope="col" className={th + " pr-3 hidden sm:table-cell"}>Department</th>
                <th scope="col" className={th + " pr-3 text-right"}>Days</th>
                <th scope="col" className={th + " pr-3 text-right"}>Hours</th>
                <th scope="col" className={th + " pr-5 text-right"} title="Days with no punch-out (left open or auto-closed)">Open</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const open = openId === u.id;
                const dates = Object.keys(u.byDate).sort();
                const toggle = () => dates.length && setOpenId(open ? null : u.id);
                return (
                  <Fragment key={u.id}>
                    {/* The whole row toggles on click; the name is a real button so it also works from the keyboard. */}
                    <tr onClick={toggle}
                      className={"border-t border-gray-100 first:border-t-0 transition-colors " + (dates.length ? "cursor-pointer hover:bg-gray-50 " : "") + (open ? "bg-gray-50" : "")}>
                      <td className="py-3 pl-5 pr-3">
                        {dates.length > 0 ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-expanded={open} aria-controls={`att-month-${u.id}`}
                            className="inline-flex items-center gap-1.5 -ml-1 px-1 rounded-md text-left font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                            <span className={"shrink-0 text-gray-500 transition-transform duration-200 " + (open ? "" : "-rotate-90")} aria-hidden="true"><IconChevron size={14} /></span>
                            {u.name}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-500"><span className="w-3.5 shrink-0" aria-hidden="true" />{u.name}</span>
                        )}
                        <div className="sm:hidden pl-5 text-xs text-gray-500">{deptLabel(u.id)}</div>
                      </td>
                      <td className="py-3 pr-3 text-gray-600 hidden sm:table-cell">{deptLabel(u.id)}</td>
                      <td className={"py-3 pr-3 text-right tabular-nums " + (u.daysPresent ? "font-semibold text-gray-900" : "text-gray-500")}>{u.daysPresent}</td>
                      <td className={"py-3 pr-3 text-right tabular-nums " + (u.hours > 0 ? "text-gray-700" : "text-gray-500")}>{fmtHours(u.hours)}</td>
                      <td className="py-3 pr-5 text-right tabular-nums">
                        {u.openDays
                          ? <span className="inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-xs font-semibold bg-amber-50 ring-amber-200 text-amber-800">{u.openDays}</span>
                          : <span className="text-gray-500">—</span>}
                      </td>
                    </tr>
                    {open && (
                      <tr id={`att-month-${u.id}`} className="bg-gray-50">
                        <td colSpan={5} className="px-5 pb-3">
                          <div className="rounded-xl bg-white ring-1 ring-gray-200/70 px-3.5 py-2.5">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 sm:gap-x-6 text-xs">
                              <div className="pb-1.5 font-medium text-gray-500">Day</div>
                              <div className="pb-1.5 font-medium text-gray-500 text-right">In</div>
                              <div className="pb-1.5 font-medium text-gray-500 text-right">Out</div>
                              <div className="pb-1.5 font-medium text-gray-500 text-right">Hours</div>
                              {dates.map((date) => {
                                const d = daySummary(u.byDate[date]);
                                const cell = "py-1.5 border-t border-gray-100 tabular-nums";
                                return (
                                  <Fragment key={date}>
                                    <time dateTime={date} className={cell + " text-gray-800"}>{fmtDay(date)}</time>
                                    <div className={cell + " text-right font-medium text-green-700"}>
                                      {d.inAt ? <time dateTime={d.inAt}>{fmtTime(d.inAt)}</time> : "—"}
                                    </div>
                                    <div className={cell + " text-right font-medium " + (d.open || d.auto ? "text-amber-700" : "text-gray-800")}>
                                      {d.open ? "no out" : <><time dateTime={d.outAt}>{fmtTime(d.outAt)}</time>{d.auto ? " auto" : ""}</>}
                                    </div>
                                    <div className={cell + " text-right text-gray-700"}>{fmtHours(d.hours)}</div>
                                  </Fragment>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900 tabular-nums">
                <td className="py-3 pl-5 pr-3">{shown.length} staff</td>
                <td className="py-3 pr-3 hidden sm:table-cell" />
                <td className="py-3 pr-3 text-right">{totDays}</td>
                <td className="py-3 pr-3 text-right">{fmtHours(totHours)}</td>
                <td className="py-3 pr-5 text-right">{totOpen || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

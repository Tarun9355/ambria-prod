import { useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import { fetchAllActiveLabours, insertLabour, newLabourId, DEPT_ICON } from "../../lib/ims/labourAttendance";
import { parseCsv, planLabourImport } from "../../lib/ims/staffImport";

// ═══ Import labours from a contact sheet (Attendance → Labour Punch, Admin) ═══
// Owner ask 2026-11-28: the vendor / labour sheet (Category, Sub_Category, S_No, Name, Mobile, Email) onto the labour roster,
// each person on the list of their sub-category's department (both lists for "tenting , structure"). Labours never log in -
// whoever has punch access for that department punches them. The plan (who goes where, who is skipped and why) is
// lib/ims/staffImport.js planLabourImport; this screen previews it and adds the rows one by one, like Labour Punch's own Add.
export default function LabourImportModal({ open, onClose, authUser, onDone }) {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const chosen = useMemo(() => (plan || []).filter((r) => r.status === "new" && r.on), [plan]);
  const skipped = useMemo(() => (plan || []).filter((r) => r.status === "skip"), [plan]);
  const byDept = useMemo(() => {
    const m = {};
    chosen.forEach((r) => { m[r.department] = (m[r.department] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [chosen]);

  const reset = () => { setFileName(""); setPlan(null); setReadError(""); setResults(null); setProgress(0); };
  const close = () => { if (running) return; const did = results && results.some((r) => r.ok); reset(); onClose(); if (did) onDone?.(); };

  const readFile = (file) => {
    if (!file) return;
    setReadError(""); setResults(null); setReading(true);
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const rows = parseCsv(String(fr.result || ""));
        if (!rows.length) { setReadError("The file has no rows."); setPlan(null); return; }
        if (!Object.keys(rows[0]).some((h) => h.trim().toLowerCase() === "name")) { setReadError('No "Name" column found - the first row must be the headings (Category, Sub_Category, Name, Mobile).'); setPlan(null); return; }
        // the roster as it stands, so nobody already on a department's list is added again
        const existing = await fetchAllActiveLabours();
        setFileName(file.name);
        setPlan(planLabourImport(rows, existing).map((r, i) => ({ ...r, key: `${r.line}-${r.department}-${i}`, on: r.status === "new" })));
      } catch (e) { setReadError("Couldn't read this file: " + (e?.message || e)); }
      finally { setReading(false); }
    };
    fr.onerror = () => { setReadError("Couldn't read this file."); setReading(false); };
    fr.readAsText(file, "utf-8");
  };

  const toggle = (key) => setPlan((p) => p.map((r) => (r.key === key ? { ...r, on: !r.on } : r)));
  const setAll = (on) => setPlan((p) => p.map((r) => (r.status === "new" ? { ...r, on } : r)));

  const run = async () => {
    if (!chosen.length || running) return;
    setRunning(true); setProgress(0);
    const out = [];
    for (const r of chosen) {
      try {
        await insertLabour({ id: newLabourId(), name: r.name, phone: r.phone || null, department: r.department, active: true, created_by: authUser?.id || null });
        out.push({ ...r, ok: true });
      } catch (e) {
        out.push({ ...r, ok: false, error: e?.message || String(e) });
      }
      setProgress(out.length);
    }
    setResults(out);
    setRunning(false);
  };

  const okCount = (results || []).filter((r) => r.ok).length;
  const failed = (results || []).filter((r) => !r.ok);
  const btn = "text-xs font-medium px-2.5 py-1 rounded-lg ring-1 ring-gray-200 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50";

  return (
    <Modal open={open} onClose={close} title="Import labours from a sheet" wide>
      {!plan && !results && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            A CSV with the headings <span className="font-medium text-gray-900">Category, Sub_Category, Name, Mobile</span>. Each person goes on
            the labour list of their sub-category's department (a "tenting , structure" person on both). Nobody logs in: whoever has punch
            access for the department punches them.
          </p>
          <label className={"flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors " + (reading ? "border-gray-200 bg-gray-50 cursor-progress" : "border-blue-200 bg-blue-50/40 cursor-pointer hover:border-blue-400")}>
            <span className="text-sm font-semibold text-blue-700">{reading ? "Reading the sheet…" : "Choose the CSV file"}</span>
            <span className="text-xs text-gray-500">Nothing is added until you review it and press Add</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={reading} onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          {readError && <p role="alert" className="text-sm text-red-600">{readError}</p>}
        </div>
      )}

      {plan && !results && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-gray-700"><span className="font-semibold text-gray-900">{fileName}</span> · {chosen.length} to add · {skipped.length} skipped</p>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setAll(true)} disabled={running} className={btn}>Select all</button>
              <button type="button" onClick={() => setAll(false)} disabled={running} className={btn}>Clear</button>
              <button type="button" onClick={reset} disabled={running} className={btn}>Another file</button>
            </div>
          </div>
          {byDept.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {byDept.map(([d, n]) => <span key={d} className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">{DEPT_ICON[d] || ""} {d} · {n}</span>)}
            </div>
          )}
          <div className="rounded-xl ring-1 ring-gray-200 overflow-hidden">
            <div className="max-h-[46vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                  <tr><th className="w-12 px-3 py-2" /><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Department</th><th className="text-left px-3 py-2">Phone</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.map((r) => (
                    <tr key={r.key} className={r.status === "skip" ? "bg-gray-50 text-gray-400" : r.on ? "" : "text-gray-400"}>
                      <td className="px-3 py-2 align-top">
                        {r.status === "new"
                          ? <input type="checkbox" checked={r.on} disabled={running} onChange={() => toggle(r.key)} aria-label={`Add ${r.name} to ${r.department}`} className="w-4 h-4 accent-blue-600" />
                          : <span className="text-[10px] font-semibold uppercase tracking-wide">Skip</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className={r.status === "skip" ? "" : "font-medium text-gray-900"}>{r.name || "—"}</div>
                        {r.status === "skip" && <div className="text-xs">{r.reason}</div>}
                        {r.status === "new" && r.warning && <div className="text-xs text-amber-700">{r.warning}</div>}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">{r.department ? `${DEPT_ICON[r.department] || ""} ${r.department}` : "—"}</td>
                      <td className="px-3 py-2 align-top tabular-nums">{r.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {running && (
              <div className="mr-auto flex items-center gap-3 text-sm text-gray-600" aria-live="polite">
                <div className="w-40 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress / Math.max(1, chosen.length)) * 100}%` }} /></div>
                Adding {progress} of {chosen.length}…
              </div>
            )}
            <button type="button" onClick={close} disabled={running} className="h-10 px-4 rounded-xl text-sm font-semibold ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={run} disabled={running || !chosen.length}
              className="h-10 px-4 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-200 disabled:text-gray-400">
              {running ? "Adding…" : `Add ${chosen.length} to the labour lists`}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-4">
          <div className={"rounded-xl px-4 py-3 text-sm " + (failed.length ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200")}>
            <span className="font-semibold">{okCount} added</span> to the labour lists{failed.length ? ` · ${failed.length} failed (below)` : ""}. They show in Labour Punch and Labour Log now.
          </div>
          {failed.length > 0 && (
            <ul className="rounded-xl ring-1 ring-gray-200 divide-y divide-gray-100 text-sm">
              {failed.map((r) => <li key={r.key} className="px-4 py-2"><span className="font-medium text-gray-900">{r.name}</span> <span className="text-gray-500">({r.department})</span> — <span className="text-red-600">{r.error}</span></li>)}
            </ul>
          )}
          <div className="flex justify-end"><button type="button" onClick={close} className="h-10 px-4 rounded-xl text-sm font-semibold ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50">Done</button></div>
        </div>
      )}
    </Modal>
  );
}

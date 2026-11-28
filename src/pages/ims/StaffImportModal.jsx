import { useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import { ROLES } from "../../lib/ims/constants";
import { callUserAdmin } from "../../lib/userAdmin";
import { parseCsv, planStaffImport, generatePassword, staffRoleSettings, credentialsCsv, STAFF_ROLE } from "../../lib/ims/staffImport";

// ═══ Import staff from a contact sheet (IMS → Admin → Users & Roles) ═══
// Owner ask 2026-11-28: the vendor / labour sheet (Category, Sub_Category, S_No, Name, Mobile, Email) into Attendance, each
// person in their sub-category's department, each with their own login so they can punch. The plan (who, which department,
// which username, who is skipped and why) is lib/ims/staffImport.js; this screen previews it, creates the accounts one by
// one through the same admin-gated user-admin function "+ Add User" uses, and hands back the usernames and passwords.
export default function StaffImportModal({ open, onClose, users, settings, setSettings }) {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState(null);       // planStaffImport rows + { on }
  const [readError, setReadError] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null); // [{ ...row, password, result, ok }]
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(false);

  const chosen = useMemo(() => (plan || []).filter((r) => r.status === "new" && r.on), [plan]);
  const skipped = useMemo(() => (plan || []).filter((r) => r.status === "skip"), [plan]);
  const byDept = useMemo(() => {
    const m = {};
    chosen.forEach((r) => { const k = r.departments.length ? r.departments.join(" + ") : "No department"; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [chosen]);

  const reset = () => { setFileName(""); setPlan(null); setReadError(""); setResults(null); setProgress(0); setDownloaded(false); };
  const close = () => {
    if (running) return;
    // the passwords exist only on this screen - closing before the sheet is downloaded loses them (each would need a reset)
    if (results && results.some((r) => r.ok) && !downloaded && !window.confirm("Close without downloading the usernames and passwords? They are not saved anywhere - each person would need a password reset.")) return;
    reset(); onClose();
  };

  const readFile = (file) => {
    if (!file) return;
    setReadError(""); setResults(null);
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const rows = parseCsv(String(fr.result || ""));
        if (!rows.length) { setReadError("The file has no rows."); setPlan(null); return; }
        if (!Object.keys(rows[0]).some((h) => h.trim().toLowerCase() === "name")) { setReadError('No "Name" column found - the first row must be the headings (Category, Sub_Category, Name, Mobile, Email).'); setPlan(null); return; }
        setFileName(file.name);
        setPlan(planStaffImport(rows, users).map((r) => ({ ...r, on: r.status === "new" })));
      } catch (e) { setReadError("Couldn't read this file: " + (e?.message || e)); }
    };
    fr.onerror = () => setReadError("Couldn't read this file.");
    fr.readAsText(file, "utf-8");
  };

  const toggle = (line) => setPlan((p) => p.map((r) => (r.line === line ? { ...r, on: !r.on } : r)));
  const setAll = (on) => setPlan((p) => p.map((r) => (r.status === "new" ? { ...r, on } : r)));

  const run = async () => {
    if (!chosen.length || running) return;
    setRunning(true); setProgress(0);
    // The Labour role first (only Attendance opens for it), so the very first account already lands on a real role.
    const roleChange = staffRoleSettings(settings, ROLES);
    if (roleChange) setSettings((s) => ({ ...s, ...staffRoleSettings(s, ROLES) }));
    const taken = new Set((users || []).map((u) => String(u.id)));
    const mint = () => "U" + (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const out = [];
    for (const r of chosen) {
      let id = mint(); while (taken.has(id)) id = mint();
      taken.add(id);
      const password = generatePassword(r.name);
      const profile = { id, name: r.name, username: r.username, role: STAFF_ROLE, permissions: [], apps: ["ims"], departments: r.departments.length ? r.departments : null, phone: r.phone || "", email: r.email || "", active: true, tabOverride: null };
      try {
        await callUserAdmin("createUser", { user: profile, password });
        out.push({ ...r, password, ok: true, result: "Created" });
      } catch (e) {
        out.push({ ...r, password: "", ok: false, result: "Failed: " + (e?.message || e) });
      }
      setProgress(out.length);
    }
    setResults(out);
    setRunning(false);
  };

  const download = () => {
    const blob = new Blob([credentialsCsv(results || [])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Ambria_staff_logins_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  };

  const okCount = (results || []).filter((r) => r.ok).length;
  const failCount = (results || []).length - okCount;

  return (
    <Modal open={open} onClose={close} title="Import staff from a sheet" wide>
      {/* 1 · pick the file */}
      {!plan && !results && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            A CSV with the headings <span className="font-medium text-gray-900">Category, Sub_Category, Name, Mobile, Email</span>. Each
            person gets their own login with the <span className="font-medium text-gray-900">{STAFF_ROLE}</span> role (they see only
            Attendance) and lands in the department of their sub-category.
          </p>
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 px-6 py-10 text-center cursor-pointer hover:border-indigo-400 transition-colors">
            <span className="text-sm font-semibold text-indigo-700">Choose the CSV file</span>
            <span className="text-xs text-gray-500">Nothing is created until you review it and press Create</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          {readError && <p role="alert" className="text-sm text-red-600">{readError}</p>}
        </div>
      )}

      {/* 2 · review */}
      {plan && !results && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-gray-700"><span className="font-semibold text-gray-900">{fileName}</span> · {chosen.length} to create · {skipped.length} skipped</p>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setAll(true)} disabled={running} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Select all</button>
              <button type="button" onClick={() => setAll(false)} disabled={running} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Clear</button>
              <button type="button" onClick={reset} disabled={running} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Another file</button>
            </div>
          </div>
          {byDept.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {byDept.map(([d, n]) => <span key={d} className={"text-xs font-medium px-2.5 py-1 rounded-full " + (d === "No department" ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200")}>{d} · {n}</span>)}
            </div>
          )}
          <div className="rounded-xl border overflow-hidden">
            <div className="max-h-[46vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                  <tr><th className="w-10 px-3 py-2" /><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Username</th><th className="text-left px-3 py-2">Department</th><th className="text-left px-3 py-2">Phone</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plan.map((r) => (
                    <tr key={r.line} className={r.status === "skip" ? "bg-gray-50 text-gray-400" : r.on ? "" : "text-gray-400"}>
                      <td className="px-3 py-2 align-top">
                        {r.status === "new"
                          ? <input type="checkbox" checked={r.on} disabled={running} onChange={() => toggle(r.line)} aria-label={`Create ${r.name}`} className="w-4 h-4 accent-indigo-600" />
                          : <span className="text-[10px] font-semibold uppercase tracking-wide">Skip</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className={r.status === "skip" ? "" : "font-medium text-gray-900"}>{r.name || "—"}</div>
                        {r.status === "skip" && <div className="text-xs">{r.reason}</div>}
                        {r.status === "new" && r.warning && <div className="text-xs text-amber-700">{r.warning}</div>}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-xs">{r.username || "—"}</td>
                      <td className="px-3 py-2 align-top">{r.departments.length ? r.departments.join(" + ") : <span className="text-amber-700">None</span>}</td>
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
                <div className="w-40 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${(progress / Math.max(1, chosen.length)) * 100}%` }} /></div>
                Creating {progress} of {chosen.length}… keep this open
              </div>
            )}
            <button type="button" onClick={close} disabled={running} className="px-4 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={run} disabled={running || !chosen.length}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-gray-200 disabled:text-gray-400">
              {running ? "Creating…" : `Create ${chosen.length} login${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {/* 3 · done */}
      {results && (
        <div className="space-y-4">
          <div className={"rounded-xl px-4 py-3 text-sm " + (failCount ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200")}>
            <span className="font-semibold">{okCount} login{okCount === 1 ? "" : "s"} created</span>{failCount ? ` · ${failCount} failed (listed below - fix and add them one by one)` : ""}.
            Download the sheet now: the passwords are shown only here and are not saved anywhere.
          </div>
          <button type="button" onClick={download} className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-900 hover:bg-black text-white">Download usernames &amp; passwords (CSV)</button>
          {failCount > 0 && (
            <ul className="rounded-xl border divide-y divide-gray-100 text-sm">
              {results.filter((r) => !r.ok).map((r) => <li key={r.line} className="px-4 py-2"><span className="font-medium text-gray-900">{r.name}</span> <span className="text-gray-500">({r.username})</span> — <span className="text-red-600">{r.result}</span></li>)}
            </ul>
          )}
          <div className="flex justify-end"><button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">Close</button></div>
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { useSaveProblems, retrySaveProblem, retryAllSaveProblems, discardSaveProblem } from "../../lib/saveHealth";
import { problemSummary, problemDetail } from "../../lib/problemMessage";
import { useAuth } from "../../lib/AuthContext";

// Mounted once in App.jsx, above the router, same as UpdateBanner/CanvaOAuthBanner — a write
// failure can happen on either Studio or IMS, and this has to survive whichever page is open.
// Deliberately persistent (no auto-dismiss): see saveHealth.js's own comment for why a fading toast
// is how a failed write turns into silently lost data.
// Plain words first (owner ask 2026-11-28): one message saying what went wrong and what to do (lib/problemMessage.js), the
// backend's own lines only under "Details".

// navigator.onLine, live - an offline browser is the cause whatever the individual errors say.
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";

export default function SaveHealthBanner() {
  const problems = useSaveProblems();
  const online = useOnline();
  const { logout } = useAuth() || {};
  const [openSave, setOpenSave] = useState(false);
  const [openLoad, setOpenLoad] = useState(false);
  if (!problems.length) return null;
  const failed = problems.filter((p) => !p.blocked);
  const blocked = problems.filter((p) => p.blocked);
  const saveSum = problemSummary(failed, "save", online);
  const loadSum = problemSummary(blocked, "load", online);
  const relogin = async () => { try { await logout?.(); } finally { window.location.reload(); } };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2" role="status" aria-live="polite">
      {failed.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-white shadow-xl overflow-hidden">
          <div className="flex gap-3 p-4">
            <span aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-base">!</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{saveSum.title}</p>
              <p className="mt-0.5 text-sm text-gray-600">{saveSum.hint}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {saveSum.action === "login"
                  ? <button onClick={relogin} className={"h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 " + FOCUS + " focus-visible:ring-red-500"}>Log in again</button>
                  : <button onClick={failed.length > 1 ? retryAllSaveProblems : () => retrySaveProblem(failed[0].id)} className={"h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 " + FOCUS + " focus-visible:ring-red-500"}>{failed.length > 1 ? "Retry all" : "Retry"}</button>}
                <button onClick={() => setOpenSave((o) => !o)} aria-expanded={openSave} className={"h-9 px-3 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 " + FOCUS + " focus-visible:ring-gray-400"}>
                  {openSave ? "Hide details" : `Details (${failed.length})`}
                </button>
              </div>
            </div>
          </div>
          {openSave && (
            <ul className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 space-y-2 max-h-48 overflow-y-auto">
              {failed.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 text-xs text-gray-700">
                  <span className="min-w-0 break-words"><span className="font-semibold text-gray-900">{p.label}</span>{problemDetail(p.error) ? ` — ${problemDetail(p.error)}` : ""}<span className="block text-[11px] text-gray-400">{p.error}</span></span>
                  <span className="flex gap-2 shrink-0 pt-px">
                    {p.retry && <button onClick={() => retrySaveProblem(p.id)} className="font-semibold text-red-700 underline">Retry</button>}
                    <button onClick={() => discardSaveProblem(p.id)} className="text-gray-500 underline">Discard</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-white shadow-xl overflow-hidden">
          <div className="flex gap-3 p-4">
            <span aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-base">{loadSum.kind === "offline" ? "⚡" : loadSum.kind === "login" ? "🔒" : "!"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{loadSum.title}</p>
              <p className="mt-0.5 text-sm text-gray-600">{loadSum.hint}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {loadSum.action === "login"
                  ? <button onClick={relogin} className={"h-9 px-4 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black " + FOCUS + " focus-visible:ring-gray-500"}>Log in again</button>
                  : <button onClick={() => window.location.reload()} className={"h-9 px-4 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black " + FOCUS + " focus-visible:ring-gray-500"}>Reload</button>}
                <button onClick={() => setOpenLoad((o) => !o)} aria-expanded={openLoad} className={"h-9 px-3 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 " + FOCUS + " focus-visible:ring-gray-400"}>
                  {openLoad ? "Hide details" : `Details (${blocked.length})`}
                </button>
              </div>
            </div>
          </div>
          {openLoad && (
            <ul className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 space-y-2 max-h-48 overflow-y-auto">
              {blocked.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 text-xs text-gray-700">
                  <span className="min-w-0 break-words"><span className="font-semibold text-gray-900">{p.label}</span>{problemDetail(p.error) ? ` — ${problemDetail(p.error)}` : ""}<span className="block text-[11px] text-gray-400">{p.error}</span></span>
                  {/* Some load failures can retry themselves in place (background recovery) instead of
                      needing the blanket Reload above — shown only when the report actually gave one. */}
                  {p.retry && <button onClick={() => retrySaveProblem(p.id)} className="shrink-0 font-semibold text-amber-700 underline">Retry</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

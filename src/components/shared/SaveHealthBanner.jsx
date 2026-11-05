import { useSaveProblems, retrySaveProblem, retryAllSaveProblems, discardSaveProblem } from "../../lib/saveHealth";

// Mounted once in App.jsx, above the router, same as UpdateBanner/CanvaOAuthBanner — a write
// failure can happen on either Studio or IMS, and this has to survive whichever page is open.
// Deliberately persistent (no auto-dismiss): see saveHealth.js's own comment for why a fading toast
// is how a failed write turns into silently lost data.
export default function SaveHealthBanner() {
  const problems = useSaveProblems();
  if (!problems.length) return null;
  const failed = problems.filter((p) => !p.blocked);
  const blocked = problems.filter((p) => p.blocked);
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2">
      {failed.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-red-800">
              {failed.length === 1 ? "A save failed" : `${failed.length} saves failed`}
            </span>
            {failed.length > 1 && (
              <button onClick={retryAllSaveProblems} className="shrink-0 text-xs font-semibold text-red-700 underline">
                Retry all
              </button>
            )}
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {failed.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2 text-xs text-red-700">
                <span className="min-w-0 break-words"><span className="font-medium">{p.label}:</span> {p.error}</span>
                <span className="flex gap-2 shrink-0 pt-px">
                  {p.retry && (
                    <button onClick={() => retrySaveProblem(p.id)} className="font-semibold underline">Retry</button>
                  )}
                  <button onClick={() => discardSaveProblem(p.id)} className="text-red-400 underline">Discard</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blocked.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-amber-800">
              {blocked.length === 1 ? "Something didn't load" : `${blocked.length} things didn't load`}
            </span>
            <button onClick={() => window.location.reload()} className="shrink-0 text-xs font-semibold text-amber-700 underline">
              Reload
            </button>
          </div>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {blocked.map((p) => (
              <li key={p.id} className="text-xs text-amber-700 break-words">
                <span className="font-medium">{p.label}:</span> {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

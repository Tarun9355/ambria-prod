import { PRICING_CAT_STYLES } from "../../lib/inventory/constants";
import { SETTINGS_DEFAULTS, DATE_PRICING_LABELS, DATE_PRICING_OWNER_ID } from "../../lib/ims/constants";

// Faithful copy of the reference IMS DatePricingPanel (shown in Calendar → Date Pricing Config).
// Marking individual dates now happens directly on the Calendar tab's main month grid (click a
// date → pick a pricing override there) — this panel only configures the multipliers and
// lists/clears whatever's been marked, so there's one calendar to look at, not two.
// The Last-Minute Booking Override (Filler pricing for any booking within N days, regardless of
// the date's own category) was removed 2026-10-25 by owner request — a date's price now always
// comes from its own category, full stop.
export default function DatePricingPanel({ settings, setSettings, authUser }) {
  const dp = settings.datePricing || SETTINGS_DEFAULTS.datePricing;
  const cats = dp.categories || {};
  const marked = dp.markedDates || {};
  const markedCount = Object.keys(marked).length;
  const isOwner = authUser?.id === DATE_PRICING_OWNER_ID;

  function setMultiplier(catKey, val) {
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, categories: { ...s.datePricing.categories, [catKey]: { ...s.datePricing.categories[catKey], multiplier: parseFloat(val) || 1 } } } }));
  }
  // Owner ask (2026-10-25): pausing/resuming this silently changes live Studio pricing on every
  // date it touches, so it's now locked behind a code only the owner sets/knows — anyone else
  // opening this panel can see the toggle but can't actually flip it without that code. The code
  // itself lives in plain settings (same as every other admin setting here) — this is a deterrent
  // against an ops person fat-fingering it, not a cryptographic secret. Anyone who's been told the
  // code can USE it to pause/resume; only Tarun (OWNER_USER_ID) can ever SET or CHANGE it — see
  // changeLockCode and the "no code yet" branch below.
  function requireLockCode(actionLabel) {
    const current = dp.autoSyncLockCode;
    if (!current) {
      if (!isOwner) { alert("No lock code has been set for this yet — ask Tarun to set one first (Admin → Settings → Date Pricing Config)."); return false; }
      const code1 = window.prompt("No lock code is set yet. Set one now to protect pausing/resuming auto-sync (you'll need to enter it every time):");
      if (!code1 || !code1.trim()) return false;
      const code2 = window.prompt("Re-enter the code to confirm:");
      if (code2 !== code1) { alert("Codes didn't match — nothing changed."); return false; }
      setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, autoSyncLockCode: code1.trim() } }));
      return true;
    }
    const entered = window.prompt(`Enter the code to ${actionLabel}:`);
    if (entered !== current) { if (entered !== null) alert("Wrong code."); return false; }
    return true;
  }
  function toggleAutoSyncPaused() {
    if (!requireLockCode(dp.autoSyncPaused ? "resume auto-sync" : "pause auto-sync")) return;
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, autoSyncPaused: !s.datePricing?.autoSyncPaused } }));
  }
  // Owner-only, enforced here too (not just by hiding the button) — a stray call from outside this
  // component should not be able to change or clear the lock either.
  function changeLockCode() {
    if (!isOwner) return;
    const current = dp.autoSyncLockCode;
    if (current && !requireLockCode("change the lock code")) return;
    const next = window.prompt(current ? "Enter a new code (leave blank to remove the lock):" : "Set a code to protect pausing/resuming auto-sync:");
    if (next === null) return;
    if (!next.trim()) {
      if (current && !confirm("Remove the lock code? Anyone will be able to pause/resume auto-sync afterward.")) return;
      setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, autoSyncLockCode: "" } }));
      return;
    }
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, autoSyncLockCode: next.trim() } }));
  }

  const CAT_DOT = { heavy_saya: "bg-red-500", competition: "bg-yellow-400", non_saya: "bg-green-500" };
  const autoSyncPaused = !!dp.autoSyncPaused;

  return (
    <div className="space-y-6">
      <div className={"rounded-2xl p-4 flex items-start gap-4 border " + (autoSyncPaused ? "bg-red-50 border-red-200" : "bg-white")}>
        <span className="text-3xl flex-shrink-0">{autoSyncPaused ? "⏸" : "🔄"}</span>
        <div className="flex-1">
          <p className={"font-bold " + (autoSyncPaused ? "text-red-800" : "text-gray-800")}>LMS Auto-Sync</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            A date's category is normally re-derived automatically from LMS/season booking counts every
            time anyone opens IMS — silently, with no notice on any live Studio quote. Pausing freezes
            every date's category exactly as it is right now; manual overrides below are unaffected either way.
          </p>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <button onClick={toggleAutoSyncPaused}
            className={"text-sm font-semibold px-4 py-2 rounded-lg border " + (autoSyncPaused ? "bg-red-600 text-white border-red-600" : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200")}>
            🔒 {autoSyncPaused ? "Paused — click to resume" : "Pause auto-sync"}
          </button>
          {/* Owner-only (OWNER_USER_ID) — anyone else, admin or not, sees the toggle above but not
              this control at all, so only Tarun can ever set or change the code it requires. */}
          {isOwner && (
            <button onClick={changeLockCode} className="text-[11px] text-gray-400 hover:text-gray-600 underline">
              {dp.autoSyncLockCode ? "Change lock code" : "Set a lock code"}
            </button>
          )}
        </div>
      </div>
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h4 className="font-bold text-gray-800">📊 Category Multipliers</h4>
          <p className="text-xs text-gray-500 mt-0.5">Base price × multiplier = effective rental price charged to client</p>
        </div>
        <div className="divide-y">
          {Object.entries(cats).map(([key, cat]) => (
            <div key={key} className="flex items-center gap-4 px-4 py-3">
              <div className={"w-3 h-3 rounded-full flex-shrink-0 " + (CAT_DOT[key] || "bg-gray-400")}></div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">{DATE_PRICING_LABELS[key] || cat.label}</p>
                <p className="text-xs text-gray-400">
                  {key === "heavy_saya" ? "Peak wedding season — charge premium" :
                    key === "competition" ? "Solid demand — standard market rate" :
                      "Off-season, unlisted, or last-minute — attract business with lower rates"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-500">Multiplier:</span>
                <input type="number" step="0.05" min="0.1" max="3" value={cat.multiplier}
                  onChange={(e) => setMultiplier(key, e.target.value)}
                  className="w-20 border rounded-lg px-2 py-1.5 text-sm font-bold text-center" />
                <span className="text-xs text-gray-400">× base</span>
                <span className={"text-xs px-2 py-1 rounded-lg font-semibold border " + (PRICING_CAT_STYLES[key] || "")}>
                  e.g. ₹2000 → ₹{Math.round(2000 * cat.multiplier).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {markedCount > 0 && (
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-bold text-gray-800">📋 Manually Overridden Dates ({markedCount})</h4>
            {/* Owner-only, same as setting one on the Calendar tab — clearing an override is just as
                much "overriding the dates" as setting one. */}
            {isOwner && (
              <button onClick={() => setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, markedDates: {} } }))}
                className="text-xs text-red-500 hover:text-red-700 underline">Clear all overrides</button>
            )}
          </div>
          <p className="text-xs text-gray-400 px-4 pt-2">Set from the Calendar tab's main month grid — click any date, then pick a category. Anything not listed here prices off the auto-synced calendar category.</p>
          <div className="divide-y max-h-48 overflow-y-auto">
            {Object.entries(marked).sort(([a], [b]) => a.localeCompare(b)).map(([date, catKey]) => {
              const cat = cats[catKey];
              return (
                <div key={date} className="flex items-center gap-3 px-4 py-2">
                  <span className={"text-xs px-2 py-0.5 rounded-full font-medium border " + (PRICING_CAT_STYLES[catKey] || "")}>{DATE_PRICING_LABELS[catKey] || cat?.label || catKey}</span>
                  <span className="text-sm text-gray-700 font-medium">{new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="ml-auto text-xs text-gray-400">{cat?.multiplier}×</span>
                  {isOwner && (
                    <button onClick={() => setSettings((s) => { const m = { ...s.datePricing.markedDates }; delete m[date]; return { ...s, datePricing: { ...s.datePricing, markedDates: m } }; })}
                      className="text-red-400 hover:text-red-600 text-sm">×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

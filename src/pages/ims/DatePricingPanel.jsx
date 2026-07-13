import { PRICING_CAT_STYLES } from "../../lib/inventory/constants";
import { SETTINGS_DEFAULTS, DATE_PRICING_LABELS } from "../../lib/ims/constants";

// Faithful copy of the reference IMS DatePricingPanel (shown in Calendar → Date Pricing Config).
// Marking individual dates now happens directly on the Calendar tab's main month grid (click a
// date → pick a pricing override there) — this panel only configures the multipliers + last-minute
// override and lists/clears whatever's been marked, so there's one calendar to look at, not two.
export default function DatePricingPanel({ settings, setSettings }) {
  const dp = settings.datePricing || SETTINGS_DEFAULTS.datePricing;
  const cats = dp.categories || {};
  const marked = dp.markedDates || {};
  const markedCount = Object.keys(marked).length;

  function setMultiplier(catKey, val) {
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, categories: { ...s.datePricing.categories, [catKey]: { ...s.datePricing.categories[catKey], multiplier: parseFloat(val) || 1 } } } }));
  }
  function setLastMinDays(val) {
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, lastMinuteDays: parseInt(val) || 10 } }));
  }

  const CAT_DOT = { heavy_saya: "bg-red-500", competition: "bg-yellow-400", non_saya: "bg-green-500" };

  return (
    <div className="space-y-6">
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

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-4">
        <span className="text-3xl flex-shrink-0">⚡</span>
        <div className="flex-1">
          <p className="font-bold text-amber-800">Last-Minute Booking Override</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            If a project is created within <strong>N days</strong> of the function date, Filler pricing automatically applies — regardless of the date's calendar category.
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm text-amber-800 font-medium">Override window:</span>
            <input type="number" min="1" max="60" value={dp.lastMinuteDays || 10}
              onChange={(e) => setLastMinDays(e.target.value)}
              className="w-20 border border-amber-300 rounded-lg px-3 py-1.5 text-sm font-bold text-center bg-white" />
            <span className="text-sm text-amber-700">days before the event</span>
          </div>
          <p className="text-xs text-amber-600 mt-2">
            Current: booking ≤ {dp.lastMinuteDays || 10} days from event → Filler ({(cats.non_saya?.multiplier || 0.75) * 100}% of base price)
          </p>
        </div>
      </div>

      {markedCount > 0 && (
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-bold text-gray-800">📋 Manually Overridden Dates ({markedCount})</h4>
            <button onClick={() => setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, markedDates: {} } }))}
              className="text-xs text-red-500 hover:text-red-700 underline">Clear all overrides</button>
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
                  <button onClick={() => setSettings((s) => { const m = { ...s.datePricing.markedDates }; delete m[date]; return { ...s, datePricing: { ...s.datePricing, markedDates: m } }; })}
                    className="text-red-400 hover:text-red-600 text-sm">×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

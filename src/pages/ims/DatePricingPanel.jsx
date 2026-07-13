import { useState } from "react";
import { PRICING_CAT_STYLES } from "../../lib/inventory/constants";
import { SETTINGS_DEFAULTS, DATE_PRICING_LABELS } from "../../lib/ims/constants";

// Faithful copy of the reference IMS DatePricingPanel (shown in Calendar → Date Pricing Config).
export default function DatePricingPanel({ settings, setSettings }) {
  const dp = settings.datePricing || SETTINGS_DEFAULTS.datePricing;
  const cats = dp.categories || {};
  const marked = dp.markedDates || {};
  // Auto-synced from the Calendar's LMS/season data (IMS.jsx's loadLmsFromCache) — the default
  // category for any date the admin hasn't manually overridden in `marked`.
  const auto = dp.autoCategories || {};

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selCat, setSelCat] = useState("heavy_saya");

  function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function getFirstDay(y, m) { return new Date(y, m, 1).getDay(); }

  function toggleDate(dateStr, catKey) {
    setSettings((s) => {
      const m = { ...(s.datePricing?.markedDates || {}) };
      if (m[dateStr] === catKey) delete m[dateStr];
      else m[dateStr] = catKey;
      return { ...s, datePricing: { ...s.datePricing, markedDates: m } };
    });
  }
  function setMultiplier(catKey, val) {
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, categories: { ...s.datePricing.categories, [catKey]: { ...s.datePricing.categories[catKey], multiplier: parseFloat(val) || 1 } } } }));
  }
  function setLastMinDays(val) {
    setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, lastMinuteDays: parseInt(val) || 10 } }));
  }

  const days = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDay(calYear, calMonth);
  const monthName = new Date(calYear, calMonth, 1).toLocaleString("default", { month: "long" });
  const markedCount = Object.keys(marked).length;
  const todayStr = today.toISOString().split("T")[0];

  const CAT_DOT = { heavy_saya: "bg-red-500", competition: "bg-yellow-400", non_saya: "bg-green-500" };
  const CAT_CELL = {
    heavy_saya: "bg-red-100 text-red-800 font-bold border border-red-300",
    competition: "bg-yellow-100 text-yellow-800 font-bold border border-yellow-300",
    non_saya: "bg-green-100 text-green-800 font-bold border border-green-300",
  };
  // Lighter variant for dates with no manual override — shows what the auto-synced (LMS/season)
  // category would price it at, so an admin can see what they'd be overriding before clicking.
  const CAT_CELL_LIGHT = {
    heavy_saya: "bg-red-50 text-red-500 border border-red-100 hover:bg-red-100",
    competition: "bg-yellow-50 text-yellow-600 border border-yellow-100 hover:bg-yellow-100",
    non_saya: "bg-green-50 text-green-500 border border-green-100 hover:bg-green-100",
  };

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

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 className="font-bold text-gray-800">📅 Mark Dates on Calendar</h4>
            <p className="text-xs text-gray-500 mt-0.5">{markedCount} date{markedCount !== 1 ? "s" : ""} marked · Select a category below then click any date</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(cats).map(([key, cat]) => (
              <button key={key} onClick={() => setSelCat(key)}
                className={"text-xs px-3 py-1.5 rounded-lg font-semibold border transition-all " + (selCat === key ? `ring-2 ring-offset-1 ${PRICING_CAT_STYLES[key]} ring-current` : `${PRICING_CAT_STYLES[key]} opacity-60 hover:opacity-100`)}>
                {DATE_PRICING_LABELS[key] || cat.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold">‹</button>
          <p className="font-bold text-gray-800">{monthName} {calYear}</p>
          <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 font-bold">›</button>
        </div>
        <div className="grid grid-cols-7 text-center px-3 py-1 border-b">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-xs font-semibold text-gray-400 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 p-3">
          {Array(firstDay).fill(null).map((_, i) => <div key={"e" + i} />)}
          {Array(days).fill(null).map((_, i) => {
            const d = i + 1;
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const catKey = marked[dateStr];
            const autoKey = !catKey ? auto[dateStr] : null;
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            return (
              <button key={d} onClick={() => toggleDate(dateStr, selCat)}
                title={autoKey ? `Auto-synced as ${DATE_PRICING_LABELS[autoKey] || autoKey} — click to override` : undefined}
                className={"w-full aspect-square rounded-xl text-sm font-medium transition-all flex items-center justify-center relative "
                  + (catKey ? (CAT_CELL[catKey] || "bg-gray-100")
                    : autoKey ? (CAT_CELL_LIGHT[autoKey] || "text-gray-700")
                      : isPast ? "text-gray-300 hover:bg-gray-50"
                        : isToday ? "border-2 border-indigo-500 text-indigo-700 font-bold hover:bg-indigo-50"
                          : "hover:bg-gray-100 text-gray-700")}>
                {d}
                {autoKey && <span className={"absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full " + (CAT_DOT[autoKey] || "bg-gray-400")} />}
                {isToday && !catKey && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500" />}
              </button>
            );
          })}
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t flex flex-wrap gap-3">
          {Object.entries(cats).map(([key, cat]) => {
            const count = Object.values(marked).filter((v) => v === key).length;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <div className={"w-3 h-3 rounded " + (CAT_DOT[key] || "bg-gray-400")} />
                <span className="text-xs text-gray-600">{DATE_PRICING_LABELS[key] || cat.label}: <strong>{count} dates</strong></span>
              </div>
            );
          })}
          {markedCount > 0 && (
            <button onClick={() => setSettings((s) => ({ ...s, datePricing: { ...s.datePricing, markedDates: {} } }))}
              className="ml-auto text-xs text-red-500 hover:text-red-700 underline">Clear all dates</button>
          )}
        </div>
      </div>

      {markedCount > 0 && (
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h4 className="font-bold text-gray-800">📋 All Marked Dates ({markedCount})</h4>
          </div>
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

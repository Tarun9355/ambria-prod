import { useState, useMemo } from "react";
import DatePricingPanel from "./DatePricingPanel.jsx";
import { resolveDateCategory } from "../../lib/inventory/helpers";
import { DATE_PRICING_LABELS, SETTINGS_DEFAULTS } from "../../lib/ims/constants";
import { PRICING_CAT_STYLES } from "../../lib/inventory/constants";

// Faithful copy of the reference IMS CalendarTab — renders LMS/ERP contracts on a
// month grid, colour-codes dates by Studio category, and exposes Date Pricing config.
export default function CalendarTab({ lmsContracts, studioLmsCache, onSyncLms, lmsSyncing, settings, setSettings, eventOrders }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selDate, setSelDate] = useState(null);
  const [showDatePricing, setShowDatePricing] = useState(false);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = `${year}-${String(month + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  function dateStr(d) { return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

  const dateCategories = studioLmsCache?.dateCategories || {};
  const getDateCategory = (ds) => dateCategories[ds] || null;
  const dateCatColors = {
    "Heavy Saya": { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626", label: "👑 King's" },
    "Saya": { bg: "#fefce8", border: "#fde047", text: "#ca8a04", label: "✦ Perfect" },
    "Normal": { bg: "#f0fdf4", border: "#86efac", text: "#16a34a", label: "○ Normal" },
  };
  const hasCats = Object.keys(dateCategories).length > 0;

  // Manual pricing overrides live right here now — one calendar to view AND set dates on, instead
  // of a second click-to-mark grid duplicated in Date Pricing Config below.
  const marked = settings?.datePricing?.markedDates || {};
  function setDateCategory(ds, catKey) {
    setSettings((s) => {
      const m = { ...(s.datePricing?.markedDates || {}) };
      if (catKey == null) delete m[ds]; else m[ds] = catKey;
      return { ...s, datePricing: { ...s.datePricing, markedDates: m } };
    });
  }

  const fmtTime = (t) => {
    if (!t) return "";
    const clean = String(t).includes("T") ? String(t).split("T")[1]?.slice(0, 5) : String(t).slice(0, 5);
    if (!clean || clean === "00:00") return "";
    const [hh, mm] = clean.split(":");
    const h = parseInt(hh); const ampm = h >= 12 ? "PM" : "AM";
    return ((h % 12) || 12) + ":" + mm + " " + ampm;
  };
  const fmtAmt = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN");

  const calEvents = useMemo(() => {
    const events = [];
    for (const c of (lmsContracts || [])) {
      for (let fi = 0; fi < (c.functions || []).length; fi++) {
        const fn = c.functions[fi];
        if (fn.functionDate) {
          events.push({
            id: c.id + "-" + fi, date: fn.functionDate,
            guestName: c.guestName || "—", brideName: c.brideName || "", groomName: c.groomName || "",
            functionType: fn.functionType || "", functionTime: fmtTime(fn.functionTime), session: fn.session || "",
            venue: fn.internalVenueName || fn.externalVenue || "", pax: fn.pax || 0, leadType: fn.leadType || "",
            dept: c.dept || "", entryNo: c.entryNo || "", priority: c.priority || "",
            totalAmt: c.totalAmt || 0, balance: c.balance || 0, decorLumpsum: fn.decorLumpsum || 0,
            matched: !!c.matchedEoId, matchType: c.matchType, locationName: fn.locationName || "",
          });
        }
      }
    }
    return events;
  }, [lmsContracts]);

  // Studio-booked deals (event_orders) — a separate source from the external LMS/CRM contracts
  // above, so a deal only shows here if it's booked in Studio, whether or not it also exists in
  // the CRM. `functionsDetail[]` covers multi-function events; single-date EOs fall back to `.date`.
  const studioEvents = useMemo(() => {
    const events = [];
    for (const eo of (eventOrders || [])) {
      if (!eo || eo.status === "cancelled") continue;
      const fnsDetail = Array.isArray(eo.functionsDetail) ? eo.functionsDetail : null;
      const fnList = fnsDetail && fnsDetail.length ? fnsDetail : [{ date: eo.date, venue: eo.venue, type: (eo.functions || [])[0] }];
      fnList.forEach((fn, fi) => {
        const date = fn.date || eo.date;
        if (!date) return;
        const venue = typeof fn.venue === "string" ? fn.venue : (fn.venue?.name || (typeof eo.venue === "string" ? eo.venue : eo.venue?.name) || "");
        events.push({
          id: "eo-" + eo.id + "-" + fi, date,
          guestName: eo.clientName || "—", functionType: fn.type || "", venue,
          dept: "studio", totalAmt: eo.totalCost || 0, balance: 0, eoStatus: eo.status || "pending",
        });
      });
    }
    return events;
  }, [eventOrders]);

  const allEvents = useMemo(() => [...calEvents, ...studioEvents], [calEvents, studioEvents]);

  function eventsOnDate(d) { return allEvents.filter((e) => e.date === dateStr(d)); }
  const selEvents = selDate ? allEvents.filter((e) => e.date === selDate) : [];
  const monthEvents = allEvents.filter((e) => {
    const parts = (e.date || "").split("-");
    return parseInt(parts[0]) === year && parseInt(parts[1]) === month + 1;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }} className="px-3 py-2 border rounded-lg hover:bg-gray-50">←</button>
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-900">{MONTHS[month]} {year}</h2>
          <p className="text-xs text-gray-500">
            {monthEvents.length} events this month
            <span> · {lmsContracts?.length || 0} LMS contracts synced</span>
            {hasCats && <span> · {Object.keys(dateCategories).length} dates categorised</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSyncLms} disabled={lmsSyncing}
            className={"px-3 py-2 border rounded-lg text-xs font-semibold " + (lmsSyncing ? "bg-gray-100 text-gray-400" : "hover:bg-indigo-50 text-indigo-600 border-indigo-200")}>
            {lmsSyncing ? "⏳ Syncing…" : "🔄 Sync LMS"}
          </button>
          <button onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }} className="px-3 py-2 border rounded-lg hover:bg-gray-50">→</button>
        </div>
      </div>

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {DAYS.map((d) => <div key={d} className="text-center text-xs font-semibold text-gray-500 py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstDay }).map((_, i) => <div key={"e" + i} className="min-h-16 border-b border-r bg-gray-50" />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = dateStr(d);
            const evts = eventsOnDate(d);
            const isToday = ds === today;
            const isSel = ds === selDate;
            const cat = getDateCategory(ds);
            const catStyle = cat && dateCatColors[cat] ? dateCatColors[cat] : null;
            const override = marked[ds];
            return (
              <div key={d} onClick={() => setSelDate(isSel ? null : ds)}
                className={"min-h-16 border-b border-r p-1 cursor-pointer transition-colors relative " + (isToday ? "bg-indigo-50" : " hover:bg-gray-50") + (isSel ? " ring-2 ring-inset ring-indigo-400" : "")}
                style={catStyle && !isToday ? { background: catStyle.bg, borderBottomColor: catStyle.border } : undefined}>
                {override && <span className="absolute top-1 right-1 text-[10px]" title={`Pricing manually overridden as ${DATE_PRICING_LABELS[override]}`}>📌</span>}
                <div className="flex items-center gap-1 mb-1">
                  <span className={"text-xs font-medium " + (isToday ? "bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center" : "text-gray-700")}>{d}</span>
                  {catStyle && <span style={{ fontSize: 9, color: catStyle.text, fontWeight: 700 }}>{catStyle.label}</span>}
                  {evts.length > 0 && <span className="text-xs font-bold text-indigo-500 ml-auto">{evts.length}</span>}
                </div>
                {evts.slice(0, 3).map((e) => (
                  <div key={e.id} className={"text-xs px-1 py-0.5 rounded mb-0.5 truncate " + (e.dept === "studio" ? "bg-purple-100 text-purple-800" : e.dept === "venue" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800")}>
                    {e.guestName}
                  </div>
                ))}
                {evts.length > 3 && <div className="text-xs text-gray-400 px-1">+{evts.length - 3} more</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-200 inline-block" /> Venue Contract</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 inline-block" /> Decor Contract</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200 inline-block" /> 🎭 Studio Booking</span>
        {hasCats && <>
          <span className="text-gray-300">|</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: "#fef2f2", border: "1px solid #fca5a5" }} /> 👑 King's</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: "#fefce8", border: "1px solid #fde047" }} /> ✦ Perfect</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: "#f0fdf4", border: "1px solid #86efac" }} /> ○ Normal</span>
          <span className="flex items-center gap-1 text-gray-400">Unlisted = Filler</span>
        </>}
      </div>

      {selDate && (
        <div className="bg-white border rounded-2xl p-5">
          <h3 className="font-semibold text-gray-800 mb-3">
            {selDate} — {selEvents.length} event(s)
            {getDateCategory(selDate) && (
              <span className="ml-2 text-sm font-semibold px-2 py-0.5 rounded-md"
                style={dateCatColors[getDateCategory(selDate)] ? { background: dateCatColors[getDateCategory(selDate)].bg, color: dateCatColors[getDateCategory(selDate)].text } : {}}>
                {dateCatColors[getDateCategory(selDate)]?.label || getDateCategory(selDate)}
              </span>
            )}
          </h3>
          {settings && setSettings && (() => {
            const manualKey = marked[selDate];
            const dp = settings.datePricing || SETTINGS_DEFAULTS.datePricing;
            const effectiveKey = resolveDateCategory(selDate, settings);
            return (
              <div className="mb-4 pb-4 border-b flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-500">💰 Pricing:</span>
                {Object.keys(dp.categories || {}).map((key) => (
                  <button key={key} onClick={() => setDateCategory(selDate, manualKey === key ? null : key)}
                    className={"text-xs px-2.5 py-1 rounded-lg font-semibold border transition-all " + (manualKey === key ? `ring-2 ring-offset-1 ${PRICING_CAT_STYLES[key]} ring-current` : `${PRICING_CAT_STYLES[key]} opacity-60 hover:opacity-100`)}>
                    {DATE_PRICING_LABELS[key]}
                  </button>
                ))}
                {manualKey ? (
                  <button onClick={() => setDateCategory(selDate, null)} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear override (use auto)</button>
                ) : (
                  <span className="text-xs text-gray-400">Auto: {DATE_PRICING_LABELS[effectiveKey]}</span>
                )}
              </div>
            );
          })()}
          {selEvents.length === 0 ? <p className="text-sm text-gray-400 italic">No events on this date</p>
            : selEvents.map((e) => (
              <div key={e.id} className="border rounded-xl p-3 mb-2" style={{ borderLeft: "4px solid " + (e.dept === "studio" ? "#a855f7" : e.dept === "venue" ? "#6366f1" : "#f59e0b") }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{e.guestName}</span>
                    <span className={"text-xs px-2 py-0.5 rounded-md font-semibold " + (e.dept === "studio" ? "bg-purple-50 text-purple-700" : e.dept === "venue" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700")}>
                      {e.dept === "studio" ? "🎭 Studio Booking" : e.dept === "venue" ? "🏛 Venue" : "🎨 Decor"}
                    </span>
                    {e.eoStatus && <span className="text-xs px-2 py-0.5 rounded-md font-semibold bg-gray-100 text-gray-600 capitalize">{e.eoStatus}</span>}
                    {e.priority && <span className="text-xs px-2 py-0.5 rounded-md font-semibold bg-yellow-50 text-yellow-700">{e.priority}</span>}
                    {e.matched && <span className="text-xs px-2 py-0.5 rounded-md font-bold bg-green-50 text-green-700">🔗 {e.matchType === "exact" ? "Exact" : "Fuzzy"}</span>}
                  </div>
                  {e.entryNo && <span className="text-xs text-gray-400">#{e.entryNo}</span>}
                </div>
                <div className="flex gap-3 flex-wrap text-sm text-gray-600 mt-1">
                  {e.brideName && e.groomName && <span>💑 {e.brideName.trim()} × {e.groomName.trim()}</span>}
                  {e.functionType && <span>🎉 {e.functionType}</span>}
                  {e.functionTime && <span>⏰ {e.functionTime}</span>}
                  {e.session && <span>({e.session})</span>}
                  {e.venue && <span>📍 {e.venue}</span>}
                  {e.locationName && <span>🗺 {e.locationName}</span>}
                  {e.leadType && <span>{e.leadType === "I" ? "🏠 In-house" : "🌍 Outdoor"}</span>}
                  {e.pax > 0 && <span>👥 {e.pax} pax</span>}
                </div>
                <div className="flex gap-4 text-xs text-gray-500 mt-2">
                  <span>Total: <b className="text-gray-800">{fmtAmt(e.totalAmt)}</b></span>
                  <span>Bal: <b className={e.balance > 0 ? "text-red-600" : "text-green-600"}>{fmtAmt(e.balance)}</b></span>
                  {e.decorLumpsum > 0 && <span>Decor: <b className="text-purple-600">{fmtAmt(e.decorLumpsum)}</b></span>}
                </div>
              </div>
            ))}
        </div>
      )}

      {settings && setSettings && (
        <div className="mt-6">
          <button onClick={() => setShowDatePricing(!showDatePricing)} className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            {showDatePricing ? "▼" : "▶"} Date Pricing Config
          </button>
          {showDatePricing && <div className="mt-3"><DatePricingPanel settings={settings} setSettings={setSettings} /></div>}
        </div>
      )}
    </div>
  );
}

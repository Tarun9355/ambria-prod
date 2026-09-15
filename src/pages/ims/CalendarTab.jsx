import { useState, useMemo } from "react";
import DatePricingPanel from "./DatePricingPanel.jsx";
import { resolveDateCategory } from "../../lib/inventory/helpers";
import { DATE_PRICING_LABELS, SETTINGS_DEFAULTS } from "../../lib/ims/constants";
import { PRICING_CAT_STYLES } from "../../lib/inventory/constants";
import { releaseBlocks } from "../../lib/ims/eventAutoConfirm";

// Faithful copy of the reference IMS CalendarTab — renders LMS/ERP contracts on a
// month grid, colour-codes dates by Studio category, and exposes Date Pricing config.
// Also the one place ops can cancel a Studio-booked event (releasing its held inventory) — the
// old dedicated IMS "Events" tab is gone; that was its only manual control worth keeping.
export default function CalendarTab({ lmsContracts, studioLmsCache, onSyncLms, lmsSyncing, settings, setSettings, eventOrders, setEventOrders, saveEventOrders, blocks, setBlocks, saveBlocks }) {
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

  // Cancel a Studio-booked event: releases every inventory item it's holding and marks the
  // event_orders row cancelled. This is the only surviving manual control from the old Events tab.
  function cancelStudioEvent(eoId, guestName) {
    if (!eoId || !setEventOrders || !setBlocks) return;
    if (!confirm(`Cancel booking for "${guestName}" and release all its held inventory?`)) return;
    const newBlocks = releaseBlocks(blocks, eoId);
    setBlocks(newBlocks);
    saveBlocks?.(newBlocks);
    const updated = (eventOrders || []).map((eo) => (eo.id === eoId ? { ...eo, status: "cancelled" } : eo));
    setEventOrders(updated);
    saveEventOrders?.(updated);
  }

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
            // Who raised the lead in LMS. It was resolved during the sync and then dropped here,
            // so the day list showed the client but never the salesperson to chase about them.
            entryByName: c.entryByName || "",
            // An LMS/CRM contract is not itself plannable — Dept Ops works off event_orders.
            // But the sync already resolves each contract to a Studio deal where one exists, so
            // a MATCHED contract can open the deal it belongs to. Unmatched ones genuinely have
            // nothing on the other end.
            eoId: c.matchedEoId || null,
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
          dept: "studio", totalAmt: eo.dealValue?.amount ?? eo.totalCost ?? 0, balance: 0, eoStatus: eo.status || "pending",
          eoId: eo.id,
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
      {/* ── HEADER ──
          Month and stats read left-to-right instead of being centred between two buttons: the
          month name is the heading of everything below it, and a centred heading with controls
          either side reads as a toolbar. Nav and Sync group on the right, where the actions are. */}
      <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight leading-tight">{MONTHS[month]} {year}</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {monthEvents.length} events this month
            {/* Which of them are Studio deals, i.e. the ones Planning can actually open. Most
                months are all LMS leads, and without this you have to click a card to find that
                out — the count says it before you look. */}
            {(() => {
              const n = monthEvents.filter((e) => e.dept === "studio").length;
              return <span className={n > 0 ? " text-purple-600 font-semibold" : ""}> · {n} Studio booking{n === 1 ? "" : "s"}</span>;
            })()}
            <span> · {lmsContracts?.length || 0} LMS contracts synced</span>
            {hasCats && <span> · {Object.keys(dateCategories).length} dates categorised</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onSyncLms} disabled={lmsSyncing}
            className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition " + (lmsSyncing ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100")}>
            {lmsSyncing ? "⏳ Syncing…" : "🔄 Sync LMS"}
          </button>
          {/* Square targets with a hover ground, not bare glyphs: these were ~14px of text with
              only horizontal padding, which on a touch screen is a guess. */}
          <div className="flex items-center gap-1">
            <button onClick={() => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }}
              title="Previous month" aria-label="Previous month"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition">←</button>
            <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
              title="Jump to this month" aria-label="Jump to this month"
              className="px-2.5 h-8 rounded-lg text-[11px] font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition">Today</button>
            <button onClick={() => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }}
              title="Next month" aria-label="Next month"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition">→</button>
          </div>
        </div>
      </div>

      {/* ── MONTH GRID ──
          gap-px over a grey ground instead of a border on every cell. The old grid drew
          border-b/border-r per cell, which double-weights every interior line, leaves the last
          column and row unmatched, and fought the date-category background colours — those set
          borderBottomColor, so a tinted day had a different rule under it than beside it.
          One ground colour showing through the gaps gives an even hairline everywhere and lets a
          cell's background be purely its own. */}
      <div className="bg-white rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAYS.map((d, i) => (
            <div key={d} className={"text-center text-[10px] font-bold uppercase tracking-[0.1em] py-3 " + (i === 0 || i === 6 ? "text-gray-400" : "text-gray-500")}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-100">
          {Array.from({ length: firstDay }).map((_, i) => <div key={"e" + i} className="min-h-[104px] bg-gray-50/70" />)}
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
                role="button" tabIndex={0}
                onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSelDate(isSel ? null : ds); } }}
                title={`${ds}${evts.length ? ` — ${evts.length} event(s)` : ""}`}
                className={"min-h-[104px] p-2 cursor-pointer transition-colors relative bg-white hover:bg-gray-50/80 " + (isToday ? "bg-indigo-50/60 hover:bg-indigo-50" : "") + (isSel ? " ring-2 ring-inset ring-indigo-500 z-10" : "")}
                style={catStyle && !isToday ? { background: catStyle.bg } : undefined}>
                {override && <span className="absolute bottom-1.5 right-1.5 text-[10px] leading-none" title={`Pricing manually overridden as ${DATE_PRICING_LABELS[override]}`}>📌</span>}
                {/* The number owns the left, the day's marks own the right. Previously the
                    category label sat immediately after the number, so the two ran together and
                    the date — the one thing you scan a calendar for — stopped being findable. */}
                <div className="flex items-start justify-between gap-1 mb-2">
                  <span className={"tabular-nums leading-none " + (isToday ? "bg-indigo-600 text-white text-[12px] font-bold rounded-full w-[22px] h-[22px] flex items-center justify-center -mt-0.5 -ml-0.5" : "text-[13px] font-semibold text-gray-700")}>{d}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {catStyle && (
                      <span className="text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        style={{ color: catStyle.text, background: "rgba(255,255,255,0.75)" }}>{catStyle.label}</span>
                    )}
                    {evts.length > 0 && (
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded-full min-w-[17px] h-[17px] px-1 flex items-center justify-center tabular-nums leading-none">{evts.length}</span>
                    )}
                  </span>
                </div>
                <div className="space-y-1">
                  {evts.slice(0, 3).map((e) => (
                    /* A left bar plus a faint wash of the same hue. The bar alone left the chip
                       floating on whatever the cell's background happened to be; a full saturated
                       tint (the original) turned three stacked events into a block of noise and
                       buried the date-category colour underneath. */
                    <div key={e.id} title={e.guestName}
                      className={"text-[11px] font-medium leading-tight pl-2 pr-1.5 py-1 rounded-md truncate border-l-[3px] " + (e.dept === "studio" ? "border-purple-500 bg-purple-50/80 text-purple-900" : e.dept === "venue" ? "border-indigo-500 bg-indigo-50/80 text-indigo-900" : "border-amber-500 bg-amber-50/80 text-amber-900")}>
                      {e.guestName}
                    </div>
                  ))}
                  {evts.length > 3 && <div className="text-[10px] font-semibold text-gray-400 pl-2 pt-0.5">+{evts.length - 3} more</div>}
                </div>
              </div>
            );
          })}
          {/* Trailing blanks so the month closes into a rectangle. Without them the grid's own
              grey ground showed through the rest of the final week, which read as a broken cell
              rather than as "the month ended here". */}
          {Array.from({ length: (7 - ((firstDay + daysInMonth) % 7)) % 7 }).map((_, i) => (
            <div key={"t" + i} className="min-h-[104px] bg-gray-50/70" />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] px-4 py-2.5 flex gap-x-4 gap-y-2 flex-wrap items-center text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-4 rounded-sm bg-indigo-500 inline-block" /> Venue Contract</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-4 rounded-sm bg-amber-500 inline-block" /> Decor Contract</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-4 rounded-sm bg-purple-500 inline-block" /> 🎭 Studio Booking</span>
        {hasCats && <>
          <span className="w-px h-4 bg-gray-200" />
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded inline-block" style={{ background: "#fef2f2", border: "1px solid #fca5a5" }} /> 👑 King&apos;s</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded inline-block" style={{ background: "#fefce8", border: "1px solid #fde047" }} /> ✦ Perfect</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded inline-block" style={{ background: "#f0fdf4", border: "1px solid #86efac" }} /> ○ Normal</span>
          <span className="text-gray-400">Unlisted = Filler</span>
        </>}
      </div>

      {selDate && (
        <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
          {/* Header, pricing and events as three tiers of one panel rather than one padded box
              with rules drawn between them — same shape as the readouts on the Dept Ops page. */}
          <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">Selected date</div>
              <h3 className="mt-0.5 text-base font-bold text-gray-900 tracking-tight flex items-center gap-2 flex-wrap">
                {selDate}
                <span className="text-xs font-medium text-gray-500">{selEvents.length} event{selEvents.length === 1 ? "" : "s"}</span>
                {getDateCategory(selDate) && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                    style={dateCatColors[getDateCategory(selDate)] ? { background: dateCatColors[getDateCategory(selDate)].bg, color: dateCatColors[getDateCategory(selDate)].text } : {}}>
                    {dateCatColors[getDateCategory(selDate)]?.label || getDateCategory(selDate)}
                  </span>
                )}
              </h3>
            </div>
            {/* The grid deselects on a second click, but only if you remember which cell — an
                explicit close is quicker than hunting for it. */}
            <button onClick={() => setSelDate(null)} aria-label="Close selected date"
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition">✕</button>
          </div>
          {settings && setSettings && (() => {
            const manualKey = marked[selDate];
            const dp = settings.datePricing || SETTINGS_DEFAULTS.datePricing;
            const effectiveKey = resolveDateCategory(selDate, settings);
            return (
              <div className="px-4 py-2.5 bg-gray-50 border-y border-gray-100 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">💰 Pricing</span>
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
          <div className="p-4 space-y-2">
          {selEvents.length === 0 ? <p className="text-sm text-gray-400 text-center py-6">No events on this date</p>
            : selEvents.map((e) => {
              // The "Open in Planning" link that used to sit on these cards is gone. Planning
              // has its own month picker now, listing exactly the sold events it can plan, so
              // the cross-link duplicated a shorter route. These cards are back to what the
              // Calendar is for: reading what is booked on a date.
              return (
              <div key={e.id}
                className="rounded-xl p-3 bg-gray-50/70"
                style={{ borderLeft: "4px solid " + (e.dept === "studio" ? "#a855f7" : e.dept === "venue" ? "#6366f1" : "#f59e0b") }}>
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
                  <div className="flex items-center gap-2">
                    {e.entryNo && <span className="text-xs text-gray-400">#{e.entryNo}</span>}
                    {/* Shown at rest, not on hover. A card that only reveals it is clickable
                        once the cursor is already on it is a card nobody discovers — and on a
                        touch screen there is no hover at all, so it would never appear.
                        The unopenable case states the reason for the same purpose: "my click
                        did nothing" is the reading otherwise, and every reason here is fixable
                        (run Sync LMS, or mark the deal sold). */}
                    {/* The card no longer navigates, so Cancel needs no stopPropagation guard. */}
                    {e.dept === "studio" && e.eoStatus !== "cancelled" && (
                      <button onClick={() => cancelStudioEvent(e.eoId, e.guestName)}
                        className="text-xs px-2 py-1 rounded-md font-medium text-red-600 border border-red-200 hover:bg-red-50">
                        ✕ Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-x-3 gap-y-1 flex-wrap text-[13px] text-gray-600 mt-1.5">
                  {e.entryByName && <span title="Who raised this lead in LMS">🧑‍💼 {e.entryByName}</span>}
                  {e.brideName && e.groomName && <span>💑 {e.brideName.trim()} × {e.groomName.trim()}</span>}
                  {e.functionType && <span>🎉 {e.functionType}</span>}
                  {e.functionTime && <span>⏰ {e.functionTime}</span>}
                  {e.session && <span>({e.session})</span>}
                  {e.venue && <span>📍 {e.venue}</span>}
                  {e.locationName && <span>🗺 {e.locationName}</span>}
                  {e.leadType && <span>{e.leadType === "I" ? "🏠 In-house" : "🌍 Outdoor"}</span>}
                  {e.pax > 0 && <span>👥 {e.pax} pax</span>}
                </div>
                <div className="flex gap-4 text-[11px] text-gray-500 mt-2 tabular-nums">
                  <span>Total: <b className="text-gray-800">{fmtAmt(e.totalAmt)}</b></span>
                  <span>Bal: <b className={e.balance > 0 ? "text-red-600" : "text-emerald-600"}>{fmtAmt(e.balance)}</b></span>
                  {e.decorLumpsum > 0 && <span>Decor: <b className="text-purple-600">{fmtAmt(e.decorLumpsum)}</b></span>}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {settings && setSettings && (
        <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
          <button onClick={() => setShowDatePricing(!showDatePricing)}
            className="w-full px-4 py-3 flex items-center gap-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition text-left">
            <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-base leading-none">💰</span>
            <span className="flex-1">Date Pricing Config</span>
            <span aria-hidden="true" className={"shrink-0 text-gray-400 text-xs transition-transform " + (showDatePricing ? "rotate-90" : "")}>▸</span>
          </button>
          {showDatePricing && <div className="px-4 pb-4 border-t border-gray-100 pt-4"><DatePricingPanel settings={settings} setSettings={setSettings} /></div>}
        </div>
      )}
    </div>
  );
}

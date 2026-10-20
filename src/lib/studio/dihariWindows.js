// ═══ Dihari shift windows for an event day ═══
// A crew type's shifts for a day come from IMS's per-phase defaults (defaultWindowsByPhase) —
// e.g. Labours on an event day = 9 AM–5 PM + 5 PM–12. Those defaults know nothing about WHEN the
// day's functions start, so a 9 AM Mata ki Chowki got a first shift starting at 9 AM: the crew
// would arrive as the guests do, with no time to set up. withSetupSlot adds the shift that ends
// right before the day's first function whenever none of the chosen shifts starts before it.

// Same start hours IMS Dept Ops shows in its function headers ("Morning · 9 AM").
export const SHIFT_START_HOUR = { brunch: 11, morning: 9, lunch: 12, sundowner: 16, evening: 18, dinner: 20, night: 20, latenight: 22, "late night": 22 };

// "9 AM – 5 PM" → { start: 9, end: 17 }; "12 AM - 9 AM" → { start: 0, end: 9 }. null if no time.
export const slotHours = (label) => {
  const m = [...String(label || "").matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)].map(x => (Number(x[1]) % 12) + (x[3].toUpperCase() === "PM" ? 12 : 0) + (Number(x[2]) || 0) / 60);
  return m.length ? { start: m[0], end: m.length > 1 ? m[1] : null } : null;
};

// Start hour of the day's earliest function, from each function's shift name; null if none known.
export const firstFnStartHour = (dayFns) => {
  const hrs = (dayFns || []).map(f => SHIFT_START_HOUR[String(f?.fnShift ?? f?.shift ?? "").trim().toLowerCase()]).filter(h => typeof h === "number");
  return hrs.length ? Math.min(...hrs) : null;
};

// winIds: the shifts chosen for the day; windowDefs: that crew type's [{ id, label }] list.
// Returns winIds unchanged when the first function's time is unknown, when a chosen shift already
// starts before it, or when no shift ends before it; otherwise the setup shift + winIds.
export const withSetupSlot = (winIds, windowDefs, dayFns) => {
  const ids = Array.isArray(winIds) ? winIds : [];
  const fnStart = firstFnStartHour(dayFns);
  if (fnStart == null || !ids.length) return ids;
  const defs = Array.isArray(windowDefs) ? windowDefs : [];
  const hoursOf = (id) => slotHours(defs.find(w => w.id === id)?.label);
  if (ids.some(id => { const h = hoursOf(id); return h && h.start < fnStart; })) return ids;
  // The shift ending closest to (at or before) the function start, on the same day — an overnight
  // shift (end before start, e.g. "5 PM – 12") belongs to the night before, so it doesn't count.
  let best = null;
  defs.forEach(w => {
    if (ids.includes(w.id)) return;
    const h = slotHours(w.label);
    if (!h || h.end == null || h.end <= h.start || h.start >= fnStart || h.end > fnStart) return;
    if (!best || h.end > best.end) best = { id: w.id, end: h.end };
  });
  return best ? [best.id, ...ids] : ids;
};

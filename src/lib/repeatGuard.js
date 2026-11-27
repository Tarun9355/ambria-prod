// Is a ♻ Repeat backed by a setup that is actually standing at the venue? (owner ask 2026-11-27, venue audit #2)
// A zone / item marked Repeat is billed at the Repeat discount and loads nothing - it trusts that the setup is already up. That holds only
// when something was set up at the SAME venue just before: an earlier function of this booking there (the same day, earlier in the day,
// or the day before), or another event at that venue on the same day or the day before (back-to-back bookings at a fixed venue).
// Amit Gulati: Exotica on the 27th, Pushpanjali on the 28th marked Repeat - nothing stood at Pushpanjali, so its furniture would never load.
// fns: this booking's functions [{ venue, date, shift }]; others: other live events' functions [{ venue, date }].
// Returns a Set of the indexes (into fns) whose Repeat is backed.
import { venueKey } from "./venueKey.js";

const SHIFT_RANK = { morning: 0, brunch: 1, lunch: 2, sundowner: 3, evening: 4, dinner: 5, night: 6, "late night": 7, latenight: 7 };
const shiftRank = (s) => { const r = SHIFT_RANK[String(s || "").trim().toLowerCase()]; return r == null ? 9 : r; };
const dayOf = (d) => { const t = Date.parse(String(d || "").slice(0, 10)); return Number.isFinite(t) ? Math.round(t / 86400000) : null; };

export function repeatBackedFns(fns, others = []) {
  const list = Array.isArray(fns) ? fns : [];
  const out = new Set();
  list.forEach((f, i) => {
    const v = venueKey(f?.venue || ""), d = dayOf(f?.date);
    if (!v || d == null) { out.add(i); return; } // no venue or date to check against: not second-guessed
    const fromBooking = list.some((g, j) => {
      if (j === i || venueKey(g?.venue || "") !== v) return false;
      const gd = dayOf(g?.date);
      if (gd == null) return false;
      if (d - gd === 1) return true;
      if (d === gd) { const a = shiftRank(g?.shift), b = shiftRank(f?.shift); return a < b || (a === b && j < i); }
      return false;
    });
    const fromOther = (others || []).some((g) => venueKey(g?.venue || "") === v && dayOf(g?.date) != null && (d - dayOf(g.date) === 0 || d - dayOf(g.date) === 1));
    if (fromBooking || fromOther) out.add(i);
  });
  return out;
}

// IMS shape: an event order's functions and the other live events' functions.
export function repeatBackedOfEvent(sel, eventOrders, isLive = (eo) => eo?.status !== "cancelled") {
  const fns = (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).map((f) => ({ venue: f?.venue || sel?.venue, date: f?.date || sel?.date, shift: f?.shift || sel?.shift }));
  const others = [];
  (eventOrders || []).forEach((eo) => {
    if (!eo || eo.id === sel?.id || !isLive(eo)) return;
    const efs = Array.isArray(eo.functionsDetail) && eo.functionsDetail.length ? eo.functionsDetail : [{ venue: eo.venue, date: eo.date }];
    efs.forEach((f) => others.push({ venue: f?.venue || eo.venue, date: f?.date || eo.date }));
  });
  return repeatBackedFns(fns, others);
}

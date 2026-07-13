// ─── Shared manpower situational-multiplier computations ──────────────────────
// Extracted from ManpowerTab.jsx (the standalone Planning → Manpower tab, being
// decommissioned) so Deal Check (Studio) and Dept Ops (IMS) can show the exact
// same factor breakdown without duplicating the formulas. Pure data functions —
// no JSX, no state writes. Behavior must stay identical to the original inline
// versions; if a displayed number ever differs, that's a bug here, not a redesign.
import { EVENT_TIMINGS, DUMPING_LEVELS, SIT_MULT_DEFAULTS, eventTimingMultFor } from "./constants";
import { resolveDateCategory } from "../inventory/helpers";
import { heavyElementExtraForFn } from "./fixedVenues";

export function getEventTimingFromTime(timeStr) {
  if (!timeStr) return EVENT_TIMINGS[3]; // default dinner
  const [h, m] = (timeStr || "19:00").split(":").map(Number);
  const hour = h + (m || 0) / 60;
  for (const t of EVENT_TIMINGS) { if (hour < t.beforeHour) return t; }
  return EVENT_TIMINGS[4];
}

// Generic situational-multiplier system — every crew type EXCEPT Tier 3 (which has
// its own venue-min-based derivation, see computeTier3Trace below) and Supervisors/
// Drivers (exempt). Verbatim port of ManpowerTab.jsx's original inline function.
export function applySituationalMultipliers(baseQty, type, { fn, proj, settings }) {
  if (type === "Supervisors" || type === "Drivers") return { adjusted: baseQty, rawMult: 1, capped: false, factors: [] };
  const sm = settings.situationalMultipliers || {};
  const cap = settings.situationalMultiplierCap || 1.8;
  const factors = [];

  // Factor 1 — Date Category (only Heavy Saya pushes up, others 1.0)
  let dateMult = 1.0;
  const fnDate = fn?.date || "";
  const dateCategory = resolveDateCategory(fnDate, settings);
  if (dateCategory === "heavy_saya") {
    dateMult = (sm.heavySaya || {})[type] || SIT_MULT_DEFAULTS.heavySaya[type] || 1.0;
    factors.push({ label: "👑 King's", mult: dateMult });
  } else {
    factors.push({ label: dateCategory === "non_saya" ? "○ Filler" : "✦ Perfect", mult: 1.0 });
  }

  // Factor 2 — Event Segment (only Premium pushes up, others 1.0)
  let segMult = 1.0;
  const segment = proj?.segment || "outdoor_budgeted";
  if (segment === "outdoor_premium") {
    segMult = (sm.premium || {})[type] || SIT_MULT_DEFAULTS.premium[type] || 1.0;
    factors.push({ label: "★ Premium", mult: segMult });
  } else {
    factors.push({ label: segment === "inhouse" ? "🏠 In-house" : "$ Budgeted", mult: 1.0 });
  }

  // Factor 3 — Setup Timing (day-prior can go below, rush goes above)
  let timingMult = 1.0;
  const setupAccess = fn?.setupAccess || "same_day";
  const dayPriorConfirmed = setupAccess === "day_prior_confirmed";
  const dayPriorTentative = setupAccess === "day_prior_tentative";
  const bookingDays = fn?.date ? Math.ceil((new Date(fn.date) - new Date()) / (1000 * 60 * 60 * 24)) : 999;
  const isRush = bookingDays <= (settings.datePricing?.lastMinuteDays || 10) && bookingDays >= 0;
  if (dayPriorConfirmed) {
    timingMult = (sm.dayPrior || {})[type] || SIT_MULT_DEFAULTS.dayPrior[type] || 1.0;
    factors.push({ label: "📅 Day-Prior ✓", mult: timingMult });
  } else if (isRush && !dayPriorTentative) {
    timingMult = (sm.rush || {})[type] || SIT_MULT_DEFAULTS.rush[type] || 1.0;
    factors.push({ label: "⚡ Rush", mult: timingMult });
  } else {
    factors.push({ label: dayPriorTentative ? "🟡 Tentative (calc as same-day)" : "📅 Same-Day", mult: 1.0 });
  }

  // Factor 4 — Event Timing (lunch/brunch/sundowner): tighter setup window multiplies
  // ALL manpower types. Skipped on day-prior confirmed (extra day removes the pressure).
  let evtTimingMult = 1.0;
  if (!dayPriorConfirmed) {
    const ev = getEventTimingFromTime(fn?.eventStartTime);
    evtTimingMult = eventTimingMultFor(settings.eventTimingMultipliers, ev.id, type, ev.mult || 1.0);
    if (evtTimingMult !== 1.0) factors.push({ label: `⏰ ${ev.label || ev.id}`, mult: evtTimingMult });
  }

  const rawMult = dateMult * segMult * timingMult * evtTimingMult;
  const cappedMult = Math.min(rawMult, cap);
  const wasCapped = rawMult > cap;
  const adjusted = Math.max(1, Math.ceil(baseQty * cappedMult));
  // If tentative, calculate what day-prior would give
  let tentativeSavings = null;
  if (dayPriorTentative) {
    const dpMult = (sm.dayPrior || {})[type] || SIT_MULT_DEFAULTS.dayPrior[type] || 1.0;
    const dpRaw = dateMult * segMult * dpMult;
    const dpCapped = Math.min(dpRaw, cap);
    const dpAdj = Math.max(1, Math.ceil(baseQty * dpCapped));
    if (dpAdj < adjusted) tentativeSavings = { ifConfirmed: dpAdj, saving: adjusted - dpAdj };
  }
  return { adjusted, rawMult: parseFloat(rawMult.toFixed(3)), cappedMult: parseFloat(cappedMult.toFixed(3)), capped: wasCapped, factors, cap, tentativeSavings };
}

// Tier-3 (venue-baseline) derivation — Labours/Carpenters/Painters/Electricians/Truss
// Labour's own factor system: venue minimum × event-segment layer × the SINGLE highest
// situational pressure (dumping / saya / event-timing — NOT multiplicative, unlike the
// generic system above), plus heavy-element extras, MAXed across same-day siblings at
// the same venue. Verbatim port of ManpowerTab.jsx's inline Tier-3 breakdown block.
export function computeTier3Trace({ fn, proj, settings, inventory, fnList, crewType }) {
  const venueName = fn?.venue?.name || "";
  const venueConfig = (settings.venueMinLabour || {})[venueName];
  const venueMin = typeof venueConfig === "object" ? (venueConfig?.min || 4) : ((typeof venueConfig === "number" ? venueConfig : null) || settings.defaultMinLabour || 4);
  const dumpMult = typeof venueConfig === "object" ? (venueConfig?.dumping || 1.0) : 1.0;
  const segment = proj?.segment || "outdoor_budgeted";
  const eventMult = (settings.eventTypeMultipliers || {})[segment] || 1;
  const setupAccess = fn?.setupAccess || "same_day";
  const dayPrior = setupAccess === "day_prior_confirmed";
  const tentative = setupAccess === "day_prior_tentative";
  const base = Math.ceil(venueMin * eventMult);
  const season = (settings.seasonMap || {})[fn?.date || ""];
  const sayaMult = season === "kings" ? (settings.sayaMultiplier || 1.3) : 1.0;
  const fnTiming = getEventTimingFromTime(fn?.eventStartTime);
  const timingMult = eventTimingMultFor(settings.eventTimingMultipliers, fnTiming.id, crewType, fnTiming.mult);
  const timingLabel = fnTiming.label;
  const sitCandidates = dayPrior ? [1.0] : [dumpMult, sayaMult, timingMult];
  const sitMax = Math.max(...sitCandidates, 1.0);
  const sitWinner = dayPrior ? "none (day-prior ✓)" : sitMax === dumpMult && dumpMult > 1 ? "Dumping ×" + dumpMult : sitMax === sayaMult && sayaMult > 1 ? "Saya ×" + sayaMult : sitMax === timingMult && timingMult > 1 ? timingLabel + " ×" + timingMult : "none";
  const { total: heavyExtra, breakdown: heavyBreakdown } = heavyElementExtraForFn(fn, settings, inventory);
  const sameDayFns = (fnList || []).filter(f => f.date === fn?.date && (f.venue?.name || "") === venueName);
  return {
    venueName, venueMin, dumpMult, segment, eventMult, setupAccess, dayPrior, tentative, base,
    sayaMult, timingMult, timingLabel, sitMax, sitWinner, heavyExtra, heavyBreakdown, sameDayFns, fn,
  };
}

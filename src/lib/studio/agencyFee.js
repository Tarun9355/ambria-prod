// The Design & Management (agency) fee is one % of the whole deal. IMS (Admin → Settings) holds the house rate;
// a salesperson can set a different one for ONE deal, from the Event Information sidebar, anywhere from 0 up to
// AGENCY_FEE_MAX. Whatever is set there is the fee for every function of that deal, on every screen.
export const AGENCY_FEE_MAX = 25;
const FALLBACK_PCT = 20;

// A usable percentage, or null for "nothing set" (blank, missing, junk).
const asPct = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// What the house rate resolves to when IMS has none.
export const feePctOf = (v) => asPct(v) ?? FALLBACK_PCT;

// A typed or tapped value made valid for one deal: never below 0, never above the cap, at most one decimal.
// Returns null for blank/junk so "clear" and "typed nothing" mean the same thing: back to the house rate.
export const clampAgencyFeePct = (v) => {
  const n = asPct(v);
  if (n === null) return null;
  return Math.round(Math.min(n, AGENCY_FEE_MAX) * 10) / 10;
};

// The % this deal is billed at: its own, when it has one; otherwise the house rate.
export const dealAgencyFeePct = (dealPct, housePct) => {
  const own = clampAgencyFeePct(dealPct);
  return own !== null ? own : feePctOf(housePct);
};

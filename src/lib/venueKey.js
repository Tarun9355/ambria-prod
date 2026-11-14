// One venue-name normaliser, shared everywhere a "same venue?" comparison decides whether two
// functions physically compete for the same stock (bug 8, 2026-11-14 inventory-blocks audit).
// Before this, venue strings were compared three different ways across the codebase — some exact,
// some trimmed+lowercased — so "Pushpanjali" and "pushpanjali " (a stray trailing space) could read as
// the SAME venue in one check and a DIFFERENT venue in another, silently disagreeing about whether
// two same-day functions compete for one pool or draw from two.
//
// Deliberately NOT the same as lib/ims/fixedVenues.js's own `normVenue`/venueProperties.js's
// `normVenueName` — those strip a leading "Ambria " to match a configured Fixed Venue's own name,
// which is a different question ("is this the venue we have a standing stock allocation at?") from
// "are these two function rows describing the same physical place?". Do not merge them.
export const venueKey = (v) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase();

// A function's own venueKey, falling back to the FIRST function's venue when this one's own is blank
// (regression review, 2026-11-14): an "extra function" that never got its own venue explicitly
// overridden defaults to "" (StudioApp.jsx's allFunctionData memo: `ef.venue || ""`, never falling
// back to the main function's own venue) — for a deal where every function is genuinely at the one
// implicit main venue, that blank must not be treated as a SEPARATE venue of its own, competing for a
// separate stock pool from (or being summed against, in a per-date ledger) the main function. Only
// meaningful when `fns` is the FULL function list of one deal, fnIdx 0 = the main function — exactly
// what every caller here already receives (collectAllFunctionData()'s own output, or the equivalent
// `fnsToProcess`/`reqByFnIdx`-paired list a reconcile run processes).
export const fnVenueKey = (fn, fns) => venueKey(fn?.fnVenue) || venueKey(fns?.[0]?.fnVenue);

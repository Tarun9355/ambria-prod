// Venue labour/logistics config — the `venue_labour_config` TABLE (migration 042) consolidates two
// settings keys that were both independently keyed by the same real-world entity (a venue name)
// into one row per venue: `venueMinLabour` (a crew-count floor, read by eventAutoConfirm.js and
// FixedVenuesEditor.jsx) and `venueDumping` (dumping-point distance -> labour multiplier, read by
// manpowerCount.js). These helpers translate the row shape back into the exact two independently-
// keyed plain objects every consumer already expects, so none of that calc logic had to change.
// venueMinLabour's own per-venue `dumpingLevel` sub-field was dead (nothing ever read it — every
// live lookup went through venueDumping instead), so it's gone for good here.

export function assembleVenueMinLabourFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r.min_labour != null) out[r.venue_name] = { min: Number(r.min_labour) };
  });
  return out;
}

export function assembleVenueDumpingFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r.dumping_level) out[r.venue_name] = r.dumping_level;
  });
  return out;
}

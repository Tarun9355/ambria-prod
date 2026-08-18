// Shared by src/pages/ims/VenuesEditor.jsx and src/pages/ims/FixedVenuesEditor.jsx — both
// independently fetch the same Studio-owned venues row (see either file's top comment for why),
// and both need the identical migration run on it. See VENUE_MIGRATION_PLAN.md for the full plan
// this is Phase 1 of.
//
// Additive migration: stamp a stable id on every sub-venue + build/refresh the `properties[]`
// array from whatever `.parent` groupings exist today. `.parent` itself is never touched — every
// existing Studio consumer (Build, Deal Check, allInhouseGroups, venueParents, transport,
// min-labour, Browse's venue filter…) keeps reading it exactly as before. Idempotent: re-running
// on already-migrated data reuses the existing ids/properties rather than regenerating them, so
// whichever of the two panels loads first doing the actual persist is harmless either way.
export const genVenueId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function migrateVenues(raw) {
  const v = raw || {};
  const inhouse = (v.inhouse || []).map((sv) => ({ ...sv }));
  const properties = [];
  const idByParent = new Map(); // parent name -> property id
  (Array.isArray(v.properties) ? v.properties : []).forEach((p) => {
    if (p?.id && p?.name) { properties.push({ ...p }); idByParent.set(p.name, p.id); }
  });
  inhouse.forEach((sv) => {
    if (!sv.id) sv.id = genVenueId("iv");
    const parent = sv.parent && sv.parent !== "Custom" ? sv.parent : null;
    if (!parent) return;
    if (!idByParent.has(parent)) {
      const id = genVenueId("prop");
      idByParent.set(parent, id);
      properties.push({ id, name: parent, manager: sv.manager || "—", icon: sv.icon || "🏛️" });
    }
    sv.propertyId = idByParent.get(parent);
  });
  return { inhouse, outdoor: (v.outdoor || []).map((o) => ({ ...o })), properties };
}

// Same normalization fixedVenueFor (lib/ims/fixedVenues.js) uses to match a booking's venue name
// against a configured Fixed Venue — lowercase, strip a leading "Ambria ", trim.
export const normVenueName = (s) => String(s || "").toLowerCase().replace(/^ambria\s+/, "").trim();

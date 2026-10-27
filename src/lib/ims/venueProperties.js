// Shared by every venue-catalogue consumer: src/pages/ims/VenuesEditor.jsx,
// src/pages/ims/FixedVenuesEditor.jsx, src/pages/ims/ImsTransportPanel.jsx, and
// src/pages/studio/StudioApp.jsx.
//
// The venue catalogue lives in the `venues` TABLE (migration 036) — one row per property,
// sub-venue, or outdoor venue — instead of the single `ambria-v13-venues` settings blob every one
// of those used to independently fetch, modify, and save back WHOLE. That whole-blob-save pattern
// is exactly what caused two confirmed data-loss incidents (a property vanishing entirely; later,
// commission %/venue type silently reset) — see migration 036's own comment. Row-level
// insert/update/delete on `venues`, read directly everywhere (no settings-blob mirror at all any
// more), closes that bug class. assembleVenuesFromRows turns the table's rows into the LEGACY
// `{properties, inhouse, outdoor}` shape every consumer's existing code already expects, so none of
// their own downstream logic (allInhouseGroups, venueParents, transport, min-labour, Browse's venue
// filter, …) needed to change.
export const genVenueId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// venues-table rows -> the legacy blob shape. `parent` (a sub-venue's property NAME, the field
// every Studio consumer actually reads) is derived fresh from the property row's CURRENT name —
// never stored on the sub-venue row itself — so a property rename can never leave a stale name
// behind here the way the old blob's hand-maintained `.parent` string could.
export function assembleVenuesFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const properties = list.filter((r) => r.kind === "property").map((r) => ({
    id: r.id, name: r.name, manager: r.manager || "—", icon: r.icon || "🏛️",
    ...(r.commission_pct != null ? { commissionPct: Number(r.commission_pct) } : {}),
  }));
  const nameByPropId = new Map(properties.map((p) => [p.id, p.name]));
  const inhouse = list.filter((r) => r.kind === "subvenue").map((r) => ({
    id: r.id, name: r.name, propertyId: r.property_id || null,
    parent: r.property_id ? (nameByPropId.get(r.property_id) || null) : null,
    manager: r.manager || "", icon: r.icon || "",
    ...(r.label != null ? { label: r.label } : {}),
    ...(r.description != null ? { desc: r.description } : {}),
    ...(r.venue_type != null ? { type: r.venue_type } : {}),
    ...(r.base_price != null ? { base: Number(r.base_price) } : {}),
  }));
  const outdoor = list.filter((r) => r.kind === "outdoor").map((r) => ({
    id: r.id, name: r.name, empanelled: !!r.empanelled,
    ...(r.venue_type != null ? { type: r.venue_type } : {}),
    ...(r.commission_pct != null ? { commissionPct: Number(r.commission_pct) } : {}),
  }));
  return { properties, inhouse, outdoor };
}

// Same normalization fixedVenueFor (lib/ims/fixedVenues.js) uses to match a booking's venue name
// against a configured Fixed Venue — lowercase, strip a leading "Ambria ", trim.
export const normVenueName = (s) => String(s || "").toLowerCase().replace(/^ambria\s+/, "").trim();

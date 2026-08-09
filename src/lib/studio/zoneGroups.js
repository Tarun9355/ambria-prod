// ─── Zone photo groups ────────────────────────────────────────────────────────
// Hand-picked photos that lead a zone's strip on the Build page, keyed by zone AND by function:
// a Stage for a Sangeet and a Stage for a Wedding are not the same brief, so they don't share a
// group. Stored under ZONE_GROUPS_SK as
//
//   { [areaName]: { [functionType]: [libraryPhotoId, …] } }
//
// with the empty-string function meaning "any function".
//
// This is a curation layer over the `areasElements` tags, never a replacement: Build shows the
// group first and then the zone's remaining tagged photos, so dropping a photo from a group only
// demotes it. A grouped photo doesn't even have to carry the zone tag — putting it in the group is
// itself the statement that it belongs there.

/** The function key meaning "applies to every function". */
export const ANY_FN = "";

/**
 * Normalise a stored blob to the nested shape.
 * The first version of this feature stored a bare array per zone. Those become ANY_FN groups
 * rather than being discarded, so groups made before functions existed keep working everywhere.
 */
export function normaliseZoneGroups(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [zone, val] of Object.entries(raw)) {
    if (!zone) continue;
    if (Array.isArray(val)) {
      const ids = [...new Set(val.filter(Boolean))];
      if (ids.length) out[zone] = { [ANY_FN]: ids };
      continue;
    }
    if (!val || typeof val !== "object") continue;
    const byFn = {};
    for (const [fn, ids] of Object.entries(val)) {
      const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
      if (list.length) byFn[fn] = list;
    }
    if (Object.keys(byFn).length) out[zone] = byFn;
  }
  return out;
}

/**
 * The group that applies to `zone` for `fnType`.
 * A function-specific group REPLACES the any-function one rather than adding to it: if someone
 * bothered to curate this zone for Sangeet, that list is the answer for Sangeet, and quietly
 * appending the generic photos behind it would make the specific choice mean less than it says.
 */
export function groupIdsFor(zoneGroups, zone, fnType) {
  const byFn = zoneGroups?.[zone];
  if (!byFn) return [];
  const specific = fnType ? byFn[fnType] : null;
  if (specific?.length) return specific;
  return byFn[ANY_FN] || [];
}

/** Union of the groups that apply to any of `zones` for `fnType`, de-duped, order preserved. */
export function groupIdsForZones(zoneGroups, zones, fnType) {
  const out = [], seen = new Set();
  for (const z of zones || []) {
    for (const id of groupIdsFor(zoneGroups, z, fnType)) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

/** Write a zone+function list, dropping empties so the blob doesn't grow a key per zone opened. */
export function setGroupIds(zoneGroups, zone, fnType, ids) {
  const next = { ...(zoneGroups || {}) };
  const byFn = { ...(next[zone] || {}) };
  const list = [...new Set((ids || []).filter(Boolean))];
  if (list.length) byFn[fnType] = list; else delete byFn[fnType];
  if (Object.keys(byFn).length) next[zone] = byFn; else delete next[zone];
  return next;
}

/** How many (zone, function) pairs currently hold a group — the Grouping tab's badge count. */
export function countGroups(zoneGroups) {
  let n = 0;
  for (const byFn of Object.values(zoneGroups || {})) n += Object.values(byFn || {}).filter(l => l?.length).length;
  return n;
}

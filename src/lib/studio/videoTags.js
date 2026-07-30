// Row ⇄ app-shape adapter for the `video_tags` table (migration 023), mirroring the rowToRcItem /
// rowToItem pattern already used for rate_card and inventory.
//
// The app's in-memory shape is unchanged from the old `ambria-yt-tags-v1` blob: a map of
// videoId → tag object, with the same camelCase/underscore field names. That is deliberate — it
// means the ~20 call sites, videoStatus(), the Browse filters and the Deal Check readers all keep
// working untouched, and only the load/save plumbing moves to rows.

// Only fields that are actually set are emitted, so a tag object round-trips without gaining a pile
// of nulls that would make `Object.keys(tag).length` and the "has any tag?" checks misbehave.
const put = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; return o; };

export function rowToVideoTag(row) {
  if (!row) return null;
  const t = {};
  put(t, "venue", row.venue);
  if (row.venue_custom) t.venueCustom = true;
  put(t, "palette", row.palette);
  put(t, "tier", row.tier);
  put(t, "timeSetting", row.time_setting);
  put(t, "io", row.io);
  // Arrays/objects: only attach when non-empty. An empty array would read as "has tags" to some
  // callers that test `tag.fn` truthiness rather than length.
  if (Array.isArray(row.fn) && row.fn.length) t.fn = row.fn;
  if (Array.isArray(row.styles) && row.styles.length) t.styles = row.styles;
  if (Array.isArray(row.colors) && row.colors.length) t.colors = row.colors;
  if (row.zone_photos && Object.keys(row.zone_photos).length) t.zonePhotos = row.zone_photos;
  if (Array.isArray(row.linked_events) && row.linked_events.length) t.linkedEvents = row.linked_events;
  if (row.ai_tagged) t._aiTagged = true;
  if (row.verified) t._verified = true;
  put(t, "_verifiedBy", row.verified_by);
  put(t, "_verifiedAt", row.verified_at == null ? null : Number(row.verified_at));
  put(t, "_savedBy", row.saved_by);
  put(t, "_savedAt", row.saved_at == null ? null : Number(row.saved_at));
  put(t, "_lastEditedBy", row.last_edited_by);
  put(t, "_lastEditedAt", row.last_edited_at == null ? null : Number(row.last_edited_at));
  return t;
}

export function videoTagToRow(videoId, tag) {
  const t = tag || {};
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    video_id: videoId,
    venue: t.venue ?? null,
    venue_custom: t.venueCustom ?? null,
    palette: t.palette ?? null,
    tier: t.tier ?? null,
    time_setting: t.timeSetting ?? null,
    io: t.io ?? null,
    // `fn` is multi-select now but legacy records stored a bare string — normalise on the way in so
    // the column is always an array and the filters can stop special-casing it.
    fn: arr(t.fn),
    styles: arr(t.styles),
    colors: arr(t.colors),
    zone_photos: t.zonePhotos && typeof t.zonePhotos === "object" ? t.zonePhotos : {},
    linked_events: arr(t.linkedEvents),
    ai_tagged: !!t._aiTagged,
    verified: !!t._verified,
    verified_by: t._verifiedBy ?? null,
    verified_at: t._verifiedAt ?? null,
    saved_by: t._savedBy ?? null,
    saved_at: t._savedAt ?? null,
    last_edited_by: t._lastEditedBy ?? null,
    last_edited_at: t._lastEditedAt ?? null,
    updated_at: new Date().toISOString(),
  };
}

// rows → the { videoId: tag } map the app holds in state.
export function rowsToVideoTagMap(rows) {
  const out = {};
  for (const r of rows || []) { if (r?.video_id) out[r.video_id] = rowToVideoTag(r); }
  return out;
}

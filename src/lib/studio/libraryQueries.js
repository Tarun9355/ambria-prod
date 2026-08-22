// ═══ Studio library — Supabase query layer (server-side pagination) ═══
// The `library` table's typed columns (name/url/tags/elements/dims/linked_templates,
// plus status/tag_source/tagged_at — see migration 008) are kept in sync with the
// `data` JSONB catch-all (full item fidelity) on every write via libItemToRow below.
// Reads prefer `data` when present (full fidelity); light/paginated queries that don't
// select `data` fall back to the typed columns — see rowToLibItem.
import { supabase } from "../supabase";
import { libPhotoIsTagged } from "./taxonomy";

// One page of the Manage → Library grid. Also the pagination step: the grid shows exactly this many
// and you move between pages, rather than appending forever as you scroll.
export const LIBRARY_PAGE_SIZE = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Two INDEPENDENT dimensions on a library photo — deliberately NOT one combined enum (spec §9-D):
//
//   LIB_STATUS (lifecycle)   — where the photo is in the review pipeline. Mutually exclusive,
//                              covers every photo. COMPUTED (see computeLibStatus) and mirrored into
//                              the `status` column.
//   TAG_SOURCE (attribution) — HOW it got tagged. Optional and orthogonal to status; used only as an
//                              informational breakdown of the review pile. Stored in `tag_source`.
//
// They answer different questions ("is it reviewed yet?" vs "who/what tagged it?"). A photo can be
// status=review AND tag_source=manual at once; once a human verifies it, it's status=verified
// regardless of how it was originally tagged. computeLibStatus reads NONE of TAG_SOURCE, by design —
// never collapse these two into a single field.
// ─────────────────────────────────────────────────────────────────────────────
export const LIB_STATUS = { UNTAGGED: "untagged", REVIEW: "review", VERIFIED: "verified" };
export const TAG_SOURCE = { MANUAL: "manual", BUILD: "build" };

// Only these Cloudinary top-level folders are salesperson-facing library photos — everything
// else (inventory/prop/texture assets, production reference shots, etc.) is excluded from the
// Studio Library UI and from anything the AI tagger targets, even though the
// rows stay in the table untouched (non-destructive, query-time filter only).
// Both spellings on purpose. Rows written before the Supabase Storage migration carry the
// Cloudinary folder names ("inhouse venues", "Outside Venues"); anything written since carries
// the sanitised Storage key ("inhouse-venues", "outside-venues"), because the migration
// lowercased folders and turned spaces into dashes. Listing only one set would make a row
// disappear from Manage the moment it was re-saved — the filter is `IN`, so an unlisted value
// hides the row from every list and count query at once.
const ALLOWED_SOURCE_FOLDERS = [
  "ambria", "client-uploads", "inhouse venues", "Outside Venues",
  "inhouse-venues", "outside-venues", "ambria-ref", "production-ref", "mandi",
];

// The top-level folder an image lives in, taken from its URL. Two shapes to handle since the
// move to Supabase Storage:
//
//   Supabase   .../object/public/<bucket>/<folder>/<file>
//   Cloudinary .../upload/v<version>/<folder>/<file>
//
// Getting this wrong is silent and total: every list and count query filters on
// `source_folder IN ALLOWED_SOURCE_FOLDERS`, so an unrecognised value hides the row from Manage
// entirely. The Cloudinary-only version returned "https:" for Supabase URLs (no "/upload/" to
// split on, so it fell through to the protocol), which is exactly how the first Build uploads
// after the migration vanished from the Build Added queue.
function deriveSourceFolder(url) {
  if (!url) return null;
  const s = String(url);
  let rest;
  const sb = s.match(/\/object\/(?:public|sign)\/[^/]+\/(.+)$/);   // Supabase Storage
  if (sb) rest = sb[1];
  else {
    const cld = s.match(/\/upload\/(?:v\d+\/)?(.+)$/);              // Cloudinary
    if (!cld) return null;                                          // neither — better null than "https:"
    rest = cld[1];
  }
  const first = rest.split("/")[0] || "";
  if (!first || !rest.includes("/")) return null;                   // a bare filename has no folder
  try { return decodeURIComponent(first); } catch { return first; }
}

// ── row <-> item mapping (moved from StudioApp.jsx so the query layer owns the shape) ──
export function rowToLibItem(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  if (d) return { ...d, id: row.id };
  // Light-select branch (no `data` column fetched, e.g. the paginated grid query) — translate the
  // typed mirror columns back to the app's field names so photoStatus()/libPhotoIsTagged() etc.
  // work identically regardless of which query produced the item.
  return {
    id: row.id, name: row.name, url: row.url, tags: row.tags || {}, elements: row.elements || [],
    dims: row.dims || {}, prints: row.prints || [], linkedTemplates: row.linked_templates || [],
    zoneConfigByType: row.zone_config_by_type || {},
    _verified: row.status === LIB_STATUS.VERIFIED,
    tagSource: row.tag_source || undefined,
    _aiConfidence: (row.ai_confidence != null && row.ai_confidence !== "") ? Number(row.ai_confidence) : undefined,
    _aiTaggedAt: row.tagged_at ? new Date(row.tagged_at).getTime() : undefined,
    _verifiedBy: row.verified_by || undefined,
    _verifiedAt: row.verified_at ? new Date(row.verified_at).getTime() : undefined,
  };
}

// Lifecycle only — deliberately independent of tag_source (spec §9-D). A photo is 'verified' once a
// human confirms it, else 'review' if it has real tags/elements, else 'untagged'.
function computeLibStatus(it) {
  if (it?._verified) return LIB_STATUS.VERIFIED;
  return libPhotoIsTagged(it) ? LIB_STATUS.REVIEW : LIB_STATUS.UNTAGGED;
}
function computeTaggedAtMs(it, status) {
  const aiTs = typeof it?._aiTaggedAt === "number" ? it._aiTaggedAt : null;
  const verifiedTs = typeof it?._verifiedAt === "number" ? it._verifiedAt : null;
  return status === LIB_STATUS.VERIFIED ? (verifiedTs || aiTs || null) : (aiTs || null);
}
export function libItemToRow(it) {
  const status = computeLibStatus(it);
  const taggedAtMs = computeTaggedAtMs(it, status);
  return {
    id: it.id, name: it.name ?? null, url: it.url ?? null,
    tags: it.tags || {}, elements: it.elements || [], dims: it.dims || {}, prints: it.prints || [],
    linked_templates: it.linkedTemplates || it.linked_templates || [],
    zone_config_by_type: it.zoneConfigByType || {},
    data: it,
    status, tag_source: it.tagSource || null,
    tagged_at: taggedAtMs ? new Date(taggedAtMs).toISOString() : null,
    source_folder: deriveSourceFolder(it.url),
    verified_by: status === LIB_STATUS.VERIFIED ? (it._verifiedBy || null) : null,
    verified_at: status === LIB_STATUS.VERIFIED && typeof it._verifiedAt === "number" ? new Date(it._verifiedAt).toISOString() : null,
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Escape a value for embedding inside a PostgREST .or()/.not() filter literal.
function pgLit(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

// JSONB has no `&&` (array overlap) operator — PostgREST's `.overlaps()`/`ov` 400s on a jsonb path
// ("operator does not exist: jsonb && unknown"). `cs` (containment, `@>`) IS valid on jsonb, and
// `tags->key @> '["value"]'` checks "does this jsonb array contain value" — OR-ing one `cs` check
// per selected value, per active category, reproduces the overlap semantics `libFiltered` used to
// have client-side.
//
// The categories are combined with one CHAINED `.or()` per category, not a single `.and()` of
// `or()` groups: PostgrestFilterBuilder has no `.and()` method (checked against postgrest-js
// 2.108.2), so the previous version threw "q.and is not a function" on every filtered query and
// the whole sidebar came back as "Failed to load images". Chained filters already AND together,
// which is exactly the semantics wanted — every active category must match, any one of its values
// will do.
function pgArrayLit(v) { return JSON.stringify([v]); }

// ── SEARCH ACROSS TAGS, NOT JUST THE FILENAME ──
// `name` on a library row is the storage name — "huvordh6mli01tbcadzp.jpg" — so a name-only search
// was a box that could not find anything a person would actually type. These are the tag keys it
// looks in as well. They are the array-valued keys of the taxonomy, which is the same set the filter
// rail builds its sections from (ManageLibrary: Object.keys(taxonomy).filter(k => Array.isArray(…))).
// KEEP THIS IN STEP with that: a category added to the taxonomy shows up in the rail automatically
// but will NOT be searchable until its key is listed here.
// `venue` is deliberately not in the list — it is a scalar string, not an array, and is handled
// separately below.
const SEARCH_TAG_KEYS = [
  "tier", "eventType", "venueType", "designStyle",
  "timeSetting", "categoryTier", "colorPalette", "areasElements",
];

// How the tag arrays become searchable: `tags->>key` on a jsonb ARRAY returns that array's JSON
// text — '["Wedding", "Sangeet"]' — so an ilike over it sees the element strings. There is no need
// for a jsonb array operator, and `cs` (used by the rail's filters) cannot do this because it needs
// a whole exact value, not a fragment. Verified against the live table before writing this.
//
// The value is double-quoted so the DSL's own separators — comma, parens — inside a search term
// cannot end the filter or start a new condition; backslash and quote are escaped for the same
// reason. A typed `%` stays a wildcard, which is harmless.
function searchOrClause(word) {
  const pat = `"%${String(word).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
  return [
    `name.ilike.${pat}`,
    `tags->>venue.ilike.${pat}`,
    ...SEARCH_TAG_KEYS.map((k) => `tags->>${k}.ilike.${pat}`),
  ].join(",");
}

// Shared WHERE-clause builder for both the paginated list query and the count query —
// everything except the status/tagSource filter, which callers apply themselves (the
// count query needs the SAME base filters applied once per status bucket).
function applyCommonFilters(q, { filters = {}, venueGroup, venueNames = [], inhouseVenueNames = [], search = "" }) {
  q = q.in("source_folder", ALLOWED_SOURCE_FOLDERS);
  for (const [key, values] of Object.entries(filters)) {
    if (!Array.isArray(values) || !values.length) continue;
    q = q.or(values.map((v) => `tags->${key}.cs.${pgArrayLit(v)}`).join(","));
  }
  if (venueNames.length) {
    q = q.in("tags->>venue", venueNames);
  } else if (venueGroup === "inhouse" && inhouseVenueNames.length) {
    q = q.in("tags->>venue", inhouseVenueNames);
  } else if (venueGroup === "outside") {
    q = q.not("tags->>venue", "is", null);
    if (inhouseVenueNames.length) q = q.not("tags->>venue", "in", `(${inhouseVenueNames.map(pgLit).join(",")})`);
  }
  // Each WORD must match somewhere; within a word, any field will do. So "wedding gold" finds photos
  // tagged Wedding that also carry a gold palette — which is the thing people are actually asking for
  // when they type two words, and what a single-substring search cannot do, because the two words
  // live in different tag keys and no one string contains both.
  // Words AND by CHAINING .or() calls, the same mechanism the category filters above rely on:
  // chained filters AND, and PostgrestFilterBuilder has no .and() (see the note above).
  // Capped at 6 words so a pasted paragraph cannot build an unbounded URL.
  const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const w of words) q = q.or(searchOrClause(w));
  return q;
}

const LIST_COLUMNS = "id,name,url,tags,elements,dims,prints,linked_templates,zone_config_by_type,status,tag_source,tagged_at,created_at,verified_by,verified_at,ai_confidence:data->>_aiConfidence";

// Cursor-based (keyset) pagination — NOT OFFSET, so page N stays fast at 10k+ rows.
// `sortCol` is "tagged_at" for verified/review/manual/build (most-recently-tagged first)
// or "created_at" for untagged (tagged_at is always null there). Cursor = {sortVal, id} of
// the last row on the previous page.
function applyKeyset(q, sortCol, cursor) {
  if (cursor) {
    const { sortVal, id } = cursor;
    if (sortVal != null) {
      q = q.or(`${sortCol}.lt.${pgLit(sortVal)},and(${sortCol}.eq.${pgLit(sortVal)},id.lt.${pgLit(id)})`);
    } else {
      // Legacy rows with no tagged_at sort last; once we're in that tail, id alone orders them.
      q = q.is(sortCol, null).lt("id", id);
    }
  }
  return q.order(sortCol, { ascending: false, nullsFirst: false }).order("id", { ascending: false });
}

// A Build-uploaded photo belongs in the Build Added queue and nowhere else, so it is subtracted
// from the other unverified buckets. Written as an `or` rather than a plain `neq` because
// `tag_source <> 'build'` is NULL — not true — for the ~2800 rows where tag_source is null, so a
// bare neq would silently drop every one of them from Needs Review.
const NOT_BUILD = `tag_source.is.null,tag_source.neq.${TAG_SOURCE.BUILD}`;

/**
 * Fetch one page of the library browse grid.
 * `status` — 'verified' | 'review' | 'untagged' (ignored when tagSource is given).
 * `tagSource` — 'manual' | 'build'.
 *
 * Both tagSource buckets exclude verified photos: once a human verifies a photo it belongs to
 * Verified only, not to its original tag source. They differ in how they relate to the status
 * buckets:
 *   - Manual is still an informational SUBSET of Needs Review (the "how did it get tagged" cut).
 *   - Build Added is EXCLUSIVE — a photo uploaded from Build is removed from Needs Review and
 *     Untagged, because it is its own review queue and needs cross-checking against the build it
 *     came from, not to be lost among ~1850 AI-tagged photos.
 */
export async function fetchLibraryPage({
  status, tagSource, filters = {}, venueGroup, venueNames = [], inhouseVenueNames = [],
  search = "", cursor = null, pageSize = LIBRARY_PAGE_SIZE,
} = {}) {
  let q = supabase.from("library").select(LIST_COLUMNS);
  if (tagSource) q = q.eq("tag_source", tagSource).neq("status", LIB_STATUS.VERIFIED);
  else if (status) {
    q = q.eq("status", status);
    // Verified is untouched — a verified photo has left the Build queue by definition.
    if (status !== LIB_STATUS.VERIFIED) q = q.or(NOT_BUILD);
  }
  q = applyCommonFilters(q, { filters, venueGroup, venueNames, inhouseVenueNames, search });
  const sortCol = status === LIB_STATUS.UNTAGGED && !tagSource ? "created_at" : "tagged_at";
  q = applyKeyset(q, sortCol, cursor);
  q = q.limit(pageSize);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  const items = rows.map(rowToLibItem);
  const last = rows[rows.length - 1];
  const nextCursor = last ? { sortVal: last[sortCol], id: last.id } : null;
  return { items, nextCursor, hasMore: rows.length === pageSize };
}

/** Status-chip counts, scoped to the same sidebar filters/search as the grid. */
export async function fetchLibraryCounts({ filters = {}, venueGroup, venueNames = [], inhouseVenueNames = [], search = "" } = {}) {
  const base = () => applyCommonFilters(
    supabase.from("library").select("id", { count: "exact", head: true }),
    { filters, venueGroup, venueNames, inhouseVenueNames, search }
  );
  // Review/Untagged subtract the Build queue so the chip counts match the grids they open —
  // see NOT_BUILD above for why this is an `or` and not a `neq`.
  const [verified, review, untagged, manual, build] = await Promise.all([
    base().eq("status", LIB_STATUS.VERIFIED),
    base().eq("status", LIB_STATUS.REVIEW).or(NOT_BUILD),
    base().eq("status", LIB_STATUS.UNTAGGED).or(NOT_BUILD),
    base().eq("tag_source", TAG_SOURCE.MANUAL).neq("status", LIB_STATUS.VERIFIED),
    base().eq("tag_source", TAG_SOURCE.BUILD).neq("status", LIB_STATUS.VERIFIED),
  ]);
  for (const r of [verified, review, untagged, manual, build]) if (r.error) throw r.error;
  return { verified: verified.count || 0, review: review.count || 0, untagged: untagged.count || 0, manual: manual.count || 0, build: build.count || 0 };
}

/** Full-fidelity single row — detail panel + point-lookup fallback fetch. */
export async function fetchLibraryItem(id) {
  if (!id) return null;
  const { data, error } = await supabase.from("library").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return rowToLibItem(data);
}

export async function fetchLibraryItemsByIds(ids) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (!clean.length) return [];
  const out = [];
  for (const c of chunk(clean, 200)) {
    const { data, error } = await supabase.from("library").select("*").in("id", c);
    if (error) throw error;
    out.push(...(data || []).map(rowToLibItem));
  }
  return out;
}

export async function fetchLibraryItemsByUrls(urls) {
  const clean = [...new Set((urls || []).filter(Boolean))];
  if (!clean.length) return [];
  const out = [];
  for (const c of chunk(clean, 200)) {
    const { data, error } = await supabase.from("library").select("*").in("url", c);
    if (error) throw error;
    out.push(...(data || []).map(rowToLibItem));
  }
  return out;
}

/** Photos zone-tagged with any of `zoneList` (areasElements overlap) — the candidate pool
 * for getLibPhotosForZone's scoring, instead of scanning the whole in-memory library. */
export async function fetchZoneLibraryPhotos(zoneList) {
  const zones = (zoneList || []).filter(Boolean);
  if (!zones.length) return [];
  const { data, error } = await supabase.from("library")
    .select("id,name,url,tags,elements,dims,prints,linked_templates,zone_config_by_type,status,tag_source,tagged_at,ai_confidence:data->>_aiConfidence")
    .or(zones.map((z) => `tags->areasElements.cs.${pgArrayLit(z)}`).join(","))
    .limit(1000);
  if (error) throw error;
  return (data || []).map(rowToLibItem);
}

/** Photos privately tagged to ONE specific custom-zone instance (tags.customZoneIds contains the
 * zone's own generated id, e.g. "cz_1723710193847") — a separate channel from areasElements so a
 * custom zone never shares photos with an unrelated deal's differently-instantiated zone that
 * happens to have the same display name. customZoneIds is never shown as a tag/chip anywhere;
 * it exists purely for this lookup. See CUSTOM_ZONE_TAG_PREFIX (lib/studio/keys.js) for how a
 * caller signals "this id", not "this literal areasElements string". */
export async function fetchCustomZoneLibraryPhotos(zoneId) {
  if (!zoneId) return [];
  const { data, error } = await supabase.from("library")
    .select("id,name,url,tags,elements,dims,prints,linked_templates,zone_config_by_type,status,tag_source,tagged_at,ai_confidence:data->>_aiConfidence")
    .or(`tags->customZoneIds.cs.${pgArrayLit(zoneId)}`)
    .limit(1000);
  if (error) throw error;
  return (data || []).map(rowToLibItem);
}

/** Bounded pool of recently-tagged photos, used as last-resort zone-overflow filler
 * (replaces the old "scan the whole library for filler" behavior). */
export async function fetchRecentLibraryPhotos(limit = 200) {
  const { data, error } = await supabase.from("library")
    .select("id,name,url,tags,elements,dims,prints,linked_templates,zone_config_by_type,status,tag_source,tagged_at,ai_confidence:data->>_aiConfidence")
    .neq("status", LIB_STATUS.UNTAGGED)
    .order("tagged_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToLibItem);
}

/** Untagged targets for the bulk AI tagger — light columns only. */
export async function fetchUntaggedLibraryTargets(limit = 2000) {
  const { data, error } = await supabase.from("library")
    .select("id,name,url,tags,dims")
    .eq("status", LIB_STATUS.UNTAGGED)
    .in("source_folder", ALLOWED_SOURCE_FOLDERS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToLibItem);
}

/** Verified photos, full fidelity — feeds the AI-tagging knowledge base rebuild. */
export async function fetchVerifiedLibraryPhotos() {
  const { data, error } = await supabase.from("library").select("*").eq("status", LIB_STATUS.VERIFIED);
  if (error) throw error;
  return (data || []).map(rowToLibItem);
}

/** Batched existence checks for Cloudinary import/rebuild dedupe (replaces a full-table Set scan). */
export async function checkExistingLibraryUrls(urls) {
  const existing = new Set();
  for (const c of chunk([...new Set((urls || []).filter(Boolean))], 200)) {
    const { data, error } = await supabase.from("library").select("url").in("url", c);
    if (error) throw error;
    (data || []).forEach((r) => r.url && existing.add(r.url));
  }
  return existing;
}
export async function checkExistingLibraryIds(ids) {
  const existing = new Set();
  for (const c of chunk([...new Set((ids || []).filter(Boolean))], 200)) {
    const { data, error } = await supabase.from("library").select("id").in("id", c);
    if (error) throw error;
    (data || []).forEach((r) => r.id && existing.add(r.id));
  }
  return existing;
}

/** Every library row's id/name/url, across the WHOLE table (no folder/status filter) — for the
 * orphaned-image scan (find rows whose Cloudinary asset was deleted outside the app). Paginated
 * via .range() since this is a full-table read, unlike the batched existence checks above. */
export async function fetchAllLibraryRowsMinimal(onProgress) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("library").select("id,name,url").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    onProgress?.(out.length);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Storage-key constants — copied VERBATIM from the reference App (lines ~30–125, 600–760,
// 1218–1245). In this Supabase build these are the `settings`-table keys read/written via
// the kv shim (kvGet / reliableSave). Names + values are preserved exactly so the reference's
// load/save logic ports unchanged.

export const STORAGE_KEY = "ambria-v13";
export const AMBRIA_PLAYLIST_ID = "PLugzG6u3RGd4VBBcIQfWPAVf-1LpSKlEp";
export const AMBRIA_FIRST_VIDEO = "tVtnCEJyPRM";
export const CLOUDINARY_BASE = "https://res.cloudinary.com/dy9wfqhry/image/upload";
export const CLD_VIDEO_BASE = "https://res.cloudinary.com/dy9wfqhry/video/upload";
export const CLD_CLOUD = "dy9wfqhry";
export const CLD_API_KEY = "592743487577154";

// ═══ YOUTUBE / SEARCH CACHES ═══
export const YT_SK = "ambria-yt-cache-v1";
export const YT_TAG_SK = "ambria-yt-tags-v1";
export const YT_CACHE_TTL = 3600000;
export const MANUAL_VID_SK = "ambria-manual-videos-v1";
export const HIDDEN_VID_SK = "ambria-hidden-videos-v1";
// Per-video "favourite" flag — a video marked favourite for its own venue (tag.venue) ranks first
// in Browse whenever that venue is in scope, ahead of every filter except function type. Same
// {id: true} patch / {id: null} unset contract as HIDDEN_VID_SK, deliberately subtle client-side
// only (a coloured ring on the tier pill) so it never reaches an export or a client-facing view.
export const FAV_VID_SK = "ambria-fav-videos-v1";
// Same {photoId: {userId: true}} shape and reasoning as FAV_VID_SK, for Build's zone photo strips.
// Keyed by the Library photo's own id (or src for a non-library photo) — NOT by (photo, zone) —
// so a photo's favourite survives its own zone/taxonomy being re-tagged later: there's no stale
// zoneKey to go stale, the flag just keeps applying to the photo wherever it currently matches.
export const FAV_PHOTO_SK = "ambria-fav-photos-v1";
export const PIN_SK = "ambria-pin-cache-v1";

// ═══ RETIRED KEYS ═══
// These five blobs were migrated to real tables and the blobs deleted from `settings` on
// 30 Jul 2026 (verified unread first — no kvGet/reliableSave/realtime path referenced them):
//   ambria-clients-v1     → client_ledger table
//   ambria-eventorders-v1 → event_orders table
//   ambria-ims-blocks-v1  → blocks table
//   ambria-library-v2     → library table
//   ambria-ratecard-v4    → rate_card table
// The constants are gone deliberately: leaving them would name keys that no longer exist, so any
// future kvGet on one returns null and reads as "no data" — the same silent-empty trap that cost
// 249 video verifications the same day. Use the tables.

// ═══ ACTIVITY / NOTIFICATIONS / CLIENTS ═══
export const NOTIF_SK = "ambria-notifications-v1";
export const DT_SK = "ambria-datetypes-v1";

// ═══ PREFLIGHT AVAILABILITY ═══
export const PIMAP_SK = "ambria-photo-imsmap-v1";
export const SCAN_HIST_SK = "ambria-scan-history-v1";

// IMS read-only keys — on-demand fetch, NEVER in SHARED_KEYS (Studio only reads, never writes)
export const IMS_INV_SK = "ambria-ims-inventory-v1";
export const IMS_MANDI_SK = "ambria-ims-mandi-v1";
export const IMS_FLOWER_PATTERNS_SK = "ambria-ims-flower-patterns-v1";
export const IMS_SETTINGS_SK = "ambria-ims-settings-v1";
export const IMS_VENDORS_SK = "ambria-ims-vendors-v1";
export const IMS_TRUSS_INV_SK = "ambria-ims-truss-inventory-v1";

// §26 — Studio writes, IMS reads. Season categories + LMS contracts.
export const STUDIO_LMS_CACHE_SK = "ambria-studio-lms-cache-v1";
export const PALETTE_SK = "ambria-palette-v1";

// ═══ DEAL CHECK REBUILD (§7.9 · Deploy 1) ═══
export const DC_RUN_COUNTER_SK = "ambria-dc-run-counter-v1";
export const DC_CACHE_SK = "ambria-dc-cache-v1";
export const FLORAL_HARDPROP_MAP_SK = "ambria-floral-hardprop-v1";
export const SOFT_HOLDS_SK = "ambria-soft-holds-v1";
export const TRUSS_ALLOC_SK = "ambria-ims-truss-allocations-v1";

export const MAX_NOTIFS = 200;
export const FILTER_PRIORITY_SK = "ambria-filter-priority-v1";

// ══ RATE CARD / TEMPLATES / ZONES / LIBRARY / TAXONOMY ══
// RC_SK_CATS and RC_SK_TR are still live blobs; the bare RC_SK item blob is retired (see above).
export const RC_SK_CATS = "ambria-rccats-v1";
export const RC_SK_TR = "ambria-transport-v3";
export const TPL_SK = "ambria-templates-v4";
export const ZONE_DEF_SK = "ambria-zonedefs-v3";
export const TEAM_SK = "ambria-team-v1";
export const TAX_SK = "ambria-taxonomy-v2";
export const TAX_BOTH_MIG_SK = "ambria-tax-venuetype-both-migrated-v1"; // one-time flag: injected the "Both" venue type into the shared taxonomy (so a later deliberate removal isn't auto-restored)
export const TAG_KB_SK = "ambria-tag-knowledgebase-v1"; // AI-tagging knowledge base distilled from VERIFIED photos (per-area profiles + few-shot exemplars); rebuilt when stale
export const TAG_HIDDEN_SUBS_SK = "ambria-tag-hidden-subs-v1"; // array of "cat::sub" keys flagged in Pricing as NOT taggable (hidden from element-search boxes + AI vocabulary; items still exist in pricing/IMS)
export const PREMIA_CFG_SK = "ambria-premia-config-v1";
// Hand-curated photo groups per zone: { [areaName]: [libraryPhotoId, …] }, in display order.
// A curation layer on top of the AI/manual `areasElements` tags, never a replacement for them —
// Build shows a zone's group first and then the rest of its tagged photos, so removing a photo
// from a group only demotes it, it doesn't untag it.
export const ZONE_GROUPS_SK = "ambria-zone-photo-groups-v1";

export const DEFAULT_FILTER_PRIORITY = [
  { id: "tier", label: "Tier", icon: "🏷️" },
  { id: "style", label: "Design style", icon: "🎨" },
  { id: "color", label: "Color palette", icon: "🎨" },
  { id: "fn", label: "Function type", icon: "📋" },
  { id: "io", label: "Indoor / Outdoor", icon: "🏠" },
];

// ═══ TRANSPORT ═══
// Lifted out of StudioApp so the IMS copy of the Transport & Power panel shares one definition
// rather than a second list that drifts. Studio still owns the editor; IMS mounts the same one.
export const TC_UNITS = [{ id: "pc", l: "pcs" }, { id: "sqft", l: "sqft" }, { id: "rft", l: "RFT" }, { id: "kg", l: "kg" }, { id: "bundle", l: "bundles" }];
export const TR_TIERS = [
  { id: "inhouse", label: "Tier 1 — In-house Venues", icon: "🏠", desc: "Fixed cost per trip — always same" },
  { id: "empanelled", label: "Tier 2 — Empanelled Venues", icon: "🤝", desc: "Fixed cost per trip for partner venues" },
  { id: "repeat", label: "Tier 3 — Repeat Venues", icon: "🔄", desc: "Auto-pulled rates from past event data" },
  { id: "new", label: "Tier 4 — New Venues", icon: "🆕", desc: "Manual entry for first-time venues" },
];
// The Studio-owned settings rows the IMS panel has to read directly: IMS strips every "ambria-"
// key out of its own settings object on purpose, so these two are fetched by the panel itself.
export const VENUES_SK = STORAGE_KEY + "-venues";

// ═══ CUSTOM ZONE PHOTO MATCHING ═══
// A standard zone's photo strip matches library photos by a shared, admin-curated NAME
// (tags.areasElements), which is deliberately global — every deal's "Stage" is the same idea, so
// tagging a photo "Stage" once makes it visible everywhere. A custom ("Other") zone is the
// opposite: it's a name one salesperson typed for one deal, with no company-wide agreement on what
// it means, so two unrelated deals both naming a zone "Selfie Booth" must NOT end up sharing
// photos just because the strings match. Matching a custom zone by its own generated `id` instead
// (stored in tags.customZoneIds, never the visible areasElements) makes that impossible — this
// prefix marks an areaNames entry as "match customZoneIds by this id", not "match areasElements by
// this literal string", everywhere the two are threaded through the same plumbing (StudioBuild.jsx's
// areaNamesFor, StudioApp.jsx's getLibPhotosForZone, zone photo-group pinning).
export const CUSTOM_ZONE_TAG_PREFIX = "__customzone__:";

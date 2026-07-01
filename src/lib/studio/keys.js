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
export const PIN_SK = "ambria-pin-cache-v1";

// ═══ ACTIVITY / NOTIFICATIONS / CLIENTS ═══
export const NOTIF_SK = "ambria-notifications-v1";
export const CLI_SK = "ambria-clients-v1";
export const DT_SK = "ambria-datetypes-v1";
export const EO_SK = "ambria-eventorders-v1";

// ═══ PREFLIGHT AVAILABILITY ═══
export const PIMAP_SK = "ambria-photo-imsmap-v1";
export const SCAN_HIST_SK = "ambria-scan-history-v1";

// IMS read-only keys — on-demand fetch, NEVER in SHARED_KEYS (Studio only reads, never writes)
export const IMS_INV_SK = "ambria-ims-inventory-v1";
export const IMS_BLOCKS_SK = "ambria-ims-blocks-v1";
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
export const RC_SK = "ambria-ratecard-v4";
export const RC_SK_CATS = "ambria-rccats-v1";
export const RC_SK_TR = "ambria-transport-v3";
export const TPL_SK = "ambria-templates-v4";
export const ZONE_DEF_SK = "ambria-zonedefs-v3";
export const TEAM_SK = "ambria-team-v1";
export const LIB_SK = "ambria-library-v2";
export const TAX_SK = "ambria-taxonomy-v2";
export const CORR_SK = "ambria-correction-log-v1"; // append-only log of human photo corrections (who/what/when) for contribution reporting
export const TAG_KB_SK = "ambria-tag-knowledgebase-v1"; // AI-tagging knowledge base distilled from VERIFIED photos (per-area profiles + few-shot exemplars); rebuilt when stale
export const AITAG_QUOTA_SK = "ambria-aitag-quota-v1"; // { date, count } — global daily AI-tagging cap (temporary, for testing)
export const TAG_HIDDEN_SUBS_SK = "ambria-tag-hidden-subs-v1"; // array of "cat::sub" keys flagged in Pricing as NOT taggable (hidden from element-search boxes + AI vocabulary; items still exist in pricing/IMS)
export const PREMIA_CFG_SK = "ambria-premia-config-v1";
export const SKIP_NIGHTLY_SK = "batch-tagger-skip-next";

export const DEFAULT_FILTER_PRIORITY = [
  { id: "tier", label: "Tier", icon: "🏷️" },
  { id: "style", label: "Design style", icon: "🎨" },
  { id: "color", label: "Color palette", icon: "🎨" },
  { id: "fn", label: "Function type", icon: "📋" },
  { id: "io", label: "Indoor / Outdoor", icon: "🏠" },
];

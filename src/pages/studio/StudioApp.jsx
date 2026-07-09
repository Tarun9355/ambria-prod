// ═══════════════════════════════════════════════════════════════
// AMBRIA DESIGN STUDIO — deal-builder SPINE (faithful rebuild)
// ═══════════════════════════════════════════════════════════════
// This slice establishes: ALL state hooks (verbatim from the reference
// AmbriStudioInner), the kv-backed data-load + save helpers, the pricing
// engine closures (verbatim), a `ctx` bag, and the mode/step routing
// skeleton with header chrome. The four studio VIEWS (EventInfo, Browse,
// Build, Summary), Manage mode, and the Deal Check overlay are rendered as
// placeholders — they land in later slices.
//
// Persistence: the reference's Redis kvGet/reliableSave port verbatim through
// the Supabase `settings`-table shim (src/lib/ims/kv).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "../../lib/AuthContext";
import AppSwitcher from "../../components/AppSwitcher.jsx";
import RateCard from "./RateCard.jsx";
import ManageLibrary from "./manage/ManageLibrary.jsx";
import ManageSettings from "./manage/ManageSettings.jsx";
import PremiaEditor from "./manage/PremiaEditor.jsx";
import StudioModals from "./StudioModals.jsx";
import StudioEventInfo from "./views/StudioEventInfo.jsx";
import StudioBrowse from "./views/StudioBrowse.jsx";
import StudioBuild from "./views/StudioBuild.jsx";
import StudioSummary from "./views/StudioSummary.jsx";
import DealCheckOverlay from "./dealcheck/DealCheckOverlay.jsx";
import { kvGet, kvSet, reliableSave } from "../../lib/ims/kv";
import { AMEND_SK, isLastMinute, makeAmendRequest } from "../../lib/ims/amend";
import { availableAtVenue, isStandingAt } from "../../lib/ims/fixedVenues";
import { searchLmsLeads, triggerLmsSync, fetchCachedContracts } from "../../lib/ims/lms";
import { IMS_CLD_PRESET, IMS_CLD_UPLOAD_URL, compressImageForCloudinary, cldAdmin } from "../../lib/cloudinary";
import { ytApi, ytDuration } from "../../lib/youtube";
import { makeS } from "../../lib/studio/styles";
import {
  DEFAULT_TAX, ZONE_META, ZONE_LABELS, ZONE_PRESETS, BASE_RATES,
  getCat, taxOr, FUNCTIONS, CATEGORIES, SHIFT_LETTER, ZONE_TYPE_TO_AREA,
} from "../../lib/studio/taxonomy";

// Reverse of ZONE_TYPE_TO_AREA: photo-tag area name ("Bar / Counter") → build zone key ("bar").
// A video's zonePhotos are keyed by area name; the Build page keys zones by elKey — without this
// map the per-zone photo a salesperson assigned to a video never pre-selects on Build.
const AREA_TO_ZONEKEY = (() => {
  const m = {};
  Object.entries(ZONE_TYPE_TO_AREA).forEach(([zk, areas]) => {
    (Array.isArray(areas) ? areas : [areas]).forEach((a) => { if (!(a in m)) m[a] = zk; });
  });
  return m;
})();
import { RC_D, RC_CATS_DEFAULT } from "../../lib/studio/constants";
import {
  resolveTrussConfig, findZoneForArea, findAreaForZone, makeZoneId,
  defaultZoneFromArea, resolveMandiFlower, calcZoneTrussPreview,
  calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan, getStudioAvailable,
  buildTopology, PLATFORM_FATTA_CODE, PLATFORM_STAND_CODE,
} from "../../lib/studio/pricing";
import { callClaudeStreaming } from "../../lib/ai";
import { heavyExtraLabour, eventTimingMultFor } from "../../lib/ims/constants";
import { supabase, fetchAll, upsertRow, deleteRow, subscribeTable } from "../../lib/supabase";
import {
  rowToLibItem, libItemToRow, fetchLibraryItemsByIds, fetchLibraryItemsByUrls,
  fetchZoneLibraryPhotos, fetchRecentLibraryPhotos, fetchUntaggedLibraryTargets,
  fetchVerifiedLibraryPhotos, checkExistingLibraryUrls,
} from "../../lib/studio/libraryQueries";
import { rowToItem } from "../../lib/inventory/adapter";
import { VENUE_MIG_SK, LEGACY_VENUE_SEED } from "../../lib/studio/venues";
import {
  STORAGE_KEY, AMBRIA_PLAYLIST_ID, CLD_CLOUD,
  YT_SK, YT_TAG_SK, MANUAL_VID_SK, HIDDEN_VID_SK,
  NOTIF_SK, CLI_SK, DT_SK, EO_SK, PIMAP_SK, SCAN_HIST_SK,
  IMS_SETTINGS_SK, STUDIO_LMS_CACHE_SK, PALETTE_SK,
  DC_RUN_COUNTER_SK, DC_CACHE_SK, FLORAL_HARDPROP_MAP_SK, SOFT_HOLDS_SK,
  TRUSS_ALLOC_SK, FILTER_PRIORITY_SK, DEFAULT_FILTER_PRIORITY,
  RC_SK, RC_SK_CATS, RC_SK_TR, TPL_SK, ZONE_DEF_SK, TEAM_SK, LIB_SK, TAX_SK, CORR_SK, TAG_KB_SK, AITAG_QUOTA_SK,
  TAG_HIDDEN_SUBS_SK, PREMIA_CFG_SK, BATCH_TAGGER_PAUSED_SK,
} from "../../lib/studio/keys.js";

// Temporary daily cap on AI image-tagging calls while testing. Raise (or set to Infinity) to lift.
const AI_TAG_DAILY_LIMIT = 10;
import { buildTagKB, renderTagKBText } from "../../lib/studio/tagKB.js";
import { fetchRecentCorrections, renderCorrectionsText } from "../../lib/studio/tagFeedback.js";

// ═══════════════════════════════════════════════════════════════
// MODULE-SCOPE CONSTANTS / HELPERS — copied VERBATIM from the reference.
// (Constants that already live in our libs are imported above.)
// ═══════════════════════════════════════════════════════════════
const YT_CACHE_TTL = 60 * 60 * 1000; // 1h — YouTube playlist cache TTL

const fmt = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;

// ══ TEAM / USERS ══
const TEAM = { tarun: { name: "Tarun", pw: "ambria@admin", role: "admin" } };
const ROLES = ["admin", "manager", "sales"];
const PERM_LABELS = { canViewPricing: "View pricing & costs", canManagePricing: "Manage pricing (Rate Card, Transport)", canEditEvents: "Add / edit events", canManageTemplates: "Manage templates", canManageLibrary: "Manage library", canExport: "Export data", canManageVenues: "Manage venues", canManageUsers: "Manage users" };
const ROLE_DEFAULTS = { admin: { canViewPricing: true, canManagePricing: true, canEditEvents: true, canManageTemplates: true, canManageLibrary: true, canExport: true, canManageVenues: true, canManageUsers: true }, manager: { canViewPricing: true, canManagePricing: false, canEditEvents: true, canManageTemplates: false, canManageLibrary: true, canExport: false, canManageVenues: false, canManageUsers: false }, sales: { canViewPricing: false, canManagePricing: false, canEditEvents: false, canManageTemplates: false, canManageLibrary: false, canExport: false, canManageVenues: false, canManageUsers: false } };
const DEFAULT_TEAM = Object.fromEntries(Object.entries(TEAM).map(([id, u]) => ([id, { ...u, active: true, perms: { ...(ROLE_DEFAULTS[u.role] || ROLE_DEFAULTS.sales) }, assignedVenues: [], venueScope: u.role === "admin" ? "all" : "outside", defaultVenue: "" }])));

// ══ AMBRIA PREMIA (Platinum gate) — fully editable copy & CTA ══
const PREMIA_DEFAULTS = {
  badge: "AMBRIA PREMIA",
  title: "Platinum collection",
  subtitle: "Curated designs by our Sr. Designer",
  body: "This design is part of our Platinum collection and can't be customized in Studio — it's showcased to give clients a glimpse of what our Sr. Designer creates.\n\nTo take this further, set up a meeting with our Ambria Premia team.",
  closeLabel: "Close",
  ctaLabel: "Request Sr. Designer",
  ctaUrl: "",
};

const TAX_LABELS = { eventType: "Event type", venueType: "Venue type", areasElements: "Areas & elements", colorPalette: "Color palette", tier: "Tier", categoryTier: "Category tier (legacy)", designStyle: "Design style", timeSetting: "Time / setting" };

const RC_UNITS = [{ id: "sqft", l: "/sqft" }, { id: "truss_sqft", l: "/truss sqft" }, { id: "rft", l: "/RFT" }, { id: "pc", l: "/pc" }, { id: "setup", l: "/setup" }, { id: "trip", l: "/trip" }, { id: "event", l: "/event" }, { id: "string", l: "/string" }, { id: "included", l: "Included" }, { id: "multiplier", l: "× mult" }];
const TC_UNITS = [{ id: "pc", l: "pcs" }, { id: "sqft", l: "sqft" }, { id: "rft", l: "RFT" }, { id: "kg", l: "kg" }, { id: "bundle", l: "bundles" }];

// ═══ TRANSPORT DEFAULTS (4-tier venue pricing + truck capacity + buffer) ═══
const TR_TIERS = [
  { id: "inhouse", label: "Tier 1 — In-house Venues", icon: "\u{1F3E0}", desc: "Fixed cost per trip — always same" },
  { id: "empanelled", label: "Tier 2 — Empanelled Venues", icon: "\u{1F91D}", desc: "Fixed cost per trip for partner venues" },
  { id: "repeat", label: "Tier 3 — Repeat Venues", icon: "\u{1F504}", desc: "Auto-pulled rates from past event data" },
  { id: "new", label: "Tier 4 — New Venues", icon: "\u{1F195}", desc: "Manual entry for first-time venues" },
];
const TR_DV = [
  { id: "V01", tier: "inhouse", name: "Emerald Green", rate: 3000, gensets: 1 },
  { id: "V02", tier: "inhouse", name: "Aura", rate: 3000, gensets: 1 },
  { id: "V03", tier: "inhouse", name: "Valencia", rate: 3000, gensets: 1 },
  { id: "V04", tier: "inhouse", name: "Pushpanjali", rate: 4000, gensets: 1 },
  { id: "V05", tier: "inhouse", name: "Alstonia", rate: 3000, gensets: 1 },
  { id: "V06", tier: "inhouse", name: "Poolside", rate: 3000, gensets: 1 },
  { id: "V07", tier: "empanelled", name: "Grand Vasantkunj", rate: 5000, gensets: 1 },
  { id: "V08", tier: "empanelled", name: "Country Inn", rate: 6000, gensets: 1 },
  { id: "V09", tier: "empanelled", name: "Kaara Farm", rate: 5000, gensets: 1 },
  { id: "V10", tier: "empanelled", name: "Sunday Resort", rate: 5500, gensets: 1 },
  { id: "V11", tier: "empanelled", name: "Radisson UV", rate: 7000, gensets: 1.5 },
  { id: "V12", tier: "empanelled", name: "Crowne Plaza", rate: 6500, gensets: 1.5 },
  { id: "V13", tier: "empanelled", name: "ITC Grand Bharat", rate: 8000, gensets: 2 },
  { id: "V14", tier: "empanelled", name: "Leela Palace", rate: 9000, gensets: 2 },
];
const TR_DTC = [
  { id: "TC01", item: "Chairs", perTruck: 100, unit: "pc" },
  { id: "TC02", item: "Sofas", perTruck: 8, unit: "pc" },
  { id: "TC03", item: "Chandeliers", perTruck: 20, unit: "pc" },
  { id: "TC04", item: "Round Tables", perTruck: 0, unit: "pc" },
  { id: "TC05", item: "Props", perTruck: 0, unit: "pc" },
  { id: "TC06", item: "Truss batch", perTruck: 0, unit: "sqft" },
  { id: "TC07", item: "Platform batch", perTruck: 0, unit: "sqft" },
  { id: "TC08", item: "Carpet batch", perTruck: 0, unit: "sqft" },
  { id: "TC09", item: "Arches", perTruck: 0, unit: "pc" },
];
const TR_DBT = [
  { id: "BT01", label: "Below ₹1L", minBudget: 0, maxBudget: 100000, bufferTrucks: 0 },
  { id: "BT02", label: "₹1L – 3L", minBudget: 100000, maxBudget: 300000, bufferTrucks: 1 },
  { id: "BT03", label: "₹3L – 6L", minBudget: 300000, maxBudget: 600000, bufferTrucks: 1 },
  { id: "BT04", label: "₹6L – 10L", minBudget: 600000, maxBudget: 1000000, bufferTrucks: 2 },
  { id: "BT05", label: "₹10L+", minBudget: 1000000, maxBudget: 99999999, bufferTrucks: 3 },
];

// ═══ LABOUR (from IMS rates) ═══
const LABOUR = {
  flowerists: { label: "Flowerists", rate: 800, unit: "/day" },
  labours: { label: "Labours", rate: 500, unit: "/day" },
  fabricBangali: { label: "Fabric Bangali", rate: 600, unit: "/day" },
  carpenters: { label: "Carpenters", rate: 900, unit: "/day" },
  painters: { label: "Painters", rate: 700, unit: "/day" },
  electricians: { label: "Electricians", rate: 1000, unit: "/day" },
  trussLabour: { label: "Truss Labour", rate: 800, unit: "/day" },
  drivers: { label: "Drivers", rate: 600, unit: "/day" },
  supervisors: { label: "Supervisors", rate: 1200, unit: "/day" },
};
const LABOUR_PRESETS = {
  simple: { flowerists: 2, labours: 4, fabricBangali: 1, carpenters: 1, painters: 0, electricians: 1, trussLabour: 0, drivers: 1, supervisors: 1 },
  enhanced: { flowerists: 4, labours: 8, fabricBangali: 2, carpenters: 2, painters: 1, electricians: 2, trussLabour: 1, drivers: 2, supervisors: 1 },
  premium: { flowerists: 8, labours: 14, fabricBangali: 3, carpenters: 3, painters: 2, electricians: 3, trussLabour: 2, drivers: 3, supervisors: 2 },
};
const SEASON_MULT = { kings: 2, perfect: 1.5, nonsaya: 1 };

const TPL_DEFAULTS = [
  { id: 1001, name: "Grand Outdoor Wedding", tier: "Gold", fn: "Wedding", space: "Outdoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 2, zones: [{ id: "zt1", type: "stage", name: "Main Stage", config: { dims: { L: 24, W: 15, H: 12 }, trT: "box", plH: "1ft", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry & Passage", config: { dims: { W: 12, H: 14, L: 35 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Side Lounge", config: { dims: { L: 18, W: 12, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "vedi", name: "Mandap", config: { dims: { S: 12, H: 10 }, trT: "box", plH: "1ft", cpT: "new" } }] },
  { id: 1002, name: "Minimal Haldi", tier: "Silver", fn: "Haldi", space: "Outdoor", labourPreset: "simple", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Haldi Stage", config: { dims: { L: 12, W: 8, H: 8 }, trT: "singleU", plH: "4in", cpT: "old" } }, { id: "zt2", type: "entry", name: "Simple Entry", config: { dims: { W: 8, H: 8, L: 10 }, trT: "singleU", cpT: "old" } }] },
  { id: 1003, name: "Indoor Reception Gold", tier: "Gold", fn: "Reception", space: "Indoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Main Stage", config: { dims: { L: 20, W: 12, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry & Passage", config: { dims: { W: 10, H: 12, L: 20 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Lounge", config: { dims: { L: 16, W: 10, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "bar", name: "Bar", config: { dims: { L: 10, W: 4 }, plH: "4in", cpT: "new" } }] },
  { id: 1004, name: "Sangeet Night", tier: "Gold", fn: "Sangeet", space: "Outdoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Dance Stage", config: { dims: { L: 24, W: 16, H: 12 }, trT: "box", plH: "1ft", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry & Passage", config: { dims: { W: 10, H: 12, L: 25 }, trT: "singleU", cpT: "old" } }, { id: "zt3", type: "lounge", name: "Floor Lounge", config: { dims: { L: 20, W: 14, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "bar", name: "Bar + Dessert", config: { dims: { L: 14, W: 5 }, plH: "4in", cpT: "new" } }] },
  { id: 1005, name: "Poolside Cocktail", tier: "Gold", fn: "Cocktail", space: "Semi-Outdoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "entry", name: "Poolside Entry", config: { dims: { W: 10, H: 10, L: 15 }, trT: "singleU", cpT: "new" } }, { id: "zt2", type: "lounge", name: "Centre Lounge", config: { dims: { L: 14, W: 12, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Side Lounge", config: { dims: { L: 12, W: 8, H: 8 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "bar", name: "Main Bar", config: { dims: { L: 12, W: 5 }, plH: "4in", cpT: "new" } }, { id: "zt5", type: "bar", name: "Dessert Counter", config: { dims: { L: 8, W: 4 }, plH: "4in", cpT: "new" } }] },
  { id: 1006, name: "Garden Mehendi", tier: "Silver", fn: "Mehendi", space: "Outdoor", labourPreset: "simple", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Mehendi Stage", config: { dims: { L: 14, W: 10, H: 8 }, trT: "singleU", plH: "4in", cpT: "old" } }, { id: "zt2", type: "entry", name: "Entry", config: { dims: { W: 8, H: 8, L: 10 }, trT: "singleU", cpT: "old" } }, { id: "zt3", type: "lounge", name: "Seating Area", config: { dims: { L: 16, W: 12, H: 8 }, trT: "box", plH: "4in", cpT: "old" } }] },
  { id: 1007, name: "Platinum Royal Wedding", tier: "Platinum", fn: "Wedding", space: "Outdoor", labourPreset: "premium", seasonType: "nonsaya", setupDays: 2, zones: [{ id: "zt1", type: "stage", name: "Grand Stage", config: { dims: { L: 30, W: 18, H: 14 }, trT: "box", plH: "1ft", cpT: "new" } }, { id: "zt2", type: "entry", name: "Royal Entry & Passage", config: { dims: { W: 14, H: 16, L: 50 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "VIP Lounge", config: { dims: { L: 20, W: 14, H: 12 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "vedi", name: "Mandap", config: { dims: { S: 14, H: 12 }, trT: "box", plH: "1ft", cpT: "new" } }] },
  { id: 1008, name: "Platinum Indoor Reception", tier: "Platinum", fn: "Reception", space: "Indoor", labourPreset: "premium", seasonType: "nonsaya", setupDays: 2, zones: [{ id: "zt1", type: "stage", name: "Grand Stage", config: { dims: { L: 28, W: 16, H: 14 }, trT: "box", plH: "1ft", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry & Passage", config: { dims: { W: 14, H: 14, L: 45 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Premium Lounge", config: { dims: { L: 22, W: 14, H: 12 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "bar", name: "Bar", config: { dims: { L: 12, W: 5 }, plH: "4in", cpT: "new" } }] },
  { id: 1009, name: "Platinum Cocktail Night", tier: "Platinum", fn: "Cocktail", space: "Indoor", labourPreset: "premium", seasonType: "nonsaya", setupDays: 2, zones: [{ id: "zt1", type: "stage", name: "Cocktail Stage", config: { dims: { L: 20, W: 12, H: 12 }, trT: "box", plH: "1ft", cpT: "new" } }, { id: "zt2", type: "entry", name: "Grand Entry", config: { dims: { W: 12, H: 14, L: 30 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Centre Lounge", config: { dims: { L: 16, W: 12, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt4", type: "lounge", name: "Side Lounge", config: { dims: { L: 14, W: 10, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt5", type: "bar", name: "Premium Bar", config: { dims: { L: 14, W: 5 }, plH: "4in", cpT: "new" } }, { id: "zt6", type: "photobooth", name: "Photo Op", config: { dims: { W: 10, H: 10 }, trT: "singleU" } }] },
  { id: 1010, name: "Simple Engagement", tier: "Silver", fn: "Engagement", space: "Indoor", labourPreset: "simple", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Stage", config: { dims: { L: 14, W: 10, H: 8 }, trT: "singleU", plH: "4in", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry", config: { dims: { W: 8, H: 8, L: 10 }, trT: "singleU", cpT: "old" } }] },
  { id: 1011, name: "Gold Mehendi", tier: "Gold", fn: "Mehendi", space: "Outdoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Mehendi Stage", config: { dims: { L: 16, W: 12, H: 10 }, trT: "singleU", plH: "4in", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry", config: { dims: { W: 10, H: 10, L: 12 }, trT: "singleU", cpT: "old" } }, { id: "zt3", type: "lounge", name: "Seating Lounge", config: { dims: { L: 18, W: 14, H: 8 }, trT: "box", plH: "4in", cpT: "new" } }] },
  { id: 1012, name: "Gold Anniversary", tier: "Gold", fn: "Anniversary", space: "Indoor", labourPreset: "enhanced", seasonType: "nonsaya", setupDays: 1, zones: [{ id: "zt1", type: "stage", name: "Main Stage", config: { dims: { L: 16, W: 10, H: 10 }, trT: "box", plH: "4in", cpT: "new" } }, { id: "zt2", type: "entry", name: "Entry & Passage", config: { dims: { W: 10, H: 10, L: 15 }, trT: "singleU", cpT: "new" } }, { id: "zt3", type: "lounge", name: "Guest Lounge", config: { dims: { L: 14, W: 10, H: 8 }, trT: "box", plH: "4in", cpT: "new" } }] },
];

// ═══ DEFAULT SAMPLE EVENTS — sample events removed; team loads real events via UI ═══
const DEFAULTS = [];

// Old per-item catalogue fully removed — element-card pricing only. ITEMS is retained as
// an empty stub so the (never-reached) legacy itemQty loop in calcFunctionCost compiles.
// The loop body only runs when fItemQty has entries, which never happens in the new model.
const ITEMS = [];

// §7.9.5 — RC floral element → IMS hard-prop default map.
const FLORAL_HARDPROP_DEFAULT = {
  "F01": [], "F02": [], "F03": [], "F04": [],
  "F05": [{ propType: "pot" }],
  "F06": [{ propType: "pot" }],
  "F07": [{ propType: "table" }],
  "F08": [{ propType: "table" }],
  "F09": [{ propType: "vase" }],
  "F10": [{ propType: "vase" }],
  "F11": [{ propType: "stand" }],
  "F12": [{ propType: "console" }],
};

// ═══ STRUCTURAL COST (module scope, deterministic) — VERBATIM ═══
function calcStructCost(zk, zc) {
  if (!zc) return { truss: 0, masking: 0, platform: 0, carpet: 0, arches: 0, pillars: 0, glass: 0, total: 0 };
  const d = zc.dims || {}, fd = zc.floorDims || d, r = { truss: 0, masking: 0, platform: 0, carpet: 0, arches: 0, pillars: 0, glass: 0 };
  // A Box truss needs all 3 dims. With only 2 dims filled it's physically a Single U, so price it at
  // the Single U rate (₹30) even if the toggle still reads Box (stale from a 3-dim state or an older
  // saved zone) — "2 dims ⇒ Single U, 3 dims ⇒ Box".
  const _trussDims = [d.L, (d.W || d.S), d.H].filter((x) => (Number(x) || 0) > 0).length;
  const _trMode = (zc.trT === "box" && _trussDims < 3) ? "singleU" : zc.trT;
  if (_trMode === "box") {
    const v = [d.L || 0, d.W || d.S || 0, d.H || 0].sort((a, b) => b - a);
    r.truss = v[0] * v[1] * 50;
    // Optional FRONT EXTENSION (box only, rare): a Single U truss on EACH front side, priced at the
    // Single U rate (₹30/sqft) = extension length × extension height. Its own height (can differ from
    // the box). The shared box-corner pillar saves material/fabric, NOT cost — so the rupee cost is the
    // full Single U area for both sides.
    const ext = Number(zc.trussFrontExt) || 0;
    if (ext > 0) { const extH = Number(zc.trussFrontExtH) || (d.H || 0); r.truss += 2 * ext * extH * 30; }
  }
  else if (_trMode === "singleU") { r.truss = (d.W || d.S || d.L || 0) * (d.H || 0) * 30; }
  // Multiple identical trusses in one zone/photo (e.g. 3× Single U) — cost scales by quantity.
  r.truss *= Math.max(1, zc.trussQty || 1);
  if (zc.mkOn && zc.mkT) {
    const h = d.H || 0, rate = BASE_RATES.masking[zc.mkT] || 20; let w = 0;
    const dL = d.L || d.S || 0, dW = d.W || d.S || 0;
    if (zc.mkWalls) {
      const _trCfg = resolveTrussConfig(zc);
      const _cfg = _trCfg?.config || (zc.trT === "box" ? "full_box" : "half_box");
      const _spanL = _trCfg?.spanFt || dL || dW;
      const _backDepth = zc.trussBackDepth || 4;
      if (_cfg === "full_box") {
        if (zc.mkWalls.back) w += dW * h;   // back wall spans the WIDTH
        if (zc.mkWalls.left) w += dL * h;   // side walls span the DEPTH
        if (zc.mkWalls.right) w += dL * h;
      } else if (_cfg === "half_box") {
        if (zc.mkWalls.back) w += _spanL * h;
        if (zc.mkWalls.left) w += _backDepth * h;
        if (zc.mkWalls.right) w += _backDepth * h;
      } else if (_cfg === "u_only") {
        if (zc.mkWalls.back) w += _spanL * h;
      }
    } else {
      const s = zc.mkS || 1;
      if (zc.trT === "box") { const dd = [dL, dW].sort((a, b) => b - a); if (s >= 1) w += dd[0] * h; if (s >= 2) w += dd[1] * h; if (s >= 3) w += dd[0] * h; }
      else { w = dW * h * s; }
    }
    r.masking = w * rate * Math.max(1, zc.trussQty || 1);
  }
  if (zc.plH) { const a = (fd.L || fd.S || 0) * (fd.W || (fd.S || 0)); r.platform = a * (BASE_RATES.platform[zc.plH] || 45); }
  if (zc.cpT) { const a = (fd.L || fd.S || 0) * (fd.W || (fd.S || 0)); r.carpet = a * (BASE_RATES.carpet[zc.cpT] || 15); }
  if (zc.archOn && zc.archT) { const aq = zc.archQty || 0, aw = zc.archW || 0, ah = zc.archH || 0; r.arches = aq * aw * ah * (BASE_RATES.arch[zc.archT] || 60); }
  if (zc.pillarQty) { r.pillars = (zc.pillarQty || 0) * BASE_RATES.pillar; }
  if (zc.glassOn && zc.glassT) { const gq = zc.glassQty || 0, gw = zc.glassW || 0, gh = zc.glassH || 0; r.glass = gq * gw * gh * (BASE_RATES.glass[zc.glassT] || 120); }
  r.total = r.truss + r.masking + r.platform + r.carpet + r.arches + r.pillars + r.glass; return r;
}
function initZP(zk, size) {
  const p = ZONE_PRESETS[zk]?.[size]; const zm = ZONE_META[zk]; if (!p || !zm) return null;
  const dims = {}; zm.dimFields.forEach(f => { dims[f] = p[f] || 0; });
  return { dims, trT: p.tr || zm.defaultTruss || null, trussQty: p.trussQty || 1, trussFrontExt: p.trussFrontExt || 0, trussFrontExtH: p.trussFrontExtH || 0, mkOn: !!p.mk, mkT: p.mk || "fabric", mkS: p.ms || 1, plH: p.pl || null, cpT: p.cp || null, archOn: !!p.archT, archT: p.archT || null, archQty: p.archQty || 0, archW: p.archW || 0, archH: p.archH || 0, pillarQty: p.pillarQty || 0, glassOn: !!p.glassT, glassT: p.glassT || null, glassQty: p.glassQty || 0, glassW: p.glassW || 0, glassH: p.glassH || 0 };
}

// ═══ Active soft-hold lookup (Deal Check inventory-status conflicts) — VERBATIM ═══
function getActiveSoftHold(softHolds, itemId, currentSalesperson, nowMs) {
  const h = softHolds?.[itemId];
  if (!h) return null;
  const expiryMs = typeof h.expiry === "number" ? h.expiry : Date.parse(h.expiry || "");
  if (!expiryMs || expiryMs <= (nowMs ?? Date.now())) return null;  // expired
  if (h.salesperson === currentSalesperson) return null;  // own hold, not a conflict
  return h;
}

// ════════════════════════════════════════════════════════════════════════════
// §23 PHASE 3 — Studio-side Layer 2+3 + truss soft-hold helpers — VERBATIM
// (mirrors IMS allocator so soft-hold drafts carry actual BOM, not just intent)
// ════════════════════════════════════════════════════════════════════════════

// ─── Layer 2 — Pillar Height Resolver (mirrors IMS) ──
const resolvePillarHeight = (H, trussInv) => {
  if (!H || H <= 0) return { pieces: [], joints: 0, shortage: true, reason: "Invalid height" };
  const inv = trussInv || {};
  const pillarSizes = Object.keys(inv.pillars || {}).map(Number).sort((a,b) => b - a);
  const beamSizes   = Object.keys(inv.beams   || {}).map(Number).sort((a,b) => b - a);
  if (pillarSizes.length === 0) return { pieces: [], joints: 0, shortage: true, reason: "No pillar sizes defined" };
  if (pillarSizes.includes(H)) {
    return { pieces: [{ type: "pillar", size: H, qty: 1 }], joints: 0, shortage: false };
  }
  for (const topPillar of pillarSizes) {
    if (topPillar >= H) continue;
    const gap = H - topPillar;
    if (beamSizes.includes(gap)) {
      return { pieces: [{ type: "beam", size: gap, qty: 1, position: "ground" }, { type: "pillar", size: topPillar, qty: 1, position: "top" }], joints: 1, shortage: false };
    }
    for (let i = 0; i < beamSizes.length; i++) {
      for (let j = i; j < beamSizes.length; j++) {
        if (beamSizes[i] + beamSizes[j] === gap) {
          return { pieces: [{ type: "beam", size: beamSizes[i], qty: 1, position: "ground" }, { type: "beam", size: beamSizes[j], qty: 1, position: "ground" }, { type: "pillar", size: topPillar, qty: 1, position: "top" }], joints: 1, shortage: false };
        }
      }
    }
  }
  return { pieces: [], joints: 0, shortage: true, reason: `Cannot assemble ${H}ft pillar from available sizes` };
};

// ─── Layer 3 — Beam Segment Resolver (mirrors IMS) ──
const resolveBeamSegment = (targetLength, trussInv) => {
  if (!targetLength || targetLength <= 0) return { pieces: [], joints: 0, shortage: false, gap: 0 };
  const MAX_GAP = 1.0;
  const inv = trussInv || {};
  const beamSizes = Object.keys(inv.beams || {}).map(Number).filter(n => n > 0).sort((a,b) => b - a);
  if (beamSizes.length === 0) return { pieces: [], joints: 0, shortage: true, reason: "No beam sizes" };

  const targetFloor = Math.floor(targetLength + 1e-9);
  const minAcceptable = Math.max(0, Math.ceil(targetLength - MAX_GAP - 1e-9));

  const candidates = [];
  const MAX_DEPTH = 6;
  const search = (remainingBudget, combo, startIdx, currentSum) => {
    if (currentSum >= minAcceptable && currentSum <= targetFloor) {
      candidates.push({ combo: [...combo], sum: currentSum });
    }
    if (combo.length >= MAX_DEPTH) return;
    if (remainingBudget < beamSizes[beamSizes.length - 1]) return;
    for (let i = startIdx; i < beamSizes.length; i++) {
      if (beamSizes[i] <= remainingBudget) {
        combo.push(beamSizes[i]);
        search(remainingBudget - beamSizes[i], combo, i, currentSum + beamSizes[i]);
        combo.pop();
      }
    }
  };
  search(targetFloor, [], 0, 0);

  if (candidates.length === 0) {
    const fallback = beamSizes.find(s => s <= targetFloor);
    if (fallback) return { pieces: [{ type: "beam", size: fallback, qty: 1 }], joints: 0, shortage: true, gap: targetLength - fallback, reason: `No combo within ${MAX_GAP}ft of ${targetLength}ft; closest under = ${fallback}ft` };
    return { pieces: [], joints: 0, shortage: true, reason: `No combo possible for ${targetLength}ft` };
  }

  let best = null;
  for (const cand of candidates) {
    const joints = cand.combo.length - 1;
    const gap = targetLength - cand.sum;
    const sizeCounts = {};
    cand.combo.forEach(s => { sizeCounts[s] = (sizeCounts[s] || 0) + 1; });
    let abundance = Infinity;
    Object.entries(sizeCounts).forEach(([sz, qty]) => {
      const stock = inv.beams[sz]?.stock || 0;
      const ratio = Math.log10(Math.max(stock - qty + 1, 1));
      if (ratio < abundance) abundance = ratio;
    });
    if (!isFinite(abundance)) abundance = 0;
    const cost = (100 * joints) + (10 * gap) + (1 * cand.combo.length) - (0.1 * abundance);
    if (!best || cost < best.cost) best = { cost, joints, gap, sizeCounts, sum: cand.sum };
  }

  const piecesArr = Object.entries(best.sizeCounts).map(([sz, qty]) => ({ type: "beam", size: parseFloat(sz), qty })).sort((a, b) => b.size - a.size);
  return { pieces: piecesArr, joints: best.joints, shortage: false, cost: best.cost, gap: best.gap, rounded: best.sum !== targetLength };
};

// ─── allocateTruss (mirrors IMS Phase 2) ──
const allocateTruss = (zoneId, topology, trussInv) => {
  if (!topology) return null;
  const inv = trussInv || {};
  const result = {
    trussId: `T-${zoneId}`,
    zone: zoneId,
    trussConfig: topology.config,
    method: topology.method,
    pillarCount: topology.pillarCount,
    pillars: [],
    beamSegments: [],
    totals: { pillarsUsed: {}, beamsUsed: {}, totalJoints: 0, physicalL: topology.physicalL, physicalW: topology.physicalW },
    shortage: false,
    shortageNotes: [],
  };
  topology.pillars.forEach((p, idx) => {
    const r = resolvePillarHeight(p.H, inv);
    result.pillars.push({ id: p.id, H: p.H, pieces: r.pieces, joints: r.joints });
    result.totals.totalJoints += r.joints;
    if (r.shortage) { result.shortage = true; result.shortageNotes.push(`${p.id}: ${r.reason}`); }
    r.pieces.forEach(pc => {
      if (pc.type === "pillar") result.totals.pillarsUsed[pc.size] = (result.totals.pillarsUsed[pc.size] || 0) + pc.qty;
      else                       result.totals.beamsUsed[pc.size]   = (result.totals.beamsUsed[pc.size]   || 0) + pc.qty;
    });
  });
  topology.beams.forEach(b => {
    const r = resolveBeamSegment(b.lengthFt, inv);
    result.beamSegments.push({ side: b.side, lengthFt: b.lengthFt, pieces: r.pieces, joints: r.joints });
    result.totals.totalJoints += r.joints;
    if (r.shortage) { result.shortage = true; result.shortageNotes.push(`Beam ${b.side} (${b.lengthFt}ft): ${r.reason}`); }
    r.pieces.forEach(pc => {
      result.totals.beamsUsed[pc.size] = (result.totals.beamsUsed[pc.size] || 0) + pc.qty;
    });
  });
  return result;
};

// ─── Helper — Build truss soft-hold event entry for an entire fn list — VERBATIM ──
const buildSoftHoldEntry = ({ clientId, clientName, salesperson, fnList, trussInv, expiry, eventDate }) => {
  const trusses = [];
  (fnList || []).forEach(fn => {
    const zc = fn?.zoneConfig || {};
    const en = fn?.enabledEls || {};
    Object.entries(zc).forEach(([zoneKey, z]) => {
      if (!z) return;
      if (en && Object.keys(en).length > 0 && !en[zoneKey]) return;
      const layer0 = resolveTrussConfig(z);
      if (!layer0 || layer0.source === "none" || layer0.source === "invalid") return;
      const eng = trussInv?.settings || {};
      const L = parseFloat(z.dims?.L) || 0;
      const W = parseFloat(z.dims?.W) || 0;
      const H = parseFloat(z.dims?.H) || 0;
      const spanFt = layer0.spanFt || (layer0.source === "auto-3dim" ? Math.max(L, W) : 0);
      const backDepth = z.trussBackDepth || eng.defaultBackDepthFt || 4;
      const topology = buildTopology(layer0.config, L, W, H, spanFt, backDepth, eng);
      if (!topology) return;
      const alloc = allocateTruss(`${fn.fnIdx || 0}-${zoneKey}`, topology, trussInv);
      if (!alloc) return;
      trusses.push({
        fnIdx: fn.fnIdx ?? 0,
        zoneKey,
        trussConfig: layer0.config,
        allocation: alloc,
        shortage: !!alloc.shortage,
      });
    });
  });
  if (trusses.length === 0) return null;
  // Aggregate totals
  const totalPillarsUsed = {};
  const totalBeamsUsed   = {};
  let totalJoints = 0;
  trusses.forEach(t => {
    Object.entries(t.allocation.totals.pillarsUsed || {}).forEach(([sz, q]) => { totalPillarsUsed[sz] = (totalPillarsUsed[sz] || 0) + q; });
    Object.entries(t.allocation.totals.beamsUsed   || {}).forEach(([sz, q]) => { totalBeamsUsed[sz]   = (totalBeamsUsed[sz]   || 0) + q; });
    totalJoints += t.allocation.totals.totalJoints || 0;
  });
  return {
    eoId: `soft-${clientId}`,        // soft-hold pseudo-eoId; promoted to real EO id on SOLD
    clientId,
    clientName,
    fnIdx: 0,
    state: "soft",
    expiry: expiry || (Date.now() + 24 * 60 * 60 * 1000),
    heldBy: salesperson || "—",
    createdAt: Date.now(),
    eventDate: eventDate || "",
    trusses,
    totalPillarsUsed,
    totalBeamsUsed,
    totalJoints,
    shortageBorne: false,
  };
};

// ═══ DEAL CHECK REBUILD HELPERS (§7.9 · Deploy 1) — VERBATIM ═══

// §7.9.5 — match an RC element by code (F01..F12) OR name fragment to a hard-prop entry.
function lookupFloralMapping(rcCode, rcName, hardPropMap) {
  const map = hardPropMap || FLORAL_HARDPROP_DEFAULT;
  if (rcCode && map[rcCode]) return map[rcCode];
  const n = String(rcName || "").toLowerCase();
  if (/coffee\s*table/.test(n)) return map["F07"] || FLORAL_HARDPROP_DEFAULT["F07"];
  if (/cocktail\s*table/.test(n)) return map["F08"] || FLORAL_HARDPROP_DEFAULT["F08"];
  if (/console\s*table/.test(n)) return map["F12"] || FLORAL_HARDPROP_DEFAULT["F12"];
  if (/couple\s*couch|couch\s*flow/.test(n)) return map["F11"] || FLORAL_HARDPROP_DEFAULT["F11"];
  if (/centerp|round\s*table/.test(n)) return map["F09"] || FLORAL_HARDPROP_DEFAULT["F09"];
  if (/flower\s*pot|flower\s*planter/.test(n)) return map["F05"] || FLORAL_HARDPROP_DEFAULT["F05"];
  if (/floral\s*reet|garland|petals?|flower\s*garden/.test(n)) return [];
  return null;
}

// §7.9.8 — cardKey builders.
function buildElCardKey(zoneKey, rcName, idx) {
  return `el::${zoneKey || ""}::${rcName || ""}::${idx ?? 0}`;
}
function buildFlCardKey(zoneKey, rcName, idx, propType) {
  return `fl::${zoneKey || ""}::${rcName || ""}::${idx ?? 0}::${propType || "x"}`;
}
function parseCardKey(key) {
  if (!key || typeof key !== "string") return null;
  const parts = key.split("::");
  if (parts[0] === "el" && parts.length === 4) {
    return { kind: "el", zoneKey: parts[1], rcName: parts[2], idx: Number(parts[3]) || 0 };
  }
  if (parts[0] === "fl" && parts.length === 5) {
    return { kind: "fl", zoneKey: parts[1], rcName: parts[2], idx: Number(parts[3]) || 0, propType: parts[4] };
  }
  return null;
}

// §7.9.6 #5 — dirty-zone-only re-runs.
function isZoneDirty(zoneState, dcCards, fnIdx, zoneKey) {
  const lastEditedAt = zoneState?.[fnIdx]?.[zoneKey]?.lastEditedAt;
  if (!lastEditedAt) return true;  // never resolved → always dirty
  const cards = dcCards?.[fnIdx] || {};
  let earliestResolved = Infinity;
  let foundAny = false;
  for (const k of Object.keys(cards)) {
    const parsed = parseCardKey(k);
    if (!parsed || parsed.zoneKey !== zoneKey) continue;
    foundAny = true;
    const r = cards[k]?.resolvedAt;
    if (!r) return true;  // any unresolved card → dirty
    if (r < earliestResolved) earliestResolved = r;
  }
  if (!foundAny) return true;  // no cards yet → dirty
  return lastEditedAt > earliestResolved;
}

// §7.9.6 #1 — filter IMS catalog to items matching a subcategory (case-insensitive).
function filterImsBySubcategory(imsItems, subcategory) {
  if (!Array.isArray(imsItems)) return [];
  if (!subcategory) return imsItems;
  const target = String(subcategory).toLowerCase().trim();
  const matches = imsItems.filter(i => String(imsField.subcategory(i)).toLowerCase().trim() === target);
  return matches.length > 0 ? matches : imsItems;  // fallback to full catalog if no subcat match
}

// §7.9.6 #2 — name-match shortcut.
function nameMatchUnique(rcName, scopedItems) {
  if (!rcName || !Array.isArray(scopedItems)) return { matched: false, item: null };
  const target = String(rcName).toLowerCase().trim();
  if (!target) return { matched: false, item: null };
  const hits = scopedItems.filter(i => String(i?.name || "").toLowerCase().trim() === target);
  if (hits.length === 1) return { matched: true, item: hits[0] };
  return { matched: false, item: null };
}

// §7.9.4 #2 + §7.9.5 — derive all expected card specs for a zone.
function getCardSpecsForZone(zoneElems, zoneKey, photoUrl, hardPropMap, rcItems) {
  if (!Array.isArray(zoneElems) || zoneElems.length === 0) return [];
  const out = [];
  const rcArr = Array.isArray(rcItems) ? rcItems : [];
  zoneElems.forEach((el, idx) => {
    if (!el) return;
    const rcName = el.name || "";
    if (!rcName) return;
    const qty = Number(el.qty) || 0;
    if (qty <= 0) return;  // skip elements with 0 qty (toggled off but still in array)
    const rc = rcArr.find(i => String(i?.name || "").toLowerCase() === String(rcName).toLowerCase());
    const rcCode = rc?.id || "";
    // IMS sub-category alias: a Studio placeholder ("Centre Piece") auto-matches against its aliased IMS
    // sub-category ("Flower Pot Large") so cards resolve to the real shared stock. Blank alias = own sub.
    const subcategory = (rc?.imsAlias ? String(rc.imsAlias).trim() : "") || rc?.sub || "";
    const cat = String(rc?.cat || "").toLowerCase();
    const isFloral = cat === "florals" || /^F\d+$/.test(rcCode);
    if (isFloral) {
      const mapping = lookupFloralMapping(rcCode, rcName, hardPropMap);
      if (!Array.isArray(mapping) || mapping.length === 0) return;  // F01-F04 or unknown floral → no card
      mapping.forEach((spec, mIdx) => {
        out.push({
          cardKey: buildFlCardKey(zoneKey, rcName, idx, spec.propType),
          kind: "fl",
          rcName, rcCode, qty,
          subcategory,  // from rc.sub — single source of truth (21 May 2026)
          propType: spec.propType,
          photoUrl,
          // Build-view manual stock pick (deal-local) — forces this exact IMS item. Only for a single-prop
          // floral element (unambiguous); multi-prop mappings keep auto-match.
          pinnedImsId: (mapping.length === 1 && el?.imsId) ? el.imsId : null,
          dualCardIdx: mapping.length > 1 ? mIdx : null,
        });
      });
    } else {
      out.push({
        cardKey: buildElCardKey(zoneKey, rcName, idx),
        kind: "el",
        rcName, rcCode, qty,
        subcategory,
        propType: null,
        photoUrl,
        pinnedImsId: el?.imsId || null, // Build-view manual stock pick (deal-local) — forces this IMS item
      });
    }
  });
  return out;
}

// §7.9.4 #3 + §7.9.6 — element-first AI matcher with subcategory-scoped catalog.
// REWIRED: posts through callClaudeStreaming (Supabase Edge Function) instead of /api/anthropic.
async function aiMatchCardWithSubcat(cardSpec, scopedItems, signal) {
  if (!Array.isArray(scopedItems) || scopedItems.length === 0) return { primary: null, alternatives: [] };
  // Split candidates: those WITH a photo (for true visual comparison, capped for cost/latency) and
  // the rest listed name-only. Bound total to 40 names as before. Cap images at 6 — enough to pick
  // the right variant while keeping each vision call fast (10 images was noticeably slow).
  const MAX_IMG = 6;
  const withPhoto = [], noPhoto = [];
  for (const i of scopedItems) {
    const rec = { id: i.id, name: i.name, cat: imsField.category(i), subCat: imsField.subcategory(i), size: imsField.sizeText(i), qty: imsField.qtyOwned(i), photo: imsField.photos(i)[0] || null };
    if (rec.photo && withPhoto.length < MAX_IMG) withPhoto.push(rec); else noPhoto.push(rec);
  }
  const textOnly = noPhoto.slice(0, Math.max(0, 40 - withPhoto.length)).map(({ photo, ...r }) => r);
  const useVision = !!cardSpec.photoUrl && withPhoto.length > 0;
  const intro = "You are an inventory matcher for Ambria Decorations. Match a Rate Card element to the best IMS inventory item.\n\n" +
    "RC element details:\n" +
    "  name: " + (cardSpec.rcName || "(unknown)") + "\n" +
    "  subcategory: " + (cardSpec.subcategory || "(unscoped)") + "\n" +
    (cardSpec.propType ? "  prop type: " + cardSpec.propType + " (this is a floral hard-prop card — match to the physical vessel/stand, not the flowers)\n" : "") +
    (useVision
      ? "\nVISUAL MATCH: the FIRST image is the DESIGN PHOTO (the look the client wants). Each image after it is an IMS inventory candidate, preceded by a line with its [id] and name. Find the '" + (cardSpec.rcName || "element") + "' in the design photo, then pick the candidate whose photo looks MOST similar (shape, style, colour, material). Use names only to break ties. If the item isn't clearly visible, fall back to the best name/subcategory match.\n"
      : (cardSpec.photoUrl
          ? "\nA design photo of this zone is attached. Find the '" + (cardSpec.rcName || "element") + "' within it and match the closest candidate by appearance + name.\n"
          : "")) +
    "\n";
  const tail = (textOnly.length ? "Additional candidates (name only, no photo):\n" + JSON.stringify(textOnly, null, 2) + "\n\n" : "") +
    "Return ONLY valid JSON, no markdown:\n" +
    "{ \"primary\": { \"imsId\": \"X-####\", \"reasoning\": \"short why\" }, \"alternatives\": [ { \"imsId\": \"X-####\" }, { \"imsId\": \"X-####\" }, { \"imsId\": \"X-####\" } ] }\n\n" +
    "If nothing matches reasonably, return: { \"primary\": null, \"alternatives\": [] }";
  try {
    if (signal?.aborted) return { primary: null, alternatives: [], aborted: true };
    let contentBlocks;
    if (useVision) {
      // Interleave: instructions → design photo → each candidate's photo with its id/name → JSON ask.
      // This lets the AI compare the design against every IMS item's ACTUAL photo, not just names.
      contentBlocks = [{ type: "text", text: intro + "DESIGN PHOTO (match to this):" }, { type: "image", source: { type: "url", url: cardSpec.photoUrl } }];
      withPhoto.forEach(r => {
        contentBlocks.push({ type: "text", text: `Candidate [${r.id}] ${r.name}${r.size ? " · " + r.size : ""} (qty ${r.qty}):` });
        contentBlocks.push({ type: "image", source: { type: "url", url: r.photo } });
      });
      contentBlocks.push({ type: "text", text: tail });
    } else {
      // No design photo, or no candidate has a photo → name/subcategory match (with design photo if present).
      const prompt = intro + "Candidate IMS items (already scoped to subcategory):\n" + JSON.stringify([...withPhoto.map(({ photo, ...r }) => r), ...textOnly], null, 2) + "\n\n" + tail;
      contentBlocks = cardSpec.photoUrl
        ? [{ type: "image", source: { type: "url", url: cardSpec.photoUrl } }, { type: "text", text: prompt }]
        : prompt;
    }
    const text = await callClaudeStreaming({
      contentBlocks,
      model: "claude-sonnet-4-6",
      maxTokens: 800,
    });
    const clean = (text || "").replace(/```json|```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch { return { primary: null, alternatives: [] }; }
    // Hydrate names from full scopedItems list
    if (parsed?.primary?.imsId) {
      const item = scopedItems.find(i => i.id === parsed.primary.imsId);
      if (item) parsed.primary.name = item.name;
    }
    parsed.alternatives = (parsed?.alternatives || []).map(alt => {
      const item = scopedItems.find(i => i.id === alt?.imsId);
      return item ? { imsId: alt.imsId, name: item.name } : null;
    }).filter(Boolean);
    return parsed;
  } catch (e) {
    if (e?.name === "AbortError") return { primary: null, alternatives: [], aborted: true };
    console.error("[dc-rebuild] aiMatchCardWithSubcat failed:", e);
    return { primary: null, alternatives: [] };
  }
}

// Claude Vision call — matches a design photo to the best IMS inventory item.
// REWIRED through callClaudeStreaming (image-URL block + text prompt).
async function matchPhotoWithAI(photoUrl, photoMetadata, inventoryList) {
  const tags = (photoMetadata?.elements || []).map(t => (t?.name || "").toLowerCase()).filter(Boolean);
  let candidates = inventoryList;
  if (tags.length > 0) {
    const filtered = inventoryList.filter(i => {
      const name = (i.name || "").toLowerCase();
      const cat = (i.cat || "").toLowerCase();
      const subCat = (i.subCat || "").toLowerCase();
      return tags.some(t => name.includes(t) || cat.includes(t) || subCat.includes(t));
    });
    if (filtered.length > 0) candidates = filtered;
  }
  candidates = candidates.slice(0, 50);
  if (candidates.length === 0) return { primary: null, alternatives: [] };
  const invList = candidates.map(i => ({ id: i.id, name: i.name, cat: i.cat, subCat: i.subCat, size: i.size, qty: i.qty }));
  const prompt = "You are an expert decor inventory matcher for Ambria Decorations. Look at the attached photo from our wedding/event decoration library.\n\n" +
    "Identify the MAIN physical prop or structural element shown (arch, mandap, console, backdrop, pedestal, etc.). Ignore decorative fills like flowers, candles, fabric unless they ARE the main item.\n\n" +
    "Match to the best candidate from this IMS inventory list:\n" + JSON.stringify(invList, null, 2) + "\n\n" +
    "Photo element tags: " + (tags.join(", ") || "(none)") + "\n\n" +
    "Return ONLY valid JSON, no markdown, no preamble:\n" +
    "{\n  \"primary\": { \"imsId\": \"X####\", \"confidence\": \"high\"|\"medium\"|\"low\", \"reasoning\": \"short why\" },\n" +
    "  \"alternatives\": [ { \"imsId\": \"X####\" }, { \"imsId\": \"X####\" }, { \"imsId\": \"X####\" } ]\n}\n\n" +
    "If nothing reasonably matches, return: { \"primary\": null, \"alternatives\": [] }";
  try {
    const text = await callClaudeStreaming({
      contentBlocks: [
        { type: "image", source: { type: "url", url: photoUrl } },
        { type: "text", text: prompt },
      ],
      model: "claude-sonnet-4-6",
      maxTokens: 1000,
    });
    const clean = (text || "").replace(/```json|```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch { return { primary: null, alternatives: [] }; }
    if (parsed?.primary?.imsId) {
      const item = inventoryList.find(i => i.id === parsed.primary.imsId);
      if (item) parsed.primary.name = item.name;
    }
    parsed.alternatives = (parsed?.alternatives || []).map(alt => {
      const item = inventoryList.find(i => i.id === alt.imsId);
      return item ? { imsId: alt.imsId, name: item.name } : alt;
    }).filter(a => a?.imsId);
    return parsed;
  } catch (e) {
    console.error("[preflight] matchPhotoWithAI failed:", e);
    return { primary: null, alternatives: [] };
  }
}

// Resolve a photo URL to IMS ID. Order: event override → global cache → AI fallback. — VERBATIM
async function resolvePhotoToIMS(photoUrl, photoMetadata, eventOverrides, imsInventory, photoImsMap) {
  if (eventOverrides && eventOverrides[photoUrl]) {
    const imsId = eventOverrides[photoUrl];
    const item = imsInventory.find(i => i.id === imsId);
    return { imsId, source: "override", name: item?.name || null, alternatives: [], aiCalled: false };
  }
  const cached = photoImsMap ? photoImsMap[photoUrl] : null;
  if (cached && cached.primary && cached.primary.imsId) {
    const item = imsInventory.find(i => i.id === cached.primary.imsId);
    if (!item) {
      return { imsId: null, source: "stale_cache", name: null, alternatives: [], aiCalled: false };
    }
    return {
      imsId: cached.primary.imsId,
      source: "cache",
      name: item.name,
      confidence: cached.primary.confidence,
      alternatives: cached.alternatives || [],
      aiCalled: false
    };
  }
  const aiResult = await matchPhotoWithAI(photoUrl, photoMetadata, imsInventory);
  if (!aiResult?.primary?.imsId) {
    return { imsId: null, source: "ai_no_match", name: null, alternatives: [], aiCalled: true };
  }
  const item = imsInventory.find(i => i.id === aiResult.primary.imsId);
  const cacheEntry = {
    primary: { imsId: aiResult.primary.imsId, confidence: aiResult.primary.confidence, name: item?.name, reasoning: aiResult.primary.reasoning },
    alternatives: aiResult.alternatives || [],
    lastScanned: Date.now(),
    timesUsed: 1,
    correctionsCount: 0
  };
  return {
    imsId: aiResult.primary.imsId,
    source: "ai",
    name: item?.name || null,
    confidence: aiResult.primary.confidence,
    alternatives: aiResult.alternatives || [],
    aiCalled: true,
    cacheUpdate: { [photoUrl]: cacheEntry }
  };
}

// ═══ IMS field accessor shim (used by Deal Check cost rollups) — VERBATIM ═══
const imsField = {
  category: (i) => i?.category || i?.cat || "",
  subcategory: (i) => i?.subcategory || i?.subCat || "",
  rentalCost: (i) => Number(i?.rentalCost ?? i?.price ?? 0) || 0,
  qtyOwned: (i) => Number(i?.qtyOwned ?? i?.qty ?? 0) || 0,
  photos: (i) => Array.isArray(i?.photoUrls) && i.photoUrls.length ? i.photoUrls : (i?.img ? [i.img] : []),
  dims: (i) => i?.dims_LxWxH || null,
  sizeText: (i) => i?.size || (() => { const d = i?.dims_LxWxH; return d ? [d.l, d.w, d.h].filter(Boolean).join(" × ") + (d.unit ? " " + d.unit : "") : ""; })(),
};

// ═══ MULTI-FUNCTION EVENT HELPERS — VERBATIM (ensureFunctionsArray / ensureAllEventsWrapped) ═══
const FN_DEFAULT_SLOT = "evening";
const ensureFunctionsArray = (ev) => {
  if (!ev || typeof ev !== "object") return ev;
  if (Array.isArray(ev.functions) && ev.functions.length > 0) {
    const fn0 = ev.functions[0] || {};
    return {
      ...ev,
      date: fn0.date ?? ev.date,
      fn: fn0.type ?? ev.fn,
      venue: fn0.venue ?? ev.venue,
    };
  }
  const fn0 = {
    id: "fn_" + (ev.id || Date.now()) + "_0",
    type: ev.fn || "Wedding",
    date: ev.date || "",
    slot: ev.slot || FN_DEFAULT_SLOT,
    venue: ev.venue || "",
    enabledEls: ev.enabledEls || [],
    itemQtys: ev.itemQtys || {},
    itemGrades: ev.itemGrades || {},
    zones: ev.zones || [],
    photos: ev.photos || [],
  };
  return { ...ev, functions: [fn0] };
};
const ensureAllEventsWrapped = (events) => (Array.isArray(events) ? events.map(ensureFunctionsArray) : []);

// ═══ TEMPLATE LOOKUP — VERBATIM ═══
function findTemplate(id, tplList) { return (tplList || TPL_DEFAULTS).find(t => t.id === id) || null; }

// ═══ §23 Phase 2.9d — Paint Allocation helpers — VERBATIM ═══
const PAINT_TOKENS_FALLBACK = ["truss", "struct", "mask", "platform", "carpet", "furniture", "arch", "prop", "panel", "pillar", "glass", "stage", "wrought", "consumable"];
function isSubcatPaintable(rcSub, imsInventory) {
  if (!imsInventory || imsInventory.length === 0) return null; // null = "use fallback"
  if (!rcSub) return false;
  const target = String(rcSub).toLowerCase().trim();
  return imsInventory.some(item => {
    const sub = String(item.subcategory || item.subCat || item.sub || "").toLowerCase().trim();
    return sub === target && Number(item.paintCost || 0) > 0;
  });
}
function maxRepaintCostInSubcat(rcSub, imsInventory, fallback) {
  if (!imsInventory || imsInventory.length === 0 || !rcSub) return fallback;
  const target = String(rcSub).toLowerCase().trim();
  let mx = 0;
  imsInventory.forEach(item => {
    const sub = String(item.subcategory || item.subCat || item.sub || "").toLowerCase().trim();
    if (sub === target) {
      const pc = Number(item.paintCost || 0);
      if (pc > mx) mx = pc;
    }
  });
  return mx > 0 ? mx : fallback;
}
// ── Truck count from per-SUB-CATEGORY capacities (carpenter-style: ⌈Σ(qty ÷ capacity)⌉) ──
// Each truckCap entry is keyed by sub-category name (`item`), with `perTruck` (capacity) + `unit`
// (pcs / sqft per truck). Capacity 0 → that sub-category is skipped. Deal items are aggregated by
// their rate-card sub-category; truss / platform / carpet contribute sqft via the zone config.
function computeTruckItems(zoneElements, zoneConfig, enabledEls, rcItems, truckCap) {
  const capBySub = {};
  (truckCap || []).forEach(tc => { if ((Number(tc.perTruck) || 0) > 0) capBySub[String(tc.item || "").toLowerCase().trim()] = tc; });
  const subAgg = {}; // subLower → { label, qty, perTruck, unit }
  const addSub = (subName, qty) => {
    const key = String(subName || "").toLowerCase().trim(); const tc = capBySub[key]; if (!tc || !(qty > 0)) return;
    if (!subAgg[key]) subAgg[key] = { label: tc.item, qty: 0, perTruck: Number(tc.perTruck) || 0, unit: tc.unit || "pc" };
    subAgg[key].qty += qty;
  };
  Object.entries(zoneElements || {}).forEach(([zk, elems]) => {
    if (!enabledEls[zk] || !elems) return;
    elems.forEach(el => {
      const rc = rcItems.find(i => String(i.name || "").toLowerCase() === String(el.name || "").toLowerCase());
      if (!rc) return;
      const tc = capBySub[String(rc.sub || "").toLowerCase().trim()]; if (!tc) return;
      if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(rc.sub, L * W * (Number(el.qty) || 1)); }
      else addSub(rc.sub, Number(el.qty) || 0);
    });
  });
  Object.entries(zoneConfig || {}).forEach(([zk, cfg]) => {
    if (!enabledEls[zk] || !cfg) return;
    const dims = cfg.dims || {}; const sqft = (Number(dims.w) || 0) * (Number(dims.d) || 0); if (sqft <= 0) return;
    if (cfg.trT) addSub("Truss", sqft * Math.max(1, Number(cfg.trussQty) || 1));
    if (cfg.plH) addSub("Platform", sqft);
    if (cfg.cpT) addSub("Carpet", sqft);
  });
  let frac = 0; const breakdown = [];
  Object.values(subAgg).forEach(s => { const f = s.perTruck > 0 ? s.qty / s.perTruck : 0; frac += f; breakdown.push({ label: s.label, qty: Math.round(s.qty), perTruck: s.perTruck, unit: s.unit, trucks: f }); });
  return { itemTrucks: Math.ceil(frac), truckFraction: frac, breakdown };
}
function normalizePaintAllocation(el, baseColour) {
  if (!el) return [];
  const totalQty = Number(el.qty) || 0;
  if (totalQty <= 0) return [];
  if (Array.isArray(el.paintAllocation) && el.paintAllocation.length > 0) {
    return el.paintAllocation
      .filter(a => a && Number(a.qty) > 0 && a.colour && a.colour !== baseColour)
      .map(a => ({ qty: Number(a.qty), colour: String(a.colour) }));
  }
  if (el.paintOverride && el.paintOverride !== baseColour) {
    return [{ qty: totalQty, colour: String(el.paintOverride) }];
  }
  return [];
}
function paintPillLabel(el, baseColour) {
  const allocs = normalizePaintAllocation(el, baseColour);
  if (allocs.length === 0) return baseColour || "Ivory";
  if (allocs.length === 1) {
    const a = allocs[0];
    const totalQty = Number(el.qty) || 0;
    return a.qty === totalQty ? a.colour : `${a.colour} ×${a.qty}`;
  }
  return `${allocs.length} colours`;
}

// ═══ IMS cross-fetch — REWIRED to Supabase (Part 2). §25 LMS lead search is LIVE.
// Reads inventory (inventory table → rowToItem) + blocks (now the `blocks` TABLE, row-per-item).
// Returns the same per-date shape the reference returned: { inventory, blocksForDate }.
// blocksForDate: { imsId: totalBlockedQty for that date }.
async function fetchIMSData(date) {
  try {
    const [invRows, blockRows] = await Promise.all([
      fetchAll("inventory").catch(() => []),
      fetchAll("blocks").catch(() => []),
    ]);
    let inventory = Array.isArray(invRows) ? invRows.map(rowToItem).filter(Boolean) : [];
    // blocks table is row-per-item: { id/item_id, data: [reservations] } → { itemId: [reservations] }
    const blocks = {};
    for (const r of (Array.isArray(blockRows) ? blockRows : [])) { const id = r.item_id || r.id; if (id) blocks[id] = Array.isArray(r.data) ? r.data : []; }
    const blocksForDate = {};
    for (const [imsId, blockList] of Object.entries(blocks)) {
      if (!Array.isArray(blockList)) continue;
      const total = blockList
        .filter(b => b && b.date === date && (b.status === "confirmed" || b.status === "final" || b.status === "held"))
        .reduce((sum, b) => sum + (Number(b.qty) || 0), 0);
      if (total > 0) blocksForDate[imsId] = total;
    }
    return { inventory, blocksForDate };
  } catch (e) {
    console.error("[preflight] fetchIMSData failed:", e);
    return null;
  }
}

// ═══ Studio library ═══
// The `library` table is no longer loaded whole into memory — `rowToLibItem`/`libItemToRow`
// (server-side pagination query layer) live in ../../lib/studio/libraryQueries.js. `libItems`
// below is a lazily-populated cache of whatever's been fetched this session (browse page, zone
// match, point lookup, KB, bulk tag) — see `mergeLibItems`, not "the whole table".

// truss_allocations row → in-memory entry (mirrors IMS rowToAlloc): pool spread + date + events.
function rowToAlloc(row) { return { ...(row.pool || {}), date: row.date, events: row.events || [] }; }

// ═══ Event orders ↔ `event_orders` TABLE (migrated off the EO_SK blob; shared Studio↔IMS) ═══
// IMS already persists this table row-level; Studio now reads/writes the SAME table so it finally
// sees IMS-owned fields (deptOps / dept actuals) live — the missing link behind stale Dept-Ops data.
// Full eo in `data`; column map mirrors IMS's writer exactly.
function rowToEO(row) { return { ...(row?.data || {}), id: row.id, status: row.status ?? row?.data?.status }; }
function eoToRow(eo) {
  return { id: eo.id, client_name: eo.clientName ?? null, event_id: eo.eventId ?? null, fn_id: eo.fnId ?? null, status: eo.status ?? "pending", items: eo.items || [], manual_items: eo.manualItems || [], decisions: eo.decisions || {}, data: eo };
}
async function loadEoRows() {
  const all = []; const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await supabase.from("event_orders").select("*").order("id").range(from, from + SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < SIZE) break;
  }
  return all;
}

// ═══ Rate card ↔ `rate_card` TABLE mappers (migrated off the settings blob; shared Studio↔IMS) ═══
// Full item in `data`; typed columns mirrored for queries. IMS reads/writes the SAME table now.
function rowToRcItem(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  if (d) return { zones: [], ...d, id: row.id };
  return { id: row.id, name: row.name, cat: row.cat, sub: row.sub, unit: row.unit, inhouseMode: row.inhouse_mode, inhouseFlat: row.inhouse_flat, inhouseS: row.inhouse_s, inhouseM: row.inhouse_m, inhouseB: row.inhouse_b, outS: row.out_s, outM: row.out_m, outB: row.out_b, zones: Array.isArray(row.zones) ? row.zones : [], floralMode: row.floral_mode, defaultRealPct: row.default_real_pct };
}
function rcItemToRow(it) {
  return {
    id: it.id, name: it.name || "", cat: it.cat ?? null, sub: it.sub ?? null, unit: it.unit ?? null,
    inhouse_mode: it.inhouseMode ?? "flat", inhouse_flat: Number(it.inhouseFlat) || 0,
    inhouse_s: Number(it.inhouseS) || 0, inhouse_m: Number(it.inhouseM) || 0, inhouse_b: Number(it.inhouseB) || 0,
    out_s: Number(it.outS) || 0, out_m: Number(it.outM) || 0, out_b: Number(it.outB) || 0,
    zones: Array.isArray(it.zones) ? it.zones : [], floral_mode: it.floralMode ?? null,
    default_real_pct: it.defaultRealPct ?? null, data: it,
  };
}
async function loadRcRows() {
  const all = []; const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await supabase.from("rate_card").select("*").order("id").range(from, from + SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < SIZE) break;
  }
  return all;
}

// ═══ Client ledger ↔ `client_ledger` TABLE mappers (migrated off the settings blob) ═══
// Full client object in `data`; typed columns (name/phone/email/status/budget/created_by) mirrored.
function rowToClient(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  const base = d ? { ...d, id: row.id } : { id: row.id, name: row.name, phone: row.phone, email: row.email, budget: row.budget };
  return { ...base, status: base.status || row.status || "ongoing", createdBy: base.createdBy || row.created_by || "—" };
}
function clientToRow(c) {
  return {
    id: c.id, name: c.name || "", phone: c.phone ?? null, email: c.email ?? null,
    status: c.status || "ongoing", budget: Number(c.budget) || 0, created_by: c.createdBy ?? null,
    data: c,
  };
}
async function loadClientRows() {
  const all = []; const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await supabase.from("client_ledger").select("*").order("id").range(from, from + SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < SIZE) break;
  }
  return all;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function StudioApp() {
  // Auth comes from the app's context (route is already gated). authUser keeps the
  // reference's shape ({id,name,role,perms}). hasPerm/isAdmin derive from it verbatim.
  const { user, logout } = useAuth();
  const authUser = user
    ? { id: user.id || user.username || user.name, name: user.name || user.username || "User", role: user.role || "sales", perms: user.permissions || user.perms || {} }
    : null;

  // ═══ APP MODE ═══
  // Remember the last open Studio view so toggling to IMS and back returns here.
  const [mode, setMode] = useState(() => sessionStorage.getItem("ambria-studio-mode") || "studio"); // studio | manage
  const [events, setEvents] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(true);
  const [toast, setToast] = useState(null);

  // ═══ ADMIN STATE ═══
  const [editEv, setEditEv] = useState(null);
  const [manageTab, setManageTab] = useState(() => sessionStorage.getItem("ambria-studio-manage-tab") || "library");
  useEffect(() => { sessionStorage.setItem("ambria-studio-mode", mode); }, [mode]);
  useEffect(() => { sessionStorage.setItem("ambria-studio-manage-tab", manageTab); }, [manageTab]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [evEditPhotoIdx, setEvEditPhotoIdx] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkTarget, setBulkTarget] = useState(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminFilterV, setAdminFilterV] = useState("All");
  const [adminFilterC, setAdminFilterC] = useState("All");
  const [previewImg, setPreviewImg] = useState(null);

  // ═══ LIBRARY STATE ═══
  const [libView, setLibView] = useState("images");
  const [libShowBulk, setLibShowBulk] = useState(false);
  const [pricingView, setPricingView] = useState("rates");
  const [settingsView, setSettingsView] = useState("venues");
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calSelDate, setCalSelDate] = useState(null);
  const [calEditMode, setCalEditMode] = useState(false);
  const [calSelectedDates, setCalSelectedDates] = useState([]);
  const [calLmsData, setCalLmsData] = useState(null);
  const [calView, setCalView] = useState("booked");
  const [calSeasonData, setCalSeasonData] = useState(null);
  const [ctFilterSp, setCtFilterSp] = useState("");
  const [ctFilterStatus, setCtFilterStatus] = useState("all");
  const [ctFilterFrom, setCtFilterFrom] = useState("");
  const [ctFilterTo, setCtFilterTo] = useState("");
  const [ctExpandedId, setCtExpandedId] = useState(null);
  const [taxonomy, setTaxonomy] = useState(DEFAULT_TAX);
  const [libItems, setLibItems] = useState([]);
  const [corrLog, setCorrLog] = useState([]); // append-only photo-correction log (who/what/when)
  const corrLogRef = useRef([]);
  const [tagKB, setTagKB] = useState(null); // AI-tagging knowledge base distilled from verified photos
  const tagKBRebuildRef = useRef(false);    // guards the auto-rebuild from firing more than once per load
  const [tagCorrections, setTagCorrections] = useState([]); // recent per-field corrections, fed into the tagging prompt
  const refreshTagCorrections = useCallback(() => { fetchRecentCorrections(20).then(setTagCorrections).catch(() => {}); }, []);
  useEffect(() => { refreshTagCorrections(); }, [refreshTagCorrections]);
  // Global daily AI-tagging cap (temporary). Counter persisted in settings so it holds across reloads/users.
  const aiTagQuotaRef = useRef({ date: "", count: 0 });
  const aiTagCountToday = () => { const q = aiTagQuotaRef.current; return q && q.date === new Date().toISOString().slice(0, 10) ? (q.count || 0) : 0; };
  const aiTagBump = () => { const today = new Date().toISOString().slice(0, 10); const next = { date: today, count: aiTagCountToday() + 1 }; aiTagQuotaRef.current = next; reliableSave(AITAG_QUOTA_SK, JSON.stringify(next), "AI tag quota").catch(() => {}); };
  const libItemsRef = useRef([]); // latest library array, for the background bulk-tagger to merge into
  const [bulkTag, setBulkTag] = useState({ running: false, done: 0, total: 0, ok: 0, fail: 0, finishedAt: 0 }); // app-wide bulk AI tagging progress
  const bulkTagStop = useRef(false);
  const [bulkVid, setBulkVid] = useState({ running: false, done: 0, total: 0, ok: 0, fail: 0, finishedAt: 0 }); // app-wide bulk VIDEO AI tagging progress
  const bulkVidStop = useRef(false);
  useEffect(() => { libItemsRef.current = libItems; }, [libItems]);
  // Merge freshly-fetched rows into the shared lazy library cache (by id) — every targeted query
  // (browse page, zone match, point lookup, KB, bulk tag) funnels its results through this instead
  // of replacing state, so the cache accumulates/dedupes rather than being "the whole table".
  const mergeLibItems = useCallback((items) => {
    if (!items || !items.length) return;
    setLibItems((prev) => {
      const byId = new Map(prev.map((it) => [it.id, it]));
      items.forEach((it) => { if (it && it.id) byId.set(it.id, it); });
      const next = [...byId.values()];
      libItemsRef.current = next;
      return next;
    });
  }, []);
  // Given ids/urls a screen is ABOUT to look up synchronously (libItems.find(...)), make sure
  // they're cached first — a small targeted fetch instead of ever loading the whole table.
  const ensureLibItems = useCallback(async (ids) => {
    const missing = [...new Set((ids || []).filter(Boolean))].filter((id) => !libItemsRef.current.some((it) => it.id === id));
    if (!missing.length) return;
    try { mergeLibItems(await fetchLibraryItemsByIds(missing)); } catch { /* ignore */ }
  }, [mergeLibItems]);
  const ensureLibItemsByUrl = useCallback(async (urls) => {
    const missing = [...new Set((urls || []).filter(Boolean))].filter((u) => !libItemsRef.current.some((it) => it.url === u));
    if (!missing.length) return;
    try { mergeLibItems(await fetchLibraryItemsByUrls(missing)); } catch { /* ignore */ }
  }, [mergeLibItems]);
  const [libSearch, setLibSearch] = useState("");
  const [libFilters, setLibFilters] = useState({});
  const [libVenueGroup, setLibVenueGroup] = useState("all");
  const [libVenueNames, setLibVenueNames] = useState([]);
  const [libEditImg, setLibEditImg] = useState(null);
  const [zoneElements, setZoneElements] = useState({});
  const [libAddUrl, setLibAddUrl] = useState("");
  const [libAddPreview, setLibAddPreview] = useState(null);
  const [libBulkText, setLibBulkText] = useState("");
  const [libBulkQueue, setLibBulkQueue] = useState([]);
  const [libAiLoading, setLibAiLoading] = useState(false);
  const [zoneAiFilling, setZoneAiFilling] = useState({});
  const [zoneElSearch, setZoneElSearch] = useState({});
  const [libBulkProgress, setLibBulkProgress] = useState(0);
  const [taxEditCat, setTaxEditCat] = useState(null);
  const [taxNewTag, setTaxNewTag] = useState("");
  const [taxNewCat, setTaxNewCat] = useState("");

  // ═══ CUSTOM VENUE STATE (persisted) ═══
  const [customInhouse, setCustomInhouse] = useState([]);
  const [customOutdoor, setCustomOutdoor] = useState([]);

  // ═══ STUDIO STATE ═══
  const [step, setStep] = useState(0);
  const [venueGroup, setVenueGroup] = useState("all");
  const [outsideSub, setOutsideSub] = useState("all");
  const [browseVenues, setBrowseVenues] = useState([]);
  const [odSearch, setOdSearch] = useState("");
  const [showMoreOutside, setShowMoreOutside] = useState(false);
  const [filterCat, setFilterCat] = useState([]);
  const [filterFn, setFilterFn] = useState([]);
  const [filterSpace, setFilterSpace] = useState([]);
  const [filterMood, setFilterMood] = useState([]);
  const [filterPalette, setFilterPalette] = useState([]);
  const [filterVenue, setFilterVenue] = useState("All");
  const [videoModal, setVideoModal] = useState(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoOverlay, setVideoOverlay] = useState(false);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [selectedPalettes, setSelectedPalettes] = useState([]);
  const [venue, setVenue] = useState("");
  const [fn, setFn] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientDate, setClientDate] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientBrideGroom, setClientBrideGroom] = useState("");
  const [clientShift, setClientShift] = useState("");
  const [clientPax, setClientPax] = useState("");
  const [clientVenueOther, setClientVenueOther] = useState("");
  const [clientPalette, setClientPalette] = useState("Custom");
  const [extraFunctions, setExtraFunctions] = useState([]);
  const [expandedFnIdx, setExpandedFnIdx] = useState(0);
  const [activeFnIdx, setActiveFnIdx] = useState(0);
  const [fnBuilds, setFnBuilds] = useState({});
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientLedger, setClientLedger] = useState([]);
  const [activeClientId, setActiveClientId] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  // Remember the active deal pointer + screen across a refresh / Studio↔IMS route switch (per-tab). The
  // build data itself lives in the client's rolling auto-session; these just say WHICH deal + WHERE to
  // restore on mount (see the restore effect after loadClientSession).
  useEffect(() => { try { if (activeClientId) sessionStorage.setItem("ambria-active-client", activeClientId); else sessionStorage.removeItem("ambria-active-client"); } catch { /* storage disabled */ } }, [activeClientId]);
  useEffect(() => { try { sessionStorage.setItem("ambria-studio-step", String(step)); } catch { /* */ } }, [step]);
  useEffect(() => { try { sessionStorage.setItem("ambria-active-fn", String(activeFnIdx)); } catch { /* */ } }, [activeFnIdx]);

  // ═══ §25 LMS LEAD INTEGRATION ═══
  const [lmsLeads, setLmsLeads] = useState([]);
  const [lmsLoading, setLmsLoading] = useState(false);
  const [lmsError, setLmsError] = useState(false);
  const [lmsFilling, setLmsFilling] = useState(false);
  const [lmsRefreshCounter, setLmsRefreshCounter] = useState(0);
  const [lmsSyncing, setLmsSyncing] = useState(false);
  const lmsCacheRef = useRef(new Map());
  const lmsDebounceRef = useRef(null);
  const lmsAbortRef = useRef(null);
  const lmsPollRef = useRef(null);

  // ═══ §25 LMS lead search — debounced lookup on clientName (faithful port) ═══
  // Real backend: the cached lms_contracts table via searchLmsLeads. Since the cache
  // returns complete results instantly, the reference's poll loop short-circuits.
  useEffect(() => {
    if (lmsAbortRef.current) lmsAbortRef.current.abort();
    if (lmsPollRef.current) clearTimeout(lmsPollRef.current);
    const query = (clientName || "").trim();
    if (query.length < 2) {
      setLmsLeads([]); setLmsLoading(false); setLmsError(false); setLmsFilling(false);
      return;
    }
    const cacheKey = query.toLowerCase();
    if (lmsCacheRef.current.has(cacheKey)) {
      const cached = lmsCacheRef.current.get(cacheKey);
      setLmsLeads(cached.leads || []); setLmsError(!!cached.error); setLmsLoading(false); setLmsFilling(false);
      return;
    }
    const runSearch = async () => {
      const abort = new AbortController();
      lmsAbortRef.current = abort;
      const result = await searchLmsLeads(query, abort.signal);
      if (result.aborted) return true;
      if (result.complete) {
        if (lmsCacheRef.current.size >= 20) {
          const firstKey = lmsCacheRef.current.keys().next().value;
          lmsCacheRef.current.delete(firstKey);
        }
        lmsCacheRef.current.set(cacheKey, { leads: result.leads, error: !result.ok });
      }
      setLmsLeads(result.leads || []);
      setLmsError(!result.ok);
      setLmsLoading(false);
      const stillFilling = !result.complete && result.ok;
      setLmsFilling(stillFilling);
      return !stillFilling;
    };
    lmsDebounceRef.current = setTimeout(async () => {
      setLmsLoading(true); setLmsError(false);
      const done = await runSearch();
      if (done) return;
      let pollsLeft = 30;
      const poll = async () => {
        if (pollsLeft-- <= 0) { setLmsFilling(false); return; }
        const finished = await runSearch();
        if (finished) return;
        lmsPollRef.current = setTimeout(poll, 3000);
      };
      lmsPollRef.current = setTimeout(poll, 3000);
    }, 400);
    return () => {
      if (lmsDebounceRef.current) clearTimeout(lmsDebounceRef.current);
      if (lmsPollRef.current) clearTimeout(lmsPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientName, activeClientId, lmsRefreshCounter]);

  // §25 LMS pre-warm: if the shared lms_contracts cache is stale/empty, kick a
  // background server-side sync once on mount so lead search has data (fire-and-forget).
  useEffect(() => {
    (async () => {
      try {
        const { lastSync } = await fetchCachedContracts();
        if (Date.now() - lastSync > 30 * 60 * 1000) triggerLmsSync().catch(() => {});
      } catch { /* ignore */ }
    })();
  }, []);

  // Manual "🔄 Refresh" in Event Info: run the REAL server-side LMS sync (Supabase Edge Fn),
  // then clear the local search cache and re-run the search so brand-new LMS leads (created after
  // the last sync) show up on demand. (The old button hit a dead /api/lms route that never synced.)
  const refreshLmsSync = useCallback(async () => {
    setLmsSyncing(true);
    try { await triggerLmsSync(); } catch { /* surfaced via lmsError on re-search */ }
    lmsCacheRef.current.clear();
    setLmsRefreshCounter((c) => c + 1);
    setLmsSyncing(false);
  }, []);

  const [sessionHistoryExpanded, setSessionHistoryExpanded] = useState(false);
  const [dateTypes, setDateTypes] = useState({});
  const [eventOrders, setEventOrders] = useState([]);
  const [photoImsMap, setPhotoImsMap] = useState({});
  // ── Deal Check knowledge set (learned photo→IMS visual identity) ──────────────
  // Row-per-entry table `dc_photo_knowledge`, id = `${photoUrl}::${rcNameLower}`, data =
  // { imsId, subcat, source: "ai"|"name"|"taught", updatedAt }. On Generate we consult this BEFORE
  // calling the AI (hit → skip the AI, huge cost/speed win); on an AI/name match we store the visual
  // identity; the "Teach" button stores an explicit human correction. It is AVAILABILITY-INDEPENDENT
  // (pure "what the photo shows") — per-deal availability is applied on top, and ordinary swaps stay
  // deal-local (they never write here). Fail-safe: missing table or deleted item → fall back to AI.
  const [photoKnowledge, setPhotoKnowledge] = useState({});
  const photoKnowledgeRef = useRef({});
  useEffect(() => { photoKnowledgeRef.current = photoKnowledge; }, [photoKnowledge]);
  const dcKnowledgeKey = useCallback((photoUrl, rcName, propType) => (photoUrl && rcName) ? `${photoUrl}::${String(rcName).toLowerCase().trim()}${propType ? "::" + propType : ""}` : null, []);
  // Persist one entry (row-level upsert) + mirror into local state. Never throws (table may not exist).
  const saveKnowledgeEntry = useCallback(async (key, entry) => {
    if (!key || !entry?.imsId) return;
    const rec = { imsId: entry.imsId, subcat: entry.subcat || "", source: entry.source || "ai", updatedAt: Date.now() };
    setPhotoKnowledge(prev => ({ ...prev, [key]: rec }));
    try { await upsertRow("dc_photo_knowledge", { id: key, data: rec }); } catch { /* table missing / offline — keep local, retry next time */ }
  }, []);
  const [scanHistory, setScanHistory] = useState({});
  const [showSoldConfetti, setShowSoldConfetti] = useState(false);
  const [csData, setCsData] = useState(null);
  const [expandedSummaryFnIdx, setExpandedSummaryFnIdx] = useState(0);
  const [enabledEls, setEnabledEls] = useState({});
  const [elTiers, setElTiers] = useState({});
  const [customMode, setCustomMode] = useState({});
  const [itemQty, setItemQty] = useState({});
  const [itemGrades, setItemGrades] = useState({});
  const [showInsp, setShowInsp] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showPpt, setShowPpt] = useState(false);
  const [showCosts, setShowCosts] = useState(false);

  // ═══ DEAL CHECK — Session B ═══
  const [dealCheckData, setDealCheckData] = useState(null);
  // Lightweight settings loaded on mount so Build-view features work WITHOUT opening Deal Check
  // (which is what populates the full dealCheckData). Carries floral recipe data (floralArtUnitRate /
  // patternExtra fall back to this) AND fixed-venue config (drives the zone Repeat/Fresh chip).
  const [studioFloralData, setStudioFloralData] = useState(null);
  const [imsColourCatalogue, setImsColourCatalogue] = useState([]);
  const [imsPaletteCatalogue, setImsPaletteCatalogue] = useState([]);
  const [imsPaintableCategories, setImsPaintableCategories] = useState(["Props", "Arches", "Panels", "Pillars", "Glass", "Structural", "Furniture", "Stage", "Consumable", "Arches & Props", "Wall Masking"]);
  const [imsDefaultPaintCost, setImsDefaultPaintCost] = useState(400);
  // Save colour + palette catalogues to Studio-owned PALETTE_SK
  const savePaletteData = useCallback((colours, palettes) => {
    const data = { colourCatalogue: colours || imsColourCatalogue, paletteCatalogue: palettes || imsPaletteCatalogue };
    reliableSave(PALETTE_SK, JSON.stringify(data), "Palette catalogue").catch(() => {});
  }, [imsColourCatalogue, imsPaletteCatalogue]);
  // Category → Department map (Deal Check department income). Stored in the settings table as a
  // plain key→value row so the Deal Check rollup reads it; empty falls back to keyword matching.
  const [catDeptMap, setCatDeptMap] = useState({});
  useEffect(() => { (async () => { try { const v = await kvGet("categoryDepartments"); const p = typeof v === "string" ? JSON.parse(v) : v; if (p && typeof p === "object") setCatDeptMap(p); } catch { /* ignore */ } })(); }, []);
  const saveCatDeptMap = useCallback((m) => { setCatDeptMap(m); reliableSave("categoryDepartments", JSON.stringify(m), "Category→Department").catch(() => {}); }, []);
  const [paintPickerTarget, setPaintPickerTarget] = useState(null);
  const [fabricPickerTarget, setFabricPickerTarget] = useState(null);
  const [dealCheckLoading, setDealCheckLoading] = useState(false);
  const [dealCheckError, setDealCheckError] = useState(null);
  const [dcPhotoOverrides, setDcPhotoOverrides] = useState({});
  const [dcSkipped, setDcSkipped] = useState({});
  const [dcProductionAccepted, setDcProductionAccepted] = useState({});
  const [dcManualItems, setDcManualItems] = useState([]);
  const [dcManualSearch, setDcManualSearch] = useState({});
  const [dcDedupOverrides, setDcDedupOverrides] = useState({});
  const [dcBlockedFnOpen, setDcBlockedFnOpen] = useState({});
  const [dcBlockedSubOpen, setDcBlockedSubOpen] = useState({});
  const [dcFloralExpanded, setDcFloralExpanded] = useState(false);
  const [dcFloralUnmatchedExpanded, setDcFloralUnmatchedExpanded] = useState(false);
  const [dcResolved, setDcResolved] = useState({});
  const [dcResolving, setDcResolving] = useState({});
  const [dcAbortRef, setDcAbortRef] = useState(null);

  // ═══ DEAL CHECK REBUILD — Deploy 1 state (§7.9) ═══
  const [dcFullPageOpen, setDcFullPageOpen] = useState(false);
  const [dcCards, setDcCards] = useState({});
  const [dcZoneState, setDcZoneState] = useState({});
  const [dcKitEdits, setDcKitEdits] = useState({});
  const [dcCarpetPick, setDcCarpetPick] = useState({});
  const [dcCarpetSearch, setDcCarpetSearch] = useState({});
  const [dcDesiredMargin, setDcDesiredMargin] = useState(null);
  const [dcRunCounter, setDcRunCounter] = useState({});
  const [dcCache, setDcCache] = useState({});
  const [dcGenerating, setDcGenerating] = useState(false);
  const [dcGenStatus, setDcGenStatus] = useState("");
  const [dcActiveTab, setDcActiveTab] = useState("inventory");
  const [dcMpOverrides, setDcMpOverrides] = useState({});
  // Per-shift (per-dihari) crew counts set in Deal Check: { [type]: { [date]: { [winId]: count } } }.
  // Same shape as IMS Dept Ops mpWinCount → flows into the snapshot schedule so Deal Check, Dept Ops
  // and On-Site all show/edit the same per-shift numbers.
  const [dcMpWinCount, setDcMpWinCount] = useState({});
  const [dcMpIncludeMinusOne, setDcMpIncludeMinusOne] = useState(false);
  const [dcMpIncludeDismantle, setDcMpIncludeDismantle] = useState(true);
  const [dcMpCalcOpen, setDcMpCalcOpen] = useState({});
  const [dcFloralCalcOpen, setDcFloralCalcOpen] = useState({});
  const [dcCollapsedZones, setDcCollapsedZones] = useState({});
  const [floralHardPropMap, setFloralHardPropMap] = useState(FLORAL_HARDPROP_DEFAULT);
  const [softHolds, setSoftHolds] = useState({});
  const [batchTaggerPaused, setBatchTaggerPaused] = useState(false);
  const [batchTaggerMeta, setBatchTaggerMeta] = useState(null);
  const [trussAlloc, setTrussAlloc] = useState({});
  const [dcAmendDiff, setDcAmendDiff] = useState(null);
  const [amendRequests, setAmendRequests] = useState([]);
  const [dcSavingDraft, setDcSavingDraft] = useState(false);
  const [dcInventoryCache, setDcInventoryCache] = useState([]);
  const [dcBrowseAllOpen, setDcBrowseAllOpen] = useState(null);
  const [dcSwapModal, setDcSwapModal] = useState(null);
  const [dcColorModal, setDcColorModal] = useState(null);
  const [dcArtFlowerAlloc, setDcArtFlowerAlloc] = useState({});
  const [dcArtFlowerModal, setDcArtFlowerModal] = useState(null);
  const [dcFloralColorPrefs, setDcFloralColorPrefs] = useState({});
  const [dcPrefModal, setDcPrefModal] = useState(null);
  const [dcCustomItems, setDcCustomItems] = useState([]);
  const [dcCustomModal, setDcCustomModal] = useState(null);
  // Swap modal local state — lifted to App scope to avoid hook-reset on parent re-render.
  const [dcSwapSearch, setDcSwapSearch] = useState("");
  const [dcSwapPicked, setDcSwapPicked] = useState(null);
  const [dcSwapMode, setDcSwapMode] = useState("full");
  const [dcSwapSplitQty, setDcSwapSplitQty] = useState(0);
  useEffect(() => {
    if (dcSwapModal) {
      setDcSwapSearch("");
      setDcSwapPicked(null);
      setDcSwapMode("full");
      setDcSwapSplitQty(0);
    }
  }, [dcSwapModal]);

  const [floralRatio, setFloralRatio] = useState(70);
  const [floralOverrides, setFloralOverrides] = useState({ note: "", rows: [] });

  // ═══ ZONE PHOTO FILTERS (Build canvas) — VERBATIM ═══
  const [zpFilterOpen, setZpFilterOpen] = useState(false);
  const [zpFilters, setZpFilters] = useState({ eventType: [], venueType: [], designStyle: [], colorPalette: [], venue: "" });
  const zpToggleFilter = useCallback((cat, val) => {
    setZpFilters(prev => ({ ...prev, [cat]: prev[cat].includes(val) ? prev[cat].filter(v => v !== val) : [...prev[cat], val] }));
  }, []);
  const zpHasFilters = Object.values(zpFilters).some(a => a.length > 0);
  const zpFilterPhoto = useCallback((li) => {
    if (!li) return true;
    const tags = li.tags || {};
    for (const cat of ["eventType", "venueType", "designStyle", "colorPalette"]) {
      const vals = zpFilters[cat] || [];
      if (!vals.length) continue;
      const it = tags[cat] || [];
      if (!vals.some(v => it.includes(v))) return false;
    }
    // Venue name search — matches the photo's venue tag OR its folder path (photos are often filed under
    // "inhouse venues/<venue>/…" or "Outside Venues/<venue>/…"), so a salesperson can type e.g. "emerald".
    const vq = String(zpFilters.venue || "").toLowerCase().trim();
    if (vq) { let url = ""; try { url = decodeURIComponent(String(li.url || "")); } catch { url = String(li.url || ""); } const hay = (String(tags.venue || "") + " " + url).toLowerCase(); if (!hay.includes(vq)) return false; }
    return true;
  }, [zpFilters]);

  // ═══ ZONE UPLOAD STATE — VERBATIM (Cloudinary + AI tag) ═══
  const [zoneUploading, setZoneUploading] = useState(null); // elKey currently uploading
  const [zoneUploadReview, setZoneUploadReview] = useState(null);
  const [zurElSearch, setZurElSearch] = useState("");
  const [inspQ, setInspQ] = useState("");
  const [inspResults, setInspResults] = useState([]);
  const [inspLoading, setInspLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptDone, setPptDone] = useState(false);
  const [savedInsps, setSavedInsps] = useState([]);
  const [copied, setCopied] = useState(false);
  const [sourceEvent, setSourceEvent] = useState(null);
  const [sourceVideo, setSourceVideo] = useState(null);
  const [filterPriority, setFilterPriority] = useState(DEFAULT_FILTER_PRIORITY);
  // Persist photo-filter priority (single-source admin config) — was only setState'd, so it reset on
  // refresh. Stored in the settings row FILTER_PRIORITY_SK (config, single-writer — not clobber-prone).
  const saveFilterPriority = useCallback((np) => { setFilterPriority(np); reliableSave(FILTER_PRIORITY_SK, JSON.stringify(np), "Filter priority").catch(() => {}); }, []);
  // Sub-categories flagged in Pricing as NOT taggable — array of "cat::sub" keys. Hidden from the
  // element-search boxes (Build + Library tagger) and dropped from the AI tagger's vocabulary, so
  // already-costed structural subs (truss/platform/carpet/fabric) and IMS-only subs (tools) can't
  // be re-added during tagging. Items still exist in pricing & IMS inventory.
  const [tagHiddenSubs, setTagHiddenSubs] = useState([]);
  const [customTripRate, setCustomTripRate] = useState(0);
  const [venueCustom, setVenueCustom] = useState(false);
  const [customGensets, setCustomGensets] = useState(null);
  const [elInspo, setElInspo] = useState({});
  const [elInspoLoading, setElInspoLoading] = useState({});
  const [elSelectedPhoto, setElSelectedPhoto] = useState({});
  const [elNotes, setElNotes] = useState({});
  const [elCostOpen, setElCostOpen] = useState({});
  const [customZones, setCustomZones] = useState([]);
  const [newCzName, setNewCzName] = useState("");
  const [elGallery, setElGallery] = useState(null);
  const [galleryIdx, setGalleryIdx] = useState(null);
  const [webPreview, setWebPreview] = useState(null);
  const [zoneConfig, setZoneConfig] = useState({});
  const [activeZones, setActiveZones] = useState([]);
  const [rcItems, setRcItems] = useState(RC_D);
  const [rcCats, setRcCats] = useState(RC_CATS_DEFAULT);
  const [rcSubcatFactors, setRcSubcatFactors] = useState([]); // IMS-owned; read-only here until Phase 2
  const [rcCatEditMode, setRcCatEditMode] = useState(false);
  const [rcCat, setRcCat] = useState("truss");
  const [rcSearch, setRcSearch] = useState("");
  const [libElSearch, setLibElSearch] = useState("");
  const [rcEditId, setRcEditId] = useState(null);
  const [rcTab, setRcTab] = useState("ratecard");
  const [trVenues, setTrVenues] = useState(TR_DV);
  const [truckCap, setTruckCap] = useState(TR_DTC);
  const [floralPerTruck, setFloralPerTruck] = useState(50000);
  const [gensetRate, setGensetRate] = useState(28000);
  const [bufferTiers, setBufferTiers] = useState(TR_DBT);
  const [newVenue, setNewVenue] = useState({ tier: "inhouse", name: "", rate: 0, gensets: 1 });
  const [newTC, setNewTC] = useState({ item: "", perTruck: 0, unit: "pc" });
  const [rcAddMode, setRcAddMode] = useState(false);
  const [rcSubOpen, setRcSubOpen] = useState(false);
  const [rcNewForm, setRcNewForm] = useState({ cat: "truss", sub: "", name: "", unit: "pc", inhouseMode: "flat", inhouseFlat: 0, inhouseS: 0, inhouseM: 0, inhouseB: 0, outEnabled: false, outS: 0, outM: 0, outB: 0, notes: "", artificialFlat: 0, artificialS: 0, artificialM: 0, artificialB: 0, defaultRealPct: 100, floralMode: "ratio" });

  // ═══ TEMPLATE STATE ═══
  const [templates, setTemplates] = useState(TPL_DEFAULTS);
  const [tplEdit, setTplEdit] = useState(null);
  const [tplTab, setTplTab] = useState("list");

  // ═══ ZONE DEFINITIONS STATE ═══
  const [zoneDefs, setZoneDefs] = useState({ elements: {}, meta: JSON.parse(JSON.stringify(ZONE_META)) });
  const zoneMeta = useMemo(() => zoneDefs.meta || ZONE_META, [zoneDefs]);
  const zoneKeys = useMemo(() => Object.keys(zoneMeta), [zoneMeta]);
  const zoneLabelsD = useMemo(() => {
    const labels = {};
    Object.entries(zoneMeta).forEach(([k, v]) => {
      labels[k] = { label: v.label || k, icon: v.icon || ZONE_LABELS[k]?.icon || "📦" };
    });
    return labels;
  }, [zoneMeta]);
  const [zdEditZone, setZdEditZone] = useState("stage");

  // ═══ Active function meta (derived from activeFnIdx) ═══
  const activeFnMeta = useMemo(() => {
    if (activeFnIdx === 0) {
      return { type: fn || "", date: clientDate || "", venue: venue || "", shift: clientShift || "", pax: clientPax || "" };
    }
    const ef = extraFunctions[activeFnIdx - 1];
    if (!ef) {
      return { type: fn || "", date: clientDate || "", venue: venue || "", shift: clientShift || "", pax: clientPax || "" };
    }
    return { type: ef.type || "", date: ef.date || "", venue: ef.venue || "", shift: ef.shift || "", pax: ef.pax || "" };
  }, [activeFnIdx, fn, clientDate, venue, clientShift, clientPax, extraFunctions]);

  useEffect(() => {
    const maxIdx = extraFunctions.length;
    if (activeFnIdx > maxIdx) setActiveFnIdx(Math.max(0, maxIdx));
  }, [extraFunctions.length, activeFnIdx]);

  // ═══ Snapshot / restore Build state for per-function canvases — VERBATIM ═══
  const snapshotBuildState = () => ({
    enabledEls, elTiers, zoneConfig, zoneElements, itemQty, itemGrades,
    customMode, activeZones, customZones,
    elSelectedPhoto, elInspo, elNotes, elCostOpen,
    sourceVideo, sourceEvent,
    savedInsps, selectedMoods, selectedPalettes, floralRatio,
    customGensets, customTripRate,
    floralOverrides,
  });
  const fnSnapHasData = (snap) => {
    if (!snap || typeof snap !== "object") return false;
    if (Object.keys(snap.elSelectedPhoto || {}).length > 0) return true;
    if (Object.keys(snap.zoneElements || {}).length > 0) return true;
    if (Object.values(snap.enabledEls || {}).some(v => v)) return true;
    if (snap.sourceVideo?.id || snap.sourceVideoId) return true;
    if (snap.sourceEvent?.id || snap.sourceEventId) return true;
    return false;
  };
  const restoreBuildState = (s) => {
    if (!s) {
      setEnabledEls({}); setElTiers({}); setZoneConfig({}); setZoneElements({});
      setItemQty({}); setItemGrades({}); setCustomMode({}); setActiveZones([]);
      setCustomZones([]); setElSelectedPhoto({}); setElInspo({}); setElNotes({});
      setElCostOpen({}); setSourceVideo(null); setSourceEvent(null);
      setSavedInsps([]); setSelectedMoods([]); setSelectedPalettes([]); setFloralRatio(70);
      setCustomGensets(null); setCustomTripRate(0);
      setFloralOverrides({ note: "", rows: [] });
      return;
    }
    setEnabledEls(s.enabledEls || {});
    setElTiers(s.elTiers || {});
    setZoneConfig(s.zoneConfig || {});
    setZoneElements(s.zoneElements || {});
    setItemQty(s.itemQty || {});
    setItemGrades(s.itemGrades || {});
    setCustomMode(s.customMode || {});
    setActiveZones(s.activeZones || []);
    setCustomZones(s.customZones || []);
    setElSelectedPhoto(s.elSelectedPhoto || {});
    setElInspo(s.elInspo || {});
    setElNotes(s.elNotes || {});
    setElCostOpen(s.elCostOpen || {});
    setSourceVideo(s.sourceVideo || null);
    setSourceEvent(s.sourceEvent || null);
    setSavedInsps(s.savedInsps || []);
    setSelectedMoods(s.selectedMoods || []);
    setSelectedPalettes(s.selectedPalettes || []);
    setFloralRatio(typeof s.floralRatio === "number" ? s.floralRatio : 70);
    setCustomGensets(typeof s.customGensets === "number" ? s.customGensets : null);
    setCustomTripRate(typeof s.customTripRate === "number" ? s.customTripRate : 0);
    setFloralOverrides(
      s.floralOverrides && typeof s.floralOverrides === "object"
        ? { note: s.floralOverrides.note || "", rows: Array.isArray(s.floralOverrides.rows) ? s.floralOverrides.rows : [] }
        : { note: "", rows: [] }
    );
  };
  const switchActiveFn = (newIdx) => {
    if (newIdx === activeFnIdx) return;
    const currentSnapshot = snapshotBuildState();
    const targetSnapshot = fnBuilds[newIdx] || null;
    setFnBuilds(prev => ({ ...prev, [activeFnIdx]: currentSnapshot }));
    restoreBuildState(targetSnapshot);
    setActiveFnIdx(newIdx);
  };

  // ═══ AUTH- derived helpers (verbatim) ═══
  const [teamData, setTeamData] = useState(DEFAULT_TEAM);
  const [saveError, setSaveError] = useState(null);

  const showMsg = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 2000); };
  const doLogout = () => { logout(); };
  // Role check is case-insensitive: the shared users table uses "Admin" (capital), the
  // reference Studio used "admin". Also honor the seeded u_admin id.
  // Role check is case-insensitive: the shared users table uses "Admin" (capital), the
  // reference Studio used "admin". Also honor the seeded u_admin id.
  const isAdmin = (authUser?.role || "").toLowerCase() === "admin" || authUser?.id === "u_admin";

  // Per-role Studio permissions — configured from IMS → Admin → Users → Tab Access
  // (settings.roleTabs[role].studio.perms, the 8 canX flags). Drives hasPerm below.
  const [studioRoleTabs, setStudioRoleTabs] = useState({});
  useEffect(() => { (async () => { try { const v = await kvGet("roleTabs"); const p = typeof v === "string" ? JSON.parse(v) : v; if (p && typeof p === "object") setStudioRoleTabs(p); } catch { /* ignore */ } })(); }, []);
  // Role's Studio tab/sub-tab config (settings.roleTabs[role].studio). null = admin (all).
  // Unconfigured non-admin defaults to deal-builder only (matches the reference 'sales' default).
  const studioCfg = useMemo(() => {
    if (isAdmin) return null;
    return studioRoleTabs?.[authUser?.role]?.studio || { tabs: ["design"], subTabs: {} };
  }, [isAdmin, studioRoleTabs, authUser]);
  const hasStudioTab = useCallback((t) => isAdmin || (studioCfg?.tabs || []).includes(t), [isAdmin, studioCfg]);
  const studioSub = useCallback((parent, sub) => {
    if (isAdmin) return true;
    if (!(studioCfg?.tabs || []).includes(parent)) return false;
    return (studioCfg?.subTabs?.[parent] || []).includes(sub); // explicit grant
  }, [isAdmin, studioCfg]);
  // Which Studio Settings sub-views (venues/tags/clients/calendar/users/zones/palettes/
  // priority) this role can see — consumed by ManageSettings.
  const studioSettingsAllowed = useCallback((view) => isAdmin || studioSub("settings", view), [isAdmin, studioSub]);
  // Which Library & content sub-views (images/videos/corrections) this role can see. If the
  // Library tab is granted but no sub-tabs are explicitly picked, all three are allowed (matches
  // the IMS supply-tab convention: no sub-config = full access to the granted tab).
  const studioLibraryAllowed = useCallback((view) => {
    if (isAdmin) return true;
    if (!(studioCfg?.tabs || []).includes("library")) return false;
    const subs = studioCfg?.subTabs?.library;
    if (!subs || subs.length === 0) return true;
    return subs.includes(view);
  }, [isAdmin, studioCfg]);
  // Map the reference's canX perm flags onto the Studio tab/sub-tab grants. Every existing
  // hasPerm("canX") call site across Studio/views/manage keeps working through this.
  const hasPerm = useCallback((perm) => {
    if (isAdmin) return true;
    switch (perm) {
      case "canViewPricing": return studioSub("design", "viewpricing");
      case "canExport": return studioSub("design", "export");
      case "canEditEvents":
      case "canManageLibrary": return hasStudioTab("library");
      case "canManagePricing": return hasStudioTab("pricing");
      case "canManageTemplates": return hasStudioTab("settings");
      case "canManageVenues": return studioSub("settings", "venues");
      case "canManageUsers": return studioSub("settings", "users");
      default: {
        const p = authUser?.perms;
        if (Array.isArray(p)) return p.includes(perm);
        return p?.[perm] === true;
      }
    }
  }, [isAdmin, studioSub, hasStudioTab, authUser]);

  const userVenueScope = useMemo(() => {
    if (!authUser) return "all";
    return teamData[authUser.id]?.venueScope || "all";
  }, [authUser, teamData]);

  // Deal builder (studio mode) is always available to anyone with Studio access — it's the
  // base. Manage mode appears only if the role has a manage area (library/pricing/settings).
  const canManageAny = isAdmin || hasStudioTab("library") || hasStudioTab("pricing") || hasStudioTab("settings");
  useEffect(() => { if (mode === "manage" && !canManageAny) setMode("studio"); }, [mode, canManageAny]);

  const toggleFilter = useCallback((arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }, []);

  // ═══ AMBRIA PREMIA STATE ═══
  const [premiaConfig, setPremiaConfig] = useState(PREMIA_DEFAULTS);
  const [premiaGate, setPremiaGate] = useState(null);
  const [premiaDraft, setPremiaDraft] = useState(PREMIA_DEFAULTS);
  const [premiaEditorOpen, setPremiaEditorOpen] = useState(false);
  const [premiaPreview, setPremiaPreview] = useState(false);
  useEffect(() => { setPremiaDraft(premiaConfig); }, [premiaConfig]);

  // ═══ YOUTUBE BROWSER STATE ═══
  const [ytVideos, setYtVideos] = useState([]);
  const [ytPlaylists, setYtPlaylists] = useState([{ id: AMBRIA_PLAYLIST_ID, title: "All Ambria Work" }]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytSearch, setYtSearch] = useState("");
  const [ytFilterPL, setYtFilterPL] = useState("all");
  const [ytPicker, setYtPicker] = useState(null);
  const [ytLastFetch, setYtLastFetch] = useState(0);
  const [ytVideoTags, setYtVideoTags] = useState({});
  // Video tags reference library photos by id for their per-zone "default photo" (zonePhotos).
  // Those ids came from a possibly-past session and aren't necessarily in the lazy library cache
  // yet (Build/cost-calc do a plain `libItems.find(id)`), so prefetch all of them once whenever
  // the video tags load/change — bounded by however many videos are tagged, nowhere near the whole
  // library. ensureLibItems no-ops for ids already cached, so this is cheap on repeat calls.
  useEffect(() => {
    const ids = Object.values(ytVideoTags || {}).flatMap((t) => Object.values(t?.zonePhotos || {}));
    if (ids.length) ensureLibItems(ids);
  }, [ytVideoTags, ensureLibItems]);
  const [ytTagEdit, setYtTagEdit] = useState(null);
  const [tagVenueGroup, setTagVenueGroup] = useState("inhouse");
  const [tagOutsideSub, setTagOutsideSub] = useState("all");
  const [aiTaggingVideo, setAiTaggingVideo] = useState(null);
  const [aiVideoDraft, setAiVideoDraft] = useState(null);
  const [ytFilterVenue, setYtFilterVenue] = useState("all");
  const [ytFilterFn, setYtFilterFn] = useState("all");
  const [ytFilterTier, setYtFilterTier] = useState("all");
  const [ytFilterLinked, setYtFilterLinked] = useState("all");
  const [ytFilterStyle, setYtFilterStyle] = useState("all");
  const [ytFilterColor, setYtFilterColor] = useState("all");
  const [ytFilterIO, setYtFilterIO] = useState("all");
  const [ytPhotoUrl, setYtPhotoUrl] = useState("");
  const [manualVideos, setManualVideos] = useState([]);
  const [hiddenVideos, setHiddenVideos] = useState({});
  const [showHidden, setShowHidden] = useState(false);
  const [lastVisitTs, setLastVisitTs] = useState(0);

  // ═══ CLOUDINARY PHOTO BROWSER STATE (reference ~3580) ═══
  const [cldOpen, setCldOpen] = useState(null); // video id for which CLD browser is open
  const [cldFolders, setCldFolders] = useState([]);
  const [cldPath, setCldPath] = useState([]); // breadcrumb ["Decor","Wedding","Indoor"]
  const [cldImages, setCldImages] = useState([]);
  const [cldLoading, setCldLoading] = useState(false);
  const [cldUploading, setCldUploading] = useState(false);
  const [cldUploadProgress, setCldUploadProgress] = useState([]); // [{name, status:'checking'|'compressing'|'uploading'|'done'|'error'|'skipped', url?}]
  const cldUploadRef = useRef(null);
  const cldFolderUploadRef = useRef(null);
  const [cldSelectMode, setCldSelectMode] = useState(false);
  const [cldSelected, setCldSelected] = useState(new Set());
  const [cldDeleting, setCldDeleting] = useState(false);
  // ═══ CLOUDINARY VIDEO BROWSER STATE (reference ~3595) ═══
  const [addVideoOpen, setAddVideoOpen] = useState(false); // show add video panel
  const [cldVideoFolders, setCldVideoFolders] = useState([]);
  const [cldVideoPath, setCldVideoPath] = useState([]);
  const [cldVideoList, setCldVideoList] = useState([]);
  const [cldVideoLoading, setCldVideoLoading] = useState(false);
  // ═══ ZONE PICKER MODAL STATE (reference ~3601) ═══
  const [zonePickerVid, setZonePickerVid] = useState(null); // video id for zone picker modal
  const [zonePickerZone, setZonePickerZone] = useState(null); // zone name being picked

  // ═══ PINTEREST SEARCH STATE ═══
  const [pinResults, setPinResults] = useState([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const [inspSource, setInspSource] = useState("pexels");

  // ═══ NOTIFICATION STATE ═══
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLastRead, setNotifLastRead] = useState(Date.now());
  const [newIH, setNewIH] = useState({ name: "", label: "", type: "Outdoor", base: "", parent: "", newParentMode: false });
  const [newOD, setNewOD] = useState({ name: "", empanelled: true });
  const [adminOdSearch, setAdminOdSearch] = useState("");
  const [editIH, setEditIH] = useState(null);
  const [editOD, setEditOD] = useState(null);

  const unreadCount = useMemo(() => notifications.filter(n => n.ts > notifLastRead).length, [notifications, notifLastRead]);
  const markAllRead = () => { setNotifLastRead(Date.now()); };

  // ═══════════════════════════════════════════════════════════════
  // DATA LOAD — port of the reference load flow via kvGet (Redis→Supabase shim).
  // Each key is read via kvGet and JSON.parsed defensively (double-parse safety:
  // kvGet may return a JSON string OR an already-parsed value). Sets state per key.
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;
    // Defensive double-parse: the reference always JSON.stringify's before saving, so the
    // stored value is a JSON string. Some legacy rows may be stored already-parsed. Parse up
    // to twice, swallowing errors — mirrors the reference's `for(i<2)` defensive parse.
    const parse = (v) => {
      let p = v;
      for (let i = 0; i < 2; i++) { if (typeof p === "string") { try { p = JSON.parse(p); } catch { break; } } }
      return p;
    };
    (async () => {
      // Events — auto-wrap to multi-function shape (functions[]).
      try {
        const v = await kvGet(STORAGE_KEY);
        if (v != null) {
          let p = parse(v);
          const cleaned = Array.isArray(p) ? p.filter(e => !(e && e.id >= 1 && e.id <= 14 && typeof e.img === "string" && e.img.includes("pexels.com"))) : [];
          const wrapped = ensureAllEventsWrapped(cleaned);
          if (!cancelled && wrapped.length) setEvents(wrapped);
        }
      } catch {}
      // Venues
      try {
        const v = await kvGet(STORAGE_KEY + "-venues");
        let inhouseArr = [], outdoorArr = [];
        if (v != null) { const vd = parse(v); if (vd && Array.isArray(vd.inhouse)) inhouseArr = vd.inhouse; if (vd && Array.isArray(vd.outdoor)) outdoorArr = vd.outdoor; }
        const migFlag = await kvGet(VENUE_MIG_SK);
        if (!migFlag) {
          LEGACY_VENUE_SEED.inhouse.forEach(s => { if (!inhouseArr.some(x => x.name === s.name)) inhouseArr.push(s); });
          LEGACY_VENUE_SEED.outdoor.forEach(s => { if (!outdoorArr.some(x => x.name === s.name)) outdoorArr.push(s); });
          const payload = JSON.stringify({ inhouse: inhouseArr, outdoor: outdoorArr });
          reliableSave(STORAGE_KEY + "-venues", payload, "Venues").catch(() => {});
          kvSet(VENUE_MIG_SK, "1").catch(() => {});
        }
        if (!cancelled) { setCustomInhouse(inhouseArr); setCustomOutdoor(outdoorArr); }
      } catch {}
      // Rate Card — now row-per-item in the `rate_card` TABLE (off the settings blob; shared with IMS).
      let loadedRcItems = null;
      try {
        const rows = await loadRcRows();
        if (Array.isArray(rows) && rows.length) { const mapped = rows.map(rowToRcItem).filter(Boolean); loadedRcItems = mapped; if (!cancelled) setRcItems(mapped); }
        else { // empty table → seed defaults as rows (first boot)
          try { await supabase.from("rate_card").upsert(RC_D.map(i => ({ ...rcItemToRow(i), updated_at: new Date().toISOString() })), { onConflict: "id" }); } catch { /* ignore */ }
          loadedRcItems = RC_D; if (!cancelled) setRcItems(RC_D);
        }
      } catch { /* ignore */ }
      // Sub-category scaling factors — Rate Card → IMS migration Phase 1. IMS-owned table
      // (rate_card_categories); Studio just reads it live, no write path here yet (that's Phase 2).
      try {
        const rows = await fetchAll("rate_card_categories");
        if (Array.isArray(rows) && !cancelled) setRcSubcatFactors(rows);
      } catch { /* ignore — table may not exist yet in this environment */ }
      // Rate Card Categories — on first boot (v == null), seed defaults and recover orphaned
      // category IDs so items still have a group to render under. When a saved blob exists,
      // skip recovery entirely: the team intentionally manages categories via the editor and
      // orphan-recovery would silently undo deliberate deletes.
      try {
        const v = await kvGet(RC_SK_CATS);
        let cats = (v != null) ? (Array.isArray(parse(v)) ? parse(v) : null) : null;
        if (!cats || !cats.length) { cats = RC_CATS_DEFAULT; if (v == null) reliableSave(RC_SK_CATS, JSON.stringify(RC_CATS_DEFAULT), "Categories").catch(() => {}); }
        const items = loadedRcItems || [];
        if (items.length && v == null) {
          const haveIds = new Set(cats.map(c => c.id));
          const orphanIds = [...new Set(items.map(i => i && i.cat).filter(id => id && !haveIds.has(id)))];
          if (orphanIds.length) {
            const recovered = orphanIds.map(id => {
              const def = RC_CATS_DEFAULT.find(d => d.id === id);
              if (def) return { ...def };
              const firstSub = (items.find(i => i.cat === id) || {}).sub || "";
              return { id, l: firstSub || `Recovered (${id})`, icon: "📦", c: "#9CA3AF", d: "Recovered — items existed under this category but it was missing from the list. Rename as needed." };
            });
            cats = [...cats, ...recovered];
            reliableSave(RC_SK_CATS, JSON.stringify(cats), "Categories").catch(() => {});
          }
        }
        if (!cancelled) setRcCats(cats);
      } catch {}
      // Transport
      try {
        const v = await kvGet(RC_SK_TR);
        if (v != null) { const td = parse(v); if (td && typeof td === "object" && !cancelled) { if (td.venues) setTrVenues(td.venues); if (td.truckCap) setTruckCap(td.truckCap); if (td.floralPerTruck) setFloralPerTruck(td.floralPerTruck); if (td.bufferTiers) setBufferTiers(td.bufferTiers); if (td.gensetRate !== undefined) setGensetRate(td.gensetRate); } }
      } catch {}
      // Templates
      try { const v = await kvGet(TPL_SK); if (v != null) { const tp = parse(v); if (Array.isArray(tp) && tp.length && !cancelled) setTemplates(tp); } } catch {}
      // Zone definitions
      let loadedZones = null;
      try { const v = await kvGet(ZONE_DEF_SK); if (v != null) { const zp = parse(v); if (zp && zp.elements) { loadedZones = zp; if (!cancelled) setZoneDefs(zp); } } } catch {}
      // Taxonomy — backfill missing keys from DEFAULT_TAX
      let loadedTax = null;
      try {
        const v = await kvGet(TAX_SK);
        if (v != null) {
          const tp = parse(v);
          if (tp && tp.eventType) {
            const out = { ...tp };
            let merged = false;
            for (const k of Object.keys(DEFAULT_TAX)) { if (!Array.isArray(out[k])) { out[k] = DEFAULT_TAX[k]; merged = true; } }
            if (merged) reliableSave(TAX_SK, JSON.stringify(out), "Taxonomy").catch(() => {});
            loadedTax = out; if (!cancelled) setTaxonomy(out);
          }
        } else { reliableSave(TAX_SK, JSON.stringify(DEFAULT_TAX), "Taxonomy").catch(() => {}); loadedTax = DEFAULT_TAX; }
      } catch {}
      // Areas↔Zones auto-sync removed: the bidirectional sync (ZONE_META seeds, area→zone,
      // zone→area) ran unconditionally on every load and silently restored deleted zones/areas
      // from hardcoded defaults — same class of bug as the category orphan-recovery. Zones and
      // taxonomy are now fully user-managed; create/delete via the Zone editor.
      // Library — row-per-photo in the `library` TABLE, server-side paginated (no whole-table
      // fetch on mount — see `libraryQueries.js` + `mergeLibItems`). Nothing to eagerly load here.
      // Correction log (contribution tracking)
      try { const v = await kvGet(CORR_SK); if (v != null) { const cp = parse(v); if (Array.isArray(cp) && !cancelled) { setCorrLog(cp); corrLogRef.current = cp; } } } catch {}
      try { const v = await kvGet(TAG_KB_SK); if (v != null) { const kb = parse(v); if (kb && typeof kb === "object" && !cancelled) setTagKB(kb); } } catch {}
      try { const v = await kvGet(AITAG_QUOTA_SK); if (v != null) { const q = parse(v); if (q && typeof q === "object") aiTagQuotaRef.current = q; } } catch {}
      // Team
      try {
        const v = await kvGet(TEAM_SK);
        if (v != null) { const tp = parse(v); if (tp && typeof tp === "object" && !Array.isArray(tp) && !cancelled) setTeamData(tp); }
        else { reliableSave(TEAM_SK, JSON.stringify(DEFAULT_TEAM), "Team").catch(() => {}); }
      } catch {}
      // Premia config
      try { const v = await kvGet(PREMIA_CFG_SK); if (v != null) { const pc = parse(v); if (pc && typeof pc === "object" && !Array.isArray(pc) && !cancelled) setPremiaConfig({ ...PREMIA_DEFAULTS, ...pc }); } } catch {}
      // Notifications
      try { const v = await kvGet(NOTIF_SK); if (v != null) { const np = parse(v); if (Array.isArray(np) && !cancelled) setNotifications(np); } } catch {}
      // Video tags
      try { const v = await kvGet(YT_TAG_SK); if (v != null) { const tp = parse(v); if (tp && typeof tp === "object" && !cancelled) setYtVideoTags(tp); } } catch {}
      // Client ledger — now row-per-client in the `client_ledger` TABLE (off the settings blob).
      try { const rows = await loadClientRows(); if (Array.isArray(rows) && !cancelled) setClientLedger(rows.map(rowToClient).filter(Boolean)); } catch { /* ignore */ }
      // Date types
      try { const v = await kvGet(DT_SK); if (v != null) { const dp = parse(v); if (dp && typeof dp === "object" && !cancelled) setDateTypes(dp); } } catch {}
      // Event orders
      try { const rows = await loadEoRows(); if (Array.isArray(rows) && !cancelled) setEventOrders(rows.map(rowToEO)); } catch { /* ignore */ }
      // Photo→IMS cache
      try { const v = await kvGet(PIMAP_SK); if (v != null) { const pm = parse(v); if (pm && typeof pm === "object" && !Array.isArray(pm) && !cancelled) setPhotoImsMap(pm); } } catch {}
      // Scan history
      try { const v = await kvGet(SCAN_HIST_SK); if (v != null) { const sh = parse(v); if (sh && typeof sh === "object" && !Array.isArray(sh) && !cancelled) setScanHistory(sh); } } catch {}
      // Manual videos
      try { const v = await kvGet(MANUAL_VID_SK); if (v != null) { const mp = parse(v); if (Array.isArray(mp) && !cancelled) setManualVideos(mp); } } catch {}
      // Hidden videos
      try { const v = await kvGet(HIDDEN_VID_SK); if (v != null) { const hp = parse(v); if (hp && typeof hp === "object" && !cancelled) setHiddenVideos(hp); } } catch {}
      // Filter priority
      try { const v = await kvGet(FILTER_PRIORITY_SK); if (v != null) { const fpp = parse(v); if (Array.isArray(fpp) && fpp.length === 5 && !cancelled) setFilterPriority(fpp); } } catch {}
      // Tagging-hidden sub-categories (Pricing flags)
      try { const v = await kvGet(TAG_HIDDEN_SUBS_SK); if (v != null) { const hs = parse(v); if (Array.isArray(hs) && !cancelled) setTagHiddenSubs(hs.filter((x) => typeof x === "string")); } } catch {}
      // Palette catalogue (Studio-owned) + IMS settings (paint cats)
      try {
        const palv = await kvGet(PALETTE_SK);
        if (palv != null) { const p = parse(palv); if (p && typeof p === "object" && !cancelled) { if (Array.isArray(p.colourCatalogue) && p.colourCatalogue.length) setImsColourCatalogue(p.colourCatalogue); if (Array.isArray(p.paletteCatalogue) && p.paletteCatalogue.length) setImsPaletteCatalogue(p.paletteCatalogue); } }
        const sv = await kvGet(IMS_SETTINGS_SK);
        if (sv != null) { const s = parse(sv); if (s && typeof s === "object" && !cancelled) { if (Array.isArray(s.paintableCategories) && s.paintableCategories.length) setImsPaintableCategories(s.paintableCategories); if (typeof s.defaultPaintCostPerItem === "number") setImsDefaultPaintCost(s.defaultPaintCostPerItem); } }
      } catch {}
      // Deal Check boot loaders
      try { const rows = await fetchAll("amend_requests"); if (Array.isArray(rows) && !cancelled) setAmendRequests(rows.map((r) => ({ ...(r.data || {}), id: r.id, status: r.status ?? r.data?.status }))); } catch { /* ignore */ }
      // Knowledge set — learned photo→IMS visual identity (fail-safe: table may not exist yet).
      try { const rows = await fetchAll("dc_photo_knowledge"); if (Array.isArray(rows) && !cancelled) { const m = {}; for (const r of rows) { if (r?.id && r.data?.imsId) m[r.id] = r.data; } setPhotoKnowledge(m); } } catch { /* table missing → knowledge disabled, AI still works */ }
      try { const v = await kvGet(FLORAL_HARDPROP_MAP_SK); if (v != null) { const m = parse(v); if (m && typeof m === "object" && !Array.isArray(m) && !cancelled) setFloralHardPropMap(m); } } catch {}
      try { const v = await kvGet(DC_RUN_COUNTER_SK); if (v != null) { const rc = parse(v); if (rc && typeof rc === "object" && !Array.isArray(rc) && !cancelled) setDcRunCounter(rc); } } catch {}
      try {
        const rows = await fetchAll("soft_holds");
        if (Array.isArray(rows) && !cancelled) {
          const now = Date.now(); const live = {}; const expiredIds = [];
          for (const r of rows) { const h = r.data || {}; const exp = typeof h.expiry === "number" ? h.expiry : Date.parse(h.expiry || ""); if (exp && exp > now) live[r.id] = h; else expiredIds.push(r.id); }
          setSoftHolds(live);
          for (const id of expiredIds) supabase.from("soft_holds").delete().eq("id", id).then(() => {});
        }
      } catch {}
      try { const v = await kvGet(BATCH_TAGGER_PAUSED_SK); const meta = v && typeof v === "object" ? v : null; if (!cancelled) { setBatchTaggerPaused(!!meta?.paused); setBatchTaggerMeta(meta); } } catch {}
      try { const v = await kvGet(DC_CACHE_SK); if (v != null) { const dc = parse(v); if (dc && typeof dc === "object" && !Array.isArray(dc) && !cancelled) setDcCache(dc); } } catch {}
      try {
        const rows = await fetchAll("truss_allocations"); // now the shared table (IMS + Studio), off the blob
        if (Array.isArray(rows) && !cancelled) {
          const now = Date.now(); const cleaned = {};
          for (const r of rows) {
            const entry = rowToAlloc(r);
            if (!Array.isArray(entry.events)) { cleaned[entry.date] = entry; continue; }
            const liveEvents = entry.events.filter(ev => { if (ev.state !== "soft") return true; const exp = typeof ev.expiry === "number" ? ev.expiry : Date.parse(ev.expiry || ""); return exp && exp > now; });
            cleaned[entry.date] = { ...entry, events: liveEvents };
          }
          setTrussAlloc(cleaned);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // SAVE HELPERS — port of the reference helpers; writes route through reliableSave.
  // (The reference's merge-before-save / array-baseline machinery is collapsed to a
  // direct optimistic set + reliableSave under the kv shim, per the persistence transform.)
  // ═══════════════════════════════════════════════════════════════
  const save = useCallback(async (evs) => { setEvents(evs); await reliableSave(STORAGE_KEY, JSON.stringify(evs), "Events"); }, []);
  const saveVenues = useCallback(async (ih, od) => { setCustomInhouse(ih); setCustomOutdoor(od); await reliableSave(STORAGE_KEY + "-venues", JSON.stringify({ inhouse: ih, outdoor: od }), "Venues"); }, []);
  // Sub-venue → parent map (Aura → Exotica) so fixed-venue rules match across sub-venues.
  // Persisted to settings so IMS reads it too.
  const venueParents = useMemo(() => ({
    ...Object.fromEntries((customInhouse || []).filter(v => v.name).map(v => [v.name, v.parent || v.name])),
    ...Object.fromEntries((customOutdoor || []).filter(v => v.name).map(v => [v.name, v.name])),
  }), [customInhouse, customOutdoor]);
  useEffect(() => { if (!customInhouse.length) return; reliableSave("venueParents", JSON.stringify(venueParents), "Venue parents").catch(() => {}); }, [venueParents]);
  // Row-level rate-card persistence (off the whole-blob save; shared table with IMS). Upserts only
  // changed rows + deletes only explicit ids (rcDel passes the id) — never deletes on absence.
  const rcItemsRef = useRef([]);
  useEffect(() => { rcItemsRef.current = rcItems; }, [rcItems]);
  const saveRC = useCallback(async (ni, deletedIds) => {
    const prev = rcItemsRef.current || [];
    const prevById = {}; prev.forEach((i) => { if (i && i.id) prevById[i.id] = i; });
    rcItemsRef.current = ni; setRcItems(ni);
    const changed = (ni || []).filter((i) => i && i.id && JSON.stringify(prevById[i.id]) !== JSON.stringify(i));
    const dels = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];
    try {
      if (changed.length) {
        const rows = changed.map((i) => ({ ...rcItemToRow(i), updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("rate_card").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      for (const id of dels) await deleteRow("rate_card", id);
    } catch (e) { showMsg?.("Rate card save failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  const saveRcCats = useCallback(async (nc) => { setRcCats(nc); return await reliableSave(RC_SK_CATS, JSON.stringify(nc), "Categories"); }, []);
  // Tagging-hidden sub-categories — keyed "cat::sub". Set for O(1) lookup; toggle flips one sub.
  const tagSubKey = useCallback((cat, sub) => `${String(cat || "").trim()}::${String(sub || "").trim()}`, []);
  const tagHiddenSubSet = useMemo(() => new Set(tagHiddenSubs), [tagHiddenSubs]);
  const isSubTagHidden = useCallback((cat, sub) => tagHiddenSubSet.has(tagSubKey(cat, sub)), [tagHiddenSubSet, tagSubKey]);
  const toggleTagHiddenSub = useCallback(async (cat, sub) => {
    const key = tagSubKey(cat, sub);
    const next = tagHiddenSubs.includes(key) ? tagHiddenSubs.filter((k) => k !== key) : [...tagHiddenSubs, key];
    setTagHiddenSubs(next);
    await reliableSave(TAG_HIDDEN_SUBS_SK, JSON.stringify(next), "Tagging-hidden sub-categories");
  }, [tagHiddenSubs, tagSubKey]);
  // ── Realtime: reload shared config blobs live when changed (other device or IMS) ──
  useEffect(() => {
    const pj = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
    const ch = supabase
      .channel("studio:settings")
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, async (payload) => {
        const key = payload?.new?.key || payload?.old?.key;
        if (!key) return;
        try {
          if (key === RC_SK_CATS) { const a = pj(await kvGet(RC_SK_CATS)); if (Array.isArray(a)) setRcCats(a); }
          else if (key === RC_SK_TR) { const td = pj(await kvGet(RC_SK_TR)); if (td && typeof td === "object") { if (td.venues) setTrVenues(td.venues); if (td.truckCap) setTruckCap(td.truckCap); if (td.floralPerTruck) setFloralPerTruck(td.floralPerTruck); if (td.bufferTiers) setBufferTiers(td.bufferTiers); if (td.gensetRate !== undefined) setGensetRate(td.gensetRate); } }
          else if (key === PALETTE_SK) { const p = pj(await kvGet(PALETTE_SK)); if (p && typeof p === "object") { if (Array.isArray(p.colourCatalogue)) setImsColourCatalogue(p.colourCatalogue); if (Array.isArray(p.paletteCatalogue)) setImsPaletteCatalogue(p.paletteCatalogue); } }
          else if (key === CORR_SK) { const a = pj(await kvGet(CORR_SK)); if (Array.isArray(a)) { setCorrLog(a); corrLogRef.current = a; } }
        } catch { /* ignore */ }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  // ── Realtime: library is a TABLE — patch row-level UPDATE/DELETE live for whatever's already
  // cached (echoes of our own writes are idempotent). Since `libItems` is now a lazy cache rather
  // than the whole table, an INSERT for an id we've never queried is deliberately IGNORED here —
  // otherwise the nightly cron tagging thousands of rows overnight would silently balloon every
  // open tab's cache. Screens that need a specific row fetch it themselves (ensureLibItems / the
  // paginated browse query / zone match query), which is what populates the cache in the first place.
  useEffect(() => {
    const ch = subscribeTable("library", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          const next = (libItemsRef.current || []).filter((it) => it.id !== id);
          libItemsRef.current = next; setLibItems(next);
        } else if (payload.new) {
          const item = rowToLibItem(payload.new); if (!item?.id) return;
          const prev = libItemsRef.current || [];
          if (!prev.some((it) => it.id === item.id)) return;
          const next = prev.map((it) => (it.id === item.id ? item : it));
          libItemsRef.current = next; setLibItems(next);
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: rate card is now a TABLE — apply row-level changes live (Studio price edits AND
  // IMS recipe-driven reconciliation both land here). Echoes of our own writes are idempotent. ──
  useEffect(() => {
    const ch = subscribeTable("rate_card", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setRcItems((prev) => { const next = prev.filter((i) => i.id !== id); rcItemsRef.current = next; return next; });
        } else if (payload.new) {
          const it = rowToRcItem(payload.new); if (!it?.id) return;
          setRcItems((prev) => { const i = prev.findIndex((x) => x.id === it.id); const next = i >= 0 ? prev.map((x) => (x.id === it.id ? it : x)) : [...prev, it]; rcItemsRef.current = next; return next; });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: sub-category scaling factors (IMS-owned, rate_card_categories) — Rate Card → IMS
  // migration Phase 1. Studio just mirrors row-level changes live; nothing consumes this yet (Phase 2). ──
  useEffect(() => {
    const ch = subscribeTable("rate_card_categories", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setRcSubcatFactors((prev) => prev.filter((r) => r.id !== id));
        } else if (payload.new) {
          const row = payload.new; if (!row?.id) return;
          setRcSubcatFactors((prev) => { const i = prev.findIndex((r) => r.id === row.id); return i >= 0 ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]; });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: knowledge set — a teach/learn from any salesperson propagates to everyone live. ──
  useEffect(() => {
    const ch = subscribeTable("dc_photo_knowledge", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setPhotoKnowledge((prev) => { const n = { ...prev }; delete n[id]; return n; });
        } else if (payload.new?.id && payload.new.data?.imsId) {
          setPhotoKnowledge((prev) => ({ ...prev, [payload.new.id]: payload.new.data }));
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: amend requests are now a TABLE — reflect IMS approve/reject decisions live. ──
  useEffect(() => {
    const ch = subscribeTable("amend_requests", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setAmendRequests((prev) => prev.filter((r) => r.id !== id));
        } else if (payload.new) {
          const req = { ...(payload.new.data || {}), id: payload.new.id, status: payload.new.status ?? payload.new.data?.status };
          setAmendRequests((prev) => { const i = prev.findIndex((r) => r.id === req.id); return i >= 0 ? prev.map((r) => (r.id === req.id ? req : r)) : [...prev, req]; });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: event orders are now a TABLE — apply row-level changes live so Studio sees IMS's
  // dept-ops / actuals edits (deptOps in the data column) without a refresh. ──
  useEffect(() => {
    const ch = subscribeTable("event_orders", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setEventOrders((prev) => { const next = prev.filter((e) => e.id !== id); eventOrdersRef2.current = next; return next; });
        } else if (payload.new) {
          const eo = rowToEO(payload.new); if (!eo?.id) return;
          setEventOrders((prev) => { const i = prev.findIndex((e) => e.id === eo.id); const next = i >= 0 ? prev.map((e) => (e.id === eo.id ? eo : e)) : [...prev, eo]; eventOrdersRef2.current = next; return next; });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: client ledger is now a TABLE — apply row-level changes live. ──
  useEffect(() => {
    const ch = subscribeTable("client_ledger", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setClientLedger((prev) => prev.filter((c) => c.id !== id));
        } else if (payload.new) {
          const c = rowToClient(payload.new); if (!c?.id) return;
          setClientLedger((prev) => { const i = prev.findIndex((x) => x.id === c.id); return i >= 0 ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]; });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  const saveTpl = useCallback(async (nt) => { setTemplates(nt); await reliableSave(TPL_SK, JSON.stringify(nt), "Template"); }, []);
  const saveZD = useCallback(async (nd) => { setZoneDefs(nd); await reliableSave(ZONE_DEF_SK, JSON.stringify(nd), "Zone config"); }, []);
  // Row-level library persistence. `nl` is the set of items to upsert (NOT the whole library —
  // now that `libItems` is a lazy cache rather than the full table, callers pass just the item(s)
  // they changed/added, or a locally-known slice with edits applied — either way). We UPSERT only
  // the rows that actually changed vs. what was cached, DELETE only ids explicitly passed in
  // `deletedIds`, and MERGE `nl` into the existing cache (never replace it wholesale) — so saving
  // one edited photo can't wipe out everything else a screen has already loaded.
  const saveLib = useCallback(async (nl, deletedIds) => {
    const prev = libItemsRef.current || [];
    const prevById = {}; prev.forEach((it) => { if (it && it.id) prevById[it.id] = it; });
    const changed = (nl || []).filter((it) => it && it.id && JSON.stringify(prevById[it.id]) !== JSON.stringify(it));
    const dels = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];
    const byId = new Map(prev.map((it) => [it.id, it]));
    (nl || []).forEach((it) => { if (it && it.id) byId.set(it.id, it); });
    dels.forEach((id) => byId.delete(id));
    const merged = [...byId.values()];
    libItemsRef.current = merged; setLibItems(merged);
    try {
      if (changed.length) {
        const rows = changed.map((it) => ({ ...libItemToRow(it), updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("library").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      for (const id of dels) await deleteRow("library", id);
    } catch (e) { showMsg?.("Library save failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  // Append one human correction to the shared log (who/what/when) for contribution reporting.
  // Best-effort append (same shared-blob model as the rest of the app); capped to the latest 5000.
  const logCorrection = useCallback((info) => {
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), user: authUser?.name || "—", userId: authUser?.id || "", photoId: info?.photoId || "", photoName: info?.photoName || "", source: info?.source || "build", kind: info?.kind || "photo", ts: Date.now() };
    const next = [entry, ...corrLogRef.current].slice(0, 5000);
    corrLogRef.current = next;
    setCorrLog(next);
    reliableSave(CORR_SK, JSON.stringify(next), "Corrections log").catch(() => {});
  }, [authUser]);
  // ── AI-tagging knowledge base (distilled from VERIFIED photos) ──────────────────────────────────
  // Rebuilt from the current verified library; injected into the tagger's cached prompt. Lighting
  // rate-card names let it total "lights" per photo. Returns the new KB (or null if nothing verified).
  // Fetches verified photos directly (server-side `status='verified'` query) rather than relying
  // on the lazy libItems cache — the KB needs the WHOLE verified set, which the cache can't promise.
  const rebuildTagKB = useCallback(async () => {
    const verified = (await fetchVerifiedLibraryPhotos()).filter((i) => i && i.tags);
    mergeLibItems(verified);
    if (!verified.length) return null;
    const lightNames = new Set((rcItems || []).filter((i) => String(i.cat || "").toLowerCase() === "lighting").map((i) => String(i.name).toLowerCase().trim()));
    const kb = buildTagKB(verified, lightNames);
    kb.promptText = renderTagKBText(kb); // persist the rendered text so the nightly edge function can reuse it
    setTagKB(kb);
    reliableSave(TAG_KB_SK, JSON.stringify(kb), "Tag knowledge base").catch(() => {});
    return kb;
  }, [rcItems, mergeLibItems]);
  // Auto-refresh: rebuild the KB if it's missing or older than 24h. Runs at most once per app load
  // (the ref guard); the manual "Rebuild now" button bypasses it. rebuildTagKB itself no-ops (returns
  // null) when there's nothing verified yet, so no separate "is there anything to learn from" gate is needed here.
  useEffect(() => {
    if (tagKBRebuildRef.current) return;
    const stale = !tagKB || !tagKB.builtAt || (Date.now() - tagKB.builtAt > 24 * 3600 * 1000);
    if (!stale) { tagKBRebuildRef.current = true; return; }
    tagKBRebuildRef.current = true;
    rebuildTagKB();
  }, [tagKB, rebuildTagKB]);
  const saveTax = useCallback(async (nt) => { setTaxonomy(nt); await reliableSave(TAX_SK, JSON.stringify(nt), "Taxonomy"); }, []);
  const saveTeam = useCallback(async (nt) => { setTeamData(nt); await reliableSave(TEAM_SK, JSON.stringify(nt), "Team"); }, []);
  // Row-level client-ledger persistence (off the whole-blob save). Upserts only changed rows and
  // deletes only explicit ids — never deletes a client just because it's absent from `nl` (so the
  // slice(0,500) cap in the Client Tracker can't drop rows). Mirrors the library approach.
  const clientLedgerRef = useRef([]);
  useEffect(() => { clientLedgerRef.current = clientLedger; }, [clientLedger]);
  const saveClientLedger = useCallback(async (nl, deletedIds) => {
    const prev = clientLedgerRef.current || [];
    const prevById = {}; prev.forEach((c) => { if (c && c.id) prevById[c.id] = c; });
    clientLedgerRef.current = nl; setClientLedger(nl);
    const changed = (nl || []).filter((c) => c && c.id && JSON.stringify(prevById[c.id]) !== JSON.stringify(c));
    const dels = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];
    try {
      if (changed.length) {
        const rows = changed.map((c) => ({ ...clientToRow(c), updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("client_ledger").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      for (const id of dels) await deleteRow("client_ledger", id);
    } catch (e) { showMsg?.("Client save failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  const saveDateTypes = useCallback(async (nd) => { setDateTypes(nd); await reliableSave(DT_SK, JSON.stringify(nd), "Date types"); }, []);
  const savePremiaConfig = useCallback(async (nc) => { const m = { ...PREMIA_DEFAULTS, ...nc }; setPremiaConfig(m); await reliableSave(PREMIA_CFG_SK, JSON.stringify(m), "Premia config"); }, []);
  // Submit a last-minute amendment request to the department head. Re-reads the
  // shared list first so a concurrent IMS-side decision isn't clobbered.
  const submitAmendRequest = useCallback(async (req) => {
    // amend_requests is now a TABLE — submitting is a single-row upsert (inherently clobber-safe:
    // it only writes this request, never the whole list).
    const r = { ...req, id: req.id || ("AMR" + Date.now().toString(36)) };
    setAmendRequests((prev) => [...prev.filter((x) => x.id !== r.id), r]);
    try { const { error } = await supabase.from("amend_requests").upsert({ id: r.id, status: r.status ?? null, data: r }, { onConflict: "id" }); if (error) throw error; }
    catch (e) { showMsg?.("Amend request failed: " + (e?.message || e), "red"); }
    return r;
  }, [showMsg]);
  // Row-level event-order persistence to the shared `event_orders` TABLE (mirrors IMS's writer).
  // Upserts only changed EOs + deletes removed/explicit ids. Because Studio now READS the table,
  // each eo carries IMS-owned deptOps, so writing it back preserves them (no clobber).
  // When a salesperson REGENERATES the Deal Check, the next sync wipes deptOps for a full fresh
  // start (dept head's plan + actuals discarded, per owner decision) — set by runDealCheckGenerate.
  const deptWipeRef = useRef(false);
  const eventOrdersRef2 = useRef([]);
  useEffect(() => { eventOrdersRef2.current = eventOrders; }, [eventOrders]);
  const saveEventOrders = useCallback(async (neo, deletedIds = []) => {
    const prev = eventOrdersRef2.current || [];
    eventOrdersRef2.current = neo; setEventOrders(neo);
    const prevMap = new Map(prev.map((e) => [e.id, e]));
    const nextIds = new Set((neo || []).map((e) => e.id));
    try {
      for (const eo of (neo || [])) {
        const before = prevMap.get(eo.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(eo)) {
          const { error } = await supabase.from("event_orders").upsert(eoToRow(eo), { onConflict: "id" });
          if (error) throw error;
        }
      }
      for (const id of [...(deletedIds || []), ...[...prevMap.keys()].filter((id) => !nextIds.has(id))]) {
        await deleteRow("event_orders", id);
      }
    } catch (e) { showMsg?.("Event order save failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  // Persist the Deal Check department breakdown onto the client's SOLD event-order row (table), so
  // IMS Dept Ops shows the SAME numbers (income, inventory-with-photos, manpower) Studio computed.
  const persistDeptSnapshot = useCallback(async (snap) => {
    const eo = (eventOrders || []).find(e => e.clientId === activeClientId) || (eventOrders || []).find(e => (e.clientName || "") === (clientName || "").trim());
    if (!eo) return;
    // Signature of the WHOLE projected breakdown (income + per-dept manpower + inventory + fabric) —
    // used to skip redundant writes. Covering all of it (not just income totals) means a change to the
    // manpower split or fabric plan also re-syncs, so the stored snapshot can't drift out of sync.
    const sig = JSON.stringify({ inc: snap.income || {}, mp: snap.manpowerDetail || {}, inv: snap.inventory || {}, fab: snap.fabricPlan || {} });
    // Merge ONLY the Studio-owned projected fields. deptOps (the dept head's edits / actuals — IMS-owned)
    // is preserved verbatim, so re-syncing never wipes their work.
    // After a regenerate, wipe deptOps (dept head's plan + actuals) so IMS starts fresh from the new plan.
    const wipe = deptWipeRef.current; if (wipe) deptWipeRef.current = false; // one-shot per regenerate
    const applySnap = (base) => ({ ...base, ...(wipe ? { deptOps: {} } : {}), deptIncome: snap.income || {}, deptInventory: snap.inventory || {}, floralPlan: snap.floralPlan || base.floralPlan || null, fabricPlan: snap.fabricPlan || base.fabricPlan || null, manpowerPlan: snap.manpowerPlan || [], manpowerDetail: snap.manpowerDetail || {}, mpPhases: snap.mpPhases || null, deptSeason: snap.season || null, deptIncomeSig: sig, deptSyncedAt: Date.now() });
    try {
      // Read the FRESHEST row so we never clobber IMS-owned fields with Studio's stale local copy.
      const { data: row } = await supabase.from("event_orders").select("data").eq("id", eo.id).maybeSingle();
      if (row && row.data) {
        const cur = row.data;
        // Skip only when truly in sync: same signature AND the income snapshot is actually present.
        // (If the income was lost but the marker lingered, we must re-push to heal it.)
        const incomeOk = cur.deptIncome && Object.keys(cur.deptIncome).length > 0;
        if (cur.deptSyncedAt && cur.deptIncomeSig === sig && incomeOk) return; // already in sync — leave the head's edits untouched
        await supabase.from("event_orders").update({ data: applySnap(cur) }).eq("id", eo.id);
      } else {
        // No table row yet → create it from the local EO (first sync).
        const merged = applySnap(eo);
        await supabase.from("event_orders").upsert({ id: eo.id, client_name: eo.clientName ?? null, event_id: eo.eventId ?? null, fn_id: eo.fnId ?? null, status: eo.status ?? "pending", items: eo.items || [], manual_items: eo.manualItems || [], decisions: eo.decisions || {}, data: merged }, { onConflict: "id" });
      }
    } catch (e) { /* best-effort */ }
  }, [eventOrders, activeClientId, clientName]);
  const savePhotoImsMap = useCallback(async (nm) => { setPhotoImsMap(nm); await reliableSave(PIMAP_SK, JSON.stringify(nm), "Photo-IMS map"); }, []);
  // Read back the dept-head ACTUALS (real mandi + on-site expenses) that IMS wrote onto the event
  // order row, so Deal Check can show exact cost. The IMS deptOps live on the event_orders TABLE.
  const [dcEoActuals, setDcEoActuals] = useState(null);
  const refreshDcEoActuals = useCallback(async () => {
    const eo = (eventOrders || []).find(e => e.clientId === activeClientId) || (eventOrders || []).find(e => (e.clientName || "") === (clientName || "").trim());
    if (!eo) { setDcEoActuals(null); return; }
    try { const { data } = await supabase.from("event_orders").select("data").eq("id", eo.id).maybeSingle(); const d = data?.data; setDcEoActuals(d ? { deptOps: d.deptOps || {}, floralPlan: d.floralPlan || null } : null); }
    catch { setDcEoActuals(null); }
  }, [eventOrders, activeClientId, clientName]);
  const saveScanHistory = useCallback(async (nh) => { setScanHistory(nh); await reliableSave(SCAN_HIST_SK, JSON.stringify(nh), "Scan history"); }, []);
  const saveYtTags = useCallback(async (nt) => { setYtVideoTags(nt); await reliableSave(YT_TAG_SK, JSON.stringify(nt), "Video tags"); }, []);

  // AREAS ↔ ZONES SYNC (bidirectional additive) — VERBATIM
  const addTagWithAreaZoneSync = useCallback(async (category, newTag) => {
    const trimmed = (newTag || "").trim(); if (!trimmed) return false;
    const existing = taxonomy[category] || [];
    if (existing.includes(trimmed)) return false;
    const nextTax = { ...taxonomy, [category]: [...existing, trimmed] };
    if (category === "areasElements" && !findZoneForArea(trimmed, zoneDefs.meta)) {
      const newZid = makeZoneId(trimmed, zoneDefs.meta);
      await saveZD({ ...zoneDefs, meta: { ...zoneDefs.meta, [newZid]: defaultZoneFromArea(trimmed) } });
    }
    await saveTax(nextTax);
    return true;
  }, [taxonomy, zoneDefs, saveTax, saveZD]);
  const addZoneWithAreaSync = useCallback(async (label) => {
    const clean = (label || "").trim(); if (!clean) return false;
    if (findZoneForArea(clean, zoneDefs.meta)) { showMsg("Zone with this name already exists", "red"); return false; }
    const newZid = makeZoneId(clean, zoneDefs.meta);
    const newZone = { label: clean, dimFields: ["L", "W", "H"], defaultTruss: "box", hasPlatform: false, hasCarpet: false, hasMasking: false, icon: "📦" };
    const nextZones = { ...zoneDefs, meta: { ...zoneDefs.meta, [newZid]: newZone } };
    const existingArea = findAreaForZone(newZid, newZone, taxonomy.areasElements);
    if (!existingArea) await saveTax({ ...taxonomy, areasElements: [...(taxonomy.areasElements || []), clean] });
    await saveZD(nextZones);
    return true;
  }, [zoneDefs, taxonomy, saveZD, saveTax]);

  // ═══════════════════════════════════════════════════════════════
  // PRICING ENGINE CLOSURES — VERBATIM from the reference.
  // ═══════════════════════════════════════════════════════════════
  const rcIsSMB = (rc) => rc && ((rc.inhouseS || 0) > 0 || (rc.inhouseM || 0) > 0 || (rc.inhouseB || 0) > 0 || rc.inhouseMode === "smb");

  const buildZoneConfig = (zk, photoDims) => {
    const zm = zoneMeta[zk]; if (!zm || !zm.dimFields?.length) return null;
    const d = photoDims || {};
    const dims = {};
    if (d.trussL) dims.L = d.trussL;
    if (d.trussW) dims.W = d.trussW;
    if (d.trussH) dims.H = d.trussH;
    if (d.trussL || d.trussW) dims.S = d.trussL || d.trussW;
    zm.dimFields.forEach(f => { if (dims[f] === undefined) dims[f] = 0; });
    const floorDims = {};
    if (d.floorL) floorDims.L = d.floorL;
    if (d.floorW) floorDims.W = d.floorW;
    const hasDims = (dims.L || 0) > 0 || (dims.W || 0) > 0 || (dims.H || 0) > 0 || (dims.S || 0) > 0;
    const numDims = [dims.L, dims.W, dims.H].filter(v => (v || 0) > 0).length;
    const trT = hasDims ? (numDims >= 3 ? "box" : (zm.defaultTruss || "singleU")) : (zm.defaultTruss || null);
    return {
      dims: hasDims ? dims : Object.fromEntries(zm.dimFields.map(f => [f, 0])),
      floorDims: Object.keys(floorDims).length ? floorDims : (hasDims ? { ...dims } : {}),
      trT, mkOn: !!d.mkT, mkT: d.mkT || null, mkWalls: d.mkWalls || {},
      plH: d.plH || null, cpT: hasDims ? "new" : null,
      // Carry truss quantity + box front-extension tagged on the library photo through to Build.
      trussQty: Math.max(1, Number(d.trussQty) || 1),
      trussFrontExt: Number(d.trussFrontExt) || 0,
      trussFrontExtH: Number(d.trussFrontExtH) || 0,
    };
  };

  const getFloralMode = useCallback((rc) => {
    if (!rc || (rc.cat || "").toLowerCase() !== "florals") return "ratio";
    if (rc.floralMode === "ratio" || rc.floralMode === "real" || rc.floralMode === "artificial") return rc.floralMode;
    const hasArt = (rc.artificialFlat || 0) > 0 || (rc.artificialS || 0) > 0 || (rc.artificialM || 0) > 0 || (rc.artificialB || 0) > 0;
    if (!hasArt) return "ratio";
    const dp = typeof rc.defaultRealPct === "number" ? rc.defaultRealPct : (rc.unit === "truss_sqft" ? 0 : 100);
    return dp >= 50 ? "real" : "artificial";
  }, []);

  const applyFloralRatio = useCallback((unitPrice, rc) => unitPrice, []);

  // Load a lightweight floral recipe dataset ONCE on mount so the Build view can auto-derive floral
  // artificial rates without the user first opening Deal Check (which is what fetches the full
  // dealCheckData). floralArtUnitRate/patternExtra prefer dealCheckData (date-aware, fresher) and fall
  // back to this.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("settings").select("key,value").in("key", [
          "flowerPatterns", "mandiCatalogue", "artificialFlowerRatePerKg", "artificialFlowerBunchesPerKg",
          "artificialGreenRatePerKg", "artificialGreenBunchesPerKg", "defaultStudioMarkup",
          "fixedVenues", "fixedVenueSubcatDiscount",
        ]);
        const s = {};
        (data || []).forEach(r => { let v = r?.value; for (let i = 0; i < 2; i++) { if (typeof v === "string") { try { v = JSON.parse(v); } catch { break; } } } s[r.key] = v; });
        if (cancelled) return;
        setStudioFloralData({
          flowerPatterns: Array.isArray(s.flowerPatterns) ? s.flowerPatterns : [],
          mandiCatalogue: Array.isArray(s.mandiCatalogue) ? s.mandiCatalogue : [],
          artificialFlowerRatePerKg: typeof s.artificialFlowerRatePerKg === "number" ? s.artificialFlowerRatePerKg : 50,
          artificialFlowerBunchesPerKg: (typeof s.artificialFlowerBunchesPerKg === "number" && s.artificialFlowerBunchesPerKg > 0) ? s.artificialFlowerBunchesPerKg : 16,
          artificialGreenRatePerKg: typeof s.artificialGreenRatePerKg === "number" ? s.artificialGreenRatePerKg : 40,
          artificialGreenBunchesPerKg: (typeof s.artificialGreenBunchesPerKg === "number" && s.artificialGreenBunchesPerKg > 0) ? s.artificialGreenBunchesPerKg : 23,
          defaultStudioMarkup: Number(s.defaultStudioMarkup ?? 3) || 3,
          fixedVenues: Array.isArray(s.fixedVenues) ? s.fixedVenues : [],
          fixedVenueSubcatDiscount: (s.fixedVenueSubcatDiscount && typeof s.fixedVenueSubcatDiscount === "object") ? s.fixedVenueSubcatDiscount : {},
        });
      } catch { /* ignore — floral auto-derive falls back to flat rate */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-derived artificial rate PER UNIT for a floral recipe element = Σ(recipe flowers × artificial
  // bunches-per-unit) × ₹/bunch × studio markup. Mirrors calcFnFloralSourcingCost's artificial cost so
  // the client charge for the artificial portion is never ₹0 just because a flat rate wasn't typed in.
  // Returns null when the element has NO recipe (caller then falls back to the flat rate-card artificial rate).
  const floralArtUnitRate = useCallback((rc, size) => {
    const src = dealCheckData || studioFloralData || {};
    const fp = src.flowerPatterns || [];
    if (!fp.length) return null;
    const mc = src.mandiCatalogue || [];
    const afRate = Number(src.artificialFlowerRatePerKg ?? 50);
    const afBPK = Number(src.artificialFlowerBunchesPerKg ?? 16) || 16;
    const agRate = Number(src.artificialGreenRatePerKg ?? 40);
    const agBPK = Number(src.artificialGreenBunchesPerKg ?? 23) || 23;
    const markup = Number(src.defaultStudioMarkup ?? 3) || 3;
    const tn = String(rc?.name || "").toLowerCase().trim();
    let pat = fp.find(p => String(p?.name || "").toLowerCase().trim() === tn);
    if (!pat) pat = fp.find(p => { const n = String(p?.name || "").toLowerCase().trim(); return n && tn && (n.includes(tn) || tn.includes(n)); });
    if (!pat) return null;
    const sz = String(size || "").toUpperCase();
    const sk = rcIsSMB(rc) ? (sz === "S" || sz === "SMALL" ? "small" : (sz === "B" || sz === "BIG" || sz === "LARGE" || sz === "PREMIUM" || sz === "HEAVY" ? "big" : "medium")) : "medium";
    const sizes = pat.sizes || {};
    let comp = sizes[sk] || sizes.medium; if (!comp && sk === "big" && sizes.large) comp = sizes.large;
    if (!comp && Object.keys(sizes).length) comp = sizes[Object.keys(sizes)[0]];
    if (!comp || !Array.isArray(comp.flowers)) return null;
    let cost = 0;
    comp.flowers.forEach(fl => {
      const parent = resolveMandiFlower(fl.flowerId, mc)?.parent || null;
      const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
      if (ft === "real_only") return; // this flower has no artificial substitute
      const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
      const bunches = (Number(fl.qty) || 0) * bpu;
      cost += bunches * (ft === "green" ? agRate / agBPK : afRate / afBPK);
    });
    return Math.round(cost * markup);
  }, [dealCheckData, studioFloralData]);

  // Fixed extra cost (pot / base / frame) for a floral recipe element+size, added AFTER markup (flat ₹).
  const patternExtra = useCallback((rc, size) => {
    const fp = (dealCheckData || studioFloralData)?.flowerPatterns || [];
    if (!fp.length) return 0;
    const tn = String(rc?.name || "").toLowerCase().trim();
    let pat = fp.find(p => String(p?.name || "").toLowerCase().trim() === tn);
    if (!pat) pat = fp.find(p => { const n = String(p?.name || "").toLowerCase().trim(); return n && tn && (n.includes(tn) || tn.includes(n)); });
    if (!pat) return 0;
    const sz = String(size || "").toUpperCase();
    const sk = rcIsSMB(rc) ? (sz === "S" || sz === "SMALL" ? "small" : (sz === "B" || sz === "BIG" || sz === "LARGE" || sz === "PREMIUM" || sz === "HEAVY" ? "big" : "medium")) : "medium";
    const sizes = pat.sizes || {};
    let comp = sizes[sk] || sizes.medium; if (!comp && sk === "big" && sizes.large) comp = sizes.large;
    if (!comp && Object.keys(sizes).length) comp = sizes[Object.keys(sizes)[0]];
    return Number(comp?.extraCost) || 0;
  }, [dealCheckData, studioFloralData]);

  const getElPrice = useCallback((el, zc) => {
    const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
    if (!rc) return { rc: null, unitPrice: 0, lineCost: 0, area: 0, warning: null, isFloralBlend: false, realPct: null };
    const isFloral = (rc.cat || "").toLowerCase() === "florals";
    const mode = getFloralMode(rc);
    const sz = (el.size || "").toUpperCase();
    let realRate = 0, artRate = 0;
    if (rcIsSMB(rc)) {
      if (sz === "S" || sz === "SMALL") { realRate = rc.inhouseS || 0; artRate = rc.artificialS || 0; }
      else if (sz === "B" || sz === "BIG" || sz === "LARGE" || sz === "PREMIUM" || sz === "HEAVY") { realRate = rc.inhouseB || 0; artRate = rc.artificialB || 0; }
      else { realRate = rc.inhouseM || 0; artRate = rc.artificialM || 0; }
    } else {
      realRate = rc.inhouseFlat || 0;
      artRate = rc.artificialFlat || 0;
    }
    let up = 0, realPct = null;
    if (isFloral) {
      let modeDefault;
      if (mode === "real") modeDefault = 100;
      else if (mode === "artificial") modeDefault = 0;
      else modeDefault = Math.max(0, Math.min(100, 100 - floralRatio));
      realPct = (typeof el.realPct === "number") ? Math.max(0, Math.min(100, el.realPct)) : modeDefault;
      // Recipe elements → auto-derive the artificial rate (so it's never ₹0); props with no recipe use the flat rate.
      const autoArt = floralArtUnitRate(rc, el.size);
      const effArt = (autoArt != null) ? autoArt : (artRate > 0 ? artRate : realRate); // recipe → auto-derive; else the flat artificial rate; else fall back to the real/flat rate so a flat-priced floral (e.g. an accessory on 100% artificial with no recipe/artificial rate) never shows ₹0
      up = Math.round(realPct / 100 * realRate + (100 - realPct) / 100 * effArt);
      if (rc.unit !== "truss_sqft") up += patternExtra(rc, el.size); // pot/base extra (per pc), added after markup
    } else {
      up = realRate;
    }
    if (rc.unit === "truss_sqft") {
      const d = (zc && zc.dims) || {};
      const fd = (zc && zc.floorDims) || d;
      let area = 0, warning = null;
      if (zc && zc.trT === "box") {
        area = (d.L || 0) * (d.W || 0);
      } else {
        area = (fd.L || 0) * (fd.W || 0);
        if (area > 0) warning = "⚠ No box truss — using floor area; confirm venue has pre-built structure for hangings";
        else warning = "⚠ Add box truss or zone dimensions for hanging area";
      }
      return { rc, unitPrice: up, lineCost: area * up, area, warning, isFloralBlend: isFloral, realPct };
    }
    return { rc, unitPrice: up, lineCost: (el.qty || 0) * up, area: 0, warning: null, isFloralBlend: isFloral, realPct };
  }, [rcItems, getFloralMode, floralRatio, floralArtUnitRate, patternExtra]);

  const calcElsCost = useCallback((elements, withFloral, zc) => {
    return (elements || []).reduce((s, el) => {
      const { rc, lineCost } = getElPrice(el, zc);
      if (!withFloral || !rc) return s + lineCost;
      if (rc.unit === "truss_sqft") return s + applyFloralRatio(lineCost, rc);
      return s + (el.qty || 0) * applyFloralRatio(lineCost / (el.qty || 1), rc);
    }, 0);
  }, [getElPrice, applyFloralRatio]);

  const getElPriceForFn = useCallback((el, zc, fnRatio) => {
    const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
    if (!rc) return { rc: null, unitPrice: 0, lineCost: 0 };
    const isFloral = (rc.cat || "").toLowerCase() === "florals";
    const mode = getFloralMode(rc);
    const sz = (el.size || "").toUpperCase();
    let realRate = 0, artRate = 0;
    if (rcIsSMB(rc)) {
      if (sz === "S" || sz === "SMALL") { realRate = rc.inhouseS || 0; artRate = rc.artificialS || 0; }
      else if (sz === "B" || sz === "BIG" || sz === "LARGE" || sz === "PREMIUM" || sz === "HEAVY") { realRate = rc.inhouseB || 0; artRate = rc.artificialB || 0; }
      else { realRate = rc.inhouseM || 0; artRate = rc.artificialM || 0; }
    } else {
      realRate = rc.inhouseFlat || 0;
      artRate = rc.artificialFlat || 0;
    }
    let up = 0;
    if (isFloral) {
      let modeDefault;
      if (mode === "real") modeDefault = 100;
      else if (mode === "artificial") modeDefault = 0;
      else modeDefault = Math.max(0, Math.min(100, 100 - (typeof fnRatio === "number" ? fnRatio : 70)));
      const realPct = (typeof el.realPct === "number") ? Math.max(0, Math.min(100, el.realPct)) : modeDefault;
      const autoArt = floralArtUnitRate(rc, el.size);
      const effArt = (autoArt != null) ? autoArt : (artRate > 0 ? artRate : realRate); // recipe → auto-derive; else the flat artificial rate; else fall back to the real/flat rate so a flat-priced floral (e.g. an accessory on 100% artificial with no recipe/artificial rate) never shows ₹0
      up = Math.round(realPct / 100 * realRate + (100 - realPct) / 100 * effArt);
      if (rc.unit !== "truss_sqft") up += patternExtra(rc, el.size);
    } else {
      up = realRate;
    }
    if (rc.unit === "truss_sqft") {
      const d = (zc && zc.dims) || {};
      const fd = (zc && zc.floorDims) || d;
      let area = 0;
      if (zc && zc.trT === "box") area = (d.L || 0) * (d.W || 0);
      else area = (fd.L || 0) * (fd.W || 0);
      return { rc, unitPrice: up, lineCost: area * up };
    }
    return { rc, unitPrice: up, lineCost: (el.qty || 0) * up };
  }, [rcItems, getFloralMode, floralArtUnitRate, patternExtra]);

  const calcElsCostForFn = useCallback((elements, zc, fnRatio) => {
    return (elements || []).reduce((s, el) => s + getElPriceForFn(el, zc, fnRatio).lineCost, 0);
  }, [getElPriceForFn]);

  const calcPhotoCost = useCallback((zoneKey, photo) => {
    const zc = (photo?.dims && Object.values(photo.dims).some(v => v > 0)) ? buildZoneConfig(zoneKey, photo.dims) : null;
    const elCost = calcElsCost(photo?.elements, true, zc);
    const structCost = zc ? calcStructCost(zoneKey, zc).total : 0;
    return elCost + structCost;
  }, [calcElsCost]);

  const calcFullEventCost = useCallback((ev) => {
    if (!ev) return 0;
    let decorCost = 0;
    let totalFloralCostFull = 0;
    const itemAgg = {};
    const vidUrl = ev.video || "";
    const vidMatch = vidUrl.match(/embed\/([a-zA-Z0-9_-]{11})/);
    const vidId = vidMatch ? vidMatch[1] : null;
    const vTag = vidId ? (ytVideoTags[vidId] || {}) : {};
    const zonePhotos = vTag.zonePhotos || {};
    Object.entries(zonePhotos).forEach(([zk, libId]) => {
      const li = libItems.find(l => l.id === libId);
      if (!li) return;
      const pd = li.dims || {};
      if (pd.trussW || pd.trussL || pd.trussH || pd.floorL || pd.floorW) {
        const zc = buildZoneConfig(zk, pd);
        if (zc) decorCost += calcStructCost(zk, zc).total;
        const tL = pd.trussL || 0, tW = pd.trussW || 0;
        const tSqft = tL * tW;
        if (tSqft > 0) { const tc = truckCap.find(t => t.item.toLowerCase().includes("truss") && t.perTruck > 0); if (tc) itemAgg[tc.id] = (itemAgg[tc.id] || 0) + tSqft; }
        const fL = pd.floorL || tL, fW = pd.floorW || tW;
        const fSqft = fL * fW;
        if (fSqft > 0) {
          const ptc = truckCap.find(t => t.item.toLowerCase().includes("platform") && t.perTruck > 0);
          if (ptc && pd.plH) itemAgg[ptc.id] = (itemAgg[ptc.id] || 0) + fSqft;
          const ctc = truckCap.find(t => t.item.toLowerCase().includes("carpet") && t.perTruck > 0);
          if (ctc) itemAgg[ctc.id] = (itemAgg[ctc.id] || 0) + fSqft;
        }
      }
      if (!(li.elements || []).length) return;
      (li.elements || []).forEach(el => {
        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
        if (!rc) return;
        let up = 0; const sz = (el.size || "").toUpperCase();
        if (rcIsSMB(rc)) { if (sz === "S") up = rc.inhouseS || 0; else if (sz === "B") up = rc.inhouseB || 0; else up = rc.inhouseM || 0; }
        else { up = rc.inhouseFlat || 0; }
        if ((rc.cat || "").toLowerCase() === "florals") {
          totalFloralCostFull += (el.qty || 0) * up;
          up = getElPrice(el, null).unitPrice;
        } else {
          const subTc = truckCap.find(tc => (Number(tc.perTruck) || 0) > 0 && String(tc.item || "").toLowerCase().trim() === String(rc.sub || "").toLowerCase().trim());
          if (subTc) itemAgg[subTc.id] = (itemAgg[subTc.id] || 0) + (el.qty || 0);
        }
        decorCost += (el.qty || 0) * up;
      });
    });
    const venueName = ev.venue || "";
    const match = trVenues.find(v => v.name.toLowerCase() === venueName.toLowerCase());
    const tripRate = match ? match.rate : 0;
    let truckFrac = 0;
    Object.entries(itemAgg).forEach(([tcId, qty]) => { const tc = truckCap.find(t => t.id === tcId); if (!tc || !tc.perTruck) return; truckFrac += qty / tc.perTruck; });
    const itemTrucks = Math.ceil(truckFrac);
    const floralTrucks = 0; // florals counted via their sub-category capacity — no separate flower truck
    const bt = bufferTiers.find(b => decorCost >= b.minBudget && decorCost < b.maxBudget);
    const bufTrucks = bt ? bt.bufferTrucks : 0;
    const allTrucks = itemTrucks + floralTrucks + bufTrucks;
    const truckTotal = allTrucks * tripRate * 2;
    const gensets = match ? (match.gensets || 1) : 1;
    const gensetCost = gensets * gensetRate;
    return decorCost + truckTotal + gensetCost;
  }, [ytVideoTags, libItems, rcItems, getElPrice, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate]);

  const fullCostMap = useMemo(() => {
    const m = {};
    events.forEach(ev => { m[ev.id] = calcFullEventCost(ev); });
    return m;
  }, [events, calcFullEventCost]);
  const getFullCost = useCallback((ev) => fullCostMap[ev.id] ?? calcFullEventCost(ev), [fullCostMap, calcFullEventCost]);

  const isPremiaPlatinum = useCallback((ev) => {
    if (!ev) return false;
    const vidUrl = ev.video || "";
    const vidMatch = vidUrl.match(/embed\/([a-zA-Z0-9_-]{11})/);
    const vidId = vidMatch ? vidMatch[1] : null;
    const tagTier = vidId ? ytVideoTags[vidId]?.tier : null;
    // Gate on TAGGING only — a design is Platinum (Sr. Designer only) purely because it's tagged
    // Platinum. Price is never used to gate, so a pricey Gold video customizes normally.
    return tagTier === "Platinum";
  }, [ytVideoTags]);

  const filteredEvents = useMemo(() => events.filter(ev => {
    if (filterCat.length > 0 && !filterCat.includes(getCat(getFullCost(ev)).label)) return false;
    if (filterFn.length > 0 && !filterFn.includes(ev.fn)) return false;
    if (filterSpace.length > 0 && !filterSpace.includes(ev.space)) return false;
    if (filterVenue !== "All" && ev.venue !== filterVenue) return false;
    return true;
  }), [events, filterCat, filterFn, filterSpace, filterVenue, getFullCost]);

  const totalCost = useCallback(() => {
    let c = 0;
    const zones = activeZones.length > 0 ? activeZones : Object.entries(zoneConfig).filter(([zk, cfg]) => enabledEls[zk] && cfg).map(([zk, cfg]) => ({ id: zk, type: zk, name: zk, config: cfg }));
    zones.forEach(z => { c += calcStructCost(z.type, z.config).total; });
    Object.entries(zoneElements).forEach(([zk, elems]) => {
      if (!enabledEls[zk] || !elems) return;
      c += calcElsCost(elems, true, zoneConfig[zk]);
    });
    const grades = itemGrades || {};
    Object.entries(itemQty || {}).forEach(([itemId, qty]) => {
      if (!qty) return;
      // old catalogue items fully removed — element card pricing only
    });
    const fnIdx = activeFnIdx || 0;
    dcCustomItems.filter(ci => ci.fnIdx === fnIdx).forEach(ci => {
      c += (ci.manualPrice || ci.refPrice || 0) * (Number(ci.qty) || 1);
    });
    return c;
  }, [venue, enabledEls, itemQty, itemGrades, activeZones, zoneConfig, zoneElements, calcElsCost, dcCustomItems, activeFnIdx]);

  const transportCalc = useMemo(() => {
    if (!venue) return { trucks: 0, tripRate: 0, total: 0, isNew: true, tier: "new", tierLabel: "", breakdown: [], floralTrucks: 0, bufferTrucks: 0, itemTrucks: 0 };
    const match = trVenues.find(v => v.name.toLowerCase() === venue.toLowerCase());
    const isNew = !match;
    const tripRate = match ? match.rate : customTripRate;
    const tierId = match ? match.tier : "new";
    const tierLabel = match ? (TR_TIERS.find(t => t.id === match.tier)?.label || match.tier) : "New venue";
    const breakdown = [];
    const { itemTrucks, breakdown: itemBd } = computeTruckItems(zoneElements, zoneConfig, enabledEls, rcItems, truckCap);
    itemBd.forEach(b => breakdown.push(b));
    const floralTrucks = 0, totalFloralCost = 0; // florals now counted via their sub-category capacity — no separate flower truck
    const decor = totalCost();
    const bt = bufferTiers.find(b => decor >= b.minBudget && decor < b.maxBudget);
    const bufTrucks = bt ? bt.bufferTrucks : 0;
    if (bufTrucks > 0) breakdown.push({ label: "Buffer", qty: 0, perTruck: 0, unit: "", trucks: bufTrucks, isBuffer: true, tierLabel: bt?.label || "" });
    const allTrucks = itemTrucks + floralTrucks + bufTrucks;
    const venueGensets = match ? (match.gensets || 1) : 1;
    const gensets = customGensets !== null ? customGensets : venueGensets;
    const gensetCost = gensets * gensetRate;
    const truckTotal = allTrucks * tripRate * 2;
    const total = truckTotal + gensetCost;
    return { trucks: allTrucks, tripRate, total, isNew, tier: tierId, tierLabel, breakdown, floralTrucks, bufferTrucks: bufTrucks, itemTrucks, totalFloralCost, gensets, venueGensets, gensetCost, gensetRate, truckTotal };
  }, [venue, customTripRate, customGensets, gensetRate, trVenues, zoneElements, enabledEls, rcItems, truckCap, floralPerTruck, bufferTiers, totalCost, zoneConfig]);

  const grandTotal = useMemo(() => totalCost() + transportCalc.total, [totalCost, transportCalc]);

  const collectAllFunctionData = useCallback(() => {
    const all = [];
    const totalFns = 1 + (extraFunctions || []).length;
    for (let idx = 0; idx < totalFns; idx++) {
      const meta = idx === 0
        ? { type: fn || "", date: clientDate || "", venue: venue || "", shift: clientShift || "", pax: clientPax || "", palette: clientPalette || "Custom" }
        : (() => { const ef = extraFunctions[idx - 1] || {}; return { type: ef.type || "", date: ef.date || "", venue: ef.venue || "", shift: ef.shift || "", pax: ef.pax || "", palette: ef.palette || "Custom" }; })();
      const isActive = idx === activeFnIdx;
      const snap = isActive
        ? { zoneElements, zoneConfig, enabledEls, elSelectedPhoto, itemQty, itemGrades, activeZones, customZones, elTiers, floralRatio, customGensets, customTripRate, elNotes, floralOverrides }
        : (fnBuilds[idx] || {});
      all.push({
        fnIdx: idx,
        fnType: meta.type,
        fnDate: meta.date,
        fnVenue: meta.venue,
        fnShift: meta.shift,
        fnPax: meta.pax,
        fnPalette: meta.palette,
        zoneElements: snap.zoneElements || {},
        zoneConfig: snap.zoneConfig || {},
        enabledEls: snap.enabledEls || {},
        elSelectedPhoto: snap.elSelectedPhoto || {},
        itemQty: snap.itemQty || {},
        itemGrades: snap.itemGrades || {},
        activeZones: snap.activeZones || [],
        customZones: snap.customZones || [],
        elTiers: snap.elTiers || {},
        floralRatio: typeof snap.floralRatio === "number" ? snap.floralRatio : floralRatio,
        customGensets: typeof snap.customGensets === "number" ? snap.customGensets : null,
        customTripRate: typeof snap.customTripRate === "number" ? snap.customTripRate : 0,
        elNotes: snap.elNotes || {},
        floralOverrides: snap.floralOverrides && typeof snap.floralOverrides === "object"
          ? { note: snap.floralOverrides.note || "", rows: Array.isArray(snap.floralOverrides.rows) ? snap.floralOverrides.rows : [] }
          : { note: "", rows: [] },
      });
    }
    return all;
  }, [fn, clientDate, venue, clientShift, clientPax, clientPalette, zoneElements, zoneConfig, enabledEls, elSelectedPhoto, itemQty, itemGrades, activeZones, customZones, elTiers, floralRatio, customGensets, customTripRate, elNotes, floralOverrides, extraFunctions, fnBuilds, activeFnIdx]);

  const calcFunctionCost = useCallback((fnData) => {
    if (!fnData) return { decor: 0, transport: 0, grand: 0 };
    const fZoneElements = fnData.zoneElements || {};
    const fZoneConfig = fnData.zoneConfig || {};
    const fEnabledEls = fnData.enabledEls || {};
    const fActiveZones = fnData.activeZones || [];
    const fItemQty = fnData.itemQty || {};
    const fItemGrades = fnData.itemGrades || {};
    const fVenue = fnData.fnVenue || "";
    const fFloralRatio = typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70;
    let decor = 0;
    const zones = fActiveZones.length > 0 ? fActiveZones : Object.entries(fZoneConfig).filter(([zk, cfg]) => fEnabledEls[zk] && cfg).map(([zk, cfg]) => ({ id: zk, type: zk, name: zk, config: cfg }));
    zones.forEach(z => { decor += calcStructCost(z.type, z.config).total; });
    Object.entries(fZoneElements).forEach(([zk, elems]) => {
      if (!fEnabledEls[zk] || !elems) return;
      decor += calcElsCostForFn(elems, fZoneConfig[zk], fFloralRatio);
    });
    const grades = fItemGrades || {};
    Object.entries(fItemQty || {}).forEach(([itemId, qty]) => {
      if (!qty) return;
      const it = ITEMS.find(x => x.id === itemId);
      if (!it) return;
      const grade = grades[itemId] || "P";
      const unit = it[grade === "P" ? "premium" : grade === "E" ? "elegant" : "simple"] || it.premium || 0;
      decor += qty * unit;
    });
    dcCustomItems.filter(ci => ci.fnIdx === fnData.fnIdx).forEach(ci => {
      decor += (ci.manualPrice || ci.refPrice || 0) * (Number(ci.qty) || 1);
    });
    let transport = 0;
    if (fVenue && decor > 0) {
      const match = trVenues.find(v => v.name.toLowerCase() === fVenue.toLowerCase());
      const fCustomTripRate = typeof fnData.customTripRate === "number" ? fnData.customTripRate : 0;
      const fCustomGensets = typeof fnData.customGensets === "number" ? fnData.customGensets : null;
      const tripRate = match ? match.rate : fCustomTripRate;
      const capBySub = {}; (truckCap || []).forEach(tc => { if ((Number(tc.perTruck) || 0) > 0) capBySub[String(tc.item || "").toLowerCase().trim()] = tc; });
      const subAgg = {};
      const addSub = (sub, qty) => { const k = String(sub || "").toLowerCase().trim(); const tc = capBySub[k]; if (!tc || !(qty > 0)) return; if (!subAgg[k]) subAgg[k] = { perTruck: Number(tc.perTruck) || 0, qty: 0 }; subAgg[k].qty += qty; };
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
          if (!rc) return;
          const tc = capBySub[String(rc.sub || "").toLowerCase().trim()]; if (!tc) return;
          if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(rc.sub, L * W * (Number(el.qty) || 1)); }
          else addSub(rc.sub, Number(el.qty) || 0);
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {};
        const fd = cfg.floorDims || d;
        if (cfg.trT === "box") { const tSqft = (d.L || 0) * (d.W || 0) * Math.max(1, cfg.trussQty || 1); if (tSqft > 0) addSub("Truss", tSqft); }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) { if (cfg.plH) addSub("Platform", sqft); if (cfg.cpT) addSub("Carpet", sqft); }
      });
      let truckFrac = 0; Object.values(subAgg).forEach(s => { if (s.perTruck > 0) truckFrac += (s.qty || 0) / s.perTruck; });
      const itemTrucks = Math.ceil(truckFrac);
      const floralTrucks = 0; // florals counted via their sub-category capacity — no separate flower truck
      const bt = bufferTiers.find(b => decor >= b.minBudget && decor < b.maxBudget);
      const bufTrucks = bt ? bt.bufferTrucks : 0;
      const allTrucks = itemTrucks + floralTrucks + bufTrucks;
      const truckTotal = allTrucks * tripRate * 2;
      const venueGensets = match ? (match.gensets || 1) : 1;
      const gensets = fCustomGensets !== null ? fCustomGensets : venueGensets;
      const gensetCost = gensets * gensetRate;
      transport = truckTotal + gensetCost;
    }
    return { decor, transport, grand: decor + transport };
  }, [calcElsCostForFn, rcItems, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, dcCustomItems]);

  const calcFnFloralSourcingCost = useCallback((fn) => {
    const fp = dealCheckData?.flowerPatterns || [];
    const mc = dealCheckData?.mandiCatalogue || [];
    const mults = dealCheckData?.mandiPriceMultipliers || {};
    const sMap = dealCheckData?.seasonMap || {};
    const artFlowerRate = Number(dealCheckData?.artificialFlowerRatePerKg ?? 50);
    const artFlowerBPK = Number(dealCheckData?.artificialFlowerBunchesPerKg ?? 16) || 16;
    const artGreenRate = Number(dealCheckData?.artificialGreenRatePerKg ?? 40);
    const artGreenBPK = Number(dealCheckData?.artificialGreenBunchesPerKg ?? 23) || 23;
    const fnRatio = typeof fn?.floralRatio === "number" ? fn.floralRatio : (typeof floralRatio === "number" ? floralRatio : 70);
    const szMap = (m, s) => { if (m === "smb") { const u = (s || "M").toUpperCase(); return u === "S" ? "small" : u === "B" ? "big" : "medium"; } return "medium"; };
    const resRP = (el, rc) => {
      if (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) return el.realPct;
      const m = String(rc?.floralMode || "").toLowerCase();
      if (m === "real") return 100; if (m === "artificial") return 0;
      if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
      return Math.max(0, Math.min(100, 100 - fnRatio));
    };
    let tReal = 0, tArt = 0, realIncome = 0, artIncome = 0, artFlowerBunches = 0, artGreenBunches = 0;
    const fbreak = {}; // flowerName → { name, qty, cost } (mandi shopping breakdown, real flowers)
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (!fn.enabledEls?.[zk]) return;
      (elems || []).forEach(el => {
        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
        if (!rc || String(rc.cat || "").toLowerCase() !== "florals") return;
        const q = el.qty || 0; if (q <= 0) return;
        const rp = resRP(el, rc) / 100, ap = 1 - rp;
        // Billed income split — EVERY floral arrangement bills (recipe-driven or not): the real
        // portion at the inhouse rate, the artificial portion at the artificial rate (mirrors
        // getElPrice's blend). Computed at element level, before the recipe gate below.
        { const szU = String(el.size || "").toUpperCase(); let rr, ar;
          if (rcIsSMB(rc)) {
            if (szU === "S" || szU === "SMALL") { rr = rc.inhouseS || 0; ar = rc.artificialS || 0; }
            else if (szU === "B" || szU === "BIG" || szU === "LARGE" || szU === "PREMIUM" || szU === "HEAVY") { rr = rc.inhouseB || 0; ar = rc.artificialB || 0; }
            else { rr = rc.inhouseM || 0; ar = rc.artificialM || 0; }
          } else { rr = rc.inhouseFlat || 0; ar = rc.artificialFlat || 0; }
          realIncome += q * rp * rr; artIncome += q * ap * ar; }
        const tn = (rc.name || "").toLowerCase().trim();
        let pat = fp.find(p => (p.name || "").toLowerCase().trim() === tn);
        if (!pat) pat = fp.find(p => { const n = (p.name || "").toLowerCase().trim(); return n && (n.includes(tn) || tn.includes(n)); });
        if (!pat) return;
        const sk = szMap(rc.inhouseMode, el.size);
        const sizes = pat.sizes || {};
        let comp = sizes[sk] || sizes.medium;
        if (!comp && sk === "big" && sizes.large) comp = sizes.large;
        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
        if (!comp || !Array.isArray(comp.flowers)) return;
        // Fixed extra cost (pot/base) per unit — a real cost regardless of real/artificial split.
        { const ex = (Number(comp.extraCost) || 0) * q; if (ex > 0) { tReal += ex; realIncome += ex; } }
        const season = sMap[fn.fnDate] || "non_saya";
        const sMult = mults[season] || 1;
        comp.flowers.forEach(fl => {
          const resolved = resolveMandiFlower(fl.flowerId, mc);
          const parent = resolved?.parent || null;
          const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          const effR = ft === "real_only" ? 1 : rp;
          const effA = ft === "real_only" ? 0 : ap;
          const bp = (parent?.currentPrice || 0) * sMult;
          const realUnits = (fl.qty || 0) * q * effR;
          const realCost = realUnits * bp;
          tReal += realCost;
          if (realUnits > 0 && parent) { const nm = parent.name || "Flower"; if (!fbreak[nm]) fbreak[nm] = { name: nm, qty: 0, cost: 0, unit: parent.unit || "" }; fbreak[nm].qty += realUnits; fbreak[nm].cost += realCost; }
          if (effA > 0) {
            const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
            const bunches = (fl.qty || 0) * q * effA * bpu;
            const isG = ft === "green";
            if (isG) artGreenBunches += bunches; else artFlowerBunches += bunches;
            tArt += bunches * (isG ? artGreenRate / artGreenBPK : artFlowerRate / artFlowerBPK);
          }
        });
      });
    });
    return { totalReal: tReal, totalArtificial: tArt, grandTotal: tReal + tArt, breakdown: Object.values(fbreak).map(f => ({ ...f, qty: Math.ceil(f.qty), cost: Math.round(f.cost) })).sort((a, b) => b.cost - a.cost), artFlowerBunches, artGreenBunches, income: { real: realIncome, art: artIncome } };
  }, [dealCheckData, rcItems, floralRatio]);

  // Crew counts per manpower type for the whole booking, WITH a plain-English "basis" so the dept
  // head sees how the system derived each number (e.g. "6 = 12 arrangements ÷ 2 per flowerist").
  // Peak count across functions (= people to book). Mirrors the Deal Check manpower rules.
  const manpowerPlanForBooking = useCallback((allFns) => {
    const d = dealCheckData || {};
    const dihari = d.dihariSchemes || {};
    const labourTiers = d.labourTiers || {};
    const venueMinLabour = d.venueMinLabour || {};
    const defaultMinLabour = d.defaultMinLabour || 4;
    const eventTypeMultipliers = d.eventTypeMultipliers || { outdoor_budgeted: 1 };
    const eventTimingMultipliers = d.eventTimingMultipliers || {};
    const sayaMultiplier = d.sayaMultiplier || 1.3;
    const heavyElementRanges = d.heavyElementRanges || [];
    const fabricBangaliRanges = d.fabricBangaliRanges || [];
    const trussLabourRanges = d.trussLabourRanges || [];
    const fps = d.flowerPatterns || [];
    const elecProd = d.electricianProductivity || {};
    const seasonMap = d.seasonMap || {};
    const recipeSubs = (d.flowerRecipeSubcats || ["Flower Pattern"]).map(s => String(s || "").toLowerCase().trim());
    const types = Object.keys(dihari);
    if (!types.length || !(allFns || []).length) return [];
    const sizeFromMode = (mode, sz) => (mode === "flat" || !sz) ? "medium" : (String(sz).toLowerCase() || "medium");
    const shiftToTiming = (s) => { const sl = String(s || "").toLowerCase(); if (sl.includes("morning")) return "morning"; if (sl.includes("evening") || sl.includes("night")) return "evening"; return "day"; };
    const walk = (fn, cb) => { const en = fn.enabledEls || {}; const ze = fn.zoneElements || {}; Object.keys(en).forEach(zk => { if (!en[zk]) return; (ze[zk] || []).forEach(el => { const rc = rcItems.find(r => String(r.name || "").toLowerCase() === String(el.name || "").toLowerCase()); if (rc) cb({ rc, el, qty: Number(el.qty || el.count || 1) }); }); }); };
    const calc = (fn, type) => {
      if (type === "Flowerists") {
        let t = 0; const agg = {}; walk(fn, ({ rc, el, qty }) => {
          if (String(rc.cat || "").toLowerCase() !== "florals") return;
          // Exact pattern-name match counts on its own (a recipe with productivity is included even if its
          // sub-cat isn't in flowerRecipeSubcats); loose name matching stays gated to those subs.
          const rn = String(rc.name || "").toLowerCase().trim();
          const inRS = recipeSubs.includes(String(rc.sub || "").toLowerCase().trim());
          let pat = fps.find(p => String(p?.name || "").toLowerCase().trim() === rn);
          if (!pat && inRS) pat = fps.find(p => { const n = String(p?.name || "").toLowerCase().trim(); return n && rn && (n.includes(rn) || rn.includes(n)); });
          if (!pat) return; const sk = sizeFromMode(rc.inhouseMode, el.size); let c = pat.sizes?.[sk] || pat.sizes?.medium; if (!c && sk === "big" && pat.sizes?.large) c = pat.sizes.large;
          const upf = Number(c?.unitsPerFlowerist || 0); if (upf > 0) { const k = (rc.name || "flower") + "|" + upf; if (!agg[k]) agg[k] = { sub: rc.name || "flower", batch: upf, count: 0 }; agg[k].count += qty; }
        });
        const rows = Object.values(agg).map(r => ({ ...r, need: r.count / r.batch }));
        rows.forEach(r => { t += Math.ceil(r.need); });
        return { count: t, basis: rows.length ? "arrangements ÷ units-per-flowerist (per recipe)" : "no recipe-driven florals", trace: rows.length ? { kind: "tier2", perRow: true, rows, need: rows.reduce((s, r) => s + r.need, 0), min: 0, result: t, countLabel: "arrangements", batchLabel: "÷per flowerist" } : null };
      }
      if (type === "Electricians") {
        let t = 0, n = 0; walk(fn, ({ rc, el, qty }) => { if (String(rc.cat || "").toLowerCase() !== "lighting") return; const pr = elecProd[rc.sub || ""]; if (!pr) return; const sk = sizeFromMode(rc.inhouseMode, el.size); const upe = Number(pr.sizes?.[sk]) || Number(pr.sizes?.medium) || 0; if (upe > 0) { t += Math.ceil(qty / upe); n += qty; } });
        return { count: t, basis: t > 0 ? `${n} lighting unit(s) ÷ productivity` : "no lighting", trace: t > 0 ? { kind: "ratio", num: n, numLabel: "lighting units", denomLabel: "productivity per electrician", result: t } : null };
      }
      if (type === "Labours") {
        const vc = venueMinLabour[fn.fnVenue || ""]; const vm = (vc && typeof vc === "object" ? vc.min : (typeof vc === "number" ? vc : null)) || defaultMinLabour;
        const em = eventTypeMultipliers["outdoor_budgeted"] || 1; const base = Math.ceil(vm * em);
        const ss = seasonMap[fn.fnDate || ""]; const cand = [1.0]; if (ss === "kings") cand.push(sayaMultiplier); cand.push(eventTimingMultFor(eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0)); const sm = Math.max(...cand, 1.0);
        const adj = Math.ceil(base * sm); const sc = {}; walk(fn, ({ rc, qty }) => { sc[rc.sub || ""] = (sc[rc.sub || ""] || 0) + qty; });
        let he = 0; heavyElementRanges.forEach(her => { he += heavyExtraLabour(her, sc[her.subCat] || 0); });
        return { count: adj + he, basis: `venue min ${vm}${sm > 1 ? ` ×${sm.toFixed(2)} season/timing` : ""}${he ? ` + ${he} heavy-element` : ""}`, trace: { kind: "labours", venueMin: vm, mult: sm, heavy: he, result: adj + he } };
      }
      if (type === "Fabric Bangali") {
        let sq = 0; walk(fn, ({ rc, el }) => { const s = String(rc.sub || "").toLowerCase(); if (s.includes("wall masking") || s.includes("fabric") || s.includes("draping")) { const L = Number(el.L || el.l || 0); const W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) sq += L * W; } });
        if (sq <= 0 || !fabricBangaliRanges.length) return { count: 0, basis: "no fabric sqft" };
        let lab = fabricBangaliRanges[fabricBangaliRanges.length - 1]?.labour || 0; for (const r of fabricBangaliRanges) { if (sq <= r.upTo) { lab = r.labour || 0; break; } }
        return { count: lab, basis: `${Math.round(sq)} sqft fabric → range`, trace: { kind: "range", value: Math.round(sq), unit: "sqft", result: lab } };
      }
      if (type === "Truss Labour") {
        let recipeP = 0; walk(fn, ({ rc, qty }) => { const s = String(rc.sub || "").toLowerCase(); if (s.includes("pillar") || s.includes("column") || s.includes("truss")) recipeP += qty; });
        let zoneP = 0; try { const tInv = d.trussInv; if (tInv) { const zc = fn.zoneConfig || {}, en = fn.enabledEls || {}; Object.keys(zc).forEach(zk => { if (!en[zk] || !zc[zk]) return; const pv = calcZoneTrussPreview(zc[zk], tInv); zoneP += (pv?.topology?.pillars || []).length; }); } } catch {}
        const p = recipeP + zoneP;
        if (p <= 0 || !trussLabourRanges.length) return { count: 0, basis: "no truss/pillars" };
        let lab = trussLabourRanges[trussLabourRanges.length - 1]?.labour || 0; for (const r of trussLabourRanges) { if (p <= r.upTo) { lab = r.labour || 0; break; } }
        return { count: lab, basis: `${p} pillar(s)${zoneP ? ` (${zoneP} from truss tool${recipeP ? ` + ${recipeP} build` : ""})` : ""} → range`, trace: { kind: "pillars", recipeP, zoneP, total: p, result: lab } };
      }
      const cfg = labourTiers[type];
      if (cfg && cfg.tier === 2) {
        const batches = cfg.subCatBatches || {}; const sc = {};
        walk(fn, ({ rc, qty }) => { if (batches[rc.sub || ""]) sc[rc.sub || ""] = (sc[rc.sub || ""] || 0) + qty; });
        const rows = Object.entries(sc).map(([k, v]) => ({ sub: k, count: v, batch: batches[k] || 3, need: v / (batches[k] || 3) }));
        const need = rows.reduce((s, r) => s + r.need, 0);
        const count = Math.max(cfg.minimum || 1, Math.ceil(need));
        return { count, basis: `⌈Σ(count÷batch)⌉ = ${count} (min ${cfg.minimum || 1})`, trace: { kind: "tier2", rows, need, min: cfg.minimum || 1, result: count } };
      }
      if (type === "Supervisors") return { count: 1, basis: "1 per booking", trace: { kind: "fixed", note: "1 supervisor per booking", result: 1 } };
      return { count: 0, basis: "" };
    };
    return types.map(type => {
      let best = { count: 0, basis: "", trace: null };
      (allFns || []).forEach(fn => { const r = calc(fn, type); if (r.count > best.count) best = r; });
      return { type, count: best.count, basis: best.basis, rate: Number(dihari[type]?.rate) || 0, trace: best.trace || null };
    }).filter(r => r.count > 0);
  }, [dealCheckData, rcItems]);

  const eventGrandTotal = useMemo(() => {
    const all = collectAllFunctionData();
    return all.reduce((sum, fnData) => sum + calcFunctionCost(fnData).grand, 0);
  }, [collectAllFunctionData, calcFunctionCost]);

  const calcFunctionBreakdown = useCallback((fnData) => {
    if (!fnData) return { zones: [], transport: null, decorTotal: 0, transportTotal: 0, grand: 0 };
    const fZoneElements = fnData.zoneElements || {};
    const fZoneConfig = fnData.zoneConfig || {};
    const fEnabledEls = fnData.enabledEls || {};
    const fElSelectedPhoto = fnData.elSelectedPhoto || {};
    const fCustomZones = fnData.customZones || [];
    const fElTiers = fnData.elTiers || {};
    const fVenue = fnData.fnVenue || "";
    const fFloralRatio = typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70;
    const zones = Object.entries(fEnabledEls).filter(([_, on]) => on).map(([k]) => {
      const el = zoneLabelsD[k] || fCustomZones.find(cz => cz.id === k) || { label: k, icon: "📦" };
      const t = fElTiers[k] || "simple";
      const ze = fZoneElements[k];
      let ic = 0, itemCount = 0;
      if (ze && ze.length > 0) {
        (ze || []).forEach(el2 => {
          const priceInfo = getElPriceForFn(el2, fZoneConfig[k], fFloralRatio);
          if (!priceInfo.rc) return;
          ic += priceInfo.lineCost;
          itemCount += (el2.qty || 0);
        });
      }
      const zl = fZoneConfig[k] ? calcStructCost(k, fZoneConfig[k]) : { truss: 0, masking: 0, platform: 0, carpet: 0, total: 0 };
      const customCost = dcCustomItems
        .filter(c => c.fnIdx === fnData.fnIdx && c.zoneKey === k)
        .reduce((s, c) => s + (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1), 0);
      return { k, label: el.label, icon: el.icon, tier: t, ic, zl, customCost, tot: ic + zl.total + customCost, itemCount,
        note: "", selPh: fElSelectedPhoto[k] || null, zc: fZoneConfig[k] || null,
        useElementCard: !!ze, elems: ze || [] };
    });
    let transport = null;
    let transportTotal = 0;
    let decorTotal = 0;
    zones.forEach(z => { decorTotal += z.tot; });
    if (fVenue && decorTotal > 0) {
      const match = trVenues.find(v => v.name.toLowerCase() === fVenue.toLowerCase());
      const isNew = !match;
      const fCustomTripRate = typeof fnData.customTripRate === "number" ? fnData.customTripRate : 0;
      const fCustomGensets = typeof fnData.customGensets === "number" ? fnData.customGensets : null;
      const tripRate = match ? match.rate : fCustomTripRate;
      const tierId = match ? match.tier : "new";
      const tierLabel = match ? (TR_TIERS.find(t => t.id === match.tier)?.label || match.tier) : "New venue";
      const breakdown = [];
      const capBySub = {}; (truckCap || []).forEach(tc => { if ((Number(tc.perTruck) || 0) > 0) capBySub[String(tc.item || "").toLowerCase().trim()] = tc; });
      const subAgg = {}; const totalFloralCost = 0;
      const addSub = (sub, qty) => { const k = String(sub || "").toLowerCase().trim(); const tc = capBySub[k]; if (!tc || !(qty > 0)) return; if (!subAgg[k]) subAgg[k] = { label: tc.item, perTruck: Number(tc.perTruck) || 0, unit: tc.unit || "pc", qty: 0 }; subAgg[k].qty += qty; };
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
          if (!rc) return;
          const tc = capBySub[String(rc.sub || "").toLowerCase().trim()]; if (!tc) return;
          if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(rc.sub, L * W * (Number(el.qty) || 1)); }
          else addSub(rc.sub, Number(el.qty) || 0);
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {}; const fd = cfg.floorDims || d;
        if (cfg.trT === "box") { const tSqft = (d.L || 0) * (d.W || 0) * Math.max(1, cfg.trussQty || 1); if (tSqft > 0) addSub("Truss", tSqft); }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) { if (cfg.plH) addSub("Platform", sqft); if (cfg.cpT) addSub("Carpet", sqft); }
      });
      let truckFrac = 0;
      Object.values(subAgg).forEach(s => { if (s.perTruck > 0) { truckFrac += (s.qty || 0) / s.perTruck; breakdown.push({ label: s.label, qty: Math.round(s.qty), perTruck: s.perTruck, unit: s.unit, trucks: (s.qty || 0) / s.perTruck }); } });
      const itemTrucks = Math.ceil(truckFrac);
      const floralTrucks = 0; // florals counted via their sub-category capacity — no separate flower truck
      const bt = bufferTiers.find(b => decorTotal >= b.minBudget && decorTotal < b.maxBudget);
      const bufTrucks = bt ? bt.bufferTrucks : 0;
      if (bufTrucks > 0) breakdown.push({ label: "Buffer", qty: 0, perTruck: 0, unit: "", trucks: bufTrucks, isBuffer: true, tierLabel: bt?.label || "" });
      const allTrucks = itemTrucks + floralTrucks + bufTrucks;
      const venueGensets = match ? (match.gensets || 1) : 1;
      const gensets = fCustomGensets !== null ? fCustomGensets : venueGensets;
      const gensetCost = gensets * gensetRate;
      const truckTotal = allTrucks * tripRate * 2;
      transportTotal = truckTotal + gensetCost;
      transport = { trucks: allTrucks, tripRate, total: transportTotal, isNew, tier: tierId, tierLabel,
        breakdown, floralTrucks, bufferTrucks: bufTrucks, itemTrucks, totalFloralCost,
        gensets, venueGensets, gensetCost, gensetRate, truckTotal };
    }
    return { zones, transport, decorTotal, transportTotal, grand: decorTotal + transportTotal };
  }, [getElPriceForFn, rcItems, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, zoneLabelsD, dcCustomItems]);

  const cat = getCat(grandTotal);

  // ═══════════════════════════════════════════════════════════════
  // DERIVED MEMOS + HANDLERS — VERBATIM from the reference (wired to
  // StudioApp state). Ports include transitive deps (loadEvent → pickAndLoad
  // → pickAndLoadFromVideo; saveSession → markSold; buildZonesForFn →
  // buildCombinedCostSheetData).
  // ═══════════════════════════════════════════════════════════════

  // ── Activity logger (notifications) — reduced port (no serverless) ──
  const logActivity = useCallback(async (action, detail) => {
    const entry = { id: Date.now(), user: authUser?.name || "System", userId: authUser?.id || "system", action, detail, ts: Date.now() };
    const updated = [entry, ...notifications].slice(0, 200);
    setNotifications(updated);
    reliableSave(NOTIF_SK, JSON.stringify(updated), "Activity").catch(() => {});
  }, [authUser, notifications]);

  // ── Transport save (used by autoPersistCustomVenue) — VERBATIM (kv shim) ──
  const saveTR = useCallback(async (nv, ntc, nfpt, nbt, ngr) => {
    const sv = nv || trVenues; const st = ntc || truckCap; const sf = nfpt !== undefined ? nfpt : floralPerTruck; const sb = nbt || bufferTiers; const sgr = ngr !== undefined ? ngr : gensetRate;
    if (nv) setTrVenues(nv); if (ntc) setTruckCap(ntc); if (nfpt !== undefined) setFloralPerTruck(nfpt); if (nbt) setBufferTiers(nbt); if (ngr !== undefined) setGensetRate(ngr);
    const local = { venues: sv, truckCap: st, floralPerTruck: sf, bufferTiers: sb, gensetRate: sgr };
    await reliableSave(RC_SK_TR, JSON.stringify(local), "Transport");
  }, [trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate]);

  // ── Library photo scoring for a zone ──
  // Async: fetches its zone-tagged candidate pool from the server (`tags->areasElements` overlap)
  // instead of scanning the whole in-memory library — callers must await/`.then()` this now.
  const getLibPhotosForZone = useCallback(async (zone, videoTag, filterFn) => {
    // `zone` may be a single tag name (Manage Library) or an array of synonym names (Build page).
    // filterFn (optional): a predicate applied to the zone matches BEFORE scoring/capping — so active
    // photo filters (event type, palette, etc.) constrain the pool first and matching photos aren't
    // lost to the 50-cap by higher-scoring but filtered-out photos.
    const zoneList = (Array.isArray(zone) ? zone : [zone]).filter(Boolean);
    if (!zoneList.length) return { exact: [], similar: [], fallback: [] };
    const zoneCandidates = await fetchZoneLibraryPhotos(zoneList);
    mergeLibItems(zoneCandidates);
    const tier = videoTag?.tier;
    const libTier = tier === "Silver" ? "Simple" : tier === "Gold" ? "Enhanced" : null;
    // Resolve the active palette (per function) → its anchor colours + the ★ primary.
    // When a palette is chosen its colours drive matching (the Build screen has no video
    // colours otherwise); a photo whose colours include the PRIMARY ranks above one that
    // matches only a secondary anchor, which falls into the queue below.
    const activePaletteName = activeFnIdx === 0 ? clientPalette : (extraFunctions[activeFnIdx - 1]?.palette || "");
    const activePalette = (imsPaletteCatalogue || []).find(p => p.name === activePaletteName);
    const paletteColors = activePalette ? (activePalette.anchorColours || []) : [];
    // A palette can have MULTIPLE primary colours; a photo carrying ANY of them is a
    // full (primary) match. (Legacy single `primaryColour` still read.)
    const primaryColors = activePalette
      ? (Array.isArray(activePalette.primaryColours) ? activePalette.primaryColours : (activePalette.primaryColour ? [activePalette.primaryColour] : []))
      : [];
    const colors = paletteColors.length ? paletteColors : (videoTag?.colors || []);
    const styles = videoTag?.styles || [];
    const fns = Array.isArray(videoTag?.fn) ? videoTag.fn : (videoTag?.fn ? [videoTag.fn] : []);
    const io = videoTag?.io || "";
    const zoneMatches = zoneCandidates.filter(li => {
      const ae = li.tags?.areasElements || [];
      return zoneList.some(z => ae.includes(z)) && (!filterFn || filterFn(li));
    });
    const scorePhoto = (li) => {
      let score = 0;
      const liTier = li.tags?.categoryTier || [];
      const liColor = li.tags?.colorPalette || [];
      const liStyle = li.tags?.designStyle || [];
      const liFn = li.tags?.eventType || [];
      const liIO = li.tags?.venueType || [];
      // §Palette-first — when an active palette context exists (e.g. arrived via an Ivory-tagged
      // video / client palette set), photos carrying a palette colour LEAD their zone regardless
      // of where "color" sits in the settings priority; the priority score below is the tiebreaker.
      if (colors.length) {
        if (primaryColors.length && primaryColors.some(pc => liColor.includes(pc))) score += 1000;
        else if (colors.some(c => liColor.includes(c))) score += 500;
      }
      filterPriority.forEach((p, idx) => {
        const weight = (filterPriority.length - idx) * 10;
        switch (p.id) {
          case "tier": if (libTier && liTier.includes(libTier)) score += weight; break;
          case "style": if (styles.length && styles.some(s => liStyle.includes(s))) score += weight; break;
          case "color":
            if (colors.length) {
              if (primaryColors.length) {
                // Designated ★ primaries: full weight when the photo carries ANY primary
                // colour; a secondary-anchor-only match gets a small weight so those
                // photos queue below the primary-colour ones.
                if (primaryColors.some(pc => liColor.includes(pc))) score += weight;
                else if (colors.some(c => liColor.includes(c))) score += Math.round(weight * 0.2);
              } else if (colors.some(c => liColor.includes(c))) {
                score += weight;
              }
            }
            break;
          case "fn": if (fns.length && fns.some(f => liFn.includes(f))) score += weight; break;
          case "io": if (io && liIO.includes(io)) score += weight; break;
        }
      });
      return score;
    };
    const scored = zoneMatches.map(li => ({ li, score: scorePhoto(li) })).sort((a, b) => b.score - a.score);
    const exact = scored.filter(s => s.score >= 40).map(s => s.li).slice(0, 50);
    const similar = scored.filter(s => s.score >= 10 && s.score < 40).map(s => s.li).slice(0, 50 - exact.length);
    const fallback = scored.filter(s => s.score < 10).map(s => s.li).slice(0, 50 - exact.length - similar.length);
    const total = exact.length + similar.length + fallback.length;
    let overflow = [];
    if (total < 50) {
      const usedIds = new Set([...exact, ...similar, ...fallback].map(li => li.id));
      // "Rest" (non-zone fillers) — a bounded recently-tagged pool instead of the whole library,
      // still following the settings priority + palette-first ordering.
      const recentPool = await fetchRecentLibraryPhotos(200);
      mergeLibItems(recentPool);
      overflow = recentPool.filter(li => !usedIds.has(li.id) && (!filterFn || filterFn(li)))
        .map(li => ({ li, score: scorePhoto(li) }))
        .sort((a, b) => b.score - a.score)
        .map(s => s.li)
        .slice(0, 50 - total);
    }
    return { exact, similar, fallback: [...fallback, ...overflow] };
  }, [filterPriority, clientPalette, activeFnIdx, extraFunctions, imsPaletteCatalogue, mergeLibItems]);

  // ── All videos (youtube + manual), newest first — VERBATIM ──
  const allVideos = useMemo(() => {
    const yt = ytVideos.map(v => ({ ...v, source: "youtube", addedAt: v.addedAt || new Date(v.date || 0).getTime() }));
    const manual = manualVideos.map(v => ({ ...v, source: v.source || "cloudinary" }));
    const merged = [...yt, ...manual];
    merged.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return merged;
  }, [ytVideos, manualVideos]);

  const untaggedVideoCount = useMemo(() => allVideos.filter((v) => !hiddenVideos[v.id] && !ytVideoTags[v.id]).length, [allVideos, hiddenVideos, ytVideoTags]);

  // ── Venue memos — VERBATIM ── (declared early: the video/Cloudinary/aiTag helpers
  // below reference allInhouseVenues etc. in their deps, which evaluate during render.)
  const allInhouseVenues = useMemo(() => customInhouse.filter(v => v.parent && v.parent !== "Custom").map(v => v.name), [customInhouse]);
  const allVenueData = useMemo(() => {
    const merged = {};
    customInhouse.forEach(v => { merged[v.name] = { base: v.base || 0, label: v.label || "", type: v.type || "Outdoor" }; });
    return merged;
  }, [customInhouse]);
  const allInhouseGroups = useMemo(() => {
    const groups = [];
    customInhouse.forEach(v => {
      if (!v.parent || v.parent === "Custom") return;
      const parent = v.parent;
      let group = groups.find(g => g.parent === parent);
      if (!group) { group = { parent, manager: v.manager || "—", icon: v.icon || "🏢", subVenues: [], desc: v.desc || "" }; groups.push(group); }
      if (!group.subVenues.includes(v.name)) group.subVenues.push(v.name);
    });
    return groups;
  }, [customInhouse]);
  const allOutdoorDB = useMemo(() => customOutdoor.slice(), [customOutdoor]);

  // ═══ CLOUDINARY PHOTO BROWSER (reference ~4111) — rewired /api/cloudinary → cldAdmin ═══
  const fetchCldFolders = useCallback(async (path = "") => {
    setCldLoading(true);
    try {
      const data = await cldAdmin("folders", { path });
      if (data.error) { showMsg("CLD: " + data.error, "red"); setCldLoading(false); return; }
      setCldFolders(data.folders || []);
      setCldImages([]);
    } catch (e) { showMsg("Cloudinary fetch failed", "red"); }
    setCldLoading(false);
  }, []);

  const fetchCldImages = useCallback(async (prefix) => {
    setCldLoading(true);
    try {
      const data = await cldAdmin("list", { prefix, max_results: 200 });
      if (data.error) { showMsg("CLD: " + data.error, "red"); setCldLoading(false); return; }
      setCldImages(data.resources || []);
    } catch (e) { showMsg("Cloudinary fetch failed", "red"); }
    setCldLoading(false);
  }, []);

  const cldNavigate = useCallback((folderName) => {
    const newPath = [...cldPath, folderName];
    setCldPath(newPath);
    const fullPath = newPath.join("/");
    fetchCldFolders(fullPath);
    fetchCldImages(fullPath);
  }, [cldPath, fetchCldFolders, fetchCldImages]);

  const cldGoBack = useCallback((idx) => {
    const newPath = cldPath.slice(0, idx);
    setCldPath(newPath);
    const fullPath = newPath.join("/");
    fetchCldFolders(fullPath);
    if (newPath.length > 0) fetchCldImages(fullPath); else setCldImages([]);
  }, [cldPath, fetchCldFolders, fetchCldImages]);

  // ═══ CLOUDINARY DIRECT UPLOAD FROM LIBRARY (reference ~4155) — unsigned client upload ═══
  // Sanitize folder path for Cloudinary — & breaks uploads; #, ?, %, \ are URL-unsafe
  const sanitizeCloudinaryPath = (s) => s.replace(/&/g, "and").replace(/[#?%\\]/g, "_");
  // Fetch ALL existing display_names in a folder (paginated, case-insensitive)
  const fetchExistingNames = async (folder) => {
    const names = new Set();
    let cursor = "";
    for (let i = 0; i < 20; i++) { // hard cap 20 pages × 500 = 10k files
      const data = await cldAdmin("list", { prefix: folder, max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) });
      (data.resources || []).forEach(r => {
        const displayName = r.display_name || (r.public_id || "").split("/").pop();
        if (displayName) names.add(displayName.toLowerCase());
      });
      if (!data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return names;
  };
  const handleCldUpload = useCallback(async (files, isFolderUpload = false) => {
    if (!files || files.length === 0 || cldUploading) return;
    const baseFolder = cldPath.join("/");
    if (!baseFolder) { showMsg("Navigate into a folder first", "orange"); return; }
    // Filter: extension-based whitelist (reliable, unlike MIME which can mis-label RAW as image/*)
    const CLD_SUPPORTED = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?|avif|ico|svg)$/i;
    const CLD_UNSUPPORTED = /\.(cr2|cr3|nef|arw|raf|orf|rw2|dng|raw|srw|pef|rwl|x3f|3fr|mrw|erf|kdc)$/i;
    const allFiles = Array.from(files);
    const imageFiles = allFiles.filter(f => CLD_SUPPORTED.test(f.name));
    const unsupportedFiles = allFiles.filter(f => CLD_UNSUPPORTED.test(f.name));
    if (!imageFiles.length && !unsupportedFiles.length) { showMsg("No image files found", "orange"); return; }
    if (!imageFiles.length) {
      setCldUploadProgress(unsupportedFiles.map(f => ({ name: isFolderUpload ? (f.webkitRelativePath || f.name) : f.name, status: "unsupported" })));
      showMsg(`⚠ ${unsupportedFiles.length} unsupported (RAW formats — convert to JPG first)`, "orange");
      return;
    }
    setCldUploading(true);
    // Pre-compute sanitized target folder per file
    const fileTargets = imageFiles.map(file => {
      let targetFolder = baseFolder;
      if (isFolderUpload && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split("/");
        if (parts.length > 1) {
          // Trim each segment and drop empties — Mac Finder allows trailing/leading spaces in folder names,
          // but Cloudinary rejects them (causes 400 errors on any folder whose name has " /" or "/ ").
          const subPath = parts.slice(0, -1).map(p => p.trim()).filter(Boolean).join("/");
          if (subPath) targetFolder = baseFolder + "/" + subPath;
        }
      }
      return { file, targetFolder: sanitizeCloudinaryPath(targetFolder) };
    });
    const progress = imageFiles.map(f => ({ name: isFolderUpload ? (f.webkitRelativePath || f.name) : f.name, status: "checking" }));
    unsupportedFiles.forEach(f => progress.push({ name: isFolderUpload ? (f.webkitRelativePath || f.name) : f.name, status: "unsupported" }));
    setCldUploadProgress([...progress]);
    // Dedup pre-check: fetch existing display_names per unique target folder (parallel)
    const uniqueFolders = [...new Set(fileTargets.map(t => t.targetFolder))];
    const existingByFolder = {};
    await Promise.all(uniqueFolders.map(async folder => {
      try { existingByFolder[folder] = await fetchExistingNames(folder); }
      catch (e) { existingByFolder[folder] = new Set(); }
    }));
    let doneCount = 0, skippedCount = 0;
    const BATCH = 5;
    for (let start = 0; start < fileTargets.length; start += BATCH) {
      const batch = fileTargets.slice(start, start + BATCH);
      await Promise.all(batch.map(async ({ file, targetFolder }, bi) => {
        const idx = start + bi;
        // Dedup check — case-insensitive match on base filename (no extension)
        const baseName = file.name.replace(/\.[^.]+$/, "").toLowerCase();
        if ((existingByFolder[targetFolder] || new Set()).has(baseName)) {
          progress[idx] = { ...progress[idx], status: "skipped" };
          skippedCount++;
          setCldUploadProgress([...progress]);
          return;
        }
        try {
          // Compress
          const compressed = await compressImageForCloudinary(file);
          progress[idx].status = "uploading";
          setCldUploadProgress([...progress]);
          const fd = new FormData();
          fd.append("file", compressed);
          fd.append("upload_preset", IMS_CLD_PRESET);
          fd.append("folder", targetFolder);
          const res = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message);
          progress[idx] = { ...progress[idx], status: "done", url: data.secure_url };
          doneCount++;
        } catch (e) {
          progress[idx] = { ...progress[idx], status: "error" };
        }
        setCldUploadProgress([...progress]);
      }));
    }
    setCldUploading(false);
    const failedCount = imageFiles.length - doneCount - skippedCount;
    const parts = [];
    if (doneCount > 0) parts.push(`✓ ${doneCount} uploaded`);
    if (skippedCount > 0) parts.push(`⊘ ${skippedCount} skipped`);
    if (unsupportedFiles.length > 0) parts.push(`⚠ ${unsupportedFiles.length} unsupported`);
    if (failedCount > 0) parts.push(`✗ ${failedCount} failed`);
    showMsg(parts.join(", ") || "Nothing to upload", failedCount === 0 ? "green" : "orange");
    fetchCldImages(baseFolder);
    fetchCldFolders(baseFolder);
  }, [cldPath, cldUploading, fetchCldImages, fetchCldFolders]);

  // ═══ CLOUDINARY BULK DELETE (reference ~4282) ═══
  const handleCldBulkDelete = useCallback(async () => {
    const ids = Array.from(cldSelected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} photo${ids.length > 1 ? "s" : ""} permanently from Cloudinary?`)) return;
    setCldDeleting(true);
    try {
      const d = await cldAdmin("delete_bulk", { public_ids: ids });
      const deletedCount = d.deleted ? Object.values(d.deleted).filter(v => v === "deleted").length : 0;
      setCldImages(prev => prev.filter(img => !cldSelected.has(img.public_id)));
      setCldSelected(new Set());
      setCldSelectMode(false);
      showMsg(`✓ ${deletedCount} photo${deletedCount !== 1 ? "s" : ""} deleted`, "green");
    } catch (e) { showMsg("Bulk delete failed: " + e.message, "red"); }
    setCldDeleting(false);
  }, [cldSelected]);

  // ═══ CLOUDINARY DELETE FOLDER (reference ~4303) ═══
  const handleCldDeleteFolder = useCallback(async (folderName) => {
    const fullPath = [...cldPath, folderName].join("/");
    if (!confirm(`Delete folder "${folderName}" and ALL its contents permanently?\n\nPath: ${fullPath}\n\nThis cannot be undone!`)) return;
    setCldDeleting(true);
    try {
      const d = await cldAdmin("delete_folder", { prefix: fullPath });
      setCldFolders(prev => prev.filter(f => (f.name || f.path) !== folderName));
      showMsg(`✓ Folder "${folderName}" deleted`, "green");
    } catch (e) { showMsg("Folder delete failed: " + e.message, "red"); }
    setCldDeleting(false);
  }, [cldPath]);

  // Normalize photo: string → {url, zones:[]} (reference ~4319)
  const normPhoto = (p) => typeof p === "string" ? { url: p, zones: [] } : { url: p.url || "", zones: p.zones || [] };
  const getPhotos = (tag) => (tag.photos || []).map(normPhoto);

  // ═══ ZONE ICONS (reference ~4324) ═══
  const ZONE_ICONS = { "Stage": "🎭", "Entry Passage": "🚪", "Centre Lounge": "🛋️", "Side Lounge": "🪑", "Vedi": "🕯️", "Centre Pieces": "💎", "Open Lounges": "🌿", "Photobooth": "📸", "Installations": "✨", "Props": "🎪" };

  // ═══ MANUAL VIDEOS SAVE (reference ~4393) — routed through reliableSave like saveLib ═══
  const saveManualVideos = useCallback(async (nv, del) => {
    setManualVideos(nv);
    await reliableSave(MANUAL_VID_SK, JSON.stringify(nv), "Video");
  }, []);

  const saveHiddenVideos = useCallback(async (nh) => {
    setHiddenVideos(nh);
    await reliableSave(HIDDEN_VID_SK, JSON.stringify(nh), "Hidden videos");
  }, []);

  // ═══ CLOUDINARY VIDEO BROWSER (reference ~4415) — rewired /api/cloudinary → cldAdmin ═══
  const fetchCldVideoFolders = useCallback(async (path = "") => {
    setCldVideoLoading(true);
    try {
      const data = await cldAdmin("folders", { path });
      if (data.error) { showMsg("CLD: " + data.error, "red"); setCldVideoLoading(false); return; }
      setCldVideoFolders(data.folders || []);
      setCldVideoList([]);
    } catch (e) { showMsg("Cloudinary fetch failed", "red"); }
    setCldVideoLoading(false);
  }, []);

  const fetchCldVideoList = useCallback(async (prefix) => {
    setCldVideoLoading(true);
    try {
      const data = await cldAdmin("list_video", { prefix, max_results: 100 });
      if (data.error) { showMsg("CLD: " + data.error, "red"); setCldVideoLoading(false); return; }
      setCldVideoList(data.resources || []);
    } catch (e) { showMsg("Cloudinary fetch failed", "red"); }
    setCldVideoLoading(false);
  }, []);

  const openCldVideoBrowser = useCallback(() => {
    setAddVideoOpen(true); setCldVideoPath([]); setCldVideoFolders([]); setCldVideoList([]);
    fetchCldVideoFolders("");
  }, [fetchCldVideoFolders]);

  const cldVideoNavigate = useCallback((folderName) => {
    const newPath = [...cldVideoPath, folderName];
    setCldVideoPath(newPath);
    const fullPath = newPath.join("/");
    fetchCldVideoFolders(fullPath);
    fetchCldVideoList(fullPath);
  }, [cldVideoPath, fetchCldVideoFolders, fetchCldVideoList]);

  const cldVideoGoBack = useCallback((idx) => {
    const newPath = cldVideoPath.slice(0, idx);
    setCldVideoPath(newPath);
    const fullPath = newPath.join("/");
    fetchCldVideoFolders(fullPath);
    if (newPath.length > 0) fetchCldVideoList(fullPath); else setCldVideoList([]);
  }, [cldVideoPath, fetchCldVideoFolders, fetchCldVideoList]);

  const addCldVideo = useCallback((resource) => {
    const vidUrl = resource.secure_url;
    // Generate thumbnail: replace /video/upload/ path and extension
    const thumbUrl = vidUrl.replace("/video/upload/", "/video/upload/so_0,w_320,h_180,c_fill/").replace(/\.[^.]+$/, ".jpg");
    const vid = {
      id: "M" + Date.now().toString(36),
      title: (resource.public_id || "").split("/").pop().replace(/[-_]/g, " "),
      thumb: thumbUrl,
      videoUrl: vidUrl,
      duration: resource.duration ? Math.floor(resource.duration / 60) + ":" + String(Math.floor(resource.duration % 60)).padStart(2, "0") : "",
      date: (resource.created_at || "").slice(0, 10),
      source: "cloudinary",
      addedAt: Date.now()
    };
    const existing = manualVideos.some(m => m.videoUrl === vidUrl);
    if (existing) { showMsg("Already added", "orange"); return; }
    saveManualVideos([vid, ...manualVideos]);
  }, [manualVideos, saveManualVideos]);

  // ═══ AI TAG VIDEO (reference ~4762) — /api/youtube → ytApi, /api/anthropic → callClaudeStreaming ═══
  // Core: fetch a video's details, AI-tag the metadata, and auto-assign the best-match library
  // photo per zone. Returns the tag object (with _aiTagged) or null. Used by single + bulk taggers.
  const buildVideoTagFromAI = useCallback(async (videoId) => {
      const ytData = await ytApi("videos", { part: "snippet", id: videoId }).catch(() => ({}));
      const snippet = ytData.items?.[0]?.snippet;
      if (!snippet) return null;
      const title = snippet.title || "";
      const desc = snippet.description || "";
      const ytTags = (snippet.tags || []).join(", ");
      const venueList = allInhouseVenues.join(", ");
      const venueAliases = allInhouseVenues.map(v => {
        const parts = v.toLowerCase().split(/\s+/);
        return `"${v}" (match if text contains: ${parts.filter(p => p.length > 3).join(", ")})`;
      }).join("; ");
      const fnList = taxOr(taxonomy.eventType, FUNCTIONS).map(f => `"${f}"`).join(", ");
      const styleList = (taxonomy.designStyle || []).map(s => `"${s}"`).join(", ");
      const colorList = (imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : (taxonomy.colorPalette || [])).map(c => `"${c}"`).join(", ");
      const prompt = `You are a wedding/event decor video tagger. Respond ONLY with valid JSON.

Analyze this YouTube video about Indian wedding/event decoration and extract tags.

VIDEO TITLE: ${title}
VIDEO DESCRIPTION: ${desc.slice(0, 1500)}
VIDEO TAGS: ${ytTags}

SMART VENUE MATCHING — match against these known venues: ${venueList}
Aliases: ${venueAliases}
Rules: If the title/description mentions "Pushpanjali" → venue is "Pushpanjali". If it mentions "Exotica" → "Exotica". If it mentions "Manaktala" → "Manaktala". Match partial names intelligently. Also match abbreviations or variations.

Extract these fields using ONLY these exact values:
- venue: one of [${allInhouseVenues.map(v => `"${v}"`).join(", ")}] or "" if unknown
- fn: function type, array from [${fnList}]
- tier: "Silver" (simple/basic decor) or "Gold" (premium/enhanced/luxury decor) — infer from description/quality/scale
- io: "Indoor" or "Outdoor" or "" — infer from venue name, description, or visual cues mentioned
- colors: array from [${colorList}] — pick values that match colors mentioned or implied
- styles: array from [${styleList}] — pick values that match the decor style described

Return ONLY JSON:
{"venue":"...","fn":["..."],"tier":"...","io":"...","colors":["..."],"styles":["..."]}`;

      const txt = await callClaudeStreaming({
        contentBlocks: prompt,
        model: "claude-sonnet-4-6",
        maxTokens: 500,
      });
      const clean = (txt || "").replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const existingTag = ytVideoTags[videoId] || {};
      const newTag = {
        ...existingTag,
        venue: parsed.venue || existingTag.venue || "",
        fn: Array.isArray(parsed.fn) ? (parsed.fn.length === 1 ? parsed.fn[0] : parsed.fn) : parsed.fn || existingTag.fn,
        tier: parsed.tier || existingTag.tier,
        io: parsed.io || existingTag.io,
        colors: (parsed.colors || []).length ? parsed.colors : existingTag.colors || [],
        styles: (parsed.styles || []).length ? parsed.styles : existingTag.styles || [],
        palette: parsed.colors?.[0] || existingTag.palette || "",
      };
      // Auto-assign the best-matching library photo to each zone (kept if the admin already picked
      // one). Gives the video a build cost so it shows priced on Browse once saved.
      const autoZonePhotos = { ...(existingTag.zonePhotos || {}) };
      for (const area of (taxonomy.areasElements || [])) {
        if (autoZonePhotos[area]) continue;
        const { exact, similar } = await getLibPhotosForZone(area, newTag);
        const top = exact[0] || similar[0];
        if (top) autoZonePhotos[area] = top.id;
      }
      newTag.zonePhotos = autoZonePhotos;
      newTag._aiTagged = true;
      return newTag;
  }, [ytVideoTags, allInhouseVenues, taxonomy, imsPaletteCatalogue, getLibPhotosForZone]);

  const aiTagVideo = useCallback(async (videoId) => {
    if (aiTaggingVideo) return;
    setAiTaggingVideo(videoId);
    showMsg("🤖 AI analyzing video...", "blue");
    try {
      const newTag = await buildVideoTagFromAI(videoId);
      if (!newTag) { showMsg("Couldn't fetch video details", "red"); setAiTaggingVideo(null); return; }
      const assigned = Object.keys(newTag.zonePhotos || {}).length;
      setAiVideoDraft({ videoId, tags: newTag });
      setYtTagEdit(videoId);
      showMsg(`✓ AI tagged + ${assigned} zone photo${assigned === 1 ? "" : "s"} — review & save`, "green");
    } catch (e) { showMsg("AI tag failed: " + e.message, "red"); }
    setAiTaggingVideo(null);
  }, [aiTaggingVideo, buildVideoTagFromAI]);

  // Direct-save variant for the full-screen editor: AI-tag a single video and save immediately
  // (no draft step), so the big editor just shows the filled tags to review/adjust.
  const aiTagVideoSave = useCallback(async (videoId) => {
    if (aiTaggingVideo) return;
    setAiTaggingVideo(videoId);
    showMsg("🤖 AI analyzing video...", "blue");
    try {
      const newTag = await buildVideoTagFromAI(videoId);
      if (!newTag) { showMsg("Couldn't fetch video details", "red"); setAiTaggingVideo(null); return; }
      const assigned = Object.keys(newTag.zonePhotos || {}).length;
      await saveYtTags({ ...ytVideoTags, [videoId]: { ...newTag, _savedBy: authUser?.name || "AI", _savedAt: Date.now() } });
      showMsg(`✓ AI tagged + ${assigned} zone photo${assigned === 1 ? "" : "s"} — review & adjust below`, "green");
    } catch (e) { showMsg("AI tag failed: " + e.message, "red"); }
    setAiTaggingVideo(null);
  }, [aiTaggingVideo, buildVideoTagFromAI, ytVideoTags, saveYtTags, authUser]);

  // Bulk AI-tag every untagged video (app-wide, like photo bulk). Saves directly with _aiTagged so
  // the team reviews/verifies after — keeps going while you move around; stoppable; resumable.
  const stopBulkTagVideos = useCallback(() => { bulkVidStop.current = true; }, []);
  const runBulkTagVideos = useCallback(async () => {
    const targets = allVideos.filter(v => !hiddenVideos[v.id] && !ytVideoTags[v.id]);
    if (!targets.length) { showMsg("No untagged videos — every video is already tagged.", "green"); return null; }
    bulkVidStop.current = false;
    setBulkVid({ running: true, done: 0, total: targets.length, ok: 0, fail: 0, finishedAt: 0 });
    let merged = { ...ytVideoTags };
    let ok = 0, fail = 0;
    for (let n = 0; n < targets.length; n++) {
      if (bulkVidStop.current) break;
      try {
        const tag = await Promise.race([buildVideoTagFromAI(targets[n].id), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30000))]);
        if (tag) { merged = { ...merged, [targets[n].id]: { ...tag, _savedBy: "AI (bulk)", _savedAt: Date.now() } }; ok++; }
        else fail++;
      } catch { fail++; }
      if ((n + 1) % 4 === 0) await saveYtTags(merged);
      setBulkVid({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
    }
    await saveYtTags(merged);
    const stopped = bulkVidStop.current;
    setBulkVid({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🎬 Video AI tagging ${stopped ? "stopped" : "complete"} — ${ok} tagged, ${fail} failed. Review them in Library → Videos → Needs review.`, "green");
    return { ok, fail };
  }, [allVideos, hiddenVideos, ytVideoTags, buildVideoTagFromAI, saveYtTags]);

  // ── YouTube Data API loaders — rewired through the Supabase `youtube` Edge Function
  // (ytApi) + kv cache (YT_SK settings blob) instead of /api/youtube + window.storage. ──
  const fetchYTPlaylist = useCallback(async (playlistId, pageToken) => {
    const d = await ytApi("playlistItems", { part: "snippet,contentDetails", maxResults: 50, playlistId, ...(pageToken ? { pageToken } : {}) }).catch(() => ({}));
    if (!d.items) return { items: [], nextPageToken: null };
    const videoIds = d.items.map((i) => i.contentDetails?.videoId).filter(Boolean).join(",");
    const durations = {};
    if (videoIds) {
      const vd = await ytApi("videos", { part: "contentDetails", id: videoIds }).catch(() => ({}));
      (vd.items || []).forEach((v) => { durations[v.id] = ytDuration(v.contentDetails?.duration); });
    }
    const items = d.items.map((i) => ({
      id: i.contentDetails?.videoId, title: i.snippet?.title || "", thumb: i.snippet?.thumbnails?.medium?.url || i.snippet?.thumbnails?.default?.url || "",
      date: i.snippet?.publishedAt?.slice(0, 10) || "", duration: durations[i.contentDetails?.videoId] || "",
      playlistId, embedUrl: `https://www.youtube.com/embed/${i.contentDetails?.videoId}?rel=0&modestbranding=1`,
    })).filter((i) => i.id && i.title !== "Deleted video" && i.title !== "Private video");
    return { items, nextPageToken: d.nextPageToken || null };
  }, []);

  const loadAllYT = useCallback(async (forceRefresh) => {
    if (!forceRefresh && ytVideos.length > 0 && Date.now() - ytLastFetch < YT_CACHE_TTL) return;
    setYtLoading(true);
    try {
      if (!forceRefresh) {
        try {
          const raw = await kvGet(YT_SK);
          const cd = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (cd?.ts && Date.now() - cd.ts < YT_CACHE_TTL && cd.videos?.length) { setYtVideos(cd.videos); if (cd.playlists) setYtPlaylists(cd.playlists); setYtLastFetch(cd.ts); setYtLoading(false); return; }
        } catch { /* ignore */ }
      }
      let vids = [];
      for (const pl of ytPlaylists) {
        let pageToken = null;
        do {
          const { items, nextPageToken } = await fetchYTPlaylist(pl.id, pageToken);
          vids = [...vids, ...items];
          pageToken = nextPageToken;
        } while (pageToken);
      }
      const seen = new Set();
      vids = vids.filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
      setYtVideos(vids); setYtLastFetch(Date.now());
      try { await reliableSave(YT_SK, JSON.stringify({ videos: vids, playlists: ytPlaylists, ts: Date.now() }), "YT cache"); } catch { /* ignore */ }
    } catch { showMsg("YouTube fetch failed", "red"); }
    setYtLoading(false);
  }, [ytPlaylists, ytVideos, ytLastFetch, fetchYTPlaylist, showMsg]);

  const searchYT = useCallback(async (query) => {
    if (!query.trim()) return;
    setYtLoading(true);
    try {
      const d = await ytApi("search", { part: "snippet", type: "video", maxResults: 20, q: query }).catch(() => ({}));
      const items = (d.items || []).map((i) => ({
        id: i.id?.videoId, title: i.snippet?.title || "", thumb: i.snippet?.thumbnails?.medium?.url || "",
        date: i.snippet?.publishedAt?.slice(0, 10) || "", duration: "", playlistId: "search",
        embedUrl: `https://www.youtube.com/embed/${i.id?.videoId}?rel=0&modestbranding=1`,
      })).filter((i) => i.id);
      setYtVideos(items);
    } catch { showMsg("YouTube search failed", "red"); }
    setYtLoading(false);
  }, [showMsg]);

  // Populate the video catalog on first entry to the Browse step (so tiles appear).
  useEffect(() => { if (mode === "studio" && step === 1 && ytVideos.length === 0 && !ytLoading) loadAllYT(); }, [mode, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-persist custom venue (Event Info) — VERBATIM ──
  const autoPersistCustomVenue = useCallback(() => {
    const name = (clientVenueOther || "").trim();
    const rate = Number(customTripRate) || 0;
    const gensets = customGensets;
    if (!name || rate <= 0 || gensets === null || gensets === undefined || gensets < 0) return;
    const lcName = name.toLowerCase();
    const inInhouse = allInhouseVenues.some(v => v.toLowerCase() === lcName);
    const inOutside = customOutdoor.some(o => (o.name || "").toLowerCase() === lcName);
    const inAnyTR = trVenues.some(v => (v.name || "").toLowerCase() === lcName);
    if (inInhouse || inOutside || inAnyTR) return;
    const existingTR = trVenues.find(v => (v.name || "").toLowerCase() === lcName);
    let newTR;
    if (existingTR) {
      newTR = trVenues.map(v => v.id === existingTR.id ? { ...v, rate, gensets, name } : v);
    } else {
      const id = "V" + Date.now().toString(36).slice(-5).toUpperCase();
      newTR = [...trVenues, { id, tier: "other", name, rate, gensets }];
    }
    const existingOut = customOutdoor.find(o => (o.name || "").toLowerCase() === lcName);
    const newOut = existingOut ? customOutdoor : [...customOutdoor, { name, empanelled: false }];
    saveTR(newTR, null);
    if (newOut !== customOutdoor) saveVenues(customInhouse, newOut);
    showMsg(`✓ Saved ${name} (₹${rate}/trip, ${gensets} gensets)`, "green");
  }, [clientVenueOther, customTripRate, customGensets, trVenues, customOutdoor, customInhouse, allInhouseVenues, saveTR, saveVenues]);

  // ── Outdoor venue list (DB + events) — VERBATIM ──
  const outdoorVenueList = useMemo(() => {
    const venueMap = {};
    allOutdoorDB.forEach(v => { venueMap[v.name] = { ...v, fromDB: true }; });
    events.forEach(ev => {
      if (ev.venue && !allInhouseVenues.includes(ev.venue) && !venueMap[ev.venue]) {
        venueMap[ev.venue] = { name: ev.venue, empanelled: false, fromDB: false, newlyAdded: true };
      }
    });
    return Object.values(venueMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [events, allOutdoorDB, allInhouseVenues]);

  // ── Browse videos (tagged-video inspiration catalog) — VERBATIM ──
  const browseVideos = useMemo(() => {
    const list = Object.entries(ytVideoTags).map(([vidId, tag]) => {
      const vid = allVideos.find(v => v.id === vidId);
      const fnArr = Array.isArray(tag.fn) ? tag.fn : (tag.fn ? [tag.fn] : []);
      const hasZonePhotos = tag.zonePhotos && Object.keys(tag.zonePhotos).length > 0;
      const evForCost = { id: `vid_${vidId}`, venue: tag.venue || "", video: `https://www.youtube.com/embed/${vidId}` };
      const price = hasZonePhotos ? calcFullEventCost(evForCost) : null;
      return {
        id: vidId,
        title: vid?.title || "Untitled video",
        thumbnail: vid?.thumbnail || `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`,
        venue: tag.venue || "",
        fns: fnArr,
        fn: fnArr[0] || "",
        tier: tag.tier || "",
        tierCat: tag.tier || "",
        space: tag.io || "",
        styles: tag.styles || [],
        colors: tag.colors || [],
        hasZonePhotos,
        price,
        aiTagged: !!tag._aiTagged,
        savedBy: tag._savedBy || "",
        duration: vid?.duration || "",
        source: vid?.source || "youtube"
      };
    });
    let out = list;
    if (venueGroup === "inhouse") out = out.filter(v => v.venue && allInhouseVenues.includes(v.venue));
    else if (venueGroup === "outside") {
      out = out.filter(v => v.venue && !allInhouseVenues.includes(v.venue));
      if (outsideSub === "empanelled") out = out.filter(v => allOutdoorDB.find(x => x.name === v.venue && x.empanelled));
      else if (outsideSub === "other") out = out.filter(v => !allOutdoorDB.find(x => x.name === v.venue && x.empanelled));
    }
    if (browseVenues.length > 0) out = out.filter(v => browseVenues.includes(v.venue));
    if (filterFn.length > 0) out = out.filter(v => v.fns.some(f => filterFn.includes(f)));
    if (filterCat.length > 0) out = out.filter(v => v.tierCat && filterCat.includes(v.tierCat));
    if (filterSpace.length > 0) out = out.filter(v => v.space && filterSpace.includes(v.space));
    if (filterMood.length > 0) out = out.filter(v => v.styles.some(s => filterMood.includes(s)));
    if (filterPalette.length > 0) out = out.filter(v => v.colors.some(c => filterPalette.includes(c)));
    return out;
  }, [ytVideoTags, allVideos, calcFullEventCost, venueGroup, outsideSub, browseVenues, filterFn, filterCat, filterSpace, filterMood, filterPalette, allInhouseVenues, allOutdoorDB]);

  // ── Active client + meeting number — VERBATIM ──
  const activeClient = useMemo(() => clientLedger.find(c => c.id === activeClientId), [clientLedger, activeClientId]);
  const meetingNumber = useMemo(() => (activeClient?.sessions?.length || 0) + 1, [activeClient]);

  // ── Element toggle — VERBATIM ──
  const toggleEl = k => { setEnabledEls(p => ({ ...p, [k]: !p[k] })); setActiveZones([]); };

  // ── loadEvent → pickAndLoad → pickAndLoadFromVideo (browse → build) — VERBATIM ──
  const loadEvent = useCallback((ev, targetStep) => {
    if (isPremiaPlatinum(ev)) { setPremiaGate({ ev }); return; }
    setSourceEvent(ev);
    if (activeFnIdx === 0) {
      if (!fn) setFn(ev.fn);
      if (!venue) setVenue(ev.venue);
    } else {
      setExtraFunctions(prev => prev.map((f, i) => {
        if (i !== activeFnIdx - 1) return f;
        return { ...f, type: f.type || ev.fn, venue: f.venue || ev.venue };
      }));
    }
    setVenueCustom(false); setCustomGensets(null);
    setSelectedMoods(ev.mood ? [ev.mood] : []); setSelectedPalettes(ev.palette ? [ev.palette] : []);
    const en = {}; (ev.enabledEls || []).forEach(k => { en[k] = true; });
    (ev.zones || []).forEach(z => { if (z.type) en[z.type] = true; });
    en.lighting = true;
    setEnabledEls(en);
    const tierKey = getCat(getFullCost(ev)).label === "Silver" ? "simple" : "enhanced";
    const et = {}; Object.keys(en).forEach(k => { if (en[k]) et[k] = tierKey; });
    setElTiers(et);
    setCustomMode({});
    setItemQty(ev.itemQtys || {});
    setItemGrades(ev.itemGrades || {});
    setActiveZones([]);
    setVideoModal(null); setVideoOverlay(false); setStep((targetStep || 1) + 1);
  }, [isPremiaPlatinum, getFullCost, activeFnIdx, fn, venue, extraFunctions]);

  const pickAndLoad = useCallback((ev, targetStep, videoUrl) => {
    const vidId = (videoUrl || ev.video)?.match(/embed\/([a-zA-Z0-9_-]{11})/)?.[1];
    let videoZoneKeys = [];
    if (vidId) {
      const vTag = ytVideoTags[vidId] || {};
      const vid = allVideos.find(v => v.id === vidId);
      setSourceVideo({ id: vidId, title: vid?.title || ev.name, tags: vTag });
      // Default the Build palette to the one tagged on the video (salesperson can still change it).
      const vidPalette = vTag.palette || (Array.isArray(vTag.colors) ? vTag.colors[0] : "") || "";
      if (vidPalette) {
        if (activeFnIdx === 0) setClientPalette(vidPalette);
        else setExtraFunctions(prev => prev.map((f, i) => i === activeFnIdx - 1 ? { ...f, palette: vidPalette } : f));
      }
      const zonePhotos = vTag.zonePhotos || {};
      const autoZE = {};
      const autoSP = {};
      const autoZC = {};
      Object.entries(zonePhotos).forEach(([area, libId]) => {
        const li = libItems.find(l => l.id === libId);
        if (!li) return;
        // Map the photo-tag area name → the Build zone key so the selection lands on the right card.
        const zk = AREA_TO_ZONEKEY[area] || area;
        if ((li.elements || []).length > 0) {
          autoZE[zk] = JSON.parse(JSON.stringify(li.elements));
        }
        autoSP[zk] = { src: li.url, eventName: li.name || "Library photo" };
        const pd = li.dims || {};
        if (pd.trussW || pd.trussL || pd.trussH || pd.floorL || pd.floorW) {
          const cfg = buildZoneConfig(zk, pd);
          if (cfg) autoZC[zk] = cfg;
        }
      });
      if (Object.keys(autoZE).length > 0) setZoneElements(autoZE);
      if (Object.keys(autoSP).length > 0) setElSelectedPhoto(autoSP);
      if (Object.keys(autoZC).length > 0) {
        setZoneConfig(prev => ({ ...prev, ...autoZC }));
        setActiveZones([]);
      }
      videoZoneKeys = Object.keys(zonePhotos).map(area => AREA_TO_ZONEKEY[area] || area);
    }
    loadEvent(ev, targetStep);
    if (videoZoneKeys.length > 0) {
      setEnabledEls(prev => {
        const updated = { ...prev };
        videoZoneKeys.forEach(zk => { updated[zk] = true; });
        return updated;
      });
    }
  }, [loadEvent, ytVideoTags, allVideos, libItems, activeFnIdx, setClientPalette, setExtraFunctions]);

  const pickAndLoadFromVideo = useCallback((videoId, targetStep) => {
    const tag = ytVideoTags[videoId] || {};
    const vid = allVideos.find(v => v.id === videoId);
    const fnArr = Array.isArray(tag.fn) ? tag.fn : (tag.fn ? [tag.fn] : []);
    const synthEv = {
      id: `vid_${videoId}`,
      name: vid?.title || "Inspiration video",
      venue: tag.venue || "",
      fn: fnArr[0] || "Wedding",
      space: tag.io || "Outdoor",
      category: tag.tier || "Silver",
      mood: (tag.styles && tag.styles[0]) || "",
      palette: (tag.colors && tag.colors[0]) || "",
      gradient: "linear-gradient(135deg,#2C1810,#C9A96E,#1a1a2e)",
      photos: [],
      video: `https://www.youtube.com/embed/${videoId}`,
      desc: "",
      enabledEls: Object.keys(tag.zonePhotos || {}).map(area => AREA_TO_ZONEKEY[area] || area),
      itemQtys: {},
      itemGrades: {},
      tags: [...(tag.styles || []), ...(tag.colors || [])].slice(0, 3)
    };
    pickAndLoad(synthEv, targetStep, synthEv.video);
  }, [ytVideoTags, allVideos, pickAndLoad]);

  // ── Save session — VERBATIM ──
  const saveSession = useCallback((opts = {}) => {
    if (!clientName.trim()) return;
    const totalFns = 1 + (extraFunctions || []).length;
    const fnSnapshots = {};
    for (let i = 0; i < totalFns; i++) {
      let snap;
      if (i === activeFnIdx) {
        snap = snapshotBuildState();
      } else {
        snap = fnBuilds[i] || null;
      }
      if (snap) {
        if (snap.elSelectedPhoto) {
          snap = {
            ...snap,
            elSelectedPhoto: Object.fromEntries(Object.entries(snap.elSelectedPhoto).map(([ek, v]) => [ek, { src: v?.src, eventName: v?.eventName }]))
          };
        }
        fnSnapshots[i] = snap;
      }
    }
    const snapshot = {
      id: "SES_" + Date.now().toString(36),
      savedAt: Date.now(),
      savedBy: authUser?.name || "—",
      eventDate: clientDate,
      venue, fn,
      tier: getCat(grandTotal).label,
      total: grandTotal,
      decorTotal: totalCost(),
      transportTotal: transportCalc.total,
      enabledEls: { ...enabledEls },
      elTiers: { ...elTiers },
      zoneConfig: JSON.parse(JSON.stringify(zoneConfig)),
      zoneElements: JSON.parse(JSON.stringify(zoneElements)),
      elNotes: { ...elNotes },
      elSelectedPhoto: Object.fromEntries(Object.entries(elSelectedPhoto).map(([k, v]) => [k, { src: v?.src, eventName: v?.eventName }])),
      sourceEventId: sourceEvent?.id || null,
      sourceEventName: sourceEvent?.name || null,
      sourceVideoId: sourceVideo?.id || null,
      sourceVideoTitle: sourceVideo?.title || null,
      selectedMoods: [...selectedMoods],
      selectedPalettes: [...selectedPalettes],
      floralRatio,
      fnSnapshots,
      savedActiveFnIdx: activeFnIdx,
      customItems: dcCustomItems,
      auto: !!opts.auto,   // background auto-draft (rolling, updated in place) vs a manual Save Draft
    };
    let updated = [...clientLedger];
    let client = updated.find(c => c.id === activeClientId);
    if (!client) {
      client = { id: "CLI_" + Date.now().toString(36), name: clientName.trim(), phone: clientPhone.trim(), sessions: [], createdAt: Date.now(), status: "ongoing", createdBy: authUser?.name || "—", bookedAt: null, bookedBy: null, finalSession: null };
      updated.push(client);
    }
    client.name = clientName.trim();
    client.phone = clientPhone.trim();
    client.lastContactAt = Date.now();
    client.eventDate = clientDate || client.eventDate || "";
    client.venue = venue || client.venue || "";
    client.fn = fn || client.fn || "";
    client.shift = clientShift || client.shift || "";
    client.pax = clientPax || client.pax || "";
    client.brideGroom = clientBrideGroom || client.brideGroom || "";
    client.functions = [
      { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax, palette: clientPalette || "Custom" },
      ...extraFunctions
    ];
    if (!client.createdBy) client.createdBy = authUser?.name || "—";
    if (!client.status) client.status = "ongoing";
    // Auto-drafts update the rolling draft IN PLACE (replace a leading auto session) so the background
    // save doesn't spam the 20-session history; a manual Save Draft always prepends a fresh entry.
    const prevSessions = client.sessions || [];
    client.sessions = (opts.auto && prevSessions[0]?.auto)
      ? [snapshot, ...prevSessions.slice(1)].slice(0, 20)
      : [snapshot, ...prevSessions].slice(0, 20);
    setActiveClientId(client.id);
    const finalLedger = updated.slice(0, 200);
    saveClientLedger(finalLedger);
    if (!opts.auto) showMsg("✓ Session saved to " + client.name, "green");
    return { client, ledger: finalLedger };
  }, [clientName, clientPhone, clientDate, clientShift, clientPax, clientPalette, clientBrideGroom, venue, fn, extraFunctions, grandTotal, totalCost, transportCalc, enabledEls, elTiers, zoneConfig, zoneElements, elNotes, elSelectedPhoto, sourceEvent, sourceVideo, selectedMoods, selectedPalettes, floralRatio, clientLedger, activeClientId, authUser, saveClientLedger, activeFnIdx, fnBuilds, itemQty, itemGrades, customMode, activeZones, customZones, customGensets, customTripRate, dcCustomItems]);

  // ── Build auto-save (robust) ──────────────────────────────────────────────
  // The build (zone photos, Silver/Gold tab, elements, dims, carpet) previously persisted ONLY on a
  // manual "Save Draft" / booking, so a refresh before saving reverted the client to an older session
  // (wrong photos/tab/dims on reopen — e.g. Gold clicks lost, zones back to Silver). We roll a
  // background auto-draft into the client's latest session. THREE triggers so nothing is ever lost:
  //   1) debounced 1.5s after an edit pause,
  //   2) a 15s periodic fallback (covers CONTINUOUS editing where the debounce timer keeps resetting),
  //   3) on tab hide / pagehide (captures the state right before a refresh or tab switch).
  // Refs hold the latest saveSession + a "has data" guard so the interval/listeners call the current
  // closure without re-subscribing (and never overwrite good data with an empty snapshot).
  const saveSessionRef = useRef(saveSession);
  useEffect(() => { saveSessionRef.current = saveSession; });
  const buildHasDataRef = useRef(false);
  useEffect(() => {
    // Auto-save as soon as there's a named deal with any build data — even a BRAND-NEW deal with no
    // activeClientId yet (saveSession creates the client + sets the id). Without this a new build was
    // never persisted, so a refresh/route-switch lost everything.
    buildHasDataRef.current = !!(clientName.trim() && (
      Object.keys(zoneElements || {}).length > 0
      || Object.keys(elSelectedPhoto || {}).length > 0
      || Object.values(enabledEls || {}).some(Boolean)
    ));
  });
  const autoSaveBuild = useCallback(() => { if (buildHasDataRef.current) { try { saveSessionRef.current({ auto: true }); } catch { /* ignore */ } } }, []);
  // 1) Debounced on edits.
  useEffect(() => {
    if (!buildHasDataRef.current) return;
    const t = setTimeout(autoSaveBuild, 1500);
    return () => clearTimeout(t);
  }, [activeClientId, clientName, zoneElements, elSelectedPhoto, elTiers, zoneConfig, enabledEls, elNotes, floralRatio, itemQty, itemGrades, customZones, customMode, activeFnIdx, fnBuilds, autoSaveBuild]);
  // 2) Periodic fallback + 3) save on tab hide / refresh.
  useEffect(() => {
    const id = setInterval(autoSaveBuild, 15000);
    const onVis = () => { if (document.visibilityState === "hidden") autoSaveBuild(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", autoSaveBuild);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", autoSaveBuild); autoSaveBuild(); /* save on unmount → covers Studio↔IMS route switch (no pagehide fires) */ };
  }, [autoSaveBuild]);

  // ── Mark sold (writes Event Order) — VERBATIM ──
  const markSold = useCallback(() => {
    try {
      if (!clientName.trim()) { showMsg("Client name is required", "red"); return; }
      if (!clientDate) { showMsg("Event date is required", "red"); return; }
      if (!venue) { showMsg("Venue is required", "red"); return; }
      const dt = dateTypes[clientDate];
      const bookedCount = clientLedger.filter(c => c.eventDate === clientDate && c.status === "booked").length;
      let warns = [];
      if (dt === "saya") warns.push("🔴 This is a Saya day");
      if (dt === "competition") warns.push("⚫ This is a Competition day");
      if (bookedCount >= 2) warns.push(`🔥 ${bookedCount} bookings already on this date`);
      const warnStr = warns.length ? "\n\n⚠️ " + warns.join("\n⚠️ ") : "";
      if (!confirm(`Confirm booking for ${clientName.trim()} — ${clientDate} at ${venue}?${warnStr}`)) return;
      const result = saveSession();
      if (!result || !result.client) { showMsg("Save a client first", "red"); return; }
      const { client, ledger } = result;
      const updated = ledger.map(c => c.id === client.id ? { ...c, status: "booked", bookedAt: Date.now(), bookedBy: authUser?.name || "—", finalSession: c.sessions?.[0] || null } : c);
      saveClientLedger(updated);
      const allFns = collectAllFunctionData();
      const fnEOs = allFns.map(fnData => {
        const bd = calcFunctionBreakdown(fnData);
        return {
          fnIdx: fnData.fnIdx,
          type: fnData.fnType || "",
          date: fnData.fnDate || "",
          venue: fnData.fnVenue || "",
          shift: fnData.fnShift || "",
          pax: fnData.fnPax || "",
          zones: JSON.parse(JSON.stringify(fnData.zoneConfig || {})),
          elements: JSON.parse(JSON.stringify(fnData.zoneElements || {})),
          enabledEls: { ...(fnData.enabledEls || {}) },
          elTiers: { ...(fnData.elTiers || {}) },
          elSelectedPhoto: Object.fromEntries(Object.entries(fnData.elSelectedPhoto || {}).map(([k, v]) => [k, { src: v?.src, eventName: v?.eventName }])),
          dims: Object.fromEntries(Object.entries(fnData.zoneConfig || {}).map(([zk, zc]) => [zk, zc?.dims || {}])),
          decorCost: bd.decorTotal,
          transportCost: bd.transportTotal,
          customItemsCost: dcCustomItems.filter(c => c.fnIdx === fnData.fnIdx).reduce((s, c) => s + (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1), 0),
          total: bd.grand + dcCustomItems.filter(c => c.fnIdx === fnData.fnIdx).reduce((s, c) => s + (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1), 0),
          floralRatio: typeof fnData.floralRatio === "number" ? fnData.floralRatio : floralRatio,
          floralOverrides: fnData.floralOverrides && typeof fnData.floralOverrides === "object"
            ? { note: fnData.floralOverrides.note || "", rows: Array.isArray(fnData.floralOverrides.rows) ? fnData.floralOverrides.rows : [] }
            : { note: "", rows: [] },
          floralColorPrefs: dcFloralColorPrefs[fnData.fnIdx] || {},
          customItems: dcCustomItems.filter(c => c.fnIdx === fnData.fnIdx),
          photoOverrides: { ...(dcPhotoOverrides[fnData.fnIdx] || {}) },
          skipped: [...(dcSkipped[fnData.fnIdx] || [])],
          productionAccepted: [...(dcProductionAccepted[fnData.fnIdx] || [])],
          dedupOverrides: { ...(dcDedupOverrides[fnData.fnIdx] || {}) }
        };
      });
      const eventTotal = fnEOs.reduce((s, f) => s + (f.total || 0), 0);
      const eventDecor = fnEOs.reduce((s, f) => s + (f.decorCost || 0), 0);
      const eventTransport = fnEOs.reduce((s, f) => s + (f.transportCost || 0), 0);
      // Snapshot the Deal Check floral MANDI plan (projected) so the IMS Floral head sees the same
      // breakdown and can enter the actual mandi price later → real P&L flows back here.
      let floralPlan = { projected: 0, flowers: [] };
      try {
        const fbAgg = {};
        allFns.forEach(fnData => { const r = calcFnFloralSourcingCost(fnData); (r.breakdown || []).forEach(f => { if (!fbAgg[f.name]) fbAgg[f.name] = { name: f.name, qty: 0, cost: 0, unit: f.unit }; fbAgg[f.name].qty += f.qty; fbAgg[f.name].cost += f.cost; }); });
        const flowers = Object.values(fbAgg).sort((a, b) => b.cost - a.cost);
        floralPlan = { projected: Math.round(flowers.reduce((s, f) => s + f.cost, 0)), flowers, capturedAt: Date.now() };
      } catch {}
      // Snapshot the system manpower plan (counts + how each was derived) so dept heads see it.
      let manpowerPlan = [];
      try { manpowerPlan = manpowerPlanForBooking(allFns); } catch {}
      // Prevent double-booking: one client + date = ONE event order. If an active (non-cancelled) order
      // already exists for this client+date, update it IN PLACE (reuse id) instead of creating a second
      // row. Otherwise re-confirming the same deal would spawn a duplicate booking in IMS.
      const existingActive = eventOrders.find(e => e.clientId === client.id && e.date === clientDate && e.status !== "cancelled");
      if (existingActive && !confirm(`${client.name} is already booked for ${clientDate} (status: ${existingActive.status || "pending"}). Update that existing booking with the latest plan instead of creating a second one?`)) return;
      const eoId = existingActive ? existingActive.id : ("eo_" + Date.now().toString(36));
      const eoCreatedAt = existingActive ? (existingActive.createdAt || Date.now()) : Date.now();
      // Keep an in-progress IMS status (blocked/final) on re-push; otherwise (re)start the auto-confirm.
      const eoStatus = (existingActive && (existingActive.status === "blocked" || existingActive.status === "final")) ? existingActive.status : "pending";
      const eo = {
        id: eoId,
        clientId: client.id,
        clientName: client.name,
        phone: clientPhone.trim(),
        lmsLeadId: client.lmsLeadId || null,
        lmsDept: client.lmsDept || null,
        lmsPriority: client.lmsPriority || null,
        lmsStatus: client.lmsStatus || null,
        date: clientDate,
        venue,
        functions: allFns.map(f => f.fnType).filter(Boolean),
        shift: clientShift || "",
        brideGroom: clientBrideGroom || "",
        pax: clientPax || "",
        zones: JSON.parse(JSON.stringify(zoneConfig)),
        elements: JSON.parse(JSON.stringify(zoneElements)),
        enabledEls: { ...enabledEls },
        elTiers: { ...elTiers },
        dims: Object.fromEntries(Object.entries(zoneConfig).map(([zk, zc]) => [zk, zc?.dims || {}])),
        totalCost: eventTotal,
        decorCost: eventDecor,
        transportCost: eventTransport,
        functionsDetail: fnEOs,
        floralPlan,
        manpowerPlan,
        manualItems: [...dcManualItems],
        floralRatio,
        salesperson: authUser?.name || "—",
        createdAt: eoCreatedAt,
        status: eoStatus
      };
      saveEventOrders(existingActive ? eventOrders.map(e => e.id === eoId ? eo : e) : [...eventOrders, eo]);
      // Bridge to IMS: SOLD orders also go into the shared `event_orders` TABLE (Studio's own list
      // is a kv blob; IMS — Events, Planning, Dept Ops — reads the table + realtime).
      supabase.from("event_orders").upsert({ id: eo.id, client_name: eo.clientName ?? null, event_id: eo.eventId ?? null, fn_id: eo.fnId ?? null, status: eo.status ?? "pending", items: eo.items || [], manual_items: eo.manualItems || [], decisions: eo.decisions || {}, data: eo }, { onConflict: "id" }).then(({ error }) => { if (error) console.warn("[markSold] event_orders table sync failed:", error.message); }).catch(() => {});
      logActivity("booking", `🎉 ${client.name} — Booking confirmed by ${authUser?.name || "—"}`);
      setShowSoldConfetti(true);
      setTimeout(() => setShowSoldConfetti(false), 4000);
      showMsg("🎉 Booking confirmed for " + client.name, "green");
    } catch (e) { showMsg("Error: " + (e.message || "unknown"), "red"); }
  }, [saveSession, authUser, saveClientLedger, logActivity, clientName, clientDate, venue, fn, clientPhone, clientShift, clientBrideGroom, clientPax, dateTypes, clientLedger, zoneConfig, zoneElements, enabledEls, elTiers, grandTotal, totalCost, transportCalc, floralRatio, eventOrders, saveEventOrders, collectAllFunctionData, calcFunctionBreakdown, dcPhotoOverrides, dcSkipped, dcProductionAccepted, dcManualItems, dcDedupOverrides, dcCustomItems, dcFloralColorPrefs]);

  // ── Load client session — VERBATIM ──
  const loadClientSession = useCallback((client, session, landingStep = 3) => {
    setClientName(client.name);
    setClientPhone(client.phone || "");
    setActiveClientId(client.id);
    setClientDate(client.eventDate || "");
    setVenue(client.venue || "");
    setFn(client.fn || "");
    setClientShift(client.shift || "");
    setClientPax(client.pax || "");
    setClientBrideGroom(client.brideGroom || "");
    const f0 = Array.isArray(client.functions) && client.functions[0] ? client.functions[0] : null;
    setClientPalette(f0?.palette || "Custom");
    if (Array.isArray(client.functions) && client.functions.length > 1) {
      setExtraFunctions(client.functions.slice(1).map(f => ({
        type: f?.type || "",
        date: f?.date || "",
        venue: f?.venue || "",
        shift: f?.shift || "",
        pax: f?.pax || "",
        palette: f?.palette || "Custom",
      })));
    } else {
      setExtraFunctions([]);
    }
    setExpandedFnIdx(0);
    setActiveFnIdx(0);
    if (!session) {
      setFnBuilds({});
      setStep(landingStep);
      return;
    }
    if (session.fnSnapshots && typeof session.fnSnapshots === "object" && Object.keys(session.fnSnapshots).length > 0) {
      const fn0Snap = session.fnSnapshots[0] || session.fnSnapshots["0"] || null;
      restoreBuildState(fn0Snap);
      const restoredBuilds = {};
      Object.entries(session.fnSnapshots).forEach(([k, v]) => {
        const idx = parseInt(k);
        if (!isNaN(idx) && idx !== 0 && v) restoredBuilds[idx] = v;
      });
      setFnBuilds(restoredBuilds);
      if (session.eventDate) setClientDate(session.eventDate);
      if (session.venue) setVenue(session.venue);
      if (session.fn) setFn(session.fn);
      if (session.sourceEventId) {
        const ev = events.find(e => e.id === session.sourceEventId);
        if (ev) setSourceEvent(ev);
      }
      if (session.sourceVideoId) {
        const vid = allVideos.find(v => v.id === session.sourceVideoId);
        const vTag = ytVideoTags[session.sourceVideoId] || {};
        setSourceVideo({ id: session.sourceVideoId, title: session.sourceVideoTitle || vid?.title || "Video", tags: vTag });
      }
      setStep(landingStep);
      const fnCount = Object.keys(session.fnSnapshots).length;
      showMsg("Loaded session from " + new Date(session.savedAt).toLocaleDateString("en-IN") + " (" + fnCount + " function" + (fnCount > 1 ? "s" : "") + ")", "green");
      return;
    }
    setFnBuilds({});
    if (session.eventDate) setClientDate(session.eventDate);
    if (session.venue) setVenue(session.venue);
    if (session.fn) setFn(session.fn);
    setEnabledEls(session.enabledEls || {});
    setElTiers(session.elTiers || {});
    setZoneConfig(session.zoneConfig || {});
    setZoneElements(session.zoneElements || {});
    setElNotes(session.elNotes || {});
    setSelectedMoods(session.selectedMoods || []);
    setSelectedPalettes(session.selectedPalettes || []);
    setFloralOverrides({ note: "", rows: [] });
    if (typeof session.floralRatio === "number") setFloralRatio(session.floralRatio);
    if (Array.isArray(session.customItems)) setDcCustomItems(session.customItems);
    if (session.sourceEventId) {
      const ev = events.find(e => e.id === session.sourceEventId);
      if (ev) setSourceEvent(ev);
    }
    if (session.sourceVideoId) {
      const vid = allVideos.find(v => v.id === session.sourceVideoId);
      const vTag = ytVideoTags[session.sourceVideoId] || {};
      setSourceVideo({ id: session.sourceVideoId, title: session.sourceVideoTitle || vid?.title || "Video", tags: vTag });
    }
    if (session.elSelectedPhoto) setElSelectedPhoto(session.elSelectedPhoto);
    setStep(landingStep);
    showMsg("Loaded session from " + new Date(session.savedAt).toLocaleDateString("en-IN"), "green");
  }, [events, allVideos, ytVideoTags]);

  // ── Restore the active deal on mount (refresh / Studio↔IMS switch) ──
  // The build lives in the client's rolling auto-session; sessionStorage remembers which deal + screen.
  // Runs once, only when nothing is loaded yet, so it never clobbers a deal already being edited.
  const buildRestoredRef = useRef(false);
  useEffect(() => {
    if (buildRestoredRef.current) return;
    if (activeClientId) { buildRestoredRef.current = true; return; }   // a live deal is already open
    if (!Array.isArray(clientLedger) || clientLedger.length === 0) return; // ledger not loaded yet
    let savedId = null; try { savedId = sessionStorage.getItem("ambria-active-client"); } catch { /* */ }
    if (!savedId) { buildRestoredRef.current = true; return; }
    const client = clientLedger.find(c => c.id === savedId);
    const session = client && Array.isArray(client.sessions) ? client.sessions[0] : null;
    buildRestoredRef.current = true;
    if (!client || !session) return;
    let savedStep = 3, savedFn = 0;
    try { const s = parseInt(sessionStorage.getItem("ambria-studio-step"), 10); if (!isNaN(s)) savedStep = s; } catch { /* */ }
    try { savedFn = parseInt(sessionStorage.getItem("ambria-active-fn"), 10) || 0; } catch { /* */ }
    loadClientSession(client, session, savedStep >= 1 ? savedStep : 3);
    if (savedFn > 0) setActiveFnIdx(savedFn);
  }, [clientLedger, activeClientId, loadClientSession]);

  // ── Load LMS lead — VERBATIM ──
  const loadLmsLead = useCallback((lead) => {
    if (!lead) return;
    setClientName(lead.guestName || "");
    setClientPhone(lead.phone || "");
    setClientBrideGroom("");
    setClientPax("");
    setClientPalette("Custom");
    setExpandedFnIdx(0);
    setActiveFnIdx(0);
    const allKnownVenues = [
      ...allInhouseVenues,
      ...allOutdoorDB.map(v => v.name).filter(Boolean),
    ];
    const resolveVenue = (candidate) => {
      const trimmed = (candidate || "").trim();
      if (!trimmed) return { venue: "", custom: "" };
      const matched = allKnownVenues.find(v => v.toLowerCase().trim() === trimmed.toLowerCase());
      if (matched) return { venue: matched, custom: "" };
      return { venue: "Others", custom: trimmed };
    };
    const fns = Array.isArray(lead.functions) && lead.functions.length > 0
      ? lead.functions
      : [{ fnDate: lead.fnDate, fnLabel: lead.fnLabel, fnType: lead.fnType, venueLabel: lead.venueLabel, shift: lead.shift }];
    const f1 = fns[0] || {};
    const f1Venue = resolveVenue(f1.venueLabel || lead.address);
    setClientDate(f1.fnDate || "");
    setFn(f1.fnLabel || "");
    setVenue(f1Venue.venue);
    setClientVenueOther(f1Venue.custom);
    setClientShift(f1.shift || "");
    const extras = fns.slice(1).map(f => {
      const v = resolveVenue(f.venueLabel || lead.address);
      return {
        type: f.fnLabel || "",
        date: f.fnDate || "",
        venue: v.venue,
        venueOther: v.custom,
        shift: f.shift || "",
        pax: "",
        palette: "Custom",
      };
    });
    setExtraFunctions(extras);
    const phoneKey = (lead.phone || "").replace(/\D/g, "");
    const existing = phoneKey
      ? clientLedger.find(c => (c.phone || "").replace(/\D/g, "") === phoneKey)
      : null;
    let client;
    if (existing) {
      client = {
        ...existing,
        name: existing.name || lead.guestName,
        phone: existing.phone || lead.phone,
        lmsLeadId: lead.entryNo,
        lmsDept: lead.dept,
        lmsPriority: lead.priority,
        lmsStatus: lead.status,
        lmsLinkedAt: Date.now(),
      };
      const updated = clientLedger.map(c => c.id === client.id ? client : c);
      saveClientLedger(updated);
    } else {
      client = {
        id: "CLI_" + Date.now().toString(36),
        name: (lead.guestName || "").trim(),
        phone: (lead.phone || "").trim(),
        sessions: [],
        createdAt: Date.now(),
        status: "ongoing",
        createdBy: authUser?.name || "—",
        bookedAt: null,
        bookedBy: null,
        finalSession: null,
        lmsLeadId: lead.entryNo,
        lmsDept: lead.dept,
        lmsPriority: lead.priority,
        lmsStatus: lead.status,
        lmsLinkedAt: Date.now(),
      };
      saveClientLedger([client, ...clientLedger]);
    }
    setActiveClientId(client.id);
    setLmsLeads([]);
    setLmsError(false);
    const latestSession = (client.sessions && client.sessions.length > 0) ? client.sessions[0] : null;
    if (latestSession) {
      loadClientSession(client, latestSession, 3);
      showMsg(`Loaded LMS lead #${lead.entryNo} + restored last session`, "green");
    } else {
      showMsg(`Loaded LMS lead #${lead.entryNo} (${lead.dept === "venue" ? "Venue" : "Decor"})`, "green");
    }
  }, [clientLedger, saveClientLedger, authUser, allInhouseVenues, allOutdoorDB, loadClientSession]);

  // ── Resume saved session (per-pill) — VERBATIM ──
  const resumeSavedSession = useCallback((session) => {
    if (!session) return;
    if (session.fnSnapshots && typeof session.fnSnapshots === "object" && Object.keys(session.fnSnapshots).length > 0) {
      const activeSnap = session.fnSnapshots[activeFnIdx] || session.fnSnapshots[String(activeFnIdx)] || null;
      restoreBuildState(activeSnap);
      const otherBuilds = {};
      Object.entries(session.fnSnapshots).forEach(([k, v]) => {
        const idx = parseInt(k);
        if (!isNaN(idx) && idx !== activeFnIdx && v) otherBuilds[idx] = v;
      });
      setFnBuilds(otherBuilds);
      setStep(2);
      showMsg("Resumed Fn" + (activeFnIdx + 1) + " from " + new Date(session.savedAt).toLocaleDateString("en-IN"), "green");
      return;
    }
    setEnabledEls(session.enabledEls || {});
    setElTiers(session.elTiers || {});
    setZoneConfig(session.zoneConfig || {});
    setZoneElements(session.zoneElements || {});
    setElNotes(session.elNotes || {});
    setElSelectedPhoto(session.elSelectedPhoto || {});
    setSelectedMoods(session.selectedMoods || []);
    setSelectedPalettes(session.selectedPalettes || []);
    setFloralOverrides({ note: "", rows: [] });
    if (typeof session.floralRatio === "number") setFloralRatio(session.floralRatio);
    if (Array.isArray(session.customItems)) setDcCustomItems(session.customItems);
    if (session.sourceEventId) {
      const ev = events.find(e => e.id === session.sourceEventId);
      if (ev) setSourceEvent(ev);
    } else {
      setSourceEvent(null);
    }
    if (session.sourceVideoId) {
      const vid = allVideos.find(v => v.id === session.sourceVideoId);
      const vTag = ytVideoTags[session.sourceVideoId] || {};
      setSourceVideo({ id: session.sourceVideoId, title: session.sourceVideoTitle || vid?.title || "Video", tags: vTag });
    } else {
      setSourceVideo(null);
    }
    setStep(2);
    showMsg("Resumed session from " + new Date(session.savedAt).toLocaleDateString("en-IN"), "green");
  }, [events, allVideos, ytVideoTags, activeFnIdx]);

  // ── AI tag an image (Claude vision) — routes via callClaudeStreaming (Supabase Edge Fn) ──
  const aiTagImage = async (url) => {
    // Temporary daily cap (testing). Block before any work once the day's limit is reached.
    if (aiTagCountToday() >= AI_TAG_DAILY_LIMIT) { showMsg(`Daily AI-tagging limit reached (${AI_TAG_DAILY_LIMIT}/day during testing).`, "red"); return null; }
    const STRUCTURAL_CATS = new Set(["truss", "platform", "masking", "fixed"]);
    // Exclude structural cats AND any sub-category flagged not-taggable in Pricing, so the AI's
    // "use these exact names" list never contains an item we don't want re-added during tagging.
    const elemList = rcItems.filter(i => !STRUCTURAL_CATS.has(i.cat) && !isSubTagHidden(i.cat, i.sub)).map(i => `"${i.name}" (${i.unit}${i.inhouseMode === "smb" ? ", sizes: S/M/B" : ""})`).join(", ");
    // #5 — Sub-category vocabulary by category (grounds element naming + routing to the right IMS sub-cat).
    // Skip sub-categories the team flagged as NOT taggable in Pricing (already-costed structural subs +
    // IMS-only subs) so the AI never suggests/re-adds them.
    const subByCat = {}; rcItems.forEach(i => { const c = String(i.cat || "").trim(); const s = String(i.sub || "").trim(); if (!c || !s || isSubTagHidden(c, s)) return; (subByCat[c] = subByCat[c] || new Set()).add(s); });
    const subcatText = Object.keys(subByCat).length ? ("Sub-category vocabulary by category (use these names and route each element to the right one):\n" + Object.entries(subByCat).map(([c, set]) => `- ${c}: ${[...set].join(", ")}`).join("\n")) : "";
    // #1 — House tagging rules (admin-editable in Manage → Library), followed strictly.
    const houseRules = (taxonomy.taggingStandards && String(taxonomy.taggingStandards).trim()) ? ("HOUSE TAGGING RULES (set by your team — follow strictly):\n" + String(taxonomy.taggingStandards).trim()) : "";
    const prompt = `Analyze this wedding/event decor image. Tag it using ONLY these exact values:\n\nEvent type: ${taxonomy.eventType.join(", ")}\nVenue type: ${taxonomy.venueType.join(", ")}\nAreas & elements: ${taxonomy.areasElements.join(", ")}\nColor palette: ${(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxonomy.colorPalette).join(", ")}\nCategory tier: ${taxonomy.categoryTier.join(", ")}\nDesign style: ${taxonomy.designStyle.join(", ")}\nTime/setting: ${taxonomy.timeSetting.join(", ")}\n\nElement estimation rules:\n1. FIRST PRIORITY: Use EXACT names from this Rate Card list. Copy the name character-for-character:\n${elemList}\n2. For each visible element, estimate quantity and pick size (S/M/B) if available.\n3. ONLY if you see something clearly visible that has NO match in the list above, add it with "new":true flag. Keep the name short and professional.\n4. CRITICAL — DO NOT add Truss, Box Truss, Single U Truss, Platform, Carpet, Wall Masking, Fabric Masking, Acrylic Panel, Flex Print, Vinyl Print, Genset, or any structural/overhead items as elements. These are captured separately in the "dims" section (trussL/trussW/trussH, plH, mkT, mkWalls). Tag ONLY visible decor items: florals, lighting, furniture, chandeliers, ceiling patterns, arches, props, wrought iron pieces, glass panels.\n5. LIGHTS — count EVERY individual light fixture you can see (chandeliers, LED panels, fairy-light runs, lamps, uplights, neon). Put the TOTAL number of lights in "lightCount" (0 if none). Never write vague counts; never omit lights.\n6. MISSING/UNSURE — if you see a decor item you cannot confidently match to the list, still add it to elements with "new":true AND add a short plain description to "unrecognized" so a human reviewer can add it to the system. Use [] if everything was identified.\n\nDimension estimation rules (in feet, estimate from visual cues like people height ~5.5ft, chairs ~3ft, standard ceiling ~10-12ft):\n- trussL: length of the main structure (front-to-back or stage width)\n- trussW: width/depth of the structure\n- trussH: height of the overhead structure/truss\n- floorL: floor area length (may be larger than truss if carpet/platform extends)\n- floorW: floor area width\n- plH: platform height — "4in" if slightly raised, "1ft" if clearly elevated stage, "" if ground level\n- mkT: masking material if visible behind/sides — "fabric","acrylic","flex","vinyl" or "" if none\n- mkWalls: which walls have masking — {"back":true/false,"left":true/false,"right":true/false}\n\nReturn ONLY JSON:\n{"name":"short descriptive name","tags":{"eventType":["..."],"venueType":["..."],"areasElements":["..."],"colorPalette":["..."],"categoryTier":["..."],"designStyle":["..."],"timeSetting":["..."]},"dims":{"trussL":24,"trussW":15,"trussH":12,"floorL":28,"floorW":18,"plH":"4in","mkT":"fabric","mkWalls":{"back":true,"left":false,"right":false}},"elements":[{"name":"Chandelier","qty":12,"unit":"pc","size":"M","detail":"crystal"},{"name":"Custom Drape Structure","qty":2,"unit":"pc","size":"","detail":"fabric","new":true}],"lightCount":24,"unrecognized":["large hanging floral ring"]}`;
    // Structured-outputs schema — the 7 tag fields are LOCKED to your exact taxonomy values (enums), so
    // Claude can never return an off-list or mis-cased tag (the root of photos not matching their zone).
    // Element names stay free text (the fuzzy match below maps them to the rate card / flags new items).
    const paletteVals = imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxonomy.colorPalette;
    // Lock to the taxonomy values; if a list is empty, fall back to a free string array (an empty
    // enum is an invalid schema and would 400 every request).
    const enumArr = (vals) => ({ type: "array", items: (Array.isArray(vals) && vals.length) ? { type: "string", enum: vals } : { type: "string" } });
    const tagSchema = {
      type: "object", additionalProperties: false,
      required: ["name", "tags", "dims", "elements", "lightCount", "unrecognized"],
      properties: {
        name: { type: "string" },
        lightCount: { type: "integer" },
        unrecognized: { type: "array", items: { type: "string" } },
        tags: {
          type: "object", additionalProperties: false,
          required: ["eventType", "venueType", "areasElements", "colorPalette", "categoryTier", "designStyle", "timeSetting"],
          properties: {
            eventType: enumArr(taxonomy.eventType), venueType: enumArr(taxonomy.venueType),
            areasElements: enumArr(taxonomy.areasElements), colorPalette: enumArr(paletteVals),
            categoryTier: enumArr(taxonomy.categoryTier), designStyle: enumArr(taxonomy.designStyle),
            timeSetting: enumArr(taxonomy.timeSetting),
          },
        },
        dims: {
          type: "object", additionalProperties: false,
          required: ["trussL", "trussW", "trussH", "floorL", "floorW", "plH", "mkT", "mkWalls"],
          properties: {
            trussL: { type: "number" }, trussW: { type: "number" }, trussH: { type: "number" },
            floorL: { type: "number" }, floorW: { type: "number" },
            plH: { type: "string" }, mkT: { type: "string", enum: ["fabric", "acrylic", "flex", "vinyl", ""] },
            mkWalls: { type: "object", additionalProperties: false, required: ["back", "left", "right"], properties: { back: { type: "boolean" }, left: { type: "boolean" }, right: { type: "boolean" } } },
          },
        },
        elements: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["name", "qty", "unit", "size", "detail", "new"],
            properties: { name: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, size: { type: "string", enum: ["S", "M", "B", ""] }, detail: { type: "string" }, new: { type: "boolean" } },
          },
        },
      },
    };
    const toBase64 = (imgUrl) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Image load timeout")), 10000);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        try {
          const c = document.createElement("canvas");
          const maxW = 1536; // higher res so Opus can read decor detail / count elements (was 800)
          const scale = img.width > maxW ? maxW / img.width : 1;
          c.width = img.width * scale;
          c.height = img.height * scale;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
        } catch (e) { reject(e); }
      };
      img.onerror = () => { clearTimeout(timer); reject(new Error("Image load failed")); };
      img.src = imgUrl;
    });
    // Returns { data, type } so the media_type sent to Claude matches the actual bytes
    // (sending PNG/WebP bytes labelled image/jpeg makes the API reject the request).
    const fetchBase64 = async (imgUrl) => {
      const resp = await fetch(imgUrl, { mode: "cors" });
      if (!resp.ok) throw new Error("Fetch failed: " + resp.status);
      const blob = await resp.blob();
      const type = /^image\/(jpeg|png|gif|webp)$/.test(blob.type) ? blob.type : "image/jpeg";
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ data: reader.result.split(",")[1], type });
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };
    try {
      let b64 = null, mediaType = "image/jpeg";
      if (url.startsWith("data:image")) {
        b64 = url.split(",")[1];
        const m = url.match(/^data:(image\/[a-z]+)/);
        if (m) mediaType = m[1];
        showMsg("Image loaded, analyzing...", "green");
      } else {
        // Prefer fetchBase64 (preserves real bytes + media type). Canvas re-encode (always
        // jpeg) is the fallback for hosts that block fetch CORS but allow <img> crossOrigin.
        try { const r = await fetchBase64(url); b64 = r.data; mediaType = r.type; showMsg("Image fetched, analyzing...", "green"); } catch (e1) {
          try { b64 = await toBase64(url); mediaType = "image/jpeg"; showMsg("Image loaded, analyzing...", "green"); } catch (e2) {
            showMsg("CORS blocked — trying direct URL...", "orange");
          }
        }
      }
      // Static content FIRST (knowledge base + house prompt + verified few-shot examples) so it's
      // cached and reused across every photo; the volatile target image goes LAST, after the cache
      // breakpoint, so it isn't part of the cached prefix.
      const imageBlock = b64
        ? { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } }
        : { type: "image", source: { type: "url", url } };
      const kbText = renderTagKBText(tagKB);
      const corrText = renderCorrectionsText(tagCorrections);
      // House rules first (highest authority), then human corrections to learn from, then the learned
      // knowledge base, then sub-category vocabulary, then the base instructions — all static, cached.
      const promptText = [houseRules, corrText, kbText, subcatText, prompt].filter(Boolean).join("\n\n");
      const exemplars = (tagKB && Array.isArray(tagKB.exemplars)) ? tagKB.exemplars.slice(0, 4).filter(e => e && e.url) : [];
      const buildContent = (withExamples) => {
        const blocks = [{ type: "text", text: promptText }];
        if (withExamples) exemplars.forEach((ex, i) => {
          blocks.push({ type: "image", source: { type: "url", url: ex.url } });
          const summ = `Verified example ${i + 1} — your team tagged the photo above as: area=${ex.area}`
            + (ex.event ? `, event=${ex.event}` : "") + (ex.style ? `, style=${ex.style}` : "")
            + (ex.palette ? `, palette=${ex.palette}` : "") + (ex.time ? `, time=${ex.time}` : "")
            + (ex.lights ? `, lights total=${ex.lights}` : "")
            + (ex.elements && ex.elements.length ? `, elements: ${ex.elements.join(", ")}` : "") + ".";
          blocks.push({ type: "text", text: summ });
        });
        blocks[blocks.length - 1].cache_control = { type: "ephemeral" }; // cache the whole static prefix
        return [...blocks, imageBlock];
      };
      const callTag = (content) => callClaudeStreaming({
        contentBlocks: content,
        model: "claude-opus-4-8",
        maxTokens: 8000, // room for adaptive thinking + the JSON
        system: "You are a wedding/event decor image tagger. Respond ONLY with valid JSON, no other text.",
        outputConfig: { format: { type: "json_schema", schema: tagSchema } },
        thinking: { type: "adaptive" },
      });
      aiTagBump(); // count this against the daily cap (we're about to call the API)
      let txt;
      try {
        txt = await callTag(buildContent(exemplars.length > 0));
      } catch (eEx) {
        // A bad/unreachable exemplar image URL shouldn't break tagging — retry once without examples.
        if (exemplars.length) txt = await callTag(buildContent(false)); else throw eEx;
      }
      if (!txt || !txt.trim()) { showMsg("AI returned empty response", "red"); return null; }
      const clean = txt.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (parsed.elements && rcItems.length) {
        const sizeHints = { heavy: "B", large: "B", big: "B", tall: "B", medium: "M", mid: "M", regular: "M", small: "S", mini: "S", light: "S", short: "S" };
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const stopWords = new Set(["the", "a", "an", "of", "for", "with", "and", "in", "on", "to", "custom", "special", "premium", "standard", "basic", "indian", "wedding", "event", "decor"]);
        const keywords = (s) => normalize(s).split(" ").filter(w => !stopWords.has(w) && w.length > 1);
        parsed.elements = parsed.elements.map(el => {
          const exact = rcItems.find(rc => normalize(rc.name) === normalize(el.name));
          if (exact) return { ...el, name: exact.name, unit: exact.unit, new: undefined };
          const elWords = normalize(el.name).split(" ");
          let sizeFromName = "";
          for (const w of elWords) { if (sizeHints[w]) { sizeFromName = sizeHints[w]; break; } }
          const elKw = keywords(el.name);
          let bestScore = 0, bestMatch = null;
          for (const rc of rcItems) {
            const rcKw = keywords(rc.name);
            const rcNorm = normalize(rc.name);
            const elNorm = normalize(el.name);
            if (elNorm.includes(rcNorm) || rcNorm.includes(elNorm)) { bestScore = 100; bestMatch = rc; break; }
            const overlap = elKw.filter(w => rcKw.some(rw => rw.includes(w) || w.includes(rw))).length;
            const score = overlap > 0 ? (overlap / Math.max(elKw.length, rcKw.length)) * 100 : 0;
            if (score > bestScore) { bestScore = score; bestMatch = rc; }
          }
          if (bestMatch && bestScore >= 40) {
            const size = sizeFromName || el.size || (bestMatch.inhouseMode === "smb" ? "M" : "");
            return { ...el, name: bestMatch.name, unit: bestMatch.unit, size, new: undefined };
          }
          return { ...el, new: true };
        });
        // Drop structural items (truss / floor-carpet / masking) from the element breakdown — they're
        // captured in the dedicated Zone-Dimensions/Masking sections, so listing them as elements too
        // double-counts cost AND double-blocks inventory.
        const structuralNames = new Set(rcItems.filter(i => STRUCTURAL_CATS.has(i.cat)).map(i => normalize(i.name)));
        const STRUCT_KW = /\b(box truss|single u truss|u truss|truss|carpet|wall mask|fabric mask|masking|flex print|vinyl print|acrylic panel|genset|platform|riser|flooring)\b/i;
        parsed.elements = parsed.elements.filter(el => !structuralNames.has(normalize(el.name)) && !STRUCT_KW.test(el.name || ""));
      }
      return parsed;
    } catch (e) { showMsg("Tag error: " + e.message, "red"); return null; }
  };

  // ── Pause / resume the 15-min batch tagger ────────────────────────────────────
  const toggleBatchTaggerPaused = useCallback(async () => {
    const next = !batchTaggerPaused;
    const meta = { paused: next, pausedBy: authUser?.name || "—", pausedAt: new Date().toISOString() };
    setBatchTaggerPaused(next);
    setBatchTaggerMeta(meta);
    const res = await kvSet(BATCH_TAGGER_PAUSED_SK, meta);
    if (res?.ok) showMsg(next ? "Batch tagger paused" : "Batch tagger resumed", "green");
    else showMsg("Failed to save batch tagger state: " + (res?.error || "unknown error"), "red");
  }, [batchTaggerPaused, authUser]);

  // ── Tag a specific selection of images (manual select in Library UI) ──────────
  // Same AI flow as runBulkTag but operates only on the caller-provided IDs.
  // Sets tagSource:"manual" so results appear in the Manual Tagged chip.
  const runTagSelected = useCallback(async (ids) => {
    if (!ids || !ids.length) return null;
    if (bulkTag.running) { showMsg("Tagging already running — stop it first.", "orange"); return null; }
    const idSet = new Set(ids);
    await ensureLibItems(ids); // selections come from the visible page, but fetch on the off chance one isn't cached
    const targets = (libItemsRef.current || []).filter(i => idSet.has(i.id));
    if (!targets.length) { showMsg("No matching images found.", "orange"); return null; }
    bulkTagStop.current = false;
    setBulkTag({ running: true, done: 0, total: targets.length, ok: 0, fail: 0, finishedAt: 0 });
    const patch = {};
    let ok = 0, fail = 0;
    const flush = () => { const rows = targets.filter(t => patch[t.id]).map(t => ({ ...t, ...patch[t.id] })); if (rows.length) saveLib(rows); };
    for (let n = 0; n < targets.length; n++) {
      if (bulkTagStop.current) break;
      const img = targets[n];
      try {
        const result = await Promise.race([aiTagImage(img.url), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30000))]);
        const upd = {};
        let gotTags = false;
        if (result) {
          const tagSrc = result.tags || result;
          if (tagSrc) { const t = { ...(img.tags || {}) }; let any = false; Object.keys(taxonomy).forEach(k => { if (Array.isArray(tagSrc[k]) && tagSrc[k].length) { t[k] = tagSrc[k]; any = true; } }); if (any) { upd.tags = t; gotTags = true; } }
          if (result.name && (!img.name || img.name.startsWith("img ") || img.name === "Untitled")) upd.name = result.name;
          if (Array.isArray(result.elements) && result.elements.length > 0) { upd.elements = result.elements; gotTags = true; }
          if (typeof result.lightCount === "number") upd.lightCount = result.lightCount;
          if (Array.isArray(result.unrecognized)) upd.unrecognized = result.unrecognized;
          if (result.tags && typeof result.tags === "object") upd._aiTags = result.tags;
          const d = result.dims || {};
          if (d.trussL || d.trussW || d.trussH || d.floorL || d.floorW) upd.dims = { ...(img.dims || {}), trussL: d.trussL || 0, trussW: d.trussW || 0, trussH: d.trussH || 0, floorL: d.floorL || 0, floorW: d.floorW || 0, plH: d.plH || img.dims?.plH || "", mkT: d.mkT || img.dims?.mkT || "", mkWalls: d.mkWalls || img.dims?.mkWalls || {} };
        }
        if (gotTags) { upd._aiTagged = true; upd._aiTaggedAt = Date.now(); upd.tagSource = "manual"; ok++; }
        else { upd._aiFailed = true; upd._aiFailedAt = Date.now(); fail++; }
        patch[img.id] = upd;
      } catch { patch[img.id] = { _aiFailed: true, _aiFailedAt: Date.now() }; fail++; }
      setBulkTag({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
      if ((n + 1) % 8 === 0) flush();
    }
    flush();
    const stopped = bulkTagStop.current;
    setBulkTag({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🤖 Done — ${ok} tagged, ${fail} failed. See Manual Tagged chip.`, "green");
    return { ok, fail };
  }, [bulkTag.running, aiTagImage, saveLib, showMsg, taxonomy, ensureLibItems]);

  // ── Soft-hold expiry sweeper ─────────────────────────────────────────────────
  // Runs every 5 minutes while the app is open. Expired soft holds are removed from
  // in-memory state AND deleted from the soft_holds DB table so other salesperson
  // sessions immediately see freed inventory. The draft in client_ledger is untouched.
  useEffect(() => {
    if (!authUser) return;
    const sweep = () => {
      const now = Date.now();
      setSoftHolds(prev => {
        const expiredIds = Object.entries(prev)
          .filter(([, h]) => { const exp = typeof h.expiry === "number" ? h.expiry : Date.parse(h.expiry || ""); return !exp || exp <= now; })
          .map(([id]) => id);
        if (!expiredIds.length) return prev;
        const next = { ...prev };
        expiredIds.forEach(id => delete next[id]);
        for (const id of expiredIds) supabase.from("soft_holds").delete().eq("id", id).then(() => {});
        return next;
      });
    };
    sweep();
    const id = setInterval(sweep, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [authUser]);

  // ── App-wide background bulk AI tagging ─────────────────────────────────────
  // Tags every untagged library photo. Lives at the app root so it keeps running while you move
  // between Studio screens, with a global progress pill + a completion toast. Results merge into
  // the LATEST library by id (only the untagged photos), so parallel edits elsewhere aren't lost.
  // Checkpoints every 8 photos; stoppable; resumable (skips already-tagged on the next run).
  const stopBulkTag = useCallback(() => { bulkTagStop.current = true; }, []);
  const runBulkTag = useCallback(async () => {
    // Server-side status='untagged' query (indexed column, migration 008) instead of scanning the
    // whole in-memory library — bounded per run; resumable (skips already-tagged on the next run).
    const targets = await fetchUntaggedLibraryTargets();
    mergeLibItems(targets);
    if (!targets.length) { showMsg("Nothing to tag — every photo is already AI-tagged or verified.", "green"); return null; }
    bulkTagStop.current = false;
    setBulkTag({ running: true, done: 0, total: targets.length, ok: 0, fail: 0, finishedAt: 0 });
    const patch = {}; // id -> changed fields only
    let ok = 0, fail = 0;
    const flush = () => { const rows = targets.filter(t => patch[t.id]).map(t => ({ ...t, ...patch[t.id] })); if (rows.length) saveLib(rows); };
    for (let n = 0; n < targets.length; n++) {
      if (bulkTagStop.current) break;
      if (aiTagCountToday() >= AI_TAG_DAILY_LIMIT) { showMsg(`Daily AI-tagging limit reached (${AI_TAG_DAILY_LIMIT}/day during testing) — stopped.`, "orange"); break; }
      const img = targets[n];
      try {
        const result = await Promise.race([aiTagImage(img.url), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30000))]);
        const upd = {};
        let gotTags = false; // did the AI actually return usable tags/elements?
        if (result) {
          const tagSrc = result.tags || result;
          if (tagSrc) { const t = { ...(img.tags || {}) }; let any = false; Object.keys(taxonomy).forEach(k => { if (Array.isArray(tagSrc[k]) && tagSrc[k].length) { t[k] = tagSrc[k]; any = true; } }); if (any) { upd.tags = t; gotTags = true; } }
          if (result.name && (!img.name || img.name.startsWith("img ") || img.name === "Untitled")) upd.name = result.name;
          if (Array.isArray(result.elements) && result.elements.length > 0) { upd.elements = result.elements; gotTags = true; }
          if (typeof result.lightCount === "number") upd.lightCount = result.lightCount;
          if (Array.isArray(result.unrecognized)) upd.unrecognized = result.unrecognized;
          if (result.tags && typeof result.tags === "object") upd._aiTags = result.tags; // snapshot for the corrections diff at review time
          const d = result.dims || {};
          if (d.trussL || d.trussW || d.trussH || d.floorL || d.floorW) upd.dims = { ...(img.dims || {}), trussL: d.trussL || 0, trussW: d.trussW || 0, trussH: d.trussH || 0, floorL: d.floorL || 0, floorW: d.floorW || 0, plH: d.plH || img.dims?.plH || "", mkT: d.mkT || img.dims?.mkT || "", mkWalls: d.mkWalls || img.dims?.mkWalls || {} };
        }
        // Only mark "AI-tagged" when we actually got tags — a failed/empty pass (e.g. credits out)
        // stays untagged so it's retried on the next run instead of looking done-but-blank.
        if (gotTags) { upd._aiTagged = true; upd._aiTaggedAt = Date.now(); upd.tagSource = "manual"; ok++; }
        else { upd._aiFailed = true; upd._aiFailedAt = Date.now(); fail++; }
        patch[img.id] = upd;
      } catch { patch[img.id] = { _aiFailed: true, _aiFailedAt: Date.now() }; fail++; }
      setBulkTag({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
      if ((n + 1) % 8 === 0) flush();
    }
    flush();
    const stopped = bulkTagStop.current;
    setBulkTag({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🤖 AI tagging ${stopped ? "stopped" : "complete"} — ${ok} tagged, ${fail} failed/empty. Review them in Library → Needs review.`, "green");
    return { ok, fail };
  }, [aiTagImage, saveLib, showMsg, taxonomy, mergeLibItems]);

  // ── Recursive Cloudinary folder import ──────────────────────────────────────
  // Pulls EVERY image under a folder prefix (all subfolders, paginated) into the library,
  // deduped by URL so re-importing the same folder is safe (already-added photos are skipped —
  // no duplicates). Stamps each with the event (folder) name + best-effort zone from filename.
  const importCloudinaryFolder = useCallback(async (prefix) => {
    const eventName = (String(prefix || "").split("/").pop() || "Event");
    const zones = taxonomy.areasElements || [];
    const KW = { stage: "Stage", entry: "Entry Passage", passage: "Entry Passage", vedi: "Vedi", mandap: "Vedi", lounge: "Centre Lounge", "side lounge": "Side Lounge", photobooth: "Photobooth", "photo booth": "Photobooth", centrepiece: "Centre Pieces", "centre piece": "Centre Pieces", "center piece": "Centre Pieces", prop: "Props", install: "Installations" };
    const detectZone = (f) => { const s = f.toLowerCase(); let z = zones.find(zn => s.includes(zn.toLowerCase())); if (z) return z; for (const [k, zn] of Object.entries(KW)) { if (s.includes(k) && zones.includes(zn)) return zn; } return ""; };
    const seen = new Set();           // secure_urls collected this run (dedupe within this scan)
    let scanned = 0;
    let fresh = [];
    const take = (res) => { (res || []).forEach(r => {
      if (!r.secure_url || r.resource_type === "video") return;
      scanned++;
      if (seen.has(r.secure_url)) return;
      seen.add(r.secure_url); fresh.push(r);
    }); };
    try {
      // 1) Walk the whole folder TREE under the prefix (asset-folder based — matches the Media
      //    Library you see in the Cloudinary console, which the old public_id prefix missed).
      const folders = [prefix];
      const queue = [prefix];
      let guard = 0;
      while (queue.length && guard++ < 500) {
        const f = queue.shift();
        try {
          const fd = await cldAdmin("folders", { path: f });
          (fd.folders || []).forEach(sub => { const full = sub.path || `${f}/${sub.name}`; if (!folders.includes(full)) { folders.push(full); queue.push(full); } });
        } catch { /* skip unreadable folder */ }
      }
      // 2) List each folder by asset-folder, paginated.
      for (let fi = 0; fi < folders.length; fi++) {
        let cursor = "";
        for (let pg = 0; pg < 40; pg++) {
          const d = await cldAdmin("list_by_folder", { asset_folder: folders[fi], max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) });
          take(d.resources);
          if (!d.next_cursor) break;
          cursor = d.next_cursor;
        }
        if (fi % 4 === 0) showMsg(`Scanning "${eventName}" — ${folders.length} folders, ${fresh.length} new so far…`, "blue");
      }
      // 3) Also page the public_id prefix (catches any fixed-mode assets not under an asset folder).
      let pc = "";
      for (let pg = 0; pg < 60; pg++) {
        const d = await cldAdmin("list", { prefix, max_results: 500, ...(pc ? { next_cursor: pc } : {}) });
        take(d.resources);
        if (!d.next_cursor) break;
        pc = d.next_cursor;
      }
    } catch (e) { showMsg("Folder import failed: " + (e.message || "Cloudinary error"), "red"); return null; }
    // Batched server existence check (not a full-table scan) drops URLs already in the Library.
    try { const existing = await checkExistingLibraryUrls(fresh.map(r => r.secure_url)); fresh = fresh.filter(r => !existing.has(r.secure_url)); } catch { /* best-effort; worst case a dupe slips through */ }
    const skipped = scanned - fresh.length;
    if (!fresh.length) { showMsg(`Nothing new — all photo(s) under "${eventName}" are already in the Library.`, "orange"); return { added: 0, skipped, scanned, eventName }; }
    const stamp = Date.now().toString(36);
    const newImgs = fresh.map((r, ix) => {
      const fname = (r.public_id || "").split("/").pop().replace(/[-_]/g, " ");
      const zone = detectZone(fname);
      return { id: "LIB" + stamp + ix.toString(36) + Math.random().toString(36).slice(2, 4), url: r.secure_url, name: fname, tags: { eventType: [], venueType: [], venue: "", areasElements: zone ? [zone] : [], colorPalette: [], categoryTier: [], designStyle: [], timeSetting: [] }, elements: [], addedAt: Date.now(), source: "folder-import", _event: eventName };
    });
    saveLib(newImgs);
    showMsg(`✓ Imported ${newImgs.length} new photo(s) from "${eventName}" (whole folder tree)${skipped ? ` · skipped ${skipped} already in library` : ""}. Run "Tag all untagged" to AI-tag them.`, "green");
    return { added: newImgs.length, skipped, scanned, eventName };
  }, [cldAdmin, saveLib, showMsg, taxonomy]);

  // ── Zone upload (Cloudinary → AI tag → review) — VERBATIM ──
  const handleZoneUpload = async (elKey, file) => {
    if (!file || zoneUploading) return;
    setZoneUploading(elKey);
    showMsg("📷 Uploading to Cloudinary...", "blue");
    try {
      // Migration: the reference signed uploads via /api/cloudinary. This SPA has no server,
      // so we use Cloudinary's unsigned upload preset (client-side, safe) — same as IMS.
      const compressed = await compressImageForCloudinary(file);
      const fd = new FormData();
      fd.append("file", compressed);
      fd.append("upload_preset", IMS_CLD_PRESET);
      fd.append("folder", "client-uploads");
      const upRes = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
      const upData = await upRes.json();
      if (upData.error) { showMsg("Upload failed: " + (upData.error.message || upData.error), "red"); setZoneUploading(null); return; }
      const cldUrl = upData.secure_url || upData.url;
      showMsg("✓ Uploaded! Running AI analysis...", "green");
      let aiResult = null;
      try { aiResult = await Promise.race([aiTagImage(cldUrl), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 25000))]); } catch (e) { showMsg("AI tagging skipped — edit manually", "red"); }
      setZoneUploadReview({
        elKey, url: cldUrl,
        name: aiResult?.name || file.name?.replace(/\.[^.]+$/, "") || "Client Upload",
        tags: aiResult?.tags || { eventType: [], venueType: [], areasElements: [], colorPalette: [], categoryTier: [], designStyle: [], timeSetting: [] },
        elements: aiResult?.elements || [],
        dims: aiResult?.dims || {},
      });
      showMsg("✓ AI done — review & edit before applying", "green");
    } catch (e) { showMsg("Upload failed: " + e.message, "red"); }
    setZoneUploading(null);
  };

  // ── Select element photo → load pricing — VERBATIM ──
  const selectElPhoto = (elKey, photo) => {
    const currentSel = elSelectedPhoto[elKey];
    if (currentSel && currentSel.src === photo.src) {
      setElSelectedPhoto(p => { const n = { ...p }; delete n[elKey]; return n; });
      setZoneElements(p => { const n = { ...p }; delete n[elKey]; return n; });
      return;
    }
    setElSelectedPhoto(p => ({ ...p, [elKey]: photo }));
    if (photo.isLibrary && (photo.elements || []).length > 0) {
      setZoneElements(p => ({ ...p, [elKey]: JSON.parse(JSON.stringify(photo.elements)) }));
    } else {
      setZoneElements(p => ({ ...p, [elKey]: [] }));
    }
    const libImg = photo.isLibrary ? libItems.find(i => i.url === photo.src || i.id === photo.eventId) : null;
    const photoDims = photo.dims || libImg?.dims || {};
    const cfg = buildZoneConfig(elKey, photoDims);
    if (cfg) {
      const evZone = (photo.zones || []).find(z => z.type === elKey);
      if (evZone?.config) {
        cfg.trT = evZone.config.trT || cfg.trT;
        cfg.mkOn = evZone.config.mkOn ?? cfg.mkOn;
        cfg.mkT = evZone.config.mkT || cfg.mkT;
        cfg.mkWalls = evZone.config.mkWalls || cfg.mkWalls;
        cfg.plH = evZone.config.plH || cfg.plH;
        cfg.cpT = evZone.config.cpT || cfg.cpT;
      }
      setZoneConfig(p => ({ ...p, [elKey]: cfg }));
    }
    setActiveZones([]);
    setCustomMode(p => ({ ...p, [elKey]: false }));
  };

  // ── Cost-sheet zone builder + combined data — VERBATIM ──
  const buildZonesForFn = useCallback((fnData) => {
    if (!fnData) return [];
    const fEnabledEls = fnData.enabledEls || {};
    const fZoneElements = fnData.zoneElements || {};
    const fZoneConfig = fnData.zoneConfig || {};
    const fElSelectedPhoto = fnData.elSelectedPhoto || {};
    const fElNotes = fnData.elNotes || {};
    const fCustomZones = fnData.customZones || [];
    const fElTiers = fnData.elTiers || {};
    const fFloralRatio = typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70;
    return Object.entries(fEnabledEls).filter(([_, on]) => on).map(([k]) => {
      const el = zoneLabelsD[k] || fCustomZones.find(cz => cz.id === k) || { label: k, icon: "📦" };
      const t = fElTiers[k] || "simple";
      const ze = fZoneElements[k];
      let items = [];
      if (ze && ze.length > 0) {
        ze.forEach(el2 => {
          const priceInfo = getElPriceForFn(el2, fZoneConfig[k], fFloralRatio);
          const rc = priceInfo.rc;
          const up = priceInfo.unitPrice;
          const lt = priceInfo.lineCost;
          if (lt > 0) items.push({ name: el2.name, size: el2.size || "", qty: el2.qty || 0, unit: el2.unit || "pc", rate: up, total: lt, isFloral: rc && (rc.cat || "").toLowerCase() === "florals" });
          if (el2.qty > 0) {
            const imsInv = dealCheckData?.inventory || [];
            const invItem = imsInv.find(i => i.name === el2.name);
            const baseColour = invItem?.baseColour || "Ivory";
            const paintCost = invItem?.paintCost
              ? invItem.paintCost
              : maxRepaintCostInSubcat(rc?.sub, imsInv, imsDefaultPaintCost ?? 400);
            const allocs = normalizePaintAllocation(el2, baseColour);
            allocs.forEach(a => {
              const subTotal = paintCost * a.qty;
              if (subTotal > 0) {
                items.push({
                  name: `🖌 Paint: ${el2.name} (${baseColour} → ${a.colour})`,
                  size: "",
                  qty: a.qty,
                  unit: "item",
                  rate: paintCost,
                  total: subTotal,
                  isPaint: true
                });
              }
            });
          }
        });
      }
      const zl = fZoneConfig[k] ? calcStructCost(k, fZoneConfig[k]) : { truss: 0, masking: 0, platform: 0, carpet: 0, total: 0, arches: 0, pillars: 0, glass: 0 };
      const structItems = [];
      const zc = fZoneConfig[k] || {};
      const zm = zoneMeta[k];
      const dims = zc.dims || {};
      const dimLabel = zm ? ["L", "W", "H"].map(d => `${dims[d] || 0}ft`).join(" × ") : "";
      if (zl.truss > 0) structItems.push({ name: "Truss (" + (zc.trT === "box" ? "Box ₹50" : "Single U ₹30") + "/sqft)" + (zc.trT === "box" && (Number(zc.trussFrontExt) || 0) > 0 ? ` + 2× Single-U front ext ${zc.trussFrontExt}×${Number(zc.trussFrontExtH) || dims.H || 0}ft` : "") + ((zc.trussQty || 1) > 1 ? " ×" + zc.trussQty : ""), total: zl.truss });
      if (zl.masking > 0) structItems.push({ name: "Wall Masking — " + (zc.mkT || "fabric") + " (" + (zc.mkS || 1) + " side" + ((zc.mkS || 1) > 1 ? "s" : "") + ")", total: zl.masking });
      if (zl.platform > 0) structItems.push({ name: "Platform (" + (zc.plH === "4in" ? "4 inch" : zc.plH === "1ft" ? "1ft–3ft" : zc.plH || "") + ")", total: zl.platform });
      if (zl.carpet > 0) structItems.push({ name: "Carpet (" + (zc.cpT === "new" ? "New ₹15" : "Old ₹7") + "/sqft)", total: zl.carpet });
      if (zl.arches > 0) structItems.push({ name: "Arches (" + (zc.archT || "").toUpperCase() + " ×" + (zc.archQty || 0) + ")", total: zl.arches });
      if (zl.pillars > 0) structItems.push({ name: "Pillars (×" + (zc.pillarQty || 0) + ")", total: zl.pillars });
      if (zl.glass > 0) structItems.push({ name: "Glass (" + (zc.glassT || "").toUpperCase() + " ×" + (zc.glassQty || 0) + ")", total: zl.glass });
      dcCustomItems.filter(c => c.fnIdx === fnData.fnIdx && c.zoneKey === k).forEach(ci => {
        const isP = ci.type === "production";
        const unitCost = ci.manualPrice || ci.refPrice || 0;
        const lineCost = unitCost * (Number(ci.qty) || 1);
        if (lineCost > 0) items.push({ name: (isP ? "🏭 " : "🛒 ") + (ci.subCat || ci.cat || "Custom"), size: "", qty: Number(ci.qty) || 1, unit: "pc", rate: unitCost, total: lineCost, isCustom: true, customType: ci.type });
      });
      const ic = items.reduce((s, i) => s + i.total, 0);
      return { k, label: el.label, icon: el.icon, tier: t, items, structItems, structTotal: zl.total, itemTotal: ic, zoneTotal: ic + zl.total, note: fElNotes[k] || "", dims, dimLabel, photo: fElSelectedPhoto[k]?.src || null, photoName: fElSelectedPhoto[k]?.eventName || "" };
    }).filter(z => z.items.length > 0 || z.structItems.length > 0);
  }, [getElPriceForFn, zoneLabelsD, zoneMeta, dealCheckData, imsDefaultPaintCost, dcCustomItems]);

  const buildCombinedCostSheetData = useCallback(() => {
    const all = collectAllFunctionData();
    const ac = clientLedger.find(c => c.id === activeClientId);
    const clientSessions = (ac?.sessions) || [];
    const isThin = (fnData) => {
      const zeKeys = Object.keys(fnData.zoneElements || {}).filter(k => (fnData.zoneElements[k] || []).length > 0);
      const phKeys = Object.keys(fnData.elSelectedPhoto || {}).filter(k => fnData.elSelectedPhoto[k]?.src);
      return zeKeys.length === 0 && phKeys.length === 0;
    };
    const enrichFromSession = (fnData) => {
      if (fnData.fnIdx === activeFnIdx) return fnData;
      if (!isThin(fnData)) return fnData;
      const target = (fnData.fnType || "").toLowerCase().trim();
      if (!target) return fnData;
      const match = clientSessions.find(s => (s.fn || "").toLowerCase().trim() === target);
      if (!match) return fnData;
      return {
        ...fnData,
        enabledEls: match.enabledEls || fnData.enabledEls,
        zoneConfig: match.zoneConfig || fnData.zoneConfig,
        zoneElements: match.zoneElements || fnData.zoneElements,
        elSelectedPhoto: match.elSelectedPhoto || fnData.elSelectedPhoto,
        elNotes: match.elNotes || fnData.elNotes,
        elTiers: match.elTiers || fnData.elTiers,
        floralRatio: typeof match.floralRatio === "number" ? match.floralRatio : fnData.floralRatio
      };
    };
    const sorted = [...all].sort((a, b) => {
      const da = a.fnDate || "9999-12-31";
      const db = b.fnDate || "9999-12-31";
      return da.localeCompare(db);
    });
    const functions = sorted.map(fnDataRaw => {
      const fnData = enrichFromSession(fnDataRaw);
      const zones = buildZonesForFn(fnData);
      const bd = calcFunctionBreakdown(fnData);
      return {
        fnIdx: fnData.fnIdx,
        fnType: fnData.fnType,
        fnDate: fnData.fnDate,
        fnVenue: fnData.fnVenue,
        fnShift: fnData.fnShift,
        fnPax: fnData.fnPax,
        zones,
        transport: bd.transport,
        decorTotal: bd.decorTotal,
        transportTotal: bd.transportTotal,
        grand: bd.grand,
        isEmpty: zones.length === 0
      };
    });
    const eventGT = functions.reduce((s, f) => s + (f.grand || 0), 0);
    return {
      functions,
      eventGrandTotal: eventGT,
      clientName, clientPhone, clientBrideGroom
    };
  }, [collectAllFunctionData, buildZonesForFn, calcFunctionBreakdown, clientName, clientPhone, clientBrideGroom, clientLedger, activeClientId, activeFnIdx]);

  // ═══════════════════════════════════════════════════════════════
  // DEAL CHECK orchestration — IMS fetch (Supabase) + AI photo-match loop +
  // subcat-scoped Generate engine + truss soft-hold bridge writes. VERBATIM ports
  // (Redis→Supabase rewires are the only adaptations).
  // ═══════════════════════════════════════════════════════════════

  // ═══ DEAL CHECK REBUILD — saved-session migration (§7.9.8 Option A · Patch 7) ═══
  // Restore the saved draft ONCE per open. This effect lists clientLedger as a dep so it can wait
  // for the ledger to load, but it must NOT re-restore on every subsequent ledger change (realtime
  // echo / the deal-check auto-save) — doing so clobbered in-progress kit/card edits ~1s after
  // typing (the reported "number snaps back" bug). The ref makes it fire once per (client × open).
  const dcRestoredRef = useRef(null);
  useEffect(() => {
    if (!dcFullPageOpen) { dcRestoredRef.current = null; return; }
    const cli = clientLedger.find(c => c.id === activeClientId);
    if (!cli) return;
    if (dcRestoredRef.current === activeClientId) return; // already restored this open — keep live edits
    dcRestoredRef.current = activeClientId;
    const saved = cli.dcCards;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      let isNewShape = false;
      for (const fi of Object.keys(saved)) {
        const inner = saved[fi];
        if (!inner || typeof inner !== "object") continue;
        const sampleKey = Object.keys(inner)[0];
        if (sampleKey && (sampleKey.startsWith("el::") || sampleKey.startsWith("fl::"))) { isNewShape = true; break; }
      }
      if (isNewShape) setDcCards(saved);
    }
    if (cli.dcZoneState && typeof cli.dcZoneState === "object" && !Array.isArray(cli.dcZoneState)) {
      setDcZoneState(cli.dcZoneState);
    }
    if (cli.dcKitEdits && typeof cli.dcKitEdits === "object" && !Array.isArray(cli.dcKitEdits)) {
      setDcKitEdits(cli.dcKitEdits);
    }
    if (cli.dcCarpetPick && typeof cli.dcCarpetPick === "object" && !Array.isArray(cli.dcCarpetPick)) {
      setDcCarpetPick(cli.dcCarpetPick);
    }
    if (cli.dcMpOverrides && typeof cli.dcMpOverrides === "object") setDcMpOverrides(cli.dcMpOverrides);
    if (cli.dcMpWinCount && typeof cli.dcMpWinCount === "object") setDcMpWinCount(cli.dcMpWinCount);
    if (typeof cli.dcMpIncludeMinusOne === "boolean") setDcMpIncludeMinusOne(cli.dcMpIncludeMinusOne);
    if (typeof cli.dcMpIncludeDismantle === "boolean") setDcMpIncludeDismantle(cli.dcMpIncludeDismantle);
  }, [dcFullPageOpen, activeClientId, clientLedger]);

  // ═══ Part 3 — write Studio truss soft-holds into the truss_allocations TABLE ═══
  // Merges Studio's soft event into each date's existing events[], dropping any prior
  // soft entry for the same eoId (soft-<clientId>) and PRESERVING IMS hard events.
  // Row shape: { date, events:[...], pool:{...rest} } — matches IMS rowToAlloc/allocToRow.
  const writeStudioTrussSoftHolds = useCallback(async (allocByDate) => {
    for (const [date, entry] of Object.entries(allocByDate || {})) {
      if (!entry) continue;
      try {
        // Read the existing row first (do NOT clobber IMS hard events).
        const { data: rows } = await supabase.from("truss_allocations").select("*").eq("date", date).maybeSingle();
        const existingEvents = Array.isArray(rows?.events) ? rows.events : [];
        const pool = rows?.pool || {};
        // Drop any prior entry for this client's soft hold (idempotent re-Generate).
        const filtered = existingEvents.filter(ev => !(ev?.eoId === entry.eoId && ev?.state === "soft"));
        filtered.push(entry);
        const row = { date, events: filtered, pool };
        await supabase.from("truss_allocations").upsert(row, { onConflict: "date" });
      } catch (e) {
        console.warn("[tier23-p3] writeStudioTrussSoftHolds failed for", date, e?.message || e);
      }
    }
  }, []);

  // On-demand IMS availability for the Build-view per-element stock browser: fetch inventory + one date's
  // blocks, cached per date. free = owned − blocked (getStudioAvailable). Lets the Build modal show live
  // availability without opening Deal Check.
  const availCacheRef = useRef({});
  const loadAvailability = useCallback(async (date) => {
    if (!date) return { inventory: [], blocksForDate: {} };
    if (availCacheRef.current[date]) return availCacheRef.current[date];
    const res = await fetchIMSData(date);
    const val = (res && Array.isArray(res.inventory)) ? res : { inventory: [], blocksForDate: {} };
    availCacheRef.current[date] = val;
    return val;
  }, []);

  // ═══ DEAL CHECK — open handler (fetches IMS data on demand from Supabase) ═══
  const openDealCheck = useCallback(async () => {
    setDealCheckLoading(true);
    setDealCheckError(null);
    setDealCheckData(null);
    // ═══ Cache restore — restore cached DC state BEFORE state resets ═══
    // Prefer the DURABLE per-client draft stored on the client_ledger row (a real table row now —
    // clobber-safe), so reopening always shows the last saved state. NOTE: we deliberately do NOT
    // fall back to the legacy whole-blob dc-cache — it's no longer network-persisted, so on a hard
    // refresh it can be stale/empty and would clobber the saved draft (the row is the source of truth).
    const clientRec = activeClientId ? (clientLedger || []).find(c => c.id === activeClientId) : null;
    const rowDraft = (clientRec?.dcDraft && typeof clientRec.dcDraft === "object" && !Array.isArray(clientRec.dcDraft)) ? clientRec.dcDraft : null;
    const cachedForThisClient = rowDraft;
    const hasCache = !!cachedForThisClient;
    if (hasCache) {
      setDcResolved(cachedForThisClient.resolved || {});
      // Guard: never clobber a good card set with an empty one (belt-and-suspenders vs a race).
      if (cachedForThisClient.cards && Object.keys(cachedForThisClient.cards).length) setDcCards(cachedForThisClient.cards);
      setDcZoneState(cachedForThisClient.zoneState || {});
      setDcPhotoOverrides(cachedForThisClient.photoOverrides || {});
      setDcSkipped(cachedForThisClient.skipped || {});
      setDcManualItems(Array.isArray(cachedForThisClient.manualItems) ? cachedForThisClient.manualItems : []);
      setDcDedupOverrides(cachedForThisClient.dedupOverrides || {});
      setDcProductionAccepted(cachedForThisClient.productionAccepted || {});
      setDcArtFlowerAlloc(cachedForThisClient.artFlowerAlloc || {});
      setDcFloralColorPrefs(cachedForThisClient.floralColorPrefs || {});
      if (dcCustomItems.length === 0 && Array.isArray(cachedForThisClient.customItems) && cachedForThisClient.customItems.length > 0) {
        setDcCustomItems(cachedForThisClient.customItems);
      }
    } else {
      setDcResolved({});
    }
    setDcResolving({});
    const allFns = collectAllFunctionData();
    const uniqueDates = [...new Set(allFns.map(f => f.fnDate).filter(Boolean))];
    if (uniqueDates.length === 0) {
      setDealCheckError("Event date required — add a date to at least one function first");
      setDealCheckLoading(false);
      return;
    }
    const ac = new AbortController();
    setDcAbortRef(ac);
    try {
      // Fetch IMS inventory + per-date blocks via the Supabase-backed fetchIMSData.
      // Settings (one fetch), vendors + truss inventory from their tables, in parallel.
      const [invResults, settingsRows, vendorRows, trussInvRows] = await Promise.all([
        Promise.all(uniqueDates.map(d => fetchIMSData(d))),
        supabase.from("settings").select("key,value").then(r => r.data || []).catch(() => []),
        fetchAll("vendors").catch(() => []),
        fetchAll("truss_inventory").catch(() => []),
      ]);
      if (invResults.some(r => r === null) || invResults[0] === null) {
        setDealCheckError("IMS unavailable — inventory check offline. Close and retry, or proceed with SOLD without inventory verification.");
        setDealCheckLoading(false);
        setDcAbortRef(null);
        return;
      }
      // Single inventory (shared), per-date blocks
      const inventory = invResults[0].inventory || [];
      // Populate the card-render lookup cache on OPEN too (not only on Generate) — otherwise a
      // restored draft's cards have imsIds but can't resolve to items, so every card wrongly shows
      // "No IMS match" after a refresh. (Root cause of the recurring load bug.)
      setDcInventoryCache(inventory);
      const blocksByDate = {};
      uniqueDates.forEach((d, i) => { blocksByDate[d] = invResults[i]?.blocksForDate || {}; });
      // Reduce settings rows → object s (EXACT key/field names the reference uses)
      const s = {};
      (settingsRows || []).forEach(r => {
        let v = r?.value;
        for (let i = 0; i < 2; i++) { if (typeof v === "string") { try { v = JSON.parse(v); } catch { break; } } }
        s[r.key] = v;
      });
      // Defaults mirroring the reference
      let mandiPriceMultipliers = { heavy_saya:1.4, competition:1.0, non_saya:0.85 };
      let eventTypeMultipliers = { outdoor_premium:1.5, outdoor_budgeted:1.0, inhouse:0.75 };
      let eventTimingMultipliers = { brunch:1.3, lunch:1.15, sundowner:1.05, dinner:1.0, latenight:1.0 };
      const flowerPatterns = Array.isArray(s.flowerPatterns) ? s.flowerPatterns : [];
      const mandiCatalogue = Array.isArray(s.mandiCatalogue) ? s.mandiCatalogue : [];
      if (s.mandiPriceMultipliers) mandiPriceMultipliers = s.mandiPriceMultipliers;
      const seasonMap = (s.seasonMap && typeof s.seasonMap === "object") ? s.seasonMap : {};
      const electricianProductivity = (s.electricianProductivity && typeof s.electricianProductivity === "object") ? s.electricianProductivity : {};
      const artificialMixRatePerKg = typeof s.artificialMixRatePerKg === "number" ? s.artificialMixRatePerKg : 0;
      const artificialFlowerRatePerKg = typeof s.artificialFlowerRatePerKg === "number" ? s.artificialFlowerRatePerKg : 50;
      const artificialFlowerBunchesPerKg = (typeof s.artificialFlowerBunchesPerKg === "number" && s.artificialFlowerBunchesPerKg > 0) ? s.artificialFlowerBunchesPerKg : 16;
      const artificialGreenRatePerKg = typeof s.artificialGreenRatePerKg === "number" ? s.artificialGreenRatePerKg : 40;
      const artificialGreenBunchesPerKg = (typeof s.artificialGreenBunchesPerKg === "number" && s.artificialGreenBunchesPerKg > 0) ? s.artificialGreenBunchesPerKg : 23;
      const flowerRecipeSubcats = (Array.isArray(s.flowerRecipeSubcats) && s.flowerRecipeSubcats.length > 0) ? s.flowerRecipeSubcats : ["Flower Pattern"];
      const dihariSchemes = (s.dihariSchemes && typeof s.dihariSchemes === "object") ? s.dihariSchemes : {};
      const defaultWindowsByPhase = (s.defaultWindowsByPhase && typeof s.defaultWindowsByPhase === "object") ? s.defaultWindowsByPhase : {};
      const labourTiers = (s.labourTiers && typeof s.labourTiers === "object") ? s.labourTiers : {};
      const venueMinLabour = (s.venueMinLabour && typeof s.venueMinLabour === "object") ? s.venueMinLabour : {};
      const defaultMinLabour = typeof s.defaultMinLabour === "number" ? s.defaultMinLabour : 4;
      if (s.eventTypeMultipliers && typeof s.eventTypeMultipliers === "object") eventTypeMultipliers = s.eventTypeMultipliers;
      if (s.eventTimingMultipliers && typeof s.eventTimingMultipliers === "object") eventTimingMultipliers = s.eventTimingMultipliers;
      const sayaMultiplier = typeof s.sayaMultiplier === "number" ? s.sayaMultiplier : 1.3;
      const heavyElementRanges = Array.isArray(s.heavyElementRanges) ? s.heavyElementRanges : [];
      const fabricBangaliRanges = Array.isArray(s.fabricBangaliRanges) ? s.fabricBangaliRanges : [];
      const trussLabourRanges = Array.isArray(s.trussLabourRanges) ? s.trussLabourRanges : [];
      const fabricRftPerWorker = (typeof s.fabricRftPerWorker === "number" && s.fabricRftPerWorker > 0) ? s.fabricRftPerWorker : 100;
      const colourCatalogue = Array.isArray(s.colourCatalogue) ? s.colourCatalogue : [];
      const paletteCatalogue = Array.isArray(s.paletteCatalogue) ? s.paletteCatalogue : [];
      const paintableCategories = Array.isArray(s.paintableCategories) ? s.paintableCategories : [];
      const defaultPaintCostPerItem = typeof s.defaultPaintCostPerItem === "number" ? s.defaultPaintCostPerItem : 400;
      const carpetFreshMarkup = typeof s.carpetFreshMarkup === "number" ? s.carpetFreshMarkup : 40;
      // Vendors (manpower avg-rate forecast) — match IMS rowToVendor shape (type/name from columns).
      const vendors = Array.isArray(vendorRows)
        ? vendorRows.map(v => ({ ...(v?.data || {}), id: v?.id, name: v?.name ?? v?.data?.name, type: v?.type ?? v?.data?.type }))
        : [];
      // Truss inventory — row with key === "main", use its .data
      let trussInv = null;
      const trussMain = Array.isArray(trussInvRows) ? trussInvRows.find(r => r.key === "main") : null;
      let tv = trussMain?.data;
      for (let i = 0; i < 2; i++) { if (typeof tv === "string") { try { tv = JSON.parse(tv); } catch {} } }
      if (tv && typeof tv === "object" && tv.pillars) trussInv = tv;

      setDealCheckData({ inventory, blocksByDate, fetchedDates: uniqueDates, flowerPatterns, mandiCatalogue, mandiPriceMultipliers, seasonMap, electricianProductivity, artificialMixRatePerKg, artificialFlowerRatePerKg, artificialFlowerBunchesPerKg, artificialGreenRatePerKg, artificialGreenBunchesPerKg, flowerRecipeSubcats, dihariSchemes, defaultWindowsByPhase, labourTiers, venueMinLabour, defaultMinLabour, eventTypeMultipliers, eventTimingMultipliers, sayaMultiplier, heavyElementRanges, fabricBangaliRanges, trussLabourRanges, fabricRftPerWorker, vendors, trussInv, colourCatalogue, paletteCatalogue, paintableCategories, defaultPaintCostPerItem, carpetFreshMarkup, defaultStudioMarkup: Number(s.defaultStudioMarkup ?? 3) || 3, fixedVenues: Array.isArray(s.fixedVenues) ? s.fixedVenues : [], fixedVenueSubcatDiscount: (s.fixedVenueSubcatDiscount && typeof s.fixedVenueSubcatDiscount === "object") ? s.fixedVenueSubcatDiscount : {}, venueParents, venueDumping: (s.venueDumping && typeof s.venueDumping === "object") ? s.venueDumping : {}, categoryDepartments: (catDeptMap && Object.keys(catDeptMap).length) ? catDeptMap : ((s.categoryDepartments && typeof s.categoryDepartments === "object") ? s.categoryDepartments : {}) });
      setDealCheckLoading(false);
      if (inventory.length === 0) {
        setDcAbortRef(null);
        return;
      }
      if (hasCache) {
        setDcAbortRef(null);
        return;
      }
      // Progressively resolve each (fnIdx, photoUrl) — AI only for uncached
      for (const fnData of allFns) {
        if (ac.signal.aborted) break;
        const fnOverrides = dcPhotoOverrides[fnData.fnIdx] || {};
        const photosInFn = {};
        Object.entries(fnData.elSelectedPhoto || {}).forEach(([zk, ph]) => {
          if (!fnData.enabledEls[zk]) return;
          const url = ph?.src;
          if (!url) return;
          photosInFn[url] = ph;
        });
        for (const [photoUrl, photoMeta] of Object.entries(photosInFn)) {
          if (ac.signal.aborted) break;
          const key = fnData.fnIdx + "__" + photoUrl;
          setDcResolving(prev => ({ ...prev, [key]: true }));
          try {
            const result = await resolvePhotoToIMS(photoUrl, photoMeta, fnOverrides, inventory, photoImsMap);
            if (ac.signal.aborted) break;
            setDcResolved(prev => ({
              ...prev,
              [fnData.fnIdx]: { ...(prev[fnData.fnIdx] || {}), [photoUrl]: result }
            }));
            if (result.cacheUpdate) {
              setPhotoImsMap(prev => {
                const next = { ...prev, ...result.cacheUpdate };
                reliableSave(PIMAP_SK, JSON.stringify(next), "Photo→IMS map").catch(() => {});
                return next;
              });
            }
          } catch (e) {
            if (!ac.signal.aborted) {
              setDcResolved(prev => ({
                ...prev,
                [fnData.fnIdx]: { ...(prev[fnData.fnIdx] || {}), [photoUrl]: { imsId: null, source: "error", name: null, alternatives: [], aiCalled: false, error: e?.message || "resolve failed" } }
              }));
            }
          }
          setDcResolving(prev => { const n = { ...prev }; delete n[key]; return n; });
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setDealCheckError("Failed to load inventory: " + (e?.message || "unknown error"));
        setDealCheckLoading(false);
      }
    }
    setDcAbortRef(null);
  }, [collectAllFunctionData, dcPhotoOverrides, photoImsMap, dcCache, activeClientId, clientLedger]);

  // ═══ DEAL CHECK — fire openDealCheck on full-page open — VERBATIM ═══
  useEffect(() => {
    if (!dcFullPageOpen) return;
    openDealCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcFullPageOpen]);

  // ═══ Tier 2.2 — Deal Check cache writer (debounced, per-client) — VERBATIM ═══
  useEffect(() => {
    if (!activeClientId || !dcFullPageOpen) return;
    const allEmpty =
      Object.keys(dcResolved).length === 0 &&
      Object.keys(dcCards).length === 0 &&
      Object.keys(dcZoneState).length === 0 &&
      Object.keys(dcPhotoOverrides).length === 0 &&
      Object.keys(dcSkipped).length === 0 &&
      (dcManualItems?.length || 0) === 0 &&
      Object.keys(dcDedupOverrides).length === 0 &&
      Object.keys(dcProductionAccepted).length === 0;
    if (allEmpty) return;
    // Don't auto-save DURING a Generate — dcCards changes rapidly then, and saving the (large) draft
    // on each change floods Supabase with big upserts (503/504). dcGenerating is a dep, so the effect
    // fires once more when generation finishes and saves the settled result.
    if (dcGenerating) return;
    // ROOT-CAUSE GUARD (recurring "draft lost on refresh"): never persist an EMPTY card set. On open/
    // client-switch there's a window where dcCards is briefly empty (before restore completes); saving
    // then would overwrite the good saved draft with empty and permanently corrupt it — every reload
    // after that shows "No IMS match". A real draft always has cards, so empty = mid-load → skip.
    if (!dcCards || Object.keys(dcCards).length === 0) return;
    const t = setTimeout(() => {
      const snapshot = {
        resolved: dcResolved,
        cards: dcCards,
        zoneState: dcZoneState,
        photoOverrides: dcPhotoOverrides,
        skipped: dcSkipped,
        manualItems: dcManualItems,
        dedupOverrides: dcDedupOverrides,
        productionAccepted: dcProductionAccepted,
        artFlowerAlloc: dcArtFlowerAlloc,
        floralColorPrefs: dcFloralColorPrefs,
        customItems: dcCustomItems,
        cachedAt: new Date().toISOString()
      };
      // In-session cache only (no network write — the old whole-blob reliableSave hammered the
      // settings table). The DURABLE copy is the per-client client_ledger row below.
      setDcCache(prev => ({ ...prev, [activeClientId]: snapshot }));
      // Durable auto-save → client_ledger ROW (per-client, clobber-safe). dcDraft (full snapshot for
      // openDealCheck) + the top-level fields loadClientSession restores. One write, after edits settle.
      const cur = clientLedgerRef.current || [];
      if (cur.some(c => c.id === activeClientId)) {
        saveClientLedger(cur.map(c => c.id === activeClientId ? { ...c,
          dcCards, dcZoneState, dcKitEdits, dcCarpetPick, dcMpOverrides, dcMpWinCount,
          dcMpIncludeMinusOne, dcMpIncludeDismantle,
          dcDraft: snapshot, dcDraftSavedAt: Date.now(), dcDraftSavedBy: authUser?.name || "—" } : c));
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [activeClientId, dcFullPageOpen, dcGenerating, dcResolved, dcCards, dcZoneState, dcPhotoOverrides, dcSkipped, dcManualItems, dcDedupOverrides, dcProductionAccepted, dcArtFlowerAlloc, dcFloralColorPrefs, dcCustomItems, dcKitEdits, dcCarpetPick, dcMpOverrides, dcMpWinCount, dcMpIncludeMinusOne, dcMpIncludeDismantle, authUser, saveClientLedger]);

  // ═══ DEAL CHECK REBUILD — Generate orchestrator (§7.9 · Deploy 1) — VERBATIM ═══
  const runDealCheckGenerate = useCallback(async (fnIdxFilter = null) => {
    const cli = clientLedger.find(c => c.id === activeClientId);
    if (!cli) { showMsg("No active client", "red"); return { ok: false, error: "no-client" }; }
    const isSold = cli.status === "booked";
    const counterKey = activeClientId;
    const cur = dcRunCounter[counterKey] || { preSold: 0, postSold: 0, isSold: false };
    const limit = 999;  // TESTING — revert to 2 after testing complete
    const usedNow = isSold ? cur.postSold : cur.preSold;
    if (usedNow >= limit) {
      const msg = isSold
        ? "Post-SOLD Deal Check limit reached (2/2). Contact admin to unlock more runs."
        : "Pre-SOLD Deal Check limit reached (2/2). Mark function as SOLD to unlock 2 more runs.";
      showMsg(msg, "red");
      return { ok: false, blocked: true };
    }
    setDcGenerating(true);
    setDcGenStatus("Loading IMS inventory…");
    const firstDate = (cli.functions?.[0]?.date) || cli.eventDate || clientDate || "";
    const ims = await fetchIMSData(firstDate);
    if (!ims || !Array.isArray(ims.inventory)) {
      setDcGenerating(false); setDcGenStatus("");
      showMsg("IMS unreachable — try again", "red");
      return { ok: false, error: "ims-unreachable" };
    }
    const inventory = ims.inventory;
    setDcInventoryCache(inventory);  // Patch 4 — cache for card rendering lookups
    const nextCounter = {
      ...cur,
      isSold,
      preSold: isSold ? cur.preSold : (cur.preSold + 1),
      postSold: isSold ? (cur.postSold + 1) : cur.postSold,
    };
    const nextAllCounters = { ...dcRunCounter, [counterKey]: nextCounter };
    setDcRunCounter(nextAllCounters);
    try { await reliableSave(DC_RUN_COUNTER_SK, JSON.stringify(nextAllCounters)); } catch {}
    const allFns = collectAllFunctionData ? collectAllFunctionData() : [];
    const fnsToProcess = fnIdxFilter == null ? allFns : allFns.filter((_, i) => i === fnIdxFilter);
    const newCards = { ...dcCards };
    const newZoneState = { ...dcZoneState };
    const matchedItemIds = new Set();
    let zonesProcessed = 0, cardsResolved = 0, cardsAi = 0, cardsNameMatch = 0, cardsUnmatched = 0, cardsKnown = 0;
    const ac = new AbortController();
    setDcAbortRef(ac);
    for (let fi = 0; fi < fnsToProcess.length; fi++) {
      const fn = fnsToProcess[fi];
      const fnIdx = fnIdxFilter == null ? fi : fnIdxFilter;
      if (!fn || !fn.enabledEls) continue;
      newCards[fnIdx] = { ...(newCards[fnIdx] || {}) };
      newZoneState[fnIdx] = { ...(newZoneState[fnIdx] || {}) };
      const enabledZoneKeys = Object.keys(fn.enabledEls).filter(k => fn.enabledEls[k]);
      // Card specs come straight from the CURRENT build (getCardSpecsForZone(zoneElements)). Build the
      // full valid key-set for this function first, then PRUNE any card that no longer maps to a current
      // build element — removed elements, a swapped zone photo, or a disabled/emptied zone. Without this,
      // cards from a previous build state linger and Deal Check shows elements the salesperson never
      // saved (the reported mismatch). Deal Check must mirror the build exactly.
      const zoneSpecs = {};
      const validKeys = new Set();
      for (const zoneKey of enabledZoneKeys) {
        const zoneElems = fn.zoneElements?.[zoneKey] || [];
        if (zoneElems.length === 0) continue;
        // elSelectedPhoto[zoneKey] is an object { src, eventName, … } — use its .src URL string
        // (passing the object as an image url silently broke the visual matcher + knowledge key).
        const photoUrl = fn.elSelectedPhoto?.[zoneKey]?.src || null;
        const specs = getCardSpecsForZone(zoneElems, zoneKey, photoUrl, floralHardPropMap, rcItems);
        zoneSpecs[zoneKey] = { specs, photoUrl };
        specs.forEach(s => validKeys.add(s.cardKey));
      }
      Object.keys(newCards[fnIdx]).forEach(k => { if (!validKeys.has(k)) delete newCards[fnIdx][k]; });
      for (const zoneKey of enabledZoneKeys) {
        const entry = zoneSpecs[zoneKey];
        if (!entry) continue;
        const { specs: cardSpecs, photoUrl } = entry;
        // Re-match when the zone is flagged dirty OR any current element is missing a card (build changed
        // since the last run). Otherwise the zone is up to date — skip the AI to save calls.
        const needsMatch = cardSpecs.some(s => !newCards[fnIdx][s.cardKey]) || isZoneDirty(dcZoneState, dcCards, fnIdx, zoneKey);
        if (!needsMatch) continue;
        zonesProcessed += 1;
        setDcGenStatus(`Matching zone "${zoneKey}" (fn ${fnIdx + 1})…`);
        const venueName = fn.fnVenue || "";
        const fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || venueParents };
        // Match one element spec → its card. The AI vision call dominates wall-clock, so these run in
        // parallel below (bounded) instead of one-at-a-time — the main "Generate is slow" fix.
        let zoneAborted = false;
        const runSpec = async (spec) => {
          if (zoneAborted) return;
          // Hide inventory locked to OTHER fixed venues; surface THIS venue's standing items first.
          const subcatList = filterImsBySubcategory(inventory, spec.subcategory);
          const scoped = subcatList
            .filter((it) => availableAtVenue(fvCfg, venueName, it) > 0)
            .slice()
            .sort((a, b) => (isStandingAt(fvCfg, venueName, b.id) ? 1 : 0) - (isStandingAt(fvCfg, venueName, a.id) ? 1 : 0));
          let primary = null, source = null;
          // 1) KNOWLEDGE SET first — a learned/taught visual identity for this photo+element. It's
          //    availability-independent: take the item straight from the full sub-category list (per-deal
          //    availability is shown via `alternatives`, and the salesperson can swap deal-local). Verify
          //    it still exists; else fall through and re-derive. Hit = we skip the AI entirely.
          // 0) PINNED first — a deal-local manual stock pick from the Build availability modal forces this
          //    exact item (honored regardless of availability; salesperson chose it knowingly).
          const pinnedItem = spec.pinnedImsId ? (inventory.find(i => i.id === spec.pinnedImsId) || null) : null;
          const kKey = dcKnowledgeKey(spec.photoUrl, spec.rcName, spec.propType);
          const known = kKey ? photoKnowledgeRef.current[kKey] : null;
          const knownItem = known?.imsId ? subcatList.find(i => i.id === known.imsId) : null;
          if (pinnedItem) {
            primary = { imsId: pinnedItem.id, name: pinnedItem.name };
            source = "pinned";
          } else if (knownItem) {
            primary = { imsId: knownItem.id, name: knownItem.name };
            source = "knowledge"; cardsKnown += 1;
          } else {
            const nm = nameMatchUnique(spec.rcName, scoped);
            if (nm.matched) {
              primary = { imsId: nm.item.id, name: nm.item.name };
              source = "name-match"; cardsNameMatch += 1;
            } else {
              const ai = await aiMatchCardWithSubcat(spec, scoped, ac.signal);
              if (ai?.aborted) { zoneAborted = true; return; }
              if (ai?.primary?.imsId) {
                primary = { imsId: ai.primary.imsId, name: ai.primary.name };
                source = spec.kind === "fl" ? "floral" : (spec.photoUrl ? "photo" : "list");
                cardsAi += 1;
              } else {
                source = "no-match"; cardsUnmatched += 1;
              }
            }
            // LEARN: store the freshly-derived visual identity so future generates skip the work.
            // Only with a photo key + a real match, and only when new/changed. Ordinary swaps happen
            // later in the UI and never call this — so availability/preference picks don't pollute it.
            if (kKey && primary?.imsId && known?.imsId !== primary.imsId) {
              saveKnowledgeEntry(kKey, { imsId: primary.imsId, subcat: spec.subcategory, source: source === "name-match" ? "name" : "ai" });
            }
          }
          // Alternatives = the WHOLE sub-category (NOT venue-filtered), deterministic and independent of
          // the AI's answer — so a card always lists every option in its sub-category, even when all of
          // them are committed at another venue (that was the Glass Bar / BAR case: the venue-filtered
          // pool was empty, so the card showed nothing). Venue-available items sort first; the auto-pick
          // still uses the venue-filtered `scoped`.
          const alternatives = subcatList
            .filter(x => x.id !== (primary?.imsId || null))
            .slice()
            .sort((a, b) => availableAtVenue(fvCfg, venueName, b) - availableAtVenue(fvCfg, venueName, a))
            .slice(0, 12)
            .map(x => ({ imsId: x.id, name: x.name }));
          newCards[fnIdx][spec.cardKey] = {
            imsId: primary?.imsId || null,
            imsName: primary?.name || null,
            alternatives,
            source,
            propType: spec.propType || null,
            rcName: spec.rcName,
            qty: spec.qty || 1,
            zoneKey,
            resolvedAt: Date.now(),
          };
          if (primary?.imsId) {
            matchedItemIds.add(primary.imsId); cardsResolved += 1;
            // Kit → soft-hold each COMPONENT individually too (customised per-deal via dcKitEdits, else
            // the master subItems), so every sub-item is reserved in IMS, not just the kit shell.
            const pItem = inventory.find(i => i.id === primary.imsId);
            if (pItem && Array.isArray(pItem.subItems) && pItem.subItems.length) {
              const edited = dcKitEdits[fnIdx]?.[spec.cardKey];
              const comps = Array.isArray(edited) ? edited : pItem.subItems;
              comps.forEach(cp => { if (cp?.itemId) matchedItemIds.add(cp.itemId); });
            }
          }
        };
        // Bounded-concurrency runner — ~6 element matches in flight at once (each cardKey writes its own
        // entry, so no collisions). Cuts a zone's match time to roughly (elements/6) × per-call time.
        const CONCURRENCY = 6;
        let _si = 0;
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cardSpecs.length) }, async () => {
          while (_si < cardSpecs.length && !zoneAborted) { await runSpec(cardSpecs[_si++]); }
        }));
        if (zoneAborted) { setDcGenerating(false); setDcGenStatus("Cancelled"); setDcAbortRef(null); return { ok: false, error: "aborted" }; }
        newZoneState[fnIdx][zoneKey] = { ...(newZoneState[fnIdx][zoneKey] || {}), lastResolvedAt: Date.now() };
      }
    }
    setDcCards(newCards);
    setDcZoneState(newZoneState);
    // A fresh regenerate on a SOLD deal → the next dept-snapshot sync wipes the dept head's edits
    // (plan + actuals) so IMS reflects the new system plan, not the old overrides.
    if (isSold) deptWipeRef.current = true;
    // §26 — Add artificial flower allocated item IDs to soft-holds
    Object.values(dcArtFlowerAlloc).forEach(allocs => {
      (allocs || []).forEach(a => { if (a.itemId) matchedItemIds.add(a.itemId); });
    });
    // §7.9.7 — write 24h soft holds for newly-matched items (pre-SOLD only)
    if (!isSold && matchedItemIds.size > 0) {
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      const salesperson = (typeof authUser !== "undefined" ? authUser?.name : "") || "—";
      const eventName = cli.name || "—";
      const nextHolds = { ...softHolds };
      const holdRows = [];
      for (const itemId of matchedItemIds) {
        const h = { salesperson, expiry, clientId: counterKey, eventName };
        nextHolds[itemId] = h; holdRows.push({ id: itemId, data: h });
      }
      setSoftHolds(nextHolds);
      // Row-per-item to the soft_holds TABLE (off the whole-blob write) — only the items we just held.
      try { if (holdRows.length) await supabase.from("soft_holds").upsert(holdRows, { onConflict: "id" }); } catch {}
    }
    // ════════════════════════════════════════════════════════════════════════
    // §23 PHASE 3 — Write truss soft-hold draft to the truss_allocations TABLE.
    // Pre-SOLD only. Merges Studio's soft event into each date row, preserving IMS
    // hard events (Part 3 bridge write — adapted Redis→Supabase).
    // ════════════════════════════════════════════════════════════════════════
    try {
      const trussInvLocal = dealCheckData?.trussInv;
      if (!isSold && trussInvLocal && trussInvLocal.pillars) {
        const salesperson = (typeof authUser !== "undefined" ? authUser?.name : "") || "—";
        const fnList = fnsToProcess;
        const fnsByDate = {};
        fnList.forEach(fn => {
          const d = fn.fnDate || cli.eventDate || "";
          if (!d) return;
          if (!fnsByDate[d]) fnsByDate[d] = [];
          fnsByDate[d].push(fn);
        });
        const allocByDate = {};
        let nextAlloc = { ...trussAlloc };
        let datesWritten = 0;
        Object.entries(fnsByDate).forEach(([d, fnsForDate]) => {
          const entry = buildSoftHoldEntry({
            clientId: counterKey,
            clientName: cli.name || "—",
            salesperson,
            fnList: fnsForDate,
            trussInv: trussInvLocal,
            expiry: Date.now() + 24 * 60 * 60 * 1000,
            eventDate: d,
          });
          if (!entry) return;
          allocByDate[d] = entry;
          // Keep local React mirror in sync (drop prior soft for this client, preserve hard)
          const dateEntry = nextAlloc[d] || { events: [] };
          const existing = Array.isArray(dateEntry.events) ? [...dateEntry.events] : [];
          const filtered = existing.filter(ev => !(ev.state === "soft" && ev.clientId === counterKey));
          filtered.push(entry);
          nextAlloc[d] = { ...dateEntry, events: filtered, lastCascadeAt: Date.now(), lastCascadeBy: `studio-softhold-${salesperson}` };
          datesWritten += 1;
        });
        if (datesWritten > 0) {
          setTrussAlloc(nextAlloc);
          await writeStudioTrussSoftHolds(allocByDate);
          console.log("[tier23-p3] truss soft-hold written for", datesWritten, "date(s) ·", cli.name);
        }
      }
    } catch (e) {
      console.warn("[tier23-p3] truss soft-hold write failed:", e?.message || e);
    }
    setDcGenerating(false);
    setDcGenStatus("");
    setDcAbortRef(null);
    showMsg(`Deal Check generated · ${cardsResolved} matched · ${cardsUnmatched} unmatched · ${cardsNameMatch} name-match (no AI cost) · ${cardsAi} AI calls`, "green");
    return { ok: true, summary: { zonesProcessed, cardsResolved, cardsAi, cardsNameMatch, cardsUnmatched } };
  }, [activeClientId, clientLedger, dcRunCounter, dcCards, dcZoneState, floralHardPropMap, softHolds, collectAllFunctionData, clientDate, authUser, showMsg, rcItems, trussAlloc, dealCheckData, writeStudioTrussSoftHolds]);

  // ═══════════════════════════════════════════════════════════════
  // STYLES + THEME
  // ═══════════════════════════════════════════════════════════════
  const isDark = mode === "manage";
  const S = makeS(isDark);
  const accent = "#C9A96E";
  const border = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textS = isDark ? "#6B7280" : "#8b8fa3";
  const cardBg = isDark ? "#1A1A2E" : "#fff";
  const textP = isDark ? "#E5E5E5" : "#1a1a2e";
  const accentBg = isDark ? "rgba(201,169,110,0.12)" : "#F5F0FF";
  const accentText = isDark ? "#C9A96E" : "#6D28D9";

  // ═══════════════════════════════════════════════════════════════
  // CTX BAG — single object literal passed to view slices in later commits.
  // Comprehensive: every state var, setter, and pricing/save helper a view might need.
  // ═══════════════════════════════════════════════════════════════
  // Apply a reviewed client-photo upload to its zone (verbatim from reference).
  const applyZoneUpload = () => {
    const r = zoneUploadReview; if (!r) return;
    const libId = "LIB" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const libImg = { id: libId, url: r.url, name: r.name, tags: r.tags, elements: r.elements, dims: r.dims, addedAt: Date.now(), source: "client-upload" };
    mergeLibItems([libImg]); saveLib([libImg]);
    logActivity("uploaded client photo", libImg.name + " → " + (zoneLabelsD[r.elKey]?.label || r.elKey));
    const photo = { src: r.url, eventName: libImg.name, isLibrary: true, eventId: libId, elements: libImg.elements, dims: libImg.dims, fn: "", space: "", zones: [] };
    selectElPhoto(r.elKey, photo);
    if (r.dims) {
      const cfg = buildZoneConfig(r.elKey, r.dims);
      if (cfg) {
        setZoneConfig(p => ({ ...p, [r.elKey]: cfg }));
        setEnabledEls(p => ({ ...p, [r.elKey]: true }));
      }
    }
    showMsg("✓ Applied to " + (zoneLabelsD[r.elKey]?.label || r.elKey) + " with " + r.elements.length + " elements", "green");
    setZoneUploadReview(null);
  };

  const ctx = {
    // theme / chrome
    S, isDark, accent, border, textS, fmt, cat,
    textP, accentBg, accentText, cardBg,
    // taxonomy constants (module-scope)
    taxOr, FUNCTIONS, CATEGORIES, SHIFT_LETTER, PAINT_TOKENS_FALLBACK,
    // derived memos
    activeClient, meetingNumber, allInhouseVenues, allOutdoorDB, allInhouseGroups,
    allVenueData, outdoorVenueList, browseVideos, allVideos,
    // handlers
    loadClientSession, loadLmsLead, autoPersistCustomVenue, pickAndLoad, pickAndLoadFromVideo,
    resumeSavedSession, toggleEl, selectElPhoto, handleZoneUpload, aiTagImage, findTemplate,
    getLibPhotosForZone, maxRepaintCostInSubcat, saveSession, markSold, loadEvent,
    buildZonesForFn, buildCombinedCostSheetData, logActivity, saveTR,
    normalizePaintAllocation, paintPillLabel, isSubcatPaintable,
    lmsCacheRef,
    // zone photo filters + upload
    zpFilterOpen, setZpFilterOpen, zpFilters, setZpFilters, zpToggleFilter, zpHasFilters, zpFilterPhoto,
    zoneUploading, setZoneUploading, zoneUploadReview, setZoneUploadReview, zurElSearch, setZurElSearch, applyZoneUpload,
    // auth
    authUser, isAdmin, hasPerm, doLogout, teamData, setTeamData, userVenueScope, studioSettingsAllowed, studioLibraryAllowed,
    // app mode + steps
    mode, setMode, step, setStep, manageTab, setManageTab, toast, setToast, showMsg, loaded, setLoaded, saveError, setSaveError,
    // events
    events, setEvents, editEv, setEditEv, save, filteredEvents,
    // admin / library state
    photoUrl, setPhotoUrl, evEditPhotoIdx, setEvEditPhotoIdx, tagInput, setTagInput, bulkUrls, setBulkUrls,
    bulkTarget, setBulkTarget, adminSearch, setAdminSearch, adminFilterV, setAdminFilterV, adminFilterC, setAdminFilterC, previewImg, setPreviewImg,
    libView, setLibView, libShowBulk, setLibShowBulk, pricingView, setPricingView, settingsView, setSettingsView,
    calYear, setCalYear, calMonth, setCalMonth, calSelDate, setCalSelDate, calEditMode, setCalEditMode, calSelectedDates, setCalSelectedDates,
    calLmsData, setCalLmsData, calView, setCalView, calSeasonData, setCalSeasonData,
    ctFilterSp, setCtFilterSp, ctFilterStatus, setCtFilterStatus, ctFilterFrom, setCtFilterFrom, ctFilterTo, setCtFilterTo, ctExpandedId, setCtExpandedId,
    taxonomy, setTaxonomy, saveTax, libItems, setLibItems, saveLib, mergeLibItems, ensureLibItems, ensureLibItemsByUrl, corrLog, logCorrection, tagKB, rebuildTagKB, tagCorrections, refreshTagCorrections, bulkTag, runBulkTag, stopBulkTag, runTagSelected, bulkVid, runBulkTagVideos, stopBulkTagVideos, importCloudinaryFolder, batchTaggerPaused, batchTaggerMeta, toggleBatchTaggerPaused, libSearch, setLibSearch, libFilters, setLibFilters,
    libVenueGroup, setLibVenueGroup, libVenueNames, setLibVenueNames, libEditImg, setLibEditImg, zoneElements, setZoneElements,
    libAddUrl, setLibAddUrl, libAddPreview, setLibAddPreview, libBulkText, setLibBulkText, libBulkQueue, setLibBulkQueue,
    libAiLoading, setLibAiLoading, zoneAiFilling, setZoneAiFilling, zoneElSearch, setZoneElSearch, libBulkProgress, setLibBulkProgress,
    taxEditCat, setTaxEditCat, taxNewTag, setTaxNewTag, taxNewCat, setTaxNewCat, libElSearch, setLibElSearch,
    addTagWithAreaZoneSync, addZoneWithAreaSync,
    // venues
    customInhouse, setCustomInhouse, customOutdoor, setCustomOutdoor, saveVenues,
    newIH, setNewIH, newOD, setNewOD, adminOdSearch, setAdminOdSearch, editIH, setEditIH, editOD, setEditOD,
    // studio build state
    venueGroup, setVenueGroup, outsideSub, setOutsideSub, browseVenues, setBrowseVenues, odSearch, setOdSearch, showMoreOutside, setShowMoreOutside,
    filterCat, setFilterCat, filterFn, setFilterFn, filterSpace, setFilterSpace, filterMood, setFilterMood, filterPalette, setFilterPalette,
    filterVenue, setFilterVenue, toggleFilter,
    videoModal, setVideoModal, videoPlaying, setVideoPlaying, videoOverlay, setVideoOverlay,
    selectedMoods, setSelectedMoods, selectedPalettes, setSelectedPalettes,
    venue, setVenue, fn, setFn, clientName, setClientName, clientDate, setClientDate, clientPhone, setClientPhone,
    clientBrideGroom, setClientBrideGroom, clientShift, setClientShift, clientPax, setClientPax, clientVenueOther, setClientVenueOther,
    clientPalette, setClientPalette, extraFunctions, setExtraFunctions, expandedFnIdx, setExpandedFnIdx,
    activeFnIdx, setActiveFnIdx, activeFnMeta, fnBuilds, setFnBuilds,
    showClientForm, setShowClientForm, clientLedger, setClientLedger, saveClientLedger, activeClientId, setActiveClientId, clientSearch, setClientSearch,
    snapshotBuildState, restoreBuildState, switchActiveFn, fnSnapHasData,
    sessionHistoryExpanded, setSessionHistoryExpanded,
    // LMS
    lmsLeads, setLmsLeads, lmsLoading, setLmsLoading, lmsError, setLmsError, lmsFilling, setLmsFilling, lmsRefreshCounter, setLmsRefreshCounter,
    refreshLmsSync, lmsSyncing,
    // dates / orders / preflight
    dateTypes, setDateTypes, saveDateTypes, eventOrders, setEventOrders, saveEventOrders,
    photoImsMap, setPhotoImsMap, savePhotoImsMap, scanHistory, setScanHistory, saveScanHistory,
    showSoldConfetti, setShowSoldConfetti, csData, setCsData, expandedSummaryFnIdx, setExpandedSummaryFnIdx,
    // build canvas
    enabledEls, setEnabledEls, elTiers, setElTiers, customMode, setCustomMode, itemQty, setItemQty, itemGrades, setItemGrades,
    showInsp, setShowInsp, showAi, setShowAi, showPpt, setShowPpt, showCosts, setShowCosts,
    elInspo, setElInspo, elInspoLoading, setElInspoLoading, elSelectedPhoto, setElSelectedPhoto, elNotes, setElNotes, elCostOpen, setElCostOpen,
    customZones, setCustomZones, newCzName, setNewCzName, elGallery, setElGallery, galleryIdx, setGalleryIdx, webPreview, setWebPreview,
    zoneConfig, setZoneConfig, activeZones, setActiveZones,
    floralRatio, setFloralRatio, floralOverrides, setFloralOverrides,
    customTripRate, setCustomTripRate, venueCustom, setVenueCustom, customGensets, setCustomGensets,
    sourceEvent, setSourceEvent, sourceVideo, setSourceVideo,
    // inspiration / AI / PPT
    inspQ, setInspQ, inspResults, setInspResults, inspLoading, setInspLoading, aiPrompt, setAiPrompt, aiResult, setAiResult, aiLoading, setAiLoading,
    pptLoading, setPptLoading, pptDone, setPptDone, savedInsps, setSavedInsps, copied, setCopied,
    pinResults, setPinResults, pinLoading, setPinLoading, pinQuery, setPinQuery, inspSource, setInspSource,
    // rate card / transport
    rcItems, setRcItems, saveRC, rcCats, setRcCats, saveRcCats, rcCatEditMode, setRcCatEditMode, rcCat, setRcCat, rcSearch, setRcSearch,
    rcEditId, setRcEditId, rcTab, setRcTab, rcAddMode, setRcAddMode, rcSubOpen, setRcSubOpen, rcNewForm, setRcNewForm,
    RC_UNITS, TC_UNITS, RC_CATS_DEFAULT,
    trVenues, setTrVenues, truckCap, setTruckCap, floralPerTruck, setFloralPerTruck, gensetRate, setGensetRate, bufferTiers, setBufferTiers,
    newVenue, setNewVenue, newTC, setNewTC, TR_TIERS,
    // templates
    templates, setTemplates, saveTpl, tplEdit, setTplEdit, tplTab, setTplTab,
    // zones
    zoneDefs, setZoneDefs, saveZD, zoneMeta, zoneKeys, zoneLabelsD, zdEditZone, setZdEditZone,
    // premia
    premiaConfig, setPremiaConfig, savePremiaConfig, premiaGate, setPremiaGate, premiaDraft, setPremiaDraft,
    premiaEditorOpen, setPremiaEditorOpen, premiaPreview, setPremiaPreview, isPremiaPlatinum, PREMIA_DEFAULTS,
    // youtube
    ytVideos, setYtVideos, ytPlaylists, setYtPlaylists, ytLoading, setYtLoading, ytSearch, setYtSearch, ytFilterPL, setYtFilterPL,
    loadAllYT, searchYT, fetchYTPlaylist, untaggedVideoCount, cldAdmin,
    ytPicker, setYtPicker, ytLastFetch, setYtLastFetch, ytVideoTags, setYtVideoTags, saveYtTags, ytTagEdit, setYtTagEdit,
    tagVenueGroup, setTagVenueGroup, tagOutsideSub, setTagOutsideSub, aiTaggingVideo, setAiTaggingVideo, aiVideoDraft, setAiVideoDraft,
    ytFilterVenue, setYtFilterVenue, ytFilterFn, setYtFilterFn, ytFilterTier, setYtFilterTier, ytFilterLinked, setYtFilterLinked,
    ytFilterStyle, setYtFilterStyle, ytFilterColor, setYtFilterColor, ytFilterIO, setYtFilterIO, ytPhotoUrl, setYtPhotoUrl,
    manualVideos, setManualVideos, hiddenVideos, setHiddenVideos, showHidden, setShowHidden, lastVisitTs, setLastVisitTs,
    saveManualVideos, saveHiddenVideos, aiTagVideo, aiTagVideoSave, getPhotos, ZONE_ICONS,
    // cloudinary photo browser
    cldOpen, setCldOpen, cldFolders, setCldFolders, cldPath, setCldPath, cldImages, setCldImages, cldLoading, setCldLoading,
    cldUploading, setCldUploading, cldUploadProgress, setCldUploadProgress, cldUploadRef, cldFolderUploadRef,
    cldSelectMode, setCldSelectMode, cldSelected, setCldSelected, cldDeleting, setCldDeleting,
    fetchCldFolders, cldNavigate, cldGoBack, handleCldUpload, handleCldBulkDelete, handleCldDeleteFolder,
    // cloudinary video browser
    addVideoOpen, setAddVideoOpen, cldVideoFolders, setCldVideoFolders, cldVideoPath, setCldVideoPath,
    cldVideoList, setCldVideoList, cldVideoLoading, setCldVideoLoading,
    openCldVideoBrowser, cldVideoNavigate, cldVideoGoBack, addCldVideo,
    // zone picker modal
    zonePickerVid, setZonePickerVid, zonePickerZone, setZonePickerZone,
    // notifications
    notifications, setNotifications, notifOpen, setNotifOpen, notifLastRead, setNotifLastRead, unreadCount, markAllRead,
    filterPriority, setFilterPriority, saveFilterPriority,
    // tagging-hidden sub-categories (Pricing flags)
    tagHiddenSubs, isSubTagHidden, toggleTagHiddenSub,
    // deal check
    dealCheckData, setDealCheckData, dealCheckLoading, setDealCheckLoading, dealCheckError, setDealCheckError, catDeptMap, saveCatDeptMap,
    // mount-loaded fallbacks so Build works before Deal Check opens (fixed-venue Repeat chip, floral auto-derive)
    studioFloralData, venueParents,
    imsColourCatalogue, setImsColourCatalogue, imsPaletteCatalogue, setImsPaletteCatalogue, imsPaintableCategories, setImsPaintableCategories,
    imsDefaultPaintCost, setImsDefaultPaintCost, savePaletteData, paintPickerTarget, setPaintPickerTarget, fabricPickerTarget, setFabricPickerTarget,
    dcPhotoOverrides, setDcPhotoOverrides, dcSkipped, setDcSkipped, dcProductionAccepted, setDcProductionAccepted, dcManualItems, setDcManualItems,
    dcManualSearch, setDcManualSearch, dcDedupOverrides, setDcDedupOverrides, dcBlockedFnOpen, setDcBlockedFnOpen, dcBlockedSubOpen, setDcBlockedSubOpen,
    dcFloralExpanded, setDcFloralExpanded, dcFloralUnmatchedExpanded, setDcFloralUnmatchedExpanded, dcResolved, setDcResolved, dcResolving, setDcResolving, dcAbortRef, setDcAbortRef,
    dcFullPageOpen, setDcFullPageOpen, dcCards, setDcCards, dcZoneState, setDcZoneState, dcKitEdits, setDcKitEdits, dcCarpetPick, setDcCarpetPick,
    dcCarpetSearch, setDcCarpetSearch, dcDesiredMargin, setDcDesiredMargin, dcRunCounter, setDcRunCounter, dcCache, setDcCache, dcGenerating, setDcGenerating,
    dcGenStatus, setDcGenStatus, dcActiveTab, setDcActiveTab, dcMpOverrides, setDcMpOverrides, dcMpWinCount, setDcMpWinCount, dcMpIncludeMinusOne, setDcMpIncludeMinusOne,
    dcMpIncludeDismantle, setDcMpIncludeDismantle, dcMpCalcOpen, setDcMpCalcOpen, dcFloralCalcOpen, setDcFloralCalcOpen, dcCollapsedZones, setDcCollapsedZones,
    floralHardPropMap, setFloralHardPropMap, softHolds, setSoftHolds, trussAlloc, setTrussAlloc, dcAmendDiff, setDcAmendDiff, dcSavingDraft, setDcSavingDraft,
    amendRequests, submitAmendRequest, isLastMinute, makeAmendRequest,
    dcInventoryCache, setDcInventoryCache, dcBrowseAllOpen, setDcBrowseAllOpen, dcSwapModal, setDcSwapModal, dcColorModal, setDcColorModal,
    photoKnowledge, saveKnowledgeEntry, dcKnowledgeKey,
    dcArtFlowerAlloc, setDcArtFlowerAlloc, dcArtFlowerModal, setDcArtFlowerModal, dcFloralColorPrefs, setDcFloralColorPrefs, dcPrefModal, setDcPrefModal,
    dcCustomItems, setDcCustomItems, dcCustomModal, setDcCustomModal,
    dcSwapSearch, setDcSwapSearch, dcSwapPicked, setDcSwapPicked, dcSwapMode, setDcSwapMode, dcSwapSplitQty, setDcSwapSplitQty,
    // pricing helpers
    rcIsSMB, buildZoneConfig, getFloralMode, applyFloralRatio, getElPrice, getElPriceForFn, calcElsCost, calcElsCostForFn,
    calcPhotoCost, calcStructCost, calcFullEventCost, getFullCost, totalCost, transportCalc, grandTotal,
    collectAllFunctionData, calcFunctionCost, calcFnFloralSourcingCost, eventGrandTotal, calcFunctionBreakdown, manpowerPlanForBooking, persistDeptSnapshot, dcEoActuals, refreshDcEoActuals,
    // deal check orchestration + persistence (overlay)
    openDealCheck, runDealCheckGenerate, getStudioAvailable, loadAvailability, getActiveSoftHold, reliableSave, DC_CACHE_SK,
    writeStudioTrussSoftHolds,
    // deal check inventory-tab module helpers
    isZoneDirty, parseCardKey, PLATFORM_FATTA_CODE, PLATFORM_STAND_CODE,
    // module helpers exposed for views
    imsField, fetchIMSData, searchLmsLeads, calcZoneTrussPreview, calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan,
    resolveMandiFlower,
    LABOUR, LABOUR_PRESETS, SEASON_MULT, TPL_DEFAULTS, PERM_LABELS, ROLE_DEFAULTS, ROLES, TAX_LABELS,
  };
  void ctx; // consumed by view slices in later commits

  // ═══════════════════════════════════════════════════════════════
  // RENDER — header chrome + mode/step routing skeleton.
  // Views (EventInfo/Browse/Build/Summary), Manage mode, and Deal Check are
  // rendered as placeholders here; they land in later slices.
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`* { font-family: 'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif !important; } h1,h2,h3 { font-family: 'Plus Jakarta Sans', 'Outfit', system-ui, sans-serif !important; } input,select,textarea,button { font-family: 'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif !important; }`}</style>

      {/* SAVE FAILURE BANNER */}
      {saveError && (
        <div style={{ position: "fixed", top: 8, right: 8, zIndex: 100000, background: "#dc2626", color: "#fff", padding: "12px 14px", borderRadius: 8, fontSize: 13, maxWidth: 380, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", border: "1px solid #991b1b" }}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><span>❌</span> Save Failed: {saveError.label}</div>
          <div style={{ fontSize: 12, opacity: 0.95, marginBottom: 6, lineHeight: 1.4 }}>{saveError.error}</div>
          <button onClick={() => setSaveError(null)} style={{ background: "#fff", color: "#dc2626", border: "none", padding: "5px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 100000, padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#fff", background: toast.color === "red" ? "#dc2626" : toast.color === "green" ? "#16a34a" : "#374151" }}>{toast.msg}</div>
      )}

      {/* GLOBAL BULK-TAG PROGRESS PILL — visible on every Studio screen while tagging runs */}
      {bulkTag.running && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 100000, background: "#1f2937", color: "#fff", padding: "10px 14px", borderRadius: 12, fontSize: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>🤖 AI tagging…</span>
            <span style={{ marginLeft: "auto", opacity: 0.9 }}>{bulkTag.done}/{bulkTag.total}</span>
            <button onClick={stopBulkTag} style={{ background: "rgba(239,68,68,0.95)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Stop</button>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2 }}><div style={{ height: 4, width: `${bulkTag.total ? (bulkTag.done / bulkTag.total) * 100 : 0}%`, background: "#7C3AED", borderRadius: 2, transition: "width 0.3s" }} /></div>
          <div style={{ fontSize: 10, opacity: 0.8, marginTop: 5 }}>{bulkTag.ok}✓ {bulkTag.fail}✕ · keep working — this runs in the background</div>
        </div>
      )}

      {/* GLOBAL BULK VIDEO-TAG PROGRESS PILL */}
      {bulkVid.running && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 100000, background: "#1f2937", color: "#fff", padding: "10px 14px", borderRadius: 12, fontSize: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>🎬 Video AI tagging…</span>
            <span style={{ marginLeft: "auto", opacity: 0.9 }}>{bulkVid.done}/{bulkVid.total}</span>
            <button onClick={stopBulkTagVideos} style={{ background: "rgba(239,68,68,0.95)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Stop</button>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2 }}><div style={{ height: 4, width: `${bulkVid.total ? (bulkVid.done / bulkVid.total) * 100 : 0}%`, background: "#0EA5E9", borderRadius: 2, transition: "width 0.3s" }} /></div>
          <div style={{ fontSize: 10, opacity: 0.8, marginTop: 5 }}>{bulkVid.ok}✓ {bulkVid.fail}✕ · keep working — team reviews after</div>
        </div>
      )}

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${accent},#8B7355)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#0F0F1A" }}>A</div>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Ambria</div><div style={{ fontSize: 10, color: accent, letterSpacing: 1.5, textTransform: "uppercase" }}>{mode === "manage" ? "Manage" : "Design Studio"}</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Mode switch */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 3 }}>
            {[["studio", "🎨 Studio"], ...(canManageAny ? [["manage", "⚙️ Manage"]] : [])].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: mode === id ? 600 : 400, background: mode === id ? `${accent}22` : "transparent", color: mode === id ? accent : "#6B7280", transition: "all 0.15s" }}>{label}</button>
            ))}
          </div>
          {/* Studio step nav */}
          {mode === "studio" && <div style={{ display: "flex", gap: 3 }}>{["Event Info", "Browse", "Build", "Summary"].map((l, i) => <div key={i} onClick={() => { if (i <= step) setStep(i); }} style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: i === step ? 600 : 400, cursor: i <= step ? "pointer" : "default", background: i === step ? "rgba(255,255,255,0.15)" : "transparent", color: i <= step ? "#fff" : "rgba(255,255,255,0.25)" }}>{l}</div>)}</div>}
          {/* Manage tabs */}
          {mode === "manage" && <div style={{ display: "flex", gap: 3 }}>
            {(hasPerm("canEditEvents") || hasPerm("canManageLibrary")) && <button onClick={() => setManageTab("library")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "library" ? 600 : 400, background: manageTab === "library" ? `${accent}22` : "transparent", color: manageTab === "library" ? accent : "#6B7280" }}>📚 Library & content</button>}
            {hasPerm("canManagePricing") && <button onClick={() => setManageTab("pricing")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "pricing" ? 600 : 400, background: manageTab === "pricing" ? `${accent}22` : "transparent", color: manageTab === "pricing" ? accent : "#6B7280" }}>💰 Pricing</button>}
            {(isAdmin || hasStudioTab("settings")) && <button onClick={() => setManageTab("settings")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "settings" ? 600 : 400, background: manageTab === "settings" ? `${accent}22` : "transparent", color: manageTab === "settings" ? accent : "#6B7280" }}>⚙️ Settings</button>}
          </div>}
          {/* Live budget — only if canViewPricing */}
          {mode === "studio" && step >= 2 && hasPerm("canViewPricing") && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <div><div style={{ fontSize: 8, color: accent, textTransform: "uppercase", letterSpacing: 1 }}>Estimate</div><div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{fmt(grandTotal)}</div></div>
              <div style={{ padding: "3px 8px", borderRadius: 8, fontSize: 10, fontWeight: 600, background: cat.bg, color: cat.color }}>{cat.label}</div>
            </div>
          </div>}
          {/* Cross-app switcher (only for users granted both Studio + IMS) */}
          <AppSwitcher current="studio" />
          {/* Deal Check entry */}
          {authUser && mode === "studio" && (isAdmin || studioSub("design", "dealcheck")) && <button onClick={() => setDcFullPageOpen(true)} title="Deal Check" style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#6B7280", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>⚙</button>}
          {/* User badge */}
          {authUser && <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}><div style={{ padding: "5px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", fontSize: 11, color: "#fff" }}>{authUser.name}{isAdmin && <span style={{ color: accent, marginLeft: 4, fontSize: 9 }}>ADMIN</span>}{!isAdmin && authUser.role === "manager" && <span style={{ color: "#38BDF8", marginLeft: 4, fontSize: 9 }}>MGR</span>}</div><button onClick={doLogout} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#6B7280", fontSize: 10, cursor: "pointer" }}>Logout</button></div>}
        </div>
        {/* ROW 2: FUNCTION PILLS — hidden on Build page (step===2) per SOP */}
        {mode === "studio" && authUser && step !== 2 && (() => {
          const fns = [{ type: fn, date: clientDate, venue, shift: clientShift, pax: clientPax }, ...extraFunctions];
          if (extraFunctions.length === 0) return null;
          const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return d; } };
          const SHIFT_LETTER = { Morning: "M", Lunch: "L", Sundowner: "S", Night: "N" };
          return (
            <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, paddingTop: 10, marginTop: 6, borderTop: `1px solid rgba(201,169,110,0.12)`, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10, color: "#6B7280", textTransform: "uppercase", letterSpacing: 1.3, marginRight: 6, fontWeight: 600 }}>Function:</div>
              {fns.map((f, i) => {
                const isActive = i === activeFnIdx;
                const f_ = f || {};
                const typeLbl = (f_.type && String(f_.type).trim()) || `Function ${i + 1}`;
                const slotLetter = f_.shift ? (SHIFT_LETTER[f_.shift] || String(f_.shift).charAt(0).toUpperCase()) : "";
                const label = `${typeLbl} · ${fmtDate(f_.date)}${slotLetter ? " " + slotLetter : ""}`;
                return (
                  <div key={i} onClick={() => switchActiveFn(i)} style={{ padding: "6px 14px", borderRadius: 999, fontSize: 11, fontWeight: isActive ? 600 : 400, cursor: "pointer", background: isActive ? accent : "transparent", color: isActive ? "#1a1a2e" : accent, border: `1px solid ${isActive ? accent : "rgba(201,169,110,0.4)"}`, transition: "all 0.15s", whiteSpace: "nowrap", letterSpacing: 0.2 }}>{label}</div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* MANAGE MODE — permission-gated */}
      {mode === "manage" && authUser && (() => {
        // Resolve the active manage tab to one this role is permitted to see.
        const canLib = hasPerm("canEditEvents") || hasPerm("canManageLibrary");
        const canPrice = hasPerm("canManagePricing");
        const canSettings = isAdmin || hasStudioTab("settings");
        const okFor = (t) => (t === "library" && canLib) || (t === "pricing" && canPrice) || (t === "settings" && canSettings);
        const effManageTab = okFor(manageTab) ? manageTab : (canLib ? "library" : canPrice ? "pricing" : canSettings ? "settings" : null);
        return <div style={S.main}>
          {effManageTab === "library" ? (
            <ManageLibrary ctx={ctx} />
          ) : effManageTab === "pricing" ? (
            <div>
              <RateCard ctx={ctx} />
              {rcTab !== "transport" && <PremiaEditor ctx={ctx} />}
            </div>
          ) : effManageTab === "settings" ? (
            <ManageSettings ctx={ctx} />
          ) : (
            <div style={{ textAlign: "center", padding: 60, color: textS }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>No permissions</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Ask your admin for Studio access in IMS → Admin → Users → Tab Access.</div>
            </div>
          )}
        </div>;
      })()}

      {/* STUDIO MODE */}
      {mode === "studio" && <>
        {step === 0 && <StudioEventInfo ctx={ctx} />}
        {step === 1 && <StudioBrowse ctx={ctx} />}
        {step === 2 && <StudioBuild ctx={ctx} />}
        {step === 3 && <StudioSummary ctx={ctx} />}
      </>}

      {/* DEAL CHECK FULL-PAGE OVERLAY */}
      {authUser && dcFullPageOpen && <DealCheckOverlay ctx={ctx} />}

      {/* Top-level modals (paint/fabric pickers, custom item, video, zone-upload, lightbox) */}
      <StudioModals ctx={ctx} />
    </div>
  );
}

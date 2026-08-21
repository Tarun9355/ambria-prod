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
import { Fragment, useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react";
import { useAuth } from "../../lib/AuthContext";
import AppSwitcher from "../../components/AppSwitcher.jsx";
import { IconPalette, IconSliders, IconBook, IconGear, IconClipboardCheck, IconLogout, IconCheck, IconLock } from "../../components/icons.jsx";
import ManageLibrary from "./manage/ManageLibrary.jsx";
import ManageSettings from "./manage/ManageSettings.jsx";
import StudioModals from "./StudioModals.jsx";
import StudioEventInfo from "./views/StudioEventInfo.jsx";
import StudioBrowse from "./views/StudioBrowse.jsx";
import StudioBuild from "./views/StudioBuild.jsx";
import StudioSummary from "./views/StudioSummary.jsx";
import DealCheckOverlay from "./dealcheck/DealCheckOverlay.jsx";
import { kvGet, kvTryGet, kvSet, reliableSave } from "../../lib/ims/kv";
import { AMEND_SK, isLastMinute, makeAmendRequest } from "../../lib/ims/amend";
import { availableAtVenue, isStandingAt, rentalSplit } from "../../lib/ims/fixedVenues";
import { searchLmsLeads, triggerLmsSync, fetchCachedContracts } from "../../lib/ims/lms";
import { uploadToStorage, compressImageForUpload, STORAGE_FOLDERS, listStorage, deleteStorageObjects, deleteStorageFolder } from "../../lib/storage";
import { ytApi, ytDuration } from "../../lib/youtube";
import { extractLabeledValue, bestTaxMatch } from "../../lib/studio/videoDescriptionTags";
import { paletteNames, paletteInList } from "../../lib/studio/colours";
import { makeS } from "../../lib/studio/styles";

// ═══ HEADER TYPE + CHIP SCALE ═══
// The header used to mix 8/9/10/11/12/13px in a single row. It now has exactly two tiers:
// NAV_FS for anything clickable, NAV_META_FS for uppercase micro-labels that aren't controls.
// NAV_ICON keeps every SVG optically matched — something emoji never allowed.
const NAV_FS = 12;
const NAV_META_FS = 10;
const NAV_ICON = 15;
const NAV_META = { fontSize: NAV_META_FS, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", lineHeight: 1.4 };
// Segmented container shared by the mode switch, step nav and manage tabs, so all three
// read as one control family instead of three different pill shapes.
// A recessed WELL, not a pale tint. It used to be a 6% white wash, which on a dark bar barely
// separated from it and left the tray reading as a smudge behind the chips. Sunk instead — darker
// than the bar, with a hairline lip — so the group looks cut into the surface and the chips sitting
// in it are unmistakably a set.
const NAV_GROUP = { display: "flex", alignItems: "center", gap: 3, background: "rgba(0,0,0,0.32)", borderRadius: 11, padding: 3, border: "1px solid rgba(255,255,255,0.07)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)" };
// 600, not 500. At 12px on a dark ground a 500 reads thin and slightly blurred; the weight is what
// makes the labels legible at a glance rather than something you have to look at twice.
const NAV_CHIP_BASE = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8, border: "none", background: "transparent", fontSize: NAV_FS, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", transition: "all 0.15s" };
// Square icon-only buttons (Deal Check, Logout) — equal footprint so they don't read as
// mis-sized text buttons next to the labelled chips.
const NAV_ICON_BTN = { ...NAV_CHIP_BASE, padding: 0, width: 32, height: 32, justifyContent: "center", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.30)", color: "rgba(255,255,255,0.72)", cursor: "pointer" };
// Hairline between right-hand clusters, so each change of meaning is visible.
const NAV_RULE = { width: 1, height: 22, background: "rgba(255,255,255,0.1)", flexShrink: 0 };
// No wave wash in the bar. Event Info's ground works on a full page, where the bands are large and
// slow and there is room for them to be atmosphere. Compressed into a 60px strip they have to move
// fast and sit bright to register at all, and at that point they are competing with the one row of
// controls the whole app navigates by.
import {
  DEFAULT_TAX, ZONE_META, ZONE_LABELS, ZONE_PRESETS, BASE_RATES,
  getCat, taxOr, FUNCTIONS, CATEGORIES, SHIFT_LETTER,
  carpetPricingFor, CARPET_OFF, trussRateFor, maskingRateFor, platformRateFor, platformRowCost, trussBaseArea, TRUSS_MATERIALS, DRAPE_DENSITIES,
  resolveVenueGensets,
} from "../../lib/studio/taxonomy";

import { RC_D, RC_CATS_DEFAULT } from "../../lib/studio/constants";
import {
  resolveTrussConfig, findZoneForArea, findAreaForZone, makeZoneId,
  defaultZoneFromArea, resolveMandiFlower, calcZoneTrussPreview,
  calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan, getStudioAvailable,
  buildTopology, PLATFORM_FATTA_CODE, PLATFORM_STAND_CODE, trussRowCost,
} from "../../lib/studio/pricing";
import { callClaudeStreaming } from "../../lib/ai";
import { heavyExtraLabour, eventTimingMultFor } from "../../lib/ims/constants";
import { itemImsSubcat, lookupBySubcat, priceForInvItem, itemDimsText } from "../../lib/ims/helpers";
import { matchFlowerPattern, floralPatternUnitRates, sizeClassToPatternKey, normalizeSizeClass, kitFloralCompDelta } from "../../lib/ims/flowerHelpers";
import { rowToRcItem, rcItemToRow, rcIsSMB, getFloralMode } from "../../lib/rateCard";
import { supabase, fetchAll, upsertRow, deleteRow, subscribeTable } from "../../lib/supabase";
import {
  rowToLibItem, libItemToRow, fetchLibraryItemsByIds, fetchLibraryItemsByUrls,
  fetchZoneLibraryPhotos, fetchCustomZoneLibraryPhotos, fetchUntaggedLibraryTargets,
  fetchVerifiedLibraryPhotos, checkExistingLibraryUrls, TAG_SOURCE,
} from "../../lib/studio/libraryQueries";
import { rowToItem } from "../../lib/inventory/adapter";
import { VENUE_MIG_SK, LEGACY_VENUE_SEED } from "../../lib/studio/venues";
import {
  STORAGE_KEY, AMBRIA_PLAYLIST_ID, CLD_CLOUD,
  YT_SK, YT_TAG_SK, MANUAL_VID_SK, HIDDEN_VID_SK, FAV_VID_SK, FAV_PHOTO_SK,
  NOTIF_SK, DT_SK, PIMAP_SK, SCAN_HIST_SK,
  IMS_SETTINGS_SK, STUDIO_LMS_CACHE_SK, PALETTE_SK,
  DC_RUN_COUNTER_SK, DC_CACHE_SK, FLORAL_HARDPROP_MAP_SK, SOFT_HOLDS_SK,
  TRUSS_ALLOC_SK, FILTER_PRIORITY_SK, DEFAULT_FILTER_PRIORITY,
  RC_SK_CATS, RC_SK_TR, TR_TIERS, TC_UNITS, TPL_SK, ZONE_DEF_SK, TEAM_SK, TAX_SK, TAX_BOTH_MIG_SK, TAG_KB_SK,
  TAG_HIDDEN_SUBS_SK, PREMIA_CFG_SK, ZONE_GROUPS_SK, CUSTOM_ZONE_TAG_PREFIX,
} from "../../lib/studio/keys.js";
import { normaliseZoneGroups, groupIdsForZones, setGroupIds } from "../../lib/studio/zoneGroups.js";
import { rowToVideoTag, videoTagToRow, rowsToVideoTagMap } from "../../lib/studio/videoTags.js";
import { logWrite, installActionLogFlush } from "../../lib/studio/userActions.js";
import { buildTagKB, renderTagKBText } from "../../lib/studio/tagKB.js";
import { fetchRecentCorrections, renderCorrectionsText } from "../../lib/studio/tagFeedback.js";
import { logPhotoCorrection, fetchPhotoCorrections } from "../../lib/studio/photoCorrections.js";
// AI-tagging matcher core — extracted from the inline copy that used to live in aiTagImage so the
// scoring/thresholds sit in one testable module (spec §9-A / §12.1).
import { createMatcher, normalize, STRUCT_KW, STRUCTURAL_CATS as RAW_SCAFFOLD_CATS, MATCH } from "../../lib/studio/tagging/matcher.js";
// One place that merges an aiTagImage() result onto a library photo (spec §9-B / §12.2).
import { applyAiTagResult } from "../../lib/studio/tagging/applyResult.js";
import { fnSnapHasData as fnSnapHasDataPure, fnSnapHasBuild, autoSaveWouldDestroy, snapshotContentEqual } from "../../lib/studio/sessionData.js";
import { LOGO_ASSET, logoCrop } from "../../lib/studio/brand.js";
import { registerFlushBeforeReload, unregisterFlushBeforeReload } from "../../lib/pendingSaveRegistry.js";

// ═══════════════════════════════════════════════════════════════
// MODULE-SCOPE CONSTANTS / HELPERS — copied VERBATIM from the reference.
// (Constants that already live in our libs are imported above.)
// ═══════════════════════════════════════════════════════════════
const YT_CACHE_TTL = 60 * 60 * 1000; // 1h — YouTube playlist cache TTL

const fmt = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;

// ══ TEAM / USERS ══
const TEAM = { tarun: { name: "Tarun", pw: "ambria@admin", role: "admin" } };
const ROLES = ["admin", "manager", "sales"];
const PERM_LABELS = { canViewPricing: "View pricing & costs", canEditEvents: "Add / edit events", canManageTemplates: "Manage templates", canManageLibrary: "Manage library", canExport: "Export data", canManageVenues: "Manage venues", canManageUsers: "Manage users" };
const ROLE_DEFAULTS = { admin: { canViewPricing: true, canEditEvents: true, canManageTemplates: true, canManageLibrary: true, canExport: true, canManageVenues: true, canManageUsers: true }, manager: { canViewPricing: true, canEditEvents: true, canManageTemplates: false, canManageLibrary: true, canExport: false, canManageVenues: false, canManageUsers: false }, sales: { canViewPricing: false, canEditEvents: false, canManageTemplates: false, canManageLibrary: false, canExport: false, canManageVenues: false, canManageUsers: false } };
const DEFAULT_TEAM = Object.fromEntries(Object.entries(TEAM).map(([id, u]) => ([id, { ...u, active: true, perms: { ...(ROLE_DEFAULTS[u.role] || ROLE_DEFAULTS.sales) }, assignedVenues: [], venueScope: u.role === "admin" ? "all" : "outside", defaultVenue: "" }])));

// The brand mark and its measured crop now live in lib/studio/brand.js — the cost sheet's own header
// wanted the wordmark too, and six measured numbers copied into a second file is how one header ends
// up cropping into the letters after a re-export while the other still looks right.

// ══ AMBRIA PREMIA (Platinum gate) — fully editable copy & CTA ══
// The point of this gate is a sales one, not a policy one: a Platinum look isn't one designer
// clicking through Studio, it's Design, Floral and Production sitting down together and building
// it end-to-end as a team — the same collaboration we'd put behind the client's own event. That's
// why it can't be self-served here, and framing it that way (not just "you can't do this") is what
// turns a dead end into a reason to book time with us.
const PREMIA_DEFAULTS = {
  badge: "AMBRIA PREMIA",
  title: "A Platinum-level design",
  subtitle: "This isn't the work of one designer",
  body: "Looks like this aren't built by one person clicking through options — they come out of a real sit-down: our Design, Floral and Production leads in one room, brainstorming every detail together, the same way we'd do it for your own event.\n\nThat kind of collaboration can't be replicated by editing a template. Book a planning session with our Ambria Premia team and get that same senior, whole-studio treatment for your celebration.",
  closeLabel: "Maybe later",
  ctaLabel: "Book a Design Session",
  ctaUrl: "mailto:sales@ambria.in?subject=Ambria%20Premia%20-%20Design%20Session%20Request",
};

const TAX_LABELS = { eventType: "Event type", venueType: "Venue type", areasElements: "Areas & elements", colorPalette: "Color palette", tier: "Tier", categoryTier: "Category tier (legacy)", designStyle: "Design style", timeSetting: "Time / setting" };

// TC_UNITS and TR_TIERS moved to lib/studio/keys.js — IMS mounts this same Transport editor now,
// so both apps read one definition instead of keeping a second copy that drifts.

// ═══ TRANSPORT DEFAULTS (4-tier venue pricing + truck capacity + buffer) ═══
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

// ═══ STRUCTURAL COST (module scope, deterministic) — VERBATIM (extracted per-row below to support
// zoneConfig[k].extraTrussRows/extraPlatformRows — additional truss structures/platform footprints
// in the same zone, beyond the zone's own single "row 0" scalar fields) ═══
// trussRowCost moved to lib/studio/pricing.js — the zone editor prices each truss card with it.
// platformRowCost moved to lib/studio/taxonomy.js — the zone editor needs the same function to
// show each floor card its own cost, and two copies of a pricing formula is how a card ends up
// disagreeing with the bill.
function calcStructCost(zk, zc, rates) {
  if (!zc) return { truss: 0, masking: 0, platform: 0, carpet: 0, arches: 0, pillars: 0, glass: 0, total: 0 };
  const d = zc.dims || {}, fd = zc.floorDims || d, r = { truss: 0, masking: 0, platform: 0, carpet: 0, arches: 0, pillars: 0, glass: 0 };
  // Material, drape density, and the ceiling-via-print toggle are all per-row — separate truss
  // structures in the same zone can be a different material, density, or handle their ceiling
  // differently, so each extra row carries its own (set via its own card in the zone editor).
  const trussRows = [
    { dims: d, trT: zc.trT, trussType: zc.trussType, trussQty: zc.trussQty, trussFrontExt: zc.trussFrontExt, trussFrontExtH: zc.trussFrontExtH, trussBackDepth: zc.trussBackDepth, mkOn: zc.mkOn, mkT: zc.mkT, mkWalls: zc.mkWalls, mkS: zc.mkS, trussMaterial: zc.trussMaterial, drapeDensity: zc.drapeDensity, customCeilingItemId: zc.customCeilingItemId, customMaskingItemId: zc.customMaskingItemId },
    ...(zc.extraTrussRows || []),
  ];
  trussRows.forEach((row) => { const { truss, masking } = trussRowCost(row, rates); r.truss += truss; r.masking += masking; });
  const platformRows = [{ plH: zc.plH, floorDims: fd, cpT: zc.cpT }, ...(zc.extraPlatformRows || [])];
  platformRows.forEach((row) => { const { platform, carpet } = platformRowCost(row, rates); r.platform += platform; r.carpet += carpet; });
  if (zc.archOn && zc.archT) { const aq = zc.archQty || 0, aw = zc.archW || 0, ah = zc.archH || 0; r.arches = aq * aw * ah * (BASE_RATES.arch[zc.archT] || 60); }
  if (zc.pillarQty) { r.pillars = (zc.pillarQty || 0) * BASE_RATES.pillar; }
  if (zc.glassOn && zc.glassT) { const gq = zc.glassQty || 0, gw = zc.glassW || 0, gh = zc.glassH || 0; r.glass = gq * gw * gh * (BASE_RATES.glass[zc.glassT] || 120); }
  r.total = r.truss + r.masking + r.platform + r.carpet + r.arches + r.pillars + r.glass; return r;
}
// Resolves a deal's actual genset units + cost from the matched venue's own counts (resolveVenueGensets
// — handles un-migrated legacy venues too) unless the deal explicitly overrides either size. null/undefined
// on an override means "follow the venue"; an explicit number, including 0, pins that size regardless of
// what the venue says. One shared function so the same resolution can't drift across its several call
// sites (totalCost, transportCalc, per-function breakdown, custom-venue auto-persist).
function resolveGensetPlan(match, customGenset125, customGenset62, gensetRate, gensetRate62) {
  const venue = resolveVenueGensets(match);
  const genset125 = (customGenset125 !== null && customGenset125 !== undefined) ? customGenset125 : venue.genset125;
  const genset62 = (customGenset62 !== null && customGenset62 !== undefined) ? customGenset62 : venue.genset62;
  const gensetCost = (Number(genset125) || 0) * (Number(gensetRate) || 0) + (Number(genset62) || 0) * (Number(gensetRate62) || 0);
  return { venueGenset125: venue.genset125, venueGenset62: venue.genset62, genset125, genset62, gensetCost };
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
      // A zone can carry more than one truss structure (row 0 = the zone's own scalar fields, plus
      // any z.extraTrussRows added via "+ Add Truss") — reserve stock for each independently.
      const rows = [z, ...(z.extraTrussRows || [])];
      rows.forEach((row, rowIdx) => {
        const layer0 = resolveTrussConfig(row);
        if (!layer0 || layer0.source === "none" || layer0.source === "invalid") return;
        const eng = trussInv?.settings || {};
        const L = parseFloat(row.dims?.L) || 0;
        const W = parseFloat(row.dims?.W) || 0;
        const H = parseFloat(row.dims?.H) || 0;
        const spanFt = layer0.spanFt || (layer0.source === "auto-3dim" ? Math.max(L, W) : 0);
        const backDepth = row.trussBackDepth || eng.defaultBackDepthFt || 4;
        const topology = buildTopology(layer0.config, L, W, H, spanFt, backDepth, eng);
        if (!topology) return;
        const alloc = allocateTruss(`${fn.fnIdx || 0}-${zoneKey}${rowIdx > 0 ? `-r${rowIdx}` : ""}`, topology, trussInv);
        if (!alloc) return;
        trusses.push({
          fnIdx: fn.fnIdx ?? 0,
          zoneKey: rowIdx > 0 ? `${zoneKey} (truss #${rowIdx + 1})` : zoneKey,
          trussConfig: layer0.config,
          allocation: alloc,
          shortage: !!alloc.shortage,
        });
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

// Whitespace-squeeze + lowercase key — same normalization matchFlowerPattern (src/lib/ims/
// flowerHelpers.js) uses, so a doubled internal space doesn't cause a false sub-category mismatch.
function squeezeKey(s) { return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase(); }

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
function getCardSpecsForZone(zoneElems, zoneKey, photoUrl, hardPropMap, rcItems, imsInventory) {
  if (!Array.isArray(zoneElems) || zoneElems.length === 0) return [];
  const out = [];
  const rcArr = Array.isArray(rcItems) ? rcItems : [];
  const invArr = Array.isArray(imsInventory) ? imsInventory : [];
  zoneElems.forEach((el, idx) => {
    if (!el) return;
    const rcName = el.name || "";
    if (!rcName) return;
    const qty = Number(el.qty) || 0;
    if (qty <= 0) return;  // skip elements with 0 qty (toggled off but still in array)
    // Pure flower-recipe element (no inventory item at all) — nothing to block/check availability
    // for, so it's simply never included as a card spec.
    if (el.patternId && !el.invId) return;
    // IMS inventory-sourced element (Library "+Add element") — the exact IMS row is already known,
    // so pin directly and skip Rate Card name-matching entirely (no rc lookup for these).
    if (el.invId) {
      const invItem = invArr.find(i => i.id === el.invId);
      out.push({
        cardKey: buildElCardKey(zoneKey, rcName, idx),
        kind: "el",
        rcName, rcCode: el.invId, qty,
        subcategory: invItem?.subCat || invItem?.subcategory || "",
        propType: null,
        photoUrl,
        pinnedImsId: el.invId,
      });
      return;
    }
    const rc = rcArr.find(i => String(i?.name || "").toLowerCase() === String(rcName).toLowerCase());
    const rcCode = rc?.id || "";
    // IMS sub-category alias: a Studio placeholder ("Centre Piece") auto-matches against its aliased IMS
    // sub-category ("Flower Pot Large") so cards resolve to the real shared stock. Blank alias = own sub.
    const subcategory = (rc?.imsAlias ? String(rc.imsAlias).trim() : "") || rc?.sub || "";
    const cat = String(rc?.cat || "").toLowerCase();
    const isFloral = cat === "florals" || /^F\d+$/.test(rcCode);
    // ── null and [] ARE NOT THE SAME ANSWER ──
    // lookupFloralMapping returns [] for a floral it KNOWS has no hard prop (reet, garland, petals,
    // flower garden — those really are just flowers, and there is nothing to reserve). It returns
    // null when it does not recognise the floral at all.
    // Both used to be dropped by the same guard, so any floral outside the six mapped names vanished
    // from Deal Check entirely and silently — "Wisteria Hanging SQFT 2.5ft" among them. Unknown is
    // not the same claim as "definitely has no prop", and guessing the stricter one loses work.
    // An unrecognised floral now falls through to the ordinary element card below, exactly as a
    // non-floral would: it appears in Deal Check with its Rate Card sub-category, where it can be
    // matched to an IMS item. If it genuinely has no prop, add it to the [] list in
    // lookupFloralMapping and it will stop appearing — but that becomes a decision someone made,
    // not something that happened.
    const floralMapping = isFloral ? lookupFloralMapping(rcCode, rcName, hardPropMap) : null;
    if (isFloral && Array.isArray(floralMapping) && floralMapping.length === 0) return;
    if (isFloral && Array.isArray(floralMapping)) {
      const mapping = floralMapping;
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
function computeTruckItems(zoneElements, zoneConfig, enabledEls, rcItems, truckCap, imsInventory, flowerPatterns) {
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
      // An element's sub-category for truck-capacity purposes comes ONLY from live IMS identity —
      // el.invId (Inventory, the normal path for anything added via "+ Add element" today) or
      // el.patternId (a pure flower-recipe element). No Rate-Card name-match fallback: Rate Card's
      // own `.sub` is a separate, older vocabulary that doesn't track IMS's live Sub-Categories
      // master, and letting a name coincidentally match a Rate Card row override the element's real
      // Inventory sub-category was how this silently misclassified trucking for some elements.
      const invItem = el.invId ? (imsInventory || []).find(i => i.id === el.invId) : null;
      const pattern = (!invItem && el.patternId) ? (flowerPatterns || []).find(p => p.id === el.patternId) : null;
      const sub = invItem?.subCat || invItem?.subcategory || pattern?.sub || "";
      const tc = capBySub[String(sub || "").toLowerCase().trim()]; if (!tc) return;
      if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(sub, L * W * (Number(el.qty) || 1)); }
      else addSub(sub, Number(el.qty) || 0);
    });
  });
  Object.entries(zoneConfig || {}).forEach(([zk, cfg]) => {
    if (!enabledEls[zk] || !cfg) return;
    // Zone dims use uppercase L/W/H (see buildZoneConfig) — this used to read lowercase dims.w/
    // dims.d, which never exist, so sqft was always 0 and every truss/platform/carpet truck-load
    // silently dropped out of Build's transport total (only element-based items ever counted).
    const d = cfg.dims || {}; const fd = cfg.floorDims || d;
    if (cfg.trT === "box") { const tSqft = (d.L || 0) * (d.W || 0) * Math.max(1, cfg.trussQty || 1); if (tSqft > 0) addSub("Truss", tSqft); }
    const sqft = (fd.L || 0) * (fd.W || 0);
    // cpT truthy AND not the explicit OFF sentinel — an untouched floor (cpT unset) gets no carpet
    // truck-load either, same as it gets no carpet cost (see CARPET_OFF in taxonomy.js).
    if (sqft > 0) { if (cfg.plH) addSub("Platform", sqft); if (cfg.cpT && cfg.cpT !== CARPET_OFF) addSub("Carpet", sqft); }
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

// `rowToRcItem`/`rcItemToRow` now live in `src/lib/rateCard.js` (shared with IMS's own Rate Card
// admin UI — Phase 3 of the Rate Card → IMS migration).
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
  // _fnRows is the per-function rows a session was rebuilt FROM (see rowsToSessions) — it is a view
  // of studio_sessions, not part of the client. Left in, the blob mirror would carry a second copy of
  // every build in every session: the same data this migration exists to stop duplicating.
  const data = Array.isArray(c?.sessions)
    // eslint-disable-next-line no-unused-vars
    ? { ...c, sessions: c.sessions.map(({ _fnRows, ...rest }) => rest) }
    : c;
  return {
    id: c.id, name: c.name || "", phone: c.phone ?? null, email: c.email ?? null,
    status: c.status || "ongoing", budget: Number(c.budget) || 0, created_by: c.createdBy ?? null,
    data,
  };
}
// How many saves a client keeps — in the array, in the table, everywhere. Browse spends six of them
// (the newest as the full card, the five after it in the collapsed list); the rest are headroom.
// One number, so the cut and the row-pruning can never disagree about what "kept" means.
const SESSION_KEEP = 10;

// ═══ `studio_sessions` TABLE ↔ the session shape the app already speaks (migration 026) ═══
// One row per SAVE per FUNCTION. The app's in-memory session keeps exactly the shape it has always
// had — fnSnapshots, fnTotals, savedActiveFnIdx, flat build fields — so every existing consumer
// (resume, the deck, Deal Check, the cost sheet) is untouched by the move. What changes is that the
// facts Browse needs per function are now READ from columns instead of guessed from the blob:
// fn_idx says which function a build belongs to, total says what that function costs, and
// source_video_id says which video it was built from. Those three guesses are where the wrong
// prices, blank cards and "no longer in library" flips all came from.

/** The rows one saved session becomes — one per function that has a snapshot. */
function sessionToRows(clientId, s) {
  if (!s || !s.id || !clientId) return [];
  const snaps = (s.fnSnapshots && typeof s.fnSnapshots === "object") ? s.fnSnapshots : {};
  const keys = Object.keys(snaps).filter((k) => /^\d+$/.test(k));
  // A session written before fnSnapshots existed carries its build in flat fields, and those belong
  // to Fn1 — the same reading Browse has always given them.
  const idxs = keys.length ? keys.map(Number).sort((a, b) => a - b) : [0];
  return idxs.map((i) => {
    const build = snaps[i] || snaps[String(i)] || null;
    const b = build || s;
    const isActive = keys.length ? s.savedActiveFnIdx === i : true;
    // BUILT on, not merely referenced from. A picked video rides along to every function, so the
    // looser test marked all of them as holding a build and one build showed up on every pill.
    const built = fnSnapHasBuild(b);
    const own = s.fnTotals && (s.fnTotals[i] || s.fnTotals[String(i)]);
    // A price only belongs to a function that HAS a build. Carried forward onto an empty one it was
    // a figure for something that is not there — which is how a ₹0 Wedding showed ₹6,90,091.
    const ownTotal = built && own && Number(own.total) > 0 ? Number(own.total) : null;
    return {
      id: `${s.id}:${i}`,
      session_id: s.id,
      client_id: clientId,
      fn_idx: i,
      saved_at: Number(s.savedAt) || 0,
      saved_by: s.savedBy || null,
      auto: !!s.auto,
      is_active_fn: !!isActive,
      has_data: built,
      fn_label: s.fn || null,
      event_date: s.eventDate || null,
      venue: s.venue || null,
      source_video_id: b?.sourceVideo?.id || b?.sourceVideoId || null,
      source_video_title: b?.sourceVideo?.title || b?.sourceVideoTitle || null,
      source_event_id: b?.sourceEvent?.id || b?.sourceEventId || null,
      source_event_name: b?.sourceEvent?.name || b?.sourceEventName || null,
      // The figure for THIS function: its own, else the session-level one but ONLY when the session
      // says that is where the number came from. Another function's price is not a fallback.
      total: ownTotal != null ? ownTotal : (built && isActive && Number(s.total) > 0 ? Number(s.total) : null),
      tier: ownTotal != null ? (own.tier || null) : (built && isActive ? (s.tier || null) : null),
      decor_total: isActive && s.decorTotal != null ? Number(s.decorTotal) : null,
      transport_total: isActive && s.transportTotal != null ? Number(s.transportTotal) : null,
      build: build || null,
    };
  });
}

/** Rows back into sessions, newest first — what client.sessions holds. */
function rowsToSessions(rows) {
  const bySession = new Map();
  for (const r of (rows || [])) {
    if (!r || !r.session_id) continue;
    let g = bySession.get(r.session_id);
    if (!g) { g = []; bySession.set(r.session_id, g); }
    g.push(r);
  }
  const out = [];
  for (const [sid, group] of bySession) {
    group.sort((a, b) => (a.fn_idx || 0) - (b.fn_idx || 0));
    // The function that was on screen when the save fired. Its build is what saveSession also wrote
    // to the session's flat fields, so spreading it first reproduces the original object exactly.
    const active = group.find((r) => r.is_active_fn) || group[0];
    const fnSnapshots = {};
    const fnTotals = {};
    for (const r of group) {
      if (r.build && typeof r.build === "object") fnSnapshots[r.fn_idx] = r.build;
      if (r.total != null && Number(r.total) > 0) fnTotals[r.fn_idx] = { total: Number(r.total), tier: r.tier || "" };
    }
    const base = (active.build && typeof active.build === "object") ? active.build : {};
    out.push({
      ...base,
      id: sid,
      savedAt: Number(active.saved_at) || 0,
      savedBy: active.saved_by || "—",
      auto: !!active.auto,
      eventDate: active.event_date || null,
      venue: active.venue || null,
      fn: active.fn_label || null,
      sourceVideoId: active.source_video_id || null,
      sourceVideoTitle: active.source_video_title || null,
      sourceEventId: active.source_event_id || null,
      sourceEventName: active.source_event_name || null,
      total: active.total != null ? Number(active.total) : undefined,
      tier: active.tier || undefined,
      decorTotal: active.decor_total != null ? Number(active.decor_total) : undefined,
      transportTotal: active.transport_total != null ? Number(active.transport_total) : undefined,
      savedActiveFnIdx: active.fn_idx,
      fnSnapshots,
      fnTotals,
      // The per-function rows as they came out of the table, so Browse can ask "this client, this
      // function" without deriving anything. Prefixed: not part of what gets written back.
      _fnRows: group,
    });
  }
  out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  // Capped on the way in as well as on the way out. Rows written before the cap existed, or left by a
  // prune whose delete failed, would otherwise come back as a longer history than the app keeps.
  return out.slice(0, SESSION_KEEP);
}

async function loadSessionRows() {
  const all = []; const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await supabase.from("studio_sessions")
      .select("*").order("saved_at", { ascending: false }).range(from, from + SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < SIZE) break;
  }
  return all;
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
  const [confirmToast, setConfirmToast] = useState(null);
  // The dialog can be dismissed three ways — Escape, the backdrop, the Cancel button — and the
  // promise form below has to settle on all of them or its caller waits forever. Routing every
  // dismissal through one closer is what makes that safe to rely on. Held in a ref as well as
  // state because the callback must fire outside the state updater (updaters have to stay pure).
  const confirmToastRef = useRef(null);
  const closeConfirm = useCallback((confirmed) => {
    const c = confirmToastRef.current;
    confirmToastRef.current = null;
    setConfirmToast(null);
    if (c) (confirmed ? c.onYes : c.onCancel)?.();
  }, []);
  // Escape cancels the confirm dialog — bound only while one is open, so it never competes with the
  // Escape handling on galleries and overlays.
  useEffect(() => {
    if (!confirmToast) return;
    const onKey = e => { if (e.key === "Escape") closeConfirm(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmToast, closeConfirm]);

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
  const [settingsView, setSettingsView] = useState("clients");
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
  const libItemsRef = useRef([]); // latest library array, for the background bulk-tagger to merge into
  const [bulkTag, setBulkTag] = useState({ running: false, done: 0, total: 0, ok: 0, fail: 0, finishedAt: 0 }); // app-wide bulk AI tagging progress
  const bulkTagStop = useRef(false);
  const [bulkVid, setBulkVid] = useState({ running: false, done: 0, total: 0, ok: 0, fail: 0, finishedAt: 0 }); // app-wide bulk VIDEO AI tagging progress
  const bulkVidStop = useRef(false);
  const [bulkVidVenue, setBulkVidVenue] = useState({ running: false, done: 0, total: 0, ok: 0, skip: 0, fail: 0, finishedAt: 0 }); // venue-only backfill progress (see runBulkTagVideoVenues)
  const bulkVidVenueStop = useRef(false);
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
  const [libAiLoading, setLibAiLoading] = useState(false);
  const [zoneAiFilling, setZoneAiFilling] = useState({});
  const [zoneElSearch, setZoneElSearch] = useState({});
  const [zonePrintSearch, setZonePrintSearch] = useState({}); // per-print-row "link to inventory item" search text, keyed by print row id
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
  // Has the ledger come back from the database yet? An EMPTY ledger and a NOT-YET-LOADED ledger are
  // the same [] to anything reading it, and they mean opposite things: "this client has no saved
  // work" versus "we do not know yet". Browse was answering the first while the truth was the
  // second — see the skeleton condition there.
  const [ledgerReady, setLedgerReady] = useState(false);
  const [activeClientId, setActiveClientId] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  // The identity (name/phone) an ACTIVE client last loaded with, or was confirmed-renamed to.
  // Guards Event Info's Guest Name/Phone fields from silently autosaving over the active deal:
  // typing something different is not treated as a deliberate rename until confirmClientRename
  // is called (see saveSession's pendingUnconfirmedRename and the inline confirm UI in
  // StudioEventInfo). Without this, glancing back at Event Info mid-deal and typing anything —
  // even just to see what shows up — got captured by the very next autosave and silently
  // overwrote the client's real name/phone with whatever partial text was sitting in the box.
  const loadedClientIdentityRef = useRef({ name: "", phone: "" });
  const confirmClientRename = useCallback(() => {
    loadedClientIdentityRef.current = { name: clientName.trim(), phone: clientPhone.trim() };
  }, [clientName, clientPhone]);
  const revertClientNameEdit = useCallback(() => {
    setClientName(loadedClientIdentityRef.current.name);
    setClientPhone(loadedClientIdentityRef.current.phone);
  }, []);
  // Remember the active deal pointer + screen across a refresh / Studio↔IMS route switch (per-tab). The
  // build data itself lives in the client's rolling auto-session; these just say WHICH deal + WHERE to
  // restore on mount (see the restore effect after loadClientSession).
  //
  // Read during the FIRST RENDER, not inside the restore effect. The three persist effects below all
  // fire on mount with the initial state — activeClientId null, step 0 — so by the time the restore
  // effect ran, the client pointer had been removeItem'd and the step overwritten with "0". Restore
  // then found nothing and dropped every refresh back onto Event Info. Snapshotting here happens
  // before any effect, so the values survive.
  const restoreRef = useRef(null);
  if (restoreRef.current === null) {
    let id = null, st = null, fn = 0;
    try { id = sessionStorage.getItem("ambria-active-client") || null; } catch { /* storage disabled */ }
    try { const s = parseInt(sessionStorage.getItem("ambria-studio-step"), 10); if (!isNaN(s)) st = s; } catch { /* */ }
    try { fn = parseInt(sessionStorage.getItem("ambria-active-fn"), 10) || 0; } catch { /* */ }
    restoreRef.current = { id, step: st, fn };
  }
  // True from the very first render whenever there is a deal to bring back. The ledger loads async,
  // so without this the app rendered step 0 — Event Info — for the second or two until restore
  // fired, then jumped to Browse/Build. Gate the step body on it and that flash never happens.
  //
  // Step 0 is excluded: a refresh ON Event Info deliberately starts a clean form, so there is
  // nothing to wait for and no reason to show the gate.
  const [restoring, setRestoring] = useState(() => {
    const r = restoreRef.current;
    return !!(r?.id && r.step !== 0);
  });
  useEffect(() => { try { if (activeClientId) sessionStorage.setItem("ambria-active-client", activeClientId); else sessionStorage.removeItem("ambria-active-client"); } catch { /* storage disabled */ } }, [activeClientId]);
  useEffect(() => { try { sessionStorage.setItem("ambria-studio-step", String(step)); } catch { /* */ } }, [step]);
  // Each step/tab swaps the whole page body while the document keeps scrolling — so the browser
  // carries the previous screen's scroll offset over. Continue lives at the bottom of a long
  // Event Info form, so Browse used to open already scrolled to the bottom. Reset on every
  // step / mode / manage-tab change. Instant, not smooth: this is a page change, not a jump
  // within one, and animating it would look like the old screen sliding away.
  useEffect(() => {
    try { window.scrollTo(0, 0); } catch { /* non-browser env (SSR/tests) */ }
  }, [step, mode, manageTab]);
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
  // Guards savePaletteData against the mount race that wiped a real palette catalogue on
  // 2026-07-27: the initial PALETTE_SK fetch sits behind ~24 other sequential kvGet calls, so for a
  // moment after mount imsPaletteCatalogue is still its useState([]) default — genuinely empty, not
  // "confirmed empty from the DB". Saving during that window overwrites real data with nothing.
  // Both flip true once the fetch below has had its one chance to populate state, whatever it found
  // — the ref is the actual save-time guard (doesn't need a re-render), the state drives the Manage
  // Library Palettes tab showing "Loading…" instead of a confidently-empty, clickable "+ Add" panel.
  const paletteLoadedRef = useRef(false);
  const [paletteCatalogueLoaded, setPaletteCatalogueLoaded] = useState(false);
  const [imsPaintableCategories, setImsPaintableCategories] = useState(["Props", "Arches", "Panels", "Pillars", "Glass", "Structural", "Furniture", "Stage", "Consumable", "Arches & Props", "Wall Masking"]);
  const [imsDefaultPaintCost, setImsDefaultPaintCost] = useState(400);
  // AI Synonym Dictionary (IMS Admin → Settings → 🔤 AI Synonyms, e.g. Jali/Lattice/Mesh/Screen) —
  // lets ops teach the AI tagger that two different words mean the same physical thing, without a
  // code change every time a naming mismatch turns up. Fed into aiTagImage's keyword-overlap scoring.
  const [imsSynonymDictionary, setImsSynonymDictionary] = useState([]);
  // Print material rates (IMS Admin → Settings → 🖨️ Print Materials, e.g. Flex/Vinyl/Sunboard
  // ₹/sqft) — read by Library's per-element Print section to price a print job.
  const [imsPrintMaterials, setImsPrintMaterials] = useState([]);
  // Carpet material rates (IMS Admin → Settings → 🟫 Carpet Materials) — its own master list, no
  // longer piggybacking on Print Materials (a real print-job catalogue with an unrelated purpose).
  const [imsCarpetMaterials, setImsCarpetMaterials] = useState([]);
  // IMS Admin → Settings → 🏗️ Truss & Masking Rates (settings.trussRates/maskingRates) — falls back
  // to DEFAULT_TRUSS_RATES/DEFAULT_MASKING_RATES via trussRateFor/maskingRateFor until customized.
  const [imsTrussRates, setImsTrussRates] = useState([]);
  const [imsMaskingRates, setImsMaskingRates] = useState([]);
  // IMS Admin → Settings → 🪵 Platform Rates (settings.platformRates) — falls back to
  // DEFAULT_PLATFORM_RATES via platformRateFor until an admin edits one.
  const [imsPlatformRates, setImsPlatformRates] = useState([]);
  // Bundled live rate settings passed to calcStructCost everywhere — one object instead of a
  // growing list of positional args as more of these settings-driven rates get added.
  // Save colour + palette catalogues to Studio-owned PALETTE_SK
  const savePaletteData = useCallback((colours, palettes) => {
    if (!paletteLoadedRef.current) {
      showMsg("Still loading the palette catalogue — try again in a moment", "red");
      return;
    }
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
  // Manpower/Transport/Power are booking-wide rollups — by default they scope to whichever
  // function is selected in the FUNCTIONS sidebar (matching Inventory/Production/Buying), and
  // this flips them to show every function's data at once when the sidebar's "All" pill is on.
  // Selecting a specific function clears it back off, so "All" never silently lingers.
  const [dcShowAllFns, setDcShowAllFns] = useState(false);
  // Explicit open/collapsed overrides for individual function/day blocks in Manpower & Transport,
  // keyed per-tab (e.g. "transport:2", "manpower:2026-08-25). Undefined = no override yet — the
  // block falls back to its default (open when one function is selected, collapsed under "All",
  // so switching to "All" doesn't leave every block expanded and scrolling right back to square one).
  const [dcCollapsedFnBlocks, setDcCollapsedFnBlocks] = useState({});
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
  // Per-element/per-reference stock availability picker — { zoneKey, idx, elName, subcat, date,
  // loading, items, selectedId, onPick }. Lifted here (rather than staying local to StudioBuild)
  // so both Build's own 📦 icon AND the Add Production/Buying Item modal (StudioModals.jsx) can
  // trigger the exact same picker instead of each growing its own copy.
  const [availModal, setAvailModal] = useState(null);
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

  // ═══ ZONE PHOTO FILTERS (Build canvas) — seeded from a reference video's own taxonomy when
  // customizing off it (see pickAndLoad), otherwise starts at "All"; always user-adjustable from
  // here via the 🔍 filter, never auto-reapplied afterwards. ═══
  // Holds the KEY of the zone whose photo-filter panel is open, or null. It used to be a plain
  // boolean, which every zone read -- so opening the filter on one zone opened it on all of them
  // at once. Keying it also makes "only one open at a time" fall out for free.
  const [zpFilterOpen, setZpFilterOpen] = useState(null);
  const [zpFilters, setZpFilters] = useState({ eventType: [], venueType: [], designStyle: [], colorPalette: [], timeSetting: [], venue: [] });
  const zpToggleFilter = useCallback((cat, val) => {
    setZpFilters(prev => ({ ...prev, [cat]: prev[cat].includes(val) ? prev[cat].filter(v => v !== val) : [...prev[cat], val] }));
  }, []);
  const zpHasFilters = Object.values(zpFilters).some(a => a.length > 0);
  // Which categories HIDE a photo. Event type and colour palette are the two the salesperson never
  // wants a mismatch on — a Haldi build in Pink & Blue has no use for a Reception stage in Maroon &
  // Gold, no matter how well it otherwise matches. Everything else (venue, venue type, design style,
  // time/setting) ranks instead of hiding (see zpVenueMatch / zpVenueTypeMatch / zpDesignStyleMatch /
  // zpTimeSettingMatch below): too little is tagged along those dimensions for an exact match to
  // leave enough photos to build a zone from, so a partial match should still surface, just lower.
  const zpFilterPhoto = useCallback((li) => {
    if (!li) return true;
    const tags = li.tags || {};
    const evVals = zpFilters.eventType || [];
    if (evVals.length) {
      const it = tags.eventType || [];
      if (!evVals.some(v => it.includes(v))) return false;
    }
    const palVals = zpFilters.colorPalette || [];
    if (palVals.length && !palVals.some(v => paletteInList(tags.colorPalette || [], v))) return false;
    return true;
  }, [zpFilters]);
  // Palette is now enforced above (zpFilterPhoto) — every photo reaching the sort step already
  // matches it, or no palette was picked. Kept as its own function only for that "no preference"
  // check to stay in one place; not used for ranking anymore (nothing left to rank by).
  const zpPaletteMatch = useCallback((li) => {
    const vals = zpFilters.colorPalette || [];
    if (!vals.length) return true;
    if (!li) return true;
    return vals.some(v => paletteInList(li.tags?.colorPalette || [], v));
  }, [zpFilters]);
  // Venue is a preference, not a filter: too few photos are tagged per venue for an exact match to
  // leave enough to build from, so the zone strips rank the chosen venue first and keep the rest
  // rather than hiding them. Matches the photo's venue TAG or its folder path — photos are often
  // filed under "inhouse venues/<venue>/…" — so picking "Emerald Green" also catches ones that only
  // carry it in the path. True when nothing is picked, i.e. no preference to express.
  const zpVenueMatch = useCallback((li) => {
    const venueVals = zpFilters.venue || [];
    if (!venueVals.length) return true;
    if (!li) return true;
    let url = ""; try { url = decodeURIComponent(String(li.url || "")); } catch { url = String(li.url || ""); }
    const hay = (String(li.tags?.venue || "") + " " + url).toLowerCase();
    return venueVals.some(v => hay.includes(String(v).toLowerCase()));
  }, [zpFilters]);
  // venueType / designStyle / timeSetting — demoted from the old hard-filter loop to the same kind
  // of rank-not-hide preference as venue/palette used to be, for the same reason: too few photos
  // carry an exact match along these to leave enough to build a zone from.
  const zpVenueTypeMatch = useCallback((li) => {
    const vals = zpFilters.venueType || [];
    if (!vals.length) return true;
    if (!li) return true;
    return vals.some(v => (li.tags?.venueType || []).includes(v));
  }, [zpFilters]);
  const zpDesignStyleMatch = useCallback((li) => {
    const vals = zpFilters.designStyle || [];
    if (!vals.length) return true;
    if (!li) return true;
    return vals.some(v => (li.tags?.designStyle || []).includes(v));
  }, [zpFilters]);
  const zpTimeSettingMatch = useCallback((li) => {
    const vals = zpFilters.timeSetting || [];
    if (!vals.length) return true;
    if (!li) return true;
    return vals.some(v => (li.tags?.timeSetting || []).includes(v));
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
  // Which seed zone type the "+ Add Zone" picker is on. A zone key means the zone it adds is a second
  // Stage / Entry Passage / … and behaves exactly like the original — photo strip, elements, truss,
  // platform, pricing — via customZones[].sourceType. "" is just the unpicked placeholder.
  const [newCzSrc, setNewCzSrc] = useState("");
  const [elGallery, setElGallery] = useState(null);
  const [galleryIdx, setGalleryIdx] = useState(null);
  const [webPreview, setWebPreview] = useState(null);
  const [zoneConfig, setZoneConfig] = useState({});
  const [activeZones, setActiveZones] = useState([]);
  const [rcItems, setRcItems] = useState(RC_D);
  const [rcCats, setRcCats] = useState(RC_CATS_DEFAULT);
  const [rcSubcatFactors, setRcSubcatFactors] = useState([]); // IMS-owned; read-only here until Phase 2
  // IMS inventory, always-on (not deal-scoped like dealCheckData.inventory) — needed by Library's
  // "+Add element" search, which sources directly from inventory now, not the Rate Card.
  const [imsInventory, setImsInventory] = useState([]);
  // Blocks for just the active function's date — warms once loadAvailability/activeFnMeta exist
  // below. Powers Build view's availability-aware pricing for invId-sourced elements only.
  const [activeBlocksForDate, setActiveBlocksForDate] = useState({});
  // Same thing, but for EVERY function's own date, not just whichever one is the open Build tab —
  // { [date]: blocksForDate }. eventGrandTotal/calcFunctionBreakdown need each function's shortfall
  // priced against ITS OWN date, not the active function's; without this, checking availability at
  // all was restricted to the active function only (activeBlocksForDate has no other date to check
  // against), which meant the shortfall discount silently moved to whichever function you had open —
  // the combined total shifted every time you switched tabs, nothing about the event having changed.
  const [blocksByDate, setBlocksByDate] = useState({});
  const [libElSearch, setLibElSearch] = useState("");
  const [trVenues, setTrVenues] = useState(TR_DV);
  const [truckCap, setTruckCap] = useState(TR_DTC);
  // Flips true once the RC_SK_TR settings row has actually been fetched (found data or confirmed
  // there's none) — trVenues/truckCap start out holding TR_DV/TR_DTC seed defaults until then, and
  // a write gated on trVenues alone (below, the genset migration) would fire on THAT seed state
  // during the async fetch's window and persist the seed truckCap over whatever was really saved.
  const trSettingsLoadedRef = useRef(false);
  const [floralPerTruck, setFloralPerTruck] = useState(50000);
  // Two genset sizes are hired, and an event can need BOTH — a big unit plus a smaller one — so
  // each size carries its own count. 125 KVA keeps the original `gensetRate` key and the existing
  // customGensets override; 62 KVA mirrors it with its own override — null means "follow the
  // venue's own 62 KVA count" (resolveVenueGensets), an explicit number (0 included) pins it.
  const [gensetRate, setGensetRate] = useState(28000);      // 125 KVA
  const [gensetRate62, setGensetRate62] = useState(18000);  // 62 KVA
  const [genset62, setGenset62] = useState(null);           // override for the smaller unit, per deal — null = follow venue
  const [bufferTiers, setBufferTiers] = useState(TR_DBT);
  const [newVenue, setNewVenue] = useState({ tier: "inhouse", name: "", rate: 0, gensets: 1 });
  const [newTC, setNewTC] = useState({ item: "", perTruck: 0, unit: "pc" });

  // ═══ TEMPLATE STATE ═══
  const [templates, setTemplates] = useState(TPL_DEFAULTS);
  const [tplEdit, setTplEdit] = useState(null);
  const [tplTab, setTplTab] = useState("list");

  // ═══ ZONE PHOTO GROUPS ═══ { [areaName]: { [functionType]: [libraryPhotoId, …] } }
  // Hand-picked in Manage → Library → Grouping; Build floats the group for the active function to
  // the front of that zone's strip. See lib/studio/zoneGroups.js for the shape and the lookup rules.
  const [zoneGroups, setZoneGroups] = useState({});
  // Mirror of the above. writeZoneGroup needs the pre-save value to roll back to, and reading it
  // from a ref keeps the callback free of a zoneGroups dependency — otherwise every group edit
  // would mint a new writeZoneGroup, and with it a new getLibPhotosForZone.
  const zoneGroupsRef = useRef({});

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
    customGensets, genset62, customTripRate,
    floralOverrides,
  });
  // Lives in lib/studio/sessionData now, so the SAVE path and Browse's banner cannot drift apart on
  // what counts as "has data" — they disagreeing is what let an empty auto-save erase a visible card.
  const fnSnapHasData = (snap) => {
    return fnSnapHasDataPure(snap);
  };
  const restoreBuildState = (s) => {
    if (!s) {
      setEnabledEls({}); setElTiers({}); setZoneConfig({}); setZoneElements({});
      setItemQty({}); setItemGrades({}); setCustomMode({}); setActiveZones([]);
      setCustomZones([]); setElSelectedPhoto({}); setElInspo({}); setElNotes({});
      setElCostOpen({}); setSourceVideo(null); setSourceEvent(null);
      setSavedInsps([]); setSelectedMoods([]); setSelectedPalettes([]); setFloralRatio(70);
      setCustomGensets(null); setGenset62(null); setCustomTripRate(0);
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
    setGenset62(typeof s.genset62 === "number" ? s.genset62 : null);
    setCustomTripRate(typeof s.customTripRate === "number" ? s.customTripRate : 0);
    setFloralOverrides(
      s.floralOverrides && typeof s.floralOverrides === "object"
        ? { note: s.floralOverrides.note || "", rows: Array.isArray(s.floralOverrides.rows) ? s.floralOverrides.rows : [] }
        : { note: "", rows: [] }
    );
  };
  // ═══ FUNCTION SWITCH ═══
  // Everything here is read from refs rather than the render closure. A switch re-renders the whole
  // build, which is slow enough that a second click lands while React is still working — and that
  // click's handler comes from the last COMMITTED render, i.e. before the first switch. Reading
  // `activeFnIdx` and `fnBuilds` from that stale closure was losing client data two ways:
  //
  //   1. `fnBuilds[newIdx]` read a stale map, so switching back to a function whose build had only
  //      just been stored restored `null` instead — blanking it on screen, after which the 1.5s
  //      autosave wrote that blank over the client's saved session.
  //   2. The outgoing snapshot was filed under the stale index, so it could overwrite a DIFFERENT
  //      function's build with this one's.
  //
  // Refs are updated at commit, so curIdx/builds/snapshot always agree with each other, and the ref
  // is advanced synchronously below so a burst of clicks chains correctly instead of each one
  // starting from the same stale point.
  const activeFnIdxRef = useRef(0);
  const fnBuildsRef = useRef({});
  const snapshotFnRef = useRef(null);
  const switchingRef = useRef(false);
  // Set whenever loadClientSession runs — i.e. a fresh visit/meeting has just been opened, whether
  // starting clean or resuming a past draft. The rolling auto-save below normally collapses
  // consecutive auto-drafts into the same array slot (so a 15s background timer doesn't spam the
  // history) — but that collapsing must not carry across a Load, or the new meeting's first autosave
  // overwrites the very session that was just resumed, silently erasing the prior meeting's build.
  // saveSession clears this on the first save after a load, so collapsing resumes as normal within
  // the new meeting.
  const sessionBoundaryRef = useRef(false);
  useEffect(() => { activeFnIdxRef.current = activeFnIdx; switchingRef.current = false; }, [activeFnIdx]);
  useEffect(() => { fnBuildsRef.current = fnBuilds; }, [fnBuilds]);
  useEffect(() => { snapshotFnRef.current = snapshotBuildState; });

  // Rebuilding a function's whole canvas is heavy enough to block for a moment. Marked as a
  // transition so React keeps the page interactive while it renders and tells us it's working
  // (`isFnSwitching`) — a plain flag set alongside the switch would commit in the same batch as
  // the finished render, so it could never be seen. `fnPending` is the one URGENT update: the pill
  // has to light up on click, otherwise the click reads as ignored and gets repeated.
  const [isPendingFnRender, startFnSwitch] = useTransition();
  const [fnPending, setFnPending] = useState(null);
  useEffect(() => { setFnPending(null); }, [activeFnIdx]);

  // ═══ THE BUSY WINDOW ═══ "You clicked, and what's on screen is not yet this function."
  //
  // Neither `isPending` nor comparing fnPending to activeFnIdx is reliable on its own: both depend
  // on React giving us a render BETWEEN the click and the switch committing, and when it schedules
  // the urgent update together with the transition there is no such render — the flag flips true
  // and false within one commit and the loading state never paints. That's why the stale card kept
  // showing through.
  //
  // So the busy flag is owned outright and held for a minimum, guaranteeing the loading state is
  // actually seen and that a stale card can never flash in its place. It stays up longer if the
  // switch itself takes longer.
  const FN_BUSY_MIN_MS = 400;
  const [fnBusy, setFnBusy] = useState(false);
  const fnBusyStartRef = useRef(0);
  // Runs once the new index has committed — i.e. the switch is done — then waits out whatever is
  // left of the minimum so the message doesn't blink.
  useEffect(() => {
    if (!fnBusyStartRef.current) return;
    const left = Math.max(0, FN_BUSY_MIN_MS - (performance.now() - fnBusyStartRef.current));
    const t = setTimeout(() => { fnBusyStartRef.current = 0; setFnBusy(false); }, left);
    return () => clearTimeout(t);
  }, [activeFnIdx]);
  // A BACKSTOP, NOT A SECOND TIMER. The effect above releases fnBusy when the new index commits —
  // but ONLY then, because activeFnIdx is its only dependency. If a switch never commits (an
  // exception inside the transition, before setActiveFnIdx, is the realistic way) that effect never
  // re-runs and fnBusy stays true for the rest of the session: every Customize and Resume button
  // disabled, every pill stuck on the progress cursor, and no way out but a reload. A switch that
  // has not landed in three seconds is not one that is still working. In the normal case the effect
  // above has already cleared the flag long before this fires, so this changes nothing.
  useEffect(() => {
    if (!fnBusy) return;
    const t = setTimeout(() => { fnBusyStartRef.current = 0; setFnBusy(false); }, 3000);
    return () => clearTimeout(t);
  }, [fnBusy]);
  const isFnSwitching = fnBusy || isPendingFnRender;
  // ── THE AUTOSAVE HAS TO SEE THE SAME "STILL SWITCHING" THE UI DOES ──
  // switchingRef (above) is cleared the moment activeFnIdx commits, but the switch is not finished
  // there: isPendingFnRender stays true while the transition renders, and fnBusy holds the minimum
  // spinner. In that window the ref said "not switching" while the build state was still settling,
  // so an autosave could land on a half-loaded function and write its total as 0 — which is exactly
  // the ₹0 that appeared on the saved-session card before the real figure replaced it.
  // A ref, not the state, because autoSaveBuild is called from timers and listeners that hold a
  // stale closure — the same reason activeFnIdxRef exists.
  const fnSwitchingRef = useRef(false);
  useEffect(() => { fnSwitchingRef.current = isFnSwitching; }, [isFnSwitching]);
  // Dev-only timing for the switch. It re-renders the whole of StudioApp and invalidates ten
  // memo chains, so "it's slow" needs a number before anything is optimised — guessing at the hot
  // spot is how you end up rewriting the wrong thing. Logs the click→committed duration.
  const fnSwitchStartRef = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV || !fnSwitchStartRef.current) return;
    const ms = Math.round(performance.now() - fnSwitchStartRef.current);
    fnSwitchStartRef.current = 0;
    console.info(`[ambria] function switch → idx ${activeFnIdx} took ${ms}ms`);
  }, [activeFnIdx]);

  const switchActiveFn = (newIdx) => {
    const curIdx = activeFnIdxRef.current;
    if (newIdx === curIdx) { setFnPending(null); return; }
    fnSwitchStartRef.current = performance.now();
    // Urgent and first: the loading state must be on screen before any of the heavy work below.
    fnBusyStartRef.current = performance.now();
    setFnBusy(true);
    let builds = fnBuildsRef.current;
    // Only snapshot when a switch ISN'T already in flight. Mid-switch the live state still belongs
    // to the function we just left — which has already been stored — so snapshotting again would
    // file it under the function we are now leaving and destroy that one's real build.
    if (!switchingRef.current) {
      builds = { ...builds, [curIdx]: snapshotFnRef.current() };
      fnBuildsRef.current = builds;
    }
    switchingRef.current = true;
    activeFnIdxRef.current = newIdx;
    const nextBuilds = builds;
    const target = builds[newIdx] || null;
    setFnPending(newIdx);
    // The ref work above stays OUTSIDE the transition: React may re-run a transition body, and
    // re-snapshotting there would file the wrong build. Everything in here is a plain setState of
    // already-computed values, so a replay is harmless.
    startFnSwitch(() => {
      setFnBuilds(nextBuilds);
      restoreBuildState(target);
      setActiveFnIdx(newIdx);
    });
  };

  // ═══ AUTH- derived helpers (verbatim) ═══
  const [teamData, setTeamData] = useState(DEFAULT_TEAM);
  const [saveError, setSaveError] = useState(null);

  const showMsg = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 2000); };
  // In-app confirm, so destructive actions ask in the app's own voice instead of a browser alert()
  // (which is unstyled, blocks the whole tab, and on some browsers offers "don't show again").
  // Deliberately does NOT auto-dismiss — an unanswered question must wait for an answer.
  const openConfirm = (cfg) => { confirmToastRef.current = cfg; setConfirmToast(cfg); };
  const askConfirm = (msg, onYes, opts = {}) => openConfirm({ msg, onYes, yesLabel: opts.yesLabel || "Remove", note: opts.note });
  // Promise form, so a call site written as `if (!confirm(...)) return;` keeps its shape when it
  // moves off the browser's native dialog. Resolves false on every dismissal route.
  const askConfirmAsync = useCallback((msg, opts = {}) => new Promise((resolve) => {
    openConfirm({
      msg, note: opts.note, yesLabel: opts.yesLabel || "Confirm",
      onYes: () => resolve(true), onCancel: () => resolve(false),
    });
  }), []);
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
  const canManageAny = isAdmin || hasStudioTab("library") || hasStudioTab("settings");
  useEffect(() => { if (mode === "manage" && !canManageAny) setMode("studio"); }, [mode, canManageAny]);

  const toggleFilter = useCallback((arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }, []);

  // ═══ AMBRIA PREMIA STATE (Platinum-tier gate) — read-only now, editor removed ═══
  const [premiaConfig, setPremiaConfig] = useState(PREMIA_DEFAULTS);
  const [premiaGate, setPremiaGate] = useState(null);

  // ═══ BROWSER BACK BUTTON — step back within Studio instead of leaving the app ═══
  // Studio's step/modal navigation is plain React state, not URL-backed, so the browser had no
  // history entry of its own to consume — the very first Back press exited the whole SPA. Pushes a
  // guard history entry so Back is always caught here first: close the top-most full-screen overlay
  // if one's open, else step back one Studio screen (Summary → Build → Browse → Event Info); only
  // once neither applies does Back actually leave the app.
  useEffect(() => {
    window.history.pushState({ studioNavGuard: true }, "");
    const onPopState = () => {
      if (dcFullPageOpen) { setDcFullPageOpen(false); window.history.pushState({ studioNavGuard: true }, ""); return; }
      if (premiaGate) { setPremiaGate(null); window.history.pushState({ studioNavGuard: true }, ""); return; }
      if (videoModal) { setVideoModal(null); setVideoPlaying(false); setVideoOverlay(false); window.history.pushState({ studioNavGuard: true }, ""); return; }
      if (zoneUploadReview) { setZoneUploadReview(null); window.history.pushState({ studioNavGuard: true }, ""); return; }
      if (step > 0) { setStep((s) => Math.max(0, s - 1)); window.history.pushState({ studioNavGuard: true }, ""); return; }
      // Nothing left to step back through — let this Back actually leave the app.
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dcFullPageOpen, premiaGate, videoModal, zoneUploadReview, step]);

  // ═══ YOUTUBE BROWSER STATE ═══
  const [ytVideos, setYtVideos] = useState([]);
  const [ytPlaylists, setYtPlaylists] = useState([{ id: AMBRIA_PLAYLIST_ID, title: "All Ambria Work" }]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytSearch, setYtSearch] = useState("");
  const [ytFilterPL, setYtFilterPL] = useState("all");
  const [ytPicker, setYtPicker] = useState(null);
  const [ytLastFetch, setYtLastFetch] = useState(0);
  const [ytVideoTags, setYtVideoTags] = useState({});
  // Synchronous mirror of ytVideoTags, so a burst of edits each builds on the previous one.
  // React state only reaches an editor on the next render, and saveYtTags used to update it AFTER
  // its network round-trip — so every chip clicked inside that window read the same pre-burst
  // snapshot and dropped the edits before it (tap Maroon then Navy Blue quickly and only Navy Blue
  // survived). saveYtTags writes the composed value here the instant it computes it, so the next
  // click resolves against it whether or not React has re-rendered yet.
  // Read by saveYtTags at call time for the action log. Refs, not deps: saveYtTags is a stable
  // useCallback([]) and must stay that way, and `allVideos` is defined further down the file.
  const authUserRef = useRef(null);
  const allVideosRef = useRef([]);
  const ytVideoTagsRef = useRef(ytVideoTags);
  useEffect(() => { ytVideoTagsRef.current = ytVideoTags; }, [ytVideoTags]);
  useEffect(() => { authUserRef.current = authUser; }, [authUser]);
  // Queued click rows are sent on tab hide/close so a browsing session isn't lost on navigate-away.
  useEffect(() => installActionLogFlush(), []);
  // Serialises the video_tags writes so they reach the table in click order — see saveYtTags.
  const ytSaveChainRef = useRef(Promise.resolve());
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
  const [favVideos, setFavVideos] = useState({});
  const [favPhotos, setFavPhotos] = useState({});
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
      // IMS inventory — always-on copy for Library's "+Add element" search (sources from
      // inventory now, not the Rate Card). Not deal-scoped like dealCheckData.inventory.
      try {
        const rows = await fetchAll("inventory");
        if (Array.isArray(rows) && !cancelled) setImsInventory(rows.map(rowToItem).filter(Boolean));
      } catch { /* ignore */ }
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
        if (v != null) { const td = parse(v); if (td && typeof td === "object" && !cancelled) { if (td.venues) setTrVenues(td.venues); if (td.truckCap) setTruckCap(td.truckCap); if (td.floralPerTruck) setFloralPerTruck(td.floralPerTruck); if (td.bufferTiers) setBufferTiers(td.bufferTiers); if (td.gensetRate !== undefined) setGensetRate(td.gensetRate); if (td.gensetRate62 !== undefined) setGensetRate62(td.gensetRate62); } }
      } catch {}
      if (!cancelled) trSettingsLoadedRef.current = true;
      // Templates
      try { const v = await kvGet(TPL_SK); if (v != null) { const tp = parse(v); if (Array.isArray(tp) && tp.length && !cancelled) setTemplates(tp); } } catch {}
      // Zone definitions
      let loadedZones = null;
      try { const v = await kvGet(ZONE_DEF_SK); if (v != null) { const zp = parse(v); if (zp && zp.elements) { loadedZones = zp; if (!cancelled) setZoneDefs(zp); } } } catch {}
      // Zone photo groups — normalised on read, so a blob written before groups were per-function
      // (a bare id array per zone) loads as an any-function group instead of being ignored.
      try { const v = await kvGet(ZONE_GROUPS_SK); if (v != null && !cancelled) { const zg = normaliseZoneGroups(parse(v)); zoneGroupsRef.current = zg; setZoneGroups(zg); } } catch {}
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
            // One-time: introduce the "Both" venue type (Indoor + Outdoor) into the already-saved
            // shared taxonomy. Gated on a stored flag so that if someone later deletes "Both" in
            // Manage Settings it stays gone — we don't auto-restore it (the taxonomy is user-managed).
            try {
              const bothDone = await kvGet(TAX_BOTH_MIG_SK);
              if (bothDone == null) {
                if (Array.isArray(out.venueType) && !out.venueType.includes("Both")) { out.venueType = [...out.venueType, "Both"]; merged = true; }
                reliableSave(TAX_BOTH_MIG_SK, "1", "Taxonomy migration").catch(() => {});
              }
            } catch {}
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
      // Correction log (contribution tracking) — table-backed now, see photoCorrections.js
      try { const rows = await fetchPhotoCorrections(); if (!cancelled) { setCorrLog(rows); corrLogRef.current = rows; } } catch {}
      try { const v = await kvGet(TAG_KB_SK); if (v != null) { const kb = parse(v); if (kb && typeof kb === "object" && !cancelled) setTagKB(kb); } } catch {}
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
      // Video tags — the `video_tags` TABLE is the source of truth (migration 023). The legacy
      // YT_TAG_SK blob is still written as a mirror for one release, and is read here only as a
      // fallback, so this deploy is safe whether or not the migration has been applied yet.
      // Empty table also falls through to the blob: a fresh environment has rows only after backfill.
      try {
        const rows = await fetchAll("video_tags");
        if (Array.isArray(rows) && rows.length && !cancelled) setYtVideoTags(rowsToVideoTagMap(rows));
        else if (!cancelled) throw new Error("video_tags empty");
      } catch {
        try { const v = await kvGet(YT_TAG_SK); if (v != null) { const tp = parse(v); if (tp && typeof tp === "object" && !cancelled) setYtVideoTags(tp); } } catch {}
      }
      // Client ledger — now row-per-client in the `client_ledger` TABLE (off the settings blob).
      // Seed the dirty-check baseline with what the DB actually holds, so the first save of the
      // session uploads only what genuinely changed instead of the entire ledger.
      try {
        const rows = await loadClientRows();
        if (Array.isArray(rows) && !cancelled) {
          const list = rows.map(rowToClient).filter(Boolean);
          // Sessions come from the `studio_sessions` TABLE (migration 026), which is the source of
          // truth. The blob copy inside client_ledger.data stays as the fallback below — the same
          // two-step 023 used for video tags, so this is reversible without losing a save.
          // Only a client the table actually has rows for is replaced: a client whose sessions have
          // not been backfilled yet keeps its blob history rather than appearing to have lost it.
          try {
            const srows = await loadSessionRows();
            if (Array.isArray(srows) && srows.length && !cancelled) {
              const byClient = new Map();
              for (const r of srows) {
                if (!r?.client_id) continue;
                let g = byClient.get(r.client_id);
                if (!g) { g = []; byClient.set(r.client_id, g); }
                g.push(r);
              }
              for (const c of list) {
                const mine = byClient.get(c.id);
                if (mine && mine.length) c.sessions = rowsToSessions(mine);
              }
            }
          } catch { /* table absent or unreadable — the blob history below stands */ }
          const seed = {}; list.forEach((c) => { if (c && c.id) seed[c.id] = JSON.stringify(c); });
          clientJsonRef.current = seed;
          setClientLedger(list);
        }
      } catch { /* ignore */ }
      // Marked ready whether the read SUCCEEDED or THREW. A failed load leaves the ledger empty,
      // and treating that as "still loading" would hold the skeleton up for the rest of the session
      // with nothing on the way to replace it. Ready means "we have asked", not "we found work".
      if (!cancelled) setLedgerReady(true);
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
      // Favourite videos
      try { const v = await kvGet(FAV_VID_SK); if (v != null) { const fp = parse(v); if (fp && typeof fp === "object" && !cancelled) setFavVideos(fp); } } catch {}
      // Favourite zone photos
      try { const v = await kvGet(FAV_PHOTO_SK); if (v != null) { const fp = parse(v); if (fp && typeof fp === "object" && !cancelled) setFavPhotos(fp); } } catch {}
      // Filter priority
      try { const v = await kvGet(FILTER_PRIORITY_SK); if (v != null) { const fpp = parse(v); if (Array.isArray(fpp) && fpp.length === 5 && !cancelled) setFilterPriority(fpp); } } catch {}
      // Tagging-hidden sub-categories (Pricing flags)
      try { const v = await kvGet(TAG_HIDDEN_SUBS_SK); if (v != null) { const hs = parse(v); if (Array.isArray(hs) && !cancelled) setTagHiddenSubs(hs.filter((x) => typeof x === "string")); } } catch {}
      // Palette catalogue (Studio-owned) + IMS settings (paint cats)
      try {
        const palv = await kvGet(PALETTE_SK);
        if (palv != null) { const p = parse(palv); if (p && typeof p === "object" && !cancelled) { if (Array.isArray(p.colourCatalogue) && p.colourCatalogue.length) setImsColourCatalogue(p.colourCatalogue); if (Array.isArray(p.paletteCatalogue) && p.paletteCatalogue.length) setImsPaletteCatalogue(p.paletteCatalogue); } }
        if (!cancelled) { paletteLoadedRef.current = true; setPaletteCatalogueLoaded(true); }
        const sv = await kvGet(IMS_SETTINGS_SK);
        if (sv != null) { const s = parse(sv); if (s && typeof s === "object" && !cancelled) { if (Array.isArray(s.paintableCategories) && s.paintableCategories.length) setImsPaintableCategories(s.paintableCategories); if (typeof s.defaultPaintCostPerItem === "number") setImsDefaultPaintCost(s.defaultPaintCostPerItem); } }
      } catch {}
      // AI Synonym Dictionary — IMS persists each settings field as its OWN row keyed by field name
      // (IMS.jsx's setSettings), not nested under IMS_SETTINGS_SK, so it's fetched by its own key.
      try { const synv = await kvGet("synonymDictionary"); if (synv != null) { const sd = parse(synv); if (Array.isArray(sd) && !cancelled) setImsSynonymDictionary(sd); } } catch {}
      // Print Materials — same per-field kv row pattern as synonymDictionary above.
      try { const pmv = await kvGet("printMaterials"); if (pmv != null) { const pm = parse(pmv); if (Array.isArray(pm) && !cancelled) setImsPrintMaterials(pm); } } catch {}
      try { const cmv = await kvGet("carpetMaterials"); if (cmv != null) { const cm = parse(cmv); if (Array.isArray(cm) && !cancelled) setImsCarpetMaterials(cm); } } catch {}
      // Truss & Masking Rates (IMS Admin → Settings → 🏗️) — same per-field kv row pattern.
      try { const trv = await kvGet("trussRates"); if (trv != null) { const tr = parse(trv); if (Array.isArray(tr) && !cancelled) setImsTrussRates(tr); } } catch {}
      try { const mrv = await kvGet("maskingRates"); if (mrv != null) { const mr = parse(mrv); if (Array.isArray(mr) && !cancelled) setImsMaskingRates(mr); } } catch {}
      try { const prv = await kvGet("platformRates"); if (prv != null) { const pr = parse(prv); if (Array.isArray(pr) && !cancelled) setImsPlatformRates(pr); } } catch {}
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
  // The Rate Card admin editor (Studio's RateCard.jsx, IMS's RateCardPanel.jsx) is gone — nobody
  // edits `rate_card` by hand anymore, recipes are IMS-native (flowerPatterns), and every element
  // Studio creates today carries an invId or patternId, never a bare Rate Card reference. This ref
  // + subscription sync stay only because `rcItems` is still read as a LEGACY pricing fallback (see
  // getElPrice et al.) for elements saved before that migration — truss_sqft-billed decorative
  // elements in particular have no IMS-inventory equivalent at all. saveRC/saveRcCats (the human-
  // edit save paths) had zero callers left with the editor gone and are removed.
  const rcItemsRef = useRef([]);
  useEffect(() => { rcItemsRef.current = rcItems; }, [rcItems]);
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
          else if (key === RC_SK_TR) { const td = pj(await kvGet(RC_SK_TR)); if (td && typeof td === "object") { if (td.venues) setTrVenues(td.venues); if (td.truckCap) setTruckCap(td.truckCap); if (td.floralPerTruck) setFloralPerTruck(td.floralPerTruck); if (td.bufferTiers) setBufferTiers(td.bufferTiers); if (td.gensetRate !== undefined) setGensetRate(td.gensetRate); if (td.gensetRate62 !== undefined) setGensetRate62(td.gensetRate62); } trSettingsLoadedRef.current = true; }
          else if (key === PALETTE_SK) { const p = pj(await kvGet(PALETTE_SK)); if (p && typeof p === "object") { if (Array.isArray(p.colourCatalogue)) setImsColourCatalogue(p.colourCatalogue); if (Array.isArray(p.paletteCatalogue)) setImsPaletteCatalogue(p.paletteCatalogue); } }
          else if (key === "printMaterials") { const pm = pj(await kvGet("printMaterials")); if (Array.isArray(pm)) setImsPrintMaterials(pm); }
          else if (key === "carpetMaterials") { const cm = pj(await kvGet("carpetMaterials")); if (Array.isArray(cm)) setImsCarpetMaterials(cm); }
          else if (key === "trussRates") { const tr = pj(await kvGet("trussRates")); if (Array.isArray(tr)) setImsTrussRates(tr); }
          else if (key === "maskingRates") { const mr = pj(await kvGet("maskingRates")); if (Array.isArray(mr)) setImsMaskingRates(mr); }
          else if (key === "platformRates") { const pr = pj(await kvGet("platformRates")); if (Array.isArray(pr)) setImsPlatformRates(pr); }
          // YT_TAG_SK is deliberately NOT handled here any more. Video tags have their own row-level
          // subscription on the `video_tags` table now, and the blob is a write-only mirror during the
          // transition. Rebuilding the whole map from that mirror could push a stale blob (the mirror
          // write is best-effort) over fresh row updates that arrived on the other channel.
          // Hidden videos belongs here for the same reason tags do: without it a tab's copy of who
          // hid what goes stale for as long as it stays open, and the folder counts silently disagree
          // between tabs. Merge-on-save makes staleness harmless for data, but not for what you see.
          else if (key === HIDDEN_VID_SK) { const hv = pj(await kvGet(HIDDEN_VID_SK)); if (hv && typeof hv === "object") setHiddenVideos(hv); }
          else if (key === FAV_VID_SK) { const fv = pj(await kvGet(FAV_VID_SK)); if (fv && typeof fv === "object") setFavVideos(fv); }
          else if (key === FAV_PHOTO_SK) { const fp = pj(await kvGet(FAV_PHOTO_SK)); if (fp && typeof fp === "object") setFavPhotos(fp); }
          else if (key === ZONE_GROUPS_SK) { const zg = normaliseZoneGroups(pj(await kvGet(ZONE_GROUPS_SK))); zoneGroupsRef.current = zg; setZoneGroups(zg); }
          else if (FLORAL_DATA_KEYS.includes(key)) { refreshStudioFloralData(); }
        } catch { /* ignore */ }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  // ── Realtime: library is a TABLE — patch row-level UPDATE/DELETE live for whatever's already
  // cached (echoes of our own writes are idempotent). Since `libItems` is now a lazy cache rather
  // than the whole table, an INSERT for an id we've never queried is deliberately IGNORED here —
  // otherwise a bulk import/tag pass inserting thousands of rows would silently balloon every
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
  // ── Realtime: video tags, row-level. Replaces watching the whole YT_TAG_SK blob — one person
  // verifying a video now patches one entry in every open tab instead of re-reading all 428. ──
  useEffect(() => {
    const ch = subscribeTable("video_tags", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.video_id; if (!id) return;
          setYtVideoTags((prev) => { if (!(id in prev)) return prev; const next = { ...prev }; delete next[id]; return next; });
        } else if (payload.new?.video_id) {
          const id = payload.new.video_id;
          const tag = rowToVideoTag(payload.new);
          setYtVideoTags((prev) => ({ ...prev, [id]: tag }));
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
  // ── Realtime: IMS inventory — Library "+Add element" sources from here now, not the Rate Card. ──
  useEffect(() => {
    const ch = subscribeTable("inventory", (payload) => {
      try {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          setImsInventory((prev) => prev.filter((i) => i.id !== id));
        } else if (payload.new) {
          const it = rowToItem(payload.new); if (!it?.id) return;
          setImsInventory((prev) => { const i = prev.findIndex((x) => x.id === it.id); return i >= 0 ? prev.map((x) => (x.id === it.id ? it : x)) : [...prev, it]; });
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
        // Keep the dirty-check baseline in step with rows arriving from other tabs/users, so a
        // remote change isn't mistaken for a local edit (or the reverse) on the next save.
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id; if (!id) return;
          // Tombstone it here too. A client deleted in ANOTHER tab or by another user has to survive
          // this tab's stale ledger writes exactly as a local delete does — see deletedClientIdsRef.
          deletedClientIdsRef.current.add(id);
          if (clientJsonRef.current) delete clientJsonRef.current[id];
          setClientLedger((prev) => prev.filter((c) => c.id !== id));
        } else if (payload.new) {
          const c = rowToClient(payload.new); if (!c?.id) return;
          // Our own stale upsert, echoed back before the delete landed, would otherwise re-add the
          // row to the list this tab is showing.
          if (deletedClientIdsRef.current.has(c.id)) return;
          if (clientJsonRef.current) clientJsonRef.current[c.id] = JSON.stringify(c);
          // ── AN ECHO MUST NOT WIND THIS CLIENT BACK ──
          // Every save upserts the row and Supabase sends it straight back. Applying that blindly
          // means the newest local state can be replaced by an OLDER copy: the 15s autosave, the
          // debounced edit save and the tab-hide save all write independently, and the echo of one
          // can land after the next has already been applied here. The row that arrives is then a
          // version behind, so the saved-session list reverts — the newly-picked video drops out of
          // the rolling draft and Browse's "Current selection — not yet saved" card reappears, until
          // the following save pushes it forward again. That is the card blinking in and out on the
          // save cadence: nothing was being re-fetched or re-rendered wrongly, the data itself was
          // moving backwards and forwards.
          // The newest savedAt across a client's sessions only ever moves forward, so it says which
          // copy is later. An older one is dropped, and an identical one returns the SAME array so
          // React re-renders nothing at all — most echoes are our own write coming home.
          const ledgerStamp = (x) => { let m = 0; for (const s of (x?.sessions || [])) { const t = s?.savedAt || 0; if (t > m) m = t; } return m; };
          setClientLedger((prev) => {
            const i = prev.findIndex((x) => x.id === c.id);
            if (i < 0) return [...prev, c];
            const mine = prev[i];
            if (ledgerStamp(c) < ledgerStamp(mine)) return prev;
            if (JSON.stringify(mine) === JSON.stringify(c)) return prev;
            return prev.map((x) => (x.id === c.id ? c : x));
          });
        }
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // ── Realtime: session rows, row-level (migration 026) ──
  // Another salesperson saving on the same deal, or the same person in a second tab, now changes ROWS
  // rather than the client blob — so watching client_ledger alone would miss it. Rebuilt per client
  // from whatever rows that client has after the change, which is the same function rowsToSessions
  // does on load, so a live update and a cold load can never disagree about the shape.
  useEffect(() => {
    const ch = subscribeTable("studio_sessions", (payload) => {
      try {
        const cid = payload.new?.client_id || payload.old?.client_id;
        if (!cid) return;
        const sid = payload.new?.session_id || payload.old?.session_id;
        const rowId = payload.new?.id || payload.old?.id;
        setClientLedger((prev) => {
          const i = prev.findIndex((c) => c.id === cid);
          if (i < 0) return prev;   // a client this tab has not loaded — nothing to update
          const c = prev[i];
          // Rebuild this client's rows from the sessions it currently holds, apply the one change,
          // then map back. Cheaper and safer than re-querying on every event.
          const rows = [];
          for (const s of (c.sessions || [])) {
            if (Array.isArray(s._fnRows) && s._fnRows.length) rows.push(...s._fnRows);
            else rows.push(...sessionToRows(cid, s));
          }
          let next;
          if (payload.eventType === "DELETE") {
            next = rows.filter((r) => (sid ? r.session_id !== sid : r.id !== rowId));
          } else if (payload.new) {
            const without = rows.filter((r) => r.id !== payload.new.id);
            next = [...without, payload.new];
          } else return prev;
          const rebuilt = rowsToSessions(next);
          // Same content, same array — most events are this tab's own write coming home, and
          // replacing state with an identical value only makes Browse re-render for nothing.
          if (JSON.stringify(rebuilt) === JSON.stringify(c.sessions || [])) return prev;
          return prev.map((x, xi) => (xi === i ? { ...x, sessions: rebuilt } : x));
        });
      } catch { /* ignore */ }
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  const saveTpl = useCallback(async (nt) => { setTemplates(nt); await reliableSave(TPL_SK, JSON.stringify(nt), "Template"); }, []);
  const saveZD = useCallback(async (nd) => { setZoneDefs(nd); await reliableSave(ZONE_DEF_SK, JSON.stringify(nd), "Zone config"); }, []);

  // Zone photo groups. Normalised on write as well as read — that drops empty lists, so the blob
  // doesn't accumulate a key for every zone/function pair anyone ever opened.
  //
  // reliableSave REPORTS failure, it doesn't throw: a rejected write comes back as {ok:false}. So
  // this has to check the result and throw itself, or a failed save would set the local state,
  // return normally, and let the caller announce "✓ pinned" for a group that only exists in this
  // tab — gone the moment the page reloads. On failure the optimistic state is rolled back too,
  // so the screen never shows a group the database doesn't have.
  // Writes ONE zone+function list, merged onto a fresh read of the blob.
  //
  // Groups are one shared settings row for the whole team. Writing the local copy wholesale would
  // erase every group another salesperson made since this tab loaded — the tab's copy is only as
  // fresh as the last realtime event it happened to receive. Since a pin/unpin/delete only ever
  // changes a single (zone, function) list, the safe move is to send the OPERATION and apply it to
  // whatever the row currently holds.
  //
  // kvTryGet, not kvGet: a failed read is indistinguishable from an empty row through kvGet, and
  // merging onto "nothing" then saving is precisely how a day of video tagging was lost on
  // 30 Jul 2026. A read that fails aborts the write instead.
  const writeZoneGroup = useCallback(async (zone, fnType, ids) => {
    if (!zone) throw new Error("No zone to group against");
    const prev = zoneGroupsRef.current;
    // Optimistic, so the strip reorders on click rather than after the round trip.
    const optimistic = normaliseZoneGroups(setGroupIds(prev, zone, fnType, ids));
    zoneGroupsRef.current = optimistic;
    setZoneGroups(optimistic);
    try {
      const read = await kvTryGet(ZONE_GROUPS_SK);
      if (!read.ok) throw new Error(read.error || "Couldn't read the current groups");
      let remote = {};
      if (!read.missing && read.value != null) {
        try { remote = typeof read.value === "string" ? JSON.parse(read.value) : read.value; } catch { remote = {}; }
      }
      const merged = normaliseZoneGroups(setGroupIds(normaliseZoneGroups(remote), zone, fnType, ids));
      const res = await reliableSave(ZONE_GROUPS_SK, JSON.stringify(merged), "Zone photo groups");
      if (!res?.ok) throw new Error(res?.error || "Storage rejected the write");
      zoneGroupsRef.current = merged;
      setZoneGroups(merged);
      return merged;
    } catch (e) {
      // Never leave a group on screen that the row doesn't have.
      zoneGroupsRef.current = prev;
      setZoneGroups(prev);
      throw e;
    }
  }, []);
  // Row-level library persistence. `nl` is the set of items to upsert (NOT the whole library —
  // now that `libItems` is a lazy cache rather than the full table, callers pass just the item(s)
  // they changed/added, or a locally-known slice with edits applied — either way). We UPSERT only
  // the rows that actually changed vs. what was cached, DELETE only ids explicitly passed in
  // `deletedIds`, and MERGE `nl` into the existing cache (never replace it wholesale) — so saving
  // one edited photo can't wipe out everything else a screen has already loaded.
  // Callers pass the rows they want written. `changed` diffs them against the CACHE so that the
  // bulk form — saveLib(libItems.map(...)) — upserts one edited row instead of all ~5000.
  //
  // That makes one thing a trap: never mergeLibItems() a row into the cache before saving it. The
  // row then equals its own "previous" value, `changed` comes out empty, and the write is skipped
  // with no error. Two call sites did exactly that, and every Build-uploaded photo since was lost
  // on refresh. saveLib already merges into libItemsRef and state below, so pre-merging is
  // redundant as well as harmful.
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
      return { ok: true };
    } catch (e) {
      // The cache above was already updated optimistically, before we knew the write would land.
      // Roll it back on failure — otherwise the screen keeps showing the edit as if it saved (a
      // photo that looks verified with its new tags) even though the database never got it, and the
      // only sign anything went wrong is a red toast that the caller's own "saved!" message stomps a
      // moment later. A refresh then re-fetches the real (unsaved) row and it looks like data reverted.
      libItemsRef.current = prev; setLibItems(prev);
      showMsg?.("Library save failed: " + (e?.message || e), "red");
      return { ok: false, error: e };
    }
  }, [showMsg]);
  // Log ONE verification event (who verified/edited which photo/video, when) for contribution
  // reporting — the "Contributions" leaderboard. A plain INSERT into the photo_corrections table
  // (see photoCorrections.js), no read-modify-write, so concurrent saves can't clobber each other.
  // NOT to be confused with logFieldCorrections (tagFeedback.js → tag_corrections), which records
  // the per-field AI-vs-human tag diff that gets fed back into the tagging prompt. Both fire from
  // "Save & Verify"; this one is the audit/leaderboard, that one is the learning signal.
  const logVerificationEvent = useCallback(async (info) => {
    const row = await logPhotoCorrection({
      photoId: info?.photoId || "", photoName: info?.photoName || "",
      source: info?.source || "build", kind: info?.kind || "photo",
      user: authUser?.name || "—", userId: authUser?.id || "",
    });
    if (!row) return;
    const next = [row, ...corrLogRef.current].slice(0, 5000);
    corrLogRef.current = next;
    setCorrLog(next);
  }, [authUser]);
  // Manual refresh (e.g. when the Contributions panel is opened) — picks up other people's saves
  // without needing a live subscription for a report screen that's opened occasionally.
  const refreshCorrLog = useCallback(() => {
    fetchPhotoCorrections().then((rows) => { corrLogRef.current = rows; setCorrLog(rows); }).catch(() => {});
  }, []);
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
  // Serialised snapshot of every client as last written, keyed by id. The dirty check USED to hold
  // the previous client OBJECTS and compare them to the incoming ones — but callers build their new
  // ledger with `[...clientLedger]`, a shallow copy, then mutate the client in place
  // (`client.sessions = …` in saveSession, `client.name = …` in doSaveClient). Old and new were
  // therefore the same object, every comparison said "unchanged", and nothing was ever upserted.
  // Only brand-new clients — absent from the map — got through, which is why deals were being
  // created and then never updated again: sessions and edited details went nowhere.
  // Strings can't be mutated behind our back, so comparing against these is sound.
  const clientJsonRef = useRef(null);
  // ═══ A DELETED CLIENT STAYS DELETED ═══
  // Writers here hand over a WHOLE ledger array built from their own closure — the Event Info form,
  // the booking path, the LMS lead link, the Deal Check overlay. Deleting a client removes the row
  // from the DB and from state, but those closures captured the ledger BEFORE it went, and the next
  // write hands the stale array straight back. (saveSession itself reads clientLedgerRef.current
  // since the duplicate-session fix, so it is no longer one of them — the rest still are.)
  //
  // The dirty check below is what turns that into a resurrection. Deleting clears the client's
  // baseline from clientJsonRef, so when the stale array arrives its id has no entry — the row
  // reads as BRAND NEW and gets upserted, details and all. Deleting again just repeats the cycle.
  //
  // Ids are minted from a timestamp ("CLI_" + Date.now()) and never reused, so remembering the
  // deleted ones for the life of the page is enough: a tombstoned id is dropped from the upsert,
  // from the baseline and from state, whoever sends it and however stale their copy is.
  const deletedClientIdsRef = useRef(new Set());
  const saveClientLedger = useCallback(async (nl, deletedIds) => {
    const dels = Array.isArray(deletedIds) ? deletedIds.filter(Boolean) : [];
    dels.forEach((id) => deletedClientIdsRef.current.add(id));
    const gone = deletedClientIdsRef.current;
    // Filter FIRST, so a tombstoned client can reach neither the upsert, the baseline, nor the list
    // the tracker renders — otherwise it returns to the screen even when the DB row stays gone.
    const list = (nl || []).filter((c) => c && c.id && !gone.has(c.id));
    // No baseline yet (a save landing before the load effect seeded one) means we cannot tell what
    // is dirty — upsert everything rather than risk dropping a write. The load effect seeds it, so
    // this is the rare path, not the normal one.
    const prevJson = clientJsonRef.current || {};
    const nextJson = {};
    const changed = [];
    for (const c of list) {
      const j = JSON.stringify(c);
      nextJson[c.id] = j;
      if (prevJson[c.id] !== j) changed.push(c);
    }
    clientJsonRef.current = nextJson;
    clientLedgerRef.current = list; setClientLedger(list);
    try {
      // Delete BEFORE upserting. Both run in one call when the tracker deletes a client, and an
      // upsert landing after its own delete would put the row straight back.
      // A deleted client's session rows go with it. client_ledger no longer holds the only copy of a
      // deal's history, so dropping the client row alone would leave that history behind in
      // studio_sessions with nothing pointing at it.
      for (const id of dels) {
        try { await supabase.from("studio_sessions").delete().eq("client_id", id); } catch { /* the client row still goes */ }
        await deleteRow("client_ledger", id);
      }
      if (changed.length) {
        const rows = changed.map((c) => ({ ...clientToRow(c), updated_at: new Date().toISOString() }));
        const { error } = await supabase.from("client_ledger").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
    } catch (e) { showMsg?.("Client save failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  // Deleting ONE saved session. Browse removes it from the client's array and saves the ledger; that
  // takes it out of the blob mirror, and this takes out the rows it became in studio_sessions. Both
  // are needed — the table is the source of truth on the next load, so a session deleted from the
  // array alone would come back.
  const deleteSessionRows = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try { await supabase.from("studio_sessions").delete().eq("session_id", sessionId); }
    catch (e) { showMsg?.("Session delete failed: " + (e?.message || e), "red"); }
  }, [showMsg]);
  const saveDateTypes = useCallback(async (nd) => { setDateTypes(nd); await reliableSave(DT_SK, JSON.stringify(nd), "Date types"); }, []);
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
  // Merge-on-save — fetches the LATEST server copy right before writing, so a save from this tab
  // can never silently erase another tab's concurrent edit to a DIFFERENT video. This is the same
  // bug shape as the palette-catalogue mount race (fixed in 57a2f73): overwriting a whole shared
  // blob from one tab's local snapshot. There it was a load-timing race; here it's ordinary
  // concurrent multi-user editing, made worse by YT_TAG_SK never being in the realtime allowlist
  // below (so a tab's snapshot of OTHER people's edits can be stale for as long as the tab's open).
  // Callers pass a PATCH — just the id(s) they changed, mapped to the new tag object (or null to
  // delete that id) — never the whole ytVideoTags object.
  //
  // Now ROW-LEVEL against the `video_tags` table (migration 023), which is what CLAUDE.md rule 1
  // asks for and what the blob made impossible: one video's edit touches one row, so a failed write
  // costs that video and nothing else. The read-merge-whole-map dance is gone with it — that only
  // ever existed to stop one tab's snapshot clobbering everyone else's tags, and rows can't.
  //
  // A patch value may be a FUNCTION `(prevTag) => newTag`. Prefer that form for any edit derived
  // from the current tag (toggling one chip in an array, flipping one field): the function runs
  // against the freshest tag we have — including edits still in flight — instead of against
  // whatever the caller's render closed over. Plain-object values are still accepted for callers
  // that genuinely mean "replace this video's tag wholesale" (AI tag save, Clear Tags).
  const saveYtTags = useCallback(async (patch) => {
    const entries = Object.entries(patch || {});
    if (!entries.length) return { ok: true };
    const base = ytVideoTagsRef.current || {};
    const resolved = entries.map(([id, val]) => [id, typeof val === "function" ? val(base[id] || {}) : val]);
    // Snapshot only the ids we touch, so a failed save can put those back without disturbing others.
    const before = new Map(resolved.map(([id]) => [id, base[id]]));
    const applyLocal = (pairs) => {
      const nextRef = { ...(ytVideoTagsRef.current || {}) };
      for (const [id, val] of pairs) { if (val === null || val === undefined) delete nextRef[id]; else nextRef[id] = val; }
      ytVideoTagsRef.current = nextRef;
      // Functional update: two concurrent saves can no longer overwrite each other's local state.
      setYtVideoTags((prev) => {
        const next = { ...prev };
        for (const [id, val] of pairs) { if (val === null || val === undefined) delete next[id]; else next[id] = val; }
        return next;
      });
    };
    // Optimistic — the chip lights up on the click that caused it, and the NEXT click composes on
    // top of this value rather than on the last server round-trip. Rolled back below if the write
    // fails, which is the only case where the UI would otherwise be showing an unsaved tag.
    applyLocal(resolved);
    const toUpsert = [], toDelete = [];
    for (const [id, val] of resolved) (val === null || val === undefined ? toDelete : toUpsert).push([id, val]);
    // Writes go out one at a time, in the order they were made. Each upsert carries the WHOLE tag
    // and the table is last-write-wins, so two in flight at once can land out of order and leave the
    // row on the older value — the edit looks applied until the next reload drops it. Chaining costs
    // nothing here (tag edits are occasional and the UI already updated optimistically above).
    const write = async () => {
      try {
        if (toUpsert.length) {
          const { error } = await supabase.from("video_tags")
            .upsert(toUpsert.map(([id, val]) => videoTagToRow(id, val)), { onConflict: "video_id" });
          if (error) throw new Error(error.message);
        }
        for (const [id] of toDelete) {
          const { error } = await supabase.from("video_tags").delete().eq("video_id", id);
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        applyLocal([...before.entries()].map(([id, val]) => [id, val === undefined ? null : val]));
        setSaveError({ label: "Video tags", error: `Save failed (${e.message}). Only the video${entries.length === 1 ? "" : "s"} you just edited ${entries.length === 1 ? "is" : "are"} affected — every other video's tags are untouched.` });
        return { ok: false, error: e.message };
      }
      return { ok: true };
    };
    // `.then(write, write)` rather than `.then(write)`: one rejected link must not stall the queue.
    const mine = ytSaveChainRef.current.then(write, write);
    ytSaveChainRef.current = mine.catch(() => {});
    const res = await mine;
    // Action log — every tag save, from anywhere, lands here rather than at the ~20 call sites, so
    // it cannot be forgotten when a new one is added. Deliberately BEFORE the early return below:
    // a failed save is the row that matters most, because it leaves no trace in the database at all
    // and this is the only record that someone tried.
    try {
      const vids = allVideosRef.current || [];
      for (const [id, val] of resolved) {
        const cleared = val === null || val === undefined;
        logWrite(authUserRef.current, cleared ? "video.tag.clear" : "video.tag", {
          targetType: "video", targetId: id, targetName: vids.find((v) => v.id === id)?.title,
          ok: res.ok, error: res.error,
          detail: cleared ? null : { verified: !!val._verified, fields: Object.keys(val).filter((k) => k[0] !== "_") },
        });
      }
    } catch { /* logging must never break the save it is logging */ }
    if (!res.ok) return res;
    // Transitional mirror — keeps the legacy blob in step for one release so a rollback, or a tab
    // still running the pre-migration bundle, sees current data. Best-effort by design: the table is
    // the source of truth, so a mirror failure is swallowed rather than shown. kvTryGet means a
    // failed read SKIPS the mirror write instead of replacing the blob with just this patch.
    try {
      const res = await kvTryGet(YT_TAG_SK);
      if (res.ok) {
        let fresh = {};
        if (res.value != null) {
          const p = typeof res.value === "string" ? JSON.parse(res.value) : res.value;
          if (p && typeof p === "object") fresh = p;
        }
        const merged = { ...fresh };
        for (const [id, val] of resolved) { if (val === null || val === undefined) delete merged[id]; else merged[id] = val; }
        await reliableSave(YT_TAG_SK, JSON.stringify(merged), "Video tags (legacy mirror)");
      }
    } catch { /* mirror only — the table already has the truth */ }
    return { ok: true };
  }, []);

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
  // rcIsSMB, getFloralMode now come from src/lib/rateCard.js (shared with IMS's own Rate Card admin UI).

  // Rate Card → IMS migration Phase 2: per-sub-category scaling factor (rate_card_categories,
  // IMS-owned — see Phase 1). Looked up by the same key Deal Check already uses to match a
  // rate-card item to an IMS sub-category (imsAlias || sub), so no new taxonomy is introduced.
  const rcFactorByKey = useMemo(() => {
    const m = {};
    (rcSubcatFactors || []).forEach((r) => { if (r && r.id) m[r.id] = Number(r.scaling_factor); });
    return m;
  }, [rcSubcatFactors]);
  // Shared by both sides of the join: a rate-card item resolves its sub-category via
  // itemImsSubcat(rc); a raw inventory item just uses its own subCat directly (see
  // getElPriceFromInventory below — Library "+Add element" now sources from inventory).
  const rcScalingFactorForSub = useCallback((subCat) => {
    const key = String(subCat || "").trim().toLowerCase();
    if (!key) return 1;
    const f = rcFactorByKey[key];
    return (typeof f === "number" && isFinite(f) && f > 0) ? f : 1;
  }, [rcFactorByKey]);
  const rcScalingFactor = useCallback((rc) => rcScalingFactorForSub(itemImsSubcat(rc)), [rcScalingFactorForSub]);
  // Bundled settings-driven rates passed to calcStructCost everywhere — imsInventory/rcFactorByKey
  // ride along so trussRowCost can price a "custom ceiling/masking" inventory item (rental × its
  // sub-category's scaling factor) the same way any other IMS-sourced element prices.
  const structRates = useMemo(() => ({ printMaterials: imsPrintMaterials, carpetMaterials: imsCarpetMaterials, trussRates: imsTrussRates, maskingRates: imsMaskingRates, platformRates: imsPlatformRates, imsInventory, rcFactorByKey }), [imsPrintMaterials, imsCarpetMaterials, imsTrussRates, imsMaskingRates, imsPlatformRates, imsInventory, rcFactorByKey]);

  // Cost% for pricing an inventory-sourced element's shortfall (qty beyond what's free in stock
  // for the active date) — same rate_card_categories row as the scaling factor, same join key.
  // Default 100 (full production cost) for a sub-category with no row yet.
  const rcCostPctByKey = useMemo(() => {
    const m = {};
    (rcSubcatFactors || []).forEach((r) => { if (r && r.id) m[r.id] = Number(r.cost_percent); });
    return m;
  }, [rcSubcatFactors]);
  const rcCostPctForSub = useCallback((subCat) => {
    const key = String(subCat || "").trim().toLowerCase();
    const v = key ? rcCostPctByKey[key] : undefined;
    return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 100;
  }, [rcCostPctByKey]);

  // Sub-category default floral pricing mode (rate_card_categories.floral_mode, IMS-owned) — an
  // additive override layer under getFloralMode()'s existing per-item logic; see src/lib/rateCard.js.
  const rcFloralModeByKey = useMemo(() => {
    const m = {};
    (rcSubcatFactors || []).forEach((r) => { if (r && r.id) m[r.id] = r.floral_mode; });
    return m;
  }, [rcSubcatFactors]);

  // Flower-recipe patterns addable as their own standalone element (name-searchable alongside
  // inventory items in every "+Add element" box), independent of whether the recipe's sub-category
  // also has real inventory backing or is tag_hidden — a recipe must always be findable/addable by
  // its own name (e.g. "Disco Ball" under a hidden "Hanging Pattern" sub-cat still needs to surface
  // as its recipe element even though the raw inventory item stays hidden from search; likewise a
  // recipe whose sub-category ISN'T hidden is still offered here alongside the plain inventory item,
  // since the two are different addable things — one ties to physical stock, one doesn't). Only
  // non-empty recipes count (same "hasRecipe" bar the Recipes editor itself uses).
  const recipeOnlyPatterns = useMemo(() => {
    const floralSrc = dealCheckData || studioFloralData || {};
    const patterns = floralSrc.flowerPatterns || [];
    if (!patterns.length) return [];
    return patterns
      .filter((p) => Object.values(p?.sizes || {}).some((sd) => (sd?.flowers || []).length > 0))
      .map((p) => ({ id: p.id, name: p.name, sub: p.sub || "", unit: p.unit || "pc" }));
  }, [dealCheckData, studioFloralData]);

  // Price an element sourced directly from a flower-recipe pattern with no inventory backing
  // (el.patternId, sibling to el.invId's getElPriceFromInventory). Same formula as the floral branch
  // there, minus the item-rental term (there's no physical item to add rental for) — flower cost
  // blends by real/artificial %, then the recipe's own "extra (pot/base)" is added once.
  const getElPriceFromPattern = useCallback((el) => {
    const floralSrc = dealCheckData || studioFloralData || {};
    const pattern = (floralSrc.flowerPatterns || []).find((p) => p.id === el.patternId);
    if (!pattern) return { rc: null, unitPrice: 0, lineCost: 0, area: 0, warning: null, isFloralBlend: false, realPct: null };
    const qty = el.qty || 0;
    const sizeKey = sizeClassToPatternKey(normalizeSizeClass(el.size || "B"));
    const rates = floralPatternUnitRates(pattern, sizeKey, floralSrc.mandiCatalogue || [], floralSrc, imsInventory, rcFactorByKey);
    if (!rates) return { rc: null, unitPrice: 0, lineCost: 0, area: 0, warning: null, isFloralBlend: false, realPct: null };
    const subKey = squeezeKey(pattern.sub);
    const subMode = subKey ? rcFloralModeByKey[subKey] : undefined;
    const modeDefault = subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, 100 - floralRatio));
    const realPct = (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) ? el.realPct : modeDefault;
    const unitPrice = Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra;
    return { rc: null, unitPrice, lineCost: qty * unitPrice, area: 0, warning: null, isFloralBlend: true, realPct, patternSMB: pattern.mode === "smb" };
  }, [dealCheckData, studioFloralData, rcFloralModeByKey, floralRatio, imsInventory, rcFactorByKey]);

  // Rate Card → IMS migration: price an element sourced directly from IMS inventory (Library
  // "+Add element" — no Rate Card lookup involved for these, by design, not as a fallback).
  // Returns the same shape getElPrice/getElPriceForFn do, so it drops into every existing caller
  // (calcElsCost, calcFunctionCost, etc. — all of which delegate to those two) unchanged. A kit's
  // `price` is already the auto-computed total (kitBase + Σ component price×qty, IMS-side) — one
  // formula covers kits and plain items alike.
  //
  // Fixed Venues config for repeat-rental discounting — same three keys Deal Check's own
  // repeatAdjustedRental (DealCheckOverlay.jsx) builds. dealCheckData is null until Deal Check
  // has been opened once for this client; studioFloralData is fetched unconditionally on mount
  // and carries the same fixedVenues/fixedVenueSubcatDiscount, so a zone marked ♻️ Repeat prices
  // correctly here even before Deal Check has ever run.
  const fvCfgForRepeat = useMemo(() => ({
    fixedVenues: (dealCheckData?.fixedVenues?.length ? dealCheckData.fixedVenues : studioFloralData?.fixedVenues) || [],
    venueParents: dealCheckData?.venueParents || venueParents || {},
    fixedVenueSubcatDiscount: (dealCheckData?.fixedVenueSubcatDiscount && Object.keys(dealCheckData.fixedVenueSubcatDiscount).length ? dealCheckData.fixedVenueSubcatDiscount : studioFloralData?.fixedVenueSubcatDiscount) || {},
  }), [dealCheckData, studioFloralData, venueParents]);
  // Repeat-billed line cost for `qty` units of `item` at `unitRate` — ports Deal Check's own
  // repeatAdjustedRental formula (DealCheckOverlay.jsx) into Build's pricing, so a zone marked
  // ♻️ Repeat actually prices lower here too, matching what the Repeat toggle's own tooltip
  // already promises ("discounted rental") instead of being a silent no-op. Needs BOTH a repeat
  // zone (zc?.repeat) and a resolved venue name — omit either and this returns the full price
  // unchanged, so any call site that doesn't pass them keeps pricing exactly as before.
  const repeatAdjustedLineCost = (item, qty, unitRate, zc, venueName) => {
    const full = qty * unitRate;
    if (!zc?.repeat || !venueName || !item) return full;
    const { standingUnits, freshUnits, discountPct } = rentalSplit(fvCfgForRepeat, venueName, item.id, qty, imsInventory);
    if (standingUnits > 0) return standingUnits * unitRate * (1 - discountPct / 100) + freshUnits * unitRate;
    // Not registered standing at this specific venue — Repeat still applies (a reused setup can
    // happen anywhere), just without a venue-specific cap: the sub-category default, same
    // fallback Deal Check's own repeatAdjustedRental uses.
    const key = String(item.subCat || item.subcategory || "").toLowerCase().trim();
    const sc = key ? Number((fvCfgForRepeat.fixedVenueSubcatDiscount || {})[key]) : NaN;
    const pct = Number.isFinite(sc) && sc > 0 ? sc : 0;
    return full * (1 - pct / 100);
  };
  // opts.checkAvailability (Build view's live canvas ONLY — explicit opt-in, never a default) turns
  // on the same unavailable-shortfall pricing already built for Deal Check: qty within what's free
  // in stock for the active date bills at the normal rate, qty beyond that bills at item.cost ×
  // the sub-category's cost%. Library's browse-grid cost badges never pass this flag, so they stay
  // exactly as before — no availability context exists there (no event date to check against).
  // opts.zc (a zone's zoneConfig, carrying .repeat) + opts.venueName turn on the Repeat discount
  // above; both are optional and default to nothing (full price), same reasoning as checkAvailability.
  const getElPriceFromInventory = useCallback((el, opts) => {
    const item = imsInventory.find((i) => i.id === el.invId);
    if (!item) return { rc: null, unitPrice: 0, lineCost: 0, area: 0, warning: null, isFloralBlend: false, realPct: null };
    const qty = el.qty || 0;
    const isKit = Array.isArray(item.subItems) && item.subItems.length > 0;
    // dealCheckData is null outside an active Deal Check session — floralArtUnitRate/patternExtra
    // already fall back to studioFloralData for this exact reason; mirror that here too.
    const floralSrc = dealCheckData || studioFloralData || {};

    // Kit + flower recipe, from either/both of two independent sources — both can apply to the
    // same kit at once:
    //  (1) a recipe explicitly attached to this kit as an "add-on" in the Inventory Kit editor
    //      (item.subItems entries with a patternId) — a denotation only, priced here instead of
    //      contributing to the kit's own rental total (kitTotalFromInventory skips these).
    //  (2) whatever recipe matches this kit's own sub-category/name (matchFlowerPattern) — the
    //      same mechanism non-kit Florals items use below, now applying to ANY kit regardless of
    //      its own top-level category (e.g. a console-table kit filed under Furniture still gets
    //      its sub-category's recipe priced in, without needing to be filed under "Florals").
    // Neither blends real/artificial — that toggle exists to cut cost on plain flower-pot-style
    // items with an artificial mix, which doesn't apply to a fixed decorative kit; both price at
    // the recipe's full Studio rate (100% real). Falls through to normal kit-rental pricing
    // (including the availability-shortfall path below) when neither source applies.
    if (isKit) {
      const sizeKey = sizeClassToPatternKey(normalizeSizeClass(el.size || "B"));
      // recipeQty scales the recipe's own per-unit rate by however much of that recipe's unit
      // (pc/sqft/rft/...) this kit add-on specifies — e.g. 12 sqft of a per-sqft recipe.
      // A kit's recipe blends real/artificial by the global ratio exactly like a standalone recipe
      // element does (see the non-kit floral path below) — a sub-category floral_mode of real/
      // artificial pins it to 100/0, otherwise it follows the deal's floralRatio. `extra` (pot/base)
      // is added once, un-blended, matching getElPrice's composition order.
      // `override` (a kit's own subItems/kitOverrides entry for this pattern add-on) lets each
      // attached recipe pin its own SMB size and real/artificial ratio independent of the kit
      // element's own size toggle and the deal's global ratio — set via the 🌐/🎯/Size controls in
      // KitComponentsEditor.jsx and InventoryTab.jsx's kit builder. Undefined fields fall back to
      // the previous shared behavior (element size / sub-category mode / global floralRatio).
      const recipeCost = (pattern, subKey, recipeQty = 1, override) => {
        if (!pattern) return 0;
        const szKey = override?.size || sizeKey;
        const rates = floralPatternUnitRates(pattern, szKey, floralSrc.mandiCatalogue || [], floralSrc, imsInventory, rcFactorByKey);
        if (!rates) return 0;
        const sk = String(subKey || pattern.sub || "").trim().toLowerCase();
        const subMode = sk ? rcFloralModeByKey[sk] : undefined;
        const modeDefault = subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, 100 - floralRatio));
        const realPct = (typeof override?.realPct === "number" && override.realPct >= 0 && override.realPct <= 100) ? override.realPct : modeDefault;
        const blended = Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra;
        return blended * (Number(recipeQty) || 0);
      };
      const subCatPattern = matchFlowerPattern(item, floralSrc.flowerPatterns || []);
      // Per-instance overrides (el.kitOverrides) replace the kit's own global subItems recipe for
      // THIS element only — same source priceForInvItem below already reads for the rental total.
      const effectiveSubItems = Array.isArray(el.kitOverrides) ? el.kitOverrides : (item.subItems || []);
      const attachedPatterns = effectiveSubItems
        .filter((si) => si.patternId)
        .map((si) => ({ pattern: (floralSrc.flowerPatterns || []).find((p) => p.id === si.patternId), qty: si.qty, si }))
        .filter((x) => x.pattern);
      // (3) a plain component that is ITSELF a floral item — its own sub-category's recipe. Only its
      //     flat rental reaches priceForInvItem, so the recipe money is topped up here. This was
      //     missing: the kit's own breakdown (KitComponentsEditor's footer) counted it while the
      //     charged price did not, so a console kit billed ₹3,746 against a ₹7,715 breakdown. Same
      //     shared helper both sides now call, so they cannot disagree again.
      const compDelta = kitFloralCompDelta({
        comps: effectiveSubItems, inventory: imsInventory, flowerPatterns: floralSrc.flowerPatterns || [],
        mandiCatalogue: floralSrc.mandiCatalogue || [], floralSettings: floralSrc,
        rcFloralModeByKey, floralRatio, elSize: el.size, rcFactorByKey,
      });
      // compDelta alone is enough to take this branch — a kit can have floral components without
      // carrying a sub-category recipe or any add-on of its own.
      if (subCatPattern || attachedPatterns.length || compDelta > 0) {
        const flowerCost = recipeCost(subCatPattern, item.subCat || item.subcategory) + attachedPatterns.reduce((sum, x) => sum + recipeCost(x.pattern, x.pattern.sub, x.qty, x.si), 0) + compDelta;
        const unitPrice = priceForInvItem(item, rcFactorByKey, imsInventory, el.kitOverrides) + flowerCost;
        const anySMB = subCatPattern?.mode === "smb" || attachedPatterns.some((x) => x.pattern.mode === "smb");
        return { rc: null, unitPrice, lineCost: repeatAdjustedLineCost(item, qty, unitPrice, opts?.zc, opts?.venueName), area: 0, warning: null, isFloralBlend: false, realPct: null, patternSMB: anySMB };
      }
    }

    // Floral-recipe pricing (non-kit): an inventory item whose name/sub-category matches a flower
    // pattern prices from the recipe's real/artificial Studio rates instead of rental × scaling
    // factor — that rate is already the final all-in customer price (synced verbatim from the same
    // recipe onto Rate Card items elsewhere), so no factor/availability-shortfall logic applies on
    // top. Size defaults to "B" (Big) per the element's own size toggle
    // (StudioBuild.jsx/ManageLibrary.jsx), not derived from the item's name.
    const isFloral = String(item.cat || item.category || "").toLowerCase() === "florals";
    if (isFloral && !isKit) {
      const pattern = matchFlowerPattern(item, floralSrc.flowerPatterns || []);
      const sizeKey = pattern ? sizeClassToPatternKey(normalizeSizeClass(el.size || "B")) : null;
      const rates = pattern ? floralPatternUnitRates(pattern, sizeKey, floralSrc.mandiCatalogue || [], floralSrc, imsInventory, rcFactorByKey) : null;
      if (rates) {
        const subKey = String(item.subCat || item.subcategory || "").trim().toLowerCase();
        const subMode = subKey ? rcFloralModeByKey[subKey] : undefined;
        const modeDefault = subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, 100 - floralRatio));
        const realPct = (typeof el.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) ? el.realPct : modeDefault;
        // Flower cost blends by real/artificial %; the pot/container itself doesn't — this specific
        // item's own rental (× its sub-category's scaling factor) is always added on top, alongside
        // the recipe's own generic "extra (pot/base)" figure.
        const unitPrice = Math.round(realPct / 100 * rates.realRate + (100 - realPct) / 100 * rates.artRate) + rates.extra + priceForInvItem(item, rcFactorByKey, imsInventory);
        return { rc: null, unitPrice, lineCost: repeatAdjustedLineCost(item, qty, unitPrice, opts?.zc, opts?.venueName), area: 0, warning: null, isFloralBlend: true, realPct, patternSMB: pattern.mode === "smb" };
      }
    }

    if (opts?.checkAvailability) {
      // blocksForDate lets a caller price a NON-active function's shortfall against ITS OWN date
      // (see getElPriceForFn) — falls back to the single active-function cache for every existing
      // Build-view caller, which never passes it and keeps working exactly as before.
      const available = getStudioAvailable(item, opts?.blocksForDate ?? activeBlocksForDate);
      const ownedQty = Math.min(qty, available);
      const shortQty = Math.max(0, qty - available);
      const ownedRate = priceForInvItem(item, rcFactorByKey, imsInventory, el.kitOverrides);
      const shortRate = (Number(item.cost) || 0) * (rcCostPctForSub(item.subCat || item.subcategory) / 100);
      // Repeat discount applies to the owned/available portion only — same ordering Deal Check's
      // own rollup already uses (DealCheckOverlay.jsx): the shortfall (not actually free in stock)
      // bills at cost% regardless, never discounted further on top of that.
      const lineCost = repeatAdjustedLineCost(item, ownedQty, ownedRate, opts?.zc, opts?.venueName) + shortQty * shortRate;
      const unitPrice = qty > 0 ? lineCost / qty : ownedRate;
      const warning = shortQty > 0 ? `⚠ ${shortQty} of ${qty} not free in stock for this date — priced at cost%` : null;
      return { rc: null, unitPrice, lineCost, area: 0, warning, isFloralBlend: false, realPct: null, available };
    }
    const unitPrice = priceForInvItem(item, rcFactorByKey, imsInventory, el.kitOverrides);
    return { rc: null, unitPrice, lineCost: repeatAdjustedLineCost(item, qty, unitPrice, opts?.zc, opts?.venueName), area: 0, warning: null, isFloralBlend: false, realPct: null };
  }, [imsInventory, rcFactorByKey, rcCostPctForSub, activeBlocksForDate, dealCheckData, studioFloralData, rcFloralModeByKey, floralRatio, fvCfgForRepeat]);
  // Shared SMB/flat rate resolution — the one place `getElPrice`, `getElPriceForFn`, and
  // `calcFullEventCost` all resolve a rate-card item's base rate for an element's size, now with
  // the sub-category scaling factor applied. Previously duplicated verbatim in all three
  // functions; consolidated here so the factor only needs wiring in once.
  const resolveRcRate = useCallback((rc, sz) => {
    let realRate = 0, artRate = 0;
    if (rcIsSMB(rc)) {
      if (sz === "S" || sz === "SMALL") { realRate = rc.inhouseS || 0; artRate = rc.artificialS || 0; }
      else if (sz === "B" || sz === "BIG" || sz === "LARGE" || sz === "PREMIUM" || sz === "HEAVY") { realRate = rc.inhouseB || 0; artRate = rc.artificialB || 0; }
      else { realRate = rc.inhouseM || 0; artRate = rc.artificialM || 0; }
    } else {
      realRate = rc.inhouseFlat || 0;
      artRate = rc.artificialFlat || 0;
    }
    const factor = rcScalingFactor(rc);
    return { realRate: realRate * factor, artRate: artRate * factor };
  }, [rcScalingFactor]);

  const buildZoneConfig = (zk, photoDims) => {
    const zm = zoneMeta[zk]; if (!zm || !zm.dimFields?.length) return null;
    const d = photoDims || {};
    // Extra truss/platform rows (zoneUploadReview.dims.trussRows/platformRows, Library-shape) →
    // zoneConfig-shape extraTrussRows/extraPlatformRows, same conversion "row 0" gets below.
    const mapTrussRow = (row) => {
      const rDims = {};
      if (row.trussL) rDims.L = row.trussL;
      if (row.trussW) rDims.W = row.trussW;
      if (row.trussH) rDims.H = row.trussH;
      const numRDims = [rDims.L, rDims.W, rDims.H].filter(v => (v || 0) > 0).length;
      return {
        id: row.id, dims: rDims, trT: numRDims >= 3 ? "box" : (zm.defaultTruss || "singleU"),
        trussQty: Math.max(1, Number(row.trussQty) || 1),
        trussFrontExt: Number(row.trussFrontExt) || 0,
        trussFrontExtH: Number(row.trussFrontExtH) || 0,
        mkOn: !!row.mkT, mkT: row.mkT || null, mkWalls: row.mkWalls || {},
        trussMaterial: row.trussMaterial ?? null, drapeDensity: row.drapeDensity ?? null,
        customCeilingItemId: row.customCeilingItemId ?? null, customMaskingItemId: row.customMaskingItemId ?? null,
      };
    };
    const mapPlatformRow = (row) => ({
      id: row.id, plH: row.plH || null, cpT: row.cpT ?? null,
      floorDims: (row.floorL || row.floorW) ? { L: row.floorL || 0, W: row.floorW || 0 } : {},
    });
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
      plH: d.plH || null, cpT: d.cpT ?? null,
      trussMaterial: d.trussMaterial ?? null, drapeDensity: d.drapeDensity ?? null,
      customCeilingItemId: d.customCeilingItemId ?? null, customMaskingItemId: d.customMaskingItemId ?? null,
      // Carry truss quantity + box front-extension tagged on the library photo through to Build.
      trussQty: Math.max(1, Number(d.trussQty) || 1),
      trussFrontExt: Number(d.trussFrontExt) || 0,
      trussFrontExtH: Number(d.trussFrontExtH) || 0,
      extraTrussRows: (d.trussRows || []).map(mapTrussRow),
      extraPlatformRows: (d.platformRows || []).map(mapPlatformRow),
    };
  };

  const applyFloralRatio = useCallback((unitPrice, rc) => unitPrice, []);

  // Floral recipe dataset (flowerPatterns, mandi prices, artificial-mix rates, markup) — loaded on
  // mount so the Build view can auto-derive floral rates without the user first opening Deal Check
  // (which fetches the full dealCheckData). floralArtUnitRate/patternExtra prefer dealCheckData
  // (date-aware, fresher) and fall back to this. Also re-fetched live below whenever IMS edits any
  // of these settings rows — a recipe/mandi-price/markup change should reach Studio instantly, not
  // just on next reload, same as inventory item edits already do (see the "inventory" table
  // subscription below).
  const FLORAL_DATA_KEYS = [
    "flowerPatterns", "mandiCatalogue", "artificialFlowerRatePerKg", "artificialFlowerBunchesPerKg",
    "artificialGreenRatePerKg", "artificialGreenBunchesPerKg", "defaultStudioMarkup",
    "fixedVenues", "fixedVenueSubcatDiscount",
  ];
  const refreshStudioFloralData = useCallback(async () => {
    try {
      const { data } = await supabase.from("settings").select("key,value").in("key", FLORAL_DATA_KEYS);
      const s = {};
      (data || []).forEach(r => { let v = r?.value; for (let i = 0; i < 2; i++) { if (typeof v === "string") { try { v = JSON.parse(v); } catch { break; } } } s[r.key] = v; });
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
  }, []);
  useEffect(() => { refreshStudioFloralData(); }, [refreshStudioFloralData]);

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
    let cost = 0, mappedFinal = 0, realOnlyCost = 0, invItemCost = 0;
    comp.flowers.forEach(fl => {
      if (fl.invItemId) {
        // A direct IMS Inventory ingredient (no mandi-flower counterpart at all) — mirrors
        // flowerHelpers.js's floralPatternUnitRates: priced raw (no rate_card_categories scaling
        // factor — the recipe's own Markup field owns this, not the general Studio pricing rules)
        // and marked up by the same `markup` this function's real callers use, so it contributes
        // its full cost here instead of silently dropping out (resolveMandiFlower(undefined) would
        // return null, `ft` would default to "flower", and it would be priced as an artificial
        // bunch estimate of ₹0 — this was the same class of bug the Real Only fix above closes).
        const item = (imsInventory || []).find(i => i.id === fl.invItemId);
        const rawPrice = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
        invItemCost += (Number(fl.qty) || 0) * rawPrice;
        return;
      }
      const res = resolveMandiFlower(fl.flowerId, mc);
      const parent = res?.parent || null;
      const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
      if (ft === "real_only") {
        // No artificial substitute exists — this flower is bought at mandi rate regardless of the
        // element's real/artificial slider, so its cost must land identically on both sides of the
        // blend (mirrors flowerHelpers.js's floralPatternUnitRates) instead of vanishing to ₹0 as
        // real% drops. Marked up by the SAME `markup` the real side uses, tracked separately from
        // `cost` so it isn't also run through the bunches-per-kg artificial rate.
        realOnlyCost += (Number(fl.qty) || 0) * (res?.price || 0);
        return;
      }
      if (ft === "mapping") {
        // Artificial version is a SPECIFIC inventory item — priced LIVE the same way every other
        // inventory item in Studio is (item.price × its sub-category's scaling_factor), not the
        // one-time artificialMapPrice/Cost snapshot taken when it was mapped (that's just the raw
        // pre-factor price, captured once — stale the moment either number changes afterward).
        // Falls back to the snapshot only if the mapped item can no longer be found.
        const invItem = (imsInventory || []).find(i => i.id === parent?.artificialMapItemId);
        const liveRate = invItem ? priceForInvItem(invItem, rcFactorByKey, imsInventory) : (Number(parent?.artificialMapPrice) || Number(parent?.artificialMapCost) || 0);
        mappedFinal += (Number(fl.qty) || 0) * liveRate;
        return;
      }
      const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
      const bunches = (Number(fl.qty) || 0) * bpu;
      cost += bunches * (ft === "green" ? agRate / agBPK : afRate / afBPK);
    });
    return Math.round(cost * markup + mappedFinal + realOnlyCost * markup + invItemCost * markup);
  }, [dealCheckData, studioFloralData, imsInventory, rcFactorByKey]);

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

  // venueName (optional): defaults to the CURRENTLY ACTIVE function's own venue (activeFnMeta.venue
  // already resolves that — function 0 or whichever extraFunctions entry is active) — every
  // existing caller of getElPrice/calcElsCost prices the active function's live canvas, so this
  // default is always correct for them without having to pass it explicitly at each call site.
  const getElPrice = useCallback((el, zc, opts, venueName) => {
    if (el.invId) return getElPriceFromInventory(el, { ...opts, zc, venueName: venueName ?? activeFnMeta.venue }); // IMS inventory-sourced element — Rate Card never consulted
    if (el.patternId) return getElPriceFromPattern(el); // pure flower-recipe element, no inventory item
    const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
    if (!rc) return { rc: null, unitPrice: 0, lineCost: 0, area: 0, warning: null, isFloralBlend: false, realPct: null };
    const isFloral = (rc.cat || "").toLowerCase() === "florals";
    const mode = getFloralMode(rc, rcFloralModeByKey);
    const sz = (el.size || "").toUpperCase();
    const { realRate, artRate } = resolveRcRate(rc, sz);
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
  }, [rcItems, getFloralMode, rcFloralModeByKey, floralRatio, floralArtUnitRate, patternExtra, resolveRcRate, getElPriceFromInventory, getElPriceFromPattern, activeFnMeta]);

  const calcElsCost = useCallback((elements, withFloral, zc, opts, venueName) => {
    return (elements || []).reduce((s, el) => {
      const { rc, lineCost } = getElPrice(el, zc, opts, venueName);
      if (!withFloral || !rc) return s + lineCost;
      if (rc.unit === "truss_sqft") return s + applyFloralRatio(lineCost, rc);
      return s + (el.qty || 0) * applyFloralRatio(lineCost / (el.qty || 1), rc);
    }, 0);
  }, [getElPrice, applyFloralRatio]);

  // checkAvail (optional): mirrors getElPrice's opts.checkAvailability. blocksForDate (optional) is
  // the specific function's OWN date's blocks (from the blocksByDate map — see the warming effect
  // below) — pass it whenever checkAvail is true for a function that ISN'T necessarily the active
  // one, so its shortfall prices against its own date rather than falling back to whichever date
  // activeBlocksForDate happens to be warmed for. Omitted, it falls back to activeBlocksForDate
  // inside getElPriceFromInventory, same as before this existed.
  // venueName (optional, no default): unlike getElPrice, this variant is explicitly "for a given
  // function snapshot" — callers iterate their OWN fns/fnData with its own fnVenue, so there is no
  // single correct default the way activeFnMeta.venue is for the always-active-function getElPrice.
  // Omit it and a Repeat zone here simply prices at full rate, same as before this existed.
  const getElPriceForFn = useCallback((el, zc, fnRatio, checkAvail, venueName, blocksForDate) => {
    if (el.invId) return getElPriceFromInventory(el, { checkAvailability: !!checkAvail, zc, venueName, blocksForDate }); // IMS inventory-sourced element — Rate Card never consulted
    if (el.patternId) return getElPriceFromPattern(el); // pure flower-recipe element, no inventory item
    const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
    if (!rc) return { rc: null, unitPrice: 0, lineCost: 0 };
    const isFloral = (rc.cat || "").toLowerCase() === "florals";
    const mode = getFloralMode(rc, rcFloralModeByKey);
    const sz = (el.size || "").toUpperCase();
    const { realRate, artRate } = resolveRcRate(rc, sz);
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
  }, [rcItems, getFloralMode, rcFloralModeByKey, floralArtUnitRate, patternExtra, resolveRcRate, getElPriceFromInventory, getElPriceFromPattern]);

  const calcElsCostForFn = useCallback((elements, zc, fnRatio, checkAvail, venueName, blocksForDate) => {
    return (elements || []).reduce((s, el) => s + getElPriceForFn(el, zc, fnRatio, checkAvail, venueName, blocksForDate).lineCost, 0);
  }, [getElPriceForFn]);

  // The price badge on every UNSELECTED photo tile: what this zone would cost if you picked this
  // photo instead. Its whole job is to be compared against the selected tile's number, which comes
  // from zoneTotal — and zoneTotal prices with {checkAvailability:true}, so anything short in stock
  // for this date is charged at the shortfall rate rather than the full one.
  // Without the same flag here, the two sides of that comparison were priced by different rules:
  // every preview quoted the full rate, so a photo needing short stock advertised a number nobody
  // would ever be charged, and selecting it changed the price the moment you clicked. Same bug the
  // "By zone" row already carries a note about in StudioBuild — this was the remaining call site.
  const calcPhotoCost = useCallback((zoneKey, photo) => {
    const zc = (photo?.dims && Object.values(photo.dims).some(v => v > 0)) ? buildZoneConfig(zoneKey, photo.dims) : null;
    const elCost = calcElsCost(photo?.elements, true, zc, { checkAvailability: true });
    const structCost = zc ? calcStructCost(zoneKey, zc, structRates).total : 0;
    return elCost + structCost;
  }, [calcElsCost, structRates]);

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
        if (zc) decorCost += calcStructCost(zk, zc, structRates).total;
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
        if (el.invId) { decorCost += getElPriceFromInventory(el).lineCost; return; } // IMS inventory-sourced — no Rate Card lookup
        if (el.patternId) { decorCost += getElPriceFromPattern(el).lineCost; return; } // pure flower-recipe element, no inventory item
        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
        if (!rc) return;
        const sz = (el.size || "").toUpperCase();
        let up = resolveRcRate(rc, sz).realRate;
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
    // No decor priced at all → nothing to deliver or power, so skip truck/genset cost entirely
    // (matches calcFunctionCost/calcFunctionBreakdown, which already gate transport on decor > 0).
    if (decorCost <= 0) return decorCost;
    const allTrucks = itemTrucks + floralTrucks + bufTrucks;
    const truckTotal = allTrucks * tripRate * 2;
    // 125 KVA count follows the venue only (no customGensets here, matching this function's prior
    // behaviour — this is a Browse-card estimate, not the live deal's own priced total).
    const gensetCost = resolveGensetPlan(match, null, genset62, gensetRate, gensetRate62).gensetCost;
    return decorCost + truckTotal + gensetCost;
  }, [ytVideoTags, libItems, rcItems, getElPrice, resolveRcRate, getElPriceFromInventory, getElPriceFromPattern, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62, genset62, structRates]);

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
    // Always derive zones fresh from the live zoneConfig/enabledEls — matches calcFunctionCost and
    // calcFunctionBreakdown below. `activeZones` used to take priority here when non-empty, but it's
    // stale legacy state (only ever repopulated from an old restored session, reset to [] on almost
    // every edit) — letting it override the live config silently priced a deal from an out-of-date
    // zone list whenever a session happened to still be carrying one.
    const zones = Object.entries(zoneConfig).filter(([zk, cfg]) => enabledEls[zk] && cfg).map(([zk, cfg]) => ({ id: zk, type: zk, name: zk, config: cfg }));
    zones.forEach(z => { c += calcStructCost(z.type, z.config, structRates).total; });
    Object.entries(zoneElements).forEach(([zk, elems]) => {
      if (!enabledEls[zk] || !elems) return;
      c += calcElsCost(elems, true, zoneConfig[zk], { checkAvailability: true }); // active fn's live canvas — see activeBlocksForDate
    });
    const fnIdx = activeFnIdx || 0;
    // Only count a custom Production/Buying item while its own zone is still enabled — matches
    // how normal element-card costs are gated by enabledEls above, and matches
    // calcFunctionBreakdown (Summary's accordion), which already scoped this way. Previously this
    // counted every custom item for the function regardless of zone toggle state, so switching a
    // zone off didn't remove its custom items from the total the way it removes everything else.
    dcCustomItems.filter(ci => ci.fnIdx === fnIdx && enabledEls[ci.zoneKey]).forEach(ci => {
      c += (ci.manualPrice || ci.refPrice || 0) * (Number(ci.qty) || 1);
    });
    return c;
  }, [venue, enabledEls, zoneConfig, zoneElements, calcElsCost, dcCustomItems, activeFnIdx, structRates]);

  const transportCalc = useMemo(() => {
    if (!venue) return { trucks: 0, tripRate: 0, total: 0, isNew: true, tier: "new", tierLabel: "", breakdown: [], floralTrucks: 0, bufferTrucks: 0, itemTrucks: 0 };
    const match = trVenues.find(v => v.name.toLowerCase() === venue.toLowerCase());
    const isNew = !match;
    const tripRate = match ? match.rate : customTripRate;
    const tierId = match ? match.tier : "new";
    const tierLabel = match ? (TR_TIERS.find(t => t.id === match.tier)?.label || match.tier) : "New venue";
    const decor = totalCost();
    // No decor selected at all → nothing to deliver or power, so no trucks/genset either. Matches
    // calcFunctionCost/calcFunctionBreakdown, which already skip transport entirely when a
    // function's decor total is 0 — this was the one place still charging it unconditionally
    // as soon as a venue was picked, even with every zone toggled off.
    if (decor <= 0) {
      const venueOnly = resolveVenueGensets(match);
      return { trucks: 0, tripRate, total: 0, isNew, tier: tierId, tierLabel, breakdown: [], floralTrucks: 0, bufferTrucks: 0, itemTrucks: 0, totalFloralCost: 0, gensets: 0, venueGensets: venueOnly.genset125, venueGenset62: venueOnly.genset62, gensetCost: 0, gensetRate, gensetRate62, genset62: 0, truckTotal: 0 };
    }
    const breakdown = [];
    const { itemTrucks, breakdown: itemBd } = computeTruckItems(zoneElements, zoneConfig, enabledEls, rcItems, truckCap, imsInventory, (dealCheckData || studioFloralData)?.flowerPatterns);
    itemBd.forEach(b => breakdown.push(b));
    const floralTrucks = 0, totalFloralCost = 0; // florals now counted via their sub-category capacity — no separate flower truck
    const bt = bufferTiers.find(b => decor >= b.minBudget && decor < b.maxBudget);
    const bufTrucks = bt ? bt.bufferTrucks : 0;
    if (bufTrucks > 0) breakdown.push({ label: "Buffer", qty: 0, perTruck: 0, unit: "", trucks: bufTrucks, isBuffer: true, tierLabel: bt?.label || "" });
    const allTrucks = itemTrucks + floralTrucks + bufTrucks;
    const plan = resolveGensetPlan(match, customGensets, genset62, gensetRate, gensetRate62);
    const truckTotal = allTrucks * tripRate * 2;
    const total = truckTotal + plan.gensetCost;
    return { trucks: allTrucks, tripRate, total, isNew, tier: tierId, tierLabel, breakdown, floralTrucks, bufferTrucks: bufTrucks, itemTrucks, totalFloralCost, gensets: plan.genset125, venueGensets: plan.venueGenset125, venueGenset62: plan.venueGenset62, gensetCost: plan.gensetCost, gensetRate, gensetRate62, genset62: plan.genset62, truckTotal };
  }, [venue, customTripRate, customGensets, gensetRate, gensetRate62, genset62, trVenues, zoneElements, enabledEls, rcItems, truckCap, floralPerTruck, bufferTiers, totalCost, zoneConfig, imsInventory, dealCheckData, studioFloralData]);

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
        ? { zoneElements, zoneConfig, enabledEls, elSelectedPhoto, itemQty, itemGrades, activeZones, customZones, elTiers, floralRatio, genset62, customGensets, customTripRate, elNotes, floralOverrides }
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
        genset62: typeof snap.genset62 === "number" ? snap.genset62 : null,
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
    const fVenue = fnData.fnVenue || "";
    const fFloralRatio = typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70;
    let decor = 0;
    // Always derive zones fresh from the live zoneConfig/enabledEls — see totalCost's matching
    // comment. `activeZones` no longer takes priority here. Also dropped the legacy itemQty
    // catalogue loop that used to sit here — it looked items up in the old per-item catalogue,
    // which was already emptied out elsewhere, so the loop never actually added any cost;
    // removing it just retires visibly-dead code, it doesn't change any computed total.
    const zones = Object.entries(fZoneConfig).filter(([zk, cfg]) => fEnabledEls[zk] && cfg).map(([zk, cfg]) => ({ id: zk, type: zk, name: zk, config: cfg }));
    zones.forEach(z => { decor += calcStructCost(z.type, z.config, structRates).total; });
    // Availability-shortfall pricing now runs for EVERY function, each against its OWN date's
    // blocks (blocksByDate — warmed for every function's date, not just the active one). It used to
    // only run for whichever function was the active Build tab (activeBlocksForDate has no other
    // date to check against) — so switching tabs moved which function got the shortfall discount,
    // and this total (Summary's top banner, Deal Check's quote) shifted on every click even though
    // nothing about the event had changed. blocksByDate[fnData.fnDate] can briefly be undefined
    // right after a date changes and before the fetch resolves — getStudioAvailable(item, undefined)
    // just reads as "nothing blocked yet", the same safe empty-state every date starts from anyway.
    const fBlocksForDate = blocksByDate[fnData.fnDate];
    Object.entries(fZoneElements).forEach(([zk, elems]) => {
      if (!fEnabledEls[zk] || !elems) return;
      decor += calcElsCostForFn(elems, fZoneConfig[zk], fFloralRatio, true, fVenue, fBlocksForDate);
    });
    // Only count a custom item while its own zone is still enabled — matches calcFunctionBreakdown
    // (Summary's accordion), which already scoped this way; this one used to count every custom
    // item for the function regardless of zone toggle state.
    dcCustomItems.filter(ci => ci.fnIdx === fnData.fnIdx && fEnabledEls[ci.zoneKey]).forEach(ci => {
      decor += (ci.manualPrice || ci.refPrice || 0) * (Number(ci.qty) || 1);
    });
    let transport = 0;
    if (fVenue && decor > 0) {
      const match = trVenues.find(v => v.name.toLowerCase() === fVenue.toLowerCase());
      const fCustomTripRate = typeof fnData.customTripRate === "number" ? fnData.customTripRate : 0;
      const fCustomGensets = typeof fnData.customGensets === "number" ? fnData.customGensets : null;
      const fCustomGenset62 = typeof fnData.genset62 === "number" ? fnData.genset62 : null;
      const tripRate = match ? match.rate : fCustomTripRate;
      const capBySub = {}; (truckCap || []).forEach(tc => { if ((Number(tc.perTruck) || 0) > 0) capBySub[String(tc.item || "").toLowerCase().trim()] = tc; });
      const subAgg = {};
      const addSub = (sub, qty) => { const k = String(sub || "").toLowerCase().trim(); const tc = capBySub[k]; if (!tc || !(qty > 0)) return; if (!subAgg[k]) subAgg[k] = { perTruck: Number(tc.perTruck) || 0, qty: 0 }; subAgg[k].qty += qty; };
      // Same fix as calcFunctionBreakdown's identical loop below — an element's sub-category for
      // truck-capacity purposes comes ONLY from live IMS identity (el.invId or el.patternId), never
      // a Rate-Card name-match — Rate Card's own `.sub` is a separate, older vocabulary that doesn't
      // track IMS's live Sub-Categories master.
      const fcFlowerPatterns = (dealCheckData || studioFloralData)?.flowerPatterns || [];
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const invItem = el.invId ? imsInventory.find(i => i.id === el.invId) : null;
          const pattern = (!invItem && el.patternId) ? fcFlowerPatterns.find(p => p.id === el.patternId) : null;
          const sub = invItem?.subCat || invItem?.subcategory || pattern?.sub || "";
          const tc = capBySub[String(sub || "").toLowerCase().trim()]; if (!tc) return;
          if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(sub, L * W * (Number(el.qty) || 1)); }
          else addSub(sub, Number(el.qty) || 0);
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {};
        const fd = cfg.floorDims || d;
        if (cfg.trT === "box") { const tSqft = (d.L || 0) * (d.W || 0) * Math.max(1, cfg.trussQty || 1); if (tSqft > 0) addSub("Truss", tSqft); }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) { if (cfg.plH) addSub("Platform", sqft); if (cfg.cpT && cfg.cpT !== CARPET_OFF) addSub("Carpet", sqft); }
      });
      let truckFrac = 0; Object.values(subAgg).forEach(s => { if (s.perTruck > 0) truckFrac += (s.qty || 0) / s.perTruck; });
      const itemTrucks = Math.ceil(truckFrac);
      const floralTrucks = 0; // florals counted via their sub-category capacity — no separate flower truck
      const bt = bufferTiers.find(b => decor >= b.minBudget && decor < b.maxBudget);
      const bufTrucks = bt ? bt.bufferTrucks : 0;
      const allTrucks = itemTrucks + floralTrucks + bufTrucks;
      const truckTotal = allTrucks * tripRate * 2;
      const gensetCost = resolveGensetPlan(match, fCustomGensets, fCustomGenset62, gensetRate, gensetRate62).gensetCost;
      transport = truckTotal + gensetCost;
    }
    return { decor, transport, grand: decor + transport };
  }, [calcElsCostForFn, rcItems, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62, dcCustomItems, structRates, blocksByDate, imsInventory, dealCheckData, studioFloralData]);

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
      const subKey = String(rc?.sub || rc?.imsAlias || "").trim().toLowerCase();
      const subMode = subKey ? rcFloralModeByKey[subKey] : undefined;
      if (subMode === "real") return 100; if (subMode === "artificial") return 0;
      if (typeof rc?.defaultRealPct === "number") return rc.defaultRealPct;
      return Math.max(0, Math.min(100, 100 - fnRatio));
    };
    let tArt = 0, realIncome = 0, artIncome = 0, artFlowerBunches = 0, artGreenBunches = 0, fixedExtras = 0;
    // Real-flower quantities/rates, aggregated by mandi parent id across every element in this
    // function — mirrors DCFloralsTab.jsx's own `flowerAgg`. Needed (not just a running total)
    // because the swap-override pass below has to divert quantity FROM one flower's aggregate
    // INTO another's, same as the tab does; a flat running total can't express that.
    const flowerAgg = new Map(); // parentId → { totalQty, unitPrice, name, unit }
    // Salesperson customizations made in Deal Check's own Florals tab — this rollup used to ignore
    // both entirely, so a swapped-in flower or a picked colour/preference rate never reached the
    // bottom-bar Florals total (or GYV/Dept Income, which is built from this same function).
    const colorPrefsForFn = dcFloralColorPrefs?.[fn?.fnIdx] || {};
    const fnOverrides = fn?.floralOverrides || { rows: [] };
    const overrideByParentId = new Map();
    (fnOverrides.rows || []).forEach(r => { if (r?.flowerId) overrideByParentId.set(r.flowerId, r); });
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (!fn.enabledEls?.[zk]) return;
      (elems || []).forEach(el => {
        // Mirrors DCFloralsTab's resolution — the two must agree, or the tab lists elements the
        // bottom-bar total does not count. An exact-only rate-card match dropped "Blue Pottery Pot
        // Big" (the row is "Blue Pottery Pot"), and keying "is this floral" off the rate-card
        // category alone dropped "Floating Floral", which is priced from its own patternId and has
        // no rate-card row at all. Both were costed as plain rental instead.
        const elNm = (el.name || "").toLowerCase().trim();
        let rc = rcItems.find(i => (i.name || "").toLowerCase().trim() === elNm);
        // Same leniency gate DCFloralsTab.jsx uses: BOTH names need ≥4 chars before substring
        // matching is attempted. This rollup was missing the elNm-length half of that guard, so a
        // short element name (e.g. "Pot") could spuriously substring-match an unrelated florals
        // Rate Card row here while the tab correctly left it unmatched — the two disagreeing on
        // which elements even counted as priced florals, not just on the price.
        if (!rc && elNm.length >= 4) {
          rc = rcItems.find(i => {
            if (String(i.cat || "").toLowerCase() !== "florals") return false;
            const n = (i.name || "").toLowerCase().trim();
            return n && n.length >= 4 && (elNm.includes(n) || n.includes(elNm));
          });
        }
        // el.invId is Build's THIRD identity source (getElPrice/getElPriceForFn check invId before
        // patternId before falling back to the Rate Card by name — Rate Card is never even consulted
        // for an invId element). This rollup had no branch for it at all: an IMS-inventory-sourced
        // floral element — the common case for a real physical product; patternId is reserved for
        // pure recipe-only elements with no inventory backing — only counted here if its name also
        // happened to match a Rate Card row, so most of a real build's florals silently contributed
        // NOTHING to this total, while DCFloralsTab.jsx (which resolves invId directly) kept showing
        // the correct, much larger figure. Same fix as that tab, ported here so the two agree.
        const invItem = el.invId ? imsInventory.find(i => i.id === el.invId) : null;
        const invIsFloral = !!invItem && String(invItem.cat || invItem.category || "").toLowerCase() === "florals";
        const elPat = el.patternId ? fp.find(p => p.id === el.patternId) : null;
        if (!el.patternId && !invIsFloral && String(rc?.cat || "").toLowerCase() !== "florals") return;
        const q = el.qty || 0; if (q <= 0) return;
        const rp = resRP(el, rc) / 100, ap = 1 - rp;
        // Billed income split — EVERY floral arrangement bills (recipe-driven or not): the real
        // portion at the inhouse rate, the artificial portion at the artificial rate (mirrors
        // getElPrice's blend). Computed at element level, before the recipe gate below.
        // Guarded: rc can be null now (element priced from its own patternId/invId with no rate-card
        // row). resolveRcRate reads rc.inhouseFlat unguarded and would throw. No rate-card row means
        // no billed rate to split, so income simply has nothing to add here — the sourcing COST below
        // still computes from the recipe, which is the number this function exists to produce.
        if (rc) { const szU = String(el.size || "").toUpperCase(); const { realRate: rr, artRate: ar } = resolveRcRate(rc, szU);
          realIncome += q * rp * rr; artIncome += q * ap * ar; }
        // Prefer the recipe Build actually priced this element with, in Build's own priority order
        // (invId, then patternId, then Rate Card by name) — re-deriving it a different way could land
        // on a different recipe than Build/the salesperson actually used, or on none at all.
        // matchFlowerPattern is the same sub-category-first matcher Build itself prices from; for an
        // invId element it's fed the real IMS inventory item (matching getElPriceFromInventory
        // exactly) instead of a coincidental Rate Card name-match.
        let pat = elPat || (invItem ? matchFlowerPattern(invItem, fp) : null) || matchFlowerPattern({ subcategory: rc?.sub, name: rc?.name || el.name }, fp);
        if (!pat) return;
        // Build sizes an invId floral element the same way regardless of any Rate Card "smb" mode —
        // sizeFromMode/szMap below requires rc.inhouseMode==="smb" to honour el.size at all, which an
        // invId element (no rc, or an unrelated coincidental match) would never have, silently always
        // pricing at "medium" regardless of the S/M/B toggle actually picked on Build.
        const sk = invItem ? sizeClassToPatternKey(normalizeSizeClass(el.size || "B")) : szMap(pat?.mode || rc?.inhouseMode, el.size);
        const sizes = pat.sizes || {};
        let comp = sizes[sk] || sizes.medium;
        if (!comp && sk === "big" && sizes.large) comp = sizes.large;
        if (!comp && Object.keys(sizes).length > 0) comp = sizes[Object.keys(sizes)[0]];
        if (!comp || !Array.isArray(comp.flowers)) return;
        // Fixed extra cost (pot/base) per unit — a real cost regardless of real/artificial split.
        // Not tied to any one flower, so it sits outside flowerAgg/the swap pass entirely.
        { const ex = (Number(comp.extraCost) || 0) * q; if (ex > 0) { fixedExtras += ex; realIncome += ex; } }
        const season = sMap[fn.fnDate] || "non_saya";
        const sMult = mults[season] || 1;
        comp.flowers.forEach(fl => {
          // A direct IMS Inventory ingredient in the recipe (fl.invItemId set, no flowerId at all) —
          // a physical rented piece bundled into the recipe (a vase, a wire base), not a mandi
          // flower. DCFloralsTab.jsx counts it in FULL as real cost, never scaled by the real/
          // artificial slider (there's no "artificial" version of a physical prop) — this rollup had
          // no branch for it, so resolveMandiFlower(undefined, ...) below returned null and the whole
          // line silently dropped out of both totalReal and totalArtificial.
          if (fl.invItemId) {
            const item = imsInventory.find(i => i.id === fl.invItemId);
            const rawPrice = item ? (Number(item.price ?? item.rentalCost) || 0) : 0;
            fixedExtras += (fl.qty || 0) * q * rawPrice;
            return;
          }
          const resolved = resolveMandiFlower(fl.flowerId, mc);
          const parent = resolved?.parent || null;
          const parentId = parent?.id || fl.flowerId;
          const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          const effR = ft === "real_only" ? 1 : rp;
          const effA = ft === "real_only" ? 0 : ap;
          // Ranked colour preference (1st choice) or a legacy single colour-variant pick overrides
          // the mandi parent's base price — and skips the season multiplier, same as the Florals
          // tab: an explicit price the salesperson picked shouldn't silently move with the season.
          const override = overrideByParentId.get(parentId);
          const prefArr = colorPrefsForFn?.[parentId];
          const prefRate = Array.isArray(prefArr) && prefArr.length > 0 ? Number(prefArr[0].rate) : 0;
          const variantRate = Number(override?.colorVariant?.rate) || 0;
          const basePrice = prefRate > 0 ? prefRate : variantRate > 0 ? variantRate : (Number(parent?.currentPrice) || 0);
          const bp = (prefRate > 0 || variantRate > 0) ? basePrice : basePrice * sMult;
          const realUnits = (fl.qty || 0) * q * effR;
          if (realUnits > 0 && parent) {
            const agg = flowerAgg.get(parentId) || { totalQty: 0, unitPrice: bp, name: parent.name || "Flower", unit: parent.unit || "" };
            agg.totalQty += realUnits;
            agg.unitPrice = bp; // refresh — mirrors the Florals tab's own aggregation
            flowerAgg.set(parentId, agg);
          }
          if (effA > 0) {
            if (ft === "mapping") {
              // Mapped to a specific artificial inventory item — sourcing cost = its purchase cost per unit.
              tArt += (fl.qty || 0) * q * effA * (Number(parent?.artificialMapCost) || 0);
            } else {
              const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
              const bunches = (fl.qty || 0) * q * effA * bpu;
              const isG = ft === "green";
              if (isG) artGreenBunches += bunches; else artFlowerBunches += bunches;
              tArt += bunches * (isG ? artGreenRate / artGreenBPK : artFlowerRate / artFlowerBPK);
            }
          }
        });
      });
    });
    // Manual flower swaps (Deal Check's 🔄 swap button) — divert quantity from one flower's
    // aggregate to another's, exactly like DCFloralsTab.jsx's own post-aggregation pass, so a swap
    // made there is reflected here too instead of only in the tab's own displayed total.
    (fnOverrides.rows || []).forEach(override => {
      if (!override?.swapTo) return;
      const fromAgg = flowerAgg.get(override.swapTo.fromParentId);
      if (!fromAgg) return;
      const swapQty = Number(override.swapTo.qty) || 0;
      const isSplit = !!override.swapTo.isSplit;
      if (swapQty <= 0) return;
      if (isSplit) {
        fromAgg.totalQty = Math.max(0, fromAgg.totalQty - swapQty);
        if (fromAgg.totalQty <= 0.0001) flowerAgg.delete(override.swapTo.fromParentId);
      } else {
        flowerAgg.delete(override.swapTo.fromParentId);
      }
      const targetParent = resolveMandiFlower(override.swapTo.toParentId, mc)?.parent;
      if (!targetParent) return;
      const targetId = targetParent.id;
      const targetRate = (override.swapTo.toRate || targetParent.currentPrice || 0);
      const existing = flowerAgg.get(targetId);
      if (existing) existing.totalQty += swapQty;
      else flowerAgg.set(targetId, { totalQty: swapQty, unitPrice: targetRate, name: targetParent.name || "Flower", unit: targetParent.unit || "" });
    });
    let tReal = fixedExtras;
    const fbreak = {}; // flowerName → { name, qty, cost } (mandi shopping breakdown, real flowers)
    flowerAgg.forEach(v => {
      if (!(v.totalQty > 0)) return;
      const cost = v.totalQty * v.unitPrice;
      tReal += cost;
      if (!fbreak[v.name]) fbreak[v.name] = { name: v.name, qty: 0, cost: 0, unit: v.unit };
      fbreak[v.name].qty += v.totalQty; fbreak[v.name].cost += cost;
    });
    return { totalReal: tReal, totalArtificial: tArt, grandTotal: tReal + tArt, breakdown: Object.values(fbreak).map(f => ({ ...f, qty: Math.ceil(f.qty), cost: Math.round(f.cost) })).sort((a, b) => b.cost - a.cost), artFlowerBunches, artGreenBunches, income: { real: realIncome, art: artIncome } };
  }, [dealCheckData, rcItems, floralRatio, resolveRcRate, rcFloralModeByKey, dcFloralColorPrefs, imsInventory]);

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
    // An element's cat/sub/inhouseMode for manpower purposes comes ONLY from live IMS identity now
    // — el.invId (Inventory, the normal path for anything added via "+ Add element" today) or
    // el.patternId (a pure flower-recipe element). The legacy Rate-Card name-match fallback is
    // gone: Rate Card's own `.sub` is a separate, older vocabulary that doesn't track IMS's live
    // Sub-Categories master, and a name coincidentally matching a Rate Card row used to silently
    // override the element's real Inventory sub-category for labour-batching purposes. An element
    // with neither identity (should not exist in a build made through today's UI) simply doesn't
    // count here, same as before this comment — it never did without SOME resolvable identity.
    const walk = (fn, cb) => { const en = fn.enabledEls || {}; const ze = fn.zoneElements || {}; Object.keys(en).forEach(zk => { if (!en[zk]) return; (ze[zk] || []).forEach(el => {
      let rc = null;
      if (el.invId) {
        const invItem = imsInventory.find(i => i.id === el.invId);
        if (invItem) rc = { name: invItem.name, cat: invItem.cat || invItem.category, sub: invItem.subCat || invItem.subcategory, inhouseMode: "flat" };
      }
      if (!rc && el.patternId) {
        const pat = fps.find(p => p.id === el.patternId);
        if (pat) rc = { name: pat.name, cat: "florals", sub: pat.sub, inhouseMode: pat.mode === "smb" ? "smb" : "flat" };
      }
      if (rc) cb({ rc, el, qty: Number(el.qty || el.count || 1) });
    }); }); };
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
        let he = 0; heavyElementRanges.forEach(her => { he += heavyExtraLabour(her, lookupBySubcat(sc, her.subCat) || 0); });
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
        // Case/whitespace-insensitive — an admin's config chip and an inventory item's own sub-
        // category are independently typed strings (see lookupBySubcat in lib/ims/helpers.js).
        walk(fn, ({ rc, qty }) => { if (lookupBySubcat(batches, rc.sub || "") != null) sc[rc.sub || ""] = (sc[rc.sub || ""] || 0) + qty; });
        const rows = Object.entries(sc).map(([k, v]) => ({ sub: k, count: v, batch: lookupBySubcat(batches, k) || 3, need: v / (lookupBySubcat(batches, k) || 3) }));
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
  }, [dealCheckData, rcItems, imsInventory]);

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
    // Every function's own date, not just the active one — see calcFunctionCost's matching comment.
    const fBlocksForDate = blocksByDate[fnData.fnDate];
    const zones = Object.entries(fEnabledEls).filter(([_, on]) => on).map(([k]) => {
      // Custom zones carry their name in `.name`, not `.label` — using the raw match here left
      // custom zone names showing blank in Summary's accordion and the PDF/PPT export.
      const customZoneMatch = fCustomZones.find(cz => cz.id === k);
      const el = zoneLabelsD[k] || (customZoneMatch ? { label: customZoneMatch.name, icon: customZoneMatch.icon || "📦" } : { label: k, icon: "📦" });
      const t = fElTiers[k] || "simple";
      const ze = fZoneElements[k];
      let ic = 0, itemCount = 0;
      if (ze && ze.length > 0) {
        (ze || []).forEach(el2 => {
          // `priceInfo.rc` is only ever set for a legacy Rate-Card name match — every IMS
          // inventory-backed, kit, and pure flower-recipe element prices through
          // getElPriceFromInventory/getElPriceFromPattern instead, which always return `rc: null`
          // (it's not an error signal; lineCost is already 0 in the genuinely-unpriced case). This
          // used to skip counting ANY of those elements' cost here — the single biggest reason
          // Summary's own per-zone accordion could show a fraction of Build's/Deal Check's total.
          // checkAvail for every function now (see calcFunctionCost's comment) — keeps this
          // accordion's per-zone total matching Build's own live totalCost() when an item is
          // oversubscribed, for whichever function's zone this is, not just the active tab's.
          const priceInfo = getElPriceForFn(el2, fZoneConfig[k], fFloralRatio, true, fVenue, fBlocksForDate);
          ic += priceInfo.lineCost;
          itemCount += (el2.qty || 0);
        });
      }
      const zl = fZoneConfig[k] ? calcStructCost(k, fZoneConfig[k], structRates) : { truss: 0, masking: 0, platform: 0, carpet: 0, total: 0 };
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
      const fCustomGenset62 = typeof fnData.genset62 === "number" ? fnData.genset62 : null;
      const tripRate = match ? match.rate : fCustomTripRate;
      const tierId = match ? match.tier : "new";
      const tierLabel = match ? (TR_TIERS.find(t => t.id === match.tier)?.label || match.tier) : "New venue";
      const breakdown = [];
      const capBySub = {}; (truckCap || []).forEach(tc => { if ((Number(tc.perTruck) || 0) > 0) capBySub[String(tc.item || "").toLowerCase().trim()] = tc; });
      const subAgg = {}; const totalFloralCost = 0;
      // items[]: the zone/element lines that made up this sub-category's qty — lets the Transport
      // tab show WHAT is filling each truck-capacity row, not just its aggregate qty.
      const addSub = (sub, qty, zoneKey, itemName) => { const k = String(sub || "").toLowerCase().trim(); const tc = capBySub[k]; if (!tc || !(qty > 0)) return; if (!subAgg[k]) subAgg[k] = { label: tc.item, perTruck: Number(tc.perTruck) || 0, unit: tc.unit || "pc", qty: 0, items: [] }; subAgg[k].qty += qty; if (itemName) subAgg[k].items.push({ zoneKey: zoneKey || "", name: itemName, qty }); };
      // An element's sub-category for truck-capacity purposes comes ONLY from live IMS identity —
      // el.invId (Inventory, the normal path for anything added via "+ Add element" today) or
      // el.patternId (a pure flower-recipe element). No Rate-Card name-match fallback.
      const fFlowerPatterns = (dealCheckData || studioFloralData)?.flowerPatterns || [];
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const invItem = el.invId ? imsInventory.find(i => i.id === el.invId) : null;
          const pattern = (!invItem && el.patternId) ? fFlowerPatterns.find(p => p.id === el.patternId) : null;
          const sub = invItem?.subCat || invItem?.subcategory || pattern?.sub || "";
          const tc = capBySub[String(sub || "").toLowerCase().trim()]; if (!tc) return;
          const elLabel = el.name || invItem?.name || pattern?.name || sub;
          if (String(tc.unit || "pc").toLowerCase().includes("sqft")) { const L = Number(el.L || el.l || 0), W = Number(el.W || el.w || el.H || el.h || 0); if (L > 0 && W > 0) addSub(sub, L * W * (Number(el.qty) || 1), zk, elLabel); }
          else addSub(sub, Number(el.qty) || 0, zk, elLabel);
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {}; const fd = cfg.floorDims || d;
        if (cfg.trT === "box") { const tSqft = (d.L || 0) * (d.W || 0) * Math.max(1, cfg.trussQty || 1); if (tSqft > 0) addSub("Truss", tSqft, zk, "Truss structure"); }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) { if (cfg.plH) addSub("Platform", sqft, zk, "Platform"); if (cfg.cpT && cfg.cpT !== CARPET_OFF) addSub("Carpet", sqft, zk, "Carpet"); }
      });
      let truckFrac = 0;
      Object.values(subAgg).forEach(s => { if (s.perTruck > 0) { truckFrac += (s.qty || 0) / s.perTruck; breakdown.push({ label: s.label, qty: Math.round(s.qty), perTruck: s.perTruck, unit: s.unit, trucks: (s.qty || 0) / s.perTruck, items: s.items }); } });
      const itemTrucks = Math.ceil(truckFrac);
      const floralTrucks = 0; // florals counted via their sub-category capacity — no separate flower truck
      const bt = bufferTiers.find(b => decorTotal >= b.minBudget && decorTotal < b.maxBudget);
      const bufTrucks = bt ? bt.bufferTrucks : 0;
      if (bufTrucks > 0) breakdown.push({ label: "Buffer", qty: 0, perTruck: 0, unit: "", trucks: bufTrucks, isBuffer: true, tierLabel: bt?.label || "" });
      const allTrucks = itemTrucks + floralTrucks + bufTrucks;
      const plan = resolveGensetPlan(match, fCustomGensets, fCustomGenset62, gensetRate, gensetRate62);
      const truckTotal = allTrucks * tripRate * 2;
      transportTotal = truckTotal + plan.gensetCost;
      transport = { trucks: allTrucks, tripRate, total: transportTotal, isNew, tier: tierId, tierLabel,
        breakdown, floralTrucks, bufferTrucks: bufTrucks, itemTrucks, totalFloralCost,
        gensets: plan.genset125, venueGensets: plan.venueGenset125, genset62: plan.genset62, venueGenset62: plan.venueGenset62,
        gensetCost: plan.gensetCost, gensetRate, gensetRate62, truckTotal };
    }
    return { zones, transport, decorTotal, transportTotal, grand: decorTotal + transportTotal };
  }, [getElPriceForFn, rcItems, trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62, zoneLabelsD, dcCustomItems, structRates, blocksByDate, imsInventory, dealCheckData, studioFloralData]);

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
  const saveTR = useCallback(async (nv, ntc, nfpt, nbt, ngr, ngr62) => {
    // Writes the legacy blob, so it persists the LOCAL list — never IMS's, which lives in its own key.
    const sv = nv || trVenues; const st = ntc || truckCap; const sf = nfpt !== undefined ? nfpt : floralPerTruck; const sb = nbt || bufferTiers; const sgr = ngr !== undefined ? ngr : gensetRate; const sgr62 = ngr62 !== undefined ? ngr62 : gensetRate62;
    if (nv) setTrVenues(nv); if (ntc) setTruckCap(ntc); if (nfpt !== undefined) setFloralPerTruck(nfpt); if (nbt) setBufferTiers(nbt); if (ngr !== undefined) setGensetRate(ngr); if (ngr62 !== undefined) setGensetRate62(ngr62);
    const local = { venues: sv, truckCap: st, floralPerTruck: sf, bufferTiers: sb, gensetRate: sgr, gensetRate62: sgr62 };
    await reliableSave(RC_SK_TR, JSON.stringify(local), "Transport");
  }, [trVenues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62]);

  // ── One-time backfill: fractional "gensets" → explicit genset125/genset62 ──
  // Pre-migration venues only ever had one fractional number (0.5 meaning "half a 125 KVA
  // genset", which isn't a real, rentable thing). resolveVenueGensets already reads the right
  // value for an un-migrated venue on the fly, so nothing is ever WRONG while this hasn't run —
  // but whichever tab loads the venue list first after this ships persists the migrated counts,
  // so the legacy field stops being re-derived from indefinitely. Runs once per mount; skips
  // straight past once every venue already carries the new fields.
  const gensetMigrationRef = useRef(false);
  useEffect(() => {
    if (gensetMigrationRef.current) return;
    // Wait for the real settings fetch — trVenues/truckCap read TR_DV/TR_DTC seed defaults until
    // then, and this effect firing on THAT seed state would persist the seed truckCap (mostly
    // zeros) over whatever was actually saved. This was a real bug that shipped and overwrote
    // truck-capacity data; do not remove this guard.
    if (!trSettingsLoadedRef.current) return;
    if (!Array.isArray(trVenues) || trVenues.length === 0) return;
    const needsMigration = trVenues.some((v) => v && typeof v.genset125 !== "number" && typeof v.genset62 !== "number");
    gensetMigrationRef.current = true;
    if (!needsMigration) return;
    const migrated = trVenues.map((v) => {
      if (!v || typeof v.genset125 === "number" || typeof v.genset62 === "number") return v;
      const g = resolveVenueGensets(v);
      return { ...v, genset125: g.genset125, genset62: g.genset62 };
    });
    saveTR(migrated);
  }, [trVenues, saveTR]);

  // ── Library photos for a zone ──
  // Async: fetches the zone-tagged candidate pool from the server (`tags->areasElements` overlap)
  // instead of scanning the whole in-memory library. Returns every photo tagged for this zone,
  // unranked — no video-taxonomy or palette-based scoring. Build shows the full zone-tagged set
  // and the user always picks manually; nothing is auto-preselected.
  // Deliberately function-agnostic. Group ordering used to happen in here, which meant the active
  // function was part of the cache key — so switching function re-queried the server for EVERY
  // zone and made the switch crawl. The zone-tagged pool doesn't depend on the function, so it is
  // fetched once and Build applies the group order to it client-side (see applyZoneGroupOrder).
  const getLibPhotosForZone = useCallback(async (zone, filterFn) => {
    // `zone` may be a single tag name or an array of synonym names (Build page).
    // filterFn (optional): a predicate applied to the zone matches — e.g. Build's explicit
    // "Filter whole build" photo filters (event type, palette, etc.), a user-initiated filter,
    // not automatic taxonomy scoring.
    const zoneList = (Array.isArray(zone) ? zone : [zone]).filter(Boolean);
    if (!zoneList.length) return [];
    // A true custom zone's "area name" (from areaNamesFor, StudioBuild.jsx) is a
    // CUSTOM_ZONE_TAG_PREFIX-marked id, not a real areasElements string — match tags.customZoneIds
    // by that exact id instead, so it can never collide with an unrelated deal's differently-
    // instantiated zone that happens to share the same display name. areaNamesFor never mixes a
    // marker with plain names in one call, so checking the first entry is enough.
    if (zoneList[0].startsWith(CUSTOM_ZONE_TAG_PREFIX)) {
      const zoneId = zoneList[0].slice(CUSTOM_ZONE_TAG_PREFIX.length);
      const candidates = await fetchCustomZoneLibraryPhotos(zoneId);
      mergeLibItems(candidates);
      return candidates.filter(li => (li.tags?.customZoneIds || []).includes(zoneId) && (!filterFn || filterFn(li)));
    }
    const zoneCandidates = await fetchZoneLibraryPhotos(zoneList);
    mergeLibItems(zoneCandidates);
    const tagged = zoneCandidates.filter(li => {
      const ae = li.tags?.areasElements || [];
      return zoneList.some(z => ae.includes(z)) && (!filterFn || filterFn(li));
    });
    return tagged;
  }, [mergeLibItems]);

  // A grouped photo need not carry the zone tag — putting one in a group is itself the statement
  // that it belongs there — so those rows won't come back from the zone query. Pull every group
  // member into the lazy library cache once, off the groups blob rather than per zone per switch,
  // so applyZoneGroupOrder can resolve them from libById with no request on the switch path.
  useEffect(() => {
    const ids = new Set();
    for (const byFn of Object.values(zoneGroups || {})) {
      for (const list of Object.values(byFn || {})) (list || []).forEach(id => ids.add(id));
    }
    if (ids.size) ensureLibItems([...ids]);
  }, [zoneGroups, ensureLibItems]);

  // ── All videos (youtube + manual), newest first — VERBATIM ──
  const allVideos = useMemo(() => {
    const yt = ytVideos.map(v => ({ ...v, source: "youtube", addedAt: v.addedAt || new Date(v.date || 0).getTime() }));
    const manual = manualVideos.map(v => ({ ...v, source: v.source || "cloudinary" }));
    const merged = [...yt, ...manual];
    merged.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return merged;
  }, [ytVideos, manualVideos]);

  // Lets saveYtTags name the video in the action log without taking allVideos as a dependency.
  useEffect(() => { allVideosRef.current = allVideos; }, [allVideos]);

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
  // Property (parent) names, and which of their sub-venues they group — lets a video/description
  // reference the PROPERTY (e.g. "Restro") rather than one of its specific rooms (e.g. "Banquet",
  // "Lawn"). A property with exactly one sub-venue is unambiguous (resolves straight to that room);
  // one with several is ambiguous, so the property name itself becomes the storable/filterable value.
  const subVenuesOfParent = useMemo(() => Object.fromEntries(allInhouseGroups.map(g => [g.parent, g.subVenues])), [allInhouseGroups]);
  const inhouseParentNames = useMemo(() => allInhouseGroups.map(g => g.parent), [allInhouseGroups]);
  // Every value a video's venue tag can legitimately hold for an INHOUSE property — individual
  // sub-venues (rooms) plus the ambiguous-property fallback names themselves.
  const allInhouseVenueOrParentNames = useMemo(() => [...new Set([...allInhouseVenues, ...inhouseParentNames])], [allInhouseVenues, inhouseParentNames]);
  // Sub-venues that are ONLY ever a leaf/room — excludes any name that's itself used as another
  // venue's `parent` (i.e. it groups its own rooms, so it functions as a property even though the
  // data model stores it as a flat venue entry too). Tagging/filter-chip UIs should offer only these
  // plus the property row, not both a property AND that same name again as a "sub-venue".
  const leafInhouseVenues = useMemo(() => allInhouseVenues.filter(v => !inhouseParentNames.includes(v)), [allInhouseVenues, inhouseParentNames]);

  // ═══ SUPABASE STORAGE PHOTO BROWSER (was Cloudinary) ═══
  // Same folder-tree UI, different backend: the `media` bucket, listed through the /upload Edge
  // Function. Storage can't be listed with the anon key — storage.objects has no public SELECT
  // policy, and adding one would make the whole bucket enumerable by anyone holding that key.
  //
  // The `cld*` state names and the public_id/secure_url aliases below are kept deliberately. The
  // browser UI in ManageLibrary reads those two fields on every tile, and every photo already in
  // the library was imported under them — renaming here would mean rewriting that UI and the
  // library's dedupe keys for no behavioural gain.
  const storageEntries = useCallback(async (path) => {
    const folders = [], files = [];
    for (let page = 0; page < 20; page++) {          // 20 × 500 = 10k objects, matching the old cap
      const data = await listStorage(path, { limit: 500, offset: page * 500 });
      folders.push(...(data.folders || []));
      files.push(...(data.files || []));
      if (!data.truncated) break;
    }
    return {
      folders,
      images: files
        .filter((f) => /^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f.name))
        .map((f) => ({ ...f, public_id: f.path, secure_url: f.url, display_name: f.name })),
    };
  }, []);

  // One request serves both panes — Storage returns folders and files from the same listing, so
  // splitting this into a folders call and an images call would just double the round trips.
  const fetchCldFolders = useCallback(async (path = "") => {
    setCldLoading(true);
    try {
      const { folders, images } = await storageEntries(path);
      setCldFolders(folders);
      setCldImages(path ? images : []);            // bucket root shows folders only, as before
    } catch (e) { showMsg("Storage fetch failed: " + e.message, "red"); }
    setCldLoading(false);
  }, [storageEntries]);

  const fetchCldImages = useCallback(async (prefix) => {
    if (!prefix) { setCldImages([]); return; }
    setCldLoading(true);
    try {
      setCldImages((await storageEntries(prefix)).images);
    } catch (e) { showMsg("Storage fetch failed: " + e.message, "red"); }
    setCldLoading(false);
  }, [storageEntries]);

  const cldNavigate = useCallback((folderName) => {
    const newPath = [...cldPath, folderName];
    setCldPath(newPath);
    fetchCldFolders(newPath.join("/"));
  }, [cldPath, fetchCldFolders]);

  const cldGoBack = useCallback((idx) => {
    const newPath = cldPath.slice(0, idx);
    setCldPath(newPath);
    fetchCldFolders(newPath.join("/"));
  }, [cldPath, fetchCldFolders]);

  // ═══ UPLOAD FROM THE LIBRARY BROWSER — via the /upload Edge Function ═══
  // Mirrors the Edge Function's key sanitiser. It has to match exactly: the dedupe pre-check lists
  // the folder the file will actually land in, and a path that differs by so much as a capital
  // would list an empty folder and wave every duplicate through.
  const sanitizeCloudinaryPath = (s) =>
    s.split("/").map(p => p.trim()).filter(Boolean).join("/")
      .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._/-]/g, "-")
      .replace(/-{2,}/g, "-").replace(/(^|\/)[-.]+|[-.]+(\/|$)/g, "$1");
  // Every existing filename in a folder, lowercased and stripped of its extension — the dedupe
  // pre-check. Named uploads key on the filename, so a match here means the file is already there.
  const fetchExistingNames = useCallback(async (folder) => {
    const names = new Set();
    try {
      const { images } = await storageEntries(folder);
      images.forEach(r => {
        const n = (r.name || "").replace(/\.[^.]+$/, "");
        if (n) names.add(n.toLowerCase());
      });
    } catch (e) { /* a folder that doesn't exist yet lists as empty; nothing to dedupe against */ }
    return names;
  }, [storageEntries]);
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
          const compressed = await compressImageForUpload(file);
          progress[idx].status = "uploading";
          setCldUploadProgress([...progress]);
          // keepName so the tile caption is the filename and a re-upload overwrites rather than
          // adding a second copy under a fresh random id.
          const res = await uploadToStorage(compressed, targetFolder, { keepName: file.name, detail: true });
          if (res.duplicate) {
            progress[idx] = { ...progress[idx], status: "skipped" };
            skippedCount++;
          } else {
            progress[idx] = { ...progress[idx], status: "done", url: res.url };
            doneCount++;
          }
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
    fetchCldFolders(baseFolder);      // one call now refreshes both folders and images
  }, [cldPath, cldUploading, fetchCldFolders, fetchExistingNames]);

  // ═══ BULK DELETE ═══
  const handleCldBulkDelete = useCallback(async () => {
    const ids = Array.from(cldSelected);
    if (!ids.length) return;
    if (!(await askConfirmAsync(`Delete ${ids.length} photo${ids.length > 1 ? "s" : ""}?`, {
      note: "Removed from Storage permanently. Library rows pointing at them will show as orphaned.",
      yesLabel: "Delete",
    }))) return;
    setCldDeleting(true);
    try {
      const deletedCount = await deleteStorageObjects(ids);
      setCldImages(prev => prev.filter(img => !cldSelected.has(img.public_id)));
      setCldSelected(new Set());
      setCldSelectMode(false);
      showMsg(`✓ ${deletedCount} photo${deletedCount !== 1 ? "s" : ""} deleted`, "green");
    } catch (e) { showMsg("Bulk delete failed: " + e.message, "red"); }
    setCldDeleting(false);
  }, [cldSelected]);

  // ═══ DELETE FOLDER ═══
  const handleCldDeleteFolder = useCallback(async (folderName) => {
    const fullPath = [...cldPath, folderName].join("/");
    if (!(await askConfirmAsync(`Delete the folder "${folderName}"?`, {
      note: `Everything inside ${fullPath} goes with it, permanently. This can't be undone.`,
      yesLabel: "Delete folder",
    }))) return;
    setCldDeleting(true);
    try {
      const n = await deleteStorageFolder(fullPath);
      setCldFolders(prev => prev.filter(f => (f.name || f.path) !== folderName));
      showMsg(`✓ Folder "${folderName}" deleted (${n} file${n !== 1 ? "s" : ""})`, "green");
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

  // Same contract and the same reasoning as saveYtTags above: callers pass a PATCH — `{id: true}` to
  // hide, `{id: null}` to unhide — never the whole hiddenVideos map.
  //
  // Passing the whole map was the more dangerous shape here than it was for tags, because it didn't
  // even need a failed request to lose data: `hiddenVideos` starts {} and is filled in by an async
  // load, so hiding one video before that load landed wrote a ONE-entry map and erased every other
  // hide. That same load window is what made the video count read 428 and then drop to 328.
  const saveHiddenVideos = useCallback(async (patch) => {
    const res = await kvTryGet(HIDDEN_VID_SK);
    if (!res.ok) {
      setSaveError({ label: "Hidden videos", error: `Couldn't read the current hidden list (${res.error}). Nothing was saved — no other video's hidden state was touched. Check your connection and try again.` });
      return { ok: false, error: res.error };
    }
    let fresh = {};
    if (res.value != null) {
      try {
        const p = typeof res.value === "string" ? JSON.parse(res.value) : res.value;
        if (!p || typeof p !== "object") throw new Error("stored value is not an object");
        fresh = p;
      } catch (e) {
        setSaveError({ label: "Hidden videos", error: `The saved hidden list could not be read (${e.message}). Nothing was saved, so nothing was overwritten. Please report this instead of retrying.` });
        return { ok: false, error: "unreadable" };
      }
    }
    const merged = { ...fresh };
    Object.entries(patch || {}).forEach(([id, val]) => { if (!val) delete merged[id]; else merged[id] = val; });
    setHiddenVideos(merged);
    const saved = await reliableSave(HIDDEN_VID_SK, JSON.stringify(merged), "Hidden videos");
    if (!saved?.ok) setSaveError({ label: "Hidden videos", error: saved?.error || "Save failed" });
    return { ok: !!saved?.ok, error: saved?.error || null };
  }, []);

  // Same read-merge-write contract as saveHiddenVideos, same reason — a video's favourite flag
  // toggled before the async load lands must not stomp anyone else's.
  //
  // Shape is { [videoId]: { [userId]: true } } — favouriting is PER SALESPERSON. Tarun and Krati
  // favouriting the same video are two independent flags, not one shared one; the one settings row
  // holds everyone's, so the merge here has to happen at the (videoId, userId) pair, not just the
  // videoId — merging at the videoId level alone would let one person's toggle silently overwrite
  // every other salesperson's flag on that same video. Callers pass `{ [videoId]: { [userId]: val } }`.
  const saveFavVideos = useCallback(async (patch) => {
    const res = await kvTryGet(FAV_VID_SK);
    if (!res.ok) {
      setSaveError({ label: "Favourite videos", error: `Couldn't read the current favourites (${res.error}). Nothing was saved. Check your connection and try again.` });
      return { ok: false, error: res.error };
    }
    let fresh = {};
    if (res.value != null) {
      try {
        const p = typeof res.value === "string" ? JSON.parse(res.value) : res.value;
        if (!p || typeof p !== "object") throw new Error("stored value is not an object");
        fresh = p;
      } catch (e) {
        setSaveError({ label: "Favourite videos", error: `The saved favourites could not be read (${e.message}). Nothing was saved, so nothing was overwritten. Please report this instead of retrying.` });
        return { ok: false, error: "unreadable" };
      }
    }
    const merged = { ...fresh };
    Object.entries(patch || {}).forEach(([videoId, userPatch]) => {
      const cur = { ...(merged[videoId] || {}) };
      Object.entries(userPatch || {}).forEach(([uid, val]) => { if (!val) delete cur[uid]; else cur[uid] = val; });
      if (Object.keys(cur).length) merged[videoId] = cur; else delete merged[videoId];
    });
    setFavVideos(merged);
    const saved = await reliableSave(FAV_VID_SK, JSON.stringify(merged), "Favourite videos");
    if (!saved?.ok) setSaveError({ label: "Favourite videos", error: saved?.error || "Save failed" });
    return { ok: !!saved?.ok, error: saved?.error || null };
  }, []);

  // Same shape, same per-(id, userId) merge, same reasoning as saveFavVideos above — one shared row,
  // one salesperson's toggle never touches another's flag on the same photo. `id` here is the
  // Library photo's own id (or its src for a non-library photo), never a (photo, zone) pair — see
  // FAV_PHOTO_SK's comment for why that's what makes a re-tagged photo keep its favourite.
  const saveFavPhotos = useCallback(async (patch) => {
    const res = await kvTryGet(FAV_PHOTO_SK);
    if (!res.ok) {
      setSaveError({ label: "Favourite photos", error: `Couldn't read the current favourites (${res.error}). Nothing was saved. Check your connection and try again.` });
      return { ok: false, error: res.error };
    }
    let fresh = {};
    if (res.value != null) {
      try {
        const p = typeof res.value === "string" ? JSON.parse(res.value) : res.value;
        if (!p || typeof p !== "object") throw new Error("stored value is not an object");
        fresh = p;
      } catch (e) {
        setSaveError({ label: "Favourite photos", error: `The saved favourites could not be read (${e.message}). Nothing was saved, so nothing was overwritten. Please report this instead of retrying.` });
        return { ok: false, error: "unreadable" };
      }
    }
    const merged = { ...fresh };
    Object.entries(patch || {}).forEach(([photoId, userPatch]) => {
      const cur = { ...(merged[photoId] || {}) };
      Object.entries(userPatch || {}).forEach(([uid, val]) => { if (!val) delete cur[uid]; else cur[uid] = val; });
      if (Object.keys(cur).length) merged[photoId] = cur; else delete merged[photoId];
    });
    setFavPhotos(merged);
    const saved = await reliableSave(FAV_PHOTO_SK, JSON.stringify(merged), "Favourite photos");
    if (!saved?.ok) setSaveError({ label: "Favourite photos", error: saved?.error || "Save failed" });
    return { ok: !!saved?.ok, error: saved?.error || null };
  }, []);

  // ═══ STORAGE VIDEO BROWSER (was Cloudinary) ═══
  // Same bucket and same folder tree as the photo browser — only the type filter differs.
  const storageVideos = useCallback(async (path) => {
    const folders = [], files = [];
    for (let page = 0; page < 10; page++) {
      const data = await listStorage(path, { limit: 500, offset: page * 500 });
      folders.push(...(data.folders || []));
      files.push(...(data.files || []));
      if (!data.truncated) break;
    }
    return {
      folders,
      videos: files
        .filter((f) => /^video\//.test(f.type || "") || /\.(mp4|webm|mov|m4v)$/i.test(f.name))
        .map((f) => ({ ...f, public_id: f.path, secure_url: f.url, display_name: f.name })),
    };
  }, []);

  const fetchCldVideoFolders = useCallback(async (path = "") => {
    setCldVideoLoading(true);
    try {
      const { folders, videos } = await storageVideos(path);
      setCldVideoFolders(folders);
      setCldVideoList(path ? videos : []);
    } catch (e) { showMsg("Storage fetch failed: " + e.message, "red"); }
    setCldVideoLoading(false);
  }, [storageVideos]);

  const fetchCldVideoList = useCallback(async (prefix) => {
    if (!prefix) { setCldVideoList([]); return; }
    setCldVideoLoading(true);
    try {
      setCldVideoList((await storageVideos(prefix)).videos);
    } catch (e) { showMsg("Storage fetch failed: " + e.message, "red"); }
    setCldVideoLoading(false);
  }, [storageVideos]);

  const openCldVideoBrowser = useCallback(() => {
    setAddVideoOpen(true); setCldVideoPath([]); setCldVideoFolders([]); setCldVideoList([]);
    fetchCldVideoFolders("");
  }, [fetchCldVideoFolders]);

  const cldVideoNavigate = useCallback((folderName) => {
    const newPath = [...cldVideoPath, folderName];
    setCldVideoPath(newPath);
    fetchCldVideoFolders(newPath.join("/"));
  }, [cldVideoPath, fetchCldVideoFolders]);

  const cldVideoGoBack = useCallback((idx) => {
    const newPath = cldVideoPath.slice(0, idx);
    setCldVideoPath(newPath);
    fetchCldVideoFolders(newPath.join("/"));
  }, [cldVideoPath, fetchCldVideoFolders]);

  const addCldVideo = useCallback((resource) => {
    const vidUrl = resource.secure_url;
    const vid = {
      id: "M" + Date.now().toString(36),
      title: (resource.public_id || "").split("/").pop().replace(/[-_]/g, " "),
      // No poster: Storage doesn't render video frames the way Cloudinary's so_0 transform did.
      // The cards fall back to the <video> element itself, which they already do for playback.
      thumb: "",
      videoUrl: vidUrl,
      duration: "",
      date: (resource.updatedAt || "").slice(0, 10),
      // Kept as "cloudinary": this string is the app's flag for "a file we host and play in a
      // <video> tag" as opposed to a YouTube embed, and every card, filter and delete button
      // branches on it. The 6 videos already stored under it would break if this changed.
      source: "cloudinary",
      addedAt: Date.now()
    };
    const existing = manualVideos.some(m => m.videoUrl === vidUrl);
    if (existing) { showMsg("Already added", "orange"); return; }
    saveManualVideos([vid, ...manualVideos]);
  }, [manualVideos, saveManualVideos]);

  // ═══ TAG VIDEO FROM DESCRIPTION — /api/youtube → ytApi, then plain-JS taxonomy matching ═══
  // Ambria's video descriptions carry explicit labeled lines ("Venue: ...", "Package Category:
  // ..."), so extracting tags is deterministic parsing, not AI inference — no Claude call, no
  // cost/latency, no ambiguity. A label with no match in its taxonomy list (or missing from the
  // description) is simply left untagged; there is no AI fallback.
  // Core: fetch a video's details and tag it from its description. Returns the tag object
  // (with _aiTagged) or null. Used by single + bulk taggers. Per-zone photos are no longer
  // pinned per-video — Build shows every zone-tagged library photo live instead (see
  // getLibPhotosForZone / StudioBuild.jsx's getMatchedPhotos).
  const buildVideoTagFromAI = useCallback(async (videoId) => {
      const ytData = await ytApi("videos", { part: "snippet", id: videoId }).catch(() => ({}));
      const snippet = ytData.items?.[0]?.snippet;
      if (!snippet) return null;
      const desc = snippet.description || "";
      const existingTag = ytVideoTags[videoId] || {};

      const colorList = paletteNames(imsPaletteCatalogue, taxonomy.colorPalette);
      const venueRaw = extractLabeledValue(desc, "Venue");
      // Resolve the venue in priority order: (1) a specific sub-venue/room name — matches against
      // every venue actually configured in Studio Settings → Venues (customInhouse), not the
      // parent-filtered allInhouseVenues, which silently drops any venue whose "Parent property"
      // hasn't been set yet; (2) an outside venue; (3) a PROPERTY name (e.g. "Restro" instead of
      // one of its rooms "Banquet"/"Lawn") — resolves straight to that room if the property has
      // only one, otherwise the property name itself is stored (ambiguous — which room isn't
      // knowable from text alone). bestTaxMatch's substring containment already handles a name
      // being written with a property prefix (e.g. "Ambria Valencia" vs. the bare "Valencia").
      const subVenueNames = [...new Set(customInhouse.map(v => v.name).filter(Boolean))];
      let matchedVenue = bestTaxMatch(venueRaw, subVenueNames) || bestTaxMatch(venueRaw, customOutdoor.map(o => o.name).filter(Boolean));
      if (!matchedVenue && venueRaw) {
        const matchedParent = bestTaxMatch(venueRaw, inhouseParentNames);
        if (matchedParent) {
          const subs = subVenuesOfParent[matchedParent] || [];
          matchedVenue = subs.length === 1 ? subs[0] : matchedParent;
        }
      }
      const matchedFn = bestTaxMatch(extractLabeledValue(desc, "Event Type"), taxOr(taxonomy.eventType, FUNCTIONS));
      const matchedIo = bestTaxMatch(extractLabeledValue(desc, "Setup Type"), taxOr(taxonomy.venueType, ["Indoor", "Outdoor", "Semi-Outdoor"]));
      const matchedColor = bestTaxMatch(extractLabeledValue(desc, "Color Palette"), colorList);
      const matchedTier = bestTaxMatch(extractLabeledValue(desc, "Package Category"), taxOr(taxonomy.tier, CATEGORIES));
      const matchedStyle = bestTaxMatch(extractLabeledValue(desc, "Design Style"), taxonomy.designStyle || []);

      const newTag = {
        ...existingTag,
        // A venue mentioned in the description that doesn't match any known inhouse/outside venue
        // is filed under the generic "Other" bucket (Outside → Other in the venue picker) rather
        // than stored as raw scraped text — keeps the venue field a closed set the ops team can
        // filter/fix from, instead of accumulating one-off freeform names.
        venue: matchedVenue || (venueRaw ? "Other" : existingTag.venue || ""),
        venueCustom: matchedVenue ? undefined : (venueRaw ? true : existingTag.venueCustom),
        fn: matchedFn ? [matchedFn] : existingTag.fn,
        tier: matchedTier || existingTag.tier,
        io: matchedIo || existingTag.io,
        colors: matchedColor ? [matchedColor] : (existingTag.colors || []),
        styles: matchedStyle ? [matchedStyle] : (existingTag.styles || []),
        palette: matchedColor || existingTag.palette || "",
      };
      newTag._aiTagged = true;
      return newTag;
  }, [ytVideoTags, customInhouse, customOutdoor, taxonomy, imsPaletteCatalogue, inhouseParentNames, subVenuesOfParent]);

  const aiTagVideo = useCallback(async (videoId) => {
    if (aiTaggingVideo) return;
    setAiTaggingVideo(videoId);
    showMsg("📋 Parsing description...", "blue");
    try {
      const newTag = await buildVideoTagFromAI(videoId);
      if (!newTag) { showMsg("Couldn't fetch video details", "red"); setAiTaggingVideo(null); return; }
      setAiVideoDraft({ videoId, tags: newTag });
      setYtTagEdit(videoId);
      showMsg("✓ Tagged from description — review & save", "green");
    } catch (e) { showMsg("Tagging failed: " + e.message, "red"); }
    setAiTaggingVideo(null);
  }, [aiTaggingVideo, buildVideoTagFromAI]);

  // Direct-save variant for the full-screen editor: tag a single video from its description and
  // save immediately (no draft step), so the big editor just shows the filled tags to review/adjust.
  const aiTagVideoSave = useCallback(async (videoId) => {
    if (aiTaggingVideo) return;
    setAiTaggingVideo(videoId);
    showMsg("📋 Parsing description...", "blue");
    try {
      const newTag = await buildVideoTagFromAI(videoId);
      if (!newTag) { showMsg("Couldn't fetch video details", "red"); setAiTaggingVideo(null); return; }
      await saveYtTags({ [videoId]: { ...newTag, _savedBy: authUser?.name || "Auto", _savedAt: Date.now() } });
      showMsg("✓ Tagged from description — review & adjust below", "green");
    } catch (e) { showMsg("Tagging failed: " + e.message, "red"); }
    setAiTaggingVideo(null);
  }, [aiTaggingVideo, buildVideoTagFromAI, saveYtTags, authUser]);

  // Bulk-tag every untagged video from its description (app-wide, like photo bulk). Saves
  // directly with _aiTagged so the team reviews/verifies after — keeps going while you move
  // around; stoppable; resumable.
  const stopBulkTagVideos = useCallback(() => { bulkVidStop.current = true; }, []);
  const runBulkTagVideos = useCallback(async () => {
    const targets = allVideos.filter(v => !hiddenVideos[v.id] && !ytVideoTags[v.id]);
    if (!targets.length) { showMsg("No untagged videos — every video is already tagged.", "green"); return null; }
    bulkVidStop.current = false;
    setBulkVid({ running: true, done: 0, total: targets.length, ok: 0, fail: 0, finishedAt: 0 });
    // patch holds only the videos THIS run has newly tagged since the last flush — saveYtTags
    // merges it onto whatever's live in the DB at flush time, so a long-running bulk pass can never
    // clobber a verify/edit someone else makes on a different video while this is still going.
    let patch = {};
    let ok = 0, fail = 0;
    for (let n = 0; n < targets.length; n++) {
      if (bulkVidStop.current) break;
      try {
        const tag = await Promise.race([buildVideoTagFromAI(targets[n].id), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30000))]);
        if (tag) { patch = { ...patch, [targets[n].id]: { ...tag, _savedBy: "Auto (bulk)", _savedAt: Date.now() } }; ok++; }
        else fail++;
      } catch { fail++; }
      if ((n + 1) % 4 === 0) { await saveYtTags(patch); patch = {}; }
      setBulkVid({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
    }
    await saveYtTags(patch);
    const stopped = bulkVidStop.current;
    setBulkVid({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🎬 Video tagging ${stopped ? "stopped" : "complete"} — ${ok} tagged, ${fail} failed. Review them in Library → Videos → Needs review.`, "green");
    return { ok, fail };
  }, [allVideos, hiddenVideos, ytVideoTags, buildVideoTagFromAI, saveYtTags]);

  // Venue-only backfill: unlike runBulkTagVideos (which only touches completely untagged videos
  // and merges every field), this targets every video that has NO venue yet — including videos
  // already tagged/verified for fn/tier/styles/etc. before venue-from-description existed — and
  // writes ONLY {venue, venueCustom} onto its existing tag, leaving every other field untouched.
  // A video that already has a venue (a real match OR the "Other" bucket) is left alone, so a
  // manual correction made after an earlier pass is never clobbered by re-running this.
  const stopBulkTagVideoVenues = useCallback(() => { bulkVidVenueStop.current = true; }, []);
  const runBulkTagVideoVenues = useCallback(async () => {
    const targets = allVideos.filter(v => !hiddenVideos[v.id] && !ytVideoTags[v.id]?.venue);
    if (!targets.length) { showMsg("Every video already has a venue tag.", "green"); return null; }
    bulkVidVenueStop.current = false;
    setBulkVidVenue({ running: true, done: 0, total: targets.length, ok: 0, skip: 0, fail: 0, finishedAt: 0 });
    // Same patch-only-what-changed approach as runBulkTagVideos above — prev falls back to this
    // tab's local ytVideoTags only to preserve THAT video's own other fields, never anyone else's.
    let patch = {};
    let ok = 0, skip = 0, fail = 0;
    for (let n = 0; n < targets.length; n++) {
      if (bulkVidVenueStop.current) break;
      try {
        const newTag = await Promise.race([buildVideoTagFromAI(targets[n].id), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30000))]);
        const prev = patch[targets[n].id] || ytVideoTags[targets[n].id] || {};
        if (newTag?.venue) {
          patch = { ...patch, [targets[n].id]: { ...prev, venue: newTag.venue, venueCustom: newTag.venueCustom, _lastEditedBy: "Auto (venue backfill)", _lastEditedAt: Date.now() } };
          ok++;
        } else skip++;
      } catch { fail++; }
      if ((n + 1) % 4 === 0) { await saveYtTags(patch); patch = {}; }
      setBulkVidVenue({ running: true, done: n + 1, total: targets.length, ok, skip, fail, finishedAt: 0 });
    }
    await saveYtTags(patch);
    const stopped = bulkVidVenueStop.current;
    setBulkVidVenue({ running: false, done: targets.length, total: targets.length, ok, skip, fail, finishedAt: Date.now() });
    showMsg(`🗺 Venue backfill ${stopped ? "stopped" : "complete"} — ${ok} tagged (unmatched filed under "Other"), ${skip} had no venue mentioned in their description, ${fail} failed.`, "green");
    return { ok, skip, fail };
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

  // Hydrate videos straight from their ids, bypassing the playlist entirely.
  // The playlist is a single point of failure and it has already failed once: it reports
  // totalResults 490 while returning zero accessible items, with no error — at which point every
  // video vanished from Manage and every Browse card fell back to "Untitled video", because titles
  // are read from this list while the CARDS come from our own tags. The tagged ids are the durable
  // record, so anything tagged is fetched by id and unioned with whatever the playlist gives.
  const fetchYTByIds = useCallback(async (ids) => {
    const out = [];
    const list = [...new Set((ids || []).filter(Boolean))];
    for (let i = 0; i < list.length; i += 50) {          // the videos endpoint caps at 50 ids
      const d = await ytApi("videos", { part: "snippet,contentDetails", id: list.slice(i, i + 50).join(",") }).catch(() => ({}));
      (d.items || []).forEach((v) => {
        out.push({
          id: v.id,
          title: v.snippet?.title || "",
          thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
          date: v.snippet?.publishedAt?.slice(0, 10) || "",
          duration: ytDuration(v.contentDetails?.duration),
          playlistId: "tagged",
          embedUrl: `https://www.youtube.com/embed/${v.id}?rel=0&modestbranding=1`,
        });
      });
    }
    return out;
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
      // Union in every video we've tagged that the playlist didn't return — a video dropped from
      // the playlist, or a playlist that has stopped serving items altogether, must not take the
      // whole catalogue down with it.
      try {
        const tagged = Object.keys(ytVideoTagsRef.current || {}).filter((id) => id && !seen.has(id));
        if (tagged.length) {
          const extra = await fetchYTByIds(tagged);
          extra.forEach((v) => { if (!seen.has(v.id)) { seen.add(v.id); vids.push(v); } });
        }
      } catch { /* the playlist's own results still stand */ }
      setYtVideos(vids); setYtLastFetch(Date.now());
      try { await reliableSave(YT_SK, JSON.stringify({ videos: vids, playlists: ytPlaylists, ts: Date.now() }), "YT cache"); } catch { /* ignore */ }
    } catch { showMsg("YouTube fetch failed", "red"); }
    setYtLoading(false);
  }, [ytPlaylists, ytVideos, ytLastFetch, fetchYTPlaylist, fetchYTByIds, showMsg]);

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
    // Event Info's "Gensets needed" field for a brand-new venue only ever sets a 125 KVA count
    // (there's no 62 KVA field here — this is a rough estimate the admin refines properly in
    // Transport & Power afterward) — genset125 directly, genset62 starts at 0, not the old
    // fractional "gensets" scalar.
    const genset125 = customGensets;
    if (!name || rate <= 0 || genset125 === null || genset125 === undefined || genset125 < 0) return;
    const lcName = name.toLowerCase();
    const inInhouse = allInhouseVenues.some(v => v.toLowerCase() === lcName);
    const inOutside = customOutdoor.some(o => (o.name || "").toLowerCase() === lcName);
    const inAnyTR = trVenues.some(v => (v.name || "").toLowerCase() === lcName);
    if (inInhouse || inOutside || inAnyTR) return;
    const existingTR = trVenues.find(v => (v.name || "").toLowerCase() === lcName);
    let newTR;
    if (existingTR) {
      newTR = trVenues.map(v => v.id === existingTR.id ? { ...v, rate, genset125, genset62: 0, name } : v);
    } else {
      const id = "V" + Date.now().toString(36).slice(-5).toUpperCase();
      newTR = [...trVenues, { id, tier: "other", name, rate, genset125, genset62: 0 }];
    }
    const existingOut = customOutdoor.find(o => (o.name || "").toLowerCase() === lcName);
    const newOut = existingOut ? customOutdoor : [...customOutdoor, { name, empanelled: false }];
    saveTR(newTR, null);
    if (newOut !== customOutdoor) saveVenues(customInhouse, newOut);
    showMsg(`✓ Saved ${name} (₹${rate}/trip, ${genset125} × 125 KVA genset)`, "green");
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

  // ── Browse videos base list: mapped + hidden-videos dropped + permission scope applied ──
  // Factored out so a search can read it directly (browseVideosAll below) instead of the fully
  // filtered browseVideos — permission scope is the one boundary a search still has to respect,
  // but nothing past it (venue/tier/style/palette/function) should narrow a search's results.
  const browseVideosBase = useMemo(() => {
    // Hiding a video in Manage → Library promises it "won't show in the app", but Browse was built
    // straight off ytVideoTags and never consulted hiddenVideos — so hidden references still filled
    // the grid and were counted in the "N videos" headline. Drop them at the source, before any
    // filtering or counting, so every downstream number agrees.
    const list = Object.entries(ytVideoTags).filter(([vidId]) => !hiddenVideos[vidId]).map(([vidId, tag]) => {
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
    // allInhouseVenueOrParentNames also covers a video stored at the ambiguous PROPERTY level
    // (e.g. "Restro" itself, when a description named the property but not one of its rooms) —
    // plain allInhouseVenues (rooms only) would otherwise misfile such a video as "outside".
    // A video with NO venue tag belongs to neither group — 191 of 428 are in that state, which is
    // why a group pill hides so much.
    const groupOf = (v) => (!v.venue ? "none" : allInhouseVenueOrParentNames.includes(v.venue) ? "inhouse" : "outside");
    // ── Permission scope: the ONLY hard boundary here ──────────────────────────────────────────
    // A user restricted to inhouse must never be shown outside venues, whatever they click. This
    // used to be conflated with the venueGroup pill, which meant the pill could not be relaxed
    // without also breaking the restriction.
    const scope = isAdmin ? "all" : (userVenueScope || "all");
    return (scope === "inhouse" || scope === "outside") ? list.filter(v => groupOf(v) === scope) : list;
  }, [ytVideoTags, hiddenVideos, allVideos, calcFullEventCost, allInhouseVenueOrParentNames, isAdmin, userVenueScope]);

  // Same favourite-first ordering browseVideos applies, with none of the optional filters — the
  // list a search reads from (see Browse's shownVideos), so favourites still lead but nothing else
  // narrows it.
  const browseVideosAll = useMemo(() => {
    const isMyFav = (v) => !!favVideos[v.id]?.[authUser?.id];
    const favs = [], rest = [];
    for (const v of browseVideosBase) (isMyFav(v) ? favs : rest).push(v);
    return favs.length ? [...favs, ...rest] : browseVideosBase;
  }, [browseVideosBase, favVideos, authUser]);

  // ── Browse videos (tagged-video inspiration catalog) — VERBATIM ──
  const browseVideos = useMemo(() => {
    let out = browseVideosBase;
    const groupOf = (v) => (!v.venue ? "none" : allInhouseVenueOrParentNames.includes(v.venue) ? "inhouse" : "outside");
    // ── The Inhouse/Outside pill: a filter only until you pick a venue ─────────────────────────
    // Once a specific venue is chosen, the venue IS the preference and the pill was merely how you
    // navigated to it — so the references BELOW that venue's own videos should be every other
    // reference available, not just ones from the same group. Picking Aura used to cap the page at
    // the 130 inhouse videos and hide the other ~300. With no venue chosen the pill still filters,
    // so browsing "just show me Outside" behaves as before.
    if (browseVenues.length === 0) {
      if (venueGroup === "inhouse") out = out.filter(v => groupOf(v) === "inhouse");
      else if (venueGroup === "outside") {
        out = out.filter(v => groupOf(v) === "outside");
        if (outsideSub === "empanelled") out = out.filter(v => allOutdoorDB.find(x => x.name === v.venue && x.empanelled));
        else if (outsideSub === "other") out = out.filter(v => !allOutdoorDB.find(x => x.name === v.venue && x.empanelled));
      }
    }
    // Venue is a PREFERENCE, not a filter. Too little is tagged per venue for an exact match to
    // leave a salesperson enough to show a client, so picking a venue no longer hides everything
    // else — its own videos are floated to the top and the rest follow. `venueGroup` above stays a
    // real filter: it is seeded from userVenueScope, so it is a permission boundary, not a taste.
    //
    // Selecting a PROPERTY chip (e.g. "Restro") also counts videos tagged at any of its own rooms
    // ("Banquet"/"Lawn"). Selecting a specific room does NOT reach back up to ambiguous
    // property-level tags, since those don't confirm which room the video is.
    let preferredVenues = null;
    if (browseVenues.length > 0) {
      preferredVenues = new Set(browseVenues);
      browseVenues.forEach(bv => { (subVenuesOfParent[bv] || []).forEach(sv => preferredVenues.add(sv)); });
    }
    // ── FAVOURITES OBEY EVERY FILTER ──
    // Tier, venue type, design style and palette used to carry an `isMyFav(v) ||` escape hatch, so
    // a favourited video survived those filters whatever it was tagged. The intent was convenience —
    // pin something and never have to clear filters to find it again. In practice it meant a video
    // favourited for a Wedding kept leading the results while the salesperson was filtering for a
    // Cocktail, in front of a client, and there was no filter combination that would put it away.
    // A pin that cannot be filtered is not a pin, it is a leak.
    // Favouriting still does what it is for: it RANKS. See favFirst below — a favourite leads
    // whatever survives the filters, it just no longer smuggles itself past them.
    // Favouriting is per salesperson (see saveFavVideos) — Tarun's picks for a venue are independent
    // of Krati's, so the check is against MY OWN flag on the video, never anyone else's.
    const isMyFav = (v) => !!favVideos[v.id]?.[authUser?.id];
    if (filterFn.length > 0) out = out.filter(v => v.fns.some(f => filterFn.includes(f)));
    if (filterCat.length > 0) out = out.filter(v => v.tierCat && filterCat.includes(v.tierCat));
    if (filterSpace.length > 0) out = out.filter(v => v.space && filterSpace.includes(v.space));
    if (filterMood.length > 0) out = out.filter(v => v.styles.some(s => filterMood.includes(s)));
    // Whitespace/case-insensitive: the pill says "Brown" (trimmed by paletteNames) while the video
    // may be tagged "Brown " — an exact includes() matched neither half of the library reliably.
    if (filterPalette.length > 0) out = out.filter(v => (v.colors || []).some(c => paletteInList(filterPalette, c)));
    // Favourited videos lead whichever group they land in (below) rather than jumping across group
    // boundaries — a favourite tagged to a DIFFERENT venue must not outrank the venue you actually
    // selected, it just leads once it's already in the right bucket.
    const favFirst = (arr) => {
      const favs = [], rest = [];
      for (const v of arr) (isMyFav(v) ? favs : rest).push(v);
      return favs.length ? [...favs, ...rest] : arr;
    };
    // Applied last, so the chosen venue floats to the top of whatever the other filters left. A
    // stable partition, not a sort — order within each group is untouched. `_venueMatch` lets
    // Browse draw the divider; without one this reads as the venue filter having stopped working.
    //
    // Three tiers, because the pill above no longer filters once a venue is picked: the venue's own
    // videos, then the rest of the group you were browsing, then everything else. Without the middle
    // tier the references after Aura would be inhouse and outside shuffled together, which is worse
    // than what it replaced even though it shows more.
    if (preferredVenues) {
      const atVenue = [], sameGroup = [], rest = [];
      for (const v of out) {
        const match = preferredVenues.has(v.venue);
        const rec = { ...v, _venueMatch: match };
        if (match) atVenue.push(rec);
        else if (venueGroup !== "all" && groupOf(v) === venueGroup) sameGroup.push(rec);
        else rest.push(rec);
      }
      out = [...favFirst(atVenue), ...favFirst(sameGroup), ...favFirst(rest)];
    } else {
      out = favFirst(out);
    }
    return out;
  }, [browseVideosBase, favVideos, authUser, venueGroup, outsideSub, browseVenues, filterFn, filterCat, filterSpace, filterMood, filterPalette, allInhouseVenueOrParentNames, allOutdoorDB, subVenuesOfParent]);

  // ── Active client + meeting number ──
  const activeClient = useMemo(() => clientLedger.find(c => c.id === activeClientId), [clientLedger, activeClientId]);
  // Pinned at the session count this client had when the CURRENT visit began, captured once per
  // activeClientId change — not recomputed live off activeClient.sessions.length. Now that each visit
  // gets its own preserved session entry (see sessionBoundaryRef), that count grows mid-visit as soon
  // as this build's own first autosave lands; without pinning, the label would tick from "Meeting #2"
  // to "Meeting #3" partway through the second meeting instead of staying put until the next Load.
  const [meetingBaseline, setMeetingBaseline] = useState(0);
  useEffect(() => {
    setMeetingBaseline(activeClient?.sessions?.length || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);
  const meetingNumber = meetingBaseline + 1;

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
    if (vidId) {
      const vTag = ytVideoTags[vidId] || {};
      const vid = allVideos.find(v => v.id === vidId);
      setSourceVideo({ id: vidId, title: vid?.title || ev.name, tags: vTag });
      // Seed the "Filter whole build" panel from this reference video's own taxonomy (event type/
      // venue type/style/palette/day-night/venue) — customizing off a video starts the zone photo
      // strips narrowed to photos matching it, instead of showing the whole library; the
      // salesperson can still widen/clear the filter from here. Video tags use fn/io/styles/colors
      // (vs a library photo's own eventType/venueType/designStyle/colorPalette) — same taxonomy
      // strings, different key names. Zone photos themselves are still never pinned/auto-picked —
      // every zone starts empty and the salesperson picks manually from the (now filtered) set.
      const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []));
      setZpFilters({
        eventType: arr(vTag.fn), venueType: arr(vTag.io), designStyle: arr(vTag.styles),
        colorPalette: arr(vTag.colors), timeSetting: arr(vTag.timeSetting), venue: arr(vTag.venue),
      });
      // Default the Build palette to the one tagged on the video (salesperson can still change it).
      const vidPalette = vTag.palette || (Array.isArray(vTag.colors) ? vTag.colors[0] : "") || "";
      if (vidPalette) {
        if (activeFnIdx === 0) setClientPalette(vidPalette);
        else setExtraFunctions(prev => prev.map((f, i) => i === activeFnIdx - 1 ? { ...f, palette: vidPalette } : f));
      }
    }
    loadEvent(ev, targetStep);
  }, [loadEvent, ytVideoTags, allVideos, activeFnIdx, setClientPalette, setExtraFunctions]);

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
      // No zones pre-enabled — the salesperson turns on whichever zones this deal needs and
      // picks each zone's photo manually from the Library (no per-video zone pinning anymore).
      enabledEls: [],
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
    // Refs, not the closure: the periodic/visibility autosaves fire from timers, which can land
    // between a function switch's setState and the re-render that would refresh this callback.
    // Taking the index from one render and the builds from another files a snapshot under the
    // wrong function — the same class of bug switchActiveFn had.
    const liveIdx = activeFnIdxRef.current;
    const liveBuilds = fnBuildsRef.current;
    // The most recent save of THIS deal, read the same way the write below reads it. Only needed so
    // each function's own price can be carried forward — see fnTotals in the snapshot.
    const prevSnapForTotals = (((clientLedgerRef.current || clientLedger)
      .find(c => c.id === activeClientId)?.sessions) || [])[0] || null;
    const takeSnapshot = snapshotFnRef.current || snapshotBuildState;
    for (let i = 0; i < totalFns; i++) {
      let snap;
      if (i === liveIdx) {
        snap = takeSnapshot();
      } else {
        snap = liveBuilds[i] || null;
      }
      if (snap) {
        if (snap.elSelectedPhoto) {
          snap = {
            ...snap,
            // isLibrary/eventId ride along (not just src/eventName) — Build's "Correct & update
            // master" button needs both to know this photo has a real Library row behind it;
            // dropping them here silently disabled that button for any zone reloaded from a saved
            // session even though the photo genuinely is a Library photo.
            elSelectedPhoto: Object.fromEntries(Object.entries(snap.elSelectedPhoto).map(([ek, v]) => [ek, { src: v?.src, eventName: v?.eventName, isLibrary: v?.isLibrary, eventId: v?.eventId }]))
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
      elSelectedPhoto: Object.fromEntries(Object.entries(elSelectedPhoto).map(([k, v]) => [k, { src: v?.src, eventName: v?.eventName, isLibrary: v?.isLibrary, eventId: v?.eventId }])),
      sourceEventId: sourceEvent?.id || null,
      sourceEventName: sourceEvent?.name || null,
      sourceVideoId: sourceVideo?.id || null,
      sourceVideoTitle: sourceVideo?.title || null,
      selectedMoods: [...selectedMoods],
      selectedPalettes: [...selectedPalettes],
      floralRatio,
      fnSnapshots,
      savedActiveFnIdx: liveIdx,
      // ── ONE PRICE PER FUNCTION, NOT ONE PER SESSION ──
      // `total` above is whichever function happened to be active when this save fired, so a deal
      // with three functions still only ever carried one figure. Browse could not tell whose it
      // was, so it either printed another function's price under this one's build, or — once
      // savedActiveFnIdx let it tell — printed nothing at all, which is what left cards blank.
      // Neither is the fix. The fix is to keep the number next to the build it belongs to.
      // Only the live function can be priced here: grandTotal is computed from the state that is
      // actually loaded, and the other functions are stored builds with no pricing run against
      // them. So each save records its own function and carries the rest forward from the previous
      // save of this deal — visit a function once and its price stays with it from then on.
      // Carried entries are dropped when their build is gone, so a deleted function leaves no
      // orphan figure. And a zero is never written over a real one: a save landing on a function
      // that is empty or still settling would otherwise wipe a good price, which is the same ₹0
      // that has been turning up on these cards. Nothing here is compared for "did the build
      // change" purposes either — an unchanged build gives the same grandTotal, so this object is
      // byte-identical and the load-echo check still sees a no-op.
      fnTotals: (() => {
        const prev = (prevSnapForTotals && typeof prevSnapForTotals.fnTotals === "object" && prevSnapForTotals.fnTotals) || {};
        const next = {};
        for (let i = 0; i < totalFns; i++) {
          // Only onto a function that HAS a build. This carried a price forward on the strength of a
          // snapshot merely existing, and a snapshot exists for every function once a video is picked
          // — so an untouched, ₹0 function inherited whatever the last save had measured elsewhere.
          if (!fnSnapshots[i] || !fnSnapHasBuild(fnSnapshots[i])) continue;
          const carried = prev[i] || prev[String(i)];
          if (carried && typeof carried.total === "number" && carried.total > 0) next[i] = carried;
        }
        if (grandTotal > 0 && fnSnapHasBuild(fnSnapshots[liveIdx])) {
          next[liveIdx] = { total: grandTotal, tier: getCat(grandTotal).label };
        }
        return next;
      })(),
      customItems: dcCustomItems,
      auto: !!opts.auto,   // background auto-draft (rolling, updated in place) vs a manual Save Draft
    };
    // Read the ref, not the `clientLedger` closure: the debounced-edit, 15s-periodic and
    // tab-hide auto-save triggers can fire back-to-back before React re-renders (each timer
    // callback runs synchronously, but the closure sync effect that refreshes `saveSession`
    // only runs on the NEXT commit) — two saves racing on the same stale, pre-write ledger
    // both saw an empty `sessions` and both prepended their own "first" entry, leaving a
    // permanent duplicate (collapse-in-place only ever touches slot 0, never cleans up a
    // stray slot 1). clientLedgerRef is written synchronously inside saveClientLedger, ahead
    // of the state update, so every save — even one racing right behind another — sees it.
    let updated = [...(clientLedgerRef.current || clientLedger)];
    let client = updated.find(c => c.id === activeClientId);
    // Captured BEFORE the mint/byPhone fallback below can reassign `client` — true only when this
    // save is continuing a deal that was ALREADY active a moment ago (as opposed to just now
    // attaching to/minting a client), which is the one case worth protecting from an unconfirmed
    // name/phone edit (see pendingUnconfirmedIdentity below).
    const wasActiveClient = !!client;
    if (!client) {
      // Before minting a fresh client, check whether one with this exact phone number already
      // exists — same digit-stripped match loadLmsLead already uses to avoid re-creating a
      // client it's seen before. Without this, typing a client's details by hand (e.g. copied
      // straight off an LMS lead) instead of clicking the suggested "Load →" card meant
      // activeClientId was never set, so the very first autosave silently forked a second,
      // orphaned client record for the same real person/phone instead of continuing their history.
      // A client already marked "booked" is a closed, past deal — don't silently reattach a new
      // one to it (see loadLmsLead's matching `existing.status !== "booked"` guard, same reason).
      // And if MORE THAN ONE open client already shares this phone (a stray duplicate that
      // predates this guard), don't guess which one is "right" — that's exactly how one client's
      // name got silently overwritten by another's typed text. Only auto-attach when the phone
      // resolves to exactly one unambiguous candidate.
      const phoneKey = clientPhone.trim().replace(/\D/g, "");
      const phoneCandidates = phoneKey.length >= 10 ? updated.filter(c => (c.phone || "").replace(/\D/g, "") === phoneKey && c.status !== "booked") : [];
      const byPhone = phoneCandidates.length === 1 ? phoneCandidates[0] : null;
      if (byPhone) {
        client = byPhone;
        setActiveClientId(byPhone.id);
      } else {
        client = { id: "CLI_" + Date.now().toString(36), name: clientName.trim(), phone: clientPhone.trim(), sessions: [], createdAt: Date.now(), status: "ongoing", createdBy: authUser?.name || "—", bookedAt: null, bookedBy: null, finalSession: null };
        updated.push(client);
      }
      // This save is what's establishing/attaching this client for the first time this session —
      // whatever's currently typed IS the deliberate identity (there's no prior loaded value to
      // protect yet). Record it now so THIS deal is protected against unconfirmed drift from here on.
      loadedClientIdentityRef.current = { name: clientName.trim(), phone: clientPhone.trim() };
    }
    // Typing something different into Guest Name/Phone for a deal that was ALREADY active does
    // NOT count as a deliberate rename until confirmClientRename says so (see the inline
    // confirm/revert prompt on Event Info) — otherwise glancing back at this screen mid-deal and
    // typing anything, even just to look something up, got captured by the very next autosave and
    // silently overwrote the client's real name/phone with whatever partial text was in the box.
    // Every other field on `client` still updates normally below — only identity is held back.
    const pendingUnconfirmedIdentity = wasActiveClient && loadedClientIdentityRef.current.name
      && (clientName.trim() !== loadedClientIdentityRef.current.name || clientPhone.trim() !== loadedClientIdentityRef.current.phone);
    if (!pendingUnconfirmedIdentity) {
      client.name = clientName.trim();
      client.phone = clientPhone.trim();
    }
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

    // …but replacing in place means an EMPTY auto-save destroys the draft it lands on. The autosave
    // fires every 15s and its guard is satisfied by activeClientId alone, so a committed deal keeps
    // saving while the build is empty — sitting on Browse, or on a function pill nothing has been
    // built for yet. Browse then drops the row (it lists only sessions whose snapshot has data) and
    // the card the salesperson was about to click disappears, returning when they next touch the
    // build. That is the flicker: the work was never lost, the newest draft was simply blank.
    //
    // A manual Save Draft is never blocked — it prepends rather than replaces, and it is asked for.
    //
    // Only the SESSIONS are held back, not the whole save: this function also writes the deal's own
    // details (name, date, venue, shift, pax, functions), and returning early here would mean editing
    // Event Info stopped persisting whenever the build happened to be empty — trading a visible bug
    // for a silent one.
    const keepDraft = autoSaveWouldDestroy(snapshot, prevSessions[0] || null, !!opts.auto);
    // A fresh Load re-populates every piece of build state from the resumed session — object
    // references the auto-save effect's dependency list sees as "changed" even though nothing was
    // actually edited. Left alone, the boundary below would fork a duplicate of the very session
    // just resumed the moment that mechanical re-hydration triggered its own auto-save. So while the
    // boundary is pending, a save whose content still matches what was just loaded is a no-op — wait
    // for a save that actually differs before spending the boundary on a new entry.
    const loadEchoNoop = sessionBoundaryRef.current && snapshotContentEqual(snapshot, prevSessions[0] || null);
    if (keepDraft || loadEchoNoop) {
      client.sessions = prevSessions;
    } else {
      // Collapse consecutive auto-drafts into the same slot — UNLESS a Load just opened a new visit
      // (sessionBoundaryRef), in which case this save must start a fresh entry so the resumed draft
      // (the previous meeting's build) survives instead of being overwritten in place.
      const collapseInPlace = opts.auto && prevSessions[0]?.auto && !sessionBoundaryRef.current;
      // TEN PER CLIENT, and the table holds the same ten. Browse shows the newest as the full card
      // and the five after it in the collapsed list, so ten is the history with room to spare — and a
      // bounded row count is the point of keeping this in a table rather than letting a blob grow.
      // The list is built before it is cut, so the entries the cut drops are known by id and their
      // rows go with them. Without that the array would forget them while the table kept them, and
      // the next load would bring them all back.
      const nextSessionList = collapseInPlace
        ? [snapshot, ...prevSessions.slice(1)]
        : [snapshot, ...prevSessions];
      client.sessions = nextSessionList.slice(0, SESSION_KEEP);
      const prunedIds = nextSessionList.slice(SESSION_KEEP).map((x) => x?.id).filter(Boolean);
      sessionBoundaryRef.current = false;
      // ── THE SAME SAVE, ROW-LEVEL, TO `studio_sessions` (migration 026) ──
      // Inside the else on purpose: keepDraft and loadEchoNoop are deliberate no-ops on the array
      // above, and a no-op must not write to the table either.
      // Each save mints its own id, so a collapsed auto-draft does not overwrite the row it replaces
      // — it stands beside it. The array drops the one it replaced; the table has to as well, or it
      // would accumulate every 15s tick as its own entry in the history.
      // Fire-and-forget, like every other caller on this path: the blob mirror in client_ledger
      // carries this same save, so a failed write here costs sync, not data.
      const rowsForSnapshot = sessionToRows(client.id, snapshot);
      const replacedId = collapseInPlace ? (prevSessions[0]?.id || null) : null;
      // The draft this save replaced, plus anything the ten-session cut dropped.
      const dropIds = [...new Set([replacedId, ...prunedIds].filter((x) => x && x !== snapshot.id))];
      if (rowsForSnapshot.length) {
        (async () => {
          try {
            // Delete first. Both can run in one save, and a delete landing after the upsert that
            // replaced it would take the new rows out with the old.
            for (const did of dropIds) {
              await supabase.from("studio_sessions").delete().eq("session_id", did);
            }
            const { error } = await supabase.from("studio_sessions")
              .upsert(rowsForSnapshot, { onConflict: "id" });
            if (error) throw error;
          } catch (e) {
            // SAID OUT LOUD, not swallowed. A silent data-layer failure is how 249 tag verifications
            // were lost in July (see the note on migration 023) — if these rows are not landing, the
            // screen has to say so rather than look like it saved. The client_ledger mirror still
            // holds the save either way, so this reports a sync problem, not lost work.
            showMsg?.("Session rows not saved: " + (e?.message || e), "red");
          }
        })();
      }
    }
    setActiveClientId(client.id);
    const finalLedger = updated.slice(0, 200);
    // saveClientLedger is async (a real Supabase upsert) but every existing caller here is
    // fire-and-forget — timers and unmount handlers that can't await anyway. Handing back the
    // promise costs them nothing (they just don't read it) and lets a caller that DOES need to
    // know the write actually landed — the update banner flushing before it reloads — await it
    // instead of racing a reload against an in-flight network request.
    const savePromise = saveClientLedger(finalLedger);
    if (!opts.auto) showMsg("✓ Session saved to " + client.name, "green");
    return { client, ledger: finalLedger, savePromise };
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
    // `activeClientId` alone is enough now. It only exists once Event Info's Continue has committed
    // the deal to the ledger, so a committed deal keeps its details saved from that moment — before
    // a single zone is switched on. Previously nothing was written until there was build data, so
    // browsing or filling in dimensions and then refreshing lost the lot, and the deal sat with
    // `sessions: []`. Typing a name on Event Info still saves nothing: no id yet, no build data, and
    // saveSession would otherwise mint a client per keystroke.
    buildHasDataRef.current = !!(clientName.trim() && (
      activeClientId
      || Object.keys(zoneElements || {}).length > 0
      || Object.keys(elSelectedPhoto || {}).length > 0
      || Object.values(enabledEls || {}).some(Boolean)
    ));
  });
  // Never mid-switch: a switch replaces the whole build state, and a save landing partway through
  // writes a session that is half one function and half another. The switch's own settled state
  // schedules a save straight after, so nothing is skipped — only mistimed.
  const autoSaveBuild = useCallback(() => {
    // Both flags: switchingRef covers the click-to-commit half, fnSwitchingRef the render-and-settle
    // half. Either one alone leaves a window where a save can capture a half-loaded function.
    if (switchingRef.current || fnSwitchingRef.current) return;
    if (buildHasDataRef.current) { try { saveSessionRef.current({ auto: true }); } catch { /* ignore */ } }
  }, []);
  // 1) Debounced on edits.
  useEffect(() => {
    if (!buildHasDataRef.current) return;
    const t = setTimeout(autoSaveBuild, 1500);
    return () => clearTimeout(t);
    // Event Info fields are in here too — date, venue, function, shift, pax, the extra functions.
    // They were absent, so editing the deal's details never scheduled a save; only touching the
    // build did, and the details rode along by accident whenever that happened to fire.
  }, [activeClientId, clientName, clientDate, venue, fn, clientShift, clientPax, clientBrideGroom, extraFunctions,
      zoneElements, elSelectedPhoto, elTiers, zoneConfig, enabledEls, elNotes, floralRatio, itemQty, itemGrades,
      customZones, customMode, activeFnIdx, fnBuilds, autoSaveBuild]);
  // 2) Periodic fallback + 3) save on tab hide / refresh.
  useEffect(() => {
    const id = setInterval(autoSaveBuild, 15000);
    const onVis = () => { if (document.visibilityState === "hidden") autoSaveBuild(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", autoSaveBuild);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", autoSaveBuild); autoSaveBuild(); /* save on unmount → covers Studio↔IMS route switch (no pagehide fires) */ };
  }, [autoSaveBuild]);
  // 4) On-demand flush for the "new version available" banner (App.jsx), which lives above the
  // router and reloads the page on click. pagehide fires on reload too, but a reload can cancel an
  // in-flight fetch before it lands — the same network write that pagehide kicks off has no guarantee
  // of finishing before the browser tears the page down. Registering a flush the banner can AWAIT
  // (via saveSession's savePromise) closes that race instead of hoping pagehide wins it.
  useEffect(() => {
    const flush = async () => {
      if (switchingRef.current || fnSwitchingRef.current || !buildHasDataRef.current) return;
      const result = saveSessionRef.current({ auto: true });
      if (result?.savePromise) await result.savePromise;
    };
    registerFlushBeforeReload(flush);
    return () => unregisterFlushBeforeReload(flush);
  }, []);

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
          elSelectedPhoto: Object.fromEntries(Object.entries(fnData.elSelectedPhoto || {}).map(([k, v]) => [k, { src: v?.src, eventName: v?.eventName, isLibrary: v?.isLibrary, eventId: v?.eventId }])),
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
  const loadClientSession = useCallback((client, session, landingStep = 3, opts = {}) => {
    // A genuine Load (client-search "Load →", a past-session pick, an LMS lead) opens a new visit —
    // see sessionBoundaryRef. The mount-restore effect below also calls this to bring back a deal
    // that's already active after a refresh/reopen — that's the SAME visit continuing, not a new one,
    // so it passes isNewVisit:false. Getting this wrong duplicated the just-loaded session: the
    // restore's own follow-up autosave would see the boundary flag and clone it before any edit.
    if (opts.isNewVisit !== false) sessionBoundaryRef.current = true;
    setClientName(client.name);
    setClientPhone(client.phone || "");
    setActiveClientId(client.id);
    // This IS the client's real identity as of this load — future edits away from it need an
    // explicit confirm (see loadedClientIdentityRef) before they're allowed to autosave.
    loadedClientIdentityRef.current = { name: client.name || "", phone: client.phone || "" };
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
      // Missing here left dcCustomItems holding whatever the PREVIOUS client/session had (state
      // never resets on its own) — so switching clients without a refresh could leak one client's
      // Deal Check custom items into another's snapshot, and the very next auto-save after a Load
      // would disagree with the session it just resumed on this field alone, forking a duplicate.
      setDcCustomItems(Array.isArray(session.customItems) ? session.customItems : []);
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
      // NO TOAST FOR A LOAD THAT ALREADY SHOWS ITSELF. Resuming a session moves the whole screen —
      // the step changes, the reference video appears, the build fills in — so a banner saying it
      // happened is telling you what you just watched, and it lands over the step nav while you are
      // trying to read it. Its companion further down (the single-function path) is gone for the
      // same reason. Failures still speak; this was only ever a success message.
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
    // The single-function path's toast, gone for the reason given on the multi-function one above.
  }, [events, allVideos, ytVideoTags]);

  // ── Close the open deal: back to a blank builder ──
  // Lived inline in StudioSummary, where "Start New" and the Summary's own delete link both used it.
  // The Client Tracker's delete could not reach it and cleared only activeClientId, which is a
  // resurrection: the background auto-save runs off clientName plus whatever build is loaded, so
  // with the id gone saveSession stops finding a client and MINTS A NEW ONE — same name, same
  // details, same build, fresh CLI_ id — within fifteen seconds of the delete. Deleting the deal you
  // have open has to clear the deal you have open, so the reset lives here and both call sites take
  // it from ctx rather than keeping a copy each.
  //
  // The moved copy also drops a setNewCzName("") call. No such state exists — ctx handed the old
  // inline version `undefined` for it, so the reset THREW there and the ten setters after it never
  // ran: bride/groom, shift, pax, the other venue, the extra functions, the function index and its
  // builds, floral overrides and the palette all survived "Start New" into the next deal.
  const startNewDeal = useCallback(() => {
    setStep(0);setEnabledEls({});setElTiers({});setCustomMode({});setItemQty({});setItemGrades({});setSelectedMoods([]);setSelectedPalettes([]);setVenue("");setFn("");setClientName("");setClientDate("");setClientPhone("");setActiveClientId(null);setClientSearch("");setSavedInsps([]);setFilterCat([]);setFilterFn([]);setFilterSpace([]);setFilterVenue("All");setElSelectedPhoto({});setElInspo({});setSourceEvent(null);setSourceVideo(null);setBrowseVenues([]);setVenueGroup(userVenueScope==="all"?"all":userVenueScope);setOutsideSub("all");setShowMoreOutside(false);setElNotes({});setElGallery(null);setZoneConfig({});setActiveZones([]);setShowCosts(false);setZoneElements({});setCustomTripRate(0);setVenueCustom(false);setCustomGensets(null);setCustomZones([]);setClientBrideGroom("");setClientShift("");setClientPax("");setClientVenueOther("");setExtraFunctions([]);setExpandedFnIdx(0);setActiveFnIdx(0);setFnBuilds({});setFloralOverrides({note:"",rows:[]});setClientPalette("Custom");
    loadedClientIdentityRef.current = { name: "", phone: "" };
  }, [userVenueScope]);

  // ── Restore the active deal on mount (refresh / Studio↔IMS switch) ──
  // The build lives in the client's rolling auto-session; sessionStorage remembers which deal + screen.
  // Runs once, only when nothing is loaded yet, so it never clobbers a deal already being edited.
  const buildRestoredRef = useRef(false);
  useEffect(() => {
    if (buildRestoredRef.current) return;
    if (activeClientId) { buildRestoredRef.current = true; setRestoring(false); return; }   // a live deal is already open
    if (!Array.isArray(clientLedger) || clientLedger.length === 0) return; // ledger not loaded yet
    const savedId = restoreRef.current?.id || null;   // snapshotted at first render — see restoreRef
    if (!savedId) { buildRestoredRef.current = true; setRestoring(false); return; }
    // Refreshing ON Event Info starts over: that screen is where a deal is begun, so bringing the
    // previous client's details back into the form is the opposite of what the reload was for.
    // Browse, Build and Summary still restore — there you are mid-deal and want it back.
    if (restoreRef.current?.step === 0) { buildRestoredRef.current = true; setRestoring(false); return; }
    const client = clientLedger.find(c => c.id === savedId);
    const session = client && Array.isArray(client.sessions) ? client.sessions[0] : null;
    buildRestoredRef.current = true;
    setRestoring(false);
    // Only the client has to exist. This used to bail without a session too, but a deal gets its
    // first auto-session only once something is built — so refreshing on Browse, or on Build before
    // adding anything, threw you back to Event Info to retype a form you had already filled in.
    // loadClientSession handles a null session: client details and the screen come back, and the
    // build state stays empty, which is all there was to restore anyway.
    if (!client) return;
    const savedStep = restoreRef.current?.step ?? null;
    const savedFn = restoreRef.current?.fn || 0;
    // With a session and no usable stored step, Summary stays the default as before. Without one
    // there is nothing to summarise, so fall back to Event Info instead.
    const landingStep = (savedStep !== null && savedStep >= 1) ? savedStep : (session ? 3 : 0);
    loadClientSession(client, session, landingStep, { isNewVisit: false });
    if (savedFn > 0) setActiveFnIdx(savedFn);
  }, [clientLedger, activeClientId, loadClientSession]);

  // Backstop: if the ledger never arrives — offline, a failed fetch — drop the gate anyway rather
  // than leaving the app on a spinner with no way forward.
  useEffect(() => {
    if (!restoring) return;
    const t = setTimeout(() => setRestoring(false), 6000);
    return () => clearTimeout(t);
  }, [restoring]);

  // ── Load LMS lead — VERBATIM ──
  const loadLmsLead = useCallback((lead) => {
    if (!lead) return;
    setClientName(lead.guestName || "");
    setClientPhone(lead.phone || "");
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
    // LMS holds these for most leads; they used to be blanked at the top of this function and never
    // filled, so the salesperson retyped what the lead already knew.
    setClientBrideGroom([lead.brideName, lead.groomName].filter(Boolean).join(" & "));
    setClientPax(Number(f1.pax) > 0 ? String(f1.pax) : "");
    const extras = fns.slice(1).map(f => {
      const v = resolveVenue(f.venueLabel || lead.address);
      return {
        type: f.fnLabel || "",
        date: f.fnDate || "",
        venue: v.venue,
        venueOther: v.custom,
        shift: f.shift || "",
        pax: Number(f.pax) > 0 ? String(f.pax) : "",
        palette: "Custom",
      };
    });
    setExtraFunctions(extras);
    const phoneKey = (lead.phone || "").replace(/\D/g, "");
    const phoneMatches = phoneKey
      ? clientLedger.filter(c => (c.phone || "").replace(/\D/g, "") === phoneKey)
      : [];
    // More than one Studio client can already share a phone number (a stray duplicate from
    // before this lead was ever linked, or two genuinely separate past deals). Phone alone can't
    // tell them apart, and picking "whichever comes first" — the old behaviour — meant clicking
    // one specific LMS lead could silently attach to a COMPLETELY unrelated client, then have its
    // name overwritten by whatever this lead's guestName/typed text happened to be. Prefer the
    // client THIS exact lead is already linked to (the "LMS #01234" tag on its card); with no
    // definitive link and 2+ candidates, don't guess — mint a fresh client instead.
    const linkedMatch = phoneMatches.find(c => c.lmsLeadId === lead.entryNo);
    const phoneMatch = linkedMatch || (phoneMatches.length === 1 ? phoneMatches[0] : null);
    // A BOOKED match is a closed, past deal — a new inbound lead on the same number is a repeat
    // guest booking something ELSE, not a revision of the old one. Reusing it would silently
    // overwrite the old booking's venue/date/functions and interleave the new meeting history
    // into the old deal's `sessions`. Only reuse an open (not-yet-booked) match; a booked one
    // just gets a heads-up note below and a brand new client record for this deal.
    const existing = phoneMatch && phoneMatch.status !== "booked" ? phoneMatch : null;
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
    // loadClientSession below re-sets this to the same values when there's a session to restore;
    // set it here too so the no-session branch (which never calls loadClientSession) still marks
    // this client's identity as "just loaded" and protected from unconfirmed drift.
    loadedClientIdentityRef.current = { name: client.name || "", phone: client.phone || "" };
    setLmsLeads([]);
    setLmsError(false);
    const latestSession = (client.sessions && client.sessions.length > 0) ? client.sessions[0] : null;
    if (latestSession) {
      loadClientSession(client, latestSession, 3);
      showMsg(`Loaded LMS lead #${lead.entryNo} + restored last session`, "green");
    } else if (phoneMatch && phoneMatch.status === "booked") {
      const when = phoneMatch.eventDate ? new Date(phoneMatch.eventDate + "T00:00:00").toLocaleDateString("en-IN") : "an earlier deal";
      showMsg(`Loaded LMS lead #${lead.entryNo} — ℹ️ this phone already booked with us (${when}); starting a fresh deal for this one`, "green");
    } else {
      showMsg(`Loaded LMS lead #${lead.entryNo} (${lead.dept === "venue" ? "Venue" : "Decor"})`, "green");
    }
  }, [clientLedger, saveClientLedger, authUser, allInhouseVenues, allOutdoorDB, loadClientSession]);

  // ── Resume saved session (per-pill) — VERBATIM ──
  // `targetFnIdx` says WHICH pill to restore into. Without it the caller could only ever resume
  // into whatever pill happened to be active, and a session with no snapshot for that pill would
  // restoreBuildState(null) — silently blanking the pill instead of loading anything. Browse passes
  // the index the session actually holds data for, so resuming from Fn2 a session saved on Fn1
  // switches to Fn1 and loads it rather than wiping Fn2.
  const resumeSavedSession = useCallback((session, targetFnIdx) => {
    if (!session) return;
    const idx = Number.isInteger(targetFnIdx) ? targetFnIdx : activeFnIdx;
    if (session.fnSnapshots && typeof session.fnSnapshots === "object" && Object.keys(session.fnSnapshots).length > 0) {
      const activeSnap = session.fnSnapshots[idx] || session.fnSnapshots[String(idx)] || null;
      if (idx !== activeFnIdx) setActiveFnIdx(idx);
      restoreBuildState(activeSnap);
      const otherBuilds = {};
      Object.entries(session.fnSnapshots).forEach(([k, v]) => {
        const i = parseInt(k);
        if (!isNaN(i) && i !== idx && v) otherBuilds[i] = v;
      });
      setFnBuilds(otherBuilds);
      setStep(2);
      showMsg("Resumed Fn" + (idx + 1) + " from " + new Date(session.savedAt).toLocaleDateString("en-IN"), "green");
      return;
    }
    if (idx !== 0) setActiveFnIdx(0);   // legacy sessions are flat — their data belongs to Fn1
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
  }, [events, allVideos, ytVideoTags, activeFnIdx, setActiveFnIdx]);

  // ── AI tag an image (Claude vision) — routes via callClaudeStreaming (Supabase Edge Fn) ──
  const aiTagImage = async (url) => {
    // Rate Card → IMS migration: AI-tagging vocabulary now comes from live IMS inventory (matches
    // the manual "+Add element" pickers), not Rate Card — so a tagged element resolves to a real
    // invId and prices/blends via getElPriceFromInventory (floral-recipe Studio rate, SMB toggle,
    // sub-category scaling factor) exactly like a manually-added element.
    // "structure" AND "tenting" categories both hold BOTH raw scaffold/masking stock (Box Truss,
    // Platform, Carpet, Masking — captured only via the "dims" fields, never its own element) AND
    // specific decorative/structural items (Wooden/Wrought Iron 2D/3D Arch/Panel/Jali — which the
    // STRUCTURES house rule wants tagged as their own element, and which aren't always filed under
    // "structure"). Exclude only the raw-scaffold ones by NAME (below), not either whole category —
    // blanket-excluding by category meant specific structure items could never be tagged no matter
    // what the prompt said, regardless of which of these two categories they happened to live in.
    // (STRUCT_KW + RAW_SCAFFOLD_CATS now imported from the shared matcher module.)
    // Sub-categories flagged "hidden from AI tagging" (rate_card_categories.tag_hidden, set in IMS's
    // Sub-Categories admin panel) — replaces the old Rate-Card-only "not taggable in Pricing" flag.
    const invTagHiddenByKey = {};
    (rcSubcatFactors || []).forEach(r => { if (r && r.id && r.tag_hidden) invTagHiddenByKey[r.id] = true; });
    // A sub-category with no canonical rate_card_categories row (orphaned/typo'd sub_cat text) is
    // excluded from tagging vocabulary too — same "only recognized sub-cats" rule as the Inventory
    // tab's filter pills. Items with NO sub-category at all are unaffected (nothing to recognize).
    const rcSubIds = new Set((rcSubcatFactors || []).map(r => r.id));
    // House rule: never tag artificial flowers/foliage — a keyword filter on the AI's own proposed
    // name catches "artificial flower"-style text, but not a plausible name (e.g. "Mixed Green
    // Foliage Bundle") that happens to match a real inventory item filed under a sub-category whose
    // NAME itself says it's artificial (e.g. "Artificial Foliage"). Exclude those sub-categories from
    // the AI-tagging vocabulary/matching pool entirely, same mechanism as tag_hidden above.
    const ARTIFICIAL_SUBCAT = /artificial/i;
    const taggableInv = imsInventory.filter(i => {
      const cat = String(i.cat || i.category || "").trim().toLowerCase();
      if (RAW_SCAFFOLD_CATS.has(cat) && STRUCT_KW.test(String(i.name || ""))) return false;
      const subKey = String(i.subCat || i.subcategory || "").trim().toLowerCase();
      if (subKey && invTagHiddenByKey[subKey]) return false;
      if (subKey && !rcSubIds.has(subKey)) return false;
      if (subKey && ARTIFICIAL_SUBCAT.test(subKey)) return false;
      return true;
    });
    const taggableRecipePatterns = recipeOnlyPatterns.filter(p => !ARTIFICIAL_SUBCAT.test(p.sub || ""));
    // Kit (bundle) items → the itemIds of their own components, so a photo that matches the kit
    // itself doesn't ALSO get its individual sub-items tagged as separate elements (double-counts
    // cost and double-blocks inventory for the same physical objects).
    const kitOf = {};
    taggableInv.forEach(i => { if (Array.isArray(i.subItems) && i.subItems.length) kitOf[i.id] = i.subItems.map(s => s.itemId); });
    // Pure flower-recipe patterns with no inventory backing (e.g. "Flower Garden") join the same
    // vocabulary so they can be tagged/matched exactly like an inventory item.
    const elemList = [...taggableInv.map(i => `"${i.name}" (${i.unit})`), ...taggableRecipePatterns.map(p => `"${p.name}" (${p.unit})`)].join(", ");
    // Sub-category vocabulary by top-level category (grounds element naming + routing).
    const subByCat = {}; taggableInv.forEach(i => { const c = String(i.cat || i.category || "").trim(); const s = String(i.subCat || i.subcategory || "").trim(); if (!c || !s) return; (subByCat[c] = subByCat[c] || new Set()).add(s); });
    const subcatText = Object.keys(subByCat).length ? ("Sub-category vocabulary by category (use these names and route each element to the right one):\n" + Object.entries(subByCat).map(([c, set]) => `- ${c}: ${[...set].join(", ")}`).join("\n")) : "";
    // House tagging rules (admin-editable in Manage → Library). These are the team's own domain
    // rules and MUST win over the generic numbered instructions. To actually get the model to obey
    // them (not just receive them) we lean on three levers: authority (named as mandatory in the
    // system prompt), recency (placed LAST in the message, nearest the image — see promptText below),
    // and salience (an override header). Buried at the top of a 15KB prompt they were getting diluted.
    const houseRulesRaw = (taxonomy.taggingStandards && String(taxonomy.taggingStandards).trim()) ? String(taxonomy.taggingStandards).trim() : "";
    const houseRules = houseRulesRaw
      ? ("════════ HOUSE TAGGING RULES — SET BY THE AMBRIA TEAM · ABSOLUTE PRIORITY ════════\n"
        + "Follow every rule below EXACTLY. Where any of these conflicts with the generic numbered\n"
        + "instructions earlier in this message, THESE WIN. Apply them to the tags and elements you output.\n\n"
        + houseRulesRaw)
      : "";
    // TEMPORARY — taxonomy-only bulk pass (spec: business wants the ~2100 untagged library photos
    // zone/venue/style/etc.-tagged now, so they show up in Build's zone pickers, WITHOUT asking the
    // AI for elements/dims yet — salespeople fill those in live while building and push them back via
    // "Correct & update master" instead). Flip TAG_ELEMENTS back to true to resume full tagging;
    // nothing else needs to change — the prompt/schema/post-processing below all key off this flag.
    const TAG_ELEMENTS = false;
    const elementsRulesText = TAG_ELEMENTS ? `Element estimation rules:\n1. FIRST PRIORITY: Use EXACT names from this IMS Inventory list. Copy the name character-for-character:\n${elemList}\n2. For each element, ALSO put its top-level category and sub-category in "cat"/"subCat", picked from the "Sub-category vocabulary by category" list below — this routes the exact-name match to the right bucket instead of the whole catalog, so pick the one that's visually true (e.g. a floral pot is cat "Florals", subCat "Flower Pot Large" — not a Lighting subCat just because a light sits nearby).\n3. For each visible element, estimate quantity and pick size (S/M/B) if available.\n4. ONLY if you see something clearly visible that has NO match in the list above, add it with "new":true flag. Keep the name short and professional; still fill "cat"/"subCat" with your best guess.\n5. CRITICAL — DO NOT add Truss, Box Truss, Single U Truss, Platform, Carpet, Wall Masking, Fabric Masking, Acrylic Panel, Flex Print, Vinyl Print, Genset, or any structural/overhead items as elements. These are captured separately in the "dims" section (trussL/trussW/trussH, plH, mkT, mkWalls). Tag ONLY visible decor items: florals, lighting, furniture, chandeliers, ceiling patterns, arches, props, wrought iron pieces, glass panels.\n6. LIGHTS — count EVERY individual light fixture you can see (chandeliers, LED panels, fairy-light runs, lamps, uplights, neon). Put the TOTAL number of lights in "lightCount" (0 if none). Never write vague counts; never omit lights.\n7. MISSING/UNSURE — if you see a decor item you cannot confidently match to the list, still add it to elements with "new":true AND add a short plain description to "unrecognized" so a human reviewer can add it to the system. Use [] if everything was identified.\n8. NEVER tag "artificial flower", "faux flower", "fake flower/greenery/bouquet/garland" or similar as its own element. Real-vs-artificial is a %-blend the pricing engine applies automatically to the matched floral item itself — it is never a separate physical item. Just tag the flower/floral item normally by its recipe or pot name; do not add an extra "artificial ___" entry for it.\n9. KITS — if what you see is several pieces sold and priced together as ONE bundled inventory item (e.g. a console with its own base pot, a stand with its own topper), tag it ONCE using that bundled item's exact name. Do NOT also separately list its individual component pieces — that double-counts cost and double-blocks inventory.\n10. ATTACHMENT — for EVERY element, also decide if it is physically resting on, placed on top of, or otherwise part of another element you are ALSO tagging in this same photo (e.g. a candle sitting on a console table, a vase on a pedestal, a topper on a stand). If so, set "attachedTo" to the EXACT "name" you used for that other element (copy it character-for-character). If it is freestanding / not attached to anything else you tagged, set "attachedTo" to "". Still tag the item normally (name/qty/size) even when it's attached to something else — do not skip it, just record what it's attached to.\n11. CRITICAL — NAMING IS MANDATORY: "name" must ALWAYS be a specific, human-scannable name (5-9 words) a salesperson could recognize in a list of hundreds of photos — reference the zone/area, the dominant design style, AND one standout hero element, e.g. "Mandap Stage — Ivory Drapes & Crystal Chandelier" or "Boho Backdrop with Hanging Marigold Strings". NEVER settle for generic filler alone like "Wedding Decor", "Elegant Setup", "Floral Arrangement", "Event Design", or a bare venue/zone label — every single photo needs its own distinct, descriptive name, not a placeholder.\n12. STRUCTURES vs TRUSS DIMS — these are TWO SEPARATE things and you must fill BOTH when relevant, never one instead of the other. The "dims" fields (trussL/trussW/trussH/plH/mkT) capture ONLY the plain overhead scaffold/base rig (Box Truss or Single U Truss) — fill them whenever there's an overhead rig, regardless of what it's made of or shaped like. SEPARATELY — and in ADDITION — if the structure itself (arch, panel, wall, jali/lattice/mesh screen, backdrop frame) has a distinct material and shape, you MUST ALSO add ONE element for it. Shapes include Arch, Panel, AND Jali (a perforated lattice/mesh screen — do NOT try to force a Jali into the Arch/Panel naming, it is its own shape). FIRST search the IMS Inventory list above (rule 1) for a SPECIFIC matching item by its own catalog name (e.g. "iron Jali" for a wrought-iron perforated lattice/mesh screen/dome, "J arch"/"Single arch"/"Triangle" for specific arch shapes) — these specific catalog names always win over a generic label, so use them whenever one visually matches. ONLY if no specific item matches, fall back to the generic sub-category combo name: MATERIAL (Wooden or Wrought Iron) + DEPTH (2D flat / 3D with visible depth) + SHAPE (Arch/Panel) from the sub-category vocabulary below. NEVER invent your own descriptive label (e.g. "Gold Mesh Dome Structure") for a structure element instead of matching it to the inventory list. Filling the truss dims is NEVER a substitute for tagging this — do not skip the structure element just because you already filled trussL/trussW/trussH.\n\nDimension estimation rules (in feet, estimate from visual cues like people height ~5.5ft, chairs ~3ft, standard ceiling ~10-12ft):\n- trussL: length of the main structure (front-to-back or stage width)\n- trussW: width/depth of the structure\n- trussH: height of the overhead structure/truss\n- floorL: floor area length (may be larger than truss if carpet/platform extends)\n- floorW: floor area width\n- plH: platform height — "4in" if slightly raised, "1ft" if clearly elevated stage, "" if ground level\n- mkT: masking material if visible behind/sides — "fabric","acrylic","flex","vinyl" or "" if none\n- mkWalls: which walls have masking — {"back":true/false,"left":true/false,"right":true/false}` : `Elements & dimensions: NOT needed for this pass — always return "elements": [], "lightCount": 0, "unrecognized": [], and every "dims" field as its zero/empty default ({"trussL":0,"trussW":0,"trussH":0,"floorL":0,"floorW":0,"plH":"","mkT":"","mkWalls":{"back":false,"left":false,"right":false}}). Do NOT attempt to detect, count, or name any decor items, and do NOT estimate any structure dimensions — only the taxonomy tags above matter right now. Still write a good, specific, human-scannable "name" (5-9 words) for the photo based on the zone/area, dominant design style, and what you can tell about the scene overall — reference something distinctive, not a generic placeholder like "Wedding Decor" or "Elegant Setup".`;
    const exampleJson = TAG_ELEMENTS
      ? `{"name":"Mandap Stage — Ivory Drapes & Crystal Chandelier","tags":{"eventType":["..."],"venueType":["..."],"areasElements":["..."],"colorPalette":["..."],"categoryTier":["..."],"designStyle":["..."],"timeSetting":["..."]},"dims":{"trussL":24,"trussW":15,"trussH":12,"floorL":28,"floorW":18,"plH":"4in","mkT":"fabric","mkWalls":{"back":true,"left":false,"right":false}},"elements":[{"name":"Chandelier","cat":"Lighting","subCat":"Chandelier","qty":12,"unit":"pc","size":"M","detail":"crystal","attachedTo":""},{"name":"Console Table","cat":"Furniture","subCat":"Console Table","qty":1,"unit":"pc","size":"M","detail":"","attachedTo":""},{"name":"Pillar Candle","cat":"Lighting","subCat":"Candle","qty":2,"unit":"pc","size":"","detail":"","attachedTo":"Console Table"},{"name":"Custom Drape Structure","cat":"Fabric","subCat":"","qty":2,"unit":"pc","size":"","detail":"fabric","new":true,"attachedTo":""}],"lightCount":24,"unrecognized":["large hanging floral ring"]}`
      : `{"name":"Mandap Stage — Ivory Drapes & Crystal Chandelier","tags":{"eventType":["..."],"venueType":["..."],"areasElements":["..."],"colorPalette":["..."],"categoryTier":["..."],"designStyle":["..."],"timeSetting":["..."]},"dims":{"trussL":0,"trussW":0,"trussH":0,"floorL":0,"floorW":0,"plH":"","mkT":"","mkWalls":{"back":false,"left":false,"right":false}},"elements":[],"lightCount":0,"unrecognized":[]}`;
    const prompt = `Analyze this wedding/event decor image. Tag it using ONLY these exact values:\n\nEvent type: ${taxonomy.eventType.join(", ")}\nVenue type: ${taxonomy.venueType.join(", ")}\nAreas & elements: ${taxonomy.areasElements.join(", ")}\nColor palette: ${(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxonomy.colorPalette).join(", ")}\nCategory tier: ${taxonomy.categoryTier.join(", ")}\nDesign style: ${taxonomy.designStyle.join(", ")}\nTime/setting: ${taxonomy.timeSetting.join(", ")}\n\n${elementsRulesText}\n\nReturn ONLY JSON:\n${exampleJson}`;
    // Structured-outputs schema — the 7 tag fields are LOCKED to your exact taxonomy values (enums), so
    // Claude can never return an off-list or mis-cased tag (the root of photos not matching their zone).
    // Element names stay free text (the fuzzy match below maps them to IMS inventory / flags new items).
    const paletteVals = paletteNames(imsPaletteCatalogue, taxonomy.colorPalette);
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
            required: ["name", "cat", "subCat", "qty", "unit", "size", "detail", "new", "attachedTo"],
            properties: { name: { type: "string" }, cat: { type: "string" }, subCat: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, size: { type: "string", enum: ["S", "M", "B", ""] }, detail: { type: "string" }, new: { type: "boolean" }, attachedTo: { type: "string" } },
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
      // Order = priority-by-recency: context first (human corrections to learn from, then the learned
      // knowledge base, then sub-category vocabulary), then the base instructions, then the HOUSE RULES
      // LAST so they sit closest to the target image and carry the most weight at generation time.
      // All of this is static per session (only the image below is volatile), so the whole prefix is cached.
      // processNote frames the whole message with a photo-FIRST order: identify what is actually in the
      // image, then use the learned KB only as a naming/count reference (never as a reason to tag the
      // area's "usual" items when they aren't present — over-weighting the KB caused it to hallucinate
      // typical elements), then enforce the house RULES as hard constraints that win any KB conflict.
      const processNote = houseRulesRaw
        ? "TAGGING PROCESS — follow in this order every time: (1) READ THE PHOTO — identify ONLY what is actually visible in THIS image. (2) NAME — use the HOUSE TAGGING KNOWLEDGE BASE below and the vocabulary lists only to pick the correct names/counts for what you saw; NEVER tag an item just because it is common for this area when it is not in the photo. (3) CONSTRAIN — apply the HOUSE TAGGING RULES as hard constraints; wherever a rule and the knowledge base disagree, THE RULE WINS."
        : "TAGGING PROCESS — first read the photo and identify what is ACTUALLY visible, then use the HOUSE TAGGING KNOWLEDGE BASE below only as a naming/count reference for what you saw — do not tag items just because they are common for this area.";
      const promptText = [processNote, corrText, kbText, subcatText, prompt, houseRules].filter(Boolean).join("\n\n");
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
        system: "You are a wedding/event decor image tagger. Respond ONLY with valid JSON, no other text."
          + " Tag what is ACTUALLY visible in the photo. Use the HOUSE TAGGING KNOWLEDGE BASE (learned from the team's verified photos) ONLY as a reference for correct names, vocabulary, and typical counts — never tag an item just because it is common for that area when it is not present in the image."
          + (houseRulesRaw ? " The HOUSE TAGGING RULES are in the '════ HOUSE TAGGING RULES' block at the end of the message; they are MANDATORY and override both the knowledge base and the generic tagging instructions — follow every one of them exactly." : ""),
        outputConfig: { format: { type: "json_schema", schema: tagSchema } },
        // display:"summarized" — without it the model still thinks (billed the same) but the
        // thinking block's text comes back empty, so there'd be nothing to show a reviewer.
        thinking: { type: "adaptive", display: "summarized" },
        returnThinking: true,
      });
      let result;
      try {
        result = await callTag(buildContent(exemplars.length > 0));
      } catch (eEx) {
        // A bad/unreachable exemplar image URL shouldn't break tagging — retry once without examples.
        if (exemplars.length) result = await callTag(buildContent(false)); else throw eEx;
      }
      const txt = result?.text;
      const aiThinking = (result?.thinking || "").trim();
      if (!txt || !txt.trim()) { showMsg("AI returned empty response", "red"); return null; }
      const clean = txt.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      // Pristine snapshot of exactly what Claude returned, taken before the matching/filtering below
      // mutates parsed.elements in place — lets a reviewer see the raw name/qty/size Claude proposed
      // vs. what it ended up matched to.
      const aiRawResponse = JSON.parse(JSON.stringify(parsed));
      if (aiThinking) parsed._aiThinking = aiThinking;
      // ── Self-verify pass ─────────────────────────────────────────────────────────
      // A second look at the SAME photo, handed the model's own first-pass elements, to catch the two
      // things the first pass is worst at: (1) MISSED visible seating (a sofa/couch often half-hidden
      // by drapes/tables/people), and (2) HALLUCINATED items inferred from context but not actually
      // present (phantom mattress/pouffe). Also steers structural florals → Flower Reet and kills
      // absurd counts. Returns a corrected element list that replaces the first pass BEFORE matching.
      // Best-effort: any failure leaves the first-pass elements untouched (aiRawResponse already
      // snapshotted the pristine first pass above).
      if (TAG_ELEMENTS && Array.isArray(parsed.elements) && parsed.elements.length && imageBlock) {
        try {
          const proposed = parsed.elements.map(e => `- ${e.name} (${e.cat || "?"}/${e.subCat || "?"}) x${e.qty || 1}`).join("\n");
          const verifyText = "You already tagged the decor photo below. Here are the elements you proposed:\n" + proposed
            + "\n\nLook at the photo again, carefully, and return a CORRECTED element list. Fix these specific mistakes:\n"
            + "1. MISSED SEATING — if a sofa, couch, chair, or bench is visible (even partly hidden by drapes, tables, flowers, or people) and it is NOT in the list, ADD it.\n"
            + "2. HALLUCINATIONS — remove any element that is NOT clearly, actually visible. In particular do NOT keep a mattress/pouffe/takhat/floor-cushion unless it is unmistakably that item (pooled fabric, drapes, carpet, and shadows are NOT mattresses).\n"
            + "3. FLORALS — dense florals wrapped/arranged on a structure, arch, drape, or pillar must be named \"Flower Reet\", never a \"flower wall/bedding\" or \"Phool Ki Chaadar\".\n"
            + "4. QUANTITIES — fix absurd counts (never count individual flowers; florals are a Flower Reet in its own unit).\n"
            + "5. CONFIDENCE — after correcting, rate your confidence 0-100 that this FINAL list completely AND correctly captures the decor actually in the photo. Be strict and self-critical: lower the score when the scene is dense/cluttered, when items overlap or are partly hidden, or when you are unsure you caught every seating / structure / floral element. Reserve 90-100 only for simple, clearly-lit photos where you are certain nothing is missed or mis-identified. Do not default to 100.\n"
            + "Keep every genuinely-correct element as-is. Return ONLY JSON: {\"elements\":[{name,cat,subCat,qty,unit,size,detail,new,attachedTo}],\"lightCount\":<int>,\"confidence\":<int 0-100>}.";
          const verifySchema = {
            type: "object", additionalProperties: false, required: ["elements", "lightCount", "confidence"],
            properties: {
              lightCount: { type: "integer" },
              confidence: { type: "integer" },
              elements: { type: "array", items: {
                type: "object", additionalProperties: false,
                required: ["name", "cat", "subCat", "qty", "unit", "size", "detail", "new", "attachedTo"],
                properties: { name: { type: "string" }, cat: { type: "string" }, subCat: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, size: { type: "string", enum: ["S", "M", "B", ""] }, detail: { type: "string" }, new: { type: "boolean" }, attachedTo: { type: "string" } },
              } },
            },
          };
          const vres = await callClaudeStreaming({
            contentBlocks: [{ type: "text", text: verifyText }, imageBlock],
            model: "claude-opus-4-8", maxTokens: 6000,
            system: "You are a meticulous decor-photo tag reviewer. Respond ONLY with valid JSON, no other text.",
            outputConfig: { format: { type: "json_schema", schema: verifySchema } },
            thinking: { type: "adaptive", display: "summarized" },
          });
          const vclean = String(vres || "").replace(/```json|```/g, "").trim();
          const vparsed = vclean ? JSON.parse(vclean) : null;
          if (vparsed && Array.isArray(vparsed.elements) && vparsed.elements.length) {
            parsed.elements = vparsed.elements;
            if (typeof vparsed.lightCount === "number") parsed.lightCount = vparsed.lightCount;
            if (typeof vparsed.confidence === "number") parsed._verifyConfidence = Math.max(0, Math.min(100, Math.round(vparsed.confidence)));
            parsed._selfVerified = true;
          }
        } catch (e) { console.warn("[aiTag] self-verify pass skipped:", e?.message || e); }
      }
      if (TAG_ELEMENTS && parsed.elements && (imsInventory.length || recipeOnlyPatterns.length)) {
        // Stamp each element's ORIGINAL AI-proposed name before any filtering/matching renames it —
        // "attachedTo" (below) references another element by the name Claude gave it in its own
        // response, so that name must survive even after this element's own "name" gets overwritten
        // with its matched inventory name.
        parsed.elements.forEach(el => { if (el) el._origName = el.name; });
        // Junk-name backstop: the model occasionally emits a stray element with a meaningless name
        // (e.g. "T") which then substring-matches a random catalog item or just sits as an inert ₹0
        // row. Drop anything with no real word — nothing alphabetic of length >= 2 — before matching.
        parsed.elements = parsed.elements.filter(el => normalize(el?.name).split(" ").some(w => /[a-z]/.test(w) && w.length >= 2));
        const ARTIFICIAL_KW = /\b(artificial|faux|fake)\b/i;
        const FLORAL_KW = /\b(flower|floral|greenery|leaves|leaf|petal|bouquet|garland|bunch|foliage|plant)\b/i;
        // House rule: real-vs-artificial is a %-blend the pricing engine (el.realPct) applies
        // automatically to the matched floral item — never its own physical item. This used to DELETE
        // the whole element if the model said "artificial
        // X" — silently undercounting a real, visible floral arrangement whenever the model's naming
        // didn't perfectly follow the "don't say artificial" instruction (the same instruction-
        // following unreliability behind the console/accessory bug). Now it just strips the
        // artificial/faux/fake word and lets the cleaned name continue through normal matching below.
        parsed.elements = (parsed.elements || []).map(el => {
          if (!el || !el.name || !(ARTIFICIAL_KW.test(el.name) && FLORAL_KW.test(el.name))) return el;
          const cleanName = el.name.replace(/\b(artificial|faux|fake)\b/gi, "").replace(/\s+/g, " ").trim();
          return cleanName ? { ...el, name: cleanName } : el;
        });
        const sizeHints = { heavy: "B", large: "B", big: "B", tall: "B", medium: "M", mid: "M", regular: "M", small: "S", mini: "S", light: "S", short: "S" };
        // Element-name → inventory matcher (exact → substring → keyword-overlap ≥40%), bound to the
        // ops-editable AI Synonym Dictionary. Extracted to src/lib/studio/tagging/matcher.js so the
        // scoring/thresholds live in one testable module (spec §9-A / §12.1).
        // Overlap matches below MATCH.LOW_CONFIDENCE_BELOW are flagged low-confidence for review.
        const { bestOf } = createMatcher(imsSynonymDictionary);
        // Matches an AI-proposed element name against a real IMS inventory item and, on a match,
        // sets invId so it prices via getElPriceFromInventory (floral-recipe Studio rate, SMB
        // toggle, sub-category scaling factor) exactly like a manually-added element.
        parsed.elements = parsed.elements.map(el => {
          const elWords = normalize(el.name).split(" ");
          let sizeFromName = "";
          for (const w of elWords) { if (sizeHints[w]) { sizeFromName = sizeHints[w]; break; } }
          const size = () => sizeFromName || el.size || "";

          // Scope the search to the model's own guessed sub-category first — routes the match to
          // the right ~10-30 item bucket instead of the whole ~600-item catalog, so a shared
          // generic word (or a plausible-but-wrong name) can't collide across categories. Falls
          // back to the full catalog if the guess didn't narrow to anything, so a wrong/blank
          // category guess never costs recall.
          // A keyword-overlap match below LOW_CONFIDENCE_BELOW is a WEAK guess. It used to still be
          // committed — renamed + priced — with only a ❓VERIFY flag, which is exactly how a floral
          // proposal got silently priced as the wrong physical item ("Phool Ki Chaadar ×110"). Treat a
          // weak overlap as NOT a match: (a) a weak inventory guess falls THROUGH so a strong flower-
          // recipe match can win instead (dense structural florals → "Flower Reet"), and (b) if nothing
          // matches confidently the element drops to "unrecognized" for review — keeping the AI's
          // ORIGINAL proposed name, never a confidently-wrong priced row. A weak guess should surface
          // for a human to add/correct, not masquerade as a matched, priced element.
          const isWeak = (m) => m && m.method === "overlap" && m.score < MATCH.LOW_CONFIDENCE_BELOW;
          const elSubKey = normalize(el.subCat);
          const scopedInv = elSubKey ? taggableInv.filter(it => normalize(it.subCat || it.subcategory) === elSubKey) : [];
          const invMatch = (scopedInv.length && bestOf(el.name, scopedInv, it => it.name)) || bestOf(el.name, taggableInv, it => it.name);
          if (invMatch && !isWeak(invMatch)) {
            return { ...el, name: invMatch.item.name, unit: invMatch.item.unit, size: size(), invId: invMatch.item.id, new: undefined, matchMethod: invMatch.method, matchScore: Math.round(invMatch.score) };
          }

          // No confident inventory match — try a pure flower-recipe pattern (e.g. "Flower Garden") the same way.
          const scopedPat = elSubKey ? taggableRecipePatterns.filter(p => normalize(p.sub) === elSubKey) : [];
          const patMatch = (scopedPat.length && bestOf(el.name, scopedPat, p => p.name)) || bestOf(el.name, taggableRecipePatterns, p => p.name);
          if (patMatch && !isWeak(patMatch)) {
            return { ...el, name: patMatch.item.name, unit: patMatch.item.unit, size: size(), patternId: patMatch.item.id, new: undefined, matchMethod: patMatch.method, matchScore: Math.round(patMatch.score) };
          }

          return { ...el, new: true };
        });
        // A matched kit already represents its own components' cost/stock — drop any OTHER element
        // in this same photo that matched one of THAT kit's sub-items, so a "Molding Console" (kit)
        // plus its own "Round Fibre Pot" component don't both get tagged for the same physical object.
        const suppressedCompIds = new Set();
        parsed.elements.forEach(el => { if (el.invId && kitOf[el.invId]) kitOf[el.invId].forEach(id => suppressedCompIds.add(id)); });
        if (suppressedCompIds.size) parsed.elements = parsed.elements.filter(el => !(el.invId && suppressedCompIds.has(el.invId)));
        // Harden that dedup for NAME-similar components too, not just exact-id ones: if the AI's own
        // phrasing didn't resolve to the kit's own component id (e.g. it overlap-matched a different,
        // merely similar-looking pot instead of the kit's actual "Round Fibre Pot"), the element still
        // slips through the id-only check above. Re-run the same name matcher against just this kit's
        // component names and drop anything that matches — a kit's known components should never
        // reappear as their own element just because the AI phrased/matched them slightly differently.
        // Require an EXACT or SUBSTRING match here (not the loose ≥40% overlap tier) — this pools
        // component names across every kit matched in the photo, so a lenient overlap match could
        // wrongly suppress a genuinely separate standalone item that just happens to share a couple
        // of generic words with some OTHER kit's recipe. An exact/near-exact name match to a specific
        // known component is a much safer bar for an irreversible drop.
        const kitCompNames = [];
        parsed.elements.forEach(el => { if (el.invId && kitOf[el.invId]) kitOf[el.invId].forEach(id => { const ci = imsInventory.find(i => i.id === id); if (ci) kitCompNames.push(ci); }); });
        if (kitCompNames.length) {
          parsed.elements = parsed.elements.filter(el => {
            if (el.invId && kitOf[el.invId]) return true;
            const m = bestOf(el.name, kitCompNames, c => c.name);
            return !(m && m.method !== "overlap");
          });
        }
        // Spatial dedup: Claude tags "attachedTo" with the ORIGINAL name of whatever element this one
        // is resting on/part of. If that parent resolved to a KIT, drop this element outright — even
        // if it doesn't match anything literally in the kit's own recipe. This lets the model's own
        // visual judgment (which vision models are far more reliable at than obeying a "don't tag
        // this" house rule) decide what's superfluous, instead of relying on it declining to propose
        // those items in the first place.
        const withOrigName = parsed.elements.filter(el => el._origName);
        parsed.elements = parsed.elements.filter(el => {
          if (!el.attachedTo) return true;
          const parentMatch = bestOf(el.attachedTo, withOrigName.filter(x => x !== el), x => x._origName);
          return !(parentMatch && parentMatch.item.invId && kitOf[parentMatch.item.invId]);
        });
        // Drop structural items (truss / floor-carpet / masking) from the element breakdown — they're
        // captured in the dedicated Zone-Dimensions/Masking sections, so listing them as elements too
        // double-counts cost AND double-blocks inventory.
        const structuralNames = new Set(imsInventory.filter(i => {
          const cat = String(i.cat || i.category || "").trim().toLowerCase();
          return RAW_SCAFFOLD_CATS.has(cat) && STRUCT_KW.test(String(i.name || ""));
        }).map(i => normalize(i.name)));
        parsed.elements = parsed.elements.filter(el => {
          if (structuralNames.has(normalize(el.name))) return false;
          if (el.invId) {
            // Matched to a real inventory item — trust its ACTUAL resolved category. A legitimate
            // item from an unrelated category shouldn't be deleted just because its name happens to
            // contain a raw-scaffold keyword (e.g. a Furniture item literally named "...Platform...").
            const item = imsInventory.find(i => i.id === el.invId);
            const cat = String(item?.cat || item?.category || "").trim().toLowerCase();
            return !(RAW_SCAFFOLD_CATS.has(cat) && STRUCT_KW.test(el.name || ""));
          }
          // Unmatched/new proposal — no resolved category to check, so the name-keyword test is the
          // only signal available; keep it as a conservative backstop.
          return !STRUCT_KW.test(el.name || "");
        });
        // Backstop for the artificial-flower rule: an unmatched ("new") proposal has no resolved
        // inventory sub-category to check against taggableInv, only the AI's own guessed el.subCat —
        // drop it there too so a name that doesn't literally say "artificial" (e.g. "Mixed Green
        // Foliage Bundle") still can't sneak through as a brand-new/unreviewed element.
        parsed.elements = parsed.elements.filter(el => !ARTIFICIAL_SUBCAT.test(el.subCat || ""));
        // Merge duplicate elements that resolved to the SAME real inventory item/pattern (and same
        // size) — if Claude's own response lists the same physical item twice under different
        // phrasing (e.g. two separate "Pillar Candle" entries), both independently match and would
        // otherwise double-count qty with no warning. Keyed by invId/patternId + size so genuinely
        // different size variants of the same base item (e.g. a Small AND a Big flower pot) are NOT
        // collapsed together.
        if (parsed.elements.length > 1) {
          const mergedEls = [];
          const keyIndex = new Map();
          parsed.elements.forEach(el => {
            const key = (el.invId || el.patternId) ? `${el.invId || el.patternId}|${el.size || ""}` : null;
            if (key && keyIndex.has(key)) { mergedEls[keyIndex.get(key)].qty = (Number(mergedEls[keyIndex.get(key)].qty) || 0) + (Number(el.qty) || 0); return; }
            if (key) keyIndex.set(key, mergedEls.length);
            mergedEls.push({ ...el });
          });
          parsed.elements = mergedEls;
        }
        // An unmatched ("new") proposal has no real inventory item behind it — it never prices,
        // never blocks stock, and just sits in the Element Breakdown as an inert $0 placeholder row.
        // Fold it into "unrecognized" instead (the existing review-backlog list, already shown in the
        // "⚠ Needs attention" banner) so a reviewer still sees it was spotted (WITH its estimated qty,
        // so the count signal isn't lost), without it cluttering the actual priced element list.
        const newNames = parsed.elements.filter(el => el.new && el.name).map(el => el.qty > 1 ? `${el.name} (qty ~${el.qty})` : el.name);
        if (newNames.length) {
          const seenUnrec = new Set((parsed.unrecognized || []).map(s => String(s).toLowerCase()));
          newNames.forEach(n => { if (!seenUnrec.has(n.toLowerCase())) { parsed.unrecognized = [...(parsed.unrecognized || []), n]; seenUnrec.add(n.toLowerCase()); } });
        }
        parsed.elements = parsed.elements.filter(el => !el.new);
        // House-rule backstop (Rule 9): a lounge with sofas needs coffee tables — 1 per 3 sofas.
        // This is a deterministic "always add N" rule the model skips even when it correctly counts
        // the sofas in its own reasoning, so it's enforced in code (like the artificial-flower and
        // naming backstops) instead of trusting the prompt. Only 3+ sofas trigger it — the L-shaped
        // 2-sofa case (Rule 10) stays in the prompt since code can't see the seating layout. Tops up
        // only the shortfall so an already-tagged coffee table is never doubled.
        try {
          const SOFA_RE = /\bsofa\b/i, COFFEE_TABLE_RE = /\bcoffee table\b/i;
          const invById = (id) => imsInventory.find(i => i.id === id);
          const catOf = (el) => { const it = el.invId ? invById(el.invId) : null; return `${it?.subCat || it?.subcategory || ""} ${el.name || ""}`; };
          const qtyOf = (el) => Number(el.qty) || 1;
          const sofaCount = parsed.elements.filter(el => SOFA_RE.test(catOf(el))).reduce((n, el) => n + qtyOf(el), 0);
          const needed = Math.floor(sofaCount / 3);
          if (needed > 0) {
            const haveTables = parsed.elements.filter(el => COFFEE_TABLE_RE.test(catOf(el))).reduce((n, el) => n + qtyOf(el), 0);
            const shortfall = needed - haveTables;
            if (shortfall > 0) {
              // Scope to the "Coffee Table" sub-category first so a name match can't grab a
              // lookalike (e.g. "Moroccan pedestal / coffee table" filed under Florals/Pedestals);
              // fall back to a name match only if that sub-cat isn't taggable.
              const ctPool = taggableInv.filter(it => normalize(it.subCat || it.subcategory) === "coffee table");
              const ct = (ctPool.length && bestOf("Coffee Table", ctPool, it => it.name)) || bestOf("Coffee Table", taggableInv, it => it.name);
              if (ct) parsed.elements.push({
                name: ct.item.name, cat: ct.item.cat || ct.item.category || "", subCat: ct.item.subCat || ct.item.subcategory || "",
                qty: shortfall, unit: ct.item.unit || "pc", size: "", detail: "", invId: ct.item.id,
                matchMethod: ct.method, matchScore: Math.round(ct.score),
                _autoAdded: "house rule: 1 coffee table per 3 sofas",
              });
            }
          }
        } catch {}
        // Lightweight match-stats — no aggregate visibility existed into how often each dedup/match
        // tier actually fires; without it, tuning LOW_CONFIDENCE_BELOW/the 40% overlap floor is pure
        // guesswork. Persisted alongside _aiRawResponse so it can be queried/audited later.
        parsed._matchStats = {
          exact: parsed.elements.filter(el => el.matchMethod === "exact").length,
          substring: parsed.elements.filter(el => el.matchMethod === "substring").length,
          overlap: parsed.elements.filter(el => el.matchMethod === "overlap").length,
          lowConfidence: parsed.elements.filter(el => el.lowConfidence).length,
          unrecognized: (parsed.unrecognized || []).length,
        };
        // Per-photo AI confidence (0-100): a tag-TIME quality estimate, NOT verified accuracy. Averages
        // match strength across matched elements (exact=100, substring=90, overlap=its own %), counting
        // each "unrecognized" item as 0 — the AI saw something it couldn't place, which drags confidence
        // down for both weak matching and incompleteness. A reviewer still confirms the real tags.
        {
          // Prefer the model's OWN self-assessed confidence from the verify pass — it looked at the photo
          // and judged completeness/correctness, so it can account for MISSED items (which pure match-
          // quality cannot — that's why match-quality inflated to 100% on incomplete tags). Fall back to a
          // match-strength + completeness heuristic only when the verify pass didn't run.
          if (typeof parsed._verifyConfidence === "number") {
            parsed._aiConfidence = parsed._verifyConfidence;
          } else {
            const matched = parsed.elements.filter(el => el.invId || el.patternId);
            const scores = matched.map(el => (typeof el.matchScore === "number" ? el.matchScore : 90));
            const denom = scores.length + (parsed.unrecognized || []).length;
            parsed._aiConfidence = denom ? Math.round(scores.reduce((a, b) => a + b, 0) / denom) : (matched.length ? 100 : 0);
          }
        }
        // Scratch fields used only for the matching/dedup above — don't persist them onto the saved
        // element objects.
        parsed.elements.forEach(el => { delete el._origName; delete el.attachedTo; });
      }
      // Naming backstop — rule #11 (NAMING IS MANDATORY) is a written instruction, and instruction-
      // following isn't reliable (the whole reason several other fixes here moved to code instead of
      // prompt wording). If Claude still returns a blank/generic placeholder name, deterministically
      // build one from the tagged zone/style/hero-element data instead of letting the placeholder
      // through — strictly better than nothing, even though it can't match Claude's own visual judgment.
      const GENERIC_NAME_RE = /^(wedding decor|elegant setup|floral arrangement|event design|decor setup|event decor|décor)$/i;
      const isGenericName = (n) => !n || !String(n).trim() || GENERIC_NAME_RE.test(String(n).trim()) || String(n).trim().split(/\s+/).length < 3;
      if (isGenericName(parsed.name)) {
        const area = (parsed.tags?.areasElements || [])[0] || "";
        const style = (parsed.tags?.designStyle || [])[0] || "";
        const hero = (parsed.elements || []).filter(e => e && e.name && (e.invId || e.patternId)).sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0))[0];
        const parts = [area, style, hero?.name].filter(Boolean);
        if (parts.length) parsed.name = parts.join(" — ");
      }
      parsed._aiRawResponse = aiRawResponse;
      return parsed;
    } catch (e) { showMsg("Tag error: " + e.message, "red"); return null; }
  };

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
        const result = await Promise.race([aiTagImage(img.url), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 75000))]); // 75s: allows the two-call self-verify pass to finish
        // Shared merge — see applyAiTagResult (spec §9-B). Bulk paths add their own _aiFailed stamp.
        const { patch: upd, gotTags } = applyAiTagResult(img, result, { taxonomy, tagSource: TAG_SOURCE.MANUAL });
        if (gotTags) ok++;
        else { upd._aiFailed = true; upd._aiFailedAt = Date.now(); fail++; }
        patch[img.id] = upd;
      } catch { patch[img.id] = { _aiFailed: true, _aiFailedAt: Date.now() }; fail++; }
      setBulkTag({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
      flush(); // flush after EACH photo so it lands in the DB and surfaces in Needs review promptly — two-pass tagging is ~45s/photo, so the old batch-of-8 checkpoint delayed visibility by minutes (saveLib only upserts actually-changed rows, so re-flushing is cheap)
    }
    flush();
    const stopped = bulkTagStop.current;
    setBulkTag({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🤖 Done — ${ok} tagged, ${fail} failed. See Needs review.`, "green");
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
      const img = targets[n];
      try {
        const result = await Promise.race([aiTagImage(img.url), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 75000))]); // 75s: allows the two-call self-verify pass to finish
        // Shared merge — see applyAiTagResult (spec §9-B). Only marks "AI-tagged" when tags actually
        // landed; a failed/empty pass stays untagged (gotTags=false) so it's retried next run.
        const { patch: upd, gotTags } = applyAiTagResult(img, result, { taxonomy, tagSource: TAG_SOURCE.MANUAL });
        if (gotTags) ok++;
        else { upd._aiFailed = true; upd._aiFailedAt = Date.now(); fail++; }
        patch[img.id] = upd;
      } catch { patch[img.id] = { _aiFailed: true, _aiFailedAt: Date.now() }; fail++; }
      setBulkTag({ running: true, done: n + 1, total: targets.length, ok, fail, finishedAt: 0 });
      flush(); // flush after EACH photo so it lands in the DB and surfaces in Needs review promptly — two-pass tagging is ~45s/photo, so the old batch-of-8 checkpoint delayed visibility by minutes (saveLib only upserts actually-changed rows, so re-flushing is cheap)
    }
    flush();
    const stopped = bulkTagStop.current;
    setBulkTag({ running: false, done: targets.length, total: targets.length, ok, fail, finishedAt: Date.now() });
    showMsg(`🤖 AI tagging ${stopped ? "stopped" : "complete"} — ${ok} tagged, ${fail} failed/empty. Review them in Library → Needs review.`, "green");
    return { ok, fail };
  }, [aiTagImage, saveLib, showMsg, taxonomy, mergeLibItems]);

  // ── Recursive Storage folder import ─────────────────────────────────────────
  // Pulls EVERY image under a folder prefix (all subfolders, paginated) into the library,
  // deduped by URL so re-importing the same folder is safe (already-added photos are skipped —
  // no duplicates). Stamps each with the event (folder) name + best-effort zone from filename.
  const importCloudinaryFolder = useCallback(async (prefix) => {
    const eventName = (String(prefix || "").split("/").pop() || "Event");
    const zones = taxonomy.areasElements || [];
    const KW = { stage: "Stage", entry: "Entry Passage", passage: "Entry Passage", vedi: "Vedi", mandap: "Vedi", lounge: "Centre Lounge", "side lounge": "Side Lounge", photobooth: "Photobooth", "photo booth": "Photobooth", centrepiece: "Centre Pieces", "centre piece": "Centre Pieces", "center piece": "Centre Pieces", prop: "Props", install: "Installations" };
    const detectZone = (f) => { const s = f.toLowerCase(); let z = zones.find(zn => s.includes(zn.toLowerCase())); if (z) return z; for (const [k, zn] of Object.entries(KW)) { if (s.includes(k) && zones.includes(zn)) return zn; } return ""; };
    const seen = new Set();           // urls collected this run (dedupe within this scan)
    let scanned = 0;
    let fresh = [];
    try {
      // Breadth-first walk of the prefix. Storage has no folder entity — a folder is only implied
      // by the keys beneath it — so each level is one listing and subfolders come back as entries.
      const queue = [prefix];
      let guard = 0, visited = 0;
      while (queue.length && guard++ < 500) {
        const f = queue.shift();
        const { folders, images } = await storageEntries(f);
        folders.forEach(sub => queue.push(sub.path || `${f}/${sub.name}`));
        images.forEach(r => {
          if (!r.secure_url) return;
          scanned++;
          if (seen.has(r.secure_url)) return;
          seen.add(r.secure_url); fresh.push(r);
        });
        if (visited++ % 4 === 0) showMsg(`Scanning "${eventName}" — ${visited} folder(s), ${fresh.length} new so far…`, "blue");
      }
    } catch (e) { showMsg("Folder import failed: " + (e.message || "Storage error"), "red"); return null; }
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
  }, [storageEntries, saveLib, showMsg, taxonomy]);

  // ── Zone upload (Cloudinary → AI tag → review) — VERBATIM ──
  const handleZoneUpload = async (elKey, file) => {
    if (!file || zoneUploading) return;
    setZoneUploading(elKey);
    showMsg("📷 Uploading…", "blue");
    try {
      // Goes to Supabase Storage via the /functions/v1/upload Edge Function, which holds the
      // secret server-side. Storage has no unsigned-upload equivalent to Cloudinary's preset,
      // and the anon key is public in this bundle, so a direct client write would leave the
      // bucket open to anyone reading the JS.
      const compressed = await compressImageForUpload(file);
      let cldUrl;
      try {
        cldUrl = await uploadToStorage(compressed, STORAGE_FOLDERS.CLIENT);
      } catch (e) {
        showMsg("Upload failed: " + e.message, "red"); setZoneUploading(null); return;
      }
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
      // Full deselect means "nothing in this zone" — clear the truss/platform/carpet config too,
      // since it came from this same photo pick. Otherwise the zone reads as empty (no elements,
      // no photo selected) while still silently charging for a structure nobody can see is configured.
      setZoneConfig(p => { const n = { ...p }; delete n[elKey]; return n; });
      return;
    }
    setElSelectedPhoto(p => ({ ...p, [elKey]: photo }));
    // Scale By is a deal-specific "how many of this zone" multiplier (40 tables, say) — it has
    // nothing to do with WHICH reference photo is loaded. Browsing to a different centrepiece photo
    // used to silently drop it: the new photo's elements came in at their own raw (×1) baseQty and
    // zoneConfig[elKey] got wholesale-replaced by a fresh cfg that never carries `scale`, so the
    // Scale box kept showing its old number while the actual priced quantities quietly reset to 1×.
    // Carry the CURRENT live scale over onto the incoming photo's elements instead.
    const curScale = Math.max(1, Math.round(Number(zoneConfig[elKey]?.scale) || 1));
    if (photo.isLibrary && (photo.elements || []).length > 0) {
      // Strip any `baseQty` the photo's own saved elements happen to be carrying — "Correct & update
      // master" persists zoneElements verbatim, so a photo corrected while a zone was mid-scale can
      // have a stale baseQty baked in (e.g. 0.5, left over from a long-gone ÷2). A fresh photo pick
      // always derives its base from that photo's own qty, never an inherited one, or the very next
      // Scale edit multiplies the WRONG base and lands on a qty nobody asked for.
      const rawEls = JSON.parse(JSON.stringify(photo.elements)).map(({ baseQty: _drop, ...e }) => e);
      setZoneElements(p => ({ ...p, [elKey]: curScale > 1
        ? rawEls.map(e => { const base = Number(e.qty) || 0; return { ...e, baseQty: base, qty: Math.max(0, Math.round(base * curScale)) }; })
        : rawEls
      }));
    } else {
      setZoneElements(p => ({ ...p, [elKey]: [] }));
    }
    const libImg = photo.isLibrary ? libItems.find(i => i.url === photo.src || i.id === photo.eventId) : null;
    const photoDims = photo.dims || libImg?.dims || {};
    let cfg = buildZoneConfig(elKey, photoDims);
    // Full zone build spec saved by Build's "Correct & update master" — restore it verbatim
    // (dims, truss, masking, plinth, carpet, prints, materials, custom items…). Falls back to the
    // legacy partial-config restore for photos verified before full-config saving existed.
    const savedFull = libImg?.zoneConfigByType?.[elKey] || photo.zoneConfigByType?.[elKey] || null;
    if (savedFull) {
      cfg = { ...(cfg || {}), ...JSON.parse(JSON.stringify(savedFull)) };
    } else if (cfg) {
      const evZone = (photo.zones || []).find(z => z.type === elKey);
      if (evZone?.config) {
        cfg.trT = evZone.config.trT || cfg.trT;
        cfg.mkOn = evZone.config.mkOn ?? cfg.mkOn;
        cfg.mkT = evZone.config.mkT || cfg.mkT;
        cfg.mkWalls = evZone.config.mkWalls || cfg.mkWalls;
        cfg.plH = evZone.config.plH || cfg.plH;
        cfg.cpT = evZone.config.cpT || cfg.cpT;
      }
    }
    if (cfg) {
      // Same reason as above — scale/repeat are live deal choices, not part of what a reference
      // photo's config describes. Preserve them across the replace instead of losing them.
      setZoneConfig(p => ({ ...p, [elKey]: { ...cfg, scale: p[elKey]?.scale, repeat: p[elKey]?.repeat } }));
    }
    setActiveZones([]);
    setCustomMode(p => ({ ...p, [elKey]: false }));
  };

  // ── Multi-select element photos — Installations zone ONLY. Every other zone keeps the
  // single-photo-replaces-everything model above (selectElPhoto). A real installation is often
  // assembled from several reference pieces rather than one photographed "look", so this zone alone
  // is allowed to pick multiple photos and combine their elements into one build. elMultiPhotos is
  // intentionally session-local (not threaded through the snapshot/session save-restore paths that
  // elSelectedPhoto goes through) — zoneElements/zoneConfig, which DO persist normally, already
  // carry the actual combined pricing; only which tiles show as ticked would need re-deriving after
  // a reload, which is cosmetic, not a pricing bug.
  const [elMultiPhotos, setElMultiPhotos] = useState({}); // { [zoneKey]: Array<photo> }
  // SINGLE PHOTO EVERYWHERE. Installations was the one zone allowed to tick several photos and merge
  // their elements into one build — that is what put three tiles in the "Selected" state at once.
  // Commented out rather than deleted: restoring it is one line, and everything it drives
  // (toggleMultiElPhoto, elMultiPhotos, the "N photos selected" label, the grid-group seeding in
  // StudioBuild) is left intact behind this single gate.
  // Note this is NOT the same feature as the ▦ grid's pin-to-front ticks, which are back on for this
  // zone — those reorder the picker, they do not add anything to the build.
  // const isMultiPhotoZone = (label) => String(label || "").trim().toLowerCase() === "installations";
  const isMultiPhotoZone = () => false;
  const toggleMultiElPhoto = (elKey, photo) => {
    const photoKey = photo.eventId || photo.src;
    const current = elMultiPhotos[elKey] || [];
    const idx = current.findIndex(p => (p.eventId || p.src) === photoKey);
    if (idx >= 0) {
      // Deselect — drop only THIS photo's own contributed elements, leave the rest untouched.
      const nextPhotos = current.filter((_, i) => i !== idx);
      setElMultiPhotos(p => ({ ...p, [elKey]: nextPhotos }));
      setZoneElements(p => ({ ...p, [elKey]: (p[elKey] || []).filter(it => it._srcPhotoKey !== photoKey) }));
      const wasPrimary = elSelectedPhoto[elKey] && (elSelectedPhoto[elKey].eventId || elSelectedPhoto[elKey].src) === photoKey;
      if (!nextPhotos.length) {
        setElSelectedPhoto(p => { const n = { ...p }; delete n[elKey]; return n; });
      } else if (wasPrimary) {
        // The zone's truss/platform/print/dims config came from whichever photo was primary —
        // promote the next remaining one so exports/cost-sheet keep a representative photo, but
        // leave zoneConfig itself alone (nothing after the first photo ever touched it anyway).
        setElSelectedPhoto(p => ({ ...p, [elKey]: nextPhotos[0] }));
      }
      return;
    }
    // Select — append this photo's elements (tagged so a later deselect can pull exactly these back
    // out) instead of selectElPhoto's normal replace. Only the FIRST photo picked into an empty zone
    // seeds zoneConfig (truss/platform/print/dims); every one after that contributes elements only.
    const nextPhotos = [...current, photo];
    setElMultiPhotos(p => ({ ...p, [elKey]: nextPhotos }));
    // Strip any stray baseQty the photo's saved elements carry — see the matching note in
    // selectElPhoto; a photo corrected mid-scale can bake in a leftover ratio that has nothing to do
    // with this build.
    const tagged = (photo.isLibrary ? (photo.elements || []) : []).map(({ baseQty: _drop, ...it }) => ({ ...JSON.parse(JSON.stringify(it)), _srcPhotoKey: photoKey }));
    setZoneElements(p => ({ ...p, [elKey]: [...(p[elKey] || []), ...tagged] }));
    if (!current.length) {
      setElSelectedPhoto(p => ({ ...p, [elKey]: photo }));
      const libImg = photo.isLibrary ? libItems.find(i => i.url === photo.src || i.id === photo.eventId) : null;
      const photoDims = photo.dims || libImg?.dims || {};
      let cfg = buildZoneConfig(elKey, photoDims);
      const savedFull = libImg?.zoneConfigByType?.[elKey] || photo.zoneConfigByType?.[elKey] || null;
      if (savedFull) cfg = { ...(cfg || {}), ...JSON.parse(JSON.stringify(savedFull)) };
      if (cfg) setZoneConfig(p => ({ ...p, [elKey]: cfg }));
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
    const fVenue = fnData.fnVenue || "";
    return Object.entries(fEnabledEls).filter(([_, on]) => on).map(([k]) => {
      // Custom zones carry their name in `.name`, not `.label` — using the raw match here left
      // custom zone names showing blank in the PDF/PPT export.
      const customZoneMatch = fCustomZones.find(cz => cz.id === k);
      const el = zoneLabelsD[k] || (customZoneMatch ? { label: customZoneMatch.name, icon: customZoneMatch.icon || "📦" } : { label: k, icon: "📦" });
      const t = fElTiers[k] || "simple";
      const ze = fZoneElements[k];
      let items = [];
      if (ze && ze.length > 0) {
        ze.forEach(el2 => {
          const priceInfo = getElPriceForFn(el2, fZoneConfig[k], fFloralRatio, false, fVenue);
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
      const zl = fZoneConfig[k] ? calcStructCost(k, fZoneConfig[k], structRates) : { truss: 0, masking: 0, platform: 0, carpet: 0, total: 0, arches: 0, pillars: 0, glass: 0 };
      const structItems = [];
      const zc = fZoneConfig[k] || {};
      const zm = zoneMeta[k];
      const dims = zc.dims || {};
      const dimLabel = zm ? ["L", "W", "H"].map(d => `${dims[d] || 0}ft`).join(" × ") : "";
      // Footprint used by platform/carpet — a separate figure from the truss's own L×W×H (a platform
      // can be a different shape from the truss standing on it), same fallback calcStructCost uses.
      const floorDims = zc.floorDims || dims;
      const floorArea = (floorDims.L || floorDims.S || 0) * (floorDims.W || (floorDims.S || 0));
      const floorDimLabel = `${floorDims.L || floorDims.S || 0}×${floorDims.W || floorDims.S || 0}ft`;
      if (zl.truss > 0) {
        const _tShape = zc.trT === "box" ? "box" : "singleU";
        const _tRate = trussRateFor(_tShape, zc.trussMaterial, zc.drapeDensity, imsTrussRates);
        const _tHasCustomCeiling = _tShape === "box" && !!zc.customCeilingItemId;
        const _tEffRate = _tHasCustomCeiling ? Math.max(0, _tRate.rate - _tRate.ceilingRate) : _tRate.rate;
        const _tMatLabel = (TRUSS_MATERIALS.find((m) => m.key === (zc.trussMaterial || "iron"))?.label) || "Pole";
        const _tCeilingItem = _tHasCustomCeiling ? (imsInventory || []).find((i) => i.id === zc.customCeilingItemId) : null;
        // The two dims a truss is actually charged on (trussBaseArea — same authority calcStructCost's
        // trussRowCost uses), not the raw L×W×H: a Box charges its two LARGEST dims, a Single U charges
        // width×height. Doesn't account for the front-extension add-on (shown in the name text only) —
        // that's a second, smaller area on top, not part of this base sqft.
        const _tBase = trussBaseArea({ dims: zc.dims, trT: zc.trT });
        structItems.push({
          name: "Truss (" + (_tShape === "box" ? "Box" : "Single U") + " · " + _tMatLabel + " ₹" + _tEffRate + "/sqft)" + (_tCeilingItem ? ` · custom ceiling: ${_tCeilingItem.name}` : "") + (zc.trT === "box" && (Number(zc.trussFrontExt) || 0) > 0 ? ` + 2× Single-U front ext ${zc.trussFrontExt}×${Number(zc.trussFrontExtH) || dims.H || 0}ft` : "") + ((zc.trussQty || 1) > 1 ? " ×" + zc.trussQty : ""),
          size: `${_tBase.a || 0}×${_tBase.b || 0}ft`, qty: Math.round((_tBase.area || 0) * Math.max(1, zc.trussQty || 1) * 100) / 100, rate: _tEffRate, unit: "sqft",
          total: zl.truss,
        });
      }
      if (zl.masking > 0) {
        const _mCustomItem = zc.customMaskingItemId ? (imsInventory || []).find((i) => i.id === zc.customMaskingItemId) : null;
        structItems.push({ name: _mCustomItem ? `Wall Masking — custom: ${_mCustomItem.name}` : "Wall Masking — " + (zc.mkT || "fabric") + " ₹" + maskingRateFor(zc.mkT || "fabric", imsMaskingRates) + "/sqft (" + (zc.mkS || 1) + " side" + ((zc.mkS || 1) > 1 ? "s" : "") + ")", total: zl.masking });
      }
      if (zl.platform > 0) {
        const _pRate = platformRateFor(zc.plH, structRates.platformRates);
        structItems.push({
          name: "Platform (" + (zc.plH === "4in" ? "4 inch" : zc.plH === "1ft" ? "1ft–3ft" : zc.plH || "") + " ₹" + _pRate + "/sqft)",
          size: floorDimLabel, qty: Math.round(floorArea * 100) / 100, rate: _pRate, unit: "sqft",
          total: zl.platform,
        });
      }
      if (zl.carpet > 0) {
        const cp = carpetPricingFor(zc.cpT, imsCarpetMaterials);
        structItems.push({
          name: "Carpet (" + cp.label + " ₹" + cp.rate + "/sqft)",
          size: floorDimLabel, qty: Math.round(floorArea * 100) / 100, rate: cp.rate, unit: "sqft",
          total: zl.carpet,
        });
      }
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
  }, [getElPriceForFn, zoneLabelsD, zoneMeta, dealCheckData, imsDefaultPaintCost, dcCustomItems, structRates]);

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
        palette: fnData.fnPalette || "",
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

  // Warms activeBlocksForDate whenever the active function's date changes, so Build view's
  // per-element pricing and the header ESTIMATE badge can read availability synchronously
  // (getElPrice/calcElsCost are called inline during render — no per-element async fetch).
  useEffect(() => {
    const date = activeFnMeta?.date || clientDate || "";
    if (!date) { setActiveBlocksForDate({}); return; }
    let cancelled = false;
    loadAvailability(date).then(({ blocksForDate }) => { if (!cancelled) setActiveBlocksForDate(blocksForDate || {}); }).catch(() => { if (!cancelled) setActiveBlocksForDate({}); });
    return () => { cancelled = true; };
  }, [activeFnMeta?.date, clientDate, loadAvailability]);

  // Same warm-up, for every function's date — not just the active one. loadAvailability already
  // caches per date (availCacheRef), so re-fetching a date already warmed by the effect above (or by
  // a previous run of this one) is free. Runs whenever the set of dates in play changes: function 0's
  // date (clientDate) or any extra function's date.
  useEffect(() => {
    const dates = [...new Set([clientDate, ...(extraFunctions || []).map(f => f?.date)].filter(Boolean))];
    if (!dates.length) return;
    let cancelled = false;
    Promise.all(dates.map((d) => loadAvailability(d).then(({ blocksForDate }) => [d, blocksForDate || {}])))
      .then((pairs) => { if (!cancelled) setBlocksByDate(Object.fromEntries(pairs)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientDate, extraFunctions, loadAvailability]);

  // ═══ AVAILABILITY PICKER ═══ Moved here from StudioBuild.jsx so it's reachable from any view
  // (the Add Production/Buying Item modal lives in StudioModals.jsx, a sibling of Build) instead of
  // being duplicated. Behaviour is unchanged — same subcat resolution, same free-sorted item list.
  const openAvailModal = useCallback(async (zoneKey, idx, el, rc, onPick) => {
    const invItem = el?.invId ? (imsInventory || []).find(i => i.id === el.invId) : null;
    const subcat = (invItem ? (invItem.subCat || invItem.subcategory) : "") || (rc ? itemImsSubcat(rc) : "") || rc?.sub || "";
    const date = activeFnMeta?.date || clientDate || "";
    setAvailModal({ zoneKey, idx, elName: el?.name || "", subcat, date, loading: true, items: [], selectedId: el?.imsId || el?.invId || null, onPick: onPick || null });
    try {
      const { inventory, blocksForDate } = await loadAvailability(date);
      const target = String(subcat).toLowerCase().trim();
      const items = (inventory || [])
        .filter(it => String(it.subCat || it.subcategory || "").toLowerCase().trim() === target)
        .map(it => ({ id: it.id, name: it.name, photo: (Array.isArray(it.photoUrls) && it.photoUrls[0]) || it.img || "", free: getStudioAvailable(it, blocksForDate), price: priceForInvItem(it, rcFactorByKey, inventory), dims: itemDimsText(it) }))
        .sort((a, b) => b.free - a.free);
      setAvailModal(m => (m && m.zoneKey === zoneKey && m.idx === idx) ? { ...m, loading: false, items } : m);
    } catch { setAvailModal(m => m ? { ...m, loading: false } : m); }
  }, [imsInventory, activeFnMeta, clientDate, loadAvailability, getStudioAvailable, rcFactorByKey]);
  const saveAvailPick = useCallback(() => {
    if (!availModal) return;
    const { zoneKey, idx, selectedId, items, onPick } = availModal;
    const pick = (items || []).find(i => i.id === selectedId);
    if (onPick) { onPick(selectedId && pick ? pick : null); setAvailModal(null); return; }
    setZoneElements(p => {
      const elems = [...(p[zoneKey] || [])];
      if (!elems[idx]) return p;
      elems[idx] = (selectedId && pick)
        ? { ...elems[idx], invId: selectedId, name: pick.name || elems[idx].name, imsId: selectedId, imsName: pick.name || "", imsPhoto: pick.photo || "" }
        : (() => { const e = { ...elems[idx] }; delete e.imsId; delete e.imsName; delete e.imsPhoto; return e; })();
      return { ...p, [zoneKey]: elems };
    });
    setAvailModal(null);
  }, [availModal, setZoneElements]);

  // ═══ AVAILABILITY SPLIT ═══ A second mode on the same picker: instead of swapping the element to
  // ONE different item, divide its qty across 2+ chosen items from the same sub-category — e.g. 18
  // arches booked becomes 9 of one design + 9 of another, instead of hunting down 18 of a single
  // item that isn't actually free. Replaces the one element-breakdown line with one line per chosen
  // item. Splits as evenly as integer math allows; any remainder from an uneven split (20 into 3 →
  // 7/7/6, not 6/6/6 dropping 2) lands on the first few lines so the total booked qty never drifts
  // from what was there before the split. Not offered when this modal was opened via onPick (kit
  // component swap / CustomItemModal reference pick) — there's no "element with a qty" to divide there.
  const saveAvailSplit = useCallback((pickedIds) => {
    if (!availModal || availModal.onPick || !Array.isArray(pickedIds) || pickedIds.length < 2) return;
    const { zoneKey, idx, items } = availModal;
    setZoneElements(p => {
      const elems = [...(p[zoneKey] || [])];
      const original = elems[idx];
      if (!original) return p;
      const total = Number(original.qty) || 0;
      const n = pickedIds.length;
      const base = Math.floor(total / n);
      const remainder = total - base * n; // 0..n-1 leftover units, handed one each to the first `remainder` lines
      // Same scale math as Build's own applyQty — a split line stays correctly proportioned the
      // next time this zone's Scale By changes, instead of freezing at whatever qty it was split at.
      const scale = Math.max(1, Math.round(Number(zoneConfig[zoneKey]?.scale) || 1));
      const splitEls = pickedIds.map((id, i) => {
        const pick = (items || []).find((it) => it.id === id);
        const qty = base + (i < remainder ? 1 : 0);
        return {
          ...original,
          invId: id, imsId: id,
          name: pick?.name || original.name, imsName: pick?.name || "", imsPhoto: pick?.photo || "",
          qty, baseQty: scale > 1 ? qty / scale : qty,
        };
      });
      elems.splice(idx, 1, ...splitEls);
      return { ...p, [zoneKey]: elems };
    });
    setAvailModal(null);
  }, [availModal, setZoneElements, zoneConfig]);

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
  // `skipAi` runs the matcher deterministically — knowledge + name-match only, no vision calls.
  // That mode is free and repeatable, so it neither consumes the run allowance nor needs a limit
  // check; only a real AI run does.
  const runDealCheckGenerate = useCallback(async (fnIdxFilter = null, { skipAi = false } = {}) => {
    const cli = clientLedger.find(c => c.id === activeClientId);
    if (!cli) { if (!skipAi) showMsg("No active client", "red"); return { ok: false, error: "no-client" }; }
    const isSold = cli.status === "booked";
    const counterKey = activeClientId;
    const cur = dcRunCounter[counterKey] || { preSold: 0, postSold: 0, isSold: false };
    const limit = 999;  // TESTING — revert to 2 after testing complete
    const usedNow = isSold ? cur.postSold : cur.preSold;
    if (!skipAi && usedNow >= limit) {
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
    if (!skipAi) {
      const nextCounter = {
        ...cur,
        isSold,
        preSold: isSold ? cur.preSold : (cur.preSold + 1),
        postSold: isSold ? (cur.postSold + 1) : cur.postSold,
      };
      const nextAllCounters = { ...dcRunCounter, [counterKey]: nextCounter };
      setDcRunCounter(nextAllCounters);
      try { await reliableSave(DC_RUN_COUNTER_SK, JSON.stringify(nextAllCounters)); } catch {}
    }
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
        const specs = getCardSpecsForZone(zoneElems, zoneKey, photoUrl, floralHardPropMap, rcItems, imsInventory);
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
            } else if (skipAi) {
              // Deterministic mode: knowledge and name-match only. Anything they cannot resolve is
              // left as "no-match" rather than guessed at, so Deal Check shows exactly the elements
              // that were selected and says plainly which ones still need an item picked.
              source = "no-match"; cardsUnmatched += 1;
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

  // Fill Deal Check from the build as soon as it opens, deterministically. The Generate button that
  // used to do this is gone, and matching is free in this mode (knowledge + name-match, no vision
  // calls), so there is nothing to gate it behind — it just mirrors whatever the build currently
  // says. Runs after openDealCheck has loaded IMS, and only once per open.
  const dcAutoFilledRef = useRef(false);
  useEffect(() => {
    if (!dcFullPageOpen) { dcAutoFilledRef.current = false; return; }
    if (dcAutoFilledRef.current || dealCheckLoading || !activeClientId) return;
    dcAutoFilledRef.current = true;
    runDealCheckGenerate(null, { skipAi: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcFullPageOpen, dealCheckLoading, activeClientId]);

  // ═══════════════════════════════════════════════════════════════
  // STYLES + THEME
  // ═══════════════════════════════════════════════════════════════
  // Manage used to render dark while Studio rendered light, so switching between them flipped the
  // whole palette mid-session. One light theme throughout now. `isDark` stays as the switch every
  // component already reads — the dark branches are kept, just never taken, so restoring a dark
  // mode later is this one line rather than a rewrite.
  // ═══ SAFARI'S TOOLBAR ═══
  // iOS Safari paints its own chrome above the page and draws a hairline under it once you scroll.
  // Against the header's ink that hairline reads as a dark GAP between the browser and the app —
  // it isn't one, nothing shows through it, but nothing had told Safari what colour this page is.
  // theme-color tints the chrome to match the header, so the seam stops registering as an edge.
  // Restored on unmount, or IMS — whose header is light — would be left wearing Studio's ink.
  useEffect(() => {
    const existing = document.querySelector('meta[name="theme-color"]');
    const prev = existing?.getAttribute("content") ?? null;
    const tag = existing || document.head.appendChild(
      Object.assign(document.createElement("meta"), { name: "theme-color" }),
    );
    tag.setAttribute("content", "#0F0F1A");
    return () => { if (prev !== null) tag.setAttribute("content", prev); else tag.remove(); };
  }, []);

  const isDark = false;
  const S = makeS(isDark);
  // Event Info (step 0) runs chrome-free: it's where a deal is STARTED, so the bar above it offers
  // nothing you can act on — three of its four step chips are inert until this form is filled.
  // NOTE: this also takes sign-out, the Studio↔IMS switch, Manage and Deal Check off the screen you
  // land on after login. They come back at step 1, so the way to reach them is Continue. Held back
  // while `restoring`, because a refresh sits on step 0 for a beat before snapping to the real step
  // — hiding the bar then would read as a flash. Every other step keeps the full header.
  const bareEventInfo = mode === "studio" && step === 0 && !restoring;
  const accent = "#C9A96E";
  const border = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textS = isDark ? "#6B7280" : "#8b8fa3";
  const cardBg = isDark ? "#1A1A2E" : "#fff";
  const textP = isDark ? "#E5E5E5" : "#1a1a2e";
  const accentBg = isDark ? "rgba(201,169,110,0.12)" : "#F5F0FF";
  const accentText = isDark ? "#C9A96E" : "#6D28D9";

  // Header chip factory — needs `accent`, so it lives here rather than at module scope.
  // The inactive label was rgba(255,255,255,0.55) — around 4:1 on this bar, and it read as disabled
  // rather than as "the other option". Lifted to 0.74, and the active chip's fill doubled so the
  // selected one still clearly leads. Both weights are 600 now (see NAV_CHIP_BASE); the difference
  // between them is colour and fill, which is a stronger signal than half a weight step.
  const navChip = (active) => ({
    ...NAV_CHIP_BASE,
    cursor: "pointer",
    fontWeight: active ? 700 : 600,
    background: active ? `${accent}2E` : "transparent",
    color: active ? accent : "rgba(255,255,255,0.74)",
    ...(active ? { boxShadow: `inset 0 0 0 1px ${accent}3D` } : null),
  });

  // ═══════════════════════════════════════════════════════════════
  // CTX BAG — single object literal passed to view slices in later commits.
  // Comprehensive: every state var, setter, and pricing/save helper a view might need.
  // ═══════════════════════════════════════════════════════════════
  // Apply a reviewed client-photo upload to its zone (verbatim from reference).
  const applyZoneUpload = () => {
    const r = zoneUploadReview; if (!r) return;
    const libId = "LIB" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    // A custom ("Other") zone isn't in the taxonomy the Areas & elements chips offer, so there was
    // no way to tag a photo INTO one — picking "Lounge" or any fixed chip never surfaced it there.
    // The zone selector at the top of this modal already says exactly where this photo belongs, so
    // tag it there automatically — by the zone's own generated id (tags.customZoneIds), NOT its
    // display name, so an unrelated deal's differently-instantiated zone that happens to share the
    // same name never inherits this photo. Whatever else was picked in Areas & elements still
    // applies too — this only adds a private channel, it never touches the visible tags.
    const customOther = customZones.find((cz) => cz.id === r.elKey && !cz.sourceType);
    const tags = customOther
      ? { ...r.tags, customZoneIds: [...new Set([...(r.tags?.customZoneIds || []), customOther.id])] }
      : r.tags;
    const libImg = { id: libId, url: r.url, name: r.name, tags, elements: r.elements, dims: r.dims, prints: r.prints || [], addedAt: Date.now(), source: "client-upload", tagSource: TAG_SOURCE.BUILD, _aiTagged: true, _aiTaggedAt: Date.now() };
    // NOT mergeLibItems first: that writes libItemsRef, which is exactly what saveLib diffs against
    // to decide what changed. Pre-merging made saveLib compare the new photo to itself, find no
    // difference, and skip the upsert entirely — so every Build upload since this was written lived
    // in local state only and vanished on refresh. saveLib already merges into the ref and state.
    saveLib([libImg]);
    logActivity("uploaded client photo", libImg.name + " → " + (zoneLabelsD[r.elKey]?.label || r.elKey));
    // A custom ("Other") zone that already has a photo selected — a second upload joins it as
    // another option in the gallery (tagged above, same as the first) instead of silently swapping
    // the zone's active pricing/elements to whatever the fresh upload happened to detect. The
    // salesperson clicks it, like any other tile, when they actually want to switch to it.
    if (customOther && elSelectedPhoto[r.elKey]) {
      showMsg("✓ Added another photo to " + (customOther.name || zoneLabelsD[r.elKey]?.label || "this zone") + " — click it in the gallery to price from it", "green");
      setZoneUploadReview(null);
      return;
    }
    const photo = { src: r.url, eventName: libImg.name, isLibrary: true, eventId: libId, elements: libImg.elements, dims: libImg.dims, fn: "", space: "", zones: [] };
    selectElPhoto(r.elKey, photo);
    if (r.dims) {
      const cfg = buildZoneConfig(r.elKey, r.dims);
      if (cfg) {
        setZoneConfig(p => ({ ...p, [r.elKey]: { ...cfg, prints: r.prints || [] } }));
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
    activeClient, meetingNumber, allInhouseVenues, allOutdoorDB, allInhouseGroups, subVenuesOfParent, inhouseParentNames, allInhouseVenueOrParentNames, leafInhouseVenues,
    allVenueData, outdoorVenueList, browseVideos, browseVideosAll, allVideos,
    // handlers
    loadClientSession, startNewDeal, loadLmsLead, autoPersistCustomVenue, pickAndLoad, pickAndLoadFromVideo,
    loadedClientIdentityRef, confirmClientRename, revertClientNameEdit,
    resumeSavedSession, toggleEl, selectElPhoto, handleZoneUpload, aiTagImage, findTemplate,
    getLibPhotosForZone, maxRepaintCostInSubcat, saveSession, markSold, loadEvent,
    buildZonesForFn, buildCombinedCostSheetData, logActivity, saveTR,
    normalizePaintAllocation, paintPillLabel, isSubcatPaintable,
    lmsCacheRef,
    // zone photo filters + upload
    zpFilterOpen, setZpFilterOpen, zpFilters, setZpFilters, zpToggleFilter, zpHasFilters, zpFilterPhoto, zpVenueMatch, zpPaletteMatch,
    zpVenueTypeMatch, zpDesignStyleMatch, zpTimeSettingMatch,
    zoneUploading, setZoneUploading, zoneUploadReview, setZoneUploadReview, zurElSearch, setZurElSearch, applyZoneUpload,
    // auth
    authUser, isAdmin, hasPerm, doLogout, teamData, setTeamData, userVenueScope, studioSettingsAllowed, studioLibraryAllowed,
    // app mode + steps
    mode, setMode, step, setStep, manageTab, setManageTab, toast, setToast, showMsg, askConfirm, askConfirmAsync, loaded, setLoaded, saveError, setSaveError,
    // events
    events, setEvents, editEv, setEditEv, save, filteredEvents,
    // admin / library state
    photoUrl, setPhotoUrl, evEditPhotoIdx, setEvEditPhotoIdx, tagInput, setTagInput, bulkUrls, setBulkUrls,
    bulkTarget, setBulkTarget, adminSearch, setAdminSearch, adminFilterV, setAdminFilterV, adminFilterC, setAdminFilterC, previewImg, setPreviewImg,
    libView, setLibView, settingsView, setSettingsView,
    calYear, setCalYear, calMonth, setCalMonth, calSelDate, setCalSelDate, calEditMode, setCalEditMode, calSelectedDates, setCalSelectedDates,
    calLmsData, setCalLmsData, calView, setCalView, calSeasonData, setCalSeasonData,
    ctFilterSp, setCtFilterSp, ctFilterStatus, setCtFilterStatus, ctFilterFrom, setCtFilterFrom, ctFilterTo, setCtFilterTo, ctExpandedId, setCtExpandedId,
    taxonomy, setTaxonomy, saveTax, libItems, setLibItems, saveLib, mergeLibItems, ensureLibItems, ensureLibItemsByUrl, corrLog, logVerificationEvent, refreshCorrLog, tagKB, rebuildTagKB, tagCorrections, refreshTagCorrections, bulkTag, runBulkTag, stopBulkTag, runTagSelected, bulkVid, runBulkTagVideos, stopBulkTagVideos, bulkVidVenue, runBulkTagVideoVenues, stopBulkTagVideoVenues, importCloudinaryFolder, libSearch, setLibSearch, libFilters, setLibFilters,
    libVenueGroup, setLibVenueGroup, libVenueNames, setLibVenueNames, libEditImg, setLibEditImg, zoneElements, setZoneElements,
    libAiLoading, setLibAiLoading, zoneAiFilling, setZoneAiFilling, zoneElSearch, setZoneElSearch,
    zonePrintSearch, setZonePrintSearch,
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
    activeFnIdx, setActiveFnIdx, activeFnMeta, fnBuilds, setFnBuilds, isFnSwitching, ledgerReady,
    deleteSessionRows,
    showClientForm, setShowClientForm, clientLedger, setClientLedger, saveClientLedger, activeClientId, setActiveClientId, clientSearch, setClientSearch,
    snapshotBuildState, restoreBuildState, switchActiveFn, fnSnapHasData, fnSnapHasBuild,
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
    elMultiPhotos, isMultiPhotoZone, toggleMultiElPhoto,
    customZones, setCustomZones, newCzSrc, setNewCzSrc, elGallery, setElGallery, galleryIdx, setGalleryIdx, webPreview, setWebPreview,
    zoneConfig, setZoneConfig, activeZones, setActiveZones,
    floralRatio, setFloralRatio, floralOverrides, setFloralOverrides,
    customTripRate, setCustomTripRate, venueCustom, setVenueCustom, customGensets, setCustomGensets, genset62, setGenset62, gensetRate62,
    sourceEvent, setSourceEvent, sourceVideo, setSourceVideo,
    // inspiration / AI / PPT
    inspQ, setInspQ, inspResults, setInspResults, inspLoading, setInspLoading, aiPrompt, setAiPrompt, aiResult, setAiResult, aiLoading, setAiLoading,
    pptLoading, setPptLoading, pptDone, setPptDone, savedInsps, setSavedInsps, copied, setCopied,
    pinResults, setPinResults, pinLoading, setPinLoading, pinQuery, setPinQuery, inspSource, setInspSource,
    // rate card / transport — read-only now (legacy pricing fallback + category/sub-category
    // labels several screens still read); the human editors and their save paths are gone (see the
    // rcItemsRef comment above).
    rcItems, setRcItems, rcCats, setRcCats,
    TC_UNITS, RC_CATS_DEFAULT,
    // IMS inventory — Library "+Add element" sources from here now, not the Rate Card
    imsInventory, getElPriceFromInventory,
    // Print material rates (IMS Admin → Settings → 🖨️ Print Materials) — Library's per-element Print section
    imsPrintMaterials, imsCarpetMaterials,
    // Truss & masking rates (IMS Admin → Settings → 🏗️ Truss & Masking Rates) + the bundled object
    // passed to calcStructCost everywhere
    imsTrussRates, imsMaskingRates, imsPlatformRates, structRates,
    // Pure flower-recipe elements with no inventory backing (e.g. "Flower Garden") — addable
    // alongside inventory items, priced straight from the recipe
    recipeOnlyPatterns, getElPriceFromPattern,
    // Sub-category scaling factor + cost% (rate_card_categories, IMS-owned) — Deal Check's
    // unavailable-shortfall pricing builds its own lookup map from this.
    rcSubcatFactors, rcFactorByKey,
    // Sub-category default floral pricing mode — DCFloralsTab.jsx's resolveRealPct consumes this
    // pre-built map directly rather than re-deriving it from rcSubcatFactors itself.
    rcFloralModeByKey,
    trVenues, setTrVenues, truckCap, setTruckCap, floralPerTruck, setFloralPerTruck, gensetRate, setGensetRate, bufferTiers, setBufferTiers,
    newVenue, setNewVenue, newTC, setNewTC, TR_TIERS,
    // templates
    templates, setTemplates, saveTpl, tplEdit, setTplEdit, tplTab, setTplTab,
    // zones
    zoneGroups, writeZoneGroup,
    zoneDefs, setZoneDefs, saveZD, zoneMeta, zoneKeys, zoneLabelsD, zdEditZone, setZdEditZone,
    // premia (read-only gate — editor removed)
    premiaConfig, premiaGate, setPremiaGate, isPremiaPlatinum, PREMIA_DEFAULTS,
    // youtube
    ytVideos, setYtVideos, ytPlaylists, setYtPlaylists, ytLoading, setYtLoading, ytSearch, setYtSearch, ytFilterPL, setYtFilterPL,
    loadAllYT, searchYT, fetchYTPlaylist, untaggedVideoCount,
    ytPicker, setYtPicker, ytLastFetch, setYtLastFetch, ytVideoTags, setYtVideoTags, saveYtTags, ytTagEdit, setYtTagEdit,
    tagVenueGroup, setTagVenueGroup, tagOutsideSub, setTagOutsideSub, aiTaggingVideo, setAiTaggingVideo, aiVideoDraft, setAiVideoDraft,
    ytFilterVenue, setYtFilterVenue, ytFilterFn, setYtFilterFn, ytFilterTier, setYtFilterTier, ytFilterLinked, setYtFilterLinked,
    ytFilterStyle, setYtFilterStyle, ytFilterColor, setYtFilterColor, ytFilterIO, setYtFilterIO, ytPhotoUrl, setYtPhotoUrl,
    manualVideos, setManualVideos, hiddenVideos, setHiddenVideos, showHidden, setShowHidden, lastVisitTs, setLastVisitTs,
    saveManualVideos, saveHiddenVideos, aiTagVideo, aiTagVideoSave, getPhotos, ZONE_ICONS,
    favVideos, saveFavVideos, favPhotos, saveFavPhotos,
    // cloudinary photo browser
    cldOpen, setCldOpen, cldFolders, setCldFolders, cldPath, setCldPath, cldImages, setCldImages, cldLoading, setCldLoading,
    cldUploading, setCldUploading, cldUploadProgress, setCldUploadProgress, cldUploadRef, cldFolderUploadRef,
    cldSelectMode, setCldSelectMode, cldSelected, setCldSelected, cldDeleting, setCldDeleting,
    fetchCldFolders, cldNavigate, cldGoBack, handleCldUpload, handleCldBulkDelete, handleCldDeleteFolder,
    // cloudinary video browser
    addVideoOpen, setAddVideoOpen, cldVideoFolders, setCldVideoFolders, cldVideoPath, setCldVideoPath,
    cldVideoList, setCldVideoList, cldVideoLoading, setCldVideoLoading,
    openCldVideoBrowser, cldVideoNavigate, cldVideoGoBack, addCldVideo,
    // notifications
    notifications, setNotifications, notifOpen, setNotifOpen, notifLastRead, setNotifLastRead, unreadCount, markAllRead,
    filterPriority, setFilterPriority, saveFilterPriority,
    // tagging-hidden sub-categories (Pricing flags)
    tagHiddenSubs, isSubTagHidden, toggleTagHiddenSub,
    // deal check
    dealCheckData, setDealCheckData, dealCheckLoading, setDealCheckLoading, dealCheckError, setDealCheckError, catDeptMap, saveCatDeptMap,
    // mount-loaded fallbacks so Build works before Deal Check opens (fixed-venue Repeat chip, floral auto-derive)
    studioFloralData, venueParents,
    imsColourCatalogue, setImsColourCatalogue, imsPaletteCatalogue, setImsPaletteCatalogue, paletteCatalogueLoaded, imsPaintableCategories, setImsPaintableCategories,
    imsDefaultPaintCost, setImsDefaultPaintCost, savePaletteData, paintPickerTarget, setPaintPickerTarget, fabricPickerTarget, setFabricPickerTarget,
    dcPhotoOverrides, setDcPhotoOverrides, dcSkipped, setDcSkipped, dcProductionAccepted, setDcProductionAccepted, dcManualItems, setDcManualItems,
    dcManualSearch, setDcManualSearch, dcDedupOverrides, setDcDedupOverrides, dcBlockedFnOpen, setDcBlockedFnOpen, dcBlockedSubOpen, setDcBlockedSubOpen,
    dcFloralExpanded, setDcFloralExpanded, dcFloralUnmatchedExpanded, setDcFloralUnmatchedExpanded, dcResolved, setDcResolved, dcResolving, setDcResolving, dcAbortRef, setDcAbortRef,
    dcFullPageOpen, setDcFullPageOpen, dcCards, setDcCards, dcZoneState, setDcZoneState, dcKitEdits, setDcKitEdits, dcCarpetPick, setDcCarpetPick,
    dcCarpetSearch, setDcCarpetSearch, dcDesiredMargin, setDcDesiredMargin, dcRunCounter, setDcRunCounter, dcCache, setDcCache, dcGenerating, setDcGenerating,
    dcGenStatus, setDcGenStatus, dcActiveTab, setDcActiveTab, dcShowAllFns, setDcShowAllFns, dcCollapsedFnBlocks, setDcCollapsedFnBlocks, dcMpOverrides, setDcMpOverrides, dcMpWinCount, setDcMpWinCount, dcMpIncludeMinusOne, setDcMpIncludeMinusOne,
    dcMpIncludeDismantle, setDcMpIncludeDismantle, dcMpCalcOpen, setDcMpCalcOpen, dcFloralCalcOpen, setDcFloralCalcOpen, dcCollapsedZones, setDcCollapsedZones,
    floralHardPropMap, setFloralHardPropMap, softHolds, setSoftHolds, trussAlloc, setTrussAlloc, dcAmendDiff, setDcAmendDiff, dcSavingDraft, setDcSavingDraft,
    amendRequests, submitAmendRequest, isLastMinute, makeAmendRequest,
    dcInventoryCache, setDcInventoryCache, dcBrowseAllOpen, setDcBrowseAllOpen, dcSwapModal, setDcSwapModal, dcColorModal, setDcColorModal,
    photoKnowledge, saveKnowledgeEntry, dcKnowledgeKey,
    dcArtFlowerAlloc, setDcArtFlowerAlloc, dcArtFlowerModal, setDcArtFlowerModal, dcFloralColorPrefs, setDcFloralColorPrefs, dcPrefModal, setDcPrefModal,
    dcCustomItems, setDcCustomItems, dcCustomModal, setDcCustomModal,
    availModal, setAvailModal, openAvailModal, saveAvailPick, saveAvailSplit,
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
    // per-date "other events" block map for the active function's date — see getStudioAvailable
    activeBlocksForDate,
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
      {/* The Google Fonts link moved to index.html — see the note there. It was in this tree, so
          every re-render of StudioApp reconciled it and the serif headings flashed their fallback
          for a frame. Playfair Display + Cinzel are the display faces the client decks are already
          set in (see SERIF/DISPLAY in StudioSummary); Event Info borrows them so the screen a deal
          is started on and the deck it ends as read as the same brand. */}
      <style>{`* { font-family: 'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif !important; } h1,h2,h3 { font-family: 'Plus Jakarta Sans', 'Outfit', system-ui, sans-serif !important; } input,select,textarea,button { font-family: 'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif !important; }
        /* Toast entrance — keeps the translateX(-50%) centring in both frames, so the resting
           inline transform matches the animation's end state and there's no snap on completion. */
        @keyframes studioToastIn { from { opacity: 0; transform: translate(-50%, -14px) } to { opacity: 1; transform: translate(-50%, 0) } }
        @keyframes studioDlgFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes studioDlgPop { from { opacity: 0; transform: scale(0.94) translateY(8px) } to { opacity: 1; transform: none } }
        /* Shared spinner — the function pills and the build's switching veil both use it. */
        @keyframes saRestoreSpin { to { transform: rotate(360deg) } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes studioToastIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes studioDlgPop { from { opacity: 0 } to { opacity: 1 } }
        }

        /* ══════════════ TABLET ══════════════
           Two breakpoints, chosen off real viewports rather than round numbers:
             <= 1180px  landscape (iPad 1180x820, iPad Pro 11" 1194, older iPad 1024x768)
             <=  840px  portrait  (iPad 820x1180, iPad mini 744, older iPad 768x1024)
           Studio is inline-styled, so these hook onto classes added to the layout containers
           rather than restyling elements directly. Everything here is layout only — no colour,
           no type family — so a tablet gets the same design, laid out for its width.

           S.main caps at 1200 and centres, so the content column itself never needed capping;
           what breaks on a tablet is the header (three zones competing on one row), fixed side
           rails, and grids with hard column counts. */
        /* Only steps you can actually reach light up. An unreachable one that highlights on hover
           promises a click that does nothing. */
        .sa-step-on:hover { background: rgba(255,255,255,0.07) !important; color: #fff !important; }

        /* ══ THE SHEEN ══
           A slow gradient drifting across the bar, in place of the wave bands that were here. Waves
           have a shape, and a shape in a 60px strip has to move fast and sit bright to read at all —
           at which point it competes with the one row of controls the whole app navigates by. A
           gradient has no shape to notice: it only changes the colour of the light on the surface,
           which is the part that felt premium without ever asking to be looked at.
           z-index -1 puts it above the header's own background and below everything in it. Safe
           here precisely because the header HAS a background of its own.
           Violet and gold because the bar's own gradient already runs to violet and the accent is
           gold — this moves the light that is in the surface rather than adding a new colour to it. */
        /* ── TWO ELEMENTS, BECAUSE ONE OF THEM IS MASKED AND THE OTHER MOVES ──
           This drifted by animating background-position, which is a PAINT property: the layer is
           re-rasterised on every frame, forever, on every page. On its own that was affordable. Then
           a mask went on the same element (see the note below it) and the two multiplied — a masked
           layer has to be re-composited every time it repaints, so the bar was doing full-width
           paint plus mask compositing at 60fps for the life of the tab. That is what was flickering
           the whole UI on Mac, and it was mine.
           Split now. The outer box is STATIC and owns the mask and the clipping, so the mask is
           computed once. The inner ::before owns the gradient and drifts on TRANSFORM, which the
           compositor moves without repainting anything. Same motion, same look, no per-frame paint.
           230% wide and travelling -56.5% of itself reproduces exactly the old 0%→100% background
           travel: 130 of the 230 is offscreen, and 130/230 is 56.5. */
        .sa-sheen { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
        .sa-sheen::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 230%;
          background: linear-gradient(100deg,
            rgba(124,92,214,0) 0%,
            rgba(124,92,214,0.26) 20%,
            rgba(201,169,110,0.15) 45%,
            rgba(124,92,214,0.24) 68%,
            rgba(124,92,214,0) 100%);
          will-change: transform;
          animation: saSheen 26s ease-in-out infinite alternate; }
        /* 26s. There is nothing with an edge here, so slow is free — the eye never catches it moving,
           it just finds the bar a slightly different colour than a minute ago. */
        @keyframes saSheen { from { transform: translateX(0) } to { transform: translateX(-56.5%) } }
        @media (prefers-reduced-motion: reduce) { .sa-sheen::before { animation: none; will-change: auto } }
        /* ── THE SHEEN MUST NOT START WITH AN EDGE ──
           On Browse and Build the bar is transparent across the panel so the panel shows through, and
           the sheen is pushed over to begin at the panel's edge (see the .sa-sheen override in those
           views). Beginning there is the problem: this gradient is 230% wide and drifting, so at any
           moment its left edge is at whatever strength the drift has reached — up to 0.26 of violet —
           and it lands as a bright vertical line on the exact seam where the panel meets the bar.
           That is the step: not the panel against the bar, but the sheen against its own absence.
           Masked so it comes up from nothing over 160px. The sheen still crosses the whole bar and
           still drifts; it just no longer announces where it starts. Defined here, next to the sheen
           itself, rather than in both views — one bar, one rule.
           Prefixed too: this is a mask on an animated layer, which is exactly where Safari still
           wants -webkit-. */
        :root[data-sb-rail="1"] .sa-sheen {
          -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,0) 0, rgba(0,0,0,1) 160px);
          mask-image: linear-gradient(90deg, rgba(0,0,0,0) 0, rgba(0,0,0,1) 160px); }

        @media (max-width: 1180px) {
          .sa-header { padding: 10px 14px !important; gap: 8px !important; }
          .sa-nav-left { gap: 10px !important; }
          .sa-nav-right { gap: 8px !important; }

          /* Three zones cannot share this row, and failing to fit does NOT wrap them — it overlaps
             them. The outer zones are flex:1 1 0 with min-width:0, which lets them shrink below
             their own content; the account cluster is justify-content:flex-end, so its overflow
             runs LEFT and prints on top of the step nav. Wrapping never gets a chance because the
             zones report as fitting.
             So: give the step nav its own full-width row, and stop the outer two shrinking past
             their content. order/flex-basis rather than reordering the JSX, so the DOM order — and
             with it the tab order — still reads brand, steps, account. */
          .sa-nav-left  { flex: 0 1 auto !important; min-width: 0 !important; }
          .sa-nav-right { flex: 1 1 auto !important; min-width: 0 !important; }
          .sa-nav-mid   { order: 3; flex: 1 0 100% !important; justify-content: center; min-width: 0; }
          /* The step nav is the one thing that must never be clipped — it's how you move through
             the deal. Let it scroll sideways rather than shrink the hit targets below thumb size. */
          .sa-nav-mid > div { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
          .sa-nav-mid > div::-webkit-scrollbar { display: none; }
        }
        @media (max-width: 840px) {
          /* Portrait: row 1 is brand + account only, and it is still tight. Chips shed horizontal
             padding before they shed legibility — the type stays at NAV_FS. */
          .sa-header { padding: 9px 11px !important; }
          .sa-nav-left, .sa-nav-right { gap: 6px !important; }
          .sa-nav-right > div, .sa-nav-mid > div { padding: 2px !important; }
        }`}</style>

      {/* SAVE FAILURE BANNER */}
      {saveError && (
        <div style={{ position: "fixed", top: 8, right: 8, zIndex: 100000, background: "#dc2626", color: "#fff", padding: "12px 14px", borderRadius: 8, fontSize: 13, maxWidth: 380, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", border: "1px solid #991b1b" }}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><span>❌</span> Save Failed: {saveError.label}</div>
          <div style={{ fontSize: 12, opacity: 0.95, marginBottom: 6, lineHeight: 1.4 }}>{saveError.error}</div>
          <button onClick={() => setSaveError(null)} style={{ background: "#fff", color: "#dc2626", border: "none", padding: "5px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}

      {/* TOAST — pinned top-centre. zIndex clears the sticky header (50), and the slide-down
          entrance reads as arriving from the top edge rather than just appearing. */}
      {toast && (
        <div role="status" aria-live="polite" style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 100000, padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.28)", animation: "studioToastIn 0.22s ease-out", background: toast.color === "red" ? "#dc2626" : toast.color === "green" ? "#16a34a" : "#374151" }}>{toast.msg}</div>
      )}

      {/* CONFIRM DIALOG — centred on screen over a dimmed backdrop, so a destructive question stops
          the eye instead of arriving as a pill that reads like a status message. Backdrop click and
          Escape both cancel; only the red button commits. */}
      {confirmToast && (
        <div onClick={() => closeConfirm(false)} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(15,15,26,0.44)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "studioDlgFade 0.16s ease-out" }}>
          <div role="alertdialog" aria-modal="true" aria-label={confirmToast.msg} onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: "24px 24px 18px", boxShadow: "0 24px 60px rgba(15,15,26,0.30)", textAlign: "center", animation: "studioDlgPop 0.2s cubic-bezier(0.34,1.4,0.64,1)" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(220,38,38,0.10)", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, fontWeight: 700, margin: "0 auto 14px" }}>!</div>
            <div style={{ fontSize: 16.5, fontWeight: 700, color: "#111827", letterSpacing: -0.2, marginBottom: 6 }}>{confirmToast.msg}</div>
            <div style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.5, marginBottom: 20 }}>{confirmToast.note || "This can’t be undone — its elements and pricing go with it."}</div>
            <div style={{ display: "flex", gap: 9 }}>
              <button onClick={() => closeConfirm(false)} style={{ flex: 1, background: "#F3F4F6", color: "#374151", border: "none", padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button autoFocus onClick={() => closeConfirm(true)} style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none", padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{confirmToast.yesLabel}</button>
            </div>
          </div>
        </div>
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

      {/* ═══ HEADER ═══
          Emoji are gone — every glyph is an SVG from components/icons.jsx, stroked in
          `currentColor` so it takes the colour of whatever chip it sits in. Emoji could never be
          size-matched (each renders at its own optical weight); the icons all share NAV_ICON.
          Type is on two tiers only: NAV_FS for everything clickable, META_FS for the uppercase
          micro-labels. The old header mixed 8/9/10/11/12/13px in one row. ═══ */}
      {!bareEventInfo && <div className="sa-header" style={S.header}>
        {/* The drifting sheen — see .sa-sheen. */}
        <div className="sa-sheen" aria-hidden="true" />
        {/* ── LEFT: brand, then the cross-app switcher. Both answer "where am I?", so they belong
               together at the start of the bar; a rule separates identity from navigation.
               flex:1 so the centre zone stays optically centred rather than content-pushed. */}
        <div className="sa-nav-left" style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 0", minWidth: 0 }}>
          {/* The real wordmark, cropped to its own bounds (see logoCrop). It is white + gold on
              transparent, which is exactly what this navy bar wants — the lettermark and typed
              "Ambria / Design Studio" beside it were a stand-in for this file.
              The mark reads "DESIGN & DECOR", so it no longer doubles as the mode indicator the
              old subtitle was; Manage gets its own chip rather than losing that signal. */}
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            {LOGO_ASSET ? (() => { const L = logoCrop(32); return (
              <div style={L.box}><img src={LOGO_ASSET} alt="Ambria Design &amp; Decor" style={L.img} /></div>
            ); })() : (
              <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${accent},#8B7355)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#0F0F1A", letterSpacing: -0.3, flexShrink: 0 }}>A</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2, lineHeight: 1.2 }}>Ambria</div>
                  <div style={{ ...NAV_META, color: accent, marginTop: 1 }}>{mode === "manage" ? "Manage" : "Design Studio"}</div>
                </div>
              </div>
            )}
            {LOGO_ASSET && mode === "manage" && <span style={{ ...NAV_META, color: accent, flexShrink: 0,
              padding: "2px 8px", borderRadius: 6, border: `1px solid ${accent}55`, background: "rgba(201,169,110,0.12)" }}>Manage</span>}
          </div>
          {/* Cross-app switcher (only renders for users granted both Studio + IMS) */}
          <div style={NAV_RULE} />
          <AppSwitcher current="studio" tone="dark" />
        </div>

        {/* ── CENTRE: where you are in the flow. Its own zone so it isn't crushed against the
               account controls the way it was when everything shared one right-hand run. */}
        <div className="sa-nav-mid" style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
          {/* Studio step nav — completed steps carry a tick, upcoming ones stay inert */}
          {/* ═══ THE FLOW ═══
              No segmented container any more. A shared tray says "pick one of these", which is what
              the mode switch and the Manage tabs are — but this is a route through four stops, and
              the connectors between them say that where a tray could not. The connector is also
              live: it is gold behind you and grey ahead, so the bar shows progress along its whole
              length rather than only at the chip you are standing on. */}
          {mode === "studio" && <div style={{ display: "flex", alignItems: "center", gap: 0 }}>{["Event Info", "Browse", "Build", "Summary"].map((l, i) => {
            const done = i < step, active = i === step, reachable = i <= step;
            // The step's ordinal, as its own token. A four-stop flow that only marks "you are here"
            // makes you count the chips to work out how far along you are; the number says it, and
            // the tick then modifies it from "ahead of you" to "done".
            const num = String(i + 1).padStart(2, "0");
            return (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden="true" style={{ width: 17, height: 1, flexShrink: 0, margin: "0 3px",
                  background: i <= step ? `${accent}8C` : "rgba(255,255,255,0.13)", transition: "background .18s ease" }} />}
                <div onClick={() => { if (reachable) setStep(i); }}
                  className={reachable && !active ? "sa-step sa-step-on" : "sa-step"}
                  style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 9,
                    padding: "5px 15px 5px 5px", borderRadius: 13, whiteSpace: "nowrap", border: "none",
                    fontSize: NAV_FS, lineHeight: 1, cursor: reachable ? "pointer" : "default",
                    fontWeight: active ? 600 : 500,
                    background: active ? "rgba(255,255,255,0.085)" : "transparent",
                    // Ring plus a wide soft gold cast, rather than a brighter fill. A fill competes
                    // with the gold numeral inside it; a glow sits behind both and lifts the pair.
                    boxShadow: active ? `0 0 0 1px ${accent}3D, 0 8px 26px -8px ${accent}66` : "none",
                    color: active ? "#fff" : done ? "rgba(255,255,255,0.66)" : "rgba(255,255,255,0.30)",
                    transition: "background .16s ease, color .16s ease, box-shadow .18s ease" }}>
                  {/* A rounded square, not a circle. Two digits in a circle have to shrink to clear
                      the curve at the corners of their own bounding box; a squircle gives the
                      numerals their width back and lets them sit at a readable size. */}
                  <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, lineHeight: 1,
                    background: active ? `linear-gradient(150deg,#EBD3A0,${accent})` : "transparent",
                    color: active ? "#171021" : done ? accent : "rgba(255,255,255,0.34)",
                    border: active ? "none" : `1px solid ${done ? `${accent}59` : "rgba(255,255,255,0.14)"}`,
                    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.5)" : "none",
                    transition: "all .16s ease" }}>{num}</span>
                  {l}
                  {/* The tick sits AFTER the label. In front of it, it pushed each completed chip's
                      text sideways, so a row of four steps had four different left edges for its
                      words — the fixed-width numeral is what lines them all up. */}
                  {done && <span style={{ display: "inline-flex", color: accent, marginLeft: -3 }}><IconCheck size={NAV_ICON - 3} /></span>}
                  {/* The marker under the active step. The chip's own tint is deliberately faint so
                      it does not shout over the rest of the bar, and this is what makes "you are
                      here" unmistakable at a glance without raising that tint. */}
                  {active && <span aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: -8,
                    width: 5, height: 5, marginLeft: -2.5, transform: "rotate(45deg)",
                    background: accent, boxShadow: `0 0 8px ${accent}` }} />}
                </div>
              </Fragment>
            );
          })}</div>}
          {/* Manage tabs */}
          {mode === "manage" && <div style={NAV_GROUP}>
            {(hasPerm("canEditEvents") || hasPerm("canManageLibrary")) && <button onClick={() => setManageTab("library")} style={navChip(manageTab === "library")}><IconBook size={NAV_ICON} />Library &amp; content</button>}
            {(isAdmin || hasStudioTab("settings")) && <button onClick={() => setManageTab("settings")} style={navChip(manageTab === "settings")}><IconGear size={NAV_ICON} />Settings</button>}
          </div>}
        </div>

        {/* ── RIGHT: money, mode, account. Hairline rules mark each change of meaning. The app
               switcher now lives on the left, which also pulls the two "Studio" chips (this-app
               vs this-mode) apart — side by side they read as one broken control. */}
        <div className="sa-nav-right" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flex: "1 1 0", minWidth: 0 }}>
          {/* The estimate chip lived here; Build's right-hand Live Estimate tile owns it now. */}
          {/* Mode switch — which part of Studio. Titled to distinguish it from the app switcher. */}
          <div style={NAV_GROUP}>
            {[["studio", "Studio", IconPalette, "Design Studio — build deals"], ...(canManageAny ? [["manage", "Manage", IconSliders, "Manage — library & settings"]] : [])].map(([id, label, Icon, tip]) => (
              <button key={id} onClick={() => setMode(id)} title={tip} style={navChip(mode === id)}><Icon size={NAV_ICON} />{label}</button>
            ))}
          </div>
          {/* Account zone — Deal Check, who you are, sign out */}
          <div style={NAV_RULE} />
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {authUser && mode === "studio" && (isAdmin || studioSub("design", "dealcheck")) && <button onClick={() => setDcFullPageOpen(true)} title="Deal Check" aria-label="Deal Check" style={NAV_ICON_BTN}><IconClipboardCheck size={NAV_ICON} /></button>}
            {authUser && <>
              {/* ── WHO YOU ARE ──
                  Avatar, then the name. The name is no longer in a filled chip: it is a label, not
                  a control, and sitting in a chip next to real buttons made it read as the fourth
                  one in the row. The only clickable thing here is the sign-out beside it.
                  This block is a single row now — the deal line that used to stack under it lives
                  below the bar, which is what gave the zone room for the avatar. */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "linear-gradient(150deg,#2A1F52,#12101F)", border: `1px solid ${accent}59`,
                    color: accent, fontSize: 14, fontWeight: 700, letterSpacing: 0.2,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)" }}>
                    {(authUser.name || "?").trim().charAt(0).toUpperCase() || "?"}
                  </div>
                  {/* A status dot that means something. The reference had a green "online" pip, but
                      a light that is always on is decoration dressed as data — everyone is online,
                      they are looking at the page. This reads saveError instead: green while writes
                      are landing, red the moment one fails. That is the one fact worth having
                      permanently in the corner of a tool that autosaves. */}
                  <span title={saveError ? "Changes are not saving — see the banner above" : "Saving normally"}
                    style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: "50%",
                      background: saveError ? "#EF4444" : "#22C55E", border: "2px solid #12101F" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: NAV_FS, fontWeight: 600,
                  color: "#fff", lineHeight: 1.15, whiteSpace: "nowrap" }}>
                  {authUser.name}
                  {isAdmin && <span style={{ ...NAV_META, color: accent }}>Admin</span>}
                  {!isAdmin && authUser.role === "manager" && <span style={{ ...NAV_META, color: "#38BDF8" }}>Mgr</span>}
                </div>
              </div>
              <button onClick={doLogout} title="Log out" aria-label="Log out" style={NAV_ICON_BTN}><IconLogout size={NAV_ICON} /></button>
            </>}
          </div>
        </div>
        {/* ROW 2: FUNCTION PILLS — hidden on Build page (step===2) per SOP */}
        {mode === "studio" && authUser && step !== 2 && (() => {
          const fns = [{ type: fn, date: clientDate, venue, shift: clientShift, pax: clientPax }, ...extraFunctions];
          if (extraFunctions.length === 0) return null;
          const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return d; } };
          const SHIFT_LETTER = { Morning: "M", Lunch: "L", Sundowner: "S", Night: "N" };
          return (
            <div className="sa-fnrow" style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, paddingTop: 10, marginTop: 6, borderTop: `1px solid rgba(201,169,110,0.12)`, flexWrap: "wrap" }}>
              <div style={{ ...NAV_META, color: "rgba(255,255,255,0.45)", marginRight: 2 }}>Function</div>
              {fns.map((f, i) => {
                // Highlight follows the PENDING pill while a switch renders, so the click lands
                // visibly at once. Without it the old pill stays lit for the whole switch and the
                // click reads as ignored — which is what got it clicked again.
                const isActive = i === (fnPending ?? activeFnIdx);
                const isLoading = isFnSwitching && i === fnPending;
                const f_ = f || {};
                const typeLbl = (f_.type && String(f_.type).trim()) || `Function ${i + 1}`;
                const slotLetter = f_.shift ? (SHIFT_LETTER[f_.shift] || String(f_.shift).charAt(0).toUpperCase()) : "";
                const label = `${typeLbl} · ${fmtDate(f_.date)}${slotLetter ? " " + slotLetter : ""}`;
                return (
                  <div key={i} onClick={() => switchActiveFn(i)} title={isLoading ? "Loading this function…" : undefined} style={{ ...NAV_CHIP_BASE, padding: "6px 14px", borderRadius: 999, cursor: isFnSwitching ? "progress" : "pointer", fontWeight: isActive ? 600 : 500, background: isActive ? accent : "transparent", color: isActive ? "#1a1a2e" : accent, border: `1px solid ${isActive ? accent : "rgba(201,169,110,0.4)"}`, display: "flex", alignItems: "center", gap: 7, opacity: isFnSwitching && !isActive ? 0.55 : 1, transition: "opacity .15s ease" }}>
                    {label}
                    {isLoading && <span aria-label="Loading" style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(26,26,46,0.28)", borderTopColor: "#1a1a2e", animation: "saRestoreSpin .6s linear infinite", flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>}

      {/* No deal line on the page. It used to sit top-right, naming the guest, date and venue.
          Browse and Build now open their left panel with a "Your event" block carrying exactly
          those three facts, and Event Info IS that form — so on every step it had become the same
          information twice on one screen. Summary was the last holdout and goes with the rest.
          Removed rather than gated to a step it can never run on: that is dead code that reads as
          live, and the next person has to prove it never fires before touching anything near it. */}

      {/* MANAGE MODE — permission-gated */}
      {mode === "manage" && authUser && (() => {
        // Resolve the active manage tab to one this role is permitted to see.
        const canLib = hasPerm("canEditEvents") || hasPerm("canManageLibrary");
        const canSettings = isAdmin || hasStudioTab("settings");
        const okFor = (t) => (t === "library" && canLib) || (t === "settings" && canSettings);
        const effManageTab = okFor(manageTab) ? manageTab : (canLib ? "library" : canSettings ? "settings" : null);
        return <div style={S.main}>
          {effManageTab === "library" ? (
            <ManageLibrary ctx={ctx} />
          ) : effManageTab === "settings" ? (
            <ManageSettings ctx={ctx} />
          ) : (
            <div style={{ textAlign: "center", padding: 60, color: textS }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, opacity: 0.55 }}><IconLock size={34} /></div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>No permissions</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Ask your admin for Studio access in IMS → Admin → Users → Tab Access.</div>
            </div>
          )}
        </div>;
      })()}

      {/* STUDIO MODE */}
      {/* While a saved deal is being brought back, hold the body. `step` is still 0 until the ledger
          lands, so rendering it would show Event Info for a second and then snap to Browse/Build. */}
      {mode === "studio" && (restoring ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "120px 20px", color: textS }}>
          <div className="sa-restore-spin" style={{ width: 26, height: 26, borderRadius: "50%", border: `2.5px solid ${border}`, borderTopColor: accent }} />
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Restoring your deal…</div>
          <style>{`@keyframes saRestoreSpin{to{transform:rotate(360deg)}}
.sa-restore-spin{animation:saRestoreSpin .7s linear infinite}
@media (prefers-reduced-motion: reduce){.sa-restore-spin{animation-duration:2.4s}}`}</style>
        </div>
      ) : <>
        {step === 0 && <StudioEventInfo ctx={ctx} />}
        {step === 1 && <StudioBrowse ctx={ctx} />}
        {step === 2 && <StudioBuild ctx={ctx} />}
        {step === 3 && <StudioSummary ctx={ctx} />}
      </>)}

      {/* DEAL CHECK FULL-PAGE OVERLAY */}
      {authUser && dcFullPageOpen && <DealCheckOverlay ctx={ctx} />}

      {/* Top-level modals (paint/fabric pickers, custom item, video, zone-upload, lightbox) */}
      <StudioModals ctx={ctx} />
    </div>
  );
}

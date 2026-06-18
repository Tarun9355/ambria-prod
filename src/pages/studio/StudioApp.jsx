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
import { kvGet, kvSet, reliableSave } from "../../lib/ims/kv";
import { makeS } from "../../lib/studio/styles";
import {
  DEFAULT_TAX, ZONE_META, ZONE_LABELS, ZONE_PRESETS, BASE_RATES,
  getCat,
} from "../../lib/studio/taxonomy";
import { RC_D, RC_CATS_DEFAULT } from "../../lib/studio/constants";
import {
  resolveTrussConfig, findZoneForArea, findAreaForZone, makeZoneId,
  defaultZoneFromArea, resolveMandiFlower, calcZoneTrussPreview,
  calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan,
} from "../../lib/studio/pricing";
import { VENUE_MIG_SK, LEGACY_VENUE_SEED } from "../../lib/studio/venues";
import {
  STORAGE_KEY, AMBRIA_PLAYLIST_ID, CLD_CLOUD,
  YT_SK, YT_TAG_SK, MANUAL_VID_SK, HIDDEN_VID_SK,
  NOTIF_SK, CLI_SK, DT_SK, EO_SK, PIMAP_SK, SCAN_HIST_SK,
  IMS_SETTINGS_SK, STUDIO_LMS_CACHE_SK, PALETTE_SK,
  DC_RUN_COUNTER_SK, DC_CACHE_SK, FLORAL_HARDPROP_MAP_SK, SOFT_HOLDS_SK,
  TRUSS_ALLOC_SK, FILTER_PRIORITY_SK, DEFAULT_FILTER_PRIORITY,
  RC_SK, RC_SK_CATS, RC_SK_TR, TPL_SK, ZONE_DEF_SK, TEAM_SK, LIB_SK, TAX_SK,
  PREMIA_CFG_SK,
} from "../../lib/studio/keys.js";

// ═══════════════════════════════════════════════════════════════
// MODULE-SCOPE CONSTANTS / HELPERS — copied VERBATIM from the reference.
// (Constants that already live in our libs are imported above.)
// ═══════════════════════════════════════════════════════════════

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
  if (zc.trT === "box") { const v = [d.L || 0, d.W || d.S || 0, d.H || 0].sort((a, b) => b - a); r.truss = v[0] * v[1] * 50; }
  else if (zc.trT === "singleU") { r.truss = (d.W || d.S || d.L || 0) * (d.H || 0) * 30; }
  if (zc.mkOn && zc.mkT) {
    const h = d.H || 0, rate = BASE_RATES.masking[zc.mkT] || 20; let w = 0;
    const dL = d.L || d.S || 0, dW = d.W || d.S || 0;
    if (zc.mkWalls) {
      const _trCfg = resolveTrussConfig(zc);
      const _cfg = _trCfg?.config || (zc.trT === "box" ? "full_box" : "half_box");
      const _spanL = _trCfg?.spanFt || dL || dW;
      const _backDepth = zc.trussBackDepth || 4;
      if (_cfg === "full_box") {
        if (zc.mkWalls.back) w += dL * h;
        if (zc.mkWalls.left) w += dW * h;
        if (zc.mkWalls.right) w += dW * h;
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
    r.masking = w * rate;
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
  return { dims, trT: p.tr || zm.defaultTruss || null, mkOn: !!p.mk, mkT: p.mk || "fabric", mkS: p.ms || 1, plH: p.pl || null, cpT: p.cp || null, archOn: !!p.archT, archT: p.archT || null, archQty: p.archQty || 0, archW: p.archW || 0, archH: p.archH || 0, pillarQty: p.pillarQty || 0, glassOn: !!p.glassT, glassT: p.glassT || null, glassQty: p.glassQty || 0, glassW: p.glassW || 0, glassH: p.glassH || 0 };
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

// ═══ Stubbed integrations — the reference proxies these through serverless /api routes
// (LMS lead search, IMS cross-fetch). No server runtime exists in this static SPA build,
// so they resolve to empty/neutral results. Replaced by real Supabase reads in later slices.
const searchLmsLeads = async (/* query, signal */) => ({ ok: true, complete: true, aborted: false, leads: [] });
async function fetchIMSData(/* date */) { return { inventory: [], blocksByDate: {}, blocksForDate: {} }; }

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function StudioApp() {
  // Auth comes from the app's context (route is already gated). authUser keeps the
  // reference's shape ({id,name,role,perms}). hasPerm/isAdmin derive from it verbatim.
  const { user, logout } = useAuth();
  const authUser = user
    ? { id: user.id || user.username || user.name, name: user.name || user.username || "User", role: user.role || "sales", perms: user.perms || {} }
    : null;

  // ═══ APP MODE ═══
  const [mode, setMode] = useState("studio"); // studio | manage
  const [events, setEvents] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(true);
  const [toast, setToast] = useState(null);

  // ═══ ADMIN STATE ═══
  const [editEv, setEditEv] = useState(null);
  const [manageTab, setManageTab] = useState("library");
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

  // ═══ §25 LMS LEAD INTEGRATION ═══
  const [lmsLeads, setLmsLeads] = useState([]);
  const [lmsLoading, setLmsLoading] = useState(false);
  const [lmsError, setLmsError] = useState(false);
  const [lmsFilling, setLmsFilling] = useState(false);
  const [lmsRefreshCounter, setLmsRefreshCounter] = useState(0);
  const lmsCacheRef = useRef(new Map());
  const lmsDebounceRef = useRef(null);
  const lmsAbortRef = useRef(null);
  const lmsPollRef = useRef(null);
  const [sessionHistoryExpanded, setSessionHistoryExpanded] = useState(false);
  const [dateTypes, setDateTypes] = useState({});
  const [eventOrders, setEventOrders] = useState([]);
  const [photoImsMap, setPhotoImsMap] = useState({});
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
  const [imsColourCatalogue, setImsColourCatalogue] = useState([]);
  const [imsPaletteCatalogue, setImsPaletteCatalogue] = useState([]);
  const [imsPaintableCategories, setImsPaintableCategories] = useState(["Props", "Arches", "Panels", "Pillars", "Glass", "Structural", "Furniture", "Stage", "Consumable", "Arches & Props", "Wall Masking"]);
  const [imsDefaultPaintCost, setImsDefaultPaintCost] = useState(400);
  // Save colour + palette catalogues to Studio-owned PALETTE_SK
  const savePaletteData = useCallback((colours, palettes) => {
    const data = { colourCatalogue: colours || imsColourCatalogue, paletteCatalogue: palettes || imsPaletteCatalogue };
    reliableSave(PALETTE_SK, JSON.stringify(data), "Palette catalogue").catch(() => {});
  }, [imsColourCatalogue, imsPaletteCatalogue]);
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
  const [dcMpIncludeMinusOne, setDcMpIncludeMinusOne] = useState(false);
  const [dcMpIncludeDismantle, setDcMpIncludeDismantle] = useState(true);
  const [dcMpCalcOpen, setDcMpCalcOpen] = useState({});
  const [dcFloralCalcOpen, setDcFloralCalcOpen] = useState({});
  const [dcCollapsedZones, setDcCollapsedZones] = useState({});
  const [floralHardPropMap, setFloralHardPropMap] = useState(FLORAL_HARDPROP_DEFAULT);
  const [softHolds, setSoftHolds] = useState({});
  const [trussAlloc, setTrussAlloc] = useState({});
  const [dcAmendDiff, setDcAmendDiff] = useState(null);
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
  const isAdmin = authUser?.role === "admin";
  const hasPerm = useCallback((perm) => {
    if (authUser?.role === "admin") return true;
    return authUser?.perms?.[perm] === true;
  }, [authUser]);

  const userVenueScope = useMemo(() => {
    if (!authUser) return "all";
    return teamData[authUser.id]?.venueScope || "all";
  }, [authUser, teamData]);

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
      // Rate Card
      try {
        const v = await kvGet(RC_SK);
        if (v != null) { const rp = parse(v); if (Array.isArray(rp) && rp.length) { const mapped = rp.map(i => ({ zones: [], ...i })); if (!cancelled) setRcItems(mapped); } }
        else { reliableSave(RC_SK, JSON.stringify(RC_D), "Rate card").catch(() => {}); }
      } catch {}
      // Rate Card Categories
      try {
        const v = await kvGet(RC_SK_CATS);
        if (v != null) { const cp = parse(v); if (Array.isArray(cp) && cp.length && !cancelled) setRcCats(cp); }
        else { reliableSave(RC_SK_CATS, JSON.stringify(RC_CATS_DEFAULT), "Categories").catch(() => {}); }
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
      // AUTO-SEED + AREAS↔ZONES SYNC (additive, mirrors reference)
      try {
        if (loadedTax && loadedZones) {
          const areasNow = Array.isArray(loadedTax.areasElements) ? loadedTax.areasElements.slice() : [];
          const zonesNow = { ...(loadedZones.meta || {}) };
          let changed = false;
          for (const [zid, zm] of Object.entries(ZONE_META)) { if (!zonesNow[zid]) { zonesNow[zid] = { ...zm }; changed = true; } }
          for (const area of areasNow) { if (!findZoneForArea(area, zonesNow)) { const newId = makeZoneId(area, zonesNow); zonesNow[newId] = defaultZoneFromArea(area); changed = true; } }
          for (const [zid, zm] of Object.entries(zonesNow)) { if (zm?.label && !findAreaForZone(zid, zm, areasNow)) { areasNow.push(zm.label); changed = true; } }
          if (changed && !cancelled) {
            const newTax = { ...loadedTax, areasElements: areasNow };
            const newZones = { ...loadedZones, meta: zonesNow };
            reliableSave(TAX_SK, JSON.stringify(newTax), "Taxonomy").catch(() => {});
            reliableSave(ZONE_DEF_SK, JSON.stringify(newZones), "Zone config").catch(() => {});
            setTaxonomy(newTax); setZoneDefs(newZones);
          }
        }
      } catch {}
      // Library
      try { const v = await kvGet(LIB_SK); if (v != null) { const lp = parse(v); if (Array.isArray(lp) && !cancelled) setLibItems(lp); } } catch {}
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
      // Client ledger — normalize old clients missing status/createdBy
      try {
        const v = await kvGet(CLI_SK);
        if (v != null) { const cp = parse(v); if (Array.isArray(cp) && !cancelled) setClientLedger(cp.map(c => ({ ...c, status: c.status || "ongoing", createdBy: c.createdBy || "—" }))); }
      } catch {}
      // Date types
      try { const v = await kvGet(DT_SK); if (v != null) { const dp = parse(v); if (dp && typeof dp === "object" && !cancelled) setDateTypes(dp); } } catch {}
      // Event orders
      try { const v = await kvGet(EO_SK); if (v != null) { const ep = parse(v); if (Array.isArray(ep) && !cancelled) setEventOrders(ep); } } catch {}
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
      // Palette catalogue (Studio-owned) + IMS settings (paint cats)
      try {
        const palv = await kvGet(PALETTE_SK);
        if (palv != null) { const p = parse(palv); if (p && typeof p === "object" && !cancelled) { if (Array.isArray(p.colourCatalogue) && p.colourCatalogue.length) setImsColourCatalogue(p.colourCatalogue); if (Array.isArray(p.paletteCatalogue) && p.paletteCatalogue.length) setImsPaletteCatalogue(p.paletteCatalogue); } }
        const sv = await kvGet(IMS_SETTINGS_SK);
        if (sv != null) { const s = parse(sv); if (s && typeof s === "object" && !cancelled) { if (Array.isArray(s.paintableCategories) && s.paintableCategories.length) setImsPaintableCategories(s.paintableCategories); if (typeof s.defaultPaintCostPerItem === "number") setImsDefaultPaintCost(s.defaultPaintCostPerItem); } }
      } catch {}
      // Deal Check boot loaders
      try { const v = await kvGet(FLORAL_HARDPROP_MAP_SK); if (v != null) { const m = parse(v); if (m && typeof m === "object" && !Array.isArray(m) && !cancelled) setFloralHardPropMap(m); } } catch {}
      try { const v = await kvGet(DC_RUN_COUNTER_SK); if (v != null) { const rc = parse(v); if (rc && typeof rc === "object" && !Array.isArray(rc) && !cancelled) setDcRunCounter(rc); } } catch {}
      try {
        const v = await kvGet(SOFT_HOLDS_SK);
        if (v != null) { const sh = parse(v); if (sh && typeof sh === "object" && !Array.isArray(sh) && !cancelled) { const now = Date.now(); const live = {}; for (const k of Object.keys(sh)) { const exp = typeof sh[k]?.expiry === "number" ? sh[k].expiry : Date.parse(sh[k]?.expiry || ""); if (exp && exp > now) live[k] = sh[k]; } setSoftHolds(live); } }
      } catch {}
      try { const v = await kvGet(DC_CACHE_SK); if (v != null) { const dc = parse(v); if (dc && typeof dc === "object" && !Array.isArray(dc) && !cancelled) setDcCache(dc); } } catch {}
      try {
        const v = await kvGet(TRUSS_ALLOC_SK);
        if (v != null) {
          const ta = parse(v);
          if (ta && typeof ta === "object" && !Array.isArray(ta) && !cancelled) {
            const now = Date.now(); const cleaned = {};
            for (const d of Object.keys(ta)) {
              const entry = ta[d];
              if (!entry || !Array.isArray(entry.events)) { cleaned[d] = entry; continue; }
              const liveEvents = entry.events.filter(ev => { if (ev.state !== "soft") return true; const exp = typeof ev.expiry === "number" ? ev.expiry : Date.parse(ev.expiry || ""); return exp && exp > now; });
              cleaned[d] = { ...entry, events: liveEvents };
            }
            setTrussAlloc(cleaned);
          }
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
  const saveRC = useCallback(async (ni) => { setRcItems(ni); await reliableSave(RC_SK, JSON.stringify(ni), "Rate card"); }, []);
  const saveRcCats = useCallback(async (nc) => { setRcCats(nc); await reliableSave(RC_SK_CATS, JSON.stringify(nc), "Categories"); }, []);
  const saveTpl = useCallback(async (nt) => { setTemplates(nt); await reliableSave(TPL_SK, JSON.stringify(nt), "Template"); }, []);
  const saveZD = useCallback(async (nd) => { setZoneDefs(nd); await reliableSave(ZONE_DEF_SK, JSON.stringify(nd), "Zone config"); }, []);
  const saveLib = useCallback(async (nl) => { setLibItems(nl); await reliableSave(LIB_SK, JSON.stringify(nl), "Library"); }, []);
  const saveTax = useCallback(async (nt) => { setTaxonomy(nt); await reliableSave(TAX_SK, JSON.stringify(nt), "Taxonomy"); }, []);
  const saveTeam = useCallback(async (nt) => { setTeamData(nt); await reliableSave(TEAM_SK, JSON.stringify(nt), "Team"); }, []);
  const saveClientLedger = useCallback(async (nl) => { setClientLedger(nl); await reliableSave(CLI_SK, JSON.stringify(nl), "Clients"); }, []);
  const saveDateTypes = useCallback(async (nd) => { setDateTypes(nd); await reliableSave(DT_SK, JSON.stringify(nd), "Date types"); }, []);
  const savePremiaConfig = useCallback(async (nc) => { const m = { ...PREMIA_DEFAULTS, ...nc }; setPremiaConfig(m); await reliableSave(PREMIA_CFG_SK, JSON.stringify(m), "Premia config"); }, []);
  const saveEventOrders = useCallback(async (neo) => { setEventOrders(neo); await reliableSave(EO_SK, JSON.stringify(neo), "Event orders"); }, []);
  const savePhotoImsMap = useCallback(async (nm) => { setPhotoImsMap(nm); await reliableSave(PIMAP_SK, JSON.stringify(nm), "Photo-IMS map"); }, []);
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
      up = Math.round(realPct / 100 * realRate + (100 - realPct) / 100 * artRate);
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
  }, [rcItems, getFloralMode, floralRatio]);

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
      up = Math.round(realPct / 100 * realRate + (100 - realPct) / 100 * artRate);
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
  }, [rcItems, getFloralMode]);

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
          const elN = (el.name || "").toLowerCase();
          const matchedTC = truckCap.find(tc => tc.perTruck > 0 && elN.includes(tc.item.toLowerCase().replace(/s$/, "")));
          if (matchedTC) itemAgg[matchedTC.id] = (itemAgg[matchedTC.id] || 0) + (el.qty || 0);
        }
        decorCost += (el.qty || 0) * up;
      });
    });
    const venueName = ev.venue || "";
    const match = trVenues.find(v => v.name.toLowerCase() === venueName.toLowerCase());
    const tripRate = match ? match.rate : 0;
    let itemTrucks = 0;
    Object.entries(itemAgg).forEach(([tcId, qty]) => { const tc = truckCap.find(t => t.id === tcId); if (!tc || !tc.perTruck) return; itemTrucks += Math.ceil(qty / tc.perTruck); });
    const floralTrucks = totalFloralCostFull > 0 ? Math.ceil(totalFloralCostFull / (floralPerTruck || 50000)) : 0;
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
    if (tagTier === "Platinum") return true;
    return getCat(getFullCost(ev)).label === "Platinum";
  }, [ytVideoTags, getFullCost]);

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
    const itemAgg = {};
    let totalFloralCost = 0;
    Object.entries(zoneElements).forEach(([zk, elems]) => {
      if (!enabledEls[zk] || !elems) return;
      elems.forEach(el => {
        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
        if (!rc) return;
        if ((rc.cat || "").toLowerCase() === "florals") {
          let up = 0; const sz = (el.size || "").toUpperCase();
          if (rcIsSMB(rc)) { if (sz === "S") up = rc.inhouseS || 0; else if (sz === "B") up = rc.inhouseB || 0; else up = rc.inhouseM || 0; }
          else { up = rc.inhouseFlat || 0; }
          totalFloralCost += (el.qty || 0) * up;
        } else {
          const elN = (el.name || "").toLowerCase();
          const matchedTC = truckCap.find(tc => tc.perTruck > 0 && elN.includes(tc.item.toLowerCase().replace(/s$/, "")));
          if (matchedTC) itemAgg[matchedTC.id] = (itemAgg[matchedTC.id] || 0) + (el.qty || 0);
        }
      });
    });
    Object.entries(zoneConfig).forEach(([zk, cfg]) => {
      if (!enabledEls[zk] || !cfg) return;
      const dims = cfg.dims || {}; const w = dims.w || 0; const d = dims.d || 0; const sqft = w * d;
      if (sqft > 0) {
        const trussTc = truckCap.find(tc => tc.item.toLowerCase().includes("truss") && tc.perTruck > 0);
        if (trussTc && cfg.trT) itemAgg[trussTc.id] = (itemAgg[trussTc.id] || 0) + sqft;
        const platTc = truckCap.find(tc => tc.item.toLowerCase().includes("platform") && tc.perTruck > 0);
        if (platTc && cfg.plH) itemAgg[platTc.id] = (itemAgg[platTc.id] || 0) + sqft;
        const carpTc = truckCap.find(tc => tc.item.toLowerCase().includes("carpet") && tc.perTruck > 0);
        if (carpTc && cfg.cpT) itemAgg[carpTc.id] = (itemAgg[carpTc.id] || 0) + sqft;
      }
    });
    let itemTrucks = 0;
    Object.entries(itemAgg).forEach(([tcId, qty]) => {
      const tc = truckCap.find(t => t.id === tcId); if (!tc || !tc.perTruck) return;
      const trucks = Math.ceil(qty / tc.perTruck);
      breakdown.push({ label: tc.item, qty, perTruck: tc.perTruck, unit: tc.unit, trucks });
      itemTrucks += trucks;
    });
    const floralTrucks = totalFloralCost > 0 ? Math.ceil(totalFloralCost / (floralPerTruck || 50000)) : 0;
    if (floralTrucks > 0) breakdown.push({ label: "Florals", qty: totalFloralCost, perTruck: floralPerTruck || 50000, unit: "₹", trucks: floralTrucks, isFloral: true });
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
      const itemAgg = {};
      let totalFloralCost = 0;
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
          if (!rc) return;
          if ((rc.cat || "").toLowerCase() === "florals") {
            let up = 0; const sz = (el.size || "").toUpperCase();
            if (rcIsSMB(rc)) { if (sz === "S") up = rc.inhouseS || 0; else if (sz === "B") up = rc.inhouseB || 0; else up = rc.inhouseM || 0; }
            else { up = rc.inhouseFlat || 0; }
            totalFloralCost += (el.qty || 0) * up;
          } else {
            const elN = (el.name || "").toLowerCase();
            const matchedTC = truckCap.find(tc => tc.perTruck > 0 && elN.includes(tc.item.toLowerCase().replace(/s$/, "")));
            if (matchedTC) itemAgg[matchedTC.id] = (itemAgg[matchedTC.id] || 0) + (el.qty || 0);
          }
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {};
        const fd = cfg.floorDims || d;
        if (cfg.trT === "box") {
          const tSqft = (d.L || 0) * (d.W || 0);
          if (tSqft > 0) { const tc = truckCap.find(t => t.item.toLowerCase().includes("truss") && t.perTruck > 0); if (tc) itemAgg[tc.id] = (itemAgg[tc.id] || 0) + tSqft; }
        }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) {
          const platTc = truckCap.find(tc => tc.item.toLowerCase().includes("platform") && tc.perTruck > 0);
          if (platTc && cfg.plH) itemAgg[platTc.id] = (itemAgg[platTc.id] || 0) + sqft;
          const carpTc = truckCap.find(tc => tc.item.toLowerCase().includes("carpet") && tc.perTruck > 0);
          if (carpTc && cfg.cpT) itemAgg[carpTc.id] = (itemAgg[carpTc.id] || 0) + sqft;
        }
      });
      let itemTrucks = 0;
      Object.entries(itemAgg).forEach(([tcId, qty]) => {
        const tc = truckCap.find(t => t.id === tcId); if (!tc || !tc.perTruck) return;
        itemTrucks += Math.ceil(qty / tc.perTruck);
      });
      const floralTrucks = totalFloralCost > 0 ? Math.ceil(totalFloralCost / (floralPerTruck || 50000)) : 0;
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
    let tReal = 0, tArt = 0;
    Object.entries(fn?.zoneElements || {}).forEach(([zk, elems]) => {
      if (!fn.enabledEls?.[zk]) return;
      (elems || []).forEach(el => {
        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
        if (!rc || String(rc.cat || "").toLowerCase() !== "florals") return;
        const q = el.qty || 0; if (q <= 0) return;
        const rp = resRP(el, rc) / 100, ap = 1 - rp;
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
        const season = sMap[fn.fnDate] || "non_saya";
        const sMult = mults[season] || 1;
        comp.flowers.forEach(fl => {
          const resolved = resolveMandiFlower(fl.flowerId, mc);
          const parent = resolved?.parent || null;
          const ft = parent?.flowerType || (parent?.isGreen ? "green" : "flower");
          const effR = ft === "real_only" ? 1 : rp;
          const effA = ft === "real_only" ? 0 : ap;
          const bp = (parent?.currentPrice || 0) * sMult;
          tReal += (fl.qty || 0) * q * effR * bp;
          if (effA > 0) {
            const bpu = Number(parent?.artificialBunchesPerUnit) || 0;
            const bunches = (fl.qty || 0) * q * effA * bpu;
            const isG = ft === "green";
            tArt += bunches * (isG ? artGreenRate / artGreenBPK : artFlowerRate / artFlowerBPK);
          }
        });
      });
    });
    return { totalReal: tReal, totalArtificial: tArt, grandTotal: tReal + tArt };
  }, [dealCheckData, rcItems, floralRatio]);

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
      const itemAgg = {};
      let totalFloralCost = 0;
      Object.entries(fZoneElements).forEach(([zk, elems]) => {
        if (!fEnabledEls[zk] || !elems) return;
        elems.forEach(el => {
          const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
          if (!rc) return;
          if ((rc.cat || "").toLowerCase() === "florals") {
            let up = 0; const sz = (el.size || "").toUpperCase();
            if (rcIsSMB(rc)) { if (sz === "S") up = rc.inhouseS || 0; else if (sz === "B") up = rc.inhouseB || 0; else up = rc.inhouseM || 0; }
            else { up = rc.inhouseFlat || 0; }
            totalFloralCost += (el.qty || 0) * up;
          } else {
            const elN = (el.name || "").toLowerCase();
            const matchedTC = truckCap.find(tc => tc.perTruck > 0 && elN.includes(tc.item.toLowerCase().replace(/s$/, "")));
            if (matchedTC) itemAgg[matchedTC.id] = (itemAgg[matchedTC.id] || 0) + (el.qty || 0);
          }
        });
      });
      Object.entries(fZoneConfig).forEach(([zk, cfg]) => {
        if (!cfg || !fEnabledEls[zk]) return;
        const d = cfg.dims || {};
        const fd = cfg.floorDims || d;
        if (cfg.trT === "box") {
          const tSqft = (d.L || 0) * (d.W || 0);
          if (tSqft > 0) { const tc = truckCap.find(t => t.item.toLowerCase().includes("truss") && t.perTruck > 0); if (tc) itemAgg[tc.id] = (itemAgg[tc.id] || 0) + tSqft; }
        }
        const sqft = (fd.L || 0) * (fd.W || 0);
        if (sqft > 0) {
          const platTc = truckCap.find(tc => tc.item.toLowerCase().includes("platform") && tc.perTruck > 0);
          if (platTc && cfg.plH) itemAgg[platTc.id] = (itemAgg[platTc.id] || 0) + sqft;
          const carpTc = truckCap.find(tc => tc.item.toLowerCase().includes("carpet") && tc.perTruck > 0);
          if (carpTc && cfg.cpT) itemAgg[carpTc.id] = (itemAgg[carpTc.id] || 0) + sqft;
        }
      });
      let itemTrucks = 0;
      Object.entries(itemAgg).forEach(([tcId, qty]) => {
        const tc = truckCap.find(t => t.id === tcId); if (!tc || !tc.perTruck) return;
        const trucks = Math.ceil(qty / tc.perTruck);
        breakdown.push({ label: tc.item, qty, perTruck: tc.perTruck, unit: tc.unit, trucks });
        itemTrucks += trucks;
      });
      const floralTrucks = totalFloralCost > 0 ? Math.ceil(totalFloralCost / (floralPerTruck || 50000)) : 0;
      if (floralTrucks > 0) breakdown.push({ label: "Florals", qty: totalFloralCost, perTruck: floralPerTruck || 50000, unit: "₹", trucks: floralTrucks, isFloral: true });
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
  // STYLES + THEME
  // ═══════════════════════════════════════════════════════════════
  const isDark = mode === "manage";
  const S = makeS(isDark);
  const accent = "#C9A96E";
  const border = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textS = isDark ? "#6B7280" : "#8b8fa3";

  // ═══════════════════════════════════════════════════════════════
  // CTX BAG — single object literal passed to view slices in later commits.
  // Comprehensive: every state var, setter, and pricing/save helper a view might need.
  // ═══════════════════════════════════════════════════════════════
  const ctx = {
    // theme / chrome
    S, isDark, accent, border, textS, fmt, cat,
    // auth
    authUser, isAdmin, hasPerm, doLogout, teamData, setTeamData, userVenueScope,
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
    taxonomy, setTaxonomy, saveTax, libItems, setLibItems, saveLib, libSearch, setLibSearch, libFilters, setLibFilters,
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
    premiaEditorOpen, setPremiaEditorOpen, premiaPreview, setPremiaPreview, isPremiaPlatinum,
    // youtube
    ytVideos, setYtVideos, ytPlaylists, setYtPlaylists, ytLoading, setYtLoading, ytSearch, setYtSearch, ytFilterPL, setYtFilterPL,
    ytPicker, setYtPicker, ytLastFetch, setYtLastFetch, ytVideoTags, setYtVideoTags, saveYtTags, ytTagEdit, setYtTagEdit,
    tagVenueGroup, setTagVenueGroup, tagOutsideSub, setTagOutsideSub, aiTaggingVideo, setAiTaggingVideo, aiVideoDraft, setAiVideoDraft,
    ytFilterVenue, setYtFilterVenue, ytFilterFn, setYtFilterFn, ytFilterTier, setYtFilterTier, ytFilterLinked, setYtFilterLinked,
    ytFilterStyle, setYtFilterStyle, ytFilterColor, setYtFilterColor, ytFilterIO, setYtFilterIO, ytPhotoUrl, setYtPhotoUrl,
    manualVideos, setManualVideos, hiddenVideos, setHiddenVideos, showHidden, setShowHidden, lastVisitTs, setLastVisitTs,
    // notifications
    notifications, setNotifications, notifOpen, setNotifOpen, notifLastRead, setNotifLastRead, unreadCount, markAllRead,
    filterPriority, setFilterPriority,
    // deal check
    dealCheckData, setDealCheckData, dealCheckLoading, setDealCheckLoading, dealCheckError, setDealCheckError,
    imsColourCatalogue, setImsColourCatalogue, imsPaletteCatalogue, setImsPaletteCatalogue, imsPaintableCategories, setImsPaintableCategories,
    imsDefaultPaintCost, setImsDefaultPaintCost, savePaletteData, paintPickerTarget, setPaintPickerTarget, fabricPickerTarget, setFabricPickerTarget,
    dcPhotoOverrides, setDcPhotoOverrides, dcSkipped, setDcSkipped, dcProductionAccepted, setDcProductionAccepted, dcManualItems, setDcManualItems,
    dcManualSearch, setDcManualSearch, dcDedupOverrides, setDcDedupOverrides, dcBlockedFnOpen, setDcBlockedFnOpen, dcBlockedSubOpen, setDcBlockedSubOpen,
    dcFloralExpanded, setDcFloralExpanded, dcFloralUnmatchedExpanded, setDcFloralUnmatchedExpanded, dcResolved, setDcResolved, dcResolving, setDcResolving, dcAbortRef, setDcAbortRef,
    dcFullPageOpen, setDcFullPageOpen, dcCards, setDcCards, dcZoneState, setDcZoneState, dcKitEdits, setDcKitEdits, dcCarpetPick, setDcCarpetPick,
    dcCarpetSearch, setDcCarpetSearch, dcDesiredMargin, setDcDesiredMargin, dcRunCounter, setDcRunCounter, dcCache, setDcCache, dcGenerating, setDcGenerating,
    dcGenStatus, setDcGenStatus, dcActiveTab, setDcActiveTab, dcMpOverrides, setDcMpOverrides, dcMpIncludeMinusOne, setDcMpIncludeMinusOne,
    dcMpIncludeDismantle, setDcMpIncludeDismantle, dcMpCalcOpen, setDcMpCalcOpen, dcFloralCalcOpen, setDcFloralCalcOpen, dcCollapsedZones, setDcCollapsedZones,
    floralHardPropMap, setFloralHardPropMap, softHolds, setSoftHolds, trussAlloc, setTrussAlloc, dcAmendDiff, setDcAmendDiff, dcSavingDraft, setDcSavingDraft,
    dcInventoryCache, setDcInventoryCache, dcBrowseAllOpen, setDcBrowseAllOpen, dcSwapModal, setDcSwapModal, dcColorModal, setDcColorModal,
    dcArtFlowerAlloc, setDcArtFlowerAlloc, dcArtFlowerModal, setDcArtFlowerModal, dcFloralColorPrefs, setDcFloralColorPrefs, dcPrefModal, setDcPrefModal,
    dcCustomItems, setDcCustomItems, dcCustomModal, setDcCustomModal,
    dcSwapSearch, setDcSwapSearch, dcSwapPicked, setDcSwapPicked, dcSwapMode, setDcSwapMode, dcSwapSplitQty, setDcSwapSplitQty,
    // pricing helpers
    rcIsSMB, buildZoneConfig, getFloralMode, applyFloralRatio, getElPrice, getElPriceForFn, calcElsCost, calcElsCostForFn,
    calcPhotoCost, calcStructCost, calcFullEventCost, getFullCost, totalCost, transportCalc, grandTotal,
    collectAllFunctionData, calcFunctionCost, calcFnFloralSourcingCost, eventGrandTotal, calcFunctionBreakdown,
    // module helpers exposed for views
    imsField, fetchIMSData, searchLmsLeads, calcZoneTrussPreview, calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan,
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

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${accent},#8B7355)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#0F0F1A" }}>A</div>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Ambria</div><div style={{ fontSize: 10, color: accent, letterSpacing: 1.5, textTransform: "uppercase" }}>{mode === "manage" ? "Manage" : "Design Studio"}</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Mode switch */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 3 }}>
            {[["studio", "🎨 Studio"], ...(isAdmin || hasPerm("canEditEvents") || hasPerm("canManageLibrary") || hasPerm("canManageTemplates") || hasPerm("canManagePricing") ? [["manage", "⚙️ Manage"]] : [])].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: mode === id ? 600 : 400, background: mode === id ? `${accent}22` : "transparent", color: mode === id ? accent : "#6B7280", transition: "all 0.15s" }}>{label}</button>
            ))}
          </div>
          {/* Studio step nav */}
          {mode === "studio" && <div style={{ display: "flex", gap: 3 }}>{["Event Info", "Browse", "Build", "Summary"].map((l, i) => <div key={i} onClick={() => { if (i <= step) setStep(i); }} style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: i === step ? 600 : 400, cursor: i <= step ? "pointer" : "default", background: i === step ? "rgba(255,255,255,0.15)" : "transparent", color: i <= step ? "#fff" : "rgba(255,255,255,0.25)" }}>{l}</div>)}</div>}
          {/* Manage tabs */}
          {mode === "manage" && <div style={{ display: "flex", gap: 3 }}>
            {(hasPerm("canEditEvents") || hasPerm("canManageLibrary")) && <button onClick={() => setManageTab("library")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "library" ? 600 : 400, background: manageTab === "library" ? `${accent}22` : "transparent", color: manageTab === "library" ? accent : "#6B7280" }}>📚 Library & content</button>}
            {hasPerm("canManagePricing") && <button onClick={() => setManageTab("pricing")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "pricing" ? 600 : 400, background: manageTab === "pricing" ? `${accent}22` : "transparent", color: manageTab === "pricing" ? accent : "#6B7280" }}>💰 Pricing</button>}
            {isAdmin && <button onClick={() => setManageTab("settings")} style={{ padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 11, fontWeight: manageTab === "settings" ? 600 : 400, background: manageTab === "settings" ? `${accent}22` : "transparent", color: manageTab === "settings" ? accent : "#6B7280" }}>⚙️ Settings</button>}
          </div>}
          {/* Live budget — only if canViewPricing */}
          {mode === "studio" && step >= 2 && hasPerm("canViewPricing") && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <div><div style={{ fontSize: 8, color: accent, textTransform: "uppercase", letterSpacing: 1 }}>Estimate</div><div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{fmt(grandTotal)}</div></div>
              <div style={{ padding: "3px 8px", borderRadius: 8, fontSize: 10, fontWeight: 600, background: cat.bg, color: cat.color }}>{cat.label}</div>
            </div>
          </div>}
          {/* Deal Check entry */}
          {authUser && mode === "studio" && <button onClick={() => setDcFullPageOpen(true)} title="Deal Check" style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#6B7280", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>⚙</button>}
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
      {mode === "manage" && authUser && <div style={S.main}>
        {/* TODO slice: ManageMode (library / pricing / settings) */}
        <div style={{ textAlign: "center", padding: 60, color: textS }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🛠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage — {manageTab}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>This section is being rebuilt in a later Studio slice.</div>
        </div>
      </div>}

      {/* STUDIO MODE */}
      {mode === "studio" && <div style={S.main}>
        {step === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Event Info</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{/* TODO slice: StudioEventInfo */}Client + functions setup — rebuilt in a later slice.</div>
            <button onClick={() => setStep(1)} style={S.btn(true)} className="mt-4">Continue → Browse</button>
          </div>
        )}
        {step === 1 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🖼️</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Browse</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{/* TODO slice: StudioBrowse */}Inspiration gallery — rebuilt in a later slice.</div>
          </div>
        )}
        {step === 2 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🏗️</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Build</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{/* TODO slice: StudioBuild */}Zone + element builder — rebuilt in a later slice.</div>
          </div>
        )}
        {step === 3 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Summary</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{/* TODO slice: StudioSummary */}Quote + client presentation — rebuilt in a later slice.</div>
          </div>
        )}
      </div>}

      {/* DEAL CHECK FULL-PAGE OVERLAY */}
      {authUser && dcFullPageOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 190, background: isDark ? "#0F0F1A" : "#FAF9F6", display: "flex", flexDirection: "column" }}>
          {/* TODO slice: DealCheck overlay */}
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>⚙ Deal Check</div>
            <button onClick={() => setDcFullPageOpen(false)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 12, cursor: "pointer" }}>✕ Close</button>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: textS, fontSize: 13 }}>Deal Check is being rebuilt in a later Studio slice.</div>
        </div>
      )}
    </div>
  );
}

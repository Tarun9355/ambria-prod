import { supabase } from "../supabase";

// IMS settings + inventory that feed a booked deal's Dept Ops snapshot (crew, kit parts, fabric, mandi…).
// A snapshot older than the newest change to any of them is stale: the auto-sync on opening a deal,
// the background planning sweep and IMS's "Sync planning" button all test exactly this.
export const PLANNING_SETTING_KEYS = ["heavyElementRanges", "categoryDepartments", "labourTiers", "dihariSchemes", "defaultWindowsByPhase", "venueMinLabour", "defaultMinLabour", "eventTypeMultipliers", "eventTimingMultipliers", "fabricBangaliRanges", "trussLabourRanges", "fabricRftPerWorker", "flowerPatterns", "mandiCatalogue", "mandiPriceMultipliers", "fixedVenues", "fixedVenueSubcatDiscount", "trussRates", "maskingRates", "fabricMultiplier", "carpetMaterials", "platformRates", "venueParents", "situationalMultipliers", "situationalMultiplierCap", "agencyFeePct", "rcCategories", "datePricing", "seasonMap", "eventTimingMultipliers"];

// Newest change (ms) to any planning setting or inventory row; 0 when nothing could be read.
// Recipes, mandi flowers and fixed venues moved out of `settings` into tables of their own (migrations 038-040), so their
// settings keys above stopped changing - a recipe edited in IMS never made a booked deal's planning stale (owner report
// 2026-11-11). Each table's newest row change counts now, as inventory's does.
export const PLANNING_INPUT_TABLES = ["inventory", "flower_patterns", "mandi_flowers", "fixed_venues"];
export async function latestPlanningInputStamp() {
  const newest = (table) => supabase.from(table).select("updated_at").order("updated_at", { ascending: false }).limit(1);
  const [{ data: srows }, ...tableRows] = await Promise.all([
    supabase.from("settings").select("key,updated_at").in("key", PLANNING_SETTING_KEYS),
    // a table that cannot be read (or has no updated_at) just adds nothing - never fails the check
    ...PLANNING_INPUT_TABLES.map((t) => newest(t).then((r) => r, () => ({ data: null }))),
  ]);
  const stamps = [...(srows || []), ...tableRows.flatMap((r) => r?.data || [])].map(r => Date.parse(r.updated_at)).filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : 0;
}

// An order still has something ahead of it: its last function date (or the order's own) is today or later.
export function planningUpcoming(eo, now = Date.now()) {
  const yesterday = new Date(now - 86400000).toLocaleDateString("en-CA");
  const last = [eo?.date, ...((Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map(f => f?.date))]
    .filter(Boolean).map(d => String(d).slice(0, 10)).sort().pop();
  return !!last && last >= yesterday;
}

// Shape of what a sync writes into the order (event_orders.data). Bump it when Deal Check starts
// recording something Dept Ops reads (v2: each labour usage row carries the department it was charged
// to; v3: crew counts carry the situational multiplier — King's date / shift timing), and every order
// synced under an older shape counts as stale until it is synced again. v4: rental totals take only the
// biggest of the date discount and the Fixed-Venue / reuse discount, so every figure moves. v5: the
// situational multiplier no longer applies to crew counts at all (temporarily disabled), Supervisors
// is no longer costed/shown anywhere, and Furniture's/Fabric's Labours share now pools into
// Structure's/Tenting's instead of its own — every manpower figure moves again. v6: each shared-crew
// day's schedule entry also carries shareByDept (every department's own share that day, not just
// this one's), so Dept Ops can show the full cross-department bifurcation, not only "mine". v7: the
// fabric colour follows the function's Fabric Palette (a colour saved on a truss row that the palette no
// longer allows is ignored) and each truss row's colour is recorded (fabricPlan.rows), so Dept Ops shows
// the colour per zone - orders synced before still show the old colours until synced again. v8: a heavy
// item's department (for the Labours usage split) is classified by its own sub-category, not its broad
// top-level category — fixes Carpet (and anything else filed under a category name that doesn't itself
// contain the matching keyword) never crediting Tenting. v9: Truss's pillar count and Platform's
// piece count now feed the Labours usage floor too (tentingZoneUsage) — neither is ever a zone
// element, so they were invisible to the split before this, even though both were configured in
// Heavy Element Add-ons; Tenting's Labours share can finally be nonzero. v10: the Florals detail
// also lists the artificial bunches per zone (floralDetail[fn].artZones), for the Dept Ops PDF's zone pages.
// v11: each shared-crew day's schedule entry also carries shareAbsByDept (every department's own
// RAW, un-normalized need that day) — Dept Ops now ceils that directly instead of multiplying the
// shareByDept FRACTION by the day's crew count, which over-counted once that count became a sum of
// independently-ceiled department counts rather than a single raw total.
// v12: the Florals detail also carries each element row's REAL flower lines (floralDetail[fn].realZones) — Deal Check's
// own amounts (real share, real-only flowers, reuse credit) — so the Dept Ops PDF prints exactly what Deal Check shows.
// v13: Fabric Bangali's wrap feet (manpowerDetail fabricBangali zones / count) no longer include the truss batta - fabric only.
// v14: Carpet's billed sqft (floorSqftOf) now feeds the Labours usage floor too, same as v9's Truss/
// Platform fix — Carpet is also never a zone element, so a Heavy Element Add-ons entry for it was
// silently contributing nothing; every deal with carpet needs its crew count recomputed.
// v15: poolLabourDept (deptClassify.js) widened from just Furniture->Structure/Fabric->Tenting to
// every non-Floral department -> Structure (owner ask, 2026-11-07) — Tenting/Fabric/Lighting/
// Transport's Labours share now pools into Structure's instead of its own, and since a shared crew's
// fractional need is ceiled once PER POOL, merging more departments into one pool can also change the
// total headcount/cost, not just which department's row it shows under — every manpower figure moves
// again, same as v5.
// v16 (2026-11-11): Fabric Bangali counts a U / half-box truss's span when it carries Liza or velvet curtains, masked or not
// (manpowerCount fabricBangaliZone) - an Entertainment Stage U with fabric but no masking was missing from the crew and its
// zone table. A flower-recipe element's name follows the recipe's (a recipe renamed in IMS). Every booked deal re-syncs.
// RULE: any change to how a crew count, a zone breakdown or another planning figure is worked out bumps this version (and the
// date below) in the same commit - without it, deals already synced keep the old figures until someone happens to save them.
// v17 (2026-11-11): the per-function Fabric Bangali zone table (Deal Check's manpowerDetail trace) uses the same rule as the
// count - v16 synced the count with the new rule but the table from an old masking-only copy, so it still left the zone out.
// v18 (2026-11-11): Labours' department split takes a sub-category's department from its category when the sub-category has
// no keyword or map entry of its own (deptClassify makeSubcatDept) - a "Console Table" filed under Floral counted in Structure's
// crew; each usage row also records the item's own department (ownDept) for Dept Ops' department headings.
// v19 (2026-11-11): each arrangement's artificial bunches (floralDetail[fn].artZones) carry its real share (realPct), so the
// Floral book's card for an arrangement shown only by its bunches says its split, as every other flower card does.
// v20 (2026-11-13): Wall Masking goes in the colour the salesperson picked on the truss in Build (zc.mkColour) when there is one,
// instead of being split over the Fabric Palette's colours (fabricPlan masking colours, Planning, the Setup Book).
// v21 (2026-11-14): Liza and velvet curtains likewise go in the colour picked on the Fabric card (zc.lizaColour / zc.curtainColour).
export const PLANNING_SNAPSHOT_VERSION = 21;
const PLANNING_SNAPSHOT_SHIPPED_AT = Date.parse("2026-11-14T09:40:20Z");
export const planningSnapshotOutdated = (eo) => (Number(eo?.deptSnapVer) || 1) < PLANNING_SNAPSHOT_VERSION;

// Synced before, and a planning input changed after that sync (a minute of slack: the sync's own write
// lands moments after the run it belongs to). An outdated snapshot shape counts as a change made when
// it shipped. Past events count too (owner ask) — their dates having gone by is no reason to leave
// their planning on old rules. `since` lets a finished sweep that skipped the order (no saved build)
// stop flagging it until something changes again.
export function planningNeedsSync(eo, latest, since = 0) {
  if (!eo || !eo.deptSyncedAt || !latest) return false;
  const changed = planningSnapshotOutdated(eo) ? Math.max(latest, PLANNING_SNAPSHOT_SHIPPED_AT) : latest;
  return changed > Math.max(Number(eo.deptSyncedAt), Number(since) || 0) + 60000;
}

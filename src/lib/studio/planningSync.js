import { supabase } from "../supabase";

// IMS settings + inventory that feed a booked deal's Dept Ops snapshot (crew, kit parts, fabric, mandi…).
// A snapshot older than the newest change to any of them is stale: the auto-sync on opening a deal,
// the background planning sweep and IMS's "Sync planning" button all test exactly this.
export const PLANNING_SETTING_KEYS = ["heavyElementRanges", "categoryDepartments", "labourTiers", "dihariSchemes", "defaultWindowsByPhase", "venueMinLabour", "defaultMinLabour", "eventTypeMultipliers", "eventTimingMultipliers", "fabricBangaliRanges", "trussLabourRanges", "fabricRftPerWorker", "flowerPatterns", "mandiCatalogue", "mandiPriceMultipliers", "fixedVenues", "fixedVenueSubcatDiscount", "trussRates", "maskingRates", "fabricMultiplier", "carpetMaterials", "platformRates", "venueParents", "situationalMultipliers", "situationalMultiplierCap", "agencyFeePct", "rcCategories"];

// Newest change (ms) to any planning setting or inventory row; 0 when nothing could be read.
export async function latestPlanningInputStamp() {
  const [{ data: srows }, { data: irow }] = await Promise.all([
    supabase.from("settings").select("key,updated_at").in("key", PLANNING_SETTING_KEYS),
    supabase.from("inventory").select("updated_at").order("updated_at", { ascending: false }).limit(1),
  ]);
  const stamps = [...(srows || []), ...(irow || [])].map(r => Date.parse(r.updated_at)).filter(Number.isFinite);
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
// to), and every order synced under an older shape counts as stale until it is synced again.
export const PLANNING_SNAPSHOT_VERSION = 2;
const PLANNING_SNAPSHOT_SHIPPED_AT = Date.parse("2026-10-21T09:20:00Z");
export const planningSnapshotOutdated = (eo) => (Number(eo?.deptSnapVer) || 1) < PLANNING_SNAPSHOT_VERSION;

// Synced before, still upcoming, and a planning input changed after that sync (a minute of slack: the
// sync's own write lands moments after the run it belongs to). An outdated snapshot shape counts as a
// change made when it shipped. `since` lets a finished sweep that skipped the order (no saved build)
// stop flagging it until something changes again.
export function planningNeedsSync(eo, latest, since = 0) {
  if (!eo || !eo.deptSyncedAt || !latest) return false;
  const changed = planningSnapshotOutdated(eo) ? Math.max(latest, PLANNING_SNAPSHOT_SHIPPED_AT) : latest;
  return planningUpcoming(eo) && changed > Math.max(Number(eo.deptSyncedAt), Number(since) || 0) + 60000;
}

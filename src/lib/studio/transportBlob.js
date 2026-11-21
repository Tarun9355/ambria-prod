// The transport settings blob (`ambria-transport-v3`: venues, truckCap, bufferTiers, floralPerTruck,
// genset rates) — one settings row that three screens edit: Studio (Transport & Power, a custom venue
// saved from Event Info, the one-time genset migration), IMS Admin → Transport & Power and IMS
// Planning → 🚚 Truck (each its own ImsTransportPanel), plus IMS's sub-category rename.
//
// Every writer used to write the WHOLE blob from its own in-memory copy, read once when the screen
// opened (IMS) or kept by realtime (Studio). A screen left open while another edited anything —
// a venue rate in Studio, a truck capacity in IMS — wrote its stale copy back over that edit on its
// next keystroke (audit 2026-11-21). Now every write reads the row fresh and changes only the fields
// it was asked to change (mergeTransport), so two people editing different parts can't undo each other.

import { supabase } from "../supabase";
import { RC_SK_TR } from "./keys";

// The row is stored as a JSON string (Studio's loader JSON.parses it); tolerate an object or a
// double-encoded string too. null when it can't be read as an object.
export function parseTransport(v) {
  let o = v;
  for (let i = 0; i < 2 && typeof o === "string"; i++) { try { o = JSON.parse(o); } catch { return null; } }
  return o && typeof o === "object" && !Array.isArray(o) ? o : null;
}

// saveTR's positional arguments (venues, truckCap, floralPerTruck, bufferTiers, gensetRate,
// gensetRate62, gensetCostRate, gensetCostRate62) → only the fields actually being changed.
export function patchFromArgs(nv, ntc, nfpt, nbt, ngr, ngr62, ngcr, ngcr62) {
  const p = {};
  if (nv) p.venues = nv;
  if (ntc) p.truckCap = ntc;
  if (nfpt !== undefined) p.floralPerTruck = nfpt;
  if (nbt) p.bufferTiers = nbt;
  if (ngr !== undefined) p.gensetRate = ngr;
  if (ngr62 !== undefined) p.gensetRate62 = ngr62;
  if (ngcr !== undefined) p.gensetCostRate = ngcr;
  if (ngcr62 !== undefined) p.gensetCostRate62 = ngcr62;
  return p;
}

// The fresh row with only the patch's fields replaced — every other field exactly as saved.
export function mergeTransport(fresh, patch) {
  return { ...(fresh || {}), ...(patch || {}) };
}

// The saved blob right now. Throws on a failed read (so a caller never mistakes "couldn't read"
// for "empty" and writes defaults over real data); null only when the row doesn't exist yet.
export async function readTransport() {
  const { data, error } = await supabase.from("settings").select("value").eq("key", RC_SK_TR).maybeSingle();
  if (error) throw error;
  return data ? parseTransport(data.value) : null;
}

export async function writeTransport(blob) {
  const { error } = await supabase.from("settings").upsert({ key: RC_SK_TR, value: JSON.stringify(blob) }, { onConflict: "key" });
  if (error) throw error;
  return blob;
}

// A sub-category renamed (IMS Admin → Sub-Categories): its truck capacity follows it — capacities are
// keyed by the sub-category's NAME, so a rename used to leave the old row orphaned and the renamed
// sub-category at "0 / not set", silently dropping it from every truck count.
export function renameTruckCapItem(blob, oldName, newName) {
  const o = String(oldName || "").trim().toLowerCase();
  if (!blob || !Array.isArray(blob.truckCap) || !o) return null;
  let changed = false;
  const truckCap = blob.truckCap.map((t) => {
    if (String(t?.item || "").trim().toLowerCase() !== o) return t;
    changed = true;
    return { ...t, item: newName };
  });
  return changed ? { ...blob, truckCap } : null;
}

// Labour type config — the `labour_types` TABLE (migration 041) consolidates three settings keys
// that were all independently keyed by the same real-world entity (a manpower type — Flowerists,
// Electricians, Labours, …) into one row per type: `labourTiers` (tier/minimum/dismantlingPct/
// subCatBatches, edited in AdminSettingsTab.jsx's Labour Tiers panel), `dihariSchemes` (rate/
// windows) and `defaultWindowsByPhase` (minusOne/event/dismantle pre-ticks), both edited in
// DihariTimingsPanel.jsx. These helpers translate the row shape back into the exact three
// independently-keyed plain objects every consumer (manpowerCount.js, eventAutoConfirm.js, Deal
// Check) already expects, so none of that calc logic had to change.

// labourTiers only lists a type that actually HAS tier-shaped data — a type that exists only for
// its dihari config (e.g. "Helpers"/"Drivers", which were never in labourTiers) must stay absent
// here, same as the old independently-keyed blob.
export function rowToLabourTier(r) {
  const out = {};
  if (r.tier != null && r.tier !== "") out.tier = /^-?\d+$/.test(r.tier) ? parseInt(r.tier, 10) : r.tier;
  if (r.minimum != null) out.minimum = Number(r.minimum);
  if (r.dismantling_pct != null) out.dismantlingPct = Number(r.dismantling_pct);
  if (r.sub_cat_batches && typeof r.sub_cat_batches === "object") out.subCatBatches = r.sub_cat_batches;
  return out;
}
export function assembleLabourTiersFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const v = rowToLabourTier(r);
    if (Object.keys(v).length) out[r.type_name] = v;
  });
  return out;
}

export function assembleDihariSchemesFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r.dihari_rate == null && !(Array.isArray(r.dihari_windows) && r.dihari_windows.length)) return;
    out[r.type_name] = { rate: r.dihari_rate != null ? Number(r.dihari_rate) : 500, windows: Array.isArray(r.dihari_windows) ? r.dihari_windows : [] };
  });
  return out;
}

export function assembleDefaultWindowsByPhaseFromRows(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r.default_windows && typeof r.default_windows === "object") out[r.type_name] = r.default_windows;
  });
  return out;
}

// Legacy-shaped partial patch (as every call site already builds it, for whichever of the three
// settings keys it edits) -> the DB columns it actually touches, for a plain row-level UPSERT.
export function labourTypePatchToRow(patch) {
  const row = {};
  if ("tier" in patch) row.tier = patch.tier == null ? null : String(patch.tier);
  if ("minimum" in patch) row.minimum = patch.minimum;
  if ("dismantlingPct" in patch) row.dismantling_pct = patch.dismantlingPct;
  if ("subCatBatches" in patch) row.sub_cat_batches = patch.subCatBatches;
  if ("dihariRate" in patch) row.dihari_rate = patch.dihariRate;
  if ("dihariWindows" in patch) row.dihari_windows = patch.dihariWindows;
  if ("defaultWindows" in patch) row.default_windows = patch.defaultWindows;
  return row;
}

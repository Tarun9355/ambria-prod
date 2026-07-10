// Shared Rate Card helpers — used by both Studio (src/pages/studio/StudioApp.jsx, RateCard.jsx)
// and IMS (Rate Card → IMS migration Phase 3: IMS now has its own admin UI writing to the same
// `rate_card` table / `ambria-rccats-v1` settings key). Kept here, not duplicated per-app, so a
// change to the row shape or floral-mode logic only needs to happen once.

// `rate_card` TABLE row ↔ in-memory item. Full item lives in `data` (JSONB); typed columns are
// mirrored for queries. Falls back to reading typed columns for legacy rows with no `data`.
export function rowToRcItem(row) {
  if (!row) return null;
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  if (d) return { zones: [], ...d, id: row.id };
  return { id: row.id, name: row.name, cat: row.cat, sub: row.sub, unit: row.unit, inhouseMode: row.inhouse_mode, inhouseFlat: row.inhouse_flat, inhouseS: row.inhouse_s, inhouseM: row.inhouse_m, inhouseB: row.inhouse_b, outS: row.out_s, outM: row.out_m, outB: row.out_b, zones: Array.isArray(row.zones) ? row.zones : [], floralMode: row.floral_mode, defaultRealPct: row.default_real_pct };
}

export function rcItemToRow(it) {
  return {
    id: it.id, name: it.name || "", cat: it.cat ?? null, sub: it.sub ?? null, unit: it.unit ?? null,
    inhouse_mode: it.inhouseMode ?? "flat", inhouse_flat: Number(it.inhouseFlat) || 0,
    inhouse_s: Number(it.inhouseS) || 0, inhouse_m: Number(it.inhouseM) || 0, inhouse_b: Number(it.inhouseB) || 0,
    out_s: Number(it.outS) || 0, out_m: Number(it.outM) || 0, out_b: Number(it.outB) || 0,
    zones: Array.isArray(it.zones) ? it.zones : [], floral_mode: it.floralMode ?? null,
    default_real_pct: it.defaultRealPct ?? null, data: it,
  };
}

// Does this item price by Small/Medium/Big instead of one flat rate?
export const rcIsSMB = (rc) => rc && ((rc.inhouseS || 0) > 0 || (rc.inhouseM || 0) > 0 || (rc.inhouseB || 0) > 0 || rc.inhouseMode === "smb");

// Effective real/artificial pricing mode for a floral item: explicit override, else inferred from
// whether an artificial rate is set at all, else the global ratio slider.
export function getFloralMode(rc) {
  if (!rc || (rc.cat || "").toLowerCase() !== "florals") return "ratio";
  if (rc.floralMode === "ratio" || rc.floralMode === "real" || rc.floralMode === "artificial") return rc.floralMode;
  const hasArt = (rc.artificialFlat || 0) > 0 || (rc.artificialS || 0) > 0 || (rc.artificialM || 0) > 0 || (rc.artificialB || 0) > 0;
  if (!hasArt) return "ratio";
  const dp = typeof rc.defaultRealPct === "number" ? rc.defaultRealPct : (rc.unit === "truss_sqft" ? 0 : 100);
  return dp >= 50 ? "real" : "artificial";
}

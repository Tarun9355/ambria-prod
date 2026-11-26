// The truss / fabric rental rates kept in truss_inventory (the one "main" row): trussInv.rates for Iron and the shared fabric
// (Liza / curtain / masking), trussInv.materials[mat].rates for Pole / Aluminium truss.
//
// Owner report 2026-11-26: the Old fabric rates were found at 0 (Liza 167 -> 0, curtain 150 -> 0, masking 500 -> 0, 23 Nov), which
// priced Liza / curtain / masking at Rs 0 on every deal synced since, and nothing recorded who did it. So: only an Admin changes a
// rate, each change is applied to the row as it is in the database right now (a tab left open for hours can no longer put its old
// copy of everything back), and each change is logged with the person's name (user_actions, action RATE_ACTION).

export const RATE_ACTION = "rate.change";

// What each rate is, for the history ("Liza Fabric · Old-stock rental").
export const RATE_LABELS = {
  lizaKgRate: "Liza Fabric · Old-stock rental (₹/kg)",
  lizaKgRateNew: "Liza Fabric · New-stock rental (₹/kg)",
  maskingPieceRate: "Wall Masking Panels · Old-stock rental (₹/pc)",
  maskingPieceRateNew: "Wall Masking Panels · New-stock rental (₹/pc)",
  curtainPieceRate: "Velvet Curtains · Old-stock rental (₹/pc)",
  curtainPieceRateNew: "Velvet Curtains · New-stock rental (₹/pc)",
  pillarRftRate: "Truss pillar rental (₹/RFT)",
  beamRftRate: "Truss beam rental (₹/RFT)",
  battaRftRate: "Batta rental (₹/RFT)",
};

const MAT_NAME = { iron: "Iron", pole: "Pole", aluminium: "Aluminium" };
const isIron = (mat) => !mat || mat === "iron";

export const rateLabel = (mat, key) => {
  const base = RATE_LABELS[key] || key;
  // fabric is shared across materials; only truss / batta rates are per material
  return /^(pillar|beam|batta)/.test(key) ? `${MAT_NAME[mat || "iron"] || mat} · ${base}` : base;
};

// The rate as stored (0 when not set).
export function readTrussRate(ti, mat, key) {
  const rates = isIron(mat) ? ti?.rates : ti?.materials?.[mat]?.rates;
  return Number(rates?.[key]) || 0;
}

// A copy of trussInv with one rate set; everything else exactly as given.
export function applyTrussRate(ti, mat, key, value) {
  const v = Math.max(0, Number(value) || 0);
  const base = ti && typeof ti === "object" ? ti : {};
  if (isIron(mat)) return { ...base, rates: { ...(base.rates || {}), [key]: v } };
  const m = base.materials?.[mat] || {};
  return { ...base, materials: { ...(base.materials || {}), [mat]: { ...m, rates: { ...(m.rates || {}), [key]: v } } } };
}

export const isAdminUser = (u) => (u?.role || "").toLowerCase() === "admin" || u?.id === "u_admin";

// Any OTHER write of the row (stock, colours, config): the rates are taken from the row as it is in the database now, never from the
// tab's own copy - rates change only through saveTrussRate, so an old tab saving a stock edit can no longer put old rates back
// (the 23 Nov 19:49 / 19:51 pair: one open tab put every old rate back, another put the zeros back two minutes later).
export function withRatesOf(next, fresh) {
  if (!next || typeof next !== "object" || !fresh || typeof fresh !== "object") return next;
  const out = { ...next, rates: fresh.rates || next.rates || {} };
  if (next.materials && typeof next.materials === "object") {
    out.materials = Object.fromEntries(Object.entries(next.materials).map(([m, v]) => {
      const fr = fresh.materials?.[m]?.rates;
      return [m, fr ? { ...(v || {}), rates: fr } : v];
    }));
  }
  return out;
}

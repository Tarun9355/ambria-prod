// A weight as people read it (owner ask 2026-11-13): whole kilos - 61.09 kg reads 61 kg - and one decimal under a kilo, so a small
// amount never reads 0 kg. Only kilos: a recipe's 0.75 bundle or 2.5 bunches is a real amount and keeps its decimals.
// Display only - every sum, check and saved figure keeps the exact number.
export const roundKg = (v) => {
  const n = Number(v) || 0;
  return n >= 1 ? Math.round(n) : Math.round(n * 10) / 10;
};

// A quantity in its unit as shown: kilos rounded, anything else as it is.
export const qtyShown = (q, unit) => (String(unit || "").trim().toLowerCase() === "kg" ? roundKg(q) : q);

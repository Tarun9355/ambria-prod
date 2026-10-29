// How one flower's planned quantity on the Floral shopping list builds up: which arrangements (recipe x count x flowers per
// arrangement) in which zone of which function call for it. Read from `floralDetail` - the per-function figures Deal Check
// pushes with the department snapshot (calcFnFloralDetail in StudioApp) - so the numbers are the ones the quote was costed on.
// The quantity is in the flower's mandi unit (bundle / piece / kg), the same unit the shopping list and the Dept Ops PDF use.

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const zoneText = (z) => {
  const t = String(z || "").replace(/[_-]+/g, " ").trim();
  return t && t !== "—" ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

// -> null when the flower is in no function's mandi list (an event synced before floralDetail existed, or a flower added by hand
// on the shopping list); else { unit, need, groups: [{ label, need, rows: [{ el, zone, size, elQty, per, realFrac, qty }] }] }.
export function mandiHow(floralDetail, flowerName) {
  const key = norm(flowerName);
  if (!key || !floralDetail || typeof floralDetail !== "object") return null;
  const groups = [];
  Object.keys(floralDetail).sort((a, b) => Number(a) - Number(b)).forEach((k) => {
    const f = floralDetail[k] || {};
    const m = (Array.isArray(f.mandi) ? f.mandi : []).find((x) => norm(x?.name) === key);
    if (!m) return;
    const rows = (Array.isArray(m.contributors) ? m.contributors : []).map((c) => ({
      el: String(c.el || ""),
      zone: zoneText(c.zone),
      size: c.size && c.size !== "—" ? String(c.size) : "",
      elQty: r2(c.elQty),
      per: r2(c.per),
      realFrac: typeof c.realFrac === "number" ? c.realFrac : 1,
      qty: r2(c.qty),
    }));
    groups.push({ label: [f.fnType || `Function ${Number(k) + 1}`, f.fnDate].filter(Boolean).join(" · "), unit: m.unit || "", need: r2(m.need), rows });
  });
  if (!groups.length) return null;
  return { unit: groups[0].unit, need: r2(groups.reduce((s, g) => s + g.need, 0)), groups };
}

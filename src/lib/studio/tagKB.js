// ─── AI-Tagging Knowledge Base ───────────────────────────────────────────────
// Distilled from VERIFIED library photos (human-confirmed = ground truth). It captures HOW your team
// actually tags — the vocabulary in use, per-area style/palette/element norms, and typical light
// counts — plus a few exemplar photos for few-shot. Injected into the tagger's (cached) prompt so the
// AI mirrors your house conventions instead of guessing. Pure + deterministic: no AI call to build it.

const norm = (s) => String(s || "").trim();
const median = (nums) => {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
// Top values of a tag field across photos, as [{v, pct}] (most common first).
const topValues = (photos, field, limit = 3) => {
  const counts = {};
  photos.forEach((p) => (p?.tags?.[field] || []).forEach((v) => { const k = norm(v); if (k) counts[k] = (counts[k] || 0) + 1; }));
  const total = photos.length || 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v, n]) => ({ v, pct: Math.round((n / total) * 100) }));
};

// Build the KB object from the verified photos. `lightNames` = lowercased rate-card names whose
// category is Lighting, so we can total "lights" per photo.
export function buildTagKB(verifiedPhotos, lightNames) {
  const photos = (verifiedPhotos || []).filter((p) => p && p.tags);
  const lightSet = lightNames instanceof Set ? lightNames : new Set((lightNames || []).map((n) => String(n).toLowerCase().trim()));
  const lightsOf = (p) => (p.elements || []).reduce((s, e) => s + (lightSet.has(String(e?.name || "").toLowerCase().trim()) ? (Number(e.qty) || 0) : 0), 0);

  // Vocabulary actually used per field (so the model prefers values your team really applies).
  const FIELDS = ["eventType", "venueType", "colorPalette", "designStyle", "timeSetting", "categoryTier"];
  const vocab = {};
  FIELDS.forEach((f) => { vocab[f] = topValues(photos, f, 8).map((x) => x.v); });

  // Per-area profile.
  const byArea = {};
  photos.forEach((p) => (p.tags.areasElements || []).forEach((a) => { const k = norm(a); if (!k) return; (byArea[k] = byArea[k] || []).push(p); }));
  const areas = {};
  Object.entries(byArea).sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([area, ph]) => {
    // Element name → median qty among photos of this area that include it.
    const elQtys = {};
    ph.forEach((p) => { const seen = {}; (p.elements || []).forEach((e) => { const n = norm(e?.name); if (!n) return; seen[n] = (seen[n] || 0) + (Number(e.qty) || 0); }); Object.entries(seen).forEach(([n, q]) => { (elQtys[n] = elQtys[n] || []).push(q); }); });
    const elements = Object.entries(elQtys).map(([name, qs]) => ({ name, median: median(qs), freqPct: Math.round((qs.length / ph.length) * 100) }))
      .sort((a, b) => b.freqPct - a.freqPct).slice(0, 6);
    const lightTotals = ph.map(lightsOf).filter((n) => n > 0);
    areas[area] = {
      n: ph.length,
      styles: topValues(ph, "designStyle"),
      palettes: topValues(ph, "colorPalette"),
      events: topValues(ph, "eventType"),
      elements,
      lights: lightTotals.length ? { lo: Math.min(...lightTotals), hi: Math.max(...lightTotals), median: median(lightTotals) } : null,
    };
  });

  // Few-shot exemplars: most-recent verified photo per most-common area (with a real image url).
  const exemplars = [];
  const usedAreas = new Set();
  [...photos].sort((a, b) => (b._verifiedAt || 0) - (a._verifiedAt || 0)).forEach((p) => {
    if (exemplars.length >= 4) return;
    const area = norm((p.tags.areasElements || [])[0]);
    if (!p.url || !area || usedAreas.has(area)) return;
    usedAreas.add(area);
    exemplars.push({
      url: p.url, area,
      style: norm((p.tags.designStyle || [])[0]), palette: norm((p.tags.colorPalette || [])[0]),
      event: norm((p.tags.eventType || [])[0]), time: norm((p.tags.timeSetting || [])[0]),
      lights: lightsOf(p),
      elements: (p.elements || []).slice(0, 8).map((e) => `${norm(e.name)}${e.qty ? ` ×${e.qty}` : ""}`).filter(Boolean),
    });
  });

  return { builtAt: Date.now(), fromCount: photos.length, vocab, areas, exemplars };
}

// Render the KB into the compact text block injected at the top of the (cached) tagging prompt.
export function renderTagKBText(kb) {
  if (!kb || !kb.fromCount) return "";
  const lines = [];
  lines.push(`════════ HOUSE TAGGING KNOWLEDGE BASE — WEIGH THIS HEAVILY · learned from ${kb.fromCount} of your team's VERIFIED (human-confirmed) photos ════════`);
  lines.push(`This is your STRONGEST prior — it captures exactly how this company tags: the vocabulary in use, per-area style/palette/element norms, and typical counts. Default to these conventions, names, and counts unless the photo clearly shows otherwise. (The HOUSE TAGGING RULES still override this wherever the two disagree.)`);
  const vb = kb.vocab || {};
  const vline = (f, label) => (vb[f] && vb[f].length) ? `${label}: ${vb[f].join(", ")}` : "";
  const vparts = [vline("eventType", "Event"), vline("venueType", "Venue"), vline("designStyle", "Style"), vline("colorPalette", "Palette"), vline("timeSetting", "Time")].filter(Boolean);
  if (vparts.length) lines.push("Values your team actually uses (prefer these) — " + vparts.join(" · "));
  const pctList = (arr) => (arr || []).map((x) => `${x.v} ${x.pct}%`).join(", ");
  Object.entries(kb.areas || {}).forEach(([area, a]) => {
    const parts = [`${area} (n=${a.n})`];
    if (a.styles?.length) parts.push(`style ${pctList(a.styles)}`);
    if (a.palettes?.length) parts.push(`palette ${pctList(a.palettes)}`);
    if (a.elements?.length) parts.push(`common ${a.elements.map((e) => `${e.name}${e.median ? ` ×${e.median}` : ""}`).join(", ")}`);
    if (a.lights) parts.push(`lights usually ${a.lights.lo}–${a.lights.hi}`);
    lines.push("• " + parts.join(" · "));
  });
  return lines.join("\n");
}

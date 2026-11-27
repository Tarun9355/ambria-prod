import { useState } from "react";
import { swatchHexFor } from "../../lib/studio/colours";
import { parseFlowerPalette, stringifyFlowerPalette } from "../../lib/studio/pricing";

// The colour(s) a truss's Liza / velvet curtains go in, picked on the Fabric card's icon menu (Build → Truss & Masking).
// A list of the fabric's own IMS stock colours, each with its stock photo (or swatch), and a search once the list is
// long. Inline styles, like the rest of Studio's Build card.
//   stock: the fabric's IMS stock rows [{ colour, photo, hex }]   paletteCols: the palette's colours for this fabric
//   value: what is picked for this truss, the Flower Palette's format - "Ivory", or "Ivory:60, Gold:40" for a ratio
//          ("" = follow the palette)   onPick(value)
// While nothing is explicitly picked (value === "") the list shows the Fabric Palette's own colour(s) for this
// fabric already ticked - this truss's REAL effective colour right now, not a separate "default" row above the
// list (removed, owner report 2026-11-27: it showed regardless of what was picked and ate most of the popup's
// height). Ticking/unticking always works off that effective set, seeded from the palette the first time it's
// touched (toggle/setPct's own `base`) - so adding a second colour to a one-colour palette default correctly
// SPLITS the two, rather than replacing the palette's colour outright, and the tick/tooltip never disagrees with
// what clicking it will actually do. The result only ever differs from "" (and so only ever stops following a
// later Fabric Palette change) once it's genuinely different from the palette's own current colour(s).
// Closed by default (owner ask 2026-11-14): one row naming the colour(s) in use; a click opens the list. Ticking a second
// colour opens a ratio between them (owner ask 2026-11-14, like the Flower Palette's): every share stays whole and the
// shares always add up to 100 - changing one moves the others in proportion.
const MAX_COLOURS = 4;
// Every ticked colour keeps at least this share - a colour typed down to 0 vanished from the ratio while still ticked
// (owner report 2026-11-14: "Air force 0 · Black 100").
const MIN_SHARE = 5;

// Whole numbers adding up to exactly `total`, in proportion to `weights` (largest remainder); all zero → even.
const spread = (weights, total) => {
  if (!weights.length) return [];
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sum = w.reduce((t, x) => t + x, 0);
  const base = sum > 0 ? w : w.map(() => 1);
  const bt = base.reduce((t, x) => t + x, 0);
  const raw = base.map((x) => (x * total) / bt);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((t, x) => t + x, 0);
  raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
};
const toHundred = (weights) => spread(weights, 100);
// Shares adding to 100 with every colour at MIN_SHARE or more. `fixed` (an index) keeps the value given to it where it can;
// the rest share what is left above their floor in proportion to what they had above it.
const withFloor = (pcts, fixed = -1) => {
  const n = pcts.length;
  if (n < 2) return toHundred(pcts);
  const cap = 100 - MIN_SHARE * (n - 1);
  const fv = fixed >= 0 ? Math.max(MIN_SHARE, Math.min(cap, Math.round(Number(pcts[fixed]) || 0))) : null;
  const idxs = pcts.map((_, i) => i).filter((i) => i !== fixed);
  const room = (fv === null ? 100 : 100 - fv) - MIN_SHARE * idxs.length;
  const above = spread(idxs.map((i) => Math.max(0, (Number(pcts[i]) || 0) - MIN_SHARE)), room);
  const out = pcts.map(() => 0);
  if (fv !== null) out[fixed] = fv;
  idxs.forEach((i, k) => { out[i] = MIN_SHARE + above[k]; });
  return out;
};

export default function FabricColourPick({ stock = [], paletteCols = [], value = "", onPick, isDark = false, accent = "#C5A572", textP = "#222", textS = "#888", border = "#e5e7eb" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byName = new Map();
  (stock || []).forEach((s) => {
    const c = String(s?.colour || "").trim();
    if (c && !byName.has(c)) byName.set(c, { colour: c, photo: s?.photo || "", hex: s?.hex || "" });
  });
  const pal = new Set(paletteCols);
  const all = [...byName.values()].sort((a, b) => (pal.has(b.colour) - pal.has(a.colour)) || a.colour.localeCompare(b.colour));
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((c) => c.colour.toLowerCase().includes(needle)) : all;
  const hover = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const selBg = isDark ? "rgba(197,165,114,0.18)" : "#FBF6EC";

  // what is EXPLICITLY picked now, as [{ name, pct }] with whole shares adding to 100 - [] while value is "".
  const picked = (() => {
    const list = parseFlowerPalette(value);
    const pcts = toHundred(list.map((c) => c.pct));
    return list.map((c, i) => ({ name: c.name, pct: pcts[i] }));
  })();
  // The Fabric Palette's own colours for this fabric, as an even-split [{name, pct}] list - the starting point
  // `toggle`/`setPct` work from whenever nothing is explicit yet, and what the list ticks against meanwhile.
  const paletteAsPicked = () => { const pcts = toHundred(paletteCols.map(() => 1)); return paletteCols.map((n, i) => ({ name: n, pct: pcts[i] })); };
  // The REAL effective selection right now: explicit if there is one, else the palette's own. Everything the UI
  // shows ticked, every ratio figure, and the MAX_COLOURS cap all read this, not `picked` directly, so a palette
  // default reads and behaves exactly like a real tick until the user's own choice genuinely differs from it.
  const effective = picked.length ? picked : paletteAsPicked();
  const effectiveSet = new Set(effective.map((c) => c.name));
  // A result that exactly matches what paletteAsPicked() would produce right now (same names, same
  // even shares) saves as "" instead - genuinely following the palette again, not a pinned copy of it
  // that happens to look the same today but silently stops tracking a LATER Fabric Palette change
  // (regression review, 2026-11-27: tick a second colour onto a one-colour default then untick it
  // again used to pin the first colour explicitly, forever, instead of landing back on "follow the
  // palette" the way the old dedicated reset row did). A deliberately different RATIO over the exact
  // same colour names (the user typed their own split, not the palette's even one) still pins, as it
  // should - only an exact match, name AND share, collapses back to "".
  const matchesPalette = (list) => { const pal = paletteAsPicked(); return list.length === pal.length && list.every((c) => pal.find((p) => p.name === c.name)?.pct === c.pct); };
  const save = (list) => onPick(!list.length || matchesPalette(list) ? "" : stringifyFlowerPalette(list));

  // tick / untick a colour, off the EFFECTIVE set (seeded from the palette on its first touch, not from
  // empty) - a new one takes an even share and the others give it room in proportion; one taken off gives its
  // share back to the rest in proportion. Saves "" again once the result exactly empties out OR lands back
  // exactly on the palette's own current colours/split (see `save`/`matchesPalette` above).
  const toggle = (name) => {
    const base = effective;
    if (effectiveSet.has(name)) {
      const rest = base.filter((c) => c.name !== name);
      const pcts = withFloor(toHundred(rest.map((c) => c.pct)));
      save(rest.map((c, i) => ({ name: c.name, pct: pcts[i] })));
      return;
    }
    if (base.length >= MAX_COLOURS) return;
    const n = base.length + 1;
    const share = Math.round(100 / n);
    const others = toHundred(base.map((c) => c.pct)).map((p) => (p * (100 - share)) / 100);
    const pcts = withFloor(toHundred([...others, share]), base.length);
    save([...base, { name, pct: 0 }].map((c, i) => ({ name: c.name, pct: pcts[i] })));
  };
  // one share typed: the others share what is left, in proportion to what they had - same effective-set seeding.
  const setPct = (idx, raw) => {
    const base = effective;
    const v = Math.round(Number(raw) || 0);
    const pcts = withFloor(base.map((c, i) => (i === idx ? v : c.pct)), idx);
    save(base.map((c, i) => ({ name: c.name, pct: pcts[i] })));
  };

  const Swatch = ({ c, size = 16 }) => {
    const s = byName.get(c);
    return s?.photo
      ? <img src={s.photo} alt="" style={{ width: size, height: size, borderRadius: 4, objectFit: "cover", border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />
      : <span style={{ width: size, height: size, borderRadius: 4, background: swatchHexFor(c, null, s?.hex), border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />;
  };
  const Row = ({ picked: on, onClick, children, title, disabled = false }) => (
    <button type="button" onClick={onClick} title={title} aria-pressed={on} disabled={disabled}
      onMouseEnter={(e) => { if (!on && !disabled) e.currentTarget.style.background = hover; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", textAlign: "left",
        background: on ? selBg : "transparent", color: textP, fontSize: 12, fontWeight: on ? 600 : 400, opacity: disabled ? 0.45 : 1 }}>
      {children}
      <span style={{ marginLeft: "auto", width: 12, color: accent, fontWeight: 700, flexShrink: 0 }}>{on ? "✓" : ""}</span>
    </button>
  );
  const inUseText = picked.length > 1 ? picked.map((c) => `${c.name} ${c.pct}%`).join(" · ") : picked.length ? picked[0].name : paletteCols.join(", ");

  if (!open) {
    const inUse = picked.length ? picked.map((c) => c.name) : paletteCols;
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} title="Pick the colour(s) for this truss"
        onMouseEnter={(e) => { e.currentTarget.style.background = hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left", background: "transparent", color: textP, fontSize: 12 }}>
        <span>🎨 Colour</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {inUse.slice(0, 3).map((c, i) => <span key={c} style={{ marginLeft: i ? -11 : 0, display: "inline-flex" }}><Swatch c={c} size={14} /></span>)}
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{inUseText || "—"}</span>
          {!picked.length && inUse.length > 0 && <span style={{ fontSize: 9, color: textS, flexShrink: 0 }}>palette</span>}
          <span aria-hidden="true" style={{ color: textS, flexShrink: 0 }}>›</span>
        </span>
      </button>
    );
  }

  const total = effective.reduce((t, c) => t + c.pct, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button type="button" onClick={() => { setOpen(false); setQ(""); }} aria-expanded={true}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: textS, padding: "4px 8px 0" }}>
        <span>Colour</span><span aria-hidden="true" style={{ fontSize: 12 }}>⌄</span>
      </button>
      {/* the ratio, once two or more colours are effectively ticked (explicit, or the palette's own default) */}
      {effective.length > 1 && (
        <div style={{ margin: "2px 4px", padding: "8px 8px 6px", borderRadius: 8, border: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: textS }}>Ratio</div>
          {/* the split at a glance */}
          <div style={{ display: "flex", gap: 2, height: 8 }}>
            {effective.map((c) => <span key={c.name} title={`${c.name} ${c.pct}%`} style={{ width: `${c.pct}%`, minWidth: 6, borderRadius: 999, background: swatchHexFor(c.name, null, byName.get(c.name)?.hex), border: "1px solid rgba(0,0,0,0.12)", transition: "width 160ms ease-out" }} />)}
          </div>
          {effective.map((c, i) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: textP }}>
              <Swatch c={c.name} size={14} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <input type="number" min={MIN_SHARE} max={100 - MIN_SHARE * (effective.length - 1)} step={5} value={c.pct} aria-label={`${c.name} share, percent`}
                onChange={(e) => setPct(i, e.target.value)}
                style={{ width: 52, padding: "3px 6px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, textAlign: "right", background: isDark ? "#111827" : "#fff", color: textP }} />
              <span style={{ color: textS, fontSize: 11 }}>%</span>
              <button type="button" onClick={() => toggle(c.name)} aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`}
                style={{ border: "none", background: "transparent", color: textS, cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>×</button>
            </div>
          ))}
          <div style={{ fontSize: 10, fontWeight: 600, color: total === 100 ? "#059669" : "#DC2626" }}>{total}% total</div>
        </div>
      )}
      {all.length > 8 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colours…" aria-label="Search colours"
          style={{ margin: "2px 4px", padding: "5px 8px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, background: isDark ? "#111827" : "#fff", color: textP, outline: "none" }} />
      )}
      {/* how the ratio opens - it is not visible until two colours are effectively ticked, so say so (owner report 2026-11-14) */}
      {effective.length < 2 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 4px", padding: "5px 8px", borderRadius: 6, background: selBg, fontSize: 10.5, color: textP }}>
          <span aria-hidden="true">⚖️</span>
          <span>{effective.length ? `Tick one more colour to split ${effective[0].name} by ratio` : "Tick two or more colours to set a ratio"}</span>
        </div>
      )}
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, paddingRight: 2 }}>
        {shown.map((c) => {
          // Nothing explicit yet (this truss just follows the function's Fabric Palette) — the
          // Palette's own colour(s) show ticked right here, as part of the normal list, instead of in
          // their own big "From Fabric Palette" row above it (removed, owner report 2026-11-27: it
          // showed regardless of what was picked and ate most of this popup's height). `on` reads
          // `effectiveSet`, the exact same set `toggle` itself acts on, so the tick and what clicking
          // it actually does can never disagree (a strict `pickedSet`-only tick used to let adding a
          // SECOND colour to a one-colour palette default silently replace it instead of splitting the
          // two, since the palette colour was never really "in" the explicit set it looked ticked in).
          const on = effectiveSet.has(c.colour);
          const full = !on && effective.length >= MAX_COLOURS;
          return (
            <Row key={c.colour} picked={on} disabled={full} onClick={() => toggle(c.colour)} title={full ? `Up to ${MAX_COLOURS} colours` : on ? `Take ${c.colour} off` : `Add ${c.colour}`}>
              <Swatch c={c.colour} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.colour}</span>
              {pal.has(c.colour) && <span style={{ fontSize: 9, fontWeight: 700, color: accent, border: `1px solid ${accent}`, borderRadius: 999, padding: "0 5px", flexShrink: 0 }}>Palette</span>}
              {on && effective.length > 1 && <span style={{ fontSize: 10, color: textS, flexShrink: 0 }}>{effective.find((x) => x.name === c.colour)?.pct}%</span>}
            </Row>
          );
        })}
        {!shown.length && <div style={{ fontSize: 11, color: textS, padding: "6px 8px" }}>No colour matches "{q}"</div>}
      </div>
    </div>
  );
}

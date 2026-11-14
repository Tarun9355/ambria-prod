import { useState } from "react";
import { swatchHexFor } from "../../lib/studio/colours";

// The colour a truss's Liza / velvet curtains go in, picked on the Fabric card's icon menu (Build → Truss & Masking).
// A list of the fabric's own IMS stock colours, each with its stock photo (or swatch), the function's Fabric Palette
// colour pinned on top as the default (value ""), and a search once the list is long. Inline styles, like the rest of
// Studio's Build card.
//   stock: the fabric's IMS stock rows [{ colour, photo, hex }]   paletteCols: the palette's colours for this fabric
//   value: the colour picked for this truss ("" = follow the palette)   onPick(colour | "")
export default function FabricColourPick({ stock = [], paletteCols = [], value = "", onPick, isDark = false, accent = "#C5A572", textP = "#222", textS = "#888", border = "#e5e7eb" }) {
  const [q, setQ] = useState("");
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

  const Swatch = ({ c, size = 16 }) => {
    const s = byName.get(c);
    return s?.photo
      ? <img src={s.photo} alt="" style={{ width: size, height: size, borderRadius: 4, objectFit: "cover", border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />
      : <span style={{ width: size, height: size, borderRadius: 4, background: swatchHexFor(c, null, s?.hex), border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />;
  };
  const Row = ({ picked, onClick, children, title }) => (
    <button type="button" onClick={onClick} title={title} aria-pressed={picked}
      onMouseEnter={(e) => { if (!picked) e.currentTarget.style.background = hover; }}
      onMouseLeave={(e) => { if (!picked) e.currentTarget.style.background = "transparent"; }}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
        background: picked ? selBg : "transparent", color: textP, fontSize: 12, fontWeight: picked ? 600 : 400 }}>
      {children}
      <span style={{ marginLeft: "auto", width: 12, color: accent, fontWeight: 700, flexShrink: 0 }}>{picked ? "✓" : ""}</span>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: textS, padding: "2px 8px 0" }}>Colour</div>
      {/* the default: whatever the function's Fabric Palette says for this fabric */}
      <Row picked={!value} onClick={() => onPick("")} title="Follow the function's Fabric Palette (changes with it)">
        <span style={{ display: "inline-flex", flexShrink: 0 }}>
          {paletteCols.length ? paletteCols.slice(0, 3).map((c, i) => <span key={c} style={{ marginLeft: i ? -5 : 0 }}><Swatch c={c} /></span>) : <span style={{ width: 16, height: 16, borderRadius: 4, border: `1px dashed ${border}` }} />}
        </span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paletteCols.length ? paletteCols.join(", ") : "Fabric Palette"}</span>
          <span style={{ fontSize: 10, color: textS, fontWeight: 400 }}>From Fabric Palette</span>
        </span>
      </Row>
      {all.length > 8 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colours…" aria-label="Search colours"
          style={{ margin: "2px 4px", padding: "5px 8px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, background: isDark ? "#111827" : "#fff", color: textP, outline: "none" }} />
      )}
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, paddingRight: 2 }}>
        {shown.map((c) => (
          <Row key={c.colour} picked={value === c.colour} onClick={() => onPick(c.colour)}>
            <Swatch c={c.colour} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.colour}</span>
            {pal.has(c.colour) && <span style={{ fontSize: 9, fontWeight: 700, color: accent, border: `1px solid ${accent}`, borderRadius: 999, padding: "0 5px", flexShrink: 0 }}>Palette</span>}
          </Row>
        ))}
        {!shown.length && <div style={{ fontSize: 11, color: textS, padding: "6px 8px" }}>No colour matches "{q}"</div>}
      </div>
    </div>
  );
}

import { useState } from "react";
import NumField from "../ui/NumField.jsx";
import { thumbUrl, fitUrl } from "../../lib/studio/thumb.js";

// Loose Liza / Masking / Curtain added by hand, by colour + qty (zc.looseFabric: [{ kind, colour, qty }]). One editor for both
// places it is offered: a truss's Fabric card, and (owner ask 2026-11-17) the zone's Elements panel beside "+ Add element",
// for loose fabric in a zone with no truss. Both write the SAME zone list, so a row added in one shows in the other.
// rateKey/rateKeyNew are the rates calcZoneFabricCost bills these rows at (pricing.js looseFabricQty), so the ₹ here is
// the ₹ billed.
export const LOOSE_FABRIC_KINDS = [
  { key: "liza", label: "Liza", emoji: "🧣", unit: "kg", stockKey: "lizaStock", rateKey: "lizaKgRate", rateKeyNew: "lizaKgRateNew" },
  { key: "masking", label: "Masking", emoji: "🧱", unit: "pcs", stockKey: "maskingStock", rateKey: "maskingPieceRate", rateKeyNew: "maskingPieceRateNew" },
  { key: "curtain", label: "Curtain", emoji: "🎀", unit: "pcs", stockKey: "curtainStock", rateKey: "curtainPieceRate", rateKeyNew: "curtainPieceRateNew" },
];

// rows / onChange(nextRows): the zone's looseFabric list. useNew: billed at the New fabric rate. free: a FOC truss - shown ₹0.
// caption: the small text after the "Loose fabric" heading.
export default function LooseFabricEditor({ rows: rowsIn, onChange, fabricInv, useNew = false, free = false, caption, showCosts, fmt, S, accent, border, textP, textS, isDark }) {
  const [colourMenu, setColourMenu] = useState(null); // which row's colour picker is open (its index)
  const [preview, setPreview] = useState(null); // { src, name } of the colour swatch hovered - the enlarge-on-hover
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  const rates = fabricInv?.rates || {};
  const addRow = () => onChange([...rows, { kind: "liza", colour: "", qty: 0 }]);
  const updRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delRow = (i) => onChange(rows.filter((_, j) => j !== i));
  // Each colour with its reference photo (IMS Admin → Planning → Fabric Stock), so the picker shows what the fabric looks like.
  const colourOpts = (stockKey) => {
    const seen = new Map();
    (fabricInv?.[stockKey] || []).forEach((r) => {
      const c = String(r?.colour || "").trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (!seen.has(k)) seen.set(k, { name: c, photo: r.photo || "" });
      else if (!seen.get(k).photo && r.photo) seen.get(k).photo = r.photo;
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const selStyle = { fontSize: 11, padding: "5px 6px", borderRadius: 6, border: `1px solid ${border}`, background: isDark ? "#1A1A2E" : "#fff", color: textP, width: "100%" };
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: textS, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        Loose fabric <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", opacity: 0.8 }}>· {caption || `same ${useNew ? "New" : "Old"} rate as above`}</span>
      </div>
      {rows.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
        {rows.map((row, i) => {
          const meta = LOOSE_FABRIC_KINDS.find((x) => x.key === row.kind) || LOOSE_FABRIC_KINDS[0];
          const opts = colourOpts(meta.stockKey);
          const rawRate = useNew ? rates[meta.rateKeyNew] : rates[meta.rateKey];
          const rate = Number((rawRate === undefined || rawRate === null || rawRate === "") ? rates[meta.rateKey] : rawRate) || 0;
          const rowCost = (Number(row.qty) || 0) * rate;
          // flex + wrap, not a fixed grid: on a narrow screen the colour button drops to its own line instead of being crushed
          return <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", padding: "5px 6px", borderRadius: 6, background: isDark ? "rgba(255,255,255,0.04)" : "#fff", border: `1px solid ${border}` }}>
            {/* 96px: iOS Safari's select arrow eats more width than desktop's, and "🎀 Curtain" is the longest label */}
            <select value={row.kind} onChange={(e) => updRow(i, { kind: e.target.value, colour: "" })} style={{ ...selStyle, width: 96, flex: "0 0 96px" }}>
              {LOOSE_FABRIC_KINDS.map((x) => <option key={x.key} value={x.key}>{x.emoji} {x.label}</option>)}
            </select>
            <div style={{ position: "relative", flex: "1 1 110px", minWidth: 110 }}>
              <button type="button" onClick={() => setColourMenu((m) => (m === i ? null : i))}
                style={{ ...selStyle, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: row.colour ? accent : textS, borderColor: row.colour ? accent : border }}>
                {(() => { const sel = opts.find((c) => c.name === row.colour); return sel?.photo
                  ? <img src={thumbUrl(sel.photo, 14)} loading="lazy" decoding="async" alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: "cover", flexShrink: 0, border: `1px solid ${border}` }} /> : null; })()}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{row.colour || "— Colour —"}</span>
                <span style={{ fontSize: 9, opacity: 0.6, flexShrink: 0 }}>▾</span>
              </button>
              {colourMenu === i && <>
                <div className="fixed inset-0 z-40" onClick={() => { setColourMenu(null); setPreview(null); }} />
                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, zIndex: 50, width: 180, maxHeight: 230, overflowY: "auto", background: isDark ? "#1A1A2E" : "#fff", border: `1px solid ${border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: 4 }}>
                  <div onClick={() => { updRow(i, { colour: "" }); setColourMenu(null); setPreview(null); }}
                    style={{ padding: "5px 7px", borderRadius: 5, cursor: "pointer", fontSize: 11, color: textS }}>— Colour —</div>
                  {opts.map((c) => (
                    <div key={c.name} onClick={() => { updRow(i, { colour: c.name }); setColourMenu(null); setPreview(null); }}
                      onMouseEnter={() => c.photo && setPreview({ src: c.photo, name: c.name })} onMouseLeave={() => setPreview(null)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", borderRadius: 5, cursor: "pointer", fontSize: 11,
                        background: row.colour === c.name ? `${accent}18` : "transparent", color: row.colour === c.name ? accent : textP, fontWeight: row.colour === c.name ? 700 : 400 }}>
                      {c.photo ? <img src={thumbUrl(c.photo, 16)} loading="lazy" decoding="async" alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover", flexShrink: 0, border: `1px solid ${border}` }} />
                        : <span style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, border: `1px dashed ${border}` }} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    </div>
                  ))}
                </div>
                {/* the hovered colour, bigger - a sibling of the scrolling list, or that list's overflow would clip it */}
                {preview && <div style={{ position: "absolute", top: "100%", left: 186, marginTop: 2, zIndex: 50, width: 120, height: 120, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", background: isDark ? "#111" : "#fff" }}>
                  <img src={fitUrl(preview.src, 240)} alt={preview.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>}
              </>}
            </div>
            <NumField min={0} value={row.qty || ""} onCommit={(n) => updRow(i, { qty: n })} blankCommit commitOn="blur" placeholder="0"
              style={{ ...S.input, width: 46, flex: "0 0 46px", padding: "5px 4px", fontSize: 11.5, fontWeight: 600, textAlign: "center" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: "auto" }}>
              <span style={{ fontSize: 9.5, color: textS }}>{meta.unit}</span>
              {showCosts && <span style={{ fontSize: 10.5, fontWeight: 600, color: textP, minWidth: 38, textAlign: "right" }}>{fmt(free ? 0 : rowCost)}</span>}
              <span onClick={() => delRow(i)} title="Remove" style={{ cursor: "pointer", color: "#E11D48", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✕</span>
            </div>
          </div>;
        })}
      </div>}
      <button type="button" onClick={addRow}
        style={{ fontSize: 10.5, fontWeight: 600, color: accent, background: "transparent", border: `1px dashed ${accent}80`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add loose fabric</button>
    </div>
  );
}

import { useState } from "react";

// A small item thumbnail that enlarges into a fixed-position popup on hover — image, name,
// sub-category, and physical dimensions (if the item has any). Used by every "search inventory to
// add" dropdown (Tagging, Build, Deal Check, Kit editors, Library) so a salesperson/ops user can
// confirm they've got the right item before clicking it in, without opening Inventory separately.
export default function ItemHoverThumb({
  src, size = 56, rounded = 8, name, sub, dims, badge, placeholder = "📦",
  border = "#333", cardBg = "#fff", textP = "#111", textS = "#666", emptyBg,
}) {
  const [hover, setHover] = useState(null);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={(e) => {
        if (!src) return;
        const r = e.currentTarget.getBoundingClientRect();
        const POP_H = 214;
        const openUp = window.innerHeight - r.bottom < POP_H + 8 && r.top > POP_H + 8;
        setHover({
          openUp,
          top: openUp ? undefined : r.bottom + 4,
          bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
          left: Math.min(r.left, window.innerWidth - 208),
        });
      }}
      onMouseLeave={() => setHover(null)}>
      <div style={{ width: size, height: size, borderRadius: rounded, overflow: "hidden", flexShrink: 0, background: emptyBg || "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: size * 0.4, opacity: 0.35 }}>{placeholder}</span>}
      </div>
      {hover && src && (
        <div style={{ position: "fixed", top: hover.top, bottom: hover.bottom, left: hover.left, zIndex: 10000, width: 200, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", pointerEvents: "none", background: cardBg }}>
          <img src={src} alt="" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
          <div style={{ padding: "6px 8px" }}>
            {name && <div style={{ fontSize: 11, fontWeight: 700, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>}
            {(sub || badge) && <div style={{ fontSize: 10, color: textS, marginTop: 1 }}>{sub}{badge ? (sub ? " · " : "") + badge : ""}</div>}
            {dims && <div style={{ fontSize: 10, color: textS, marginTop: 2 }}>📐 {dims}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

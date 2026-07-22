import { useState } from "react";
import { priceForInvItem, itemDimsText } from "../../lib/ims/helpers";

// Generic "pick one IMS inventory item from a category/sub-category" modal — used by the truss
// section's Custom Ceiling button (Fabric › Ceiling) and the masking section's Custom Masking
// button (Fabric › Printed Walls). Substring/case-insensitive match on both legacy (cat/subCat)
// and new (category/subcategory) inventory field names, since not every item has been migrated.
export default function InventoryItemPickerModal({
  title, icon = "🖼️", accent = "#7C3AED",
  imsInventory, categoryMatch, subcatMatch, rcFactorByKey,
  onSelect, onClose,
  isDark, border, textP, textS, cardBg,
}) {
  const [q, setQ] = useState("");
  const catM = String(categoryMatch || "").toLowerCase();
  const subM = String(subcatMatch || "").toLowerCase();
  const items = (imsInventory || []).filter((it) => {
    const cat = String(it.cat || it.category || "").toLowerCase();
    const sub = String(it.subCat || it.subcategory || "").toLowerCase();
    if (catM && !cat.includes(catM)) return false;
    if (subM && !sub.includes(subM)) return false;
    if (q.trim()) {
      const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const hay = String(it.name || "").toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10500, background: "rgba(10,10,20,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(920px, 100%)", maxHeight: "85vh", background: isDark ? "#0F0F1A" : "#fff", borderRadius: 14, border: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: textP }}>{icon} {title}</div>
          <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 13, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "10px 18px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search by name..."
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 12 }} />
        </div>
        <div style={{ padding: "0 18px 16px", overflowY: "auto", flex: 1 }}>
          {items.length === 0 ? (
            <div style={{ padding: "24px 10px", textAlign: "center", color: textS, fontSize: 11, borderRadius: 8, border: `1px dashed ${border}` }}>
              No matching inventory items{subM ? ` in this sub-category` : ""}.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {items.map((it) => {
                const price = priceForInvItem(it, rcFactorByKey, imsInventory);
                const src = it.img || it.photoUrls?.[0];
                const sub = (it.subCat || it.subcategory) || "";
                const dims = itemDimsText(it);
                return (
                  <div key={it.id} onClick={() => onSelect(it)}
                    style={{ borderRadius: 10, cursor: "pointer", border: `1px solid ${border}`, overflow: "hidden", background: isDark ? "#12121F" : "#fafafa", display: "flex", flexDirection: "column" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 2px 12px ${accent}30`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ width: "100%", height: 120, background: isDark ? "#1a1a2e" : "#eee", position: "relative", flexShrink: 0 }}>
                      {src
                        ? <img src={src} alt={it.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: textS }}>{icon}</div>}
                      <div style={{ position: "absolute", bottom: 0, right: 0, background: accent, color: "#fff", padding: "2px 8px", borderTopLeftRadius: 8, fontSize: 11, fontWeight: 700 }}>₹{Math.round(price).toLocaleString("en-IN")}</div>
                    </div>
                    <div style={{ padding: "7px 9px" }}>
                      <div title={it.name} style={{ fontSize: 11, fontWeight: 600, color: textP, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.name}</div>
                      <div style={{ fontSize: 9, color: textS, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}{dims ? ` · 📐 ${dims}` : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { priceForInvItem, itemDimsText } from "../../lib/ims/helpers";
import { fitUrl } from "../../lib/studio/thumb.js";

// Generic "pick one IMS inventory item from a category/sub-category" modal — used by the truss
// section's Custom Ceiling button (Fabric › Ceiling) and the masking section's Custom Masking
// button (Fabric › Printed Walls). Substring/case-insensitive match on both legacy (cat/subCat)
// and new (category/subcategory) inventory field names, since not every item has been migrated.
// Every card says how many the studio owns (IMS qty); with freeFor(item) - how many are free on the event date, after
// other events and the rest of this deal - it says that too, so a ceiling nobody can have on the day is seen before
// it is picked (owner ask 2026-10-31).
export default function InventoryItemPickerModal({
  title, icon = "🖼️", accent = "#7C3AED",
  imsInventory, categoryMatch, subcatMatch, rcFactorByKey, freeFor, dateLabel,
  // withQty: each card gets a − / + quantity (starting at defaultQty) and a "Select" button; onSelect(item, qty).
  withQty = false, defaultQty = 1,
  onSelect, onClose,
  isDark, border, textP, textS, cardBg,
}) {
  const [q, setQ] = useState("");
  const [qtyById, setQtyById] = useState({});
  // Never more than is free on the date (owner ask: 15 could be asked for with 1 available). An item the studio owns
  // none of (made to order - a customised printed ceiling) has no stock to hold a number to, so it is not capped -
  // the same rule Build's own quantity cap uses.
  const capOf = (it) => {
    const owned = Math.max(0, Number(it?.qty ?? it?.qtyOwned) || 0);
    return freeFor && owned > 0 ? Math.max(0, Math.floor(Number(freeFor(it)) || 0)) : Infinity;
  };
  const qtyOf = (it, cap = capOf(it)) => Math.max(1, Math.min(cap, Number(qtyById[it.id]) || Math.max(1, Number(defaultQty) || 1)));
  const setQty = (it, v, cap = capOf(it)) => setQtyById((m) => ({ ...m, [it.id]: Math.max(1, Math.min(cap, Math.round(Number(v) || 1))) }));
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
                const owned = Math.max(0, Number(it.qty ?? it.qtyOwned) || 0);
                const free = freeFor ? Math.max(0, Number(freeFor(it)) || 0) : null;
                const unit = String(it.unit || "").trim();
                const cap = capOf(it);
                const blocked = cap <= 0; // owned, but none free on the date - nothing to pick
                const qNow = qtyOf(it, cap);
                // the count sits on the photo's top-left corner (owner ask): green while some are free, red when none is
                const count = free == null
                  ? { t: String(owned), bg: "rgba(17,24,39,0.82)" }
                  : { t: String(free), bg: free > 0 ? "#059669" : "#DC2626" }; // just the number available on the date (owner ask) - the rest is in the tooltip
                const countTip = free == null ? `${owned}${unit ? " " + unit : ""} in IMS`
                  : `${free}${unit ? " " + unit : ""} free${dateLabel ? ` on ${dateLabel}` : " on the event date"} (after other events and the rest of this deal) · ${owned} owned`;
                return (
                  <div key={it.id} onClick={() => { if (!blocked) onSelect(it, withQty ? qNow : undefined); }}
                    title={blocked ? `None free${dateLabel ? ` on ${dateLabel}` : " on the event date"}` : undefined}
                    style={{ opacity: blocked ? 0.55 : 1, borderRadius: 10, cursor: blocked ? "not-allowed" : "pointer", border: `1px solid ${border}`, overflow: "hidden", background: isDark ? "#12121F" : "#fafafa", display: "flex", flexDirection: "column" }}
                    onMouseEnter={(e) => { if (blocked) return; e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 2px 12px ${accent}30`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ width: "100%", height: 120, background: isDark ? "#1a1a2e" : "#eee", position: "relative", flexShrink: 0 }}>
                      {src
                        ? <img src={fitUrl(src, 200)} alt={it.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: textS }}>{icon}</div>}
                      <div title={countTip} style={{ position: "absolute", top: 6, left: 6, background: count.bg, color: "#fff", padding: "2px 7px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>{count.t}</div>
                      <div style={{ position: "absolute", bottom: 0, right: 0, background: accent, color: "#fff", padding: "2px 8px", borderTopLeftRadius: 8, fontSize: 11, fontWeight: 700 }}>₹{Math.round(price).toLocaleString("en-IN")}</div>
                    </div>
                    <div style={{ padding: "7px 9px" }}>
                      <div title={it.name} style={{ fontSize: 11, fontWeight: 600, color: textP, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.name}</div>
                      <div style={{ fontSize: 9, color: textS, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}{dims ? ` · 📐 ${dims}` : ""}</div>
                      {withQty && (
                        // its own clicks stay here - only "Select" (or the rest of the card) picks the item
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${border}`, borderRadius: 7, overflow: "hidden" }}>
                            <button type="button" aria-label="Fewer" disabled={blocked || qNow <= 1} onClick={() => setQty(it, qNow - 1, cap)} style={{ width: 24, height: 24, border: "none", background: "transparent", color: textP, fontSize: 14, cursor: blocked || qNow <= 1 ? "not-allowed" : "pointer", opacity: blocked || qNow <= 1 ? 0.35 : 1 }}>−</button>
                            <input value={blocked ? 0 : qNow} disabled={blocked} inputMode="numeric" aria-label="Quantity" onChange={(e) => setQty(it, e.target.value.replace(/\D/g, ""), cap)}
                              style={{ width: 30, height: 24, border: "none", borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: "center", fontSize: 12, fontWeight: 700, color: textP, background: "transparent" }} />
                            <button type="button" aria-label="More" disabled={blocked || qNow >= cap} title={!blocked && qNow >= cap && cap !== Infinity ? `Only ${cap} free on this date` : undefined} onClick={() => setQty(it, qNow + 1, cap)} style={{ width: 24, height: 24, border: "none", background: "transparent", color: textP, fontSize: 14, cursor: blocked || qNow >= cap ? "not-allowed" : "pointer", opacity: blocked || qNow >= cap ? 0.35 : 1 }}>+</button>
                          </div>
                          <button type="button" disabled={blocked} onClick={() => { if (!blocked) onSelect(it, qNow); }}
                            style={{ marginLeft: "auto", height: 24, padding: "0 9px", borderRadius: 7, border: "none", background: blocked ? "#9CA3AF" : accent, color: "#fff", fontSize: 11, fontWeight: 700, cursor: blocked ? "not-allowed" : "pointer" }}>{blocked ? "Not free" : "Select"}</button>
                        </div>
                      )}
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

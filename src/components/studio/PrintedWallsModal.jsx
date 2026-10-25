import { useMemo, useState } from "react";
import { priceForInvItem, itemDimsText } from "../../lib/ims/helpers";
import { fitUrl } from "../../lib/studio/thumb.js";

// "Existing Printed Walls" — the printed wall designs already in IMS (Fabric › Printed Walls), to pick instead of
// printing something new. Each is a ready piece of a fixed size at its own rental rate, so picking one adds it to the
// zone as an ordinary inventory element: it is priced, stock-checked and listed like any other item, and no print job
// is needed. Cards show the design, its size, its price, and whether it is free on the event date.
//
//   freeFor(item)   how many are free on the event date (after other events and the rest of this deal)
//   inZoneIds       ids already in this zone — shown, but not pickable twice
export default function PrintedWallsModal({
  imsInventory, rcFactorByKey, freeFor, inZoneIds, dateLabel, zoneName,
  onSelect, onClose, isDark, border, textP, textS, cardBg, accent = "#0EA5E9",
}) {
  const [q, setQ] = useState("");
  const [size, setSize] = useState("");

  const all = useMemo(() => (imsInventory || [])
    .filter((it) => {
      const cat = String(it.cat || it.category || "").toLowerCase();
      const sub = String(it.subCat || it.subcategory || "").toLowerCase();
      return cat.includes("fabric") && sub.includes("printed wall");
    })
    .map((it) => {
      const free = Math.max(0, Number(freeFor ? freeFor(it) : 0) || 0);
      const inZone = !!(inZoneIds && inZoneIds.has(it.id));
      return { it, free, inZone, price: priceForInvItem(it, rcFactorByKey, imsInventory), dims: itemDimsText(it) };
    }), [imsInventory, rcFactorByKey, freeFor, inZoneIds]);

  // size chips: each distinct size once, the commonest first
  const sizes = useMemo(() => {
    const m = new Map();
    all.forEach((r) => { if (r.dims) m.set(r.dims, (m.get(r.dims) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ d, n }));
  }, [all]);

  const shown = useMemo(() => {
    const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return all
      .filter((r) => (!size || r.dims === size) && tokens.every((t) => String(r.it.name || "").toLowerCase().includes(t)))
      // pickable first; among them the ones with a rate before the ones IMS has no rate for; then cheapest
      .sort((a, b) => (Number(b.free > 0 && !b.inZone) - Number(a.free > 0 && !a.inZone)) || (Number(b.price > 0) - Number(a.price > 0)) || (a.price - b.price));
  }, [all, q, size]);

  // One look for the search box and the size dropdown, so they sit level with each other.
  const field = {
    height: 34, boxSizing: "border-box", padding: "0 10px", borderRadius: 8, border: `1px solid ${border}`,
    background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 12, fontFamily: "inherit",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10500, background: "rgba(10,10,20,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Existing printed walls"
        style={{ width: "min(960px, 100%)", maxHeight: "88vh", background: isDark ? "#0F0F1A" : "#fff", borderRadius: 14, border: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: textP }}>🖼️ Existing Printed Walls</div>
            <div style={{ fontSize: 11, color: textS, marginTop: 3 }}>
              Pick a design we already have instead of printing a new one — it is added to {zoneName || "this zone"} at its own rate{dateLabel ? ` · free on ${dateLabel}` : ""}.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 13, cursor: "pointer" }}>✕</button>
        </div>

        {/* Search and size filter on one line, same height, aligned. */}
        <div style={{ padding: "10px 18px 6px", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search designs…" aria-label="Search designs"
            style={{ ...field, flex: "1 1 120px", maxWidth: 240, minWidth: 0 }} />
          {sizes.length > 1 && (
            <select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Filter by size"
              style={{ ...field, flex: "0 1 190px", minWidth: 0, cursor: "pointer" }}>
              <option value="">All sizes ({all.length})</option>
              {sizes.map(({ d, n }) => <option key={d} value={d}>{d} ({n})</option>)}
            </select>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: textS, whiteSpace: "nowrap" }}>{shown.length} design{shown.length === 1 ? "" : "s"}</span>
        </div>

        <div style={{ padding: "6px 18px 16px", overflowY: "auto", flex: 1 }}>
          {all.length === 0 ? (
            <div style={{ padding: "24px 10px", textAlign: "center", color: textS, fontSize: 11, borderRadius: 8, border: `1px dashed ${border}` }}>
              No printed wall designs in IMS yet (Inventory → Fabric › Printed Walls).
            </div>
          ) : shown.length === 0 ? (
            <div style={{ padding: "24px 10px", textAlign: "center", color: textS, fontSize: 11, borderRadius: 8, border: `1px dashed ${border}` }}>No design matches.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {shown.map(({ it, free, inZone, price, dims }) => {
                const pickable = free > 0 && !inZone;
                const src = it.img || it.photoUrls?.[0];
                const badge = inZone
                  ? { t: "Already in this zone", c: textS }
                  : free > 0 ? { t: `${free} free${dateLabel ? "" : ""}`, c: "#10B981" } : { t: "Not free on this date", c: "#EF4444" };
                return (
                  <button key={it.id} type="button" disabled={!pickable} onClick={() => pickable && onSelect(it)}
                    title={pickable ? `Add ${it.name}` : badge.t}
                    style={{ textAlign: "left", padding: 0, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column",
                      border: `1px solid ${border}`, background: isDark ? "#12121F" : "#fafafa", opacity: pickable ? 1 : 0.5,
                      cursor: pickable ? "pointer" : "not-allowed", color: textP }}>
                    <div style={{ width: "100%", height: 130, background: isDark ? "#1a1a2e" : "#eee", position: "relative", flexShrink: 0 }}>
                      {src
                        ? <img src={fitUrl(src, 260)} alt={it.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: textS }}>🖼️</div>}
                      {/* A design IMS has no rate for would add nothing to the cost — say so, don't show ₹0 as if it were a price. */}
                      <div style={{ position: "absolute", bottom: 0, right: 0, background: price > 0 ? accent : "#D97706", color: "#fff", padding: "2px 8px", borderTopLeftRadius: 8, fontSize: 11, fontWeight: 700 }}>{price > 0 ? `₹${Math.round(price).toLocaleString("en-IN")}` : "No rate set"}</div>
                    </div>
                    <div style={{ padding: "7px 9px" }}>
                      <div title={it.name} style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.name}</div>
                      <div style={{ fontSize: 10, color: textS, marginTop: 3 }}>{dims ? `📐 ${dims}` : "Size not set"}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: badge.c, marginTop: 3 }}>{badge.t}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

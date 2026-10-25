import { useMemo, useState } from "react";
import { priceForInvItem, itemDimsText } from "../../lib/ims/helpers";
import { fitUrl } from "../../lib/studio/thumb.js";
import { PhotoLightbox } from "../shared/ClickablePhoto.jsx";

// "Existing Printed Walls" — the printed wall designs already in IMS (Fabric › Printed Walls), to pick instead of
// printing something new. Each is a ready piece of a fixed size at its own rental rate, so picking one adds it to the
// zone as an ordinary inventory element: it is priced, stock-checked and listed like any other item, and no print job
// is needed. Cards show the design, its size, its price, and whether it is free on the event date.
// Several designs can be ticked in one go; a bar at the bottom then adds them all to the zone together.
//
//   freeFor(item)   how many are free on the event date (after other events and the rest of this deal)
//   inZoneIds       ids already in this zone — shown, but not pickable twice
//   onAdd(items)    the ticked designs, once the person confirms
export default function PrintedWallsModal({
  imsInventory, rcFactorByKey, freeFor, inZoneIds, dateLabel, zoneName, multiplier = 1, multiplierNote = "",
  onAdd, onClose, isDark, border, textP, textS, cardBg, accent = "#0EA5E9",
}) {
  const [q, setQ] = useState("");
  const [size, setSize] = useState("");
  const [viewIdx, setViewIdx] = useState(null);   // index into `viewSet` while the big photo is open
  const [sel, setSel] = useState([]);              // ids ticked so far, in the order they were ticked
  const toggle = (id) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const all = useMemo(() => (imsInventory || [])
    .filter((it) => {
      const cat = String(it.cat || it.category || "").toLowerCase();
      const sub = String(it.subCat || it.subcategory || "").toLowerCase();
      return cat.includes("fabric") && sub.includes("printed wall");
    })
    .map((it) => {
      const free = Math.max(0, Number(freeFor ? freeFor(it) : 0) || 0);
      const inZone = !!(inZoneIds && inZoneIds.has(it.id));
      // base rate × the sub-category factor, then the same guest-price level and date category the zone's other elements are
      // charged at — so the price on the card is what the zone will be billed, not a lower list price.
      return { it, free, inZone, price: priceForInvItem(it, rcFactorByKey, imsInventory) * (Number(multiplier) || 1), dims: itemDimsText(it) };
    }), [imsInventory, rcFactorByKey, freeFor, inZoneIds, multiplier]);

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

  const picked = useMemo(() => sel.map((id) => all.find((r) => r.it.id === id)).filter((r) => r && r.free > 0 && !r.inZone), [sel, all]);
  const pickedTotal = picked.reduce((s, r) => s + r.price, 0);
  const reasonFor = (r) => (r.inZone ? "Already in this zone" : r.free > 0 ? "" : "Not free on this date");
  const viewSet = useMemo(() => shown.filter((r) => r.it.img || r.it.photoUrls?.[0]).map((r) => {
    const pickable = r.free > 0 && !r.inZone;
    const on = sel.includes(r.it.id);
    return {
      r,
      item: {
        src: r.it.img || r.it.photoUrls[0],
        name: String(r.it.name || "").trim(),
        details: [
          ["Size", r.dims || "Not set"],
          ["Rate", r.price > 0 ? `₹${Math.round(r.price).toLocaleString("en-IN")}` : "No rate set in IMS"],
          ["Available", r.inZone ? "Already in this zone" : r.free > 0 ? `${r.free} free${dateLabel ? ` on ${dateLabel}` : ""}` : "Not free on this date"],
        ],
        pick: { label: on ? "✓ Selected — tap to remove" : "＋ Select", disabled: !pickable, note: pickable ? "" : reasonFor(r), keepOpen: true, onClick: () => toggle(r.it.id) },
      },
    };
  }), [shown, dateLabel, sel]);

  // One look for the search box and the size dropdown, so they sit level with each other.
  const field = {
    height: 34, boxSizing: "border-box", padding: "0 10px", borderRadius: 8, border: `1px solid ${border}`,
    background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 12, fontFamily: "inherit",
  };

  return (
    <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10500, background: "rgba(10,10,20,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Existing printed walls"
        style={{ width: "min(960px, 100%)", maxHeight: "88vh", background: isDark ? "#0F0F1A" : "#fff", borderRadius: 14, border: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: textP }}>🖼️ Existing Printed Walls</div>
            <div style={{ fontSize: 11, color: textS, marginTop: 3 }}>
              Tick the designs we already have instead of printing new ones, then add them to {zoneName || "this zone"} — each at its own rate{dateLabel ? ` · free on ${dateLabel}` : ""}.
            </div>
            {multiplierNote && <div style={{ fontSize: 11, color: accent, marginTop: 2, fontWeight: 600 }}>Prices shown include {multiplierNote}.</div>}
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
              {shown.map((r) => {
                const { it, free, inZone, price, dims } = r;
                const pickable = free > 0 && !inZone;
                const on = pickable && sel.includes(it.id);
                const src = it.img || it.photoUrls?.[0];
                const at = viewSet.findIndex((v) => v.r.it.id === it.id);
                const badge = inZone
                  ? { t: "Already in this zone", c: textS }
                  : free > 0 ? { t: `${free} free`, c: "#10B981" } : { t: "Not free on this date", c: "#EF4444" };
                return (
                  <div key={it.id} style={{ borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", border: `${on ? 2 : 1}px solid ${on ? "#7C3AED" : border}`, background: isDark ? "#12121F" : "#fafafa", color: textP }}>
                    {/* the picture opens the big view (‹ › walk the other designs); it never adds */}
                    <div role={src ? "button" : undefined} tabIndex={src ? 0 : undefined} aria-label={src ? `View ${it.name}` : undefined}
                      onClick={() => at >= 0 && setViewIdx(at)} onKeyDown={(e) => { if (src && at >= 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setViewIdx(at); } }}
                      style={{ width: "100%", height: 130, background: isDark ? "#1a1a2e" : "#eee", position: "relative", flexShrink: 0, cursor: src ? "zoom-in" : "default", opacity: pickable ? 1 : 0.55 }}>
                      {src
                        ? <img src={fitUrl(src, 260)} alt={it.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: textS }}>🖼️</div>}
                      {/* A design IMS has no rate for would add nothing to the cost — say so, don't show ₹0 as if it were a price. */}
                      <div style={{ position: "absolute", bottom: 0, right: 0, background: price > 0 ? accent : "#D97706", color: "#fff", padding: "2px 8px", borderTopLeftRadius: 8, fontSize: 11, fontWeight: 700 }}>{price > 0 ? `₹${Math.round(price).toLocaleString("en-IN")}` : "No rate set"}</div>
                    </div>
                    <div style={{ padding: "7px 9px", flex: 1 }}>
                      <div title={it.name} style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.name}</div>
                      <div style={{ fontSize: 10, color: textS, marginTop: 3 }}>{dims ? `📐 ${dims}` : "Size not set"}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: badge.c, marginTop: 3 }}>{badge.t}</div>
                    </div>
                    <div style={{ padding: "0 9px 9px" }}>
                      <button type="button" disabled={!pickable} onClick={() => toggle(it.id)} aria-pressed={on} title={pickable ? (on ? `Remove ${it.name}` : `Select ${it.name}`) : badge.t}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 7, border: `1px solid ${pickable ? "#7C3AED" : border}`, background: on ? "#7C3AED" : pickable ? "rgba(124,58,237,0.12)" : "transparent", color: on ? "#fff" : pickable ? "#7C3AED" : textS, fontSize: 11.5, fontWeight: 700, cursor: pickable ? "pointer" : "not-allowed" }}>
                        {on ? "✓ Selected" : "＋ Select"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Appears once something is ticked: what is chosen, and the one button that adds it all. */}
        {picked.length > 0 && (
          <div style={{ padding: "10px 18px", borderTop: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: isDark ? "#12121F" : "#faf8ff" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: textP }}>{picked.length} selected</span>
            {pickedTotal > 0 && <span style={{ fontSize: 11, color: textS }}>· ₹{Math.round(pickedTotal).toLocaleString("en-IN")} total</span>}
            <button type="button" onClick={() => setSel([])}
              style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            <button type="button" onClick={() => onAdd(picked.map((r) => r.it))}
              style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              Add {picked.length} to {zoneName || "this zone"}
            </button>
          </div>
        )}
      </div>
    </div>
    {viewIdx !== null && viewSet[viewIdx] && (
      <PhotoLightbox items={viewSet.map((v) => v.item)} start={viewIdx} onClose={() => setViewIdx(null)} />
    )}
    </>
  );
}

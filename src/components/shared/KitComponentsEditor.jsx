import { useState } from "react";

// Shared "expand a kit element to its components, with editable per-instance counts" block —
// used by Library's Element Breakdown (ManageLibrary.jsx) and the Build page (StudioBuild.jsx) so
// a kit shows the same count-customizable breakdown Deal Check already has (DealCheckOverlay.jsx's
// "📦 Kit — blocks these together" block), scoped down to quantity editing only (no
// availability/swap-to-alternative — those depend on Deal Check's per-date booking context, which
// doesn't exist here).
//
// `overrides` (el.kitOverrides), when set, replaces the kit's own global `item.subItems` recipe for
// THIS element instance only — every other place that kit is used (its own Edit screen, other
// photos/zones) is unaffected. `onChange(nextOverrides)` persists the edit onto the element;
// `onChange(undefined)` resets back to the kit's live default recipe.
export default function KitComponentsEditor({ item, overrides, onChange, imsInventory, qtyMultiplier = 1, textP, textS, border, cardBg, accent, isDark, fmt }) {
  // Hover-to-zoom on a component thumbnail — same fixed-position enlarged-preview pattern as the
  // Element Breakdown's own thumbnail (ManageLibrary.jsx's elHoverImg), kept local to this component
  // since every caller renders its own independent instance.
  const [hoverImg, setHoverImg] = useState(null); // { idx, top, bottom, left }
  if (!item) return null;
  const comps = Array.isArray(overrides) ? overrides : (Array.isArray(item.subItems) ? item.subItems.map(s => ({ itemId: s.itemId, qty: Number(s.qty) || 1 })) : []);
  const isEdited = Array.isArray(overrides);
  const kitBase = Number(item.kitBase) || 0;
  const componentsTotal = comps.reduce((sum, c) => { const ci = (imsInventory || []).find(i => i.id === c.itemId); const r = ci ? (Number(ci.price ?? ci.rentalCost) || 0) : 0; return sum + r * (Number(c.qty) || 0); }, 0);
  const partsTotal = kitBase + componentsTotal;
  const setComps = (next) => onChange(next);
  const resetKit = () => onChange(undefined);
  return (
    <div style={{ marginTop: 6, marginBottom: 4, padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.05)", border: `1px solid rgba(99,102,241,0.25)` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#A5B4FC", letterSpacing: 0.3 }}>📦 Kit — includes:{isEdited && <span style={{ color: "#F59E0B", marginLeft: 5 }}>· edited</span>}</span>
        {isEdited && <span onClick={resetKit} style={{ fontSize: 9, color: textS, cursor: "pointer", textDecoration: "underline" }}>reset to default</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {comps.map((c, ci) => {
          const cItem = (imsInventory || []).find(i => i.id === c.itemId);
          const qtyEach = Number(c.qty) || 0;
          const cSrc = cItem?.img || cItem?.photoUrls?.[0];
          const cRate = cItem ? (Number(cItem.price ?? cItem.rentalCost) || 0) : 0;
          return (
            <div key={ci} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <div style={{ position: "relative", flexShrink: 0 }}
                onMouseEnter={(e) => {
                  if (!cSrc) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const POP = 164;
                  const openUp = window.innerHeight - r.bottom < POP + 8 && r.top > POP + 8;
                  setHoverImg({ idx: ci, openUp, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined, left: Math.min(r.left, window.innerWidth - 168) });
                }}
                onMouseLeave={() => setHoverImg(null)}>
                {cSrc ? <img src={cSrc} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover", cursor: "zoom-in" }} /> : <span style={{ width: 22, height: 22, borderRadius: 4, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>📦</span>}
                {hoverImg?.idx === ci && cSrc && (
                  <div style={{ position: "fixed", top: hoverImg.top, bottom: hoverImg.bottom, left: hoverImg.left, zIndex: 10000, width: 160, height: 160, borderRadius: 8, overflow: "hidden", border: `2px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                    <img src={cSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}
              </div>
              <span style={{ color: cItem ? textP : "#EF4444", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cItem ? cItem.name : `⚠ ${c.itemId} not in IMS`}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="per kit">
                <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: Math.max(0, qtyEach - 1) } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>−</span>
                <span style={{ color: textP, minWidth: 20, textAlign: "center" }}>×{qtyEach}</span>
                <span onClick={() => setComps(comps.map((x, i) => i === ci ? { ...x, qty: qtyEach + 1 } : x))} style={{ cursor: "pointer", color: textS, fontSize: 14, padding: "0 4px", userSelect: "none" }}>+</span>
              </div>
              {qtyMultiplier > 1 && <span style={{ color: textS, fontSize: 10, whiteSpace: "nowrap" }}>× {qtyMultiplier} = <b style={{ color: textP }}>{qtyEach * qtyMultiplier}</b></span>}
              {cItem && <span style={{ color: textS, whiteSpace: "nowrap", opacity: 0.85 }}>₹{cRate.toLocaleString("en-IN")} × {qtyEach} = <b style={{ color: "#A5B4FC" }}>₹{(cRate * qtyEach).toLocaleString("en-IN")}</b></span>}
              <span onClick={() => setComps(comps.filter((_, i) => i !== ci))} style={{ color: "#EF4444", cursor: "pointer", fontSize: 14, padding: "0 2px" }} title="Remove component">×</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 5, display: "flex", gap: 6 }}>
        <input list={`kit-add-${item.id}`} placeholder="+ add an item to this kit…" onChange={(e) => { const nm = e.target.value; const it = (imsInventory || []).find(x => x.name === nm); if (it) { setComps(comps.some(c => c.itemId === it.id) ? comps : [...comps, { itemId: it.id, qty: 1 }]); e.target.value = ""; } }} style={{ flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textP }} />
        <datalist id={`kit-add-${item.id}`}>
          {(imsInventory || []).filter(x => !comps.some(c => c.itemId === x.id)).slice(0, 400).map(x => <option key={x.id} value={x.name} />)}
        </datalist>
      </div>
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid rgba(99,102,241,0.2)`, display: "flex", justifyContent: "space-between", fontSize: 10 }}>
        <span style={{ color: textS }}>Kit rental = {kitBase > 0 ? `base ₹${kitBase.toLocaleString("en-IN")} + ` : ""}components ₹{componentsTotal.toLocaleString("en-IN")} = ₹{partsTotal.toLocaleString("en-IN")}{qtyMultiplier > 1 ? ` × ${qtyMultiplier}` : ""}</span>
        <span style={{ color: "#A5B4FC", fontWeight: 700 }}>{fmt ? fmt(partsTotal * qtyMultiplier) : `₹${(partsTotal * qtyMultiplier).toLocaleString("en-IN")}`}</span>
      </div>
    </div>
  );
}

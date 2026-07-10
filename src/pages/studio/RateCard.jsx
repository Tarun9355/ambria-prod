// Studio → Pricing → Rate Card — READ-ONLY reference view.
// Rate Card → IMS migration Phase 3: editing authority (items + categories) has moved to IMS
// (Admin → Settings → 💰 Rate Card). This page still reads `rcItems`/`rcCats` live via Studio's
// existing realtime subscription (StudioApp.jsx), so edits made in IMS show up here immediately —
// it's kept as a fast lookup for salespeople while quoting, not an editor.
// Tagging-visibility (isSubTagHidden/toggleTagHiddenSub) stays interactive here — it's a Studio-side
// tagging concern, not Rate Card pricing, and was never part of the IMS migration's scope.
import { useState } from "react";
import TransportEditor from "./TransportEditor.jsx";

export default function RateCard({ ctx }) {
  const {
    S, isDark, accent, border, textP, textS, cardBg,
    rcItems, rcCats,
    rcCat, setRcCat, rcSearch, setRcSearch, rcEditId, setRcEditId, rcTab, setRcTab,
    RC_UNITS, rcIsSMB, getFloralMode,
    isSubTagHidden, toggleTagHiddenSub,
  } = ctx;

  const isNotRated = (i) => i.unit !== "included" && i.unit !== "multiplier" && (i.inhouseFlat || 0) === 0 && (i.inhouseS || 0) === 0 && (i.inhouseM || 0) === 0 && (i.inhouseB || 0) === 0;
  const rcFmt = (n) => { const v = Number(n) || 0; return v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${v.toLocaleString("en-IN")}`; };
  const unitLabel = (u) => RC_UNITS.find((x) => x.id === u)?.l || u;
  const rcStats = { t: rcItems.length, nr: rcItems.filter(isNotRated).length };

  // Quick sub-category filter (local — resets naturally when the category has no such sub).
  const [subFilter, setSubFilter] = useState("");

  const rcFiltered = rcItems.filter((i) => {
    if (i.cat !== rcCat) return false;
    if (rcSearch.trim()) { const q = rcSearch.toLowerCase(); return (i.name || "").toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q); }
    return true;
  });
  const rcGrouped = {}; rcFiltered.forEach((i) => { const k = i.sub || "General"; (rcGrouped[k] = rcGrouped[k] || []).push(i); });
  const subOptions = Object.keys(rcGrouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const activeSub = subFilter && subOptions.includes(subFilter) ? subFilter : "";
  const groupEntries = subOptions
    .filter((sub) => !activeSub || sub === activeSub)
    .map((sub) => [sub, rcGrouped[sub]]);
  const subChip = (active) => ({ padding: "5px 11px", borderRadius: 14, border: `1px solid ${active ? accent : border}`, cursor: "pointer", fontSize: 11, fontWeight: 600, background: active ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.04)", color: active ? accent : textS, whiteSpace: "nowrap" });

  const RCP = ({ item }) => {
    const nr = isNotRated(item);
    if (item.unit === "included") return <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Included</span>;
    if (item.unit === "multiplier") return <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>×{item.inhouseFlat || 0}</span>;
    if (rcIsSMB(item)) return <div style={{ display: "flex", gap: 6 }}>{[["S", item.inhouseS], ["M", item.inhouseM], ["B", item.inhouseB]].map(([l, v]) => <div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: textS, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 700, color: (v || 0) === 0 ? "#F59E0B" : (isDark ? "#fff" : "#111") }}>{(v || 0) === 0 ? "⚠️" : rcFmt(v)}</div></div>)}</div>;
    return <span style={{ fontSize: 16, fontWeight: 700, color: nr ? "#F59E0B" : (isDark ? "#fff" : "#111") }}>{nr ? "⚠️ Not set" : rcFmt(item.inhouseFlat)}</span>;
  };

  const curCat = rcCats.find((c) => c.id === rcCat);

  return (<div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>💰 Rate Card <span style={{ fontSize: 11, fontWeight: 600, color: textS, marginLeft: 8 }}>(read-only)</span></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {[["ratecard", "💰 Rate Card"], ["transport", "🚛 Transport & Power"]].map(([t, l]) => (
          <button key={t} onClick={() => setRcTab(t)} style={{ padding: "8px 18px", borderRadius: 20, border: rcTab === t ? `2px solid ${accent}` : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, background: rcTab === t ? "rgba(201,169,110,0.08)" : "rgba(255,255,255,0.04)", color: rcTab === t ? accent : textS }}>{l}</button>
        ))}
        <span style={{ fontSize: 11, color: textS }}>{rcStats.t} items</span>
        {rcStats.nr > 0 && <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>⚠ {rcStats.nr} need rates</span>}
      </div>
    </div>
    <div style={{ marginBottom: 20, padding: "8px 14px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", fontSize: 11, color: textS }}>
      🔗 Pricing and categories are now managed in IMS (Admin → Settings → 💰 Rate Card). Edits made there appear here automatically.
    </div>

    {rcTab === "ratecard" && <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
      {/* Sidebar — categories, browse only */}
      <div>
        <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, fontWeight: 700, color: textS }}>Categories</span></div>
        {rcCats.map((c) => { const n = rcItems.filter((i) => i.cat === c.id).length; const nr = rcItems.filter((i) => i.cat === c.id && isNotRated(i)).length;
            return <div key={c.id} onClick={() => { setRcCat(c.id); setRcSearch(""); }} style={{ padding: "8px 12px", borderRadius: 10, marginBottom: 4, cursor: "pointer", background: rcCat === c.id ? "rgba(201,169,110,0.1)" : cardBg, border: `1px solid ${rcCat === c.id ? accent + "40" : border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13 }}>{c.icon}</span><span style={{ fontSize: 11, fontWeight: rcCat === c.id ? 600 : 400, color: rcCat === c.id ? accent : textP }}>{c.l}</span></div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: textS }}>{n}</span>{nr > 0 && <span style={{ width: 5, height: 5, borderRadius: 3, background: "#F59E0B" }} />}</div></div>
            </div>; })}
        <div style={{ marginTop: 12, padding: 12, background: cardBg, borderRadius: 10, border: `1px solid ${border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 6 }}>📊 Health</div>
          {[["Total", rcStats.t, isDark ? "#fff" : "#111"], ["Priced", rcStats.t - rcStats.nr, "#059669"], ["Need Rates", rcStats.nr, rcStats.nr > 0 ? "#F59E0B" : "#059669"]].map(([l, v, col]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}><span style={{ color: textS }}>{l}</span><span style={{ fontWeight: 700, color: col }}>{v}</span></div>))}
        </div>
      </div>

      {/* Items — browse only, no add/edit/delete */}
      <div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, position: "relative" }}><input value={rcSearch} onChange={(e) => setRcSearch(e.target.value)} placeholder="Search items..." style={{ ...S.input, paddingLeft: 36 }} /><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, opacity: 0.4 }}>🔍</span></div>
        </div>

        {subOptions.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
            <button onClick={() => setSubFilter("")} style={subChip(!activeSub)}>All ({rcFiltered.length})</button>
            {subOptions.map((s) => (
              <button key={s} onClick={() => setSubFilter(activeSub === s ? "" : s)} style={subChip(activeSub === s)}>{s} <span style={{ opacity: 0.6 }}>({rcGrouped[s].length})</span></button>
            ))}
          </div>
        )}

        {groupEntries.map(([sub, items]) => (
          <div key={sub} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><div style={{ width: 3, height: 12, borderRadius: 2, background: curCat?.c || accent }} /><div style={{ fontSize: 13, fontWeight: 700, color: curCat?.c || accent }}>{sub}</div><div style={{ fontSize: 10, color: textS }}>({items.length})</div>
              {/* Tagging visibility toggle — Studio-side tagging concern, stays interactive/editable here. */}
              {(() => { const subRaw = (items[0]?.sub) || ""; const hidden = isSubTagHidden ? isSubTagHidden(rcCat, subRaw) : false; return (
                <button onClick={() => toggleTagHiddenSub && toggleTagHiddenSub(rcCat, subRaw)} title={hidden ? "Hidden from photo tagging — click to make taggable" : "Shows during photo tagging — click to hide it"} style={{ marginLeft: "auto", padding: "3px 9px", borderRadius: 12, border: `1px solid ${hidden ? "#F87171" : border}`, background: hidden ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.04)", color: hidden ? "#F87171" : textS, fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{hidden ? "🚫 No-tag" : "🏷️ Taggable"}</button>
              ); })()}
            </div>
            {items.map((item) => { const isO = rcEditId === item.id; const isFloral = (item.cat || "").toLowerCase() === "florals"; return (
              <div key={item.id} style={{ ...S.card, marginBottom: 5, overflow: "hidden", border: isO ? `2px solid ${accent}` : `1px solid ${border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer" }} onClick={() => setRcEditId(isO ? null : item.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: textP }}>{item.name}</span>
                    {item.outEnabled && <span style={{ fontSize: 8, padding: "2px 5px", borderRadius: 3, background: "rgba(245,158,11,0.1)", color: "#F59E0B", fontWeight: 700 }}>+OUT</span>}
                    {item._imsDriven && <span title="Auto-priced from IMS recipe" style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "rgba(16,185,129,0.18)", color: "#10B981", fontWeight: 700 }}>🔒 IMS-DRIVEN</span>}
                    {isFloral && (() => { const m = getFloralMode(item); return m === "real" ? <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "rgba(16,185,129,0.18)", color: "#10B981", fontWeight: 700 }}>🎯 100% REAL</span> : m === "artificial" ? <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "rgba(236,72,153,0.18)", color: "#EC4899", fontWeight: 700 }}>🎯 100% ARTIFICIAL</span> : <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "rgba(148,163,184,0.15)", color: "#94A3B8", fontWeight: 700 }}>🌐 RATIO-DRIVEN</span>; })()}
                  </div>
                  <RCP item={item} />
                </div>
                {!isO && item.notes && <div style={{ padding: "0 14px 6px", fontSize: 10, color: item.notes.includes("⚠") || item.notes.includes("Set") ? "#F59E0B" : textS }}>{item.notes}</div>}
                {isO && <div style={{ padding: "14px 18px", borderTop: `1px solid ${border}`, background: isDark ? "#0D0D18" : "#F9F9F6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12, fontSize: 12 }}>
                    <div><div style={S.label}>Category</div><div style={{ color: textP }}>{curCat?.l}</div></div>
                    <div><div style={S.label}>Sub-Category</div><div style={{ color: textP }}>{item.sub || "—"}</div></div>
                    <div><div style={S.label}>Unit</div><div style={{ color: textP }}>{unitLabel(item.unit)}</div></div>
                    <div><div style={S.label}>IMS sub-category alias</div><div style={{ color: textP }}>{item.imsAlias || <span style={{ opacity: 0.5 }}>same as sub-category</span>}</div></div>
                  </div>
                  <div style={{ background: isDark ? "#0F0F1A" : "#fff", borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 8 }}>🏠 Inhouse</div>
                    {item.inhouseMode === "flat"
                      ? <div style={{ fontSize: 16, fontWeight: 700, color: isDark ? "#fff" : "#111" }}>₹{(item.inhouseFlat || 0).toLocaleString("en-IN")}</div>
                      : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => <div key={f} style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: textS, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: isDark ? "#fff" : "#111" }}>₹{(item[f] || 0).toLocaleString("en-IN")}</div></div>)}</div>}
                  </div>
                  {item.outEnabled && <div style={{ background: isDark ? "#0F0F1A" : "#fff", borderRadius: 10, padding: 12, marginBottom: 10, border: "1px solid #F59E0B30" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 8 }}>🏭 Outsource</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[["S", "outS"], ["M", "outM"], ["B", "outB"]].map(([l, f]) => <div key={f} style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: textS, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: isDark ? "#fff" : "#111" }}>₹{(item[f] || 0).toLocaleString("en-IN")}</div></div>)}</div>
                  </div>}
                  {item.notes && <div style={{ fontSize: 11, color: textS }}><span style={S.label}>Notes</span> {item.notes}</div>}
                </div>}
              </div>); })}
          </div>
        ))}
        {groupEntries.length === 0 && <div style={{ textAlign: "center", padding: 40, color: textS }}>{rcSearch ? "No matches" : "No items in this category"}</div>}
      </div>
    </div>}

    {rcTab === "transport" && <TransportEditor ctx={ctx} />}
  </div>);
}

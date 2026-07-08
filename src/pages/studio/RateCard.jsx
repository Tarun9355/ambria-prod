// Studio → Pricing → Rate Card Manager v2 — faithful dark-theme transcription of
// the reference AdminRates (App_latest.jsx ~7480), driven off ctx. Holds the
// Rate Card / Transport & Power toggle; the Transport tab renders TransportEditor.
import { useState } from "react";
import TransportEditor from "./TransportEditor.jsx";

const NUM_FIELDS = ["inhouseFlat", "inhouseS", "inhouseM", "inhouseB", "outS", "outM", "outB", "artificialFlat", "artificialS", "artificialM", "artificialB", "defaultRealPct"];

export default function RateCard({ ctx }) {
  const {
    S, isDark, accent, border, textP, textS, cardBg, showMsg, floralRatio,
    rcItems, saveRC, rcCats, setRcCats, saveRcCats,
    rcCat, setRcCat, rcSearch, setRcSearch, rcEditId, setRcEditId, rcTab, setRcTab,
    rcCatEditMode, setRcCatEditMode, rcAddMode, setRcAddMode, rcSubOpen, setRcSubOpen,
    rcNewForm, setRcNewForm, RC_UNITS, rcIsSMB, getFloralMode,
    isSubTagHidden, toggleTagHiddenSub,
  } = ctx;

  const isNotRated = (i) => i.unit !== "included" && i.unit !== "multiplier" && (i.inhouseFlat || 0) === 0 && (i.inhouseS || 0) === 0 && (i.inhouseM || 0) === 0 && (i.inhouseB || 0) === 0;
  const rcFmt = (n) => { const v = Number(n) || 0; return v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${v.toLocaleString("en-IN")}`; };
  const rcStats = { t: rcItems.length, nr: rcItems.filter(isNotRated).length };
  const rcUpd = (id, f, v) => { const isN = NUM_FIELDS.includes(f); saveRC(rcItems.map((i) => (i.id === id ? { ...i, [f]: isN ? Number(v) || 0 : v } : i))); };
  const rcDel = (id) => { const it = rcItems.find((i) => i.id === id); if (!window.confirm(`Delete "${it?.name || "item"}"? This cannot be undone.`)) return; saveRC(rcItems.filter((i) => i.id !== id), [id]); };
  const rcAddItem = () => {
    if (!(rcNewForm.name || "").trim()) { showMsg && showMsg("Item needs a name", "red"); return; }
    const item = { ...rcNewForm, id: "RC" + Date.now().toString(36), cat: rcNewForm.cat || rcCat, sub: rcNewForm.sub || "General", name: rcNewForm.name.trim() };
    saveRC([...rcItems, item]);
    setRcAddMode(false); setRcSubOpen(false);
    setRcNewForm({ cat: rcCat, sub: "", name: "", unit: "pc", inhouseMode: "flat", inhouseFlat: 0, inhouseS: 0, inhouseM: 0, inhouseB: 0, outEnabled: false, outS: 0, outM: 0, outB: 0, notes: "", artificialFlat: 0, artificialS: 0, artificialM: 0, artificialB: 0, defaultRealPct: 100, floralMode: "ratio" });
    showMsg && showMsg("✓ Item added", "green");
  };

  // Quick sub-category filter (local — resets naturally when the category has no such sub).
  const [subFilter, setSubFilter] = useState("");

  const rcFiltered = rcItems.filter((i) => {
    if (i.cat !== rcCat) return false;
    if (rcSearch.trim()) { const q = rcSearch.toLowerCase(); return (i.name || "").toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q); }
    return true;
  });
  const rcGrouped = {}; rcFiltered.forEach((i) => { const k = i.sub || "General"; (rcGrouped[k] = rcGrouped[k] || []).push(i); });
  // Sub-category chips: every sub present (search-aware), sorted A→Z. activeSub auto-clears when
  // it isn't valid for the current view (e.g. after switching category or typing a search).
  const subOptions = Object.keys(rcGrouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const activeSub = subFilter && subOptions.includes(subFilter) ? subFilter : "";
  // Groups to render: A→Z, narrowed to the chosen sub when one is active.
  const groupEntries = subOptions
    .filter((sub) => !activeSub || sub === activeSub)
    .map((sub) => [sub, rcGrouped[sub]]);
  const subChip = (active) => ({ padding: "5px 11px", borderRadius: 14, border: `1px solid ${active ? accent : border}`, cursor: "pointer", fontSize: 11, fontWeight: 600, background: active ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.04)", color: active ? accent : textS, whiteSpace: "nowrap" });

  const RCP = ({ item }) => {
    const nr = isNotRated(item);
    if (item.unit === "included") return <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Included</span>;
    if (item.unit === "multiplier") return <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>×{item.inhouseFlat || 0}</span>;
    if (rcIsSMB(item)) return <div style={{ display: "flex", gap: 6 }}>{[["S", item.inhouseS], ["M", item.inhouseM], ["B", item.inhouseB]].map(([l, v]) => <div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: textS, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 700, color: (v || 0) === 0 ? "#F59E0B" : (isDark ? "#fff" : "#111") }}>{(v || 0) === 0 ? "⚠️" : rcFmt(v)}</div></div>)}</div>;
    return <span style={{ fontSize: 16, fontWeight: 700, color: nr ? "#F59E0B" : (isDark ? "#fff" : "#111") }}>{nr ? "⚠️ Set" : rcFmt(item.inhouseFlat)}</span>;
  };

  const curCat = rcCats.find((c) => c.id === rcCat);

  return (<div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>💰 Rate Card Manager v2</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {[["ratecard", "💰 Rate Card"], ["transport", "🚛 Transport & Power"]].map(([t, l]) => (
          <button key={t} onClick={() => setRcTab(t)} style={{ padding: "8px 18px", borderRadius: 20, border: rcTab === t ? `2px solid ${accent}` : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, background: rcTab === t ? "rgba(201,169,110,0.08)" : "rgba(255,255,255,0.04)", color: rcTab === t ? accent : textS }}>{l}</button>
        ))}
        <span style={{ fontSize: 11, color: textS }}>{rcStats.t} items</span>
        {rcStats.nr > 0 && <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>⚠ {rcStats.nr} need rates</span>}
      </div>
    </div>

    {rcTab === "ratecard" && <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
      {/* Sidebar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: textS }}>Categories</span>
          <button onClick={() => setRcCatEditMode(!rcCatEditMode)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer", background: rcCatEditMode ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.04)", color: rcCatEditMode ? accent : textS }}>{rcCatEditMode ? "✓ Done" : "✏️ Edit"}</button>
        </div>
        {rcCatEditMode && <div>
          {rcCats.map((c, idx) => { const n = rcItems.filter((i) => i.cat === c.id).length; return <div key={c.id} style={{ padding: "8px 10px", borderRadius: 10, marginBottom: 4, background: cardBg, border: `1px solid ${border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
              <input value={c.icon} onChange={(e) => { const nc = [...rcCats]; nc[idx] = { ...nc[idx], icon: e.target.value }; setRcCats(nc); }} style={{ width: 30, padding: "3px 2px", borderRadius: 4, border: `1px solid ${border}`, background: "transparent", color: textP, fontSize: 14, textAlign: "center", outline: "none", fontFamily: "inherit" }} maxLength={2} />
              <input value={c.l} onChange={(e) => { const nc = [...rcCats]; nc[idx] = { ...nc[idx], l: e.target.value }; setRcCats(nc); }} style={{ flex: 1, padding: "3px 6px", borderRadius: 4, border: `1px solid ${border}`, background: "transparent", color: textP, fontSize: 11, fontWeight: 600, outline: "none", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <input type="color" value={c.c || "#C9A96E"} onChange={(e) => { const nc = [...rcCats]; nc[idx] = { ...nc[idx], c: e.target.value }; setRcCats(nc); }} style={{ width: 22, height: 22, border: "none", borderRadius: 4, cursor: "pointer", padding: 0, background: "transparent" }} />
              <input value={c.d || ""} onChange={(e) => { const nc = [...rcCats]; nc[idx] = { ...nc[idx], d: e.target.value }; setRcCats(nc); }} placeholder="Description..." style={{ flex: 1, padding: "3px 6px", borderRadius: 4, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 9, outline: "none", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <div style={{ display: "flex", gap: 3 }}>
                {idx > 0 && <button onClick={() => { const nc = [...rcCats];[nc[idx - 1], nc[idx]] = [nc[idx], nc[idx - 1]]; setRcCats(nc); }} style={{ padding: "2px 6px", borderRadius: 4, border: "none", fontSize: 9, cursor: "pointer", background: "rgba(255,255,255,0.06)", color: textS }}>▲</button>}
                {idx < rcCats.length - 1 && <button onClick={() => { const nc = [...rcCats];[nc[idx], nc[idx + 1]] = [nc[idx + 1], nc[idx]]; setRcCats(nc); }} style={{ padding: "2px 6px", borderRadius: 4, border: "none", fontSize: 9, cursor: "pointer", background: "rgba(255,255,255,0.06)", color: textS }}>▼</button>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 9, color: textS }}>{n} items</span>
                <button onClick={() => { if (n > 0) { showMsg(`Cannot delete — ${n} items use this category. Move them first.`, "red"); return; } if (!window.confirm(`Delete "${c.l}"?`)) return; const nc = rcCats.filter((_, i) => i !== idx); saveRcCats(nc); if (rcCat === c.id && nc.length) setRcCat(nc[0].id); }} style={{ padding: "2px 5px", borderRadius: 4, border: "none", fontSize: 9, cursor: "pointer", background: n > 0 ? "rgba(255,255,255,0.03)" : "rgba(248,113,113,0.1)", color: n > 0 ? textS + "60" : "#F87171" }}>🗑️</button>
              </div>
            </div>
          </div>; })}
          <button onClick={() => { const newId = "cat_" + Date.now().toString(36).slice(-5); setRcCats([...rcCats, { id: newId, l: "New Category", icon: "📦", c: "#9CA3AF", d: "" }]); }} style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: `1px dashed ${accent}40`, background: "transparent", color: accent, fontSize: 11, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>+ Add Category</button>
          <button onClick={async () => { const r = await saveRcCats(rcCats); if (r && r.ok === false) { showMsg && showMsg("Save failed: " + (r.error || "unknown error"), "red"); return; } showMsg && showMsg("✓ Categories saved", "green"); setRcCatEditMode(false); }} style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", background: accent, color: "#0F0F1A", fontSize: 11, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>💾 Save Categories</button>
        </div>}
        {!rcCatEditMode && rcCats.map((c) => { const n = rcItems.filter((i) => i.cat === c.id).length; const nr = rcItems.filter((i) => i.cat === c.id && isNotRated(i)).length;
            return <div key={c.id} onClick={() => { setRcCat(c.id); setRcSearch(""); }} style={{ padding: "8px 12px", borderRadius: 10, marginBottom: 4, cursor: "pointer", background: rcCat === c.id ? "rgba(201,169,110,0.1)" : cardBg, border: `1px solid ${rcCat === c.id ? accent + "40" : border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13 }}>{c.icon}</span><span style={{ fontSize: 11, fontWeight: rcCat === c.id ? 600 : 400, color: rcCat === c.id ? accent : textP }}>{c.l}</span></div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: textS }}>{n}</span>{nr > 0 && <span style={{ width: 5, height: 5, borderRadius: 3, background: "#F59E0B" }} />}</div></div>
            </div>; })}
        <div style={{ marginTop: 12, padding: 12, background: cardBg, borderRadius: 10, border: `1px solid ${border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 6 }}>📊 Health</div>
          {[["Total", rcStats.t, isDark ? "#fff" : "#111"], ["Priced", rcStats.t - rcStats.nr, "#059669"], ["Need Rates", rcStats.nr, rcStats.nr > 0 ? "#F59E0B" : "#059669"]].map(([l, v, col]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}><span style={{ color: textS }}>{l}</span><span style={{ fontWeight: 700, color: col }}>{v}</span></div>))}
        </div>
      </div>

      {/* Items */}
      <div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, position: "relative" }}><input value={rcSearch} onChange={(e) => setRcSearch(e.target.value)} placeholder="Search items..." style={{ ...S.input, paddingLeft: 36 }} /><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, opacity: 0.4 }}>🔍</span></div>
          <button onClick={() => { setRcNewForm((p) => ({ ...p, cat: rcCat })); setRcAddMode(!rcAddMode); setRcSubOpen(false); }} style={{ ...S.btn(true), padding: "10px 16px", fontSize: 12 }}>+ Add Item</button>
        </div>

        {/* Sub-category quick filter — A→Z chips so a long list is easy to jump within */}
        {subOptions.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
            <button onClick={() => setSubFilter("")} style={subChip(!activeSub)}>All ({rcFiltered.length})</button>
            {subOptions.map((s) => (
              <button key={s} onClick={() => setSubFilter(activeSub === s ? "" : s)} style={subChip(activeSub === s)}>{s} <span style={{ opacity: 0.6 }}>({rcGrouped[s].length})</span></button>
            ))}
          </div>
        )}

        {/* Shared sub-category suggestions — rendered always so BOTH the add form and the inline
            edit field get type-ahead. (Edit-field autocomplete regressed after the migration because
            its datalist lived only inside the add block.) Current category first, then the rest. */}
        <datalist id="rc-sub-list">
          {[...new Set([...rcItems.filter((i) => i.cat === rcCat).map((i) => i.sub), ...rcItems.map((i) => i.sub)].filter(Boolean))].map((s) => <option key={s} value={s} />)}
        </datalist>

        {rcAddMode && <div style={{ background: cardBg, borderRadius: 12, padding: 16, marginBottom: 14, border: `2px solid ${accent}40` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: accent, marginBottom: 12 }}>Add New Item to {curCat?.l}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><div style={S.label}>Sub-Category *</div><input value={rcNewForm.sub} onChange={(e) => setRcNewForm((p) => ({ ...p, sub: e.target.value }))} placeholder="e.g. Sofa" list="rc-sub-list" style={S.input} /></div>
            <div><div style={S.label}>Item Name *</div><input value={rcNewForm.name} onChange={(e) => setRcNewForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. 3-Seater" style={S.input} /></div>
            <div><div style={S.label}>Unit</div><select value={rcNewForm.unit} onChange={(e) => setRcNewForm((p) => ({ ...p, unit: e.target.value }))} style={S.select}>{RC_UNITS.map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select></div>
          </div>
          <div style={{ background: isDark ? "#0F0F1A" : "#fff", borderRadius: 8, padding: 12, marginBottom: 10, border: `1px solid ${border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>🏠 Inhouse</span>
              <div style={{ display: "flex", gap: 3 }}>{["flat", "smb"].map((m) => <button key={m} onClick={() => setRcNewForm((p) => ({ ...p, inhouseMode: m }))} style={{ padding: "3px 10px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer", background: rcNewForm.inhouseMode === m ? "#059669" : "rgba(255,255,255,0.04)", color: rcNewForm.inhouseMode === m ? "#fff" : textS }}>{m === "flat" ? "Flat" : "S/M/B"}</button>)}</div>
            </div>
            {rcNewForm.inhouseMode === "flat"
              ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: textS }}>₹</span><input type="number" value={rcNewForm.inhouseFlat} onChange={(e) => setRcNewForm((p) => ({ ...p, inhouseFlat: Number(e.target.value) || 0 }))} style={{ ...S.input, width: 120, fontWeight: 700, textAlign: "right" }} /></div>
              : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => <div key={f}><div style={{ fontSize: 9, color: textS, textAlign: "center", marginBottom: 2 }}>{l}</div><input type="number" value={rcNewForm[f]} onChange={(e) => setRcNewForm((p) => ({ ...p, [f]: Number(e.target.value) || 0 }))} style={{ ...S.input, textAlign: "center", fontWeight: 700 }} /></div>)}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div onClick={() => setRcNewForm((p) => ({ ...p, outEnabled: !p.outEnabled }))} style={{ width: 36, height: 20, borderRadius: 10, background: rcNewForm.outEnabled ? "#F59E0B" : "#374151", position: "relative", cursor: "pointer" }}><div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", position: "absolute", top: 2, left: rcNewForm.outEnabled ? 18 : 2, transition: "left 0.2s" }} /></div>
            <span style={{ fontSize: 11, color: rcNewForm.outEnabled ? "#F59E0B" : textS, fontWeight: 600 }}>🏭 Outsource S/M/B</span>
          </div>
          {rcNewForm.outEnabled && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>{[["S", "outS"], ["M", "outM"], ["B", "outB"]].map(([l, f]) => <div key={f}><div style={{ fontSize: 9, color: textS, textAlign: "center", marginBottom: 2 }}>{l}</div><input type="number" value={rcNewForm[f]} onChange={(e) => setRcNewForm((p) => ({ ...p, [f]: Number(e.target.value) || 0 }))} style={{ ...S.input, textAlign: "center", fontWeight: 700 }} /></div>)}</div>}
          <div><div style={S.label}>Notes</div><input value={rcNewForm.notes} onChange={(e) => setRcNewForm((p) => ({ ...p, notes: e.target.value }))} style={S.input} placeholder="Optional notes..." /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button onClick={() => { setRcAddMode(false); setRcSubOpen(false); }} style={S.btn(false)}>Cancel</button>
            <button onClick={rcAddItem} style={S.btn(true)}>✓ Add Item</button>
          </div>
        </div>}

        {groupEntries.map(([sub, items]) => (
          <div key={sub} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><div style={{ width: 3, height: 12, borderRadius: 2, background: curCat?.c || accent }} /><div style={{ fontSize: 13, fontWeight: 700, color: curCat?.c || accent }}>{sub}</div><div style={{ fontSize: 10, color: textS }}>({items.length})</div>
              {/* Tagging visibility — flag a whole sub-category so it can't be re-added during photo
                  tagging (already costed by dims, or IMS-only). Keyed by the items' raw sub value so
                  it matches the per-item filters in the tagging search boxes + AI vocabulary. */}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><RCP item={item} /><button onClick={(e) => { e.stopPropagation(); rcDel(item.id); }} style={{ background: "rgba(255,255,255,0.04)", border: "none", color: "#F87171", borderRadius: 4, padding: "3px 5px", cursor: "pointer", fontSize: 10 }}>🗑️</button></div>
                </div>
                {!isO && item.notes && <div style={{ padding: "0 14px 6px", fontSize: 10, color: item.notes.includes("⚠") || item.notes.includes("Set") ? "#F59E0B" : textS }}>{item.notes}</div>}
                {isO && <div style={{ padding: "14px 18px", borderTop: `1px solid ${border}`, background: isDark ? "#0D0D18" : "#F9F9F6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                    <div><div style={S.label}>Category</div><select value={item.cat || ""} onChange={(e) => rcUpd(item.id, "cat", e.target.value)} style={S.select}>{rcCats.map((c) => <option key={c.id} value={c.id}>{c.l}</option>)}</select></div>
                    <div><div style={S.label}>Name</div><input defaultValue={item.name} onBlur={(e) => rcUpd(item.id, "name", e.target.value)} key={item.id + "-name"} style={S.input} /></div>
                    <div><div style={S.label}>Sub-Category</div><input defaultValue={item.sub || ""} onBlur={(e) => rcUpd(item.id, "sub", e.target.value)} key={item.id + "-sub"} list="rc-sub-list" style={S.input} /></div>
                    <div><div style={S.label}>Unit</div><select value={item.unit} onChange={(e) => rcUpd(item.id, "unit", e.target.value)} style={S.select}>{RC_UNITS.map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select></div>
                  </div>
                  {/* IMS sub-category alias — Studio placeholder → real IMS sub-category. When set, Deal Check
                      searches IMS inventory, alternatives and heavy-element labour under THIS sub-category
                      instead of the one above (e.g. "Centre Piece" → "Flower Pot Large"). Pricing is untouched. */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={S.label}>IMS sub-category alias <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 10 }}>· optional — Deal Check searches IMS as this sub-category. Blank = use Sub-Category above.</span></div>
                    <input defaultValue={item.imsAlias || ""} onBlur={(e) => rcUpd(item.id, "imsAlias", e.target.value.trim())} key={item.id + "-imsalias"} list="rc-sub-list" placeholder={item.sub ? `same as “${item.sub}”` : "same as sub-category"} style={S.input} />
                  </div>
                  {/* Inhouse */}
                  <div style={{ background: isDark ? "#0F0F1A" : "#fff", borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${item._imsDriven ? "#10B98180" : border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>🏠 Inhouse</div>
                      <div style={{ display: "flex", gap: 3 }}>{["flat", "smb"].map((m) => <button key={m} disabled={!!item._imsDriven} onClick={() => { if (item._imsDriven) return; rcUpd(item.id, "inhouseMode", m); }} style={{ padding: "3px 10px", borderRadius: 5, border: "none", fontSize: 10, fontWeight: 600, cursor: item._imsDriven ? "not-allowed" : "pointer", background: item.inhouseMode === m ? "#059669" : "rgba(255,255,255,0.04)", color: item.inhouseMode === m ? "#fff" : textS, opacity: item._imsDriven ? 0.5 : 1 }}>{m === "flat" ? "Flat" : "S/M/B"}</button>)}</div>
                    </div>
                    {item.inhouseMode === "flat"
                      ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: textS }}>₹</span><input type="number" readOnly={!!item._imsDriven} value={item.inhouseFlat || 0} onChange={(e) => { if (item._imsDriven) return; rcUpd(item.id, "inhouseFlat", e.target.value); }} style={{ ...S.input, width: 140, fontSize: 16, fontWeight: 700, textAlign: "right", opacity: item._imsDriven ? 0.7 : 1 }} /></div>
                      : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => <div key={f}><div style={{ fontSize: 10, color: textS, textAlign: "center", fontWeight: 600 }}>{l}</div><input type="number" readOnly={!!item._imsDriven} value={item[f] || 0} onChange={(e) => { if (item._imsDriven) return; rcUpd(item.id, f, e.target.value); }} style={{ ...S.input, textAlign: "center", fontSize: 14, fontWeight: 700, opacity: item._imsDriven ? 0.7 : 1 }} /></div>)}</div>}
                  </div>
                  {/* Floral pricing */}
                  {isFloral && (() => { const mode = getFloralMode(item); const pill = (active, color) => ({ padding: "5px 10px", borderRadius: 6, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer", background: active ? color : "rgba(255,255,255,0.04)", color: active ? "#fff" : textS, whiteSpace: "nowrap" }); const setMode = (m) => { rcUpd(item.id, "floralMode", m); if (m === "real") rcUpd(item.id, "defaultRealPct", 100); else if (m === "artificial") rcUpd(item.id, "defaultRealPct", 0); }; const help = mode === "ratio" ? `Global slider (currently ${100 - floralRatio}% real / ${floralRatio}% artificial) drives default.` : mode === "real" ? "Default 100% real — salesperson can override per event." : "Default 100% artificial — salesperson can override per event."; return <div style={{ background: isDark ? "#0F0F1A" : "#fff", borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#EC4899", marginBottom: 8 }}>🌸 Pricing mode</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                      <button onClick={() => setMode("ratio")} style={pill(mode === "ratio", "#94A3B8")}>🌐 Global ratio</button>
                      <button onClick={() => setMode("real")} style={pill(mode === "real", "#10B981")}>🎯 100% Real</button>
                      <button onClick={() => setMode("artificial")} style={pill(mode === "artificial", "#EC4899")}>🎯 100% Artificial</button>
                    </div>
                    <div style={{ fontSize: 10, color: textS, marginBottom: 10, lineHeight: 1.4 }}>{help}</div>
                    <div style={{ fontSize: 10, color: textS, lineHeight: 1.4, fontStyle: "italic" }}>Artificial cost is auto-derived from the IMS recipe (pieces × mix rate × markup) — no manual rate needed.</div>
                  </div>; })()}
                  {/* Outsource */}
                  <div style={{ background: isDark ? (item.outEnabled ? "#0F0F1A" : "#0A0A12") : (item.outEnabled ? "#fff" : "#F5F5F5"), borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${item.outEnabled ? "#F59E0B30" : border}`, opacity: item.outEnabled ? 1 : 0.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: item.outEnabled ? 8 : 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: item.outEnabled ? "#F59E0B" : textS }}>🏭 Outsource</div>
                      <div onClick={() => rcUpd(item.id, "outEnabled", !item.outEnabled)} style={{ width: 36, height: 20, borderRadius: 10, background: item.outEnabled ? "#F59E0B" : "#374151", position: "relative", cursor: "pointer" }}><div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", position: "absolute", top: 2, left: item.outEnabled ? 18 : 2, transition: "left 0.2s" }} /></div>
                    </div>
                    {item.outEnabled && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[["S", "outS"], ["M", "outM"], ["B", "outB"]].map(([l, f]) => <div key={f}><div style={{ fontSize: 10, color: textS, textAlign: "center", fontWeight: 600 }}>{l}</div><input type="number" value={item[f] || 0} onChange={(e) => rcUpd(item.id, f, e.target.value)} style={{ ...S.input, textAlign: "center", fontSize: 14, fontWeight: 700 }} /></div>)}</div>}
                  </div>
                  <div><div style={S.label}>Notes</div><input defaultValue={item.notes || ""} onBlur={(e) => rcUpd(item.id, "notes", e.target.value)} key={item.id + "-notes"} style={S.input} /></div>
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

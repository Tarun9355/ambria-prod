// IMS → Planning → 🚚 Truck. Split out of TransportEditor.jsx (owner ask, 2026-10-16) — Truck
// Capacity Rules and Buffer Trucks by Budget used to live at the bottom of the Transport & Power
// editor (Admin → Settings → Master Data), buried under venue pricing and genset rates. They're
// planning-time rules, not master-data config, so they get their own Planning sub-tab. Takes the
// SAME ctx shape TransportEditor.jsx already takes (both are mounted by ImsTransportPanel.jsx,
// which builds ctx once) — nothing about the data or save path changed, only where it's shown.
import { useState } from "react";

export default function TruckCapacityEditor({ ctx }) {
  const [openCats, setOpenCats] = useState({}); // collapsible truck-capacity category groups
  const {
    S, isDark, accent, border, textP, textS, showMsg,
    truckCap, bufferTiers, saveTR, TC_UNITS,
    rcItems, rcCats, rateCardCategories, inventory,
  } = ctx;

  // Per-sub-category truck capacity, keyed by sub-category name (truckCap[].item === sub).
  const capForSub = (sub) => (truckCap || []).find((t) => String(t.item || "").toLowerCase().trim() === String(sub || "").toLowerCase().trim());
  // Best-guess default unit for a pseudo-sub that has no truckCap row yet — used both when a row is
  // actually created below AND by the render's own placeholder display before that row exists, so
  // the two can never disagree about what unit a fresh row starts as. "masking" dropped from the
  // sqft-matching keywords: it used to only ever mean the old wall-masking rate table, which never
  // creates a truckCap row at all (see subsByCat's comment) — now it exclusively means the pc-based
  // Fabric Allocation pseudo-sub, so sqft would be wrong.
  const guessUnit = (sub) => {
    const s = String(sub || "").toLowerCase().trim();
    if (s === "liza" || s === "real flowers") return "kg";
    if (s === "artificial flowers") return "bunch";
    if (/truss|platform|carpet|fabric|batta|ceiling/.test(s)) return "sqft";
    return "pc";
  };
  const upsertSubCap = (sub, field, val) => {
    const existing = capForSub(sub);
    const conv = (f, v) => (f === "perTruck" ? Number(v) || 0 : v);
    let next;
    if (existing) next = (truckCap || []).map((t) => (t === existing ? { ...t, [field]: conv(field, val) } : t));
    else next = [...(truckCap || []), { id: "TC" + Date.now().toString(36).slice(-5).toUpperCase(), item: sub, perTruck: field === "perTruck" ? Number(val) || 0 : 0, unit: field === "unit" ? val : guessUnit(sub) }];
    saveTR(null, next);
  };
  // Distinct sub-categories grouped by top-level category — sourced from `rateCardCategories`
  // (Admin → Settings → 📂 Sub-Categories, the actual master list the rest of the app reads: live
  // inventory sub-categories + manually-added ones), NOT the legacy Rate Card items list. The old
  // grouping walked `rcItems` only, so a sub-category with real inventory behind it but no
  // matching legacy Rate-Card ITEM of the same name (Console Table, Pedestals, anything added
  // straight to Inventory and never given a Rate Card row) never appeared on this screen at all —
  // there was nothing missing from truckCap itself, it just had no row to show a capacity input on.
  // groupLabelFor mirrors the Sub-Categories tab's own grouping exactly (explicit admin override →
  // live-inventory-derived category → legacy Rate-Card-item-derived category → "Other") so a
  // sub-category lands in the same bucket here as it does there.
  const CAT_ALIAS_GROUPS = [
    { test: (low) => /^(flowers?|florals?)$/.test(low), fallback: "Florals" },
    { test: (low, raw) => /^(cloths?|fabrics?|kapda|kapra)$/.test(low) || /कपड़ा|कपडा/.test(raw), fallback: "Fabric" },
  ];
  const normInvCat = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const low = raw.toLowerCase();
    for (const g of CAT_ALIAS_GROUPS) { if (g.test(low, raw)) return g.fallback; }
    return raw;
  };
  const invSubToCat = {};
  (inventory || []).forEach((it) => {
    const rawSub = it.subCat ?? it.subcategory;
    if (!rawSub) return;
    const subKey = String(rawSub).trim().toLowerCase();
    if (!subKey || invSubToCat[subKey]) return;
    const rawCat = it.cat ?? it.category;
    invSubToCat[subKey] = rawCat ? normInvCat(rawCat) : "Other";
  });
  const subToCatLabel = {};
  (rcItems || []).forEach((it) => {
    const catLabel = (rcCats || []).find((c) => c.id === it.cat)?.l || it.cat;
    if (!catLabel) return;
    const subKey = String(it.sub || "").trim().toLowerCase();
    const aliasKey = String(it.imsAlias || "").trim().toLowerCase();
    if (subKey) subToCatLabel[subKey] = catLabel;
    if (aliasKey) subToCatLabel[aliasKey] = catLabel;
  });
  const groupLabelFor = (r) => r.category_label || invSubToCat[r.id] || subToCatLabel[r.id] || "Other";
  const CAT_ICON = { Florals: "🌸", Furniture: "🛋️", Structural: "🏛️", Structure: "🏛️", Lighting: "💡", Fabric: "🧵", Tenting: "⛺", Props: "🎪", Stage: "🎭", Consumable: "📦", "Arches & Props": "🚪", "Wall Masking": "🧱" };
  const subsByCat = (() => {
    const groups = {};
    // Kept to source "inventory" or "manual" only — the two values IMS.jsx ever actually writes.
    // "rate_card_only" is never a real stored value (only a display fallback), so excluding THAT
    // literal string excluded nothing — these rows' source is null/undefined from an old
    // migration, not that string. Nothing physical to load means nothing that needs a
    // truck-capacity setting; same stale-name noise fixed in Manpower's quick-add lists.
    (rateCardCategories || []).filter((r) => r.source === "inventory" || r.source === "manual").forEach((r) => {
      const label = groupLabelFor(r);
      (groups[label] = groups[label] || []).push(r.label || r.id);
    });
    // Structural pseudo-subs the calc uses from the zone config (truss/platform/carpet by sqft) —
    // not real inventory items, so they have no rate_card_categories row of their own.
    const have = new Set(Object.values(groups).flat().map((s) => String(s).toLowerCase().trim()));
    const structLabel = "Structural (by sqft)";
    ["Truss", "Platform", "Carpet"].forEach((s) => { if (!have.has(s.toLowerCase())) (groups[structLabel] = groups[structLabel] || []).push(s); });
    // Fabric Allocation (masking/liza/curtains, §23 Phase 2.9f) and floral material (real mandi +
    // artificial) — same reasoning as Truss/Platform/Carpet above: both are computed from zone/
    // recipe config, not real inventory sub-categories, so without a pseudo-sub here they'd have no
    // row on this screen and no way to ever be given a real perTruck capacity. No name collision
    // with the OLDER "Masking" wall-material system — that one prices off imsMaskingRates, a flat
    // settings table, and was never a rate-card sub-category to begin with.
    const fabricLabel = "Fabric Allocation (by pc/kg)";
    ["Masking", "Liza", "Curtains"].forEach((s) => { if (!have.has(s.toLowerCase())) (groups[fabricLabel] = groups[fabricLabel] || []).push(s); });
    const floralMatLabel = "Floral Material (by kg/bunch)";
    ["Real Flowers", "Artificial Flowers"].forEach((s) => { if (!have.has(s.toLowerCase())) (groups[floralMatLabel] = groups[floralMatLabel] || []).push(s); });
    const labels = Object.keys(groups).filter((l) => l !== "Other" && l !== structLabel && l !== fabricLabel && l !== floralMatLabel).sort();
    const out = labels.map((l) => ({ cat: { id: l, l, icon: CAT_ICON[l] || "📦" }, subs: groups[l] }));
    if (groups[structLabel]?.length) out.push({ cat: { id: structLabel, l: structLabel, icon: "🏗️" }, subs: groups[structLabel] });
    if (groups[fabricLabel]?.length) out.push({ cat: { id: fabricLabel, l: fabricLabel, icon: "🧵" }, subs: groups[fabricLabel] });
    if (groups[floralMatLabel]?.length) out.push({ cat: { id: floralMatLabel, l: floralMatLabel, icon: "🌸" }, subs: groups[floralMatLabel] });
    if (groups.Other?.length) out.push({ cat: { id: "Other", l: "Other", icon: "📁" }, subs: groups.Other });
    return out;
  })();

  // Buffer tiers
  const updBT = (id, f, v) => saveTR(null, null, undefined, bufferTiers.map((x) => (x.id === id ? { ...x, [f]: f === "label" ? v : Number(v) || 0 } : x)));
  const addBT = () => { const last = bufferTiers[bufferTiers.length - 1]; saveTR(null, null, undefined, [...bufferTiers, { id: "BT" + Date.now().toString(36).slice(-5).toUpperCase(), label: "New tier", minBudget: last ? last.maxBudget : 0, maxBudget: (last ? last.maxBudget : 0) + 500000, bufferTrucks: 1 }]); };
  const delBT = (id) => { if (bufferTiers.length <= 1) { showMsg && showMsg("Need at least 1 tier", "red"); return; } saveTR(null, null, undefined, bufferTiers.filter((x) => x.id !== id)); };

  const numInput = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: isDark ? "#fff" : "#000", fontSize: 14, fontWeight: 700, textAlign: "right", outline: "none", fontFamily: "inherit" };

  return (<div style={{ maxWidth: 900 }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: textP, marginBottom: 4 }}>🚚 Truck Capacity & Buffer</div>
    <div style={{ fontSize: 12, color: textS, marginBottom: 24 }}>How many of each sub-category fit per truck, plus extra buffer trucks auto-added by project budget.</div>

    {/* Truck capacities */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        🚚 Truck Capacity Rules
      </div>
      <div style={{ fontSize: 11, color: textS, marginBottom: 12 }}>How many of each <b>sub-category</b> fit in one truck. Trucks = ⌈Σ(qty ÷ capacity)⌉ + buffer. 0 = skip. No separate flower truck — florals count via their sub-category. <b>Tap a category to expand.</b></div>
      {subsByCat.map(({ cat, subs }) => {
        const open = !!openCats[cat.id];
        const setCount = subs.filter((s) => { const tc = capForSub(s); return tc && (Number(tc.perTruck) || 0) > 0; }).length;
        return (
          <div key={cat.id} style={{ marginBottom: 8, border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
            <div onClick={() => setOpenCats((p) => ({ ...p, [cat.id]: !p[cat.id] }))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: textP }}>{open ? "▾" : "▸"} {cat.icon} {cat.l}</span>
              <span style={{ fontSize: 10, color: setCount ? "#10B981" : textS }}>{setCount}/{subs.length} set</span>
            </div>
            {open && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "4px 12px", padding: "8px 12px" }}>
                {subs.map((sub) => { const tc = capForSub(sub); const pt = tc ? tc.perTruck : 0; const un = tc ? (tc.unit || "pc") : guessUnit(sub); return (
                  <div key={sub} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: textP, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub}>{sub}</span>
                    <input type="number" value={pt || ""} placeholder="0" onChange={(e) => upsertSubCap(sub, "perTruck", e.target.value)} style={{ ...numInput, width: 52, padding: "3px 6px", fontSize: 13, color: (pt || 0) === 0 ? "#F59E0B" : (isDark ? "#fff" : "#000") }} />
                    <select value={un} onChange={(e) => upsertSubCap(sub, "unit", e.target.value)} style={{ padding: "3px 4px", borderRadius: 6, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: accent, fontSize: 10, fontWeight: 600, outline: "none", fontFamily: "inherit" }}>{(TC_UNITS || [{ id: "pc", l: "pc" }, { id: "sqft", l: "sqft" }]).map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select>
                  </div>
                ); })}
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* The Florals Truck Rule editor was removed from this screen. The rule itself is untouched —
        transport still derives floral trucks from `floralPerTruck` in the RC_SK_TR blob; it simply
        is not editable here any more. Restoring the control means putting this card back, not
        re-adding the setting. */}

    {/* Buffer tiers */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#3B82F6" }}>🛡️ Buffer Trucks by Budget</div>
        <button onClick={addBT} style={{ ...S.btn(true), padding: "6px 14px", fontSize: 11 }}>+ Add Tier</button>
      </div>
      <div style={{ fontSize: 11, color: textS, marginBottom: 16 }}>Extra trucks auto-added based on project budget — covers last-minute requirements.</div>
      {bufferTiers.map((bt) => (
        <div key={bt.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${border}`, flexWrap: "wrap" }}>
          <input value={bt.label} onChange={(e) => updBT(bt.id, "label", e.target.value)} style={{ width: 130, padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textP, fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "inherit" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: textS }}>
            <span>₹</span><input type="number" value={bt.minBudget} onChange={(e) => updBT(bt.id, "minBudget", e.target.value)} style={{ ...numInput, width: 80, fontSize: 12 }} />
            <span>→</span><span>₹</span><input type="number" value={bt.maxBudget} onChange={(e) => updBT(bt.id, "maxBudget", e.target.value)} style={{ ...numInput, width: 80, fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 11, color: textS }}>Buffer:</span>
            <input type="number" value={bt.bufferTrucks} onChange={(e) => updBT(bt.id, "bufferTrucks", e.target.value)} style={{ ...numInput, width: 50, fontSize: 18, textAlign: "center", color: bt.bufferTrucks > 0 ? "#3B82F6" : "#F59E0B" }} />
            <span style={{ fontSize: 11, color: textS }}>truck{bt.bufferTrucks !== 1 ? "s" : ""}</span>
            <button onClick={() => delBT(bt.id)} style={{ background: "transparent", border: "none", color: "#F87171", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>✖</button>
          </div>
        </div>
      ))}
    </div>
  </div>);
}

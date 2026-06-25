// Studio → Pricing → Transport & Power tab. Faithful dark-theme transcription of
// the reference AdminRates transport tab (App_latest.jsx ~7645), driven off ctx.
// Edits the transport blob (RC_SK_TR) via ctx.saveTR (per-slice persistence).
import { useState } from "react";

export default function TransportEditor({ ctx }) {
  const [openCats, setOpenCats] = useState({}); // collapsible truck-capacity category groups
  const {
    S, isDark, accent, border, textP, textS, showMsg,
    trVenues, truckCap, floralPerTruck, gensetRate, bufferTiers, saveTR,
    newVenue, setNewVenue, newTC, setNewTC, TR_TIERS, TC_UNITS,
    rcItems, rcCats, allInhouseVenues, allOutdoorDB,
  } = ctx;
  // Venue NAMES come from Settings → Venues (central list); transport only holds rate/tier/genset per venue.
  const centralVenues = [...new Set([...(allInhouseVenues || []), ...((allOutdoorDB || []).map((v) => v.name))].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const venueByName = (name) => (trVenues || []).find((v) => String(v.name || "").toLowerCase().trim() === String(name || "").toLowerCase().trim());
  const upsertVenue = (name, field, val) => {
    const existing = venueByName(name);
    const conv = (f, v) => (f === "rate" || f === "gensets" ? (Number(v) || 0) : v);
    let next;
    if (existing) next = (trVenues || []).map((v) => (v === existing ? { ...v, [field]: conv(field, val) } : v));
    else next = [...(trVenues || []), { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), name, tier: field === "tier" ? val : "", rate: field === "rate" ? Number(val) || 0 : 0, gensets: field === "gensets" ? Number(val) || 1 : 1 }];
    saveTR(next);
  };
  // Per-sub-category truck capacity, keyed by sub-category name (truckCap[].item === sub).
  const capForSub = (sub) => (truckCap || []).find((t) => String(t.item || "").toLowerCase().trim() === String(sub || "").toLowerCase().trim());
  const upsertSubCap = (sub, field, val) => {
    const existing = capForSub(sub);
    const conv = (f, v) => (f === "perTruck" ? Number(v) || 0 : v);
    let next;
    if (existing) next = (truckCap || []).map((t) => (t === existing ? { ...t, [field]: conv(field, val) } : t));
    else next = [...(truckCap || []), { id: "TC" + Date.now().toString(36).slice(-5).toUpperCase(), item: sub, perTruck: field === "perTruck" ? Number(val) || 0 : 0, unit: field === "unit" ? val : (/truss|platform|carpet|masking|fabric|batta|ceiling/i.test(sub) ? "sqft" : "pc") }];
    saveTR(null, next);
  };
  // Distinct sub-categories grouped by rate-card category.
  const subsByCat = (() => {
    const out = [];
    (rcCats || []).forEach((c) => {
      const subs = [...new Set((rcItems || []).filter((i) => i.cat === c.id && i.sub).map((i) => i.sub))];
      if (subs.length) out.push({ cat: c, subs });
    });
    // Structural pseudo-subs the calc uses from the zone config (truss/platform/carpet by sqft).
    const have = new Set((rcItems || []).map((i) => String(i.sub || "").toLowerCase().trim()));
    const extra = ["Truss", "Platform", "Carpet"].filter((s) => !have.has(s.toLowerCase()));
    if (extra.length) out.push({ cat: { id: "_struct", l: "Structural (by sqft)", icon: "🏗️" }, subs: extra });
    return out;
  })();

  // Venues
  const updTrVenue = (id, f, v) => { const num = f === "rate" || f === "gensets"; saveTR(trVenues.map((x) => (x.id === id ? { ...x, [f]: num ? Number(v) || 0 : v } : x))); };
  const delTrVenue = (id) => saveTR(trVenues.filter((x) => x.id !== id));
  const addTrVenue = (tierId) => {
    if (newVenue.tier !== tierId || !(newVenue.name || "").trim()) { showMsg && showMsg("Enter a venue name", "red"); return; }
    saveTR([...trVenues, { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), tier: tierId, name: newVenue.name.trim(), rate: newVenue.rate || 0, gensets: newVenue.gensets || 1 }]);
    setNewVenue({ tier: "", name: "", rate: 0, gensets: 1 });
  };
  // Truck capacities
  const updTrTC = (id, f, v) => { const num = f === "perTruck"; saveTR(null, truckCap.map((x) => (x.id === id ? { ...x, [f]: num ? Number(v) || 0 : v } : x))); };
  const delTrTC = (id) => saveTR(null, truckCap.filter((x) => x.id !== id));
  const addTrTC = () => { if (!(newTC.item || "").trim()) { showMsg && showMsg("Enter an item name", "red"); return; } saveTR(null, [...truckCap, { id: "TC" + Date.now().toString(36).slice(-5).toUpperCase(), item: newTC.item.trim(), perTruck: newTC.perTruck || 0, unit: newTC.unit || "pc" }]); setNewTC({ item: "", perTruck: 0, unit: "pc" }); };
  // Buffer tiers
  const updBT = (id, f, v) => saveTR(null, null, undefined, bufferTiers.map((x) => (x.id === id ? { ...x, [f]: f === "label" ? v : Number(v) || 0 } : x)));
  const addBT = () => { const last = bufferTiers[bufferTiers.length - 1]; saveTR(null, null, undefined, [...bufferTiers, { id: "BT" + Date.now().toString(36).slice(-5).toUpperCase(), label: "New tier", minBudget: last ? last.maxBudget : 0, maxBudget: (last ? last.maxBudget : 0) + 500000, bufferTrucks: 1 }]); };
  const delBT = (id) => { if (bufferTiers.length <= 1) { showMsg && showMsg("Need at least 1 tier", "red"); return; } saveTR(null, null, undefined, bufferTiers.filter((x) => x.id !== id)); };

  const numInput = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: isDark ? "#fff" : "#000", fontSize: 14, fontWeight: 700, textAlign: "right", outline: "none", fontFamily: "inherit" };

  return (<div style={{ maxWidth: 900 }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: textP, marginBottom: 4 }}>🚛 Transport & Power</div>
    <div style={{ fontSize: 12, color: textS, marginBottom: 24 }}>Venue tier pricing · Genset per venue · Truck capacity rules · Auto-estimate trips</div>

    {/* Venue transport pricing — venue NAMES come from Settings → Venues */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>🏛️ Venue Transport Pricing</div>
        <span style={{ fontSize: 11, color: textS }}>{centralVenues.length} venues</span>
      </div>
      <div style={{ fontSize: 11, color: textS, marginBottom: 16 }}>Venues come from <b>Settings → Venues</b>. Set the tier, trip rate &amp; genset count per venue here. New venues appear automatically.</div>
      {centralVenues.length === 0 && <div style={{ fontSize: 12, color: textS, fontStyle: "italic", padding: "8px 0" }}>No venues yet — add them in Settings → Venues.</div>}
      {centralVenues.map((name) => { const v = venueByName(name) || {}; return (
        <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${border}`, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, color: textP, flex: 1, minWidth: 120 }}>{name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select value={v.tier || ""} onChange={(e) => upsertVenue(name, "tier", e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: v.tier ? accent : textS, fontSize: 11, fontWeight: 600, outline: "none", fontFamily: "inherit", cursor: "pointer" }}>
              <option value="">Tier…</option>
              {(TR_TIERS || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: textS }}>₹</span>
            <input type="number" value={v.rate || ""} placeholder="0" onChange={(e) => upsertVenue(name, "rate", e.target.value)} style={{ ...numInput, width: 70, color: (v.rate || 0) === 0 ? "#F59E0B" : (isDark ? "#fff" : "#000") }} />
            <span style={{ fontSize: 11, color: textS }}>/trip</span>
            <div style={{ width: 1, height: 20, background: border, margin: "0 4px" }} />
            <span style={{ fontSize: 11, color: "#F59E0B" }}>⚡</span>
            <input type="number" step="0.5" min="0" value={v.gensets ?? 1} onChange={(e) => upsertVenue(name, "gensets", e.target.value)} style={{ ...numInput, width: 50, color: "#F59E0B", textAlign: "center" }} />
            <span style={{ fontSize: 10, color: textS }}>genset</span>
          </div>
        </div>
      ); })}
    </div>

    {/* Genset rate */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: "#F59E0B", marginBottom: 4 }}>⚡ Genset Rate</div><div style={{ fontSize: 11, color: textS }}>Cost per genset (125 KVA) per event — multiplied by venue genset count</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13, color: textS }}>₹</span><input type="number" value={gensetRate} onChange={(e) => saveTR(null, null, undefined, null, Number(e.target.value) || 0)} style={{ ...numInput, width: 100, fontSize: 18 }} /><span style={{ fontSize: 11, color: textS }}>/event</span></div>
      </div>
    </div>

    {/* Truck capacities */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent, marginBottom: 4 }}>🚚 Truck Capacity Rules</div>
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
                {subs.map((sub) => { const tc = capForSub(sub); const pt = tc ? tc.perTruck : 0; const un = tc ? (tc.unit || "pc") : (/truss|platform|carpet|masking|fabric|batta|ceiling/i.test(sub) ? "sqft" : "pc"); return (
                  <div key={sub} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: textP, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub}>{sub}</span>
                    <input type="number" value={pt || ""} placeholder="0" onChange={(e) => upsertSubCap(sub, "perTruck", e.target.value)} style={{ ...numInput, width: 52, padding: "3px 6px", fontSize: 13, color: (pt || 0) === 0 ? "#F59E0B" : (isDark ? "#fff" : "#000") }} />
                    <select value={un} onChange={(e) => upsertSubCap(sub, "unit", e.target.value)} style={{ padding: "3px 4px", borderRadius: 6, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: accent, fontSize: 10, fontWeight: 600, outline: "none", fontFamily: "inherit", cursor: "pointer" }}>{(TC_UNITS || [{ id: "pc", l: "pc" }, { id: "sqft", l: "sqft" }]).map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select>
                  </div>
                ); })}
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* Florals truck rule */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#EC4899", marginBottom: 4 }}>🌸 Florals Truck Rule</div>
      <div style={{ fontSize: 11, color: textS, marginBottom: 16 }}>Florals are small items — truck count estimated by total floral budget, not per piece.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: isDark ? "#0F0F1A" : "#F9FAFB", borderRadius: 10, border: `1px solid ${border}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: textP, fontWeight: 600 }}>Every</span>
        <span style={{ color: textS }}>₹</span>
        <input type="number" value={floralPerTruck} onChange={(e) => saveTR(null, null, Number(e.target.value) || 0)} style={{ ...numInput, width: 100, fontSize: 18 }} />
        <span style={{ fontSize: 13, color: textP, fontWeight: 600 }}>of floral cost = 1 truck</span>
      </div>
    </div>

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

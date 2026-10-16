// IMS → Admin → Settings → 🗂️ Master Data → 🚛 Transport & Power. Mounted by ImsTransportPanel,
// which adapts IMS state to the ctx shape below. Faithful transcription of
// the reference AdminRates transport tab (App_latest.jsx ~7645), driven off ctx.
// Edits the transport blob (RC_SK_TR) via ctx.saveTR (per-slice persistence).
import { resolveVenueGensets } from "../../lib/studio/taxonomy";

export default function TransportEditor({ ctx }) {
  const {
    S, isDark, accent, border, textP, textS, showMsg,
    trVenues, gensetRate, gensetRate62, gensetCostRate, gensetCostRate62, saveTR,
    newVenue, setNewVenue, TR_TIERS,
    allInhouseVenues, allOutdoorDB,
  } = ctx;
  // Venue NAMES come from Settings → Venues (central list); transport only holds rate/tier/genset per venue.
  const centralVenues = [...new Set([...(allInhouseVenues || []), ...((allOutdoorDB || []).map((v) => v.name))].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const venueByName = (name) => (trVenues || []).find((v) => String(v.name || "").toLowerCase().trim() === String(name || "").toLowerCase().trim());
  const upsertVenue = (name, field, val) => {
    const existing = venueByName(name);
    // Genset count is a whole-unit count PER SIZE now, not one fractional "gensets" multiplier (0.5
    // used to mean "half a 125 KVA genset", which isn't a real, rentable thing). Editing either size
    // writes BOTH fields together — resolveVenueGensets fills in whichever one isn't being touched
    // (falling back to the legacy `gensets` value for a venue that hasn't been migrated yet) — so the
    // venue is fully migrated to explicit counts the moment either number is edited, rather than
    // half-migrating and silently zeroing the other size.
    if (field === "genset125" || field === "genset62") {
      const cur = resolveVenueGensets(existing);
      const genset125 = field === "genset125" ? (Number(val) || 0) : cur.genset125;
      const genset62 = field === "genset62" ? (Number(val) || 0) : cur.genset62;
      let next;
      if (existing) next = (trVenues || []).map((v) => (v === existing ? { ...v, genset125, genset62 } : v));
      else next = [...(trVenues || []), { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), name, tier: "", rate: 0, genset125, genset62 }];
      saveTR(next);
      return;
    }
    // clientScale: the guest-facing markup on this venue's own trip cost (Build's Live Estimate,
    // Summary's accordion/export) — never 0 (that would zero the client's transport charge
    // outright), so an emptied/invalid input falls back to 1.25 (the owner's requested default —
    // 25% markup — rather than 1/no-markup) instead of storing a silent free ride.
    // calcFunctionBreakdown/calcFunctionCost/transportCalc apply this same >0-or-1.25 fallback
    // when READING it, so a venue that has never had this field touched behaves identically.
    const conv = (f, v) => (f === "rate" ? (Number(v) || 0) : f === "clientScale" ? (Number(v) > 0 ? Number(v) : 1.25) : v);
    let next;
    if (existing) next = (trVenues || []).map((v) => (v === existing ? { ...v, [field]: conv(field, val) } : v));
    else next = [...(trVenues || []), { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), name, tier: field === "tier" ? val : "", rate: field === "rate" ? Number(val) || 0 : 0, genset125: 1, genset62: 0, clientScale: field === "clientScale" ? conv("clientScale", val) : 1.25 }];
    saveTR(next);
  };
  // Truck Capacity Rules + Buffer Trucks by Budget moved to their own Planning → 🚚 Truck tab
  // (TruckCapacityEditor.jsx, owner ask 2026-10-16) — this screen no longer touches truckCap/
  // bufferTiers at all.

  // Venues
  const updTrVenue = (id, f, v) => { const num = f === "rate" || f === "gensets"; saveTR(trVenues.map((x) => (x.id === id ? { ...x, [f]: num ? Number(v) || 0 : v } : x))); };
  const delTrVenue = (id) => saveTR(trVenues.filter((x) => x.id !== id));
  const addTrVenue = (tierId) => {
    if (newVenue.tier !== tierId || !(newVenue.name || "").trim()) { showMsg && showMsg("Enter a venue name", "red"); return; }
    saveTR([...trVenues, { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), tier: tierId, name: newVenue.name.trim(), rate: newVenue.rate || 0, gensets: newVenue.gensets || 1 }]);
    setNewVenue({ tier: "", name: "", rate: 0, gensets: 1 });
  };
  const numInput = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#0F0F1A" : "#fff", color: isDark ? "#fff" : "#000", fontSize: 14, fontWeight: 700, textAlign: "right", outline: "none", fontFamily: "inherit" };

  return (<div style={{ maxWidth: 900 }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: textP, marginBottom: 4 }}>🚛 Transport & Power</div>
    <div style={{ fontSize: 12, color: textS, marginBottom: 24 }}>Venue tier pricing · Genset per venue · Auto-estimate trips</div>

    {/* Venue transport pricing — venue NAMES come from Settings → Venues */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>🏛️ Venue Transport Pricing</div>
        <span style={{ fontSize: 11, color: textS }}>{centralVenues.length} venues</span>
      </div>
      <div style={{ fontSize: 11, color: textS, marginBottom: 16 }}>Venues come from <b>Settings → Venues</b>. Set the tier, trip rate, genset count &amp; the guest-facing truck markup per venue here. New venues appear automatically.</div>
      {centralVenues.length === 0 && <div style={{ fontSize: 12, color: textS, fontStyle: "italic", padding: "8px 0" }}>No venues yet — add them in Settings → Venues.</div>}
      {centralVenues.map((name) => { const v = venueByName(name) || {}; const g = resolveVenueGensets(v); return (
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
            {/* Whole units per size — no more one fractional "gensets" number standing in for a
                physically-impossible "half a 125 KVA genset". */}
            <span style={{ fontSize: 11, color: "#F59E0B" }}>⚡</span>
            <input type="number" step="1" min="0" title="125 KVA gensets" value={g.genset125} onChange={(e) => upsertVenue(name, "genset125", e.target.value)} style={{ ...numInput, width: 36, color: "#F59E0B", textAlign: "center" }} />
            <span style={{ fontSize: 9, color: textS }}>×125</span>
            <input type="number" step="1" min="0" title="62 KVA gensets" value={g.genset62} onChange={(e) => upsertVenue(name, "genset62", e.target.value)} style={{ ...numInput, width: 36, color: "#F59E0B", textAlign: "center" }} />
            <span style={{ fontSize: 9, color: textS }}>×62</span>
            <div style={{ width: 1, height: 20, background: border, margin: "0 4px" }} />
            {/* Guest-facing markup on the venue's own trip cost above — the price the client sees
                in Build's Live Estimate and Summary is trip rate × this scale, while Deal Check's
                own Transport tab keeps reading the raw rate as our actual cost. Defaults to 1.25
                (25% markup) — the owner's requested starting point — for every venue until tuned
                here; 1 = client sees our own cost exactly. */}
            <span style={{ fontSize: 11, color: "#10B981" }} title="Guest-facing markup on the trip cost — defaults to 1.25 (25%); 1 = client sees our own cost">🧾</span>
            <input type="number" step="0.05" min="0" value={v.clientScale ?? 1.25} onChange={(e) => upsertVenue(name, "clientScale", e.target.value)} style={{ ...numInput, width: 52, color: "#10B981" }} />
            <span style={{ fontSize: 9, color: textS }}>× to guest</span>
          </div>
        </div>
      ); })}
    </div>

    {/* Genset rate */}
    <div style={{ ...S.card, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: "#F59E0B", marginBottom: 4 }}>⚡ Genset Rate</div><div style={{ fontSize: 11, color: textS }}>Cost per genset per event — multiplied by the genset count. The size is picked per deal on Build.</div></div>
      </div>
      {/* Two sizes. 125 KVA keeps the original `gensetRate` key so every saved blob and quote reads
          back unchanged; 62 KVA is stored alongside it and only applies to deals that pick it. */}
      <div style={{ marginTop: 12 }}>
        {[
          { label: "125 KVA", hint: "Default — used unless a deal picks otherwise", value: gensetRate, save: (v) => saveTR(null, null, undefined, null, v), costValue: gensetCostRate, costSave: (v) => saveTR(null, null, undefined, null, undefined, undefined, v) },
          { label: "62 KVA", hint: "Smaller unit", value: gensetRate62, save: (v) => saveTR(null, null, undefined, null, undefined, v), costValue: gensetCostRate62, costSave: (v) => saveTR(null, null, undefined, null, undefined, undefined, undefined, v) },
        ].map((g) => (
          <div key={g.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${border}`, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: textP }}>{g.label}</div>
              <div style={{ fontSize: 10.5, color: textS }}>{g.hint}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: textS }}>₹</span>
                <input type="number" min="0" value={g.value} onChange={(e) => g.save(Number(e.target.value) || 0)} style={{ ...numInput, width: 100, fontSize: 18 }} />
                <span style={{ fontSize: 11, color: textS }}>/event</span>
                <span style={{ fontSize: 9.5, color: textS, marginLeft: 2 }}>billed to guest</span>
              </div>
              <div style={{ width: 1, height: 20, background: border }} />
              {/* Our own cost for this genset size — separate from the rate above (what we bill the
                  client). Deal Check's own Power tab and IMS read THIS figure to track real margin;
                  Build/Summary keep showing the rate above to the guest, unchanged. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#10B981" }}>🔧</span>
                <span style={{ fontSize: 13, color: textS }}>₹</span>
                <input type="number" min="0" value={g.costValue || ""} placeholder="0" onChange={(e) => g.costSave(Number(e.target.value) || 0)} style={{ ...numInput, width: 90, fontSize: 16, color: "#10B981" }} />
                <span style={{ fontSize: 11, color: textS }}>/event</span>
                <span style={{ fontSize: 9.5, color: textS, marginLeft: 2 }}>our cost</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

  </div>);
}

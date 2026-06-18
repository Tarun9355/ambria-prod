import { Fragment, useMemo } from "react";

// ═══ MANAGE: LIBRARY & CONTENT ═══
// Faithful rebuild of the reference AmbriStudioInner library view.
// Reference: App_latest.jsx — ManageLibrary() render block (~11684), LibraryBrowse()
// (~11042), LibraryAdd() (~11426), LibraryBulk() (~11505), plus the inline helpers
// libFiltered/toggleLibFilter/toggleLibVenueName/clearLibFilters (~10964–10995).
//
// The reference ManageLibrary() also contained a Cloudinary photo browser (cld* state)
// and a full Videos subsystem (yt*/cldVideo*). Those reference dozens of identifiers
// that are NOT exposed on StudioApp's ctx (loadAllYT, openCldVideoBrowser, aiTagVideo,
// getPhotos, fetchCldFolders, cld*/yt* state, YT_API_KEY, etc.). The faithful, buildable
// scope is the image library — single-photo add (LibraryAdd), bulk URL → AI tagging
// (LibraryBulk), and the filtered library browser/editor (LibraryBrowse). The Cloudinary
// browser + Videos branches are intentionally omitted (see report).
//
// AI tagging routes through ctx.aiTagImage (already ported into StudioApp).
export default function ManageLibrary({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS, fmt,
    accentBg, accentText, textP, cardBg,
    // taxonomy
    taxonomy, TAX_LABELS, imsPaletteCatalogue,
    // derived venue memos
    allInhouseVenues, allOutdoorDB,
    // library state + persistence
    libItems, saveLib, libView, setLibView,
    libSearch, setLibSearch, libFilters, setLibFilters,
    libVenueGroup, setLibVenueGroup, libVenueNames, setLibVenueNames,
    libEditImg, setLibEditImg, libElSearch, setLibElSearch,
    libAddUrl, setLibAddUrl, libAddPreview, setLibAddPreview,
    libBulkText, setLibBulkText, libBulkQueue, setLibBulkQueue,
    libBulkProgress, setLibBulkProgress, libAiLoading, setLibAiLoading,
    libShowBulk, setLibShowBulk,
    // photo tag venue picker
    tagVenueGroup, setTagVenueGroup, tagOutsideSub, setTagOutsideSub,
    setPreviewImg,
    // rate card (element breakdown)
    rcItems, rcCats, rcIsSMB,
    // misc
    showMsg, aiTagImage,
    // videos toggle metadata (count only — full videos subsystem is a later slice)
    allVideos,
  } = ctx;

  // ── inline helper: taxonomy label (reference module-scope getTaxLabel ~line 1267) ──
  const getTaxLabel = (k) => TAX_LABELS[k] || k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\s+/g, " ").replace(/^./, s => s.toUpperCase()).trim();

  // ── inline helpers (reference ~10964–10995) ──
  const libFiltered = useMemo(() => {
    return libItems.filter(img => {
      if (libSearch.trim()) {
        const q = libSearch.toLowerCase();
        if (!(img.name || "").toLowerCase().includes(q)) return false;
      }
      for (const k of Object.keys(taxonomy)) {
        const fv = libFilters[k];
        if (fv && fv.length > 0) {
          const it = img.tags?.[k] || [];
          if (!fv.some(f => it.includes(f))) return false;
        }
      }
      // Venue filter (Inhouse/Outside + specific venue name)
      const imgVenue = img.tags?.venue || "";
      if (libVenueGroup === "inhouse" && (!imgVenue || !allInhouseVenues.includes(imgVenue))) return false;
      if (libVenueGroup === "outside" && (!imgVenue || allInhouseVenues.includes(imgVenue))) return false;
      if (libVenueNames.length > 0 && !libVenueNames.includes(imgVenue)) return false;
      return true;
    });
  }, [libItems, libSearch, libFilters, libVenueGroup, libVenueNames, allInhouseVenues]);

  const toggleLibFilter = (cat, val) => {
    setLibFilters(prev => {
      const cur = prev[cat] || [];
      const has = cur.includes(val);
      const next = has ? cur.filter(v => v !== val) : [...cur, val];
      return { ...prev, [cat]: next };
    });
  };
  const toggleLibVenueName = (name) => setLibVenueNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  const clearLibFilters = () => { setLibFilters({}); setLibSearch(""); setLibVenueGroup("all"); setLibVenueNames([]); };

  // ═══ LIBRARY: BROWSE (filtered grid + detail/editor panel) ═══
  const LibraryBrowse = () => (
    <div style={{ display: "flex", gap: 16, minHeight: "70vh" }}>
      {/* Filter sidebar */}
      <div style={{ width: 190, flexShrink: 0, overflowY: "auto", maxHeight: "75vh" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: accent }}>Filters</div>
          {(Object.values(libFilters).some(a => a?.length) || libVenueGroup !== "all" || libVenueNames.length > 0) && <div onClick={clearLibFilters} style={{ fontSize: 10, color: "#E11D48", cursor: "pointer" }}>Clear all</div>}
        </div>
        {/* Venue filter (2-level — mirrors Browse page) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: textS, marginBottom: 4 }}>Venue</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
            <span onClick={() => { setLibVenueGroup("all"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "all"), fontSize: 10, padding: "3px 8px" }}>All</span>
            <span onClick={() => { setLibVenueGroup("inhouse"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "inhouse"), fontSize: 10, padding: "3px 8px" }}>Inhouse</span>
            <span onClick={() => { setLibVenueGroup("outside"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "outside"), fontSize: 10, padding: "3px 8px" }}>Outside</span>
          </div>
          {libVenueGroup === "inhouse" && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {allInhouseVenues.map(v => {
              const sel = libVenueNames.includes(v);
              return <span key={v} onClick={() => toggleLibVenueName(v)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "2px 6px" }}>{v}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "2px 6px", borderRadius: 10, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
          {libVenueGroup === "outside" && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {allOutdoorDB.map(v => {
              const sel = libVenueNames.includes(v.name);
              return <span key={v.name} onClick={() => toggleLibVenueName(v.name)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "2px 6px" }}>{v.name}{v.empanelled ? " ★" : ""}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "2px 6px", borderRadius: 10, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
        </div>
        {Object.keys(taxonomy).map(k => {
          // colorPalette: use paletteCatalogue names instead of legacy taxonomy values
          const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
            ? imsPaletteCatalogue.map(p => p.name)
            : taxonomy[k];
          return (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: textS, marginBottom: 4 }}>{k === "colorPalette" ? "Palette" : getTaxLabel(k)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {vals.map(v => {
                const sel = (libFilters[k] || []).includes(v);
                return <span key={v} onClick={() => toggleLibFilter(k, v)} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 10, cursor: "pointer", border: `1px solid ${sel ? accent : border}`, background: sel ? `${accent}18` : "transparent", color: sel ? accent : textS }}>{v}</span>;
              })}
            </div>
          </div>);
        })}
      </div>
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search by name..." style={{ ...S.input, marginBottom: 8, fontSize: 13 }} />
        <div style={{ fontSize: 11, color: textS, marginBottom: 8 }}>Showing {libFiltered.length} of {libItems.length} images</div>
        {libFiltered.length === 0 && libItems.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Library is empty</div>
            <div style={{ fontSize: 12 }}>Switch to "Add images" or "Bulk import" to start building your library</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
          {libFiltered.map(img => (
            <div key={img.id} onClick={() => setLibEditImg(img)} style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${libEditImg?.id === img.id ? accent : border}`, cursor: "pointer", background: cardBg, position: "relative" }}>
              <img src={img.url} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} onError={e => { e.target.style.display = "none"; }} />
              {(img.linkedTemplates || []).length > 0 && <div style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(0,0,0,0.65)", fontSize: 9, color: "#fff", display: "flex", alignItems: "center", gap: 3 }}>🔗 {(img.linkedTemplates || []).length}</div>}
              {(img.elements || []).length > 0 && <div style={{ position: "absolute", top: 6, left: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(124,58,237,0.8)", fontSize: 9, color: "#fff" }}>📋 {(img.elements || []).length}</div>}
              <div style={{ padding: "6px 8px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.name || "Untitled"}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 3 }}>
                  {(img.tags?.categoryTier || []).map(t => <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: t === "Enhanced" ? "#0EA5E922" : "#6B728022", color: t === "Enhanced" ? "#0EA5E9" : textS }}>{t}</span>)}
                  {(img.tags?.areasElements || []).slice(0, 2).map(t => <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: `${accent}12`, color: accent }}>{t}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Detail panel */}
        {libEditImg && (
          <div style={{ marginTop: 16, background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: 16 }}>
            <div style={{ display: "flex", gap: 16 }}>
              <img src={libEditImg.url} alt="" onClick={()=>setPreviewImg(libEditImg.url)} style={{ width: 200, height: 140, objectFit: "cover", borderRadius: 10, flexShrink: 0, cursor: "pointer", border: "2px solid transparent" }} title="Click to view full size" onError={e => { e.target.style.display = "none"; }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <input value={libEditImg.name || ""} onChange={e => setLibEditImg({ ...libEditImg, name: e.target.value })} style={{ ...S.input, fontSize: 14, fontWeight: 600, flex: 1, marginRight: 8 }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={libAiLoading} onClick={async() => {
                      setLibAiLoading(true); showMsg("🤖 Analyzing image...","green");
                      try{
                        const result=await Promise.race([aiTagImage(libEditImg.url),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),30000))]);
                        if(result){
                          const updated={...libEditImg};
                          // Handle tags — support both {tags:{...}} and flat {eventType:[...]} formats
                          const tagSrc=result.tags||result;
                          if(tagSrc){updated.tags={...(updated.tags||{})};Object.keys(taxonomy).forEach(k=>{if(Array.isArray(tagSrc[k])&&tagSrc[k].length)updated.tags[k]=tagSrc[k];});}
                          if(result.name&&(!updated.name||updated.name.startsWith("img ")))updated.name=result.name;
                          if(Array.isArray(result.elements)&&result.elements.length>0)updated.elements=result.elements;
                          // Handle dims
                          const d=result.dims||{};
                          const hasDims=(d.trussL||d.trussW||d.trussH||d.floorL||d.floorW);
                          if(hasDims){updated.dims={...(updated.dims||{}),trussL:d.trussL||0,trussW:d.trussW||0,trussH:d.trussH||0,floorL:d.floorL||0,floorW:d.floorW||0,plH:d.plH||updated.dims?.plH||"",mkT:d.mkT||updated.dims?.mkT||"",mkWalls:d.mkWalls||updated.dims?.mkWalls||{}};}
                          setLibEditImg(updated);
                          showMsg(`✓ AI: ${result.elements?.length||0} elements${hasDims?", dims "+d.trussL+"×"+d.trussW+"×"+d.trussH:"— no dims (fill manually)"}`,"green");
                        }else{showMsg("AI returned no results","red");}
                      }catch(e){showMsg("AI error: "+e.message,"red");}
                      setLibAiLoading(false);
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px", background: "#7C3AED", opacity: libAiLoading ? 0.5 : 1 }}>{libAiLoading ? "🔄 Tagging..." : "🤖 AI Tag"}</button>
                    <button onClick={() => {
                      // §23 Phase 2.9e — Mandate drape density for Full Box photos (trussL && trussW && trussH all filled)
                      const d = libEditImg.dims || {};
                      const isFullBox = !!(d.trussL && d.trussW && d.trussH);
                      const hasDensity = !!d.drapeDensity;
                      if (isFullBox && !hasDensity) {
                        showMsg("🪡 Drape Density required for Full Box photos — pick Minimum, Moderate, or Dense", "red");
                        return;
                      }
                      saveLib(libItems.map(i => i.id === libEditImg.id ? libEditImg : i));
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px",
                      // Dim the Save button when Full Box + no density to give visual cue
                      opacity: (libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH && !libEditImg.dims?.drapeDensity) ? 0.45 : 1
                    }}>Save</button>
                    <button onClick={() => { saveLib(libItems.filter(i => i.id !== libEditImg.id), [libEditImg.id]); setLibEditImg(null); }} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px", color: "#E11D48" }}>Delete</button>
                    <button onClick={() => setLibEditImg(null)} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px" }}>Close</button>
                  </div>
                </div>
                {/* Venue tag (2-level chip picker — mirrors Browse page) */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 2 }}>Venue</div>
                  {(() => {
                    const curVenue = libEditImg.tags?.venue || "";
                    const isInhouse = curVenue && allInhouseVenues.includes(curVenue);
                    const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                    const outsideFiltered = allOutdoorDB.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                    const setPhVenue = (val) => setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, venue: val || "" } });
                    return <>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <div onClick={() => { setTagVenueGroup("inhouse"); setTagOutsideSub("all"); }} style={S.pill(activeGroup === "inhouse")}>Inhouse</div>
                        <div onClick={() => { setTagVenueGroup("outside"); setTagOutsideSub("all"); }} style={S.pill(activeGroup === "outside")}>Outside</div>
                        {curVenue && <div onClick={() => { setPhVenue(""); setTagVenueGroup(""); }} style={{ padding: "4px 8px", borderRadius: 12, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</div>}
                      </div>
                      {activeGroup === "inhouse" && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {allInhouseVenues.map(vn => { const on = curVenue === vn; return <div key={vn} onClick={() => setPhVenue(on ? "" : vn)} style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: on ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "3px 8px" }}>{vn}</div>; })}
                      </div>}
                      {activeGroup === "outside" && <>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          <div onClick={() => setTagOutsideSub("all")} style={{ ...S.pill(tagOutsideSub === "all"), fontSize: 9, padding: "3px 8px" }}>All</div>
                          <div onClick={() => setTagOutsideSub("empanelled")} style={{ ...S.pill(tagOutsideSub === "empanelled"), fontSize: 9, padding: "3px 8px" }}>Empanelled</div>
                          <div onClick={() => setTagOutsideSub("other")} style={{ ...S.pill(tagOutsideSub === "other"), fontSize: 9, padding: "3px 8px" }}>Other</div>
                        </div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
                          {outsideFiltered.map(o => { const on = curVenue === o.name; return <div key={o.name} onClick={() => setPhVenue(on ? "" : o.name)} style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: on ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "3px 8px" }}>{o.name}{o.empanelled ? " ★" : ""}</div>; })}
                        </div>
                      </>}
                    </>;
                  })()}
                </div>
                {Object.keys(taxonomy).map(k => {
                  const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
                    ? imsPaletteCatalogue.map(p => p.name)
                    : taxonomy[k];
                  return (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: textS, marginBottom: 2 }}>{k === "colorPalette" ? "Palette" : getTaxLabel(k)}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {vals.map(v => {
                        const sel = (libEditImg.tags?.[k] || []).includes(v);
                        return <span key={v} onClick={() => {
                          const cur = libEditImg.tags?.[k] || [];
                          const next = sel ? cur.filter(x => x !== v) : [...cur, v];
                          setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, [k]: next } });
                        }} style={{ padding: "2px 7px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${sel ? accent : border}`, background: sel ? `${accent}18` : "transparent", color: sel ? accent : textS }}>{v}</span>;
                      })}
                    </div>
                  </div>);
                })}
              </div>
            </div>
            {/* ── Zone Dimensions ── */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#C9A96E", marginBottom: 8 }}>{"📐"} Zone Dimensions</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Truss L (ft)</div><input type="number" value={libEditImg.dims?.trussL || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussL: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Truss W (ft)</div><input type="number" value={libEditImg.dims?.trussW || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussW: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Truss H (ft)</div><input type="number" value={libEditImg.dims?.trussH || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussH: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor L (ft)</div><input type="number" value={libEditImg.dims?.floorL || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), floorL: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor W (ft)</div><input type="number" value={libEditImg.dims?.floorW || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), floorW: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                      const sel=(libEditImg.dims?.plH||"")=== o.v;
                      return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),plH:o.v}})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{o.l}</span>;
                    })}
                  </div>
                </div>
              </div>
              {/* ── §23 Phase 2.9e (26 May 2026) — Drape Density (Liza kg/sqft for Full Box ceiling) ── */}
              {(() => {
                const d = libEditImg.dims || {};
                const isFullBox = !!(d.trussL && d.trussW && d.trussH);
                const hasDensity = !!d.drapeDensity;
                const missing = isFullBox && !hasDensity;
                const borderC  = missing ? "rgba(239,68,68,0.55)" : "rgba(244,114,182,0.25)";
                const bgC      = missing ? (isDark?"rgba(239,68,68,0.10)":"#FEF2F2") : (isDark?"rgba(244,114,182,0.06)":"#FDF2F8");
                const labelC   = missing ? "#B91C1C" : "#9D174D";
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:8, padding:"6px 10px", borderRadius:8, background:bgC, border:`1px solid ${borderC}` }}>
                    <span style={{ fontSize:11, fontWeight:600, color:labelC }}>🪡 Drape Density {isFullBox && <span style={{ color: missing?"#B91C1C":"#059669", fontWeight:700, marginLeft:4 }}>{missing ? "* Required" : "✓"}</span>}</span>
                    <span style={{ fontSize:9, color:textS, flex:1 }}>{isFullBox ? "Required for Full Box (ceiling drape)" : "Optional — only used when Full Box truss"}</span>
                    <div style={{ display:"flex", gap:4 }}>
                      {[{v:"",l:"—"},{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o => {
                        const sel = (libEditImg.dims?.drapeDensity || "") === o.v;
                        // Hide the "—" option for Full Box (must pick one of the 3 real values)
                        if (isFullBox && o.v === "") return null;
                        return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), drapeDensity: o.v}})}
                          style={{ padding:"4px 10px", borderRadius:6, fontSize:10, fontWeight:sel?700:500, textAlign:"center", cursor:"pointer", border:`1px solid ${sel?"#EC4899":border}`, background: sel?"rgba(236,72,153,0.12)":"transparent", color: sel?"#9D174D":textS }}>{o.l}</span>;
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: textS }}>
                <span>{(libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#C9A96E", fontWeight: 600 }}>{"🔩"} Box Truss</span> : (libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>{"🔩"} Single U</span> : "Fill truss dims"}</span>
                {(libEditImg.dims?.floorL && libEditImg.dims?.floorW) ? <span>{"🧹"} Floor: {libEditImg.dims.floorL}×{libEditImg.dims.floorW} = {libEditImg.dims.floorL * libEditImg.dims.floorW} sqft</span> : null}
                {libEditImg.dims?.plH ? <span style={{ color: "#059669", fontWeight: 600 }}>{"🔨"} {libEditImg.dims.plH === "4in" ? "4 inch" : "1ft-3ft raise"}</span> : null}
              </div>
              {/* ── Masking walls ── */}
              {(libEditImg.dims?.trussW || libEditImg.dims?.trussH) && (() => {
                const dL=libEditImg.dims?.trussL||0, dW=libEditImg.dims?.trussW||0, dH=libEditImg.dims?.trussH||0;
                const isBox=dL&&dW&&dH;
                const mw=libEditImg.dims?.mkWalls||{};
                const mkT=libEditImg.dims?.mkT||"";
                const anyWall=mw.back||mw.left||mw.right;
                const toggleW=(wall)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkWalls:{...mw,[wall]:!mw[wall]}}});
                const setMkT=(t)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkT:t}});
                const walls=isBox?[
                  {id:"back",label:"Back wall",dim:`${dL} × ${dH} ft`},
                  {id:"left",label:"Left wall",dim:`${dW} × ${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dW} × ${dH} ft`}
                ]:[
                  {id:"left",label:"Left wall",dim:`${dW} × ${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dW} × ${dH} ft`}
                ];
                return <div style={{ marginTop: 10, background: anyWall ? (isDark ? "rgba(201,169,110,0.08)" : "rgba(201,169,110,0.06)") : (isDark ? "rgba(255,255,255,0.03)" : "#FAFAFA"), borderRadius: 10, padding: "12px 14px", border: `1px solid ${anyWall ? accent+"40" : border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: anyWall ? accent : textP, marginBottom: 8 }}>{"🧱"} Masking</div>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 6 }}>Material type</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {[{id:"fabric",l:"Fabric ₹20"},{id:"acrylic",l:"Acrylic ₹100"},{id:"flex",l:"Flex ₹45"},{id:"vinyl",l:"Vinyl ₹90"}].map(o=>{
                      const sel=mkT===o.id;
                      return <span key={o.id} onClick={()=>setMkT(sel?"":o.id)} style={{padding:"6px 12px",borderRadius:8,fontSize:11,cursor:"pointer",border:`1.5px solid ${sel?accent:border}`,background:sel?`${accent}22`:"transparent",color:sel?accent:textS,fontWeight:sel?600:400}}>{o.l}</span>;
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 6 }}>Select walls to mask</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {walls.map(w=>{const on=mw[w.id];return <div key={w.id} onClick={()=>toggleW(w.id)} style={{flex:1,minWidth:90,padding:"10px 12px",borderRadius:10,cursor:"pointer",border:`2px solid ${on?accent:border}`,background:on?(isDark?"rgba(201,169,110,0.12)":"rgba(201,169,110,0.08)"):"transparent",textAlign:"center"}}>
                      <div style={{fontSize:14,fontWeight:600,color:on?accent:textS,marginBottom:2}}>{on?"✓ ":""}{w.label}</div>
                      <div style={{fontSize:11,color:on?accent:textS}}>{w.dim}</div>
                    </div>;})}
                  </div>
                </div>;
              })()}
            </div>
            {/* ── Zone Structure Costs ── */}
            {(() => {
              const d=libEditImg.dims||{};
              const dL=d.trussL||0, dW=d.trussW||0, dH=d.trussH||0, fL=d.floorL||0, fW=d.floorW||0;
              const isBox=dL&&dW&&dH;
              const isSingleU=!isBox&&dW&&dH;
              const trussSqft=isBox?(()=>{const s=[dL,dW,dH].sort((a,b)=>b-a);return s[0]*s[1];})():(isSingleU?dW*dH:0);
              const trussRate=isBox?50:30;
              const trussCost=trussSqft*trussRate;
              const mw=d.mkWalls||{};const mkT=d.mkT||"";
              const mkRates={fabric:20,acrylic:100,flex:45,vinyl:90};
              const mkRate=mkRates[mkT]||0;
              let maskSqft=0;const maskWalls=[];
              if(mw.back&&isBox){const a=dL*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dL}×${dH}`,sqft:a});}
              if(mw.left){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Left",dim:`${dW}×${dH}`,sqft:a});}
              if(mw.right){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Right",dim:`${dW}×${dH}`,sqft:a});}
              const maskCost=maskSqft*mkRate;
              const flSqft=fL*fW;
              const plRate=d.plH==="4in"?30:d.plH==="1ft"?45:0;
              const plCost=flSqft*plRate;
              const cpRate=15;const cpCost=flSqft*cpRate;
              const structTotal=trussCost+maskCost+plCost+cpCost;
              if(!trussSqft&&!flSqft)return null;
              return <div style={{marginTop:14,borderTop:`1px solid ${border}`,paddingTop:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:600,color:accent}}>{"🏗️"} Zone Structure Cost</div>
                  <div style={{fontSize:13,fontWeight:600,color:accent}}>{fmt(structTotal)}</div>
                </div>
                {trussSqft>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{isBox?"Box Truss":"Single U"}</span><br/><span style={{fontSize:10,color:textS}}>{isBox?`Top 2: ${[dL,dW,dH].sort((a,b)=>b-a).slice(0,2).join("×")} = ${trussSqft} sqft × ₹${trussRate}`:`${dW}×${dH} = ${trussSqft} sqft × ₹${trussRate}`}</span></div>
                  <span style={{fontWeight:600}}>{fmt(trussCost)}</span>
                </div>}
                {maskCost>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{mkT.charAt(0).toUpperCase()+mkT.slice(1)} Masking</span><br/><span style={{fontSize:10,color:textS}}>{maskWalls.map(w=>`${w.label} ${w.dim}=${w.sqft}`).join(" + ")} = {maskSqft} sqft × ₹{mkRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(maskCost)}</span>
                </div>}
                {plCost>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>Platform ({d.plH==="4in"?"4 inch":"1ft-3ft"})</span><br/><span style={{fontSize:10,color:textS}}>{fL}×{fW} = {flSqft} sqft × ₹{plRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(plCost)}</span>
                </div>}
                {flSqft>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11}}>
                  <div><span style={{fontWeight:600}}>Carpet (New)</span><br/><span style={{fontSize:10,color:textS}}>{fL}×{fW} = {flSqft} sqft × ₹{cpRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(cpCost)}</span>
                </div>}
              </div>;
            })()}
            {/* ── Element Breakdown Card ── */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#7C3AED" }}>📋 Element Breakdown</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {libItems.filter(i => i.id !== libEditImg.id && (i.elements || []).length > 0).length > 0 && (
                    <select onChange={e => { if (!e.target.value) return; const src = libItems.find(i => i.id === e.target.value); if (src) setLibEditImg({ ...libEditImg, elements: JSON.parse(JSON.stringify(src.elements)) }); e.target.value = ""; }} style={{ ...S.select, fontSize: 10, padding: "3px 6px", width: "auto" }}>
                      <option value="">Copy from...</option>
                      {libItems.filter(i => i.id !== libEditImg.id && (i.elements || []).length > 0).map(i => <option key={i.id} value={i.id}>{i.name} ({i.elements.length} items)</option>)}
                    </select>
                  )}
                  <div style={{ position: "relative" }}>
                    <input value={libElSearch} onChange={e => setLibElSearch(e.target.value)} placeholder="+ Add element..." style={{ ...S.input, fontSize: 10, padding: "3px 8px", width: 160, marginBottom: 0 }} onFocus={() => setLibElSearch("")} />
                    {libElSearch.length >= 1 && (() => {
                      const q = libElSearch.toLowerCase();
                      const matches = rcItems.filter(rc => !(libEditImg.elements || []).find(el => el.name === rc.name) && (rc.name.toLowerCase().includes(q) || (rc.cat || "").toLowerCase().includes(q) || (rc.sub || "").toLowerCase().includes(q))).slice(0, 8);
                      return matches.length > 0 ? <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxHeight: 200, overflowY: "auto" }}>
                        {matches.map(rc => <div key={rc.id} onClick={() => {
                          if (!(libEditImg.elements || []).find(el => el.name === rc.name)) {
                            setLibEditImg({ ...libEditImg, elements: [...(libEditImg.elements || []), { name: rc.name, qty: 1, unit: rc.unit, size: rcIsSMB(rc) ? "M" : "", detail: "" }] });
                          }
                          setLibElSearch("");
                        }} style={{ padding: "6px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 500 }}>{rc.name}</span>
                          <span style={{ fontSize: 9, color: textS }}>{rc.sub?rc.sub+" › ":""}{rcCats.find(c=>c.id===rc.cat)?.l||rc.cat}</span>
                        </div>)}
                      </div> : <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, padding: "8px 10px", fontSize: 10, color: textS }}>No matches</div>;
                    })()}
                  </div>
                </div>
              </div>
              {(libEditImg.elements || []).length === 0 ? (
                <div style={{ fontSize: 11, color: textS, padding: "12px 0", textAlign: "center" }}>No elements added yet — use dropdown above or AI tagging fills this automatically</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", fontSize: 10 }}>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>ELEMENT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>QTY</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>SIZE</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>UNIT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9, textAlign: "right" }}>COST</div>
                  <div></div>
                  {(libEditImg.elements || []).map((el, idx) => {
                    const rc = rcItems.find(i => i.name === el.name);
                    const sizes = rcIsSMB(rc) ? ["S","M","B"] : null;
                    const isTrussSqft = rc && rc.unit === "truss_sqft";
                    let unitPrice=0;
                    if(rc){const sz=(el.size||"").toUpperCase();if(rcIsSMB(rc)){if(sz==="S")unitPrice=rc.inhouseS||0;else if(sz==="B")unitPrice=rc.inhouseB||0;else unitPrice=rc.inhouseM||0;}else{unitPrice=rc.inhouseFlat||0;}}
                    const lineCost=(el.qty||0)*unitPrice;
                    return (
                    <Fragment key={idx}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: rc ? textP : "#F59E0B", display: "flex", alignItems: "center", gap: 4 }}>{el.name}{(el.new || !rc) && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>NEW</span>}</div>
                      {isTrussSqft ? (
                        <div title="Area-based — uses zone truss/floor sqft" style={{ fontSize: 11, fontWeight: 600, color: textS, padding: "3px 5px", borderRadius: 4, background: isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)", textAlign: "center" }}>area</div>
                      ) : (
                        <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                      )}
                      {sizes ? (
                        <select value={el.size || sizes[0]} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                      <div style={{ fontSize: 10, color: textS }}>{el.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: (isTrussSqft ? unitPrice : lineCost) > 0 ? textP : textS }}>{isTrussSqft ? (unitPrice > 0 ? `₹${unitPrice.toLocaleString("en-IN")}/sqft` : "—") : (lineCost > 0 ? fmt(lineCost) : rc ? "₹0" : "—")}</div>
                      <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                    </Fragment>
                  );})}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: textS }}>Only Rate Card items can be added manually. Items tagged <span style={{color:"#F59E0B",fontWeight:600}}>NEW</span> were AI-detected but not in Rate Card — add them to Rate Card for pricing, or remove.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ═══ LIBRARY: ADD SINGLE IMAGE ═══
  const LibraryAdd = () => {
    const doAiTag = async () => {
      const trimmed = libAddUrl.trim();
      if (!trimmed) { showMsg("Paste a URL first", "red"); return; }
      if (!trimmed.startsWith("http")) { showMsg("Must be a web URL (https://...) — local file paths won't work", "red"); return; }
      // Detect page URLs vs direct image URLs
      if (trimmed.includes("pinterest.com/pin/") || trimmed.includes("pin.it/")) { showMsg("That's a Pinterest page — right-click the image → 'Copy image address' to get the direct URL (i.pinimg.com/...)", "red"); return; }
      if (trimmed.includes("instagram.com/p/") || trimmed.includes("instagram.com/reel/")) { showMsg("That's an Instagram page — right-click the image → 'Copy image address' to get the direct URL", "red"); return; }
      setLibAiLoading(true);
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000));
      try {
        const tags = await Promise.race([aiTagImage(trimmed), timeout]);
        if (tags) {
          const { name, elements, ...rest } = tags;
          setLibAddPreview({ url: trimmed, name: name || "Untitled", tags: rest, elements: Array.isArray(elements) ? elements : [] });
        } else {
          setLibAddPreview({ url: trimmed, name: "Untitled", tags: {} });
          showMsg("AI tagging failed — tag manually", "red");
        }
      } catch (e) {
        setLibAddPreview({ url: trimmed, name: "Untitled", tags: {} });
        showMsg(e.message === "timeout" ? "Timed out — tag manually" : "AI tagging failed — tag manually", "red");
      }
      setLibAiLoading(false);
    };
    const doSave = () => {
      if (!libAddPreview) return;
      const newImg = { id: "LIB" + Date.now().toString(36), url: libAddPreview.url, name: libAddPreview.name, tags: libAddPreview.tags, elements: libAddPreview.elements || [], addedAt: Date.now(), source: "internal" };
      saveLib([...libItems, newImg]);
      setLibAddUrl(""); setLibAddPreview(null);
    };
    const toggleTag = (cat, val) => {
      if (!libAddPreview) return;
      const cur = libAddPreview.tags?.[cat] || [];
      const has = cur.includes(val);
      const next = has ? cur.filter(x => x !== val) : [...cur, val];
      setLibAddPreview({ ...libAddPreview, tags: { ...libAddPreview.tags, [cat]: next } });
    };
    return (
      <div style={{ maxWidth: 680 }}>
        <div style={{ background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: textP, marginBottom: 4 }}>Add single image</div>
          <div style={{ fontSize: 12, color: textS, marginBottom: 12 }}>Paste a direct image URL (Cloudinary, Pexels, or right-click → "Copy image address" from Pinterest/Instagram)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={libAddUrl} onChange={e => setLibAddUrl(e.target.value)} placeholder="https://i.pinimg.com/... or https://res.cloudinary.com/..." style={{ ...S.input, flex: 1, fontSize: 12 }} />
            <button onClick={doAiTag} disabled={libAiLoading} style={{ ...S.btn(true), fontSize: 12, opacity: libAiLoading ? 0.5 : 1 }}>{libAiLoading ? "Tagging..." : "🤖 AI Tag"}</button>
          </div>
          {libAddPreview && (
            <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
              <div style={{ flexShrink: 0 }}>
                <img src={libAddPreview.url} alt="" style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 10 }} onError={e => { e.target.style.display = "none"; }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "inline-block", fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "#0EA5E918", color: "#0EA5E9", marginBottom: 8 }}>AI auto-tagged</div>
                <input value={libAddPreview.name} onChange={e => setLibAddPreview({ ...libAddPreview, name: e.target.value })} style={{ ...S.input, fontSize: 12, fontWeight: 600, marginBottom: 8 }} placeholder="Image name..." />
                {Object.keys(taxonomy).map(k => (
                  <div key={k} style={{ marginBottom: 5 }}>
                    <div style={{ fontSize: 10, color: textS, marginBottom: 2 }}>{getTaxLabel(k)}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {taxonomy[k].map(v => {
                        const sel = (libAddPreview.tags?.[k] || []).includes(v);
                        return <span key={v} onClick={() => toggleTag(k, v)} style={{ padding: "2px 7px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${sel ? "#0EA5E9" : border}`, background: sel ? "#0EA5E912" : "transparent", color: sel ? "#0EA5E9" : textS }}>{v}</span>;
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={doSave} style={{ ...S.btn(true), fontSize: 12 }}>✓ Save to library</button>
                  <button onClick={() => setLibAddPreview(null)} style={{ ...S.btn(false), fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ═══ LIBRARY: BULK IMPORT ═══
  const LibraryBulk = () => {
    const startBulk = async () => {
      const urls = libBulkText.split("\n").map(u => u.trim()).filter(u => u.startsWith("http"));
      if (!urls.length) { showMsg("Paste at least one URL", "red"); return; }
      const q = urls.map(url => ({ url, name: "Untitled", tags: {}, status: "pending" }));
      setLibBulkQueue(q);
      setLibBulkProgress(0);
      setLibAiLoading(true);
      for (let i = 0; i < q.length; i++) {
        try {
          const tags = await aiTagImage(q[i].url);
          if (tags) {
            const { name, elements, ...rest } = tags;
            q[i] = { ...q[i], name: name || "Untitled", tags: rest, elements: Array.isArray(elements) ? elements : [], status: "tagged" };
          } else {
            q[i] = { ...q[i], status: "tagged" };
          }
        } catch { q[i] = { ...q[i], status: "tagged" }; }
        setLibBulkProgress(i + 1);
        setLibBulkQueue([...q]);
      }
      setLibAiLoading(false);
    };
    const saveBulk = () => {
      const newImgs = libBulkQueue.filter(q => q.status === "tagged").map(q => ({
        id: "LIB" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        url: q.url, name: q.name, tags: q.tags, elements: q.elements || [], addedAt: Date.now(), source: "internal"
      }));
      saveLib([...libItems, ...newImgs]);
      setLibBulkQueue([]); setLibBulkText(""); setLibBulkProgress(0);
    };
    const toggleBulkTag = (idx, cat, val) => {
      const q = [...libBulkQueue];
      const cur = q[idx].tags?.[cat] || [];
      const has = cur.includes(val);
      q[idx] = { ...q[idx], tags: { ...q[idx].tags, [cat]: has ? cur.filter(x => x !== val) : [...cur, val] } };
      setLibBulkQueue(q);
    };
    return (
      <div style={{ maxWidth: 700 }}>
        <div style={{ background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: textP, marginBottom: 4 }}>Bulk import</div>
          <div style={{ fontSize: 12, color: textS, marginBottom: 12 }}>Paste multiple Cloudinary URLs (one per line). Each will be AI-tagged, then you review the batch.</div>
          {libBulkQueue.length === 0 ? (
            <>
              <textarea value={libBulkText} onChange={e => setLibBulkText(e.target.value)} rows={5} placeholder={"https://res.cloudinary.com/ambria/.../image1.jpg\nhttps://res.cloudinary.com/ambria/.../image2.jpg\nhttps://res.cloudinary.com/ambria/.../image3.jpg"} style={{ ...S.input, resize: "vertical", fontSize: 12, width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <button onClick={startBulk} disabled={libAiLoading} style={{ ...S.btn(true), fontSize: 12 }}>🤖 Process all (AI tag)</button>
                <span style={{ fontSize: 11, color: textS }}>~3-5 sec per image</span>
              </div>
            </>
          ) : (
            <>
              {libAiLoading && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: textS }}>Processing: {libBulkProgress} of {libBulkQueue.length} tagged</div>
                  <div style={{ height: 4, background: `${border}`, borderRadius: 2, marginTop: 6 }}>
                    <div style={{ height: 4, width: `${(libBulkProgress / libBulkQueue.length) * 100}%`, background: accent, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                </div>
              )}
              {!libAiLoading && <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={saveBulk} style={{ ...S.btn(true), fontSize: 12 }}>✓ Save all {libBulkQueue.filter(q => q.status === "tagged").length} to library</button>
                <button onClick={() => { setLibBulkQueue([]); setLibBulkProgress(0); }} style={{ ...S.btn(false), fontSize: 12 }}>Cancel</button>
              </div>}
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {libBulkQueue.map((item, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 12, padding: 10, borderBottom: `1px solid ${border}`, alignItems: "flex-start" }}>
                    <img src={item.url} alt="" style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} onError={e => { e.target.style.display = "none"; }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <input value={item.name} onChange={e => { const q = [...libBulkQueue]; q[idx] = { ...q[idx], name: e.target.value }; setLibBulkQueue(q); }} style={{ ...S.input, fontSize: 11, fontWeight: 600, flex: 1 }} />
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: item.status === "tagged" ? "#0EA5E918" : `${border}`, color: item.status === "tagged" ? "#0EA5E9" : textS }}>{item.status === "tagged" ? "Tagged" : "Pending"}</span>
                      </div>
                      {item.status === "tagged" && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                          {Object.keys(taxonomy).map(k => (item.tags?.[k] || []).map(v => (
                            <span key={`${k}-${v}`} onClick={() => toggleBulkTag(idx, k, v)} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: `${accent}12`, color: accent, cursor: "pointer" }}>{v} ×</span>
                          )))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ═══ MANAGE: LIBRARY & CONTENT ═══ (reference ManageLibrary() ~11684)
  return (
    <div>
      {/* Inline add bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, background: cardBg, border: `1px dashed ${accent}40`, borderRadius: 12, marginBottom: 14 }}>
        <input value={libAddUrl} onChange={e => setLibAddUrl(e.target.value)} placeholder="Paste image URL (Cloudinary, i.pinimg.com, Pexels...)" style={{ ...S.input, flex: 1, fontSize: 12 }} />
        <button onClick={async () => {
          const trimmed = libAddUrl.trim();
          if (!trimmed) { showMsg("Paste a URL first", "red"); return; }
          if (!trimmed.startsWith("http")) { showMsg("Must be a web URL (https://...)", "red"); return; }
          if (trimmed.includes("pinterest.com/pin/") || trimmed.includes("pin.it/")) { showMsg("Right-click image → 'Copy image address' for direct URL", "red"); return; }
          setLibAiLoading(true);
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000));
          try {
            const tags = await Promise.race([aiTagImage(trimmed), timeout]);
            const { name, ...rest } = tags || {};
            setLibAddPreview({ url: trimmed, name: name || "Untitled", tags: rest || {} });
          } catch { setLibAddPreview({ url: trimmed, name: "Untitled", tags: {} }); showMsg("AI tag failed — tag manually", "red"); }
          setLibAiLoading(false);
        }} disabled={libAiLoading} style={{ ...S.btn(true), fontSize: 11, opacity: libAiLoading ? 0.5 : 1 }}>{libAiLoading ? "Tagging..." : "🤖 AI tag & add"}</button>
        <button onClick={() => setLibShowBulk(!libShowBulk)} style={{ ...S.btn(false), fontSize: 11 }}>📦 Bulk</button>
      </div>
      {/* Add preview panel */}
      {libAddPreview && (
        <div style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <img src={libAddPreview.url} alt="" style={{ width: 120, height: 85, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} onError={e => { e.target.style.display = "none"; }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "inline-block", fontSize: 9, padding: "2px 7px", borderRadius: 6, background: "#0EA5E918", color: "#0EA5E9", marginBottom: 6 }}>AI auto-tagged</div>
              <input value={libAddPreview.name} onChange={e => setLibAddPreview({ ...libAddPreview, name: e.target.value })} style={{ ...S.input, fontSize: 12, fontWeight: 600, marginBottom: 6 }} placeholder="Image name..." />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                {Object.keys(taxonomy).map(k => (libAddPreview.tags?.[k] || []).map(v => <span key={`${k}-${v}`} style={{ padding: "2px 6px", fontSize: 9, borderRadius: 6, background: `${accent}12`, color: accent }}>{v}</span>))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { const ni = { id: "LIB" + Date.now().toString(36), url: libAddPreview.url, name: libAddPreview.name, tags: libAddPreview.tags, elements: libAddPreview.elements || [], addedAt: Date.now(), source: "internal" }; saveLib([...libItems, ni]); setLibAddUrl(""); setLibAddPreview(null); }} style={{ ...S.btn(true), fontSize: 11 }}>✓ Save to library</button>
                <button onClick={() => setLibAddPreview(null)} style={{ ...S.btn(false), fontSize: 11 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bulk import panel */}
      {libShowBulk && LibraryBulk()}
      {/* Images / Videos toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        <button onClick={() => setLibView("images")} style={{ ...S.btn(libView === "images"), fontSize: 11 }}>📸 Images ({libItems.length})</button>
        <button onClick={() => { setLibView("videos"); }} style={{ ...S.btn(libView === "videos"), fontSize: 11 }}>🎬 Videos ({allVideos.length})</button>
      </div>
      {/* Content */}
      {libView === "images" && LibraryBrowse()}
      {libView === "videos" && (
        <div style={{ textAlign: "center", padding: 60, color: textS }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎬</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Videos</div>
          <div style={{ fontSize: 12 }}>The video library &amp; Cloudinary browser are rebuilt in a later Studio slice.</div>
        </div>
      )}
    </div>
  );
}

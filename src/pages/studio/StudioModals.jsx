// ═══════════════════════════════════════════════════════════════
// STUDIO TOP-LEVEL MODALS — faithful rebuild.
// The deal-builder views set modal state (paintPickerTarget, fabricPickerTarget,
// dcCustomModal, videoModal, zoneUploadReview, previewImg) but nothing renders
// them. These blocks live at the END of AmbriStudioInner's return in the
// reference (App_latest.jsx). Transcribed VERBATIM here and driven off `ctx`.
// ═══════════════════════════════════════════════════════════════
import { Fragment, useState } from "react";
import AllocationPicker from "../../components/studio/AllocationPicker.jsx";
import CustomItemModal from "../../components/studio/CustomItemModal.jsx";
import KitComponentsEditor from "../../components/shared/KitComponentsEditor.jsx";
import { getCat } from "../../lib/studio/taxonomy";
import { calcZoneFabric, autoFillFabricAllocation } from "../../lib/studio/pricing";
import { qtyUsedElsewhereInBuild } from "../../lib/studio/dealAvailability";
import { isHiddenSubcat } from "../../lib/rateCard";

export default function StudioModals({ ctx }) {
  const {
    // dcCustomModal
    dcCustomModal, setDcCustomModal, dcCustomItems, setDcCustomItems,
    dcInventoryCache, dealCheckData, rcCats, rcItems, isDark, border, textP, textS,
    elSelectedPhoto,
    // videoModal
    videoModal, setVideoModal, videoPlaying, setVideoPlaying, videoOverlay, setVideoOverlay,
    showMsg, pickAndLoad, fmt, getFullCost,
    // zoneUploadReview
    zoneUploadReview, setZoneUploadReview, zoneLabelsD, accent, cardBg, S,
    rcIsSMB, calcElsCost, zurElSearch, setZurElSearch, applyZoneUpload,
    // Element Breakdown + Print — same IMS-inventory-driven pricing/search the Library editor and
    // Build's zone editor use, so the upload-review modal reflects the same live system instead of
    // its own smaller Rate-Card-only copy.
    getElPriceFromInventory, getElPriceFromPattern, recipeOnlyPatterns, imsPrintMaterials,
    // previewImg
    previewImg, setPreviewImg,
    // element gallery (zone photo viewer — grid + full-screen)
    elGallery, setElGallery, galleryIdx, setGalleryIdx, setElSelectedPhoto, calcPhotoCost,
    showCosts, elInspo, zoneAiFilling, setZoneAiFilling, aiTagImage, elNotes, setElNotes,
    // paintPickerTarget
    paintPickerTarget, setPaintPickerTarget, zoneElements, setZoneElements,
    imsDefaultPaintCost, activeFnIdx, clientPalette, extraFunctions,
    normalizePaintAllocation, imsColourCatalogue, imsPaletteCatalogue,
    // live soft-blocking (used by the zone-upload-review "+ Add element" and kit-component searches)
    collectAllFunctionData, activeFnMeta, activeBlocksForDate, getStudioAvailable, clientDate, rcSubcatFactors,
    // fabricPickerTarget
    fabricPickerTarget, setFabricPickerTarget, fnBuilds, setFnBuilds,
    zoneConfig, setZoneConfig, libItems,
    // premiaGate (👑 Sr. Designer / Platinum gate)
    premiaGate, setPremiaGate, premiaConfig,
  } = ctx;
  // Rate-card items carry no photo of their own — thumbnails for the zone-upload-review "add
  // element" search come from the matching IMS inventory item by name (best-effort; falls back to
  // the generic 📦 icon when nothing matches, same as every other add-element search in the app).
  const imsInventory = (dcInventoryCache?.length > 0 ? dcInventoryCache : dealCheckData?.inventory) || [];
  // Live soft-blocking for the zone-upload-review modal — same logic as Build's own zone editor
  // (StudioBuild.jsx's remainingForItem). The staged elements here haven't been written into
  // zoneElements[elKey] yet, so exclude that zone key entirely.
  const zurRemainingForItem = (itemId, elIdx) => {
    const it = (imsInventory || []).find(i => i.id === itemId);
    if (!it || !collectAllFunctionData) return null;
    const fns = collectAllFunctionData();
    const zoneKey = zoneUploadReview?.elKey;
    const exclude = elIdx == null ? { fnIdx: activeFnIdx, zoneKey } : { fnIdx: activeFnIdx, zoneKey, elIdx };
    const usedElsewhere = qtyUsedElsewhereInBuild(itemId, fns, imsInventory, exclude, activeFnMeta?.date || clientDate);
    if (usedElsewhere <= 0) return null;
    const otherEventsAvail = getStudioAvailable(it, activeBlocksForDate);
    return Math.max(0, otherEventsAvail - usedElsewhere);
  };
  const [zurHoveredElIdx, setZurHoveredElIdx] = useState(null);
  const [zurElHoverImg, setZurElHoverImg] = useState(null);
  const [zurPrintSearch, setZurPrintSearch] = useState({}); // per-print-row "link to inventory item" search text, keyed by print row id

  return (<>
      {/* ═══ §26.13 — 🏭/🛒 Production/Buying Custom Item Modal (31 May 2026) ═══ */}
      {dcCustomModal && <CustomItemModal
        config={dcCustomModal}
        customItems={dcCustomItems}
        setCustomItems={setDcCustomItems}
        imsInventory={(dcInventoryCache?.length > 0 ? dcInventoryCache : dealCheckData?.inventory) || []}
        rcCats={rcCats}
        rcItems={rcItems}
        isDark={isDark}
        border={border}
        textP={textP}
        textS={textS}
        onClose={() => setDcCustomModal(null)}
        zonePhoto={elSelectedPhoto[dcCustomModal.zoneKey]?.src || ""}
      />}

      {videoModal&&(
        <div style={{position:"fixed",inset:0,background:"#000",zIndex:100,display:"flex",flexDirection:"column"}} onClick={()=>{setVideoModal(null);setVideoPlaying(false);setVideoOverlay(false);}}>
          <div style={{flex:1,position:"relative",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
              {videoModal.video?(()=>{const vm=videoModal.video.match(/embed\/([a-zA-Z0-9_-]{11})/);const vl=videoModal.video.match(/list=([a-zA-Z0-9_-]+)/);const tid=vm?vm[1]:null;const wurl=tid&&tid!=="videoseries"?`https://www.youtube.com/watch?v=${tid}${vl?"&list="+vl[1]:""}`:vl?`https://www.youtube.com/playlist?list=${vl[1]}`:videoModal.video;const embedSrc=videoModal.video+(videoModal.video.includes("?")?"&":"?")+"autoplay=1&rel=0&modestbranding=1";const doCopy=(e)=>{e.stopPropagation();try{navigator.clipboard.writeText(wurl);showMsg("✓ YouTube link copied!","green");}catch{}};return <div style={{width:"100%",height:"100%"}}>{videoPlaying&&!videoOverlay?<iframe src={embedSrc} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; encrypted-media; fullscreen" allowFullScreen title="YouTube video"/>:<div onClick={(e)=>{e.stopPropagation();if(videoOverlay){setVideoOverlay(false);}setVideoPlaying(true);}} style={{width:"100%",height:"100%",cursor:"pointer",position:"relative",background:videoModal.gradient}}>
                {(videoModal.img||videoModal.photos?.[0])&&<img src={videoModal.img||videoModal.photos?.[0]} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:videoOverlay?0.2:0.6}} onError={e=>{e.target.style.display="none"}}/>}
                {videoOverlay?<div style={{position:"absolute",inset:0,background:"rgba(10,10,20,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
                  <div style={{fontSize:28,fontWeight:500,color:"#C9A96E",letterSpacing:3}}>AMBRIA</div>
                  <div style={{fontSize:14,color:"rgba(255,255,255,0.6)"}}>Loved this look? Let's build your dream decor.</div>
                  <div style={{display:"flex",gap:10,marginTop:12}}>
                    <button onClick={(e)=>{e.stopPropagation();setVideoOverlay(false);setVideoPlaying(true);}} style={{padding:"12px 28px",borderRadius:10,border:"1.5px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff",fontSize:14,fontWeight:500,cursor:"pointer"}}>{"↺"} Replay</button>
                    <button onClick={(e)=>{e.stopPropagation();pickAndLoad(videoModal,1,videoModal.video);}} style={{padding:"12px 28px",borderRadius:10,border:"none",background:"#C9A96E",color:"#0a0a14",fontSize:14,fontWeight:600,cursor:"pointer"}}>{"🎨"} Customize</button>
                    <button onClick={(e)=>{e.stopPropagation();pickAndLoad(videoModal,2,videoModal.video);showMsg("✓ Exact look loaded","green");}} style={{padding:"12px 28px",borderRadius:10,border:"1.5px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff",fontSize:14,fontWeight:500,cursor:"pointer"}}>{"📋"} Exact Look</button>
                  </div>
                  <button onClick={(e)=>{e.stopPropagation();setVideoModal(null);setVideoPlaying(false);setVideoOverlay(false);}} style={{padding:"8px 20px",borderRadius:8,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"rgba(255,255,255,0.5)",fontSize:12,cursor:"pointer",marginTop:6}}>Close</button>
                </div>
                :<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}><div style={{width:80,height:56,borderRadius:16,background:"rgba(255,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(255,0,0,0.4)"}}><div style={{width:0,height:0,borderLeft:"20px solid #fff",borderTop:"12px solid transparent",borderBottom:"12px solid transparent",marginLeft:5}}/></div><div style={{fontSize:14,color:"#fff",fontWeight:600,textShadow:"0 1px 6px rgba(0,0,0,0.8)"}}>▶ Play Video</div></div>}
                </div>}
                </div>})()
              :<div style={{width:"100%",height:"100%",background:videoModal.gradient,display:"flex",alignItems:"center",justifyContent:"center"}}>{videoModal.photos?.[0]&&<img src={videoModal.photos[0]} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none"}}/>}</div>}
            <button onClick={()=>{setVideoModal(null);setVideoPlaying(false);setVideoOverlay(false);}} style={{position:"absolute",top:16,right:16,background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:20,zIndex:20,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button>
          </div>
          {!videoOverlay&&<div style={{background:"rgba(10,10,20,0.95)",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexShrink:0}} onClick={e=>e.stopPropagation()}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:16,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{videoModal.name}</div>
              <div style={{fontSize:11,color:"#9CA3AF"}}>{videoModal.venue} · {videoModal.fn}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:700,color:"#C9A96E"}}>{fmt(getFullCost(videoModal))}</div><span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:getCat(getFullCost(videoModal)).bg,color:getCat(getFullCost(videoModal)).color,fontWeight:600}}>{getCat(getFullCost(videoModal)).label}</span></div>
              <button onClick={()=>{pickAndLoad(videoModal,1,videoModal.video);}} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#C9A96E",color:"#0a0a14",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{"🎨"} Customize</button>
              <button onClick={()=>{pickAndLoad(videoModal,2,videoModal.video);showMsg("✓ Exact look loaded","green");}} style={{padding:"8px 18px",borderRadius:8,border:`1.5px solid #C9A96E`,background:"transparent",color:"#C9A96E",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{"📋"} Exact Look</button>
            </div>
          </div>}
        </div>
      )}

      {/* Zone Upload Review Modal */}
      {zoneUploadReview&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setZoneUploadReview(null)}>
        <div style={{background:cardBg,borderRadius:16,maxWidth:700,width:"100%",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:accent+"08"}}>
            <div style={{fontSize:16,fontWeight:700,color:accent}}>📷 Review Upload → {zoneLabelsD[zoneUploadReview.elKey]?.label||zoneUploadReview.elKey}</div>
            <button onClick={()=>setZoneUploadReview(null)} style={{background:"transparent",border:"none",color:textS,fontSize:18,cursor:"pointer",fontWeight:700}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
            <div style={{display:"flex",gap:16,marginBottom:16}}>
              <img src={zoneUploadReview.url} alt="" style={{width:180,height:120,objectFit:"cover",borderRadius:10,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:10,fontWeight:700,color:textS,marginBottom:3}}>Name</div>
                <input defaultValue={zoneUploadReview.name} onBlur={e=>setZoneUploadReview(p=>({...p,name:e.target.value}))} key="zur-name" style={{...S.input,fontSize:13,fontWeight:600,marginBottom:8}}/>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {Object.entries(zoneUploadReview.tags||{}).map(([cat,vals])=>(vals||[]).map((v,i)=><span key={cat+i} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:accent+"12",color:accent}}>{v}</span>))}
                </div>
              </div>
            </div>
            {/* ── Zone Dimensions (full parity with Build's zone editor) ── */}
            <div style={{marginBottom:16,padding:12,background:isDark?"#0F0F1A":"#F9FAFB",borderRadius:10,border:`1px solid ${border}`}}>
              <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 8 }}>📐 Zone Dimensions</div>
              {(() => {
                const d = zoneUploadReview.dims || {};
                const isBox = !!(d.trussL && d.trussW && d.trussH);
                const setD = (patch) => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), ...patch } });
                const cell = { fontSize: 9, color: textS, marginBottom: 2 };
                const inp = { ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 };
                return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 6, marginBottom: 8 }}>
                  <div><div style={cell}>Truss Depth (ft)</div><input type="number" value={d.trussL || ""} onChange={e => setD({ trussL: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Width (ft)</div><input type="number" value={d.trussW || ""} onChange={e => setD({ trussW: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Height (ft)</div><input type="number" value={d.trussH || ""} onChange={e => setD({ trussH: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Qty</div><input type="number" min={1} value={d.trussQty || ""} placeholder="1" onChange={e => setD({ trussQty: Math.max(1, parseInt(e.target.value) || 1) })} style={inp} /></div>
                  {isBox && <div><div style={cell} title="Box front extended both sides — priced as 2× Single U truss">Front ext (ft/side)</div><input type="number" min={0} step="0.5" value={d.trussFrontExt || ""} placeholder="0" onChange={e => setD({ trussFrontExt: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                  {isBox && (Number(d.trussFrontExt) || 0) > 0 && <div><div style={cell}>Ext height (ft)</div><input type="number" min={0} step="0.5" value={d.trussFrontExtH || ""} placeholder={String(d.trussH || 0)} onChange={e => setD({ trussFrontExtH: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                </div>;
              })()}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), trussRows: [...((zoneUploadReview.dims || {}).trussRows || []), { id: "TR" + Date.now() + Math.floor(Math.random() * 1000), trussL: 0, trussW: 0, trussH: 0, trussQty: 1, trussFrontExt: 0, trussFrontExtH: 0, mkOn: false, mkT: "", mkWalls: {} }] } })}
                  style={{ fontSize: 10, fontWeight: 600, color: "#7C3AED", background: "transparent", border: `1px dashed #7C3AED80`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Truss</button>
              </div>
              {((zoneUploadReview.dims || {}).trussRows || []).map((row, ri) => {
                const setRow = (patch) => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), trussRows: (zoneUploadReview.dims.trussRows || []).map((x, i) => (i === ri ? { ...x, ...patch } : x)) } });
                const removeRow = () => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), trussRows: (zoneUploadReview.dims.trussRows || []).filter((_, i) => i !== ri) } });
                const rIsBox = !!(row.trussL && row.trussW && row.trussH);
                const cell = { fontSize: 9, color: textS, marginBottom: 2 };
                const inp = { ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 };
                const mw = row.mkWalls || {};
                // A U truss (only 2 of 3 dims filled) is open on the sides — only its back can be
                // masked, not left/right.
                const walls = rIsBox ? [{ id: "back", label: "Back" }, { id: "left", label: "Left" }, { id: "right", label: "Right" }] : [{ id: "back", label: "Back" }];
                return (
                  <div key={row.id} style={{ marginBottom: 10, padding: 10, borderRadius: 8, background: isDark ? "rgba(124,58,237,0.06)" : "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.25)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED" }}>Truss #{ri + 2}</span>
                      <span onClick={removeRow} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 6, marginBottom: 8 }}>
                      <div><div style={cell}>Truss Depth (ft)</div><input type="number" value={row.trussL || ""} onChange={e => setRow({ trussL: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Width (ft)</div><input type="number" value={row.trussW || ""} onChange={e => setRow({ trussW: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Height (ft)</div><input type="number" value={row.trussH || ""} onChange={e => setRow({ trussH: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Qty</div><input type="number" min={1} value={row.trussQty || ""} placeholder="1" onChange={e => setRow({ trussQty: Math.max(1, parseInt(e.target.value) || 1) })} style={inp} /></div>
                    </div>
                    {(row.trussW || row.trussH) && (
                      <div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          {[{ id: "fabric", l: "Fabric" }, { id: "acrylic", l: "Acrylic" }, { id: "flex", l: "Flex" }, { id: "vinyl", l: "Vinyl" }].map(o => {
                            const sel = row.mkT === o.id;
                            return <span key={o.id} onClick={() => setRow({ mkT: sel ? "" : o.id, mkOn: !sel })} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 9, cursor: "pointer", border: `1px solid ${sel ? "#7C3AED" : border}`, background: sel ? "#7C3AED22" : "transparent", color: sel ? "#7C3AED" : textS, fontWeight: sel ? 600 : 400 }}>{o.l}</span>;
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {walls.map(w => { const on = mw[w.id]; return <span key={w.id} onClick={() => setRow({ mkWalls: { ...mw, [w.id]: !mw[w.id] } })} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 9, cursor: "pointer", border: `1px solid ${on ? "#7C3AED" : border}`, background: on ? "#7C3AED18" : "transparent", color: on ? "#7C3AED" : textS }}>{on ? "✓ " : ""}{w.label}</span>; })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Depth (ft)</div><input type="number" value={zoneUploadReview.dims?.floorL || ""} onChange={e => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), floorL: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Width (ft)</div><input type="number" value={zoneUploadReview.dims?.floorW || ""} onChange={e => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), floorW: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                      const sel=(zoneUploadReview.dims?.plH||"")=== o.v;
                      return <span key={o.v} onClick={()=>setZoneUploadReview({...zoneUploadReview,dims:{...(zoneUploadReview.dims||{}),plH:o.v}})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{o.l}</span>;
                    })}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0" }}>
                <button onClick={() => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), platformRows: [...((zoneUploadReview.dims || {}).platformRows || []), { id: "PL" + Date.now() + Math.floor(Math.random() * 1000), plH: "", floorL: 0, floorW: 0 }] } })}
                  style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "transparent", border: "1px dashed #05966980", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Platform</button>
              </div>
              {((zoneUploadReview.dims || {}).platformRows || []).map((row, ri) => {
                const setRow = (patch) => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), platformRows: (zoneUploadReview.dims.platformRows || []).map((x, i) => (i === ri ? { ...x, ...patch } : x)) } });
                const removeRow = () => setZoneUploadReview({ ...zoneUploadReview, dims: { ...(zoneUploadReview.dims || {}), platformRows: (zoneUploadReview.dims.platformRows || []).filter((_, i) => i !== ri) } });
                return (
                  <div key={row.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: isDark ? "rgba(5,150,105,0.06)" : "rgba(5,150,105,0.04)", border: "1px solid rgba(5,150,105,0.25)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#059669" }}>Platform #{ri + 2}</span>
                      <span onClick={removeRow} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Depth (ft)</div><input type="number" value={row.floorL || ""} onChange={e => setRow({ floorL: parseFloat(e.target.value) || 0 })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Width (ft)</div><input type="number" value={row.floorW || ""} onChange={e => setRow({ floorW: parseFloat(e.target.value) || 0 })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                            const sel=(row.plH||"")=== o.v;
                            return <span key={o.v} onClick={()=>setRow({plH:o.v})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?"#059669":border}`,background:sel?"#05966918":"transparent",color:sel?"#059669":textS}}>{o.l}</span>;
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(((zoneUploadReview.dims||{}).trussRows||[]).length > 0 || ((zoneUploadReview.dims||{}).platformRows||[]).length > 0) && (
                <div style={{ fontSize: 9, color: "#F59E0B", background: isDark?"rgba(245,158,11,0.08)":"rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, padding: "5px 8px", marginBottom: 8 }}>
                  ⚠ Extra truss/platform rows price correctly here and in Build — Deal Check doesn't reflect them yet (coming soon).
                </div>
              )}
              {(() => {
                const d = zoneUploadReview.dims || {};
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
                        const sel = (zoneUploadReview.dims?.drapeDensity || "") === o.v;
                        if (isFullBox && o.v === "") return null;
                        return <span key={o.v} onClick={()=>setZoneUploadReview({...zoneUploadReview, dims:{...(zoneUploadReview.dims||{}), drapeDensity: o.v}})}
                          style={{ padding:"4px 10px", borderRadius:6, fontSize:10, fontWeight:sel?700:500, textAlign:"center", cursor:"pointer", border:`1px solid ${sel?"#EC4899":border}`, background: sel?"rgba(236,72,153,0.12)":"transparent", color: sel?"#9D174D":textS }}>{o.l}</span>;
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: textS }}>
                <span>{(zoneUploadReview.dims?.trussL && zoneUploadReview.dims?.trussW && zoneUploadReview.dims?.trussH) ? <span style={{ color: "#C9A96E", fontWeight: 600 }}>{"🔩"} Box Truss</span> : (zoneUploadReview.dims?.trussW && zoneUploadReview.dims?.trussH) ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>{"🔩"} Single U</span> : "Fill truss dims"}</span>
                {(zoneUploadReview.dims?.floorL && zoneUploadReview.dims?.floorW) ? <span>{"🧹"} Floor: {zoneUploadReview.dims.floorL}×{zoneUploadReview.dims.floorW} = {zoneUploadReview.dims.floorL * zoneUploadReview.dims.floorW} sqft</span> : null}
                {zoneUploadReview.dims?.plH ? <span style={{ color: "#059669", fontWeight: 600 }}>{"🔨"} {zoneUploadReview.dims.plH === "4in" ? "4 inch" : "1ft-3ft raise"}</span> : null}
              </div>
              {/* ── Masking walls ── */}
              {(zoneUploadReview.dims?.trussW || zoneUploadReview.dims?.trussH) && (() => {
                const dL=zoneUploadReview.dims?.trussL||0, dW=zoneUploadReview.dims?.trussW||0, dH=zoneUploadReview.dims?.trussH||0;
                const isBoxW=dL&&dW&&dH;
                const mw=zoneUploadReview.dims?.mkWalls||{};
                const mkT=zoneUploadReview.dims?.mkT||"";
                const anyWall=mw.back||mw.left||mw.right;
                const toggleW=(wall)=>setZoneUploadReview({...zoneUploadReview,dims:{...(zoneUploadReview.dims||{}),mkWalls:{...mw,[wall]:!mw[wall]}}});
                const setMkT=(t)=>setZoneUploadReview({...zoneUploadReview,dims:{...(zoneUploadReview.dims||{}),mkT:t}});
                // A U truss (open on the sides, only 2 of 3 dims filled) only has a back panel to
                // mask — no left/right walls exist to hang fabric on.
                const walls=isBoxW?[
                  {id:"back",label:"Back wall",dim:`${dL} × ${dH} ft`},
                  {id:"left",label:"Left wall",dim:`${dW} × ${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dW} × ${dH} ft`}
                ]:[
                  {id:"back",label:"Back wall",dim:`${dW} × ${dH} ft`}
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
              {/* ── Zone Structure Cost — sums the primary row + any extra Truss/Platform rows ── */}
              {(() => {
                const d=zoneUploadReview.dims||{};
                const mkRates={fabric:20,acrylic:100,flex:45,vinyl:90};
                const trussRowCalc=(row)=>{
                  const dL=row.trussL||0, dW=row.trussW||0, dH=row.trussH||0;
                  const isBox=dL&&dW&&dH;
                  const isSingleU=!isBox&&dW&&dH;
                  const trussSqft=isBox?(()=>{const s=[dL,dW,dH].sort((a,b)=>b-a);return s[0]*s[1];})():(isSingleU?dW*dH:0);
                  const trussRate=isBox?50:30;
                  const qty=Math.max(1,Number(row.trussQty)||1);
                  const trussCost=trussSqft*trussRate*qty;
                  const mw=row.mkWalls||{};const mkT=row.mkT||"";
                  const mkRate=mkRates[mkT]||0;
                  let maskSqft=0;const maskWalls=[];
                  // U truss has no left/right walls to mask — only its back panel (dW×dH) counts.
                  if(isBox){
                    if(mw.back){const a=dL*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dL}×${dH}`,sqft:a});}
                    if(mw.left){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Left",dim:`${dW}×${dH}`,sqft:a});}
                    if(mw.right){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Right",dim:`${dW}×${dH}`,sqft:a});}
                  } else if(isSingleU){
                    if(mw.back){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dW}×${dH}`,sqft:a});}
                  }
                  const maskCost=maskSqft*mkRate*qty;
                  return {isBox,trussSqft,trussRate,trussCost,mkT,mkRate,maskSqft,maskWalls,maskCost};
                };
                const platformRowCalc=(row)=>{
                  const fL=row.floorL||0, fW=row.floorW||0;
                  const flSqft=fL*fW;
                  const plRate=row.plH==="4in"?30:row.plH==="1ft"?45:0;
                  const plCost=flSqft*plRate;
                  const cpRate=15;const cpCost=flSqft*cpRate;
                  return {fL,fW,flSqft,plH:row.plH,plRate,plCost,cpRate,cpCost};
                };
                const trussRows=[{trussL:d.trussL,trussW:d.trussW,trussH:d.trussH,trussQty:d.trussQty,mkT:d.mkT,mkWalls:d.mkWalls}, ...(d.trussRows||[])];
                const platformRows=[{floorL:d.floorL,floorW:d.floorW,plH:d.plH}, ...(d.platformRows||[])];
                const trussResults=trussRows.map(trussRowCalc);
                const platformResults=platformRows.map(platformRowCalc);
                const structTotal=trussResults.reduce((s,r)=>s+r.trussCost+r.maskCost,0)+platformResults.reduce((s,r)=>s+r.plCost+r.cpCost,0);
                const anyTruss=trussResults.some(r=>r.trussSqft>0), anyFloor=platformResults.some(r=>r.flSqft>0);
                if(!anyTruss&&!anyFloor)return null;
                return <div style={{marginTop:14,borderTop:`1px solid ${border}`,paddingTop:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:accent}}>{"🏗️"} Zone Structure Cost</div>
                    <div style={{fontSize:13,fontWeight:600,color:accent}}>{fmt(structTotal)}</div>
                  </div>
                  {trussResults.map((r,ri)=> r.trussSqft>0 && <div key={"tr"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                    <div><span style={{fontWeight:600}}>{ri>0?`Truss #${ri+1} — `:""}{r.isBox?"Box Truss":"Single U"}</span><br/><span style={{fontSize:10,color:textS}}>{r.trussSqft} sqft × ₹{r.trussRate}</span></div>
                    <span style={{fontWeight:600}}>{fmt(r.trussCost)}</span>
                  </div>)}
                  {trussResults.map((r,ri)=> r.maskCost>0 && <div key={"mk"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                    <div><span style={{fontWeight:600}}>{ri>0?`Truss #${ri+1} — `:""}{r.mkT.charAt(0).toUpperCase()+r.mkT.slice(1)} Masking</span><br/><span style={{fontSize:10,color:textS}}>{r.maskWalls.map(w=>`${w.label} ${w.dim}=${w.sqft}`).join(" + ")} = {r.maskSqft} sqft × ₹{r.mkRate}</span></div>
                    <span style={{fontWeight:600}}>{fmt(r.maskCost)}</span>
                  </div>)}
                  {platformResults.map((r,ri)=> r.plCost>0 && <div key={"pl"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                    <div><span style={{fontWeight:600}}>{ri>0?`Platform #${ri+1} — `:""}Platform ({r.plH==="4in"?"4 inch":"1ft-3ft"})</span><br/><span style={{fontSize:10,color:textS}}>{r.fL}×{r.fW} = {r.flSqft} sqft × ₹{r.plRate}</span></div>
                    <span style={{fontWeight:600}}>{fmt(r.plCost)}</span>
                  </div>)}
                  {platformResults.map((r,ri)=> r.cpCost>0 && <div key={"cp"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11}}>
                    <div><span style={{fontWeight:600}}>{ri>0?`Platform #${ri+1} — `:""}Carpet (New)</span><br/><span style={{fontSize:10,color:textS}}>{r.fL}×{r.fW} = {r.flSqft} sqft × ₹{r.cpRate}</span></div>
                    <span style={{fontWeight:600}}>{fmt(r.cpCost)}</span>
                  </div>)}
                </div>;
              })()}
            </div>
            {/* ── Element Breakdown Card — same IMS-inventory-driven search/pricing as Library/Build ── */}
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"#7C3AED"}}>📋 Element Breakdown ({(zoneUploadReview.elements||[]).length} items)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {libItems.filter(i => (i.elements || []).length > 0).length > 0 && (
                    <select onChange={e => { if (!e.target.value) return; const src = libItems.find(i => i.id === e.target.value); if (src) setZoneUploadReview({ ...zoneUploadReview, elements: JSON.parse(JSON.stringify(src.elements)) }); e.target.value = ""; }} style={{ ...S.select, fontSize: 10, padding: "3px 6px", width: "auto" }}>
                      <option value="">Copy from...</option>
                      {libItems.filter(i => (i.elements || []).length > 0).map(i => <option key={i.id} value={i.id}>{i.name} ({i.elements.length} items)</option>)}
                    </select>
                  )}
                  <div style={{position:"relative"}}>
                    <input value={zurElSearch} onChange={e=>setZurElSearch(e.target.value)} placeholder="+ Add element..." style={{...S.input,fontSize:10,padding:"3px 8px",width:160,marginBottom:0}} onFocus={()=>setZurElSearch("")}/>
                    {zurElSearch.length>=1&&(()=>{
                      const tokens = zurElSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
                      const matchesTokens = (haystack) => tokens.every(t => haystack.includes(t));
                      const kitCoveredIds = new Set((zoneUploadReview.elements || []).filter(el => el.invId).flatMap(el => {
                        const it = (imsInventory || []).find(i => i.id === el.invId);
                        const comps = Array.isArray(el.kitOverrides) ? el.kitOverrides : (it?.subItems || []);
                        return comps.map(c => c.itemId);
                      }));
                      const invMatches = (imsInventory || []).filter(it => !(zoneUploadReview.elements || []).find(el => el.invId === it.id) && !kitCoveredIds.has(it.id) && !isHiddenSubcat(it, rcSubcatFactors) && matchesTokens([it.name, it.cat, it.subCat || it.subcategory].filter(Boolean).join(" ").toLowerCase()));
                      const patMatches = (recipeOnlyPatterns || []).filter(pt => !(zoneUploadReview.elements || []).find(el => el.patternId === pt.id) && matchesTokens(pt.name.toLowerCase()));
                      const matches = [...invMatches.map(it => ({ kind: "inv", it })), ...patMatches.map(pt => ({ kind: "pat", pt }))];
                      return matches.length > 0 ? <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxHeight: 340, overflowY: "auto", width: 320 }}>
                        {matches.map(m => {
                          if (m.kind === "pat") { const pt = m.pt; return <div key={"pat:" + pt.id}
                            onClick={() => {
                              if (!(zoneUploadReview.elements || []).find(el => el.patternId === pt.id)) {
                                setZoneUploadReview({ ...zoneUploadReview, elements: [...(zoneUploadReview.elements || []), { name: pt.name, qty: 1, unit: pt.unit, size: "", patternId: pt.id }] });
                              }
                              setZurElSearch("");
                            }}
                            style={{ padding: "8px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 22, opacity: 0.5 }}>🌺</span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pt.name}</span>
                                <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(236,72,153,0.15)", color: "#EC4899", fontWeight: 700, flexShrink: 0 }}>🌺 RECIPE</span>
                              </div>
                              <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{pt.sub ? pt.sub + " › " : ""}Flower recipe — no inventory item</div>
                            </div>
                          </div>; }
                          const it = m.it; const isKit = Array.isArray(it.subItems) && it.subItems.length > 0; const src = it.img || it.photoUrls?.[0];
                          const remaining = zurRemainingForItem(it.id); const isBlocked = remaining != null && remaining <= 0;
                          return <div key={"inv:" + it.id}
                            onClick={() => {
                              if (isBlocked) return;
                              if (!(zoneUploadReview.elements || []).find(el => el.invId === it.id)) {
                                setZoneUploadReview({ ...zoneUploadReview, elements: [...(zoneUploadReview.elements || []), { name: it.name, qty: 1, unit: it.unit, size: "", invId: it.id }] });
                              }
                              setZurElSearch("");
                            }}
                            style={{ padding: "8px 10px", fontSize: 11, cursor: isBlocked ? "not-allowed" : "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, opacity: isBlocked ? 0.45 : 1 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, opacity: 0.3 }}>📦</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                                {isKit && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(99,102,241,0.15)", color: "#6366F1", fontWeight: 700, flexShrink: 0 }}>📦 KIT</span>}
                                {isBlocked && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700, flexShrink: 0 }}>🚫 fully used in this event</span>}
                                {!isBlocked && remaining != null && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700, flexShrink: 0 }}>{remaining} left for this event</span>}
                              </div>
                              <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " : ""}{it.cat}</div>
                            </div>
                          </div>;
                        })}
                      </div> : <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, padding: "8px 10px", fontSize: 10, color: textS, width: 320 }}>No matches</div>;
                    })()}
                  </div>
                </div>
              </div>
              {(zoneUploadReview.elements||[]).length===0?<div style={{fontSize:11,color:textS,padding:12,textAlign:"center"}}>No elements detected — search and add above or re-run AI</div>:
              <div style={{ fontSize: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", padding: "0 4px" }}>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>ELEMENT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>QTY</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>SIZE</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>UNIT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9, textAlign: "right" }}>COST</div>
                  <div></div>
                </div>
                {(zoneUploadReview.elements || []).map((el, idx) => {
                  const rowStyle = { display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", padding: "3px 4px", borderRadius: 6, background: zurHoveredElIdx === idx ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)") : "transparent" };
                  const rowHover = { onMouseEnter: () => setZurHoveredElIdx(idx), onMouseLeave: () => setZurHoveredElIdx(null) };
                  if (el.invId) {
                    const invItem = (imsInventory || []).find(i => i.id === el.invId);
                    const isKit = !!(invItem && Array.isArray(invItem.subItems) && invItem.subItems.length > 0);
                    const { lineCost, isFloralBlend, realPct, patternSMB } = getElPriceFromInventory(el);
                    const thumbSrc = invItem?.img || invItem?.photoUrls?.[0];
                    return (
                      <div key={idx} style={rowStyle} {...rowHover}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: invItem ? textP : "#F59E0B", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center", cursor: thumbSrc ? "zoom-in" : "default" }}
                            onMouseEnter={(e) => {
                              if (!thumbSrc) return;
                              const r = e.currentTarget.getBoundingClientRect();
                              const POP = 164;
                              const openUp = window.innerHeight - r.bottom < POP + 8 && r.top > POP + 8;
                              setZurElHoverImg({ idx, openUp, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined, left: Math.min(r.left, window.innerWidth - 168) });
                            }}
                            onMouseLeave={() => setZurElHoverImg(null)}>
                            {thumbSrc ? <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, opacity: 0.3 }}>📦</span>}
                          </div>
                          {zurElHoverImg?.idx === idx && thumbSrc && (
                            <div style={{ position: "fixed", top: zurElHoverImg.top, bottom: zurElHoverImg.bottom, left: zurElHoverImg.left, zIndex: 10000, width: 160, height: 160, borderRadius: 8, overflow: "hidden", border: `2px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                              <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </div>
                          )}
                          <span>{el.name}</span>
                          {isKit && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(99,102,241,0.15)", color: "#6366F1", fontWeight: 700 }}>📦 KIT</span>}
                          {!invItem && <span title="This inventory item no longer exists" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>⚠ DELETED</span>}
                          {el.lowConfidence && <span title={`AI matched this by a ${el.matchScore ?? "?"}% keyword overlap, not an exact/near-exact name — please verify it's the right item`} style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700 }}>❓ VERIFY</span>}
                          {el.matchMethod && !el.lowConfidence && <span title={el.matchMethod === "exact" ? "AI matched this by an exact name match" : el.matchMethod === "substring" ? "AI matched this by a name substring match" : `AI matched this by a ${el.matchScore}% keyword overlap`} style={{ fontSize: 8, opacity: 0.4, cursor: "help" }}>ⓘ</span>}
                          {isFloralBlend && <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700 }}>🌸<button onClick={() => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: undefined }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Use this sub-category's default real/artificial ratio" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: typeof el.realPct !== "number" ? "#EC4899" : "rgba(236,72,153,0.12)", color: typeof el.realPct !== "number" ? "#fff" : "#EC4899" }}>🌐 Ratio</button><button onClick={() => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: 100 }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: el.realPct === 100 ? "#EC4899" : "rgba(236,72,153,0.12)", color: el.realPct === 100 ? "#fff" : "#EC4899" }}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct ?? ""} placeholder={String(realPct ?? "")} onChange={(e) => { const v = e.target.value; const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: v === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)) }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Manually set the exact % real — overrides Ratio/100%" style={{ width: 42, padding: "1px 4px", borderRadius: 3, border: `1px solid ${border}`, background: cardBg, color: textP, fontSize: 9, textAlign: "center" }} /></span>}
                        </div>
                        <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                        {patternSMB ? (
                          <select value={el.size || "B"} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                            {["S", "M", "B"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                        <div style={{ fontSize: 10, color: textS }}>{invItem?.unit || el.unit}</div>
                        <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : invItem ? "₹0" : "—"}</div>
                        <span onClick={() => { const elems = (zoneUploadReview.elements || []).filter((_, i) => i !== idx); setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                        {isKit && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <KitComponentsEditor
                              item={invItem}
                              overrides={el.kitOverrides}
                              onChange={(next) => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], kitOverrides: next }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }}
                              imsInventory={imsInventory}
                              flowerPatterns={recipeOnlyPatterns}
                              qtyMultiplier={el.qty || 1}
                              dealAwareness={{ getRemaining: (itemId) => zurRemainingForItem(itemId, idx) }}
                              rcSubcatFactors={rcSubcatFactors}
                              textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                            />
                          </div>
                        )}
                      </div>
                    );
                  }
                  if (el.patternId) {
                    const { lineCost, isFloralBlend, realPct, patternSMB } = getElPriceFromPattern(el);
                    const livePattern = (recipeOnlyPatterns || []).find(p => p.id === el.patternId);
                    const patternExists = !!livePattern;
                    return (
                      <div key={idx} style={rowStyle} {...rowHover}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: textP, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 11, opacity: 0.5 }}>🌺</span>
                          </div>
                          {el.name}
                          <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(236,72,153,0.15)", color: "#EC4899", fontWeight: 700 }}>🌺 RECIPE</span>
                          {!patternExists && <span title="This flower recipe no longer exists" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>⚠ DELETED</span>}
                          {el.lowConfidence && <span title={`AI matched this by a ${el.matchScore ?? "?"}% keyword overlap, not an exact/near-exact name — please verify it's the right recipe`} style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700 }}>❓ VERIFY</span>}
                          {el.matchMethod && !el.lowConfidence && <span title={el.matchMethod === "exact" ? "AI matched this by an exact name match" : el.matchMethod === "substring" ? "AI matched this by a name substring match" : `AI matched this by a ${el.matchScore}% keyword overlap`} style={{ fontSize: 8, opacity: 0.4, cursor: "help" }}>ⓘ</span>}
                          {isFloralBlend && <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700 }}>🌸<button onClick={() => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: undefined }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Use this sub-category's default real/artificial ratio" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: typeof el.realPct !== "number" ? "#EC4899" : "rgba(236,72,153,0.12)", color: typeof el.realPct !== "number" ? "#fff" : "#EC4899" }}>🌐 Ratio</button><button onClick={() => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: 100 }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: el.realPct === 100 ? "#EC4899" : "rgba(236,72,153,0.12)", color: el.realPct === 100 ? "#fff" : "#EC4899" }}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct ?? ""} placeholder={String(realPct ?? "")} onChange={(e) => { const v = e.target.value; const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], realPct: v === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)) }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} title="Manually set the exact % real — overrides Ratio/100%" style={{ width: 42, padding: "1px 4px", borderRadius: 3, border: `1px solid ${border}`, background: cardBg, color: textP, fontSize: 9, textAlign: "center" }} /></span>}
                        </div>
                        <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                        {patternSMB ? (
                          <select value={el.size || "B"} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                            {["S", "M", "B"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                        <div style={{ fontSize: 10, color: textS }}>{livePattern?.unit || el.unit}</div>
                        <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : "₹0"}</div>
                        <span onClick={() => { const elems = (zoneUploadReview.elements || []).filter((_, i) => i !== idx); setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                      </div>
                    );
                  }
                  const rc = rcItems.find(i => i.name === el.name);
                  const sizes = rcIsSMB(rc) ? ["S","M","B"] : null;
                  const isTrussSqft = rc && rc.unit === "truss_sqft";
                  let unitPrice=0;
                  if(rc){const sz=(el.size||"").toUpperCase();if(rcIsSMB(rc)){if(sz==="S")unitPrice=rc.inhouseS||0;else if(sz==="B")unitPrice=rc.inhouseB||0;else unitPrice=rc.inhouseM||0;}else{unitPrice=rc.inhouseFlat||0;}}
                  const lineCost=(el.qty||0)*unitPrice;
                  return (
                  <div key={idx} style={rowStyle} {...rowHover}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: rc ? textP : "#F59E0B", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>{el.name}{(el.new || !rc) && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>NEW</span>}</div>
                    {isTrussSqft ? (
                      <div title="Area-based — uses zone truss/floor sqft" style={{ fontSize: 11, fontWeight: 600, color: textS, padding: "3px 5px", borderRadius: 4, background: isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)", textAlign: "center" }}>area</div>
                    ) : (
                      <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                    )}
                    {sizes ? (
                      <select value={el.size || sizes[0]} onChange={e => { const elems = [...(zoneUploadReview.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                        {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                    <div style={{ fontSize: 10, color: textS }}>{rc?.unit || el.unit}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: (isTrussSqft ? unitPrice : lineCost) > 0 ? textP : textS }}>{isTrussSqft ? (unitPrice > 0 ? `₹${unitPrice.toLocaleString("en-IN")}/sqft` : "—") : (lineCost > 0 ? fmt(lineCost) : rc ? "₹0" : "—")}</div>
                    <span onClick={() => { const elems = (zoneUploadReview.elements || []).filter((_, i) => i !== idx); setZoneUploadReview({ ...zoneUploadReview, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                  </div>
                  );})}
              </div>}
              {(zoneUploadReview.elements||[]).length>0&&<div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${border}`,marginTop:6}}>
                <div style={{fontSize:11,fontWeight:700,color:textP}}>Element Total</div>
                <div style={{fontSize:13,fontWeight:700,color:accent}}>{fmt(calcElsCost(zoneUploadReview.elements,false))}</div>
              </div>}
              <div style={{ marginTop: 8, fontSize: 10, color: textS }}>Manually-added elements come from IMS inventory (📦 KIT items price as one line at the kit's own rate). Items tagged <span style={{color:"#F59E0B",fontWeight:600}}>NEW</span> were AI-detected but have no matching IMS inventory item — add the item to Inventory, or remove. Items tagged <span style={{color:"#EF4444",fontWeight:600}}>❓ VERIFY</span> were matched by a weak keyword guess, not an exact name — double-check they're the right item.</div>
            </div>
            {/* ── Print — a print job (Flex/Vinyl/Sunboard etc.); linking it to an inventory element
                 is optional, not required, since a print isn't always for something already in
                 Inventory (e.g. a custom banner/backdrop graphic). ── */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9" }}>🖨️ Print</div>
                <button onClick={() => {
                  const entry = { id: "PR" + Date.now() + Math.floor(Math.random() * 1000), material: (imsPrintMaterials || [])[0]?.id || "", areaW: 0, areaD: 0, refImageUrl: "", invId: null };
                  setZoneUploadReview({ ...zoneUploadReview, prints: [...(zoneUploadReview.prints || []), entry] });
                }} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #0EA5E9", background: "rgba(14,165,233,0.14)", color: "#0EA5E9", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>+ Add Print Row</button>
              </div>
              {(() => {
                // Opens with one ready-to-edit blank row instead of a "no prints" empty state — purely
                // visual (not written to zoneUploadReview.prints) until the user actually edits it.
                const rows = (zoneUploadReview.prints || []).length === 0
                  ? [{ id: "__phantom__", material: (imsPrintMaterials || [])[0]?.id || "", areaW: 0, areaD: 0, refImageUrl: "", invId: null }]
                  : zoneUploadReview.prints;
                return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {rows.map((p, pi) => {
                    const isPhantom = p.id === "__phantom__";
                    const invItem = p.invId ? (imsInventory || []).find(i => i.id === p.invId) : null;
                    const thumbSrc = invItem?.img || invItem?.photoUrls?.[0];
                    const mat = (imsPrintMaterials || []).find(m => m.id === p.material);
                    const sqft = (Number(p.areaW) || 0) * (Number(p.areaD) || 0);
                    const rate = mat?.ratePerSqft || 0;
                    const cost = sqft * rate;
                    const setPrint = (patch) => {
                      if (isPhantom) { setZoneUploadReview({ ...zoneUploadReview, prints: [{ ...p, ...patch, id: "PR" + Date.now() + Math.floor(Math.random() * 1000) }] }); return; }
                      setZoneUploadReview({ ...zoneUploadReview, prints: zoneUploadReview.prints.map((x, i) => (i === pi ? { ...x, ...patch } : x)) });
                    };
                    const linkQ = zurPrintSearch[p.id] || "";
                    return (
                      <div key={p.id} style={{ padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(14,165,233,0.06)" : "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.25)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <select value={p.material || ""} onChange={e => setPrint({ material: e.target.value })} style={{ ...S.select, fontSize: 10, padding: "3px 6px", width: "auto" }}>
                            <option value="">Material…</option>
                            {(imsPrintMaterials || []).map(m => <option key={m.id} value={m.id}>{m.name} (₹{m.ratePerSqft}/sqft)</option>)}
                          </select>
                          <input type="number" min="0" step="0.1" value={p.areaW || ""} onChange={e => setPrint({ areaW: parseFloat(e.target.value) || 0 })} placeholder="W ft" style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 56, marginBottom: 0, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: textS }}>×</span>
                          <input type="number" min="0" step="0.1" value={p.areaD || ""} onChange={e => setPrint({ areaD: parseFloat(e.target.value) || 0 })} placeholder="D ft" style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 56, marginBottom: 0, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: textS }}>ft = {sqft ? sqft.toFixed(1) : 0} sqft</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0EA5E9", marginLeft: "auto" }}>{rate > 0 ? fmt(cost) : "— pick material"}</span>
                          {!isPhantom && <span onClick={() => setZoneUploadReview({ ...zoneUploadReview, prints: zoneUploadReview.prints.filter((_, i) => i !== pi) })} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>}
                        </div>
                        <input value={p.refImageUrl || ""} onChange={e => setPrint({ refImageUrl: e.target.value })} placeholder="Reference image URL (optional)" style={{ ...S.input, fontSize: 10, padding: "3px 8px", marginTop: 6, marginBottom: 0, width: "100%" }} />
                        {p.refImageUrl && <img src={p.refImageUrl} alt="" style={{ marginTop: 6, width: "100%", maxHeight: 100, objectFit: "cover", borderRadius: 6 }} onError={e => { e.target.style.display = "none"; }} />}
                        {/* Optional link to an inventory element — for cross-reference only, never required */}
                        {p.invId ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {thumbSrc ? <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, opacity: 0.3 }}>📦</span>}
                            </div>
                            <span style={{ fontSize: 10, color: invItem ? textS : "#F59E0B", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {invItem ? invItem.name : `⚠ ${p.invId} not in IMS`}</span>
                            <span onClick={() => setPrint({ invId: null })} style={{ cursor: "pointer", color: textS, fontSize: 9, textDecoration: "underline" }}>Unlink</span>
                          </div>
                        ) : (
                          <div style={{ position: "relative", marginTop: 6 }}>
                            <input value={linkQ} onChange={e => setZurPrintSearch(prev => ({ ...prev, [p.id]: e.target.value }))} placeholder="🔗 Link to an inventory item (optional)" style={{ ...S.input, fontSize: 10, padding: "3px 8px", width: "100%", marginBottom: 0 }} />
                            {linkQ.trim() && (() => {
                              const tokens = linkQ.toLowerCase().trim().split(/\s+/).filter(Boolean);
                              const matches = (imsInventory || []).filter(it => tokens.every(t => (it.name + " " + (it.subCat || it.subcategory || "") + " " + (it.cat || "")).toLowerCase().includes(t))).slice(0, 40);
                              return (
                                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxHeight: 260, overflowY: "auto" }}>
                                  {matches.length === 0 && <div style={{ padding: "8px 10px", fontSize: 10, color: textS }}>No matches</div>}
                                  {matches.map(it => {
                                    const src = it.img || it.photoUrls?.[0];
                                    return (
                                      <div key={it.id} onClick={() => {
                                        const toFt = (v, u) => (Number(v) || 0) * ({ Feet: 1, Inches: 1 / 12, Cm: 1 / 30.48, Metre: 3.28084 }[u] || 1);
                                        const patch = { invId: it.id };
                                        if (!p.areaW && !p.areaD) { if (it.printW) patch.areaW = toFt(it.printW, it.printUnit); if (it.printL) patch.areaD = toFt(it.printL, it.printUnit); }
                                        setPrint(patch);
                                        setZurPrintSearch(prev => ({ ...prev, [p.id]: "" }));
                                      }} style={{ padding: "8px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 15, opacity: 0.3 }}>📦</span>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{it.name}</div>
                                          <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " : ""}{it.cat}{it.printW ? " · print area on file" : ""}</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(zoneUploadReview.prints || []).length > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, paddingTop: 4 }}>
                    <span style={{ color: textP }}>Print Total</span>
                    <span style={{ color: "#0EA5E9" }}>{fmt((zoneUploadReview.prints || []).reduce((sum, p) => { const m = (imsPrintMaterials || []).find(x => x.id === p.material); const s = (Number(p.areaW) || 0) * (Number(p.areaD) || 0); return sum + s * (m?.ratePerSqft || 0); }, 0))}</span>
                  </div>}
                </div>
                );
              })()}
            </div>
          </div>
          <div style={{padding:"14px 20px",borderTop:`1px solid ${border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={()=>setZoneUploadReview(null)} style={S.btn(false)}>Cancel</button>
            <button onClick={applyZoneUpload} style={{...S.btn(true),padding:"10px 24px",fontSize:13}}>✓ Apply to {zoneLabelsD[zoneUploadReview.elKey]?.label||"Zone"}</button>
          </div>
        </div>
      </div>}

      {/* Photo preview */}
      {previewImg&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:100001,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={()=>setPreviewImg(null)}><img src={previewImg} alt="" style={{maxWidth:"90vw",maxHeight:"85vh",objectFit:"contain",borderRadius:12}}/></div>}

      {/* ═══ Element gallery — zone photo viewer (grid + full-screen single) ═══ */}
      {elGallery&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={()=>{setElGallery(null);setGalleryIdx(null);}}>
          <div style={{padding:"16px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}} onClick={e=>e.stopPropagation()}>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>{zoneLabelsD[elGallery.elKey]?.icon} {elGallery.title}</div>
              <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{elGallery.photos.length} photos · Tap to select · Selected photo sets pricing</div>
            </div>
            <button onClick={()=>{setElGallery(null);setGalleryIdx(null);}} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",width:40,height:40,borderRadius:"50%",cursor:"pointer",fontSize:20,fontWeight:700}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"0 24px 24px"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
              {elGallery.photos.map((ph,i)=>{
                const isSelected = elSelectedPhoto[elGallery.elKey]?.src === ph.src;
                let photoElCost = calcPhotoCost(elGallery.elKey, ph);
                const catInfo = getCat(getFullCost(ph));
                return (
                <div key={i} style={{borderRadius:14,overflow:"hidden",background:isSelected?"#0D2818":"#1A1A2E",border:isSelected?"3px solid #059669":"3px solid transparent",cursor:"pointer",transition:"all 0.15s"}}
                  onClick={()=>setGalleryIdx(i)}>
                  <div style={{position:"relative"}}>
                    <img src={ph.src} alt={ph.eventName||ph.title||""} loading="lazy" style={{width:"100%",height:220,objectFit:"cover",display:"block"}} onError={e=>{e.target.style.display="none"}}/>
                    {showCosts&&<div style={{position:"absolute",top:12,left:12,background:isSelected?"#059669":"rgba(0,0,0,0.7)",color:"#fff",padding:"5px 12px",borderRadius:8,fontSize:14,fontWeight:700}}>{fmt(photoElCost)}</div>}
                    {isSelected&&<div style={{position:"absolute",top:12,right:12,background:"#059669",color:"#fff",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700}}>✓</div>}
                    {ph.category&&<div style={{position:"absolute",bottom:12,left:12,display:"flex",gap:6}}>
                      <span style={{fontSize:11,padding:"3px 10px",borderRadius:8,background:catInfo.bg,color:catInfo.color,fontWeight:600}}>{ph.category}</span>
                      <span style={{fontSize:11,padding:"3px 10px",borderRadius:8,background:"rgba(0,0,0,0.6)",color:"#fff"}}>{ph.fn} · {ph.space}</span>
                    </div>}
                    {ph.isWebResult&&<div style={{position:"absolute",bottom:12,left:12,display:"flex",gap:6}}>
                      <span style={{fontSize:11,padding:"3px 10px",borderRadius:8,background:"rgba(201,169,110,0.9)",color:"#0F0F1A",fontWeight:700}}>{"🌐"} {ph.source||"Web"}</span>
                    </div>}
                  </div>
                  <div style={{padding:"12px 16px"}}>
                    <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:4}}>{ph.eventName||ph.title||"Inspiration"}</div>
                    {ph.desc&&<div style={{fontSize:11,color:"#9CA3AF",lineHeight:1.5,marginBottom:6}}>{ph.desc}</div>}
                    {ph.tags?.length>0&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>{ph.tags.slice(0,4).map((t,j)=><span key={j} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:"rgba(201,169,110,0.15)",color:"#C9A96E"}}>{t}</span>)}</div>}
                  </div>
                </div>);
              })}
            </div>
            {elInspo[elGallery.elKey]?.length>0&&(<>
              <div style={{fontSize:14,fontWeight:600,color:"#C9A96E",marginTop:24,marginBottom:12}}>✨ Web Inspiration</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
                {elInspo[elGallery.elKey].map((card,ci)=>(
                  <div key={card.id||ci} style={{borderRadius:12,overflow:"hidden",background:"#1A1A2E"}}>
                    <div style={{background:card.blobUrl?`url(${card.blobUrl}) center/cover no-repeat`:card.gradient,height:120,position:"relative",overflow:"hidden"}}>
                      <span style={{position:"absolute",bottom:6,left:6,fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(0,0,0,0.5)",color:"#fff",zIndex:2}}>{card.source}</span>
                    </div>
                    <div style={{padding:"10px 14px"}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:4}}>{card.title}</div>
                      <div style={{fontSize:11,color:"#9CA3AF",lineHeight:1.5,marginBottom:8}}>{card.desc}</div>
                      {card.img&&<button disabled={zoneAiFilling[elGallery.elKey]} onClick={async()=>{
                        setZoneAiFilling(p=>({...p,[elGallery.elKey]:true}));
                        try{const result=await Promise.race([aiTagImage(card.img),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),25000))]);
                          if(result?.elements?.length){setZoneElements(p=>({...p,[elGallery.elKey]:result.elements}));setElSelectedPhoto(p=>({...p,[elGallery.elKey]:{src:card.img,eventName:card.title}}));showMsg(`✓ ${result.elements.length} elements extracted`,"green");setElGallery(null);}
                          else{showMsg("Couldn't extract — try another","red");}}catch{showMsg("Failed — try another","red");}
                        setZoneAiFilling(p=>({...p,[elGallery.elKey]:false}));
                      }} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,background:"linear-gradient(135deg,#C9A96E,#A67C3D)",color:"#0F0F1A"}}>
                        {zoneAiFilling[elGallery.elKey]?"🔄 Extracting...":"✨ Use This Look → Auto Price"}
                      </button>}
                    </div>
                  </div>
                ))}
              </div>
            </>)}
          </div>
          {galleryIdx!==null&&elGallery.photos[galleryIdx]&&(()=>{
            const ph=elGallery.photos[galleryIdx];const total=elGallery.photos.length;
            const isSelected=elSelectedPhoto[elGallery.elKey]?.src===ph.src;
            let photoElCost=calcPhotoCost(elGallery.elKey, ph);
            const goPrev=()=>setGalleryIdx(p=>p>0?p-1:total-1);
            const goNext=()=>setGalleryIdx(p=>p<total-1?p+1:0);
            return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.97)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setElGallery(null);setGalleryIdx(null);}}>
              <button onClick={()=>{setElGallery(null);setGalleryIdx(null);}} style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.08)",border:"none",color:"rgba(255,255,255,0.5)",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,fontWeight:700,zIndex:310}}>✕</button>
              <button onClick={e=>{e.stopPropagation();goPrev();}} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"none",color:"rgba(255,255,255,0.6)",fontSize:20,cursor:"pointer",zIndex:310,display:"flex",alignItems:"center",justifyContent:"center"}}>{"◀"}</button>
              <button onClick={e=>{e.stopPropagation();goNext();}} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"none",color:"rgba(255,255,255,0.6)",fontSize:20,cursor:"pointer",zIndex:310,display:"flex",alignItems:"center",justifyContent:"center"}}>{"▶"}</button>
              <div onClick={e=>e.stopPropagation()} style={{position:"relative",maxWidth:"92vw",maxHeight:"92vh"}}>
                <img src={ph.src} alt="" style={{maxWidth:"92vw",maxHeight:"92vh",objectFit:"contain",borderRadius:10,display:"block"}} onError={e=>{e.target.style.display="none"}}/>
                {showCosts&&<div style={{position:"absolute",bottom:16,right:16,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(8px)",padding:"6px 14px",borderRadius:10}}>
                  <div style={{fontSize:16,fontWeight:700,color:"#C9A96E"}}>{fmt(photoElCost)}</div>
                </div>}
                {isSelected&&<div style={{position:"absolute",top:16,left:16,background:"#059669",color:"#fff",padding:"4px 12px",borderRadius:8,fontSize:11,fontWeight:600}}>{"✓"} Selected</div>}
                {ph.isWebResult&&<div style={{position:"absolute",bottom:16,left:16,right:16,display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#fff",textShadow:"0 1px 4px rgba(0,0,0,0.7)",marginBottom:2}}>{ph.title||ph.eventName}</div>
                    {ph.desc&&<div style={{fontSize:11,color:"rgba(255,255,255,0.7)",textShadow:"0 1px 4px rgba(0,0,0,0.7)",maxWidth:400}}>{ph.desc}</div>}
                    {ph.source&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:"rgba(0,0,0,0.5)",color:"rgba(255,255,255,0.8)",marginTop:4,display:"inline-block"}}>{ph.source}</span>}
                  </div>
                  <button disabled={zoneAiFilling[elGallery.elKey]} onClick={async(e)=>{
                    e.stopPropagation();
                    setZoneAiFilling(p=>({...p,[elGallery.elKey]:true}));
                    try{const result=await Promise.race([aiTagImage(ph.src),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),25000))]);
                      if(result?.elements?.length){setZoneElements(p=>({...p,[elGallery.elKey]:result.elements}));setElSelectedPhoto(p=>({...p,[elGallery.elKey]:{src:ph.src,eventName:ph.title||ph.eventName}}));showMsg(`✓ ${result.elements.length} elements extracted`,"green");setElGallery(null);setGalleryIdx(null);}
                      else{showMsg("Couldn't extract — try another","red");}}catch{showMsg("Failed — try another","red");}
                    setZoneAiFilling(p=>({...p,[elGallery.elKey]:false}));
                  }} style={{padding:"12px 24px",borderRadius:12,border:"none",cursor:"pointer",fontSize:14,fontWeight:700,background:"linear-gradient(135deg,#C9A96E,#A67C3D)",color:"#0F0F1A",whiteSpace:"nowrap",opacity:zoneAiFilling[elGallery.elKey]?0.6:1}}>
                    {zoneAiFilling[elGallery.elKey]?"🔄 Extracting...":"✨ Use This Look"}
                  </button>
                </div>}
              </div>
              <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",fontSize:11,color:"rgba(255,255,255,0.3)",zIndex:310}}>{galleryIdx+1} / {total}</div>
            </div>);
          })()}
          <div style={{flexShrink:0,padding:"14px 24px",background:"#12121F",borderTop:"1px solid rgba(255,255,255,0.06)"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:"#C9A96E",marginBottom:4,fontWeight:600}}>📝 Client Notes for {zoneLabelsD[elGallery.elKey]?.label}</div>
                <input value={elNotes[elGallery.elKey]||""} onChange={e=>setElNotes(p=>({...p,[elGallery.elKey]:e.target.value}))}
                  placeholder={`e.g. "No couch on stage", "Add more roses", "Keep it minimal"...`}
                  style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)",background:"#0F0F1A",color:"#fff",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <button onClick={()=>{setElGallery(null);setGalleryIdx(null);}} style={{padding:"10px 24px",borderRadius:10,border:"none",background:"#C9A96E",color:"#0F0F1A",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* §23 Phase 2.9d — Paint Allocation Picker (replaces single-colour ColourPicker for elements) */}
      {paintPickerTarget && (() => {
        const {zoneKey, elIdx} = paintPickerTarget;
        const el = (zoneElements[zoneKey] || [])[elIdx];
        if (!el) return null;
        const invItem = (dealCheckData?.inventory || []).find(i => i.name === el.name);
        const baseColour = invItem?.baseColour || "Ivory";
        const paintCost = invItem?.paintCost ?? imsDefaultPaintCost;
        // Pick active function's palette
        const activePalette = activeFnIdx === 0 ? clientPalette : (extraFunctions[activeFnIdx - 1]?.palette || "Custom");
        // Initial allocation from current state (normalized from legacy paintOverride if needed)
        const initialAllocation = normalizePaintAllocation(el, baseColour);
        return (
          <AllocationPicker
            open={true}
            onClose={() => setPaintPickerTarget(null)}
            elName={el.name}
            totalQty={Number(el.qty) || 0}
            baseColour={baseColour}
            paintCost={paintCost}
            initialAllocation={initialAllocation}
            colourCatalogue={imsColourCatalogue}
            paletteCatalogue={imsPaletteCatalogue}
            palette={activePalette}
            onSave={(allocs) => {
              const elems = [...(zoneElements[zoneKey] || [])];
              const next = {...elems[elIdx]};
              // Drop legacy single-colour field — paintAllocation is now authoritative
              delete next.paintOverride;
              if (Array.isArray(allocs) && allocs.length > 0) {
                next.paintAllocation = allocs;
              } else {
                delete next.paintAllocation;
              }
              elems[elIdx] = next;
              setZoneElements(p => ({...p, [zoneKey]: elems}));
              setPaintPickerTarget(null);
            }}
          />
        );
      })()}

      {/* §23 Phase 2.9f — Fabric AllocationPicker (Masking / Liza / Curtains, one at a time) */}
      {fabricPickerTarget && (() => {
        const { fnIdx, zoneKey, fabricType, rowIdx = 0 } = fabricPickerTarget;
        const trussInvLocal = dealCheckData?.trussInv;
        if (!trussInvLocal) { setFabricPickerTarget(null); return null; }
        // Read the relevant fn's data (active fn from flat state, others from fnBuilds)
        const isActiveFn = fnIdx === activeFnIdx;
        const fnZC  = isActiveFn ? zoneConfig : (fnBuilds[fnIdx]?.zoneConfig || {});
        const fnEsp = isActiveFn ? elSelectedPhoto : (fnBuilds[fnIdx]?.elSelectedPhoto || {});
        const zCfg = fnZC[zoneKey] || {};
        // Row 0 = the zone's own scalar fields; extra rows live on zCfg.extraTrussRows[rowIdx-1].
        const row = rowIdx === 0 ? zCfg : ((zCfg.extraTrussRows || [])[rowIdx - 1] || {});
        const photoUrl = fnEsp[zoneKey];
        let density = "moderate";
        if (photoUrl) {
          const li = libItems.find(l => l.url === photoUrl);
          if (li?.dims?.drapeDensity) density = li.dims.drapeDensity;
        }
        const fab = calcZoneFabric(row, trussInvLocal, density);
        const fnPalette = isActiveFn ? clientPalette : (extraFunctions[fnIdx-1]?.palette || "Custom");
        // Pick the right config for this fabric type
        const cfg = fabricType === "masking" ? {
          totalQty: fab.maskingPieces, unitLabel:"pc", elName:"Wall Masking",
          stockArr: trussInvLocal.maskingStock, qtyField:"stockPieces", allocField:"maskingAllocation"
        } : fabricType === "liza" ? {
          totalQty: Math.ceil(fab.lizaKg), unitLabel:"kg", elName:"Liza Fabric",
          stockArr: trussInvLocal.lizaStock, qtyField:"stockKg", allocField:"lizaAllocation"
        } : {
          totalQty: fab.curtainPieces, unitLabel:"pc", elName:"Velvet Curtains",
          stockArr: trussInvLocal.curtainStock, qtyField:"stockPieces", allocField:"curtainAllocation"
        };
        const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
        const anchors = pObj?.anchorColours || [];
        const existingAlloc = row[cfg.allocField];
        const initial = (Array.isArray(existingAlloc) && existingAlloc.length > 0)
          ? existingAlloc
          : autoFillFabricAllocation(cfg.totalQty, anchors, cfg.stockArr, cfg.qtyField);
        // Filter colour catalogue to only colours that exist in this fabric's stock array
        const stockColours = new Set((cfg.stockArr || []).map(s => s.colour));
        const filteredCat = (imsColourCatalogue || []).filter(c => stockColours.has(c.name));
        // Write allocation to the correct row — row 0 sits directly on the zone, extra rows sit on
        // zoneConfig[zoneKey].extraTrussRows[rowIdx-1].
        const patchZone = (zoneObj, nextAlloc) => {
          if (rowIdx === 0) {
            const updated = { ...zoneObj };
            if (nextAlloc) updated[cfg.allocField] = nextAlloc; else delete updated[cfg.allocField];
            return updated;
          }
          const rows = [...(zoneObj.extraTrussRows || [])];
          const target = { ...(rows[rowIdx - 1] || {}) };
          if (nextAlloc) target[cfg.allocField] = nextAlloc; else delete target[cfg.allocField];
          rows[rowIdx - 1] = target;
          return { ...zoneObj, extraTrussRows: rows };
        };
        return (
          <AllocationPicker
            open={true}
            onClose={() => setFabricPickerTarget(null)}
            elName={cfg.elName}
            totalQty={cfg.totalQty}
            baseColour={""}
            paintCost={0}
            initialAllocation={initial}
            colourCatalogue={filteredCat}
            paletteCatalogue={imsPaletteCatalogue}
            palette={fnPalette}
            onSave={(allocs) => {
              const cleaned = (Array.isArray(allocs) ? allocs : []).filter(a => (Number(a.qty)||0) > 0 && a.colour);
              const nextAlloc = cleaned.length > 0 ? cleaned : null;
              if (isActiveFn) {
                setZoneConfig(prev => ({ ...prev, [zoneKey]: patchZone(prev[zoneKey] || {}, nextAlloc) }));
              } else {
                setFnBuilds(prev => {
                  const snap = prev[fnIdx] || {};
                  const curZc = snap.zoneConfig || {};
                  const curZone = curZc[zoneKey] || {};
                  return { ...prev, [fnIdx]: { ...snap, zoneConfig: { ...curZc, [zoneKey]: patchZone(curZone, nextAlloc) } } };
                });
              }
              setFabricPickerTarget(null);
            }}
          />
        );
      })()}

      {premiaGate&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setPremiaGate(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:isDark?"#1a1a2e":"#fff",borderRadius:14,maxWidth:440,width:"100%",overflow:"hidden",border:`1px solid ${border}`,boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
          <div style={{background:isDark?"#0F0F1A":"#F5F3EE",padding:"22px 26px 16px",borderBottom:`1px solid ${border}`}}>
            <div style={{display:"inline-block",background:"#26215C",color:"#CECBF6",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:5,letterSpacing:"0.04em",marginBottom:10}}>{premiaConfig.badge}</div>
            <div style={{fontSize:19,fontWeight:600,color:isDark?"#F5F5F0":"#1a1a2e"}}>{premiaConfig.title}</div>
            <div style={{fontSize:12,color:textS,marginTop:3}}>{premiaConfig.subtitle}</div>
          </div>
          <div style={{padding:"18px 26px 14px",whiteSpace:"pre-wrap",fontSize:13,lineHeight:1.7,color:isDark?"#E5E5E5":"#1a1a2e"}}>
            {premiaConfig.body}
          </div>
          <div style={{padding:"12px 26px 22px",display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <button onClick={()=>setPremiaGate(null)} style={{background:"transparent",border:`1px solid ${border}`,color:isDark?"#E5E5E5":"#1a1a2e",padding:"9px 18px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>{premiaConfig.closeLabel||"Close"}</button>
            {premiaConfig.ctaLabel&&premiaConfig.ctaUrl&&<a href={premiaConfig.ctaUrl} target="_blank" rel="noopener noreferrer" onClick={()=>setPremiaGate(null)} style={{background:"#26215C",border:"1px solid #26215C",color:"#EEEDFE",padding:"9px 18px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"none"}}>{premiaConfig.ctaLabel}</a>}
          </div>
        </div>
      </div>}
  </>);
}

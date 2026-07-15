// ═══════════════════════════════════════════════════════════════
// STUDIO TOP-LEVEL MODALS — faithful rebuild.
// The deal-builder views set modal state (paintPickerTarget, fabricPickerTarget,
// dcCustomModal, videoModal, zoneUploadReview, previewImg) but nothing renders
// them. These blocks live at the END of AmbriStudioInner's return in the
// reference (App_latest.jsx). Transcribed VERBATIM here and driven off `ctx`.
// ═══════════════════════════════════════════════════════════════
import { Fragment } from "react";
import AllocationPicker from "../../components/studio/AllocationPicker.jsx";
import CustomItemModal from "../../components/studio/CustomItemModal.jsx";
import { getCat } from "../../lib/studio/taxonomy";
import { calcZoneFabric, autoFillFabricAllocation } from "../../lib/studio/pricing";

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
    // previewImg
    previewImg, setPreviewImg,
    // element gallery (zone photo viewer — grid + full-screen)
    elGallery, setElGallery, galleryIdx, setGalleryIdx, setElSelectedPhoto, calcPhotoCost,
    showCosts, elInspo, zoneAiFilling, setZoneAiFilling, aiTagImage, elNotes, setElNotes,
    // paintPickerTarget
    paintPickerTarget, setPaintPickerTarget, zoneElements, setZoneElements,
    imsDefaultPaintCost, activeFnIdx, clientPalette, extraFunctions,
    normalizePaintAllocation, imsColourCatalogue, imsPaletteCatalogue,
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
            {/* Dimensions */}
            <div style={{marginBottom:16,padding:12,background:isDark?"#0F0F1A":"#F9FAFB",borderRadius:10,border:`1px solid ${border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:accent,marginBottom:8}}>📐 Estimated Dimensions (ft)</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {[["Truss Width","trussW"],["Truss Depth","trussL"],["Truss Height","trussH"],["Floor Width","floorW"],["Floor Depth","floorL"]].map(([l,f])=>
                  <div key={f} style={{minWidth:70}}>
                    <div style={{fontSize:9,color:textS,fontWeight:600}}>{l}</div>
                    <input type="number" defaultValue={zoneUploadReview.dims?.[f]||0} onBlur={e=>setZoneUploadReview(p=>({...p,dims:{...p.dims,[f]:Number(e.target.value)||0}}))} key={"zur-"+f} style={{width:65,padding:"5px 8px",borderRadius:6,border:`1px solid ${border}`,background:isDark?"#0A0A14":"#fff",color:textP,fontSize:13,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit"}}/>
                  </div>
                )}
                <div style={{minWidth:70}}>
                  <div style={{fontSize:9,color:textS,fontWeight:600}}>Platform</div>
                  <select defaultValue={zoneUploadReview.dims?.plH||""} onChange={e=>setZoneUploadReview(p=>({...p,dims:{...p.dims,plH:e.target.value||null}}))} style={S.select}>
                    <option value="">None</option><option value="4in">4 inch</option><option value="1ft">1ft</option>
                  </select>
                </div>
                <div style={{minWidth:70}}>
                  <div style={{fontSize:9,color:textS,fontWeight:600}}>Masking</div>
                  <select defaultValue={zoneUploadReview.dims?.mkT||""} onChange={e=>setZoneUploadReview(p=>({...p,dims:{...p.dims,mkT:e.target.value||null}}))} style={S.select}>
                    <option value="">None</option><option value="fabric">Fabric</option><option value="acrylic">Acrylic</option><option value="flex">Flex</option><option value="vinyl">Vinyl</option>
                  </select>
                </div>
              </div>
            </div>
            {/* Element Card — matches Library editor */}
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"#7C3AED"}}>📋 Element Breakdown ({(zoneUploadReview.elements||[]).length} items)</div>
                <div style={{position:"relative"}}>
                  <input value={zurElSearch} onChange={e=>setZurElSearch(e.target.value)} placeholder="+ Add element..." style={{...S.input,fontSize:10,padding:"3px 8px",width:160,marginBottom:0}} onFocus={()=>setZurElSearch("")}/>
                  {zurElSearch.length>=1&&(()=>{
                    const q=zurElSearch.toLowerCase();
                    const matches=rcItems.filter(rc=>!(zoneUploadReview.elements||[]).find(el=>el.name===rc.name)&&(rc.name.toLowerCase().includes(q)||(rc.cat||"").toLowerCase().includes(q)||(rc.sub||"").toLowerCase().includes(q))).slice(0,8);
                    return matches.length>0?<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:240,overflowY:"auto"}}>
                      {matches.map(rc=>{
                        const invMatch=imsInventory.find(i=>(i.name||"").toLowerCase().trim()===rc.name.toLowerCase().trim());
                        const src=invMatch?.img||invMatch?.photoUrls?.[0];
                        return <div key={rc.id} onClick={()=>{
                        if(!(zoneUploadReview.elements||[]).find(el=>el.name===rc.name)){setZoneUploadReview(p=>({...p,elements:[...(p.elements||[]),{name:rc.name,qty:1,unit:rc.unit,size:rcIsSMB(rc)?"M":"",detail:""}]}));}
                        setZurElSearch("");
                      }} style={{padding:"6px 10px",fontSize:11,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:28,height:28,borderRadius:6,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:13,opacity:0.3}}>📦</span>}
                        </div>
                        <div style={{flex:1,minWidth:0,display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                          <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{rc.name}</span>
                          <span style={{fontSize:9,color:textS,whiteSpace:"nowrap",flexShrink:0}}>{rc.sub?rc.sub+" › ":""}{rcCats.find(c=>c.id===rc.cat)?.l||rc.cat}</span>
                        </div>
                      </div>;})}
                    </div>:<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:10,color:textS}}>No matches</div>;
                  })()}
                </div>
              </div>
              {(zoneUploadReview.elements||[]).length===0?<div style={{fontSize:11,color:textS,padding:12,textAlign:"center"}}>No elements detected — search and add above or re-run AI</div>:
              <div style={{display:"grid",gridTemplateColumns:"1fr 60px 55px 50px 70px 24px",gap:"4px 5px",alignItems:"center",fontSize:10}}>
                <div style={{fontWeight:600,color:textS,fontSize:9}}>ELEMENT</div>
                <div style={{fontWeight:600,color:textS,fontSize:9}}>QTY</div>
                <div style={{fontWeight:600,color:textS,fontSize:9}}>SIZE</div>
                <div style={{fontWeight:600,color:textS,fontSize:9}}>UNIT</div>
                <div style={{fontWeight:600,color:textS,fontSize:9,textAlign:"right"}}>COST</div>
                <div/>
                {(zoneUploadReview.elements||[]).map((el,idx)=>{
                  const rc=rcItems.find(i=>i.name.toLowerCase()===(el.name||"").toLowerCase());
                  const sizes=rcIsSMB(rc)?["S","M","B"]:null;
                  const isTrussSqft = rc && rc.unit === "truss_sqft";
                  let unitPrice=0;
                  if(rc){const sz=(el.size||"").toUpperCase();if(rcIsSMB(rc)){if(sz==="S")unitPrice=rc.inhouseS||0;else if(sz==="B")unitPrice=rc.inhouseB||0;else unitPrice=rc.inhouseM||0;}else{unitPrice=rc.inhouseFlat||0;}}
                  const lineCost=(el.qty||0)*unitPrice;
                  return <Fragment key={idx}>
                    <div style={{fontSize:11,fontWeight:500,color:rc?textP:"#F59E0B",display:"flex",alignItems:"center",gap:4}}>{el.name}{(el.new||!rc)&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700}}>NEW</span>}</div>
                    {isTrussSqft ? (
                      <div title="Area-based — uses zone truss/floor sqft" style={{fontSize:11,fontWeight:600,color:textS,padding:"3px 5px",borderRadius:4,background:isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)",textAlign:"center"}}>area</div>
                    ) : (
                      <input type="number" defaultValue={el.qty||0} onBlur={e=>{const v=Number(e.target.value)||0;setZoneUploadReview(p=>({...p,elements:p.elements.map((x,i)=>i===idx?{...x,qty:v}:x)}));}} key={"zur-q"+idx} style={{...S.input,fontSize:11,padding:"3px 5px",textAlign:"center"}} placeholder="0"/>
                    )}
                    {sizes?<select defaultValue={el.size||sizes[0]} onChange={e=>{const v=e.target.value;setZoneUploadReview(p=>({...p,elements:p.elements.map((x,i)=>i===idx?{...x,size:v}:x)}));}} style={{...S.select,fontSize:10,padding:"2px 3px"}}>{sizes.map(s=><option key={s} value={s}>{s}</option>)}</select>:<div style={{fontSize:10,color:textS,textAlign:"center"}}>—</div>}
                    <div style={{fontSize:10,color:textS}}>{el.unit||"pc"}</div>
                    <div style={{fontSize:11,fontWeight:500,textAlign:"right",color:(isTrussSqft?unitPrice:lineCost)>0?textP:textS}}>{isTrussSqft?(unitPrice>0?`₹${unitPrice.toLocaleString("en-IN")}/sqft`:"—"):(lineCost>0?fmt(lineCost):rc?"₹0":"—")}</div>
                    <span onClick={()=>setZoneUploadReview(p=>({...p,elements:p.elements.filter((_,i)=>i!==idx)}))} style={{cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12,textAlign:"center"}}>×</span>
                  </Fragment>;
                })}
              </div>}
              {(zoneUploadReview.elements||[]).length>0&&<div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${border}`,marginTop:6}}>
                <div style={{fontSize:11,fontWeight:700,color:textP}}>Element Total</div>
                <div style={{fontSize:13,fontWeight:700,color:accent}}>{fmt(calcElsCost(zoneUploadReview.elements,false))}</div>
              </div>}
              <div style={{marginTop:8,fontSize:10,color:textS}}>Only Rate Card items can be added manually. Items tagged <span style={{color:"#F59E0B",fontWeight:600}}>NEW</span> were AI-detected but not in Rate Card — add them to Rate Card for pricing, or remove.</div>
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
        const { fnIdx, zoneKey, fabricType } = fabricPickerTarget;
        const trussInvLocal = dealCheckData?.trussInv;
        if (!trussInvLocal) { setFabricPickerTarget(null); return null; }
        // Read the relevant fn's data (active fn from flat state, others from fnBuilds)
        const isActiveFn = fnIdx === activeFnIdx;
        const fnZC  = isActiveFn ? zoneConfig : (fnBuilds[fnIdx]?.zoneConfig || {});
        const fnEsp = isActiveFn ? elSelectedPhoto : (fnBuilds[fnIdx]?.elSelectedPhoto || {});
        const zCfg = fnZC[zoneKey] || {};
        const photoUrl = fnEsp[zoneKey];
        let density = "moderate";
        if (photoUrl) {
          const li = libItems.find(l => l.url === photoUrl);
          if (li?.dims?.drapeDensity) density = li.dims.drapeDensity;
        }
        const fab = calcZoneFabric(zCfg, trussInvLocal, density);
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
        const existingAlloc = zCfg[cfg.allocField];
        const initial = (Array.isArray(existingAlloc) && existingAlloc.length > 0)
          ? existingAlloc
          : autoFillFabricAllocation(cfg.totalQty, anchors, cfg.stockArr, cfg.qtyField);
        // Filter colour catalogue to only colours that exist in this fabric's stock array
        const stockColours = new Set((cfg.stockArr || []).map(s => s.colour));
        const filteredCat = (imsColourCatalogue || []).filter(c => stockColours.has(c.name));
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
              if (isActiveFn) {
                setZoneConfig(prev => {
                  const cur = prev[zoneKey] || {};
                  const updated = { ...cur };
                  if (cleaned.length > 0) updated[cfg.allocField] = cleaned; else delete updated[cfg.allocField];
                  return { ...prev, [zoneKey]: updated };
                });
              } else {
                setFnBuilds(prev => {
                  const snap = prev[fnIdx] || {};
                  const curZc = snap.zoneConfig || {};
                  const curZone = curZc[zoneKey] || {};
                  const nextZone = { ...curZone };
                  if (cleaned.length > 0) nextZone[cfg.allocField] = cleaned; else delete nextZone[cfg.allocField];
                  return { ...prev, [fnIdx]: { ...snap, zoneConfig: { ...curZc, [zoneKey]: nextZone } } };
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

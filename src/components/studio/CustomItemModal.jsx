import { useState, useEffect, useMemo } from "react";
import { fetchAll } from "../../lib/supabase";

// ═══ superset-schema field accessors (copied VERBATIM from reference module scope) ═══
// IMS items post-02-May migration carry BOTH legacy (cat/qty/price/img/size) and new
// (category/subcategory/qtyOwned/rentalCost/photoUrls/dims_LxWxH) field names. Deploy 1 reads
// new names with legacy fallback for items that pre-date the migration.
const imsField = {
  category:    (i) => i?.category || i?.cat || "",
  subcategory: (i) => i?.subcategory || i?.subCat || "",
  rentalCost:  (i) => Number(i?.rentalCost ?? i?.price ?? 0) || 0,
  qtyOwned:    (i) => Number(i?.qtyOwned ?? i?.qty ?? 0) || 0,
  photos:      (i) => Array.isArray(i?.photoUrls) && i.photoUrls.length ? i.photoUrls : (i?.img ? [i.img] : []),
  dims:        (i) => i?.dims_LxWxH || null,
  sizeText:    (i) => i?.size || (() => { const d=i?.dims_LxWxH; return d ? [d.l,d.w,d.h].filter(Boolean).join(" × ")+(d.unit?" "+d.unit:"") : ""; })(),
};

// §26.13 — Production/Buying Custom Item Modal (proper component for hooks)
export default function CustomItemModal({ config, customItems, setCustomItems, imsInventory: initialInv, rcCats, rcItems, isDark, border, textP, textS, onClose, zonePhoto }) {
  const { fnIdx, zoneKey, type, editId } = config;
  const isProduction = type === "production";
  const icon = isProduction ? "🏭" : "🛒";
  const label = isProduction ? "Production" : "Buying";
  const color = isProduction ? "#A855F7" : "#F59E0B";
  const existing = editId ? customItems.find(x => x.id === editId) : null;
  const [cForm, setCForm] = useState(existing || { cat: "", subCat: "", qty: 1, dims: { l: "", w: "", h: "" }, notes: "", photo: zonePhoto || "" });
  const [cPhotoUploading, setCPhotoUploading] = useState(false);
  const [cRefResults, setCRefResults] = useState([]);
  const [cSelectedRef, setCSelectedRef] = useState(existing?.refItemId || null);
  const [cManualPrice, setCManualPrice] = useState(existing?.manualPrice || "");
  const [cShowManual, setCShowManual] = useState(!!existing?.manualPrice);
  // Fresh IMS inventory — fetch on mount if initial inventory is empty
  const [liveInv, setLiveInv] = useState(initialInv);
  useEffect(() => {
    if (liveInv && liveInv.length > 0) return;
    // This is a static SPA — there is no /api/data endpoint. IMS inventory lives in the Supabase
    // `inventory` TABLE, so read it directly when no DealCheck cache was passed in. Without this,
    // the reference-pricing matcher had nothing to search and always showed "No reference items".
    (async () => {
      try {
        const inv = await fetchAll("inventory");
        if (Array.isArray(inv) && inv.length > 0) setLiveInv(inv);
      } catch (e) { console.warn("[custom-item] fresh IMS fetch failed:", e); }
    })();
  }, []);
  const imsInventory = (liveInv && liveInv.length > 0) ? liveInv : initialInv;
  // Photo upload to Cloudinary
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setCPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", "z3nlj6cx");
      fd.append("folder", "production-ref");
      const res = await fetch("https://api.cloudinary.com/v1_1/dy9wfqhry/image/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.secure_url) setCForm(f => ({ ...f, photo: data.secure_url }));
    } catch (err) { console.warn("[custom-item] photo upload failed:", err); }
    finally { setCPhotoUploading(false); }
  };
  // RC-driven Category → Subcategory
  const catLabels = useMemo(() => (rcCats || []).map(c => c?.l).filter(Boolean), [rcCats]);
  const subcatsByCat = useMemo(() => {
    const out = {};
    (rcCats || []).forEach(c => { if (c?.l) out[c.l] = new Set(); });
    (rcItems || []).forEach(i => {
      const cat = (rcCats || []).find(c => c?.id === i?.cat);
      const sub = (i?.sub || "").trim();
      if (cat?.l && sub) { if (!out[cat.l]) out[cat.l] = new Set(); out[cat.l].add(sub); }
    });
    const final = {};
    Object.keys(out).forEach(k => { final[k] = Array.from(out[k]).sort(); });
    return final;
  }, [rcCats, rcItems]);
  const currentSubs = cForm.cat ? (subcatsByCat[cForm.cat] || []) : [];
  // Search IMS by subcategory + category with fuzzy matching + dimension similarity
  useEffect(() => {
    const sub = (cForm.subCat || "").toLowerCase().trim();
    const cat = (cForm.cat || "").toLowerCase().trim();
    if (!sub && !cat) { setCRefResults([]); return; }
    const scored = imsInventory.map(it => {
      const iSub = (imsField.subcategory(it) || "").toLowerCase().trim();
      const iCat = (imsField.category(it) || "").toLowerCase().trim();
      let relevance = 0;
      if (sub && iSub === sub) relevance = 100;
      else if (sub && iSub && (iSub.includes(sub) || sub.includes(iSub))) relevance = 80;
      else if (cat && iCat === cat) relevance = 50;
      else if (cat && iCat && (iCat.includes(cat) || cat.includes(iCat))) relevance = 40;
      if (relevance === 0) return null;
      const d = it.dims_LxWxH || {};
      const dimL = Number(cForm.dims.l) || 0, dimW = Number(cForm.dims.w) || 0, dimH = Number(cForm.dims.h) || 0;
      const il = Number(d.l) || 0, iw = Number(d.w) || 0, ih = Number(d.h) || 0;
      const hasDims = dimL > 0 || dimW > 0 || dimH > 0;
      const dimScore = hasDims ? Math.abs(il - dimL) + Math.abs(iw - dimW) + Math.abs(ih - dimH) : 0;
      return { ...it, _relevance: relevance, _dimScore: dimScore, _photo: imsField.photos(it)[0] || "", _cost: Number(it.cost) || Number(it.price) || 0, _dims: imsField.sizeText(it) };
    }).filter(Boolean);
    scored.sort((a, b) => b._relevance - a._relevance || a._dimScore - b._dimScore);
    const top = scored.slice(0, 3);
    setCRefResults(top);
    if (top.length > 0 && !cSelectedRef) setCSelectedRef(top[0].id);
  }, [cForm.subCat, cForm.cat, cForm.dims.l, cForm.dims.w, cForm.dims.h, imsInventory]);
  const selectedItem = cRefResults.find(r => r.id === cSelectedRef);
  const refPrice = selectedItem?._cost || 0;
  const finalPrice = cManualPrice ? Number(cManualPrice) : refPrice;
  const canSave = cForm.subCat && cForm.qty > 0 && finalPrice > 0;
  const onSave = () => {
    const item = {
      id: editId || `custom-${Date.now()}`,
      fnIdx, zoneKey, type,
      cat: cForm.cat, subCat: cForm.subCat, qty: Number(cForm.qty) || 1,
      dims: { l: Number(cForm.dims.l)||0, w: Number(cForm.dims.w)||0, h: Number(cForm.dims.h)||0 },
      refItemId: cSelectedRef || null, refPrice,
      manualPrice: cManualPrice ? Number(cManualPrice) : null,
      finalPrice, notes: cForm.notes || "",
      photo: cForm.photo || ""
    };
    if (editId) { setCustomItems(prev => prev.map(x => x.id === editId ? item : x)); }
    else { setCustomItems(prev => [...prev, item]); }
    onClose();
  };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{width:"min(700px, 100%)",maxHeight:"85vh",background:isDark?"#0F0F1A":"#fff",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:textP}}>{icon} Add {label} Item</div>
            <div style={{fontSize:10,color:textS,marginTop:2}}>Zone: {zoneKey} · System will find reference pricing from inventory</div>
          </div>
          <button onClick={onClose} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"14px 18px",overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:14}}>
          {/* Reference photo */}
          <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            <div style={{flexShrink:0}}>
              {cForm.photo ? (
                <div style={{position:"relative"}}>
                  <img src={cForm.photo} alt="Reference" style={{width:80,height:80,borderRadius:10,objectFit:"cover",border:`2px solid ${color}`}} />
                  <button onClick={()=>setCForm(f=>({...f,photo:""}))} style={{position:"absolute",top:-4,right:-4,width:18,height:18,borderRadius:"50%",background:"#EF4444",color:"#fff",border:"none",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              ) : (
                <div style={{width:80,height:80,borderRadius:10,border:`2px dashed ${border}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
                  <span style={{fontSize:24}}>📷</span>
                  <span style={{fontSize:8,color:textS}}>No photo</span>
                </div>
              )}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:4}}>Reference Photo {isProduction && <span style={{color:color,fontSize:9}}>(required for production team)</span>}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <label style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${color}40`,background:`${color}08`,color:color,fontSize:10,fontWeight:600,cursor:cPhotoUploading?"wait":"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
                  {cPhotoUploading ? "⏳ Uploading..." : "📸 Upload Photo"}
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoUpload} disabled={cPhotoUploading} />
                </label>
                {zonePhoto && !cForm.photo && (
                  <button onClick={()=>setCForm(f=>({...f,photo:zonePhoto}))} style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,cursor:"pointer"}}>Use zone photo</button>
                )}
              </div>
              {cForm.photo && <div style={{fontSize:9,color:"#10B981",marginTop:4}}>✓ Photo attached</div>}
              {!cForm.photo && zonePhoto && <div style={{fontSize:9,color:textS,marginTop:4}}>Zone photo available as default</div>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:4}}>Category *</div>
              <select value={cForm.cat} onChange={e => { setCForm(f=>({...f, cat: e.target.value, subCat: ""})); setCSelectedRef(null); setCRefResults([]); }}
                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12}}>
                <option value="">— Select category —</option>
                {catLabels.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:4}}>Sub-Category *</div>
              <select value={cForm.subCat} onChange={e => { setCForm(f=>({...f, subCat: e.target.value})); setCSelectedRef(null); setCRefResults([]); }}
                disabled={!cForm.cat}
                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12,opacity:cForm.cat?1:0.5}}>
                <option value="">{cForm.cat ? "— Select subcategory —" : "Pick category first"}</option>
                {currentSubs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
            {[["Qty *","qty","number",1],["Width (ft)","w","number","W"],["Depth (ft)","l","number","D"],["Height (ft)","h","number","H"]].map(([lbl,key,t,ph])=>(
              <div key={key}>
                <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:4}}>{lbl}</div>
                <input type={t} value={key==="qty"?cForm.qty:(cForm.dims[key]||"")} onChange={e=>key==="qty"?setCForm(f=>({...f,qty:e.target.value})):setCForm(f=>({...f,dims:{...f.dims,[key]:e.target.value}}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12}} placeholder={String(ph)} />
              </div>
            ))}
          </div>
          <div>
            <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:4}}>Notes (optional)</div>
            <input value={cForm.notes} onChange={e => setCForm(f=>({...f, notes: e.target.value}))}
              style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12}} placeholder="Special requirements..." />
          </div>
          {cForm.subCat && (
            <div>
              <div style={{fontSize:10,color:textS,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:8}}>
                {cRefResults.length > 0 ? `System Reference (${cRefResults.length} match${cRefResults.length===1?"":"es"})` : "No reference items found"}
              </div>
              {cRefResults.length > 0 ? (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))",gap:10}}>
                  {cRefResults.map(it => {
                    const isSel = cSelectedRef === it.id;
                    return (
                      <div key={it.id} onClick={() => { setCSelectedRef(it.id); setCShowManual(false); setCManualPrice(""); }}
                        style={{cursor:"pointer",padding:10,borderRadius:10,border:isSel?`2px solid ${color}`:`1px solid ${border}`,background:isSel?`${color}12`:isDark?"rgba(255,255,255,0.03)":"#FAFAFA",display:"flex",flexDirection:"column",gap:6,position:"relative"}}>
                        {isSel && <div style={{position:"absolute",top:-6,right:-6,width:20,height:20,borderRadius:"50%",background:color,color:"#fff",fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,0.3)"}}>✓</div>}
                        {it._photo ? <img src={it._photo} alt="" style={{width:"100%",height:80,objectFit:"cover",borderRadius:6}} /> : <div style={{width:"100%",height:80,borderRadius:6,background:isDark?"rgba(255,255,255,0.05)":"#eee",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:textS}}>📦</div>}
                        <div style={{fontSize:11,fontWeight:600,color:textP,lineHeight:1.2}}>{it.name}</div>
                        <div style={{fontSize:9,color:textS}}>{it._dims || "No dims"}</div>
                        <div style={{fontSize:12,fontWeight:700,color}}>₹{Math.round(it._cost).toLocaleString("en-IN")}</div>
                      </div>
                    );
                  })}
                </div>
              ) : <div style={{padding:"16px",textAlign:"center",color:textS,fontSize:11,borderRadius:8,border:`1px dashed ${border}`}}>No items with this subcategory in inventory. Enter price manually below.</div>}
            </div>
          )}
          <div style={{padding:"12px 14px",borderRadius:10,background:`${color}08`,border:`1px solid ${color}30`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:10,color:textS,fontWeight:600}}>Unit Cost</div>
                <div style={{fontSize:18,fontWeight:800,color:textP}}>₹{Math.round(finalPrice).toLocaleString("en-IN")}</div>
                {refPrice > 0 && !cManualPrice && <div style={{fontSize:9,color:textS,fontStyle:"italic"}}>System reference price</div>}
                {cManualPrice && refPrice > 0 && <div style={{fontSize:9,color:textS}}>System suggested ₹{Math.round(refPrice).toLocaleString("en-IN")}</div>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,color:textS,fontWeight:600}}>Total ({cForm.qty} × ₹{Math.round(finalPrice).toLocaleString("en-IN")})</div>
                <div style={{fontSize:18,fontWeight:800,color}}>₹{Math.round(finalPrice * (Number(cForm.qty)||1)).toLocaleString("en-IN")}</div>
              </div>
            </div>
            {!cShowManual ? (
              <button onClick={() => setCShowManual(true)} style={{marginTop:8,fontSize:9,color:textS,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Adjust price manually</button>
            ) : (
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:textS}}>Manual ₹</span>
                <input type="number" value={cManualPrice} onChange={e => setCManualPrice(e.target.value)} placeholder="Enter price"
                  style={{width:100,padding:"5px 8px",borderRadius:6,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12}} />
                <button onClick={() => { setCManualPrice(""); setCShowManual(false); }} style={{fontSize:9,color:textS,background:"none",border:"none",cursor:"pointer"}}>✕ Clear</button>
              </div>
            )}
          </div>
        </div>
        <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"flex-end",gap:10}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:12,cursor:"pointer"}}>Cancel</button>
          <button onClick={onSave} disabled={!canSave} style={{padding:"8px 20px",borderRadius:8,border:"none",background:canSave?color:"rgba(255,255,255,0.1)",color:canSave?"#fff":textS,fontSize:12,fontWeight:700,cursor:canSave?"pointer":"default",opacity:canSave?1:0.5}}>{editId ? "Update" : `Add ${label} Item`}</button>
        </div>
      </div>
    </div>
  );
}

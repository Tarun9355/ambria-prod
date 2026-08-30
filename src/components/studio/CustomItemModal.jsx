import { useState, useEffect, useMemo } from "react";
import { fetchAll } from "../../lib/supabase";
import { uploadToStorage, STORAGE_FOLDERS } from "../../lib/storage";
import ItemHoverThumb from "../shared/ItemHoverThumb.jsx";
import { itemDimsText } from "../../lib/ims/helpers";

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

// Same origin/base as the page this modal is rendered inside, with the HASH swapped to land on
// IMS's Inventory tab — a plain relative href would resolve against the CURRENT hash route
// instead of replacing it. IMS.jsx's tab initializer reads this `?tab=` query param (added
// specifically for this button) and lets it win over the last-remembered tab, since a deep link
// asking for a SPECIFIC tab is the whole point.
const imsInventoryUrl = () => `${window.location.href.split("#")[0]}#/ims?tab=inventory`;

// §26.13 — Production/Buying Custom Item Modal (proper component for hooks)
export default function CustomItemModal({ config, customItems, setCustomItems, imsInventory: initialInv, isDark, border, textP, textS, onClose, zonePhoto }) {
  const { fnIdx, zoneKey, type, editId } = config;
  const isProduction = type === "production";
  const icon = isProduction ? "🏭" : "🛒";
  const label = isProduction ? "Production" : "Buying";
  const color = isProduction ? "#A855F7" : "#F59E0B";
  const existing = editId ? customItems.find(x => x.id === editId) : null;
  const [cForm, setCForm] = useState(existing || { qty: 1, dims: { l: "", w: "", h: "" }, notes: "", photo: zonePhoto || "" });
  const [cPhotoUploading, setCPhotoUploading] = useState(false);
  const [cManualPrice, setCManualPrice] = useState(existing?.manualPrice || "");
  const [cShowManual, setCShowManual] = useState(!!existing?.manualPrice);
  // Fresh IMS inventory — fetch on mount if initial inventory is empty
  const [liveInv, setLiveInv] = useState(initialInv);
  useEffect(() => {
    if (liveInv && liveInv.length > 0) return;
    // This is a static SPA — there is no /api/data endpoint. IMS inventory lives in the Supabase
    // `inventory` TABLE, so read it directly when no DealCheck cache was passed in. Without this,
    // the search below had nothing to search and always showed "No matches".
    (async () => {
      try {
        const inv = await fetchAll("inventory");
        if (Array.isArray(inv) && inv.length > 0) setLiveInv(inv);
      } catch (e) { console.warn("[custom-item] fresh IMS fetch failed:", e); }
    })();
  }, []);
  const imsInventory = (liveInv && liveInv.length > 0) ? liveInv : initialInv;
  // The matched inventory item behind this custom item — a real search result, not a free-typed
  // category/sub-category (see the redesign note below). Looked up lazily off `initialInv` first
  // (usually already populated from Deal Check's cache) and re-tried once the fresh fetch above
  // lands, for the case an edit opens before that fetch resolves.
  const [cSelectedItem, setCSelectedItem] = useState(() =>
    existing?.refItemId ? (initialInv || []).find(i => i.id === existing.refItemId) || null : null
  );
  useEffect(() => {
    if (cSelectedItem || !existing?.refItemId) return;
    const found = (imsInventory || []).find(i => i.id === existing.refItemId);
    if (found) setCSelectedItem(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imsInventory]);
  // Photo upload to Cloudinary
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setCPhotoUploading(true);
    try {
      const url = await uploadToStorage(file, STORAGE_FOLDERS.PRODUCTION);
      setCForm(f => ({ ...f, photo: url }));
    } catch (err) { console.warn("[custom-item] photo upload failed:", err); }
    finally { setCPhotoUploading(false); }
  };
  // ═══ REDESIGN (this replaces category → sub-category → pick-from-3-suggestions) ═══
  // A salesperson had to know which of IMS's own category/sub-category labels an item lived under
  // before they could even see a suggestion — and if they guessed a vocabulary IMS didn't use, the
  // search silently came back empty. This is the exact same name search Build's own "+ Add
  // element" uses (StudioBuild.jsx): type a few letters of the item's NAME, see live matches, click
  // one. No category to guess first, and every match is a real IMS row — a Production/Buying item
  // now always has a genuine reference (no more free-typed, unmatched category/sub-category with a
  // purely manual price).
  const [cSearch, setCSearch] = useState("");
  const cSearchResults = useMemo(() => {
    const q = cSearch.trim().toLowerCase();
    if (q.length < 1) return [];
    return (imsInventory || [])
      .filter((it) => (it.name || "").toLowerCase().includes(q) || imsField.category(it).toLowerCase().includes(q) || imsField.subcategory(it).toLowerCase().includes(q))
      // A match on the NAME itself ranks above one that only matched via category/sub-category
      // (indexOf is -1 for those — sorting on that raw number directly would put them FIRST,
      // ahead of real name matches, since -1 sorts before any real position).
      .sort((a, b) => {
        const an = (a.name || "").toLowerCase(), bn = (b.name || "").toLowerCase();
        const ai = an.indexOf(q), bi = bn.indexOf(q);
        if (ai === -1 && bi === -1) return an.localeCompare(bn);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
      .slice(0, 8);
  }, [cSearch, imsInventory]);
  const pickItem = (item) => {
    setCSelectedItem(item);
    setCSearch("");
    setCManualPrice(""); setCShowManual(false);
    // Auto-fill from the item — still editable/replaceable right below, this just saves re-typing
    // the common case. Only overwrites a field the item actually HAS data for, so picking an item
    // with no photo doesn't blank out one already uploaded or the zone's default.
    const d = imsField.dims(item) || {};
    const hasDims = (Number(d.l) || 0) > 0 || (Number(d.w) || 0) > 0 || (Number(d.h) || 0) > 0;
    const photo = imsField.photos(item)[0] || "";
    setCForm((f) => ({ ...f, photo: photo || f.photo, dims: hasDims ? { l: d.l || 0, w: d.w || 0, h: d.h || 0 } : f.dims }));
  };
  const refPrice = cSelectedItem ? Number(cSelectedItem.cost) || 0 : 0;
  const finalPrice = cManualPrice ? Number(cManualPrice) : refPrice;
  const canSave = !!cSelectedItem && Number(cForm.qty) > 0 && finalPrice > 0;
  const onSave = () => {
    const item = {
      id: editId || `custom-${Date.now()}`,
      fnIdx, zoneKey, type,
      cat: imsField.category(cSelectedItem), subCat: imsField.subcategory(cSelectedItem), qty: Number(cForm.qty) || 1,
      dims: { l: Number(cForm.dims.l)||0, w: Number(cForm.dims.w)||0, h: Number(cForm.dims.h)||0 },
      refItemId: cSelectedItem.id, refPrice,
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
            <div style={{fontSize:10,color:textS,marginTop:2}}>Zone: {zoneKey} · Search IMS Inventory by name for reference pricing</div>
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
          {/* ═══ ITEM — search by name, same as Build's "+ Add element" ═══ */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontSize:10,color:textS,fontWeight:600}}>Item *</div>
              {/* Opens IMS's own Inventory tab in a new browser tab so a salesperson who doesn't know
                  an item's exact name can look it up there, then come back and search by name here —
                  without losing this modal or the build underneath it. */}
              <a href={imsInventoryUrl()} target="_blank" rel="noreferrer"
                style={{fontSize:9.5,fontWeight:600,color,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:3}}>
                🔗 Open IMS Inventory ↗
              </a>
            </div>
            {cSelectedItem ? (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,border:`1px solid ${color}40`,background:`${color}08`}}>
                <ItemHoverThumb src={imsField.photos(cSelectedItem)[0]} size={44} name={cSelectedItem.name} sub={imsField.subcategory(cSelectedItem) ? `${imsField.subcategory(cSelectedItem)} › ${imsField.category(cSelectedItem)}` : imsField.category(cSelectedItem)} dims={itemDimsText(cSelectedItem)} border={border} cardBg={isDark?"#1A1A2E":"#fff"} textP={textP} textS={textS} emptyBg={isDark?"#1a1a2e":"#eee"} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cSelectedItem.name}</div>
                  <div style={{fontSize:10,color:textS,marginTop:1}}>{imsField.subcategory(cSelectedItem) ? `${imsField.subcategory(cSelectedItem)} › ` : ""}{imsField.category(cSelectedItem)}</div>
                </div>
                <span onClick={() => setCSelectedItem(null)} style={{cursor:"pointer",fontSize:10,fontWeight:600,color:textS,padding:"4px 8px",borderRadius:6,border:`1px solid ${border}`}}>Change</span>
              </div>
            ) : (
              <div style={{position:"relative"}}>
                <input value={cSearch} onChange={e => setCSearch(e.target.value)} placeholder="Search inventory by name..."
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"#1A1A2E":"#fff",color:textP,fontSize:12}} />
                {cSearch.trim().length >= 1 && (
                  cSearchResults.length > 0 ? (
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:isDark?"#1A1A2E":"#fff",border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:340,overflowY:"auto"}}>
                      {cSearchResults.map((it) => (
                        <div key={it.id} onClick={() => pickItem(it)}
                          style={{padding:"8px 10px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                          <ItemHoverThumb src={imsField.photos(it)[0]} size={44} name={it.name} sub={imsField.subcategory(it) ? `${imsField.subcategory(it)} › ${imsField.category(it)}` : imsField.category(it)} dims={itemDimsText(it)} border={border} cardBg={isDark?"#1A1A2E":"#fff"} textP={textP} textS={textS} emptyBg={isDark?"#1a1a2e":"#eee"} />
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:500,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                            <div style={{fontSize:11,color:textS,marginTop:2}}>{imsField.subcategory(it) ? `${imsField.subcategory(it)} › ` : ""}{imsField.category(it)}{itemDimsText(it) ? ` · ${itemDimsText(it)}` : ""} · ₹{Math.round(Number(it.cost) || 0).toLocaleString("en-IN")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:isDark?"#1A1A2E":"#fff",border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:11.5,color:textS}}>No matches — check the spelling, or open IMS Inventory above to look it up.</div>
                  )
                )}
              </div>
            )}
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

import { useState, useEffect, useMemo } from "react";
import { SPACES, TAX_LABELS, DEFAULT_TAX_KEYS, taxOr, ZONE_META } from "../../../lib/studio/taxonomy";
import { DEFAULT_FILTER_PRIORITY } from "../../../lib/studio/keys";
import { INV_CATS } from "../../../lib/inventory/constants";
import { fetchCachedContracts, fetchSeason } from "../../../lib/ims/lms";

// getTaxLabel — module-scope helper in the reference (App_latest.jsx:1267). Local here.
const getTaxLabel = (k) => TAX_LABELS[k] || k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\s+/g, " ").replace(/^./, s => s.toUpperCase()).trim();

// Studio → Manage → Settings — faithful rebuild of AmbriStudioInner.ManageSettings
// (App_latest.jsx:12539–12878), incl. AdminVenues (7990–8251), the §26 Calendar
// demand/supply overlay (12712–12856), the Client tracker (12652–12710), and the
// Tag/taxonomy editor (AdminTags, 11598–11681). settingsView routes the sub-views.
export default function ManageSettings({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS, textP, accentText, cardBg, fmt,
    // taxonomy
    taxonomy, saveTax, taxEditCat, setTaxEditCat, taxNewTag, setTaxNewTag, taxNewCat, setTaxNewCat,
    addTagWithAreaZoneSync, showMsg,
    // settings routing
    settingsView, setSettingsView,
    // auth
    authUser, isAdmin, hasPerm, studioSettingsAllowed,
    // venues
    customInhouse, customOutdoor, saveVenues,
    newIH, setNewIH, newOD, setNewOD, adminOdSearch, setAdminOdSearch, editIH, setEditIH, editOD, setEditOD,
    allInhouseVenues, allOutdoorDB, allInhouseGroups, allVenueData,
    // clients
    clientLedger, ctFilterSp, setCtFilterSp, ctFilterStatus, setCtFilterStatus,
    ctFilterFrom, setCtFilterFrom, ctFilterTo, setCtFilterTo, ctExpandedId, setCtExpandedId,
    clientSearch, setClientSearch,
    // calendar
    calYear, setCalYear, calMonth, setCalMonth, calSelDate, setCalSelDate,
    calLmsData, setCalLmsData, calView, setCalView, calSeasonData, setCalSeasonData,
    // palettes
    imsColourCatalogue, setImsColourCatalogue, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData,
    // department income mapping
    catDeptMap, saveCatDeptMap, rcCats,
    // zones
    zoneDefs, setZoneDefs, saveZD, zoneLabelsD, addZoneWithAreaSync,
    // photo priority — saveFilterPriority is the reference handler; fall back to
    // setFilterPriority (the name present in StudioApp's ctx literal) if absent.
    filterPriority, setFilterPriority, saveFilterPriority: ctxSaveFilterPriority,
    // sub-views rendered as functions on the parent (AdminUsers not in ctx — guarded)
    AdminUsers,
  } = ctx;

  const saveFilterPriority = ctxSaveFilterPriority || setFilterPriority;

  // ═══ §26 CALENDAR DEMAND OVERLAY — source LMS contracts + season from Supabase ═══
  // Faithful behavior: booked contracts (lms_contracts cache) + season categories.
  // Re-fetches every time calendar tab opens; auto-refreshes every 2 min.
  useEffect(() => {
    if (settingsView !== "calendar" || !authUser) return;
    let alive = true;
    const fetchCalData = () => {
      fetchCachedContracts().then(({ contracts }) => {
        if (!alive) return;
        const byDate = {};
        for (const c of (contracts || [])) {
          const source = c.dept === "venue" ? "venueContract" : "decorContract";
          for (const fn of (c.functions || [])) {
            const date = String(fn.functionDate || "").slice(0, 10);
            if (!date) continue;
            (byDate[date] = byDate[date] || []).push({
              guestName: c.guestName || "—",
              source,
              fnLabel: fn.functionType || "",
              venueLabel: fn.internalVenueName || fn.venueName || fn.externalVenue || "",
              shift: fn.session || "",
              priority: c.priority || "",
              status: c.lmsStatus || "",
              entryNo: c.entryNo,
              phone: c.contactNo || "",
            });
          }
        }
        setCalLmsData({ byDate, complete: true });
      }).catch(() => {});
      fetchSeason().then(d => { if (alive && d?.dates) setCalSeasonData(d); }).catch(() => {});
    };
    fetchCalData();
    const interval = setInterval(fetchCalData, 2 * 60 * 1000);
    return () => { alive = false; clearInterval(interval); };
  }, [settingsView, authUser]);
  // ═══ end §26 calendar demand fetch ═══

  // ═══ §26 DEMAND-BASED AUTO-ADJUSTMENT — promotes/demotes season categories by function count ═══
  // adjustedSeasonMap is a component-scope useMemo in the reference (App_latest.jsx:3370).
  const adjustedSeasonMap = useMemo(() => {
    const seasonDates = calSeasonData?.dates || {};
    const seasonDefault = calSeasonData?.default_category || "Filler";
    const yr = new Date().getFullYear();
    // Start with raw season categories expanded to YYYY-MM-DD
    const base = {};
    Object.entries(seasonDates).forEach(([mmdd, cat]) => {
      base[`${yr}-${mmdd}`] = cat;
      base[`${yr + 1}-${mmdd}`] = cat;
    });
    // Count ALL functions per date (leads + contracts) for demand signal
    const fnCount = {};
    if (calLmsData?.byDate) {
      Object.entries(calLmsData.byDate).forEach(([d, arr]) => { fnCount[d] = (arr || []).length; });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneMonth = new Date(today); oneMonth.setMonth(today.getMonth() + 1);
    const twoMonths = new Date(today); twoMonths.setMonth(today.getMonth() + 2);
    // Collect all dates to evaluate (season dates + dates with LMS data)
    const allDates = new Set([...Object.keys(base), ...Object.keys(fnCount)]);
    const result = {};
    allDates.forEach(date => {
      const count = fnCount[date] || 0;
      const current = base[date] || seasonDefault;
      const d = new Date(date + "T00:00:00");
      if (d < today) { if (current !== seasonDefault) result[date] = current; return; } // past = keep original
      // Rule 1: ≥6 functions → King's (highest priority)
      if (count >= 6) { result[date] = "King's"; return; }
      // Rule 3: within 1 month + <5 functions → Normal (stricter time wins over Rule 2)
      if (d <= oneMonth && count < 5) { result[date] = "Normal"; return; }
      // Rule 2: King's + within 2 months + <5 functions → Perfect
      if (current === "King's" && d <= twoMonths && count < 5) { result[date] = "Perfect"; return; }
      // No adjustment — keep original (only store non-default)
      if (current !== seasonDefault) result[date] = current;
    });
    return result;
  }, [calSeasonData, calLmsData]);
  // ═══ end §26 auto-adjustment ═══

  const movePriority = (idx, dir) => {
    const np = [...filterPriority];
    const swap = idx + dir;
    if(swap < 0 || swap >= np.length) return;
    [np[idx], np[swap]] = [np[swap], np[idx]];
    saveFilterPriority(np);
  };

  // Reorder a zone — rebuilds zoneDefs.meta in the new key order. Build reads Object.keys(zoneMeta),
  // so this directly sets the zone display sequence on the Build page. Persists to Redis.
  const moveZone = (idx, dir) => {
    const keys = Object.keys(zoneDefs.meta || {});
    const swap = idx + dir;
    if (swap < 0 || swap >= keys.length) return;
    [keys[idx], keys[swap]] = [keys[swap], keys[idx]];
    const newMeta = {};
    keys.forEach((k) => { newMeta[k] = zoneDefs.meta[k]; });
    saveZD({ ...zoneDefs, meta: newMeta });
  };

  // ═══ ADMIN VENUES (settingsView "venues") — App_latest.jsx:7990 ═══
  const AdminVenues = () => {

    const addInhouse = () => {
      if(!newIH.name.trim()){showMsg("Venue name required","red");return;}
      if(allInhouseVenues.includes(newIH.name.trim())){showMsg("Venue already exists","red");return;}
      const parent = (newIH.parent||"").trim();
      if(!parent){showMsg("Parent property is required — pick one or create new","red");return;}
      const venue = {...newIH, name:newIH.name.trim(), base:parseInt(newIH.base)||0, parent};
      saveVenues([...customInhouse, venue], customOutdoor);
      setNewIH({name:"",label:"",type:"Outdoor",base:"",parent:"",newParentMode:false});
    };

    const addOutdoor = () => {
      if(!newOD.name.trim()) return;
      if(allOutdoorDB.some(v=>v.name===newOD.name.trim())){showMsg("Venue already exists","red");return;}
      saveVenues(customInhouse, [...customOutdoor, {name:newOD.name.trim(),empanelled:newOD.empanelled}]);
      setNewOD({name:"",empanelled:true});
    };

    const removeInhouse = (name) => saveVenues(customInhouse.filter(v=>v.name!==name), customOutdoor);
    const removeOutdoor = (name) => saveVenues(customInhouse, customOutdoor.filter(v=>v.name!==name));

    const updateInhouse = () => {
      if(!editIH) return;
      const newName = (editIH.name||"").trim();
      if(!newName){showMsg("Venue name required","red");return;}
      const parent = (editIH.parent||"").trim();
      if(!parent){showMsg("Parent property is required","red");return;}
      // Name must be unique (unless unchanged)
      if(newName!==editIH.origName && customInhouse.some(v=>v.name===newName)){
        showMsg("Venue name already exists","red"); return;
      }
      const updated = customInhouse.map(v => v.name===editIH.origName ? {
        ...v,
        name: newName,
        label: editIH.label||"",
        type: editIH.type||"Outdoor",
        base: parseInt(editIH.base)||0,
        parent,
      } : v);
      saveVenues(updated, customOutdoor);
      setEditIH(null);
      if(newName!==editIH.origName) showMsg("✓ Venue renamed. Past events keep their original venue name for audit.", "green");
    };

    const updateOutdoor = () => {
      if(!editOD) return;
      const newName = (editOD.name||"").trim();
      if(!newName){showMsg("Venue name required","red");return;}
      if(newName!==editOD.origName && customOutdoor.some(v=>v.name===newName)){
        showMsg("Venue name already exists","red"); return;
      }
      const updated = customOutdoor.map(v => v.name===editOD.origName ? {
        ...v, name: newName, empanelled: !!editOD.empanelled,
      } : v);
      saveVenues(customInhouse, updated);
      setEditOD(null);
    };

    return (
      <div>
        <div style={{fontSize:20,fontWeight:700,color:accent,marginBottom:20}}>Venue Management</div>

        {/* ═══ IN-HOUSE VENUES ═══ */}
        <div style={{...S.card,marginBottom:20}}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`}}>
            <div style={{fontSize:16,fontWeight:600,color:accent}}>🏛️ In-house Venues</div>
            <div style={{fontSize:11,color:textS,marginTop:2}}>Fixed venues under Ambria properties</div>
          </div>
          <div style={{padding:20}}>
            {/* Existing venues grouped by parent */}
            {allInhouseGroups.map(g=>(
              <div key={g.parent} style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{g.icon} {g.parent} <span style={{fontWeight:400,color:textS,fontSize:11}}>({g.manager})</span></div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {g.subVenues.map(sv=>{
                    const vd = allVenueData[sv];
                    const venueObj = customInhouse.find(c=>c.name===sv);
                    const isEditing = editIH && editIH.origName===sv;
                    if (isEditing) {
                      return (
                      <div key={sv+"-edit"} style={{padding:"12px 14px",borderRadius:10,background:isDark?"rgba(201,169,110,0.08)":"#FFFBEA",border:`1px solid ${accent}60`,width:"100%",boxSizing:"border-box"}}>
                        <div style={{fontSize:11,color:accent,fontWeight:600,marginBottom:8}}>✏️ Editing: {editIH.origName}</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                          <div><div style={S.label}>Venue Name *</div><input value={editIH.name} onChange={e=>setEditIH(p=>({...p,name:e.target.value}))} style={S.input}/></div>
                          <div>
                            <div style={S.label}>Parent Property *</div>
                            {!editIH.newParentMode ? (
                              <select value={editIH.parent} onChange={e=>{const v=e.target.value;if(v==="__new__"){setEditIH(p=>({...p,parent:"",newParentMode:true}));}else setEditIH(p=>({...p,parent:v}));}} style={{...S.select,width:"100%"}}>
                                <option value="">— Select property —</option>
                                {allInhouseGroups.map(gg=><option key={gg.parent} value={gg.parent}>{gg.parent}</option>)}
                                <option value="__new__">+ Create new property…</option>
                              </select>
                            ) : (
                              <div style={{display:"flex",gap:6}}>
                                <input autoFocus value={editIH.parent} onChange={e=>setEditIH(p=>({...p,parent:e.target.value}))} placeholder="New property name…" style={{...S.input,flex:1}}/>
                                <button onClick={()=>setEditIH(p=>({...p,parent:"",newParentMode:false}))} style={{padding:"0 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer"}} title="Pick existing">↩</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                          <div><div style={S.label}>Label</div><input value={editIH.label} onChange={e=>setEditIH(p=>({...p,label:e.target.value}))} style={S.input}/></div>
                          <div><div style={S.label}>Type</div><select value={editIH.type} onChange={e=>setEditIH(p=>({...p,type:e.target.value}))} style={{...S.select,width:"100%"}}>{taxOr(taxonomy.venueType, SPACES).map(s=><option key={s}>{s}</option>)}</select></div>
                          <div><div style={S.label}>Base Price ₹</div><input type="number" value={editIH.base} onChange={e=>setEditIH(p=>({...p,base:e.target.value}))} style={S.input}/></div>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={updateInhouse} style={S.btn(true)}>{"💾"} Save</button>
                          <button onClick={()=>setEditIH(null)} style={{...S.btn(false),color:textS}}>Cancel</button>
                        </div>
                      </div>);
                    }
                    return (
                    <div key={sv} style={{padding:"10px 14px",borderRadius:10,background:isDark?"rgba(255,255,255,0.04)":"#F9FAFB",border:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600}}>{sv}</div>
                        <div style={{fontSize:10,color:textS}}>{vd?.label||""} · {vd?.type||""} · Base {fmt(vd?.base||0)}</div>
                      </div>
                      <button onClick={()=>setEditIH({origName:sv,name:sv,label:venueObj?.label||"",type:venueObj?.type||"Outdoor",base:String(venueObj?.base||0),parent:venueObj?.parent||"",newParentMode:false})} style={{fontSize:11,color:accent,background:"none",border:"none",cursor:"pointer"}} title="Edit">✏️</button>
                      <button onClick={()=>{if(confirm(`Delete venue "${sv}"? This cannot be undone. Past events keep their original venue name.`))removeInhouse(sv);}} style={{fontSize:10,color:"#F87171",background:"none",border:"none",cursor:"pointer"}} title="Delete">✕</button>
                    </div>);
                  })}
                </div>
              </div>
            ))}

            {/* Add new in-house venue */}
            <div style={{marginTop:20,padding:16,background:isDark?"rgba(201,169,110,0.04)":"#FFFDF7",borderRadius:12,border:`1px dashed ${accent}40`}}>
              <div style={{fontSize:13,fontWeight:600,color:accent,marginBottom:12}}>+ Add In-house Venue</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <div style={S.label}>Venue Name *</div>
                  <input value={newIH.name} onChange={e=>setNewIH(p=>({...p,name:e.target.value}))} placeholder="e.g. Banquet Hall" style={S.input}/>
                </div>
                <div>
                  <div style={S.label}>Parent Property *</div>
                  {!newIH.newParentMode ? (
                    <select value={newIH.parent} onChange={e=>{
                      const v=e.target.value;
                      if(v==="__new__"){setNewIH(p=>({...p,parent:"",newParentMode:true}));}
                      else setNewIH(p=>({...p,parent:v}));
                    }} style={{...S.select,width:"100%"}}>
                      <option value="">— Select property —</option>
                      {allInhouseGroups.map(g=><option key={g.parent} value={g.parent}>{g.parent}</option>)}
                      <option value="__new__">+ Create new property…</option>
                    </select>
                  ) : (
                    <div style={{display:"flex",gap:6}}>
                      <input autoFocus value={newIH.parent} onChange={e=>setNewIH(p=>({...p,parent:e.target.value}))} placeholder="e.g. Sohna Farm, New Property…" style={{...S.input,flex:1}}/>
                      <button onClick={()=>setNewIH(p=>({...p,parent:"",newParentMode:false}))} style={{padding:"0 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:11,cursor:"pointer"}} title="Pick existing property instead">↩</button>
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <div style={S.label}>Label</div>
                  <input value={newIH.label} onChange={e=>setNewIH(p=>({...p,label:e.target.value}))} placeholder="e.g. Premium Banquet" style={S.input}/>
                </div>
                <div>
                  <div style={S.label}>Type</div>
                  <select value={newIH.type} onChange={e=>setNewIH(p=>({...p,type:e.target.value}))} style={{...S.select,width:"100%"}}>
                    {taxOr(taxonomy.venueType, SPACES).map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={S.label}>Base Price ₹</div>
                  <input type="number" value={newIH.base} onChange={e=>setNewIH(p=>({...p,base:e.target.value}))} placeholder="80000" style={S.input}/>
                </div>
              </div>
              <button onClick={addInhouse} style={S.btn(true)}>+ Add Venue</button>
            </div>
          </div>
        </div>

        {/* ═══ OUTDOOR VENUES ═══ */}
        <div style={S.card}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`}}>
            <div style={{fontSize:16,fontWeight:600,color:accent}}>🌿 Outdoor Venues</div>
            <div style={{fontSize:11,color:textS,marginTop:2}}>Empanelled partners + venues we've worked at</div>
          </div>
          <div style={{padding:20}}>
            {/* Empanelled */}
            <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>⭐ Empanelled</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {allOutdoorDB.filter(v=>v.empanelled).map(v=>{
                const isEditing = editOD && editOD.origName===v.name;
                if (isEditing) {
                  return (
                  <div key={v.name+"-edit"} style={{padding:"10px 14px",borderRadius:8,background:isDark?"rgba(201,169,110,0.08)":"#FFFBEA",border:`1px solid ${accent}60`,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <input value={editOD.name} onChange={e=>setEditOD(p=>({...p,name:e.target.value}))} style={{...S.input,maxWidth:180,padding:"5px 10px",fontSize:12}}/>
                    <div style={{display:"flex",gap:4}}>
                      {[true,false].map(emp=>(<button key={String(emp)} onClick={()=>setEditOD(p=>({...p,empanelled:emp}))} style={{padding:"5px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:editOD.empanelled===emp?600:400,background:editOD.empanelled===emp?accent:isDark?"rgba(255,255,255,0.04)":"#F3F4F6",color:editOD.empanelled===emp?"#0F0F1A":textS}}>{emp?"⭐":"🏢"}</button>))}
                    </div>
                    <button onClick={updateOutdoor} style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:"none",background:accent,color:"#0F0F1A",cursor:"pointer"}}>💾 Save</button>
                    <button onClick={()=>setEditOD(null)} style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,cursor:"pointer"}}>Cancel</button>
                  </div>);
                }
                return (
                <div key={v.name} style={{padding:"8px 14px",borderRadius:8,background:isDark?"rgba(255,255,255,0.04)":"#F9FAFB",border:`1px solid ${border}`,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13}}>{v.name}</span>
                  <button onClick={()=>setEditOD({origName:v.name,name:v.name,empanelled:!!v.empanelled})} style={{fontSize:11,color:accent,background:"none",border:"none",cursor:"pointer"}} title="Edit">✏️</button>
                  <button onClick={()=>{if(confirm(`Delete venue "${v.name}"?`))removeOutdoor(v.name);}} style={{fontSize:10,color:"#F87171",background:"none",border:"none",cursor:"pointer"}} title="Delete">✕</button>
                </div>);
              })}
            </div>

            {/* Others — compact searchable */}
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🏢 Other Venues <span style={{fontWeight:400,color:textS,fontSize:11}}>({allOutdoorDB.filter(v=>!v.empanelled).length})</span></div>
            <input value={adminOdSearch} onChange={e=>setAdminOdSearch(e.target.value)} placeholder="Search other venues..." style={{...S.input,maxWidth:300,marginBottom:8}}/>
            <div style={{maxHeight:200,overflowY:"auto",marginBottom:20,border:`1px solid ${border}`,borderRadius:10}}>
              {(adminOdSearch.trim() ? allOutdoorDB.filter(v=>!v.empanelled && v.name.toLowerCase().includes(adminOdSearch.toLowerCase())) : allOutdoorDB.filter(v=>!v.empanelled)).map(v=>{
                const isEditing = editOD && editOD.origName===v.name;
                if (isEditing) {
                  return (
                  <div key={v.name+"-edit"} style={{padding:"8px 14px",borderBottom:`1px solid ${border}`,background:isDark?"rgba(201,169,110,0.06)":"#FFFBEA",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <input value={editOD.name} onChange={e=>setEditOD(p=>({...p,name:e.target.value}))} style={{...S.input,maxWidth:200,padding:"5px 10px",fontSize:12,flex:1}}/>
                    <div style={{display:"flex",gap:4}}>
                      {[true,false].map(emp=>(<button key={String(emp)} onClick={()=>setEditOD(p=>({...p,empanelled:emp}))} style={{padding:"4px 9px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:editOD.empanelled===emp?600:400,background:editOD.empanelled===emp?accent:isDark?"rgba(255,255,255,0.04)":"#F3F4F6",color:editOD.empanelled===emp?"#0F0F1A":textS}}>{emp?"⭐":"🏢"}</button>))}
                    </div>
                    <button onClick={updateOutdoor} style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:"none",background:accent,color:"#0F0F1A",cursor:"pointer"}}>💾</button>
                    <button onClick={()=>setEditOD(null)} style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,cursor:"pointer"}}>Cancel</button>
                  </div>);
                }
                return (
                <div key={v.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:`1px solid ${border}`}}>
                  <span style={{fontSize:12}}>{v.name}</span>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>setEditOD({origName:v.name,name:v.name,empanelled:!!v.empanelled})} style={{fontSize:11,color:accent,background:"none",border:"none",cursor:"pointer",padding:"2px 6px"}} title="Edit">✏️ Edit</button>
                    <button onClick={()=>{if(confirm(`Delete venue "${v.name}"?`))removeOutdoor(v.name);}} style={{fontSize:10,color:"#F87171",background:"none",border:"none",cursor:"pointer",padding:"2px 6px"}}>✕ Remove</button>
                  </div>
                </div>);
              })}
              {adminOdSearch.trim()&&allOutdoorDB.filter(v=>!v.empanelled && v.name.toLowerCase().includes(adminOdSearch.toLowerCase())).length===0&&<div style={{padding:"12px 14px",fontSize:11,color:textS}}>No match — add it below</div>}
            </div>

            {/* Add new outdoor venue */}
            <div style={{padding:16,background:isDark?"rgba(201,169,110,0.04)":"#FFFDF7",borderRadius:12,border:`1px dashed ${accent}40`}}>
              <div style={{fontSize:13,fontWeight:600,color:accent,marginBottom:12}}>+ Add Outdoor Venue</div>
              <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
                <div style={{flex:1}}>
                  <div style={S.label}>Venue Name *</div>
                  <input value={newOD.name} onChange={e=>setNewOD(p=>({...p,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addOutdoor()} placeholder="e.g. The Leela Palace" style={S.input}/>
                </div>
                <div>
                  <div style={S.label}>Type</div>
                  <div style={{display:"flex",gap:4}}>
                    {[true,false].map(emp=>(
                      <button key={String(emp)} onClick={()=>setNewOD(p=>({...p,empanelled:emp}))} style={{padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:newOD.empanelled===emp?600:400,background:newOD.empanelled===emp?accent:isDark?"rgba(255,255,255,0.04)":"#F3F4F6",color:newOD.empanelled===emp?"#0F0F1A":textS}}>
                        {emp?"⭐ Empanelled":"🏢 Other"}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={addOutdoor} style={S.btn(true)}>+ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ═══ ADMIN TAGS (settingsView "tags") — App_latest.jsx:11598 ═══
  const AdminTags = () => (
    <div style={{ maxWidth: 600 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: textP, marginBottom: 4 }}>Tag taxonomy manager</div>
      <div style={{ fontSize: 12, color: textS, marginBottom: 16 }}>Add, rename, or remove tag options. Changes apply to all new and existing images.</div>

      {/* ═══ TAG CATEGORIES (existing taxonomy) ═══ */}
      {Object.keys(taxonomy).filter(k => k !== "categoryTier").map(k => (
        <div key={k} style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: textP }}>{getTaxLabel(k)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 11, color: textS }}>{taxonomy[k].length} tags</div>
              {!DEFAULT_TAX_KEYS.has(k) && <span onClick={() => {
                if (confirm(`Delete category "${getTaxLabel(k)}" and all its tags?`)) {
                  const next = { ...taxonomy };
                  delete next[k];
                  saveTax(next);
                }
              }} style={{ cursor: "pointer", color: "#E11D48", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(225,29,72,0.3)" }}>{"🗑"} Delete</span>}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {taxonomy[k].map(v => (
              <span key={v} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 8, border: `1px solid ${border}`, color: textS, display: "flex", alignItems: "center", gap: 4 }}>
                {v}
                <span onClick={() => {
                  const next = { ...taxonomy, [k]: taxonomy[k].filter(x => x !== v) };
                  saveTax(next);
                }} style={{ cursor: "pointer", color: "#E11D48", fontSize: 10, fontWeight: 700 }}>×</span>
              </span>
            ))}
            {taxEditCat === k ? (
              <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                <input value={taxNewTag} onChange={e => setTaxNewTag(e.target.value)} placeholder="New tag..." style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 100 }} autoFocus onKeyDown={e => {
                  if (e.key === "Enter" && taxNewTag.trim()) {
                    addTagWithAreaZoneSync(k, taxNewTag.trim());
                    setTaxNewTag(""); setTaxEditCat(null);
                  }
                  if (e.key === "Escape") { setTaxNewTag(""); setTaxEditCat(null); }
                }} />
                <span onClick={() => {
                  if (taxNewTag.trim()) {
                    addTagWithAreaZoneSync(k, taxNewTag.trim());
                  }
                  setTaxNewTag(""); setTaxEditCat(null);
                }} style={{ cursor: "pointer", fontSize: 12, color: accent }}>✓</span>
              </span>
            ) : (
              <span onClick={() => { setTaxEditCat(k); setTaxNewTag(""); }} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 8, border: `1px dashed ${border}`, color: textS, cursor: "pointer" }}>+ add</span>
            )}
          </div>
        </div>
      ))}
      {/* ═══ ADD NEW CATEGORY ═══ */}
      <div style={{ background: cardBg, borderRadius: 12, border: `2px dashed ${border}`, padding: "14px 16px", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: textP, marginBottom: 8 }}>{"➕"} Add new category</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={taxNewCat} onChange={e => setTaxNewCat(e.target.value)} placeholder="e.g. Fabric Type, Flower Variety..." style={{ ...S.input, flex: 1, fontSize: 12, marginBottom: 0 }} onKeyDown={e => {
            if (e.key === "Enter" && taxNewCat.trim()) {
              const key = taxNewCat.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
              if (!key) { showMsg("Invalid category name", "red"); return; }
              if (taxonomy[key]) { showMsg("Category already exists", "red"); return; }
              saveTax({ ...taxonomy, [key]: [] });
              TAX_LABELS[key] = taxNewCat.trim();
              setTaxNewCat("");
              showMsg("✓ Category added — now add tags inside it", "green");
            }
          }} />
          <button onClick={() => {
            if (!taxNewCat.trim()) return;
            const key = taxNewCat.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            if (!key) { showMsg("Invalid category name", "red"); return; }
            if (taxonomy[key]) { showMsg("Category already exists", "red"); return; }
            saveTax({ ...taxonomy, [key]: [] });
            TAX_LABELS[key] = taxNewCat.trim();
            setTaxNewCat("");
            showMsg("✓ Category added — now add tags inside it", "green");
          }} style={{ ...S.btn(true), padding: "8px 18px", fontSize: 12, whiteSpace: "nowrap" }}>Add Category</button>
        </div>
        <div style={{ fontSize: 10, color: textS, marginTop: 6 }}>Custom categories can be deleted. Default categories (Event type, Venue type, etc.) cannot.</div>
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: textS }}>💡 Tip: Removing a tag here won't automatically remove it from already-tagged images. Use the Library browser to update individual images.</div>
    </div>
  );

  // If the active settings view isn't permitted for this role, jump to the first allowed one.
  useEffect(() => {
    if (!studioSettingsAllowed) return;
    if (studioSettingsAllowed(settingsView)) return;
    const first = ["clients", "calendar", "venues", "zones", "tags", "priority"].find((v) => studioSettingsAllowed(v));
    if (first && first !== settingsView) setSettingsView(first);
  }, [settingsView, studioSettingsAllowed, setSettingsView]);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {(() => {
          const allow = (v) => (studioSettingsAllowed ? studioSettingsAllowed(v) : true);
          const VIEWS = [["clients", "📋 Clients"], ["calendar", "📅 Calendar"], ["venues", "🏛️ Venues"], ["zones", "📐 Zones"], ["tags", "🏷️ Tags"], ["priority", "📊 Photo Priority"], ["departments", "🏦 Departments"]];
          return VIEWS.filter(([v]) => allow(v)).map(([v, label]) => (
            <button key={v} onClick={() => setSettingsView(v)} style={{ ...S.btn(settingsView === v), fontSize: 11 }}>{label}</button>
          ));
        })()}
      </div>
      {settingsView === "zones" && <div style={{maxWidth:800}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontSize:16,fontWeight:700,color:accent}}>📐 Zone Types</div><div style={{fontSize:11,color:textS,marginTop:2}}>Define zone types used across Build, Templates, and Library. Use the ↑ ↓ arrows to set the order zones appear on the Build page. Changes sync to all devices via Redis.</div></div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{const label=prompt("Enter zone name (e.g. 'Stage', 'Photobooth'):");if(label&&label.trim())addZoneWithAreaSync(label);}} style={{...S.btn(true),fontSize:11,padding:"8px 14px"}}>+ Add Zone</button>
            <button onClick={()=>{if(!confirm("Reset all zones to factory defaults?"))return;const nd={elements:{},meta:JSON.parse(JSON.stringify(ZONE_META))};saveZD(nd);}} style={{...S.btn(false),fontSize:11,padding:"8px 14px"}}>↻ Reset</button>
          </div>
        </div>
        {Object.entries(zoneDefs.meta).map(([zk,zm],zIdx)=>{const lbl=zoneLabelsD[zk];const zTotal=Object.keys(zoneDefs.meta).length;return(
          <div key={zk} style={{...S.card,padding:"16px 18px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                  <button onClick={()=>moveZone(zIdx,-1)} disabled={zIdx===0} style={{width:24,height:20,borderRadius:5,border:`1px solid ${border}`,background:"transparent",cursor:zIdx===0?"default":"pointer",opacity:zIdx===0?0.3:1,fontSize:11,color:textP,lineHeight:1,padding:0}}>↑</button>
                  <span style={{fontSize:10,fontWeight:700,color:accent}}>{zIdx+1}</span>
                  <button onClick={()=>moveZone(zIdx,1)} disabled={zIdx===zTotal-1} style={{width:24,height:20,borderRadius:5,border:`1px solid ${border}`,background:"transparent",cursor:zIdx===zTotal-1?"default":"pointer",opacity:zIdx===zTotal-1?0.3:1,fontSize:11,color:textP,lineHeight:1,padding:0}}>↓</button>
                </div>
                <input defaultValue={zm.icon||lbl?.icon||"📦"} onBlur={e=>{const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,icon:e.target.value}}};setZoneDefs(nd);}} key={zk+"-icon"} style={{width:34,padding:"4px 2px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textP,fontSize:18,textAlign:"center",outline:"none",fontFamily:"inherit"}} maxLength={2}/>
                <div>
                  <input defaultValue={zm.label} onBlur={e=>{const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,label:e.target.value}}};setZoneDefs(nd);}} key={zk+"-label"} style={{fontSize:14,fontWeight:700,color:textP,background:"transparent",border:"none",borderBottom:`1px solid ${border}`,outline:"none",fontFamily:"inherit",padding:"2px 0",width:200}}/>
                  <div style={{fontSize:9,color:textS,marginTop:2}}>ID: {zk}</div>
                </div>
              </div>
              <button onClick={()=>{if(!confirm("Delete zone '"+zm.label+"'? Items assigned to this zone will lose their assignment."))return;const nm={...zoneDefs.meta};delete nm[zk];const nd={...zoneDefs,meta:nm};saveZD(nd);}} style={{padding:"4px 8px",borderRadius:6,border:"none",background:"rgba(248,113,113,0.1)",color:"#F87171",fontSize:10,cursor:"pointer"}}>🗑️ Delete</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:textS,marginBottom:4}}>Default Truss</div>
                <select value={zm.defaultTruss||""} onChange={e=>{const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,defaultTruss:e.target.value||null}}};setZoneDefs(nd);}} style={S.select}>
                  <option value="">None</option>
                  <option value="box">Box Truss</option>
                  <option value="singleU">Single U Truss</option>
                </select>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:textS,marginBottom:4}}>Dimensions</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{(zm.dimFields||[]).map((d,i)=><span key={i} style={{padding:"3px 8px",borderRadius:4,background:accent+"15",color:accent,fontSize:11,fontWeight:600}}>{d}</span>)}<select onChange={e=>{if(!e.target.value)return;const v=e.target.value;if(!(zm.dimFields||[]).includes(v)){const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,dimFields:[...(zm.dimFields||[]),v]}}};setZoneDefs(nd);}e.target.value="";}} style={{...S.select,width:50,padding:"2px 4px",fontSize:10}}><option value="">+</option>{["L","W","H","S"].filter(d=>!(zm.dimFields||[]).includes(d)).map(d=><option key={d} value={d}>{d}</option>)}</select></div>
                {(zm.dimFields||[]).length>0&&<div style={{display:"flex",gap:2,marginTop:4}}>{(zm.dimFields||[]).map((d,i)=><button key={i} onClick={()=>{const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,dimFields:(zm.dimFields||[]).filter((_,j)=>j!==i)}}};setZoneDefs(nd);}} style={{padding:"1px 5px",borderRadius:3,border:"none",background:"rgba(248,113,113,0.1)",color:"#F87171",fontSize:9,cursor:"pointer"}}>✕{d}</button>)}</div>}
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:textS,marginBottom:4}}>Features</div>
                {[["hasPlatform","Platform"],["hasCarpet","Carpet"],["hasMasking","Masking"]].map(([f,l])=><div key={f} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <div onClick={()=>{const nd={...zoneDefs,meta:{...zoneDefs.meta,[zk]:{...zm,[f]:!zm[f]}}};setZoneDefs(nd);}} style={{width:32,height:18,borderRadius:9,background:zm[f]?"#059669":"#374151",position:"relative",cursor:"pointer"}}><div style={{width:14,height:14,borderRadius:7,background:"#fff",position:"absolute",top:2,left:zm[f]?16:2,transition:"left 0.2s"}}/></div>
                  <span style={{fontSize:11,color:zm[f]?textP:textS}}>{l}</span>
                </div>)}
              </div>
            </div>
          </div>
        );})}
        <button onClick={()=>saveZD(zoneDefs)} style={{...S.btn(true),padding:"10px 24px",fontSize:12,marginTop:8}}>💾 Save Zones to Redis</button>
      </div>}
      {/* ═══ CLIENT TRACKER ═══ */}
      {settingsView === "clients" && (() => {
        const allSalespeople = [...new Set(clientLedger.map(c => c.createdBy || "—").filter(Boolean))];
        const canSeeAll = isAdmin || hasPerm("canManageTeam");
        const searchLc = clientSearch.toLowerCase().trim();
        const filtered = clientLedger.filter(c => {
          if (!canSeeAll && c.createdBy !== authUser?.name) return false;
          if (ctFilterSp && c.createdBy !== ctFilterSp) return false;
          if (ctFilterStatus !== "all" && c.status !== ctFilterStatus) return false;
          if (ctFilterFrom && c.eventDate && c.eventDate < ctFilterFrom) return false;
          if (ctFilterTo && c.eventDate && c.eventDate > ctFilterTo) return false;
          if (searchLc && !(c.name||"").toLowerCase().includes(searchLc) && !(c.phone||"").includes(searchLc)) return false;
          return true;
        }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return <div style={{maxWidth:1100}}>
          <div style={{fontSize:16,fontWeight:700,color:accent,marginBottom:4}}>📋 Client Tracker</div>
          <div style={{fontSize:11,color:textS,marginBottom:14}}>All clients from guest details form. {clientLedger.length} total{filtered.length!==clientLedger.length?` · ${filtered.length} shown`:""}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
            <input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="🔍 Search name or phone" style={{...S.select,fontSize:11,padding:"6px 10px",width:180}}/>
            {canSeeAll&&<select value={ctFilterSp} onChange={e=>{setCtFilterSp(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}}><option value="">All salespeople</option>{allSalespeople.map(s=><option key={s} value={s}>{s}</option>)}</select>}
            <select value={ctFilterStatus} onChange={e=>{setCtFilterStatus(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}}><option value="all">All status</option><option value="ongoing">🟡 Ongoing</option><option value="booked">🟢 Booked</option></select>
            <input type="date" value={ctFilterFrom} onChange={e=>{setCtFilterFrom(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}} placeholder="From"/>
            <input type="date" value={ctFilterTo} onChange={e=>{setCtFilterTo(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}} placeholder="To"/>
            {(ctFilterSp||ctFilterStatus!=="all"||ctFilterFrom||ctFilterTo||clientSearch)&&<button onClick={()=>{setCtFilterSp("");setCtFilterStatus("all");setCtFilterFrom("");setCtFilterTo("");setClientSearch("");}} style={{fontSize:10,color:accent,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear</button>}
          </div>
          {filtered.length===0?<div style={{padding:24,textAlign:"center",color:textS,fontSize:13}}>No clients found</div>
          :<div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${border}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1.8fr 1.1fr 0.9fr 1.1fr 0.9fr 0.7fr 1.1fr 0.7fr 1fr",gap:0,padding:"10px 14px",background:isDark?"rgba(201,169,110,0.08)":"#FAF9F6",fontSize:10,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5}}>
              <div>Client</div><div>Phone</div><div>Date</div><div>Venue</div><div>Function</div><div>Shift</div><div>Salesperson</div><div>Status</div><div>Created</div>
            </div>
            {filtered.map(c=><div key={c.id}>
              <div onClick={()=>{setCtExpandedId(ctExpandedId===c.id?null:c.id);}} style={{display:"grid",gridTemplateColumns:"1.8fr 1.1fr 0.9fr 1.1fr 0.9fr 0.7fr 1.1fr 0.7fr 1fr",gap:0,padding:"10px 14px",borderTop:`1px solid ${border}`,cursor:"pointer",background:ctExpandedId===c.id?(isDark?"rgba(201,169,110,0.05)":"#FFFDF7"):"transparent",transition:"background 0.15s"}}>
                <div style={{fontSize:13,fontWeight:600,color:textP}}>{c.name}{c.brideGroom&&<div style={{fontSize:10,color:textS}}>💑 {c.brideGroom}</div>}</div>
                <div style={{fontSize:12,color:textS}}>{c.phone||"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.eventDate?new Date(c.eventDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.venue||"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.fn||"—"}</div>
                <div style={{fontSize:11,color:textS}}>{c.shift||"—"}</div>
                <div style={{fontSize:11,color:textS}}>{c.createdBy||"—"}</div>
                <div><span style={{fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:600,background:c.status==="booked"?"rgba(16,185,129,0.15)":"rgba(245,158,11,0.15)",color:c.status==="booked"?"#10B981":"#F59E0B"}}>{c.status==="booked"?"🟢 Booked":"🟡 Ongoing"}</span></div>
                <div style={{fontSize:10,color:textS}}>{c.createdAt?new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</div>
              </div>
              {ctExpandedId===c.id&&<div style={{padding:"8px 14px 14px",borderTop:`1px dashed ${border}`,background:isDark?"rgba(0,0,0,0.2)":"#FAFAF7"}}>
                <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:11,color:textS,marginBottom:8}}>
                  <span>Created: {new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                  {c.bookedAt&&<span style={{color:"#10B981"}}>Booked: {new Date(c.bookedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})} by {c.bookedBy}</span>}
                  {c.pax&&<span>👥 {c.pax} pax</span>}
                </div>
                {c.sessions?.length>0&&<div>
                  <div style={{fontSize:10,fontWeight:600,color:textS,marginBottom:4}}>Sessions ({c.sessions.length})</div>
                  {c.sessions.slice(0,5).map((s,si)=><div key={si} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",marginBottom:2,borderRadius:6,background:isDark?"rgba(255,255,255,0.03)":"#fff",fontSize:11}}>
                    <span style={{color:textS}}>{new Date(s.savedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})} — {s.savedBy||"—"}</span>
                    <span style={{fontWeight:600,color:accentText}}>{s.total?fmt(s.total):"—"} <span style={{fontWeight:400,color:textS,fontSize:10}}>{s.tier||""}</span></span>
                  </div>)}
                </div>}
              </div>}
            </div>)}
          </div>}
        </div>;
      })()}
      {/* ═══ CALENDAR ═══ */}
      {settingsView === "calendar" && (() => {
        const now = new Date();
        const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
        const firstDay = new Date(calYear, calMonth, 1).getDay();
        const monthName = new Date(calYear, calMonth).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
        const allByDate = calLmsData?.byDate || {};
        // Richer color palette — inspired by professional scheduling UIs
        const srcColor = (src) => src === "decorContract"
          ? { bg: isDark?"rgba(16,185,129,0.14)":"#ECFDF5", text: isDark?"#34D399":"#047857", bar: "#10B981", label: "Booked" }
          : src === "venueContract"
          ? { bg: isDark?"rgba(251,146,60,0.14)":"#FFF7ED", text: isDark?"#FB923C":"#C2410C", bar: "#F97316", label: "Venue" }
          : { bg: isDark?"rgba(129,140,248,0.14)":"#EEF2FF", text: isDark?"#A5B4FC":"#4338CA", bar: "#6366F1", label: "Lead" };
        // Season calendar — uses demand-adjusted categories (not raw API data)
        const getSeason = (dateStr) => adjustedSeasonMap[dateStr] || calSeasonData?.default_category || "Filler";
        const seasonStyle = (cat) => cat === "King's" ? { bg: isDark?"rgba(234,179,8,0.12)":"rgba(254,243,199,0.7)", text: "#B45309", label: "👑", border: "rgba(234,179,8,0.35)" }
          : cat === "Perfect" ? { bg: isDark?"rgba(16,185,129,0.08)":"rgba(209,250,229,0.5)", text: "#047857", label: "✦", border: "rgba(16,185,129,0.3)" }
          : cat === "Normal" ? { bg: "transparent", text: "#6B7280", label: "○", border: "transparent" }
          : null;
        const filterFn = calView === "booked" ? (e) => e.source === "decorContract" || e.source === "venueContract" : (e) => e.source === "lead";
        const lmsByDate = {};
        for (const [date, entries] of Object.entries(allByDate)) { const f = entries.filter(filterFn); if (f.length > 0) lmsByDate[date] = f; }
        const MAX_BARS = 4;
        const navMonth = (dir) => { let nm = calMonth + dir, ny = calYear; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setCalMonth(nm); setCalYear(ny); setCalSelDate(null); };
        const cells = [];
        for (let i = 0; i < firstDay; i++) cells.push(<div key={"e" + i} style={{background:isDark?"rgba(255,255,255,0.01)":"#FAFAFA",borderRight:`1px solid ${border}`,borderBottom:`1px solid ${border}`}} />);
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const entries = lmsByDate[dateStr] || [];
          const isToday = dateStr === now.toISOString().slice(0, 10);
          const isSel = calSelDate === dateStr;
          const season = getSeason(dateStr);
          const ss = seasonStyle(season);
          const shown = entries.slice(0, MAX_BARS);
          const overflow = entries.length - MAX_BARS;
          const isPast = dateStr < now.toISOString().slice(0, 10);
          cells.push(<div key={d} onClick={() => setCalSelDate(isSel ? null : dateStr)} style={{ padding:"5px 4px",cursor:"pointer",minHeight:115,background:isSel?(isDark?"rgba(201,169,110,0.15)":"#FEF9EE"):(isDark?"transparent":"#fff"),borderRight:`1px solid ${border}`,borderBottom:`1px solid ${border}`,transition:"all 0.15s",position:"relative",opacity:isPast?0.6:1 }}>
            {/* Date number + season + count */}
            <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
              <span style={{fontSize:14,fontWeight:isToday?800:600,color:isToday?"#fff":textP,width:isToday?26:20,height:isToday?26:"auto",textAlign:"center",lineHeight:isToday?"26px":"normal",borderRadius:isToday?"50%":"none",background:isToday?accent:"none"}}>{d}</span>
              {ss&&<span style={{fontSize:9,color:ss.text,fontWeight:600,opacity:0.8}}>{ss.label}</span>}
              {entries.length>0&&<span style={{fontSize:9,fontWeight:700,color:calView==="booked"?"#10B981":"#6366F1",marginLeft:"auto",background:calView==="booked"?"rgba(16,185,129,0.12)":"rgba(99,102,241,0.12)",borderRadius:8,padding:"1px 6px"}}>{entries.length}</span>}
            </div>
            {/* Guest name bars — larger, more colorful */}
            {shown.map((e, i) => {
              const sc = srcColor(e.source);
              return <div key={i} title={`${e.guestName}\n${sc.label} · ${e.fnLabel||"—"} · ${e.venueLabel||"—"} · ${e.shift||"—"}`} style={{fontSize:10,lineHeight:"18px",padding:"1px 5px",marginBottom:2,borderRadius:4,background:sc.bg,color:sc.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",borderLeft:`3px solid ${sc.bar}`,cursor:"pointer"}}>{e.guestName}</div>;
            })}
            {overflow>0&&<div style={{fontSize:9,color:textS,padding:"0 4px",fontWeight:500}}>+{overflow} more</div>}
          </div>);
        }
        const totalCells = firstDay + daysInMonth;
        const trailingEmpty = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 0; i < trailingEmpty; i++) cells.push(<div key={"t" + i} style={{background:isDark?"rgba(255,255,255,0.01)":"#FAFAFA",borderRight:`1px solid ${border}`,borderBottom:`1px solid ${border}`}} />);

        const selEntries = calSelDate ? (lmsByDate[calSelDate] || []) : [];
        // Monthly stats — always from allByDate (unfiltered) so both counts show
        const monthPrefix = `${calYear}-${String(calMonth+1).padStart(2,"0")}`;
        const monthAll = Object.entries(allByDate).filter(([d])=>d.startsWith(monthPrefix));
        const monthLeadCount = monthAll.reduce((s,[,arr])=>s+arr.filter(e=>e.source==="lead").length,0);
        const monthContractCount = monthAll.reduce((s,[,arr])=>s+arr.filter(e=>e.source!=="lead").length,0);
        const monthViewCount = Object.entries(lmsByDate).filter(([d])=>d.startsWith(monthPrefix)).reduce((s,[,arr])=>s+arr.length,0);
        const datesWithEntries = Object.keys(lmsByDate).filter(d=>d.startsWith(monthPrefix)).length;
        // Season stats for the month — from adjusted categories
        let monthKings = 0, monthPerfect = 0, monthNormal = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const cat = getSeason(ds);
          if (cat === "King's") monthKings++;
          else if (cat === "Perfect") monthPerfect++;
          else if (cat === "Normal") monthNormal++;
        }

        return <div style={{width:"100%"}}>
          {/* Header + Toggle */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:accent,letterSpacing:-0.3}}>📅 Demand Calendar</div>
              <div style={{fontSize:11,color:textS,marginTop:3}}>{calView==="booked"?"Confirmed bookings from LMS":"Decor lead pipeline from LMS"}{calLmsData && !calLmsData.complete && <span style={{color:"#D97706"}}> · cache loading…</span>}</div>
            </div>
            {isAdmin&&<button onClick={()=>{setCalLmsData(null);setCalSeasonData(null);fetchCachedContracts().then(({contracts})=>{const byDate={};for(const c of (contracts||[])){const source=c.dept==="venue"?"venueContract":"decorContract";for(const fn of (c.functions||[])){const date=String(fn.functionDate||"").slice(0,10);if(!date)continue;(byDate[date]=byDate[date]||[]).push({guestName:c.guestName||"—",source,fnLabel:fn.functionType||"",venueLabel:fn.internalVenueName||fn.venueName||fn.externalVenue||"",shift:fn.session||"",priority:c.priority||"",status:c.lmsStatus||"",entryNo:c.entryNo,phone:c.contactNo||""});}}setCalLmsData({byDate,complete:true});}).catch(()=>{});fetchSeason().then(d=>{if(d?.dates)setCalSeasonData(d);}).catch(()=>{});showMsg("🔄 Refreshing…","blue");}} style={{...S.btn(false),fontSize:11,padding:"6px 14px"}}>🔄 Refresh</button>}
          </div>
          {/* Toggle pills */}
          <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:12,overflow:"hidden",border:`1.5px solid ${border}`,width:"fit-content"}}>
            <button onClick={()=>{setCalView("booked");setCalSelDate(null);}} style={{padding:"9px 24px",fontSize:13,fontWeight:700,border:"none",cursor:"pointer",background:calView==="booked"?(isDark?"rgba(16,185,129,0.2)":"#ECFDF5"):"transparent",color:calView==="booked"?"#10B981":textS,transition:"all 0.15s",letterSpacing:0.2}}>🟢 Booked ({monthContractCount})</button>
            <button onClick={()=>{setCalView("leads");setCalSelDate(null);}} style={{padding:"9px 24px",fontSize:13,fontWeight:700,border:"none",borderLeft:`1.5px solid ${border}`,cursor:"pointer",background:calView==="leads"?(isDark?"rgba(99,102,241,0.2)":"#EEF2FF"):"transparent",color:calView==="leads"?"#6366F1":textS,transition:"all 0.15s",letterSpacing:0.2}}>🔵 Leads ({monthLeadCount})</button>
          </div>
          {/* Stats strip */}
          <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:16,padding:"10px 16px",borderRadius:12,background:isDark?"rgba(201,169,110,0.05)":"#FAFAF7",border:`1px solid ${border}`}}>
            <div style={{fontSize:12,color:textS}}>{calView==="booked"?"🟢":"🔵"} <strong style={{color:calView==="booked"?"#10B981":"#6366F1"}}>{monthViewCount}</strong> {calView==="booked"?"bookings":"leads"}</div>
            <div style={{fontSize:12,color:textS}}>📅 <strong style={{color:textP}}>{datesWithEntries}</strong> active dates</div>
            {monthKings>0&&<div style={{fontSize:12,color:textS}}>👑 <strong style={{color:"#B45309"}}>{monthKings}</strong> King's</div>}
            {monthPerfect>0&&<div style={{fontSize:12,color:textS}}>✦ <strong style={{color:"#047857"}}>{monthPerfect}</strong> Perfect</div>}
            {monthNormal>0&&<div style={{fontSize:12,color:textS}}>○ <strong style={{color:"#6B7280"}}>{monthNormal}</strong> Normal</div>}
          </div>
          {/* Month nav */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <button onClick={()=>navMonth(-1)} style={{...S.btn(false),fontSize:14,padding:"8px 18px",fontWeight:600}}>← Prev</button>
            <div style={{fontSize:18,fontWeight:800,color:textP,letterSpacing:-0.3}}>{monthName}</div>
            <button onClick={()=>navMonth(1)} style={{...S.btn(false),fontSize:14,padding:"8px 18px",fontWeight:600}}>Next →</button>
          </div>
          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderTop:`1.5px solid ${border}`,borderLeft:`1.5px solid ${border}`}}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(dd=><div key={dd} style={{textAlign:"center",fontSize:11,fontWeight:700,color:textS,padding:"8px 0",borderRight:`1px solid ${border}`,borderBottom:`1.5px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F8F8FA",textTransform:"uppercase",letterSpacing:0.8}}>{dd}</div>)}
          </div>
          {/* Calendar grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderLeft:`1.5px solid ${border}`}}>{cells}</div>
          {/* Date detail panel — click a date to see full info */}
          {calSelDate&&<div style={{marginTop:16,...S.card,padding:"14px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14,fontWeight:700,color:textP}}>📅 {new Date(calSelDate+"T00:00:00").toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"long",year:"numeric"})}</span>
                {(()=>{ const s=getSeason(calSelDate); const ss2=seasonStyle(s); return ss2?<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:600,background:ss2.bg,color:ss2.text,border:`1px solid ${ss2.border}`}}>{ss2.label} {s}</span>:null; })()}
              </div>
              <span style={{fontSize:11,fontWeight:600,color:calView==="booked"?"#10B981":"#6366F1"}}>{selEntries.length} {calView==="booked"?"booking":"lead"}{selEntries.length!==1?"s":""}</span>
            </div>
            {selEntries.length===0&&<div style={{fontSize:12,color:textS}}>No {calView==="booked"?"bookings":"leads"} on this date</div>}
            {selEntries.map((e,i)=>{
              const sc=srcColor(e.source);
              const prC=e.priority==="Gold"?{bg:"rgba(234,179,8,0.15)",color:"#CA8A04"}:e.priority==="Silver"?{bg:"rgba(148,163,184,0.15)",color:"#64748B"}:e.priority==="Platinum"?{bg:"rgba(168,85,247,0.15)",color:"#9333EA"}:null;
              return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",marginBottom:2,borderRadius:6,background:sc.bg,borderLeft:`3px solid ${sc.bar}`,fontSize:12}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontWeight:600,color:sc.text}}>{e.guestName}</span>
                  {e.source==="venueContract"&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"rgba(245,158,11,0.15)",color:"#D97706",fontWeight:600}}>Venue</span>}
                  {prC&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,fontWeight:600,...prC}}>{e.priority}</span>}
                  {e.status&&calView==="leads"&&<span style={{fontSize:9,color:textS}}>({e.status})</span>}
                </div>
                <span style={{color:textS,fontSize:11}}>{e.fnLabel||"—"} · {e.venueLabel||"—"} · {e.shift||"—"}</span>
              </div>;
            })}
          </div>}
          {/* Legend */}
          <div style={{display:"flex",gap:14,marginTop:14,fontSize:10,color:textS,alignItems:"center",flexWrap:"wrap"}}>
            {calView==="booked"?<>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,borderRadius:2,background:"rgba(16,185,129,0.3)",display:"inline-block"}}></span> Decor booked</span>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,borderRadius:2,background:"rgba(245,158,11,0.3)",display:"inline-block"}}></span> Venue booked</span>
            </>:<>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,borderRadius:2,background:"rgba(99,102,241,0.3)",display:"inline-block"}}></span> Decor lead</span>
            </>}
            <span style={{color:border}}>|</span>
            <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,borderRadius:2,background:"rgba(234,179,8,0.25)",display:"inline-block"}}></span> 👑 King's</span>
            <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,borderRadius:2,background:"rgba(16,185,129,0.2)",display:"inline-block"}}></span> ✦ Perfect</span>
            <span>Filler = no tint</span>
          </div>
        </div>;
      })()}
      {settingsView === "venues" && AdminVenues()}
      {settingsView === "tags" && AdminTags()}
      {settingsView === "priority" && <div style={{maxWidth:500}}>
        <div style={{fontSize:14,fontWeight:600,color:textP,marginBottom:4}}>Photo filter priority</div>
        <div style={{fontSize:12,color:textS,marginBottom:16}}>Drag to reorder. When showing photos on Build page, photos matching the top priority will rank highest. Applied for all salespersons.</div>
        <div style={{borderRadius:10,border:`1px solid ${border}`,overflow:"hidden"}}>
          {filterPriority.map((p,idx)=><div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderBottom:idx<filterPriority.length-1?`1px solid ${border}`:"none",background:cardBg}}>
            <div style={{fontSize:16,fontWeight:700,color:accent,width:24,textAlign:"center"}}>{idx+1}</div>
            <span style={{fontSize:14}}>{p.icon}</span>
            <div style={{flex:1,fontSize:13,fontWeight:600,color:textP}}>{p.label}</div>
            <div style={{display:"flex",gap:2}}>
              <button onClick={()=>movePriority(idx,-1)} disabled={idx===0} style={{width:28,height:28,borderRadius:6,border:`1px solid ${border}`,background:"transparent",cursor:idx===0?"default":"pointer",opacity:idx===0?0.3:1,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:textP}}>↑</button>
              <button onClick={()=>movePriority(idx,1)} disabled={idx===filterPriority.length-1} style={{width:28,height:28,borderRadius:6,border:`1px solid ${border}`,background:"transparent",cursor:idx===filterPriority.length-1?"default":"pointer",opacity:idx===filterPriority.length-1?0.3:1,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:textP}}>↓</button>
            </div>
          </div>)}
        </div>
        <button onClick={()=>saveFilterPriority(DEFAULT_FILTER_PRIORITY)} style={{...S.btn(false),fontSize:11,marginTop:12}}>Reset to default</button>
      </div>}
      {settingsView === "departments" && (() => {
        const DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"];
        const map = catDeptMap || {};
        // Keyword fallback (mirrors Deal Check) — shown as the default when a category isn't set.
        const kw = (cat) => { const s = String(cat || "").toLowerCase(); if (s.includes("floral") || s.includes("flower")) return "Floral"; if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting"; if (s.includes("truss")) return "Tenting"; if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric"; if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting"; if (s.includes("transport") || s.includes("truck")) return "Transport"; if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture"; return "Structure"; };
        // Categories to map: studio rate-card categories + IMS inventory categories (deduped by name).
        const cats = [];
        const seen = new Set();
        [...(rcCats || []).map(c => c?.l).filter(Boolean), ...INV_CATS].forEach(name => { const k = String(name).toLowerCase().trim(); if (k && !seen.has(k)) { seen.add(k); cats.push(name); } });
        const setCat = (name, dep) => { const k = String(name).toLowerCase().trim(); const next = { ...map }; if (dep) next[k] = dep; else delete next[k]; saveCatDeptMap(next); };
        return <div style={{ maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: textP, marginBottom: 4 }}>🏦 Department Income mapping</div>
          <div style={{ fontSize: 12, color: textS, marginBottom: 16 }}>Set which department earns each category's income (used by Deal Check → Dept Income). "Auto" uses smart keyword matching. Manpower types & truss/fabric follow fixed rules.</div>
          <div style={{ borderRadius: 10, border: `1px solid ${border}`, overflow: "hidden" }}>
            {cats.map((name, i) => {
              const k = String(name).toLowerCase().trim();
              const val = map[k] || "";
              return <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < cats.length - 1 ? `1px solid ${border}` : "none", background: cardBg }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: textP }}>{name}</div>
                <select value={val} onChange={e => setCat(name, e.target.value)} style={{ ...S.select, width: 180, marginBottom: 0, fontSize: 12 }}>
                  <option value="">Auto ({kw(name)})</option>
                  {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>;
            })}
          </div>
          <div style={{ fontSize: 10, color: textS, marginTop: 10, lineHeight: 1.5 }}>Tip: a sub-category inherits its category's department. Truss steel → Tenting · masking/drape fabric → Fabric · genset → Lighting · transport → Transport · manpower by worker type — all handled automatically.</div>
        </div>;
      })()}
    </div>
  );
}

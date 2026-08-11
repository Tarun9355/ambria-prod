import { useState, useEffect, useMemo } from "react";
import { SPACES, TAX_LABELS, DEFAULT_TAX_KEYS, taxOr, ZONE_META } from "../../../lib/studio/taxonomy";
import { DEFAULT_FILTER_PRIORITY } from "../../../lib/studio/keys";
import { supabase } from "../../../lib/supabase";
import { findZoneForArea } from "../../../lib/studio/pricing";
import { makeDeleteClient } from "../../../lib/studio/clientDelete";

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
    addTagWithAreaZoneSync, showMsg, askConfirm,
    // settings routing
    settingsView, setSettingsView,
    // auth
    authUser, isAdmin, hasPerm, studioSettingsAllowed,
    // venues
    customInhouse, customOutdoor, saveVenues, ytVideoTags, saveYtTags, trVenues, saveTR,
    newIH, setNewIH, newOD, setNewOD, adminOdSearch, setAdminOdSearch, editIH, setEditIH, editOD, setEditOD,
    allInhouseVenues, allOutdoorDB, allInhouseGroups, allVenueData,
    // clients
    clientLedger, saveClientLedger, activeClientId, setActiveClientId, eventOrders,
    ctFilterSp, setCtFilterSp, ctFilterStatus, setCtFilterStatus,
    ctFilterFrom, setCtFilterFrom, ctFilterTo, setCtFilterTo, ctExpandedId, setCtExpandedId,
    clientSearch, setClientSearch,
    // calendar    // palettes
    imsColourCatalogue, setImsColourCatalogue, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData,
    // department income mapping
    // zones
    zoneDefs, setZoneDefs, saveZD, zoneLabelsD, addZoneWithAreaSync,
    // photo priority — saveFilterPriority is the reference handler; fall back to
    // setFilterPriority (the name present in StudioApp's ctx literal) if absent.
    filterPriority, setFilterPriority, saveFilterPriority: ctxSaveFilterPriority,
    // batch AI tagging — shared app-wide state + controls (same ctx values ManageLibrary uses)
    bulkTag, runBulkTag, stopBulkTag,
    // sub-views rendered as functions on the parent (AdminUsers not in ctx — guarded)
    AdminUsers,
  } = ctx;

  const saveFilterPriority = ctxSaveFilterPriority || setFilterPriority;



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

    // ═══ VENUE RENAME → EVERYTHING KEYED BY THE NAME ═══
    // Venues are referenced by NAME, not id, in four separate places. Renaming one used to update
    // only the venue list, silently breaking the other three:
    //
    //   • video tags     — the video stops matching the venue filters
    //   • library photos — same, for stills (604 carry a venue; 131 are already stranded)
    //   • transport tier — THE COSTLY ONE. transportCalc matches trVenues by name, so a renamed
    //                      venue falls through to isNew, tier "New venue", and the trip rate drops
    //                      to customTripRate. The quote changes with nothing on screen saying why.
    //
    // Past EVENTS are deliberately excluded — client_ledger and event_orders record where a job
    // actually happened, and rewriting that would falsify history. Reference data has no such
    // reason, so it follows the rename.
    const renameVenueEverywhere = async (oldName, newName) => {
      const from = (oldName || "").trim(), to = (newName || "").trim();
      const out = { videos: 0, transport: 0, photos: 0 };
      if (!from || !to || from === to) return out;

      // 1. video tags — saveYtTags takes a PATCH keyed by video id, not the whole map. Passing the
      //    whole map would re-upsert every tagged video (one chained write each) and overwrite any
      //    tag edited elsewhere since this component rendered. Only the matching ids go in, and each
      //    value is the function form so it composes onto the freshest tag rather than our snapshot.
      const tags = ytVideoTags || {};
      const vids = Object.keys(tags).filter((id) => (tags[id]?.venue || "").trim() === from);
      if (vids.length) {
        const patch = {};
        vids.forEach((id) => { patch[id] = (prev) => ({ ...prev, venue: to }); });
        saveYtTags(patch);
        out.videos = vids.length;
      }

      // 2. transport tier — match case-insensitively, exactly as transportCalc does when it looks
      //    the venue up, so a tier written with different casing still follows the rename.
      const tiers = Array.isArray(trVenues) ? trVenues : [];
      const hitsT = tiers.filter((v) => String(v?.name || "").trim().toLowerCase() === from.toLowerCase());
      if (hitsT.length) {
        saveTR(tiers.map((v) => (String(v?.name || "").trim().toLowerCase() === from.toLowerCase() ? { ...v, name: to } : v)));
        out.transport = hitsT.length;
      }

      // 3. library photos (a real table) — page through the matches and rewrite tags.venue only,
      //    leaving every other tag on the row untouched.
      try {
        for (let guard = 0; guard < 100; guard++) {
          const { data, error } = await supabase.from("library").select("id,tags").eq("tags->>venue", from).limit(500);
          if (error || !data?.length) break;
          const res = await Promise.all(data.map((r) =>
            supabase.from("library").update({ tags: { ...r.tags, venue: to } }).eq("id", r.id)));
          if (res.some((x) => x.error)) break;
          out.photos += data.length;
          if (data.length < 500) break;
        }
      } catch { /* a failed photo pass must not undo the renames above */ }

      return out;
    };

    // "3 videos · 2 photos · transport tier" — only the parts that actually moved.
    const renameSummary = (r) => {
      const bits = [];
      if (r.videos) bits.push(`${r.videos} video tag${r.videos === 1 ? "" : "s"}`);
      if (r.photos) bits.push(`${r.photos} photo${r.photos === 1 ? "" : "s"}`);
      if (r.transport) bits.push("transport tier");
      return bits.length ? ` — ${bits.join(" · ")} updated` : "";
    };

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
      const renamed = newName !== editIH.origName;
      const origName = editIH.origName;
      setEditIH(null);
      if (renamed) {
        showMsg("✓ Venue renamed — updating references…", "green");
        renameVenueEverywhere(origName, newName).then((r) => {
          showMsg(`✓ Venue renamed${renameSummary(r)}. Past events keep their original venue name for audit.`, "green");
        });
      }
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
      const renamed = newName !== editOD.origName;
      const origName = editOD.origName;
      setEditOD(null);
      if (renamed) {
        showMsg("✓ Venue renamed — updating references…", "green");
        renameVenueEverywhere(origName, newName).then((r) => {
          showMsg(`✓ Venue renamed${renameSummary(r)}.`, "green");
        });
      }
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

  // ═══ TAG RENAME (the "U" in CRUD) ═══
  // A tag is stored as a bare string inside every library row's tags JSONB, so renaming it in the
  // taxonomy alone would strand every photo carrying the old value — "Wedding" by itself sits on
  // 1,000+ rows. Rename therefore migrates the library too, and states the row count up front.
  const [taxRen, setTaxRen] = useState(null);   // { cat, from, value } | null
  const [taxBusy, setTaxBusy] = useState(false);

  const tagFilter = (cat, val) => [`tags->${cat}`, "cs", JSON.stringify([val])];

  // Rewrite the value in place, a page at a time. Each pass removes its own rows from the match
  // set, so the loop drains; the iteration cap is a backstop against a silently failing update.
  const migrateLibraryTag = async (cat, from, to) => {
    const PAGE = 500; let done = 0;
    for (let guard = 0; guard < 200; guard++) {
      const { data, error } = await supabase.from("library").select("id,tags").filter(...tagFilter(cat, from)).limit(PAGE);
      if (error) throw new Error(error.message);
      if (!data?.length) return done;
      const results = await Promise.all(data.map((r) => {
        const arr = Array.isArray(r.tags?.[cat]) ? r.tags[cat] : [];
        // Swap then dedupe — a row already carrying both names must not end up with the new one twice.
        const next = [...new Set(arr.map((x) => (x === from ? to : x)))];
        return supabase.from("library").update({ tags: { ...r.tags, [cat]: next } }).eq("id", r.id);
      }));
      const failed = results.find((r) => r.error);
      if (failed) throw new Error(failed.error.message);
      done += data.length;
      if (data.length < PAGE) return done;
    }
    throw new Error("migration did not converge");
  };

  const commitTagRename = async () => {
    if (!taxRen || taxBusy) return;
    const { cat, from } = taxRen;
    const to = (taxRen.value || "").trim();
    if (!to || to === from) { setTaxRen(null); return; }
    if ((taxonomy[cat] || []).some((x) => x !== from && x.toLowerCase() === to.toLowerCase())) {
      showMsg("That tag already exists in this category", "red"); return;
    }
    const { count, error } = await supabase.from("library").select("id", { count: "exact", head: true }).filter(...tagFilter(cat, from));
    if (error) { showMsg("Could not count tagged photos: " + error.message, "red"); return; }
    const n = count || 0;
    askConfirm(
      `Rename "${from}" → "${to}"?`,
      async () => {
        setTaxBusy(true);
        try {
          if (n) await migrateLibraryTag(cat, from, to);
          await saveTax({ ...taxonomy, [cat]: (taxonomy[cat] || []).map((x) => (x === from ? to : x)) });
          // An area tag is bound to its zone by name (findZoneForArea matches on id or label), so a
          // rename that skipped the zone would quietly break that link. Relabel, keep the id — deals
          // reference the id.
          if (cat === "areasElements") {
            const zid = findZoneForArea(from, zoneDefs?.meta);
            if (zid) await saveZD({ ...zoneDefs, meta: { ...zoneDefs.meta, [zid]: { ...zoneDefs.meta[zid], label: to } } });
          }
          setTaxRen(null);
          showMsg(n ? `Renamed — ${n} photo${n === 1 ? "" : "s"} updated` : "Renamed", "green");
        } catch (e) {
          showMsg("Rename failed: " + e.message, "red");
        } finally { setTaxBusy(false); }
      },
      {
        yesLabel: "Rename",
        note: n
          ? `${n} photo${n === 1 ? "" : "s"} carrying this tag will be re-tagged. Renaming back reverses it.`
          : "No photos currently use this tag, so only the tag list changes.",
      },
    );
  };

  // ═══ ADMIN TAGS (settingsView "tags") — App_latest.jsx:11598 ═══
  const AdminTags = () => (
    <div style={{ maxWidth: 600 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: textP, marginBottom: 4 }}>Tag taxonomy manager</div>
      <div style={{ fontSize: 12, color: textS, marginBottom: 16 }}>Add, rename, or remove tag options. Renaming re-tags every photo that already uses the tag.</div>

      {/* ═══ TAG CATEGORIES (existing taxonomy) ═══ */}
      {Object.keys(taxonomy).filter(k => k !== "categoryTier" && Array.isArray(taxonomy[k])).map(k => (
        <div key={k} style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: textP }}>{getTaxLabel(k)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 11, color: textS }}>{taxonomy[k].length} tags</div>
              {!DEFAULT_TAX_KEYS.has(k) && <span onClick={() => {
                askConfirm(`Delete category "${getTaxLabel(k)}" and all ${taxonomy[k].length} of its tags?`, () => {
                    const next = { ...taxonomy };
                    delete next[k];
                    saveTax(next);
                  }, { yesLabel: "Delete" });
              }} style={{ cursor: "pointer", color: "#E11D48", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(225,29,72,0.3)" }}>{"🗑"} Delete</span>}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {taxonomy[k].map(v => (
              taxRen && taxRen.cat === k && taxRen.from === v ? (
                <span key={v} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <input value={taxRen.value} disabled={taxBusy} autoFocus
                    onChange={e => setTaxRen({ ...taxRen, value: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") commitTagRename(); if (e.key === "Escape") setTaxRen(null); }}
                    style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 110, marginBottom: 0 }} />
                  <span onClick={commitTagRename} style={{ cursor: taxBusy ? "wait" : "pointer", fontSize: 12, color: accent }}>{taxBusy ? "…" : "✓"}</span>
                  <span onClick={() => !taxBusy && setTaxRen(null)} style={{ cursor: "pointer", fontSize: 12, color: textS }}>{"×"}</span>
                </span>
              ) : (
                <span key={v} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 8, border: `1px solid ${border}`, color: textS, display: "flex", alignItems: "center", gap: 4 }}>
                  <span onClick={() => setTaxRen({ cat: k, from: v, value: v })} title="Click to rename" style={{ cursor: "text" }}>{v}</span>
                  <span onClick={() => {
                    askConfirm(`Remove "${v}" from ${getTaxLabel(k)}?`, () => {
                      saveTax({ ...taxonomy, [k]: taxonomy[k].filter(x => x !== v) });
                    }, { yesLabel: "Remove", note: "It stops being offered as an option. Photos already tagged with it keep the tag — rename instead if you want those updated." });
                  }} style={{ cursor: "pointer", color: "#E11D48", fontSize: 10, fontWeight: 700 }}>{"×"}</span>
                </span>
              )
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
    const first = ["clients", "venues", "zones", "tags", "priority"].find((v) => studioSettingsAllowed(v));
    if (first && first !== settingsView) setSettingsView(first);
  }, [settingsView, studioSettingsAllowed, setSettingsView]);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {(() => {
          const allow = (v) => (studioSettingsAllowed ? studioSettingsAllowed(v) : true);
          const VIEWS = [["clients", "📋 Clients"], ["venues", "🏛️ Venues"], ["zones", "📐 Zones"], ["tags", "🏷️ Tags"], ["priority", "📊 Photo Priority"]];
          return VIEWS.filter(([v]) => allow(v)).map(([v, label]) => (
            <button key={v} onClick={() => setSettingsView(v)} style={{ ...S.btn(settingsView === v), fontSize: 11 }}>{label}</button>
          ));
        })()}
      </div>
      {/* AI batch-tagging start/stop control (restored to admin Settings — replaces the old nightly
          toggle; drives the SAME app-wide runBulkTag as the Library button, so it uses the current
          two-pass tagger, not a separate/drifting job). */}
      {isAdmin && (runBulkTag || bulkTag?.running) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "rgba(124,58,237,0.06)" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>🤖 AI Batch Tagging</span>
          {bulkTag?.running ? (<>
            <span style={{ fontSize: 11, color: textS, whiteSpace: "nowrap" }}>Tagging {bulkTag.done}/{bulkTag.total} · {bulkTag.ok}✓ {bulkTag.fail}✕</span>
            <div style={{ flex: 1, height: 4, background: border, borderRadius: 2 }}><div style={{ height: 4, width: `${bulkTag.total ? (bulkTag.done / bulkTag.total) * 100 : 0}%`, background: "#7C3AED", borderRadius: 2, transition: "width 0.3s" }} /></div>
            <button onClick={() => stopBulkTag?.()} style={{ ...S.btn(false), fontSize: 11, padding: "6px 14px", color: "#E11D48", whiteSpace: "nowrap" }}>■ Stop</button>
          </>) : (<>
            <span style={{ fontSize: 11, color: textS, flex: 1 }}>Tags every untagged Library photo in the background (two-pass self-verify on). Resumes where it left off; a person still reviews after.</span>
            <button onClick={() => { if (window.confirm("Start AI batch tagging of ALL untagged Library photos?\n\nRuns in the background — keep working in the app. Two Opus passes per photo (slower, higher accuracy). Stop anytime; it resumes on the next run.")) runBulkTag?.(); }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 14px", background: "#7C3AED", whiteSpace: "nowrap" }}>▶ Start batch tagging</button>
          </>)}
        </div>
      )}
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
      {/* A dead lead is not a lost row — it keeps its history and can be reopened. Marking dead drops it
          out of the "ongoing" demand count for its date (StudioBuild counts status === "ongoing"
          explicitly), which is the point: chasing a dead lead should not make a date look busy. */}
      {settingsView === "clients" && (() => {
        // Admin only — everyone else gets Ongoing/Dead, which is reversible. Shared with the
        // Summary footer so the two entry points cannot drift apart.
        const deleteClient = makeDeleteClient({
          clientLedger, saveClientLedger, eventOrders, activeClientId, setActiveClientId, askConfirm, showMsg,
        });
        const setClientStatus = (c, next) => {
          if (!c || c.status === next) return;
          const dead = next === "dead";
          askConfirm(
            `Mark "${c.name}" as ${dead ? "Dead" : "Ongoing"}?`,
            () => {
              const patch = dead
                ? { status: "dead", deadAt: Date.now(), deadBy: authUser?.name || "—" }
                : { status: "ongoing", deadAt: null, deadBy: null };
              saveClientLedger(clientLedger.map(x => (x.id === c.id ? { ...x, ...patch } : x)));
              showMsg(`${c.name} marked ${dead ? "dead" : "ongoing"}`, "green");
            },
            {
              yesLabel: dead ? "Mark dead" : "Reopen",
              note: dead
                ? "Its sessions and history are kept, and it stops counting towards demand for that date. You can reopen it later."
                : "It counts towards demand for that date again.",
            },
          );
        };
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
            <select value={ctFilterStatus} onChange={e=>{setCtFilterStatus(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}}><option value="all">All status</option><option value="ongoing">🟡 Ongoing</option><option value="booked">🟢 Booked</option><option value="dead">🔴 Dead</option></select>
            <input type="date" value={ctFilterFrom} onChange={e=>{setCtFilterFrom(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}} placeholder="From"/>
            <input type="date" value={ctFilterTo} onChange={e=>{setCtFilterTo(e.target.value);}} style={{...S.select,fontSize:11,padding:"6px 10px"}} placeholder="To"/>
            {(ctFilterSp||ctFilterStatus!=="all"||ctFilterFrom||ctFilterTo||clientSearch)&&<button onClick={()=>{setCtFilterSp("");setCtFilterStatus("all");setCtFilterFrom("");setCtFilterTo("");setClientSearch("");}} style={{fontSize:10,color:accent,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear</button>}
          </div>
          {filtered.length===0?<div style={{padding:24,textAlign:"center",color:textS,fontSize:13}}>No clients found</div>
          :<div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${border}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1.7fr 1fr 0.8fr 1fr 0.85fr 0.6fr 1fr 0.75fr 0.75fr 1fr",gap:0,padding:"10px 14px",background:isDark?"rgba(201,169,110,0.08)":"#FAF9F6",fontSize:10,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5}}>
              <div>Client</div><div>Phone</div><div>Date</div><div>Venue</div><div>Function</div><div>Shift</div><div>Salesperson</div><div>Status</div><div>Created</div><div>Actions</div>
            </div>
            {filtered.map(c=>{
              const ST = c.status==="booked" ? {bg:"rgba(16,185,129,0.15)",fg:"#10B981",t:"🟢 Booked"}
                       : c.status==="dead"   ? {bg:"rgba(239,68,68,0.14)", fg:"#EF4444",t:"🔴 Dead"}
                       :                       {bg:"rgba(245,158,11,0.15)",fg:"#F59E0B",t:"🟡 Ongoing"};
              return <div key={c.id}>
              <div onClick={()=>{setCtExpandedId(ctExpandedId===c.id?null:c.id);}} style={{display:"grid",gridTemplateColumns:"1.7fr 1fr 0.8fr 1fr 0.85fr 0.6fr 1fr 0.75fr 0.75fr 1fr",gap:0,padding:"10px 14px",borderTop:`1px solid ${border}`,cursor:"pointer",background:ctExpandedId===c.id?(isDark?"rgba(201,169,110,0.05)":"#FFFDF7"):"transparent",transition:"background 0.15s"}}>
                <div style={{fontSize:13,fontWeight:600,color:textP}}>{c.name}{c.brideGroom&&<div style={{fontSize:10,color:textS}}>💑 {c.brideGroom}</div>}</div>
                <div style={{fontSize:12,color:textS}}>{c.phone||"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.eventDate?new Date(c.eventDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.venue||"—"}</div>
                <div style={{fontSize:11,color:textP}}>{c.fn||"—"}</div>
                <div style={{fontSize:11,color:textS}}>{c.shift||"—"}</div>
                <div style={{fontSize:11,color:textS}}>{c.createdBy||"—"}</div>
                <div><span style={{fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:600,background:ST.bg,color:ST.fg,whiteSpace:"nowrap"}}>{ST.t}</span></div>
                <div style={{fontSize:10,color:textS}}>{c.createdAt?new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</div>
                <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:4,alignItems:"center"}}>
                  {c.status==="booked"
                    ? <span title="Booked deals are changed from the deal itself, not here." style={{fontSize:10,color:textS}}>—</span>
                    : ["ongoing","dead"].map(st=>{
                        const on = c.status===st;
                        return <button key={st} onClick={()=>setClientStatus(c,st)} disabled={on}
                          title={on?`Already ${st}`:`Mark as ${st}`}
                          style={{fontSize:9,fontWeight:700,padding:"3px 7px",borderRadius:6,cursor:on?"default":"pointer",whiteSpace:"nowrap",
                            border:`1px solid ${on?"transparent":border}`,
                            background:on?(st==="dead"?"rgba(239,68,68,0.14)":"rgba(245,158,11,0.15)"):"transparent",
                            color:on?(st==="dead"?"#EF4444":"#F59E0B"):textS,
                            opacity:on?1:0.85}}>{st==="dead"?"Dead":"Ongoing"}</button>;
                      })}
                  {/* Admin only. Everyone else marks a lead Dead, which is reversible; this is not. */}
                  {isAdmin && <span onClick={()=>deleteClient(c)} title={`Delete ${c.name} permanently`}
                    style={{cursor:"pointer",color:"#E11D48",fontSize:11,padding:"2px 4px",lineHeight:1}}>{"🗑"}</span>}
                </div>
              </div>
              {ctExpandedId===c.id&&<div style={{padding:"8px 14px 14px",borderTop:`1px dashed ${border}`,background:isDark?"rgba(0,0,0,0.2)":"#FAFAF7"}}>
                <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:11,color:textS,marginBottom:8}}>
                  <span>Created: {new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                  {c.deadAt&&<span style={{color:"#EF4444"}}>Marked dead: {new Date(c.deadAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}{c.deadBy?` by ${c.deadBy}`:""}</span>}
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
            </div>;
            })}
          </div>}
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
    </div>
  );
}

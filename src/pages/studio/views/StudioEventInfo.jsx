import { useState } from "react";
import { taxOr, FUNCTIONS, CLIENT_SHIFTS_DD } from "../../../lib/studio/taxonomy";

export default function StudioEventInfo({ ctx }) {
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false); // collapsed by default
  const {
    S, isDark, accent, border, textS, textP, fmt,
    authUser,
    step, setStep,
    venue, setVenue, fn, setFn,
    clientName, setClientName, clientDate, setClientDate, clientPhone, setClientPhone,
    clientBrideGroom, setClientBrideGroom, clientShift, setClientShift, clientPax, setClientPax,
    clientVenueOther, setClientVenueOther,
    extraFunctions, setExtraFunctions, expandedFnIdx, setExpandedFnIdx,
    activeFnIdx, setActiveFnIdx,
    clientLedger, saveClientLedger, activeClientId, setActiveClientId, setClientSearch,
    activeClient, loadClientSession,
    sessionHistoryExpanded, setSessionHistoryExpanded,
    lmsLeads, lmsLoading, lmsError, lmsFilling, lmsCacheRef, setLmsRefreshCounter, loadLmsLead,
    taxonomy,
    customTripRate, setCustomTripRate, customGensets, setCustomGensets,
    setFilterFn, setBrowseVenues, setVenueGroup,
    allInhouseVenues, allOutdoorDB, allInhouseGroups, autoPersistCustomVenue,
    trVenues,
  } = ctx;

  const doSaveClient = () => {
    if (!clientName.trim()) return;
    let updated = [...clientLedger];
    let client = updated.find(c => c.id === activeClientId);
    if (!client) {
      client = { id: "CLI_" + Date.now().toString(36), name: clientName.trim(), phone: clientPhone.trim(), sessions: [], createdAt: Date.now(), status: "ongoing", createdBy: authUser?.name || "—", bookedAt: null, bookedBy: null, finalSession: null };
      updated.push(client);
      setActiveClientId(client.id);
    }
    client.name = clientName.trim();
    client.phone = clientPhone.trim();
    client.eventDate = clientDate;
    client.venue = venue;
    client.fn = fn;
    client.shift = clientShift;
    client.brideGroom = clientBrideGroom.trim();
    client.pax = clientPax;
    // Commit 2 — multi-function: persist full functions array on the client record.
    // Function 1 mirrors the legacy top-level fields above; Functions 2+ come from extraFunctions.
    client.functions = [
      { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax },
      ...extraFunctions
    ];
    client.createdBy = client.createdBy || authUser?.name || "—";
    client.lastContactAt = Date.now();
    saveClientLedger(updated.slice(0, 500));
  };
  return (
    <div style={S.main}>
      <div style={{maxWidth:640,margin:"0 auto",padding:"20px 0"}}>
        <div style={{marginBottom:28}}>
          <div style={{fontSize:24,fontWeight:700,color:textP}}>{"📋"} Event Information</div>
          <div style={{fontSize:13,color:textS,marginTop:6}}>Fill in the client details to start designing their event</div>
        </div>
        <div style={{...S.card,padding:"28px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div><div style={S.label}>Guest Name <span style={{color:"#EF4444"}}>*</span></div><input value={clientName} onChange={e=>{setClientName(e.target.value);setClientSearch(e.target.value);}} placeholder="Full name" style={S.input}/></div>
            <div><div style={S.label}>Phone <span style={{color:"#EF4444"}}>*</span></div><input value={clientPhone} onChange={e=>setClientPhone(e.target.value)} placeholder="+91 98XXX XXXXX" style={S.input}/></div>
          </div>
          {/* ═══ §25 TYPEAHEAD — STRICT LMS-FIRST (29 May 2026) ═══ */}
          {/* LMS Venue+Decor search is queried first (debounced 400ms, in-memory cache).             */}
          {/* Studio clientLedger fallback shows ONLY when LMS returns 0 results OR errors out.       */}
          {/* Hidden once a client is loaded (activeClientId set).                                    */}
          {(clientName.trim().length >= 2 || clientPhone.trim().length >= 4) && !activeClientId && (() => {
            const qName = clientName.trim().toLowerCase();
            const qPhone = clientPhone.trim();
            const timeAgo = (ts) => {
              const ms = Date.now() - ts;
              const min = Math.floor(ms / 60000);
              if (min < 1) return "just now";
              if (min < 60) return `${min}m ago`;
              const hr = Math.floor(min / 60);
              if (hr < 24) return `${hr}h ago`;
              const days = Math.floor(hr / 24);
              if (days < 30) return `${days}d ago`;
              return new Date(ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
            };
            // ── LMS LOADING STATE
            if (lmsLoading) {
              return <div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(59,130,246,0.06)":"rgba(59,130,246,0.04)",border:`1px solid ${isDark?"rgba(59,130,246,0.2)":"rgba(59,130,246,0.15)"}`,display:"flex",alignItems:"center",gap:8}}>
                <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#3B82F6",animation:"pulse 1.5s infinite"}}></span>
                <span style={{fontSize:11,fontWeight:600,color:"#3B82F6"}}>🔍 Searching LMS leads…</span>
              </div>;
            }
            // ── LMS HAS RESULTS → show LMS section only (strict LMS-first)
            if (lmsLeads && lmsLeads.length > 0) {
              return <div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(34,197,94,0.06)":"rgba(34,197,94,0.04)",border:`1px solid ${isDark?"rgba(34,197,94,0.25)":"rgba(34,197,94,0.2)"}`}}>
                <div style={{fontSize:11,fontWeight:600,color:"#15803D",marginBottom:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>📥</span><span>{lmsLeads.length} LMS lead{lmsLeads.length>1?"s":""} found — load to capture full lead context</span>
                  {lmsFilling && <span style={{fontSize:10,fontWeight:600,color:"#D97706",display:"inline-flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                    <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#F59E0B",animation:"pulse 1.5s infinite"}}></span>
                    more loading…
                  </span>}
                  <button onClick={() => { lmsCacheRef.current.clear(); fetch("/api/lms?op=force-refresh",{method:"POST"}).catch(()=>{}); setLmsRefreshCounter(c=>c+1); }} style={{marginLeft:"auto",padding:"2px 8px",borderRadius:4,border:"1px solid rgba(21,128,61,0.2)",background:"transparent",color:"#15803D",fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>🔄 Refresh</button>
                </div>
                {lmsLeads.map(lead => {
                  const deptBadgeStyle = lead.dept === "decor"
                    ? {background:"rgba(168,85,247,0.15)",color:"#9333EA"}
                    : {background:"rgba(59,130,246,0.15)",color:"#2563EB"};
                  return <div key={`${lead.dept}-${lead.entryNo}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span>{lead.guestName || "(no name)"}</span>
                        {lead.phone && <span style={{color:textS,fontWeight:400}}>· {lead.phone}</span>}
                        <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,...deptBadgeStyle}}>{lead.dept === "venue" ? "VENUE" : "DECOR"} #{lead.entryNo}</span>
                        {lead.priority && <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(245,158,11,0.15)",color:"#D97706"}}>{lead.priority.toUpperCase()}</span>}
                        {Array.isArray(lead.functions) && lead.functions.length > 1 && (
                          <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(168,85,247,0.15)",color:"#9333EA"}}>{lead.functions.length} FUNCTIONS</span>
                        )}
                      </div>
                      <div style={{fontSize:10,color:textS,marginTop:2}}>
                        {(() => {
                          // Show all function labels + dates if multi-function, else single-function display
                          const fns = Array.isArray(lead.functions) && lead.functions.length > 0 ? lead.functions : null;
                          if (fns && fns.length > 1) {
                            return fns.map((f, i) =>
                              <span key={i}>
                                {i > 0 && " · "}
                                {f.fnLabel}{f.fnDate ? ` ${f.fnDate}` : ""}
                              </span>
                            );
                          }
                          // Single function (or legacy back-compat)
                          return <>
                            {lead.fnLabel && <>{lead.fnLabel}</>}
                            {lead.fnDate && <> · {lead.fnDate}</>}
                            {lead.venueLabel && <> · {lead.venueLabel}</>}
                            {lead.status && <> · {lead.status}</>}
                          </>;
                        })()}
                      </div>
                    </div>
                    <button onClick={() => loadLmsLead(lead)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:"#15803D",color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
                  </div>;
                })}
              </div>;
            }
            // ── LMS EMPTY or ERRORED → fall back to Studio ledger
            const matches = clientLedger.filter(c => {
              if (!c.name) return false;
              const nameMatch = qName.length >= 2 && c.name.toLowerCase().includes(qName);
              const phoneMatch = qPhone.length >= 4 && (c.phone || "").includes(qPhone);
              return nameMatch || phoneMatch;
            }).slice(0, 5);
            const fallbackNote = lmsError
              ? "⚠ LMS unavailable — showing Studio clients"
              : lmsFilling
              ? "⏳ LMS cache loading… results will appear shortly"
              : (clientName.trim().length >= 2 ? "No LMS match — showing Studio clients" : null);
            if (matches.length === 0) {
              // No Studio match either — show only the explanatory note if LMS was attempted
              if (!fallbackNote) return null;
              return <div style={{marginBottom:16,padding:"8px 12px",borderRadius:8,background:isDark?"rgba(245,158,11,0.06)":"rgba(245,158,11,0.05)",border:`1px solid ${isDark?"rgba(245,158,11,0.2)":"rgba(245,158,11,0.15)"}`,fontSize:11,color:"#B45309",display:"flex",alignItems:"center",gap:8}}>
                <span style={{flex:1}}>{fallbackNote} · no matches found</span>
                <button onClick={() => { lmsCacheRef.current.clear(); fetch("/api/lms?op=force-refresh",{method:"POST"}).catch(()=>{}); setLmsRefreshCounter(c=>c+1); }} style={{padding:"2px 8px",borderRadius:4,border:"1px solid rgba(180,131,9,0.2)",background:"transparent",color:"#B45309",fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>🔄 Refresh</button>
              </div>;
            }
            return <div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(99,102,241,0.06)":"rgba(99,102,241,0.04)",border:`1px solid ${isDark?"rgba(99,102,241,0.2)":"rgba(99,102,241,0.15)"}`}}>
              <div style={{fontSize:11,fontWeight:600,color:"#6366F1",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                <span>💡</span>
                <span style={{flex:1}}>
                  {fallbackNote || `Found ${matches.length} existing client${matches.length>1?"s":""} — load to continue previous work?`}
                </span>
                <button onClick={() => { lmsCacheRef.current.clear(); fetch("/api/lms?op=force-refresh",{method:"POST"}).catch(()=>{}); setLmsRefreshCounter(c=>c+1); }} style={{padding:"2px 8px",borderRadius:4,border:"1px solid rgba(99,102,241,0.2)",background:"transparent",color:"#6366F1",fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>🔄 Refresh</button>
              </div>
              {matches.map(c => {
                const latest = c.sessions?.[0];
                const sessionCount = c.sessions?.length || 0;
                return <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:textP}}>
                      {c.name}
                      {c.phone && <span style={{color:textS,fontWeight:400,marginLeft:8}}>· {c.phone}</span>}
                      {c.status === "booked" && <span style={{marginLeft:8,padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(16,185,129,0.15)",color:"#10B981"}}>BOOKED</span>}
                      {c.lmsLeadId && <span style={{marginLeft:8,padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(34,197,94,0.15)",color:"#15803D"}}>📥 LMS #{c.lmsLeadId}</span>}
                    </div>
                    <div style={{fontSize:10,color:textS,marginTop:2}}>
                      {sessionCount > 0
                        ? <>
                            {sessionCount} session{sessionCount>1?"s":""}
                            {latest && <> · Last: <strong style={{color:textP}}>{latest.savedBy || "—"}</strong> {timeAgo(latest.savedAt)}</>}
                            {latest?.total && <> · {fmt(latest.total)}</>}
                          </>
                        : <>No sessions saved yet</>
                      }
                    </div>
                  </div>
                  <button onClick={() => loadClientSession(c, latest || null, 0)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:accent,color:isDark?"#1a1a2e":"#fff",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
                </div>;
              })}
            </div>;
          })()}
          <div style={{marginBottom:20}}><div style={S.label}>Bride & Groom Name</div><input value={clientBrideGroom} onChange={e=>setClientBrideGroom(e.target.value)} placeholder="e.g. Rahul & Priya" style={S.input}/></div>

          {/* ═══ FUNCTIONS ═══ Commit 2 — multi-function. Function 1 is mirrored by legacy state. ═══ */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4,marginBottom:12}}>
            <div style={{height:1,flex:1,background:border}}/>
            <div style={{fontSize:10,fontWeight:700,color:textS,letterSpacing:1.5,textTransform:"uppercase"}}>Functions</div>
            <div style={{height:1,flex:1,background:border}}/>
          </div>

          {[0, ...extraFunctions.map((_, i) => i + 1)].map(idx => {
            const f = idx === 0
              ? { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax }
              : (extraFunctions[idx - 1] || {});
            const isExpanded = expandedFnIdx === idx;
            const isComplete = !!(f.type && f.date);
            const canDelete = idx > 0;
            const updateType = (v) => idx === 0 ? setFn(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], type: v}; return n; });
            const updateDate = (v) => idx === 0 ? setClientDate(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], date: v}; return n; });
            const updateVenue = (v) => idx === 0 ? setVenue(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], venue: v}; return n; });
            const updateShift = (v) => idx === 0 ? setClientShift(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], shift: v}; return n; });
            const updatePax = (v) => idx === 0 ? setClientPax(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], pax: v}; return n; });
            const doDelete = () => {
              if (!canDelete) return;
              if (!confirm(`Remove Function ${idx + 1}?`)) return;
              setExtraFunctions(prev => prev.filter((_, i) => i !== idx - 1));
              if (expandedFnIdx >= idx) setExpandedFnIdx(Math.max(0, expandedFnIdx - 1));
              if (activeFnIdx >= idx) setActiveFnIdx(Math.max(0, activeFnIdx - 1)); // Commit 3 — keep pill on same semantic function after reindex
            };
            // Collapsed summary row (shown when complete and not currently expanded)
            if (!isExpanded && isComplete) {
              return (
                <div key={`fn-summary-${idx}`} style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#FBFBFD",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:18}}>🎉</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:textP}}>Function {idx + 1} — {f.type}</div>
                    <div style={{fontSize:10,color:textS,marginTop:2}}>
                      {f.date && <span>📅 {f.date} </span>}
                      {f.shift && <span>· 🕐 {f.shift} </span>}
                      {f.venue && <span>· 📍 {f.venue} </span>}
                      {f.pax && <span>· 👥 {f.pax} pax</span>}
                    </div>
                  </div>
                  <button onClick={() => setExpandedFnIdx(idx)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:accent,cursor:"pointer"}}>✏️ Edit</button>
                  {canDelete && <button onClick={doDelete} style={{fontSize:10,padding:"4px 8px",borderRadius:6,border:"none",background:"transparent",color:"#F87171",cursor:"pointer"}}>✕</button>}
                </div>
              );
            }
            // Expanded form view
            const venueVal = [...allInhouseVenues, "Others", ...allOutdoorDB.map(v => v.name)].includes(f.venue) ? f.venue : (f.venue ? "Others" : "");
            return (
              <div key={`fn-form-${idx}`} style={{padding:"16px 18px",borderRadius:12,border:`1px solid ${accent}30`,background:isDark?"rgba(201,169,110,0.03)":"#FFFDF7",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:accent}}>🎉 Function {idx + 1}</div>
                  <div style={{display:"flex",gap:6}}>
                    {isComplete && <button onClick={() => setExpandedFnIdx(null)} style={{fontSize:10,padding:"3px 8px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,cursor:"pointer"}}>Collapse</button>}
                    {canDelete && <button onClick={doDelete} style={{fontSize:10,padding:"3px 8px",borderRadius:6,border:"none",background:"transparent",color:"#F87171",cursor:"pointer"}}>✕ Remove</button>}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:12}}>
                  <div><div style={S.label}>Event Type <span style={{color:"#EF4444"}}>*</span></div><select value={f.type || ""} onChange={e => updateType(e.target.value)} style={{...S.select,width:"100%"}}><option value="">Select event type</option>{taxOr(taxonomy.eventType, FUNCTIONS).map(et => <option key={et} value={et}>{et}</option>)}</select></div>
                  <div><div style={S.label}>Event Date</div><input type="date" value={f.date || ""} onChange={e => updateDate(e.target.value)} style={S.input}/></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:f.venue === "Others" && idx === 0 ? 0 : 12}}>
                  <div><div style={S.label}>Venue</div>
                    <select value={venueVal} onChange={e => {
                      const v = e.target.value;
                      if (v === "Others") {
                        if (idx === 0) { updateVenue("Others"); setClientVenueOther(""); }
                        // Function 2+: "Others" not supported here — pre-add the venue via Venue Admin
                        // or inherit from Function 1. Silently ignore the selection.
                      } else {
                        updateVenue(v);
                        if (idx === 0) setClientVenueOther("");
                      }
                    }} style={{...S.select,width:"100%"}}>
                      <option value="">Select venue</option>
                      {allInhouseGroups.map(g => <optgroup key={g.parent} label={`Ambria ${g.parent}`}>{g.subVenues.map(sv => <option key={sv} value={sv}>{sv}</option>)}</optgroup>)}
                      {allOutdoorDB.filter(v => v.empanelled).length > 0 && <optgroup label="Empanelled Outside Venues">{allOutdoorDB.filter(v => v.empanelled).map(v => <option key={v.name} value={v.name}>{v.name} ★</option>)}</optgroup>}
                      {allOutdoorDB.filter(v => !v.empanelled).length > 0 && <optgroup label="Other Outside Venues">{allOutdoorDB.filter(v => !v.empanelled).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</optgroup>}
                      {idx === 0 && <option value="Others">Others (type custom)</option>}
                    </select>
                  </div>
                  <div><div style={S.label}>Shift</div><select value={f.shift || ""} onChange={e => updateShift(e.target.value)} style={{...S.select,width:"100%"}}><option value="">Select shift</option>{CLIENT_SHIFTS_DD.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                </div>
                {venueVal === "Others" && idx === 0 && (() => {
                  // Duplicate check: does the typed custom name match any known venue (case-insensitive, trimmed)?
                  // Known = inhouse + all outside (empanelled OR other) + any trVenues entry.
                  const typedLc = (clientVenueOther || "").trim().toLowerCase();
                  const matchName = !typedLc ? null : (
                    allInhouseVenues.find(v => v.toLowerCase() === typedLc) ||
                    (allOutdoorDB.find(v => (v.name || "").toLowerCase() === typedLc) || {}).name ||
                    (trVenues.find(v => (v.name || "").toLowerCase() === typedLc) || {}).name ||
                    null
                  );
                  return (
                  <>
                    <div style={{marginTop:10,marginBottom:matchName?6:12}}>
                      <div style={S.label}>Venue Name</div>
                      <input value={clientVenueOther} onChange={e => { setClientVenueOther(e.target.value); if (e.target.value) setVenue(e.target.value); }} onBlur={matchName ? undefined : autoPersistCustomVenue} placeholder="Enter venue name" style={{...S.input, ...(matchName ? {borderColor:"#EF4444"} : {})}}/>
                    </div>
                    {matchName && <div style={{marginBottom:12,padding:"8px 12px",borderRadius:8,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",fontSize:11,color:"#EF4444",display:"flex",gap:8,alignItems:"flex-start"}}>
                      <span style={{fontSize:13}}>⚠️</span>
                      <div>
                        <strong>"{matchName}"</strong> is already in your venue list — please select it from the dropdown above instead of typing.
                      </div>
                    </div>}
                    {/* Option C — Inline transport pricing. Hidden when typed name duplicates an existing venue (prevents ghost entries). */}
                    {!matchName && <div style={{marginTop:0,marginBottom:12,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(245,158,11,0.06)":"#FFFBF0",border:`1px solid ${isDark?"rgba(245,158,11,0.2)":"#FDE68A"}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#F59E0B",marginBottom:6}}>⚠️ New venue — estimate transport cost</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
                        <div>
                          <div style={{...S.label,fontSize:10}}>Est. trip rate (₹ per truck)</div>
                          <input type="number" min="0" value={customTripRate||""} onChange={e=>setCustomTripRate(Number(e.target.value)||0)} onBlur={autoPersistCustomVenue} placeholder="e.g. 5000" style={S.input}/>
                        </div>
                        <div>
                          <div style={{...S.label,fontSize:10}}>Gensets needed</div>
                          <input type="number" min="0" step="0.5" value={customGensets!==null?customGensets:""} onChange={e=>{const v=e.target.value;setCustomGensets(v===""?null:Number(v)||0);}} onBlur={autoPersistCustomVenue} placeholder="1" style={S.input}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:textS,marginTop:4,lineHeight:1.5}}>Used for transport + genset calculation on Build. Admin can refine these in Pricing → Transport later.</div>
                    </div>}
                  </>
                  );
                })()}
                <div style={{maxWidth:200}}><div style={S.label}>Pax (Guests)</div><input type="number" value={f.pax || ""} onChange={e => updatePax(e.target.value)} placeholder="e.g. 500" style={S.input}/></div>
                {/* §23 Phase 2.9c — Palette is now auto-set from selected video's YT tag, no Event Info dropdown */}
              </div>
            );
          })}

          <button onClick={() => {
            setExtraFunctions(prev => [...prev, { type: "", date: "", venue: venue || "", shift: "", pax: "" }]);
            setExpandedFnIdx(1 + extraFunctions.length);
          }} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1px dashed ${accent}60`,background:"transparent",color:accent,cursor:"pointer",fontSize:12,fontWeight:600,marginTop:4}}>+ Add Another Function</button>
        </div>
        {clientName&&<div style={{...S.card,marginTop:20,padding:"14px 18px"}}>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            <div style={{width:40,height:40,borderRadius:20,background:isDark?"rgba(255,255,255,0.06)":"#F5F0FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>👤</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span>{clientName}</span>
                {(() => {
                  const ac = clientLedger.find(c => c.id === activeClientId);
                  if (!ac || !ac.lmsLeadId) return null;
                  return <span style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:"rgba(34,197,94,0.15)",color:"#15803D"}} title={`LMS Lead #${ac.lmsLeadId} · Dept: ${ac.lmsDept} · Priority: ${ac.lmsPriority || "—"} · Status: ${ac.lmsStatus || "—"}`}>📥 LMS #{ac.lmsLeadId}</span>;
                })()}
              </div>
              <div style={{fontSize:11,color:textS,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                {clientPhone&&<span>📞 {clientPhone}</span>}
                {clientBrideGroom&&<span>💑 {clientBrideGroom}</span>}
                {(1 + extraFunctions.length) > 1 && <span style={{color:accent,fontWeight:600}}>🎉 {1 + extraFunctions.length} functions</span>}
              </div>
            </div>
          </div>
          {/* List each function as its own summary row */}
          {[0, ...extraFunctions.map((_, i) => i + 1)].map(idx => {
            const f = idx === 0
              ? { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax }
              : (extraFunctions[idx - 1] || {});
            if (!f.type && !f.date) return <div key={`pv-${idx}`} style={{fontSize:10,color:textS,marginTop:6,paddingLeft:54}}>🎉 Function {idx + 1} <span style={{opacity:0.6}}>(incomplete)</span></div>;
            return (
              <div key={`pv-${idx}`} style={{fontSize:11,color:textS,marginTop:6,paddingLeft:54,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span style={{color:textP,fontWeight:600}}>🎉 {f.type || "—"}</span>
                {f.date && <span>📅 {f.date}</span>}
                {f.shift && <span>🕐 {f.shift}</span>}
                {f.venue && f.venue !== "Others" && <span>📍 {f.venue}</span>}
                {f.venue === "Others" && clientVenueOther && idx === 0 && <span>📍 {clientVenueOther}</span>}
                {f.pax && <span>👥 {f.pax}</span>}
              </div>
            );
          })}
        </div>}
        {/* ═══ SESSION HISTORY — moved to the bottom, collapsed by default to reduce clutter. ═══ */}
        {activeClient && activeClient.sessions && activeClient.sessions.length > 0 && (() => {
          const sessions = activeClient.sessions;
          const visible = sessionHistoryExpanded ? sessions.slice(0, 20) : sessions.slice(0, 5);
          const timeAgo = (ts) => {
            const ms = Date.now() - ts;
            const min = Math.floor(ms / 60000);
            if (min < 1) return "just now";
            if (min < 60) return `${min}m ago`;
            const hr = Math.floor(min / 60);
            if (hr < 24) return `${hr}h ago`;
            const days = Math.floor(hr / 24);
            if (days < 30) return `${days}d ago`;
            return new Date(ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
          };
          const fmtDate = (d) => {
            if (!d) return "—";
            try { return new Date(d+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short"}); } catch { return d; }
          };
          return <div style={{marginTop:28,padding:"4px 14px 12px",borderRadius:10,background:isDark?"rgba(201,169,110,0.04)":"#FFFDF7",border:`1px solid ${isDark?"rgba(201,169,110,0.15)":"rgba(201,169,110,0.3)"}`}}>
            <div onClick={() => setSessionHistoryOpen(o => !o)} style={{padding:"8px 0",cursor:"pointer",fontSize:11,fontWeight:700,color:accent,display:"flex",alignItems:"center",gap:6,textTransform:"uppercase",letterSpacing:0.5}}>
              <span>📋</span>
              <span style={{flex:1}}>Session History — {sessions.length} meeting{sessions.length>1?"s":""}</span>
              <span style={{fontSize:10}}>{sessionHistoryOpen ? "▲ Hide" : "▼ Show"}</span>
            </div>
            {sessionHistoryOpen && <div style={{marginTop:6}}>
              {visible.map((s, si) => <div key={s.id || si} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span>{new Date(s.savedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
                    <span style={{color:textS,fontWeight:400,fontSize:10}}>({timeAgo(s.savedAt)})</span>
                    <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:`${accent}25`,color:accent}}>by {s.savedBy || "—"}</span>
                    {si === 0 && <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(16,185,129,0.15)",color:"#10B981"}}>LATEST</span>}
                  </div>
                  <div style={{fontSize:10,color:textS,marginTop:3}}>
                    {s.venue && <span>📍 {s.venue}</span>}
                    {s.eventDate && <span> · 📅 {fmtDate(s.eventDate)}</span>}
                    {s.fn && <span> · {s.fn}</span>}
                    {s.total && <span style={{color:textP,fontWeight:600}}> · {fmt(s.total)}</span>}
                    {s.tier && <span style={{color:textS}}> {s.tier}</span>}
                  </div>
                </div>
                <button onClick={() => {
                  if (!confirm(`Load session from ${new Date(s.savedAt).toLocaleString("en-IN")} by ${s.savedBy||"—"}?\n\nAny unsaved changes will be replaced.`)) return;
                  loadClientSession(activeClient, s, 0);
                }} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:accent,fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
              </div>)}
              {sessions.length > 5 && <button onClick={() => setSessionHistoryExpanded(!sessionHistoryExpanded)} style={{marginTop:4,padding:"4px 10px",fontSize:10,color:accent,background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>
                {sessionHistoryExpanded ? `↑ Show fewer (5)` : `↓ Show all ${sessions.length} sessions`}
              </button>}
            </div>}
          </div>;
        })()}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:24}}>
          <button onClick={()=>{
            doSaveClient();
            // Commit 3 hotfix — pre-seed Browse from Function 1 (the default active pill) only.
            // Previous Commit 2 polish pre-seeded ALL functions; that contradicts the new pill-is-write-target policy.
            // The sync useEffect handles subsequent pill switches.
            setActiveFnIdx(0);
            const startType = String(fn || "").trim();
            const startVenue = String(venue || "").trim();
            setFilterFn(startType ? [startType] : []);
            if (startVenue && startVenue !== "Others") {
              setBrowseVenues([startVenue]);
              if (allInhouseVenues.includes(startVenue)) setVenueGroup("inhouse");
              else if (allOutdoorDB.some(o => o.name === startVenue)) setVenueGroup("outside");
              else setVenueGroup("all");
            } else {
              setBrowseVenues([]);
            }
            setStep(1);
          }} style={{...S.btn(clientName.trim()&&clientPhone.trim()&&fn),fontSize:14,padding:"12px 32px",opacity:(clientName.trim()&&clientPhone.trim()&&fn)?1:0.5}}>Continue to Browse →</button>
        </div>
      </div>
    </div>
  );
}

import { Fragment } from "react";

export default function StudioBrowse({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS, fmt,
    accentBg, accentText, textP, cardBg,
    // auth / scope
    isAdmin, userVenueScope,
    // step
    setStep,
    // venue filters
    venueGroup, setVenueGroup, outsideSub, setOutsideSub, showMoreOutside, setShowMoreOutside,
    browseVenues, setBrowseVenues, toggleFilter,
    // event filters
    filterCat, setFilterCat, filterFn, setFilterFn, filterSpace, setFilterSpace,
    filterMood, setFilterMood, filterPalette, setFilterPalette,
    // taxonomy / palette
    taxonomy, imsPaletteCatalogue,
    // video modal / premia
    setVideoModal, setVideoPlaying, setPremiaGate,
    // multi-function
    extraFunctions, activeFnMeta, activeFnIdx, fnSnapHasData,
    // build / session
    sourceVideo, venue, showMsg,
    // names not in StudioApp ctx (see report) — referenced verbatim from reference body
    ytVideoTags, outdoorVenueList, browseVideos, allVideos, activeClient,
    pickAndLoadFromVideo, resumeSavedSession, allInhouseVenues, taxOr, FUNCTIONS, CATEGORIES, SHIFT_LETTER,
  } = ctx;

    // Smart video match: strict cascade — venue+fn > venue > fn > hardcoded fallback
    const getBestVideo = (ev) => {
      if (ev.video && !ev.video.includes("videoseries")) return ev.video; // already linked to specific video
      // tag.fn is multi-select (array) or legacy string; venue/tier are strings
      const fnMatch = (tag) => {
        if (!tag.fn || !ev.fn) return false;
        return Array.isArray(tag.fn) ? tag.fn.includes(ev.fn) : tag.fn === ev.fn;
      };
      const venueMatch = (tag) => tag.venue && ev.venue && tag.venue === ev.venue;
      const all = Object.entries(ytVideoTags);
      // Tier 1: venue + fn (best match)
      const t1 = all.filter(([, t]) => venueMatch(t) && fnMatch(t));
      if (t1.length > 0) return `https://www.youtube.com/embed/${t1[0][0]}`;
      // Tier 2: venue only
      const t2 = all.filter(([, t]) => venueMatch(t));
      if (t2.length > 0) return `https://www.youtube.com/embed/${t2[0][0]}`;
      // Tier 3: fn only
      const t3 = all.filter(([, t]) => fnMatch(t));
      if (t3.length > 0) return `https://www.youtube.com/embed/${t3[0][0]}`;
      return ev.video; // fallback to generic playlist
    };

    // ═══ VIDEO CARD — browse tile sourced from ytVideoTags ═══
    const VideoCard = ({v}) => {
      const isPlatinum = v.tierCat === "Platinum";
      const priceTBD = v.price === null || v.price === undefined;
      const tierColor = v.tierCat === "Platinum" ? {bg:"#EDE9FE",color:"#7C3AED"} : v.tierCat === "Gold" ? {bg:"#FFFBEB",color:"#D97706"} : {bg:"#ECFDF5",color:"#059669"};
      const videoUrl = `https://www.youtube.com/embed/${v.id}`;
      return (
        <div style={{...S.card,cursor:"default",display:"flex",flexDirection:"column"}}>
          <div style={{background:"#1a1a2e",height:150,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>{setVideoModal({name:v.title, video:videoUrl, venue:v.venue, fn:v.fn});setVideoPlaying(true);}}>
            <img src={v.thumbnail} alt={v.title} loading="lazy" style={{width:"100%",height:"100%",objectFit:"cover",position:"absolute",inset:0}} onError={e=>{e.target.style.display="none"}}/>
            <div style={{width:48,height:48,borderRadius:"50%",background:"rgba(255,255,255,0.25)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,position:"relative",zIndex:2}}>▶</div>
            {v.tierCat&&<div style={{position:"absolute",top:10,right:10,background:tierColor.bg,color:tierColor.color,padding:"3px 10px",borderRadius:10,fontSize:10,fontWeight:600,zIndex:3}}>{v.tierCat}</div>}
            <div style={{position:"absolute",bottom:10,left:10,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:600,zIndex:3}}>
              {priceTBD ? "Price TBD" : fmt(v.price)}
            </div>
          </div>
          <div style={{padding:"12px 14px",flex:1,display:"flex",flexDirection:"column"}}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.title}</div>
            <div style={{fontSize:11,color:textS,marginBottom:6}}>{[v.venue, v.fn, v.space].filter(Boolean).join(" · ") || "Untagged"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:10}}>{[...v.styles, ...v.colors].slice(0,3).map((t,i)=><span key={i} style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:accentBg,color:accentText}}>{t}</span>)}</div>
            {priceTBD&&<div style={{fontSize:10,color:"#D97706",marginBottom:8,padding:"4px 8px",background:"rgba(217,119,6,0.1)",borderRadius:6,border:"1px dashed rgba(217,119,6,0.3)"}}>⚠ Needs zone photos — customize to build</div>}
            <div style={{marginTop:"auto",display:"flex",gap:6}}>
              {isPlatinum?(
                <div onClick={(e)=>{e.stopPropagation();setPremiaGate({ev:{id:v.id,name:v.title,video:`https://www.youtube.com/embed/${v.id}`}});}} style={{width:"100%",padding:"8px 12px",borderRadius:8,background:"linear-gradient(135deg,#EDE9FE,#F5F3FF)",textAlign:"center",fontSize:11,color:"#7C3AED",fontWeight:600,cursor:"pointer"}}>{"👑"} Sr. Designer Only</div>
              ):(
                <Fragment>
                  <button onClick={(e)=>{e.stopPropagation();pickAndLoadFromVideo(v.id,1);}} style={{flex:1,padding:"8px 0",borderRadius:8,background:"linear-gradient(135deg,#C9A96E,#B8944F)",color:"#fff",border:"none",fontSize:11,fontWeight:700,cursor:"pointer"}}>{"🎨"} Customize</button>
                  {!priceTBD&&<button onClick={(e)=>{e.stopPropagation();pickAndLoadFromVideo(v.id,2);showMsg("✓ Exact look loaded — review summary","green");}} style={{flex:1,padding:"8px 0",borderRadius:8,border:`1.5px solid ${accentText}`,background:"transparent",color:accentText,fontSize:11,fontWeight:600,cursor:"pointer"}}>{"📋"} Exact Look</button>}
                </Fragment>
              )}
            </div>
          </div>
        </div>
      );
    };

    // ═══ UNIFIED BROWSE PAGE ═══
    const outsideVenuesVisible = (() => {
      let list = [...outdoorVenueList];
      if (outsideSub === "empanelled") list = list.filter(v => v.empanelled);
      else if (outsideSub === "other") list = list.filter(v => !v.empanelled);
      else list = [...list.filter(v => v.empanelled), ...list.filter(v => !v.empanelled)];
      return list;
    })();

    const maxOutsidePills = showMoreOutside ? 999 : 10;
    const overflowCount = Math.max(0, outsideVenuesVisible.length - maxOutsidePills);

    // Find a video for the hero player
    const heroEv = browseVideos[0] ? {name:browseVideos[0].title, video:`https://www.youtube.com/embed/${browseVideos[0].id}`} : null;

    // ═══ PILL-AWARE SESSION BANNER (24 May 2026) ═══
    // Each pill only shows sessions where THIS pill has actual data — so an untouched Fn2
    // won't show a misleading "Resume" button that loads Fn1's data. Sessions with fnSnapshots:
    // include if fnSnapshots[activeFnIdx] has real build data. Legacy sessions (no fnSnapshots):
    // only attach to Fn0. Dedup by session.id; show up to 3 most recent.
    const bannerSaved = (() => {
      if (!activeClient) return [];
      const allSessions = (activeClient.sessions || []).filter(s => {
        if (s.fnSnapshots && typeof s.fnSnapshots === "object" && Object.keys(s.fnSnapshots).length > 0) {
          const snap = s.fnSnapshots[activeFnIdx] || s.fnSnapshots[String(activeFnIdx)] || null;
          return fnSnapHasData(snap);
        }
        // Legacy session — no per-fn snapshots; the flat fields belong to Fn0 only.
        if (activeFnIdx !== 0) return false;
        return fnSnapHasData(s);
      });
      const seenIds = new Set();
      const out = [];
      for (const s of allSessions) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        out.push(s);
        if (out.length >= 3) break;
      }
      return out;
    })();
    const bannerCurrentId = sourceVideo?.id || null;
    // "Continue build" (vs "Resume") if the current pill's video matches one of the saved session's
    // snapshot for this pill. Walk fnSnapshots[activeFnIdx].sourceVideo.id, else legacy session.sourceVideoId.
    const bannerCurrentInSaved = bannerCurrentId ? bannerSaved.some(s => {
      const snapForPill = s.fnSnapshots?.[activeFnIdx];
      if (snapForPill?.sourceVideo?.id === bannerCurrentId) return true;
      return s.sourceVideoId === bannerCurrentId;
    }) : false;
    const bannerShowCurrent = !!bannerCurrentId && !bannerCurrentInSaved;
    const bannerFmtDate = (ts) => { try { return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); } catch { return ""; } };

    return (
      <div style={{...S.main,display:"flex",flexDirection:"column",gap:0}}>
        {/* ═══ COMMIT 3 — "Adding to" badge (only when multi-function) ═══ */}
        {extraFunctions.length > 0 && (() => {
          const m = activeFnMeta;
          const slotLetter = m.shift ? (SHIFT_LETTER[m.shift] || m.shift.charAt(0).toUpperCase()) : "";
          const dateLbl = m.date ? (() => { try { return new Date(m.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return m.date; } })() : "—";
          const label = `${m.type || "—"} · ${dateLbl}${slotLetter ? " " + slotLetter : ""}${m.venue ? " · " + m.venue : ""}`;
          return (
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",marginBottom:16,borderRadius:10,background:`${accent}15`,border:`1px solid ${accent}40`}}>
              <div style={{fontSize:10,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600}}>Active function</div>
              <div style={{fontSize:12,color:accentText,fontWeight:600}}>{label}</div>
            </div>
          );
        })()}
        <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>

        {/* ═══ SIDEBAR FILTERS ═══ */}
        {/* top is dynamic: +50 when Row 2 function pills are visible (multi-function event) to avoid overlap with sticky header */}
        <div style={{width:220,flexShrink:0,position:"sticky",top:extraFunctions.length>0?120:70}}>
          <div style={{...S.card,padding:"16px 18px"}}>
            <div style={{fontSize:15,fontWeight:700,color:textP,marginBottom:14}}>Filters</div>

            {/* Venue */}
            <div style={{borderBottom:`1px solid ${border}`,paddingBottom:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Venue</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {(userVenueScope==="all"||isAdmin)&&<div onClick={()=>{setVenueGroup("all");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}} style={S.pill(venueGroup==="all")}>All</div>}
                {(userVenueScope==="all"||userVenueScope==="inhouse"||isAdmin)&&<div onClick={()=>{setVenueGroup("inhouse");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}} style={S.pill(venueGroup==="inhouse")}>Inhouse</div>}
                {(userVenueScope==="all"||userVenueScope==="outside"||isAdmin)&&<div onClick={()=>{setVenueGroup("outside");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}} style={S.pill(venueGroup==="outside")}>Outside</div>}
              </div>
              {/* Sub-venue pills for Inhouse — multi-select */}
              {venueGroup==="inhouse"&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                {allInhouseVenues.map(v=>{const on=browseVenues.includes(v);return <div key={v} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v)} style={{...S.pill(on),background:on?`${accent}22`:"transparent",color:on?accentText:textS,border:on?`1px solid ${accent}55`:`1px solid ${border}`,fontSize:10,padding:"4px 10px"}}>{v}</div>;})}
                {browseVenues.length>0&&<div onClick={()=>setBrowseVenues([])} style={{padding:"4px 8px",borderRadius:12,fontSize:9,cursor:"pointer",color:textS,border:`1px dashed ${border}`}}>✕</div>}
              </div>}
              {/* Sub-group for Outside */}
              {venueGroup==="outside"&&<Fragment>
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                  <div onClick={()=>{setOutsideSub("all");setBrowseVenues([]);setShowMoreOutside(false);}} style={{...S.pill(outsideSub==="all"),fontSize:10,padding:"4px 10px"}}>All</div>
                  <div onClick={()=>{setOutsideSub("empanelled");setBrowseVenues([]);setShowMoreOutside(false);}} style={{...S.pill(outsideSub==="empanelled"),fontSize:10,padding:"4px 10px"}}>Empanelled</div>
                  <div onClick={()=>{setOutsideSub("other");setBrowseVenues([]);setShowMoreOutside(false);}} style={{...S.pill(outsideSub==="other"),fontSize:10,padding:"4px 10px"}}>Other</div>
                </div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                  {outsideVenuesVisible.slice(0,maxOutsidePills).map(v=>{const on=browseVenues.includes(v.name);return <div key={v.name} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v.name)} style={{...S.pill(on),background:on?`${accent}22`:"transparent",color:on?accentText:textS,border:on?`1px solid ${accent}55`:`1px solid ${border}`,fontSize:9,padding:"3px 8px"}}>{v.name}{v.empanelled?" ★":""}</div>;})}
                  {overflowCount>0&&!showMoreOutside&&<div onClick={()=>setShowMoreOutside(true)} style={{padding:"3px 8px",borderRadius:12,border:`1px dashed ${border}`,color:textS,fontSize:9,cursor:"pointer"}}>+{overflowCount}</div>}
                  {browseVenues.length>0&&<div onClick={()=>setBrowseVenues([])} style={{padding:"3px 8px",borderRadius:12,fontSize:9,cursor:"pointer",color:textS,border:`1px dashed ${border}`}}>✕</div>}
                </div>
              </Fragment>}
            </div>

            {/* Event type */}
            <div style={{borderBottom:`1px solid ${border}`,paddingBottom:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Event type</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <div onClick={()=>setFilterFn([])} style={{...S.pill(filterFn.length===0),fontSize:10,padding:"4px 10px"}}>All</div>
                {taxOr(taxonomy.eventType, FUNCTIONS).map(o=>{const on=filterFn.includes(o);return <div key={o} onClick={()=>toggleFilter(filterFn,setFilterFn,o)} style={{...S.pill(on),fontSize:10,padding:"4px 10px"}}>{o}</div>;})}
              </div>
            </div>

            {/* Tier */}
            <div style={{borderBottom:`1px solid ${border}`,paddingBottom:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Tier</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <div onClick={()=>setFilterCat([])} style={{...S.pill(filterCat.length===0),fontSize:10,padding:"4px 10px"}}>All</div>
                {taxOr(taxonomy.tier, CATEGORIES).map(o=>{const on=filterCat.includes(o);return <div key={o} onClick={()=>toggleFilter(filterCat,setFilterCat,o)} style={{...S.pill(on),fontSize:10,padding:"4px 10px"}}>{o}</div>;})}
              </div>
            </div>

            {/* Space */}
            <div style={{borderBottom:`1px solid ${border}`,paddingBottom:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Venue type</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <div onClick={()=>setFilterSpace([])} style={{...S.pill(filterSpace.length===0),fontSize:10,padding:"4px 10px"}}>All</div>
                {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(o=>{const on=filterSpace.includes(o);return <div key={o} onClick={()=>toggleFilter(filterSpace,setFilterSpace,o)} style={{...S.pill(on),fontSize:10,padding:"4px 10px"}}>{o}</div>;})}
              </div>
            </div>

            {/* Design Style */}
            <div style={{borderBottom:`1px solid ${border}`,paddingBottom:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Design Style</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <div onClick={()=>setFilterMood([])} style={{...S.pill(filterMood.length===0),fontSize:10,padding:"4px 10px"}}>All</div>
                {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(s=>{const on=filterMood.includes(s);return <div key={s} onClick={()=>toggleFilter(filterMood,setFilterMood,s)} style={{...S.pill(on),fontSize:10,padding:"4px 10px"}}>{s}</div>;})}
              </div>
            </div>

            {/* Palette */}
            <div>
              <div style={{fontSize:11,fontWeight:600,color:textS,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Palette</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <div onClick={()=>setFilterPalette([])} style={{...S.pill(filterPalette.length===0),fontSize:10,padding:"4px 10px"}}>All</div>
                {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : (imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]))).map(c=>{const on=filterPalette.includes(c);return <div key={c} onClick={()=>toggleFilter(filterPalette,setFilterPalette,c)} style={{...S.pill(on),fontSize:10,padding:"4px 10px"}}>{c}</div>;})}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ MAIN CONTENT — VIDEO CARDS ═══ */}
        <div style={{flex:1,minWidth:0}}>
          {/* Session banner — per-pill Resume/Continue entry points. Hidden entirely when pill has no saved sessions and no current selection. */}
          {(bannerSaved.length > 0 || bannerShowCurrent) && (
            <div style={{marginBottom:14,display:"flex",flexDirection:"column",gap:8}}>
              {bannerSaved.map(s => {
                const vid = allVideos.find(v => v.id === s.sourceVideoId);
                const isCurrent = bannerCurrentId === s.sourceVideoId;
                const videoTitle = s.sourceVideoTitle || vid?.title || "Video";
                const unavailable = !vid && !s.sourceVideoTitle;
                return (
                  <div key={s.sourceVideoId+"_"+s.savedAt} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,background:isDark?"rgba(234,179,8,0.08)":"rgba(234,179,8,0.07)",border:`1px solid ${isDark?"rgba(234,179,8,0.28)":"rgba(217,119,6,0.30)"}`}}>
                    <div style={{fontSize:14,flexShrink:0}}>{"💾"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {videoTitle}
                        {unavailable && <span style={{marginLeft:8,fontSize:10,color:textS,fontWeight:400}}>(no longer in library)</span>}
                        {isCurrent && <span style={{marginLeft:8,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"#10B981",letterSpacing:0.3}}>LIVE</span>}
                      </div>
                      <div style={{fontSize:10,color:textS,marginTop:2}}>
                        Saved {bannerFmtDate(s.savedAt)}{s.savedBy?` by ${s.savedBy}`:""}{typeof s.total==="number"?` · ${fmt(s.total)}`:""}{s.tier?` ${s.tier}`:""}
                      </div>
                    </div>
                    {!unavailable && <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${s.sourceVideoId}`,venue:s.venue||"",fn:s.fn||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[],tags:[]});setVideoPlaying(true);}} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${isDark?"rgba(234,179,8,0.5)":"#D97706"}`,background:"transparent",color:isDark?"#FBBF24":"#B45309",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{"▶"} Play</button>}
                    <button onClick={(e)=>{e.stopPropagation();if(isCurrent){setStep(2);}else{resumeSavedSession(s);}}} style={{padding:"5px 12px",borderRadius:6,border:"none",background:isDark?"#D97706":"#B45309",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      {isCurrent?"Continue":"Resume"} build {"→"}
                    </button>
                  </div>
                );
              })}
              {bannerShowCurrent && (() => {
                const vid = allVideos.find(v => v.id === bannerCurrentId);
                const videoTitle = sourceVideo?.title || vid?.title || "Video";
                return (
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,background:isDark?"rgba(99,102,241,0.10)":"rgba(99,102,241,0.06)",border:`1px solid ${isDark?"rgba(99,102,241,0.30)":"rgba(99,102,241,0.25)"}`}}>
                    <div style={{fontSize:14,flexShrink:0}}>{"🎨"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{videoTitle}</div>
                      <div style={{fontSize:10,color:textS,marginTop:2}}>Current selection — not yet saved</div>
                    </div>
                    <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${bannerCurrentId}`,venue:venue||"",fn:activeFnMeta.type||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#6366F1)",photos:[],tags:[]});setVideoPlaying(true);}} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${isDark?"rgba(99,102,241,0.5)":"#6366F1"}`,background:"transparent",color:isDark?"#A5B4FC":"#4338CA",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{"▶"} Play</button>
                    <button onClick={(e)=>{e.stopPropagation();setStep(2);}} style={{padding:"5px 12px",borderRadius:6,border:"none",background:isDark?"#4F46E5":"#4338CA",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      Continue build {"→"}
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
          <div style={{fontSize:12,color:textS,marginBottom:12}}>{browseVideos.length} video{browseVideos.length===1?"":"s"}{browseVenues.length>0?` at ${browseVenues.join(", ")}`:venueGroup!=="all"?` (${venueGroup})`:""}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            {browseVideos.map(v=><VideoCard key={v.id} v={v}/>)}
          </div>
          {browseVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textS,background:cardBg,borderRadius:14,border:`1px dashed ${border}`}}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>No videos match these filters</div>
            <div style={{fontSize:12,marginBottom:12}}>Try changing filters, or tag more videos in Manage → Library</div>
          </div>}
          <div style={{textAlign:"center",marginTop:30,padding:24,background:cardBg,borderRadius:14,border:`1px dashed ${border}`}}>
            <button onClick={()=>setStep(2)} style={S.btn(true)}>Build Decor →</button>
          </div>
        </div>
        </div>
      </div>
    );
}

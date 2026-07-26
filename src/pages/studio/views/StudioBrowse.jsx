import { Fragment, useState } from "react";
import { makeFilterUI } from "../../../components/studio/filterUI.jsx";
import { IconCheck, IconChevron, IconSparkle, IconCrown, IconSave, IconAlert, IconPlay,
  IconPalette, IconClipboard } from "../../../components/icons.jsx";

export default function StudioBrowse({ ctx }) {
  // Which filter sections are expanded. All closed by default: six open sections made the panel
  // taller than the viewport, which is what buried Palette. Closed headers still show what's
  // selected, so nothing is hidden — you just don't scroll past options you aren't changing.
  const [openSections, setOpenSections] = useState({});
  const toggleSection = (k) => setOpenSections(p => ({ ...p, [k]: !p[k] }));
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

    // Resting elevation for the video tiles. Declared above VideoCard so it can't repeat the
    // use-before-init bug that bit the Event Info form. S.card ships with a border and no shadow,
    // so tiles sat flat on the page — this gives them a contact line plus a soft cast.
    const tileShadow = isDark
      ? "0 1px 2px rgba(0,0,0,0.45), 0 10px 26px -12px rgba(0,0,0,0.6)"
      : "0 1px 2px rgba(26,26,46,0.06), 0 10px 26px -12px rgba(26,26,46,0.22)";

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
        <div className="sb-card" style={{...S.card,cursor:"default",display:"flex",flexDirection:"column",boxShadow:tileShadow}}>
          <div style={{background:"#1a1a2e",height:150,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>{setVideoModal({name:v.title, video:videoUrl, venue:v.venue, fn:v.fn});setVideoPlaying(true);}}>
            <img className="sb-thumb" src={v.thumbnail} alt={v.title} loading="lazy" style={{width:"100%",height:"100%",objectFit:"cover",position:"absolute",inset:0}} onError={e=>{e.target.style.display="none"}}/>
            <div className="sb-play" style={{width:48,height:48,borderRadius:"50%",background:"rgba(255,255,255,0.25)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",position:"relative",zIndex:2}}><IconPlay size={20}/></div>
            {v.tierCat&&<div style={{position:"absolute",top:10,right:10,background:tierColor.bg,color:tierColor.color,padding:"3px 10px",borderRadius:10,fontSize:10,fontWeight:600,zIndex:3}}>{v.tierCat}</div>}
            {v.aiTagged&&<div title={v.savedBy?`Tagged by AI · saved by ${v.savedBy}`:"Tagged by AI"} style={{position:"absolute",top:10,left:10,background:"rgba(124,58,237,0.9)",color:"#fff",padding:"3px 8px",borderRadius:10,fontSize:9,fontWeight:700,zIndex:3,display:"inline-flex",alignItems:"center",gap:4}}><IconSparkle size={10}/>AI</div>}
            <div style={{position:"absolute",bottom:10,left:10,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:600,zIndex:3}}>
              {priceTBD ? "Price TBD" : fmt(v.price)}
            </div>
          </div>
          <div style={{padding:"12px 14px",flex:1,display:"flex",flexDirection:"column"}}>
            <div className="sb-title" style={{fontSize:14,fontWeight:600,marginBottom:3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.title}</div>
            <div style={{fontSize:11,color:textS,marginBottom:6}}>{[v.venue, v.fn, v.space].filter(Boolean).join(" · ") || "Untagged"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:10}}>{[...v.styles, ...v.colors].slice(0,3).map((t,i)=><span key={i} style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:accentBg,color:accentText}}>{t}</span>)}</div>
            {priceTBD&&<div style={{fontSize:10,color:"#D97706",marginBottom:8,padding:"4px 8px",background:"rgba(217,119,6,0.1)",borderRadius:6,border:"1px dashed rgba(217,119,6,0.3)",display:"flex",alignItems:"center",gap:5}}><IconAlert size={11}/>Needs zone photos — customize to build</div>}
            <div style={{marginTop:"auto",display:"flex",gap:6}}>
              {isPlatinum?(
                <div onClick={(e)=>{e.stopPropagation();setPremiaGate({ev:{id:v.id,name:v.title,video:`https://www.youtube.com/embed/${v.id}`}});}} className="sb-gate" style={{width:"100%",padding:"8px 12px",borderRadius:8,background:"linear-gradient(135deg,#EDE9FE,#F5F3FF)",textAlign:"center",fontSize:11,color:"#7C3AED",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><IconCrown size={13}/>Sr. Designer Only</div>
              ):(
                <Fragment>
                  <button className="sb-cta" onClick={(e)=>{e.stopPropagation();pickAndLoadFromVideo(v.id,1);}} style={{flex:1,padding:"8px 0",borderRadius:8,background:"linear-gradient(135deg,#C9A96E,#B8944F)",color:"#fff",border:"none",fontSize:11,fontWeight:700,cursor:"pointer"}}>Customize</button>
                  {!priceTBD&&<button className="sb-alt" onClick={(e)=>{e.stopPropagation();pickAndLoadFromVideo(v.id,2);showMsg("✓ Exact look loaded — review summary","green");}} style={{flex:1,padding:"8px 0",borderRadius:8,border:`1.5px solid ${accentText}`,background:"transparent",color:accentText,fontSize:11,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6}}><IconClipboard size={13}/>Exact Look</button>}
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

    // ═══ FILTER PANEL PRESENTATION ═══
    // Now sourced from components/studio/filterUI.jsx so Browse and Build share one panel
    // implementation and cannot drift apart. Emits identical markup to the previous inline copy.
    const { hairline, gold, textM, ghostPill, Pill, Section: FSection, css: filterCSS } = makeFilterUI({ isDark, accent, textP, S });

    // How many filters each section is applying — surfaced as a count chip on the section header
    // so you can tell at a glance which groups are narrowing the results.
    const venueGroupActive = venueGroup !== "all" ? 1 : 0;
    const sectionCounts = {
      venue: venueGroupActive + browseVenues.length,
      fn: filterFn.length, tier: filterCat.length, space: filterSpace.length,
      mood: filterMood.length, palette: filterPalette.length,
    };
    const activeTotal = Object.values(sectionCounts).reduce((a, b) => a + b, 0);

    const clearAllFilters = () => {
      setVenueGroup("all"); setBrowseVenues([]); setOutsideSub("all"); setShowMoreOutside(false);
      setFilterFn([]); setFilterCat([]); setFilterSpace([]); setFilterMood([]); setFilterPalette([]);
    };

    // Section shell — a collapsible dropdown. Header is a real <button> with aria-expanded so
    // keyboard and screen-reader users get the disclosure semantics, not just a clickable div.
    const Section = ({ id, label, count, summary, last, children }) => {
      const open = !!openSections[id];
      return (
        <div style={{ paddingBottom: last ? 0 : 11, marginBottom: last ? 0 : 11,
          borderBottom: last ? "none" : `1px solid ${hairline}` }}>
          <button type="button" className="sb-head" onClick={() => toggleSection(id)}
            aria-expanded={open} aria-controls={`sb-sec-${id}`}
            style={{width:"100%",display:"flex",alignItems:"center",gap:7,padding:"5px 6px",margin:"0 -6px",
              border:"none",background:"transparent",borderRadius:8,cursor:"pointer",textAlign:"left"}}>
            <span style={{width:4,height:4,borderRadius:"50%",flexShrink:0,
              background: count ? accent : (isDark ? "rgba(255,255,255,0.18)" : "rgba(26,26,46,0.16)")}}/>
            <span style={{fontSize:10,fontWeight:700,color:count?gold:textM,textTransform:"uppercase",letterSpacing:0.9,flexShrink:0}}>{label}</span>
            {/* Selection summary — only while collapsed, so the open state stays uncluttered. */}
            {!open && <span style={{fontSize:10,color:count?textP:textM,fontWeight:count?600:400,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{summary}</span>}
            {count > 0 && <span style={{marginLeft:"auto",flexShrink:0,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:5,
              background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{count}</span>}
            <span style={{marginLeft:count>0?0:"auto",flexShrink:0,display:"flex",color:textM,
              transform:open?"rotate(180deg)":"none",transition:"transform 0.18s ease"}}><IconChevron size={13}/></span>
          </button>
          {open && <div id={`sb-sec-${id}`} style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:9}}>{children}</div>}
        </div>
      );
    };

    // filterCSS already opens with a newline — no extra one here, so the emitted stylesheet is
    // byte-identical to the pre-refactor output.
    const browseCSS = `${filterCSS}/* ═══ VIDEO TILES ═══ The whole card responds as one object: it lifts, the thumbnail pushes in,
   and the play target grows — so it's obvious the tile (not just the button) is interactive.
   S.card already clips overflow, so the zoomed thumbnail stays inside the rounded corners. */
.sb-card{transition:transform .2s ease, box-shadow .24s ease, border-color .24s ease}
.sb-card:hover{transform:translateY(-6px);border-color:${accent} !important;
  box-shadow:${isDark
    ? "0 2px 4px rgba(0,0,0,0.5), 0 18px 34px -12px rgba(0,0,0,0.72), 0 40px 64px -28px rgba(0,0,0,0.6)"
    : "0 2px 4px rgba(26,26,46,0.08), 0 18px 34px -12px rgba(26,26,46,0.32), 0 40px 64px -28px rgba(26,26,46,0.3)"} !important}
.sb-thumb{transition:transform .4s ease}
.sb-card:hover .sb-thumb{transform:scale(1.09)}
.sb-play{transition:transform .22s ease, background .22s ease, box-shadow .22s ease}
.sb-card:hover .sb-play{transform:scale(1.16);background:rgba(255,255,255,0.5) !important;
  box-shadow:0 6px 18px rgba(0,0,0,0.35)}
.sb-card:hover .sb-title{color:${gold}}
.sb-title{transition:color .18s ease}
/* Actions had no hover at all — the primary now brightens and casts, the outline fills. */
.sb-cta,.sb-alt,.sb-gate{transition:filter .16s ease, background .16s ease, box-shadow .18s ease, transform .14s ease}
.sb-cta:hover{filter:brightness(1.09);box-shadow:0 8px 18px -7px rgba(201,169,110,0.95) !important;transform:translateY(-1px)}
.sb-alt:hover{background:${isDark?"rgba(201,169,110,0.14)":"#F6E7C8"} !important;transform:translateY(-1px)}
.sb-gate:hover{filter:brightness(0.97);box-shadow:0 8px 18px -8px rgba(124,58,237,0.5) !important}
.sb-cta:active,.sb-alt:active{transform:translateY(0) scale(0.98)}
@media (prefers-reduced-motion: reduce){
  .sb-pill,.sb-head,.sb-card,.sb-thumb,.sb-play,.sb-title,.sb-cta,.sb-alt,.sb-gate{transition:none}
  .sb-pill:hover,.sb-card:hover,.sb-cta:hover,.sb-alt:hover{transform:none}
  .sb-card:hover .sb-thumb,.sb-card:hover .sb-play{transform:none}
  .sb-head span[style*="rotate"]{transition:none}}
`;

    return (
      // maxWidth was S.main's 1200, which left ~350px of dead gutter either side on a desktop
      // monitor and pushed the filter panel far off the left edge. Wider cap + a roomier sidebar.
      <div style={{...S.main,maxWidth:1800,display:"flex",flexDirection:"column",gap:0}}>
        <style>{browseCSS}</style>
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
        {/* Natural height — no inner scroll. Capping the panel meant Palette sat inside a hidden
            scroll area, and the cue that fixed that covered the last rows of pills. Every section
            is simply visible, and the page scroll reaches them. */}
        <div style={{width:248,flexShrink:0,position:"sticky",top:extraFunctions.length>0?120:70,alignSelf:"flex-start"}}>
          <div style={{...S.card,padding:0}}>
            {/* Panel header — total active count + one-click reset. Sticks to the panel top so it
                stays visible while the sections below scroll. */}
            <div style={{position:"sticky",top:0,zIndex:1,display:"flex",alignItems:"center",gap:8,
              padding:"13px 16px",borderBottom:`1px solid ${hairline}`,
              background:isDark?"#1A1A2E":"linear-gradient(180deg,#FEFCF8,#fff)"}}>
              <div style={{fontSize:13.5,fontWeight:700,color:textP,letterSpacing:-0.1}}>Filters</div>
              {activeTotal > 0 && <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,
                background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{activeTotal}</span>}
              {activeTotal > 0 && <div className="sb-pill sb-ghost" onClick={clearAllFilters} title="Reset every filter"
                style={{...ghostPill,marginLeft:"auto"}}>Clear all</div>}
            </div>
            <div style={{padding:"14px 16px 16px"}}>

            {/* Venue */}
            <FSection open={!!openSections["venue"]} onToggle={()=>toggleSection("venue")} id="venue" label="Venue" count={sectionCounts.venue}>
                {(userVenueScope==="all"||isAdmin)&&<Pill on={venueGroup==="all"} onClick={()=>{setVenueGroup("all");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}}>All</Pill>}
                {(userVenueScope==="all"||userVenueScope==="inhouse"||isAdmin)&&<Pill on={venueGroup==="inhouse"} onClick={()=>{setVenueGroup("inhouse");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}}>Inhouse</Pill>}
                {(userVenueScope==="all"||userVenueScope==="outside"||isAdmin)&&<Pill on={venueGroup==="outside"} onClick={()=>{setVenueGroup("outside");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);}}>Outside</Pill>}
              {/* Sub-venue pills for Inhouse — multi-select. Indented + ruled so it's obvious they
                  narrow the group above rather than being a seventh top-level filter. */}
              {venueGroup==="inhouse"&&<div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:8,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                {allInhouseVenues.map(v=>{const on=browseVenues.includes(v);return <Pill key={v} on={on} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v)}>{v}</Pill>;})}
                {browseVenues.length>0&&<div className="sb-pill sb-ghost" onClick={()=>setBrowseVenues([])} title="Clear selected venues" style={ghostPill}>✕</div>}
              </div>}
              {/* Sub-group for Outside */}
              {venueGroup==="outside"&&<Fragment>
                <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:8,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                  <Pill on={outsideSub==="all"} onClick={()=>{setOutsideSub("all");setBrowseVenues([]);setShowMoreOutside(false);}}>All</Pill>
                  <Pill on={outsideSub==="empanelled"} onClick={()=>{setOutsideSub("empanelled");setBrowseVenues([]);setShowMoreOutside(false);}}>Empanelled</Pill>
                  <Pill on={outsideSub==="other"} onClick={()=>{setOutsideSub("other");setBrowseVenues([]);setShowMoreOutside(false);}}>Other</Pill>
                </div>
                <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:6,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                  {outsideVenuesVisible.slice(0,maxOutsidePills).map(v=>{const on=browseVenues.includes(v.name);return <Pill key={v.name} on={on} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v.name)} title={v.empanelled?"Empanelled venue":undefined}>{v.name}{v.empanelled?" ★":""}</Pill>;})}
                  {overflowCount>0&&!showMoreOutside&&<div className="sb-pill sb-ghost" onClick={()=>setShowMoreOutside(true)} title={`Show ${overflowCount} more venues`} style={ghostPill}>+{overflowCount} more</div>}
                  {browseVenues.length>0&&<div className="sb-pill sb-ghost" onClick={()=>setBrowseVenues([])} title="Clear selected venues" style={ghostPill}>✕</div>}
                </div>
              </Fragment>}
            </FSection>

            {/* Event type */}
            <FSection open={!!openSections["fn"]} onToggle={()=>toggleSection("fn")} id="fn" label="Event type" count={sectionCounts.fn}>
              <Pill on={filterFn.length===0} onClick={()=>setFilterFn([])}>All</Pill>
              {taxOr(taxonomy.eventType, FUNCTIONS).map(o=>{const on=filterFn.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterFn,setFilterFn,o)}>{o}</Pill>;})}
            </FSection>

            {/* Tier */}
            <FSection open={!!openSections["tier"]} onToggle={()=>toggleSection("tier")} id="tier" label="Tier" count={sectionCounts.tier}>
              <Pill on={filterCat.length===0} onClick={()=>setFilterCat([])}>All</Pill>
              {taxOr(taxonomy.tier, CATEGORIES).map(o=>{const on=filterCat.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterCat,setFilterCat,o)}>{o}</Pill>;})}
            </FSection>

            {/* Space */}
            <FSection open={!!openSections["space"]} onToggle={()=>toggleSection("space")} id="space" label="Venue type" count={sectionCounts.space}>
              <Pill on={filterSpace.length===0} onClick={()=>setFilterSpace([])}>All</Pill>
              {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(o=>{const on=filterSpace.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterSpace,setFilterSpace,o)}>{o}</Pill>;})}
            </FSection>

            {/* Design Style */}
            <FSection open={!!openSections["mood"]} onToggle={()=>toggleSection("mood")} id="mood" label="Design Style" count={sectionCounts.mood}>
              <Pill on={filterMood.length===0} onClick={()=>setFilterMood([])}>All</Pill>
              {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(s=>{const on=filterMood.includes(s);return <Pill key={s} on={on} onClick={()=>toggleFilter(filterMood,setFilterMood,s)}>{s}</Pill>;})}
            </FSection>

            {/* Palette */}
            <FSection open={!!openSections["palette"]} onToggle={()=>toggleSection("palette")} id="palette" label="Palette" count={sectionCounts.palette} cols={1} last>
              <Pill on={filterPalette.length===0} onClick={()=>setFilterPalette([])}>All</Pill>
              {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : (imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]))).map(c=>{const on=filterPalette.includes(c);return <Pill key={c} on={on} align="start" onClick={()=>toggleFilter(filterPalette,setFilterPalette,c)}>{c}</Pill>;})}
            </FSection>
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
                    <div style={{flexShrink:0,display:"flex",color:"#B45309"}}><IconSave size={15}/></div>
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
                    {!unavailable && <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${s.sourceVideoId}`,venue:s.venue||"",fn:s.fn||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[],tags:[]});setVideoPlaying(true);}} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${isDark?"rgba(234,179,8,0.5)":"#D97706"}`,background:"transparent",color:isDark?"#FBBF24":"#B45309",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,display:"inline-flex",alignItems:"center",gap:5}}><IconPlay size={11}/>Play</button>}
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
                    <div style={{flexShrink:0,display:"flex",color:"#B45309"}}><IconPalette size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{videoTitle}</div>
                      <div style={{fontSize:10,color:textS,marginTop:2}}>Current selection — not yet saved</div>
                    </div>
                    <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${bannerCurrentId}`,venue:venue||"",fn:activeFnMeta.type||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#6366F1)",photos:[],tags:[]});setVideoPlaying(true);}} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${isDark?"rgba(99,102,241,0.5)":"#6366F1"}`,background:"transparent",color:isDark?"#A5B4FC":"#4338CA",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,display:"inline-flex",alignItems:"center",gap:5}}><IconPlay size={11}/>Play</button>
                    <button onClick={(e)=>{e.stopPropagation();setStep(2);}} style={{padding:"5px 12px",borderRadius:6,border:"none",background:isDark?"#4F46E5":"#4338CA",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      Continue build {"→"}
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
          <div style={{display:"flex",alignItems:"baseline",gap:9,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{fontSize:13,fontWeight:600,color:textP}}>{browseVideos.length} video{browseVideos.length===1?"":"s"}</div>
            <div style={{fontSize:12,color:textM}}>{browseVenues.length>0?`at ${browseVenues.join(", ")}`:venueGroup!=="all"?`(${venueGroup})`:""}</div>
            {activeTotal>0&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:textM}}>{activeTotal} filter{activeTotal===1?"":"s"} applied</span>
              <div className="sb-pill sb-ghost" onClick={clearAllFilters} style={ghostPill}>Clear all</div>
            </div>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            {browseVideos.map(v=><VideoCard key={v.id} v={v}/>)}
          </div>
          {browseVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textM,background:cardBg,borderRadius:14,border:`1px dashed ${border}`}}>
            <div style={{fontSize:14,fontWeight:600,color:textP,marginBottom:4}}>No videos match these filters</div>
            <div style={{fontSize:12,marginBottom:activeTotal>0?14:12}}>Try changing filters, or tag more videos in Manage → Library</div>
            {/* The dead end is almost always a filter left on in a section scrolled out of view —
                so offer the reset right where the user hits it. */}
            {activeTotal>0&&<button className="sb-pill sb-ghost" onClick={clearAllFilters}
              style={{...ghostPill,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",fontSize:11.5,borderStyle:"solid",borderColor:accent,color:gold,background:isDark?"transparent":"#FFFCF4"}}>
              Clear all {activeTotal} filter{activeTotal===1?"":"s"}
            </button>}
          </div>}
          {/* No "Build Decor" hand-off here — Build is entered per-video via Customize / Exact Look,
              or via Resume/Continue on the session banner above. */}
        </div>
        </div>
      </div>
    );
}

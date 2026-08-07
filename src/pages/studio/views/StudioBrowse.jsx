import { Fragment, useState, useRef } from "react";
import { makeFilterUI, useRailMaxHeight } from "../../../components/studio/filterUI.jsx";
import { IconCheck, IconChevron, IconCrown, IconSave, IconPlay,
  IconPalette, IconClipboard, IconSearch } from "../../../components/icons.jsx";
import { paletteNames } from "../../../lib/studio/colours";
import { venueTypeLabel } from "../../../lib/studio/taxonomy";
import { paletteSearch, paletteMatches } from "../../../components/studio/filterUI.jsx";

export default function StudioBrowse({ ctx }) {
  // Which filter sections are expanded. All closed by default: six open sections made the panel
  // taller than the viewport, which is what buried Palette. Closed headers still show what's
  // selected, so nothing is hidden — you just don't scroll past options you aren't changing.
  const [openSections, setOpenSections] = useState({});
  const toggleSection = (k) => setOpenSections(p => ({ ...p, [k]: !p[k] }));
  const [vq, setVq] = useState("");
  // Venue pill search + the Inhouse "see all" toggle. Both are pure UI, so they live here rather
  // than in the shared ctx — nothing else needs to read them. `showMoreOutside` is the pre-existing
  // ctx twin for the Outside list.
  const [venueQ, setVenueQ] = useState("");
  const [showMoreInhouse, setShowMoreInhouse] = useState(false);
  // Palette runs to 33 entries at one per row, so it's capped until asked for — same treatment the
  // inhouse venue list gets.
  const [showMorePalette, setShowMorePalette] = useState(false);
  // Video id currently open in the "Fix taxonomy" modal (salesperson-facing correction,
  // separate from Manage's full tag editor) — null when closed.
  const [taxFixVid, setTaxFixVid] = useState(null);
  // 2-level Venue picker toggle state (Inhouse/Outside + outside sub-filter) — mirrors Manage
  // Library's own tagVenueGroup/tagOutsideSub, kept local here since this modal is self-contained.
  const [taxVenueGroup, setTaxVenueGroup] = useState("");
  const [taxOutsideSub, setTaxOutsideSub] = useState("all");
  // Palette filter search. Lives here rather than inside the Section so it survives the panel's
  // re-renders — the section subtree is rebuilt on every filter change.
  const [paletteQ, setPaletteQ] = useState("");
  const {
    // theme / chrome
    S, isDark, accent, border, textS, fmt,
    accentText, textP, cardBg,
    // auth / scope
    isAdmin, userVenueScope, authUser,
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
    ytVideoTags, saveYtTags, outdoorVenueList, browseVideos, allVideos, activeClient,
    subVenuesOfParent, allInhouseVenueOrParentNames, leafInhouseVenues,
    pickAndLoadFromVideo, resumeSavedSession, allInhouseVenues, taxOr, FUNCTIONS, CATEGORIES,
    clientLedger, loadClientSession,
  } = ctx;
  // The sticky offset clears the header, plus the function tab strip when there is more than one
  // function. The rail's height is measured rather than derived from it — see useRailMaxHeight.
  const railTop = extraFunctions.length > 0 ? 120 : 70;
  const railRef = useRef(null);
  const railMaxH = useRailMaxHeight(railRef, railTop);
  // Search narrows what the filters already produced, so the two compose instead of competing.
  // Token-AND over the fields a card actually shows, so word order does not matter.
  const shownVideos = (() => {
    const tokens = vq.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return browseVideos;
    return browseVideos.filter((v) => {
      const hay = [v.title, v.venue, v.fn, ...(v.fns || []), v.space, v.tier, ...(v.styles || []), ...(v.colors || [])]
        .filter(Boolean).join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  })();

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
            {/* Fix tags takes the corner the AI badge used to hold. Below the fold it had a row to
                itself holding one small control, which was mostly empty space; up here it costs
                nothing. Dark translucent pill so it stays legible over any thumbnail, and it stops
                propagation so it never opens the video. */}
            <button className="sb-fix" onClick={(e)=>{e.stopPropagation();setTaxVenueGroup("");setTaxOutsideSub("all");setTaxFixVid(v.id);}}
              title="This video is tagged wrong? Fix its taxonomy"
              style={{position:"absolute",top:10,left:10,zIndex:3,padding:"3px 9px",borderRadius:10,
                border:"1px solid rgba(255,255,255,0.35)",background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)",
                color:"#fff",fontSize:9.5,fontWeight:600,cursor:"pointer",lineHeight:1.5}}>Fix tags</button>
            <div style={{position:"absolute",bottom:10,left:10,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:600,zIndex:3}}>
              {priceTBD ? "Price TBD" : fmt(v.price)}
            </div>
          </div>
          <div style={{padding:"12px 14px",flex:1,display:"flex",flexDirection:"column"}}>
            <div className="sb-title" style={{fontSize:14,fontWeight:600,marginBottom:3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.title}</div>
            <div style={{fontSize:11,color:textS,marginBottom:6}}>{[v.venue, v.fn, v.space].filter(Boolean).join(" · ") || "Untagged"}</div>
            {/* The style/palette chips and the "needs zone photos" strip both came off the card —
                three stacked rows of metadata between the title and the buttons made the grid read
                as dense text rather than as pictures. The tags are still on the video (and still
                filterable from the rail); the unpriced state still shows as the "Price TBD" badge
                on the thumbnail, and Fix tags moved up onto the thumbnail with it. */}
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
    // Filter chips read best alphabetised. azSort for plain string lists; byName for {name} objects.
    const azSort = (arr) => [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)));
    // Sorts by what the pill SHOWS, not the stored value — needed wherever a label differs from its
    // value (venueTypeLabel), or "Both" sorts to the front while reading "Indoor + Outdoor".
    const azSortBy = (arr, label) => [...(arr || [])].sort((a, b) => String(label(a)).localeCompare(String(label(b))));
    const byName = (arr) => [...(arr || [])].sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
    const outsideVenuesVisible = (() => {
      let list = [...outdoorVenueList];
      // Empanelled (★) still lead the list; within each group the venues are A–Z.
      if (outsideSub === "empanelled") list = byName(list.filter(v => v.empanelled));
      else if (outsideSub === "other") list = byName(list.filter(v => !v.empanelled));
      else list = [...byName(list.filter(v => v.empanelled)), ...byName(list.filter(v => !v.empanelled))];
      // Same smart matcher the Build rail uses (token match, ranked exact → prefix → word → rest).
      // It works on strings, so rank the names and map them back to their {name,empanelled} objects.
      if (venueQ.trim()) {
        const objByName = new Map(list.map(v => [v.name, v]));
        list = paletteSearch(list.map(v => v.name), venueQ).map(n => objByName.get(n)).filter(Boolean);
      }
      return list;
    })();
    const inhouseVenuesVisible = venueQ.trim()
      ? paletteSearch(azSort(allInhouseVenues), venueQ)
      : azSort(allInhouseVenues);

    // A search decides what shows on its own, so it lifts either cap.
    const maxOutsidePills = (showMoreOutside || venueQ.trim()) ? 999 : 10;
    const overflowCount = Math.max(0, outsideVenuesVisible.length - maxOutsidePills);
    const maxInhousePills = (showMoreInhouse || venueQ.trim()) ? 999 : 9;
    const inhouseOverflow = Math.max(0, inhouseVenuesVisible.length - maxInhousePills);
    // A venue you have already picked must stay on screen even when the search or the cap would
    // drop it — otherwise it filters the results from somewhere you cannot see or unclick.
    const withSelected = (slice, pool) => [...slice, ...browseVenues.filter(v => pool.includes(v) && !slice.includes(v))];

    // Find a video for the hero player
    const heroEv = browseVideos[0] ? {name:browseVideos[0].title, video:`https://www.youtube.com/embed/${browseVideos[0].id}`} : null;

    // ═══ PILL-AWARE SESSION BANNER (24 May 2026) ═══
    // Each pill only shows sessions where THIS pill has actual data — so an untouched Fn2
    // won't show a misleading "Resume" button that loads Fn1's data. Sessions with fnSnapshots:
    // include if fnSnapshots[activeFnIdx] has real build data. Legacy sessions (no fnSnapshots):
    // only attach to Fn0. Dedup by session.id; show up to 3 most recent.
    // Sessions are listed on EVERY pill, tagged with the function they actually hold. They used to
    // be filtered to the active pill only — which sounds right, but in practice every session ever
    // saved has fnSnapshots {"0"} and nothing else, so switching to Fn2 made the whole banner
    // vanish and there was no way to reach the saved build at all. Now the row stays and says
    // "Fn1", and Resume jumps to that function instead of blanking the pill you're standing on.
    const bannerSaved = (() => {
      if (!activeClient) return [];
      const withFn = [];
      for (const s of (activeClient.sessions || [])) {
        const snaps = (s.fnSnapshots && typeof s.fnSnapshots === "object") ? s.fnSnapshots : null;
        let fnIdx = null;
        if (snaps && Object.keys(snaps).length > 0) {
          // Prefer the pill you're on; otherwise the lowest-numbered one that has real data.
          if (fnSnapHasData(snaps[activeFnIdx] || snaps[String(activeFnIdx)] || null)) fnIdx = activeFnIdx;
          else {
            const idxs = Object.keys(snaps).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
            for (const i of idxs) { if (fnSnapHasData(snaps[i] || snaps[String(i)] || null)) { fnIdx = i; break; } }
          }
        } else if (fnSnapHasData(s)) {
          fnIdx = 0;   // legacy session — flat fields, they belong to Fn1
        }
        if (fnIdx !== null) withFn.push({ ...s, _fnIdx: fnIdx });
      }
      const seenIds = new Set();
      const out = [];
      for (const s of withFn) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        out.push(s);
        if (out.length >= 3) break;
      }
      return out;
    })();
    // ═══ RECENT BUILDS (across clients) ═══
    // Continuing from Event Info mints a brand-new client with `sessions: []` whenever no client is
    // already active, so a fresh flow lands on Browse with an empty banner and no route back into
    // anything built earlier — the saved work belongs to the previous client record, not this one.
    // Shown only when the active client has nothing of its own, so it never competes with the
    // client's own sessions above.
    const recentBuilds = (() => {
      if (bannerSaved.length > 0) return [];
      const out = [];
      for (const c of (clientLedger || [])) {
        for (const s of (c.sessions || [])) {
          if (!fnSnapHasData(s.fnSnapshots?.[0] || s.fnSnapshots?.["0"] || s)) continue;
          out.push({ client: c, session: s, savedAt: s.savedAt || 0 });
        }
      }
      out.sort((a, b) => b.savedAt - a.savedAt);
      return out.slice(0, 3);
    })();

    const bannerCurrentId = sourceVideo?.id || null;
    // "Continue build" (vs "Resume") if the current pill's video matches one of the saved session's
    // snapshot for this pill. Walk fnSnapshots[activeFnIdx].sourceVideo.id, else legacy session.sourceVideoId.
    // Only sessions belonging to THIS pill can stand in for the current selection — one listed
    // against Fn1 must not suppress the "not yet saved" row while you're building Fn2.
    const bannerCurrentInSaved = bannerCurrentId ? bannerSaved.some(s => {
      if (s._fnIdx !== activeFnIdx) return false;
      const snapForPill = s.fnSnapshots?.[activeFnIdx];
      if (snapForPill?.sourceVideo?.id === bannerCurrentId) return true;
      return s.sourceVideoId === bannerCurrentId;
    }) : false;
    const bannerShowCurrent = !!bannerCurrentId && !bannerCurrentInSaved;
    const bannerFmtDate = (ts) => { try { return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); } catch { return ""; } };

    // ═══ FILTER PANEL PRESENTATION ═══
    // Now sourced from components/studio/filterUI.jsx so Browse and Build share one panel
    // implementation and cannot drift apart. Emits identical markup to the previous inline copy.
    const { hairline, gold, textM, ghostPill, seeMorePill, Pill, Section: FSection, SearchBox: FSearchBox, css: filterCSS } = makeFilterUI({ isDark, accent, textP, S });

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
/* Fix tags now sits on the thumbnail, where the card's own :hover lift is the only feedback it
   would otherwise get — it needs its own so it reads as a control and not a label. */
.sb-fix{transition:background .15s ease, border-color .15s ease}
.sb-fix:hover{background:rgba(0,0,0,0.78) !important;border-color:rgba(255,255,255,0.7) !important}
.sb-fix:active{transform:scale(0.96)}
/* The session banner cards use .sb-rcard, which now lives in makeFilterUI so Build's reference
   banner shares one definition with it. Only the banner's ACTIONS are Browse-specific: the outline
   button tints with its OWN colour via currentColor, so one rule serves the amber and indigo card. */
.sb-bnr-btn{transition:filter .16s ease, background .16s ease, box-shadow .18s ease, transform .14s ease}
.sb-bnr-btn:hover{transform:translateY(-1px)}
.sb-bnr-out:hover{background:color-mix(in srgb, currentColor 14%, transparent) !important}
.sb-bnr-solid:hover{filter:brightness(1.10);box-shadow:0 7px 15px -9px rgba(0,0,0,0.6)}
.sb-bnr-btn:active{transform:translateY(0) scale(0.97)}
@media (prefers-reduced-motion: reduce){
  .sb-pill,.sb-head,.sb-card,.sb-thumb,.sb-play,.sb-title,.sb-cta,.sb-alt,.sb-gate,.sb-rcard,.sb-bnr-btn{transition:none}
  .sb-pill:hover,.sb-card:hover,.sb-cta:hover,.sb-alt:hover,.sb-pill:active,.sb-bnr-btn:hover,.sb-bnr-btn:active,.sb-rcard:hover{transform:none}
  .sb-card:hover .sb-thumb,.sb-card:hover .sb-play{transform:none}
  .sb-head span[style*="rotate"]{transition:none}}
`;

    return (
      // maxWidth was S.main's 1200, which left ~350px of dead gutter either side on a desktop
      // monitor and pushed the filter panel far off the left edge. Wider cap + a roomier sidebar.
      <div style={{...S.main,maxWidth:1800,display:"flex",flexDirection:"column",gap:0}}>
        <style>{browseCSS}</style>
        {/* The "Active function" strip is gone. On a multi-function event the function pills in the
            sticky header already show which one is selected, so this was a full-width bar restating
            it — and it pushed the filters and the first row of videos down to say so. */}
        <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>

        {/* ═══ SIDEBAR FILTERS ═══ */}
        {/* top is dynamic: +50 when Row 2 function pills are visible (multi-function event) to avoid overlap with sticky header */}
        {/* The panel is capped to the viewport and scrolls its own body. Left at natural height it
            had no scrollport, so a wheel over the filters scrolled the whole page instead and the
            sections past the fold were only reachable by scrolling the layout beyond them.
            `overscrollBehavior:contain` keeps that scroll from chaining back to the page at the
            ends. The earlier version of this capped the panel and added a fade cue that covered the
            last rows of pills — there is deliberately no overlay here, just a slim scrollbar. */}
        <div ref={railRef} style={{width:248,flexShrink:0,position:"sticky",top:railTop,alignSelf:"flex-start",
          maxHeight:railMaxH,display:"flex",flexDirection:"column",gap:10}}>
          {/* Saved-session banner. Lives under the filters rather than above the grid: it is a way
              back into a build, not a property of the results, and at the top it pushed the first
              row of videos below the fold. Re-stacked for the 248px column — title, then buttons. */}
          {(bannerSaved.length > 0 || bannerShowCurrent) && (
            <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
              {bannerSaved.map(s => {
                const vid = allVideos.find(v => v.id === s.sourceVideoId);
                // "Continue" only when this really is the build in front of you — same video AND
                // same pill. On another pill it's a Resume, since continuing would carry on with
                // whatever is loaded here rather than with this session.
                const isCurrent = bannerCurrentId === s.sourceVideoId && s._fnIdx === activeFnIdx;
                const videoTitle = s.sourceVideoTitle || vid?.title || "Video";
                const unavailable = !vid && !s.sourceVideoTitle;
                return (
                  <div key={s.sourceVideoId+"_"+s.savedAt} className="sb-rcard" style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:10,padding:"11px 12px",borderRadius:10,background:isDark?"rgba(234,179,8,0.08)":"rgba(234,179,8,0.07)",border:`1px solid ${isDark?"rgba(234,179,8,0.28)":"rgba(217,119,6,0.30)"}`}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:9}}><div style={{flexShrink:0,display:"flex",marginTop:1,color:"#B45309"}}><IconSave size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11.5,fontWeight:600,color:textP,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                        {videoTitle}
                        {unavailable && <span style={{marginLeft:8,fontSize:10,color:textS,fontWeight:400}}>(no longer in library)</span>}
                        {isCurrent && <span style={{marginLeft:8,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"#10B981",letterSpacing:0.3}}>LIVE</span>}
                        {/* Only worth saying when it isn't the pill you're on — otherwise it's noise. */}
                        {s._fnIdx !== activeFnIdx && <span title={`This session's build is on Function ${s._fnIdx+1}`} style={{marginLeft:8,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:isDark?"rgba(99,102,241,0.18)":"rgba(99,102,241,0.12)",color:isDark?"#A5B4FC":"#4338CA",letterSpacing:0.3}}>Fn{s._fnIdx+1}</span>}
                      </div>
                      <div style={{fontSize:10,color:textS,marginTop:3,lineHeight:1.4}}>
                        Saved {bannerFmtDate(s.savedAt)}{s.savedBy?` by ${s.savedBy}`:""}{typeof s.total==="number"?` · ${fmt(s.total)}`:""}{s.tier?` ${s.tier}`:""}
                      </div>
                    </div>
                    </div>
                    <div style={{display:"flex",gap:7}}>
                    {!unavailable && <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${s.sourceVideoId}`,venue:s.venue||"",fn:s.fn||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[],tags:[]});setVideoPlaying(true);}} className="sb-bnr-btn sb-bnr-out" style={{padding:"6px 11px",borderRadius:7,border:`1px solid ${isDark?"rgba(234,179,8,0.5)":"#D97706"}`,background:"transparent",color:isDark?"#FBBF24":"#B45309",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flex:"0 0 auto",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5}}><IconPlay size={11}/>Play</button>}
                    {/* Pass _fnIdx so the restore lands on the function that HAS the build. */}
                    <button onClick={(e)=>{e.stopPropagation();if(isCurrent){setStep(2);}else{resumeSavedSession(s,s._fnIdx);}}}
                      title={s._fnIdx!==activeFnIdx?`Switches to Function ${s._fnIdx+1} and loads this build`:undefined}
                      className="sb-bnr-btn sb-bnr-solid" style={{padding:"6px 12px",borderRadius:7,border:"none",background:isDark?"#D97706":"#B45309",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flex:1}}>
                      {isCurrent?"Continue":"Resume"} build {"→"}
                    </button>
                    </div>
                  </div>
                );
              })}
              {bannerShowCurrent && (() => {
                const vid = allVideos.find(v => v.id === bannerCurrentId);
                const videoTitle = sourceVideo?.title || vid?.title || "Video";
                return (
                  <div className="sb-rcard" style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:10,padding:"11px 12px",borderRadius:10,background:isDark?"rgba(99,102,241,0.10)":"rgba(99,102,241,0.06)",border:`1px solid ${isDark?"rgba(99,102,241,0.30)":"rgba(99,102,241,0.25)"}`}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:9}}><div style={{flexShrink:0,display:"flex",marginTop:1,color:"#B45309"}}><IconPalette size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11.5,fontWeight:600,color:textP,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{videoTitle}</div>
                      <div style={{fontSize:10,color:textS,marginTop:3,lineHeight:1.4}}>Current selection — not yet saved</div>
                    </div>
                    </div>
                    <div style={{display:"flex",gap:7}}>
                    <button onClick={(e)=>{e.stopPropagation();setVideoModal({name:videoTitle,video:`https://www.youtube.com/embed/${bannerCurrentId}`,venue:venue||"",fn:activeFnMeta.type||"",desc:"",gradient:"linear-gradient(135deg,#1a1a2e,#6366F1)",photos:[],tags:[]});setVideoPlaying(true);}} className="sb-bnr-btn sb-bnr-out" style={{padding:"6px 11px",borderRadius:7,border:`1px solid ${isDark?"rgba(99,102,241,0.5)":"#6366F1"}`,background:"transparent",color:isDark?"#A5B4FC":"#4338CA",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flex:"0 0 auto",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5}}><IconPlay size={11}/>Play</button>
                    <button onClick={(e)=>{e.stopPropagation();setStep(2);}} className="sb-bnr-btn sb-bnr-solid" style={{padding:"6px 12px",borderRadius:7,border:"none",background:isDark?"#4F46E5":"#4338CA",color:"#fff",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flex:1}}>
                      Continue build {"→"}
                    </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {/* The filter card takes what is left after the banner, and keeps its own scrollport, so a
              long banner shortens the filters rather than pushing them off the bottom of the rail. */}
          {/* sb-panel is the shared filter-panel class from makeFilterUI — Build gets it for free via
              FPanel, and Browse hand-rolls this shell, so it opts in explicitly. Same hover on both
              pages rather than a second lookalike rule that drifts. */}
          <div className="sb-panel" style={{...S.card,padding:0,width:"100%",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden",flex:"1 1 auto"}}>
            {/* Panel header — total active count + one-click reset. Outside the scrollport, so it
                stays visible while the sections below scroll. */}
            <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:8,
              padding:"13px 16px",borderBottom:`1px solid ${hairline}`,
              background:isDark?"#1A1A2E":"linear-gradient(180deg,#FEFCF8,#fff)"}}>
              <div style={{fontSize:13.5,fontWeight:700,color:textP,letterSpacing:-0.1}}>Filters</div>
              {activeTotal > 0 && <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,
                background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{activeTotal}</span>}
              {activeTotal > 0 && <div className="sb-pill sb-ghost" onClick={clearAllFilters} title="Reset every filter"
                style={{...ghostPill,marginLeft:"auto"}}>Clear all</div>}
            </div>
            <div className="sb-scroll" style={{flex:1,minHeight:0,overflowY:"auto",overscrollBehavior:"contain",padding:"14px 16px 16px"}}>

            {/* Venue */}
            <FSection open={!!openSections["venue"]} onToggle={()=>toggleSection("venue")} id="venue" label="Venue" count={sectionCounts.venue}>
                {/* Switching group also drops the venue search and both "see all" toggles — a query
                    left over from Inhouse would silently hide most of the Outside list. */}
                {(userVenueScope==="all"||isAdmin)&&<Pill on={venueGroup==="all"} onClick={()=>{setVenueGroup("all");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);setShowMoreInhouse(false);setVenueQ("");}}>All</Pill>}
                {(userVenueScope==="all"||userVenueScope==="inhouse"||isAdmin)&&<Pill on={venueGroup==="inhouse"} onClick={()=>{setVenueGroup("inhouse");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);setShowMoreInhouse(false);setVenueQ("");}}>Inhouse</Pill>}
                {(userVenueScope==="all"||userVenueScope==="outside"||isAdmin)&&<Pill on={venueGroup==="outside"} onClick={()=>{setVenueGroup("outside");setBrowseVenues([]);setOutsideSub("all");setShowMoreOutside(false);setShowMoreInhouse(false);setVenueQ("");}}>Outside</Pill>}
              {/* No per-section clear chip — the panel header's "Clear all" covers it, and tapping a
                  selected venue pill deselects it. */}
              {/* Sub-venue pills for Inhouse — multi-select. Indented + ruled so it's obvious they
                  narrow the group above rather than being a seventh top-level filter. */}
              {/* One search box serves both groups — it only appears once a group is chosen, since
                  there is nothing to search through on "All". */}
              {venueGroup!=="all"&&<div style={{gridColumn:"1/-1",paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                <FSearchBox value={venueQ} onChange={setVenueQ} placeholder="Search venues…" noun="venues"
                  resultCount={venueGroup==="inhouse"?inhouseVenuesVisible.length:outsideVenuesVisible.length}
                  totalCount={venueGroup==="inhouse"?allInhouseVenues.length:outdoorVenueList.length}/>
              </div>}
              {venueGroup==="inhouse"&&<div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:8,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                {withSelected(inhouseVenuesVisible.slice(0,maxInhousePills),allInhouseVenues).map(v=>{const on=browseVenues.includes(v);return <Pill key={v} on={on} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v)}>{v}</Pill>;})}
                {inhouseOverflow>0&&!showMoreInhouse&&<div className="sb-pill sb-ghost" onClick={()=>setShowMoreInhouse(true)} title={`Show ${inhouseOverflow} more venues`} style={seeMorePill}>See all {inhouseVenuesVisible.length} venues</div>}
                {showMoreInhouse&&!venueQ.trim()&&inhouseVenuesVisible.length>9&&<div className="sb-pill sb-ghost" onClick={()=>setShowMoreInhouse(false)} title="Show fewer venues" style={seeMorePill}>Show fewer</div>}
              </div>}
              {/* Sub-group for Outside */}
              {venueGroup==="outside"&&<Fragment>
                <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:8,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                  <Pill on={outsideSub==="all"} onClick={()=>{setOutsideSub("all");setBrowseVenues([]);setShowMoreOutside(false);}}>All</Pill>
                  <Pill on={outsideSub==="empanelled"} onClick={()=>{setOutsideSub("empanelled");setBrowseVenues([]);setShowMoreOutside(false);}}>Empanelled</Pill>
                  <Pill on={outsideSub==="other"} onClick={()=>{setOutsideSub("other");setBrowseVenues([]);setShowMoreOutside(false);}}>Other</Pill>
                </div>
                <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6,marginTop:6,paddingLeft:9,borderLeft:`2px solid ${accent}33`}}>
                  {(()=>{
                    // Selected venues are pinned on even when the search or the cap drops them —
                    // same rule as the Inhouse list above (see withSelected).
                    const slice=outsideVenuesVisible.slice(0,maxOutsidePills);
                    const pinned=outdoorVenueList.filter(v=>browseVenues.includes(v.name)&&!slice.some(s=>s.name===v.name));
                    return [...slice,...pinned].map(v=>{const on=browseVenues.includes(v.name);return <Pill key={v.name} on={on} onClick={()=>toggleFilter(browseVenues,setBrowseVenues,v.name)} title={v.empanelled?"Empanelled venue":undefined}>{v.name}{v.empanelled?" ★":""}</Pill>;});
                  })()}
                  {overflowCount>0&&!showMoreOutside&&<div className="sb-pill sb-ghost" onClick={()=>setShowMoreOutside(true)} title={`Show ${overflowCount} more venues`} style={seeMorePill}>See all {outsideVenuesVisible.length} venues</div>}
                  {showMoreOutside&&!venueQ.trim()&&outsideVenuesVisible.length>10&&<div className="sb-pill sb-ghost" onClick={()=>setShowMoreOutside(false)} title="Show fewer venues" style={seeMorePill}>Show fewer</div>}
                  </div>
              </Fragment>}
            </FSection>

            {/* Event type */}
            <FSection open={!!openSections["fn"]} onToggle={()=>toggleSection("fn")} id="fn" label="Event type" count={sectionCounts.fn}>
              <Pill on={filterFn.length===0} onClick={()=>setFilterFn([])}>All</Pill>
              {azSort(taxOr(taxonomy.eventType, FUNCTIONS)).map(o=>{const on=filterFn.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterFn,setFilterFn,o)}>{o}</Pill>;})}
            </FSection>

            {/* Tier */}
            <FSection open={!!openSections["tier"]} onToggle={()=>toggleSection("tier")} id="tier" label="Tier" count={sectionCounts.tier}>
              <Pill on={filterCat.length===0} onClick={()=>setFilterCat([])}>All</Pill>
              {taxOr(taxonomy.tier, CATEGORIES).map(o=>{const on=filterCat.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterCat,setFilterCat,o)}>{o}</Pill>;})}
            </FSection>

            {/* Space */}
            <FSection open={!!openSections["space"]} onToggle={()=>toggleSection("space")} id="space" label="Venue type" count={sectionCounts.space}>
              <Pill on={filterSpace.length===0} onClick={()=>setFilterSpace([])}>All</Pill>
              {azSortBy(taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]),venueTypeLabel).map(o=>{const on=filterSpace.includes(o);return <Pill key={o} on={on} onClick={()=>toggleFilter(filterSpace,setFilterSpace,o)}>{venueTypeLabel(o)}</Pill>;})}
            </FSection>

            {/* Design Style */}
            <FSection open={!!openSections["mood"]} onToggle={()=>toggleSection("mood")} id="mood" label="Design Style" count={sectionCounts.mood}>
              <Pill on={filterMood.length===0} onClick={()=>setFilterMood([])}>All</Pill>
              {azSort(taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"])).map(s=>{const on=filterMood.includes(s);return <Pill key={s} on={on} onClick={()=>toggleFilter(filterMood,setFilterMood,s)}>{s}</Pill>;})}
            </FSection>

            {/* Palette */}
            {/* Three columns, matching Venue and the other sections. Long names ("Ivory & Rani Pink
                / Magenta") wrap inside their cell rather than widening it — the pill sets
                whiteSpace:normal and the grid stretches every cell in a row to the same height. */}
            <FSection open={!!openSections["palette"]} onToggle={()=>toggleSection("palette")} id="palette" label="Palette" count={sectionCounts.palette} cols={3} last>
              {(()=>{
                const all = azSort(paletteNames(imsPaletteCatalogue, taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"]));
                const anchorsOf = (name) => (imsPaletteCatalogue||[]).find(p=>p.name===name)?.anchorColours;
                // Ranked, not alphabetical — the closest name has to come first.
                const shown = paletteSearch(all, paletteQ, anchorsOf);
                // An active filter must never be hidden by the search — you'd be filtering on a
                // palette with nothing on screen saying so, and no way to switch it off.
                const selectedHidden = filterPalette.filter(c => all.includes(c) && !shown.includes(c));
                // Centred, not align="start" — that variant exists for full-width rows, where a long
                // label centred away from its swatch reads as misaligned. In a 3-up grid the other
                // sections all centre, so this matches them.
                const pill = (c) => {const on=filterPalette.includes(c);return <Pill key={c} on={on} onClick={()=>toggleFilter(filterPalette,setFilterPalette,c)}>{c}</Pill>;};
                return <>
                  <div style={{gridColumn:"1/-1"}}>
                    <FSearchBox value={paletteQ} onChange={setPaletteQ} placeholder="Search palettes…" resultCount={shown.length} totalCount={all.length}/>
                  </div>
                  <Pill on={filterPalette.length===0} onClick={()=>setFilterPalette([])}>All</Pill>
                  {/* Split name hits from colour-only hits — searching "gold" legitimately turns up
                      "Ivory & Peach" if gold is one of its anchour colours, but unlabelled that
                      reads as a broken search rather than a useful one. */}
                  {(()=>{
                    const nameHits = shown.filter(c=>paletteMatches(c,paletteQ));
                    // Capped until "See all" — but never while searching (you asked for those
                    // results) and never below what is already selected, which must stay visible.
                    const capped = !showMorePalette && !paletteQ.trim();
                    const LIMIT = 12;   // 4 rows at three columns
                    const visible = capped ? nameHits.slice(0, LIMIT) : nameHits;
                    const hiddenCount = nameHits.length - visible.length;
                    const missedSelection = capped ? filterPalette.filter(c=>nameHits.includes(c) && !visible.includes(c)) : [];
                    return <>
                      {visible.map(pill)}
                      {missedSelection.map(pill)}
                      {hiddenCount>0&&<div className="sb-pill sb-ghost" onClick={()=>setShowMorePalette(true)} title={`Show ${hiddenCount} more palettes`} style={seeMorePill}>See all {nameHits.length} palettes</div>}
                      {showMorePalette&&!paletteQ.trim()&&nameHits.length>LIMIT&&<div className="sb-pill sb-ghost" onClick={()=>setShowMorePalette(false)} title="Show fewer palettes" style={seeMorePill}>Show fewer</div>}
                    </>;
                  })()}
                  {(()=>{const byColour=shown.filter(c=>!paletteMatches(c,paletteQ));return byColour.length===0?null:<>
                    <div style={{gridColumn:"1/-1",fontSize:9,color:textM,marginTop:2}}>Contains this colour</div>
                    {byColour.map(pill)}
                  </>;})()}
                  {selectedHidden.length>0&&<div style={{gridColumn:"1/-1",fontSize:9,color:textM,marginTop:2}}>Selected, outside this search</div>}
                  {selectedHidden.map(pill)}
                </>;
              })()}
            </FSection>
            </div>
          </div>
        </div>

        {/* ═══ MAIN CONTENT — VIDEO CARDS ═══ */}
        <div style={{flex:1,minWidth:0}}>
          {/* Session banner — per-pill Resume/Continue entry points. Hidden entirely when pill has no saved sessions and no current selection. */}
          {/* Recent builds from other clients — the only way back in once Event Info has minted a
              fresh client record. Resume goes through loadClientSession so the client's own name,
              date, venue and functions come back with the build, not just the zones. */}
          {recentBuilds.length > 0 && (
            <div style={{marginBottom:14,padding:"9px 12px",borderRadius:10,background:isDark?"rgba(148,163,184,0.07)":"rgba(100,116,139,0.05)",border:`1px solid ${isDark?"rgba(148,163,184,0.20)":"rgba(100,116,139,0.18)"}`}}>
              <div style={{fontSize:9.5,fontWeight:700,letterSpacing:0.9,textTransform:"uppercase",color:textS,marginBottom:7}}>Recent builds</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {recentBuilds.map(({client,session}) => (
                  <div key={client.id+"_"+session.savedAt} style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flexShrink:0,display:"flex",color:textS}}><IconSave size={13}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11.5,fontWeight:600,color:textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{client.name||"Client"}</div>
                      <div style={{fontSize:10,color:textS,marginTop:1}}>
                        {session.sourceVideoTitle||"Build"} · saved {bannerFmtDate(session.savedAt)}{session.savedBy?` by ${session.savedBy}`:""}{typeof session.total==="number"?` · ${fmt(session.total)}`:""}
                      </div>
                    </div>
                    <button onClick={(e)=>{e.stopPropagation();loadClientSession(client,session,2);}}
                      title={`Switch to ${client.name||"this client"} and open their saved build`}
                      style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${isDark?"rgba(148,163,184,0.45)":"rgba(100,116,139,0.4)"}`,background:"transparent",color:textP,fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      Open {"→"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{position:"relative",flex:1,maxWidth:360}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",display:"flex",color:textM,pointerEvents:"none"}}><IconSearch size={13}/></span>
              <input value={vq} onChange={e=>setVq(e.target.value)} placeholder="Search videos by name, venue, style…"
                style={{...S.input,marginBottom:0,padding:"7px 30px 7px 30px",fontSize:12.5}}/>
              {vq&&<span onClick={()=>setVq("")} title="Clear the search" style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:textM,fontSize:13,fontWeight:700,lineHeight:1}}>✕</span>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:9,marginBottom:12,flexWrap:"wrap"}}>
            {/* The headline number is always what is ON SCREEN. It used to read "130 videos at
                Aura", which was false — 130 was the whole Inhouse group while only 12 are tagged
                Aura. No venue clause here any more: the section headings below carry the per-venue
                counts, and repeating them next to the total is what made the two look contradictory. */}
            <div style={{fontSize:13,fontWeight:600,color:textP}}>{shownVideos.length} video{shownVideos.length===1?"":"s"}{vq.trim()&&browseVideos.length!==shownVideos.length&&<span style={{fontWeight:400,color:textM}}> of {browseVideos.length}</span>}</div>
            <div style={{fontSize:12,color:textM}}>{browseVenues.length===0&&venueGroup!=="all"?`(${venueGroup})`:""}</div>
            {activeTotal>0&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:textM}}>{activeTotal} filter{activeTotal===1?"":"s"} applied</span>
              <div className="sb-pill sb-ghost" onClick={clearAllFilters} style={ghostPill}>Clear all</div>
            </div>}
          </div>
          {/* Picking a venue ranks rather than filters (see browseVideos), so the grid holds the
              chosen venue's videos followed by everything else. Split them under headings —
              unlabelled, a list that still shows other venues just looks like a broken filter. */}
          {(()=>{
            const preferred = shownVideos.filter(v=>v._venueMatch);
            // Three groups, not two. The tail used to be labelled "from other venues", but ~191 of
            // the library has no venue tag at all, so that heading was describing them wrongly. They
            // are worth showing AND worth naming: an untagged video is a usable reference and a
            // to-do at the same time, and lumping it in with real venues hides both facts.
            const otherVenues = shownVideos.filter(v=>!v._venueMatch && v.venue);
            const noVenue = shownVideos.filter(v=>!v._venueMatch && !v.venue);
            const grid = {display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14};
            const heading = (text,sub)=><div style={{display:"flex",alignItems:"baseline",gap:8,margin:"4px 0 10px"}}>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:textM}}>{text}</span>
              {sub&&<span style={{fontSize:10.5,color:textM,fontWeight:400}}>{sub}</span>}
            </div>;
            const rule = <div style={{height:1,background:border,margin:"22px 0 14px"}}/>;
            // No venue picked (or nothing matched it) — one plain grid, exactly as before.
            if (!preferred.length || (!otherVenues.length && !noVenue.length)) return <div style={grid}>{shownVideos.map(v=><VideoCard key={v.id} v={v}/>)}</div>;
            return <>
              {heading(browseVenues.length===1?browseVenues[0]:"Selected venues",`${preferred.length} tagged here`)}
              <div style={grid}>{preferred.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              {otherVenues.length>0&&<>
                {rule}
                {heading("More references",`${otherVenues.length} from other venues`)}
                <div style={grid}>{otherVenues.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              </>}
              {noVenue.length>0&&<>
                {rule}
                {heading("Not tagged to a venue",`${noVenue.length} — still usable, but nobody has said where they were shot`)}
                <div style={grid}>{noVenue.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              </>}
            </>;
          })()}
          {shownVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textM,background:cardBg,borderRadius:14,border:`1px dashed ${border}`}}>
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

        {/* ═══ FIX TAXONOMY — lightweight salesperson-facing correction modal ═══
            Edits write straight to ytVideoTags (same store Manage's editor and every
            filter/seeding path reads), so a fix here applies everywhere the video shows up. */}
        {taxFixVid && (() => {
          const vid = allVideos.find(x => x.id === taxFixVid);
          const tag = ytVideoTags[taxFixVid] || {};
          const fnArr = Array.isArray(tag.fn) ? tag.fn : (tag.fn ? [tag.fn] : []);
          const styleArr = tag.styles || [];
          const colorArr = tag.colors || [];
          const updTag = (patch) => saveYtTags({ [taxFixVid]: { ...(ytVideoTags[taxFixVid] || {}), ...patch, _lastEditedBy: authUser?.name || "—", _lastEditedAt: Date.now() } });
          const toggleArr = (field, val) => { const cur = Array.isArray(tag[field]) ? tag[field] : []; const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val]; updTag({ [field]: next.length ? next : undefined }); };
          const palettes = paletteNames(imsPaletteCatalogue, taxonomy.colorPalette, ["White & Gold", "Red & Gold", "Pastels", "Teal"]);
          const lbl = { fontSize: 11, fontWeight: 700, color: textS, marginBottom: 6 };
          const chipRow = { display: "flex", flexWrap: "wrap", gap: 5 };
          const chip = (label, on, onClick) => <span key={label} onClick={onClick} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontWeight: on ? 700 : 500, background: on ? accent : "transparent", color: on ? (isDark ? "#1a1a2e" : "#fff") : textS, border: `1px solid ${on ? accent : border}` }}>{label}</span>;
          return (
            <div onClick={() => setTaxFixVid(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", border: `1px solid ${border}`, padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: textP }}>Fix taxonomy — {vid?.title || "Video"}</div>
                  <button onClick={() => setTaxFixVid(null)} style={{ border: "none", background: "transparent", color: textS, fontSize: 16, cursor: "pointer" }}>✕</button>
                </div>
                <div style={{ fontSize: 11, color: textS, marginBottom: 16 }}>Changes save instantly and apply everywhere this video shows up.</div>
                <div style={{ marginBottom: 16 }}>
                  <div style={lbl}>Venue</div>
                  {(() => {
                    const curVenue = tag.venue || "";
                    const isInhouse = curVenue && allInhouseVenueOrParentNames.includes(curVenue);
                    const activeGroup = taxVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                    const setVidVenue = (val) => updTag({ venue: val || undefined, venueCustom: undefined });
                    const outsideFiltered = outdoorVenueList.filter(o => taxOutsideSub === "empanelled" ? o.empanelled : taxOutsideSub === "other" ? !o.empanelled : true);
                    return <>
                      <div style={chipRow}>
                        {chip("Inhouse", activeGroup === "inhouse", () => { setTaxVenueGroup("inhouse"); setTaxOutsideSub("all"); })}
                        {chip("Outside", activeGroup === "outside", () => { setTaxVenueGroup("outside"); setTaxOutsideSub("all"); })}
                        {curVenue && <span onClick={() => { setVidVenue(""); setTaxVenueGroup(""); }} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</span>}
                      </div>
                      {/* Sub-venues only — property/group names (e.g. "Exotica") are excluded here
                          since they aren't a specific bookable room. */}
                      {activeGroup === "inhouse" && <div style={{ ...chipRow, marginTop: 6 }}>
                        {leafInhouseVenues.map(vn => chip(vn, curVenue === vn, () => setVidVenue(curVenue === vn ? "" : vn)))}
                      </div>}
                      {activeGroup === "outside" && <>
                        <div style={{ ...chipRow, marginTop: 6 }}>
                          {chip("All", taxOutsideSub === "all", () => setTaxOutsideSub("all"))}
                          {chip("Empanelled", taxOutsideSub === "empanelled", () => setTaxOutsideSub("empanelled"))}
                          {chip("Other", taxOutsideSub === "other", () => setTaxOutsideSub("other"))}
                        </div>
                        <div style={{ ...chipRow, marginTop: 4 }}>{outsideFiltered.map(o => chip(o.name + (o.empanelled ? " ★" : ""), curVenue === o.name, () => setVidVenue(curVenue === o.name ? "" : o.name)))}</div>
                      </>}
                    </>;
                  })()}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={lbl}>Event type</div>
                  <div style={chipRow}>{taxOr(taxonomy.eventType, FUNCTIONS).map(f => chip(f, fnArr.includes(f), () => toggleArr("fn", f)))}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={lbl}>Tier</div>
                  <div style={chipRow}>{taxOr(taxonomy.tier, CATEGORIES).map(t => chip(t, tag.tier === t, () => updTag({ tier: tag.tier === t ? undefined : t })))}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={lbl}>Venue type</div>
                  <div style={chipRow}>{taxOr(taxonomy.venueType, ["Indoor", "Outdoor", "Semi-Outdoor"]).map(s => chip(venueTypeLabel(s), tag.io === s, () => updTag({ io: tag.io === s ? undefined : s })))}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={lbl}>Design style</div>
                  <div style={chipRow}>{taxOr(taxonomy.designStyle, ["Floral", "Modern", "Traditional", "Royal", "Minimal"]).map(s => chip(s, styleArr.includes(s), () => toggleArr("styles", s)))}</div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={lbl}>Palette</div>
                  <div style={chipRow}>{palettes.map(c => chip(c, colorArr.includes(c), () => toggleArr("colors", c)))}</div>
                </div>
                <button onClick={() => { setTaxFixVid(null); showMsg("✓ Taxonomy updated", "green"); }} style={{ ...S.btn(true), width: "100%" }}>Done</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
}

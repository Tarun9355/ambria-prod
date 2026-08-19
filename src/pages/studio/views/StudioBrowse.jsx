import { Fragment, useState, useRef, useEffect } from "react";
import { makeFilterUI, useRailMaxHeight } from "../../../components/studio/filterUI.jsx";
import { IconCheck, IconChevron, IconCrown, IconSave, IconPlay,
  IconPalette, IconClipboard, IconSearch, IconCalendar } from "../../../components/icons.jsx";
import { paletteNames } from "../../../lib/studio/colours";
import { venueTypeLabel } from "../../../lib/studio/taxonomy";
import { paletteSearch, paletteMatches } from "../../../components/studio/filterUI.jsx";
import { makeS } from "../../../lib/studio/styles";
import { WASH_BANDS, GRAIN_URL } from "../../../lib/studio/pageWash";

// The panel's right edge. Event Info's gesture, but a FLATTER waist — 0.90 rather than 0.80.
// Event Info's panel holds a logo and nothing else, so it can afford to lose a fifth of its width
// at the middle. This one holds the whole filter list, and at 0.80 the curve ate the right edge of
// every pill row. A shallower waist costs far less usable width, and at this narrower panel the
// deeper curve read as a hard diagonal anyway rather than the soft sweep it is on a 560px column.
// Waist deepened from 0.90 to 0.86. The right padding below goes 58 → 68 to pay for it: the curve's
// true minimum sits a little inside the waist figure (the second cubic pulls to 0.845 before coming
// back), so at 392px the edge reaches ~335px and the card has to stop short of that or the pill
// rows get their right ends shaved — which is exactly what killed the 0.80 version.
const SB_CURVE = "M0,0 H1 C1,0.18 0.875,0.28 0.86,0.46 C0.845,0.66 1,0.82 1,1 H0 Z";
// The same edge as an OPEN path, for the gold line that traces it. It has to be separate: a
// clip-path cuts a shape out, it does not draw one, so there is no border to colour — and a path
// inside the clipped element would be sliced in half down its own middle. This one is drawn outside
// the rail entirely, over the seam.
const SB_EDGE = "M1,0 C1,0.18 0.875,0.28 0.86,0.46 C0.845,0.66 1,0.82 1,1";
// The photograph behind it. Browse looks for its OWN file first and falls back to the shared panel
// image — the two panels are the same height but not the same job (Event Info's holds a logo and
// nothing else; this one holds a filter list under a glass card), so they get to differ. Naming the
// Browse one separately also means changing it can never silently restyle Event Info.
// Drop a file at src/assets/ambria-panel-browse.jpg to use it here; delete it and this falls
// straight back to the shared one. Neither existing is fine too — the panel keeps its gradient.
const PANEL_BG =
  Object.values(import.meta.glob("../../../assets/ambria-panel-browse.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" }))[0] ||
  Object.values(import.meta.glob("../../../assets/ambria-panel.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" }))[0] ||
  null;

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
  // "Last 5 sessions" history under the most-recent-session card — collapsed by default so it
  // doesn't compete with the filters/videos for space; per-client is enough (doesn't need to
  // persist across clients), so plain local state rather than anything ctx-level.
  const [bannerHistoryOpen, setBannerHistoryOpen] = useState(false);
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
    sourceVideo, sourceEvent, venue, clientName, clientDate, showMsg,
    elSelectedPhoto, zoneElements, enabledEls,
    // names not in StudioApp ctx (see report) — referenced verbatim from reference body
    ytVideoTags, saveYtTags, outdoorVenueList, browseVideos, browseVideosAll, allVideos, activeClient,
    subVenuesOfParent, allInhouseVenueOrParentNames, leafInhouseVenues,
    pickAndLoadFromVideo, resumeSavedSession, allInhouseVenues, taxOr, FUNCTIONS, CATEGORIES,
    clientLedger, saveClientLedger, askConfirm,
    favVideos, saveFavVideos,
  } = ctx;
  // Customize/Exact Look both hand off to pickAndLoadFromVideo → loadEvent, which REPLACES
  // enabledEls wholesale (down to just `{lighting:true}`) for whichever function is active — it
  // never merges with what's already turned on. If that function's live canvas already holds a
  // real build (zone photos picked, zones enabled, or its own reference), doing this silently
  // orphans that work: the zones just stop being enabled, and the next autosave persists the
  // now-near-empty state over the session it came from. fnSnapHasData is the exact same test the
  // save path already uses for "does this snapshot hold a build" — reused here against the LIVE
  // state instead of a saved one, so the two can't disagree about what counts as real work.
  const guardedPickAndLoadFromVideo = (videoId, targetStep, onLoaded) => {
    const liveSnap = { elSelectedPhoto, zoneElements, enabledEls, sourceVideo, sourceEvent };
    const proceed = () => { pickAndLoadFromVideo(videoId, targetStep); if (onLoaded) onLoaded(); };
    if (fnSnapHasData(liveSnap)) {
      askConfirm(
        "Switch reference and start customizing this instead?",
        proceed,
        { note: "The zones you already turned on for this function will be switched off — their picks aren't deleted from the library, but this build stops using them.", yesLabel: "Switch anyway" }
      );
      return;
    }
    proceed();
  };
  // The sticky offset clears the header, plus the function tab strip when there is more than one
  // function. The rail's height is measured rather than derived from it — see useRailMaxHeight.
  const railTop = extraFunctions.length > 0 ? 120 : 70;
  const railRef = useRef(null);
  // ═══ THE REAL HEADER HEIGHT ═══
  // railTop above is a guess at it — 70, or 120 when the function pills show. On a tablet the bar
  // wraps its step nav onto a second row and stands about 110px tall, so the guess was short and
  // the panel's first control (Hide) came out on top of the navbar. Measured instead, and observed,
  // so it re-reads when the bar wraps, unwraps, or gains the function row.
  const [hdrH, setHdrH] = useState(railTop);
  useEffect(() => {
    const el = document.querySelector(".sa-header");
    if (!el) return undefined;
    const read = () => setHdrH(el.getBoundingClientRect().height || railTop);
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [railTop]);
  // Browse had no way to fold its filters, unlike Build. Same behaviour here: a Hide in the
  // panel header, and a slim tab on the edge to bring it back.
  // Open on a desktop, closed on a tablet. On a narrow screen the panel is an overlay (see the
  // ≤840 block in browseCSS), and an overlay that is up before you ask for it hides the thing you
  // came to look at. Read once at mount rather than on every resize: this is a starting position,
  // not a binding — once you have opened or closed it, that choice stands.
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try { return !window.matchMedia("(max-width: 840px)").matches; } catch { return true; }
  });
  // My favourites, as a set — the tier pill on each card reads and writes this. favVideos is keyed
  // videoId → userId → true, so a favourite is per salesperson: mine and a colleague's are
  // independent, and browseVideos already floats them to the top of their group.
  const myFavIds = new Set(Object.keys(favVideos || {}).filter(id => !!favVideos[id]?.[authUser?.id]));
  // ═══ PAGINATION ═══
  // 377 videos in one grid is 377 YouTube thumbnails and 377 cards on the page at once. 40 a page.
  const PER_PAGE = 40;
  const [page, setPage] = useState(1);
  // Back to page 1 whenever the result set changes underneath — narrowing to 12 results while
  // sitting on page 6 would otherwise show an empty grid. Keyed off a STRING of the filter state,
  // not the arrays themselves: those are new identities on every render and would loop the effect.
  const filterSig = JSON.stringify([
    vq, venueGroup, outsideSub, browseVenues, filterFn, filterCat, filterSpace, filterMood,
    filterPalette, activeFnIdx,
  ]);
  useEffect(() => { setPage(1); }, [filterSig]);
  // ═══ THE HEADER, WHILE THE RAIL IS UP ═══
  // The panel has always run from y=0 to the bottom of the viewport — it just painted BEHIND an
  // opaque header (z-index 40 against 50), so its top 70-odd pixels were invisible and it read as
  // starting under the bar. The header goes see-through across exactly the panel's width so the
  // column reads as one piece from the very top. That needs a flag the header can see, and the
  // header is a SIBLING of this view rather than an ancestor — so it goes on the root element
  // instead of through ctx, and is removed on unmount so Build and Summary, which have no panel,
  // never inherit a bar with a hole in it.
  useEffect(() => {
    const el = document.documentElement;
    if (filtersOpen) el.setAttribute("data-sb-rail", "1");
    else el.removeAttribute("data-sb-rail");
    return () => el.removeAttribute("data-sb-rail");
  }, [filtersOpen]);
  const railMaxH = useRailMaxHeight(railRef, railTop);
  // With nothing typed, search narrows what the left-rail filters already produced. The moment
  // something IS typed, the relationship flips: the search stands on its own, over the full
  // (permission-scoped) catalog, ignoring every filter chip rather than compounding with them —
  // the filters stay exactly as selected on screen, they just stop narrowing while there's a query,
  // and go straight back to applying the instant the search box is cleared.
  // Token-AND over the fields a card actually shows, so word order does not matter.
  const shownVideos = (() => {
    const tokens = vq.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return browseVideos;
    return browseVideosAll.filter((v) => {
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

    // Tier badge palette. Hoisted out of VideoCard because the featured banner badges the same
    // three tiers — two copies of this drift the first time a tier is recoloured.
    const tierColors = (t) => t === "Platinum" ? {bg:"#EDE9FE",color:"#7C3AED"}
      : t === "Gold" ? {bg:"#FFFBEB",color:"#D97706"} : {bg:"#ECFDF5",color:"#059669"};

    // ═══ VIDEO CARD — browse tile sourced from ytVideoTags ═══
    const VideoCard = ({v}) => {
      const isPlatinum = v.tierCat === "Platinum";
      const priceTBD = v.price === null || v.price === undefined;
      const tierColor = tierColors(v.tierCat);
      const videoUrl = `https://www.youtube.com/embed/${v.id}`;
      return (
        <div className="sb-card" style={{...S.card,cursor:"default",display:"flex",flexDirection:"column",boxShadow:tileShadow}}>
          <div style={{background:"#1a1a2e",height:150,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>{setVideoModal({name:v.title, video:videoUrl, venue:v.venue, fn:v.fn});setVideoPlaying(true);}}>
            <img className="sb-thumb" src={v.thumbnail} alt={v.title} loading="lazy" style={{width:"100%",height:"100%",objectFit:"cover",position:"absolute",inset:0}} onError={e=>{e.target.style.display="none"}}/>
            <div className="sb-play" style={{width:48,height:48,borderRadius:"50%",background:"rgba(255,255,255,0.25)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",position:"relative",zIndex:2}}><IconPlay size={20}/></div>
            {/* Click the tier pill to favourite this video for its own venue (see browseVideos'
                favFirst) — it then LEADS that venue's results. It does not survive the filters:
                favouriting ranks, it does not exempt, so a Wedding favourite stays out of a Cocktail
                filter. Per salesperson (favVideos[id][myUserId]) — my favourites and a colleague's
                are independent. Deliberately subtle (a thin red ring, no icon/label change): this
                can be on screen in front of a guest, and the point is the salesperson recognising
                it, not them. */}
            {v.tierCat&&(()=>{ const isFav = myFavIds.has(v.id); return (
              <div onClick={(e)=>{e.stopPropagation();saveFavVideos({[v.id]:{[authUser?.id]:isFav?null:true}});}}
                title={isFav?"Favourited for this venue — click to remove":"Favourite for this venue (leads the results it appears in)"}
                style={{position:"absolute",top:10,right:10,background:tierColor.bg,color:tierColor.color,padding:"3px 10px",borderRadius:10,fontSize:10,fontWeight:600,zIndex:3,cursor:"pointer",boxShadow:isFav?"0 0 0 2px #EF4444":"none"}}>{v.tierCat}</div>
            ); })()}
            {/* Fix tags is internal — this screen gets turned toward a client, and "Fix tags" on
                every tile is the one thing on it that says the library might be wrong. It now
                appears on hover only, in the corner the price doesn't use. Forced visible on touch,
                where there is no hover and it would otherwise be unreachable. */}
            <button className="sb-fix" onClick={(e)=>{e.stopPropagation();setTaxVenueGroup("");setTaxOutsideSub("all");setTaxFixVid(v.id);}}
              title="This video is tagged wrong? Fix its taxonomy"
              style={{position:"absolute",bottom:10,right:10,zIndex:3,padding:"3px 9px",borderRadius:10,
                border:"1px solid rgba(255,255,255,0.35)",background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",
                color:"#fff",fontSize:9.5,fontWeight:600,cursor:"pointer",lineHeight:1.5}}>Fix tags</button>
            {/* ── PRICE BADGE ──
                "Price TBD" is commented out for now, not deleted. It means the video has no zone
                photos tagged, so there is nothing for the costing engine to run over — and right
                now that is nearly every video in the library, so the badge was saying the same
                thing on every card and reading as a defect rather than as information.
                The badge still shows a REAL price wherever one exists. To bring the TBD state back,
                restore the ternary below and drop the !priceTBD guard. */}
            {!priceTBD && <div style={{position:"absolute",bottom:10,left:10,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:600,zIndex:3}}>
              {/* {priceTBD ? "Price TBD" : fmt(v.price)} */}
              {fmt(v.price)}
            </div>}
          </div>
          <div style={{padding:"12px 14px",flex:1,display:"flex",flexDirection:"column"}}>
            <div className="sb-title" style={{fontSize:15.5,fontWeight:600,marginBottom:4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.title}</div>
            <div style={{fontSize:11,color:textS,marginBottom:6}}>{[v.venue, v.fn, v.space].filter(Boolean).join(" · ") || "Untagged"}</div>
            {/* The style/palette chips and the "needs zone photos" strip both came off the card —
                three stacked rows of metadata between the title and the buttons made the grid read
                as dense text rather than as pictures. The tags are still on the video (and still
                filterable from the rail); the unpriced state still shows as the "Price TBD" badge
                on the thumbnail, and Fix tags moved up onto the thumbnail with it. */}
            {/* ── ACTIONS ──
                Two filled buttons per tile, forty tiles to a page, was eighty solid rectangles on
                one screen — the grid read as a control panel rather than as photographs. Same two
                actions, far less weight: the primary becomes a text link, and Exact Look becomes
                the icon beside it. Nothing was dropped, and the Platinum gate still takes the
                whole row because it is a refusal, not an option. */}
            <div style={{marginTop:"auto",paddingTop:10,borderTop:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              {isPlatinum?(
                <div onClick={(e)=>{e.stopPropagation();setPremiaGate({ev:{id:v.id,name:v.title,video:`https://www.youtube.com/embed/${v.id}`}});}} className="sb-gate" style={{width:"100%",padding:"7px 12px",borderRadius:8,background:"linear-gradient(135deg,#EDE9FE,#F5F3FF)",textAlign:"center",fontSize:11,color:"#7C3AED",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><IconCrown size={13}/>Sr. Designer Only</div>
              ):(
                <Fragment>
                  <button className="sb-vc" onClick={(e)=>{e.stopPropagation();guardedPickAndLoadFromVideo(v.id,1);}}
                    title="Load this as the reference and start building"
                    style={{border:"none",background:"transparent",padding:0,color:accentText,fontSize:11.5,fontWeight:700,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6,letterSpacing:0.2}}>
                    Customize<span className="sb-vc-arrow" style={{display:"inline-block"}}>→</span>
                  </button>
                  {!priceTBD&&<button className="sb-icb" onClick={(e)=>{e.stopPropagation();guardedPickAndLoadFromVideo(v.id,2,()=>showMsg("✓ Exact look loaded — review summary","green"));}}
                    title="Exact Look — load this build as-is and jump straight to the summary"
                    style={{width:28,height:28,flexShrink:0,borderRadius:8,padding:0,border:`1px solid ${border}`,background:"transparent",color:textS,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><IconClipboard size={13}/></button>}
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
    // Only the single most recent one gets the full "continue" card — history beyond that lives in
    // the collapsed "Last 5 sessions" list below (bannerHistory), which isn't pill-filtered at all.
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
        if (fnIdx !== null) {
          // The reference video has to be read from the SNAPSHOT being shown, not from the
          // session's flat sourceVideo* fields. Those describe whichever function happened to be
          // active when the session was written, which is frequently not the function this card is
          // badged with — and the rolling autosave sets them to null whenever the active function
          // has no reference video of its own. That is what made the card flip from a real title to
          // "Video (no longer in library)" a second after it appeared: same session, rewritten
          // flat fields. Falls back to the flat fields for legacy sessions that have no snapshots.
          const snap = snaps ? (snaps[fnIdx] || snaps[String(fnIdx)] || null) : null;
          withFn.push({
            ...s,
            _fnIdx: fnIdx,
            sourceVideoId: snap?.sourceVideo?.id || snap?.sourceVideoId || s.sourceVideoId || null,
            sourceVideoTitle: snap?.sourceVideo?.title || snap?.sourceVideoTitle || s.sourceVideoTitle || null,
          });
        }
      }
      const seenIds = new Set();
      const out = [];
      for (const s of withFn) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        out.push(s);
        if (out.length >= 1) break;
      }
      return out;
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
    // Last 5 sessions for this client, most-recent first — the raw history, not the pill-aware
    // dedup bannerSaved does. Collapsed by default (bannerHistoryOpen) since it's a "just in case"
    // list, not something needed on every visit.
    const bannerHistory = (activeClient?.sessions || []).slice(0, 5);
    // Same "which pill actually has data" logic bannerSaved uses above, applied per history row
    // (which — unlike bannerSaved's entries — never got a _fnIdx computed for it) so Resume lands
    // on the function this particular past session holds, not blindly on whichever pill is active now.
    const bestFnIdxForSession = (s) => {
      const snaps = (s.fnSnapshots && typeof s.fnSnapshots === "object") ? s.fnSnapshots : null;
      if (!snaps || !Object.keys(snaps).length) return fnSnapHasData(s) ? 0 : null;
      if (fnSnapHasData(snaps[activeFnIdx] || snaps[String(activeFnIdx)] || null)) return activeFnIdx;
      const idxs = Object.keys(snaps).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
      for (const i of idxs) { if (fnSnapHasData(snaps[i] || snaps[String(i)] || null)) return i; }
      return null;
    };
    const deleteSession = (sessionId) => {
      if (!activeClient) return;
      askConfirm("Delete this saved session?", () => {
        const nextSessions = (activeClient.sessions || []).filter(sess => sess.id !== sessionId);
        saveClientLedger(clientLedger.map(c => c.id === activeClient.id ? { ...c, sessions: nextSessions } : c));
        showMsg("Session deleted", "green");
      }, { yesLabel: "Delete", note: "This can't be undone." });
    };

    // ═══ FILTER PANEL PRESENTATION ═══
    // Now sourced from components/studio/filterUI.jsx so Browse and Build share one panel
    // implementation and cannot drift apart. Emits identical markup to the previous inline copy.
    // ═══ THE FILTER KIT, DARK ═══
    // The filters now live on the panel's ink rather than on the cream page. makeFilterUI is
    // already parameterised by isDark and caches per (isDark, accent, textP), so asking it for the
    // dark skin re-colours every pill, header, count chip and search box WITHOUT touching a line of
    // the filter markup below — and therefore without touching any filter logic. S comes from
    // makeS(true) so the kit's inputs and cards match.
    const PANEL_INK = "#F5F1E7";
    const { hairline, gold, textM, ghostPill, seeMorePill, Pill, Section: FSection, SearchBox: FSearchBox, css: filterCSS } =
      makeFilterUI({ isDark: true, accent, textP: PANEL_INK, S: makeS(true) });
    // Panel-local tokens for the markup in THIS file that doesn't come from the kit.
    // The card ground used to be rgba(255,255,255,0.04) — a 4% white wash over a photograph of
    // candles and flowers, which is no surface at all: the picture read straight through it and the
    // whole filter list looked like text floating on the panel. This is an actual ground, dark
    // enough to sit the labels on and translucent enough (with the blur below) to keep the
    // photograph as depth behind it rather than losing it.
    // Glass is a LIGHT surface, not a dark one. The previous pass made this a dark translucent
    // ground, which on an almost-black panel is a darker rectangle on a dark rectangle — the exact
    // problem it was trying to fix, inverted. Over near-black ink a pale film is what separates,
    // and it is also what glass actually is: it picks up light, it does not absorb it.
    const pBorder = "rgba(255,255,255,0.17)";
    const pCard   = "rgba(255,255,255,0.06)";
    const pTextS  = "rgba(245,241,231,0.62)";
    // ═══ GOLD, ON THE PAGE ═══
    // The kit's `gold` is #D9BE86 because it was asked for the DARK skin — correct inside the ink
    // panel, and far too pale the moment it is used on the cream page, where it sits at roughly 2:1
    // and reads as a smudge. Everything on the light side needs its own value: same hue, dropped
    // far enough to actually hold against the background.
    const pageGold = isDark ? "#D9BE86" : "#8A6A2F";
    // Same story for the muted text and the ghost pill. The kit's textM is #A6ADC0 and its hairline
    // is 8% WHITE — both correct on ink, both close to invisible on cream. That is why the filter
    // count read as a whisper and the Clear all pill looked borderless on the page while the
    // identical pill inside the panel looked fine.
    const pageTextM = isDark ? "#A6ADC0" : "#4F5568";
    const pageGhost = { ...ghostPill, color: pageTextM,
      border: `1px dashed ${isDark ? "rgba(255,255,255,0.20)" : "rgba(26,26,46,0.30)"}`, fontWeight: 700 };


    // How many filters each section is applying — surfaced as a count chip on the section header
    // so you can tell at a glance which groups are narrowing the results.
    const venueGroupActive = venueGroup !== "all" ? 1 : 0;
    const sectionCounts = {
      venue: venueGroupActive + browseVenues.length,
      fn: filterFn.length, tier: filterCat.length, space: filterSpace.length,
      mood: filterMood.length, palette: filterPalette.length,
    };
    const activeTotal = Object.values(sectionCounts).reduce((a, b) => a + b, 0);

    // ═══ THE CURRENT PAGE ═══
    // Clamped, so a filter that shrinks the results below the page you were on lands you on the
    // last real page instead of an empty grid.
    const totalPages = Math.max(1, Math.ceil(shownVideos.length / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const pageVideos = shownVideos.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
    const pageFrom = shownVideos.length ? (safePage - 1) * PER_PAGE + 1 : 0;
    const pageTo = Math.min(safePage * PER_PAGE, shownVideos.length);

    // There is deliberately no featured banner here. The reference design had one, but it carried a
    // hand-written blurb under a curated title — editorial content this app has no way to author.
    // Filling that shape with shownVideos[0] meant a ~340px banner promoting whichever video
    // happened to be tagged first, frequently one with no zone photos (so: "Price TBD", and a dead
    // end in Build). This page's job is scanning many options to pick one, and a large card
    // repeating the first result costs the most valuable space on it to help with none of that.

    const Pager = () => {
      if (totalPages <= 1) return null;
      // A window of five around the current page, with first/last always reachable — 377 videos is
      // 10 pages today and a numbered strip of every page would only get longer as the library does.
      const win = [];
      for (let p = Math.max(1, safePage - 2); p <= Math.min(totalPages, safePage + 2); p++) win.push(p);
      if (win[0] > 1) win.unshift(1);
      if (win[win.length - 1] < totalPages) win.push(totalPages);
      const btn = (on) => ({ minWidth: 30, padding: "5px 9px", borderRadius: 8, fontSize: 11.5,
        fontWeight: on ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap",
        border: `1px solid ${on ? accent : border}`, background: on ? accent : cardBg,
        color: on ? (isDark ? "#1a1a2e" : "#fff") : textP });
      // Back to the top of the grid on every page change — landing halfway down page 3 because
      // that is where you were on page 2 reads as the page not having changed at all.
      const go = (p) => { setPage(p); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); } };
      return (
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"center",padding:"4px 0"}}>
          <button type="button" onClick={()=>go(safePage-1)} disabled={safePage<=1}
            style={{...btn(false),opacity:safePage<=1?0.4:1,cursor:safePage<=1?"default":"pointer"}}>← Prev</button>
          {win.map((p,i)=>(
            <Fragment key={p}>
              {i>0 && win[i-1] !== p-1 && <span style={{color:textM,fontSize:11,padding:"0 2px"}}>…</span>}
              <button type="button" onClick={()=>go(p)} style={btn(p===safePage)}>{p}</button>
            </Fragment>
          ))}
          <button type="button" onClick={()=>go(safePage+1)} disabled={safePage>=totalPages}
            style={{...btn(false),opacity:safePage>=totalPages?0.4:1,cursor:safePage>=totalPages?"default":"pointer"}}>Next →</button>
        </div>
      );
    };

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
.sb-card:hover .sb-title{color:${pageGold}}
/* ══ TYPOGRAPHY ══
   Card titles stay in the SANS. They were briefly set in Playfair to match Event Info's card
   headings, and it was wrong for this content: those headings are two clean words ("Client
   Details"), while these are 15-word YouTube titles carrying pipes, quotation marks and ampersands.
   A high-contrast display serif makes that look messier, not more considered.
   The size and spacing from that attempt are worth keeping — 15.5px with a tighter measure reads
   as a title rather than a filename. The serif is reserved for the page title, where it belongs. */
.sb-title{transition:color .18s ease;letter-spacing:-0.1px;line-height:1.34}
/* Section headings and the count line: wider tracking, and the gold rather than grey, so they read
   as labels on a designed page rather than as debug text above a grid. */
.sb-sect-head{font-family:'Outfit',system-ui,sans-serif !important;
  letter-spacing:1.6px;text-transform:uppercase;font-weight:700}
/* ══ CARD ACTIONS ══
   A text link and an icon, so forty tiles are forty photographs rather than eighty buttons. The
   link's arrow travels on hover — the only motion it needs to read as clickable at this weight. */
.sb-vc,.sb-icb,.sb-gate{transition:filter .16s ease, background .16s ease, border-color .16s ease, color .16s ease, box-shadow .18s ease, transform .14s ease}
.sb-vc-arrow{transition:transform .18s ease}
.sb-vc:hover .sb-vc-arrow{transform:translateX(4px)}
.sb-icb:hover{border-color:${accent} !important;color:${accent} !important;
  background:${isDark?"rgba(201,169,110,0.14)":"#FCF7EC"} !important}
.sb-icb:active{transform:scale(0.94)}
.sb-gate:hover{filter:brightness(0.97);box-shadow:0 8px 18px -8px rgba(124,58,237,0.5) !important}
/* Hide, in the panel's top-right. Quiet until you go near it — it sits over a photograph and a
   solid control up there would compete with the logo. */
.sb-hide-top{transition:background .16s ease, border-color .16s ease, color .16s ease}
.sb-hide-top:hover{background:rgba(0,0,0,0.62) !important;border-color:rgba(255,255,255,0.34) !important;
  color:#F5F1E7 !important}
.sb-hide-top:active{transform:scale(0.96)}
/* ══ FIX TAGS ══
   Internal, on a screen that gets turned toward a client — so it appears on hover and nowhere
   else. Touch has no hover, so it stays put there (see the coarse-pointer block below), and
   keyboard focus brings it back for anyone who never uses a mouse. */
.sb-fix{opacity:0;transition:opacity .18s ease, background .15s ease, border-color .15s ease}
.sb-card:hover .sb-fix,.sb-fix:focus-visible{opacity:1}
.sb-fix:hover{background:rgba(0,0,0,0.78) !important;border-color:rgba(255,255,255,0.7) !important}
.sb-fix:active{transform:scale(0.96)}
/* The featured banner's styles went with the banner itself — see the note where it used to be
   computed. .sb-hero-face stays: it is the display serif, and the page title and the section
   heading both still use it. */
/* The session banner cards use .sb-rcard, which now lives in makeFilterUI so Build's reference
   banner shares one definition with it. Only the banner's ACTIONS are Browse-specific: the outline
   button tints with its OWN colour via currentColor, so one rule serves the amber and indigo card. */
.sb-bnr-btn{transition:filter .16s ease, background .16s ease, box-shadow .18s ease, transform .14s ease}
.sb-bnr-btn:hover{transform:translateY(-1px)}
.sb-bnr-out:hover{background:color-mix(in srgb, currentColor 14%, transparent) !important}
.sb-bnr-solid:hover{filter:brightness(1.10);box-shadow:0 7px 15px -9px rgba(0,0,0,0.6)}
.sb-bnr-btn:active{transform:translateY(0) scale(0.97)}
/* ══ TABLET ══
   The video grid is already auto-fill/minmax(260px), so it reflows on its own. What doesn't is the
   248px filter rail: at 820px it leaves ~550px for the grid, which is two cramped columns.
   Landscape just narrows the rail. Portrait unpins it and lays it across the top instead — a
   sticky full-height rail beside a 550px grid is worse than one you scroll past once. Its own
   max-height (set inline from the viewport) is overridden there, or it would keep a tall scroll
   region in a strip that is now only a few rows deep. */
/* Same display serif as Event Info's title, so the two steps are set in one voice. !important
   because StudioApp sets font-family on the universal selector with !important. */
.sb-hero-face{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif !important;font-style:italic}
/* The ◇ divider from Event Info's title — solid run, diamond, then a fade so it does not read as
   an underline that got cut off. Weighted up from 1.5px to 2.5px and set in the page gold rather
   than the panel's: at a hairline in #D9BE86 on cream it was closer to a scuff on the screen than
   to a rule. The diamond grew with it — a 6px lozenge on a 2.5px line looked like a kink in the
   line rather than a mark on it. */
.sb-title-rule{display:flex;align-items:center;gap:9px;margin-top:15px;width:100%;max-width:520px}
.sb-tr-seg{height:2.5px;border-radius:2px;width:80px;flex-shrink:0;background:${pageGold}}
.sb-tr-dia{width:8px;height:8px;flex-shrink:0;transform:rotate(45deg);background:${pageGold}}
.sb-tr-fade{height:2.5px;border-radius:2px;flex:1;background:linear-gradient(90deg,${pageGold},${pageGold}A6 58%,transparent)}
/* ══ THE PAGE WASH ══
   Event Info's warm ground, brought across so the two steps share one surface. Fixed rather than
   absolute: this view scrolls the whole page, and an absolute layer would scroll its colour away
   and leave the lower half on bare cream. z-index -1 and no pointer events — it sits under
   everything and can never take a click. */
/* z-index 0, NOT -1. A negative index put this behind S.app's own opaque cream background, which
   painted straight over it — the ground was being drawn and then buried. At 0 it sits above that
   background, and .sb-layout below is lifted to 1 so the content still clears it. */
/* ── KEEP THIS LAYER ── A hidden tab has its compositing layers discarded, and coming back rebuilds
   them: here that means re-rasterising 80px-blurred blobs and a blend-mode stack, which shows as a
   flash on fast tab switching. translateZ(0) plus backface-visibility promotes the wash to a layer
   of its own and keeps it there; contain:paint stops its repaints escaping into the page. */
.sb-wash{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
    transform:translateZ(0);backface-visibility:hidden;contain:paint;
  background:${isDark?"#0F0F1A":"#FAF9F6"}}
.sb-wash span{position:absolute;display:block;filter:blur(80px);mix-blend-mode:multiply}
.sb-wash-a{width:760px;height:700px;top:-190px;left:calc(var(--sb-pw) - 150px);
  border-radius:62% 38% 46% 54% / 54% 47% 53% 46%;
  background:radial-gradient(circle,rgba(201,169,110,0.38) 0%,rgba(201,169,110,0) 70%)}
.sb-wash-b{width:640px;height:700px;top:110px;right:-170px;
  border-radius:41% 59% 66% 34% / 38% 62% 38% 62%;
  background:radial-gradient(circle,rgba(214,158,140,0.32) 0%,rgba(214,158,140,0) 72%)}
.sb-wash-c{width:740px;height:660px;top:540px;left:calc(var(--sb-pw) + 12%);
  border-radius:55% 45% 33% 67% / 61% 39% 61% 39%;
  background:radial-gradient(circle,rgba(124,92,214,0.20) 0%,rgba(124,92,214,0) 74%)}
/* ══ THE TOP SHEEN ══
   The strip directly under the bar was bare cream. Every blob starts at or below y=110 and the
   band SVG's first path sits at y=50 of 960, so the first ~110px of the page had nothing in it at
   all — which is exactly the band the eye lands on first, and where the deal line and the filter
   count sit. Same drifting gradient the header carries, so the two read as one surface across the
   seam. A div, not a span, so the blob rule above does not also catch it and blur it to 80px.
   multiply because the page is light: it tints the cream rather than laying a film over it. */
.sb-wash-top{position:absolute;top:0;left:0;right:0;height:330px;pointer-events:none;
  mix-blend-mode:multiply;filter:blur(34px);
  background:linear-gradient(100deg,
    rgba(124,92,214,0) 0%,
    rgba(201,169,110,0.22) 22%,
    rgba(214,158,140,0.17) 50%,
    rgba(124,92,214,0.19) 76%,
    rgba(124,92,214,0) 100%);
  background-size:230% 100%;
  animation:sbSheen 30s ease-in-out infinite alternate}
@keyframes sbSheen{from{background-position:0% 50%}to{background-position:100% 50%}}
/* Blurred hard, which is what turns five stroked paths into folds of light rather than five fat
   curves. Static, so the blur is rasterised once. An svg, not a span, so the blob rule above
   (which targets spans) does not also catch it. */
.sb-bands{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:blur(24px)}
/* Over the bands, so the chalk falls on them and the surface reads as printed rather than airbrushed. */
.sb-grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:${GRAIN_URL};background-size:220px 220px}
/* Each band drifts on its own clock, same as Event Info's. transform-box:view-box pins the
   transform to the SVG's own units, so the travel means user units and not screen pixels.
   alternate plays the keyframes backwards on the return leg, so the motion reverses smoothly and
   never has to land back on its start — and the durations share no common factor, so the five
   never line up into a single pulse. */
.sb-band{transform-box:view-box;transform-origin:center;will-change:transform}
.sb-band-0{animation:sbBand0 34s ease-in-out infinite alternate}
.sb-band-1{animation:sbBand1 45s ease-in-out infinite alternate}
.sb-band-2{animation:sbBand2 38s ease-in-out infinite alternate}
.sb-band-3{animation:sbBand3 53s ease-in-out infinite alternate}
.sb-band-4{animation:sbBand4 41s ease-in-out infinite alternate}
@keyframes sbBand0{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-72px,18px) scaleY(1.1)}}
@keyframes sbBand1{from{transform:translate(0,0) scaleY(1.06)}to{transform:translate(86px,-24px) scaleY(0.94)}}
@keyframes sbBand2{from{transform:translate(0,0) scaleY(0.96)}to{transform:translate(-94px,14px) scaleY(1.12)}}
@keyframes sbBand3{from{transform:translate(0,0) scaleY(1.08)}to{transform:translate(64px,-30px) scaleY(0.95)}}
@keyframes sbBand4{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-78px,22px) scaleY(1.09)}}
/* ══ THE PANEL ══
   The filter rail is now the dark column from the reference. It keeps every behaviour it already
   had — sticky, capped to the viewport, scrolling its own body — and only gains a ground, a curve
   and padding. Extra right padding because the curve eats into that edge and controls sitting
   under it would be unreachable.
   The scrollbar is hidden rather than styled: a light scrollbar track down the middle of the ink
   cuts the panel in half, and the panel already scrolls to its content. */
/* Fixed to the viewport's left edge and full height, like Event Info's — a panel that stops short
   of the screen edge, or ends where its content ends, reads as a sidebar rather than as the page's
   own ground. It keeps its internal scroll, so a long filter list still scrolls inside it.
   Extra right padding: the curve eats that edge, and a pill sitting under it would be unclickable. */
/* top, height and padding-top are set INLINE — see the note there. The panel deliberately runs the
   full height of the viewport and passes behind the header, so no edge has to be aligned. */
/* box-sizing explicitly: the width is --sb-pw and the content is offset by --sb-pw, so the padding
   HAS to be inside that width. Left to content-box the 84px of horizontal padding made the real
   panel 84px wider than the offset, and the curve sat on top of the first column of cards. */
.sb-rail{position:fixed !important;left:0;box-sizing:border-box;
  max-height:none !important;border-radius:0;clip-path:url(#sbBrandCurve);z-index:40;
  background:linear-gradient(160deg,#0F0F1A 0%,#191430 52%,#241a46 100%);
  padding:18px 68px 20px 22px;overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;isolation:isolate}
.sb-rail::-webkit-scrollbar{display:none}
.sb-rail > *{position:relative;z-index:2}
/* The photograph sits behind everything, overflowing by 4% so no scale rounding can leave a strip
   of gradient down an edge. */
.sb-rail-img{position:absolute;inset:-4%;z-index:0;background-size:cover;background-position:center}
/* A scrim, not a vignette: the picture is busy and bright in places, and the filter labels have to
   stay readable wherever they land on it. */
/* Tuned to THIS photograph rather than to a generic one, and the stops run the opposite way to
   where they started. The image is a night shot whose top half is essentially pure black and whose
   candles, roses and glassware all sit in the bottom 45% — so the old heavy-at-both-ends scrim was
   darkening a region that was already black, and then smothering the only part worth showing.
   It now stays light where the picture lives. Nothing sits directly on the panel but the Hide
   button (the filter card brings its own ground), so the veil only has to stop the photograph
   competing with the grid — it does not have to carry type. */
.sb-rail-veil{position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(180deg,rgba(9,9,20,0.52) 0%,rgba(11,9,24,0.44) 40%,rgba(9,9,20,0.34) 72%,rgba(9,9,20,0.46) 100%)}
/* ══ DEPTH ══
   The cast shadow: z-index 39 — above the page so the shadow actually lands on it, below the panel
   (40) so the panel covers everything but the bleed past its edge. Nudged right so the light reads
   as coming from the left. Nothing in it animates, so the blur is rasterised once. */
.sb-rail-shadow{position:fixed;top:0;left:0;width:var(--sb-pw);height:100vh;height:100svh;z-index:39;
  pointer-events:none;filter:blur(24px);opacity:.55;transform:translateX(9px)}
.sb-rail-shadow svg{display:block;width:100%;height:100%}
/* The gold line on the seam. drop-shadow rather than a second wider path: it follows the stroke's
   own alpha, so the bloom tracks the gradient's fade at both ends instead of glowing evenly along a
   line that is meant to be dying out. overflow visible because the path sits ON x=1 — half the
   stroke falls outside the viewBox and would otherwise be clipped away down its length. */
/* z-index 51 — ABOVE the header (50). It was 41, which sat under the bar and only showed because
   the bar is transparent over the panel; now that the navy overlaps the seam by 3px it would have
   buried the line across the whole header band. Up here the gold runs unbroken from the very top of
   the screen to the bottom, which is the point of it. The element is only --sb-pw wide and the path
   sits on its right edge, so it can never cover anything in the bar. */
.sb-rail-edge{position:fixed;top:0;left:0;width:var(--sb-pw);height:100vh;height:100svh;z-index:51;
  pointer-events:none;filter:drop-shadow(0 0 5px rgba(201,169,110,0.45)) drop-shadow(0 0 14px rgba(201,169,110,0.22))}
.sb-rail-edge svg{display:block;width:100%;height:100%;overflow:visible}
/* A lit edge down the left, and the cards inside lifted off the photograph. Together these are
   what stop the panel reading as a flat cut-out: something catching light on one side, and
   contents sitting ABOVE the surface rather than printed onto it. */
.sb-rail::after{content:"";position:absolute;top:0;bottom:0;left:0;width:1px;z-index:3;
  pointer-events:none;background:linear-gradient(180deg,transparent,rgba(255,255,255,0.14) 22%,rgba(255,255,255,0.14) 78%,transparent)}
/* ══ GLASS ══
   Four things together make this read as glass rather than as a translucent box, and it needs all
   four: a heavy blur so what shows through is colour and not detail; saturation pushed past 100 so
   the warm light behind it stays warm instead of going grey the way a plain blur leaves it; a
   diagonal sheen, because real glass is lit unevenly and a flat fill never looks like a pane; and a
   bright top edge with a dark cast below, which is what puts it ABOVE the panel instead of in it.
   background-image carries !important because the inline background shorthand that sets the tint
   also resets background-image to none, and inline beats a plain stylesheet rule. */
.sb-rail .sb-panel{
  backdrop-filter:blur(26px) saturate(165%);-webkit-backdrop-filter:blur(26px) saturate(165%);
  background-image:linear-gradient(147deg,rgba(255,255,255,0.11) 0%,rgba(255,255,255,0.025) 46%,rgba(255,255,255,0.06) 100%) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(255,255,255,0.05),
    0 2px 6px rgba(0,0,0,0.34), 0 22px 48px -16px rgba(0,0,0,0.8)}
.sb-rail .sb-panel:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.05),
  0 2px 6px rgba(0,0,0,0.38), 0 26px 56px -16px rgba(0,0,0,0.85) !important}
/* The warm catch in the top-left corner — the one thing that stops a glass panel reading as flat
   plastic. Gold, because that is the light the rest of the app is lit by. Sits over the whole card
   including its header, which is correct: a sheen falls across a pane, not around its contents. */
.sb-rail .sb-panel::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:4;
  border-radius:inherit;
  background:radial-gradient(130% 62% at 0% 0%,rgba(201,169,110,0.15) 0%,rgba(201,169,110,0.04) 38%,transparent 68%)}
/* Section rows get a radius so the kit's hover fill reads as a tile on the pane rather than a band
   running edge to edge across it. */
.sb-rail .sb-panel .sb-head{border-radius:8px}
/* The kit's 8%-white section rules were drawn for a solid dark card. On a pale pane they vanish and
   the six sections run together as one list. Only the colour is touched — the last section sets
   border-style:none inline, so it stays borderless. */
.sb-rail .sb-panel .sb-scroll > div{border-bottom-color:rgba(255,255,255,0.13) !important}
/* The small cards that share the rail — the session banner and its history — get the same
   treatment at a lighter weight, so the panel holds one family of surfaces rather than three. */
.sb-rail .sb-rcard,.sb-rail .sb-hist{-webkit-backdrop-filter:blur(16px) saturate(150%);
  backdrop-filter:blur(16px) saturate(150%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 26px -12px rgba(0,0,0,0.7)}
/* The content clears the fixed panel. --sb-pw is the one number: panel width and content offset.
   The offset is the panel width PLUS a gutter, not equal to it — the curve reaches the panel's full
   width at its top and bottom, so content starting exactly at --sb-pw touches it there. */
/* --sb-pw lives on :root, not on .sb-view, because the HEADER needs it too and the header is a
   sibling of this view rather than a descendant. Only defined while Browse is mounted — this whole
   stylesheet unmounts with the view. */
:root{--sb-pw:392px}
.sb-layout{margin-left:calc(var(--sb-pw) + 30px);position:relative;z-index:1}
/* ══ THE HEADER, OVER THE PANEL ══
   The bar is see-through across the panel's width so the panel shows through and the column reads
   as one piece from the top of the screen.
   The FIRST attempt at this set background:transparent on the header and repainted the navy with a
   pseudo-element — which left the bar with no background of its own, so the one thing that could
   go wrong took the whole header down onto the cream page, account block and all. This does it in
   the header's OWN background instead: one gradient, transparent up to --sb-pw and solid after it.
   The var() fallback is the safety. If --sb-pw ever fails to resolve it reads 0px, both stops
   collapse to the left edge, and the bar paints solid across its full width — the old, correct
   header. There is no state in which this produces a transparent navbar.
   A straight vertical cut is honest here: the curve is still at 99.4% of the panel's width by the
   time it reaches the bottom of the bar, so within this band the edge IS vertical.
   The bottom border goes transparent — a gold hairline carrying on across the panel would read as
   a seam cutting it in half. */
/* ── THE FUNCTION ROW STOPS AT THE PANEL TOO ──
   On a multi-function deal the header grows a second row of pills, and that row spans the full
   width carrying a gold hairline along its top. Over the transparent window that line ran straight
   across the panel and the FUNCTION label sat on the panel's ink — a seam cutting the column in
   half, which is the gap you see under the logo.
   Offset like everything else keyed to the window, so the row and its rule live on the navy. The
   basis has to shrink by the same amount: flex-basis:100% plus a left margin overflows the header
   and can put a horizontal scrollbar on the page. */
:root[data-sb-rail="1"] .sa-fnrow{margin-left:var(--sb-pw,0px);
  flex-basis:calc(100% - var(--sb-pw,0px)) !important}
/* The bar's drifting sheen has to stop where the bar's background stops. It is a full-width layer
   inside the header, so over the transparent window it was painting its violet straight onto the
   panel — which is exactly why the logo area came out purple while the panel below it was black.
   Same offset as the background, same var() fallback. */
:root[data-sb-rail="1"] .sa-sheen{left:var(--sb-pw,0px) !important}
/* The inset top highlight would draw a hairline across the panel too. */
/* background-origin:border-box is load-bearing, not tidiness. A gradient is laid out over the
   PADDING box by default, and this header has 24px of horizontal padding — so the gradient's zero
   point sat 24px inside the element and the navy began at --sb-pw + 24, while the panel still ended
   at --sb-pw. The 24px between them painted transparent and showed the cream page: the gap on Mac.
   With border-box the gradient's coordinates are the element's own, so --sb-pw means the same
   distance to both the panel and the bar and the two edges meet exactly.
   Declared AFTER the shorthand on purpose: the background shorthand resets background-origin to
   padding-box, so putting it first would have it wiped by the very line it exists to correct. */
   The cut starts 3px EARLY, at --sb-pw minus 3. The panel's edge is a curve and this cut is a
   straight line: by the bottom of the bar the curve has drawn in to about 99.4% of the panel width,
   so a straight cut at exactly --sb-pw left a ~2px strip where neither the panel nor the navy
   painted, and the cream page showed through it. Overlapping by 3px closes that for the whole band —
   the overlap lands on panel ink, which is dark either way, so it costs nothing to look at. */
:root[data-sb-rail="1"] .sa-header{box-shadow:none !important;border-bottom-color:transparent !important;
  background:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--sb-pw,0px) - 3px),
    ${isDark?"#0A0A14":"#0A0619"} calc(var(--sb-pw,0px) - 3px),${isDark?"#07070D":"#130A2E"} 100%) !important;
  background-origin:border-box !important}
/* Hidden panel, no reserved gutter. The offset above is plain CSS keyed to --sb-pw, so folding the
   rail used to leave its 392px behind as empty page — the grid stayed exactly where it was and the
   only thing Hide achieved was removing the filters. Zeroing the variable hands that width to the
   grid, which is the entire point of the control. Two classes deep so it beats the tablet
   breakpoints below, whichever order they land in. */
.sb-view.sb-folded{--sb-pw:0px}
/* ── TABLET, LANDSCAPE ──
   The panel stays a real side column here, which is what the reference shows and what the width
   affords. Only the proportions needed work: at a 260px card minimum an iPad's ~860px of content
   fits three columns and leaves a ragged gap, where 200px fits four and fills the row. Titles come
   down half a step with them, so a four-word name still lands on two lines instead of three.
   The page's own gutter tightens too — S.main's 20px was set for a phone-to-desktop range and is
   the difference between the grid breathing and the grid touching the panel's curve. */
@media (max-width:1180px){
  .sb-layout{gap:16px}
  :root{--sb-pw:300px}
  .sb-rail{padding:14px 52px 16px 16px}
  .sb-view{padding-left:16px !important;padding-right:16px !important}
  .sb-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr)) !important;gap:12px !important}
  .sb-title{font-size:13.5px !important}
  .sb-hero-face{letter-spacing:-0.3px}
}
/* Desktop never sees the scrim: there, the panel has its own column and nothing is behind it. */
.sb-scrim{display:none}
@media (max-width:840px){
  /* ── PORTRAIT: THE PANEL BECOMES A DRAWER ──
     It keeps everything that makes it the panel — fixed, curved, photographed, gold edge, its own
     scroll. What changes is that it stops RESERVING space and starts OVERLAYING it.
     Reserving was the problem. At 284px against an 834px tablet the grid was left ~470px, which is
     two cramped columns of clipped titles beside a panel whose own pills had nowhere to wrap —
     everything on screen squeezed at once so that both could be visible at once. Neither actually
     was. As a drawer the grid gets the full width and the panel gets its real width back, and only
     one of them is in front of you at a time, which is how you use them anyway.
     It also starts closed here (see the filtersOpen initialiser) so the videos are what you land on. */
  :root{--sb-pw:322px}
  .sb-layout{margin-left:0 !important;gap:0}
  /* The curve's true minimum sits inside the waist figure (~0.854), so at 322px the edge reaches
     about 275px — the right padding has to clear that or the pill rows get their ends shaved. */
  .sb-rail{padding:13px 54px 14px 15px}
  /* Full width back, so the cards return to a comfortable size instead of the 190px they had to
     shrink to when the panel was taking a third of the screen. */
  .sb-grid{grid-template-columns:repeat(auto-fill,minmax(215px,1fr)) !important;gap:12px !important}
  .sb-scrim{display:block;position:fixed;inset:0;z-index:38;
    background:rgba(6,6,14,0.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
}
@media (pointer: coarse){
  .sb-pill{min-height:34px}
  /* No hover on touch — Fix tags would be unreachable, and the heart and icon button need a
     finger-sized target rather than a 28px one. */
  .sb-fix{opacity:1}
  .sb-icb{width:34px;height:34px}
}
@media (prefers-reduced-motion: reduce){
  /* The ground keeps its colour, it just stops drifting. */
  .sb-band,.sb-wash-top{animation:none}
  .sb-pill,.sb-head,.sb-card,.sb-thumb,.sb-play,.sb-title,.sb-vc,.sb-icb,.sb-gate,.sb-rcard,.sb-bnr-btn,.sb-vc-arrow{transition:none}
  .sb-pill:hover,.sb-card:hover,.sb-icb:hover,.sb-pill:active,.sb-bnr-btn:hover,.sb-bnr-btn:active,.sb-rcard:hover{transform:none}
  .sb-card:hover .sb-thumb,.sb-card:hover .sb-play,.sb-vc:hover .sb-vc-arrow{transform:none}
  .sb-head span[style*="rotate"]{transition:none}}
`;

    return (
      // maxWidth was S.main's 1200, which left ~350px of dead gutter either side on a desktop
      // monitor and pushed the filter panel far off the left edge. Wider cap + a roomier sidebar.
      <div className={filtersOpen?"sb-view":"sb-view sb-folded"} style={{...S.main,maxWidth:1800,display:"flex",flexDirection:"column",gap:0}}>
        <style>{browseCSS}</style>
        {/* The page's own ground — see .sb-wash. Never receives a click. */}
        <div className="sb-wash" aria-hidden="true">
          <span className="sb-wash-a"/><span className="sb-wash-b"/><span className="sb-wash-c"/>
          {/* Fills the bare strip under the header — see .sb-wash-top. */}
          <div className="sb-wash-top"/>
          {/* The same wave bands and chalk grain Event Info is drawn on, from the shared module —
              the colour fields alone left this page looking flatter than that one. */}
          <svg className="sb-bands" viewBox="0 0 1200 960" preserveAspectRatio="none" focusable="false">
            {WASH_BANDS.map((b,i)=>(
              <path key={i} className={`sb-band sb-band-${i}`} d={b.d} fill="none" stroke={b.c}
                strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
            ))}
          </svg>
          <i className="sb-grain"/>
        </div>
        {/* The "Active function" strip is gone. On a multi-function event the function pills in the
            sticky header already show which one is selected, so this was a full-width bar restating
            it — and it pushed the filters and the first row of videos down to say so. */}
        <div className="sb-layout" style={{display:"flex",gap:24,alignItems:"flex-start"}}>

        {/* ═══ SIDEBAR FILTERS ═══ */}
        {/* top is dynamic: +50 when Row 2 function pills are visible (multi-function event) to avoid overlap with sticky header */}
        {/* The panel is capped to the viewport and scrolls its own body. Left at natural height it
            had no scrollport, so a wheel over the filters scrolled the whole page instead and the
            sections past the fold were only reachable by scrolling the layout beyond them.
            `overscrollBehavior:contain` keeps that scroll from chaining back to the page at the
            ends. The earlier version of this capped the panel and added a fade cue that covered the
            last rows of pills — there is deliberately no overlay here, just a slim scrollbar. */}
        {/* Folded: a slim edge strip that brings the rail back. The label reads vertically so the
            strip stays narrow, matching Build's folded rail. */}
        {!filtersOpen && (
          <div className="sb-foldstrip" onClick={()=>setFiltersOpen(true)} title="Show filters"
            style={{width:38,flexShrink:0,position:"sticky",top:hdrH + 12,alignSelf:"flex-start",cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"12px 0 14px",
              borderRadius:10,border:`1px solid ${border}`,background:cardBg}}>
            <span style={{display:"flex",color:accent}}><IconSearch size={13}/></span>
            <span className="sb-foldlabel" style={{writingMode:"vertical-rl",textOrientation:"mixed",fontSize:9.5,fontWeight:700,
              letterSpacing:1,textTransform:"uppercase",color:textS,whiteSpace:"nowrap"}}>Filters{activeTotal>0?` · ${activeTotal}`:""}</span>
            <span className="sb-foldchev" style={{display:"flex",color:textS,transform:"rotate(-90deg)"}}><IconChevron size={11}/></span>
          </div>
        )}
        {/* The shadow the curved edge throws onto the page. Not box-shadow: the clip-path cuts that
            away with the shape, so it would trace a rectangle rather than the curve. Not
            filter:drop-shadow on the panel either — that re-rasterises a full-height column holding
            a photograph and a scrolling filter list on every frame. This is the same path, filled
            once and blurred, sitting between the page and the panel. */}
        {/* Tablet only (display:none above 840). The panel overlays the grid there, so it needs a
            way out that is not the Hide button behind it, and the page behind needs to read as
            parked rather than as competing. */}
        {filtersOpen && <div className="sb-scrim" onClick={()=>setFiltersOpen(false)} aria-hidden="true"/>}
        {filtersOpen && <div className="sb-rail-shadow" aria-hidden="true">
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" focusable="false"><path d={SB_CURVE} fill="#0B0B16"/></svg>
        </div>}
        {/* ── THE GOLD EDGE ──
            Drawn OVER the panel (z-index 41 against its 40) and outside it, so the rail's own
            clip-path can't halve it. preserveAspectRatio none stretches a 1×1 box to the panel, which
            would normally stretch the stroke with it into a wedge — vector-effect pins the width to
            screen pixels instead, so the line stays even from top to bottom.
            The gradient is the light: faint at the ends, brightest through the middle where the
            curve turns, which is where a real bevel would catch. */}
        {filtersOpen && <div className="sb-rail-edge" aria-hidden="true">
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" focusable="false">
            <defs>
              <linearGradient id="sbEdgeGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#C9A96E" stopOpacity="0.30"/>
                <stop offset="0.16" stopColor="#E4C88F" stopOpacity="0.80"/>
                <stop offset="0.44" stopColor="#F0DCAC" stopOpacity="1"/>
                <stop offset="0.72" stopColor="#D9BE86" stopOpacity="0.82"/>
                <stop offset="1" stopColor="#C9A96E" stopOpacity="0.26"/>
              </linearGradient>
            </defs>
            <path d={SB_EDGE} fill="none" stroke="url(#sbEdgeGold)" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
          </svg>
        </div>}
        {filtersOpen && <div ref={railRef} className="sb-rail" style={{width:"var(--sb-pw)",flexShrink:0,position:"sticky",alignSelf:"flex-start",
          // Runs from the very top of the viewport to the bottom, and simply passes BEHIND the
          // header (z-index 40 against the header's 50). Its content is pushed clear with padding
          // instead. Starting it at railTop left a seam whenever the header's real height wasn't
          // exactly that guess — and it isn't, once the step nav wraps to a second row. This way
          // there is no edge to line up, so there is no gap to get wrong.
          // gap 14, not 10. The rail stacks four unrelated things — a control, a saved deal, its
          // history, and the filter card — and at 10 they read as one run of blocks with no idea
          // where one ends and the next begins. The extra 4px is what separates them into items.
          top:0, height:"100svh", paddingTop:hdrH + 14,
          maxHeight:"none",display:"flex",flexDirection:"column",gap:14}}>
          {/* The curve and the photograph, exactly as Event Info draws them, so moving between the
              two steps doesn't feel like moving between two products. */}
          <svg width="0" height="0" style={{position:"absolute",pointerEvents:"none"}} aria-hidden="true" focusable="false">
            <defs><clipPath id="sbBrandCurve" clipPathUnits="objectBoundingBox"><path d={SB_CURVE}/></clipPath></defs>
          </svg>
          {PANEL_BG && <div className="sb-rail-img" style={{backgroundImage:`url(${PANEL_BG})`}} aria-hidden="true"/>}
          <div className="sb-rail-veil" aria-hidden="true"/>
          {/* Hide, on the panel's own top-right rather than inside the Filters card header — it
              closes the whole panel, not the card it used to sit in, and a control belongs on the
              thing it acts on.
              In the FLOW, not absolutely positioned. It was absolute so it would cost no vertical
              space, but the panel's content begins at the same offset it was pinned to, so it
              simply landed on top of the first card — over that card's own delete button, no less.
              It cannot sit in the header band either: the bar is only transparent there, the
              element is still present and still swallows the click. A 26px row it is. */}
          {/* ═══ YOUR EVENT ═══
              The same block Build's panel opens with, so moving between the two steps does not feel
              like moving between two products. One fact per row: across a 300px column a single
              wrapping sentence breaks in a different place every time a venue name or a date
              changes.
              Hide shares the eyebrow's row rather than owning one above it — on its own it spent a
              whole band on one small control and pushed everything below it down. flex-start with a
              small nudge keeps it level with the eyebrow, not floating beside the serif line.
              Deliberately narrower than Build's: this panel also carries the saved-session card, and
              the demand notes (booked / ongoing / Saya day) are not computed on this step. */}
          <div style={{flexShrink:0,paddingBottom:2}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,marginBottom:6}}>
              <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1.6,textTransform:"uppercase",color:accent,paddingTop:3}}>Your event</div>
              <button type="button" onClick={()=>setFiltersOpen(false)} className="sb-hide-top"
                title="Hide the filters and give the whole width to the videos"
                style={{display:"inline-flex",alignItems:"center",gap:5,flexShrink:0,
                  padding:"5px 11px",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap",
                  border:`1px solid ${pBorder}`,background:"rgba(0,0,0,0.34)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",
                  color:pTextS,fontSize:10.5,fontWeight:600,letterSpacing:0.2}}>
                {/* Rotated to point left — the direction the panel collapses in. */}
                <span style={{display:"inline-flex",transform:"rotate(90deg)"}}><IconChevron size={10}/></span>Hide
              </button>
            </div>
            {clientName && <div className="sb-hero-face" style={{fontSize:27,fontWeight:600,color:PANEL_INK,letterSpacing:-0.3,lineHeight:1.08,marginBottom:12}}>
              Welcome, {clientName}
            </div>}
            {(()=>{
              const row=(icon,text)=>(
                <div style={{display:"flex",alignItems:"center",gap:9,fontSize:12.5,lineHeight:1.35,color:PANEL_INK}}>
                  <span style={{display:"inline-flex",flexShrink:0,color:accent}}>{icon}</span>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{text}</span>
                </div>
              );
              const where=[activeFnMeta?.venue||venue, activeFnMeta?.type].filter(Boolean).join(" · ");
              if(!where && !clientDate) return null;
              return <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",rowGap:9}}>
                {where && row(<IconPalette size={14}/>, where)}
                {clientDate && row(<IconCalendar size={14}/>, (()=>{ try { return new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); } catch { return clientDate; } })())}
              </div>;
            })()}
          </div>
          {/* No logo in the panel. It was put back when the header stopped being transparent here,
              on the reasoning that the header's own mark would be hidden behind the bar — but the
              bar sits ABOVE this column, not over it, so the header's wordmark is fully visible
              directly above this spot. The panel's copy just stacked a second identical wordmark a
              few pixels under the first.
              No event summary here either: the header pills already say which function is active,
              and repeating the couple, venue and date down the panel was information twice over. */}
          {/* No "Refine your vision" heading. The card below it is already titled Filters, so it
              was a label on a label — and it sat directly on the panel photograph, which is the one
              place in this column where type has the least to hold on to. */}
          {/* Saved-session banner. Lives under the filters rather than above the grid: it is a way
              back into a build, not a property of the results, and at the top it pushed the first
              row of videos below the fold. Re-stacked for the 248px column — title, then buttons. */}
          {/* While a function switch renders, this card still describes the function you just LEFT
              — React holds the last committed UI during a transition, and the card is built from
              build state that hasn't been replaced yet. A stale "Saved … · ₹73,570" against a pill
              that already reads Mehendi is worse than showing nothing, so it becomes a skeleton
              until the new function's own session is what's on screen. */}
          {ctx.isFnSwitching ? (
            <div aria-busy="true" style={{display:"flex",flexDirection:"column",gap:10,flexShrink:0,padding:"11px 12px",borderRadius:10,background:isDark?"rgba(234,179,8,0.06)":"rgba(234,179,8,0.05)",border:`1px dashed ${isDark?"rgba(234,179,8,0.28)":"rgba(217,119,6,0.30)"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:13,height:13,borderRadius:"50%",border:`2px solid ${isDark?"rgba(234,179,8,0.35)":"rgba(217,119,6,0.35)"}`,borderTopColor:isDark?"#FBBF24":"#B45309",animation:"sbSkelSpin .6s linear infinite",flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:600,color:isDark?"#FBBF24":"#B45309"}}>Loading this function…</span>
              </div>
              <div style={{height:11,borderRadius:5,background:isDark?"rgba(255,255,255,0.08)":"rgba(26,26,46,0.07)",animation:"sbSkelPulse 1.1s ease-in-out infinite"}}/>
              <div style={{height:11,width:"62%",borderRadius:5,background:isDark?"rgba(255,255,255,0.08)":"rgba(26,26,46,0.07)",animation:"sbSkelPulse 1.1s ease-in-out infinite .15s"}}/>
              <div style={{display:"flex",gap:7}}>
                <div style={{height:26,width:62,borderRadius:7,background:isDark?"rgba(255,255,255,0.06)":"rgba(26,26,46,0.05)"}}/>
                <div style={{height:26,flex:1,borderRadius:7,background:isDark?"rgba(255,255,255,0.06)":"rgba(26,26,46,0.05)"}}/>
              </div>
            </div>
          ) : (bannerSaved.length > 0 || bannerShowCurrent) && (
            <div style={{display:"flex",flexDirection:"column",gap:10,flexShrink:0}}>
              {bannerSaved.map(s => {
                const vid = allVideos.find(v => v.id === s.sourceVideoId);
                // "Continue" only when this really is the build in front of you — same video AND
                // same pill. On another pill it's a Resume, since continuing would carry on with
                // whatever is loaded here rather than with this session.
                const isCurrent = bannerCurrentId === s.sourceVideoId && s._fnIdx === activeFnIdx;
                const videoTitle = s.sourceVideoTitle || vid?.title || "Video";
                const unavailable = !vid && !s.sourceVideoTitle;
                return (
                  <div key={s.sourceVideoId+"_"+s.savedAt} className="sb-rcard" style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"stretch",gap:11,padding:"13px 14px",borderRadius:11,background:isDark?"rgba(234,179,8,0.08)":"rgba(234,179,8,0.07)",border:`1px solid ${isDark?"rgba(234,179,8,0.28)":"rgba(217,119,6,0.30)"}`}}>
                    {s.id && <button onClick={(e)=>{e.stopPropagation();deleteSession(s.id);}} title="Delete this saved session"
                      style={{position:"absolute",top:6,right:6,width:18,height:18,borderRadius:"50%",border:"none",background:"transparent",color:textS,fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>✕</button>}
                    <div style={{display:"flex",alignItems:"flex-start",gap:9,paddingRight:16}}><div style={{flexShrink:0,display:"flex",marginTop:1,color:"#B45309"}}><IconSave size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11.5,fontWeight:600,color:PANEL_INK,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
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
                  <div className="sb-rcard" style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:11,padding:"13px 14px",borderRadius:11,background:isDark?"rgba(99,102,241,0.10)":"rgba(99,102,241,0.06)",border:`1px solid ${isDark?"rgba(99,102,241,0.30)":"rgba(99,102,241,0.25)"}`}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:9}}><div style={{flexShrink:0,display:"flex",marginTop:1,color:"#B45309"}}><IconPalette size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11.5,fontWeight:600,color:PANEL_INK,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{videoTitle}</div>
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
              {/* Collapsed history — the raw last-5, not the pill-aware single "continue" card above.
                  A safety net for "I want an older save back", not something needed on every visit. */}
              {bannerHistory.length > 0 && (
                <div className="sb-hist" style={{borderRadius:10,border:`1px solid ${pBorder}`,overflow:"hidden",background:pCard}}>
                  <button type="button" onClick={()=>setBannerHistoryOpen(v=>!v)} aria-expanded={bannerHistoryOpen}
                    style={{width:"100%",display:"flex",alignItems:"center",gap:7,padding:"10px 12px",border:"none",background:"transparent",cursor:"pointer",textAlign:"left"}}>
                    <span style={{display:"inline-flex",transform:bannerHistoryOpen?"rotate(90deg)":"none",transition:"transform 0.15s ease",color:textS}}><IconChevron size={10}/></span>
                    <span style={{fontSize:10.5,fontWeight:600,color:textS}}>Last {bannerHistory.length} session{bannerHistory.length>1?"s":""}</span>
                  </button>
                  {bannerHistoryOpen && <div style={{padding:"0 8px 8px",display:"flex",flexDirection:"column",gap:3}}>
                    {bannerHistory.map((s,i) => (
                      <div key={s.id||i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"5px 7px",borderRadius:6,background:isDark?"rgba(255,255,255,0.03)":"#FAFAFB"}}>
                        <span style={{fontSize:10,color:textS,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {bannerFmtDate(s.savedAt)}{s.savedBy?` · ${s.savedBy}`:""}{typeof s.total==="number"?` · ${fmt(s.total)}`:""}{s.tier?` ${s.tier}`:""}
                        </span>
                        <span style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                          <span onClick={()=>resumeSavedSession(s, bestFnIdxForSession(s) ?? undefined)} style={{fontSize:9.5,fontWeight:700,color:accent,cursor:"pointer",whiteSpace:"nowrap"}}>↻ Resume</span>
                          {s.id && <span onClick={()=>deleteSession(s.id)} title="Delete this session" style={{fontSize:11,color:textS,cursor:"pointer",lineHeight:1}}>✕</span>}
                        </span>
                      </div>
                    ))}
                  </div>}
                </div>
              )}
            </div>
          )}
          {/* The filter card takes what is left after the banner, and keeps its own scrollport, so a
              long banner shortens the filters rather than pushing them off the bottom of the rail. */}
          {/* sb-panel is the shared filter-panel class from makeFilterUI — Build gets it for free via
              FPanel, and Browse hand-rolls this shell, so it opts in explicitly. Same hover on both
              pages rather than a second lookalike rule that drifts. */}
          {/* flex 0 1 auto, NOT 1 1 auto. Stretching to fill the rail meant the card ran to the
              bottom of the screen no matter how little was in it — with every section collapsed
              that is six rows of glass followed by 400px of empty glass, which reads as something
              failed to load. It now ends where its content ends, and still SHRINKS (the 1 in the
              middle) with its own scrollport when the sections are open and the rail runs out. */}
          <div className="sb-panel" style={{...S.card,background:pCard,border:`1px solid ${pBorder}`,padding:0,width:"100%",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden",flex:"0 1 auto"}}>
            {/* Panel header — total active count + one-click reset. Outside the scrollport, so it
                stays visible while the sections below scroll. */}
            {/* The card's own header. A gold rule under it rather than the kit's hairline, and a
                short gold bar before the word — on a frosted surface a 13px label with a 7% white
                line under it is not a header, it is just the first row. */}
            <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:9,
              padding:"13px 16px",borderBottom:`1px solid ${accent}38`,
              background:"linear-gradient(180deg,rgba(201,169,110,0.13),rgba(201,169,110,0.03))"}}>
              <span aria-hidden="true" style={{width:3,height:14,borderRadius:2,background:accent,flexShrink:0}}/>
              <div style={{fontSize:13.5,fontWeight:700,color:PANEL_INK,letterSpacing:0.2}}>Filters</div>
              {activeTotal > 0 && <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,
                background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{activeTotal}</span>}
              {/* Hide moved out to the panel's own top-right corner — see below. */}
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
                  {/* "Other" said nothing next to "Empanelled" — this is its exact opposite, so name
                      it that. The stored value stays "other" so saved filters keep working. */}
                  <Pill on={outsideSub==="other"} onClick={()=>{setOutsideSub("other");setBrowseVenues([]);setShowMoreOutside(false);}}>Non-empanelled</Pill>
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
        </div>}

        {/* ═══ MAIN CONTENT — VIDEO CARDS ═══ */}
        <div style={{flex:1,minWidth:0}}>
          {/* ── PAGE TITLE ──
              The step used to open straight onto a search box and a count. It is the moment a
              salesperson turns the screen toward a client, so it gets a title that says what the
              screen is for. Set in the same display serif as Event Info's. */}
          <div style={{marginBottom:16}}>
            <div className="sb-hero-face" style={{fontSize:34,fontWeight:600,color:textP,letterSpacing:-0.2,lineHeight:1.1}}>Find Your Inspiration</div>
            {/* No strapline. It restated the title in more words and said nothing the salesperson
                did not already know — the title carries the moment on its own. */}
            <div className="sb-title-rule" aria-hidden="true">
              <span className="sb-tr-seg"/><span className="sb-tr-dia"/><span className="sb-tr-fade"/>
            </div>
            {/* main moved the guest/date/venue line out of the header and put a copy here, beside
                the title. This branch moved the same line out of the header too, to a strip
                directly under the bar (StudioApp). Both survived the merge, which would have
                rendered it twice on this page — keeping the one under the bar, which is where it
                was asked for, and because it then appears on Build and Summary as well rather than
                on Browse alone. */}
          </div>
          {/* ── SEARCH ──
              Just the search. A Filters button sat here for a while, duplicating the fold the panel
              header already has, and a Saved button beside it — both came off: the rail is the one
              place filtering happens, and a second set of controls opposite it only made you decide
              which of the two to reach for. */}
          <div className="sb-toolbar" style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <div style={{position:"relative",flex:"1 1 260px",maxWidth:420}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",display:"flex",color:textM,pointerEvents:"none"}}><IconSearch size={13}/></span>
              <input value={vq} onChange={e=>setVq(e.target.value)} placeholder="Search by name, venue, style, mood…"
                style={{...S.input,marginBottom:0,padding:"9px 32px 9px 34px",fontSize:12.5,borderRadius:10}}/>
              {vq&&<span onClick={()=>setVq("")} title="Clear the search" style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:textM,fontSize:13,fontWeight:700,lineHeight:1}}>✕</span>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:11,marginBottom:14,flexWrap:"wrap"}}>
            {/* The section this grid is. Same display serif as the page title, which is what ties
                the two together — and it names what changed when you searched. */}
            <div className="sb-hero-face" style={{fontSize:20,fontWeight:600,color:textP,letterSpacing:-0.1}}>
              {vq.trim() ? "Search Results" : "Curated for Your Event"}
            </div>
            {/* The headline number is always what is ON SCREEN. It used to read "130 videos at
                Aura", which was false — 130 was the whole Inhouse group while only 12 are tagged
                Aura. No venue clause here any more: the section headings below carry the per-venue
                counts, and repeating them next to the total is what made the two look contradictory. */}
            {/* While searching, shownVideos comes from browseVideosAll (filters ignored), so the
                "of N" comparison has to be against that same full catalog, not the filtered count —
                otherwise a search matching more than the filters currently allow read as broken. */}
            <div style={{fontSize:13,fontWeight:600,color:textP}}>{shownVideos.length} video{shownVideos.length===1?"":"s"}{vq.trim()&&browseVideosAll.length!==shownVideos.length&&<span style={{fontWeight:500,color:pageTextM}}> of {browseVideosAll.length}</span>}
              {totalPages>1&&<span style={{fontWeight:500,color:pageTextM}}> · showing {pageFrom}–{pageTo}</span>}</div>
            <div style={{fontSize:12,color:pageTextM}}>{browseVenues.length===0&&venueGroup!=="all"?`(${venueGroup})`:""}</div>
            {activeTotal>0&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11.5,fontWeight:600,color:pageTextM}}>{activeTotal} filter{activeTotal===1?"":"s"} applied</span>
              <div className="sb-pill sb-ghost" onClick={clearAllFilters} style={pageGhost}>Clear all</div>
            </div>}
          </div>
          {/* Picking a venue ranks rather than filters (see browseVideos), so the grid holds the
              chosen venue's videos followed by everything else. Split them under headings —
              unlabelled, a list that still shows other venues just looks like a broken filter. */}
          {/* One pager, at the bottom. Two sets of controls on one screen made you decide which to
              press, and the top one sat between the count and the grid it was counting. */}
          {(()=>{
            // Paginate the FLAT list, then re-split the page into its three groups. Paginating each
            // group separately would mean three sets of controls and pages of wildly different
            // lengths; this way every page is 40 and the headings still describe what is under them
            // — a page can simply run out of "tagged here" partway down and continue into the rest.
            const preferred = pageVideos.filter(v=>v._venueMatch);
            // Three groups, not two. The tail used to be labelled "from other venues", but ~191 of
            // the library has no venue tag at all, so that heading was describing them wrongly. They
            // are worth showing AND worth naming: an untagged video is a usable reference and a
            // to-do at the same time, and lumping it in with real venues hides both facts.
            const otherVenues = pageVideos.filter(v=>!v._venueMatch && v.venue);
            const noVenue = pageVideos.filter(v=>!v._venueMatch && !v.venue);
            const grid = {display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14};
            const heading = (text,sub)=><div style={{display:"flex",alignItems:"baseline",gap:9,margin:"6px 0 12px"}}>
              <span className="sb-sect-head" style={{fontSize:10,color:pageGold}}>{text}</span>
              {sub&&<span style={{fontSize:10.5,color:pageTextM,fontWeight:500}}>{sub}</span>}
            </div>;
            const rule = <div style={{height:1,background:border,margin:"22px 0 14px"}}/>;
            // No venue picked (or nothing matched it) — one plain grid, exactly as before.
            if (!preferred.length || (!otherVenues.length && !noVenue.length)) return <div className="sb-grid" style={grid}>{pageVideos.map(v=><VideoCard key={v.id} v={v}/>)}</div>;
            return <>
              {heading(browseVenues.length===1?browseVenues[0]:"Selected venues",`${preferred.length} tagged here`)}
              <div className="sb-grid" style={grid}>{preferred.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              {otherVenues.length>0&&<>
                {rule}
                {heading("More references",`${otherVenues.length} from other venues`)}
                <div className="sb-grid" style={grid}>{otherVenues.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              </>}
              {noVenue.length>0&&<>
                {rule}
                {heading("Not tagged to a venue",`${noVenue.length} — still usable, but nobody has said where they were shot`)}
                <div className="sb-grid" style={grid}>{noVenue.map(v=><VideoCard key={v.id} v={v}/>)}</div>
              </>}
            </>;
          })()}
          {totalPages>1&&<div style={{marginTop:18}}><Pager/></div>}
          {shownVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textM,background:cardBg,borderRadius:14,border:`1px dashed ${border}`}}>
            <div style={{fontSize:14,fontWeight:600,color:textP,marginBottom:4}}>No videos match these filters</div>
            <div style={{fontSize:12,marginBottom:activeTotal>0?14:12}}>Try changing filters, or tag more videos in Manage → Library</div>
            {/* The dead end is almost always a filter left on in a section scrolled out of view —
                so offer the reset right where the user hits it. */}
            {activeTotal>0&&<button className="sb-pill sb-ghost" onClick={clearAllFilters}
              style={{...ghostPill,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",fontSize:11.5,borderStyle:"solid",borderColor:accent,color:pageGold,background:isDark?"transparent":"#FFFCF4"}}>
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
                          {/* Same rename as the filter rail above — one label for one concept. */}
                          {chip("Non-empanelled", taxOutsideSub === "other", () => setTaxOutsideSub("other"))}
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

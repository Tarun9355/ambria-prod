import { memo } from "react";

// ═══ VIDEO PLAYER MODAL — extracted + memoized to cut main-thread churn during YouTube playback ═══
// Reported bug: lag/stutter playing videos from Browse. Traced to StudioModals.jsx (which owns this
// block): it isn't memoized, its `ctx` prop is a brand-new object built fresh on every StudioApp
// render, and StudioApp re-renders on every Supabase realtime event (library/inventory/rate_card/
// video_tags/client_ledger/studio_sessions/blocks/…) plus the 1.5s-debounced and 15s-periodic
// autosave ticks. None of that has anything to do with a video someone is watching, but every single
// one of those triggers used to re-run this ENTIRE block from scratch — re-matching regexes,
// rebuilding embedSrc/wurl strings, recreating every nested element, and sending the whole subtree
// through React's reconciler — even though the visible output never changed. On a modest laptop
// that's real main-thread contention fighting the YouTube iframe's own decode/paint work for the
// same frame budget, which is what playback stutter from an otherwise-idle background tab looks like.
//
// Fix: lift this out into its own component and wrap it in React.memo. Every prop it takes is either
// a primitive (videoPlaying/videoOverlay booleans, or the videoModal object itself — a plain React
// state value that only gets a new reference when setVideoModal is actually called), a useState
// setter (React guarantees these never change identity), or a useCallback'd handler (showMsg is
// already stable; guardedPickAndLoad was made stable for this — see its own comment in
// StudioModals.jsx). Default shallow-prop React.memo comparison is therefore correct with no custom
// comparator needed: this component now only re-renders when something about THIS modal actually
// changed, never on an unrelated realtime/autosave tick — including all of them that fire while a
// video is actually playing.
function VideoPlayerModal({ videoModal, setVideoModal, videoPlaying, setVideoPlaying, videoOverlay, setVideoOverlay, showMsg, guardedPickAndLoad }) {
  if (!videoModal) return null;
  return (
      <div style={{position:"fixed",inset:0,background:"#000",zIndex:100,display:"flex",flexDirection:"column"}} onClick={()=>{setVideoModal(null);setVideoPlaying(false);setVideoOverlay(false);}}>
        <div style={{flex:1,position:"relative",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
            {videoModal.video?(()=>{const vm=videoModal.video.match(/embed\/([a-zA-Z0-9_-]{11})/);const vl=videoModal.video.match(/list=([a-zA-Z0-9_-]+)/);const tid=vm?vm[1]:null;const wurl=tid&&tid!=="videoseries"?`https://www.youtube.com/watch?v=${tid}${vl?"&list="+vl[1]:""}`:vl?`https://www.youtube.com/playlist?list=${vl[1]}`:videoModal.video;const embedSrc=videoModal.video+(videoModal.video.includes("?")?"&":"?")+"autoplay=1&rel=0&modestbranding=1";const doCopy=(e)=>{e.stopPropagation();try{navigator.clipboard.writeText(wurl);showMsg("✓ YouTube link copied!","green");}catch{}};return <div style={{width:"100%",height:"100%"}}>{videoPlaying&&!videoOverlay?<iframe src={embedSrc} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; encrypted-media; fullscreen" allowFullScreen title="YouTube video"/>:<div onClick={(e)=>{e.stopPropagation();if(videoOverlay){setVideoOverlay(false);}setVideoPlaying(true);}} style={{width:"100%",height:"100%",cursor:"pointer",position:"relative",background:videoModal.gradient}}>
              {(videoModal.img||videoModal.photos?.[0])&&<img src={videoModal.img||videoModal.photos?.[0]} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:videoOverlay?0.2:0.6}} onError={e=>{e.target.style.display="none"}}/>}
              {videoOverlay?<div style={{position:"absolute",inset:0,background:"rgba(10,10,20,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
                <div style={{fontSize:28,fontWeight:500,color:"#C9A96E",letterSpacing:3}}>AMBRIA</div>
                <div style={{fontSize:14,color:"rgba(255,255,255,0.6)"}}>Loved this look? Let's build your dream decor.</div>
                <div style={{display:"flex",gap:10,marginTop:12}}>
                  <button onClick={(e)=>{e.stopPropagation();setVideoOverlay(false);setVideoPlaying(true);}} style={{padding:"12px 28px",borderRadius:10,border:"1.5px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff",fontSize:14,fontWeight:500,cursor:"pointer"}}>{"↺"} Replay</button>
                  <button onClick={(e)=>{e.stopPropagation();guardedPickAndLoad(videoModal,1,videoModal.video);}} style={{padding:"12px 28px",borderRadius:10,border:"none",background:"#C9A96E",color:"#0a0a14",fontSize:14,fontWeight:600,cursor:"pointer"}}>{"🎨"} Customize</button>
                  {/* EXACT LOOK — HIDDEN FOR NOW (end-of-video overlay). See the note on the other
                      copy in the bar below; both are hidden together so the popup never offers the
                      action in one place and not the other.
                      <button onClick={(e)=>{e.stopPropagation();guardedPickAndLoad(videoModal,2,videoModal.video,()=>showMsg("Exact look loaded","green"));}} style={{padding:"12px 28px",borderRadius:10,border:"1.5px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff",fontSize:14,fontWeight:500,cursor:"pointer"}}>{"📋"} Exact Look</button>
                  */}
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
            {/* PRICE + TIER — HIDDEN FOR NOW, on the owner's instruction.
                The tier chip goes with the price rather than staying behind, because it is the
                same number in another form: getCat() buckets the very same getFullCost(), and
                getCat(0) returns "Silver" — so a video costing ₹0 was being labelled Silver.
                Leaving the chip would have kept publishing that figure with the number that
                explains it removed.
                <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:700,color:"#C9A96E"}}>{fmt(getFullCost(videoModal))}</div><span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:getCat(getFullCost(videoModal)).bg,color:getCat(getFullCost(videoModal)).color,fontWeight:600}}>{getCat(getFullCost(videoModal)).label}</span></div>
            */}
            <button onClick={()=>{guardedPickAndLoad(videoModal,1,videoModal.video);}} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#C9A96E",color:"#0a0a14",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{"🎨"} Customize</button>
            {/* EXACT LOOK — HIDDEN FOR NOW, on the owner's instruction. Customize is the only way
                into a build from this popup while this stands.
                Commented rather than deleted: the handler and its guards are unchanged, so
                bringing it back is uncommenting this. targetStep 2 is what makes Exact Look
                different from Customize — it lands on Summary rather than Build — and that is the
                detail most easily lost if the button were rewritten from memory later.
                <button onClick={()=>{guardedPickAndLoad(videoModal,2,videoModal.video,()=>showMsg("Exact look loaded","green"));}} style={{padding:"8px 18px",borderRadius:8,border:`1.5px solid #C9A96E`,background:"transparent",color:"#C9A96E",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{"📋"} Exact Look</button>
            */}
          </div>
        </div>}
      </div>
  );
}

export default memo(VideoPlayerModal);

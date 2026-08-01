import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconExpand } from "../icons.jsx";

// ═══ LAZY YOUTUBE — click-to-load, no iframe until user taps play ═══
// Two ways to watch. Playing in place keeps the surrounding page intact, but the callers embed this
// at thumbnail size — the reference banner's slot is 168px wide — so an inline player is only ever
// a preview. The expand control opens the same video in a full-screen overlay, which is what you
// actually want when judging a reference. Both are offered; neither is forced.
export default function LazyYT({ src, gradient, style, poster, title }) {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const vidMatch = src?.match(/embed\/([a-zA-Z0-9_-]{11})/);
  const listMatch = src?.match(/list=([a-zA-Z0-9_-]+)/);
  const thumbId = vidMatch ? vidMatch[1] : null;
  const watchUrl = thumbId && thumbId !== "videoseries"
    ? `https://www.youtube.com/watch?v=${thumbId}${listMatch ? "&list=" + listMatch[1] : ""}`
    : listMatch ? `https://www.youtube.com/playlist?list=${listMatch[1]}` : src?.replace("/embed/", "/watch?v=");
  const embedUrl = src ? (src + (src.includes("?") ? "&" : "?") + "autoplay=1&rel=0&modestbranding=1") : "";
  const doCopy = (e) => { e.stopPropagation(); try { navigator.clipboard.writeText(watchUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  // Expanding stops the inline player rather than leaving it running behind the overlay — two
  // copies of the same video playing over each other is the obvious failure here.
  const expand = (e) => { e.stopPropagation(); setPlaying(false); setExpanded(true); };

  // Esc closes, and the page behind is frozen so a wheel over the backdrop doesn't scroll the build
  // out from under the overlay.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", onKey); };
  }, [expanded]);

  // Sits over the media area, top-right. Shown whether or not the inline player is running, so you
  // can start small and go big without backing out first.
  const expandBtn = src && (
    <div onClick={expand} role="button" title="Watch full screen"
      style={{position:"absolute",top:6,right:6,zIndex:3,width:26,height:26,borderRadius:7,cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",
        background:"rgba(0,0,0,0.55)",backdropFilter:"blur(3px)",border:"1px solid rgba(255,255,255,0.22)"}}>
      <IconExpand size={13}/>
    </div>
  );

  return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",...style}}>
      <div style={{flex:1,position:"relative",background:gradient||"#000",overflow:"hidden",minHeight:60}}>
        {playing ? (
          <iframe src={embedUrl} style={{width:"100%",height:"100%",border:"none",position:"absolute",inset:0}} allow="autoplay; encrypted-media" allowFullScreen title={title||"YouTube video"}/>
        ) : (
          <div onClick={(e)=>{e.stopPropagation();setPlaying(true);}} style={{width:"100%",height:"100%",cursor:"pointer"}}>
            {poster && <img src={poster} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.8}} onError={e=>{e.target.style.display="none"}}/>}
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{width:56,height:40,borderRadius:10,background:"rgba(255,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(255,0,0,0.4)"}}>
                <div style={{width:0,height:0,borderLeft:"14px solid #fff",borderTop:"9px solid transparent",borderBottom:"9px solid transparent",marginLeft:3}}/>
              </div>
            </div>
          </div>
        )}
        {expandBtn}
      </div>
      <div onClick={doCopy} style={{padding:"5px 10px",background:copied?"#16A34A":"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",gap:6}}>
        <div style={{fontSize:10,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{watchUrl}</div>
        <div style={{fontSize:10,fontWeight:600,color:copied?"#fff":"#C9A96E",whiteSpace:"nowrap"}}>{copied?"✓ Copied!":"📋 Copy link"}</div>
      </div>

      {/* Portalled to <body> so no ancestor's overflow:hidden, transform or z-index can clip it —
          this renders from inside a card that has all three. */}
      {expanded && createPortal(
        <div onClick={()=>setExpanded(false)}
          style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.88)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"28px 24px"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"min(1180px,100%)",display:"flex",alignItems:"center",gap:12}}>
            <div style={{flex:1,minWidth:0,color:"#fff",fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title||"Reference video"}</div>
            {watchUrl && <a href={watchUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
              style={{fontSize:11,fontWeight:600,color:"#C9A96E",textDecoration:"none",whiteSpace:"nowrap"}}>Open on YouTube ↗</a>}
            <div onClick={()=>setExpanded(false)} role="button" title="Close (Esc)"
              style={{cursor:"pointer",color:"#fff",fontSize:24,lineHeight:1,padding:"0 4px"}}>×</div>
          </div>
          {/* 16:9 via aspect-ratio, capped by height too so a short window shrinks the width rather
              than pushing the player off the bottom of the screen. */}
          <div onClick={e=>e.stopPropagation()}
            style={{width:"min(1180px,100%)",aspectRatio:"16 / 9",maxHeight:"calc(100vh - 120px)",
              borderRadius:12,overflow:"hidden",background:"#000",boxShadow:"0 24px 70px rgba(0,0,0,0.6)"}}>
            <iframe src={embedUrl} style={{width:"100%",height:"100%",border:"none",display:"block"}}
              allow="autoplay; encrypted-media; fullscreen" allowFullScreen title={title||"YouTube video"}/>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

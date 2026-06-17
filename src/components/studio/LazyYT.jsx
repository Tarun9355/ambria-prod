import { useState } from "react";

// ═══ LAZY YOUTUBE — click-to-load, no iframe until user taps play ═══
export default function LazyYT({ src, gradient, style, poster }) {
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const vidMatch = src?.match(/embed\/([a-zA-Z0-9_-]{11})/);
  const listMatch = src?.match(/list=([a-zA-Z0-9_-]+)/);
  const thumbId = vidMatch ? vidMatch[1] : null;
  const watchUrl = thumbId && thumbId !== "videoseries"
    ? `https://www.youtube.com/watch?v=${thumbId}${listMatch ? "&list=" + listMatch[1] : ""}`
    : listMatch ? `https://www.youtube.com/playlist?list=${listMatch[1]}` : src?.replace("/embed/", "/watch?v=");
  const embedUrl = src ? (src + (src.includes("?") ? "&" : "?") + "autoplay=1&rel=0&modestbranding=1") : "";
  const doCopy = (e) => { e.stopPropagation(); try { navigator.clipboard.writeText(watchUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",...style}}>
      <div style={{flex:1,position:"relative",background:gradient||"#000",overflow:"hidden",minHeight:60}}>
        {playing ? (
          <iframe src={embedUrl} style={{width:"100%",height:"100%",border:"none",position:"absolute",inset:0}} allow="autoplay; encrypted-media" allowFullScreen title="YouTube video"/>
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
      </div>
      <div onClick={doCopy} style={{padding:"5px 10px",background:copied?"#16A34A":"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",gap:6}}>
        <div style={{fontSize:10,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{watchUrl}</div>
        <div style={{fontSize:10,fontWeight:600,color:copied?"#fff":"#C9A96E",whiteSpace:"nowrap"}}>{copied?"✓ Copied!":"📋 Copy link"}</div>
      </div>
    </div>
  );
}

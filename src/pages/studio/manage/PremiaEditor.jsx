// ═══ MANAGE → PRICING → AMBRIA PREMIA (Platinum gate) editor ═══
// Edits the copy + CTA shown when a salesperson tries to load a Platinum design.
// Admin-only. Saves to settings (ambria-premia-config-v1) and is live across devices.
// Faithful transcription of AdminPremia (App_latest.jsx 12336-12422), driven off ctx.

export default function PremiaEditor({ ctx }) {
  const {
    isAdmin, isDark, border, textS, S,
    premiaConfig, premiaDraft, setPremiaDraft,
    premiaEditorOpen, setPremiaEditorOpen,
    premiaPreview, setPremiaPreview,
    savePremiaConfig, PREMIA_DEFAULTS,
  } = ctx;

  if (!isAdmin) return null;
  const draft = premiaDraft;
  const setDraft = setPremiaDraft;
  const open = premiaEditorOpen;
  const setOpen = setPremiaEditorOpen;
  const preview = premiaPreview;
  const setPreview = setPremiaPreview;
  const dirty = JSON.stringify(draft) !== JSON.stringify(premiaConfig);
  const upd = (k, v) => setDraft(p => ({ ...p, [k]: v }));
  const save = async () => { await savePremiaConfig(draft); };
  const reset = () => setDraft(PREMIA_DEFAULTS);

  return (
    <div style={{marginTop:20,background:isDark?"#0F0F1A":"#fff",borderRadius:12,border:`1px solid ${border}`,overflow:"hidden"}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",background:isDark?"#0A0A14":"#F9F9F6"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.04em",padding:"3px 8px",borderRadius:5,background:"#26215C",color:"#CECBF6"}}>AMBRIA PREMIA</div>
          <div style={{fontSize:13,fontWeight:600,color:isDark?"#E5E5E5":"#1a1a2e"}}>Platinum gate message</div>
          {dirty && <div style={{fontSize:10,color:"#F59E0B",fontWeight:600}}>• unsaved</div>}
        </div>
        <div style={{fontSize:14,color:textS}}>{open?"▴":"▾"}</div>
      </div>
      {open && <div style={{padding:"16px 18px",borderTop:`1px solid ${border}`}}>
        <div style={{fontSize:11,color:textS,marginBottom:12,lineHeight:1.6}}>Shown when someone tries to customize a Platinum-tier design. Leave <code style={{padding:"1px 4px",borderRadius:3,background:isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)"}}>CTA URL</code> blank to hide the action button.</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>Badge</div>
            <input value={draft.badge} onChange={e=>upd("badge",e.target.value)} style={{...S.input,width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>Close button label</div>
            <input value={draft.closeLabel} onChange={e=>upd("closeLabel",e.target.value)} style={{...S.input,width:"100%"}}/>
          </div>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>Title</div>
          <input value={draft.title} onChange={e=>upd("title",e.target.value)} style={{...S.input,width:"100%"}}/>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>Subtitle</div>
          <input value={draft.subtitle} onChange={e=>upd("subtitle",e.target.value)} style={{...S.input,width:"100%"}}/>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>Body (supports line breaks)</div>
          <textarea value={draft.body} onChange={e=>upd("body",e.target.value)} rows={5} style={{...S.input,width:"100%",resize:"vertical",fontFamily:"inherit",lineHeight:1.6}}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div>
            <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>CTA button label</div>
            <input value={draft.ctaLabel} onChange={e=>upd("ctaLabel",e.target.value)} style={{...S.input,width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:textS,marginBottom:4,fontWeight:600}}>CTA URL <span style={{color:textS,fontWeight:400}}>(blank to hide)</span></div>
            <input value={draft.ctaUrl} onChange={e=>upd("ctaUrl",e.target.value)} placeholder="https://wa.me/91XXXXXXXXXX  or  tel:+91...  or  mailto:..." style={{...S.input,width:"100%"}}/>
          </div>
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
          <button onClick={()=>setPreview(true)} style={S.btn(false)}>Preview</button>
          <button onClick={reset} style={S.btn(false)}>Reset to defaults</button>
          <button onClick={save} disabled={!dirty} style={{...S.btn(true),opacity:dirty?1:0.4,cursor:dirty?"pointer":"not-allowed"}}>Save</button>
        </div>
      </div>}
      {preview && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setPreview(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:isDark?"#1a1a2e":"#fff",borderRadius:14,maxWidth:440,width:"100%",overflow:"hidden",border:`1px solid ${border}`}}>
          <div style={{background:isDark?"#0F0F1A":"#F5F3EE",padding:"20px 24px 16px",borderBottom:`1px solid ${border}`}}>
            <div style={{display:"inline-block",background:"#26215C",color:"#CECBF6",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:5,letterSpacing:"0.04em",marginBottom:10}}>{draft.badge}</div>
            <div style={{fontSize:18,fontWeight:600,color:isDark?"#F5F5F0":"#1a1a2e"}}>{draft.title}</div>
            <div style={{fontSize:12,color:textS,marginTop:3}}>{draft.subtitle}</div>
          </div>
          <div style={{padding:"18px 24px 12px",whiteSpace:"pre-wrap",fontSize:13,lineHeight:1.7,color:isDark?"#E5E5E5":"#1a1a2e"}}>{draft.body}</div>
          <div style={{padding:"12px 24px 20px",display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={()=>setPreview(false)} style={{background:"transparent",border:`1px solid ${border}`,color:isDark?"#E5E5E5":"#1a1a2e",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>{draft.closeLabel}</button>
            {draft.ctaLabel && draft.ctaUrl && <button style={{background:"#26215C",border:"1px solid #26215C",color:"#EEEDFE",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>{draft.ctaLabel}</button>}
          </div>
          <div style={{padding:"8px 24px 14px",fontSize:10,color:textS,textAlign:"center",borderTop:`1px solid ${border}`,background:isDark?"#0A0A14":"#F9F9F6"}}>Preview — no live CTA</div>
        </div>
      </div>}
    </div>
  );
}

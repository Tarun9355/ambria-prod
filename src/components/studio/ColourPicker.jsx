// ═══ §23 Phase 2.9 (26 May 2026) — Shared Colour Picker (3-group palette-driven) ═══
// Used by: Build screen paintOverride pill + (future) fabric Liza colour picker.
// Groups: BASE (no override) → ⭐ MATCHES PALETTE → COMPATIBLE (neutral) → OTHER.
// Props: open, onClose, currentColour (string|null), baseColour (string), paintCost (₹),
//        colourCatalogue [{name,hex,isNeutral}], paletteCatalogue [{name,anchorColours[]}],
//        palette (current event/fn palette name), onPick(colourName|null) — null means "use base".
export default function ColourPicker({ open, onClose, currentColour, baseColour, paintCost, colourCatalogue, paletteCatalogue, palette, onPick }) {
  if (!open) return null;
  const catalogue = Array.isArray(colourCatalogue) ? colourCatalogue : [];
  const palettes = Array.isArray(paletteCatalogue) ? paletteCatalogue : [];
  const pObj = palettes.find(p => p.name === palette);
  const anchors = pObj?.anchorColours || [];
  const anchorSet = new Set(anchors);
  const matchesPalette = catalogue.filter(c => anchorSet.has(c.name));
  const compatible    = catalogue.filter(c => !anchorSet.has(c.name) && c.isNeutral);
  const other         = catalogue.filter(c => !anchorSet.has(c.name) && !c.isNeutral);
  const baseObj = catalogue.find(c => c.name === baseColour);
  const Swatch = ({c, isCurrent, onClick}) => (
    <button onClick={onClick}
      style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,border:isCurrent?"2px solid #FBBF24":"1px solid #e5e7eb",background:isCurrent?"rgba(251,191,36,0.08)":"#fff",cursor:"pointer",fontSize:12,fontWeight:isCurrent?700:400,textAlign:"left",width:"100%"}}>
      <span style={{width:18,height:18,borderRadius:4,border:"1px solid rgba(0,0,0,0.15)",background:c.hex||"#ccc",flexShrink:0}} />
      <span style={{flex:1}}>{c.name}</span>
      {paintCost > 0 && <span style={{fontSize:10,color:"#888"}}>+₹{paintCost}</span>}
      {isCurrent && <span style={{fontSize:14}}>✓</span>}
    </button>
  );
  const Section = ({title, items, hint}) => items.length === 0 ? null : (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:700,color:"#666",letterSpacing:0.6,textTransform:"uppercase",marginBottom:5}}>{title}{hint?<span style={{fontSize:9,fontWeight:400,marginLeft:6,color:"#999"}}>{hint}</span>:null}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:5}}>
        {items.map(c => <Swatch key={c.name} c={c} isCurrent={c.name === currentColour} onClick={() => onPick(c.name)} />)}
      </div>
    </div>
  );
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,maxWidth:480,width:"100%",maxHeight:"85vh",overflowY:"auto",padding:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:"#222"}}>🎨 Pick Paint Colour</div>
            {palette && palette !== "Custom" && <div style={{fontSize:10,color:"#888",marginTop:2}}>Event Palette: <strong style={{color:"#7c3aed"}}>{palette}</strong></div>}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#888"}}>×</button>
        </div>
        {/* Base — no override option */}
        <div style={{marginBottom:12,padding:"8px 10px",background:"#F5F0E1",border:"1px solid #C5A572",borderRadius:8}}>
          <button onClick={() => onPick(null)}
            style={{display:"flex",alignItems:"center",gap:8,padding:0,border:"none",background:"none",cursor:"pointer",fontSize:12,fontWeight:!currentColour?700:400,width:"100%",textAlign:"left"}}>
            <span style={{width:18,height:18,borderRadius:4,border:"1px solid rgba(0,0,0,0.15)",background:baseObj?.hex||"#F5F0E1",flexShrink:0}} />
            <span style={{flex:1}}>Use Base ({baseColour || "Ivory"})</span>
            <span style={{fontSize:10,color:"#666",fontWeight:600}}>no charge</span>
            {!currentColour && <span style={{fontSize:14,marginLeft:4}}>✓</span>}
          </button>
        </div>
        <Section title="⭐ Matches Palette" items={matchesPalette} hint={anchors.length===0 ? "(no palette set)" : null} />
        <Section title="Compatible" items={compatible} hint="(neutrals — work with any palette)" />
        <Section title="Other Colours" items={other} />
        {catalogue.length === 0 && (
          <div style={{padding:20,textAlign:"center",color:"#999",fontSize:11,fontStyle:"italic"}}>No colours loaded. IMS catalogue may be empty — ask Tarun to populate Settings → Colour Catalogue.</div>
        )}
      </div>
    </div>
  );
}

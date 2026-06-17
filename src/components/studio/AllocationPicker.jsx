import { useState, useEffect } from "react";

// AllocationPicker — replaces ColourPicker for paintable elements.
// User allocates units of an element across colours. Base colour = "no override" (the unallocated remainder).
export default function AllocationPicker({ open, onClose, elName, totalQty, baseColour, paintCost, initialAllocation,
                            colourCatalogue, paletteCatalogue, palette, onSave }) {
  const [draft, setDraft] = useState([]);
  // Initialize draft when modal opens (use initialAllocation)
  useEffect(() => {
    if (!open) return;
    const init = Array.isArray(initialAllocation) ? initialAllocation.map(a => ({...a})) : [];
    setDraft(init);
  }, [open, initialAllocation]);
  if (!open) return null;
  const catalogue = Array.isArray(colourCatalogue) ? colourCatalogue : [];
  const palettes = Array.isArray(paletteCatalogue) ? paletteCatalogue : [];
  const pObj = palettes.find(p => p.name === palette);
  const anchors = pObj?.anchorColours || [];
  const anchorSet = new Set(anchors);
  const allocated = draft.reduce((s, a) => s + (Number(a.qty)||0), 0);
  const remaining = totalQty - allocated;
  const canSave = remaining >= 0;
  const addColour = (cname) => {
    if (draft.some(a => a.colour === cname)) return; // already added
    if (remaining <= 0) return; // no qty left
    setDraft(prev => [...prev, { qty: 1, colour: cname }]);
  };
  const updateQty = (idx, nextQty) => {
    setDraft(prev => {
      const raw = Math.max(0, Number(nextQty)||0);
      // Sum of all OTHER rows' qty
      const othersTotal = prev.reduce((s, a, i) => i === idx ? s : s + (Number(a.qty)||0), 0);
      // Max this row can grow to = totalQty - othersTotal
      const maxForRow = Math.max(0, totalQty - othersTotal);
      const clamped = Math.min(raw, maxForRow);
      return prev.map((a, i) => i === idx ? {...a, qty: clamped} : a);
    });
  };
  const removeAlloc = (idx) => {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };
  const groupedColours = (() => {
    const used = new Set(draft.map(d => d.colour));
    const available = catalogue.filter(c => !used.has(c.name));
    return {
      anchors: available.filter(c => anchorSet.has(c.name)),
      neutrals: available.filter(c => !anchorSet.has(c.name) && c.isNeutral),
      other: available.filter(c => !anchorSet.has(c.name) && !c.isNeutral),
    };
  })();
  const Swatch = ({c, disabled}) => (
    <button onClick={() => !disabled && addColour(c.name)} disabled={disabled}
      style={{display:"flex",alignItems:"center",gap:5,padding:"5px 9px",borderRadius:6,border:"1px solid #e5e7eb",background:disabled?"#f3f4f6":"#fff",cursor:disabled?"not-allowed":"pointer",fontSize:11,opacity:disabled?0.4:1}}>
      <span style={{width:14,height:14,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)",background:c.hex||"#ccc"}} />
      <span>{c.name}</span>
    </button>
  );
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,maxWidth:560,width:"100%",maxHeight:"88vh",overflowY:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:14}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#222"}}>🎨 Paint Allocation</div>
            <div style={{fontSize:11,color:"#666",marginTop:3}}>
              <strong>{elName}</strong> · total qty: <strong>{totalQty}</strong>
              {palette && palette !== "Custom" && <span> · palette: <strong style={{color:"#7c3aed"}}>{palette}</strong></span>}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#888"}}>×</button>
        </div>
        {/* Allocation rows */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:"#666",letterSpacing:0.5,textTransform:"uppercase",marginBottom:6}}>Current Allocation</div>
          {/* Base row — always present, represents "no override / paint base" */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,background:"#F5F0E1",border:"1px solid #C5A572",marginBottom:6}}>
            <span style={{width:16,height:16,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)",background:catalogue.find(c=>c.name===baseColour)?.hex||"#F5F0E1",flexShrink:0}} />
            <span style={{flex:1,fontSize:12,fontWeight:600}}>Base — {baseColour||"Ivory"}</span>
            <span style={{fontSize:11,color:"#666"}}>×{remaining < 0 ? 0 : remaining}</span>
            <span style={{fontSize:10,color:"#999",minWidth:50,textAlign:"right"}}>no charge</span>
          </div>
          {draft.map((a, idx) => {
            const cObj = catalogue.find(c => c.name === a.colour);
            return (
              <div key={a.colour} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,background:"#FDF2F8",border:"1px solid #F9A8D4",marginBottom:6}}>
                <span style={{width:16,height:16,borderRadius:3,border:"1px solid rgba(0,0,0,0.15)",background:cObj?.hex||"#ccc",flexShrink:0}} />
                <span style={{flex:1,fontSize:12,fontWeight:600,color:"#9D174D"}}>{a.colour}</span>
                <button onClick={()=>updateQty(idx, a.qty - 1)} disabled={a.qty <= 0}
                  style={{width:22,height:22,borderRadius:5,border:"1px solid #F9A8D4",background:a.qty<=0?"#f3f4f6":"#fff",fontSize:13,fontWeight:700,color:"#9D174D",cursor:a.qty<=0?"not-allowed":"pointer",opacity:a.qty<=0?0.4:1}}>−</button>
                <input type="number" min="0" max={a.qty + remaining} value={a.qty} onChange={e => updateQty(idx, e.target.value)}
                  style={{width:42,padding:"3px 4px",borderRadius:5,border:"1px solid #F9A8D4",fontSize:12,fontWeight:700,textAlign:"center",color:"#9D174D"}} />
                <button onClick={()=>updateQty(idx, a.qty + 1)} disabled={remaining <= 0}
                  style={{width:22,height:22,borderRadius:5,border:"1px solid #F9A8D4",background:remaining<=0?"#f3f4f6":"#fff",fontSize:13,fontWeight:700,color:"#9D174D",cursor:remaining<=0?"not-allowed":"pointer",opacity:remaining<=0?0.4:1}}>+</button>
                <span style={{fontSize:10,color:"#666",minWidth:50,textAlign:"right"}}>+₹{(paintCost*a.qty).toLocaleString("en-IN")}</span>
                <button onClick={()=>removeAlloc(idx)} style={{background:"none",border:"none",color:"#EC4899",cursor:"pointer",fontSize:14,marginLeft:2}}>×</button>
              </div>
            );
          })}
        </div>
        {/* Validation badge — clamping in updateQty makes over-allocation impossible, but kept defensive */}
        <div style={{padding:"7px 10px",borderRadius:7,marginBottom:14,fontSize:11,fontWeight:600,
                     background: remaining < 0 ? "#FEE2E2" : (remaining === 0 ? "#D1FAE5" : "#FEF3C7"),
                     color: remaining < 0 ? "#991B1B" : (remaining === 0 ? "#065F46" : "#92400E")}}>
          {remaining < 0 ? `⚠ Over-allocated by ${-remaining}. (Shouldn't happen — please report this.)` :
           remaining === 0 ? `✓ All ${totalQty} units allocated.` :
           `${remaining} of ${totalQty} units still on base colour.`}
        </div>
        {/* Picker — group by palette/compatible/other */}
        {(groupedColours.anchors.length + groupedColours.neutrals.length + groupedColours.other.length) > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:700,color:"#666",letterSpacing:0.5,textTransform:"uppercase",marginBottom:6}}>+ Add Colour to Allocation</div>
            {groupedColours.anchors.length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:"#999",marginBottom:4}}>⭐ Matches Palette</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {groupedColours.anchors.map(c => <Swatch key={c.name} c={c} disabled={remaining<=0} />)}
                </div>
              </div>
            )}
            {groupedColours.neutrals.length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:"#999",marginBottom:4}}>Compatible (neutrals)</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {groupedColours.neutrals.map(c => <Swatch key={c.name} c={c} disabled={remaining<=0} />)}
                </div>
              </div>
            )}
            {groupedColours.other.length > 0 && (
              <div>
                <div style={{fontSize:9,color:"#999",marginBottom:4}}>Other Colours</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {groupedColours.other.map(c => <Swatch key={c.name} c={c} disabled={remaining<=0} />)}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Actions */}
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,borderTop:"1px solid #e5e7eb",paddingTop:12}}>
          <button onClick={onClose}
            style={{padding:"8px 16px",borderRadius:7,border:"1px solid #e5e7eb",background:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",color:"#666"}}>Cancel</button>
          <button onClick={() => canSave && onSave(draft.filter(a => a.qty > 0))} disabled={!canSave}
            style={{padding:"8px 16px",borderRadius:7,border:"none",background:canSave?"#7c3aed":"#ccc",fontSize:12,fontWeight:700,color:"#fff",cursor:canSave?"pointer":"not-allowed"}}>
            Save Allocation
          </button>
        </div>
      </div>
    </div>
  );
}

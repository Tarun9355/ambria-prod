import { useState } from "react";
import { Badge, Modal, Tabs, Field, Input, Sel, Btn } from "../../components/ui";
import { resolveMandiFlower, resolveSizeKey, studioUnitLabel } from "../../lib/ims/flowerHelpers";
import { resolveDateCategory } from "../../lib/inventory/helpers";

function fmt(n){ return "₹"+(Number(n)||0).toLocaleString("en-IN"); }

export default function FlowerMandiTab({ settings, setSettings, functions, setFunctions, mode }) {
  const forcedMode = !!mode;
  const [subTab,setSubTab]=useState(mode || "planning");
  const activeSubTab = forcedMode ? mode : subTab;
  const [selFn,setSelFn]=useState(functions[0]?.id||"");
  // Tier 1.6 Phase 2 (05 May 2026): fnPlans local state removed — patterns now auto-derived from fn.flowerOrders.
  const [editPrice,setEditPrice]=useState(null);
  const [newPrice,setNewPrice]=useState("");
  const [flowerSearch,setFlowerSearch]=useState("");
  const [flowerCatFilter,setFlowerCatFilter]=useState("All");
  const [addFlowerModal,setAddFlowerModal]=useState(false);
  const [newFlower,setNewFlower]=useState({name:"",flowerCat:"Rose",unit:"bundle",gattharSize:"",currentPrice:""});
  // Sales overrides for AI-generated mandi list
  const [mandiOverrides,setMandiOverrides]=useState({}); // {fnId: {flowerId: {qty,removed}}}
  const [addExtraFlower,setAddExtraFlower]=useState(false);
  const [extraFlowerId,setExtraFlowerId]=useState("");
  const [extraFlowerQty,setExtraFlowerQty]=useState("");
  // Flower leftover transfer state
  const [txFrom,setTxFrom]=useState("");
  const [txTo,setTxTo]=useState("");
  const [txAmount,setTxAmount]=useState("");
  const [txNote,setTxNote]=useState("");

  const catalogue=settings.mandiCatalogue||[];
  const FLOWER_CATS=["All",...[...new Set(catalogue.map(f=>f.flowerCat||"Other").filter(Boolean))]];
  const filteredCatalogue=catalogue.filter(f=>{
    const q=flowerSearch.toLowerCase();
    const matchSearch=!q||f.name.toLowerCase().includes(q)||(f.flowerCat||"").toLowerCase().includes(q);
    const matchCat=flowerCatFilter==="All"||(f.flowerCat||"Other")===flowerCatFilter;
    return matchSearch&&matchCat;
  });
  const patterns=settings.flowerPatterns||[];
  const kgToPieces=settings.artificialKgToPieces||200;

  // Tier 1.6 Phase 2 (05 May 2026): patterns are no longer manually picked. They auto-derive
  // from EO floral elements at SOLD time and live on fn.flowerOrders. Each entry carries its
  // own realPct (from rcItem.floralMode + el.realPct override + fn.floralRatio) — there's no
  // single function-level artificial ratio anymore. Department head only sees the derived list
  // (read-only) plus per-flower mandi-qty overrides.
  const fn = functions.find(f => f.id === selFn);
  const fnFlowerOrders = fn?.flowerOrders || [];
  const plan = {
    // Map auto-derived flowerOrders to plan.patterns shape (read-only)
    patterns: fnFlowerOrders.map((o, i) => ({
      patternId: o.patternId,
      size: o.size || "medium",
      qty: Number(o.qty)||0,
      realPct: typeof o.realPct === "number" ? o.realPct : 30,
      zone: o.zone || "",
      floralMode: o.floralMode || "",
      _idx: i
    })),
    // No global artificialRatioPct — each pattern entry has its own realPct.
    // Kept for legacy code paths that still read plan.artificialRatioPct (defaults to 70 i.e. 70% artificial / 30% real).
    artificialRatioPct: 70
  };

  function updatePrice(flowerId){
    const price=parseFloat(newPrice); if(!price) return;
    setSettings(s=>({...s,mandiCatalogue:s.mandiCatalogue.map(f=>f.id===flowerId?{...f,currentPrice:price,priceHistory:[{price:f.currentPrice,date:new Date().toISOString().slice(0,10)},...(f.priceHistory||[])]}:f)}));
    setEditPrice(null); setNewPrice("");
  }

  // Get mandi price multiplier for selected function's date
  const fnDate=fn?.date||"";
  const fnDateCategory=resolveDateCategory(fnDate,settings);
  const mandiMultiplier=(settings.mandiPriceMultipliers||{})[fnDateCategory]||1.0;
  const mandiDateLabel=(settings.datePricing?.categories||{})[fnDateCategory]?.label||"✦ Perfect";

  // Calculate shopping list
  // Tier 1.6 Phase 2: each pattern entry has its OWN realPct (from rcItem.floralMode at booking time).
  // Real flowers contribute to mandi shopping list. Artificial pieces tracked per pattern, weight = pieces / kgToPieces.
  // Artificial cost line: total artificial kg × settings.artificialMixRatePerKg.
  function calcShoppingList(){
    const realFlowers={};
    let totalArtificialPieces=0;
    plan.patterns.forEach(pp=>{
      const pat=patterns.find(p=>p.id===pp.patternId); if(!pat) return;
      // Tier 1.4: resolve legacy "large" → "big" + safe fallback
      const sizeKey = resolveSizeKey(pat.sizes, pp.size);
      const sizeData = sizeKey ? pat.sizes[sizeKey] : null; if(!sizeData) return;
      const realPct = (typeof pp.realPct === "number") ? Math.max(0, Math.min(100, pp.realPct)) : 30;
      const realFraction = realPct / 100;
      const artFraction = 1 - realFraction;
      // Real portion → mandi shopping
      sizeData.flowers.forEach(fl=>{
        const qty=fl.qty*pp.qty*realFraction;
        if (qty > 0) {
          // Tier 2.1: normalize old variant IDs (legacy recipe refs) to parent ID for aggregation.
          // Recipes are colour-agnostic post-migration; mandi block aggregates by parent flower.
          const resolved = resolveMandiFlower(fl.flowerId, catalogue);
          const parentId = resolved?.parent?.id || fl.flowerId;
          realFlowers[parentId]=(realFlowers[parentId]||0)+qty;
        }
      });
      // Artificial portion → pieces × kg conversion
      totalArtificialPieces += (sizeData.totalPieces || 0) * pp.qty * artFraction;
    });
    const artificialPieces = totalArtificialPieces;
    const artificialKg = artificialPieces / kgToPieces;
    const artificialMixRate = Number(settings?.artificialMixRatePerKg) || 0;
    const artificialCost = artificialKg * artificialMixRate;
    const fnOvr=mandiOverrides[selFn]||{};
    const list=Object.entries(realFlowers).map(([id,qty])=>{
      const f=catalogue.find(x=>x.id===id);
      if(!f) return null;
      const aiQty=Math.ceil(qty);
      const ovr=fnOvr[id];
      const removed=ovr?.removed||false;
      const finalQty=ovr?.qty!=null?ovr.qty:aiQty;
      const adjustedPrice=Math.round(f.currentPrice*mandiMultiplier);
      const total=finalQty*f.currentPrice;
      const adjustedTotal=finalQty*adjustedPrice;
      return {id,name:f.name,flowerCat:f.flowerCat||"Other",aiQty,finalQty,unit:f.unit,price:f.currentPrice,adjustedPrice,total,adjustedTotal,edited:ovr?.qty!=null&&ovr.qty!==aiQty,removed};
    }).filter(Boolean);
    // Add extra flowers (manually added by sales, not from patterns)
    Object.entries(fnOvr).forEach(([id,ovr])=>{
      if(ovr.extra&&!ovr.removed&&ovr.qty>0){
        const f=catalogue.find(x=>x.id===id);
        if(!f||list.find(l=>l.id===id)) return;
        const adjustedPrice=Math.round(f.currentPrice*mandiMultiplier);
        list.push({id,name:f.name,flowerCat:f.flowerCat||"Other",aiQty:0,finalQty:ovr.qty,unit:f.unit,price:f.currentPrice,adjustedPrice,total:ovr.qty*f.currentPrice,adjustedTotal:ovr.qty*adjustedPrice,edited:true,removed:false,extra:true});
      }
    });
    const visibleList=list.filter(l=>!l.removed);
    const mandiTotal=visibleList.reduce((s,l)=>s+l.total,0);
    const mandiTotalAdjusted=visibleList.reduce((s,l)=>s+l.adjustedTotal,0);
    const aiTotal=list.filter(l=>!l.extra).reduce((s,l)=>s+l.aiQty*l.price,0);
    const aiTotalAdj=list.filter(l=>!l.extra).reduce((s,l)=>s+l.aiQty*l.adjustedPrice,0);
    return {list,visibleList,mandiTotal,mandiTotalAdjusted,aiTotal,aiTotalAdj,artificialPieces:Math.ceil(artificialPieces),artificialKg:Math.ceil(artificialKg*10)/10,artificialMixRate,artificialCost};
  }

  const {list:rawList,visibleList:list,mandiTotal,mandiTotalAdjusted,aiTotal,aiTotalAdj,artificialPieces,artificialKg,artificialMixRate,artificialCost}=plan.patterns.length>0?calcShoppingList():{list:[],visibleList:[],mandiTotal:0,mandiTotalAdjusted:0,aiTotal:0,aiTotalAdj:0,artificialPieces:0,artificialKg:0,artificialMixRate:0,artificialCost:0};
  const removedList=(rawList||[]).filter(l=>l.removed);
  const hasOverrides=list.some(l=>l.edited||l.extra)||removedList.length>0;

  function setOvr(flowerId,key,val){
    setMandiOverrides(p=>({...p,[selFn]:{...(p[selFn]||{}),[flowerId]:{...((p[selFn]||{})[flowerId]||{}),[key]:val}}}));
  }
  function resetOverrides(){ setMandiOverrides(p=>({...p,[selFn]:{}})); }

  function printShoppingList(){
    const fn=functions.find(f=>f.id===selFn);
    const showAdj=mandiMultiplier!==1;
    const rows=list.map(l=>{
      const editMark=l.edited?"<span style='color:#d97706;font-size:10px'> ✏️"+(l.extra?" +added":` AI:${l.aiQty}`)+"</span>":"";
      return `<tr><td>${l.name}${editMark}</td><td>${l.finalQty}</td><td>${l.unit}</td><td>₹${l.price}</td>${showAdj?`<td>₹${l.adjustedPrice}</td>`:""}<td>₹${(showAdj?l.adjustedTotal:l.total).toLocaleString("en-IN")}</td></tr>`;
    }).join("");
    const w=window.open("","_blank");
    w.document.write(`<html><head><title>Mandi List</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px}th{background:#fef3c7}.warn{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin-bottom:16px}.edit{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:16px}@media print{button{display:none}}</style></head><body>
      <h2>🌸 Ambria Decorations — Mandi Shopping List</h2><h3>${fn?.name||""} · ${fn?.date||""}</h3>
      ${hasOverrides?`<div class="edit">✏️ This list has been manually adjusted by the sales team. Items marked with ✏️ differ from the AI pattern calculation.</div>`:""}
      ${showAdj?`<div class="warn">⚠️ ${mandiDateLabel} date — prices adjusted ×${mandiMultiplier} (${Math.round((mandiMultiplier-1)*100)}% ${mandiMultiplier>1?"surge":"drop"}).</div>`:""}
      <table><tr><th>Flower</th><th>Qty</th><th>Unit</th><th>Base Price</th>${showAdj?"<th>Adj Price</th>":""}<th>Total</th></tr>${rows}
      <tr style="font-weight:bold"><td colspan="${showAdj?5:4}">Total</td><td>₹${(showAdj?mandiTotalAdjusted:mandiTotal).toLocaleString("en-IN")}</td></tr>
      ${showAdj?`<tr><td colspan="${showAdj?5:4}" style="color:#888">Base total (without adjustment)</td><td style="color:#888">₹${mandiTotal.toLocaleString("en-IN")}</td></tr>`:""}</table>
      <p>Artificial Flowers: ${artificialPieces} pieces → ${artificialKg} kg</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      {!forcedMode && <Tabs tabs={[{id:"planning",label:"📋 Function Planning"},{id:"shopping",label:"🛒 Shopping List"},{id:"transfers",label:"🔄 Transfers"}]} active={subTab} onChange={setSubTab} />}

      {activeSubTab==="catalogue"&&<div className="space-y-3">
        {/* Search + Filter + Add */}
        <div className="flex flex-wrap gap-2 items-center">
          <input value={flowerSearch} onChange={e=>setFlowerSearch(e.target.value)} placeholder="🔍 Search flowers..." className="border rounded-lg px-3 py-2 text-sm w-48" />
          <select value={flowerCatFilter} onChange={e=>setFlowerCatFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {FLOWER_CATS.map(c=><option key={c}>{c}</option>)}
          </select>
          <span className="text-xs text-gray-400">{filteredCatalogue.length} of {catalogue.length} flowers</span>
          <div className="ml-auto">
            <button onClick={()=>{setAddFlowerModal(true);setNewFlower({name:"",flowerCat:"Rose",unit:"bundle",gattharSize:"",currentPrice:""});}} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Add Flower</button>
          </div>
        </div>
        {/* Category pills */}
        <div className="flex flex-wrap gap-1.5">
          {FLOWER_CATS.map(c=>{
            const count=c==="All"?catalogue.length:catalogue.filter(f=>(f.flowerCat||"Other")===c).length;
            return <button key={c} onClick={()=>setFlowerCatFilter(c)} className={"px-3 py-1 rounded-full text-xs font-medium transition-all "+(flowerCatFilter===c?"bg-amber-500 text-white":"bg-amber-50 text-amber-700 hover:bg-amber-100")}>{c} ({count})</button>;
          })}
        </div>
        <div className="bg-white border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-amber-50 text-xs text-gray-500 uppercase"><tr>{["Flower","Category","Unit","Pcs/Unit","Current Price","Previous",""].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {filteredCatalogue.map(f=>{
                const prev=f.priceHistory?.[0]; const change=prev?f.currentPrice-prev.price:0;
                return (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{f.name}</td>
                    <td className="px-4 py-3"><span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{f.flowerCat||"Other"}</span></td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{f.unit}</td>
                    <td className="px-4 py-3 text-gray-500">{f.unit!=="piece"&&f.gattharSize?f.gattharSize+" pcs":"—"}</td>
                    <td className="px-4 py-3 font-bold text-indigo-700">{fmt(f.currentPrice)}</td>
                    <td className="px-4 py-3">
                      {prev&&<span className={"text-xs font-medium "+(change>0?"text-red-600":change<0?"text-green-600":"text-gray-400")}>{change>0?"↑":change<0?"↓":"—"} {fmt(prev.price)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {editPrice===f.id?<div className="flex gap-1">
                        <Input value={newPrice} onChange={e=>setNewPrice(e.target.value)} type="number" className="w-20 text-xs py-1" />
                        <button onClick={()=>updatePrice(f.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">✓</button>
                        <button onClick={()=>setEditPrice(null)} className="text-xs text-gray-400 px-1">✕</button>
                      </div>:<button onClick={()=>{setEditPrice(f.id);setNewPrice(f.currentPrice);}} className="text-xs text-indigo-500 hover:text-indigo-700">Edit Price</button>}
                    </td>
                  </tr>
                );
              })}
              {filteredCatalogue.length===0&&<tr><td colSpan="7" className="px-4 py-10 text-center text-gray-400">No flowers match your search</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Add Flower Modal */}
        <Modal open={addFlowerModal} onClose={()=>setAddFlowerModal(false)} title="🌺 Add New Flower">
          <div className="space-y-3">
            <Field label="Flower Name"><Input value={newFlower.name} onChange={e=>setNewFlower(f=>({...f,name:e.target.value}))} placeholder="e.g. Rose Red" /></Field>
            <Field label="Category"><Sel value={newFlower.flowerCat} onChange={e=>setNewFlower(f=>({...f,flowerCat:e.target.value}))}>
              {["Rose","Daisy","Carnation","Stock","Lily & Orchid","Gladiolus","Anthurium","Guldavari","Marigold","Mogra","Tuberose","Sunflower","Ranunculus","Filler & Green","Palm & Leaf","Patti (Leaves)","Specialty","Other"].map(c=><option key={c}>{c}</option>)}
            </Sel></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Unit"><Sel value={newFlower.unit} onChange={e=>setNewFlower(f=>({...f,unit:e.target.value}))}><option value="bundle">Bundle</option><option value="piece">Piece</option><option value="kg">Kg</option><option value="gatthar">Gatthar</option><option value="dozen">Dozen</option><option value="kodi">Kodi</option><option value="pair">Pair</option></Sel></Field>
              <Field label="Pcs/Unit (optional)"><Input type="number" value={newFlower.gattharSize} onChange={e=>setNewFlower(f=>({...f,gattharSize:e.target.value}))} placeholder="—" /></Field>
              <Field label="Current Price (₹)"><Input type="number" value={newFlower.currentPrice} onChange={e=>setNewFlower(f=>({...f,currentPrice:e.target.value}))} placeholder="0" /></Field>
            </div>
            <Btn onClick={()=>{
              if(!newFlower.name||!newFlower.currentPrice) return;
              const id="F"+String(Date.now()).slice(-6);
              setSettings(s=>({...s,mandiCatalogue:[...(s.mandiCatalogue||[]),{
                id, name:newFlower.name, flowerCat:newFlower.flowerCat, unit:newFlower.unit,
                gattharSize:newFlower.gattharSize?parseInt(newFlower.gattharSize):null,
                currentPrice:parseFloat(newFlower.currentPrice), priceHistory:[]
              }]}));
              setAddFlowerModal(false);
            }} color="green">Add Flower</Btn>
          </div>
        </Modal>
      </div>}

      {activeSubTab==="planning"&&<div className="space-y-4">
        <Field label="Function"><Sel value={selFn} onChange={e=>setSelFn(e.target.value)}>
          {functions.map(f=><option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
        </Sel></Field>

        {/* Tier 1.6 Phase 2: read-only auto-derived patterns from EO floral elements */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
          <p className="font-semibold mb-1">🔗 Auto-derived from booking</p>
          <p>Patterns + sizes + qtys + real/artificial ratio come from Studio booking. Each row shows the element's ratio (Centerpieces 100% real, Hangings 100% artificial, Reet/Garland follow event ratio, etc). To change qtys or sizes, edit the booking in Studio. Department head only adjusts mandi flower qtys below.</p>
        </div>

        {plan.patterns.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-sm text-gray-400">
            No flower patterns derived from this booking yet. Either the booking has no recipe-driven floral elements, or the booking hasn't been processed through Events tab "Confirm Blocks" yet.
          </div>
        ) : (
          <div className="space-y-2">
            {plan.patterns.map((pp,i)=>{
              const pat=patterns.find(p=>p.id===pp.patternId);
              const patName = pat?.name || pp.patternId || "(unknown pattern)";
              const sizeLabel = pp.size === "small" ? "Small" : pp.size === "big" ? "Big" : "Medium";
              const realPct = Math.round(pp.realPct ?? 30);
              const ratioColor = realPct === 100 ? "bg-emerald-100 text-emerald-700"
                              : realPct === 0   ? "bg-purple-100 text-purple-700"
                              : "bg-amber-100 text-amber-700";
              const ratioLabel = realPct === 100 ? "100% real"
                              : realPct === 0   ? "100% artificial"
                              : `${realPct}% real / ${100-realPct}% artificial`;
              return (
                <div key={i} className="bg-white border rounded-xl p-3 grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-4 font-medium text-gray-800 truncate">{patName}</div>
                  <div className="col-span-2 text-xs text-gray-500">{sizeLabel}</div>
                  <div className="col-span-2 font-bold text-indigo-700">{pp.qty} {pat?.unit ? studioUnitLabel(pat.unit).replace("/","") : ""}</div>
                  <div className="col-span-3"><span className={"text-[10px] px-2 py-0.5 rounded-full font-semibold "+ratioColor}>{ratioLabel}</span></div>
                  <div className="col-span-1 text-[10px] text-gray-400 truncate" title={pp.zone}>{pp.zone}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>}

      {activeSubTab==="shopping"&&<div className="space-y-4">
        <Field label="Function"><Sel value={selFn} onChange={e=>setSelFn(e.target.value)}>
          {functions.map(f=><option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
        </Sel></Field>
        {/* Heavy Saya warning banner */}
        {fnDateCategory==="heavy_saya"&&(
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="text-sm font-bold text-red-800">King's Date — Mandi prices expected ~{Math.round((mandiMultiplier-1)*100)}% higher</p>
              <p className="text-xs text-red-600 mt-0.5">Shopping list adjusted at ×{mandiMultiplier}. Consider increasing artificial flower ratio to reduce real flower cost.</p>
            </div>
          </div>
        )}
        {fnDateCategory==="non_saya"&&(
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2">
            <span className="text-lg">🟢</span>
            <div>
              <p className="text-sm font-bold text-green-800">Filler Date — Mandi prices expected ~{Math.round((1-mandiMultiplier)*100)}% lower</p>
              <p className="text-xs text-green-600 mt-0.5">Shopping list adjusted at ×{mandiMultiplier}. Good opportunity for richer real flower arrangements.</p>
            </div>
          </div>
        )}

        {/* Override banner */}
        {hasOverrides&&(
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">✏️</span>
              <div>
                <p className="text-sm font-bold text-amber-800">Sales Adjustments Active</p>
                <p className="text-xs text-amber-600">Quantities differ from AI pattern calculation. Yellow rows = edited, green rows = added by sales.</p>
              </div>
            </div>
            <button onClick={resetOverrides} className="text-xs bg-amber-200 hover:bg-amber-300 text-amber-800 px-3 py-1.5 rounded-lg font-medium">↩ Reset to AI</button>
          </div>
        )}

        {list.length===0&&removedList.length===0?<div className="text-center py-10 text-gray-400">Add patterns in the Planning tab first</div>:
          <div className="space-y-3">
            <div className="bg-white border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-amber-50 text-xs text-gray-500 uppercase"><tr>
                  <th className="px-4 py-3 text-left font-medium">Flower</th>
                  <th className="px-3 py-3 text-left font-medium">Category</th>
                  <th className="px-3 py-3 text-center font-medium">AI Qty</th>
                  <th className="px-3 py-3 text-center font-medium">Final Qty</th>
                  <th className="px-3 py-3 text-left font-medium">Unit</th>
                  <th className="px-3 py-3 text-left font-medium">Price</th>
                  {mandiMultiplier!==1&&<th className="px-3 py-3 text-left font-medium">Adj Price</th>}
                  <th className="px-3 py-3 text-right font-medium">Total</th>
                  <th className="px-2 py-3 w-10"></th>
                </tr></thead>
                <tbody>
                  {list.map((l,i)=>(
                    <tr key={l.id} className={"border-t "+(l.extra?"bg-green-50 hover:bg-green-100":l.edited?"bg-amber-50 hover:bg-amber-100":"hover:bg-gray-50")}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{l.name}</p>
                        {l.extra&&<span className="text-xs text-green-600 font-medium">+ Added by Sales</span>}
                        {l.edited&&!l.extra&&<span className="text-xs text-amber-600 font-medium">✏️ Edited</span>}
                      </td>
                      <td className="px-3 py-2.5"><span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{l.flowerCat}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        {l.extra?<span className="text-xs text-gray-400">—</span>
                          :<span className={"text-xs "+(l.edited?"text-gray-400 line-through":"text-gray-600 font-medium")}>{l.aiQty}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input type="number" min="0" value={l.finalQty}
                          onChange={e=>{const v=parseInt(e.target.value)||0; setOvr(l.id,"qty",v); if(l.extra) setOvr(l.id,"extra",true);}}
                          className={"border rounded px-2 py-1 text-sm text-center w-16 font-bold "+(l.edited?"border-amber-400 bg-amber-50 text-amber-800":"text-indigo-700")} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 capitalize">{l.unit}</td>
                      <td className={"px-3 py-2.5 "+(mandiMultiplier!==1?"text-gray-400":"text-gray-600")}>{fmt(l.price)}</td>
                      {mandiMultiplier!==1&&<td className={"px-3 py-2.5 font-medium "+(mandiMultiplier>1?"text-red-600":"text-green-600")}>{fmt(l.adjustedPrice)}</td>}
                      <td className="px-3 py-2.5 text-right font-bold text-green-700">{fmt(mandiMultiplier!==1?l.adjustedTotal:l.total)}</td>
                      <td className="px-2 py-2.5">
                        <button onClick={()=>setOvr(l.id,"removed",true)} title="Remove from list" className="text-red-400 hover:text-red-600 text-sm">✕</button>
                      </td>
                    </tr>
                  ))}

                  {/* Totals row */}
                  <tr className="border-t bg-amber-50 font-bold">
                    <td colSpan={3} className="px-4 py-3 text-gray-800">🌺 Final Mandi Cost {mandiMultiplier!==1?`(${mandiDateLabel} ×${mandiMultiplier})`:""}</td>
                    <td className="px-3 py-3 text-center text-xs text-gray-500 font-normal">{list.reduce((s,l)=>s+l.finalQty,0)} items</td>
                    <td colSpan={mandiMultiplier!==1?3:2}></td>
                    <td className="px-3 py-3 text-right text-indigo-700">{fmt(mandiMultiplier!==1?mandiTotalAdjusted:mandiTotal)}</td>
                    <td></td>
                  </tr>
                  {hasOverrides&&(
                    <tr className="border-t text-xs text-gray-400">
                      <td colSpan={3} className="px-4 py-2">AI Pattern Total (before edits)</td>
                      <td className="px-3 py-2 text-center">{(rawList||[]).filter(l=>!l.extra).reduce((s,l)=>s+l.aiQty,0)}</td>
                      <td colSpan={mandiMultiplier!==1?3:2}></td>
                      <td className="px-3 py-2 text-right">{fmt(mandiMultiplier!==1?aiTotalAdj:aiTotal)}</td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Removed flowers (collapsed) */}
            {removedList.length>0&&(
              <div className="bg-gray-50 border rounded-xl p-3">
                <p className="text-xs font-medium text-gray-500 mb-2">🗑️ Removed by Sales ({removedList.length})</p>
                <div className="flex flex-wrap gap-2">
                  {removedList.map(l=>(
                    <div key={l.id} className="flex items-center gap-1.5 bg-white border rounded-lg px-2.5 py-1.5 text-xs">
                      <span className="text-gray-500 line-through">{l.name} ×{l.aiQty}</span>
                      <button onClick={()=>setOvr(l.id,"removed",false)} className="text-indigo-500 hover:text-indigo-700 font-medium">↩ Restore</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add extra flower */}
            <div className="bg-white border rounded-xl p-3">
              {!addExtraFlower?
                <button onClick={()=>{setAddExtraFlower(true);setExtraFlowerId(catalogue[0]?.id||"");setExtraFlowerQty("");}} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add Extra Flower (not in pattern)</button>
              :<div className="flex flex-wrap items-end gap-2">
                <Field label="Flower">
                  <Sel value={extraFlowerId} onChange={e=>setExtraFlowerId(e.target.value)}>
                    {catalogue.filter(f=>!list.find(l=>l.id===f.id)).map(f=><option key={f.id} value={f.id}>{f.name} ({f.flowerCat||"Other"}) — {fmt(f.currentPrice)}/{f.unit}</option>)}
                  </Sel>
                </Field>
                <Field label="Qty"><Input type="number" value={extraFlowerQty} onChange={e=>setExtraFlowerQty(e.target.value)} placeholder="0" className="w-20" /></Field>
                <Btn onClick={()=>{
                  const q=parseInt(extraFlowerQty)||0;
                  if(!extraFlowerId||q<=0) return;
                  setMandiOverrides(p=>({...p,[selFn]:{...(p[selFn]||{}),[extraFlowerId]:{qty:q,extra:true}}}));
                  setAddExtraFlower(false);
                }} color="green" size="sm">Add</Btn>
                <button onClick={()=>setAddExtraFlower(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2">Cancel</button>
              </div>}
            </div>

            <div className="bg-white border rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold text-gray-700 mb-1">🤖 Artificial Flowers Required</p>
              <p className="text-gray-600">{artificialPieces} pieces → <strong>{artificialKg} kg</strong> (at {kgToPieces} pieces/kg)</p>
              {/* Tier 1.6 Phase 2: artificial cost line */}
              {artificialMixRate > 0 ? (
                <p className="text-gray-600 mt-1">Cost: {artificialKg} kg × ₹{artificialMixRate}/kg = <strong className="text-indigo-700">₹{Math.round(artificialCost).toLocaleString("en-IN")}</strong></p>
              ) : (
                <p className="text-amber-600 text-xs mt-1 italic">⚠ Set artificial mix rate (₹/kg) in Settings → Flower Patterns to see cost</p>
              )}
            </div>

            {/* Tier 1.6 Phase 2: Total floral cost split (real mandi + artificial mix) */}
            {(mandiTotal > 0 || artificialCost > 0) && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm">
                <p className="font-semibold text-indigo-800 mb-2">💰 Total Floral Cost</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-600">Real flower (mandi)</span><strong className="text-indigo-700">₹{Math.round(mandiMultiplier!==1?mandiTotalAdjusted:mandiTotal).toLocaleString("en-IN")}</strong></div>
                  <div className="flex justify-between"><span className="text-gray-600">Artificial mix</span><strong className="text-indigo-700">₹{Math.round(artificialCost).toLocaleString("en-IN")}</strong></div>
                  <div className="flex justify-between border-t border-indigo-200 pt-1 mt-1"><span className="font-semibold text-indigo-800">Total</span><strong className="text-indigo-900 text-base">₹{Math.round((mandiMultiplier!==1?mandiTotalAdjusted:mandiTotal) + artificialCost).toLocaleString("en-IN")}</strong></div>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Btn onClick={printShoppingList} color="amber">🖨️ Print Shopping List</Btn>
              {hasOverrides&&<Btn onClick={resetOverrides} color="gray">↩ Reset All to AI</Btn>}
            </div>
          </div>
        }
      </div>}

      {activeSubTab==="transfers"&&<div className="space-y-4">
        {/* All transfers across functions */}
        {(()=>{
          const allTransfers=functions.flatMap(f=>(f.flowerTransfers||[]).map(t=>({...t,fromFnId:f.id,fromFnName:f.name,fromFnDate:f.date})));
          const sortedTx=allTransfers.sort((a,b)=>(b.date||"").localeCompare(a.date||""));

          return <>
            {/* New Transfer Form */}
            <div className="bg-white border-2 border-emerald-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🌸</span>
                <div>
                  <p className="font-bold text-gray-800">Transfer Leftover Flowers</p>
                  <p className="text-xs text-gray-500">Flower Head transfers unused mandi flowers to another function. Lumpsum cost auto-adjusts both functions' P&L.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="From Function (leftover source)">
                  <Sel value={txFrom} onChange={e=>{setTxFrom(e.target.value);if(e.target.value===txTo)setTxTo("");}}>
                    <option value="">— Select source function —</option>
                    {functions.map(f=><option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
                  </Sel>
                </Field>
                <Field label="To Function (receiving leftovers)">
                  <Sel value={txTo} onChange={e=>setTxTo(e.target.value)}>
                    <option value="">— Select destination function —</option>
                    {functions.filter(f=>f.id!==txFrom).map(f=><option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
                  </Sel>
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Transfer Amount (₹ lumpsum)">
                  <Input type="number" value={txAmount} onChange={e=>setTxAmount(e.target.value)} placeholder="e.g. 5000" />
                </Field>
                <Field label="Note / Description">
                  <Input value={txNote} onChange={e=>setTxNote(e.target.value)} placeholder="e.g. Leftover roses & marigold from Haldi" />
                </Field>
              </div>

              {/* Preview */}
              {txFrom&&txTo&&txAmount&&parseFloat(txAmount)>0&&(
                <div className="mt-4 bg-gradient-to-r from-red-50 via-gray-50 to-green-50 border rounded-xl p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">📊 P&L Impact Preview</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-white border border-red-200 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">{functions.find(f=>f.id===txFrom)?.name||""}</p>
                      <p className="text-lg font-bold text-green-600">−₹{parseFloat(txAmount).toLocaleString("en-IN")}</p>
                      <p className="text-xs text-green-600">Cost reduced</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <span className="text-2xl">🌸→</span>
                    </div>
                    <div className="bg-white border border-green-200 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">{functions.find(f=>f.id===txTo)?.name||""}</p>
                      <p className="text-lg font-bold text-red-600">+₹{parseFloat(txAmount).toLocaleString("en-IN")}</p>
                      <p className="text-xs text-red-600">Cost added</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4">
                <Btn onClick={()=>{
                  if(!txFrom||!txTo||txFrom===txTo) return alert("Select two different functions");
                  const amt=parseFloat(txAmount); if(!amt||amt<=0) return alert("Enter a valid amount");
                  const txId="FTX-"+Date.now();
                  const today=new Date().toISOString().split("T")[0];
                  const toFnName=functions.find(f=>f.id===txTo)?.name||"";
                  const fromFnName=functions.find(f=>f.id===txFrom)?.name||"";

                  setFunctions(prev=>prev.map(f=>{
                    if(f.id===txFrom){
                      // Source function: add transfer-out record, subtract cost
                      return {...f,
                        flowerTransfers:[...(f.flowerTransfers||[]),{
                          id:txId, type:"out", toFnId:txTo, toFnName:toFnName,
                          amount:amt, note:txNote, date:today, loggedBy:"Flower Head"
                        }],
                        expenses:[...(f.expenses||[]),{
                          id:"EXP-FTX-OUT-"+Date.now(), desc:`🌸 Flower transfer OUT to ${toFnName}`,
                          amount:-amt, cat:"Flower Transfer", by:"Flower Head", date:today, receipt:""
                        }]
                      };
                    }
                    if(f.id===txTo){
                      // Destination function: add transfer-in record, add cost
                      return {...f,
                        flowerTransfers:[...(f.flowerTransfers||[]),{
                          id:txId, type:"in", fromFnId:txFrom, fromFnName:fromFnName,
                          amount:amt, note:txNote, date:today, loggedBy:"Flower Head"
                        }],
                        expenses:[...(f.expenses||[]),{
                          id:"EXP-FTX-IN-"+Date.now(), desc:`🌸 Flower transfer IN from ${fromFnName}`,
                          amount:amt, cat:"Flower Transfer", by:"Flower Head", date:today, receipt:""
                        }]
                      };
                    }
                    return f;
                  }));

                  setTxFrom(""); setTxTo(""); setTxAmount(""); setTxNote("");
                }} color="green" disabled={!txFrom||!txTo||!txAmount||txFrom===txTo}>🌸 Confirm Transfer</Btn>
              </div>
            </div>

            {/* Transfer History */}
            <div className="bg-white border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b">
                <h4 className="font-semibold text-gray-800">📜 Transfer History</h4>
                <p className="text-xs text-gray-500">All flower leftover transfers across functions</p>
              </div>
              {sortedTx.length===0?
                <div className="text-center py-10 text-gray-400">
                  <p className="text-3xl mb-2">🌸</p>
                  <p>No flower transfers yet</p>
                </div>
              :<table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">From</th>
                    <th className="px-4 py-3 text-center font-medium"></th>
                    <th className="px-4 py-3 text-left font-medium">To</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Note</th>
                    <th className="px-4 py-3 text-left font-medium">Logged By</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTx.filter(t=>t.type==="out").map(t=>{
                    const toFn=functions.find(f=>f.id===t.toFnId);
                    return (
                      <tr key={t.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{t.date}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{t.fromFnName}</p>
                          <p className="text-xs text-green-600 font-medium">−{fmt(t.amount)}</p>
                        </td>
                        <td className="px-4 py-3 text-center text-xl">🌸→</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{t.toFnName||toFn?.name||""}</p>
                          <p className="text-xs text-red-600 font-medium">+{fmt(t.amount)}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-700">{fmt(t.amount)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{t.note||"—"}</td>
                        <td className="px-4 py-3 text-xs"><Badge color="violet">{t.loggedBy}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
            </div>

            {/* Per-function transfer summary */}
            {(()=>{
              const fnSummary=functions.filter(f=>(f.flowerTransfers||[]).length>0).map(f=>{
                const txs=f.flowerTransfers||[];
                const totalIn=txs.filter(t=>t.type==="in").reduce((s,t)=>s+t.amount,0);
                const totalOut=txs.filter(t=>t.type==="out").reduce((s,t)=>s+t.amount,0);
                return {id:f.id,name:f.name,date:f.date,totalIn,totalOut,net:totalIn-totalOut,count:txs.length};
              });
              if(fnSummary.length===0) return null;
              return (
                <div className="bg-white border rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b">
                    <h4 className="font-semibold text-gray-800">📊 P&L Impact per Function</h4>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Function</th>
                        <th className="px-4 py-2 text-left font-medium">Date</th>
                        <th className="px-4 py-2 text-center font-medium">Transfers</th>
                        <th className="px-4 py-2 text-right font-medium">Received (↑ cost)</th>
                        <th className="px-4 py-2 text-right font-medium">Given Out (↓ cost)</th>
                        <th className="px-4 py-2 text-right font-medium">Net P&L Effect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fnSummary.map(f=>(
                        <tr key={f.id} className="border-t">
                          <td className="px-4 py-2.5 font-medium text-gray-800">{f.name}</td>
                          <td className="px-4 py-2.5 text-gray-500">{f.date}</td>
                          <td className="px-4 py-2.5 text-center"><Badge color="gray">{f.count}</Badge></td>
                          <td className="px-4 py-2.5 text-right text-red-600 font-medium">{f.totalIn>0?"+"+fmt(f.totalIn):"—"}</td>
                          <td className="px-4 py-2.5 text-right text-green-600 font-medium">{f.totalOut>0?"−"+fmt(f.totalOut):"—"}</td>
                          <td className={"px-4 py-2.5 text-right font-bold "+(f.net>0?"text-red-600":f.net<0?"text-green-600":"text-gray-400")}>{f.net>0?"+":""}{fmt(f.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>;
        })()}
      </div>}
    </div>
  );
}

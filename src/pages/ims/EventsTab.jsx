import { useState, useEffect, useCallback, useRef } from "react";
import { extractPdfPages } from "../../lib/ims/pdf";
import { callClaudeStreaming } from "../../lib/ai";
import { fetchAll } from "../../lib/supabase";
import { fmt } from "../../lib/format";
import { normalizeSizeClass, sizeClassToPatternKey } from "../../lib/ims/flowerHelpers";

// event_orders row → EO object (mirrors the IMS shell adapter).
const rowToEO = (row) => ({ ...(row.data || {}), id: row.id, status: row.status ?? row.data?.status });

// ─── Module-scope helpers/constants copied verbatim from the reference IMS app ──

const resolveRealPct = (el, rcItem, fnFloralRatio) => {
  if (typeof el?.realPct === "number") return Math.max(0, Math.min(100, el.realPct));
  const mode = String(rcItem?.floralMode||"").toLowerCase();
  if (mode === "real")       return 100;
  if (mode === "artificial") return 0;
  const ratio = (typeof fnFloralRatio === "number") ? fnFloralRatio : 70;
  return Math.max(0, Math.min(100, 100 - ratio));
};

function getAvailableQty(item, blocks, date){
  const itemBlocks=(blocks||{})[item.id]||[];
  const blockedOnDate=itemBlocks.filter(b=>b.date===date&&b.status!=="released").reduce((s,b)=>s+(b.qty||1),0);
  return (item.qty||0)-(item.blocked||0)-blockedOnDate;
}

function addBlock(blocks, itemId, date, eventId, qty, status="held"){
  const next={...blocks};
  if(!next[itemId]) next[itemId]=[];
  next[itemId]=[...next[itemId],{date,eventId,qty:qty||1,status,createdAt:Date.now()}];
  return next;
}

function updateBlockStatus(blocks, eventId, fromStatus, toStatus){
  const next={};
  for(const [itemId,arr] of Object.entries(blocks||{})){
    next[itemId]=arr.map(b=>b.eventId===eventId&&b.status===fromStatus?{...b,status:toStatus}:b);
  }
  return next;
}

function releaseBlocks(blocks, eventId){
  const next={};
  for(const [itemId,arr] of Object.entries(blocks||{})){
    next[itemId]=arr.filter(b=>b.eventId!==eventId);
  }
  return next;
}

function getEventBlocks(blocks, eventId){
  const result=[];
  for(const [itemId,arr] of Object.entries(blocks||{})){
    for(const b of arr){
      if(b.eventId===eventId) result.push({itemId,...b});
    }
  }
  return result;
}

// ─── AI MATCHING (3-stage) ───────────────────────────────────────────────────
function matchElementToInventory(elName, elCat, inventory, date, blocks){
  const nameL=(elName||"").toLowerCase();
  const catL=(elCat||"").toLowerCase();
  const words=nameL.split(/\s+/).filter(w=>w.length>2);

  // Stage 1: exact name match
  const exact=inventory.find(i=>(i.name||"").toLowerCase()===nameL&&getAvailableQty(i,blocks,date)>0);
  if(exact) return {stage:1,match:exact,alternatives:[]};

  // Stage 2: fuzzy match — score by name words + category
  const scored=inventory.map(i=>{
    const iName=(i.name||"").toLowerCase();
    const iCat=(i.cat||"").toLowerCase();
    const iSub=(i.subCat||"").toLowerCase();
    const avail=getAvailableQty(i,blocks,date);
    if(avail<=0) return null;
    let score=0;
    const wordHits=words.filter(w=>iName.includes(w)).length;
    score+=wordHits*25;
    if(catL&&iCat.includes(catL)) score+=20;
    if(catL&&iSub.includes(catL)) score+=30;
    if(iName.includes(nameL)||nameL.includes(iName)) score+=40;
    if(score<15) return null;
    return {...i,_score:score,_avail:avail};
  }).filter(Boolean).sort((a,b)=>b._score-a._score).slice(0,3);

  if(scored.length>0) return {stage:2,match:scored[0],alternatives:scored.slice(1)};

  // Stage 3: unmatched
  return {stage:3,match:null,alternatives:[]};
}

async function aiMatchEvent(eventOrder, inventory, blocks, opts){
  // ── Multi-function aware (28 Apr 2026) ──
  // If functionsDetail[] is present (Studio writes this for all multi-fn EOs), match per-function
  // and tag each result with fnIdx, fnDate, fnVenue, fnShift, fnType.
  // Else fall back to legacy single-function flow against eo.date / eo.zones.
  // Tier 1.6 Phase 2 (05 May 2026): also extract per-element sizeClass (S/M/B) and realPct
  // (from el.realPct override OR rcItem.floralMode + fn.floralRatio). These flow into
  // results so dedup keys by (invId, sizeClass) and createProjectFromEO can populate
  // fn.flowerOrders for pattern elements.
  // Tier 1.6 Phase 2 fix (05 May late): recipe-driven floral elements (Reet, Garland, etc. — flowers
  // installed on-site, no physical inventory) are now SKIPPED from inventory matching entirely.
  // Otherwise fuzzy matching gives nonsense like "Flower Reet" → "Cushion Cover Pink Flower".
  // These elements flow ONLY into fn.flowerOrders via createProjectFromEO. Other floral hard-props
  // (centerpiece vases, hanging frames) still go through inventory matching as before.
  const studioRcItems = Array.isArray(opts?.studioRcItems) ? opts.studioRcItems : [];
  const recipeSubcats = (opts?.recipeSubcats || []).map(s => String(s||"").toLowerCase());
  const findRc = (name) => {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    return studioRcItems.find(i => String(i?.name||"").trim().toLowerCase() === n) || null;
  };
  // True if element is a recipe-driven floral pattern (flowers + labor only — no physical inventory)
  const isRecipeDrivenFloral = (rc) => {
    if (!rc) return false;
    if (String(rc.cat||"").toLowerCase() !== "florals") return false;
    const sub = String(rc.sub||"").toLowerCase();
    return recipeSubcats.includes(sub);
  };
  const results=[];
  const fnsDetail=Array.isArray(eventOrder.functionsDetail)?eventOrder.functionsDetail:null;
  const matchOneFn=(fn,fnTag)=>{
    const zones=fn.zones||{};
    const elements=fn.elements||fn.enabledEls||{};
    const fnDate=fn.date||fnTag.fnDate||eventOrder.date||"";
    const fnFloralRatio = (typeof fn.floralRatio === "number") ? fn.floralRatio : (typeof eventOrder.floralRatio === "number" ? eventOrder.floralRatio : 70);
    let pushed=0;
    for(const [zoneKey,zoneData] of Object.entries(zones)){
      const zoneEls=Array.isArray(zoneData)?zoneData:(elements[zoneKey]||[]);
      if(!Array.isArray(zoneEls)) continue;
      for(const el of zoneEls){
        const elName=typeof el==="string"?el:(el.name||el.label||"");
        const elCat=typeof el==="object"?(el.cat||el.category||""):"";
        const elQty=typeof el==="object"?(el.qty||1):1;
        const elSize=typeof el==="object"?normalizeSizeClass(el.size):"M";
        if(!elName) continue;
        const rc = findRc(elName);
        // Tier 1.6 Phase 2 fix: recipe-driven florals don't need physical inventory — they flow to fn.flowerOrders only.
        if (isRecipeDrivenFloral(rc)) continue;
        const elRealPct = resolveRealPct(typeof el==="object"?el:{}, rc, fnFloralRatio);
        const elFloralMode = String(rc?.floralMode||"").toLowerCase();
        const elIsFloral = String(rc?.cat||"").toLowerCase() === "florals";
        const result=matchElementToInventory(elName,elCat,inventory,fnDate,blocks);
        results.push({zone:zoneKey,element:elName,qty:elQty,sizeClass:elSize,realPct:elRealPct,floralMode:elFloralMode,isFloral:elIsFloral,...fnTag,...result});
        pushed++;
      }
    }
    if(pushed===0){
      const flatEls=fn.elements||{};
      for(const [key,elData] of Object.entries(flatEls)){
        if(typeof elData==="boolean"&&elData){
          const result=matchElementToInventory(key,"",inventory,fnDate,blocks);
          results.push({zone:"general",element:key,qty:1,sizeClass:"M",realPct:30,floralMode:"",isFloral:false,...fnTag,...result});
        }else if(Array.isArray(elData)){
          for(const el of elData){
            const elName=typeof el==="string"?el:(el.name||"");
            if(!elName) continue;
            const elQty=typeof el==="object"?(el.qty||1):1;
            const elSize=typeof el==="object"?normalizeSizeClass(el.size):"M";
            const rc = findRc(elName);
            if (isRecipeDrivenFloral(rc)) continue; // skip pattern-driven florals from inventory match
            const elRealPct = resolveRealPct(typeof el==="object"?el:{}, rc, fnFloralRatio);
            const elFloralMode = String(rc?.floralMode||"").toLowerCase();
            const elIsFloral = String(rc?.cat||"").toLowerCase() === "florals";
            const result=matchElementToInventory(elName,"",inventory,fnDate,blocks);
            results.push({zone:key,element:elName,qty:elQty,sizeClass:elSize,realPct:elRealPct,floralMode:elFloralMode,isFloral:elIsFloral,...fnTag,...result});
          }
        }
      }
    }
  };
  if(fnsDetail&&fnsDetail.length){
    fnsDetail.forEach((fn,i)=>{
      matchOneFn(fn,{
        fnIdx:typeof fn.fnIdx==="number"?fn.fnIdx:i,
        fnDate:fn.date||"",
        fnVenue:fn.venue||"",
        fnShift:fn.shift||"",
        fnType:fn.type||""
      });
    });
  }else{
    // Legacy single-function fallback
    matchOneFn(eventOrder,{
      fnIdx:0,
      fnDate:eventOrder.date||"",
      fnVenue:typeof eventOrder.venue==="string"?eventOrder.venue:(eventOrder.venue?.name||""),
      fnShift:eventOrder.shift||"",
      fnType:(eventOrder.functions||[])[0]||""
    });
  }
  return results;
}

function calcAutoCrew(fnObj, projObj, settings, inventory){
  const crew=[];
  const items=fnObj?.items||[];
  const segment=projObj?.segment||"outdoor_budgeted";
  const venueName=fnObj?.venue?.name||"";
  const eventMult=(settings?.eventTypeMultipliers||{})[segment]||1;
  const venueConfig=(settings?.venueMinLabour||{})[venueName];
  const venueMin=typeof venueConfig==="object"?(venueConfig?.min||4):((typeof venueConfig==="number"?venueConfig:null)||settings?.defaultMinLabour||4);
  // Tier 1.6 Phase 2: matrix is no longer used for Flowerists/Electricians (productivity-driven instead).
  // Other types (Carpenters, Painters, Truss Labour, etc.) use Tier 2/3 which never relied on matrix.
  const labourTiers=settings?.labourTiers||{};
  const types=["Flowerists","Labours","Fabric Bangali","Carpenters","Painters","Electricians","Truss Labour"];
  const defaultRates={Flowerists:800,Labours:500,"Fabric Bangali":600,Carpenters:900,Painters:700,Electricians:1000,"Truss Labour":800};
  types.forEach(type=>{
    const cfg=labourTiers[type]||{};
    const tier=cfg.tier||1;
    let qty=0;
    let reason="";
    if(tier===1){
      // Tier 1.6 Phase 2: Flowerists from flowerOrders × pattern productivity; Electricians from Lighting items × electricianProductivity table.
      if (type === "Flowerists") {
        const orders = fnObj?.flowerOrders || [];
        const patterns = settings?.flowerPatterns || [];
        orders.forEach(o => {
          const pat = patterns.find(p => p.id === o.patternId);
          if (!pat) return;
          const sizeKey = (pat.sizes && pat.sizes[o.size||"medium"]) ? (o.size||"medium") : (pat.sizes?.medium ? "medium" : Object.keys(pat.sizes||{})[0]);
          const sizeData = pat.sizes?.[sizeKey];
          const productivity = Number(sizeData?.unitsPerFlowerist);
          if (!productivity || productivity <= 0) return;
          qty += Math.ceil((Number(o.qty)||0) / productivity);
        });
        reason = "Flower-pattern productivity (Tier 1.6)";
      } else if (type === "Electricians") {
        const prodTable = settings?.electricianProductivity || {};
        items.forEach(it => {
          const inv = inventory?.find(i => i.id === it.invId);
          if (!inv) return;
          if (String(inv.cat||"").toLowerCase() !== "lighting") return;
          const sub = inv.subCat || "";
          const prod = prodTable[sub];
          if (!prod) return;
          const sizeRaw = String(it.sizeClass||"").toUpperCase();
          const sizeKey = sizeRaw === "S" ? "small" : sizeRaw === "B" ? "big" : "medium";
          const productivity = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
          if (!productivity || productivity <= 0) return;
          qty += Math.ceil((Number(it.qty)||0) / productivity);
        });
        reason = "Lighting productivity (Tier 1.6)";
      } else {
        // Other Tier-1 types: no longer auto-calculated (MM removed). Default to 0.
        qty = 0;
        reason = "Tier 1 (no matrix — set manually)";
      }
    }else if(tier===2){
      const batches=cfg.subCatBatches||{};
      const subCatCounts={};
      items.forEach(it=>{
        const inv=inventory?.find(i=>i.id===it.invId);
        if(inv&&batches[inv.subCat]) subCatCounts[inv.subCat]=(subCatCounts[inv.subCat]||0)+it.qty;
      });
      Object.entries(subCatCounts).forEach(([sc,count])=>{
        const batch=batches[sc]||3;
        qty+=Math.ceil(count/batch);
      });
      qty=Math.max(cfg.minimum||1, qty);
      reason="Batch calc (auto)";
    }else if(tier===3){
      qty=Math.ceil(venueMin*eventMult);
      reason=`Venue ${venueMin} × ${eventMult} (auto)`;
    }else{
      qty=tier==="pillar-range"?4:tier==="sqft-range"?3:2;
      reason="Default estimate (auto)";
    }
    if(qty>0){
      crew.push({
        type,qty:Math.max(1,qty),rate:defaultRates[type]||500,
        source:"own",vendorId:null,vendorRate:null,
        remark:`[Auto] ${reason}`,slots:[],
        reusedFrom:null,reusedCumHours:null,tier
      });
    }
  });
  return crew;
}

// ─── EVENTS TAB ──────────────────────────────────────────────────────────────
export default function EventsTab({ eventOrders, setEventOrders, inventory, blocks, setBlocks, saveBlocks, saveEventOrders, projects, setProjects, functions, setFunctions, purchase, setPurchase, settings, studio, trussInv, setTrussInv }){
  const [processing, setProcessing]=useState(null);
  const [matchResults, setMatchResults]=useState({});
  const [reviewEvent, setReviewEvent]=useState(null);
  const [decisions, setDecisions]=useState({});
  const [showCreate, setShowCreate]=useState(false);
  const [refreshing, setRefreshing]=useState(false);
  const [invSearch, setInvSearch]=useState("");
  const [manualItems, setManualItems]=useState([]); // [{itemId, name, qty, zone:"manual"}]
  const [aiScanning, setAiScanning]=useState(false);
  const [aiScanStatus, setAiScanStatus]=useState("");
  const [uploadedSlides, setUploadedSlides]=useState([]); // [{media_type, data, pageNum}]

  // Handle PPT/PDF/Image upload → extract slides
  const handleFileUpload=async(file)=>{
    if(!file) return;
    const ext=file.name.split(".").pop().toLowerCase();

    if(ext==="pdf"){
      setAiScanStatus("📄 Extracting PDF pages...");
      try{
        const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
        const result=await extractPdfPages(b64,(p,t)=>setAiScanStatus(`📄 Rendering page ${p}/${t}...`));
        setUploadedSlides(result.images);
        setAiScanStatus(`✅ ${result.rendered} pages extracted. Click "AI Scan" to identify decor.`);
      }catch(e){ setAiScanStatus("❌ PDF error: "+e.message); }
    }else if(["jpg","jpeg","png","webp","gif"].includes(ext)){
      setAiScanStatus("🖼️ Reading image...");
      try{
        const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
        const mt=file.type||"image/jpeg";
        setUploadedSlides([{media_type:mt,data:b64,pageNum:1}]);
        setAiScanStatus("✅ Image loaded. Click \"AI Scan\" to identify decor.");
      }catch(e){ setAiScanStatus("❌ Image error: "+e.message); }
    }else{
      setAiScanStatus("❌ Unsupported format. Upload PDF or images (JPG/PNG).");
    }
  };

  // AI Scan — send slides to Claude Vision → get element list → match to inventory
  const handleAiScan=async(eo)=>{
    if(!uploadedSlides.length){setAiScanStatus("Upload a file first");return;}
    setAiScanning(true);
    setAiScanStatus("🤖 AI analyzing slides...");
    try{
      // Build content blocks: images + prompt
      const contentBlocks=[];
      for(const slide of uploadedSlides.slice(0,10)){
        contentBlocks.push({type:"image",source:{type:"base64",media_type:slide.media_type,data:slide.data}});
      }
      contentBlocks.push({type:"text",text:`You are analyzing wedding/event decoration presentation slides for Ambria Decorations.

Identify ALL decor elements visible in these slides. For each element, provide:
- name: specific item name (e.g. "Iron Arch Entry Gate", "Crystal Chandelier", "Flower Pot Large")
- category: one of Structural, Floral, Lighting, Fabric, Props, Furniture, Stage, Consumable
- qty: estimated quantity visible
- zone: where it belongs (stage, entry, vedi, lounge, tableDecor, photobooth, or general)

Respond ONLY with a JSON array, no other text:
[{"name":"...","category":"...","qty":1,"zone":"..."},...]`});

      // Migration: the reference posted to the Vercel /api/anthropic route; this SPA proxies
      // through the Supabase `anthropic` Edge Function via callClaudeStreaming (same contract).
      const text=await callClaudeStreaming({contentBlocks,model:"claude-sonnet-4-6",maxTokens:4000});

      // Parse AI response
      let elements=[];
      try{
        const jsonMatch=text.match(/\[[\s\S]*\]/);
        if(jsonMatch) elements=JSON.parse(jsonMatch[0]);
      }catch(e){ setAiScanStatus("❌ AI response parsing failed"); setAiScanning(false); return; }

      if(!elements.length){ setAiScanStatus("❌ AI found no decor elements"); setAiScanning(false); return; }

      // Match each element to inventory
      const newResults=[];
      for(const el of elements){
        const match=matchElementToInventory(el.name,el.category,inventory,eo.date,blocks);
        newResults.push({zone:el.zone||"general",element:el.name,qty:el.qty||1,...match});
      }

      // Merge with existing match results
      setMatchResults(prev=>{
        const existing=prev[eo.id]||[];
        return {...prev,[eo.id]:[...existing,...newResults]};
      });

      setAiScanStatus(`✅ AI found ${elements.length} elements → ${newResults.filter(r=>r.stage<=2).length} matched, ${newResults.filter(r=>r.stage===3).length} unmatched`);
    }catch(e){
      setAiScanStatus("❌ AI scan failed: "+e.message);
    }
    setAiScanning(false);
  };
  const [createForm, setCreateForm]=useState({clientName:"",phone:"",date:"",venue:"",functions:["Wedding"],shift:"Night",brideGroom:"",pax:"",salesperson:"",category:"Platinum",notes:""});

  // Refresh event orders. Migration: the reference re-read the EO blob from Redis (EO_SK);
  // this SPA re-reads the source-of-truth event_orders table.
  const handleRefresh=async()=>{
    setRefreshing(true);
    try{
      const rows=await fetchAll("event_orders");
      if(Array.isArray(rows)){ setEventOrders(rows.map(rowToEO)); }
    }catch(e){ console.error("Refresh failed:",e); }
    setRefreshing(false);
  };

  // Auto-refresh on mount
  useEffect(()=>{ handleRefresh(); },[]);

  const CLIENT_VENUES=["Ambria Pushpanjali","Ambria Exotica","Ambria Manaktala","Ambria Restro","Others"];
  const FN_TYPES=["Haldi","Mehendi","Sangeet","Cocktail","Wedding","Reception","Engagement","Anniversary","Birthday","Corporate","Other"];
  const SHIFTS=["Morning","Lunch","Sundowner","Night"];

  // §2.5.1 SOLD-to-All-Departments Invariant (28 May 2026): "review" status removed.
  // Salesperson's Deal Check in Studio is the single review checkpoint; IMS trusts it absolutely.
  // EOs go pending → blocked automatically via autoConfirmEO. No manual review gate.
  const statusColors={pending:"amber",processing:"blue",blocked:"green",final:"teal",cancelled:"red"};
  const statusLabels={pending:"⏳ Auto-confirming…",processing:"⚙️ Processing",blocked:"🔒 Blocked",final:"✅ Final",cancelled:"❌ Cancelled"};

  // Create manual event
  const handleCreate=()=>{
    if(!createForm.clientName.trim()||!createForm.date||!createForm.venue){alert("Client name, date, and venue are required");return;}
    const newEO={
      id:"eo_"+Date.now(),
      clientName:createForm.clientName.trim(),
      phone:createForm.phone.trim(),
      date:createForm.date,
      venue:createForm.venue,
      functions:createForm.functions,
      shift:createForm.shift,
      brideGroom:createForm.brideGroom.trim(),
      pax:createForm.pax,
      salesperson:createForm.salesperson.trim(),
      category:createForm.category,
      notes:createForm.notes.trim(),
      source:"manual",
      status:"pending",
      totalCost:0,
      zones:{},
      elements:{},
      createdAt:Date.now()
    };
    const updated=[...eventOrders,newEO];
    setEventOrders(updated);
    saveEventOrders(updated);
    setShowCreate(false);
    setCreateForm({clientName:"",phone:"",date:"",venue:"",functions:["Wedding"],shift:"Night",brideGroom:"",pax:"",salesperson:"",category:"Platinum",notes:""});
  };

  // Toggle function in create form
  const toggleFn=(fn)=>{
    setCreateForm(p=>{
      const fns=p.functions.includes(fn)?p.functions.filter(f=>f!==fn):[...p.functions,fn];
      return {...p,functions:fns.length?fns:["Wedding"]};
    });
  };

  // Process event — run AI matching. Used by 48hr "Correct" button (blocked → re-match for emergency fix).
  // 28 May 2026: no longer flips status to "review" (that state removed per §2.5.1 invariant).
  // Just runs AI matching, populates matchResults, opens review modal (read-only-ish for blocked EOs).
  const handleProcess=async(eo)=>{
    setProcessing(eo.id);
    try{
      const results=await aiMatchEvent(eo, inventory, blocks, {studioRcItems: studio?.rcItems || [], recipeSubcats: settings?.flowerRecipeSubcats || []});
      setMatchResults(prev=>({...prev,[eo.id]:results}));
      setReviewEvent(eo.id);
    }catch(e){
      alert("Processing failed: "+e.message);
    }
    setProcessing(null);
  };

  // Confirm blocks from review (multi-function aware, with reuse de-dup — 28 Apr 2026)
  const handleConfirm=(eo)=>{
    const results=matchResults[eo.id]||[];
    executeConfirmBlocks(eo, results, decisions, manualItems, {clearReviewState: true});
    executeFabricBlocks(eo);  // §23 Phase 2.9f — block per-colour fabric stock + auto-PO shortfall
  };

  // Tier 1.6 Phase 2 (05 May 2026): auto-confirm flow.
  // Sales has already done Deal Check in Studio (matched/skipped/production decisions, manual items,
  // dedup overrides — all in eo.functionsDetail[].* and eo.manualItems). Re-asking ops to "Review" + "Confirm"
  // duplicates work and gates Function creation behind a manual click.
  // Auto path: when a new pending EO arrives, run AI matching directly + commit blocks using AI's own
  // confidence (decisions={} = accept all matched, skip null) + EO's Studio-side manual items.
  // Skipped items (no AI match) flow to Buying tab as today; ops still has full visibility post-confirm.
  //
  // 28 May 2026 (§2.5.1): Returns true/false to allow retry on failure. Previous behaviour silently
  // swallowed errors and the EO got stuck at "pending" forever. Now the watcher only marks the EO
  // as processed if autoConfirmEO returns true; otherwise it retries on the next render.
  const autoConfirmEO = useCallback(async (eo) => {
    if (!eo) return false;
    // eslint-disable-next-line no-console
    console.log("[auto-confirm] starting for EO", eo.id, eo.clientName, "status:", eo.status);
    try {
      const results = await aiMatchEvent(eo, inventory, blocks, {studioRcItems: studio?.rcItems || [], recipeSubcats: settings?.flowerRecipeSubcats || []});
      // eslint-disable-next-line no-console
      console.log("[auto-confirm] aiMatchEvent done:", results.length, "results for", eo.id);
      setMatchResults(prev => ({...prev, [eo.id]: results}));
      executeConfirmBlocks(eo, results, {}, eo.manualItems || [], {clearReviewState: false});
      executeFabricBlocks(eo);  // §23 Phase 2.9f — auto-confirm path also blocks fabric stock + auto-PO
      // eslint-disable-next-line no-console
      console.log("[auto-confirm] ✓ confirmed", eo.id, eo.clientName);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[auto-confirm] FAILED for EO", eo.id, eo.clientName, e);
      return false;
    }
  }, [inventory, blocks, eventOrders, studio]);

  // Auto-confirm new pending EOs + any stuck legacy "review" EOs (§2.5.1 migration).
  // - Pending: run AI match → block.
  // - Review (legacy): re-run autoConfirmEO so it goes straight to "blocked".
  // Tracks processed IDs in a ref; on failure the EO is NOT marked, so it retries.
  const autoConfirmedRef = useRef(new Set());
  const [autoConfirmFailures, setAutoConfirmFailures] = useState(new Set());
  const [showCancelled, setShowCancelled] = useState(false); // show superseded/cancelled bookings in the list
  useEffect(() => {
    if (!Array.isArray(eventOrders)) return;
    // Pick up: (a) pending EOs, (b) legacy "review" EOs that got stuck before the migration.
    const eligible = eventOrders.filter(eo => !eo.status || eo.status === "pending" || eo.status === "review");
    if (eligible.length > 0) {
      // eslint-disable-next-line no-console
      console.log("[auto-confirm] useEffect saw", eligible.length, "auto-confirmable EO(s):", eligible.map(e => `${e.clientName||e.id}[${e.status||"pending"}]`));
    }
    const toAutoConfirm = eligible.filter(eo => !autoConfirmedRef.current.has(eo.id));
    toAutoConfirm.forEach(async (eo) => {
      // Mark "in progress" to prevent duplicate concurrent runs in the same render cycle
      autoConfirmedRef.current.add(eo.id);
      const ok = await autoConfirmEO(eo);
      if (!ok) {
        // Failure — un-mark so the watcher retries on next render, and surface in UI
        autoConfirmedRef.current.delete(eo.id);
        setAutoConfirmFailures(prev => {
          const next = new Set(prev);
          next.add(eo.id);
          return next;
        });
      } else {
        // Success — clear any prior failure flag for this EO
        setAutoConfirmFailures(prev => {
          if (!prev.has(eo.id)) return prev;
          const next = new Set(prev);
          next.delete(eo.id);
          return next;
        });
      }
    });
  }, [eventOrders, autoConfirmEO]);

  // §23 Phase 2.9f (26 May 2026) — Per-colour fabric stock blocking on SOLD + auto-PO for shortfalls.
  // Reads zoneConfig[zoneKey].{maskingAllocation, lizaAllocation, curtainAllocation} arrays from the EO,
  // sums qty per (fabricType, colour) across all functions × zones, decrements trussInv stock,
  // creates Purchase Orders for any shortage qty per colour per fabric type.
  // Bundled in truss price (not client-facing) — pure internal inventory tracking.
  function executeFabricBlocks(eo){
    try {
      if (!eo || !trussInv) return;
      const fnsDetail = Array.isArray(eo.functionsDetail) ? eo.functionsDetail : null;
      const fnList = fnsDetail && fnsDetail.length ? fnsDetail : (eo.zones ? [{ zones: eo.zones, date: eo.date, venue: typeof eo.venue==="string"?eo.venue:(eo.venue?.name||"") }] : []);
      if (fnList.length === 0) return;

      // Aggregate required qty per (fabricType, colour) across the whole event
      const required = { masking: {}, liza: {}, curtain: {} };
      for (const fn of fnList) {
        const zones = fn.zones || {};
        Object.values(zones).forEach(zc => {
          if (!zc) return;
          (zc.maskingAllocation || []).forEach(a => {
            if (!a || !a.colour || !a.qty) return;
            required.masking[a.colour] = (required.masking[a.colour] || 0) + Number(a.qty);
          });
          (zc.lizaAllocation || []).forEach(a => {
            if (!a || !a.colour || !a.qty) return;
            required.liza[a.colour] = (required.liza[a.colour] || 0) + Number(a.qty);
          });
          (zc.curtainAllocation || []).forEach(a => {
            if (!a || !a.colour || !a.qty) return;
            required.curtain[a.colour] = (required.curtain[a.colour] || 0) + Number(a.qty);
          });
        });
      }
      const totalRequired = Object.values(required.masking).reduce((s,n)=>s+n,0)
                          + Object.values(required.liza).reduce((s,n)=>s+n,0)
                          + Object.values(required.curtain).reduce((s,n)=>s+n,0);
      if (totalRequired === 0) return;  // No fabric allocations on this EO — nothing to block

      // Build the updated trussInv stock (decrement; never below 0) + collect shortages
      const fmkup = trussInv.fabricFreshMarkup || { liza:40, masking:40, curtain:40 };
      const rates = trussInv.rates || {};
      const shortages = []; // {fabricType, colour, qty, purchasePrice, freshCost}
      const decrementStock = (which, qtyField, fabricType, purchaseKey, markupKey) => {
        const stock = Array.isArray(trussInv[which]) ? [...trussInv[which]] : [];
        const next = stock.map(row => ({...row}));
        Object.entries(required[fabricType]).forEach(([colour, qty]) => {
          const idx = next.findIndex(r => r.colour === colour);
          if (idx < 0) {
            // Colour not in stock catalogue → entire qty is fresh
            shortages.push({
              fabricType, colour, qty,
              purchasePrice: rates[purchaseKey] || 0,
              freshCost: qty * (rates[purchaseKey] || 0) * ((fmkup[markupKey] || 0) / 100)
            });
            return;
          }
          const avail = Number(next[idx][qtyField]) || 0;
          const reused = Math.min(qty, avail);
          const fresh = Math.max(0, qty - avail);
          next[idx][qtyField] = Math.max(0, avail - reused);
          if (fresh > 0) {
            shortages.push({
              fabricType, colour, qty: fresh,
              purchasePrice: rates[purchaseKey] || 0,
              freshCost: fresh * (rates[purchaseKey] || 0) * ((fmkup[markupKey] || 0) / 100)
            });
          }
        });
        return next;
      };

      const nextLiza    = decrementStock("lizaStock",    "stockKg",     "liza",    "lizaKgPurchase",       "liza");
      const nextMasking = decrementStock("maskingStock", "stockPieces", "masking", "maskingPiecePurchase", "masking");
      const nextCurtain = decrementStock("curtainStock", "stockPieces", "curtain", "curtainPiecePurchase", "curtain");

      // Persist trussInv with decremented stocks
      setTrussInv(ti => ({ ...ti, lizaStock: nextLiza, maskingStock: nextMasking, curtainStock: nextCurtain }));

      // Create Purchase Orders for shortages (one PO row per fabric × colour shortage)
      if (shortages.length > 0) {
        const today = new Date().toISOString().split("T")[0];
        const fn0 = fnList[0] || {};
        const newPOs = shortages.map((sh, i) => {
          const itemLabel = sh.fabricType === "liza"    ? `Liza Fabric · ${sh.colour}`
                          : sh.fabricType === "masking" ? `Wall Masking Panel (13×16ft) · ${sh.colour}`
                          :                                `Velvet Curtain · ${sh.colour}`;
          const unit = sh.fabricType === "liza" ? "kg" : "Piece";
          const cat  = sh.fabricType === "liza" ? "Fabric" : sh.fabricType === "masking" ? "Wall Masking" : "Fabric";
          return {
            id: `PR_FAB_${Date.now()}_${i}`,
            poNumber: `PO-FAB-${Date.now().toString(36)}-${i+1}`,
            item: itemLabel,
            qty: Math.ceil(sh.qty * 100) / 100,
            unit,
            cat,
            reason: `Fabric shortfall on SOLD: ${eo.clientName||"event"} (${fn0.date||today})`,
            requestedBy: "System (auto-PO)",
            date: today,
            estimatedCost: Math.round(sh.purchasePrice),
            vendor: "",
            notes: `§23 Phase 2.9f auto-PO · ${sh.fabricType} · ${sh.colour} · margin impact -₹${Math.round(sh.freshCost)}`,
            status: "Pending",
            actualCost: null, actualQty: null,
            approvedBy: null, approvedDate: null,
            vendorSnapshot: null,
            functionAllocation: { eoId: eo.id, fabricType: sh.fabricType, colour: sh.colour, freshCost: Math.round(sh.freshCost) },
            buildType: "fabric-shortfall"
          };
        });
        setPurchase(prev => [...(Array.isArray(prev) ? prev : []), ...newPOs]);
        // eslint-disable-next-line no-console
        console.log(`[fabric-block] EO ${eo.id} · ${shortages.length} shortage row(s) → ${newPOs.length} auto-PO(s) created · total margin impact -₹${Math.round(shortages.reduce((s,x)=>s+x.freshCost,0))}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[fabric-block] EO ${eo.id} · all fabric in stock · no POs needed`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[fabric-block] FAILED for EO", eo?.id, e);
    }
  }

  // Core executor — does AI-match-results → dedup → blocks → Project/Function bridge.
  // Called by both handleConfirm (manual review path) and autoConfirmEO (auto path).
  function executeConfirmBlocks(eo, results, decisionsArg, manualItemsArg, opts){
    const clearReviewState = !!opts?.clearReviewState;
    let newBlocks={...blocks};
    let accepted=0, skipped=0;
    const blockedItems=[]; // [{itemId, qty, sizeClass, zone, fnIdx, fnDate, fnVenue}]
    const skippedItems=[]; // [{element, qty, zone, category, fnIdx, fnDate}]
    // ── Step 1: collect itemToBlock per result row, separating skips ──────
    const accepts=[]; // {r, itemToBlock}
    for(const r of results){
      // Decision key now scoped per function so same zone/element across fns can decide independently
      const key=(typeof r.fnIdx==="number"?r.fnIdx:0)+"|"+r.zone+"|"+r.element;
      const dec=decisionsArg[key];
      let itemToBlock=null;
      if(dec?.action==="swap"&&dec.itemId){
        itemToBlock=inventory.find(i=>i.id===dec.itemId);
      }else if(dec?.action==="skip"){
        skippedItems.push({element:r.element,qty:r.qty||1,zone:r.zone||"",category:r.category||"",fnIdx:r.fnIdx,fnDate:r.fnDate});
        skipped++; continue;
      }else if(r.match){
        itemToBlock=r.match;
      }else{
        skippedItems.push({element:r.element,qty:r.qty||1,zone:r.zone||"",category:r.category||"",fnIdx:r.fnIdx,fnDate:r.fnDate});
        skipped++; continue;
      }
      if(itemToBlock) accepts.push({r,itemToBlock});
    }
    // Add manual items as accepts targeting fnIdx=0 (event-level convention)
    const fnsDetail=Array.isArray(eo.functionsDetail)?eo.functionsDetail:null;
    const fn0=fnsDetail&&fnsDetail.length?fnsDetail[0]:null;
    for(const mi of (manualItemsArg||[])){
      const item=inventory.find(i=>i.id===mi.itemId);
      if(!item) continue;
      accepts.push({
        r:{
          fnIdx:0,
          fnDate:fn0?(fn0.date||eo.date||""):(eo.date||""),
          fnVenue:fn0?(fn0.venue||""):(typeof eo.venue==="string"?eo.venue:(eo.venue?.name||"")),
          zone:"manual",
          qty:mi.qty||1,
          element:item.name
        },
        itemToBlock:item
      });
    }
    // ── Step 2: aggregate qty per (fnIdx, itemId, sizeClass) ──────────────
    // Tier 1.6 Phase 2 (05 May 2026): aggregate per composite key (itemId|sizeClass)
    // so dedup treats Small / Medium / Big as distinct physical items (a Small Chandelier
    // can't substitute for a Medium one). Blocks still write per (itemId, fnDate) since
    // blocks are physical inventory units; sum fresh across sizes when writing block rows.
    // Map: fnIdx → Map((itemId|sizeClass) → totalQty)
    const fnAgg=new Map();
    for(const a of accepts){
      const fnIdx=typeof a.r.fnIdx==="number"?a.r.fnIdx:0;
      if(!fnAgg.has(fnIdx)) fnAgg.set(fnIdx,new Map());
      const m=fnAgg.get(fnIdx);
      const id=a.itemToBlock.id;
      const sc=normalizeSizeClass(a.r.sizeClass);
      const key=id+"|"+sc;
      m.set(key,(m.get(key)||0)+(a.r.qty||1));
    }
    // ── Step 3: pairwise de-dup across functions sharing (fnDate, fnVenue) ─
    // For each fnIdx (after first), find most recent prior fnIdx with same (date, venue);
    // for non-Consumable items, reuse min(prior qty, this qty) unless overridden by Studio.
    // Build ordered fnList from functionsDetail (or single legacy fn).
    const fnList=fnsDetail&&fnsDetail.length
      ? fnsDetail.map((fn,i)=>({
          fnIdx:typeof fn.fnIdx==="number"?fn.fnIdx:i,
          fnDate:fn.date||eo.date||"",
          fnVenue:fn.venue||"",
          dedupOverrides:fn.dedupOverrides||{}
        }))
      : [{fnIdx:0,fnDate:eo.date||"",fnVenue:typeof eo.venue==="string"?eo.venue:(eo.venue?.name||""),dedupOverrides:eo.dedupOverrides||{}}];
    // freshByFn[fnIdx] = Map((itemId|sizeClass) → freshQty to actually block)
    const freshByFn=new Map();
    fnList.forEach((fn,i)=>{
      const myAgg=fnAgg.get(fn.fnIdx)||new Map();
      const myFresh=new Map();
      // Find most recent prior fn with same (date, venue)
      let prior=null;
      for(let j=i-1;j>=0;j--){
        if(fnList[j].fnDate===fn.fnDate&&(fnList[j].fnVenue||"")===(fn.fnVenue||"")){
          prior=fnList[j]; break;
        }
      }
      myAgg.forEach((qty,compositeKey)=>{
        const itemId=compositeKey.split("|")[0];
        const inv=inventory.find(x=>x.id===itemId);
        const cat=((inv?.cat)||"").toLowerCase();
        const isConsumable=cat==="consumable";
        let reuse=0;
        if(prior&&!isConsumable){
          const priorAgg=fnAgg.get(prior.fnIdx)||new Map();
          // Same-size reuse only — different sizes can't substitute physically
          const priorQty=priorAgg.get(compositeKey)||0;
          const reuseMax=Math.min(qty,priorQty);
          // Dedup overrides keyed by itemId today (legacy) — apply to total fresh post-aggregation
          const override=fn.dedupOverrides[itemId];
          reuse=(typeof override==="number")?Math.max(0,Math.min(reuseMax,override)):reuseMax;
        }
        const fresh=Math.max(0,qty-reuse);
        if(fresh>0) myFresh.set(compositeKey,fresh);
      });
      freshByFn.set(fn.fnIdx,myFresh);
    });
    // ── Step 4: write blocks per (fnIdx, itemId, fnDate) — sum across sizes ──
    // Blocks track physical inventory (qty per item per date) — size-agnostic.
    // blockedItems carries sizeClass per row so createProjectFromEO can populate
    // multi-row fn.items (one row per (invId, sizeClass)).
    fnList.forEach(fn=>{
      const myFresh=freshByFn.get(fn.fnIdx)||new Map();
      // Group fresh by itemId (sum sizes) for block writing
      const byInv=new Map();
      myFresh.forEach((qty,compositeKey)=>{
        const [itemId, sc] = compositeKey.split("|");
        byInv.set(itemId, (byInv.get(itemId)||0) + qty);
        // For project bridge — one entry per (itemId, sizeClass)
        blockedItems.push({itemId,qty,sizeClass:sc||"M",zone:"",fnIdx:fn.fnIdx,fnDate:fn.fnDate,fnVenue:fn.fnVenue});
      });
      // Write block rows summed by itemId
      byInv.forEach((sumQty, itemId)=>{
        newBlocks=addBlock(newBlocks,itemId,fn.fnDate,eo.id,sumQty,"confirmed");
        accepted++;
      });
    });
    setBlocks(newBlocks);
    saveBlocks(newBlocks);
    const updated=eventOrders.map(e=>e.id===eo.id?{...e,status:"blocked",blockedAt:Date.now(),matchSummary:{accepted,skipped,total:results.length+manualItems.length}}:e);
    setEventOrders(updated);
    saveEventOrders(updated);
    // Bridge: auto-create Project + Function for operations tabs
    createProjectFromEO(eo, blockedItems);
    // Auto-generate Purchase Orders (skipped items + floral + consumables)
    autoGeneratePOs(eo, skippedItems, blockedItems);
    if (clearReviewState) {
      setReviewEvent(null);
      setDecisions({});
      setManualItems([]);
      setInvSearch("");
      setUploadedSlides([]);
      setAiScanStatus("");
    }
  }

  const handleRelease=(eo)=>{
    if(!confirm("Release all blocked items for "+eo.clientName+"?")) return;
    const newBlocks=releaseBlocks(blocks,eo.id);
    setBlocks(newBlocks);
    saveBlocks(newBlocks);
    const updated=eventOrders.map(e=>e.id===eo.id?{...e,status:"cancelled"}:e);
    setEventOrders(updated);
    saveEventOrders(updated);
  };

  const handleFinalize=(eo)=>{
    const newBlocks=updateBlockStatus(blocks,eo.id,"confirmed","final");
    setBlocks(newBlocks);
    saveBlocks(newBlocks);
    const updated=eventOrders.map(e=>e.id===eo.id?{...e,status:"final",finalizedAt:Date.now()}:e);
    setEventOrders(updated);
    saveEventOrders(updated);
  };

  // ── Bridge: Event Order → Project + Function (multi-fn aware, 28 Apr 2026) ──
  // Tier 1.6 Phase 2 (05 May 2026): each fn.items row now carries sizeClass (S/M/B);
  // separate fn.flowerOrders array auto-derived from EO floral elements that match a
  // recipe-driven IMS pattern (used by FlowerMandiTab + calcTier1Flowerist).
  const createProjectFromEO=(eo, blockedItems)=>{
    if(!eo) return;
    // Check duplicate — don't create if this EO already has a function
    if(functions.some(f=>f.eventOrderId===eo.id)) return;
    // Check if project already exists for this client (same clientId or name+phone)
    let proj=projects.find(p=>
      (eo.clientId && p.clientId===eo.clientId) ||
      (p.client===eo.clientName && p.phone===(eo.phone||""))
    );
    const fnsDetail=Array.isArray(eo.functionsDetail)?eo.functionsDetail:null;
    const studioRcItems = studio?.rcItems || [];
    const flowerPatterns = settings?.flowerPatterns || [];
    const recipeSubcats = (settings?.flowerRecipeSubcats||[]).map(s=>String(s).toLowerCase());
    // Group blocked items by fnIdx — each row preserves sizeClass for productivity calc
    const itemsByFn=new Map();
    (blockedItems||[]).forEach(bi=>{
      const fnIdx=typeof bi.fnIdx==="number"?bi.fnIdx:0;
      if(!itemsByFn.has(fnIdx)) itemsByFn.set(fnIdx,[]);
      // §23 Phase 2.9d — lookup paintAllocation (or legacy paintOverride) from EO element snapshot for this fn+item
      let paintAllocation = null;
      let paintOverride = "";
      try {
        const inv = inventory.find(i=>i.id===bi.itemId);
        const fnDet = fnsDetail && fnsDetail[fnIdx];
        if (inv && fnDet?.elements) {
          for (const zoneEls of Object.values(fnDet.elements)) {
            if (!Array.isArray(zoneEls)) continue;
            const found = zoneEls.find(el => (el?.name||"").trim().toLowerCase() === (inv.name||"").trim().toLowerCase());
            if (found) {
              if (Array.isArray(found.paintAllocation) && found.paintAllocation.length > 0) {
                paintAllocation = found.paintAllocation.map(a => ({ qty: Number(a.qty)||0, colour: String(a.colour||"") })).filter(a => a.qty > 0 && a.colour);
              } else if (found.paintOverride) {
                paintOverride = found.paintOverride;
              }
              if (paintAllocation || paintOverride) break;
            }
          }
        }
      } catch {}
      itemsByFn.get(fnIdx).push({
        invId:bi.itemId,
        qty:bi.qty||1,
        remark:bi.zone||"",
        dept:(inventory.find(i=>i.id===bi.itemId)||{}).cat||"",
        sizeClass: normalizeSizeClass(bi.sizeClass),
        ...(paintAllocation ? {paintAllocation} : {}),
        ...(!paintAllocation && paintOverride ? {paintOverride} : {})
      });
    });

    // Auto-derive flowerOrders per fn from EO elements (Tier 1.6 Phase 2)
    // For each function detail's elements, find Florals items in recipe-driven subs
    // and match to an IMS pattern by exact name (case-insensitive trim).
    const flowerOrdersByFn = new Map();
    if (fnsDetail && fnsDetail.length) {
      fnsDetail.forEach((fn, i) => {
        const fnIdx = typeof fn.fnIdx === "number" ? fn.fnIdx : i;
        const fnFloralRatio = (typeof fn.floralRatio === "number") ? fn.floralRatio : (typeof eo.floralRatio === "number" ? eo.floralRatio : 70);
        const orders = [];
        const elementsByZone = fn.elements || {};
        for (const [zoneKey, zoneEls] of Object.entries(elementsByZone)) {
          if (!Array.isArray(zoneEls)) continue;
          for (const el of zoneEls) {
            const elName = typeof el === "string" ? el : (el?.name || "");
            if (!elName) continue;
            const normalizedName = elName.trim().toLowerCase();
            const rc = studioRcItems.find(i => String(i?.name||"").trim().toLowerCase() === normalizedName);
            if (!rc) continue;
            const isFlorals = String(rc.cat||"").toLowerCase() === "florals";
            if (!isFlorals) continue;
            const subLower = String(rc.sub||"").toLowerCase();
            if (recipeSubcats.length && !recipeSubcats.includes(subLower)) continue;
            // Match to IMS pattern by name
            const pat = flowerPatterns.find(p => String(p?.name||"").trim().toLowerCase() === normalizedName);
            if (!pat) {
              // Pattern doesn't exist yet — skip silently. UI can flag missing patterns.
              continue;
            }
            const elQty = typeof el === "object" ? (el.qty || 1) : 1;
            const sizeClass = typeof el === "object" ? normalizeSizeClass(el.size) : "M";
            const realPct = resolveRealPct(typeof el === "object" ? el : {}, rc, fnFloralRatio);
            orders.push({
              patternId: pat.id,
              patternName: pat.name,
              size: sizeClassToPatternKey(sizeClass),
              sizeClass,
              qty: elQty,
              realPct,
              zone: zoneKey,
              floralMode: String(rc.floralMode||"").toLowerCase()
            });
          }
        }
        if (orders.length) flowerOrdersByFn.set(fnIdx, orders);
      });
    }
    // Resolve venue from a fn detail row OR top-level (legacy)
    const venueOf=(fn)=>{
      const v=fn?fn.venue:(typeof eo.venue==="string"?eo.venue:(eo.venue?.name||""));
      const name=v||"";
      return {
        type:(name.includes("Pushpanjali")||name.includes("Manaktala")||name.includes("Exotica"))?"inhouse":"outdoor",
        name,
        fullAddress:""
      };
    };
    // Build fn list to iterate — either from functionsDetail or legacy fnTypes
    const fnPlan=fnsDetail&&fnsDetail.length
      ? fnsDetail.map((fn,i)=>({
          fnIdx:typeof fn.fnIdx==="number"?fn.fnIdx:i,
          fnType:fn.type||"Wedding",
          fnDate:fn.date||eo.date||"",
          fnVenue:venueOf(fn),
          fnShift:fn.shift||eo.shift||"",
          fnPax:fn.pax||eo.pax||"",
          fnBudget:Math.round(fn.total||0),
          fnFloralRatio:(typeof fn.floralRatio==="number")?fn.floralRatio:(typeof eo.floralRatio==="number"?eo.floralRatio:70)
        }))
      : ((eo.functions||["Wedding"]).filter(Boolean).length?eo.functions:["Wedding"]).map((fnType,i)=>({
          fnIdx:i,
          fnType,
          fnDate:eo.date||"",
          fnVenue:venueOf(null),
          fnShift:eo.shift||"",
          fnPax:eo.pax||"",
          fnBudget:Math.round((eo.totalCost||0)/(eo.functions||[fnType]).length),
          fnFloralRatio:(typeof eo.floralRatio==="number")?eo.floralRatio:70
        }));
    // Determine segment for crew calc
    const firstVenue=fnPlan[0]?.fnVenue||venueOf(null);
    const segment=proj?proj.segment:(firstVenue.type==="inhouse"?"inhouse":"outdoor_premium");
    const tempProj=proj||{segment};
    const newFnIds=[];
    const newFns=fnPlan.map(p=>{
      const fnId="fn_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6)+"_"+(p.fnType||"fn").slice(0,3).toLowerCase();
      newFnIds.push(fnId);
      // Items: prefer per-fn allocation; if blockedItems weren't tagged with fnIdx, fall back to all on first fn
      let fnItems=itemsByFn.get(p.fnIdx)||[];
      if(fnItems.length===0&&!fnsDetail&&p.fnIdx===0){
        // Legacy: lump all items on the only function
        fnItems=(blockedItems||[]).map(bi=>({
          invId:bi.itemId,
          qty:bi.qty||1,
          remark:bi.zone||"",
          dept:(inventory.find(i=>i.id===bi.itemId)||{}).cat||"",
          sizeClass: normalizeSizeClass(bi.sizeClass)
        }));
      }
      // Tier 1.6 Phase 2: auto-derived flower orders for this function
      const fnFlowerOrders = flowerOrdersByFn.get(p.fnIdx) || [];
      const fnObj={
        id:fnId,
        projectId:null,
        name:p.fnType,
        type:p.fnType,
        date:p.fnDate,
        budget:p.fnBudget||0,
        venue:p.fnVenue,
        items:fnItems,
        flowerOrders:fnFlowerOrders, // Tier 1.6 Phase 2 — derived from EO florals at ingestion time
        floralRatio: (typeof p.fnFloralRatio === "number") ? p.fnFloralRatio : (typeof eo.floralRatio === "number" ? eo.floralRatio : 70),
        manpower:[],
        manpowerPhases:[{phase:"event",date:p.fnDate,crew:[],status:"planned"}],
        expenses:[],
        transport:{planned:[],actual:[]},
        breakage:{provision:[],actual:[]},
        status:"Confirmed",
        adminApproval:null,
        eventOrderId:eo.id,
        shift:p.fnShift,
        pax:p.fnPax,
        brideGroom:eo.brideGroom||"",
        salesperson:eo.salesperson||""
      };
      const autoCrew=calcAutoCrew(fnObj, tempProj, settings, inventory);
      if(autoCrew.length>0){
        fnObj.manpower=autoCrew;
        fnObj.manpowerPhases=[{phase:"event",date:p.fnDate,crew:autoCrew,status:"planned"}];
      }
      return fnObj;
    });
    if(proj){
      newFns.forEach(f=>f.projectId=proj.id);
      setProjects(prev=>prev.map(p=>p.id===proj.id?{...p,functions:[...p.functions,...newFnIds]}:p));
      setFunctions(prev=>[...prev,...newFns]);
    }else{
      const projId="P_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
      newFns.forEach(f=>f.projectId=projId);
      const newProj={
        id:projId,
        name:eo.clientName+(eo.brideGroom?" — "+eo.brideGroom:""),
        client:eo.clientName||"",
        clientId:eo.clientId||"",
        phone:eo.phone||"",
        salesperson:eo.salesperson||"",
        segment,
        venueType:firstVenue.name,
        supervisorId:null,
        supervisorStatus:"pending",
        status:"Active",
        bufferOverride:null,
        functions:newFnIds,
        createdAt:Date.now(),
        eventOrderId:eo.id
      };
      setProjects(prev=>[...prev,newProj]);
      setFunctions(prev=>[...prev,...newFns]);
    }
  };

  // ── Auto-generate Purchase Orders from blocking results (multi-fn aware, 28 Apr 2026) ──
  const autoGeneratePOs=(eo, skippedItems, blockedItems)=>{
    if(!eo) return;
    const newPOs=[];
    const ts=Date.now();
    let idx=0;
    const today=new Date().toISOString().split("T")[0];
    const fnsDetail=Array.isArray(eo.functionsDetail)?eo.functionsDetail:null;
    // Helper: name + date for a given fnIdx (defaults to first fn / legacy top-level)
    const fnInfo=(fnIdx)=>{
      if(fnsDetail&&fnsDetail.length){
        const fn=fnsDetail.find(f=>(typeof f.fnIdx==="number"?f.fnIdx:0)===(fnIdx||0))||fnsDetail[0];
        return {name:fn.type||"Event", date:fn.date||eo.date||""};
      }
      return {name:(eo.functions||["Event"])[0]||"Event", date:eo.date||""};
    };
    // 1. Unmatched items — DO NOT auto-create a PO. Flag them for the salesperson to review and
    //    raise a PO manually (status:"Flagged" keeps them out of the approval queue; the Supply →
    //    Purchase tab surfaces them in a dedicated "AI-flagged" section).
    skippedItems.forEach(si=>{
      idx++;
      const info=fnInfo(si.fnIdx);
      newPOs.push({
        id:"PR_"+ts+"_"+idx,
        poNumber:`FLAG-${eo.id.slice(-6)}-${idx}`,
        item:si.element||si.name||"Unknown item",
        qty:si.qty||1,
        unit:"Piece",
        cat:si.category||"Props",
        reason:`Auto: unmatched item for ${eo.clientName} — ${info.name} (${info.date})`,
        requestedBy:"AI (unmatched)",
        estimatedCost:0,
        vendor:"",
        notes:`Event: ${eo.clientName} | Fn: ${info.name} | Zone: ${si.zone||"general"}`,
        date:today,
        status:"Flagged",
        actualCost:null,
        actualQty:null,
        approvedBy:null,
        approvedDate:null,
        vendorSnapshot:null,
        functionAllocation:eo.id,
        buildType:"purchase",
        source:"ai-flag"
      });
    });
    // 2. POs for Floral items — flowers are ALWAYS purchased fresh, ONE PO per (fn) since mandi is a single trip
    const floralByFn=new Map();
    blockedItems.forEach(bi=>{
      const inv=inventory.find(i=>i.id===bi.itemId);
      if(!inv||inv.cat!=="Floral") return;
      const fnIdx=typeof bi.fnIdx==="number"?bi.fnIdx:0;
      if(!floralByFn.has(fnIdx)) floralByFn.set(fnIdx,[]);
      floralByFn.get(fnIdx).push(bi);
    });
    floralByFn.forEach((items,fnIdx)=>{
      idx++;
      const info=fnInfo(fnIdx);
      const floralNames=items.map(bi=>{
        const inv=inventory.find(i=>i.id===bi.itemId);
        return (inv?.name||"Flowers")+" ×"+bi.qty;
      }).join(", ");
      newPOs.push({
        id:"PR_"+ts+"_fl"+idx,
        poNumber:`PO-FLOWER-${eo.id.slice(-6)}-${fnIdx}`,
        item:"Fresh Flowers — "+info.name,
        qty:1,
        unit:"Bundle",
        cat:"Florals",
        reason:`Fresh flowers for ${eo.clientName} — ${info.name} (${info.date}). Items: ${floralNames}`,
        requestedBy:"System (Auto-PO)",
        estimatedCost:0,
        vendor:"",
        notes:`Mandi purchase needed. Event: ${eo.clientName} | Date: ${info.date}`,
        date:today,
        status:"Pending",
        actualCost:null,
        actualQty:null,
        approvedBy:null,
        approvedDate:null,
        vendorSnapshot:null,
        functionAllocation:eo.id,
        buildType:"flower",
        source:"auto"
      });
    });
    // 3. POs for Consumable items — always replenish (per-fn date)
    blockedItems.forEach(bi=>{
      const inv=inventory.find(i=>i.id===bi.itemId);
      if(!inv||inv.cat!=="Consumable") return;
      idx++;
      const info=fnInfo(bi.fnIdx);
      newPOs.push({
        id:"PR_"+ts+"_c"+idx,
        poNumber:`PO-CONS-${eo.id.slice(-6)}-${idx}`,
        item:inv.name,
        qty:bi.qty||1,
        unit:inv.unit||"Piece",
        cat:"Consumable",
        reason:`Consumable replenish for ${eo.clientName} — ${info.name} (${info.date})`,
        requestedBy:"System (Auto-PO)",
        estimatedCost:inv.cost||0,
        vendor:"",
        notes:`Auto-replenish. Event: ${eo.clientName}`,
        date:today,
        status:"Pending",
        actualCost:null,
        actualQty:null,
        approvedBy:null,
        approvedDate:null,
        vendorSnapshot:null,
        functionAllocation:eo.id,
        buildType:"consumable",
        source:"auto"
      });
    });
    if(newPOs.length>0) setPurchase(prev=>[...prev,...newPOs]);
  };

  // Cancelled orders are superseded bookings (e.g. a re-pushed deal) — hide them from the live list by
  // default so one booking shows once. Toggle to review them.
  const cancelledCount=eventOrders.filter(e=>e.status==="cancelled").length;
  const sorted=[...eventOrders].filter(e=>showCancelled||e.status!=="cancelled").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-900">📋 Events</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-lg font-medium">{eventOrders.filter(e=>!e.status||e.status==="pending"||e.status==="review").length} Auto-confirming</span>
          {autoConfirmFailures && autoConfirmFailures.size > 0 && (
            <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-lg font-medium border border-red-200" title="These EOs failed auto-confirm and will retry on next render. Check console for errors.">
              ⚠ {autoConfirmFailures.size} retry
            </span>
          )}
          <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-lg font-medium">{eventOrders.filter(e=>e.status==="blocked").length} Blocked</span>
          <span className="text-xs px-2 py-1 bg-teal-100 text-teal-700 rounded-lg font-medium">{eventOrders.filter(e=>e.status==="final").length} Final</span>
          {cancelledCount>0&&(
            <button onClick={()=>setShowCancelled(v=>!v)} className={"text-xs px-2 py-1 rounded-lg font-medium border "+(showCancelled?"bg-red-100 text-red-700 border-red-200":"bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100")} title="Cancelled bookings are hidden from the live list by default">{cancelledCount} Cancelled {showCancelled?"(showing)":"(hidden)"}</button>
          )}
          <button onClick={handleRefresh} disabled={refreshing} className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-xs font-medium hover:bg-gray-50 disabled:opacity-50">{refreshing?"⏳ Refreshing...":"🔄 Refresh"}</button>
          <button onClick={()=>setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 ml-2">+ Create Event</button>
        </div>
      </div>

      {sorted.length===0&&(
        <div className="bg-white rounded-2xl border-2 border-dashed p-16 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-gray-600 font-medium">No events yet</p>
          <p className="text-gray-400 text-sm mt-1">Events appear from Studio SOLD or create manually for Platinum</p>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreate&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">✍️ Create Event</h3>
              <button onClick={()=>setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Client Name *</label>
                  <input value={createForm.clientName} onChange={e=>setCreateForm(p=>({...p,clientName:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Sharma Family" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Phone</label>
                  <input value={createForm.phone} onChange={e=>setCreateForm(p=>({...p,phone:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="9876543210" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Date *</label>
                  <input type="date" value={createForm.date} onChange={e=>setCreateForm(p=>({...p,date:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Venue *</label>
                  <select value={createForm.venue} onChange={e=>setCreateForm(p=>({...p,venue:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select venue...</option>
                    {CLIENT_VENUES.map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Functions</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {FN_TYPES.map(fn=>(
                    <button key={fn} onClick={()=>toggleFn(fn)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${createForm.functions.includes(fn)?"bg-indigo-100 border-indigo-300 text-indigo-700":"bg-white border-gray-200 text-gray-500 hover:border-indigo-200"}`}>{fn}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Shift</label>
                  <select value={createForm.shift} onChange={e=>setCreateForm(p=>({...p,shift:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                    {SHIFTS.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Category</label>
                  <select value={createForm.category} onChange={e=>setCreateForm(p=>({...p,category:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="Platinum">👑 Platinum</option>
                    <option value="Gold">🥇 Gold</option>
                    <option value="Silver">🥈 Silver</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Pax</label>
                  <input value={createForm.pax} onChange={e=>setCreateForm(p=>({...p,pax:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="300" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Bride & Groom</label>
                  <input value={createForm.brideGroom} onChange={e=>setCreateForm(p=>({...p,brideGroom:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Rahul & Priya" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Salesperson</label>
                  <input value={createForm.salesperson} onChange={e=>setCreateForm(p=>({...p,salesperson:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Name" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Notes</label>
                <textarea value={createForm.notes} onChange={e=>setCreateForm(p=>({...p,notes:e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Special requirements, PPT link, etc." />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-5 pt-4 border-t">
              <button onClick={()=>setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700">✍️ Create Event</button>
            </div>
          </div>
        </div>
      )}

      {/* Review modal */}
      {reviewEvent&&(()=>{
        const eo=eventOrders.find(e=>e.id===reviewEvent);
        const results=matchResults[reviewEvent]||[];
        if(!eo) return null;
        const matched=results.filter(r=>r.stage<=2).length;
        const unmatched=results.filter(r=>r.stage===3).length;
        const fnsDetail=Array.isArray(eo.functionsDetail)?eo.functionsDetail:null;
        // Group results by fnIdx for per-function display
        const byFn=new Map();
        results.forEach((r,origIdx)=>{
          const fnIdx=typeof r.fnIdx==="number"?r.fnIdx:0;
          if(!byFn.has(fnIdx)) byFn.set(fnIdx,[]);
          byFn.get(fnIdx).push({r,origIdx});
        });
        // Header summary
        const fnHeader=fnsDetail&&fnsDetail.length
          ? fnsDetail.map(fn=>`${fn.type||"?"} · ${fn.date||"—"}${fn.shift?" · "+fn.shift:""}`).join(" │ ")
          : `${eo.date} · ${eo.venue}`;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setReviewEvent(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Review: {eo.clientName}</h3>
                  <p className="text-sm text-gray-500">{fnHeader} · {matched} matched, {unmatched} unmatched</p>
                </div>
                <button onClick={()=>setReviewEvent(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              {/* PPT/PDF Upload + AI Scan */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold text-indigo-700 mb-2">🤖 AI Decor Scanner — Upload PPT/PDF or images</p>
                <div className="flex gap-2 items-center flex-wrap">
                  <label className="px-4 py-2 bg-white border border-indigo-300 text-indigo-700 rounded-lg text-xs font-medium cursor-pointer hover:bg-indigo-100">
                    📎 Upload File
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFileUpload(f);e.target.value="";}} />
                  </label>
                  {uploadedSlides.length>0&&(
                    <button onClick={()=>handleAiScan(eo)} disabled={aiScanning}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
                      {aiScanning?"⏳ Scanning...":"🤖 AI Scan Slides"}
                    </button>
                  )}
                  {uploadedSlides.length>0&&<span className="text-xs text-indigo-500">{uploadedSlides.length} slide{uploadedSlides.length>1?"s":""} loaded</span>}
                </div>
                {aiScanStatus&&<p className="text-xs text-indigo-600 mt-2">{aiScanStatus}</p>}
                {uploadedSlides.length>0&&(
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                    {uploadedSlides.slice(0,6).map((s,i)=>(
                      <img key={i} src={`data:${s.media_type};base64,${s.data}`} alt={`Slide ${i+1}`} className="h-16 rounded border flex-shrink-0" />
                    ))}
                    {uploadedSlides.length>6&&<span className="text-xs text-gray-400 self-center">+{uploadedSlides.length-6} more</span>}
                  </div>
                )}
              </div>

              {results.length===0&&!aiScanning&&uploadedSlides.length===0&&<p className="text-gray-400 text-center py-4">Upload a PPT/PDF to let AI identify decor, or search inventory below.</p>}
              {/* Per-function grouping */}
              {[...byFn.entries()].sort((a,b)=>a[0]-b[0]).map(([fnIdx,rows])=>{
                const fnDetail=fnsDetail?fnsDetail.find(f=>(typeof f.fnIdx==="number"?f.fnIdx:0)===fnIdx)||fnsDetail[fnIdx]:null;
                const fnLabel=fnDetail
                  ? `${fnDetail.type||"Function"} · ${fnDetail.date||"—"}${fnDetail.shift?" · "+fnDetail.shift:""}${fnDetail.venue?" · "+fnDetail.venue:""}`
                  : (fnsDetail?`Function ${fnIdx+1}`:`${eo.date} · ${eo.venue}`);
                return (
                  <div key={fnIdx} className="mb-4">
                    {(fnsDetail||byFn.size>1)&&(
                      <div className="bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-2 mb-2">
                        <p className="text-xs font-bold text-indigo-800">📌 {fnLabel}</p>
                        <p className="text-[10px] text-indigo-600">{rows.length} item{rows.length!==1?"s":""}</p>
                      </div>
                    )}
                    <div className="space-y-3">
                      {rows.map(({r,origIdx})=>{
                        const key=fnIdx+"|"+r.zone+"|"+r.element;
                        const dec=decisions[key]||{};
                        const stageColor=r.stage===1?"green":r.stage===2?"amber":"red";
                        const stageLabel=r.stage===1?"✅ Exact":r.stage===2?"🔶 Fuzzy":"❌ No match";
                        return (
                          <div key={origIdx} className="border rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">{r.element} <span className="text-xs text-gray-400">× {r.qty}</span></p>
                                <p className="text-xs text-gray-500">Zone: {r.zone}</p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-lg font-medium bg-${stageColor}-100 text-${stageColor}-700`}>{stageLabel}</span>
                            </div>
                            {r.match&&(
                              <div className={`rounded-lg p-3 mb-2 ${dec.action==="accept"||!dec.action?"bg-green-50 border border-green-200":"bg-gray-50 border"}`}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-gray-800">{r.match.name}</p>
                                    <p className="text-xs text-gray-500">{r.match.code} · {r.match.cat} › {r.match.subCat} · Avail: {r.match._avail||r.match.qty}</p>
                                  </div>
                                  <button onClick={()=>setDecisions(p=>({...p,[key]:{action:"accept",itemId:r.match.id}}))}
                                    className={`text-xs px-3 py-1 rounded-lg font-medium ${dec.action==="accept"||!dec.action?"bg-green-600 text-white":"bg-gray-200 text-gray-600"}`}>✓ Accept</button>
                                </div>
                              </div>
                            )}
                            {r.alternatives.length>0&&(
                              <div className="space-y-1 mb-2">
                                <p className="text-xs text-gray-500 font-medium">Alternatives:</p>
                                {r.alternatives.map(alt=>(
                                  <div key={alt.id} className={`rounded-lg p-2 flex items-center justify-between ${dec.action==="swap"&&dec.itemId===alt.id?"bg-blue-50 border border-blue-200":"bg-gray-50 border"}`}>
                                    <div>
                                      <p className="text-xs font-medium text-gray-700">{alt.name}</p>
                                      <p className="text-xs text-gray-400">{alt.code} · Avail: {alt._avail||alt.qty}</p>
                                    </div>
                                    <button onClick={()=>setDecisions(p=>({...p,[key]:{action:"swap",itemId:alt.id}}))}
                                      className={`text-xs px-2 py-1 rounded-lg ${dec.action==="swap"&&dec.itemId===alt.id?"bg-blue-600 text-white":"bg-gray-200 text-gray-600"}`}>↔ Swap</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <button onClick={()=>setDecisions(p=>({...p,[key]:{action:"skip"}}))}
                              className={`text-xs px-3 py-1 rounded-lg ${dec.action==="skip"?"bg-red-100 text-red-700 border border-red-200":"text-gray-400 hover:text-red-500"}`}>Skip</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Manually added items */}
              {manualItems.length>0&&(
                <div className="border-t pt-3 mt-3">
                  <p className="text-xs font-semibold text-indigo-600 mb-2">➕ Manually Added ({manualItems.length})</p>
                  {manualItems.map((mi,idx)=>{
                    const item=inventory.find(i=>i.id===mi.itemId);
                    return (
                      <div key={idx} className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{item?.name||mi.name}</p>
                          <p className="text-xs text-gray-500">{item?.code} · {item?.cat} · Qty: {mi.qty}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" value={mi.qty} min={1} onChange={e=>setManualItems(p=>p.map((m,i)=>i===idx?{...m,qty:parseInt(e.target.value)||1}:m))} className="w-14 border rounded px-2 py-1 text-xs text-center" />
                          <button onClick={()=>setManualItems(p=>p.filter((_,i)=>i!==idx))} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add from inventory */}
              <div className="border-t pt-3 mt-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">➕ Add from Inventory</p>
                <input value={invSearch} onChange={e=>setInvSearch(e.target.value)} placeholder="🔍 Search inventory by name, code, category..." className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />
                {invSearch.trim().length>=2&&(()=>{
                  const q=invSearch.toLowerCase();
                  const results=inventory.filter(i=>{
                    if(manualItems.some(m=>m.itemId===i.id)) return false;
                    const avail=getAvailableQty(i,blocks,eo.date);
                    if(avail<=0) return false;
                    return (i.name||"").toLowerCase().includes(q)||(i.code||"").toLowerCase().includes(q)||(i.cat||"").toLowerCase().includes(q)||(i.subCat||"").toLowerCase().includes(q);
                  }).slice(0,8);
                  return results.length>0?(
                    <div className="border rounded-lg max-h-48 overflow-y-auto">
                      {results.map(item=>(
                        <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b last:border-0">
                          <div>
                            <p className="text-xs font-medium text-gray-800">{item.name}</p>
                            <p className="text-xs text-gray-400">{item.code} · {item.cat} › {item.subCat} · Avail: {getAvailableQty(item,blocks,eo.date)}</p>
                          </div>
                          <button onClick={()=>{setManualItems(p=>[...p,{itemId:item.id,name:item.name,qty:1,zone:"manual"}]);setInvSearch("");}}
                            className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">+ Add</button>
                        </div>
                      ))}
                    </div>
                  ):<p className="text-xs text-gray-400 text-center py-2">No matching items found</p>;
                })()}
              </div>

              <div className="flex gap-3 justify-end mt-6 pt-4 border-t">
                <button onClick={()=>{setReviewEvent(null);setManualItems([]);setInvSearch("");setUploadedSlides([]);setAiScanStatus("");}} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
                <button onClick={()=>handleConfirm(eo)} className="px-6 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700">🔒 Confirm & Block</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Event cards */}
      {sorted.map(eo=>{
        const status=eo.status||"pending";
        const sc=statusColors[status]||"gray";
        const eventBlocks=getEventBlocks(blocks,eo.id);
        const hrs48=eo.blockedAt&&(Date.now()-eo.blockedAt)>48*60*60*1000;
        const isManual=eo.source==="manual";
        const catColor=eo.category==="Platinum"?"purple":eo.category==="Gold"?"amber":"gray";

        return (
          <div key={eo.id} className="bg-white rounded-2xl border p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-bold text-gray-900">{eo.clientName||"Unnamed Client"}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${isManual?"bg-violet-100 text-violet-700":"bg-blue-100 text-blue-700"}`}>{isManual?"✍️ Manual":"🤖 Studio"}</span>
                  {eo.category&&<span className={`text-xs px-2 py-0.5 rounded font-medium bg-${catColor}-100 text-${catColor}-700`}>{eo.category==="Platinum"?"👑":"🥇"} {eo.category}</span>}
                </div>
                <p className="text-sm text-gray-500">📅 {eo.date||"No date"} · 🏛️ {eo.venue||"No venue"} · {(eo.functions||[]).join(", ")||"—"}</p>
                {eo.salesperson&&<p className="text-xs text-gray-400 mt-1">👤 {eo.salesperson} · {eo.shift||"—"}{eo.brideGroom?" · 💍 "+eo.brideGroom:""}{eo.pax?" · 👥 "+eo.pax:""}</p>}
                {eo.notes&&<p className="text-xs text-gray-400 mt-1 italic">📝 {eo.notes}</p>}
              </div>
              <span className={`text-xs px-3 py-1 rounded-lg font-semibold bg-${sc}-100 text-${sc}-700`}>{statusLabels[status]||status}</span>
            </div>

            {eo.totalCost>0&&<p className="text-sm font-semibold text-green-600 mb-2">{fmt(eo.totalCost)}</p>}

            {eventBlocks.length>0&&(
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1">🔒 {eventBlocks.length} items blocked</p>
                <div className="flex flex-wrap gap-1">
                  {eventBlocks.slice(0,8).map((b,i)=>{
                    const item=inventory.find(it=>it.id===b.itemId);
                    return <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{item?.name||b.itemId} ×{b.qty}</span>;
                  })}
                  {eventBlocks.length>8&&<span className="text-xs text-gray-400">+{eventBlocks.length-8} more</span>}
                </div>
              </div>
            )}

            {eo.matchSummary&&(
              <div className="flex gap-3 text-xs mb-3">
                <span className="text-green-600 font-medium">✅ {eo.matchSummary.accepted} accepted</span>
                <span className="text-gray-400">⏭️ {eo.matchSummary.skipped} skipped</span>
                <span className="text-gray-400">Total: {eo.matchSummary.total}</span>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {/* §2.5.1 (28 May 2026): Pending = auto-confirming. No manual Process button — IMS trusts
                  the salesperson's Deal Check in Studio. Shows spinner/status indicator only. */}
              {(status==="pending"||!status||status==="review")&&(
                <div className="px-4 py-2 bg-amber-50 text-amber-800 rounded-xl text-xs font-medium border border-amber-200 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                  ⏳ Auto-confirming…
                </div>
              )}
              {status==="blocked"&&!hrs48&&(
                <button onClick={()=>{setReviewEvent(eo.id);if(!matchResults[eo.id])handleProcess(eo);}}
                  className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600">✏️ Correct (48hr)</button>
              )}
              {status==="blocked"&&hrs48&&(
                <button onClick={()=>handleFinalize(eo)}
                  className="px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold hover:bg-teal-700">✅ Finalize</button>
              )}
              {(status==="blocked"||status==="review")&&(
                <button onClick={()=>handleRelease(eo)}
                  className="px-3 py-2 border border-red-200 text-red-500 rounded-xl text-xs font-medium hover:bg-red-50">🗑 Release</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

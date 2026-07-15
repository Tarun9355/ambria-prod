// Event Order auto-confirm engine — moved out of the old IMS "Events" tab (EventsTab.jsx,
// deleted) so it runs as a background process regardless of which IMS tab is open, instead of
// only while a human happened to have that tab mounted. Call useEventOrderAutoConfirm(...) once,
// unconditionally, near the top of IMS.jsx.
//
// What it does, end to end, for every Studio SOLD deal (event_orders row) that arrives at
// status "pending" (or the legacy "review"):
//   1. aiMatchEvent — 3-stage inventory matching (exact → fuzzy → unmatched) per function/zone/element.
//   2. executeConfirmBlocks — dedups reused items across same-day/venue functions, writes inventory
//      reservations into the `blocks` table, flips the EO to "blocked".
//   3. createProjectFromEO — auto-creates the Project + Function rows Planning/Dept Ops/Inventory
//      availability all depend on.
//   4. autoGeneratePOs / executeFabricBlocks — auto-raises Purchase Orders for unmatched/floral/
//      consumable items and fabric shortfalls.
//
// `releaseBlocks` (cancel an event + free its held inventory) is exported standalone — the IMS
// Calendar tab uses it directly for its per-event "Cancel" button; it isn't part of the
// auto-confirm pipeline itself.
import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeSizeClass, sizeClassToPatternKey } from "./flowerHelpers";

export const resolveRealPct = (el, rcItem, fnFloralRatio) => {
  if (typeof el?.realPct === "number") return Math.max(0, Math.min(100, el.realPct));
  const mode = String(rcItem?.floralMode||"").toLowerCase();
  if (mode === "real")       return 100;
  if (mode === "artificial") return 0;
  const ratio = (typeof fnFloralRatio === "number") ? fnFloralRatio : 70;
  return Math.max(0, Math.min(100, 100 - ratio));
};

export function getAvailableQty(item, blocks, date){
  const itemBlocks=(blocks||{})[item.id]||[];
  const blockedOnDate=itemBlocks.filter(b=>b.date===date&&b.status!=="released").reduce((s,b)=>s+(b.qty||1),0);
  return (item.qty||0)-(item.blocked||0)-blockedOnDate;
}

export function addBlock(blocks, itemId, date, eventId, qty, status="held"){
  const next={...blocks};
  if(!next[itemId]) next[itemId]=[];
  next[itemId]=[...next[itemId],{date,eventId,qty:qty||1,status,createdAt:Date.now()}];
  return next;
}

export function updateBlockStatus(blocks, eventId, fromStatus, toStatus){
  const next={};
  for(const [itemId,arr] of Object.entries(blocks||{})){
    next[itemId]=arr.map(b=>b.eventId===eventId&&b.status===fromStatus?{...b,status:toStatus}:b);
  }
  return next;
}

export function releaseBlocks(blocks, eventId){
  const next={};
  for(const [itemId,arr] of Object.entries(blocks||{})){
    next[itemId]=arr.filter(b=>b.eventId!==eventId);
  }
  return next;
}

export function getEventBlocks(blocks, eventId){
  const result=[];
  for(const [itemId,arr] of Object.entries(blocks||{})){
    for(const b of arr){
      if(b.eventId===eventId) result.push({itemId,...b});
    }
  }
  return result;
}

// ─── AI MATCHING (3-stage) ───────────────────────────────────────────────────
export function matchElementToInventory(elName, elCat, inventory, date, blocks){
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

export async function aiMatchEvent(eventOrder, inventory, blocks, opts){
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

export function calcAutoCrew(fnObj, projObj, settings, inventory){
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

// ─── Background auto-confirm hook — call once, unconditionally, in IMS.jsx ──────────────────
export function useEventOrderAutoConfirm({ eventOrders, setEventOrders, inventory, blocks, setBlocks, saveBlocks, saveEventOrders, projects, setProjects, functions, setFunctions, purchase, setPurchase, settings, studio, trussInv, setTrussInv }){
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

  // ── Bridge: Event Order → Project + Function (multi-fn aware, 28 Apr 2026) ──
  // Tier 1.6 Phase 2 (05 May 2026): each fn.items row now carries sizeClass (S/M/B);
  // separate fn.flowerOrders array auto-derived from EO floral elements that match a
  // recipe-driven IMS pattern (used by FlowerMandiTab + calcTier1Flowerist).
  function createProjectFromEO(eo, blockedItems){
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
  }

  // ── Auto-generate Purchase Orders from blocking results (multi-fn aware, 28 Apr 2026) ──
  function autoGeneratePOs(eo, skippedItems, blockedItems){
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
  }

  // Core executor — does AI-match-results → dedup → blocks → Project/Function bridge.
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
    const updated=eventOrders.map(e=>e.id===eo.id?{...e,status:"blocked",blockedAt:Date.now(),matchSummary:{accepted,skipped,total:results.length+manualItemsArg.length}}:e);
    setEventOrders(updated);
    saveEventOrders(updated);
    // Bridge: auto-create Project + Function for operations tabs
    createProjectFromEO(eo, blockedItems);
    // Auto-generate Purchase Orders (skipped items + floral + consumables)
    autoGeneratePOs(eo, skippedItems, blockedItems);
  }

  // Tier 1.6 Phase 2 (05 May 2026): auto-confirm flow.
  // Sales has already done Deal Check in Studio (matched/skipped/production decisions, manual items,
  // dedup overrides — all in eo.functionsDetail[].* and eo.manualItems). Re-asking ops to "Review" + "Confirm"
  // duplicates work and gates Function creation behind a manual click.
  // Auto path: when a new pending EO arrives, run AI matching directly + commit blocks using AI's own
  // confidence (decisions={} = accept all matched, skip null) + EO's Studio-side manual items.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, blocks, eventOrders, studio, settings, projects, functions, purchase, trussInv]);

  // Auto-confirm new pending EOs + any stuck legacy "review" EOs (§2.5.1 migration).
  // - Pending: run AI match → block.
  // - Review (legacy): re-run autoConfirmEO so it goes straight to "blocked".
  // Tracks processed IDs in a ref; on failure the EO is NOT marked, so it retries.
  const autoConfirmedRef = useRef(new Set());
  const [autoConfirmFailures, setAutoConfirmFailures] = useState(new Set());
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

  return { autoConfirmFailures };
}

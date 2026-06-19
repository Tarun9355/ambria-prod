import { useState, useEffect } from "react";
import { Badge, Modal, Field, Input, Sel, Btn } from "../../components/ui";
import {
  MANPOWER_TYPES,
  DEFAULT_RATES,
  DUMPING_LEVELS,
  EVENT_TIMINGS,
  SIT_MULT_DEFAULTS,
  heavyExtraLabour,
} from "../../lib/ims/constants";
import { hoursFromSlots, calcDihari } from "../../lib/ims/helpers";
import { resolveSizeKey, sizeClassToPatternKey } from "../../lib/ims/flowerHelpers";

// ─── Local helpers (copied verbatim from reference) ───────────────────────────
function getEventTimingFromTime(timeStr){
  if(!timeStr) return EVENT_TIMINGS[3]; // default dinner
  const [h,m]=(timeStr||"19:00").split(":").map(Number);
  const hour=h+(m||0)/60;
  for(const t of EVENT_TIMINGS){ if(hour<t.beforeHour) return t; }
  return EVENT_TIMINGS[4];
}
function fmt(n){ return "₹"+(Number(n)||0).toLocaleString("en-IN"); }

export default function ManpowerTab({ projects, functions, setFunctions, settings, setSettings, vendors, setVendors, inventory }){
  const [selProject, setSelProject]=useState(projects[0]?.id||"");
  const [selFn, setSelFn]=useState("");
  const [selPhase, setSelPhase]=useState("event");
  const [addModal, setAddModal]=useState(false);
  const [slotModal, setSlotModal]=useState(false);
  const [editType, setEditType]=useState(null);
  const [logModal, setLogModal]=useState(false);
  const [logEntry, setLogEntry]=useState({action:"arrived",type:MANPOWER_TYPES[0],qty:1,note:""});
  const [viewMode, setViewMode]=useState("plan"); // "plan" | "log" | "timeline"

  const proj=projects.find(p=>p.id===selProject);
  const fnList=(proj?.functions||[]).map(fid=>functions.find(f=>f.id===fid)).filter(Boolean);
  const fn=functions.find(f=>f.id===selFn);

  useEffect(()=>{ if(fnList.length&&!selFn) setSelFn(fnList[0].id); },[selProject]);

  // ── Ensure manpowerPhases exists ───────────────────────────────────────────
  function getPhases(fn){ return fn?.manpowerPhases||[{phase:"event",date:fn?.date||"",crew:fn?.manpower||[],status:"planned"}]; }
  function getPhase(fn, phase){ return getPhases(fn).find(p=>p.phase===phase); }
  function getCrew(fn, phase){ return getPhase(fn,phase)?.crew||[]; }

  function setPhases(fnId, updater){
    setFunctions(prev=>prev.map(f=>{
      if(f.id!==fnId) return f;
      const existing=f.manpowerPhases||[{phase:"event",date:f.date||"",crew:f.manpower||[],status:"planned"}];
      return {...f, manpowerPhases:updater(existing)};
    }));
  }

  function addPhase(phase){
    const date=phase==="setup"?(() => {const d=new Date(fn.date);d.setDate(d.getDate()-1);return d.toISOString().split("T")[0];})()
                :phase==="dismantle"?(() => {const d=new Date(fn.date);d.setDate(d.getDate()+1);return d.toISOString().split("T")[0];})()
                :fn.date;
    setPhases(selFn, phases=>[...phases,{phase,date,crew:[],status:"planned"}]);
    setSelPhase(phase);
  }
  function removePhase(phase){ setPhases(selFn, phases=>phases.filter(p=>p.phase!==phase)); if(selPhase===phase) setSelPhase("event"); }

  // ── Crew CRUD ──────────────────────────────────────────────────────────────
  function addCrew(type){
    const tierCfg=(settings.labourTiers||{})[type]||{tier:1};
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:[...p.crew,{
      type, qty:1, rate:DEFAULT_RATES[type]||500, source:"own", vendorId:null, vendorRate:null,
      remark:"", slots:[], reusedFrom:null, reusedCumHours:null, tier:tierCfg.tier
    }]}:p));
  }
  function updateCrew(type, field, val){
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:p.crew.map(c=>c.type===type?{...c,[field]:val}:c)}:p));
  }
  function removeCrew(type){
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:p.crew.filter(c=>c.type!==type)}:p));
  }
  function addSlot(type, slot){
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:p.crew.map(c=>c.type===type?{...c,slots:[...c.slots,slot]}:c)}:p));
  }
  function removeSlot(type, i){
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:p.crew.map(c=>c.type===type?{...c,slots:c.slots.filter((_,j)=>j!==i)}:c)}:p));
  }

  // ── Tier Calculations ──────────────────────────────────────────────────────
  // Tier 1.6 Phase 2 (05 May 2026): calcTier1 routes Flowerists/Electricians to new
  // productivity-based helpers. Manpower Matrix data preserved in Redis but no longer
  // consulted (MM tab deleted from UI). For any non-F/E type, returns 0 (MM was Tier 1
  // only — other types use Tier 2/3).
  function calcTier1Flowerist(fnArg){
    const orders = fnArg?.flowerOrders || [];
    const patterns = settings?.flowerPatterns || [];
    if (!orders.length || !patterns.length) return 0;
    let total = 0;
    let missingProductivity = 0;
    orders.forEach(o => {
      const pat = patterns.find(p => p.id === o.patternId);
      if (!pat) return;
      const sizeKey = resolveSizeKey(pat.sizes, o.size || "medium");
      if (!sizeKey) return;
      const sizeData = pat.sizes?.[sizeKey];
      const productivity = Number(sizeData?.unitsPerFlowerist);
      if (!productivity || productivity <= 0) {
        missingProductivity++;
        return;
      }
      total += Math.ceil((Number(o.qty)||0) / productivity);
    });
    if (missingProductivity > 0) {
      // Surface in console — Tarun fills in IMS Settings → Flower Patterns
      // (not blocking; just under-reports until productivity values land)
      // eslint-disable-next-line no-console
      console.warn(`[tier16] ${missingProductivity} flower order(s) missing unitsPerFlowerist productivity — flowerist count under-reports.`);
    }
    return total;
  }

  function calcTier1Electrician(fnArg){
    const items = fnArg?.items || [];
    const prodTable = settings?.electricianProductivity || {};
    if (!items.length || !Object.keys(prodTable).length) return 0;
    let total = 0;
    let missingProductivity = 0;
    items.forEach(it => {
      const inv = inventory?.find(i => i.id === it.invId);
      if (!inv) return;
      if (String(inv.cat||"").toLowerCase() !== "lighting") return;
      const sub = inv.subCat || "";
      const prod = prodTable[sub];
      if (!prod) {
        missingProductivity++;
        return;
      }
      const sizeKey = sizeClassToPatternKey(it.sizeClass);
      const productivity = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
      if (!productivity || productivity <= 0) {
        missingProductivity++;
        return;
      }
      total += Math.ceil((Number(it.qty)||0) / productivity);
    });
    if (missingProductivity > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[tier16] ${missingProductivity} Lighting item(s) missing electrician productivity — electrician count under-reports.`);
    }
    return total;
  }

  function calcTier1(type){
    if (type === "Flowerists")  return calcTier1Flowerist(fn);
    if (type === "Electricians") return calcTier1Electrician(fn);
    return 0; // Other types not in Tier 1 anymore
  }

  function calcTier2(type){
    const cfg=(settings.labourTiers||{})[type]||{minimum:1,subCatBatches:{}};
    const batches=cfg.subCatBatches||{};
    const items=fn?.items||[];
    // Count elements per sub-category
    const subCatCounts={};
    items.forEach(it=>{
      const inv=inventory?.find(i=>i.id===it.invId);
      if(inv&&batches[inv.subCat]) subCatCounts[inv.subCat]=(subCatCounts[inv.subCat]||0)+it.qty;
    });
    // Calculate workers needed per sub-category, then sum
    let total=0;
    Object.entries(subCatCounts).forEach(([sc,count])=>{
      const batch=batches[sc]||3;
      total+=Math.ceil(count/batch);
    });
    return Math.max(cfg.minimum||1, total);
  }

  function calcTier3(type){
    if(type==="Helpers") return 0;
    const venueName=fn?.venue?.name||"";
    const venueConfig=(settings.venueMinLabour||{})[venueName];
    const venueMin=typeof venueConfig==="object"?(venueConfig?.min||4):((typeof venueConfig==="number"?venueConfig:null)||settings.defaultMinLabour||4);
    // Dumping: function override → project default → venue setting
    const fnDumping=fn?.dumpingSpace;
    const projDumping=proj?.dumpingSpace;
    const venueDumping=typeof venueConfig==="object"?venueConfig?.dumpingLevel:null;
    const dumpingLevel=fnDumping||projDumping||venueDumping||"nearby";
    const dumpingMult=(DUMPING_LEVELS.find(d=>d.id===dumpingLevel)||{}).mult||1.0;
    const segment=proj?.segment||"outdoor_budgeted";
    const dayPrior=fn?.setupAccess==="day_prior_confirmed";

    // Layer 1 — Event Type (always applies)
    const eventMult=(settings.eventTypeMultipliers||{})[segment]||1;
    const base=Math.ceil(venueMin*eventMult);

    // Layer 2 — Situational (pick highest only, excluded if day-prior)
    let situationalMult=1.0;
    if(!dayPrior){
      const candidates=[dumpingMult];
      // Heavy Saya from season calendar
      const fnDate=fn?.date||"";
      const season=(settings.seasonMap||{})[fnDate];
      // Heavy Saya now uses the per-type factor (Workforce tab); single scalar removed.
      const heavySayaOn=season==="kings"||(settings.datePricing?.markedDates||{})[fnDate]==="heavy_saya";
      if(heavySayaOn) candidates.push((settings.situationalMultipliers?.heavySaya||{})[type]||SIT_MULT_DEFAULTS.heavySaya[type]||1.3);
      // Event timing — THIS function's start time determines pressure
      const fnTiming=getEventTimingFromTime(fn?.eventStartTime);
      const fnTimingMult=(settings.eventTimingMultipliers||{})[fnTiming.id]||fnTiming.mult;
      candidates.push(fnTimingMult);
      situationalMult=Math.max(...candidates,1.0);
    }
    const adjusted=Math.ceil(base*situationalMult);

    // Step 4 — Heavy Element Add-ons
    let heavyExtra=0;
    const items=fn?.items||[];
    (settings.heavyElementRanges||[]).forEach(her=>{
      const count=items.reduce((s,it)=>{
        const inv=(inventory||[]).find(i=>i.id===it.invId);
        return s+(inv?.subCat===her.subCat?it.qty:0);
      },0);
      heavyExtra += heavyExtraLabour(her, count);
    });

    return adjusted+heavyExtra;
  }

  // Multi-function MAX calculation for same venue
  function calcLabourWithMultiFnMax(){
    if(!fn||!proj) return calcTier3("Labours");
    const venueName=fn.venue?.name||"";
    const sameDaySameVenueFns=fnList.filter(f=>f.date===fn.date&&(f.venue?.name||"")=== venueName);
    if(sameDaySameVenueFns.length<=1) return calcTier3("Labours");
    // Calculate for each function, take max
    const counts=sameDaySameVenueFns.map(otherFn=>{
      const savedFn=fn; const savedPhase=selPhase;
      // Temporarily compute for otherFn using same logic
      const tempVenueConfig=(settings.venueMinLabour||{})[otherFn.venue?.name||""];
      const tempMin=typeof tempVenueConfig==="object"?(tempVenueConfig?.min||4):((typeof tempVenueConfig==="number"?tempVenueConfig:null)||settings.defaultMinLabour||4);
      const otherDumpLevel=otherFn.dumpingSpace||proj?.dumpingSpace||(typeof tempVenueConfig==="object"?tempVenueConfig?.dumpingLevel:null)||"nearby";
      const tempDump=(DUMPING_LEVELS.find(d=>d.id===otherDumpLevel)||{}).mult||1.0;
      const eventMult=(settings.eventTypeMultipliers||{})[proj?.segment||"outdoor_budgeted"]||1;
      const base=Math.ceil(tempMin*eventMult);
      const dp=otherFn.setupAccess==="day_prior_confirmed";
      let sitMult=1.0;
      if(!dp){
        const cands=[tempDump];
        const season=(settings.seasonMap||{})[otherFn.date||""];
        const heavySayaOn=season==="kings"||(settings.datePricing?.markedDates||{})[otherFn.date||""]==="heavy_saya";
        if(heavySayaOn) cands.push((settings.situationalMultipliers?.heavySaya||{}).Labours||SIT_MULT_DEFAULTS.heavySaya.Labours||1.3);
        // Event timing — this function's own start time
        const otherTiming=getEventTimingFromTime(otherFn.eventStartTime);
        const otherTimingMult=(settings.eventTimingMultipliers||{})[otherTiming.id]||otherTiming.mult;
        cands.push(otherTimingMult);
        sitMult=Math.max(...cands,1.0);
      }
      const adj=Math.ceil(base*sitMult);
      let heavy=0;
      (settings.heavyElementRanges||[]).forEach(her=>{
        const cnt=(otherFn.items||[]).reduce((s,it)=>{const inv=(inventory||[]).find(i=>i.id===it.invId);return s+(inv?.subCat===her.subCat?it.qty:0);},0);
        heavy += heavyExtraLabour(her, cnt);
      });
      return {fn:otherFn, count:adj+heavy};
    });
    return Math.max(...counts.map(c=>c.count));
  }

  // Setup access helper
  function setSetupAccess(val){
    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,setupAccess:val}:f));
  }

  function calcTier4(type){
    // Search past events for similar context
    const log=settings.manpowerLog||[];
    const fabricArea=0;
    const similar=log.filter(l=>Math.abs((l.fabricAreaSqft||0)-fabricArea)<100);
    if(similar.length>0){
      const avg=Math.round(similar.reduce((s,l)=>s+(l.actual?.[type]||l.planned?.[type]||0),0)/similar.length);
      return {qty:avg||2,references:similar.slice(0,3),source:"past"};
    }
    const defaults={"Fabric Bangali":2, "Truss Labour":2};
    return {qty:defaults[type]||2, references:[], source:"default"};
  }

  // ── Pillar-Range Calculation (Truss Labour) ────────────────────────────────
  function calcTrussLabourFromPillars(pillarCount){
    const ranges=settings.trussLabourRanges||[];
    if(!pillarCount||pillarCount<=0||ranges.length===0) return {qty:ranges[0]?.labour||6, reason:"Base minimum"};
    for(const r of ranges){
      if(pillarCount<=r.upTo) return {qty:r.labour, reason:`${pillarCount} pillars → ${r.labour} truss labour (up to ${r.upTo})`};
    }
    const last=ranges[ranges.length-1];
    return {qty:last?.labour||6, reason:`${pillarCount} pillars → ${last?.labour} (max range)`};
  }

  // ── SqFt-Range Calculation (Fabric Bangali) ───────────────────────────────
  function calcFabricBangaliFromSqft(sqft){
    const ranges=settings.fabricBangaliRanges||[];
    if(!sqft||sqft<=0||ranges.length===0) return {qty:ranges[0]?.labour||3, reason:"Base minimum"};
    for(const r of ranges){
      if(sqft<=r.upTo) return {qty:r.labour, reason:`${sqft} sqft → ${r.labour} Fabric Bangali (up to ${r.upTo} sqft)`};
    }
    const last=ranges[ranges.length-1];
    return {qty:last?.labour||3, reason:`${sqft} sqft → ${last?.labour} (max range)`};
  }

  // Get pillar count and truss sqft from function data
  const fnPillarCount=fn?.trussPillarCount||0;
  function setFnPillarCount(count){
    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,trussPillarCount:count}:f));
  }
  const fnTrussList=fn?.trussList||[];
  function setFnTrussList(list){
    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,trussList:list}:f));
  }
  function addTruss(){
    // §23 Phase 2.8 — new rows default to full_box (legacy Box behaviour)
    setFnTrussList([...fnTrussList,{label:"",type:"full_box",l:"",w:"",sides:{left:false,right:false,back:false}}]);
  }
  function setTrussType(i, newType){
    // §23 Phase 2.8 — switching type applies the new spec's defaults silently
    const list = fnTrussList.map((t,j)=>{
      if (j !== i) return t;
      const next = {...t, type: newType};
      const sides = {...(t.sides||{})};
      if (newType === "half_box") {
        // Default back/left/right on (per spec — Half Box defaults all 3 walls)
        if (sides.back  === undefined) sides.back  = true;
        if (sides.left  === undefined) sides.left  = true;
        if (sides.right === undefined) sides.right = true;
        delete sides.front;
        next.w = ""; // Half Box doesn't use W
      } else if (newType === "u_only") {
        if (sides.back === undefined) sides.back = true;
        delete sides.left;
        delete sides.right;
        delete sides.front;
        next.w = "";
      } else if (newType === "full_box") {
        delete sides.front; // Full Box never has front
      }
      next.sides = sides;
      return next;
    });
    setFnTrussList(list);
    recalcFB(list);
  }
  function updateTruss(i,k,v){
    const newList=fnTrussList.map((t,j)=>j===i?{...t,[k]:v}:t);
    setFnTrussList(newList);
    return newList;
  }
  function toggleTrussSide(i,side){
    const t=fnTrussList[i];
    const sides={...(t.sides||{}), [side]:!(t.sides||{})[side]};
    const newList=fnTrussList.map((tt,j)=>j===i?{...tt,sides}:tt);
    setFnTrussList(newList);
    return newList;
  }
  function removeTruss(i){
    const newList=fnTrussList.filter((_,j)=>j!==i);
    setFnTrussList(newList);
    return newList;
  }

  // Single U-Truss RFT
  const fnSingleURft=fn?.singleURft||0;
  function setFnSingleURft(val){
    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,singleURft:val}:f));
  }

  // §23 Phase 2.8 (26 May 2026) — IMS Fabric Bangali aligned with Studio per-zone rule.
  //   • Each truss row rounds independently (per-zone ceil, not summed pool)
  //   • 3 truss types: full_box (L×W + back/left/right), half_box (L + back/left/right via backDepth), u_only (L back only)
  //   • Full Box: back/left/right toggleable, NEVER front (always-open audience side)
  //   • Half Box: back (L-span) + left/right (backDepth each)
  //   • U Truss:  back only (L-span). No left/right options.
  //   • Standalone singleURft retired — now a row with type=u_only (auto-migrated on load)
  //   • Defaults: Half Box → back/left/right=true. U Truss → back=true. Full Box → opt-in (untouched).
  // Per-row independent ceil: total = Σ (rowTop + ceil(rowRft / fabricRftPerWorker))
  function calcTotalFabricBangali(list){
    const tList=list||fnTrussList;
    const rftPerWorker=settings.fabricRftPerWorker||100;
    const backDepth=settings.fabricBackDepthFt||4;
    // Handle legacy singleURft (treat as virtual u_only row) until migration runs
    const legacySingleURft = Number(fnSingleURft) || 0;
    if(tList.length===0 && !legacySingleURft) return {total:0,breakdown:[],topLabour:0,rftLabour:0,totalRft:0,singleURft:0,sideWallRft:0};

    const rows = [...tList];
    if (legacySingleURft > 0) {
      // Virtual row to preserve back-compat — count it as u_only with back=true
      rows.push({ label: "Single U-Truss (legacy)", type: "u_only", l: legacySingleURft, w: 0, sides: {back: true}, _virtual: true });
    }

    const breakdown = rows.map((t,i)=>{
      const type = t.type || ((parseInt(t.w)||0) > 0 ? "full_box" : "full_box"); // default full_box for legacy
      const l = parseInt(t.l) || 0;
      const w = parseInt(t.w) || 0;
      const sides = t.sides || {};
      let rowTop = 0;
      let rowRft = 0;
      const partsLabel = [];

      if (type === "full_box") {
        const sqft = l * w;
        if (sqft > 0) {
          const result = calcFabricBangaliFromSqft(sqft);
          rowTop = result.qty || 0;
        }
        if (sides.back  && l > 0) { rowRft += l; partsLabel.push(`back ${l}`); }
        if (sides.left  && w > 0) { rowRft += w; partsLabel.push(`left ${w}`); }
        if (sides.right && w > 0) { rowRft += w; partsLabel.push(`right ${w}`); }
        // sides.front silently ignored — Full Box front is always open
      } else if (type === "half_box") {
        if (sides.back  && l > 0)         { rowRft += l;         partsLabel.push(`back ${l}`); }
        if (sides.left  && backDepth > 0) { rowRft += backDepth; partsLabel.push(`left ${backDepth}`); }
        if (sides.right && backDepth > 0) { rowRft += backDepth; partsLabel.push(`right ${backDepth}`); }
      } else if (type === "u_only") {
        if (sides.back && l > 0) { rowRft += l; partsLabel.push(`back ${l}`); }
      }

      const rowRftLabour = rowRft > 0 ? Math.ceil(rowRft / rftPerWorker) : 0;
      const rowTotal = rowTop + rowRftLabour;
      return {
        label: t.label || `Truss ${i+1}`,
        type,
        l: t.l,
        w: t.w,
        sqft: type === "full_box" ? (l*w) : 0,
        labour: rowTop,
        sideRft: rowRft,
        rftLabour: rowRftLabour,
        rowTotal,
        sides,
        partsLabel: partsLabel.join(" + "),
        _virtual: !!t._virtual
      };
    });

    const topLabour    = breakdown.reduce((s,b)=>s+b.labour,0);
    const sideWallRft  = breakdown.filter(b=>!b._virtual).reduce((s,b)=>s+b.sideRft,0);
    const singleU      = legacySingleURft;
    const totalRft     = breakdown.reduce((s,b)=>s+b.sideRft,0);
    const rftLabour    = breakdown.reduce((s,b)=>s+b.rftLabour,0); // per-row ceiled, summed
    const total        = breakdown.reduce((s,b)=>s+b.rowTotal,0);
    return {total,breakdown,topLabour,rftLabour,totalRft,singleURft:singleU,sideWallRft};
  }
  function recalcFB(newList){
    const {total}=calcTotalFabricBangali(newList);
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:p.crew.map(cc=>cc.type==="Fabric Bangali"?{...cc,qty:total||0}:cc)}:p));
  }

  // ── Situational Multiplier System ──────────────────────────────────────────
  function applySituationalMultipliers(baseQty, type){
    if(type==="Supervisors"||type==="Drivers") return {adjusted:baseQty, rawMult:1, capped:false, factors:[]};
    const sm=settings.situationalMultipliers||{};
    const cap=settings.situationalMultiplierCap||1.8;
    const factors=[];

    // Factor 1 — Date Category (only Heavy Saya pushes up, others 1.0)
    let dateMult=1.0;
    const fnDate=fn?.date||"";
    const dateCategory=(settings.datePricing?.markedDates||{})[fnDate];
    if(dateCategory==="heavy_saya"){
      dateMult=(sm.heavySaya||{})[type]||SIT_MULT_DEFAULTS.heavySaya[type]||1.0;
      factors.push({label:"🔴 Heavy Saya",mult:dateMult});
    } else {
      factors.push({label:dateCategory==="non_saya"?"🟢 Non-Saya":"🟡 Competition",mult:1.0});
    }

    // Factor 2 — Event Segment (only Premium pushes up, others 1.0)
    let segMult=1.0;
    const segment=proj?.segment||"outdoor_budgeted";
    if(segment==="outdoor_premium"){
      segMult=(sm.premium||{})[type]||SIT_MULT_DEFAULTS.premium[type]||1.0;
      factors.push({label:"★ Premium",mult:segMult});
    } else {
      factors.push({label:segment==="inhouse"?"🏠 In-house":"$ Budgeted",mult:1.0});
    }

    // Factor 3 — Setup Timing (day-prior can go below, rush goes above)
    let timingMult=1.0;
    const setupAccess=fn?.setupAccess||"same_day";
    const dayPriorConfirmed=setupAccess==="day_prior_confirmed";
    const dayPriorTentative=setupAccess==="day_prior_tentative";
    const bookingDays=fn?.date?Math.ceil((new Date(fn.date)-new Date())/(1000*60*60*24)):999;
    const isRush=bookingDays<=(settings.datePricing?.lastMinuteDays||10)&&bookingDays>=0;
    if(dayPriorConfirmed){
      timingMult=(sm.dayPrior||{})[type]||SIT_MULT_DEFAULTS.dayPrior[type]||1.0;
      factors.push({label:"📅 Day-Prior ✓",mult:timingMult});
    } else if(isRush&&!dayPriorTentative){
      timingMult=(sm.rush||{})[type]||SIT_MULT_DEFAULTS.rush[type]||1.0;
      factors.push({label:"⚡ Rush",mult:timingMult});
    } else {
      factors.push({label:dayPriorTentative?"🟡 Tentative (calc as same-day)":"📅 Same-Day",mult:1.0});
    }

    // Factor 4 — Event Timing (lunch/brunch/sundowner): tighter setup window multiplies
    // ALL manpower types. Skipped on day-prior confirmed (extra day removes the pressure).
    let evtTimingMult=1.0;
    if(!dayPriorConfirmed){
      const ev=getEventTimingFromTime(fn?.eventStartTime);
      evtTimingMult=(settings.eventTimingMultipliers||{})[ev.id]||ev.mult||1.0;
      if(evtTimingMult!==1.0) factors.push({label:`⏰ ${ev.label||ev.id}`,mult:evtTimingMult});
    }

    const rawMult=dateMult*segMult*timingMult*evtTimingMult;
    const cappedMult=Math.min(rawMult, cap);
    const wasCapped=rawMult>cap;
    const adjusted=Math.max(1, Math.ceil(baseQty*cappedMult));
    // If tentative, calculate what day-prior would give
    let tentativeSavings=null;
    if(dayPriorTentative){
      const dpMult=(sm.dayPrior||{})[type]||SIT_MULT_DEFAULTS.dayPrior[type]||1.0;
      const dpRaw=dateMult*segMult*dpMult;
      const dpCapped=Math.min(dpRaw,cap);
      const dpAdj=Math.max(1, Math.ceil(baseQty*dpCapped));
      if(dpAdj<adjusted) tentativeSavings={ifConfirmed:dpAdj, saving:adjusted-dpAdj};
    }
    return {adjusted, rawMult:parseFloat(rawMult.toFixed(3)), cappedMult:parseFloat(cappedMult.toFixed(3)), capped:wasCapped, factors, cap, tentativeSavings};
  }

  function getSuggestion(type){
    const tier=((settings.labourTiers||{})[type]||{}).tier;
    if(tier===1){
      const base=calcTier1(type);
      const sm=applySituationalMultipliers(base,type);
      return {qty:sm.adjusted,tier:1,reason:"Element-driven (matrix)",baseQty:base,sitMult:sm};
    }
    if(tier===2){
      const cfg=(settings.labourTiers||{})[type]||{};
      const batches=cfg.subCatBatches||{};
      const items=fn?.items||[];
      const breakdown=[];
      Object.keys(batches).forEach(sc=>{
        const count=items.reduce((s,it)=>{const inv=inventory?.find(i=>i.id===it.invId);return s+(inv?.subCat===sc?it.qty:0);},0);
        if(count>0) breakdown.push(`${count} ${sc} ÷ ${batches[sc]}`);
      });
      const reason=breakdown.length>0?`Min ${cfg.minimum||1} + ${breakdown.join(" + ")}`:`Min ${cfg.minimum||1} (no matching items)`;
      const base=calcTier2(type);
      const sm=applySituationalMultipliers(base,type);
      return {qty:sm.adjusted,tier:2,reason,baseQty:base,sitMult:sm};
    }
    if(tier===3){
      const maxCount=calcLabourWithMultiFnMax();
      const singleCount=calcTier3(type);
      const venueName=fn?.venue?.name||"";
      const venueConfig=(settings.venueMinLabour||{})[venueName];
      const venueMin=typeof venueConfig==="object"?(venueConfig?.min||4):((typeof venueConfig==="number"?venueConfig:null)||settings.defaultMinLabour||4);
      const segment=proj?.segment||"outdoor_budgeted";
      const eventMult=(settings.eventTypeMultipliers||{})[segment]||1;
      const dayPrior=fn?.setupAccess==="day_prior_confirmed";
      const tentative=fn?.setupAccess==="day_prior_tentative";
      let reason=`${venueName||"Default"} (${venueMin}) × ${segment==="outdoor_premium"?"Premium":"Budgeted"} ${eventMult}`;
      if(!dayPrior) reason+=" × situational";
      else reason+=" (day-prior ✓: no situational)";
      if(tentative) reason+=" (tentative day-prior: calc as same-day)";
      if(maxCount>singleCount) reason+=` · MAX across ${fnList.filter(f=>f.date===fn.date&&(f.venue?.name||"")=== venueName).length} same-day fns`;
      return {qty:maxCount,tier:3,reason};
    }
    if(tier==="pillar-range"){
      const r=calcTrussLabourFromPillars(fnPillarCount);
      const sm=applySituationalMultipliers(r.qty,type);
      return {qty:sm.adjusted,tier:"pillar-range",reason:r.reason,baseQty:r.qty,sitMult:sm};
    }
    if(tier==="sqft-range"){
      const r=calcTotalFabricBangali();
      const base=r.total||3;
      const sm=applySituationalMultipliers(base,type);
      const topPart=r.breakdown.filter(b=>b.sqft>0).map(b=>`${b.label} ${b.sqft}sqft→${b.labour}`).join(" + ");
      const rftPart=r.totalRft>0?`${r.totalRft}RFT→${r.rftLabour}`:"";
      const reason=topPart||rftPart?[topPart,rftPart].filter(Boolean).join(" + "):"Add trusses to calculate";
      return {qty:sm.adjusted,tier:"sqft-range",reason,baseQty:base,sitMult:sm};
    }
    if(tier===4){ const r=calcTier4(type); const sm=applySituationalMultipliers(r.qty,type); return {qty:sm.adjusted,tier:4,reason:r.source==="past"?`Based on ${r.references.length} similar events`:"Default estimate",references:r.references,baseQty:r.qty,sitMult:sm}; }
    return {qty:1,tier:"fixed",reason:"Fixed"};
  }

  // ── Reuse Detection ────────────────────────────────────────────────────────
  function detectReuse(){
    if(!fn||!proj) return [];
    const venueName=fn.venue?.name||"";
    const sameDayFns=fnList.filter(f=>f.id!==fn.id&&f.date===fn.date);
    const reusable=[];
    sameDayFns.forEach(otherFn=>{
      const otherVenue=otherFn.venue?.name||"";
      // Check if same venue property (same name or both are sub-venues of same parent)
      const sameProperty=otherVenue===venueName||
        (settings.venues||[]).some(v=>v.subVenues?.some(sv=>sv.name===venueName)&&v.subVenues?.some(sv=>sv.name===otherVenue))||
        (settings.venues||[]).some(v=>v.name===venueName||v.name===otherVenue);
      if(!sameProperty) return;
      const otherCrew=(otherFn.manpowerPhases||[{crew:otherFn.manpower||[]}]).flatMap(p=>p.crew||[]);
      if(otherCrew.length>0){
        const otherSlots=otherCrew.flatMap(c=>c.slots||[]);
        const otherEnd=otherSlots.reduce((latest,s)=>{
          const [h,m]=(s.end||"00:00").split(":").map(Number);
          let mins=h*60+m; if(mins<240) mins+=1440; return Math.max(latest,mins);
        },0);
        const mySlots=getCrew(fn,selPhase).flatMap(c=>c.slots||[]);
        const myStart=mySlots.reduce((earliest,s)=>{
          const [h,m]=(s.start||"23:59").split(":").map(Number);
          let mins=h*60+m; if(mins<240) mins+=1440; return Math.min(earliest,mins);
        },1440*2);
        if(otherEnd<myStart){
          reusable.push({fn:otherFn, crew:otherCrew, gap:Math.round((myStart-otherEnd)/60*10)/10});
        }
      }
    });
    return reusable;
  }

  // ── Approval ───────────────────────────────────────────────────────────────
  function approvePlan(){
    setPhases(selFn, phases=>phases.map(p=>({...p,status:"approved",approvedBy:"Dept Head",approvedAt:new Date().toISOString()})));
  }
  function unlockPlan(){
    setPhases(selFn, phases=>phases.map(p=>({...p,status:"planned",approvedBy:null,approvedAt:null})));
  }
  const currentPhase=getPhase(fn,selPhase);
  const isLocked=currentPhase?.status==="approved";
  const allPhasesApproved=getPhases(fn).every(p=>p.status==="approved");

  // ── Supervisor Log ─────────────────────────────────────────────────────────
  function addLogEntry(){
    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,
      manpowerActivityLog:[...(f.manpowerActivityLog||[]),{
        ...logEntry, time:new Date().toTimeString().slice(0,5), date:new Date().toISOString().split("T")[0], phase:selPhase
      }]
    }:f));
    setLogEntry({action:"arrived",type:MANPOWER_TYPES[0],qty:1,note:""});
    setLogModal(false);
  }

  // ── Cost Calculation ───────────────────────────────────────────────────────
  function calcPhaseCost(phase){
    const crew=getCrew(fn,phase?.phase||selPhase);
    return crew.reduce((sum,c)=>{
      const h=hoursFromSlots(c.slots);
      const rate=c.source==="vendor"?(c.vendorRate||c.rate):c.rate;
      const cumH=c.reusedCumHours||0;
      const totalH=cumH+h;
      const dihari=c.reusedFrom?calcDihari(totalH,rate):calcDihari(h,rate);
      return sum+c.qty*dihari;
    },0);
  }
  const totalCost=getPhases(fn).reduce((s,p)=>s+calcPhaseCost(p),0);
  const totalPeople=getPhases(fn).reduce((s,p)=>s+(p.crew||[]).reduce((ss,c)=>ss+c.qty,0),0);

  const phases=getPhases(fn);
  const hasSetup=phases.some(p=>p.phase==="setup");
  const hasDismantle=phases.some(p=>p.phase==="dismantle");
  const crew=getCrew(fn,selPhase);
  const existingTypes=crew.map(c=>c.type);
  const availTypes=MANPOWER_TYPES.filter(t=>t!=="Drivers"&&!existingTypes.includes(t));
  const reusable=detectReuse();

  const BAR_COLORS=["bg-purple-500","bg-blue-500","bg-green-500","bg-amber-500","bg-red-500","bg-indigo-500","bg-pink-500","bg-teal-500","bg-orange-500","bg-cyan-500"];
  const HOURS=Array.from({length:21},(_,i)=>i+4);
  const TIER_LABELS={1:"⚡ Element",2:"📊 Min+Scale",3:"🏢 Venue",4:"🤖 AI+Ref","pillar-range":"🔩 Pillars","sqft-range":"📐 SqFt","fixed":"📌 Fixed"};
  const TIER_COLORS={1:"indigo",2:"amber",3:"blue",4:"purple","pillar-range":"teal","sqft-range":"orange","fixed":"gray"};

  // ── Apply AI suggestions for all tiers ─────────────────────────────────────
  function autoFillSuggestions(){
    const newCrew=MANPOWER_TYPES.filter(t=>t!=="Drivers"&&t!=="Supervisors").map(type=>{
      const s=getSuggestion(type);
      if(s.qty<=0) return null;
      const tier=((settings.labourTiers||{})[type]||{}).tier||1;
      return {type,qty:s.qty,rate:DEFAULT_RATES[type]||500,source:"own",vendorId:null,vendorRate:null,
        remark:`[Auto] ${s.reason}`,slots:[],reusedFrom:null,reusedCumHours:null,tier};
    }).filter(Boolean);
    setPhases(selFn, phases=>phases.map(p=>p.phase===selPhase?{...p,crew:newCrew}:p));
  }

  if(!fn) return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Sel value={selProject} onChange={e=>{setSelProject(e.target.value);setSelFn("");}}>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
      </div>
      <div className="text-center py-16 text-gray-400">Select a project with functions to plan manpower</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── Header: Project + Function selector ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <Sel value={selProject} onChange={e=>{setSelProject(e.target.value);setSelFn("");}} className="w-48">
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={selFn} onChange={e=>setSelFn(e.target.value)} className="w-56">
          {fnList.map(f=><option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
        </Sel>
        <div className="ml-auto flex gap-2">
          {allPhasesApproved
            ?<Btn onClick={unlockPlan} color="amber" size="sm">🔓 Unlock Plan</Btn>
            :<Btn onClick={approvePlan} color="green" size="sm">✅ Approve & Lock</Btn>}
          <Btn onClick={()=>setLogModal(true)} color="gray" size="sm">📝 Log Activity</Btn>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-3 text-center"><p className="text-2xl font-bold text-indigo-700">{totalPeople}</p><p className="text-xs text-gray-500">Total People</p></div>
        <div className="bg-white border rounded-xl p-3 text-center"><p className="text-2xl font-bold text-green-700">{fmt(totalCost)}</p><p className="text-xs text-gray-500">Total Cost</p></div>
        <div className="bg-white border rounded-xl p-3 text-center"><p className="text-2xl font-bold text-purple-700">{phases.length}</p><p className="text-xs text-gray-500">Phases</p></div>
        <div className="bg-white border rounded-xl p-3 text-center">
          <p className={"text-2xl font-bold "+(allPhasesApproved?"text-green-600":"text-amber-600")}>{allPhasesApproved?"✅":"⏳"}</p>
          <p className="text-xs text-gray-500">{allPhasesApproved?"Approved":"Pending"}</p>
        </div>
      </div>

      {/* ── Phase Tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {phases.map(p=>(
          <button key={p.phase} onClick={()=>setSelPhase(p.phase)}
            className={"px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all "+(selPhase===p.phase?"border-indigo-500 bg-indigo-50 text-indigo-800":"border-gray-200 text-gray-600 hover:border-indigo-300")}>
            {p.phase==="setup"?"🔨 Setup Day":p.phase==="event"?"🎉 Event Day":"🧹 Dismantle"}
            {p.status==="approved"&&" ✅"}
            <span className="text-xs ml-1 opacity-60">({(p.crew||[]).reduce((s,c)=>s+c.qty,0)} people)</span>
          </button>
        ))}
        {!hasSetup&&<button onClick={()=>addPhase("setup")} className="text-xs text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-300 px-3 py-2 rounded-xl hover:bg-indigo-50">+ Setup Day</button>}
        {!hasDismantle&&<button onClick={()=>addPhase("dismantle")} className="text-xs text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-300 px-3 py-2 rounded-xl hover:bg-indigo-50">+ Dismantle</button>}
      </div>

      {/* ── Locked Banner ── */}
      {isLocked&&(
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div><p className="text-sm font-bold text-green-800">✅ Plan Approved & Locked</p><p className="text-xs text-green-600 mt-0.5">Approved by {currentPhase.approvedBy} · Only Dept Head / Admin can modify</p></div>
          <Btn onClick={unlockPlan} color="amber" size="sm">🔓 Unlock</Btn>
        </div>
      )}

      {/* ── View Toggles ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {[["plan","📋 Crew Plan"],["timeline","📊 Timeline"],["log","📝 Activity Log"]].map(([id,label])=>(
          <button key={id} onClick={()=>setViewMode(id)}
            className={"px-4 py-2 rounded-lg text-sm font-medium transition-all "+(viewMode===id?"bg-white shadow text-gray-900":"text-gray-500 hover:text-gray-700")}>
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CREW PLAN VIEW                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {viewMode==="plan"&&(
        <div className="space-y-3">
          {/* Reuse Detection */}
          {reusable.length>0&&(
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-bold text-blue-800 mb-2">🔄 Same-Day Reuse Available</p>
              {reusable.map((r,i)=>(
                <div key={i} className="bg-white rounded-lg p-3 mb-2 border border-blue-100">
                  <p className="text-sm text-blue-900"><strong>{r.fn.name}</strong> ({r.fn.venue?.name}) finishes with {r.gap}h gap</p>
                  <p className="text-xs text-blue-600 mt-1">Available: {r.crew.map(c=>`${c.type} ×${c.qty}`).join(", ")}</p>
                  <p className="text-xs text-amber-600 mt-1">⚠️ Function B pays overtime rate if cumulative hours exceed 8h</p>
                </div>
              ))}
            </div>
          )}

          {/* Auto-fill button */}
          {!isLocked&&crew.length===0&&(
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-violet-800">🤖 Auto-fill from Tier Calculations</p>
                <p className="text-xs text-violet-600 mt-0.5">System will suggest crew based on inventory items, venue, event type, and past data</p>
              </div>
              <Btn onClick={autoFillSuggestions} size="sm">⚡ Auto-Fill</Btn>
            </div>
          )}

          {/* Crew Cards */}
          {crew.map((c,ci)=>{
            const h=hoursFromSlots(c.slots);
            const rate=c.source==="vendor"?(c.vendorRate||c.rate):c.rate;
            const dihari=calcDihari(h,rate);
            const lineCost=c.qty*dihari;
            const tierLabel=TIER_LABELS[c.tier]||"";
            const tierColor=TIER_COLORS[c.tier]||"gray";
            const suggestion=getSuggestion(c.type);
            const mpVendors=(vendors||[]).filter(v=>v.active&&["Manpower Contractor","Service"].includes(v.type));

            return (
              <div key={c.type} className={"bg-white border rounded-xl overflow-hidden "+(isLocked?"opacity-80":"")}>
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-gray-50">
                  <span className="font-bold text-gray-900 text-sm">{c.type}</span>
                  <Badge color={tierColor}>{tierLabel}</Badge>
                  <Badge color="indigo">×{c.qty}</Badge>
                  <Badge color={c.source==="vendor"?"green":"gray"}>{c.source==="vendor"?"🏢 Vendor":"👤 Own"}</Badge>
                  {c.reusedFrom&&<Badge color="blue">🔄 Reused</Badge>}
                  <span className="ml-auto text-sm font-bold text-indigo-700">{fmt(lineCost)}</span>
                  {!isLocked&&<button onClick={()=>removeCrew(c.type)} className="text-red-400 hover:text-red-600 text-sm ml-2">✕</button>}
                </div>
                {!isLocked&&(
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                      <Field label="Qty">
                        <div className="flex items-center gap-2">
                          <Input type="number" min="1" value={c.qty} onChange={e=>updateCrew(c.type,"qty",parseInt(e.target.value)||1)} />
                          {suggestion.qty>0&&suggestion.qty!==c.qty&&(
                            <button onClick={()=>updateCrew(c.type,"qty",suggestion.qty)}
                              className="text-xs text-violet-600 hover:text-violet-800 whitespace-nowrap" title={suggestion.reason}>
                              💡 {suggestion.qty}
                            </button>
                          )}
                        </div>
                      </Field>
                      <Field label="Source">
                        <Sel value={c.source} onChange={e=>updateCrew(c.type,"source",e.target.value)}>
                          <option value="own">👤 Own Crew</option>
                          <option value="vendor">🏢 Vendor</option>
                        </Sel>
                      </Field>
                      <Field label={c.source==="vendor"?"Vendor Rate ₹":"Dihari Rate ₹"}>
                        <Input type="number" value={c.source==="vendor"?(c.vendorRate||""):c.rate}
                          onChange={e=>updateCrew(c.type,c.source==="vendor"?"vendorRate":"rate",parseFloat(e.target.value)||0)} />
                      </Field>
                      {c.source==="vendor"&&(
                        <Field label="Vendor">
                          <Sel value={c.vendorId||""} onChange={e=>{
                            const v=mpVendors.find(x=>x.id===e.target.value);
                            updateCrew(c.type,"vendorId",e.target.value);
                            if(v?.isFixed&&v.storedRate) updateCrew(c.type,"vendorRate",v.storedRate.amount);
                          }}>
                            <option value="">— Select —</option>
                            {mpVendors.map(v=><option key={v.id} value={v.id}>{v.name} {v.overallScore?"⭐"+v.overallScore:""}</option>)}
                          </Sel>
                        </Field>
                      )}
                    </div>
                    {/* Tier 3 Labour — Factor Breakdown */}
                    {c.tier===3&&(()=>{
                      const venueName=fn?.venue?.name||"";
                      const venueConfig=(settings.venueMinLabour||{})[venueName];
                      const venueMin=typeof venueConfig==="object"?(venueConfig?.min||4):((typeof venueConfig==="number"?venueConfig:null)||settings.defaultMinLabour||4);
                      const dumpMult=typeof venueConfig==="object"?(venueConfig?.dumping||1.0):1.0;
                      const segment=proj?.segment||"outdoor_budgeted";
                      const eventMult=(settings.eventTypeMultipliers||{})[segment]||1;
                      const setupAccess=fn?.setupAccess||"same_day";
                      const dayPrior=setupAccess==="day_prior_confirmed";
                      const tentative=setupAccess==="day_prior_tentative";
                      const base=Math.ceil(venueMin*eventMult);
                      const season=(settings.seasonMap||{})[fn?.date||""];
                      const sayaMult=season==="kings"?(settings.sayaMultiplier||1.3):1.0;
                      const fnTiming=getEventTimingFromTime(fn?.eventStartTime);
                      const timingMult=(settings.eventTimingMultipliers||{})[fnTiming.id]||fnTiming.mult;
                      const timingLabel=fnTiming.label;
                      const sitCandidates=dayPrior?[1.0]:[dumpMult,sayaMult,timingMult];
                      const sitMax=Math.max(...sitCandidates,1.0);
                      const sitWinner=dayPrior?"none (day-prior ✓)":sitMax===dumpMult&&dumpMult>1?"Dumping ×"+dumpMult:sitMax===sayaMult&&sayaMult>1?"Saya ×"+sayaMult:sitMax===timingMult&&timingMult>1?timingLabel+" ×"+timingMult:"none";
                      let heavyExtra=0;
                      const heavyBreakdown=[];
                      (settings.heavyElementRanges||[]).forEach(her=>{
                        const cnt=(fn?.items||[]).reduce((s,it)=>{const inv=(inventory||[]).find(i=>i.id===it.invId);return s+(inv?.subCat===her.subCat?it.qty:0);},0);
                        const ex = heavyExtraLabour(her, cnt);
                        if (ex > 0) { heavyExtra += ex; heavyBreakdown.push(`${her.subCat}: ${cnt} → +${ex}`); }
                      });
                      const sameDayFns=fnList.filter(f=>f.date===fn.date&&(f.venue?.name||"")===venueName);
                      return (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                          <p className="text-xs font-bold text-blue-800">🏢 Labour Factor Breakdown</p>
                          {/* Setup Access status — set by Sales in function detail */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-blue-800 font-medium">📅 Setup Access:</span>
                            <div className="flex gap-1">
                              {[{id:"same_day",label:"🔴 Same-Day",active:"border-red-400 bg-red-100 text-red-700"},{id:"day_prior_confirmed",label:"🟢 Day-Prior ✓",active:"border-green-400 bg-green-100 text-green-700"},{id:"day_prior_tentative",label:"🟡 Tentative",active:"border-amber-400 bg-amber-100 text-amber-700"}].map(opt=>(
                                <button key={opt.id} onClick={()=>{
                                  setSetupAccess(opt.id);
                                  setTimeout(()=>{const result=calcLabourWithMultiFnMax();updateCrew(c.type,"qty",result);},50);
                                }}
                                  className={"text-xs px-2.5 py-1 rounded-lg border-2 font-medium transition-all "+(setupAccess===opt.id?opt.active:"border-gray-200 text-gray-500 hover:border-blue-300")}>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            {tentative&&<span className="text-xs text-amber-600 italic">Calculates as same-day (conservative)</span>}
                          </div>
                          {/* Dumping space selector */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-blue-800 font-medium">🚛 Dumping Space:</span>
                            <div className="flex gap-1">
                              {DUMPING_LEVELS.map(d=>{
                                const currentLevel=fn?.dumpingSpace||proj?.dumpingSpace||(typeof venueConfig==="object"?venueConfig?.dumpingLevel:null)||"nearby";
                                return (
                                  <button key={d.id} onClick={()=>{
                                    setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,dumpingSpace:d.id}:f));
                                    const vName=fn?.venue?.name||"";
                                    if(vName&&!(settings.venueMinLabour||{})[vName]){
                                      setSettings(s=>({...s,venueMinLabour:{...s.venueMinLabour,[vName]:{min:s.defaultMinLabour||4,dumpingLevel:d.id}}}));
                                    }
                                  }}
                                    className={"text-xs px-2.5 py-1 rounded-lg border-2 font-medium transition-all "+(currentLevel===d.id?"border-blue-500 bg-blue-100 text-blue-800":"border-gray-200 text-gray-500 hover:border-blue-300")}>
                                    {d.label} {d.mult>1?"(×"+d.mult+")":""}
                                  </button>
                                );
                              })}
                            </div>
                            {fn?.dumpingSpace&&<button onClick={()=>setFunctions(prev=>prev.map(f=>f.id===selFn?{...f,dumpingSpace:null}:f))} className="text-xs text-gray-400 hover:text-red-500">↩ Reset to venue default</button>}
                          </div>
                          {/* Factor pills */}
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-xs bg-white border border-blue-200 rounded-full px-2 py-0.5">🏢 Venue: {venueName||"Default"} ({venueMin})</span>
                            <span className="text-xs bg-blue-100 border border-blue-300 text-blue-700 rounded-full px-2 py-0.5 font-medium">Layer 1: {segment==="outdoor_premium"?"★ Premium":segment==="inhouse"?"🏠 In-house":"$ Budgeted"} ×{eventMult}</span>
                            {!dayPrior&&sitMax>1&&<span className="text-xs bg-amber-100 border border-amber-300 text-amber-700 rounded-full px-2 py-0.5 font-medium">Layer 2: {sitWinner} (highest)</span>}
                            {dayPrior&&<span className="text-xs bg-green-100 border border-green-300 text-green-700 rounded-full px-2 py-0.5 font-medium">✅ Day-prior confirmed — no situational multiplier</span>}
                          </div>
                          {/* Situational candidates (when not day-prior) */}
                          {!dayPrior&&(
                            <div className="flex flex-wrap gap-1">
                              {[["🚛 Dumping",dumpMult],["👑 Saya",sayaMult],[timingLabel,timingMult]].map(([label,val])=>(
                                <span key={label} className={"text-xs px-2 py-0.5 rounded-full border "+(val===sitMax&&val>1?"bg-amber-500 text-white border-amber-500":"bg-white text-gray-500 border-gray-200")}>
                                  {label} ×{val} {val===sitMax&&val>1?"← used":""}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Heavy elements */}
                          {heavyBreakdown.length>0&&(
                            <div className="text-xs text-blue-700">
                              <span className="font-medium">Heavy elements:</span> {heavyBreakdown.join(", ")} = +{heavyExtra}
                            </div>
                          )}
                          {/* Multi-fn MAX + Event timing info */}
                          {sameDayFns.length>1&&(
                            <div className="text-xs bg-purple-50 border border-purple-200 rounded-lg px-2 py-1.5 text-purple-700 space-y-1">
                              <p>🔄 {sameDayFns.length} functions same day at {venueName} — each calculates independently, MAX count used</p>
                              <div className="flex flex-wrap gap-1">
                                {sameDayFns.map(f=>{
                                  const et=getEventTimingFromTime(f.eventStartTime);
                                  return <span key={f.id} className={"px-2 py-0.5 rounded-full border "+(f.id===fn.id?"bg-purple-100 border-purple-300 font-medium":"bg-white border-gray-200")}>{f.name}: {f.eventStartTime||"TBD"} ({et.label})</span>;
                                })}
                              </div>
                            </div>
                          )}
                          {/* Tentative day-prior savings hint */}
                          {tentative&&(()=>{
                            // Calculate what day-prior would give for Tier 3
                            const dpCandidates=[1.0]; // day-prior kills situational
                            const dpAdj=Math.ceil(base*1.0)+heavyExtra;
                            const currentAdj=Math.ceil(base*sitMax)+heavyExtra;
                            return dpAdj<currentAdj?(
                              <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1.5 text-yellow-700">
                                💡 If day-prior confirms → {dpAdj} labours (saves {currentAdj-dpAdj})
                              </div>
                            ):null;
                          })()}
                          {/* Summary */}
                          <div className="bg-white border border-blue-100 rounded-lg px-3 py-2 flex items-center justify-between">
                            <span className="text-xs text-gray-600">{venueMin} × {eventMult}{!dayPrior&&sitMax>1?` × ${sitMax}`:""}{heavyExtra>0?` + ${heavyExtra} heavy`:""}</span>
                            <span className="text-sm font-bold text-blue-700">= {c.qty} Labours</span>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Situational Multiplier Breakdown (for non-Tier-3 types) */}
                    {suggestion.sitMult&&suggestion.sitMult.rawMult!==1&&c.tier!==3&&(
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-bold text-amber-800">⚡ Situational Multipliers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {suggestion.sitMult.factors.map((f,fi)=>(
                            <span key={fi} className={"text-xs px-2 py-0.5 rounded-full border "+(f.mult!==1?"bg-amber-100 border-amber-300 text-amber-700 font-medium":"bg-white border-gray-200 text-gray-500")}>
                              {f.label} ×{f.mult}
                            </span>
                          ))}
                        </div>
                        <div className="bg-white border border-amber-100 rounded-lg px-3 py-2 flex items-center justify-between">
                          <span className="text-xs text-gray-600">Base {suggestion.baseQty} × {suggestion.sitMult.cappedMult}{suggestion.sitMult.capped?" (⚠️ capped from ×"+suggestion.sitMult.rawMult+")":""}</span>
                          <span className="text-sm font-bold text-amber-700">= {suggestion.qty} {c.type}</span>
                        </div>
                        {suggestion.sitMult.tentativeSavings&&(
                          <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1.5 text-yellow-700">
                            💡 If day-prior confirms → {suggestion.sitMult.tentativeSavings.ifConfirmed} {c.type} (saves {suggestion.sitMult.tentativeSavings.saving})
                          </div>
                        )}
                      </div>
                    )}
                    {/* Pillar-based planning for Truss Labour */}
                    {c.tier==="pillar-range"&&(
                      <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-teal-800">🔩 Truss Pillar Count → Labour</p>
                          {fnPillarCount>0&&<span className="text-xs text-teal-600 font-medium">{fnPillarCount} pillars → {calcTrussLabourFromPillars(fnPillarCount).qty} labour</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600">Total Pillars:</span>
                            <input type="number" min="0" value={fnPillarCount||""} onChange={e=>{
                              const count=parseInt(e.target.value)||0;
                              setFnPillarCount(count);
                              const result=calcTrussLabourFromPillars(count);
                              updateCrew(c.type,"qty",result.qty);
                            }}
                              className="w-20 border border-teal-300 rounded-lg px-3 py-1.5 text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-teal-300" placeholder="0" />
                          </div>
                          <span className="text-lg text-gray-300">→</span>
                          <div className="bg-white border border-teal-200 rounded-lg px-3 py-1.5">
                            <span className="text-sm font-bold text-teal-700">{c.qty} Truss Labour</span>
                          </div>
                        </div>
                        {/* Range reference strip */}
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(settings.trussLabourRanges||[]).map((r,ri)=>{
                            const prevMax=ri>0?(settings.trussLabourRanges[ri-1].upTo+1):1;
                            const isActive=fnPillarCount>=prevMax&&fnPillarCount<=r.upTo;
                            return (
                              <span key={ri} className={"text-xs px-2 py-0.5 rounded-full border "+(isActive?"bg-teal-600 text-white border-teal-600":"bg-white text-gray-500 border-gray-200")}>
                                {prevMax}–{r.upTo>9000?"∞":r.upTo} → {r.labour}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* SqFt-based planning for Fabric Bangali */}
                    {c.tier==="sqft-range"&&(()=>{
                      const {total,breakdown,topLabour,rftLabour,totalRft,singleURft,sideWallRft}=calcTotalFabricBangali();
                      const rftPerWorker=settings.fabricRftPerWorker||100;
                      const backDepth=settings.fabricBackDepthFt||4;
                      return (
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-bold text-orange-800">📐 Fabric Bangali — Per-truss (Studio-aligned §23 Phase 2.8)</p>
                            <p className="text-xs text-orange-600 mt-0.5">Each truss rounds independently. Full Box: back/left/right (no front). Half Box: back + L/R via backDepth. U Truss: back only.</p>
                          </div>
                          <button onClick={()=>{addTruss(); }} className="text-xs bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Truss</button>
                        </div>

                        {/* Truss list */}
                        {fnTrussList.length===0&&!fnSingleURft&&(
                          <div className="text-center py-4 text-gray-400 text-xs border-2 border-dashed border-orange-200 rounded-lg">
                            No trusses added. Click "+ Add Truss" to start.
                          </div>
                        )}
                        {fnTrussList.map((t,i)=>{
                          const type = t.type || "full_box";
                          const l = parseInt(t.l)||0;
                          const w = parseInt(t.w)||0;
                          const sides = t.sides||{};
                          const sqft = type==="full_box" ? l*w : 0;
                          const perTruss = sqft>0 ? calcFabricBangaliFromSqft(sqft) : {qty:0};
                          let rowRft = 0;
                          if (type==="full_box") {
                            if (sides.back  && l>0) rowRft += l;
                            if (sides.left  && w>0) rowRft += w;
                            if (sides.right && w>0) rowRft += w;
                          } else if (type==="half_box") {
                            if (sides.back  && l>0)         rowRft += l;
                            if (sides.left  && backDepth>0) rowRft += backDepth;
                            if (sides.right && backDepth>0) rowRft += backDepth;
                          } else if (type==="u_only") {
                            if (sides.back && l>0) rowRft += l;
                          }
                          const rowRftLab = rowRft>0 ? Math.ceil(rowRft/rftPerWorker) : 0;
                          const rowTotal = (sqft>0?perTruss.qty:0) + rowRftLab;
                          const sideOpts = type==="full_box" ? [
                            {key:"back", label:`Back (${l}ft)`},
                            {key:"left", label:`Left (${w}ft)`},
                            {key:"right",label:`Right (${w}ft)`}
                          ] : type==="half_box" ? [
                            {key:"back", label:`Back (${l}ft · L-span)`},
                            {key:"left", label:`Left (${backDepth}ft · backDepth)`},
                            {key:"right",label:`Right (${backDepth}ft · backDepth)`}
                          ] : [
                            {key:"back", label:`Back (${l}ft · L-span)`}
                          ];
                          return (
                            <div key={i} className="bg-white border border-orange-100 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <input value={t.label} onChange={e=>updateTruss(i,"label",e.target.value)}
                                  className="w-28 border rounded px-2 py-1 text-xs" placeholder={`Truss ${i+1} name`} />
                                {/* Truss type selector */}
                                <select value={type} onChange={e=>setTrussType(i, e.target.value)}
                                  className="border border-orange-200 rounded px-2 py-1 text-xs font-medium bg-orange-50">
                                  <option value="full_box">Full Box</option>
                                  <option value="half_box">Half Box</option>
                                  <option value="u_only">U Truss</option>
                                </select>
                                <span className="text-xs text-gray-500">L:</span>
                                <input type="number" value={t.l} onChange={e=>{
                                  const nl=updateTruss(i,"l",e.target.value); recalcFB(nl);
                                }} className="w-14 border border-orange-200 rounded px-2 py-1 text-xs text-center" placeholder="ft" />
                                {type==="full_box" && <>
                                  <span className="text-xs text-gray-400">×</span>
                                  <span className="text-xs text-gray-500">W:</span>
                                  <input type="number" value={t.w} onChange={e=>{
                                    const nl=updateTruss(i,"w",e.target.value); recalcFB(nl);
                                  }} className="w-14 border border-orange-200 rounded px-2 py-1 text-xs text-center" placeholder="ft" />
                                  <span className="text-xs text-gray-500">= <strong>{sqft>0?sqft+" sqft":"—"}</strong></span>
                                  <span className="text-xs text-gray-300">→</span>
                                  <span className={"text-xs font-bold px-2 py-0.5 rounded-full "+(sqft>0?"bg-orange-100 text-orange-700":"text-gray-400")}>{sqft>0?perTruss.qty+" FB (top)":"—"}</span>
                                </>}
                                {type!=="full_box" && <span className="text-xs text-gray-400 italic">no top — RFT only</span>}
                                <button onClick={()=>{const nl=removeTruss(i);recalcFB(nl);}}
                                  className="text-red-400 hover:text-red-600 text-xs ml-auto">✕</button>
                              </div>
                              {/* Side wall checkboxes */}
                              {(l>0||type==="full_box") && (
                                <div className="flex items-center gap-3 ml-1 flex-wrap">
                                  <span className="text-xs text-gray-500">Walls masked:</span>
                                  {sideOpts.map(s=>(
                                    <label key={s.key} className={"flex items-center gap-1 text-xs cursor-pointer px-1.5 py-0.5 rounded "+(sides[s.key]?"bg-orange-100 text-orange-700 font-medium":"text-gray-400")}>
                                      <input type="checkbox" checked={!!sides[s.key]} onChange={()=>{const nl=toggleTrussSide(i,s.key);recalcFB(nl);}}
                                        className="w-3 h-3 accent-orange-600" />
                                      {s.label}
                                    </label>
                                  ))}
                                  {rowRft>0 && <span className="text-xs font-medium text-orange-600">= {rowRft} RFT ÷ {rftPerWorker} → {rowRftLab} FB</span>}
                                </div>
                              )}
                              {/* Per-row total */}
                              {rowTotal>0 && (
                                <div className="flex items-center justify-end gap-2 ml-1 pt-1 border-t border-orange-50">
                                  <span className="text-xs text-gray-500">Row total:</span>
                                  <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">{rowTotal} FB</span>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Legacy Single U-Truss RFT — kept for back-compat. Will auto-merge into a U Truss row.  */}
                        {(fnSingleURft>0) && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-3">
                            <span className="text-xs font-bold text-amber-800">⚠️ Legacy Single U-Truss RFT:</span>
                            <input type="number" min="0" value={fnSingleURft||""} onChange={e=>{
                              setFnSingleURft(parseInt(e.target.value)||0);
                              setTimeout(()=>recalcFB(fnTrussList),50);
                            }} className="w-20 border border-amber-200 rounded px-2 py-1 text-xs text-center font-bold" placeholder="RFT" />
                            <span className="text-xs text-gray-500">RFT</span>
                            {fnSingleURft>0&&<span className="text-xs text-amber-700">→ {Math.ceil(fnSingleURft/rftPerWorker)} FB (counted)</span>}
                            <button onClick={()=>{
                              // Migrate to a real U Truss row
                              const newList=[...fnTrussList,{label:"U Truss (migrated)",type:"u_only",l:fnSingleURft,w:"",sides:{back:true}}];
                              setFnTrussList(newList);
                              setFnSingleURft(0);
                              setTimeout(()=>recalcFB(newList),50);
                            }} className="ml-auto text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded">Migrate to row</button>
                          </div>
                        )}

                        {/* Total summary */}
                        {total>0&&(
                          <div className="bg-white border-2 border-orange-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <p className="text-xs text-gray-600">📐 Per-row independent ceil (§23 Phase 2.8):</p>
                                {breakdown.filter(b=>b.rowTotal>0).map((b,bi)=>(
                                  <p key={bi} className="text-xs text-gray-600 pl-3">
                                    • {b.label} ({b.type==="full_box"?"Full Box":b.type==="half_box"?"Half Box":"U Truss"})
                                    {b.labour>0 ? ` — top ${b.sqft} sqft → ${b.labour}` : ""}
                                    {b.sideRft>0 ? ` + RFT ${b.partsLabel} = ${b.sideRft} → ${b.rftLabour}` : ""}
                                    {" "}<strong className="text-orange-700">= {b.rowTotal}</strong>
                                  </p>
                                ))}
                              </div>
                              <div className="text-right">
                                <p className="text-2xl font-bold text-orange-700">{total}</p>
                                <p className="text-xs text-orange-600">Total Fabric Bangali</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Range reference strip */}
                        <div className="flex flex-wrap gap-1.5">
                          {(settings.fabricBangaliRanges||[]).map((r,ri)=>{
                            const prevMax=ri>0?(settings.fabricBangaliRanges[ri-1].upTo+1):1;
                            return (
                              <span key={ri} className="text-xs px-2 py-0.5 rounded-full border bg-white text-gray-500 border-gray-200">
                                {prevMax}–{r.upTo>9000?"∞":r.upTo} sqft → {r.labour}
                              </span>
                            );
                          })}
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-200">
                            RFT: {rftPerWorker} RFT = 1 FB
                          </span>
                        </div>
                      </div>
                      );
                    })()}
                    {/* Shifts */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-gray-500">Shifts ({h.toFixed(1)}h → {dihari===rate?"1×":dihari===rate*1.5?"1.5× OT":"2× DBL OT"})</p>
                        <button onClick={()=>{setEditType(c.type);setSlotModal(true);}} className="text-xs text-indigo-500 hover:text-indigo-700">+ Add Shift</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.slots.map((s,si)=>(
                          <span key={si} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-lg border border-indigo-100">
                            {(settings.shifts||[]).find(sh=>sh.label===s.label)?.emoji||"⏰"} {s.label} ({s.start}–{s.end})
                            <button onClick={()=>removeSlot(c.type,si)} className="text-indigo-400 hover:text-red-500 ml-0.5">×</button>
                          </span>
                        ))}
                        {c.slots.length===0&&<span className="text-xs text-gray-400 italic">No shifts assigned</span>}
                      </div>
                    </div>
                    <Field label="Remark">
                      <Input value={c.remark} onChange={e=>updateCrew(c.type,"remark",e.target.value)} placeholder="Notes..." />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add crew button */}
          {!isLocked&&availTypes.length>0&&(
            <div className="flex flex-wrap gap-2">
              {availTypes.map(t=>{
                const tier=((settings.labourTiers||{})[t]||{}).tier||1;
                return (
                  <button key={t} onClick={()=>addCrew(t)}
                    className="text-xs bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 px-3 py-2 rounded-lg transition-all">
                    + {t} <span className="opacity-50 ml-1">{TIER_LABELS[tier]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Phase cost */}
          {crew.length>0&&(
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-bold text-indigo-800">{selPhase==="setup"?"Setup":selPhase==="event"?"Event":"Dismantle"} Phase Cost</span>
              <span className="text-lg font-bold text-indigo-700">{fmt(calcPhaseCost(currentPhase))}</span>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TIMELINE VIEW                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {viewMode==="timeline"&&(
        <div className="bg-white border rounded-2xl p-4 overflow-x-auto">
          <p className="text-sm font-bold text-gray-800 mb-3">📊 Timeline — {selPhase==="setup"?"Setup":selPhase==="event"?"Event":"Dismantle"}</p>
          <div className="relative" style={{minWidth:"700px"}}>
            {/* Hour markers */}
            <div className="flex border-b border-gray-200 pb-1 mb-2">
              <div className="w-28 flex-shrink-0"></div>
              {HOURS.map(h=><div key={h} className="flex-1 text-center text-xs text-gray-400">{h>12?h-12+"p":h+"a"}</div>)}
            </div>
            {/* Bars */}
            {crew.map((c,ci)=>(
              <div key={c.type} className="flex items-center mb-1.5">
                <div className="w-28 flex-shrink-0 text-xs font-medium text-gray-700 truncate pr-2">{c.type} ×{c.qty}</div>
                <div className="flex-1 relative h-6 bg-gray-50 rounded">
                  {c.slots.map((s,si)=>{
                    const [sh,sm]=(s.start||"00:00").split(":").map(Number);
                    const [eh,em]=(s.end||"00:00").split(":").map(Number);
                    let startMins=sh*60+sm-240; if(startMins<0) startMins+=1440;
                    let endMins=eh*60+em-240; if(endMins<0) endMins+=1440; if(endMins<=startMins) endMins+=1440;
                    const leftPct=(startMins/(20*60))*100;
                    const widthPct=((endMins-startMins)/(20*60))*100;
                    return <div key={si} className={`absolute top-0 h-full rounded ${BAR_COLORS[ci%BAR_COLORS.length]} opacity-80`}
                      style={{left:leftPct+"%",width:Math.min(widthPct,100-leftPct)+"%"}}
                      title={`${s.label}: ${s.start}–${s.end}`}>
                      <span className="text-white text-xs px-1 truncate block leading-6">{s.label}</span>
                    </div>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ACTIVITY LOG VIEW                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {viewMode==="log"&&(
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">📝 Supervisor Activity Log</p>
            <Btn onClick={()=>setLogModal(true)} size="sm" color="gray">+ Log Entry</Btn>
          </div>
          {(fn.manpowerActivityLog||[]).length===0?(
            <div className="text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">📝</p>
              <p>No activity logged yet. Supervisor logs changes as they happen on-site.</p>
            </div>
          ):(
            <div className="space-y-1.5">
              {(fn.manpowerActivityLog||[]).map((log,i)=>{
                const actionColors={arrived:"green",sent_back:"red",added:"blue",released:"amber"};
                const actionIcons={arrived:"✅",sent_back:"↩️",added:"➕",released:"🏁"};
                const actionLabels={arrived:"Arrived",sent_back:"Sent Back",added:"Added",released:"Released"};
                return (
                  <div key={i} className="bg-white border rounded-lg px-4 py-2.5 flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500 w-14">{log.time}</span>
                    <Badge color={actionColors[log.action]||"gray"}>{actionIcons[log.action]} {actionLabels[log.action]}</Badge>
                    <span className="text-sm font-medium text-gray-800">{log.type} ×{log.qty}</span>
                    {log.adhoc&&<Badge color="amber">Ad-hoc</Badge>}
                    {log.note&&<span className="text-xs text-gray-500 ml-auto">{log.note}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Planned vs Actual Summary */}
          {(fn.manpowerActivityLog||[]).length>0&&(
            <div className="bg-gray-50 border rounded-xl p-4">
              <p className="text-sm font-bold text-gray-800 mb-2">📊 Planned vs Actual</p>
              <div className="space-y-1">
                {crew.map(c=>{
                  const arrived=(fn.manpowerActivityLog||[]).filter(l=>l.type===c.type&&l.action==="arrived").reduce((s,l)=>s+l.qty,0);
                  const sentBack=(fn.manpowerActivityLog||[]).filter(l=>l.type===c.type&&l.action==="sent_back").reduce((s,l)=>s+l.qty,0);
                  const added=(fn.manpowerActivityLog||[]).filter(l=>l.type===c.type&&l.action==="added").reduce((s,l)=>s+l.qty,0);
                  const actual=arrived-sentBack+added;
                  const diff=actual-c.qty;
                  return (
                    <div key={c.type} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{c.type}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-500">Planned: {c.qty}</span>
                        <span className="font-medium text-gray-800">Actual: {actual}</span>
                        {diff!==0&&<span className={"text-xs font-bold "+(diff>0?"text-blue-600":"text-red-600")}>{diff>0?"+":""}{diff}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Slot Picker Modal ── */}
      <Modal open={slotModal} onClose={()=>setSlotModal(false)} title="Add Shift">
        <div className="space-y-2">
          {(settings.shifts||[]).map(s=>(
            <button key={s.id} onClick={()=>{ if(editType) addSlot(editType,{label:s.label,start:s.start,end:s.end}); setSlotModal(false); }}
              className="w-full text-left px-4 py-3 rounded-lg border hover:bg-indigo-50 hover:border-indigo-300 transition-all flex items-center gap-3">
              <span className="text-xl">{s.emoji}</span>
              <div><p className="font-medium text-sm text-gray-900">{s.label}</p><p className="text-xs text-gray-500">{s.start} – {s.end}</p></div>
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Activity Log Modal ── */}
      <Modal open={logModal} onClose={()=>setLogModal(false)} title="📝 Log Supervisor Activity">
        <div className="space-y-3">
          <Field label="Action">
            <Sel value={logEntry.action} onChange={e=>setLogEntry({...logEntry,action:e.target.value})}>
              <option value="arrived">✅ Arrived (crew showed up)</option>
              <option value="sent_back">↩️ Sent Back (reducing crew)</option>
              <option value="added">➕ Added (extra crew on-site)</option>
              <option value="released">🏁 Released (work done, crew leaving)</option>
            </Sel>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Sel value={logEntry.type} onChange={e=>setLogEntry({...logEntry,type:e.target.value})}>
                {MANPOWER_TYPES.filter(t=>t!=="Drivers").map(t=><option key={t}>{t}</option>)}
              </Sel>
            </Field>
            <Field label="Qty">
              <Input type="number" min="1" value={logEntry.qty} onChange={e=>setLogEntry({...logEntry,qty:parseInt(e.target.value)||1})} />
            </Field>
          </div>
          <Field label="Note (optional)">
            <Input value={logEntry.note} onChange={e=>setLogEntry({...logEntry,note:e.target.value})} placeholder="e.g. Setup smaller than expected" />
          </Field>
          <Btn onClick={addLogEntry} className="w-full">Log Entry</Btn>
        </div>
      </Modal>
    </div>
  );
}

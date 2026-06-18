// ═══════════════════════════════════════════════════════════════
// DEAL CHECK FULL-PAGE OVERLAY — structural shell (Studio slice).
// VERBATIM port of the reference overlay frame, tab nav, shared cost
// rollup, sidebar, bottom strip, and the GYV + Inventory Status tab
// bodies. The 7 large sub-tabs (inventory / truss / florals / manpower /
// production / buying / transport) are placeholders pending later slices.
// ═══════════════════════════════════════════════════════════════
export default function DealCheckOverlay({ ctx }) {
  const {
    // chrome / theme
    border, textS, textP, accent, fmt,
    // client + auth
    clientLedger, activeClientId, clientName, clientDate, authUser,
    // deal check state
    dcRunCounter, dcActiveTab, setDcActiveTab, dcCache, setDcCache, dcGenerating, dcGenStatus,
    dcCards, dcInventoryCache, dcCarpetPick, dcCustomItems, setDcCustomItems, elSelectedPhoto, dcDedupOverrides, setDcDedupOverrides,
    dcDesiredMargin, setDcDesiredMargin, dcSavingDraft, setDcSavingDraft, setDcFullPageOpen,
    dcZoneState, dcKitEdits, dcMpOverrides, dcMpIncludeMinusOne, dcMpIncludeDismantle,
    setDcResolved, setDcCards, setDcZoneState, setDcPhotoOverrides, setDcSkipped, setDcManualItems, setDcProductionAccepted,
    dealCheckData, imsPaletteCatalogue, softHolds,
    // build / fn state
    activeFnIdx, switchActiveFn,
    // pricing helpers
    collectAllFunctionData, calcFnFloralSourcingCost, calcFunctionBreakdown, calcFunctionCost,
    calcZoneTrussPreview, calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan, imsField,
    libItems, rcItems,
    // orchestration + persistence
    openDealCheck, runDealCheckGenerate, getStudioAvailable, getActiveSoftHold, reliableSave, DC_CACHE_SK,
    // misc
    showMsg, saveClientLedger,
  } = ctx;

  if (!(authUser && true)) return null;

  return (() => {
        const cli = clientLedger.find(c => c.id === activeClientId);
        const isSold = cli?.status === "booked";
        const counter = dcRunCounter[activeClientId] || { preSold: 0, postSold: 0, isSold: false };
        const usedNow = isSold ? counter.postSold : counter.preSold;
        const counterLabel = isSold ? `Post-SOLD runs: ${usedNow}/2` : `Pre-SOLD runs: ${usedNow}/2`;
        const counterColor = usedNow >= 2 ? "#EF4444" : usedNow >= 1 ? "#F59E0B" : "#10B981";
        // Tab definitions — only Inventory/Florals/Transport are functional in Deploy 1
        const TABS = [
          { id: "inventory", label: "Inventory",        icon: "📦", live: true  },
          { id: "truss",     label: "Truss",            icon: "🏗️", live: true  },
          { id: "florals",   label: "Florals",          icon: "🌸", live: true  },
          { id: "manpower",  label: "Manpower",         icon: "👷", live: true  },
          { id: "production",label: "Production",       icon: "🏭", live: true  },
          { id: "buying",    label: "Buying",           icon: "🛒", live: true  },
          { id: "transport", label: "Transport",        icon: "🚚", live: true  },
          { id: "status",    label: "Inventory Status", icon: "📊", live: true  },
          { id: "gyv",       label: "GYV & Buffer",     icon: "💰", live: true  },
        ];
        const activeTabDef = TABS.find(t => t.id === dcActiveTab) || TABS[0];

        // ═══ Shared cost rollup — single computation used by GYV tab + bottom strip (§26.19) ═══
        const dcCostRollup = (() => {
          const fns = collectAllFunctionData ? collectAllFunctionData() : [];
          let rental = 0, florals = 0, transport = 0, manpower = 0, truss = 0;
          fns.forEach((fn, fi) => {
            const cards = dcCards[fi] || {};
            Object.entries(cards).forEach(([ck, c]) => {
              if (!c.imsId) return;
              const item = dcInventoryCache.find(x => x.id === c.imsId);
              if (!item) return;
              rental += imsField.rentalCost(item) * (c.qty || 1);
            });
            try { florals += calcFnFloralSourcingCost(fn).grandTotal; } catch {}
            try { const bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; if (bd && bd.transportTotal) transport += bd.transportTotal; } catch {}
            try {
              const tInv = dealCheckData?.trussInv;
              if (tInv) {
                const zc = fn.zoneConfig || {};
                const en = fn.enabledEls || {};
                const fnPalette = fn.fnPalette || "Custom";
                const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                const anchors = pObj?.anchorColours || [];
                Object.keys(zc).forEach(zk => {
                  if (!en[zk] || !zc[zk]) return;
                  const pv = calcZoneTrussPreview(zc[zk], tInv);
                  if (pv?.costs?.actual) truss += pv.costs.actual;
                  const photoUrl = (fn.elSelectedPhoto || {})[zk];
                  let density = "moderate";
                  if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                  truss += calcZoneFabricCost(zc[zk], tInv, anchors, density);
                });
              }
            } catch {}
          });
          // Platform + carpet → rental
          try {
            const pp = buildPlatformPlan(fns, dealCheckData);
            if (pp) {
              const fattaR = pp.fattaItem ? imsField.rentalCost(pp.fattaItem) : 0;
              const standR = pp.standItem ? imsField.rentalCost(pp.standItem) : 0;
              Object.values(pp.perZone || {}).forEach(z => { rental += (z.fattas || 0) * fattaR + (z.stands || 0) * standR; });
            }
          } catch {}
          try {
            const carpetMarkup = dealCheckData?.carpetFreshMarkup ?? 40;
            fns.forEach((fn, fi) => {
              const zc = fn.zoneConfig || {};
              const en = fn.enabledEls || {};
              const picks = dcCarpetPick[fi] || {};
              Object.keys(zc).forEach(zk => {
                if (!en[zk] || !zc[zk] || !zc[zk].cpT) return;
                const pickedId = picks[zk];
                if (!pickedId) return;
                const carpetItem = dcInventoryCache.find(x => x.id === pickedId);
                if (!carpetItem) return;
                rental += calcZoneCarpet(zc[zk], carpetItem, carpetMarkup).cost;
              });
            });
          } catch {}
          // Manpower — full booking-level day-wise computation (mirrors Manpower tab)
          try {
            const dihariSchemes = dealCheckData?.dihariSchemes || {};
            const defaultWindowsByPhase = dealCheckData?.defaultWindowsByPhase || {};
            const labourTiers = dealCheckData?.labourTiers || {};
            const venueMinLabour = dealCheckData?.venueMinLabour || {};
            const defaultMinLabour = dealCheckData?.defaultMinLabour || 4;
            const eventTypeMultipliers = dealCheckData?.eventTypeMultipliers || { outdoor_budgeted:1.0 };
            const eventTimingMultipliers = dealCheckData?.eventTimingMultipliers || {};
            const sayaMultiplier = dealCheckData?.sayaMultiplier || 1.3;
            const heavyElementRanges = dealCheckData?.heavyElementRanges || [];
            const fabricBangaliRanges = dealCheckData?.fabricBangaliRanges || [];
            const trussLabourRanges = dealCheckData?.trussLabourRanges || [];
            const flowerPatternsMP = dealCheckData?.flowerPatterns || [];
            const electricianProdMP = dealCheckData?.electricianProductivity || {};
            const seasonMapMP = dealCheckData?.seasonMap || {};
            const recipeSubsMP = (dealCheckData?.flowerRecipeSubcats || ["Flower Pattern"]).map(s => String(s||"").toLowerCase().trim());
            const labourTypes = Object.keys(dihariSchemes);
            if (labourTypes.length && fns.length) {
              const vendorsMP = (dealCheckData?.vendors || []).filter(v => v && v.active && v.type);
              const rateByType = {};
              labourTypes.forEach(t => { const vs = vendorsMP.filter(v => v.type === t); rateByType[t] = vs.length > 0 ? vs.reduce((s,v)=>s+(v.avgRate||v.dayRate||0),0)/vs.length : (dihariSchemes[t]?.rate || 0); });
              const shiftToTiming = (s) => { const sl = String(s||"").toLowerCase(); if (sl.includes("morning")) return "morning"; if (sl.includes("evening")||sl.includes("night")) return "evening"; return "day"; };
              const sizeFromMode = (mode, sz) => { if (mode === "flat" || !sz) return "medium"; return String(sz).toLowerCase() || "medium"; };
              const walkFn = (fn, cb) => {
                const en = fn.enabledEls || {};
                const ze = fn.zoneElements || {};
                Object.keys(en).forEach(zk => { if (!en[zk]) return; (ze[zk]||[]).forEach(el => {
                  const rc = rcItems.find(r => String(r.name||"").toLowerCase() === String(el.name||"").toLowerCase());
                  if (rc) cb({ rc, el, qty: Number(el.qty || el.count || 1), zk });
                }); });
              };
              const calcPpl = (fn, type) => {
                if (type === "Flowerists") {
                  let t = 0;
                  walkFn(fn, ({rc, el, qty}) => {
                    if (String(rc.cat||"").toLowerCase() !== "florals") return;
                    if (!recipeSubsMP.includes(String(rc.sub||"").toLowerCase().trim())) return;
                    const pattern = flowerPatternsMP.find(p => { const n = String(p?.name||"").toLowerCase().trim(); const rn = String(rc.name||"").toLowerCase().trim(); return n && rn && (n === rn || n.includes(rn) || rn.includes(n)); });
                    if (!pattern) return;
                    const sz = pattern.sizes || {};
                    const sk = sizeFromMode(rc.inhouseMode, el.size);
                    let c = sz[sk] || sz.medium; if (!c && sk === "big" && sz.large) c = sz.large;
                    const upf = Number(c?.unitsPerFlowerist || 0); if (upf > 0) t += Math.ceil(qty / upf);
                  }); return t;
                }
                if (type === "Electricians") {
                  let t = 0; walkFn(fn, ({rc, el, qty}) => {
                    if (String(rc.cat||"").toLowerCase() !== "lighting") return;
                    const pr = electricianProdMP[rc.sub||""]; if (!pr) return;
                    const sk = sizeFromMode(rc.inhouseMode, el.size);
                    const upe = Number(pr.sizes?.[sk]) || Number(pr.sizes?.medium) || 0;
                    if (upe > 0) t += Math.ceil(qty / upe);
                  }); return t;
                }
                if (type === "Labours") {
                  const venueName = fn.fnVenue || ""; const vc = venueMinLabour[venueName];
                  const vm = (vc && typeof vc === "object" ? vc.min : (typeof vc === "number" ? vc : null)) || defaultMinLabour;
                  const dl = (vc && typeof vc === "object" ? vc.dumpingLevel : null) || "nearby";
                  const dm = ({nearby:1.0, medium:1.1, far:1.2})[dl] || 1.0;
                  const em = eventTypeMultipliers["outdoor_budgeted"] || 1;
                  const base = Math.ceil(vm * em);
                  const dp = dcMpIncludeMinusOne;
                  let sm = 1.0;
                  if (!dp) { const c = [dm]; const ss = seasonMapMP[fn.fnDate||""]; if (ss === "kings") c.push(sayaMultiplier); c.push(eventTimingMultipliers[shiftToTiming(fn.fnShift)] || 1.0); sm = Math.max(...c, 1.0); }
                  const adj = Math.ceil(base * sm);
                  let he = 0; const sc = {}; walkFn(fn, ({rc, qty}) => { sc[rc.sub||""] = (sc[rc.sub||""]||0) + qty; });
                  heavyElementRanges.forEach(her => { const cnt = sc[her.subCat]||0; if (cnt > 0) for (const r of (her.ranges||[])) { if (cnt <= r.upTo) { he += r.extra; break; } } });
                  return adj + he;
                }
                if (type === "Fabric Bangali") {
                  let sq = 0; walkFn(fn, ({rc, el}) => { const s = String(rc.sub||"").toLowerCase(); if (s.includes("wall masking")||s.includes("fabric")||s.includes("draping")) { const L = Number(el.L||el.l||rc.defaultDims?.L||0); const W = Number(el.W||el.w||el.H||el.h||rc.defaultDims?.W||0); if (L>0 && W>0) sq += L*W; } });
                  if (sq <= 0 || fabricBangaliRanges.length === 0) return 0;
                  for (const r of fabricBangaliRanges) { if (sq <= r.upTo) return r.labour || 0; }
                  return fabricBangaliRanges[fabricBangaliRanges.length-1]?.labour || 0;
                }
                if (type === "Truss Labour") {
                  let p = 0; walkFn(fn, ({rc, qty}) => { const s = String(rc.sub||"").toLowerCase(); if (s.includes("pillar")||s.includes("column")||s.includes("truss")) p += qty; });
                  if (p <= 0 || trussLabourRanges.length === 0) return 0;
                  for (const r of trussLabourRanges) { if (p <= r.upTo) return r.labour || 0; }
                  return trussLabourRanges[trussLabourRanges.length-1]?.labour || 0;
                }
                const cfg = labourTiers[type];
                if (cfg && cfg.tier === 2) {
                  const batches = cfg.subCatBatches || {}; const sc = {};
                  walkFn(fn, ({rc, qty}) => { if (batches[rc.sub||""]) sc[rc.sub||""] = (sc[rc.sub||""]||0) + qty; });
                  let t = 0; Object.entries(sc).forEach(([k,v]) => { const b = batches[k] || 3; t += Math.ceil(v/b); });
                  return Math.max(cfg.minimum || 1, t);
                }
                if (type === "Supervisors") return 1;
                return 0;
              };
              const fnDates = fns.map(f => f.fnDate).filter(Boolean).sort();
              if (fnDates.length) {
                const addDays = (iso, n) => { const d = new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
                const earliest = fnDates[0]; const latest = fnDates[fnDates.length-1];
                const dayList = [];
                if (dcMpIncludeMinusOne) dayList.push({date:addDays(earliest,-1),phase:"minusOne",fns:[]});
                let cur = earliest;
                while (cur <= latest) { const fd = fns.filter(f => f.fnDate === cur); dayList.push({date:cur,phase:fd.length?"event":"gap",fns:fd}); cur = addDays(cur,1); }
                if (dcMpIncludeDismantle) dayList.push({date:addDays(latest,1),phase:"dismantle",fns:[]});
                const peopleByFn = {}; labourTypes.forEach(t => { peopleByFn[t] = {}; fns.forEach((fn, fi) => { peopleByFn[t][fi] = calcPpl(fn, t) || 0; }); });
                let running = {}; labourTypes.forEach(t => { running[t] = 0; });
                dayList.forEach(d => {
                  if (d.phase === "minusOne") { labourTypes.forEach(t => { let mx = 0; fns.forEach((fn, fi) => { if ((peopleByFn[t][fi]||0) > mx) mx = peopleByFn[t][fi]; }); running[t] = Math.max(running[t], mx); }); }
                  else if (d.phase === "event") { labourTypes.forEach(t => { let need = 0; d.fns.forEach(fn => { const fi = fns.indexOf(fn); if ((peopleByFn[t][fi]||0) > need) need = peopleByFn[t][fi]; }); running[t] = Math.max(running[t], need); }); }
                  labourTypes.forEach(t => {
                    const ppl = running[t] || 0; if (ppl <= 0) return;
                    const wins = dcMpOverrides[`${d.date}|${t}`] || (defaultWindowsByPhase[t]||{})[d.phase] || [];
                    manpower += ppl * wins.length * (rateByType[t] || 0);
                  });
                });
              }
            }
          } catch {}
          const buyTotal = dcCustomItems.filter(c=>c.type==="buying").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          const produceTotal = dcCustomItems.filter(c=>c.type==="production").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          const base = rental + florals + transport + manpower + truss + buyTotal + produceTotal;
          const gyvFixed = Math.round(base * 0.05);
          const bufferCost = Math.round(base * 0.03);
          const grand = base + gyvFixed + bufferCost;
          let clientRevenue = 0;
          try { fns.forEach(fn => { clientRevenue += calcFunctionCost(fn).grand; }); } catch {}
          const profitPct = clientRevenue > 0 ? Math.round(((clientRevenue - grand) / clientRevenue) * 100) : 0;
          return { rental, florals, transport, manpower, truss, buyTotal, produceTotal, base, gyvFixed, bufferCost, grand, clientRevenue, profitPct, fns };
        })();

        return (
          <div style={{position:"fixed",inset:0,zIndex:9000,background:"#0A0A14",display:"flex",flexDirection:"column"}}>
            {/* TOP BAR */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",borderBottom:`1px solid ${border}`,background:"#0F0F1A"}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <button onClick={()=>setDcFullPageOpen(false)} title="Close Deal Check" style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:14,cursor:"pointer",lineHeight:1}}>✕</button>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#fff",letterSpacing:0.2}}>Deal Check</div>
                  <div style={{fontSize:10,color:textS,letterSpacing:1.2,textTransform:"uppercase",marginTop:2}}>{cli?.name || clientName || "(no client)"}{isSold?" · BOOKED":""}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {/* Tier 2.2 (25 May 2026) — cache indicator + regenerate button. */}
                {/* Shows "💾 Cached <relative-time>" subtle pill when current view is from cache. */}
                {/* Regenerate wipes dcCache[clientId] and reruns openDealCheck + runDealCheckGenerate. */}
                {activeClientId && dcCache[activeClientId]?.cachedAt && !dcGenerating && (() => {
                  const cachedAt = new Date(dcCache[activeClientId].cachedAt);
                  const minsAgo = Math.round((Date.now() - cachedAt.getTime()) / 60000);
                  const relTime = minsAgo < 1 ? "just now" : minsAgo < 60 ? `${minsAgo} min ago` : minsAgo < 1440 ? `${Math.round(minsAgo/60)}h ago` : `${Math.round(minsAgo/1440)}d ago`;
                  return (
                    <div title={`Last AI run: ${cachedAt.toLocaleString("en-IN")}`} style={{padding:"5px 10px",borderRadius:6,background:"rgba(16,185,129,0.10)",border:"1px solid rgba(16,185,129,0.30)",fontSize:10,color:"#10B981",fontWeight:600,letterSpacing:0.4}}>
                      💾 Cached · {relTime}
                    </div>
                  );
                })()}
                {activeClientId && (
                  <button
                    onClick={async () => {
                      if (!window.confirm("Regenerate Deal Check?\n\nThis will:\n• Wipe cached AI photo matches for this client\n• Run AI again (may cost ~₹5–20 in API calls)\n• Overwrite any manual sales tweaks (skips, overrides, manual items)\n\nContinue?")) return;
                      // Wipe this client's cache slot
                      setDcCache(prev => {
                        const next = { ...prev };
                        delete next[activeClientId];
                        reliableSave(DC_CACHE_SK, JSON.stringify(next), "Deal Check cache (wipe)").catch(() => {});
                        return next;
                      });
                      // Reset all DC state shapes so openDealCheck starts cleanly
                      setDcResolved({});
                      setDcCards({});
                      setDcZoneState({});
                      setDcPhotoOverrides({});
                      setDcSkipped({});
                      setDcManualItems([]);
                      setDcDedupOverrides({});
                      setDcProductionAccepted({});
                      // Re-fetch IMS + rerun AI matching loop fresh
                      await openDealCheck();
                      // Also rerun Generate (subcat-scoped matcher) for the active function
                      try { await runDealCheckGenerate(); } catch {}
                    }}
                    disabled={dcGenerating}
                    title="Wipe cache & rerun AI photo matching. Costs API credits."
                    style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${dcGenerating?border:"rgba(251,191,36,0.50)"}`,background:dcGenerating?"transparent":"rgba(251,191,36,0.10)",color:dcGenerating?textS:"#FBBF24",fontSize:10,cursor:dcGenerating?"not-allowed":"pointer",fontWeight:600,letterSpacing:0.4,whiteSpace:"nowrap"}}>
                    ↻ Regenerate
                  </button>
                )}
                <div style={{padding:"5px 10px",borderRadius:6,background:"rgba(255,255,255,0.04)",fontSize:10,color:counterColor,fontWeight:600,letterSpacing:0.4}}>{counterLabel}</div>
                {dcGenerating && <div style={{fontSize:10,color:accent,fontWeight:600}}>{dcGenStatus || "Working…"}</div>}
              </div>
            </div>
            {/* TAB STRIP */}
            <div style={{display:"flex",gap:2,padding:"8px 14px 0 14px",background:"#0F0F1A",borderBottom:`1px solid ${border}`,overflowX:"auto"}}>
              {TABS.map(t => (
                <button key={t.id} onClick={()=>setDcActiveTab(t.id)} style={{padding:"9px 14px",borderRadius:"8px 8px 0 0",border:"none",cursor:"pointer",fontSize:11,fontWeight:dcActiveTab===t.id?700:500,background:dcActiveTab===t.id?"#0A0A14":"transparent",color:dcActiveTab===t.id?"#fff":textS,whiteSpace:"nowrap",letterSpacing:0.2,position:"relative"}}>
                  <span style={{marginRight:5}}>{t.icon}</span>{t.label}
                  {!t.live && <span style={{marginLeft:6,fontSize:8,padding:"2px 5px",borderRadius:4,background:"rgba(245,158,11,0.18)",color:"#F59E0B",fontWeight:700,letterSpacing:0.4}}>{t.ship}</span>}
                </button>
              ))}
            </div>
            {/* BODY (3-column layout: left sidebar · main content · bottom strip is global) */}
            <div style={{flex:1,display:"flex",overflow:"hidden"}}>
              {/* LEFT SIDEBAR — function tabs + per-fn cost (skeletal in Patch 3, populated in Patch 5) */}
              <div style={{width:220,borderRight:`1px solid ${border}`,padding:"14px 12px",overflowY:"auto",background:"#0F0F1A"}}>
                <div style={{fontSize:9,color:textS,letterSpacing:1.4,textTransform:"uppercase",marginBottom:10,fontWeight:700}}>Functions</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {(() => {
                    const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                    if (fns.length === 0) return <div style={{padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${border}`,fontSize:11,color:textS,fontStyle:"italic"}}>No functions yet</div>;
                    return fns.map((fn, fi) => {
                      // Per-fn decor cost (rental + floral) — spec §7.9.3
                      const cards = dcCards[fi] || {};
                      let fnDecor = 0;
                      Object.values(cards).forEach(c => {
                        if (!c?.imsId) return;
                        const item = dcInventoryCache.find(x => x.id === c.imsId);
                        if (!item) return;
                        fnDecor += imsField.rentalCost(item) * (c.qty || 1);
                      });
                      const isActive = fi === activeFnIdx;
                      return (
                        <button key={fi} onClick={()=>switchActiveFn(fi)} style={{padding:"10px 11px",borderRadius:8,border:isActive?`1px solid ${accent}`:`1px solid ${border}`,background:isActive?`${accent}18`:"rgba(255,255,255,0.02)",cursor:isActive?"default":"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:3}}>
                          <div style={{fontSize:11,fontWeight:700,color:isActive?accent:"#fff",letterSpacing:0.2}}>{fn?.fnType || `Function ${fi+1}`}</div>
                          <div style={{fontSize:9,color:textS,letterSpacing:0.4}}>{fn?.fnDate || "—"}{fn?.fnShift?` · ${fn.fnShift}`:""}</div>
                          <div style={{fontSize:11,fontWeight:600,color:fnDecor>0?"#fff":textS,marginTop:2}}>{fnDecor>0?`₹${Math.round(fnDecor).toLocaleString("en-IN")}`:"—"}</div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
              {/* MAIN CONTENT */}
              <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
                {!activeTabDef.live ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    <div style={{fontSize:42,marginBottom:14}}>{activeTabDef.icon}</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>{activeTabDef.label}</div>
                    <div style={{fontSize:12,marginBottom:4}}>Coming in {activeTabDef.ship}</div>
                    <div style={{fontSize:10,opacity:0.6}}>Spec: §7.9.{activeTabDef.id==="manpower"?"13":activeTabDef.id==="production"?"14":activeTabDef.id==="buying"?"15":"2.A + 7.9.18 + 7.9.19"}</div>
                  </div>
                ) : dcActiveTab === "inventory" ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    {/* TODO slice: DealCheck inventory */}
                    <div style={{fontSize:42,marginBottom:14}}>📦</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>Inventory</div>
                    <div style={{fontSize:12}}>This tab is being rebuilt in a later Studio slice.</div>
                  </div>
                ) : dcActiveTab === "florals" ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    {/* TODO slice: DealCheck florals */}
                    <div style={{fontSize:42,marginBottom:14}}>🌸</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>Florals</div>
                    <div style={{fontSize:12}}>This tab is being rebuilt in a later Studio slice.</div>
                  </div>
                ) : dcActiveTab === "manpower" ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    {/* TODO slice: DealCheck manpower */}
                    <div style={{fontSize:42,marginBottom:14}}>👷</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>Manpower</div>
                    <div style={{fontSize:12}}>This tab is being rebuilt in a later Studio slice.</div>
                  </div>
                ) : dcActiveTab === "truss" ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    {/* TODO slice: DealCheck truss */}
                    <div style={{fontSize:42,marginBottom:14}}>🏗️</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>Truss</div>
                    <div style={{fontSize:12}}>This tab is being rebuilt in a later Studio slice.</div>
                  </div>
                ) : dcActiveTab === "transport" ? (() => {
                  // ═══ TRANSPORT TAB BODY (Patch 5) — per-function transport from existing calcFunctionBreakdown ═══
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No functions configured yet.</div>;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {fns.map((fn, fi) => {
                        let bd = null; try { bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; } catch { /* ignore */ }
                        const t = bd?.transportTotal || 0;
                        return (
                          <div key={fi} style={{padding:"11px 14px",borderRadius:9,background:"rgba(56,189,248,0.04)",border:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:"#fff"}}>🚚 {fn?.fnType || `Function ${fi+1}`}</div>
                              <div style={{fontSize:10,color:textS,marginTop:2}}>{fn?.fnDate || "—"} · {fn?.fnVenue || "—"} · {fn?.fnShift || "—"}{bd?.transport?.trucks?` · ${bd.transport.trucks.length} truck${bd.transport.trucks.length===1?"":"s"}`:""}</div>
                            </div>
                            <div style={{fontSize:14,fontWeight:800,color:"#fff",whiteSpace:"nowrap"}}>{t>0?`₹${Math.round(t).toLocaleString("en-IN")}`:"—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : (dcActiveTab === "production" || dcActiveTab === "buying") ? (() => {
                  const fnIdx = activeFnIdx || 0;
                  const isP = dcActiveTab === "production";
                  const items = dcCustomItems.filter(c => c.fnIdx === fnIdx && c.type === dcActiveTab);
                  const total = items.reduce((s, c) => s + (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1), 0);
                  const ciColor = isP ? "#A855F7" : "#F59E0B";
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:11,color:textS}}>Function {fnIdx+1} · {items.length} {dcActiveTab} item{items.length===1?"":"s"}</div>
                        <div style={{fontSize:13,fontWeight:700,color:ciColor}}>₹{Math.round(total).toLocaleString("en-IN")}</div>
                      </div>
                      {items.length === 0 ? (
                        <div style={{padding:"40px 20px",textAlign:"center",color:textS,fontSize:11,borderRadius:10,border:`1px dashed ${border}`}}>
                          No {dcActiveTab} items yet. Add them from the 🏭/🛒 icons in zone headers on the Build screen.
                        </div>
                      ) : items.map(ci => {
                        const unitCost = ci.manualPrice || ci.refPrice || 0;
                        const refItem = ci.refItemId ? (dcInventoryCache || []).find(x => x.id === ci.refItemId) : null;
                        const refPhoto = refItem ? imsField.photos(refItem)[0] : null;
                        const zonePhoto = elSelectedPhoto[ci.zoneKey]?.src || null;
                        const photo = ci.photo || zonePhoto || refPhoto || null;
                        return (
                          <div key={ci.id} style={{padding:"12px 14px",borderRadius:10,border:`1px solid ${ciColor}30`,background:`${ciColor}06`,display:"flex",gap:10,alignItems:"center"}}>
                            {photo ? <img src={photo} alt="" style={{width:48,height:48,borderRadius:8,objectFit:"cover"}} /> : <div style={{width:48,height:48,borderRadius:8,background:`${ciColor}12`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{isP?"🏭":"🛒"}</div>}
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,fontWeight:600,color:textP}}>{ci.cat ? `${ci.cat} → ` : ""}{ci.subCat}</div>
                              <div style={{fontSize:10,color:textS,marginTop:2}}>× {ci.qty}{ci.dims?.l?` · ${ci.dims.l}L × ${ci.dims.w}W × ${ci.dims.h}H ft`:""}{ci.notes?` · ${ci.notes}`:""}</div>
                              <div style={{fontSize:9,color:textS,marginTop:1}}>Zone: {ci.zoneKey}{refItem?` · Ref: ${refItem.name}`:""}</div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:700,color:ciColor}}>₹{Math.round(unitCost * (Number(ci.qty)||1)).toLocaleString("en-IN")}</div>
                              <div style={{fontSize:9,color:textS}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {ci.qty}</div>
                            </div>
                            <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))} style={{padding:"4px 8px",borderRadius:4,border:"none",background:"rgba(239,68,68,0.12)",color:"#EF4444",fontSize:11,cursor:"pointer",fontWeight:700}}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : dcActiveTab === "status" ? (() => {
                  // ═══ INVENTORY STATUS TAB — Deploy 3 · §7.9.2.A + §7.9.18 + §7.9.19 ═══
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No functions configured yet.</div>;
                  const blocksByDate = dealCheckData?.blocksByDate || {};
                  const nowMs = Date.now();

                  // ── §7.9.18 Calendar Conflicts ──
                  // Scan all fns/cards: detect items where needed > available or held by another salesperson
                  const conflicts = [];
                  const conflictSeen = new Set();
                  fns.forEach((fn, fi) => {
                    const fnDate = fn.fnDate || clientDate;
                    const fnBlocks = blocksByDate[fnDate] || {};
                    const cards = dcCards[fi] || {};
                    Object.entries(cards).forEach(([ck, card]) => {
                      if (!card.imsId) return;
                      const item = dcInventoryCache.find(x => x.id === card.imsId);
                      if (!item) return;
                      const cardQty = Number(card.qty) || 1;
                      const available = getStudioAvailable(item, fnBlocks);
                      const hold = getActiveSoftHold(softHolds, card.imsId, authUser?.name, nowMs);
                      const isShort = cardQty > available;
                      const isHeld = !!hold;
                      if (!isShort && !isHeld) return;
                      const dedup = `${card.imsId}::${fnDate}`;
                      if (conflictSeen.has(dedup)) return;
                      conflictSeen.add(dedup);
                      const photo = imsField.photos(item)[0];
                      conflicts.push({ imsId: card.imsId, name: card.imsName || item.name, photo, needed: cardQty, available, isShort, hold, isHeld, fnDate, fnLabel: fn.fnType || `Function ${fi+1}`, item });
                    });
                  });

                  // ── §7.9.19 Cross-Function Reuse ──
                  // Find items appearing in 2+ functions (by imsId)
                  const itemFnMap = {};  // { imsId: { name, photo, rental, fns: Set<fnIdx>, totalQty } }
                  fns.forEach((fn, fi) => {
                    const cards = dcCards[fi] || {};
                    Object.values(cards).forEach(card => {
                      if (!card.imsId) return;
                      if (!itemFnMap[card.imsId]) {
                        const item = dcInventoryCache.find(x => x.id === card.imsId);
                        const rental = item ? imsField.rentalCost(item) : 0;
                        const photo = item ? imsField.photos(item)[0] : null;
                        itemFnMap[card.imsId] = { name: card.imsName || item?.name || "?", photo, rental, fns: new Set(), totalQty: 0, fnLabels: {} };
                      }
                      const m = itemFnMap[card.imsId];
                      m.fns.add(fi);
                      m.totalQty += (Number(card.qty) || 1);
                      m.fnLabels[fi] = fns[fi]?.fnType || `Fn ${fi+1}`;
                    });
                  });
                  const reuseItems = Object.entries(itemFnMap)
                    .filter(([_, m]) => m.fns.size >= 2)
                    .map(([imsId, m]) => {
                      const isSeparate = dcDedupOverrides[imsId] === "separate";
                      const saving = isSeparate ? 0 : m.rental * m.totalQty * (m.fns.size - 1) / m.fns.size;
                      return { imsId, ...m, fnCount: m.fns.size, saving, isSeparate, fnNames: [...m.fns].map(fi => m.fnLabels[fi]).join(", ") };
                    });
                  const totalSaving = reuseItems.reduce((s, r) => s + r.saving, 0);

                  const conflictCount = conflicts.length;
                  const reuseCount = reuseItems.length;

                  if (conflictCount === 0 && reuseCount === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center"}}>
                      <div style={{fontSize:28,marginBottom:10}}>✅</div>
                      <div style={{fontSize:14,fontWeight:600,color:"#10B981"}}>Inventory clean</div>
                      <div style={{fontSize:11,color:textS,marginTop:4}}>No calendar conflicts and no cross-function reuse opportunities.</div>
                    </div>;
                  }

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:16,padding:"0 4px"}}>
                      {/* ── ⚠ Calendar Conflicts section ── */}
                      {conflictCount > 0 && (
                        <div style={{borderRadius:10,border:"1px solid rgba(239,68,68,0.25)",overflow:"hidden"}}>
                          <div style={{padding:"10px 14px",background:"rgba(239,68,68,0.06)",display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:14}}>⚠</span>
                            <span style={{fontSize:12,fontWeight:700,color:"#EF4444"}}>Calendar Conflicts ({conflictCount} item{conflictCount===1?"":"s"})</span>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:1}}>
                            {conflicts.map((c, ci) => (
                              <div key={ci} style={{padding:"10px 14px",display:"flex",gap:10,alignItems:"center",background:ci%2===0?"rgba(255,255,255,0.015)":"transparent"}}>
                                {c.photo ? <img src={c.photo} alt="" style={{width:40,height:40,borderRadius:6,objectFit:"cover",flexShrink:0}}/> : <div style={{width:40,height:40,borderRadius:6,background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>📦</div>}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>{c.name}</div>
                                  <div style={{fontSize:10,color:textS,marginTop:2}}>
                                    {c.fnLabel} · {c.fnDate}
                                    {c.isShort && <span style={{color:"#EF4444",marginLeft:8,fontWeight:600}}>⚠ need {c.needed}, only {c.available} free</span>}
                                  </div>
                                  {c.isHeld && (
                                    <div style={{fontSize:10,color:"#F59E0B",marginTop:2}}>
                                      ⏳ Held by <strong>{c.hold.salesperson}</strong> for {c.hold.eventName}
                                      {c.hold.expiry && <span style={{opacity:0.8}}> · expires {new Date(c.hold.expiry).toLocaleString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}</span>}
                                    </div>
                                  )}
                                </div>
                                <div style={{display:"flex",gap:4,flexShrink:0}}>
                                  <span style={{fontSize:9,padding:"3px 8px",borderRadius:5,background:c.isShort?"rgba(239,68,68,0.15)":"rgba(245,158,11,0.15)",color:c.isShort?"#EF4444":"#F59E0B",fontWeight:700}}>{c.isShort?"⚠ SHORT":"⏳ HELD"}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── ♻ Cross-Function Reuse section ── */}
                      {reuseCount > 0 && (
                        <div style={{borderRadius:10,border:"1px solid rgba(16,185,129,0.25)",overflow:"hidden"}}>
                          <div style={{padding:"10px 14px",background:"rgba(16,185,129,0.06)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:14}}>♻️</span>
                              <span style={{fontSize:12,fontWeight:700,color:"#10B981"}}>Cross-Function Reuse ({reuseCount} item{reuseCount===1?"":"s"})</span>
                            </div>
                            {totalSaving > 0 && <span style={{fontSize:11,fontWeight:700,color:"#10B981"}}>Saving ₹{Math.round(totalSaving).toLocaleString("en-IN")}</span>}
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:1}}>
                            {reuseItems.map((r, ri) => (
                              <div key={ri} style={{padding:"10px 14px",display:"flex",gap:10,alignItems:"center",background:ri%2===0?"rgba(255,255,255,0.015)":"transparent"}}>
                                {r.photo ? <img src={r.photo} alt="" style={{width:40,height:40,borderRadius:6,objectFit:"cover",flexShrink:0}}/> : <div style={{width:40,height:40,borderRadius:6,background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>📦</div>}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>{r.name} ×{r.totalQty}</div>
                                  <div style={{fontSize:10,color:textS,marginTop:2}}>♻ {r.fnNames}</div>
                                  {r.saving > 0 && !r.isSeparate && <div style={{fontSize:10,color:"#10B981",marginTop:1}}>Saved ₹{Math.round(r.saving).toLocaleString("en-IN")} by sharing across {r.fnCount} functions</div>}
                                  {r.isSeparate && <div style={{fontSize:10,color:"#F59E0B",marginTop:1}}>Blocked separately — no sharing savings</div>}
                                </div>
                                <button onClick={()=>setDcDedupOverrides(prev=>({...prev,[r.imsId]: prev[r.imsId]==="separate"?undefined:"separate"}))} style={{fontSize:9,padding:"4px 8px",borderRadius:6,cursor:"pointer",border:`1px solid ${r.isSeparate?"rgba(245,158,11,0.4)":"rgba(16,185,129,0.4)"}`,background:r.isSeparate?"rgba(245,158,11,0.08)":"rgba(16,185,129,0.08)",color:r.isSeparate?"#F59E0B":"#10B981",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>
                                  {r.isSeparate?"♻ Share":"✂ Separate"}
                                </button>
                              </div>
                            ))}
                          </div>
                          {totalSaving > 0 && (
                            <div style={{padding:"10px 14px",borderTop:"1px solid rgba(16,185,129,0.15)",display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700}}>
                              <span style={{color:textS}}>Total reuse savings</span>
                              <span style={{color:"#10B981"}}>₹{Math.round(totalSaving).toLocaleString("en-IN")}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })() : dcActiveTab === "gyv" ? (() => {
                  // ═══ GYV FIXED & BUFFER COST TAB — reads from shared dcCostRollup ═══
                  const { rental, florals, transport, manpower, truss, buyTotal, produceTotal, base: baseCost, gyvFixed: gyvCost, bufferCost, grand: grandWithOverheads, clientRevenue, fns } = dcCostRollup;
                  const fmt = (n) => n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "₹0";
                  const gyvPct = 5;
                  const bufferPct = 3;

                  const rows = [
                    { label: "📦 Rental",    value: rental },
                    { label: "🏗️ Truss",     value: truss },
                    { label: "🌸 Florals",   value: florals },
                    { label: "🚚 Transport", value: transport },
                    { label: "👷 Manpower",  value: manpower },
                    { label: "🛒 Buying",    value: buyTotal },
                    { label: "🏭 Production",value: produceTotal },
                  ];

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:16,padding:"0 4px"}}>
                      {/* Base cost summary */}
                      <div style={{borderRadius:10,border:`1px solid ${border}`,overflow:"hidden"}}>
                        <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",fontSize:11,fontWeight:700,color:"#fff",letterSpacing:0.4,textTransform:"uppercase"}}>💰 Project Cost Breakdown</div>
                        <div style={{display:"flex",flexDirection:"column"}}>
                          {rows.map((r, i) => (
                            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 14px",borderTop:`1px solid ${border}22`,fontSize:11}}>
                              <span style={{color:textS}}>{r.label}</span>
                              <span style={{color:"#fff",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{fmt(r.value)}</span>
                            </div>
                          ))}
                          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",borderTop:`1px solid ${border}`,fontSize:12,fontWeight:700}}>
                            <span style={{color:textS}}>Base Cost</span>
                            <span style={{color:"#fff"}}>{fmt(baseCost)}</span>
                          </div>
                        </div>
                      </div>

                      {/* GYV & Buffer */}
                      <div style={{borderRadius:10,border:"1px solid rgba(99,102,241,0.25)",overflow:"hidden"}}>
                        <div style={{padding:"10px 14px",background:"rgba(99,102,241,0.06)",fontSize:11,fontWeight:700,color:accent,letterSpacing:0.4,textTransform:"uppercase"}}>🏢 GYV Fixed & Buffer</div>
                        <div style={{display:"flex",flexDirection:"column"}}>
                          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",borderTop:`1px solid ${border}22`,fontSize:12}}>
                            <span style={{color:textS}}>GYV Fixed Cost <span style={{fontSize:10,opacity:0.7}}>({gyvPct}% of base)</span></span>
                            <span style={{color:"#A78BFA",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(gyvCost)}</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",borderTop:`1px solid ${border}22`,fontSize:12}}>
                            <span style={{color:textS}}>Buffer Cost <span style={{fontSize:10,opacity:0.7}}>({bufferPct}% of base)</span></span>
                            <span style={{color:"#F59E0B",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(bufferCost)}</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px",borderTop:`1px solid ${border}`,fontSize:14,fontWeight:800}}>
                            <span style={{color:"#fff"}}>Project Total (incl. GYV + Buffer)</span>
                            <span style={{color:"#10B981"}}>{fmt(grandWithOverheads)}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{fontSize:10,color:textS,fontStyle:"italic",padding:"0 4px"}}>
                        GYV fixed ({gyvPct}%) and buffer ({bufferPct}%) are applied on the base cost and added to the project total in the bottom strip.
                      </div>

                      {/* Net Profit / Margin */}
                      {(()=>{
                        let clientRevenue = 0;
                        try { fns.forEach(fn => { clientRevenue += calcFunctionCost(fn).grand; }); } catch {}
                        const netProfit = clientRevenue - grandWithOverheads;
                        const profitPct = clientRevenue > 0 ? Math.round((netProfit / clientRevenue) * 100) : 0;
                        const maxDiscountPct = clientRevenue > 0 ? Math.round((netProfit / clientRevenue) * 100) : 0;
                        const profitColor = profitPct >= 20 ? "#10B981" : profitPct >= 10 ? "#F59E0B" : "#EF4444";
                        const profitLabel = profitPct >= 20 ? "Healthy" : profitPct >= 10 ? "Moderate" : profitPct >= 0 ? "Low" : "Loss";
                        return (
                          <div style={{borderRadius:10,border:`1px solid ${profitColor}40`,overflow:"hidden"}}>
                            <div style={{padding:"10px 14px",background:`${profitColor}0D`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                              <span style={{fontSize:11,fontWeight:700,color:profitColor,letterSpacing:0.4,textTransform:"uppercase"}}>📊 Net Profitability</span>
                              <span style={{fontSize:12,padding:"3px 10px",borderRadius:6,background:`${profitColor}20`,color:profitColor,fontWeight:800}}>{profitLabel} · {profitPct}%</span>
                            </div>
                            <div style={{display:"flex",flexDirection:"column"}}>
                              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",borderTop:`1px solid ${border}22`,fontSize:12}}>
                                <span style={{color:textS}}>Client Quote <span style={{fontSize:10,opacity:0.7}}>(from Build screen)</span></span>
                                <span style={{color:"#fff",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(clientRevenue)}</span>
                              </div>
                              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",borderTop:`1px solid ${border}22`,fontSize:12}}>
                                <span style={{color:textS}}>Internal Cost <span style={{fontSize:10,opacity:0.7}}>(incl. GYV + Buffer)</span></span>
                                <span style={{color:"#EF4444",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(grandWithOverheads)}</span>
                              </div>
                              <div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px",borderTop:`1px solid ${border}`,fontSize:14,fontWeight:800}}>
                                <span style={{color:"#fff"}}>Net Profit</span>
                                <span style={{color:profitColor}}>{netProfit >= 0 ? "" : "−"}{fmt(Math.abs(netProfit))}</span>
                              </div>
                              {/* Profit bar visual */}
                              <div style={{padding:"10px 14px",borderTop:`1px solid ${border}22`}}>
                                <div style={{height:8,borderRadius:4,background:`${border}33`,overflow:"hidden",position:"relative"}}>
                                  <div style={{height:"100%",borderRadius:4,background:profitColor,width:`${Math.min(100,Math.max(0,profitPct))}%`,transition:"width 0.3s"}}/>
                                </div>
                                <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:10,color:textS}}>
                                  <span>Max discount salesperson can offer: <strong style={{color:profitColor}}>{maxDiscountPct}%</strong></span>
                                  <span>Margin: <strong style={{color:profitColor}}>{profitPct}%</strong></span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ═══ Smart Quote Calculator — salesperson adjusts margin to get revised quote ═══ */}
                      {(()=>{
                        const internalCost = grandWithOverheads;
                        const origQuote = clientRevenue;
                        const origProfitPct = origQuote > 0 ? Math.round(((origQuote - internalCost) / origQuote) * 100) : 0;
                        const desiredPct = dcDesiredMargin !== null ? dcDesiredMargin : origProfitPct;
                        const revisedQuote = desiredPct < 100 ? Math.round(internalCost / (1 - desiredPct / 100)) : internalCost;
                        const discount = origQuote - revisedQuote;
                        const discountPct = origQuote > 0 ? Math.round((discount / origQuote) * 100) : 0;
                        const revisedColor = desiredPct >= 20 ? "#10B981" : desiredPct >= 10 ? "#F59E0B" : desiredPct >= 0 ? "#EF4444" : "#EF4444";
                        const presets = [5, 10, 15, 20, 25, 30];
                        return (
                          <div style={{borderRadius:10,border:"1px solid rgba(99,102,241,0.25)",overflow:"hidden"}}>
                            <div style={{padding:"10px 14px",background:"rgba(99,102,241,0.06)",display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:14}}>🧮</span>
                              <span style={{fontSize:11,fontWeight:700,color:accent,letterSpacing:0.4,textTransform:"uppercase"}}>Smart Quote Calculator</span>
                            </div>
                            <div style={{padding:"14px"}}>
                              <div style={{fontSize:11,color:textS,marginBottom:10}}>Adjust your desired profit margin — see the revised quote to give the client:</div>
                              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                                {presets.map(p => (
                                  <button key={p} onClick={()=>setDcDesiredMargin(p)} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${desiredPct===p?accent:border}`,background:desiredPct===p?"rgba(99,102,241,0.15)":"transparent",color:desiredPct===p?"#fff":textS,fontSize:11,fontWeight:desiredPct===p?700:500,cursor:"pointer"}}>{p}%</button>
                                ))}
                                {dcDesiredMargin !== null && (
                                  <button onClick={()=>setDcDesiredMargin(null)} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,cursor:"pointer"}}>Reset to actual</button>
                                )}
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                                <span style={{fontSize:10,color:textS,whiteSpace:"nowrap"}}>Margin</span>
                                <input type="range" min={0} max={Math.min(origProfitPct + 5, 60)} value={desiredPct} onChange={e=>setDcDesiredMargin(Number(e.target.value))} style={{flex:1,accentColor:revisedColor}} />
                                <span style={{fontSize:14,fontWeight:800,color:revisedColor,minWidth:40,textAlign:"right"}}>{desiredPct}%</span>
                              </div>
                              <div style={{borderRadius:8,border:`1px solid ${revisedColor}33`,overflow:"hidden"}}>
                                <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",background:`${revisedColor}08`,fontSize:11}}>
                                  <span style={{color:textS}}>Internal Cost (fixed)</span>
                                  <span style={{color:"#fff",fontWeight:600}}>₹{Math.round(internalCost).toLocaleString("en-IN")}</span>
                                </div>
                                <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",borderTop:`1px solid ${border}22`,fontSize:11}}>
                                  <span style={{color:textS}}>Original Quote</span>
                                  <span style={{color:"#fff",fontWeight:600}}>₹{Math.round(origQuote).toLocaleString("en-IN")}</span>
                                </div>
                                <div style={{display:"flex",justifyContent:"space-between",padding:"12px",borderTop:`1px solid ${border}`,fontSize:14,fontWeight:800}}>
                                  <span style={{color:"#fff"}}>Revised Quote at {desiredPct}% margin</span>
                                  <span style={{color:revisedColor}}>₹{Math.round(revisedQuote).toLocaleString("en-IN")}</span>
                                </div>
                                {discount !== 0 && (
                                  <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",borderTop:`1px solid ${border}22`,fontSize:10}}>
                                    <span style={{color:textS}}>{discount > 0 ? "Discount from original" : "Increase from original"}</span>
                                    <span style={{color:discount>0?"#F59E0B":"#10B981",fontWeight:700}}>
                                      {discount > 0 ? "−" : "+"}₹{Math.abs(discount).toLocaleString("en-IN")} ({Math.abs(discountPct)}%)
                                    </span>
                                  </div>
                                )}
                              </div>
                              {desiredPct < 5 && <div style={{marginTop:8,fontSize:10,color:"#EF4444",fontWeight:600}}>⚠ Very low margin — this deal may not cover operational risks.</div>}
                              {desiredPct < 0 && <div style={{marginTop:4,fontSize:10,color:"#EF4444",fontWeight:600}}>🚨 Loss-making deal — quote is below internal cost.</div>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })() : null}
              </div>
            </div>
            {/* BOTTOM STRIP — Project total + 6 sub-cost chips + Save Draft (Patch 5: live numbers wired) */}
            {(() => {
              // ═══ Reads from shared dcCostRollup (§26.19) ═══
              const { rental, florals, transport, manpower, truss, buyTotal, produceTotal, base: total, gyvFixed, bufferCost, grand: grandWithOverheads, clientRevenue: stripRevenue, profitPct: stripProfitPct } = dcCostRollup;
              const stripProfitColor = stripProfitPct >= 20 ? "#10B981" : stripProfitPct >= 10 ? "#F59E0B" : "#EF4444";
              const fmt = (n) => n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "—";
              const onSaveDraft = async () => {
                if (dcSavingDraft) return;
                setDcSavingDraft(true);
                try {
                  // Persist dcCards + dcZoneState + manpower overrides onto active client record · saved via existing client ledger flow
                  const ledger = clientLedger.map(c => c.id !== activeClientId ? c : ({ ...c, dcCards: dcCards, dcZoneState: dcZoneState, dcKitEdits: dcKitEdits, dcCarpetPick: dcCarpetPick, dcMpOverrides: dcMpOverrides, dcMpIncludeMinusOne: dcMpIncludeMinusOne, dcMpIncludeDismantle: dcMpIncludeDismantle, dcDraftSavedAt: Date.now(), dcDraftSavedBy: authUser?.name || "—" }));
                  await saveClientLedger(ledger);
                  showMsg("✓ Deal Check draft saved", "green");
                } catch (e) { showMsg("⚠ Save failed — try again", "red"); }
                finally { setDcSavingDraft(false); }
              };
              const chips = [
                { id:"rental",   label:"Rental",   icon:"📦", value: fmt(rental),    live: true  },
                { id:"truss",    label:"Truss",    icon:"🏗️", value: fmt(truss),     live: true  },
                { id:"florals",  label:"Florals",  icon:"🌸", value: fmt(florals),   live: true  },
                { id:"transport",label:"Transport",icon:"🚚", value: fmt(transport), live: true  },
                { id:"manpower", label:"Manpower", icon:"👷", value: fmt(manpower),  live: true  },
                { id:"buy",      label:"Buy",      icon:"🛒", value: fmt(dcCustomItems.filter(c=>c.type==="buying").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0)),  live: true },
                { id:"produce",  label:"Produce",  icon:"🏭", value: fmt(dcCustomItems.filter(c=>c.type==="production").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0)), live: true },
                { id:"gyv",      label:"GYV 5%",   icon:"🏢", value: fmt(gyvFixed),  live: true  },
                { id:"buffer",   label:"Buffer 3%",icon:"🛡️", value: fmt(bufferCost),live: true  },
              ];
              return (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 18px",borderTop:`1px solid ${border}`,background:"#0F0F1A",gap:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                    <div><div style={{fontSize:9,color:textS,letterSpacing:1.2,textTransform:"uppercase",fontWeight:700}}>Project total</div><div style={{fontSize:18,fontWeight:800,color:"#fff",letterSpacing:0.3}}>{fmt(grandWithOverheads)}</div>{stripRevenue > 0 && <div style={{fontSize:9,color:stripProfitColor,fontWeight:700,marginTop:1}}>Margin {stripProfitPct}% · {fmt(stripRevenue)} quote</div>}</div>
                    <div style={{height:30,width:1,background:border}}/>
                    {chips.map(c => (
                      <div key={c.id} style={{padding:"6px 10px",borderRadius:8,background:"rgba(255,255,255,0.04)",fontSize:10,color:textS,minWidth:70,opacity:c.live?1:0.5}}>
                        <div style={{fontSize:9,opacity:0.7,letterSpacing:1,textTransform:"uppercase",fontWeight:600}}>{c.icon} {c.label}{!c.live&&<span style={{marginLeft:4,fontSize:7,opacity:0.7}}>D2</span>}</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#fff",marginTop:1}}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={onSaveDraft} disabled={dcSavingDraft} style={{padding:"10px 18px",borderRadius:10,border:"none",background:dcSavingDraft?"rgba(255,255,255,0.06)":`linear-gradient(135deg,${accent},#8B7355)`,color:dcSavingDraft?textS:"#0F0F1A",fontSize:12,fontWeight:700,cursor:dcSavingDraft?"default":"pointer",letterSpacing:0.4,whiteSpace:"nowrap"}}>{dcSavingDraft?"Saving…":"💾 Save Draft"}</button>
                </div>
              );
            })()}
          </div>
        );
      })();
}

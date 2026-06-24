// ═══════════════════════════════════════════════════════════════
// DEAL CHECK FULL-PAGE OVERLAY — structural shell (Studio slice).
// VERBATIM port of the reference overlay frame, tab nav, shared cost
// rollup, sidebar, bottom strip, and the GYV + Inventory Status tab
// bodies. The 7 large sub-tabs (inventory / truss / florals / manpower /
// production / buying / transport) are placeholders pending later slices.
// ═══════════════════════════════════════════════════════════════
import { useState } from "react";
import DCFloralsTab from "./tabs/DCFloralsTab.jsx";
import DCManpowerTab from "./tabs/DCManpowerTab.jsx";
import DCTrussTab from "./tabs/DCTrussTab.jsx";
import AmendRequestPanel from "./AmendRequestPanel.jsx";
import { heavyExtraLabour, eventTimingMultFor } from "../../../lib/ims/constants";
import { rentalSplit, availableAtVenue, isStandingAt } from "../../../lib/ims/fixedVenues";

export default function DealCheckOverlay({ ctx }) {
  const [dcDept, setDcDept] = useState("Furniture"); // active Department-Income sub-tab
  const {
    // chrome / theme
    border, textS, textP, accent, fmt,
    // client + auth
    clientLedger, activeClientId, clientName, clientDate, authUser,
    // deal check state
    dcRunCounter, dcActiveTab, setDcActiveTab, dcCache, setDcCache, dcGenerating, dcGenStatus,
    dcCards, dcInventoryCache, dcCarpetPick, setDcCarpetPick, dcCarpetSearch, setDcCarpetSearch,
    dcKitEdits, setDcKitEdits, dcManualItems, setDcManualItems, dcManualSearch, setDcManualSearch,
    dcCollapsedZones, setDcCollapsedZones, setDcBrowseAllOpen, dcBrowseAllOpen, setDcCustomModal,
    dcCustomItems, setDcCustomItems, elSelectedPhoto, dcDedupOverrides, setDcDedupOverrides,
    dcDesiredMargin, setDcDesiredMargin, dcSavingDraft, setDcSavingDraft, setDcFullPageOpen,
    dcZoneState, dcMpOverrides, dcMpIncludeMinusOne, dcMpIncludeDismantle,
    setDcResolved, setDcCards, setDcZoneState, setDcPhotoOverrides, setDcSkipped, setDcProductionAccepted,
    dealCheckData, imsPaletteCatalogue, softHolds,
    // build / fn state
    activeFnIdx, switchActiveFn,
    // pricing helpers
    collectAllFunctionData, calcFnFloralSourcingCost, calcFunctionBreakdown, calcFunctionCost,
    calcZoneTrussPreview, calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan, imsField,
    libItems, rcItems, normalizePaintAllocation,
    // deal check inventory-tab module helpers
    isZoneDirty, parseCardKey, PLATFORM_FATTA_CODE, PLATFORM_STAND_CODE,
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
          { id: "depts",     label: "Dept Income",      icon: "🏦", live: true  },
        ];
        const activeTabDef = TABS.find(t => t.id === dcActiveTab) || TABS[0];

        // ═══ Shared cost rollup — single computation used by GYV tab + bottom strip (§26.19) ═══
        const dcCostRollup = (() => {
          const fns = collectAllFunctionData ? collectAllFunctionData() : [];
          let rental = 0, florals = 0, transport = 0, manpower = 0, truss = 0;
          // ═══ §Department income (7 depts) — every rupee tagged to a department ═══
          const DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"];
          const dept = {}; DEPTS.forEach(d => { dept[d] = { rental: 0, florals: 0, truss: 0, fabric: 0, transport: 0, manpower: 0, production: 0, buying: 0, total: 0 }; });
          const mpByType = {}; // manpower cost per labour type (distributed to depts at the end)
          const addD = (d, key, amt) => { if (!d || !dept[d] || !amt || !(amt > 0)) return; dept[d][key] += amt; };
          // Category (rate-card OR inventory) → department, by keyword. Sub-cat already implies its category.
          const catToDept = (cat) => {
            const s = String(cat || "").toLowerCase();
            if (!s) return "Structure";
            if (s.includes("floral") || s.includes("flower")) return "Floral";
            if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting";
            if (s.includes("truss")) return "Tenting";
            if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric";
            if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting";
            if (s.includes("transport") || s.includes("truck") || s.includes("logistic")) return "Transport";
            if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture";
            if (s.includes("arch") || s.includes("prop") || s.includes("wrought") || s.includes("glass") || s.includes("struct") || s.includes("pillar") || s.includes("stage") || s.includes("platform")) return "Structure";
            return "Structure"; // catch-all
          };
          fns.forEach((fn, fi) => {
            const cards = dcCards[fi] || {};
            Object.entries(cards).forEach(([ck, c]) => {
              if (!c.imsId) return;
              const item = dcInventoryCache.find(x => x.id === c.imsId);
              if (!item) return;
              // Fixed-venue rental discount: standing units (already installed here) bill at a
              // discount; fresh units / other venues / swapped designs bill full rate-card.
              const baseR = imsField.rentalCost(item);
              const qty = c.qty || 1;
              const venueName = fn.fnVenue || fn.venue || "";
              const sp = rentalSplit({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, venueName, c.imsId, qty);
              const lineRental = sp.freshUnits * baseR + sp.standingUnits * baseR * (1 - (sp.discountPct || 0) / 100);
              rental += lineRental;
              addD(catToDept(imsField.category(item) || c.cat), "rental", lineRental);
            });
            try { const fl = calcFnFloralSourcingCost(fn).grandTotal; florals += fl; addD("Floral", "florals", fl); } catch {}
            try { const bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; if (bd && bd.transportTotal) { transport += bd.transportTotal; addD("Transport", "transport", bd.transportTotal); } if (bd && bd.gensetTotal) { addD("Lighting", "rental", bd.gensetTotal); } } catch {}
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
                  if (pv?.costs?.actual) { truss += pv.costs.actual; addD("Tenting", "truss", pv.costs.actual); } // truss steel → Tenting
                  const photoUrl = (fn.elSelectedPhoto || {})[zk];
                  let density = "moderate";
                  if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                  const fabCost = calcZoneFabricCost(zc[zk], tInv, anchors, density);
                  truss += fabCost; addD("Fabric", "fabric", fabCost); // truss/masking fabric → Fabric
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
              Object.values(pp.perZone || {}).forEach(z => { const pc = (z.fattas || 0) * fattaR + (z.stands || 0) * standR; rental += pc; addD("Tenting", "rental", pc); }); // platform → Tenting
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
                { const cc = calcZoneCarpet(zc[zk], carpetItem, carpetMarkup).cost; rental += cc; addD("Tenting", "rental", cc); } // carpet → Tenting
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
                  if (!dp) { const c = [dm]; const ss = seasonMapMP[fn.fnDate||""]; if (ss === "kings") c.push(sayaMultiplier); c.push(eventTimingMultFor(eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0)); sm = Math.max(...c, 1.0); }
                  const adj = Math.ceil(base * sm);
                  let he = 0; const sc = {}; walkFn(fn, ({rc, qty}) => { sc[rc.sub||""] = (sc[rc.sub||""]||0) + qty; });
                  heavyElementRanges.forEach(her => { he += heavyExtraLabour(her, sc[her.subCat]||0); });
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
                    const mpCost = ppl * wins.length * (rateByType[t] || 0);
                    manpower += mpCost;
                    mpByType[t] = (mpByType[t] || 0) + mpCost;
                  });
                });
              }
            }
          } catch {}
          const buyTotal = dcCustomItems.filter(c=>c.type==="buying").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          const produceTotal = dcCustomItems.filter(c=>c.type==="production").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          // Production / Buying → department by the item's category/sub-category
          dcCustomItems.forEach(c => { const amt = (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1); if (amt > 0) addD(catToDept(c.cat || c.subCat), c.type === "buying" ? "buying" : "production", amt); });
          // ── Distribute manpower per type to departments ──
          const MP_DEPT = { "Flowerists": "Floral", "Carpenters": "Structure", "Painters": "Tenting", "Truss Labour": "Tenting", "Fabric Bangali": "Fabric", "Electricians": "Lighting", "Drivers": "Transport" };
          // Direct-income share per dept (rental+florals+truss+fabric+production+buying) — drives the
          // proportional split of general Labours + Supervisors across all departments.
          const directOf = (d) => dept[d].rental + dept[d].florals + dept[d].truss + dept[d].fabric + dept[d].production + dept[d].buying;
          const directTotal = DEPTS.reduce((s, d) => s + directOf(d), 0);
          Object.entries(mpByType).forEach(([t, amt]) => {
            if (!(amt > 0)) return;
            const target = MP_DEPT[t];
            if (target) { addD(target, "manpower", amt); return; }
            // General Labours + Supervisors (and anything unmapped) → split by direct-income share
            if (directTotal > 0) DEPTS.forEach(d => addD(d, "manpower", amt * (directOf(d) / directTotal)));
            else addD("Structure", "manpower", amt);
          });
          DEPTS.forEach(d => { dept[d].total = dept[d].rental + dept[d].florals + dept[d].truss + dept[d].fabric + dept[d].transport + dept[d].manpower + dept[d].production + dept[d].buying; });
          const base = rental + florals + transport + manpower + truss + buyTotal + produceTotal;
          const gyvFixed = Math.round(base * 0.05);
          const bufferCost = Math.round(base * 0.03);
          const grand = base + gyvFixed + bufferCost;
          let clientRevenue = 0;
          try { fns.forEach(fn => { clientRevenue += calcFunctionCost(fn).grand; }); } catch {}
          const profitPct = clientRevenue > 0 ? Math.round(((clientRevenue - grand) / clientRevenue) * 100) : 0;
          return { rental, florals, transport, manpower, truss, buyTotal, produceTotal, base, gyvFixed, bufferCost, grand, clientRevenue, profitPct, fns, dept, DEPTS };
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
                {isSold && ctx.isLastMinute && ctx.isLastMinute((() => { const fns = collectAllFunctionData ? collectAllFunctionData() : []; return fns[activeFnIdx]?.fnDate || clientDate; })()) && (
                  <AmendRequestPanel ctx={ctx} fnIdx={activeFnIdx || 0} fnDate={(() => { const fns = collectAllFunctionData ? collectAllFunctionData() : []; return fns[activeFnIdx]?.fnDate || clientDate; })()} />
                )}
                {!activeTabDef.live ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:textS}}>
                    <div style={{fontSize:42,marginBottom:14}}>{activeTabDef.icon}</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:8}}>{activeTabDef.label}</div>
                    <div style={{fontSize:12,marginBottom:4}}>Coming in {activeTabDef.ship}</div>
                    <div style={{fontSize:10,opacity:0.6}}>Spec: §7.9.{activeTabDef.id==="manpower"?"13":activeTabDef.id==="production"?"14":activeTabDef.id==="buying"?"15":"2.A + 7.9.18 + 7.9.19"}</div>
                  </div>
                ) : dcActiveTab === "inventory" ? (() => {
                  // ═══ INVENTORY TAB BODY (Patch 4) — with Generate bar (Patch 6) ═══
                  const fnIdx = activeFnIdx || 0;
                  const cardsByKey = dcCards[fnIdx] || {};
                  const allCardKeys = Object.keys(cardsByKey);
                  const totalCards = allCardKeys.length;
                  const dealCheckInventory = (dealCheckData?.inventory?.length > 0)
                    ? dealCheckData.inventory
                    : (dcInventoryCache || []);
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  const platformPlan = buildPlatformPlan(fns, dealCheckData);
                  // §7.9.19 — Precompute reuse count per imsId for ♻ chip on cards
                  const reuseFnCount = {};
                  fns.forEach((_, fi) => { const cs = dcCards[fi] || {}; Object.values(cs).forEach(c => { if (c.imsId) { if (!reuseFnCount[c.imsId]) reuseFnCount[c.imsId] = new Set(); reuseFnCount[c.imsId].add(fi); } }); });
                  const fnBlocksForChip = (dealCheckData?.blocksByDate || {})[(fns[fnIdx]||{}).fnDate || clientDate] || {};
                  // Group by zoneKey
                  const byZone = {};
                  for (const k of allCardKeys) {
                    const c = cardsByKey[k]; if (!c) continue;
                    const zk = c.zoneKey || "(unzoned)";
                    if (!byZone[zk]) byZone[zk] = [];
                    byZone[zk].push({ ...c, _cardKey: k });
                  }
                  if (platformPlan) {
                    Object.keys(platformPlan.perZone).forEach(k => {
                      const [pfi, pzk] = k.split("|");
                      if (Number(pfi) === fnIdx && !byZone[pzk]) byZone[pzk] = [];
                    });
                  }
                  const activeFnForFlorals = fns[fnIdx];
                  const recipeSubcatsLC = (dealCheckData?.flowerRecipeSubcats || ["Flower Pattern"]).map(s => String(s||"").toLowerCase());
                  const flowerPatternsForCheck = dealCheckData?.flowerPatterns || [];
                  const findPatternByName = (name) => {
                    if (!name) return null;
                    const target = String(name).toLowerCase().trim();
                    if (!target) return null;
                    let p = flowerPatternsForCheck.find(x => String(x?.name||"").toLowerCase().trim() === target);
                    if (p) return p;
                    p = flowerPatternsForCheck.find(x => {
                      const n = String(x?.name||"").toLowerCase().trim();
                      return n && (n.includes(target) || target.includes(n));
                    });
                    return p || null;
                  };
                  const isRecipeDrivenFloral = (rcItem) => {
                    if (!rcItem) return false;
                    if (String(rcItem.cat||"").toLowerCase() !== "florals") return false;
                    if (recipeSubcatsLC.includes(String(rcItem.sub||"").toLowerCase())) return true;
                    return !!findPatternByName(rcItem.name);
                  };
                  const recipeFloralsByZone = {};
                  if (activeFnForFlorals?.zoneElements && activeFnForFlorals?.enabledEls) {
                    Object.entries(activeFnForFlorals.zoneElements).forEach(([zk, elems]) => {
                      if (!activeFnForFlorals.enabledEls[zk]) return;
                      const collected = [];
                      (elems || []).forEach(el => {
                        const rc = rcItems.find(i => i.name.toLowerCase().trim() === (el.name || "").toLowerCase().trim());
                        if (!isRecipeDrivenFloral(rc)) return;
                        collected.push({ name: el.name, qty: el.qty || 1, sub: rc.sub || "", size: el.size || "", unit: rc.unit || "pc" });
                      });
                      if (collected.length > 0) {
                        recipeFloralsByZone[zk] = collected;
                        if (!byZone[zk]) byZone[zk] = [];
                      }
                    });
                  }
                  const zoneList = Object.keys(byZone);
                  const autoCollapse = totalCards > 30;  // §7.9.2 — auto-collapse when > 30 cards
                  // ═══ Patch 6 — Generate bar computation (event-wide scope · sidebar wired) ═══
                  const activeFn = fns[fnIdx];
                  let dirtyCount = 0;
                  let totalEnabledZones = 0;
                  fns.forEach((f, fi) => {
                    if (!f?.enabledEls) return;
                    const enabledZoneKeys = Object.keys(f.enabledEls).filter(k => f.enabledEls[k]);
                    for (const zk of enabledZoneKeys) {
                      const zoneElems = f.zoneElements?.[zk] || [];
                      if (zoneElems.length === 0) continue;
                      totalEnabledZones += 1;
                      if (isZoneDirty(dcZoneState, dcCards, fi, zk)) dirtyCount += 1;
                    }
                  });
                  const cliCounter = dcRunCounter[activeClientId] || { preSold: 0, postSold: 0, isSold: false };
                  const cli = clientLedger.find(c => c.id === activeClientId);
                  const isSold = cli?.status === "booked";
                  const usedNow = isSold ? cliCounter.postSold : cliCounter.preSold;
                  const atLimit = false;  // TESTING — revert to `usedNow >= 2` after testing
                  const btnDisabled = atLimit || dcGenerating;
                  const fnCount = fns.length;
                  const btnLabel = dcGenerating
                    ? "Generating…"
                    : atLimit
                    ? (isSold ? "Post-SOLD limit reached (2/2)" : "Limit reached — mark SOLD to unlock")
                    : dirtyCount > 0
                    ? `🔄 Generate Deal Check (${dirtyCount} zone${dirtyCount===1?"":"s"} changed${fnCount>1?` across ${fnCount} fns`:""})`
                    : `🔄 Generate Deal Check (no changes — uses cache)`;
                  const onGenerate = () => {
                    if (btnDisabled) return;
                    runDealCheckGenerate();  // event-wide — processes ALL functions in one click (counter +1)
                  };
                  const genBar = (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",borderRadius:9,background:"rgba(201,169,110,0.06)",border:`1px solid ${border}`,marginBottom:14,gap:10,flexWrap:"wrap"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <div style={{fontSize:10,color:textS,letterSpacing:1.2,textTransform:"uppercase",fontWeight:700}}>Function {fnIdx+1}{activeFn?.fnType?` · ${activeFn.fnType}`:""}{activeFn?.fnDate?` · ${activeFn.fnDate}`:""}</div>
                        <div style={{fontSize:10,color:atLimit?"#EF4444":textS}}>{isSold?"Post-SOLD":"Pre-SOLD"} runs: {usedNow}/2 used{atLimit?(isSold?" · admin can unlock":" · mark SOLD to unlock 2 more"):""}</div>
                      </div>
                      <button onClick={onGenerate} disabled={btnDisabled} style={{padding:"10px 16px",borderRadius:9,border:"none",background:btnDisabled?"rgba(255,255,255,0.05)":`linear-gradient(135deg,${accent},#8B7355)`,color:btnDisabled?textS:"#0F0F1A",fontSize:12,fontWeight:700,cursor:btnDisabled?"default":"pointer",letterSpacing:0.3,whiteSpace:"nowrap"}}>{btnLabel}</button>
                    </div>
                  );
                  if (totalCards === 0) {
                    return (
                      <div>
                        {genBar}
                        <div style={{padding:"40px 30px",textAlign:"center",color:textS}}>
                          <div style={{fontSize:38,marginBottom:14}}>📦</div>
                          <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:6}}>No inventory matched yet</div>
                          <div style={{fontSize:11}}>Click <strong>Generate</strong> above to match Rate Card elements to IMS inventory.</div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      {genBar}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                        <div style={{fontSize:11,color:textS}}>{totalCards} card{totalCards===1?"":"s"} across {zoneList.length} zone{zoneList.length===1?"":"s"} · function {fnIdx + 1}</div>
                        <div style={{fontSize:9,color:textS,opacity:0.7,letterSpacing:1}}>{dirtyCount>0?`${dirtyCount} dirty`:`all clean`}</div>
                      </div>
                      {zoneList.map(zk => {
                        const collapseKey = `${fnIdx}|${zk}`;
                        const userOverride = dcCollapsedZones[collapseKey];
                        const collapsed = userOverride === undefined ? autoCollapse : userOverride;
                        const zoneCards = byZone[zk];
                        const matchedCount = zoneCards.filter(c => c.imsId).length;
                        const unmatchedCount = zoneCards.length - matchedCount;
                        const pi = platformPlan?.perZone?.[`${fnIdx}|${zk}`];
                        const hasPlatform = !!pi;
                        const platformShort = hasPlatform && (pi.freeAfterFatta < 0 || (pi.stands > 0 && pi.freeAfterStand < 0));
                        const recipeFlorals = recipeFloralsByZone[zk] || [];
                        const manualItemsInZone = dcManualItems.filter(mi => mi.fnIdx === fnIdx && mi.zoneKey === zk);
                        const totalRowCount = zoneCards.length + (hasPlatform ? 1 : 0) + recipeFlorals.length + manualItemsInZone.length;
                        const zonePhoto = fns[fnIdx]?.elSelectedPhoto?.[zk]?.src || null;
                        const zonePhotoName = fns[fnIdx]?.elSelectedPhoto?.[zk]?.eventName || "";
                        return (
                          <div key={zk} style={{borderRadius:10,border:`1px solid ${border}`,background:"rgba(255,255,255,0.02)",overflow:"hidden"}}>
                            <div onClick={()=>setDcCollapsedZones(p=>({...p,[collapseKey]:!collapsed}))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",cursor:"pointer",background:"rgba(255,255,255,0.03)",borderBottom:collapsed?"none":`1px solid ${border}`}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <span style={{fontSize:11,color:textS,transition:"transform 0.15s",display:"inline-block",transform:collapsed?"rotate(-90deg)":"rotate(0)"}}>▼</span>
                                {zonePhoto && <img src={zonePhoto} alt={zonePhotoName||zk} onClick={e=>{e.stopPropagation();window.open(zonePhoto,"_blank");}} title={zonePhotoName?`${zonePhotoName} — click to enlarge`:"Zone reference photo — click to enlarge"} style={{width:46,height:34,objectFit:"cover",borderRadius:6,border:`1px solid ${border}`,cursor:"zoom-in",flexShrink:0}} />}
                                <span style={{fontSize:13,fontWeight:700,color:"#fff",letterSpacing:0.2,textTransform:"capitalize"}}>{zk}</span>
                                <span style={{fontSize:10,color:textS}}>{totalRowCount} card{totalRowCount===1?"":"s"}</span>
                              </div>
                              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                {hasPlatform && <span title="Structural platform (fatta + stand)" style={{fontSize:9,padding:"3px 7px",borderRadius:4,background:platformShort?"rgba(245,158,11,0.18)":"rgba(16,185,129,0.18)",color:platformShort?"#F59E0B":"#10B981",fontWeight:700,letterSpacing:0.4}}>🏗️ {platformShort?"⚠":"✓"}</span>}
                                {fnIdx === activeFnIdx && <>
                                  <span onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx,zoneKey:zk,type:"production"});}} title="Add Production item" style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(168,85,247,0.10)",color:"#A855F7",fontWeight:600,cursor:"pointer"}}>🏭+</span>
                                  <span onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx,zoneKey:zk,type:"buying"});}} title="Add Buying item" style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(245,158,11,0.10)",color:"#F59E0B",fontWeight:600,cursor:"pointer"}}>🛒+</span>
                                </>}
                                {matchedCount>0 && <span style={{fontSize:9,padding:"3px 7px",borderRadius:4,background:"rgba(16,185,129,0.18)",color:"#10B981",fontWeight:700,letterSpacing:0.4}}>✓ {matchedCount}</span>}
                                {unmatchedCount>0 && <span style={{fontSize:9,padding:"3px 7px",borderRadius:4,background:"rgba(239,68,68,0.18)",color:"#EF4444",fontWeight:700,letterSpacing:0.4}}>⚠ {unmatchedCount}</span>}
                              </div>
                            </div>
                            {!collapsed && (
                              <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:10}}>
                                {/* Platform composite card (Deploy 2 §7.9 addendum) */}
                                {(() => {
                                  const pi = platformPlan?.perZone?.[`${fnIdx}|${zk}`];
                                  if (!pi) return null;
                                  const sqft = pi.L * pi.W;
                                  const heightLabel = pi.plH === "4in" ? "4 inch raise" : "1ft–3ft";
                                  const fattaShort = pi.freeAfterFatta < 0;
                                  const standShort = pi.stands > 0 && pi.freeAfterStand < 0;
                                  const anyShort = fattaShort || standShort;
                                  const accentBorder = anyShort ? "#F59E0B" : "#10B981";
                                  return (
                                    <div style={{padding:"11px 12px",borderRadius:9,background:"rgba(16,185,129,0.04)",border:`1px solid ${accentBorder}33`,display:"flex",flexDirection:"column",gap:8}}>
                                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                        <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>🏗️ Platform ({heightLabel})</span>
                                        <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(148,163,184,0.18)",color:"#94A3B8",fontWeight:700,letterSpacing:0.4}}>STRUCTURAL</span>
                                        <span style={{fontSize:10,color:textS}}>{pi.L}×{pi.W} = {sqft} sqft</span>
                                      </div>
                                      <div style={{fontSize:10,color:textS,marginBottom:2}}>Composite — expands to:</div>
                                      <div style={{display:"flex",flexDirection:"column",gap:5,paddingLeft:8}}>
                                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                                          <span style={{color:"#fff",fontWeight:600,minWidth:140}}>Platform Fatta × {pi.fattas}</span>
                                          {pi.fattaItem ? (
                                            fattaShort ? (
                                              <span style={{color:"#F59E0B",fontWeight:600}}>⚠ {Math.max(0,pi.freeBeforeFatta)} free{pi.priorFatta>0?` (after ${pi.priorFatta} taken by prior zones this date)`:""} · short by {Math.abs(pi.freeAfterFatta)}</span>
                                            ) : (
                                              <span style={{color:"#10B981"}}>✓ {pi.freeBeforeFatta} free{pi.priorFatta>0?` (after ${pi.priorFatta} prior)`:""}, {pi.freeAfterFatta} left after this zone</span>
                                            )
                                          ) : (
                                            <span style={{color:"#EF4444",fontStyle:"italic"}}>⚠ {PLATFORM_FATTA_CODE} not in IMS</span>
                                          )}
                                        </div>
                                        {pi.stands > 0 && (
                                          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                                            <span style={{color:"#fff",fontWeight:600,minWidth:140}}>Platform Stand × {pi.stands}</span>
                                            {pi.standItem ? (
                                              standShort ? (
                                                <span style={{color:"#F59E0B",fontWeight:600}}>⚠ {Math.max(0,pi.freeBeforeStand)} free{pi.priorStand>0?` (after ${pi.priorStand} taken by prior zones this date)`:""} · short by {Math.abs(pi.freeAfterStand)}</span>
                                              ) : (
                                                <span style={{color:"#10B981"}}>✓ {pi.freeBeforeStand} free{pi.priorStand>0?` (after ${pi.priorStand} prior)`:""}, {pi.freeAfterStand} left after this zone</span>
                                              )
                                            ) : (
                                              <span style={{color:"#EF4444",fontStyle:"italic"}}>⚠ {PLATFORM_STAND_CODE} not in IMS</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                      {(()=>{
                                        const fR = pi.fattaItem ? imsField.rentalCost(pi.fattaItem) : 0;
                                        const sR = pi.standItem ? imsField.rentalCost(pi.standItem) : 0;
                                        const fCost = (pi.fattas||0) * fR;
                                        const sCost = (pi.stands||0) * sR;
                                        const total = fCost + sCost;
                                        if (total <= 0) return <div style={{fontSize:10,color:"#F59E0B",marginTop:6,fontStyle:"italic"}}>⚠ Set rental prices on Platform Fatta/Stand in IMS for cost to appear</div>;
                                        return (
                                          <div style={{marginTop:8,paddingTop:6,borderTop:"1px solid rgba(16,185,129,0.15)",display:"flex",flexDirection:"column",gap:3}}>
                                            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:textS}}>
                                              <span>Fatta ₹{fR.toLocaleString("en-IN")} × {pi.fattas}</span>
                                              <span style={{color:"#fff",fontWeight:600}}>₹{fCost.toLocaleString("en-IN")}</span>
                                            </div>
                                            {pi.stands > 0 && sR > 0 && (
                                              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:textS}}>
                                                <span>Stand ₹{sR.toLocaleString("en-IN")} × {pi.stands}</span>
                                                <span style={{color:"#fff",fontWeight:600}}>₹{sCost.toLocaleString("en-IN")}</span>
                                              </div>
                                            )}
                                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700,color:"#10B981",marginTop:2}}>
                                              <span>Platform rental</span>
                                              <span>₹{total.toLocaleString("en-IN")}</span>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  );
                                })()}
                                {/* §26.18 + §26.19 — Carpet block with visual tile picker */}
                                {(()=>{
                                  const zc = fns[fnIdx]?.zoneConfig?.[zk];
                                  if (!zc || !zc.cpT) return null;
                                  const fd = zc.floorDims || zc.dims || {};
                                  const neededSqft = Math.round((Number(fd.L)||0)*(Number(fd.W)||0));
                                  if (neededSqft <= 0) return null;
                                  const carpetOpts = dcInventoryCache.filter(x => String(imsField.subcategory(x)||"").toLowerCase().includes("carpet"));
                                  const pickedId = dcCarpetPick[fnIdx]?.[zk];
                                  const carpetItem = pickedId ? dcInventoryCache.find(x=>x.id===pickedId) : null;
                                  const markup = dealCheckData?.carpetFreshMarkup ?? 40;
                                  const calc = carpetItem ? calcZoneCarpet(zc, carpetItem, markup) : null;
                                  const setPick = (id)=> setDcCarpetPick(prev=>({...prev,[fnIdx]:{...(prev[fnIdx]||{}),[zk]: id}}));
                                  const searchKey = `${fnIdx}|${zk}`;
                                  const searchText = dcCarpetSearch[searchKey] || "";
                                  const setSearch = (v)=> setDcCarpetSearch(prev=>({...prev,[searchKey]:v}));
                                  const q = searchText.toLowerCase().trim();
                                  const _fnPal = fns[fnIdx]?.fnPalette || "Custom";
                                  const _pObj = (imsPaletteCatalogue||[]).find(p => p.name === _fnPal);
                                  const _anchors = (_pObj?.anchorColours || []).map(c => c.toLowerCase());
                                  const scoreCarpet = (x) => {
                                    const n = (x.name||"").toLowerCase();
                                    let matches = 0;
                                    for (const a of _anchors) { if (n.includes(a)) matches++; }
                                    return matches;
                                  };
                                  let filtered;
                                  if (q) {
                                    filtered = carpetOpts.filter(x => (x.name||"").toLowerCase().includes(q) || String(imsField.subcategory(x)||"").toLowerCase().includes(q));
                                  } else {
                                    filtered = [...carpetOpts].sort((a,b) => {
                                      const sa = scoreCarpet(a), sb = scoreCarpet(b);
                                      if (sb !== sa) return sb - sa;
                                      return (Number(b.qty)||0) - (Number(a.qty)||0);
                                    });
                                  }
                                  const showAllKey = `${fnIdx}|${zk}|showAll`;
                                  const showAll = dcCarpetSearch[showAllKey] === "1";
                                  const displayLimit = q ? 30 : (showAll ? filtered.length : 10);
                                  const hasMore = !q && filtered.length > 10 && !showAll;
                                  return (
                                    <div style={{padding:"11px 12px",borderRadius:9,background:"rgba(244,63,94,0.05)",border:"1px solid rgba(244,63,94,0.25)",display:"flex",flexDirection:"column",gap:8}}>
                                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                        <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>🟥 Carpet</span>
                                        <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(148,163,184,0.18)",color:"#94A3B8",fontWeight:700,letterSpacing:0.4}}>{zc.cpT==="old"?"REUSED PREF":"FLOOR"}</span>
                                        <span style={{fontSize:10,color:textS}}>{neededSqft} sqft needed</span>
                                      </div>
                                      {carpetItem && calc ? (
                                        <div style={{display:"flex",gap:10,alignItems:"center",padding:"6px 8px",borderRadius:7,background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)"}}>
                                          {(()=>{const cp=imsField.photos(carpetItem)[0]; return cp ? <img src={cp} alt="" style={{width:48,height:48,borderRadius:6,objectFit:"cover",flexShrink:0}}/> : <div style={{width:48,height:48,borderRadius:6,background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🟥</div>;})()}
                                          <div style={{flex:1,minWidth:0}}>
                                            <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>{carpetItem.name}</div>
                                            <div style={{fontSize:10,color:textS,marginTop:2}}>
                                              {calc.fresh>0
                                                ? <span style={{color:"#F59E0B",fontWeight:600}}>⚠ {calc.reused} reused + {calc.fresh} fresh sqft · ₹{Math.round(calc.cost).toLocaleString("en-IN")} <span style={{opacity:0.8,fontWeight:400}}>(incl. ₹{Math.round(calc.freshCost).toLocaleString("en-IN")} fresh)</span></span>
                                                : <span style={{color:"#10B981"}}>✓ {calc.needed} sqft in stock · ₹{Math.round(calc.cost).toLocaleString("en-IN")} rental</span>}
                                            </div>
                                            {calc.rentalRate<=0 && <div style={{color:"#EF4444",fontSize:9,marginTop:2,fontStyle:"italic"}}>⚠ No rental rate in IMS (₹0/sqft)</div>}
                                          </div>
                                          <span onClick={()=>setPick(null)} style={{color:"#EF4444",cursor:"pointer",fontSize:14,fontWeight:700,flexShrink:0}} title="Clear">×</span>
                                        </div>
                                      ) : (
                                        <div style={{fontSize:10,color:"#F59E0B",fontStyle:"italic"}}>Pick a carpet below{_anchors.length > 0 ? ` — sorted by ${_fnPal} theme` : ""} — {carpetOpts.length} options in IMS</div>
                                      )}
                                      <input value={searchText} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search carpets (colour, type, design)…" style={{fontSize:11,padding:"5px 9px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#fff"}} />
                                      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,WebkitOverflowScrolling:"touch",flexWrap:"wrap"}}>
                                        {filtered.length === 0 && <div style={{fontSize:10,color:textS,fontStyle:"italic",padding:"8px 0"}}>No carpets match "{searchText}"</div>}
                                        {filtered.slice(0,displayLimit).map(opt=>{
                                          const optPhoto = imsField.photos(opt)[0];
                                          const isSelected = pickedId === opt.id;
                                          const optRental = imsField.rentalCost(opt);
                                          const optOwned = Number(opt.qty)||0;
                                          const themeScore = scoreCarpet(opt);
                                          return (
                                            <div key={opt.id} onClick={()=>{setPick(opt.id); setSearch("");}} style={{minWidth:100,maxWidth:110,cursor:"pointer",borderRadius:8,overflow:"hidden",border:isSelected?`2px solid #10B981`:themeScore>0?`1.5px solid rgba(201,169,110,0.5)`:`1px solid ${border}`,background:isSelected?"rgba(16,185,129,0.08)":themeScore>0?"rgba(201,169,110,0.06)":"rgba(255,255,255,0.025)",flexShrink:0,transition:"border 0.15s",position:"relative"}}>
                                              {themeScore>0&&<div style={{position:"absolute",top:3,right:3,fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(201,169,110,0.85)",color:"#fff",fontWeight:700,zIndex:1}}>🎨 match</div>}
                                              {optPhoto ? <img src={optPhoto} alt="" style={{width:"100%",height:72,objectFit:"cover",display:"block"}}/> : <div style={{width:"100%",height:72,background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🟥</div>}
                                              <div style={{padding:"5px 6px"}}>
                                                <div style={{fontSize:9,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{opt.name}</div>
                                                <div style={{fontSize:8,color:textS,marginTop:1}}>{optOwned.toLocaleString("en-IN")} sqft{optRental>0?` · ₹${optRental}/sqft`:""}</div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                        {hasMore && <div onClick={()=>setDcCarpetSearch(prev=>({...prev,[showAllKey]:"1"}))} style={{minWidth:80,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",borderRadius:8,border:`1px dashed ${border}`,padding:"10px 8px",fontSize:10,color:accent,fontWeight:600,flexShrink:0}}>Show all {filtered.length}</div>}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {zoneCards.map(card => {
                                  const item = card.imsId ? dcInventoryCache.find(x => x.id === card.imsId) : null;
                                  const photo = item ? imsField.photos(item)[0] : null;
                                  const rental = item ? imsField.rentalCost(item) : 0;
                                  const dims = item ? imsField.sizeText(item) : "";
                                  const hold = card.imsId ? getActiveSoftHold(softHolds, card.imsId, authUser?.name, Date.now()) : null;
                                  const sourceMeta = {
                                    "name-match": { icon: "📋", color: "#94A3B8", label: "name match" },
                                    "manual-swap":{ icon: "✋", color: "#A78BFA", label: "swapped" },
                                    "photo":      { icon: "📷", color: "#38BDF8", label: "photo AI" },
                                    "list":       { icon: "📋", color: "#94A3B8", label: "list AI" },
                                    "floral":     { icon: "🌸", color: "#EC4899", label: "floral" },
                                    "no-match":   { icon: "⚠",  color: "#EF4444", label: "no match" },
                                  }[card.source] || { icon: "·", color: textS, label: "" };
                                  return (
                                    <div key={card._cardKey} style={{padding:"11px 12px",borderRadius:9,background:"rgba(255,255,255,0.025)",border:`1px solid ${border}`,display:"flex",gap:11,alignItems:"flex-start"}}>
                                      {photo ? <img src={photo} alt="" style={{width:54,height:54,borderRadius:7,objectFit:"cover",flexShrink:0,background:"#0F0F1A"}}/> : <div style={{width:54,height:54,borderRadius:7,background:"#0F0F1A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:textS,flexShrink:0}}>?</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                          <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{card.rcName || "(unnamed)"}</span>
                                          <span title={sourceMeta.label} style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:`${sourceMeta.color}22`,color:sourceMeta.color,fontWeight:700,letterSpacing:0.4}}>{sourceMeta.icon} {sourceMeta.label}</span>
                                          {hold && <span title={`Held by ${hold.salesperson} for ${hold.eventName}`} style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(245,158,11,0.20)",color:"#F59E0B",fontWeight:700,letterSpacing:0.4}}>⏳ {hold.salesperson}</span>}
                                          {item && (()=>{ const cq=Number(card.qty)||1; const av=getStudioAvailable(item, fnBlocksForChip); return cq>av ? <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(239,68,68,0.18)",color:"#EF4444",fontWeight:700,letterSpacing:0.4}}>⚠ {av}</span> : null; })()}
                                          {card.imsId && reuseFnCount[card.imsId]?.size >= 2 && <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(16,185,129,0.18)",color:"#10B981",fontWeight:700,letterSpacing:0.4}}>♻ {reuseFnCount[card.imsId].size} fns</span>}
                                          <span onClick={()=>setDcCards(prev=>{const fn={...(prev[fnIdx]||{})}; delete fn[card._cardKey]; return {...prev,[fnIdx]:fn};})} title="Remove from Deal Check" style={{marginLeft:"auto",cursor:"pointer",color:"#EF4444",fontSize:14,fontWeight:700,padding:"0 4px",lineHeight:1,flexShrink:0,opacity:0.6,transition:"opacity 0.15s"}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0.6}>×</span>
                                        </div>
                                        {card.imsId && item ? (
                                          <div style={{fontSize:11,color:textS,marginBottom:6}}>
                                            → <span style={{color:"#fff",fontWeight:600}}>{card.imsName || item.name}</span>
                                            <span style={{marginLeft:8,opacity:0.7}}>₹{rental.toLocaleString("en-IN")}{card.qty>1?` × ${card.qty} = ₹${(rental*card.qty).toLocaleString("en-IN")}`:""}</span>
                                            {dims && <span style={{marginLeft:8,opacity:0.7}}>· {dims}</span>}
                                          </div>
                                        ) : (
                                          <div style={{fontSize:11,color:"#EF4444",marginBottom:6,fontStyle:"italic"}}>No IMS match — pick from alternatives below or browse subcategory</div>
                                        )}
                                        {/* §7.9.5 — Kit composite: expand to components, per-deal editable */}
                                        {item && Array.isArray(item.subItems) && item.subItems.length > 0 && (()=>{
                                          const editKey = card._cardKey;
                                          const editedSub = dcKitEdits[fnIdx]?.[editKey];
                                          const comps = Array.isArray(editedSub) ? editedSub : item.subItems.map(s=>({itemId:s.itemId, qty:Number(s.qty)||1}));
                                          const isEdited = Array.isArray(editedSub);
                                          const cardQty = Number(card.qty)||1;
                                          const setComps = (next)=> setDcKitEdits(prev=>({...prev,[fnIdx]:{...(prev[fnIdx]||{}),[editKey]: next}}));
                                          const resetKit = ()=> setDcKitEdits(prev=>{ const fnE={...(prev[fnIdx]||{})}; delete fnE[editKey]; return {...prev,[fnIdx]:fnE}; });
                                          const kitTotal = comps.reduce((s,c)=>{ const ci=dcInventoryCache.find(x=>x.id===c.itemId); return s + (ci?imsField.rentalCost(ci):0)*(Number(c.qty)||0); },0);
                                          return (
                                            <div style={{marginTop:5,marginBottom:6,padding:"8px 10px",borderRadius:8,background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.25)"}}>
                                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                                                <span style={{fontSize:10,fontWeight:700,color:"#A5B4FC",letterSpacing:0.3}}>📦 Kit — blocks these together:{isEdited && <span style={{color:"#F59E0B",marginLeft:5}}>· edited</span>}</span>
                                                {isEdited && <span onClick={resetKit} style={{fontSize:9,color:textS,cursor:"pointer",textDecoration:"underline"}}>reset to default</span>}
                                              </div>
                                              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                                {comps.map((c,ci)=>{
                                                  const cItem = dcInventoryCache.find(x=>x.id===c.itemId);
                                                  const qtyEach = Number(c.qty)||0;
                                                  const needed = qtyEach * cardQty;
                                                  const owned = cItem ? imsField.qtyOwned(cItem) : 0;
                                                  const short = cItem && needed > owned;
                                                  return (
                                                    <div key={ci} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                                                      <span style={{color:cItem?"#fff":"#EF4444",fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cItem?cItem.name:`⚠ ${c.itemId} not in IMS`}</span>
                                                      <div style={{display:"flex",alignItems:"center",gap:2}}>
                                                        <span onClick={()=>setComps(comps.map((x,i)=>i===ci?{...x,qty:Math.max(1,qtyEach-1)}:x))} style={{cursor:"pointer",color:textS,fontSize:14,padding:"0 4px",userSelect:"none"}}>−</span>
                                                        <span style={{color:"#fff",minWidth:20,textAlign:"center"}}>×{qtyEach}</span>
                                                        <span onClick={()=>setComps(comps.map((x,i)=>i===ci?{...x,qty:qtyEach+1}:x))} style={{cursor:"pointer",color:textS,fontSize:14,padding:"0 4px",userSelect:"none"}}>+</span>
                                                      </div>
                                                      {cItem && (short
                                                        ? <span style={{color:"#F59E0B",fontWeight:600,whiteSpace:"nowrap"}}>⚠ need {needed}, {owned} owned</span>
                                                        : <span style={{color:"#10B981",whiteSpace:"nowrap"}}>✓ {owned} owned</span>)}
                                                      <span onClick={()=>setComps(comps.filter((_,i)=>i!==ci))} style={{color:"#EF4444",cursor:"pointer",fontSize:14,padding:"0 2px"}} title="Remove component">×</span>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div style={{marginTop:5,display:"flex",gap:6}}>
                                                <input list={`kit-add-${editKey}`} placeholder="+ add an item to this kit…" onChange={e=>{const nm=e.target.value; const it=dcInventoryCache.find(x=>x.name===nm); if(it){ setComps(comps.some(c=>c.itemId===it.id)?comps:[...comps,{itemId:it.id,qty:1}]); e.target.value=""; }}} style={{flex:1,fontSize:10,padding:"4px 8px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#fff"}} />
                                                <datalist id={`kit-add-${editKey}`}>
                                                  {dcInventoryCache.filter(x=>!comps.some(c=>c.itemId===x.id)).slice(0,400).map(x=><option key={x.id} value={x.name} />)}
                                                </datalist>
                                              </div>
                                              <div style={{marginTop:5,paddingTop:5,borderTop:"1px solid rgba(99,102,241,0.2)",display:"flex",justifyContent:"space-between",fontSize:10}}>
                                                <span style={{color:textS}}>Kit rental{cardQty>1?` × ${cardQty}`:""}</span>
                                                <span style={{color:"#A5B4FC",fontWeight:700}}>₹{(kitTotal*cardQty).toLocaleString("en-IN")}</span>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                        {/* ═══ Paint Allocation Ops handoff — show salesperson's colour request ═══ */}
                                        {(()=>{
                                          const cardSpec = parseCardKey(card._cardKey);
                                          if (!cardSpec || cardSpec.kind !== "el") return null;
                                          const fnEls = fns[fnIdx]?.zoneElements?.[cardSpec.zoneKey];
                                          const origEl = fnEls ? fnEls.find(e => (e?.name||"").toLowerCase().trim() === (cardSpec.rcName||"").toLowerCase().trim()) || fnEls[cardSpec.idx] : null;
                                          if (!origEl) return null;
                                          const baseCol = item?.baseColour || "Ivory";
                                          const allocs = normalizePaintAllocation(origEl, baseCol);
                                          if (allocs.length === 0) return null;
                                          const allocLabel = allocs.map(a => `${a.colour} ×${a.qty}`).join(", ");
                                          const itemPaintCost = Number(item?.paintCost || 0);
                                          const isNonPaintable = item && itemPaintCost <= 0;
                                          return (
                                            <div style={{marginBottom:5}}>
                                              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                                                <span style={{fontSize:10,padding:"2px 7px",borderRadius:5,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700}}>🖌 {allocLabel}</span>
                                                <span style={{fontSize:9,color:"#EC4899",opacity:0.7}}>salesperson requested</span>
                                              </div>
                                              {isNonPaintable && (
                                                <div style={{marginTop:4,padding:"5px 8px",borderRadius:6,background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)"}}>
                                                  <div style={{fontSize:10,color:"#EF4444",fontWeight:700}}>⚠ This item cannot be repainted</div>
                                                  <div style={{fontSize:9,color:"#EF4444",opacity:0.8,marginTop:2}}>
                                                    {(()=>{
                                                      const sub = item ? (imsField.subcategory(item)||"") : "";
                                                      if (!sub) return "No paintable alternatives found in this subcategory.";
                                                      const paintableAlts = (dcInventoryCache||[]).filter(x =>
                                                        String(imsField.subcategory(x)||"").toLowerCase().trim() === sub.toLowerCase().trim()
                                                        && Number(x.paintCost||0) > 0
                                                        && x.id !== item.id
                                                      );
                                                      if (paintableAlts.length === 0) return "No paintable alternatives found in " + sub + ".";
                                                      return "Try: " + paintableAlts.slice(0,3).map(a => a.name).join(", ") + (paintableAlts.length > 3 ? ` (+${paintableAlts.length-3} more)` : "");
                                                    })()}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {Array.isArray(card.alternatives) && card.alternatives.length > 0 && (()=>{
                                          const inferredSub = item ? imsField.subcategory(item) : (card.alternatives.map(a => dcInventoryCache.find(x => x.id === a.imsId)).find(Boolean) ? imsField.subcategory(card.alternatives.map(a => dcInventoryCache.find(x => x.id === a.imsId)).find(Boolean)) : "");
                                          const cardSpec = parseCardKey(card._cardKey);
                                          const subcategory = cardSpec ? (zoneCards[0]?.subcategory || "") : "";
                                          const subToUse = subcategory || inferredSub;
                                          const allSubItems = subToUse ? dcInventoryCache.filter(x => String(imsField.subcategory(x)||"").toLowerCase().trim() === String(subToUse).toLowerCase().trim()) : [];
                                          const seenIds = new Set();
                                          const mergedAlts = [];
                                          for (const alt of card.alternatives) { seenIds.add(alt.imsId); mergedAlts.push(alt); }
                                          for (const itm of allSubItems) { if (!seenIds.has(itm.id)) { seenIds.add(itm.id); mergedAlts.push({imsId: itm.id, name: itm.name}); } }
                                          const subTotal = allSubItems.length;
                                          return (
                                          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:5}}>
                                            <span style={{fontSize:9,color:textS,letterSpacing:0.6,textTransform:"uppercase",fontWeight:600,marginRight:2}}>Alternatives:</span>
                                            {mergedAlts.slice(0,10).map(alt => {
                                              const altItem = dcInventoryCache.find(x => x.id === alt.imsId);
                                              const altPhoto = altItem ? imsField.photos(altItem)[0] : null;
                                              const altRental = altItem ? imsField.rentalCost(altItem) : 0;
                                              const altDims = altItem ? imsField.sizeText(altItem) : "";
                                              const altHold = getActiveSoftHold(softHolds, alt.imsId, authUser?.name, Date.now());
                                              const isCurrent = alt.imsId === card.imsId;
                                              return (
                                                <div key={alt.imsId} onClick={()=>{
                                                  if (isCurrent) return;
                                                  setDcCards(prev => ({
                                                    ...prev,
                                                    [fnIdx]: { ...(prev[fnIdx] || {}), [card._cardKey]: { ...(prev[fnIdx]?.[card._cardKey] || {}), imsId: alt.imsId, imsName: altItem?.name || alt.name, source: "manual-swap" } }
                                                  }));
                                                }} title={`${alt.name || altItem?.name || alt.imsId}${altDims?" · "+altDims:""} · ₹${altRental.toLocaleString("en-IN")}${altHold?" · ⏳ "+altHold.salesperson:""}`}
                                                style={{position:"relative",width:56,height:56,borderRadius:6,overflow:"hidden",border:isCurrent?`2px solid ${accent}`:`1px solid ${border}`,cursor:isCurrent?"default":"pointer",flexShrink:0,opacity:altHold?0.55:1}}>
                                                  {altPhoto ? <img src={altPhoto} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/> : <div style={{width:"100%",height:"100%",background:"#0F0F1A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:textS}}>?</div>}
                                                  <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"2px 4px",background:"rgba(0,0,0,0.65)",fontSize:8,color:"#fff",fontWeight:700,letterSpacing:0.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>₹{altRental >= 1000 ? Math.round(altRental/100)/10+"k" : altRental}</div>
                                                  {altHold && <div style={{position:"absolute",top:2,right:2,fontSize:9,background:"rgba(245,158,11,0.85)",borderRadius:3,padding:"1px 3px",color:"#0F0F1A",fontWeight:700}}>⏳</div>}
                                                  {isCurrent && <div style={{position:"absolute",top:2,left:2,fontSize:9,background:`${accent}cc`,borderRadius:3,padding:"1px 3px",color:"#0F0F1A",fontWeight:700}}>✓</div>}
                                                </div>
                                              );
                                            })}
                                            {subToUse && subTotal > 0 && (
                                              <button onClick={()=>setDcBrowseAllOpen({fnIdx, cardKey: card._cardKey, subcategory: subToUse})} style={{padding:"6px 10px",borderRadius:6,border:`1px dashed ${border}`,background:"transparent",color:accent,fontSize:10,fontWeight:600,cursor:"pointer",letterSpacing:0.3,whiteSpace:"nowrap"}}>Browse all {subTotal} in {subToUse} ↗</button>
                                            )}
                                          </div>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  );
                                })}
                                {/* ═══ MANUAL BLOCKS — zone-scoped manual inventory adds ═══ */}
                                {manualItemsInZone.map(mi => {
                                  const item = dealCheckInventory.find(i => i.id === mi.imsId);
                                  const photo = item ? imsField.photos(item)[0] : null;
                                  const rental = item ? imsField.rentalCost(item) : 0;
                                  const dims = item ? imsField.sizeText(item) : "";
                                  const sub = item ? imsField.subcategory(item) : "";
                                  // Hard cap: you can't block more than is available at this venue.
                                  const _vName = (fns[fnIdx] || {}).fnVenue || "";
                                  const _avail = item ? Math.max(0, Math.min(getStudioAvailable(item, fnBlocksForChip), availableAtVenue({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, _vName, item))) : 0;
                                  return (
                                    <div key={mi.manualId} style={{padding:"11px 12px",borderRadius:9,background:"rgba(193,154,107,0.05)",border:`1px solid rgba(193,154,107,0.30)`,display:"flex",gap:11,alignItems:"flex-start"}}>
                                      {photo ? <img src={photo} alt="" style={{width:54,height:54,borderRadius:7,objectFit:"cover",flexShrink:0,background:"#0F0F1A"}}/> : <div style={{width:54,height:54,borderRadius:7,background:"#0F0F1A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:textS,flexShrink:0}}>?</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                          <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{item?.name || mi.imsId}</span>
                                          <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"rgba(193,154,107,0.22)",color:"#C19A6B",fontWeight:700,letterSpacing:0.4}}>✋ MANUAL</span>
                                          {sub && <span style={{fontSize:9,color:textS}}>· {sub}</span>}
                                        </div>
                                        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:textS}}>
                                          <span>Qty:</span>
                                          <input type="number" min="1" max={_avail || undefined} value={mi.qty} onChange={e=>{
                                            const raw = Math.max(1, Number(e.target.value)||1);
                                            const v = _avail > 0 ? Math.min(raw, _avail) : raw;
                                            if (raw > v) showMsg && showMsg(`Only ${_avail} available — capped at ${_avail}`, "orange");
                                            setDcManualItems(prev => prev.map(x => x.manualId === mi.manualId ? {...x, qty: v} : x));
                                          }} style={{width:60,padding:"3px 6px",borderRadius:4,border:`1px solid ${mi.qty>=_avail&&_avail>0?"#F59E0B":border}`,background:"rgba(255,255,255,0.04)",color:"#fff",fontSize:11}}/>
                                          <span style={{opacity:0.7}}>of {_avail} avail · ₹{rental.toLocaleString("en-IN")} × {mi.qty} = ₹{(rental*mi.qty).toLocaleString("en-IN")}</span>
                                          {dims && <span style={{opacity:0.7}}>· {dims}</span>}
                                        </div>
                                      </div>
                                      <button onClick={()=>setDcManualItems(prev => prev.filter(x => x.manualId !== mi.manualId))} title="Remove manual block" style={{background:"transparent",border:"none",color:"#EF4444",cursor:"pointer",fontSize:18,padding:"0 4px",lineHeight:1}}>×</button>
                                    </div>
                                  );
                                })}
                                {/* ═══ MANUAL SEARCH INPUT — always visible at zone bottom ═══ */}
                                {(() => {
                                  const searchKey = `${fnIdx}|${zk}`;
                                  const searchText = dcManualSearch[searchKey] || "";
                                  const showResults = searchText.trim().length >= 2;
                                  const lcSearch = searchText.toLowerCase().trim();
                                  const matches = showResults
                                    ? dealCheckInventory.filter(i => {
                                        const n = String(i?.name || "").toLowerCase();
                                        const s = String(imsField.subcategory(i) || "").toLowerCase();
                                        return n.includes(lcSearch) || s.includes(lcSearch);
                                      }).slice(0, 10)
                                    : [];
                                  return (
                                    <div style={{marginTop:6,position:"relative"}}>
                                      <input
                                        type="text"
                                        placeholder="🔍 Search inventory to add manually (type 2+ letters)…"
                                        value={searchText}
                                        onChange={e=>setDcManualSearch(prev => ({...prev, [searchKey]: e.target.value}))}
                                        style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px dashed ${border}`,background:"rgba(193,154,107,0.04)",color:"#fff",fontSize:12,outline:"none",boxSizing:"border-box"}}
                                      />
                                      {showResults && matches.length === 0 && (
                                        <div style={{marginTop:6,padding:"10px 12px",fontSize:11,color:textS,fontStyle:"italic",textAlign:"center",borderRadius:7,background:"rgba(255,255,255,0.02)"}}>No matches in IMS for "{searchText}"</div>
                                      )}
                                      {showResults && matches.length > 0 && (
                                        <div style={{marginTop:6,borderRadius:8,border:`1px solid ${border}`,background:"rgba(15,15,26,0.95)",maxHeight:280,overflowY:"auto"}}>
                                          {matches.map(item => {
                                            const itemPhoto = imsField.photos(item)[0];
                                            const itemSub = imsField.subcategory(item);
                                            const _venueName = (fns[fnIdx] || {}).fnVenue || "";
                                            const _fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                                            const itemQty = availableAtVenue(_fvCfg, _venueName, item); // venue-scoped total (locked stock at other venues excluded)
                                            const itemBlocked = Number(item?.blocked) || 0;
                                            const free = Math.max(0, itemQty - itemBlocked);
                                            const _standing = isStandingAt(_fvCfg, _venueName, item.id);
                                            const _dims = item?.dims_LxWxH || item?.size || item?.dims?.lxwxh || item?.dims?.size || "";
                                            return (
                                              <div key={item.id} onClick={()=>{
                                                const newItem = {
                                                  manualId: `m-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
                                                  imsId: item.id,
                                                  qty: 1,
                                                  note: "",
                                                  fnIdx,
                                                  zoneKey: zk,
                                                };
                                                setDcManualItems(prev => [...prev, newItem]);
                                                setDcManualSearch(prev => ({...prev, [searchKey]: ""}));
                                              }} style={{display:"flex",gap:10,padding:"8px 10px",alignItems:"center",cursor:"pointer",borderBottom:`1px solid rgba(255,255,255,0.04)`}}
                                              onMouseEnter={e=>e.currentTarget.style.background="rgba(193,154,107,0.10)"}
                                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                                {itemPhoto ? <img src={itemPhoto} alt="" style={{width:36,height:36,borderRadius:5,objectFit:"cover",flexShrink:0,background:"#0F0F1A"}}/> : <div style={{width:36,height:36,borderRadius:5,background:"#0F0F1A",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:textS,flexShrink:0}}>?</div>}
                                                <div style={{flex:1,minWidth:0}}>
                                                  <div style={{fontSize:11,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}{_standing && <span style={{marginLeft:6,fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(16,185,129,0.2)",color:"#10B981",fontWeight:700,letterSpacing:0.3}}>🏛️ INSTALLED HERE</span>}</div>
                                                  <div style={{fontSize:9,color:textS,marginTop:1}}>{itemSub || "—"}{_dims ? ` · 📐 ${_dims}` : ""} · {free} free of {itemQty}</div>
                                                </div>
                                                <span style={{fontSize:10,color:"#C19A6B",fontWeight:700,letterSpacing:0.3}}>+ ADD</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {/* §26.13 — Production/Buying custom items in this zone */}
                                {dcCustomItems.filter(ci => ci.fnIdx === fnIdx && ci.zoneKey === zk).map(ci => {
                                  const isP = ci.type === "production";
                                  const ciColor = isP ? "#A855F7" : "#F59E0B";
                                  const ciIcon = isP ? "🏭" : "🛒";
                                  const refItem = ci.refItemId ? (dcInventoryCache || []).find(x => x.id === ci.refItemId) : null;
                                  const refPhoto = refItem ? imsField.photos(refItem)[0] : null;
                                  const ciZonePhoto = elSelectedPhoto[ci.zoneKey]?.src || null;
                                  const photo = ci.photo || ciZonePhoto || refPhoto || null;
                                  const unitCost = ci.manualPrice || ci.refPrice || 0;
                                  return (
                                    <div key={ci.id} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${ciColor}40`,background:`${ciColor}08`,display:"flex",gap:10,alignItems:"center"}}>
                                      {photo ? <img src={photo} alt="" style={{width:44,height:44,borderRadius:6,objectFit:"cover"}} /> : <div style={{width:44,height:44,borderRadius:6,background:`${ciColor}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{ciIcon}</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{fontSize:11,fontWeight:600,color:textP}}>{ciIcon} {ci.subCat} <span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:`${ciColor}20`,color:ciColor,fontWeight:700,marginLeft:4}}>{isP?"PRODUCTION":"BUYING"}</span></div>
                                        <div style={{fontSize:9,color:textS,marginTop:2}}>× {ci.qty} · {ci.dims.w||"?"}W × {ci.dims.l||"?"}D × {ci.dims.h||"?"}H ft{ci.notes?` · ${ci.notes}`:""}</div>
                                      </div>
                                      <div style={{textAlign:"right"}}>
                                        <div style={{fontSize:12,fontWeight:700,color:ciColor}}>₹{Math.round(unitCost * ci.qty).toLocaleString("en-IN")}</div>
                                        <div style={{fontSize:9,color:textS}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {ci.qty}</div>
                                      </div>
                                      <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))} style={{padding:"4px 6px",borderRadius:4,border:"none",background:"rgba(239,68,68,0.12)",color:"#EF4444",fontSize:10,cursor:"pointer",fontWeight:700}}>✕</button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : dcActiveTab === "florals" ? (
                  <DCFloralsTab ctx={ctx} />
                ) : dcActiveTab === "manpower" ? (
                  <DCManpowerTab ctx={ctx} />
                ) : dcActiveTab === "truss" ? (
                  <DCTrussTab ctx={ctx} />
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
                              <div style={{fontSize:10,color:textS,marginTop:2}}>× {ci.qty}{ci.dims?.l?` · ${ci.dims.w}W × ${ci.dims.l}D × ${ci.dims.h}H ft`:""}{ci.notes?` · ${ci.notes}`:""}</div>
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
                })() : dcActiveTab === "depts" ? (() => {
                  const dd = dcCostRollup.dept || {};
                  const depts = dcCostRollup.DEPTS || [];
                  const deptIcon = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
                  const cur = dd[dcDept] || { rental: 0, florals: 0, truss: 0, fabric: 0, transport: 0, manpower: 0, production: 0, buying: 0, total: 0 };
                  const grandAll = depts.reduce((s, d) => s + (dd[d]?.total || 0), 0);
                  const f2 = (n) => n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "₹0";
                  const lines = [
                    ["📦 Inventory rental", cur.rental], ["🌸 Floral (mandi)", cur.florals], ["🏗️ Truss", cur.truss],
                    ["🧵 Fabric / draping", cur.fabric], ["👷 Manpower", cur.manpower], ["🏭 Production", cur.production],
                    ["🛒 Buying", cur.buying], ["🚚 Transport", cur.transport],
                  ].filter(([, v]) => v > 0);
                  return (
                    <div style={{ padding: "4px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                        {depts.map(d => { const on = dcDept === d; const t = dd[d]?.total || 0; return (
                          <button key={d} onClick={() => setDcDept(d)} style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${on ? accent : border}`, background: on ? `${accent}18` : "transparent", color: on ? "#fff" : textS, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, minWidth: 96, alignItems: "flex-start" }}>
                            <span style={{ fontSize: 11, fontWeight: on ? 700 : 500 }}>{deptIcon[d] || "🏦"} {d}</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: on ? "#fff" : textP }}>{f2(t)}</span>
                          </button>); })}
                      </div>
                      <div style={{ borderRadius: 10, border: `1px solid ${border}`, overflow: "hidden" }}>
                        <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.02)", fontSize: 12, fontWeight: 700, color: "#fff", display: "flex", justifyContent: "space-between" }}>
                          <span>{deptIcon[dcDept]} {dcDept} — Department Income</span><span>{f2(cur.total)}</span>
                        </div>
                        {lines.length === 0
                          ? <div style={{ padding: 16, textAlign: "center", color: textS, fontSize: 11 }}>No income for this department in the current deal.</div>
                          : lines.map(([l, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", borderTop: `1px solid ${border}22`, fontSize: 12 }}><span style={{ color: textS }}>{l}</span><span style={{ color: "#fff", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{f2(v)}</span></div>)}
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${border}`, fontSize: 11, color: textS }}><span>Share of project</span><span style={{ fontWeight: 700, color: accent }}>{grandAll > 0 ? Math.round((cur.total / grandAll) * 100) : 0}%</span></div>
                      </div>
                      <div style={{ fontSize: 10, color: textS, marginTop: 10, lineHeight: 1.5 }}>General labour & supervisors are split across departments by each one's direct-income share. Truss steel → Tenting · masking/drape fabric → Fabric · platform & carpet → Tenting · genset → Lighting · everything else → by its category.</div>
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
            {/* ═══ Browse-all-in-subcategory modal (§7.9.4 #5 escape hatch) ═══ */}
            {dcBrowseAllOpen && (() => {
              const { fnIdx, cardKey, subcategory } = dcBrowseAllOpen;
              const items = dcInventoryCache.filter(x => String(imsField.subcategory(x)).toLowerCase().trim() === String(subcategory).toLowerCase().trim());
              const card = dcCards[fnIdx]?.[cardKey];
              return (
                <div onClick={()=>setDcBrowseAllOpen(null)} style={{position:"fixed",inset:0,zIndex:9100,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
                  <div onClick={e=>e.stopPropagation()} style={{width:"min(820px, 100%)",maxHeight:"82vh",background:"#0F0F1A",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                    <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:"#fff",letterSpacing:0.2}}>Browse {subcategory}</div>
                        <div style={{fontSize:10,color:textS,letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{items.length} items · pick one to swap into {card?.rcName || "card"}</div>
                      </div>
                      <button onClick={()=>setDcBrowseAllOpen(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:13,cursor:"pointer",lineHeight:1}}>✕</button>
                    </div>
                    <div style={{padding:"14px 18px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:10}}>
                      {items.length === 0 ? (
                        <div style={{gridColumn:"1 / -1",padding:30,textAlign:"center",color:textS,fontSize:11,fontStyle:"italic"}}>No items in this subcategory.</div>
                      ) : items.map(it => {
                        const photo = imsField.photos(it)[0];
                        const rental = imsField.rentalCost(it);
                        const dims = imsField.sizeText(it);
                        const hold = getActiveSoftHold(softHolds, it.id, authUser?.name, Date.now());
                        const isCurrent = it.id === card?.imsId;
                        return (
                          <div key={it.id} onClick={()=>{
                            if (isCurrent) { setDcBrowseAllOpen(null); return; }
                            setDcCards(prev => ({
                              ...prev,
                              [fnIdx]: { ...(prev[fnIdx] || {}), [cardKey]: { ...(prev[fnIdx]?.[cardKey] || {}), imsId: it.id, imsName: it.name, source: "manual-swap" } }
                            }));
                            setDcBrowseAllOpen(null);
                          }} style={{position:"relative",borderRadius:9,overflow:"hidden",border:isCurrent?`2px solid ${accent}`:`1px solid ${border}`,cursor:isCurrent?"default":"pointer",background:"rgba(255,255,255,0.02)",opacity:hold?0.6:1}}>
                            {photo ? <img src={photo} alt="" style={{width:"100%",height:110,objectFit:"cover",display:"block",background:"#0A0A14"}}/> : <div style={{width:"100%",height:110,background:"#0A0A14",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:textS}}>?</div>}
                            <div style={{padding:"8px 9px"}}>
                              <div style={{fontSize:11,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                              <div style={{fontSize:10,color:textS,marginTop:2}}>₹{rental.toLocaleString("en-IN")}{dims&&" · "+dims}</div>
                            </div>
                            {hold && <div style={{position:"absolute",top:5,right:5,fontSize:9,background:"rgba(245,158,11,0.92)",borderRadius:4,padding:"2px 5px",color:"#0F0F1A",fontWeight:700,letterSpacing:0.3}}>⏳ {hold.salesperson}</div>}
                            {isCurrent && <div style={{position:"absolute",top:5,left:5,fontSize:9,background:`${accent}ee`,borderRadius:4,padding:"2px 5px",color:"#0F0F1A",fontWeight:700,letterSpacing:0.3}}>✓ current</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })();
}

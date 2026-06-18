import { Fragment } from "react";
import { calcZoneFabric, autoFillFabricAllocation, calcFabricAllocationTotal } from "../../../../lib/studio/pricing";
import { TRUSS_ALLOC_SK } from "../../../../lib/studio/keys.js";

export default function DCTrussTab({ ctx }) {
  const {
    // chrome / theme
    border, textS,
    // client + auth
    clientLedger, activeClientId, clientDate, authUser,
    // deal check state
    activeFnIdx, trussAlloc, setTrussAlloc, dcAmendDiff, setDcAmendDiff,
    dealCheckData, imsPaletteCatalogue, imsColourCatalogue,
    // build state writers
    setZoneConfig, setFnBuilds, setFabricPickerTarget,
    // pricing helpers
    collectAllFunctionData, calcZoneTrussPreview, calcZoneFabricCost,
    // zone meta + library
    zoneMeta, libItems,
    // persistence + misc
    reliableSave, showMsg,
  } = ctx;

  return (<>{(() => {
                  // ═══ §23 PHASE 2 — TRUSS TAB BODY ═══
                  // Per-fn / per-zone preview using Layer 0 + Layer 1 + cost calc.
                  // §23 Phase 3 (26 May 2026) — adds reservation status banner showing
                  // soft-hold / hard-block state per fn date + held-by-other warnings.
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No functions configured yet.</div>;
                  const trussInv = dealCheckData?.trussInv;
                  if (!trussInv) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>
                      <div style={{fontSize:32,marginBottom:10}}>🏗️</div>
                      <div style={{color:"#FBBF24",fontWeight:600,marginBottom:6}}>IMS Truss Inventory not loaded</div>
                      <div>Ask Ops to fill Settings → Truss &amp; Batta in IMS, then close + reopen Deal Check.</div>
                    </div>;
                  }

                  // Helper — list of zones present in a fn (uses fn.zoneConfig + fn.enabledEls)
                  const zonesOf = (fn) => {
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    return Object.keys(zc).filter(zk => en[zk] && zc[zk]);
                  };

                  // §23 Phase 3 — resolve reservation state for THIS client across all fn dates.
                  // States we render:
                  //   "free"        — no entry yet, will be created on next Generate
                  //   "soft-own"    — my soft hold present, expires at X
                  //   "soft-other"  — someone else's soft hold (read indicator only)
                  //   "hard"        — locked permanent block (post-SOLD)
                  //   "hard-amend"  — SOLD event being edited; diff vs current allocation
                  const currentClientId = activeClientId || "";
                  const currentSalesperson = (typeof authUser !== "undefined" ? authUser?.name : "") || "—";
                  const reservationByDate = {};
                  const heldByOthersByDate = {};
                  fns.forEach(fn => {
                    const d = fn?.fnDate || clientDate || "";
                    if (!d || reservationByDate[d]) return;
                    const events = trussAlloc?.[d]?.events || [];
                    const ownEntry = events.find(ev => ev.clientId === currentClientId);
                    if (ownEntry) {
                      const isSoldEvent = (clientLedger || []).find(c => c.id === currentClientId)?.status === "booked";
                      reservationByDate[d] = {
                        state: ownEntry.state === "hard" ? (isSoldEvent ? "hard" : "hard") : (ownEntry.heldBy === currentSalesperson ? "soft-own" : "soft-other"),
                        entry: ownEntry,
                      };
                    } else {
                      reservationByDate[d] = { state: "free", entry: null };
                    }
                    // Always collect held-by-others for visibility
                    const others = events.filter(ev => ev.clientId !== currentClientId);
                    if (others.length > 0) heldByOthersByDate[d] = others;
                  });

                  // Tally totals across all fns
                  let grandActual = 0, grandU = 0, grandBox = 0, grandPillarRft = 0, grandBeamRft = 0, grandBattaRft = 0, anyShortage = false, anyDefault = false;
                  const previewsByFn = fns.map(fn => {
                    const zones = zonesOf(fn);
                    const previews = zones.map(zk => {
                      const zCfg = (fn.zoneConfig || {})[zk];
                      const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                      const pv = calcZoneTrussPreview(zCfg, trussInv);
                      if (pv && pv.costs) {
                        grandActual += pv.costs.actual;
                        grandU      += pv.costs.uEquivalent;
                        grandBox    += pv.costs.boxEquivalent;
                        grandPillarRft += pv.costs.pillarRft;
                        grandBeamRft   += pv.costs.beamRft;
                        if (pv.batta?.rftWithBuffer) grandBattaRft += pv.batta.rftWithBuffer;
                      }
                      if (pv?.source === "default-on-forget") anyDefault = true;
                      if (pv?.smartFlag === "red") anyShortage = true;
                      return { zk, zLabel, pv };
                    }).filter(x => x.pv && x.pv.source !== "none");
                    return { fn, previews };
                  });

                  const totalZonesShown = previewsByFn.reduce((s, x) => s + x.previews.length, 0);
                  if (totalZonesShown === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>
                      <div style={{fontSize:32,marginBottom:10}}>🏗️</div>
                      <div style={{marginBottom:4}}>No truss configured in any zone.</div>
                      <div>Add Truss L/W/H dimensions in Build → any zone to see preview here.</div>
                    </div>;
                  }

                  const fmtRs = (n) => n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "₹0";
                  const flagColor = (flag) => flag === "green" ? "#10B981" : flag === "yellow" ? "#F59E0B" : "#EF4444";
                  const flagEmoji = (flag) => flag === "green" ? "🟢" : flag === "yellow" ? "🟡" : "🔴";

                  // §23 Phase 3 — Format expiry as relative time ("expires in 18h")
                  const fmtExpiry = (exp) => {
                    if (!exp) return "";
                    const ms = typeof exp === "number" ? exp : Date.parse(exp || "");
                    const diff = ms - Date.now();
                    if (diff <= 0) return "expired";
                    const hours = Math.floor(diff / (1000 * 60 * 60));
                    if (hours >= 1) return `expires in ${hours}h`;
                    const mins = Math.floor(diff / (1000 * 60));
                    return `expires in ${mins}m`;
                  };

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {/* §23 Phase 3 — Reservation Status banner(s), one per date */}
                      {Object.entries(reservationByDate).map(([d, res]) => {
                        const others = heldByOthersByDate[d] || [];
                        // Build content per state
                        let label, sublabel, bgColor, borderColor, icon;
                        if (res.state === "free") {
                          label = "Truss not reserved yet on " + d;
                          sublabel = "Click Generate to soft-hold inventory for 24 hours.";
                          bgColor = "rgba(107, 114, 128, 0.10)";
                          borderColor = "rgba(107, 114, 128, 0.30)";
                          icon = "📐";
                        } else if (res.state === "soft-own") {
                          const ev = res.entry;
                          const ttotal = Object.values(ev.totalPillarsUsed || {}).reduce((s,n)=>s+n,0);
                          const btotal = Object.values(ev.totalBeamsUsed || {}).reduce((s,n)=>s+n,0);
                          label = `✅ Reserved on ${d} · ${fmtExpiry(ev.expiry)}`;
                          sublabel = `${ttotal} pillar piece(s) + ${btotal} beam piece(s) held in your name. Re-Generate to refresh expiry.`;
                          bgColor = "rgba(16, 185, 129, 0.10)";
                          borderColor = "rgba(16, 185, 129, 0.35)";
                          icon = "🔒";
                        } else if (res.state === "soft-other") {
                          const ev = res.entry;
                          label = `⚠️ Held by ${ev.heldBy} · ${fmtExpiry(ev.expiry)}`;
                          sublabel = "Another salesperson has soft-reserved truss inventory under this client name. Contact them or wait for expiry.";
                          bgColor = "rgba(245, 158, 11, 0.10)";
                          borderColor = "rgba(245, 158, 11, 0.35)";
                          icon = "⏳";
                        } else if (res.state === "hard") {
                          const ev = res.entry;
                          const ttotal = Object.values(ev.totalPillarsUsed || {}).reduce((s,n)=>s+n,0);
                          const btotal = Object.values(ev.totalBeamsUsed || {}).reduce((s,n)=>s+n,0);
                          label = `🔒 Confirmed on ${d} · ${ttotal} pillars + ${btotal} beams`;
                          sublabel = "This event is SOLD. Edits will create an Amend request.";
                          bgColor = "rgba(99, 102, 241, 0.12)";
                          borderColor = "rgba(99, 102, 241, 0.40)";
                          icon = "🎉";
                        }
                        return (
                          <div key={d} style={{padding:"10px 14px",borderRadius:10,background:bgColor,border:`1px solid ${borderColor}`}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:14}}>{icon}</span>
                                <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{label}</span>
                              </div>
                              {others.length > 0 && (
                                <div style={{fontSize:9,color:"#FBBF24"}}>
                                  +{others.length} other event{others.length===1?"":"s"} on same date
                                </div>
                              )}
                            </div>
                            <div style={{marginTop:4,fontSize:10,color:textS}}>{sublabel}</div>
                            {/* Show stock pressure indicator: who else holds what */}
                            {others.length > 0 && (() => {
                              const summary = others.map(o => `${o.heldBy || "—"} (${Object.values(o.totalPillarsUsed||{}).reduce((s,n)=>s+n,0)}P+${Object.values(o.totalBeamsUsed||{}).reduce((s,n)=>s+n,0)}B${o.state==="hard"?", SOLD":""})`).join(" · ");
                              return <div style={{marginTop:4,fontSize:9,color:textS,fontStyle:"italic"}}>Same-date pool: {summary}</div>;
                            })()}
                          </div>
                        );
                      })}

                      {/* §23 Phase 3 — Amend mode pending diff banner */}
                      {dcAmendDiff && (
                        <div style={{padding:"12px 16px",borderRadius:10,background:"rgba(239, 68, 68, 0.10)",border:"1px solid rgba(239, 68, 68, 0.40)"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                            <span style={{fontSize:16}}>📝</span>
                            <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>Amend request preview · {dcAmendDiff.date}</span>
                          </div>
                          <div style={{fontSize:10,color:textS,marginBottom:8}}>
                            This event is already SOLD. Submitting will update the truss block and create an audit log entry.
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr",gap:6,fontSize:10,marginBottom:8}}>
                            <div style={{color:textS,fontWeight:600}}>Resource</div>
                            <div style={{color:textS,fontWeight:600}}>Before</div>
                            <div style={{color:textS,fontWeight:600}}>After (Δ)</div>
                            {Object.entries(dcAmendDiff.diff.pillars || {}).map(([sz, ch]) => (
                              <Fragment key={"p"+sz}>
                                <div style={{color:"#fff"}}>Pillar {sz}ft</div>
                                <div style={{color:"#fff"}}>{ch.before}</div>
                                <div style={{color: ch.delta > 0 ? "#EF4444" : (ch.delta < 0 ? "#10B981" : "#fff")}}>{ch.after} ({ch.delta > 0 ? "+" : ""}{ch.delta})</div>
                              </Fragment>
                            ))}
                            {Object.entries(dcAmendDiff.diff.beams || {}).map(([sz, ch]) => (
                              <Fragment key={"b"+sz}>
                                <div style={{color:"#fff"}}>Beam {sz}ft</div>
                                <div style={{color:"#fff"}}>{ch.before}</div>
                                <div style={{color: ch.delta > 0 ? "#EF4444" : (ch.delta < 0 ? "#10B981" : "#fff")}}>{ch.after} ({ch.delta > 0 ? "+" : ""}{ch.delta})</div>
                              </Fragment>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={() => setDcAmendDiff(null)} style={{flex:1,padding:"8px 12px",fontSize:11,borderRadius:8,border:"1px solid "+textS,background:"transparent",color:"#fff",cursor:"pointer"}}>
                              Cancel
                            </button>
                            <button onClick={async () => {
                              // Submit amend: replace this client's hard entry with new totals; audit log added.
                              try {
                                let next = { ...trussAlloc };
                                const d = dcAmendDiff.date;
                                const entry = (next[d]?.events || []).find(ev => ev.clientId === dcAmendDiff.clientId);
                                if (entry) {
                                  entry.totalPillarsUsed = dcAmendDiff.after.totalPillarsUsed;
                                  entry.totalBeamsUsed   = dcAmendDiff.after.totalBeamsUsed;
                                  entry.trusses          = dcAmendDiff.after.trusses;
                                  entry.amendedAt        = Date.now();
                                  entry.amendedBy        = currentSalesperson;
                                  entry.amendReason      = dcAmendDiff.reason || "";
                                }
                                setTrussAlloc(next);
                                try { await reliableSave(TRUSS_ALLOC_SK, JSON.stringify(next)); } catch {}
                                showMsg("Amend submitted — IMS will recompute pool", "green");
                                setDcAmendDiff(null);
                              } catch (e) {
                                showMsg("Amend failed: " + (e?.message || "unknown"), "red");
                              }
                            }} style={{flex:2,padding:"8px 12px",fontSize:11,borderRadius:8,border:"none",background:"linear-gradient(135deg,#EF4444,#DC2626)",color:"#fff",fontWeight:700,cursor:"pointer"}}>
                              Submit Amend Request
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ── Summary banner ── */}
                      <div style={{padding:"12px 16px",borderRadius:10,background:"linear-gradient(135deg,rgba(99,102,241,0.10),rgba(99,102,241,0.04))",border:"1px solid rgba(99,102,241,0.25)"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:16}}>🏗️</span>
                            <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>Truss preview · {totalZonesShown} zone{totalZonesShown===1?"":"s"} across {fns.length} fn{fns.length===1?"":"s"}</span>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:14,fontSize:10,color:textS,flexWrap:"wrap"}}>
                          <div>Pillar RFT: <span style={{color:"#fff",fontWeight:600}}>{Math.round(grandPillarRft)}</span></div>
                          <div>Beam RFT: <span style={{color:"#fff",fontWeight:600}}>{Math.round(grandBeamRft)}</span></div>
                          <div>Batta RFT (with buffer): <span style={{color:"#fff",fontWeight:600}}>{Math.round(grandBattaRft)}</span></div>
                        </div>
                        {anyDefault && <div style={{marginTop:6,fontSize:10,color:"#F59E0B"}}>ℹ️ Some zones defaulted to Half Box (sales didn't pick) — review &amp; pick in Build to lock the type.</div>}
                        {anyShortage && <div style={{marginTop:4,fontSize:10,color:"#EF4444"}}>⚠️ One or more zones have invalid truss dimensions — fix in Build before SOLD.</div>}
                        <div style={{marginTop:6,fontSize:9,color:textS,fontStyle:"italic"}}>§23 Phase 3 active — Generate writes a 24h soft-hold to IMS; SOLD promotes to hard block.</div>
                      </div>

                      {/* ── Per-fn / per-zone cards ── */}
                      {previewsByFn.map(({ fn, previews }, fi) => (previews.length === 0 || fi !== (activeFnIdx || 0)) ? null : (
                        <div key={fi} style={{display:"flex",flexDirection:"column",gap:8}}>
                          <div style={{fontSize:11,fontWeight:600,color:textS,letterSpacing:0.4,textTransform:"uppercase",paddingLeft:4}}>
                            {fn?.fnType || `Function ${fi+1}`} · {fn?.fnDate || "—"} · {fn?.fnVenue || "—"}
                          </div>
                          {previews.map(({ zk, zLabel, pv }) => {
                            const isInvalid = pv.smartFlag === "red";
                            const topo = pv.topology;
                            const costs = pv.costs;
                            const batta = pv.batta;
                            const configLabel = pv.config === "u_only" ? "U Truss"
                                              : pv.config === "half_box" ? "Half Box"
                                              : pv.config === "full_box" ? "Full Box" : "—";
                            return (
                              <div key={zk} style={{padding:"12px 14px",borderRadius:9,background:isInvalid?"rgba(239,68,68,0.04)":"rgba(99,102,241,0.04)",border:`1px solid ${isInvalid?"rgba(239,68,68,0.30)":border}`}}>
                                {/* Header line */}
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                                  <div>
                                    <div style={{fontSize:13,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",gap:6}}>
                                      <span>{flagEmoji(pv.smartFlag)}</span>
                                      <span>{zLabel}</span>
                                      <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:5,background:"rgba(255,255,255,0.06)",color:flagColor(pv.smartFlag)}}>{configLabel}</span>
                                    </div>
                                    {topo && <div style={{fontSize:10,color:textS,marginTop:3}}>
                                      Method {topo.method} · {topo.pillarCount} pillar{topo.pillarCount===1?"":"s"} · {topo.beamCount} beam segment{topo.beamCount===1?"":"s"} · {topo.totals?.totalJoints || (topo.pillarCount + topo.beamCount - 1)} joint{((topo.totals?.totalJoints || 0))===1?"":"s"} expected
                                    </div>}
                                  </div>
                                </div>

                                {/* Invalid: show error, stop */}
                                {isInvalid && pv.warnings?.length > 0 && (
                                  <div style={{fontSize:11,color:"#FCA5A5",padding:"6px 10px",background:"rgba(239,68,68,0.08)",borderRadius:6}}>
                                    {pv.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                                  </div>
                                )}

                                {!isInvalid && topo && (
                                  <>
                                    {/* Dual dimensions */}
                                    <div style={{display:"flex",gap:12,marginBottom:8,fontSize:10}}>
                                      {(()=>{
                                        const zCfg = (fn.zoneConfig || {})[zk] || {};
                                        const dL = parseFloat(zCfg.dims?.L) || 0;
                                        const dW = parseFloat(zCfg.dims?.W) || 0;
                                        const dH = parseFloat(zCfg.dims?.H) || 0;
                                        const demanded = pv.config === "u_only" || pv.config === "half_box"
                                          ? `${pv.spanFt || Math.max(dL, dW)}L × ${dH}H ft`
                                          : `${dL}L × ${dW}W × ${dH}H ft`;
                                        const phyL = topo.physicalL ? Math.round(topo.physicalL * 100) / 100 : 0;
                                        const phyW = topo.physicalW ? Math.round(topo.physicalW * 100) / 100 : 0;
                                        const physical = pv.config === "u_only"
                                          ? `${phyL}L × ${dH}H ft`
                                          : `${phyL}L × ${phyW}W × ${dH}H ft`;
                                        return <>
                                          <div style={{flex:1,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6}}>
                                            <div style={{color:textS,marginBottom:2}}>Customer demand</div>
                                            <div style={{color:"#fff",fontWeight:600}}>{demanded}</div>
                                          </div>
                                          <div style={{flex:1,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6}}>
                                            <div style={{color:textS,marginBottom:2}}>Physical footprint</div>
                                            <div style={{color:"#fff",fontWeight:600}}>{physical}</div>
                                          </div>
                                        </>;
                                      })()}
                                    </div>

                                    {/* Structure breakdown */}
                                    <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                                      <div style={{flex:"1 1 200px",padding:"6px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6,fontSize:10}}>
                                        <div style={{color:textS,marginBottom:3,fontWeight:600}}>🏛️ Pillars ({topo.pillars.length})</div>
                                        <div style={{color:"#fff",lineHeight:1.5}}>
                                          {topo.pillars.length} × {topo.pillars[0]?.H || "?"}ft = {costs?.pillarRft || 0} RFT
                                        </div>
                                      </div>
                                      <div style={{flex:"1 1 200px",padding:"6px 10px",background:"rgba(255,255,255,0.02)",borderRadius:6,fontSize:10}}>
                                        <div style={{color:textS,marginBottom:3,fontWeight:600}}>🔗 Beams ({topo.beams.length})</div>
                                        <div style={{color:"#fff",lineHeight:1.5}}>
                                          {topo.beams.map((b, i) => <span key={i}>{b.side}: {Math.ceil(b.lengthFt)}ft{i<topo.beams.length-1?" · ":""}</span>)}
                                          <span style={{color:textS}}> ({costs?.beamRft || 0} RFT total)</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Per-zone Truss + Batta cost */}
                                    {costs && (
                                      <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
                                        <div style={{flex:"1 1 auto",display:"flex",gap:12,flexWrap:"wrap",fontSize:10,color:textS}}>
                                          {costs.pillarCost > 0 && <span>Pillars: <span style={{color:"#fff",fontWeight:600}}>₹{costs.pillarCost.toLocaleString("en-IN")}</span></span>}
                                          {costs.beamCost > 0 && <span>Beams: <span style={{color:"#fff",fontWeight:600}}>₹{costs.beamCost.toLocaleString("en-IN")}</span></span>}
                                          {costs.battaCost > 0 && <span>Batta: <span style={{color:"#fff",fontWeight:600}}>₹{costs.battaCost.toLocaleString("en-IN")}</span></span>}
                                        </div>
                                        {costs.actual > 0 && <div style={{fontSize:11,fontWeight:700,color:"#C9A96E"}}>Truss: ₹{costs.actual.toLocaleString("en-IN")}</div>}
                                      </div>
                                    )}

                                    {/* ── §23 Phase 2.9f — Fabric Allocation (Masking + Liza + Curtains) ── */}
                                    {(() => {
                                      const zCfg = (fn.zoneConfig || {})[zk] || {};
                                      // Resolve drape density from selected photo's library tag (Full Box only)
                                      const photoUrl = (fn.elSelectedPhoto || {})[zk];
                                      let density = "moderate";
                                      if (photoUrl) {
                                        const li = libItems.find(l => l.url === photoUrl);
                                        if (li?.dims?.drapeDensity) density = li.dims.drapeDensity;
                                      }
                                      const fab = calcZoneFabric(zCfg, trussInv, density);
                                      const showMasking = fab.maskingPieces > 0;
                                      const showLiza    = fab.lizaKg > 0;
                                      const showCurtain = fab.curtainPieces > 0;
                                      if (!showMasking && !showLiza && !showCurtain) return null;

                                      const fnPalette = fn.fnPalette || "Custom";
                                      const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                                      const anchors = pObj?.anchorColours || [];
                                      const fmkup = trussInv.fabricFreshMarkup || { liza:40, masking:40, curtain:40 };

                                      // Resolve allocations from zoneConfig — auto-fill if absent
                                      const resolveAlloc = (allocField, totalQty, stockArr, qtyField) => {
                                        const existing = zCfg[allocField];
                                        if (Array.isArray(existing) && existing.length > 0) return existing;
                                        return autoFillFabricAllocation(totalQty, anchors, stockArr, qtyField);
                                      };
                                      const maskingAlloc = showMasking ? resolveAlloc("maskingAllocation", fab.maskingPieces, trussInv.maskingStock, "stockPieces") : [];
                                      const lizaAlloc    = showLiza    ? resolveAlloc("lizaAllocation",    Math.ceil(fab.lizaKg),  trussInv.lizaStock,    "stockKg")     : [];
                                      const curtainAlloc = showCurtain ? resolveAlloc("curtainAllocation", fab.curtainPieces, trussInv.curtainStock, "stockPieces") : [];

                                      // Cost rollup (internal margin tracking — never shown to client)
                                      const maskingTotals = calcFabricAllocationTotal(maskingAlloc, trussInv.maskingStock, "stockPieces", trussInv.rates?.maskingPieceRate, trussInv.rates?.maskingPiecePurchase, fmkup.masking);
                                      const lizaTotals    = calcFabricAllocationTotal(lizaAlloc,    trussInv.lizaStock,    "stockKg",     trussInv.rates?.lizaKgRate,       trussInv.rates?.lizaKgPurchase,       fmkup.liza);
                                      const curtainTotals = calcFabricAllocationTotal(curtainAlloc, trussInv.curtainStock, "stockPieces", trussInv.rates?.curtainPieceRate, trussInv.rates?.curtainPiecePurchase, fmkup.curtain);

                                      const updateAllocOnZone = (allocField, newAllocs) => {
                                        // §23 Phase 2.9f — write allocation to zoneConfig of the relevant fn
                                        const isActiveFn = fn.fnIdx === activeFnIdx;
                                        const nextAlloc = (Array.isArray(newAllocs) && newAllocs.length > 0) ? newAllocs : null;
                                        if (isActiveFn) {
                                          setZoneConfig(prev => {
                                            const cur = prev[zk] || {};
                                            const updated = { ...cur };
                                            if (nextAlloc) updated[allocField] = nextAlloc; else delete updated[allocField];
                                            return { ...prev, [zk]: updated };
                                          });
                                        } else {
                                          // Inactive fn: update via fnBuilds snapshot
                                          setFnBuilds(prev => {
                                            const snap = prev[fn.fnIdx] || {};
                                            const curZc = snap.zoneConfig || {};
                                            const curZone = curZc[zk] || {};
                                            const nextZone = { ...curZone };
                                            if (nextAlloc) nextZone[allocField] = nextAlloc; else delete nextZone[allocField];
                                            return { ...prev, [fn.fnIdx]: { ...snap, zoneConfig: { ...curZc, [zk]: nextZone } } };
                                          });
                                        }
                                      };

                                      // Chip renderer for an allocation array
                                      const AllocChips = ({ allocs, unitLabel }) => (
                                        <span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>
                                          {allocs.map((a, i) => {
                                            const cObj = (imsColourCatalogue||[]).find(c => c.name === a.colour);
                                            return <span key={i} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"1px 6px",borderRadius:4,background:"rgba(255,255,255,0.06)",fontSize:10}}>
                                              <span style={{width:9,height:9,borderRadius:2,background:cObj?.hex||"#999",border:"1px solid rgba(255,255,255,0.2)"}} />
                                              <span style={{color:"#fff",fontWeight:600}}>{a.colour}</span>
                                              <span style={{color:textS}}>×{a.qty}{unitLabel}</span>
                                            </span>;
                                          })}
                                        </span>
                                      );

                                      const FabricRow = ({ emoji, label, qty, unitLabel, allocs, totals, fabricType, allocField, breakdown }) => {
                                        const shortQty = totals.totalShort || 0;
                                        const hasShort = shortQty > 0;
                                        const marginLoss = totals.freshCost || 0;
                                        return (
                                          <div style={{padding:"6px 10px",background:hasShort?"rgba(245,158,11,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${hasShort?"rgba(245,158,11,0.25)":"rgba(255,255,255,0.05)"}`,borderRadius:6,marginBottom:5}}>
                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                                              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                                                <span>{emoji}</span>
                                                <span style={{color:"#fff",fontWeight:600}}>{label}</span>
                                                <span style={{color:textS,fontSize:10}}>· {qty}{unitLabel} needed</span>
                                                {breakdown && <span style={{color:textS,fontSize:9,fontStyle:"italic"}}>({breakdown})</span>}
                                              </div>
                                              <button
                                                onClick={() => setFabricPickerTarget({ fnIdx: fn.fnIdx, zoneKey: zk, fabricType })}
                                                style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${border}`,background:"rgba(255,255,255,0.04)",color:"#fff",fontSize:10,cursor:"pointer",fontWeight:600}}>
                                                🎨 {allocs.length === 0 ? "Pick" : "Edit"}
                                              </button>
                                            </div>
                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                                              <AllocChips allocs={allocs} unitLabel={unitLabel} />
                                              {hasShort ? (
                                                <span style={{fontSize:10,color:"#F59E0B",whiteSpace:"nowrap",fontWeight:600}}>
                                                  ⚠️ {shortQty}{unitLabel} fresh · {fmtRs(totals.total)} <span style={{opacity:0.8,fontWeight:400}}>(incl. {fmtRs(marginLoss)} fresh)</span>
                                                </span>
                                              ) : allocs.length > 0 ? (
                                                <span style={{fontSize:10,color:"#10B981",whiteSpace:"nowrap"}}>✓ in stock · <span style={{color:"#fff",fontWeight:600}}>{fmtRs(totals.total)}</span> rental</span>
                                              ) : (
                                                <span style={{fontSize:10,color:textS,whiteSpace:"nowrap"}}>— not allocated</span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      };

                                      const fabricSubtotal = (showMasking ? (maskingTotals.total||0) : 0) + (showLiza ? (lizaTotals.total||0) : 0) + (showCurtain ? (curtainTotals.total||0) : 0);
                                      return (
                                        <div style={{marginTop:8,padding:"8px 10px",background:"rgba(99,102,241,0.04)",border:`1px dashed ${border}`,borderRadius:6}}>
                                          <div style={{fontSize:10,fontWeight:700,color:textS,letterSpacing:0.5,textTransform:"uppercase",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                                            <span style={{display:"flex",alignItems:"center",gap:6}}>
                                              <span>🧵 Fabric Allocation</span>
                                              <span style={{fontSize:8,fontWeight:500,color:textS,textTransform:"none",letterSpacing:0,fontStyle:"italic"}}>(rental — charged under truss cost)</span>
                                            </span>
                                            {fabricSubtotal > 0 && <span style={{fontSize:10,fontWeight:700,color:"#A5B4FC",textTransform:"none",letterSpacing:0}}>Fabric: {fmtRs(fabricSubtotal)}</span>}
                                          </div>
                                          {showMasking && <FabricRow
                                            emoji="🧱" label="Wall Masking" qty={fab.maskingPieces} unitLabel="pc"
                                            allocs={maskingAlloc} totals={maskingTotals} fabricType="masking" allocField="maskingAllocation"
                                            breakdown={`RFT ${Math.round((fab.maskL || 0) + 2*(fab.maskW || 0))} ÷ 13`}
                                          />}
                                          {showLiza && <FabricRow
                                            emoji="🪡" label="Liza" qty={fab.lizaKg} unitLabel="kg"
                                            allocs={lizaAlloc} totals={lizaTotals} fabricType="liza" allocField="lizaAllocation"
                                            breakdown={fab.lizaModel === "wrap+ceiling" ? `wrap ${fab.lizaWrapKg}kg + ceiling ${fab.lizaCeilingKg}kg (${density})` : `wrap only`}
                                          />}
                                          {showCurtain && <FabricRow
                                            emoji="🎀" label="Velvet Curtains" qty={fab.curtainPieces} unitLabel="pc"
                                            allocs={curtainAlloc} totals={curtainTotals} fabricType="curtain" allocField="curtainAllocation"
                                            breakdown={`${fab.curtainPillarCount || fab.pillarCount} ${fab.curtainPillarCount && fab.curtainPillarCount < fab.pillarCount ? "front " : ""}pillars × ${(zCfg.curtainsPerPillar || 4)} curtains/pillar`}
                                          />}
                                        </div>
                                      );
                                    })()}

                                    {/* Warnings (non-fatal) */}
                                    {pv.warnings?.length > 0 && (
                                      <div style={{marginTop:6,fontSize:10,color:"#F59E0B"}}>
                                        {pv.warnings.map((w, i) => <div key={i}>ℹ️ {w}</div>)}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* ── Fabric Breakdown for the selected function (per-function; all-function total is the bottom TRUSS chip) ── */}
                      {(() => {
                        // Aggregate fabric needs and allocations for the ACTIVE function only
                        const agg = {
                          masking: { qty: 0, byColour: {}, shortQty: 0, marginLoss: 0, rentalTotal: 0 },
                          liza:    { qty: 0, byColour: {}, shortQty: 0, marginLoss: 0, rentalTotal: 0 },
                          curtain: { qty: 0, byColour: {}, shortQty: 0, marginLoss: 0, rentalTotal: 0 },
                        };
                        const fmkup = trussInv.fabricFreshMarkup || { liza:40, masking:40, curtain:40 };
                        previewsByFn.filter((_, fi) => fi === (activeFnIdx || 0)).forEach(({ fn, previews }) => {
                          const fnPalette = fn.fnPalette || "Custom";
                          const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                          const anchors = pObj?.anchorColours || [];
                          previews.forEach(({ zk }) => {
                            const zCfg = (fn.zoneConfig || {})[zk] || {};
                            const photoUrl = (fn.elSelectedPhoto || {})[zk];
                            let density = "moderate";
                            if (photoUrl) {
                              const li = libItems.find(l => l.url === photoUrl);
                              if (li?.dims?.drapeDensity) density = li.dims.drapeDensity;
                            }
                            const fab = calcZoneFabric(zCfg, trussInv, density);
                            const accumulate = (key, totalQty, stockArr, qtyField, allocField, rentalKey, purchaseKey, markupKey) => {
                              if (!totalQty || totalQty <= 0) return;
                              const existing = zCfg[allocField];
                              const allocs = (Array.isArray(existing) && existing.length > 0)
                                ? existing
                                : autoFillFabricAllocation(Math.ceil(totalQty), anchors, stockArr, qtyField);
                              agg[key].qty += Math.ceil(totalQty);
                              const totals = calcFabricAllocationTotal(allocs, stockArr, qtyField, trussInv.rates?.[rentalKey], trussInv.rates?.[purchaseKey], fmkup[markupKey]);
                              agg[key].shortQty   += totals.totalShort || 0;
                              agg[key].marginLoss += totals.freshCost  || 0;
                              agg[key].rentalTotal += totals.total || 0;
                              allocs.forEach(a => {
                                agg[key].byColour[a.colour] = (agg[key].byColour[a.colour] || 0) + (Number(a.qty)||0);
                              });
                            };
                            accumulate("masking", fab.maskingPieces, trussInv.maskingStock, "stockPieces", "maskingAllocation", "maskingPieceRate", "maskingPiecePurchase", "masking");
                            accumulate("liza",    fab.lizaKg,         trussInv.lizaStock,    "stockKg",     "lizaAllocation",    "lizaKgRate",       "lizaKgPurchase",       "liza");
                            accumulate("curtain", fab.curtainPieces,  trussInv.curtainStock, "stockPieces", "curtainAllocation", "curtainPieceRate", "curtainPiecePurchase", "curtain");
                          });
                        });
                        const totalQty = agg.masking.qty + agg.liza.qty + agg.curtain.qty;
                        if (totalQty === 0) return null;
                        const totalMarginLoss = agg.masking.marginLoss + agg.liza.marginLoss + agg.curtain.marginLoss;
                        const totalFabricCost = agg.masking.rentalTotal + agg.liza.rentalTotal + agg.curtain.rentalTotal;
                        const SummaryRow = ({ emoji, label, data, unit }) => {
                          if (!data.qty) return null;
                          const colourStrs = Object.entries(data.byColour).map(([c, q]) => `${c} ${q}${unit}`).join(" · ");
                          return (
                            <div style={{padding:"7px 12px",background:"rgba(255,255,255,0.03)",borderRadius:6,marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,flex:"1 1 200px",minWidth:0}}>
                                <span style={{fontSize:14}}>{emoji}</span>
                                <span style={{fontSize:11,color:"#fff",fontWeight:600}}>{label}: {data.qty}{unit}</span>
                                <span style={{fontSize:10,color:textS,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>({colourStrs || "none allocated"})</span>
                              </div>
                              {data.shortQty > 0 ? (
                                <span style={{fontSize:10,color:"#F59E0B",fontWeight:700,whiteSpace:"nowrap"}}>
                                  {fmtRs(data.rentalTotal)} · ⚠️ {data.shortQty}{unit} fresh
                                </span>
                              ) : (
                                <span style={{fontSize:10,color:"#10B981",whiteSpace:"nowrap"}}>{fmtRs(data.rentalTotal)} · ✓ in stock</span>
                              )}
                            </div>
                          );
                        };
                        return (
                          <div style={{padding:"12px 14px",borderRadius:9,background:"linear-gradient(135deg,rgba(139,92,246,0.10),rgba(139,92,246,0.03))",border:"1px solid rgba(139,92,246,0.25)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:16}}>📊</span>
                                <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{(fns[activeFnIdx || 0]?.fnType || "Function")} — Fabric Breakdown</span>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:9,color:textS}}>Fabric rental (charged under truss)</div>
                                <div style={{fontSize:15,fontWeight:700,color:"#A5B4FC"}}>{fmtRs(totalFabricCost)}</div>
                                {totalMarginLoss > 0 && <div style={{fontSize:9,color:"#F59E0B",fontWeight:600}}>incl. {fmtRs(totalMarginLoss)} fresh stock</div>}
                              </div>
                            </div>
                            <SummaryRow emoji="🧱" label="Wall Masking" data={agg.masking} unit="pc" />
                            <SummaryRow emoji="🪡" label="Liza"          data={agg.liza}    unit="kg" />
                            <SummaryRow emoji="🎀" label="Velvet Curtains" data={agg.curtain} unit="pc" />
                            <div style={{marginTop:6,fontSize:9,color:textS,fontStyle:"italic"}}>
                              This function only. Client pays one truss rate (fabric not itemised to client); internally fabric rental is charged under truss cost. Fresh stock (shortage) adds margin impact. All-functions total is in the bottom TRUSS chip. IMS auto-POs any shortage at SOLD.
                            </div>
                          </div>
                        );
                      })()}
                      {/* ── Function-wise Truss / Batta / Fabric total — at the END of the truss tab ── */}
                      {(()=>{
                        const active = previewsByFn[activeFnIdx || 0];
                        if (!active || active.previews.length === 0) return null;
                        const { fn, previews } = active;
                        const fnPalette = fn.fnPalette || "Custom";
                        const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                        const anchors = pObj?.anchorColours || [];
                        let trussStruct = 0, battaC = 0, fabricC = 0;
                        previews.forEach(({ zk, pv }) => {
                          if (pv?.costs) {
                            battaC += pv.costs.battaCost || 0;
                            trussStruct += (pv.costs.actual || 0) - (pv.costs.battaCost || 0);
                          }
                          const zCfg = (fn.zoneConfig || {})[zk];
                          const photoUrl = (fn.elSelectedPhoto || {})[zk];
                          let density = "moderate";
                          if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                          fabricC += calcZoneFabricCost(zCfg, trussInv, anchors, density);
                        });
                        const grand = trussStruct + battaC + fabricC;
                        if (grand <= 0) return null;
                        const Card = ({ label, value, accentColour }) => (
                          <div style={{flex:"1 1 80px",padding:"8px 10px",borderRadius:6,background:accentColour?"rgba(16,185,129,0.10)":"rgba(255,255,255,0.03)",textAlign:"center"}}>
                            <div style={{fontSize:9,color:textS,marginBottom:2}}>{label}</div>
                            <div style={{fontSize:15,fontWeight:700,color:accentColour||"#fff"}}>{fmtRs(value)}</div>
                          </div>
                        );
                        return (
                          <div style={{marginTop:2,padding:"11px 14px",borderRadius:9,background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.35)"}}>
                            <div style={{fontSize:10,fontWeight:700,color:textS,letterSpacing:0.4,textTransform:"uppercase",marginBottom:7}}>{fn?.fnType || "Function"} — Truss Cost Total</div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                              <Card label="🏗️ Truss" value={trussStruct} />
                              <Card label="🎗️ Batta" value={battaC} />
                              <Card label="🪡 Fabric" value={fabricC} accentColour="#A5B4FC" />
                              <Card label="Total" value={grand} accentColour="#10B981" />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}</>);
}

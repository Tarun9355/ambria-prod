import { Fragment } from "react";
import { calcZoneFabric, autoFillFabricAllocation, calcFabricAllocationTotal } from "../../../../lib/studio/pricing";
import { TRUSS_ALLOC_SK } from "../../../../lib/studio/keys.js";
import { supabase } from "../../../../lib/supabase";

export default function DCTrussTab({ ctx }) {
  const {
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
    // fold state — shared with the overlay so a zone stays as you left it across tab switches.
    // Keys here are prefixed "truss:" so they cannot collide with the overlay's own `fnIdx|zk`.
    dcCollapsedZones, setDcCollapsedZones,
    // persistence + misc
    reliableSave, showMsg,
  } = ctx;

  return (<>{(() => {
                  // ═══ §23 PHASE 2 — TRUSS TAB BODY ═══
                  // Per-fn / per-zone preview using Layer 0 + Layer 1 + cost calc.
                  // §23 Phase 3 (26 May 2026) — adds reservation status banner showing
                  // soft-hold / hard-block state per fn date + held-by-other warnings.
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:"#5A6076",fontSize:13,lineHeight:1.6}}>No functions configured yet.</div>;
                  const trussInv = dealCheckData?.trussInv;
                  if (!trussInv) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:"#5A6076",fontSize:13,lineHeight:1.6}}>
                      <div style={{fontSize:32,marginBottom:10}}>🏗️</div>
                      <div style={{fontSize:15,color:"#B45309",fontWeight:700,letterSpacing:-0.15,marginBottom:6}}>IMS Truss Inventory not loaded</div>
                      <div>Ask Ops to fill Settings → Truss &amp; Batta in IMS, then close + reopen Deal Check.</div>
                    </div>;
                  }

                  // Helper — list of zones present in a fn (uses fn.zoneConfig + fn.enabledEls)
                  const zonesOf = (fn) => {
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    return Object.keys(zc).filter(zk => en[zk] && zc[zk]);
                  };

                  // §23 Phase 3 — resolve reservation state for THIS client on the SELECTED fn date.
                  // States we render:
                  //   "free"        — no entry yet, will be created on next Generate
                  //   "soft-own"    — my soft hold present, expires at X
                  //   "soft-other"  — someone else's soft hold (read indicator only)
                  //   "hard"        — locked permanent block (post-SOLD)
                  //   "hard-amend"  — SOLD event being edited; diff vs current allocation
                  // Active fn only. Every other section of this tab is already scoped to the
                  // selected function (zone cards, cost total), so listing all three dates here
                  // put two cards on screen that said nothing about the fn you had open, and the
                  // Generate button they talk about only ever acts on the selected one.
                  const currentClientId = activeClientId || "";
                  const currentSalesperson = (typeof authUser !== "undefined" ? authUser?.name : "") || "—";
                  const reservationByDate = {};
                  const heldByOthersByDate = {};
                  const activeFnForRes = fns[activeFnIdx || 0] || fns[0];
                  const activeResDate = activeFnForRes?.fnDate || clientDate || "";
                  if (activeResDate) {
                    const d = activeResDate;
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
                  }

                  // Tally totals across all fns
                  let grandActual = 0, grandU = 0, grandBox = 0, grandPillarRft = 0, grandBeamRft = 0, grandBattaRft = 0, anyShortage = false, anyDefault = false;
                  const previewsByFn = fns.map(fn => {
                    const zones = zonesOf(fn);
                    // A zone can carry more than one truss structure (row 0 = the zone's own scalar
                    // fields, plus any zCfg.extraTrussRows added via "+ Add Truss" in Build) — one
                    // preview card per row, not per zone.
                    const previews = zones.flatMap(zk => {
                      const zCfg = (fn.zoneConfig || {})[zk];
                      const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                      const rows = [zCfg, ...(zCfg.extraTrussRows || [])];
                      return rows.map((row, rowIdx) => {
                        const pv = calcZoneTrussPreview(row, trussInv);
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
                        return { zk, zLabel: rowIdx > 0 ? `${zLabel} (truss #${rowIdx + 1})` : zLabel, pv, row, rowIdx };
                      });
                    }).filter(x => x.pv && x.pv.source !== "none");
                    return { fn, previews };
                  });

                  const totalZonesShown = previewsByFn.reduce((s, x) => s + x.previews.length, 0);
                  if (totalZonesShown === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:"#5A6076",fontSize:13,lineHeight:1.6}}>
                      <div style={{fontSize:32,marginBottom:10}}>🏗️</div>
                      <div style={{fontSize:15,color:"#1A1A2E",fontWeight:700,letterSpacing:-0.15,marginBottom:5}}>No truss configured in any zone.</div>
                      <div>Add Truss Width/Depth/Height dimensions in Build → any zone to see preview here.</div>
                    </div>;
                  }

                  const fmtRs = (n) => n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "₹0";
                  const flagColor = (flag) => flag === "green" ? "#10B981" : flag === "yellow" ? "#F59E0B" : "#EF4444";
                  // "6 × 10ft", or "4 × 19ft · 2 × 14ft" when the pieces are not all one length.
                  // Beams used to be listed one per side, which ran to six labelled entries for a
                  // box and buried the count. Grouping reads the same way as the pillar line.
                  // Exact lengths, not ceil'd: a beam is 18.75ft, and showing 19 made the row
                  // disagree with its own total (6 × 19 = 114, but the beams are 112.5 RFT).
                  const groupByLen = (arr, get) => Object.entries(
                    (arr || []).reduce((m, x) => {
                      const len = Math.round((get(x) || 0) * 100) / 100;
                      m[len] = (m[len] || 0) + 1;
                      return m;
                    }, {})
                  ).sort((a, b) => Number(b[0]) - Number(a[0]))
                   .map(([len, n]) => `${n} × ${len}ft`).join(" · ");
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

                  // Deal Check sits on a wedding-artwork ground, so translucent tints let the
                  // artwork bleed through and washed the status text out. Same answer as Florals:
                  // opaque white card, state colour carried by the left stripe instead of the fill.
                  // Every surface below is an opaque hex, never an rgba tint — a translucent fill
                  // reads as a different colour on each event type's artwork, and nested tints
                  // compounded until the innermost rows were unreadable. Three depths only:
                  // white card → grey tile → chip.
                  const CARD_SHADOW = "0 1px 2px rgba(26,26,46,0.06), 0 4px 12px rgba(26,26,46,0.06)";
                  const CARD_BG     = "#FFFFFF";
                  const CARD_BORDER = "#E4E6EA";
                  const TILE_BG     = "#F5F6F8";
                  const CHIP_BG     = "#EBEDF2";

                  // Three ink levels. Everything on this tab had been flattened to a single
                  // #1A1A2E, so a caption carried the same weight as the number it described and
                  // nothing led the eye. INK is for values and titles, INK_2 for the labels that
                  // name them, INK_3 for footnotes you read once. Both greys clear 4.5:1 on white.
                  const INK   = "#1A1A2E";
                  const INK_2 = "#5A6076";
                  const INK_3 = "#7C8296";
                  // Money and RFT figures are read in columns and compared against each other, so
                  // they need fixed-width digits — proportional digits make ₹1,328 and ₹2,888
                  // visibly different widths and the column stops lining up.
                  const NUM = { fontVariantNumeric: "tabular-nums" };

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {/* Hover lives here because inline styles cannot express :hover. The shadow
                          rules carry !important — the element sets boxShadow inline, and an inline
                          property beats a stylesheet rule without it. Filter-based darkening is
                          used for the buttons instead, so one rule works on every base colour.
                          Hover is only attached to things you can actually act on, or to a card
                          that contains one; static tiles stay inert so hover still means something. */}
                      <style>{`
.dct-card{transition:box-shadow .18s ease,border-color .18s ease}
.dct-card:hover{box-shadow:0 2px 6px rgba(26,26,46,.09),0 10px 26px rgba(26,26,46,.11) !important}
.dct-row{transition:box-shadow .18s ease,transform .18s ease}
.dct-row:hover{box-shadow:0 2px 6px rgba(26,26,46,.10),0 8px 20px rgba(26,26,46,.10) !important;transform:translateY(-1px)}
.dct-btn{transition:filter .15s ease,transform .12s ease}
.dct-btn:hover{filter:brightness(.94)}
.dct-btn:active{transform:translateY(1px)}
.dct-submit{transition:filter .15s ease,transform .12s ease}
.dct-submit:hover{filter:brightness(1.08)}
.dct-submit:active{transform:translateY(1px)}
.dct-tile{transition:filter .15s ease,transform .15s ease}
.dct-tile:hover{filter:brightness(.975);transform:translateY(-1px)}
.dct-fold{transition:opacity .15s ease}
.dct-fold:hover{opacity:.72}
`}</style>
                      {/* Status + summary cards run two-up. Flex-wrap rather than grid, so they
                          stack on a tablet without a media query and an odd trailing card grows
                          to fill its row instead of leaving a half-width hole. */}
                      <div style={{display:"flex",flexWrap:"wrap",gap:14}}>
                      {/* §23 Phase 3 — Reservation Status banner(s), one per date */}
                      {Object.entries(reservationByDate).map(([d, res]) => {
                        const others = heldByOthersByDate[d] || [];
                        // Build content per state
                        let label, sublabel, accentColor, borderColor, icon;
                        if (res.state === "free") {
                          label = "Truss not reserved yet on " + d;
                          sublabel = "Click Generate to soft-hold inventory for 24 hours.";
                          accentColor = "#6B7280";
                          borderColor = "#E4E6EA";
                          icon = "📐";
                        } else if (res.state === "soft-own") {
                          const ev = res.entry;
                          const ttotal = Object.values(ev.totalPillarsUsed || {}).reduce((s,n)=>s+n,0);
                          const btotal = Object.values(ev.totalBeamsUsed || {}).reduce((s,n)=>s+n,0);
                          label = `✅ Reserved on ${d} · ${fmtExpiry(ev.expiry)}`;
                          sublabel = `${ttotal} pillar piece(s) + ${btotal} beam piece(s) held in your name. Re-Generate to refresh expiry.`;
                          accentColor = "#10B981";
                          borderColor = "#CDEBDF";
                          icon = "🔒";
                        } else if (res.state === "soft-other") {
                          const ev = res.entry;
                          label = `⚠️ Held by ${ev.heldBy} · ${fmtExpiry(ev.expiry)}`;
                          sublabel = "Another salesperson has soft-reserved truss inventory under this client name. Contact them or wait for expiry.";
                          accentColor = "#F59E0B";
                          borderColor = "#F4E2C0";
                          icon = "⏳";
                        } else if (res.state === "hard") {
                          const ev = res.entry;
                          const ttotal = Object.values(ev.totalPillarsUsed || {}).reduce((s,n)=>s+n,0);
                          const btotal = Object.values(ev.totalBeamsUsed || {}).reduce((s,n)=>s+n,0);
                          label = `🔒 Confirmed on ${d} · ${ttotal} pillars + ${btotal} beams`;
                          sublabel = "This event is SOLD. Edits will create an Amend request.";
                          accentColor = "#6366F1";
                          borderColor = "#D6D8F7";
                          icon = "🎉";
                        }
                        return (
                          <div key={d} className="dct-card" style={{flex:"1 1 calc(50% - 7px)",minWidth:280,padding:"11px 15px",borderRadius:10,background:CARD_BG,border:`1px solid ${borderColor}`,borderLeft:`4px solid ${accentColor}`,boxShadow:CARD_SHADOW}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:15}}>{icon}</span>
                                <span style={{fontSize:14,fontWeight:700,letterSpacing:-0.1,color:INK}}>{label}</span>
                              </div>
                              {others.length > 0 && (
                                <div style={{fontSize:11,fontWeight:600,color:"#B45309"}}>
                                  +{others.length} other event{others.length===1?"":"s"} on same date
                                </div>
                              )}
                            </div>
                            <div style={{marginTop:5,fontSize:12,lineHeight:1.5,color:INK_2}}>{sublabel}</div>
                            {/* Show stock pressure indicator: who else holds what */}
                            {others.length > 0 && (() => {
                              const summary = others.map(o => `${o.heldBy || "—"} (${Object.values(o.totalPillarsUsed||{}).reduce((s,n)=>s+n,0)}P+${Object.values(o.totalBeamsUsed||{}).reduce((s,n)=>s+n,0)}B${o.state==="hard"?", SOLD":""})`).join(" · ");
                              return <div style={{marginTop:4,fontSize:11,lineHeight:1.5,color:INK_3,fontStyle:"italic"}}>Same-date pool: {summary}</div>;
                            })()}
                          </div>
                        );
                      })}

                      {/* §23 Phase 3 — Amend mode pending diff banner */}
                      {dcAmendDiff && (
                        <div className="dct-card" style={{flex:"1 1 100%",padding:"12px 16px",borderRadius:10,background:CARD_BG,border:"1px solid #F3CFCF",borderLeft:"4px solid #EF4444",boxShadow:CARD_SHADOW}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                            <span style={{fontSize:16}}>📝</span>
                            <span style={{fontSize:15,fontWeight:700,letterSpacing:-0.15,color:INK}}>Amend request preview · {dcAmendDiff.date}</span>
                          </div>
                          <div style={{fontSize:12,lineHeight:1.5,color:INK_2,marginBottom:8}}>
                            This event is already SOLD. Submitting will update the truss block and create an audit log entry.
                          </div>
                          {/* Columns sized to content and packed left. On 1fr they stretched to the
                              full card width, which threw the Before and After figures so far apart
                              you could not read a row as one line. */}
                          <div style={{display:"grid",gridTemplateColumns:"repeat(3, max-content)",justifyContent:"start",rowGap:5,columnGap:22,fontSize:12,marginBottom:10}}>
                            <div style={{color:INK_2,fontWeight:700,fontSize:10.5,letterSpacing:0.7,textTransform:"uppercase"}}>Resource</div>
                            <div style={{color:INK_2,fontWeight:700,fontSize:10.5,letterSpacing:0.7,textTransform:"uppercase"}}>Before</div>
                            <div style={{color:INK_2,fontWeight:700,fontSize:10.5,letterSpacing:0.7,textTransform:"uppercase"}}>After (Δ)</div>
                            {Object.entries(dcAmendDiff.diff.pillars || {}).map(([sz, ch]) => (
                              <Fragment key={"p"+sz}>
                                <div style={{color:INK_2}}>Pillar {sz}ft</div>
                                <div style={{...NUM,color:INK}}>{ch.before}</div>
                                <div style={{...NUM,fontWeight:600,color: ch.delta > 0 ? "#DC2626" : (ch.delta < 0 ? "#059669" : INK)}}>{ch.after} ({ch.delta > 0 ? "+" : ""}{ch.delta})</div>
                              </Fragment>
                            ))}
                            {Object.entries(dcAmendDiff.diff.beams || {}).map(([sz, ch]) => (
                              <Fragment key={"b"+sz}>
                                <div style={{color:INK_2}}>Beam {sz}ft</div>
                                <div style={{...NUM,color:INK}}>{ch.before}</div>
                                <div style={{...NUM,fontWeight:600,color: ch.delta > 0 ? "#DC2626" : (ch.delta < 0 ? "#059669" : INK)}}>{ch.after} ({ch.delta > 0 ? "+" : ""}{ch.delta})</div>
                              </Fragment>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={() => setDcAmendDiff(null)} className="dct-btn" style={{flex:1,padding:"8px 12px",fontSize:13,fontWeight:600,borderRadius:8,border:"1px solid #D3D7DF",background:TILE_BG,color:INK,cursor:"pointer"}}>
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
                                // Write the amended date row to the shared truss_allocations TABLE (off the blob).
                                try { const e = next[d] || {}; const { date: _d, events: _e, ...pool } = e; await supabase.from("truss_allocations").upsert({ date: d, events: e.events || [], pool }, { onConflict: "date" }); } catch {}
                                showMsg("Amend submitted — IMS will recompute pool", "green");
                                setDcAmendDiff(null);
                              } catch (e) {
                                showMsg("Amend failed: " + (e?.message || "unknown"), "red");
                              }
                            }} className="dct-submit" style={{flex:2,padding:"8px 12px",fontSize:13,borderRadius:8,border:"none",background:"linear-gradient(135deg,#EF4444,#DC2626)",color:"#FFFFFF",fontWeight:700,cursor:"pointer"}}>
                              Submit Amend Request
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ── Summary banner ── */}
                      <div className="dct-card" style={{flex:"1 1 calc(50% - 7px)",minWidth:280,padding:"12px 16px",borderRadius:10,background:CARD_BG,border:"1px solid #D6D8F7",borderLeft:"4px solid #6366F1",boxShadow:CARD_SHADOW}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:16}}>🏗️</span>
                            <span style={{fontSize:15,fontWeight:700,letterSpacing:-0.15,color:INK}}>Truss preview · {totalZonesShown} zone{totalZonesShown===1?"":"s"} across {fns.length} fn{fns.length===1?"":"s"}</span>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:16,fontSize:12,color:INK_2,flexWrap:"wrap"}}>
                          <div>Pillar RFT: <span style={{...NUM,color:INK,fontWeight:700}}>{Math.round(grandPillarRft)}</span></div>
                          <div>Beam RFT: <span style={{...NUM,color:INK,fontWeight:700}}>{Math.round(grandBeamRft)}</span></div>
                          <div>Batta RFT (with buffer): <span style={{...NUM,color:INK,fontWeight:700}}>{Math.round(grandBattaRft)}</span></div>
                        </div>
                        {anyDefault && <div style={{marginTop:6,fontSize:12,lineHeight:1.5,color:"#B45309"}}>ℹ️ Some zones defaulted to Half Box (sales didn't pick) — review &amp; pick in Build to lock the type.</div>}
                        {anyShortage && <div style={{marginTop:4,fontSize:12,lineHeight:1.5,color:"#DC2626"}}>⚠️ One or more zones have invalid truss dimensions — fix in Build before SOLD.</div>}
                        <div style={{marginTop:6,fontSize:11,lineHeight:1.5,color:INK_3,fontStyle:"italic"}}>§23 Phase 3 active — Generate writes a 24h soft-hold to IMS; SOLD promotes to hard block.</div>
                      </div>
                      </div>

                      {/* ── Per-fn / per-zone cards ── */}
                      {previewsByFn.map(({ fn, previews }, fi) => {
                        if (previews.length === 0 || fi !== (activeFnIdx || 0)) return null;
                        // Function total, on the zone panel header rather than in a panel of its
                        // own. Same sum the old Truss Cost Total card showed — per-zone truss
                        // (which already carries batta) plus that zone's fabric rental — but the
                        // per-part figures now sit on the tiles they belong to, so a whole card
                        // just to repeat them was holding a band of empty space.
                        const fnPalette = fn.fnPalette || "Custom";
                        const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                        const anchors = pObj?.anchorColours || [];
                        let fnGrand = 0;
                        previews.forEach(({ zk, pv }) => {
                          fnGrand += pv?.costs?.actual || 0;
                          const zCfg = (fn.zoneConfig || {})[zk];
                          const photoUrl = (fn.elSelectedPhoto || {})[zk];
                          let density = "moderate";
                          if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                          fnGrand += calcZoneFabricCost(zCfg, trussInv, anchors, density);
                        });
                        return (
                        <div key={fi} style={{display:"flex",flexDirection:"column",gap:10}}>
                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,flexWrap:"wrap",paddingLeft:4,paddingRight:2}}>
                            <div style={{fontSize:11,fontWeight:700,color:INK_2,letterSpacing:0.7,textTransform:"uppercase"}}>
                              {fn?.fnType || `Function ${fi+1}`} · {fn?.fnDate || "—"} · {fn?.fnVenue || "—"}
                            </div>
                            {fnGrand > 0 && (
                              <div style={{display:"flex",alignItems:"baseline",gap:7}}>
                                <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2}}>Truss total</span>
                                <span style={{...NUM,fontSize:16,fontWeight:700,letterSpacing:-0.3,color:"#059669"}}>{fmtRs(fnGrand)}</span>
                              </div>
                            )}
                          </div>
                          {previews.map(({ zk, zLabel, pv, row, rowIdx }) => {
                            const isInvalid = pv.smartFlag === "red";
                            const topo = pv.topology;
                            const costs = pv.costs;
                            const batta = pv.batta;
                            const configLabel = pv.config === "u_only" ? "U Truss"
                                              : pv.config === "half_box" ? "Half Box"
                                              : pv.config === "full_box" ? "Full Box" : "—";
                            // ── COLLAPSIBLE, same pattern as the Florals lists ──
                            // A zone is a tall block — dimensions, structure, per-zone cost and a
                            // fabric allocation table — and a fn can carry several. Folding lets you
                            // scan the zones you have without scrolling past the one you opened.
                            // Nothing is lost when shut: the flag, the config and the zone's truss
                            // cost all live on the header. Keyed into dcCollapsedZones so the state
                            // survives a tab switch, and OPEN is the default — this is the working
                            // view, it should not start hidden.
                            const foldKey = `truss:${fn.fnIdx}|${zk}|${rowIdx}`;
                            const zoneOpen = (dcCollapsedZones || {})[foldKey] !== true;
                            const toggleZone = () => setDcCollapsedZones?.(p => ({ ...p, [foldKey]: zoneOpen }));
                            return (
                              <div key={zk + "-" + rowIdx} className="dct-card" style={{padding:"14px 16px",borderRadius:9,background:CARD_BG,border:`1px solid ${isInvalid?"#F3CFCF":CARD_BORDER}`,borderLeft:`4px solid ${flagColor(pv.smartFlag)}`,boxShadow:CARD_SHADOW}}>
                                {/* Header line — the fold control */}
                                <button type="button" className="dct-fold"
                                  onClick={toggleZone}
                                  aria-expanded={zoneOpen}
                                  title={zoneOpen ? "Collapse this zone" : "Expand this zone"}
                                  style={{width:"100%",display:"flex",alignItems:"flex-start",gap:10,marginBottom:zoneOpen?12:0,
                                    padding:0,border:"none",background:"transparent",cursor:"pointer",textAlign:"left",font:"inherit"}}>
                                  <span style={{fontSize:14,lineHeight:1,marginTop:3,color:flagColor(pv.smartFlag),display:"inline-block",flexShrink:0,
                                    transform:zoneOpen?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▸</span>
                                  <div style={{minWidth:0,flex:"1 1 auto"}}>
                                    <div style={{fontSize:15,fontWeight:700,letterSpacing:-0.15,color:INK,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                                      <span>{flagEmoji(pv.smartFlag)}</span>
                                      <span>{zLabel}</span>
                                      <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"2px 8px",borderRadius:5,background:CHIP_BG,color:flagColor(pv.smartFlag)}}>{configLabel}</span>
                                    </div>
                                    {topo && <div style={{fontSize:12,lineHeight:1.5,color:INK_2,marginTop:5}}>
                                      Method {topo.method} · {topo.pillarCount} pillar{topo.pillarCount===1?"":"s"} · {topo.beamCount} beam segment{topo.beamCount===1?"":"s"} · {topo.totals?.totalJoints || (topo.pillarCount + topo.beamCount - 1)} joint{((topo.totals?.totalJoints || 0))===1?"":"s"} expected
                                    </div>}
                                  </div>
                                  {costs?.actual > 0 && (
                                    <span style={{...NUM,marginLeft:"auto",marginTop:2,fontSize:13.5,fontWeight:700,color:"#8A6A32",whiteSpace:"nowrap",flexShrink:0}}>
                                      ₹{costs.actual.toLocaleString("en-IN")}
                                    </span>
                                  )}
                                </button>

                                {zoneOpen && (<>
                                {/* Invalid: show error, stop */}
                                {isInvalid && pv.warnings?.length > 0 && (
                                  <div style={{fontSize:13,color:"#B91C1C",padding:"6px 10px",background:"#FDECEC",borderRadius:6}}>
                                    {pv.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                                  </div>
                                )}

                                {!isInvalid && topo && (
                                  <>
                                    {/* Dual dimensions */}
                                    <div style={{display:"flex",gap:10,marginBottom:10,fontSize:12,flexWrap:"wrap"}}>
                                      {(()=>{
                                        const dL = parseFloat(row.dims?.L) || 0;
                                        const dW = parseFloat(row.dims?.W) || 0;
                                        const dH = parseFloat(row.dims?.H) || 0;
                                        const demanded = pv.config === "u_only" || pv.config === "half_box"
                                          ? `${pv.spanFt || Math.max(dL, dW)}W × ${dH}H ft`
                                          : `${dW}W × ${dL}D × ${dH}H ft`;
                                        const phyL = topo.physicalL ? Math.round(topo.physicalL * 100) / 100 : 0;
                                        const phyW = topo.physicalW ? Math.round(topo.physicalW * 100) / 100 : 0;
                                        const physical = pv.config === "u_only"
                                          ? `${phyL}W × ${dH}H ft`
                                          : `${phyW}W × ${phyL}D × ${dH}H ft`;
                                        return <>
                                          <div className="dct-tile" style={{flex:1,padding:"10px 12px",background:TILE_BG,borderRadius:7}}>
                                            <div style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2,marginBottom:3}}>Customer demand</div>
                                            <div style={{...NUM,fontSize:12.5,color:INK,fontWeight:700}}>{demanded}</div>
                                          </div>
                                          <div className="dct-tile" style={{flex:1,padding:"10px 12px",background:TILE_BG,borderRadius:7}}>
                                            <div style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2,marginBottom:3}}>Physical footprint</div>
                                            <div style={{...NUM,fontSize:12.5,color:INK,fontWeight:700}}>{physical}</div>
                                          </div>
                                        </>;
                                      })()}
                                    </div>

                                    {/* Structure breakdown */}
                                    <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                                      <div className="dct-tile" style={{flex:"1 1 200px",padding:"10px 12px",background:TILE_BG,borderRadius:7,fontSize:12}}>
                                        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:4}}>
                                          <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2}}>🏛️ Pillars ({topo.pillars.length})</span>
                                          {(costs?.pillarCost || 0) > 0 && <span style={{...NUM,fontSize:12.5,fontWeight:700,color:INK}}>₹{Math.round((costs?.pillarCost || 0)).toLocaleString("en-IN")}</span>}
                                        </div>
                                        <div style={{...NUM,color:INK,fontWeight:600,lineHeight:1.5}}>
                                          {groupByLen(topo.pillars, p => p.H)} = {costs?.pillarRft || 0} RFT
                                        </div>
                                      </div>
                                      <div className="dct-tile" style={{flex:"1 1 200px",padding:"10px 12px",background:TILE_BG,borderRadius:7,fontSize:12}}>
                                        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:4}}>
                                          <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2}}>🔗 Beams ({topo.beams.length})</span>
                                          {(costs?.beamCost || 0) > 0 && <span style={{...NUM,fontSize:12.5,fontWeight:700,color:INK}}>₹{Math.round((costs?.beamCost || 0)).toLocaleString("en-IN")}</span>}
                                        </div>
                                        <div style={{...NUM,color:INK,fontWeight:600,lineHeight:1.5}}>
                                          {groupByLen(topo.beams, b => b.lengthFt)} = {costs?.beamRft || 0} RFT
                                        </div>
                                      </div>
                                      {/* Batta wraps every pillar and every beam, so its RFT is the
                                          other two tiles added together plus the IMS buffer — shown
                                          as the sum so the number is checkable against them. */}
                                      {batta && (
                                        <div className="dct-tile" style={{flex:"1 1 200px",padding:"10px 12px",background:TILE_BG,borderRadius:7,fontSize:12}}>
                                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:4}}>
                                          <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2}}>🎗️ Batta (+{batta.bufferPct}% buffer)</span>
                                          {(costs?.battaCost || 0) > 0 && <span style={{...NUM,fontSize:12.5,fontWeight:700,color:INK}}>₹{Math.round((costs?.battaCost || 0)).toLocaleString("en-IN")}</span>}
                                        </div>
                                          <div style={{...NUM,color:INK,fontWeight:600,lineHeight:1.5}}>
                                            {batta.rftRequired} RFT
                                            <span style={{color:INK_2,fontWeight:400}}> + {batta.bufferPct}% = </span>
                                            {batta.rftWithBuffer} RFT
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* The Pillars / Beams / Batta cost strip that used to sit here is
                                        gone — each figure now rides on the tile it describes, and the
                                        zone's truss total is on the card header. */}

                                    {/* ── §23 Phase 2.9f — Fabric Allocation (Masking + Liza + Curtains) ──
                                        Each truss row gets its own allocation — row 0 lives directly on
                                        the zone (zoneConfig[zk].maskingAllocation etc, unchanged), extra
                                        rows live on zoneConfig[zk].extraTrussRows[rowIdx-1] so a different
                                        truss row can pick a different fabric colour independently. */}
                                    {(() => {
                                      // Resolve drape density from selected photo's library tag (Full Box only)
                                      const photoUrl = (fn.elSelectedPhoto || {})[zk];
                                      let density = "moderate";
                                      if (photoUrl) {
                                        const li = libItems.find(l => l.url === photoUrl);
                                        if (li?.dims?.drapeDensity) density = li.dims.drapeDensity;
                                      }
                                      const fab = calcZoneFabric(row, trussInv, density);
                                      const showMasking = fab.maskingPieces > 0;
                                      const showLiza    = fab.lizaKg > 0;
                                      const showCurtain = fab.curtainPieces > 0;
                                      if (!showMasking && !showLiza && !showCurtain) return null;

                                      const fnPalette = fn.fnPalette || "Custom";
                                      const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                                      const anchors = pObj?.anchorColours || [];
                                      const fmkup = trussInv.fabricFreshMarkup || { liza:40, masking:40, curtain:40 };

                                      // Resolve allocations from the row itself — auto-fill if absent
                                      const resolveAlloc = (allocField, totalQty, stockArr, qtyField) => {
                                        const existing = row[allocField];
                                        if (Array.isArray(existing) && existing.length > 0) return existing;
                                        return autoFillFabricAllocation(totalQty, anchors, stockArr, qtyField);
                                      };
                                      const maskingAlloc = showMasking ? resolveAlloc("maskingAllocation", fab.maskingPieces, trussInv.maskingStock, "stockPieces") : [];
                                      const lizaAlloc    = showLiza    ? resolveAlloc("lizaAllocation",    Math.ceil(fab.lizaKg),  trussInv.lizaStock,    "stockKg")     : [];
                                      const curtainAlloc = showCurtain ? resolveAlloc("curtainAllocation", fab.curtainPieces, trussInv.curtainStock, "stockPieces") : [];

                                      // Cost rollup (internal margin tracking — never shown to client)
                                      const maskingTotals = calcFabricAllocationTotal(maskingAlloc, trussInv.maskingStock, "stockPieces", trussInv.rates?.maskingPieceRate, trussInv.rates?.maskingPiecePurchase, fmkup.masking, trussInv.rates?.maskingPieceRateNew);
                                      const lizaTotals    = calcFabricAllocationTotal(lizaAlloc,    trussInv.lizaStock,    "stockKg",     trussInv.rates?.lizaKgRate,       trussInv.rates?.lizaKgPurchase,       fmkup.liza,    trussInv.rates?.lizaKgRateNew);
                                      const curtainTotals = calcFabricAllocationTotal(curtainAlloc, trussInv.curtainStock, "stockPieces", trussInv.rates?.curtainPieceRate, trussInv.rates?.curtainPiecePurchase, fmkup.curtain, trussInv.rates?.curtainPieceRateNew);

                                      // Write allocation to the correct row — row 0 sits directly on the zone,
                                      // extra rows sit on zoneConfig[zk].extraTrussRows[rowIdx-1].
                                      const patchZone = (zoneObj, allocField, nextAlloc) => {
                                        if (rowIdx === 0) {
                                          const updated = { ...zoneObj };
                                          if (nextAlloc) updated[allocField] = nextAlloc; else delete updated[allocField];
                                          return updated;
                                        }
                                        const rows = [...(zoneObj.extraTrussRows || [])];
                                        const target = { ...(rows[rowIdx - 1] || {}) };
                                        if (nextAlloc) target[allocField] = nextAlloc; else delete target[allocField];
                                        rows[rowIdx - 1] = target;
                                        return { ...zoneObj, extraTrussRows: rows };
                                      };
                                      const updateAllocOnZone = (allocField, newAllocs) => {
                                        // §23 Phase 2.9f — write allocation to zoneConfig of the relevant fn
                                        const isActiveFn = fn.fnIdx === activeFnIdx;
                                        const nextAlloc = (Array.isArray(newAllocs) && newAllocs.length > 0) ? newAllocs : null;
                                        if (isActiveFn) {
                                          setZoneConfig(prev => ({ ...prev, [zk]: patchZone(prev[zk] || {}, allocField, nextAlloc) }));
                                        } else {
                                          // Inactive fn: update via fnBuilds snapshot
                                          setFnBuilds(prev => {
                                            const snap = prev[fn.fnIdx] || {};
                                            const curZc = snap.zoneConfig || {};
                                            const curZone = curZc[zk] || {};
                                            return { ...prev, [fn.fnIdx]: { ...snap, zoneConfig: { ...curZc, [zk]: patchZone(curZone, allocField, nextAlloc) } } };
                                          });
                                        }
                                      };

                                      // Chip renderer for an allocation array
                                      const AllocChips = ({ allocs, unitLabel }) => (
                                        <span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>
                                          {allocs.map((a, i) => {
                                            const cObj = (imsColourCatalogue||[]).find(c => c.name === a.colour);
                                            return <span key={i} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"1px 6px",borderRadius:4,background:CHIP_BG,fontSize:12}}>
                                              <span style={{width:9,height:9,borderRadius:2,background:cObj?.hex||"#999",border:"1px solid #B9BDC8"}} />
                                              <span style={{color:INK,fontWeight:600}}>{a.colour}</span>
                                              <span style={{...NUM,color:INK_2}}>×{a.qty}{unitLabel}</span>
                                            </span>;
                                          })}
                                        </span>
                                      );

                                      const FabricRow = ({ emoji, label, qty, unitLabel, allocs, totals, fabricType, allocField, breakdown }) => {
                                        const shortQty = totals.totalShort || 0;
                                        const hasShort = shortQty > 0;
                                        const marginLoss = totals.freshCost || 0;
                                        // Stripe repeats the status shown on the right, so the state
                                        // is readable once these sit side by side and the status text
                                        // is no longer in a single scannable column.
                                        const stripe = hasShort ? "#F59E0B" : allocs.length > 0 ? "#10B981" : "#9CA3AF";
                                        return (
                                          <div className="dct-row" style={{flex:"1 1 calc(50% - 5px)",minWidth:290,padding:"8px 11px",background:hasShort?"#FFF8EC":CARD_BG,border:`1px solid ${hasShort?"#F4E2C0":CARD_BORDER}`,borderLeft:`3px solid ${stripe}`,borderRadius:8,boxShadow:CARD_SHADOW}}>
                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                                              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,flexWrap:"wrap",minWidth:0}}>
                                                <span>{emoji}</span>
                                                <span style={{color:INK,fontWeight:700,letterSpacing:-0.1}}>{label}</span>
                                                <span style={{...NUM,color:INK_2,fontSize:12}}>· {qty}{unitLabel} needed</span>
                                                {breakdown && <span style={{color:INK_3,fontSize:11,fontStyle:"italic"}}>({breakdown})</span>}
                                              </div>
                                              <button
                                                onClick={() => setFabricPickerTarget({ fnIdx: fn.fnIdx, zoneKey: zk, fabricType, rowIdx })}
                                                className="dct-btn"
                                                style={{padding:"3px 9px",borderRadius:5,border:"1px solid #D3D7DF",background:TILE_BG,color:INK,fontSize:11.5,cursor:"pointer",fontWeight:700}}>
                                                🎨 {allocs.length === 0 ? "Pick" : "Edit"}
                                              </button>
                                            </div>
                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                              <AllocChips allocs={allocs} unitLabel={unitLabel} />
                                              {hasShort ? (
                                                <span style={{...NUM,fontSize:12,color:"#B45309",whiteSpace:"nowrap",fontWeight:700}}>
                                                  ⚠️ {shortQty}{unitLabel} fresh · {fmtRs(totals.total)} <span style={{color:INK_2,fontWeight:400}}>(incl. {fmtRs(marginLoss)} fresh)</span>
                                                </span>
                                              ) : allocs.length > 0 ? (
                                                <span style={{...NUM,fontSize:12,color:"#059669",whiteSpace:"nowrap",fontWeight:600}}>✓ in stock · <span style={{color:INK,fontWeight:700}}>{fmtRs(totals.total)}</span> <span style={{color:INK_2,fontWeight:400}}>rental</span></span>
                                              ) : (
                                                <span style={{fontSize:12,color:INK_3,whiteSpace:"nowrap"}}>— not allocated</span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      };

                                      const fabricSubtotal = (showMasking ? (maskingTotals.total||0) : 0) + (showLiza ? (lizaTotals.total||0) : 0) + (showCurtain ? (curtainTotals.total||0) : 0);
                                      return (
                                        <div style={{marginTop:12,padding:"11px 12px",background:TILE_BG,border:"1px dashed #D3D7DF",borderRadius:8}}>
                                          <div style={{fontSize:10.5,fontWeight:700,color:INK_2,letterSpacing:0.7,textTransform:"uppercase",marginBottom:7,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,flexWrap:"wrap"}}>
                                            <span style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                              <span>🧵 Fabric Allocation</span>
                                              <span style={{fontSize:10,fontWeight:400,color:INK_3,textTransform:"none",letterSpacing:0,fontStyle:"italic"}}>(rental — charged under truss cost)</span>
                                            </span>
                                            {fabricSubtotal > 0 && <span style={{...NUM,fontSize:12,fontWeight:700,color:"#4338CA",textTransform:"none",letterSpacing:0}}>Fabric: {fmtRs(fabricSubtotal)}</span>}
                                          </div>
                                          {/* Two-up, matching the status cards; an odd third card
                                              grows to fill its own row rather than leaving a hole. */}
                                          <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
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
                                            breakdown={`${fab.curtainPillarCount || fab.pillarCount} ${fab.curtainPillarCount && fab.curtainPillarCount < fab.pillarCount ? "front " : ""}pillars × ${(row.curtainsPerPillar || 4)} curtains/pillar`}
                                          />}
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* Warnings (non-fatal) */}
                                    {pv.warnings?.length > 0 && (
                                      <div style={{marginTop:8,fontSize:12,lineHeight:1.5,color:"#B45309"}}>
                                        {pv.warnings.map((w, i) => <div key={i}>ℹ️ {w}</div>)}
                                      </div>
                                    )}
                                  </>
                                )}
                                </>)}
                              </div>
                            );
                          })}
                        </div>
                      );
                      })}
                    </div>
                  );
                })()}</>);
}

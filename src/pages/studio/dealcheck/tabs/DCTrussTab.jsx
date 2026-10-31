import { Fragment } from "react";
import { calcZoneFabric, resolveFabricAllocation, anchorsForPalette, anchorsForPaletteByMaterial, calcFabricAllocationTotal, zoneTrussStandingDiscountDetail, trussDiscountedCosts, repeatCatFor, snapRowDimsForProduction, trussInvForMaterial, dcFabricMultOf } from "../../../../lib/studio/pricing";
import { fixedVenueFor } from "../../../../lib/ims/fixedVenues";
import { resolveBeamSegment, resolvePillarHeight } from "../../../../lib/ims/trussEngine";
import { findCrossFnReuseSource } from "../../../../lib/studio/crossFnReuse";
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
                  // hard-block state per fn date + other events on the same date.
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

                  // Helper — list of zones present in a fn (uses fn.zoneConfig + fn.enabledEls).
                  // ♻️ Repeat zones now STAY in this list — a repeat zone's truss still costs half
                  // (see the per-row discount below) rather than nothing, so it needs its own preview
                  // card instead of being invisible. Must match dcCostRollup's own truss total.
                  const zonesOf = (fn) => {
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    return Object.keys(zc).filter(zk => en[zk] && zc[zk]);
                  };

                  // §23 Phase 3 — resolve reservation state for THIS client on the SELECTED fn date.
                  // States we render:
                  //   "free"        — no entry yet; the truss is reserved when the deal is SOLD
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
                    const ownEntry = events.find(ev => ev.clientId === currentClientId && ev.state === "hard");
                    if (ownEntry) {
                      reservationByDate[d] = { state: "hard", entry: ownEntry };
                    } else {
                      reservationByDate[d] = { state: "free", entry: null };
                    }
                    // Always collect the other events on this date for visibility
                    const others = events.filter(ev => ev.clientId !== currentClientId && ev.state === "hard");
                    if (others.length > 0) heldByOthersByDate[d] = others;
                  }

                  // Tally totals across all fns
                  let grandActual = 0, grandU = 0, grandBox = 0, grandPillarRft = 0, grandBeamRft = 0, grandBattaRft = 0, anyShortage = false, anyDefault = false;
                  const previewsByFn = fns.map(fn => {
                    const zones = zonesOf(fn);
                    // A zone can carry more than one truss structure (row 0 = the zone's own scalar
                    // fields, plus any zCfg.extraTrussRows added via "+ Add Truss" in Build) — one
                    // preview card per row, not per zone.
                    // Fixed-venue pillar/beam discount for this function's own venue (Admin →
                    // Settings → Fixed Venues) — netted out of each row below so the Pillars/Beams
                    // line items still sum to the row's own discounted total, matching the
                    // aggregate this tab (and dcCostRollup's own Truss figure) both now show.
                    const venueTrussHere = fixedVenueFor({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || "")?.truss;
                    // Same definition dcCostRollup's own truss block uses for its "isRepeat" flag — a
                    // zone this deal's immediately-preceding same-venue function (within 24h) already
                    // built needs nothing new either, same physical fact as a manually-flagged Repeat
                    // zone. Missing this OR-clause is why this tab's own per-zone/per-function totals
                    // used to disagree with the sidebar's function totals (which already read
                    // dcCostRollup, not this tab's own preview) for any function 2+ that cross-fn-
                    // reuses a prior function's structure, even with no zone manually flagged Repeat.
                    const crossFnPrevFn = findCrossFnReuseSource(fn, fns);
                    const previews = zones.flatMap(zk => {
                      const zCfg = (fn.zoneConfig || {})[zk];
                      const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                      const rows = [zCfg, ...(zCfg.extraTrussRows || [])];
                      const isRepeat = repeatCatFor(zCfg, "truss") || !!(crossFnPrevFn?.enabledEls?.[zk] && crossFnPrevFn?.zoneConfig?.[zk]);
                      return rows.map((row, rowIdx) => {
                        // Owner ask (2026-10-22): the minimum-joints CLEAN SPAN is no longer just a
                        // reference figure here — calcZoneTrussPreview/trussRowCost now snap to it
                        // internally for billing and production everywhere (Build, Summary, exports,
                        // Deal Check all price the SAME real structure). `snappedRow` below is kept
                        // only to show what changed (the "L 50→47ft" note) and to resolve the real
                        // joint count — `row` itself is passed to every pricing call now; they snap
                        // on their own.
                        const snappedRow = snapRowDimsForProduction(row, trussInv);
                        const pv = calcZoneTrussPreview(row, trussInv);
                        if (pv && pv.costs) {
                          const disc = venueTrussHere ? zoneTrussStandingDiscountDetail(row, trussInv, venueTrussHere) : { pillar: 0, beam: 0, total: 0 };
                          // The venue's standing discount and a Repeat zone's do not stack: each part takes
                          // only the bigger of the two (trussDiscountedCosts, pricing.js).
                          const net = trussDiscountedCosts(pv.costs, disc, isRepeat);
                          if (disc.total > 0) {
                            pv.costs.venueDiscount = disc.total;
                            pv.costs.pillarDiscounted = disc.pillar > 0;
                            pv.costs.beamDiscounted = disc.beam > 0;
                          }
                          // ♻️ Repeat zone: the structure is already standing, but reusing it isn't
                          // free — someone still has to check/re-tension/touch it up — so it bills at
                          // 70% (a flat 30% discount — see dcCostRollup's matching change). Covers
                          // pillarCost/beamCost/battaCost individually (not just the .actual sum they
                          // roll into) so the per-item tiles shown below agree with the card's own
                          // total instead of quietly showing the old undiscounted figure. The
                          // pillar/beam RFT and batta RFT figures stay OUT of the grand totals below
                          // regardless — those drive truss-inventory sourcing, and a repeat zone needs
                          // nothing new sourced for a rig that isn't moving.
                          pv.costs.pillarCost = net.pillarCost;
                          pv.costs.beamCost = net.beamCost;
                          pv.costs.battaCost = net.battaCost;
                          pv.costs.actual = net.actual;
                          if (isRepeat) {
                            pv.costs.isRepeat = true;
                            // OR'd in, not overwritten — a zone can be BOTH a fixed-venue standing
                            // match (disc.pillar>0 above) AND repeat; either reason is enough to show
                            // the discount-applied colour on that tile.
                            pv.costs.pillarDiscounted = pv.costs.pillarDiscounted || true;
                            pv.costs.beamDiscounted = pv.costs.beamDiscounted || true;
                            pv.costs.battaDiscounted = true;
                          }
                          grandActual += pv.costs.actual;
                          if (!isRepeat) {
                            grandU      += pv.costs.uEquivalent;
                            grandBox    += pv.costs.boxEquivalent;
                            grandPillarRft += pv.costs.pillarRft;
                            grandBeamRft   += pv.costs.beamRft;
                            if (pv.batta?.rftWithBuffer) grandBattaRft += pv.batta.rftWithBuffer;
                          }
                        }
                        if (pv?.source === "default-on-forget") anyDefault = true;
                        if (pv?.smartFlag === "red") anyShortage = true;
                        // Surfaced next to the joint count below — a silent pillar/beam count that
                        // doesn't match the entered dims at a glance would read as a bug, not an
                        // optimization, if nothing on screen said why.
                        const snapNote = (snappedRow !== row) ? {
                          fromL: row.dims?.L, toL: snappedRow.dims?.L,
                          fromW: row.dims?.W, toW: snappedRow.dims?.W,
                        } : null;
                        // The real, stock-aware joint count — how many actual cuts/connections this
                        // structure needs — rather than `pillarCount + beamCount - 1`, a naive
                        // headcount formula that was never wired to real stock at all (a 50ft U
                        // Truss showed "4 joints expected" from that formula when the real beam
                        // solver, run against the same stock, resolves it in 2). Sums
                        // resolveBeamSegment's own joint count per beam segment (same solver the
                        // snap above uses) and resolvePillarHeight's per pillar (a non-standard
                        // height needs its own spacer joint, e.g. 17ft = 15ft pillar + 2ft spacer).
                        let realJoints = 0, realJointsShortage = false;
                        if (pv?.topology) {
                          const matInv = trussInvForMaterial(trussInv, snappedRow.trussMaterial);
                          (pv.topology.beams || []).forEach(b => {
                            const r = resolveBeamSegment(b.lengthFt, matInv);
                            if (r.shortage) realJointsShortage = true;
                            realJoints += r.joints || 0;
                          });
                          (pv.topology.pillars || []).forEach(p => {
                            const r = resolvePillarHeight(p.H, matInv);
                            if (r.shortage) realJointsShortage = true;
                            realJoints += r.joints || 0;
                          });
                        }
                        return { zk, zLabel: rowIdx > 0 ? `${zLabel} (truss #${rowIdx + 1})${isRepeat ? " · ♻️ Repeat (30%)" : ""}` : `${zLabel}${isRepeat ? " · ♻️ Repeat (30%)" : ""}`, pv, row, rowIdx, snapNote, realJoints, realJointsShortage };
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
                          sublabel = "The truss is reserved when this deal is marked SOLD.";
                          accentColor = "#6B7280";
                          borderColor = "#E4E6EA";
                          icon = "📐";
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
                        <div style={{marginTop:6,fontSize:11,lineHeight:1.5,color:INK_3,fontStyle:"italic"}}>§23 Phase 3 active — marking the deal SOLD reserves this truss (hard block).</div>
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
                        const anchors = anchorsForPalette(imsPaletteCatalogue, fnPalette);
                        let fnGrand = 0;
                        // Per-preview-row fabric cost, kept alongside so the collapsed zone card
                        // below can show the SAME truss+fabric total this header sums, instead of
                        // only its own truss/pillar/beam/batta portion with fabric silently missing
                        // until the card is expanded (which is why the header total never matched
                        // the sum of the collapsed rows).
                        const fabricCostByPreviewIdx = [];
                        previews.forEach(({ zk, pv, row }, idx) => {
                          fnGrand += pv?.costs?.actual || 0; // already halved above for a repeat zone
                          const photoUrl = (fn.elSelectedPhoto || {})[zk];
                          let density = "moderate";
                          if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                          // Same flat 30% discount (billed at 70%) as the truss steel above for a
                          // repeat zone — see dcCostRollup's matching change. Scoped to THIS row's
                          // own truss config (row 0 = the zone's own scalar fields; an extra truss
                          // row — "+ Add Truss" in Build — carries its own separate fabric
                          // allocation) rather than always reading the zone's top-level zCfg, which
                          // used to double-count row 0's fabric once per extra row a zone had, and
                          // always missed an extra row's own fabric entirely.
                          const fabCost = calcZoneFabricCost(row, trussInv, anchors, row.drapeDensity || density, row.dcFabricMult) * (pv?.costs?.isRepeat ? 0.7 : 1);
                          fabricCostByPreviewIdx[idx] = fabCost;
                          fnGrand += fabCost;
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
                          {previews.map(({ zk, zLabel, pv, row, rowIdx, snapNote, realJoints, realJointsShortage }, previewIdx) => {
                            const isInvalid = pv.smartFlag === "red";
                            const topo = pv.topology;
                            const costs = pv.costs;
                            const batta = pv.batta;
                            // Truss + this row's own fabric (Masking/Liza/Curtains) together — the
                            // same two figures fnGrand above sums into "Truss total". Showing only
                            // costs.actual here (truss/pillar/beam/batta) used to leave fabric out
                            // of the collapsed row entirely — it only appeared once the card was
                            // expanded — so the header total could never be reconciled against the
                            // sum of what the collapsed rows showed.
                            const zoneRowTotal = (costs?.actual || 0) + (fabricCostByPreviewIdx[previewIdx] || 0);
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
                                      Method {topo.method} · {topo.pillarCount} pillar{topo.pillarCount===1?"":"s"} · {topo.beamCount} beam segment{topo.beamCount===1?"":"s"} · <span title="Real, stock-aware count — every beam segment's own piece-combination joints plus every non-standard pillar height's own spacer joint, resolved against the current IMS beam/pillar stock">{realJoints} joint{realJoints===1?"":"s"} expected</span>
                                      {realJointsShortage && <span title="At least one beam segment or pillar height has no combination of current stock within the usual 1ft gap tolerance — it'll need a visible gap or an undersized piece on site" style={{color:"#B91C1C",fontWeight:600}}> · ⚠️ stock gap</span>}
                                      {/* snapRowDimsForProduction only ever shrinks, and only within a small
                                          window — see pricing.js. Owner ask (2026-10-22): billing/production
                                          now both use this smaller size too (trussRowCost/calcZoneTrussPreview
                                          snap internally) — Build's input field still shows what was typed,
                                          but this IS the real sqft/fabric/pillar/beam figure everywhere else. */}
                                      {snapNote && <span title="Build's input still shows what was typed — billing, fabric and production all use this smaller, fewer-joints size instead">
                                        {" · "}<span style={{color:"#B45309",fontWeight:600}}>⚡ shrunk for fewer joints</span>
                                        {" "}({[
                                          snapNote.fromL !== snapNote.toL ? `L ${snapNote.fromL}→${snapNote.toL}ft` : null,
                                          snapNote.fromW !== snapNote.toW ? `W ${snapNote.fromW}→${snapNote.toW}ft` : null,
                                        ].filter(Boolean).join(", ")})
                                      </span>}
                                    </div>}
                                  </div>
                                  {zoneRowTotal > 0 && (
                                    <span style={{...NUM,marginLeft:"auto",marginTop:2,fontSize:13.5,fontWeight:700,color:"#8A6A32",whiteSpace:"nowrap",flexShrink:0}}>
                                      ₹{Math.round(zoneRowTotal).toLocaleString("en-IN")}
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
                                          {(costs?.pillarCost || 0) > 0 && <span title={costs?.pillarDiscounted?"Fixed-venue standing-pillar discount applied":undefined} style={{...NUM,fontSize:12.5,fontWeight:700,color:costs?.pillarDiscounted?"#10B981":INK}}>₹{Math.round((costs?.pillarCost || 0)).toLocaleString("en-IN")}</span>}
                                        </div>
                                        <div style={{...NUM,color:INK,fontWeight:600,lineHeight:1.5}}>
                                          {groupByLen(topo.pillars, p => p.H)} = {costs?.pillarRft || 0} RFT
                                        </div>
                                      </div>
                                      <div className="dct-tile" style={{flex:"1 1 200px",padding:"10px 12px",background:TILE_BG,borderRadius:7,fontSize:12}}>
                                        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:4}}>
                                          <span style={{fontSize:10.5,fontWeight:700,letterSpacing:0.6,textTransform:"uppercase",color:INK_2}}>🔗 Beams ({topo.beams.length})</span>
                                          {(costs?.beamCost || 0) > 0 && <span title={costs?.beamDiscounted?"Fixed-venue standing-beam discount applied":undefined} style={{...NUM,fontSize:12.5,fontWeight:700,color:costs?.beamDiscounted?"#10B981":INK}}>₹{Math.round((costs?.beamCost || 0)).toLocaleString("en-IN")}</span>}
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
                                          {(costs?.battaCost || 0) > 0 && <span title={costs?.battaDiscounted?"Repeat-zone discount applied":undefined} style={{...NUM,fontSize:12.5,fontWeight:700,color:costs?.battaDiscounted?"#10B981":INK}}>₹{Math.round((costs?.battaCost || 0)).toLocaleString("en-IN")}</span>}
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

                                    {/* ── CUSTOM CEILING ── the inventory panel Build's Custom Ceiling picker put on this truss, with its
                                        count (row.customCeilingQty, else one per truss - what Build prices). It was priced but shown
                                        nowhere in Deal Check (owner ask 2026-10-31). */}
                                    {row.customCeilingItemId && (() => {
                                      const ci = (dealCheckData?.inventory || []).find(x => x.id === row.customCeilingItemId);
                                      const cq = Number(row.customCeilingQty) > 0 ? Number(row.customCeilingQty) : Math.max(1, Number(row.trussQty) || 1);
                                      const src = ci?.img || ci?.photoUrls?.[0] || "";
                                      return (
                                        <div style={{marginTop:12,padding:"9px 12px",background:TILE_BG,border:"1px dashed #D3D7DF",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
                                          {src ? <img src={src} alt="" style={{width:36,height:36,borderRadius:6,objectFit:"cover",flexShrink:0}} /> : null}
                                          <div style={{minWidth:0,flex:1}}>
                                            <div style={{fontSize:10.5,fontWeight:700,color:INK_2,letterSpacing:0.7,textTransform:"uppercase"}}>Custom Ceiling</div>
                                            <div style={{fontSize:12.5,fontWeight:600,color:INK_2,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ci?.name || "Item not in IMS"}</div>
                                          </div>
                                          <div style={{...NUM,fontSize:13,fontWeight:700,color:INK_2,flexShrink:0}}>× {cq}{ci?.unit ? ` ${ci.unit}` : ""}</div>
                                        </div>
                                      );
                                    })()}

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
                                      // The truss's own drape density (Build's Drape pills) first — what Build bills on — else the photo tag.
                                      const fab = calcZoneFabric(row, trussInv, row.drapeDensity || density);
                                      const showMasking = fab.maskingPieces > 0;
                                      const showLiza    = fab.lizaKg > 0;
                                      const showCurtain = fab.curtainPieces > 0;
                                      if (!showMasking && !showLiza && !showCurtain) return null;

                                      const fnPalette = fn.fnPalette || "Custom";
                                      const anchors = anchorsForPalette(imsPaletteCatalogue, fnPalette);

                                      // Resolve allocations from the row itself — auto-fill if absent.
                                      // material is "liza"/"masking"/"curtain", the exact keys a Fabric
                                      // Palette colour can be tagged with (StudioBuild.jsx) — only
                                      // colours actually meant for THIS material become its anchors.
                                      const resolveAlloc = (material, allocField, totalQty, stockArr, qtyField) => {
                                        return resolveFabricAllocation(row[allocField], totalQty, anchorsForPaletteByMaterial(imsPaletteCatalogue, fnPalette, material), stockArr, qtyField);
                                      };
                                      const maskingAlloc = showMasking ? resolveAlloc("masking", "maskingAllocation", fab.maskingPieces, trussInv.maskingStock, "stockPieces") : [];
                                      const lizaAlloc    = showLiza    ? resolveAlloc("liza", "lizaAllocation",    Math.ceil(fab.lizaKg),  trussInv.lizaStock,    "stockKg")     : [];
                                      const curtainAlloc = showCurtain ? resolveAlloc("curtain", "curtainAllocation", fab.curtainPieces, trussInv.curtainStock, "stockPieces") : [];

                                      // Cost rollup. Same flat 30% repeat-zone discount (billed at 70%) as
                                      // the truss steel above — costs?.isRepeat is this row's own flag, set
                                      // above.
                                      const repeatFabMult = costs?.isRepeat ? 0.7 : 1;
                                      const applyRepeatFab = (t) => repeatFabMult === 1 ? t : { ...t, total: Math.round(t.total * repeatFabMult), reusedCost: Math.round(t.reusedCost * repeatFabMult), freshCost: Math.round(t.freshCost * repeatFabMult) };
                                      // Owner ask (2026-10-15): this must match what the salesperson's
                                      // Build Fabric toggle actually billed the guest — Old or New, picked
                                      // explicitly per truss, not auto-detected from stock. Passing the SAME
                                      // resolved rate for both the "old" and "new" rate args to
                                      // calcFabricAllocationTotal collapses its stock-aware old/new split
                                      // into one flat rate (the colour/stock breakdown below still shows the
                                      // real physical split, for ops planning — it just no longer drives
                                      // the price).
                                      const useNewFabric = !!row.useNewFabric;
                                      const flatRateFor = (oldKey, newKey) => {
                                        const oldR = Number(trussInv.rates?.[oldKey]) || 0;
                                        const newRaw = trussInv.rates?.[newKey];
                                        const newR = (newRaw === undefined || newRaw === null || newRaw === "") ? oldR : (Number(newRaw) || 0);
                                        return useNewFabric ? newR : oldR;
                                      };
                                      // x this row's own per-line multiplier (row.dcFabricMult, the "x N" box on each line).
                                      const maskRate = flatRateFor("maskingPieceRate", "maskingPieceRateNew") * dcFabricMultOf(row, "masking");
                                      const lizaRate = flatRateFor("lizaKgRate", "lizaKgRateNew") * dcFabricMultOf(row, "liza");
                                      const curtainRate = flatRateFor("curtainPieceRate", "curtainPieceRateNew") * dcFabricMultOf(row, "curtain");
                                      // Saved on the same truss row the allocations live on (row 0 = the zone, else
                                      // extraTrussRows[rowIdx-1]); blank or 1 removes the key.
                                      const setFabricMult = (part, val) => {
                                        const v = val === "" ? null : Math.max(0, Number(val) || 0);
                                        const apply = (z) => {
                                          const next = { ...((z && z.dcFabricMult) || {}) };
                                          if (v == null || v === 1) delete next[part]; else next[part] = v;
                                          const out = { ...(z || {}) };
                                          if (Object.keys(next).length) out.dcFabricMult = next; else delete out.dcFabricMult;
                                          return out;
                                        };
                                        const patch = (zoneObj) => {
                                          if (rowIdx === 0) return apply(zoneObj);
                                          const rows = [...((zoneObj || {}).extraTrussRows || [])];
                                          rows[rowIdx - 1] = apply(rows[rowIdx - 1]);
                                          return { ...(zoneObj || {}), extraTrussRows: rows };
                                        };
                                        if (fn.fnIdx === activeFnIdx) setZoneConfig(prev => ({ ...prev, [zk]: patch(prev[zk]) }));
                                        else setFnBuilds(prev => { const snap = prev[fn.fnIdx] || {}; const curZc = snap.zoneConfig || {}; return { ...prev, [fn.fnIdx]: { ...snap, zoneConfig: { ...curZc, [zk]: patch(curZc[zk]) } } }; });
                                      };
                                      // The line's money is the NEEDED qty × rate — the same figure the cost rollup
                                      // (calcZoneFabricCost) and Build bill on. The allocation is whole kg / pieces
                                      // pulled from stock (14 kg for a 13.45 kg need), so pricing it made this panel
                                      // disagree with Build by the rounding. Allocation still drives stock/shortfall.
                                      const atNeed = (t, need, rate) => ({ ...t, total: Math.round((Number(need) || 0) * rate * repeatFabMult * 100) / 100 });
                                      const maskingTotals = atNeed(calcFabricAllocationTotal(maskingAlloc, trussInv.maskingStock, "stockPieces", maskRate, undefined, undefined, maskRate), fab.maskingPieces, maskRate);
                                      const lizaTotals    = atNeed(calcFabricAllocationTotal(lizaAlloc,    trussInv.lizaStock,    "stockKg",     lizaRate, undefined, undefined, lizaRate), fab.lizaKg, lizaRate);
                                      const curtainTotals = atNeed(calcFabricAllocationTotal(curtainAlloc, trussInv.curtainStock, "stockPieces", curtainRate, undefined, undefined, curtainRate), fab.curtainPieces, curtainRate);

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

                                      const FabricRow = ({ emoji, label, qty, unitLabel, allocs, totals, fabricType, allocField, breakdown, discounted, useNewFabric, multPart }) => {
                                        const mult = dcFabricMultOf(row, multPart);
                                        const shortQty = totals.totalShort || 0;
                                        const hasShort = shortQty > 0;
                                        const marginLoss = totals.freshCost || 0;
                                        const tierNote = useNewFabric ? "New fabric picked in Build" : "Old fabric (default)";
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
                                                <span style={{fontSize:10,fontWeight:600,color:useNewFabric?"#7C3AED":INK_3,padding:"0 5px",borderRadius:4,background:useNewFabric?"rgba(124,58,237,0.1)":"transparent"}}>{tierNote}</span>
                                                {breakdown && <span style={{color:INK_3,fontSize:11,fontStyle:"italic"}}>({breakdown})</span>}
                                              </div>
                                              <button
                                                onClick={() => setFabricPickerTarget({ fnIdx: fn.fnIdx, zoneKey: zk, fabricType, rowIdx })}
                                                className="dct-btn"
                                                style={{padding:"3px 9px",borderRadius:5,border:"1px solid #D3D7DF",background:TILE_BG,color:INK,fontSize:11.5,cursor:"pointer",fontWeight:700}}>
                                                🎨 {allocs.length === 0 ? "Pick" : "Edit"}
                                              </button>
                                              <label title="Multiply this line's cost (Ambria's cost side only, the guest price is not touched). Blank = 1." style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11.5,color:mult !== 1 ? "#4338CA" : INK_2,fontWeight:600}}>
                                                ×<input type="number" min="0" step="0.1" placeholder="1"
                                                  key={`${zk}-${rowIdx}-${multPart}-${row?.dcFabricMult?.[multPart] ?? ""}`}
                                                  defaultValue={row?.dcFabricMult?.[multPart] ?? ""}
                                                  onBlur={e => setFabricMult(multPart, e.target.value)}
                                                  onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                                  style={{width:44,padding:"2px 4px",borderRadius:5,border:`1px solid ${mult !== 1 ? "#A5B4FC" : "#D3D7DF"}`,fontSize:11.5,textAlign:"center",fontWeight:700,color:INK}} />
                                              </label>
                                            </div>
                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                              <AllocChips allocs={allocs} unitLabel={unitLabel} />
                                              {hasShort ? (
                                                <span style={{...NUM,fontSize:12,color:"#B45309",whiteSpace:"nowrap",fontWeight:700}}>
                                                  ⚠️ {shortQty}{unitLabel} beyond physical stock · <span title={discounted?"Repeat-zone discount applied":undefined} style={{color:discounted?"#10B981":undefined}}>{fmtRs(totals.total)}</span> <span style={{color:INK_2,fontWeight:400}}>(whole line billed at the same {useNewFabric?"New":"Old"} rate — go source the rest)</span>
                                                </span>
                                              ) : allocs.length > 0 ? (
                                                <span style={{...NUM,fontSize:12,color:"#059669",whiteSpace:"nowrap",fontWeight:600}}>✓ in stock · <span title={discounted?"Repeat-zone discount applied":undefined} style={{color:discounted?"#10B981":INK,fontWeight:700}}>{fmtRs(totals.total)}</span> <span style={{color:INK_2,fontWeight:400}}>rental</span></span>
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
                                              <span style={{fontSize:10,fontWeight:400,color:INK_3,textTransform:"none",letterSpacing:0,fontStyle:"italic"}}>(Old/New rate per the Build toggle — billed under truss cost)</span>
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
                                            discounted={costs?.isRepeat} useNewFabric={useNewFabric} multPart="masking"
                                          />}
                                          {showLiza && <FabricRow
                                            emoji="🧣" label="Liza" qty={fab.lizaKg} unitLabel="kg"
                                            allocs={lizaAlloc} totals={lizaTotals} fabricType="liza" allocField="lizaAllocation"
                                            breakdown={fab.lizaModel === "wrap+ceiling" ? `wrap ${fab.lizaWrapKg}kg + ceiling ${fab.lizaCeilingKg}kg (${density})` : `wrap only`}
                                            discounted={costs?.isRepeat} useNewFabric={useNewFabric} multPart="liza"
                                          />}
                                          {showCurtain && <FabricRow
                                            emoji="🎀" label="Velvet Curtains" qty={fab.curtainPieces} unitLabel="pc"
                                            allocs={curtainAlloc} totals={curtainTotals} fabricType="curtain" allocField="curtainAllocation"
                                            breakdown={(() => {
                                              const pc = fab.curtainPillarCount || fab.pillarCount || 0;
                                              // Read back from the actual totals (curtainPieces ÷ curtainPillarCount) rather than
                                              // re-guessing row.curtainsPerPillar's default — a U truss bills 2/pillar, Half/Full
                                              // Box bill 4/pillar (calcZoneFabric, lib/studio/pricing.js), and this label must
                                              // always describe whichever one actually produced qty needed above it.
                                              const perPillar = pc > 0 ? Math.round((fab.curtainPieces || 0) / pc) : (row.curtainsPerPillar || 4);
                                              return `${pc} ${fab.curtainPillarCount && fab.curtainPillarCount < fab.pillarCount ? "front " : ""}pillars × ${perPillar} curtains/pillar`;
                                            })()}
                                            discounted={costs?.isRepeat} useNewFabric={useNewFabric} multPart="curtain"
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

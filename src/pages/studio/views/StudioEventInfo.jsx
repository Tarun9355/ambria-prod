import { useState, useEffect } from "react";
import { taxOr, FUNCTIONS, CLIENT_SHIFTS_DD } from "../../../lib/studio/taxonomy";
import { IconClipboard } from "../../../components/icons.jsx";

const SUBTITLE = "Fill in the client details to start designing their event.";
const SUB_TYPED_KEY = "ambria-ei-subtitle-typed"; // session flag — see the typewriter effect

// ═══ REMOVE-FUNCTION CONFIRM ═══
// In-app dialog replacing the native confirm() alert. Backdrop click and Esc both cancel;
// Cancel holds initial focus, not Remove. Exported so it can be rendered/tested standalone.
export function RemoveFunctionDialog({ snap, onCancel, onConfirm, S, sheet, hairline, textP, textM, isDark }) {
  if (!snap) return null;
  const hasDetail = snap.type || snap.date || snap.venue || snap.pax;
  return (
    <div style={S.overlay} onClick={onCancel}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="ei-rm-title" aria-describedby="ei-rm-body"
        onClick={e => e.stopPropagation()}
        style={{...sheet,position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          zIndex:200,width:"min(430px, calc(100vw - 32px))"}}>
        <div style={{padding:"24px 26px 20px"}}>
          <div id="ei-rm-title" style={{fontSize:16,fontWeight:700,color:textP,letterSpacing:-0.3,lineHeight:1.25}}>Remove Function {snap.idx + 1}?</div>
          <div id="ei-rm-body" style={{fontSize:12.5,color:textM,marginTop:7,lineHeight:1.55}}>
            Its details will be cleared and can’t be recovered.
            {/* Removing Function 1 promotes the next one into its slot, so the numbering shifts.
                Say so — otherwise it looks like the wrong function was deleted. */}
            {snap.idx === 0 && " The next function becomes Function 1, and any build attached to it moves with it."}
          </div>
          {hasDetail && (
            <div style={{marginTop:15,padding:"11px 13px",borderRadius:11,border:`1px solid ${hairline}`,background:isDark?"rgba(255,255,255,0.025)":"#FAFAFB",fontSize:11,color:textM,display:"flex",gap:11,flexWrap:"wrap",alignItems:"center"}}>
              {snap.type && <span style={{color:textP,fontWeight:600}}>🎉 {snap.type}</span>}
              {snap.date && <span>📅 {snap.date}</span>}
              {snap.shift && <span>🕐 {snap.shift}</span>}
              {snap.venue && <span>📍 {snap.venue}</span>}
              {snap.pax && <span>👥 {snap.pax} pax</span>}
            </div>
          )}
          <div style={{display:"flex",justifyContent:"flex-end",gap:9,marginTop:20}}>
            <button className="ei-btn ei-ghost" autoFocus onClick={onCancel}
              style={{fontSize:12.5,fontWeight:600,padding:"9px 18px",borderRadius:10,border:`1px solid ${hairline}`,background:"transparent",color:textM,cursor:"pointer"}}>Cancel</button>
            <button className="ei-btn ei-solid" onClick={onConfirm}
              style={{fontSize:12.5,fontWeight:600,padding:"9px 20px",borderRadius:10,border:"none",background:"#DC2626",color:"#fff",cursor:"pointer"}}>Remove</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudioEventInfo({ ctx }) {
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false); // collapsed by default
  // Pending function-removal — holds a snapshot of what's being removed so the dialog can
  // show it. null = no dialog open. Replaces the native confirm() this used to fire.
  const [confirmRemove, setConfirmRemove] = useState(null);

  // ═══ SUBTITLE TYPEWRITER ═══
  // Types out once per browser session, then renders instantly on every later visit. This form
  // is opened many times a day by the sales team, so re-typing the same sentence each time would
  // be a reading delay rather than a flourish. Also skipped outright for reduced-motion users.
  const [typedSub, setTypedSub] = useState(() => {
    try { if (sessionStorage.getItem(SUB_TYPED_KEY)) return SUBTITLE; } catch { /* private mode */ }
    try { if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return SUBTITLE; } catch { /* older browser */ }
    return "";
  });
  const subTyping = typedSub !== SUBTITLE;
  useEffect(() => {
    if (!subTyping) return;
    // Flag it up front, not on completion — otherwise navigating away mid-type replays it.
    try { sessionStorage.setItem(SUB_TYPED_KEY, "1"); } catch { /* private mode */ }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedSub(SUBTITLE.slice(0, i));
      if (i >= SUBTITLE.length) clearInterval(id);
    }, 21);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const {
    S, isDark, accent, border, textP, fmt, showMsg,
    authUser,
    step, setStep,
    venue, setVenue, fn, setFn,
    clientName, setClientName, clientDate, setClientDate, clientPhone, setClientPhone,
    clientBrideGroom, setClientBrideGroom, clientShift, setClientShift, clientPax, setClientPax,
    clientVenueOther, setClientVenueOther, setClientPalette, setFnBuilds,
    extraFunctions, setExtraFunctions, expandedFnIdx, setExpandedFnIdx,
    activeFnIdx, setActiveFnIdx,
    clientLedger, saveClientLedger, activeClientId, setActiveClientId, setClientSearch,
    activeClient, loadClientSession,
    sessionHistoryExpanded, setSessionHistoryExpanded,
    lmsLeads, lmsLoading, lmsError, lmsFilling, lmsCacheRef, setLmsRefreshCounter, loadLmsLead,
    refreshLmsSync, lmsSyncing,
    taxonomy,
    customTripRate, setCustomTripRate, customGensets, setCustomGensets,
    setFilterFn, setBrowseVenues, setVenueGroup,
    allInhouseVenues, allOutdoorDB, allInhouseGroups, autoPersistCustomVenue,
    trVenues,
  } = ctx;

  // ═══ PHONE — 10 DIGITS ═══
  // Indian mobiles are 10 digits. Strips everything non-numeric and tolerates the two prefixes
  // that arrive from LMS leads / pasted numbers (+91… and a leading 0), so an existing client
  // stored as "+91 98765 43210" still reads as valid rather than blocking Continue.
  // Declared above doSaveClient because that closure persists `phoneDigits`.
  const digits10 = (v) => {
    const d = String(v ?? "").replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) return d.slice(2);
    if (d.length === 11 && d.startsWith("0")) return d.slice(1);
    return d;
  };
  const phoneDigits = digits10(clientPhone);
  const phoneOk = phoneDigits.length === 10;
  // Typed/pasted input is normalised then hard-capped at 10.
  const onPhoneChange = (e) => setClientPhone(digits10(e.target.value).slice(0, 10));

  const doSaveClient = () => {
    if (!clientName.trim()) return;
    let updated = [...clientLedger];
    let client = updated.find(c => c.id === activeClientId);
    if (!client) {
      client = { id: "CLI_" + Date.now().toString(36), name: clientName.trim(), phone: phoneDigits, sessions: [], createdAt: Date.now(), status: "ongoing", createdBy: authUser?.name || "—", bookedAt: null, bookedBy: null, finalSession: null };
      updated.push(client);
      setActiveClientId(client.id);
    }
    client.name = clientName.trim();
    client.phone = phoneDigits;
    client.eventDate = clientDate;
    client.venue = venue;
    client.fn = fn;
    client.shift = clientShift;
    client.brideGroom = clientBrideGroom.trim();
    client.pax = clientPax;
    // Commit 2 — multi-function: persist full functions array on the client record.
    // Function 1 mirrors the legacy top-level fields above; Functions 2+ come from extraFunctions.
    client.functions = [
      { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax },
      ...extraFunctions
    ];
    client.createdBy = client.createdBy || authUser?.name || "—";
    client.lastContactAt = Date.now();
    saveClientLedger(updated.slice(0, 500));
  };

  // ═══ TEXT COLOURS ═══ (declared first — the presentation tokens below consume them)
  // Stock `textS` (#8b8fa3) measures ~3.1:1 on the white card, and the #C9A96E accent ~2.1:1 —
  // both below WCAG AA, and it's exactly the 10–11px label/meta text that used them. These stay
  // in the same hue families, just darkened into AA range (light) / lightened (dark manage mode).
  const textM = isDark ? "#A6ADC0" : "#5A6076";  // secondary body + meta — replaces `textS`  (6.4:1)
  const textL = isDark ? "#BFC6D6" : "#474C60";  // 10px uppercase micro-labels, needs more     (8.6:1)
  const gold  = isDark ? "#D9BE86" : "#8A6A2F";  // the accent used as *text*                   (5.3:1)
  const C = {                                     // status text — decorative fills stay as-is
    green:     isDark ? "#4ADE80" : "#15803D",
    emerald:   isDark ? "#34D399" : "#047857",
    indigo:    isDark ? "#A5B4FC" : "#4338CA",
    blue:      isDark ? "#93C5FD" : "#1D4ED8",
    amber:     isDark ? "#FBBF24" : "#B45309",
    amberDeep: isDark ? "#FCD34D" : "#92400E",
    purple:    isDark ? "#D8B4FE" : "#7E22CE",
    red:       isDark ? "#FCA5A5" : "#DC2626",
  };
  // `S.label` verbatim — only the colour is lifted, so input/label geometry is untouched.
  const label = { ...S.label, color: textL };

  // ═══ PRESENTATION TOKENS ═══
  // Same theme palette as `S` (accent #C9A96E, cardBg, textP) — these only add the
  // elevation + hierarchy the flat `S.card` lacks, so the form reads as a raised sheet
  // instead of dissolving into the #FAF9F6 page background. Inputs keep `S.input`/`S.select`.
  const hairline   = isDark ? "rgba(255,255,255,0.08)" : "rgba(26,26,46,0.07)";
  // Three-layer resting elevation: contact line + mid ambient + wide soft cast, so the sheet
  // has a believable shadow on the page rather than a single flat blur.
  const liftShadow = isDark
    ? "0 1px 2px rgba(0,0,0,0.5), 0 10px 24px -12px rgba(0,0,0,0.55), 0 30px 60px -30px rgba(0,0,0,0.7)"
    : "0 1px 2px rgba(26,26,46,0.05), 0 10px 24px -12px rgba(26,26,46,0.14), 0 28px 56px -28px rgba(26,26,46,0.22)";
  const sheet      = { ...S.card, borderRadius:18, border:`1px solid ${hairline}`, boxShadow:liftShadow };
  const eyebrow    = { fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase" };
  const fnBadge    = { width:26, height:26, borderRadius:9, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:gold, background:isDark?"rgba(201,169,110,0.14)":"#FBF4E6", border:`1px solid ${accent}33` };
  const edgeBar    = { position:"absolute", left:0, top:0, bottom:0, width:3, background:`linear-gradient(180deg,${accent},${accent}44)` };

  // ═══ FUNCTION REMOVAL ═══
  // Hoisted out of the render map so the confirm dialog can invoke it. Reindexing logic is
  // verbatim from the previous inline `doDelete`.
  const removeFunction = (idx) => {
    if (idx === 0) {
      // Function 1 is not an array entry — it lives in the top-level client fields. Removing it
      // therefore means PROMOTING the next function into that slot, not splicing. Guarded by
      // canDelete so it can never run when there is nothing to promote: an event with zero
      // functions has no date, no venue and nothing to price.
      const next = extraFunctions[0];
      if (!next) return;
      setFn(next.type || "");
      setClientDate(next.date || "");
      setVenue(next.venue || "");
      setClientVenueOther(next.venueOther || "");
      setClientShift(next.shift || "");
      setClientPax(next.pax || "");
      setClientPalette(next.palette || "Custom");
      setExtraFunctions(prev => prev.slice(1));
    } else {
      setExtraFunctions(prev => prev.filter((_, i) => i !== idx - 1));
    }
    // fnBuilds is keyed by function INDEX, so every build above the removed one now belongs to the
    // wrong function. Drop the removed function's build and shift the rest down. Without this,
    // deleting function 2 silently moved function 3's zones onto function 2 — and deleting
    // function 1 would have shifted every build in the deal.
    setFnBuilds(prev => {
      const next = {};
      Object.entries(prev || {}).forEach(([k, v]) => {
        const i = Number(k);
        if (i === idx) return;                 // the removed function's own build goes with it
        next[i > idx ? i - 1 : i] = v;
      });
      return next;
    });
    if (expandedFnIdx >= idx) setExpandedFnIdx(Math.max(0, expandedFnIdx - 1));
    if (activeFnIdx >= idx) setActiveFnIdx(Math.max(0, activeFnIdx - 1)); // Commit 3 — keep pill on same semantic function after reindex
  };
  const cancelRemove = () => {
    setConfirmRemove(null);
    showMsg("Removal cancelled", "grey");
  };
  const commitRemove = () => {
    if (!confirmRemove) return;
    const { idx, type } = confirmRemove;
    removeFunction(idx);
    setConfirmRemove(null);
    showMsg(`🗑 Function ${idx + 1}${type ? ` — ${type}` : ""} removed`, "green");
  };

  // Esc closes the dialog, matching what the native confirm() used to do.
  useEffect(() => {
    if (!confirmRemove) return;
    const onKey = (e) => { if (e.key === "Escape") cancelRemove(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRemove]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continue gating — now also requires a complete 10-digit phone, not merely a non-empty one.
  const missing = [
    !clientName.trim() && "Guest name",
    !phoneOk && "Phone",
    !fn && "Event type",
  ].filter(Boolean);
  const canContinue = missing.length === 0;

  // ═══ INTERACTION LAYER ═══
  // The Studio tree is inline-styles (`S`), which can't express :hover/:focus-visible — so the
  // motion + hover states live in one scoped sheet keyed off `.ei-` classes. `!important` is
  // required because inline styles otherwise win over these rules.
  const hoverCSS = `
.ei-root{position:relative}
.ei-root > *{position:relative;z-index:1}
.ei-root > .ei-glow{z-index:0}
.ei-glow{position:absolute;top:-30px;left:-80px;right:-80px;height:420px;pointer-events:none;
  background:radial-gradient(58% 62% at 50% 0%, ${isDark?"rgba(201,169,110,0.10)":"rgba(201,169,110,0.20)"} 0%, ${isDark?"rgba(201,169,110,0)":"rgba(201,169,110,0)"} 70%);
  filter:blur(6px)}
/* Typewriter caret — only present while the sentence is still being typed. */
@keyframes eiCaret{0%,49%{opacity:1}50%,100%{opacity:0}}
.ei-caret{display:inline-block;width:1px;height:1em;margin-left:2px;vertical-align:-0.15em;
  background:${accent};animation:eiCaret 0.9s step-end infinite}
.ei-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ei-sheet{transition:box-shadow .3s ease}
.ei-sheet:hover{box-shadow:${isDark
  ? "0 1px 2px rgba(0,0,0,0.6), 0 18px 36px -12px rgba(0,0,0,0.66), 0 46px 80px -32px rgba(0,0,0,0.8)"
  : "0 1px 2px rgba(26,26,46,0.07), 0 18px 36px -12px rgba(26,26,46,0.2), 0 44px 76px -30px rgba(26,26,46,0.3)"} !important}
.ei-btn{transition:background .16s ease, border-color .16s ease, color .16s ease, box-shadow .18s ease, transform .14s ease, filter .16s ease}
.ei-btn:hover:not(:disabled){transform:translateY(-2px)}
.ei-btn:active:not(:disabled){transform:translateY(0) scale(0.98)}
.ei-btn:disabled{opacity:.55;cursor:not-allowed !important}
.ei-btn:disabled:hover{transform:none}
.ei-btn:focus-visible{outline:2px solid ${accent};outline-offset:2px}
/* Gold outline buttons (Edit, session Load) — fill in properly rather than tinting a shade. */
.ei-gold:hover:not(:disabled){background:${isDark?"rgba(201,169,110,0.22)":"#F6E7C8"} !important;border-color:${accent} !important;color:${isDark?"#F0DCB0":"#6E5321"} !important;box-shadow:0 8px 18px -6px rgba(201,169,110,0.95) !important}
.ei-ghost:hover:not(:disabled){background:${isDark?"rgba(255,255,255,0.12)":"rgba(26,26,46,0.075)"} !important;border-color:${isDark?"rgba(255,255,255,0.28)":"rgba(26,26,46,0.22)"} !important;color:${textP} !important}
.ei-danger:hover:not(:disabled){background:rgba(220,38,38,0.14) !important;border-color:rgba(220,38,38,0.55) !important;color:${isDark?"#FCA5A5":"#B91C1C"} !important;box-shadow:0 8px 18px -8px rgba(220,38,38,0.75) !important}
.ei-solid:hover:not(:disabled){filter:brightness(1.12) saturate(1.05);box-shadow:0 10px 22px -8px rgba(26,26,46,0.55) !important}
/* Dashed → solid border is the clearest possible signal on the add-function button. */
.ei-add:hover:not(:disabled){background:${isDark?"rgba(201,169,110,0.14)":"#F8EDD6"} !important;border-style:solid !important;border-color:${accent} !important;box-shadow:0 10px 24px -8px rgba(201,169,110,0.85) !important}
.ei-cta:hover:not(:disabled){filter:brightness(1.09);box-shadow:0 20px 38px -10px ${accent} !important}
.ei-tint:hover:not(:disabled){background:${isDark?"rgba(255,255,255,0.12)":"rgba(26,26,46,0.09)"} !important}
.ei-link:hover{text-decoration:underline;opacity:1;transform:none}
.ei-head{transition:background .18s ease, opacity .18s ease;border-radius:8px}
.ei-head:hover{background:${isDark?"rgba(201,169,110,0.1)":"rgba(201,169,110,0.14)"};opacity:1}
/* Rows: lift further, warm the fill, and thicken the gold edge — a shadow alone was invisible. */
.ei-row{transition:box-shadow .2s ease, border-color .2s ease, transform .16s ease, background .2s ease}
.ei-row:hover{transform:translateY(-2px);border-color:${isDark?"rgba(201,169,110,0.6)":"rgba(201,169,110,0.65)"} !important;
  background:${isDark?"rgba(201,169,110,0.09)":"#FFFCF3"} !important;
  box-shadow:${isDark?"0 16px 30px -12px rgba(0,0,0,0.78)":"0 16px 30px -12px rgba(26,26,46,0.34)"} !important}
/* Function editor card — no lift (it holds inputs), just a clearly brighter frame. */
.ei-fncard{transition:border-color .2s ease, box-shadow .2s ease}
.ei-fncard:hover{border-color:${isDark?"rgba(201,169,110,0.5)":"rgba(201,169,110,0.55)"} !important;
  box-shadow:${isDark?"0 14px 30px -16px rgba(0,0,0,0.7)":"0 14px 30px -14px rgba(201,169,110,0.85)"} !important}
/* Footer status block — highlights the outstanding-fields readout on hover. */
.ei-status{transition:background .2s ease, box-shadow .2s ease}
.ei-status:hover{background:${isDark?"rgba(255,255,255,0.04)":"#FBFAF7"};
  box-shadow:inset 0 0 0 1px ${isDark?"rgba(255,255,255,0.08)":"rgba(26,26,46,0.08)"}}
.ei-status:hover .ei-status-detail{color:${isDark?"#FCA5A5":"#B91C1C"}}
.ei-status.ei-status-ok:hover .ei-status-detail{color:${isDark?"#4ADE80":"#15803D"}}
/* Fields react to the cursor too — border only, so the resting input design is untouched. */
.ei-root input:hover:not(:disabled), .ei-root select:hover:not(:disabled){
  border-color:${isDark?"rgba(201,169,110,0.45)":"rgba(201,169,110,0.5)"} !important}
@supports (background: color-mix(in srgb, red 10%, transparent)){
  .ei-tint:hover:not(:disabled){background:color-mix(in srgb, currentColor 20%, transparent) !important}
}
@media (prefers-reduced-motion: reduce){
  .ei-btn,.ei-row,.ei-sheet,.ei-head,.ei-fncard,.ei-status{transition:none}
  .ei-btn:hover,.ei-row:hover,.ei-btn:active{transform:none}
}
`;

  // ═══ PREVIEW + FOOTER ═══
  // Extracted from the render only to keep the JSX skeleton readable — both sit in the single
  // centred column exactly where they always did.
  const DEAL_PREVIEW = clientName && (<div className="ei-sheet" style={{...sheet,marginTop:20,padding:"16px 18px 18px"}}>
      <div style={{...eyebrow,color:textM,marginBottom:12}}>Deal Preview</div>
      <div style={{display:"flex",gap:14,alignItems:"center"}}>
    <div style={{width:40,height:40,borderRadius:20,background:isDark?"rgba(201,169,110,0.12)":"#FBF4E6",border:`1px solid ${accent}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>👤</div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:14.5,fontWeight:600,color:textP,letterSpacing:-0.2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span>{clientName}</span>
        {(() => {
          const ac = clientLedger.find(c => c.id === activeClientId);
          if (!ac || !ac.lmsLeadId) return null;
          return <span style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:"rgba(34,197,94,0.15)",color:C.green}} title={`LMS Lead #${ac.lmsLeadId} · Dept: ${ac.lmsDept} · Priority: ${ac.lmsPriority || "—"} · Status: ${ac.lmsStatus || "—"}`}>📥 LMS #{ac.lmsLeadId}</span>;
        })()}
      </div>
      <div style={{fontSize:11,color:textM,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
        {clientPhone&&<span>📞 {clientPhone}</span>}
        {clientBrideGroom&&<span>💑 {clientBrideGroom}</span>}
        {(1 + extraFunctions.length) > 1 && <span style={{color:gold,fontWeight:600}}>🎉 {1 + extraFunctions.length} functions</span>}
      </div>
    </div>
      </div>
      {/* List each function as its own summary row */}
      {[0, ...extraFunctions.map((_, i) => i + 1)].map(idx => {
    const f = idx === 0
      ? { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax }
      : (extraFunctions[idx - 1] || {});
    if (!f.type && !f.date) return <div key={`pv-${idx}`} style={{fontSize:10,color:textM,marginTop:6,paddingLeft:54}}>🎉 Function {idx + 1} <span style={{opacity:0.75}}>(incomplete)</span></div>;
    return (
      <div key={`pv-${idx}`} style={{fontSize:11,color:textM,marginTop:6,paddingLeft:54,display:"flex",gap:10,flexWrap:"wrap"}}>
        <span style={{color:textP,fontWeight:600}}>🎉 {f.type || "—"}</span>
        {f.date && <span>📅 {f.date}</span>}
        {f.shift && <span>🕐 {f.shift}</span>}
        {f.venue && f.venue !== "Others" && <span>📍 {f.venue}</span>}
        {f.venue === "Others" && clientVenueOther && idx === 0 && <span>📍 {clientVenueOther}</span>}
        {f.pax && <span>👥 {f.pax}</span>}
      </div>
    );
  })}
    </div>
  );

  const FOOTER_ACTIONS = (
    <div className="ei-sheet" style={{...sheet,marginTop:22,padding:"15px 18px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <div className={`ei-status${canContinue ? " ei-status-ok" : ""}`}
    title={canContinue ? "Everything required is filled in" : `Still needed — ${missing.join(", ")}`}
    style={{flex:1,minWidth:190,padding:"7px 10px",margin:"-7px -10px",borderRadius:10}}>
    <div style={{fontSize:11.5,fontWeight:600,color:canContinue?C.green:textP,display:"flex",alignItems:"center",gap:6}}>
      <span>{canContinue ? "✓" : "•"}</span>
      <span>{canContinue ? "All required details captured" : "A few details still needed"}</span>
    </div>
    <div id="ei-gate-reason" className="ei-status-detail" style={{fontSize:10.5,color:textM,marginTop:4,lineHeight:1.5,transition:"color 0.2s ease"}}>
      {canContinue ? "You can refine any of this later from this step." : `Missing — ${missing.join(" · ")}`}
    </div>
      </div>
      <button className={`ei-btn${canContinue ? " ei-cta" : ""}`}
    // Guest name / Phone / Event type are marked required with a red asterisk, and
    // doSaveClient() already bails without a name — but the button used to advance to
    // Browse anyway, silently skipping the client save. Now the gate is real.
    disabled={!canContinue}
    aria-describedby="ei-gate-reason"
    title={canContinue ? undefined : `Missing — ${missing.join(" · ")}`}
    onClick={()=>{
    if (!canContinue) return; // defensive — `disabled` already blocks this
    doSaveClient();
    // Commit 3 hotfix — pre-seed Browse from Function 1 (the default active pill) only.
    // Previous Commit 2 polish pre-seeded ALL functions; that contradicts the new pill-is-write-target policy.
    // The sync useEffect handles subsequent pill switches.
    setActiveFnIdx(0);
    const startType = String(fn || "").trim();
    const startVenue = String(venue || "").trim();
    setFilterFn(startType ? [startType] : []);
    if (startVenue && startVenue !== "Others") {
      setBrowseVenues([startVenue]);
      if (allInhouseVenues.includes(startVenue)) setVenueGroup("inhouse");
      else if (allOutdoorDB.some(o => o.name === startVenue)) setVenueGroup("outside");
      else setVenueGroup("all");
    } else {
      setBrowseVenues([]);
    }
    setStep(1);
  }} style={{...S.btn(canContinue),fontSize:13.5,padding:"12px 30px",borderRadius:12,letterSpacing:0.1,whiteSpace:"nowrap",
    // S.btn's not-ready branch paints text in the old dim grey and 0.5 opacity compounded it
    // into unreadable — keep it visibly de-emphasised, but legible. Inline opacity also
    // deliberately overrides `.ei-btn:disabled`'s 0.55, which is too faint to read.
    ...(canContinue
      ? {boxShadow:`0 10px 24px -10px ${accent}`}
      : {color:textM,opacity:0.8,cursor:"not-allowed"})}}>Continue to Browse →</button>
    </div>
  );

  return (
    <div style={S.main}>
      <style>{hoverCSS}</style>
      <div className="ei-root" style={{maxWidth:640,margin:"0 auto",padding:"20px 0"}}>
        {/* Warm ambient cast behind the sheet — gives the form something to sit on. */}
        <div className="ei-glow" aria-hidden="true"/>
        <div style={{marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:13}}>
            {/* SVG, not the old emoji — matches the emoji-free navbar, and `gold` gives the
                glyph real contrast on the cream tile where the accent would sit at ~2:1. */}
            <div style={{width:44,height:44,borderRadius:14,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:gold,background:isDark?"rgba(201,169,110,0.12)":"linear-gradient(140deg,#FFF9EC,#F6EAD1)",border:`1px solid ${accent}38`,boxShadow:`0 6px 16px -8px ${accent}AA`}}><IconClipboard size={21}/></div>
            <div style={{minWidth:0}}>
              <div style={{...eyebrow,color:gold,marginBottom:4}}>Step 1 of 4 · Client Brief</div>
              <div style={{fontSize:23,fontWeight:700,color:textP,letterSpacing:-0.4,lineHeight:1.1}}>Event Information</div>
            </div>
          </div>
          {/* Typewriter: the hidden copy reserves the exact wrapped height so typing can't reflow
              the page, and .ei-sr carries the whole sentence for screen readers. */}
          <div style={{position:"relative",fontSize:12.5,color:textM,marginTop:11,paddingLeft:57,maxWidth:470,lineHeight:1.55}}>
            <span aria-hidden="true" style={{visibility:"hidden"}}>{SUBTITLE}</span>
            <span aria-hidden="true" style={{position:"absolute",left:57,right:0,top:0}}>
              {typedSub}{subTyping && <span className="ei-caret"/>}
            </span>
            <span className="ei-sr">{SUBTITLE}</span>
          </div>
        </div>
        <div className="ei-sheet" style={sheet}>
          {/* Gilt hairline — reads as a letterpress edge and separates the sheet from the page. */}
          <div style={{height:3,background:`linear-gradient(90deg,${accent},${accent}66 42%,transparent)`}}/>
          <div style={{padding:"15px 24px 13px",borderBottom:`1px solid ${hairline}`,background:isDark?"rgba(255,255,255,0.015)":"linear-gradient(180deg,#FEFCF8,#fff)",display:"flex",alignItems:"center",gap:9}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:accent,flexShrink:0}}/>
            <div style={{fontSize:12.5,fontWeight:700,color:textP,letterSpacing:0.1}}>Client Details</div>
            <div style={{marginLeft:"auto",...eyebrow,fontSize:9,color:textM}}>Required</div>
          </div>
          <div style={{padding:"22px 24px 26px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:18}}>
            <div><div style={label}>Guest Name <span style={{color:C.red}}>*</span></div><input value={clientName} onChange={e=>{setClientName(e.target.value);setClientSearch(e.target.value);}} placeholder="Full name" style={S.input}/></div>
            <div>
              <div style={label}>Phone <span style={{color:C.red}}>*</span></div>
              <input value={clientPhone} onChange={onPhoneChange} inputMode="numeric" autoComplete="tel"
                maxLength={10} placeholder="10-digit mobile" style={S.input}/>
            </div>
          </div>
          {/* ═══ §25 TYPEAHEAD — STRICT LMS-FIRST (29 May 2026) ═══ */}
          {/* LMS Venue+Decor search is queried first (debounced 400ms, in-memory cache).             */}
          {/* Studio clientLedger fallback shows ONLY when LMS returns 0 results OR errors out.       */}
          {/* Hidden once a client is loaded (activeClientId set).                                    */}
          {(clientName.trim().length >= 2 || clientPhone.trim().length >= 4) && !activeClientId && (() => {
            const qName = clientName.trim().toLowerCase();
            const qPhone = clientPhone.trim();
            const timeAgo = (ts) => {
              const ms = Date.now() - ts;
              const min = Math.floor(ms / 60000);
              if (min < 1) return "just now";
              if (min < 60) return `${min}m ago`;
              const hr = Math.floor(min / 60);
              if (hr < 24) return `${hr}h ago`;
              const days = Math.floor(hr / 24);
              if (days < 30) return `${days}d ago`;
              return new Date(ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
            };
            // ── LMS LOADING STATE
            if (lmsLoading) {
              return <div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(59,130,246,0.06)":"rgba(59,130,246,0.04)",border:`1px solid ${isDark?"rgba(59,130,246,0.2)":"rgba(59,130,246,0.15)"}`,display:"flex",alignItems:"center",gap:8}}>
                <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#3B82F6",animation:"pulse 1.5s infinite"}}></span>
                <span style={{fontSize:11,fontWeight:600,color:C.blue}}>🔍 Searching LMS leads…</span>
              </div>;
            }
            // ── LMS results block (shown ALONGSIDE matching Studio clients, not instead of them) ──
            const lmsBlock = (lmsLeads && lmsLeads.length > 0) ? (<div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(34,197,94,0.06)":"rgba(34,197,94,0.04)",border:`1px solid ${isDark?"rgba(34,197,94,0.25)":"rgba(34,197,94,0.2)"}`}}>
                <div style={{fontSize:11,fontWeight:600,color:C.green,marginBottom:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>📥</span><span>{lmsLeads.length} LMS lead{lmsLeads.length>1?"s":""} found — load to capture full lead context</span>
                  {lmsFilling && <span style={{fontSize:10,fontWeight:600,color:C.amber,display:"inline-flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                    <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#F59E0B",animation:"pulse 1.5s infinite"}}></span>
                    more loading…
                  </span>}
                  <button className="ei-btn ei-tint" onClick={refreshLmsSync} disabled={lmsSyncing} style={{marginLeft:"auto",padding:"2px 8px",borderRadius:4,border:"1px solid rgba(21,128,61,0.2)",background:"transparent",color:C.green,fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{lmsSyncing ? "⏳ Syncing…" : "🔄 Refresh"}</button>
                </div>
                {lmsLeads.map(lead => {
                  const deptBadgeStyle = lead.dept === "decor"
                    ? {background:"rgba(168,85,247,0.15)",color:C.purple}
                    : {background:"rgba(59,130,246,0.15)",color:C.blue};
                  return <div key={lead.id || `${lead.source}-${lead.entryNo}`} className="ei-row" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span>{lead.guestName || "(no name)"}</span>
                        {lead.phone && <span style={{color:textM,fontWeight:400}}>· {lead.phone}</span>}
                        <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,...deptBadgeStyle}}>{lead.dept === "venue" ? "VENUE" : "DECOR"} #{lead.entryNo}</span>
                        {lead.booked && <span title="Booked — this is a signed contract, not an open enquiry" style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(16,185,129,0.15)",color:C.emerald}}>BOOKED</span>}
                        {lead.priority && <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(245,158,11,0.15)",color:C.amber}}>{lead.priority.toUpperCase()}</span>}
                        {Array.isArray(lead.functions) && lead.functions.length > 1 && (
                          <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(168,85,247,0.15)",color:C.purple}}>{lead.functions.length} FUNCTIONS</span>
                        )}
                      </div>
                      <div style={{fontSize:10,color:textM,marginTop:2}}>
                        {(() => {
                          // Show all function labels + dates if multi-function, else single-function display
                          const fns = Array.isArray(lead.functions) && lead.functions.length > 0 ? lead.functions : null;
                          if (fns && fns.length > 1) {
                            return fns.map((f, i) =>
                              <span key={i}>
                                {i > 0 && " · "}
                                {f.fnLabel}{f.fnDate ? ` ${f.fnDate}` : ""}
                              </span>
                            );
                          }
                          // Single function (or legacy back-compat)
                          return <>
                            {lead.fnLabel && <>{lead.fnLabel}</>}
                            {lead.fnDate && <> · {lead.fnDate}</>}
                            {lead.venueLabel && <> · {lead.venueLabel}</>}
                            {lead.status && <> · {lead.status}</>}
                          </>;
                        })()}
                      </div>
                    </div>
                    <button className="ei-btn ei-solid" onClick={() => loadLmsLead(lead)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:"#15803D",color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
                  </div>;
                })}
              </div>
            ) : null;
            // ── Studio clientLedger matches — shown ALONGSIDE LMS, not only when LMS is empty ──
            const matches = clientLedger.filter(c => {
              if (!c.name) return false;
              const nameMatch = qName.length >= 2 && c.name.toLowerCase().includes(qName);
              const phoneMatch = qPhone.length >= 4 && (c.phone || "").includes(qPhone);
              return nameMatch || phoneMatch;
            }).slice(0, 5);
            if (!lmsBlock && matches.length === 0) {
              // Nothing from LMS or Studio — show only an explanatory note if a search was attempted.
              const note = lmsError ? "⚠ LMS unavailable — showing Studio clients"
                : lmsFilling ? "⏳ LMS cache loading… results will appear shortly"
                : (clientName.trim().length >= 2 ? "No matching LMS lead or Studio client" : null);
              if (!note) return null;
              return <div style={{marginBottom:16,padding:"8px 12px",borderRadius:8,background:isDark?"rgba(245,158,11,0.06)":"rgba(245,158,11,0.05)",border:`1px solid ${isDark?"rgba(245,158,11,0.2)":"rgba(245,158,11,0.15)"}`,fontSize:11,color:C.amberDeep,display:"flex",alignItems:"center",gap:8}}>
                <span style={{flex:1}}>{note}</span>
                <button className="ei-btn ei-tint" onClick={refreshLmsSync} disabled={lmsSyncing} style={{padding:"2px 8px",borderRadius:4,border:"1px solid rgba(180,131,9,0.2)",background:"transparent",color:C.amberDeep,fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{lmsSyncing ? "⏳ Syncing…" : "🔄 Refresh"}</button>
              </div>;
            }
            const studioBlock = matches.length > 0 ? (<div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(99,102,241,0.06)":"rgba(99,102,241,0.04)",border:`1px solid ${isDark?"rgba(99,102,241,0.2)":"rgba(99,102,241,0.15)"}`}}>
              <div style={{fontSize:11,fontWeight:600,color:C.indigo,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                <span>💡</span>
                <span style={{flex:1}}>
                  {`Found ${matches.length} existing Studio client${matches.length>1?"s":""} — load to continue previous work?`}
                </span>
                <button className="ei-btn ei-tint" onClick={refreshLmsSync} disabled={lmsSyncing} style={{padding:"2px 8px",borderRadius:4,border:"1px solid rgba(99,102,241,0.2)",background:"transparent",color:C.indigo,fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{lmsSyncing ? "⏳ Syncing…" : "🔄 Refresh"}</button>
              </div>
              {matches.map(c => {
                const latest = c.sessions?.[0];
                const sessionCount = c.sessions?.length || 0;
                return <div key={c.id} className="ei-row" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:textP}}>
                      {c.name}
                      {c.phone && <span style={{color:textM,fontWeight:400,marginLeft:8}}>· {c.phone}</span>}
                      {c.status === "booked" && <span style={{marginLeft:8,padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(16,185,129,0.15)",color:C.emerald}}>BOOKED</span>}
                      {c.status === "dead" && <span style={{marginLeft:8,padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(239,68,68,0.14)",color:"#EF4444"}}>DEAD</span>}
                      {c.lmsLeadId && <span style={{marginLeft:8,padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(34,197,94,0.15)",color:C.green}}>📥 LMS #{c.lmsLeadId}</span>}
                    </div>
                    <div style={{fontSize:10,color:textM,marginTop:2}}>
                      {sessionCount > 0
                        ? <>
                            {sessionCount} session{sessionCount>1?"s":""}
                            {latest && <> · Last: <strong style={{color:textP}}>{latest.savedBy || "—"}</strong> {timeAgo(latest.savedAt)}</>}
                            {latest?.total && <> · {fmt(latest.total)}</>}
                          </>
                        : <>No sessions saved yet</>
                      }
                    </div>
                  </div>
                  <button className="ei-btn ei-solid" onClick={() => loadClientSession(c, latest || null, 0)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:accent,color:isDark?"#1a1a2e":"#fff",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
                </div>;
              })}
            </div>) : null;
            return <>{lmsBlock}{studioBlock}</>;
          })()}
          <div><div style={label}>Bride & Groom Name</div><input value={clientBrideGroom} onChange={e=>setClientBrideGroom(e.target.value)} placeholder="e.g. Rahul & Priya" style={S.input}/></div>

          {/* ═══ FUNCTIONS ═══ Commit 2 — multi-function. Function 1 is mirrored by legacy state. ═══ */}
          <div style={{display:"flex",alignItems:"center",gap:11,marginTop:24,marginBottom:14}}>
            <div style={{...eyebrow,color:textM,whiteSpace:"nowrap"}}>Functions</div>
            <div style={{padding:"1px 7px",borderRadius:5,fontSize:9.5,fontWeight:700,color:gold,background:isDark?"rgba(201,169,110,0.14)":"#FBF4E6",border:`1px solid ${accent}33`}}>{1 + extraFunctions.length}</div>
            <div style={{height:1,flex:1,background:`linear-gradient(90deg,${hairline},transparent)`}}/>
          </div>

          {[0, ...extraFunctions.map((_, i) => i + 1)].map(idx => {
            const f = idx === 0
              ? { type: fn, date: clientDate, venue: venue, shift: clientShift, pax: clientPax }
              : (extraFunctions[idx - 1] || {});
            const isExpanded = expandedFnIdx === idx;
            const isComplete = !!(f.type && f.date);
            // Function 1 can go too, but only when there is another to promote into its slot.
            const canDelete = idx > 0 || extraFunctions.length > 0;
            const updateType = (v) => idx === 0 ? setFn(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], type: v}; return n; });
            const updateDate = (v) => idx === 0 ? setClientDate(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], date: v}; return n; });
            const updateVenue = (v) => idx === 0 ? setVenue(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], venue: v}; return n; });
            const updateShift = (v) => idx === 0 ? setClientShift(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], shift: v}; return n; });
            const updatePax = (v) => idx === 0 ? setClientPax(v) : setExtraFunctions(prev => { const n = [...prev]; n[idx-1] = {...n[idx-1], pax: v}; return n; });
            // Opens the in-app confirm dialog with a snapshot of this function, so the user can
            // see what they're about to lose instead of a bare browser alert.
            const doDelete = () => {
              if (!canDelete) return;
              setConfirmRemove({ idx, type: f.type || "", date: f.date || "", venue: f.venue || "", shift: f.shift || "", pax: f.pax || "" });
            };
            // Collapsed summary row (shown when complete and not currently expanded)
            if (!isExpanded && isComplete) {
              return (
                <div key={`fn-summary-${idx}`} className="ei-row" style={{position:"relative",overflow:"hidden",padding:"12px 14px 12px 17px",borderRadius:12,border:`1px solid ${hairline}`,background:isDark?"rgba(255,255,255,0.025)":"#fff",boxShadow:isDark?"none":"0 1px 2px rgba(26,26,46,0.05)",marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                  <div style={edgeBar}/>
                  <div style={fnBadge}>{idx + 1}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12.5,fontWeight:600,color:textP,letterSpacing:-0.1}}>{f.type}</div>
                    <div style={{fontSize:10.5,color:textM,marginTop:3,display:"flex",gap:9,flexWrap:"wrap"}}>
                      {f.date && <span>📅 {f.date}</span>}
                      {f.shift && <span>🕐 {f.shift}</span>}
                      {f.venue && <span>📍 {f.venue}</span>}
                      {f.pax && <span>👥 {f.pax} pax</span>}
                    </div>
                  </div>
                  <button className="ei-btn ei-gold" onClick={() => setExpandedFnIdx(idx)} style={{fontSize:10,fontWeight:600,padding:"5px 11px",borderRadius:8,border:`1px solid ${accent}40`,background:isDark?"transparent":"#FFFDF8",color:gold,cursor:"pointer",whiteSpace:"nowrap"}}>✏️ Edit</button>
                  {canDelete && <button className="ei-btn ei-danger" onClick={doDelete} title="Remove function" style={{fontSize:11,padding:"5px 8px",borderRadius:8,border:`1px solid ${hairline}`,background:"transparent",color:C.red,cursor:"pointer"}}>✕</button>}
                </div>
              );
            }
            // Expanded form view
            const venueVal = [...allInhouseVenues, "Others", ...allOutdoorDB.map(v => v.name)].includes(f.venue) ? f.venue : (f.venue ? "Others" : "");
            return (
              <div key={`fn-form-${idx}`} className="ei-fncard" style={{position:"relative",overflow:"hidden",padding:"17px 19px 20px",borderRadius:14,border:`1px solid ${accent}2E`,background:isDark?"linear-gradient(180deg,rgba(201,169,110,0.055),rgba(201,169,110,0.02))":"linear-gradient(180deg,#FFFCF4,#fff 62%)",boxShadow:isDark?"none":`0 8px 24px -14px ${accent}99`,marginBottom:12}}>
                <div style={edgeBar}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    <div style={fnBadge}>{idx + 1}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:700,color:textP,letterSpacing:-0.1}}>Function {idx + 1}</div>
                      <div style={{fontSize:10,color:textM,marginTop:2}}>Type, date, venue &amp; guest count</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {isComplete && <button className="ei-btn ei-ghost" onClick={() => setExpandedFnIdx(null)} style={{fontSize:10,fontWeight:600,padding:"5px 10px",borderRadius:8,border:`1px solid ${hairline}`,background:"transparent",color:textM,cursor:"pointer"}}>Collapse</button>}
                    {canDelete && <button className="ei-btn ei-danger" onClick={doDelete} style={{fontSize:10,fontWeight:600,padding:"5px 10px",borderRadius:8,border:`1px solid ${hairline}`,background:"transparent",color:C.red,cursor:"pointer"}}>✕ Remove</button>}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:12}}>
                  <div><div style={label}>Event Type <span style={{color:C.red}}>*</span></div><select value={f.type || ""} onChange={e => updateType(e.target.value)} style={{...S.select,width:"100%"}}><option value="">Select event type</option>{taxOr(taxonomy.eventType, FUNCTIONS).map(et => <option key={et} value={et}>{et}</option>)}</select></div>
                  <div><div style={label}>Event Date</div><input type="date" value={f.date || ""} onChange={e => updateDate(e.target.value)} style={S.input}/></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:f.venue === "Others" && idx === 0 ? 0 : 12}}>
                  <div><div style={label}>Venue</div>
                    <select value={venueVal} onChange={e => {
                      const v = e.target.value;
                      if (v === "Others") {
                        if (idx === 0) { updateVenue("Others"); setClientVenueOther(""); }
                        // Function 2+: "Others" not supported here — pre-add the venue via Venue Admin
                        // or inherit from Function 1. Silently ignore the selection.
                      } else {
                        updateVenue(v);
                        if (idx === 0) setClientVenueOther("");
                      }
                    }} style={{...S.select,width:"100%"}}>
                      <option value="">Select venue</option>
                      {allInhouseGroups.map(g => <optgroup key={g.parent} label={`Ambria ${g.parent}`}>{g.subVenues.map(sv => <option key={sv} value={sv}>{sv}</option>)}</optgroup>)}
                      {allOutdoorDB.filter(v => v.empanelled).length > 0 && <optgroup label="Empanelled Outside Venues">{allOutdoorDB.filter(v => v.empanelled).map(v => <option key={v.name} value={v.name}>{v.name} ★</option>)}</optgroup>}
                      {allOutdoorDB.filter(v => !v.empanelled).length > 0 && <optgroup label="Other Outside Venues">{allOutdoorDB.filter(v => !v.empanelled).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</optgroup>}
                      {idx === 0 && <option value="Others">Others (type custom)</option>}
                    </select>
                  </div>
                  <div><div style={label}>Shift</div><select value={f.shift || ""} onChange={e => updateShift(e.target.value)} style={{...S.select,width:"100%"}}><option value="">Select shift</option>{CLIENT_SHIFTS_DD.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                </div>
                {venueVal === "Others" && idx === 0 && (() => {
                  // Duplicate check: does the typed custom name match any known venue (case-insensitive, trimmed)?
                  // Known = inhouse + all outside (empanelled OR other) + any trVenues entry.
                  const typedLc = (clientVenueOther || "").trim().toLowerCase();
                  const matchName = !typedLc ? null : (
                    allInhouseVenues.find(v => v.toLowerCase() === typedLc) ||
                    (allOutdoorDB.find(v => (v.name || "").toLowerCase() === typedLc) || {}).name ||
                    (trVenues.find(v => (v.name || "").toLowerCase() === typedLc) || {}).name ||
                    null
                  );
                  return (
                  <>
                    <div style={{marginTop:10,marginBottom:matchName?6:12}}>
                      <div style={label}>Venue Name</div>
                      <input value={clientVenueOther} onChange={e => { setClientVenueOther(e.target.value); if (e.target.value) setVenue(e.target.value); }} onBlur={matchName ? undefined : autoPersistCustomVenue} placeholder="Enter venue name" style={{...S.input, ...(matchName ? {borderColor:"#EF4444"} : {})}}/>
                    </div>
                    {matchName && <div style={{marginBottom:12,padding:"8px 12px",borderRadius:8,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",fontSize:11,color:C.red,display:"flex",gap:8,alignItems:"flex-start"}}>
                      <span style={{fontSize:13}}>⚠️</span>
                      <div>
                        <strong>"{matchName}"</strong> is already in your venue list — please select it from the dropdown above instead of typing.
                      </div>
                    </div>}
                    {/* Option C — Inline transport pricing. Hidden when typed name duplicates an existing venue (prevents ghost entries). */}
                    {!matchName && <div style={{marginTop:0,marginBottom:12,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(245,158,11,0.06)":"#FFFBF0",border:`1px solid ${isDark?"rgba(245,158,11,0.2)":"#FDE68A"}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:C.amber,marginBottom:6}}>⚠️ New venue — estimate transport cost</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
                        <div>
                          <div style={{...label,fontSize:10}}>Est. trip rate (₹ per truck)</div>
                          <input type="number" min="0" value={customTripRate||""} onChange={e=>setCustomTripRate(Number(e.target.value)||0)} onBlur={autoPersistCustomVenue} placeholder="e.g. 5000" style={S.input}/>
                        </div>
                        <div>
                          <div style={{...label,fontSize:10}}>Gensets needed (125 KVA)</div>
                          <input type="number" min="0" step="1" value={customGensets!==null?customGensets:""} onChange={e=>{const v=e.target.value;setCustomGensets(v===""?null:Number(v)||0);}} onBlur={autoPersistCustomVenue} placeholder="1" style={S.input}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:textM,marginTop:4,lineHeight:1.5}}>Used for transport + genset calculation on Build. Admin can refine these in Pricing → Transport later.</div>
                    </div>}
                  </>
                  );
                })()}
                <div style={{maxWidth:200}}><div style={label}>Pax (Guests)</div><input type="number" value={f.pax || ""} onChange={e => updatePax(e.target.value)} placeholder="e.g. 500" style={S.input}/></div>
                {/* §23 Phase 2.9c — Palette is now auto-set from selected video's YT tag, no Event Info dropdown */}
              </div>
            );
          })}

          <button className="ei-btn ei-add" onClick={() => {
            setExtraFunctions(prev => [...prev, { type: "", date: "", venue: venue || "", shift: "", pax: "" }]);
            setExpandedFnIdx(1 + extraFunctions.length);
          }} style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1px dashed ${accent}55`,background:isDark?"rgba(201,169,110,0.04)":"#FFFCF4",color:gold,cursor:"pointer",fontSize:12,fontWeight:600,marginTop:6,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <span style={{width:18,height:18,borderRadius:"50%",border:`1px solid ${accent}55`,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,lineHeight:1}}>+</span>
            Add Another Function
          </button>
          </div>
        </div>
        {DEAL_PREVIEW}
        {/* ═══ SESSION HISTORY — moved to the bottom, collapsed by default to reduce clutter. ═══ */}
        {activeClient && activeClient.sessions && activeClient.sessions.length > 0 && (() => {
          const sessions = activeClient.sessions;
          const visible = sessionHistoryExpanded ? sessions.slice(0, 20) : sessions.slice(0, 5);
          const timeAgo = (ts) => {
            const ms = Date.now() - ts;
            const min = Math.floor(ms / 60000);
            if (min < 1) return "just now";
            if (min < 60) return `${min}m ago`;
            const hr = Math.floor(min / 60);
            if (hr < 24) return `${hr}h ago`;
            const days = Math.floor(hr / 24);
            if (days < 30) return `${days}d ago`;
            return new Date(ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
          };
          const fmtDate = (d) => {
            if (!d) return "—";
            try { return new Date(d+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short"}); } catch { return d; }
          };
          return <div style={{marginTop:20,padding:"4px 15px 13px",borderRadius:14,background:isDark?"rgba(201,169,110,0.04)":"linear-gradient(180deg,#FFFCF4,#fff 70%)",border:`1px solid ${isDark?"rgba(201,169,110,0.15)":`${accent}2E`}`,boxShadow:isDark?"none":`0 8px 24px -16px ${accent}99`}}>
            <div className="ei-head" onClick={() => setSessionHistoryOpen(o => !o)} style={{padding:"8px 0",cursor:"pointer",fontSize:11,fontWeight:700,color:gold,display:"flex",alignItems:"center",gap:6,textTransform:"uppercase",letterSpacing:0.5}}>
              <span>📋</span>
              <span style={{flex:1}}>Session History — {sessions.length} meeting{sessions.length>1?"s":""}</span>
              <span style={{fontSize:10}}>{sessionHistoryOpen ? "▲ Hide" : "▼ Show"}</span>
            </div>
            {sessionHistoryOpen && <div style={{marginTop:6}}>
              {visible.map((s, si) => <div key={s.id || si} className="ei-row" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 10px",marginBottom:4,borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${border}`}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:textP,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span>{new Date(s.savedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
                    <span style={{color:textM,fontWeight:400,fontSize:10}}>({timeAgo(s.savedAt)})</span>
                    <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:`${accent}25`,color:gold}}>by {s.savedBy || "—"}</span>
                    {si === 0 && <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:"rgba(16,185,129,0.15)",color:C.emerald}}>LATEST</span>}
                  </div>
                  <div style={{fontSize:10,color:textM,marginTop:3}}>
                    {s.venue && <span>📍 {s.venue}</span>}
                    {s.eventDate && <span> · 📅 {fmtDate(s.eventDate)}</span>}
                    {s.fn && <span> · {s.fn}</span>}
                    {s.total && <span style={{color:textP,fontWeight:600}}> · {fmt(s.total)}</span>}
                    {s.tier && <span style={{color:textM}}> {s.tier}</span>}
                  </div>
                </div>
                <button className="ei-btn ei-gold" onClick={() => {
                  if (!confirm(`Load session from ${new Date(s.savedAt).toLocaleString("en-IN")} by ${s.savedBy||"—"}?\n\nAny unsaved changes will be replaced.`)) return;
                  loadClientSession(activeClient, s, 0);
                }} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:gold,fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Load →</button>
              </div>)}
              {sessions.length > 5 && <button className="ei-btn ei-link" onClick={() => setSessionHistoryExpanded(!sessionHistoryExpanded)} style={{marginTop:4,padding:"4px 10px",fontSize:10,color:gold,background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>
                {sessionHistoryExpanded ? `↑ Show fewer (5)` : `↓ Show all ${sessions.length} sessions`}
              </button>}
            </div>}
          </div>;
        })()}
        {FOOTER_ACTIONS}
      </div>

      <RemoveFunctionDialog
        snap={confirmRemove} onCancel={cancelRemove} onConfirm={commitRemove}
        S={S} sheet={sheet} hairline={hairline} textP={textP} textM={textM} isDark={isDark}
      />
    </div>
  );
}

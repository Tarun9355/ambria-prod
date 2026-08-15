import { useState, useEffect } from "react";
import { taxOr, FUNCTIONS, CLIENT_SHIFTS_DD } from "../../../lib/studio/taxonomy";
import { IconClipboard } from "../../../components/icons.jsx";

// The brand panel's right edge, in objectBoundingBox units (0–1 on both axes) so it stretches with
// the panel rather than being fixed to pixels. Full width at top and bottom, drawn in to a waist at
// x=0.80 mid-height — a lean rather than the deep scoop it started as. The two control points
// either side of the waist are near-vertical, which is what keeps the join smooth instead of
// showing a kink at the narrowest point.
const BRAND_CURVE = "M0,0 H1 C1,0.18 0.81,0.28 0.80,0.46 C0.79,0.66 1,0.82 1,1 H0 Z";
// The yellow from the supplied logo artwork, kept separate from the app's #C9A96E accent. Only the
// two marks that are yellow in the logo use it — the dot over the I, and DESIGN & DECOR. The rim,
// rule, blobs and motes stay on the app accent so the panel still reads as one piece.
const LOGO_GOLD = "#F2B830";
// ═══ BACKGROUND RIPPLE ═══
// One long wave line: alternating half-period cubics, each one a smooth crest or trough, so the
// curve stays continuous rather than showing a corner at every join.
const ripplePath = (y, amp, period, width) => {
  const half = period / 2;
  let d = `M0 ${y}`;
  for (let x = 0, up = true; x < width; x += half, up = !up) {
    const cy = up ? y - amp : y + amp;
    d += ` C${(x + half / 3).toFixed(1)} ${cy} ${(x + (half * 2) / 3).toFixed(1)} ${cy} ${(x + half).toFixed(1)} ${y}`;
  }
  return d;
};
// Broad soft bands, not drawn lines — each is the same wave carrying a 100-odd unit stroke, so it
// reads as a ribbon of colour rather than a contour. Long periods (800–1300 against a 1200 canvas)
// keep them to roughly one lazy swell across the page instead of a ripple pattern; a short period
// at this width is what made the previous attempt look like corrugation.
// Drawn 1800 wide against a 1200 canvas — the bands drift horizontally, and the overhang is what
// keeps a swept end from wandering into frame.
const BANDS = [
  { y: 110, amp: 44, period:  920, w: 132, c: "#C9A96E", o: 0.40 },
  { y: 296, amp: 62, period: 1180, w: 104, c: "#D69E8C", o: 0.34 },
  { y: 470, amp: 38, period:  800, w: 150, c: "#C9A96E", o: 0.27 },
  { y: 654, amp: 68, period: 1320, w: 118, c: "#7C5CD6", o: 0.24 },
  { y: 836, amp: 46, period:  880, w: 140, c: "#C9A96E", o: 0.33 },
].map((b) => ({ ...b, d: ripplePath(b.y - 60, b.amp, b.period, 1800) }));
// ═══ THE LOGO FILE ═══
// Drop the artwork at src/assets/ambria-logo.(svg|png|webp|jpg) and the panel renders it instead of
// the type-set fallback below. Adding it is a file, not a code change.
// import.meta.glob rather than a plain import — the same reason StudioSummary uses it for the deck
// backgrounds: a direct import of a file that isn't there fails the BUILD, so nobody could deploy
// until the asset existed. A glob resolves to {} and the fallback simply keeps rendering.
const LOGO_ASSET = Object.values(
  import.meta.glob("../../../assets/ambria-logo.{svg,png,webp,jpg,jpeg}", { eager: true, query: "?url", import: "default" })
)[0] || null;
// ═══ THE PANEL PHOTOGRAPH ═══
// Drop it at src/assets/ambria-panel.(jpg|jpeg|png|webp) and the panel is drawn on it instead of
// the flat gradient. Same glob-not-import reasoning as the logo above.
// The name deliberately avoids a "-bg" suffix: StudioSummary globs "*-bg.{png,jpg,jpeg,webp}" out
// of this SAME folder and reads the part before "-bg" as an EVENT TYPE, so a file called
// panel-bg.jpg would silently invent an event type named "panel" in the deck renderer.
const PANEL_BG = Object.values(
  import.meta.glob("../../../assets/ambria-panel.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" })
)[0] || null;
// Motes drifting up the brand panel. Hand-placed, NOT randomised: this component re-renders on
// every keystroke in the form, and Math.random() here would re-roll each one mid-flight so the
// whole field would visibly jump while you typed a guest's name.
const MOTES = [
  { left:  8, size: 3,   dur: 15, delay:  0,   op: 0.5  },
  { left: 21, size: 2,   dur: 19, delay:  3.5, op: 0.38 },
  { left: 34, size: 4,   dur: 13, delay:  7,   op: 0.55 },
  { left: 47, size: 2.5, dur: 21, delay:  1.5, op: 0.32 },
  { left: 58, size: 3,   dur: 16, delay:  9,   op: 0.48 },
  { left: 69, size: 2,   dur: 24, delay:  5,   op: 0.3  },
  { left: 80, size: 3.5, dur: 14, delay: 11,   op: 0.52 },
  { left: 91, size: 2,   dur: 18, delay:  2,   op: 0.36 },
];

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
  // Pending function-removal — holds a snapshot of what's being removed so the dialog can
  // show it. null = no dialog open. Replaces the native confirm() this used to fire.
  const [confirmRemove, setConfirmRemove] = useState(null);
  // LMS leads and Studio clients default to "mine only" (see the salesperson filter below) —
  // this is the escape hatch for sitting in on a colleague's meeting. Resets to false each time
  // the component mounts fresh (not persisted), so nobody is silently stuck in "all" mode later.
  const [showAllReps, setShowAllReps] = useState(false);

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
    activeClient, loadClientSession, startNewDeal, askConfirm,
    loadedClientIdentityRef, confirmClientRename, revertClientNameEdit,
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
  const textL = isDark ? "#E8EBF2" : "#14141F";  // 10px uppercase field labels — full ink       (15:1)
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
  // `S.label` verbatim except the colour, so input/label geometry is untouched. These sit at full
  // ink now rather than the grey they carried: at 10px uppercase they're the only thing naming
  // each field, so they earn the contrast even though micro-labels are conventionally muted.
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
  // ═══ HEADING FILL ═══
  // Every heading on the page is a filled deep-ink bar with gold on it — the brand panel's own two
  // colours. Ties the form to the panel instead of leaving a cream card system sitting beside an
  // unrelated dark one. Deliberately only the HEADS: filling the card bodies too would turn a form
  // people type in all day into a dark UI, which is a different decision entirely.
  const headFill = isDark ? "linear-gradient(180deg,#17142B,#100E1F)" : "linear-gradient(180deg,#221C42 0%,#15122A 100%)";
  const headText = "#F5F1E7";                        // warm off-white, not #fff — #fff on this ink reads clinical
  const headMeta = "rgba(201,169,110,0.85)";         // the accent, held back so it doesn't fight the title
  // Card head — the gilt rule + dotted title row shared by every sheet on the page.
  const sheetHead  = { padding:"14px 24px 13px", borderBottom:`1px solid rgba(201,169,110,0.22)`, background:headFill, display:"flex", alignItems:"center", gap:9, position:"relative", overflow:"hidden" };
  const giltRule   = { height:3, background:`linear-gradient(90deg,${accent},${accent}66 42%,transparent)` };
  // Gold-on-ink counterpart to fnBadge, for the badges that now sit on a filled head.
  const fnBadgeDark = { ...fnBadge, color:accent, background:"rgba(201,169,110,0.16)", border:`1px solid ${accent}55` };
  // ═══ HEAD WAVE ═══
  // Three translucent colour waves drifting through the heading bar at different speeds — gold,
  // violet and a warm rose, the page's own palette. Filled bodies rather than drawn lines: on a
  // dark ground, overlapping translucent fills mix into each other and read as depth, where
  // strokes just read as stripes.
  // Each wave is one 400-unit cycle drawn TWICE (800 wide) and travelling exactly -400. Landing on
  // a whole period is what makes the loop seamless — anything else snaps back visibly every pass.
  // The three durations are deliberately not multiples of one another, so the layers drift in and
  // out of phase and the pattern never visibly repeats.
  const WAVE_BODY = "C66 23 134 23 200 34 C266 45 334 45 400 34 C466 23 534 23 600 34 C666 45 734 45 800 34";
  const HEAD_WAVE = (
    <svg className="ei-head-wave" viewBox="0 0 400 56" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="ei-wave ei-wave-1" fill={accent} fillOpacity=".18"
        d={`M0 34 ${WAVE_BODY} L800 56 L0 56 Z`}/>
      <path className="ei-wave ei-wave-2" fill="#7C5CD6" fillOpacity=".26"
        d="M0 44 C66 34 134 34 200 44 C266 54 334 54 400 44 C466 34 534 34 600 44 C666 54 734 54 800 44 L800 56 L0 56 Z"/>
      <path className="ei-wave ei-wave-3" fill="#D69E8C" fillOpacity=".16"
        d="M0 26 C66 13 134 13 200 26 C266 39 334 39 400 26 C466 13 534 13 600 26 C666 39 734 39 800 26 L800 56 L0 56 Z"/>
    </svg>
  );

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

  // Continue gating — requires a complete 10-digit phone, not merely a non-empty one, and a date.
  // Scope is Function 1, matching where Event Type is already enforced. Functions 2+ are checked by
  // neither, so a half-filled extra function can't lock the deal shut — see the note by the Event
  // Date asterisk in the function card.
  const missing = [
    !clientName.trim() && "Guest name",
    !phoneOk && "Phone",
    !fn && "Event type",
    !clientDate && "Event date",
  ].filter(Boolean);
  const canContinue = missing.length === 0;

  // ═══ INTERACTION LAYER ═══
  // The Studio tree is inline-styles (`S`), which can't express :hover/:focus-visible or media
  // queries — so motion, hover states AND the page's responsive skeleton live in one scoped sheet
  // keyed off `.ei-` classes. `!important` is required because inline styles otherwise win.
  const hoverCSS = `
.ei-root{position:relative}
.ei-root > *{position:relative;z-index:1}
.ei-root > .ei-glow{z-index:0}
/* Ambient gold wash where the header used to sit. Without it the page starts on bare cream and
   the whole screen reads as unfinished rather than deliberately bare. */
/* top:0, not the -140px this used to sit at: the brief now scrolls inside .ei-formside, and
   anything above that box's content edge is clipped by its own overflow. The gradient's focus is
   already at 50% 0%, so the brightest part lands on the top edge either way. */
.ei-glow{position:absolute;top:0;left:0;right:0;height:520px;pointer-events:none;
  background:radial-gradient(52% 58% at 50% 0%, ${isDark?"rgba(201,169,110,0.13)":"rgba(201,169,110,0.24)"} 0%, ${isDark?"rgba(201,169,110,0)":"rgba(201,169,110,0)"} 72%);
  filter:blur(8px);animation:eiBreathe 13s ease-in-out infinite}
@keyframes eiBreathe{0%,100%{opacity:.78;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
/* ── PAGE SKELETON ──
   --ei-pw is the panel's width: the offset the brief is pushed by and the wash blobs are anchored
   from. It drops to 0 where the panel is hidden, so everything re-anchors off one number.
   The panel is FIXED and lives outside .ei-split, not sticky inside it. Sticky was the obvious
   choice and it worked until .ei-split needed overflow-x:clip — an ancestor with non-visible
   overflow becomes the sticky scroll container, and since .ei-split doesn't scroll, the panel
   quietly stopped sticking and scrolled away as a 100vh block in the flow. That also padded the
   document: a 100vh flex item floors the container's height even once the content is shorter.
   Fixed takes it out of flow entirely, so neither can happen again.
   overflow-x:clip and not hidden: hidden would make .ei-split a scroll container of its own. */
/* Panel width lives here and nowhere else — the panel, its cast shadow, the brief's left offset and
   the wash blobs' anchors all read it, so widening the panel is this one number. */
.ei-view{--ei-pw:560px}
/* THE PAGE DOES NOT SCROLL. Locked to exactly one viewport, so the panel, the wash and the whole
   frame hold still. The brief is the only thing that moves, and it moves inside its own column —
   which it has to, because a deal with four functions and a list of LMS matches is taller than any
   screen. Without this the entire page scrolled as one, dragging the panel and the background up
   with it. Nothing here may use min-height: the moment the content can push the frame taller than
   100vh, the document scrolls again and we're back to the same behaviour. */
.ei-split{position:relative;height:100vh;overflow:hidden}
.ei-formside{margin-left:var(--ei-pw);min-width:0;position:relative;z-index:1;
  height:100vh;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
/* Bottom padding is breathing room at the end of the column's own scroll, not clearance for a
   page scrollbar any more — 110px of it just read as dead space. */
.ei-shell{max-width:720px;margin:0 auto;padding:22px 26px 44px;position:relative;z-index:1}
/* ── AMBIENT WASH ── the same idea as the panel's blobs. Three big colour fields drifting on long
   mismatched loops (37/47/41s) so they never line up into a pattern you'd notice.
   Offsets are in px from the top, NOT percentages: this column is as tall as the deal is long, so
   a blob at "top:34%" lands somewhere past the fold on a four-function wedding and is never seen.
   Each also pulses its own opacity — on a field this soft, a slow fade reads as movement far more
   than the drift does. They sit under the cards, which keep their own shadows and stay legible.
   Spans the WHOLE split, not just the form column: the panel's curve cuts into its own column, and
   whatever it gives back has to be washed cream like the rest. Scoped to the form column it left a
   hard vertical seam down the page at x=500 — washed on one side, bare root cream on the other. */
   Smudged, not stacked: the layer carries the page colour itself and the fields sit on it in
   mix-blend-mode:multiply, so where two overlap they mix into a deeper pigment the way wet media
   would, instead of reading as two separate lights laid over each other. The blend needs a real
   backdrop to act on — hence the background here, and it has to be on THIS element because z-index
   isolates the children's blending to inside it. */
.ei-wash{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  background:${isDark?"#0F0F1A":"#FAF9F6"}}
/* Irregular radii instead of circles, and heavy blur. The shapes are static — only transform
   animates. Morphing border-radius would repaint an 80px-blurred 720px box every frame; rotating
   an already-lopsided shape reads as the same slow churn and stays on the compositor. */
.ei-wash span{position:absolute;display:block;filter:blur(80px);mix-blend-mode:multiply}
.ei-wash-a{width:760px;height:700px;top:-190px;left:calc(var(--ei-pw) - 150px);
  border-radius:62% 38% 46% 54% / 54% 47% 53% 46%;
  background:radial-gradient(circle,rgba(201,169,110,0.38) 0%,rgba(201,169,110,0) 70%);
  animation:eiWashA 37s ease-in-out infinite}
.ei-wash-b{width:640px;height:700px;top:110px;right:-170px;
  border-radius:41% 59% 66% 34% / 38% 62% 38% 62%;
  background:radial-gradient(circle,rgba(214,158,140,0.32) 0%,rgba(214,158,140,0) 72%);
  animation:eiWashB 47s ease-in-out infinite}
.ei-wash-c{width:740px;height:660px;top:540px;left:calc(var(--ei-pw) + 12%);
  border-radius:55% 45% 33% 67% / 61% 39% 61% 39%;
  background:radial-gradient(circle,rgba(124,92,214,0.20) 0%,rgba(124,92,214,0) 74%);
  animation:eiWashC 41s ease-in-out infinite}
/* Wave bands. Blurred hard, which is what turns five stroked paths into folds of light rather than
   five fat curves — without it the round stroke ends and the constant width give the trick away.
   Static, so the blur is rasterised once and never recomputed.
   Sits under the grain, so the chalk falls over it and it reads as printed into the surface. */
.ei-ripple{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:blur(24px)}
/* Each band swells on its own clock. The alternate direction is doing real work here: it plays the
   keyframes backwards on the return leg, so the motion reverses smoothly and never has to land
   back on its start. A seamless forward loop would mean translating by exactly one wave period,
   and every band has a different period — five bespoke keyframe sets to avoid a snap that
   alternate removes for free. The durations share no common factor, so the five never line up
   into a single pulse. */
.ei-band{transform-box:view-box;transform-origin:center;will-change:transform}
.ei-band-0{animation:eiBand0 34s ease-in-out infinite alternate}
.ei-band-1{animation:eiBand1 45s ease-in-out infinite alternate}
.ei-band-2{animation:eiBand2 38s ease-in-out infinite alternate}
.ei-band-3{animation:eiBand3 53s ease-in-out infinite alternate}
.ei-band-4{animation:eiBand4 41s ease-in-out infinite alternate}
@keyframes eiBand0{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-72px,18px) scaleY(1.1)}}
@keyframes eiBand1{from{transform:translate(0,0) scaleY(1.06)}to{transform:translate(86px,-24px) scaleY(0.94)}}
@keyframes eiBand2{from{transform:translate(0,0) scaleY(0.96)}to{transform:translate(-94px,14px) scaleY(1.12)}}
@keyframes eiBand3{from{transform:translate(0,0) scaleY(1.08)}to{transform:translate(64px,-30px) scaleY(0.95)}}
@keyframes eiBand4{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-78px,22px) scaleY(1.09)}}
/* ── HEAD WAVE ── An absolutely positioned child paints above in-flow siblings regardless of DOM
   order, so without lifting the row's own content the wave would sit ON TOP of the title. Hence
   z-index 1 on the children and 0 on the wave, with the wave's selector made more specific so it
   wins over the blanket child rule. The mask fades it out across the left 40%, where the titles
   are — a decoration behind a heading has to get out of the heading's way. */
.ei-headrow > *{position:relative;z-index:1}
.ei-headrow > .ei-head-wave{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,transparent 28%,rgba(0,0,0,.55) 58%,#000 100%);
  mask-image:linear-gradient(90deg,transparent 0%,transparent 28%,rgba(0,0,0,.55) 58%,#000 100%)}
/* transform-box:view-box pins the transform to the viewBox's units, so translateX(-400px) means
   400 USER units — exactly one wave period — and not 400 screen pixels. Without it the distance
   would depend on how wide the bar happens to be and the loop would jump. */
.ei-wave{transform-box:view-box;transform-origin:0 0;will-change:transform}
.ei-wave-1{animation:eiWaveDrift 19s linear infinite}
.ei-wave-2{animation:eiWaveDrift 27s linear infinite}
.ei-wave-3{animation:eiWaveDrift 23s linear infinite reverse}
@keyframes eiWaveDrift{from{transform:translateX(0)}to{transform:translateX(-400px)}}
/* Grain, tiled from a 220px turbulence tile so it's one small paint rather than a full-page
   filter. This is what stops the blend reading as clean airbrush and pushes it toward chalk. */
.ei-grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.28'/%3E%3C/svg%3E");
  background-size:220px 220px}
@keyframes eiWashA{0%,100%{transform:translate(0,0) rotate(0deg) scale(1);opacity:.75}
  50%{transform:translate(130px,90px) rotate(26deg) scale(1.22);opacity:1}}
@keyframes eiWashB{0%,100%{transform:translate(0,0) rotate(0deg) scale(1.14);opacity:1}
  50%{transform:translate(-150px,120px) rotate(-32deg) scale(0.88);opacity:.6}}
@keyframes eiWashC{0%,100%{transform:translate(0,0) rotate(0deg) scale(0.95);opacity:.65}
  50%{transform:translate(110px,-95px) rotate(21deg) scale(1.2);opacity:1}}
/* One centred column, read top to bottom: who the deal is for, what they're holding, then the
   way forward. Side-by-side cards left too much dead air under whichever column ran short. */
.ei-stack{display:flex;flex-direction:column;gap:18px;min-width:0}
/* min-width:0 on the children matters: a 1fr track floors at the item's min-content width, and a
   select measures that against its LONGEST option — the venue list has some long ones, which was
   forcing the tracks (and the page) wider than the column. */
.ei-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.ei-two > *{min-width:0}
.ei-two select,.ei-two input{max-width:100%}
/* ══ BRAND PANEL ══
   Every moving layer animates transform/opacity only, so none of it triggers layout while typing. */
/* The right edge is a curve, not a straight line — clip-path in objectBoundingBox units so the
   shape scales with the panel instead of being pinned to pixel coordinates. The panel is wider than
   it looks because the curve eats into it: at the waist (80% across) only four fifths of the width
   survives, and the mark has to sit inside THAT. Hence justify-content:flex-start with the inner
   block centred on the narrow band — centring on the full width would drift it into the curve.
   Sits outside .ei-split so no ancestor overflow rule can clip it or govern its positioning. */
/* The shadow the curved edge casts onto the page.
   Not box-shadow: that draws on the border box and the clip-path then cuts it away, so it would
   trace a rectangle rather than the curve. Not filter:drop-shadow on the panel either — that would
   re-rasterise a full-height column holding a photograph, three blurred layers and a moving sheen on
   every animation frame. This is the same path, filled once and blurred, parked behind the panel
   and in front of the page. Nothing in it animates, so it costs nothing after first paint.
   Sits at z-index 2 — above the form column (1) so the shadow actually falls on the page, below
   the panel (3) so the panel covers everything but the bleed past its edge. */
.ei-brand-shadow{position:fixed;top:0;left:0;width:var(--ei-pw);height:100vh;z-index:2;pointer-events:none;
  filter:blur(20px);opacity:.45;transform:translateX(7px)}
.ei-brand-shadow svg{display:block;width:100%;height:100%}
.ei-brand{position:fixed;top:0;left:0;width:var(--ei-pw);height:100vh;overflow:hidden;z-index:3;
  background:linear-gradient(150deg,#0F0F1A 0%,#191430 46%,#2d1b69 100%);
  display:flex;align-items:center;justify-content:flex-start;isolation:isolate;
  clip-path:url(#eiBrandCurve)}
.ei-brand-defs{position:absolute;width:0;height:0;pointer-events:none}
/* Gold rim tracing the curve. It's inside the clipped panel, so the outer half of the stroke is
   cut away — width 3 to leave ~1.5px showing. non-scaling-stroke keeps it even, since the
   viewBox is squashed from 1×1 to 500×viewport and would otherwise smear the line. */
.ei-brand-edge{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none}
.ei-brand-blob{position:absolute;border-radius:50%;pointer-events:none;filter:blur(46px)}
.ei-blob-a{width:430px;height:430px;top:-120px;left:-140px;
  background:radial-gradient(circle,rgba(201,169,110,0.42) 0%,rgba(201,169,110,0) 70%);
  animation:eiDriftA 21s ease-in-out infinite}
.ei-blob-b{width:380px;height:380px;bottom:-110px;right:-130px;
  background:radial-gradient(circle,rgba(139,115,85,0.5) 0%,rgba(45,27,105,0) 72%);
  animation:eiDriftB 27s ease-in-out infinite}
/* object-fit via background-size:cover — the panel is a tall, narrow column, so any photo
   has to be centre-cropped to it rather than letterboxed.
   Ken Burns: a 46s drift so slow you register it as depth rather than movement. It never scales
   below 1.06, because at 1.0 a fractional rounding on the transform can expose a hairline of panel
   down one edge. */
.ei-brand-img{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center;
  animation:eiKen 46s ease-in-out infinite alternate}
@keyframes eiKen{0%{transform:scale(1.06)}100%{transform:scale(1.17) translateY(-2%)}}
/* Candlelight. Irregular keyframe spacing on purpose — evenly spaced stops read as a pulse, and a
   flame doesn't pulse. Parked low in the column where the candles in the photograph are. */
.ei-ember{position:absolute;left:50%;bottom:6%;width:360px;height:360px;border-radius:50%;
  pointer-events:none;z-index:1;filter:blur(44px);
  background:radial-gradient(circle,rgba(255,176,74,0.30) 0%,rgba(255,176,74,0) 70%);
  animation:eiFlicker 5.5s ease-in-out infinite}
@keyframes eiFlicker{
  0%,100%{opacity:.55;transform:translateX(-50%) scale(1)}
  22%{opacity:.88;transform:translateX(-50%) scale(1.06)}
  41%{opacity:.48;transform:translateX(-50%) scale(0.97)}
  67%{opacity:.92;transform:translateX(-50%) scale(1.08)}
  83%{opacity:.6;transform:translateX(-50%) scale(1.01)}}
/* Light sweeping the panel end to end. It used to be parented to the logo, which caused both of
   the things wrong with it: clipped to the logo's box it read as a moving RECTANGLE rather than a
   gleam, and it appeared to give up halfway because translateX percentages resolve against the
   ELEMENT's own width — 340% of a band 42% as wide as its parent is nowhere near a full crossing
   of the parent. Anchored to the panel and travelling -120% to 340% of its own width, it now runs
   from fully off the left edge to fully off the right.
   Blurred, and feathered to transparent at both ends, so it's a gleam and not a lit box. Extends
   past the top and bottom because the skew would otherwise leave triangular gaps at the corners.
   z-index 4 puts it over the logo (2) and the gold rim (3): light falls ON things.
   translateX rather than the left offset, so it stays on the compositor instead of laying the box
   out 60 times a second. */
.ei-sheen{position:absolute;top:-20%;bottom:-20%;left:0;width:42%;z-index:4;pointer-events:none;
  mix-blend-mode:screen;filter:blur(14px);
  background:linear-gradient(90deg,rgba(255,246,222,0) 0%,rgba(255,246,222,0.12) 38%,rgba(255,246,222,0.28) 50%,rgba(255,246,222,0.12) 62%,rgba(255,246,222,0) 100%);
  animation:eiSheen 9s ease-in-out infinite}
@keyframes eiSheen{0%{transform:translateX(-120%) skewX(-12deg)}
  55%,100%{transform:translateX(340%) skewX(-12deg)}}
/* One-shot on mount — the logo settles in rather than being there abruptly. fill-mode both holds
   the end state, and re-renders don't replay it: a CSS animation only restarts on remount. */
.ei-brand-inner{animation:eiEnter 1.1s cubic-bezier(.22,1,.36,1) both}
@keyframes eiEnter{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:none}}
/* Vignette + a fine grain, both static — they stop the gradient banding on wide screens. */
.ei-brand-veil{position:absolute;inset:0;pointer-events:none;z-index:1;
  background:radial-gradient(78% 62% at 50% 42%,rgba(0,0,0,0) 0%,rgba(0,0,0,0.42) 100%)}
/* Over a photograph the veil stops being a vignette and becomes a scrim: a candlelit table is busy
   and light in the middle, exactly where the logo sits, so this darkens the whole column rather
   than just its corners. Without it the wordmark lands on highlights and stops being readable. */
.ei-brand-photo .ei-brand-veil{
  background:linear-gradient(180deg,rgba(9,9,20,0.80) 0%,rgba(9,9,20,0.58) 40%,rgba(9,9,20,0.86) 100%)}
/* The drifting blobs read as atmosphere over a flat gradient and as smears over a photograph. */
.ei-brand-photo .ei-brand-blob{opacity:.3}
/* Centred in what survives at the waist, not in the full panel. BRAND_CURVE pulls the edge in to
   0.80 of the width there, so the usable band is 0.8 * --ei-pw and the block is centred in that.
   Derived rather than hard-coded, so changing --ei-pw re-centres the logo on its own. */
.ei-brand-inner{position:relative;z-index:2;text-align:center;width:360px;
  margin-left:calc((var(--ei-pw) * 0.8 - 360px) / 2)}
/* The artwork. The supplied PNG is a 4258x2838 canvas with the logo occupying only the middle
   ~60% wide by ~27% tall — the rest is transparent margin. Rendered plain it would sit tiny in a
   tall empty box, so the negative vertical margins pull the surrounding layout back in over that
   dead space (they don't crop — transparent pixels simply overlap nothing). Re-export the artwork
   tightly cropped and this can go back to margin:0. */
.ei-logo-img{display:block;width:100%;height:auto;margin:-80px auto}
/* ── FALLBACK LOGO ── Heavy geometric caps, barely tracked, with a lowercase I carrying a round dot,
   over a gold DESIGN & DECOR set tight beneath it on wide tracking. Outfit at 800 is the nearest
   geometric the app already loads, so this costs no extra font request.
   TONE INVERTED: the artwork sets AMBRIA *darker* than its own background — a recessed, tonal
   treatment that leaves the gold tagline carrying all the emphasis. That only works on the mid
   slate it was drawn on; against this panel, which is far darker, a darker-still wordmark would
   disappear. So the wordmark takes the ivory sweep instead and the two marks that are actually
   yellow in the artwork — the dot and the tagline — keep the logo's own yellow. */
.ei-wordmark{font-family:'Outfit',system-ui,sans-serif !important;
  font-size:46px;font-weight:800;letter-spacing:1px;line-height:1;
  padding-left:1px; /* offsets the trailing letter-space so the word optically centres */
  background:linear-gradient(100deg,#8B7355 0%,#E8DCC2 26%,#FFFBF2 47%,#E8DCC2 68%,#8B7355 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;
  color:transparent;-webkit-text-fill-color:transparent;
  animation:eiShimmer 7.5s linear infinite}
/* The I is a bare stem; its dot is a child element, so it keeps the logo's yellow instead of being
   swallowed by the wordmark's clipped gradient (background-clip:text only clips the element's OWN
   background — a child's paints normally on top). */
.ei-logo-i{position:relative;display:inline-block}
.ei-logo-dot{position:absolute;top:-0.34em;left:50%;transform:translateX(-50%);
  width:0.19em;height:0.19em;border-radius:50%;background:${LOGO_GOLD};display:block}
/* Sits tight under the wordmark, the way the artwork tucks it in — not floated away from it. */
.ei-tagline{margin-top:9px;font-size:12.5px;font-weight:700;letter-spacing:5px;text-transform:uppercase;
  color:${LOGO_GOLD}}
.ei-brand-rule{width:74px;height:1px;margin:30px auto 0;transform-origin:center;
  background:linear-gradient(90deg,transparent,${accent},transparent);
  animation:eiRule 5s ease-in-out infinite}
/* Motes drifting up through the panel. Fixed offsets/delays rather than random ones — random would
   re-roll on every keystroke's re-render and make them jump. */
.ei-mote{position:absolute;bottom:-14px;border-radius:50%;background:${accent};pointer-events:none;
  animation:eiRise linear infinite}
@keyframes eiDriftA{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(46px,58px) scale(1.16)}}
@keyframes eiDriftB{0%,100%{transform:translate(0,0) scale(1.06)}50%{transform:translate(-52px,-44px) scale(0.9)}}
@keyframes eiShimmer{0%{background-position:220% 0}100%{background-position:-220% 0}}
@keyframes eiRule{0%,100%{opacity:.4;transform:scaleX(.62)}50%{opacity:1;transform:scaleX(1)}}
@keyframes eiRise{0%{transform:translateY(0) scale(1);opacity:0}
  14%{opacity:.75}82%{opacity:.4}100%{transform:translateY(-78vh) scale(.45);opacity:0}}
/* ── DISPLAY TYPE ── Playfair for the page title and every card title; Cinzel for the wordmark.
   Both need !important: StudioApp sets font-family Outfit on the universal selector with
   !important, and an !important stylesheet declaration beats a plain inline style. A class
   (0,1,0) outranks the universal selector (0,0,0) when both are important, so these win
   without having to be inlined on each element.
   Deliberately display-only — the 10px uppercase field labels stay in Outfit, where a serif at
   that size stops being legible and starts being decoration. */
.ei-display{font-family:'Playfair Display',Georgia,'Times New Roman',serif !important}
/* The page title alone. Cormorant Garamond is an old-style face where Playfair is a didone — the
   italic is genuinely calligraphic rather than a steeply slanted roman, which is the difference
   you can see between the two. It sets SMALL for its point size (low x-height, narrow), so it
   needs roughly a fifth more size than Playfair to carry the same weight on the page. */
.ei-hero-face{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif !important}
/* Title divider. Solid run, diamond, then a fade — the fade is what keeps it from reading as an
   underline that got cut off: a rule of fixed length under a heading always looks like it was
   meant to reach something and didn't.
   width:100% and no cap. The heading and this rule share a column inside the hero's flex row, and
   that column is sized by its widest child — the title. So full width here IS the title's width,
   and it re-measures itself if the type ever changes. It was capped in ch before, which was wrong:
   ch resolves against THIS element's 16px font, not the heading's 52px, so the two were unrelated.
   Set in the deeper gold rather than the decorative accent — at 1.5px on cream, #C9A96E is barely
   a tint. */
.ei-title-rule{display:flex;align-items:center;gap:8px;margin-top:16px;width:100%}
.ei-tr-seg{height:1.5px;width:64px;flex-shrink:0;background:${gold}}
.ei-tr-dia{width:6px;height:6px;flex-shrink:0;transform:rotate(45deg);background:${gold}}
.ei-tr-fade{height:1.5px;flex:1;background:linear-gradient(90deg,${gold},${gold}A6 58%,transparent)}
.ei-wordmark{font-family:'Cinzel',Georgia,serif !important}
.ei-sheet{transition:box-shadow .3s ease}
/* Hover lift, deepened. Still three layers, because a single big blur reads as fog rather than a
   raised edge: a tight contact shadow to seat the card, a mid ambient, and a wide soft cast. All
   three alphas moved together — deepening only the wide one makes the card look like it is
   floating away from the page instead of lifting off it. */
.ei-sheet:hover{box-shadow:${isDark
  ? "0 2px 4px rgba(0,0,0,0.72), 0 22px 42px -12px rgba(0,0,0,0.8), 0 52px 88px -30px rgba(0,0,0,0.92)"
  : "0 2px 4px rgba(26,26,46,0.14), 0 22px 42px -12px rgba(26,26,46,0.36), 0 50px 86px -28px rgba(26,26,46,0.5)"} !important}
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
/* Lightening the ink and warming the cast, so the button brightens toward the gold it carries
   rather than just glowing behind itself. */
.ei-cta:hover:not(:disabled){background:linear-gradient(180deg,#352C64 0%,#1E1940 100%) !important;
  border-color:${accent}99 !important;
  box-shadow:0 18px 36px -10px rgba(21,18,42,0.85), 0 0 26px -6px ${accent}80 !important}
.ei-tint:hover:not(:disabled){background:${isDark?"rgba(255,255,255,0.12)":"rgba(26,26,46,0.09)"} !important}
.ei-link:hover{text-decoration:underline;opacity:1;transform:none}
.ei-head{transition:background .18s ease, opacity .18s ease;border-radius:8px}
.ei-head:hover{background:${isDark?"rgba(201,169,110,0.1)":"rgba(201,169,110,0.14)"};opacity:1}
/* Rows: lift further, warm the fill, and thicken the gold edge — a shadow alone was invisible. */
.ei-row{transition:box-shadow .2s ease, border-color .2s ease, transform .16s ease, background .2s ease}
.ei-row:hover{transform:translateY(-2px);border-color:${isDark?"rgba(201,169,110,0.6)":"rgba(201,169,110,0.65)"} !important;
  background:${isDark?"rgba(201,169,110,0.09)":"#FFFCF3"} !important;
  box-shadow:${isDark?"0 16px 30px -12px rgba(0,0,0,0.78)":"0 16px 30px -12px rgba(26,26,46,0.34)"} !important}
/* A collapsed function head is a filled dark bar, and .ei-row's hover would flip it to cream —
   it lifts toward a lighter ink instead. Same gesture, right direction for a dark surface. */
.ei-row-dark:hover{background:linear-gradient(180deg,#2A2350 0%,#1C1836 100%) !important;
  border-color:rgba(201,169,110,0.55) !important}
/* Function editor card — no lift (it holds inputs), just a clearly brighter frame. */
.ei-fncard{transition:border-color .2s ease, box-shadow .2s ease}
/* The function card keeps a gold cast rather than a grey one — it sits on cream inside another
   card, and a neutral shadow there just looks like dirt. An ink layer underneath gives it the
   depth the gold alone cannot carry. */
.ei-fncard:hover{border-color:${isDark?"rgba(201,169,110,0.6)":"rgba(201,169,110,0.7)"} !important;
  box-shadow:${isDark
    ? "0 2px 4px rgba(0,0,0,0.6), 0 18px 36px -14px rgba(0,0,0,0.82)"
    : "0 2px 5px rgba(26,26,46,0.14), 0 20px 38px -14px rgba(26,26,46,0.34), 0 34px 62px -24px rgba(201,169,110,0.9)"} !important}
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
/* ── RESPONSIVE ── the panel goes first: below this width it would eat the room the form needs,
   and it carries no information you can't do without. Then the paired fields unstack — the old
   column never had breakpoints at all, and a 1fr 1fr grid at 380px wide is unusable. */
@media (max-width: 1200px){
  .ei-brand,.ei-brand-shadow{display:none}
  .ei-view{--ei-pw:0px}
}
@media (max-width: 640px){
  .ei-shell{padding:16px 15px 32px}
  .ei-two{grid-template-columns:1fr;gap:14px}
}
@media (prefers-reduced-motion: reduce){
  .ei-btn,.ei-row,.ei-sheet,.ei-head,.ei-fncard,.ei-status{transition:none}
  .ei-btn:hover,.ei-row:hover,.ei-btn:active{transform:none}
  /* The panel holds still: the photo's drift, the candle flicker, the sheen, the blobs, the
     wordmark shimmer, the rule, the entrance, and every mote. */
  .ei-blob-a,.ei-blob-b,.ei-wordmark,.ei-brand-rule,
  .ei-brand-img,.ei-ember,.ei-brand-inner{animation:none}
  .ei-sheen{display:none}
  /* eiKen's resting frame, kept so cover still overshoots the box by a hair. */
  .ei-brand-img{transform:scale(1.06)}
  .ei-ember{transform:translateX(-50%);opacity:.6}
  .ei-wordmark{background-position:50% 0}
  .ei-mote{display:none}
  /* The page wash settles too — it keeps its colour, it just stops moving and stops fading. */
  .ei-wash-a,.ei-wash-b,.ei-wash-c,.ei-glow{animation:none;opacity:1}
  /* The heading waves and the background bands stay, they just stop drifting. */
  .ei-wave,.ei-band{animation:none}
}
`;

  // ═══ BRAND PANEL ═══
  // The identity the hidden navbar used to carry, given the whole left edge instead. There is no
  // logo file in the repo — the mark everywhere in this app (and on the cost-estimate PDF) is the
  // gold "A" tile with the AMBRIA wordmark and "Decorations & Events" under it, so that's what
  // this is, scaled up. Decorative layers are aria-hidden; the wordmark itself is not.
  const BRAND_PANEL = (
    <aside className={`ei-brand${PANEL_BG ? " ei-brand-photo" : ""}`}>
      {/* The photograph, when there is one. Sits at the very back; the gradient stays underneath it
          as the ground so a slow-loading or short image never shows bare page through the curve. */}
      {PANEL_BG && <div className="ei-brand-img" style={{backgroundImage:`url(${PANEL_BG})`}} aria-hidden="true"/>}
      {/* The curve, defined once and used twice — as the panel's clip and as the rim drawn on top,
          so the two can never drift apart. Straight down the left, out to the full width top and
          bottom, and pulled in to a waist at 62% across the middle. */}
      <svg className="ei-brand-defs" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="eiBrandCurve" clipPathUnits="objectBoundingBox">
            <path d={BRAND_CURVE}/>
          </clipPath>
          <linearGradient id="eiBrandEdge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0"/>
            <stop offset="0.46" stopColor={accent} stopOpacity="0.9"/>
            <stop offset="1" stopColor={accent} stopOpacity="0"/>
          </linearGradient>
        </defs>
      </svg>
      <svg className="ei-brand-edge" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={BRAND_CURVE} fill="none" stroke="url(#eiBrandEdge)" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
      </svg>
      <div className="ei-brand-blob ei-blob-a" aria-hidden="true"/>
      <div className="ei-brand-blob ei-blob-b" aria-hidden="true"/>
      {MOTES.map((m, i) => (
        <span key={i} className="ei-mote" aria-hidden="true"
          style={{left:`${m.left}%`,width:m.size,height:m.size,opacity:m.op,
            animationDuration:`${m.dur}s`,animationDelay:`${m.delay}s`}}/>
      ))}
      <div className="ei-brand-veil" aria-hidden="true"/>
      {/* Above the scrim, not under it — it's a light source, so it has to read through. */}
      <div className="ei-ember" aria-hidden="true"/>
      {/* Light sweeping the whole panel, above everything including the logo — light passes over
          what it falls on, it doesn't slide underneath it. */}
      <span className="ei-sheen" aria-hidden="true"/>
      <div className="ei-brand-inner">
        {LOGO_ASSET ? (
          <img className="ei-logo-img" src={LOGO_ASSET} alt="Ambria — Design &amp; Decor"/>
        ) : (
          /* Fallback until the artwork lands: the logo redrawn in type. Close, not exact. */
          <>
            <div className="ei-wordmark">
              AMBR<span className="ei-logo-i">I<i className="ei-logo-dot" aria-hidden="true"/></span>A
            </div>
            <div className="ei-tagline">Design &amp; Decor</div>
          </>
        )}
        <div className="ei-brand-rule" aria-hidden="true"/>
      </div>
    </aside>
  );

  // ═══ HERO ═══
  const HERO = (
    <div style={{display:"flex",alignItems:"center",gap:15,marginBottom:30}}>
      {/* SVG, not an emoji — `gold` gives the glyph real contrast on the cream tile where the
          accent itself would sit at ~2:1. */}
      <div style={{width:56,height:56,borderRadius:18,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:gold,background:isDark?"rgba(201,169,110,0.12)":"linear-gradient(140deg,#FFF9EC,#F6EAD1)",border:`1px solid ${accent}38`,boxShadow:`0 8px 20px -10px ${accent}`}}><IconClipboard size={25}/></div>
      {/* Cormorant Garamond italic. Sized at 52 rather than the 41 Playfair carried — an old-style
          face has a much lower x-height, so matching point sizes would leave this visibly smaller
          on the page. Tracking goes POSITIVE here: old-style italics are drawn to sit open, and
          the negative tracking a didone wants would jam the letters into each other. */}
      <div style={{minWidth:0}}>
        <div className="ei-hero-face" style={{fontSize:52,fontStyle:"italic",fontWeight:600,color:textP,letterSpacing:0.4,lineHeight:1.02}}>Event Information</div>
        {/* Segment, diamond, fade — the same ◇ divider the Ambria poster artwork uses, turned to
            run left-aligned under a heading instead of centred under a wordmark. Decorative only,
            so it's aria-hidden: a screen reader announcing a rule between a heading and a form
            is noise. */}
        <div className="ei-title-rule" aria-hidden="true">
          <span className="ei-tr-seg"/>
          <span className="ei-tr-dia"/>
          <span className="ei-tr-fade"/>
        </div>
      </div>
    </div>
  );

  // ═══ GATE + CTA ═══
  // Closes the page: what's still outstanding on the left, the way forward on the right.
  const FOOTER_ACTIONS = (
    <div className="ei-sheet" style={{...sheet,padding:"15px 18px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
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
  }} style={{fontSize:13.5,fontWeight:600,padding:"13px 30px",borderRadius:12,letterSpacing:0.2,whiteSpace:"nowrap",cursor:"pointer",
    // Ink fill with gold on it, the same pairing as the heading bars — S.btn's flat gold gradient
    // was the last thing on the page still using the old palette, and next to an ink heading it
    // read as mustard. Gold sits ~6.7:1 on this ink, so the label is comfortably legible.
    // The disabled branch stays legible on purpose: S.btn's grey plus .ei-btn:disabled's 0.55
    // opacity compounded into something you couldn't read, and this is the control that tells you
    // WHY you can't continue yet.
    ...(canContinue
      ? {background:"linear-gradient(180deg,#2A2350 0%,#171331 100%)",color:accent,
         border:`1px solid ${accent}59`,boxShadow:"0 12px 28px -10px rgba(21,18,42,0.75)"}
      : {background:isDark?"rgba(255,255,255,0.05)":"rgba(26,26,46,0.05)",color:textM,
         border:`1px solid ${hairline}`,opacity:0.85,cursor:"not-allowed",boxShadow:"none"})}}>Continue to Browse →</button>
    </div>
  );

  return (
    <div className="ei-view">
      <style>{hoverCSS}</style>
      <div className="ei-brand-shadow" aria-hidden="true">
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" focusable="false">
          <path d={BRAND_CURVE} fill="#0B0B16"/>
        </svg>
      </div>
      {BRAND_PANEL}
      <div className="ei-split">
        {/* Ambient wash — full width of the split, running UNDER the fixed panel as well as the
            brief, so the cream the curve gives back is washed like everything else. No clicks. */}
        <div className="ei-wash" aria-hidden="true">
          <span className="ei-wash-a"/>
          <span className="ei-wash-b"/>
          <span className="ei-wash-c"/>
          {/* Soft wave bands over the wash — the page-scale echo of the waves in the heading bars.
              Full-bleed rather than tiled: a tile repeats and at this size the eye finds it.
              NOTE the stroke width is left to scale with the viewBox here — the opposite of the
              heading waves. There, non-scaling-stroke keeps hairlines even; here the whole point is
              that the band stretches into a broad soft ribbon along with everything else. */}
          <svg className="ei-ripple" viewBox="0 0 1200 960" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {BANDS.map((b, i) => (
              <path key={i} className={`ei-band ei-band-${i}`} d={b.d} fill="none" stroke={b.c}
                strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
            ))}
          </svg>
          <i className="ei-grain"/>
        </div>
        <div className="ei-formside">
      <div className="ei-root ei-shell">
        {/* Warm ambient cast where the header used to be — gives the bare page a top edge. */}
        <div className="ei-glow" aria-hidden="true"/>
        {HERO}

        <div className="ei-stack">

            {/* ── CLIENT DETAILS ── */}
            <div className="ei-sheet" style={sheet}>
              {/* Gilt hairline — reads as a letterpress edge and separates the sheet from the page. */}
              <div style={giltRule}/>
              <div className="ei-headrow" style={sheetHead}>
                {HEAD_WAVE}
                <span style={{width:5,height:5,borderRadius:"50%",background:accent,flexShrink:0}}/>
                <div className="ei-display" style={{fontSize:15.5,fontWeight:600,color:headText,letterSpacing:0.1}}>Client Details</div>
                <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:11}}>
                  {(() => {
                    const hasContent = !!(clientName.trim() || clientPhone.trim() || clientBrideGroom.trim() || clientDate || venue || fn || clientShift || clientPax || extraFunctions.length > 0 || activeClientId);
                    const doReset = () => {
                      if (!hasContent) return;
                      askConfirm("Reset this form?", () => { startNewDeal(); showMsg("Form reset", "green"); }, {
                        yesLabel: "Reset",
                        note: activeClientId
                          ? "This closes the currently active deal on screen — its saved sessions stay in Client Tracker, nothing is deleted."
                          : "Clears everything typed on this screen so far.",
                      });
                    };
                    // Restyled for the ink head this now sits on — the original was grey-on-cream,
                    // which disappears here. Behaviour is untouched.
                    return <button type="button" onClick={doReset} disabled={!hasContent}
                      style={{padding:"3px 10px",borderRadius:6,fontSize:9,fontWeight:700,whiteSpace:"nowrap",
                        border:`1px solid ${hasContent ? `${accent}66` : "rgba(255,255,255,0.14)"}`,
                        background:hasContent ? "rgba(201,169,110,0.12)" : "transparent",
                        color:hasContent ? accent : "rgba(245,241,231,0.3)",
                        cursor:hasContent ? "pointer" : "default"}}>↺ Reset</button>;
                  })()}
                  <span style={{...eyebrow,fontSize:9,color:headMeta}}>Required</span>
                </div>
              </div>
              <div style={{padding:"22px 24px 26px"}}>
                <div className="ei-two" style={{marginBottom:18}}>
                  <div><div style={label}>Guest Name <span style={{color:C.red}}>*</span></div><input value={clientName} onChange={e=>{setClientName(e.target.value);setClientSearch(e.target.value);}} placeholder="Full name" style={S.input}/></div>
                  <div>
                    <div style={label}>Phone <span style={{color:C.red}}>*</span></div>
                    <input value={clientPhone} onChange={onPhoneChange} inputMode="numeric" autoComplete="tel"
                      maxLength={10} placeholder="10-digit mobile" style={S.input}/>
                  </div>
                </div>
                {/* Guards the ACTIVE deal's name/phone from a silent autosave overwrite — see
                    loadedClientIdentityRef / confirmClientRename in StudioApp.jsx. Editing either field
                    away from what this client loaded with does not save until explicitly confirmed here;
                    every other field on Event Info keeps autosaving normally the whole time. */}
                {activeClientId && loadedClientIdentityRef?.current?.name && (clientName.trim() !== loadedClientIdentityRef.current.name || clientPhone.trim() !== loadedClientIdentityRef.current.phone) && (
                  <div style={{marginBottom:18,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(245,158,11,0.08)":"rgba(245,158,11,0.06)",border:`1px solid ${isDark?"rgba(245,158,11,0.3)":"rgba(245,158,11,0.25)"}`,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,fontWeight:600,color:C.amberDeep,flex:1,minWidth:200}}>
                      ✏️ This is the ACTIVE deal (was "{loadedClientIdentityRef.current.name}"{loadedClientIdentityRef.current.phone?` · ${loadedClientIdentityRef.current.phone}`:""}) — this edit won't be saved until you confirm.
                    </span>
                    <button className="ei-btn ei-solid" onClick={confirmClientRename} style={{padding:"5px 12px",borderRadius:6,border:"none",background:C.amberDeep,color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>✓ Confirm rename</button>
                    <button className="ei-btn ei-tint" onClick={revertClientNameEdit} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textM,fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>↺ Revert</button>
                  </div>
                )}
                {/* ═══ §25 TYPEAHEAD — STRICT LMS-FIRST (29 May 2026) ═══ */}
                {/* LMS Venue+Decor search is queried first (debounced 400ms, in-memory cache).             */}
                {/* Studio clientLedger fallback shows ONLY when LMS returns 0 results OR errors out.       */}
                {/* Hidden once a client is loaded (activeClientId set).                                    */}
                {(clientName.trim().length >= 2 || clientPhone.trim().length >= 4) && !activeClientId && (() => {
                  const qName = clientName.trim().toLowerCase();
                  const qPhone = clientPhone.trim();
                  // Each Studio client is tagged to whoever created it (createdBy); each LMS lead/contract
                  // is tagged to whoever entered it there (entryByName — dh_decor_entryby for decor leads,
                  // dhc_decor_entryby / fisc_entryby for contracts). Default to showing only the logged-in
                  // salesperson's own — showAllReps is the escape hatch for covering a colleague's meeting.
                  //
                  // An earlier version treated an UNTAGGED record (no createdBy, or an entry-by field
                  // reading blank) as always "mine", reasoning that hiding something nobody could tell was
                  // or wasn't theirs would look like data loss rather than filtering. That was covering for
                  // a real bug, not a real gap: the edge function's decor-lead normalizer just never read
                  // dh_decor_entryby (now fixed — see supabase/functions/lms/index.ts), so every decor
                  // lead — most of what this search surfaces — looked untagged and showed to everyone
                  // regardless of the toggle. Untagged now defaults to hidden like everything else; "Show
                  // all" is the one way to see it, same as anyone else's leads. Rows synced before that
                  // fix still lack an owner until the next LMS sync re-pulls them.
                  const mine = (name) => String(name || "").toLowerCase() === String(authUser?.name || "").toLowerCase();
                  const rawLmsLeads = lmsLeads || [];
                  const visibleLmsLeads = showAllReps ? rawLmsLeads : rawLmsLeads.filter(l => mine(l.entryByName));
                  const hiddenLmsCount = rawLmsLeads.length - visibleLmsLeads.length;
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
                  const lmsBlock = (visibleLmsLeads.length > 0) ? (<div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,background:isDark?"rgba(34,197,94,0.06)":"rgba(34,197,94,0.04)",border:`1px solid ${isDark?"rgba(34,197,94,0.25)":"rgba(34,197,94,0.2)"}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:C.green,marginBottom:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span>📥</span><span>{visibleLmsLeads.length} LMS lead{visibleLmsLeads.length>1?"s":""} found{hiddenLmsCount>0?` (+${hiddenLmsCount} from others)`:""} — load to capture full lead context</span>
                        {lmsFilling && <span style={{fontSize:10,fontWeight:600,color:C.amber,display:"inline-flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                          <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#F59E0B",animation:"pulse 1.5s infinite"}}></span>
                          more loading…
                        </span>}
                        <button className="ei-btn ei-tint" onClick={refreshLmsSync} disabled={lmsSyncing} style={{marginLeft:"auto",padding:"2px 8px",borderRadius:4,border:"1px solid rgba(21,128,61,0.2)",background:"transparent",color:C.green,fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{lmsSyncing ? "⏳ Syncing…" : "🔄 Refresh"}</button>
                      </div>
                      {visibleLmsLeads.map(lead => {
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
                  const matchesBeforeRepFilter = clientLedger.filter(c => {
                    if (!c.name) return false;
                    const nameMatch = qName.length >= 2 && c.name.toLowerCase().includes(qName);
                    const phoneMatch = qPhone.length >= 4 && (c.phone || "").includes(qPhone);
                    if (!(nameMatch || phoneMatch)) return false;
                    // Already shown above as its own LMS lead card (same entry, already linked) — two
                    // near-identical cards for the same deal is exactly the confusing redundancy this
                    // was. Only suppress when that LMS card is actually on screen right now; if LMS
                    // didn't return it (sync lag, filtered out), this Studio card is still the only way in.
                    if (c.lmsLeadId && (lmsLeads || []).some(l => l.entryNo === c.lmsLeadId && l.dept === c.lmsDept)) return false;
                    return true;
                  });
                  const matchesAfterRepFilter = showAllReps ? matchesBeforeRepFilter : matchesBeforeRepFilter.filter(c => mine(c.createdBy));
                  const hiddenClientCount = matchesBeforeRepFilter.length - matchesAfterRepFilter.length;
                  const matches = matchesAfterRepFilter.slice(0, 5);
                  if (!lmsBlock && matches.length === 0) {
                    // Everything found belongs to other salespeople — say so specifically (rather than
                    // "no matches", which would send someone covering a colleague's meeting hunting for a
                    // typo) and offer the toggle right here rather than making them find it elsewhere.
                    const onlyHiddenByRep = !showAllReps && (hiddenLmsCount > 0 || hiddenClientCount > 0);
                    if (onlyHiddenByRep) {
                      const n = hiddenLmsCount + hiddenClientCount;
                      return <div style={{marginBottom:16,padding:"8px 12px",borderRadius:8,background:isDark?"rgba(99,102,241,0.06)":"rgba(99,102,241,0.04)",border:`1px solid ${isDark?"rgba(99,102,241,0.2)":"rgba(99,102,241,0.15)"}`,fontSize:11,color:C.indigo,display:"flex",alignItems:"center",gap:8}}>
                        <span style={{flex:1}}>Found {n} match{n>1?"es":""}, but tagged to other salespeople</span>
                        <button className="ei-btn ei-solid" onClick={()=>setShowAllReps(true)} style={{padding:"3px 10px",borderRadius:6,border:"none",background:C.indigo,color:"#fff",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>👥 Show all</button>
                      </div>;
                    }
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
                        {`Found ${matches.length} existing Studio client${matches.length>1?"s":""}${hiddenClientCount>0?` (+${hiddenClientCount} from others)`:""} — load to continue previous work?`}
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
                  // Persistent toggle whenever there's something to switch between — either results are
                  // already hidden (so there's something "all" would add), or "all" is already on (so
                  // there's a way back to "mine"). Covering a colleague's meeting means finding this
                  // BEFORE typing produces zero matches, not just as a fallback in the empty-state note.
                  const anyHiddenByRep = hiddenLmsCount > 0 || hiddenClientCount > 0;
                  const repToggle = (showAllReps || anyHiddenByRep) && (
                    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
                      <button className="ei-btn ei-tint" onClick={()=>setShowAllReps(v=>!v)}
                        title={showAllReps ? "Back to just your own leads/clients" : "See everyone's leads/clients — for covering a colleague's meeting"}
                        style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textM,fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                        {showAllReps ? "👤 Show mine only" : `👥 Show all${anyHiddenByRep?` (+${hiddenLmsCount+hiddenClientCount})`:""}`}
                      </button>
                    </div>
                  );
                  return <>{repToggle}{lmsBlock}{studioBlock}</>;
                })()}
                <div><div style={label}>Bride &amp; Groom Name</div><input value={clientBrideGroom} onChange={e=>setClientBrideGroom(e.target.value)} placeholder="e.g. Rahul & Priya" style={S.input}/></div>
              </div>
            </div>

            {/* ── FUNCTIONS ── Commit 2 multi-function. Function 1 is mirrored by legacy state.
                   Its own card, rather than buried at the bottom of Client Details the way it used
                   to be — a four-function wedding read as an afterthought to the guest's phone. ── */}
            <div className="ei-sheet" style={sheet}>
              <div style={giltRule}/>
              <div className="ei-headrow" style={sheetHead}>
                {HEAD_WAVE}
                <span style={{width:5,height:5,borderRadius:"50%",background:accent,flexShrink:0}}/>
                <div className="ei-display" style={{fontSize:15.5,fontWeight:600,color:headText,letterSpacing:0.1}}>Functions</div>
                <div style={{padding:"1px 7px",borderRadius:5,fontSize:9.5,fontWeight:700,color:accent,background:"rgba(201,169,110,0.16)",border:`1px solid ${accent}55`}}>{1 + extraFunctions.length}</div>
                <div style={{marginLeft:"auto",...eyebrow,fontSize:9,color:headMeta}}>Event type required</div>
              </div>
              <div style={{padding:"20px 24px 24px"}}>

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
                <div key={`fn-summary-${idx}`} className="ei-row ei-row-dark" style={{position:"relative",overflow:"hidden",padding:"12px 14px 12px 17px",borderRadius:12,border:`1px solid rgba(201,169,110,0.28)`,background:headFill,marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                  <div style={edgeBar}/>
                  <div style={fnBadgeDark}>{String(idx + 1).padStart(2, "0")}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="ei-display" style={{fontSize:14,fontWeight:600,color:headText,letterSpacing:0}}>{f.type}</div>
                    <div style={{fontSize:10.5,color:"rgba(245,241,231,0.6)",marginTop:3,display:"flex",gap:9,flexWrap:"wrap"}}>
                      {f.date && <span>📅 {f.date}</span>}
                      {f.shift && <span>🕐 {f.shift}</span>}
                      {f.venue && <span>📍 {f.venue}</span>}
                      {f.pax && <span>👥 {f.pax} pax</span>}
                    </div>
                  </div>
                  <button className="ei-btn ei-gold" onClick={() => setExpandedFnIdx(idx)} style={{fontSize:10,fontWeight:600,padding:"5px 11px",borderRadius:8,border:`1px solid ${accent}55`,background:"rgba(201,169,110,0.12)",color:accent,cursor:"pointer",whiteSpace:"nowrap"}}>✏️ Edit</button>
                  {canDelete && <button className="ei-btn ei-danger" onClick={doDelete} title="Remove function" style={{fontSize:11,padding:"5px 8px",borderRadius:8,border:`1px solid rgba(255,255,255,0.18)`,background:"transparent",color:"#FCA5A5",cursor:"pointer"}}>✕</button>}
                </div>
              );
            }
            // Expanded form view
            const venueVal = [...allInhouseVenues, "Others", ...allOutdoorDB.map(v => v.name)].includes(f.venue) ? f.venue : (f.venue ? "Others" : "");
            return (
              <div key={`fn-form-${idx}`} className="ei-fncard" style={{position:"relative",overflow:"hidden",padding:"17px 19px 20px",borderRadius:14,border:`1px solid ${accent}2E`,background:isDark?"linear-gradient(180deg,rgba(201,169,110,0.055),rgba(201,169,110,0.02))":"linear-gradient(180deg,#FFFCF4,#fff 62%)",boxShadow:isDark?"none":`0 8px 24px -14px ${accent}99`,marginBottom:12}}>
                <div style={edgeBar}/>
                {/* Negative margins bleed the head to the card's edges — it's a filled bar spanning
                    the card, not a boxed row floating inside its padding. */}
                {/* No wave here — this is a sub-head under an already-waved card head, and running
                    it at both levels turns the hierarchy into noise. Plain fill. */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,
                  margin:"-17px -19px 18px",padding:"12px 19px",background:headFill,
                  borderBottom:`1px solid rgba(201,169,110,0.22)`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    <div style={fnBadgeDark}>{String(idx + 1).padStart(2, "0")}</div>
                    <div style={{minWidth:0}}>
                      <div className="ei-display" style={{fontSize:15,fontWeight:600,color:headText,letterSpacing:0}}>Function {idx + 1}</div>
                      <div style={{fontSize:10,color:"rgba(245,241,231,0.55)",marginTop:2}}>Type, date, venue &amp; guest count</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {isComplete && <button className="ei-btn ei-ghost" onClick={() => setExpandedFnIdx(null)} style={{fontSize:10,fontWeight:600,padding:"5px 10px",borderRadius:8,border:`1px solid rgba(255,255,255,0.2)`,background:"transparent",color:"rgba(245,241,231,0.75)",cursor:"pointer"}}>Collapse</button>}
                    {canDelete && <button className="ei-btn ei-danger" onClick={doDelete} style={{fontSize:10,fontWeight:600,padding:"5px 10px",borderRadius:8,border:`1px solid rgba(255,255,255,0.18)`,background:"transparent",color:"#FCA5A5",cursor:"pointer"}}>✕ Remove</button>}
                  </div>
                </div>
                <div className="ei-two" style={{gap:14,marginBottom:12}}>
                  <div><div style={label}>Event Type <span style={{color:C.red}}>*</span></div><select value={f.type || ""} onChange={e => updateType(e.target.value)} style={{...S.select,width:"100%"}}><option value="">Select event type</option>{taxOr(taxonomy.eventType, FUNCTIONS).map(et => <option key={et} value={et}>{et}</option>)}</select></div>
                  {/* Asterisked on every function, but only Function 1's is gated — same as Event
                      Type above it. Blocking on Functions 2+ would trap anyone who adds the next
                      function before the client has settled its date, which is the normal order. */}
                  <div><div style={label}>Event Date <span style={{color:C.red}}>*</span></div><input type="date" value={f.date || ""} onChange={e => updateDate(e.target.value)} style={S.input}/></div>
                </div>
                <div className="ei-two" style={{gap:14,marginBottom:f.venue === "Others" && idx === 0 ? 0 : 12}}>
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
                      <div className="ei-two" style={{gap:10,marginBottom:4}}>
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

            {FOOTER_ACTIONS}
        </div>
      </div>
        </div>
      </div>

      <RemoveFunctionDialog
        snap={confirmRemove} onCancel={cancelRemove} onConfirm={commitRemove}
        S={S} sheet={sheet} hairline={hairline} textP={textP} textM={textM} isDark={isDark}
      />
    </div>
  );
}

// ═══ Studio inline-style object `S` (CSS-in-JS) ═══
// Copied VERBATIM from reference App_latest.jsx (the `const S = {...}` block).
// In the reference, `S` is built inside the main component from theme variables
// (isDark, bg, cardBg, textP, textS, border, accent, accentBg, accentText).
// Those variables are reproduced here at module scope (VERBATIM from the reference,
// light-theme default: mode !== "manage" → isDark = false) so the object can be
// exported standalone while preserving exact visual values.
//
// A `makeS(isDark)` factory is also exported for callers that need the dark-theme
// (manage mode) variant — it reproduces the same theme-variable derivation.

const deriveTheme = (isDark) => {
  const bg = isDark ? "#0F0F1A" : "#FAF9F6";
  const cardBg = isDark ? "#1A1A2E" : "#fff";
  const textP = isDark ? "#E5E5E5" : "#1a1a2e";
  const textS = isDark ? "#6B7280" : "#8b8fa3";
  const border = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const accent = "#C9A96E";
  const accentBg = isDark ? "rgba(201,169,110,0.12)" : "#F5F0FF";
  const accentText = isDark ? "#C9A96E" : "#6D28D9";
  return { isDark, bg, cardBg, textP, textS, border, accent, accentBg, accentText };
};

export const makeS = (isDark = false) => {
  const { bg, cardBg, textP, textS, border, accent, accentBg, accentText } = deriveTheme(isDark);
  const S = {
    app: { fontFamily:"'Outfit','Plus Jakarta Sans',system-ui,sans-serif", minHeight:"100vh", background:bg, color:textP },
    header: { background:isDark?"linear-gradient(180deg,#161625,#0F0F1A)":"linear-gradient(135deg,#0F0F1A,#2d1b69)", padding:"12px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50, flexWrap:"wrap", gap:10 },
    main: { maxWidth:1200, margin:"0 auto", padding:"24px 20px 100px" },
    card: { background:cardBg, borderRadius:14, border:`1px solid ${border}`, overflow:"hidden" },
    pill: a => ({ padding:"6px 14px", borderRadius:16, fontSize:11, fontWeight:a?600:400, cursor:"pointer", border:a?`1px solid ${accentText}30`:`1px solid ${border}`, background:a?accentBg:"transparent", color:a?accentText:textS, transition:"all 0.15s", display:"inline-block" }),
    btn: p => ({ padding:"10px 22px", borderRadius:10, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background:p?`linear-gradient(135deg,${accent},#A67C3D)`:isDark?"rgba(255,255,255,0.06)":"#F3F4F6", color:p?"#0F0F1A":textS }),
    btnSm: (bg2) => ({ padding:"5px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:11, fontWeight:600, background:bg2||"rgba(255,255,255,0.06)", color:bg2?"#0F0F1A":textS }),
    input: { width:"100%", padding:"10px 14px", borderRadius:10, border:`1px solid ${border}`, background:isDark?"#12121F":"#fff", color:textP, fontSize:13, outline:"none", boxSizing:"border-box" },
    select: { padding:"10px 14px", borderRadius:10, border:`1px solid ${border}`, background:isDark?"#12121F":"#fff", color:textP, fontSize:13, outline:"none" },
    label: { fontSize:10, fontWeight:600, color:textS, textTransform:"uppercase", letterSpacing:0.5, display:"block", marginBottom:6 },
    overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:190 },
    panel: { position:"fixed", top:0, right:0, width:420, height:"100vh", background:cardBg, zIndex:200, boxShadow:"-8px 0 30px rgba(0,0,0,0.15)", display:"flex", flexDirection:"column" },
  };
  return S;
};

// Default (light-theme / studio mode) `S` — verbatim values for the common case.
export const S = makeS(false);

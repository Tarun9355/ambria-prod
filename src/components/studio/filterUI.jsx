import { IconCheck, IconChevron } from "../icons.jsx";

// ═══ SHARED STUDIO FILTER UI ═══
// One implementation of the filter panel used by BOTH Browse and Build, so the two can't drift
// apart. Lifted verbatim from the Browse panel — the markup and CSS it emits are unchanged.
//
// Callers own the filter state and the option lists; this module owns only the presentation:
// the sheet, the collapsible section headers with their selection summaries, and the pills.
//
// `makeFilterUI(theme)` returns the tokens + components bound to the current theme, because the
// Studio tree is inline-styles (`S`) and every value has to be threaded through explicitly.

export function makeFilterUI({ isDark, accent, textP, S }) {
  const hairline = isDark ? "rgba(255,255,255,0.08)" : "rgba(26,26,46,0.07)";
  const gold     = isDark ? "#D9BE86" : "#8A6A2F";   // accent as *text* (#C9A96E is ~2:1 on white)
  const textM    = isDark ? "#A6ADC0" : "#5A6076";   // stock textS (#8b8fa3) is ~3.1:1 — below AA

  // One pill geometry for every filter value, whatever the group or nesting depth.
  // Laid out in a 3-per-row grid (see Section), so a pill fills its cell and centres its label
  // rather than sizing to the text — ragged 1-2-3-per-row wrapping was what made the panel look
  // cluttered. `whiteSpace: normal` lets long names ("Ring Ceremony") wrap inside the cell
  // instead of overflowing it; grid stretch keeps every pill in a row the same height.
  // `align="start"` is for full-width rows (one pill per row), where centring a long label away
  // from its swatches reads as unaligned. Multi-column rows stay centred.
  const pill = (on, align = "center") => ({
    display: "flex", alignItems: "center", gap: align === "start" ? 7 : 4,
    justifyContent: align === "start" ? "flex-start" : "center",
    padding: align === "start" ? "6px 11px" : "5px 8px", borderRadius: 999,
    textAlign: align === "start" ? "left" : "center",
    fontSize: 11, fontWeight: on ? 600 : 500, cursor: "pointer", whiteSpace: "normal",
    transition: "all 0.15s", lineHeight: 1.25, minHeight: 26, boxSizing: "border-box",
    background: on ? (isDark ? "rgba(201,169,110,0.2)" : "#F6E7C8") : "transparent",
    color: on ? gold : textM,
    border: `1px solid ${on ? accent : hairline}`,
  });

  // Selected pills carry a tick, so "which of these is on" survives a glance.
  const Pill = ({ on, onClick, children, title, align }) => (
    <div className="sb-pill" onClick={onClick} title={title} style={pill(on, align)}>
      {on && <IconCheck size={9} />}{children}
    </div>
  );

  // Ghost pill for the little ✕ / +N affordances that aren't filter values.
  const ghostPill = {
    padding: "5px 9px", borderRadius: 999, fontSize: 10, fontWeight: 600, cursor: "pointer",
    color: textM, border: `1px dashed ${hairline}`, background: "transparent", lineHeight: 1.35,
  };

  // Collapsible section. Header is a real <button> with aria-expanded so keyboard and
  // screen-reader users get disclosure semantics, not just a clickable div.
  //
  // The header deliberately shows NO selected-value text. Echoing it beside the label rendered as
  // "EVENT TYPE  Birthday" — one run-on string, since both sit at 10px with only a 7px gap. The
  // count chip carries "something is selected"; expanding shows exactly what.
  // `cols` — 3 suits short values (Wedding, Gold, Indoor). Groups with long labels, notably
  // Palette ("Ivory & Rani Pink / Magenta") plus its swatch dots, pass 1 so each value gets a
  // full-width row instead of wrapping onto three cramped lines.
  const Section = ({ id, label, count, last, open, onToggle, cols = 3, children }) => (
    <div style={{ paddingBottom: last ? 0 : 11, marginBottom: last ? 0 : 11,
      borderBottom: last ? "none" : `1px solid ${hairline}` }}>
      <button type="button" className="sb-head" onClick={onToggle}
        aria-expanded={open} aria-controls={`sb-sec-${id}`}
        style={{width:"100%",display:"flex",alignItems:"center",gap:7,padding:"5px 6px",margin:"0 -6px",
          border:"none",background:"transparent",borderRadius:8,cursor:"pointer",textAlign:"left"}}>
        <span style={{width:4,height:4,borderRadius:"50%",flexShrink:0,
          background: count ? accent : (isDark ? "rgba(255,255,255,0.18)" : "rgba(26,26,46,0.16)")}}/>
        <span style={{fontSize:10,fontWeight:700,color:count?gold:textM,textTransform:"uppercase",letterSpacing:0.9,flexShrink:0}}>{label}</span>
        {count > 0 && <span style={{marginLeft:"auto",flexShrink:0,fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:5,
          background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{count}</span>}
        <span style={{marginLeft:count>0?0:"auto",flexShrink:0,display:"flex",color:textM,
          transform:open?"rotate(180deg)":"none",transition:"transform 0.18s ease"}}><IconChevron size={13}/></span>
      </button>
      {/* Three equal columns. `minmax(0,1fr)` stops a long label from widening its column and
          throwing the grid off; `alignItems:stretch` (the default) equalises row heights. */}
      {open && <div id={`sb-sec-${id}`} style={{display:"grid",gridTemplateColumns:`repeat(${cols},minmax(0,1fr))`,gap:6,marginTop:9}}>{children}</div>}
    </div>
  );

  // Panel shell: the card, the pinned title row, the total count and the reset.
  // `action` is an optional node pinned to the end of the header — Build uses it for the
  // collapse-the-rails control. Browse passes nothing and renders exactly as before.
  //
  // `scroll` turns the body into its own scroll area capped to the viewport. Without it the panel
  // has no scrollport of its own, so a wheel over the filters just scrolls the page — the sections
  // below the fold are only reachable by scrolling the whole layout past them. `overscrollBehavior:
  // contain` is the other half: it stops the scroll chaining back to the page once the body bottoms
  // out. The header sits outside the scrollport, so it stays put without needing position:sticky.
  const Panel = ({ title = "Filters", total = 0, onClear, note, action, scroll, children }) => (
    <div className="sb-panel" style={{...S.card, padding:0, boxShadow: isDark
      ? "0 1px 2px rgba(0,0,0,0.45), 0 10px 26px -12px rgba(0,0,0,0.6)"
      : "0 1px 2px rgba(26,26,46,0.06), 0 10px 26px -12px rgba(26,26,46,0.2)",
      ...(scroll ? {display:"flex",flexDirection:"column",minHeight:0,maxHeight:scroll,overflow:"hidden"} : null)}}>
      <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:8,
        padding:"13px 16px",borderBottom:`1px solid ${hairline}`,
        background:isDark?"#1A1A2E":"linear-gradient(180deg,#FEFCF8,#fff)"}}>
        <div style={{fontSize:13.5,fontWeight:700,color:textP,letterSpacing:-0.1}}>{title}</div>
        {total > 0 && <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,
          background:isDark?"rgba(201,169,110,0.18)":"#F6E7C8",color:gold,border:`1px solid ${accent}44`}}>{total}</span>}
        {total > 0 && <div className="sb-pill sb-ghost" onClick={onClear} title="Reset every filter"
          style={{...ghostPill,marginLeft:"auto"}}>Clear all</div>}
        {note && total === 0 && <div style={{marginLeft:"auto",fontSize:9.5,color:textM,whiteSpace:"nowrap"}}>{note}</div>}
        {/* marginLeft:auto only if nothing before it already claimed the gap */}
        {action && <div style={{marginLeft:(total > 0 || note) ? 0 : "auto",display:"flex",alignItems:"center",flexShrink:0}}>{action}</div>}
      </div>
      <div className={scroll ? "sb-scroll" : undefined}
        style={{padding:"14px 16px 16px",
          ...(scroll ? {flex:1,minHeight:0,overflowY:"auto",overscrollBehavior:"contain"} : null)}}>{children}</div>
    </div>
  );

  // Hover/motion layer. Inline styles can't express :hover, so it lives here and is injected by
  // whichever page mounts the panel.
  const css = `
.sb-pill{transition:background .15s ease,border-color .15s ease,color .15s ease,transform .12s ease}
.sb-pill:hover{transform:translateY(-1px);border-color:${accent} !important;
  background:${isDark?"rgba(201,169,110,0.12)":"#FFF9EC"} !important;color:${gold} !important}
.sb-ghost:hover{border-color:${accent} !important;color:${gold} !important}
.sb-head{transition:background .15s ease}
.sb-head:hover{background:${isDark?"rgba(255,255,255,0.05)":"rgba(26,26,46,0.035)"} !important}
.sb-head:focus-visible{outline:2px solid ${accent};outline-offset:1px}
.sb-panel{transition:box-shadow .24s ease}
.sb-panel:hover{box-shadow:${isDark
  ? "0 2px 4px rgba(0,0,0,0.5), 0 18px 36px -14px rgba(0,0,0,0.7)"
  : "0 2px 4px rgba(26,26,46,0.08), 0 18px 36px -14px rgba(26,26,46,0.28)"} !important}
/* Slim scrollbar for the panel body — the default chrome one is wide enough to crowd a 248px rail.
   No fade/gradient cue over the content: an earlier attempt at that covered the last rows of pills. */
.sb-scroll{scrollbar-width:thin;scrollbar-color:${isDark?"rgba(255,255,255,0.18) transparent":"rgba(26,26,46,0.18) transparent"}}
.sb-scroll::-webkit-scrollbar{width:7px}
.sb-scroll::-webkit-scrollbar-track{background:transparent}
.sb-scroll::-webkit-scrollbar-thumb{background:${isDark?"rgba(255,255,255,0.16)":"rgba(26,26,46,0.16)"};border-radius:999px}
.sb-scroll:hover::-webkit-scrollbar-thumb{background:${isDark?"rgba(255,255,255,0.28)":"rgba(26,26,46,0.28)"}}
`;
  // Reduced-motion is deliberately NOT bundled here: each page already emits one combined
  // @media block covering its own classes too, and a second one would just duplicate it.
  // Callers must include `.sb-pill` and `.sb-head` in their own reduced-motion rule.

  return { hairline, gold, textM, pill, ghostPill, Pill, Section, Panel, css };
}

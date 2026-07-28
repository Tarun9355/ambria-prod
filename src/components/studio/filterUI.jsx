import { IconCheck, IconChevron, IconSearch } from "../icons.jsx";

// ═══ PALETTE SEARCH ═══ Palette names are compound and inconsistently punctuated — "Ivory & Rani
// Pink / Magenta", "white & black", "MIX PASTELS" — so a plain substring test makes you type the
// separators exactly right and match nothing otherwise. Normalise both sides to bare words, then
// require every typed token to appear somewhere: order-free, punctuation-free, case-free, so
// "pink ivory" and "ivory & rani pink" both land on the same palette.
const normWords = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A palette matches when every token hits its name OR one of its anchour colours — so searching
// "magenta" still finds a palette that lists magenta as a colour without saying so in the name.
export function paletteMatches(name, query, anchorColours) {
  const tokens = normWords(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const hay = normWords([name, ...(anchorColours || [])].join(" "));
  return tokens.every((t) => hay.includes(t));
}

// Filter AND rank. Sorting the matches alphabetically buried the obvious answer: searching "ivory"
// put "Emerald Green & Ivory" above plain "Ivory", because E < I. Rank by how well the name matches
// first, alphabetically only within a rank.
//   0  exact name              "Ivory"
//   1  name starts with it     "Ivory & Rose Gold"
//   2  prefix mid-word         "Ivorywash"
//   3  whole word later on     "Emerald Green & Ivory"
//   4  substring anywhere
//   5  matched only through its anchour colours, nothing in the name
export function paletteSearch(names, query, anchorsOf) {
  const q = normWords(query);
  if (!q) return names;
  const tokens = q.split(" ").filter(Boolean);
  const scored = [];
  for (const name of names) {
    const n = normWords(name);
    const hay = normWords([name, ...((anchorsOf && anchorsOf(name)) || [])].join(" "));
    if (!tokens.every((t) => hay.includes(t))) continue;
    const rank = n === q ? 0
      : n.startsWith(q + " ") ? 1
      : n.startsWith(q) ? 2
      : (" " + n).includes(" " + q) ? 3
      : n.includes(q) ? 4
      : 5;
    const at = n.indexOf(tokens[0]);
    scored.push({ name, rank, pos: at < 0 ? Number.MAX_SAFE_INTEGER : at });
  }
  scored.sort((a, b) => a.rank - b.rank || a.pos - b.pos || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}

// ═══ SHARED STUDIO FILTER UI ═══
// One implementation of the filter panel used by BOTH Browse and Build, so the two can't drift
// apart. Lifted verbatim from the Browse panel — the markup and CSS it emits are unchanged.
//
// Callers own the filter state and the option lists; this module owns only the presentation:
// the sheet, the collapsible section headers with their selection summaries, and the pills.
//
// `makeFilterUI(theme)` returns the tokens + components bound to the current theme, because the
// Studio tree is inline-styles (`S`) and every value has to be threaded through explicitly.

// makeFilterUI runs during render, so building the component functions fresh each time gave every
// one of them a NEW identity — React treats a changed component type as a different component and
// remounts the entire subtree. Invisible for static pills; fatal for an <input>, which lost focus
// after every keystroke, so the palette search would only ever accept one character.
//
// Cache the built API per theme. Same theme in → the exact same Pill/Section/Panel/SearchBox
// references out, so the panel reconciles instead of remounting. `S` is rebuilt by the caller on
// every render (makeS(isDark)) and so can't be part of the key; it goes through a ref the cached
// Panel reads at render time, which keeps it current without disturbing identity.
const _uiCache = new Map();

export function makeFilterUI({ isDark, accent, textP, S }) {
  const cacheKey = `${isDark}|${accent}|${textP}`;
  const cached = _uiCache.get(cacheKey);
  if (cached) { cached.sRef.current = S; return cached.api; }
  const sRef = { current: S };
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

  // Search box for a section whose value list is long enough to hunt through (palette). Sits inside
  // the open section, above its grid. Caller owns the query state — the section is remounted as the
  // panel re-renders, so keeping it here would drop what you had typed.
  const SearchBox = ({ value, onChange, placeholder = "Search…", resultCount, totalCount }) => (
    <div style={{ marginTop: 9 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{ position: "absolute", left: 8, display: "flex", color: textM, pointerEvents: "none" }}><IconSearch size={11} /></span>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          style={{ width: "100%", boxSizing: "border-box", padding: "5px 24px 5px 25px", borderRadius: 8, fontSize: 11,
            border: `1px solid ${value ? accent : hairline}`, background: isDark ? "rgba(255,255,255,0.04)" : "#fff", color: textP, outline: "none" }} />
        {value && <span onClick={() => onChange("")} title="Clear search" role="button"
          style={{ position: "absolute", right: 7, cursor: "pointer", fontSize: 12, lineHeight: 1, color: textM }}>×</span>}
      </div>
      {value && <div style={{ fontSize: 9, color: textM, marginTop: 4 }}>
        {resultCount === 0 ? "No palettes match" : `${resultCount} of ${totalCount}`}
      </div>}
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
    <div className="sb-panel" style={{...sRef.current.card, padding:0, boxShadow: isDark
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

  const api = { hairline, gold, textM, pill, ghostPill, Pill, Section, Panel, SearchBox, css };
  _uiCache.set(cacheKey, { api, sRef });
  return api;
}

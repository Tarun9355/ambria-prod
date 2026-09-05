// ═════════════════════════════════════════════════
// DEAL CHECK — SHARED SURFACE + INK TOKENS
//
// These started as a private const block inside DCManpowerTab, and DealCheckOverlay
// grew its own near-identical `IV` object separately. The two drifted, which is how
// the Manpower tab ended up carrying two different ambers at once — the new gold on
// its badges and a leftover #B45309 in its derivation tables — and how one tab's
// "quiet ink" ended up three shades lighter than another's. A palette that lives in
// two files is a palette that will disagree with itself.
//
// ── WARM, NOT COOL ──
// The greys here were blue-biased (#F5F6F8 / #E4E6EA / #7C8296) — the default of
// every SaaS dashboard. Deal Check sits on ivory-and-gold chrome: cream ground,
// aubergine navbar, gold wordmark. Cool neutrals inside that read as a foreign
// component pasted into the page. These are the same values rotated warm, so the
// neutral carries a trace of the ground it sits on, and the ink is the navbar's own
// aubergine rather than a generic near-black.
//
// ── ALL THREE INKS ARE TEXT ──
// Every level here has to be READABLE; the quiet one is still text, not decoration.
// Measured on the warm tile (#FBF9F6):
//     INK    16.0:1    INK_2   8.6:1    INK_3   5.3:1    GOLD   5.1:1 on GOLD_SOFT
// An earlier pass had INK_3 at #948CA3 — 3.1:1, below the 4.5:1 body threshold —
// which greyed out every meta line, eyebrow and caption on the page at once. If you
// lighten these, check them; "subordinate" and "illegible" are one hex apart.
// ═════════════════════════════════════════════════

export const CARD_SHADOW = "0 1px 2px rgba(36,30,53,0.05), 0 6px 20px -8px rgba(36,30,53,0.10)";
export const CARD_BG = "#FFFFFF";
export const CARD_BORDER = "#E9E4DC";
export const HAIRLINE = "#F1ECE4";
export const TILE_BG = "#FBF9F6";
export const TILE_BORDER = "#EDE8E0";
export const CHIP_BG = "#F2EDE5";

export const INK = "#241E35";
export const INK_2 = "#4C4560";
export const INK_3 = "#6B6480";

// The single accent. It marks the one state that means something and the totals
// that end a calculation — nowhere else. An accent that appears on every row
// marks nothing, which is what the old green "DERIVED" badge proved.
export const GOLD = "#7E6226";
export const GOLD_SOFT = "#F7F1E3";

// Money and counts are read down a column and compared, so they need fixed-width
// digits. Spread into a style object: {...NUM}.
export const NUM = { fontVariantNumeric: "tabular-nums" };

// ── SEMANTIC STATES ──
// Distinct from GOLD, which marks "a person decided this". These three mark what
// a thing IS: a shortage is bad, a saving is good, a hold is pending someone
// else's decision. Colour is doing real work here — unlike the old green
// "DERIVED" badge that sat on every row and therefore meant nothing.
//
// Warm-rotated, like the neutrals: the stock #EF4444 / #10B981 pair sat inside
// ivory chrome looking like a validation error in a different app. These read as
// the same page. All four inks clear 4.5:1 on both white and their own tile.
export const BAD = "#9B3A3A";
export const BAD_SOFT = "#F8EAEA";
export const GOOD = "#3B6B4C";
export const GOOD_SOFT = "#E8F1EA";

// ── ONE HUE PER DEPARTMENT ──
// Department cards were six identical ivory tiles distinguished only by a 26px
// emoji and a word, so finding "Floral" meant reading every heading in turn.
// The set is small, fixed and the same everywhere in the app, which is exactly
// the condition where colour earns its place: you learn the hue once and then
// locate a department without reading at all.
//
// Desaturated on purpose. These sit inside a warm ivory page next to a gold
// accent; at full saturation six of them stacked would be louder than every
// figure on the screen, which is the mistake the old green shift pills made.
// Each entry gives a stripe (the card's left edge) and a tile (its icon
// square) — never a text colour, so the ink hierarchy is untouched.
export const DEPT_ACCENT = {
  Furniture: { stripe: "#A67C52", tile: "#F3EADF" },
  Floral:    { stripe: "#B87289", tile: "#F7EAEE" },
  Structure: { stripe: "#6F63A8", tile: "#EBE8F4" },
  Tenting:   { stripe: "#6F8F6A", tile: "#E9F0E7" },
  Lighting:  { stripe: "#C6A55E", tile: "#F7F1E0" },
  Fabric:    { stripe: "#5F8A8B", tile: "#E5EFEF" },
  Transport: { stripe: "#6C82A0", tile: "#E9EEF4" },
  Buffer:    { stripe: "#A85D52", tile: "#F6E9E6" },
};
// Unknown departments fall back to the neutral rather than borrowing another
// department's colour — a wrong hue is worse than no hue, because the whole
// point is that the mapping is dependable.
export const deptAccent = (d) => DEPT_ACCENT[d] || { stripe: "#B9B2C4", tile: "#EFEDF1" };

// ── ONE SHARED HOVER SHEET ──
// Hover, focus and grid column counts cannot be expressed as inline styles, which
// is the only reason these tabs carry a stylesheet at all.
//
// The !important is load-bearing, not defensive: this codebase styles inline, and
// an inline declaration outranks a plain stylesheet rule. Every property below that
// also appears in an element's style={{...}} — background, border, box-shadow —
// needs it or the hover silently does nothing. Written without it, the card lift and
// the row highlight both no-op'd. .dc2-ghost uses filter instead, so one rule can
// hover a neutral chip and a gold button without either needing its own override.
export const DC_CSS = `
.dc2-card{transition:box-shadow .16s ease,border-color .16s ease}
.dc2-card:hover{box-shadow:0 2px 4px rgba(36,30,53,.06),0 14px 30px -10px rgba(36,30,53,.14)!important;border-color:#DED7CB!important}
.dc2-hd{cursor:pointer;transition:background .14s ease}
.dc2-hd:hover{background:#FCFAF7}
.dc2-row{transition:background .14s ease,border-color .14s ease,box-shadow .16s ease}
.dc2-row:hover{background:#FFFFFF!important;border-color:#DED7CB!important;box-shadow:0 1px 2px rgba(36,30,53,.04),0 8px 18px -10px rgba(36,30,53,.16)!important}
.dc2-ghost{transition:filter .14s ease,border-color .14s ease}
.dc2-ghost:hover{filter:brightness(.97);border-color:#DED7CB!important}
.dc2-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1040px){.dc2-sum{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.dc2-sum{grid-template-columns:1fr}}
/* Content cards (department groups, trade cards). Three up rather than the summary
   bar's four, because these carry two right-aligned number columns as well as a
   name — at a quarter width the name would ellipsise to nothing. Grid, not
   flex-wrap: with flex a trailing card alone on its line grows to fill it, so an
   odd count renders one double-width card. */
/* No align-items:start — grid items stretch by default, so every card in a row
   ends on the same line. That is the point: a row of cards that all stop at
   different heights reads as broken, whereas a short card with room at the
   bottom reads as a short card. The leftover space sits INSIDE the card's
   border, where it looks deliberate, rather than as a ragged gap outside it. */
.dc2-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
@media (max-width:1400px){.dc2-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.dc2-grid{grid-template-columns:1fr}}
/* Four up, for compact cards that carry a thumbnail and two short lines. Grid
   rows stretch by default, so every card in a row ends on the same line — a row
   of cards stopping at different heights reads as broken. */
.dc2-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1500px){.dc2-grid4{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1100px){.dc2-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){.dc2-grid4{grid-template-columns:1fr}}
/* ── MASONRY, FOR CARDS OF WILDLY DIFFERENT HEIGHT ──
   A CSS grid sizes every row to its tallest cell. Department cards hold anywhere
   from one sub-category to five, so a row containing Lighting (five) left Buffer
   (one) sitting above a half-screen of dead space — which reads as broken
   spacing rather than as a short card. Multi-column flows each card directly
   under the previous one in its column instead, so the gaps are all equal and
   the block ends where the content ends.
   The trade-off is reading order: columns fill top-to-bottom, not left-to-right.
   That is fine for departments, which have no meaningful sequence — do NOT reuse
   this for anything ordered, like days or functions.
   inline-block + width:100% is what makes break-inside:avoid hold up across
   browsers; without it cards split across a column boundary mid-row. */
.dc2-masonry{column-count:3;column-gap:14px}
.dc2-masonry>*{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;display:inline-block;width:100%;margin-bottom:14px}
@media (max-width:1400px){.dc2-masonry{column-count:2}}
@media (max-width:900px){.dc2-masonry{column-count:1}}
`;

// ═══ TRUSS LAYOUT DIAGRAM (Dept Book, one per truss) ═══
//
// Owner ask (2026-11-19): the breakdown says WHAT to cut, never WHERE it stands. The crew was
// redrawing the plan by hand on site; this prints the plan itself.
//
// Schematic, NOT to scale: every drawn piece is the same length on the page whatever it measures,
// so the diagram stays one compact strip for a 12 ft bay and a 60 ft one alike. The figure on a
// piece is its real length; that is what the crew reads, not the drawn width.
//
// ── THREE THINGS THIS GETS RIGHT THAT A FIRST READING OF THE TOPOLOGY GETS WRONG ──
//
// 1. A BAY IS NOT ONE PIECE. A 22 ft run between two pillars is built from a 12 ft and a 10 ft beam
//    joined — which is exactly what the cut list beside it says. Drawn as a single "22" the crew had
//    to work back from the cut list to see where the joint fell, so each bay is split into the real
//    stock pieces `resolveBay` resolves it to, drawn with a gap at every joint (owner ask, fourth
//    pass). With no resolver the bay is drawn whole, as before.
//
// 2. QTY IS A REPEAT, NOT A LONGER RUN. scaleTopologyForQty (trussEngine) builds a Truss Qty of N by
//    pushing the SAME pieces N times — a Single U ×5 arrives as five identical `top` beams, not as
//    five bays of one run. Read naively that draws one continuous 5-bay structure; the truth is five
//    separate frames of one bay each. So bays are deduped by side name and the repeat count comes
//    back as `qty` for the caller to print as "× 5" — ONE frame is drawn, not five (owner ask, fifth
//    pass): five copies of the same figure said nothing the count does not, and cost the width that
//    makes the one frame legible.
//
// 3. A HALF BOX IS A U, NOT A BOX. buildTopology gives a full box `front`, `back`, `left`, `right`
//    and a closed rectangle of pillars; a half box gets `front`, `left`, `right` and NO back — a
//    run with a leg dropping from each END only (ids P-frontL/Mid/R + P-backL/P-backR). Closing
//    that rectangle, as a first cut did, drew a back run and a mid leg that do not exist: six
//    pillars and eleven runs where the cut list beside it says five and three. The three shapes are
//    told apart by their sides and drawn as what they are.
//
// 4. WHICH AXIS RUNS ACROSS THE PAGE. deptBookHtml builds a BOX's chip as W = physicalW,
//    D = physicalL, so a box draws its W-axis across and its L-axis down and the figure across the
//    top is the "W" that chip names. A U and a single line are drawn the way they stand instead —
//    the long run across, the legs (if any) dropping from it — because that is the shape itself,
//    not a choice of axis.
//
// Cross beams (`cross-NS*`, `cross-WE*`) are the SAME bays the perimeter already names, so they are
// not read again: a grid node is drawn wherever an across-bay and a down-bay cross.
//
// The pillar's own 9 in width is NOT drawn. It is the same on every pillar of every zone, so it told
// the crew nothing and crowded the figures that do change (owner call, 2026-11-19).

const STEP_MAX = 64;          // px a drawn piece gets at full size
const STEP_MIN = 30;          // px — below this a piece's figure stops fitting on it
const JOINT = 7;              // px of clear air at a joint between two pieces of one bay
const BOX = 13;               // px — the pillar square
const PAD_H = 46;             // px — side room for the down-axis figures
const PAD_T = 30;             // px — room above the top row for its figures
const PAD_B = 30;             // px — ditto below the bottom row, which only a box repeats them under
const PAD_B_FLAT = 14;        // px — a single line has no figures under it, so it needs only margin

// Fallback width when the caller names none. deptBookHtml passes the real room its row leaves after
// the label gutter and the zone thumbnail, so the drawing is sized to fit beside them rather than
// painted under them.
const DRAW_W_DEFAULT = 680;

/**
 * One side's bays, plus how many times the whole set repeats.
 *
 * `front` alone when there is a single bay, `front-1`, `front-2`, … when there are several. A
 * SECOND `front-1` is not a sixth bay — it is the next truss of a Truss Qty > 1, so the set is
 * deduped by side name and the repeat count returned separately. A plain string sort would put
 * `front-10` before `front-2`, so the suffix is compared as a number.
 */
function baysOf(beams, prefix) {
  const hit = (beams || []).filter((b) => b?.side === prefix || String(b?.side || "").startsWith(`${prefix}-`));
  if (!hit.length) return { bays: [], repeats: 1 };
  const first = new Map();
  hit.forEach((b) => { if (!first.has(b.side)) first.set(b.side, Number(b.lengthFt) || 0); });
  const nth = (side) => Number(String(side).slice(prefix.length + 1)) || 0;
  const bays = [...first.entries()].sort((a, b) => nth(a[0]) - nth(b[0])).map(([, len]) => len);
  return { bays, repeats: Math.max(1, Math.round(hit.length / first.size)) };
}

// A length prints as the crew says it: whole feet bare, a fraction to one place ("12", "7.5").
const ft = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// Walk one axis, placing each piece and leaving a joint's gap inside a bay. Pillars land where one
// bay ends and the next begins; a joint is only ever inside a bay, never at a pillar.
function walk(bayPieces, step) {
  const pillars = [0];
  const segs = [];
  let at = 0;
  bayPieces.forEach((pieces) => {
    pieces.forEach((len, i) => {
      segs.push({ from: at, to: at + step, len });
      at += step + (i < pieces.length - 1 ? JOINT : 0);
    });
    pillars.push(at);
  });
  return { pillars, segs, size: at };
}

/**
 * SVG for one truss's plan view.
 *
 * `resolveBay(lengthFt)` returns the real stock pieces that bay is built from, longest first, as
 * plain lengths (`[12, 10]` for a 22 ft run) — deptBookHtml passes trussEngine's resolveBeamSegment
 * against the truss's own material stock. Omitted, each bay is drawn as one piece.
 *
 * `maxHeightPx` caps the drawn height, the whole plan scaling down inside its viewBox.
 *
 * The drawing carries no words at all — only figures and the frame — so it reads the same in the
 * book's Hindi mode as its English one without a translator being passed in.
 *
 * @returns {{ svg: string, heightPx: number, qty: number } | null}
 */
export function trussDiagramSvg(topology, { maxHeightPx = 0, maxWidthPx = 0, resolveBay = null } = {}) {
  const beams = topology?.beams;
  if (!Array.isArray(beams) || !beams.length) return null;
  const DRAW_W = maxWidthPx > 0 ? maxWidthPx : DRAW_W_DEFAULT;

  // A box and a U both name their long side `front`; only a box has a `back`. A single line names
  // its one side `top` and has no second axis at all.
  let lAxis = baysOf(beams, "front");
  const wAxis = lAxis.bays.length ? baysOf(beams, "left") : { bays: [], repeats: 1 };
  const closed = lAxis.bays.length > 0 && baysOf(beams, "back").bays.length > 0;
  if (!lAxis.bays.length) lAxis = baysOf(beams, "top");
  if (!lAxis.bays.length) return null;

  const qty = Math.max(1, lAxis.repeats);
  // box: a closed rectangle, W across and L down. u: the long run across with a leg off each end.
  // line: the run alone.
  const shape = closed ? "box" : (wAxis.bays.length ? "u" : "line");
  const deep = shape !== "line";

  // Each bay as the pieces it is really built from. A resolver that comes back empty — a length no
  // stock size can make — leaves the bay drawn whole at its ideal length rather than vanishing; the
  // cut list beside it is what flags the piece as not in stock.
  const piecesOf = (bays) => bays.map((b) => {
    const p = resolveBay ? (resolveBay(b) || []) : [];
    return p.length ? p : [b];
  });
  // A box turns so its W-axis runs across; a U and a line are drawn as they stand.
  const across = piecesOf(shape === "box" ? wAxis.bays : lAxis.bays);
  const down = piecesOf(shape === "box" ? lAxis.bays : shape === "u" ? wAxis.bays : []);

  const nAcross = across.reduce((s, p) => s + p.length, 0);
  const jAcross = across.reduce((s, p) => s + p.length - 1, 0);
  const nDown = down.reduce((s, p) => s + p.length, 0);
  const jDown = down.reduce((s, p) => s + p.length - 1, 0);

  // One frame, as large as BOTH budgets allow: a Truss Qty of N is the same frame N times, and the
  // count says so without redrawing it. The step is sized against the height as well as the width —
  // sized on width alone, a deep box came out taller than its cap and was then scaled down whole,
  // taking its figures with it: a 95 x 70 ft box printed at 4 px, unreadable (review, 2026-11-19).
  const stepW = Math.floor((DRAW_W - 2 * PAD_H - jAcross * JOINT) / nAcross);
  const roomDown = maxHeightPx > 0 ? maxHeightPx - PAD_T - (deep ? PAD_B : PAD_B_FLAT) : 0;
  const stepH = nDown > 0 && roomDown > 0 ? Math.floor((roomDown - jDown * JOINT) / nDown) : Infinity;
  const step = Math.max(STEP_MIN, Math.min(STEP_MAX, stepW, stepH));

  const row = walk(across, step);
  const col = walk(down, step);

  const ys = col.pillars.map((y) => PAD_T + y);
  const y0 = ys[0], y1 = ys[ys.length - 1];
  const w = PAD_H + row.size + PAD_H;
  const h = y1 + (deep ? PAD_B : PAD_B_FLAT);

  const out = [];
  const line = (a, b, c, d) => out.push(`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#1A1A1A" stroke-width="2"/>`);
  const text = (x, y, s, { anchor = "middle", size = 11.5, fill = "#1A1A1A" } = {}) =>
    out.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${s}</text>`);

  const xs = row.pillars.map((x) => PAD_H + x);
  // A box is closed, so every row carries the across run and every column carries a down run. A U
  // has one across run and a leg at each END only — no back run, no leg off a mid pillar.
  const acrossRows = shape === "box" ? ys : [y0];
  const downCols = shape === "box" ? xs : shape === "u" ? [xs[0], xs[xs.length - 1]] : [];

  // ── the pieces, one drawn run each, the gap between two of them being the joint ──
  acrossRows.forEach((y) => row.segs.forEach((s) => line(PAD_H + s.from, y, PAD_H + s.to, y)));
  downCols.forEach((x) => col.segs.forEach((s) => line(x, PAD_T + s.from, x, PAD_T + s.to)));

  // ── pillars: a square with its diagonals, the way the plan is drawn on paper ──
  // A box has one at every crossing; a U has its run's pillars plus the foot of each leg.
  const nodes = shape === "box"
    ? ys.flatMap((y) => xs.map((x) => [x, y]))
    : [...xs.map((x) => [x, y0]), ...(shape === "u" ? downCols.map((x) => [x, y1]) : [])];
  const half = BOX / 2;
  nodes.forEach(([x, y]) => {
    out.push(`<rect x="${x - half}" y="${y - half}" width="${BOX}" height="${BOX}" fill="#FFF" stroke="#1A1A1A" stroke-width="1.5"/>`);
    line(x - half, y - half, x + half, y + half);
    line(x + half, y - half, x - half, y + half);
  });

  // ── each piece's own length, on the piece, on every run it is part of ──
  // Under the bottom row and beside every column, not just the frame's two outer edges (owner ask,
  // 2026-11-19): the crew reads the run it is standing at, and a figure three columns away is not
  // that one. Every run of the frame carries its own pieces' lengths.
  row.segs.forEach((s) => {
    const mid = PAD_H + (s.from + s.to) / 2;
    text(mid, y0 - 11, ft(s.len));
    if (shape === "box") text(mid, y1 + 21, ft(s.len));
  });
  downCols.forEach((x) => col.segs.forEach((s) => text(x + 9, PAD_T + (s.from + s.to) / 2 + 4, ft(s.len), { anchor: "start" })));

  // Drawn at its own size. `maxHeightPx` is spent on the STEP above, never on scaling the finished
  // picture: scaling shrinks the figures with it, and a frame deep enough to need it is exactly the
  // one whose figures matter — a 150 x 28 ft box came out at 4 px that way (review, 2026-11-19).
  // Once the step is down to STEP_MIN the frame is as small as it can be read at, so it keeps that
  // size and reports it; the caller budgets the real height and simply fits fewer on a page.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:100%;height:auto;font-family:Arial,Helvetica,sans-serif">${out.join("")}</svg>`;
  // A frame wider than the room it is given is still shrunk by max-width, and height:auto takes the
  // height with it, so that much the reserved figure must allow for. Rounded UP, never to nearest:
  // reserving a half-pixel less than it renders is what pushes a page past its sheet.
  return { svg, heightPx: Math.ceil(h * Math.min(1, DRAW_W / w)), qty };
}

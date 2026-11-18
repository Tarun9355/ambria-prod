// Deal Check's Tenting lines for one truss row's resolved stock pieces (DealCheckOverlay's Tenting rollup).
//
// pieces: resolvePillarHeight / resolveBeamSegment output, flattened - each { kind: "pillar" | "beam", role, size, qty }:
//   a pillar's own top piece is kind "pillar"; the beam set at the ground under a pillar to make up its height (14 ft = 12 ft
//   pillar + 2 ft beam) is kind "beam", role "base"; a beam segment is kind "beam", role "segment".
// One line per stock item and size (owner ask 2026-11-18): a 2 ft beam is the same beam from the same stock whether it is a
// segment or a pillar's base, so both land on one "Truss beam 2ft" line (8 + 1 = 9). Each piece keeps the rate it is billed at -
// a base beam is inside the pillar's height, so the pillar rate; a segment the beam rate - and the line's total is the sum,
// its unit their per-piece average (total = unit x qty).
export function trussPieceLines({ pillars = {}, beams = {}, bases = {} } = {}, pillarRftRate = 0, beamRftRate = 0) {
  const out = [];
  const each = (ft, rate) => Math.round(Number(ft) * (Number(rate) || 0));
  Object.entries(pillars).forEach(([ft, n]) => {
    if (!(n > 0)) return;
    const unit = each(ft, pillarRftRate);
    out.push({ name: `Truss pillar ${ft}ft`, qty: n, unit, total: unit * n });
  });
  [...new Set([...Object.keys(beams), ...Object.keys(bases)])].forEach((ft) => {
    const nb = Number(beams[ft]) || 0, ns = Number(bases[ft]) || 0, n = nb + ns;
    if (!(n > 0)) return;
    // the line's rate is the two rates' per-piece average, and its total that rate x qty - so IMS Dept Ops' "rate x qty = total"
    // check holds (a rupee or two of rounding against the zone's billed truss, as every truss line already has)
    const unit = Math.round((nb * each(ft, beamRftRate) + ns * each(ft, pillarRftRate)) / n);
    out.push({ name: `Truss beam ${ft}ft`, qty: n, unit, total: unit * n });
  });
  return out;
}

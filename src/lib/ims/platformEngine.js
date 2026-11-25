import { isPlatformFoc } from "../studio/foc.js";
import { supabase } from "../supabase";
import { eoToFnList, isDeptHead, expireStaleSimulations } from "./trussEngine";

// Platform's date-aware booking, mirroring trussEngine.js's pool-feasibility/allocation layers
// (§23 Phase 3/4) but simplified to match how a platform is actually specified — there is no
// picker of named physical pieces (unlike pillars/beams): a zone just types a Height band, a
// floorDims L×W, and a quantity (StudioBuild.jsx's Platform/Carpet card), shared with Carpet.
//
// PLATFORM MATERIAL (Wood/Iron, each row's own `material` field in trussInv.platforms — Admin →
// Settings → Platform Config) is a completely separate axis from a zone's TRUSS material
// (iron/pole/aluminium). Confirmed bug this closes (found 2026-11-05): this used to reuse the
// truss-material taxonomy for platforms entirely — PLATFORM_MATERIALS was
// ["iron","pole","aluminium"], and the old platformsForMaterial read trussInv.materials[mat].platforms,
// a structure platforms never actually populate (every real platform row lives in the one flat
// trussInv.platforms array below, distinguished only by its own `material` text) — so every
// material bucket silently fell back to the SAME full array, showing identical totals for all three
// and pooling truss-material demand that was never a real, separate stock pool.
//
// Booking uses ONE COMBINED sqft pool (Wood + Iron summed) rather than splitting demand by
// platform material, because no zone-level control exists for "which platform material does this
// booking use" (owner decision, 2026-11-05) — see PLATFORM_POOL_KEY/platformEventSqft below.
// Admin Config and the stock dashboard still show Wood vs Iron SUPPLY separately for inventory
// purposes; only the booking/feasibility math is unified.
//
// Billing: platformAvgRatePerSqft (below) feeds Deal Check's rental cost/margin via
// buildPlatformPlan (pricing.js) and the Tenting rollup (DealCheckOverlay.jsx) — both now bill the
// stock-weighted BLENDED average across all platform stock, for the same no-per-booking-signal
// reason.
export const PLATFORM_MATERIALS = ["wood", "iron"];
// The single key every booking/feasibility structure uses now — kept as an object key (not a bare
// number) so the existing generic demand/stock/overflow machinery below, and every saved
// platform_allocations/platform_overrides/platform_simulations row, keeps working unchanged.
export const PLATFORM_POOL_KEY = "all";
export const PLATFORM_MATERIAL_LABEL = { wood: "Wood", iron: "Iron" };

// A platform row's own material, normalised. "iron" is the catch-all fallback for anything that
// isn't recognisably "wood" (missing/empty/typo'd/a metal name like "Steel") — matches the
// "iron" default every other material field in this app already uses, and production has exactly
// one Wood row against six metal ones.
export const platformMaterialOf = (row) => {
  const m = String(row?.material ?? "").trim().toLowerCase();
  return m.startsWith("wood") ? "wood" : "iron";
};

// Filters the one flat trussInv.platforms array by each row's OWN material — never reads
// trussInv.materials[x].platforms (that structure is for truss pillars/beams/rates, not platforms,
// and no material has ever populated it). Omit `material` for every row (used for the combined
// pool's stock total and the blended billing rate); passing a non-platform-material string (e.g.
// "pole") deliberately returns [] rather than silently falling back to the full array.
export const platformsForMaterial = (trussInv, material) => {
  const all = Array.isArray(trussInv?.platforms) ? trussInv.platforms : [];
  if (material == null || material === "") return all;
  const mat = String(material).trim().toLowerCase();
  if (!PLATFORM_MATERIALS.includes(mat)) return [];
  return all.filter((r) => platformMaterialOf(r) === mat);
};

export const platformStockSqft = (trussInv, material) => platformsForMaterial(trussInv, material)
  .reduce((s, r) => s + (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0), 0);

// The combined pool's total stock — Wood + Iron summed. Named separately from platformStockSqft
// (which can also do this via a no-argument call) so call sites reading "the one pool total" say so.
export const platformTotalStockSqft = (trussInv) => platformStockSqft(trussInv);

// Stock-weighted average ₹/sqft — Ambria's own internal cost rate, the same role the old
// Fatta/Stand inventory items' rentalCost played before Platform Config replaced them (2026-11-01
// owner call: platform is no longer tracked via TEN-00008/TEN-00009 at all — see DealCheckOverlay.jsx's
// Tenting rollup). Called with NO material (the billing/cost mode) this blends across every
// configured row regardless of Wood/Iron — there's no per-booking signal for which material a given
// zone's platform actually is, so every zone bills at the same blended rate. A specific material can
// still be asked for (kept for tests/future display), but nothing bills off it any more.
export const platformAvgRatePerSqft = (trussInv, material) => {
  let sqftSum = 0, costSum = 0;
  platformsForMaterial(trussInv, material).forEach((r) => {
    const area = (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0) * (Number(r.stock) || 0);
    sqftSum += area;
    costSum += area * (Number(r.ratePerSqft) || 0);
  });
  return sqftSum > 0 ? costSum / sqftSum : 0;
};

// Breaks a floor's need into the actual physical pieces a Tenting head would go pull off the rack
// (owner ask 2026-11-23: "we know the sqft needed, we know the sqft of each piece, so why not just
// show pieces"; owner-reported follow-up, 2026-11-25, see below). Platform Config can hold SEVERAL
// distinct L×W/thickness/material rows at once — unlike a truss pillar/beam, which is a specific
// named size a zone's own height band resolves to directly, a platform floor is only ever specified
// as a plain L×W (+ qty copies) in Build, so there is no single "the" piece size to divide by.
//
// This is a physical-pieces DISPLAY/recommendation layer only and never changes what gets billed —
// platformAvgRatePerSqft's blended rate, and every real allocation/feasibility check in this file
// (computePlatformPoolFeasibility etc.), are untouched.
//
// Four confirmed gaps (owner report, 2026-11-25), fixed here together rather than as three bolt-ons:
//
// 1. THICKNESS MIX — two config rows can share a footprint (e.g. 8×4=32 sqft) but differ in
//    thicknessIn. The old code grouped sizes purely by sqftPerPiece, so once the first same-footprint
//    row's stock ran out mid-floor it would silently start pulling a DIFFERENT thickness for that
//    SAME floor — an uneven physical deck. Now a floor always prefers pieces of ONE thickness group;
//    mixing only happens when no single group can cover it, and the result is flagged `mixedThickness`.
// 2. REMAINDER WASTE — the old top-up always reached for the single globally-smallest configured
//    size regardless of whether a smaller/better-fitting size with real stock existed (100 sqft
//    pulling 128 sqft's worth, 28 wasted, when the real cause was simply no smaller size being
//    configured at all — see bestFitTopUp below, which now searches every available size).
// 3. NO PHYSICAL FIT CHECK — the old code only matched total sqft; three 8×4 (32 sqft) pieces "fit"
//    100 sqft by the numbers but can't actually tile a 10×10 floor. solveTiling below attempts a real
//    geometric tiling (rows along either axis, 90° rotation, real stock limits), allows the floor to
//    be built up to PLATFORM_OVERSIZE_MAX_FT larger per side when an exact fit isn't possible, and
//    only falls back to a sqft-only guess (flagged `tilingUnresolved`) when nothing tiles at all.
// 4. MISSING FROM THE PDF — deptBookHtml.js now reuses this same engine (see "Platform pieces to
//    pull" there) instead of the on-screen breakdown being the only place this ever showed.
//
// Decks are built as straight rows, never arbitrary jigsaw: each row has one depth (one piece side,
// along B) and, along its length (A), one or more pieces whose run-lengths sum to A. Searching every
// sequence of row depths summing to B, and every composition of each depth's own row (fewest pieces
// first), covers every buildable row/strip layout without general rectangle-packing's NP-hard
// generality, which real decking never uses anyway.
const PIECE_EPS = 1e-6;
// How much bigger than the requested floor a deck may be built, per side, when no stocked size tiles
// it exactly (never smaller — billing is on the requested sqft either way). Owner call, 2026-11-25.
export const PLATFORM_OVERSIZE_MAX_FT = 2;
const OVERSIZE_MAX_IN = PLATFORM_OVERSIZE_MAX_FT * 12;
const ROW_COMP_CAP = 24;       // row compositions kept per (row length, depth)
const COMP_ENUM_CAP = 20000;   // recursion steps while enumerating one row's compositions
const SOLVE_NODE_CAP = 1500;   // DFS nodes per single solveTiling attempt
const CALL_NODE_CAP = 40000;   // DFS nodes across one whole platformPullPlan call — pathological
                                // configs degrade to the flagged sqft-only answer, never hang or throw
const OVERSIZE_PAIR_CAP = 9;   // oversize (L,W) candidates tried, least-extra-area first
const TOPUP_NODE_CAP = 5000;   // search budget for the best-fit remainder search
const toIn = (ft) => Math.round((Number(ft) || 0) * 12); // all geometry in integer inches (half-feet = 6in)

// All configured sizes, normalised once per call: inches, a fpKey (footprint, orientation-free),
// and a thickness-group key ("?" for rows with no positive thickness set). `groups` keeps the
// insertion order sizes were first seen in (itself sorted largest-sqftPerPiece-first), so a tier that
// iterates "every thickness group" tries the biggest/most-likely group first.
const normSizes = (trussInv) => {
  const sizes = [];
  platformsForMaterial(trussInv, null).forEach((r, i) => {
    const lIn = toIn(r.lengthFt), wIn = toIn(r.widthFt);
    if (lIn <= 0 || wIn <= 0) return;
    const t = Number(r.thicknessIn);
    sizes.push({
      _row: i, id: r.id, label: (r.label && String(r.label).trim()) || `${r.lengthFt}×${r.widthFt}ft`,
      lengthFt: r.lengthFt, widthFt: r.widthFt, lIn, wIn,
      fpKey: `${Math.min(lIn, wIn)}x${Math.max(lIn, wIn)}`, areaIn: lIn * wIn,
      sqftPerPiece: (Number(r.lengthFt) || 0) * (Number(r.widthFt) || 0),
      thicknessIn: t > 0 ? t : null, tKey: t > 0 ? String(Math.round(t * 100) / 100) : "?",
      material: platformMaterialOf(r), stock: Math.max(0, Math.floor(Number(r.stock) || 0)),
    });
  });
  sizes.sort((a, b) => b.sqftPerPiece - a.sqftPerPiece);
  const groups = new Map();
  sizes.forEach((r) => { if (!groups.has(r.tKey)) groups.set(r.tKey, []); groups.get(r.tKey).push(r); });
  return { sizes, groups };
};

// A "part" (DealCheckOverlay.jsx's per-floor Platform row) → floor dims, when known. `floorL`/
// `floorW`/`copies` are the real numbers (added alongside the pre-existing formatted `dims` string,
// which a part saved before this shipped still carries); falls back to parsing that legacy string,
// then to sqft-only when neither is usable or disagrees with the billed sqft (a defensive guard, not
// an expected path).
export const platformFloorsFromParts = (parts) => (Array.isArray(parts) ? parts : []).map((pt) => {
  const label = [pt?.zone, pt?.fn].filter(Boolean).join(" · ");
  const fnIdx = pt?.fnIdx;
  let L = Number(pt?.floorL), W = Number(pt?.floorW), copies = Math.round(Number(pt?.copies)) || 1;
  if (!(L > 0 && W > 0)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)(?:\s*[×x]\s*(\d+))?\s*$/i.exec(String(pt?.dims || ""));
    if (m) { L = +m[1]; W = +m[2]; copies = m[3] ? +m[3] : 1; }
  }
  const sqft = Number(pt?.qty) || 0;
  if (L > 0 && W > 0 && (sqft <= 0 || Math.abs(L * W * copies - sqft) <= 0.5)) return { L, W, copies: Math.max(1, copies), label, fnIdx };
  return { sqft, label, fnIdx };
});

// One call's input, normalised to one entry PER PHYSICAL FLOOR (a floor with `copies: 3` becomes
// three separate floor entries — a piece can't be split across two different floors, and each must
// round/tile on its own; stock is still one pool shared and drawn down across all of them, in order).
// `fnIdx` rides along (when the caller's entry carries one) purely so platformPullPlan can attribute
// each committed piece back to the function it was pulled for (its own `byFn` on the aggregate pieces
// list) — it plays no part in the tiling/stock-sharing itself, which stays whole-call, in order.
const normFloors = (input) => {
  const out = [];
  (Array.isArray(input) ? input : [input]).forEach((entry) => {
    if (entry == null) return;
    if (typeof entry === "number") {
      const sqft = Math.max(0, entry);
      if (sqft > PIECE_EPS) out.push({ sqft, hasDims: false, label: "" });
      return;
    }
    const L = Number(entry.L), W = Number(entry.W);
    if (L > 0 && W > 0) {
      const copies = Math.max(1, Math.round(Number(entry.copies)) || 1);
      for (let k = 0; k < copies; k++) out.push({ sqft: L * W, hasDims: true, L, W, lIn: toIn(L), wIn: toIn(W), copy: k + 1, copies, label: entry.label || "", fnIdx: entry.fnIdx });
      return;
    }
    const sqft = Math.max(0, Number(entry.sqft ?? entry.qty) || 0);
    if (sqft > PIECE_EPS) out.push({ sqft, hasDims: false, label: entry.label || "", fnIdx: entry.fnIdx });
  });
  return out;
};

// Distinct ways to fill a row of length A from footprints whose run-length (side along A) is one of
// `runs` ([{ r, fpKey }], distinct r, descending) — fewest pieces first, plus alternatives using
// fewer big pieces (useful when the biggest size's own stock is short). Capped on both result count
// and recursion steps so a pathological config degrades rather than hangs.
const rowCompositions = (A, runs) => {
  const out = [];
  const counts = new Array(runs.length).fill(0);
  let steps = 0;
  const rec = (i, rem) => {
    if (out.length >= ROW_COMP_CAP * 4 || ++steps > COMP_ENUM_CAP) return;
    if (rem === 0) { out.push(counts.slice()); return; }
    if (i === runs.length) return;
    const r = runs[i].r;
    if (i === runs.length - 1) {
      if (r > 0 && rem % r === 0) { counts[i] = rem / r; out.push(counts.slice()); counts[i] = 0; }
      return;
    }
    for (let n = Math.floor(rem / r); n >= 0; n--) {
      counts[i] = n;
      rec(i + 1, rem - n * r);
      if (out.length >= ROW_COMP_CAP * 4 || steps > COMP_ENUM_CAP) break;
    }
    counts[i] = 0;
  };
  rec(0, A);
  return out
    .map((c) => {
      const fp = new Map(); let pieces = 0;
      c.forEach((n, j) => { if (n > 0) { fp.set(runs[j].fpKey, n); pieces += n; } });
      return { pieces, fp };
    })
    .sort((x, y) => x.pieces - y.pieces || x.fp.size - y.fp.size)
    .slice(0, ROW_COMP_CAP);
};

// Attempts a real tiling of an A×B rectangle (inches) from `fps` ([{fpKey,a,b,areaIn}], a≤b), with
// `avail` a Map of fpKey → remaining count (or Infinity). DFS over row-depth sequences (canonical
// non-decreasing row-type order, so permutations of the same multiset of rows aren't re-explored),
// pruned by an area lower bound and a reachability precheck, under `budget.left` (mutated) DFS nodes.
// Returns null when nothing fits in budget or at all; never throws.
const solveTiling = (A, B, fps, avail, budget) => {
  if (A <= 0 || B <= 0) return null;
  const usable = fps.filter((f) => (avail.get(f.fpKey) || 0) > 0);
  if (!usable.length) return null;

  let allFinite = true, totalCap = 0;
  usable.forEach((f) => { const a = avail.get(f.fpKey); if (a === Infinity) allFinite = false; else totalCap += a * f.areaIn; });
  if (allFinite && A * B > totalCap) return null;

  const orient = [];
  usable.forEach((f) => { orient.push({ d: f.a, r: f.b, fpKey: f.fpKey }); if (f.a !== f.b) orient.push({ d: f.b, r: f.a, fpKey: f.fpKey }); });

  const rowTypes = [];
  [...new Set(orient.map((o) => o.d))].filter((d) => d > 0 && d <= B).sort((a, b) => b - a).forEach((d) => {
    const runs = orient.filter((o) => o.d === d && o.r > 0 && o.r <= A).sort((a, b) => b.r - a.r);
    if (runs.length) rowCompositions(A, runs).forEach((c) => rowTypes.push({ d, pieces: c.pieces, fp: c.fp }));
  });
  if (!rowTypes.length) return null;

  const reach = new Uint8Array(B + 1);
  reach[0] = 1;
  const depthsWithRows = [...new Set(rowTypes.map((rt) => rt.d))];
  for (let b = 1; b <= B; b++) reach[b] = depthsWithRows.some((d) => d <= b && reach[b - d]) ? 1 : 0;
  if (!reach[B]) return null;

  const maxArea = Math.max(...usable.map((f) => f.areaIn));
  const LB0 = Math.ceil((A * B) / maxArea);
  const fpOrder = usable.map((f) => f.fpKey);
  const used = new Map(fpOrder.map((k) => [k, 0]));
  const chosen = [];
  let best = null;
  const dead = new Set();

  const dfs = (remB, start, pieces) => {
    if (remB === 0) {
      const fpCount = new Map([...used].filter(([, n]) => n > 0));
      const distinct = fpCount.size;
      if (!best || pieces < best.pieces || (pieces === best.pieces && distinct < best.distinct)) best = { pieces, distinct, fpCount };
      return "found";
    }
    if (budget.left <= 0) return "cut";
    budget.left--;
    if (!reach[remB]) return "none";
    if (best && pieces + Math.ceil((A * remB) / maxArea) > best.pieces) return "cut";
    const key = remB + ":" + start + ":" + fpOrder.map((k) => used.get(k)).join(",");
    if (dead.has(key)) return "none";
    let status = "none";
    for (let i = start; i < rowTypes.length; i++) {
      const rt = rowTypes[i];
      if (rt.d > remB) continue;
      let ok = true;
      for (const [k, n] of rt.fp) { if ((used.get(k) || 0) + n > (avail.get(k) || 0)) { ok = false; break; } }
      if (!ok) continue;
      rt.fp.forEach((n, k) => used.set(k, (used.get(k) || 0) + n));
      chosen.push(i);
      const s = dfs(remB - rt.d, i, pieces + rt.pieces);
      rt.fp.forEach((n, k) => used.set(k, used.get(k) - n));
      chosen.pop();
      if (s === "found") status = "found";
      else if (s === "cut" && status === "none") status = "cut";
      if (best && best.pieces === LB0 && best.distinct === 1) break; // provably optimal
      if (budget.left <= 0) { status = status === "none" ? "cut" : status; break; }
    }
    if (status === "none") dead.add(key);
    return status;
  };
  dfs(B, 0, 0);
  if (!best) return null;
  // best.pieces/.distinct/.fpCount is all any current caller needs (the piece counts and totals);
  // a human-readable row-by-row layout isn't read by any consumer yet, so it's left null rather than
  // reconstructed from the (by now backtracked-away) `chosen` path.
  return { pieces: best.pieces, distinct: best.distinct, fpCount: best.fpCount, rows: null };
};

// One floor's exact (built at its own size) or oversize (built up to PLATFORM_OVERSIZE_MAX_FT bigger
// per side) tiling attempt, trying both the floor's own orientation and its 90°-rotated one.
const tileFloor = (floor, fps, avail, budget, mode) => {
  if (mode === "exact") {
    const attempts = [[floor.lIn, floor.wIn, "L"]];
    if (floor.lIn !== floor.wIn) attempts.push([floor.wIn, floor.lIn, "W"]);
    let best = null;
    attempts.forEach(([A, B, axis]) => {
      if (budget.left <= 0) return;
      const cap = Math.min(SOLVE_NODE_CAP, budget.left);
      const subBudget = { left: cap };
      const r = solveTiling(A, B, fps, avail, subBudget);
      budget.left -= (cap - subBudget.left);
      if (r && (!best || r.pieces < best.pieces || (r.pieces === best.pieces && r.distinct < best.distinct))) {
        best = { ...r, rowsAlong: axis, builtLIn: floor.lIn, builtWIn: floor.wIn, oversize: false };
      }
    });
    return best;
  }
  const sides = [...new Set(fps.flatMap((f) => [f.a, f.b]))].filter((s) => s > 0);
  if (!sides.length) return null;
  const maxL = floor.lIn + OVERSIZE_MAX_IN, maxW = floor.wIn + OVERSIZE_MAX_IN;
  const reachSubset = (maxVal) => {
    const r = new Uint8Array(maxVal + 1);
    r[0] = 1;
    for (let v = 1; v <= maxVal; v++) r[v] = sides.some((s) => s <= v && r[v - s]) ? 1 : 0;
    return r;
  };
  const reachL = reachSubset(maxL), reachW = reachSubset(maxW);
  const candL = []; for (let v = floor.lIn; v <= maxL; v++) if (reachL[v]) candL.push(v);
  const candW = []; for (let v = floor.wIn; v <= maxW; v++) if (reachW[v]) candW.push(v);
  const pairs = [];
  candL.forEach((x) => candW.forEach((y) => { if (!(x === floor.lIn && y === floor.wIn)) pairs.push([x, y]); }));
  pairs.sort((p1, p2) => {
    const e1 = p1[0] * p1[1] - floor.lIn * floor.wIn, e2 = p2[0] * p2[1] - floor.lIn * floor.wIn;
    if (e1 !== e2) return e1 - e2;
    return Math.max(p1[0] - floor.lIn, p1[1] - floor.wIn) - Math.max(p2[0] - floor.lIn, p2[1] - floor.wIn);
  });
  for (const [x, y] of pairs.slice(0, OVERSIZE_PAIR_CAP)) {
    if (budget.left <= 0) break;
    const r = tileFloor({ lIn: x, wIn: y }, fps, avail, budget, "exact");
    if (r) return { ...r, builtLIn: x, builtWIn: y, oversize: true };
  }
  return null;
};

const fpsOf = (rows) => {
  const seen = new Map();
  rows.forEach((r) => { if (!seen.has(r.fpKey)) seen.set(r.fpKey, { fpKey: r.fpKey, a: Math.min(r.lIn, r.wIn), b: Math.max(r.lIn, r.wIn), areaIn: r.areaIn }); });
  return [...seen.values()];
};
const availOf = (rows, stockLeft) => { const m = new Map(); rows.forEach((r) => m.set(r.fpKey, (m.get(r.fpKey) || 0) + (stockLeft.get(r._row) || 0))); return m; };
const infAvail = (rows) => { const m = new Map(); rows.forEach((r) => m.set(r.fpKey, Infinity)); return m; };
const stockSqftOf = (rows, stockLeft) => rows.reduce((s, r) => s + (stockLeft.get(r._row) || 0) * r.sqftPerPiece, 0);
const cmpArr = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// Allocates a solved fpCount (fpKey → piece count) onto concrete config rows — several rows can
// share a footprint (same dims, different material or a second batch at the same thickness; test
// "mixed materials, same thickness"), so this picks the rows whose thickness-GROUP still has the
// most stock left first (keeps a mixed-group result clustered on the dominant group rather than
// nibbling evenly at every group), then the row's own stock, then config order. `allowOver` lets a
// genuine shortfall land on the first candidate row, flagged overStock, instead of throwing.
const commit = (fpCount, poolRows, stockLeft, groupStockByTKey, allowOver) => {
  const rowQty = new Map(), rowOver = new Map();
  for (const [fpKey, n] of fpCount) {
    const cands = poolRows.filter((x) => x.fpKey === fpKey)
      .sort((a, b) => (groupStockByTKey.get(b.tKey) || 0) - (groupStockByTKey.get(a.tKey) || 0) || (stockLeft.get(b._row) || 0) - (stockLeft.get(a._row) || 0) || a._row - b._row);
    let left = n;
    for (const x of cands) {
      if (left <= 0) break;
      const avail = stockLeft.get(x._row) || 0;
      const take = Math.min(left, avail);
      if (take > 0) { stockLeft.set(x._row, avail - take); rowQty.set(x._row, (rowQty.get(x._row) || 0) + take); left -= take; }
    }
    if (left > 0) {
      if (!allowOver) throw new Error("platformPullPlan: insufficient stock without allowOver"); // caught by the caller, falls to the sqft-only tier
      const first = cands[0];
      rowQty.set(first._row, (rowQty.get(first._row) || 0) + left);
      rowOver.set(first._row, (rowOver.get(first._row) || 0) + left);
    }
  }
  return { rowQty, rowOver };
};

// Best-fit search (fix #2) over every size that still has real stock, for the fraction left after a
// floor's largest-first floored pass — replaces the old code's blind "always the smallest configured
// size" (which wasted sqft whenever a different, still-stocked size would have finished the job with
// less overage, or simply didn't exist as a smaller option at all).
const bestFitTopUp = (rem, rowsWithStock) => {
  // Stock as a tie-break (not just sqftPerPiece) when two rows share a footprint (same thickness
  // group, different material - e.g. Wood 8×4×4" and Iron 8×4×4") - otherwise a tie falls back to
  // raw config-array order, which can hand a fallback piece to a near-empty row while a still-
  // plentiful one of the identical size sits unused (owner report, 2026-11-25: BTR's sqft-fallback
  // piece landed on Iron with 80 left while Wood still had 110, splitting one floor across two
  // materials for no reason). Mirrors commit()'s own per-row stock tie-break above, so both of this
  // file's "which concrete row absorbs this piece" decisions agree.
  const sorted = [...rowsWithStock].sort((a, b) => b.sqftPerPiece - a.sqftPerPiece || (b.stock || 0) - (a.stock || 0));
  let best = null, nodes = 0;
  const dfs = (i, total, qty) => {
    if (++nodes > TOPUP_NODE_CAP) return;
    if (total >= rem - PIECE_EPS) {
      const waste = total - rem, pieces = [...qty.values()].reduce((s, k) => s + k, 0);
      if (!best || waste < best.waste - PIECE_EPS || (Math.abs(waste - best.waste) <= PIECE_EPS && pieces < best.pieces)) best = { waste, pieces, qty: new Map(qty) };
      return;
    }
    if (i >= sorted.length) return;
    const row = sorted[i];
    const maxK = Math.min(row.stock, Math.ceil((rem - total) / row.sqftPerPiece) + 1);
    for (let k = maxK; k >= 0; k--) { qty.set(row, k); dfs(i + 1, total + k * row.sqftPerPiece, qty); }
    qty.delete(row);
  };
  dfs(0, 0, new Map());
  if (!best) return null;
  const m = new Map();
  best.qty.forEach((k, row) => { if (k > 0) m.set(row._row, k); });
  return m.size ? m : null;
};

// Largest-first floored pass + best-fit top-up for the remainder, against ONE pool of rows (a single
// thickness group, or every row when thickness truly can't be kept uniform). `allowOver` lets the
// shortfall — if even the best-fit search can't finish it from real stock — land on the single
// least-wasteful row, flagged overStock, rather than reporting nothing.
const greedyTopUp = (need, rows, stockLeft, allowOver) => {
  // Same stock tie-break as bestFitTopUp/commit (see bestFitTopUp's own comment) - the largest-first
  // floored pass below must also prefer the row with more left when two tie on sqftPerPiece.
  const sorted = [...rows].sort((a, b) => b.sqftPerPiece - a.sqftPerPiece || (stockLeft.get(b._row) || 0) - (stockLeft.get(a._row) || 0));
  const used = new Map();
  let remaining = need;
  sorted.forEach((r) => {
    if (remaining <= PIECE_EPS) return;
    const avail = stockLeft.get(r._row) || 0;
    if (avail <= 0) return;
    const want = Math.floor(remaining / r.sqftPerPiece + PIECE_EPS);
    const use = Math.min(avail, want);
    if (use <= 0) return;
    stockLeft.set(r._row, avail - use);
    used.set(r._row, (used.get(r._row) || 0) + use);
    remaining = Math.max(0, remaining - use * r.sqftPerPiece);
  });
  if (remaining <= PIECE_EPS) return { covered: true, used, overStock: new Map() };
  const withStock = sorted.filter((r) => (stockLeft.get(r._row) || 0) > 0).map((r) => ({ ...r, stock: stockLeft.get(r._row) || 0 }));
  const combo = withStock.length ? bestFitTopUp(remaining, withStock) : null;
  if (combo) {
    combo.forEach((k, _row) => {
      const avail = stockLeft.get(_row) || 0;
      const use = Math.min(avail, k);
      stockLeft.set(_row, avail - use);
      used.set(_row, (used.get(_row) || 0) + use);
    });
    return { covered: true, used, overStock: new Map() };
  }
  if (!allowOver) return { covered: false, used, overStock: new Map() };
  let pick = null, pickScore = null;
  sorted.forEach((r) => {
    const extra = Math.ceil(remaining / r.sqftPerPiece - PIECE_EPS);
    const score = [extra * r.sqftPerPiece - remaining, extra, -(stockLeft.get(r._row) || 0), r._row];
    if (!pickScore || cmpArr(score, pickScore) < 0) { pickScore = score; pick = { r, extra }; }
  });
  if (!pick) return { covered: false, used, overStock: new Map() };
  const avail = stockLeft.get(pick.r._row) || 0;
  const fromStock = Math.min(avail, pick.extra);
  const over = pick.extra - fromStock;
  stockLeft.set(pick.r._row, avail - fromStock);
  used.set(pick.r._row, (used.get(pick.r._row) || 0) + pick.extra);
  const overStock = new Map();
  if (over > 0) overStock.set(pick.r._row, over);
  return { covered: true, used, overStock };
};

// The full engine: breaks every floor in `input` into physical pieces, pooling real stock across
// them in the order given (current behaviour, unchanged). `input` accepts a bare sqft number, an
// array of numbers, `{L, W, copies?}` floor objects (as platformFloorsFromParts produces), or a mix.
//
// Per floor, a priority ladder (fixes #1/#2/#3 working together, not as separate bolt-ons):
//   T1  one thickness group, tiled exactly               — always preferred when any group suffices
//   T2  one thickness group, tiled up to the oversize cap
//   T3  every row together (thickness mixed), tiled exactly   — only once no SINGLE group can
//   T4  every row together (thickness mixed), tiled up to the oversize cap
//   T5  one thickness group, tiled past its real stock (flagged overStock) — a physically valid
//       layout in ONE thickness beyond Config's stock beats a mixed layout that still doesn't cover
//       it, and beats an untileable sqft guess
//   T6  no geometry at all / everything above failed or ran out of search budget — sqft-only,
//       flagged tilingUnresolved, using the same thickness-aware best-fit logic as the no-dims path
// Never throws, never returns an empty answer for a real need — T6 is the backstop.
export const platformPullPlan = (input, trussInv) => {
  const { sizes, groups } = normSizes(trussInv);
  const floors = normFloors(input);
  if (!floors.length || !sizes.length) return { pieces: [], floors: [], flags: { mixedThickness: false, tilingUnresolved: false, oversize: false, overStock: false } };

  const stockLeft = new Map(sizes.map((r) => [r._row, r.stock]));
  const bySize = new Map();
  const entryFor = (r) => {
    if (!bySize.has(r._row)) bySize.set(r._row, { id: r.id, label: r.label, lengthFt: r.lengthFt, widthFt: r.widthFt, material: r.material, sqftPerPiece: r.sqftPerPiece, qty: 0, ...(r.thicknessIn != null ? { thicknessIn: r.thicknessIn } : {}) });
    return bySize.get(r._row);
  };
  // `fnIdx`: which function this particular floor's pieces were pulled for (when known) — accumulated
  // per piece size as `byFn[fnIdx]`, a plain piece count, so a caller that needs "how many of THIS
  // size came from THIS function" (e.g. Dept Ops' Inventory Blocked, scoping one function's own
  // share) doesn't have to re-derive it from the floors list itself.
  const applyRowQty = (rowQty, rowOver, fnIdx) => {
    rowQty.forEach((n, _row) => {
      const e = entryFor(sizes.find((s) => s._row === _row));
      e.qty += n;
      if (fnIdx != null) { e.byFn = e.byFn || {}; e.byFn[fnIdx] = (e.byFn[fnIdx] || 0) + n; }
    });
    rowOver.forEach((n, _row) => { const e = entryFor(sizes.find((s) => s._row === _row)); e.overStock = (e.overStock || 0) + n; });
  };
  const groupList = [...groups.entries()].map(([tKey, rows]) => ({ tKey, rows }));
  const groupStockMap = () => { const m = new Map(); groupList.forEach((g) => m.set(g.tKey, stockSqftOf(g.rows, stockLeft))); return m; };
  const thicknessesOf = (rowIds) => [...new Set(rowIds.map((_row) => sizes.find((s) => s._row === _row)?.tKey))].map((k) => (k === "?" ? null : Number(k))).sort((a, b) => (b ?? -1) - (a ?? -1));
  const globalBudget = { left: CALL_NODE_CAP };
  const flags = { mixedThickness: false, tilingUnresolved: false, oversize: false, overStock: false };
  const floorsOut = [];
  let lastShapeKey = null, lastResult = null; // copy-run fast path: identical floor shapes reuse the last layout

  const sqftRecord = (floor, fit, unresolved) => {
    const need = floor.sqft;
    const candidates = [];
    groupList.forEach((g) => {
      const dry = new Map(stockLeft);
      const res = greedyTopUp(need, g.rows, dry, false);
      if (!res.covered) return;
      const totalSqft = [...res.used].reduce((s, [row, k]) => s + k * sizes.find((x) => x._row === row).sqftPerPiece, 0);
      const pieces = [...res.used.values()].reduce((s, k) => s + k, 0);
      candidates.push({ dry, res, score: [totalSqft - need, pieces, -stockSqftOf(g.rows, stockLeft), g.rows[0]._row] });
    });
    let chosen;
    if (candidates.length) {
      candidates.sort((a, b) => cmpArr(a.score, b.score));
      chosen = candidates[0];
    } else {
      const dry = new Map(stockLeft);
      const res = greedyTopUp(need, sizes, dry, false);
      if (res.covered) chosen = { dry, res };
      else {
        const best = [...groupList].sort((a, b) => stockSqftOf(b.rows, stockLeft) - stockSqftOf(a.rows, stockLeft))[0] || groupList[0];
        const dry2 = new Map(stockLeft);
        chosen = { dry: dry2, res: greedyTopUp(need, best.rows, dry2, true) };
      }
    }
    chosen.dry.forEach((v, k) => stockLeft.set(k, v));
    applyRowQty(chosen.res.used, chosen.res.overStock, floor.fnIdx);
    const tUsed = thicknessesOf([...chosen.res.used.keys()]);
    const mixed = tUsed.length > 1;
    if (mixed) flags.mixedThickness = true;
    if (unresolved) flags.tilingUnresolved = true;
    if (chosen.res.overStock.size) flags.overStock = true;
    return {
      label: floor.label, L: floor.L ?? null, W: floor.W ?? null, copy: floor.copy ?? 1, copies: floor.copies ?? 1, sqft: floor.sqft,
      fit, builtL: null, builtW: null, rowsAlong: null, layout: null,
      mixedThickness: mixed, thicknessIn: tUsed, tilingUnresolved: !!unresolved,
      overStock: [...chosen.res.overStock.values()].reduce((s, v) => s + v, 0),
    };
  };

  const floorRecordFromCommit = (fit, r, poolRows, overAllowed, fnIdx) => {
    // Dry copy, merged back only on success — the solver guarantees T1-T4's fpCount never exceeds
    // availOf for these same rows, and T5 always passes overAllowed:true, so commit should never
    // actually throw here; this just means a THROW (an absurd/huge dimension, a future bug) can never
    // leave `stockLeft` partway decremented for an answer the caller is about to discard anyway.
    const dry = new Map(stockLeft);
    const { rowQty, rowOver } = commit(r.fpCount, poolRows, dry, groupStockMap(), overAllowed);
    dry.forEach((v, k) => stockLeft.set(k, v));
    applyRowQty(rowQty, rowOver, fnIdx);
    const tUsed = thicknessesOf([...rowQty.keys()]);
    const mixed = tUsed.length > 1;
    if (mixed) flags.mixedThickness = true;
    if (r.oversize) flags.oversize = true;
    if (rowOver.size) flags.overStock = true;
    return {
      label: undefined, fit, rowQty, rowOver, mixed, tUsed, built: [r.builtLIn, r.builtWIn], rowsAlong: r.rowsAlong,
    };
  };

  floors.forEach((floor) => {
    const shapeKey = floor.hasDims ? `${floor.lIn}x${floor.wIn}` : `sqft:${floor.sqft}`;
    let record;
    try {
      record = planFloor(floor, shapeKey);
    } catch {
      record = sqftRecord(floor, "unresolved", true);
    }
    floorsOut.push(record);
  });

  function planFloor(floor, shapeKey) {
    if (!floor.hasDims) return sqftRecord(floor, "sqft", false);
    if (globalBudget.left <= 0) return sqftRecord(floor, "unresolved", true);

    const finish = (fit, r, poolRows, overAllowed) => {
      const c = floorRecordFromCommit(fit, r, poolRows, overAllowed, floor.fnIdx);
      const rec = {
        label: floor.label, L: floor.L, W: floor.W, copy: floor.copy, copies: floor.copies, sqft: floor.sqft,
        fit, builtL: Math.round((c.built[0] / 12) * 100) / 100, builtW: Math.round((c.built[1] / 12) * 100) / 100,
        rowsAlong: c.rowsAlong, layout: r.rows || null,
        mixedThickness: c.mixed, thicknessIn: c.tUsed, tilingUnresolved: false,
        overStock: [...c.rowOver.values()].reduce((s, v) => s + v, 0),
      };
      lastShapeKey = shapeKey; lastResult = { poolRows, fpCount: r.fpCount, fit, rowsAlong: rec.rowsAlong, layout: rec.layout, builtL: rec.builtL, builtW: rec.builtW };
      return rec;
    };

    // Copy fast path: an earlier copy of this exact L×W already found a layout — try it again before
    // re-solving from scratch (meaningful when a floor has many identical copies). builtL/builtW come
    // from the REUSED layout (lastResult), not this floor's own requested L/W - an oversize layout's
    // built size differs from the request, and two different zones can share a floor size by
    // coincidence (not actual copies of one floor), so the size actually built must travel with the
    // layout being reused, never assumed to equal whatever floor happens to be asking for it now.
    if (lastShapeKey === shapeKey && lastResult) {
      try {
        const dry = new Map(stockLeft);
        const { rowQty, rowOver } = commit(lastResult.fpCount, lastResult.poolRows, dry, groupStockMap(), false);
        dry.forEach((v, k) => stockLeft.set(k, v));
        applyRowQty(rowQty, rowOver, floor.fnIdx);
        const tUsed = thicknessesOf([...rowQty.keys()]);
        if (tUsed.length > 1) flags.mixedThickness = true;
        return {
          label: floor.label, L: floor.L, W: floor.W, copy: floor.copy, copies: floor.copies, sqft: floor.sqft,
          fit: lastResult.fit, builtL: lastResult.builtL, builtW: lastResult.builtW, rowsAlong: lastResult.rowsAlong, layout: lastResult.layout,
          mixedThickness: tUsed.length > 1, thicknessIn: tUsed, tilingUnresolved: false, overStock: 0,
        };
      } catch { /* stock no longer sufficient for the identical layout — fall through to a full re-solve */ }
    }

    // T1/T2 — single thickness group, exact then oversize
    for (const mode of ["exact", "oversize"]) {
      let best = null, bestG = null;
      groupList.forEach((g) => {
        const r = tileFloor(floor, fpsOf(g.rows), availOf(g.rows, stockLeft), globalBudget, mode);
        if (!r) return;
        const score = mode === "oversize" ? [r.builtLIn * r.builtWIn - floor.lIn * floor.wIn, r.pieces, r.distinct] : [r.pieces, r.distinct, 0];
        if (!best || cmpArr(score, best._score) < 0) { best = { ...r, _score: score }; bestG = g; }
      });
      if (best) return finish(mode, best, bestG.rows, false);
    }
    // T3/T4 — every row together (thickness mixed), exact then oversize
    for (const mode of ["exact", "oversize"]) {
      const r = tileFloor(floor, fpsOf(sizes), availOf(sizes, stockLeft), globalBudget, mode);
      if (r) return finish(mode, r, sizes, false);
    }
    // T5 — one thickness group, beyond its real stock (least overstock, then fewest pieces, then most stock left)
    {
      let best = null, bestG = null, bestMode = "exact";
      groupList.forEach((g) => {
        const infA = infAvail(g.rows);
        let rr = tileFloor(floor, fpsOf(g.rows), infA, globalBudget, "exact");
        let mode = "exact";
        if (!rr) { rr = tileFloor(floor, fpsOf(g.rows), infA, globalBudget, "oversize"); mode = "oversize"; }
        if (!rr) return;
        const avail = availOf(g.rows, stockLeft);
        let over = 0;
        rr.fpCount.forEach((n, fpKey) => { over += Math.max(0, n - (avail.get(fpKey) || 0)); });
        const score = [over, rr.pieces, -stockSqftOf(g.rows, stockLeft), g.rows[0]._row];
        if (!best || cmpArr(score, best._score) < 0) { best = { ...rr, _score: score }; bestG = g; bestMode = mode; }
      });
      if (best) return finish(bestMode, best, bestG.rows, true);
    }
    // T6 — truly unresolved (no geometry works at all, or search budget ran out): sqft-only, flagged
    return sqftRecord(floor, "unresolved", true);
  }

  return { pieces: sizes.filter((r) => bySize.has(r._row)).map((r) => bySize.get(r._row)), floors: floorsOut, flags };
};

// Back-compat wrapper — the pre-2026-11-25 shape every existing call used (just the aggregated
// pieces list, from a bare sqft number or an array of them). New callers that have real floor
// dimensions should use platformPullPlan directly for the tiling/warning detail.
export const platformPiecesFor = (input, trussInv) => platformPullPlan(input, trussInv).pieces;

// One plan per function (owner call, 2026-11-25: each function is its own build, so the pull list
// reads "for Haldi, pull these; for Sangeet, pull these" rather than one pooled list across the
// whole deal) — groups `parts` by fnIdx (falling back to the `fn` label when fnIdx is absent).
export const platformPullPlansByFn = (parts, trussInv) => {
  const byFn = new Map();
  (Array.isArray(parts) ? parts : []).forEach((pt) => {
    const key = pt?.fnIdx != null ? String(pt.fnIdx) : (pt?.fn || "");
    if (!byFn.has(key)) byFn.set(key, { fnIdx: pt?.fnIdx, fnLabel: pt?.fn || "", parts: [] });
    byFn.get(key).parts.push(pt);
  });
  return [...byFn.values()].map((g) => ({ fnIdx: g.fnIdx, fnLabel: g.fnLabel, plan: platformPullPlan(platformFloorsFromParts(g.parts), trussInv) }));
};

// ─── Layer 4.2-equivalent — one event's platform sqft demand, combined pool ──────────────────
// Mirrors trussEngine.js's buildEventAllocation, but the "allocator" here is just arithmetic
// (sqft = L × W × qty) instead of a pillar/beam topology resolve — there's no structural layout to
// compute. A zone only counts if a Height band is actually picked (zc.plH): the same floorDims
// also drives Carpet, and a zone can have Carpet with no Platform at all.
//
// Counts the zone's own row AND every extraPlatformRows entry ("+ Add Platform" in Build) — each
// with its own plH/floorDims/plQty. Confirmed gap this closes (found 2026-11-05): this used to only
// read the zone's single scalar row, while billing (pricing.js's buildPlatformPlan,
// DealCheckOverlay.jsx's Tenting rollup) already counted extra rows — so a zone with more than one
// platform footprint was under-counted here, silently understating real demand.
//
// totalPlatformSqftByMaterial keeps its name/object shape for back-compat with saved
// platform_allocations/platform_overrides/platform_simulations rows, but only ever has ONE key now
// (PLATFORM_POOL_KEY) — see this file's header comment for why there's no real per-material demand
// signal. An OLD saved row with separate iron/pole/aluminium keys still sums correctly everywhere
// via platformEventSqft below, with no data migration needed.
export const buildEventPlatformAllocation = (eventMeta, fnList) => {
  let totalSqft = 0;
  (fnList || []).forEach((fn) => {
    const zones = fn?.zones || {};
    const enabledEls = fn?.enabledEls || {};
    Object.entries(zones).forEach(([zoneKey, zc]) => {
      if (!zc) return;
      if (enabledEls && Object.keys(enabledEls).length > 0 && !enabledEls[zoneKey]) return;
      const rows = [zc, ...(Array.isArray(zc.extraPlatformRows) ? zc.extraPlatformRows : [])];
      rows.forEach((row) => {
        if (!row?.plH || isPlatformFoc(row)) return; // no platform picked on this row / FOC: already laid at the venue
        const L = parseFloat(row.floorDims?.L) || 0;
        const W = parseFloat(row.floorDims?.W) || 0;
        const qty = Math.max(1, parseInt(row.plQty, 10) || 1);
        const sqft = L * W * qty;
        if (sqft > 0) totalSqft += sqft;
      });
    });
  });
  const bySqft = totalSqft > 0 ? { [PLATFORM_POOL_KEY]: Math.round(totalSqft * 100) / 100 } : {};
  return {
    eoId: eventMeta.eoId,
    clientId: eventMeta.clientId,
    clientName: eventMeta.clientName,
    fnIdx: eventMeta.fnIdx ?? 0,
    state: eventMeta.state || "soft",
    expiry: eventMeta.expiry || null,
    heldBy: eventMeta.heldBy || "—",
    createdAt: eventMeta.createdAt || Date.now(),
    totalPlatformSqftByMaterial: bySqft,
  };
};

// Sums every key of a (possibly OLD-shaped, pre-2026-11-05) totalPlatformSqftByMaterial object into
// one combined-pool number — an old saved {iron, pole, aluminium} split folds into the pool exactly
// the same as a new {all} one, with no data migration needed anywhere this is used.
export const platformEventSqft = (ev) => Object.values(ev?.totalPlatformSqftByMaterial || {}).reduce((s, v) => s + (Number(v) || 0), 0);

// ─── Layer 4.3-equivalent — pool feasibility for one date ───────────────────────────────────
// Same soft/hard priority rule as trussEngine.js's computePoolFeasibility: hard (SOLD) events get
// stock first; soft (draft) events fill in createdAt order; whoever can't fit bears the shortage.
// Demand/stock/overflow stay keyed objects, with exactly one key (PLATFORM_POOL_KEY) — every event
// collapses through platformEventSqft first, so an OLD saved event's {iron, pole, aluminium} split
// sums into the SAME one pool rather than being checked as separate, independent stock buckets
// (which would have let two legacy-keyed events each pass a "fits" check against the full stock
// total instead of sharing it — a real overflow hidden by this file's OWN per-material isolation).
export const computePlatformPoolFeasibility = (eventsForDate, trussInv) => {
  const K = PLATFORM_POOL_KEY;
  const demand = {}, soft = {}, hard = {};
  (eventsForDate || []).forEach(ev => {
    const sqft = platformEventSqft(ev);
    if (sqft <= 0) return;
    demand[K] = (demand[K] || 0) + sqft;
    if (ev.state === "soft") soft[K] = (soft[K] || 0) + sqft;
    else hard[K] = (hard[K] || 0) + sqft;
  });

  const stock = { [K]: Math.round(platformTotalStockSqft(trussInv) * 100) / 100 };

  let feasible = true;
  const overflow = {};
  const EPS = 1e-6;
  Object.entries(demand).forEach(([mat, sqft]) => {
    const st = stock[mat] || 0;
    if (sqft > st + EPS) { feasible = false; overflow[mat] = Math.round((sqft - st) * 100) / 100; }
  });

  // Sort events by createdAt ascending (tie-break eoId); last-added bears shortage, same as truss.
  const sorted = [...(eventsForDate || [])].sort((a, b) => {
    const ca = a.createdAt || 0, cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return (a.eoId || "").localeCompare(b.eoId || "");
  });
  sorted.forEach(ev => { ev.shortageBorne = false; });

  if (!feasible) {
    const remaining = { ...stock };
    sorted.filter(ev => ev.state === "hard").forEach(ev => { remaining[K] = (remaining[K] || 0) - platformEventSqft(ev); });
    sorted.filter(ev => ev.state === "soft").forEach(ev => {
      const sqft = platformEventSqft(ev);
      if ((remaining[K] || 0) >= sqft - EPS) {
        remaining[K] = (remaining[K] || 0) - sqft;
      } else {
        ev.shortageBorne = true;
      }
    });
    // borne by the newest hard event that actually has platform here (not simply the newest hard event) - same rule as batta / truss
    if ((remaining[K] || 0) < -EPS) {
      const hardSorted = sorted.filter(ev => ev.state === "hard" && platformEventSqft(ev) > 0);
      if (hardSorted.length > 0) hardSorted[hardSorted.length - 1].shortageBorne = true;
    }
  }

  return { feasible, demand, soft, hard, stock, overflow };
};

// ─── Layer 4.4-equivalent — allocateForDate: full multi-event pool allocator ────────────────
export const allocatePlatformForDate = (existingAlloc, date, eventsList, trussInv, trigger) => {
  const out = (existingAlloc && typeof existingAlloc === "object") ? { ...existingAlloc } : {};
  if (!date || !Array.isArray(eventsList) || eventsList.length === 0) {
    delete out[date];
    return out;
  }
  if (!trussInv) {
    // eslint-disable-next-line no-console
    console.warn(`[platform-alloc] allocatePlatformForDate(${date}) skipped: trussInv not loaded`);
    return out;
  }
  const summary = computePlatformPoolFeasibility(eventsList, trussInv);
  out[date] = {
    lastCascadeAt: Date.now(),
    lastCascadeBy: trigger || "system",
    events: eventsList,
    stockSummary: {
      demand: summary.demand,
      soft: summary.soft,
      hard: summary.hard,
      stock: summary.stock,
      overflow: summary.overflow,
      feasible: summary.feasible,
    },
  };
  return out;
};

// ─── Overrides — department-head manual correction of one event's platform sqft ─────────────
// Mirrors trussEngine.js's applyOverridesToEvents, but there's no "config" to override — just the
// computed sqft itself (e.g. ops improvised an extra platform on site beyond what Build recorded).
export const applyPlatformOverridesToEvents = (eventsForDate, overrides) => {
  if (!Array.isArray(eventsForDate) || !overrides || typeof overrides !== "object") return eventsForDate;
  return eventsForDate.map(ev => {
    const ovr = overrides[ev.eoId];
    if (!ovr) return ev;
    return {
      ...ev,
      totalPlatformSqftByMaterial: ovr.totalPlatformSqftByMaterial || ev.totalPlatformSqftByMaterial,
      hasOverride: true,
      override: { reason: ovr.reason || "", overrideBy: ovr.overrideBy || "", overrideAt: ovr.overrideAt || null },
    };
  });
};

// ─── Simulator — what-if impact of a hypothetical sqft demand on a date ──────────────────────
// Mirrors trussEngine.js's simulateImpact, but the input is directly {sqft} per row — there's no
// L/W/H/config to resolve into pieces first, since platform demand already IS a plain sqft number
// (see buildEventPlatformAllocation above). A row's `material` (if a stale caller still sends one)
// is ignored — there's one combined pool now, see this file's header comment. No cost estimate:
// platform billing is the zone's own Height-band rate x sqft in Studio Build, not a flat RFT x rate
// like truss, so there's no single rate to estimate cost from here — this stays booking-only, same
// as the rest of the file.
export const simulatePlatformImpact = (sim, dateAlloc, otherDrafts, trussInv) => {
  if (!sim || !trussInv) return null;
  const K = PLATFORM_POOL_KEY;

  const demandSqft = Math.round((sim.zones || []).reduce((s, z) => s + (Number(z.sqft) || 0), 0) * 100) / 100;
  if (demandSqft <= 0) {
    return { status: "gray", reason: "No platform sqft entered", demand: {}, overflow: {}, pressure: 0 };
  }
  const demand = { [K]: demandSqft };

  const realEvents = Array.isArray(dateAlloc?.events) ? dateAlloc.events : [];
  let used = realEvents.reduce((s, ev) => s + platformEventSqft(ev), 0);
  if (sim.mode === "compound" && Array.isArray(otherDrafts)) {
    otherDrafts.forEach(draft => {
      used += Object.values(draft.computed?.demand || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    });
  }

  const totalStock = platformTotalStockSqft(trussInv);
  const remaining = totalStock - used;
  const pressure = totalStock > 0 ? (used + demandSqft) / totalStock : 1;
  let shortageSqft = 0;
  const overflow = {};
  if (demandSqft > remaining) {
    shortageSqft = Math.round((demandSqft - remaining) * 100) / 100;
    overflow[K] = shortageSqft;
  }
  const maxPressure = pressure;

  let status, reason;
  if (shortageSqft > 0) { status = "red"; reason = `Shortage of ${shortageSqft} sqft — rental needed`; }
  else if (maxPressure > 0.85) { status = "yellow"; reason = `High stock pressure (${Math.round(maxPressure * 100)}% utilization)`; }
  else { status = "green"; reason = `Available · ${Math.round(maxPressure * 100)}% utilization`; }

  return { status, reason, demand, overflow, pressure: Math.round(maxPressure * 100) };
};

export { isDeptHead, expireStaleSimulations };

// ─── Audit — one INSERT into the platform_audit TABLE (off the blob), mirrors appendTrussAudit ──
export const appendPlatformAudit = async (entry) => {
  try {
    await supabase.from("platform_audit").insert({ data: { ts: Date.now(), ...entry } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[platform-alloc] audit append failed:", e?.message || e);
  }
};

export { eoToFnList };

// ─── Backfill flag storage key — mirrors trussEngine.js's TRUSS_P3_BACKFILLED_SK ─────────────
export const PLATFORM_BACKFILLED_SK = "ambria-ims-platform-alloc-backfilled-v1";

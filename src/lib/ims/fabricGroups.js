// The Fabric department's blocked-inventory lines are one row per (zone x fabric x Old/New tier) —
// "Liza Fabric (Old) · stage", "Velvet Curtains (Old) · entry", … — with no photo, because they are
// calculated lines and not IMS inventory items. A planner reads them as three fabrics used across zones,
// so this folds them into exactly that: ONE group per fabric (Liza / Velvet / Wall Masking) with its total,
// the colour(s) allocated for it (with the colour's own stock photo), and a zone-by-zone breakdown that says
// how the fabric is applied there and shows the zone's photo.
//
// Pure: the component feeds it what it already has. `entries` come from the event's own zone layout (the same
// calcZoneFabric Deal Check uses), so the figures are the current plan; the dept `lines` only supply money
// and are the fallback for an event whose layout has not synced.

import { trussBaseArea } from "../studio/taxonomy.js";

export const FABRIC_KINDS = [
  { key: "liza", label: "Liza Fabric", lineName: "Liza Fabric", unit: "kg", stockKey: "lizaStock", allocField: "lizaAllocation", emoji: "🧣", qtyOf: (f) => f.lizaKg },
  { key: "curtain", label: "Velvet Curtains", lineName: "Velvet Curtains", unit: "pcs", stockKey: "curtainStock", allocField: "curtainAllocation", emoji: "🎀", qtyOf: (f) => f.curtainPieces },
  { key: "masking", label: "Wall Masking", lineName: "Wall Masking", unit: "pcs", stockKey: "maskingStock", allocField: "maskingAllocation", emoji: "🧱", qtyOf: (f) => f.maskingPieces },
];

const LINE_RE = /^(Liza Fabric|Velvet Curtains|Wall Masking) \((Old|New)\)$/;
export const isFabricLine = (line) => LINE_RE.test(String(line?.name || "").trim());

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pretty = (zk) => String(zk || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// "kg · entry" -> "entry"
const zoneOfLine = (line) => String(line?.sub || "").split("·").slice(1).join("·").trim();

const num = (v) => Number(v) || 0;
const colourKey = (c) => String(c || "").trim().replace(/\s+/g, " ").toLowerCase();

// "16 × 12 ft U truss" / "16 × 16 × 12 ft box truss" - the truss row's own dimensions, the way Build charges them (see trussBaseArea).
export function trussDimsText(row) {
  if (!row) return "";
  const d = row.dims || {};
  const base = trussBaseArea(row);
  if (!(base.area > 0)) return "";
  const ft = (n) => String(Math.round(n * 100) / 100);
  const text = base.mode === "box"
    ? `${ft(num(d.L))} × ${ft(num(d.W || d.S))} × ${ft(num(d.H))} ft box truss`
    : `${ft(base.a)} × ${ft(base.b)} ft U truss`;
  const mat = String(row.trussMaterial || "").trim();
  return mat ? `${text} · ${mat.charAt(0).toUpperCase()}${mat.slice(1)}` : text;
}

// The colour(s) one truss row's fabric of this kind went to: what Deal Check recorded for that row when the event was synced (fabricPlan.rows), else the
// row's own saved allocation. [] when neither exists (an event synced before this was recorded).
function rowColours(kind, entry, fabricPlan) {
  // what Deal Check worked out for this row when the event was synced (it weighs the saved colour against the Fabric Palette), else the row's own saved colour
  const rec = Array.isArray(fabricPlan?.rows) ? fabricPlan.rows : [];
  const recorded = rec.filter((r) => r.kind === kind.key && r.fi === entry.fi && r.zk === entry.zk && (r.ri || 0) === (entry.ri || 0)).map((r) => ({ colour: r.colour, qty: num(r.qty) }));
  if (recorded.length) return recorded;
  const own = Array.isArray(entry.row?.[kind.allocField]) ? entry.row[kind.allocField].filter((a) => a && (Number(a.qty) || 0) > 0) : [];
  return own.map((a) => ({ colour: a.colour || "(unassigned)", qty: num(a.qty) }));
}

function applicationText(kind, fab, row) {
  if (!fab) return "";
  if (kind.key === "liza") {
    const wrap = Number(fab.lizaWrapKg) || 0, ceil = Number(fab.lizaCeilingKg) || 0;
    if (wrap > 0 && ceil > 0) return `Wrap ${r2(wrap)} kg + ceiling ${r2(ceil)} kg${fab.density ? ` (${fab.density})` : ""}`;
    if (wrap > 0) return `Wrap ${r2(wrap)} kg around the truss (no ceiling)`;
    if (ceil > 0) return `Ceiling ${r2(ceil)} kg`;
    return "";
  }
  if (kind.key === "curtain") {
    const pillars = Number(fab.curtainPillarCount) || 0, pieces = Number(fab.curtainPieces) || 0;
    if (pillars > 0 && pieces > 0) return `${pillars} pillar${pillars === 1 ? "" : "s"} × ${Math.round(pieces / pillars)} curtains`;
    return "";
  }
  const walls = Object.entries(row?.mkWalls || {}).filter(([, v]) => v).map(([k]) => k);
  const side = walls.length ? `${walls.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" + ")} wall${walls.length === 1 ? "" : "s"}` : "";
  return `${side ? side + " · " : ""}13 ft panels`;
}

// onlyFi: show one function's zones only. Money is split over ALL functions first (the priced lines name a zone, not
// a function — a "stage" line is the sum of every function's stage), then the other functions' zones are dropped.
export function buildFabricGroups({ entries = [], lines = [], fabricPlan = null, stock = {}, multiFn = false, onlyFi = null } = {}) {
  const fabricLines = (lines || []).filter(isFabricLine);
  const groupedLineIds = new Set();
  const groups = [];
  FABRIC_KINDS.forEach((kind) => {
    const kindLines = fabricLines.filter((l) => String(l.name).trim().startsWith(kind.lineName));
    // money per zone, from the lines Deal Check priced
    const moneyByZone = new Map();
    kindLines.forEach((l) => { const z = zoneOfLine(l); moneyByZone.set(z, (moneyByZone.get(z) || 0) + (Number(l.total) || 0)); });
    // zones from the event's own layout: one per (function, zone), extra trusses in a zone added together
    const byZone = new Map();
    entries.forEach((e) => {
      const q = Number(kind.qtyOf(e.fab || {})) || 0;
      if (!(q > 0)) return;
      const k = `${e.fi}|${e.zk}`;
      const z = byZone.get(k) || { fi: e.fi, zoneKey: e.zk, name: e.zLabel, fnLabel: e.fnLabel || "", photo: e.photo || "", qty: 0, notes: [], tier: new Set(), dims: [], colours: new Map() };
      z.qty += q;
      const dt = trussDimsText(e.row);
      if (dt && !z.dims.includes(dt)) z.dims.push(dt);
      rowColours(kind, e, fabricPlan).forEach((c) => { const ck = colourKey(c.colour); const cur = z.colours.get(ck) || { colour: c.colour, qty: 0 }; cur.qty += c.qty; z.colours.set(ck, cur); });
      const note = applicationText(kind, e.fab, e.row);
      if (note) z.notes.push(note);
      z.tier.add(e.row?.useNewFabric ? "New" : "Old");
      byZone.set(k, z);
    });
    // A priced line is per ZONE NAME, so a zone that exists in two functions ("stage" in Wedding and Mehendi) shares
    // one line. Each function's zone takes its share of that money by quantity — never the whole line twice.
    const qtyByZoneKey = new Map();
    byZone.forEach((z) => qtyByZoneKey.set(z.zoneKey, (qtyByZoneKey.get(z.zoneKey) || 0) + z.qty));
    let zones = [...byZone.values()].map((z) => {
      const share = qtyByZoneKey.get(z.zoneKey) > 0 ? z.qty / qtyByZoneKey.get(z.zoneKey) : 0;
      const exact = (moneyByZone.get(z.zoneKey) || 0) * share;
      return {
        fi: z.fi, zoneKey: z.zoneKey, name: z.name, fnLabel: multiFn ? z.fnLabel : "", photo: z.photo,
        qty: r2(z.qty), application: z.notes.join(" · "), tier: [...z.tier].join(" + "),
        dims: z.dims.join(" + "), colours: [...z.colours.values()].map((c) => ({ colour: c.colour, qty: r2(c.qty) })).sort((a, b) => b.qty - a.qty),
        amount: Math.round(exact), exactAmount: exact,
      };
    });
    // Layout not synced yet: fall back to the priced lines themselves, so the fabric still shows.
    if (!zones.length) {
      zones = kindLines.map((l) => ({
        fi: null, zoneKey: zoneOfLine(l), name: pretty(zoneOfLine(l)) || "Zone", fnLabel: "", photo: "", dims: "", colours: [],
        qty: r2(l.qty), application: "", tier: (String(l.name).match(LINE_RE) || [])[2] || "", amount: Math.round(Number(l.total) || 0),
      }));
    }
    if (!zones.length) return;
    // every line of this fabric is folded away, whichever function is being looked at
    kindLines.forEach((l) => groupedLineIds.add(l.id));
    const allFnAmount = Math.round(kindLines.length ? kindLines.reduce((s, l) => s + (Number(l.total) || 0), 0) : zones.reduce((s, z) => s + (z.exactAmount ?? z.amount), 0));
    if (onlyFi !== null && onlyFi !== undefined) {
      zones = zones.filter((z) => z.fi === onlyFi);
      if (!zones.length) return;
    }
    const qty = r2(zones.reduce((s, z) => s + z.qty, 0));
    const amount = (onlyFi === null || onlyFi === undefined) ? allFnAmount : Math.round(zones.reduce((s, z) => s + (z.exactAmount ?? z.amount), 0));
    const stockRows = Array.isArray(stock?.[kind.stockKey]) ? stock[kind.stockKey] : [];
    const stockOf = (name) => stockRows.find((r) => r && colourKey(r.colour) === colourKey(name)) || {};
    const colours = (Array.isArray(fabricPlan?.[kind.key]) ? fabricPlan[kind.key] : [])
      .map((c) => {
        const s = stockOf(c.colour);
        return { colour: c.colour || "(unassigned)", qty: r2(c.qty), qtyOld: r2(c.qtyOld), qtyNew: r2(c.qtyNew), photo: s.photo || "", hex: s.hex || "" };
      })
      .sort((a, b) => b.qty - a.qty);
    // each zone's colours with the colour's own stock photo; an event without per-zone colours yet shows its one colour when the fabric has just one
    zones = zones.map((z) => {
      const list = (z.colours && z.colours.length) ? z.colours : (colours.length === 1 && z.fi != null ? [{ colour: colours[0].colour, qty: z.qty }] : []);
      return { ...z, colours: list.map((c) => { const s = stockOf(c.colour); return { ...c, photo: s.photo || "", hex: s.hex || "" }; }) };
    });
    zones.sort((a, b) => b.qty - a.qty);
    zones = zones.map(({ exactAmount, ...z }) => z);
    groups.push({
      key: kind.key, label: kind.label, unit: kind.unit, emoji: kind.emoji, qty, amount, zones, colours,
      photo: colours[0]?.photo || "", hex: colours[0]?.hex || "",
      colourText: colours.length ? colours.map((c) => `${c.colour} ${c.qty} ${kind.unit}`).join(" · ") : "No colour picked yet",
    });
  });
  return { groups, groupedLineIds };
}

// The flat load list (Truck planning, loading checklist, receiving) carries the same per-zone fabric lines ("Liza Fabric (Old) · stage", "· entry" ...)
// with no photo, and trucks key them by name, so the zones of one fabric share one load. Fold them into what is physically loaded: one line per fabric
// colour ("Liza Fabric - Powder Blue", 112 kg, with the colour's photo), or one line for the fabric when no colour is picked yet.
// `flat` is the list, `groups` come from buildFabricGroups (whole event). Lines that are not fabric lines keep their place; the folded lines go where the
// first fabric line was.
export function foldFabricLines(flat, groups) {
  const list = Array.isArray(flat) ? flat : [];
  if (!list.some((l) => isFabricLine(l)) || !Array.isArray(groups) || !groups.length) return list;
  const folded = [];
  groups.forEach((g) => {
    const colours = (g.colours || []).filter((c) => c.qty > 0);
    const sum = colours.reduce((s, c) => s + c.qty, 0);
    if (colours.length) {
      colours.forEach((c) => folded.push({ id: `fabric:${g.key}:${c.colour}`, invId: null, name: `${g.label} - ${c.colour}`, photo: c.photo || "", hex: c.hex || "", qty: c.qty, qtyUnit: g.unit, unit: 0,
        total: sum > 0 ? Math.round((g.amount * c.qty) / sum) : 0, sub: `${g.unit} · fabric`, prodOrBuy: null, byFn: null }));
    } else folded.push({ id: `fabric:${g.key}`, invId: null, name: g.label, photo: "", hex: "", qty: g.qty, qtyUnit: g.unit, unit: 0, total: g.amount, sub: `${g.unit} · fabric`, prodOrBuy: null, byFn: null });
  });
  const out = [];
  let placed = false;
  list.forEach((l) => {
    if (!isFabricLine(l)) { out.push(l); return; }
    if (!placed) { out.push(...folded); placed = true; }
  });
  return out;
}

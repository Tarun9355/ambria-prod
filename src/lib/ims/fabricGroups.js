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

export const FABRIC_KINDS = [
  { key: "liza", label: "Liza Fabric", lineName: "Liza Fabric", unit: "kg", stockKey: "lizaStock", emoji: "🧣", qtyOf: (f) => f.lizaKg },
  { key: "curtain", label: "Velvet Curtains", lineName: "Velvet Curtains", unit: "pcs", stockKey: "curtainStock", emoji: "🎀", qtyOf: (f) => f.curtainPieces },
  { key: "masking", label: "Wall Masking", lineName: "Wall Masking", unit: "pcs", stockKey: "maskingStock", emoji: "🧱", qtyOf: (f) => f.maskingPieces },
];

const LINE_RE = /^(Liza Fabric|Velvet Curtains|Wall Masking) \((Old|New)\)$/;
export const isFabricLine = (line) => LINE_RE.test(String(line?.name || "").trim());

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pretty = (zk) => String(zk || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// "kg · entry" -> "entry"
const zoneOfLine = (line) => String(line?.sub || "").split("·").slice(1).join("·").trim();

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

export function buildFabricGroups({ entries = [], lines = [], fabricPlan = null, stock = {}, multiFn = false } = {}) {
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
      const z = byZone.get(k) || { fi: e.fi, zoneKey: e.zk, name: e.zLabel, fnLabel: e.fnLabel || "", photo: e.photo || "", qty: 0, notes: [], tier: new Set() };
      z.qty += q;
      const note = applicationText(kind, e.fab, e.row);
      if (note) z.notes.push(note);
      z.tier.add(e.row?.useNewFabric ? "New" : "Old");
      byZone.set(k, z);
    });
    let zones = [...byZone.values()].map((z) => ({
      fi: z.fi, zoneKey: z.zoneKey, name: z.name, fnLabel: multiFn ? z.fnLabel : "", photo: z.photo,
      qty: r2(z.qty), application: z.notes.join(" · "), tier: [...z.tier].join(" + "),
      amount: Math.round(moneyByZone.get(z.zoneKey) || 0),
    }));
    // Layout not synced yet: fall back to the priced lines themselves, so the fabric still shows.
    if (!zones.length) {
      zones = kindLines.map((l) => ({
        fi: null, zoneKey: zoneOfLine(l), name: pretty(zoneOfLine(l)) || "Zone", fnLabel: "", photo: "",
        qty: r2(l.qty), application: "", tier: (String(l.name).match(LINE_RE) || [])[2] || "", amount: Math.round(Number(l.total) || 0),
      }));
    }
    if (!zones.length) return;
    kindLines.forEach((l) => groupedLineIds.add(l.id));
    const qty = r2(zones.reduce((s, z) => s + z.qty, 0));
    const amount = Math.round(kindLines.length ? kindLines.reduce((s, l) => s + (Number(l.total) || 0), 0) : zones.reduce((s, z) => s + z.amount, 0));
    const stockRows = Array.isArray(stock?.[kind.stockKey]) ? stock[kind.stockKey] : [];
    const colours = (Array.isArray(fabricPlan?.[kind.key]) ? fabricPlan[kind.key] : [])
      .map((c) => {
        const s = stockRows.find((r) => r && r.colour === c.colour) || {};
        return { colour: c.colour || "(unassigned)", qty: r2(c.qty), qtyOld: r2(c.qtyOld), qtyNew: r2(c.qtyNew), photo: s.photo || "", hex: s.hex || "" };
      })
      .sort((a, b) => b.qty - a.qty);
    zones.sort((a, b) => b.qty - a.qty);
    groups.push({
      key: kind.key, label: kind.label, unit: kind.unit, emoji: kind.emoji, qty, amount, zones, colours,
      photo: colours[0]?.photo || "", hex: colours[0]?.hex || "",
      colourText: colours.length ? colours.map((c) => `${c.colour} ${c.qty} ${kind.unit}`).join(" · ") : "No colour picked yet",
    });
  });
  return { groups, groupedLineIds };
}

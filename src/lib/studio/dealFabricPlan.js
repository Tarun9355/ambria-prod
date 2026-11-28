// Deal Check's own fabric demand plan: per truss row, which colour/tier its Liza/Masking/Curtain
// allocation goes to, aggregated by colour into { liza, masking, curtain, rows }. Moved out of
// DealCheckOverlay.jsx's buildDeptSnapshot (2026-11-28, owner ask: the Buying tab's own live fabric-
// shortfall preview needs this SAME aggregation, not a second slightly-different one that could drift)
// — this is still exactly what gets pushed to event_orders.fabricPlan for IMS's fabricGroups/fabricNeed
// to read, byte-for-byte; only where the computation lives changed.
import { calcZoneFabric, resolveFabricAllocation, fabricAnchorsForRow, anchorsForPaletteByMaterial, repeatCatFor } from "./pricing";
import { isTrussFoc } from "./foc.js";

// fns: dcCostRollup.fns (every function's zoneConfig/enabledEls/elSelectedPhoto/fnPalette); trussInv:
// the IMS Fabric Stock blob (Liza/Masking/Curtain per-colour stock + rates); libItems: the Library
// cache (read only for a photo's own saved drapeDensity); paletteCatalogue: imsPaletteCatalogue (named
// palette presets a Fabric Palette chip can point at by name instead of a literal colour list).
// No trussInv (not loaded yet) or any error partway through → the same empty { liza, masking, curtain }
// (no `rows` key) the inline version always fell back to.
export function buildDealFabricPlan({ fns, trussInv, libItems, paletteCatalogue }) {
  let fabricPlan = { liza: [], masking: [], curtain: [] };
  try {
    if (trussInv) {
      const agg = { liza: {}, masking: {}, curtain: {} };
      const byRow = []; // per truss row: which colour its fabric went to ({ fi, zk, ri, kind, colour, qty, tier }) - IMS Fabric block shows it per zone
      (fns || []).forEach((fn, fnI) => {
        const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
        const fnPaletteForAnchors = fn.fnPalette || "Custom";
        Object.keys(zc).forEach(zk => {
          // ♻️ Repeat zones reuse standing fabric — nothing new to stock/reorder for them.
          // Truss & Masking's own category flag — same one dcCostRollup's fabric ×0.75 above
          // reads — not the zone-wide toggle, so this Fabric-head projection can't disagree
          // with what the zone is actually billed for.
          if (!en[zk] || !zc[zk] || repeatCatFor(zc[zk], "truss")) return;
          let density = "moderate";
          const photoUrl = (fn.elSelectedPhoto || {})[zk];
          if (photoUrl) { const li = (libItems || []).find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
          // A zone can carry more than one truss row — each row's own allocation (or auto-fill).
          [zc[zk], ...(zc[zk].extraTrussRows || [])].forEach((row, ri) => {
            if (isTrussFoc(row)) return; // FOC - its fabric is already up at the venue; nothing for the Fabric dept to send
            const fab = calcZoneFabric(row, trussInv, row.drapeDensity || density);
            // Owner ask (2026-10-15): the Fabric dept needs to know WHICH tier a requirement is
            // for, not just a colour+qty total — row.useNewFabric (the salesperson's own Build
            // toggle) says so directly, so every row/colour here is tagged old vs new instead of
            // being summed together blind to it.
            const tier = row.useNewFabric ? "new" : "old";
            const add = (key, totalQty, stockArr, qtyField, allocField) => {
              if (!totalQty || totalQty <= 0) return;
              const existing = row[allocField];
              // key is "liza"/"masking"/"curtain" — the exact material-keys a Fabric Palette
              // colour can now be tagged with (StudioBuild.jsx), so each material only ever
              // auto-fills from colours actually meant for it, not every colour the
              // salesperson picked regardless of which fabric they meant it for.
              const allocs = resolveFabricAllocation(existing, Math.ceil(totalQty), fabricAnchorsForRow(row, key, anchorsForPaletteByMaterial(paletteCatalogue, fnPaletteForAnchors, key)), stockArr, qtyField);
              const bump = (c, qty) => { if (!agg[key][c]) agg[key][c] = { old: 0, new: 0 }; agg[key][c][tier] += qty; };
              if (allocs.length) allocs.forEach(a => { bump(a.colour || "(unassigned)", Number(a.qty) || 0); byRow.push({ fi: fnI, zk, ri, kind: key, colour: a.colour || "(unassigned)", qty: Number(a.qty) || 0, tier }); });
              else { bump("(unassigned)", Math.ceil(totalQty)); byRow.push({ fi: fnI, zk, ri, kind: key, colour: "(unassigned)", qty: Math.ceil(totalQty), tier }); }
            };
            add("masking", fab.maskingPieces, trussInv.maskingStock, "stockPieces", "maskingAllocation");
            add("liza", fab.lizaKg, trussInv.lizaStock, "stockKg", "lizaAllocation");
            add("curtain", fab.curtainPieces, trussInv.curtainStock, "stockPieces", "curtainAllocation");
            // Loose Liza/Masking/Curtain (Build's own "Loose fabric" rows, 2026-11-02) — the
            // salesperson already picked the colour by hand, so this bumps it straight into
            // the aggregate under THAT colour instead of going through add()'s auto-match
            // (resolveFabricAllocation), which exists only to GUESS a colour for the
            // formula-derived demand above.
            (Array.isArray(row.looseFabric) ? row.looseFabric : []).forEach((lf) => {
              const kind = lf?.kind, qty = Number(lf?.qty) || 0;
              if (!kind || qty <= 0 || !agg[kind]) return;
              const colour = String(lf.colour || "").trim() || "(unassigned)";
              if (!agg[kind][colour]) agg[kind][colour] = { old: 0, new: 0 };
              agg[kind][colour][tier] += qty;
              byRow.push({ fi: fnI, zk, ri, kind, colour, qty, tier });
            });
          });
        });
      });
      const toRows = (o) => Object.entries(o).map(([colour, t]) => ({ colour, qty: Math.ceil((t.old || 0) + (t.new || 0)), qtyOld: Math.ceil(t.old || 0), qtyNew: Math.ceil(t.new || 0) })).filter(r => r.qty > 0);
      fabricPlan = { liza: toRows(agg.liza), masking: toRows(agg.masking), curtain: toRows(agg.curtain), rows: byRow };
    }
  } catch { /* best-effort - a broken palette/stock shape falls back to the empty plan, same as before this was extracted */ }
  return fabricPlan;
}

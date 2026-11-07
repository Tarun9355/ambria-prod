// ═══ Event-level plans shared by Dept Ops and the department production book ═══
// Ported verbatim out of DepartmentOpsTab.jsx's own component scope (it called these on first use,
// since `sel` — the open event — used to be declared further down that same component; here `sel`
// is just a constructor argument, so the "read on first use" comments below are historical but the
// lazy-cache behavior itself is kept, since re-deriving a truss/carpet/element plan is not free).
import { ZONE_META, trussBaseArea } from "../studio/taxonomy";
import { calcZoneTrussPreview, calcZoneFabric, repeatCatFor } from "../studio/pricing";
import { carpetFloorsOf, planCarpets } from "./carpetPlan";
import { planElements } from "./elementPlan";

export function makeEventPlans({ sel, inventory, blocks, eventOrders, settings, trussInv }) {
  // ── TRUSS PLAN ── (the Truss tab of Deal Check, for the people who build it)
  // Every truss row of every function on the event: Customer demand vs Physical footprint, the
  // pillars / beams / batta it takes and its fabric (Liza / curtains / masking) with the colours
  // Deal Check allocated. Worked out here from the event's own zone layout and IMS's truss
  // inventory (same calcZoneTrussPreview / calcZoneFabric Deal Check uses), so it is always the
  // current plan, not a snapshot.
  let trussPlanCache = null;
  const trussPlanOf = () => {
    if (trussPlanCache) return trussPlanCache;
    const out = [];
    trussPlanCache = out;
    const fnsT = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
    if (!trussInv) return out;
    fnsT.forEach((fn, fi) => {
      const en = fn?.enabledEls || {}, zones = fn?.zones || {};
      Object.keys(zones).forEach(zk => {
        const zc = zones[zk]; if (!en[zk] || !zc) return;
        [zc, ...(Array.isArray(zc.extraTrussRows) ? zc.extraTrussRows : [])].forEach((row, ri) => {
          if (!row || !((trussBaseArea(row).area || 0) > 0) || row.trussQty === 0) return;
          let pv = null; try { pv = calcZoneTrussPreview(row, trussInv); } catch { pv = null; }
          if (!pv || !pv.topology) return;
          let fab = null; try { fab = calcZoneFabric(row, trussInv, row.drapeDensity || "moderate"); } catch { fab = null; }
          const zLabel = (fn?.zoneNames?.[zk]) || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          out.push({ key: `${fi}|${zk}|${ri}`, fn, fi, zk, ri, row, pv, fab, zLabel: ri > 0 ? `${zLabel} (truss #${ri + 1})` : zLabel });
        });
      });
    });
    return out;
  };
  // The truss rows as the Fabric block reads them (one entry per truss row: function, zone, its photo, the fabric it needs).
  const fabricEntriesOf = () => trussPlanOf().map((e) => ({
    fi: e.fi, zk: e.zk, ri: e.ri, zLabel: e.zLabel, fnLabel: e.fn?.type || `Function ${e.fi + 1}`,
    photo: e.fn?.elSelectedPhoto?.[e.zk]?.src || "", fab: e.fab, row: e.row,
    repeat: !!repeatCatFor(e.fn?.zones?.[e.zk], "truss"), // a repeat zone reuses standing fabric: no new colour is worked out for it
  }));
  // Each function's Fabric Palette as Build last synced it (only functions where Build keeps it live): the Fabric block works the colours out from it, so a
  // palette change in Build shows here without a Deal Check sync.
  const fabricPalettesOf = () => {
    const out = {};
    (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).forEach((fn, i) => { if (fn?.fabricPaletteLive) out[i] = String(fn.fabricPalette || ""); });
    return Object.keys(out).length ? out : null;
  };
  // ── CARPET PLAN ── sales ranks up to three stock carpets per floor (Build / Deal Check); here the Tenting head sees each
  // floor's three with what is actually free on the event date and decides which one is laid. The decision is IMS-owned
  // (deptOps.Tenting.carpetChoice), so every Studio sync leaves it alone.
  let carpetPlanCache = null;
  const carpetPlanOf = () => {
    if (carpetPlanCache) return carpetPlanCache;
    const floors = carpetFloorsOf(sel?.functionsDetail, (fn, zk) => fn?.zoneNames?.[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()), Array.isArray(settings?.carpetMaterials) && settings.carpetMaterials.length ? settings.carpetMaterials : undefined);
    const itemsById = {};
    (inventory || []).forEach(i => { if (i?.id != null) itemsById[i.id] = i; });
    carpetPlanCache = planCarpets({ floors, itemsById, blocks, eventId: sel?.id, choice: sel?.deptOps?.Tenting?.carpetChoice || {}, eventOrders });
    return carpetPlanCache;
  };
  // ── OVERLAY / CUSHION COVER CHOICES ── the same idea for the Fabric head: sales names up to three designs for an overlay or a cushion
  // cover; Planning decides the one design used for the whole quantity (deptOps.Fabric.itemChoice, IMS-owned).
  const zoneLabelFor = (fn, zk) => fn?.zoneNames?.[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  let elementPlanCache = null;
  const elementPlanOf = () => {
    if (elementPlanCache) return elementPlanCache;
    const itemsById = {};
    (inventory || []).forEach(i => { if (i?.id != null) itemsById[i.id] = i; });
    elementPlanCache = planElements({ functionsDetail: sel?.functionsDetail, zoneLabelOf: zoneLabelFor, itemsById, blocks, eventId: sel?.id, choice: sel?.deptOps?.Fabric?.itemChoice || {} });
    return elementPlanCache;
  };

  return { trussPlanOf, fabricEntriesOf, fabricPalettesOf, carpetPlanOf, elementPlanOf, zoneLabelFor };
}

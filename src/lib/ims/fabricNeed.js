// What an event needs of each fabric, per colour - from the SAME groups the Fabric block shows (lib/ims/fabricGroups buildFabricGroups:
// live from the event's layout and palette, else what Deal Check recorded), not Deal Check's stored fabricPlan alone. That stored
// copy is written when Deal Check syncs and goes stale when the plan changes afterwards (owner report 2026-11-26: Ivory 2 kg asked for
// while the block had only Maroon 15 kg). Used by Planning's fabric requirement table (the Fabric PDF), its "Fabric shortfalls" scan
// and the same-day stock held by other events, so all of them agree with the block.
// Returns { liza: [{ colour, qty, qtyOld, qtyNew }], masking: [...], curtain: [...] }. Fabric standing on Repeat asks for nothing.
import { buildFabricGroups, FABRIC_KINDS } from "./fabricGroups";
import { makeEventPlans } from "./eventPlans";

const fromPlan = (eo) => Object.fromEntries(FABRIC_KINDS.map((k) => [k.key, Array.isArray(eo?.fabricPlan?.[k.key]) ? eo.fabricPlan[k.key] : []]));

export function fabricNeedOf(eo, { inventory, eventOrders, settings, trussInv } = {}) {
  const empty = Object.fromEntries(FABRIC_KINDS.map((k) => [k.key, []]));
  if (!eo) return empty;
  try {
    const pl = makeEventPlans({ sel: eo, inventory, blocks: {}, eventOrders, settings, trussInv });
    const fns = Array.isArray(eo.functionsDetail) ? eo.functionsDetail : [];
    const { groups } = buildFabricGroups({ entries: pl.fabricEntriesOf(), lines: Array.isArray(eo.deptInventory?.Fabric) ? eo.deptInventory.Fabric : [],
      fabricPlan: eo.fabricPlan, stock: trussInv, multiFn: fns.length > 1, fnPalettes: pl.fabricPalettesOf() });
    // no layout and no priced fabric lines (an event not synced that far): the stored plan is all there is
    if (!groups.length) return { ...empty, ...fromPlan(eo) };
    const out = { ...empty };
    groups.forEach((g) => {
      out[g.key] = (g.colours || []).filter((c) => (Number(c.qty) || 0) > 0)
        .map((c) => ({ colour: c.colour, qty: Number(c.qty) || 0, qtyOld: Number(c.qtyOld) || 0, qtyNew: Number(c.qtyNew) || 0 }));
    });
    return out;
  } catch (e) {
    console.error("[fabricNeed]", e);
    return { ...empty, ...fromPlan(eo) };
  }
}

// One cache for a render's worth of lookups (Planning asks about every upcoming event, and about the same ones again per colour).
export function makeFabricNeedCache(ctx) {
  const cache = new Map();
  return (eo) => {
    if (!eo) return fabricNeedOf(null, ctx);
    if (!cache.has(eo)) cache.set(eo, fabricNeedOf(eo, ctx));
    return cache.get(eo);
  };
}

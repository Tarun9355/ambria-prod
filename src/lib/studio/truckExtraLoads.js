// Items IMS added straight to a truck ("Add an item not in this deal", IMS Dept Ops → Loading &
// dispatch — trip.custom[dept] rows on the shared event_orders.trucks) counted toward every OTHER
// truck-capacity consumer (Manpower's crew count, Deal Check's "Added on trucks" display) but never
// toward the truck COUNT/COST itself (QA report RC-236, Truck_Extras_Downstream_Gaps.md): a deal
// where ops piled 12 extra items onto a truck still billed transport as if nothing were added,
// because calcFunctionCost/calcFunctionBreakdown/computeTruckItems (StudioApp.jsx) only ever walk
// the Build's OWN zoneElements/zoneConfig — they have no idea `trucks` exists. Owner decision
// (2026-11-27): bill it — a truck extra is real weight on a real truck, so it should count toward
// the truck-capacity math exactly like a Build-assigned item of the same sub-category, with no
// Repeat/Fixed-Venue/cross-function-reuse waiver (those all mean "already standing at the venue,
// no truck needed" — an item added straight to a dispatching truck is, by definition, the opposite).
//
// Pure: no React, no live subscriptions — a deal-level memo (StudioApp.jsx) calls this once per
// relevant render and every cost engine reads its result.
import { tripsOf, tripFnOf } from "../ims/eventTrucks";
import { truckExtraFnIdx, isVirtualId } from "../ims/truckExtraBlocks";
import { walkKitUnits } from "../ims/helpers";
import { virtualPlatformItems } from "../ims/platformEngine";

// A virtual truck-extra row's own `sub` (DepartmentOpsTab.jsx's deptInventoryBySub) is a DIFFERENT
// vocabulary from the truck-capacity bucket names Build's own zone config contributes under
// (StudioApp.jsx's computeTruckItems/calcFunctionCost/calcFunctionBreakdown all call
// addSub("Truss", …)/addSub("Masking", …) etc. for the SAME physical stock) — same stock, two names.
// Liza/Curtains/Masking are a straight rename (identical unit: kg / pc / pc). Truss Pillar/Truss Beam
// are NOT renamed to "Truss": that bucket is sqft (the zone's own footprint), while a truck-extra
// pillar/beam is a piece count — there is no footprint to convert a piece count into, so these keep
// their own name and need their OWN pc-based truck-capacity row (TruckCapacityEditor.jsx) before they
// count toward any truck at all; until one exists, every cost engine's existing "no capacity row for
// this sub-category" behaviour already applies (silently 0 trucks, same as any of Build's own
// un-configured sub-categories) — nothing new has to special-case that here.
export const VIRTUAL_TRUCK_SUB_RENAME = { "liza fabric": "Liza", "velvet curtains": "Curtains", "wall masking": "Masking" };

// Map<fnIdx, [{sub, qty, name, invCat}]> — one entry per function that has at least one trip (even
// one with nothing counted in it, e.g. every row on it was unresolvable) attributed to it. `fns`/
// `fallbackFnIdx` decide WHICH function an untargeted trip's extras belong to (see tripFnOf below).
// A function no trip was ever attributed to has no Map entry at all, so `(map.get(fnIdx) || [])` is
// always the right empty-case read either way.
export function truckExtraLoadsByFn(trucks, { inventory, trussInv, fns, fallbackFnIdx } = {}) {
  const out = new Map();
  if (!Array.isArray(trucks) || !trucks.length) return out;
  const fallback = Number.isFinite(fallbackFnIdx) ? fallbackFnIdx : truckExtraFnIdx(fns);
  if (fallback == null) return out;
  const platformById = new Map(virtualPlatformItems(trussInv).map((p) => [p.id, p]));
  const bucket = (fnIdx) => { if (!out.has(fnIdx)) out.set(fnIdx, []); return out.get(fnIdx); };
  trucks.forEach((t) => {
    tripsOf(t).forEach((trip) => {
      const tripFn = tripFnOf(trip);
      // A trip with no destination function (tripFnOf → null, every trip saved before 2026-11-27's
      // per-function trip targeting) goes to the earliest-dated function — the same "the setup goes
      // first" convention truckExtraFnIdx already established for the crew-count feature, so a truck
      // extra is never counted for manpower under one function and billed under another.
      const fnIdx = tripFn != null ? tripFn : fallback;
      const loads = bucket(fnIdx);
      Object.values(trip.custom || {}).forEach((rows) => (Array.isArray(rows) ? rows : []).forEach((c) => {
        const qty = Number(c?.qty) || 0;
        if (qty <= 0 || !c?.invId) return;
        if (c.virtual || isVirtualId(c.invId)) {
          const id = String(c.invId);
          if (id.startsWith("platform:")) {
            const p = platformById.get(id);
            const sqft = p ? qty * p.lengthFt * p.widthFt : 0;
            if (sqft > 0) loads.push({ sub: "Platform", qty: sqft, name: c.name, invCat: "" });
            return;
          }
          const renamed = VIRTUAL_TRUCK_SUB_RENAME[String(c.sub || "").trim().toLowerCase()];
          loads.push({ sub: renamed || c.sub || "", qty, name: c.name, invCat: "" });
          return;
        }
        const invItem = (inventory || []).find((i) => String(i.id) === String(c.invId));
        if (!invItem) return; // the item was removed from Inventory since being added to the truck — nothing to count
        walkKitUnits(invItem, qty, inventory, undefined, (node, nodeQty) => {
          if (!(nodeQty > 0)) return;
          loads.push({ sub: node.subCat || node.subcategory || "", qty: nodeQty, name: node.id === invItem.id ? invItem.name : node.name, invCat: node.cat || node.category || "" });
        });
      }));
    });
  });
  return out;
}

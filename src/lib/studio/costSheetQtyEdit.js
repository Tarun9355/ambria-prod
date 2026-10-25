import { normalizePaintAllocation } from "./paint.js";

// The cost sheet preview's quantity box → the build element it came from. Pure: given the element as it is in
// the build RIGHT NOW, decide whether the edit may land and what the element becomes.
//   key      what the sheet line remembered about the element (invId / patternId / mandiId / name) — if the build
//            has changed underneath the sheet and this row is now a different element, the edit is refused
//   scale    the zone's Scale By (baseQty follows it, exactly as Build's own stepper does)
//   baseColour  the item's own colour, to know which units are repainted (the floor: not below painted units)
export function costSheetQtyEdit(el, { key, qty, scale, baseColour }) {
  if (!el) return { ok: false, msg: "The build has changed since this sheet opened — close and reopen the preview." };
  if (key && (el.invId || el.patternId || el.mandiId || el.name || "") !== key) return { ok: false, msg: "The build has changed since this sheet opened — close and reopen the preview." };
  const q = Math.max(0, Number(qty) || 0);
  const painted = normalizePaintAllocation(el, baseColour || "Ivory").reduce((s, a) => s + a.qty, 0);
  if (painted > 0 && q < painted) return { ok: false, msg: `Cannot set qty below ${painted} — paint allocation is set in Build.` };
  const s = Math.max(1, Math.round(Number(scale) || 1));
  // wantedQty: any "asked for more than was available" note ends with a hand-set quantity
  return { ok: true, next: { ...el, qty: q, baseQty: s > 1 ? q / s : q, wantedQty: undefined } };
}

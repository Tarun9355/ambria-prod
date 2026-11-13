import { walkKitFloralParts } from "../ims/flowerHelpers";

// A kit can hold flower RECIPES as well as inventory items (the Tree kit: Flower Trail ×6, Flower Bunch ×15).
// A recipe is not an inventory item, so Deal Check's per-department split has no component row for it — it was
// dropped, and the Dept PDF's kit page named only the inventory parts. These are carried separately, as
// { name, qty, uom, photo, patternId } for the kit's row: count only, no money (Build and the floral cost
// already price the recipes). `comps` is the kit's effective part list (the deal's edit, else the master).
//
// `inventory` (optional — every existing caller that omits it keeps working exactly as before, just
// without nested-kit recursion) lets this recurse into a sub-item that is ITSELF a kit: a recipe
// attached to a NESTED kit (a console inside Tree, say) used to be invisible here entirely, the same
// one-level-only gap floralCost.js and Build's own pricing had (owner report, 2026-11-13: "if a kit
// has another kit, the crawlers can miss them too"). A nested kit's own PHYSICAL (non-recipe)
// components are deliberately NOT collected here — those already get their own component row
// elsewhere; this function has only ever been about recipes.
export function kitRecipeParts(comps, patterns, kitQty, inventory) {
  const pats = Array.isArray(patterns) ? patterns : [];
  const kits = Math.max(0, Number(kitQty) || 0);
  const out = [];
  const addRecipe = (patternId, qty) => {
    if (qty <= 0) return;
    const pat = pats.find((p) => p && p.id === patternId);
    // A patternId that resolves to nothing is normally just "patterns hasn't loaded yet" (Deal
    // Check data still fetching) — shown generically as "Flower recipe" below rather than dropped,
    // so the kit page isn't silently missing a row while data catches up. But once `patterns` HAS
    // loaded and it genuinely isn't there, the pattern was deleted from the Flower Patterns library
    // — floralCost.js no longer prices or lists it anywhere (owner decision, 2026-11-12: a deleted
    // pattern is gone everywhere), so this list must not keep telling ops to pull flowers for it.
    if (!pat && pats.length > 0) return;
    out.push({
      name: String(pat?.name || "Flower recipe").trim(),
      qty,
      uom: String(pat?.unit || "").trim(),
      photo: pat?.img || pat?.sizes?.B?.img || pat?.sizes?.M?.img || pat?.sizes?.S?.img || "",
      patternId,
    });
  };
  (Array.isArray(comps) ? comps : []).forEach((cp) => {
    if (!cp || !cp.patternId || cp.itemId) return;
    const perKit = Number(cp.qty);
    addRecipe(cp.patternId, Math.round((perKit > 0 ? perKit : 1) * kits * 100) / 100);
  });
  if (Array.isArray(inventory) && inventory.length) {
    (Array.isArray(comps) ? comps : []).forEach((cp) => {
      if (!cp || cp.patternId || !cp.itemId) return;
      const ci = inventory.find((i) => i.id === cp.itemId);
      if (!ci) return;
      // The deal's own edit of the NESTED kit (cp.subOverrides) over its master subItems — same
      // precedence every other consumer of walkKitFloralParts honours (review finding, 2026-11-13,
      // "F4": this used to pass a bare `undefined`, ignoring a per-deal edit to a nested kit's own
      // recipe and letting the printed count disagree with what Build actually billed/sourced).
      const subOv = Array.isArray(cp.subOverrides) ? cp.subOverrides : undefined;
      // Gate on EITHER the master's own subItems OR subOverrides — a nested kit whose master
      // subItems is empty but whose deal-edit carries a live recipe must still be walked (same
      // nested-depth fix applied to flowerHelpers.js's other walkKitFloralParts callers).
      if (!subOv?.length && (!Array.isArray(ci.subItems) || !ci.subItems.length)) return;
      walkKitFloralParts(ci, kits * (Number(cp.qty) || 0), inventory, subOv, (node) => {
        if (node.patternId) addRecipe(node.patternId, Math.round(node.qty * 100) / 100);
      });
    });
  }
  return out;
}

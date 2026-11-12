// A kit can hold flower RECIPES as well as inventory items (the Tree kit: Flower Trail ×6, Flower Bunch ×15).
// A recipe is not an inventory item, so Deal Check's per-department split has no component row for it — it was
// dropped, and the Dept PDF's kit page named only the inventory parts. These are carried separately, as
// { name, qty, uom, photo, patternId } for the kit's row: count only, no money (Build and the floral cost
// already price the recipes). `comps` is the kit's effective part list (the deal's edit, else the master).
export function kitRecipeParts(comps, patterns, kitQty) {
  const pats = Array.isArray(patterns) ? patterns : [];
  const kits = Math.max(0, Number(kitQty) || 0);
  const out = [];
  (Array.isArray(comps) ? comps : []).forEach((cp) => {
    if (!cp || !cp.patternId || cp.itemId) return;
    const perKit = Number(cp.qty);
    const qty = Math.round((perKit > 0 ? perKit : 1) * kits * 100) / 100;
    if (qty <= 0) return;
    const pat = pats.find((p) => p && p.id === cp.patternId);
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
      patternId: cp.patternId,
    });
  });
  return out;
}

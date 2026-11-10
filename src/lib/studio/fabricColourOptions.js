// The colours Build's Fabric Palette offers: only what the fabric stock (IMS → Planning → Fabric Stock: Liza, Wall Masking, Velvet Curtains) actually holds.
// A stock row counts for its fabric when something is in it (old + new above 0) and it is not switched off for Build ("In Build" toggle, row.hideInBuild).
// A colour already picked stays listed whatever its stock, so it can still be un-picked.
// Returns Map<colour name, { name, photo, in: Set<"liza" | "masking" | "curtain"> }> - `in` is the fabrics the colour is offered for.
// One colour is one entry whatever its capitals or spacing: Liza's "Navy blue" and Wall Masking's "Navy Blue" listed twice.
// The name shown is the spelling already picked on the deal if there is one (so the pick stays ticked), else the first stock row's.
const FABRICS = [["liza", "lizaStock"], ["masking", "maskingStock"], ["curtain", "curtainStock"]];
const colourKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function fabricColourOptions(trussInv, pickedNames = []) {
  const pickedSpelling = new Map();
  (pickedNames || []).forEach((p) => { const k = colourKey(p); if (k && !pickedSpelling.has(k)) pickedSpelling.set(k, String(p).trim()); });
  const byKey = new Map();
  FABRICS.forEach(([material, stockKey]) => {
    (Array.isArray(trussInv?.[stockKey]) ? trussInv[stockKey] : []).forEach((s) => {
      const raw = String(s?.colour || "").trim().replace(/\s+/g, " ");
      const k = colourKey(raw);
      if (!k) return;
      const held = (Number(s.stockKg) || 0) + (Number(s.stockKgNew) || 0) + (Number(s.stockPieces) || 0) + (Number(s.stockPiecesNew) || 0) > 0;
      const offered = held && !s.hideInBuild;
      if (!offered && !pickedSpelling.has(k)) return;
      if (!byKey.has(k)) byKey.set(k, { name: pickedSpelling.get(k) || raw, photo: "", in: new Set() });
      const e = byKey.get(k);
      if (offered) e.in.add(material);
      if (!e.photo && s.photo) e.photo = s.photo;
    });
  });
  // A colour picked on the deal that no stock row has at all - deleted from Fabric Stock, or an old pick such as "PASTELS" from
  // before the palette came from stock - is still listed, flagged removed, so it can be found and un-picked.
  pickedSpelling.forEach((name, k) => { if (!byKey.has(k)) byKey.set(k, { name, photo: "", in: new Set(), removed: true }); });
  return new Map([...byKey.values()].map((e) => [e.name, e]));
}

// True once the fabric stock has loaded (any of the three has a row) - until then every colour would look removed.
export const fabricStockLoaded = (trussInv) => FABRICS.some(([, key]) => Array.isArray(trussInv?.[key]) && trussInv[key].length > 0);

// The palette's colours without the removed ones (no stock row in any fabric). Returns null when nothing changes, or when the
// stock has not loaded, so a caller writes only a real clean-up. A colour that still has a row - out of stock or switched off
// for Build - is kept.
export function dropRemovedFabricColours(trussInv, colors) {
  const list = Array.isArray(colors) ? colors.filter((c) => c && c.name) : [];
  if (!list.length || !fabricStockLoaded(trussInv)) return null;
  const info = fabricColourOptions(trussInv, list.map((c) => c.name));
  const keep = list.filter((c) => info.get(String(c.name).trim())?.removed !== true);
  return keep.length === list.length ? null : keep;
}

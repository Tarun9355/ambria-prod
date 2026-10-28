// The colours Build's Fabric Palette offers: only what the fabric stock (IMS → Planning → Fabric Stock: Liza, Wall Masking, Velvet Curtains) actually holds.
// A stock row counts for its fabric when something is in it (old + new above 0) and it is not switched off for Build ("In Build" toggle, row.hideInBuild).
// A colour already picked stays listed whatever its stock, so it can still be un-picked.
// Returns Map<colour name, { name, photo, in: Set<"liza" | "masking" | "curtain"> }> - `in` is the fabrics the colour is offered for.
const FABRICS = [["liza", "lizaStock"], ["masking", "maskingStock"], ["curtain", "curtainStock"]];

export function fabricColourOptions(trussInv, pickedNames = []) {
  const picked = new Set(pickedNames);
  const map = new Map();
  FABRICS.forEach(([material, stockKey]) => {
    (Array.isArray(trussInv?.[stockKey]) ? trussInv[stockKey] : []).forEach((s) => {
      const name = String(s?.colour || "").trim();
      if (!name) return;
      const held = (Number(s.stockKg) || 0) + (Number(s.stockKgNew) || 0) + (Number(s.stockPieces) || 0) + (Number(s.stockPiecesNew) || 0) > 0;
      const offered = held && !s.hideInBuild;
      if (!offered && !picked.has(name)) return;
      if (!map.has(name)) map.set(name, { name, photo: "", in: new Set() });
      const e = map.get(name);
      if (offered) e.in.add(material);
      if (!e.photo && s.photo) e.photo = s.photo;
    });
  });
  return map;
}

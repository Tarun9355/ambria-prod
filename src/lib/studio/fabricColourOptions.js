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
  return new Map([...byKey.values()].map((e) => [e.name, e]));
}

// A zone's size as the guest reads it on Summary and the cost sheet (Preview / PDF / PPT / Canva): the truss's
// Width × Depth × Height in Build's own order (dims W / L / H), from the zone's first truss or, failing that, the first
// added truss (zc.extraTrussRows) that has a size; with no truss size, the platform / carpet floor (floorDims L × W).
// An axis never typed shows "—", never "0ft" (RC-78: a Single U with no depth printed "0ft×40ft×15ft", and a zone with
// no size at all printed "0ft×0ft×0ft" on the document handed to the client). "" when the zone has no size anywhere.
const num = (v) => { const n = Number(v); return n > 0 ? n : 0; };
const axis = (v) => (num(v) ? String(num(v)) : "—");

export function zoneDimLabel(zc) {
  if (!zc) return "";
  const rows = [zc, ...(Array.isArray(zc.extraTrussRows) ? zc.extraTrussRows : [])];
  const row = rows.find((r) => { const d = r?.dims || {}; return num(d.W || d.S) || num(d.L) || num(d.H); });
  if (row) { const d = row.dims; return `${axis(d.W || d.S)} × ${axis(d.L)} × ${axis(d.H)} ft`; }
  const fd = zc.floorDims || {};
  if (num(fd.L || fd.S) || num(fd.W || fd.S)) return `${axis(fd.L || fd.S)} × ${axis(fd.W || fd.S)} ft`;
  return "";
}

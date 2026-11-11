// A "Can be made" item booked past what we hold on the date (Deal Check's shortQty): how the short part is arranged.
// Planning splits it between our own production, an outside vendor and buying it; whatever is not split yet stays
// "not arranged" - nothing is assumed to be made in-house. Saved per event and department as
// deptOps[dept].shortAlloc[key] = { make, outsource, buy }; key is the item's inventory id, else its name.
export const ALLOC_SOURCES = [
  ["make", "Our production"],
  ["outsource", "Outsourced"],
  ["buy", "Bought"],
];

export const allocKeyOf = (it) => String(it?.invId || it?.imsId || it?.name || "").trim();

const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));

// The breakdown for one line. booked = what the event needs, short = what we do not hold on the date.
// A split saved for a bigger shortage than there is now (the booking came down) is cut back, in the order
// production, outsourced, bought, so the parts never add up to more than the shortage - nothing is counted twice.
export function shortfallBreakdown({ booked, short }, saved) {
  const b = whole(booked);
  const s = Math.min(whole(short), b);
  let left = s;
  const parts = {};
  ALLOC_SOURCES.forEach(([k]) => { const v = Math.min(whole(saved?.[k]), left); parts[k] = v; left -= v; });
  const savedTotal = ALLOC_SOURCES.reduce((t, [k]) => t + whole(saved?.[k]), 0);
  return { booked: b, inStock: b - s, short: s, ...parts, unarranged: left, trimmed: savedTotal > s };
}

// One part of the split set to `value`, held within what the other two leave of the shortage.
export function setAllocPart(saved, short, key, value) {
  const s = whole(short);
  const others = ALLOC_SOURCES.filter(([k]) => k !== key).reduce((t, [k]) => t + Math.min(whole(saved?.[k]), s), 0);
  return { ...(saved || {}), [key]: Math.min(whole(value), Math.max(0, s - others)) };
}

// "600 = 500 in stock + 100 outsourced" - the challan's and the PDF's one-line account of where the units come from.
export function shortfallLine(bd) {
  if (!bd || !(bd.short > 0)) return "";
  const bits = [`${bd.inStock} in stock`];
  ALLOC_SOURCES.forEach(([k, label]) => { if (bd[k] > 0) bits.push(`${bd[k]} ${label.toLowerCase()}`); });
  if (bd.unarranged > 0) bits.push(`${bd.unarranged} not arranged`);
  return `${bd.booked} = ${bits.join(" + ")}`;
}

// A booked deal's function that is already over (owner ask 2026-11-17): items can still be ADDED to it, never removed or
// reduced - what was sent to the event is a fact by then. Build routes every element write through reducedItems and
// refuses one that takes any item's total down.

// "YYYY-MM-DD" of today, local time (the dates on a function are local calendar days).
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Over = its date is before today. The event day itself is still open.
export const isPastFunction = (fnDate, today = localToday()) => /^\d{4}-\d{2}-\d{2}$/.test(String(fnDate || "")) && String(fnDate) < today;

// Every item's total across a function's zones: an inventory element, a flower pattern / mandi flower, a custom row by its
// name and size - and each kit's parts (its edited parts, else the kit's own list) x the kit's qty, so taking a part out
// of a kit counts as a reduction too.
export function itemTotals(zoneElements, inventory = []) {
  const out = new Map();
  const add = (key, name, qty) => {
    const q = Number(qty) || 0;
    if (!key || !(q > 0)) return;
    const cur = out.get(key) || { name, qty: 0 };
    cur.qty += q;
    out.set(key, cur);
  };
  const invById = new Map((inventory || []).map((i) => [i.id, i]));
  Object.values(zoneElements || {}).forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((el) => {
      if (!el) return;
      const qty = Number(el.qty) || 0;
      const key = el.invId ? `inv:${el.invId}` : el.patternId ? `pat:${el.patternId}` : el.mandiId ? `mandi:${el.mandiId}|${el.mandiVariantId || ""}` : el.name ? `name:${el.name}|${el.size || ""}` : "";
      add(key, el.name || "Item", qty);
      if (!el.invId) return;
      const inv = invById.get(el.invId);
      const parts = Array.isArray(el.kitOverrides) ? el.kitOverrides : (Array.isArray(inv?.subItems) ? inv.subItems : []);
      parts.forEach((p) => {
        const id = p?.itemId || p?.id;
        if (!id) return;
        add(`inv:${id}`, invById.get(id)?.name || p.name || "Kit part", qty * (Number(p.qty) || 0));
      });
    });
  });
  return out;
}

// What a change takes down: [{ name, from, to }] - empty when it only adds or keeps.
export function reducedItems(prevZoneElements, nextZoneElements, inventory = []) {
  const before = itemTotals(prevZoneElements, inventory);
  const after = itemTotals(nextZoneElements, inventory);
  const cut = [];
  before.forEach((b, key) => {
    const to = after.get(key)?.qty || 0;
    if (to + 1e-9 < b.qty) cut.push({ name: b.name, from: Math.round(b.qty * 100) / 100, to: Math.round(to * 100) / 100 });
  });
  return cut;
}

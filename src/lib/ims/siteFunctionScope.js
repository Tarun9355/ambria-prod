// One function's share of a department's load list, for the Site page's function chips (owner ask 2026-11-27: "site pe bhi function
// wise dikhna chaiye jese planning mai hai" - Amit Gulati, 27 Nov Exotica + 28 Nov Pushpanjali, one list for both venues).
// The same sources Planning's one-function view reads, in this order:
//  - a line with parts tagged by function (Platform / carpet): that function's parts;
//  - Deal Check's per-function record (byFn[function].rentalQty) - what the function needs at its venue;
//  - a line Deal Check filed for one function (fnIdx);
//  - an item blocked for the event but not in Deal Check's list: its blocks on that function's date;
//  - else the function's own zone lists (kits walked into their parts), never more than the line holds.
// A fabric line (Liza / curtains / masking by colour) is shared by its zones' new fabric. Lines no function claims stay under All.
import { walkKitUnits, } from "./helpers";
import { isLiveBlockStatus, blockEntryQty } from "./liveBlocks";
import { TRUCK_EXTRA_SRC } from "./truckExtraBlocks";

// how many of each item one function's zone lists use - by inventory id and by name, kit parts walked into (Planning's qtyMapsOfFn)
export function qtyMapsOfFn(fd, inventory) {
  const byId = new Map(), byName = new Map();
  Object.entries(fd?.elements || {}).forEach(([zk, els]) => {
    if (fd.enabledEls && fd.enabledEls[zk] === false) return;
    (Array.isArray(els) ? els : []).forEach((el) => {
      if (el?.foc) return;
      const q = Number(el?.qty) || 1;
      const id = el?.invId || el?.imsId;
      const top = id ? (inventory || []).find((i) => String(i.id) === String(id)) : null;
      if (top) {
        walkKitUnits(top, q, inventory, el.kitOverrides, (node, nodeQty) => {
          byId.set(String(node.id), (byId.get(String(node.id)) || 0) + nodeQty);
          const nn = String(node.name || "").trim().toLowerCase();
          if (nn) byName.set(nn, (byName.get(nn) || 0) + nodeQty);
        });
      } else {
        if (id) byId.set(String(id), (byId.get(String(id)) || 0) + q);
        const nm = String(el?.name || "").trim().toLowerCase();
        if (nm) byName.set(nm, (byName.get(nm) || 0) + q);
      }
    });
  });
  return { byId, byName };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ctx: { fd, fi, inventory, blocks, eventId, fabricGroups (whole event) }. Returns the line at the function's quantity, or null when the
// function needs none of it.
export function scopeLineToFn(it, ctx) {
  const { fd, fi } = ctx;
  if (!it || !fd) return it;
  const fk = String(fd?.fnIdx ?? fi);
  const isFn = (v) => v != null && (String(v) === fk || Number(v) === fi);
  const qty = Number(it.qty) || 0;
  const out = (q, extra = {}) => (q > 0 ? { ...it, qty: r2(Math.min(q, qty || q)), ...extra } : null);

  // fabric folded per colour: this function's non-Repeat zones' share of the fabric's new fabric
  if (String(it.id || "").startsWith("fabric:")) {
    const kind = String(it.id).split(":")[1];
    const g = (ctx.fabricGroups || []).find((x) => x.key === kind);
    if (!g) return null;
    const fresh = (g.zones || []).filter((z) => !z.standing);
    const all = fresh.reduce((s, z) => s + (Number(z.qty) || 0), 0);
    const mine = fresh.filter((z) => isFn(z.fi)).reduce((s, z) => s + (Number(z.qty) || 0), 0);
    return all > 0 ? out((qty * mine) / all) : null;
  }
  if (Array.isArray(it.parts) && it.parts.some((p) => p?.fnIdx != null)) {
    const ps = it.parts.filter((p) => isFn(p?.fnIdx));
    return out(ps.reduce((s, p) => s + (Number(p.qty) || 0), 0), { parts: ps });
  }
  if (it.byFn && typeof it.byFn === "object") {
    const r = it.byFn[fk] ?? it.byFn[fi];
    return r ? out(Number(r.rentalQty ?? r.qty) || 0) : null;
  }
  if (it.fnIdx != null) return isFn(it.fnIdx) ? it : null;
  if (it.blockedOnly && it.invId) {
    const date = String(fd?.date || "").slice(0, 10);
    const q = (ctx.blocks?.[it.invId] || []).filter((b) => b?.eventId === ctx.eventId && isLiveBlockStatus(b) && b.source !== TRUCK_EXTRA_SRC && String(b.date || "").slice(0, 10) === date)
      .reduce((s, b) => s + blockEntryQty(b), 0);
    return out(q);
  }
  const maps = ctx.maps || qtyMapsOfFn(fd, ctx.inventory);
  const z = (it.invId && maps.byId.get(String(it.invId))) || maps.byName.get(String(it.name || "").trim().toLowerCase()) || 0;
  return out(z);
}

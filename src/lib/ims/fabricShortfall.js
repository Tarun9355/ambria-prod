// Shared, pure fabric shortfall maths — Liza / Wall Masking / Velvet Curtains are not `inventory` rows,
// they live entirely in `truss_inventory` (trussInv.lizaStock/maskingStock/curtainStock, each a per-colour
// {stockKg|stockPieces, stockKgNew|stockPiecesNew} row) with no imsId of their own. This file is the one
// place that works out, for a given event or across every live event, how much of a colour is needed vs
// how much is actually on the shelf — Dept Ops' Fabric panel (DepartmentOpsTab.jsx) and the fabric
// auto-purchase engine (lib/ims/fabricAutoPurchase.js) both build on these same functions so they can never
// quietly disagree with each other. No React, no Supabase — every export here is a plain function over
// plain data, built on makeFabricNeedCache (lib/ims/fabricNeed.js) and isLiveEventOrder (lib/ims/helpers.js).
import { isLiveEventOrder } from "./helpers.js";

// Same three fabrics DepartmentOpsTab.jsx has always shown, same order (liza, masking, curtain) — kept here
// as the one definition; DepartmentOpsTab.jsx imports this instead of redeclaring its own copy.
export const FABRIC_TYPES = [
  { key: "liza", label: "Liza Fabric", stockKey: "lizaStock", qtyField: "stockKg", unit: "kg", emoji: "🧣" },
  { key: "masking", label: "Wall Masking", stockKey: "maskingStock", qtyField: "stockPieces", unit: "pcs", emoji: "🧱" },
  { key: "curtain", label: "Velvet Curtains", stockKey: "curtainStock", qtyField: "stockPieces", unit: "pcs", emoji: "🎀" },
];

// Same normaliser as fabricColourOptions.js/fabricGroups.js - one colour whatever its capitals or spacing.
export const colourKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// An event's own date, the same single definition DepartmentOpsTab.jsx used to declare locally as
// `eventDate` - moved here so the auto-purchase engine (which has no access to that component's scope)
// reads an event's date the exact same way Dept Ops always has.
export const eoDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || eo?.eventDate || "";

// The LAST function's date of a multi-day event — crediting stock (fabricAutoPurchase.js) waits for the
// whole event to be over, not just its first day, so a fabric bought for day 2 of a 2-day wedding isn't
// credited back to stock while day 2 hasn't happened yet.
export const eoLastDate = (eo) => {
  const dates = (Array.isArray(eo?.functionsDetail) ? eo.functionsDetail : []).map((f) => f?.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : eoDate(eo);
};

// Is this a live, dated-today-or-later event order with an actual fabric need to speak of? The same test
// upcomingFabricShort always used (kept exactly, including its one quirk: `eo.status && !isLiveEventOrder(eo)`
// is NOT the same as `!isLiveEventOrder(eo)` - a statusless order is never excluded by status alone here).
export function isFabricDemandEvent(eo, today) {
  const d = eoDate(eo);
  if (!d || d < today) return false;
  if (eo?.status && !isLiveEventOrder(eo)) return false;
  if (!eo?.fabricPlan && !eo?.functionsDetail) return false;
  return true;
}

// Current stock per fabric, summed across every row of the SAME colour (by colourKey, so "Navy blue" and
// "Navy Blue" are one entry - the old per-screen lookups kept them apart by exact string, a latent bug this
// closes). Map<colourKey, { name, old, new, hiddenInBuild, photo, hex }> per fabric key.
// `hiddenInBuild` is true only when EVERY row of that colour (for that one fabric) is switched off for
// Build - a colour with even one visible row still counts as a real, buyable colour.
export function fabricStockIndex(trussInv) {
  const out = {};
  FABRIC_TYPES.forEach((ft) => {
    const m = new Map();
    (Array.isArray(trussInv?.[ft.stockKey]) ? trussInv[ft.stockKey] : []).forEach((r) => {
      const raw = String(r?.colour || "").trim() || "(unassigned)";
      const k = colourKey(raw);
      const cur = m.get(k) || { name: raw, old: 0, new: 0, hiddenInBuild: true, photo: "", hex: "" };
      cur.old += Number(r?.[ft.qtyField]) || 0;
      cur.new += Number(r?.[`${ft.qtyField}New`]) || 0;
      if (!r?.hideInBuild) cur.hiddenInBuild = false;
      if (!cur.photo && r?.photo) cur.photo = r.photo;
      if (!cur.hex && r?.hex) cur.hex = r.hex;
      m.set(k, cur);
    });
    out[ft.key] = m;
  });
  return out;
}

// Every other LIVE event order on the same date (the event itself excluded by id) - the one predicate
// sameDayReservedOf and eventFabricBuyLines/eventFabricBuyLines's same-day pooling both need, kept in one
// place instead of two copies of the same five-way check drifting apart.
export function sameDayOrders({ eventOrders, date, exclId }) {
  if (!date) return [];
  return (eventOrders || []).filter((eo) => eo && eo.id !== exclId && eoDate(eo) === date && !(eo.status && !isLiveEventOrder(eo)) && (eo.fabricPlan || eo.functionsDetail));
}

// Same-day contention: how much of this fabric/colour the event's date is ALREADY committed to by other
// live events (so the same stock can't be double-counted as free for two weddings on the same day). Matches
// colours by colourKey (see fabricStockIndex's own note on why) rather than the old exact-string compare.
export function sameDayReservedOf({ eventOrders, needOf, date, exclId, kind, colour }) {
  let s = 0;
  const ck = colourKey(colour);
  sameDayOrders({ eventOrders, date, exclId }).forEach((eo) => {
    (needOf(eo)[kind] || []).forEach((r) => { if (colourKey(r.colour) === ck) s += Number(r.qty) || 0; });
  });
  return s;
}

// One event's own fabric requirement vs what's free for it (net of same-day contention elsewhere) - the
// exact figures Dept Ops' Fabric panel and the shared Fabric & Tenting book render (DepartmentOpsTab.jsx's
// old fabricReqRowsOf, same shape minus `hex` - the caller adds that, since it needs the colour catalogue
// and swatch lookup DepartmentOpsTab.jsx already has to hand). Tier-aware: `required`/`qtyOld`/`qtyNew` are
// compared old-for-old, new-for-new, same reasoning as `shortOld`/`shortNew` always had - idle New stock
// doesn't help an Old-tier shortfall, and vice versa.
export function eventFabricRows({ eo, eventOrders, needOf, stockIdx }) {
  if (!eo) return [];
  const d = eoDate(eo);
  const need = needOf(eo);
  return FABRIC_TYPES.map((ft) => {
    const req = need[ft.key] || [];
    const rows = req.map((r) => {
      const av = stockIdx[ft.key]?.get(colourKey(r.colour)) || { old: 0, new: 0 };
      const stock = av.old + av.new;
      const otherDay = sameDayReservedOf({ eventOrders, needOf, date: d, exclId: eo.id, kind: ft.key, colour: r.colour });
      const reqOld = Number(r.qtyOld) || 0, reqNew = Number(r.qtyNew) || 0;
      const avail = Math.max(0, stock - otherDay);
      const shortOld = Math.max(0, reqOld - av.old);
      const shortNew = Math.max(0, reqNew - av.new);
      return { colour: r.colour, required: r.qty, qtyOld: reqOld, qtyNew: reqNew, old: av.old, new: av.new, stock, otherDay, avail, short: Math.max(0, r.qty - avail), shortOld, shortNew };
    });
    return { ...ft, rows };
  }).filter((f) => f.rows.length);
}

// Every live, upcoming event's own fabric shortfalls, flattened - DepartmentOpsTab.jsx's old
// upcomingFabricShort, same shape plus `eoId`/`kind` (the auto-purchase engine and Supply need to know
// WHICH event and WHICH fabric key a row is about, not just its display label).
export function upcomingEventShortfalls({ eventOrders, needOf, stockIdx, today }) {
  const out = [];
  (eventOrders || []).forEach((eo) => {
    if (!isFabricDemandEvent(eo, today)) return;
    const d = eoDate(eo);
    const need = needOf(eo);
    FABRIC_TYPES.forEach((ft) => {
      (need[ft.key] || []).forEach((r) => {
        const av = stockIdx[ft.key]?.get(colourKey(r.colour)) || { old: 0, new: 0 };
        const otherDay = sameDayReservedOf({ eventOrders, needOf, date: d, exclId: eo.id, kind: ft.key, colour: r.colour });
        const short = (Number(r.qty) || 0) - Math.max(0, (av.old + av.new) - otherDay);
        if (short > 0) {
          out.push({ eoId: eo.id, event: eo.clientName || "Event", date: d, kind: ft.key, fabric: ft.label, colour: r.colour, short, unit: ft.unit, contended: otherDay > 0 });
        } else {
          // Tier-specific: combined supply covers it, but the New-tier portion this event actually needs
          // (picked explicitly in Build) can't be met from New stock alone - Old stock sitting idle doesn't
          // help a New requirement, so this would otherwise look fine and quietly surprise whoever's
          // pulling stock on the day.
          const reqNew = Number(r.qtyNew) || 0;
          const shortNew = reqNew - Math.max(0, av.new - otherDay);
          if (reqNew > 0 && shortNew > 0) out.push({ eoId: eo.id, event: eo.clientName || "Event", date: d, kind: ft.key, fabric: ft.label, colour: r.colour, short: shortNew, unit: ft.unit, contended: otherDay > 0, newTierOnly: true });
        }
      });
    });
  });
  return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// Every live, upcoming event's fabric demand, grouped by fabric × colour × date - the shape
// `fabricAutoPurchase.js`'s planner walks date-by-date to work out real cover (a fabric bought for an
// earlier date already covers a later one). Untiered qty (qty - qtyOld - qtyNew, an event whose Build
// picks never got a tier split recorded) counts as Old, same assumption tierDeficits below is built on.
// "(unassigned)" (no colour picked at all) can never be bought against, so it's kept apart.
export function fabricDemandByDate({ eventOrders, needOf, today }) {
  const demand = new Map(); // "kind|colourKey" -> { kind, colour, byDate: Map<date, {Q,QO,QN,events}> }
  const unassigned = [];
  (eventOrders || []).forEach((eo) => {
    if (!isFabricDemandEvent(eo, today)) return;
    const d = eoDate(eo);
    const need = needOf(eo);
    FABRIC_TYPES.forEach((ft) => {
      (need[ft.key] || []).forEach((r) => {
        const qty = Number(r.qty) || 0;
        if (!(qty > 0)) return;
        const qtyNew = Math.max(0, Number(r.qtyNew) || 0);
        const qtyOldRecorded = Math.max(0, Number(r.qtyOld) || 0);
        const untiered = Math.max(0, qty - qtyOldRecorded - qtyNew);
        const qtyOld = qtyOldRecorded + untiered; // untiered folds into Old (tierDeficits' own assumption)
        const rawColour = String(r.colour || "").trim();
        const event = { eoId: eo.id, client: eo.clientName || "Event", date: d, qty, qtyOld, qtyNew };
        if (!rawColour || colourKey(rawColour) === colourKey("(unassigned)")) {
          unassigned.push({ kind: ft.key, label: ft.label, unit: ft.unit, qty, event });
          return;
        }
        const mapKey = `${ft.key}|${colourKey(rawColour)}`;
        let entry = demand.get(mapKey);
        if (!entry) { entry = { kind: ft.key, colour: rawColour, byDate: new Map() }; demand.set(mapKey, entry); }
        let dEntry = entry.byDate.get(d);
        if (!dEntry) { dEntry = { Q: 0, QO: 0, QN: 0, events: [] }; entry.byDate.set(d, dEntry); }
        dEntry.Q += qty; dEntry.QO += qtyOld; dEntry.QN += qtyNew; dEntry.events.push(event);
      });
    });
  });
  return { demand, unassigned };
}

// One date/colour/fabric's tier-split shortfall against a given effective stock (old/new numbers already
// net of whatever's covered by earlier-dated purchases - see fabricAutoPurchase.js's own cover walk).
// needNew: the New-tagged demand New stock alone can't meet - Old stock, however much is sitting idle,
// physically cannot substitute for a demand the salesperson explicitly picked New fabric for.
// needOld: the Old-tagged (+ untiered) demand left over after Old stock, netted against whatever New stock
// is SPARE once the New-tier demand is met first - spare New can stand in for an Old requirement (the same
// one-way substitution AdminSettingsTab.jsx's own fabric-stock note describes: "consumes Old stock first,
// then New"), it just never works the other way around.
// needOld + needNew generally equals the plain combined deficit (max(0, Q-old-new)) - except exactly when
// New stock alone is short of its own tagged demand, in which case the sum is the TRUER number (the
// combined view wrongly assumes idle Old stock could cover a New-tagged need, which it can't) - this is
// intentional, not a bug: fabricBuyList's own `buy` figure takes max(combined, needNew) for exactly this
// reason, so the stricter tier-aware number always wins when the two disagree.
export function tierDeficits({ Q, QO, QN }, { old, new: stockNew }) {
  const needNew = Math.max(0, QN - stockNew);
  const spareNew = Math.max(0, stockNew - QN);
  const needOld = Math.max(0, QO - old - spareNew);
  return { needNew, needOld };
}

// Pure stock-credit: adds `qty` into the given tier's field on the first stock row matching `colour`
// (by colourKey), or appends a brand-new row if this colour has no row at all yet in that fabric. Never
// mutates its input (trussInv) or touches anything but the one qty field - rates, photos, hex, hideInBuild
// all ride through untouched.
export function receiveFabricIntoStock(trussInv, { stockKey, qtyField, colour, tier, qty }) {
  const amt = Number(qty) || 0;
  const rows = Array.isArray(trussInv?.[stockKey]) ? trussInv[stockKey] : [];
  const ck = colourKey(colour);
  const field = tier === "new" ? `${qtyField}New` : qtyField;
  const idx = rows.findIndex((r) => colourKey(r?.colour) === ck);
  if (idx >= 0) {
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: (Number(r[field]) || 0) + amt } : r));
    return { ...trussInv, [stockKey]: next };
  }
  const row = { colour, [qtyField]: 0, [`${qtyField}New`]: 0, [field]: amt };
  return { ...trussInv, [stockKey]: [...rows, row] };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const KIND_ORDER = FABRIC_TYPES.map((f) => f.key);

// Turns any `need` of fabricPlan/needOf's shape ({ liza: [{colour,qty,qtyOld,qtyNew}], masking: [...],
// curtain: [...] }) into "buy this" lines against current stock, via the SAME tierDeficits every other
// shortfall figure in the app (the auto-purchase engine included) is built on - so a figure shown here is
// always what would actually get bought, never a second, slightly different opinion.
// `alsoOnDate`: other live events sharing the same date ([{ eoId, client, need }]) - their demand pools
// into the SAME (kind, colour)'s deficit (two weddings on one day draw on one shelf), but never changes
// `qty`/`qtyOld`/`qtyNew` below, which stay THIS call's own need alone; the pooled total is `pooledQty`,
// and which other events it's shared with is `sharedWith`. Call with no `alsoOnDate` (Deal Check's own
// Buying-tab preview, which has no visibility into other deals) and `qty === pooledQty` always.
// `"(unassigned)"` (no colour picked yet) can never be bought against - it goes to `unassigned` instead of
// a line, same as fabricDemandByDate already treats it.
export function fabricBuyLinesFromNeed(need, stockIdx, { alsoOnDate = [] } = {}) {
  const unassigned = [];
  const byKey = new Map(); // "kind|colourKey" -> { kind, label, unit, emoji, stockKey, colour, colourKey, Q, QO, QN, ownQ, ownQO, ownQN, sharedWith: Map<eoId, {client, qty}> }
  const fold = (ft, r, own, tag) => {
    const qty = Number(r?.qty) || 0;
    if (!(qty > 0)) return;
    const rawColour = String(r?.colour || "").trim();
    const qtyNew = Math.max(0, Number(r?.qtyNew) || 0);
    const qtyOldRecorded = Math.max(0, Number(r?.qtyOld) || 0);
    const untiered = Math.max(0, qty - qtyOldRecorded - qtyNew);
    const qtyOld = qtyOldRecorded + untiered; // untiered folds into Old, same assumption fabricDemandByDate uses
    if (!rawColour || colourKey(rawColour) === colourKey("(unassigned)")) {
      if (own) unassigned.push({ kind: ft.key, label: ft.label, unit: ft.unit, emoji: ft.emoji, qty: r2(qty) });
      return;
    }
    const ck = colourKey(rawColour);
    const mapKey = `${ft.key}|${ck}`;
    let entry = byKey.get(mapKey);
    if (!entry) {
      entry = { kind: ft.key, label: ft.label, unit: ft.unit, emoji: ft.emoji, stockKey: ft.stockKey, colour: rawColour, colourKey: ck, Q: 0, QO: 0, QN: 0, ownQ: 0, ownQO: 0, ownQN: 0, sharedWith: new Map() };
      byKey.set(mapKey, entry);
    }
    entry.Q += qty; entry.QO += qtyOld; entry.QN += qtyNew;
    if (own) { entry.ownQ += qty; entry.ownQO += qtyOld; entry.ownQN += qtyNew; }
    else {
      const cur = entry.sharedWith.get(tag.eoId) || { eoId: tag.eoId, client: tag.client, qty: 0 };
      cur.qty += qty;
      entry.sharedWith.set(tag.eoId, cur);
    }
  };
  FABRIC_TYPES.forEach((ft) => { (need?.[ft.key] || []).forEach((r) => fold(ft, r, true, null)); });
  (alsoOnDate || []).forEach((o) => { FABRIC_TYPES.forEach((ft) => { (o?.need?.[ft.key] || []).forEach((r) => fold(ft, r, false, { eoId: o.eoId, client: o.client })); }); });
  const lines = [];
  byKey.forEach((entry) => {
    const stockEntry = stockIdx?.[entry.kind]?.get(entry.colourKey);
    const stock = stockEntry || { old: 0, new: 0 };
    const { needOld, needNew } = tierDeficits({ Q: entry.Q, QO: entry.QO, QN: entry.QN }, stock);
    const buy = needOld + needNew;
    if (!(buy > 0)) return;
    lines.push({
      kind: entry.kind, label: entry.label, unit: entry.unit, emoji: entry.emoji, stockKey: entry.stockKey,
      colour: entry.colour, colourKey: entry.colourKey,
      qty: r2(entry.ownQ), qtyOld: r2(entry.ownQO), qtyNew: r2(entry.ownQN), pooledQty: r2(entry.Q),
      stockOld: r2(stock.old), stockNew: r2(stock.new),
      inStock: !!stockEntry, hiddenInBuild: !!stockEntry?.hiddenInBuild, photo: stockEntry?.photo || "", hex: stockEntry?.hex || "",
      needOld: r2(needOld), needNew: r2(needNew), buy: r2(buy),
      sharedWith: [...entry.sharedWith.values()].map((s) => ({ ...s, qty: r2(s.qty) })),
    });
  });
  lines.sort((a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (b.buy - a.buy));
  return { lines, unassigned };
}

// One event's own fabric-buy lines, pooled against every other live event on the SAME date (same shelf,
// same day - see fabricBuyLinesFromNeed's own `alsoOnDate` note). This is what IMS Dept Ops' per-event
// "Fabric to buy" card shows; it is NOT what Studio's Deal Check Buying tab shows (that calls
// fabricBuyLinesFromNeed directly with no `alsoOnDate`, since Studio has no visibility into other deals).
export function eventFabricBuyLines({ eo, eventOrders, needOf, stockIdx }) {
  if (!eo) return { lines: [], unassigned: [] };
  const d = eoDate(eo);
  const need = needOf(eo);
  const alsoOnDate = sameDayOrders({ eventOrders, date: d, exclId: eo.id }).map((o) => ({ eoId: o.id, client: o.clientName || "Event", need: needOf(o) }));
  return fabricBuyLinesFromNeed(need, stockIdx, { alsoOnDate });
}

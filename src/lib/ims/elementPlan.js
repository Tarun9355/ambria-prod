// Planning's plan for overlays and cushion covers. Sales names up to four designs for an element (lib/studio/elementPrefs); here the
// Fabric head sees each element's designs with what is actually free on the event date, and decides ONE design for the whole quantity.
// The decision is IMS-owned (deptOps.Fabric.itemChoice[key]), so every Studio sync leaves it alone. Same shape as the carpet plan
// (carpetPlan.js), minus everything about laying a carpet: nothing here stays down between events, so there is no same-venue reuse.

import { elementChoices, itemTakesChoices, partChoices } from "../studio/elementPrefs.js";
import { freeForEvent, validDecision } from "./carpetPlan.js";

const norm = (v) => String(v || "").trim().toLowerCase();

// One id per element with choices: function, zone, and the element's own stable id (pid) — its position in the zone can change.
export const elementKey = (fi, zk, pid) => `${fi}|${zk}|${pid}`;

// Every element of the event that has choices, from its saved layout (functionsDetail): zones that are switched on, quantity above zero.
// Two elements that somehow share a pid (one copied from the other) get distinct keys, the second as "<pid>~2", and so on.
export function choiceElementsOf(functionsDetail, zoneLabelOf) {
  const out = [];
  (Array.isArray(functionsDetail) ? functionsDetail : []).forEach((fn, i) => {
    const fi = fn?.fnIdx ?? i;
    const en = fn?.enabledEls || {};
    Object.entries(fn?.elements || {}).forEach(([zk, list]) => {
      if (!en[zk] || !Array.isArray(list)) return; // the same rule Build uses: only a zone that is switched on has anything to plan
      const seen = {};
      list.forEach((el, ei) => {
        const zoneName = typeof zoneLabelOf === "function" ? zoneLabelOf(fn, zk) : zk;
        const prefs = elementChoices(el);
        const qty = Number(el.qty) || 0;
        if (prefs.length >= 2 && el.pid && qty > 0) {
          seen[el.pid] = (seen[el.pid] || 0) + 1;
          const pid = seen[el.pid] > 1 ? `${el.pid}~${seen[el.pid]}` : String(el.pid);
          out.push({
            key: elementKey(fi, zk, pid), fi, zk, ei, pid, date: fn?.date || "", venue: fn?.venue || "",
            zoneName, fnLabel: fn?.type || fn?.name || "", name: el.name || prefs[0].name, qty, unit: el.unit || "", prefs,
          });
        }
        // The parts of a kit that name designs of their own (an overlay or a cushion cover inside a sofa kit): each is a choice to decide, for its
        // quantity per kit times the kits. Only the kit's own part list is read (kitOverrides), where Build saves them.
        if (qty > 0 && Array.isArray(el.kitOverrides)) {
          el.kitOverrides.forEach((c, part) => {
            const pp = partChoices(c);
            const partQty = (Number(c?.qty) || 0) * qty;
            if (pp.length < 2 || !c.pid || !(partQty > 0)) return;
            out.push({
              key: elementKey(fi, zk, "k:" + c.pid), fi, zk, ei, part, pid: "k:" + c.pid, date: fn?.date || "", venue: fn?.venue || "",
              zoneName, fnLabel: fn?.type || fn?.name || "", name: `${pp[0].name} (in ${el.name || "kit"})`, qty: partQty, unit: "", prefs: pp, kitName: el.name || "",
            });
          });
        }
      });
    });
  });
  return out;
}

// How many of each item the event's OTHER elements already use on a date: plain elements (no choices) by their item, and elements with
// choices by the design decided for them. An element whose design is not decided yet holds nothing here — until it is decided it could
// be any of its designs.
function useByDateItem(functionsDetail, rows, choice) {
  const use = []; // { date, id, qty, key|null }
  (Array.isArray(functionsDetail) ? functionsDetail : []).forEach((fn, i) => {
    const fi = fn?.fnIdx ?? i;
    const en = fn?.enabledEls || {};
    Object.entries(fn?.elements || {}).forEach(([zk, list]) => {
      if (!en[zk] || !Array.isArray(list)) return;
      list.forEach((el, ei) => {
        const qty = Number(el?.qty) || 0;
        if (!(qty > 0) || !el?.invId) return;
        // a kit's parts that carry choices count by the design decided for them (an undecided part holds nothing yet), like an element of their own
        if (Array.isArray(el?.kitOverrides)) {
          rows.filter((r) => r.fi === fi && r.zk === zk && r.ei === ei && r.part !== undefined).forEach((pr) => {
            const d = validDecision(choice?.[pr.key], pr);
            if (d?.id && (d.manual || pr.prefs.some((p) => p.id === String(d.id)))) use.push({ date: fn?.date || "", id: String(d.id), qty: pr.qty, key: pr.key });
          });
        }
        const row = rows.find((r) => r.fi === fi && r.zk === zk && r.ei === ei && r.part === undefined);
        if (row) {
          const d = validDecision(choice?.[row.key], row);
          // the same test planElements applies: one of the element's choices, or a hand pick
          if (d?.id && (d.manual || row.prefs.some((p) => p.id === String(d.id)))) use.push({ date: fn?.date || "", id: String(d.id), qty, key: row.key });
          return; // undecided or "arranged separately": holds no stock yet
        }
        use.push({ date: fn?.date || "", id: String(el.invId), qty, key: null });
      });
    });
  });
  return use;
}

// One design as the plan shows it on a given day: its free quantity net of what the event's other elements already use that day, and
// whether that covers the element's whole quantity.
const optionFor = (id, name, item, fallbackFree, blocks, date, eventId, qty, rank, othersUse) => {
  const raw = item ? freeForEvent(item, blocks, date, eventId) : (fallbackFree ?? null);
  const known = raw !== null && raw !== undefined;
  const free = known ? Math.max(0, raw - othersUse) : null;
  const enough = known && free >= qty;
  return { id, name: item?.name || name, rank, free, rawFree: raw, known, enough, short: known ? Math.max(0, qty - free) : null, item };
};

// Every design of the same kind in stock (overlays for an overlay, cushion covers for a cushion cover) with what is free for this
// element's date, those that cover it first — what Planning picks from when none of sales' choices is available that day.
export function elementStockFor(row, items, blocks, eventId, functionsDetail, rows, choice) {
  const first = (items || []).find((it) => it && String(it.id) === String(row.prefs[0]?.id));
  const sub = norm(first?.subCat || first?.subcategory);
  const use = useByDateItem(functionsDetail, rows, choice);
  const usedBy = (id) => use.filter((u) => u.date === row.date && u.id === String(id) && u.key !== row.key).reduce((s, u) => s + u.qty, 0);
  const out = (items || [])
    .filter((it) => it && sub && norm(it.subCat || it.subcategory) === sub && itemTakesChoices(it))
    .map((it) => optionFor(it.id, it.name, it, null, blocks, row.date, eventId, row.qty, null, usedBy(it.id)));
  return out.sort((a, b) => (Number(b.enough) - Number(a.enough)) || ((b.free ?? -1) - (a.free ?? -1)) || String(a.name).localeCompare(String(b.name)));
}

// The plan: for each element, its designs with free quantity on the day, which one is suggested (the highest-ranked that covers the
// whole quantity, else the one with most free), and which is decided. A decision for a design that is no longer one of the element's
// choices is ignored unless it was picked by hand (choice.manual).
// itemsById: { [id]: inventory item }, choice: { [key]: { id } }
export function planElements({ functionsDetail, zoneLabelOf, itemsById, blocks, eventId, choice }) {
  const base = choiceElementsOf(functionsDetail, zoneLabelOf);
  const use = useByDateItem(functionsDetail, base, choice);
  const usedBy = (id, date, key) => use.filter((u) => u.date === date && u.id === String(id) && u.key !== key).reduce((s, u) => s + u.qty, 0);
  const rows = base.map((f) => {
    const options = f.prefs.map((p, rank) => optionFor(p.id, p.name, itemsById?.[p.id], p.free, blocks, f.date, eventId, f.qty, rank, usedBy(p.id, f.date, f.key)));
    const firstEnough = options.find((o) => o.enough);
    const best = options.filter((o) => o.known).sort((a, b) => b.free - a.free || a.rank - b.rank)[0];
    const suggestedId = (firstEnough || best || options[0])?.id || null;
    const picked = validDecision(choice?.[f.key], f);
    const pickedId = picked?.id;
    // "Arranged separately": none of the designs in stock can be used, so the pieces are bought, hired or made outside stock. It still counts
    // as decided, so the element never blocks the PDF with nothing to choose.
    const other = !!picked?.other;
    const inOptions = !other && !!pickedId && options.some((o) => o.id === pickedId);
    const manual = !other && picked?.manual && pickedId && !inOptions
      ? optionFor(pickedId, picked.name, itemsById?.[pickedId], null, blocks, f.date, eventId, f.qty, null, usedBy(pickedId, f.date, f.key)) : null;
    // ── SALES' 1ST CHOICE IS THE DEFAULT ── (owner ask) Until Planning decides, the 1st choice counts as chosen — it is also
    // what the deal is priced on and holds. Not when it is short that day: a default that cannot be laid would read "decided" over
    // a real gap, so that row stays open for Planning. Stock not known yet is not a gap, so it defaults.
    const first = options[0];
    // "no decision" means no decision that APPLIES — one saved for a design that is no longer a choice (and not a hand pick) is
    // ignored above, and the default steps in for it just the same.
    const byDefault = !other && !inOptions && !manual && !!first && (first.enough || !first.known);
    const decidedId = inOptions ? pickedId : manual ? pickedId : byDefault ? first.id : null;
    return {
      ...f, options, manual, other, suggestedId, decidedId, byDefault,
      status: decidedId || other ? "decided" : firstEnough || !options.some((o) => o.known) ? "open" : "short",
    };
  });
  // Elements that decide the same design on the same date draw on one stock — together with the plain elements that use it. Flagged when
  // together they need more than is free that day.
  const over = {};
  const seen = new Set();
  rows.forEach((r) => {
    if (!r.decidedId) return;
    const gk = `${r.decidedId}|${r.date}`;
    if (seen.has(gk)) return;
    seen.add(gk);
    const o = [...r.options, r.manual].filter(Boolean).find((x) => x.id === r.decidedId);
    if (!o || o.rawFree === null || o.rawFree === undefined) return;
    const committed = use.filter((u) => u.date === r.date && u.id === String(r.decidedId)).reduce((s, u) => s + u.qty, 0);
    if (committed > o.rawFree && !over[r.decidedId]) over[r.decidedId] = { free: o.rawFree, committed, date: r.date };
  });
  return { rows, over };
}

// The preference side of the overlay / cushion cover lines: what sales ranked ("Preference: 1 A · 2 B"), or - in red - that sales named no alternatives.
// Only lines whose item can carry choices are looked at (itemTakesChoices); `itemsById` is a Map or a plain object. Lines of one item are counted together:
// the choices of the elements that use it cover that many pieces, and the rest has no preference. Production / buying lines are never matched.
export function preferenceNotesForRows(rows, planRows, itemsById) {
  const out = new Map();
  const itemOf = (id) => (itemsById instanceof Map ? itemsById.get(id) : itemsById?.[id]);
  const byInv = new Map();
  (rows || []).forEach((l) => {
    if (!l || l.prodOrBuy || l.invId == null || !itemTakesChoices(itemOf(l.invId))) return;
    const k = String(l.invId);
    if (!byInv.has(k)) byInv.set(k, []);
    byInv.get(k).push(l);
  });
  const planOf = new Map();
  (planRows || []).forEach((r) => {
    const k = String(r.prefs?.[0]?.id);
    if (!planOf.has(k)) planOf.set(k, []);
    planOf.get(k).push(r);
  });
  byInv.forEach((lines, k) => {
    const plan = planOf.get(k) || [];
    if (!plan.length) { lines.forEach((l) => out.set(l.id, { notes: [{ text: "Not selected preference", tone: "missing" }] })); return; }
    const notes = [];
    const seen = new Set();
    plan.forEach((r) => {
      const text = "Preference: " + (r.prefs || []).map((p, i) => `${i + 1} ${p.name}`).join(" · ");
      if (!seen.has(text)) { seen.add(text); notes.push({ text, tone: "pref" }); }
    });
    const have = lines.reduce((s, l) => s + (Number(l.rentalQty ?? l.qty) || 0), 0);
    const rest = have - plan.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    if (rest > 0) notes.push({ text: `${rest} not selected preference`, tone: "missing" });
    out.set(lines[0].id, { notes });
  });
  return out;
}

// What the Inventory blocked list says about the lines that have choices. The list is Deal Check's snapshot, so a line is filed under sales' 1st design;
// once Planning decides, the card shows what is actually going out. `rows` are the list's lines ({ id, invId, name, photo, qty, rentalQty, prodOrBuy }),
// `planRows` come from planElements. Returns Map<line id, { name, photo, notes: [{ text, tone: "ok" | "wait" }] }> - `name` and `photo` only when the
// decided design replaces the whole line (one decision, covering all of its quantity), else the decisions are told in notes and the line is left as it is.
export function choiceNotesForRows(rows, planRows) {
  const out = new Map();
  const lineOf = (firstId) => (rows || []).find((x) => x && !x.prodOrBuy && x.invId != null && String(x.invId) === String(firstId));
  const photoOf = (it) => (Array.isArray(it?.photoUrls) && it.photoUrls[0]) || it?.img || "";
  const byLine = new Map();
  (planRows || []).forEach((r) => {
    const line = lineOf(r.prefs?.[0]?.id);
    if (!line) return;
    if (!byLine.has(line.id)) byLine.set(line.id, { line, plan: [] });
    byLine.get(line.id).plan.push(r);
  });
  byLine.forEach(({ line, plan }) => {
    const firstName = String(line.name || plan[0].prefs[0].name || "").trim();
    const notes = [];
    let swap = null;
    plan.forEach((r) => {
      const dec = r.decidedId ? [...(r.options || []), r.manual].filter(Boolean).find((o) => String(o.id) === String(r.decidedId)) : null;
      if (r.other) notes.push({ text: `${r.qty} arranged separately - not from stock`, tone: "ok" });
      else if (dec && String(dec.id) !== String(r.prefs[0].id)) {
        notes.push({ text: `${r.qty} × ${dec.name} chosen in Planning (sales' 1st choice: ${firstName})`, tone: "ok" });
        if (plan.length === 1 && r.qty >= (Number(line.rentalQty ?? line.qty) || 0)) swap = { name: dec.name, photo: photoOf(dec.item) };
      } else if (dec && r.byDefault) notes.push({ text: `${r.qty} × ${dec.name} - sales' 1st choice (default, not changed in Planning)`, tone: "ok" });
      else if (dec) notes.push({ text: `${r.qty} × ${dec.name} confirmed in Planning`, tone: "ok" });
      else notes.push({ text: `${r.qty} not decided yet: ${(r.options || []).map((o, i) => `${i + 1} ${o.name}`).join(" · ")}`, tone: "wait" });
    });
    out.set(line.id, { ...(swap ? { name: swap.name, photo: swap.photo } : {}), notes: swap ? [{ text: `Chosen in Planning - sales' 1st choice was ${firstName}`, tone: "ok" }] : notes });
  });
  return out;
}

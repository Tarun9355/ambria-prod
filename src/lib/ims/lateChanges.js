// ── CHANGED IN THE 48 HOURS BEFORE THE EVENT ── (owner ask 2026-11-27, revised 2026-11-28) for Planning's Inventory
// blocked tile/section AND Deal Check's P&L tab (deptActual, via lateChargesByDept below) - the SAME figure in both
// places, so they can never disagree.
//
// One running count per (function, item name), read oldest-log-first within the 48-hour window:
//  - peak = the most that item ever held at any point in the window (the first log's `from`, and every later `from`/`to`);
//  - now  = the newest log's `to` (what the plan holds right now).
//  - Billed qty = peak - now, at the item's rate (a kit bills at `kitBase` only - its parts are logged and billed on
//    their own lines, so billing the kit's own full price too would double them).
// This ONE rule covers every case without special-casing:
//  - a plain removal (peak 4, now 0 → bills 4, same as before this change);
//  - a quantity cut (100 → 60 → bills the 40 cut off, owner ask 2026-11-28);
//  - an item swapped out for another (owner ask 2026-11-28: the swapped-OUT item still bills its own rental on top of
//    the swapped-in one, which is already in the current plan/planned cost - this is a deliberate exception to "the
//    plan's current pick is free", because the stock behind the dropped item was already committed too);
//  - putting something back cancels an earlier reduction of the SAME item in the SAME function (peak ends up equal
//    to now → bills nothing) - a swap-out can only be cancelled by that same item coming back in the same function,
//    never by an unrelated removal elsewhere.
// `swaps` (Map(new item name -> { fromName, at, by })) stays separate and display-only - IMS tags a swapped-in line
// with it; it was never billed and still isn't.
// Two kinds of log line are skipped outright, never billed:
//  - a whole request logged by "System (stock re-count)" - a kit part newly/no-longer counted because the
//    reservation now walks kit parts, nobody touched the deal (see StudioApp.jsx's own recountByDept comment);
//  - an item carrying `kitOf` - a kit's own part, copied into another department's log purely so that department
//    hears about the change; the SAME part is already logged (and billed) under its own plain name elsewhere.
export function lateChangesOf({ sel, dept, amendRequests, inventory, hours = 48 }) {
  const out = { swaps: new Map(), charges: [] };
  if (!sel) return out;
  const dates = [...(Array.isArray(sel.functionsDetail) ? sel.functionsDetail : []).map((f) => String(f?.date || "").slice(0, 10)), String(sel.date || "").slice(0, 10)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dates.length) return out;
  const from = Date.parse(dates[0] + "T00:00:00") - hours * 3600 * 1000;
  const STOCK_RECOUNT_BY = "System (stock re-count)"; // StudioApp's kit-part re-count log - nobody changed the deal
  const low = (s) => String(s || "").trim().toLowerCase();
  const num = (v) => Number(v) || 0;
  const invByName = new Map((inventory || []).map((x) => [low(x?.name), x]));
  // A kit bills at its own base only - its parts are logged and billed on their own lines (IMS saves a kit's price as kitBase + its parts' own prices).
  const rateOf = (it) => !it ? 0 : (Array.isArray(it.subItems) && it.subItems.length ? num(it.kitBase) : num(it.price ?? it.rentalCost));

  const led = new Map(); // "fn|name" -> { name, fn, peak, now, cut }
  const step = (name, fn, f, t, meta) => {
    if (!name) return;
    const k = `${fn || ""}|${low(name)}`;
    let e = led.get(k);
    if (!e) { e = { name, fn: fn || "", peak: f, now: f, cut: null }; led.set(k, e); }
    e.peak = Math.max(e.peak, f, t);
    e.now = t;
    if (t < f) e.cut = meta; // the newest step that took some out names the line (removed/cut/swapped)
  };

  (amendRequests || [])
    .filter((r) => r && r.eventOrderId === sel.id && r.department === dept && r.status === "logged"
      && Number(r.requestedAt) >= from && r.requestedBy !== STOCK_RECOUNT_BY)
    .sort((a, b) => (Number(a.requestedAt) || 0) - (Number(b.requestedAt) || 0)) // oldest first - the running count needs chronological order
    .forEach((r) => {
      const by = r.requestedBy || "", at = Number(r.requestedAt) || 0;
      const items = (Array.isArray(r.items) ? r.items : []).filter((it) => it && !it.kitOf); // kitOf = a kit part's copy into another dept's log, billed on its own plain-named line already

      // A swap out of `outName` into `inName`: the new item follows the ordinary plan (no charge of its own here),
      // the old one is billed like a removal (owner ask 2026-11-28) unless it comes back later in this function.
      const swapOut = (outName, outQty, inName, fn) => {
        out.swaps.set(inName, { fromName: outName || "", at, by }); // oldest-first processing + overwrite = the newest switch wins, same as before
        step(outName, fn, outQty, 0, { kind: "swapped", swappedFor: inName, at, by });
      };

      items.filter((it) => it.change === "swapped").forEach((it) => {
        swapOut(it.fromName, num(it.from), it.name, it.fn);
        step(it.name, it.fn, 0, num(it.to ?? it.qty), null);
      });

      // No separate "one added + one removed in this request = an implicit swap" inference here: every
      // amend request this function is ever handed ("logged" status) was already built by
      // StudioApp.jsx's makeAmendRequest, which runs pairSwaps on its raw items BEFORE saving - a real
      // swap (same function, same sub-category) therefore always already arrives tagged change:"swapped"
      // above. A plain "removed" and "added" sitting in the same request with no such tag is exactly what
      // pairSwaps itself decided NOT to treat as one switch (different sub-categories) - inferring a swap
      // from the bare count of "exactly one of each" mislabeled that unrelated pair "Swapped out → X" with
      // no actual relationship between the two items (regression review follow-up, 2026-11-28, finding #4).
      // Each is simply its own removal/addition/cut below.
      const added = items.filter((it) => it.change === "added");
      const removed = items.filter((it) => it.change === "removed");

      [...added, ...removed, ...items.filter((it) => it.change === "qty_changed")].forEach((it) => {
        const f = num(it.from ?? (it.change === "added" ? 0 : it.qty));
        const t = num(it.to ?? (it.change === "removed" ? 0 : it.qty));
        step(it.name, it.fn, f, t, { kind: t === 0 ? "removed" : "cut", at, by });
      });
    });

  led.forEach((e) => {
    const qty = e.peak - e.now;
    if (!(qty > 0) || !e.cut) return;
    const item = invByName.get(low(e.name));
    const rate = rateOf(item);
    out.charges.push({
      kind: e.now > 0 ? "cut" : e.cut.kind, // some of it is still in the plan - always "cut", whatever reduced it last
      name: e.name, fn: e.fn, qty, from: e.peak, to: e.now, rate, total: Math.round(rate * qty),
      photo: item ? (item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "") : "",
      at: e.cut.at, by: e.cut.by, swappedFor: e.cut.swappedFor || "",
    });
  });
  out.charges.sort((a, b) => b.at - a.at);
  return out;
}

// Per department, what was removed, cut or swapped out in the `hours` before the event and still costs its rental
// (lateChangesOf's own `charges`) - Deal Check's P&L adds this to each department's actual rental; IMS Planning's
// Inventory blocked tile/section read the exact same number via lateChangesOf directly. One pass picks out this
// event's own logged rows first; with none (most events) it returns without pricing anything per department.
export function lateChargesByDept({ sel, depts, amendRequests, inventory, hours = 48 }) {
  const out = {};
  if (!sel?.id) return out;
  const mine = (amendRequests || []).filter((r) => r && r.eventOrderId === sel.id && r.status === "logged");
  if (!mine.length) return out;
  (depts || []).forEach((d) => {
    const rows = lateChangesOf({ sel, dept: d, amendRequests: mine, inventory, hours }).charges;
    if (rows.length) out[d] = { rows, total: rows.reduce((s, r) => s + (Number(r.total) || 0), 0) };
  });
  return out;
}

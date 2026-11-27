import { useEffect, useMemo, useRef, useState } from "react";
import { truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks, tripsOf, trucksForFn, tripFnOf, fnLabelOf } from "../../lib/ims/eventTrucks";
import { FLAG_REASONS, receivingOf, lineReceipt, setItemReceiptPatch, clearItemReceiptPatch, setTransferReceiptPatch } from "../../lib/ims/receiving";
import { catToDept as sharedCatToDept, DEPTS } from "../../lib/ims/deptClassify";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { actualsLockState } from "../../lib/ims/actualsLock";
import { hasTabPerm } from "../../lib/ims/tabAccess";
import useFixedVenueSettings from "../../lib/ims/useFixedVenueSettings";
import { atVenueOfEvent } from "../../lib/ims/atVenue";
import { buildFabricGroups, fabricStandingOf } from "../../lib/ims/fabricGroups";
import { platformPullPlansByFn, PLATFORM_MATERIAL_LABEL } from "../../lib/ims/platformEngine";
import { scopeLineToFn, qtyMapsOfFn } from "../../lib/ims/siteFunctionScope";
import { isStandingPart } from "../../lib/repeatGuard.js";
import { makeEventPlans } from "../../lib/ims/eventPlans";
import { buildLiveFloralPlan } from "../../lib/ims/liveFloralPlan";
import { truckKeyOf, mappedStockRowsOf, blockedGroupedFor, blockedFlatFor, loadSplitOf, mergeLegacyTrucks, tripChallanRows, mergeAtVenueRows } from "../../lib/ims/deptLoadList";
import { choiceNotesForRows } from "../../lib/ims/elementPlan";
import { carpetNotesForRows } from "../../lib/ims/carpetPlan";
import FabricBlock from "./FabricBlock.jsx";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// A figure as the supervisor counts it: in pieces for a line made of one piece size (Platform 8x4 - kept in sqft underneath, as the truck
// loads it), else in the line's own unit. A part piece shows one decimal (51 sqft of 32 sqft pieces = 1.6 pc).
const qtyText = (q, line) => {
  const per = Number(line?.perPiece) || 0;
  if (per > 0) return `${Math.round(((Number(q) || 0) / per) * 10) / 10} pc`;
  return `${r2(q)}${line?.unit ? ` ${line.unit}` : ""}`;
};

// The "how many arrived" box: what is typed stays in the box until Enter or leaving it, then saves once (owner's QA audit
// 2026-11-26: clearing the box saved "no figure" and snapped back to the planned one, so backspacing 10 and typing 3 gave 103,
// and every keystroke wrote the whole event). Empty on leaving = back to the expected figure.
// Saves only what this person actually typed (a re-test finding: focusing the box and leaving it without typing saved the old figure
// over a newer one that had come in meanwhile - another supervisor's receipt, or a trip dispatched). Escape cancels, never saves.
function GotBox({ value, onCommit, className }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const editing = useRef(false);
  const dirty = useRef(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value ?? "")); }, [value]);
  const commit = () => {
    editing.current = false;
    const typed = dirty.current, cancelled = cancel.current;
    dirty.current = false; cancel.current = false;
    if (cancelled || !typed) { setDraft(String(value ?? "")); return; }
    const v = draft.trim();
    if (v === String(value ?? "")) return;
    onCommit(v === "" ? null : Math.max(0, Number(v) || 0));
  };
  return (
    <input type="number" min="0" inputMode="numeric" value={draft} aria-label="Pieces arrived"
      onFocus={() => { editing.current = true; dirty.current = false; cancel.current = false; }}
      onChange={(e) => { dirty.current = true; setDraft(e.target.value); }} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }}
      className={className} />
  );
}

const TRIP_LABEL = { loading: "Loading", dispatched: "Dispatched", "at-site": "At site", returned: "Returned" };

const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };

// Receiving, as a flat list of ITEMS (owner ask 2026-11-24: a supervisor checking something in
// thinks "where's my X", not "what's on truck 3") — each row carries its own truck/driver inline, with
// a one-tap call, instead of the old truck-grouped accordion cards. Per-item confirm/flag replaces the
// old whole-truck "Arrived as planned" button entirely — that one used to mark every department on a
// truck arrived in a single tap, which a dept head filtering to their own department could trigger by
// accident for departments they'd never actually looked at.
export default function SiteReceivingPanel({ sel, setEventOrders, inventory, eventOrders, authUser, mode, settings, trussInv, blocks = {}, rcItems = [], rateCardCategories = [] }) {
  const [flaggingKey, setFlaggingKey] = useState(null); // `${truckId}|${dept}|${key}` currently showing its issue panel
  // "all" (default) or one department — a supervisor checking in a truck usually cares about every
  // department on it, but a dept head who only wants to confirm THEIR OWN pieces arrived (owner ask
  // 2026-11-24) needs to cut the noise of every other department's lines on the same shared truck.
  const [deptFilter, setDeptFilter] = useState("all");
  // One function of the booking, or all (owner ask 2026-11-27: function-wise like Planning - one client at Exotica on the 27th and
  // Pushpanjali on the 28th). Held per event, so opening another event starts at All.
  const [fnPick, setFnPick] = useState({ id: null, fi: "all" });
  const fnsOfSel = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
  const fnSel = fnPick.id === sel?.id && fnPick.fi !== "all" && fnsOfSel[fnPick.fi] ? fnPick.fi : "all";
  // ── WHAT SHOULD COME: THE VERY LIST PLANNING LOADS FROM ── (owner's QA audit 2026-11-26)
  // Each department's to-load list is built by lib/ims/deptLoadList - the code Dept Ops itself runs (Deal Check's department
  // snapshot: kits as shell + this department's parts, recipe parts, Floral's mapped artificial items worked out live, Fabric
  // folded per colour, platform / carpet / print / truss lines, less what stands at the venue) - and keyed by the same truck keys.
  // It used to be worked out here from Studio's functions list instead, which disagreed with Planning in many ways (summed
  // functions where Planning loads the peak, kits within kits, platform lines missing, mapped items "need 0", a kit part counted
  // twice, the wrong department chip).
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);
  const fvSettings = useFixedVenueSettings(settings);
  const atVenueOf = useMemo(() => atVenueOfEvent(sel, fvSettings, inventory, eventOrders), [sel, fvSettings, inventory, eventOrders]);
  const liveFloral = useMemo(() => {
    if (!sel) return null;
    try { return buildLiveFloralPlan(sel.functionsDetail, { settings: settings || {}, rcItems, rateCardCategories, inventory }); } catch { return null; }
  }, [sel, settings, rcItems, rateCardCategories, inventory]);
  const plans = useMemo(() => {
   // fi: null = the whole event, else one function (its own needs, its own venue's standing stock, its own fabric / platform parts)
   const build = (fi) => {
    const fd = fi == null ? null : (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail[fi] : null);
    const fnMaps = fd ? qtyMapsOfFn(fd, inventory) : null;
    // keeps .repeatBacked, which loadSplitOf reads for Repeat platform / carpet floors (review 2026-11-27)
    const atVenueUse = fd?.venue ? Object.assign((it) => atVenueOf({ ...it, venue: fd.venue }), { repeatBacked: atVenueOf.repeatBacked }) : atVenueOf;
    const need = new Map(); // `${dept}|${truckKey}` -> { dept, key, qty, label, photo, unit, invId }
    let atVenue = [];
    const flatByDept = new Map();
    let fabricGroups = [];
    let fabricGroupsAll = [];
    if (!sel) return { need, atVenue, fabricGroups, trucks: [], flatByDept };
    let pl = null;
    try { pl = makeEventPlans({ sel, inventory, blocks, eventOrders, settings, trussInv }); } catch (e) { console.error("[site-receiving] plans:", e); }
    // Planning's Fabric block (Liza / Velvet / Wall Masking, colour photo, total, zones) - shown on top, no money.
    try {
      const fnsF = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
      const fabArgs = { entries: pl ? pl.fabricEntriesOf() : [], lines: Array.isArray(sel?.deptInventory?.Fabric) ? sel.deptInventory.Fabric : [],
        fabricPlan: sel?.fabricPlan, stock: trussInv, multiFn: fnsF.length > 1, fnPalettes: pl ? pl.fabricPalettesOf() : null };
      fabricGroupsAll = buildFabricGroups(fabArgs).groups;
      fabricGroups = fd ? buildFabricGroups({ ...fabArgs, onlyFi: fi }).groups : fabricGroupsAll;
    } catch (e) { console.error("[site-receiving] fabric groups:", e); }
    let mapped = [];
    try { mapped = mappedStockRowsOf(liveFloral, sel, inventory); } catch { /* no live floral plan: none */ }
    const deptsHere = [...new Set([...DEPTS, ...Object.keys(sel?.deptInventory || {})])];
    deptsHere.forEach((d) => {
      try {
        const grouped = blockedGroupedFor(d, { sel, inventory, blocks, catToDept, mappedStockRows: mapped });
        if (!grouped.length) return;
        const flat = blockedFlatFor(grouped, d, { sel, trussInv, fabricEntriesOf: pl?.fabricEntriesOf, fabricPalettesOf: pl?.fabricPalettesOf });
        flatByDept.set(d, flat);
        // one function: its share of each line; a line no function can be tied to is the whole event's and shows in every function, as
        // on Planning's trips (never left out of every function's view)
        const ctxOf = (f2, j) => ({ fd: f2, fi: j, inventory, blocks, eventId: sel.id, fabricGroups: fabricGroupsAll, floralDetail: sel?.floralDetail, maps: j === fi ? fnMaps : qtyMapsOfFn(f2, inventory) });
        const fnsAll = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
        const flatUse = fd ? flat.map((it) => scopeLineToFn(it, ctxOf(fd, fi)) || (fnsAll.some((f2, j) => j !== fi && scopeLineToFn(it, ctxOf(f2, j))) ? null : { ...it, anyFn: true })).filter(Boolean) : flat;
        const { load, atVenue: av } = loadSplitOf(flatUse, atVenueUse);
        // The design Planning chose for an overlay / cushion cover (Fabric) or a carpet floor (Tenting) - what is actually on the
        // truck - with the line's notes ("not decided yet ..."), as Planning's truck list and challan name it (owner's QA audit
        // 2026-11-26: Site still named sales' 1st choice).
        let choice = new Map();
        try {
          if (pl && d === "Fabric") choice = choiceNotesForRows(flat, pl.elementPlanOf().rows);
          else if (pl && d === "Tenting") choice = carpetNotesForRows(flat, pl.carpetPlanOf().rows);
        } catch { /* no plan for the choices: the line's own name */ }
        // Platform: the pieces to pull, as Planning's Inventory blocked list shows them (owner report 2026-11-27: Planning shows pieces, the
        // Site page only sqft). The line itself stays in sqft - trucks load it as one line - and the pieces are a note under it.
        const piecesOf = (it) => {
          if (!trussInv || !/^platform structure/i.test(String(it.sub || "").trim()) || !Array.isArray(it.parts)) return null;
          try {
            const by = new Map();
            platformPullPlansByFn(it.parts.filter((p) => !isStandingPart(p, atVenueOf.repeatBacked)), trussInv).forEach(({ plan }) => (plan?.pieces || []).forEach((p) => {
              const k = `${p.label}|${p.material}|${p.thicknessIn ?? ""}`;
              const cur = by.get(k) || { ...p, qty: 0 }; cur.qty += p.qty; by.set(k, cur);
            }));
            const list = [...by.values()].filter((p) => p.qty > 0);
            if (!list.length) return null;
            const sizes = [...new Set(list.map((p) => Number(p.sqftPerPiece) || 0))];
            return {
              text: list.map((p) => `${p.qty} pc ${p.label} ${PLATFORM_MATERIAL_LABEL[p.material] || p.material || ""}${p.thicknessIn ? ` ${p.thicknessIn}″` : ""}`.trim()).join(" · "),
              // one piece size: the line can be read in pieces (owner ask 2026-11-27: "need 4 pcs, not 128 sqft") - the truck still loads sqft
              perPiece: sizes.length === 1 && sizes[0] > 0 ? sizes[0] : null,
            };
          } catch { return null; }
        };
        load.forEach((it) => {
          const key = truckKeyOf(it);
          const pcs = piecesOf(it);
          const id = d + "|" + key;
          const cv = choice.get(it.id);
          const fresh = !need.has(id);
          const c = need.get(id) || { dept: d, key, qty: 0, label: cv?.name || it.name, photo: cv?.name ? (cv.photo || "") : (it.photo || ""), unit: it.qtyUnit || "", invId: it.invId || null,
            perPiece: pcs?.perPiece || null,
            notes: [...(cv?.notes || []).map((n) => n.text).filter(Boolean), ...(it.blockedOnly ? ["Blocked for this event in Inventory - not in Deal Check's list"] : []), ...(pcs?.text ? [`Pieces: ${pcs.text}`] : []), ...(it.anyFn ? ["not tied to one function - the whole event's"] : [])] };
          // the same line from another function: pieces only while every part is the same piece size
          if (!fresh && c.perPiece !== (pcs?.perPiece || null)) c.perPiece = null;
          c.qty += Number(it.qty) || 0;
          need.set(id, c);
        });
        av.forEach(({ it, a }) => atVenue.push({ dept: d, key: truckKeyOf(it), label: it.name, photo: it.photo || "", qty: Number(it.fullQty ?? it.qty) || 0, unit: it.qtyUnit || "", a }));
      } catch (e) { console.error("[site-receiving] dept list", d, e); }
    });
    // ♻ Repeat zones' fabric (Liza / curtains / masking) is already standing at the venue: listed there, and its need line says how much
    // more is there besides what comes on the trucks (owner ask 2026-11-26: show the exact extra to bring)
    try {
      const standing = fabricStandingOf(fabricGroups);
      standing.forEach((s) => {
        atVenue.push({ dept: "Fabric", key: `fabric:${s.key}:repeat:${s.colour}`, label: s.label, photo: s.photo, qty: s.qty, unit: s.unit, a: { repeat: true, fixed: 0, foc: false, load: 0 } });
      });
      // per fabric and per colour: a colour line gets only its own colour's standing fabric; the no-colour line gets the fabric's whole
      const ck = (c) => String(c || "").trim().replace(/\s+/g, " ").toLowerCase();
      const repeatOf = (key, colour) => r2(standing.filter((s) => s.key === key && (colour == null || ck(s.colour) === ck(colour))).reduce((t, s) => t + s.qty, 0));
      need.forEach((n) => {
        if (n.dept !== "Fabric" || n.invId || !String(n.key).startsWith("nm:")) return;
        const label = String(n.label || "");
        const g = (fabricGroups || []).find((x) => label === x.label || label.startsWith(x.label + " - "));
        if (!g) return;
        const colour = label === g.label ? null : label.slice(g.label.length + 3);
        const rq = repeatOf(g.key, colour);
        if (rq > 0) n.notes = [...(n.notes || []), `Only the extra to bring - ${rq} ${g.unit} more already at the venue (♻ Repeat zones)`];
      });
    } catch (e) { console.error("[site-receiving] repeat fabric:", e); }
    // one row per item: the same item in several kits stood once each in the list (mergeAtVenueRows)
    atVenue = mergeAtVenueRows(atVenue);
    atVenue.sort((x, y) => String(x.label || "").localeCompare(String(y.label || "")));
    // the trucks as Planning reads them: the shared list with any department's older per-department trucks folded in
    let trucks = Array.isArray(sel.trucks) ? sel.trucks : [];
    try { trucks = mergeLegacyTrucks(sel, (d) => flatByDept.get(d) || []); } catch (e) { console.error("[site-receiving] legacy trucks:", e); }
    return { need, atVenue, fabricGroups, trucks, flatByDept };
   };
   const all = build(null);
   return { all, fn: fnSel === "all" ? null : build(fnSel) };
  }, [sel, inventory, blocks, eventOrders, settings, trussInv, liveFloral, atVenueOf, fnSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = plans.fn || plans.all;
  const planAll = plans.all;
  const fabricGroups = plan.fabricGroups;

  // one function picked: only the trips going to it (and trips with no destination set)
  const trucksShown = trucksForFn(plan.trucks, fnSel);
  const manifest = truckManifest(sel ? { ...sel, trucks: trucksShown } : sel, inventory);
  const transfers = incomingTransfersFor(eventOrders, sel?.id);
  const receiving = receivingOf(sel);
  // Flattened — every line carries its OWN truck back-reference, so the list is items-first; a
  // truck with nothing loaded contributes no rows to this (nothing to show "about" an empty truck
  // in an items list). allLines is the UNFILTERED flat list — used below for the top-level empty
  // check, which must still fire for an event whose only trucks are empty ones (regression review,
  // 2026-11-24: the old check read the grouped `manifest`, which still counts an empty truck as one
  // entry, so the panel rendered a blank page instead of either empty-state message).
  const allLines = manifest.flatMap(({ truck, lines }) => lines.map((ln) => ({ ...ln, truck })));
  // what has gone out for each `${dept}|${key}` on any truck, plus same-day reuse arriving from another event
  const loadedByKey = new Map();
  allLines.forEach((ln) => { const id = ln.dept + "|" + ln.key; loadedByKey.set(id, (loadedByKey.get(id) || 0) + Number(ln.planned || 0) + Number(ln.extra || 0)); });
  // Same-day reuse from another event never rides on one of THIS event's trucks - counted as arriving for its item.
  // Matched to the need line it covers: its own department and key, else the first need line with that inventory id in any
  // department or kit (a re-test finding: a kit part "inv:X@kit", or an item the other event filed elsewhere, never matched).
  transfers.forEach((t) => {
    if (!t.invId) return;
    let id = (t.fromDept || "") + "|inv:" + t.invId;
    if (!plan.need.has(id)) {
      const hit = [...plan.need.values()].find((n) => n.invId && String(n.invId) === String(t.invId));
      if (hit) id = hit.dept + "|" + hit.key;
    }
    loadedByKey.set(id, (loadedByKey.get(id) || 0) + (Number(t.qty) || 0));
  });
  const needOf = (dept, key) => plan.need.get(dept + "|" + key) || null;
  const atVenueRows = plan.atVenue;
  // In Planning's list but on no truck yet: its own "Not loaded" row - every kind of line (platform, carpet, print, recipe parts too).
  const missingItems = [...plan.need.values()].filter((n) => !(loadedByKey.get(n.dept + "|" + n.key) > 0))
    .map((n) => ({ invId: n.dept + "|" + n.key, qty: n.qty, unit: n.unit, perPiece: n.perPiece || null, dept: n.dept, label: n.label, photo: n.photo, notes: n.notes || [] }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")) || String(a.dept || "").localeCompare(String(b.dept || "")));

  const allDepts = [...new Set([...manifest.flatMap((m) => m.lines.map((l) => l.dept)), ...transfers.map((t) => t.fromDept), ...missingItems.map((m) => m.dept), ...atVenueRows.map((r) => r.dept)])].filter(Boolean).sort();
  // Falls back to "all" the instant the picked department doesn't exist on THIS event (switching to
  // a different event in the picker above doesn't remount this panel, so a stale filter from the
  // last event — one this event may not even have — would otherwise hide every item here with no
  // obvious reason why, same for a department's last line simply being removed while looking at it).
  const activeFilter = deptFilter === "all" || allDepts.includes(deptFilter) ? deptFilter : "all";
  const flatLines = allLines
    .filter((ln) => activeFilter === "all" || ln.dept === activeFilter)
    .filter((ln) => !plans.fn || plan.need.has(ln.dept + "|" + ln.key) || !planAll.need.has(ln.dept + "|" + ln.key))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")) || String(a.dept || "").localeCompare(String(b.dept || "")));
  const visibleTransfers = activeFilter === "all" ? transfers : transfers.filter((t) => t.fromDept === activeFilter);
  const visibleMissing = missingItems.filter((m) => activeFilter === "all" || m.dept === activeFilter);
  const visibleAtVenue = atVenueRows.filter((r) => activeFilter === "all" || r.dept === activeFilter);
  // Post-event actuals lock (lib/ims/actualsLock.js) — every write this panel makes is a receiving
  // actual, so once locked the whole panel is read-only.
  const lock = actualsLockState(sel, settings);

  // Build each patch from the freshest row INSIDE the updater (`e`, not the render-time `sel`) —
  // two supervisors (or a supervisor and a dept head's unrelated write) landing close together
  // must not let the later write silently revert the earlier one. Also re-checks the lock against
  // that same freshest row, so a realtime reopen/lock landing between render and this click is
  // honoured immediately rather than the render-time `lock` above.
  // Edit Access/per-user override, Admin → Users & Roles → Site tab — a standing permission,
  // separate from the actuals lock above (that's time-based and locks everyone equally once a
  // booking's done; this applies regardless of time).
  const canSiteEdit = hasTabPerm(authUser, settings, "ims", "site", "edit");
  const canSiteDel = hasTabPerm(authUser, settings, "ims", "site", "del");
  const write = (build) => setEventOrders((prev) => prev.map((e) => {
    if (e.id !== sel.id) return e;
    if (!canSiteEdit) return e;
    if (actualsLockState(e, settings).locked) return e;
    return { ...e, receiving: build(e) };
  }));
  const setLine = (truckId, dept, key, patch) => write((e) => setItemReceiptPatch(e, truckId, dept, key, patch, authUser?.name));
  const clearLine = (truckId, dept, key) => { if (!canSiteDel) return; write((e) => clearItemReceiptPatch(e, truckId, dept, key, authUser?.name)); };

  const flagKeyOf = (truckId, ln) => `${truckId}|${ln.dept}|${ln.key}`;
  // Only gates WRITE controls (confirm/flag/edit) — view-only things (reading a flag's reason) stay
  // usable on a locked event.
  const canEdit = mode === "actual" && !lock.locked && canSiteEdit;

  // Truck numbers as Planning gives them (sorted by the number in the id, else list order), so "Truck 2" is the same truck on both pages
  const truckNum = (() => { const nOf = (id) => { const n = Number(String(id || "").replace(/^trk_/, "")); return Number.isFinite(n) ? n : 0; }; return new Map([...plan.trucks].sort((x, y) => nOf(x.id) - nOf(y.id)).map((t, i) => [t.id, i + 1])); })();
  // A trip's combined challan in a new window, as Planning prints it (item, department, qty), with the design Planning chose.
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const printChallan = (truck, trip, n, tripN, rows, toLabel = "") => {
    const w = window.open("", "_blank");
    if (!w) return;
    const body = rows.map((it) => {
      const name = planAll.need.get(it.dept + "|" + it.key)?.label || it.name;
      return `<tr><td>${esc(name)}${it.added ? ' <span style="font-size:11px;color:#92400e">(added, not in Build)</span>' : ""}</td><td>${esc(it.dept)}</td><td style="text-align:center">${it.qty}${it.extra ? ` + ${it.extra} extra` : ""}</td></tr>`;
    }).join("");
    const when = (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).map((f) => [f?.date, f?.venue].filter(Boolean).join(" · ")).filter(Boolean).join(" + ") || sel?.date || "-";
    w.document.write(`<html><head><title>Combined Challan — Truck ${n} · Trip ${tripN}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f3f4f6;text-align:left}h2{color:#4f46e5;margin-bottom:2px}h4{margin:14px 0 0}@media print{button{display:none}}</style></head><body>
      <h2>🚚 Ambria — Combined Challan · Truck ${n} · Trip ${tripN}</h2>
      <p>Event: ${esc(sel?.clientName || "-")} &nbsp;|&nbsp; ${esc(when)}</p>
      <p>Vehicle: ${esc(truck.vehicle || "______")} &nbsp;|&nbsp; Driver: ${esc(truck.driver || "______")} &nbsp;|&nbsp; Phone: ${esc(truck.phone || "______")}</p>
      ${toLabel ? `<p><b>Goes to: ${esc(toLabel)}</b></p>` : ""}
      <h4>Inventory on this trip — every department</h4>
      <table><tr><th>Item</th><th>Dept</th><th>Qty</th></tr>${body || '<tr><td colspan="3" style="text-align:center;color:#999">No items assigned to this trip</td></tr>'}</table>
      <br><p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };

  if (allLines.length === 0 && transfers.length === 0 && missingItems.length === 0 && atVenueRows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
        {hasUnmigratedLegacyTrucks(sel)
          ? "This event's trucks haven't moved to the shared truck list yet — ask the dept head to open Planning → Dept Ops once (loading them re-saves the list) so they show up here."
          : "Nothing loaded on a truck for this event yet."}
      </div>
    );
  }
  // One merged, sorted list — a loaded truck line and a never-loaded item sort together by label/dept
  // instead of living in two separate sections (owner ask 2026-11-25: no dedicated "not loaded"
  // pill/section, show it in the list itself).
  const combinedRows = [
    ...flatLines.map((ln) => ({ kind: "line", label: ln.label, dept: ln.dept, ln })),
    ...visibleMissing.map((m) => ({ kind: "missing", label: m.label, dept: m.dept, m })),
    // Two-key compare (label, then dept), matching flatLines'/missingItems' own sort above — a
    // single joined "label|dept" string sorts differently under ICU collation (regression review,
    // 2026-11-25: e.g. "Chair" vs "Chair Cover" can interleave wrongly against the joined form).
  ].sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")) || String(a.dept || "").localeCompare(String(b.dept || "")));

  return (
    <div className="space-y-3">
      {lock.locked && (
        <div className="rounded-xl bg-gray-800 text-white px-4 py-2.5 text-xs font-semibold flex items-center gap-2">
          🔒 Actuals locked for this event — an admin can reopen it above to make changes.
        </div>
      )}
      {mode === "actual" && !lock.locked && !canSiteEdit && (
        <div className="rounded-xl bg-gray-100 text-gray-500 px-4 py-2.5 text-xs font-semibold flex items-center gap-2">
          👁 View only — your access to Site doesn't include editing
        </div>
      )}
      {/* A ♻ Repeat with nothing set up at its venue just before is loaded like a new item (lib/repeatGuard) - said so, so sales can fix the Build */}
      {(atVenueOf.repeatWithoutSetup || []).length > 0 && (
        <div role="alert" className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] text-amber-900">
          <b>{"Repeat with nothing set up here before:"}</b>{" "}
          {atVenueOf.repeatWithoutSetup.map((u) => [fnsOfSel[u.fi]?.type, u.venue, u.date].filter(Boolean).join(" · ")).join(", ")}
          {" - "}{"its items are listed to bring. Ask sales to check the Repeat chips in Build."}
        </div>
      )}
      {/* One function, like Planning's chips: its own items, its own venue's standing stock, its own fabric and platform */}
      {fnsOfSel.length > 1 && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" onClick={() => setFnPick({ id: sel.id, fi: "all" })} aria-pressed={fnSel === "all"}
              className={"text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors " + (fnSel === "all" ? "bg-blue-600 text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
              {"All functions"}
            </button>
            {fnsOfSel.map((f, i) => (
              <button key={i} type="button" onClick={() => setFnPick({ id: sel.id, fi: i })} aria-pressed={fnSel === i}
                className={"text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors " + (fnSel === i ? "bg-blue-600 text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
                {[f?.type || `Function ${i + 1}`, f?.venue, String(f?.date || "").slice(0, 10)].filter(Boolean).join(" · ")}
              </button>
            ))}
          </div>
          {fnSel !== "all" && (
            <div className="text-[11px] text-gray-500">{"Showing this function's items and the trips going to it. A trip with no destination set in Planning counts for every function."}</div>
          )}
        </div>
      )}
      {allDepts.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setDeptFilter("all")}
            className={"text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors " + (activeFilter === "all" ? "bg-gray-900 text-white border-transparent" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
            All departments
          </button>
          {allDepts.map((d) => (
            <button key={d} onClick={() => setDeptFilter(d)}
              className={"text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors " + (activeFilter === d ? "bg-gray-900 text-white border-transparent" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
              {DEPT_ICON[d] || ""} {d}
            </button>
          ))}
        </div>
      )}
      {/* Only when a department IS actually picked — "all" showing zero items means this event
          genuinely has nothing to receive yet, and the panel's own top-level empty state (manifest
          and transfers both empty) already covers that; this message must never replace the
          transfers list below when an event has transfers but no trucks at all. */}
      {activeFilter !== "all" && combinedRows.length === 0 && visibleTransfers.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
          Nothing for {activeFilter} for this event yet.
        </div>
      )}
      {fabricGroups.length > 0 && (activeFilter === "all" || activeFilter === "Fabric") && (
        <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
            <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🧵</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-gray-900">Fabric</div>
              <div className="text-xs text-gray-500 truncate">Liza, velvet and masking - tap one for its colours and zones</div>
            </div>
          </div>
          <div className="p-2.5">
            <FabricBlock groups={fabricGroups} fnDates={(Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).map((f) => String(f?.date || "").slice(0, 10))} />
          </div>
        </div>
      )}

      {/* One raised card holding every item, rows split by hairlines - the Planning Receiving card's look (owner ask 2026-11-25),
          instead of a floating card per item. Its head says what it is and how many items are still short. */}
      {combinedRows.length > 0 && (() => {
        const shortIds = new Set();
        combinedRows.forEach((row) => {
          if (row.kind === "missing") { shortIds.add("m|" + row.m.invId); return; }
          const nd = needOf(row.ln.dept, row.ln.key);
          if (nd && nd.qty > (loadedByKey.get(row.ln.dept + "|" + row.ln.key) || 0)) shortIds.add(row.ln.dept + "|" + row.ln.key);
        });
        const nShort = shortIds.size;
        // what the supervisor found on arrival: a line received short or flagged (the plan can be fully sourced and still arrive short)
        const nIssues = combinedRows.filter((row) => {
          if (row.kind !== "line") return false;
          const ln = row.ln, r = lineReceipt(receiving.trucks[ln.truck.id], ln.dept, ln.key);
          const gone = Math.max(0, ln.planned + ln.extra - (Number(ln.loadingQty) || 0));
          const expected = (Number(ln.arrivedQty) || 0) > 0 ? Number(ln.arrivedQty) : gone;
          return !!r.flag || (r.got != null && expected > 0 && Number(r.got) < expected);
        }).length;
        return (
      <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
          <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">📥</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-gray-900">Receiving</div>
            <div className="text-xs text-gray-500 truncate">Who&apos;s bringing what, on which truck</div>
          </div>
          <span className="shrink-0 flex flex-col items-end gap-1">
            <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (nShort > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
              {nShort > 0 ? `⚠️ ${nShort} short` : "✓ all sourced"}
            </span>
            {nIssues > 0 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-600 text-white tabular-nums"><span>⚑ {nIssues}</span> <span>{"arrival issues"}</span></span>}
          </span>
        </div>
        <div className="divide-y divide-gray-100">
      {combinedRows.map((row) => {
        // What Studio's build needs that's never gone out on ANY truck at all (owner ask
        // 2026-11-25), merged directly into the same list every loaded item renders in — not a
        // separate toggle/section (owner ask 2026-11-25, follow-up: "show me in the list itself").
        if (row.kind === "missing") {
          const m = row.m;
          return (
            <div key={"missing|" + m.invId} className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                {m.photo ? <img src={thumbUrl(m.photo, 40)} loading="lazy" alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-sm shrink-0">📦</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-gray-900 truncate flex items-center gap-1.5 flex-wrap">
                    {m.label}
                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Not loaded</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10.5px]">
                    <span className="font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[m.dept] || ""} {m.dept}</span>
                    <span className="text-gray-500">No truck assigned yet.</span>
                  </div>
                  {m.notes?.length > 0 && <div className="mt-1 text-[11px] text-gray-500 leading-snug">{m.notes.join(" · ")}</div>}
                </div>
              </div>
              <div className="mt-2 ml-[50px]">
                <span className="inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 tabular-nums">
                  need {qtyText(m.qty, m)} · arriving {qtyText(0, m)} · short {qtyText(m.qty, m)}
                </span>
              </div>
            </div>
          );
        }
        const ln = row.ln;
        const r = lineReceipt(receiving.trucks[ln.truck.id], ln.dept, ln.key);
        // What has left so far: a trip still "Loading" has not gone (owner's QA audit 2026-11-26: those pieces read as arriving and
        // a tick marked them received). Receipts stay one per truck line, against what has gone.
        const loadingQty = Number(ln.loadingQty) || 0;
        const gone = Math.max(0, ln.planned + ln.extra - loadingQty);
        // Receipts are one per truck line, so a truck's second trip still on its way must not make the first trip's receipt "short"
        // (a re-test finding): once any trip is marked At site / Returned, a receipt is weighed against what has reached the site.
        const arrivedQty = Number(ln.arrivedQty) || 0;
        const expected = arrivedQty > 0 ? arrivedQty : gone;
        const onTheWay = arrivedQty > 0 ? Math.max(0, gone - arrivedQty) : 0;
        const got = r.got != null ? r.got : gone;
        const short = mode === "actual" && expected > 0 && Number(got) < expected;
        // Also true from the OLD whole-truck "Arrived as planned" button, which only ever stamped
        // receiving.trucks[id].confirmedAt and never wrote a per-item `got` at all — without this,
        // every item on an already-confirmed truck reads as freshly "Not arrived" the moment this
        // panel switched from a per-truck to a per-item status (regression review, 2026-11-24).
        const confirmed = gone > 0 && !r.flag && !short && (r.got != null || !!receiving.trucks[ln.truck.id]?.confirmedAt);
        const fk = flagKeyOf(ln.truck.id, ln);
        const showIssue = canEdit && (flaggingKey === fk || !!r.flag);
        // Against what Studio's build NEEDS overall (not what's on THIS line/truck) — same figure a
        // multi-truck split of the same item shows on every one of its lines, matching how the
        // merged "missing" rows above state it (owner ask 2026-11-25: "for each item, even it is
        // loaded or not loaded" — so a line loaded beyond/outside what Studio's build asked for
        // still gets a "need 0" row, not silence). Only skipped for a custom/named truck line with
        // no inventory id at all — there's no Studio quantity to compare it against.
        // a fabric line (Liza / Velvet / Masking by colour) is weighed against the fabric plan instead
        // weighed against the same line in Planning's to-load list (same department, same truck key)
        const nd = needOf(ln.dept, ln.key);
        const need = nd ? nd.qty : null;
        const arriving = loadedByKey.get(ln.dept + "|" + ln.key) || 0;
        const allCustom = ln.customQty > 0 && ln.customQty >= ln.planned + ln.extra;
        return (
          <div key={ln.truck.id + "|" + ln.dept + "|" + ln.key} className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              {(nd?.photo || ln.photo) ? <img src={thumbUrl(nd?.photo || ln.photo, 40)} loading="lazy" alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-sm shrink-0">📦</div>}
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-gray-900 truncate flex items-center gap-1.5 flex-wrap">
                  {nd?.label || ln.label}
                  {r.flag
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">⚑ {FLAG_REASONS.find((f) => f.key === r.flag)?.label || "Flagged"}</span>
                    : short
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">Short — {qtyText(got, nd?.perPiece ? nd : null)} of {qtyText(expected, nd?.perPiece ? nd : null)}</span>
                    : confirmed
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Confirmed OK</span>
                    : gone === 0
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{"Still loading"}</span>
                    : <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Not arrived</span>}
                  {onTheWay > 0 && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 tabular-nums"><span>{nd?.perPiece ? qtyText(onTheWay, nd) : onTheWay}</span> <span>{"on the way"}</span></span>}
                  {gone > 0 && loadingQty > 0 && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 tabular-nums"><span>{nd?.perPiece ? qtyText(loadingQty, nd) : loadingQty}</span> <span>{"still loading"}</span></span>}
                </div>
                {/* Dept badge, which truck/driver it's riding on, and a one-tap call — the whole reason
                    this is a flat items list instead of a truck-grouped accordion (owner ask
                    2026-11-24): "where's my item" answered without opening anything first. */}
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10.5px]">
                  <span className="font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[ln.dept] || ""} {ln.dept}</span>
                  <span className="text-gray-500">🚛 {ln.truck.vehicle || ln.truck.driver ? [ln.truck.vehicle, ln.truck.driver].filter(Boolean).join(" · ") : "No vehicle assigned yet"}</span>
                  {ln.truck.phone && (
                    <a href={`tel:${ln.truck.phone}`} className="font-semibold text-blue-600 hover:underline">📞 Call{ln.truck.driver ? ` ${ln.truck.driver}` : ""}</a>
                  )}
                </div>
                {/* Planning's note on a chosen design (overlay / cushion / carpet): which one was chosen, or that it is not decided yet */}
                {nd?.notes?.length > 0 && <div className="mt-1 text-[11px] text-gray-500 leading-snug">{nd.notes.join(" · ")}</div>}
                {/* added on the truck at dispatch ("Add an item not in this deal") - not in the build, so there is no need to weigh it
                    against: said plainly instead of "need 0" (owner report 2026-11-26) */}
                {ln.customQty > 0 && (
                  <div className="mt-1.5">
                    <span className="inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 tabular-nums">
                      {/* "not in the deal" only when it truly is not: the whole line was added on the truck and the build needs none of it.
                          An item the deal has, with some pieces added on the truck on top, says how many extra (a number and a fixed
                          phrase as separate pieces, so the Hindi screen finds the phrase). */}
                      {need == null && allCustom
                        ? "Added on truck · not in the deal"
                        : <><span>+{ln.customQty}</span> <span>{"extra, added on truck"}</span></>}
                    </span>
                  </div>
                )}
                {/* On a truck but not in Planning's list any more (the item was swapped out, a kit renamed, moved to another
                    department after it was loaded): said so in amber - never shown as arrived and fine. */}
                {need == null && !allCustom && (
                  <div className="mt-1.5">
                    <span className="inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">{"Not in Planning's list now — loaded before a change"}</span>
                  </div>
                )}
                {need != null && (
                  <div className="mt-1.5">
                    <span className={"inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full tabular-nums " + (Math.max(0, need - arriving) > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                      need {qtyText(need, nd)} · arriving {qtyText(arriving, nd)} · short {qtyText(Math.max(0, need - arriving), nd)}
                    </span>
                  </div>
                )}
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <GotBox value={nd?.perPiece && got != null ? Math.round((Number(got) / nd.perPiece) * 10) / 10 : got}
                    onCommit={(v) => setLine(ln.truck.id, ln.dept, ln.key, { got: v != null && nd?.perPiece ? Math.round(v * nd.perPiece * 100) / 100 : v, flag: r.flag, note: r.note })}
                    className={"w-14 h-8 rounded-lg text-center text-[12.5px] font-bold tabular-nums ring-1 focus:outline-none focus:ring-2 " + (short || r.flag ? "bg-red-50 ring-red-200 text-red-700" : "bg-gray-50 ring-gray-200 text-gray-800")} />
                  {/* One-tap "it's exactly what was planned" — the per-item replacement for the old
                      whole-truck "Arrived as planned" button, now scoped to just this line. Hidden on
                      an already-flagged line (!r.flag) — clearing a flag is a DELETE-permission action
                      elsewhere in this panel ("Clear this flag" below is gated on canSiteDel); this
                      button must never be a back door around that for someone with edit-only access
                      (regression review, 2026-11-24). */}
                  {!confirmed && !r.flag && gone > 0 && (
                    <button onClick={() => setLine(ln.truck.id, ln.dept, ln.key, { got: gone, flag: null, note: r.note })} title="Arrived as planned"
                      className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100">✓</button>
                  )}
                  <button onClick={() => setFlaggingKey(showIssue ? null : fk)}
                    className={"h-8 px-2.5 rounded-lg text-[11px] font-semibold " + (r.flag ? "bg-red-50 text-red-700" : "bg-white ring-1 ring-gray-200 text-gray-500 hover:bg-gray-50")}>
                    {r.flag ? "⚑ Flagged" : "⚑ Flag"}
                  </button>
                </div>
              ) : (
                // Locked: the final actual, read-only — not the planned figure, the real one.
                <div className="text-[12.5px] font-bold tabular-nums shrink-0 text-right">
                  <div className={short || r.flag ? "text-red-700" : "text-gray-800"}>{got}</div>
                </div>
              )}
            </div>
            {showIssue && (
              <div className="mt-2 ml-[50px] bg-red-50 rounded-lg p-2.5">
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {FLAG_REASONS.map((fr) => (
                    <button key={fr.key} onClick={() => setLine(ln.truck.id, ln.dept, ln.key, { got: fr.key === "missing" ? 0 : got, flag: fr.key, note: r.note })}
                      className={"text-[11px] font-semibold px-2.5 py-1 rounded-full border " + (r.flag === fr.key ? "bg-red-600 text-white border-transparent" : "bg-white text-gray-500 border-gray-200")}>
                      {fr.label}
                    </button>
                  ))}
                </div>
                <input defaultValue={r.note || ""} onBlur={(e) => setLine(ln.truck.id, ln.dept, ln.key, { got, flag: r.flag, note: e.target.value })}
                  placeholder="Note for the dept head" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11.5px]" />
                {r.flag && canSiteDel && (
                  <button onClick={() => { clearLine(ln.truck.id, ln.dept, ln.key); setFlaggingKey(null); }} className="mt-1.5 text-[10.5px] font-semibold text-gray-400 hover:text-gray-700">Clear this flag</button>
                )}
              </div>
            )}
            {!canEdit && mode === "actual" && !!r.flag && r.note && (
              <div className="mt-1.5 ml-[50px] text-[11px] text-gray-500 italic">"{r.note}"</div>
            )}
          </div>
        );
      })}
        </div>
      </div>
        );
      })()}

      {/* ── ALREADY AT THE VENUE · NOT LOADED ── the Planning list's twin: fixed stock standing there, or set to ♻ Repeat in Build.
          Shown so the supervisor knows they are there, not counted short; a partly standing item says how many stand. */}
      {visibleAtVenue.length > 0 && (
        <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
            <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">📌</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-gray-900">Already at the venue · not loaded</div>
              <div className="text-xs text-gray-500 truncate">Fixed stock standing there, set to Repeat in the build, or FOC</div>
            </div>
            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 tabular-nums">{visibleAtVenue.length}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleAtVenue.map((r) => (
              <div key={"av|" + r.dept + "|" + r.key} className="px-4 py-3 flex items-center gap-2.5">
                {r.photo ? <img src={thumbUrl(r.photo, 40)} loading="lazy" alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-sm shrink-0">📦</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-gray-900 truncate">{r.label}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10.5px]">
                    <span className="font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[r.dept] || ""} {r.dept}</span>
                    <span className="text-gray-500 tabular-nums">
                      {(() => { const q = r.unit ? `${r.qty} ${r.unit}` : r.qty; return r.a.foc ? `all ${q} FOC - left at the venue` : r.a.repeat ? `all ${q} stay from before` : r.a.repeatPart > 0 ? `${r.a.repeatPart} of ${q} stay from before (♻ Repeat) · ${r.a.load} on a truck` : r.a.load > 0 ? `${r.a.fixed} of ${q} standing here · ${r.a.load} on a truck` : `all ${q} standing here`; })()}
                    </span>
                  </div>
                </div>
                <span className={"shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded " + (r.a.foc || r.a.repeat || r.a.repeatPart > 0 ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700")}>{r.a.foc ? "🎁 FOC" : r.a.repeat || r.a.repeatPart > 0 ? "♻ REPEAT" : "📌 FIXED"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TRUCKS & CHALLANS ── every truck and trip on the event, with its combined challan (every department's items on that
          run) to print - the same rows Planning's challan prints (lib/ims/deptLoadList tripChallanRows), the chosen design's name. */}
      {trucksShown.length > 0 && (
        <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
            <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🚛</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-gray-900">{"Trucks & challans"}</div>
              <div className="text-xs text-gray-500 truncate">{"Each trip's challan - every department's items on it"}</div>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {trucksShown.map((t, ti) => tripsOf(t).map((tr) => {
              const rows = tripChallanRows(tr, (d) => plan.flatByDept.get(d) || []);
              const st = tr.status || "loading";
              // the trip's own number on its truck (a picked function shows only some trips), and where it goes
              const allTrips = tripsOf(plan.trucks.find((x) => x.id === t.id) || t);
              const tripN = allTrips.findIndex((x) => x.id === tr.id) + 1;
              const fnTo = tripFnOf(tr);
              const toLabel = fnTo != null && fnsOfSel[fnTo] ? fnLabelOf(fnsOfSel[fnTo], fnTo) : "";
              return (
                <div key={t.id + "|" + tr.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-gray-900 truncate">
                      <span>{"Truck"} {truckNum.get(t.id) || ti + 1}</span>{allTrips.length > 1 && <span className="text-gray-500 font-medium"> · <span>{"Trip"}</span> {tripN}</span>}
                      <span className="ml-1.5 text-gray-500 font-medium tabular-nums">{[t.vehicle, t.driver].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                      <span className={"font-bold px-1.5 py-0.5 rounded-full " + (st === "loading" ? "bg-amber-50 text-amber-700" : st === "returned" ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-700")}>{TRIP_LABEL[st] || st}</span>
                      <span className="text-gray-500 tabular-nums">{rows.length} <span>{"items"}</span></span>
                      {toLabel && <span className="text-blue-700 font-semibold truncate">→ {toLabel}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => printChallan(t, tr, truckNum.get(t.id) || ti + 1, tripN, rows, toLabel)} disabled={!rows.length}
                    className="shrink-0 h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
                    {"Print challan"}
                  </button>
                </div>
              );
            }))}
          </div>
        </div>
      )}

      {visibleTransfers.length > 0 && (
        <div className="bg-sky-50 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700 mb-2">Not tied to a truck — reused from another site</div>
          <div className="space-y-1.5">
            {visibleTransfers.map((t, i) => {
              // received like a truck line (owner's QA audit 2026-11-26: they could only be read): how many came, a tick, or a flag
              const tid = t.id || ("tr" + i);
              const tr = receiving.transfers?.[tid] || {};
              const tGot = tr.got != null ? tr.got : (Number(t.qty) || 0);
              const tShort = tr.got != null && Number(tr.got) < (Number(t.qty) || 0);
              const setT = (patch) => write((e) => setTransferReceiptPatch(e, tid, { got: tr.got, flag: tr.flag, note: tr.note, ...patch }, authUser?.name));
              return (
                <div key={tid} className="flex items-center gap-2 flex-wrap text-[12px] text-sky-900">
                  <span className="min-w-0 flex-1">↪️ <b>{t.name}</b> ×{t.qty} from {t.fromEvent} ({t.fromDept}){t.vehicle || t.driver ? ` · ${[t.vehicle, t.driver].filter(Boolean).join(" · ")}` : ""}
                    {tr.flag ? <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">⚑ {FLAG_REASONS.find((f) => f.key === tr.flag)?.label || "Flagged"}</span>
                      : tShort ? <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">Short — {tr.got} of {t.qty}</span>
                      : tr.got != null ? <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Confirmed OK</span> : null}
                  </span>
                  {canEdit && (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <GotBox value={tGot} onCommit={(v) => setT({ got: v })}
                        className={"w-14 h-8 rounded-lg text-center text-[12.5px] font-bold tabular-nums ring-1 focus:outline-none focus:ring-2 " + (tShort || tr.flag ? "bg-red-50 ring-red-200 text-red-700" : "bg-white ring-sky-200 text-gray-800")} />
                      {tr.got == null && !tr.flag && <button onClick={() => setT({ got: Number(t.qty) || 0, flag: null })} title="Arrived as planned" className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100">✓</button>}
                      <select value={tr.flag || ""} onChange={(e) => { const f = e.target.value; if (!f && !canSiteDel) return; setT({ flag: f || null, ...(f === "missing" ? { got: 0 } : {}) }); }} aria-label="Flag"
                        className="h-8 rounded-lg bg-white ring-1 ring-sky-200 px-1.5 text-[11px] font-semibold text-gray-600">
                        <option value="">⚑ Flag</option>
                        {FLAG_REASONS.map((fr) => <option key={fr.key} value={fr.key}>{fr.label}</option>)}
                      </select>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

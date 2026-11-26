import { useMemo, useState } from "react";
import { truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks } from "../../lib/ims/eventTrucks";
import { FLAG_REASONS, receivingOf, lineReceipt, setItemReceiptPatch, clearItemReceiptPatch } from "../../lib/ims/receiving";
import { catToDept as sharedCatToDept, DEPTS } from "../../lib/ims/deptClassify";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { actualsLockState } from "../../lib/ims/actualsLock";
import { hasTabPerm } from "../../lib/ims/tabAccess";
import useFixedVenueSettings from "../../lib/ims/useFixedVenueSettings";
import { atVenueOfEvent } from "../../lib/ims/atVenue";
import { buildFabricGroups } from "../../lib/ims/fabricGroups";
import { makeEventPlans } from "../../lib/ims/eventPlans";
import { buildLiveFloralPlan } from "../../lib/ims/liveFloralPlan";
import { truckKeyOf, mappedStockRowsOf, blockedGroupedFor, blockedFlatFor, loadSplitOf } from "../../lib/ims/deptLoadList";
import FabricBlock from "./FabricBlock.jsx";

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
  const atVenueOf = useMemo(() => atVenueOfEvent(sel, fvSettings, inventory), [sel, fvSettings, inventory]);
  const liveFloral = useMemo(() => {
    if (!sel) return null;
    try { return buildLiveFloralPlan(sel.functionsDetail, { settings: settings || {}, rcItems, rateCardCategories, inventory }); } catch { return null; }
  }, [sel, settings, rcItems, rateCardCategories, inventory]);
  const plan = useMemo(() => {
    const need = new Map(); // `${dept}|${truckKey}` -> { dept, key, qty, label, photo, unit, invId }
    const atVenue = [];
    let fabricGroups = [];
    if (!sel) return { need, atVenue, fabricGroups };
    let pl = null;
    try { pl = makeEventPlans({ sel, inventory, blocks: {}, eventOrders, settings, trussInv }); } catch (e) { console.error("[site-receiving] plans:", e); }
    // Planning's Fabric block (Liza / Velvet / Wall Masking, colour photo, total, zones) - shown on top, no money.
    try {
      const fnsF = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
      fabricGroups = buildFabricGroups({ entries: pl ? pl.fabricEntriesOf() : [], lines: Array.isArray(sel?.deptInventory?.Fabric) ? sel.deptInventory.Fabric : [],
        fabricPlan: sel?.fabricPlan, stock: trussInv, multiFn: fnsF.length > 1, fnPalettes: pl ? pl.fabricPalettesOf() : null }).groups;
    } catch (e) { console.error("[site-receiving] fabric groups:", e); }
    let mapped = [];
    try { mapped = mappedStockRowsOf(liveFloral, sel, inventory); } catch { /* no live floral plan: none */ }
    const deptsHere = [...new Set([...DEPTS, ...Object.keys(sel?.deptInventory || {})])];
    deptsHere.forEach((d) => {
      try {
        const grouped = blockedGroupedFor(d, { sel, inventory, blocks, catToDept, mappedStockRows: mapped });
        if (!grouped.length) return;
        const flat = blockedFlatFor(grouped, d, { sel, trussInv, fabricEntriesOf: pl?.fabricEntriesOf, fabricPalettesOf: pl?.fabricPalettesOf });
        const { load, atVenue: av } = loadSplitOf(flat, atVenueOf);
        load.forEach((it) => {
          const key = truckKeyOf(it);
          const id = d + "|" + key;
          const c = need.get(id) || { dept: d, key, qty: 0, label: it.name, photo: it.photo || "", unit: it.qtyUnit || "", invId: it.invId || null };
          c.qty += Number(it.qty) || 0;
          need.set(id, c);
        });
        av.forEach(({ it, a }) => atVenue.push({ dept: d, key: truckKeyOf(it), label: it.name, photo: it.photo || "", qty: Number(it.fullQty ?? it.qty) || 0, unit: it.qtyUnit || "", a }));
      } catch (e) { console.error("[site-receiving] dept list", d, e); }
    });
    atVenue.sort((x, y) => String(x.label || "").localeCompare(String(y.label || "")));
    return { need, atVenue, fabricGroups };
  }, [sel, inventory, blocks, eventOrders, settings, trussInv, liveFloral, atVenueOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const fabricGroups = plan.fabricGroups;

  const manifest = truckManifest(sel, inventory);
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
  transfers.forEach((t) => { if (t.invId) { const id = (t.fromDept || "") + "|inv:" + t.invId; loadedByKey.set(id, (loadedByKey.get(id) || 0) + (Number(t.qty) || 0)); } });
  const needOf = (dept, key) => plan.need.get(dept + "|" + key) || null;
  const atVenueRows = plan.atVenue;
  // In Planning's list but on no truck yet: its own "Not loaded" row - every kind of line (platform, carpet, print, recipe parts too).
  const missingItems = [...plan.need.values()].filter((n) => !(loadedByKey.get(n.dept + "|" + n.key) > 0))
    .map((n) => ({ invId: n.dept + "|" + n.key, qty: n.qty, unit: n.unit, dept: n.dept, label: n.label, photo: n.photo }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")) || String(a.dept || "").localeCompare(String(b.dept || "")));

  const allDepts = [...new Set([...manifest.flatMap((m) => m.lines.map((l) => l.dept)), ...transfers.map((t) => t.fromDept), ...missingItems.map((m) => m.dept), ...atVenueRows.map((r) => r.dept)])].filter(Boolean).sort();
  // Falls back to "all" the instant the picked department doesn't exist on THIS event (switching to
  // a different event in the picker above doesn't remount this panel, so a stale filter from the
  // last event — one this event may not even have — would otherwise hide every item here with no
  // obvious reason why, same for a department's last line simply being removed while looking at it).
  const activeFilter = deptFilter === "all" || allDepts.includes(deptFilter) ? deptFilter : "all";
  const flatLines = allLines
    .filter((ln) => activeFilter === "all" || ln.dept === activeFilter)
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
        return (
      <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 flex items-center gap-3">
          <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">📥</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-gray-900">Receiving</div>
            <div className="text-xs text-gray-500 truncate">Who&apos;s bringing what, on which truck</div>
          </div>
          <span className={"shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full " + (nShort > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
            {nShort > 0 ? `⚠️ ${nShort} short` : "✓ all sourced"}
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
                </div>
              </div>
              <div className="mt-2 ml-[50px]">
                <span className="inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 tabular-nums">
                  need {Math.round(m.qty * 100) / 100}{m.unit ? ` ${m.unit}` : ""} · arriving 0 · short {Math.round(m.qty * 100) / 100}{m.unit ? ` ${m.unit}` : ""}
                </span>
              </div>
            </div>
          );
        }
        const ln = row.ln;
        const r = lineReceipt(receiving.trucks[ln.truck.id], ln.dept, ln.key);
        const got = r.got != null ? r.got : (ln.planned + ln.extra);
        const short = mode === "actual" && Number(got) < ln.planned + ln.extra;
        // Also true from the OLD whole-truck "Arrived as planned" button, which only ever stamped
        // receiving.trucks[id].confirmedAt and never wrote a per-item `got` at all — without this,
        // every item on an already-confirmed truck reads as freshly "Not arrived" the moment this
        // panel switched from a per-truck to a per-item status (regression review, 2026-11-24).
        const confirmed = !r.flag && !short && (r.got != null || !!receiving.trucks[ln.truck.id]?.confirmedAt);
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
        const unitTxt = nd?.unit ? ` ${nd.unit}` : "";
        const allCustom = ln.customQty > 0 && ln.customQty >= ln.planned + ln.extra;
        return (
          <div key={ln.truck.id + "|" + ln.dept + "|" + ln.key} className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              {ln.photo ? <img src={thumbUrl(ln.photo, 40)} loading="lazy" alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-sm shrink-0">📦</div>}
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-gray-900 truncate flex items-center gap-1.5 flex-wrap">
                  {ln.label}
                  {r.flag
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">⚑ {FLAG_REASONS.find((f) => f.key === r.flag)?.label || "Flagged"}</span>
                    : short
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">Short — {got} of {ln.planned + ln.extra}</span>
                    : confirmed
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Confirmed OK</span>
                    : <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Not arrived</span>}
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
                      need {Math.round(need * 100) / 100}{unitTxt} · arriving {Math.round(arriving * 100) / 100}{unitTxt} · short {Math.round(Math.max(0, need - arriving) * 100) / 100}{unitTxt}
                    </span>
                  </div>
                )}
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <input type="number" min="0" value={got} onChange={(e) => { const v = e.target.value; setLine(ln.truck.id, ln.dept, ln.key, { got: v === "" ? null : v, flag: r.flag, note: r.note }); }}
                    className={"w-14 h-8 rounded-lg text-center text-[12.5px] font-bold tabular-nums ring-1 focus:outline-none focus:ring-2 " + (short || r.flag ? "bg-red-50 ring-red-200 text-red-700" : "bg-gray-50 ring-gray-200 text-gray-800")} />
                  {/* One-tap "it's exactly what was planned" — the per-item replacement for the old
                      whole-truck "Arrived as planned" button, now scoped to just this line. Hidden on
                      an already-flagged line (!r.flag) — clearing a flag is a DELETE-permission action
                      elsewhere in this panel ("Clear this flag" below is gated on canSiteDel); this
                      button must never be a back door around that for someone with edit-only access
                      (regression review, 2026-11-24). */}
                  {!confirmed && !r.flag && (
                    <button onClick={() => setLine(ln.truck.id, ln.dept, ln.key, { got: ln.planned + ln.extra, flag: null, note: r.note })} title="Arrived as planned"
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
                      {r.a.foc ? `all ${r.qty} FOC - left at the venue` : r.a.repeat ? `all ${r.qty} stay from before` : r.a.load > 0 ? `${r.a.fixed} of ${r.qty} standing here · ${r.a.load} on a truck` : `all ${r.qty} standing here`}
                    </span>
                  </div>
                </div>
                <span className={"shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded " + (r.a.foc || r.a.repeat ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700")}>{r.a.foc ? "🎁 FOC" : r.a.repeat ? "♻ REPEAT" : "📌 FIXED"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {visibleTransfers.length > 0 && (
        <div className="bg-sky-50 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700 mb-2">Not tied to a truck — reused from another site</div>
          <div className="space-y-1.5">
            {visibleTransfers.map((t, i) => (
              <div key={i} className="text-[12px] text-sky-900">↪️ <b>{t.name}</b> ×{t.qty} from {t.fromEvent} ({t.fromDept}){t.vehicle || t.driver ? ` · ${[t.vehicle, t.driver].filter(Boolean).join(" · ")}` : ""}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

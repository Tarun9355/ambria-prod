import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks, labelForLoadKey } from "../../lib/ims/eventTrucks";
import { FLAG_REASONS, receivingOf, lineReceipt, setItemReceiptPatch, clearItemReceiptPatch } from "../../lib/ims/receiving";
import { catToDept } from "../../lib/ims/deptClassify";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { actualsLockState } from "../../lib/ims/actualsLock";
import { hasTabPerm } from "../../lib/ims/tabAccess";
import useFixedVenueSettings from "../../lib/ims/useFixedVenueSettings";
import { atVenueOfEvent } from "../../lib/ims/atVenue";

const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };

// Receiving, as a flat list of ITEMS (owner ask 2026-11-24: a supervisor checking something in
// thinks "where's my X", not "what's on truck 3") — each row carries its own truck/driver inline, with
// a one-tap call, instead of the old truck-grouped accordion cards. Per-item confirm/flag replaces the
// old whole-truck "Arrived as planned" button entirely — that one used to mark every department on a
// truck arrived in a single tap, which a dept head filtering to their own department could trigger by
// accident for departments they'd never actually looked at.
export default function SiteReceivingPanel({ sel, setEventOrders, inventory, eventOrders, authUser, mode, settings }) {
  const [flaggingKey, setFlaggingKey] = useState(null); // `${truckId}|${dept}|${key}` currently showing its issue panel
  // "all" (default) or one department — a supervisor checking in a truck usually cares about every
  // department on it, but a dept head who only wants to confirm THEIR OWN pieces arrived (owner ask
  // 2026-11-24) needs to cut the noise of every other department's lines on the same shared truck.
  const [deptFilter, setDeptFilter] = useState("all");
  // The `functions` table's own `data.items` (per function, invId+qty, FOC items already split into
  // a separate `focItems` array by Studio's own reconcile — see StudioApp.jsx's reconcileSoldInventoryBlocks
  // — so nothing here needs to re-exclude them) is the same flat, kit-walked quantity list Studio
  // keeps resynced for this exact event, independent of DepartmentOpsTab's own much heavier live
  // Deal-Check recompute — reusing it here needs no new sync path, just a read.
  const [fnItems, setFnItems] = useState([]);
  // Fixed stock standing at the venue and items set to ♻ Repeat in Build are not loaded (Planning's "Already at the venue"):
  // the same rule (lib/ims/atVenue), so they show here as at the venue, not as short (owner ask 2026-11-26).
  const fvSettings = useFixedVenueSettings(settings);
  const atVenueOf = useMemo(() => atVenueOfEvent(sel, fvSettings, inventory), [sel, fvSettings, inventory]);
  useEffect(() => {
    let cancelled = false;
    // Cleared IMMEDIATELY on every event switch, not just once the new fetch resolves — this panel
    // isn't remounted when the event picker above changes `sel` (regression review, 2026-11-25): on
    // a slow connection, the previous event's needs would otherwise still be showing against the
    // NEW event's (empty) trucks, putting the wrong items' need/arriving/short rows into the list.
    setFnItems([]);
    if (!sel?.id) return;
    supabase.from("functions").select("data").contains("data", { eventOrderId: sel.id }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error("[site-receiving] functions fetch failed:", error.message); setFnItems([]); return; }
      setFnItems((data || []).flatMap((r) => (Array.isArray(r.data?.items) ? r.data.items : [])));
    });
    return () => { cancelled = true; };
  }, [sel?.id]);

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
  // Every item id Studio's build needs for this event, summed across every function, against how
  // much of it has actually gone out on ANY truck OR arrived by inter-event transfer. Feeds both the
  // "never loaded at all" rows below AND the need/arriving/short line now shown on every loaded line
  // too (owner ask 2026-11-25) — so a PARTLY-loaded item (some qty loaded, short of what's needed)
  // is visible right on its own truck line, not just the fully-unloaded case this started as.
  const neededAllByInvId = new Map(); // invId -> { qty, dept } - everything the build uses
  fnItems.forEach((it) => {
    if (!it?.invId || !(Number(it.qty) > 0)) return;
    const invId = String(it.invId);
    const cur = neededAllByInvId.get(invId) || { qty: 0, dept: it.dept || "" };
    cur.qty += Number(it.qty) || 0;
    neededAllByInvId.set(invId, cur);
  });
  // What has to come on a truck: less what stands at the venue (fixed) and all of a Repeat item. Those are listed apart below.
  const neededByInvId = new Map();
  const atVenueRows = [];
  neededAllByInvId.forEach(({ qty, dept }, invId) => {
    const a = atVenueOf({ id: invId, invId, qty });
    if (a.load > 0) neededByInvId.set(invId, { qty: a.load, dept });
    if (a.repeat || a.fixed > 0) {
      const inv = (inventory || []).find((i) => String(i.id) === invId);
      atVenueRows.push({ invId, qty, a, dept: catToDept(inv?.cat || inv?.category || dept), ...labelForLoadKey("inv:" + invId, inventory) });
    }
  });
  atVenueRows.sort((x, y) => String(x.label || "").localeCompare(String(y.label || "")));
  const loadedByInvId = new Map();
  allLines.forEach((ln) => { if (ln.invId) loadedByInvId.set(String(ln.invId), (loadedByInvId.get(String(ln.invId)) || 0) + Number(ln.planned || 0) + Number(ln.extra || 0)); });
  // Same-day reuse from another event (incomingTransfersFor) never rides on one of THIS event's own
  // trucks, so it was never going to show up in allLines above — without counting it too, an item
  // genuinely arriving this way would wrongly read "need N · arriving 0 · short N" right next to the
  // very transfer line (below) that says otherwise (regression review, 2026-11-25).
  transfers.forEach((t) => { if (t.invId) loadedByInvId.set(String(t.invId), (loadedByInvId.get(String(t.invId)) || 0) + (Number(t.qty) || 0)); });
  const missingItems = [...neededByInvId.entries()]
    .filter(([invId]) => !(loadedByInvId.get(invId) > 0))
    .map(([invId, { qty, dept }]) => {
      // The LIVE inventory category, not the snapshot `dept` saved onto this item the first time
      // Studio ever synced it (regression review, 2026-11-25: that snapshot is never refreshed by a
      // later category edit) — and WITHOUT settings.categoryDepartments, matching how
      // DepartmentOpsTab.jsx's own catToDept(cat) calls resolve a truck line's department (no admin-
      // override config there either), so a missing item lands under the same chip a dept head
      // already sees it under everywhere else.
      const inv = (inventory || []).find((i) => String(i.id) === invId);
      return { invId, qty, dept: catToDept(inv?.cat || inv?.category || dept), ...labelForLoadKey("inv:" + invId, inventory) };
    })
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
      {/* One raised card holding every item, rows split by hairlines - the Planning Receiving card's look (owner ask 2026-11-25),
          instead of a floating card per item. Its head says what it is and how many items are still short. */}
      {combinedRows.length > 0 && (() => {
        const shortIds = new Set();
        combinedRows.forEach((row) => {
          if (row.kind === "missing") { shortIds.add("m|" + row.m.invId); return; }
          const id = row.ln.invId ? String(row.ln.invId) : null;
          if (id && (neededByInvId.get(id)?.qty ?? 0) > (loadedByInvId.get(id) || 0)) shortIds.add(id);
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
                  need {Math.round(m.qty * 100) / 100} · arriving 0 · short {Math.round(m.qty * 100) / 100}
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
        const need = ln.invId ? (neededByInvId.get(String(ln.invId))?.qty ?? 0) : null;
        const arriving = ln.invId ? (loadedByInvId.get(String(ln.invId)) || 0) : null;
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
                {need != null && (
                  <div className="mt-1.5">
                    <span className={"inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full tabular-nums " + (Math.max(0, need - arriving) > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                      need {Math.round(need * 100) / 100} · arriving {Math.round(arriving * 100) / 100} · short {Math.round(Math.max(0, need - arriving) * 100) / 100}
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
              <div className="text-xs text-gray-500 truncate">Fixed stock standing there, or set to Repeat in the build</div>
            </div>
            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 tabular-nums">{visibleAtVenue.length}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleAtVenue.map((r) => (
              <div key={"av|" + r.invId} className="px-4 py-3 flex items-center gap-2.5">
                {r.photo ? <img src={thumbUrl(r.photo, 40)} loading="lazy" alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-sm shrink-0">📦</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-gray-900 truncate">{r.label}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10.5px]">
                    <span className="font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[r.dept] || ""} {r.dept}</span>
                    <span className="text-gray-500 tabular-nums">
                      {r.a.repeat ? `all ${r.qty} stay from before` : r.a.load > 0 ? `${r.a.fixed} of ${r.qty} standing here · ${r.a.load} on a truck` : `all ${r.qty} standing here`}
                    </span>
                  </div>
                </div>
                <span className={"shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded " + (r.a.repeat ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700")}>{r.a.repeat ? "♻ REPEAT" : "📌 FIXED"}</span>
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

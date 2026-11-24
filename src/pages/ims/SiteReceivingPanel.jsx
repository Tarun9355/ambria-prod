import { useState } from "react";
import { truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks } from "../../lib/ims/eventTrucks";
import { FLAG_REASONS, receivingOf, lineReceipt, setItemReceiptPatch, clearItemReceiptPatch } from "../../lib/ims/receiving";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { actualsLockState } from "../../lib/ims/actualsLock";
import { hasTabPerm } from "../../lib/ims/tabAccess";

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

  const manifest = truckManifest(sel, inventory);
  const transfers = incomingTransfersFor(eventOrders, sel?.id);
  const receiving = receivingOf(sel);
  const allDepts = [...new Set([...manifest.flatMap((m) => m.lines.map((l) => l.dept)), ...transfers.map((t) => t.fromDept)])].filter(Boolean).sort();
  // Falls back to "all" the instant the picked department doesn't exist on THIS event (switching to
  // a different event in the picker above doesn't remount this panel, so a stale filter from the
  // last event — one this event may not even have — would otherwise hide every item here with no
  // obvious reason why, same for a department's last line simply being removed while looking at it).
  const activeFilter = deptFilter === "all" || allDepts.includes(deptFilter) ? deptFilter : "all";
  // Flattened — every line carries its OWN truck back-reference, so the list is items-first; a
  // truck with nothing loaded contributes no rows to this (nothing to show "about" an empty truck
  // in an items list). allLines is the UNFILTERED flat list — used below for the top-level empty
  // check, which must still fire for an event whose only trucks are empty ones (regression review,
  // 2026-11-24: the old check read the grouped `manifest`, which still counts an empty truck as one
  // entry, so the panel rendered a blank page instead of either empty-state message).
  const allLines = manifest.flatMap(({ truck, lines }) => lines.map((ln) => ({ ...ln, truck })));
  const flatLines = allLines
    .filter((ln) => activeFilter === "all" || ln.dept === activeFilter)
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")) || String(a.dept || "").localeCompare(String(b.dept || "")));
  const visibleTransfers = activeFilter === "all" ? transfers : transfers.filter((t) => t.fromDept === activeFilter);
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

  if (allLines.length === 0 && transfers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
        {hasUnmigratedLegacyTrucks(sel)
          ? "This event's trucks haven't moved to the shared truck list yet — ask the dept head to open Planning → Dept Ops once (loading them re-saves the list) so they show up here."
          : "Nothing loaded on a truck for this event yet."}
      </div>
    );
  }

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
      {activeFilter !== "all" && flatLines.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
          Nothing for {activeFilter} on any truck for this event.
        </div>
      )}
      {flatLines.map((ln) => {
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
        return (
          <div key={ln.truck.id + "|" + ln.dept + "|" + ln.key} className="bg-white rounded-xl border border-gray-100 shadow-[0_2px_4px_rgba(15,23,42,0.06)] px-4 py-3">
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

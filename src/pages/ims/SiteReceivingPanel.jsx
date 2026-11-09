import { useState } from "react";
import { truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks, TRUCK_STATUS_LABEL } from "../../lib/ims/eventTrucks";
import { FLAG_REASONS, receivingOf, lineReceipt, truckReceiptStatus, confirmTruckPatch, setItemReceiptPatch, clearItemReceiptPatch } from "../../lib/ims/receiving";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { actualsLockState } from "../../lib/ims/actualsLock";

const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };

const STATUS_BADGE = {
  pending: "bg-gray-100 text-gray-500",
  confirmed: "bg-emerald-50 text-emerald-700",
  issue: "bg-red-50 text-red-700",
};
const STATUS_TEXT = { pending: "Not arrived", confirmed: "Confirmed OK", issue: "Flagged" };

// Receiving, grouped by TRUCK (every department's items on it together) instead of by item — a
// site supervisor cares "what's on this truck", not "which truck has item X" (that was the old
// per-department Receiving panel's question). Planned mode is read-only; Actual mode lets the
// supervisor confirm a whole truck in one tap, or flag one line with a reason + note.
export default function SiteReceivingPanel({ sel, setEventOrders, inventory, eventOrders, authUser, mode, settings }) {
  const [openId, setOpenId] = useState(null);
  const [flaggingKey, setFlaggingKey] = useState(null); // `${truckId}|${dept}|${key}` currently showing its issue panel

  const manifest = truckManifest(sel, inventory);
  const transfers = incomingTransfersFor(eventOrders, sel?.id);
  const receiving = receivingOf(sel);
  // Post-event actuals lock (lib/ims/actualsLock.js) — every write this panel makes is a receiving
  // actual, so once locked the whole panel is read-only.
  const lock = actualsLockState(sel, settings);

  // Build each patch from the freshest row INSIDE the updater (`e`, not the render-time `sel`) —
  // two supervisors (or a supervisor and a dept head's unrelated write) landing close together
  // must not let the later write silently revert the earlier one. Also re-checks the lock against
  // that same freshest row, so a realtime reopen/lock landing between render and this click is
  // honoured immediately rather than the render-time `lock` above.
  const write = (build) => setEventOrders((prev) => prev.map((e) => {
    if (e.id !== sel.id) return e;
    if (actualsLockState(e, settings).locked) return e;
    return { ...e, receiving: build(e) };
  }));
  const confirmTruck = (truckId) => write((e) => confirmTruckPatch(e, truckId, authUser?.name));
  const setLine = (truckId, dept, key, patch) => write((e) => setItemReceiptPatch(e, truckId, dept, key, patch, authUser?.name));
  const clearLine = (truckId, dept, key) => write((e) => clearItemReceiptPatch(e, truckId, dept, key, authUser?.name));

  const flagKeyOf = (truckId, ln) => `${truckId}|${ln.dept}|${ln.key}`;
  // Only gates WRITE controls (confirm/flag/edit) — view-only things (opening a truck, reading a
  // flag's reason) stay usable on a locked event, same as Planned mode already is.
  const canEdit = mode === "actual" && !lock.locked;

  if (manifest.length === 0 && transfers.length === 0) {
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
      {manifest.map(({ truck, lines }) => {
        const status = truckReceiptStatus(lines, receiving.trucks[truck.id]);
        const open = openId === truck.id || (openId == null && manifest.length === 1);
        const deptCount = new Set(lines.map((l) => l.dept)).size;
        const pieceCount = lines.reduce((s, l) => s + l.planned + l.extra, 0);
        return (
          <div key={truck.id} className="bg-white rounded-xl border border-gray-100 shadow-[0_2px_4px_rgba(15,23,42,0.06)] overflow-hidden">
            <button onClick={() => setOpenId(open ? "" : truck.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              <span className="shrink-0 w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base">🚛</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  {truck.vehicle || truck.driver ? [truck.vehicle, truck.driver].filter(Boolean).join(" · ") : "No vehicle assigned yet"}
                  <span className={"text-[10.5px] font-bold px-2 py-0.5 rounded-full " + (STATUS_BADGE[status] || STATUS_BADGE.pending)}>{STATUS_TEXT[status] || status}</span>
                </div>
                <div className="text-[11.5px] text-gray-400 mt-0.5">{deptCount} department{deptCount === 1 ? "" : "s"} · {pieceCount} pcs{truck.phone ? ` · ${truck.phone}` : ""}</div>
              </div>
              <span className="shrink-0 text-gray-300 text-sm">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="border-t border-gray-100">
                {canEdit && lines.length > 0 && (
                  <div className="flex gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <button onClick={() => confirmTruck(truck.id)} className="flex-1 h-9 rounded-lg bg-emerald-50 text-emerald-700 text-[12.5px] font-semibold hover:bg-emerald-100">✓ Arrived as planned</button>
                    <button onClick={() => { setOpenId(truck.id); setFlaggingKey(flagKeyOf(truck.id, lines[0])); }} className="flex-1 h-9 rounded-lg bg-white ring-1 ring-gray-200 text-gray-600 text-[12.5px] font-semibold hover:bg-red-50 hover:text-red-700">⚠ Something's wrong</button>
                  </div>
                )}
                {lines.map((ln) => {
                  const r = lineReceipt(receiving.trucks[truck.id], ln.dept, ln.key);
                  const got = r.got != null ? r.got : (ln.planned + ln.extra);
                  const short = mode === "actual" && Number(got) < ln.planned + ln.extra;
                  const fk = flagKeyOf(truck.id, ln);
                  const showIssue = canEdit && (flaggingKey === fk || !!r.flag);
                  return (
                    <div key={ln.dept + "|" + ln.key} className="px-4 py-2.5 border-b border-gray-100 last:border-b-0">
                      <div className="flex items-center gap-2.5">
                        {ln.photo ? <img src={thumbUrl(ln.photo, 32)} loading="lazy" alt="" className="w-8 h-8 rounded object-cover border border-gray-100" /> : <div className="w-8 h-8 rounded bg-gray-50 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold text-gray-800 truncate">{ln.label}</div>
                          <span className="text-[9.5px] font-bold text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{DEPT_ICON[ln.dept] || ""} {ln.dept}</span>
                        </div>
                        {mode === "plan" ? (
                          <div className="text-[12.5px] font-bold text-gray-800 tabular-nums">{ln.planned}{ln.extra ? ` +${ln.extra}` : ""} pcs</div>
                        ) : canEdit ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <input type="number" min="0" value={got} onChange={(e) => { const v = e.target.value; setLine(truck.id, ln.dept, ln.key, { got: v === "" ? null : v, flag: r.flag, note: r.note }); }}
                              className={"w-14 h-8 rounded-lg text-center text-[12.5px] font-bold tabular-nums ring-1 focus:outline-none focus:ring-2 " + (short || r.flag ? "bg-red-50 ring-red-200 text-red-700" : "bg-gray-50 ring-gray-200 text-gray-800")} />
                            <button onClick={() => setFlaggingKey(showIssue ? null : fk)}
                              className={"h-8 px-2.5 rounded-lg text-[11px] font-semibold " + (r.flag ? "bg-red-50 text-red-700" : "bg-white ring-1 ring-gray-200 text-gray-500 hover:bg-gray-50")}>
                              {r.flag ? "⚑ Flagged" : "⚑ Flag"}
                            </button>
                          </div>
                        ) : (
                          // Locked: the final actual, read-only — not the planned figure, the real one.
                          <div className="flex items-center gap-2 shrink-0">
                            <div className={"text-[12.5px] font-bold tabular-nums " + (short || r.flag ? "text-red-700" : "text-gray-800")}>{got}</div>
                            {r.flag && <span className="text-[10px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5">⚑ {FLAG_REASONS.find((f) => f.key === r.flag)?.label || "Flagged"}</span>}
                          </div>
                        )}
                      </div>
                      {showIssue && (
                        <div className="mt-2 ml-[42px] bg-red-50 rounded-lg p-2.5">
                          <div className="flex gap-1.5 flex-wrap mb-2">
                            {FLAG_REASONS.map((fr) => (
                              <button key={fr.key} onClick={() => setLine(truck.id, ln.dept, ln.key, { got: fr.key === "missing" ? 0 : got, flag: fr.key, note: r.note })}
                                className={"text-[11px] font-semibold px-2.5 py-1 rounded-full border " + (r.flag === fr.key ? "bg-red-600 text-white border-transparent" : "bg-white text-gray-500 border-gray-200")}>
                                {fr.label}
                              </button>
                            ))}
                          </div>
                          <input defaultValue={r.note || ""} onBlur={(e) => setLine(truck.id, ln.dept, ln.key, { got, flag: r.flag, note: e.target.value })}
                            placeholder="Note for the dept head" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11.5px]" />
                          {r.flag && (
                            <button onClick={() => { clearLine(truck.id, ln.dept, ln.key); setFlaggingKey(null); }} className="mt-1.5 text-[10.5px] font-semibold text-gray-400 hover:text-gray-700">Clear this flag</button>
                          )}
                        </div>
                      )}
                      {!canEdit && mode === "actual" && !!r.flag && r.note && (
                        <div className="mt-1.5 ml-[42px] text-[11px] text-gray-500 italic">"{r.note}"</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {transfers.length > 0 && (
        <div className="bg-sky-50 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700 mb-2">Not tied to a truck — reused from another site</div>
          <div className="space-y-1.5">
            {transfers.map((t, i) => (
              <div key={i} className="text-[12px] text-sky-900">↪️ <b>{t.name}</b> ×{t.qty} from {t.fromEvent} ({t.fromDept}){t.vehicle || t.driver ? ` · ${[t.vehicle, t.driver].filter(Boolean).join(" · ")}` : ""}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

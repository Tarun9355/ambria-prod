import { useState } from "react";
import CarpetPickerModal from "./CarpetPickerModal.jsx";
import { thumbUrl } from "../../lib/studio/thumb.js";

// Planning's panel for overlays and cushion covers — the Fabric head sees each element's designs (up to four, in sales' order) with what
// is free on the event date, and decides the ONE design used for the whole quantity. Same layout as the Carpet plan (Tenting).
//
//   plan        planElements() result: { rows, over }
//   stockOf(r)  every design of that kind in stock, with this element's date free quantity (for "choose another design…")
//   onDecide(r, option, byHand) / onOther(r) / onUndo(key)   write the decision (IMS-owned, deptOps.Fabric.itemChoice)
//   onDecideAll(option)   the same design for every undecided row that has it as a (non-short) choice
const RANK = ["1st", "2nd", "3rd", "4th"];
const dayLbl = (d) => { try { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "the event date"; } catch { return d || "the event date"; } };
const photoOf = (it) => (it ? (it.img || (Array.isArray(it.photoUrls) && it.photoUrls[0]) || "") : "");
const nounOf = (r) => (/cover/i.test(r.options[0]?.name || r.name || "") ? "cushion cover" : "overlay");

export default function ElementChoicePlan({ plan, stockOf, onDecide, onDecideAll, onOther, onUndo, onZoom, className = "" }) {
  // Rows a design could go on in one go — the same filter the parent's onDecideAll applies, so the
  // count on the button is exactly what the click decides. Decided rows are never touched.
  const sameDesignRows = (o) => plan.rows.filter((x) => x.status !== "decided" && x.options.some((p) => p.id === o.id && !(p.known && !p.enough)));
  const [more, setMore] = useState(null); // key of the element whose "choose another design" picker is open
  const overNames = Object.keys(plan.over).map((id) => ({ id, ...plan.over[id], name: plan.rows.flatMap((r) => [...r.options, r.manual]).filter(Boolean).find((o) => o.id === id)?.name || id }));
  const unit = (r) => r.unit || "pcs";
  return (
    <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden " + className}>
      <div className="px-3 sm:px-4 py-3 bg-gray-50 flex items-center gap-3">
        <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🧵</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-gray-900">Overlay &amp; cushion cover choices</div>
          <div className="text-xs text-gray-500">Sales named up to four designs for each of these. Check what is free on the day and choose the one design used for the whole quantity.</div>
        </div>
      </div>
      <div className="p-3 sm:p-4 space-y-3">
        {overNames.length > 0 && (
          <div className="rounded-lg bg-red-50 ring-1 ring-red-100 px-3 py-2 text-xs text-red-700">
            ⚠ {overNames.map((o) => `${o.name}: the event needs ${Math.round(o.committed)} together${o.date ? ` on ${dayLbl(o.date)}` : ""}, only ${Math.round(o.free)} free`).join(" · ")}
          </div>
        )}
        {plan.rows.map((r) => {
          const dec = [...r.options, r.manual].filter(Boolean).find((o) => o.id === r.decidedId);
          const chip = r.status === "decided" ? { t: r.other ? "✓ Decided: arranged separately (not from stock)" : `✓ Decided: ${dec?.name || ""}${r.manual ? " (picked in Planning)" : ""}`, c: "bg-emerald-50 text-emerald-700 ring-emerald-100" }
            : r.status === "short" ? { t: "None of the choices covers it", c: "bg-red-50 text-red-700 ring-red-100" }
            : { t: "Not decided yet", c: "bg-amber-50 text-amber-700 ring-amber-100" };
          const anyCovers = r.options.some((o) => o.enough);
          const mph = r.manual?.item ? photoOf(r.manual.item) : "";
          return (
            <div key={r.key} className="rounded-xl ring-1 ring-gray-200 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{r.zoneName}</span>
                <span className="text-[11px] text-gray-500">{[r.fnLabel, r.date && dayLbl(r.date)].filter(Boolean).join(" · ")}</span>
                <span className="text-[11px] text-gray-500 tabular-nums">· {r.qty} {unit(r)} needed</span>
                <span className={"ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 " + chip.c}>{chip.t}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {r.options.map((o) => {
                  const on = o.id === r.decidedId;
                  const ph = photoOf(o.item);
                  return (
                    <div key={o.id} className={"rounded-lg p-2 flex flex-col gap-2 ring-1 " + (on ? "ring-emerald-400 bg-emerald-50/60" : "ring-gray-200 bg-white")}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center" title={RANK[o.rank] + " choice"}>{o.rank + 1}</span>
                        {ph ? <img src={thumbUrl(ph, 96)} loading="lazy" decoding="async" alt="" onClick={() => onZoom && onZoom(ph)} className="w-12 h-12 rounded-md object-cover border border-gray-200 cursor-zoom-in shrink-0" /> : <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-gray-900 truncate" title={o.name}>{o.name}</div>
                          <div className={"text-[11px] tabular-nums " + (!o.known ? "text-gray-500" : o.enough ? "text-emerald-700" : "text-red-600")}>
                            {!o.known ? "Stock not known" : o.enough ? `✓ ${Math.round(o.free)} free · covers it` : `${Math.round(o.free)} free · short ${Math.round(o.short)}`}
                          </div>
                          {!on && r.suggestedId === o.id && !r.decidedId && <div className="text-[10.5px] font-semibold text-sky-700">Suggested</div>}
                        </div>
                      </div>
                      {on
                        ? <button type="button" onClick={() => onUndo(r.key)} className="text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                        : <button type="button" disabled={o.known && !o.enough} onClick={() => onDecide(r, o)}
                            title={o.known && !o.enough ? `Short on this date — only ${Math.round(o.free)} free, the element needs ${r.qty}` : undefined}
                            className={"text-[12px] font-semibold rounded-md px-2 py-1 ring-1 " + (o.known && !o.enough ? "ring-gray-200 text-gray-400 cursor-not-allowed" : "ring-gray-300 text-gray-800 hover:bg-gray-50 cursor-pointer")}>Use this</button>}
                      {onDecideAll && !on && !(o.known && !o.enough) && (() => { const n = sameDesignRows(o).length; return n > 1 ? (
                        <button type="button" onClick={() => onDecideAll(o)} title={`Use ${o.name} on every item that has it as a choice and is not decided yet`}
                          className="text-[12px] font-semibold rounded-md px-2 py-1 bg-gray-900 text-white hover:bg-black cursor-pointer">Use on all {n}</button>
                      ) : null; })()}
                    </div>
                  );
                })}
              </div>
              {/* None of sales' choices available? Planning can pick any design of this kind by hand, or arrange the pieces outside stock. */}
              <div className="mt-3 pt-2.5 border-t border-gray-100">
                {r.other && (
                  <div className="mb-2 rounded-lg p-2 flex items-center gap-2 ring-1 ring-emerald-400 bg-emerald-50/60">
                    <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0 flex items-center justify-center text-lg" aria-hidden="true">🛒</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900">Arranged separately</div>
                      <div className="text-[11px] text-emerald-700">These pieces are bought, hired or made outside stock.</div>
                    </div>
                    <button type="button" onClick={() => onUndo(r.key)} className="shrink-0 text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                  </div>
                )}
                {r.manual && (
                  <div className="mb-2 rounded-lg p-2 flex items-center gap-2 ring-1 ring-emerald-400 bg-emerald-50/60">
                    {mph ? <img src={thumbUrl(mph, 96)} loading="lazy" decoding="async" alt="" onClick={() => onZoom && onZoom(mph)} className="w-12 h-12 rounded-md object-cover border border-gray-200 cursor-zoom-in shrink-0" /> : <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate" title={r.manual.name}>{r.manual.name}</div>
                      <div className={"text-[11px] tabular-nums " + (r.manual.enough ? "text-emerald-700" : "text-red-600")}>{r.manual.known ? `${Math.round(r.manual.free)} free` : "Stock not known"} · picked in Planning, not one of sales' choices</div>
                    </div>
                    <button type="button" onClick={() => onUndo(r.key)} className="shrink-0 text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                  </div>
                )}
                <button type="button" onClick={() => setMore(r.key)}
                  className={"text-[12px] font-semibold rounded-md px-2.5 py-1 ring-1 cursor-pointer " + (!anyCovers && !r.manual ? "ring-red-300 text-red-700 bg-red-50 hover:bg-red-100" : "ring-gray-300 text-gray-700 hover:bg-gray-50")}>
                  {!anyCovers && !r.manual ? "None of these is available — choose another design…" : r.manual ? "Choose a different design…" : "Choose another design…"}
                </button>
                {!r.other && (
                  <button type="button" onClick={() => onOther(r)} title={`No ${nounOf(r)} in stock can be used for this element — the pieces are bought, hired or made outside stock`}
                    className="ml-2 text-[12px] font-semibold rounded-md px-2.5 py-1 ring-1 ring-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">Arrange separately (not from stock)</button>
                )}
              </div>
            </div>
          );
        })}
        {more && (() => {
          const r = plan.rows.find((x) => x.key === more);
          if (!r) return null;
          const all = stockOf(r).map((o) => ({ ...o, rank: r.options.find((x) => x.id === o.id)?.rank ?? null }));
          return (
            <CarpetPickerModal floor={r} options={all} selectedId={r.decidedId} dateLabel={dayLbl(r.date)}
              noun={nounOf(r)} unit={unit(r)} needNoun="element" need={r.qty}
              onClose={() => setMore(null)}
              onSave={(o) => { onDecide(r, o, o.rank === null); setMore(null); }} />
          );
        })()}
      </div>
    </div>
  );
}

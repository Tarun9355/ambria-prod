import { useEffect, useRef, useState } from "react";
import { thumbUrl } from "../../lib/studio/thumb.js";

// Planning's carpet picker — the same availability picker Build shows (photo cards, a free-sqft badge, SHORT where a carpet
// cannot cover the floor that day), opened when the Tenting head chooses which carpet goes down. One carpet is chosen. A carpet
// with less free than the floor needs is marked SHORT and cannot be picked (one already chosen stays removable).
//
//   options     [{ id, name, free, known, enough, short, item, rank }]  every carpet with that day's free sqft; rank = sales' choice (0-3) or null
//   selectedId  the carpet currently decided for this floor, if any
//   onSave(o)   the chosen option
const RANK = ["1st", "2nd", "3rd", "4th"];

export default function CarpetPickerModal({ floor, options, selectedId, dateLabel, onSave, onClose }) {
  const [sel, setSel] = useState(selectedId || null);
  // Escape closes this picker and nothing else. It is taken first (capture phase, once, with the latest onClose kept in a ref): the page
  // behind also closes its panel on Escape, and that re-renders before this listener's turn, which would skip a normal one.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const chosen = options.find((o) => o.id === sel) || null;
  const photoOf = (it) => (it ? (it.img || (Array.isArray(it.photoUrls) && it.photoUrls[0]) || "") : "");

  return (
    <div className="fixed inset-0 z-[9300] bg-black/60 flex items-center justify-center p-5" onClick={onClose}>
      <div role="dialog" aria-label="Choose a carpet" className="bg-white rounded-2xl w-[min(900px,95vw)] max-h-[85vh] flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.4)] ring-1 ring-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-gray-900">Availability — Carpet</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{floor.zoneName} · carpet · free on {dateLabel} · tap to pick</div>
            <div className="text-[11px] font-semibold text-amber-700 mt-0.5">{Math.round(floor.area)} sqft needed for this floor</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-gray-500 hover:text-gray-800 cursor-pointer">×</button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {options.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No carpet found in inventory.</div>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {options.map((o) => {
                const on = o.id === sel;
                const blocked = !o.enough && !on;
                const ph = photoOf(o.item);
                const out = !o.known || o.free <= 0;
                return (
                  <div key={o.id} role="button" tabIndex={blocked ? -1 : 0} aria-pressed={on} aria-disabled={blocked}
                    onClick={() => { if (blocked) return; setSel(on ? null : o.id); }}
                    onKeyDown={(e) => { if (!blocked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSel(on ? null : o.id); } }}
                    title={blocked ? `Short for this date — only ${Math.round(o.free ?? 0)} sqft free, this floor needs ${Math.round(floor.area)}` : undefined}
                    className={"relative rounded-xl overflow-hidden border-2 bg-gray-50 " + (on ? "border-emerald-600" : "border-gray-200") + (blocked ? " opacity-55 cursor-not-allowed" : " cursor-pointer hover:shadow-md")}>
                    {on && <span className="absolute top-1.5 left-1.5 z-10 text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-600 text-white">✓ Chosen</span>}
                    {!on && o.rank !== null && o.rank !== undefined && <span className="absolute top-1.5 left-1.5 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-gray-900/85 text-white" title="One of the carpets sales picked">Sales · {RANK[o.rank] || o.rank + 1}</span>}
                    <span className={"absolute top-1.5 right-1.5 z-10 text-xs font-extrabold min-w-[22px] text-center px-1.5 py-0.5 rounded-lg text-white " + (out ? "bg-red-500/90" : "bg-emerald-500/90")} title="Free on the event date">{o.known ? Math.round(o.free) : "?"}</span>
                    {ph ? <img src={thumbUrl(ph, 320)} loading="lazy" decoding="async" alt="" className={"w-full h-[120px] object-cover block " + (out ? "opacity-50" : "")} />
                      : <div className="w-full h-[120px] bg-gray-200 flex items-center justify-center text-2xl text-gray-400">▭</div>}
                    <div className="px-2.5 py-2">
                      <div className="text-[11px] font-semibold text-gray-900 truncate" title={o.name}>{o.name}</div>
                      {!o.enough && o.known && <div className="text-[9.5px] mt-0.5 font-extrabold text-red-500">SHORT {Math.ceil(o.short)} sqft · needs {Math.round(floor.area)}{on ? " · tap to remove" : ""}</div>}
                      {!o.known && <div className="text-[9.5px] mt-0.5 font-bold text-gray-500">Stock not known</div>}
                      <div className={"text-[9.5px] mt-0.5 font-semibold " + (o.enough ? "text-emerald-700" : "text-emerald-700/60")}>{Math.round(o.item ? (Number(o.item.qty) || 0) : (o.free ?? 0))} sqft total</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] text-gray-500 max-w-[560px]">
            {chosen ? `${chosen.name} will be laid on this floor.` : "Pick the carpet that goes down on this floor."} A carpet with less free on this date than the {Math.round(floor.area)} sqft floor needs is marked short and cannot be picked.
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={!chosen} onClick={() => chosen && onSave(chosen)}
              className={"px-5 py-2 rounded-lg text-xs font-bold text-white " + (chosen ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer" : "bg-gray-400 cursor-default")}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

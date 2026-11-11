import { useState } from "react";
import { ALLOC_SOURCES, shortfallBreakdown, setAllocPart } from "../../lib/ims/shortfallAlloc";

// Planning → Dept Ops, under a "Can be made" line booked past what we hold on the date: what is already in stock,
// how many more are needed, and how those are arranged - our production, outsourced, bought - with what is left
// "not arranged". Nothing is assumed to be made in-house until Planning says so. (lib/ims/shortfallAlloc.js)
function Stat({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={"text-sm font-bold tabular-nums " + tone}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

export default function ShortfallAllocation({ booked, short, saved, canEdit, onSave }) {
  const bd = shortfallBreakdown({ booked, short }, saved);
  const [open, setOpen] = useState(false);
  if (!(bd.short > 0)) return null;
  const set = (key, v) => onSave(setAllocPart(saved, bd.short, key, v));
  const arranged = bd.make + bd.outsource + bd.buy;
  return (
    <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-gray-700">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Booked" value={bd.booked} tone="text-gray-900" />
        <Stat label="In stock" value={bd.inStock} tone="text-emerald-700" />
        <Stat label="More needed" value={bd.short} tone="text-amber-700" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {ALLOC_SOURCES.map(([k, label]) => bd[k] > 0 && <span key={k}><b className="tabular-nums">{bd[k]}</b> {label.toLowerCase()}</span>)}
        {bd.unarranged > 0
          ? <span className="font-semibold text-red-600"><b className="tabular-nums">{bd.unarranged}</b> not arranged yet</span>
          : <span className="font-semibold text-emerald-700">✓ all arranged</span>}
        {canEdit && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="ml-auto text-[11px] font-semibold text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded">
            {open ? "Done" : arranged > 0 ? "Change split" : "Arrange the shortage"}
          </button>
        )}
      </div>
      {bd.trimmed && <div className="mt-1 text-[11px] text-amber-700">The booking came down - the split was cut to the {bd.short} now needed.</div>}
      {open && canEdit && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {ALLOC_SOURCES.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-md bg-white border border-gray-200 px-2 py-1">
              <span className="text-[11px] text-gray-600">{label}</span>
              <input type="number" min="0" max={bd.short} inputMode="numeric" value={bd[k] || ""} placeholder="0"
                onChange={(e) => set(k, e.target.value)}
                className="w-16 text-right text-xs font-semibold tabular-nums border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

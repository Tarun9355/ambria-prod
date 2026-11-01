import { useMemo } from "react";
import { paintWorkOf } from "../../lib/ims/paintWork";
import { swatchHexFor } from "../../lib/studio/colours";
import { thumbUrl } from "../../lib/studio/thumb.js";

// Planning → Dept Ops → 🎨 Paint: every item on the open event that is repainted - which item, from which colour to
// which, how many, and in which zone (lib/ims/paintWork.js reads it off the event's own build). Read-only: the colours are
// set in Studio's Build.
export default function PaintDeptView({ sel, inventory, colourCatalogue, zoneLabel, onZoom }) {
  const work = useMemo(() => paintWorkOf({ functionsDetail: sel?.functionsDetail, inventory, zoneLabel }), [sel, inventory, zoneLabel]);
  const multiFn = (Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : []).filter(Boolean).length > 1;
  const dot = (c) => <span aria-hidden="true" className="inline-block w-3 h-3 rounded-full ring-1 ring-black/15 shrink-0" style={{ background: swatchHexFor(c, colourCatalogue) }} />;

  if (!work.items) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center">
        <div aria-hidden="true" className="text-3xl">🎨</div>
        <div className="mt-2 text-sm font-semibold text-gray-800">Nothing to paint on this event</div>
        <div className="mt-1 text-xs text-gray-500">An item is listed here once a colour other than its own is picked for it in Studio's Build.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* What to mix: every colour over the event, with its pieces */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold text-gray-900">🎨 Paint work</div>
          <div className="text-xs text-gray-500 tabular-nums">
            {work.pieces} piece{work.pieces === 1 ? "" : "s"} · {work.items} item{work.items === 1 ? "" : "s"} · {work.colours.length} colour{work.colours.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {work.colours.map((c) => (
            <span key={c.colour} className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 ring-1 ring-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-800">
              {dot(c.colour)}{c.colour}<span className="text-gray-500 tabular-nums">×{c.qty}</span>
            </span>
          ))}
        </div>
      </div>

      {work.fns.map((f) => (
        <div key={f.fi} className="bg-white rounded-xl shadow-sm overflow-hidden">
          {multiFn && (
            <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-700">
              {f.label}{f.date ? <span className="font-normal text-gray-400"> · {f.date}</span> : null}
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {f.rows.map((r) => (
              <div key={r.key} className="flex items-start gap-3 px-4 py-3">
                {r.photo
                  ? <img src={thumbUrl(r.photo, 48)} loading="lazy" decoding="async" alt="" onClick={() => onZoom?.(r.photo)} className="w-12 h-12 rounded-lg object-cover border cursor-zoom-in shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
                  : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg shrink-0">📦</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold text-gray-900" title={r.name}>{r.name}</span>
                    <span className="shrink-0 text-xs text-gray-500 tabular-nums">{r.painted === r.qty ? `${r.qty} pcs` : `${r.painted} of ${r.qty} pcs`}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{r.zone}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1 text-gray-500">{dot(r.baseColour)}{r.baseColour}</span>
                    <span aria-hidden="true" className="text-gray-300">→</span>
                    {r.colours.map((c) => (
                      <span key={c.colour} className="inline-flex items-center gap-1 font-semibold text-gray-800">
                        {dot(c.colour)}{c.colour}<span className="font-normal text-gray-500 tabular-nums">×{c.qty}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

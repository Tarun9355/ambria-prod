import { useState } from "react";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { fixedVenueFor } from "../../lib/ims/fixedVenues";

// Read-only: what stands permanently at each Fixed Venue, for THIS department (owner ask 2026-11-02) - so a department's crew knows what is
// already at a venue and is not to be loaded. Read from Settings → Fixed Venues (the only place it is edited); an item belongs to the
// department its inventory category maps to. Folded by default; opened, one card per venue, the open event's venue first and marked.
// qty = the venue's discounted standing qty + its full-rate standing qty (both are physically there).
const standingOf = (it) => (Number(it?.qty) || 0) + (Number(it?.fullQty) || 0);
const photoOf = (inv) => (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || inv?.img || "";

export default function FixedVenueStockCard({ fixedVenues, inventory, dept, catToDept, settings, eventVenue, onZoom }) {
  const invById = new Map((inventory || []).map((i) => [String(i.id), i]));
  const here = fixedVenueFor(settings, eventVenue)?.name || "";
  const venues = (Array.isArray(fixedVenues) ? fixedVenues : [])
    .map((v) => ({
      name: v?.name || "",
      items: (v?.items || [])
        .map((it) => ({ inv: invById.get(String(it?.invId)), qty: standingOf(it) }))
        .filter(({ inv, qty }) => inv && qty > 0 && catToDept(inv.category || inv.cat) === dept)
        .sort((a, b) => String(a.inv.name).localeCompare(String(b.inv.name))),
    }))
    .filter((v) => v.name && v.items.length)
    .sort((a, b) => (b.name === here) - (a.name === here) || a.name.localeCompare(b.name));
  const [open, setOpen] = useState(false);
  if (!venues.length) return null;
  const total = venues.reduce((sum, v) => sum + v.items.length, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white mb-4">
      {/* Folded by default: a header line with the totals; opening it shows one card per venue. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left cursor-pointer hover:bg-gray-50 rounded-xl">
        <span className={"text-[12px] text-gray-500 transition-transform " + (open ? "rotate-90" : "")}>▸</span>
        <span className="text-[15px] font-semibold text-[#1A1A2E]">📌 Fixed at venues</span>
        <span className="text-[12px] text-gray-500">{total} item{total === 1 ? "" : "s"} · {venues.length} venue{venues.length === 1 ? "" : "s"}</span>
        {here && venues.some((v) => v.name === here) && <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{here}: {venues.find((v) => v.name === here).items.length} here</span>}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="text-[12px] text-gray-500 mb-3">Standing permanently at these venues - already there, not to be loaded. Set in Settings → Fixed Venues.</div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-start">
            {venues.map((v) => (
              <div key={v.name} className={"rounded-lg border p-3 " + (v.name === here ? "border-emerald-300 bg-emerald-50/40" : "border-gray-200")}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13.5px] font-semibold text-[#1A1A2E] truncate">{v.name}</span>
                  {v.name === here && <span className="shrink-0 text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">This event's venue</span>}
                  <span className="ml-auto shrink-0 text-[12px] text-gray-500 tabular-nums">{v.items.length} item{v.items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                  {v.items.map(({ inv, qty }) => {
                    const ph = photoOf(inv);
                    return (
                      <div key={inv.id} className="flex items-center gap-2.5">
                        {ph
                          ? <img src={thumbUrl(ph, 72)} loading="lazy" decoding="async" alt="" onClick={onZoom ? () => onZoom(ph) : undefined}
                              className={"w-9 h-9 rounded-md object-cover border border-gray-200 shrink-0 " + (onZoom ? "cursor-zoom-in" : "")} />
                          : <span className="w-9 h-9 rounded-md bg-gray-100 shrink-0" />}
                        <span className="flex-1 min-w-0 text-[13px] text-[#1A1A2E] truncate" title={inv.name}>{inv.name}</span>
                        <span className="text-[13px] font-semibold text-gray-700 tabular-nums">×{qty}{inv.unit ? <span className="ml-0.5 text-[11px] font-normal text-gray-400">{inv.unit}</span> : null}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

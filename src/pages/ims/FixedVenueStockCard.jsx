import { useState } from "react";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { fixedVenueFor } from "../../lib/ims/fixedVenues";

// Read-only: what stands permanently at each Fixed Venue, for THIS department (owner ask 2026-11-02) - so a department's crew knows what is
// already at a venue and is not to be loaded. Read from Settings → Fixed Venues (the only place it is edited); an item belongs to the
// department its inventory category maps to. The open event's venue is listed first and opened.
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
  const [open, setOpen] = useState(() => new Set(here ? [here] : []));
  if (!venues.length) return null;
  const total = venues.reduce((s, v) => s + v.items.length, 0);
  const toggle = (name) => setOpen((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n; });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[15px] font-semibold text-[#1A1A2E]">📌 Fixed at venues</span>
        <span className="text-[12px] text-gray-500">{total} item{total === 1 ? "" : "s"} · {venues.length} venue{venues.length === 1 ? "" : "s"}</span>
      </div>
      <div className="text-[12px] text-gray-500 mb-3">Standing permanently at these venues - already there, not to be loaded. Set in Settings → Fixed Venues.</div>
      <div className="flex flex-col gap-2">
        {venues.map((v) => {
          const isOpen = open.has(v.name);
          return (
            <div key={v.name} className="rounded-lg border border-gray-100">
              <button type="button" onClick={() => toggle(v.name)} aria-expanded={isOpen}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-gray-50 rounded-lg">
                <span className={"text-[12px] text-gray-500 transition-transform " + (isOpen ? "rotate-90" : "")}>▸</span>
                <span className="text-[13.5px] font-semibold text-[#1A1A2E]">{v.name}</span>
                {v.name === here && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">This event's venue</span>}
                <span className="ml-auto text-[12px] text-gray-500 tabular-nums">{v.items.length} item{v.items.length === 1 ? "" : "s"}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-2 flex flex-col gap-1.5">
                  {v.items.map(({ inv, qty }) => {
                    const ph = photoOf(inv);
                    return (
                      <div key={inv.id} className="flex items-center gap-2.5">
                        {ph
                          ? <img src={thumbUrl(ph, 72)} loading="lazy" decoding="async" alt="" onClick={onZoom ? () => onZoom(ph) : undefined}
                              className={"w-9 h-9 rounded-md object-cover border border-gray-200 shrink-0 " + (onZoom ? "cursor-zoom-in" : "")} />
                          : <span className="w-9 h-9 rounded-md bg-gray-100 shrink-0" />}
                        <span className="flex-1 min-w-0 text-[13px] text-[#1A1A2E] truncate">{inv.name}</span>
                        <span className="text-[13px] font-semibold text-gray-700 tabular-nums">×{qty}{inv.unit ? <span className="ml-0.5 text-[11px] font-normal text-gray-400">{inv.unit}</span> : null}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

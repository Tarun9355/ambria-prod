import { useEffect, useState } from "react";
import { thumbUrl } from "../../lib/studio/thumb.js";
import { fixedVenueFor } from "../../lib/ims/fixedVenues";

// Read-only: what stands permanently at each Fixed Venue, for THIS department (owner ask 2026-11-02) - so a department's crew knows what is
// already at a venue and is not to be loaded. Read from Settings → Fixed Venues (the only place it is edited); an item belongs to the
// department its inventory category maps to. Folded by default; opened, one small card per venue (the open event's venue first and marked), and a card opens that venue's list.
// qty = the venue's discounted standing qty + its full-rate standing qty (both are physically there).
const ring = " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
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
  const [shown, setShown] = useState(null); // the venue whose list is open in the popup
  // Esc closes the popup, like the app's other dialogs.
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setShown(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  if (!venues.length) return null;
  const total = venues.reduce((sum, v) => sum + v.items.length, 0);
  const venueShown = shown ? venues.find((v) => v.name === shown) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white mb-4">
      {/* Folded by default: a header line with the totals; opening it shows one small card per venue, and a card opens that venue's list. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left cursor-pointer hover:bg-gray-50 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <span className={"text-[12px] text-gray-500 transition-transform " + (open ? "rotate-90" : "")}>▸</span>
        <span className="text-[15px] font-semibold text-[#1A1A2E]">📌 Fixed at venues</span>
        <span className="text-[12px] text-gray-500">{total} item{total === 1 ? "" : "s"} · {venues.length} venue{venues.length === 1 ? "" : "s"}</span>
        {here && venues.some((v) => v.name === here) && <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{here}: {venues.find((v) => v.name === here).items.length} here</span>}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="text-[12px] text-gray-500 mb-3">Standing permanently at these venues - already there, not to be loaded. Tap a venue for its list. Set in Settings → Fixed Venues.</div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
            {venues.map((v) => (
              <button type="button" key={v.name} onClick={() => setShown(v.name)}
                className={"text-left rounded-lg border p-3 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 " + (v.name === here ? "border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50" : "border-gray-200 hover:bg-gray-50")}>
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[#1A1A2E] truncate">{v.name}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-gray-500 tabular-nums">{v.items.length}</span>
                </div>
                {v.name === here && <div className="mt-1"><span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">This event's venue</span></div>}
                <div className="flex gap-1 mt-2">
                  {v.items.slice(0, 5).map(({ inv }) => { const ph = photoOf(inv); return ph
                    ? <img key={inv.id} src={thumbUrl(ph, 56)} loading="lazy" decoding="async" alt="" className="w-7 h-7 rounded object-cover border border-gray-200" />
                    : <span key={inv.id} className="w-7 h-7 rounded bg-gray-100" />; })}
                  {v.items.length > 5 && <span className="w-7 h-7 rounded bg-gray-100 text-[10.5px] text-gray-500 flex items-center justify-center">+{v.items.length - 5}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {venueShown && (
        <div className="fixed inset-0 z-[9000] bg-black/50 flex items-center justify-center p-4" onClick={() => setShown(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={venueShown.name}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <span className="text-[15px] font-semibold text-[#1A1A2E]">📌 {venueShown.name}</span>
              {venueShown.name === here && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">This event's venue</span>}
              <span className="text-[12px] text-gray-500">{venueShown.items.length} item{venueShown.items.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => setShown(null)} aria-label="Close" className="ml-auto -mr-2 w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-[18px] leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">×</button>
            </div>
            <div className="px-4 py-3 overflow-y-auto flex flex-col gap-2">
              {venueShown.items.map(({ inv, qty }) => {
                    const ph = photoOf(inv);
                    return (
                      <div key={inv.id} className="flex items-center gap-2.5">
                        {ph
                          ? onZoom
                            ? <button type="button" onClick={() => onZoom(ph)} aria-label={`Enlarge ${inv.name}`} className={"shrink-0 rounded-md cursor-zoom-in" + ring}>
                                <img src={thumbUrl(ph, 80)} loading="lazy" decoding="async" alt="" className="w-10 h-10 rounded-md object-cover border border-gray-200" />
                              </button>
                            : <img src={thumbUrl(ph, 80)} loading="lazy" decoding="async" alt="" className="w-10 h-10 rounded-md object-cover border border-gray-200 shrink-0" />
                          : <span className="w-10 h-10 rounded-md bg-gray-100 shrink-0" />}
                        <span className="flex-1 min-w-0 text-[13.5px] text-[#1A1A2E]">{inv.name}</span>
                        <span className="text-[13.5px] font-semibold text-gray-700 tabular-nums whitespace-nowrap">×{qty}{inv.unit ? <span className="ml-0.5 text-[11px] font-normal text-gray-400">{inv.unit}</span> : null}</span>
                      </div>
                    );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A Mapping flower in full: the real mandi flower beside the one artificial inventory item it maps
// to, with photos (owner ask 2026-11-20: "click kru photo pe toh puri details aani chahiye").
// Shared by IMS Flowers → Mandi Prices (the "Mapped" chip) and IMS Planning → Dept Ops → Floral
// (the "Mapped substitutes" list), so both show the same thing.
//
// flower: the mandi catalogue row · item: the inventory item (null = the mapped item is gone)
// artCost (optional): what 1 unit of the flower costs as artificial · need (optional): this event's
// { qty, unit, cost } · onChange (optional): shows "Change mapping".
import { useEffect } from "react";
import { thumbUrl, fitUrl } from "../../lib/studio/thumb.js";
import { variantDisplayPhoto } from "../../lib/ims/mandiVariants";
import { mapPcsPerUnit } from "../../lib/ims/flowerHelpers";

const rs = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

function DetailRow({ k, v }) {
  if (v === "" || v == null) return null;
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{k}</span><span className="font-medium text-gray-800 text-right">{v}</span>
    </div>
  );
}

function BigPhoto({ src, alt, icon }) {
  return src
    ? <a href={src} target="_blank" rel="noopener noreferrer" title="Open full size" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"><img src={fitUrl(src, 480)} alt={alt} className="w-full h-56 object-cover rounded-xl border border-gray-200 cursor-zoom-in" /></a>
    : <div className="w-full h-56 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-4xl text-gray-300">{icon}</div>;
}

export const itemPhotoOf = (item) => (item ? ((Array.isArray(item.photoUrls) && item.photoUrls[0]) || item.img || "") : "");

export default function MappingDetailModal({ flower, item, artCost = null, need = null, onClose, onChange }) {
  const variants = Array.isArray(flower?.colorVariants) ? flower.colorVariants : [];
  const fPhoto = variants.length ? variantDisplayPhoto(variants[0], variants, flower?.photoUrl) : (flower?.photoUrl || null);
  // Escape closes it, like the app's other dialogs
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") onClose?.(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const iPhotos = item ? [...(Array.isArray(item.photoUrls) ? item.photoUrls : []), ...(item.img && !(item.photoUrls || []).includes(item.img) ? [item.img] : [])] : [];
  return (
    <div onClick={onClose} data-nested-dialog="" className="fixed inset-0 z-[9200] bg-black/60 flex items-center justify-center p-5 ui-overlay-in">
      <div role="dialog" aria-modal="true" aria-label={`Mapping — ${flower?.name || "flower"}`} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-[min(760px,100%)] max-h-[88vh] flex flex-col overflow-hidden shadow-2xl ui-pop-in">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <p className="font-bold text-gray-800">🔗 Mapping — {flower?.name || "flower"}</p>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {need && (
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
              This event: <b>{need.qty} {need.unit}</b> of {flower?.name || "this flower"} goes artificial{need.pcs > 0 ? <> → <b>{need.pcs} {item?.unit ? String(item.unit).toLowerCase() : "pcs"}</b> of the item</> : null}{need.cost > 0 ? <> · <b>{rs(need.cost)}</b></> : null}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 items-start">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-pink-600 mb-2">🌸 Real flower (mandi)</div>
              <BigPhoto src={fPhoto} alt={flower?.name} icon="🌸" />
              <div className="mt-3 font-semibold text-gray-900">{flower?.name || "—"}</div>
              {flower && (
                <div className="mt-2 text-xs">
                  <DetailRow k="Category" v={flower.flowerCat} />
                  <DetailRow k="Unit" v={flower.unit} />
                  <DetailRow k="Pieces / unit" v={Number(flower.gattharSize) > 0 ? flower.gattharSize : ""} />
                  <DetailRow k="Mandi price" v={`${rs(flower.currentPrice)} / ${flower.unit || "unit"}`} />
                  <DetailRow k="Colours" v={variants.length ? variants.map((v) => v.name).filter(Boolean).join(", ") : ""} />
                  {/* Two different rates, named for where each is used: the Mandi tab's "Art ₹/Unit" is the
                      item's live price × its sub-category factor; Deal Check and Planning cost the
                      artificial part at the item's cost as saved when it was mapped (artificialMapCost). */}
                  <DetailRow k="Art ₹/Unit (Mandi tab, live)" v={artCost != null ? `${rs(Math.round(artCost * 100) / 100)} / ${flower.unit || "unit"}` : ""} />
                  <DetailRow k="Pieces per unit" v={`1 ${flower.unit || "unit"} = ${mapPcsPerUnit(flower)} ${item?.unit ? String(item.unit).toLowerCase() : "pcs"}${Number(flower.artificialMapPcsPerUnit) > 0 ? "" : " (not set — 1)"}`} />
                  <DetailRow k="Deal Check & Planning cost" v={Number(flower.artificialMapCost) > 0 ? `${rs(Math.round(flower.artificialMapCost * mapPcsPerUnit(flower) * 100) / 100)} / ${flower.unit || "unit"} (item cost saved when mapped × pieces)` : "₹0 — not set"} />
                </div>
              )}
            </div>
            <div className="hidden sm:flex items-center justify-center self-center text-2xl text-blue-400">→</div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 mb-2">📦 Artificial item (inventory)</div>
              {item ? (
                <>
                  <BigPhoto src={iPhotos[0]} alt={item.name} icon="📦" />
                  {iPhotos.length > 1 && (
                    <div className="mt-2 flex gap-1.5 flex-wrap">
                      {iPhotos.slice(1, 6).map((u, ui) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" title="Open full size" className="rounded focus-visible:outline-2 focus-visible:outline-blue-500"><img src={thumbUrl(u, 48)} alt={`${item.name} — photo ${ui + 2}`} className="w-12 h-12 rounded object-cover border border-gray-200 cursor-zoom-in" /></a>)}
                    </div>
                  )}
                  <div className="mt-3 font-semibold text-gray-900">{item.name}</div>
                  <div className="mt-2 text-xs">
                    <DetailRow k="Code" v={item.code} />
                    <DetailRow k="Category" v={[item.cat, item.subCat].filter(Boolean).join(" · ")} />
                    <DetailRow k="Rental price" v={`${rs(item.price)} / ${item.unit || "piece"}`} />
                    <DetailRow k="Cost" v={Number(item.cost) > 0 ? rs(item.cost) : ""} />
                    <DetailRow k="In stock" v={`${Number(item.qty) || 0} ${item.unit || ""}`.trim()} />
                    <DetailRow k="Location" v={item.location} />
                    <DetailRow k="Size" v={item.size || item.dims_LxWxH || ""} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-red-500 font-semibold">⚠ The mapped item is not in inventory any more{onChange ? " — pick another." : "."}</div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Close</button>
          {onChange && <button onClick={onChange} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">🔗 Change mapping</button>}
        </div>
      </div>
    </div>
  );
}

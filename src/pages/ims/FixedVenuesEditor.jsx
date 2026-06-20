// IMS → Admin → Settings → Venue Min Labour → 🏛️ Fixed Venues.
// A fixed (inhouse) venue owns standing inventory permanently installed there.
// That standing list drives BOTH:
//   • Labour — reused standing items need no build crew (only what's built extra counts).
//   • Cost — standing items bill at a discount; extras/other venues bill full rate.
// Match is by SPECIFIC inventory item (design): swap to a different item → full labour + full rental.
import { useState } from "react";

export default function FixedVenuesEditor({ settings, setSettings, inventory = [], trussInv = null }) {
  const pillarSizes = Object.keys(trussInv?.pillars || {}).sort((a, b) => Number(b) - Number(a));
  const beamSizes = Object.keys(trussInv?.beams || {}).sort((a, b) => Number(b) - Number(a));
  const fixedVenues = settings.fixedVenues || [];
  const save = (next) => setSettings((s) => ({ ...s, fixedVenues: next }));

  // Venue names must match what Studio uses for a function's venue (the labour calc keys
  // off venueMinLabour[fn.venue.name]). So source the dropdown from those exact names —
  // venues configured in Venue Min Labour + any inventory locations + already-added ones.
  const venueOptions = [...new Set([
    ...Object.keys(settings.venueMinLabour || {}),
    ...(inventory || []).map((i) => i.loc || i.location).filter(Boolean),
    ...fixedVenues.map((v) => v.name).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));
  const addable = venueOptions.filter((n) => !fixedVenues.some((v) => v.name === n));

  const addVenue = (name) => {
    if (!name || fixedVenues.some((v) => v.name === name)) return;
    const cfg = settings.venueMinLabour?.[name];
    const min = (cfg && typeof cfg === "object" ? cfg.min : (typeof cfg === "number" ? cfg : null)) || 4;
    save([...fixedVenues, { id: "fv_" + Date.now().toString(36).slice(-6), name, minLabour: min, discountPct: 70, items: [] }]);
  };
  const updVenue = (id, patch) => save(fixedVenues.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const delVenue = (id) => { const v = fixedVenues.find((x) => x.id === id); if (!window.confirm(`Remove fixed venue "${v?.name}"? Its standing inventory config is deleted.`)) return; save(fixedVenues.filter((x) => x.id !== id)); };

  const addItem = (vid, inv) => {
    if (!inv) return;
    const v = fixedVenues.find((x) => x.id === vid);
    if (v.items.some((it) => it.invId === inv.id)) return; // already added
    updVenue(vid, { items: [...v.items, { invId: inv.id, name: inv.name, qty: 1, discountPct: v.discountPct ?? 70 }] });
  };
  const updItem = (vid, invId, patch) => { const v = fixedVenues.find((x) => x.id === vid); updVenue(vid, { items: v.items.map((it) => (it.invId === invId ? { ...it, ...patch } : it)) }); };
  const delItem = (vid, invId) => { const v = fixedVenues.find((x) => x.id === vid); updVenue(vid, { items: v.items.filter((it) => it.invId !== invId) }); };
  const updTruss = (vid, kind, size, qty) => {
    const v = fixedVenues.find((x) => x.id === vid);
    const truss = { pillars: { ...(v.truss?.pillars || {}) }, beams: { ...(v.truss?.beams || {}) } };
    if (qty > 0) truss[kind][size] = qty; else delete truss[kind][size];
    updVenue(vid, { truss });
  };
  // Pieces of a truss size available to assign HERE = stock (Planning) minus what other
  // fixed venues already hold standing.
  const trussAvail = (kind, size, vid) => {
    const stock = Number(trussInv?.[kind]?.[size]?.stock) || 0;
    const otherStanding = fixedVenues.filter((x) => x.id !== vid).reduce((s, x) => s + (Number(x.truss?.[kind]?.[size]) || 0), 0);
    return Math.max(0, stock - otherStanding);
  };
  // Pieces of an inventory item free to assign HERE = stock minus other venues' standing qty.
  const itemAvail = (invId, vid) => {
    const inv = inventory.find((i) => i.id === invId);
    const stock = Number(inv?.qty ?? inv?.qtyOwned) || 0;
    const otherStanding = fixedVenues.filter((x) => x.id !== vid).reduce((s, x) => s + (Number((x.items || []).find((it) => it.invId === invId)?.qty) || 0), 0);
    return Math.max(0, stock - otherStanding);
  };
  // Render dimensions whether stored as a string or an {l,w,h} object.
  const fmtDims = (inv) => {
    const d = inv?.dims_LxWxH || inv?.dims?.lxwxh;
    if (d && typeof d === "object") { const p = [d.l ?? d.L, d.w ?? d.W, d.h ?? d.H].filter((x) => x != null && x !== ""); return p.length ? p.join("×") + " ft" : ""; }
    if (typeof d === "string" && d.trim()) return d;
    const s = inv?.size || inv?.dims?.size;
    return (typeof s === "string" && s.trim()) ? s : "";
  };

  return (
    <div className="bg-white border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="font-bold text-gray-900">🏛️ Fixed Venues (standing inventory)</p>
        {addable.length > 0
          ? <select value="" onChange={(e) => { addVenue(e.target.value); e.target.value = ""; }} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium border-none cursor-pointer">
              <option value="">+ Add Fixed Venue…</option>
              {addable.map((n) => <option key={n} value={n} className="bg-white text-gray-800">{n}</option>)}
            </select>
          : <span className="text-xs text-gray-400">Add venues in “Venue Min Labour” above first</span>}
      </div>
      <p className="text-xs text-gray-500 mb-4">Inhouse venues that own permanently-installed structure. Reusing a standing item = no build labour + discounted rental. Swapping to a different item, or extras beyond the standing qty, bill full labour + full rental.</p>

      {fixedVenues.length === 0 && <div className="text-center text-gray-400 text-sm py-8 border border-dashed rounded-xl">No fixed venues yet. Add one (e.g. Ambria Exotica) to define its standing inventory.</div>}

      <div className="space-y-4">
        {fixedVenues.map((v) => (
          <div key={v.id} className="border rounded-xl p-4 bg-gray-50">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <select value={v.name} onChange={(e) => updVenue(v.id, { name: e.target.value })} className="border rounded-lg px-3 py-1.5 text-sm font-semibold flex-1 min-w-[160px] bg-white">
                {venueOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                {!venueOptions.includes(v.name) && <option value={v.name}>{v.name} (not in venue list)</option>}
              </select>
              <div className="flex items-center gap-1"><span className="text-xs text-gray-500">Min labour</span><input type="number" min="0" value={v.minLabour ?? 4} onChange={(e) => updVenue(v.id, { minLabour: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" /></div>
              <div className="flex items-center gap-1"><span className="text-xs text-gray-500">Default discount</span><input type="number" min="0" max="100" value={v.discountPct ?? 70} onChange={(e) => updVenue(v.id, { discountPct: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" /><span className="text-xs text-gray-400">%</span></div>
              <button onClick={() => delVenue(v.id)} className="text-red-400 hover:text-red-600 text-sm ml-auto">🗑️</button>
            </div>

            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Standing inventory <span className="font-normal text-gray-400 normal-case">— specific items installed here (location = {v.name})</span></div>
            <div className="space-y-1.5 mb-2">
              {v.items.map((it) => {
                const inv = inventory.find((i) => i.id === it.invId);
                const img = inv?.img || inv?.photoUrls?.[0] || "";
                const dims = fmtDims(inv);
                const avail = itemAvail(it.invId, v.id);
                return (
                <div key={it.invId} className="flex items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 flex-wrap">
                  {img
                    ? <img src={img} alt="" className="w-11 h-11 rounded object-cover border flex-shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
                    : <div className="w-11 h-11 rounded bg-gray-100 border flex-shrink-0 flex items-center justify-center text-gray-300 text-lg">🖼️</div>}
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-sm text-gray-800">{it.name}</div>
                    <div className="text-[10px] text-gray-400">{dims ? `📐 ${dims}` : "no dimensions"}{inv?.qty != null ? ` · stock ${inv.qty}` : ""}</div>
                  </div>
                  <span className="text-xs text-gray-400">qty</span>
                  <input type="number" min="1" max={avail || undefined} value={it.qty} onChange={(e) => { const raw = parseInt(e.target.value) || 1; updItem(v.id, it.invId, { qty: avail > 0 ? Math.min(raw, avail) : raw }); }} className="w-16 border rounded px-2 py-1 text-sm text-center font-bold" />
                  <span className="text-[10px] text-gray-400">/{avail}</span>
                  <span className="text-xs text-gray-400">rent @</span>
                  <input type="number" min="0" max="100" value={it.discountPct ?? v.discountPct ?? 70} onChange={(e) => updItem(v.id, it.invId, { discountPct: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" />
                  <span className="text-xs text-gray-400">% off</span>
                  <button onClick={() => delItem(v.id, it.invId)} className="text-red-400 hover:text-red-600 text-xs ml-auto">×</button>
                </div>
                );
              })}
              {v.items.length === 0 && <div className="text-xs text-gray-400 italic">No standing items yet — add the specific designs installed at {v.name}.</div>}
            </div>

            {/* Item picker — by specific inventory item */}
            <div className="flex items-center gap-2">
              <input list={"fv-inv-" + v.id} placeholder="Add a specific inventory item (design)…" className="border rounded-lg px-3 py-1.5 text-sm flex-1"
                onChange={(e) => { const inv = inventory.find((i) => (i.name || "").toLowerCase() === e.target.value.toLowerCase()); if (inv) { addItem(v.id, inv); e.target.value = ""; } }} />
              <datalist id={"fv-inv-" + v.id}>
                {inventory.filter((i) => !v.items.some((it) => it.invId === i.id)).map((i) => <option key={i.id} value={i.name}>{i.cat ? `${i.cat}${i.subCat ? " · " + i.subCat : ""}` : ""}</option>)}
              </datalist>
            </div>

            {/* Standing truss — pillars/beams installed here (totals per size, sizes live from Planning) */}
            <div className="text-xs font-semibold text-gray-500 uppercase mt-3 mb-1.5">Standing truss <span className="font-normal text-gray-400 normal-case">— installed pillars/beams · “/N” = pieces free to assign here</span></div>
            {(() => {
              // Sizes come live from Planning truss inventory; also keep any size this venue
              // already uses (so a size removed in Planning can still be zeroed, not lost).
              const vPillars = [...new Set([...pillarSizes, ...Object.keys(v.truss?.pillars || {})])].sort((a, b) => Number(b) - Number(a));
              const vBeams = [...new Set([...beamSizes, ...Object.keys(v.truss?.beams || {})])].sort((a, b) => Number(b) - Number(a));
              if (vPillars.length === 0 && vBeams.length === 0) return <div className="text-xs text-gray-400 italic">Truss sizes load from Planning → Truss inventory. Add sizes there first.</div>;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 w-14">🔩 Pillars</span>
                    {vPillars.map((sz) => { const avail = trussAvail("pillars", sz, v.id); return (
                      <span key={sz} className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-teal-700 font-medium">{sz}ft</span>
                        <input type="number" min="0" max={avail} value={v.truss?.pillars?.[sz] ?? 0} onChange={(e) => updTruss(v.id, "pillars", sz, Math.min(parseInt(e.target.value) || 0, avail))} className="w-12 border border-teal-200 rounded px-1 py-0.5 text-xs text-center font-bold" />
                        <span className="text-[10px] text-gray-400">/{avail}</span>
                      </span>
                    ); })}
                    <span className="text-[10px] text-gray-400">total {Object.values(v.truss?.pillars || {}).reduce((s, q) => s + (Number(q) || 0), 0)} pillars</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 w-14">➖ Beams</span>
                    {vBeams.map((sz) => { const avail = trussAvail("beams", sz, v.id); return (
                      <span key={sz} className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-amber-700 font-medium">{sz}ft</span>
                        <input type="number" min="0" max={avail} value={v.truss?.beams?.[sz] ?? 0} onChange={(e) => updTruss(v.id, "beams", sz, Math.min(parseInt(e.target.value) || 0, avail))} className="w-12 border border-amber-200 rounded px-1 py-0.5 text-xs text-center font-bold" />
                        <span className="text-[10px] text-gray-400">/{avail}</span>
                      </span>
                    ); })}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

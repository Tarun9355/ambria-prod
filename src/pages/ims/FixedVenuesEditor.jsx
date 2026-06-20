// IMS → Admin → Settings → Venue Min Labour → 🏛️ Fixed Venues.
// A fixed (inhouse) venue owns standing inventory permanently installed there.
// That standing list drives BOTH:
//   • Labour — reused standing items need no build crew (only what's built extra counts).
//   • Cost — standing items bill at a discount; extras/other venues bill full rate.
// Match is by SPECIFIC inventory item (design): swap to a different item → full labour + full rental.
import { useState } from "react";

export default function FixedVenuesEditor({ settings, setSettings, inventory = [] }) {
  const fixedVenues = settings.fixedVenues || [];
  const save = (next) => setSettings((s) => ({ ...s, fixedVenues: next }));

  const addVenue = () => {
    const name = window.prompt("Fixed venue name (e.g. Ambria Exotica):");
    if (!name || !name.trim()) return;
    save([...fixedVenues, { id: "fv_" + Date.now().toString(36).slice(-6), name: name.trim(), minLabour: 4, discountPct: 70, items: [] }]);
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

  return (
    <div className="bg-white border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="font-bold text-gray-900">🏛️ Fixed Venues (standing inventory)</p>
        <button onClick={addVenue} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Fixed Venue</button>
      </div>
      <p className="text-xs text-gray-500 mb-4">Inhouse venues that own permanently-installed structure. Reusing a standing item = no build labour + discounted rental. Swapping to a different item, or extras beyond the standing qty, bill full labour + full rental.</p>

      {fixedVenues.length === 0 && <div className="text-center text-gray-400 text-sm py-8 border border-dashed rounded-xl">No fixed venues yet. Add one (e.g. Ambria Exotica) to define its standing inventory.</div>}

      <div className="space-y-4">
        {fixedVenues.map((v) => (
          <div key={v.id} className="border rounded-xl p-4 bg-gray-50">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <input value={v.name} onChange={(e) => updVenue(v.id, { name: e.target.value })} className="border rounded-lg px-3 py-1.5 text-sm font-semibold flex-1 min-w-[160px]" />
              <div className="flex items-center gap-1"><span className="text-xs text-gray-500">Min labour</span><input type="number" min="0" value={v.minLabour ?? 4} onChange={(e) => updVenue(v.id, { minLabour: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" /></div>
              <div className="flex items-center gap-1"><span className="text-xs text-gray-500">Default discount</span><input type="number" min="0" max="100" value={v.discountPct ?? 70} onChange={(e) => updVenue(v.id, { discountPct: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" /><span className="text-xs text-gray-400">%</span></div>
              <button onClick={() => delVenue(v.id)} className="text-red-400 hover:text-red-600 text-sm ml-auto">🗑️</button>
            </div>

            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Standing inventory <span className="font-normal text-gray-400 normal-case">— specific items installed here (location = {v.name})</span></div>
            <div className="space-y-1.5 mb-2">
              {v.items.map((it) => (
                <div key={it.invId} className="flex items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 flex-wrap">
                  <span className="text-sm text-gray-800 flex-1 min-w-[140px]">{it.name}</span>
                  <span className="text-xs text-gray-400">qty</span>
                  <input type="number" min="1" value={it.qty} onChange={(e) => updItem(v.id, it.invId, { qty: parseInt(e.target.value) || 1 })} className="w-16 border rounded px-2 py-1 text-sm text-center font-bold" />
                  <span className="text-xs text-gray-400">rent @</span>
                  <input type="number" min="0" max="100" value={it.discountPct ?? v.discountPct ?? 70} onChange={(e) => updItem(v.id, it.invId, { discountPct: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" />
                  <span className="text-xs text-gray-400">% off</span>
                  <button onClick={() => delItem(v.id, it.invId)} className="text-red-400 hover:text-red-600 text-xs ml-auto">×</button>
                </div>
              ))}
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
          </div>
        ))}
      </div>
    </div>
  );
}
